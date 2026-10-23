/* ============================================================================
   动作系统：VMD 装载、播放、对外 vwr API
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ================= 动作系统（用户 2026-10-11 要求）=================
   · 下拉选动作（6 个 VMD）→ 载入
   · 逐帧：|◀ ◀ [播放/暂停] ▶ ▶|  （快捷键 ← / → 逐帧、空格 播放暂停）
   · 进度条：可自由拖到任意帧（1 帧 = 1/30 秒）✅
   ================================================================ */
/* ★ 2026-10-12：动作清单已抽成【单一数据源】 _3d/motions.js（与 pet.html 共用，下标一一对应）
   —— 这里不再另存一份，避免"改了桌面忘改浏览器" ✅
   字段说明见 motions.js（n / f / ik / a / b / loop / hint）✅ */
/* SYNC:motionsSrc —— 本页与 pet.html 共用 _3d/motions.js（_check_sync.py 核对）✅ */
var MOTIONS = MOTION_DEFS;
var MOTION_GROUPS = MOTION_GROUP_DEFS;
var MOT = { clip: null, mixer: null, action: null, dur: 0, frame: 0, total: 0,
            fps: 30, playing: false, loading: false, idx: 0 };
var mSel = document.getElementById('m-sel');
var mRange = document.getElementById('m-range');
var mLabel = document.getElementById('m-label');
var mPlay = document.getElementById('m-play');
MOTION_GROUPS.forEach(function (g) {
  var og = document.createElement('optgroup');
  og.label = g[0];
  g[1].forEach(function (i) {
    if (!MOTIONS[i]) { return; }   /* ★ 动作被删后分组下标可能越界 → 跳过，别让整条下拉渲染中断 ✅ */
    var o = document.createElement('option');
    o.value = String(i);
    o.textContent = MOTIONS[i].n + (MOTIONS[i].hint ? '（' + MOTIONS[i].hint + '）' : '');
    og.appendChild(o);
  });
  mSel.appendChild(og);
});
mSel.value = '0';
/* ★ 被调整台 iframe 嵌入时：隐藏自己的播放条（父页面底部有通栏的 D 条）✅ */
var EMBEDDED = (window.self !== window.top);
if (EMBEDDED) {
  /* 播放条由调整台底部的通栏 D 条接管 → 这里藏掉自己那条 ✅
     操作提示【保留】在视口左上角（用户 2026-10-11 要求）✅ */
  document.getElementById('mbar').style.display = 'none';
}
/* ★ 对外 API（调整台的通栏播放条调这一套）✅ */
window.vwr = {
  MOTIONS: MOTIONS, GROUPS: MOTION_GROUPS, EMBEDDED: EMBEDDED,
  state: function () {
    return { idx: MOT.idx, frame: MOT.frame, total: MOT.total, dur: MOT.dur,
             playing: MOT.playing, loading: MOT.loading, loaded: !!MOT.clip };
  },
  load:   function (i, sf) { loadMotion(i, sf || 0); },
  /* ★★ 2026-10-18：调整台点「表情预设」→ 只作用于浏览器端（不写 /petsettings）✅ */
  applyLocalExpr: function (e) { applyLocalExpr(e); },
  clearLocalExpr: function () { applyLocalExpr({}); },
  seek:   function (f) { seekFrame(f); },
  step:   function (d) { stepFrame(d); },
  toggle: function () { togglePlay(); },
  onState: null,           /* 父页面挂回调：状态一变就调 ✅ */
  _stateFs: [],            /* ★ 多播：播放条与「动作测试」各挂一个，互不覆盖 ✅ */
  addState: function (fn) {
    if (typeof fn === 'function' && this._stateFs.indexOf(fn) < 0) { this._stateFs.push(fn); }
  },

  /* ★ 2026-10-13「动作测试台」API（调整台右栏「动作测试」页签用）
     —— 只读写内存里的骨骼姿态，不动任何 .vmd / .blend ✅ */
  bones: function () {                 /* 全部骨骼：当前旋转角 / 位移 / 是否 D 链·IK */
    var out = [];
    if (!S.mesh) return out;
    var q = new THREE.Quaternion(), e = new THREE.Euler();
    Object.keys(S.bones).forEach(function (n) {
      var b = S.bones[n], r = S.rest && S.rest[n];
      var cur = q.setFromEuler(b.rotation);
      var rst = r ? new THREE.Quaternion().setFromEuler(e.set(r.rx, r.ry, r.rz)) : new THREE.Quaternion();
      var d = rst.clone().invert().multiply(cur);
      out.push({
        n: n,
        deg: 2 * Math.acos(Math.min(1, Math.abs(d.w))) * 180 / Math.PI,
        px: b.position.x - (r ? r.px : 0),
        py: b.position.y - (r ? r.py : 0),
        pz: b.position.z - (r ? r.pz : 0),
        isD: /D\.[LR]$/.test(n),
        isIK: /IK/.test(n)
      });
    });
    return out;
  },
  boneOf: function (n) {               /* 单根骨：欧拉角(度) + 位移，供滑块读写 */
    var b = S.bones[n], r = S.rest && S.rest[n];
    if (!b) return null;
    return { rx: b.rotation.x * 180 / Math.PI, ry: b.rotation.y * 180 / Math.PI,
             rz: b.rotation.z * 180 / Math.PI,
             px: b.position.x, py: b.position.y, pz: b.position.z,
             rest: r ? { rx: r.rx * 180 / Math.PI, ry: r.ry * 180 / Math.PI, rz: r.rz * 180 / Math.PI,
                         px: r.px, py: r.py, pz: r.pz } : null };
  },
  setBone: function (n, k, v) {         /* k: 'x'|'y'|'z'（度）或 'px'|'py'|'pz' */
    var b = S.bones[n];
    if (!b) return false;
    if (k === 'px' || k === 'py' || k === 'pz') { b.position[k[1]] = v; }
    else { b.rotation[k] = v * Math.PI / 180; }
    if (S.mesh) S.mesh.updateMatrixWorld(true);
    try { needsRender = true; } catch (e) {}
    return true;
  },
  resetBone: function (n) {             /* 单根骨回到 bind pose */
    var b = S.bones[n], r = S.rest && S.rest[n];
    if (!b || !r) return false;
    b.rotation.set(r.rx, r.ry, r.rz);
    b.position.set(r.px, r.py, r.pz);
    if (S.mesh) S.mesh.updateMatrixWorld(true);
    try { needsRender = true; } catch (e) {}
    return true;
  },
  flag: function (k) {                  /* k: 'ik'|'grant'|'physics' */
    return (S.helper && S.helper.enabled) ? !!S.helper.enabled[k] : null;
  },
  setFlag: function (k, v) {
    if (!S.helper || !S.helper.enabled) return null;
    S.helper.enabled[k] = !!v;
    return !!S.helper.enabled[k];
  },
  diagnose: function () {               /* 判断这个动作的腿靠哪条链驱动 → 建议 ik/fk */
    var B = window.vwr.bones(), d = 0, fk = 0, ik = 0;
    var FK = { '腿.L': 1, '腿.R': 1, '膝.L': 1, '膝.R': 1, '踝.L': 1, '踝.R': 1 };
    B.forEach(function (b) {
      if (b.deg <= 1) return;
      if (b.isD) { d++; }
      if (FK[b.n]) { fk++; }
      if (b.isIK) { ik++; }
    });
    var mode, ikOff;
    if (d > 0 && fk > 0) { mode = 'FK + D 链都有值（叠加风险）'; ikOff = false; }
    else if (d > 0)      { mode = 'D 链驱动（FK 恒等）'; ikOff = true; }
    else if (fk > 0)     { mode = 'FK 驱动（D 链恒等/无）'; ikOff = true; }
    else                 { mode = '腿部无动作'; ikOff = true; }
    return { d: d, fk: fk, ik: ik, mode: mode, ikOff: ikOff };
  },
  reloadPose: function () {             /* 重放当前帧（切完 IK/grant 开关后立刻生效）✅ */
    if (!MOT.clip) return;
    seekFrame(MOT.frame);
  },
  freeze: function (v) {                /* ★ 冻结：停掉 helper.update（动画/IK/付与/物理），
                                           手动改的骨骼才不会被每帧算回去；不传参 = 查询 ✅ */
    if (v === undefined) { return MMD_FROZEN; }
    MMD_FROZEN = !!v;
    try { needsRender = true; } catch (e) {}
    return MMD_FROZEN;
  },
  redraw: function () { try { needsRender = true; } catch (e) {} },

  /* ★ 快照 / 帧范围补丁（「回原值」与「区间调整」用）✅ */
  hasSnap: function () { return !!_snap; },
  snapOf: function (n) {                 /* ★ 本帧原始值（度），供「是否还有改动」判断 ✅ */
    var s = _snap && _snap[n];
    return s ? { x: s.rx * 180 / Math.PI, y: s.ry * 180 / Math.PI, z: s.rz * 180 / Math.PI,
                 px: s.px, py: s.py, pz: s.pz } : null;
  },
  restoreSnap: function (n, axis) {      /* axis 可选：'x'|'y'|'z' → 只恢复那一轴；
                                            不给 axis = 整根骨（含位置）回到本帧原值 ✅ */
    if (!_snap) { return false; }
    var keys = n ? [n] : Object.keys(_snap);
    var hit = 0;
    keys.forEach(function (k) {
      var b = S.bones[k], s = _snap[k];
      if (!b || !s) { return; }
      if (axis === 'x') { b.rotation.x = s.rx; }
      else if (axis === 'y') { b.rotation.y = s.ry; }
      else if (axis === 'z') { b.rotation.z = s.rz; }
      else {
        b.rotation.set(s.rx, s.ry, s.rz);
        b.position.set(s.px, s.py, s.pz);
      }
      hit++;
    });
    try { needsRender = true; } catch (e) {}
    return hit;
  },
  addPatch: function (bone, from, to, vals) {   /* ★ 一个骨骼一条（含 X/Y/Z，用户要求）✅
                                                   同骨同区间再固定 = 覆盖那一条（不重复堆）✅ */
    for (var i = 0; i < _patches.length; i++) {
      var p = _patches[i];
      if (p.b === bone && p.f === from && p.t === to) {
        p.v = { x: vals.x, y: vals.y, z: vals.z };
        try { needsRender = true; } catch (e) {}
        return i;
      }
    }
    _patches.push({ b: bone, f: from, t: to, v: { x: vals.x, y: vals.y, z: vals.z } });
    return _patches.length - 1;
  },
  listPatches: function () { return _patches.slice(); },
  removePatch: function (i) {             /* ★ 单条删除（用户要求）✅ */
    if (i < 0 || i >= _patches.length) { return false; }
    _patches.splice(i, 1);
    try { needsRender = true; } catch (e) {}
    return true;
  },
  clearPatches: function () {
    var n = _patches.length; _patches = [];
    try { needsRender = true; } catch (e) {}
    return n;
  },
  applyPatches: function (frame) {
    var f = (frame === undefined) ? MOT.frame : frame;
    var n = applyPatches(f);
    try { needsRender = true; } catch (e) {}
    return n;
  },

  /* ★ 导出 VMD（第三阶段）
     反向公式取自 MMDLoader.buildSkeletalAnimation（lib/MMDLoader.js:1446-1455）：
        vmd.rotation = bone.quaternion                 （原样，不做坐标转换）
        vmd.position = bone.position − bind.position   （bind 即加载时的初始值 S.rest）
     骨名走 bone_sjis.js 的 Shift-JIS 查表（浏览器没有 SJIS 编码器）✅
     逐帧采样会带上「帧区间补丁」⇒ 【看到的 = 导出的】✅ */
  exportVmd: function (f0, f1, modelName) {
    if (!S.mesh || !MOT.clip) { return { ok: false, why: '模型或动作未载入' }; }
    if (typeof BONE_SJIS === 'undefined') { return { ok: false, why: 'bone_sjis.js 未加载' }; }
    f0 = Math.max(0, Math.round(f0 || 0));
    f1 = Math.min(MOT.total, Math.round((f1 === undefined || f1 === null) ? MOT.total : f1));
    if (f1 < f0) { return { ok: false, why: '帧区间无效' }; }

    var oldF = MOT.frame, wasP = MOT.playing;
    if (wasP) { MOT.playing = false; if (MOT.action) { MOT.action.paused = true; } }

    /* ★ 采样期间关掉 ik / grant / physics（2026-10-14 实测）：
       桌宠载入 VMD 后会自己跑 IK/grant 修正；导出必须给【输入值】而非【结果值】，
       否则桌宠再算一遍 = 算两次（腿会被拽错）✅
       关掉后读到的正是纯 FK 曲线值 = VMD 里该存的东西 ✅
       保留 animation（否则 mixer 不更新、骨骼停在旧值）✅ */
    var _en = S.helper ? S.helper.enabled : null;
    var _sIk = _en ? _en.ik : null, _sGrant = _en ? _en.grant : null, _sPhys = _en ? _en.physics : null;
    if (_en) { _en.ik = false; _en.grant = false; _en.physics = false; }

    var names = Object.keys(S.bones), data = {}, totalRec = 0, f, i;
    for (f = f0; f <= f1; f++) {
      seekFrame(f);
      for (i = 0; i < names.length; i++) {
        var n = names[i];
        if (!BONE_SJIS[n]) { continue; }              /* 编不了 Shift-JIS 的骨（简体字那批）跳过 ✅ */
        var b = S.bones[n], r = S.rest && S.rest[n];
        if (!r) { continue; }
        var px = b.position.x - r.px, py = b.position.y - r.py, pz = b.position.z - r.pz;
        var q = b.quaternion;
        /* ★ 四元数转换（2026-10-14 实测得出）：
           three.js 的 bone.quaternion 与 VMD 存的四元数相差一个 (x,y) 取反，
           即绕 Z 轴 180° 的共轭 → vmd_q = (-qx, -qy, qz, qw) ✅
           （腰/上半身/下半身/左足/右足 五根骨逐分量验证一致）*/
        var qx = -q.x, qy = -q.y, qz = q.z, qw = q.w;
        var ident = Math.abs(Math.abs(qw) - 1) < 1e-4 && Math.abs(qx) < 1e-4
                 && Math.abs(qy) < 1e-4 && Math.abs(qz) < 1e-4;
        var zero = Math.abs(px) < 1e-6 && Math.abs(py) < 1e-6 && Math.abs(pz) < 1e-6;
        if (ident && zero) { continue; }              /* 恒等骨不写（文件更小）✅ */
        (data[n] = data[n] || []).push({ f: f, p: [px, py, pz], q: [qx, qy, qz, qw] });
        totalRec++;
      }
    }
    if (_en) { _en.ik = _sIk; _en.grant = _sGrant; _en.physics = _sPhys; }   /* 恢复开关 ✅ */
    if (wasP) { MOT.playing = true; if (MOT.action) { MOT.action.paused = false; } }
    seekFrame(oldF);
    if (!totalRec) { return { ok: false, why: '这一区间没有任何骨骼变化' }; }

    /* ---- 拼 VMD 二进制 ---- */
    var buf = new ArrayBuffer(50 + 4 + 111 * totalRec + 16);
    var dv = new DataView(buf), u8 = new Uint8Array(buf), k, off;
    var HDR = 'Vocaloid Motion Data 0002';
    for (i = 0; i < 30; i++) { u8[i] = i < HDR.length ? HDR.charCodeAt(i) : 0; }
    var mn = (modelName || 'MMD');
    for (i = 0; i < 20; i++) { u8[30 + i] = i < mn.length ? mn.charCodeAt(i) : 0; }
    dv.setUint32(50, totalRec, true);
    off = 54;
    Object.keys(data).forEach(function (nm) {
      var hx = BONE_SJIS[nm], nb = hx.length / 2;
      data[nm].forEach(function (rec) {
        for (k = 0; k < 15; k++) { u8[off + k] = 0; }
        for (k = 0; k < nb && k < 15; k++) { u8[off + k] = parseInt(hx.substr(k * 2, 2), 16); }
        dv.setUint32(off + 15, rec.f, true);
        dv.setFloat32(off + 19, rec.p[0], true);
        dv.setFloat32(off + 23, rec.p[1], true);
        dv.setFloat32(off + 27, rec.p[2], true);
        dv.setFloat32(off + 31, rec.q[0], true);
        dv.setFloat32(off + 35, rec.q[1], true);
        dv.setFloat32(off + 39, rec.q[2], true);
        dv.setFloat32(off + 43, rec.q[3], true);
        /* 插值 64B：MMD 线性默认（每 16B = 20×8 + 107×8）*/
        for (k = 0; k < 64; k++) { u8[off + 47 + k] = (k % 16 < 8) ? 20 : 107; }
        off += 111;
      });
    });
    dv.setUint32(off, 0, true);                       /* 相机段 0 */
    dv.setUint32(off + 4, 0, true);                   /* 光照段 0 */
    dv.setUint32(off + 8, 0, true);                   /* 自阴影段 0 */
    dv.setUint32(off + 12, 0, true);                  /* 模型显示段 0 */

    /* ---- 下载 ---- */
    var blob = new Blob([buf], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '姿态_导出.vmd';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 900);

    return { ok: true, bones: Object.keys(data).length, recs: totalRec,
             bytes: buf.byteLength, frames: f1 - f0 + 1, f0: f0, f1: f1 };
  }
};
function vwrNotify() {
  if (!window.vwr) { return; }
  var st = window.vwr.state();
  if (window.vwr.onState) { try { window.vwr.onState(st); } catch (e) {} }
  var fs = window.vwr._stateFs || [];
  for (var i = 0; i < fs.length; i++) { try { fs[i](st); } catch (e2) {} }
}

