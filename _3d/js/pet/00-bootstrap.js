/* ============================================================================
   启动前置：Ammo 适配、物理/渲染旋钮、拖动惯性、逐动作布料冻结
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ★ Ammo 适配层 —— 这个 ammo.js 是【异步工厂】：Ammo() 返回 Promise，
   而 MMDPhysics.js 要求全局 Ammo 上【直接】有 btVector3 / btRigidBody 等类。
   实测：不处理的话报 `Ammo.btVector3 is not a constructor`。
   → 等工厂解析完，把拿到的【模块对象】挂成 window.Ammo，MMDPhysics 就能照常同步用。*/
var AMMO_MODULE = null;
(function () {
  if (typeof Ammo === 'undefined') { console.log('[ammo] 未加载 → 物理不可用'); return; }
  if (Ammo.btVector3) { AMMO_MODULE = Ammo; console.log('[ammo] 已是同步模块，直接用 ✅'); return; }
  if (typeof Ammo === 'function') {
    try {
      Ammo().then(function (M) {
        AMMO_MODULE = M;
        window.Ammo = M;                       /* ★ 关键：换成模块对象 */
        console.log('[ammo] 异步工厂已解析 → 物理可用 ✅');
      })['catch'](function (e) { console.log('[ammo] 解析失败: ' + e); });
    } catch (e) {
      console.log('[ammo] 调用失败: ' + e);
    }
  } else {
    console.log('[ammo] 不认识的形式: ' + typeof Ammo);
  }
})();

/* ★ 物理总开关（用户要求「加一点物理效果」；右键菜单里可切）
   · PHYSICS_ON  = 用户意愿
   · physicsUsable() = 用户意愿 + Ammo 真的就绪了
   ⚠️ 物理是在 helper.add() 时创建的 → 切换后要重载当前姿势才真正生效 */
var PHYSICS_ON = true;

/* ★★ 物理性能旋钮 —— 嫌卡就改这里，不用动 lib/ 里的引擎文件 ★★
   · unitStep    物理步长：越小越准、越费 CPU。默认 1 / 65
     ⚠️ lib/MMDPhysics.js 第 39~42 行的源码注释原话：
        「1/60 这种偏大的步长很容易把模型算坏，所以设成 1/65」
        → 所以【不要往上调】
     ⚠️ 实测（2026-10-09）：这两个旋钮对 CPU 几乎没用 ——
        关物理 68% / 开物理 151%（maxStepNum=3）/ 160%（maxStepNum=1）
        → 开销主要在【每帧把 349 个刚体的位姿同步回骨骼】，跟步数无关
        → 真要降 CPU：① 菜单里关掉物理 ② 限制渲染帧率（见 frame() 开头）
   · maxStepNum  每帧最多算几步，默认 3（保持默认即可）
   · warmup      加载时先空跑几步让布料垂下来，默认 60，只影响加载那一瞬间 */
/* ★★⚠️ 定步长 —— 千万别往大调！MMDPhysics.js 源码第 39~42 行原话：
     「1/60 这种偏大的步长很容易把模型算坏，故设 1/65」
   ⚠️ 实测教训（2026-10-09）：这里曾被改成 1/30 → 一帧只跑 1 步、步长 0.0333s
      → 小刚体（鬓发链 / 手环 / 足环）解不干净 → 【翻飞抽动】
      → 而且【与重力无关】（-170~0 都抖）、【加阻尼完全无效】
      （因为抖是"步长误差引入的能量"，不是自由振荡 ✅）
   恢复引擎默认 1/65：一帧跑 2 步、步长 0.0154s ✅ */
var PHYSICS_UNIT_STEP = 1 / 65;
var PHYSICS_MAX_STEP_NUM = 3;        /* ← 每帧最多几步*/
var PHYSICS_WARMUP = 60;             /* ← 加载时的预热步数 */

