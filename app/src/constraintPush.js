// 约束力沿绑定链向上游传播（用户要求，优先级最高）
//
// 用户场景（单位圆 → 正弦曲线）：
//   圆 C + 圆上点 P（edgepoint）+ 半径段 S1（两端分别绑到圆心与 P）
//   + 直径上的点 Q + 线段 S2（**两端都绑定**：x1/y1 ← P，x2/y2 ← Q）+ S2 约束「竖直」
//   期望：拖 P → S1 在圆内旋转；S2 保持竖直并被带着**左右平移**（Q 沿直径滑动）。
//
// 实测根因：S2 四个参数全被绑定 → 求解器在这条约束上**没有自由变量**（加约束时就是
//   iterations:0, maxResidual:2.94）→ 刚体修复遇到「两端同状态」也跳过 → 没有代码把力推出去。
//
// 机制（用户原话：只要收到一个方向的力，就带动自己和绑定了自己的所有东西一起平移，
// 逻辑可能来回嵌套，包括点，优先级最高）：
//   ① 沿绑定链判断约束两侧各自「可动」与否：递归找到最终驱动源 —— 终止于被钉住的参数
//      （用户正拖的那个）→ 不可动；终止于**真正的自由参数**（paramsOf 里列出的）→ 可动。
//   ② 让可动的一侧去对齐另一侧：本身自由就直接写；被绑定就把目标值反解到上游。
//   ③ 只碰实体**真正拥有**的自由参数。特别是：绝不通过 inverseSolve 去写派生量
//      （线上点的 x/y 不在 paramsOf 里；写了会破坏「点在圆上」这类宿主关系）——
//      这条是实测踩出来的，因此 inverseSolve 只在来源确实可动时才允许介入。
import { hardResidual } from './rigidRepair.js';
import { paramsOf, pointOnHost } from './entities.js';

const AXIS = {
  vertical: { k1: 'x1', k2: 'x2' },     // 竖直：要求 x2 == x1
  horizontal: { k1: 'y1', k2: 'y2' },   // 水平：要求 y2 == y1
};

const POS_KEYS = ['x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2'];
const isXKey = (k) => k === 'x' || k === 'cx' || k === 'x1' || k === 'x2';

const eff = (st, id, k) => {
  const v = st.values && st.values.get(id + ':' + k);
  if (Number.isFinite(v)) return v;
  const e = st.entities.get(id);
  return e && Number.isFinite(e.params[k]) ? e.params[k] : NaN;
};

/** 该参数是否是「真正的自由参数」（paramsOf 列出、没被绑定、没被钉住） */
function isFreeParam(st, ent, k, pin) {
  if (ent.bound && ent.bound[k]) return false;
  if (pin.has(ent.id + ':' + k)) return false;
  return paramsOf(ent).some((p) => p.k === k);
}

/** 沿绑定链判断 (id,k) 是否可动（谁最终驱动它） */
function canMove(st, id, k, pin, depth = 0, seen = new Set()) {
  if (depth > 8) return false;
  const tag = id + ':' + k;
  if (seen.has(tag)) return false;
  seen.add(tag);
  const ent = st.entities.get(id);
  if (!ent) return false;
  const bId = ent.bound && ent.bound[k];
  if (!bId) {
    if (isFreeParam(st, ent, k, pin)) return true;
    // ★ 线上点：它的 x/y 是**派生量**（不在 paramsOf 里），但宿主参数 t 若是自由的，
    //   就仍有可能被驱动到目标位置（靠 solveEdgePointT 反解）。
    //   这里保守地判为「可动」：若某个轴上其实无解，solveEdgePointT 会返回 null，自然回退到其它侧。
    if (ent.host && !pin.has(ent.id + ':t') && paramsOf(ent).some((q) => q.k === 't')) return true;
    return false;
  }
  const b = st.bindings && st.bindings.get(bId);
  if (!b) return false;
  for (const src of b.sources || []) {
    const entId = typeof src === 'string' ? null : (src && src.ent);
    if (!entId) continue;
    const ent2 = st.entities.get(entId);
    if (!ent2) continue;
    const only = typeof src === 'string' ? null : (src && src.param);
    const keys = only ? [only] : paramsOf(ent2).map((p) => p.k);
    for (const k2 of keys) if (canMove(st, ent2.id, k2, pin, depth + 1, seen)) return true;
  }
  return false;
}

