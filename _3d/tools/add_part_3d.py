# -*- coding: utf-8 -*-
"""
加部件 · 第一阶段（Blender 端）：导入 → 对齐 → 材质 → UV → 挂骨 → 权重 → 验收 → 存盘

用法：
  Blender 内（Scripting / MCP exec）：
      CFG_PATH = r'...\\tools\\parts\\猫娘服装.json'
      exec(compile(open(r'E:/NXD/NXD桌宠/_3d/tools/add_part_3d.py', encoding='utf-8').read(), 'addp', 'exec'), {})
  命令行（需先关 Blender，避免与已打开的会话抢 .blend）：
      E:/Blender/blender.exe -b "<blend>" --python add_part_3d.py -- --config parts/xxx.json [--apply]

配置见 parts/样例.json；不想写盘的预演：不传 --apply（只做导入前的检查与报告）。
"""
import bpy, sys, os, json, time, math, glob, statistics, shutil, io
import re as _re2
from mathutils import Vector, Matrix, kdtree
from mathutils.bvhtree import BVHTree

try:
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # _3d
BACKUP = os.path.join(ROOT, '_backup')
TS = time.strftime('%Y%m%d_%H%M%S')
APPLY = False
CFG = {}


# ---------------- 基础设施 ----------------
def log(*a):
    print('[加部件]', *a)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def load_cfg():
    global CFG
    p = arg('--config') or os.environ.get('ADD_PART_CONFIG')
    if not p:
        raise SystemExit('缺少配置：--config <json> 或环境变量 ADD_PART_CONFIG')
    with io.open(p, encoding='utf-8') as f:
        CFG = json.load(f)
    CFG['_path'] = p
    log('配置:', p, '| 部件:', CFG.get('name'), '| 来源:', CFG.get('source'))


def obj_mode():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')


def backup_blend(tag):
    os.makedirs(BACKUP, exist_ok=True)
    bk = os.path.join(BACKUP, '纳西妲_%s前_%s.blend' % (tag, TS))
    bpy.ops.wm.save_as_mainfile(copy=True, filepath=bk)
    log('备份 →', bk)
    return bk


def find_arm():
    arm = bpy.data.objects.get(CFG.get('arm', '纳西妲_arm'))
    if not arm:
        raise SystemExit('找不到骨架 %s' % CFG.get('arm', '纳西妲_arm'))
    return arm


# ---------------- 1) 导入 ----------------
def sanitize_text_file(path, outdir):
    """OBJ/MTL 若是 GBK，转成 UTF-8 副本（放 outdir），并把贴图【拷到 outdir + 改写成纯文件名】。
    ⚠️ Blender 的 OBJ 导入器会把贴图路径当成相对 OBJ 目录解析 —— 写绝对路径会失败，必须同目录。"""
    base = os.path.dirname(path)
    os.makedirs(outdir, exist_ok=True)
    made = []
    for ext in ('.obj', '.mtl'):
        src = path if path.lower().endswith(ext) else os.path.splitext(path)[0] + ext
        if not os.path.exists(src):
            continue
        raw = open(src, 'rb').read()
        txt = None
        for enc in ('utf-8', 'gbk', 'gb18030'):
            try:
                txt = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if txt is None:
            txt = raw.decode('utf-8', 'replace')
        os.makedirs(outdir, exist_ok=True)
        dst = os.path.join(outdir, os.path.basename(src))
        if ext == '.mtl':
            out = []
            for line in txt.splitlines():
                p = line.split(None, 1)
                if len(p) == 2 and p[0].lower() in ('map_kd', 'map_bump', 'bump', 'map_ka', 'map_ks', 'norm'):
                    rel = p[1].strip().strip('"')
                    cand = rel if os.path.isabs(rel) else os.path.join(base, rel)
                    if not os.path.exists(cand):
                        alt = os.path.join(base, os.path.basename(rel.replace('\\', '/')))
                        if os.path.exists(alt):
                            cand = alt
                        else:
                            for sub in ('texture', 'tex', 'Textures', 'textures'):
                                c2 = os.path.join(base, sub, os.path.basename(rel))
                                if os.path.exists(c2):
                                    cand = c2
                                    break
                    if os.path.exists(cand):
                        fn = os.path.basename(cand)
                        try:
                            shutil.copy2(cand, os.path.join(outdir, fn))
                        except Exception as e:
                            log('贴图拷贝失败', fn, e)
                        line = '%s %s' % (p[0], fn)
                    else:
                        log('⚠️ 找不到贴图:', rel)
                out.append(line)
            txt = '\n'.join(out) + '\n'
        open(dst, 'w', encoding='utf-8').write(txt)
        made.append(dst)
    return [m for m in made if m.lower().endswith('.obj')][0] or path


