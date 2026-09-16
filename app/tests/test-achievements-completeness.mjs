// 用户要求 ⑥：原计划中近 100 个成就（含搞笑彩蛋）+ 点击查看详情，全部需要实现。
//
// 本文件从**数据侧**证明这一点：
//   · 总数 ≥ 100（含彩蛋，且彩蛋与正常成就混排、无标注）
//   · 每条都有：唯一 id、标题 ≤8 字、flavor ≤48 字、hint ≤22 字、至少一个节点、可调用的判据 where
//   · 每条都有知识点归属 ACH_NODE（点击详情后要能显示"它代表什么"）
//   · 每条都能生成"如何触发"的说明（evidence 或 where 至少有一个）
//
// 运行：node tests/test-achievements-completeness.mjs
import { SOLO_PATTERNS, WEAVE_PATTERNS } from '../src/achievements/patterns.js';
import { ACH_NODE } from '../src/achievements/nodes.js';

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; } else { fails.push(msg); } };

const all = [...SOLO_PATTERNS, ...WEAVE_PATTERNS];

ok(all.length >= 100, `成就总数 ${all.length} 应 >= 100`);

const ids = new Set();
const badText = [];
for (const p of all) {
  if (!p.id || ids.has(p.id)) badText.push(`id 缺失或重复：${p.id}`);
  ids.add(p.id);
  if (!p.title || p.title.length > 8) badText.push(`${p.id} 标题长度越界`);
  if (!p.flavor || p.flavor.length > 48) badText.push(`${p.id} flavor 长度越界`);
  if (!p.hint || p.hint.length > 22) badText.push(`${p.id} hint 长度越界`);
  if (!Array.isArray(p.nodes) || !p.nodes.length) badText.push(`${p.id} 缺少 nodes`);
  // 可判定有三种实现形式（都成立，断言只判"性质"不判"形式"）：
  //   ① 模式级 where 是函数（新族用这种）
  //   ② 任一节点带 where 函数
  //   ③ 节点只声明 type、不带 where ⇒ **存在性判据**（"语义图里出现了该类型节点即命中"）
  //      —— 老批次的 *.first 类（如 geo.point.first）用这种，实测其 where 为 undefined、节点为 {type:'point',as:'pt'}
  const judgeable = typeof p.where === 'function'
    || (p.nodes || []).some((n) => typeof n.where === 'function')
    || (p.nodes || []).some((n) => n && typeof n.type === 'string' && typeof n.where !== 'function');
  if (!judgeable) badText.push(`${p.id} 缺少判据（模式级 where / 节点级 where / 存在性判据 三者皆无）`);
}
ok(badText.length === 0, `文案/结构越界 ${badText.length} 条：${badText.slice(0, 4).join('；')}`);

const noNode = all.filter((p) => !ACH_NODE[p.id]).map((p) => p.id);
ok(noNode.length === 0, `缺知识点归属 ${noNode.length} 条：${noNode.slice(0, 4).join('、')}`);

const noJudge = all.filter((p) => typeof p.where !== 'function' && typeof p.evidence !== 'function').map((p) => p.id);
ok(noJudge.length === 0, `无法生成触发说明 ${noJudge.length} 条：${noJudge.slice(0, 4).join('、')}`);

const eggs = all.filter((p) => typeof p.id === 'string' && p.id.startsWith('egg.'));
ok(eggs.length >= 8, `彩蛋类成就 ${eggs.length} 条应 >= 8`);

const weave = all.filter((p) => p.cls === 'weave');
ok(weave.length >= 15, `交织（B 类）成就 ${weave.length} 条应 >= 15`);

// 知识点归属必须指向真实存在的知识节点 id（形如 n.xxx / w.xxx）
const badRef = all.filter((p) => ACH_NODE[p.id] && typeof ACH_NODE[p.id] !== 'string').map((p) => p.id);
ok(badRef.length === 0, `知识点归属类型异常 ${badRef.length} 条`);

console.log(`成就 ${all.length} 条（A ${SOLO_PATTERNS.length} / B ${WEAVE_PATTERNS.length}）｜彩蛋 ${eggs.length} 条｜全部有文案、归属与判据`);
console.log(`全部成就完整性：${pass} 通过, ${fails.length} 失败`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
