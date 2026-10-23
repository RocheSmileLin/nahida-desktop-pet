/* ============================================================================
   表情与视线：自动表情、在线表情、手动眼球、复位/切动作入口
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══ ★★ 2026-10-18 自动表情（按「初始状态」随机适配）══════════════════════
   用户需求：「根据当前的初始状态，随机适配表情就可以了」
   · 只在【初始状态】组（自然站立 / 摇腿 / 鸭子坐 / 抱膝坐）生效；
     播其它动作（待机/攻击…）时自动归零，不跟动作抢表情 ✅
   · 每 5~9 秒挑一次：70% 出情绪 / 30% 回中性；~0.35s 平滑淡入淡出
   · 【手动优先】：调整台「表情」页写过的 morph 一律不碰
   · 不碰 まばたき（眨眼机制已删除；要眨眼就存成预设，由调度器随机抽）与视线骨
   · 与动作 morph 取 max（不相加，避免权重和超 1 把脸拉炸）✅ */
var AUTO_EXPR = {
  cur: {}, tgt: {}, poseIdx: -1, last: 0, nextPick: 0,
  /* ★★ 2026-10-18 用户要求「将初始状态的表情统一从预设中随机调取」：
     删掉写死的口味表，改成从 /exprsets（= 调整台「表情预设」/ _3d/expr_sets.json）随机取 ✅
     → 你存/删预设后，桌宠 20 秒内自动跟上，不用重启 */
  presets: [], lastPick: -1, fetchedAt: 0, warned: false
};

/* 拉表情预设（至少间隔 20 秒；切初始状态时 force 一次）*/
function autoExprFetchPresets(force) {
  var now = (window.performance && performance.now) ? performance.now() : Date.now();
  if (!force && (now - AUTO_EXPR.fetchedAt) < 20000) { return; }
  AUTO_EXPR.fetchedAt = now;
  fetch('/exprsets').then(function (r) { return r.json(); }).then(function (d) {
    var list = (d && d.sets) || [];
    AUTO_EXPR.presets = list.filter(function (s) {
      return s && s.expr && Object.keys(s.expr).length > 0;   /* 空预设不参与 */
    });
    if (!AUTO_EXPR.presets.length && !AUTO_EXPR.warned) {
      AUTO_EXPR.warned = true;
      console.warn('[pet] 自动表情：/exprsets 里没有可用预设 → 暂不自动换表情'
                   + '（去调整台「表情」页存几个预设即可）');
    }
  }).catch(function () {});
}

/* 返回 true = 这一帧有改动（viewer 用来触发重画） */
function autoExprTick(inf, idxOf, manual, poseIdx) {
  if (!inf || !idxOf) { return false; }
  var changed = false;
  var now = (window.performance && performance.now) ? performance.now() : Date.now();
  var dt = AUTO_EXPR.last ? Math.min(0.2, (now - AUTO_EXPR.last) / 1000) : 0.016;
  AUTO_EXPR.last = now;
  var isInit = (poseIdx === 0 || poseIdx === 13 || poseIdx === 15 || poseIdx === 16);
  if (!isInit) {                                  /* 非初始状态 → 全部淡出归零 */
    for (var an in AUTO_EXPR.cur) {
      var ai = idxOf[an];
      if (ai !== undefined && !(manual && manual[an] !== undefined) && inf[ai]) { inf[ai] = 0; changed = true; }
    }
    AUTO_EXPR.cur = {}; AUTO_EXPR.tgt = {};
    AUTO_EXPR.poseIdx = -1; AUTO_EXPR.nextPick = 0;
    return changed;
  }
  if (AUTO_EXPR.poseIdx !== poseIdx) {            /* 换初始状态 → 重新挑 */
    AUTO_EXPR.poseIdx = poseIdx;
    AUTO_EXPR.cur = {}; AUTO_EXPR.tgt = {};
    AUTO_EXPR.nextPick = now + 800 + Math.random() * 1500;
    autoExprFetchPresets(true);
  }
  autoExprFetchPresets(false);                    /* 预设增删 → 20 秒内自动跟上 */
  if (now >= AUTO_EXPR.nextPick) {
    /* ★ 从【表情预设】里随机抽一个（不再用写死的口味表）✅ */
    var list = AUTO_EXPR.presets || [];
    var t = {};
    if (list.length) {
      var pi = Math.floor(Math.random() * list.length);
      if (list.length > 1 && pi === AUTO_EXPR.lastPick) { pi = (pi + 1) % list.length; }  /* 不连抽同一个 */
      AUTO_EXPR.lastPick = pi;
      var pex = list[pi].expr || {};
      for (var ek in pex) {
        var ev = +pex[ek];
        if (isFinite(ev) && ev > 0.005) { t[ek] = Math.max(0, Math.min(1, ev)); }
      }
      console.log('[pet] 自动表情 → 预设「' + list[pi].name + '」');
    }
    AUTO_EXPR.tgt = t;
    AUTO_EXPR.nextPick = now + 5000 + Math.random() * 4000;
  }
  var k = 1 - Math.exp(-dt / 0.12);               /* 时间常数 0.12s ≈ 0.35s 到位 */
  var names = {}, n;
  for (n in AUTO_EXPR.tgt) names[n] = 1;
  for (n in AUTO_EXPR.cur) names[n] = 1;
  for (n in names) {
    var tgv = AUTO_EXPR.tgt[n] || 0;
    var cuv = AUTO_EXPR.cur[n] || 0;
    cuv += (tgv - cuv) * k;
    var mi = idxOf[n];
    if (cuv < 0.01 && tgv === 0) {
      delete AUTO_EXPR.cur[n];
      if (mi !== undefined && !(manual && manual[n] !== undefined) && inf[mi]) { inf[mi] = 0; changed = true; }
      continue;
    }
    AUTO_EXPR.cur[n] = cuv;
    if (mi === undefined) { continue; }
    if (manual && manual[n] !== undefined) { continue; }        /* 手动优先 ✅ */
    if ((inf[mi] || 0) < cuv) { inf[mi] = cuv; changed = true; } /* 取 max，不相加 ✅ */
  }
  return changed;
}

