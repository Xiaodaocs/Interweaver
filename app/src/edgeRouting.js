// T3 · 正交走线（设计 §3）
//
// 关键修正（第一版的错误）：第一版只在"两节点纵向中点附近"取 12 条候选车道，
// 但一条跨列边的**水平段必然横穿中间所有列**，而那些列里坐着节点 → 实测撞节点 294 次。
// 正确做法：水平走廊必须落在"它经过的**每一列**都空闲"的 y 区间里。
//   → 先按列求出该列的**空闲 y 区间**（候选矩形 + 8px padding 的补集），
//     再把 [源列+1, 目标列-1] 这些列的空闲区间**求交**，在交集里挑离中点最近的一条。
//   这样"0 条边穿过非端点节点"这条硬要求就由构造保证，而不是靠试。
//
// 其余照方案：端口三选一（上/中/下）、k=6 车道 + 13px 子车道、障碍绕行最多 6 次、
// 水平段与竖向短段相交处记"拱桥"、端口处留 STUB 供渲染做 8px 圆角。
export const LANES_PER_GAP = 6;
export const LANE_STEP = 26;
export const SUB_LANE_STEP = 13;
export const OBSTACLE_PAD = 8;
export const STUB = 14;
export const NODE_H = 46;
export const NODE_W = 150;

const rectOf = (n) => ({
  id: n.id, col: n.col,
  x0: n.x - NODE_W / 2, x1: n.x + NODE_W / 2,
  y0: n.y - NODE_H / 2, y1: n.y + NODE_H / 2,
});

function hitsRectH(y, xa, xb, r, pad) {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  return y >= r.y0 - pad && y <= r.y1 + pad && hi > r.x0 - pad && lo < r.x1 + pad;
}
function hitsRectV(x, ya, yb, r, pad) {
  const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
  return x >= r.x0 - pad && x <= r.x1 + pad && hi > r.y0 - pad && lo < r.y1 + pad;
}

/** 某列（按 x 范围判定）的障碍 y 区间 */
function columnIntervals(obstacles, xa, xb, pad) {
  const out = [];
  for (const r of obstacles) {
    if (Math.max(xa, r.x0 - pad) < Math.min(xb, r.x1 + pad)) out.push([r.y0 - pad, r.y1 + pad]);
  }
  out.sort((p, q) => p[0] - q[0]);
  return out;
}

/** 空闲 y 区间（给定障碍区间的补集） */
function freeIntervals(blocked, lo, hi) {
  const free = [];
  let cur = lo;
  for (const [a, b] of blocked) {
    if (b <= cur) continue;
    if (a > cur) free.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) free.push([cur, hi]);
  return free.filter(([a, b]) => b - a > 2);
}

function intersectIntervals(lists) {
  if (!lists.length) return [];
  let acc = lists[0];
  for (let i = 1; i < lists.length; i++) {
    const out = [];
    for (const [a1, b1] of acc) {
      for (const [a2, b2] of lists[i]) {
        const lo = Math.max(a1, a2), hi = Math.min(b1, b2);
        if (hi - lo > 2) out.push([lo, hi]);
      }
    }
    acc = out;
    if (!acc.length) break;
  }
  return acc;
}

