// 验收（用户要求）：**微积分等图形功能都能用在隐函数上**。
//
// 判据全部用**闭式解**对比（不是"看起来对"）：
//   ① 切线：圆 x²+y²=1 上某点的切线斜率闭式解 = −x₀/y₀（隐式微分 dy/dx=−F_x/F_y ✓）
//   ② 竖直切线：圆的最左/最右点 y₀→0 → 斜率必须**发散为 ±∞**（显函数无法表达，隐函数可以）
//   ③ 割线：圆上两点的割线斜率闭式解 = −(x₁+x₂)/(y₁+y₂)；且两端点都必须在曲线上
//   ④ 用点切出曲线：edgepoint 的 t 与 pointOnHost 一致（点在曲线上）
//   ⑤ 0 运行时错误
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);

const bad = [];

// 建圆（走真实 UI）+ 线上点 + 切线 + 割线，全部用应用自己的 API 与求值链
const res = await page.evaluate(async () => {
  const S = window.__IW.S;
  const st = window.__IW.st;
  // ① 用真实 UI 建隐函数（与 check-implicit 同一路径，确保走的是用户路径）
  document.querySelector('#toolbar button[data-tool="fx"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const input = document.querySelector('#fxInput');
  input.value = 'x^2+y^2=1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  document.querySelector('#fxGo')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const host = [...st.entities.values()].find((e) => e.type === 'implicit');
  if (!host) return { error: '没有创建出隐函数实体' };
  S.ensureEvaluated(st);

  // ② 线上点（用点切出曲线）+ 切线
  const ep = S.addEdgePoint(st, host.id, 0.25);
  const p1 = ep.point;
  const tg = S.addEntity(st, 'tangent', { host: host.id, p1: p1.id, len: 1.5 });
  S.ensureEvaluated(st);

  const E = await import('/src/entities.js');
  const out = { slopeChecks: [], vertical: null, pointCheck: null };
  // ③ 在多个 t 处比对闭式解 −x0/y0
  for (const t of [0.1, 0.2, 0.35, 0.45, 0.6, 0.75]) {
    const p = E.pointOnHost(host, st.env, t);
    const m = E.hostSlopeAtT(host, st.env, t);
    const closed = Math.abs(p[1]) < 1e-9 ? Infinity : -p[0] / p[1];
    out.slopeChecks.push({ t, x: +p[0].toFixed(4), y: +p[1].toFixed(4), m: Number.isFinite(m) ? +m.toFixed(4) : String(m), closed: Number.isFinite(closed) ? +closed.toFixed(4) : String(closed) });
  }
  // ④ 竖直切线：找 y≈0 的点（圆上的 (±1, 0)）
  let bestT = null, bestAbsY = Infinity;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const p = E.pointOnHost(host, st.env, t);
    if (Number.isFinite(p[1]) && Math.abs(p[1]) < bestAbsY) { bestAbsY = Math.abs(p[1]); bestT = t; }
  }
  const mp = E.pointOnHost(host, st.env, bestT);
  out.vertical = { t: bestT, x: +mp[0].toFixed(4), y: +mp[1].toFixed(5), m: String(E.hostSlopeAtT(host, st.env, bestT)) };

  // ⑤ 割线：两点都在曲线上，斜率 = −(x1+x2)/(y1+y2)
  const ep2 = S.addEdgePoint(st, host.id, 0.62);
  const sc = S.addEntity(st, 'secant', { host: host.id, p1: p1.id, p2: ep2.point.id, len: 1.5 });
  S.ensureEvaluated(st);
  const a = E.pointOnHost(host, st.env, st.env.val(p1.id, 't'));
  const b = E.pointOnHost(host, st.env, st.env.val(ep2.point.id, 't'));
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const secantSlope = Math.abs(dx) < 1e-12 ? Infinity : dy / dx;
  const closedSecant = Math.abs(a[1] + b[1]) < 1e-9 ? Infinity : -(a[0] + b[0]) / (a[1] + b[1]);
  out.secant = {
    slope: Number.isFinite(secantSlope) ? +secantSlope.toFixed(4) : String(secantSlope),
    closed: Number.isFinite(closedSecant) ? +closedSecant.toFixed(4) : String(closedSecant),
    onCurveA: +Math.abs(S.getVal(st, a[0] === undefined ? null : host, 'x0') === undefined ? 0 : 0).toFixed(4),
    fA: +Math.abs(st.scope.evalWith2(host.ast, a[0], a[1])).toExponential(2),
    fB: +Math.abs(st.scope.evalWith2(host.ast, b[0], b[1])).toExponential(2),
  };
  // ⑥ edgepoint 的 t 与 pointOnHost 一致（"用点切出曲线"）
  const tE = st.env.val(p1.id, 't');
  const pE = E.pointOnHost(host, st.env, tE);
  out.pointCheck = { t: +tE.toFixed(4), x: +pE[0].toFixed(4), y: +pE[1].toFixed(4), f: +Math.abs(st.scope.evalWith2(host.ast, pE[0], pE[1])).toExponential(2) };
  // ②-b F = x：竖直直线（显函数表达不了）→ 处处 F_y = 0 → 斜率必须 ±∞
  const PE = await import('/src/expr.js');
  const eqV = PE.parseEquation('x=0');
  const hostV = S.addEntity(st, 'implicit', {}, { expr: eqV.fSrc || 'x', ast: eqV.ast });
  S.ensureEvaluated(st);
  window.__IW.renderOnce();   // 触发一次绘制以填充几何缓存
  const slopes = [], xs = [];
  for (const tt of [0.2, 0.4, 0.6, 0.8]) {
    const pv = E.pointOnHost(hostV, st.env, tt);
    xs.push(Number.isFinite(pv[0]) ? +pv[0].toFixed(6) : String(pv[0]));
    const mv = E.hostSlopeAtT(hostV, st.env, tt);
    slopes.push(String(mv));
  }
  out.verticalLine = { slopes, xs, allInf: slopes.every((s) => /Infinity/.test(s)), allXZero: xs.every((x) => Math.abs(Number(x)) < 1e-6) };

  out.ids = { host: host.id, tg: tg.id, sc: sc.id };
  return out;
});

