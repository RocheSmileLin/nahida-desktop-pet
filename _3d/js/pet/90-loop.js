/* ============================================================================
   主循环：帧率/物理/动作/表情叠加、入场显示、rAF
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ============ 主循环 ============ */
var _lastFrameT = 0;
/* ★ 2026-10-20 性能三连 ③：可见性 / 焦点感知
   · 窗口被隐藏（最小化、切到别的桌面）→ 整帧跳过，不渲染不解物理（CPU/GPU 直接归零）
   · 窗口失焦（点到别的程序，但宠物还看得见）→ 限到 BLUR_FPS，宠物继续动，只是省 CPU
   ⚠️ 恢复时要把 _lastFrameT 和 clock 的累积 dt 丢掉，否则物理会一次跳很多步（布料被拽一下）*/
var DOC_HIDDEN = false, FOCUSED = true;
/* ★ 失焦降帧的力度：0 = 不降（推荐，保持流畅）；设 30 可省一半 CPU，但布料会变得一顿一顿 */
var BLUR_FPS = 0;
document.addEventListener('visibilitychange', function () {
  DOC_HIDDEN = !!document.hidden;
  if (!DOC_HIDDEN) { _lastFrameT = 0; try { clock.getDelta(); } catch (e) {} }
});
window.addEventListener('blur', function () { FOCUSED = false; });
window.addEventListener('focus', function () { FOCUSED = true; _lastFrameT = 0; try { clock.getDelta(); } catch (e) {} });

