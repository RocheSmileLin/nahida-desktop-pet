/* ============================================================================
   浏览器端本地表情层、表情写入、视线、复位
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══ ★★ 2026-10-18 浏览器端【不做】自动随机表情（用户要求）═══════════════
   需求原话：「浏览器端不自动随机播放表情，只有我点预设的时候才会触发对应表情；
              预设的表情点击后只作用在浏览器端，不作用于桌面端」
   · 自动随机调度器只在 pet.html（桌宠窗口）里跑 ✅
   · 这边新增 EXPR_LOCAL：点预设 → 只改这个局部层（不影响 /petsettings → 桌宠不知道）
   · 优先级：EXPR_LOCAL（点预设）> EXPR（滑杆，会同步到桌宠）*/

var EXPR_LOCAL = {};              /* 浏览器端【本地】表情（点预设时写入，不发给桌宠）*/

/* 调整台点预设时直接调这个（iframe.contentWindow.applyLocalExpr）*/
function applyLocalExpr(e) {
  EXPR_LOCAL = {};
  Object.keys(e || {}).forEach(function (k) {
    var v = parseFloat(e[k]);
    if (isFinite(v) && v > 0.005) { EXPR_LOCAL[k] = Math.max(0, Math.min(1, v)); }
  });
  needsRender = true;
  console.log('[viewer] 预设表情（仅浏览器端）：'
              + (Object.keys(EXPR_LOCAL).length ? JSON.stringify(EXPR_LOCAL) : '清空'));
}

var _exprLast = {};              /* 上一帧写过的 morph（用于归零，见 applyExpr）*/
function applyExpr() {
  if (!MORPH_IDX || !S.mesh || !S.mesh.morphTargetInfluences) { return; }
  var ex = {}, _mk;
  for (_mk in (EXPR || {})) { ex[_mk] = EXPR[_mk]; }
  for (_mk in (EXPR_LOCAL || {})) { ex[_mk] = EXPR_LOCAL[_mk]; }   /* ★ 点预设优先 ✅ */
  var inf = S.mesh.morphTargetInfluences;
  var dirty = false;
  /* ★★ 2026-10-17：上一帧写过、这次被删掉的 morph 要主动归零
     —— 否则滑回最左 / 点「全部归零」时表情会卡在上一次的值 ✅ */
  for (var dk in _exprLast) {
    if (!(dk in ex)) {
      var di = MORPH_IDX[dk];
      if (di !== undefined && inf[di] !== 0) { inf[di] = 0; dirty = true; }
      delete _exprLast[dk];
    }
  }
  for (var k in ex) {
    var i = MORPH_IDX[k];
    if (i === undefined) { continue; }
    var w = parseFloat(ex[k]);
    if (!isFinite(w)) { continue; }
    var v = Math.max(0, Math.min(1, w));
    if (inf[i] !== v) { inf[i] = v; dirty = true; }
    _exprLast[k] = 1;
  }
  if (dirty) { needsRender = true; }
}

/* ★★ 2026-10-17 视线（真眼球转动）—— 转 眼.L/眼.R 两根骨（虹膜 228 点挂在这两根骨上）
   「上/下/前」那些 morph 动的是【眉毛】，管不了眼球（Blender 实测与眼睛零重叠）*/
var EYES = null;                /* {up, down, left, right, max} 来自 /petsettings */
var _eyeBase = null;            /* 眼骨静止旋转（绝对写入，避免逐帧累加漂移）*/

function cacheEyeBase() {
  _eyeBase = [];
  /* ⚠️ 两套骨名都要认：.blend 里是 眼.L/眼.R，导出的 PMX 里是 左目/右目 ✅ */
  var names = (S.bones['眼.L'] && S.bones['眼.R']) ? ['眼.L', '眼.R']
            : (S.bones['左目'] && S.bones['右目']) ? ['左目', '右目'] : [];
  names.forEach(function (n) {
    var b = S.bones[n];
    if (b) { _eyeBase.push({ b: b, x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }); }
  });
  console.log('[viewer] 视线骨: ' + (_eyeBase.length
    ? _eyeBase.map(function (e) { return e.b.name; }).join(',') + ' ✅'
    : '未找到 眼.L/眼.R 或 左目/右目 ⚠️'));
}

function applyGaze() {
  if (!_eyeBase || !_eyeBase.length || !EYES) { return; }
  var maxR = (EYES.max === undefined ? 12 : EYES.max) * Math.PI / 180;
  var pitch = ((EYES.down || 0) - (EYES.up || 0)) * maxR;
  var yaw = ((EYES.right || 0) - (EYES.left || 0)) * maxR;
  for (var i = 0; i < _eyeBase.length; i++) {
    var e = _eyeBase[i];
    e.b.rotation.set(e.x + pitch, e.y + yaw, e.z);
  }
}

/* 复位到静止姿势（换姿势前必须做，否则残留上一套动作的骨骼 / morph）✅ */
/* SYNC:resetToRest —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
function resetToRest() {
  if (!S.rest) return;
  Object.keys(S.rest).forEach(function (n) {
    var b = S.bones[n], r = S.rest[n];
    if (!b) return;
    b.rotation.set(r.rx, r.ry, r.rz);
    b.position.set(r.px, r.py, r.pz);
  });
  if (S.mesh && S.mesh.morphTargetInfluences) {
    for (var i = 0; i < S.mesh.morphTargetInfluences.length; i++) { S.mesh.morphTargetInfluences[i] = 0; }
  }
  if (S.mesh) S.mesh.updateMatrixWorld(true);
}
