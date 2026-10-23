/* ============================================================================
   模型加载：PMX、贴图预热、物理就绪、包围盒与相机
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ★★ 2026-10-21 形态键白名单（配合 lib/MMDLoader.js 里新增的跳过逻辑）
   桌面宠只用下面这 36 个（眉毛/舌头/星星眼/眼眶/单眼闭合/嘴型/口型）。
   其余 285 个在 PMX 里【照旧存在】（Blender 导出不受影响），
   但加载时不再为它们分配 169466×3 浮点数组、不再逐个拷贝 ✅
   ⚠️ 必须写在 new MMDLoader().load() 之前 */
window.MORPH_WHITELIST = ('上左,上右,下左,下右,tg_out,tg_up,tg_dn,tg_wide,星目,ウィンク,ウィンク右,ウィンク２,ウィンク２右,ぺろっ,口横広げ,口横狭め,口角上げ,口角下げ,にやり,にやり２,にやり３,eye_up,eye_up_dn,eye_dn,eye_dn_up,あ,あ２,い,い１,い２,う,え,お,ワ,ん,ω').split(',');

/* ============ 加载模型 ============ */
new THREE.MMDLoader().load('model/' + encodeURIComponent('纳西妲.pmx'), function (mesh) {
  /* 材质：MeshBasicMaterial 无光照=全图最亮（用户反馈"太亮"）
     MMDToonMaterial 在 three.js 里过曝成白（实测）
     → 折中用 MeshLambertMaterial：保留贴图，吃环境光+方向光产生明暗 */
  mesh.traverse(function (o) {
    if (!o.isMesh) return;
    /* ★ 2026-10-17 阴影：模型自遮挡（刘海→脸 / 披风→身 / 裙→腿）✅ */
    o.castShadow = true;
    o.receiveShadow = true;
    var arr = Array.isArray(o.material) ? o.material : [o.material];
    var nm = arr.map(function (m) {
      if (!m) return m;
      var mat = new THREE.MeshLambertMaterial({
        name: m.name || '',          // 保留 PMX 材质名便于排查（实测有用）
        map: m.map || null,
        color: m.map ? 0xe6e6e6 : (m.color ? m.color.getHex() : 0xffffff),
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        alphaTest: 0.02
      });
      /* ⚠️ 实测：`髮+` 的贴图整层带 alpha（100% 半透明），本意是半透明叠加层。
             按不透明渲染 → alpha 被忽略、RGB 全显示 → 头顶浮出一圈"骨节状/虚线球"
             （用户反馈"头上有一圈类似骨骼的东西"）
             → 用 alphaTest 裁掉半透明部分（其余材质贴图无 alpha，改不改都无影响） */
      if ((m.name || '') === '髮+') { mat.transparent = true; mat.alphaTest = 0.5; }
      return mat;
    });
    o.material = Array.isArray(o.material) ? nm : nm[0];
    o.frustumCulled = false;
  });
  scene.add(mesh);
  S.mesh = mesh;
  /* ★ 阴影相机按模型真实尺寸配（否则模型在阴影相机外 → 一点阴影都没有）*/
  try {
    var _pb = new THREE.Box3().setFromObject(mesh);
    var _ps = _pb.getSize(new THREE.Vector3());
    PET_SHADOW_R = Math.max(6, _ps.length() * 0.55);
    setPetKeyDir(TOON_ON ? 0.35 : 0.4, TOON_ON ? 0.60 : 1.0, TOON_ON ? 1.0 : 0.9);
    applyPetShadow();
    console.log('[pet] 阴影相机半径 → ' + PET_SHADOW_R.toFixed(2) + '（模型高 ' + _ps.y.toFixed(2) + '）| 自阴影 ' + (PET_SETTINGS.shadowOn !== false ? '开' : '关'));
  } catch (e_sh2) {}
  /* ★★ 启动时【先不显示】，等「站姿动作定格 + 物理预热」都就绪后整体出现 ✅
     ⚠️ 之前的现象（用户实测）：一载入就 scene.add → 看到
        「先一个僵硬躯干 → 躯干变姿势 → 头 → 装饰 → 最后衣服」一截截冒出来
        原因：① 载入瞬间是静止(A)姿势，站姿 VMD 还在异步加载；
              ② 站姿 VMD 有 24MB / 22 万帧，主线程解析期间合成器会把半成品一帧帧抖出来
     → 现在整个过程在"隐藏"状态下完成，好了才整体显示 ✅ */
  mesh.visible = false;
  S.revealed = false;
  S.loadT0 = Date.now();                   /* 启动计时（日志里能看到"启动到显示"花了多久）*/
  /* ★★ 2026-10-17：初始兜底放宽到 25s（只是"绝不永久空着"的保险），
     真正的兜底在【姿势就绪 + 9s】（见 captureBasePose 末尾）——
     原来 onLoad+12s 比姿势就绪还早，会强制提前显示 ⇒ 衣服没就绪就露主体 ❌ */
  S.revealDeadline = Date.now() + 25000;
  T('① PMX+贴图 载入完成（模型 onLoad）');

  /* ★★ 2026-10-21 morph 裁剪（用户指定的 32 个：眉毛/舌头/星星眼/单眼闭合/嘴型/口型）
     根因：three.js 把 PMX 稀疏 morph 全展开成「全顶点数组」= 321 × 169466 × 12B = 622MB，
          GPU 侧还有更大的浮动纹理。用户只要这 32 个（视线改由底部骨骼控件负责）。
     ⚠️ 全部按【名字】访问（S.morphIdx / morphTargetDictionary），无硬编码下标
     回退：MORPH_FACE_ONLY = false */
  var MORPH_FACE_ONLY = true;
  if (MORPH_FACE_ONLY) {
    try {
      var FACE_MORPH = {};
      ('上左,上右,下左,下右,tg_out,tg_up,tg_dn,tg_wide,星目,ウィンク,ウィンク右,ウィンク２,ウィンク２右,ぺろっ,口横広げ,口横狭め,口角上げ,口角下げ,にやり,にやり２,にやり３,eye_up,eye_up_dn,eye_dn,eye_dn_up,あ,あ２,い,い１,い２,う,え,お,ワ,ん,ω'
      ).split(',').forEach(function (k) { FACE_MORPH[k] = 1; });
      var _oDict = mesh.morphTargetDictionary;
      var _oInfl = mesh.morphTargetInfluences;
      var _oP = mesh.geometry.morphAttributes && mesh.geometry.morphAttributes.position;
      if (_oDict && _oInfl && _oP && _oP.length) {
        var _nDict = {}, _nInfl = [], _nP = [];
        Object.keys(_oDict).forEach(function (k) {
          if (!FACE_MORPH[k]) { return; }
          var oi = _oDict[k];
          if (oi < 0 || oi >= _oP.length) { return; }
          _nDict[k] = _nP.length;
          _nP.push(_oP[oi]);
          _nInfl.push(_oInfl[oi]);
        });
        var _before = _oP.length;
        mesh.geometry.morphAttributes.position = _nP;
        if (mesh.geometry.morphAttributes.normal) { mesh.geometry.morphAttributes.normal = []; }
        mesh.morphTargetDictionary = _nDict;
        mesh.morphTargetInfluences = _nInfl;
        var _mats0 = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (var _mi0 = 0; _mi0 < _mats0.length; _mi0++) {
          if (_mats0[_mi0]) { _mats0[_mi0].needsUpdate = true; }
        }
        console.log('[pet][morph] 裁剪 ' + _before + ' → ' + _nP.length + ' 个');
      }
    } catch (eMorphCut) { console.log('[pet][morph] 裁剪失败（保留全部）: ' + eMorphCut); }
  }

  /* ★ 诊断：WebGL 用的是【核显】还是【软件渲染】（软件渲染会慢一个数量级）*/
  try {
    var _gl0 = renderer.getContext();
    var _dbgExt = _gl0.getExtension('WEBGL_debug_renderer_info');
    console.log('[pet] WebGL: ' + _gl0.getParameter(_gl0.VERSION)
                + ' | vendor=' + (_dbgExt ? _gl0.getParameter(_dbgExt.UNMASKED_VENDOR_WEBGL) : _gl0.getParameter(_gl0.VENDOR))
                + ' | renderer=' + (_dbgExt ? _gl0.getParameter(_dbgExt.UNMASKED_RENDERER_WEBGL) : _gl0.getParameter(_gl0.RENDERER)));
  } catch (e0) {}

  /* ★★ 预热 GPU（用户要求：所有素材都加载完毕后再显现）
     · 34 个材质的贴图先【上传到显存】；所有着色器先【编译】好
     · 不预热的话，显示之后的前几帧才开始上传/编译 → 会看到"贴图一点点刷出来"+卡顿 ❌
     ⚠️ renderer.compile() 只编译不渲染（不会画出画面）→ 临时设可见也不会闪 ✅ */
  try {
    mesh.visible = true;
    var _texDone = {};
    mesh.traverse(function (o) {
      if (!o.isMesh) return;
      var arr = Array.isArray(o.material) ? o.material : [o.material];
      for (var _i = 0; _i < arr.length; _i++) {
        var _m = arr[_i];
        if (!_m || !_m.map) { continue; }
        /* ★★ 2026-10-21（内存优化）：隐藏的部件【不预热上传】。
           原来这里对 mesh.traverse 到的【全部材质】调 initTexture
           ⇒ 82 个默认隐藏的部件贴图也全进显存（实测白占 ~200MB）。
           隐藏件等它被真正显示时再由 three.js 自动上传 ✅ */
        var _pstW = (PET_SETTINGS.parts || {})[_m.name];
        if (_pstW === false || _pstW === 'hide') { continue; }
        if (!_texDone[_m.map.uuid]) {
          _texDone[_m.map.uuid] = 1;
          if (renderer.initTexture) { try { renderer.initTexture(_m.map); } catch (e2) {} }
        }
      }
    });
    renderer.compile(scene, camera);
    console.log('[pet] GPU 预热完成：贴图 ' + Object.keys(_texDone).length + ' 张已上传 + 着色器已编译 ✅');

    /* ★★ 关键：compile() 只是"排队"编译，Chrome 的着色器链接是【异步】的 ——
       还没链接完的材质画出来是空白的，链接好一个就"冒出来"一个
       → 所以要把模型【真的画一次】（画到 64×64 离屏图上，屏幕上看不见），
         再 gl.finish() 等 GPU 做完，这样正式显示时不会一件件冒出来 ✅ */
    var _rt = new THREE.WebGLRenderTarget(64, 64);
    var _oldTarget = renderer.getRenderTarget();
    mesh.visible = true;
    for (var _k = 0; _k < 2; _k++) {
      renderer.setRenderTarget(_rt);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(_oldTarget);
    var _gl = renderer.getContext();
    if (_gl && _gl.finish) { _gl.finish(); }        /* 等 GPU 队列真正做完 ✅ */
    mesh.visible = false;
    _rt.dispose();
    console.log('[pet] 离屏预热完成（着色器已真正链接/使用过）✅ 程序数 ' +
                (renderer.info && renderer.info.programs ? renderer.info.programs.length : '?') +
                '，贴图数 ' + (renderer.info && renderer.info.memory ? renderer.info.memory.textures : '?'));
  } catch (e) {
    console.log('[pet] GPU 预热失败（不影响显示）: ' + e);
    mesh.visible = false;
  }
  mesh.visible = false;                     /* 预热完继续藏着，等全部就绪才整体显示 ✅ */
  S.warmReady = true;

  mesh.skeleton.bones.forEach(function (b) { S.bones[b.name] = b; });
  /* ★★ 2026-10-17 视线骨名：⚠️ .blend 里已中文化成 眼.L/眼.R/双眼，
     但导出的 PMX 里还是 MMD 原名的 左目/右目/両目 —— 两套都要认，否则眼球永远不动 */
  S.eyeNames = (S.bones['眼.L'] && S.bones['眼.R']) ? ['眼.L', '眼.R']
             : (S.bones['左目'] && S.bones['右目']) ? ['左目', '右目'] : [];
  S.lookHeadNames = ['頭', '首'].concat(S.eyeNames);
  if (S.bones['双眼']) { S.lookHeadNames.push('双眼'); }
  else if (S.bones['両目']) { S.lookHeadNames.push('両目'); }
  console.log('[pet] 视线骨: ' + (S.eyeNames.length ? S.eyeNames.join(',') + ' ✅' : '没找到 ⚠️')
              + '（PMX 原名为 左目/右目）| 头部组: ' + S.lookHeadNames.join(','));

  /* ★ morph 名字 → 索引 查表（这个模型有 65 个表情 morph，之前误记为 0） */
  S.morphIdx = {};
  if (mesh.morphTargetDictionary) {
    Object.keys(mesh.morphTargetDictionary).forEach(function (k) {
      S.morphIdx[k] = mesh.morphTargetDictionary[k];
    });
  }
  console.log('[pet] morph 数量: ' + (mesh.morphTargetInfluences ? mesh.morphTargetInfluences.length : 0)
              + '  「まばたき」索引: ' + (S.morphIdx['まばたき'] === undefined ? '无' : S.morphIdx['まばたき']));
  /* ★ 2026-10-21 内存诊断（只读，不改行为）*/
  try {
    var _geo = mesh.geometry, _pos = _geo.attributes.position;
    var _ma = _geo.morphAttributes && _geo.morphAttributes.position;
    var _mb = 0;
    if (_ma) { for (var _mi = 0; _mi < _ma.length; _mi++) { _mb += (_ma[_mi].array ? _ma[_mi].array.byteLength : 0); } }
    console.log('[pet][mem] 顶点 ' + (_pos ? _pos.count : 0)
      + ' | position ' + ((_pos ? _pos.array.byteLength : 0) / 1048576).toFixed(1) + 'MB'
      + ' | index ' + ((_geo.index ? _geo.index.array.byteLength : 0) / 1048576).toFixed(1) + 'MB'
      + ' | morph ' + (_ma ? _ma.length : 0) + ' 个 = ' + (_mb / 1048576).toFixed(1) + 'MB');
    if (window.performance && performance.memory) {
      console.log('[pet][mem] JS 堆 used=' + (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB');
    }
  } catch (eMem) {}

  /* ★ 2026-10-17：把表情名单上报给调整台（左侧「表情」页按这个名字建滑杆）✅ */
  try {
    fetch('/petmorphs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.keys(S.morphIdx))
    }).then(function (r) { return r.json(); }).catch(function () {});
  } catch (e) {}

  /* 记住【静止姿势】（模型刚载入的 A-pose）—— 换姿势前先复位，避免残留上一套动作 */
  S.rest = {};
  Object.keys(S.bones).forEach(function (n) {
    var b = S.bones[n];
    S.rest[n] = { rx: b.rotation.x, ry: b.rotation.y, rz: b.rotation.z,
                  px: b.position.x, py: b.position.y, pz: b.position.z, sy: b.scale.y };
  });

  /* 初始姿势：优先用 MMD 动作包里的站姿（人工调过，手会自然露出来）
     动作作者 オトカム(Otokam_0510) —— 个人自用免费 / 禁单独售卖 / 再分发需署名
     加载失败则退回手调姿势（实测规律：x=张开轴、z=下压轴；下压过头手会被裙子挡住） */
  function fallbackPose() {
    function pose(n, rx, ry, rz) {
      var b = S.bones[n];
      if (b) { b.rotation.set(rx, ry, rz); b.updateMatrixWorld(true); }
    }
    pose('左肩', 0, 0, -0.03);  pose('右肩', 0, 0,  0.03);
    pose('左腕', -0.50, 0, -0.28);  pose('右腕', -0.50, 0,  0.28);
    pose('左ひじ', -0.15, 0, -0.02); pose('右ひじ', -0.15, 0, 0.02);
    console.warn('[pet] 用退回的手调姿势');
    captureBase();          // 没有动作也要定格基础姿势，否则程序化层不启动
  }
  /* ★ 物理必须在【姿势装载之前】就绪：
     物理是在 helper.add() 里创建的，Ammo 还没解析完的话这次装载会【静默变成无物理】
     （不报错、看不出来）→ 之后布料/头发就永远不动 ❌
     → 这里先等 Ammo 就绪再装姿势（实测 Ammo 通常 1 秒内好；最多等 8 秒，等不到就照常装）*/
  function waitAmmoThenPose(tries) {
    tries = tries || 0;
    if (!PHYSICS_ON || physicsUsable() || tries > 80) {
      if (PHYSICS_ON && !physicsUsable()) {
        console.warn('[pet] Ammo 等不到，本次按【无物理】装载');
      } else if (PHYSICS_ON) {
        T('② Ammo 就绪（物理可创建）');
      }
      loadPoseVMD(POSES[0][1], fallbackPose, POSES[0][2],
                  POSES[0][3] !== undefined ? [POSES[0][3], POSES[0][4]] : null);   // 默认：自然站立（POSES[0]）
      return;
    }
    setTimeout(function () { waitAmmoThenPose(tries + 1); }, 100);
  }
  /* ★★ 顺序很关键：先等【衣服贴图】下完，再去装站姿/物理 ✅
     —— 两者同时做会抢 CPU（这颗 i5），贴图会被拖到 10 秒以上 ❌
     最多等 20 秒（等不到也照常继续）*/
  var _clothTries = 0;
  (function waitClothThenPose() {
    _clothTries++;
    if (_clothTries < 200 && !assetsCheck(gateMats())) {
      setTimeout(waitClothThenPose, 100);
      return;
    }
    T('② 上装/下装贴图就绪（第 ' + _clothTries + ' 次检查）');
    waitAmmoThenPose();
  })();

  /* 构图：抽成函数，窗口尺寸变化时重算（Qt 窗口初次尺寸和页面不一致会导致切脚）
     ⚠️ Box3.setFromObject 对蒙皮网格量的是【静止姿势】包围盒，不准（会切脚）
        改用【骨骼世界坐标】包围盒，反映真实姿势 */
  S.size = measureByBones(mesh);
  S.center = S.size.center.clone ? S.size.center.clone() : S.size.center;
  fitCamera();

  S.ready = true;
  window.__PET_READY__ = true;
}, function (xhr) {
  /* 进度 */
}, function (e) {
  S.err = String(e);
  window.__PET_ERR__ = String(e);
  console.error('模型加载失败', e);
});

/* 用骨骼世界坐标算包围盒（比 setFromObject 准） */
function measureByBones(mesh) {
  var box = new THREE.Box3();
  var v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  mesh.skeleton.bones.forEach(function (b) {
    b.getWorldPosition(v);
    box.expandByPoint(v);
  });
  return { min: box.min, max: box.max, center: box.getCenter(new THREE.Vector3()),
           size: box.getSize(new THREE.Vector3()) };
}

function fitCamera() {
  if (!S.size) return;
  var w = window.innerWidth || 1000, h = window.innerHeight || 1000;
  /* ★ 相机 / 取景（2026-10-12 用户要求：调整台可调 ✅）
     camFov   视场角（越小越"平"，越大透视越强）
     camPitch 俯仰（正 = 相机抬高 → 俯瞰）｜ camYaw 左右（正 = 相机右移 → 3/4 侧）
     camY     取景中心上下（默认 -0.08 = 原来写死的值：人物略偏上、露脚 ✅）
     size     「模型大小(镜头)」= 远近（越大越近）✅
     ⚠️ 四项默认值 = 原写死值 → 加完不拖，画面与以前完全一致 ✅ */
  camera.fov = parseFloat(PET_SETTINGS.camFov) || 30;
  camera.aspect = w / h;
  var fovRad = camera.fov * Math.PI / 180;
  /* ★ 窗口已扩大到 1000×1000 的"大容器"，但人物在屏幕上的大小要保持原样：
     相机距离 = 按原 380×620 基准算出的距离 × 固定系数(1000/620)
     → 人物像素大小与以前完全一致，窗口变大只是给 1000×1000 的视线范围留余量
     → 菜单 scale+/- 改变窗口大小时，人物仍会跟着等比放大/缩小 ✅ */
  var BASE_W = 380, BASE_H = 620, VIEW_H = 1000;
  var needBase = Math.max(
    (S.size.size.y * 0.95) / Math.tan(fovRad / 2),
    (S.size.size.x * 0.95) / (Math.tan(fovRad / 2) * (BASE_W / BASE_H))
  );
  /* ★ 「模型大小」旋钮 = 相机距离的倒数：size 越大 → 距离越近 → 人物越大 ✅ */
  var need = needBase * (VIEW_H / BASE_H) / (PET_SETTINGS.size || 1);
  /* ★ 逐动作相机补偿（motions.js 的 cam 字段；只有「摇腿」这类例外才写）
     —— 叠加在调整台的全局相机旋钮【之上】，所以全局旋钮依然有效 ✅ */
  var _mc = null;
  try {
    if (typeof MOTION_DEFS !== 'undefined' && MOTION_DEFS[S.poseIndex]) {
      _mc = MOTION_DEFS[S.poseIndex].cam || null;
    }
  } catch (e) {}
  var _aimX = (_mc && _mc.aim) ? _mc.aim[0] : 0;
  var _aimY = (_mc && _mc.aim) ? _mc.aim[1] : 0;
  var _aimZ = (_mc && _mc.aim) ? _mc.aim[2] : 0;
  var _exYaw = (_mc && _mc.yaw) ? _mc.yaw : 0;
  var _zoomM = (_mc && _mc.zoom) ? _mc.zoom : 1;
  if (_zoomM > 0) { need = need / _zoomM; }
  /* 视线中心：默认下移 8%（人物在画面里往上走、露出脚部）+ 调整台「取景上下」+ 逐动作补偿 ✅ */
  var cy = S.size.center.y + S.size.size.y * (parseFloat(PET_SETTINGS.camY) || 0) + _aimY;
  /* 俯仰 / 左右：以视线中心为圆心，用球坐标把相机摆到对应方位（默认 0/0 = 正前方，同原来）✅ */
  var pitch = (parseFloat(PET_SETTINGS.camPitch) || 0) * Math.PI / 180;
  var yaw   = ((parseFloat(PET_SETTINGS.camYaw) || 0) + _exYaw) * Math.PI / 180;
  var cx = S.size.center.x + _aimX, cz = S.size.center.z + _aimZ;
  var horiz = Math.cos(pitch) * need;
  camera.position.set(cx + Math.sin(yaw) * horiz, cy + Math.sin(pitch) * need,
                      cz + Math.cos(yaw) * horiz);
  camera.lookAt(cx, cy, cz);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  resizeGradeTarget();                      /* ★ 调色贴图跟着窗口尺寸 ✅ */
  if (window.__PET_DEBUG__) {
    console.log('[fit] win=' + w + 'x' + h + ' size=' +
      S.size.size.x.toFixed(2) + 'x' + S.size.size.y.toFixed(2) +
      'x' + S.size.size.z.toFixed(2) + ' need=' + need.toFixed(2));
  }
}
