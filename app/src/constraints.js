// P9 约束系统：几何关系的数值求解（Gauss-Newton，对"自由参数"求最小二乘）
// 纯模块（不碰 DOM），可在 Node 里直接单测。
// 设计要点：
//   · 约束不是绑定：绑定是"一个有向的算式"，约束是"该成立的几何关系"，要反解才有答案；
//   · 只求解【自由参数】（被绑定的参数与正在被拖动的参数都不参与，后者被"钉住"）；
//   · 求解后把残差写回每条约束的 error，UI 用它决定是否显示"未满足"。
import { paramsOf } from './entities.js';

export const KINDS = {
  coincident: { label: '重合', need: ['point', 'point'], badge: '●' },
  midpoint: { label: '中点', need: ['point', 'segment'], badge: '⦿' },
  horizontal: { label: '水平', need: ['segment'], badge: '—' },
  vertical: { label: '竖直', need: ['segment'], badge: '❘' },
  parallel: { label: '平行', need: ['segment', 'segment'], badge: '∥' },
  perpendicular: { label: '垂直', need: ['segment', 'segment'], badge: '⊥' },
  equallength: { label: '等长', need: ['segment', 'segment'], badge: '=' },
  tangent: { label: '相切', need: ['segment', 'circle'], badge: '◯' },
};

// 约束的"参照"说明（世界坐标系 / 另一条线）——用于 UI 里把选择讲清楚
export const REFERENCES = {
  horizontal: '世界坐标系（这条线被调平）',
  vertical: '世界坐标系（这条线被调直）',
  parallel: '选中的另一条线',
  perpendicular: '选中的另一条线',
};

// 给定 kind 与选取的实体类型，返回可用的约束（用于右键菜单）
export function availableKinds(types) {
  const t = [...types].sort().join('+');
  const out = [];
  for (const [kind, def] of Object.entries(KINDS)) {
    const need = [...def.need].sort().join('+');
    if (need === t) out.push(kind);
  }
  return out;
}

const dir = (V, s) => [V(s, 'x2') - V(s, 'x1'), V(s, 'y2') - V(s, 'y1')];
const len = (V, s) => Math.hypot(...dir(V, s));

// 残差（希望全为 0）
export function residuals(kind, refs, V) {
  switch (kind) {
    case 'coincident': {
      const [a, b] = refs;
      return [V(a, 'x') - V(b, 'x'), V(a, 'y') - V(b, 'y')];
    }
    case 'midpoint': {
      const [p, s] = refs;
      return [
        V(p, 'x') - (V(s, 'x1') + V(s, 'x2')) / 2,
        V(p, 'y') - (V(s, 'y1') + V(s, 'y2')) / 2,
      ];
    }
    case 'horizontal': {
      const [s] = refs;
      return [V(s, 'y2') - V(s, 'y1')];
    }
    case 'vertical': {
      const [s] = refs;
      return [V(s, 'x2') - V(s, 'x1')];
    }
    case 'parallel': {
      const [s, t] = refs;
      const d1 = dir(V, s), d2 = dir(V, t);
      const n = (Math.hypot(...d1) || 1) * (Math.hypot(...d2) || 1);
      return [(d1[0] * d2[1] - d1[1] * d2[0]) / n];
    }
    case 'perpendicular': {
      const [s, t] = refs;
      const d1 = dir(V, s), d2 = dir(V, t);
      const n = (Math.hypot(...d1) || 1) * (Math.hypot(...d2) || 1);
      return [(d1[0] * d2[0] + d1[1] * d2[1]) / n];
    }
    case 'equallength': {
      const [s, t] = refs;
      return [len(V, s) - len(V, t)];
    }
    case 'tangent': {
      const [s, c] = refs;
      const dx = V(s, 'x2') - V(s, 'x1'), dy = V(s, 'y2') - V(s, 'y1');
      const L = Math.hypot(dx, dy) || 1;
      // 圆心到（无限延长）直线的距离
      const dist = Math.abs((V(c, 'cx') - V(s, 'x1')) * dy - (V(c, 'cy') - V(s, 'y1')) * dx) / L;
      return [dist - Math.abs(V(c, 'r'))];
    }
    default: return [];
  }
}

// 线性方程组：解 A x = b（高斯消元，带部分主元），A 为 n×n 数组的数组
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-18) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // 消元后每行只剩对角元：x_i = 右端 / 对角元（注意是 row[i]，不是 row[i][i]）
  return M.map((row, i) => row[n] / row[i]);
}

