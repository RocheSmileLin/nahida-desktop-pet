/* ============================================================================
   入场闸门与部件显隐（贴图就绪检查）
   —— 由原 viewer.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ══════════════════════════════════════════════════════════════════
   ★★ 2026-10-18 入场闸门（与 pet.html 同一套做法）—— 用户要求：
      「中央展示区也跟着桌面端一样，加载完必要部件就能显示」
   —— 原来这里在 onLoad 里【同步】把 37 张贴图（含 8192² 的体1.png）全部
      initTexture + 离屏渲染一遍 ⇒ 首屏被卡住十几秒 ✗
   —— 现在改成：
      ① 每帧只催一批上传（优先级：上下装 → 主体 → 配件）
      ② 闸门只等【当前可见的上下装 + 主体】，齐了就显示
      ③ 白模 / 线框 模式下贴图根本不用 ⇒ 立刻显示 ✅
      ④ 配件谁的贴图到位谁自己出现（applyParts 里 per-material 判 texReady）
      ⑤ 兜底：9 秒还没齐也强制显示（防止死锁）
   ⚠️ 增删上下装部件时，这个表要和 settings.html 的 PART_TREE 同步
   ══════════════════════════════════════════════════════════════════ */
var TOP_BOTTOM_MATS = [
  /* 👕 上装：连衣裙 / 背心 / 深蓝JK上衣 */
  '连衣裙-体饰', '连衣裙-裙', '连衣裙-裙2', '连衣裙-体',
  '背心',
  '部件_F_79489267', '部件_H_79489273.001', '部件_B_79489243',
  '部件_A_79489237', '部件_C_79489249',
  /* 👖 下装：裤子 / 格子裙 / 百褶裙 / 蓝色裙子 / 深蓝JK裙子 / 猫娘套装 */
  '裤子',
  '格子裙', '百褶裙',
  '部件_部件_[e]SKIRT B', '部件_部件_[e]SKIRT GOLD',
  '部件_部件_[d]TOP', '部件_部件_[d]DRESS M', '部件_部件_[d]DRESS DEC',
  '部件_部件_[d]DRESS PEARL', '部件_部件_[d]BELT',
  '部件_部件_[f]SKIRT-', '部件_部件_[f]SKIRT',
  '部件_E_79489261', '部件_D_79489255', '部件_H_79489273',
  'sweater_Copy_1_FRONT_1630.001', 'sweater正面_FRONT_1685', '爪子口袋_FRONT_1674',
  'sweater_FRONT_1620.001', 'Material1932.001'
];
/* 主体（躯干/头/脸/发）—— 不能不等主体就先显示，否则先露一具没穿衣服的身体 */
var BODY_MATS = ['颜', '颜2', '齿', '口舌', '二重', '眉', '睫', '目', '白目', '星目',
                 '肌2', '髮', '前髮', '髮+', 'body_neck', 'body_hexie'];

function gateMatsViewer(withBody) {
  return withBody ? TOP_BOTTOM_MATS.concat(BODY_MATS) : TOP_BOTTOM_MATS;
}

/* 闸门检查：只检查【名单内 + 当前可见】的材质；没齐 → 顺手催上传（本帧不显示）
   strict=true：显示闸门用，永不因"等太久"自行放行（只由 revealDeadline 兜底）✅ */
function assetsCheckViewer(names, strict) {
  try {
    var list = [], all = [];
    S.mesh.traverse(function (o) {
      if (!o.isMesh) return;
      var arr = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < arr.length; i++) {
        var m = arr[i];
        if (!m) continue;
        all.push(m);
        if (names && names.indexOf(m.name) < 0) continue;
        var pst = PARTS[m.name];
        if (pst === false || pst === 'hide') continue;      /* 隐藏件不等它 ✅ */
        list.push(m);
      }
    });
    var pend = [];
    for (var k = 0; k < list.length; k++) {
      if (!texReadyOne(list[k])) { pend.push(list[k].name || '?'); }
    }
    /* 催上传：全部材质都要催（隐藏件永远不绘制 → 不催就永远不上传 → 死锁）*/
    if (renderer.initTexture) {
      for (var q = 0; q < all.length; q++) {
        var mm = all[q];
        if (mm.map && !texReadyOne(mm)) { try { renderer.initTexture(mm.map); } catch (e6) {} }
      }
    }
    S._pend = pend;
    return pend.length === 0;
  } catch (e7) {
    console.log('[viewer] assetsCheck 异常（直接放行）: ' + e7);
    return true;
  }
}