/* ★ 渲染帧率上限（0 = 不限制，跑满 vsync；例：30 = 30fps 上限）
   ⚠️ 物理和渲染都跟着帧率走，是最有效的降 CPU 旋钮 —— 但实测收益比预期小：
        60fps + 物理 151%   →   30fps + 物理 138%（只降 11%）
        关掉物理     68%
      原因：帧率减半后每帧 dt 变大 → MMDPhysics 每帧改算 3 步（上限 maxStepNum）
            → 物理总量只减约 25%
   ▶ 想真降 CPU 的有效组合：MAX_FPS = 30  【并且】PHYSICS_MAX_STEP_NUM = 1
       （后者单独改没用 —— 60fps 下本来就要 2 步，改成 1 只是每帧少一步）
   ▶ 最省事：右键菜单直接关掉物理（68%）✅ */
var MAX_FPS = 0;

/* ★★ 物理形变程度总旋钮 —— 重力（唯一官方公开的运行时 API，见 lib/MMDPhysics.js 第 156 行）
   ⚠️ MMD 单位下默认重力是 (0, -98, 0)（源码：9.8 × 10）→ 别填 -9.8，那几乎等于没重力
   · 形变【小 / 更贴身】：调小绝对值，例如 -40
   · 形变【大 / 更垂】：调大绝对值，例如 -160
   · 0 → 几乎不动；正数 → 反重力飘起来
   ▶ 改这个不影响 CPU（开销在每帧同步刚体位姿，与重力无关）
   ▶ 想更精细（阻尼 / 关节弹簧）见下面注释里的两条路 */
/* ★ 三档强度（右键菜单里切）—— 直接改重力大小，【立即生效、不用重载姿势】
   ⚠️ 数值是 MMD 单位（默认 -98 = 9.8×10）；别用 -9.8，那几乎等于没重力 */
var PHYSICS_LEVELS = [
  ['弱', -0],       /* 形变小，衣物/头发更贴身 */
  ['中', -10],       /* = 模型自带的重力（原行为）*/
  ['强', -15]       /* 形变大，更垂 */
];
var PHYSICS_LEVEL = 1;                                   /* 默认「中」*/
var PHYSICS_GRAVITY_Y = PHYSICS_LEVELS[PHYSICS_LEVEL][1];

function setPhysicsLevel(i) {
  if (i < 0 || i >= PHYSICS_LEVELS.length) return;
  PHYSICS_LEVEL = i;
  PHYSICS_GRAVITY_Y = PHYSICS_LEVELS[i][1];
  applyPhysicsGravity();          /* 重力立即生效，不需要重载姿势 ✅ */
  console.log('[pet] 物理强度 → ' + PHYSICS_LEVELS[i][0]
              + '（重力 Y = ' + PHYSICS_GRAVITY_Y + '）');
}

/* 更精细的两个层次（需要遍历，没有官方批量 API）：
   ① 阻尼（每刚体，PMX 的「移动衰减 / 回転衰减」）
      S.helper.objects.get(S.mesh).physics.bodies.forEach(function (b) {
        b.body.setDamping(0.9, 0.9);        // 越大 → 摆动停得越快
      });
   ② 关节弹簧（每关节，PMX 的「弹簧系数」，见 MMDPhysics.js 第 984~1000 行）
      physics.constraints.forEach(function (c) {
        for (var i = 0; i < 6; i++) c.constraint.setStiffness(i, 5);
      });                                    // 越大 → 越强地拉回原形 = 形变越小
   ③ 改完记得：S.poseIndex 重载一次（setPhysics 就是这么做的）或直接改完立刻生效
      —— 重力是立即生效的；阻尼/弹簧改动后建议 physics.reset() 一下 */

function applyPhysicsGravity() {
  try {
    var o = (S.helper && S.helper.objects) ? S.helper.objects.get(S.mesh) : null;
    if (o && o.physics && o.physics.setGravity) {
      o.physics.setGravity(new THREE.Vector3(0, PHYSICS_GRAVITY_Y, 0));
      console.log('[pet] 物理重力 Y = ' + PHYSICS_GRAVITY_Y
                  + '（默认 -98；越负越下垂，越接近 0 越贴身）');
    }
  } catch (e) {}
}

function physicsUsable() { return PHYSICS_ON && !!AMMO_MODULE; }