function motSetEnabled(on) {
  mSel.disabled = !on;
  ['m-first', 'm-prev', 'm-play', 'm-next', 'm-last'].forEach(function (id) {
    document.getElementById(id).disabled = !on;
  });
  mRange.disabled = !on;
  vwrNotify();
}
function motUI() {
  if (MOT.loading) { mLabel.textContent = '载入中…'; vwrNotify(); return; }
  if (!MOT.clip) { mLabel.textContent = '帧 — / —'; vwrNotify(); return; }
  if (MOT.total <= 0) {                     /* ★ 单帧静态姿势（如「自然站立」）→ 没有时间轴 ✅ */
    mLabel.textContent = '静帧（无时间轴）';
    mRange.max = '0'; mRange.value = '0';
  } else {
    mLabel.textContent = '帧 ' + MOT.frame + ' / ' + MOT.total
                       + '（' + (MOT.frame / MOT.fps).toFixed(2) + 's）';
    mRange.max = String(MOT.total);
    mRange.value = String(MOT.frame);
  }
  mPlay.textContent = MOT.playing ? '⏸ 暂停' : '▶ 播放';
  if (MOT.playing) { mPlay.classList.add('on'); } else { mPlay.classList.remove('on'); }
  vwrNotify();
}

/* ★ 2026-10-13「动作测试」：帧范围补丁 + 本帧原始姿态快照 ✅
   · 补丁 = "某骨在某帧区间内固定成某值"，预览与导出共用（不改 clip 本体）✅
   · 快照 = 换帧后立刻记下这一帧的原始姿态 → 「回原值」用它，而不是回到 bind pose ✅ */
