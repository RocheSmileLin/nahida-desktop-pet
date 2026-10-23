/* ============================================================================
   渲染就绪闸门：衣物优先、贴图上传检查
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ============ 动画状态 ============ */
/* ★★ 2026-10-18 用户要求「将眨眼机制删除」（和现有表情冲突；以后想眨眼可以自主加）：
   原来的 `var blink = {next,phase,t}` + 主循环里的程序化眨眼代码已整块移除。
   现在眼睛完全由【动作自带的 morph 轨道】和【表情页滑杆 / 预设 / 自动表情】决定 ✅
   想恢复眨眼：① 表情页把「まばたき」滑杆拉上去（手动/存进预设）
               ② 或存一个「眨眼」表情预设（まばたき = 1），自动表情会随机抽到它 */
var EYE = ['両目', '左目', '右目', '左目先', '右目先'];
/* 视线跟随的缓动量（增量，叠加在基础姿势上） */
var gaze = { hx: 0, hy: 0, nx: 0, ex: 0, ey: 0 };

/* ★★ 渲染就绪检查（用户最终要求：确保【衣服】优先渲染，其余都可容忍 ✅）
   —— 显示前只要求那 16 个部件（衣服/首饰）的贴图【源图已下载 + 已上传显存】；
      主体（身体/头/脸/头发）没就绪也先显示，它之后自己补上（可容忍 ✅）
   —— 这样永远不会出现"没穿衣服"的中间状态 ✅
   没齐就【离屏再画一遍】催上传（屏幕上看不到），返回 false；齐了返回 true
   兜底：姿势就绪后最多等 6 秒，等不到也放行（不能一直空着） */
var CLOTH_MATS = [
  /* 纳西妲本体系（头饰/手镯/披风/树叶/脚环/臂饰/踝饰/裤子/连衣裙/足）*/
  '头饰', '手镯.R', '披风-披风饰', '披风-披风', '树叶',
  '脚环L', '脚环R', '臂饰.L', '臂饰.R', '裤子',
  '踝饰-体.L', '踝饰-体.R', '踝饰-足.L', '踝饰-足.R', 'feet_hide',
  '连衣裙-体饰', '连衣裙-裙', '连衣裙-裙2', '连衣裙-体',
  /* 内置替换服装（背心/格子裙/百褶裙/腿环/蓝色裙子/纹身2）*/
  '背心', '格子裙', '百褶裙',
  '部件_部件_衣服.002', '部件_部件_腿环', '部件_部件_衣饰2',
  '部件_部件_ヘアシャドウ',
  '部件_部件_[e]SKIRT B', '部件_部件_[e]SKIRT GOLD',
  '部件_部件_[d]TOP', '部件_部件_[d]DRESS M',
  '部件_部件_[d]DRESS DEC', '部件_部件_[d]DRESS PEARL', '部件_部件_[d]BELT',
  '部件_部件_[f]SKIRT-', '部件_部件_[f]SKIRT',
  /* 浅蓝色配件（腿环/臂饰/踝饰）*/
  '部件_部件_裤子',
  '部件_部件_袖子.002', '部件_部件_臂带',
  '部件_部件_袖子.001', '部件_部件_臂带.001',
  '部件_部件_臂饰.002', '部件_部件_臂饰.001',
  /* 名乃猫耳 / 猫尾 */
  '部件_部件_Body_Ear.001', '部件_部件_Body_EarWhiteFur.001',
  '部件_部件_Body_Tail.001', '部件_部件_Cloth_TailAcc.001',
  /* 猫娘套装 */
  'sweater_Copy_1_FRONT_1630.001', 'sweater正面_FRONT_1685', '爪子口袋_FRONT_1674',
  'sweater_FRONT_1620.001', 'Material1932.001',
  /* 深蓝 JK 上衣 / 裙子 */
  '部件_F_79489267', '部件_H_79489273.001', '部件_B_79489243',
  '部件_A_79489237', '部件_C_79489249',
  '部件_E_79489261', '部件_D_79489255', '部件_H_79489273'
];

