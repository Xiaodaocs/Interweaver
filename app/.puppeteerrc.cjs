// Puppeteer 启动配置（项目级）。
//
// 为什么需要它：puppeteer 默认只认自己缓存里那个**特定版本**的 Chrome
// （本机这次是 152.0.7977.75），而缓存位于用户目录下、会因环境变化而消失 ——
// 一旦缺失，整个浏览器测试链会在启动阶段就报
// `Could not find Chrome (ver. …)`，与产品代码无关却很打断验证。
//
// 这里改为：**优先用系统已装的 Chrome**（版本略有差异对测试无影响），
// 探测不到时再交回 puppeteer 自己去找缓存（executablePath 留空即回退默认行为）。
// 因此该文件在任何机器上都是安全的：找不到系统浏览器时行为与不加它完全一致。
const fs = require('fs');

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const found = CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

module.exports = found ? { executablePath: found } : {};
