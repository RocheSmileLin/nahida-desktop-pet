/* ============================================================================
   三渲二（原神风）：色阶 ramp、描边壳、开关
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══════════ ★★ 2026-10-17 三渲二（原神风）—— 桌宠侧 ══════════
   右键菜单「三渲二」开关，和「物理效果」同一个菜单。
   做法与 viewer.html 完全一致：换 MeshToonMaterial + 彩色分段 ramp + 脸专属软 ramp + 反向外扩壳描边。
   ⚠️ MMDToonMaterial 其实是 Phong+matcap（没有色阶）→ 必须整块换材质，改 gradientMap 无效 ✅ */
var TOON_ON = false;
var TOON_MATS = [];        /* [{ m: 原材质, tm: toon材质, i: 槽位下标 }] */
var TOON_HULL = null;      /* 描边壳（SkinnedMesh，共享 skeleton + 几何）*/
var TOON_HULL_MATS = [];
var TOON_W = 0.05, TOON_COLOR = 0x2a2233;
var _tRamp = null, _tFace = null;
var FACE_RE = /颜|颜2|肌|颈|neck|skin|口舌|齿|耳|body/i;
var CLOTH_RE = /裙|SKIRT|披|飘带|围裙|泳|内裤|百褶|带子|蝴蝶结/i;

function _mkRamp(stops) {
  var W = 128, cv = document.createElement('canvas');
  cv.width = W; cv.height = 1;
  var ctx = cv.getContext('2d');
  var g = ctx.createLinearGradient(0, 0, W, 0);
  for (var i = 0; i < stops.length; i++) { g.addColorStop(stops[i][0], stops[i][1]); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 1);
  var t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
function toonRamp() {
  if (!_tRamp) {
    _tRamp = _mkRamp([[0.00, '#4d527a'], [0.58, '#4d527a'],
                      [0.62, '#c6cbd8'], [0.90, '#c6cbd8'],
                      [0.94, '#ffffff'], [1.00, '#ffffff']]);
  }
  return _tRamp;
}
function faceRamp() {
  if (!_tFace) {
    _tFace = _mkRamp([[0.00, '#a39499'], [0.28, '#a39499'],
                      [0.62, '#ded8d8'], [0.92, '#ffffff'], [1.00, '#ffffff']]);
  }
  return _tFace;
}

/* 逐组判断法线朝外/朝内（MMD 裙子常朝内；朝内的组壳要翻 side，否则整块盖住模型）*/
function toonGroupSigns(geo) {
  var signs = [];
  try {
    if (!geo.boundingSphere) { geo.computeBoundingSphere(); }
    var c = geo.boundingSphere.center;
    var pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    var gs = geo.groups && geo.groups.length ? geo.groups
             : [{ start: 0, count: (idx ? idx.count : pos.count), materialIndex: 0 }];
    var maxMat = 0;
    gs.forEach(function (g) { maxMat = Math.max(maxMat, g.materialIndex || 0); });
    var acc = [];
    for (var k = 0; k <= maxMat; k++) { acc.push([0, 0]); }
    gs.forEach(function (g) {
      var a = acc[g.materialIndex || 0], cnt = g.count || 0, st = g.start || 0;
      var step = Math.max(1, Math.floor(cnt / 600)) * 3;
      for (var i = st; i + 2 < st + cnt; i += step) {
        var vi = idx ? idx.getX(i) : i;
        a[0] += nor.getX(vi) * (pos.getX(vi) - c.x)
              + nor.getY(vi) * (pos.getY(vi) - c.y)
              + nor.getZ(vi) * (pos.getZ(vi) - c.z);
        a[1] += 1;
      }
    });
    for (var j = 0; j < acc.length; j++) {
      signs.push(acc[j][1] ? (acc[j][0] / acc[j][1] < 0 ? -1 : 1) : 1);
    }
  } catch (e) { signs = []; }
  return signs;
}

function toonOutlineMat(name, srcMat, sign) {
  var inward = (sign !== undefined && sign < 0);
  var m = new THREE.MeshBasicMaterial({
    color: TOON_COLOR,
    side: inward ? THREE.FrontSide : THREE.BackSide
  });
  m.name = name || '';
  m.userData.sign = (sign === undefined ? 1 : sign);
  /* 薄片布料（裙/披/飘带）：反向外扩壳必然盖穿 → 跳过描边 */
  if (srcMat && (CLOTH_RE.test(name || '') || srcMat.transparent || srcMat.alphaMap
                 || srcMat.side === THREE.DoubleSide)) {
    m.userData.skipOutline = true;
  }
  var w0 = TOON_W * m.userData.sign;
  m.onBeforeCompile = function (shader) {
    shader.uniforms.uOutlineW = { value: w0 };
    shader.vertexShader = 'uniform float uOutlineW;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += normalize( normal ) * uOutlineW;'
    );
    m.userData.shader = shader;
  };
  return m;
}

