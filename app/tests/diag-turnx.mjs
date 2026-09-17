// 诊断（用户要求 1 与 3）：同一张卡片延出的多条线，是否共用同一个拐弯 x。
//
// 用户原话："从它延申出的线起点不要并排，要从一个点出发，然后分裂出多个线再走"、
//           "对于每个拐角，如果旁边有拐弯位置接近的线，让它们在统一位置拐弯，增加统一观感"。
// 本脚本量两个数：
//   · 每张卡片（源节点）的出边，第一段竖线落在几个**不同的 x** 上（越少越统一，理想 = 1）
//   · 同一目标节点被多条线汇入时，末段竖线落在几个不同 x 上（汇入侧同理）
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const L = layoutStarMap();
const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col };
});
const r = routeEdges(nodes, L.deps.map(([from, to]) => ({ from, to, kind: 'dep' })));

const srcX = new Map();
const dstX = new Map();
for (const p of r.paths) {
  const pts = p.points || [];
  if (pts.length < 3) continue;
  const gx = Math.round(pts[1][0]);                       // 源侧第一段竖线的 x
  const gxEnd = Math.round(pts[pts.length - 2][0]);       // 目标侧最后一段竖线的 x
  if (!srcX.has(p.from)) srcX.set(p.from, []);
  srcX.get(p.from).push(gx);
  if (!dstX.has(p.to)) dstX.set(p.to, []);
  dstX.get(p.to).push(gxEnd);
}

const summarize = (map, label) => {
  let multi = 0, sum = 0, max = 0, worst = null;
  for (const [id, xs] of map) {
    if (xs.length < 2) continue;
    multi++;
    const d = new Set(xs).size;
    sum += d;
    if (d > max) { max = d; worst = { id, xs }; }
  }
  console.log(`${label}：有 ≥2 条边的卡片 ${multi} 个 | 平均不同拐弯 x = ${(sum / Math.max(1, multi)).toFixed(2)} | 最多 = ${max}`);
  if (worst) console.log(`  最多者：${worst.id} → ${JSON.stringify(worst.xs)}`);
};
summarize(srcX, '源侧（延出）');
summarize(dstX, '目标侧（汇入）');
console.log(`总边数 ${r.paths.length} | 穿线 ${r.stats.passThrough} | 拱桥 ${r.stats.bridgeCount}`);
