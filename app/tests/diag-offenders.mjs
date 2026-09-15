// 精确定位那 2 段越界：哪一段（第几段）、车道 y、以及被穿节点的矩形
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges, NODE_W, NODE_H, OBSTACLE_PAD } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const L = layoutStarMap();
const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col };
});
const r = routeEdges(nodes, L.deps.map(([from, to]) => ({ from, to, kind: 'dep' })));
const byId = new Map(nodes.map((n) => [n.id, n]));

const offenders = [];
for (const path of r.paths) {
  for (let i = 0; i < path.points.length - 1; i++) {
    const [x1, y1] = path.points[i], [x2, y2] = path.points[i + 1];
    const horiz = Math.abs(y1 - y2) < 0.01;
    for (const n of nodes) {
      if (n.id === path.from || n.id === path.to) continue;
      const rx0 = n.x - NODE_W / 2 - OBSTACLE_PAD, rx1 = n.x + NODE_W / 2 + OBSTACLE_PAD;
      const ry0 = n.y - NODE_H / 2 - OBSTACLE_PAD, ry1 = n.y + NODE_H / 2 + OBSTACLE_PAD;
      let hit = false;
      if (horiz) {
        const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
        hit = y1 >= ry0 && y1 <= ry1 && hi > rx0 && lo < rx1;
      } else {
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        hit = x1 >= rx0 && x1 <= rx1 && hi > ry0 && lo < ry1;
      }
      if (hit) offenders.push({ from: path.from, to: path.to, segIndex: i, seg: horiz ? 'H' : 'V', laneY: path.laneY, hitNode: n.id, hitCol: n.col, seg: horiz ? `y=${y1.toFixed(1)} x∈[${Math.min(x1, x2).toFixed(1)},${Math.max(x1, x2).toFixed(1)}]` : `x=${x1.toFixed(1)} y∈[${Math.min(y1, y2).toFixed(1)},${Math.max(y1, y2).toFixed(1)}]`, hitRect: `x∈[${rx0.toFixed(1)},${rx1.toFixed(1)}] y∈[${ry0.toFixed(1)},${ry1.toFixed(1)}]` });
    }
  }
}
console.log('越界段数 =', offenders.length);
for (const o of offenders) {
  const A = byId.get(o.from), B = byId.get(o.to);
  console.log(`\n${o.from}(列${A.col}) → ${o.to}(列${B.col})  第 ${o.segIndex} 段(${o.seg})  车道 y=${o.laneY.toFixed(1)}`);
  console.log(`   段几何: ${o.seg}`);
  console.log(`   撞到:   ${o.hitNode}(列${o.hitCol})  矩形 ${o.hitRect}`);
  const path = r.paths.find((p) => p.from === o.from && p.to === o.to);
  if (path) console.log('   完整路径: ' + path.points.map(([x, y]) => `(${x.toFixed(0)},${y.toFixed(0)})`).join(' → '));
}
