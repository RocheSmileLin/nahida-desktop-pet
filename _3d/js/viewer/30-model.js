/* ============================================================================
   视口尺寸、模型加载、morph 索引
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ---------------- 视口尺寸 ---------------- */
function onResize() {
  W = window.innerWidth || 400;
  H = window.innerHeight || 600;
  renderer.setSize(W, H, false);
  resizeGradeTarget();                      /* ★ 调色贴图跟着画布尺寸走 ✅ */
  if (!userMoved && S.size) { fitView(); } else { applyCam(); }
}
window.addEventListener('resize', onResize);

/* ---------------- 模型 ---------------- */
var S = { mesh: null, bones: {}, helper: null, size: null, err: null, revealed: false, rest: null };
var PARTS = {};                           /* { 材质名: false } = 隐藏 ✅ */
var MATS = [];                            /* 材质原始外观登记表（渲染 / 白模 切换用）✅ */

/* ★★ 2026-10-21 形态键白名单（与 pet 端同一份 36 个，配合 lib/MMDLoader.js 的跳过逻辑）
   —— viewer 是独立页面，不设就会全量分配 622MB ✅ */
window.MORPH_WHITELIST = ('上左,上右,下左,下右,tg_out,tg_up,tg_dn,tg_wide,星目,ウィンク,ウィンク右,ウィンク２,ウィンク２右,ぺろっ,口横広げ,口横狭め,口角上げ,口角下げ,にやり,にやり２,にやり３,eye_up,eye_up_dn,eye_dn,eye_dn_up,あ,あ２,い,い１,い２,う,え,お,ワ,ん,ω').split(',');

