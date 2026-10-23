# -*- coding: utf-8 -*-
"""动作清单（motions.js）读取与链开关回写。

motions.js 是 pet.html / viewer.html / 托盘菜单共用的【单一数据源】：
    var MOTION_DEFS = [{ n:'显示名', f:'motion/xxx.vmd', ik:true, ... }, ...]
    var MOTION_GROUP_DEFS = [['分组', [下标, ...]], ...]

调整台「动作测试」页的链开关（足IK / 付与 / 物理）通过 patch_flags()
只修改目标动作对象内部的字段，文件其余字节（注释、顺序）保持不变。
"""
import re
import shutil
import threading

from . import paths


class MotionStore:
    def __init__(self, path=None):
        self.path = path or paths.config_path("motions.js")
        self._lock = threading.RLock()

    # ---------- 读取动作名（托盘菜单 / 自检用） ----------
    def names(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                src = f.read()
        except Exception:
            return []
        return re.findall(r"\{\s*n:\s*'([^']+)'", src)

    # ---------- 定位某个动作对象 ----------
    @staticmethod
    def _find_obj_span(src, name):
        """找到 `n: 'name'` 所属对象 { ... } 的范围 → (start, end)。

        用真正的括号配对（跳过字符串 / 行注释 / 块注释），
        所以【多行动作项】（如 摇腿 —— 中间夹着注释和 aim/cam 字段）也能正确处理。
        """
        key = "n: '" + name + "'"
        i = src.find(key)
        if i < 0:
            return None
        s = src.rfind("{", 0, i)
        if s < 0:
            return None
        depth, j, n = 0, s, len(src)
        while j < n:
            c = src[j]
            if c == "'" or c == '"':                      # 字符串
                q = c
                j += 1
                while j < n and src[j] != q:
                    if src[j] == "\\":
                        j += 1
                    j += 1
                j += 1
                continue
            if c == "/" and j + 1 < n and src[j + 1] == "*":   # 块注释
                k = src.find("*/", j + 2)
                if k < 0:
                    return None
                j = k + 2
                continue
            if c == "/" and j + 1 < n and src[j + 1] == "/":   # 行注释
                k = src.find("\n", j)
                if k < 0:
                    return None
                j = k + 1
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s, j
            j += 1
        return None

    # ---------- 回写链开关 ----------
    def patch_flags(self, incoming):
        """incoming = {name, ik?, noGrant?, noPhys?} —— 只改名为 name 的那一个对象。

        语义映射（注意足IK 是反的）：
            链开关 ik(开/关足IK) → motions.js 的 ik      = 关足IK（true = 关）
            链开关 grant         → motions.js 的 noGrant = !grant
            链开关 physics       → motions.js 的 noPhys  = !physics
        """
        name = (incoming or {}).get("name")
        if not name:
            return {"ok": False, "why": "缺少动作名"}
        want = {}
        for k in ("ik", "noGrant", "noPhys"):
            if k in incoming:
                want[k] = bool(incoming[k])
        if not want:
            return {"ok": False, "why": "没有要改的字段"}

        with self._lock:
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    src = f.read()
            except Exception as e:
                return {"ok": False, "why": "读 motions.js 失败: %s" % e}

            span = self._find_obj_span(src, name)
            if not span:
                return {"ok": False, "why": "在 motions.js 里没找到动作「%s」" % name}
            s, e = span                     # s = '{' 位置，e = 配对的 '}' 位置
            obj = src[s:e + 1]
            newobj = obj
            for k, v in want.items():
                lit = "true" if v else "false"
                # ① 对象里已有同名键 → 就地替换（只碰对象内部）
                rx = re.compile(r"(?<![A-Za-z0-9_])" + k + r"\s*:\s*(true|false)")
                if rx.search(newobj):
                    newobj = rx.sub(lambda mm, k=k, lit=lit: k + ": " + lit, newobj, count=1)
                else:
                    # ② 没有 → 追加到对象末尾（'}' 之前），并补齐逗号
                    t = newobj[:-1].rstrip()
                    if not t.endswith(","):
                        t += ","
                    newobj = t + " " + k + ": " + lit + " }"
            if newobj == obj:
                return {"ok": True, "changed": False, "line": obj}
            try:
                shutil.copyfile(self.path, self.path + ".bak")
                with open(self.path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(src[:s] + newobj + src[e + 1:])
            except Exception as ex:
                return {"ok": False, "why": "写 motions.js 失败: %s" % ex}
            return {"ok": True, "changed": True, "line": newobj}