var _patches = [];
var _snap = null;
function takeSnap() {
  _snap = {};
  Object.keys(S.bones).forEach(function (n) {
    var b = S.bones[n];
    _snap[n] = { rx: b.rotation.x, ry: b.rotation.y, rz: b.rotation.z,
                 px: b.position.x, py: b.position.y, pz: b.position.z };
  });
}
function applyPatches(frame) {
  var hit = 0;
  for (var i = 0; i < _patches.length; i++) {
    var p = _patches[i];
    if (frame < p.f || frame > p.t) { continue; }
    var b = S.bones[p.b];
    if (!b) { continue; }
    if (p.v && typeof p.v === 'object') {          /* ★ 一个骨骼一条（X/Y/Z 一起）✅ */
      if (typeof p.v.x === 'number') { b.rotation.x = p.v.x * Math.PI / 180; }
      if (typeof p.v.y === 'number') { b.rotation.y = p.v.y * Math.PI / 180; }
      if (typeof p.v.z === 'number') { b.rotation.z = p.v.z * Math.PI / 180; }
    } else {                                        /* 兼容旧格式 */
      b.rotation[p.a] = p.v * Math.PI / 180;
    }
    hit++;
  }
  return hit;
}

/* 跳到第 f 帧 —— 【逐帧 / 拖进度】的唯一入口 ✅
   ⚠️ 只写 action.time：不要用 mixer.setTime()（它会把动作时间归零再重放，
      暂停状态下直接丢失 → 表现为"进度条动了、姿势没动"）✅ */
