/* ============================================================================
   表情面板：morph 分组、预设、推送 /petsettings
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══════════════════════════════════════════════════════════════════════
   ★★ 表情面板（2026-10-17 用户要求）
      左栏「部件 / 表情」页签；表情 = MMD morph 滑杆（口型 / 嘴形 / 眼睛 / 情绪 / 视线）
      · 表情名单由【桌宠上报】（/petmorphs）⇒ 名字 100% 对得上，不会写死出错 ✅
      · 拖动 → 写 pet_settings.json 的 expr → 桌宠每帧套用（实时生效）✅
      · 注意：桌宠每帧会 resetMorphs 清零，所以它每帧都要重写一遍 expr（pet.html applyExpr）
   ══════════════════════════════════════════════════════════════════════ */
var LPANE = 'parts';
var EXPR_STATE = {};                 /* {morph名: 0~1} —— 跟 pet_settings.expr 同步 */
window._morphNames = null;

/* 分组：每项是 [morph 名（日式原名，必须和模型一致）, 中文显示名] —— 界面只显示中文 ✅
   新增表情时在这里补一行即可 */
var EXPR_GROUPS = [
  ['眉毛', [
    ['上左', '眉毛上抬（左）'], ['上右', '眉毛上抬（右）'], ['下左', '眉毛下压（左）'],
    ['下右', '眉毛下压（右）']
  ]],
  ['舌头', [
    ['tg_out', '舌头伸出'], ['tg_up', '舌尖上抬'], ['tg_dn', '舌尖下压'],
    ['tg_wide', '舌头加宽']
  ]],
  ['眼睛', [
    ['星目', '星星眼']
  ]],
  ['眼眶（上眼眶 / 下眼眶 · 上下移动）', [
    ['eye_up', '上眼眶上抬'], ['eye_up_dn', '上眼眶下移'],
    ['eye_dn', '下眼眶下移'], ['eye_dn_up', '下眼眶上移']
  ]],
  ['眼眶 · 眼睑', [
    ['ウィンク', '单眼闭合'], ['ウィンク右', '单眼闭合（右）'], ['ウィンク２', '单眼闭合 2'],
    ['ウィンク２右', '单眼闭合 2（右）']
  ]],
  ['嘴型', [
    ['ぺろっ', '舔嘴唇'], ['口横広げ', '嘴横向张大'], ['口横狭め', '嘴横向收窄'],
    ['口角上げ', '嘴角上扬'], ['口角下げ', '嘴角下垂'], ['にやり', '坏笑 1'],
    ['にやり２', '坏笑 2'], ['にやり３', '坏笑 3']
  ]],
  ['口型', [
    ['あ', '啊'], ['あ２', '啊（大）'], ['い', '衣'],
    ['い１', '衣（小）'], ['い２', '衣（大）'], ['う', '乌'],
    ['え', '诶'], ['お', '哦'], ['ワ', '哇'],
    ['ん', '嗯'], ['ω', '撇嘴']
  ]],
];

function commitExpr() {
  var out = {};
  Object.keys(EXPR_STATE).forEach(function (k) {
    var v = +EXPR_STATE[k];
    if (v > 0.005) { out[k] = Math.round(v * 100) / 100; }
  });
  change('expr', out);
}

function switchLPane(p) {
  LPANE = p;
  document.querySelectorAll('.ltab').forEach(function (b) {
    b.classList.toggle('on', b.dataset.lpane === p);
  });
  var cp = document.getElementById('card-parts');
  var ce = document.getElementById('card-expr');
  if (cp) { cp.style.display = (p === 'parts' && window._partNames) ? '' : 'none'; }
  if (ce) { ce.style.display = (p === 'expr') ? '' : 'none'; }
  var t = document.getElementById('ltitle');
  var r = document.getElementById('rail-left');
  if (t) { t.textContent = (p === 'expr') ? '表情' : '部件'; }
  if (r) { r.textContent = (p === 'expr') ? '表情 ›' : '部件 ›'; }
  try { localStorage.setItem('pet_lpane', p); } catch (e) {}
  if (p === 'expr') { exprPull(); }
}

