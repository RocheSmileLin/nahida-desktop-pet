/* ============================================================================
   基础环境：渲染器、照片级调色、场景/相机/灯光、默认设置、环境预设
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ============ 基础环境 ============ */
/* ★ 2026-10-20 性能三连 ①：关 MSAA
   原因：iGPU 上 4×MSAA 是填充率大头（1000×1000@1.5DPR ≈ 2.25M 像素 × 4）
   代价：边缘略糙 —— 由「② DPR 上限 1.25」把清晰度补回来，整体观感几乎不变 */
var renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: false });
renderer.setClearAlpha(0);
/* ★ 2026-10-20 性能三连 ②：DPR 上限 2 → 1.25
   150% 系统缩放时：像素数 2.25× → 1.56×（少 30% 填充），1080p 屏上肉眼无差 */
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
/* ★★ 2026-10-17 画质：ACES 色调映射（≈ Blender 的 Filmic/AgX）—— 与中央视口一致 ✅ */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
/* ★ 2026-10-17 阴影：模型自遮挡（桌面端也要层次）✅ */
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

/* ══════════════════════════════════════════════════════════════════
   ★★ 照片级调色：对比度 / 高光 / 阴影 —— 与 viewer.html 共用
   js/shared/photo-grade.js（NXD.createPhotoGrade）
   这里保留原来的函数名（applyGrade / renderScene …），旧代码无需改动。
   ══════════════════════════════════════════════════════════════════ */
var photoGrade = null;
var GRADE = { contrast: 1.0, highlights: 0.0, shadows: 0.0 };
function resizeGradeTarget() { if (photoGrade) { photoGrade.resize(); } }
function gradeActive() { return photoGrade ? photoGrade.active() : false; }
function ensureGrade() { if (photoGrade) { photoGrade.ensure(); } }
function applyGrade(v) { if (photoGrade) { photoGrade.apply(v); GRADE = photoGrade.GRADE; } }
function renderScene() { photoGrade.render(); }

var scene  = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 3000);
/* ★ 调色器必须在 scene / camera 建好之后创建（它按需读取这两个全局对象）*/
photoGrade = NXD.createPhotoGrade(renderer,
  function () { return scene; },
  function () { return camera; });
GRADE = photoGrade.GRADE;
/* ★ 整体亮度旋钮：嫌亮就调小、嫌暗就调大（1.0 = 第一版）
   改完保存 → 重启桌宠生效 */
var PET_BRIGHTNESS = 0.85;

/* 灯光：环境光打底 + 前上方主光出明暗（配合 MeshLambertMaterial）
   ⚠️ 实测演进：无光照 212.9（太白）→ 200.3 → 186.0
      纯调灯不线性（sRGB 曲线），所以留这个系数方便继续压 */
/* ★ 灯改成"可实时调"：留下引用 + 由 applyLighting() 按 PET_SETTINGS 统一设置 ✅
   ⚠️ 0.44/0.12/0.33/0.10 是当初调好的【配比】，调整台给的是【基准值】，
      最终强度 = 基准值 × 整体亮度 ✅ → 所以"整体亮度"是整体压，"单项"是改配比 ✅ */
var ambientLight = new THREE.AmbientLight(0xffffff, 0.44 * PET_BRIGHTNESS);
scene.add(ambientLight);
var hemiLight = new THREE.HemisphereLight(0xffffff, 0xbfd8c0, 0.12 * PET_BRIGHTNESS);
scene.add(hemiLight);
var keyLight = new THREE.DirectionalLight(0xffffff, 0.33 * PET_BRIGHTNESS);
keyLight.position.set(0.4, 1.0, 0.9);
scene.add(keyLight);
/* ★★ 2026-10-17 阴影（模型自遮挡：刘海→脸、披风→身体、裙摆→腿）
   ⚠️ 桌面没有地面 → 这里只做【模型自阴影】，但层次主要就来自它 ✅
   阴影相机按模型尺寸自适应（见 fitPetShadow），原来的 ±1 单位根本框不住 15 单位的模型 */
