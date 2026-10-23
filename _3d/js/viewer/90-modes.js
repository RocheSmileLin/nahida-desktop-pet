/* ============================================================================
   渲染模式（渲染/白模/线框/三渲二）与动作测试冻结
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ================= 渲染模式 / 白模模式（用户 2026-10-11 要求）=================
   渲染 = 原来的贴图渲染；白模 = 所有材质换纯白哑光 + 摘掉贴图
     → 看几何、剪影、接缝、缺口最清楚（相当于 Blender 的「白模 / 实体」视图）✅
   ⚠️ 只改材质外观，【部件显隐】照旧 —— 拆掉部件 + 白模，缺哪儿一眼就看出来 ✅ */
var MODE = 'white';                       /* ★ 用户 2026-10-11：初始进入【默认白模】✅ */
console.log('[viewer] BUILD-20261017-2136 三渲二版');
var MODE_LOCKED = false;                  /* URL 指定了模式 → 不再被设置覆盖 */
var QP = {};                              /* URL 调试参数：mode/ow/oc */
try {
  var _sp = new URLSearchParams(location.search);
  ['mode', 'ow', 'oc', 'flat', 'dbg', 'pick', 'pickx', 'picky', 'at', 'nm'].forEach(function (k) { var v = _sp.get(k); if (v !== null) { QP[k] = v; } });
} catch (e) {}
/* ★ 2026-10-17：URL 直连模式 —— viewer.html?mode=toon|white|wire|render
   （调试/分享用：不会被其它页面周期性写回的设置覆盖）*/
(function () {
  try {
    var q = (new URLSearchParams(location.search)).get('mode');
    if (q === 'toon' || q === 'white' || q === 'wire' || q === 'render') { MODE = q; MODE_LOCKED = true; }
  } catch (e) {}
})();

/* ══════════ ★★ 2026-10-17 三渲二（原神风）：彩色分段 toon ramp ══════════
   原理：three 的 toon shader 用 `diffuse * texture2D(gradientMap, NdotL).rgb`，
   所以【ramp 里写什么颜色，阴影就是什么颜色】—— 原神的影子偏冷紫就是这么来的。
   分段：暗部 0~44% / 过渡 44~52% / 中间 52~88% / 亮部 88~100% */
