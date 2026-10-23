# -*- coding: utf-8 -*-
"""碰撞点云：离线为每件衣服的每个顶点挂 K 个体表参考点（含骨骼绑定+法线），运行时按骨骼变换后推出

用法:
  blender -b <model.blend> --python 碰撞点云.py -- --vmd motion/x.vmd [--foot-ik 1|0] [--grant 1|0]
       [--k 16] [--outcloud cloud.json] [--out report.json] [--iter 6]

为什么不用球体：球是凸的 ✗，而裙子重灾区（胯下/腿间）是凹的 ⇒ 凸代理必然失效 ✓（已实测 ✗）
点云 = 直接贴在真实表面上 ✓ 凹区也正确 ✓；运行时代价与 16 个球相同 ✓
"""
import bpy
import json
import os
import re
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(n, d=None):
    if n in argv:
        i = argv.index(n)
        return argv[i + 1] if i + 1 < len(argv) else d
    return d


BODY = opt('--body', '纳西妲_13_主体')
GAR = opt('--garments', '纳西妲_12_连衣裙,格子裙,百褶裙,吊带')
VMD = opt('--vmd')
FOOT_IK = opt('--foot-ik', '1') != '0'
GRANT = opt('--grant', '1') != '0'
K = int(opt('--k', '16'))
ITER = int(opt('--iter', '6'))
CLOUD_OUT = opt('--outcloud')
OUT = opt('--out')
MIN_DEPTH = 0.002
BODY_RE = re.compile(opt('--body-materials', r'^(肌|body_|feet_)'))


def eval_data(obj, dg, want_mats=False, want_normals=False, want_parts=False):
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    mw = eo.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    nrm = None
    if want_normals:
        # 法线用矩阵的旋转部分变换（只关心方向）
        rot = mw.to_3x3()
        nrm = [(rot @ v.normal).normalized() for v in me.vertices]
    parts = None
    if want_parts:
        vgs = obj.vertex_groups
        parts = []
        for v in me.vertices:
            best, bw = None, -1.0
            for g in v.groups:
                nm = vgs[g.group].name
                if nm.startswith('mmd_'):
                    continue
                if g.weight > bw:
                    best, bw = nm, g.weight
            parts.append(best or '(无)')
    mats = None
    if want_mats:
        slot = [m.name if m else '' for m in me.materials]
        mats = [slot[p.material_index] if p.material_index < len(slot) else '' for p in me.polygons]
    eo.to_mesh_clear()
    return verts, polys, parts, mats, nrm


def apply_toggles(arm, foot_ik, grant):
    for pb in arm.pose.bones:
        for c in pb.constraints:
            nm = c.name or ''
            if (c.type == 'IK' or nm == 'mmd_ik_target_override') and not foot_ik:
                c.mute = True
            if nm in ('mmd_tools_at_dummy', 'mmd_additional_rotation') and not grant:
                c.mute = True


def delta_matrix(arm, pb):
    """把绑定姿态(rest)世界坐标映射到当前帧世界坐标"""
    return arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()


