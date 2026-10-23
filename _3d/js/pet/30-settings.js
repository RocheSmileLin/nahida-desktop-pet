/* ============================================================================
   设置应用：部件可见性、上报、300ms 拉取 /petsettings
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

function applySettings(v) {
  if (!v) { return; }
  for (var k in v) {
    if (v.hasOwnProperty(k) && PET_SETTINGS.hasOwnProperty(k)) { PET_SETTINGS[k] = v[k]; }
  }
  /* ★ 三渲二记忆开关：设置里改了（调整台/服务端）→ 跟随；不写回，避免自激 ✅ */
  if (v.toonOn !== undefined && !!v.toonOn !== TOON_ON && S.mesh) {
    try { setToonOn(!!v.toonOn, true); } catch (e_tn) {}
  }
  /* ① 光感 → 立即生效 ✅ */
  applyLighting();
  /* ①d 阴影（模型自遮挡）→ 立即生效 ✅ */
  try { applyPetShadow(); } catch (e_sh) {}
  /* ①c 照片级调色（对比度 / 高光 / 阴影）→ 立即生效 ✅ */
  applyGrade(PET_SETTINGS);
  /* ①b 三渲二描边宽度变化 → 立即生效 ✅ */
  if (TOON_ON && TOON_HULL_MATS.length) {
    TOON_W = (PET_SETTINGS.outlineWidth === undefined ? 5 : +PET_SETTINGS.outlineWidth) * 0.01;
    for (var _ti = 0; _ti < TOON_HULL_MATS.length; _ti++) {
      var _tm = TOON_HULL_MATS[_ti];
      var _sh = _tm.userData && _tm.userData.shader;
      if (_sh && _sh.uniforms && _sh.uniforms.uOutlineW) {
        _sh.uniforms.uOutlineW.value = TOON_W * (_tm.userData.sign || 1);
      }
    }
  }
  /* ② 模型大小（镜头）→ 相机距离（见 fitCamera 里的 /size ✅）*/
  try { fitCamera(); } catch (e) {}
  /* ②b 模型大小（本体）→ 直接缩放【模型本身】✅（和镜头那档是两个旋钮 ✅）
     ⚠️ 物理刚体是"按骨骼世界坐标"建的 → 缩放后必须让物理重新对齐，
        否则布料/头发会和身体错位 ✅ 用 MMDPhysics.reset() 按当前骨骼重来 ✅ */
  if (S.mesh && S.mesh.scale) {
    var _mk = PET_SETTINGS.meshScale || 1;
    if (Math.abs(S.mesh.scale.x - _mk) > 1e-4) {
      S.mesh.scale.setScalar(_mk);
      if (TOON_HULL) { TOON_HULL.scale.setScalar(_mk); }
      try {
        var _mo = (S.helper && S.helper.objects) ? S.helper.objects.get(S.mesh) : null;
        if (_mo && _mo.physics && _mo.physics.reset) { _mo.physics.reset(); }
      } catch (e) {}
    }
  }
  /* ③ 拖动惯性 → 纯变量，立即生效 ✅ */
  DRAG_INERTIA = PET_SETTINGS.dragInertia;
  DRAG_DECAY   = PET_SETTINGS.dragDecay;
  DRAG_TILT    = PET_SETTINGS.dragTilt;
  /* ④ 视线跟踪范围 */
  TRACK_W = TRACK_H = PET_SETTINGS.trackRange;
  /* ⑤ 物理：开关与重力能立即生效；定步长/步数/预热是【建物理时】读的
        → 存进变量，下次重载姿势（切动作）时生效 ✅ */
  PHYSICS_UNIT_STEP    = PET_SETTINGS.unitStep;
  PHYSICS_MAX_STEP_NUM = PET_SETTINGS.maxStep;
  PHYSICS_WARMUP       = PET_SETTINGS.warmup;
  MAX_FPS              = PET_SETTINGS.maxFps;
  if (PHYSICS_ON !== !!PET_SETTINGS.physics) { setPhysics(!!PET_SETTINGS.physics); }
  try {
    var o = (S.helper && S.helper.objects) ? S.helper.objects.get(S.mesh) : null;
    if (o && o.physics && o.physics.setGravity) {
      o.physics.setGravity(new THREE.Vector3(0, PET_SETTINGS.gravity, 0));
    }
  } catch (e) {}
  console.log('[pet] 调整台：设置已应用 ✅ 亮度' + PET_SETTINGS.brightness
              + ' 大小' + PET_SETTINGS.size + ' 物理' + (PHYSICS_ON ? '开' : '关'));
}

