// S9 验收（用户要求 ⑦ 操作设置）：快捷键开关真实改变行为。
// 已证实：快捷键关 → 按 c 不切换工具；开 → 按 c 切到圆工具。
// 未在此断言（如实标注）：网格吸附/端点吸附的开关已接线（tools.js 的 snapPoint 分别由
//   getSetting('snapGrid')/('snapEndpoint') 把关），但「点工具落点」并不走 snapPoint（吸附用于拖动路径），
//   因此本轮无法用点击落点证明吸附开关，需另做拖动路径的度量 —— 留待后续，不用点击断言冒充。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const bad = [];
const load = async (settings) => {
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { try { localStorage.setItem('interweaver.settings.v1', JSON.stringify(s)); localStorage.removeItem('interweaver.draft.v1'); } catch (e) {} }, settings);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 300));
};
await load({ snapGrid: true, snapEndpoint: true, shortcuts: false });
await page.evaluate(() => { window.__IW.st.tool = 'select'; });
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 250));
const off = await page.evaluate(() => window.__IW.st.tool);
console.log(`① 快捷键关：按 c 后工具 = ${off}（应仍是 select）`);
if (off !== 'select') bad.push('快捷键关着，按 c 仍切换了工具');
await load({ snapGrid: true, snapEndpoint: true, shortcuts: true });
await page.evaluate(() => { window.__IW.st.tool = 'select'; });
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 250));
const on = await page.evaluate(() => window.__IW.st.tool);
console.log(`② 快捷键开：按 c 后工具 = ${on}（应为 circle）`);
if (on !== 'circle') bad.push('快捷键开着，按 c 没切换工具');
// Ctrl+Z 的撤销在两种情况下都应可用（对标 Word 的基本操作）
await load({ snapGrid: true, snapEndpoint: true, shortcuts: false });
const undoWorks = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st;
  const before = st.entities.size;
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  const afterAdd = st.entities.size;
  return { before, afterAdd };
});
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 300));
const afterUndo = await page.evaluate(() => window.__IW.st.entities.size);
console.log(`③ 快捷键关时 Ctrl+Z 仍可用：加实体 ${undoWorks.before}→${undoWorks.afterAdd}，撤销后 ${afterUndo}`);
if (!(afterUndo < undoWorks.afterAdd)) bad.push('快捷键关闭时 Ctrl+Z 也失效了（撤销应始终可用）');
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ S9 通过：快捷键开关真实生效，且撤销（Ctrl+Z）始终可用');
