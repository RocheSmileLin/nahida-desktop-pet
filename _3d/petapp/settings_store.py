# -*- coding: utf-8 -*-
"""调整台设置存储（pet_settings.json）。

页面(桌宠/视口/调整台) 每 300ms 拉一次 /petsettings → 这里读同一个 JSON。
写盘时只接受 SETTING_DEFAULTS 里已知的键，防止把文件写坏。
"""
import copy
import json
import threading

from . import paths

# ═══════════════════ 调整台默认值 ═══════════════════
# ★★ 唯一的数据源在服务端；前端的离线兜底副本在
#    js/settings/10-state.js（DEFAULTS）与 js/pet/10-scene.js（PET_SETTINGS），
#    改这里时同步改那两份（_check_sync.py 会核对关键项）。
# ★★★ 2026-10-18：用户再次要求「把当前浏览器设置作为新默认值」→ 全量对齐当时的
#    pet_settings.json（亮度 1.12｜环境 0.91｜半球 0.3｜主光 0.67｜补光 0｜
#    俯仰 15｜yaw -30｜庭院环境｜背景透明｜曝光 0.5｜描边 13｜阴影浓度 0｜
#    清晰度 512｜对比度 2｜高光 -1｜暗部 -1｜eyeMax 30）
SETTING_DEFAULTS = {
    # 相机 / 环境（光照 + 相机）
    "brightness": 1.12, "ambient": 0.91, "hemi": 0.30, "key": 0.67, "fill": 0.0,
    "size": 1.5, "meshScale": 1.0,
    # 相机 / 取景（+ = 相机抬高 → 俯瞰；yaw + = 相机右移 → 3/4 侧）
    "camPitch": 15.0, "camY": -0.08, "camYaw": -30.0, "camFov": 30.0,
    # 物理
    "physics": False, "gravity": -10, "unitStep": 1 / 65, "maxStep": 3,
    "warmup": 60, "maxFps": 60,
    # 拖动惯性
    "dragInertia": 80, "dragDecay": 0.9, "dragTilt": -1,
    # 视线 / 行为
    "trackRange": 1000, "gazeHead": 1.5, "gazeEye": 1.5, "breath": 0.5,
    # 在线表情：{morph名: 0~1}
    "expr": {},
    # 视线（真眼球转动）：转 左目/右目（PMX 原名）
    "eyeUp": 0, "eyeDown": 0, "eyeLeft": 0, "eyeRight": 0, "eyeMax": 30,
    # 渲染设置
    "renderMode": "white", "envPreset": "court", "bgTransparent": True,
    "exposure": 0.5,
    # 三渲二描边宽度（0~15，×0.01=场景单位；0=关描边）
    "outlineWidth": 13,
    # 阴影（模型自遮挡）
    "shadowOn": True, "shadowOpacity": 0.0, "shadowSize": 512,
    # 照片级调色（后处理）
    "contrast": 2.0, "highlights": -1.0, "shadows": -1.0,
    # 三渲二（原神风）记忆开关
    "toonOn": False,
    # 部件可见性：{部件名: false} = 隐藏（缺省 = 可见）
    "parts": {"feet_hide": False},
}


class SettingsStore:
    """线程安全的 pet_settings.json 读写器（HTTP 线程 + Qt 主线程共用）。"""

    def __init__(self, path=None, defaults=None):
        self.path = path or paths.config_path("pet_settings.json")
        self.defaults = copy.deepcopy(defaults or SETTING_DEFAULTS)
        self._lock = threading.RLock()
        self._data = None

    # ---------- 读 ----------
    def get(self):
        with self._lock:
            if self._data is None:
                data = copy.deepcopy(self.defaults)
                try:
                    with open(self.path, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                    if isinstance(loaded, dict):
                        data.update(loaded)
                except Exception:
                    pass
                self._data = data
            return self._data

    # ---------- 写 ----------
    def save(self, incoming):
        """合并 + 写盘（只接受已知旋钮）。返回 True/False。"""
        with self._lock:
            data = dict(self.get())
            for k, v in (incoming or {}).items():
                if k in self.defaults:
                    data[k] = v
            self._data = data
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                return True
            except Exception:
                return False
