# -*- coding: utf-8 -*-
"""穿模体检（L2 检测器）—— 全本地、无头、只读（不保存 .blend）

用法:
  blender -b <model.blend> --python 穿模体检.py -- [选项]

选项:
  --vmd PATH         直接导入某个 .vmd 当姿态（自动选中骨架 ✓）
  --action NAME      用文件里已有的动作（找不到就报错，不静默回退 ✗）
  --frames 0,15,30   指定帧（默认在动作范围内均匀取 3 帧）
  --body NAME        碰撞体（默认 纳西妲_13_主体）
  --garments A,B     待测衣服（默认自动挑）
  --depth 0.002      判定穿模的最小深度（米）
  --out PATH         报告 JSON 路径
  --render DIR       出图目录（把穿模顶点标红渲染；不填则不出图）
  --views 3          出图视角数（1=四分之三视角；2=再加侧视）

输出: 每件衣服的 穿模顶点数 / 最大深度 / 平均深度 / 按骨骼组归类的部位分布
"""
import bpy
import json
import os
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else default
    return default


BODY = opt('--body', '纳西妲_13_主体')
GAR = opt('--garments')
OUT = opt('--out')
RENDER_DIR = opt('--render')
VIEWS = int(opt('--views', '1'))
MIN_DEPTH = float(opt('--depth', '0.002'))
FOOT_IK = opt('--foot-ik', '1') != '0'      # 桌宠：ik:true ⇒ 关足IK ⇒ 传 --foot-ik 0
GRANT = opt('--grant', '1') != '0'          # 桌宠：noGrant:true ⇒ 传 --grant 0
import re as _re
BODY_MATS = opt('--body-materials', r'^(肌|body_|feet_)')   # 身体材质（碰撞体只取这些面）
BODY_MAT_RE = _re.compile(BODY_MATS)
ACT_NAME = opt('--action')
VMD = opt('--vmd')
FRAMES = opt('--frames')

AUTO_SKIP = ('主体', '素体', '足.L', '足.R', '踝饰', '脚环')


def eval_data(obj, dg, want_parts=False, want_mats=False):
    """求值后的顶点(世界坐标) + 面 + 每顶点主导骨骼组 + 每面材质名"""
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
            parts.append(best or '(无骨骼组)')
    mats = None
    if want_mats:
        slot = [m.name if m else '' for m in me.materials]
        mats = [slot[p.material_index] if p.material_index < len(slot) else '' for p in me.polygons]
    eo.to_mesh_clear()
    return verts, polys, parts, mats


def apply_toggles(arm, foot_ik, grant):
    """按桌宠的运行时开关设置 Blender 约束（motions.js: ik:true=关足IK / noGrant:true=关付与）
    ★ 不做这步 ⇒ 姿势与桌宠不一致（多叠一层付与会把腿带到别处 ✗）"""
    n_ik = n_gr = 0
    for pb in arm.pose.bones:
        for c in pb.constraints:
            nm = c.name or ''
            if (c.type == 'IK' or nm == 'mmd_ik_target_override') and not foot_ik:
                c.mute = True
                n_ik += 1
            if nm in ('mmd_tools_at_dummy', 'mmd_additional_rotation') and not grant:
                c.mute = True
                n_gr += 1
    print('  开关: 足IK=%s(静音 %d 个) 付与=%s(静音 %d 个)' % ('开' if foot_ik else '关', n_ik,
                                                              '开' if grant else '关', n_gr))


