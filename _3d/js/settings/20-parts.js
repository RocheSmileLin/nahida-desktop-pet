/* ============================================================================
   部件面板：PART_TREE、套装、搜索、分页、图标网格
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ★ 部件勾选框（用户要求 ③）：清单由桌宠页面 POST 上来 → 这里 GET /petparts ✅ */
var PART_STATE = {};          /* { 部件名: false } = 隐藏；不在里面 = 可见 ✅ */
window._partNames = null;

/* ★★ 部件分组（2026-10-15 改版：按【部位】分类，用户指定 ✅
   结构：[分类名, [ [部件名, [PMX材质名...], 标记?], ... ]]
   ★ 顺序 = Blender 对象编号 = PMX 材质顺序（主体最后 → 最后绘制 ✅）
   ⚠️ 名字必须和 PMX 里的【材质名】完全一致（PMX 用 mmd_material.name_j ✅）
   ★ 踝饰不再与「足」互斥（用户 2026-10-15：取消互斥，足单独一行、默认隐藏 ✅） */
var PART_TREE = [
  ['👒 头部', [
    ['头饰', ['头饰']],
    ['树叶', ['树叶']],
    /* ★ 2026-10-19 新增：名乃猫耳（外部配件，默认不戴）*/
    ['名乃猫耳', ['部件_部件_Body_Ear.001', '部件_部件_Body_EarWhiteFur.001']]
  ]],
  ['💪 手部', [
    ['手镯', ['手镯.R']],
    ['臂饰.L', ['臂饰.L']],
    ['臂饰.R', ['臂饰.R']],
    ['浅蓝色臂饰.L', ['部件_部件_袖子.002', '部件_部件_臂带']],
    ['浅蓝色臂饰.R', ['部件_部件_袖子.001', '部件_部件_臂带.001']]
  ]],
  ['🦶 腿部', [
    ['脚环.L', ['脚环L']],
    ['脚环.R', ['脚环R']],
    ['踝饰.L', ['踝饰-体.L', '踝饰-足.L']],
    ['踝饰.R', ['踝饰-体.R', '踝饰-足.R']],
    ['浅蓝色踝饰.L', ['部件_部件_臂饰.002']],
    ['浅蓝色踝饰.R', ['部件_部件_臂饰.001']],
    ['腿环', ['部件_部件_腿环', '部件_部件_衣服.002', '部件_部件_衣饰2']],
    ['浅蓝色腿环', ['部件_部件_裤子']],
    ['足（光脚）', ['feet_hide'], '默认隐藏']
  ]],
  ['👕 上装', [
    ['连衣裙', ['连衣裙-体饰', '连衣裙-裙', '连衣裙-裙2', '连衣裙-体']],
    ['背心', ['背心']],
    /* ★ 2026-10-20 新增：深蓝JK上衣（默认不戴）*/
    ['深蓝JK上衣', ['部件_F_79489267', '部件_H_79489273.001', '部件_B_79489243', '部件_A_79489237', '部件_C_79489249']]
  ]],
  ['👖 下装', [
    ['裤子', ['裤子']],
    ['百褶裙', ['百褶裙']],
    ['格子裙', ['格子裙']],
    ['蓝色裙子', ['部件_部件_[e]SKIRT B', '部件_部件_[e]SKIRT GOLD', '部件_部件_[d]TOP', '部件_部件_[d]DRESS M', '部件_部件_[d]DRESS DEC', '部件_部件_[d]DRESS PEARL', '部件_部件_[d]BELT', '部件_部件_[f]SKIRT-', '部件_部件_[f]SKIRT']],
    /* ★ 2026-10-20 新增：猫娘套装 + 深蓝JK裙子（默认不戴）*/
    ['猫娘套装', ['sweater_Copy_1_FRONT_1630.001', 'sweater正面_FRONT_1685', '爪子口袋_FRONT_1674', 'sweater_FRONT_1620.001', 'Material1932.001']],
    ['深蓝JK裙子', ['部件_E_79489261', '部件_D_79489255', '部件_H_79489273']]
  ]],
  ['🧣 背饰', [
    ['披风', ['披风-披风饰', '披风-披风']],
    /* ★ 2026-10-19 新增：名乃猫尾（外部配件，默认不戴）*/
    ['名乃猫尾', ['部件_部件_Body_Tail.001', '部件_部件_Cloth_TailAcc.001']]
  ]],
  ['✨ 其他', [
    ['纹身2', ['部件_部件_ヘアシャドウ']]
  ]],
  ['🧍 主体（躯干 / 头 / 脸 / 头发 / 手脚）', [
    ['主体', ['颜', '颜2', '齿', '口舌', '二重', '眉', '睫', '目', '白目', '星目',
              '肌2', '髮', '前髮', '髮+', 'body_neck', 'body_hexie']]
  ]]
];
/* 向后兼容：扁平列表（PART_TREE 派生）✅ */
var PART_GROUPS = (function () {
  var out = [];
  PART_TREE.forEach(function (c) {
    c[1].forEach(function (it) { out.push(it); });
  });
  return out;
})();
window._partTree = PART_TREE;


