// 保约束拖拽（用户要求：平行/垂直是**最高优先级**，拖动时严格保持）
//
// 背景（根因）：constraints.js 的 solveConstraints 把"正在被拖的参数"硬性钉住（pin），
// 只让**其它自由参数**去满足约束。于是当该结构没有自由参数时（两端都被绑定/被钉住），
// 求解器只能记录残差、约束被拖坏 —— 这就是"平行/垂直仍然可以被拽动"。
//
// 本模块的思路（用户给的方向）：拖动时不要硬钉被拖点，而是**选一个天生保约束的运动**：
//   ① 先尝试**整体平移**：把被拖实体按指针位移平移 —— 方向不变 → 平行/垂直自动成立，
//      且被拖的那个点仍能精确跟随指针（平移把两端一起移动）。
//   ② 若平移会破坏「被驱动」（该实体还有参数被绑定/被钉住，平移会与它们冲突）→
//      改为**连带联动对方**：把约束对方旋转到与"拖动后的方向"一致（绕自身中点旋转，位置尽量不动）。
//   ③ 都不行则原样返回（交给求解器尽力而为），并如实报告 mode，便于 UI/日志说明。
//
// 纯几何模块：不碰 DOM、不依赖相机，可直接单测。

const POS_KEYS = ['x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2'];

const dirOf = (p) => {
  const dx = (p.x2 ?? 0) - (p.x1 ?? 0);
  const dy = (p.y2 ?? 0) - (p.y1 ?? 0);
  return [dx, dy];
};
const norm = (v) => Math.hypot(v[0], v[1]);

/** 把补丁应用到一个 params 副本上，得到"拖动后"的参数（便于比较方向） */
function merged(params, patch) {
  return { ...params, ...patch };
}

/**
 * 计算保约束的拖动补丁。
 *
 * @param {object} o
 *   o.ent        被拖实体（需要有 params；线段用 x1/y1/x2/y2）
 *   o.patch      天真补丁（实体自己的 drag 函数算出来的）
 *   o.delta      { dx, dy } 本次指针位移（世界坐标）
 *   o.isLocked   (entId, key) => boolean，参数是否被绑定/被钉住（平移时不能动它们）
 *   o.partners   [{ id, ent, kind }] 与被拖实体存在 平行/垂直 关系的对方（kind: 'parallel' | 'perpendicular'）
 * @returns {{ patch: object, partnerPatches: Array<{id:string, patch:object}>, mode: string, note: string }}
 */
export function preservingDragPatch({ ent, patch, delta, isLocked = () => false, partners = [] }) {
  const out = { patch: { ...patch }, partnerPatches: [], mode: 'naive', note: '' };
  if (!ent || !patch || !partners.length) return out;

  const before = dirOf(ent.params);
  const after = dirOf(merged(ent.params, patch));
  const lb = norm(before), la = norm(after);
  if (lb < 1e-9 || la < 1e-9) return out;                     // 退化线段：不动它
  // 方向是否变了？（用归一化叉积判断，避免长度差异干扰）
  const cross = (before[0] * after[1] - before[1] * after[0]) / (lb * la);
  const dot = (before[0] * after[0] + before[1] * after[1]) / (lb * la);
  const dirChanged = Math.abs(cross) > 1e-9;
  if (!dirChanged) { out.note = '方向未变，约束本来就成立'; return out; }

  // ① 整体平移：把该实体的**所有位置参数**一起按 delta 平移（方向不变 → 约束保持）
  //    前提：除被本次拖动改动的参数外，其它位置参数没有被绑定/钉住（否则会与"被驱动"冲突）。
  const touched = new Set(Object.keys(patch));
  const blockers = POS_KEYS.filter((k) => k in ent.params && !touched.has(k) && isLocked(ent.id, k));
  if (!blockers.length) {
    const shifted = {};
    let any = false;
    for (const k of POS_KEYS) {
      if (!(k in ent.params)) continue;
      const isX = k === 'x' || k === 'cx' || k === 'x1' || k === 'x2';
      shifted[k] = ent.params[k] + (isX ? (delta.dx || 0) : (delta.dy || 0));
      any = true;
    }
    if (any) {
      out.patch = shifted;
      out.mode = 'translate';
      out.note = '整体平移：方向不变，平行/垂直自动保持，被拖点仍精确跟随指针';
      return out;
    }
  }

  // ② 连带联动对方：保留天真补丁（被拖点跟随指针），把对方旋转到与新方向一致
  const target = after;
  for (const p of partners) {
    const pe = p.ent;
    if (!pe || !('x1' in pe.params)) continue;
    const pd = dirOf(pe.params);
    const lp = norm(pd);
    if (lp < 1e-9) continue;
    // 目标方向：平行 → 与 target 同向；垂直 → target 旋转 90°
    let tx = target[0], ty = target[1];
    if (p.kind === 'perpendicular') { const t2 = [-ty, tx]; tx = t2[0]; ty = t2[1]; }
    const lt = norm([tx, ty]);
    if (lt < 1e-9) continue;
    // 保留对方长度，绕自身中点旋转
    const mx = (pe.params.x1 + pe.params.x2) / 2, my = (pe.params.y1 + pe.params.y2) / 2;
    const ux = (tx / lt) * lp / 2, uy = (ty / lt) * lp / 2;
    const np = { x1: mx - ux, y1: my - uy, x2: mx + ux, y2: my + uy };
    // 对方的参数若被绑定/钉住 → 不动它（避免与"被驱动"硬冲突），如实记录
    const locked = ['x1', 'y1', 'x2', 'y2'].some((k) => isLocked(pe.id, k));
    if (locked) { out.note = '对方被绑定/钉住，无法联动（交给求解器尽力）'; continue; }
    out.partnerPatches.push({ id: pe.id, patch: np });
    out.mode = 'cascade';
    out.note = '连带联动：对方旋转到与新方向一致（绕自身中点，长度不变）';
  }
  if (!out.partnerPatches.length && out.mode === 'naive') out.note = out.note || '无法平移也无法联动';
  return out;
}

/** 找出与某实体存在 平行/垂直 关系的对方（供 tools.js 组装 partners） */
export function parallelPartners(st, entId) {
  const out = [];
  if (!st || !st.constraints) return out;
  for (const c of st.constraints.values()) {
    if (c.kind !== 'parallel' && c.kind !== 'perpendicular') continue;
    if (!Array.isArray(c.refs) || c.refs.length !== 2) continue;
    const [a, b] = c.refs;
    const otherId = a === entId ? b : (b === entId ? a : null);
    if (!otherId) continue;
    const other = st.entities.get(otherId);
    if (other) out.push({ id: otherId, ent: other, kind: c.kind });
  }
  return out;
}
