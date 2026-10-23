# -*- coding: utf-8 -*-
"""本地 HTTP 服务：静态文件 + 调整台/桌宠之间的 REST 接口。

接口一览（均为本机 127.0.0.1）：
    GET  /petsettings        读取 pet_settings.json（缺项自动补默认）
    POST /petsettings        合并保存设置
    GET  /petsets            服装套装 sets.json
    POST /petsets            保存服装套装
    GET  /exprsets           表情预设 expr_sets.json
    POST /exprsets           保存表情预设
    GET  /petparts           桌宠上报的部件（材质）清单
    POST /petparts           桌宠上报部件清单
    GET  /petmorphs          桌宠上报的表情 morph 清单
    POST /petmorphs          桌宠上报 morph 清单
    POST /petmotionflags     链开关写回 motions.js
    GET  /petmask?d=...      旧版逐格命中位图（base64）
    POST /petmask?w=&h=      全分辨率逐像素命中位图（二进制）
"""
import http.server
import json
import os
import socketserver
import threading
from urllib.parse import parse_qs

from . import paths
from .motion_store import MotionStore
from .named_store import NamedSetsStore
from .settings_store import SettingsStore


class ServerContext:
    """HTTP 线程和 Qt 主线程共享的运行时对象。"""

    def __init__(self, app_ref):
        self.app_ref = app_ref                       # [Pet]（HTTP 线程收位图时回调）
        self.settings = SettingsStore()
        self.sets = NamedSetsStore(paths.config_path("sets.json"))
        self.expr_sets = NamedSetsStore(paths.config_path("expr_sets.json"))
        self.motions = MotionStore()
        self.parts = []
        self.morphs = []
        self.lock = threading.RLock()

    # ---- 桌宠页面上报的清单 ----
    def set_parts(self, parts):
        with self.lock:
            self.parts = parts if isinstance(parts, list) else []

    def set_morphs(self, morphs):
        with self.lock:
            self.morphs = morphs if isinstance(morphs, list) else []


