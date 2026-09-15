// 诊断：当前布局里"贴边"的节点对是谁？——为"封顶后间距为何破"提供依据
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const L = layoutStarMap();
const pos = L.pos;
const pts = KNOWLEDGE_NODES.map((n) => ({ id: n.id, ...pos.get(n.id) }));

const pairs = [];
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const A = pts[i], B = pts[j];
    const dx = Math.abs(B.x - A.x), dy = Math.abs(B.y - A.y);
    pairs.push({ a: A.id, b: B.id, d: Math.hypot(dx, dy), dx: Math.round(dx), dy: Math.round(dy),
      sameCol: A.col === B.col, sameGroup: A.group === B.group, sameLane: A.col === B.col && A.lane === B.lane });
  }
}
pairs.sort((p, q) => p.d - q.d);
console.log('最近 12 对节点：');
for (const p of pairs.slice(0, 12)) {
  console.log(`  ${p.d.toFixed(1).padStart(6)}px  dx=${String(p.dx).padStart(3)} dy=${String(p.dy).padStart(3)}  `
    + `${p.sameCol ? '同列' : '跨列'} ${p.sameGroup ? '同组' : '跨组'} ${p.sameLane ? '**同子道**' : ''}  ${p.a} ↔ ${p.b}`);
}
const near = pairs.filter((p) => p.d < 60).length;
const sameLaneNear = pairs.filter((p) => p.d < 60 && p.sameLane).length;
const crossColNear = pairs.filter((p) => p.d < 60 && !p.sameCol).length;
console.log(`\n< 60px 的对数 = ${near}（其中同子道 ${sameLaneNear}、跨列 ${crossColNear}）`);
console.log(`最小间距 = ${pairs[0].d.toFixed(1)}px，第 5 小 = ${pairs[4].d.toFixed(1)}px，第 20 小 = ${pairs[19].d.toFixed(1)}px`);
console.log('→ 若"贴边对"多是**同子道**，说明纵向余量为零（封顶必然破坏间距）；若是**跨列**，说明列距/抖动才是瓶颈。');