var _exprLast = {};              /* 上一帧写过的 morph（用于归零，见 applyExpr）*/
var _exprSig = '';               /* 表情签名（只在变化时打日志，方便排查 ✅）*/
function applyExpr() {
  var ex = (PET_SETTINGS && PET_SETTINGS.expr) || {};
  var inf = S.mesh && S.mesh.morphTargetInfluences;
  if (!inf || !S.morphIdx) { return; }
  /* ★★ 2026-10-17：上一帧写过、这次被删掉的 morph 要主动归零
     —— 否则滑回最左 / 点「全部归零」时表情会卡在上一次的值 ✅ */
  for (var dk in _exprLast) {
    if (!(dk in ex)) {
      var di = S.morphIdx[dk];
      if (di !== undefined) { inf[di] = 0; }
      delete _exprLast[dk];
    }
  }
  for (var k in ex) {
    var idx = S.morphIdx[k];
    if (idx === undefined) { continue; }
    var w = parseFloat(ex[k]);
    if (!isFinite(w)) { continue; }
    inf[idx] = Math.max(0, Math.min(1, w));
    _exprLast[k] = 1;
  }
  /* ★★ 2026-10-18 自动表情：手动 expr 写完之后再跑（内部已保证手动优先、
     非初始状态归零），所以不会互相打架 ✅ */
  autoExprTick(inf, S.morphIdx, ex, S.poseIndex);
  /* 调试日志：只有表情真的变了才打一行（方便排查"桌宠没反应"✅）*/
  var sig = JSON.stringify(ex);
  if (sig !== _exprSig) {
    _exprSig = sig;
    console.log('[pet] 表情应用 ' + sig + '（生效 morph ' + Object.keys(_exprLast).length + ' 个）');
  }
}

/* ══ ★★ 2026-10-17 视线（真眼球转动）═════════════════════════════════
   为什么不用 morph：Blender 实测「上/下/前/上左…」这些键只动 56/28 个点，
   z 0.992~1.026，比眼睛（0.938~0.999）高 2~3cm → 那是【眉毛】，与眼睛零重叠。
   眼球方向只能转骨：虹膜 228 点挂 眼.L(114)/眼.R(114)，各权重和 ~51。
   ⚠️ 另外发现：原来的鼠标视线写的是「左目/右目」——中文化后这两根骨叫 眼.L/眼.R，
      所以眼球跟随一直是死的（applyRot 找不到骨就静默跳过）→ 一并修好 ✅ */
var _gazeSig = '';

function manualGaze() {
  var maxR = (PET_SETTINGS.eyeMax === undefined ? 12 : PET_SETTINGS.eyeMax) * Math.PI / 180;
  var up = Math.max(0, Math.min(1, +PET_SETTINGS.eyeUp || 0));
  var dn = Math.max(0, Math.min(1, +PET_SETTINGS.eyeDown || 0));
  var lf = Math.max(0, Math.min(1, +PET_SETTINGS.eyeLeft || 0));
  var rt = Math.max(0, Math.min(1, +PET_SETTINGS.eyeRight || 0));
  var pitch = (dn - up) * maxR;      /* + = 往下看 */
  var yaw = (rt - lf) * maxR;        /* + = 往右看 */
  var sig = up + '|' + dn + '|' + lf + '|' + rt;
  if (sig !== _gazeSig) {
    _gazeSig = sig;
    console.log('[pet] 视线 上' + up + ' 下' + dn + ' 左' + lf + ' 右' + rt
                + '（垂直 ' + ((dn - up) * PET_SETTINGS.eyeMax).toFixed(1) + '°, 水平 '
                + ((rt - lf) * PET_SETTINGS.eyeMax).toFixed(1) + '°）');
  }
  return { pitch: pitch, yaw: yaw };
}