/** 绑定来源里是否有「与约束同轴且真正可动」的自由参数 */
function sourcesMovable(st, b, key, pin) {
  const wantX = (key === 'x1' || key === 'x2');
  for (const src of b.sources || []) {
    const entId = typeof src === 'string' ? null : (src && src.ent);
    if (!entId) continue;
    const ent2 = st.entities.get(entId);
    if (!ent2) continue;
    const only = typeof src === 'string' ? null : (src && src.param);
    for (const pp of paramsOf(ent2)) {
      if (only && pp.k !== only) continue;
      if (!POS_KEYS.includes(pp.k)) continue;
      if (isXKey(pp.k) !== wantX) continue;
      if (isFreeParam(st, ent2, pp.k, pin)) return true;
    }
  }
  return false;
}

/**
 * 线上点（edgepoint）：它的 x/y 是**派生量**，paramsOf 里只有 t → 想让它左右/上下移动，
 * 必须**按宿主参数 t 反解**（用户要求：线上点和圆上点等都要支持）。
 * 做法通用：沿宿主采样 + 二分求根，取**离当前 t 最近**的根（保证连续，
 * 与本轮角度展开的约定一致 —— 圆上会有两个根，选近的那个才不会跳）。
 * @returns 新的 t，或 null（无解/被钉住）
 */
function solveEdgePointT(st, ent, key, want, pin) {
  if (pin.has(ent.id + ':t')) return null;
  const host = st.entities.get(ent.host);
  const env = st.env;
  if (!host || !env) return null;
  if (!paramsOf(ent).some((q) => q.k === 't')) return null;
  const wantX = (key === 'x1' || key === 'x2' || key === 'x');
  const axis = wantX ? 0 : 1;
  const cur = eff(st, ent.id, 't');
  if (!Number.isFinite(cur)) return null;
  const at = (tt) => {
    try { const q = pointOnHost(host, env, tt); return Number.isFinite(q[axis]) ? q[axis] - want : NaN; }
    catch { return NaN; }
  };
  // 无界型宿主（圆/函数）在当前位置两侧各取半圈；有界型（线段/圆弧/多边形/自由曲线）覆盖整个定义域
  const unbounded = host.type === 'circle' || host.type === 'sine' || host.type === 'parabola' || host.type === 'func';
  const span = host.type === 'polygon' ? Math.max(1, host.count || 1) : 1;
  const lo = unbounded ? cur - Math.PI : -span;
  const hi = unbounded ? cur + Math.PI : span * 2;
  const N = 120;
  let best = null, bestDist = Infinity;
  let prevT = lo, prevV = at(lo);
  for (let i = 1; i <= N; i++) {
    const tt = lo + ((hi - lo) * i) / N;
    const v = at(tt);
    if (Number.isFinite(prevV) && Number.isFinite(v) && (prevV === 0 || prevV * v <= 0)) {
      let a = prevT, b = tt, fa = prevV;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2, fm = at(m);
        if (!Number.isFinite(fm)) break;
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const root = (a + b) / 2;
      const d = Math.abs(root - cur);
      if (d < bestDist) { bestDist = d; best = root; }
    }
    prevT = tt; prevV = v;
  }
  return best;
}

