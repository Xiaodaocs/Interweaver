// 浏览器端真实鼠标验证：单位圆 → 正弦曲线构造（用户场景）
//   圆 + 圆上点 P（用真实鼠标拖它）+ 半径段 S1 + 直径点 Q + 线段 S2（两端都绑定）+ S2 竖直约束
// 判据：每次拖动后 S2 严格竖直（|x2-x1| ≈ 0），且 Q.x 跟着 P.x 走。
// 为什么必须做这一层：状态层测试绕过了 tools.js 的真实拖动路径（它自己算天真补丁 + pin + 求解）。
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.removeItem('interweaver.draft.v1'); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

// 搭构造（用应用自己的 API，与 UI 建出来的对象一致）
const ids = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); st.probes.clear(); cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const C = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  const ap = S.addEdgePoint(st, C.id, 0.2);
  const P = ap && ap.point ? ap.point : ap;
  const S1 = S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 1, y2: 1 });
  const Q = S.addEntity(st, 'point', { x: 2.9, y: 0 });
  const S2 = S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 2, y2: 0 });
  S.addBinding(st, S1.id, 'x1', C.label + '.cx'); S.addBinding(st, S1.id, 'y1', C.label + '.cy');
  S.addBinding(st, S1.id, 'x2', P.label + '.x');  S.addBinding(st, S1.id, 'y2', P.label + '.y');
  S.addBinding(st, S2.id, 'x1', P.label + '.x');  S.addBinding(st, S2.id, 'y1', P.label + '.y');
  S.addBinding(st, S2.id, 'x2', Q.label + '.x');  S.addBinding(st, S2.id, 'y2', Q.label + '.y');
  S.addConstraint(st, 'vertical', [S2.id]);
  S.ensureEvaluated(st, { solve: true });
  window.__IW.renderOnce();
  return { C: C.id, P: P.id, Q: Q.id, S2: S2.id };
});

const read = () => page.evaluate(([P, Q, S2]) => {
  const S = window.__IW.S, st = window.__IW.st;
  const eff = (id, k) => { const v = st.values.get(id + ':' + k); if (Number.isFinite(v)) return v; const e = st.entities.get(id); return e ? e.params[k] : NaN; };
  const p = st.entities.get(P);
  return {
    px: S.getDerived(st, p, 'x'), py: S.getDerived(st, p, 'y'),
    x1: eff(S2, 'x1'), x2: eff(S2, 'x2'), qx: eff(Q, 'x'),
  };
}, [ids.P, ids.Q, ids.S2]);

// 用真实鼠标沿圆拖动圆上点：绕圆心扫过几个角度
const before0 = await read();
console.log(`初始：P=(${before0.px.toFixed(3)}, ${before0.py.toFixed(3)})  S2=(x1:${before0.x1.toFixed(3)}, x2:${before0.x2.toFixed(3)})  Q.x=${before0.qx.toFixed(3)}`);
let prev = null;
for (const deg of [40, 70, 110, 150, 200]) {
  const rad = (deg * Math.PI) / 180;
  const w = { x: 3 * Math.cos(rad), y: 3 * Math.sin(rad) };
  const from = await page.evaluate(([P]) => { const S = window.__IW.S, st = window.__IW.st; const p = st.entities.get(P); const s = window.__IW.cam.w2s(S.getDerived(st, p, 'x'), S.getDerived(st, p, 'y')); return [s[0], s[1]]; }, [ids.P]);
  const to = await page.evaluate(([x, y]) => { const s = window.__IW.cam.w2s(x, y); return [s[0], s[1]]; }, [w.x, w.y]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 14 });
  await page.mouse.up();
  await wait(350);
  const r = await read();
  const resid = Math.abs(r.x2 - r.x1);
  console.log(`  拖到 ${deg}°：P=(${r.px.toFixed(3)}, ${r.py.toFixed(3)})  S2=(x1:${r.x1.toFixed(3)}, x2:${r.x2.toFixed(3)})  Q.x=${r.qx.toFixed(3)}  残差=${resid.toExponential(1)}`);
  if (!(resid < 1e-6)) bad.push(`拖到 ${deg}° 后线段2 不竖直（残差 ${resid.toExponential(2)}）`);
  if (Math.abs(r.x1 - r.px) > 1e-6) bad.push(`拖到 ${deg}° 后一端没被圆上点驱动（x1=${r.x1.toFixed(4)} vs P.x=${r.px.toFixed(4)}）`);
  if (Math.abs(r.qx - r.px) > 1e-6) bad.push(`拖到 ${deg}° 后 Q 没跟着走（Q.x=${r.qx.toFixed(4)} vs P.x=${r.px.toFixed(4)}）`);
  if (prev !== null && Math.abs(r.qx - prev) < 1e-6) bad.push(`拖到 ${deg}° 后 Q 没有实际移动（仍为 ${r.qx.toFixed(4)}）`);
  prev = r.qx;
}

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/trig-construction.png' });
console.log('截图 → tests/artifacts/trig-construction.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ 浏览器端通过：真实鼠标拖圆上点 → 线段2 始终竖直、被带着左右平移（Q 沿直径滑动）');
