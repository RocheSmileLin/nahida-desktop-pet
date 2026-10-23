/* ============================================================================
   交互：鼠标跟随、拖动、命中框/位图、右键菜单、标题消息通道
   —— 由原 pet.html 内联脚本按职责拆分；全局符号保持原样，加载顺序不可调换。
   ============================================================================ */

/* ============ 拖放 ============ */
/* ★ 禁止把文件拖进窗口（用户反馈：桌面图片拖到人物模型上 → 模型被图片替换）
   原因：Chromium 只有在 drop 事件【没有】被 preventDefault 时，才会把拖入的
   文件当成一次导航 → 页面跳到 file:///...jpg。这里四个事件全在捕获阶段拦掉，
   页面就不会离开本站。（Python 侧 PetPage.acceptNavigationRequest 是第二道防线） */
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (t) {
  window.addEventListener(t, function (e) {
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'none'; } catch (err) {}
  }, true);
});

/* ============ 鼠标 ============ */
var mouse = { x: 0, y: 0 };
var drag = { on:false, x:0, y:0, acc:0, t:0 };
var menuOpen = false;
var menuEl = document.getElementById('menu');

/* ★ 视觉追踪范围：1000×1000 像素（用户指定，随窗口一起扩大）
     以窗口中心为原点，鼠标在 ±500px 内线性映射到 [-1,1]，超出即 clamp（不扭更多）
   ✅ 窗口本身已经是 1000×1000 → 水平、垂直都能跑满整个行程（以前窗口只有 380 宽，
      水平最多够到 ±190）
   ⚠️ 不用按 innerWidth/Height 归一化：那样窗口一改大小，同样的位置转角就变了 */
var TRACK_W = 1000, TRACK_H = 1000;

/* ★ 由 Python 侧推送光标位置（16ms 定时器）—— 【必需】
   ⚠️ 窗口打了 WS_EX_TRANSPARENT 之后，系统完全不把鼠标消息交给它 →
      mousemove 永远不触发 → 视线跟踪会冻住（用户反馈「视觉跟踪有问题」）
   dx/dy = 光标相对【窗口中心】的偏移（逻辑像素） */
/* ★ 头骨在【屏幕上的像素偏移】（相对窗口中心）——
   视线参考点要用【头部】而不是窗口/模型中心 ✅（用户要求 ②）
   做法：取 頭 骨的世界坐标 → 投影到 NDC → 换算成像素 ✅ */
function _headOffsetPx() {
  var hb = S.bones && S.bones['頭'];
  if (!hb) { return { x: 0, y: 0 }; }
  var v = new THREE.Vector3();
  hb.getWorldPosition(v);
  v.project(camera);                       /* → NDC [-1,1] */
  var w = window.innerWidth || 1000, h = window.innerHeight || 1000;
  return { x: v.x * 0.5 * w, y: -v.y * 0.5 * h };
}

window.petMouseAt = function (dx, dy) {
  /* ★ 一次性证明：能收到超过 ±500 的偏移 → 说明 Python 那道 ±500 硬闸门确实拆掉了 ✅
     （用户实测「400 调到 4000 没变化」= 就是旧闸门在 500px 处截断 ✅）*/
  if (!window._gazeFar && (Math.abs(dx) > 500 || Math.abs(dy) > 500)) {
    window._gazeFar = 1;
    console.log('[pet] 视线已收到超 ±500 的偏移 ' + dx + ',' + dy
                + '（硬闸门已拆除 ✅ TRACK=' + TRACK_W + '）');
  }
  /* ★★ 参考点改成【头部】（用户要求 ②）：Python 给的是"相对窗口中心"的偏移，
        这里减掉头部相对窗口中心的偏移 → 得到"光标相对头部"的偏移 ✅
        （不管人物在画面里怎么摆，都是"从头部看向光标"✅）*/
  var ho = _headOffsetPx();
  dx -= ho.x;
  dy -= ho.y;
  /* ★★ 跟踪范围 =【半径】（用户要求 ①：0~2000 是半径 ✅）
     · 0     → 关闭视线跟踪（不盯 ✅）
     · 半径内 → 线性跟随，到半径处正好是最大转角 ✅
     · 超出半径 → 【不再盯】（回正）—— 这就是用户说的"不论怎么调都是全屏效果"的修法：
       原来那道闸门锁死在 ±500，现在闸门 = 你设的半径 ✅ */
  var R = TRACK_W;
  if (!(R > 0)) { mouse.x = 0; mouse.y = 0; return; }
  if (dx * dx + dy * dy > R * R) {
    if (!window._gazeOut) { window._gazeOut = 1; resetGaze(); }
    return;
  }
  window._gazeOut = 0;
  mouse.x = Math.max(-1, Math.min(1, dx / R));
  mouse.y = Math.max(-1, Math.min(1, dy / R));
};
window.petGazeReset = function () { resetGaze(); };

