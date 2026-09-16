// 用户要求 ④：确保线的头**完美连接到了成就卡片上而不是旁边**。
//
// 判据（在世界坐标里算，不受缩放影响）：
//   每条折线的**首点与末点**，都必须落在某个节点的"徽标边缘"上：
//     · x 方向：| |x - 节点x| - PORT_PAD(31) | ≤ 2px   （31 = 最大徽标半宽 29 + 2）
//     · y 方向：|y - 节点y| ≤ 120px                     （允许端口逃逸到扇出档位）
//   若某端点找不到任何一个满足条件的节点，就说明它"悬在旁边"或"戳进卡片里"。
//
// 运行：node tests/check-line-heads.mjs
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('崩溃(async)：' + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const PORT_PAD = 31;
const X_TOL = 2;      // 端点 x 与徽标边缘的允许误差
const Y_RANGE = 120;  // 端口可在徽标范围内上下扇出

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 2200));

const res = await page.evaluate((cfg) => {
  const nodes = [...document.querySelectorAll('#starMap .smNode')].map((el) => ({
    x: parseFloat(el.style.left), y: parseFloat(el.style.top),
    w: el.getBoundingClientRect().width,
  }));
  const bad = [];
  let checked = 0;
  const polys = [...document.querySelectorAll('#starMap polyline')];
  for (const pl of polys) {
    const pts = (pl.getAttribute('points') || '').trim().split(/\s+/).map((s) => s.split(',').map(Number));
    if (pts.length < 2) continue;
    for (const end of [pts[0], pts[pts.length - 1]]) {
      checked++;
      const [x, y] = end;
      const hit = nodes.some((n) => Math.abs(Math.abs(x - n.x) - cfg.PORT_PAD) <= cfg.X_TOL && Math.abs(y - n.y) <= cfg.Y_RANGE);
      if (!hit) bad.push(`(${Math.round(x)},${Math.round(y)})`);
    }
  }
  return { polys: polys.length, checked, bad: bad.slice(0, 6), badCount: bad.length };
}, { PORT_PAD, X_TOL, Y_RANGE });

console.log(`折线 ${res.polys} 条 | 检查端点 ${res.checked} 个 | 未接到徽标边缘的端点 = ${res.badCount}`);
if (res.badCount) console.log('   例如：' + res.bad.join('  '));
const okAll = res.polys > 0 && res.badCount === 0;
console.log(okAll ? `✅ 所有线头都接在徽标边缘（| 偏移 - ${PORT_PAD} | ≤ ${X_TOL}px）` : '❌ 存在没有接到卡片上的线头');
await browser.close();
process.exit(okAll ? 0 : 1);
