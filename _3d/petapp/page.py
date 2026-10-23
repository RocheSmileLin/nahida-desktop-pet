# -*- coding: utf-8 -*-
"""QWebEnginePage：拦截 petdrag:// / petcmd:// 等自定义协议，当作页面消息通道。"""
from PyQt5.QtWebEngineWidgets import QWebEnginePage


def is_self_page(url_str, port):
    """主框架是否为本机桌宠页面。

    ★ 只放行 http://127.0.0.1:<port>/ 与 http://localhost:<port>/。
      把文件（图片等）拖进窗口时，Chromium 会把 drop 当成一次导航 →
      页面跳去 file:///...jpg，模型被图片替换（用户反馈）。
    """
    return url_str.startswith(("http://127.0.0.1:%d/" % port,
                               "http://localhost:%d/" % port))


class PetPage(QWebEnginePage):
    def __init__(self, host, parent=None):
        super().__init__(parent)
        self.host = host

    def javaScriptConsoleMessage(self, level, msg, line, src):
        print("[pet-js] %s (line %d)" % (msg, line), flush=True)

    def acceptNavigationRequest(self, url, typ, is_main):
        s = url.toString()
        # 拦下自定义协议：不真的跳转，只当"消息"用
        if s.startswith("petdrag://"):
            try:
                dx, dy = s.replace("petdrag://", "").split(",")[:2]
                self.host.move_by(int(float(dx)), int(float(dy)))
            except Exception as e:
                print("[pet] 拖动解析失败: %s" % e, flush=True)
            return False
        if s.startswith("petcmd://"):
            self.host.on_cmd(s.replace("petcmd://", ""))
            return False
        if s.startswith("petbox://"):
            self.host._set_hit_box(s.replace("petbox://", ""))
            return False
        if s.startswith("petmask://"):
            self.host._set_mask(s.replace("petmask://", ""))
            return False
        # ★ 主框架只放行本站页面：把文件（图片等）拖进窗口时，Chromium 会把
        #   drop 当成一次导航 → 页面跳到 file:///...jpg，模型被图片替换（用户反馈）。
        #   页面侧已 preventDefault，这里是第二道保险（渲染层直接发起时也能拦住）。
        if is_main:
            port = getattr(self.host, "_port", 0)
            if not is_self_page(s, port):
                print("[pet] 拦下页面跳转: %s" % s[:120], flush=True)
                return False
        return super().acceptNavigationRequest(url, typ, is_main)
