// 守卫（用户报告过的一类回归）：**拖动函数/曲线本体时，依赖它的东西必须跟着走**
//   背景：同一件"这条曲线在哪"曾被实现 4~7 处（draw/hit/pointOnHost/hostYAt/safeEval/
//   lines.js 的本地 yAt/render.js 的两个分支），各自演化 → 拖走函数后
//   「函数上的线上点」留在原地、「积分区域」永远积老位置、「切线/法线」画在旧位置。
//   现在几何只有一条通路：safeEval(自身坐标→y) ← hostYAt(世界x→y) ← pointOnHost/hostPointAt。
//   本检查用**真鼠标**拖动，覆盖整条链，防止再次劈叉。
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await wait(400);

// ---------- ① 函数（真预设"阻尼振荡"）：点 / 积分 / 切线 都要跟着函数走 ----------
const setup = await page.evaluate(async () => {
  const M = await import('/src/entities.js');
  const R = await import('/src/presetRecipes.js');
  const { st, S, cam } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const preset = M.PRESETS.find((x) => x.key === 'damped');
  const at = { x: 0, y: 0 };
  const params = M.createFromPreset(preset, at);
  const [dmin, dmax] = S.viewDomainX(cam);
  params.dmin = dmin; params.dmax = dmax;
  const extra = R.presetExtraWithExpr(preset, at, M.presetExtra ? M.presetExtra(preset, at) : undefined);
  const f = S.addEntity(st, preset.type, params, extra, true);
  // 函数上的线上点（用户症状①的主角）
  const ep = S.addEdgePoint(st, f.id, 3);
  // 积分区域（用户症状②的主角）
  const ig = S.addEntity(st, 'integral', { a: -2, b: 2, n: 8, method: 0 }, { host: f.id }, true);
  // 切线（走 lines.js 那条通路，历史上也抄过一份映射）
  const tg = S.addEntity(st, 'tangent', { len: 2 }, { host: f.id, p1: ep.point.id }, true);
  S.ensureEvaluated(st); window.__IW.renderOnce();
  const { hostYAt } = await import('/src/entities.js');
  const ys = [];
  for (let i = 0; i <= 8; i++) ys.push(hostYAt(f, st.env, -2 + i));
  const top = Math.max(...ys.filter(Number.isFinite), 0.5);
  const s1 = cam.w2s(-2.3, top + 0.5), s2 = cam.w2s(2.3, -0.6);
  // 抓取点：曲线上 x=7 处（远离积分区间 [-2,2]，也远离线上的点 t=3）
  const y7 = hostYAt(f, st.env, 7);
  const grab = cam.w2s(7, y7);
  return { f: f.id, ep: ep.point.id, ig: ig.id, tg: tg.id, grab: { x: grab[0], y: grab[1] },
    clip: { x: Math.round(Math.min(s1[0], s2[0])), y: Math.round(Math.min(s1[1], s2[1])),
      width: Math.round(Math.abs(s2[0] - s1[0])), height: Math.round(Math.abs(s2[1] - s1[1])) } };
});
const read1 = () => page.evaluate(([fid, epid, igid, tgid]) => {
  const { st, S } = window.__IW;
  const n = (v) => (Number.isFinite(v) ? +v.toFixed(4) : v);
  return {
    cx: n(S.getVal(st, st.entities.get(fid), 'cx')),
    epx: n(S.getDerived(st, st.entities.get(epid), 'x')),
    epy: n(S.getDerived(st, st.entities.get(epid), 'y')),
    S: n(S.getDerived(st, st.entities.get(igid), 'S')),
    tgx0: n(S.getDerived(st, st.entities.get(tgid), 'x0')),
    tgy0: n(S.getDerived(st, st.entities.get(tgid), 'y0')),
  };
}, [setup.f, setup.ep, setup.ig, setup.tg]);
const before = await read1();
const shotA = await page.screenshot({ encoding: 'base64', clip: setup.clip });
await page.mouse.move(setup.grab.x, setup.grab.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(setup.grab.x + i * 14, setup.grab.y); await wait(18); }
await page.mouse.up();
await wait(400);
const after = await read1();
const shotB = await page.screenshot({ encoding: 'base64', clip: setup.clip });
const dcx = after.cx - before.cx;
console.log(`  函数拖动：cx ${before.cx} → ${after.cx}（Δ=${dcx.toFixed(3)} 世界单位）`);
ok(Math.abs(dcx) > 0.5, `① 函数本体确实移动了（cx 变化 ${dcx.toFixed(3)}）`);
ok(Math.abs((after.epx - before.epx) - dcx) < 1e-3 && Math.abs(after.epy - before.epy) < 1e-3,
  `① 函数上的线上点跟着走（Δx=${(after.epx - before.epx).toFixed(3)} ≈ Δcx，Δy=${(after.epy - before.epy).toFixed(4)}）`);
