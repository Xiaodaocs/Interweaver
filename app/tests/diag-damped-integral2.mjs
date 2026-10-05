import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const setup = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  const R = await import("/src/presetRecipes.js");
  const { st, S, cam } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  const preset = M.PRESETS.find((x) => x.key === "damped");
  const at = { x: 0, y: 0 };
  const params = M.createFromPreset(preset, at);
  const [dmin, dmax] = S.viewDomainX(cam);
  params.dmin = dmin; params.dmax = dmax;
  const extra = R.presetExtraWithExpr(preset, at, M.presetExtra ? M.presetExtra(preset, at) : undefined);
  const f = S.addEntity(st, preset.type, params, extra, true);
  const ig = S.addEntity(st, "integral", { a: -2, b: 2, n: 8, method: 0 }, { host: f.id }, true);
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  return { f: f.id, ig: ig.id };
});
const read = () => p.evaluate(async ([fid, igid]) => {
  const { hostYAt } = await import("/src/entities.js");
  const { st, S, cam } = window.__IW;
  const f = st.entities.get(fid), ig = st.entities.get(igid);
  const V = (e, k) => { try { const v = S.getVal(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  const D = (e, k) => { try { const v = S.getDerived(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  // 曲线在 x=-8 处的屏幕位置（用来确认"函数真的移动了"）
  const y8 = hostYAt(f, st.env, -8);
  const scr = cam.w2s(-8, y8);
  return { cx: V(f, "cx"), cy: V(f, "cy"), S: D(ig, "S"), exact: D(ig, "exact"), a: V(ig, "a"), b: V(ig, "b"),
    y8: +y8.toFixed(3), scr: [Math.round(scr[0]), Math.round(scr[1])], curveX8: +(-8).toFixed(2) };
}, [setup.f, setup.ig]);
const before = await read();
console.log("  拖动前：cx =", before.cx, "| 积分 S =", before.S, "| exact =", before.exact, "| a,b =", before.a + "," + before.b);
console.log("          曲线在 x=-8 的屏幕点 =", JSON.stringify(before.scr), "（y =", before.y8, "）");
// 抓取点取 x=-8（积分区间是 [-2,2]，远离它 → 只会命中函数本体）
const g = await p.evaluate(async ([xw]) => {
  const { hostYAt } = await import("/src/entities.js");
  const { st, cam } = window.__IW;
  const f = [...st.entities.values()].find((e) => e.type === "func");
  const y = hostYAt(f, st.env, xw);
  const s = cam.w2s(xw, y);
  return { x: s[0], y: s[1] };
}, [-8]);
await p.evaluate(() => { window.__IW.st.tool = "select"; });
await p.mouse.move(g.x, g.y);
await p.mouse.down();
for (let i = 1; i <= 10; i++) { await p.mouse.move(g.x + i * 14, g.y); await wait(20); }
await p.mouse.up();
await wait(400);
const after = await read();
console.log("  拖动后：cx =", after.cx, "| 积分 S =", after.S, "| exact =", after.exact, "| a,b =", after.a + "," + after.b);
console.log("          曲线在 x=-8 的屏幕点 =", JSON.stringify(after.scr), "（y =", after.y8, "）");
console.log("  判定①函数是否真的移动（cx 变化/抓取点屏幕位移）=", (after.cx !== before.cx) ? "cx 变了 ✓" : "cx 没变 ✗",
  "| 屏幕位移 =", (g.x - after.scr[0]).toFixed(1), "px（期望 ≈140 向左 → 抓取点右移则世界点左移）");
console.log("  判定②积分值是否跟随 =", after.S !== before.S ? "变了 ✓" : "**没变 ✗**", "（", before.S, "→", after.S, "）");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
