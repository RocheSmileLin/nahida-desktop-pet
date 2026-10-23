/* ============================================================================
   世界环境预设与轨道相机
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══════════════════════════════════════════════════════════════════════
   ★★ 2026-10-17 渲染设置（对应 Blender 侧 kafetools 的「渲染设置」面板）
      渲染引擎 = setMode（渲染 / 白模 / 线框）
      世界环境 = 下面这些预设（灯光颜色 + 强度倍率 + 背景色）
      透明     = 背景透明（用棋盘格表示 alpha，导出截图时就是真透明）✅
   ══════════════════════════════════════════════════════════════════════ */
var ENVP = 'none', BGTRANS = false, EXPOSURE = 1.05;
/* ★ 2026-10-17 阴影参数（调整台「渲染」页：地面接影 / 浓度 / 清晰度）*/
var SRECV = null;                       /* 脚下接影平面 */
var SHADOW_ON = true, SHADOW_OPACITY = 0.32, SHADOW_SIZE = 2048;
function applyShadow(s) {
  s = s || {};
  if (s.shadowOn !== undefined) { SHADOW_ON = !!s.shadowOn; }
  if (s.shadowOpacity !== undefined) { SHADOW_OPACITY = +s.shadowOpacity; }
  if (s.shadowSize !== undefined) { SHADOW_SIZE = +s.shadowSize || 2048; }
  if (SRECV) {
    SRECV.visible = SHADOW_ON;
    if (SRECV.material) { SRECV.material.opacity = SHADOW_OPACITY; }
  }
  if (typeof keyLight !== 'undefined' && keyLight) {
    keyLight.castShadow = SHADOW_ON;
    /* 清晰度 = shadow map 分辨率：越小越柔（512 很软 / 4096 很锐）
       ⚠️ 改完必须 dispose 旧 map，否则 three 不会重建 ✅ */
    if (keyLight.shadow && keyLight.shadow.mapSize &&
        keyLight.shadow.mapSize.x !== SHADOW_SIZE) {
      keyLight.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
      if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
    }
  }
  needsRender = true;
}
/* aMul/hMul/kMul/fMul = 在「调好的基础配比」上再乘的倍率（不是绝对值，所以亮度滑杆仍然有效）*/
var ENV_PRESETS = {
  none:   { amb: 0xffffff, aMul: 1.00, sky: 0xffffff, gnd: 0xbfd8c0, hMul: 1.00,
            key: 0xffffff, kMul: 1.00, fill: 0xffffff, fMul: 1.00, bg: '#0b0e13',
            img: '', label: '无（当前灯光）' },
  sunset: { amb: 0xffd9b8, aMul: 1.00, sky: 0xffb27a, gnd: 0x3a2a2a, hMul: 1.30,
            key: 0xffa860, kMul: 1.70, fill: 0x8899ff, fMul: 1.20, bg: '#2a1206',
            img: 'images/env/sunset.png', label: '日落' },
  dawn:   { amb: 0xdfe9ff, aMul: 1.10, sky: 0xbcd4ff, gnd: 0x5a6a7a, hMul: 1.15,
            key: 0xfff2e0, kMul: 1.10, fill: 0xaac4ff, fMul: 1.50, bg: '#16202b',
            img: 'images/env/sunrise.png', label: '清晨' },
  noon:   { amb: 0xffffff, aMul: 0.95, sky: 0xffffff, gnd: 0xcccccc, hMul: 1.00,
            key: 0xffffff, kMul: 1.15, fill: 0xffffff, fMul: 1.00, bg: '#0c1016',
            img: 'images/env/city.png', eMul: 0.72, label: '城市（正午）' },
  night:  { amb: 0x8fa4d8, aMul: 0.55, sky: 0x6f86c4, gnd: 0x14161f, hMul: 0.80,
            key: 0xaab8ff, kMul: 0.55, fill: 0x4455aa, fMul: 0.80, bg: '#05070d',
            img: 'images/env/night.png', eMul: 1.30, label: '夜晚' },
  indoor: { amb: 0xfff0e0, aMul: 0.95, sky: 0xffe6cc, gnd: 0x6a5a4a, hMul: 0.90,
            key: 0xffe0c0, kMul: 0.95, fill: 0x99aaff, fMul: 1.00, bg: '#14100c',
            img: 'images/env/interior.png', eMul: 1.05, label: '室内' },
  studio: { amb: 0xffffff, aMul: 2.20, sky: 0xffffff, gnd: 0xeeeeee, hMul: 1.60,
            key: 0xffffff, kMul: 0.80, fill: 0xffffff, fMul: 2.60, bg: '#ffffff',
            img: 'images/env/studio.png', eMul: 1.10, label: '影棚（暗背景）' },
  forest: { amb: 0xdff0d8, aMul: 1.05, sky: 0xcfe6c0, gnd: 0x3a4a30, hMul: 1.20,
            key: 0xfff5d8, kMul: 1.15, fill: 0x9fd0a0, fMul: 1.30, bg: '#0f1a0e',
            img: 'images/env/forest.png', eMul: 0.92, label: '森林' },
  court:  { amb: 0xffeedd, aMul: 1.05, sky: 0xffe0c0, gnd: 0x7a6a5a, hMul: 1.10,
            key: 0xfff0d0, kMul: 1.20, fill: 0xbbd0ff, fMul: 1.10, bg: '#1a1410',
            img: 'images/env/courtyard.png', eMul: 0.88, label: '庭院' }
};