function groupState(list) {      /* 'show' / 'hide' / 'mix' ✅ */
  var s = 0, h = 0;
  list.forEach(function (nm) {
    var v = PART_STATE[nm];
    if (v === false || v === 'hide') { h++; } else { s++; }
  });
  if (h && !s) { return 'hide'; }
  if (s && !h) { return 'show'; }
  return 'mix';
}
function setGroup(list, show, inv) {  /* show = true → 显示 list；false → 隐藏 ✅
                                        inv = 互斥组（踝饰 ⇄ 光脚）：与 list 反向 ✅ */
  list.forEach(function (nm) {
    if (show) { delete PART_STATE[nm]; } else { PART_STATE[nm] = false; }
  });
  (inv || []).forEach(function (nm) {
    if (show) { PART_STATE[nm] = false; }   /* 显示踝饰 → 藏光脚 ✅ */
    else { delete PART_STATE[nm]; }         /* 隐藏踝饰 → 露光脚 ✅ */
  });
  change('parts', JSON.parse(JSON.stringify(PART_STATE)));
}

/* ★★ 换装预设（2026-10-15 新增）：一键切整套服装 ✅
   ⚠️ 预设是【整体覆盖】PART_STATE，不是逐项增减 —— 每次点都是确定状态 ✅
   名字必须与 PMX 里的材质名（mmd_material.name_j）完全一致 ✅ */
