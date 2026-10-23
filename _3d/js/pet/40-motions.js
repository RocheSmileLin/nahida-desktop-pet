/* ============================================================================
   动作系统：状态、动作清单、VMD 装载/中转、骨骼层与复位
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

var S = { mesh:null, bones:{}, ready:false, err:null,
          helper:null, poseClip:null, poseTime:0, base:null, baseCaptured:false,
          poseIndex:0, rest:null,
          /* ★ 播完后的归位目标：0=自然站立 / 14=趴。点「初始状态」里的动作会改写它 ✅ */
          initPose:0 };
/* ★ 启动计时（诊断"启动花在哪"用；不影响功能 ✅）*/
window.__T0 = Date.now();
function T(tag) {
  console.log('[T] ' + tag + '  +' + ((Date.now() - window.__T0) / 1000).toFixed(2) + 's');
}

var clock = new THREE.Clock();

/* ★ 动作列表（右键菜单里能选）—— 按用户要求精简，只保留：拆分后的待机 / 喵喵喵 / 自然站立
   每项格式：[显示名, 相对路径, 关足IK?, 拆段起始帧, 拆段结束帧]
   ⚠️ 第 3 个 true = 关闭足 IK（VMD README 原文：「腿部动作使用正向动力学，因此需关闭足 IK」）
      IK 开着时求解器会把 D 链拽回 IK 目标 → 盖掉 FK/付与的结果 → 腿僵在同一姿势 */
/* ============ 动作清单 & 分组 ============
   ★ 2026-10-12：已抽成【单一数据源】 _3d/motions.js（pet.html 与 viewer.html 共用）✅
     —— 以前两个文件各存一份（形状还不同：POSES / MOTIONS），改一边忘另一边就会出事
        （实况：浏览器从别的动作切「小跳干拉」腿变形 —— 桌面改了、浏览器没改）
     以后加 / 删 / 改动作 → 只改 motions.js，然后跑 _3d/_check_sync.py 自检 ✅
   · POSES 格式：[显示名, 相对路径, 关足IK?, 起帧, 止帧, 一直循环?]（帧缺省 = 整段）*/
/* SYNC:motionsSrc —— 本页与 viewer.html 共用 _3d/motions.js（_check_sync.py 核对）✅ */
var POSES = MOTION_DEFS.map(function (m) {
  return [m.n, m.f, m.ik, m.a, m.b, m.loop === true];
});
/* 菜单分组（值 = POSES 下标；标签加装饰线）—— 第 0 组「初始状态」= 播完归位目标 ✅ */
var GROUPS = MOTION_GROUP_DEFS.map(function (g) {
  return ['— ' + g[0] + ' —', g[1].slice()];
});
var GROUP_INIT  = 0;
var GROUP_OWN   = 1;
var GROUP_OTHER = 2;

/* 播放站姿动作 —— 【单次播放】，播完自动回「自然站立」（用户要求：三个动作播完都回到自然站立）
   · 需要"永久保持的姿势"（如「自然站立」本身）→ 用 LoopRepeat + paused 停在某一帧
   ⚠️ 早先试过"播一遍就定格"被否掉过 —— 那是因为定格在【动作的最后一帧】= 一个奇怪的姿势；
      现在定格的是【自然站立】这种人工挑过的自然姿势，且程序化呼吸/视线/眨眼仍在动，所以不僵
   程序化增量由 frame() 叠在它之上 */
