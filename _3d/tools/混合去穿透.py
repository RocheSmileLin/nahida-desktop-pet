# -*- coding: utf-8 -*-
"""混合去穿透：体积球粗筛（宽相位）+ 精确 BVH（细相位）→ 量出"每帧查询数"判断运行时可行性

用法:
  blender -b <model.blend> --python 混合去穿透.py -- --vmd motion/x.vmd [--foot-ik 1|0] [--grant 1|0]
       --caps caps_fill.json [--margin 0.03] [--out report.json]
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
CAPS = opt('--caps')
MARGIN = float(opt('--margin', '0.03'))
OUT = opt('--out')
ITER = int(opt('--iter', '6'))
MIN_DEPTH = 0.002
BODY_RE = re.compile(r'^(肌|body_|feet_)')


def ev(obj, dg, mats=False):
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    mw = eo.matrix_world
    vs = [mw @ v.co for v in me.vertices]
    ps = [list(p.vertices) for p in me.polygons]
    mm = None
    if mats:
        slot = [m.name if m else '' for m in me.materials]
        mm = [slot[p.material_index] if p.material_index < len(slot) else '' for p in me.polygons]
    eo.to_mesh_clear()
    return vs, ps, mm


def main():
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = bpy.data.objects[BODY]
    scn = bpy.context.scene
    spheres = json.load(open(CAPS, encoding='utf-8')) if CAPS else []
    print('载入球体: %d 个' % len(spheres))

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
    for pb in arm.pose.bones:
        for c in pb.constraints:
            nm = c.name or ''
            if (c.type == 'IK' or nm == 'mmd_ik_target_override') and not FOOT_IK:
                c.mute = True
            if nm in ('mmd_tools_at_dummy', 'mmd_additional_rotation') and not GRANT:
                c.mute = True
    f0, f1 = [int(x) for x in act.frame_range] if act else (scn.frame_start, scn.frame_end)
    frames = sorted({f0, (f0 + f1) // 2, f1})
    garments = [bpy.data.objects[n] for n in GAR.split(',') if n in bpy.data.objects]
    print('动作 %s 帧 %s' % (act.name if act else '（无）', frames))

    # ---------- 自建【保守】填充球（必须 rest pose 下拟合 ✓；宁多勿漏 ✓） ----------
    #   要点：半径取该骨"沿轴切片内表面顶点的【最大值】"✓（90分位会留缝 ✗ ⇒ 深层穿模漏检 ✗）
    #        每骨 9 档 ✓；半径上限 8cm（防离群点炸出巨球 ✗）
    saved_basis = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    scn.frame_set(scn.frame_start)
    dg0 = bpy.context.evaluated_depsgraph_get()
    rverts, rpolys, rmats = ev(body, dg0, mats=True)
    keep = set()
    for p, m in zip(rpolys, rmats):
        if BODY_RE.search(m or ''):
            keep.update(p)
    mo = body.evaluated_get(dg0)
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
    per = {}
    for vi in sorted(keep):
        if vi in owner:
            per.setdefault(owner[vi], []).append(rverts[vi])
    spheres = []
    for bn, pts in per.items():
        pb = arm.pose.bones.get(bn)
        if pb is None or len(pts) < 20:
            continue
        h = arm.matrix_world @ pb.head
        t = arm.matrix_world @ pb.tail
        L = (t - h).length
        if L < 0.008:
            r = min(max((p - h).length for p in pts), 0.08)
            spheres.append({'bone': bn, 'x': h.x, 'y': h.y, 'z': h.z, 'r': r})
            continue
        axis = (t - h).normalized()
        for k in range(9):
            tk = (k + 0.5) / 9.0
            c = h + (t - h) * tk
            near = [p for p in pts if abs((p - h).dot(axis) - tk * L) < L * 0.6]
            if len(near) < 4:
                continue
            r = min(max((p - c).length for p in near), 0.08)
            spheres.append({'bone': bn, 'x': c.x, 'y': c.y, 'z': c.z, 'r': max(r, 0.01)})
    print('保守填充球: %d 个（骨轴 9 档 × 最大半径 ≤8cm）' % len(spheres))
    # 恢复姿态
    for pb in arm.pose.bones:
        if pb.name in saved_basis:
            pb.matrix_basis = saved_basis[pb.name]
    if act is not None and arm.animation_data:
        arm.animation_data.action = act

    report = {'action': act.name if act else None, 'margin': MARGIN, 'spheres': len(spheres),
              'frames': []}
    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys_all, bmats = ev(body, dg, mats=True)
        bpolys = [p for p, m in zip(bpolys_all, bmats) if BODY_RE.search(m or '')]
        bvh = BVHTree.FromPolygons(bverts, bpolys, all_triangles=False)
        # 球心随骨骼；同时只用"体积填充球"（球心在身体内部 ✓）
        #   表层壳球的球心贴在表面、球体向外鼓 30mm ✗ → 会造出大量假候选 ✓
        cen = []
        for s in spheres:
            pb = arm.pose.bones.get(s['bone'])
            if pb is None:
                continue
            m = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()
            c = m @ Vector((s['x'], s['y'], s['z']))
            loc, nor, idx, dist = bvh.find_nearest(c)
            if loc is not None and (c - loc).dot(nor) > 0.03:
                continue                     # 球心明显在体外(>3cm) ⇒ 丢掉（保守球要留 ✓）
            cen.append((c, s['r']))
        frec = {'frame': fr, 'garments': []}
        print('\n--- 帧 %d | 球 %d ---' % (fr, len(cen)))
        total_q = total_v = 0
        for g in garments:
            gverts, _, _ = ev(g, dg)

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
            # ① 粗筛：只看"贴近身体"的顶点（宽相位）
            #   ⚠️ 先把与本件衣服无关的球裁掉（否则 534 球全测 = 又慢又宽 ✓）
            gc = Vector((sum(v.x for v in gverts) / len(gverts),
                         sum(v.y for v in gverts) / len(gverts),
                         sum(v.z for v in gverts) / len(gverts)))
            span = max((v - gc).length for v in gverts)
            cen_g = [(c, r) for c, r in cen if (c - gc).length <= span + 0.08]
            cand = []
            for i, co in enumerate(gverts):
                for c, r in cen_g:
                    if (co - c).length_squared < (r + MARGIN) ** 2:
                        cand.append(i)
                        break
            # ② 细相位：只对候选做精确 BVH 推出
            fixed = list(gverts)
            q = 0
            for i in cand:
                p = Vector(gverts[i])
                for _ in range(ITER):
                    loc, nor, idx, dist = bvh.find_nearest(p)
                    if loc is None:
                        break
                    q += 1
                    if (p - loc).dot(nor) < 0:
                        p = loc + nor * 0.0015
                    else:
                        break
                fixed[i] = p
            n1, m1 = measure(fixed)
            total_q += q
            total_v += len(gverts)
            rec = {'garment': g.name, 'verts': len(gverts), 'candidates': len(cand),
                   'bvh_queries': q, 'before': n0, 'before_mm': round(m0 * 1000, 1),
                   'after': n1, 'after_mm': round(m1 * 1000, 1)}
            frec['garments'].append(rec)
            print('  %-12s 顶点%5d 候选%5d(%4.1f%%) 查询%6d | 穿模 %4d(%.1fmm) → %4d(%.1fmm) %s'
                  % (g.name, len(gverts), len(cand), 100.0 * len(cand) / len(gverts), q,
                     n0, m0 * 1000, n1, m1 * 1000, '✅' if n1 == 0 else '⚠️'))
        frec['total_queries'] = total_q
        frec['total_verts'] = total_v
        print('  合计: 顶点 %d | 候选查询 %d（%.1f%%）' % (total_v, total_q, 100.0 * total_q / max(total_v, 1)))
        report['frames'].append(frec)

    if OUT:
        json.dump(report, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n报告: %s' % OUT)
    print('（未修改也未保存 .blend ✓）')


main()