new THREE.MMDLoader().load('model/' + encodeURIComponent('纳西妲.pmx'), function (mesh) {
  /* 材质：MMDToonMaterial 会过曝成白、MeshBasic 又太亮 → 用 Lambert，保留 PMX 材质名（部件开关靠它）✅ */
  mesh.traverse(function (o) {
    if (!o.isMesh) return;
    var arr = Array.isArray(o.material) ? o.material : [o.material];
    var nm = arr.map(function (m) {
      if (!m) return m;
      var mat = new THREE.MeshLambertMaterial({
        name: m.name || '',
        map: m.map || null,
        color: m.map ? 0xe6e6e6 : (m.color ? m.color.getHex() : 0xffffff),
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        alphaTest: 0.02
      });
      /* `髮+` 贴图整层带 alpha（本意是半透明叠加层）→ 不裁会浮出一圈怪东西 ✅ */
      if ((m.name || '') === '髮+') { mat.transparent = true; mat.alphaTest = 0.5; }
      return mat;
    });
    o.material = Array.isArray(o.material) ? nm : nm[0];
    o.frustumCulled = false;
  });
  /* ★ 记下每个材质的原始外观（渲染模式要用）—— 白模模式会临时摘掉 map、颜色刷白 ✅ */
  MATS = [];
  mesh.traverse(function (o) {
    if (!o.isMesh) return;
    var arr = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m) continue;
      MATS.push({ m: m, mesh: o, mi: i, map: m.map || null,
                  color: (m.color ? m.color.getHex() : 0xffffff),
                  transparent: !!m.transparent,
                  opacity: (m.opacity === undefined) ? 1 : m.opacity,
                  alphaTest: m.alphaTest || 0,
                  grad: m.gradientMap || null });
    }
  });
  console.log('[viewer] 材质已登记 ' + MATS.length + ' 个（渲染 / 白模 可切换）✅');
  setMode(MODE);                           /* ★ 按当前 MODE 应用（默认=白模）✅ */
  /* ★★ 2026-10-21 morph 裁剪（与 pet 端同一份 32 个名单）
     viewer 是独立页面，不裁就是又一份全量（实测调整台在 Edge 里开着时 GPU 进程一项 4GB）
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
        console.log('[viewer][morph] 裁剪 ' + _before + ' → ' + _nP.length + ' 个');
      }
    } catch (eMorphCut) { console.log('[viewer][morph] 裁剪失败（保留全部）: ' + eMorphCut); }
  }

  scene.add(mesh);
  /* ★★ 画质：让模型参与投影/受影（EEVEE 的软阴影感）✅ */
  mesh.traverse(function (o) {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  /* 脚下接影平面（只接影、不画自己）*/
  SRECV = new THREE.Mesh(new THREE.PlaneGeometry(8, 8),
                         new THREE.ShadowMaterial({ opacity: 0.32 }));
  SRECV.rotation.x = -Math.PI / 2;
  SRECV.position.y = 0.002;
  SRECV.receiveShadow = true;
  scene.add(SRECV);
  /* ★ 按模型真实尺寸配阴影相机（否则模型在阴影相机外 → 阴影永远不出现）*/
  try {
    var _bb = new THREE.Box3().setFromObject(mesh);
    var _sz = _bb.getSize(new THREE.Vector3());
    SHADOW_R = Math.max(6, _sz.length() * 0.55);
    SRECV.scale.setScalar(SHADOW_R / 4);        /* 8×8 基准 → 覆盖 2×SHADOW_R */
    setKeyDir(MODE === 'toon' ? 0.35 : 0.4, MODE === 'toon' ? 0.60 : 1.0, MODE === 'toon' ? 1.0 : 0.9);
    console.log('[viewer] 阴影相机半径 → ' + SHADOW_R.toFixed(2) + '（模型高 ' + _sz.y.toFixed(2) + '）');
  } catch (e_sd) {}
  applyShadow({});                         /* ★ 应用设置里的阴影参数（浓度/清晰度/开关）✅ */
  mesh.visible = false;                    /* 素材齐了才整体显示 ✅ */
  S.mesh = mesh;
  buildMorphIdx();                         /* ★ 2026-10-17：建 morph 名→索引 表（表情滑杆用）✅ */
  mesh.skeleton.bones.forEach(function (b) { S.bones[b.name] = b; });
  cacheEyeBase();                          /* ★ 视线骨（虹膜挂在 眼.L/眼.R 上）✅ */

  /* 静止姿势快照（复位用） */
  S.rest = {};
  Object.keys(S.bones).forEach(function (n) {
    var b = S.bones[n];
    S.rest[n] = { rx: b.rotation.x, ry: b.rotation.y, rz: b.rotation.z,
                  px: b.position.x, py: b.position.y, pz: b.position.z };
  });

  /* ★★ 2026-10-18 用户要求「中央展示区也像桌面端一样，加载完必要部件就显示」：
     —— 这里【不再】把 37 张贴图一次性同步 initTexture + 离屏预渲染（那是十几秒的首屏卡顿来源），
        改成逐帧按需上传 + 闸门判定（见 assetsCheckViewer / tryReveal）✅ */
  S.loadT0 = Date.now();
  S.revealDeadline = S.loadT0 + 9000;      /* 兜底：9 秒还没齐也显示，避免死锁 */
  console.log('[viewer] PMX 解析完成（贴图改按需上传：上下装 → 主体 → 配件）✅');

  /* 站姿：跟桌宠的「自然站立」同一帧（帧 20，足 IK 关）✅ */
  loadPose(mesh);
}, function () {}, function (e) {
  S.err = String(e);
  console.error('[viewer] 模型加载失败', e);
  document.getElementById('tip').textContent = '模型加载失败：' + e;
});

/* ★★ 2026-10-17 新增：在线表情（调整台左侧「表情」页）—— 与 pet.html 同一套机制
   /petsettings 里的 expr = {morph名: 0~1}；每帧在【动作 / IK / 物理】之后写一遍，
   否则会被 helper.update 或 resetToRest 覆盖 ✅ */
var EXPR = {};                 /* 来自 pet_settings.expr */
var MORPH_IDX = null;          /* morph 名 → 索引 */

function buildMorphIdx() {
  MORPH_IDX = {};
  if (S.mesh && S.mesh.morphTargetDictionary) {
    var d = S.mesh.morphTargetDictionary;
    Object.keys(d).forEach(function (k) { MORPH_IDX[k] = d[k]; });
  }
  console.log('[viewer] morph 数量: '
              + (S.mesh && S.mesh.morphTargetInfluences ? S.mesh.morphTargetInfluences.length : 0)
              + '（表情滑杆可用）');
}