class PetRequestHandler(http.server.SimpleHTTPRequestHandler):
    """多线程 HTTP 处理器；每个请求是新实例，共享数据放在 server.context。"""
    # ★★ 2026-10-21：启用 HTTP/1.1 keep-alive。
    # 原来默认 HTTP/1.0 ⇒ 每个请求（两个页面每秒各拉一次设置）都新开 TCP 连接，
    # netstat 里堆了 400~500 个 TIME_WAIT。keep-alive 后连接复用，TIME_WAIT 基本归零。
    # ⚠️ 前提：所有响应都必须带 Content-Length（静态文件由 SimpleHTTPRequestHandler 负责；
    #    自定义端点见下面的 _reply_json / 204 / 500 分支，已全部补齐）。
    protocol_version = "HTTP/1.1"
    # 空闲连接 30 秒回收：ThreadingTCPServer 下每个连接占一个线程，
    # 不设超时的话反复刷新页面会累积线程
    timeout = 30

    def log_message(self, *a):
        pass

    def end_headers(self):
        # ★ 禁止 Chromium 缓存页面/脚本 —— 改了页面不重启就会读到旧缓存
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    # ══════════════════════════════ GET ══════════════════════════════
    def do_GET(self):
        """GET：静态文件 + 只读接口。"""
        ctx = self.server.context

        # ★ /petmask?d=列数,行数,base64 —— 旧版逐格命中位图（保留兼容）
        if self.path.startswith("/petmask?d="):
            try:
                data = parse_qs(self.path.split("?", 1)[1]).get("d", [""])[0]
                app = ctx.app_ref[0]
                if app is not None and data:
                    app._set_mask(data)
                self.send_response(204)
                self.end_headers()
            except Exception as e:
                print("[pet] petmask 接收失败: %s" % e, flush=True)
                try:
                    self.send_response(500)
                    self.send_header("Content-Length", "0")   # HTTP/1.1 keep-alive 要求
                    self.end_headers()
                except Exception:
                    pass
            return

        if self.path.startswith("/petparts"):
            self._reply_json(ctx.parts or [])
            return
        if self.path.startswith("/petmorphs"):
            self._reply_json(ctx.morphs or [])
            return
        if self.path.startswith("/petsets"):
            self._reply_json({"sets": ctx.sets.get()})
            return
        if self.path.startswith("/exprsets"):
            self._reply_json({"sets": ctx.expr_sets.get()})
            return
        if self.path.startswith("/petsettings"):
            self._reply_json(ctx.settings.get())
            return

        super().do_GET()

    # ══════════════════════════════ POST ══════════════════════════════
    def do_POST(self):
        """POST：设置/预设/清单/命中位图的写入。"""
        ctx = self.server.context

        if self.path.startswith("/petparts"):
            body = self._read_json("[]")
            parts = body.get("parts") if isinstance(body, dict) else body
            ctx.set_parts(parts or [])
            print("[pet] 调整台：已收到部件清单 %d 个 ✅" % len(ctx.parts or []), flush=True)
            self._reply_json({"ok": True, "parts": ctx.parts})
            return

        if self.path.startswith("/petmorphs"):
            body = self._read_json("[]")
            morphs = body.get("morphs") if isinstance(body, dict) else body
            ctx.set_morphs(morphs or [])
            print("[pet] 调整台：已收到表情清单 %d 个 ✅" % len(ctx.morphs or []), flush=True)
            self._reply_json({"ok": True, "n": len(ctx.morphs or [])})
            return

        if self.path.startswith("/petsets"):
            body = self._read_json("{}")
            sets = body.get("sets") if isinstance(body, dict) else body
            ok = ctx.sets.save(sets or [])
            print("[pet] 调整台：套装预设已保存 %d 套 ok=%s"
                  % (len(ctx.sets.get() or []), ok), flush=True)
            self._reply_json({"ok": ok, "sets": ctx.sets.get()})
            return

        if self.path.startswith("/exprsets"):
            body = self._read_json("{}")
            sets = body.get("sets") if isinstance(body, dict) else body
            ok = ctx.expr_sets.save(sets or [])
            print("[pet] 调整台：表情预设已保存 %d 套 ok=%s"
                  % (len(ctx.expr_sets.get() or []), ok), flush=True)
            self._reply_json({"ok": ok, "sets": ctx.expr_sets.get()})
            return

        if self.path.startswith("/petsettings"):
            incoming = self._read_json("{}")
            ok = ctx.settings.save(incoming)
            print("[pet] 调整台：已保存设置 ✅ ok=%s %s"
                  % (ok, list(incoming.keys())), flush=True)
            self._reply_json({"ok": ok, "settings": ctx.settings.get()})
            return

        if self.path.startswith("/petmotionflags"):
            incoming = self._read_json("{}")
            r = ctx.motions.patch_flags(incoming)
            print("[pet] 链开关 → motions.js: %s %s" %
                  (incoming.get("name"), "✅" if r.get("ok") else r.get("why")), flush=True)
            self._reply_json(r)
            return

        if self.path.startswith("/petmask"):
            try:
                q = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                w = int(q.get("w", ["0"])[0])
                h = int(q.get("h", ["0"])[0])
                n = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(n) if n > 0 else b""
                app = ctx.app_ref[0]
                if app is not None and w > 1 and h > 1 and len(body) >= (w * h) // 8:
                    app._set_mask_bits(w, h, body)
                self.send_response(204)
                self.end_headers()
            except Exception as e:
                print("[pet] petmask POST 失败: %s" % e, flush=True)
                try:
                    self.send_response(500)
                    self.send_header("Content-Length", "0")   # HTTP/1.1 keep-alive 要求
                    self.end_headers()
                except Exception:
                    pass
            return

        self.send_error(404)

    # ══════════════════════════════ 工具 ══════════════════════════════
    def _read_json(self, fallback):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode("utf-8") if n else fallback
            return json.loads(body or fallback)
        except Exception:
            return json.loads(fallback)

    def _reply_json(self, obj):
        try:
            data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            pass

    def handle_one_request(self):
        """客户端中途断开（关窗/切换）不该打印一大坨 traceback。"""
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            self.close_connection = True

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass


class PetHTTPServer(socketserver.ThreadingTCPServer):
    """多线程：一边传模型贴图一边还能响应其他请求，不会互相卡住。"""

    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, handler, context):
        self.context = context
        super().__init__(address, handler)

    def handle_error(self, request, client_address):
        """静默：连接中断属正常现象，不刷屏。"""
        pass


def start_server(root, port, context):
    """启动本地服务（后台线程），返回 httpd。"""
    os.chdir(root)
    httpd = PetHTTPServer(("127.0.0.1", port), PetRequestHandler, context)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd
