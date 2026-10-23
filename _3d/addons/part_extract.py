# -*- coding: utf-8 -*-
"""部件快速提取 (Part Extract) —— Blender 插件 v1.4
   ① 按【材质】把大模型部件拆成独立对象（保留 UV / 权重 / 绑定）
   ② 把部件【归并到目标模型】：权重按同名骨重定向 + 挂父级/骨架修改器 + 材质独立副本
   ③ 【接物理】把部件权重接到目标模型的【物理驱动骨】上（裙子按环×角度、通用按最近骨）→ 跟着飘
   ④ 测量部件与目标身体的贴合度；导出桌宠用的部件清单 JSON
   ⑤ 【一键导出 PMX】：自动体检 / 统一贴图到 tex/ / 选中模型成员含物理 / 调好参数导出
   ⑥ 面板内置使用说明

   安装：编辑 → 偏好设置 → 插件 → 从磁盘安装… → 选本文件 → 勾选启用
   位置：3D 视图 → 按 N → 侧栏「部件提取」
"""
bl_info = {
    "name": "部件快速提取 (Part Extract)",
    "author": "Hermes",
    "version": (1, 4, 0),
    "blender": (2, 93, 0),
    "location": "3D视图 > 侧栏(N) > 部件提取",
    "description": "按材质拆件 + 归并到目标模型 + 接物理（权重→物理驱动骨） + 一键导出 PMX + 导出桌宠清单 + 内置说明",
    "category": "Object",
}

import bpy
import bmesh
import array
import os
import re
import json
import math
import time
import shutil
from mathutils import kdtree, Vector
from bpy.props import (BoolProperty, StringProperty, PointerProperty,
                       CollectionProperty, IntProperty, FloatProperty, EnumProperty)
from bpy.types import PropertyGroup, Panel, Operator

DEFAULT_MANIFEST = r"E:\NXD\NXD桌宠\_3d\parts_manifest.json"


# ================================================================ 数据
class PE_Item(PropertyGroup):
    name: StringProperty(default="")
    slot: IntProperty(default=0)
    use: BoolProperty(default=False)
    faces: IntProperty(default=0)
    zmin: FloatProperty(default=0.0)
    zmax: FloatProperty(default=0.0)


class PE_Props(PropertyGroup):
    # —— 拆分 ——
    src: PointerProperty(type=bpy.types.Object, name="源对象")
    prefix: StringProperty(default="部件_", name="名称前缀")
    per_mat: BoolProperty(default=True, name="每个材质单独成对象",
                          description="不勾则把所有选中材质合成一个对象")
    copy_mat: BoolProperty(default=True, name="材质复制为独立副本",
                           description="复制材质并按前缀改名（桌宠开关名 = 材质名）")
    dbl: BoolProperty(default=False, name="自动设为双面",
                      description="MMD/桌宠里单面布料背面会透，建议勾上")
    hide_src: BoolProperty(default=False, name="提取后隐藏源对象")
    count: IntProperty(default=0)
    mats: CollectionProperty(type=PE_Item)

    # —— 归并 ——
    target_arm: PointerProperty(type=bpy.types.Object, name="目标骨架",
                                poll=lambda s, o: o.type == 'ARMATURE')
    target_body: PointerProperty(type=bpy.types.Object, name="目标身体（补权重用）",
                                 poll=lambda s, o: o.type == 'MESH')
    reweight: BoolProperty(default=True, name="权重重定向（同名骨搬运）",
                           description="只保留目标骨架上存在的同名骨权重，其余丢弃")
    fill_body: BoolProperty(default=True, name="未知骨改用目标身体最近点补权重",
                            description="整点权重都被丢掉的顶点，从目标身体最近 3 点取权重")
    fallback: StringProperty(default="下半身", name="兜底骨",
                             description="补不到权重时 100% 绑到该骨（目标骨架上必须存在；留空则跳过）")
    bind: BoolProperty(default=True, name="挂到目标骨架（父级 + 骨架修改器）")
    merge_copy_mat: BoolProperty(default=True, name="归并时材质也复制成独立副本")
    merge_dbl: BoolProperty(default=True, name="归并时设为双面")

    # —— 接物理（v1.3 新增）——
    phys_mode: EnumProperty(
        name="接法",
        items=[('SKIRT', "裙子（环×角度）",
                "按高度环 + 绕轴角度，映射到目标模型的裙摆骨（继承它的裙摆物理）"),
               ('NEAR', "通用（最近物理骨）",
                "按到骨的最近距离取 K 根混合（适合头发 / 披风 / 袖饰）")],
        default='SKIRT')
    phys_family: StringProperty(default="", name="骨家族前缀",
                                description="留空 = 自动检测（找数量最多的「前缀_环_扇区」家族）")
    phys_k: IntProperty(default=3, name="最近骨数 K", min=1, max=8,
                        description="通用模式：每个顶点最多混几根物理骨")
    phys_falloff: FloatProperty(default=0.03, name="衰减距离（米）", min=0.001, max=1.0,
                                description="通用模式的混合半径，3cm 左右合适")
    phys_backup: BoolProperty(default=True, name="备份原权重（_backup 目录）")
    phys_report: StringProperty(default="", name="上次接物理")

    # —— 导出 ——
    exp_path: StringProperty(default="", name="导出到", subtype='FILE_PATH',
                             description="留空则用 <blend目录>/model/<骨架名>.pmx")
    exp_unify_tex: BoolProperty(default=True, name="统一贴图到 tex/（并复制缺失文件）",
                                description="把所有材质的 MMD 贴图相对路径统一成 tex/<文件名>，"
                                            "并把没在 tex/ 里的贴图文件复制进去（桌宠按此目录找图）")
    exp_physics: BoolProperty(default=True, name="含物理（刚体 / 关节）",
                              description="导出模型的刚体与关节，头发/裙子才会飘")
    exp_visible_only: BoolProperty(default=False, name="只导出可见对象",
                                   description="⚠️ 一般不要勾：隐藏的部件会被漏掉")
    exp_scale: FloatProperty(default=12.5, name="缩放", min=0.001, max=1000.0)
    exp_copy_mode: EnumProperty(
        name="贴图复制",
        items=[('SKIP_EXISTING', "复制（跳过已存在）", ""),
               ('COPY', "总是复制（覆盖）", ""),
               ('NONE', "不复制", "")],
        default='SKIP_EXISTING')
    exp_check: BoolProperty(default=True, name="导出前体检", description="检查部件绑定与无权重顶点")
    exp_report: StringProperty(default="", name="上次导出")


# ================================================================ 工具函数
def _face_counts(me):
    n = len(me.polygons)
    out = [0] * max(1, len(me.materials))
    if n == 0:
        return out
    mi = array.array('i', [0]) * n
    me.polygons.foreach_get('material_index', mi)
    for p in mi:
        if 0 <= p < len(out):
            out[p] += 1
    return out


def _z_ranges(ob):
    me = ob.data
    nv, nf = len(me.vertices), len(me.polygons)
    out = {}
    if nf == 0:
        return out
    co = array.array('f', [0.0]) * (nv * 3)
    me.vertices.foreach_get('co', co)
    lstart = array.array('i', [0]) * nf
    ltot = array.array('i', [0]) * nf
    me.polygons.foreach_get('loop_start', lstart)
    me.polygons.foreach_get('loop_total', ltot)
    loopv = array.array('i', [0]) * len(me.loops)
    me.loops.foreach_get('vertex_index', loopv)
    mi = array.array('i', [0]) * nf
    me.polygons.foreach_get('material_index', mi)
    lo, hi = {}, {}
    for p in range(nf):
        z = co[3 * loopv[lstart[p]] + 2]
        k = mi[p]
        if k not in lo or z < lo[k]:
            lo[k] = z
        if k not in hi or z > hi[k]:
            hi[k] = z
    for k in lo:
        out[k] = (lo[k], hi[k])
    return out


def _pick_src(props, ctx):
    ob = props.src
    if ob is None:
        ob = ctx.active_object
    if ob is None or ob.type != 'MESH' or ob.data is None:
        return None
    return ob


def _target_bones(tgt):
    return set(b.name for b in tgt.data.bones)


def _tidy_material(ob, prefix, do_copy, do_dbl):
    if do_copy:
        news = []
        for m in ob.data.materials:
            if m is None:
                news.append(None)
                continue
            n2 = m.copy()
            n2.name = prefix + m.name
            try:
                n2.mmd_material.name_j = n2.name
                n2.mmd_material.name_e = n2.name
            except Exception:
                pass
            news.append(n2)
        for i, n2 in enumerate(news):
            ob.data.materials[i] = n2
    if do_dbl:
        for m in ob.data.materials:
            if m is None:
                continue
            try:
                m.mmd_material.is_double_sided = True
            except Exception:
                pass


def _build_kd(ob):
    me = ob.data
    mw = ob.matrix_world
    kd = kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(mw @ v.co, i)
    kd.balance()
    return kd


def _rename_pair(ob, new_name):
    ob.name = new_name
    if ob.data:
        ob.data.name = new_name + "_网格"


def _unify_textures(texdir, do_copy=True):
    """把所有 MMD 贴图统一成 tex/<文件名>：图片数据块指过去 + 材质的 3 个 rel_path 改掉"""
    if not os.path.isdir(texdir):
        os.makedirs(texdir, exist_ok=True)
    changed = copied = missing = 0
    for img in bpy.data.images:
        fp = img.filepath
        if not fp or img.users == 0:      # 内部图（Render Result/Viewer）与无引用图跳过
            continue
        try:
            ap = bpy.path.abspath(fp)
        except Exception:
            continue
        bn = os.path.basename(ap.replace('/', os.sep))
        if not bn:
            continue
        tgt = os.path.join(texdir, bn)
        if os.path.normcase(ap) == os.path.normcase(tgt):
            continue
        if os.path.exists(ap):
            if do_copy and not os.path.exists(tgt):
                try:
                    shutil.copy2(ap, tgt)
                    copied += 1
                except Exception:
                    pass
            img.filepath_raw = tgt
            img.filepath = tgt
            changed += 1
        elif os.path.exists(tgt):
            img.filepath_raw = tgt
            img.filepath = tgt
            changed += 1
        else:
            missing += 1
    for m in bpy.data.materials:
        mm = getattr(m, 'mmd_material', None)
        if mm is None:
            continue
        for f in ('texture_rel_path', 'sphere_texture_rel_path', 'toon_texture_rel_path'):
            v = getattr(mm, f, '') or ''
            if not v:
                continue
            bn = os.path.basename(v.replace('\\', '/'))
            new = 'tex/' + bn
            if v.replace('\\', '/') != new:
                setattr(mm, f, new)
                changed += 1
    return changed, copied, missing


# ================================================================ 拆件
class PE_OT_scan(Operator):
    bl_idname = "pe.scan"
    bl_label = "扫描材质"
    bl_description = "读取源对象的材质列表、面数与各自高度，供勾选"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, ctx):
        props = ctx.scene.pe
        ob = _pick_src(props, ctx)
        if ob is None:
            self.report({'ERROR'}, "请先指定一个网格对象作为源对象")
            return {'CANCELLED'}
        props.src = ob
        me = ob.data
        counts = _face_counts(me)
        zr = _z_ranges(ob)
        old = {it.slot: it.use for it in props.mats}
        props.mats.clear()
        for i, m in enumerate(me.materials):
            it = props.mats.add()
            it.name = m.name if m else "(空槽)"
            it.slot = i
            it.faces = counts[i] if i < len(counts) else 0
            z0, z1 = zr.get(i, (0.0, 0.0))
            it.zmin, it.zmax = z0, z1
            it.use = old.get(i, False)
        props.count = len(props.mats)
        self.report({'INFO'}, "扫描到 %d 个材质 / %d 面" % (len(props.mats), len(me.polygons)))
        return {'FINISHED'}


class PE_OT_all(Operator):
    bl_idname = "pe.all"
    bl_label = "全选"

    def execute(self, ctx):
        for it in ctx.scene.pe.mats:
            it.use = True
        return {'FINISHED'}


class PE_OT_none(Operator):
    bl_idname = "pe.none"
    bl_label = "全不选"

    def execute(self, ctx):
        for it in ctx.scene.pe.mats:
            it.use = False
        return {'FINISHED'}


class PE_OT_sel_nonzero(Operator):
    bl_idname = "pe.sel_nonzero"
    bl_label = "只选有面的"

    def execute(self, ctx):
        for it in ctx.scene.pe.mats:
            it.use = it.faces > 0
        return {'FINISHED'}


class PE_OT_extract(Operator):
    bl_idname = "pe.extract"
    bl_label = "提取选中材质"
    bl_description = "把勾选的材质提取成新对象（原对象不动）"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, ctx):
        props = ctx.scene.pe
        src = _pick_src(props, ctx)
        if src is None:
            self.report({'ERROR'}, "请先指定源对象")
            return {'CANCELLED'}
        sel = sorted(it.slot for it in props.mats if it.use)
        if not sel:
            self.report({'WARNING'}, "没有勾选任何材质")
            return {'CANCELLED'}
        src_me = src.data
        wm = ctx.window_manager
        all_before = set(bpy.data.objects)
        prev_active = ctx.view_layer.objects.active
        prev_sel = [o for o in ctx.selected_objects]

        ob = src.copy()
        ob.data = src.data.copy()
        _rename_pair(ob, props.prefix + "合并")
        try:
            coll = src.users_collection[0] if src.users_collection else ctx.collection
        except Exception:
            coll = ctx.collection
        coll.objects.link(ob)

        wm.progress_begin(0, 100)
        wm.progress_update(5)
        me = ob.data
        old2new = {o: i for i, o in enumerate(sel)}
        bm = bmesh.new()
        bm.from_mesh(me)
        dead = []
        for f in bm.faces:
            if f.material_index in old2new:
                f.material_index = old2new[f.material_index]
            else:
                dead.append(f)
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.to_mesh(me)
        bm.free()
        me.update()
        wm.progress_update(45)

        idx_keep = [p.material_index for p in me.polygons]
        me.materials.clear()
        for o in sel:
            me.materials.append(src_me.materials[o])
        for p, i in zip(me.polygons, idx_keep):
            p.material_index = i
        wm.progress_update(55)

        made = [ob]
        if props.per_mat and len(sel) > 1:
            try:
                if ctx.object and ctx.object.mode != 'OBJECT':
                    bpy.ops.object.mode_set(mode='OBJECT')
                bpy.ops.object.select_all(action='DESELECT')
                ctx.view_layer.objects.active = ob
                ob.select_set(True)
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.mesh.separate(type='MATERIAL')
                bpy.ops.object.mode_set(mode='OBJECT')
                made = [o for o in bpy.data.objects if o not in all_before]
            except Exception as e:
                self.report({'WARNING'}, "分离失败，保留合并对象：%s" % e)
                made = [ob]
        wm.progress_update(80)

        for o in made:
            if o.type != 'MESH' or o.data is None:
                continue
            slots = [m for m in o.data.materials if m]
            base = slots[0].name if len(slots) == 1 else "合并%d件" % len(slots)
            _rename_pair(o, props.prefix + base)
            _tidy_material(o, props.prefix, props.copy_mat, props.dbl)
        wm.progress_update(100)
        wm.progress_end()

        if props.hide_src:
            try:
                src.hide_set(True)
            except Exception:
                pass
        try:
            bpy.ops.object.select_all(action='DESELECT')
            for o in prev_sel:
                if o.name in bpy.data.objects:
                    o.select_set(True)
            if prev_active and prev_active.name in bpy.data.objects:
                ctx.view_layer.objects.active = prev_active
        except Exception:
            pass
        self.report({'INFO'}, "提取完成：%d 个对象（%d 个材质）" % (len(made), len(sel)))
        return {'FINISHED'}


# ================================================================ 归并
class PE_OT_merge(Operator):
    bl_idname = "pe.merge"
    bl_label = "归并选中对象"
    bl_description = "把选中的部件并入目标模型：权重重定向 + 挂父级/骨架修改器 + 材质独立副本"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, ctx):
        props = ctx.scene.pe
        tgt = props.target_arm
        if tgt is None or tgt.type != 'ARMATURE':
            self.report({'ERROR'}, "请先指定「目标骨架」")
            return {'CANCELLED'}
        obs = [o for o in ctx.selected_objects if o.type == 'MESH' and o.data]
        if not obs:
            self.report({'ERROR'}, "请先选中要归并的部件对象（3D 视图里点选）")
            return {'CANCELLED'}
        bones = _target_bones(tgt)
        if props.fallback and props.fallback not in bones:
            self.report({'WARNING'}, "兜底骨 %s 不在目标骨架上，已忽略" % props.fallback)
        wm = ctx.window_manager
        wm.progress_begin(0, 100)
        lines = []
        for k, ob in enumerate(obs):
            me = ob.data
            gname = [vg.name for vg in ob.vertex_groups]
            per = []
            for v in me.vertices:
                d = {}
                for g in v.groups:
                    nm = gname[g.group]
                    if nm in bones and not nm.startswith("mmd_") and g.weight > 0:
                        d[nm] = d.get(nm, 0.0) + g.weight
                per.append(d)
            kept = sum(1 for d in per if d)
            need = [i for i, d in enumerate(per) if not d]
            filled = 0
            if need and props.fill_body and props.target_body is not None and props.target_body.data:
                body = props.target_body
                kd = _build_kd(body)
                bme = body.data
                bg = [vg.name for vg in body.vertex_groups]
                mw = ob.matrix_world
                for i in need:
                    co = mw @ me.vertices[i].co
                    hits = [h for h in kd.find_n(co, 3) if h[2] is not None and h[2] < 0.06]
                    acc = {}
                    for pos, bi, dist in hits:
                        w = 1.0 / max(1e-4, dist)
                        for g in bme.vertices[bi].groups:
                            nm = bg[g.group]
                            if nm in bones and not nm.startswith("mmd_") and g.weight > 0:
                                acc[nm] = acc.get(nm, 0.0) + g.weight * w
                    if acc:
                        per[i] = acc
                        filled += 1
            nfb = 0
            if props.fallback and props.fallback in bones:
                for i, d in enumerate(per):
                    if not d:
                        per[i] = {props.fallback: 1.0}
                        nfb += 1
            for d in per:
                t = sum(d.values())
                if t > 0:
                    for kk in d:
                        d[kk] /= t
            ob.vertex_groups.clear()
            gm = {}
            for i, d in enumerate(per):
                for nm, w in d.items():
                    if nm not in gm:
                        gm[nm] = ob.vertex_groups.new(name=nm)
                    gm[nm].add([i], w, 'REPLACE')
            _tidy_material(ob, props.prefix, props.merge_copy_mat, props.merge_dbl)
            if props.bind:
                ob.parent = tgt
                ob.matrix_parent_inverse = tgt.matrix_world.inverted()
                am = next((m for m in ob.modifiers if m.type == 'ARMATURE'), None)
                if am is None:
                    am = ob.modifiers.new("mmd_armature", "ARMATURE")
                am.object = tgt
                try:
                    idx = [i for i, m in enumerate(ob.modifiers) if m.type == 'ARMATURE'][0]
                    if idx != len(ob.modifiers) - 1:
                        ob.modifiers.move(idx, len(ob.modifiers) - 1)
                except Exception:
                    pass
            ws = [ob.matrix_world @ v.co for v in me.vertices]
            lines.append("%s: 点%d 保留骨%d组 补权%d 兜底%d | 骨 %s | 材质 %s | z[%.3f,%.3f]" % (
                ob.name, len(me.vertices), len(gm), filled, nfb,
                ",".join(sorted(gm.keys())[:5]), ",".join(m.name for m in ob.data.materials if m)[:40],
                min(p.z for p in ws), max(p.z for p in ws)))
            wm.progress_update(int(100 * (k + 1) / len(obs)))
        wm.progress_end()
        for L in lines:
            print("[归并] " + L)
        self.report({'INFO'}, "归并完成 %d 个对象 → %s（详见控制台）" % (len(obs), tgt.name))
        return {'FINISHED'}


class PE_OT_measure(Operator):
    bl_idname = "pe.measure"
    bl_label = "测量与目标身体的贴合度"
    bl_description = "量选中对象到「目标身体」的最近距离（min/中位/max），判断缩放对位是否合适"
    bl_options = {'REGISTER'}

    def execute(self, ctx):
        props = ctx.scene.pe
        body = props.target_body
        if body is None or body.data is None:
            self.report({'ERROR'}, "请先指定「目标身体」")
            return {'CANCELLED'}
        obs = [o for o in ctx.selected_objects if o.type == 'MESH' and o.data]
        if not obs:
            self.report({'ERROR'}, "请先选中要测量的部件")
            return {'CANCELLED'}
        wm = ctx.window_manager
        wm.progress_begin(0, 100)
        kd = _build_kd(body)
        for k, ob in enumerate(obs):
            mw = ob.matrix_world
            ds = []
            for v in ob.data.vertices:
                pos, idx, dist = kd.find(mw @ v.co)
                if dist is not None:
                    ds.append(dist)
            ds.sort()
            if not ds:
                continue
            n = len(ds)
            print("[贴合] %s: 点%d 最小%.1fmm 中位%.1fmm 90%%%.1fmm 最大%.1fmm 质心x%.3f z%.3f" % (
                ob.name, n, ds[0] * 1000, ds[n // 2] * 1000, ds[int(n * 0.9)] * 1000, ds[-1] * 1000,
                sum((ob.matrix_world @ v.co).x for v in ob.data.vertices) / max(1, n),
                sum((ob.matrix_world @ v.co).z for v in ob.data.vertices) / max(1, n)))
            wm.progress_update(int(100 * (k + 1) / len(obs)))
        wm.progress_end()
        self.report({'INFO'}, "贴合度已打印到控制台（窗口 → 切换系统控制台）")
        return {'FINISHED'}


class PE_OT_manifest(Operator):
    bl_idname = "pe.manifest"
    bl_label = "导出部件清单(给桌宠)"
    bl_description = "把挂在「目标骨架」下的所有部件及其材质导出为 JSON，供桌宠 PART_TREE 使用"
    bl_options = {'REGISTER'}

    def execute(self, ctx):
        props = ctx.scene.pe
        tgt = props.target_arm
        path = DEFAULT_MANIFEST
        try:
            if bpy.data.filepath:
                path = os.path.join(os.path.dirname(bpy.data.filepath), "parts_manifest.json")
        except Exception:
            pass
        items = []
        for ob in bpy.data.objects:
            if ob.type != 'MESH' or ob.data is None:
                continue
            if tgt is not None and ob.parent is not tgt:
                continue
            mats = []
            for m in ob.data.materials:
                if m is None:
                    continue
                mats.append({
                    "name": m.name,
                    "name_j": getattr(getattr(m, "mmd_material", None), "name_j", ""),
                    "double": bool(getattr(getattr(m, "mmd_material", None), "is_double_sided", False)),
                    "faces": sum(1 for p in ob.data.polygons
                                 if p.material_index < len(ob.data.materials)
                                 and ob.data.materials[p.material_index] is m),
                })
            if mats:
                items.append({"object": ob.name, "faces": len(ob.data.polygons), "materials": mats})
        data = {"time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "blend": bpy.data.filepath, "target_arm": tgt.name if tgt else "",
                "parts": items}
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            self.report({'INFO'}, "已导出 %d 个部件 → %s" % (len(items), path))
            print("[清单] %s" % path)
            for it in items:
                print("   %-24s %6d面  %s" % (it["object"], it["faces"],
                                              [m["name_j"] or m["name"] for m in it["materials"]]))
        except Exception as e:
            self.report({'ERROR'}, "写文件失败：%s" % e)
            return {'CANCELLED'}
        return {'FINISHED'}


# ================================================================ 导出 PMX
class PE_OT_export(Operator):
    bl_idname = "pe.export_pmx"
    bl_label = "检查并导出 PMX"
    bl_description = "体检 → 统一贴图到 tex/ → 选中模型成员（可含物理）→ 用 MMD 正确参数导出 PMX"
    bl_options = {'REGISTER'}

    def _resolve_path(self, props, arm):
        p = (props.exp_path or "").strip()
        if p:
            return bpy.path.abspath(p)
        base = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
        modeldir = os.path.join(base, "model")
        # ① 优先沿用 model/ 里已有的 PMX（工作流就是覆盖它）
        try:
            if os.path.isdir(modeldir):
                pms = [f for f in os.listdir(modeldir) if f.lower().endswith('.pmx')]
                if pms:
                    pms.sort(key=lambda f: os.path.getmtime(os.path.join(modeldir, f)), reverse=True)
                    return os.path.join(modeldir, pms[0])
        except Exception:
            pass
        # ② 否则用 mmd 根对象名 / 骨架名
        name = None
        try:
            if arm.parent is not None and getattr(arm.parent, 'mmd_root', None):
                name = arm.parent.name
        except Exception:
            pass
        if not name:
            name = arm.name.replace('_arm', '') or "model"
        return os.path.join(modeldir, name + ".pmx")

    def execute(self, ctx):
        props = ctx.scene.pe
        arm = props.target_arm
        if arm is None or arm.type != 'ARMATURE':
            self.report({'ERROR'}, "请先指定「目标骨架」")
            return {'CANCELLED'}
        meshes = [o for o in arm.children if o.type == 'MESH']
        if not meshes:
            self.report({'ERROR'}, "目标骨架下没有网格部件")
            return {'CANCELLED'}
        out = self._resolve_path(props, arm)
        texdir = os.path.join(os.path.dirname(out), "tex")
        wm = ctx.window_manager
        wm.progress_begin(0, 100)
        log = []

        # ① 体检
        if props.exp_check:
            bad_mod = [o.name for o in meshes
                       if not any(m.type == 'ARMATURE' and m.object is arm for m in o.modifiers)]
            now = [(o.name, sum(1 for v in o.data.vertices if not v.groups))
                   for o in meshes if any(not v.groups for v in o.data.vertices)]
            nonana = []
            bones = _target_bones(arm)
            for o in meshes:
                gn = [vg.name for vg in o.vertex_groups]
                for v in o.data.vertices:
                    for g in v.groups:
                        if gn[g.group] not in bones and not gn[g.group].startswith('mmd_') and g.weight > 0:
                            nonana.append((o.name, gn[g.group]))
                            break
            # ★ v1.3 新增：权重和 ≠ 1 的部件（MMD 蒙皮要求每点权重和 = 1，
            #   否则桌宠里顶点会被原点拖拽 → 部件散开/变形；Blender 里看不出来）
            bad_sum = []
            for o in meshes:
                gn2 = [vg.name for vg in o.vertex_groups]
                nb = 0
                for v in o.data.vertices:
                    s = sum(g.weight for g in v.groups if not gn2[g.group].startswith('mmd_'))
                    if abs(s - 1.0) > 0.001:
                        nb += 1
                if nb:
                    bad_sum.append((o.name, nb))
            log.append("体检: 部件 %d | 缺骨架修改器 %d | 有漏权重点 %d | 有非本骨架权重 %d | 权重和≠1 %d" % (
                len(meshes), len(bad_mod), len(now), len(nonana), len(bad_sum)))
            for r, nb in bad_sum:
                log.append("   ⚠️ %s 有 %d 个点权重和≠1（桌宠里会变形，需归一化）" % (r, nb))
            for r in bad_mod:
                log.append("   ⚠️ %s 没有指向 %s 的骨架修改器" % (r, arm.name))
            for r in now:
                log.append("   ⚠️ %s 有 %d 个顶点没权重" % r)
            for r in nonana[:6]:
                log.append("   ⚠️ %s 用了非本骨架的骨: %s" % r)
        wm.progress_update(25)

        # ② 统一贴图
        if props.exp_unify_tex:
            ch, cp, ms = _unify_textures(texdir, do_copy=True)
            log.append("贴图: 统一路径 %d 处 | 复制 %d 个文件 | 找不到 %d 张（目录 %s）" % (ch, cp, ms, texdir))
        wm.progress_update(45)

        # ③ 选中
        prev_active = ctx.view_layer.objects.active
        prev_sel = [o for o in ctx.selected_objects]
        try:
            if ctx.object and ctx.object.mode != 'OBJECT':
                bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.object.select_all(action='DESELECT')
        except Exception:
            pass
        cnt = 0
        for o in meshes:
            o.select_set(True)
            cnt += 1
        arm.select_set(True)
        cnt += 1
        if props.exp_physics:
            phys = 0
            for c in bpy.data.collections:
                if c.name.startswith('RigidBody'):
                    for o in c.objects:
                        o.select_set(True)
                        cnt += 1
                        phys += 1
            log.append("物理: 已选 %d 个刚体/关节" % phys)
        ctx.view_layer.objects.active = arm
        wm.progress_update(60)

        # ④ 导出
        try:
            res = bpy.ops.mmd_tools.export_pmx(
                filepath=out,
                scale=props.exp_scale,
                copy_textures_mode=props.exp_copy_mode,
                sort_materials=False,
                visible_meshes_only=props.exp_visible_only,
                save_log=False,
                check_existing=False)
        except Exception as e:
            wm.progress_end()
            log.append("导出失败: %s" % e)
            print("\n".join(log))
            self.report({'ERROR'}, "导出失败：%s" % e)
            return {'CANCELLED'}
        wm.progress_update(95)
        wm.progress_end()

        # ⑤ 还原选择
        try:
            bpy.ops.object.select_all(action='DESELECT')
            for o in prev_sel:
                if o.name in bpy.data.objects:
                    o.select_set(True)
            if prev_active and prev_active.name in bpy.data.objects:
                ctx.view_layer.objects.active = prev_active
        except Exception:
            pass

        ok = os.path.exists(out)
        size = os.path.getsize(out) if ok else 0
        log.append("导出: %s | %s | %s 字节 | 选中 %d 个对象" % (
            res, out, size, cnt))
        try:
            files = sorted(os.listdir(os.path.dirname(out)))
            log.append("目录内容: %s" % files)
        except Exception:
            pass
        props.exp_report = " | ".join(log[-3:])
        for L in log:
            print("[导出] " + L)
        self.report({'INFO'}, "导出%s：%s（%.2f MB）" % ('成功' if ok else '异常', out, size / 1048576.0))
        return {'FINISHED'}


# ================================================================ 面板
# ================================================================ 接物理（v1.3）
_PHYS_PAT = re.compile(r'^(.*?)_(\d+)_(\d+)(?:\.([LRlr]))?$')


def _phys_bone_map(arm):
    """{骨名: '1'/'2'} —— 挂了 DYNAMIC（type 1/2）刚体的骨 = 物理驱动骨（“马达”）"""
    dyn = {}
    for c in bpy.data.collections:
        if 'RigidBody' not in c.name:
            continue
        for o in c.objects:
            pg = getattr(o, 'mmd_rigid', None)
            if pg is None:
                continue
            b = (getattr(pg, 'bone', '') or '').strip()
            t = str(getattr(pg, 'type', ''))
            if b and t in ('1', '2'):
                dyn[b] = t
    return dyn


def _circle_center(pts):
    """最小二乘拟合圆心（Kåsa 法）→ 裙摆骨的“中轴”横截面"""
    n = len(pts)
    if n < 3:
        return (sum(p[0] for p in pts) / max(1, n), sum(p[1] for p in pts) / max(1, n))
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    syy = sum(p[1] * p[1] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    sq = [p[0] * p[0] + p[1] * p[1] for p in pts]
    sxz = sum(p[0] * q for p, q in zip(pts, sq))
    syz = sum(p[1] * q for p, q in zip(pts, sq))
    sz = sum(sq)
    A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
    Bo = [-sxz, -syz, -sz]

    def det3(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))

    d0 = det3(A)
    if abs(d0) < 1e-12:
        return (sx / n, sy / n)
    D = det3([[Bo[0], A[0][1], A[0][2]], [Bo[1], A[1][1], A[1][2]], [Bo[2], A[2][1], A[2][2]]]) / d0
    E = det3([[A[0][0], Bo[0], A[0][2]], [A[1][0], Bo[1], A[1][2]], [A[2][0], Bo[2], A[2][2]]]) / d0
    return (-D / 2.0, -E / 2.0)


def _skirt_table(arm, dyn, prefix):
    """解析「前缀_环_扇区」家族 → (前缀, {环:{z,L,R}}, 中轴(x,y), 提示)"""
    fam = {}
    for b in arm.data.bones:
        if b.name not in dyn:
            continue
        m = _PHYS_PAT.match(b.name)
        if m:
            fam.setdefault(m.group(1), []).append(b)
    if not fam:
        return None, None, None, "没有「前缀_环_扇区」命名的物理骨家族（请改用通用模式）"
    pre = (prefix or "").strip() or max(fam, key=lambda k: len(fam[k]))
    if pre not in fam:
        return None, None, None, "骨家族「%s」不存在；可用：%s" % (pre, ", ".join(sorted(fam)[:6]))
    raw = {}
    for b in fam[pre]:
        m = _PHYS_PAT.match(b.name)
        r, s, side = int(m.group(2)), int(m.group(3)), (m.group(4) or '').upper()
        h = b.head_local
        d = raw.setdefault(r, {'pts': [], 'z': [], 'C': None, 'L': [], 'R': []})
        d['pts'].append((h.x, h.y))
        d['z'].append(h.z)
        if s == 0:
            d['C'] = b.name
        elif side in ('L', 'R'):
            d[side].append((s, b.name, h.x, h.y))
    cen = [_circle_center(d['pts']) for d in raw.values()]
    ax = (sum(c[0] for c in cen) / len(cen), sum(c[1] for c in cen) / len(cen))
    tbl = {}
    for r, d in raw.items():
        if d['C'] is None:
            cand = [(abs(math.degrees(math.atan2(x - ax[0], -(y - ax[1])))), nm)
                    for sd in ('L', 'R') for _, nm, x, y in d[sd]]
            d['C'] = min(cand)[1] if cand else sorted(dyn)[0]
        for sd in ('L', 'R'):
            lst = sorted((abs(math.degrees(math.atan2(x - ax[0], -(y - ax[1])))), nm)
                         for _, nm, x, y in d[sd])
            d[sd] = [(0.0, d['C'])] + lst
        tbl[r] = {'z': sum(d['z']) / len(d['z']), 'L': d['L'], 'R': d['R']}
    nsec = len(tbl[min(tbl)]['L'])
    return pre, tbl, ax, "家族 %s：%d 环 × %d 扇区（中轴 x%.3f y%.3f）" % (pre, len(tbl), nsec, ax[0], ax[1])


def _ring_blend(z, zs):
    if z >= zs[0][1]:
        return [(zs[0][0], 1.0)]
    if z <= zs[-1][1]:
        return [(zs[-1][0], 1.0)]
    for i in range(len(zs) - 1):
        r0, z0 = zs[i]
        r1, z1 = zs[i + 1]
        if z1 <= z <= z0:
            t = (z0 - z) / max(1e-6, z0 - z1)
            return [(r0, 1.0 - t), (r1, t)]
    return [(zs[-1][0], 1.0)]


def _sec_blend(a_deg, side, lst_l, lst_r):
    lst = lst_l if side == 'L' else lst_r
    aa = abs(a_deg)
    if aa >= lst[-1][0]:
        w = (aa - lst[-1][0]) / max(1e-6, 180.0 - lst[-1][0])
        other = (lst_r if side == 'L' else lst_l)[-1][1]
        return [(lst[-1][1], 1.0 - 0.5 * w), (other, 0.5 * w)]
    for i in range(len(lst) - 1):
        a0, n0 = lst[i]
        a1, n1 = lst[i + 1]
        if a0 <= aa <= a1:
            t = (aa - a0) / max(1e-6, a1 - a0)
            return [(n0, 1.0 - t), (n1, t)]
    return [(lst[-1][1], 1.0)]


def _seg_dist(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


def _phys_pct(ob, dyn):
    """该对象权重里落在物理驱动骨上的百分比"""
    gn = [vg.name for vg in ob.vertex_groups]
    tot = ph = 0.0
    for v in ob.data.vertices:
        for g in v.groups:
            nm = gn[g.group]
            if nm.startswith('mmd_'):
                continue
            tot += g.weight
            if nm in dyn:
                ph += g.weight
    return 100.0 * ph / max(1e-9, tot)


class PE_OT_bindphys(Operator):
    bl_idname = "pe.bindphys"
    bl_label = "接物理（权重 → 物理骨）"
    bl_description = ("把选中部件的权重接到目标模型的【物理驱动骨】上，让它们跟着裙子/头发一起飘\n"
                      "（只改选中部件的权重；目标模型本身不动）")
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, ctx):
        P = ctx.scene.pe
        arm = P.target_arm
        if arm is None or arm.type != 'ARMATURE':
            self.report({'ERROR'}, "请先指定「目标骨架」")
            return {'CANCELLED'}
        obs = [o for o in ctx.selected_objects if o.type == 'MESH' and o.data]
        if not obs:
            self.report({'ERROR'}, "请先选中要接物理的部件（3D 视图里点选）")
            return {'CANCELLED'}
        dyn = _phys_bone_map(arm)
        if not dyn:
            self.report({'ERROR'}, "目标模型没有物理驱动骨（刚体是否都是 Static？）")
            return {'CANCELLED'}
        note = ""
        tbl = pre = None
        bg = None
        kd = None
        if P.phys_mode == 'SKIRT':
            pre, tbl, ax, note = _skirt_table(arm, dyn, P.phys_family)
            if tbl is None:
                self.report({'ERROR'}, note)
                return {'CANCELLED'}
            zs = sorted([(r, tbl[r]['z']) for r in tbl], key=lambda kv: -kv[1])
        else:
            bg = []
            for nm in sorted(dyn):
                b = arm.data.bones.get(nm)
                if b is None:
                    continue
                h = arm.matrix_world @ b.head_local
                t = arm.matrix_world @ b.tail_local
                bg.append((nm, h, t, (h + t) / 2.0))
            if not bg:
                self.report({'ERROR'}, "物理骨的坐标取不到")
                return {'CANCELLED'}
            kd = kdtree.KDTree(len(bg))
            for i, it in enumerate(bg):
                kd.insert(it[3], i)
            kd.balance()
            note = "通用模式：%d 根物理骨，每点取最近 %d 根（衰减 %.3f m）" % (len(bg), P.phys_k, P.phys_falloff)
        # —— 备份原权重 ——
        if P.phys_backup:
            bl = bpy.data.filepath or ""
            d = os.path.join(os.path.dirname(bl) if bl else os.getcwd(), "_backup")
            try:
                os.makedirs(d, exist_ok=True)
                fp = os.path.join(d, "_rollback_接物理_%s.json" % time.strftime("%Y%m%d_%H%M%S"))
                snap = {}
                for ob in obs:
                    gn0 = [vg.name for vg in ob.vertex_groups]
                    snap[ob.name] = {'groups': gn0,
                                     'verts': [dict((gn0[g.group], round(g.weight, 5)) for g in v.groups)
                                               for v in ob.data.vertices]}
                json.dump(snap, open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
                print("[接物理] 原权重备份 → %s" % fp)
            except Exception as e:
                print("[接物理] 备份失败（继续跑）：%s" % e)
        wm = ctx.window_manager
        wm.progress_begin(0, 100)
        lines = []
        for k, ob in enumerate(obs):
            me = ob.data
            gn = [vg.name for vg in ob.vertex_groups]
            p0 = _phys_pct(ob, dyn)
            mw = ob.matrix_world
            nfar = 0
            neww = []
            for v in me.vertices:
                co = mw @ v.co
                acc = {}
                if P.phys_mode == 'SKIRT':
                    a = math.degrees(math.atan2(co.x - ax[0], -(co.y - ax[1])))
                    side = 'L' if a >= 0 else 'R'
                    for r, wr in _ring_blend(co.z, zs):
                        if wr <= 0:
                            continue
                        for nm, ws in _sec_blend(a, side, tbl[r]['L'], tbl[r]['R']):
                            acc[nm] = acc.get(nm, 0.0) + wr * ws
                else:
                    near = []
                    for pos, idx, dist in kd.find_n(co, 12):
                        nm, h, t, mid = bg[idx]
                        near.append((_seg_dist(co, h, t), nm))
                    near.sort()
                    near = near[:P.phys_k]
                    if near:
                        dmin = near[0][0]
                        for dd, nm in near:
                            acc[nm] = acc.get(nm, 0.0) + math.exp(-(dd - dmin) / max(1e-4, P.phys_falloff))
                        if dmin > P.phys_falloff * 4.0:
                            nfar += 1
                    else:
                        nfar += 1
                for g in v.groups:                      # 保留 mmd_* 辅助组 ✅
                    if gn[g.group].startswith('mmd_'):
                        acc[gn[g.group]] = g.weight
                tot = sum(w for kk, w in acc.items() if not kk.startswith('mmd_'))
                if tot > 0:
                    for kk in list(acc):
                        if not kk.startswith('mmd_'):
                            acc[kk] /= tot
                neww.append(acc)
            ob.vertex_groups.clear()
            gm = {}
            for i, d in enumerate(neww):
                for nm, w in d.items():
                    if nm not in gm:
                        gm[nm] = ob.vertex_groups.new(name=nm)
                    gm[nm].add([i], w, 'REPLACE')
            p1 = _phys_pct(ob, dyn)
            wxs = [mw @ v.co for v in me.vertices]
            lines.append("%s: 点%d | 物理 %.1f%% → %.1f%% | 骨%d组 | z[%.3f,%.3f]%s" % (
                ob.name, len(me.vertices), p0, p1, len(gm),
                min(p.z for p in wxs), max(p.z for p in wxs),
                (" | ⚠️%d点离物理骨远" % nfar) if nfar else ""))
            wm.progress_update(int(100 * (k + 1) / len(obs)))
        wm.progress_end()
        for L in lines:
            print("[接物理] " + L)
        P.phys_report = (lines[0][:78] if lines else "") + "  |  " + note[:60]
        self.report({'INFO'}, "接物理完成 %d 个对象（详见控制台）" % len(obs))
        return {'FINISHED'}


# ================================================================ 镜像姿态（v1.4）
# 左 ↔ 右 镜像 —— 用「骨架空间镜像矩阵 S@M@S」，而不是复制局部数值
#   ★ 为什么不能复制数值：本模型的 臂.L / 臂.R 静息坐标轴（roll）并不是镜像对称的 ✗
#     ⇒ 无论"自己写 rot=(x,-y,-z)"还是 Blender 自带的「粘贴翻转」，大臂都会错
#        （实测镜像差 0.24~0.26 ✗，肉眼可见）
#   ★ 正确做法：在【骨架空间】把源骨姿态矩阵关于 YZ 平面镜像（S @ M @ S）
#     再交给 Blender 反算目标骨的骨内数值 —— 它会自动吃掉"两侧骨轴不同" ✓
#     （实测 188 对，肩/臂/肘/腿/膝/踝/脚尖 镜像差全部 0.0000 ✓）
#   ★ 必须【父骨先于子骨】：设置 pose.matrix 依赖父骨已就位
class PE_OT_mirrorpose(Operator):
    bl_idname = "pe.mirrorpose"
    bl_label = "镜像姿态（左↔右）"
    bl_description = "把一侧骨骼的姿态镜像到另一侧（按骨架空间镜像，两侧骨轴不一致也能对上）"
    bl_options = {'REGISTER', 'UNDO'}

    direction: EnumProperty(
        name="方向",
        items=(('L2R', "左 → 右", "把 .L 侧姿态镜像到 .R 侧"),
               ('R2L', "右 → 左", "把 .R 侧姿态镜像到 .L 侧")),
        default='L2R')

    def execute(self, ctx):
        from mathutils import Matrix
        arm = None
        for o in ctx.selected_objects:
            if o.type == 'ARMATURE':
                arm = o
                break
        if arm is None and ctx.object is not None and ctx.object.type == 'ARMATURE':
            arm = ctx.object
        if arm is None:
            arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
            if len(arms) == 1:
                arm = arms[0]
        if arm is None:
            self.report({'ERROR'}, "找不到骨架：请先在 3D 视图选中骨架对象")
            return {'CANCELLED'}

        src_suf, dst_suf = ('.L', '.R') if self.direction == 'L2R' else ('.R', '.L')
        S = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))       # 关于 YZ 平面镜像（x → -x）

        pairs = []
        for pb in arm.pose.bones:
            if pb.name.endswith(src_suf):
                dst = arm.pose.bones.get(pb.name[:-2] + dst_suf)
                if dst is not None:
                    pairs.append((pb, dst))

        def depth(pb):
            d, p = 0, pb.parent
            while p:
                d += 1
                p = p.parent
            return d

        pairs.sort(key=lambda pr: depth(pr[0]))          # ★ 父骨先于子骨
        n = 0
        for src, dst in pairs:
            dst.matrix = S @ src.matrix @ S
            ctx.view_layer.update()
            n += 1
        print("【镜像姿态】%s → %s：%d 对 ✓（骨架空间镜像 S@M@S + 父骨先于子骨）"
              % (src_suf, dst_suf, n))
        self.report({'INFO'}, "镜像 %d 对骨骼 ✓（看控制台）" % n)
        return {'FINISHED'}


class PE_PT_mirrorpose(Panel):
    bl_label = "镜像姿态（左 ↔ 右）"
    bl_idname = "PE_PT_mirrorpose"
    bl_parent_id = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, ctx):
        L = self.layout
        col = L.column(align=True)
        col.label(text="先在 3D 视图选中骨架：", icon='ARMATURE_DATA')
        row = col.row()
        row.scale_y = 1.6
        row.operator("pe.mirrorpose", text="左 → 右", icon='BONE_DATA').direction = 'L2R'
        row = col.row()
        row.scale_y = 1.4
        row.operator("pe.mirrorpose", text="右 → 左", icon='BONE_DATA').direction = 'R2L'
        L.separator()
        for line in ("【为什么不是复制数值】",
                     "本模型 臂.L / 臂.R 的静息坐标轴",
                     "并不镜像对称 ⇒ 复制数值（含 Blender",
                     "自带「粘贴翻转」）大臂会错 ✗",
                     "本工具在【骨架空间】镜像矩阵，",
                     "两侧骨轴不同也能对上 ✓",
                     "【验收】控制台报镜像对数；",
                     "差别大时可再按一次反方向。",
                     "★ 改完记得 Ctrl+S："):
            L.label(text=line)


class PE_PT_main(Panel):
    bl_label = "部件快速提取"
    bl_idname = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"

    def draw(self, ctx):
        L = self.layout
        P = ctx.scene.pe
        L.prop(P, "src", text="源对象")
        row = L.row(align=True)
        row.operator("pe.scan", icon='VIEWZOOM')
        row.operator("pe.sel_nonzero", text="只选有面")
        if P.count == 0:
            L.label(text="↑ 先点「扫描材质」", icon='INFO')
        else:
            box = L.box()
            box.label(text="勾选要提取的材质（面数 / 高度）：")
            for it in P.mats:
                if it.faces == 0:
                    continue
                row = box.row(align=True)
                row.prop(it, "use", text="")
                row.label(text="%s" % (it.name[:18],))
                row.label(text="%d面" % it.faces)
                row.label(text="z%.2f~%.2f" % (it.zmin, it.zmax))
            row = L.row(align=True)
            row.operator("pe.all")
            row.operator("pe.none")
        L.separator()
        L.prop(P, "prefix", text="名称前缀")
        L.prop(P, "per_mat")
        L.prop(P, "copy_mat")
        L.prop(P, "dbl")
        L.prop(P, "hide_src")
        L.separator()
        row = L.row()
        row.scale_y = 1.6
        row.operator("pe.extract", icon='DUPLICATE')


class PE_PT_merge(Panel):
    bl_label = "归并到目标模型"
    bl_idname = "PE_PT_merge"
    bl_parent_id = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"

    def draw(self, ctx):
        L = self.layout
        P = ctx.scene.pe
        L.prop(P, "target_arm", text="目标骨架")
        L.prop(P, "target_body", text="目标身体")
        L.separator()
        L.prop(P, "reweight")
        L.prop(P, "fill_body")
        L.prop(P, "fallback", text="兜底骨")
        L.prop(P, "bind")
        L.prop(P, "merge_copy_mat")
        L.prop(P, "merge_dbl")
        L.separator()
        col = L.column(align=True)
        col.label(text="先选中要归并的部件（可多选）：", icon='RESTRICT_SELECT_OFF')
        row = col.row()
        row.scale_y = 1.6
        row.operator("pe.merge", icon='LINKED')
        row = col.row(align=True)
        row.operator("pe.measure", icon='DRIVER_DISTANCE')
        row.operator("pe.manifest", icon='EXPORT')


class PE_PT_export(Panel):
    bl_label = "导出 PMX（一键）"
    bl_idname = "PE_PT_export"
    bl_parent_id = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"

    def draw(self, ctx):
        L = self.layout
        P = ctx.scene.pe
        L.prop(P, "target_arm", text="模型骨架")
        L.prop(P, "exp_path", text="导出到")
        L.label(text="（留空 = <blend目录>/model/<模型名>.pmx）")
        L.separator()
        L.prop(P, "exp_unify_tex")
        L.prop(P, "exp_physics")
        L.prop(P, "exp_check")
        L.prop(P, "exp_visible_only")
        L.prop(P, "exp_scale", text="缩放")
        L.prop(P, "exp_copy_mode", text="贴图复制")
        L.separator()
        row = L.row()
        row.scale_y = 1.6
        row.operator("pe.export_pmx", icon='FILE_TICK')
        if P.exp_report:
            box = L.box()
            box.label(text="上次导出：")
            box.label(text=P.exp_report[:60])
        L.label(text="导出前建议先 Ctrl+S 存盘", icon='INFO')


class PE_PT_phys(Panel):
    bl_label = "接物理（让部件跟着飘）"
    bl_idname = "PE_PT_phys"
    bl_parent_id = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, ctx):
        L = self.layout
        P = ctx.scene.pe
        L.prop(P, "target_arm", text="目标骨架")
        L.prop(P, "phys_mode", text="接法")
        if P.phys_mode == 'SKIRT':
            L.prop(P, "phys_family", text="骨家族前缀")
            L.label(text="留空 = 自动检测（如 裙摆_0_0）", icon='INFO')
        else:
            L.prop(P, "phys_k")
            L.prop(P, "phys_falloff")
        L.prop(P, "phys_backup")
        L.separator()
        col = L.column(align=True)
        col.label(text="先在 3D 视图选中要接的部件：", icon='RESTRICT_SELECT_OFF')
        row = col.row()
        row.scale_y = 1.6
        row.operator("pe.bindphys", icon='PHYSICS')
        if P.phys_report:
            box = L.box()
            box.label(text="上次：%s" % P.phys_report[:70])
        L.separator()
        for line in ("【原理】刚体 = 马达，权重 = 接线；",
                     "部件的线没接到物理骨上就不会飘，",
                     "导出再多次也没用。",
                     "· 裙子 →「环×角度」接到裙摆骨",
                     "· 头发/披风/袖饰 →「最近物理骨」",
                     "【验收】看控制台「物理 x% → y%」，",
                     "y 明显变大（如 0%→80%）就对了。"):
            L.label(text=line)