function seekFrame(f, fromLoop) {
  if (!MOT.clip) return;
  MOT.frame = Math.max(0, Math.min(MOT.total, Math.round(f)));
  var t = MOT.frame / MOT.fps;
  if (MOT.action) { MOT.action.time = t; }
  if (S.helper) { try { S.helper.update(0.0001); } catch (e2) {} }
  applyPatches(MOT.frame);      /* ★ 帧范围补丁（预览）*/
  takeSnap();                   /* ★ 记录本帧原始姿态（供「回原值」）*/
  needsRender = true;
  if (!fromLoop) { motUI(); }
}
function stepFrame(d) {
  if (!MOT.clip) return;
  if (MOT.playing) { MOT.playing = false; if (MOT.action) { MOT.action.paused = true; } }
  seekFrame(MOT.frame + d);
}
function togglePlay() {
  if (!MOT.clip || !MOT.action) return;
  MOT.playing = !MOT.playing;
  MOT.action.paused = !MOT.playing;
  if (MOT.playing) {
    if (MOT.frame >= MOT.total) { seekFrame(0); }
    MOT.action.play();
  }
  needsRender = true;
  motUI();
}

/* ★★【换动作入口】—— 先把「初始态(自然站立)」作为输入喂一遍（与 pet.html 同一修法）✅
   为什么要：动作【直接互切】时，新动作会继承上一动作残留的 IK 状态 → 腿被拽变形
   （实测 pet.html：左足ＩＫ 经动作直切小跳干拉 = 3.78，而经「常自然站立」中转 = 0.472）
   ⚠️ 本页不开物理 → 中转只多一次小文件解析，代价很小 ✅ */
