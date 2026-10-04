// 生成成就完整信息清单 + 自动找"判定条件重叠"（同一操作会同时解锁多个）的候选组
// 运行： node tests/diag-achievements-inventory.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from '../src/achievements/patterns.js';
import { ACH_NODE, KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

const all = [...SOLO_PATTERNS, ...WEAVE_PATTERNS];
const nodeById = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n]));
const title = (id) => nodeById.get(id)?.title || id;

// 条件的"形状指纹"：节点类型序列 + 边类型序列 + 是否有模式级 where。
// 指纹相同 ⇒ 两者对场景的要求几乎一致 ⇒ 同一个操作很可能同时满足它们。
const shape = (p) => JSON.stringify({
  n: (p.nodes || []).map((x) => x.type).sort(),
  e: (p.edges || []).map((x) => x.kind).sort(),
  pw: typeof p.where === 'function',
});
// 更严一点：连 where 函数的源码一起比（同一份判据被复制粘贴时最容易同源）
const strict = (p) => shape(p) + '|' + (p.where ? String(p.where) : '');

const groups = new Map();
for (const p of all) {
  const k = strict(p);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);

const lines = [];
lines.push('# 成就完整信息清单（自动生成，请勿手改）');
lines.push('');
lines.push(`生成来源：\`src/achievements/patterns.js\` + \`src/achievements/nodes.js\``);
lines.push('');
lines.push(`- 成就总数：**${all.length}**（A 类独石 ${all.filter((p) => p.cls === 'solo').length} / B 类交织 ${all.filter((p) => p.cls === 'weave').length}）`);
lines.push(`- 知识点：**${KNOWLEDGE_NODES.length}** 个`);
lines.push(`- **判定条件完全同源的组：${dupGroups.length} 组，涉及 ${dupGroups.reduce((s, g) => s + g.length, 0)} 条成就**（这些就是"一个操作同时解锁多个"的重灾区）`);
lines.push('');
lines.push('## ⚠ 判定条件完全同源的组（同一份判据被多条成就共用）');
lines.push('');
if (!dupGroups.length) lines.push('（无）');
for (const g of dupGroups) {
  lines.push(`### 组：${g.map((p) => `「${p.title}」`).join(' / ')}`);
  lines.push('');
  lines.push(`- id：${g.map((p) => `\`${p.id}\``).join('、')}`);
  lines.push(`- 类别：${g.map((p) => p.cls).join('、')}｜前置：${g.map((p) => (p.requires || []).length ? (p.requires || []).join('+') : '无').join('、')}`);
  lines.push(`- 判据形状：节点 [${g[0].nodes.map((x) => x.type).join(', ')}]｜边 [${(g[0].edges || []).map((x) => x.kind).join(', ')}]｜模式级 where=${g[0].where ? '有' : '无'}`);
  lines.push(`- 归属知识点：${g.map((p) => title(ACH_NODE[p.id])).join('、')}`);
  lines.push('');
}
lines.push('## 全部成就一览');
lines.push('');
lines.push('| # | id | 标题 | 类别 | 前置 | 判据（节点/边） | 归属知识点 |');
lines.push('|---|----|------|------|------|------------------|------------|');
all.forEach((p, i) => {
  const n = (p.nodes || []).map((x) => x.type + (x.where ? '(谓词)' : '')).join(' + ');
  const e = (p.edges || []).map((x) => x.kind).join(' + ') || '—';
  lines.push(`| ${i + 1} | \`${p.id}\` | ${p.title} | ${p.cls === 'weave' ? 'B 交织' : 'A 独石'} | ${(p.requires || []).join('+') || '—'} | ${n}${e !== '—' ? `｜${e}` : ''}${p.where ? '（+模式级谓词）' : ''} | ${title(ACH_NODE[p.id])} |`);
});
lines.push('');
lines.push('## B 类交织成就的前置链');
lines.push('');
for (const p of all.filter((x) => x.cls === 'weave')) {
  const req = (p.requires || []).map((r) => all.find((x) => x.id === r)?.title || r);
  lines.push(`- 「${p.title}」← ${req.map((r) => `「${r}」`).join(' + ')}`);
}
lines.push('');

// 清单写到**仓库根**的 docs/（和 README、其他文档放一起）
const out = fileURLToPath(new URL('../../docs/achievements-inventory.md', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`清单已写入 ${out}（${lines.length} 行）`);
console.log(`成就 ${all.length} 条（A ${all.filter((p) => p.cls === 'solo').length} / B ${all.filter((p) => p.cls === 'weave').length}）｜知识点 ${KNOWLEDGE_NODES.length} 个`);
console.log(`判定条件完全同源的组：${dupGroups.length} 组，共 ${dupGroups.reduce((s, g) => s + g.length, 0)} 条成就`);
for (const g of dupGroups) {
  console.log(`  · ${g.map((p) => `「${p.title}」(${p.id})`).join('  /  ')}`);
}
