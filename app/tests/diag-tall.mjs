// 诊断：成就面板纵向被拉长（3258 → 6670px）的原因（自适应返回结构）。
import { layoutStarMap } from "../src/starmap.js";
import { COL_W, SUB_STEP, NODE_W, BAND_H, BAND_GAP, CARD_H, CARD_PAD, MIN_DY, MIN_DX } from "../src/starmapLayout.js";

const L = layoutStarMap();
console.log("layoutStarMap 返回字段 =", Object.keys(L).join(", "));
console.log("画布 =", Math.round(L.width) + " × " + Math.round(L.height));

const entries = L.pos instanceof Map ? [...L.pos.entries()] : Object.entries(L.pos || {});
const ys = entries.map(([, p]) => p.y);
const lanesByCol = new Map();
for (const [, p] of entries) lanesByCol.set(p.col, Math.max(lanesByCol.get(p.col) || 0, p.lanes || 1));
console.log("节点 y 范围 =", Math.round(Math.min(...ys)), "→", Math.round(Math.max(...ys)), "跨度 " + Math.round(Math.max(...ys) - Math.min(...ys)) + "px");
console.log("每列最大子道数 =", [...lanesByCol.entries()].sort((a, b) => a[0] - b[0]).map(([c, l]) => "列" + c + ":" + l).join(" "));
const bands = new Map();
for (const [, p] of entries) {
  const b = bands.get(p.group) || { min: Infinity, max: -Infinity, n: 0 };
  b.min = Math.min(b.min, p.y); b.max = Math.max(b.max, p.y); b.n++;
  bands.set(p.group, b);
}
console.log("各组实际 y 跨度（含节点数）：");
for (const [g, b] of bands) console.log("   ", g, "y∈[" + Math.round(b.min) + "," + Math.round(b.max) + "] 跨度 " + Math.round(b.max - b.min) + "px | 节点 " + b.n);
console.log("常量：COL_W=" + COL_W, "SUB_STEP=" + SUB_STEP, "NODE_W=" + NODE_W, "BAND_H=" + BAND_H, "BAND_GAP=" + BAND_GAP, "CARD_H=" + CARD_H, "CARD_PAD=" + CARD_PAD, "MIN_DX=" + MIN_DX, "MIN_DY=" + MIN_DY);
if (L.stats) console.log("统计：", JSON.stringify(L.stats));