function frame(t) {
  /* ★ 帧率上限（MAX_FPS；0 = 不限制）
     ⚠️ 物理和渲染都跟着帧率走 → 这是唯一真正有效的降 CPU 旋钮
     ⚠️ 外层 rafLoop() 里【已经】排好下一帧了 → 这里只 return，
        千万不要再写 requestAnimationFrame，否则会起两条主循环
     ⚠️ rafLoop 调 frame() 时【不传时间戳】→ 用 performance.now() 兜底
     ⚠️ 提前返回时不要调 clock.getDelta()：让时间累积着，
        真正那一帧到来时 dt 才是"两帧的时间"，动画速度不会变慢 */
  var _ft = (typeof t === 'number' && t) ? t
          : (window.performance && performance.now ? performance.now() : Date.now());
  /* ★ 2026-10-20 性能：隐藏时整帧跳过（rAF 仍排着，但什么都不算）*/
  if (DOC_HIDDEN) { return; }
  /* ★ 失焦降到 BLUR_FPS；有焦点用用户设置的 MAX_FPS */
  var _fpsCap = FOCUSED ? MAX_FPS
                        : Math.min(MAX_FPS > 0 ? MAX_FPS : 30, BLUR_FPS);
  if (_fpsCap > 0) {
    if (_ft - _lastFrameT < 1000 / _fpsCap) return;
    _lastFrameT = _ft;
  }
  var dt = clock.getDelta();
  var now = clock.getElapsedTime();

  /* ① 每帧先把我"程序化要动"的骨骼复位到静止姿势（清掉上一帧加的增量）
        ⚠️ 不这么做，叠加会一帧帧累积；这样做还能完整保留动作本身的运动 */
  if (S.ready) {
    resetLayerBones();
    /* ★ morph 也每帧先清零：动作的 morph 轨道只写它自己用到的那些，
          先清零再让动作写 → 没被写到的 morph 就不会残留上一个动作的表情 */
    resetMorphs();

    /* ② 动作驱动 —— 【循环播放】
          ⚠️ 之前是"播一遍就定格成基础姿势"，结果看起来就是一帧不动（用户实际反馈），已改
       ⚠️★ dt 必须【夹住】—— 这是"衣物小抽动"的主因之一：
          任何卡顿（切窗口回来、每 1.5 秒那次位图读像素）都会让 dt 突然变大
          → 物理一次跳好几步 → 布料被拽一下 → 看起来就是抽动
          夹到 1/30 秒：卡顿期间物理按最大 1/30 推进，不会暴跳 */
    /* ★ 拖动惯性（新功能）：把 applyDragInertia 挂到官方钩子 onBeforePhysics
       —— MMDAnimationHelper 在 IK/grant 之后、physics.update() 之前调它 ✅
          → 外力一定落在紧接着的那一步上 ✅
       ⚠️ 每次换姿势都会新建 helper → 这里做一次懒挂载，重建后自动补上 ✅
       ⚠️ 该钩子只在物理开启时被调用 → 所以本功能天然"只在开物理时有效"✅ */
    /* ★ 部件（用户要求 ③）：① 上报清单（一次）② 按设置应用可见性 ✅
       每帧调用开销极小（23 个材质）→ 不需要额外的脏标记 ✅ */
    pushPartNames();
    applyPartVisibility();
    if (S.helper && S.helper.onBeforePhysics !== applyDragInertia) {
      S.helper.onBeforePhysics = applyDragInertia;
    }
    var dtPhys = dt > (1 / 30) ? (1 / 30) : dt;
    /* ★ 诊断：量一下物理(解算)每帧耗时 —— 判断"慢"到底是不是物理吃掉的 */
    var _pT0 = (window.performance && performance.now) ? performance.now() : Date.now();
    if (S.poseClip && S.helper) S.helper.update(dtPhys);
    if (S.revealed && (S._pCount = (S._pCount || 0) + 1) <= 10) {
      var _pMs = ((window.performance && performance.now) ? performance.now() : Date.now()) - _pT0;
      console.log('[pet] 物理解算 第 ' + S._pCount + ' 帧: ' + _pMs.toFixed(1) + 'ms  (刚体349/关节493)');
    }

    var B = S.bones;
    var breath = Math.sin(now * 1.35);
    var sway   = Math.sin(now * 0.55);
    var cen = B['センター'];

    /* ③ 在动作之上叠加：呼吸 / 体重左右微移 / 视线跟随 / 头发摆动
          ⚠️ 幅度刻意调大：待机动作本身很含蓄，叠太小会让人以为"没在动" */
    /* ★ 视线/头部跟踪幅度 —— 用户要求「视觉跟踪范围扩大两倍」→ 全部系数 ×2
       （mouse.x/y 是窗口内 mousemove 归一化出来的 [-1,1]，所以这里的系数就是最大转角） */
    /* ★ 待机动作 / 喵喵喵播放时暂停视觉跟踪和眨眼 —— 让动作完整控制头/眼，
          不被程序层盖掉；播完回「自然站立」后自动恢复 */
    /* ★★ 用户 2026-10-12（更正版）：【只有「摇腿」】取消头部/面部接管 ——
       它属于「初始状态」，和自然站立同等待遇（视线跟踪 / 眨眼 / 头脖眼叠加全保留）✅
       ⚠️ 其他动作（待机 / 攻击 / 喵喵喵 / 摇一摇…）播放时【照旧】交给动作控制头/眼，
          不被程序化层盖掉 ✅ */
    var _poseNm = POSES[S.poseIndex] && POSES[S.poseIndex][0];
    /* ★ 2026-10-14 用户要求：「坐姿」的头部要和【其他初始状态】一致（能跟随视线）
       —— 原来判定是 `(_poseNm !== '摇腿')`，硬编码只放行了 自然站立(0) 和 摇腿(13)；
          姿态(15) / 坐姿(16) 被当成「正在播放的动作」⇒ 头/脖/眼球全交给动作轨
          ⇒ 头部锁死，鼠标怎么动都不看 ❌
       现在改成：只要属于「初始状态」组，就按【定格姿态】处理
          → 叠加程序化视线 / 允许眨眼（正是 自然站立 的行为）✅
       ⚠️ 摇腿 仍走它自己的「记录趴姿抬头基准 + 在其上叠加」特殊分支（见下方 S.yaotuiHead），
          所以这里继续把它排除 ✅ */
    var _initIdx = (typeof GROUPS !== 'undefined' && GROUPS[GROUP_INIT])
                 ? GROUPS[GROUP_INIT][1] : [0];
    var playingAction = (S.poseIndex >= 1)
                     && (_poseNm !== '摇腿')
                     && (_initIdx.indexOf(S.poseIndex) < 0);
    /* ★ IK 动作（ikOff=false）不钉根骨位置、不覆写 Y —— 让动作的根骨位移和跳跃完整生效；
       FK 动作（ikOff=true）照旧钉住，防止模型飘走 */
    var _pose = POSES[S.poseIndex];
    var pinRoot = _pose && _pose[2];
    /* ★ 这三项现在由「调整台」控制（PET_SETTINGS）✅ 1.0 = 原来的手感 ✅ */
    var _gh = PET_SETTINGS.gazeHead, _ge = PET_SETTINGS.gazeEye, _br = PET_SETTINGS.breath;
    if (!playingAction) {
      gaze.hx += (mouse.x * 0.56 * _gh - gaze.hx) * 0.08;   // 头左右转
      gaze.hy += (mouse.y * 0.32 * _gh - gaze.hy) * 0.08;   // 头上下点
      gaze.nx += (mouse.x * 0.20 * _gh - gaze.nx) * 0.06;   // 脖子
      gaze.ex += (mouse.x * 0.36 * _ge - gaze.ex) * 0.15;   // 眼球左右
      gaze.ey += (mouse.y * 0.24 * _ge - gaze.ey) * 0.15;   // 眼球上下
    }

    applyRot('上半身',  sway * 0.012 * _br, 0,  sway * 0.014 * _br);
    applyRot('上半身2', breath * 0.038 * _br, 0, sway * 0.012 * _br);
    applyRot('上半身3', breath * 0.030 * _br, 0, 0);
    /* ★★ 摇腿专用（用户 2026-10-12 澄清版）：动作自带的「趴着抬头」姿态【必须保留】，
       鼠标视线是在它【基础上叠加】—— 不是清零！
       ① 载入后的第 1 帧：把 頭/首/左目/右目/両目 的当前姿态
          （= 动作第 0 帧的"趴姿抬头"）记成【基准】
       ② 之后每帧：先还原到基准（屏蔽动作轨后续的抖动），
          再由紧随其后的 applyRot 叠加程序化视线量（applyRot 是 += 叠加）✅
       ③ 切到别的动作时清掉基准，下次进摇腿重新记录 ✅ */
    /* ⚠️★ 必须同时满足 S.clipForPose === S.poseIndex：
       否则加载空档那几帧会把"上一个动作的头部姿态"记成基准（头就永远抬不起来）❌ */
    if (_poseNm === '摇腿' && S.clipForPose === S.poseIndex) {
      if (!S.yaotuiHead) {
        S.yaotuiHead = {};
        S.lookHeadNames.forEach(function (n) {
          var _b0 = S.bones[n];
          if (_b0) S.yaotuiHead[n] = { x: _b0.rotation.x, y: _b0.rotation.y, z: _b0.rotation.z };
        });
        console.log('[pet] 摇腿：已记录「趴姿抬头」基准姿态（动作头部轨不再抖动，鼠标在此之上叠加）✅');
      }
      S.lookHeadNames.forEach(function (n) {
        var _b1 = S.bones[n], _h1 = S.yaotuiHead[n];
        if (_b1 && _h1) _b1.rotation.set(_h1.x, _h1.y, _h1.z);
      });
    } else if (S.yaotuiHead) {
      S.yaotuiHead = null;             /* 换动作 → 清掉基准，下次重新记录 ✅ */
    }
    /* ★★ 2026-10-17：手动视线（调整台「视线」页）—— 叠加在鼠标跟随之上 */
    var _gMan = manualGaze();
    var _en = (S.eyeNames && S.eyeNames.length) ? S.eyeNames : null;
    if (!playingAction) {
      applyRot('頭', gaze.hy + breath * 0.018 * _br, gaze.hx, sway * 0.010 * _br);
      applyRot('首', gaze.hy * 0.4 + breath * 0.010 * _br, gaze.nx, 0);
      /* ★ 骨名两套都认（PMX=左目/右目，.blend=眼.L/眼.R），否则眼球跟随静默失效 */
      if (_en) {
        applyRot(_en[0], gaze.ey + _gMan.pitch, gaze.ex + _gMan.yaw, 0);
        applyRot(_en[1], gaze.ey + _gMan.pitch, gaze.ex + _gMan.yaw, 0);
      }
    } else {
      /* 动作播放时只叠呼吸/微摆，不叠鼠标视线 —— 头/脖/眼球全交给动作；
         但【手动视线滑杆】照样生效（用户要的就是随时能拧）✅ */
      applyRot('頭', breath * 0.018 * _br, 0, sway * 0.010 * _br);
      applyRot('首', breath * 0.010 * _br, 0, 0);
      if (_en && (_gMan.pitch || _gMan.yaw)) {
        applyRot(_en[0], _gMan.pitch, _gMan.yaw, 0);
        applyRot(_en[1], _gMan.pitch, _gMan.yaw, 0);
      }
    }
    applyRot('左髮_1', 0, 0,  sway * 0.09 * _br);
    applyRot('右髮_1', 0, 0, -sway * 0.09 * _br);

    /* ★ 重心：把所有【根骨】的 X/Z 每帧钉回静止值
       ⚠️ 动作自带位移，不钉住桌宠会飘出窗口；被推远/推近还会让透视上的大小忽大忽小（用户反馈）
       ⚠️ 原来只钉了 センター —— 不够，另外 4 个根骨照样被 VMD 驱动（见 ROOT_BONES 的注释）
       Y 不钉：上下起伏是动作的一部分，センター 的 Y 还叠加我的呼吸
       ★ IK 动作（pinRoot=false）不钉 —— 根骨位移是跳跃/移动的一部分，钉了腿会断 */
    if (pinRoot) {
      for (var ri = 0; ri < ROOT_BONES.length; ri++) {
        var rb = B[ROOT_BONES[ri]], rr = S.rest && S.rest[ROOT_BONES[ri]];
        if (rb && rr) { rb.position.x = rr.px; rb.position.z = rr.pz; }
      }
    }
    /* ★★ 修「连点喵喵喵叠加缩小」的真凶：上半身 / 下半身 的【位置】会被动作反复"叠加"
         （实测：每切一次喵喵喵就 +2.33 单位且永不回退 → 累积把模型推远+下沉
           → 透视上就是用户说的"每次点喵喵喵叠加缩小"）
         这两根在 MMD 里本来就是【只转不移】的 ✅ 位置钉回静止值不会影响动作
         ⚠️ 之前只钉了旋转（"偏离静止"只查旋转），所以一直没抓到位置漂移 */
    /* ★★ 钉位 vs 物理：开了物理就【不要】再钉这几根骨的位置
       ⚠️ 实测（诊断日志）：上半身/上半身2/下半身 上挂着 12 个刚体 + 裙子的约束链
          → 每帧硬设它们的位置 = 把物理的父级变换抢走 → 裙子被约束拉上去
          → 喵喵喵时【衣物上飘到腰部】（用户实测）
       → 用烘焙版动作（那几条位置轨道已清零）后不再需要钉位；关物理时仍保留兜底 ✅ */
    if (!physicsUsable()) {
      for (var si = 0; si < SPINE_POS_BONES.length; si++) {
        var sb = B[SPINE_POS_BONES[si]], sr = S.rest && S.rest[SPINE_POS_BONES[si]];
        if (sb && sr) { sb.position.set(sr.px, sr.py, sr.pz); }
      }
    }
    /* 呼吸起伏：只作用在 センター 的 Y 上
       ★ FK 动作：钉 Y 为静止+呼吸（防漂移）
       ★ IK 动作：在动作的 Y 之上叠加呼吸（保留跳跃等垂直运动） */
    if (cen && S.rest && S.rest['センター']) {
      if (pinRoot) {
        cen.position.y = S.rest['センター'].py + breath * 0.075;
      } else {
        cen.position.y += breath * 0.075;
      }
    }

    /* ★★ 2026-10-18 眨眼机制已删除（用户要求：会和表情冲突，以后自主选择再加）
       —— 眼睛只受【动作 morph 轨道】+【表情页滑杆/预设/自动表情】控制 ✅ */

    /* ★★ 2026-10-17：调整台「表情」页的在线调节 —— 必须放在【动作】之后写
       （morph 每帧先被 resetMorphs 清零、再被动作写，我们最后写才生效 ✅）*/
    applyExpr();

  }
  /* ★★ 整体显示时机（配合上面的 mesh.visible=false）—— 用户要求：所有素材就绪才显现
     条件：① GPU 预热完成（贴图已上传 + 着色器已编译）
           ② 站姿已定格 ③ 再等 600ms（物理稳定几帧）
     或 ④ 到兜底时间（S.revealDeadline）强制显示 —— 保证不会一直空着 ✅ */
  if (!S.revealed && S.mesh) {
    /* ★ 用户要求：所有素材就绪才显现 —— uploadCheck() 会逐材质确认贴图已上传到显存，
       没齐返回 false（本帧不显示，下一帧接着催）✅ */
    var _home = S.warmReady && S.poseReadyAt && (Date.now() - S.poseReadyAt > 400) && assetsCheck(gateMats(true), true);
    var _late = S.revealDeadline && Date.now() > S.revealDeadline;
    if (_home || _late) {
      S.revealed = true;
      S.mesh.visible = true;
      applyToonHullState();
      /* ★ 记忆开关：上次开着三渲二 → 这次进场自动恢复 ✅ */
      if (PET_SETTINGS.toonOn && !TOON_ON) { try { setToonOn(true, true); } catch (e_tr) {} }
      /* ★ 调试：pet.html?toon=1 直接开三渲二（无头截图验证用）*/
      try {
        var _q = new URLSearchParams(location.search);
        if (_q.get('toon') === '1') { setToonOn(true); }
        if (_q.get('toon') === '0') { setToonOn(false); }
      } catch (e_q) {}
      /* ★★ 显示前最后一刻，对着【已经对准的相机】再把模型真画两遍（离屏，屏幕上看不见）
         —— 早先那次预热发生在 fitCamera() 之前、相机还没对准 → 只上传了 2 张贴图，
            剩下几张就拖到显示之后分批上传 → 看起来就是"零件一件件冒出来" ❌
         这样处理后：显示的那一帧起，所有材质都已就绪 ✅ */
      try {
        var _rt2 = new THREE.WebGLRenderTarget(64, 64);
        var _prevT = renderer.getRenderTarget();
        for (var _kk = 0; _kk < 2; _kk++) {
          renderer.setRenderTarget(_rt2);
          renderer.render(scene, camera);
        }
        renderer.setRenderTarget(_prevT);
        var _g2 = renderer.getContext();
        if (_g2 && _g2.finish) { _g2.finish(); }
        _rt2.dispose();
        console.log('[pet] 显示前预热：程序数 ' +
                    (renderer.info && renderer.info.programs ? renderer.info.programs.length : '?') +
                    '，贴图数 ' + (renderer.info && renderer.info.memory ? renderer.info.memory.textures : '?'));
      } catch (e3) { console.log('[pet] 显示前预热失败（不影响显示）: ' + e3); }
      /* ★ 诊断：逐材质检查贴图是否真的已上传到显存（未上传的会在显示后分批上传 → 零件分批冒出）*/
      try {
        var _okN = 0, _miss = [];
        S.mesh.traverse(function (o) {
          if (!o.isMesh) return;
          var arr = Array.isArray(o.material) ? o.material : [o.material];
          for (var _i2 = 0; _i2 < arr.length; _i2++) {
            var _mm = arr[_i2];
            if (!_mm) continue;
            var _pr = (renderer.properties && _mm.map) ? renderer.properties.get(_mm.map) : null;
            var _up = !!(_pr && _pr.__webglTexture);
            if (_up || !_mm.map) { _okN++; } else { _miss.push((_mm.name || '?') + (_mm.visible ? '' : '(隐藏)')); }
          }
        });
        console.log('[pet] 贴图上传检查：已就绪 ' + _okN + ' 个材质，未上传 ' +
                    _miss.length + ' 个 → ' + _miss.join(' , '));
      } catch (e4) { console.log('[pet] 贴图检查失败: ' + e4); }
      console.log('[pet] 模型整体显示 ✅（启动到显示 ' +
                  (S.loadT0 ? ((Date.now() - S.loadT0) / 1000).toFixed(1) + 's' : '?') +
                  '，姿势定格后 ' + (S.poseReadyAt ? (Date.now() - S.poseReadyAt) + 'ms' : '兜底触发') + '）');
    }
  }
  /* ★ 诊断：显示之后头 20 帧各自的渲染耗时（若仍有"零件一件件冒出来"，这里会看到长帧）*/
  var _rt0 = (window.performance && performance.now) ? performance.now() : Date.now();
  renderScene();                              /* ★ 含对比度/高光/阴影后处理 ✅ */
  if (S.revealed && (S._fAfter = (S._fAfter || 0) + 1) <= 20) {
    var _rms = ((window.performance && performance.now) ? performance.now() : Date.now()) - _rt0;
    console.log('[pet] 显示后第 ' + S._fAfter + ' 帧: 渲染 ' + _rms.toFixed(1) + 'ms');
  }
  /* ★ 逐像素命中测试用的位图：必须在 render() 之后、同一帧内 readPixels，
     否则 WebGL 的 drawingBuffer 已经被合成掉，读出来全是 0
     ⚠️ 频率从 1.5 秒放宽到 3 秒：这一次调用要读 4MB + 跑 100 万次循环，
        是明显的单帧卡顿 → 会让物理 dt 变大 → 衣物抽一下
        （位图只影响"挡鼠标的范围"贴合度，慢一点完全看不出来）*/
  /* ★ 2026-10-21（内存/卡顿优化）：从「固定每 3 秒」改成「轮廓变了才读」——
     · 包围盒签名（sendBox 里 16px 量化的那个）变了 → 立刻重读（换动作/拖动/换衣）
     · 没变（待机呼吸/眨眼/裙摆微摆）→ 最长 8 秒兜底一次
     readPixels 本身要 flush 并等 GPU 画完这一帧（单帧 5~20ms 同步等待），
     那才是"物理 dt 变大 → 衣物抽一下"的根源；少读一次就少卡一次 ✅ */
  var _sigNow = S._boxSig || null;
  var _needMask = false;
  if (!_maskSig) { _needMask = (now - _maskLast > 1.0); }        /* 首次：1 秒后读一次 */
  else if (_sigNow && _sigNow !== _maskSig) { _needMask = true; } /* 轮廓变了 → 立刻 */
  else if (now - _maskLast > 8.0) { _needMask = true; }           /* 兜底 8 秒 */
  if (_needMask) {
    if (_sigNow) { _maskSig = _sigNow; }
    _maskLast = now;
    sendAlphaMask();
  }
}

/* rAF 主循环 */
function rafLoop() {
  requestAnimationFrame(rafLoop);
  frame();
}
rafLoop();

window.addEventListener('resize', fitCamera);
