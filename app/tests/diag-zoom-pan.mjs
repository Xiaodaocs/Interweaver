// 诊断：缩放与移动画面时，元素是否会丢失。
//
// 用户反馈："保证缩小和移动画面的时候不会有元素丢失"。
// 本脚本逐步操作星图（打开 → 全览缩小 → 拖动平移 → 放大），每一步都统计：
//   · DOM 中节点/折线/徽标 SVG 的数量（是否真的被移除）
//   · 有尺寸为 0 或不可见的元素（是否被裁掉/隐藏）
//   · 可见区域内的元素数量（是否"画不出来"）
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const snap = async (label) => {
  const s = await page.evaluate(() => {
    const q = (sel) => document.querySelectorAll(sel).length;
    const nodes = [...document.querySelectorAll('#starMap .smNode')];
    const polys = [...document.querySelectorAll('#starMap polyline')];
    const zero = [...document.querySelectorAll('#starMap .smNode, #starMap polyline')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 0.5 || r.height < 0.5;
    }).length;
    const hidden = [...document.querySelectorAll('#starMap .smNode')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    }).length;
    const canvas = document.querySelector('#starMap .smCanvas');
    const cs2 = canvas ? getComputedStyle(canvas) : null;
    return {
      nodes: nodes.length, polys: polys.length, svgs: q('#starMap .smNode svg'),
      zeroSize: zero, hidden,
      transform: cs2 ? cs2.transform.slice(0, 44) : null,
      contain: cs2 ? cs2.contain : null,
      willChange: cs2 ? cs2.willChange : null,
      canvasRect: canvas ? (() => { const r = canvas.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    };
  });
  console.log(`${label}：节点 ${s.nodes} | 折线 ${s.polys} | 徽标SVG ${s.svgs} | 零尺寸 ${s.zeroSize} | 隐藏 ${s.hidden}`);
  console.log(`    canvas contain=${s.contain} willChange=${s.willChange} rect=${JSON.stringify(s.canvasRect)}`);
  return s;
};

await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 2000));
await snap('① 刚打开');

// ② 全览（缩小到 0.4×）
await page.click('#smFit').catch(() => {});
await new Promise((r) => setTimeout(r, 900));
await snap('② 全览缩小后');

// ③ 拖动平移（在视图中按下并移动）
await page.mouse.move(700, 500);
await page.mouse.down();
for (let i = 0; i < 8; i++) { await page.mouse.move(700 - i * 40, 500 - i * 20); await new Promise((r) => setTimeout(r, 40)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));
await snap('③ 拖动平移后');

// ④ 滚轮缩小到很小
await page.mouse.move(750, 470);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 120 }); await new Promise((r) => setTimeout(r, 80)); }
await new Promise((r) => setTimeout(r, 700));
await snap('④ 滚轮缩小后');

console.log('运行时错误 =', errors.length ? errors.slice(0, 3) : '无');
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-zoom-pan.png' });
console.log('截图 → tests/artifacts/check-zoom-pan.png');
await browser.close();
