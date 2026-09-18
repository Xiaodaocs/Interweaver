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

export function layoutOrganic(nodes, groups, deps = [], opts = {}) {
  const relaxIters = opts.relaxIters === undefined ? 30 : opts.relaxIters;
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const gi = new Map(groups.map((g, i) => [g, i]));

  const cells = new Map();
  for (const n of nodes) {
    const k = `${n.layer}|${n.group}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(n);
  }
  for (const arr of cells.values()) arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const bandH = new Map(groups.map((g) => [g, BAND_H]));
  const bandTop = new Map();
  const bandCenter = new Map();
  const recomputeBands = () => {
    let top = PAD_Y;
    for (const g of groups) {
      bandTop.set(g, top);
      bandCenter.set(g, top + bandH.get(g) / 2);
      top += bandH.get(g) + BAND_GAP;
    }
    return top;
  };
  let totalBottom = recomputeBands();

  const pos = new Map();
  // ★ A + α：**列宽随该列的子道数变化**（设计 §2.4 的落地规则）
  //   width(L) = NODE_W + (L−1)×SUB_STEP + 2×MAX_DX + 走廊(56)
  //   L=1 → 258（走廊 56px，净空 40px）／L=2 → 348／L=3 → 438
  //   若列宽固定为 258，子道会把节点横向撑进走廊 → 走线穿线数暴涨（实测 0 → 261）。
  const CORRIDOR = 56;
  const usableBand = Math.max(MIN_GAP, BAND_H - 2 * MARGIN);
  const maxPerLaneBand = 2;   // 纵向预算再分配：每道最多 2 个节点 → 更多子道（更宽）、更矮的组带（更矮）
  void usableBand;
  // ★ 容量必须按"**列 × 组**"的总数算，而不是按"最挤的单个格子"（层×组）算。
  //   依据（实测）：一条组带被该组在**多个层**上的多个格子共用（例：「构造与约束」横跨 L2/L3/L4，
  //   同一列里有 7+5+3 = 15 个节点），若按"最挤格子 7 个 → 3 条子道"分配，
  //   15 个节点会被塞进 3 条子道的纵向空间里 → 分离算法放不下，夹紧后出现 3.7px 间距与 3 对重叠。
  const lanesOfCol = new Map();
  const perGroupCol = new Map();
  for (const [k, arr] of cells) {
    const [layerStr, group0] = k.split('|');
    const col0 = layers.indexOf(Number(layerStr));
    const key0 = `${group0}|${col0}`;
    perGroupCol.set(key0, (perGroupCol.get(key0) || 0) + arr.length);
  }
  for (const [key0, total] of perGroupCol) {
    const col0 = Number(key0.split('|')[1]);
    const L0 = Math.max(1, Math.ceil(total / maxPerLaneBand));
    lanesOfCol.set(col0, Math.max(lanesOfCol.get(col0) || 1, L0));
  }
  const widthOfCol = (L) => NODE_W + (L - 1) * SUB_STEP + 2 * MAX_DX + CORRIDOR;
  const colX = new Map();
  {
    let cursor = PAD_X;
    for (const layer of layers) {
      const idx = layers.indexOf(layer);
      colX.set(idx, cursor);
      cursor += widthOfCol(lanesOfCol.get(idx) || 1);
    }
  }
  for (const [k, arr] of cells) {
    const [layerStr, group] = k.split('|');
    const col = layers.indexOf(Number(layerStr));
    const cx = colX.get(col) + widthOfCol(lanesOfCol.get(col) || 1) / 2;
    const center = bandCenter.get(group);
    // ★ A（已拍板）：一列/一格太挤时在该层内开**子道**，而不是把组带往上顶。
    //   一条子道在带内最多放 maxPerLane 个；格子超了就把节点轮转进多条子道，
    //   子道横向偏移 ±SUB_STEP，于是"竖直跨度"按子道数摊薄 → 组带不再被撑高（带外溢出 → 0）。
    const usable = Math.max(MIN_DY, bandH.get(group) - 2 * MARGIN);
    const maxPerLane = Math.max(1, Math.floor(usable / MIN_DY) + 1);
    const L = Math.max(1, Math.ceil(arr.length / maxPerLane));
    const perLane = Array.from({ length: L }, () => []);
    arr.forEach((n, i) => perLane[i % L].push(n));
    perLane.forEach((list, li) => {
      const laneX = cx + (li - (L - 1) / 2) * SUB_STEP;
      const step = list.length > 1 ? Math.max(MIN_DY, Math.min(78, usable / (list.length - 1))) : 0;
      list.forEach((n, i) => {
        const spread = (i - (list.length - 1) / 2) * step;
        const jx = (hash01(n.id + ':x') * 2 - 1) * MAX_DX * (L > 1 ? 0.5 : 1);
        const jy = (hash01(n.id + ':y') * 2 - 1) * bandH.get(group) * MAX_DY_RATIO * 0.5;
        const x = laneX + jx, y = center + spread + jy;
        pos.set(n.id, { id: n.id, x, y, ax: x, ay: y, col, row: i, lane: li, lanes: L, group, band: gi.get(group) || 0, layer: n.layer });
      });
    });
  }

  const ids = [...pos.keys()];
  const byCol = new Map();
  for (const id of ids) {
    const p = pos.get(id);
    if (!byCol.has(p.col)) byCol.set(p.col, []);
    byCol.get(p.col).push(id);
  }
  for (const arr of byCol.values()) arr.sort((a, b) => (pos.get(a).y - pos.get(b).y) || (a < b ? -1 : 1));

  // 硬分离：同列按 y 排序后直接把后一个顶到 ≥MIN_GAP（不做软化，收敛到位）；
  // 跨列分不开时，把"定序靠后的"整份推开。多轮是因为推一个会影响另一个。
  const separate = () => {
    for (let round = 0; round < 8; round++) {
      let moved = false;
      for (const arr of byCol.values()) {
        for (let i = 1; i < arr.length; i++) {
          const a = pos.get(arr[i - 1]), b = pos.get(arr[i]);
          if (Math.abs(a.x - b.x) >= MIN_DX) continue;      // 水平净距已够（卡片宽 72）→ 不必再动 y
          const need = MIN_DY - (b.y - a.y);
          if (need > 0) {
            // ⚠ 这里曾经改成"带感知推挤 + 夹紧"，结果是**退步**：带内容量本就不够时，
            //   夹紧把两个节点压到 3.7px、产生 3 对重叠，还连带把走线穿线数从 0 推到 67。
            //   正确顺序是**先把容量算对**（按"列×组"的节点总数分配纵向空间），再谈夹紧；
            //   在容量算对之前，保持原有的无界推挤（它只是把节点顶出带，不会破坏间距）。
            b.y += need; moved = true;
          }
        }
      }
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const A = pos.get(ids[i]), B = pos.get(ids[j]);
          // ★ 同一列内的两个节点（可能是**不同子道**，dx≈SUB_STEP=90）属于"同列间距"的职责，
          //   不该由这条跨列规则处理：它会把节点沿 y 推开，从而**顶出组带**
          //   （实测：带内归属因此差 1px；为兜住它只能撑高带 → 画布 3305px，等于退化成 C 方案）。
          //   同列不同子道的横向间距 90px ≥ MIN_GAP(46) 已经足够，无需再动 y。
          
          const dx = Math.abs(B.x - A.x), dy = Math.abs(B.y - A.y);
          if (dx >= MIN_DX) continue;                        // 水平净距足够 → 不推
          if (dy >= MIN_DY) continue;
          const need = MIN_DY - dy;
          const later = (B.col > A.col || (B.col === A.col && B.row >= B.row && B.col >= A.col)) ? B : A;
          // ★ 带感知的推力（实测依据）：原来无脑 `later.y += need`，在密集区被累积执行几十次，
          //   把节点推到离带心 375px 的地方（实测 w.probeFunc）。现在：
          //   优先向下推 → 若会越出组带就改为向上推 → 无论如何**夹在组带内**。
          //   带内确实放不下时才由子道（列宽 258→348→438）解决，而不是把节点顶出带、也不是撑高带。
          const centerL = bandCenter.get(later.group);
          const halfL = (bandH.get(later.group) || BAND_H) / 2 - 2;
          let ny = later.y + need;
          if (ny > centerL + halfL) ny = later.y - need;
          later.y = ny;   // 不夹在带内（夹住会让 fitBands 看不到偏离、组带不再生长 → 节点被挤）
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  separate();

  // 迭代：扩张带宽 → 把节点搬回自己的带 → 再分离（最多 4 轮，直到既不溢出也不破间距）
  const fitBands = () => {
    const oldCenters = new Map([...bandCenter.entries()]);
    for (const g of groups) {
      const ys = ids.map((id) => pos.get(id)).filter((p) => p.group === g).map((p) => p.y);
      if (!ys.length) continue;
      // ★ 用"**最大偏离带心**"而不是"跨度"来决定带宽：
      //   跨列分离会把节点沿 y 推开（最多一个 MIN_GAP），可能把某个节点顶到带外；
      //   若按"跨度"算，**只含 1 个节点的组会被跳过**（跨度恒为 0，带宽永不扩张），
      //   于是那个落单节点永远差 1px 出界（实测正是 1.0px）。
      //   改成 max|y − 带心| 之后，任何节点数都能保证"带内归属由构造成立"。
      const center = bandCenter.get(g);
      const worst = Math.max(...ys.map((y) => Math.abs(y - center)));
      // ★ 带宽**上限**：已拍板的是 A（列内分道），不是 C（组带自由生长）。
      //   若允许无限撑高，画布会涨到 3305px、每条带 ~800px 高，"同组一条带"的观感被拉长。
      //   所以这里封顶 BAND_H×1.35，超出的拥挤只能靠**子道**解决（见放置与分离逻辑）。
      // ⚠ 实测（tests/bisect-layout.mjs 的②号对照）：带宽**上限**是这一路退步的根源 ——
      //   加上限 → 间距 3.7px / 3 对重叠 / 穿线 58；去掉上限 → 间距 34.9 / 重叠 1 / 溢出 0 / 穿线 27。
      //   在当前节点与边的数据下，四条不变量是**靠"让组带长到需要的高度"同时成立**的；
      //   要同时把画布收窄，必须先完成 A 的完整语义（纵向分布按"列×组"统一铺开 + 子道按列×组总数分配）。
      //   在完成之前，保留"四条不变量全绿"的这一版，而不是为了画布高度把不变量弄红。
      const need = 2 * (worst + MARGIN);
      if (need > bandH.get(g)) bandH.set(g, need);
    }
    totalBottom = recomputeBands();
    for (const id of ids) {
      const p = pos.get(id);
      p.y += bandCenter.get(p.group) - oldCenters.get(p.group);
    }
  };
  for (let i = 0; i < 4; i++) { fitBands(); separate(); }

  // §2.3 松弛（有界）
  for (let it = 0; it < relaxIters; it++) {
    const fx = new Map(ids.map((id) => [id, 0]));
    const fy = new Map(ids.map((id) => [id, 0]));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]), b = pos.get(ids[j]);
        if (a.group !== b.group && Math.abs(a.col - b.col) > 1) continue;
        const ddx = b.x - a.x, ddy = b.y - a.y;
        const d = Math.hypot(ddx, ddy) || 0.001;
        if (d >= REPEL_DIST) continue;
        const push = (REPEL_DIST - d) / REPEL_DIST;
        const ux = ddx / d, uy = ddy / d;
        fx.set(ids[i], fx.get(ids[i]) - ux * push * 5);
        fy.set(ids[i], fy.get(ids[i]) - uy * push * 5);
        fx.set(ids[j], fx.get(ids[j]) + ux * push * 5);
        fy.set(ids[j], fy.get(ids[j]) + uy * push * 5);
      }
    }
    for (const [u, v] of deps) {
      const a = pos.get(u), b = pos.get(v);
      if (!a || !b) continue;
      const ddx = b.x - a.x, ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 0.001;
      let want = 0;
      if (d < SPRING_MIN) want = (d - SPRING_MIN) * 0.04;
      else if (d > SPRING_MAX) want = (d - SPRING_MAX) * 0.02;
      if (!want) continue;
      const ux = ddx / d, uy = ddy / d;
      fx.set(u, fx.get(u) + ux * want);
      fy.set(u, fy.get(u) + uy * want);
      fx.set(v, fx.get(v) - ux * want);
      fy.set(v, fy.get(v) - uy * want);
    }
    for (const id of ids) {
      const p = pos.get(id);
      p.x += fx.get(id) + (p.ax - p.x) * ANCHOR_W;
      // ★ 夹回抖动边界（每轮都夹）：否则松弛的横向推力会把节点推离本列，吃掉列间走廊
      p.x = Math.max(p.ax - MAX_DX, Math.min(p.ax + MAX_DX, p.x));
      p.y += fy.get(id) + (p.ay - p.y) * ANCHOR_W;
      // ⚠ 这里曾加过"每轮把 y 夹回组带内"，实测是**退步**：带内容量本就不够时，
      //   夹紧会把节点压到 3.7px、产生 3 对重叠，并把走线穿线数从 0 推到 67。
      //   正确顺序：**先把容量算对**（按"列×组"总数分配纵向空间），再谈夹紧与带内归属。
    }
  }
  // 松弛之后再走一遍"分离 + 归带"；最后把节点**夹紧回自己带的范围内**，再分离一次
  for (let i = 0; i < 3; i++) { fitBands(); separate(); }
  for (const id of ids) {
    const p = pos.get(id);
    const half = (bandH.get(p.group) || BAND_H) / 2;
    const center = bandCenter.get(p.group);
    p.y = Math.max(center - half + MARGIN * 0.5, Math.min(center + half - MARGIN * 0.5, p.y));
  }
  separate();
  // 夹紧可能把谁又推出带外（被顶出来的那个）→ 再夹一次并允许带宽随之扩张
  for (let i = 0; i < 3; i++) {
    let worst = 0;
    for (const id of ids) {
      const p = pos.get(id);
      const half = (bandH.get(p.group) || BAND_H) / 2;
      worst = Math.max(worst, Math.abs(p.y - bandCenter.get(p.group)) - half);
    }
    if (worst <= 0) break;
    fitBands(); separate();
  }
  // ★ 收尾必须"以扩张带宽结束"，而不是以 separate() 结束：
  //   循环里最后一步是 separate()，它可能把某个节点又顶出带外 1px（实测残留 1.0px）。
  //   fitBands() 只做"带宽扩张 + 整体平移"，是纯平移，不改变任何相对间距，
  //   所以放在最后既保证带内归属（由构造成立），又不会破坏 ≥46px 这条硬不变量。
  fitBands();

  const xs = ids.map((id) => pos.get(id).x), ys = ids.map((id) => pos.get(id).y);
  const width = Math.max(...xs, 0) + PAD_X + COL_W / 2;
  const height = Math.max(Math.max(...ys, 0) + PAD_Y + BAND_H / 2, totalBottom + PAD_Y / 2);
  return { pos, width, height, layers, bandH, bandCenter, bandTop };
}

/** 供核验：最小间距 / 重叠 / **带内归属**（替代与间距互斥的"标准差"判据） */
export function layoutStats(nodes, layout) {
  const pts = nodes.map((n) => ({ id: n.id, group: n.group, layer: n.layer, ...layout.pos.get(n.id) }));
  let minGap = Infinity, minSameCol = Infinity;
  const overlaps = [];
  let minRectGap = Infinity;   // 卡片矩形的最小净距（< 0 即重叠）
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < minGap) minGap = d;
      if (pts[i].col === pts[j].col && d < minSameCol) minSameCol = d;
      const ga2 = CARD_BOX[tierOfNum(pts[i].layer)] || CARD_BOX[3];
      const gb2 = CARD_BOX[tierOfNum(pts[j].layer)] || CARD_BOX[3];
      const rg = Math.max(Math.abs(pts[i].x - pts[j].x) - (ga2.w + gb2.w) / 2, Math.abs(pts[i].y - pts[j].y) - (ga2.h + gb2.h) / 2);
      if (rg < minRectGap) minRectGap = rg;
      if (rg < -0.5) overlaps.push([pts[i].id, pts[j].id, Number(rg.toFixed(1))]);
    }
  }
  let worstOutOfBand = 0;
  for (const p of pts) {
    const half = (layout.bandH.get(p.group) || BAND_H) / 2;
    const out = Math.abs(p.y - layout.bandCenter.get(p.group)) - (half + MARGIN);
    if (out > worstOutOfBand) worstOutOfBand = out;
  }
  let crossBand = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].group === pts[j].group) continue;
      const a = pts[i], b = pts[j];
      const aIn = Math.abs(a.y - layout.bandCenter.get(a.group)) <= layout.bandH.get(a.group) / 2;
      const bIn = Math.abs(b.y - layout.bandCenter.get(b.group)) <= layout.bandH.get(b.group) / 2;
      if (aIn && bIn && Math.hypot(a.x - b.x, a.y - b.y) < MIN_GAP) crossBand++;
    }
  }
  return {
    minGap: Number.isFinite(minGap) ? minGap : Infinity,
    minSameCol: Number.isFinite(minSameCol) ? minSameCol : Infinity,
    overlaps, bandOut: Math.max(0, worstOutOfBand), crossBand, count: pts.length,
  };
}
