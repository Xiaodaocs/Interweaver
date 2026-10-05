import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
// 对三个宿主各做一遍：预设正弦波 / 预设抛物线 / 自建函数(阻尼振荡风格) → 截段 → 解绑 → 拖动
const out = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  const { st, S, REGISTRY, renderOnce } = window.__IW;
  const res = [];
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  const cases = [
    { name: "预设正弦波", preset: M.PRESETS.find((x) => x.key === "sine") },
    { name: "预设抛物线", preset: M.PRESETS.find((x) => x.key === "parabola") },
    { name: "预设余弦波", preset: M.PRESETS.find((x) => x.key === "cosine") },
  ];
  for (const c of cases) {
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    const at = { x: 0, y: 0 };
    const host = S.addEntity(st, c.preset.type, M.createFromPreset(c.preset, at), M.presetExtra ? M.presetExtra(c.preset, at) : undefined, true);
    const e1 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e1.host = host.id; e1.params.t = -4;
    const e2 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e2.host = host.id; e2.params.t = 4;
    const cp = S.makeHostedPiece(st, host, e1.id, e2.id);
    S.ensureEvaluated(st);
    const det = S.detachPiece(st, cp.id);
    S.ensureEvaluated(st); renderOnce();
    const made = det.entity;
    if (!made) { res.push({ case: c.name, err: det.error || "解绑无产物" }); continue; }
    // 严格判据：取这条曲线上几个"自身参数"位置的世界点，拖动后应整体位移相同的量
    const hosts = REGISTRY[made.type];
    const tt = [0.2, 0.5, 0.8];
    const before = tt.map((f) => {
      const off0 = made.type === "sine" ? (V(made, "cx") || 0) : (V(made, "h") || 0);
      const x = V(made, "dmin") + off0 + (V(made, "dmax") - V(made, "dmin")) * f;   // 世界 x（含偏移）
      const y = made.type === "sine" ? REGISTRY.sine.yAt((k) => V(made, k), x) : REGISTRY.parabola.yAt((k) => V(made, k), x);
      return [+x.toFixed(4), +y.toFixed(4)];
    });
    const patch = hosts.drag.body(made.params, null, null, { dx: 120, dy: 40 });
    Object.assign(made.params, patch);
    S.ensureEvaluated(st); renderOnce();
    const after = tt.map((f) => {
      const off0 = made.type === "sine" ? (V(made, "cx") || 0) : (V(made, "h") || 0);
      const x = V(made, "dmin") + off0 + (V(made, "dmax") - V(made, "dmin")) * f;   // 世界 x（含偏移）
      const y = made.type === "sine" ? REGISTRY.sine.yAt((k) => V(made, k), x) : REGISTRY.parabola.yAt((k) => V(made, k), x);
      return [+x.toFixed(4), +y.toFixed(4)];
    });
    const deltas = before.map((b2, i) => [ +(after[i][0]-b2[0]).toFixed(3), +(after[i][1]-b2[1]).toFixed(3) ]);
    // 世界窗口（绘制窗口）是否也跟着走了
    const offKey = made.type === "sine" ? "cx" : "h";
    const winBefore = [+V(made, "dmin"), +V(made, "dmax")];
    res.push({ case: c.name, type: made.type, patched: patch, deltas, expect: [120, 40],
      hostAfter: { cx: V(host, "cx"), cy: V(host, "cy"), h: V(host, "h"), k: V(host, "k") },
      offKey, offAfter: V(made, offKey), win: winBefore });
  }
  return res;
});
for (const r of out) {
  if (r.err) { console.log("  ✗ " + r.case + ": " + r.err); continue; }
  const okAll = r.deltas.every((d) => Math.abs(d[0] - 120) < 0.01 && Math.abs(d[1] - 40) < 0.01);
  console.log("  " + (okAll ? "✓" : "✗") + " " + r.case + "（" + r.type + "）位移 = " + JSON.stringify(r.deltas) + " 期望 [[120,40]×3]");
  console.log("      宿主拖动后 = " + JSON.stringify(r.hostAfter) + "（应为 0/0 不动）");
}
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
