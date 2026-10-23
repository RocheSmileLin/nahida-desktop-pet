/* ============================================================================
   基础环境：渲染器、照片级调色、场景/相机/灯光
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ---------------- 基础环境 ---------------- */
var stage = document.getElementById('stage');
var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setClearAlpha(0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
/* ★★ 2026-10-17 画质：ACES 色调映射（≈ Blender 的 Filmic/AgX）+ 软阴影
   —— 浏览器默认是"线性直出"，高光一撞就死白、暗部发灰，这是"没质感"的主因 ✅ */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

/* ══════════════════════════════════════════════════════════════════
   ★★ 照片级调色：对比度 / 高光 / 阴影 —— 与 pet.html 共用
   js/shared/photo-grade.js（NXD.createPhotoGrade）
   这里保留原来的函数名（applyGrade / renderScene …），旧代码无需改动。
   ══════════════════════════════════════════════════════════════════ */
var photoGrade = null;
var GRADE = { contrast: 1.0, highlights: 0.0, shadows: 0.0 };
function resizeGradeTarget() { if (photoGrade) { photoGrade.resize(); } }
function gradeActive() { return photoGrade ? photoGrade.active() : false; }
function ensureGrade() { if (photoGrade) { photoGrade.ensure(); } }
function applyGrade(s) {
  if (photoGrade) { photoGrade.apply(s); GRADE = photoGrade.GRADE; }
  needsRender = true;                 /* 视口是静态按需渲染 → 调色后必须重画一帧 */
}
/* 统一出口：调色激活时先渲到贴图再上色，否则直出（省一次全屏 pass）*/
function renderScene() { photoGrade.render(); }

var scene = new THREE.Scene();
var FOV = 30;
var camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
var W = 1, H = 1;
photoGrade = NXD.createPhotoGrade(renderer,
  function () { return scene; },
  function () { return camera; },
  function () { needsRender = true; });
GRADE = photoGrade.GRADE;

/* 灯光：跟 pet.html 同一套配比 —— 调整台调的就是它 ✅ */
var PET_BRIGHTNESS = 0.85;
var L = { ambient: 0.44, hemi: 0.12, key: 0.33, fill: 0.10 };
var ambientLight = new THREE.AmbientLight(0xffffff, L.ambient * PET_BRIGHTNESS);
var hemiLight    = new THREE.HemisphereLight(0xffffff, 0xbfd8c0, L.hemi * PET_BRIGHTNESS);
var keyLight     = new THREE.DirectionalLight(0xffffff, L.key * PET_BRIGHTNESS);
var fillLight    = new THREE.DirectionalLight(0xffffff, L.fill * PET_BRIGHTNESS);
keyLight.position.set(0.4, 1.0, 0.9);
fillLight.position.set(-0.6, 0.3, 0.6);
/* ★★ 阴影（EEVEE 那种软阴影）：主光投影 + 脚下接影平面 ✅
   ⚠️ 原来的阴影相机只有 ±1 单位（按 1m 模型配的），而 MMD 模型有 ~15 单位 →
      模型完全在阴影相机外 ⇒ 阴影其实一直没生效。改成按模型尺寸自适应（见 fitShadow）✅ */
var SHADOW_R = 10;                        /* 阴影相机半径（模型加载后按包围盒算）*/
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.0008;
if ('normalBias' in keyLight.shadow) { keyLight.shadow.normalBias = 0.02; }
keyLight.shadow.radius = 3;
/* 光源方向 → 位置（方向光只认方向，但阴影相机摆在 position 上，所以必须放远一点）*/
function setKeyDir(x, y, z) {
  var v = new THREE.Vector3(x, y, z).normalize().multiplyScalar(SHADOW_R * 2.5);
  keyLight.position.copy(v);
  fitShadowCamera();
}
function fitShadowCamera() {
  var sc = keyLight.shadow.camera;
  var r = SHADOW_R;
  sc.left = -r; sc.right = r; sc.top = r * 1.6; sc.bottom = -r * 0.6;
  sc.near = 0.1; sc.far = r * 8;
  sc.updateProjectionMatrix();
  if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
}
fitShadowCamera();
/* 边缘补光（背后冷光）—— 让头发/轮廓有层次 ✅ */
var rimLight = new THREE.DirectionalLight(0xbfd4ff, 0.20);
rimLight.position.set(-0.5, 0.9, -1.1);
scene.add(rimLight);
scene.add(ambientLight); scene.add(hemiLight); scene.add(keyLight); scene.add(fillLight);

function applyLighting() {
  ambientLight.intensity = L.ambient * PET_BRIGHTNESS;
  hemiLight.intensity    = L.hemi    * PET_BRIGHTNESS;
  keyLight.intensity     = L.key     * PET_BRIGHTNESS;
  fillLight.intensity    = L.fill    * PET_BRIGHTNESS;
  if (typeof applyEnv === 'function') { applyEnv(); }   /* ★ 亮度改了 → 世界环境预设要重算 */
}