function buildToonHull() {
  if (TOON_HULL || !S.mesh || !S.mesh.isSkinnedMesh) { return; }
  var mats = meshMaterials() || [];
  var signs = toonGroupSigns(S.mesh.geometry);
  TOON_HULL_MATS = mats.map(function (mm, mi) {
    var sg = signs[mi] === undefined ? 1 : signs[mi];
    return toonOutlineMat(mm && mm.name, mm, sg);
  });
  var hull = new THREE.SkinnedMesh(S.mesh.geometry,
                                   TOON_HULL_MATS.length === 1 ? TOON_HULL_MATS[0] : TOON_HULL_MATS);
  hull.bind(S.mesh.skeleton, S.mesh.bindMatrix);
  hull.bindMode = S.mesh.bindMode;
  hull.frustumCulled = false;
  hull.castShadow = false; hull.receiveShadow = false;
  hull.position.copy(S.mesh.position);
  hull.quaternion.copy(S.mesh.quaternion);
  hull.scale.copy(S.mesh.scale);
  S.mesh.parent.add(hull);
  TOON_HULL = hull;
  console.log('[pet] 三渲二描边壳已建 ✅');
}

function applyToonHullState() {
  if (!TOON_HULL) { return; }
  /* 入场时 S.mesh 还是 visible=false（素材没齐）→ 壳也必须藏，否则先冒出一圈黑边 ✅ */
  TOON_HULL.visible = TOON_ON && (S.revealed !== false);
  if (!TOON_ON) { return; }
  var parts = PET_SETTINGS.parts || {};
  for (var j = 0; j < TOON_HULL_MATS.length; j++) {
    var tm = TOON_HULL_MATS[j];
    if (tm.userData && tm.userData.skipOutline) { tm.visible = false; continue; }
    var nm = tm.name || ('部件' + j);
    var st = parts[nm];
    tm.visible = !(st === false || st === 'hide');
  }
}

/* ★ 总开关：右键菜单「三渲二」
   skipSave=true 时只应用不写回（用于「设置推过来」的场景，避免自激循环）✅ */
function setToonOn(on, skipSave) {
  on = !!on;
  var mats = meshMaterials();
  if (!mats) { console.log('[pet] 三渲二：模型还没就绪'); return; }
  TOON_W = (PET_SETTINGS.outlineWidth === undefined ? 5 : +PET_SETTINGS.outlineWidth) * 0.01;
  if (on) {
    if (!TOON_MATS.length) {
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) { continue; }
        /* 原材质本来就全透明（踝饰-足.L/.R 实测 opacity=0）→ 不能参与换材质，
           否则强制 opacity=1 会把「本该隐形」的部件显示出来 ✅ */
        if ((m.opacity === undefined ? 1 : m.opacity) < 0.02) { continue; }
        var tm = new THREE.MeshToonMaterial({
          color: (m.color ? m.color.getHex() : 0xffffff),
          map: m.map || null,
          transparent: false, opacity: 1,
          alphaTest: (m.alphaTest || 0),
          /* ★ 继承原材质面剔除（披风是 DoubleSide，设单面会「正面看不见」）✅ */
          side: m.side,
          gradientMap: FACE_RE.test(m.name || '') ? faceRamp() : toonRamp()
        });
        tm.name = m.name || '';           /* 部件显隐靠材质名 ✅ */
        if (m.emissive) { tm.emissive = m.emissive.clone(); }
        TOON_MATS.push({ m: m, tm: tm, i: i });
      }
    }
    for (var k = 0; k < TOON_MATS.length; k++) { mats[TOON_MATS[k].i] = TOON_MATS[k].tm; }
    buildToonHull();
  } else {
    for (var k2 = 0; k2 < TOON_MATS.length; k2++) { mats[TOON_MATS[k2].i] = TOON_MATS[k2].m; }
  }
  TOON_ON = on;
  PET_SETTINGS.toonOn = on;     /* ★ 记忆：写进设置对象 ✅ */
  applyToonHullState();
  applyPartVisibility();     /* 换材质后重刷显隐（贴图就绪判断也要重跑）✅ */
  applyLighting();           /* 三渲二要重算灯光配比 ✅ */
  /* ★ 记忆开关：写回 pet_settings.json（重启桌宠后自动恢复）✅ */
  if (!skipSave) {
    try {
      fetch('/petsettings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toonOn: on })
      }).catch(function () {});
    } catch (e_ts) {}
  }
  console.log('[pet] 三渲二 → ' + (on ? '开 ✅（已记忆）' : '关（已记忆）'));
}
