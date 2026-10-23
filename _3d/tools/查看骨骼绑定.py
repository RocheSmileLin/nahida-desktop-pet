# -*- coding: utf-8 -*-
"""
查看「部件绑了哪些骨骼」的体检脚本（长期工具 ✓ 只读 ✓ 不改任何数据 ✓）
路径: E:\\QQTwinBot\\_3d\\tools\\查看骨骼绑定.py

================================ 怎么用 ================================
【方法 1 · 推荐】在 Blender 里跑（中文界面）：
    右上角把工作区切到【脚本】(Scripting)
    → 中间 文本编辑器 → 顶部「打开」→ 选本文件
    → 先在【物体模式】里点选你要看的部件（比如 浅蓝色文胸）
    → 文本编辑器里按 Alt+P（或 ▶ 运行脚本）
    → 结果直接出现在文本编辑器里（另存一份 txt 到 _3d\\临时文件\\）

【方法 2】命令行无头（不用开 Blender 界面）：
    E:/Blender/blender.exe -b "E:/NXD/NXD桌宠/_3d/纳西妲完美版_骨骼中文化.blend" ^
        --python "E:/NXD/NXD桌宠/_3d/tools/查看骨骼绑定.py" -- --obj 浅蓝色文胸

================================ 看什么 ================================
① 修改器指向哪个骨架  ← 最常见的错：挂着别的骨架（比如芙提雅），动起来完全不跟
② 顶点组清单 = 骨骼清单（每个顶点组名 = 一根骨的名字）
   顶点数 / 权重和 / 最大权重 → 谁在真正驱动这件衣服一目了然
③ 死组：顶点组名在骨架里找不到同名骨 → 这一组永远不起作用（也不报错）
④ 无权重顶点 / 权重和≠1 的顶点 → 动作时会被"甩飞"或塌陷
⑤ L/R 权重分布 → 判断有没有串到对侧（比如左踝饰被右膝骨带动）
"""
import os
import sys
import bpy


def parse_args():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
        if '--obj' in argv:
            i = argv.index('--obj')
            if i + 1 < len(argv):
                return argv[i + 1]
    return None


def armature_of(obj):
    """返回 (骨架物体, 修改器名)；没绑骨架返回 (None, None)"""
    for m in obj.modifiers:
        if m.type == 'ARMATURE' and m.object:
            return m.object, m.name
    p = obj.parent
    while p is not None:
        if p.type == 'ARMATURE':
            return p, '（父级骨架，无 Armature 修改器）'
        p = p.parent
    return None, None


def check(obj, out):
    me = obj.data
    out.append('=' * 78)
    out.append('物体: %s   |   顶点 %d   面 %d   形态键 %s'
               % (obj.name, len(me.vertices), len(me.polygons),
                  ('%d 个' % len(me.shape_keys.key_blocks)) if me.shape_keys else '无'))
    out.append('当前模式: %s' % obj.mode)

    arm, modname = armature_of(obj)
    if arm is None:
        out.append('!! 没有绑定任何骨架（没有 Armature 修改器，父级也不是骨架）')
        out.append('')
        return
    bone_names = set(b.name for b in arm.data.bones)
    out.append('骨架: %s   （经 %s；该骨架共 %d 根骨）'
               % (arm.name, modname, len(arm.data.bones)))

    # ---- 每个顶点组的统计（一趟遍历） ----
    stats = {}          # gidx -> [顶点数, 权重和, 最大权重]
    unweighted = 0
    bad_sum = 0
    for v in me.vertices:
        ws = [g for g in v.groups if g.weight > 0.0]
        if not ws:
            unweighted += 1
            continue
        s = sum(g.weight for g in ws)
        if abs(s - 1.0) > 0.01:
            bad_sum += 1
        for g in ws:
            st = stats.get(g.group)
            if st is None:
                stats[g.group] = [1, g.weight, g.weight]
            else:
                st[0] += 1
                st[1] += g.weight
                if g.weight > st[2]:
                    st[2] = g.weight

    rows = []
    dead = []
    for gi, st in stats.items():
        if gi >= len(obj.vertex_groups):
            continue
        gname = obj.vertex_groups[gi].name
        if gname not in bone_names:
            dead.append('%s（%d 顶点 / 权重和 %.1f）' % (gname, st[0], st[1]))
        rows.append((st[0], st[1], st[2], gname, gi))
    rows.sort(key=lambda r: -r[1])

    out.append('顶点组 %d 个（= 起作用的骨骼）｜无权重顶点 %d 个｜权重和≠1 的顶点 %d 个'
               % (len(stats), unweighted, bad_sum))
    if dead:
        out.append('!! 死组（顶点组名在骨架里没有同名骨，永远不会起作用）:')
        for d in dead:
            out.append('     %s' % d)

    out.append('')
    out.append('%-30s %8s %10s %8s' % ('骨骼（顶点组名）', '顶点数', '权重和', '最大权重'))
    out.append('-' * 60)
    for st in rows:
        out.append('%-30s %8d %10.1f %8.3f' % (st[3], st[0], st[1], st[2]))

    # ---- L / R 分布（判断有没有串到对侧） ----
    lw = sum(st[1] for st in rows if st[3].endswith('.L'))
    rw = sum(st[1] for st in rows if st[3].endswith('.R'))
    cw = sum(st[1] for st in rows if not (st[3].endswith('.L') or st[3].endswith('.R')))
    tot = lw + rw + cw
    if tot > 0:
        out.append('')
        out.append('权重分布: .L 侧 %.1f%%   .R 侧 %.1f%%   中间(躯干等) %.1f%%'
                   % (lw * 100.0 / tot, rw * 100.0 / tot, cw * 100.0 / tot))
    out.append('')


def main():
    want = parse_args()
    if want:
        objs = [bpy.data.objects[want]]
    else:
        act = bpy.context.view_layer.objects.active
        if act is not None and act.type == 'MESH' and armature_of(act)[0]:
            objs = [act]
        else:
            objs = [o for o in bpy.data.objects
                    if o.type == 'MESH' and len(o.data.polygons) >= 50 and armature_of(o)[0]]
            if not objs:
                print('没有找到任何绑了骨架的网格物体')
                return

    out = []
    out.append('骨骼绑定体检     %s' % os.path.basename(bpy.data.filepath or '(未保存文件)'))
    out.append('')
    for o in objs:
        check(o, out)
    out.append('=' * 78)
    out.append('说明: 顶点组名 = 骨骼名，一个顶点组就是一根骨；权重和 = 该骨总共控住多少"份"顶点')
    text = '\n'.join(out)

    # ① 打到系统控制台
    print(text)

    # ② 显示在 Blender 文本编辑器里（新开一个文本块并切过去）
    try:
        name = '绑定体检结果'
        blk = bpy.data.texts.get(name) or bpy.data.texts.new(name)
        blk.clear()
        blk.write(text)
        for area in bpy.context.screen.areas:
            if area.type == 'TEXT_EDITOR':
                area.spaces[0].text = blk
    except Exception:
        pass

    # ③ 存一份 txt
    try:
        d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '临时文件')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, '绑定体检_%s.txt' % (objs[0].name if len(objs) == 1 else '全部'))
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
        print('\n已保存: %s' % p)
    except Exception as e:
        print('保存 txt 失败（不影响结果）: %s' % e)


if __name__ == '__main__':
    main()
