# -*- coding: utf-8 -*-
"""
一键把当前 .blend 导出成桌宠用的 PMX（参数与 2026-10-17 那次完全一致）。

用法（三种都行）：
  1) 在 Blender 的 Scripting 面板打开本文件 → Run Script
  2) 命令行：  E:/Blender/blender.exe -b "E:/NXD/NXD桌宠/_3d/纳西妲完美版_骨骼中文化.blend" --python "E:/NXD/NXD桌宠/_3d/tools/导出PMX.py"
  3) 让 Hermes 调 MCP 执行

⚠️ 导出前请确认：
  · 形态键值都在 0（Blender 的形态键滑块 + 骨骼 pose 都不影响导出，但习惯上归零）
  · 物体模式（OBJECT）—— 编辑模式下导出可能拿到旧几何
  · 已在 Blender 里 Ctrl+S（本脚本导出的是【内存里的场景】，不是磁盘的 .blend）
"""
import bpy
import os

TARGET = r'E:\NXD\NXD桌宠\_3d\model\纳西妲完美版.pmx'

root = None
for o in bpy.data.objects:
    if getattr(o, 'mmd_type', '') == 'ROOT':
        root = o
        break
if root is None:
    raise RuntimeError('没找到 MMD 根对象（mmd_type == ROOT）')

# 回到物体模式
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active = root

res = bpy.ops.mmd_tools.export_pmx(
    filepath=TARGET,
    check_existing=False,             # 不弹覆盖确认
    scale=12.5,                       # Blender(m) → PMX 单位
    copy_textures_mode='SKIP_EXISTING',  # 贴图已在 model/tex，不再复制
    sort_materials=False,             # 保持材质顺序（部件面板靠名字，不靠顺序，但别乱动）
    disable_specular=False,
    visible_meshes_only=False,        # ★ 必须 False：隐藏的服装/配件也要导出
    fix_bone_order=True,
    overwrite_bone_morphs_from_action_pose=False,
    normal_handling='PRESERVE_ALL_NORMALS',
    sort_vertices='NONE',
    ik_angle_limits='EXPORT_ALL',
    log_level='WARNING',
    save_log=False)

print('[导出]', res, TARGET)
print('[导出] 大小 %.2f MB' % (os.path.getsize(TARGET) / 1048576.0))
print('[导出] 形态键(主体) %d 个' % len(bpy.data.objects['纳西妲_13_主体'].data.shape_keys.key_blocks))
print('提示：桌宠读的是这个 PMX → 导完重启 pet_app.py 才会加载新模型')
