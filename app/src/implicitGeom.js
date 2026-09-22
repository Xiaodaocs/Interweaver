// 隐函数几何（T2）：等值线提取（marching squares）→ 折线合并 → 连通分量 → 弧长参数化
//
// 纯模块：不依赖 DOM / 相机 / 实体 / 主题 —— 输入"世界矩形 + 网格步长 + F(x,y) 求值函数"，
// 输出"折线 + 分量 + t↔点 双向映射"。因此可以在 Node 里直接断言（本项目的既有做法）。
//
// 为什么需要弧长参数化：要让"用点在隐函数上切出曲线"成立，必须存在 t↔曲线点的双向映射；
// 没有它就只能画一条看得见、摸不着的曲线。这里用折线累计弧长做参数 t∈[0,1]（数值解，不是桩）。
//
// 关于 NaN：任一角非有限（NaN/∞）的格子**跳过** —— 这是等值线提取的算法语义，不是兜底掩盖。

const EPS = 1e-12;

/** 在 (x0,y0)-(x1,y1) 段上找 F=0 的插值位置 */
function interp(x0, y0, x1, y1, v0, v1) {
  const d = v1 - v0;
  const s = Math.abs(d) < EPS ? 0.5 : -v0 / d;
  return [x0 + (x1 - x0) * s, y0 + (y1 - y0) * s];
}

/** 端点去重的键（相邻格共享边时插值输入完全相同 → 浮点结果一致，键取 1e-9 相对精度足够） */
function key(x, y) {
  return Math.round(x * 1e6) + "," + Math.round(y * 1e6);
}

/**
 * 提取等值线。
 * @param {{x0:number,y0:number,x1:number,y1:number,cell:number,F:(x:number,y:number)=>number}} opts
 * @returns {{polys:number[][][], components:Array, total:number, pointAt:(t:number)=>object, project:(x:number,y:number)=>object}}
 */