function applyEnv() {
  var p = ENV_PRESETS[ENVP] || ENV_PRESETS.none;
  var b = PET_BRIGHTNESS;
  ambientLight.color.setHex(p.amb);  ambientLight.intensity = L.ambient * b * p.aMul;
  hemiLight.color.setHex(p.sky);     hemiLight.groundColor.setHex(p.gnd);
  hemiLight.intensity = L.hemi * b * p.hMul;
  keyLight.color.setHex(p.key);      keyLight.intensity = L.key * b * p.kMul;
  fillLight.color.setHex(p.fill);    fillLight.intensity = L.fill * b * p.fMul;
  /* ★ 三渲二：压环境光、抬主光 —— 否则环境光把色阶冲平，看不到分层 ✅ */
  if (typeof MODE !== 'undefined' && MODE === 'toon') {
    ambientLight.intensity *= 0.5;
    hemiLight.intensity *= 0.55;
    keyLight.intensity *= 1.5;
    fillLight.intensity *= 0.7;
  }
  if (typeof EXPOSURE === 'number') {
    renderer.toneMappingExposure = EXPOSURE * (p.eMul === undefined ? 1 : p.eMul);
  }
  if (stage) {
    /* 世界环境 = 真 HDRI 背景（从 Blender studiolights 转的），透明时用棋盘格 ✅ */
    if (BGTRANS) {
      stage.style.background = 'repeating-conic-gradient(#2a2f38 0% 25%, #1b1f26 0% 50%) 50% / 22px 22px';
    } else if (p.img) {
      stage.style.background = '#0b0e13 url(' + p.img + ') center / cover no-repeat';
    } else {
      stage.style.background = p.bg;
    }
  }
  needsRender = true;
  console.log('[viewer] 渲染设置 → 环境「' + p.label + '」' + (BGTRANS ? ' · 背景透明' : '') + ' ✅');
}

/* ================= 视角（球坐标轨道相机 —— 复刻 Blender 3D 视图）=================
   pivot = 视角中心（旋转中心；滚轮缩放时它会朝"鼠标下那点"移动 ✅）
   az    = 方位角（绕【场景 Y 轴=上】转；0 = 正面，+ = 相机往 +X 侧走）
   el    = 仰角（+ = 相机在上方俯视；限 ±89° 防万向锁）
   dist  = 相机到 pivot 的距离 ✅                                             */
var view = {
  pivot: new THREE.Vector3(0, 10, 0), dist: 60, fitDist: 60,
  az: 0, el: 6 * Math.PI / 180
};
var userMoved = false;                    /* 用户动过视角后，窗口改大小就不再自动重新构图 ✅ */
var needsRender = true;                   /* ★ 静态场景【按需渲染】：不动就不画，省 CPU ✅ */
var allTexReady = false;                  /* 贴图全就绪后才允许停下来（否则会定格成白模）✅ */
var _fc = 0;
var EL_MAX = 89 * Math.PI / 180;
var _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
var _tmp = new THREE.Vector3();

