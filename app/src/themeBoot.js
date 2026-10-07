// 主题启动脚本（**经典脚本**，必须放在 <head> 里且不能是 module）
// 目的：在浏览器**首次绘制之前**就把 data-theme 定好，避免"先按 HTML 里的占位色画一帧、
//       再被 initTheme() 改成用户真正选的主题"造成的闪烁（settings.html 原来写死 dark，
//       浅色用户打开设置页会先闪一下深色）。
//
// 与 theme.js 的关系（避免"同一份逻辑抄两遍"）：
//   · 唯一的**事实来源**仍是 theme.js（initTheme/setTheme + 同一个存储键）；
//   · 这个文件只在"模块还没执行"的那一小段时间里做同一件事的最小版本：
//     读同一个键 → 取三个合法值之一 → 写 data-theme。
//   · 合法值与默认值必须与 theme.js 的 initTheme() 保持一致：
//     合法 = dark | system | light，默认 = light。
//     若以后改默认值，两处都要改 —— 这一点写在两边的注释里，并由
//     tests/check-page-separation.mjs（页面一致性检查）盯着。
//
// ★ 主题已按账号分键（见 src/userScope.js 的 readUserValue）：已登录时真实键名是
//   interweaver.u<id>.theme。本文件因此要在这里做**同一套解析**，否则登录用户每次开页
//   都会先用默认主题画一帧、再被 initTheme() 改成自己的主题 —— 那正是本文件要消灭的闪烁。
//   回退规则与 readUserValue 一致：只有"这份旧全局键还没归属任何账号、且这台浏览器
//   上一个主人就是当前账号（或从没有过账号）"时才读它，绝不把别人的主题画给自己。
(function () {
  var KEY = 'interweaver.theme';        // 与 theme.js 的 STORAGE_KEY 相同
  var AUTH_KEY = 'interweaver.auth.v1';  // 与 userScope.js 的 AUTH_KEY 相同（记住 token 属于谁）
  var SCOPE_KEY = 'interweaver.scope.v1';// 与 userScope.js 的 SCOPE_KEY 相同（归属记录）
  var mode = 'light';                    // 与 initTheme() 的默认值相同
  try {
    var saved = null;
    var uid = 0;
    try { var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); uid = Number(a && a.userId) || 0; } catch (e) { uid = 0; }
    if (uid === 0) {
      saved = localStorage.getItem(KEY);                 // 访客：命名空间就是全局键（与 readUserValue 等价）
    } else {
      saved = localStorage.getItem('interweaver.u' + uid + '.theme');
      if (saved === null) {
        // 本账号还没有主题 → 只在"这份旧全局键还没归属任何账号、且上一个主人就是本人"时回退
        var sc = null;
        try { sc = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null'); } catch (e) { sc = null; }
        var claims = (sc && sc.claims) || {};
        var last = Number(sc && sc.lastUserId) || 0;
        if (claims[KEY] === undefined && (last === 0 || last === uid)) saved = localStorage.getItem(KEY);
      }
    }
    if (saved === 'dark' || saved === 'system' || saved === 'light') mode = saved;
  } catch (e) { /* 隐私模式等取不到就退回默认 */ }
  // system：跟随系统偏好（与 theme.js 的 apply() 同规则）
  if (mode === 'system') {
    try {
      mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (e) { mode = 'light'; }
  }
  document.documentElement.dataset.theme = mode;
})();