/** 把「E.k 应等于 value」推给上游；返回是否真的改了东西 */
function forceParam(st, id, key, value, opts, depth) {
  const { inverseSolve, pin = new Set(), maxDepth = 6 } = opts;
  if (depth > maxDepth) return false;
  const ent = st.entities.get(id);
  if (!ent) return false;
  const cur = eff(st, id, key);
  if (Number.isFinite(cur) && Math.abs(cur - value) < 1e-12) return false;

  const bId = ent.bound && ent.bound[key];
  if (!bId) {
    if (!isFreeParam(st, ent, key, pin)) return false;   // 派生量 / 被钉住 → 不动它
    ent.params[key] = value;
    return true;
  }
  const b = st.bindings && st.bindings.get(bId);
  if (!b) return false;

  // ① 首选：把目标值反解到上游（仅在来源确实可动时才允许 —— 否则会去写派生量）
  if (sourcesMovable(st, b, key, pin)) {
    const r = typeof inverseSolve === 'function' ? inverseSolve(st, b, value) : null;
    if (r && r.ok) return true;
  }

  // ② 退路：沿来源手动推同一位移（只动来源真正的自由参数，且只动约束关心的那根轴）
  const delta = value - cur;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return false;
  const wantX = (key === 'x1' || key === 'x2');
  for (const src of b.sources || []) {
    const entId = typeof src === 'string' ? null : (src && src.ent);
    if (!entId) continue;
    const ent2 = st.entities.get(entId);
    if (!ent2) continue;
    const only = typeof src === 'string' ? null : (src && src.param);
    for (const pp of paramsOf(ent2)) {
      if (only && pp.k !== only) continue;
      if (!POS_KEYS.includes(pp.k)) continue;
      if (isXKey(pp.k) !== wantX) continue;
      if (isFreeParam(st, ent2, pp.k, pin)) {
        ent2.params[pp.k] = eff(st, ent2.id, pp.k) + delta;
        return true;
      }
    }
    // ★ 来源是「线上点」→ 按宿主参数 t 反解（它的 x/y 是派生量，没有自由 x/y 可写）
    if (ent2.host) {
      const nt = solveEdgePointT(st, ent2, key, value, pin);
      if (nt != null && Math.abs(nt - eff(st, ent2.id, 't')) > 1e-12) {
        ent2.params.t = nt;
        return true;
      }
    }
    // 来源自己也被绑定 → 递归再往上游推一层（嵌套）
    for (const pp of paramsOf(ent2)) {
      if (only && pp.k !== only) continue;
      if (!POS_KEYS.includes(pp.k)) continue;
      if (isXKey(pp.k) !== wantX) continue;
      if (forceParam(st, ent2.id, pp.k, eff(st, ent2.id, pp.k) + delta, opts, depth + 1)) return true;
    }
  }
  return false;
}

/** 一轮「把约束要求推给上游」。返回实际推动次数（0 = 无进展） */
export function pushThroughBindings(st, opts = {}) {
  // ★ 防重入：inverseSolve 内部可能触发再次求值 → 又会走到这里，形成无限互递归
  //   （实测「Maximum call stack size exceeded」就是这么来的）。
  if (st._pushingConstraints) return 0;
  st._pushingConstraints = true;
  try { return pushInner(st, opts); } finally { st._pushingConstraints = false; }
}

const dirOf = (st, id) => {
  const e = st.entities.get(id);
  if (!e || !('x1' in e.params)) return null;
  const dx = eff(st, id, 'x2') - eff(st, id, 'x1');
  const dy = eff(st, id, 'y2') - eff(st, id, 'y1');
  const L = Math.hypot(dx, dy);
  return L < 1e-9 ? null : { ux: dx / L, uy: dy / L, L };
};

/**
 * 两线平行/垂直的推上游：让其中一条线旋转到与另一条线平行（或垂直）。
 * 做法：保留锚点端不动，把另一端推到 锚点 + 方向×长度（长度不变 = 刚体旋转），
 * 再把这两个目标值分别推给它们的绑定来源。两侧都试，谁推得动就用谁。
 * @returns 是否真的推了
 */
