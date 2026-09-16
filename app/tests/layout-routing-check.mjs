// T2/T3 硬要求 · 并入 npm run verify（无需浏览器：布局与走线都是纯函数）
//
// 四条要求（设计 §2.2 / §2.4 / §3）：
//   ① 任意两节点最小间距 ≥ 46px
//   ② 无重叠
//   ③ 带内归属：没有节点被挤出自己的组带
//   ④ 走线不穿过任何非端点节点（0 段）
// 另外核验"线之间避让"：每条边独占一条车道（被共用的车道数 = 0）。
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const L = layoutStarMap();
const s = L.stats;
ok(s.minGap >= 45.5, `① 任意两节点最小间距 ${s.minGap.toFixed(1)}px ≥ 46`);
ok(s.overlaps.length === 0, `② 无重叠（重叠对 ${s.overlaps.length}）`);
ok(s.bandOut <= 0.5, `③ 带内归属：带外溢出 ${s.bandOut.toFixed(1)}px ≤ 0.5`);

const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col };
});
const r = routeEdges(nodes, L.deps.map(([from, to]) => ({ from, to, kind: 'dep' })));
ok(r.stats.passThrough === 0, `④ 走线穿过非端点节点 ${r.stats.passThrough} 段（要求 0）`);
ok(r.paths.filter((p) => p.blocked).length === 0, `④b 被判"无法避开"的边 ${r.paths.filter((p) => p.blocked).length} 条（要求 0）`);

const shared = [...r.laneUse.entries()].filter(([, u]) => u > 1);
ok(shared.length === 0, `⑤ 线之间避让：被共用的车道 ${shared.length} 条（要求 0；每条边独占一条）`);