var OUTFITS = [
  /* ★ 换装预设（用户 2026-10-16 要求只保留这一套）：
     = 显示【纳西妲本体系】那套（头饰/手镯/披风/树叶/脚环/臂饰/踝饰/裤子/连衣裙/主体）
       隐藏其余所有外部件（背心/格子裙/百褶裙/蓝色裙子/腿环/浅蓝色系列/名乃系列）
       足：保持隐藏 ✅
     ⚠️ 名字必须是【PMX 材质名】且真实存在（已按 model/纳西妲.pmx 全量核对 ✅）*/
  ['纳西妲原装', {
    hide: ['背心',
           '格子裙', '百褶裙',
           /* 浅蓝色腿环 / 腿环（拆分件）*/
           '部件_部件_裤子',
           '部件_部件_腿环', '部件_部件_衣服.002', '部件_部件_衣饰2',
           /* 纹身2（发影贴片）*/
           '部件_部件_ヘアシャドウ',
           /* 蓝色裙子 */
           '部件_部件_[e]SKIRT B', '部件_部件_[e]SKIRT GOLD',
           '部件_部件_[d]TOP', '部件_部件_[d]DRESS M',
           '部件_部件_[d]DRESS DEC', '部件_部件_[d]DRESS PEARL', '部件_部件_[d]BELT',
           '部件_部件_[f]SKIRT-', '部件_部件_[f]SKIRT',
           /* 浅蓝色臂饰.L/.R、浅蓝色踝饰.L/.R */
           '部件_部件_袖子.002', '部件_部件_臂带',
           '部件_部件_袖子.001', '部件_部件_臂带.001',
           '部件_部件_臂饰.002', '部件_部件_臂饰.001',
           /* 名乃猫耳 / 名乃猫尾 */
           '部件_部件_Body_Ear.001', '部件_部件_Body_EarWhiteFur.001',
           '部件_部件_Body_Tail.001', '部件_部件_Cloth_TailAcc.001'],
    show: [],
    feet: false
  }]
];
function outfitWant(o) {
  /* ★ 2026-10-16 修 BUG：调用方传进来的是【数组元素】['名称', {hide:[],show:[],feet:false}]
     （见 buildOutfits: setOutfit(o) / outfitState(o) 都传整个 o）✗
     原来直接读 o.hide / o.feet ⇒ 全是 undefined ⇒ w 里只剩 feet_hide
     ⇒ 服装预设【从来就没生效过】（点原装 = 除足外全部显示 ✓ 与现象完全一致）✗
     现在兼容两种形状：数组取 o[1]；裸配置对象直接用 ✅ */
  var cfg = (o && typeof o.length === 'number' && o.length >= 2) ? o[1] : (o || {});
  var w = {};
  (cfg.hide || []).forEach(function (nm) { w[nm] = false; });
  (cfg.show || []).forEach(function (nm) { w[nm] = true; });
  w['feet_hide'] = !!cfg.feet;               /* feet=true → 显示光脚 ✅ */
  return w;
}
function outfitState(o) {                    /* 当前状态是否正好等于该预设 ✅ */
  var w = outfitWant(o), k;
  for (k in w) {
    var v = PART_STATE[k];
    var cur = !(v === false || v === 'hide');
    if (cur !== w[k]) { return false; }
  }
  for (k in PART_STATE) {                   /* 预设之外的隐藏项 → 不算命中 ✅ */
    if (!(k in w) && (PART_STATE[k] === false || PART_STATE[k] === 'hide')) { return false; }
  }
  return true;
}
function setOutfit(o) {
  var w = outfitWant(o), st = {};
  for (var k in w) { if (!w[k]) { st[k] = false; } }
  PART_STATE = st;
  change('parts', JSON.parse(JSON.stringify(PART_STATE)));
  if (window._partNames) { buildParts(window._partNames); }
}
/* ══════════════════════════════════════════════════════════════════════
   ★★ 部件拆分 v2（2026-10-17 用户要求重做，效果图已确认 ✅）
      ① 部位分页切换（头部/手部/腿部/上装/下装/背饰/其他/主体）
      ② 一键清空（只留主体，二次确认）
      ③ 套装预设：存 _3d/sets.json（可保存/另存为/重命名/删除），首次用旧 OUTFITS 播种
      ④ 物品栏图标：images/<开关名>.png，未选中的图标与名字变灰
   ⚠️ 状态语义完全不变：PART_STATE = {材质名: false} ⇒ 隐藏；不在里面 ⇒ 显示
   ⚠️ 图标尺寸不一 → CSS 统一进 1:1 容器 + object-fit:contain（不变形、不裁切）
   ⚠️ 图片缺失自动回退成"首字占位"，绝不破版
   ══════════════════════════════════════════════════════════════════════ */
var ICON_DIR = 'images/';
/* ★ 图标文件名别名（2026-10-17）：纳西妲原装那套图在 images/ 里是「纳西妲XXX.png」，
   其余件（粉红色 / 浅蓝色 / 蓝色 / 纹身…）就是【开关名】本身。
   ⚠️ 找不到别名图时会自动退回用开关名再试一次，最后才用首字占位 ✅ */
