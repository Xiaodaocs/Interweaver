// 验收（用户报告）：从圆上截出的那一段，现在是**自由曲线**（独立实体）——必须能直接被拖走
//   ① 造圆 → 截出一段（裁切语义重构：当下就是 freehand，与宿主无关，无需「解绑」）
//   ② 真实鼠标拖动它 → 折线上的点应发生整体位移
//   ③ 位移应等于拖拽量，且点的相对形状不变（刚体平移，不是变形）
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const info = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const C = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st);
  S.addEdgePoint(st, C.id, 0.1);
  const r2 = S.addEdgePoint(st, C.id, 0.4);
  S.ensureEvaluated(st);
  // ★ 两阶段语义（用户澄清）：裁出来的先是「截取段」（视觉独立、仍属宿主），
  //   必须**显式解绑**才变成真正的「自由曲线」实体 —— 本检查验收的就是解绑后的它能否整体拖走。
  const piece = r2 && r2.arc ? r2.arc : [...st.entities.values()].find((e) => e.type === 'curvepiece');
  if (!piece) return { none: true, note: '没裁出截取段' };
  const det = S.detachPiece(st, piece.id);
  if (det.error) return { none: true, note: '解绑失败：' + det.error };
  const arc = det.entity;
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  const mid = arc.pts[Math.floor(arc.pts.length / 2)];
  const s = cam.w2s(mid[0], mid[1]);
  return { id: arc.id, type: arc.type, ptsCount: arc.pts.length,
    sx: s[0], sy: s[1], x: mid[0], y: mid[1], pts: arc.pts.map((p) => [...p]) };
});
if (info.none) { console.log('✗ 没能造出自由曲线：' + (info.note || '')); await browser.close(); process.exit(1); }
console.log(`自由曲线：type=${info.type}  折线点数=${info.ptsCount}  抓取点世界坐标=(${info.x.toFixed(2)}, ${info.y.toFixed(2)})`);

// 选中它并用真实鼠标拖动（拖它的折线中点）
await page.evaluate(([id]) => { const st = window.__IW.st; st.selection = new Set([id]); window.__IW.S.emit(st, 'selection'); }, [info.id]);
await wait(300);
const to = await page.evaluate(([x, y]) => { const s = window.__IW.cam.w2s(x + 2, y - 1.5); return [s[0], s[1]]; }, [info.x, info.y]);
await page.mouse.move(info.sx, info.sy);
await page.mouse.down();
await page.mouse.move(to[0], to[1], { steps: 14 });
await page.mouse.up();
await wait(500);

const after = await page.evaluate(([id, refIdx]) => {
  const e = window.__IW.st.entities.get(id);
  return { pts: e.pts.map((p) => [...p]) };
}, [info.id, Math.floor(info.ptsCount / 2)]);

// 判据①：被抓的那个点位移应 ≈ (+2, -1.5)（真实鼠标拖拽量）
const k = Math.floor(info.ptsCount / 2);
const d = [after.pts[k][0] - info.pts[k][0], after.pts[k][1] - info.pts[k][1]];
console.log(`拖动后：抓取点位移=(${d[0].toFixed(3)}, ${d[1].toFixed(3)})（期望 ≈ (2, -1.5)）`);
if (Math.hypot(d[0], d[1]) < 0.5) bad.push(`没被拖动（位移 ${Math.hypot(d[0], d[1]).toFixed(3)}）`);
if (Math.abs(Math.abs(d[0]) - 2) > 0.3 || Math.abs(Math.abs(d[1]) - 1.5) > 0.3) bad.push(`位移不符合拖拽量（实测 (${d[0].toFixed(2)}, ${d[1].toFixed(2)})）`);

// 判据②：刚体平移 —— 每个点的位移都应一致（形状不变）
let worst = 0;
for (let i = 0; i < info.pts.length; i++) {
  const di = Math.hypot(after.pts[i][0] - info.pts[i][0] - d[0], after.pts[i][1] - info.pts[i][1] - d[1]);
  if (di > worst) worst = di;
}
console.log(`全点位移一致性最大偏差 = ${worst.toFixed(6)}（0 = 完美刚体平移）`);
if (worst > 1e-6) bad.push(`不是刚体平移：最大偏差 ${worst.toFixed(6)}`);

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/arcfree-drag.png' });
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：裁出的「自由曲线」可以整体拖走（每个点位移一致，是刚体平移）');
