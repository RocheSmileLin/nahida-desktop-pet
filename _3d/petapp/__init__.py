# -*- coding: utf-8 -*-
"""纳西妲桌宠 —— 应用模块包。

入口仍然是 ``_3d/pet_app.py``（兼容原有启动方式和快捷方式）；
具体实现按职责拆到本包内：

    paths.py          项目路径与运行时常量
    settings_store.py 调整台设置（pet_settings.json）读写
    named_store.py    命名预设（sets.json / expr_sets.json）读写
    motion_store.py   动作清单读取 + motions.js 链开关回写
    http_server.py    本地静态服务 + REST 接口
    page.py           QWebEnginePage（自定义协议消息）
    window.py         桌宠主窗口（透明、置顶、点击穿透、拖动）
    tray.py           系统托盘菜单
    main.py           单实例、端口、QApplication 启动流程

本包只使用 Python 标准库 + PyQt5；素材路径仍相对 ``_3d/``。
"""
