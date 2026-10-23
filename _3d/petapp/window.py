# -*- coding: utf-8 -*-
"""桌宠主窗口：透明无边框置顶 + 逐像素点击穿透 + 视线/拖动消息推送。

坐标说明（本机实测）：
  · Win32 的窗口矩形/光标是【物理像素】；Qt 的 widget/QCursor 是【逻辑像素】。
  · 两者比例 = 物理窗宽 / widget 宽（125% 缩放时 = 1.25）。
  · 命中原子的优先级：逐像素位图 > 骨骼包围盒 > 整窗接收。
"""
import base64
import subprocess
import sys
import webbrowser

from PyQt5.QtCore import Qt, QUrl, QTimer
from PyQt5.QtGui import QCursor
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWebEngineWidgets import QWebEngineView

from . import paths, win32
from .page import PetPage


class Pet(QWebEngineView):
    def __init__(self, port, context):
        super().__init__()
        self._port = port
        self._context = context

        self.setWindowTitle("纳西妲桌宠")
        # 无边框 + 置顶 + 不进任务栏
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        # 背景透明
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_NoSystemBackground, True)

        self._scale_k = 1.0
        self.resize(paths.WIDGET_W, paths.WIDGET_H)

        # 页面上报位图时，HTTP 线程要能回调到本窗口（与原实现一样在构造期就挂上）
        if context is not None and getattr(context, "app_ref", None) is not None:
            context.app_ref[0] = self

        # 加载
        self._page = PetPage(self, self)
        self.setPage(self._page)
        # ⚠️ 背景透明必须在 setPage 之后设，否则设在了默认页面上
        self._page.setBackgroundColor(Qt.transparent)
        self.load(QUrl("http://127.0.0.1:%d/pet.html" % self._port))
        self.loadFinished.connect(
            lambda ok: print("[pet] 页面加载 %s" % ("OK" if ok else "失败"), flush=True))

        # 页面消息通道：JS 改 document.title → 这里收（不触发导航，无假错误）
        self._page.titleChanged.connect(self._on_title)

        # ★ 模型命中框（页面每 400ms 报一次 petbox://）
        self._hit_box = None
        self._mask = None
        self._mask_pct = -1.0
        self._pt_flags = None            # 当前是否已打上 WS_EX_TRANSPARENT
        self._gaze_key = None            # 上次推给页面的视线位置（去重用）

        # ★ 16ms 轮询光标：① 决定要不要打 WS_EX_TRANSPARENT（跨进程点击穿透）
        #                  ② 把光标位置推给页面（窗口打了穿透标志后收不到 mousemove）
        self._pt_timer = QTimer(self)
        self._pt_timer.timeout.connect(self._tick)
        self._pt_timer.start(16)

        # 放屏幕右下角
        QTimer.singleShot(300, self._place_bottom_right)

    # ---------- 鼠标穿透 ----------
    def nativeEvent(self, eventType, message):
        """历史说明：这里曾经返回 HTTRANSPARENT 做"逐像素穿透"，已撤掉。

        原因（实测）：HTTRANSPARENT 是【同一线程】语义 —— 点击只会传给同线程里
        下面的窗口。桌宠和浏览器/游戏是不同进程，系统无法转交 → 点击被直接丢弃。
        现在点击穿透完全由 WS_EX_TRANSPARENT 标志负责（见 _sync_passthrough）。
        """
        return super().nativeEvent(eventType, message)

    def _tick(self):
        """16ms 心跳：① 点击穿透 ② 光标位置（视线）③ 窗口位移速度（拖动惯性）。"""
        self._sync_passthrough()
        self._push_gaze()
        self._push_drag_vel()

    def _push_drag_vel(self):
        """★ 拖动惯性：窗口位移速度 → 页面（开物理时衣物/人体随之甩动）。

        位置一律用 Win32 的 GetWindowRect 直接量物理窗口矩形：
        不依赖 Qt widget 坐标（widget 铺满窗口时 self.pos() 恒为 (0,0)）。
        静止时不发：页面侧 DRAG_VEL 会自己衰减 → 松手后自然收尾。
        """
        try:
            rect = win32.get_window_rect(int(self.winId()))
            if not rect:
                return
            p = (rect[0], rect[1])
            last = getattr(self, "_last_pos", None)
            self._last_pos = p
            if last is None:
                return
            dx = p[0] - last[0]
            dy = p[1] - last[1]
            if dx == 0 and dy == 0:
                return
            if not getattr(self, "_drag_logged", False):
                self._drag_logged = True
                print("[pet] 拖动惯性（宿主已接通）：窗口位移 %d,%d ✅" % (dx, dy), flush=True)
            self._page.runJavaScript(
                "window.petDragVel&&petDragVel(%d,%d);" % (dx, dy))
        except Exception:
            pass

    def _push_gaze(self):
        """★ 把光标位置推给页面，供视线/头部跟踪使用。

        dx/dy = 光标相对【窗口中心】的偏移（逻辑像素）。
        窗口打上 WS_EX_TRANSPARENT 后收不到 mousemove，所以必须由宿主推送。
        """
        try:
            p = QCursor.pos()
            dx = p.x() - (self.x() + self.width() // 2)
            dy = p.y() - (self.y() + self.height() // 2)
            # 超大上限只用于「切到别的显示器」时回正；比例交给页面 TRACK_W/H
            if abs(dx) > 6000 or abs(dy) > 6000:
                if self._gaze_key != "reset":
                    self._gaze_key = "reset"
                    self._page.runJavaScript("window.petGazeReset&&petGazeReset();")
                return
            if isinstance(self._gaze_key, tuple):
                lx, ly = self._gaze_key
                if abs(lx - dx) < 2 and abs(ly - dy) < 2:
                    return                          # 动得很少就不推（省开销）
            self._gaze_key = (dx, dy)
            self._page.runJavaScript(
                "window.petMouseAt&&petMouseAt(%d,%d);" % (dx, dy))
        except Exception:
            pass

    def _cursor_on_model(self):
        """光标（Qt 逻辑坐标）是否正落在【人物像素】上。"""
        try:
            # ★ 左键按住期间一律算"在人物上"：拖动时光标会移出人物轮廓，
            #   否则 16ms 心跳会把标志翻成穿透 → 窗口中途失去鼠标 → 拖动断掉
            if win32.left_button_down():
                return True
            p = QCursor.pos()
            lx = p.x() - self.x()
            ly = p.y() - self.y()
            if not (0 <= lx < self.width() and 0 <= ly < self.height()):
                return False
            if self._hit_box is None:
                return True                      # 整窗接收模式（菜单展开等）
            if self._mask:
                cols, rows, data = self._mask
                cx = int(lx * cols / float(self.width()))
                cy = int(ly * rows / float(self.height()))
                if 0 <= cx < cols and 0 <= cy < rows:
                    bi = cy * cols + cx
                    if (bi >> 3) < len(data):
                        return bool(data[bi >> 3] & (1 << (bi & 7)))
            return False
        except Exception:
            return True

    def _sync_passthrough(self):
        """★ 跨进程点击穿透（关键修复）。

        鼠标不在人物像素上 → 给窗口打 WS_EX_TRANSPARENT：系统完全不把鼠标交给它。
        鼠标在人物像素上   → 摘掉该标志：本窗口接收，可拖动 / 可右键。
        """
        try:
            want = not self._cursor_on_model()
            if want == self._pt_flags:
                return                            # 状态没变就不碰（避免多余调用）
            win32.set_click_through(int(self.winId()), want)
            self._pt_flags = want
        except Exception:
            pass

    def _in_hit_box(self, gx, gy):
        """屏幕坐标 (gx, gy) 是否算"落在人物身上"（保留给旧调用方）。"""
        try:
            rect = win32.get_window_rect(int(self.winId()))
            if not rect:
                return True
            left, top, right, _bottom = rect
            ratio = max(1, right - left) / float(max(1, self.width()))
            lx = (gx - left) / ratio
            ly = (gy - top) / ratio
        except Exception:
            return True

        if self._mask:
            cols, rows, data = self._mask
            cw = self.width() / float(cols)
            ch = self.height() / float(rows)
            cx = int(lx / cw)
            cy = int(ly / ch)
            if 0 <= cx < cols and 0 <= cy < rows:
                bi = cy * cols + cx
                if (bi >> 3) < len(data):
                    return bool(data[bi >> 3] & (1 << (bi & 7)))
            return False

        if not self._hit_box:
            return True
        ox, oy, w, h = self._hit_box
        return (ox <= lx <= ox + w and oy <= ly <= oy + h)

    def _set_mask(self, spec):
        """★ 收下页面发来的逐格位图（旧通道）。

        spec = '列数,行数,base64(位图)'，位序 = 行优先、自左上角起。
        """
        try:
            p = spec.split(",", 2)
            if len(p) < 3:
                return
            cols, rows = int(p[0]), int(p[1])
            raw = base64.b64decode(p[2])
            if cols < 2 or rows < 2 or len(raw) < (cols * rows) // 8:
                return
            new = (cols, rows, raw)
            if self._mask and self._mask[0] == cols and self._mask[1] == rows:
                if self._mask[2] == raw:
                    return                                   # 位图没变就不动
            self._mask = new
            filled = sum(bin(b).count("1") for b in raw)
            print("[pet] 命中位图: %dx%d（%d/%d 格有人物 → 挡鼠标 %.0f%%）"
                  % (cols, rows, filled, cols * rows, 100.0 * filled / (cols * rows)), flush=True)
        except Exception as e:
            print("[pet] 位图解析失败: %s" % e, flush=True)

    def _set_mask_bits(self, w, h, data):
        """★ 全分辨率逐像素位图（w×h，每像素一位，行优先自左上角）。"""
        try:
            if self._mask and self._mask[0] == w and self._mask[1] == h and self._mask[2] == data:
                return
            self._mask = (w, h, data)
            filled = 0
            for b in data:
                filled += bin(b).count("1")
            total = w * h
            pct = 100.0 * filled / total
            # 呼吸/摆动会让位图每秒差一两个像素 → 按百分比变化节流日志
            if abs(pct - self._mask_pct) >= 1.0:
                self._mask_pct = pct
                print("[pet] 命中位图: %dx%d 逐像素（%d/%d 有人物 → 挡鼠标 %.1f%%）"
                      % (w, h, filled, total, pct), flush=True)
        except Exception as e:
            print("[pet] 位图处理失败: %s" % e, flush=True)

    def _set_hit_box(self, spec):
        """★ 记录【模型命中框】。

        spec = 'x,y,w,h'（页面用骨骼投影算出的屏幕包围盒）或 'full'（整窗接收）。
        只用它判断点击归谁，不裁剪窗口渲染（裁剪会切掉头发/裙摆）。
        """
        try:
            if spec.strip() == "full":
                if self._hit_box is not None:
                    self._hit_box = None
                    print("[pet] 命中框: 清掉（菜单展开/整窗接收）", flush=True)
                return
            x, y, w, h = [int(float(v)) for v in spec.split(",")[:4]]
            box = (x, y, w, h)
            # 24px 死区防抖：呼吸/摆动会让包围盒在 8/16 网格边界上来回跳
            if self._hit_box is not None:
                ox, oy, ow, oh = self._hit_box
                if (abs(box[0] - ox) < 24 and abs(box[1] - oy) < 24 and
                        abs(box[2] - ow) < 24 and abs(box[3] - oh) < 24):
                    return
            if box == self._hit_box:
                return
            self._hit_box = box
            print("[pet] 命中框: 框内接收鼠标、框外点击穿透 %s" % (box,), flush=True)
        except Exception as e:
            print("[pet] 命中框解析失败: %s" % e, flush=True)

    def _on_title(self, title):
        """JS 通过 document.title 发来的消息：
        petdrag://dx,dy / petcmd://xxx / petbox://x,y,w,h|full / petmask://... / petmenu://open|close
        """
        t = (title or "").split("#")[0].strip()
        if t.startswith("petdrag://"):
            try:
                dx, dy = t[10:].split(",")[:2]
                self.move_by(int(float(dx)), int(float(dy)))
            except Exception:
                pass
        elif t.startswith("petcmd://"):
            self.on_cmd(t[9:])
        elif t.startswith("petbox://"):
            self._set_hit_box(t[9:])
        elif t.startswith("petmask://"):
            self._set_mask(t[11:])
        elif t.startswith("petmenu://"):
            self._menu_watch(t[10:])

    # ── 菜单打开期间："点别处关闭"的窗口外监听 ──────────────────────────
    def _menu_watch(self, what):
        """菜单 开/关 了 → 开就启动全局鼠标轮询，关就停掉。"""
        if not hasattr(self, "_menu_timer"):
            self._menu_timer = QTimer(self)
            self._menu_timer.setInterval(60)              # 60ms：够灵敏，几乎不耗 CPU
            self._menu_timer.timeout.connect(self._poll_menu_click)
            self._menu_btn_was_down = False
            self._menu_ticks = 0
        if what == "open":
            # 打开菜单那一下右键还按着 → 先吞掉，否则会立刻把自己关掉
            self._menu_btn_was_down = True
            self._menu_ticks = 0
            self._menu_timer.start()
        else:
            self._menu_timer.stop()

    def _poll_menu_click(self):
        """光标在【宠物窗口外】按下左/右键 → 通知页面收起菜单。"""
        try:
            down = win32.any_mouse_button_down()
            if down and not self._menu_btn_was_down:
                pt = win32.cursor_pos()
                rect = win32.get_window_rect(int(self.window().winId()))
                inside = rect and (rect[0] <= pt[0] <= rect[2] and rect[1] <= pt[1] <= rect[3])
                if not inside:
                    self._menu_timer.stop()
                    print("[pet] 窗口外点击 → 收起菜单 ✅", flush=True)
                    self.page().runJavaScript(
                        "window.petCloseMenu && window.petCloseMenu()")
                    self._menu_btn_was_down = down
                    return
            self._menu_btn_was_down = down
            self._menu_ticks += 1
            if self._menu_ticks > 1500:      # 安全阀：菜单开着超 90 秒就停
                self._menu_timer.stop()
        except Exception as e:
            print("[pet] 菜单轮询异常: %s" % e, flush=True)
            try:
                self._menu_timer.stop()
            except Exception:
                pass

    def _place_bottom_right(self):
        g = QApplication.primaryScreen().availableGeometry()
        self.move(g.right() - self.width() - 40, g.bottom() - self.height() - 20)

    # ---------- 交互 ----------
    def move_by(self, dx, dy):
        p = self.pos()
        self.move(p.x() + dx, p.y() + dy)

    def on_cmd(self, cmd):
        if cmd == "quit":
            QApplication.quit()
        elif cmd == "restart":
            """重启桌宠：新实例带 --restart-wait 起，等单实例锁让出来再接手。"""
            try:
                subprocess.Popen(
                    [sys.executable, paths.entry_script(), "--restart-wait"],
                    cwd=paths.BASE,
                    creationflags=0x00000008)          # DETACHED_PROCESS
                print("[pet] 重启中（新实例会在旧实例退出后接手）", flush=True)
            except Exception as e:
                print("[pet] 重启失败: %s" % e, flush=True)
            QApplication.quit()
        elif cmd == "settings":
            """打开调整台（settings.html）—— 用系统默认浏览器。"""
            url = "http://127.0.0.1:%d/settings.html" % self._port
            try:
                webbrowser.open(url)
                print("[pet] 打开调整台: %s" % url, flush=True)
            except Exception as e:
                print("[pet] 打开调整台失败: %s" % e, flush=True)
        elif cmd == "reset":
            self._place_bottom_right()
        elif cmd == "scale+":
            self._scale_k = min(1.8, self._scale_k + 0.15)
            self.resize(int(paths.WIDGET_W * self._scale_k),
                        int(paths.WIDGET_H * self._scale_k))
        elif cmd == "scale-":
            self._scale_k = max(0.55, self._scale_k - 0.15)
            self.resize(int(paths.WIDGET_W * self._scale_k),
                        int(paths.WIDGET_H * self._scale_k))
        elif cmd in ("wave", "jump"):
            self.page().runJavaScript("window.petAction && window.petAction('%s')" % cmd)
        elif cmd == "idle":
            self.page().runJavaScript("window.petAction && window.petAction('idle')")