if (res.error) { console.log("❌ " + res.error); bad.push(res.error); }
else {
  console.log("① 切线斜率 vs 闭式解 −x₀/y₀：");
  let worst = 0;
  for (const c of res.slopeChecks) {
    const okNum = typeof c.m === "number" && typeof c.closed === "number";
    const diff = okNum ? Math.abs(c.m - c.closed) / Math.max(1, Math.abs(c.closed)) : Infinity;
    worst = Math.max(worst, diff);
    console.log(`   t=${c.t} 点(${c.x},${c.y}) m=${c.m} 闭式=${c.closed} 相对误差=${okNum ? diff.toExponential(2) : "—"}`);
  }
  if (worst > 1e-3) bad.push(`切线斜率与闭式解不符：最大相对误差 ${worst}`);

  // ②-a 趋近竖直：y 很小时 |m| = |x/y| 必须很大（这是 −x/y 的直接推论）
  const mAbs = Math.abs(Number(res.vertical.m));
  console.log(`②-a 趋近竖直：t=${res.vertical.t.toFixed(4)} 点(${res.vertical.x},${res.vertical.y}) 斜率=${res.vertical.m}（= −x/y，有限但很大才正确）`);
  if (!(mAbs > 50)) bad.push(`y≈0 处 |斜率| 应很大（趋近竖直），实测 ${res.vertical.m}`);
  if (Math.abs(res.vertical.y) > 0.02) bad.push('最近点的 y 不够接近 0，无法检验趋近竖直');

  // ②-b 决定性检验竖直切线分支：F = x 是一条**竖直直线**（显函数无法表达），处处 F_y = 0 → 斜率必须为 ±∞
  const vs = res.verticalLine;
  console.log(`②-b 竖直直线 F=x：斜率抽样 = ${JSON.stringify(vs.slopes)} | 点 x 坐标 = ${JSON.stringify(vs.xs)}`);
  if (!vs.allInf) bad.push(`竖直直线上斜率应为 ±∞，实测 ${JSON.stringify(vs.slopes)}`);
  if (!vs.allXZero) bad.push(`竖直直线 F=x 上的点 x 应恒为 0，实测 ${JSON.stringify(vs.xs)}`);

  console.log(`③ 割线：斜率=${res.secant.slope} 闭式=${res.secant.closed} | 两端点 |F| = ${res.secant.fA}, ${res.secant.fB}`);
  const secOk = Math.abs(Number(res.secant.slope) - Number(res.secant.closed)) / Math.max(1, Math.abs(Number(res.secant.closed))) < 3e-3;
  if (!secOk) bad.push(`割线斜率与闭式解不符（${res.secant.slope} vs ${res.secant.closed}）`);
  if (Math.abs(res.secant.fA) > 0.02 || Math.abs(res.secant.fB) > 0.02) bad.push("割线端点不在曲线上");

  console.log(`④ 用点切出曲线：edgepoint t=${res.pointCheck.t} → 点(${res.pointCheck.x},${res.pointCheck.y}) |F|=${res.pointCheck.f}`);
  if (Math.abs(res.pointCheck.f) > 0.02) bad.push("edgepoint 的点不在隐函数曲线上");
}

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/implicit-tangent.png" });
console.log("截图 → tests/artifacts/implicit-tangent.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 微积分可用在隐函数上：切线斜率吻合闭式解、竖直切线正确发散、割线斜率与端点均正确、线上点落在曲线上");
await browser.close();
process.exit(bad.length ? 1 : 0);
