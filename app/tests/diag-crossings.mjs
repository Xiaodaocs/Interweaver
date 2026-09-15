// 决定性问题（只测量）：57 处交叉里，有多少来自"长边"（跨 ≥3 层）？
// 若长边占了绝大多数 → 说明"长边拆段/主干道"能直接把交叉压到目标区间；
// 若短边也占很大比例 → 还需要短边的车道次序优化。
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges, NODE_W, NODE_H, OBSTACLE_PAD } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const L = layoutStarMap();
const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col };
});
const byId = new Map(nodes.map((n) => [n.id, n]));
const r = routeEdges(nodes, L.deps.map(([from, to]) => ({ from, to, kind: 'dep' })));

// 统计每个拱桥（交叉点）分别属于哪条边的哪一段，以及该边的跨列跨度
const bySpan = new Map();
for (const path of r.paths) {
  const span = Math.abs(byId.get(path.from).col - byId.get(path.to).col);
  const k = `跨${span}层`;
  if (!bySpan.has(k)) bySpan.set(k, { edges: 0, bridges: 0 });
  const e = bySpan.get(k);
  e.edges++;
  e.bridges += path.bridges.length;
}
console.log('按边的跨列跨度统计交叉：');
let total = 0;
for (const k of ['跨1层', '跨2层', '跨3层', '跨4层', '跨5层', '跨6层']) {
  const e = bySpan.get(k) || { edges: 0, bridges: 0 };
  total += e.bridges;
  console.log(`  ${k}: ${String(e.edges).padStart(2)} 条边  →  ${String(e.bridges).padStart(3)} 处交叉`);
}
console.log('  合计交叉 =', total, '（stats.bridgeCount =', r.stats.bridgeCount, '）');
const longBridges = ['跨3层', '跨4层', '跨5层', '跨6层'].reduce((s, k) => s + ((bySpan.get(k) || {}).bridges || 0), 0);
console.log(`\n长边（跨 ≥3 层）贡献的交叉 = ${longBridges} / ${total} = ${(longBridges / Math.max(1, total) * 100).toFixed(0)}%`);
console.log(longBridges / Math.max(1, total) > 0.6
  ? '→ 结论：交叉主要由长边贡献，"长边拆段/主干道"是正确对策'
  : '→ 结论：短边交叉也占很大比例，需同时优化短边的车道次序');