/* SYNC:viaInit —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
var _viaPending = null;
function loadMotion(idx, startFrame) {
  if (!S.mesh || !MOTIONS[idx]) return;
  var _initList = (MOTION_GROUPS[0] && MOTION_GROUPS[0][1]) || [];
  /* ★★ 2026-10-22 修：只有「目标就是自然站立(0)本身」才免中转。
     原来写的是「目标属于初始态组就免中转」—— 但「摇腿」也在初始组里，
     所以从 A 切到摇腿会【绕过中转】→ 继承上一动作残留的 IK/付与状态
     ⇒ 用户反馈：「这些动作不能互相切换，但先切回自然站立再切就没问题」✅ */
  if (MOT.idx !== 0 && !_viaPending && idx !== 0) {
    _viaPending = { idx: idx, frame: startFrame };
    console.log('[viewer] 换动作先经「自然站立」中转 → 目标「' + MOTIONS[idx].n + '」');
    loadMotion(0, 20);
    return;
  }
  MOT.idx = idx;
  MOT.loading = true;
  MOT.playing = false;
  motUI();
  motSetEnabled(false);
  var MO = MOTIONS[idx];
  var label = MO.n;
  mSel.value = String(idx);                /* 下拉与来源保持同步（父页面也能调）✅ */
  console.log('[viewer] 载入动作：' + label + ' …');
  new THREE.MMDLoader().loadAnimation(encodeURI(MO.f), S.mesh,
    function (rawClip) {
      var clip = rawClip;
      /* ★ 片段截取（待机·第1段/第2段）：只保留 a~b 帧，时间轴平移到 0 ✅ */
      if (MO.a !== undefined && MO.b !== undefined) {
        try {
/* SYNC:subclip —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
          clip = THREE.AnimationUtils.subclip(clip, clip.name, MO.a, MO.b, MOT.fps);
          console.log('[viewer] 已截片段 ' + MO.a + '~' + MO.b + ' 帧（'
                      + (clip.duration || 0).toFixed(2) + 's）✅');
        } catch (eSub) {
          console.warn('[viewer] 片段截取失败，改用整段:', eSub);
        }
      }
      if (S.helper) { try { S.helper.remove(S.mesh); } catch (e) {} S.helper = null; }
      resetToRest();
      /* 不带物理（本页不需要 Ammo）✅ */
      /* ★ 不要设 resetPhysicsOnLoop: false —— 坐姿下布料会发散，见 pet/40-motions.js 注释 */
      S.helper = new THREE.MMDAnimationHelper({ physics: false, sync: 0, afterglow: 0 });
      /* ★ add() 会立刻按「付与(grant)」关系改写子骨位置 → 每换一次动作叠一次 → 累积漂移
         （实测 首 每次被改 (-0.04726, +0.04324)：连切 6 次 首.y 1.4055 → 0.9802）
         → add 前记下全部骨骼位置，add 后原样还原（只还原位置，不动旋转/表情）✅ */
      var _posBeforeAdd = [];
/* SYNC:posRestore —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
      for (var _pb = 0; _pb < S.mesh.skeleton.bones.length; _pb++) {
        var _bn = S.mesh.skeleton.bones[_pb];
        _posBeforeAdd.push([_bn, _bn.position.x, _bn.position.y, _bn.position.z]);
      }
      S.helper.add(S.mesh, { animation: clip, physics: false, loop: true });
      for (var _pr = 0; _pr < _posBeforeAdd.length; _pr++) {
        var _pp = _posBeforeAdd[_pr];
        _pp[0].position.set(_pp[1], _pp[2], _pp[3]);
      }
      /* 足 IK：按动作决定（MO.ik = true 时【关掉】—— 纯 FK 的 VMD 开着 IK 会把 D 链拽回 → 腿僵）✅ */
/* SYNC:ikSwitch —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
      try { if (S.helper.enabled) { S.helper.enabled.ik = !MO.ik; } } catch (e3) {}
      /* ★ 付与：按动作决定（MO.noGrant = true 时【关掉】）—— 2026-10-14 新增 ✅
         付与把父骨变换写进子骨（D 链靠它驱动）；若该动作 VMD 已写全 D 链，
         再叠一层 = 算两遍 ⇒ 腿错位。
         ⚠️ 缺省（字段不写）= 开，所以现有动作行为完全不变 ✅ */
/* SYNC:grantSwitch —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
      try { if (S.helper.enabled) { S.helper.enabled.grant = !MO.noGrant; } } catch (e3) {}
      if (MO.ik) {
        ['左足ＩＫ', '右足ＩＫ', '左つま先ＩＫ', '右つま先ＩＫ'].forEach(function (n) {
          var b = S.bones[n], r = S.rest && S.rest[n];
          if (b && r) { b.rotation.set(r.rx, r.ry, r.rz); b.position.set(r.px, r.py, r.pz); }
        });
      }
      var obj = S.helper.objects.get(S.mesh);
      MOT.mixer = obj ? obj.mixer : null;
      MOT.action = MOT.mixer ? MOT.mixer.clipAction(clip) : null;
      MOT.clip = clip;
      MOT.dur = clip.duration || 0;
      MOT.total = Math.max(0, Math.round(MOT.dur * MOT.fps) - 1);
      /* ★ 2026-10-14：静态动作（如「姿态」= 31 帧全同）会被 MMDLoader 合并成单个关键帧
         → duration = 0 → 进度条拖不动、帧区间补丁也没法预览。
         这里用 motions.js 的 b（结束帧）兜底，让帧轴有意义 ✅ */
      if (MO.b && MO.b > MOT.total) { MOT.total = MO.b; }
      MOT.frame = 0;
      if (MOT.action) {
        MOT.action.setLoop(THREE.LoopRepeat, Infinity);
        MOT.action.clampWhenFinished = true;
        MOT.action.play();
        MOT.action.paused = true;
      }
      MOT.loading = false;
      motSetEnabled(true);
      seekFrame(startFrame || 0);
      try { S.helper.update(0.001); } catch (e4) {}
      /* ★★ 换动作后必须催一帧重画（2026-10-23 修）：
         viewer 是「按需渲染」—— 只有 needsRender 为 true 才画（99-loop.js）。
         这里原来没设，于是切到【静止姿势】的动作（鸭子坐 / 抱膝坐）时，
         画面一直停在上一个动作/空白帧 ⇒ 看起来就是「播放不了」✅ */
      try { needsRender = true; } catch (e6) {}
      /* ★ 2026-10-21：姿势已应用 → 让相机跟上（只补平移，保留用户视角）✅
         ★★ 2026-10-23 修：必须【延后一帧】再调 —— 原来紧跟着 helper.update(0.001) 调用，
            那时骨骼世界矩阵常常还是上一个动作的（读到的是站姿中心）⇒ 不移动；
            结果「鸭子坐」整个模型沉到地面下 20 单位，相机没跟过去 ⇒ 画面里没人
            （实测骨骼包围盒 y = −20.2 ~ 0，pivot 却还在 7.8）✅ */
      try { setTimeout(function () { try { alignPoseCenter(); needsRender = true; } catch (e5b) {} }, 80); } catch (e5a) {}
      /* ★ 2026-10-18：不再直接 reveal —— 交给闸门（必要部件贴图就绪 / 白模线框 / 9s 兜底）*/
      S.poseReadyAt = Date.now();
      tryReveal();
      console.log('[viewer] 动作就绪：「' + label + '」共 ' + (MOT.total + 1)
                  + ' 帧 / ' + MOT.dur.toFixed(2) + 's ✅');
      /* ★ 中转收尾：初始态已就绪 → 立刻切到目标动作 ✅ */
      if (_viaPending) {
        var _vp = _viaPending;
        _viaPending = null;
        setTimeout(function () { loadMotion(_vp.idx, _vp.frame); }, 120);   /* 2026-10-22: 80→120ms，给 IK/付与多两帧稳定 */
      }
    }, undefined, function (e) {
      MOT.loading = false;
      motSetEnabled(true);
      motUI();
      console.warn('[viewer] 动作加载失败（保持当前姿势）:', e);
      if (!S.revealed) { S.poseReadyAt = Date.now(); tryReveal(); }
    });
}

/* 首次载入：跟桌宠「自然站立」同一帧（帧 20）✅ */
function loadPose(mesh) { loadMotion(0, 20); }

/* —— 控件接线 —— */
mSel.addEventListener('change', function () {
  loadMotion(parseInt(mSel.value, 10) || 0, 0);
  window.focus();
});
document.getElementById('m-first').addEventListener('click', function () { stepFrame(-1e9); window.focus(); });
document.getElementById('m-prev').addEventListener('click',  function () { stepFrame(-1);   window.focus(); });
document.getElementById('m-next').addEventListener('click',  function () { stepFrame(1);    window.focus(); });
document.getElementById('m-last').addEventListener('click',  function () { stepFrame(1e9);  window.focus(); });
mPlay.addEventListener('click', function () { togglePlay(); window.focus(); });
mRange.addEventListener('input', function () {
  if (MOT.playing) { MOT.playing = false; if (MOT.action) { MOT.action.paused = true; } }
  seekFrame(parseInt(mRange.value, 10) || 0);
});
motSetEnabled(false);

/* ★ 操作提示：左上角竖排，可收起（状态记住）✅ */
(function () {
  var hud = document.getElementById('hud');
  var btn = document.getElementById('hud-toggle');
  var head = document.getElementById('hud-head');
  if (!hud || !btn) { return; }
  function apply(v) {
    hud.classList.toggle('collapsed', !!v);
    btn.textContent = v ? '展开' : '收起';
    try { localStorage.setItem('viewer_hud_collapsed', v ? '1' : '0'); } catch (e) {}
  }
  var init = false;
  try { init = localStorage.getItem('viewer_hud_collapsed') === '1'; } catch (e) {}
  apply(init);
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    apply(!hud.classList.contains('collapsed'));
  });
  if (head) {
    head.addEventListener('click', function () { apply(!hud.classList.contains('collapsed')); });
  }
})();
