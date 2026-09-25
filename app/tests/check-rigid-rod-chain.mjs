// 端到端验收（用户场景，真实鼠标拖拽）：「被魔法固定成水平的铁棍」+ 粘着的东西一起走
//
// 链条（与用户描述一一对应）：
//   铁棍 L（被约束为水平）
//   ├─ 左端 ← 绑定到点 P            （用户：我把其左端点绑定到了一个点）
//   │        └─ P ← 绑定到线段 M 的左端（用户：+ 另一条线）
//   └─ 右端 → 粘着圆 C              （用户：这条线的另一边绑上了一个圆）
// 动作：**拖动 M 的左端点**（用户：我现在拖动另一条线）
// 期望：力沿链传递 → 铁棍 L **整体平移**（始终水平）、圆 C 跟着一起走并全程绑在线上。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.removeItem("interweaver.draft.v1"); } catch (e) {} });
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

// ---------- 搭链条 ----------
const ids = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  st.tool = 'select';
  // 铁棍 L：水平，从 (-5,0) 到 (5,0)
  const L = S.addEntity(st, 'segment', { x1: -5, y1: 0, x2: 5, y2: 0 });
  // 点 P
  const P = S.addEntity(st, 'point', { x: -5, y: 0 });
  // 线段 M：左端 (2,3)，与 P 绑定（拖 M 就是"拖动另一条线"）
  const M = S.addEntity(st, 'segment', { x1: 2, y1: 3, x2: 6, y2: 3 });
  // 圆 C
  const C = S.addEntity(st, 'circle', { cx: 5, cy: 0, r: 1 });
  S.addConstraint(st, 'horizontal', [L.id]);
  S.addBinding(st, L.id, 'x1', P.label + '.x');
  S.addBinding(st, L.id, 'y1', P.label + '.y');
  S.addBinding(st, P.id, 'x', M.label + '.x1');
  S.addBinding(st, P.id, 'y', M.label + '.y1');
  S.addBinding(st, C.id, 'cx', L.label + '.x2');
  S.addBinding(st, C.id, 'cy', L.label + '.y2');
  S.ensureEvaluated(st, { solve: true });
  window.__IW.renderOnce();
  return { L: L.id, P: P.id, M: M.id, C: C.id, mLbl: M.label };
});
const read = () => page.evaluate(([L, P, M, C]) => {
  const S = window.__IW.S, st = window.__IW.st;
  const g = (id, k) => S.getVal(st, st.entities.get(id), k);
  return {
    L: [g(L, 'x1'), g(L, 'y1'), g(L, 'x2'), g(L, 'y2')],
    P: [g(P, 'x'), g(P, 'y')],
    M: [g(M, 'x1'), g(M, 'y1'), g(M, 'x2'), g(M, 'y2')],
    C: [g(C, 'cx'), g(C, 'cy')],
  };
}, [ids.L, ids.P, ids.M, ids.C]);
const w2s = (x, y) => page.evaluate(([wx, wy]) => { const s = window.__IW.cam.w2s(wx, wy); return [s[0], s[1]]; }, [x, y]);

const before = await read();
console.log(`初始：L=(${before.L.join(',')})  P=(${before.P.join(',')})  M=(${before.M.join(',')})  C=(${before.C.join(',')})`);

// ---------- 拖动 M 的左端点（真实鼠标） ----------
const from = await w2s(before.M[0], before.M[1]);
const to = await w2s(before.M[0] + 1, before.M[1] - 2);      // 位移 (1, -2)
await page.mouse.move(from[0], from[1]);
await page.mouse.down();
await page.mouse.move(to[0], to[1], { steps: 14 });
await page.mouse.up();
await wait(500);
const after = await read();
console.log(`拖 M 后：L=(${after.L.join(',')})  P=(${after.P.join(',')})  M=(${after.M.join(',')})  C=(${after.C.join(',')})`);

const dx = after.M[0] - before.M[0], dy = after.M[1] - before.M[1];
console.log(`M 的实际位移 = (${dx.toFixed(2)}, ${dy.toFixed(2)})`);

// ① 拖动确实生效（否则下面的断言无意义）
if (Math.hypot(dx, dy) < 0.4) bad.push(`拖动没有生效（M 位移仅 ${Math.hypot(dx, dy).toFixed(2)}）`);

// ② 铁棍始终水平
const tilt = Math.abs(after.L[3] - after.L[1]);
console.log(`① 铁棍水平：y1=${after.L[1].toFixed(3)} y2=${after.L[3].toFixed(3)}（差 ${tilt.toExponential(1)}）`);
if (!(tilt < 1e-6)) bad.push(`铁棍被拽歪了：y1=${after.L[1]} y2=${after.L[3]}（差 ${tilt}）`);

// ③ 铁棍整体平移：两端位移一致，且约等于 M 的位移
const dL1 = [after.L[0] - before.L[0], after.L[1] - before.L[1]];
const dL2 = [after.L[2] - before.L[2], after.L[3] - before.L[3]];
console.log(`② 左端位移=(${dL1[0].toFixed(2)}, ${dL1[1].toFixed(2)})  右端位移=(${dL2[0].toFixed(2)}, ${dL2[1].toFixed(2)})（应相同 = 整体平移）`);
if (Math.abs(dL1[0] - dL2[0]) > 1e-6 || Math.abs(dL1[1] - dL2[1]) > 1e-6) {
  bad.push(`铁棍不是整体平移：左端位移 (${dL1}) vs 右端位移 (${dL2})`);
}
if (Math.hypot(dL2[0] - dx, dL2[1] - dy) > 0.05) {
  bad.push(`铁棍没有被"力"带到 M 的位移量（期望 ≈(${dx.toFixed(2)}, ${dy.toFixed(2)})，实测 (${dL2[0].toFixed(2)}, ${dL2[1].toFixed(2)})）`);
}

