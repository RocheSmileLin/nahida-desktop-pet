# -*- coding: utf-8 -*-
"""球体代理（贴身体表面）+ 去穿透验证

思路：不在骨头上放球 ✗（凸包表达不了腿缝 ✗）
     而是在【身体表面】上贪心铺一层小球 ✓，每球归属最近的骨骼 ✓（跟随动画 ✓）
     运行时：顶点着色器里对"本件衣服附近的球"做推出 ✓（uniform 数组 ✓）

用法:
  blender -b <model.blend> --python 球体代理.py -- --vmd motion/x.vmd [--foot-ik 1|0] [--grant 1|0]
       [--radius 0.03] [--caps caps_cluster.json] [--garment-max 60] [--out report.json]
"""
import bpy
import json
import os
import re
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

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
R = float(opt('--radius', '0.03'))
GMAX = int(opt('--garment-max', '60'))
CAPS_OUT = opt('--caps')
OUT = opt('--out')
ITER = int(opt('--iter', '8'))
MIN_DEPTH = 0.002
BODY_RE = re.compile(opt('--body-materials', r'^(肌|body_|feet_)'))


def eval_data(obj, dg, want_parts=False, want_mats=False):
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    mw = eo.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
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
    return verts, polys, parts, mats


def apply_toggles(arm, foot_ik, grant):
    for pb in arm.pose.bones:
        for c in pb.constraints:
            nm = c.name or ''
            if (c.type == 'IK' or nm == 'mmd_ik_target_override') and not foot_ik:
                c.mute = True
            if nm in ('mmd_tools_at_dummy', 'mmd_additional_rotation') and not grant:
                c.mute = True


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
    print('动作 %s 帧 %s | 球半径 %.0fmm' % (act.name if act else '（无）', frames, R * 1000))

    # ---------- ① 在【身体表面】贪心铺球（只在身体材质面上采样） ----------
    # ★ 必须在绑定姿态(rest pose)下拟合：球心是世界空间的静止坐标，
    #   运行时再按骨骼变换带走 ✓（若在摆好姿势的身体上拟合 ⇒ 球心是瞬时姿态 ✗ 每帧会错位 ✗）
    saved_basis = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    saved_act = arm.animation_data.action if arm.animation_data else None
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    scn.frame_set(scn.frame_start)
    dg = bpy.context.evaluated_depsgraph_get()
    bverts, bpolys, _, bmats = eval_data(body, dg, want_mats=True)
    # 身体表面顶点集合（只取身体材质的面所引用的顶点）
    keep = set()
    for p, m in zip(bpolys, bmats):
        if BODY_RE.search(m or ''):
            keep.update(p)
    surf = [bverts[i] for i in sorted(keep)]
    print('身体表面顶点: %d' % len(surf))
    # 顶点 -> 主导骨骼
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

    # ---- ② 体积填充：沿骨轴放球，半径取该处【身体表面】的距离（90分位避开离群点） ----
    #  只有表层壳不够 ✗：深达 50mm 的穿模顶点不在任何球内 ⇒ 推不到 ✓
    #  但半径【不能】用"骨影响顶点的最大距离" ✗（那是我第一次失败的错 ✓）→ 用局部：
    #  只看球心所在"沿轴切片"内的表面顶点 ✓ 取 90 分位 ✓
    per_bone = {}
    for vi in sorted(keep):
        bn = owner.get(vi)
        if bn:
            per_bone.setdefault(bn, []).append(bverts[vi])
    n_fill = 0
    spheres = []                     # ★ 必须在填充前初始化（后面不能再 reset ✗）
    for bn, pts in per_bone.items():
        pb = arm.pose.bones.get(bn)
        if pb is None or len(pts) < 20:
            continue
        h = arm.matrix_world @ pb.head
        t = arm.matrix_world @ pb.tail
        L = (t - h).length
        if L < 0.008:
            r = max((p - h).length for p in pts)
            spheres.append({'bone': bn, 'x': h.x, 'y': h.y, 'z': h.z, 'r': max(r * 0.9, 0.008)})
            n_fill += 1
            continue
        axis = (t - h).normalized()
        for k in range(5):
            tk = (k + 0.5) / 5.0
            c = h + (t - h) * tk
            near = [p for p in pts if abs((p - h).dot(axis) - tk * L) < L * 0.25]
            if len(near) < 6:
                continue
            ds = sorted((p - c).length for p in near)
            r = ds[int(len(ds) * 0.9)]
            spheres.append({'bone': bn, 'x': c.x, 'y': c.y, 'z': c.z, 'r': max(r, 0.008)})
            n_fill += 1
    print('体积填充球: %d 个（骨轴 5 档 × 局部半径）' % n_fill)

    # 贪心覆盖：网格哈希加速
    import math
    cell = R * 2.0
    grid = {}
    for vi in sorted(keep):
        p = bverts[vi]
        grid.setdefault((int(p.x // cell), int(p.y // cell), int(p.z // cell)), []).append(vi)
    covered = set()
    for vi in sorted(keep):
        if vi in covered:
            continue
        c = bverts[vi]
        # 只查邻格（27 个）—— 避免 O(n²)（15k 顶点会卡死 ✗）
        kx, ky, kz = int(c.x // cell), int(c.y // cell), int(c.z // cell)
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cand.extend(grid.get((kx + dx, ky + dy, kz + dz), ()))
        hit = [w for w in cand if (bverts[w] - c).length <= R * 1.05]
        if len(hit) < 3:
            continue
        cnt = {}
        for w in hit:
            b = owner.get(w)
            if b:
                cnt[b] = cnt.get(b, 0) + 1
        bone = max(cnt.items(), key=lambda kv: kv[1])[0] if cnt else None
        if bone is None:
            continue
        maxd = max((bverts[w] - c).length for w in hit)
        spheres.append({'bone': bone, 'x': c.x, 'y': c.y, 'z': c.z, 'r': max(maxd, R * 0.6)})
        covered.update(hit)
    print('球体: %d 个（半径上限 %.0fmm，覆盖 %d/%d 顶点）'
          % (len(spheres), R * 1000, len(covered), len(keep)))
    if CAPS_OUT:
        json.dump(spheres, open(CAPS_OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('球体表: %s' % CAPS_OUT)

    # ---------- ② 逐帧验证 ----------
    # 恢复姿态与动作（拟合阶段改动过）
    for pb in arm.pose.bones:
        if pb.name in saved_basis:
            pb.matrix_basis = saved_basis[pb.name]
    if saved_act is not None and arm.animation_data:
        arm.animation_data.action = saved_act
    report = {'action': act.name if act else None, 'radius': R, 'spheres': len(spheres), 'frames': []}
    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys_all, _, bmats = eval_data(body, dg, want_mats=True)
        bpolys = [p for p, m in zip(bpolys_all, bmats) if BODY_RE.search(m or '')]
        bvh = BVHTree.FromPolygons(bverts, bpolys, all_triangles=False)
        # 球心随骨骼更新
        cen = []
        for s in spheres:
            pb = arm.pose.bones.get(s['bone'])
            if pb is None:
                continue
            # 球心相对骨骼的局部偏移 → 当前帧世界坐标
            m = arm.matrix_world @ pb.matrix @ (pb.bone.matrix_local.inverted())
            cen.append((m @ Vector((s['x'], s['y'], s['z'])), s['r'], s['bone']))
        frec = {'frame': fr, 'garments': []}
        print('\n--- 帧 %d | 球 %d ---' % (fr, len(cen)))
        for g in garments:
            gverts, _, parts, _ = eval_data(g, dg, want_parts=True)

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
            # 只用"离这件衣服最近"的球（运行时也这么做 ✓）
            gc = Vector((sum(v.x for v in gverts) / len(gverts), sum(v.y for v in gverts) / len(gverts),
                         sum(v.z for v in gverts) / len(gverts)))
            span = max((v - gc).length for v in gverts)
            use = [c for c in cen if (c[0] - gc).length <= span + 0.15]
            use = sorted(use, key=lambda c: (c[0] - gc).length)[:GMAX]
            fixed = []
            for co in gverts:
                p = Vector(co)
                for _ in range(ITER):
                    moved = False
                    for c, r, bn in use:
                        d = p - c
                        L = d.length
                        if L < r and L > 1e-9:
                            p = c + d * (r / L)
                            moved = True
                    if not moved:
                        break
                fixed.append(p)
            n1, m1 = measure(fixed)
            rec = {'garment': g.name, 'spheres_used': len(use), 'before': n0,
                   'before_mm': round(m0 * 1000, 1), 'after': n1, 'after_mm': round(m1 * 1000, 1)}
            frec['garments'].append(rec)
            print('  %-12s 球%3d | 穿模 %4d(%.1fmm) → %4d(%.1fmm)  %s'
                  % (g.name, len(use), n0, m0 * 1000, n1, m1 * 1000,
                     '✅ 清零' if n1 == 0 else '⚠️仍有'))
        report['frames'].append(frec)

    if OUT:
        json.dump(report, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n报告: %s' % OUT)
    print('（未修改也未保存 .blend ✓）')


main()