window.addEventListener('mousemove', function (e) {
  mouse.x = Math.max(-1, Math.min(1, (e.clientX - window.innerWidth  / 2) / (TRACK_W / 2)));
  mouse.y = Math.max(-1, Math.min(1, (e.clientY - window.innerHeight / 2) / (TRACK_H / 2)));
  if (drag.on && !menuOpen) {
    var dx = e.screenX - drag.x, dy = e.screenY - drag.y;
    if (dx || dy) { drag.x = e.screenX; drag.y = e.screenY; }
    /* 累积位移，攒够 3px 且距上次发送 >40ms 才发，避免疯狂触发导航 */
    drag.acc += Math.abs(dx) + Math.abs(dy);
    var nowT = performance.now();
    if (drag.acc >= 3 && nowT - drag.t > 40) {
      var ddx = (e.screenX - drag.ox), ddy = (e.screenY - drag.oy);
      drag.ox = e.screenX; drag.oy = e.screenY;
      drag.acc = 0; drag.t = nowT;
      if (ddx || ddy) send('petdrag://' + ddx + ',' + ddy);
    }
  }
});
window.addEventListener('mousedown', function (e) {
  if (e.button === 0) { drag.on = true; drag.x = e.screenX; drag.y = e.screenY;
                        drag.ox = e.screenX; drag.oy = e.screenY; drag.acc = 0; drag.t = 0; }
});
window.addEventListener('mouseup', function (e) { if (e.button === 0) drag.on = false; });
window.addEventListener('blur', function () { drag.on = false; });

/* ③ 鼠标离开窗口 / 超出跟踪范围 → 视线平滑回到正前方
   （之前只在 mousemove 里更新目标，鼠标一走就卡在最后指的方向上） */
function resetGaze() { mouse.x = 0; mouse.y = 0; }
document.addEventListener('mouseleave', resetGaze);
window.addEventListener('mouseout', function (e) { if (!e.relatedTarget && !e.toElement) resetGaze(); });
window.addEventListener('blur', resetGaze);

/* ★ 把模型的【屏幕包围盒】上报给 Python → 那边 setMask()，只让这一块接收鼠标
   目的：修「鼠标在窗口范围内时点不到下面的东西」——
        原来整个 380×620 的透明窗口都把点击吃掉了；
        以后只有模型那一片接收点击，其余位置的点击直接穿过去（人物照旧可拖可右键）
   ⚠️ 菜单打开时必须上报 full → Python 那边 clearMask()，否则菜单会被裁在包围盒里
   ⚠️ 菜单打开时也【不能】再按模型缩回（所以这里判断 menuOpen 直接返回 full） */
var _boxV = new THREE.Vector3();
function sendBox() {
  try {
    if (typeof menuOpen !== 'undefined' && menuOpen) { send('petbox://full'); return; }
    if (!S.bones) return;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, got = 0;
    for (var n in S.bones) {
      S.bones[n].getWorldPosition(_boxV);
      _boxV.project(camera);
      if (!isFinite(_boxV.x) || !isFinite(_boxV.y)) continue;
      var sx = (_boxV.x + 1) / 2 * window.innerWidth;
      var sy = (1 - _boxV.y) / 2 * window.innerHeight;
      if (sx < minX) { minX = sx; }  if (sx > maxX) { maxX = sx; }
      if (sy < minY) { minY = sy; }  if (sy > maxY) { maxY = sy; }
      got++;
    }
    if (!got) return;
    var pad = 16;                     /* 骨骼投影到"皮肤边缘"还差一点（裙摆/发梢），留 16px 余量
                                         —— 命中框现在只是【判断点击归谁】，不再裁窗口，
                                            所以可以贴紧些，把可点区域让到最大 */
    /* ★ 量化到 16px 网格：呼吸/摆动会让包围盒每秒抖 1~5px，
       不量化就会每次上报都变（刷日志 + Python 端反复改命中框）；
       网格取 16px（> 抖动幅度）就自带迟滞 —— 呼吸抖不到 16px，基本只在换动作时才变 */
    var q = 16;
    var x = Math.max(0, Math.floor((minX - pad) / q) * q);
    var y = Math.max(0, Math.floor((minY - pad) / q) * q);
    var w = Math.ceil((maxX - minX + pad * 2) / q) * q;
    var h = Math.ceil((maxY - minY + pad * 2) / q) * q;
    if (x + w > window.innerWidth)  { w = Math.ceil((window.innerWidth  - x) / q) * q; }
    if (y + h > window.innerHeight) { h = Math.ceil((window.innerHeight - y) / q) * q; }
    if (w < 8 || h < 8) return;       /* 明显不正常的测量就别上报，免得把窗口裁没了 */
    /* ★ 2026-10-21：把量化后的包围盒当“轮廓签名”，供命中位图判断要不要重读
       （包围盒已经量化到 16px 网格 ⇒ 呼吸/微摆抖不动它，只有换动作/位移才变）*/
    S._boxSig = x + ',' + y + ',' + w + ',' + h;
    send('petbox://' + x + ',' + y + ',' + w + ',' + h);
  } catch (e) {}
}
setInterval(sendBox, 400);