class PE_PT_help(Panel):
    bl_label = "使用说明"
    bl_idname = "PE_PT_help"
    bl_parent_id = "PE_PT_main"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "部件提取"
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, ctx):
        L = self.layout
        col = L.column(align=False)
        for line in (
            "【1 拆件】",
            "· 源对象 = 要拆的大模型（如青雀本体）",
            "· 点「扫描材质」→ 列表按面数/高度认件",
            "· 勾选要的材质（可多选）→「提取选中材质」",
            "· 原对象永不被改；新对象继承父级/修改器",
            "",
            "【2 归并到你的模型】",
            "· 目标骨架 = 你的模型骨架（如纳西妲_arm）",
            "· 目标身体 = 你的模型身体网格（补权重用）",
            "· 3D 视图里选中拆出的部件 →「归并选中对象」",
            "· 权重按同名骨搬运；对不上的骨丢弃后",
            "  从目标身体最近点补；再不行绑兜底骨",
            "",
            "【3 对位检查】",
            "· 「测量与目标身体的贴合度」→ 控制台看",
            "  min/中位/max 距离（贴近 5~20mm 最好）",
            "",
            "【4 接物理（让部件跟着飘）】",
            "· 物理靠骨骼驱动：刚体 = 马达，权重 = 接线",
            "  权重没接到物理骨上 → 导出再多次也不飘",
            "· 3D 视图选中要接的部件 → 选接法 → 点按钮",
            "  · 裙子：环×角度（自动找裙摆骨家族）",
            "  · 头发 / 披风 / 袖饰：最近物理骨",
            "· 控制台打印「物理 x% → y%」，y 变大就对了",
            "· 原权重自动备份到 <blend目录>\\_backup\\",
            "",
            "【5 一键导出 PMX】",
            "· 模型骨架 = 你的模型骨架",
            "· 「统一贴图到 tex/」= 把材质里的贴图相对",
            "  路径全改成 tex/<文件名>，缺的自动复制过去",
            "  （桌宠按 tex/ 找图，路径乱会白模）",
            "· 「含物理」= 头发/裙子会飘；不要就取消",
            "· 点「检查并导出 PMX」，结果打印在控制台",
            "",
            "【6 桌宠侧】",
            "· 材质名 = 桌宠开关名，先改名再导出",
            "· 「导出部件清单」→ parts_manifest.json",
            "  （交给 Hermes 改 js/settings/20-parts.js 的 PART_TREE）",
            "",
            "【提示】",
            "· 布料单面时勾「自动设为双面」",
            "· 几十万面的模型：会有进度条，等它跑完",
            "· 导出前建议 Ctrl+S；改完记得再存盘",
        ):
            col.label(text=line)


_classes = (PE_Item, PE_Props, PE_OT_scan, PE_OT_all, PE_OT_none, PE_OT_sel_nonzero,
            PE_OT_extract, PE_OT_merge, PE_OT_measure, PE_OT_manifest, PE_OT_export,
            PE_OT_bindphys, PE_OT_mirrorpose, PE_PT_main, PE_PT_mirrorpose,
            PE_PT_merge, PE_PT_export, PE_PT_phys, PE_PT_help)


def register():
    for c in _classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.pe = PointerProperty(type=PE_Props)


def unregister():
    try:
        del bpy.types.Scene.pe
    except Exception:
        pass
    for c in reversed(_classes):
        try:
            bpy.utils.unregister_class(c)
        except Exception:
            pass


if __name__ == "__main__":
    register()
