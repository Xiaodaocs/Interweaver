// 验证（用户反馈的两个要求）：
//   ① 成就页与工作台是两个独立页面：打开成就页时，工作台元素整体隐藏 + inert
//   ② 拖动查看时**不会**再误关闭成就页（此前根因：拖动后浏览器补发 click → 命中 root → close()）
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('崩溃(async)：' + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const state = () => page.evaluate(() => {
  const sm = document.getElementById('starMap');
  const cv = document.getElementById('cv');
  const cvVisible = cv ? getComputedStyle(cv).display !== 'none' : null;
  const inertCount = [...document.body.children].filter((e) => e.hasAttribute('inert')).length;
  return { achpage: document.body.classList.contains('achpage'), starMap: !!sm, canvasVisible: cvVisible, inertCount };
});

const bad = [];
const s0 = await state();
console.log('工作台（成就页未打开）：achpage =', s0.achpage, '| 画布可见 =', s0.canvasVisible, '| inert 元素 =', s0.inertCount);
if (s0.canvasVisible !== true) bad.push('工作台状态：画布应可见');

await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 1800));
const s1 = await state();
console.log('成就页打开：achpage =', s1.achpage, '| 画布可见 =', s1.canvasVisible, '| inert 元素 =', s1.inertCount);
if (!s1.achpage) bad.push('打开成就页后 body 应有 achpage 类');
if (s1.canvasVisible !== false) bad.push('打开成就页后工作台画布应隐藏（两页分离）');
if (s1.inertCount === 0) bad.push('打开成就页后工作台元素应置为 inert');

// 关键回归：在星图里拖动（多次），成就页必须始终存在
let closedDuringDrag = 0;
for (let round = 0; round < 3; round++) {
  await page.mouse.move(750, 470);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) { await page.mouse.move(750 - i * 30, 470 - i * 15); await new Promise((r) => setTimeout(r, 45)); }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const alive = await page.evaluate(() => !!document.getElementById('starMap'));
  if (!alive) closedDuringDrag++;
}
console.log('拖动 3 轮后成就页被误关闭次数 =', closedDuringDrag, '（应为 0）');
if (closedDuringDrag > 0) bad.push(`拖动期间成就页被误关闭 ${closedDuringDrag} 次`);

// 点击空白处（非拖动）应当仍能关闭
await page.mouse.click(20, 200);
await new Promise((r) => setTimeout(r, 500));
const stillOpen = await page.evaluate(() => !!document.getElementById('starMap'));
console.log('点击星图边缘（无拖动）后仍在？ =', stillOpen, '（应关闭 → false）');

// Esc 关闭后工作台应恢复
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 600));
const s2 = await state();
console.log('关闭后：achpage =', s2.achpage, '| 画布可见 =', s2.canvasVisible, '| inert 元素 =', s2.inertCount);
if (s2.achpage) bad.push('关闭成就页后应移除 achpage 类');
if (s2.canvasVisible !== true) bad.push('关闭成就页后工作台画布应恢复可见');
if (s2.inertCount !== 0) bad.push('关闭成就页后应清除 inert');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-page-separation.png' });
console.log('截图 → tests/artifacts/check-page-separation.png');
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); }
else console.log('✅ 两页分离生效，且拖动不再误关闭成就页');
await browser.close();
process.exit(bad.length ? 1 : 0);
