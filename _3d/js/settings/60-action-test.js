/* ============================================================================
   动作测试页 + 渲染设置页（骨骼调试 / 链开关 / 导出）
   —— 由原 settings.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ============================================================================
   ★ 2026-10-13「动作测试」页签（用户要求）
   —— 直接读写 viewer 的内存姿态：诊断腿靠哪条链 / 切 IK·grant·物理 / 微调骨骼
   —— 只动内存，不碰 .vmd / .blend ✅
   ============================================================================ */
(function () {
  var fr = document.getElementById('viewer');
  var paneCur = 'param';
  var selName = null, hotOnly = false, bonesCache = [];

  /* ============================================================================
     ★ 2026-10-14 未固定改动跟踪（用户要求：未点「固定」就离开/切骨骼时要提醒）✅
     · dirty[骨名] = true 表示「改过但没固定到帧区间」
     · 只有「固定到帧区间」才算落地；↺/整帧回原值 会自动判定为无改动 ✅
     ============================================================================ */
  var dirty = {};
  var warned = {};                           /* 已提醒过的骨（同一根骨不反复弹窗）✅ */
  var lastActIdx = -1;                       /* 用于检测「换动作」✅ */
  function dirtyList() { return Object.keys(dirty).filter(function (k) { return dirty[k]; }); }
  function markDirty(n) { if (n) { dirty[n] = true; paintDirty(); } }
  function markClean(n) { if (n && dirty[n]) { delete dirty[n]; paintDirty(); } }
  function clearDirty() { dirty = {}; paintDirty(); }
  function paintDirty() {
    var el = document.getElementById('t-dirty');
    if (!el) { return; }
    var ls = dirtyList();
    if (!ls.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = '⚠️ <b>' + ls.length + '</b> 根骨骼有<b>未固定</b>的改动'
      + '（切换骨骼 / 离开本页 / 换动作都会丢失）：'
      + ls.slice(0, 8).map(function (x) { return '<code>' + x + '</code>'; }).join(' ')
      + (ls.length > 8 ? ' …' : '')
      + '<br>→ 想保留就点 <b>「固定到帧区间」</b>（区间留空 = 只固定当前帧）';
  }
  function confirmDiscard(what) {
    /* 有未固定改动时弹确认；返回 true = 可以继续 ✅ */
    var ls = dirtyList();
    if (!ls.length) { return true; }
    return confirm('有 ' + ls.length + ' 根骨骼的改动还没「固定到帧区间」：\n   '
      + ls.slice(0, 6).join('、') + (ls.length > 6 ? ' 等' : '')
      + '\n\n' + (what || '继续') + '会丢失这些改动。\n\n确定继续吗？');
  }
  /* 用「本帧原值」判断某根骨是否真的还有改动（点 ↺ 之后自动变干净）✅ */
  function syncDirty() {
    var a = api(); if (!a || !selName) { return; }
    var s = a.snapOf ? a.snapOf(selName) : null;
    var d = a.boneOf ? a.boneOf(selName) : null;
    if (!s || !d) { return; }
    var same = Math.abs(d.rx - s.x) < 0.05 && Math.abs(d.ry - s.y) < 0.05 && Math.abs(d.rz - s.z) < 0.05;
    if (same) { markClean(selName); } else { markDirty(selName); }
  }

  function api() { try { return fr.contentWindow.vwr; } catch (e) { return null; } }
  function paintTR(el, txt) {
    var v = parseFloat(el.value), pct = (v - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--p', pct + '%');
    var o = el.parentElement.querySelector('.vin');
    /* ★ 正在输入的框不覆盖（数值可输入，用户要求）✅ */
    if (o && document.activeElement !== o) { o.value = txt || v.toFixed(1); }
  }

  /* ---- 页签切换 ---- */
  document.querySelectorAll('.ptab').forEach(function (b) {
    b.addEventListener('click', function () {
      /* ★ 离开「动作测试」页前，若有未固定改动 → 提醒（用户要求）✅ */
      if (b.dataset.pane !== paneCur && paneCur === 'test' && !confirmDiscard('离开「动作测试」页')) {
        return;
      }
      paneCur = b.dataset.pane;
      document.querySelectorAll('.ptab').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.getElementById('pane-param').style.display = paneCur === 'param' ? '' : 'none';
      document.getElementById('pane-test').style.display = paneCur === 'test' ? '' : 'none';
      var _pr = document.getElementById('pane-render');
      if (_pr) { _pr.style.display = paneCur === 'render' ? '' : 'none'; }
      var t = document.getElementById('rtitle'), r = document.getElementById('rail-right');
      var _pname = paneCur === 'param' ? '参数' : (paneCur === 'test' ? '动作测试' : '渲染');
      if (t) { t.textContent = _pname; }
      if (r) { r.textContent = '‹ ' + _pname; }
      if (paneCur === 'test') { refresh(); }
    });
  });

/* ══════════ ★ 2026-10-17 渲染设置页（渲染引擎 / 世界环境 / 背景透明）══════════ */
(function () {
  var eng = document.getElementById('r-engine');
  var env = document.getElementById('r-env');
  var tra = document.getElementById('r-trans');
  var sha = document.getElementById('r-shadow');
  var too = document.getElementById('r-toon');
  if (!eng || !env || !tra) { return; }
  window._syncRenderPane = function () {
    eng.value = (cur && cur.renderMode) || 'white';
    env.value = (cur && cur.envPreset) || 'none';
    tra.checked = !!(cur && cur.bgTransparent);
    if (sha) { sha.checked = (cur && cur.shadowOn) !== false; }
    if (too) { too.checked = !!(cur && cur.toonOn); }
  };
  eng.addEventListener('change', function () { change('renderMode', eng.value); });
  env.addEventListener('change', function () { change('envPreset', env.value); });
  tra.addEventListener('change', function () { change('bgTransparent', tra.checked); });
  if (sha) { sha.addEventListener('change', function () { change('shadowOn', sha.checked); }); }
  if (too) { too.addEventListener('change', function () { change('toonOn', too.checked); }); }
})();

  /* ---- 骨骼列表 ---- */
  function isFK(n) { return /^(腿|膝|踝|足|足首)\.[LR]$/.test(n); }
  function tagOf(b) {
    if (b.isIK) { return '<span class="tag ik">IK</span>'; }
    if (b.isD) { return '<span class="tag d">D链</span>'; }
    if (isFK(b.n)) { return '<span class="tag fk">FK</span>'; }
    return '<span class="tag o">普通</span>';
  }
  function refreshList() {
    var box = document.getElementById('t-list');
    var kw = (document.getElementById('t-search').value || '').trim();
    var list = bonesCache.filter(function (b) {
      if (hotOnly && b.deg <= 1) { return false; }
      if (kw && b.n.indexOf(kw) < 0) { return false; }
      return true;
    });
    document.getElementById('t-count').textContent = '(' + list.length + ' / ' + bonesCache.length + ')';
    if (!list.length) {
      box.innerHTML = '<div class="brow"><span class="bn" style="color:var(--dim)">（无匹配）</span></div>';
      return;
    }
    box.innerHTML = list.map(function (b) {
      var hot = b.deg > 1 ? ' hot' : '';
      return '<div class="brow' + (b.n === selName ? ' on' : '') + '" data-n="' + b.n.replace(/"/g, '&quot;') + '">'
           + '<span class="bn">' + b.n + '</span>' + tagOf(b)
           + '<span class="dg' + hot + '">' + b.deg.toFixed(2) + '°</span></div>';
    }).join('');
    box.querySelectorAll('.brow').forEach(function (r) {
      r.addEventListener('click', function () { pick(r.dataset.n); });
    });
  }

  /* ---- 选中骨骼 → 滑块 ---- */
  function pick(n) {
    var a = api(); if (!a || !a.boneOf) { return; }
    /* ★ 切换骨骼前，若当前骨有未固定改动 → 提醒（用户要求）✅
       ⚠️ 改动本身仍在内存里；切帧 / 换动作 / 导出才会真正丢掉 ✅
       同一根骨只提醒一次，避免反复弹窗打断 ✅ */
    if (selName && n !== selName && dirty[selName] && !warned[selName]) {
      warned[selName] = true;
      if (!confirm('「' + selName + '」的改动还没「固定到帧区间」。\n\n'
                 + '这些改动目前只在内存里 —— 切帧、换动作、导出都会丢失。\n\n'
                 + '要切到「' + n + '」吗？（改动暂时还在，记得稍后点「固定到帧区间」）')) {
        warned[selName] = false;
        return;
      }
    }
    selName = n;
    var d = a.boneOf(n); if (!d) { return; }
    var hit = bonesCache.filter(function (x) { return x.n === n; })[0];
    document.getElementById('t-editcard').style.display = '';
    document.getElementById('t-edtitle').innerHTML = n + (hit ? '&nbsp;' + tagOf(hit) : '');
    [['x', 'rx'], ['y', 'ry'], ['z', 'rz']].forEach(function (p) {
      var el = document.getElementById('t-r' + p[0]);
      el.value = d[p[1]];
      paintTR(el, d[p[1]].toFixed(1));
    });
    refreshList();
  }

  [['x', 'rx'], ['y', 'ry'], ['z', 'rz']].forEach(function (p) {
    var el = document.getElementById('t-r' + p[0]);
    el.addEventListener('input', function () {
      var a = api(); if (!a || !selName) { return; }
      a.setBone(selName, p[0], parseFloat(el.value));
      paintTR(el);
      markDirty(selName);                    /* ★ 记录「未固定改动」✅ */
      bonesCache = (a.bones ? a.bones() : []) || [];
      refreshList();
    });
    /* ★ 数值框可直接输入（用户要求）：回车 或 失焦 生效 ✅ */
    var inp = document.getElementById('t-r' + p[0] + '-v');
    function applyInput() {
      var a = api(); if (!a || !selName) { return; }
      var v = parseFloat(inp.value);
      if (isNaN(v)) { v = parseFloat(el.value); }
      v = Math.max(-180, Math.min(180, v));
      el.value = v;
      a.setBone(selName, p[0], v);
      inp.value = v.toFixed(1);
      paintTR(el, v.toFixed(1));
      markDirty(selName);                    /* ★ 记录「未固定改动」✅ */
      bonesCache = (a.bones ? a.bones() : []) || [];
      refreshList();
    }
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); applyInput(); inp.blur(); }
    });
    inp.addEventListener('blur', applyInput);
    document.getElementById('t-r' + p[0] + '-r').addEventListener('click', function () {
      var a = api(); if (!a || !selName) { return; }
      /* ★ 用户要求：每个 ↺ 只管自己那一轴（只复位 X / 只复位 Y / 只复位 Z）✅ */
      if (a.restoreSnap) { a.restoreSnap(selName, p[0]); }
      else if (a.resetBone) { a.resetBone(selName); }
      pick(selName);
      syncDirty();                           /* ★ 三轴都回到本帧原值 → 自动变干净 ✅ */
    });
  });

  /* ---- 链开关 ---- */
  var SW = [['ik', 't-ik'], ['grant', 't-grant'], ['physics', 't-phys']];
  function paintSw() {
    var a = api(); if (!a || !a.flag) { return; }
    SW.forEach(function (t) {
      var v = a.flag(t[0]);
      var b = document.getElementById(t[1]);
      if (v === null) { b.className = ''; b.querySelector('.s').textContent = '—'; return; }
      b.className = v ? 'on' : 'off';
      var sub = '';
      if (t[0] === 'ik') { sub = v ? ' · 足IK 开' : ' · 足IK 关'; }
      else if (t[0] === 'grant') { sub = v ? ' · 开' : ' · 关'; }
      else { sub = v ? ' · 开' : ' · 关'; }
      b.querySelector('.s').textContent = sub;
    });
  }
  SW.forEach(function (t) {
    document.getElementById(t[1]).addEventListener('click', function () {
      var a = api(); if (!a || !a.setFlag) { return; }
      a.setFlag(t[0], !a.flag(t[0]));
      paintSw();
      try { a.reloadPose(); } catch (e) {}
      refreshList();
    });
  });

  document.getElementById('t-replay').addEventListener('click', function () {
    var a = api();
    if (a && a.reloadPose) { a.reloadPose(); }
    refresh();
  });

  /* ---- 诊断 ---- */
  function paintDiag() {
    var el = document.getElementById('t-diag');
    var a = api();
    if (!a || !a.diagnose || !a.state) { el.textContent = '视口还没连上（等模型载入完成）…'; return; }
    var st = a.state(), dg = a.diagnose();
    var nm = (a.MOTIONS && a.MOTIONS[st.idx]) ? a.MOTIONS[st.idx].n : '—';
    document.getElementById('t-name').textContent = nm + ' · ' + st.total + ' 帧';
    el.innerHTML = '<b>腿驱动：</b>' + dg.mode + '<br>'
      + 'FK 有值 ' + dg.fk + ' 根 ｜ D 链有值 ' + dg.d + ' 根 ｜ IK 有值 ' + dg.ik + ' 根<br>'
      + '建议 <code>ik: ' + dg.ikOff + '</code>（' + (dg.ikOff ? '关足IK' : '开足IK') + '）'
      + ' ｜ 当前 <code>' + (a.flag('ik') ? 'true' : 'false') + '</code>';
  }

  function refresh() {
    var a = api(); if (!a) { return; }
    bonesCache = (a.bones ? a.bones() : []) || [];
    refreshList(); paintSw(); paintDiag(); paintFreeze(); paintPatches(); paintDirty();
    if (selName) { pick(selName); }
  }

  /* ---- 整帧回原值 / 固定到帧区间（★ 用户要求：不用一帧一帧改）---- */
  function paintPatches() {
    var el = document.getElementById('t-plist');
    var a = api();
    if (!a || !a.listPatches) { el.textContent = '（视口未连上）'; return; }
    var ps = a.listPatches();
    if (!ps.length) { el.innerHTML = '（还没有固定区间）'; return; }
    el.innerHTML = '已固定 ' + ps.length + ' 条（一个骨骼一条）：'
      + ps.map(function (p, i) {
          var v = (p.v && typeof p.v === 'object')
                ? ('X' + Number(p.v.x).toFixed(1) + ' Y' + Number(p.v.y).toFixed(1) + ' Z' + Number(p.v.z).toFixed(1))
                : (p.a + '=' + Number(p.v).toFixed(1));
          return '<code>' + p.b + '  ' + v + '°  [' + p.f + '~' + p.t + ']'
               + '<a href="#" class="t-pdel" data-i="' + i + '" title="删除这一条"'
               + ' style="color:#e0a0a0;margin-left:5px;text-decoration:none">×</a></code>';
        }).join(' ')
      + ' <a href="#" id="t-pclear" style="color:var(--accent);margin-left:6px">清空全部</a>';
    /* ★ 单条删除（用户要求）：删完重算当前帧，补丁不再生效 ✅ */
    el.querySelectorAll('.t-pdel').forEach(function (x) {
      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (!a.removePatch) { return; }
        a.removePatch(parseInt(x.dataset.i, 10));
        if (a.state) { try { a.seek(a.state().frame); } catch (e) {} }
        if (selName) { pick(selName); }
        paintPatches();
      });
    });
    var c = document.getElementById('t-pclear');
    if (c) {
      c.addEventListener('click', function (ev) {
        ev.preventDefault();
        a.clearPatches();
        if (a.state) { try { a.seek(a.state().frame); } catch (e) {} }
        if (selName) { pick(selName); }
        paintPatches();
      });
    }
  }
  document.getElementById('t-restore-all').addEventListener('click', function () {
    var a = api(); if (!a || !a.restoreSnap) { return; }
    a.restoreSnap();                       /* 全部骨回本帧原值 ✅ */
    clearDirty();                          /* ★ 全回原值 → 没有未固定改动了 ✅ */
    if (selName) { pick(selName); } else { refresh(); }
  });
  document.getElementById('t-patch-add').addEventListener('click', function () {
    var a = api();
    if (!a || !a.addPatch) { alert('视口未连上 ⚠️'); return; }
    if (!selName) { alert('先在列表里选中一根骨骼 ⚠️'); return; }
    var st = a.state ? a.state() : { frame: 0 };
    var f = parseInt(document.getElementById('t-pf').value, 10);
    var t = parseInt(document.getElementById('t-pt').value, 10);
    if (isNaN(f)) { f = st.frame; }        /* 留空 = 只固定当前帧 ✅ */
    if (isNaN(t)) { t = f; }
    if (f > t) { var k = f; f = t; t = k; }
    /* ★ 一个骨骼一条：X/Y/Z 一起提交（用户要求）✅ */
    var vals = {
      x: parseFloat(document.getElementById('t-rx').value),
      y: parseFloat(document.getElementById('t-ry').value),
      z: parseFloat(document.getElementById('t-rz').value)
    };
    a.addPatch(selName, f, t, vals);
    paintPatches();
    a.applyPatches();
    markClean(selName);                    /* ★ 已固定 → 不再是「未固定改动」✅ */
    delete warned[selName];
    alert('已把 ' + selName + ' 的 X/Y/Z 固定到帧 ' + f + '~' + t + ' ✅\n\n切到该区间内任意一帧即可看到效果（预览与导出共用同一套区间）');
  });

  /* ---- ❄ 冻结开关（改骨骼前必须开，否则每帧被动画 / IK / 付与算回去）---- */
  var freezeEl = document.getElementById('t-freeze');
  function paintFreeze() {
    var a = api();
    if (!a || !a.freeze) { return; }
    freezeEl.classList.toggle('on', !!a.freeze());
  }
  freezeEl.addEventListener('click', function () {
    var a = api();
    if (!a || !a.freeze) { return; }
    a.freeze(!a.freeze());
    paintFreeze();
  });

  document.getElementById('t-search').addEventListener('input', refreshList);
  document.getElementById('t-hot').addEventListener('click', function () {
    hotOnly = !this.classList.contains('on');
    this.classList.toggle('on', hotOnly);
    refreshList();
  });

  /* viewer 状态变化（换动作 / 换帧）→ 测试页可见时自动刷新 */
  /* ★ 用 addState 多播：不能直接写 onState，否则会覆盖下方播放条的回调 ✅ */
  var tries = 0;
  var h = setInterval(function () {
    var a = api();
    if (a) {
      var fn = function (st) {
        /* ★ 换动作检测（用户要求）：切了动作 = 之前的未固定改动已经丢了 ✅ */
        var idx = (st && st.idx !== undefined) ? st.idx
                : ((a.state && a.state()) ? a.state().idx : undefined);
        if (idx !== undefined && lastActIdx !== -1 && idx !== lastActIdx) {
          var lost = dirtyList();
          if (lost.length) {
            clearDirty();
            warned = {};
            alert('已切换动作 —— 「' + lost.slice(0, 6).join('、') + (lost.length > 6 ? ' 等' : '')
                + '」的改动还没「固定到帧区间」，已经丢失了。\n\n下次记得先点「固定到帧区间」✅');
          }
        }
        if (idx !== undefined) { lastActIdx = idx; }
        if (paneCur === 'test') { refresh(); }
      };
      if (a.addState) { a.addState(fn); } else { a.onState = fn; }
      clearInterval(h);
      return;
    }
    if (++tries > 60) { clearInterval(h); }
  }, 500);

  /* 「套用建议」：先弹提示（写回 motions.js 要走桌宠侧接口，下一步接）✅ */
  /* ★★「套用建议」：把当前链开关状态写回 motions.js 的那一个动作那一行
     ⚠️ 语义映射（注意足IK 是反的）：
          链开关 ik(开/关足IK) → motions.js 的 ik      = 关足IK（true = 关）
          链开关 grant         → motions.js 的 noGrant = !grant
          链开关 physics       → motions.js 的 noPhys  = !physics  ✅ */
  document.getElementById('t-apply').addEventListener('click', function () {
    var a = api();
    if (!a || !a.state || !a.flag) { alert('视口还没连上 ⚠️'); return; }
    var st = a.state();
    var mo = (a.MOTIONS && a.MOTIONS[st.idx]) ? a.MOTIONS[st.idx] : null;
    if (!mo || !mo.n) { alert('取不到当前动作 ⚠️'); return; }
    var ikOn = a.flag('ik'), grantOn = a.flag('grant'), physOn = a.flag('physics');
    var payload = { name: mo.n, ik: !ikOn, noGrant: !grantOn, noPhys: !physOn };
    var txt = '把【当前链开关状态】写回 motions.js 里的动作「' + mo.n + '」：\n\n'
      + '   足IK  : ' + (ikOn ? '开' : '关') + '   →   ik: ' + payload.ik + '\n'
      + '   付与  : ' + (grantOn ? '开' : '关') + '   →   noGrant: ' + payload.noGrant + '\n'
      + '   物理  : ' + (physOn ? '开' : '关') + '   →   noPhys: ' + payload.noPhys + '\n\n'
      + '⚠️ 只改这一行（其余行与注释一个字节不动），改前自动备份 motions.js.bak。\n'
      + '⚠️ 改完要刷新页面 / 重启桌宠才生效。\n\n确定写入吗？';
    if (!confirm(txt)) { return; }
    fetch('/petmotionflags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); })
      .then(function (r) {
        if (r && r.ok) {
          alert('已写入 ✅' + (r.changed ? '' : '（内容本来就是这样，未改动）')
              + '\n\n新的一行：\n' + r.line);
          paintDiag();
        } else {
          alert('写入失败 ⚠️\n' + ((r && r.why) || '未知原因'));
        }
      })
      .catch(function (e) { alert('请求出错 ⚠️\n' + e); });
  });

  /* ---- ★ 导出 VMD（第三阶段）---- */
  document.getElementById('btn-export').addEventListener('click', function () {
    var a = api();
    if (!a || !a.exportVmd) { alert('视口还没连上 ⚠️'); return; }
    var st = a.state ? a.state() : { total: 0 };
    var f0 = 0, f1 = st.total || 0;
    /* ★ 提醒：未固定的改动不会进文件（用户要求方案 1）✅ */
    var _ls = dirtyList();
    var _extra = _ls.length
      ? ('\n\n⚠️ 注意：有 ' + _ls.length + ' 根骨骼的改动【没有固定到帧区间】，\n'
         + '   导出时会被动画覆盖、不会写进文件：\n   ' + _ls.slice(0, 6).join('、')
         + (_ls.length > 6 ? ' 等' : '') + '\n   → 想保留请先点「固定到帧区间」')
      : '';
    if (!confirm('导出范围：帧 ' + f0 + ' ~ ' + f1 + '（共 ' + (f1 - f0 + 1) + ' 帧）\n'
               + '会带上「已固定的帧区间补丁」+ 当前全部骨骼姿态。'
               + _extra + '\n\n继续吗？')) { return; }
    var r = null;
    try { r = a.exportVmd(f0, f1, 'MMD'); } catch (e) { alert('导出出错：' + e); return; }
    if (!r || !r.ok) { alert('导出失败：' + (r ? r.why : '未知')); return; }
    alert('已导出 ✅\n骨骼 ' + r.bones + ' 根 · ' + r.recs + ' 条骨帧 · '
        + (r.bytes / 1024).toFixed(1) + ' KB\n文件已开始下载（姿态_导出.vmd）');
  });

  /* ★ 关闭 / 刷新页面时提醒（用户要求）✅
     ⚠️ 现代浏览器会忽略自定义文案、只弹通用提示，但足以拦住误关 ✅ */
  window.addEventListener('beforeunload', function (e) {
    var n = dirtyList().length;
    if (n) {
      e.preventDefault();
      e.returnValue = '有 ' + n + ' 根骨骼的改动还没「固定到帧区间」';
      return e.returnValue;
    }
  });
})();
