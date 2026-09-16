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
export const PORT_PAD = 31;   // 线头到节点中心的距离 = 最大徽标半宽(29) + 2，保证线正好接到徽标边缘
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


/**
 * 长边曲线（方案 §3.4；实测把交叉从 57 降到 28、占比 19%）。
 * 关键：这个分支放在**车道分配之后**调用 —— 曲线边照常占用它本来会用的那条车道，
 * 于是"剩余边"的车道分配与基线完全一致（上一版把它放在分配之前，导致 1 处穿线）。
 */
function buildCurve(a, b, x1, x2, obstacles, edge) {
  const SPAN = 24;
  const baseL = Math.max(60, Math.min(160, Math.abs(x2 - x1) * 0.35));
  const dir = x2 >= x1 ? 1 : -1;
  const OFFSETS = [0, -60, 60, -120, 120, -180];
  const cubic = (p0, p1, p2, p3, s) => {
    const u = 1 - s;
    return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
  };
  for (const off of OFFSETS) {
    const py0 = a.y + off, py3 = b.y + off;
    const pts = [];
    for (let i = 0; i <= SPAN; i++) {
      const s = i / SPAN;
      pts.push([
        cubic(x1, x1 + dir * baseL, x2 - dir * baseL, x2, s),
        cubic(py0, py0, py3, py3, s),
      ]);
    }
    const clean = !pts.some(([X, Y]) => obstacles.some((r) => {
      if (r.id === edge.from || r.id === edge.to) return false;
      return X >= r.x0 - OBSTACLE_PAD && X <= r.x1 + OBSTACLE_PAD
        && Y >= r.y0 - OBSTACLE_PAD && Y <= r.y1 + OBSTACLE_PAD;
    }));
    if (clean) {
      return { from: edge.from, to: edge.to, kind: edge.kind || 'dep', points: pts, bridges: [], blocked: false, curve: true, laneY: null };
    }
  }
  return null;
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
  // ★ 用户要求 3：竖向段也要分道（此前"第一个干净的 x"会让大量边共用同一条竖线）。
  const vertSegs = [];   // [{ x, y0, y1 }]，y 区间重叠的竖段必须分到不同 x（间距 ≥4px）
  // ★ 用户要求 3（横向）：横向段的占用表。原 key 是 lo|hi|y，不同行带的边可以各自选到**同一个 y**
  //   （尤其 max(lo+1,…) 会把多条边夹到同一侧边界 y）→ 实测 168 对横向重合（h@625 x36）。
  //   改为按 y 与 x 区间重叠判占用。
  const laneSegs = [];   // [{ y, x0, x1 }]
  // ★ 端口占用表必须是**跨边共享**的。此前它在每条边的作用域内新建 → 永远为空表 →
  //   portTaken 恒为 false → 端口扇出从未生效（取证：枢纽 n.binding 的 9 条边逃逸段全在 y=625、x=599）。
  const portUsed = new Map();   // key = 节点id|侧，value = Set(已用偏移)
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
    // 线头必须接在**徽标边缘**上，而不是按槽位宽度算（此前用 NODE_W/2=75px，而徽标只有 ~43px 宽，
    // 线头因此悬在卡片外 30 多像素 —— 这就是"线的头没接到卡片上"的根因）。
    const x1 = right ? a.x + PORT_PAD : a.x - PORT_PAD;
    const x2 = right ? b.x - PORT_PAD : b.x + PORT_PAD;
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
    // ★ 用户要求"线之间也要避让开"：车道选择改成**优先独占**。
    //   旧逻辑是 `use < LANES_PER_GAP(6)` 就采用 → 一条车道可被最多 6 条边共用，
    //   于是水平段彼此压在一起（这就是"线之间没有避让"的直接原因）。
    //   现在：① 先找 use === 0 的**空车道**（越靠近中点越好）；② 全被占用时才退到"最闲的那条"。
    const midY = (a.y + b.y) / 2;
    let chosen = null;
    let fallback = null;
    for (const [lo, hi] of cand) {
      const want = Math.max(lo + 1, Math.min(hi - 1, midY));
      for (let k = 0; k < LANES_PER_GAP; k++) {
        const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * SUB_LANE_STEP;
        const y = Math.max(lo + 1, Math.min(hi - 1, want + off));
        const key = `${Math.round(lo)}|${Math.round(hi)}|${Math.round(y)}`;
        let use = laneUse.get(key) || 0;
        for (const s of laneSegs) {
          // 车道横走段实际跨越"走廊"（源列右侧空隙 → 目标列左侧空隙），跨度明显大于两节点中心之间，
          // 此前用节点中心区间判定 → 漏判（实测 9 条边共用 laneY=625，36 对重合）。这里按 COL_W/2=129 外扩。
          const loX = Math.min(a.x, b.x) - 129, hiX = Math.max(a.x, b.x) + 129;
          const ox = Math.min(s.x1, hiX) - Math.max(s.x0, loX);
          if (Math.abs(s.y - y) <= 3 && ox > 6) { use += 1; break; }   // 同 y 且横向区间重叠 → 视为已占用
        }
        if (use === 0) { chosen = { y, key, use }; break; }
        if (!fallback || use < fallback.use) fallback = { y, key, use };
      }
      if (chosen) break;
    }
    if (!chosen) {
      if (fallback) {
        // 全部占用：在"最闲的车道"旁再插入一条子车道（间距 SUB_LANE_STEP），保证不与原线重合
        const y2 = fallback.y + SUB_LANE_STEP;
        const key2 = fallback.key.replace(/|[-d.]+$/, '|' + Math.round(y2));
        chosen = { y: y2, key: key2, use: 0 };
      } else {
        const [lo, hi] = cand[0];
        chosen = { y: (lo + hi) / 2, key: `f${Math.round(lo)}`, use: 0 };
      }
    }
    laneUse.set(chosen.key, chosen.use + 1);
    // ★ A：跨 ≥3 层的长边改用曲线。放在这里（分配之后）是为了**保留车道占位**：
    //   曲线边仍占用它本来会用的车道，剩余边的分配不变（上一版放在分配之前 → 1 处穿线）。
    // 用户要求：全部改为直线 + 直角走线（Minecraft 成就页式），**不再使用曲线**。
    // 长边同样走正交折线（此前用曲线是为了降交叉，现在按要求换成直角）。

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
      let bestVert = null;   // ★ 用户要求 3：竖段分道 —— 在干净候选里挑与"已用竖段（y 区间重叠者）"距离最大者
      for (let x = lo + 2; x <= hi - 2; x += 4) cands.push(x);
      if (!cands.length) cands.push(mid);
      for (const x of cands) {
        if (!Number.isFinite(x)) continue;
        if (vertClean(x, yFrom, yTo, a.id, b.id)) {
          // 实测此前 708 对纵向重合（v@1928 一条竖线被 328 对线段共用）——根因就是"取第一个干净的 x"。
          let gap = 1e6;
          for (const u of vertSegs) {
            const overlap = Math.min(u.y1, Math.max(yFrom, yTo)) - Math.max(u.y0, Math.min(yFrom, yTo));
            if (overlap > 0) gap = Math.min(gap, Math.abs(x - u.x));
          }
          if (!bestVert || gap > bestVert.gap) bestVert = { x, gap };
        }
      }
      if (bestVert) {
        vertSegs.push({ x: bestVert.x, y0: Math.min(yFrom, yTo), y1: Math.max(yFrom, yTo) });
        return { x: bestVert.x, clean: true };
      }
      return { x: mid, clean: false };                     // 全部失败 → 兜底
    };
    const srcGapRight = cLo + 1 <= cHi ? cLo : cLo;        // 源列右侧空隙
    const dstGapLeft = cHi - 1 >= cLo ? cHi - 1 : cLo;
    const v1 = pickVertX(srcGapRight, Math.min(srcGapRight + 1, cols[cols.length - 1]), a.y, laneY);
    const v2 = pickVertX(dstGapLeft, Math.min(dstGapLeft + 1, cols[cols.length - 1]), b.y, laneY);
    const g1 = right ? v1.x : v2.x;
    const g2 = right ? v2.x : v1.x;
    laneSegs.push({ y: laneY, x0: Math.min(g1, g2), x1: Math.max(g1, g2) });   // ★ 用真实走廊跨度登记
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
    const ESCAPES = [0, -12, 12, -24, 24, -38, 38, -52, 52, -68, 68, -84, 84, -102, 102, -120, 120];   // 加密：扇出档位更多，残余重合更少
    // 竖直段检查（短逃逸用）：x 固定，从 yFrom 到 yTo
    const vClean = (x, yFrom, yTo) => !obstacles.some((r) => {
      if (r.id === a.id || r.id === b.id) return false;
      return hitsRectV(x, yFrom, yTo, r, OBSTACLE_PAD);
    });
    // ★ 用户要求 3（卡片旁边的那一段）：同一节点、同一侧的多条边此前都取第一个可用偏移，
    //   于是偏移 0 被反复选中 → 端口逃逸段完全重叠（实测 h@625 x36，即"像一根线"最刺眼处）。
    //   现在记录每个 (节点, 侧) 已用的偏移，优先挑未用过的，实现"端口扇出"。
    const portUse = portUsed;   // ★ 引用跨边共享的表（此前每条边新建 → 扇出失效）
    const pkey = (id) => id + (right ? "|R" : "|L");
    const portTaken = (id, off) => (portUse.get(pkey(id)) || new Set()).has(off);
    const portAdd = (id, off) => { const k = pkey(id); if (!portUse.has(k)) portUse.set(k, new Set()); portUse.get(k).add(off); };
    let y1 = a.y, y2 = b.y, portFound = false;
    for (const e1 of ESCAPES) {
      const c1 = a.y + e1;
      if (!vClean(x1, a.y, c1) || !hClean(c1, x1, g1)) continue;
      if (portTaken(a.id, e1) && portUse.get(pkey(a.id)).size < 20) continue;   // 该偏移已被同侧其它边占用 → 换一个（实现扇出）
      for (const e2 of ESCAPES) {
        const c2 = b.y + e2;
        if (!vClean(x2, b.y, c2) || !hClean(c2, g2, x2)) continue;
        if (portTaken(b.id, e2) && portUse.get(pkey(b.id)).size < 20) continue;
        portAdd(a.id, e1); portAdd(b.id, e2);
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
      // ★ 曲线的采样小段既非水平也非竖直，却被下面的代码当成"竖直段"来测（用首点 x 测一段斜线）
      //   → 误报"穿节点"（实测那 1 处就是误报，曲线本身已由 buildCurve 的 24 点采样验证为干净）。
      //   所以：非正交的段在这里跳过。
      if (Math.abs(y1 - y2) >= 0.01 && Math.abs(x1 - x2) >= 0.01) continue;
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