export function buildContours(opts) {
  const { x0, y0, x1, y1, cell, F } = opts;
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell));
  const ny = Math.max(2, Math.ceil((y1 - y0) / cell));
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;

  // ① 采样 F 到 (nx+1)×(ny+1) 网格
  const V = new Float64Array((nx + 1) * (ny + 1));
  const okFlag = new Uint8Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const v = F(x0 + i * dx, y0 + j * dy);
      const finite = Number.isFinite(v);
      V[j * (nx + 1) + i] = finite ? v : 0;
      okFlag[j * (nx + 1) + i] = finite ? 1 : 0;
    }
  }

  // ② 逐格提取线段（16 情形；鞍点用格心均值消歧 —— 否则马鞍处会连错）
  const segs = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k00 = j * (nx + 1) + i, k10 = k00 + 1, k01 = k00 + (nx + 1), k11 = k01 + 1;
      if (!(okFlag[k00] && okFlag[k10] && okFlag[k01] && okFlag[k11])) continue;   // 算法语义：非有限格跳过
      const v0 = V[k00], v1 = V[k10], v2 = V[k11], v3 = V[k01];
      const px = x0 + i * dx, py = y0 + j * dy;
      const idx = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const eB = () => interp(px, py, px + dx, py, v0, v1);
      const eR = () => interp(px + dx, py, px + dx, py + dy, v1, v2);
      const eT = () => interp(px, py + dy, px + dx, py + dy, v3, v2);
      const eL = () => interp(px, py, px, py + dy, v0, v3);
      // 丢弃零长度线段：等值线正好穿过网格点时，两条边上的插值点会重合（实测圆产生 4 条零长段），
      // 零长度段不含几何信息，丢弃是 marching squares 的正确语义（不是兜底掩盖）。
      const push = (a, b) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) segs.push([a, b]); };
      switch (idx) {
        case 1: push(eB(), eL()); break;
        case 2: push(eB(), eR()); break;
        case 3: push(eL(), eR()); break;
        case 4: push(eR(), eT()); break;
        case 5: {
          const avg = (v0 + v1 + v2 + v3) / 4;
          if (avg > 0) { push(eB(), eR()); push(eL(), eT()); }
          else { push(eB(), eL()); push(eR(), eT()); }
          break;
        }
        case 6: push(eB(), eT()); break;
        case 7: push(eL(), eT()); break;
        case 8: push(eL(), eT()); break;
        case 9: push(eB(), eT()); break;
        case 10: {
          const avg = (v0 + v1 + v2 + v3) / 4;
          if (avg > 0) { push(eB(), eL()); push(eR(), eT()); }
          else { push(eB(), eR()); push(eL(), eT()); }
          break;
        }
        case 11: push(eR(), eT()); break;
        case 12: push(eL(), eR()); break;
        case 13: push(eB(), eR()); break;
        case 14: push(eB(), eL()); break;
        default: break;
      }
    }
  }

  // ③ 合并线段为折线：用端点键把相邻线段串起来（每个端点最多接 2 段 → 简单链式合并）
  const byKey = new Map();
  const used = new Array(segs.length).fill(false);
  for (let s = 0; s < segs.length; s++) {
    for (const p of segs[s]) {
      const kk = key(p[0], p[1]);
      if (!byKey.has(kk)) byKey.set(kk, []);
      byKey.get(kk).push(s);
    }
  }
  const polys = [];
  const walk = (startSeg, startPt) => {
    const pts = [startPt];
    let cur = startSeg;
    let curPt = startPt;
    for (;;) {
      used[cur] = true;
      const [a, b] = segs[cur];
      const nxt = (key(a[0], a[1]) === key(curPt[0], curPt[1])) ? b : a;
      pts.push(nxt);
      curPt = nxt;
      const cands = (byKey.get(key(curPt[0], curPt[1])) || []).filter((s) => !used[s]);
      if (!cands.length) break;
      cur = cands[0];
    }
    return pts;
  };
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    const pts = walk(s, segs[s][0]);
    if (pts.length >= 2) polys.push(pts);
  }

  // ④ 连通分量：按"共享端点"把折线并起来（并查集）
  const parent = polys.map((_, i) => i);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const polyEnds = polys.map((p) => [key(p[0][0], p[0][1]), key(p[p.length - 1][0], p[p.length - 1][1])]);
  const endOwner = new Map();
  polyEnds.forEach((ends, i) => {
    for (const kk of ends) {
      if (endOwner.has(kk)) uni(i, endOwner.get(kk)); else endOwner.set(kk, i);
    }
  });

  // ⑤ 弧长参数化：按分量分组、分量内按折线顺序拼接累计弧长
  const groups = new Map();
  polys.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  const ordered = [];
  for (const [, idxs] of groups) for (const i of idxs) ordered.push(i);

  const starts = [];
  let total = 0;
  const lengths = polys.map((p) => {
    let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return L;
  });
  for (const i of ordered) { starts.push(total); total += lengths[i]; }

  const components = [];
  {
    let acc = 0;
    for (const [root, idxs] of groups) {
      let L = 0;
      for (const i of idxs) L += lengths[i];
      const from = total > 0 ? acc / total : 0;
      acc += L;
      const to = total > 0 ? acc / total : 0;
      components.push({ root, polyIdx: idxs.slice(), from, to, len: L });
    }
  }

  const pointAt = (t) => {
    if (!ordered.length || total <= 0) return null;
    const s = Math.min(1, Math.max(0, t)) * total;
    let which = 0;
    for (let k = 0; k < ordered.length; k++) {
      if (s <= starts[k] + lengths[ordered[k]] || k === ordered.length - 1) { which = k; break; }
    }
    const pi = ordered[which];
    const p = polys[pi];
    let rem = s - starts[which];
    for (let i = 1; i < p.length; i++) {
      const segLen = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (rem <= segLen || i === p.length - 1) {
        const f = segLen < EPS ? 0 : rem / segLen;
        const comp = components.find((c) => c.polyIdx.includes(pi));
        return { x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f, compIdx: comp ? components.indexOf(comp) : 0 };
      }
      rem -= segLen;
    }
    return null;
  };

  const project = (qx, qy) => {
    let best = null;
    for (let k = 0; k < ordered.length; k++) {
      const pi = ordered[k];
      const p = polys[pi];
      let acc = 0;
      for (let i = 1; i < p.length; i++) {
        const ax = p[i - 1][0], ay = p[i - 1][1], bx = p[i][0], by = p[i][1];
        const vx = bx - ax, vy = by - ay;
        const segLen2 = vx * vx + vy * vy;
        let f = segLen2 < EPS ? 0 : ((qx - ax) * vx + (qy - ay) * vy) / segLen2;
        f = Math.min(1, Math.max(0, f));
        const cx = ax + vx * f, cy = ay + vy * f;
        const d = Math.hypot(qx - cx, qy - cy);
        const segLen = Math.sqrt(segLen2);
        if (!best || d < best.dist) {
          const comp = components.find((c) => c.polyIdx.includes(pi));
          best = {
            dist: d, x: cx, y: cy,
            t: total > 0 ? (starts[k] + acc + segLen * f) / total : 0,
            compIdx: comp ? components.indexOf(comp) : 0,
          };
        }
        acc += segLen;
      }
    }
    return best;
  };

  return { polys, components, total, lengths, pointAt, project, grid: { nx, ny, dx, dy } };
}
