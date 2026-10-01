// 验收（用户要求第 2 项）：圆的直径是一条**可以被解绑的线** → 点放在它身上属于**线上点**
//   ① 点工具点在直径线上 → 生成的是**线上点**（宿主=那条直径线段），不是普通点、也不吸到圆周
//   ② 直径线**属于圆**：改半径/移动圆心，它跟着变
//   ③ 可以**解绑** → 变成自由线段（无绑定、可直接拖走）
//   ④ 点在**圆周**上仍然是"圆上的线上点"（原功能不受影响）
//   ⑤ 圆本身仍能靠"拖直径"移动（hitTest 取插入顺序第一个 → 圆优先，未被新实体抢走）
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

const reset = () => page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st); window.__IW.renderOnce();
});
const clickAt = async (wx, wy, tool = 'point') => {
  const s = await page.evaluate(([x, y]) => { const p = window.__IW.cam.w2s(x, y); return [p[0], p[1]]; }, [wx, wy]);
  await page.evaluate(([t]) => { window.__IW.st.tool = t; }, [tool]);
  await page.mouse.click(s[0], s[1]);
  await wait(400);
};
const lastPoint = () => page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  const list = [...st.entities.values()].filter((e) => e.type === 'point' || e.type === 'edgepoint');
  const e = list[list.length - 1];
  if (!e) return { none: true };
  const x = e.type === 'edgepoint' ? S.getDerived(st, e, 'x') : e.params.x;
  const y = e.type === 'edgepoint' ? S.getDerived(st, e, 'y') : e.params.y;
  const host = e.host ? st.entities.get(e.host) : null;
  return { type: e.type, x, y, hostId: e.host || null, hostType: host ? host.type : null, hostLabel: host ? host.label : null };
});

// ① 点直径线 → 线上点（宿主是直径线段）
await reset();
await clickAt(2, 0);
const a = await lastPoint();
console.log(`① 点直径 (2,0)：type=${a.type} 位置=(${a.x.toFixed(3)}, ${a.y.toFixed(3)}) 宿主=${a.hostType}(${a.hostLabel})`);
if (a.type !== 'edgepoint') bad.push(`直径线上应生成**线上点**，实测 ${a.type}`);
if (a.hostType !== 'segment') bad.push(`线上点的宿主应是那条直径线段，实测 ${a.hostType}`);
if (Math.abs(a.x - 2) > 1e-6 || Math.abs(a.y) > 1e-6) bad.push(`点没落在点击处（${a.x.toFixed(3)}, ${a.y.toFixed(3)}）`);

// ② 直径线属于圆：改半径 → 它跟着变长
const follow = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st;
  const c = [...st.entities.values()].find((e) => e.type === 'circle');
  const dia = [...st.entities.values()].find((e) => e.type === 'segment' && e.diameterOf);
  const len = () => Math.hypot(S.getVal(st, dia, 'x2') - S.getVal(st, dia, 'x1'), S.getVal(st, dia, 'y2') - S.getVal(st, dia, 'y1'));
  const l0 = len();
  S.setParams(st, c, { r: 5 });
  S.ensureEvaluated(st);
  const l1 = len();
  return { l0, l1, host: dia.diameterOf === c.id };
});
console.log(`② 直径线属于圆：半径 3→5 后长度 ${follow.l0.toFixed(3)} → ${follow.l1.toFixed(3)}（挂宿主=${follow.host}）`);
if (!(Math.abs(follow.l1 - 10) < 1e-6)) bad.push(`半径变大后直径线没跟着变（长度 ${follow.l1}，应=10）`);

// ③ 解绑 → 自由线段（无绑定、可拖走）
const det = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st;
  const dia = [...st.entities.values()].find((e) => e.type === 'segment' && e.diameterOf);
  const r = S.detachDiameter(st, dia.id);
  S.ensureEvaluated(st);
  return { ok: !r.error, err: r.error || null, id: dia.id, bound: Object.keys(dia.bound || {}).length, dia: !!dia.diameterOf };
});
console.log(`③ 解绑直径线：ok=${det.ok} 残留绑定=${det.bound} 仍标直径=${det.dia}`);
if (!det.ok) bad.push('解绑直径线失败：' + det.err);
if (det.bound !== 0) bad.push(`解绑后仍残留 ${det.bound} 个绑定`);
if (det.dia) bad.push('解绑后仍标着 diameterOf');
// 解绑后能拖走（注意：第 ① 步用的是点工具，这里必须切回 select，否则拖的是"点工具"）
await page.evaluate(() => { window.__IW.st.tool = 'select'; });
const drag = await page.evaluate(([id]) => {
  const { st, S, cam } = window.__IW;
  const seg = st.entities.get(id);
  const mx = (S.getVal(st, seg, 'x1') + S.getVal(st, seg, 'x2')) / 2;
  const my = (S.getVal(st, seg, 'y1') + S.getVal(st, seg, 'y2')) / 2;
  const from = cam.w2s(mx, my), to = cam.w2s(mx + 2, my + 1.5);
  st.selection = new Set([id]);
  return { id, from: [from[0], from[1]], to: [to[0], to[1]], x1: S.getVal(st, seg, 'x1') };
}, [det.id]);
await page.mouse.move(drag.from[0], drag.from[1]);
await page.mouse.down();
await page.mouse.move(drag.to[0], drag.to[1], { steps: 10 });
await page.mouse.up();
await wait(300);
const moved = await page.evaluate(([id, x1]) => {
  const { st, S } = window.__IW;
  return { dx: S.getVal(st, st.entities.get(id), 'x1') - x1 };
}, [det.id, drag.x1]);
console.log(`   解绑后拖动：位移 dx=${moved.dx.toFixed(3)}`);
if (Math.abs(moved.dx) < 0.5) bad.push('解绑后的直径线拖不动');

// ④ 圆周上仍然是"圆上的线上点"
await reset();
await clickAt(3, 0);
const c2 = await lastPoint();
console.log(`④ 点圆周 (3,0)：type=${c2.type} 宿主=${c2.hostType}(${c2.hostLabel})`);
if (c2.type !== 'edgepoint' || c2.hostType !== 'circle') bad.push(`圆周上应仍是"圆上的线上点"，实测 ${c2.type}/${c2.hostType}`);

// ⑤ 圆仍能靠"拖直径"整体移动（新实体没抢走命中）
await reset();
const dragCircle = await page.evaluate(() => {
  const { cam } = window.__IW;
  const from = cam.w2s(1.5, 0), to = cam.w2s(1.5, 2);
  return { from: [from[0], from[1]], to: [to[0], to[1]] };
});
await page.evaluate(() => { window.__IW.st.tool = 'select'; });
await page.mouse.move(dragCircle.from[0], dragCircle.from[1]);
await page.mouse.down();
await page.mouse.move(dragCircle.to[0], dragCircle.to[1], { steps: 10 });
await page.mouse.up();
await wait(300);
const circleMoved = await page.evaluate(() => {
  const { st, S } = window.__IW;
  const c = [...st.entities.values()].find((e) => e.type === 'circle');
  return { cy: S.getVal(st, c, 'cy') };
});
console.log(`⑤ 拖直径移动圆：cy = ${circleMoved.cy.toFixed(3)}（期望 ≈2）`);
if (Math.abs(circleMoved.cy - 2) > 0.4) bad.push(`拖直径没能移动圆（cy=${circleMoved.cy.toFixed(3)}）`);

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/diameter-line.png' });
console.log('截图 → tests/artifacts/diameter-line.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：直径是可解绑的真实线段，点落在它身上是线上点；圆周与"拖直径移动圆"均未受影响');