/* ★★ 拖动惯性（新功能）—— 开着物理时拖动桌宠，衣物/头发/人体会往反方向甩动
   原理：拖桌宠动的是【窗口】，模型在自己的 3D 空间里静止不动
         → 物理完全感受不到运动 → 布料死板一动不动
         → 必须把"拖动"当成【外力】注入刚体 ✅
   数据来源：Python 每 16ms 把【窗口位移量】推过来（petDragVel(dx,dy)）
            不依赖鼠标事件 → 任务栏/键盘/任何方式移动窗口都有效 ✅
   注入时机：挂在 MMDAnimationHelper 的官方钩子 onBeforePhysics 上
             （它在 IK/grant 之后、physics.update() 之前调用 ✅）
             → 外力一定落在"紧接着的那一步"上 ✅
   ★ 只在【开物理】时有效（钩子本身只在物理开启时被调用 ✅），关物理则无效果 ✅ */
var DRAG_INERTIA = 80;          /* ← 旋钮：拖动力度（对着模型重力 98 调，1~3 是轻柔感 ✅）*/
var DRAG_DECAY = 0.9;          /* ← 松手后的衰减系数（越小停得越快 ✅）*/
var DRAG_TILT = -1;             /* ← 旋钮：绕【抓取点】摆动的力度（0=关；方向反了写成负数 ✅）*/
var DRAG_VEL = { x: 0, y: 0 };
var _dragForce = null;         /* Ammo.btVector3 —— 【复用】，每帧 new 一个会泄漏 ✅*/

window.petDragVel = function (dx, dy) {
  DRAG_VEL.x = dx; DRAG_VEL.y = dy;
  /* 只报一次：证明 Python → 页面的这条链路通了（免得以后又怀疑"没接通"）✅ */
  if (!window._dragLogged) {
    window._dragLogged = 1;
    console.log('[pet] 拖动惯性：已收到窗口位移 ' + dx + ',' + dy
                + '（物理' + (physicsUsable() ? '开 ✅ 会甩' : '关 ❌ 不甩') + '）');
  }
};

function applyDragInertia() {
  if (!physicsUsable()) { return; }
  if (DRAG_VEL.x === 0 && DRAG_VEL.y === 0) { return; }
  if (!_dragForce && window.Ammo) { _dragForce = new Ammo.btVector3(0, 0, 0); }
  if (!_dragForce) { return; }
  var o = (S.helper && S.helper.objects) ? S.helper.objects.get(S.mesh) : null;
  if (!o || !o.physics || !o.physics.bodies) { return; }
  var arr = o.physics.bodies;
  var vx = DRAG_VEL.x, vy = DRAG_VEL.y;
  for (var i = 0; i < arr.length; i++) {
    var b = arr[i];
    if (!b || !b.body || b.paramType !== 1) { continue; }
    /* ⚠️ 只推【物理演算】刚体（paramType 1）：
          type 0 = 骨骼追従、type 2 = 物理演算+骨位置合わせ
          推它们等于跟骨骼抢父级 → 就是之前"揪动"那个坑（见技能 §6.10）✅ */
    var m = b.body.getMass ? b.body.getMass() : 0;
    if (!(m > 0)) { continue; }
    /* 按质量缩放 → 同一套参数下头发和裙子表现一致（DRAG_INERTIA 就是"加速度"）✅
       符号：窗口右移 → 布料向左甩；窗口下移 → 布料向上甩（屏幕 y 与 3D y 反向）✅ */
    _dragForce.setValue(-vx * DRAG_INERTIA * m, vy * DRAG_INERTIA * m, 0);
    b.body.applyCentralForce(_dragForce);
  }
  /* ★★ 绕【抓取点】摆动 —— 抓哪儿就以哪儿为支点（"以鼠标位置为中心点" ✅）
     抓取点 = 光标相对模型中心的位置（mouse.x / mouse.y，宿主每 16ms 推来，范围 ±1 ✅）
     θ = 抓取点偏移 × 拖动量 的二维叉积：
        抓着头（mouse.y 绝对值大）横拖 → 头被带走、上身跟着甩 ✅
        抓着手（mouse.x 绝对值大）竖拖 → 手被带走 ✅
        抓在正中间 → 叉积 ≈ 0 → 几乎不转，整体平移 ✅
     ⚠️ 作用在【上半身】：它在 LAYER_BONES 里（每帧先复位再叠加 → 不会累积）
        —— 这也是现成代码里摇摆/呼吸用的同一根骨，行为已验证 ✅
     ⚠️ 方向反了：把 DRAG_TILT 改成负数即可 ✅ */
  if (DRAG_TILT) {
    var theta = DRAG_TILT * (mouse.x * vy - mouse.y * vx) * 0.004;
    if (theta > 0.35) { theta = 0.35; }        /* 夹住，别真把腰甩断 ✅ */
    if (theta < -0.35) { theta = -0.35; }
    applyRot('上半身', 0, 0, theta);
  }
  /* 每帧衰减：松手后还余一点惯性，自然收尾 ✅ */
  DRAG_VEL.x *= DRAG_DECAY;
  DRAG_VEL.y *= DRAG_DECAY;
}
function setPhysics(on) {
  PHYSICS_ON = !!on;
  var applied = physicsUsable();
  try {
    if (S.helper && S.helper.enabled) {
      S.helper.enabled.physics = applied;      /* 运行时开关，MMDAnimationHelper 第 488 行 */
    }
  } catch (e) {}
  console.log('[pet] 物理开关 → ' + (applied ? '开' : '关')
              + (PHYSICS_ON && !AMMO_MODULE ? '（Ammo 还没就绪）' : ''));
  if (typeof S.poseIndex === 'number' && typeof setPose === 'function') {
    setPose(S.poseIndex);                      /* 重载当前姿势，让物理真正生效/停下 */
  }
}

