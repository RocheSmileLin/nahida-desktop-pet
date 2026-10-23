# -*- coding: utf-8 -*-
"""
一致性哨兵 —— 核对 pet.html（桌面桌宠）与 viewer.html（浏览器视口）的「共享机制」是否两边同步。
页面脚本已按职责拆分到 js/pet/*.js 与 js/viewer/*.js，本脚本会整目录扫描标记。

为什么要它：本项目两个页面是【各自独立的经典 script】（不是 ES module），
共享逻辑只能靠「标记 + 本脚本兜底」。历史上已经栽过两次：
  · 修了桌面的「换动作经初始态中转」，忘了浏览器 → 浏览器切「小跳干拉」腿变形
  · 修了桌面的「add() 位置还原」，忘了浏览器 → 浏览器脖子累积漂移
  · 用户从旧备份恢复 pet.html → 又把补丁覆盖掉了（两边各存一份的直接后果）

用法：   D:/Python/python39.exe _3d/_check_sync.py
退出码： 0 = 全部通过；1 = 有问题（会逐条列出）
建议：   改完「动作清单」或「动作装载逻辑」后必跑一次 ✅
"""
import glob, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PET = os.path.join(HERE, 'pet.html')
VIEWER = os.path.join(HERE, 'viewer.html')
SETTINGS = os.path.join(HERE, 'settings.html')
MOTIONS = os.path.join(HERE, 'motions.js')

# 页面脚本已按职责拆分：SYNC 标记 / 动作路径分散在这些目录里，必须整目录一起扫
SPLIT_DIRS = {
    'pet': os.path.join(HERE, 'js', 'pet'),
    'viewer': os.path.join(HERE, 'js', 'viewer'),
    'settings': os.path.join(HERE, 'js', 'settings'),
    'shared': os.path.join(HERE, 'js', 'shared'),
}

# 必须「两边都有」的共享机制标记（改代码时在对应位置写 /* SYNC:名字 */ 即可被本脚本认到）
REQUIRED = ['motionsSrc', 'resetToRest', 'subclip', 'ikSwitch', 'grantSwitch', 'viaInit', 'posRestore']
DESC = {
    'motionsSrc': '动作清单取自 motions.js（单一数据源）',
    'resetToRest': '姿态复位 resetToRest()',
    'subclip': '帧区间裁剪（静帧/拆段）',
    'ikSwitch': '按动作切足 IK 开关',
    'grantSwitch': '按动作切「付与」开关（motions.js 的 noGrant，2026-10-14 新增）',
    'viaInit': '换动作先经「初始态」中转（修跨动作 IK 污染）',
    'posRestore': 'helper.add() 前后还原骨骼位置（修累积漂移）',
}

problems, notes = [], []


def read(p):
    return io.open(p, encoding='utf-8').read()


def read_split(name):
    """把一个页面拆分后的全部 JS 按文件名顺序拼起来（加载顺序即文件名顺序）。"""
    parts = []
    for p in sorted(glob.glob(os.path.join(SPLIT_DIRS[name], '*.js'))):
        parts.append('\n/* ===== %s ===== */\n' % os.path.basename(p))
        parts.append(read(p))
    return '\n'.join(parts)


def marks(txt):
    return set(re.findall(r'SYNC:([A-Za-z]+)', txt))


pet_html, viewer_html, settings_html = read(PET), read(VIEWER), read(SETTINGS)
pet, viewer = read_split('pet'), read_split('viewer')
mot = read(MOTIONS)
mp, mv = marks(pet), marks(viewer)

print('=' * 66)
print(' 一致性哨兵  pet.html / viewer.html / motions.js')
print('=' * 66)

# ① 两边都引用 motions.js
for nm, txt in [('pet.html', pet_html), ('viewer.html', viewer_html)]:
    if '<script src="motions.js"></script>' in txt:
        print('  ✅ %-12s 已引用 motions.js' % nm)
    else:
        problems.append('%s 没有引用 motions.js' % nm)
        print('  ❌ %-12s 没有引用 motions.js' % nm)

# ② SYNC 标记两边一致
print('\n  -- 共享机制标记 --')
for k in REQUIRED:
    in_p, in_v = k in mp, k in mv
    flag = '✅' if (in_p and in_v) else '❌'
    print('  %s %-12s pet:%-3s viewer:%-3s  %s' % (flag, k, '有' if in_p else '缺',
                                                  '有' if in_v else '缺', DESC[k]))
    if not (in_p and in_v):
        problems.append('标记 SYNC:%s 缺失（pet:%s viewer:%s）' % (k, in_p, in_v))
extra_p, extra_v = mp - set(REQUIRED), mv - set(REQUIRED)
if extra_p or extra_v:
    notes.append('未在清单里的标记：pet=%s viewer=%s（可能是新加的，记得加进 REQUIRED）'
                 % (sorted(extra_p), sorted(extra_v)))

# ③ 动作清单只允许有一处定义（页面里不得再内联动作表）
print('\n  -- 动作清单唯一性 --')
if 'var MOTION_DEFS = [' in mot:
    print('  ✅ motions.js 里有 MOTION_DEFS')