/* 相机方向（pivot → 相机，单位向量） */
function camDir(out) {
  var ce = Math.cos(view.el);
  out.set(Math.sin(view.az) * ce, Math.sin(view.el), Math.cos(view.az) * ce);
  return out;
}
/* 屏幕右 / 屏幕上（世界向量）—— Xl = up × Zl，Yl = Zl × Xl ✅ */
function camBasis() {
  camDir(_dir);
  _right.set(_dir.z, 0, -_dir.x).normalize();
  _up.crossVectors(_dir, _right).normalize();
}
function applyCam() {
  camBasis();
  camera.aspect = W / H;
  camera.position.copy(view.pivot).addScaledVector(_dir, view.dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(view.pivot);
  camera.updateProjectionMatrix();
  needsRender = true;
}
/* ★★ 2026-10-21 相机跟随（v2：绝对对齐，修掉 delta 累加漂移）
   问题演进：
     · v1 用 delta 累加（pivot += 新中心-旧中心）→ 每次切换残留一点误差，会越切越偏 ❌
     · 而且 getWorldPosition 读的是【上一帧】的 matrixWorld（姿势刚更新还没 render）
       → 读到的中心滞后，delta 本身就算错了 ❌
   现在：每次都【绝对】对齐到当前姿势中心（pivot = 中心 + 用户手动平移量），
        没有累加通道，切 100 次也不会漂 ✅
   保留：用户手动平移后的偏移会被记住（相对中心的量），视角 az/el/缩放完全不动 ✅ */
var _poseCenter = null;
var _userShift = null;
function alignPoseCenter() {
  try {
    if (!S.mesh || !S.bones) { return; }
    /* ★ 必须先把姿势写进世界矩阵，否则读到的是上一帧的骨骼位置 */
    S.mesh.updateMatrixWorld(true);
    var box = new THREE.Box3(), v = new THREE.Vector3(), n = 0;
    for (var k in S.bones) {
      var b = S.bones[k];
      if (!b || !b.getWorldPosition) { continue; }
      b.getWorldPosition(v);
      box.expandByPoint(v);
      n++;
    }
    if (!n) { return; }
    var c = box.getCenter(new THREE.Vector3());
    if (!_poseCenter) {
      /* 首次：记录基线 + 用户当前的相对平移 */
      _poseCenter = c.clone();
      _userShift = view.pivot.clone().sub(c);
      return;
    }
    /* 用户这次若手动平移过，以"当前相对中心的位置"为准更新偏移量 */
    var curShift = view.pivot.clone().sub(_poseCenter);
    if (!_userShift || curShift.distanceTo(_userShift) > 0.001) {
      _userShift = curShift;
    }
    var target = c.clone().add(_userShift);
    _poseCenter.copy(c);
    if (target.distanceTo(view.pivot) < 0.005) { return; }   /* 呼吸级抖动不补 */
    var moved = target.distanceTo(view.pivot);
    view.pivot.copy(target);
    applyCam();
    console.log('[viewer] 相机跟随：pivot 校正 ' + moved.toFixed(3));
  } catch (e) {}
}

function clampDist() {
  view.dist = Math.max(view.fitDist * 0.05, Math.min(view.fitDist * 8, view.dist));
}
/* dist 距离处的半高 / 半宽（世界单位） */
function halfExtent(dist) {
  var hh = Math.tan(FOV * Math.PI / 360) * dist;
  return { hh: hh, hw: hh * camera.aspect };
}
/* 光标（视口内像素）在【过 pivot、垂直视线】的平面上对应的世界点 ✅ */
function worldUnderMouse(mx, my) {
  var nx = (mx / W) * 2 - 1, ny = 1 - (my / H) * 2;
  var e = halfExtent(view.dist);
  camBasis();
  return view.pivot.clone()
    .addScaledVector(_right, nx * e.hw)
    .addScaledVector(_up,    ny * e.hh);
}
/* ★ 滚轮缩放（Zoom to Mouse Position）：光标下那点在屏幕上【位置不变】✅
   要保证这点，必须是 pivot' = pivot + (P - pivot)×(1 - factor) 且 dist' = dist×factor */
function zoomAt(mx, my, factor) {
  factor = Math.max(0.05, Math.min(20, factor));
  var p = worldUnderMouse(mx, my), k = 1 - factor;
  view.pivot.addScaledVector(_tmp.copy(p).sub(view.pivot), k);
  view.dist *= factor;
  clampDist();
  applyCam();
  userMoved = true;
}
function resetView() { fitView(); userMoved = false; }
