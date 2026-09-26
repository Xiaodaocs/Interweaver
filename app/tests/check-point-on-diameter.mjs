// 验收（用户报告第 2 项）：点工具点在圆的**直径线上**时，应落一个**普通点**（就在你点的位置），
//   而不是挂到圆上、吸到圆周最近点。点在**圆周上**时仍应正常挂成「圆上的线上点」。
//
// 根因：circle.hit 把水平直径当"拖动条"、圆心附近也算 body（有意的拖动热区），
//       而建点分支只看 hitTest 命中 → 于是直径上一点就挂了圆上点。
// 修法：建点前用**投影距离**再判一次，只有离真正的曲线足够近才挂。
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

// 圆（半径 3，圆心原点）—— 即"默认圆"
await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); cam.x = 0; cam.y = 0; cam.z = 40;
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st); window.__IW.renderOnce();
});

const clickPointTool = async (wx, wy) => {
  const s = await page.evaluate(([x, y]) => { const p = window.__IW.cam.w2s(x, y); return [p[0], p[1]]; }, [wx, wy]);
  await page.evaluate(() => { window.__IW.st.tool = 'point'; });
  await page.mouse.click(s[0], s[1]);
  await wait(400);
};
const lastEntity = () => page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  const list = [...st.entities.values()].filter((e) => e.type === 'point' || e.type === 'edgepoint');
  const e = list[list.length - 1];
  if (!e) return { none: true };
  const x = e.type === 'edgepoint' ? S.getDerived(st, e, 'x') : e.params.x;
  const y = e.type === 'edgepoint' ? S.getDerived(st, e, 'y') : e.params.y;
  return { type: e.type, x, y, host: e.host || null };
});

// ① 点在直径上（圆内部、(2,0)）
await clickPointTool(2, 0);
const a = await lastEntity();
console.log(`① 点直径 (2,0)：type=${a.type}  落在 (${a.x.toFixed(3)}, ${a.y.toFixed(3)})`);
if (a.type !== 'point') bad.push(`直径上应落普通点，实测 ${a.type}（挂到了 ${a.host}）`);
if (Math.abs(a.x - 2) > 0.05 || Math.abs(a.y) > 0.05) bad.push(`普通点没落在点击处（${a.x.toFixed(3)}, ${a.y.toFixed(3)}）`);

// ② 点在圆心附近
await page.evaluate(() => { const st = window.__IW.st; [...st.entities.values()].filter((e) => e.type === 'point' || e.type === 'edgepoint').forEach((e) => st.entities.delete(e.id)); });
await clickPointTool(0.05, 0.05);
const b2 = await lastEntity();
console.log(`② 点圆心附近 (0.05,0.05)：type=${b2.type}  落在 (${b2.x.toFixed(3)}, ${b2.y.toFixed(3)})`);
if (b2.type !== 'point') bad.push(`圆心附近应落普通点，实测 ${b2.type}`);

// ③ 点在圆周上（(3,0)）→ 仍应挂成圆上的线上点（原功能不能坏）
await page.evaluate(() => { const st = window.__IW.st; [...st.entities.values()].filter((e) => e.type === 'point' || e.type === 'edgepoint').forEach((e) => st.entities.delete(e.id)); });
await clickPointTool(3, 0);
const c = await lastEntity();
console.log(`③ 点圆周 (3,0)：type=${c.type}  落在 (${c.x.toFixed(3)}, ${c.y.toFixed(3)})  host=${c.host}`);
if (c.type !== 'edgepoint') bad.push(`圆周上应挂成线上点，实测 ${c.type}`);
if (Math.abs(Math.hypot(c.x, c.y) - 3) > 1e-6) bad.push('圆周上的点不在圆上');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/point-on-diameter.png' });
console.log('截图 → tests/artifacts/point-on-diameter.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：直径上落普通点（就在点击处）；圆周上仍正常挂线上点');
