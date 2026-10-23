/* ============================================================================
   主循环（静态场景按需渲染）
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ---------------- 主循环（静态场景 → 按需渲染，静止时几乎不烧 CPU ✅）---------------- */
var clock = new THREE.Clock(), _last = 0;
function loop(t) {
  requestAnimationFrame(loop);
  var ft = (typeof t === 'number' && t) ? t : ((window.performance && performance.now) ? performance.now() : Date.now());
  if (ft - _last < 33) return;                    /* 上限 30fps ✅ */
  _last = ft;
  /* ★ 播放中必须持续重画（放在提前 return 之前！否则只画一帧就停 ✅）*/
  if (MOT.playing) { needsRender = true; }
  /* ★★ 2026-10-18：入场闸门 —— 没显示前每帧都重画 + 催上传 + 判闸门
     （白模/线框模式第一次检查就通过；贴图模式等「上下装+主体」齐了再显示）*/
  if (!S.revealed && S.mesh) { needsRender = true; tryReveal(); }
  /* 贴图没全就绪 → 继续逐帧画（否则会定格成白模）；顺带每 ~0.5s 催一次上传 ✅ */
  if (!needsRender && !allTexReady) {
    needsRender = true;
    if ((_fc++ % 15) === 0) { allTexReady = texAllReady(); }
  }
  if (!needsRender) { return; }
  /* ★★ 2026-10-18 静默加载：这里原来每 0.5s 按"贴图就绪"重算材质显隐（+ 红色角标），
     用户要求「不要永久隐藏，静默加载」→ 已整块移除。
     现在：可见性只由部件开关决定，贴图好了自然贴上（上面的 allTexReady 会持续重画到齐为止）✅ */
  var dt = clock.getDelta();
  if (dt > 1 / 30) { dt = 1 / 30; }
  if (S.revealed && S.helper && !MMD_FROZEN) { S.helper.update(dt); }
  /* ★★ 2026-10-17：表情滑杆 —— 必须放在 helper.update（动作/IK/付与/物理）之后写，
     否则会被动作的 morph 轨道覆盖 ✅ */
  applyExpr();
  /* ★★ 2026-10-17：视线（眼骨旋转）—— 同样放在动作/物理之后，绝对写入不会漂移 ✅ */
  applyGaze();
  /* ★ 播放中：保持重画 + 同步帧号/进度条（用户 2026-10-11）✅ */
  if (MOT.playing) {
    needsRender = true;
    if (MOT.action) {
      var nf = Math.min(MOT.total, Math.round(MOT.action.time * MOT.fps));
      if (nf !== MOT.frame) { MOT.frame = nf; motUI(); }
    }
  }
  renderScene();                             /* ★ 走统一出口（含对比度/高光/阴影后处理）✅ */
  needsRender = false;
}
onResize();
applyLighting();
loop();
console.log('[viewer] 页面已就绪');
