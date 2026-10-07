// 核验：星图节点是否按"中心点"对齐（布局给出的 (x,y) 是中心）
//
// 判据（两条，都是数字）：
//   ① 计算样式 transform 不是单位矩阵 matrix(1,0,0,1,0,0)  → 说明 translate(-50%,-50%) 生效了
//   ② 节点的屏幕中心 ≈ 布局坐标 × 相机 scale + 相机平移 的期望值，偏差 ≤ 3px
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 2400));   // 等入场动画结束

const res = await page.evaluate(() => {
  const cam = window.__IW.starmapCam.get();
  const viewRect = document.querySelector('#starMap .smView').getBoundingClientRect();
  const nodes = [...document.querySelectorAll('#starMap .smNode')];
  const rows = nodes.map((el) => {
    const r = el.getBoundingClientRect();
    const lx = parseFloat(el.style.left), ly = parseFloat(el.style.top);
    const expX = viewRect.left + lx * cam.scale + cam.tx;
    const expY = viewRect.top + ly * cam.scale + cam.ty;
    return {
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      expX, expY,
      dx: Math.abs(r.left + r.width / 2 - expX), dy: Math.abs(r.top + r.height / 2 - expY),
      transform: getComputedStyle(el).transform,
    };
  });
  const worst = rows.reduce((m, r) => Math.max(m, r.dx, r.dy), 0);
  return { count: rows.length, worst, sample: rows[0], identity: rows.filter((r) => r.transform === 'matrix(1, 0, 0, 1, 0, 0)').length };
});

console.log('节点数 =', res.count);
console.log('① 计算 transform（首个节点） =', res.sample.transform);
console.log('② 中心偏差最大 =', res.worst.toFixed(2), 'px');
console.log('   样例：节点中心 (', res.sample.cx.toFixed(1), ',', res.sample.cy.toFixed(1), ') vs 期望 (', res.sample.expX.toFixed(1), ',', res.sample.expY.toFixed(1), ')');
console.log('   仍是单位矩阵的节点数 =', res.identity);
console.log('运行时错误 =', errors.length ? errors.slice(0, 2) : '无');

const ok = res.sample.transform !== 'matrix(1, 0, 0, 1, 0, 0)' && res.worst <= 3 && errors.length === 0;
console.log(ok ? '✅ 节点已按中心对齐（数字判据通过）' : '❌ 居中仍未达标');
await browser.close();
process.exit(ok ? 0 : 1);