function loadPoseVMD(url, onFail, ikOff, sub, loopForever) {
  /* ★ 加载序号：中转/快速连点时，旧加载的回调可能晚于新加载到达 → 直接丢弃 ✅ */
  var _seq = (S.loadSeq || 0) + 1;
  S.loadSeq = _seq;
  /* ★★「clip 就位」门禁（用户 2026-10-12 报：切换动作时摇腿的头偶现抬不起来）
     本函数是【异步】的，而 S.poseIndex 在 _setPoseNow() 里【立刻】就变了 →
     加载空档那几帧，骨头上还是【上一个动作】的姿态；
     摇腿的"趴着抬头"基准若此时被记录 → 记成错的 → 之后每帧强制回放 → 头就再也抬不起来 ❌
     （物理关闭时加载快、空档短，所以表现为"偶现"）
     做法：进来先作废，等【这个 clip 真装好】再打上"当前装好的是哪个动作" ✅ */
  var _poseAtCall = S.poseIndex;
  S.clipForPose = null;
  new THREE.MMDLoader().loadAnimation(url, S.mesh, function (clip) {
    if (_seq !== S.loadSeq) return;         /* 已有更新的加载 → 本次结果作废 */
    /* ★★ 关键：卸旧动作 + 复位静止姿势，必须放在【新动作已经就绪】的这一帧里做
       ⚠️ 以前是在 setPose() 里"先卸旧 + 先复位"再异步加载 → 加载的空档（大 VMD 要 1 秒）
          会一直露着模型的静止姿势（A-pose，手臂外张）闪一下（用户反馈"切换时有一瞬间变成图二"）
       → 现在：加载期间旧动作照常播，就绪后在这一帧里一次性【卸旧 → 复位 → 上新】，
         同一帧的 helper.update() 立刻用新动作覆盖，看不到 A-pose */
    if (S.helper) { try { S.helper.remove(S.mesh); } catch (e) {} S.helper = null; }
    resetToRest();
    /* ★ 拆段：sub = [起始帧, 结束帧]（VMD 是 30fps）
         用 AnimationUtils.subclip 切成独立小段 —— 拆分点选在"回到接近起始姿态"的位置，
         所以切完循环不会跳帧（拆分点怎么选的见 _3d/_vmd_split_analysis.py）
       ★ 静帧：sub = [帧, 帧]（起止相同）→ 不做 subclip！
         ⚠️ 实测：窄范围（0~15 帧以内）会把"在这段里没有关键帧"的轨道整个丢掉
            （147 → 145 条），而且 resetDuration() 会读到只剩单帧的轨道 → 时长算成 0。
            所以改用"让动作停在指定帧"的办法（paused），姿态就是那一帧、完全静止。
         返回的 holdFrame（非 null 时）在下面 add() 之后生效 */
    var holdFrame = null;
    if (sub && sub[1] > sub[0]) {
      try {
        var fullDur = clip.duration;
/* SYNC:subclip —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
        clip = THREE.AnimationUtils.subclip(clip, 'pose_sub', sub[0], sub[1], 30);
        console.log('[pet] 拆段: 帧 ' + sub[0] + '~' + sub[1] + ' → ' + clip.duration.toFixed(2)
                    + 's（原 ' + fullDur.toFixed(2) + 's）');
      } catch (e) {
        console.warn('[pet] 拆段失败，退回整段:', e);
      }
    } else if (sub && sub[1] === sub[0]) {
      holdFrame = sub[0];
    }
    S.poseClip = clip;
    T('② 站姿 VMD 解析完成（clip 已建好）');
    /* ★ 不要设 resetPhysicsOnLoop: false（2026-10-23 实测）：
       lib/MMDAnimationHelper.js 默认 true，会在每次循环时 physics.reset()。
       关掉它看似能消掉「循环边界抽一下」，但坐姿下布料会持续发散
       （实测鸭子坐：每帧最大骨旋转 中位 0.93° → 30.8°，P95 109°，最大 178°）。
       正确做法是让静态姿势不循环（motions.js 里用 a==b 定格），而不是关这个开关 ✅ */
    S.helper = new THREE.MMDAnimationHelper({ physics: false, sync: 0, afterglow: 0 });
    /* ⚠️ physics 必须写在 add() 的参数里，构造参数不管用（实测踩过）
       ★ 物理（衣物/头发的摆动）：用户要求「加一点物理效果」
         · 依赖 Ammo（异步工厂，见页面头部适配层）+ lib/MMDPhysics.js
         · Ammo 还没就绪时【自动退回无物理】—— 不会卡住加载
         · 右键菜单「物理效果」可随时开关 */
    /* ★ 逐动作物理开关：motions.js 里标了 noPhys 的动作（例：摇腿=躺下动作）不启用物理
       —— 否则布料在"世界重力 + 躺姿"下会被身体碰撞顶飞（实测包围盒 Y 从 6.6 涨到 11.4）✅ */
    var _noPhys = false;
    try {
      if (typeof MOTION_DEFS !== 'undefined' && MOTION_DEFS[S.poseIndex]) {
        _noPhys = MOTION_DEFS[S.poseIndex].noPhys === true;
      }
    } catch (e) {}
    var usePhysics = physicsUsable() && !_noPhys;
    /* ★ 物理参数从这里透传：lib/MMDAnimationHelper.js 第 600 行会把 params 原样交给
       THREE.MMDPhysics（构造函数签名见 lib/MMDPhysics.js 第 27 行）
       → 所以 unitStep / maxStepNum / warmup 都在【这个对象里】生效
       ⚠️ 旋钮定义在页面顶部（PHYSICS_UNIT_STEP / PHYSICS_MAX_STEP_NUM / PHYSICS_WARMUP）*/
    /* ★★【记下 add 前的骨骼位置】—— 修「动作互相切换 → 头部/部件累积偏移」✅
       ⚠️ 实测（2026-10-12）：MMDAnimationHelper.add() 会【立刻】按「付与(grant)」关系把父骨
          变换写进子骨 —— 例：`首`（父骨 上半身2）每次 add 都被改写 (-0.04726, +0.04324)，
          于是每换一次动作脖子就下沉一截，累积成用户看到的「头部偏移」
          （实测：连切 6 次 首.position.y 1.4055 → 0.9802，頭 世界坐标偏 0.65）❌
       做法：add 前记下全部骨骼位置，add 完立刻原样还原 → 抹掉 add 的付与副作用；
            真正的姿态由紧随其后的第一帧动画给出（动画是绝对赋值，不会累积）✅
       ⚠️ 只还原【位置】，不碰旋转/表情 —— 避免干扰 add 建立的 IK / 付与解算状态 ✅ */
    /* ★ 2026-10-14 修复「开物理时 坐姿→自然站立，裙子变形」：
       MMDPhysics 建刚体时是按 `weight = params.type === 0 ? 0 : params.weight` 定质量的
       （lib/MMDPhysics.js:773），而质量【在构造那一刻就定死了】——
       若上一个动作（坐姿）冻结过裙子（params.type = 0），这里就会建出「质量 0」的静力刚体，
       之后再改回 type = 1 也【不会恢复质量】⇒ 裙子畸形 ❌
       ⇒ 必须在 helper.add() 【之前】先把冻结还原掉（unfreezePhys 幂等，重复调没事）✅ */
    unfreezePhys();
    var _posBeforeAdd = [];
/* SYNC:posRestore —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
    for (var _pb = 0; _pb < S.mesh.skeleton.bones.length; _pb++) {
      var _bn = S.mesh.skeleton.bones[_pb];
      _posBeforeAdd.push([_bn, _bn.position.x, _bn.position.y, _bn.position.z]);
    }
    S.helper.add(S.mesh, {
      animation: clip,
      physics: usePhysics,
      loop: true,
      unitStep: PHYSICS_UNIT_STEP,
      maxStepNum: PHYSICS_MAX_STEP_NUM,
      warmup: PHYSICS_WARMUP
    });
    /* ★ add 的付与副作用还原（见上）—— 只还原位置 ✅ */
    for (var _pr = 0; _pr < _posBeforeAdd.length; _pr++) {
      var _pp = _posBeforeAdd[_pr];
      _pp[0].position.set(_pp[1], _pp[2], _pp[3]);
    }
    _posBeforeAdd = null;
    console.log('[pet] 物理: ' + (usePhysics ? '开 ✅' : '关')
                + (PHYSICS_ON && !AMMO_MODULE ? '（Ammo 还没就绪）' : ''));
    if (usePhysics) applyPhysicsGravity();   /* ★ 应用"形变程度"旋钮（PHYSICS_GRAVITY_Y）*/
    /* ★ 逐动作布料冻结（2026-10-14）：motions.js 里带 freezePhys 的动作（例：坐姿的裙子）
       —— 无条件调用：函数内部会先还原上一动作的冻结，再按【当前动作】决定要不要冻 ✅ */
    applyFreezePhys();
    /* 诊断：模型里到底有多少【刚体 / 关节】—— 0 的话开物理也不会动 */
    try {
      var ud = S.mesh.geometry.userData.MMD || {};
      console.log('[pet] 刚体数: ' + ((ud.rigidBodies || []).length)
                  + '   关节数: ' + ((ud.constraints || ud.joints || []).length));
    } catch (e) {
      console.log('[pet] 刚体统计失败: ' + e);
    }
    /* 诊断：我们每帧钉【位置】的那几根骨上有没有刚体？
       有 → 物理和钉位在抢同一根骨 → 会是"衣物小抽动"的来源之一 */
    try {
      var _phy = (S.helper.objects) ? S.helper.objects.get(S.mesh).physics : null;
      if (_phy && _phy.bodies) {
        var _pinned = ['センター', '上半身', '上半身2', '下半身'];
        var _hitNm = [];
        for (var _bi = 0; _bi < _phy.bodies.length; _bi++) {
          var _bd = _phy.bodies[_bi];
          if (_bd && _bd.bone && _pinned.indexOf(_bd.bone.name) >= 0) {
            _hitNm.push(_bd.bone.name);
          }
        }
        console.log('[pet] 钉位骨上的刚体: ' + _hitNm.length
                    + (_hitNm.length ? ' → ' + _hitNm.join(',') + '（可能互相抢 → 抽动）'
                                     : '（无冲突 ✅）'));
      }
    } catch (e) {
      console.log('[pet] 钉位冲突检查失败: ' + e);
    }
    /* ★【足 IK】开关（helper.enabled.ik 是官方运行时开关，见 MMDAnimationHelper.js 第 464 行）
       ⚠️ 官方/喵喵喵那套动作是按 FK 直驱腿部做的 —— README 原文
          「腿部动作使用正向动力学，因此需关闭足 IK」
          IK 开着会和 FK 打架，把这几个动作标了 ikOff=true → 这里关掉
       ⚠️ Otokam 站姿包没标 → 保持 IK 开（原行为不变） */
    var ikState = '开';
    try {
      if (S.helper.enabled) {
/* SYNC:ikSwitch —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
        S.helper.enabled.ik = !ikOff;
        ikState = S.helper.enabled.ik ? '开' : '关';
      }
    } catch (e) {}
    /* 关闭时顺手把 IK 目标骨复位（避免它停在上一动作的位置继续拽腿） */
    if (ikOff) {
      ['左足ＩＫ', '右足ＩＫ', '左つま先ＩＫ', '右つま先ＩＫ'].forEach(function (n) {
        var b = S.bones[n], r = S.rest && S.rest[n];
        if (b && r) { b.rotation.set(r.rx, r.ry, r.rz); b.position.set(r.px, r.py, r.pz); }
      });
    }
    /* ★【付与】开关（2026-10-14 新增，链开关可写回 motions.js 的 noGrant）
       —— 付与会把父骨变换写进子骨（D 链就靠它驱动）；若某动作已在 VMD 里把
          D 链写全，再叠一层付与 = 算两遍 ⇒ 腿错位 ✅
       ⚠️ 缺省（字段不写）= 开，所以现有动作行为完全不变 ✅ */
    var grantState = '开';
    try {
      if (S.helper.enabled) {
/* SYNC:grantSwitch —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
        var _noGrant = false;
        try {
          if (typeof MOTION_DEFS !== 'undefined' && MOTION_DEFS[S.poseIndex]) {
            _noGrant = MOTION_DEFS[S.poseIndex].noGrant === true;
          }
        } catch (e5) {}
        S.helper.enabled.grant = !_noGrant;
        grantState = S.helper.enabled.grant ? '开' : '关';
      }
    } catch (e) {}
    /* ★ 播放模式（用户要求）：
         · 静帧（自然站立）→ LoopRepeat + paused，永远停在那一帧
         · 三个动作（待机·第1段 / 第2段 / 喵喵喵）→ 【单次播放】，播完自动回「自然站立」
       ⚠️ clampWhenFinished 必须为 true —— 否则播完的瞬间会跳回模型的静止姿势（A-pose）
          （就是用户截图里的"图二"手臂外张）；true = 停在最后一帧，等自然站立加载好再切 */
    try {
      var obj = S.helper.objects.get(S.mesh);
      if (obj && obj.mixer) {
        var act = obj.mixer.clipAction(clip);
        S.poseAct = act;
        if (loopForever) {
          /* ★ 一直循环（用户 2026-10-12）：像待机动作那样无限播 ——
             不 paused、不 clampWhenFinished、不挂 finished 回调 → 永远不回初始状态 ✅ */
          act.setLoop(THREE.LoopRepeat, Infinity);
          console.log('[pet] 循环播放「' + POSES[S.poseIndex][0] + '」（一直循环，不回初始状态）');
        } else if (holdFrame !== null) {
          act.setLoop(THREE.LoopRepeat, Infinity);
          /* ★ 静帧保持：停在指定帧
                （paused=true 的动作仍会持续输出该时刻的姿态，只是不再前进） */
          act.time = holdFrame / 30;
          act.paused = true;
          console.log('[pet] 静帧保持: 停在帧 ' + holdFrame + '（' + (holdFrame / 30).toFixed(2) + 's）');
        } else {
          act.setLoop(THREE.LoopOnce, 1);
          act.clampWhenFinished = true;
          /* 播完 → 回自然站立（事件由这个 mixer 发出；换动作时整个 helper 会被丢弃，
             所以不会残留回调） */
          if (obj.mixer.addEventListener) {
            obj.mixer.addEventListener('finished', onPoseFinished);
          }
        }
      }
    } catch (e) {}
    /* ★★【中转收尾】本次加载的是「自然站立」中转 → 就绪后立刻切到目标动作 ✅
       （用户 2026-10-12：切换位置时将初始态作为输入 —— 从根本上避免动作互相污染）
       延迟 100ms（≈3 帧）：让「自然站立」这一帧真正解算完，中转才生效 ✅ */
/* SYNC:viaInit —— 与另一页面共用同一机制（_check_sync.py 核对两边都有）✅ */
    if (S.viaPending !== null && S.viaPending !== undefined) {
      var _vp = S.viaPending;
      S.viaPending = null;
      /* ★ 2026-10-14 用户要求：中转期间隐藏模型 ——
         此刻「自然站立」刚就绪，马上还要加载【目标动作】（几百 ms），
         这段里用户本来会看到「先跳到站立」；把模型藏起来 ⇒ 视觉上只见「目标直接出现」✅ */
      try { S.mesh.visible = false; } catch (eH) {}
      setTimeout(function () { setPose(_vp); }, 100);
    }
    window.__PET_READY__ = true;
    /* ★★ 站姿已真正就位（clip 建好 + 已停在目标帧）→ 打时间戳，让 frame() 里可以整体显示 ✅
       ⚠️ 注意：本函数的第 2 个参数是【失败回调】onFail，成功后不会调 captureBase
          → 之前启动时 S.baseCaptured 一直是 false，这里必须自己打点 ✅ */
    S.poseReadyAt = Date.now();
    S.clipForPose = _poseAtCall;   /* ★ clip 就位（帧循环里摇腿头部基准靠它把关）✅ */
    /* ★ 2026-10-14 用户要求：中转期间把模型藏起来（见 setPose / 上面的隐藏点）——
       本次若是【中转那一步】（目标 = 自然站立 0）→ 继续藏着，等真正的目标就绪；
       本次若是【最终目标】→ 这时才恢复显示 ⇒ 用户看不到中间的站立画面 ✅ */
    if (S.viaStage === 'toStand' && _poseAtCall !== 0) {
      S.viaStage = null;
      try { S.mesh.visible = true; } catch (eSh) {}
      console.log('[pet] 中转完成 → 显示「'
                  + ((POSES[_poseAtCall] && POSES[_poseAtCall][0]) || '?') + '」✅');
    }
    /* ★ 换动作后立刻按该动作的相机补偿重算（motions.js 的 cam 字段）✅ */
    try { fitCamera(); } catch (e) {}
    T('③ 站姿 VMD 就绪（含物理初始化）');
    console.log('[pet] ' + (loopForever ? '一直循环' : (holdFrame !== null ? '静帧保持' : '单次播放（播完回初始状态）'))
                + ': ' + clip.duration.toFixed(2) + 's   足IK: ' + ikState);
  }, undefined, function (e) {
    console.warn('[pet] 站姿动作加载失败，退回手调姿势:', e);
    if (onFail) onFail();
  });
}

/* 动作播完 → 回到「自然站立」（POSES[0]，静帧保持）
   ⚠️ 只在【单次播放】的动作上会触发；静帧是 paused 的，永远不结束
   ⚠️ 切动作时旧 helper 会被整个丢弃 → 那个 mixer 上的本回调不会再触发，无需手动解绑 */
function onPoseFinished() {
  /* ★ 播完 → 回到【选定的初始状态】（自然站立 或 趴），不再写死 自然站立 ✅
     （用户 2026-10-12：趴与自然站立列入「初始状态」，其余动作播完进入选定的初始状态）*/
  var tgt = (typeof S.initPose === 'number') ? S.initPose : 0;
  if (S.poseIndex === tgt) return;        /* 已经在该初始状态，别重复切 */
  console.log('[pet] 动作播完 → 回到初始状态「' + POSES[tgt][0] + '」');
  setPose(tgt);
}

/* 把动作播完后的姿势存为"基础"，之后程序化动画都在它之上叠加
   —— 这样既有人工调过的自然站姿，又能无限循环（不依赖动作本身能不能循环） */
function captureBase() {
  if (S.baseCaptured) return;
  S.base = {};
  Object.keys(S.bones).forEach(function (n) {
    var b = S.bones[n];
    S.base[n] = { rx: b.rotation.x, ry: b.rotation.y, rz: b.rotation.z,
                  sy: b.scale.y, py: b.position.y };
  });
  /* ⚠️ 动作自带的【重心位移】会让桌宠在窗口里飘走 → 所有根骨的 X/Z 都钉回静止值，
        Y 留给程序化起伏（和 frame() 里同一套处理，见 ROOT_BONES 注释） */
  for (var bi = 0; bi < ROOT_BONES.length; bi++) {
    var rb = S.bones[ROOT_BONES[bi]], rr = S.rest && S.rest[ROOT_BONES[bi]];
    if (rb && rr) { rb.position.x = rr.px; rb.position.z = rr.pz; }
  }
  S.baseCaptured = true;
  S.poseReadyAt = Date.now();      /* ★ 站姿已定格 → 可以准备整体显示了 ✅（见 frame 里的显示时机）*/
  /* ★★ 2026-10-17：兜底显示时间改成「姿势就绪后 9 秒」
     —— 原来是 onLoad+12s，而姿势本身就要 12.6s ⇒ 一到位就被兜底强制显示，
        衣服（如粉红色围裙）还没传完就露了主体 ❌ 现在改成从姿势就绪开始算 ✅ */
  S.revealDeadline = Date.now() + 9000;
  window.__PET_READY__ = true;
  console.log('[pet] 基础姿势已定格（' + Object.keys(S.base).length + ' 根骨骼）');
}

/* 程序化要动的骨骼 —— 每帧顺序：复位到静止姿势 → 动作驱动 → 叠加我的增量
   这样复用同一批骨骼也不会累积，同时完整保留动作本身的运动 ✅ */
var LAYER_BONES = ['上半身', '上半身2', '上半身3', '頭', '首', '左目', '右目',
                   '左髮_1', '右髮_1', '右腕', '右ひじ'];

/* ★ 根骨 —— 这几个都会被 VMD 驱动，一推就把整个模型挪走
   ⚠️ 只钉 センター 是不够的（原来就是那么做的）：实测 全ての親 / グルーブ / グルーブ2 / センター2
      同样会被动作驱动 → 模型被推远/推近 → 透视上就是「看起来忽大忽小」
      （用户反馈：动作播放时模型大小会变化，切到喵喵喵会变小 —— 喵喵喵基准位置比待机远约 1.6 单位）
   → frame() 里每帧把它们的 X/Z 钉回静止值（Y 不动，留给动作的上下起伏/我的呼吸） */
var ROOT_BONES = ['センター', 'センター2', 'グルーブ', 'グルーブ2', '全ての親'];

/* ★ 脊柱骨（只转不移）—— 它们的位置会被动作反复叠加（见 frame() 里的注释）
   ⚠️ 这是「连点喵喵喵叠加缩小」的真凶：每切一次 +2.33 单位，累积推远下沉 */
var SPINE_POS_BONES = ['上半身', '下半身'];

function resetLayerBones() {
  if (!S.rest) return;
  for (var i = 0; i < LAYER_BONES.length; i++) {
    var n = LAYER_BONES[i], b = S.bones[n], r = S.rest[n];
    if (b && r) b.rotation.set(r.rx, r.ry, r.rz);
  }
}

/* 叠加增量 */
function applyRot(n, drx, dry, drz) {
  var b = S.bones[n];
  if (!b) return;
  b.rotation.x += drx; b.rotation.y += dry; b.rotation.z += drz;
}

/* ★ 把所有【表情 morph】归零
   ⚠️ 实测坑（用户反馈"动作涉及头部/表情变化时有残留，切换其他动作不恢复"）：
      这个模型其实有 65 个 morph（あ/い/う/え/お/にやり/まばたき/口角上げ…）。
      动作的 morph 轨道只写它自己用到的那些，切换动作时上一个动作用过的 morph
      不会被新动作覆盖 → 表情就一直卡着。
      （实测：默认姿势下索引 21 的 morph 卡在 0.94 → 脸一直是眯着的 */
function resetMorphs() {
  var inf = S.mesh && S.mesh.morphTargetInfluences;
  if (!inf) return;
  for (var i = 0; i < inf.length; i++) inf[i] = 0;
}

/* ★★ 2026-10-17 新增：在线表情（调整台左侧「表情」页）
   PET_SETTINGS.expr = { morph名: 0~1 } —— 每帧在【动作】之后写一遍
   ⚠️ 顺序很关键：resetMorphs/动作 每帧都会改 morph，我们最后写才不会被盖掉 ✅
   ⚠️ 只写 expr 里出现的名字；其余表情不受影响（眨眼机制 2026-10-18 已删除）*/
