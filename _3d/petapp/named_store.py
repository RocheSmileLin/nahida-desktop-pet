# -*- coding: utf-8 -*-
"""命名预设存储：sets.json（服装套装）/ expr_sets.json（表情预设）。

两者结构相同：{"sets": [{"name": "...", ...}, ...]}，都是「多份命名状态」，
不放进 pet_settings.json（那里只放单值旋钮）。
"""
import json
import threading


class NamedSetsStore:
    """线程安全的命名列表 JSON 存储。"""

    def __init__(self, path):
        self.path = path
        self._lock = threading.RLock()
        self._sets = None

    def get(self):
        with self._lock:
            if self._sets is None:
                try:
                    with open(self.path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        data = data.get("sets") or []
                    self._sets = data if isinstance(data, list) else []
                except Exception:
                    self._sets = []
            return self._sets

    def save(self, sets):
        with self._lock:
            self._sets = sets if isinstance(sets, list) else []
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump({"sets": self._sets}, f, ensure_ascii=False, indent=2)
                return True
            except Exception:
                return False
