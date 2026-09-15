// T2 诊断（只测量、不改产品代码）：溢出的 375px 是"放置阶段就有的"，还是"后续分离/松弛推出来的"？
//
// 依据：layoutOrganic 在放置时写入 ax/ay 作锚点，之后只改 x/y、不再改 ay。
//   所以 |ay − 带心|   = 放置阶段（含子道划分与格内步长）的偏离
//      |y  − 带心|   = 最终偏离（放置 + 硬分离 + 松弛 + 归带夹紧 的总效果）
// 两者一比，就知道该去改哪一段。
import { layoutStarMap } from '../src/starmap.js';
import { KNOWLEDGE_NODES, GROUPS } from '../src/achievements/nodes.js';
import { BAND_H } from '../src/starmapLayout.js';

const L = layoutStarMap();
const PAD_Y = 120;
const bandH = L.bandH || new Map(GROUPS.map((g) => [g, BAND_H]));
const bandCenter = new Map();
{
  let top = PAD_Y;
  for (const g of GROUPS) {
    const h = bandH.get(g) || BAND_H;
    bandCenter.set(g, top + h / 2);
    top += h;
  }
}

const rows = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  const half = (bandH.get(p.group) || BAND_H) / 2;
  const c = bandCenter.get(p.group);
  return {
    id: n.id, group: p.group, col: p.col, lane: p.lane,
    yAnchor: Math.round(p.ay), yFinal: Math.round(p.y), center: Math.round(c), half: Math.round(half),
    devAnchor: +Math.abs(p.ay - c).toFixed(1),
    devFinal: +Math.abs(p.y - c).toFixed(1),
  };
});

const overAnchor = rows.filter((r) => r.devAnchor > r.half + 0.5);
const overFinal = rows.filter((r) => r.devFinal > r.half + 0.5);
console.log(`带高统一 = ${Math.round(bandH.get(GROUPS[0]))}（半高 ${Math.round((bandH.get(GROUPS[0])) / 2)}）`);
console.log(`\n① 放置阶段就溢出 = ${overAnchor.length} 个`);
for (const r of overAnchor.sort((a, b) => b.devAnchor - a.devAnchor).slice(0, 6)) {
  console.log(`   ${r.id.padEnd(20)} 组=${r.group} 列=${r.col} 子道=${r.lane} 锚点偏离=${r.devAnchor} 半高=${r.half} 超出=${(r.devAnchor - r.half).toFixed(1)}`);
}
console.log(`\n② 最终仍溢出 = ${overFinal.length} 个（其中放置阶段就已溢出的有 ${overFinal.filter((r) => r.devAnchor > r.half + 0.5).length} 个）`);
for (const r of overFinal.sort((a, b) => b.devFinal - a.devFinal).slice(0, 8)) {
  console.log(`   ${r.id.padEnd(20)} 组=${r.group} 列=${r.col} 子道=${r.lane} 锚点=${r.yAnchor}(${r.devAnchor}) → 最终=${r.yFinal}(${r.devFinal})  后续再推 ${(r.devFinal - r.devAnchor).toFixed(1)}px`);
}

// 结论行：把"该改哪一段"直接算出来
const latePush = overFinal.filter((r) => r.devAnchor <= r.half + 0.5 && r.devFinal > r.half + 0.5);
console.log(`\n结论：`);
console.log(`  · 放置阶段（子道/格内步长）造成的溢出 = ${overAnchor.length} 个`);
console.log(`  · 放置没问题、由**后续分离/松弛**推出去的 = ${latePush.length} 个  ← 若是这个占多数，根因在分离/松弛`);
if (latePush.length) {
  const avg = latePush.reduce((s, r) => s + (r.devFinal - r.devAnchor), 0) / latePush.length;
  console.log(`  · 这些节点平均被后续阶段再推 ${avg.toFixed(0)}px`);
}
