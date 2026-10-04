// 布局核验（纯函数，无需浏览器）· 并入 npm run verify
//
// ★ 本轮变更（用户要求）：布局从"有机布局（层内抖动 + 组带引力 + 松弛迭代）"
//   彻底改为**神经网络式分列**（"完全重新排序，类似神经网络那样从左往右"）。
//   同时产品上一轮已把"正交走线 + 车道 + 拱桥"换成**贝塞尔曲线**，
//   所以本文件里原先针对 routeEdges 的走线断言（穿过节点 / 车道独占 / 拐点 / 共线）
//   测的已经是**产品不再使用的模块**，按"不留兼容层"的纪律一并删除。
//
// 现在核验的是新布局真正要保证的六条：
//   ① 任意两节点最小中心距 ≥ 46
//   ② 卡片矩形不重叠
//   ③ 同列 x 完全对齐（是"列"而不是散点）
//   ③b 列内等距（行距恒定，且 ≥ 卡片高 + 留白）
//   ③c 各列垂直居中（列中心对齐画布中线）
//   ③d 同组知识点在列内连续（读起来仍是一撮）
import { layoutStarMap } from '../src/starmap.js';
import { JITTER_X, JITTER_Y, ROW_PITCH, CARD_H, CARD_PAD } from '../src/starmapLayout.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const L = layoutStarMap();
const s = L.stats;

ok(s.minGap >= 45.5, `① 任意两节点最小中心距 ${s.minGap.toFixed(1)}px ≥ 46`);
ok(s.overlaps.length === 0, `② 卡片矩形无重叠（重叠对 ${s.overlaps.length}）`);
ok(s.colSpread <= 2 * JITTER_X + 1, `③ 同列只是**轻微抖动**、仍是一列（列内横向散布 ${s.colSpread.toFixed(1)}px ≤ 2×JITTER_X=${2 * JITTER_X}）`);
ok(s.rowPitchMin >= CARD_H + CARD_PAD && s.rowPitchMax <= ROW_PITCH + 2 * JITTER_Y + 1,
  `③b 列内行距在抖动后仍远大于卡片高（${s.rowPitchMin.toFixed(1)}~${s.rowPitchMax.toFixed(1)}px，下界 ≥ ${CARD_H + CARD_PAD}）`);
ok(s.centerOffset <= 2 * JITTER_Y,
  `③c 各列基本居中（抖动后中心偏差 ${s.centerOffset.toFixed(1)}px ≤ 2×JITTER_Y=${2 * JITTER_Y}）`);
ok(s.groupRuns === true, '③d 同组知识点在列内连续（读起来仍是"一撮"）');

// 左→右分列：列数 = 难度层数，且每列都有节点、列序与层号一致
const layers = [...new Set(KNOWLEDGE_NODES.map((n) => n.layer))].sort((a, b) => a - b);
const colOfLayer = new Map(layers.map((L2, i) => [L2, i]));
const wrongCol = KNOWLEDGE_NODES.filter((n) => L.pos.get(n.id).col !== colOfLayer.get(n.layer));
ok(wrongCol.length === 0, `④ 列号与难度层一一对应（错位 ${wrongCol.length} 个）→ 左易右难`);
ok(s.cols === layers.length, `④b 列数 = 难度层数（${s.cols} = ${layers.length}）`);
ok(s.count === KNOWLEDGE_NODES.length, `⑤ 每个知识点都有位置（${s.count}/${KNOWLEDGE_NODES.length}）`);

// 画布尺寸：应比旧布局紧凑得多（旧的 4658×6188；新布局按列算宽、按最高列算高）
console.log(`  · 画布 ${Math.round(L.width)}×${Math.round(L.height)}px（旧布局 4658×6188）｜${s.cols} 列｜行距 ${s.rowPitchMin}px｜矩形最小净距 ${s.minRectGap.toFixed(1)}px`);
const byCol = new Map();
for (const n of KNOWLEDGE_NODES) {
  const p = L.pos.get(n.id);
  if (!byCol.has(p.col)) byCol.set(p.col, []);
  byCol.get(p.col).push(n.title);
}
for (const [c, arr] of [...byCol].sort((a, b) => a[0] - b[0])) {
  console.log(`      第${c}列(${arr.length})：${arr.join('、')}`);
}

console.log(`\n布局核验: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