def main():
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = bpy.data.objects[BODY]
    scn = bpy.context.scene

    if VMD:
        for o in list(bpy.context.selected_objects):
            o.select_set(False)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.mmd_tools.import_vmd(filepath=VMD)
        print('导入动作: %s' % os.path.basename(VMD))
    act = arm.animation_data.action if (arm.animation_data and arm.animation_data.action) else None
    if act is None and bpy.data.actions:
        act = bpy.data.actions[0]
    if act is not None:
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = act
    apply_toggles(arm, FOOT_IK, GRANT)
    f0, f1 = [int(x) for x in act.frame_range] if act else (scn.frame_start, scn.frame_end)
    frames = sorted({f0, (f0 + f1) // 2, f1})
    garments = [bpy.data.objects[n] for n in GAR.split(',') if n in bpy.data.objects]
    print('动作 %s 帧 %s | K=%d' % (act.name if act else '（无）', frames, K))

    # ---------- ① 绑定姿态下拟合点云 ----------
    saved_basis = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    scn.frame_set(scn.frame_start)
    dg = bpy.context.evaluated_depsgraph_get()
    bverts, bpolys, _, bmats, bnrm = eval_data(body, dg, want_mats=True, want_normals=True)
    keep = set()
    for p, m in zip(bpolys, bmats):
        if BODY_RE.search(m or ''):
            keep.update(p)
    mo = body.evaluated_get(dg)
    me = mo.to_mesh()
    vgs = body.vertex_groups
    owner = {}
    for vi in sorted(keep):
        best, bw = None, -1.0
        for g in me.vertices[vi].groups:
            nm = vgs[g.group].name
            if nm.startswith('mmd_'):
                continue
            if g.weight > bw:
                best, bw = nm, g.weight
        if best:
            owner[vi] = best
    mo.to_mesh_clear()
    surf = sorted(vi for vi in keep if vi in owner)
    print('体表参考顶点: %d（全部带骨骼绑定 ✓）' % len(surf))
    kd = KDTree(len(surf))
    for j, vi in enumerate(surf):
        kd.insert(bverts[vi], j)
    kd.balance()

    # ---------- ② 每件衣服每顶点挂 K 个参考点 ----------
    cloud = {}          # garment -> (per-vertex [{p:[x,y,z], n:[x,y,z], b:bone}, ...])
    for g in garments:
        gverts, _, _, _, _ = eval_data(g, dg)
        rows = []
        for p in gverts:
            hs = kd.find_n(p, K)
            rows.append([{'p': [round(c.x, 5), round(c.y, 5), round(c.z, 5)],
                          'n': [round(bnrm[surf[j]].x, 4), round(bnrm[surf[j]].y, 4), round(bnrm[surf[j]].z, 4)],
                          'b': owner[surf[j]]} for (c, j, d) in hs])
        cloud[g.name] = rows
    print('点云: %s' % {k: '%d 顶点 × %d 点' % (len(v), K) for k, v in cloud.items()})
    if CLOUD_OUT:
        json.dump(cloud, open(CLOUD_OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('点云文件: %s (%.2f MB)' % (CLOUD_OUT, os.path.getsize(CLOUD_OUT) / 1048576.0))

    # 恢复姿态
    for pb in arm.pose.bones:
        if pb.name in saved_basis:
            pb.matrix_basis = saved_basis[pb.name]
    if act is not None and arm.animation_data:
        arm.animation_data.action = act

    # ---------- ③ 逐帧：用点云推出 + 重新量测 ----------
    report = {'action': act.name if act else None, 'K': K, 'frames': []}
    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys_all, _, bmats, _ = eval_data(body, dg, want_mats=True)
        bpolys = [p for p, m in zip(bpolys_all, bmats) if BODY_RE.search(m or '')]
        bvh = BVHTree.FromPolygons(bverts, bpolys, all_triangles=False)
        # 各骨骼的当前 delta 矩阵（带缓存）
        dm = {}
        for pb in arm.pose.bones:
            dm[pb.name] = delta_matrix(arm, pb)
        frec = {'frame': fr, 'garments': []}
        print('\n--- 帧 %d ---' % fr)
        for g in garments:
            gverts, _, _, _, _ = eval_data(g, dg)

            def measure(vs):
                n = 0
                mx = 0.0
                for co in vs:
                    loc, nor, idx, dist = bvh.find_nearest(co)
                    if loc is None:
                        continue
                    if (co - loc).dot(nor) < 0 and MIN_DEPTH <= dist <= 0.05:
                        n += 1
                        mx = max(mx, dist)
                return n, mx
            n0, m0 = measure(gverts)
            # 点云变换到当前帧
            pts = []
            for row in cloud[g.name]:
                cp = []
                for e in row:
                    m = dm.get(e['b'])
                    if m is None:
                        continue
                    cp.append((m @ Vector(e['p']), (m.to_3x3() @ Vector(e['n'])).normalized()))
                pts.append(cp)
            fixed = []
            for i, co in enumerate(gverts):
                p = Vector(co)
                for _ in range(ITER):
                    moved = False
                    for (c, n) in pts[i]:
                        if (p - c).dot(n) < 0:
                            p = c + n * 0.0015
                            moved = True
                    if not moved:
                        break
                fixed.append(p)
            n1, m1 = measure(fixed)
            rec = {'garment': g.name, 'before': n0, 'before_mm': round(m0 * 1000, 1),
                   'after': n1, 'after_mm': round(m1 * 1000, 1)}
            frec['garments'].append(rec)
            print('  %-12s 穿模 %4d(%.1fmm) → %4d(%.1fmm)  %s'
                  % (g.name, n0, m0 * 1000, n1, m1 * 1000, '✅ 清零' if n1 == 0 else '⚠️仍有'))
        report['frames'].append(frec)

    if OUT:
        json.dump(report, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n报告: %s' % OUT)
    print('（未修改也未保存 .blend ✓）')


main()