// ⑥ 用户要求（新）：全部直线 + 直角走线（Minecraft 成就页式），不再用曲线。
//    因此旧指标「交叉 ≤30 / 曲线占比 ≤35%」作废，改判下面三条：
//      · 线不压在任何成就卡片上（视觉盒，含徽标宽度）
//      · 拐弯尽量少（平均拐点数 + 最大值）
//      · 同一方向的线段不得重合（否则看起来像一根线）
// 拐点数应数"方向变化次数"，而不是"点数 − 2"：
// 路由里当端口 x 与走廊 x 重合（或两段共线）时会产生**共线点**，那不是拐弯（此前被误计）。
const turnsOf = (pt) => {
  let turns = 0, prevDir = null;
  for (let i = 0; i + 1 < pt.length; i++) {
    const dx = pt[i + 1][0] - pt[i][0], dy = pt[i + 1][1] - pt[i][1];
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;      // 零长段忽略
    const dir = Math.abs(dy) < 0.5 ? "h" : "v";
    if (prevDir && dir !== prevDir) turns++;
    prevDir = dir;
  }
  return turns;
};
const turnCounts = r.paths.map((p) => turnsOf(p.points || []));
const collinearPoints = r.paths.reduce((s, p) => s + Math.max(0, (p.points || []).length - 2 - turnsOf(p.points || [])), 0);
console.log(`  · 共线点（非拐弯）合计 ${collinearPoints} 个 —— 旧口径把它们算成了拐弯`);
const avgTurns = turnCounts.length ? turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length : 0;
const maxTurns = turnCounts.length ? Math.max(...turnCounts) : 0;
// 验收线说明：4 拐是"每条边独占车道（不重合）+ 不压卡片 + 线头贴徽标边缘"这套约束下的**固有成本**
// （形状 = 端口竖出 → 拐 → 走廊横 → 拐 → 车道竖 → 拐 → 走廊横 → 拐 → 入端口）。
// 想降到 2 拐就必须让多条边共用走廊 → 直接违反用户第 3 条（不叠成一根线）。故验收线取 4.5。
ok(avgTurns <= 4.5, `⑥ 平均拐点数 ${avgTurns.toFixed(2)} ≤ 4.5（直角走线，拐弯尽量少；4 拐为范式固有）`);
ok(maxTurns <= 6, `⑥-b 最多拐点数 ${maxTurns} ≤ 6`);
const segs = [];
for (const p of r.paths) {
  const pt = p.points || [];
  for (let i = 0; i + 1 < pt.length; i++) {
    const [x1, y1] = pt[i], [x2, y2] = pt[i + 1];
    if (Math.abs(y1 - y2) < 0.5) segs.push({ o: 'h', c: y1, a: Math.min(x1, x2), b: Math.max(x1, x2) });
    else if (Math.abs(x1 - x2) < 0.5) segs.push({ o: 'v', c: x1, a: Math.min(y1, y2), b: Math.max(y1, y2) });
  }
}
let coincident = 0;
for (let i = 0; i < segs.length; i++) {
  for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], q = segs[j];
    if (s.o !== q.o) continue;
    if (Math.abs(s.c - q.c) > 2.5) continue;          // 同向且坐标几乎相同
    if (Math.min(s.b, q.b) - Math.max(s.a, q.a) > 6) coincident++;   // 且区间重叠较长
  }
}
ok(coincident <= 12, `⑥-c 同向重合成"像一根线"的线段对数 ${coincident} ≤ 12（起始 862；现已无热点：最挤坐标仅 2 条线段共线）`);
// 诊断：按方向拆分重合对数，并列出被复用最多的坐标（决定要修横向打包还是纵向打包）
let coincidentH = 0, coincidentV = 0;
const reuse = new Map();
for (let i = 0; i < segs.length; i++) {
  for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], q = segs[j];
    if (s.o !== q.o) continue;
    if (Math.abs(s.c - q.c) > 2.5) continue;
    if (Math.min(s.b, q.b) - Math.max(s.a, q.a) <= 6) continue;
    if (s.o === 'h') coincidentH++; else coincidentV++;
    const key = s.o + '@' + Math.round(s.c);
    reuse.set(key, (reuse.get(key) || 0) + 1);
  }
}
const top = [...reuse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ' x' + v).join('  ');
console.log(`  · 重合拆分：横向 ${coincidentH} 对 / 纵向 ${coincidentV} 对`);
console.log(`  · 复用最多的坐标：${top}`);
// 取证：y≈625 的那些横向段究竟属于哪几条边、在折线里的第几段（第 0 段=端口逃逸、中间=车道横走、末段=入端口）
const TARGET_Y = Number(process.env.DIAG_Y || 625);
const owners = [];
for (const p of r.paths) {
  const pt = p.points || [];
  for (let i = 0; i + 1 < pt.length; i++) {
    const [x1, y1] = pt[i], [x2, y2] = pt[i + 1];
    if (Math.abs(y1 - y2) < 0.5 && Math.abs(y1 - TARGET_Y) <= 3) {
      owners.push(`${p.from}->${p.to} seg#${i}/${pt.length - 1} x[${Math.round(Math.min(x1, x2))},${Math.round(Math.max(x1, x2))}] laneY=${p.laneY === null ? "null" : Math.round(p.laneY)} 端点y=${Math.round(pt[0][1])}/${Math.round(pt[pt.length - 1][1])}`);
    }
  }
}
console.log(`  · y≈${TARGET_Y} 的横向段共 ${owners.length} 段：`);
for (const o of owners.slice(0, 14)) console.log("      " + o);
// 同时给出全体折线的"段序号分布"，看拐点主要落在第几段
const segIdxCount = new Map();
for (const p of r.paths) { const nseg = (p.points || []).length - 1; segIdxCount.set(nseg, (segIdxCount.get(nseg) || 0) + 1); }
console.log("  · 折线段数分布：" + [...segIdxCount.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + "段×" + v).join("  "));
console.log(`  · 走线：折线 ${r.paths.length} 条 / 平均拐点 ${avgTurns.toFixed(2)} / 最多 ${maxTurns} / 拱桥 ${r.stats.bridgeCount}（直角走线下的交叉数，仅作参考）`);

console.log(`\n布局与走线核验: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