/* ★ 复位到模型的【静止姿势】（模型刚载入时的 A-pose）
   ⚠️ 换姿势前必须复位：否则新动作没覆盖到的【骨骼和 morph】都会残留上一套动作的值 */
/* SYNC:resetToRest —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
function resetToRest() {
  resetMorphs();                     // ★ 表情一起清（以前只清骨骼 → morph 残留）
  if (!S.rest) return;
  Object.keys(S.rest).forEach(function (n) {
    var b = S.bones[n], r = S.rest[n];
    if (!b) return;
    b.rotation.set(r.rx, r.ry, r.rz);
    b.position.set(r.px, r.py, r.pz);
    b.scale.set(1, r.sy, 1);
  });
  if (S.mesh) S.mesh.updateMatrixWorld(true);
}

/* ★★【换动作的入口】—— 换「动作」之前，先把「初始态(自然站立)」作为输入喂一遍
   （2026-10-12 实测修复「动作互相影响 / 腿变形」，用户定的方案 ✅）

   现象：动作之间【直接互切】，新动作会继承上一动作残留的 IK 目标 → 腿被拽变形
         （用户反馈「"小跳干拉"的腿部动作变形了」）
   实测：左足ＩＫ 经「扭腰1」直切「小跳干拉」= 6.2 → 左ひざ差 76°，腿变形 ❌
         而经「自然站立」中转 = 0.462 —— 永远正常 ✅
         （用户原话：「每个动作单独从初始态切换的都不会出错，
                     那么切换位置时将初始态作为输入不就好了吗？」）
   做法：目标不是初始态、且当前也不在【自然站立】→ 先加载「自然站立」，
         等它真正就绪（loadPoseVMD 末尾收尾）再切目标
   ⚠️ 中转只多一次加载，加载期间旧动作照常播 → 不会露出 A-pose ✅ */
function setPose(idx) {
  if (idx < 0 || idx >= POSES.length || idx === S.poseIndex) return;
  /* ★ 2026-10-14 用户方案：**只有「自然站立」本身不用中转**（它自己就是初始态），
     其余动作【一律】先经「自然站立」中转 ✅
     —— 起因：从「坐姿」直切「摇腿」时模型整体下沉。
        坐姿把根骨挪到 -20.22，而 MMDLoader 建 position 轨用的是
        `basePosition + vmdPos`（lib/MMDLoader.js:1446，basePosition = 建轨那一刻的位置），
        于是摇腿的 +0.53 被叠成 -19.17 ❌
     —— 为什么中转能治本：中转那一步会走 loadPoseVMD 里的 resetToRest()，
        把骨骼（含根骨）清回 bind；而「自然站立」的 VMD 不带根骨轨道 ⇒ 根骨停在 bind
        ⇒ 再切目标时建轨读到的 basePosition 就是对的 ✅
     ⚠️ 中转只多一次加载，加载期间旧动作照常播（不会露 A-pose）✅ */
  if (S.poseIndex !== 0 && idx !== 0) {
    S.viaPending = idx;
    S.viaStage = 'toStand';   /* ★ 2026-10-14 用户要求：中转期间把模型藏起来，
                                 别让用户看到「先跳到自然站立」那一下
                                 —— 本标记 = 正在走中转；等【最终目标】就绪才恢复显示 ✅ */
    console.log('[pet] 换动作先经「自然站立」中转 → 目标「' + POSES[idx][0] + '」');
    _setPoseNow(0);
    return;
  }
  S.viaPending = null;
  _setPoseNow(idx);
}

/* 换姿势：交给 loadPoseVMD —— 加载期间【旧动作继续播】，就绪后才在同一帧里切换
   ⚠️ 千万别在这里先卸旧动作/先复位：那会让加载空档露出 A-pose（手臂外张）闪一下 */
function _setPoseNow(idx) {
  if (idx < 0 || idx >= POSES.length || idx === S.poseIndex) return;
  S.poseIndex = idx;
  /* ★ 点「初始状态」组里的动作（自然站立 / 趴）→ 把它记成【播完后的归位目标】✅
     （用户 2026-10-12：其余动作播放完毕后进入选定的初始状态）*/
  if (GROUPS[GROUP_INIT] && GROUPS[GROUP_INIT][1].indexOf(idx) >= 0) {
    S.initPose = idx;
    console.log('[pet] 初始状态已设定 →「' + POSES[idx][0] + '」'
                + '（其它动作播完回到这里）');
  }
  S.baseCaptured = false;
  S.base = null;
  S.poseTime = 0;
  /* ⚠️ 这里【不清 S.poseClip】：留着旧 clip，加载期间旧动作照常播，姿态不会突变 */
  loadPoseVMD(POSES[idx][1], function () { captureBase(); }, POSES[idx][2],
              POSES[idx][3] !== undefined ? [POSES[idx][3], POSES[idx][4]] : null,
              POSES[idx][5] === true);          /* ★ 第6项 = 一直循环 ✅ */
  console.log('[pet] 换姿势 → ' + POSES[idx][0]);
}
