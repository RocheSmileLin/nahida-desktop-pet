/* ============================================================================
   默认值 / 全局状态 / 滑块绑定 / 恢复默认
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ★ 默认值（与 petapp/settings_store.py 的 SETTING_DEFAULTS 保持一致 ✅）*/
var DEFAULTS = {
  brightness:1.12, ambient:0.91, hemi:0.30, key:0.67, fill:0, size:1.5, meshScale:1.0,
  camPitch:15, camY:-0.08, camYaw:-30, camFov:30,
  physics:false, gravity:-10, unitStep:1/65, maxStep:3, warmup:60, maxFps:60,
  dragInertia:80, dragDecay:0.9, dragTilt:-1,
  trackRange:1000, gazeHead:1.5, gazeEye:1.5, breath:0.5,
  /* ★ 2026-10-17 渲染设置（2026-10-18 用户把调整台当时的值定为新默认）*/
  renderMode:'white', envPreset:'court', bgTransparent:true, exposure:0.5, outlineWidth:13,
  shadowOn:true, shadowOpacity:0, shadowSize:512,
  contrast:2, highlights:-1, shadows:-1, toonOn:false,
  eyeMax:30
};
var cur = {}, post = null, dirty = {};

/* ★ 把键盘焦点交给右边的 3D 视口（在左边点过按钮后，按住 Shift 平移 / S / 中键 立刻可用 ✅） */
function focusViewer() {
  try {
    var f = document.getElementById('viewer');
    if (f && f.contentWindow) { f.contentWindow.focus(); }
  } catch (e) {}
}

function fmt(k, v) {
  if (k === 'unitStep') return '1/' + Math.round(1 / v);
  if (k === 'maxFps') return v == 0 ? '不限' : v;
  if (k === 'size') return Number(v).toFixed(2) + '×';
  if (k === 'maxStep' || k === 'warmup' || k === 'trackRange' || k === 'dragInertia') return v;
  /* 相机 / 取景（2026-10-12）：角度带 °，取景上下 2 位小数 ✅ */
  if (k === 'camPitch' || k === 'camYaw') return Math.round(v) + '°';
  if (k === 'camFov') return Number(v).toFixed(1) + '°';
  if (k === 'camY')  return Number(v).toFixed(2);
  return Number(v).toFixed(2);
}
function paint(el) {
  var k = el.dataset.k, v = parseFloat(el.value);
  var pct = (v - el.min) / (el.max - el.min) * 100;
  el.style.setProperty('--p', pct + '%');
  var out = el.parentElement.querySelector('.val');
  if (out) out.textContent = fmt(k, v);
}
function setAll(s) {
  cur = Object.assign({}, s);
  /* ★ 部件状态跟着设置走（用户要求 ③）*/
  PART_STATE = Object.assign({}, s.parts || {});
  /* ★ 2026-10-17：表情状态一起同步（左栏「表情」页）*/
  EXPR_STATE = Object.assign({}, s.expr || {});
  if (LPANE === 'expr') { buildExpr(); }
  /* ★ 2026-10-17：渲染设置控件同步 */
  if (window._syncRenderPane) { window._syncRenderPane(); }
  if (window._partNames) { buildParts(window._partNames); }
  document.querySelectorAll('input[type=range]:not(.tr)').forEach(function (el) {
    var k = el.dataset.k;
    if (cur[k] !== undefined) { el.value = cur[k]; el.dataset.def = DEFAULTS[k]; }
    paint(el);
  });
  var sw = document.getElementById('sw-physics');
  sw.classList.toggle('on', !!cur.physics);
  document.querySelectorAll('#seg-gravity button').forEach(function (b) {
    b.classList.toggle('on', Math.abs(parseFloat(b.dataset.v) - parseFloat(cur.gravity)) < 1e-6);
  });
  var gv = document.querySelector('#seg-gravity').parentElement.querySelector('.val');
  if (gv) gv.textContent = cur.gravity;
}
function push() {                    /* 80ms 防抖：连续滑动只发最后一次 ✅ */
  clearTimeout(post);
  post = setTimeout(function () {
    var body = JSON.stringify(dirty); dirty = {};
    /* ★ 2026-10-21：改动直接推给视口 iframe（原来只能靠 viewer 每 300ms 轮询，
       现在轮询放宽到 2 秒当兜底 ⇒ 拖滑块仍然是即时的）✅ */
    try {
      var _fr = document.getElementById('viewer');
      if (_fr && _fr.contentWindow && _fr.contentWindow.applySettings) {
        _fr.contentWindow.applySettings(JSON.parse(body));
      }
    } catch (ePush) {}
    fetch('/petsettings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (r) { setState(r && r.ok ? '已保存 ✅' : '保存失败 ⚠️', !!(r && r.ok)); })
      .catch(function () { setState('连不上桌宠 ⚠️', false); });
  }, 80);
}
function setState(t, ok) {
  var s = document.getElementById('state');
  s.textContent = t; s.className = 'state' + (ok ? ' ok' : '');
  document.getElementById('dot').className = 'dot' + (ok ? ' ok' : '');
}
function change(k, v) { dirty[k] = v; cur[k] = v; push(); }

document.querySelectorAll('input[type=range]:not(.tr)').forEach(function (el) {
  el.addEventListener('input', function () { paint(el); change(el.dataset.k, parseFloat(el.value)); });
  var rst = el.parentElement.querySelector('.rst');
  if (rst) rst.addEventListener('click', function () {
    el.value = DEFAULTS[el.dataset.k]; paint(el); change(el.dataset.k, DEFAULTS[el.dataset.k]);
  });
});
document.getElementById('sw-physics').addEventListener('click', function () {
  var on = !this.classList.contains('on');
  this.classList.toggle('on', on); change('physics', on);
});
document.querySelectorAll('#seg-gravity button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('#seg-gravity button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    var gv = b.parentElement.parentElement.querySelector('.val');
    if (gv) gv.textContent = b.dataset.v;
    change('gravity', parseFloat(b.dataset.v));
  });
});
document.getElementById('btn-reset').addEventListener('click', function () {
  /* ★ 2026-10-12 用户要求：「全部恢复默认」只复位【滑块】，「不要动部件勾选」✅
     ⚠️ 旧行为：setAll(DEFAULTS) 会把 PART_STATE 清成 {} → 勾选框全变"显示"
        → 靴子与光脚重叠闪面 ❌；而且之后随便点一次部件，就把这个空状态存进服务器了
     做法：先把部件勾选存下来，恢复默认后再塞回去（POST 里本来就只有滑块，不含 parts）✅ */
  var _keepParts = Object.assign({}, PART_STATE);
  dirty = Object.assign({}, DEFAULTS);
  setAll(DEFAULTS);
  PART_STATE = _keepParts;                         /* 部件勾选塞回去 ✅ */
  if (window._partNames) { buildParts(window._partNames); }
  push();
});