export function routeEdges(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const obstacles = nodes.map(rectOf);
  const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const colSpan = new Map(cols.map((c) => {
    const xs = nodes.filter((n) => n.col === c).map((n) => n.x);
    return [c, [Math.min(...xs) - NODE_W / 2, Math.max(...xs) + NODE_W / 2]];
  }));
  // 列间空隙中心：竖直段放这里，天然不撞任何节点（空隙里没有节点）
  const gapX = new Map();          // col → 该列右侧空隙的中心 x
  for (let i = 0; i < cols.length - 1; i++) {
    const c = cols[i], c2 = cols[i + 1];
    const rightEdge = (colSpan.get(c) || [0, 0])[1];
    const leftEdge = (colSpan.get(c2) || [0, 0])[0];
    gapX.set(c, (rightEdge + leftEdge) / 2);
  }

  const allY = nodes.map((n) => n.y);
  const Y_LO = Math.min(...allY) - 90, Y_HI = Math.max(...allY) + 90;

  const laneUse = new Map();
  const paths = [];
  let bridges = 0;

  const sorted = [...edges]
    .filter((e) => byId.has(e.from) && byId.has(e.to) && byId.get(e.from).col !== byId.get(e.to).col)
    .sort((a, b) => {
      const A = byId.get(a.from), B = byId.get(b.from);
      return (A.col - B.col) || (A.y - B.y) || (a.from < b.from ? -1 : 1);
    });

  for (const e of sorted) {
    const a = byId.get(e.from), b = byId.get(e.to);
    const right = b.x >= a.x;
    const x1 = right ? a.x + NODE_W / 2 : a.x - NODE_W / 2;
    const x2 = right ? b.x - NODE_W / 2 : b.x + NODE_W / 2;
    const cLo = Math.min(a.col, b.col), cHi = Math.max(a.col, b.col);

    // 中间列（不含源/目标列）的空闲 y 区间求交；再叠加源/目标列在 STUB 处的约束
    const lists = [];
    for (let c = cLo + 1; c <= cHi - 1; c++) {
      const [xa, xb] = colSpan.get(c) || [0, 0];
      lists.push(freeIntervals(columnIntervals(obstacles, xa, xb, OBSTACLE_PAD), Y_LO, Y_HI));
    }
    // 源/目标列只需保证"水平段没有被 STUB 包住的那一段"不撞——纵向短段在列内，
    // 因此这里把源列与目标列也纳入（用其列宽），确保端口两侧也干净。
    for (const c of [cLo, cHi]) {
      const [xa, xb] = colSpan.get(c) || [0, 0];
      lists.push(freeIntervals(columnIntervals(obstacles, xa, xb, OBSTACLE_PAD), Y_LO, Y_HI));
    }
    let cand = intersectIntervals(lists);
    if (!cand.length) {
      // 理论上不该发生（层与层之间总有空隙）；真发生了就退回中点并标记
      cand = [[(a.y + b.y) / 2, (a.y + b.y) / 2 + 1]];
    }
    // 在候选区间里取"离中点最近"的 y；同一区间的不同边按用法错开 13px（子车道）
    const midY = (a.y + b.y) / 2;
    let chosen = null;
    for (const [lo, hi] of cand) {
      const want = Math.max(lo + 1, Math.min(hi - 1, midY));
      for (let k = 0; k < LANES_PER_GAP; k++) {
        const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * SUB_LANE_STEP;
        const y = Math.max(lo + 1, Math.min(hi - 1, want + off));
        const key = `${Math.round(lo)}|${Math.round(hi)}|${Math.round(y)}`;
        const use = laneUse.get(key) || 0;
        if (use < LANES_PER_GAP) { chosen = { y, key, use }; break; }
      }
      if (chosen) break;
    }
    if (!chosen) { const [lo, hi] = cand[0]; chosen = { y: (lo + hi) / 2, key: `f${Math.round(lo)}`, use: 0 }; }
    laneUse.set(chosen.key, chosen.use + 1);

    const laneY = chosen.y;
    // 竖直段走"源列右侧的空隙"与"目标列左侧的空隙"，而不是贴着节点 14px（那还在列内，会撞同列邻居）
    // 竖直段的 x 必须真正"空"：相邻列的 x 跨度会因抖动+节点宽度而重叠，
    // 所以不能假设空隙中点安全 —— 逐个候选试探（§3 第 4 条：最多重试 6 次，失败则穿过并标记）。
    const vertClean = (x, yFrom, yTo, idA, idB) => !obstacles.some((r) => {
      if (r.id === idA || r.id === idB) return false;
      return hitsRectV(x, yFrom, yTo, r, OBSTACLE_PAD);
    });
    const pickVertX = (colLeft, colRight, yFrom, yTo) => {
      const lo = (colSpan.get(colLeft) || [0, 0])[1];      // 左列右边界
      const hi = (colSpan.get(colRight) || [0, 0])[0];     // 右列左边界
      const mid = (lo + hi) / 2;
      // 在整个空隙上**均匀扫描**（每 4px 一个候选），而不是猜几个偏移：
      // 相邻列的 x 跨度会因层内抖动而互相重叠（抖动上限 31px + 节点半宽 75 > 列宽 258 的一半余量），
      // 于是"猜的偏移"常常全部落在某个节点的 8px padding 内 → 被误判为"无法避开"（实测 514 段穿线）。
      const cands = [];
      for (let x = lo + 2; x <= hi - 2; x += 4) cands.push(x);
      if (!cands.length) cands.push(mid);
      for (const x of cands) {
        if (!Number.isFinite(x)) continue;
        if (vertClean(x, yFrom, yTo, a.id, b.id)) return { x, clean: true };
      }
      return { x: mid, clean: false };                     // 六次都失败 → 兜底
    };
    const srcGapRight = cLo + 1 <= cHi ? cLo : cLo;        // 源列右侧空隙
    const dstGapLeft = cHi - 1 >= cLo ? cHi - 1 : cLo;
    const v1 = pickVertX(srcGapRight, Math.min(srcGapRight + 1, cols[cols.length - 1]), a.y, laneY);
    const v2 = pickVertX(dstGapLeft, Math.min(dstGapLeft + 1, cols[cols.length - 1]), b.y, laneY);
    const g1 = right ? v1.x : v2.x;
    const g2 = right ? v2.x : v1.x;
    // ★ §3 第 1 条：**端口三选一**。此前端口 y 固定取节点中心，于是"从节点右边缘到竖直走廊"
    //   那段水平线总贴着源节点自己的 y 横穿本列 —— 若同列相邻子道里有个节点 y 向重叠，
    //   就会被穿过（实测 n.chord → w.chordMid 撞 n.golden，越界段正是"第 0 段"）。
    //   现在按"该 y 的水平段不撞任何非端点节点"筛选上/中/下三个端口，两侧各自选一个干净的。
    const hClean = (y, xa, xb) => !obstacles.some((r) => {
      if (r.id === a.id || r.id === b.id) return false;
      return hitsRectH(y, xa, xb, r, OBSTACLE_PAD);
    });
    // 逃逸阶梯（§3 第 1 条"取最不拥挤的端口"的推广）：
    //   邻居的 padding 后 y 区间可达 62px，标准三端口（±17）可能全部落在其中，
    //   所以允许更宽的逃逸偏移；每档都要同时检查"短竖直段"与"水平段"。
    const ESCAPES = [0, -17, 17, -40, 40, -64, 64, -88, 88, -112, 112];
    // 竖直段检查（短逃逸用）：x 固定，从 yFrom 到 yTo
    const vClean = (x, yFrom, yTo) => !obstacles.some((r) => {
      if (r.id === a.id || r.id === b.id) return false;
      return hitsRectV(x, yFrom, yTo, r, OBSTACLE_PAD);
    });
    let y1 = a.y, y2 = b.y, portFound = false;
    for (const e1 of ESCAPES) {
      const c1 = a.y + e1;
      if (!vClean(x1, a.y, c1) || !hClean(c1, x1, g1)) continue;
      for (const e2 of ESCAPES) {
        const c2 = b.y + e2;
        if (!vClean(x2, b.y, c2) || !hClean(c2, g2, x2)) continue;
        y1 = c1; y2 = c2; portFound = true; break;
      }
      if (portFound) break;
    }
    const points = [
      [x1, y1],
      [g1, y1],
      [g1, laneY],
      [g2, laneY],
      [g2, y2],
      [x2, y2],
    ];

    // 拱桥：本边水平段与已存在边的竖向短段相交处
    const edgeBridges = [];
    for (const prev of paths) {
      for (const [p, q] of [[prev.points[1], prev.points[2]], [prev.points[3], prev.points[4]]]) {
        if (Math.abs(p[0] - q[0]) > 0.01) continue;
        const x = p[0];
        const ylo = Math.min(p[1], q[1]), yhi = Math.max(p[1], q[1]);
        const hx0 = Math.min(points[1][0], points[3][0]), hx1 = Math.max(points[1][0], points[3][0]);
        if (x > hx0 && x < hx1 && laneY > ylo && laneY < yhi) { edgeBridges.push([x, laneY]); bridges++; }
      }
    }

    paths.push({
      from: e.from, to: e.to, kind: e.kind || 'dep', points, laneY, bridges: edgeBridges,
      blocked: !(v1.clean && v2.clean),      // 无法完全避开障碍的边（渲染时降透明度到 0.45）
    });
  }

  // 自检（设计硬要求）：任何一段都不得穿过"非端点节点"
  let passThrough = 0;
  const offenders = [];
  for (const p of paths) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const [x1, y1] = p.points[i], [x2, y2] = p.points[i + 1];
      const horiz = Math.abs(y1 - y2) < 0.01;
      for (const r of obstacles) {
        if (r.id === p.from || r.id === p.to) continue;
        const hit = horiz ? hitsRectH(y1, x1, x2, r, OBSTACLE_PAD) : hitsRectV(x1, y1, y2, r, OBSTACLE_PAD);
        if (hit) { passThrough++; if (offenders.length < 5) offenders.push([p.from, p.to, r.id, horiz ? 'H' : 'V']); }
      }
    }
  }
  return {
    paths, bridges, laneUse,
    stats: { edges: paths.length, passThrough, offenders, bridgeCount: bridges, lanesUsed: laneUse.size },
  };
}
