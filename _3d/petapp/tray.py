# -*- coding: utf-8 -*-
"""系统托盘菜单（点不到模型时也能操作）。"""
import os

from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import QMenu, QSystemTrayIcon

from . import paths


def build_tray(app, window, motion_names):
    tray = QSystemTrayIcon(QIcon(os.path.join(paths.BASE, "pet_icon.ico")), app)
    menu = QMenu()

    menu.addAction("显示 / 前台", lambda: (window.show(), window.raise_()))
    menu.addAction("复位位置", lambda: window._place_bottom_right())
    menu.addSeparator()

    # 换姿势子菜单 —— 从 motions.js 自动读取，加动作后无需手动同步
    if motion_names:
        sub = menu.addMenu("换姿势")
        for i, name in enumerate(motion_names):
            sub.addAction(name, lambda idx=i: window.page().runJavaScript("setPose(%d)" % idx))
        menu.addSeparator()

    menu.addAction("放大", lambda: window.on_cmd("scale+"))
    menu.addAction("缩小", lambda: window.on_cmd("scale-"))
    menu.addSeparator()
    menu.addAction("退出", app.quit)

    tray.setContextMenu(menu)
    tray.setToolTip("纳西妲桌宠（右键图标可换动作）")
    tray.show()
    return tray
