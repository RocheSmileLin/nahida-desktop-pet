# -*- coding: utf-8 -*-
"""启动流程：单实例保护 → 选端口 → 本地服务 → QApplication → 桌宠窗口 → 托盘。"""
import socket
import sys
import time

from PyQt5.QtWidgets import QApplication

from . import paths
from .http_server import ServerContext, start_server
from .tray import build_tray
from .window import Pet


def pick_port(start=paths.DEFAULT_PORT, tries=30, wait_s=5.0):
    """优先用 8810（调整台/文档里都是这个地址）。

    ⚠️ 上一个实例刚退出时 8810 可能还没释放 → 先等它几秒再往后跳，
       否则会漂移到 8811，而写死 8810 的地方（调整台）就全失效了。
    """

    def _free(p):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return True
            except OSError:
                return False

    t0 = time.time()
    while True:                       # ① 先等 8810
        if _free(start):
            return start
        if time.time() - t0 >= wait_s:
            break
        time.sleep(0.2)
    for p in range(start + 1, start + tries):   # ② 还占着才往后找
        if _free(p):
            print("[pet] ⚠️ %d 被占用 → 改用端口 %d（调整台地址会跟着变）" % (start, p), flush=True)
            return p
    return start


def _acquire_instance_lock(argv):
    """单实例保护；--restart-wait 时等旧实例完全退出再接手。

    同时跑两台桌宠会抢同一个 QtWebEngine 缓存目录 → 帧率掉到 0.5~3 fps。
    用一个高位端口当锁；锁随进程退出自动释放。
    """
    restart_wait = "--restart-wait" in argv
    argv = [a for a in argv if a != "--restart-wait"]
    deadline = time.time() + 30
    lock = None
    while True:
        try:
            lock = socket.socket()
            lock.bind(("127.0.0.1", paths.INSTANCE_LOCK_PORT))
            lock.listen(1)
            break
        except OSError:
            try:
                lock.close()
            except Exception:
                pass
            if not restart_wait or time.time() > deadline:
                print("[pet] 已经有一台桌宠在运行了 —— 本次不再启动（避免两台叠在一起）", flush=True)
                return None, argv
            time.sleep(0.3)
    if restart_wait:
        print("[pet] 重启：旧实例已退出，本次接手 ✅", flush=True)
    return lock, argv


def main():
    lock, argv = _acquire_instance_lock(sys.argv)
    if lock is None:
        sys.exit(0)
    sys.argv = argv

    port = pick_port()
    context = ServerContext(app_ref=[None])
    start_server(paths.web_root(), port, context)

    app = QApplication(sys.argv)
    window = Pet(port, context)
    context.app_ref[0] = window          # HTTP 线程收位图时回调到本对象
    window.show()

    # 托盘图标（右键菜单可切换动作 / 缩放 / 退出）
    build_tray(app, window, context.motions.names())

    sys.exit(app.exec_())
