// 本轮两项要求的不变量（纯函数，快）：
//   ① 布线：**每层只传给下一层**（用户要求"神经网络的线是每一层只传给下一层，而不是跨层传播"）
//      —— 即所有依赖边的两端层号之差必须恰好为 1；有中转的边也算（中转后每跳都是 Δ1）。
//   ② 卡片遮罩：每张卡后面要有一层遮挡，挡住穿越的线（在 check-starmap-screenshot 里做像素级验证）。
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const L = layoutStarMap();
const layer = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.layer]));
const title = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.title]));
const T = (id) => `${title.get(id) || id}(L${layer.get(id)})`;

// ① 所有依赖边都必须是"相邻层"
const diff = (p) => Math.abs(layer.get(p[0]) - layer.get(p[1]));
const bad = L.deps.filter((p) => diff(p) !== 1);
ok(bad.length === 0, `所有依赖边都是**相邻层**（Δ1）：${L.deps.length - bad.length}/${L.deps.length}`
  + (bad.length ? `｜仍有跨层：${bad.slice(0, 4).map((p) => `${T(p[0])}↔${T(p[1])}`).join('、')}` : ''));
ok(L.deps.every((p) => layer.get(p[0]) < layer.get(p[1])), '依赖边方向一律**左→右**（层号递增）');
ok(L.keptLong === 0, `没有"找不到逐层路径而保留的长边"（${L.keptLong} 条）→ 中转算法覆盖完整`);
ok(L.rerouted > 0, `确实发生了逐层中转：原始 ${L.rawDepCount} 条 → 中转后 ${L.deps.length} 条（${L.rerouted} 条改走中转）`);

// ② 用户举的例子：欧拉之环(L6) 不能连到很远的 圆(L0)，应连到相邻层(L5)的节点
const nb = (id) => L.deps.filter((p) => p[0] === id || p[1] === id).map((p) => (p[0] === id ? p[1] : p[0]));
const eulerNb = nb('n.euler');
ok(eulerNb.length > 0, `欧拉之环有邻居（${eulerNb.map(T).join('、')}）`);
ok(!eulerNb.includes('n.circle'), '欧拉之环**不再**直接连到很远的「圆」(L0) ← 用户点名的例子');
ok(eulerNb.every((id) => Math.abs(layer.get(id) - 6) === 1), `欧拉之环的邻居全在 L5（相邻层）：${eulerNb.map(T).join('、')}`);

// ③ 全图抽查：没有任何一条依赖边跨过两层以上
const span = Math.max(...L.deps.map(diff));
ok(span === 1, `全图依赖边的最大层差 = ${span}（要求 1）`);

console.log(`\n逐层布线核验: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