var PET_SHADOW_R = 10;
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.bias = -0.0008;
if ('normalBias' in keyLight.shadow) { keyLight.shadow.normalBias = 0.02; }
keyLight.shadow.radius = 3;
function fitPetShadowCamera() {
  var sc = keyLight.shadow.camera, r = PET_SHADOW_R;
  sc.left = -r; sc.right = r; sc.top = r * 1.6; sc.bottom = -r * 0.6;
  sc.near = 0.1; sc.far = r * 8;
  sc.updateProjectionMatrix();
  if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
}
function setPetKeyDir(x, y, z) {
  var v = new THREE.Vector3(x, y, z).normalize().multiplyScalar(PET_SHADOW_R * 2.5);
  keyLight.position.copy(v);
  fitPetShadowCamera();
}
function applyPetShadow() {
  var on = PET_SETTINGS.shadowOn !== false;
  keyLight.castShadow = on;
  var sz = +PET_SETTINGS.shadowSize || 1024;
  if (keyLight.shadow.mapSize.x !== sz) {
    keyLight.shadow.mapSize.set(sz, sz);
    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
  }
}
fitPetShadowCamera();
var fillLight = new THREE.DirectionalLight(0xffffff, 0.10 * PET_BRIGHTNESS);
fillLight.position.set(-0.6, 0.3, 0.6);

/* ★★★ 可调设置层 —— 「调整台」的接口（21 项）★★★
   ① 启动时：页面每 300ms 拉 /petsettings（见 js/pet/30-settings.js）→ applySettings ✅
   ② 运行时：调整台滑一下 → POST 给 Python → 下一轮轮询立即应用 ✅
   所有项都有默认值（= 当前行为）→ 没连上服务也照常跑 ✅ */
var PET_SETTINGS = {
  /* 相机 / 环境
     ★★ 2026-10-18：用户把调整台当时的值定为新默认（与 petapp/settings_store.py 的
        SETTING_DEFAULTS、js/settings/10-state.js 的 DEFAULTS 三处保持一致）*/
  brightness: 1.12, ambient: 0.91, hemi: 0.30, key: 0.67, fill: 0,
  size: 1.50, meshScale: 1.00,
  /* ★ 相机 / 取景（调整台可调 ✅）—— 默认值 = 原来写死的值，不拖就是原样 ✅ */
  camPitch: 15.0, camY: -0.08, camYaw: -30.0, camFov: 30.0,
  /* 物理 */
  physics: false, gravity: -10, unitStep: 1 / 65, maxStep: 3, warmup: 60, maxFps: 60,
  /* 拖动惯性 */
  dragInertia: 80, dragDecay: 0.9, dragTilt: -1,
  /* 视线 / 行为 */
  trackRange: 1000, gazeHead: 1.5, gazeEye: 1.5, breath: 0.5,
  /* 部件可见性（用户要求 ③）：{ 部件名: false } = 隐藏；
     缺省（不在字典里）= 可见 ✅ —— 模型的 23 个材质就是 23 个部件 ✅ */
  parts: { feet_hide: false },
  /* ★★ 2026-10-17 在线表情：{morph名: 0~1}（调整台左栏「表情」页）
     ⚠️ 必须在这里声明，否则 applySettings 的 hasOwnProperty 过滤会把它整包丢掉 ✅ */
  expr: {},
  /* ★★ 2026-10-17 视线（真眼球转动）：转 左目/右目 骨（PMX 原名），不是 morph
     虹膜 228 点挂在这两根骨上；「上/下/前」morph 动的是眉毛
     eyeMax=12° 实测自然（22° 以上贴片转到侧面 → 像闭眼）*/
  eyeUp: 0, eyeDown: 0, eyeLeft: 0, eyeRight: 0, eyeMax: 30,
  /* ★★ 2026-10-17 渲染设置（世界环境预设；桌宠背景本来就是透明的）*/
  renderMode: 'white', envPreset: 'court', bgTransparent: true, exposure: 0.5,
  /* 三渲二描边宽度（0~15，×0.01=场景单位；0=关描边）*/
  outlineWidth: 13,
  /* ★ 2026-10-17 照片级调色（后处理，和 /petsettings 同名字段）*/
  contrast: 2.0, highlights: -1.0, shadows: -1.0,
  /* ★ 2026-10-17 阴影（模型自遮挡）：开关 + 清晰度（shadow map 分辨率）*/
  shadowOn: true, shadowSize: 512,
  /* ★★★ 2026-10-17 三渲二（原神风）—— 记忆开关：写回 pet_settings.json，重启保持 ✅ */
  toonOn: false
};