var ICON_ALIAS = {
  '头饰': '纳西妲头饰', '树叶': '纳西妲树叶', '手镯': '纳西妲手镯',
  '臂饰.L': '纳西妲臂饰.L', '臂饰.R': '纳西妲臂饰.R',
  '脚环.L': '纳西妲脚环.L', '脚环.R': '纳西妲脚环.R',
  '踝饰.L': '纳西妲踝饰.L', '踝饰.R': '纳西妲踝饰.R',
  '腿环': '腿环', '裤子': '纳西妲裤子',
  '披风': '纳西妲披风',
  '连衣裙': '纳西妲连衣裙',
  '主体': '纳西妲主体',
  '足（光脚）': '纳西妲足.L'
};
var PART_PAGE = '全部';
var CUR_SET = -1;                       /* 当前高亮的套装下标（保存/重命名/删除用）*/

/* 全部材质名（用于套装比对） */
var ALL_MATS = (function () {
  var a = [];
  PART_TREE.forEach(function (c) {
    c[1].forEach(function (it) { it[1].forEach(function (n) { a.push(n); }); });
  });
  return a;
})();
/* 主体材质（一键清空时保留） */
var BODY_MATS = {};
PART_TREE.forEach(function (c) {
  if (c[0].indexOf('主体') >= 0) {
    c[1].forEach(function (it) { it[1].forEach(function (n) { BODY_MATS[n] = 1; }); });
  }
});

function visNow(nm) { var v = PART_STATE[nm]; return !(v === false || v === 'hide'); }
function itemVis(it) {                       /* 这件至少有一块材质可见 */
  for (var i = 0; i < it[1].length; i++) { if (visNow(it[1][i])) { return true; } }
  return false;
}
function itemMix(it) {                       /* 部分可见（多材质件只开了一半）*/
  var a = 0;
  for (var i = 0; i < it[1].length; i++) { if (visNow(it[1][i])) { a++; } }
  return a > 0 && a < it[1].length;
}
function commitParts() { change('parts', JSON.parse(JSON.stringify(PART_STATE))); }
function setItem(it, on) {
  it[1].forEach(function (nm) {
    if (on) { delete PART_STATE[nm]; } else { PART_STATE[nm] = false; }
  });
}

/* ───────────── 套装预设 ───────────── */
var SETS = null, SETS_READY = false;

function snapCur() {                         /* 当前状态 → 套装存储形状 {材质:false} */
  var h = {};
  ALL_MATS.forEach(function (n) { if (!visNow(n)) { h[n] = false; } });
  return h;
}
function matchSet(h) {
  for (var i = 0; i < ALL_MATS.length; i++) {
    var n = ALL_MATS[i];
    var want = !(h[n] === false);
    if (visNow(n) !== want) { return false; }
  }
  return true;
}
function applySet(h) {
  PART_STATE = {};
  for (var k in h) { if (h[k] === false) { PART_STATE[k] = false; } }
  commitParts();
  renderAllParts();
}
function setsSave(silent) {
  fetch('/petsets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sets: SETS || [] })
  }).then(function (r) { return r.json(); })
    .then(function (r) {
      if (!silent) { setState(r && r.ok ? '套装已保存 ✅' : '套装保存失败 ⚠️', !!(r && r.ok)); }
    })
    .catch(function () { if (!silent) { setState('套装存不进（桌宠没开？）⚠️', false); } });
}
function setsLoad() {
  fetch('/petsets').then(function (r) { return r.json(); })
    .then(function (d) {
      SETS = (d && d.sets) || [];
      /* ★ 首次（sets.json 还没有）：用旧 OUTFITS 播种，保住「纳西妲原装」✅ */
      if (!SETS.length && typeof OUTFITS !== 'undefined' && OUTFITS.length) {
        SETS = OUTFITS.map(function (o) {
          var w = outfitWant(o), h = {};
          for (var k in w) { if (!w[k]) { h[k] = false; } }
          return { name: o[0], hide: h };
        });
        setsSave(true);
      }
      SETS_READY = true;
      renderSetsBar();
    })
    .catch(function () { SETS = []; SETS_READY = true; renderSetsBar(); });
}