var _toonRamp = null, _faceRamp = null;
function _makeRamp(stops) {
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
function getToonRamp() {
  if (!_toonRamp) {
    _toonRamp = _makeRamp([
      [0.00, '#4d527a'],   /* 暗部：冷紫 */
      [0.58, '#4d527a'],
      [0.62, '#c6cbd8'],   /* 中间调 */
      [0.90, '#c6cbd8'],
      [0.94, '#ffffff'],   /* 受光 */
      [1.00, '#ffffff']
    ]);
  }
  return _toonRamp;
}
/* ★ 脸部专用：过渡更柔、影子偏暖灰（原神的脸不吃硬阴影，否则鼻子/下巴会出现黑边）*/
function getFaceRamp() {
  if (!_faceRamp) {
    _faceRamp = _makeRamp([
      [0.00, '#a39499'],
      [0.28, '#a39499'],
      [0.62, '#ded8d8'],
      [0.92, '#ffffff'],
      [1.00, '#ffffff']
    ]);
  }
  return _faceRamp;
}
var _flatRamp = null;
function getFlatRamp() {
  if (!_flatRamp) { _flatRamp = _makeRamp([[0, '#ffffff'], [1, '#ffffff']]); }
  return _flatRamp;
}
var FACE_RE = /颜|颜2|肌|颈|neck|skin|口舌|齿|耳|body/i;
/* 薄片布料（裙/披/飘带…）：单面片 → 反向外扩壳必然盖穿，跳过描边 ✅ */
var CLOTH_RE = /裙|SKIRT|披|飘带|围裙|泳|内裤|百褶|带子|蝴蝶结/i;

/* ★★ 描边：反向外扩壳（BackSide + 沿法线外推；skinning / morph 都在着色器里，自动跟随）*/
var OUTLINES = [], OUTLINE_W = 0.05, OUTLINE_COLOR = 0x2a2233;
function makeOutlineMat(name, srcMat, sign) {
  /* sign<0 = 该组法线朝内 → 壳要用 FrontSide + 反向外扩，否则近侧面被当成背面整块盖住模型 ✅ */
  var inward = (sign !== undefined && sign < 0);
  var m = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: inward ? THREE.FrontSide : THREE.BackSide
  });
  m.name = name || '';
  if (srcMat && (CLOTH_RE.test(name || '') || srcMat.transparent || srcMat.alphaMap
                 || srcMat.side === THREE.DoubleSide)) {
    m.userData.skipOutline = true;
  }
  var w0 = OUTLINE_W * (sign === undefined ? 1 : sign);
  m.userData.sign = (sign === undefined ? 1 : sign);
  /* ⚠️ 描边壳必须【完全不透明】只吃 alphaTest 镂空：
     若继承源的 transparent/opacity，深色壳会整块从半透明衣服里透出来（曾出现「紫裙」/「红裙」）✅ */
  if (srcMat) {
    if (srcMat.alphaMap) {
      m.alphaMap = srcMat.alphaMap;
      m.alphaTest = Math.max(0.5, srcMat.alphaTest || 0);
    }
    m.transparent = false;
    m.opacity = 1;
  }
  m.onBeforeCompile = function (shader) {
    shader.uniforms.uOutlineW = { value: w0 };
    shader.vertexShader = 'uniform float uOutlineW;\n' + shader.vertexShader;
    /* ⚠️ MeshBasicMaterial 没有 objectNormal（那是带光照的材质才有）→ 用原始 normal 属性，
       在 begin_vertex 之后外推，随后的 skinning_vertex 会把这份偏移一起蒙皮 ✅ */
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += normalize( normal ) * uOutlineW;'
    );
    m.userData.shader = shader;
  };
  return m;
}
/* ★ 每组材质的法线是朝外还是朝内（MMD 裙子常朝内 → 外扩要取反，否则壳会翻到模型里面/整块露出来）*/
function groupNormalSigns(geo) {
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
      var a = acc[g.materialIndex || 0];
      var cnt = g.count || 0, st = g.start || 0;
      var step = Math.max(1, Math.floor(cnt / 600)) * 3;      /* 采样，别全算 */
      for (var i = st; i + 2 < st + cnt; i += step) {
        var vi = idx ? idx.getX(i) : i;
        var s = nor.getX(vi) * (pos.getX(vi) - c.x)
              + nor.getY(vi) * (pos.getY(vi) - c.y)
              + nor.getZ(vi) * (pos.getZ(vi) - c.z);
        a[0] += s; a[1] += 1;
      }
    });
    for (var j = 0; j < acc.length; j++) {
      signs.push(acc[j][1] ? (acc[j][0] / acc[j][1] < 0 ? -1 : 1) : 1);
    }
  } catch (e) { signs = []; }
  return signs;
}
function buildOutlines() {
  if (OUTLINES.length || !S.mesh) { return; }
  var targets = [];
  S.mesh.traverse(function (o) { if (o.isMesh && !o.isOutline) { targets.push(o); } });
  for (var t = 0; t < targets.length; t++) {
    var src = targets[t];
    if (!src.isSkinnedMesh && !src.geometry) { continue; }
    var mats = Array.isArray(src.material) ? src.material : [src.material];
    var signs = groupNormalSigns(src.geometry);
    var flipped = 0;
    var omats = mats.map(function (mm, mi) {
      var sg = signs[mi] === undefined ? 1 : signs[mi];
      if (sg < 0) { flipped++; }
      return makeOutlineMat(mm && mm.name, mm, sg);
    });
    if (flipped) { console.log('[viewer] 描边：' + flipped + '/' + mats.length + ' 组法线朝内已反向外扩'); }
    var one = (omats.length === 1) ? omats[0] : omats;
    var hull;
    if (src.isSkinnedMesh) {
      hull = new THREE.SkinnedMesh(src.geometry, one);
      hull.bind(src.skeleton, src.bindMatrix);
      hull.bindMode = src.bindMode;
    } else {
      hull = new THREE.Mesh(src.geometry, one);
    }
    hull.isOutline = true;
    hull.frustumCulled = false;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.position.copy(src.position);
    hull.quaternion.copy(src.quaternion);
    hull.scale.copy(src.scale);
    hull.visible = false;
    src.parent.add(hull);
    OUTLINES.push({ mesh: hull, mats: omats });
  }
  console.log('[viewer] 描边壳已建：' + OUTLINES.length + ' 个 ✅');
}
function applyOutlineState() {
  var on = (MODE === 'toon');
  for (var i = 0; i < OUTLINES.length; i++) {
    var o = OUTLINES[i];
    o.mesh.visible = on;
    for (var j = 0; j < o.mats.length; j++) {
      if (o.mats[j].userData && o.mats[j].userData.skipOutline) { o.mats[j].visible = false; continue; }
      var nm = o.mats[j].name || '';
      var st = PARTS[nm];
      o.mats[j].visible = !(st === false || st === 'hide');
    }
  }
}
function setOutlineWidth(w) {
  OUTLINE_W = w;
  for (var i = 0; i < OUTLINES.length; i++) {
    var ms = OUTLINES[i].mats;
    for (var j = 0; j < ms.length; j++) {
      var sh = ms[j].userData && ms[j].userData.shader;
      var sg = ms[j].userData && ms[j].userData.sign ? ms[j].userData.sign : 1;
      if (sh && sh.uniforms && sh.uniforms.uOutlineW) { sh.uniforms.uOutlineW.value = w * sg; }
    }
  }
  needsRender = true;
}