def make_markers(name, points, size):
    """把一堆点做成小方块标记（红色自发光）—— 用于出图"""
    me = bpy.data.meshes.new(name)
    vs, fs = [], []
    s = size
    for p in points:
        b = len(vs)
        for dx in (-s, s):
            for dy in (-s, s):
                for dz in (-s, s):
                    vs.append((p.x + dx, p.y + dy, p.z + dz))
        fs += [(b + 0, b + 1, b + 3, b + 2), (b + 4, b + 6, b + 7, b + 5),
               (b + 0, b + 4, b + 5, b + 1), (b + 2, b + 3, b + 7, b + 6),
               (b + 0, b + 2, b + 6, b + 4), (b + 1, b + 5, b + 7, b + 3)]
    me.from_pydata(vs, [], fs)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(name + '_mat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1, 0.05, 0.05, 1)
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (1, 0, 0, 1)
            bsdf.inputs['Emission Strength'].default_value = 3.0
    ob.data.materials.append(mat)
    return ob


def setup_camera(target_center, radius, angle_deg, res=(760, 1000)):
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.new('体检相机')
    cam = bpy.data.objects.new('体检相机', cam_data)
    scn.collection.objects.link(cam)
    import math
    a = math.radians(angle_deg)
    cam.location = (target_center.x + radius * math.sin(a),
                    target_center.y - radius * math.cos(a),
                    target_center.z + radius * 0.15)
    d = target_center - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = 50
    scn.camera = cam
    scn.render.resolution_x, scn.render.resolution_y = res
    sun_d = bpy.data.lights.new('体检灯', type='SUN')
    sun_d.energy = 4.0
    sun = bpy.data.objects.new('体检灯', sun_d)
    scn.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    return [cam, sun]


def main():
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = bpy.data.objects.get(BODY)
    if body is None:
        print('✗ 找不到碰撞体: %s' % BODY)
        print('  候选:', [o.name for o in bpy.data.objects if o.type == 'MESH' and len(o.vertex_groups) > 0][:20])
        return

    if GAR:
        gnames = [g.strip() for g in GAR.split(',') if g.strip()]
    else:
        gnames = [o.name for o in bpy.data.objects if o.type == 'MESH'
                  and len(o.vertex_groups) > 0 and not any(k in o.name for k in AUTO_SKIP)]
    garments = [bpy.data.objects[n] for n in gnames if n in bpy.data.objects]
    print('碰撞体: %s | 待测: %s' % (BODY, [g.name for g in garments]))

    scn = bpy.context.scene

    # ---- 姿态 ----
    if VMD:
        if not os.path.exists(VMD):
            print('✗ 找不到 vmd: %s' % VMD)
            return
        for o in list(bpy.context.selected_objects):
            o.select_set(False)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.mmd_tools.import_vmd(filepath=VMD)   # ★ 按选中对象决定导入什么
        print('已导入动作: %s' % os.path.basename(VMD))

    act = arm.animation_data.action if (arm.animation_data and arm.animation_data.action) else None
    if ACT_NAME:
        found = bpy.data.actions.get(ACT_NAME)
        if found is None:
            print('✗ 指定动作不存在: %s | 文件里: %s' % (ACT_NAME, [a.name for a in bpy.data.actions][:12]))
            return
        act = found
    if act is None and bpy.data.actions:
        act = bpy.data.actions[0]
        print('⚠️ 未指定动作，回退到 %s（%s）' % (act.name, tuple(act.frame_range)))
    if act is not None:
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = act     # ★ 必须真赋值

    if act:
        f0, f1 = [int(x) for x in act.frame_range]
    else:
        f0, f1 = scn.frame_start, scn.frame_end
    frames = [int(x) for x in FRAMES.split(',')] if FRAMES else sorted({f0, (f0 + f1) // 2, f1})
    print('动作: %s | 帧: %s' % (act.name if act else '（无）', frames))

    report = {'action': act.name if act else None, 'body': BODY, 'min_depth': MIN_DEPTH,
              'foot_ik': FOOT_IK, 'grant': GRANT, 'frames': frames, 'results': []}
    apply_toggles(arm, FOOT_IK, GRANT)     # ★ 与桌宠运行时开关对齐
    marker_pts = []
    center = None

    for fr in frames:
        scn.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        bverts, bpolys_all, _, bmats = eval_data(body, dg, want_mats=True)
        # ★ 碰撞体只用【身体材质】的面：排除头发/脸部/自带衣饰的薄壳
        #   （否则"藏在本体衣饰/头发里面"会被误判成穿模 ⇒ 数字虚高 ✗）
        bpolys = [p for p, m in zip(bpolys_all, bmats) if BODY_MAT_RE.search(m or '')]
        if fr == frames[0]:
            print('  碰撞体面: %d / %d（材质 %s）' % (len(bpolys), len(bpolys_all),
                  sorted({m for m in bmats if BODY_MAT_RE.search(m or '')})))
        if center is None:
            xs = [v.x for v in bverts]; ys = [v.y for v in bverts]; zs = [v.z for v in bverts]
            center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
            radius = max(max(xs) - min(xs), max(zs) - min(zs)) * 2.4
        bvh = BVHTree.FromPolygons(bverts, bpolys, all_triangles=False)
        print('\n--- 帧 %d | 碰撞体 %d 顶点 %d 面 ---' % (fr, len(bverts), len(bpolys)))

        for g in garments:
            gverts, _, parts, _ = eval_data(g, dg, want_parts=True)
            hits = []
            deep = []                       # ★ 超过 MAX_DEEP 的"深埋"顶点单独归类
            MAX_DEEP = 0.05                 # 5cm：正常穿模不会这么深，多半是"落在未采样区域"
            for i, co in enumerate(gverts):
                loc, nor, idx, dist = bvh.find_nearest(co)
                if loc is None:
                    continue
                if (co - loc).dot(nor) < 0 and dist >= MIN_DEPTH:
                    (hits if dist <= MAX_DEEP else deep).append((i, dist, parts[i] if parts else '?'))
            rec = {'garment': g.name, 'frame': fr, 'count': len(hits)}
            if deep:
                rec['deep_suspect'] = {
                    'count': len(deep),
                    'max_mm': round(max(d for _, d, _ in deep) * 1000, 1),
                    'parts': sorted({p for _, _, p in deep})[:5],
                }
            if hits:
                by_part = {}
                for _, d, grp in hits:
                    by_part[grp] = by_part.get(grp, 0) + 1
                rec.update({
                    'max_depth_mm': round(max(d for _, d, _ in hits) * 1000, 2),
                    'mean_depth_mm': round(sum(d for _, d, _ in hits) / len(hits) * 1000, 2),
                    'by_part': dict(sorted(by_part.items(), key=lambda kv: -kv[1])[:8]),
                    'worst_verts': [{'i': i, 'mm': round(d * 1000, 2), 'part': p}
                                    for i, d, p in sorted(hits, key=lambda x: -x[1])[:10]],
                })
                if RENDER_DIR:
                    marker_pts += [gverts[i] for i, d, _ in sorted(hits, key=lambda x: -x[1])[:400]]
                print('  [穿] %-12s 顶点 %4d | 最深 %7.2fmm | 平均 %6.2fmm | 部位 %s'
                      % (g.name, rec['count'], rec['max_depth_mm'], rec['mean_depth_mm'],
                         list(rec['by_part'].items())[:4]))
                if deep:
                    print('       ⚠️ 另有 %d 个深埋顶点(>50mm, 最大 %.0fmm, 部位 %s) — 疑为未采样区域'
                          % (len(deep), rec['deep_suspect']['max_mm'], rec['deep_suspect']['parts']))
            else:
                print('  [OK] %-12s 干净（>%gmm）%s' % (g.name, MIN_DEPTH,
                      (' ⚠️深埋 %d 个' % len(deep)) if deep else ''))
            report['results'].append(rec)

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        print('\n报告: %s' % OUT)

    # ---- 出图 ----
    if RENDER_DIR and center is not None:
        os.makedirs(RENDER_DIR, exist_ok=True)
        extra = []
        if marker_pts:
            extra.append(make_markers('体检标记', marker_pts, radius * 0.006))
        scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
            [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else scn.render.engine
        scn.render.film_transparent = False
        tag = os.path.splitext(os.path.basename(VMD))[0] if VMD else (act.name if act else 'pose')
        for i in range(VIEWS):
            ang = 25 if VIEWS == 1 else (0 + i * 90)
            cam_objs = setup_camera(center, radius, ang)
            out_png = os.path.join(RENDER_DIR, '%s_v%d.png' % (tag, i))
            scn.render.filepath = out_png
            bpy.ops.render.render(write_still=True)
            print('出图: %s' % out_png)
            for o in cam_objs:
                bpy.data.objects.remove(o, do_unlink=True)
        for o in extra:
            bpy.data.objects.remove(o, do_unlink=True)

    print('\n（体检结束：未修改也未保存 .blend ✓）')


main()
