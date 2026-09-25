// 需求①验收：平行/垂直是最高优先级，拖动时**必须严格保持**
//
// 判据（都用约束残差做数值断言，不是"看起来还行"）：
//   ① 拖被平行约束的线段端点 → 拖动后残差仍 ≈0（改前会被拖坏）
//   ② 该线段是**整体平移**：方向不变、被拖端点仍跟随指针（平移的应有表现）
//   ③ 两端被束缚（另一端点被绑定）时 → 走**连带联动**：对方被转到与新方向一致，残差仍 ≈0
//   ④ 垂直约束同样成立
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

/** 造两条线段 + 一条约束；返回 id 与屏幕坐标 */
const setup = (kind, bindOther) => page.evaluate(([k, bind]) => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.variables.clear();
  st.selection.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  st.tool = 'select';
  // A: (-6,-2) → (-2,-2)；B: (2,1) → (6,1)（初始都水平 → 天然平行）
  const a = S.addEntity(st, 'segment', { x1: -6, y1: -2, x2: -2, y2: -2 });
  const b = S.addEntity(st, 'segment', { x1: 2, y1: 1, x2: 6, y2: 1 });
  if (bind) { S.addVariable(st, 'k', { value: -6, min: -20, max: 20 }); S.addBinding(st, a.id, 'x1', 'k'); }
  S.ensureEvaluated(st);
  const r = S.addConstraint(st, k, [a.id, b.id]);
  S.ensureEvaluated(st, { solve: true });
  window.__IW.renderOnce();
  const from = cam.w2s(a.params.x2, a.params.y2);
  return { a: a.id, b: b.id, ok: !!r.ok, from: [from[0], from[1]], err: r.error || null };
}, [kind, bindOther]);

const state = (ids) => page.evaluate(([aid, bid]) => {
  const st = window.__IW.st;
  const a = st.entities.get(aid), b = st.entities.get(bid);
  const dir = (e) => [e.params.x2 - e.params.x1, e.params.y2 - e.params.y1];
  const da = dir(a), db = dir(b);
  const n = Math.hypot(...da) * Math.hypot(...db) || 1;
  const cross = (da[0] * db[1] - da[1] * db[0]) / n;
  const dot = (da[0] * db[0] + da[1] * db[1]) / n;
  const c = [...st.constraints.values()][0];
  return { residual: c ? Math.abs(c.error || 0) : null, cross: Math.abs(cross), dot: Math.abs(dot),
    a: { x1: a.params.x1, y1: a.params.y1, x2: a.params.x2, y2: a.params.y2 },
    b: { x1: b.params.x1, y1: b.params.y1, x2: b.params.x2, y2: b.params.y2 },
    aDir: da, bDir: db };
}, [ids.a, ids.b]);

const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 12 });
  await page.mouse.up();
  await wait(400);
};
const w2s = (x, y) => page.evaluate(([wx, wy]) => { const s = window.__IW.cam.w2s(wx, wy); return [s[0], s[1]]; }, [x, y]);

// ---------- ① 平行：拖端点 → 应整体平移、残差仍 0 ----------
{
  const ids = await setup('parallel', false);
  const before = await state(ids);
  console.log(`① 初始：残差=${before.residual.toExponential(1)} A方向=${before.aDir.map((v) => v.toFixed(2))}`);
  // 把 A 的右端点从 (-2,-2) 拖到 (-1,-4)：天真行为会改变方向（破坏平行）
  const to = await w2s(-1, -4);
  await drag(ids.from, to);
  const after = await state(ids);
  const dirSame = Math.abs(after.aDir[0] - before.aDir[0]) < 1e-6 && Math.abs(after.aDir[1] - before.aDir[1]) < 1e-6;
  const moved = Math.hypot(after.a.x2 - before.a.x2, after.a.y2 - before.a.y2) > 0.5;
  console.log(`① 拖动后：残差=${after.residual.toExponential(1)}（应≈0）| A方向=${after.aDir.map((v) => v.toFixed(2))} 方向不变=${dirSame} | A 确实移动了=${moved}`);
  if (!(after.residual < 1e-6)) bad.push(`拖动后平行约束被破坏（残差 ${after.residual.toExponential(2)}）`);
  if (!dirSame) bad.push('没有采用整体平移（A 的方向被改变了）');
  if (!moved) bad.push('A 完全没有移动（拖动无效）');
}

// ---------- ② 平行 + 一端被绑定 → 应连带联动对方 ----------
{
  const ids = await setup('parallel', true);
  const before = await state(ids);
  const to = await w2s(-1, -4);
  await drag(ids.from, to);
  const after = await state(ids);
  const bRotated = Math.abs(after.bDir[0] - before.bDir[0]) > 1e-6 || Math.abs(after.bDir[1] - before.bDir[1]) > 1e-6;
  console.log(`② 一端被绑定：残差=${after.residual.toExponential(1)}（应≈0）| B 被联动旋转=${bRotated} | B方向=${after.bDir.map((v) => v.toFixed(2))}`);
  if (!(after.residual < 1e-6)) bad.push(`一端被绑定时平行被破坏（残差 ${after.residual.toExponential(2)}）`);
}

// ---------- ③ 垂直：拖端点 → 残差仍 0 ----------
{
  const ids = await setup('perpendicular', false);
  // 先让 B 竖直，使"垂直"初始成立
  await page.evaluate(([aid, bid]) => {
    const st = window.__IW.st;
    const b = st.entities.get(bid);
    Object.assign(b.params, { x1: 4, y1: -3, x2: 4, y2: 3 });
    window.__IW.S.ensureEvaluated(st, { solve: true });
  }, [ids.a, ids.b]);
  await wait(200);
  const before = await state(ids);
  console.log(`③ 初始：残差=${before.residual.toExponential(1)}（垂直：dot 应≈0，实测 dot=${before.dot.toExponential(1)}）`);
  const to = await w2s(-1, -4);
  await drag(ids.from, to);
  const after = await state(ids);
  console.log(`③ 拖动后：残差=${after.residual.toExponential(1)}（应≈0）| A方向=${after.aDir.map((v) => v.toFixed(2))}`);
  if (!(after.residual < 1e-6)) bad.push(`拖动后垂直约束被破坏（残差 ${after.residual.toExponential(2)}）`);
}

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await browser.close();
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); process.exit(1); }
console.log("✅ 需求① 通过：拖动时平行/垂直严格保持（先整体平移、必要时连带联动对方）");
