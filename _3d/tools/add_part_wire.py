# -*- coding: utf-8 -*-
"""
加部件 · 第二阶段（软件端接线，纯 Python，不需要 Blender）

读 tools/parts/<部件>.materials.json，把新部件的材质接进：
  · 部件材质对照.json        （权威表）
  · pet_settings.json        parts[材质] = false（默认不戴）
  · sets.json                每套 hide[材质] = false
  · js/settings/20-parts.js  PART_TREE 分类/条目
  · js/pet/80-assets.js      CLOTH_MATS（+ cloth=true 时 TOP_BOTTOM_MATS）
  · js/viewer/60-assets.js   cloth=true 时 TOP_BOTTOM_MATS

用法：
  python add_part_wire.py -c <配置.json> [--apply]
  不给 --apply 只打印计划（dry-run，不改任何文件）
  改完自动备份 6 个文件到 _backup/接线_<时间>/（按原目录结构保存）
"""
import os, sys, io, json, re, time, shutil, argparse, subprocess, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP = os.path.join(ROOT, '_backup')
TS = time.strftime('%Y%m%d_%H%M%S')


def log(*a):
    print('[接线]', *a)


# ---------------- 文本工具 ----------------
def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def find_match(s, i):
    """s[i] 是 '['，返回匹配的 ']' 下标（跳过字符串）"""
    assert s[i] in '[{'
    pairs = {'[': ']', '{': '}'}
    stack = []
    q = None
    j = i
    while j < len(s):
        c = s[j]
        if q:
            if c == '\\':
                j += 2
                continue
            if c == q:
                q = None
        elif c in '"\'`':
            q = c
        elif c in '[{':
            stack.append(c)
        elif c in ']}':
            if not stack:
                return j
            stack.pop()
            if not stack:
                return j
        j += 1
    return -1


def array_span(text, var):
    i = text.find('var %s = ' % var)
    if i < 0:
        i = text.find('%s = ' % var)
    if i < 0:
        return None
    j = text.find('[', i)
    k = find_match(text, j)
    return (j, k) if k > j else None


def split_top(arr_text):
    """把 '[ ... ]' 顶层元素切出来 → [(start,end)] 相对 arr_text"""
    out = []
    depth = 0
    q = None
    start = None
    for i, c in enumerate(arr_text):
        if q:
            if c == q:
                q = None
            continue
        if c in '"\'`':
            q = c
        elif c in '[{':
            depth += 1
            if depth == 1:
                start = i + 1
        elif c in ']}':
            depth -= 1
            if depth == 0:
                out.append((start, i))
                start = None
    return out


# ---------------- 各文件接线 ----------------
def wire_part_tree(html, label, mats, category):
    span = array_span(html, 'PART_TREE')
    if not span:
        return html, 'PART_TREE 没找到（跳过）'
    a, b = span
    block = html[a:b + 1]
    if label in block or all(m in block for m in mats):
        return html, 'PART_TREE 已有（跳过）'
    item = "    ['%s', [%s]]" % (label, ', '.join("'%s'" % m for m in mats))
    # 找同名分类（用字面量定位，避免注释/嵌套把 split_top 弄乱）
    key = "['%s', [" % category
    cp = block.find(key)
    if cp >= 0:
        i2 = cp + len(key) - 1          # 指向条目数组的 '['
        k2 = find_match(block, i2)      # 该条目数组的 ']'
        if k2 > i2:
            head = block[:k2].rstrip()
            sep = '' if head.endswith('[') else ','
            nb = head + sep + '\n' + item + '\n  ' + block[k2:]
            return html[:a] + nb + html[b + 1:], 'PART_TREE 追加到分类「%s」' % category
    # 没有该分类 → 在最外层末尾新建（放在 '主体' 之前更整齐，找不到就末尾）
    marker = "  ['🧍 主体"
    pos = block.find(marker)
    catblock = "  ['%s', [\n%s\n  ]],\n" % (category, item)
    if pos > 0:
        nb = block[:pos] + catblock + block[pos:]
    else:
        nb = block[:-2].rstrip()
        nb = nb + ',\n' + catblock + '];'
        return html[:a] + nb + html[b + 1:], 'PART_TREE 新建分类「%s」' % category
    return html[:a] + nb + html[b + 1:], 'PART_TREE 新建分类「%s」' % category