def import_source(cfg):
    src = cfg['source']
    if not os.path.exists(src):
        raise SystemExit('来源文件不存在: %s' % src)
    st = cfg.get('source_type', os.path.splitext(src)[1].lstrip('.').lower())
    tmp = os.path.join(ROOT, 'temp_import', TS)
    if st == 'obj':
        src = sanitize_text_file(src, tmp)
        log('导入 OBJ:', src)
    else:
        log('导入', st.upper(), ':', src)
    before = set(bpy.data.objects)
    if st == 'obj':
        ax = cfg.get('axis', {})
        bpy.ops.wm.obj_import(filepath=src,
                              forward_axis=ax.get('forward', 'NEGATIVE_Z'),
                              up_axis=ax.get('up', 'Y'),
                              global_scale=ax.get('scale', 0.001))
    elif st == 'fbx':
        bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False)
    else:
        raise SystemExit('不支持的来源类型: %s' % st)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not new:
        raise SystemExit('导入后没有网格对象')
    keep = max(new, key=lambda o: len(o.data.vertices))
    name = cfg['name']
    old = bpy.data.objects.get(name)
    old_mats = []
    if old:
        log('同名对象已存在 → 先删除旧对象:', name)
        old_mats = [s.material for s in old.material_slots if s.material]
        bpy.data.objects.remove(old, do_unlink=True)
        old_me = bpy.data.meshes.get(name)
        if old_me and old_me.users == 0:
            bpy.data.meshes.remove(old_me)
        # 只清理【旧对象用过、现在没人用】的材质，避免这次重命名被 .001 顶掉
        # （不碰其他部件的材质；名字可能是坏 UTF-8，全程按引用操作、不读 .name）
        for m in old_mats:
            try:
                if m.users == 0:
                    bpy.data.materials.remove(m)
            except Exception:
                pass
    keep.name = name
    keep.data.name = name
    merged = 0
    for o in new:
        if o is keep:
            continue
        o.select_set(False)
        bpy.data.objects.remove(o, do_unlink=True)
        merged += 1
    if merged:
        log('丢弃其他 %d 个网格（只保留顶点最多的一个）' % merged)
    log('导入完成: %s | 顶点 %d 面 %d 材质 %d' % (
        name, len(keep.data.vertices), len(keep.data.polygons), len(keep.material_slots)))
    return keep


def clean_material_names(obj, cfg):
    """材质名稳定化：去掉 Blender 导入器加的 `_FRONT_1685` / `.001`，可加前缀。
    材质名 = PMX 名 = 软件端开关键 ⇒ 必须可复现。"""
    import re as _re
    pre = cfg.get('material_prefix', '')
    n = 0
    for s in obj.material_slots:
        m = s.material
        if not m:
            continue
        try:
            cur = m.name
        except Exception:
            log('⚠️ 材质名非法 UTF-8，跳过重命名')
            continue
        base = _re.sub(r'_FRONT_\d+', '', cur)
        base = _re.sub(r'_BACK_\d+', '', base)
        base = _re.sub(r'\.\d{3}$', '', base)
        new = pre + base
        if new == cur:
            continue
        if bpy.data.materials.get(new):
            continue          # 已被别的材质占用 → 保持原名，避免串名
        m.name = new
        n += 1
    if n:
        log('材质重命名: %d 个 → 前缀「%s」' % (n, pre))
    return n


# ---------------- 2) 对齐 ----------------
def foot_z(obj_name):
    o = bpy.data.objects.get(obj_name)
    if not o:
        return None
    mw = o.matrix_world
    return min((mw @ v.co).z for v in o.data.vertices)


