// 验收（用户报告）：从圆上截出的**自由圆弧**必须能直接被拖走（它是独立图形）
//   ① 造圆 → 截出一段（arcfree）
//   ② 真实鼠标拖动它 → 圆心应发生位移
//   ③ 圆弧的半径/张角应保持不变（刚体平移，不是变形）
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
  // ★ 新模型：裁出来的先是**属于圆**的宿主零件（curvepiece），要拿到自由圆弧必须先「解绑」
  const piece = r2 && r2.arc ? r2.arc : [...st.entities.values()].find((e) => e.type === 'curvepiece');
  if (!piece) return { none: true, note: '没裁出宿主零件' };
  const det = S.detachPiece(st, piece.id);
  if (det.error) return { none: true, note: '解绑失败：' + det.error };
  S.ensureEvaluated(st);
  const arc = det.entity;
  window.__IW.renderOnce();
  // 生效值优先，取不到就回退到实体自己的参数（values 里不一定缓存了每个键）
  const g = (k) => { const v = st.values.get(arc.id + ':' + k); return Number.isFinite(v) ? v : arc.params[k]; };
  if (!Number.isFinite(g('cx'))) return { none: true, type: arc.type, note: '该实体没有 cx' };
  // 取圆弧中点作为抓取位置
  const mid = Number.isFinite(g('start')) ? g('start') + (g('sweep') || 0) / 2 : null;
  const wx = Number.isFinite(mid) ? g('cx') + g('r') * Math.cos(mid) : NaN;
  const wy = Number.isFinite(mid) ? g('cy') + g('r') * Math.sin(mid) : NaN;
  const s = cam.w2s(wx, wy);
  return { id: arc.id, type: arc.type, cx: g('cx'), cy: g('cy'), r: g('r'), sweep: g('sweep'),
    sx: s[0], sy: s[1], x: wx, y: wy };
});
if (info.none) { console.log('✗ 没能造出圆弧：' + (info.note || '')); await browser.close(); process.exit(1); }
console.log(`圆弧：type=${info.type}  圆心=(${info.cx}, ${info.cy}) r=${info.r} 张角=${(info.sweep * 180 / Math.PI).toFixed(1)}°  抓取点世界坐标=(${info.x.toFixed(2)}, ${info.y.toFixed(2)})`);

// 选中它并用真实鼠标拖动
await page.evaluate(([id]) => { const st = window.__IW.st; st.selection = new Set([id]); window.__IW.S.emit(st, 'selection'); }, [info.id]);
await wait(300);
const to = await page.evaluate(([x, y]) => { const s = window.__IW.cam.w2s(x + 2, y - 1.5); return [s[0], s[1]]; }, [info.x, info.y]);
await page.mouse.move(info.sx, info.sy);
await page.mouse.down();
await page.mouse.move(to[0], to[1], { steps: 14 });
await page.mouse.up();
await wait(500);

const after = await page.evaluate(([id]) => {
  const st = window.__IW.st;
  const e = st.entities.get(id);
  const g = (k) => { const v = st.values.get(id + ':' + k); return Number.isFinite(v) ? v : e.params[k]; };
  return { cx: g('cx'), cy: g('cy'), r: g('r'), sweep: g('sweep') };
}, [info.id]);
const d = [after.cx - info.cx, after.cy - info.cy];
console.log(`拖动后：圆心=(${after.cx.toFixed(3)}, ${after.cy.toFixed(3)}) 位移=(${d[0].toFixed(3)}, ${d[1].toFixed(3)})  r=${after.r} 张角=${(after.sweep * 180 / Math.PI).toFixed(1)}°`);

if (Math.hypot(d[0], d[1]) < 0.5) bad.push(`圆弧没被拖动（位移 ${Math.hypot(d[0], d[1]).toFixed(3)}）`);
if (Math.abs(Math.abs(d[0]) - 2) > 0.3 || Math.abs(Math.abs(d[1]) - 1.5) > 0.3) bad.push(`位移不符合拖拽量（期望约 (2, -1.5)，实测 (${d[0].toFixed(2)}, ${d[1].toFixed(2)})）`);
if (Math.abs(after.r - info.r) > 1e-9) bad.push(`平移时半径变了（${info.r} → ${after.r}）`);
if (Math.abs(after.sweep - info.sweep) > 1e-9) bad.push(`平移时张角变了（${info.sweep} → ${after.sweep}）`);

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/arcfree-drag.png' });
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：自由圆弧可以整体拖走（半径与张角不变，是刚体平移）');