def wire_flat_array(html, var, mats):
    span = array_span(html, var)
    if not span:
        return html, '%s 没找到（跳过）' % var
    a, b = span
    block = html[a:b + 1]
    add = [m for m in mats if ("'%s'" % m) not in block]
    if not add:
        return html, '%s 已有（跳过）' % var
    ins = "  /* ★ %s 新增 */\n  " % time.strftime('%Y-%m-%d')
    ins += ', '.join("'%s'" % m for m in add)
    body = block[:-1].rstrip()
    if not body.endswith('['):
        body += ','
    nb = body + '\n' + ins + '\n]'
    return html[:a] + nb + html[b + 1:], '%s +%d' % (var, len(add))


def wire_json_parts(path, mats, default=False):
    d = json.load(open(path, encoding='utf-8'))
    parts = d.setdefault('parts', {})
    add = [m for m in mats if m not in parts]
    for m in add:
        parts[m] = default
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return 'parts +%d（共 %d）' % (len(add), len(parts))


def wire_json_sets(path, mats):
    d = json.load(open(path, encoding='utf-8'))
    tot = 0
    for st in d.get('sets', []):
        hide = st.setdefault('hide', {})
        add = [m for m in mats if m not in hide]
        for m in add:
            hide[m] = False
        tot += len(add)
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return 'hide +%d（%d 套）' % (tot, len(d.get('sets', [])))


def wire_table(path, name, mats, faces):
    d = json.load(open(path, encoding='utf-8'))
    key = '部件'
    if key not in d:
        for k in d:
            if isinstance(d[k], dict) and any('材' in kk for kk in d[k].keys() if isinstance(kk, str)):
                key = k
                break
    tbl = d.setdefault(key, {})
    tbl[name] = mats
    d['生成时间'] = d.get('生成时间', '') if name in tbl else d.get('生成时间', '')
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return '%s["%s"] = %d 个材质' % (key, name, len(mats))


# ---------------- 验证 ----------------
def verify_js(path, var, tmpdir):
    txt = read(path)
    span = array_span(txt, var)
    if not span or not shutil.which('node'):
        return None
    a, b = span
    js = 'const _x = ' + txt[a:b + 1] + ';\nconsole.log(_json=JSON.stringify(_x.length));'
    p = os.path.join(tmpdir, '_chk_%s_%s.js' % (os.path.basename(path), var))
    write(p, js)
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    return (r.returncode == 0, (r.stderr or '').strip()[:200])