/* ★★ 入场闸门：只等【当前可见】的【上装 + 下装】的贴图
   —— 用户要求（2026-10-17）：
      ① 只等「当前需要显示」的部件（隐藏件一律不等 ✅ 由 assetsCheck 内部跳过）
      ② 其中优先上装/下装 —— 这两类齐了就直接显示，配件（头饰/臂饰/踝饰/纹身/腿环…）
         不等，它们谁的贴图到位谁自己出现（applyPartVisibility 里 per-material texReady）
   ⚠️ 增删上装/下装部件时，这个表要和 settings.html 的 PART_TREE 里 👕上装 / 👖下装 同步
   ⚠️ 这里故意【不含】身体/头脸材质：那批（体1.png 8192²）最慢，等它会把入场拖长；
        身体材质由显示前的离屏预热负责催上传 */
var TOP_BOTTOM_MATS = [
  /* 👕 上装：连衣裙 / 背心 / 深蓝JK上衣 */
  '连衣裙-体饰', '连衣裙-裙', '连衣裙-裙2', '连衣裙-体',
  '背心',
  '部件_F_79489267', '部件_H_79489273.001', '部件_B_79489243',
  '部件_A_79489237', '部件_C_79489249',
  /* 👖 下装：裤子 / 格子裙 / 百褶裙 / 蓝色裙子 / 猫娘套装 / 深蓝JK裙子 */
  '裤子',
  '格子裙', '百褶裙',
  '部件_部件_[e]SKIRT B', '部件_部件_[e]SKIRT GOLD',
  '部件_部件_[d]TOP', '部件_部件_[d]DRESS M', '部件_部件_[d]DRESS DEC',
  '部件_部件_[d]DRESS PEARL', '部件_部件_[d]BELT',
  '部件_部件_[f]SKIRT-', '部件_部件_[f]SKIRT',
  'sweater_Copy_1_FRONT_1630.001', 'sweater正面_FRONT_1685', '爪子口袋_FRONT_1674',
  'sweater_FRONT_1620.001', 'Material1932.001',
  '部件_E_79489261', '部件_D_79489255', '部件_H_79489273'
];
/* 主体（躯干/头/脸/发）材质 —— 2026-10-17 用户要求：
   「躯干不能不等上下装就先显示」⇒ 入场闸门必须【上下装 + 主体】同时就绪才显现，
   否则会先露出一具没穿衣服的身体 ❌ */
var BODY_MATS = ['颜', '颜2', '齿', '口舌', '二重', '眉', '睫', '目', '白目', '星目',
                 '肌2', '髮', '前髮', '髮+', 'body_neck', 'body_hexie'];
/* 闸门名单：默认只含可见的上下装；withBody=true 时把主体也加进来（显示前用） */
function gateMats(withBody) {
  return withBody ? TOP_BOTTOM_MATS.concat(BODY_MATS) : TOP_BOTTOM_MATS;
}

/* 单个材质的贴图是否【源图已下载 + 已上传显存】 */
function texReady(m) {
  if (!m || !m.map) { return true; }
  var im = m.map.image;
  var imgOk = false;
  if (im) {
    if (typeof ImageBitmap !== 'undefined' && (im instanceof ImageBitmap)) { imgOk = true; }
    else { imgOk = !!(im.complete && (im.naturalWidth || im.width)); }
  }
  if (!imgOk) { return false; }
  var p = renderer.properties ? renderer.properties.get(m.map) : null;
  return !!(p && p.__webglTexture);
}

/* names = null → 检查全部材质；否则只检查这些材质名（"衣服优先"传 CLOTH_MATS）
   strict = true → 【显示闸门用】：即使等太久也不放行（只由 S.revealDeadline 兜底），
                   否则 6 秒后就会返回 true ⇒ 衣服没传完就露主体 ❌ */
