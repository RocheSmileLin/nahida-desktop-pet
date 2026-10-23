/* ============================================================================
   设置同步（灯光/部件，300ms 轮询）
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ---------------- 设置同步（只取灯光 + 部件）---------------- */
function applySettings(s) {
  if (!s) return;
  if (typeof s.brightness === 'number') { PET_BRIGHTNESS = s.brightness; }
  ['ambient', 'hemi', 'key', 'fill'].forEach(function (k) {
    if (typeof s[k] === 'number') { L[k] = s[k]; }
  });
  applyLighting();
  needsRender = true;
  if (s.parts && typeof s.parts === 'object') {
    PARTS = s.parts;
    applyParts();
  }
  /* ★ 2026-10-17：表情（调整台左侧「表情」页）→ 只有变化时才重画（静态按需渲染）✅ */
  if (s.expr && typeof s.expr === 'object') {
    EXPR = s.expr;
    needsRender = true;
  }
  /* ★★ 2026-10-17：视线（眼骨旋转）*/
  if (s.eyeUp !== undefined || s.eyeDown !== undefined || s.eyeLeft !== undefined
      || s.eyeRight !== undefined || s.eyeMax !== undefined) {
    EYES = {
      up: +s.eyeUp || 0, down: +s.eyeDown || 0,
      left: +s.eyeLeft || 0, right: +s.eyeRight || 0,
      max: (s.eyeMax === undefined ? 12 : +s.eyeMax)
    };
    needsRender = true;
  }
  /* ★ 2026-10-17：渲染设置（渲染引擎 / 世界环境 / 透明 / 曝光）*/
  if (s.renderMode && s.renderMode !== MODE && !MODE_LOCKED) { setMode(s.renderMode); }
  if (s.envPreset !== undefined || s.bgTransparent !== undefined || s.exposure !== undefined) {
    if (s.envPreset !== undefined) { ENVP = s.envPreset || 'none'; }
    if (s.bgTransparent !== undefined) { BGTRANS = !!s.bgTransparent; }
    if (s.exposure !== undefined) { EXPOSURE = +s.exposure || 1.05; }
    applyEnv();
  }
  /* ★ 描边宽度（设置里 0~15，×0.01 = 场景单位；模型约 12 单位高，6 ≈ 0.5% 身高）*/
  if (s.outlineWidth !== undefined) { setOutlineWidth((+s.outlineWidth || 0) * 0.01); }
  /* ★ 阴影（地面接影 / 浓度 / 清晰度）*/
  if (s.shadowOn !== undefined || s.shadowOpacity !== undefined || s.shadowSize !== undefined) {
    applyShadow(s);
  }
  /* ★ 照片级调色（对比度 / 高光 / 阴影）*/
  if (s.contrast !== undefined || s.highlights !== undefined || s.shadows !== undefined) {
    applyGrade(s);
  }
}
var lastTxt = '';
/* ★★ 2026-10-21 轮询从 300ms 放宽到 2000ms：
   300ms = 每秒 3 次 fetch，netstat 里一片 TIME_WAIT 全是它；而它是【常驻页】，
   跟桌宠不共享任何模型数据 ⇒ 纯粹白烧连接和 CPU。
   拖滑块时的即时反馈改由父页 settings.html 的 push() 直接调用本页 applySettings()
   （见 js/settings/10-state.js），这里的轮询只当兜底 ✅
   另外：标签页不可见（后台/最小化）时完全不拉，切回前台立刻拉一次 ✅ */
var PULL_MS = 2000;
function pullSettings() {
  if (document.hidden) { return; }
  fetch('/petsettings').then(function (r) { return r.text(); })
    .then(function (t) {
      if (!t || t === lastTxt) return;
      /* ⚠️ 模型还没加载好时绝不能记账：否则「打开页面 → 设置被拉一次 → lastTxt 锁死」，
         等模型就绪后再也不应用（曾导致 renderMode=toon 却永远停在白模）*/
      if (!S.mesh) { return; }
      lastTxt = t;
      try { applySettings(JSON.parse(t)); } catch (e) {}
    })
    .catch(function () {});
}
pullSettings();
setInterval(pullSettings, PULL_MS);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { pullSettings(); }
});
