# -*- coding: utf-8 -*-
"""
材质名映射工具（长期工具 ✓ 只读 ✓ 不改任何文件 ✓ 只写一份 json）
路径: E:\\QQTwinBot\\_3d\\tools\\材质名映射.py

背景:
  mmd_tools 导出 PMX 时会在【它内部】给材质名做唯一化顺移 ✗
  （例: Blender 的 部件_部件_衣服.001 落成 PMX 里的 部件_部件_衣服.002/.003 等）
  ⇒ 所以【不能拿 Blender 的材质名当面板的键】✗
  ⇒ 正确的键 = 【桌宠上报的真实名字】（= PMX 里的名字）✓

用法（先启动桌宠 ✓）:
    D:\\Python\\python39.exe "E:\\QQTwinBot\\_3d\\tools\\材质名映射.py"
输出:
  ① 屏幕: 全量名字 / 可选件 / 原装件 / 一份可直接贴进 settings.html 的 hide 数组 ✓
  ② 文件: _3d/mat_name_map.json（供面板/排查复用 ✓）
"""
import os, sys, json, time

try:
    sys.stdout.reconfigure(errors='replace')
except Exception:
    pass
try:
    from urllib.request import urlopen
except ImportError:
    from urllib2 import urlopen

ROOT = r'E:\NXD\NXD桌宠\_3d'
SVR = 'http://127.0.0.1:8810'
OUT = os.path.join(ROOT, 'mat_name_map.json')

# ★ 原装（纳西妲_ 前缀那套）在 PMX 里的材质名 —— 出现这些就【不隐藏】
KEEP = [u'颜', u'颜2', u'齿', u'口舌', u'二重', u'眉', u'睫', u'目', u'白目', u'星目',
        u'髮', u'前髮', u'肌2', u'髮+', u'body_neck', u'body_hexie', u'feet_hide',
        u'头饰', u'手镯.R', u'披风-披风', u'披风-披风饰', u'树叶',
        u'脚环L', u'脚环R', u'臂饰.L', u'臂饰.R', u'裤子',
        u'踝饰-足.L', u'踝饰-体.L', u'踝饰-足.R', u'踝饰-体.R',
        u'连衣裙-体', u'连衣裙-体饰', u'连衣裙-裙', u'连衣裙-裙2']

# ★ 可选/新件 —— 出现就【隐藏】
OPTIONAL = [u'纹身1', u'背心', u'格子裙', u'百褶裙',
            u'连衣裙上-体', u'连衣裙下-体饰', u'连衣裙下-裙', u'连衣裙下-裙2']


def get(path):
    try:
        return urlopen(SVR + path, timeout=4).read().decode('utf-8')
    except Exception as e:
        return u'\u2717 ' + str(e)


def main():
    print(u'=' * 60)
    print(u'材质名映射工具  ' + time.strftime('%Y-%m-%d %H:%M:%S'))
    print(u'=' * 60)

    raw = get('/petparts')
    try:
        names = json.loads(raw)
    except Exception:
        print(u'\u2717 拿不到 /petparts —— 桌宠没在跑？')
        print(u'  返回: ' + raw[:200])
        return
    print(u'桌宠上报材质数: %d' % len(names))

    parts = {}
    try:
        d = json.loads(get('/petsettings'))
        parts = d.get('parts') or {}
    except Exception:
        pass
    print(u'当前 parts 条数: %d' % len(parts))
    print(u'')

    keep   = [n for n in names if n in KEEP]
    opt    = [n for n in names if n not in KEEP]
    hide   = [n for n in opt]
    dead   = [k for k in parts.keys() if k not in names]
    missing = [n for n in KEEP + OPTIONAL if n not in names]

    print(u'--- 原装件（显示，共 %d）---' % len(keep))
    for n in keep:
        print(u'   ' + n)
    print(u'')
    print(u'--- 可选件（隐藏，共 %d）---' % len(opt))
    for n in opt:
        print(u'   ' + n)
    print(u'')
    if dead:
        print(u'\u26a0 parts 里的【死键】（PMX 里已无此名，无害但可清）: %d 个' % len(dead))
        for k in dead[:20]:
            print(u'   ' + k)
    if missing:
        print(u'\u26a0 我预期有、但 PMX 里没找到的: %s' % missing)
    print(u'')

    js = u'    hide: [\n'
    line = u'           '
    for i, n in enumerate(hide):
        piece = u"'%s', " % n
        if len(line) + len(piece) > 96:
            js += line.rstrip() + u'\n'
            line = u'           '
        line += piece
    if line.strip():
        js += line.rstrip().rstrip(u',') + u'\n'
    js += u'    ],\n    show: [],\n    feet: false'

    print(u'=== 可直接贴进 settings.html 的 hide 数组（%d 条）===' % len(hide))
    print(js)
    print(u'')

    data = {
        'generated': time.strftime('%Y-%m-%d %H:%M:%S'),
        'count': len(names),
        'all': names,
        'keep_shown': keep,
        'optional_hidden': hide,
        'dead_keys_in_parts': dead,
        'expected_missing': missing,
        'hide_array_js': js,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(u'已写出: %s' % OUT)
    print(u'=' * 60)


if __name__ == '__main__':
    main()