/* ★ 逐像素命中测试位图 —— 把画布的 alpha 压成 40×65 的位图发给 Python
   目的：让"挡鼠标的范围"等于【人物实际画到的像素】，而不是一个矩形
        （常规桌宠就是这么做的；用户反馈"矩形里的空白也挡了点击"）
   ⚠️ 必须在 render() 之后、同一帧内 readPixels —— 见 frame() 末尾的调用点
   ⚠️ 格式：petmask://列数,行数,base64(位图)
      位序 = 行优先、自左上角起（Python 端必须按同一顺序解） */
var MASK_COLS = 40;
var _maskLast = 0;
var _maskBuf = null;   /* ★ 复用读像素缓冲区（1000×1000×4 = 4MB，不要每次新建）*/
/* ★★ 2026-10-21（内存/卡顿优化）：
   · MASK_STEP = 2 → 掩码按 1/2 分辨率采样（每格约 1.6 CSS px，
     比早期 40×65 那版（每格 9.5px）精细 6 倍，点发梢/裙边不会失准）
   · _maskSig → 包围盒签名（来自 sendBox 的 16px 量化），静帧时轮廓不变就不必重读
   readPixels 传回的仍是全画布，但循环次数从 156 万降到 39 万，
   掩码位图 195KB → 49KB。真正的大头（GPU 同步等待）靠“少读”来削。*/
