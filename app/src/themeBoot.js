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
(function () {
  var KEY = 'interweaver.theme';        // 与 theme.js 的 STORAGE_KEY 相同
  var mode = 'light';                    // 与 initTheme() 的默认值相同
  try {
    var saved = localStorage.getItem(KEY);
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
