# -*- coding: utf-8 -*-
"""项目路径与运行时常量（不依赖 Qt，方便单独测试）。"""
import os

# _3d/ —— 配置、页面、模型、动作都在这里
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 兼容旧的 model_root 布局：如果存在 model_root 就把它作为 HTTP 根目录
MODEL_ROOT = os.path.join(BASE, "model_root")


def web_root():
    """HTTP 静态服务根目录。"""
    return MODEL_ROOT if os.path.isdir(MODEL_ROOT) else BASE


def entry_script():
    """右键菜单「重启桌宠」时启动的入口脚本。"""
    return os.path.join(BASE, "pet_app.py")


def config_path(name):
    """配置/数据文件名 → 绝对路径（始终位于 _3d/，不受 HTTP 根目录影响）。"""
    return os.path.join(BASE, name)


# ---- 桌宠窗口尺寸（1000×1000，配合 1000×1000 的视线跟踪范围）----
WIDGET_W, WIDGET_H = 1000, 1000

# ---- 单实例锁 ----
INSTANCE_LOCK_PORT = 47821

# ---- 默认 HTTP 端口（调整台/文档里都写 8810）----
DEFAULT_PORT = 8810