def align(obj, cfg):
    m = cfg.get('offset', {'mode': 'auto'})
    mode = m.get('mode', 'auto')
    if mode == 'fixed':
        dz = m.get('z_mm', 0.0) / 1000.0
    else:
        target = m.get('target_foot', '纳西妲_13_主体')
        tz = foot_z(target)
        if tz is None:
            log('警告：找不到 %s，跳过对齐' % target)
            return 0.0
        cur = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
        dz = tz - cur
    if abs(dz) > 1e-6:
        obj.location.z += dz
        bpy.context.view_layer.update()
    zs = [(obj.matrix_world @ v.co).z * 1000 for v in obj.data.vertices]
    log('对齐: dz = %+.2f mm | 现在 z %.0f~%.0f mm' % (dz * 1000, min(zs), max(zs)))
    return dz


# ---------------- 3) 材质（按 MTL 重建：Kd / map_Kd / map_bump） ----------------
def parse_mtl(mtl_path):
    info = {}
    cur = None
    for line in io.open(mtl_path, encoding='utf-8', errors='replace'):
        s = line.strip()
        if s.lower().startswith('newmtl '):
            cur = s[7:].strip()
            info[cur] = {'kd': [1, 1, 1], 'kd_map': None, 'bump': None}
        elif cur and s:
            k = s.split()[0].lower()
            if k == 'kd':
                try:
                    info[cur]['kd'] = [float(x) for x in s.split()[1:4]]
                except ValueError:
                    pass
            elif k == 'map_kd':
                info[cur]['kd_map'] = s[6:].strip().strip('"')
            elif k in ('map_bump', 'bump', 'norm'):
                info[cur]['bump'] = s.split(None, 1)[1].strip().strip('"')
    return info


def bare_name(mat, cfg):
    """去掉配置里加的前缀，拿回 MTL 原名（材质重建/UV 规则都按原名匹配）"""
    pre = cfg.get('material_prefix', '')
    try:
        n = mat.name
    except Exception:
        return ''
    return n[len(pre):] if pre and n.startswith(pre) else n


