// 用户要求：优化渲染，保证**缩小和移动画面的时候不会有元素丢失**。
//
// 本脚本把"元素不丢失"变成常驻断言（此前的两个真 bug 都是这类：
//   · `contain: paint` 把节点裁掉（T5 抓到）
//   · `will-change: transform` 把整块 2845×3258 画布提升为合成层，DPR=2 时纹理约 5690×6516，
//     超过部分 GPU 的 4096 上限 → 超出区域被丢弃）
//
// 判据（逐步操作，每步都必须成立）：
//   ① 节点/折线/徽标 SVG 数量在"打开 → 全览 → 拖动 → 滚轮缩小"全过程中**保持不变**
//   ② 任何元素的屏幕尺寸不得退化为 0（被裁掉/隐藏）
//   ③ 元素不得落到画布绘制范围之外（会被裁掉）
//   ④ 0 运行时错误
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('崩溃(async)：' + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const DPR = Number(process.env.DPR || 2);   // 默认按 2 倍屏（多数笔记本）跑，更容易暴露合成层问题
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const measure = () => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('#starMap .smNode')];
  const polys = [...document.querySelectorAll('#starMap polyline')];
  const canvas = document.querySelector('#starMap .smCanvas');
  const cr = canvas.getBoundingClientRect();
  let zero = 0, outside = 0;
  for (const el of [...nodes, ...polys]) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) { zero++; continue; }
    if (r.right < cr.left - 1 || r.left > cr.right + 1 || r.bottom < cr.top - 1 || r.top > cr.bottom + 1) outside++;
  }
  return { nodes: nodes.length, polys: polys.length, svgs: document.querySelectorAll('#starMap .smNode svg').length, zero, outside };
});

const steps = [];
await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 2000));
steps.push(['① 打开', await measure()]);

await page.click('#smFit').catch(() => {});
await new Promise((r) => setTimeout(r, 800));
steps.push(['② 全览（缩小）', await measure()]);

await page.mouse.move(700, 500);
await page.mouse.down();
for (let i = 0; i < 8; i++) { await page.mouse.move(700 - i * 40, 500 - i * 20); await new Promise((r) => setTimeout(r, 40)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
steps.push(['③ 拖动平移', await measure()]);

await page.mouse.move(750, 470);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 120 }); await new Promise((r) => setTimeout(r, 80)); }
await new Promise((r) => setTimeout(r, 600));
steps.push(['④ 滚轮缩小', await measure()]);

const bad = [];
const base = steps[0][1];
for (const [label, s] of steps) {
  console.log(`  · ${label}：节点 ${s.nodes} | 折线 ${s.polys} | 徽标 ${s.svgs} | 零尺寸 ${s.zero} | 越界 ${s.outside}`);
  if (s.nodes !== base.nodes) bad.push(`${label} 节点数变化 ${base.nodes} → ${s.nodes}`);
  if (s.polys !== base.polys) bad.push(`${label} 折线数变化 ${base.polys} → ${s.polys}`);
  if (s.svgs !== base.svgs) bad.push(`${label} 徽标数变化 ${base.svgs} → ${s.svgs}`);
  if (s.zero > 0) bad.push(`${label} 有 ${s.zero} 个元素尺寸退化为 0（被裁掉）`);
  if (s.outside > 0) bad.push(`${label} 有 ${s.outside} 个元素落到画布绘制范围外`);
}
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-zoom-pan.png' });
console.log('截图 → tests/artifacts/check-zoom-pan.png');
if (bad.length) { console.log('❌ 缩放/平移过程中元素丢失：'); for (const b of bad) console.log('   - ' + b); }
else console.log(`✅ 缩放与平移全程无元素丢失（节点 ${base.nodes} / 折线 ${base.polys} / 徽标 ${base.svgs} 恒定，DPR ${DPR}）`);
await browser.close();
process.exit(bad.length ? 1 : 0);
