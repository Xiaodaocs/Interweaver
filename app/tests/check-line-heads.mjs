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

// 接线距离按难度档取（圆 23 / 圆角方 26 / 六边形 29，各 +2 视觉间隙）—— 不再是常量 31。
// 端点接线距离：必须与产品实际使用的一致 —— 产品用 edgeRouting.js 的 TIER_HALF
// = { 1: 23, 2: 26, 3: 29 }（徽标半尺寸）。此前测试写的是"再 +2 视觉间隙"的 25/28/31，
// 与新布线的落点差 2px，判据恰好卡在容差边界（实测 76/144 端点误报）。
const TIER_PAD = { 1: 23, 2: 26, 3: 29 };
const X_TOL = 2;      // 端点与徽标边缘的允许误差
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
    tier: Number(el.dataset.tier) || 3,
  }));
  const bad = [];
  let checked = 0;
  // ★ 布线已改为**神经式曲线**：元素从 polyline 变成 path，端点用 getPointAtLength 取。
  //   端点不再固定在"左右两侧"（旧的正交布线才是），而是**沿连线方向落到徽标盒边界**上 ——
  //   所以判据改成"端点必须在某个徽标盒的边界上"（按难度档的半尺寸，误差 ≤ X_TOL）。
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  for (const pl of paths) {
    let L = 0;
    try { L = pl.getTotalLength(); } catch { continue; }
    if (!L) continue;
    const a = pl.getPointAtLength(0);
    const b = pl.getPointAtLength(L);
    for (const end of [[a.x, a.y], [b.x, b.y]]) {
      checked++;
      const [x, y] = end;
      const hit = nodes.some((n) => {
        const hw = cfg.TIER_PAD[n.tier] || 31;
        const hh = hw;                                    // 徽标盒按正方形处理（与 halfOf 一致）
        const u = Math.abs(x - n.x) / hw;
        const v = Math.abs(y - n.y) / hh;
        // 落在盒边界上：某一维贴边（≈1），另一维不超过 1（在盒内或贴边）
        return Math.abs(Math.max(u, v) - 1) <= cfg.X_TOL / hw && u <= 1 + cfg.X_TOL / hw && v <= 1 + cfg.X_TOL / hh;
      });
      if (!hit) bad.push(`(${Math.round(x)},${Math.round(y)})`);
    }
  }
  return { polys: paths.length, checked, bad: bad.slice(0, 6), badCount: bad.length };
}, { TIER_PAD, X_TOL, Y_RANGE });

console.log(`连线 ${res.polys} 条 | 检查端点 ${res.checked} 个 | 未接在徽标边缘的端点 = ${res.badCount}`);
if (res.badCount) console.log('   例如：' + res.bad.join('  '));
const okAll = res.polys > 0 && res.badCount === 0;
console.log(okAll ? `✅ 所有线头都接在徽标边缘（按难度档 23/26/29，误差 ≤ ${X_TOL}px）` : '❌ 存在没有接到卡片上的线头');
await browser.close();
process.exit(okAll ? 0 : 1);
