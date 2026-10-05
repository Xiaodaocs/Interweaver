// 诊断：预设库曲线与自建曲线在"裁段 → 显式解绑 → 拖动"上的行为是否一致（② 的验收脚本）
//   用户报告过"问题2没修预设库里面的曲线内容"与"自建函数上点两个点仍然可以直接拖出"。
//   前者的元凶其实是：我当时加的"拖动即自动解绑"只在交互路径上生效，
//   导致预设/自建两条创建路径的"要不要先解绑"行为不一致（新旧逻辑冲突）。
//   自动解绑已撤掉。本脚本用真实导出（PRESETS / createFromPreset / presetExtra / makeHostedPiece /
//   detachPiece）复现"预设正弦波 → 两点截段 → 解绑 → 拖动"，并断言：
//     · 解绑产物保持形状参数（A/lam）不变 → 是整体平移，不是变形；
//     · 宿主参数不动；
//     · 拖动只改 cx/cy。
//   运行：node tests/diag-preset-detach.mjs

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
// 先列出真实导出，避免猜名字
const ex = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  return Object.keys(M).filter((k) => /preset|Preset|material|hosted|piece|detach/i.test(k));
});
console.log("  entities.js 里相关的真实导出 =", JSON.stringify(ex));
const r = await p.evaluate(async (names) => {
  const M = await import("/src/entities.js");
  const { st, S, REGISTRY, renderOnce } = window.__IW;
  if (!M.PRESETS) return { err: "没有 PRESETS" };
  const preset = M.PRESETS.find((x) => x.key === "sine");     // 预设库的"正弦波"
  const at = { x: 0, y: 0 };
  const params = M.createFromPreset(preset, at);
  const extra = M.presetExtra ? M.presetExtra(preset, at) : undefined;
  const host = S.addEntity(st, preset.type, params, extra, true);
  const e1 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e1.host = host.id; e1.params.t = -4;
  const e2 = S.addEntity(st, "edgepoint", REGISTRY.edgepoint.create({}), true); e2.host = host.id; e2.params.t = 4;
  const cp = S.makeHostedPiece(st, host, e1.id, e2.id);
  S.ensureEvaluated(st); renderOnce();
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  return { preset: preset.name, hostType: host.type, hostParams: Object.keys(host.params), cp: cp.id, host: host.id,
    cx0: V(host, "cx"), cy0: V(host, "cy"), t1: V(e1, "t"), t2: V(e2, "t") };
}, ex);
console.log("  预设场景 =", JSON.stringify(r));
if (r.err) { await b.close(); process.exit(0); }
// 用真实入口：右键菜单的"解绑"= S.detachPiece
const det = await p.evaluate(([cpId, hostId]) => {
  const { st, S, renderOnce } = window.__IW;
  const res = S.detachPiece(st, cpId);
  S.ensureEvaluated(st); renderOnce();
  const ents = [...st.entities.values()];
  const made = ents.find((e) => e.fromLabel);
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  return { ok: !res.error, err: res.error || null, kind: res.kind || null,
    made: made ? { type: made.type, label: made.label, keys: Object.keys(made.params),
      cx: V(made, "cx"), cy: V(made, "cy"), A: V(made, "A"), lam: V(made, "lam"),
      phi: V(made, "phi"), dmin: V(made, "dmin"), dmax: V(made, "dmax") } : null,
    hostCx: V(st.entities.get(hostId), "cx"), hostCy: V(st.entities.get(hostId), "cy") };
}, [r.cp, r.host]);
console.log("  解绑结果 =", JSON.stringify(det));
// 拖动解绑出来的实体（直接调它自己的 drag.body，等价于鼠标拖动时的计算）
const drag = await p.evaluate(([hostId]) => {
  const { st, S, REGISTRY, renderOnce } = window.__IW;
  const made = [...st.entities.values()].find((e) => e.fromLabel);
  if (!made) return { err: "没有解绑产物" };
  const patch = REGISTRY[made.type].drag.body(made.params, null, null, { dx: 120, dy: 40 });
  Object.assign(made.params, patch);
  S.ensureEvaluated(st); renderOnce();
  const V = (e, k) => { try { return S.getVal(st, e, k); } catch { return null; } };
  return { patched: patch, after: { cx: V(made, "cx"), cy: V(made, "cy"), A: V(made, "A"), lam: V(made, "lam"), dmin: V(made, "dmin"), dmax: V(made, "dmax") },
    hostCx: V(st.entities.get(hostId), "cx"), hostCy: V(st.entities.get(hostId), "cy") };
}, [r.host]);
console.log("  拖动（+120, +40）后 =", JSON.stringify(drag));
const shapeKept = drag.after && Math.abs((drag.after.A ?? 0) - (det.made?.A ?? 0)) < 1e-9 && Math.abs((drag.after.lam ?? 0) - (det.made?.lam ?? 0)) < 1e-9;
console.log("  判定：形状参数(A/lam)是否保持 =", shapeKept, shapeKept ? "→ 是**整体平移** ✓ 不是变形 ✓" : "→ 形状被改了 = 变形 ✗");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