/* ───────────── DOM 小工具 ───────────── */
function ptEl(tag, cls, txt) {
  var d = document.createElement(tag);
  if (cls) { d.className = cls; }
  if (txt !== undefined && txt !== null) { d.textContent = txt; }
  return d;
}
function ptBtn(txt, cls, fn) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'pt-btn' + (cls ? ' ' + cls : '');
  b.textContent = txt;
  b.addEventListener('click', fn);
  return b;
}

var PTUI = null;
function ensurePartsUI(box) {
  if (PTUI) { return PTUI; }
  box.innerHTML = '';
  box.className = 'pt-wrap';
  var tabs = ptEl('div', 'pt-tabs');
  var tools = ptEl('div', 'pt-tools');
  var setsb = ptEl('div', 'pt-sets');
  var sect = ptEl('div', 'pt-sect');
  var grid = ptEl('div', 'pt-grid');

  /* 搜索 */
  var sw = ptEl('div', 'pt-searchwrap');
  var si = document.createElement('input');
  si.type = 'text';
  si.className = 'pt-search';
  si.placeholder = '🔍 搜索部件…';
  si.value = window._partFilter || '';
  si.addEventListener('input', function () {
    window._partFilter = si.value;
    renderGrid();
  });
  sw.appendChild(ptEl('span', 'pt-sicon', '🔍'));
  sw.appendChild(si);

  /* ② 工具按钮 */
  var bAll = ptBtn('✅ 全部显示', 'ok', function () {
    curItems().forEach(function (it) { setItem(it, true); });
    commitParts(); renderAllParts(); focusViewer();
  });
  var bNone = ptBtn('🙈 全部隐藏', '', function () {
    curItems().forEach(function (it) { setItem(it, false); });
    commitParts(); renderAllParts(); focusViewer();
  });
  var bClear = ptBtn('🧹 一键清空（只留主体）', 'warn', function () {
    if (!confirm('清空所有部件？（只保留主体，套装预设不受影响）')) { return; }
    PART_STATE = {};
    PART_TREE.forEach(function (c) {
      if (c[0].indexOf('主体') >= 0) { return; }
      c[1].forEach(function (it) { setItem(it, false); });
    });
    commitParts(); renderAllParts(); focusViewer();
  });

  tools.appendChild(sw); tools.appendChild(bAll); tools.appendChild(bNone); tools.appendChild(bClear);

  /* ③ 套装栏 */
  var chips = ptEl('div', 'pt-chips');
  var bSave = ptBtn('💾 保存当前', '', function () {
    if (!SETS || CUR_SET < 0 || !SETS[CUR_SET]) { saveAsSet(); return; }
    SETS[CUR_SET].hide = snapCur();
    setsSave(false); renderAllParts();
  });
  var bAs = ptBtn('＋ 另存为', '', saveAsSet);
  var bRen = ptBtn('✎ 重命名', 'ghost', function () {
    if (!SETS || CUR_SET < 0 || !SETS[CUR_SET]) { return; }
    var nm = prompt('重命名套装：', SETS[CUR_SET].name);
    if (nm) { SETS[CUR_SET].name = nm; setsSave(false); renderAllParts(); }
  });
  var bDel = ptBtn('🗑 删除', 'ghost', function () {
    if (!SETS || CUR_SET < 0 || !SETS[CUR_SET]) { return; }
    if (!confirm('删除套装「' + SETS[CUR_SET].name + '」？')) { return; }
    SETS.splice(CUR_SET, 1); CUR_SET = -1;
    setsSave(false); renderAllParts();
  });
  setsb.appendChild(ptEl('span', 'pt-setlbl', '套装预设：'));
  setsb.appendChild(chips);
  setsb.appendChild(bSave); setsb.appendChild(bAs); setsb.appendChild(bRen); setsb.appendChild(bDel);

  /* ★ 顶部：工具 + 套装 合成一个可下拉面板（用户要求：置于最上方、允许下拉，省空间） */
  var drop = ptEl('div', 'pt-drop');
  var dhead = ptEl('div', 'pt-dhead');
  dhead.appendChild(ptEl('span', 'pt-dtitle', '⚙ 工具 & 套装'));
  var dsum = ptEl('span', 'pt-dsum', '');
  dhead.appendChild(dsum);
  dhead.appendChild(ptEl('span', 'pt-darw', '▾'));
  var dbody = ptEl('div', 'pt-dbody');
  dhead.addEventListener('click', function () {
    drop.classList.toggle('open');
    try { localStorage.setItem('pet_parts_drop', drop.classList.contains('open') ? '1' : '0'); } catch (e) {}
  });
  var _open = false;
  try { _open = localStorage.getItem('pet_parts_drop') === '1'; } catch (e) {}
  if (_open) { drop.classList.add('open'); }

  dbody.appendChild(tools);
  dbody.appendChild(setsb);
  drop.appendChild(dhead);
  drop.appendChild(dbody);

  box.appendChild(drop);          /* ← 在最上方 */
  box.appendChild(tabs);
  box.appendChild(sect);
  box.appendChild(grid);
  PTUI = { tabs: tabs, chips: chips, grid: grid, sect: sect, search: si, dsum: dsum };
  return PTUI;
}