/* 显示：模型一就绪就显示（静默加载，不等贴图）*/
function tryReveal() {
  if (S.revealed || !S.mesh || !S.poseReadyAt) { return; }
  /* ★★ 2026-10-18 用户要求：「为什么要永久隐藏，不能静默加载吗？」
     → 现在【不等贴图】：几何一就绪立刻显示，贴图谁好了谁自己贴上去 ✅
     （旧行为：按材质"贴图是否就绪"隐藏 → 显存不足/上传失败时整只模型永久不显示，
       表现为「白模/线框正常，渲染/三渲二全空」）*/
  console.log('[viewer] 直接显示（静默加载）：启动到显示 '
              + (((Date.now() - (S.loadT0 || Date.now())) / 1000).toFixed(1)) + 's ✅');
  reveal(S.mesh);
}


/* 构图 + 显示：用【骨骼世界坐标】算包围盒（蒙皮网格的 Box3 量的是静止姿势，会切脚）✅ */
function reveal(mesh) {
  var box = new THREE.Box3(), v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  mesh.skeleton.bones.forEach(function (b) { b.getWorldPosition(v); box.expandByPoint(v); });
  S.size = { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()),
             min: box.min.clone(), max: box.max.clone() };
  fitView();
  userMoved = false;
  mesh.visible = true;
  S.revealed = true;
  applyParts();
  document.getElementById('tip').style.display = 'none';
  /* 诊断：模型站位（用户要求「初始模型位于 (0,0,0)」——脚底 y 应≈0、x/z 应≈居中）✅ */
  console.log('[viewer] 模型站位：x ' + box.min.x.toFixed(2) + ' ~ ' + box.max.x.toFixed(2)
              + ' ｜ y ' + box.min.y.toFixed(2) + ' ~ ' + box.max.y.toFixed(2)
              + ' ｜ z ' + box.min.z.toFixed(2) + ' ~ ' + box.max.z.toFixed(2)
              + '（场景单位；脚底 y=0 = 站在原点 ✅）');
  console.log('[viewer] 站姿就绪，整体显示 ✅ 视角中心='
              + view.pivot.x.toFixed(2) + ',' + view.pivot.y.toFixed(2) + ',' + view.pivot.z.toFixed(2)
              + ' 距离=' + view.dist.toFixed(2));
  /* ★ 模型就绪后必须重跑一次 setMode：加载期 S.mesh 还是 null，
     applyParts（部件显隐）/ 描边全是空跑 —— 曾导致「隐藏的裙子在三渲二里全冒出来」✅ */
  if (QP.ow !== undefined) { OUTLINE_W = +QP.ow; }
  if (QP.oc !== undefined) { OUTLINE_COLOR = parseInt(QP.oc, 16); }
  setMode(MODE);
  if (QP.pick) {
    setTimeout(function () {
      var rc = new THREE.Raycaster();
      var W = window.innerWidth, H = window.innerHeight;
      var nx = (QP.pickx ? +QP.pickx : W * 0.52) / W * 2 - 1;
      var ny = -((QP.picky ? +QP.picky : H * 0.52) / H * 2 - 1);
      rc.setFromCamera({ x: nx, y: ny }, camera);
      var hits = rc.intersectObject(S.mesh, true);
      console.log('[pick] 命中 ' + hits.length + ' 个；屏幕 (' + Math.round(nx * 500 + W / 2) + ',' + Math.round(-ny * 500 + H / 2) + ')');
      hits.slice(0, 5).forEach(function (h) {
        var mm = h.object.material;
        if (Array.isArray(mm) && h.face) { mm = mm[h.face.materialIndex]; }
        console.log('[pick] ' + (h.object.name || '(无名mesh)') + ' | mat=' + (mm && mm.name)
                    + ' | idx=' + (h.face ? h.face.materialIndex : -1) + ' | d=' + h.distance.toFixed(2));
      });
    }, 4000);
  }
}

/* 构图：整只人物入画（留 8% 余量），中心对准骨骼包围盒；方位回到正面 ✅ */
function fitView() {
  if (!S.size) return;
  camera.aspect = W / H;
  var size = S.size.size, c = S.size.center;
  var hh = Math.tan(FOV * Math.PI / 360);
  var fill = 0.92;
  view.dist = Math.max((size.y / fill) / (2 * hh), (size.x / fill) / (2 * hh * camera.aspect));
  view.fitDist = view.dist;
  view.pivot.set(c.x, c.y + size.y * 0.02, c.z);
  view.az = 0;
  view.el = 6 * Math.PI / 180;
  applyCam();
  /* ★ 2026-10-21：换了构图（pivot 被重置）→ 相机跟随的基线要重新建立，
     否则下一次换动作会把刚构好的画面又平移走 ✅ */
  if (typeof _poseCenter !== 'undefined') { _poseCenter = null; _userShift = null; }
}

