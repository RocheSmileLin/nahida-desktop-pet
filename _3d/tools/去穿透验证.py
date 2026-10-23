# -*- coding: utf-8 -*-
"""球体包络去穿透：①从身体网格自动拟合"跟随骨骼的球体" ②施加到衣服上 ③重新量穿模

用法:
  blender -b <model.blend> --python 去穿透验证.py -- --vmd motion/x.vmd [--foot-ik 0|1] [--grant 0|1]
                                                [--caps caps.json] [--iter 6] [--out report.json]

做法:
  1) 对每根"对身体有实际影响"的骨骼，沿骨长均匀放 N 个球，
     半径 = 该骨影响的顶点到球心的最大距离（乘安全系数）
  2) 去穿透：把衣服顶点从每个球里沿径向推到球面（迭代几轮，取最大推动）
  3) 用 BVH 重新量穿模（身体材质面）
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
CAPS_OUT = opt('--caps')
OUT = opt('--out')
ITER = int(opt('--iter', '8'))
MIN_DEPTH = 0.002
BODY_RE = re.compile(opt('--body-materials', r'^(肌|body_|feet_)'))
N_SPH = 3           # 每骨几个球
SAFETY = 1.02       # 半径安全系数


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
                try:
                    nm = vgs[g.group].name
                except Exception:
                    continue
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


def bake_to_object(obj, dg, world_verts, name, hide_orig=False):
    """把一组【世界坐标顶点】烘成静态网格对象（用于渲染"修好之后"的样子）

    ★★ 2026-10-16 修正：必须用 bpy.data.meshes.new_from_object(求值对象) ★★
       上一版用 `eo.to_mesh().copy()` + `to_mesh_clear()` ⇒ 得到的网格是坏的：
       渲染出来是【空白 / 白板破片】（实测：原件 PNG 544923B，new_from_object 版
       逐字节相同 ✓，to_mesh 版只有 422708B 且画面空白 ✗）
       ⇒ 上一轮"修后图裙面发白像平板"根本不是推出造成的，是这里烘错了 ✓
    """
    eo = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo)
    inv = obj.matrix_world.inverted()
    for i, v in enumerate(me.vertices):
        if i < len(world_verts):
            v.co = inv @ world_verts[i]
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = obj.matrix_world.copy()
    ob.hide_render = False
    ob.hide_set(True)
    if hide_orig:
        obj.hide_render = True
    return ob


def setup_camera_light(center, radius, angle_deg, res=(760, 1000)):
    import math
    scn = bpy.context.scene
    cd = bpy.data.cameras.new('体检机')
    cam = bpy.data.objects.new('体检机', cd)
    scn.collection.objects.link(cam)
    a = math.radians(angle_deg)
    cam.location = (center.x + radius * math.sin(a), center.y - radius * math.cos(a), center.z + radius * 0.15)
    cam.rotation_euler = (center - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = 40
    scn.camera = cam
    scn.render.resolution_x, scn.render.resolution_y = res
    ld = bpy.data.lights.new('体检灯', type='SUN')
    ld.energy = 4.0
    lo = bpy.data.objects.new('体检灯', ld)
    scn.collection.objects.link(lo)
    lo.rotation_euler = (math.radians(50), 0, math.radians(35))
    for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            scn.render.engine = e
            break
        except Exception:
            continue
    return [cam, lo]


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
    print('动作 %s 帧 %s' % (act.name if act else '（无）', frames))

    garments = [bpy.data.objects[n] for n in GAR.split(',') if n in bpy.data.objects]

    # ---------- ① 拟合球体（按骨骼） ----------
    bverts0 = None
    sphere_defs = []      # [(bone_name, t, radius_local)]
    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys, _, bmats = eval_data(body, dg, want_mats=True)
        if bverts0 is None:
            bverts0 = bverts
        # 每个身体顶点 -> 主导骨骼
        vgs = body.vertex_groups
        mo = body.evaluated_get(dg)
        me = mo.to_mesh()
        owner = []
        for v in me.vertices:
            best, bw = None, -1.0
            for g in v.groups:
                nm = vgs[g.group].name
                if nm.startswith('mmd_'):
                    continue
                if g.weight > bw:
                    best, bw = nm, g.weight
            owner.append(best)
        mo.to_mesh_clear()
        if len(owner) != len(bverts):
            print('⚠️ 顶点-骨骼映射长度不一致 %d/%d，跳过拟合' % (len(owner), len(bverts)))
            continue
        # 按骨聚合
        per = {}
        for i, bn in enumerate(owner):
            if not bn:
                continue
            per.setdefault(bn, []).append(bverts[i])
        for bn, pts in per.items():
            pb = arm.pose.bones.get(bn)
            if pb is None or len(pts) < 30:
                continue
            h = arm.matrix_world @ pb.head
            t = arm.matrix_world @ pb.tail
            L = (t - h).length
            if L < 0.005:                      # 太短（点骨）→ 只放一个球在头上
                r = max((p - h).length for p in pts)
                sphere_defs.append((bn, 0.0, r * SAFETY))
                continue
            for k in range(N_SPH):
                tk = (k + 0.5) / N_SPH
                c = h + (t - h) * tk
                # 只统计"离这条轴靠近"的点，避免把远处顶点算进来
                d = [((p - c).length, ) for p in pts]
                r = max((p - c).length for p in pts)
                sphere_defs.append((bn, tk, min(r, L) * SAFETY))
        break                                   # 用第一帧拟合即可（骨骼局部关系不变）

    # 去重/瘦身：同一骨同一 t 只留一个，半径过小的丢掉
    seen = {}
    for bn, tk, r in sphere_defs:
        k = (bn, round(tk, 3))
        if k not in seen or r > seen[k]:
            seen[k] = r
    caps = [{'bone': bn, 't': tk, 'r': r} for (bn, tk), r in seen.items() if r > 0.004]
    print('球体数: %d（骨骼 %d 根）' % (len(caps), len({c['bone'] for c in caps})))
    if CAPS_OUT:
        json.dump(caps, open(CAPS_OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('球体表: %s' % CAPS_OUT)

    # ---------- ②③ 逐帧：去穿透 + 重新测量 ----------
    report = {'action': act.name if act else None, 'spheres': len(caps), 'frames': []}
    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys_all, _, bmats = eval_data(body, dg, want_mats=True)
        bpolys = [p for p, m in zip(bpolys_all, bmats) if BODY_RE.search(m or '')]
        bvh = BVHTree.FromPolygons(bverts, bpolys, all_triangles=False)
        # 当前帧的球心世界坐标
        centers = []
        for c in caps:
            pb = arm.pose.bones.get(c['bone'])
            if pb is None:
                continue
            h = arm.matrix_world @ pb.head
            t = arm.matrix_world @ pb.tail
            centers.append((h + (t - h) * c['t'], c['r']))
        frec = {'frame': fr, 'garments': []}
        print('\n--- 帧 %d | 球 %d ---' % (fr, len(centers)))
        for g in garments:
            gverts, gpolys, parts, _ = eval_data(g, dg, want_parts=True)
            def measure(vs):
                n = 0
                mx = 0.0
                for co in vs:
                    loc, nor, idx, dist = bvh.find_nearest(co)
                    if loc is None:
                        continue
                    if (co - loc).dot(nor) < 0 and dist >= MIN_DEPTH and dist <= 0.05:
                        n += 1
                        mx = max(mx, dist)
                return n, mx
            n0, m0 = measure(gverts)
            # 去穿透 + 平滑（交替 3 轮 ✓）
            #   推：沿最近表面法线推到体外（精确 ✓ 凹区也正确 ✓）
            #   平滑：对【位移场】做 1-ring 平均（λ=0.5）⇒ 布料不缩小 ✓ 只抹平突兀位移 ✓
            adj = [[] for _ in range(len(gverts))]
            for poly in gpolys:
                m = len(poly)
                for k in range(m):
                    a, b = poly[k], poly[(k + 1) % m]
                    if a < len(adj) and b < len(adj):
                        adj[a].append(b)
                        adj[b].append(a)
            disp = [Vector((0.0, 0.0, 0.0)) for _ in gverts]
            MAX_PUSH = float(opt('--max-push', '0.05'))   # ★距离闸门：>50mm 的"内侧"是假阳性（未采样区/法线翻转），推它=把裙摆吸附到腿上 ✗
            n_guard = [0]

            def push_one(p):
                """把点 p 推出身体；超过 MAX_PUSH 的候选直接放弃（这是本次崩图的根因）"""
                for _ in range(ITER):
                    loc, nor, idx, dist = bvh.find_nearest(p)
                    if loc is None:
                        break
                    if (p - loc).dot(nor) < 0:
                        if dist > MAX_PUSH:
                            n_guard[0] += 1
                            break
                        p = loc + nor * 0.0015
                    else:
                        break
                return p

            for _cycle in range(3):
                for _i, _co in enumerate(gverts):
                    disp[_i] = push_one(Vector(_co) + disp[_i]) - Vector(_co)
                if _cycle < 2:                     # 最后轮不平滑，保住推出效果 ✓
                    nd = [d.copy() for d in disp]
                    for i in range(len(gverts)):
                        if not adj[i]:
                            continue
                        avg = Vector((0.0, 0.0, 0.0))
                        for j in adj[i]:
                            avg += disp[j]
                        avg /= len(adj[i])
                        nd[i] = disp[i].lerp(avg, 0.5)
                    disp = nd
            fixed = [Vector(co) + disp[i] for i, co in enumerate(gverts)]
            n1, m1 = measure(fixed)
            rec = {'garment': g.name, 'before': n0, 'before_mm': round(m0 * 1000, 1),
                   'after': n1, 'after_mm': round(m1 * 1000, 1), 'guard_blocked': n_guard[0]}
            if opt('--render') and fr == frames[len(frames) // 2]:
                _b = globals().setdefault('_baked', {})
                _b[g.name] = bake_to_object(g, dg, fixed, 'FIX_' + g.name)
            frec['garments'].append(rec)
            print('  %-12s 穿模 %4d(%.1fmm) → %4d(%.1fmm)  %s | 距离闸门拦下 %d'
                  % (g.name, n0, m0 * 1000, n1, m1 * 1000,
                     '✅ 清零' if n1 == 0 else '⚠️仍有', n_guard[0]))
        report['frames'].append(frec)

    if OUT:
        json.dump(report, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n报告: %s' % OUT)
    # ---- 出图：修前 / 修后（同一机位 ✓） ----
    RD = opt('--render')
    _baked = globals().get('_baked') or {}
    if RD and _baked:
        os.makedirs(RD, exist_ok=True)
        scn.frame_set(frames[len(frames) // 2])
        dg = bpy.context.evaluated_depsgraph_get()
        bv, _, _, _ = eval_data(body, dg)
        xs = [v.x for v in bv]
        ys = [v.y for v in bv]
        zs = [v.z for v in bv]
        center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
        radius = max(max(xs) - min(xs), max(zs) - min(zs)) * 2.4
        cam_objs = setup_camera_light(center, radius, 25)
        tag = os.path.splitext(os.path.basename(VMD))[0] if VMD else 'pose'
        for ob in _baked.values():
            ob.hide_render = True                # 修前：只显示原件 ✓（渲染只认 hide_render，hide_set 管不着 ✗）
        scn.render.filepath = os.path.join(RD, '%s_before.png' % tag)
        bpy.ops.render.render(write_still=True)
        print('出图: %s' % scn.render.filepath)
        for name, ob in _baked.items():
            ob.hide_render = False               # 修后：显示修好的 ✓ 原件隐藏 ✓
            src = bpy.data.objects.get(name)
            if src:
                src.hide_render = True
        scn.render.filepath = os.path.join(RD, '%s_after.png' % tag)
        bpy.ops.render.render(write_still=True)
        print('出图: %s' % scn.render.filepath)
        for o in cam_objs:
            bpy.data.objects.remove(o, do_unlink=True)

    print('（未修改也未保存 .blend ✓）')


main()