function curCat() {
  if (PART_PAGE === '全部') { return null; }
  for (var i = 0; i < PART_TREE.length; i++) {
    if (PART_TREE[i][0] === PART_PAGE) { return PART_TREE[i]; }
  }
  return null;
}
function curItems() {
  var c = curCat();
  if (!c) {
    var out = [];
    PART_TREE.forEach(function (cc) { cc[1].forEach(function (it) { out.push(it); }); });
    return out;
  }
  return c[1];
}
function pageLabel(name) {
  var s = name.replace(/（[^）]*）/g, '');
  /* 去掉 emoji / 变体选择符 / 零宽连接符（用户要求：分页标签不要 emoji） */
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{FE0E}\u{200D}]/gu, '');
  return s.trim();
}

/* ① 分页 */
function renderTabs() {
  var t = PTUI.tabs;
  t.innerHTML = '';
  var pages = ['全部'].concat(PART_TREE.map(function (c) { return c[0]; }));
  pages.forEach(function (nm) {
    var items;
    if (nm === '全部') {
      items = [];
      PART_TREE.forEach(function (cc) { cc[1].forEach(function (it) { items.push(it); }); });
    } else {
      items = (PART_TREE.filter(function (c) { return c[0] === nm; })[0] || [, []])[1];
    }
    var on = items.filter(itemVis).length;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pt-tab' + (PART_PAGE === nm ? ' on' : '');
    b.appendChild(ptEl('b', '', nm === '全部' ? '全部' : pageLabel(nm)));
    b.appendChild(ptEl('span', 'pt-tabn', on + '/' + items.length));
    b.addEventListener('click', function () { PART_PAGE = nm; renderAllParts(); });
    t.appendChild(b);
  });
}

/* ③ 套装 chips */
function renderSetsBar() {
  if (!PTUI) { return; }
  var c = PTUI.chips;
  c.innerHTML = '';
  var hit = -1;
  (SETS || []).forEach(function (s, i) {
    if (matchSet(s.hide || {})) { hit = i; }
  });
  if (hit >= 0) { CUR_SET = hit; }
  (SETS || []).forEach(function (s, i) {
    var on = (i === hit);
    var d = document.createElement('span');
    d.className = 'pt-chip' + (on ? ' on' : '');
    d.appendChild(ptEl('span', '', '📦 ' + s.name));
    var x = ptEl('span', 'pt-x', '✕');
    x.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!confirm('删除套装「' + s.name + '」？')) { return; }
      SETS.splice(i, 1); CUR_SET = -1;
      setsSave(false); renderAllParts();
    });
    d.appendChild(x);
    d.addEventListener('click', function () {
      CUR_SET = i;
      applySet(s.hide || {});
      renderAllParts();
      focusViewer();
    });
    c.appendChild(d);
  });
  if (!(SETS || []).length) {
    c.appendChild(ptEl('span', 'pt-setlbl', SETS_READY ? '（还没有套装，点「另存为」新建）' : '（读取中…）'));
  }
}