function exprPull() {
  if (window._morphNames && window._morphNames.length) { buildExpr(); return; }
  fetch('/petmorphs').then(function (r) { return r.json(); })
    .then(function (list) { window._morphNames = list || []; buildExpr(); })
    .catch(function () { window._morphNames = []; buildExpr(); });
}

/* ───────── 表情预设（expr_sets.json / 2026-10-18）─────────
   用户要求：「加入一个自主设定的表情预设，类似于服装套装」
   · 存 _3d/expr_sets.json → {"sets":[{"name":"腼腆笑","expr":{"笑い":0.8,"恥ずかしい":0.5}}]}
   · 点 chip = 套用（滑杆跟着跳 + 桌宠立刻变）｜ ✕ = 删除 ｜「存为预设」= 把当前状态存档 ✅
   · 只存 morph 权重（视线 eyeUp/Down/... 是设置项，不混进预设，避免互相盖）*/
var EXPR_SETS = null;
var EXPR_SET_READY = false;

function exprSetsPull(cb) {
  fetch('/exprsets').then(function (r) { return r.json(); })
    .then(function (d) { EXPR_SETS = (d && d.sets) || []; EXPR_SET_READY = true; if (cb) { cb(); } })
    .catch(function () { if (EXPR_SETS === null) { EXPR_SETS = []; } if (cb) { cb(); } });
}

function exprSetsSave() {
  return fetch('/exprsets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sets: EXPR_SETS || [] })
  }).then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.sets) { EXPR_SETS = d.sets; }
      setState(d && d.ok ? '表情预设已保存 ✅' : '表情预设存不进 ⚠️', !!(d && d.ok));
    })
    .catch(function () { setState('表情预设存不进（桌宠没开？）⚠️', false); });
}

/* ★★ 2026-10-18：把表情【只】推给浏览器端视口（点预设用）
   —— 不写 /petsettings，桌面端完全不知道 ✅ */
function pushExprLocal(e) {
  try {
    var f = document.getElementById('viewer');
    var w = f && f.contentWindow;
    if (!w) { return; }
    if (w.vwr && typeof w.vwr.applyLocalExpr === 'function') { w.vwr.applyLocalExpr(e || {}); }
    else if (typeof w.applyLocalExpr === 'function') { w.applyLocalExpr(e || {}); }
  } catch (err) { console.warn('[settings] 推表情给视口失败', err); }
}

