// T2/T3 诊断（只测量，不改代码）：列间走廊到底存不存在？
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';
import { NODE_W, OBSTACLE_PAD } from '../src/edgeRouting.js';

const L = layoutStarMap();
const pos = L.pos;
const cols = [...new Set(KNOWLEDGE_NODES.map((n) => pos.get(n.id).col))].sort((a, b) => a - b);

const rectOf = (n) => {
  const p = pos.get(n.id);
  return { x0: p.x - NODE_W / 2, x1: p.x + NODE_W / 2, y0: p.y - 23, y1: p.y + 23, col: p.col, id: n.id };
};
const rects = KNOWLEDGE_NODES.map(rectOf);

console.log('列数 =', cols.length, ' 节点 =', KNOWLEDGE_NODES.length, ' 画布 =', Math.round(L.width) + '×' + Math.round(L.height));
console.log('\n相邻列的"实际矩形跨度"与走廊：');
for (let i = 0; i < cols.length - 1; i++) {
  const a = cols[i], b = cols[i + 1];
  const ra = rects.filter((r) => r.col === a), rb = rects.filter((r) => r.col === b);
  const rightEdge = Math.max(...ra.map((r) => r.x1));
  const leftEdge = Math.min(...rb.map((r) => r.x0));
  const gap = leftEdge - rightEdge;
  const net = gap - 2 * OBSTACLE_PAD;
  console.log(`  列${a}→列${b}: 左列最右 ${rightEdge.toFixed(1)} → 右列最左 ${leftEdge.toFixed(1)}  走廊 ${gap.toFixed(1)}px  净空 ${net.toFixed(1)}px ${net > 0 ? '✓ 有路' : '✗ 无路'}`);
}

let xsOverlap = 0, worst = 0;
for (const r1 of rects) {
  for (const r2 of rects) {
    if (r1.col >= r2.col) continue;
    const ov = Math.min(r1.x1, r2.x1) - Math.max(r1.x0, r2.x0);
    if (ov > 0) { xsOverlap++; if (ov > worst) worst = ov; }
  }
}
console.log(`\n跨列节点矩形横向重叠的对数 = ${xsOverlap}（最大重叠 ${worst.toFixed(1)}px）`);

let maxDev = 0;
for (const r of rects) {
  const sameCol = rects.filter((q) => q.col === r.col).map((q) => (q.x0 + q.x1) / 2);
  const center = sameCol.reduce((s, v) => s + v, 0) / sameCol.length;
  maxDev = Math.max(maxDev, Math.abs((r.x0 + r.x1) / 2 - center));
}
console.log(`列内节点距"该列节点中心"的最大偏差 = ${maxDev.toFixed(1)}px（抖动上限约 31px）`);