function assetsCheck(names, strict) {
  try {
    var list = [];
    S.mesh.traverse(function (o) {
      if (!o.isMesh) return;
      var arr = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < arr.length; i++) {
        var m = arr[i];
        if (!m) continue;
        if (names && names.indexOf(m.name) < 0) continue;
        /* ★ 2026-10-16（用户要求）：被隐藏的件【不等它贴图】✅
           原来会等 CLOTH_MATS 里【全部】件（含大量默认隐藏的配件）⇒ 入场空档长 ⇒ 一直露 A-pose ✗
           隐藏件本来就不显示 ⇒ 等它没有意义 ✓ 跳过即可（L1556 的 initTexture 仍覆盖全部材质 ⇒ 不会死锁 ✓）*/
        var _pst = (PET_SETTINGS.parts || {})[m.name];
        if (_pst === false || _pst === 'hide') { continue; }
        list.push(m);
      }
    });
    var pend = [];
    for (var k = 0; k < list.length; k++) {
      if (!texReady(list[k])) { pend.push(list[k].name || '?'); }
    }
    S._pend = pend;
    /* 没齐 → 先催一把（直接 initTexture + 离屏画一遍），本帧不显示 ✅ */
    try {
      if (!S._warmRT) { S._warmRT = new THREE.WebGLRenderTarget(64, 64); }
      if (renderer.initTexture) {
        /* ★ 注意：这里要【所有】材质都 initTexture，不能只处理被检查的那批
           —— 被隐藏的材质不会进入绘制 → 不上传 → texReady 永远 false → 永远不显示（死锁）✅
           ★★ 2026-10-17 用户要求「上下装最先显示」：上传顺序改成
              ① 上装/下装（TOP_BOTTOM_MATS 顺序） ② 其余（主体/配件）
              ⇒ 衣服先上显存，主体随后；配合显示闸门（上下装+主体都要就绪），
                不会出现"先露躯干、衣服后补" ❌ */
        var _allM = meshMaterials() || [];
        var _prio = {};
        for (var _pi = 0; _pi < TOP_BOTTOM_MATS.length; _pi++) { _prio[TOP_BOTTOM_MATS[_pi]] = _pi + 1; }
        var _first = [], _rest = [];
        for (var _q0 = 0; _q0 < _allM.length; _q0++) {
          var _mm = _allM[_q0];
          if (!_mm || !_mm.map) { continue; }
          /* ★★ 2026-10-21（内存优化）：隐藏的部件【不催上传】。
             原来这里对【全部 112 个材质】调 initTexture ⇒ 82 个默认隐藏的部件
             贴图也全进显存（实测白占 ~200 MB）。
             现在只催「可见」的；隐藏件由 three.js 在它被显示的第一次绘制时
             自动上传（不会死锁：下面的 list 已经排除了隐藏件，闸门不依赖它们）✅ */
          var _pst2 = (PET_SETTINGS.parts || {})[_mm.name];
          if (_pst2 === false || _pst2 === 'hide') { continue; }
          if (_prio[_mm.name]) { _first.push(_mm); } else { _rest.push(_mm); }
        }
        _first.sort(function (a, b) { return _prio[a.name] - _prio[b.name]; });
        var _seq = _first.concat(_rest);
        for (var q = 0; q < _seq.length; q++) {
          try { renderer.initTexture(_seq[q].map); } catch (e5) {}
        }
      }
      var _pv = renderer.getRenderTarget();
      var _wasVis = S.mesh.visible;
      S.mesh.visible = true;                 /* 只画到 64×64 离屏图上，屏幕上看不到 ✅ */
      renderer.setRenderTarget(S._warmRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(_pv);
      S.mesh.visible = _wasVis;
      var _gl = renderer.getContext();
      if (_gl && _gl.finish) { _gl.finish(); }
    } catch (e6) {}
    if (pend.length === 0) { return true; }
    var w = S.poseReadyAt ? (Date.now() - S.poseReadyAt) : 0;
    if (!strict && w > 6000) {
      console.warn('[pet] ' + (names ? '衣服' : '全部') + '贴图仍剩 ' + pend.length +
                   ' 未就绪，先显示: ' + pend.join(','));
      return true;
    }
    if (!S._wLog || (Date.now() - S._wLog) > 1000) {
      S._wLog = Date.now();
      T('等' + (names ? '衣服' : '全部') + '贴图：还差 ' + pend.length + ' 张');
    }
    return false;
  } catch (e) {
    console.log('[pet] assetsCheck 异常（直接放行）: ' + e);
    return true;
  }
}