function buildExprSetBar() {
  var wrap = document.createElement('div');
  wrap.className = 'exgrp';
  var h = document.createElement('h4');
  h.textContent = '表情预设（点一下就套用，和「服装套装」一样可以自己加）';
  wrap.appendChild(h);
  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:2px 0 8px';
  wrap.appendChild(bar);

  function snapCur() {                       /* 当前状态 → 预设形状（只留 >0.005）*/
    var o = {};
    Object.keys(EXPR_STATE).forEach(function (k) {
      var v = +EXPR_STATE[k];
      if (v > 0.005) { o[k] = Math.round(v * 100) / 100; }
    });
    return o;
  }
  function applyOne(e) {
    EXPR_STATE = {};
    Object.keys(e || {}).forEach(function (k) { EXPR_STATE[k] = +e[k] || 0; });
    buildExpr();                             /* 滑杆跳到预设值（只是显示）*/
    /* ★★ 2026-10-18 用户要求：「预设的表情点击后只作用在浏览器端，不作用于桌面端」
       → 只推给视口 iframe（EXPR_LOCAL），【不调 commitExpr】= 不写 /petsettings ✅ */
    pushExprLocal(e);
    setState('已套用预设（只作用于浏览器端）✅', true);
  }
  function redraw() {
    while (bar.firstChild) { bar.removeChild(bar.firstChild); }
    if (!EXPR_SETS || !EXPR_SETS.length) {
      var ph = document.createElement('span');
      ph.style.cssText = 'font-size:13.5px;color:#8b949e';
      ph.textContent = EXPR_SET_READY ? '（还没有预设：调好表情后点右边「💾 存为预设」）'
                                      : '（读取中…）';
      bar.appendChild(ph);
    }
    (EXPR_SETS || []).forEach(function (s, i) {
      var d = document.createElement('span');
      d.className = 'pt-chip';
      d.appendChild(document.createTextNode('😊 ' + s.name + ' '));
      var x = document.createElement('span');
      x.className = 'pt-x';
      x.textContent = '✕';
      x.title = '删除这个预设';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!confirm('删除表情预设「' + s.name + '」？')) { return; }
        EXPR_SETS.splice(i, 1);
        exprSetsSave().then(redraw);
      });
      d.appendChild(x);
      var kv = Object.keys(s.expr || {});
      d.title = kv.length
        ? kv.map(function (k) { return k + ' ' + s.expr[k]; }).join('\n')
        : '（这个预设是空的）';
      d.addEventListener('click', function () { applyOne(s.expr); });
      bar.appendChild(d);
    });
    var bs = document.createElement('button');
    bs.textContent = '💾 存为预设';
    bs.title = '把当前的表情权重存成一个命名预设（同名会问是否覆盖）';
    bs.addEventListener('click', function () {
      var e = snapCur();
      if (!Object.keys(e).length) {
        setState('当前所有表情都是 0，先调一个再存 ⚠️', false);
        return;
      }
      var nm = prompt('表情预设名：', '我的表情');
      if (!nm) { return; }
      nm = nm.trim();
      if (!nm) { return; }
      if (!EXPR_SETS) { EXPR_SETS = []; }
      var hit = -1;
      EXPR_SETS.forEach(function (s, i2) { if (s.name === nm) { hit = i2; } });
      if (hit >= 0) {
        if (!confirm('已有同名预设「' + nm + '」，覆盖？')) { return; }
        EXPR_SETS[hit] = { name: nm, expr: e };
      } else {
        EXPR_SETS.push({ name: nm, expr: e });
      }
      setState('表情预设「' + nm + '」已保存 ✅', true);
      exprSetsSave().then(redraw);
    });
    bar.appendChild(bs);
  }
  redraw();
  if (EXPR_SETS === null) { exprSetsPull(redraw); }
  return wrap;
}

