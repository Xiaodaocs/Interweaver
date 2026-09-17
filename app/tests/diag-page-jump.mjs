// 取证：拖动成就页时，究竟什么在"跳"。
//
// 用户反馈："打开成就页面，拖动查看的时候，会不断在工作台（主页面）和成就页面之间跳"。
// 本脚本在拖动期间统计三件事：
//   ① #starMap 是否被反复插入/移除（MutationObserver 计数）→ 页面被重建
//   ② 主画布 #cv 是否仍收到 pointerdown/pointermove（事件穿透）→ 工作台仍在响应
//   ③ 拖动期间画布是否被重绘（renderOnce 计数，通过 rAF 采样 canvas 的像素是否变化）
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 1800));

await page.evaluate(() => {
  window.__probe = { added: 0, removed: 0, canvasPointer: 0, canvasWheel: 0, camChanges: 0 };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.id === 'starMap' || (n.querySelector && n.querySelector('#starMap'))) window.__probe.added++;
      for (const n of m.removedNodes) if (n.id === 'starMap' || (n.querySelector && n.querySelector('#starMap'))) window.__probe.removed++;
    }
  });
  obs.observe(document.body, { childList: true, subtree: false });
  const cv = document.getElementById('cv');
  if (cv) {
    cv.addEventListener('pointerdown', () => window.__probe.canvasPointer++, true);
    cv.addEventListener('pointermove', () => window.__probe.canvasPointer++, true);
    cv.addEventListener('wheel', () => window.__probe.canvasWheel++, true);
  }
  const cam = window.__IW.cam;
  let lastX = cam.x, lastY = cam.y, lastZ = cam.z;
  window.__probeTimer = setInterval(() => {
    if (cam.x !== lastX || cam.y !== lastY || cam.z !== lastZ) {
      window.__probe.camChanges++;
      lastX = cam.x; lastY = cam.y; lastZ = cam.z;
    }
  }, 50);
});

// 在星图视图里拖动（模拟用户"拖动查看"）
await page.mouse.move(750, 470);
await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(750 - i * 25, 470 - i * 12); await new Promise((r) => setTimeout(r, 50)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));

// 滚轮缩放
await page.mouse.move(750, 470);
for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 100 }); await new Promise((r) => setTimeout(r, 80)); }
await new Promise((r) => setTimeout(r, 400));

const probe = await page.evaluate(() => {
  clearInterval(window.__probeTimer);
  return window.__probe;
});
console.log('拖动 + 缩放期间：');
console.log('  #starMap 被插入次数 =', probe.added, '（>0 表示页面被重建 ✗）');
console.log('  #starMap 被移除次数 =', probe.removed, '（>0 表示页面被关闭 ✗）');
console.log('  主画布收到指针事件 =', probe.canvasPointer, '（>0 表示事件穿透到工作台 ✗）');
console.log('  主画布收到滚轮 =', probe.canvasWheel, '（>0 表示滚轮穿透 ✗）');
console.log('  相机参数变化次数 =', probe.camChanges, '（>0 表示工作台真的在动 ✗）');
await browser.close();
