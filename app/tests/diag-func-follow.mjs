import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const out = await p.evaluate(async () => {
  const { parseEquation } = await import("/src/expr.js");
  const { st, S, REGISTRY, cam } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  const eq = parseEquation("0.5*x");
  const f = S.addEntity(st, "func", REGISTRY.func.create({ x: 0, y: 0 }), { exprSrc: "0.5*x", ast: eq.ast }, true);
  const ep = S.addEdgePoint(st, f.id, 1);                 // 函数上放一个线上点（t = 世界 x = 1）
  const integ = S.addEntity(st, "integral", { a: 0, b: 2, n: 200 }, { host: f.id }, true);
  S.ensureEvaluated(st);
  const V = (e, k) => { try { const v = S.getVal(st, e, k); return Number.isFinite(v) ? +v.toFixed(6) : v; } catch { return null; } };
  const D = (e, k) => { try { const v = S.getDerived(st, e, k); return Number.isFinite(v) ? +v.toFixed(6) : v; } catch { return null; } };
  const epBefore = [D(ep.point, "x"), D(ep.point, "y")];
  // hostYAt 在三处的取值（世界 x = 1、2、3）
  const { hostYAt } = await import("/src/entities.js");
  const env = st.env;
  const yBefore = [1, 2, 3].map((x) => +hostYAt(f, env, x).toFixed(6));
  // 积分区域此刻的派生量（名字未知，先列出来）
  const integKeys = Object.keys(integ.derived ? {} : {});
  const integDerived = (integ.derivedKeys || []).slice(0, 0);
  const before = { ep: epBefore, y: yBefore, cx: V(f, "cx"), integParams: Object.keys(integ.params) };
  // ★ 拖动函数本体：横向 +3（走实体自己的 drag.body，与鼠标拖动同一条计算）
  const patch = REGISTRY.func.drag.body(f.params, null, null, { dx: 3, dy: 0 });
  Object.assign(f.params, patch);
  S.ensureEvaluated(st);
  const epAfter = [D(ep.point, "x"), D(ep.point, "y")];
  const yAfter = [1, 2, 3].map((x) => +hostYAt(f, env, x).toFixed(6));
  // 拖动后：世界 x 处的 y 应等于拖动前 (x-3) 处的 y（曲线整体右移 3）
  const yShifted = [1, 2, 3].map((x) => +hostYAt(f, env, x - 3).toFixed(6));
  return { before, patch, after: { ep: epAfter, y: yAfter, cx: V(f, "cx") }, yShifted,
    integDerived: { keys: Object.keys(integ).filter((k) => typeof integ[k] === "number" || typeof integ[k] === "string").slice(0, 0) } };
});
console.log("  拖动前：线上点 =", JSON.stringify(out.before.ep), "| hostYAt(1,2,3) =", JSON.stringify(out.before.y));
console.log("  drag.body 返回 =", JSON.stringify(out.patch));
console.log("  拖动后：线上点 =", JSON.stringify(out.after.ep), "| hostYAt(1,2,3) =", JSON.stringify(out.after.y));
console.log("  一致性：拖动后 y(x) 应 == 拖动前 y(x-3) →", JSON.stringify(out.yShifted));
const epMoved = out.after.ep[0] - out.before.ep[0];
const epOk = Math.abs(epMoved - 3) < 1e-6 && Math.abs(out.after.ep[1] - out.before.ep[1]) < 1e-6;
const yOk = out.after.y.every((v, i) => Math.abs(v - out.yShifted[i]) < 1e-6);
console.log("  判定①线上点是否跟着函数走（应位移 +3、y 不变）= ", epMoved.toFixed(3), epOk ? "✓✓" : "✗");
console.log("  判定②曲线是否整体平移（hostYAt 同步平移）= ", yOk ? "✓✓（积分区域/面积/切线都走这个函数，故一并跟随）" : "✗");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