/* 光感：最终强度 = 基准值 × 整体亮度 ✅（比例 0.44/0.12/0.33/0.10 是原配比）*/
function applyLighting() {
  var b = PET_SETTINGS.brightness;
  var p = (typeof ENV_PRESETS !== 'undefined' && ENV_PRESETS[PET_SETTINGS.envPreset])
          || { amb: 0xffffff, aMul: 1, sky: 0xffffff, gnd: 0xbfd8c0, hMul: 1,
               key: 0xffffff, kMul: 1, fill: 0xffffff, fMul: 1 };
  ambientLight.color.setHex(p.amb);
  hemiLight.color.setHex(p.sky); hemiLight.groundColor.setHex(p.gnd);
  keyLight.color.setHex(p.key);
  fillLight.color.setHex(p.fill);
  ambientLight.intensity = PET_SETTINGS.ambient * b * p.aMul;
  hemiLight.intensity    = PET_SETTINGS.hemi    * b * p.hMul;
  keyLight.intensity     = PET_SETTINGS.key     * b * p.kMul;
  fillLight.intensity    = PET_SETTINGS.fill    * b * p.fMul;
  /* ★ 三渲二：压环境光 + 抬主光 + 灯改到正前方偏上（原神角色永远前光）✅ */
  if (TOON_ON) {
    ambientLight.intensity *= 0.50;
    hemiLight.intensity    *= 0.55;
    keyLight.intensity     *= 1.50;
    fillLight.intensity    *= 0.70;
    setPetKeyDir(0.35, 0.60, 1.0);
    fillLight.position.set(-0.70, 0.25, 0.90);
  } else {
    setPetKeyDir(0.4, 1.0, 0.9);
    fillLight.position.set(-0.6, 0.3, 0.6);
  }
  renderer.toneMappingExposure = PET_SETTINGS.exposure || 1.05;
}

/* ★★ 2026-10-17 世界环境预设（与 viewer.html 同一套；桌宠背景本来就透明，所以只改灯光）*/
var ENV_PRESETS = {
  none:   { amb: 0xffffff, aMul: 1.00, sky: 0xffffff, gnd: 0xbfd8c0, hMul: 1.00, key: 0xffffff, kMul: 1.00, fill: 0xffffff, fMul: 1.00 },
  sunset: { amb: 0xffd9b8, aMul: 1.00, sky: 0xffb27a, gnd: 0x3a2a2a, hMul: 1.30, key: 0xffa860, kMul: 1.70, fill: 0x8899ff, fMul: 1.20 },
  dawn:   { amb: 0xdfe9ff, aMul: 1.10, sky: 0xbcd4ff, gnd: 0x5a6a7a, hMul: 1.15, key: 0xfff2e0, kMul: 1.10, fill: 0xaac4ff, fMul: 1.50 },
  noon:   { amb: 0xffffff, aMul: 1.20, sky: 0xffffff, gnd: 0xcccccc, hMul: 1.00, key: 0xffffff, kMul: 1.45, fill: 0xffffff, fMul: 1.00 },
  night:  { amb: 0x8fa4d8, aMul: 0.55, sky: 0x6f86c4, gnd: 0x14161f, hMul: 0.80, key: 0xaab8ff, kMul: 0.55, fill: 0x4455aa, fMul: 0.80 },
  indoor: { amb: 0xfff0e0, aMul: 0.95, sky: 0xffe6cc, gnd: 0x6a5a4a, hMul: 0.90, key: 0xffe0c0, kMul: 0.95, fill: 0x99aaff, fMul: 1.00 },
  studio: { amb: 0xffffff, aMul: 2.20, sky: 0xffffff, gnd: 0xeeeeee, hMul: 1.60, key: 0xffffff, kMul: 0.80, fill: 0xffffff, fMul: 2.60 },
  /* ★ 2026-10-18：补「庭院」（调整台里可选、用户当前默认用的就是它）
     —— 之前 pet.html 只有 7 个预设，选 courtyard 会静默回落到中性白，桌宠光照就和浏览器不一致 ✅ */
  court:  { amb: 0xffeedd, aMul: 1.05, sky: 0xffe0c0, gnd: 0x7a6a5a, hMul: 1.10, key: 0xfff0d0, kMul: 1.20, fill: 0xbbd0ff, fMul: 1.10 },
  forest: { amb: 0xdff0d8, aMul: 1.05, sky: 0xcfe6c0, gnd: 0x3a4a30, hMul: 1.20, key: 0xfff5d8, kMul: 1.15, fill: 0x9fd0a0, fMul: 1.30 }
};