var MASK_STEP = 2;
var _maskSig = null;
function sendAlphaMask() {
  try {
    var gl = renderer.getContext ? renderer.getContext() : null;
    if (!gl || !gl.readPixels) { return; }
    var DW = renderer.domElement.width, DH = renderer.domElement.height;
    if (!DW || !DH) { return; }
    /* ⚠️ 缓冲区【复用】：以前每次 new 一个 4MB 的数组（1000×1000×4）
       → 每 1.5 秒制造一次大对象 → GC 抖动 → 也是"衣物小抽动"的来源之一 */
    if (!_maskBuf || _maskBuf.length !== DW * DH * 4) {
      _maskBuf = new Uint8Array(DW * DH * 4);
    }
    var buf = _maskBuf;
    gl.readPixels(0, 0, DW, DH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    /* ★ 真正的逐像素：画布每个像素占一位，全分辨率不下采样
       （40×65 那版每格约 9.5px，人物边缘会多挡一圈空白 —— 用户反馈"边缘空白仍点不到"）
       α > 16 就算"有人物"（别用太高的阈值，否则半透明的发梢/裙边会被判成空）
       ★ 2026-10-21：改为 1/2 步长采样（每格 ~1.6 CSS px，精度足够，循环降 4 倍）*/
    var MW = Math.ceil(DW / MASK_STEP), MH = Math.ceil(DH / MASK_STEP);
    var bits = new Uint8Array((MW * MH + 7) >> 3);
    for (var y = 0; y < MH; y++) {
      var srcRow = (DH - 1 - y * MASK_STEP) * DW;   /* WebGL 自下往上 → 翻成自上往下 */
      for (var x = 0; x < MW; x++) {
        if (buf[(srcRow + x * MASK_STEP) * 4 + 3] > 16) {
          var bi = y * MW + x;
          bits[bi >> 3] |= (1 << (bi & 7));
        }
      }
    }
    /* ⚠️ 全分辨率约 19KB，走 URL/title 都不合适 → 用 POST 把二进制体直接打过来 */
    fetch('/petmask?w=' + MW + '&h=' + MH,
          { method: 'POST', body: bits, cache: 'no-store' }).catch(function () {});
  } catch (e) {}
}

window.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  menuOpen = true;
  menuEl.innerHTML = '';
  /* ★★ 先让菜单可见、再往里填内容（2026-10-23 修）：
     原来 display 是在函数末尾才设的 —— 只要中途任何一处抛异常
     （典型：MOTION_GROUP_DEFS 的下标越界，POSES[i] 为 undefined），
     菜单就永远不显示，看起来就是「右键没反应」❌ 现在先显示，出错也还在 ✅ */
  menuEl.style.display = 'block';
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';

  function addItem(label, cmd) {
    var d = document.createElement('div');
    d.textContent = label;
    d.onclick = function () {
      menuEl.style.display = 'none'; menuOpen = false;
      if (cmd.indexOf('pose:') === 0) { setPose(parseInt(cmd.slice(5), 10)); return; }  // 换姿势在页面内处理
      if (cmd.indexOf('physics:') === 0) { setPhysics(cmd.slice(8) === '1'); return; }   // 物理开关也在页面内处理
      if (cmd.indexOf('toon:') === 0) { setToonOn(cmd.slice(5) === '1'); return; }        // 三渲二开关也在页面内处理
      send('petcmd://' + cmd);
    };
    menuEl.appendChild(d);
  }
  function addSep(text) {
    var d = document.createElement('div');
    d.textContent = text;
    d.className = 'sep';
    menuEl.appendChild(d);
  }

  addItem('放大', 'scale+');
  addItem('缩小', 'scale-');
  addItem('复位位置', 'reset');
  addSep('— ' + GROUPS[GROUP_INIT][0].replace(/^—\s*|\s*—$/g, '') + '（当前：'
         + ((POSES[S.poseIndex] || ['?'])[0]) + '）—');

  /* 姿势用两列网格 —— 单列在 380×618 的小窗里会超出屏幕（用户反馈"列表显示不全"）
     list 里放的是 POSES 的下标（GROUPS 里直接写下标，改顺序不用改代码） */
  function addPoseGrid(idxs, showSep) {
    var grid = document.createElement('div');
    grid.className = 'poses';
    idxs.forEach(function (i) {
      if (!POSES[i]) { return; }   /* ★ 动作被删后分组下标可能越界 → 跳过这一项，别让整个右键菜单崩掉 ✅ */
      var d = document.createElement('div');
      d.textContent = (i === S.poseIndex ? '● ' : '') + POSES[i][0];
      d.onclick = function () {
        menuEl.style.display = 'none'; menuOpen = false;
        setPose(i);
      };
      grid.appendChild(d);
    });
    menuEl.appendChild(grid);
  }
  /* 分组渲染：待机（拆成两段）/ 其他（自然站立、喵喵喵） */
  GROUPS.forEach(function (g, gi) {
    if (gi > 0) addSep(g[0]);
    addPoseGrid(g[1], gi > 0);
  });

  /* ★ 物理效果开关（衣物 / 头发的自然摆动）—— 页面内处理，不走 petcmd
     用户要求「加一点物理效果」；Ammo 没就绪时显示提示，点了也不会崩 */
  var _pfx = physicsUsable();
  /* ★ 物理效果 / 三渲二 开关 —— 并排放一行（多加一行会把「重启桌宠/退出」挤出窗口 ✅）*/
  var _tg = document.createElement('div');
  _tg.className = 'poses';
  var _d1 = document.createElement('div');
  _d1.textContent = _pfx ? '● 物理：开' : '○ 物理：关';
  _d1.title = AMMO_MODULE ? '衣物/头发物理摆动' : 'Ammo 未就绪';
  _d1.onclick = function () {
    menuEl.style.display = 'none'; menuOpen = false;
    setPhysics(!_pfx);
  };
  var _d2 = document.createElement('div');
  _d2.textContent = TOON_ON ? '● 三渲二：开' : '○ 三渲二：关';
  _d2.title = '原神风三渲二（彩色色阶 + 描边）';
  _d2.onclick = function () {
    menuEl.style.display = 'none'; menuOpen = false;
    setToonOn(!TOON_ON);
  };
  _tg.appendChild(_d1); _tg.appendChild(_d2);
  menuEl.appendChild(_tg);

  /* ★ 物理强度三档（弱 / 中 / 强）—— 直接改重力，点一下立即生效 */
  addSep('— 物理强度（当前：' + PHYSICS_LEVELS[PHYSICS_LEVEL][0] + '）—');
  var _pg = document.createElement('div');
  _pg.className = 'poses';
  PHYSICS_LEVELS.forEach(function (lv, i) {
    var d = document.createElement('div');
    d.textContent = (i === PHYSICS_LEVEL ? '● ' : '') + lv[0];
    d.onclick = function () {
      menuEl.style.display = 'none'; menuOpen = false;
      setPhysicsLevel(i);
    };
    _pg.appendChild(d);
  });
  menuEl.appendChild(_pg);

  addSep('');
  /* ★ 跳转到调整台（settings.html）—— 宿主用系统默认浏览器打开 :8810 ✅ */
  addItem('打开调整台 ⚙', 'settings');
  /* ★ 重启桌宠（任务2）：宿主重开一个新实例 —— 改完模型/贴图/设置后不用手动关掉再双击 ✅ */
  addItem('重启桌宠 🔄', 'restart');
  addItem('退出', 'quit');

  /* ★★ 菜单定位：先量实际尺寸，再夹进【屏幕可用区 ∩ 窗口】里
     ⚠️ 只夹窗口是不够的：窗口本身可能有一部分在屏幕外（拖到屏幕边缘后）
        → 菜单会跟着跑到屏幕外 ❌
     屏幕坐标系：window.screenX / screenY = 窗口左上角在屏幕上的位置（CSS px）✅ */
  /* ★ 每次打开先清掉【上次】可能设的限高/滚动条
     ⚠️ 否则一旦某次被限高过，之后每次打开都带着它 → 菜单看起来被压扁（用户反馈"缩放有问题"）✅ */
  menuEl.style.maxHeight = '';
  menuEl.style.overflowY = '';
  menuEl.style.left = '0px';
  menuEl.style.top  = '0px';
  menuEl.style.display = 'block';
  var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;

  /* 窗口在屏幕上的位置；个别内核给 0 → 退化成"只夹窗口"（老行为）✅ */
  var winX = (typeof window.screenX === 'number') ? window.screenX : 0;
  var winY = (typeof window.screenY === 'number') ? window.screenY : 0;
  var scrW = (window.screen && screen.availWidth)  ? screen.availWidth  : window.innerWidth;
  var scrH = (window.screen && screen.availHeight) ? screen.availHeight : window.innerHeight;

  /* ① 菜单高度不能超过"窗口在屏幕内的可见高度"（超了就设 max-height，内部滚动）
     ⚠️ 减 20 而不是 8：max-height 管的是【内容盒】，还要加 padding(4×2)+border(1×2) 才等于实际高度 ✅ */
  var visH = Math.min(window.innerHeight, scrH - winY);
  if (mh > visH - 20) {
    menuEl.style.maxHeight = Math.max(80, visH - 20) + 'px';
    menuEl.style.overflowY = 'auto';
    mh = menuEl.offsetHeight;
  }

  /* ② 夹到 屏幕可用区 ∩ 窗口（换算成页面内的 left/top ✅）*/
  var loL = Math.max(4, -winX);                                          /* 不超出屏幕左 */
  var hiL = Math.min(window.innerWidth  - mw - 4, scrW - winX - mw - 4); /* 不超出窗口右 / 屏幕右 */
  var loT = Math.max(4, -winY);
  var hiT = Math.min(window.innerHeight - mh - 4, scrH - winY - mh - 4);
  var px = (hiL < loL) ? loL : Math.max(loL, Math.min(e.clientX, hiL));
  var py = (hiT < loT) ? loT : Math.max(loT, Math.min(e.clientY, hiT));
  menuEl.style.left = px + 'px';
  menuEl.style.top  = py + 'px';

  console.log('[pet] 菜单定位：窗口(' + winX + ',' + winY + ') 尺寸' + window.innerWidth + 'x' + window.innerHeight
              + ' 屏幕可用' + scrW + 'x' + scrH + ' 菜单' + mw + 'x' + mh
              + ' → (' + px + ',' + py + ')');

  /* ★ 供宿主(Python)调用：点桌面别处时关掉菜单 ✅ */
  window.petCloseMenu = function () {
    if (menuEl) menuEl.style.display = 'none';
    menuOpen = false;
    send('petmenu://close');
  };
  /* ★ 告诉宿主"菜单开了"：宿主开始用 GetAsyncKeyState 监听【窗口外】的点击 ✅ */
  send('petmenu://open');
});
window.addEventListener('click', function () {
  if (menuOpen) { menuEl.style.display = 'none'; menuOpen = false; send('petmenu://close'); }
});

/* 消息通道：改 document.title（Python 端监听 titleChanged）
   —— 比 location.href 干净：不触发导航，不会产生"页面加载失败"假错误 */
var _tick = 0;
function send(msg) {
  document.title = msg + '#' + (_tick++ % 10000);
  setTimeout(function () { document.title = '纳西妲桌宠'; }, 0);
}
