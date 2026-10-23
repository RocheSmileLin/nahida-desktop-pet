/* ============================================================================
   输入：滚轮/中键/Shift 平移/缩放模态/快捷键
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ================= 输入：滚轮 / 中键 / 按住 Shift（照 Blender）================= */
var modal = null;     /* 平移/缩放 模态：{ kind, byShift, x0, y0, pivot0, dist0, anchor0, r0, u0, axis } */
var drag = null;      /* 中键拖动：{ kind:'orbit'|'pan', x0, y0, pivot0, dist0, r0, u0, az0, el0 } */
var mx = 0, my = 0;
var modeEl = document.getElementById('mode');
var cv = renderer.domElement;
var AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
var AXIS_NAME = { x: 'X（左右）', y: 'Y（上下）', z: 'Z（前后）' };

function cvPos(e) {
  var r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function showMode(t) { modeEl.textContent = t; modeEl.style.display = ''; }
function hideMode() { modeEl.style.display = 'none'; }

/* —— 平移 / 缩放 模态 ——
   ★ 2026-10-11 用户要求：「平移从按 G 改成【按住 Shift】」
     · 按住 Shift + 移动鼠标 = 平移（松开 Shift 即完成，不用点确认）✅
     · 平移中可再按 X / Y / Z 锁轴向（再按同键取消）；Esc 取消 ✅
     · 中键拖动 = 旋转（按住 Shift 时以平移优先）✅
   —— 缩放仍是按 S 触发的模态（Blender 那套「按键 → 动鼠标 → 确认」）✅ */
function startModal(kind, byShift) {
  camBasis();
  modal = {
    kind: kind, byShift: !!byShift, x0: mx, y0: my, axis: null,
    pivot0: view.pivot.clone(), dist0: view.dist,
    anchor0: worldUnderMouse(mx, my),          /* ★ 锚点 = 鼠标当前位置 ✅ */
    r0: _right.clone(), u0: _up.clone()
  };
  modalText();
}
function modalText() {
  if (!modal) return;
  if (modal.kind === 'pan') {
    var tail = modal.byShift ? ' · 松开 Shift 完成 · Esc 取消'
                             : ' · 左键 / 回车 确认 · Esc 取消';
    showMode('平移中' + (modal.axis ? ' · 锁定 ' + AXIS_NAME[modal.axis] : '（自由）')
             + ' —— X/Y/Z 换轴向' + tail);
  } else {
    showMode('缩放中：向右 / 向上 = 拉近 —— 左键 / 回车 确认 · Esc 取消');
  }
}
function endModal(ok) {
  if (!modal) return;
  if (!ok) { view.pivot.copy(modal.pivot0); view.dist = modal.dist0; }
  modal = null; hideMode(); applyCam();
  userMoved = true;
}
function updateModal() {
  if (!modal) return;
  var dx = mx - modal.x0, dy = my - modal.y0;
  var e = halfExtent(modal.dist0);
  var wppx = 2 * e.hw / W, wppy = 2 * e.hh / H;   /* 每像素 = 多少世界单位 */
  if (modal.kind === 'pan') {
    /* 自由平移：屏幕平面内的位移（抓取习惯：画面跟着光标走 ✅）*/
    var off = _tmp.copy(modal.r0).multiplyScalar(-dx * wppx)
                 .addScaledVector(modal.u0, dy * wppy).clone();
    if (modal.axis) {
      /* ★ Blender 的轴向锁定：把位移【投影到该轴】上，只沿这根世界轴走 ✅
         （轴几乎正对镜头时屏幕投影≈0 → 改用鼠标竖向位移，否则按 Z 像“没反应”） */
      var ax = AXES[modal.axis];
      var scrLen = Math.hypot(ax.dot(modal.r0), ax.dot(modal.u0));
      var amt = (scrLen < 0.25) ? (dy * wppy) : off.dot(ax);
      off = ax.clone().multiplyScalar(amt);
    }
    view.dist = modal.dist0;
    view.pivot.copy(modal.pivot0).add(off);
  } else {
    /* 缩放：锚点（按下 S 时鼠标那点）在屏幕上不动 ✅ */
    var f = Math.exp(-(dx - dy) / 240);
    f = Math.max(0.05, Math.min(20, f));
    view.dist = modal.dist0 * f;
    clampDist();
    f = view.dist / modal.dist0;
    view.pivot.copy(modal.pivot0).addScaledVector(_tmp.copy(modal.anchor0).sub(modal.pivot0), 1 - f);
  }
  applyCam();
}

/* —— 中键：旋转（按住 Shift 时平移优先，见 keydown 的 shift 分支）✅ —— */
function startDrag(e) {
  camBasis();
  if (e.shiftKey) {
    drag = { kind: 'pan', x0: mx, y0: my, dist0: view.dist,
             pivot0: view.pivot.clone(), r0: _right.clone(), u0: _up.clone(), distKeep: true };
  } else {
    drag = { kind: 'orbit', x0: mx, y0: my, az0: view.az, el0: view.el };
  }
}
function updateDrag() {
  if (!drag) return;
  var dx = mx - drag.x0, dy = my - drag.y0;
  if (drag.kind === 'orbit') {
    /* 轨道旋转（turntable）：横拖绕场景 Y 轴，竖拖改仰角 ✅
       方向用「抓取」习惯：画面跟着光标走 ✅ */
    var k = 0.006;
    view.az = drag.az0 - dx * k;
    view.el = Math.max(-EL_MAX, Math.min(EL_MAX, drag.el0 + dy * k));
  } else {
    var e = halfExtent(drag.dist0);
    var wppx = 2 * e.hw / W, wppy = 2 * e.hh / H;
    view.dist = drag.dist0;
    view.pivot.copy(drag.pivot0)
      .addScaledVector(drag.r0, -dx * wppx)
      .addScaledVector(drag.u0,  dy * wppy);
  }
  applyCam();
  userMoved = true;
}
function endDrag() { if (drag) { drag = null; } }

cv.addEventListener('wheel', function (e) {
  e.preventDefault();
  if (modal || drag) return;
  var p = cvPos(e);
  mx = p.x; my = p.y;
  var step = 1.12;
  zoomAt(p.x, p.y, e.deltaY > 0 ? step : 1 / step);      /* 上滚 = 拉近 ✅ */
}, { passive: false });

window.addEventListener('mousemove', function (e) {
  var r = cv.getBoundingClientRect();
  mx = e.clientX - r.left; my = e.clientY - r.top;
  if (modal) { updateModal(); }
  else if (drag) { updateDrag(); }
});
window.addEventListener('mousedown', function (e) {
  if (modal) {                                   /* 模态里：左键确认，右键取消 ✅ */
    if (modal.byShift) { return; }               /* ★ 按住 Shift 的平移：不吃点击，靠松开 Shift 完成 ✅ */
    if (e.button === 2) { endModal(false); } else { endModal(true); }
    e.preventDefault();
    return;
  }
  if (e.button === 1) {                          /* 中键 = 旋转（按住 Shift 时上面已经 return → 平移优先）✅ */
    var p = cvPos(e); mx = p.x; my = p.y;
    startDrag(e);
    e.preventDefault();
  }
});
window.addEventListener('mouseup', function (e) { if (e.button === 1) { endDrag(); } });
cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
window.addEventListener('keydown', function (e) {
  var k = (e.key || '').toLowerCase();
  /* ★★ 按住 Shift = 平移（用户 2026-10-11 要求，替代原来的 G）✅ */
  if (k === 'shift') {
    if (!modal) { startModal('pan', true); }
    return;
  }
  if (modal) {
    if (k === 'escape') { endModal(false); e.preventDefault(); return; }
    if (modal.kind === 'pan' && AXES[k]) {       /* ★ X/Y/Z 轴向锁定（再按同键取消）✅ */
      modal.axis = (modal.axis === k) ? null : k;
      modalText();
      updateModal();
      e.preventDefault();
      return;
    }
    if (modal.byShift) { return; }               /* 按住 Shift 的平移：只认「松开 Shift」和 Esc ✅ */
    if (k === 'enter')  { endModal(true);  e.preventDefault(); return; }
    if (k === (modal.kind === 'pan' ? 'g' : 's')) { endModal(true); e.preventDefault(); return; }
    return;
  }
  if (k === 's') { startModal('scale'); e.preventDefault(); return; }
  /* ★ 动作播放快捷键（用户 2026-10-11）：← / → 逐帧，空格 播放/暂停 ✅ */
  if (k === 'arrowleft')  { stepFrame(-1); e.preventDefault(); return; }
  if (k === 'arrowright') { stepFrame(1);  e.preventDefault(); return; }
  if (k === ' ' || k === 'spacebar') { togglePlay(); e.preventDefault(); return; }
});
window.addEventListener('keyup', function (e) {
  /* ★ 松开 Shift → 平移完成（不用点确认）✅ */
  if ((e.key || '').toLowerCase() === 'shift' && modal && modal.byShift) { endModal(true); }
});
window.addEventListener('blur', function () {
  /* 切窗口/Alt+Tab 会丢掉 keyup → 兜底收尾，避免卡在平移中 ✅ */
  if (modal && modal.byShift) { endModal(true); }
});
/* 点了视口就抢焦点 —— 否则在调整台里点完按钮后按键不生效 ✅ */
window.addEventListener('click', function () { window.focus(); });
document.getElementById('btn-reset').addEventListener('click', function () { resetView(); });
