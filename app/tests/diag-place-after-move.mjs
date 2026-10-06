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
  S.ensureEvaluated(st);
  // ★ 模拟用户操作：先把函数拖走（cx: 0 → 3），再用**点工具**在曲线上点一个线上点
  const patch = REGISTRY.func.drag.body(f.params, null, null, { dx: 3, dy: 0 });
  Object.assign(f.params, patch);
  S.ensureEvaluated(st);
  const { projectOnHost, hostYAt } = await import("/src/entities.js");
  // 用户点击的世界位置：曲线上 x=5 处（函数已右移 3，此处 y = f(5-3) = f(2) = 1）
  const clickW = { x: 5, y: hostYAt(f, st.env, 5) };
  // 工具层走的正是这个入口：世界坐标 → 参数 t
  const t = projectOnHost(f, st.env, clickW);
  const r = S.addEdgePoint(st, f.id, t);
  S.ensureEvaluated(st);
  const D = (e, k) => { try { const v = S.getDerived(st, e, k); return Number.isFinite(v) ? +v.toFixed(6) : v; } catch { return "ERR"; } };
  return { t: +t.toFixed(6), placed: r ? { x: D(r.point, "x"), y: D(r.point, "y") } : null,
    click: [clickW.x, +clickW.y.toFixed(6)], expect: [5, 1] };
});
console.log("  点击（世界）=", JSON.stringify(out.click), "｜投影 t =", out.t, "（自身坐标应 = 5−3 = 2）");
console.log("  放置的线上点 =", JSON.stringify(out.placed), "｜期望 =", JSON.stringify(out.expect));
const okp = out.placed && Math.abs(out.placed[0] - 5) < 1e-6 && Math.abs(out.placed[1] - 1) < 1e-6;
console.log("  判定：", okp ? "线上点**正好落在你点击的位置** ✓✓（函数被拖走后也能正常放置）" : "✗ 位置不对");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
