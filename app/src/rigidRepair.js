// 硬约束的「刚体修复 + 力传播」（用户要求的物理类比）
//
// 用户给的模型：一条被魔法固定成水平的铁棍 ——
//   · 它**不会变形**：谁推它，它就**整体平移**；
//   · 粘在它上面的东西（例如一个圆）**跟着一起动**，且**全程保持粘着**；
//   · 于是"力"沿绑定链传递：拖 A → 传到铁棍 → 铁棍整体平移 → 传到粘在铁棍上的圆。
//
// 现状缺口（用户报告"仍然会被拽歪"）：绑定会把**一个端点**拉到新位置，而另一个端点留在原地
//   → 线被拉斜，硬约束（水平/竖直/平行/垂直）被破坏；求解器又动不了被绑定的参数，只能放弃。
//
// 本模块的机制：
//   ① 在 evaluateAll（施加绑定）**之前**快照参与硬约束的实体的参数；
//   ② 施加绑定后，若某条硬约束被破坏：找出"被驱动的一端"（参数被绑定或被拖动钉住）的位移，
//      把**自由端**也平移同样的位移 —— 相对几何因此恢复原样，约束自动成立，且被驱动端仍在它该在的位置；
//   ③ 只动**自由参数**（被绑定的不动，避免与"被驱动"打架）；两端都被驱动时无法平移 → 交给求解器尽力。
//   ④ 调用方在修复后**再 evaluateAll 一次** → 粘在它上面的实体自动跟随（绑定关系全程保持）。
//
// 纯模块：不碰 DOM，可直接单测。

const HARD = new Set(['horizontal', 'vertical', 'parallel', 'perpendicular']);

// 生效值：被绑定驱动的参数，其当前值在 st.values（键 id:key）里，ent.params 存的是原始值。
// ★ 这一条是踩过坑的：第一版直接读 ent.params，于是被驱动端看起来位移为 0 → 修复从不触发。
const eff = (st, id, k) => {
  const v = st.values && st.values.get(id + ':' + k);
  if (Number.isFinite(v)) return v;
  const e = st.entities.get(id);
  return e && Number.isFinite(e.params[k]) ? e.params[k] : 0;
};
const SEG_ENDS = [['x1', 'y1'], ['x2', 'y2']];

/** 快照：所有参与硬约束的实体的参数（在 evaluateAll 之前调用） */
/** 把当前（满足约束的）形状记为基线；在每次求值收尾时调用。 */
export function refreshRigidBase(st) {
  if (!st || !st.constraints) return;
  if (!st.rigidBase) st.rigidBase = new Map();
  for (const c of st.constraints.values()) {
    if (!HARD.has(c.kind)) continue;
    if (hardResidual(c.kind, c.refs, st) > 1e-9) continue;   // 还没满足 → 不改基线
    for (const id of c.refs) {
      const e = st.entities.get(id);
      if (!e || !('x1' in e.params)) continue;
      st.rigidBase.set(id, { x1: eff(st, id, 'x1'), y1: eff(st, id, 'y1'), x2: eff(st, id, 'x2'), y2: eff(st, id, 'y2') });
    }
  }
}

export function snapshotHard(st) {
  const out = new Map();
  if (!st || !st.constraints) return out;
  for (const c of st.constraints.values()) {
    if (!HARD.has(c.kind)) continue;
    for (const id of c.refs) {
      const e = st.entities.get(id);
      if (e && !out.has(id)) {
        const snap = {};
        for (const k of ['x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2']) if (k in e.params) snap[k] = eff(st, id, k);
        out.set(id, snap);
      }
    }
  }
  return out;
}

/** 与 constraints.js 同式的残差（此处最小实现，避免循环依赖）。
 *  ★ 必须用**生效值**：被绑定驱动的端点，其真实位置在 st.values 里，
 *    ent.params 仍是旧值 —— 第一版读了 params，于是歪掉的线算出残差 0、修复从不触发。 */