function saveAsSet() {
  var nm = prompt('新套装名：', '我的套装');
  if (!nm) { return; }
  if (!SETS) { SETS = []; }
  SETS.push({ name: nm, hide: snapCur() });
  CUR_SET = SETS.length - 1;
  setsSave(false);
  renderAllParts();
}

/* ④ 物品栏网格 */
function renderGrid() {
  var g = PTUI.grid;
  g.innerHTML = '';
  var q = (window._partFilter || '').trim().toLowerCase();
  var list = curItems().filter(function (it) {
    if (!q) { return true; }
    return (it[0] + ' ' + it[1].join(' ')).toLowerCase().indexOf(q) >= 0;
  });
  list.forEach(function (it) {
    var on = itemVis(it), mix = itemMix(it);
    var cell = ptEl('div', 'pt-cell' + (on ? ' on' : '') + (mix ? ' mix' : ''));
    cell.appendChild(ptEl('div', 'pt-badge', on ? '✓' : ''));
    if (it[2]) { cell.appendChild(ptEl('span', 'pt-tag', it[2])); }

    var th = ptEl('div', 'pt-thumb');
    var img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    var _fn1 = ICON_ALIAS[it[0]] || it[0];      /* ① 别名（纳西妲XXX.png）*/
    var _try2 = (_fn1 !== it[0]);               /* ② 找不到 → 退回开关名本身 */
    img.src = ICON_DIR + encodeURIComponent(_fn1) + '.png';
    var ph = ptEl('div', 'pt-ph', it[0].replace(/[.\-_（].*$/, '').slice(0, 1));
    img.addEventListener('error', function () {
      if (_try2) {                              /* 别名图没找到 → 试开关名 */
        _try2 = false;
        img.src = ICON_DIR + encodeURIComponent(it[0]) + '.png';
        return;
      }
      img.style.display = 'none';
      ph.style.display = 'flex';
    });
    img.addEventListener('load', function () {
      ph.style.display = 'none';
      img.style.display = 'block';
    });
    th.appendChild(img); th.appendChild(ph);

    cell.appendChild(th);
    cell.appendChild(ptEl('div', 'pt-nm', it[0]));
    cell.appendChild(ptEl('div', 'pt-sub', it[1].join(' · ')));
    cell.addEventListener('click', function () {
      setItem(it, !on);
      commitParts();
      renderAllParts();
      focusViewer();
    });
    g.appendChild(cell);
  });

  var cat = curCat();
  PTUI.sect.innerHTML = '';
  PTUI.sect.appendChild(ptEl('h3', '', cat ? pageLabel(cat[0]) : '全部'));
  PTUI.sect.appendChild(ptEl('span', 'pt-hint',
    list.length + ' 个部件' + (q ? '（搜索：' + q + '）' : '') + ' · 点击格子切换显示/隐藏'));
}

function renderAllParts() {
  if (!PTUI) { return; }
  renderTabs();
  renderSetsBar();
  renderGrid();
  /* 下拉面板右侧摘要：已选数量 + 当前命中套装 ✅ */
  if (PTUI.dsum) {
    var on = 0, tot = 0;
    PART_TREE.forEach(function (c) {
      c[1].forEach(function (it) { tot++; if (itemVis(it)) { on++; } });
    });
    var sn = '';
    (SETS || []).some(function (s) {
      if (matchSet(s.hide || {})) { sn = s.name; return true; }
      return false;
    });
    PTUI.dsum.textContent = '已选 ' + on + '/' + tot + (sn ? ' · 套装「' + sn + '」' : '');
  }
}

function buildParts(names) {
  if (!names || !names.length) { return; }
  window._partNames = names;
  var card = document.getElementById('card-parts');
  if (card) { card.style.display = (LPANE === 'parts') ? '' : 'none'; }
  var box = document.getElementById('parts-box');
  if (!box) { return; }
  ensurePartsUI(box);
  if (SETS === null) { setsLoad(); }        /* 只拉一次 ✅ */
  renderAllParts();
}