function buildExpr() {
  var box = document.getElementById('expr-box');
  if (!box) { return; }
  var avail = window._morphNames || [];
  box.innerHTML = '';

  var top = document.createElement('div');
  top.className = 'extop';
  var b0 = document.createElement('button');
  b0.className = 'warn';
  b0.textContent = '🧹 全部归零';
  b0.addEventListener('click', function () {
    EXPR_STATE = {};
    /* ★ 视线也一起归零（这四项是设置项，不是 morph）✅ */
    ['eyeUp', 'eyeDown', 'eyeLeft', 'eyeRight'].forEach(function (k) { change(k, 0); });
    buildExpr();
    commitExpr();
    pushExprLocal({});                     /* ★ 浏览器端预设也一起清掉 ✅ */
  });
  var b1 = document.createElement('button');
  b1.textContent = '🔄 重读名单';
  b1.addEventListener('click', function () { window._morphNames = null; exprPull(); });
  top.appendChild(b0);
  top.appendChild(b1);
  var cnt = document.createElement('span');
  cnt.style.cssText = 'font-size:13.5px;color:#8b949e;align-self:center';
  cnt.textContent = avail.length ? ('模型里 ' + avail.length + ' 个 morph')
                                 : '还没拿到名单（桌宠没开？点「重读名单」）';
  top.appendChild(cnt);
  box.appendChild(top);
  /* ★★ 2026-10-18 表情预设条（和服装套装同构）—— 放在最上方，方便一眼看到 */
  box.appendChild(buildExprSetBar());

  EXPR_GROUPS.forEach(function (g) {
    var wrap = document.createElement('div');
    wrap.className = 'exgrp';
    var h = document.createElement('h4');
    h.textContent = g[0];
    wrap.appendChild(h);
    g[1].forEach(function (pair) {
      var nm = pair[0], cn = pair[1] || pair[0];
      var has = !avail.length || avail.indexOf(nm) >= 0;     /* 名单没拿到时先都可用 */
      var row = document.createElement('div');
      row.className = 'exrow' + (has ? '' : ' na');
      var lab = document.createElement('div');
      lab.className = 'exname';
      lab.textContent = cn;                                  /* ★ 界面显示中文 */
      lab.title = cn + '（' + nm + '）' + (has ? '' : ' · 模型里没有这个名字');
      var sl = document.createElement('input');
      sl.type = 'range'; sl.min = 0; sl.max = 1; sl.step = 0.01;
      sl.value = (EXPR_STATE[nm] === undefined) ? 0 : EXPR_STATE[nm];
      sl.disabled = !has;
      var val = document.createElement('div');
      val.className = 'exval';
      val.textContent = (+sl.value).toFixed(2);
      sl.addEventListener('input', function () {
        var v = parseFloat(sl.value);
        EXPR_STATE[nm] = v;
        val.textContent = v.toFixed(2);
        commitExpr();
      });
      row.appendChild(lab); row.appendChild(sl); row.appendChild(val);
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  });

  /* ★★ 2026-10-17 视线（眼球转动）—— 转【眼.L / 眼.R 两根骨】，不是 morph：
     「上/下/前」那些形态键只动眉毛（Blender 实测与眼睛零重叠），所以这一组走设置项 ✅ */
  var gw = document.createElement('div');
  gw.className = 'exgrp';
  var gh = document.createElement('h4');
  gh.textContent = '视线（转的是眼球骨，不是 morph）';
  gw.appendChild(gh);
  var gmax = (cur && cur.eyeMax) || 22;
  [['eyeUp', '向上看'], ['eyeDown', '向下看'],
   ['eyeLeft', '向左看'], ['eyeRight', '向右看']].forEach(function (pair) {
    var k = pair[0], cn = pair[1];
    var row = document.createElement('div');
    row.className = 'exrow';
    var lab = document.createElement('div');
    lab.className = 'exname';
    lab.textContent = cn;
    lab.title = cn + '｜写设置项 ' + k + '：转 眼.L / 眼.R 骨，最大 ' + gmax + '°';
    var sl = document.createElement('input');
    sl.type = 'range'; sl.min = 0; sl.max = 1; sl.step = 0.01;
    sl.value = (cur && cur[k]) || 0;
    var val = document.createElement('div');
    val.className = 'exval';
    val.textContent = (+sl.value).toFixed(2);
    sl.addEventListener('input', function () {
      var v = parseFloat(sl.value);
      val.textContent = v.toFixed(2);
      change(k, v);
    });
    row.appendChild(lab); row.appendChild(sl); row.appendChild(val);
    gw.appendChild(row);
  });
  /* 幅度：满格 = 多少度（默认 12° 实测自然；>18° 虹膜贴片会转到侧面 → 像闭眼）*/
  var mrow = document.createElement('div');
  mrow.className = 'exrow';
  var mlab = document.createElement('div');
  mlab.className = 'exname';
  mlab.textContent = '幅度（度）';
  mlab.title = '最大转动角度：默认 12°；超过约 18° 虹膜贴片会被转到侧面，看起来像闭眼';
  var msl = document.createElement('input');
  msl.type = 'range'; msl.min = 0; msl.max = 30; msl.step = 1;
  msl.value = gmax;
  var mval = document.createElement('div');
  mval.className = 'exval';
  mval.textContent = gmax + '°';
  msl.addEventListener('input', function () {
    var v = parseFloat(msl.value);
    mval.textContent = v + '°';
    change('eyeMax', v);
  });
  mrow.appendChild(mlab); mrow.appendChild(msl); mrow.appendChild(mval);
  gw.appendChild(mrow);

  var gnote = document.createElement('div');
  gnote.style.cssText = 'font-size:12.5px;color:#8b949e;margin:6px 0 2px';
  gnote.textContent = '注：眼球方向 = 旋转 左目/右目（.blend 里叫 眼.L/眼.R）两根骨，虹膜 228 个顶点挂在这两根骨上；'
                    + '和鼠标跟随视线叠加。默认幅度 12° 实测眼睛仍睁开、虹膜明显移动；'
                    + '拉到 20° 以上贴片会转向侧面（看起来像闭眼）';
  gw.appendChild(gnote);
  box.appendChild(gw);
}

document.querySelectorAll('.ltab').forEach(function (b) {
  b.addEventListener('click', function () { switchLPane(b.dataset.lpane); });
});

/* 恢复上次停留的页签（刷新后保持）*/
