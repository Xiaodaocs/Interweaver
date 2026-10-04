// 本轮两项要求的不变量（纯函数，快）：
//   ① 布线（用户两轮修正后的最终规则）：
//      · "神经网络的线是每一层只传给下一层……无法完全做到，但你要尽量"  → 有语义链时拆成逐层跳；
//      · "不要说完全找逐层相邻跳转，这样忽略了知识卡片之间的逻辑联系准确性……如果没有就只能直接连"
//        → **每一跳都必须是图谱里本来就存在的关系**，找不到语义链就保留直达边，**绝不编造连接**。
//   ② 卡片遮罩（像素级验证见 check-starmap-screenshot.mjs）。
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES, allDepEdges, allRelatedEdges } from '../src/achievements/nodes.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from '../src/achievements/patterns.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const L = layoutStarMap();
const layer = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.layer]));
const title = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n.title]));
const T = (id) => `${title.get(id) || id}(L${layer.get(id)})`;
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// 图谱里"本来就有"的真实关系集合
const real = new Set();
for (const [a, b] of allDepEdges([...SOLO_PATTERNS, ...WEAVE_PATTERNS])) real.add(key(a, b));
for (const [a, b] of allRelatedEdges()) real.add(key(a, b));

// ① 硬不变量：每一条画出来的线都必须是真实关系（不编造）
const fake = L.deps.filter(([a, b]) => !real.has(key(a, b)));
ok(fake.length === 0, `每条依赖线都是图谱里**本来就有的关系**（编造的 ${fake.length} 条`
  + (fake.length ? `：${fake.slice(0, 4).map(([a, b]) => `${T(a)}↔${T(b)}`).join('、')}` : '') + '）');
ok(L.fakeHop === 0, `算法自检 fakeHop = ${L.fakeHop}（0 = 没有为了凑相邻层而编造连接）`);
ok(L.invented === 0, `原始边全部来自真实关系（异常计数 ${L.invented}）`);

// ② 尽量逐层：拆开的边必须一路向右，且每跳只跨一层
const splitEdges = L.deps.filter(([a, b]) => Math.abs(layer.get(a) - layer.get(b)) === 1);
const diff = ([a, b]) => Math.abs(layer.get(a) - layer.get(b));
const jumps = L.deps.filter((p) => diff(p) > 1);
console.log(`  · 依赖线 ${L.deps.length} 条：相邻层 ${splitEdges.length} 条，跨层 ${jumps.length} 条`
  + `（有语义链被拆开的 ${L.split} 条）`);
console.log(`  · 层差分布：${[...new Set(L.deps.map(diff))].sort((a, b) => a - b).map((d) => `Δ${d}×${L.deps.filter((p) => diff(p) === d).length}`).join('  ')}`);
ok(L.deps.every(([a, b]) => layer.get(a) < layer.get(b)), '所有依赖线方向一律**左→右**（层号递增）');
// 注：**不要求**必须发生拆分。按用户的最终规则，只有当"由真实关系组成的、从左往右的链"存在时才拆；
// 实测本图谱里这样的链**一条都没有**（长边都是成就前置关系，中间项根本不存在）
// → split = 0 才是正确结果，对应"如果没有就只能直接连『平行』"。
console.log(`  · 被拆开的边：${L.split} 条（本图谱长边的"中间项"都不存在 → 如实保留直达）`);
// 跨层线必须本身就是真实关系（即"没有语义链时如实保留" —— 用户说的"只能直接连"）
const unjustifiedLong = jumps.filter(([a, b]) => !real.has(key(a, b)));
ok(unjustifiedLong.length === 0,
  `保留的跨层线全都是真实关系（无依据的长跳 ${unjustifiedLong.length} 条）→ 对应用户说的"没有就只能直接连"`);

// ③ 报告：跨层线里是否有"毫无关联"的组合（用户举的反例类型）
console.log('  跨层线清单（这些是图谱原有关系、但没有可用的语义链可拆）：');
for (const [a, b] of jumps.slice(0, 12)) console.log(`    ${T(a)} ↔ ${T(b)}  Δ${diff([a, b])}`);
if (jumps.length > 12) console.log(`    …还有 ${jumps.length - 12} 条`);

console.log(`\n逐层与语义布线核验: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
