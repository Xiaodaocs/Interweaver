import { layoutStarMap } from "../src/starmap.js";
import { KNOWLEDGE_NODES } from "../src/achievements/nodes.js";
const L = layoutStarMap();
const title = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.title]));
const layer = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.layer]));
const T = (id) => (title.get(id) || id) + "(L" + layer.get(id) + ")";
const byDiff = new Map();
for (const [a, b] of L.deps) { const d = Math.abs(layer.get(a) - layer.get(b)); byDiff.set(d, (byDiff.get(d) || 0) + 1); }
console.log("原始 " + L.rawDepCount + " 条 -> 中转后 " + L.deps.length + " 条（中转 " + L.rerouted + "，保留长边 " + L.keptLong + "）");
console.log("层差分布：", [...byDiff.entries()].sort((x, y) => x[0] - y[0]).map(([d, n]) => "Δ" + d + "×" + n).join("  "));
const nb = (id) => L.deps.filter((p) => p[0] === id || p[1] === id).map((p) => T(p[0] === id ? p[1] : p[0]));
console.log("★ 欧拉之环的邻居：", nb("n.euler").join("、"));
console.log("★ 圆 的邻居：", nb("n.circle").join("、"));
console.log("★ 圆与波同源 的邻居：", nb("w.circleWave").join("、"));