function pushTwoLine(st, c, opts) {
  const [aId, bId] = c.refs;
  const target = (refId) => {
    const d = dirOf(st, refId);
    if (!d) return null;
    let ux = d.ux, uy = d.uy;
    if (c.kind === 'perpendicular') { const t2 = -uy; uy = ux; ux = t2; }   // 旋转 90°
    return { ux, uy };
  };
  // 两种尝试：旋转 b（参照 a）或旋转 a（参照 b）；每种再分"锚在 1 端"与"锚在 2 端"
  for (const [rotId, refId] of [[bId, aId], [aId, bId]]) {
    const u = target(refId);
    const d = dirOf(st, rotId);
    if (!u || !d) continue;
    for (const anchorEnd of [1, 2]) {
      const ax0 = eff(st, rotId, 'x' + anchorEnd), ay0 = eff(st, rotId, 'y' + anchorEnd);
      if (!Number.isFinite(ax0) || !Number.isFinite(ay0)) continue;
      const wx = ax0 + u.ux * d.L * (anchorEnd === 1 ? 1 : -1);
      const wy = ay0 + u.uy * d.L * (anchorEnd === 1 ? 1 : -1);
      const other = anchorEnd === 1 ? 2 : 1;
      const m1 = forceParam(st, rotId, 'x' + other, wx, opts, 0);
      const m2 = forceParam(st, rotId, 'y' + other, wy, opts, 0);
      if (m1 || m2) return true;
    }
  }
  return false;
}

function pushInner(st, opts = {}) {
  let moved = 0;
  if (!st.constraints || !st.constraints.size) return 0;
  const pin = opts.pin || new Set();
  for (const c of st.constraints.values()) {
    const ax = AXIS[c.kind];
    if (!ax) {
      // ★ 两条线之间的平行/垂直（用户要求第 2 项）：两条线都被绑定时同样要靠推上游满足。
      //   把"旋转"翻译成两个**具体的赋值**：保留一条线的锚点与长度，让另一端落到
      //   锚点 + 单位方向×长度 —— 于是可以复用 forceParam 把值推到各自的绑定来源。
      if (c.kind === 'parallel' || c.kind === 'perpendicular') {
        if (hardResidual(c.kind, c.refs, st) > 1e-9 && pushTwoLine(st, c, opts)) { moved++; break; }
      }
      continue;
    }
    if (c.refs.length !== 1) continue;
    const id = c.refs[0];
    const ent = st.entities.get(id);
    if (!ent || !('x1' in ent.params)) continue;
    if (hardResidual(c.kind, c.refs, st) <= 1e-9) continue;   // 已满足
    // ★ 与求解器同一条「旋转优先」原则：被角度驱动的线（关联了角度实体）由旋转负责，
    //   约束求解本来就不许把它拽回来（见 constraints.js 的 axisPass/solveConstraints 里
    //   同款判断）。推上游也必须守这条，否则会把旋转结果覆盖掉 ——
    //   实测踩过：加入推上游后，「角度驱动时线上的点跟着线走」这条现有检查立刻变红。
    if (ent.bound && ent.bound.angle) continue;

    const v1 = eff(st, id, ax.k1), v2 = eff(st, id, ax.k2);
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue;

    // ★ 让「可动」的那一侧去对齐另一侧：拖 P 时 P 的链被钉住 → 于是改 Q（正是用户要的）
    const m1 = canMove(st, id, ax.k1, pin);
    const m2 = canMove(st, id, ax.k2, pin);
    if (!m1 && !m2) continue;                                  // 两侧都不可动 → 交给求解器
    const tries = (m2 && !m1) ? [[ax.k2, v1], [ax.k1, v2]] : [[ax.k1, v2], [ax.k2, v1]];
    for (const [k, v] of tries) {
      if (forceParam(st, id, k, v, opts, 0)) { moved++; break; }
    }
  }
  return moved;
}
