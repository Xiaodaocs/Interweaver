// T2/T3 硬要求 · 并入 npm run verify（无需浏览器：布局与走线都是纯函数）
//
// 四条要求（设计 §2.2 / §2.4 / §3）：
//   ① 任意两节点最小间距 ≥ 46px
//   ② 无重叠
//   ③ 带内归属：没有节点被挤出自己的组带
//   ④ 走线不穿过任何非端点节点（0 段）
// 另外核验"线之间避让"：每条边独占一条车道（被共用的车道数 = 0）。
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const L = layoutStarMap();
const s = L.stats;
ok(s.minGap >= 45.5, `① 任意两节点最小间距 ${s.minGap.toFixed(1)}px ≥ 46`);
ok(s.overlaps.length === 0, `② 无重叠（重叠对 ${s.overlaps.length}）`);
ok(s.bandOut <= 0.5, `③ 带内归属：带外溢出 ${s.bandOut.toFixed(1)}px ≤ 0.5`);

const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col };
});
const r = routeEdges(nodes, L.deps.map(([from, to]) => ({ from, to, kind: 'dep' })));
ok(r.stats.passThrough === 0, `④ 走线穿过非端点节点 ${r.stats.passThrough} 段（要求 0）`);
ok(r.paths.filter((p) => p.blocked).length === 0, `④b 被判"无法避开"的边 ${r.paths.filter((p) => p.blocked).length} 条（要求 0）`);

const shared = [...r.laneUse.entries()].filter(([, u]) => u > 1);
ok(shared.length === 0, `⑤ 线之间避让：被共用的车道 ${shared.length} 条（要求 0；每条边独占一条）`);

// ⑥ 交叉数与曲线占比（长边曲线化后的实测：交叉 57 → 20、曲线 12 条 = 19%）
const curves = r.paths.filter((p) => p.curve);
ok(r.stats.bridgeCount <= 30, `⑥ 交叉（拱桥）数 ${r.stats.bridgeCount} ≤ 30（长边曲线化前为 57）`);
ok(curves.length > 0 && curves.length / r.stats.edges <= 0.25,
  `⑥b 长边曲线占比 ${(curves.length / r.stats.edges * 100).toFixed(0)}%（${curves.length} 条，上限 25%）`);

console.log(`\n布局与走线核验: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