function setMode(mode) {
  MODE = (mode === 'white') ? 'white' : (mode === 'wire' ? 'wire' : (mode === 'toon' ? 'toon' : 'render'));
  for (var i = 0; i < MATS.length; i++) {
    var e = MATS[i], m = e.m;
    if (!m) { continue; }
    /* ★★ 三渲二：整块换成 MeshToonMaterial + 彩色分段 ramp
       （MMDToonMaterial 是 phong+matcap，没有色阶 → 换 gradientMap 无效）*/
    if (MODE === 'toon') {
      if (!e.toonMat) {
        e.toonMat = new THREE.MeshToonMaterial({
          color: (QP.nm ? 0xffffff : e.color), map: (QP.nm ? null : e.map),
          transparent: false, opacity: 1,
          alphaTest: (QP.at !== undefined ? +QP.at : e.alphaTest),
          /* ★ 必须继承原材质的面剔除设置：披风/袖子是 DoubleSide，设成单面就会「正面看不见」✅ */
          side: m.side,
          gradientMap: (QP.flat ? getFlatRamp() : (FACE_RE.test(m.name || '') ? getFaceRamp() : getToonRamp()))
        });
        e.toonMat.name = m.name || '';   /* ★ 部件显隐靠材质名 → 必须继承，否则隐藏件会全冒出来 */
        if (m.emissive) { e.toonMat.emissive = m.emissive.clone(); }
      }
      if (e.mesh) {
        if (Array.isArray(e.mesh.material)) { e.mesh.material[e.mi] = e.toonMat; }
        else { e.mesh.material = e.toonMat; }
      }
      continue;
    }
    /* 从三渲二切回来：恢复原材质对象 */
    if (e.mesh) {
      if (Array.isArray(e.mesh.material)) {
        if (e.mesh.material[e.mi] === e.toonMat) { e.mesh.material[e.mi] = e.m; }
      } else if (e.mesh.material === e.toonMat) {
        e.mesh.material = e.m;
      }
    }
    if (MODE === 'white' || MODE === 'wire') {
      m.map = null;
      /* 线框用中灰（0x8fa3b8）：深色背景和白色背景都看得见 ✅ */
      if (m.color) { m.color.setHex(MODE === 'wire' ? 0x8fa3b8 : 0xffffff); }
      m.transparent = false; m.opacity = 1; m.alphaTest = 0;
      m.wireframe = (MODE === 'wire');
    } else {
      m.map = e.map;
      if (m.color) { m.color.setHex(e.color); }
      m.transparent = e.transparent; m.opacity = e.opacity; m.alphaTest = e.alphaTest;
      m.wireframe = false;
    }
    /* ★ 三渲二：换成彩色分段 ramp（其它模式换回原模型的 toon 贴图）*/
    if ('gradientMap' in m) {
      m.gradientMap = (MODE === 'toon') ? getToonRamp() : e.grad;
    }
    m.needsUpdate = true;                 /* 有/无贴图会换着色器程序 → 必须置脏 ✅ */
  }
  var bs = document.querySelectorAll('#seg-mode button');
  for (var j = 0; j < bs.length; j++) {
    var on = (bs[j].getAttribute('data-mode') === MODE);
    if (on) { bs[j].classList.add('on'); } else { bs[j].classList.remove('on'); }
  }
  /* ★ 三渲二：灯光改成「正前方偏上」——原神角色永远是前光，
     否则竖直面（裙子）落在阴影色阶里会整块发紫 ✅ */
  if (MODE === 'toon') {
    setKeyDir(0.35, 0.60, 1.0);
    fillLight.position.set(-0.70, 0.25, 0.90);
  } else {
    setKeyDir(0.4, 1.0, 0.9);
    fillLight.position.set(-0.6, 0.3, 0.6);
  }
  if (typeof applyParts === 'function') { applyParts(); }   /* ★ 换材质后重刷部件显隐 */
  if (QP.dbg) {
    console.log('[dbg] PARTS=' + JSON.stringify(PARTS));
    meshMaterials().forEach(function (mm) {
      if (!mm) { return; }
      console.log('[dbg] ' + (mm.visible ? 'V' : '-') + ' ' + (mm.name || '(无名)')
                  + ' #' + (mm.color ? mm.color.getHexString() : '------')
                  + ' map=' + (mm.map ? 'Y' : 'N') + ' aT=' + (mm.alphaTest || 0)
                  + ' tr=' + (mm.transparent ? '1' : '0') + ' op=' + mm.opacity
                  + ' side=' + mm.side);
    });
  }
  if (typeof applyEnv === 'function') { applyEnv(); }        /* ★ 三渲二要重算灯光配比 */
  /* ★ 三渲二：建描边壳并开/关 */
  if (MODE === 'toon') { buildOutlines(); }
  if (typeof applyOutlineState === 'function') { applyOutlineState(); }
  needsRender = true;                     /* 静态按需渲染 → 手动催一帧 ✅ */
  console.log('[viewer] 渲染模式 → ' + (MODE === 'white' ? '白模（纯白、无贴图）'
              : MODE === 'wire' ? '线框（白模 + 线框）' : '贴图渲染') + ' ✅');
}
(function () {
  var bs = document.querySelectorAll('#seg-mode button');
  for (var i = 0; i < bs.length; i++) {
    bs[i].addEventListener('click', function () {
      var m = this.getAttribute('data-mode');
      setMode(m);
      /* ★ 2026-10-17：同时写回设置，保证调整台「渲染」页的下拉框同步 ✅ */
      try {
        fetch('/petsettings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ renderMode: m })
        }).catch(function () {});
      } catch (e) {}
      window.focus();
    });
  }
})();

/* ★ 2026-10-13「动作测试」：冻结开关 —— 冻结后停掉 helper.update（动画 / IK / 付与 / 物理），
   手动改的骨骼才不会被每帧算回去（尤其是 D 链：它的值是 grant 算出来的，不冻结根本改不动）✅ */
var MMD_FROZEN = false;
