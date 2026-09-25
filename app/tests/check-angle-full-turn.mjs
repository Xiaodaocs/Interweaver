// 验收：圆上点可以连续旋转**越过 180°** 直到 360°（反向亦然），不再回绕到对面。
//   根因：圆宿主的投影用 Math.atan2 → 取值被限制在 (−π, π]，拖过 180° 就跳到 −π 侧。
//   修法：把结果展开到离「当前 t」最近的那一圈（连续累加）。
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

// 圆 + 圆上点（与用户场景同构，但只测角度可达性）
const ids = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); st.probes.clear(); cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const C = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  const ap = S.addEdgePoint(st, C.id, 0);
  const P = ap && ap.point ? ap.point : ap;
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  return { C: C.id, P: P.id };
});

const readT = () => page.evaluate(([P]) => {
  const st = window.__IW.st, S = window.__IW.S;
  const p = st.entities.get(P);
  const v = st.values.get(P + ':t');
  return { t: Number.isFinite(v) ? v : p.params.t, x: S.getDerived(st, p, 'x'), y: S.getDerived(st, p, 'y') };
}, [ids.P]);
const w2s = (x, y) => page.evaluate(([a, b]) => { const s = window.__IW.cam.w2s(a, b); return [s[0], s[1]]; }, [x, y]);

// 沿圆连续拖动：从 0° 逆时针扫到 400°（跨过 180° 与 360°）
const degs = [20, 60, 100, 140, 170, 190, 220, 260, 300, 340, 370, 400];
const start = await w2s(3, 0);
await page.mouse.move(start[0], start[1]);
await page.mouse.down();
let prevT = null, monotonic = true, seen = [];
for (const deg of degs) {
  const rad = (deg * Math.PI) / 180;
  const s = await w2s(3 * Math.cos(rad), 3 * Math.sin(rad));
  await page.mouse.move(s[0], s[1], { steps: 6 });
  await wait(90);
  const r = await readT();
  const degNow = (r.t * 180) / Math.PI;
  seen.push(`${deg}°→t=${degNow.toFixed(1)}°`);
  if (prevT !== null && !(r.t > prevT + 1e-6)) monotonic = false;
  prevT = r.t;
  // 点必须始终在圆上
  const onCircle = Math.abs(Math.hypot(r.x, r.y) - 3) < 1e-6;
  if (!onCircle) bad.push(`拖到 ${deg}° 时点不在圆上（半径 ${Math.hypot(r.x, r.y).toFixed(4)}）`);
}
await page.mouse.up();
await wait(300);
console.log('正向扫描：');
for (const s of seen) console.log('  ' + s);
console.log(`  单调递增（不回绕）= ${monotonic} | 最终 t = ${((prevT * 180) / Math.PI).toFixed(1)}°`);
if (!monotonic) bad.push('正向拖动时 t 出现回绕（说明仍然过不了 180°）');
if (!(prevT * 180 / Math.PI > 360)) bad.push(`正向没能转超过 360°（只到 ${((prevT * 180) / Math.PI).toFixed(1)}°）`);

// 反向：从当前角度往回扫（应能反向越过 −180°，即 t 继续减小到 0 以下）
const back = [300, 200, 100, 0, -60, -120, -180, -240];
let prevT2 = prevT, monoDown = true;
const seen2 = [];
await page.mouse.move((await w2s(3 * Math.cos(prevT), 3 * Math.sin(prevT)))[0], (await w2s(3 * Math.cos(prevT), 3 * Math.sin(prevT)))[1]);
await page.mouse.down();
for (const deg of back) {
  const rad = (deg * Math.PI) / 180;
  const s = await w2s(3 * Math.cos(rad), 3 * Math.sin(rad));
  await page.mouse.move(s[0], s[1], { steps: 6 });
  await wait(90);
  const r = await readT();
  seen2.push(`${deg}°→t=${((r.t * 180) / Math.PI).toFixed(1)}°`);
  if (!(r.t < prevT2 - 1e-6)) monoDown = false;
  prevT2 = r.t;
}
await page.mouse.up();
await wait(300);
console.log('反向扫描：');
for (const s of seen2) console.log('  ' + s);
console.log(`  单调递减（不回绕）= ${monoDown} | 最终 t = ${((prevT2 * 180) / Math.PI).toFixed(1)}°`);
if (!monoDown) bad.push('反向拖动时 t 出现回绕');
if (!(prevT2 * 180 / Math.PI < 0)) bad.push(`反向没能转到 0° 以下（只到 ${((prevT2 * 180) / Math.PI).toFixed(1)}°）`);

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ 通过：圆上点可连续旋转越过 180°，正向超过 360°、反向超过 −180°（多圈累加）');
