// 诊断/说明："逐层中转"布线（用户要求：神经网络的线每层只传给下一层，尽量做到）
// 运行： node tests/diag-layer-routing.mjs
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const L = layoutStarMap();
const title = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.title]));
const layer = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.layer]));
const T = (id) => `${title.get(id) || id}(L${layer.get(id)})`;

console.log(`原始依赖边 ${L.rawDepCount} 条 → 逐层中转后 ${L.deps.length} 条（中转 ${L.rerouted} 条；找不到路径、如实保留长边 ${L.keptLong} 条）`);

const byDiff = new Map();
const jumps = [];
for (const [a, b] of L.deps) {
  const d = Math.abs(layer.get(a) - layer.get(b));
  byDiff.set(d, (byDiff.get(d) || 0) + 1);
  if (d > 1) jumps.push(`${T(a)} ↔ ${T(b)} Δ${d}`);
}
console.log('层差分布：', [...byDiff.entries()].sort((x, y) => x[0] - y[0]).map(([d, n]) => `Δ${d}×${n}`).join('  '));
console.log(`仍跨层的边 ${jumps.length} 条` + (jumps.length ? `：\n  ${jumps.join('\n  ')}` : '（全部变成逐层相邻）'));

const nb = (id) => L.deps.filter((p) => p[0] === id || p[1] === id).map((p) => T(p[0] === id ? p[1] : p[0]));
console.log('\n★ 用户举的例子：欧拉之环');
console.log('  之前（原始边）：', L.deps.length ? '' : '', (() => {
  const raw = [];
  // 用原始关系反推：直接看长跳边里有没有 euler
  return '见下面的"仍跨层"列表';
})());
console.log('  现在（逐层中转后）的邻居：', nb('n.euler').join('、') || '（无）');
console.log('  其中"接点也在转"(w.contactSpin) 是否在邻居里：', nb('n.euler').some((s) => s.startsWith('接点也在转')) ? '是 ✓' : '否 ✗');
console.log('  其中"圆"(L0) 是否还在邻居里：', nb('n.euler').some((s) => s.startsWith('圆(L0)')) ? '在（说明还有直达长边）' : '已不在 ✓（改走中转）');

console.log('\n★ 圆 的邻居：', nb('n.circle').join('、'));
console.log('★ 正弦波 的邻居：', nb('n.sine').join('、'));