else:
    problems.append('motions.js 里找不到 MOTION_DEFS')
    print('  ❌ motions.js 里找不到 MOTION_DEFS')
pat = re.compile(r"motion[\w\u4e00-\u9fff]*/[\w\u4e00-\u9fff_]+\.vmd")
for nm, txt in [('js/pet/*.js', pet), ('js/viewer/*.js', viewer)]:
    hits = sorted(set(pat.findall(txt)))
    if hits:
        problems.append('%s 里又内联了动作路径（应只放在 motions.js）：%s' % (nm, hits[:4]))
        print('  ❌ %-16s 又内联了动作路径：%s' % (nm, hits[:4]))
    else:
        print('  ✅ %-16s 没有内联动作路径' % nm)

# ③b 拆分后的 HTML 引用必须真实存在，且目录里不能有「忘了挂上去」的孤儿脚本
print('\n  -- 拆分资源引用 --')
for html_name, html in [('pet.html', pet_html), ('viewer.html', viewer_html),
                        ('settings.html', settings_html)]:
    refs = re.findall(r'(?:src|href)="((?:css|js)/[^"]+)"', html)
    missing_refs = [r for r in refs
                    if not os.path.isfile(os.path.join(HERE, r.split('?')[0].replace('/', os.sep)))]
    if missing_refs:
        problems.append('%s 引用了不存在的资源：%s' % (html_name, missing_refs))
        print('  ❌ %-12s 引用缺失：%s' % (html_name, missing_refs))
    else:
        print('  ✅ %-12s 引用的 css/js 都存在（%d 个）' % (html_name, len(refs)))

for name, d in SPLIT_DIRS.items():
    files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(d, '*.js')))
    if not files:
        problems.append('拆分目录不存在或为空：%s' % d)
        print('  ❌ js/%-8s 目录为空' % name)
        continue
    refs = set()
    for html in (pet_html, viewer_html, settings_html):
        refs.update(re.findall(r'src="js/%s/([^"?]+)' % name, html))
    orphans = [f for f in files if f not in refs]
    if orphans:
        problems.append('js/%s 里有没被任何页面引用的脚本：%s' % (name, orphans))
        print('  ❌ js/%-8s 孤儿脚本：%s' % (name, orphans))
    else:
        print('  ✅ js/%-8s 全部 %d 个脚本都已挂载' % (name, len(files)))

# ④ 动作文件必须真实存在（搬文件 / 改路径后最容易出事的地方）
print('\n  -- 动作文件是否存在 --')
_pths = re.findall(r"f:\s*'([^']+)'", mot)
_miss = [x for x in _pths
         if not os.path.isfile(os.path.join(HERE, x.replace('/', os.sep)))]
print('  引用 %d 条路径，缺失 %d 个 %s' % (len(_pths), len(_miss), _miss or ''))
if _miss:
    problems.append('motions.js 引用的动作文件不存在：%s' % _miss)

# ⑤ motions.js 内部自洽（下标范围/重复/漏挂）
print('\n  -- motions.js 自洽 --')
names = re.findall(r"\{\s*n:\s*'([^']+)'", mot)
groups = re.findall(r"\[\s*'([^']+)',\s*\[([0-9,\s]*)\]\]", mot)
print('  动作数：%d ；分组数：%d' % (len(names), len(groups)))
if not names:
    problems.append('motions.js 没解析出动作')
used = []
for gname, idxs in groups:
    idx = [int(x) for x in idxs.replace(' ', '').split(',') if x != '']
    used += idx
    bad = [i for i in idx if i < 0 or i >= len(names)]
    if bad:
        problems.append('分组「%s」下标越界：%s（动作总数 %d）' % (gname, bad, len(names)))
        print('  ❌ 分组「%s」下标越界：%s' % (gname, bad))
    else:
        print('  ✅ 分组「%s」%d 项' % (gname, len(idx)))
dup = sorted({i for i in used if used.count(i) > 1})
miss = sorted(set(range(len(names))) - set(used))
if dup:
    problems.append('这些下标出现在多个分组里：%s' % dup)
if miss:
    problems.append('这些动作没挂进任何分组（菜单里看不到）：%s → %s'
                    % (miss, [names[i] for i in miss]))
print('  %s 下标重复：%s' % ('✅' if not dup else '❌', dup or '无'))
print('  %s 未挂分组：%s' % ('✅' if not miss else '❌',
                          [names[i] for i in miss] or '无'))
if names:
    print('  动作顺序：' + ' / '.join('%d.%s' % (i, n) for i, n in enumerate(names)))

print('\n' + '=' * 66)
for n in notes:
    print('  ℹ️  ' + n)
if problems:
    print('  ❌ 发现 %d 个问题：' % len(problems))
    for p in problems:
        print('     · ' + p)
    print('=' * 66)
    sys.exit(1)
print('  ✅ 全部通过 —— 两个页面的共享机制同步，动作清单单一数据源完好')
print('=' * 66)
sys.exit(0)
