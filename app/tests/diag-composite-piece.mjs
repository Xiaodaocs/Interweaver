import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const out = await p.evaluate(async () => {
  const R = await import("/src/presetRecipes.js");
  const { st, S, REGISTRY, renderOnce } = window.__IW;
  const res = [];
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  const curveIdx = (type) => [...st.entities.values()].filter((e) => e.type === type);
  const testHost = (label, pname, hostType) => {
    const host = curveIdx(hostType)[0];
    if (!host) { res.push({ label, err: "配方里没有 " + hostType }); return; }
    // 取它 dmin/dmax 内的一段（窄窗口也安全）
    const dm = V(host, "dmin"), dx = V(host, "dmax");
    const t1 = dm + (dx - dm) * 0.15, t2 = dm + (dx - dm) * 0.6;
    const e1 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e1.host = host.id; e1.params.t = t1;
    const e2 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e2.host = host.id; e2.params.t = t2;
    const cp = S.makeHostedPiece(st, host, e1.id, e2.id);
    S.ensureEvaluated(st); renderOnce();
    const det = S.detachPiece(st, cp.id);
    S.ensureEvaluated(st); renderOnce();
    const made = det && det.entity;
    if (!made) { res.push({ label, err: (det && det.error) || "解绑无产物" }); return; }
    const offKey = made.type === "sine" ? "cx" : (made.type === "parabola" ? "h" : "cx");
    const yAt = made.type === "sine" ? (k, x) => REGISTRY.sine.yAt(k, x)
      : made.type === "parabola" ? (k, x) => REGISTRY.parabola.yAt(k, x) : null;
    const sample = () => [0.2, 0.5, 0.8].map((f) => {
      if (!yAt) return null;
      const off = V(made, offKey) || 0;
      const x = V(made, "dmin") + off + (V(made, "dmax") - V(made, "dmin")) * f;   // 世界 x
      return [+x.toFixed(4), +yAt((k) => V(made, k), x).toFixed(4)];
    });
    const before = sample();
    const hostBefore = { cx: V(host, "cx"), cy: V(host, "cy"), h: V(host, "h"), k: V(host, "k") };
    const patch = REGISTRY[made.type].drag.body(made.params, null, null, { dx: 120, dy: 40 });
    Object.assign(made.params, patch);
    S.ensureEvaluated(st); renderOnce();
    const after = sample();
    const deltas = before.map((b2, i) => (b2 && after[i]) ? [+(after[i][0]-b2[0]).toFixed(3), +(after[i][1]-b2[1]).toFixed(3)] : null);
    const hostAfter = { cx: V(host, "cx"), cy: V(host, "cy"), h: V(host, "h"), k: V(host, "k") };
    const hostMoved = JSON.stringify(hostBefore) !== JSON.stringify(hostAfter);
    res.push({ label, pname, type: made.type, deltas, hostMoved, ok: deltas.every((d) => d && Math.abs(d[0]-120) < 0.01 && Math.abs(d[1]-40) < 0.01) });
  };
  // 逐个复合预设：清场 → 放配方 → 测其中的曲线
  for (const [key, name, hostType] of [["circlesine", "圆-正弦联动", "sine"], ["parafocus", "抛物线焦点·准线", "parabola"]]) {
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    R.RECIPES[key]?.(st, { x: 0, y: 0 });
    S.ensureEvaluated(st); renderOnce();
    testHost(name, key, hostType);
  }
  return res;
});
for (const r of out) {
  if (r.err) { console.log("  ✗ " + r.label + ": " + r.err); continue; }
  console.log("  " + (r.ok ? "✓" : "✗") + " " + r.label + "（配方里的 " + r.type + "）截段→解绑→拖动位移 = " + JSON.stringify(r.deltas));
  console.log("      宿主是否移动 = " + r.hostMoved + "（应为 false）");
}
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
