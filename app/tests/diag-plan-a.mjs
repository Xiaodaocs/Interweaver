import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const r = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  const Rr = await import("/src/presetRecipes.js");
  const { st, S, cam, renderOnce } = window.__IW;
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  // ① 生成器路径：直接按 fx.js 的装配方式造（同 viewDomainX + 同 parseEquation + 同 extra 键）
  const eq = (await import("/src/expr.js")).parseEquation("3*exp(-0.15*x)*sin(2*x)");
  const [dmin, dmax] = S.viewDomainX(cam);
  const gen = S.addEntity(st, "func", { dmin, dmax }, { exprSrc: "3*exp(-0.15*x)*sin(2*x)", ast: eq.ast }, true);
  // ② 预设路径：presetRecipes 的装配（presetExtraWithExpr）
  const preset = M.PRESETS.find((x) => x.key === "damped");
  const params = M.createFromPreset(preset, { x: 0, y: 0 });
  if (preset.type === "func") { const [a, b2] = S.viewDomainX(cam); params.dmin = a; params.dmax = b2; }
  const pre = S.addEntity(st, preset.type, params, Rr.presetExtraWithExpr(preset, { x: 0, y: 0 }, M.presetExtra ? M.presetExtra(preset, { x: 0, y: 0 }) : undefined), true);
  S.ensureEvaluated(st); renderOnce();
  return { gen: { dmin: V(gen, "dmin"), dmax: V(gen, "dmax"), exprSrc: gen.exprSrc, hasAst: !!gen.ast, keys: Object.keys(gen.params) },
           pre: { dmin: V(pre, "dmin"), dmax: V(pre, "dmax"), exprSrc: pre.exprSrc, hasAst: !!pre.ast, keys: Object.keys(pre.params) } };
});
const same = r.gen.dmin === r.pre.dmin && r.gen.dmax === r.pre.dmax && r.gen.hasAst === r.pre.hasAst
  && JSON.stringify(r.gen.keys) === JSON.stringify(r.pre.keys) && !!r.gen.exprSrc && !!r.pre.exprSrc;
console.log("  生成器产物 =", JSON.stringify(r.gen));
console.log("  预设  产物 =", JSON.stringify(r.pre));
console.log("  判定：两条路径装配一致 =", same, same ? "✓ A 方案达成（同解析器/同字段/同定义域规则）" : "✗ 仍有分叉");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
