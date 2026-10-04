// T2 · 有机布局（设计 §2.1 / §2.2 / §2.3）
//
// 设计意图（务必按此实现，不要退化成硬网格）：
//   §2.1  X 仍是难度层（左易右难），列内加抖动；Y 由**组带引力**决定
//   §2.2  呼吸感三条量化规则：任意两节点最小间距 ≥46px、|dx| ≤ 层宽12%、|dy| ≤ 组带高18%、
//         抖动用 hash(nodeId)（确定性，可复现可测试）
//   §2.3  松弛：排斥 / 依赖弹簧(180–260) / 回拉(0.08)
//
// 上一版的两处错误与这一版的修法（关键）：
//   ① 上一版把"防重叠"交给松弛去推 → 相邻**列**之间没有约束，出现 32px 的贴脸对。
//      这一版改为**确定性分离**：逐列一维分离（同列按 y 排序，强制 Δy ≥ 46）→ 跨列错开
//      （横向分不开就竖直推开）→ 带宽按实际用量扩张 → **松弛之后再分离一次**（间距是硬要求）。
//   ② 上一版用"组内 y 标准差"当断言，它与"≥46px 间距"在节点多时数学互斥。
//      这一版改为**带内归属**判据：同组节点必须落在自己的带内，且不与邻带节点贴在一起。
// α（已拍板）：列宽 258 ⇒ 走廊 = 258 − (150 + 2×25.92) = 56px，扣两侧 8px padding 后 40px 净空
export const COL_W = 258;
export const BAND_H = 176;
export const BAND_GAP = 60;   // §3.2 组间散：相邻组带之间的留白（实测总留白 ≈120px）   // 152 → 176：可用高度 = 176 − 2×30 = 116px（此前 92px）
//   实测依据：单道容量 = floor(可用/46)+1 = 3 个节点，而 3 个节点"恰好"需要 2×46 = 92px，
//   与旧可用高度**完全相等 → 零余量**，于是分离算法无处可动，
//   一夹紧就把间距压到 3.7px、出现 6 对重叠（实测）。留出 24px 余量后两者才能同时成立。
export const PAD_X = 96;
export const PAD_Y = 120;
// 难度档：L0–L1 → 1（圆）、L2–L3 → 2（圆角方）、L4–L6 → 3（六边形）。与 achievementShapes.tierOf 同一规则。
function tierOfNum(layer) { const L = Number(layer) || 0; return L <= 1 ? 1 : (L <= 3 ? 2 : 3); }

export const MIN_GAP = 46;          // 中心距下界（保留：仅作参考，实际判据见 CARD_PAD）
// ★ 用户要求（本次）：成就卡片之间不得重叠、需保留可见间距。
//   实测卡片真实盒（世界坐标）：一档圆 54×70 / 二档方 62×76 / 三档六边形 72×82 ——
//   此前布局只有中心距 46px 判据、**没有卡片尺寸概念**，于是 82px 高的卡片必然压叠（实测最严重重叠 2306px²）。
//   现在用「矩形分离 + 留白」判据：水平净距 ≥ CARD_PAD、或垂直净距 ≥ CARD_PAD。
export const CARD_BOX = { 1: { w: 54, h: 70 }, 2: { w: 62, h: 76 }, 3: { w: 72, h: 82 } };
// 徽标半尺寸（按难度档）：连线端点落在这个盒子的边界上。
// 它原来放在 edgeRouting.js（正交布线模块）里 —— 那个模块已随"改成贝塞尔曲线"整体作废并删除，
// 只剩这个常量还在用，于是挪到布局模块，与卡片尺寸常量放在一起。
export const TIER_HALF = { 1: 23, 2: 26, 3: 29 };
export const CARD_PAD = 20;          // 卡片之间的最小留白（用户认可「有一点距离」）
export const CARD_W = 72;            // 取最大档上界（判据用保守值）
export const CARD_H = 82;
export const MIN_DX = CARD_W + CARD_PAD;   // 92：水平净距不足此值时，退化为要求垂直净距
export const MIN_DY = CARD_H + CARD_PAD;   // 102：垂直至少拉开这么远
export const SUB_STEP = 96;          // A：子道横向步长（= NODE_W×0.6；写成字面量以免 TDZ）
export const NODE_W = 150;
// §2.2 规定 |dx| ≤ 层宽12% 是**上限**；实测按 12% 时走廊会被吃掉（净空为负）
// 竖直走线需要 ≥2×OBSTACLE_PAD 的净空，故取 6%（走廊 = 258−150−2×15.5 = 77px）
const MAX_DX = COL_W * 0.06;
const MAX_DY_RATIO = 0.18;
const MARGIN = 30;
const REPEL_DIST = 96;
const SPRING_MIN = 180;
const SPRING_MAX = 260;
const ANCHOR_W = 0.08;

