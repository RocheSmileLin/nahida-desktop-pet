# -*- coding: utf-8 -*-
"""纳西妲桌宠 —— 透明无边框置顶窗口 + three.js 渲染（启动入口）。

实现已按职责拆分到 ``petapp/`` 包：
    petapp/paths.py          路径/窗口尺寸/单实例端口
    petapp/settings_store.py pet_settings.json
    petapp/named_store.py    sets.json / expr_sets.json
    petapp/motion_store.py   motions.js 读取与链开关回写
    petapp/http_server.py    本地服务 + REST 接口
    petapp/page.py           页面自定义协议
    petapp/window.py         桌宠窗口 / 点击穿透 / 拖动 / 视线
    petapp/tray.py           系统托盘
    petapp/main.py           启动流程

启动：D:\\Python\\pythonw.exe pet_app.py
"""
import sys

from petapp.main import main

if __name__ == "__main__":
    main()