def rebuild_materials(obj, cfg):
    if not cfg.get('materials', {}).get('from_mtl'):
        return 0
    mtl = os.path.splitext(cfg['source'])[0] + '.mtl'
    if not os.path.exists(mtl):
        log('没找到 MTL，跳过材质重建')
        return 0
    info = parse_mtl(mtl)
    mdir = os.path.dirname(mtl)
    sanit_dir = os.path.join(ROOT, 'temp_import', TS)
    TMPD = sanit_dir if os.path.isdir(sanit_dir) else mdir

    def resolve(p):
        if not p:
            return None
        for cand in (p, os.path.join(mdir, p), os.path.join(mdir, os.path.basename(p)),
                     os.path.join(TMPD, os.path.basename(p))):
            if os.path.exists(cand):
                return cand
        return None
    n = 0
    for slot in obj.material_slots:
        m = slot.material
        if not m:
            continue
        key = None
        bname = bare_name(m, cfg)
        # ① 精确：MTL 名去掉 _FRONT_1685 后与材质基名相同
        for k in info:
            if _re2.sub(r'_(FRONT|BACK)_\d+$', '', k) == bname:
                key = k
                break
        # ② 兜底：前缀互相包含（避免 'sweater' 抢到 'sweater正面_...' 的贴图）
        if not key:
            for k in info:
                if bname.startswith(k):
                    key = k
                    break
        if not key:
            continue
        d = info[key]
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (400, 0)
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (100, 0)
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        bsdf.inputs['Roughness'].default_value = 0.75
        if 'Specular IOR Level' in bsdf.inputs:
            bsdf.inputs['Specular IOR Level'].default_value = 0.3
        if d['kd_map'] and resolve(d['kd_map']):
            t = nt.nodes.new('ShaderNodeTexImage'); t.location = (-320, 120)
            t.image = bpy.data.images.load(resolve(d['kd_map']), check_existing=True)
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        else:
            bsdf.inputs['Base Color'].default_value = (d['kd'][0], d['kd'][1], d['kd'][2], 1.0)
        if d['bump'] and resolve(d['bump']):
            t2 = nt.nodes.new('ShaderNodeTexImage'); t2.location = (-320, -220)
            t2.image = bpy.data.images.load(resolve(d['bump']), check_existing=True)
            t2.image.colorspace_settings.name = 'Non-Color'
            nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-100, -220)
            nm.inputs['Strength'].default_value = 0.25
            nt.links.new(t2.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        n += 1
    log('材质重建: %d 个' % n)
    return n


# ---------------- 4) UV ----------------
def uv_range(obj, slot_index):
    me = obj.data
    uvl = me.uv_layers.active
    lo = [9, 9]; hi = [-9, -9]
    for p in me.polygons:
        if p.material_index != slot_index:
            continue
        for li in p.loop_indices:
            u, v = uvl.data[li].uv
            lo[0] = min(lo[0], u); lo[1] = min(lo[1], v)
            hi[0] = max(hi[0], u); hi[1] = max(hi[1], v)
    return lo, hi


def has_diffuse(mat):
    """判断材质底色是否接了贴图（法线图/偏移图不算 → 它们 UV 越界也无所谓）"""
    if not mat or not mat.use_nodes:
        return False
    for l in mat.node_tree.links:
        if l.to_node.type == 'BSDF_PRINCIPLED' and l.to_socket.name == 'Base Color' \
                and l.from_node.type == 'TEX_IMAGE':
            return True
    return False


def uv_apply(obj, cfg):
    me = obj.data
    uvl = me.uv_layers.active
    if uvl is None:
        uvl = me.uv_layers.new(name='UVMap')
    rules = cfg.get('uv', {}).get('rules', [])
    mw = obj.matrix_world
    touched = []
    for slot in obj.material_slots:
        mname = slot.material.name if slot.material else ''
        mname_bare = bare_name(slot.material, cfg) if slot.material else ''
        rule = None
        for r in rules:
            pre = r.get('mat_prefix', '')
            if pre and (mname_bare.startswith(pre) or pre in mname_bare or pre in mname):
                rule = r
                break
        if not rule:
            continue
        si = obj.material_slots.find(slot.material.name)
        polys = [p for p in me.polygons if p.material_index == si]
        if not polys:
            continue
        mode = rule.get('mode', 'keep')
        if mode == 'keep':
            continue
        pts = [mw @ me.vertices[me.loops[li].vertex_index].co for p in polys for li in p.loop_indices]
        xs = [p.x for p in pts]; zs = [p.z for p in pts]
        if mode == 'project':
            k = rule.get('k', 0.0015) * 1000.0
            au, av = rule.get('anchor', [0.5, 0.5])
            az = rule.get('anchor_z', 'center')
            x_c = (min(xs) + max(xs)) / 2
            if az == 'top30':
                z_c = max(zs) - 0.30 * (max(zs) - min(zs))
            elif isinstance(az, (int, float)):
                z_c = az / 1000.0
            else:
                z_c = (min(zs) + max(zs)) / 2
            for p in polys:
                for li in p.loop_indices:
                    w = mw @ me.vertices[me.loops[li].vertex_index].co
                    uvl.data[li].uv = (au + (w.x - x_c) * k, av + (w.z - z_c) * k)
            touched.append('%s:project k=%.4f' % (mname, k / 1000))
        elif mode == 'island':
            fill = rule.get('fill', 0.84)
            # 按边连通分岛
            pset = {p.index for p in polys}
            adj = {}
            for p in polys:
                for e in p.edge_keys:
                    adj.setdefault(e, []).append(p.index)
            seen = set()
            islands = []
            for p in polys:
                if p.index in seen:
                    continue
                stack = [p.index]; comp = []; seen.add(p.index)
                while stack:
                    cur = stack.pop(); comp.append(cur)
                    for e in me.polygons[cur].edge_keys:
                        for nb in adj.get(e, []):
                            if nb not in seen:
                                seen.add(nb); stack.append(nb)
                islands.append(comp)
            for comp in islands:
                p2 = [mw @ me.vertices[me.loops[li].vertex_index].co
                      for pi in comp for li in me.polygons[pi].loop_indices]
                xs2 = [q.x for q in p2]; zs2 = [q.z for q in p2]
                cx = (min(xs2) + max(xs2)) / 2; cz = (min(zs2) + max(zs2)) / 2
                half = max(max(xs2) - min(xs2), max(zs2) - min(zs2)) / 2
                k = (fill / 2 / half) if half > 1e-9 else 0.002 * 1000
                for pi in comp:
                    for li in me.polygons[pi].loop_indices:
                        w = mw @ me.vertices[me.loops[li].vertex_index].co
                        uvl.data[li].uv = (0.5 + (w.x - cx) * k, 0.5 + (w.z - cz) * k)
            touched.append('%s:island×%d' % (mname, len(islands)))
    # 体检：还有没有超范围的材质
    bad = []
    for i, slot in enumerate(obj.material_slots):
        if not slot.material:
            continue
        lo, hi = uv_range(obj, i)
        if hi[0] < lo[0]:
            continue
        if lo[0] < -0.02 or lo[1] < -0.02 or hi[0] > 1.02 or hi[1] > 1.02:
            if has_diffuse(slot.material):
                bad.append((slot.material.name, lo, hi))
    log('UV 处理: %s' % ('; '.join(touched) if touched else '无规则命中'))
    if bad:
        log('⚠️ 仍有材质 UV 超出 0~1（图案会重复/错位）:')
        for n, lo, hi in bad:
            log('   %-24s u %.2f~%.2f  v %.2f~%.2f' % (n, lo[0], hi[0], lo[1], hi[1]))
    return bad


# ---------------- 5) 挂骨 + 权重 ----------------
def attach(obj, arm):
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    obj.matrix_world = mw
    if not any(m.type == 'ARMATURE' for m in obj.modifiers):
        m = obj.modifiers.new('Armature', 'ARMATURE')
        m.object = arm
        log('已补 Armature 修改器')
    coll = bpy.data.collections.get('纳西妲模型')
    if coll:
        if coll.name not in [c.name for c in obj.users_collection]:
            coll.objects.link(obj)
        for c in list(obj.users_collection):
            if c is not coll:
                c.objects.unlink(obj)
    bpy.context.view_layer.update()


def bind_weights(obj, arm, cfg):
    wc = cfg.get('weights', {'mode': 'skin'})
    if wc.get('mode') == 'hard':
        bone = wc.get('bone', '下半身')
        obj.vertex_groups.clear()
        g = obj.vertex_groups.new(name=bone)
        g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
        log('权重: 硬绑 %s 100%%' % bone)
        return
    BONES = set(b.name for b in arm.data.bones)
    SKIN = set(wc.get('skin_materials', ['肌2', 'body_neck', 'body_hexie', 'feet_hide']))
    SRC = wc.get('src', ['纳西妲_13_主体', '纳西妲_14_足.R', '纳西妲_15_足.L'])
    samples = []
    for nm in SRC:
        src = bpy.data.objects.get(nm)
        if not src:
            continue
        i2n = {g.index: g.name for g in src.vertex_groups}
        mi = set(i for i, m in enumerate(src.data.materials) if m and m.name in SKIN)
        keep = set()
        for p in src.data.polygons:
            if p.material_index in mi:
                keep.update(p.vertices)
        mw = src.matrix_world
        for vi in keep:
            v = src.data.vertices[vi]
            ws = []
            for g in v.groups:
                gn = i2n.get(g.group)
                if not gn or g.weight <= 1e-6 or gn.startswith('mmd_') or gn not in BONES:
                    continue
                ws.append((gn, g.weight))
            t = sum(w for _, w in ws)
            if t > 1e-6:
                samples.append((mw @ v.co, [(b, w / t) for b, w in ws]))
    if not samples:
        raise SystemExit('没有可用的身体权重样本')
    kd = kdtree.KDTree(len(samples))
    for i, (co, _) in enumerate(samples):
        kd.insert(co, i)
    kd.balance()
    PRE = wc.get('allow_prefix', ['下半身', '腰', '上半身', '首', '肩', '臂', '腕', '肘',
                                  '手首', '腿', '膝', '踝', '足首', '足', 'つま先',
                                  'センター', 'グルーブ', '全親', '操作中心'])
    BADK = wc.get('ban', ['发', '髮', '髪', '目', '顔', '眉', '口', '胸', '裙摆', '裙', '披风', '耳', '尾'])
    WL = {b for b in BONES if b.startswith(tuple(PRE)) and not any(k2 in b for k2 in BADK)}
    mw = obj.matrix_world
    maxb = wc.get('max_bones', 4)
    rows = []
    for v in obj.data.vertices:
        co = mw @ v.co
        acc = {}
        for k in (8, 24, 64):
            acc = {}
            for _, idx, dist in kd.find_n(co, k):
                wgt = 1.0 / (dist * dist + 1e-8)
                for b, w in samples[idx][1]:
                    if b in WL:
                        acc[b] = acc.get(b, 0.0) + w * wgt
            if sum(acc.values()) > 1e-9:
                break
        if sum(acc.values()) <= 1e-9:
            acc = {'下半身': 1.0}
        if abs(co.x) > 0.005:
            dropL = co.x < 0
            for b in list(acc):
                if (dropL and b.endswith('.L')) or ((not dropL) and b.endswith('.R')):
                    acc.pop(b)
        t = sum(acc.values()) or 1.0
        if t <= 1e-9:
            acc = {'下半身': 1.0}; t = 1.0
        norm = sorted([(b, w / t) for b, w in acc.items() if w / t > 1e-4], key=lambda x: -x[1])[:maxb]
        s2 = sum(w for _, w in norm) or 1.0
        rows.append([(b, w / s2) for b, w in norm])
    obj.vertex_groups.clear()
    vgs = {b: obj.vertex_groups.new(name=b) for b in sorted({b for r in rows for b, _ in r})}
    for vi, r in enumerate(rows):
        for b, w in r:
            vgs[b].add([vi], w, 'REPLACE')
    log('权重: 抄皮肤权重 | 样本 %d | 顶点 %d | 骨 %d' % (len(samples), len(rows), len(vgs)))
    return rows


def smooth_weights(obj, cfg):
    sc = cfg.get('weights', {}).get('smooth')
    if not sc:
        return
    zmax = sc.get('z_max', 0.70)
    R = sc.get('radius_mm', 12) / 1000.0
    rounds = sc.get('rounds', 3)
    me = obj.data
    mw = obj.matrix_world
    i2n = {g.index: g.name for g in obj.vertex_groups}
    W = [{i2n[g.group]: g.weight for g in v.groups if g.weight > 1e-6} for v in me.vertices]
    co = [mw @ v.co for v in me.vertices]
    kd = kdtree.KDTree(len(co))
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    region = [i for i, p in enumerate(co) if p.z < zmax]
    nbrs = {i: [idx for _, idx, dd in kd.find_range(co[i], R) if idx != i] for i in region}
    for _ in range(rounds):
        new = {}
        for i in region:
            acc = {b: w * 0.5 for b, w in W[i].items()}
            nb = nbrs[i]
            if nb:
                f = 0.5 / len(nb)
                for j in nb:
                    for b, w in W[j].items():
                        acc[b] = acc.get(b, 0.0) + w * f
            t = sum(acc.values())
            if t <= 0:
                continue
            new[i] = {b: w / t for b, w in sorted(acc.items(), key=lambda kv: -kv[1])[:4]}
            s = sum(new[i].values())
            new[i] = {b: w / s for b, w in new[i].items()}
        for i, w in new.items():
            W[i] = w
    obj.vertex_groups.clear()
    vgs = {b: obj.vertex_groups.new(name=b) for b in sorted({b for w in W for b in w})}
    for vi, w in enumerate(W):
        for b, val in w.items():
            vgs[b].add([vi], val, 'REPLACE')
    log('权重平滑: 区域 %d 点 × %d 轮 r=%.0fmm' % (len(region), rounds, R * 1000))


# ---------------- 6) 验收 ----------------
def body_bvh():
    body = bpy.data.objects.get('纳西妲_13_主体')
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    bm = ev.to_mesh()
    vs = [ev.matrix_world @ v.co for v in bm.vertices]
    ps = [tuple(p.vertices) for p in bm.polygons]
    bvh = BVHTree.FromPolygons(vs, ps, all_triangles=False, epsilon=0.0)
    ev.to_mesh_clear()
    return bvh


def report_fit(obj):
    bvh = body_bvh()
    mw = obj.matrix_world
    d = []
    for v in obj.data.vertices:
        p = mw @ v.co
        loc, nor, idx, dist = bvh.find_nearest(p, 0.5)
        if loc is None:
            continue
        d.append((p - loc).dot(nor) * 1000)
    if not d:
        log('贴合: 无法测量')
        return
    emb = sum(1 for x in d if x < 0)
    log('贴合: 嵌入 %d (%.1f%%) | 最深 %+.1f | 中位 %+.1f | p95 %+.1f mm' % (
        emb, 100.0 * emb / len(d), min(d), statistics.median(d),
        sorted(d)[int(len(d) * 0.95)]))


def coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    pts = [obj.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    return pts


def pose_tests(obj, arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix()
    base = coords(obj)
    results = []
    for bn, axis, deg in [('上半身2', 'X', 15), ('下半身', 'X', 15),
                          ('腿D.L', 'X', 25), ('肩.L', 'Y', 20), ('头', 'Z', 20)]:
        pb = arm.pose.bones.get(bn)
        if not pb:
            continue
        for p in arm.pose.bones:
            p.matrix_basis = Matrix()
        pb.matrix_basis = Matrix.Rotation(math.radians(deg), 4, axis)
        cur = coords(obj)
        d = [(a - b).length * 1000 for a, b in zip(cur, base)]
        up = [x for x, p in zip(d, base) if p.z > 0.75]
        dn = [x for x, p in zip(d, base) if p.z < 0.62]
        results.append((bn, axis, deg, max(d), statistics.median(d),
                        statistics.median(up) if up else 0.0, max(up) if up else 0.0,
                        statistics.median(dn) if dn else 0.0, max(dn) if dn else 0.0))
    for p in arm.pose.bones:
        p.matrix_basis = Matrix()
    bpy.ops.object.mode_set(mode='OBJECT')
    back = coords(obj)
    res = max((a - b).length * 1000 for a, b in zip(back, base))
    log('姿势跟随（复位偏差 %.4f mm）:' % res)
    for bn, axis, deg, mx, p50, up50, upmx, dn50, dnmx in results:
        log('   %-8s %s %+3d° → max %6.1f p50 %5.1f | 上身 p50 %5.1f | 下摆 p50 %5.1f max %6.1f' % (
            bn, axis, deg, mx, p50, up50, dn50, dnmx))
    return res


# ---------------- 7) 输出 ----------------
def emit(obj, cfg):
    mats = []
    for i, slot in enumerate(obj.material_slots):
        if not slot.material:
            continue
        nf = sum(1 for p in obj.data.polygons if p.material_index == i)
        if nf == 0:
            continue          # 空槽导出时会被跳过
        mats.append({'mat': slot.material.name, 'faces': nf})
    zs = [(obj.matrix_world @ v.co).z * 1000 for v in obj.data.vertices]
    out = {
        'name': obj.name,
        'label': cfg.get('label', obj.name),
        'category': cfg.get('category', '🧥 外部服饰'),
        'cloth': bool(cfg.get('cloth', False)),
        'verts': len(obj.data.vertices),
        'faces': len(obj.data.polygons),
        'materials': mats,
        'z_mm': [round(min(zs), 1), round(max(zs), 1)],
        'built_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'config': os.path.basename(cfg['_path']),
    }
    p = os.path.join(ROOT, 'tools', 'parts', '%s.materials.json' % obj.name)
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('材质清单 →', p)
    log('材质 %d 个: %s' % (len(mats), ', '.join('"%s"' % m['mat'] for m in mats)))
    return out


def main():
    global APPLY
    APPLY = ('--apply' in sys.argv)
    load_cfg()
    obj_mode()
    arm = find_arm()
    if APPLY:
        backup_blend('加部件')
    obj = import_source(CFG)
    align(obj, CFG)
    clean_material_names(obj, CFG)
    rebuild_materials(obj, CFG)
    uv_apply(obj, CFG)
    attach(obj, arm)
    bind_weights(obj, arm, CFG)
    smooth_weights(obj, CFG)
    bpy.context.view_layer.update()
    report_fit(obj)
    pose_tests(obj, arm)
    info = emit(obj, CFG)
    if APPLY:
        bpy.ops.wm.save_mainfile()
        log('已存盘')
    else:
        log('未加 --apply：不落盘（场景里已有改动，想丢弃请 文件→恢复）')
    log('完成。下一步：')
    log('  ① 你自己在 Blender 里 Ctrl+S 并导出 PMX')
    log('  ② 跑 add_part_wire.py -c parts/%s.json 接线（写 5 处前端 + 2 个 json）' % info['name'])
    return info


if __name__ == '__main__':
    main()