/* ---------------- 部件显隐（只读，跟调整台同步）---------------- */
function meshMaterials() {
  if (!S.mesh) return [];
  var m = S.mesh.material;
  return (m && m.length !== undefined) ? m : (m ? [m] : []);
}
function applyParts() {
  var mats = meshMaterials();
  for (var i = 0; i < mats.length; i++) {
    var m = mats[i];
    if (!m) continue;
    var st = PARTS[m.name || ''];
    /* ★★ 2026-10-18 用户要求「静默加载，不要永久隐藏」：
       可见性【只由部件开关决定】，不再按"贴图是否就绪"藏材质。
       贴图晚到时 three.js 自己贴上（加载完 texture.needsUpdate 就生效）✅ */
    m.visible = !(st === false || st === 'hide');
  }
  if (typeof applyOutlineState === 'function') { applyOutlineState(); }  /* ★ 描边壳跟着部件显隐 */
  needsRender = true;                       /* 拆装完立刻重画一帧 ✅ */
}

/* 贴图就绪检查（源图已解码 + 已上传显存）—— 没齐就继续逐帧重画 + 主动催上传 ✅
   ⚠️ 被隐藏的材质不会进入绘制 → 不主动 initTexture 就永远不上传 → 永远"没就绪"（死锁）✅ */
function texReadyOne(m) {
  if (!m || !m.map) return true;
  var im = m.map.image, imgOk = false, broken = false;
  if (im) {
    if (typeof ImageBitmap !== 'undefined' && (im instanceof ImageBitmap)) { imgOk = true; }
    else if (im.complete && !(im.naturalWidth || im.width)) { broken = true; }   /* ★ 加载失败（不是没载完）*/
    else { imgOk = !!(im.complete && (im.naturalWidth || im.width)); }
  }
  /* ★★ 2026-10-18 修「渲染/三渲二 整只模型不显示」：
     贴图请求被打断（例如桌宠服务重启时页面还在加载 8192² 大图）→ image 永久 broken
     → applyParts 以为"没就绪"→ 材质永久隐藏 → 白模/线框正常但渲染/三渲二是空的。
     处理：① 立刻自动重试一次（加 ?_r= 破缓存）② 8 秒还失败就先显示无贴图版本，绝不藏死 ✅ */
  if (broken) {
    var ud = m.map.userData || (m.map.userData = {});
    if (ud.__retryAt === undefined) {
      ud.__retryAt = performance.now();
      var src = im && im.src;
      if (src && im.tagName === 'IMG') {
        try { im.src = src + (src.indexOf('?') < 0 ? '?' : '&') + '_r=' + Date.now(); } catch (eRt) {}
      }
      console.warn('[viewer] 贴图加载失败，自动重试：' + (m.name || '') + ' ← ' + src);
    }
    if (performance.now() - ud.__retryAt < 8000) { return false; }
    if (!ud.__gaveUp) {
      ud.__gaveUp = true;
      console.warn('[viewer] 贴图 8s 仍失败 → 先显示无贴图版本（不再隐藏）：' + (m.name || ''));
    }
    return true;
  }
  if (!imgOk) return false;
  var p = renderer.properties ? renderer.properties.get(m.map) : null;
  if (p && p.__webglTexture) { return true; }
  /* ★★ 2026-10-18 硬兜底：图已解码、但 10 秒还没上传到显存（显存不足 / 上传被丢掉）
     → 也先显示，绝不永久藏死（否则就成了"白模正常、渲染全空"）✅ */
  var ud2 = m.map.userData || (m.map.userData = {});
  if (ud2.__waitAt === undefined) { ud2.__waitAt = performance.now(); }
  if (performance.now() - ud2.__waitAt > 10000) {
    if (!ud2.__gaveUp2) {
      ud2.__gaveUp2 = true;
      console.warn('[viewer] 贴图 10s 未上传到显存（可能显存不足）→ 先显示：' + (m.name || ''));
    }
    return true;
  }
  return false;
}

/* ★ 2026-10-18：红色贴图角标已移除（改成静默加载后不再需要"卡住"提示）*/
function texAllReady() {
  var mats = meshMaterials(), ok = true;
  for (var i = 0; i < mats.length; i++) {
    if (!texReadyOne(mats[i])) {
      ok = false;
      if (mats[i] && mats[i].map && renderer.initTexture) {
        try { renderer.initTexture(mats[i].map); } catch (e5) {}
      }
    }
  }
  return ok;
}