export function hash01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 16777216;
}

// ============================================================
//  神经网络式布局（用户要求，替换原"有机布局"）
// ------------------------------------------------------------
//  用户原话："知识卡片还是旧的排列方式，现在看上去很乱。请完全重新排序知识卡片的位置，
//           类似神经网络那样从左往右。"
//
//  所以这里**故意**去掉旧布局的三样东西（它们正是"乱"的来源）：
//    · 层内抖动（hash 微扰）      → 现在同一列 x 完全对齐（colSpread 必须为 0）
//    · 组带引力 + 软组带          → 现在不再有横向色带；Y 只由"列内等距 + 整列居中"决定
//    · 排斥/弹簧/回拉的松弛迭代    → 现在位置是**解析算出**的，确定性、无迭代、可复现
//
//  保留下来的（真实质量约束，单测与核验都在盯）：
//    · 任意两卡片中心距 ≥ MIN_GAP(46)
//    · 卡片矩形不重叠，且垂直净距 ≥ CARD_PAD(20)
//    · 组内节点在同一列里保持连续（读起来仍能看出"这一撮是一家人"）
// ============================================================
export const COL_PITCH = 360;    // 列间距（含走廊）：用户要求"把整个画布上的东西全部拉开"
export const ROW_PITCH = 156;    // 列内行距 = 卡片高 82 + 净距 74（用户要求"每列卡片之间也加大距离"）
// ★ 用户要求"增加浮动感：每列知识卡片的初始位置不要严格对齐，稍微上下左右移动一点"。
//   抖动是**确定性**的（由 id 的哈希决定），所以每次打开位置完全一致、可复现、可测试；
//   幅度刻意压得很小，既打破"死板网格"，又不会让列看起来散掉、更不会造成重叠
//   （行距 156 − 2×JITTER_Y = 124 > 卡片高 82；列距 360 − 2×JITTER_X = 324 > 卡片宽 72）。
export const JITTER_X = 18;
export const JITTER_Y = 16;

/**
 * 神经网络式布局：X = 难度层（严格分列、左易右难），Y = 列内等距、整列垂直居中。
 * @returns { pos: Map<id, {x,y,col,row,...}>, width, height, layers, stats }
 */
