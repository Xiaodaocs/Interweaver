import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
// 复现用户操作：预设库「阻尼振荡」→ 放积分区域 → 用**真鼠标**拖动函数本体
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
  const V = (e, k) => { try { const v = S.getVal(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  const D = (e, k) => { try { const v = S.getDerived(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  const { hostYAt } = await import("/src/entities.js");
  const env = st.env;
  return { f: f.id, ig: ig.id, cx: V(f, "cx"), dmin: V(f, "dmin"), dmax: V(f, "dmax"),
    S: D(ig, "S"), exact: D(ig, "exact"),
    yAt0: +hostYAt(f, env, 0).toFixed(4), yAt1: +hostYAt(f, env, 1).toFixed(4),
    scr0: cam.w2s(0, 0), curveAt0: [0, 0] };
});
console.log("  拖动前：cx =", setup.cx, "| 定义域 =", JSON.stringify([setup.dmin, setup.dmax]));
console.log("          积分 S =", setup.S, "| exact =", setup.exact, "| hostYAt(0) =", setup.yAt0, "| hostYAt(1) =", setup.yAt1);
// 真鼠标：在函数曲线上的某点按下（取 x=1 处的曲线点），横拖 +150px
const grab = await p.evaluate(() => {
  const { st, cam, REGISTRY, S } = window.__IW;
  const f = [...st.entities.values()].find((e) => e.type === "func");
  const y = REGISTRY.func ? null : null;
  void y;
  // 用 hostYAt 取曲线上的点
  return { x: 1, screen: cam.w2s(1, 0) };
});
const onCurve = await p.evaluate(async ([xw]) => {
  const { hostYAt } = await import("/src/entities.js");
  const { st, cam } = window.__IW;
  const f = [...st.entities.values()].find((e) => e.type === "func");
  const y = hostYAt(f, st.env, xw);
  const s = cam.w2s(xw, y);
  return { x: s[0], y: s[1], world: [xw, +y.toFixed(3)] };
}, [grab.x]);
console.log("  抓取点：世界 =", JSON.stringify(onCurve.world), "屏幕 =", [Math.round(onCurve.x), Math.round(onCurve.y)]);
await p.evaluate(() => { const st = window.__IW.st; st.tool = "select"; });
await p.mouse.move(onCurve.x, onCurve.y);
await p.mouse.down();
for (let i = 1; i <= 10; i++) { await p.mouse.move(onCurve.x + i * 15, onCurve.y); await wait(20); }
await p.mouse.up();
await wait(400);
const after = await p.evaluate(async ([fid, igid]) => {
  const { hostYAt } = await import("/src/entities.js");
  const { st, S } = window.__IW;
  const f = st.entities.get(fid), ig = st.entities.get(igid);
  const V = (e, k) => { try { const v = S.getVal(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  const D = (e, k) => { try { const v = S.getDerived(st, e, k); return Number.isFinite(v) ? +v.toFixed(4) : v; } catch { return null; } };
  return { paramCx: f.params.cx, evalCx: st.values ? st.values.get(f.id + ":cx") : "(无 values)",
    cx: V(f, "cx"), S: D(ig, "S"), exact: D(ig, "exact"),
    yAt0: +hostYAt(f, st.env, 0).toFixed(4), yAt1: +hostYAt(f, st.env, 1).toFixed(4) };
}, [setup.f, setup.ig]);
console.log("  拖动后：param.cx =", after.paramCx, "| 求值缓存 cx =", after.evalCx, "| getVal cx =", after.cx);
console.log("          积分 S =", after.S, "| exact =", after.exact, "| hostYAt(0) =", after.yAt0, "| hostYAt(1) =", after.yAt1);
console.log("  判定：S 是否变化 =", after.S !== setup.S ? "变了 ✓" : "**没变 ✗ 复现用户现象**");
console.log("        hostYAt(0) 是否变化 =", after.yAt0 !== setup.yAt0 ? "变了 ✓" : "没变 ✗");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
