/* ============================================================================
   初始化：恢复页签、拉部件清单、拉设置、侧栏收起
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

(function () {
  var p = 'parts';
  try { p = localStorage.getItem('pet_lpane') || 'parts'; } catch (e) {}
  switchLPane(p === 'expr' ? 'expr' : 'parts');
})();

function partsPull() {
  fetch('/petparts').then(function (r) { return r.json(); })
    .then(function (names) { buildParts(names); })
    .catch(function () {});
}

/* 打开时读回当前值 ✅ */
fetch('/petsettings').then(function (r) { return r.json(); })
  .then(function (s) { setAll(s); setState('已连接 ✅', true); })
  .catch(function () { setState('连不上桌宠（桌宠没开？）⚠️', false); });
/* ★ 部件清单：桌宠载入模型后才会上报 → 拿不到就每 2 秒重试一次 ✅ */
partsPull();
setInterval(function () { if (!window._partNames) { partsPull(); } }, 2000);

/* ★★ 两侧功能栏收起 / 展开（用户要求 2026-10-11）
   收起后中栏视口自动变大（flex 自己分配）✅；状态记在 localStorage → 刷新后保持 ✅ */
function setupFold(sideId, railId, foldId) {
  var side = document.getElementById(sideId);
  var rail = document.getElementById(railId);
  var btn  = document.getElementById(foldId);
  if (!side || !rail || !btn) { return; }
  function apply(v) {
    side.classList.toggle('collapsed', !!v);
    try { localStorage.setItem('petfold_' + sideId, v ? '1' : '0'); } catch (e) {}
  }
  var init = false;
  try { init = localStorage.getItem('petfold_' + sideId) === '1'; } catch (e) {}
  apply(init);
  btn.addEventListener('click', function () { apply(true); });     /* 表头按钮 = 收起 ✅ */
  rail.addEventListener('click', function () { apply(false); });   /* 竖条点击 = 展开 ✅ */
}
setupFold('side-left',  'rail-left',  'fold-left');
setupFold('side-right', 'rail-right', 'fold-right');
