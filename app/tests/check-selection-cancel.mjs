// issue #2「选中焦点卡死」的永久检查（已修的那条根因：框选状态泄漏）
//
// 复现与根因（实测，不是推测）：
//   st.boxSelect 原来只在 onPointerUp 的 case 'box' 里清空 ✗
//   而任何"中止手势"的路径都不会清它 ✗：
//     ① 拖框途中按 Esc —— 原先根本没有这个处理 ✗
//     ② 第二根手指落下 → gesture=null，但 boxSelect 没清 ✗
//     ③ onPointerUp 开头 if(!gesture) return —— gesture 已被 ② 清掉时直接早退 ✗ → 也没清
//   → 旧框一直画在画布上 ✓ 下一次点击被当成"继续框选" ✗
//     = 用户描述的"点击即按住 / 要再点一次才能取消 / 点画布只会用框选"✓
//
// 判据（每条都对应一个真实失败模式 ✓）：
//   ① 拖框途中按 Esc → st.boxSelect **必须**变成 null（修复前是 {x0,y0,x1,y1} ✗）
//   ② 松开鼠标后仍是 null ✓
//   ③ Esc 之后工具栏仍可切换 ✓（手势没被卡住 ✓）
//   ④ 常规框选**必须仍然能选中实体** ✓（防止把功能改坏 ✗ —— 这条和我修的那条同等重要）
//   ⑤ 拖框途中按 Esc 之后，再拖一次框选仍正常工作 ✓（状态真的复位了 ✓）
//   ⑥ 零运行时错误 ✓
//
// 用法：node tests/check-selection-cancel.mjs（需要 5188 上有前端 ✓ 与其它浏览器检查同一约定 ✓）
//   只读检查 ✓ 不写后端 ✓ 不碰真实库 ✓
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const WEB = process.env.IW_WEB || 'http://localhost:5188';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

const openCanvas = async () => {
  await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW, { timeout: 15000 });
  await wait(1200);
};
const boxOf = () => page.evaluate(() => {
  const s = window.__IW.st.boxSelect;
  return s ? { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 } : null;
});
const toolOf = () => page.evaluate(() => window.__IW.st.tool);
const selSize = () => page.evaluate(() => window.__IW.st.selection.size);
const clickTool = async (t) => {
  await page.evaluate((tt) => { const btn = document.querySelector('#toolbar button[data-tool="' + tt + '"]'); if (btn) btn.click(); }, t);
  await wait(150);
  return toolOf();
};

// ── ① 拖框途中按 Esc：boxSelect 必须立刻清空 ──────────────────────────────────
await openCanvas();
await page.mouse.move(300, 300);
await page.mouse.down();
await page.mouse.move(520, 470, { steps: 8 });
const boxWhileDragging = await boxOf();
console.log(`① 拖框中（Esc 前）boxSelect = ${JSON.stringify(boxWhileDragging)}`);
// 拖的过程中本来就应该有框 ✓（先确认框选真的开始了 —— 否则下面的断言毫无意义 ✗）
ok(!!boxWhileDragging, '拖框过程中应当出现 st.boxSelect（框选根本没开始 → 断言无意义）');
await page.keyboard.press('Escape');
await wait(200);
const boxAfterEsc = await boxOf();
console.log(`① 按 Esc 后 boxSelect = ${JSON.stringify(boxAfterEsc)}  （null = 已修复 ✓）`);
ok(boxAfterEsc === null, '拖框途中按 Esc 后 st.boxSelect 必须为 null（修复前会残留 → 画布上旧框不消失 ✗）');

// ── ② 松开后仍是 null ────────────────────────────────────────────────────────
await page.mouse.up();
await wait(250);
const boxAfterUp = await boxOf();
console.log(`② 松开后 boxSelect = ${JSON.stringify(boxAfterUp)}`);
ok(boxAfterUp === null, 'Esc 中止后再松开鼠标，st.boxSelect 仍应为 null');

// ── ③ Esc 之后工具栏仍可切换（手势没卡住）───────────────────────────────────
const t1 = await clickTool('circle');
console.log(`③ Esc 后点「圆」工具 → tool = ${JSON.stringify(t1)}`);
ok(t1 === 'circle', `Esc 中止手势后工具栏应当仍可切换（实测 tool=${t1}）`);

// ── ④ 常规框选仍然能选中实体（防回归 ✓ 这条不能被我的修复弄坏 ✗）─────────────
await openCanvas();
await page.evaluate(() => { const IW = window.__IW; IW.S.addEntity(IW.st, 'point', { x: 0, y: 0 }); IW.renderOnce(); });
await wait(200);
await page.evaluate(() => { const IW = window.__IW; IW.S.setTool ? IW.S.setTool('select') : (IW.st.tool = 'select'); });
await page.evaluate(() => { const btn = document.querySelector('#toolbar button[data-tool="select"]'); if (btn) btn.click(); });
await wait(200);
await page.mouse.move(600, 350);
await page.mouse.down();
await page.mouse.move(820, 560, { steps: 8 });
await page.mouse.up();
await wait(350);
const n1 = await selSize();
const box4 = await boxOf();
console.log(`④ 常规框选：选中实体数 = ${n1} · 松手后 boxSelect = ${JSON.stringify(box4)}`);
ok(n1 >= 1, `常规框选应当能选中实体（实测 ${n1} 个）—— 不能因为修 Esc 把框选弄坏 ✗`);
ok(box4 === null, '正常框选松手后 st.boxSelect 也必须清空（原来就有这个行为 ✓ 别弄坏 ✗）');

// ── ⑤ Esc 中止后再拖一次框选：状态确实复位了 ───────────────────────────────
await openCanvas();
await page.evaluate(() => { const IW = window.__IW; IW.S.addEntity(IW.st, 'point', { x: 0, y: 0 }); IW.renderOnce(); });
await wait(200);
await page.evaluate(() => { const btn = document.querySelector('#toolbar button[data-tool="select"]'); if (btn) btn.click(); });
await wait(150);
// 先来一次"拖到一半按 Esc 取消"
await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(460, 430, { steps: 6 });
await page.keyboard.press('Escape'); await wait(150); await page.mouse.up(); await wait(200);
// 再正常框选一次（应能选中）
await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(830, 570, { steps: 8 }); await page.mouse.up();
await wait(350);
const n2 = await selSize();
console.log(`⑤ Esc 取消后再框选：选中实体数 = ${n2}`);
ok(n2 >= 1, `Esc 取消一次之后，下一次框选应当仍能正常工作（实测选中 ${n2} 个）`);

// ── ⑥ 运行时错误 ─────────────────────────────────────────────────────────────
ok(pageErrors.length === 0, '页面运行时错误：' + JSON.stringify(pageErrors.slice(0, 3)));

await page.screenshot({ path: 'tests/artifacts/selection-cancel.png', fullPage: false }).catch(() => {});
await browser.close();

if (bad.length) {
  console.log('❌ 未通过：');
  for (const m of bad) console.log('   - ' + m);
  process.exit(1);
}
console.log('✅ 通过：拖框途中按 Esc 会清空框选状态（不再残留旧框），Esc 后工具栏可切换，常规框选与 Esc 后的再次框选都正常，零运行时错误');
