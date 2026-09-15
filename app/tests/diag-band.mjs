// T2 诊断（只测量）：带内归属的 55.8px 溢出到底来自哪些节点？
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES, GROUPS } from '../src/achievements/nodes.js';
import { BAND_H, MIN_GAP } from '../src/starmapLayout.js';
const MARGIN = 30;   // 与 starmapLayout 内部一致（该常量未导出）

const L = layoutStarMap();
const pos = L.pos;
const bandH = L.bandH || new Map(GROUPS.map((g) => [g, BAND_H]));
// 带心按布局的规则本地重算（layout 的返回值里不保证带这个 Map）：
// center(g) = PAD_Y + 前面各组带高之和 + 本组带高/2
const PAD_Y = 120;
const bandCenter = new Map();
{
  let top = PAD_Y;
  for (const g of GROUPS) {
    const h = bandH.get(g) || BAND_H;
    bandCenter.set(g, top + h / 2);
    top += h;
  }
}

console.log('画布 =', Math.round(L.width) + '×' + Math.round(L.height));
console.log('各带宽 =', GROUPS.map((g) => `${g}:${Math.round(bandH.get(g) || BAND_H)}`).join('  '));

const rows = [];
for (const n of KNOWLEDGE_NODES) {
  const p = pos.get(n.id);
  const half = (bandH.get(p.group) || BAND_H) / 2;
  const dev = Math.abs(p.y - bandCenter.get(p.group));
  const overStrict = dev - half;                 // 严格判据：出带即溢出
  const overLenient = dev - (half + MARGIN);     // 宽松判据（layoutStats 用的那个）
  rows.push({ id: n.id, group: p.group, col: p.col, lane: p.lane, layer: p.layer, y: Math.round(p.y), center: Math.round(bandCenter.get(p.group)), half: Math.round(half), dev: Math.round(dev), overStrict: +overStrict.toFixed(1), overLenient: +overLenient.toFixed(1) });
}
const strict = rows.filter((r) => r.overStrict > 0.5).sort((a, b) => b.overStrict - a.overStrict);
const lenient = rows.filter((r) => r.overLenient > 0.5).sort((a, b) => b.overLenient - a.overLenient);
console.log(`\n严格判据（|y−带心| > 带高/2）溢出节点数 = ${strict.length}`);
for (const r of strict.slice(0, 8)) {
  console.log(`  ${r.id.padEnd(22)} 组=${r.group} 列=${r.col} 子道=${r.lane} L${r.layer}  y=${r.y} 带心=${r.center} 半高=${r.half} 偏离=${r.dev} 溢出=${r.overStrict}`);
}
console.log(`\n宽松判据（layoutStats 用的：|y−带心| > 带高/2 + ${MARGIN}）溢出节点数 = ${lenient.length}`);
for (const r of lenient.slice(0, 6)) console.log(`  ${r.id.padEnd(22)} 组=${r.group} 列=${r.col} 溢出=${r.overLenient}`);

// 按组统计：每组的"节点数 / 带宽 / 带内可用高度 / 需要多少子道"
console.log('\n各组容量：');
for (const g of GROUPS) {
  const list = KNOWLEDGE_NODES.map((n) => pos.get(n.id)).filter((p) => p.group === g);
  const h = bandH.get(g) || BAND_H;
  const usable = h - 2 * MARGIN;
  const maxPerLane = Math.max(1, Math.floor(usable / MIN_GAP) + 1);
  const byCol = new Map();
  for (const p of list) byCol.set(p.col, (byCol.get(p.col) || 0) + 1);
  const worstCell = Math.max(0, ...byCol.values());
  const lanesNeeded = Math.max(1, Math.ceil(worstCell / maxPerLane));
  console.log(`  ${g.padEnd(8)} 节点 ${String(list.length).padStart(2)}  带宽 ${Math.round(h)}  可用 ${Math.round(usable)}  单道容量 ${maxPerLane}  最挤格 ${worstCell}  需要子道 ${lanesNeeded}`);
}