def verify_all(mats):
    bad = []
    tbl_path = os.path.join(ROOT, '部件材质对照.json')
    tbl = json.load(open(tbl_path, encoding='utf-8')).get('部件', {})
    known = {m for v in tbl.values() for m in v}
    ps = json.load(open(os.path.join(ROOT, 'pet_settings.json'), encoding='utf-8')).get('parts', {})
    dead = [k for k in ps if k not in known]
    log('对照表材质 %d | parts 键 %d | 死键 %d' % (len(known), len(ps), len(dead)))
    if dead:
        bad.append('死键: %s' % ', '.join(dead[:8]))
    for f, var in (('js/settings/20-parts.js', 'PART_TREE'),
                   ('js/pet/80-assets.js', 'CLOTH_MATS'),
                   ('js/viewer/60-assets.js', 'TOP_BOTTOM_MATS')):
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        txt = read(p)
        span = array_span(txt, var)
        if not span:
            continue
        block = txt[span[0]:span[1] + 1]
        miss = [m for m in mats if ("'%s'" % m) not in block]
        log('%-24s %-16s 漏挂 %d %s' % (f, var, len(miss), ('← ' + ', '.join(miss[:4])) if miss else '✅'))
        if miss:
            bad.append('%s/%s 漏挂 %d' % (f, var, len(miss)))
    try:
        with urllib.request.urlopen('http://127.0.0.1:8810/petparts', timeout=3) as r:
            got = json.load(r)
            names = got.get('materials') or got.get('parts') or got
            if isinstance(names, list):
                nm = {x if isinstance(x, str) else x.get('name') for x in names}
                miss = [m for m in mats if m not in nm]
                log('桌宠 /petparts 上报 %d 个材质 | 新部件缺 %d %s' % (
                    len(nm), len(miss), '（PMX 还没导出？）' if miss else '✅'))
                if miss:
                    bad.append('/petparts 缺 %d 个（需重导 PMX + 重启桌宠）' % len(miss))
    except Exception as e:
        log('桌宠未运行（跳过 /petparts 检查）: %s' % type(e).__name__)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-c', '--config', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding='utf-8'))
    name = cfg['name']
    mpath = os.path.join(ROOT, 'tools', 'parts', '%s.materials.json' % name)
    if not os.path.exists(mpath):
        raise SystemExit('缺少第一阶段产物: %s（先跑 add_part_3d.py）' % mpath)
    info = json.load(open(mpath, encoding='utf-8'))
    mats = [m['mat'] for m in info['materials']]
    faces = {m['mat']: m['faces'] for m in info['materials']}
    label = info.get('label') or name
    category = info.get('category') or '🧥 外部服饰'
    cloth = bool(info.get('cloth'))
    log('部件「%s」| 材质 %d | cloth=%s | 分类「%s」' % (label, len(mats), cloth, category))

    targets = ['部件材质对照.json', 'pet_settings.json', 'sets.json',
               'js/settings/20-parts.js', 'js/pet/80-assets.js', 'js/viewer/60-assets.js']
    paths = {t: os.path.join(ROOT, t) for t in targets if os.path.exists(os.path.join(ROOT, t))}
    log('目标文件 %d 个: %s' % (len(paths), ', '.join(paths)))

    if a.apply:
        dst = os.path.join(BACKUP, '接线_%s' % TS)
        os.makedirs(dst, exist_ok=True)
        for rel, p in paths.items():
            dstp = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(dstp), exist_ok=True)
            shutil.copy2(p, dstp)
        log('已备份 →', dst)

    # JS：同一文件里的多个数组要顺序改（先 CLOTH_MATS 再 TOP_BOTTOM_MATS）
    js_edits = [
        ('js/settings/20-parts.js',
         lambda t: wire_part_tree(t, label, mats, category), True),
        ('js/pet/80-assets.js',
         lambda t: wire_flat_array(t, 'CLOTH_MATS', mats), cloth),
        ('js/pet/80-assets.js',
         lambda t: wire_flat_array(t, 'TOP_BOTTOM_MATS', mats), cloth),
        ('js/viewer/60-assets.js',
         lambda t: wire_flat_array(t, 'TOP_BOTTOM_MATS', mats), cloth),
    ]
    pending = {}
    for rel, fn, cond in js_edits:
        if not cond or rel not in paths:
            continue
        txt = pending.get(rel, read(paths[rel]))
        new, msg = fn(txt)
        pending[rel] = new
        log('%s → %s' % (rel, msg))
    for rel, new in pending.items():
        old = read(paths[rel])
        if a.apply and new != old:
            write(paths[rel], new)

    # JSON
    if a.apply:
        log('部件材质对照.json → ' + wire_table(paths['部件材质对照.json'], name, mats, faces))
        log('pet_settings.json → ' + wire_json_parts(paths['pet_settings.json'], mats, False))
        log('sets.json → ' + wire_json_sets(paths['sets.json'], mats))
    else:
        log('（dry-run）JSON 将补: 对照表["%s"]、parts[%d 键]=false、每套 hide[%d 键]=false'
            % (name, len(mats), len(mats)))

    # 验证
    tmp = os.path.join(ROOT, 'temp_import')
    os.makedirs(tmp, exist_ok=True)
    for f, var in (('js/settings/20-parts.js', 'PART_TREE'),
                   ('js/pet/80-assets.js', 'CLOTH_MATS'),
                   ('js/pet/80-assets.js', 'TOP_BOTTOM_MATS'),
                   ('js/viewer/60-assets.js', 'TOP_BOTTOM_MATS')):
        p = paths.get(f)
        if p and os.path.exists(p):
            r = verify_js(p, var, tmp)
            if r:
                log('%s %s 语法 %s' % (f, var, '✅' if r[0] else '❌ ' + r[1]))
    if a.apply:
        bad = verify_all(mats)
        if bad:
            log('⚠️ 遗留问题:')
            for b in bad:
                log('   -', b)
        else:
            log('✅ 全部接线验证通过')
    else:
        log('dry-run 结束（未改文件）。确认无误后加 --apply')


if __name__ == '__main__':
    main()