// 水平/竖直的直接解析处理（优先级最高）：
//   优先改"没被钉住、也没被绑定"的那一端；两端都不可动时改"非主导端"——
//   因为整体平移并不改变两端的坐标差，约束应当优先于拖动带来的冗余自由度。
function axisPass(st, list, pin) {
  let changed = false;
  for (const c of list) {
    if (c.kind !== 'horizontal' && c.kind !== 'vertical') continue;
    const s = st.entities.get(c.refs[0]);
    if (!s) continue;
    if (s.bound?.angle) continue;   // 被角度驱动的线：旋转优先，解析调平也不许把它拉回来
    const isH = c.kind === 'horizontal';
    const k1 = isH ? 'y1' : 'x1', k2 = isH ? 'y2' : 'x2';
    const pinned1 = pin.has(`${s.id}:${k1}`), pinned2 = pin.has(`${s.id}:${k2}`);
    const free1 = !pinned1 && !s.bound?.[k1];
    const free2 = !pinned2 && !s.bound?.[k2];
    // ★ 必须用**生效值**（valueOf 会先查 st.values）：被绑定驱动的端点，其真实位置在 st.values 里，
    //   s.params 仍是旧值。用原始值会让这一轮把「已经调平」的线又拽歪
    //   （实测：刚体修复刚把右端平移到位，这里读到陈旧的 y1=0 又把它写回 0 → 表现为「修了但没生效」）。
    const v1 = valueOf(st, s.id, k1), v2 = valueOf(st, s.id, k2);
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue;
    const r = v2 - v1;
    if (Math.abs(r) < 1e-12) continue;
    if (free1 && free2) { s.params[k1] = v1 + r / 2; s.params[k2] = v2 - r / 2; }
    else if (free1) { s.params[k1] = v2; }
    else if (free2) { s.params[k2] = v1; }
    else { const target = pinned2 ? k1 : k2; s.params[target] = pinned2 ? v2 : v1; }
    changed = true;
  }
  return changed;
}

// 求解全部约束。opts.pin = Set("entId:param")（正在被拖动的参数，视为常量）
// 分档求解：先用"小对象"（点/线上点）去满足约束；满足不了再动用大对象（线段/圆/多边形/曲线）。
// 这样"把点约束到线段中点"只会移动那个点，而不会把整条线段也拽走。
export function solveConstraints(st, opts = {}) {
  const list = st.constraints ? [...st.constraints.values()] : [];
  if (!list.length) return { ok: true, iterations: 0, maxResidual: 0 };
  const pin = opts.pin || new Set();
  const CHEAP = new Set(['point', 'edgepoint']);

  // ① 解析前置轮：水平/竖直先直接调平（最高优先级）
  if (axisPass(st, list, pin)) syncValues(st, list, pin);

  // 收集自由变量（被绑定 / 被钉住的参数不算）
  const all = [];
  const seen = new Set();
  for (const c of list) {
    for (const id of c.refs) {
      const ent = st.entities.get(id);
      if (!ent) continue;
      for (const p of paramsOf(ent)) {
        const full = `${ent.id}:${p.k}`;
        if (seen.has(full) || ent.bound?.[p.k] || pin.has(full)) continue;
        // ★ 被「角度」驱动的线（关联了角度实体）由旋转负责，约束求解不去动它
        //   —— 这就是"旋转优先级更高"：转的时候线上的点跟着走，约束不会把它拽回去/捏变形。
        if (ent.bound?.angle) continue;
        seen.add(full);
        all.push({ ent, key: p.k, full, cheap: CHEAP.has(ent.type) });
      }
    }
  }
  if (!all.length) {
    for (const c of list) c.error = maxAbs(residuals(c.kind, c.refs, (id, k) => valueOf(st, id, k)));
    return { ok: true, iterations: 0, maxResidual: Math.max(...list.map((c) => c.error || 0)) };
  }
  if (all.length > 40) return { ok: false, reason: 'too-many-vars' };

  const cheapVars = all.filter((v) => v.cheap);
  const stages = cheapVars.length ? [cheapVars, all] : [all];
  let last = null;
  for (const stage of stages) {
    last = runSolve(st, list, stage, opts);
    if (last.maxResidual < 1e-7) break; // 小对象就能满足 → 不动大对象
  }
  // ③ 收尾再走一遍解析轮：保证别的关系（如垂直）没把水平/竖直弄歪
  axisPass(st, list, pin);
  // 记录每条约束的残差
  const cur = (id, k) => valueOf(st, id, k);
  for (const c of list) c.error = maxAbs(residuals(c.kind, c.refs, cur));
  return last;
}

// 解析轮直接改了 ent.params，但 st.values 里可能还缓存着旧值 → 同步一下
function syncValues(st, list, pin) {
  if (!st.values) return;
  for (const c of list) {
    if (c.kind !== 'horizontal' && c.kind !== 'vertical') continue;
    const s = st.entities.get(c.refs[0]);
    if (!s) continue;
    for (const k of ['x1', 'y1', 'x2', 'y2']) {
      const full = `${s.id}:${k}`;
      // ★ 修复（既有 bug，实测定位）：这里原来把**被绑定**参数的「原始参数」写进生效值缓存，
      //   但被绑定参数的 params[k] 是陈旧无意义的（例如 x1 一直被绑定、params.x1 恒为 0），
      //   于是绑定算出来的正确值被当场抹成 0 —— 表现为「推上游明明把约束满足了，求解一跑又坏掉」。
      //   正确做法：无论是否被绑定，都让缓存失效，交给下一轮 evaluateAll 从绑定重新求值。
      st.values.delete(full);
    }
  }
}

