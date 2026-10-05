import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const r = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  const { st, S, REGISTRY, renderOnce } = window.__IW;
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
  const preset = M.PRESETS.find((x) => x.key === "sine");
  const host = S.addEntity(st, preset.type, M.createFromPreset(preset, { x: 0, y: 0 }), M.presetExtra(preset, { x: 0, y: 0 }), true);
  const e1 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e1.host = host.id; e1.params.t = -4;
  const e2 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e2.host = host.id; e2.params.t = 4;
  const cp = S.makeHostedPiece(st, host, e1.id, e2.id);
  S.ensureEvaluated(st); renderOnce();
  const before = { e1: { host: e1.host, t: V(e1, "t"), x: V(e1, "x"), y: V(e1, "y") },
                   e2: { host: e2.host, t: V(e2, "t"), x: V(e2, "x"), y: V(e2, "y") } };
  const det = S.detachPiece(st, cp.id);
  S.ensureEvaluated(st); renderOnce();
  const a1 = st.entities.get(e1.id), a2 = st.entities.get(e2.id);
  const after = { e1Alive: !!a1, e2Alive: !!a2,
    e1: a1 ? { host: a1.host, t: V(a1, "t"), x: V(a1, "x"), y: V(a1, "y") } : null,
    e2: a2 ? { host: a2.host, t: V(a2, "t"), x: V(a2, "x"), y: V(a2, "y") } : null,
    pieceAlive: !!st.entities.get(cp.id), made: det.entity ? det.entity.type : (det.error || null) };
  // 再拖动解绑产物，确认两个点完全不受影响
  let drift = null;
  if (det.entity) {
    const patch = REGISTRY[det.entity.type].drag.body(det.entity.params, null, null, { dx: 150, dy: 60 });
    Object.assign(det.entity.params, patch);
    S.ensureEvaluated(st); renderOnce();
    drift = { e1: { t: V(a1, "t"), x: V(a1, "x"), y: V(a1, "y") },
              e2: { t: V(a2, "t"), x: V(a2, "x"), y: V(a2, "y") } };
  }
  return { before, after, drift };
});
console.log("  解绑前：e1 =", JSON.stringify(r.before.e1), " e2 =", JSON.stringify(r.before.e2));
console.log("  解绑后：两个点存活 =", r.after.e1Alive + "/" + r.after.e2Alive, "| 裁切段存活 =", r.after.pieceAlive, "| 产物 =", r.after.made);
console.log("          e1 =", JSON.stringify(r.after.e1));
console.log("          e2 =", JSON.stringify(r.after.e2));
const same = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);
console.log("  逐项判定：");
console.log("    e1 完全不变 =", same(r.before.e1, r.after.e1) ? "✓" : "✗ 变了");
console.log("    e2 完全不变 =", same(r.before.e2, r.after.e2) ? "✓" : "✗ 变了");
if (r.drift) {
  console.log("  拖动解绑曲线 (+150,+60) 之后：");
  console.log("    e1 =", JSON.stringify(r.drift.e1), (same(r.drift.e1, r.after.e1) ? "（不变 ✓）" : "（变了 ✗）"));
  console.log("    e2 =", JSON.stringify(r.drift.e2), (same(r.drift.e2, r.after.e2) ? "（不变 ✓）" : "（变了 ✗）"));
}
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