export function layoutNeural(nodes, groups = [], deps = [], opts = {}) {
  void deps; void opts;
  const gi = new Map(groups.map((g, i) => [g, i]));
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const colOf = new Map(layers.map((L, i) => [L, i]));

  // 每列（= 每个难度层）的节点
  const cols = layers.map(() => []);
  for (const n of nodes) cols[colOf.get(n.layer)].push(n);
  // 列内排序：先按分组（同组连续，读起来是一撮），组内按 id（确定性，可复现）
  for (const arr of cols) {
    arr.sort((a, b) => ((gi.get(a.group) ?? 99) - (gi.get(b.group) ?? 99))
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const maxCount = Math.max(1, ...cols.map((a) => a.length));
  const tallest = maxCount * ROW_PITCH - (ROW_PITCH - CARD_H);   // 最高列的净高（首末卡片外缘之间）

  const pos = new Map();
  cols.forEach((arr, c) => {
    const h = arr.length ? arr.length * ROW_PITCH - (ROW_PITCH - CARD_H) : 0;
    // 整列垂直居中：每列的纵向中心都落在画布中线上
    const firstY = PAD_Y + (tallest - h) / 2 + CARD_H / 2;
    arr.forEach((n, i) => {
      const x = PAD_X + c * COL_PITCH + COL_PITCH / 2;
      const y = firstY + i * ROW_PITCH;
      // 确定性微抖动：打破"死板网格"，制造用户要的"浮动感"
      const jx = (hash01(`${n.id}|jx`) - 0.5) * 2 * JITTER_X;
      const jy = (hash01(`${n.id}|jy`) - 0.5) * 2 * JITTER_Y;
      pos.set(n.id, {
        id: n.id, x: x + jx, y: y + jy, ax: x, ay: y,
        col: c, row: i, lane: 0, lanes: 1,
        group: n.group, band: gi.get(n.group) ?? 0, layer: n.layer,
      });
    });
  });

  const width = PAD_X * 2 + Math.max(1, layers.length) * COL_PITCH;
  const height = PAD_Y * 2 + tallest;
  return { pos, width, height, layers };
}

/** 布局核验（新判据）：列对齐 / 列内等距 / 整列居中 / 无重叠 / 最小间距 */
export function layoutStats(nodes, layout) {
  const pts = nodes.map((n) => ({ id: n.id, group: n.group, layer: n.layer, ...layout.pos.get(n.id) }));
  let minGap = Infinity;
  let minRectGap = Infinity;
  const overlaps = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = Math.abs(pts[i].x - pts[j].x);
      const dy = Math.abs(pts[i].y - pts[j].y);
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < minGap) minGap = d;
      const a = CARD_BOX[tierOfNum(pts[i].layer)] || CARD_BOX[3];
      const b = CARD_BOX[tierOfNum(pts[j].layer)] || CARD_BOX[3];
      const rg = Math.max(dx - (a.w + b.w) / 2, dy - (a.h + b.h) / 2);
      if (rg < minRectGap) minRectGap = rg;
      if (rg < -0.5) overlaps.push([pts[i].id, pts[j].id, Number(rg.toFixed(1))]);
    }
  }

  // 列结构：同列 x 必须完全一致（colSpread=0）、列内等距（rowPitchMin）、整列居中（centerOffset）
  const byCol = new Map();
  for (const p of pts) {
    if (!byCol.has(p.col)) byCol.set(p.col, []);
    byCol.get(p.col).push(p);
  }
  let colSpread = 0;               // 同列 x 的散布（现在 = 抖动的 2 倍幅度）
  let maxJx = 0, maxJy = 0;        // 实际抖动幅度（相对未抖动的锚点 ax/ay）
  let rowPitchMin = Infinity;
  let rowPitchMax = 0;
  const centers = [];
  for (const arr of byCol.values()) {
    const xs = arr.map((p) => p.x);
    colSpread = Math.max(colSpread, Math.max(...xs) - Math.min(...xs));
    for (const p of arr) {
      if (Number.isFinite(p.ax)) maxJx = Math.max(maxJx, Math.abs(p.x - p.ax));
      if (Number.isFinite(p.ay)) maxJy = Math.max(maxJy, Math.abs(p.y - p.ay));
    }
    const ys = arr.map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const pitch = ys[i] - ys[i - 1];
      rowPitchMin = Math.min(rowPitchMin, pitch);
      rowPitchMax = Math.max(rowPitchMax, pitch);
    }
    centers.push((ys[0] + ys[ys.length - 1]) / 2);
  }
  const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
  const centerOffset = Math.max(...centers.map((c) => Math.abs(c - mid)));
  const groupRuns = [...byCol.values()].every((arr) => {
    const seen = new Set();
    let last = null;
    // 必须按**列内实际顺序**（y 升序）判"同组连续" —— arr 是按 nodes 原顺序收集的，
    // 直接遍历会把顺序搞错（实测误报 groupRuns=false）。
    for (const p of [...arr].sort((a, b) => a.y - b.y)) {
      if (p.group !== last) {
        if (seen.has(p.group)) return false;   // 同组被别的组切开 → 不算"一撮"
        seen.add(p.group); last = p.group;
      }
    }
    return true;
  });

  return {
    minGap: Number.isFinite(minGap) ? minGap : Infinity,
    minRectGap: Number.isFinite(minRectGap) ? minRectGap : Infinity,
    overlaps,
    colSpread,
    maxJx,
    maxJy,
    rowPitchMin: Number.isFinite(rowPitchMin) ? rowPitchMin : Infinity,
    rowPitchMax,
    centerOffset,
    groupRuns,
    cols: byCol.size,
    count: pts.length,
  };
}