function runSolve(st, list, vars, opts = {}) {
  const x0 = vars.map((v) => valueOf(st, v.ent.id, v.key));
  let x = [...x0];

  const evalR = (xArr) => {
    const trial = new Map(vars.map((v, i) => [v.full, xArr[i]]));
    const V = (id, k) => {
      const full = `${id}:${k}`;
      if (trial.has(full)) return trial.get(full);
      return valueOf(st, id, k);
    };
    const out = [];
    for (const c of list) out.push(...residuals(c.kind, c.refs, V));
    return out;
  };

  let r = evalR(x);
  let best = { x: [...x], norm: normInf(r) };
  const maxIter = opts.maxIter ?? 60;
  for (let it = 0; it < maxIter; it++) {
    const n = vars.length, m = r.length;
    if (normInf(r) < 1e-10) break;
    // 数值雅可比
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = Math.max(1e-7, Math.abs(x[j]) * 1e-7);
      const xp = [...x]; xp[j] += h;
      const rp = evalR(xp);
      J.push(rp.map((v, i) => (v - r[i]) / h));
    }
    // 加权：小对象（点/线上点）权重低＝更容易被移动；大对象（线段/圆/多边形/曲线）权重高＝更"稳"。
    // 否则满足"点在段中点上"这类约束时，解法会把线段也一起拖走，用户会觉得莫名其妙。
    const w = vars.map((v) => (v.ent.type === 'point' || v.ent.type === 'edgepoint' ? 1 : 4));
    const Jz = J.map((col, j) => col.map((v) => v / w[j]));
    // JᵀJ + λ·diag(JᵀJ)（Marquardt 缩放）, Jᵀr
    // 约束通常"欠定"（1 个残差、8 个自由参数）→ JᵀJ 秩亏，
    // 阻尼必须足够大，否则消元时的主元会小到被判为奇异 → 求解器原地不动。
      const buildNormal = (lam) => {
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const g = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        for (let b2 = a; b2 < n; b2++) {
          let s = 0;
          for (let i = 0; i < m; i++) s += Jz[a][i] * Jz[b2][i];
          A[a][b2] = s; A[b2][a] = s;
        }
        let s2 = 0;
        for (let i = 0; i < m; i++) s2 += Jz[a][i] * r[i];
        g[a] = s2;
        // 阻尼要足够小，否则会显著偏离"最小改动"解（把大对象也拖着走）；
        // 只要大于机器精度即可保证秩亏时不奇异。求解失败时下面会用更大的 λ 重试。
        A[a][a] += Math.max(1e-12, lam * A[a][a]);
      }
      return { A, g };
    };
    let dz = null;
    for (const lam of [opts.lambda ?? 1e-6, 1e-3, 1e-1]) {
      const { A, g } = buildNormal(lam);
      dz = solveLinear(A, g.map((v) => -v));
      if (dz) break;
    }
    if (!dz) break;
    let dx = dz.map((v, j) => v / w[j]);   // 回到真实变量空间
    if (opts.debug) {
      console.log(`  [solver] it=${it} norm=${normInf(r).toExponential(2)} w=[${w.join(',')}] dx=[${dx.map((v) => v.toFixed(3)).join(', ')}]`);
    }
    // 步长上限：避免个别变量因秩亏方向飞出（世界坐标尺度）
    const maxDx = Math.max(...dx.map(Math.abs));
    const cap = Math.max(1, 2 * Math.max(...x.map((v) => Math.abs(v))));
    if (maxDx > cap) {
      const s = cap / maxDx;
      dx = dx.map((v) => v * s);
    }
    // 阻尼线搜索
    let step = 1, improved = false, xn = x, rn = r;
    for (let k = 0; k < 8; k++) {
      xn = x.map((v, i) => v + dx[i] * step);
      rn = evalR(xn);
      if (normInf(rn) < normInf(r)) { improved = true; break; }
      step *= 0.5;
    }
    if (!improved) break;
    x = xn; r = rn;
    if (normInf(r) < best.norm) best = { x: [...x], norm: normInf(r) };
  }

  // 写回
  x = best.x;
  vars.forEach((v, i) => { v.ent.params[v.key] = x[i]; });
  // 逐条约束记录残差
  const trial = new Map(vars.map((v, i) => [v.full, x[i]]));
  const V = (id, k) => (trial.has(`${id}:${k}`) ? trial.get(`${id}:${k}`) : valueOf(st, id, k));
  for (const c of list) c.error = normInf(residuals(c.kind, c.refs, V));

  return { ok: best.norm < 1e-6, iterations: maxIter, maxResidual: best.norm };
}

function valueOf(st, entId, key) {
  const full = `${entId}:${key}`;
  if (st.values && st.values.has(full)) return st.values.get(full);
  const ent = st.entities.get(entId);
  return ent ? ent.params[key] : NaN;
}
const normInf = (arr) => arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function maxAbs(arr) { return normInf(arr); }
