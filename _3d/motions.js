/* ============================================================================
   动作清单 —— pet.html（桌宠）与 viewer.html（浏览器）共用的【单一数据源】
   增删动作只改本文件；改完务必重算下面 MOTION_GROUP_DEFS 的下标 ✅

   字段：
     n 显示名 ｜ f VMD 路径 ｜ ik 关足IK（FK 腿 = true，IK/D 链 = false，选错会腿僵）
     a, b 帧区间（缺省 = 整段，a == b = 定格该帧）｜ loop 一直循环 ｜ hint 下拉提示
     cam 逐动作相机补偿 { aim: [x, y, z] } ｜ freezePhys 冻结的刚体名前缀
     noPhys 关物理 ｜ noGrant 关付与
   ============================================================================ */

var MOTION_DEFS = [
  /* 站姿：定格待机动作第 20 帧（手臂自然下垂），启动只加载这一帧的小文件 */
  { n: '自然站立',   f: 'motion/站姿_启动.vmd',        ik: true,  a: 20,  b: 20   },

  /* 官方待机拆两段，拆分点 525（回到接近起始姿态处，循环不跳帧）*/
  { n: '待机·第1段', f: 'motion/纳西妲待机动作.vmd',   ik: true,  a: 20,  b: 525  },  /*  0.7~17.5s */
  { n: '待机·第2段', f: 'motion/纳西妲待机动作.vmd',   ik: true,  a: 525, b: 1108 },  /* 17.5~36.9s */

  /* 同人舞蹈（禁二次配布 / 禁商用）；烘焙版已清零根骨位置轨，避免切换累积漂移 */
  { n: '喵喵喵',     f: 'motion/喵喵喵.vmd',     ik: true,
    hint: '长舞蹈 · 载入慢' },

  /* 攻击：纯 FK，必须关足IK（否则 D 链被 IK 目标拽回 → 腿僵）*/
  { n: '元素爆发', f: 'motion/元素爆发.vmd', ik: true },

  /* 躺姿：根骨绕 X 转 90°，用 cam.aim 把视线中心带到躺下后的身体位置；
     世界重力与躺姿不兼容（布料被顶飞）→ 关物理 */
  { n: '摇腿',   f: 'motion/摇腿.vmd',   ik: false,  loop: true,
    cam: { aim: [0, -4.64, 5.75] },
    noPhys: true },

  /* 站姿小动作 */
  { n: '摇一摇', f: 'motion/摇一摇.vmd', ik: true },

  /* 坐姿（VMD 铺的是 0~30 帧恒定值）：
     开足IK（与 Blender 里对齐）；模型下沉 20 单位 → cam 下移视线。
     ★ noPhys: true —— 坐姿物理不兼容，必须关（2026-10-23 实测）：
       模型下沉 + 大腿压住裙子 ⇒ 布料/头发刚体被身体持续顶飞，
       每帧最大骨旋转中位 32.9°、最大 80°（自然站立只有 3~5°）。
       loop 照旧保留 —— 物理关着时 MMDAnimationHelper 根本不会执行 physics.reset()
       （lib 第 481 行 `if (looped && this.enabled.physics)`），所以循环也不会抽 ✅
     ⚠️ 不要改成 a==b 定格：viewer 用 AnimationUtils.subclip(a,b) 截段，
        a==b 会截出 duration 0 的 clip ⇒ 浏览器里这两个动作播不了 ✅ */
  { n: '鸭子坐', f: 'motion/鸭子坐.vmd', ik: false, a: 0, b: 30, loop: true,
    cam: { aim: [0, -17.7, 2.0] },
    freezePhys: ['裙摆'], noPhys: true },

  /* 抱膝坐：FK 摆姿（关足IK）；落地位移写在 全ての親
     ★ noGrant: true —— 必须关付与，否则足的位置不对（关了才正常）
     ★ 同样 noPhys: true（理由同上）*/
  { n: '抱膝坐', f: 'motion/抱膝坐.vmd', ik: true, a: 0, b: 30, loop: true,
    cam: { aim: [0, -6.1, 0] },
    freezePhys: ['裙摆'], noGrant: true, noPhys: true }
];

/* 分组（值 = MOTION_DEFS 下标，顺序 = 菜单/下拉显示顺序）
   第 0 组「初始状态」= 两个页面的初始态 + 换动作时的归位目标
   ⚠️ 增删动作后必须重算下标；越界会让右键菜单渲染中断 ⇒ 菜单直接不显示 */
var MOTION_GROUP_DEFS = [
  ['初始状态', [0, 5, 7, 8]],
  ['专属动作', [1, 2, 4]],
  ['其他',     [3, 6]]
];
