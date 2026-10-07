// 主题启动脚本（**经典脚本**，必须放在 <head> 里且不能是 module）
// 目的：在浏览器**首次绘制之前**就把 data-theme 定好，避免"先按 HTML 里的占位色画一帧、
//       再被 initTheme() 改成用户真正选的主题"造成的闪烁（settings.html 原来写死 dark，
//       浅色用户打开设置页会先闪一下深色）。
//
// 与 theme.js 的关系（避免"同一份逻辑抄两遍"）：
//   · 唯一的**事实来源**仍是 theme.js（initTheme/setTheme + 同一个存储键）；
//   · 这个文件只在"模块还没执行"的那一小段时间里做同一件事的最小版本：
//     读同一个键 → 取三个合法值之一 → 写 data-theme。
//   · 合法值与解析顺序必须与 theme.js 的 resolvePageMode() 保持一致：
//     合法 = dark | system | light；
//     ① 本页覆盖 interweaver.pagetheme.<页面id> → ② 全局默认 interweaver.theme
//     → ③ 页面默认（starmap = dark，其它 = light）。
//     若以后改默认值，两处都要改 —— 这一点写在两边的注释里。
//
// ★★ 本轮新增（用户要求）：**逐页主题** + **跨页横扫动画**。
//   · 逐页：页面 id 由路径推出来（不写死清单），所以以后新增 xxx.html 自动就有自己的主题键；
//   · 横扫：本脚本还是唯一在首绘前知道"上一页画的是什么主题"的地方
//     （sessionStorage 记录，同标签页跨页保留）→ 主题不同就在**首绘之后**叫一次
//     theme.js 的 finishPendingTheme()（软边横扫），动画实现只有那一份（这里不抄第二遍）。
//
// ★ 主题已按账号分键（见 src/userScope.js 的 readUserValue）：已登录时真实键名是
//   interweaver.u<id>.theme。本文件因此要在这里做**同一套解析**，否则登录用户每次开页
//   都会先用默认主题画一帧、再被 initTheme() 改成自己的主题 —— 那正是本文件要消灭的闪烁。
//   回退规则与 readUserValue 一致：只有"这份旧全局键还没归属任何账号、且这台浏览器
//   上一个主人就是当前账号（或从没有过账号）"时才读它，绝不把别人的主题画给自己。
(function () {
  // ---------- 与 theme.js 逐条对齐的常量（改一处必须改两处）----------
  var KEY = 'interweaver.theme';         // 全局默认（②）：沿用老的全局键，不做搬迁
  var PAGE_PREFIX = 'interweaver.pagetheme.';  // ① 本页覆盖：interweaver.pagetheme.<页面id>
  var AUTH_KEY = 'interweaver.auth.v1';  // 与 userScope.js 的 AUTH_KEY 相同（记住 token 属于谁）
  var SCOPE_KEY = 'interweaver.scope.v1';// 与 userScope.js 的 SCOPE_KEY 相同（归属记录）
  var WIPE_KEY = 'interweaver.wipe.v1';  // 本标签页"上一次画出来的主题"（跨页横扫据此判断）
  var DEFAULT_MODE = 'light';            // ③ 非成就页的默认（与 theme.js 的 DEFAULT_MODE 相同）
  var PAGE_DEFAULT = { starmap: 'dark' }; // ③ 用户要求：新账号的成就页默认深色
  var VALID = { dark: 1, light: 1, system: 1 };

  // ★ 页面 id 由**路径**推出来（与 theme.js 的 pageIdOf 同一规则）：
  //   以后新增 xxx.html 自动就有自己的主题键，不需要改这个文件。
  function pageId() {
    var p = String((window.location && window.location.pathname) || '');
    var parts = p.split('/'), last = '';
    for (var i = parts.length - 1; i >= 0; i--) { if (parts[i]) { last = parts[i]; break; } }
    if (!last) return 'index';
    last = last.replace(/\.html?$/i, '').toLowerCase();
    return /^[a-z0-9_-]+$/.test(last) ? last : 'index';
  }

  var pid = pageId();
  var mode = null;
  try {
    // ---------- 账号命名空间（与 userScope.readUserValue 同一套规则）----------
    var uid = 0;
    try { var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); uid = Number(a && a.userId) || 0; } catch (e) { uid = 0; }
    var claims = {}, lastUser = 0;
    try {
      var sc = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null');
      claims = (sc && sc.claims) || {};
      lastUser = Number(sc && sc.lastUserId) || 0;
    } catch (e) { claims = {}; lastUser = 0; }
    // 读一个"用户数据键"：已登录 → 本账号命名空间；没有就只在"这份旧全局键还没归属别人"时回退
    var readUser = function (base) {
      try {
        if (uid === 0) return localStorage.getItem(base);            // 访客：命名空间就是全局键
        var m = /^interweaver\.(.+)$/.exec(base);
        var v = localStorage.getItem('interweaver.u' + uid + '.' + (m ? m[1] : base));
        if (v !== null) return v;
        if (claims[base] !== undefined) return null;                 // 已归属某人
        if (lastUser !== 0 && lastUser !== uid) return null;         // 这台浏览器上一个主人是别人
        return localStorage.getItem(base);
      } catch (e) { return null; }
    };
    // ---------- ① 本页覆盖 → ② 全局默认 → ③ 页面默认 ----------
    mode = readUser(PAGE_PREFIX + pid);
    if (!VALID[mode]) mode = readUser(KEY);
    if (!VALID[mode]) mode = PAGE_DEFAULT[pid] || DEFAULT_MODE;
  } catch (e) { /* 隐私模式等取不到就退回默认 */ }
  if (!VALID[mode]) mode = PAGE_DEFAULT[pid] || DEFAULT_MODE;
  // system：跟随系统偏好（与 theme.js 的 themeIdOf() 同规则）
  if (mode === 'system') {
    try {
      mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (e) { mode = 'light'; }
  }

  // ---------- 跨页横扫（用户要求：换页且主题不同 → 新页面**先按上一页的主题画出来**，
  //            再从左上角软软地漫到右下角，结束时才是新主题）----------
  // 本脚本只做三件事：① 首绘前就把"上一页的样子"画上（动画起点，不闪）；
  //                  ② 把"待播的切换"交给 theme.js（window.__IW_THEME_SWITCH）；
  //                  ③ 首绘之后叫它播（动画实现只有 theme.js 那一份）。
  // 直接打开本页（同标签页没有上一页）或主题本来就一样 → 立刻按本页主题画，不做过渡。
  var toPaint = mode, pendingTo = null;
  try {
    var prev = sessionStorage.getItem(WIPE_KEY);
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reduce = false; }
    if (prev && prev !== mode && prev !== 'system' && !reduce) {
      toPaint = prev;                    // ① 动画起点 = 上一页画出来的主题
      pendingTo = mode;                  // 目标主题等横扫结束那一帧再落定（theme.js 的 paint()）
    }
    sessionStorage.setItem(WIPE_KEY, toPaint);   // 记下"这一页此刻画的是什么"（结束时 theme.js 会更新）
  } catch (e) { /* 隐私模式：没有 sessionStorage 就不播跨页动画，直接按本页主题画 */ }
  document.documentElement.dataset.theme = toPaint;

  if (pendingTo) {
    window.__IW_THEME_SWITCH = { from: toPaint, to: pendingTo };
    var SELF = (document.currentScript && document.currentScript.src) || '';
    var themeUrl = '';
    try { themeUrl = new URL('theme.js', SELF || window.location.href).href; } catch (e) { themeUrl = './src/theme.js'; }
    var play = function () {
      import(themeUrl).then(function (T) {
        try { T.finishPendingTheme(); } catch (e) { /* 动画失败不影响主题落定（theme.js 里另有兜底） */ }
      }).catch(function () { /* 拿不到模块：theme.js 的 initTheme 里有 2.5s 兜底，不会停在旧主题 */ });
    };
    var arm = function () { requestAnimationFrame(function () { requestAnimationFrame(play); }); };
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm);
  }
})();