export function hardResidual(kind, refs, st) {
  const P = (id) => ({ x1: eff(st, id, 'x1'), y1: eff(st, id, 'y1'), x2: eff(st, id, 'x2'), y2: eff(st, id, 'y2') });
  if (kind === 'horizontal') { const s = P(refs[0]); return Math.abs(s.y2 - s.y1); }
  if (kind === 'vertical') { const s = P(refs[0]); return Math.abs(s.x2 - s.x1); }
  const a = P(refs[0]), b = P(refs[1]);
  const d1 = [a.x2 - a.x1, a.y2 - a.y1];
  const d2 = [b.x2 - b.x1, b.y2 - b.y1];
  const n = (Math.hypot(d1[0], d1[1]) || 1) * (Math.hypot(d2[0], d2[1]) || 1);
  if (kind === 'parallel') return Math.abs((d1[0] * d2[1] - d1[1] * d2[0]) / n);
  if (kind === 'perpendicular') return Math.abs((d1[0] * d2[0] + d1[1] * d2[1]) / n);
  return 0;
}

/**
 * 修复被拽歪的硬约束：把被约束的线**整体平移**（位移 = 被驱动端的位移）。
 * @returns {{ repaired: number, notes: string[] }}
 */
export function repairHardConstraints(st, snap, opts = {}) {
  // snap 现在传入的是**基线**（st.rigidBase：上一次满足约束时的形状），语义见下方注释。
  const pin = opts.pin || new Set();
  const tol = opts.tol ?? 1e-9;   // 保留：供 future 判断使用（当前判据是「相对基线是否漂移」）
  const maxPass = opts.maxPass ?? 4;
  const notes = [];
  let repaired = 0;
  if (!st || !st.constraints || !st.constraints.size || !snap || !snap.size) return { repaired, notes };

  const locked = (id, k) => {
    const e = st.entities.get(id);
    return !!(e && e.bound && e.bound[k]) || pin.has(id + ':' + k);
  };

  for (let pass = 0; pass < maxPass; pass++) {
    let did = 0;
    for (const c of st.constraints.values()) {
      if (!HARD.has(c.kind)) continue;
      // 不再用方向残差当门槛（水平只查 y 之差，沿 x 拉长时残差为 0 但形状已被破坏）。
      // 真正的判据在下面：被驱动端相对**基线**是否移动了。
      // 水平/竖直只约束一条线；平行/垂直两条都试（优先"被驱动"的那条）
      const cands = (c.kind === 'horizontal' || c.kind === 'vertical') ? [c.refs[0]] : [...c.refs];
      for (const id of cands) {
        const e = st.entities.get(id);
        const s0 = snap.get(id);
        if (!e || !s0 || !('x1' in e.params)) continue;
        // 找出被驱动的一端与自由的一端
        let drivenEnd = -1, freeEnd = -1;
        for (let i = 0; i < 2; i++) {
          const [kx, ky] = SEG_ENDS[i];
          if (!(kx in e.params)) continue;
          if (locked(id, kx) || locked(id, ky)) drivenEnd = i; else freeEnd = i;
        }
        if (drivenEnd < 0 || freeEnd < 0 || drivenEnd === freeEnd) continue;   // 两端同状态 → 平移无从下手
        const [dxk, dyk] = SEG_ENDS[drivenEnd];
        const [fx, fy] = SEG_ENDS[freeEnd];
        const dx = eff(st, id, dxk) - (s0[dxk] ?? 0);
        const dy = eff(st, id, dyk) - (s0[dyk] ?? 0);
        if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) continue;            // 被驱动端没动 → 不是它引起的
        if (locked(id, fx) || locked(id, fy)) continue;                        // 自由端其实也被驱动 → 平移会打架
        // ★ 整体平移：自由端**按基线绝对定位** —— 基线自由端 + 被驱动端的位移。
        //   （不用「当前值 + 位移」：那样反复执行会累加漂移；绝对定位是幂等的。）
        //   自由端没被绑定 → 生效值就是原始值，写回 params 即可。
        const nfx = (s0[fx] ?? 0) + dx, nfy = (s0[fy] ?? 0) + dy;
        const movedFree = Math.abs(e.params[fx] - nfx) > 1e-12 || Math.abs(e.params[fy] - nfy) > 1e-12;
        e.params[fx] = nfx;
        e.params[fy] = nfy;
        if (!movedFree) continue;    // 幂等：值没变就不记账（否则多轮循环会重复报同一件事）
        repaired++; did++;
        notes.push(`${e.label || id}：整体平移 (${dx.toFixed(2)}, ${dy.toFixed(2)}) 以保持「${c.kind}」`);
        break;
      }
    }
    if (!did) break;
  }
  return { repaired, notes };
}