/* ★★ 部件可见性（用户要求 ③）——
   模型的 23 个材质 = 23 个部件（顔 / 体 / 髪 / 裙 / 饰物 …）
   做法：把材质名列表上报给 Python（调整台用它建勾选框 ✅），
        再按 PET_SETTINGS.parts 逐个设 material.visible ✅
   ⚠️ 只影响【显示】—— 骨骼/物理照旧（隐藏的部件不参与渲染，但物理仍在算 ✅）*/
function meshMaterials() {
  if (!S.mesh) { return null; }
  var m = S.mesh.material;
  if (!m) { return null; }
  return (m.length !== undefined) ? m : [m];
}

/* ★★ 部件可见性（用户要求 ③）
   ⚠️「补全 / 换肤 / 补洞算法」已按用户要求【全部删除】✅
   现在只有两种状态：
     · 不在 parts 里 → 正常显示 ✅
     · false（或旧的 'hide' 字符串）→ 隐藏：几何体不画（可能留洞 ✅）
   ⚠️ 兼容 'hide' 字符串：早期设置页的 bug 会存字符串进来，这里一并当"隐藏"✅ */
function applyPartVisibility() {
  var mats = meshMaterials();
  if (!mats) { return; }
  var parts = PET_SETTINGS.parts || {};
  for (var i = 0; i < mats.length; i++) {
    var m = mats[i];
    var nm = m.name || ('部件' + i);
    var st = parts[nm];
    var wanted = !(st === false || st === 'hide');   /* ★ 用户是否【想要】显示它 */
    var show = wanted;
    /* ★ 用户要求「衣服优先渲染」：
       · 整体还没显示前 → 所有材质都不显示
       · 已显示后 → 贴图没就绪的材质先藏起来（避免出现"没贴图的白模"），
         等它自己的贴图到位后自动出现 ✅（衣服是最先就绪的一批 ✅）*/
    if (show) { show = (S.revealed === true) && texReady(m); }
    m.visible = show;
    /* ★ 没就绪的材质要【主动催一次上传】—— 否则它被藏着→不被绘制→永不上传→永远不显示（死锁）✅
       贴图一旦上传成功，下一帧就是 true，它自己就出来了 ✅
       ★ 2026-10-21（内存优化）：只催「用户想显示、但暂时还没就绪」的；
         用户【主动隐藏】的部件完全不催 ⇒ 贴图不进显存（实测省 ~200MB）✅ */
    if (wanted && !show && m.map && renderer.initTexture) {
      try { renderer.initTexture(m.map); } catch (e7) {}
    }
  }
  /* 三渲二描边壳跟着部件显隐走（未开启时它是 hidden，几乎零开销）✅ */
  if (TOON_ON) { try { applyToonHullState(); } catch (e8) {} }
}

function pushPartNames() {
  if (window._partsPushed) { return; }
  var mats = meshMaterials();
  if (!mats) { return; }
  window._partsPushed = 1;
  var names = [];
  for (var i = 0; i < mats.length; i++) { names.push(mats[i].name || ('部件' + i)); }
  try {
    fetch('/petparts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(names)
    }).catch(function () {});
    console.log('[pet] 部件清单已上报 ' + names.length + ' 个 ✅');
  } catch (e) {}
}

window.petApplySettings = applySettings;   /* Python 侧注入用 ✅ */

/* ★ 启动时 + 每 1000ms 拉一次设置（同源本地服务器 ✅）
   —— "调整台滑一下 → 桌宠立刻变"完全不依赖 Python 的推送时序 ✅
   ⚠️ 只在内容真的变了才应用（比对 JSON 文本 ✅）→ 空转开销极小 ✅
   ⚠️ 拉取时模型可能还没载入 → fitCamera() 会提前 return，但 size 已存进 PET_SETTINGS，
      等模型载入后自动调用的 fitCamera() 会带上它 ✅ 所以"大小"照样生效 ✅
   ★★ 2026-10-21 从 300ms 放宽到 1000ms：
      原来桌宠 + 调整台的两个页面各自每 300ms 拉一次 ⇒ 每秒 6~7 个 HTTP 请求，
      而 http.server 是 HTTP/1.0（每次新连接）⇒ netstat 里堆了 480+ 个 TIME_WAIT。
      1 秒延迟在"拖滑块看到人物变化"这个场景上完全无感，但连接数降 3 倍多 ✅ */
(function () {
  var last = '';
  function pull() {
    try {
      fetch('/petsettings').then(function (r) { return r.text(); })
        .then(function (t) {
          if (t && t !== last) {
            last = t;
            try { applySettings(JSON.parse(t)); } catch (e) {}
          }
        })
        .catch(function () {});
    } catch (e) {}
  }
  pull();
  setInterval(pull, 1000);
})();
scene.add(fillLight);