// ④ 圆跟着一起平移，并全程绑在铁棍右端
const dC = [after.C[0] - before.C[0], after.C[1] - before.C[1]];
console.log(`③ 圆位移=(${dC[0].toFixed(2)}, ${dC[1].toFixed(2)})（应≈铁棍位移）`);
if (Math.hypot(dC[0] - dL2[0], dC[1] - dL2[1]) > 1e-6) bad.push(`圆没有跟着铁棍走（圆位移 (${dC}) vs 铁棍位移 (${dL2})）`);
const stillBound = await page.evaluate(([L, C]) => {
  const S = window.__IW.S, st = window.__IW.st;
  return Math.abs(S.getVal(st, st.entities.get(C), 'cx') - S.getVal(st, st.entities.get(L), 'x2')) < 1e-9
      && Math.abs(S.getVal(st, st.entities.get(C), 'cy') - S.getVal(st, st.entities.get(L), 'y2')) < 1e-9;
}, [ids.L, ids.C]);
console.log(`④ 全程绑定在线上 = ${stillBound}（C === L 的右端）`);
if (!stillBound) bad.push('圆与铁棍的绑定关系被破坏');

// ⑤ 点 P 也在它该在的位置（与 M 同步）
if (Math.hypot(after.P[0] - after.M[0], after.P[1] - after.M[1]) > 1e-6) {
  bad.push(`点 P 没跟上 M（P=(${after.P}) M 左端=(${after.M[0]}, ${after.M[1]})）`);
}

// ⑥ 竖直铁棍同样可用（用**独立场景**：手动重置参数会与基线机制冲突，那不是真实操作）
const vids = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); st.probes.clear(); st.rigidBase = new Map();
  cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const L = S.addEntity(st, 'segment', { x1: 0, y1: -5, x2: 0, y2: 5 });   // 竖直铁棍（长 10）
  const P = S.addEntity(st, 'point', { x: 0, y: 5 });
  const M = S.addEntity(st, 'segment', { x1: 0, y1: 5, x2: 0, y2: 9 });    // 驱动者
  S.addConstraint(st, 'vertical', [L.id]);
  S.addBinding(st, L.id, 'x2', P.label + '.x');
  S.addBinding(st, L.id, 'y2', P.label + '.y');
  S.addBinding(st, P.id, 'x', M.label + '.x1');
  S.addBinding(st, P.id, 'y', M.label + '.y1');
  S.ensureEvaluated(st, { solve: true });
  window.__IW.renderOnce();
  return { L: L.id, M: M.id };
});
const vread = () => page.evaluate(([L]) => {
  const S = window.__IW.S, st = window.__IW.st;
  const g = (k) => S.getVal(st, st.entities.get(L), k);
  return [g('x1'), g('y1'), g('x2'), g('y2')];
}, [vids.L]);
const vb = await vread();
console.log(`⑤ 竖直场景初始：L=(${vb.map((v) => v.toFixed(2)).join(",")})`);
// 拖动驱动者（沿 x 移动 → 竖直铁棍必须整体平移，且保持竖直、长度不变）
const vfrom = await page.evaluate(([M]) => { const st = window.__IW.st; const m = st.entities.get(M); const s = window.__IW.cam.w2s(m.params.x1, m.params.y1); return [s[0], s[1]]; }, [vids.M]);
const vto = await w2s((await page.evaluate(([M]) => window.__IW.st.entities.get(M).params.x1, [vids.M])) + 2, (await page.evaluate(([M]) => window.__IW.st.entities.get(M).params.y1, [vids.M])));
await page.mouse.move(vfrom[0], vfrom[1]);
await page.mouse.down();
await page.mouse.move(vto[0], vto[1], { steps: 12 });
await page.mouse.up();
await wait(500);
const va = await vread();
const vTilt = Math.abs(va[2] - va[0]);
const vLen = Math.abs(va[3] - va[1]);
console.log(`⑤ 竖直场景拖动后：L=(${va.map((v) => v.toFixed(2)).join(",")})  x 之差=${vTilt.toExponential(1)}（应≈0）长度=${vLen.toFixed(2)}（应≈10）`);
if (!(vTilt < 1e-6)) bad.push(`竖直铁棍被拽歪了（x1=${va[0]} x2=${va[2]}，差 ${vTilt}）`);
if (Math.abs(vLen - 10) > 0.05) bad.push(`竖直铁棍被拉长/缩短了（长度 ${vLen.toFixed(2)}，应 10 → 刚体不变形）`);
if (Math.hypot(va[0] - vb[0], va[1] - vb[1]) < 0.4) bad.push("竖直场景拖动没有生效");
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/rigid-rod-chain.png' });
console.log('截图 → tests/artifacts/rigid-rod-chain.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ 端到端通过：拖 M → 力沿绑定链传到水平铁棍 → 铁棍整体平移（始终水平）→ 圆跟着走且全程绑在线上');
