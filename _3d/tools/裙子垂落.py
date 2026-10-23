# -*- coding: utf-8 -*-
"""让裙子自然垂落：接上「刚体 → 骨骼」的写回，跑物理 settle，出图

用法:
  blender -b <model.blend> --python 裙子垂落.py -- [--frames 0,30,60,120] [--render DIR] [--bone-prefix 裙摆_]

原理（MMD/three.js 内部就这么做的 ✓）:
  1) 静止时记下每个刚体相对其骨骼的偏移 off = body_rest_world @ (arm_world @ bone_rest_local)^-1
  2) 每帧：若刚体是【动态】型 → 骨骼 pose = (arm_world^-1 @ body_world) @ off^-1
  3) 【动态+骨】型的刚体改成 kinematic（跟随骨骼 ✓ 不自由飞 ✗）
  4) 网格通过骨架修改器自动跟随 ✓ 无需额外操作 ✓
"""
import bpy
import json
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(n, d=None):
    if n in argv:
        i = argv.index(n)
        return argv[i + 1] if i + 1 < len(argv) else d
    return d


PREFIX = opt('--bone-prefix', '裙摆_')
RENDER = opt('--render')
FRAMES = opt('--frames', '0,30,60,120')
MAXF = int(opt('--max-frame', '120'))
OUT = opt('--out')

scn = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
rw = scn.rigidbody_world
print('骨架: %s | rigidbody_world: %s' % (arm.name, rw is not None))

# ---------- ① 清姿势到绑定姿态（垂落要在自然站立/APose 下发生 ✓） ----------
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
scn.frame_set(scn.frame_start)
bpy.context.view_layer.update()
print('已清空姿势与动作（rest/APose ✓）')

# ---------- ② 记下刚体→骨骼的偏移（必须在任何模拟之前 ✓） ----------
TYPE = {0: '静态', 1: '动态', 2: '动态+骨'}
bindings = []          # (body_obj, bone_name, off_matrix, type)
n_kin = 0
for o in bpy.data.objects:
    rb = getattr(o, 'rigid_body', None)
    mr = getattr(o, 'mmd_rigid', None)
    if rb is None or mr is None:
        continue
    bone = (getattr(mr, 'bone', '') or '').strip()
    t = int(getattr(mr, 'type', -1))
    if t == 2:                       # 动态+骨：交给骨骼带着走（kinematic ✓）
        try:
            rb.kinematic = True
            n_kin += 1
        except Exception:
            pass
        continue
    if t != 1 or not bone or bone not in arm.pose.bones:
        continue
    pb = arm.pose.bones[bone]
    bone_rest_world = arm.matrix_world @ pb.bone.matrix_local
    off = o.matrix_world.copy() @ bone_rest_world.inverted()
    bindings.append((o, bone, off))
print('动态刚体绑定 %d 个（已把 %d 个「动态+骨」设为 kinematic ✓）' % (len(bindings), n_kin))

# ---------- ③ 开物理 ----------
rw.enabled = True
scn.frame_start, scn.frame_end = 0, MAXF
print('物理已开 ✓ 帧范围 0~%d | 子步 %s 迭代 %s' % (MAXF, rw.substeps_per_frame, rw.solver_iterations))


def writeback():
    """把动态刚体的结果写回骨骼 pose"""
    n = 0
    inv_arm = arm.matrix_world.inverted()
    for o, bone, off in bindings:
        pb = arm.pose.bones[bone]
        pb.matrix = (inv_arm @ o.matrix_world) @ off.inverted()
        n += 1
    return n


def zstat(tag):
    zs = [pb.tail.z for pb in arm.pose.bones if pb.name.startswith(PREFIX)]
    if not zs:
        print('  %s: 无 %s* 骨' % (tag, PREFIX))
        return
    print('  %-14s %s骨 %d 根 | tailZ %.4f ~ %.4f (平均 %.4f)' % (tag, PREFIX, len(zs), min(zs), max(zs), sum(zs) / len(zs)))


want = [int(x) for x in FRAMES.split(',')]
print()
print('=== 模拟中 ===')
trail = []
for f in range(0, MAXF + 1):
    scn.frame_set(f)
    n = writeback()
    bpy.context.view_layer.update()
    if f in want:
        trail.append((f, n))
        zstat('帧 %d' % f)

# ---------- ④ 出图 ----------
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    import math
    # 取景用身体范围
    body = bpy.data.objects.get('纳西妲_13_主体')
    dg = bpy.context.evaluated_depsgraph_get()
    eo = body.evaluated_get(dg)
    me = eo.to_mesh()
    vs = [eo.matrix_world @ v.co for v in me.vertices]
    eo.to_mesh_clear()
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    zs = [v.z for v in vs]
    center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    radius = max(max(xs) - min(xs), max(zs) - min(zs)) * 2.4
    cd = bpy.data.cameras.new('c')
    cam = bpy.data.objects.new('c', cd)
    scn.collection.objects.link(cam)
    a = math.radians(25)
    cam.location = (center.x + radius * math.sin(a), center.y - radius * math.cos(a), center.z + radius * 0.15)
    cam.rotation_euler = (center - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = 40
    scn.camera = cam
    scn.render.resolution_x, scn.render.resolution_y = 700, 950
    ld = bpy.data.lights.new('l', type='SUN')
    ld.energy = 4.0
    lo = bpy.data.objects.new('l', ld)
    scn.collection.objects.link(lo)
    lo.rotation_euler = (math.radians(50), 0, math.radians(35))
    for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            scn.render.engine = e
            break
        except Exception:
            continue
    for f in (0, 30, 60, MAXF):
        scn.frame_set(f)
        writeback()
        bpy.context.view_layer.update()
        scn.render.filepath = os.path.join(RENDER, '2垂落_f%03d.png' % f)
        bpy.ops.render.render(write_still=True)
        print('出图: %s' % scn.render.filepath)

print()
print('（未保存 .blend ✓ 你那边一个字都没改 ✓）')
