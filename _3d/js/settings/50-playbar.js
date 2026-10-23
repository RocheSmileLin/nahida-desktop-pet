/* ============================================================================
   底部通栏播放条（驱动 iframe 的 vwr API）
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* =====================================================================
   ★ 底部通栏播放条 D（用户 2026-10-11 要求）
     · 直接驱动视口 iframe 里的动作系统（viewer.html 暴露的 window.vwr API）
     · 动作清单/分组从 iframe 里取（单一数据源，不会不同步）
     · 自己可收起（状态记 localStorage）✅
   ===================================================================== */
(function () {
  var fr    = document.getElementById('viewer');
  var dbar  = document.getElementById('dbar');
  var sel   = document.getElementById('d-sel');
  var range = document.getElementById('d-range');
  var label = document.getElementById('d-label');
  var play  = document.getElementById('d-play');

  function api() { try { return fr.contentWindow.vwr; } catch (e) { return null; } }

  /* ① 填下拉：等 iframe 的 vwr 就绪（每 250ms 试，最多 15s）*/
  var filled = false, tries = 0;
  var t1 = setInterval(function () {
    var a = api();
    if (a && a.GROUPS && !filled) {
      a.GROUPS.forEach(function (g) {
        var og = document.createElement('optgroup');
        og.label = g[0];
        g[1].forEach(function (i) {
          var o = document.createElement('option');
          o.value = String(i); o.textContent = a.MOTIONS[i].n;
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
      filled = true;
      sel.value = '0';
      console.log('[调整台] 动作下拉已填充（' + sel.options.length + ' 项）✅');
    }
    if (filled || ++tries > 60) { clearInterval(t1); }
  }, 250);

  /* ② 挂状态回调：视口每次状态变化都会推给我们 */
  var hooked = false, tries2 = 0;
  var t2 = setInterval(function () {
    var a = api();
    if (a && !hooked) {
      a.onState = function (st) {
        if (st.loading) {
          label.textContent = '载入中…';
        } else if (!st.loaded) {
          label.textContent = '帧 — / —';
        } else if (st.total <= 0) {
          label.textContent = '静帧（无时间轴）';
          range.max = '0'; range.value = '0';
        } else {
          label.textContent = '帧 ' + st.frame + ' / ' + st.total + '（' + (st.frame / 30).toFixed(2) + 's）';
          range.max = String(st.total);
          range.value = String(st.frame);
        }
        play.textContent = st.playing ? '⏸ 暂停' : '▶ 播放';
        if (st.playing) { play.classList.add('on'); } else { play.classList.remove('on'); }
        sel.value = String(st.idx);
      };
      hooked = true;
      console.log('[调整台] 已接管动作播放条 ✅');
    }
    if (hooked || ++tries2 > 60) { clearInterval(t2); }
  }, 250);

  /* ③ 控件 → 视口 */
  sel.addEventListener('change', function () { var a = api(); if (a) { a.load(parseInt(sel.value, 10) || 0, 0); } window.focus(); });
  document.getElementById('d-first').addEventListener('click', function () { var a = api(); if (a) { a.step(-1e9); } });
  document.getElementById('d-prev').addEventListener('click',  function () { var a = api(); if (a) { a.step(-1); } });
  document.getElementById('d-next').addEventListener('click',  function () { var a = api(); if (a) { a.step(1); } });
  document.getElementById('d-last').addEventListener('click',  function () { var a = api(); if (a) { a.step(1e9); } });
  play.addEventListener('click', function () { var a = api(); if (a) { a.toggle(); } });
  range.addEventListener('input', function () { var a = api(); if (a) { a.seek(parseInt(range.value, 10) || 0); } });

})();
