# -*- coding: utf-8 -*-
"""Win32 窗口/鼠标小工具（仅 Windows）。

跨进程点击穿透必须用窗口扩展样式 WS_EX_TRANSPARENT：
nativeEvent 返回 HTTRANSPARENT 是【同一线程】语义，桌宠和浏览器不同进程，
系统无法转交 → 点击被直接丢弃。所以这里只封装窗口标志和指针状态。
"""
import ctypes
from ctypes import wintypes

GWL_EXSTYLE = -20
WS_EX_TRANSPARENT = 0x00000020

user32 = ctypes.windll.user32


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


def get_window_rect(hwnd):
    """返回 (left, top, right, bottom)；失败返回 None。"""
    r = RECT()
    if not user32.GetWindowRect(int(hwnd), ctypes.byref(r)):
        return None
    return (r.left, r.top, r.right, r.bottom)


def set_click_through(hwnd, on):
    """开启/关闭窗口的 WS_EX_TRANSPARENT（True = 完全穿透鼠标）。"""
    ex = user32.GetWindowLongW(int(hwnd), GWL_EXSTYLE)
    new = (ex | WS_EX_TRANSPARENT) if on else (ex & ~WS_EX_TRANSPARENT)
    user32.SetWindowLongW(int(hwnd), GWL_EXSTYLE, new)


def left_button_down():
    return bool(user32.GetAsyncKeyState(0x01) & 0x8000)


def any_mouse_button_down():
    return bool((user32.GetAsyncKeyState(0x01) & 0x8000) or
                (user32.GetAsyncKeyState(0x02) & 0x8000))


def cursor_pos():
    p = POINT()
    user32.GetCursorPos(ctypes.byref(p))
    return p.x, p.y