ok(Math.abs((after.tgx0 - before.tgx0) - dcx) < 1e-3 && Math.abs(after.tgy0 - before.tgy0) < 1e-3,
  `① 切线的切点也跟着走（Δx0=${(after.tgx0 - before.tgx0).toFixed(3)}）`);
ok(after.S !== before.S, `② 积分值跟着函数变（S ${before.S} → ${after.S}）`);
const diff = await page.evaluate(async ([a, c]) => {
  const load = async (u) => {
    const i = new Image();
    await new Promise((res, rej) => { i.onload = res; i.onerror = () => rej(new Error('decode')); i.src = u; });
    const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0);
    return g.getImageData(0, 0, cv.width, cv.height).data;
  };
  const A = await load(a), B = await load(c);
  let n = 0;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 10 || Math.abs(A[i + 1] - B[i + 1]) > 10 || Math.abs(A[i + 2] - B[i + 2]) > 10) n++;
  return +(100 * n / (A.length / 4)).toFixed(1);
}, ['data:image/png;base64,' + shotA, 'data:image/png;base64,' + shotB]);
ok(diff > 2, `② 积分区域的**画面**也跟着变（像素变化 ${diff}% > 2%）`);

// ---------- ③ 正弦 / 抛物线：同一类，点也必须跟着走 ----------
for (const kind of ['sine', 'parabola']) {
  const s = await page.evaluate(async ([k]) => {
    const { st, S, cam } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
    const { REGISTRY, hostYAt } = await import('/src/entities.js');
    const e = S.addEntity(st, k, REGISTRY[k].create({ x: 0, y: 0 }), true);
    const ep = S.addEdgePoint(st, e.id, k === 'sine' ? 1 : 1);
    S.ensureEvaluated(st); window.__IW.renderOnce();
    const off = (k === 'sine') ? (e.params.cx || 0) : (e.params.h || 0);
    // ★ 抓取点必须**远离那条曲线上的线上点**（把手命中优先级最高，否则拖到的是点、不是曲线本体）
    const wx = 5 + off;
    const y = hostYAt(e, st.env, wx);
    const g = cam.w2s(wx, y);
    return { id: e.id, ep: ep.point.id, grab: { x: g[0], y: g[1] } };
  }, [kind]);
  const rd = () => page.evaluate(([id, epid, kd]) => {
    const { st, S } = window.__IW;
    const e = st.entities.get(id);
    const n = (v) => (Number.isFinite(v) ? +v.toFixed(4) : v);
    return { kind: kd, cx: n(e.params.cx), h: n(e.params.h),
      epx: n(S.getDerived(st, st.entities.get(epid), 'x')),
      epy: n(S.getDerived(st, st.entities.get(epid), 'y')) };
  }, [s.id, s.ep, kind]);
  const b0 = await rd();
  await page.mouse.move(s.grab.x, s.grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(s.grab.x + i * 14, s.grab.y); await wait(18); }
  await page.mouse.up();
  await wait(300);
  const a0 = await rd();
  // 正弦的横向位置参数是 cx、抛物线是顶点 h（两者的"移动量"各取自己的那个）
  const moved = (kind === 'sine') ? (a0.cx - b0.cx) : (a0.h - b0.h);
  ok(Math.abs(moved) > 0.5, `③ ${kind}：本体确实移动（Δ=${moved.toFixed(3)}）`);
  ok(Math.abs((a0.epx - b0.epx) - moved) < 1e-3 && Math.abs(a0.epy - b0.epy) < 1e-3,
    `③ ${kind}：曲线上的点跟着走（Δx=${(a0.epx - b0.epx).toFixed(3)} ≈ Δ${moved.toFixed(3)}）`);
}

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/func-follow.png' });
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：拖动函数/曲线本体时，线上点、积分区域（数值+画面）、切线切点都跟着走');
