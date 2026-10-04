// 「曾经」类判据的小工具（用户选定的"轻量历史"方案）
//
// 背景（用户报告）：新用户一上来会解锁大量成就，某个操作同时解锁多个。
// 例如「整数半径」在画一个 r=2 的圆时就成立 —— 但那只是**默认值**，不是用户刻意做的。
// 这类"参数值"成就应该要求：**用户确实动过那个参数**。
//
// 历史由 runtime.step 维护（st.history，见 runtime.js），通过 sg.history 暴露给模式：
//   sg.history.touched : Map<实体 id, Set<参数名>> —— 创建之后被改动过的参数
//
// ★ 关于"没有历史时放行"：单测经常直接拿语义图喂给 matchAll（不经过 runtime），
//   那种情况下 sg.history 不存在。这里选择**放行**（返回 true），
//   因为真实应用里 runtime.step 一定先设好 sg.history 再调 matchAll ——
//   也就是说：**规则在生产环境始终生效**，只是不给离线单测添麻烦。
//   需要验证"严格性"的地方（如 check-achievement-burst）会显式传入 history。
export function touchedParam(sg, entId, key) {
  const h = sg && sg.history;
  if (!h || !h.touched) return true;            // 无历史 → 放行（见文件头说明）
  const set = h.touched.get(entId);
  if (!set) return false;
  return key ? set.has(key) : set.size > 0;
}

/** 这个实体有没有被"刻意调过"（任意参数） */
export function everTouched(sg, entId) {
  return touchedParam(sg, entId, null);
}

/**
 * 用户是不是**亲手动过**这个实体（拖动/输入参数，state.setParams 的 gesture=true）。
 * 与 touchedParam 的区别：touchedParam 只看"参数变过"，**求解器自动算出来的变化也算**；
 * 而这里只认人的动作。
 * 用途（用户报告"一个操作同时解锁多个"）：加上约束后求解器会把残差压到 0，
 * 于是「严丝合缝」「真的水平了」「正好一半」这些"精确度"成就会跟着一起成立。
 * 要求"用户先亲手动过被约束的对象"，它们才是挣来的，而不是约束替他挣的。
 * 无历史时同样放行（见文件头说明）。
 */
export function userMoved(sg, entId) {
  const h = sg && sg.history;
  if (!h || !h.userTouched) return true;        // 无历史 → 放行
  return h.userTouched.has(entId);
}

/** 用户是否亲手动过这条约束引用的**任意一个**实体 */
export function userMovedAnyRef(sg, entId) {
  // ★ 约束的引用列表在**语义图的 features** 上（semantic.js: cf = { type:'constraint', kind, error, refs }），
  //   不在实体对象上。第一版读 entity.refs 读不到 → 直接走了"放行"分支 → 判据等于没加（实测复测无变化）。
  const f = sg && sg.features ? sg.features.get(entId) : null;
  const ent = sg && sg.byId ? sg.byId.get(entId) : null;
  const refs = (f && f.refs) || (ent && (ent.refs || (ent.params && ent.params.refs))) || [];
  if (!refs.length) return true;                // 真的取不到引用（例如离线单测的骨架图）→ 放行
  return refs.some((r) => userMoved(sg, r));
}