/* ★★ 逐动作布料冻结（2026-10-14 用户要求：「开启物理效果下，单独为坐姿的裙子添加静止效果」）
   —— 做法：把 motions.js 里 freezePhys 前缀命中的【物理演算刚体】(params.type 1/2)
      临时改成【骨骼追従】(type 0)：
        · updateFromBone() 只对 type 0 生效 → 刚体跟着骨骼走 ✅
        · updateBone() 对 type 0 直接 return → 物理结果【不再写回骨骼】✅
      ⇒ 这些布料完全由动作决定形状，不再下垂 / 被身体顶开 ✅
   ⚠️ params 是 PMX 的共享数据 ⇒ 必须记下原值，换动作 / 关物理时还原 ✅
   ⚠️ 只对带 freezePhys 的动作生效；其它动作一个字节都不动 ✅ */
var _frozenBodies = null;
function unfreezePhys() {
  if (!_frozenBodies) { return; }
  for (var i = 0; i < _frozenBodies.length; i++) {
    _frozenBodies[i][0].params.type = _frozenBodies[i][1];   /* 还原原 type ✅ */
  }
  _frozenBodies = null;
}
function applyFreezePhys() {
  unfreezePhys();                        /* 先还原上一动作的冻结（幂等）✅ */
  if (!physicsUsable()) { return; }      /* 物理没开 → 不冻结（也不用还原了）✅ */
  var mo = null;
  try {
    if (typeof MOTION_DEFS !== 'undefined' && MOTION_DEFS[S.poseIndex]) {
      mo = MOTION_DEFS[S.poseIndex];
    }
  } catch (e) {}
  var pats = (mo && mo.freezePhys && mo.freezePhys.length) ? mo.freezePhys : null;
  if (!pats) { return; }
  var o = (S.helper && S.helper.objects) ? S.helper.objects.get(S.mesh) : null;
  if (!o || !o.physics || !o.physics.bodies) { return; }
  _frozenBodies = [];
  for (var bi = 0; bi < o.physics.bodies.length; bi++) {
    var b = o.physics.bodies[bi];
    if (!b || !b.params || b.params.type === 0) { continue; }
    var nm = b.params.name || '';
    for (var pi = 0; pi < pats.length; pi++) {
      if (nm.indexOf(pats[pi]) >= 0) {
        _frozenBodies.push([b, b.params.type]);
        b.params.type = 0;               /* → 骨骼追従：物理不再干预 ✅ */
        break;
      }
    }
  }
  console.log('[pet] 「' + (mo.n || '') + '」布料静止：' + _frozenBodies.length
              + ' 个刚体已从「物理演算」切为「骨骼追従」（' + pats.join('/') + '）✅');
}
