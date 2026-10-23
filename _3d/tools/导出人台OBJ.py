# -*- coding: utf-8 -*-
"""把 MMD 身体导出成 Marvelous Designer 可用的 OBJ 人台。
- 只导 纳西妲_13_主体（身体本体，不含衣服/饰件）
- 单位换算成毫米（×1000），坐标从 Blender Z-up 转成 MD Y-up： (x, z, -y)
- 用求值网格（含修改器结果），静止姿势
"""
import bpy, os, sys
try:
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass

OUT = r'E:\Marvelous Designer\avatar_naxida\纳西妲身体_mm.obj'
os.makedirs(os.path.dirname(OUT), exist_ok=True)

body = bpy.data.objects['纳西妲_13_主体']
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = ev.to_mesh()
mw = ev.matrix_world

ZOFF = min((mw @ v.co).z for v in body.data.vertices)
lines = ['# Naxida body for Marvelous Designer avatar (mm, Y-up)',
         '# scale: 1 unit = 1 mm; axes: X=X, Y=+Z(blender), Z=-Y(blender)']
n_v = 0
for v in me.vertices:
    p = mw @ v.co
    lines.append('v %.4f %.4f %.4f' % (p.x * 1000.0, (p.z - ZOFF) * 1000.0, -p.y * 1000.0))
    n_v += 1

n_f = 0
for poly in me.polygons:
    idx = ' '.join(str(i + 1) for i in poly.vertices)
    lines.append('f ' + idx)
    n_f += 1

ev.to_mesh_clear()

zmin = min((mw @ v.co).z for v in body.data.vertices)
zmax = max((mw @ v.co).z for v in body.data.vertices)
xmin = min((mw @ v.co).x for v in body.data.vertices)
xmax = max((mw @ v.co).x for v in body.data.vertices)

with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(lines) + '\n')

print('已导出:', OUT)
print('  顶点 %d / 面 %d' % (n_v, n_f))
print('  Blender 里身体尺寸: 高 %.1f mm, 宽 %.1f mm（脚底 z=%.1f mm）' % (
    (zmax - zmin) * 1000, (xmax - xmin) * 1000, zmin * 1000))
print('  文件大小: %.2f MB' % (os.path.getsize(OUT) / 1048576.0))
