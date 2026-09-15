// S2 · 成就匹配引擎（纯函数，无 DOM、无渲染状态）
//
// 一条成就＝一条**数据**（模式）：在语义图上做子图匹配，再用数值谓词判定。
// 引擎只回答"这一刻是否成立"；"稳定 ≥500ms 才算触发"由上层 tracker 负责。
//
// 模式形状：
//   {
//     id, title, flavor,
//     cls: 'solo' | 'weave',          // A 类独石 / B 类交织（B 类必须 requires ≥2 条成就）
//     requires: [],                    // 前置成就 id
//     nodes: [{ type, as, where?(f, sg) }],
//     edges: [{ kind, from:'as', to:'as', where?(edge) }],
//     evidence(binds, sg) → { text, values }   // 成就卡上要展示的"凭什么判定"
//   }

// ---------- 数值谓词小工具（模式库共用，避免各写一套判据）----------
export const near = (a, b, relTol = 0.01, absTol = 1e-9) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= Math.max(absTol, Math.abs(b) * relTol);
export const angleNear = (deg, target, tol = 0.5) => Number.isFinite(deg) && Math.abs(deg - target) <= tol;
export const ratioNear = (a, b, r, relTol = 0.01) => Number.isFinite(a) && Number.isFinite(b)
  && b !== 0 && Math.abs(a / b - r) <= Math.max(1e-9, r * relTol);
export const FN_TYPES = new Set(['func', 'sine', 'parabola', 'sinepiece']);

// ---------- 子图匹配 ----------
// 返回 { as: nodeId } 或 null。同一 as 在 nodes 里出现多次时必须是同一个节点。
export function matchPattern(sg, p) {
  const cand = p.nodes.map((n) => sg.nodes.filter((nd) => (n.type === '*' || nd.type === n.type)
    && (!n.where || n.where(nd.features, sg, nd))));
  if (cand.some((c) => c.length === 0)) return null;
  const binds = Object.create(null);
  const used = new Set();
  const edgesOk = () => (p.edges || []).every((e) => sg.edges.some((g) => g.kind === e.kind
    && ((g.from === binds[e.from] && g.to === binds[e.to]) || (g.to === binds[e.from] && g.from === binds[e.to]))
    && (!e.where || e.where(g, sg))));
  const fullOk = () => edgesOk() && (!p.where || p.where(sg, binds));
  const rec = (i) => {
    if (i === p.nodes.length) return fullOk();
    const spec = p.nodes[i];
    for (const nd of cand[i]) {
      if (binds[spec.as] !== undefined && binds[spec.as] !== nd.id) continue;   // 同一 as → 同一节点
      if (binds[spec.as] === nd.id) { if (rec(i + 1)) return true; continue; }
      if (used.has(nd.id)) continue;
      binds[spec.as] = nd.id; used.add(nd.id);
      if (rec(i + 1)) return true;
      used.delete(nd.id); delete binds[spec.as];
    }
    return false;
  };
  return rec(0) ? { ...binds } : null;
}

// ---------- 批量匹配 ----------
// 只返回"此刻成立"的模式；前置门控（B 类）由 tracker 依据 requires 处理。
export function matchAll(sg, patterns) {
  const out = [];
  for (const p of patterns) {
    let binds = null;
    try { binds = matchPattern(sg, p); } catch { binds = null; }
    if (!binds) continue;
    let ev = null;
    try { ev = p.evidence ? p.evidence(binds, sg) : null; } catch { ev = null; }
    out.push({ id: p.id, title: p.title, flavor: p.flavor, cls: p.cls, requires: p.requires || [], binds, evidence: ev });
  }
  return out;
}

// ---------- 模式库自检（写进单测，防止数据写错）----------
export function validatePatterns(patterns) {
  const errs = [];
  const ids = new Set();
  for (const p of patterns) {
    if (!p.id || typeof p.id !== 'string') errs.push(`缺少 id：${JSON.stringify(p).slice(0, 60)}`);
    else if (ids.has(p.id)) errs.push(`id 重复：${p.id}`);
    ids.add(p.id);
    if (!p.title || !p.flavor) errs.push(`${p.id}：缺少 title/flavor`);
    if (p.cls !== 'solo' && p.cls !== 'weave') errs.push(`${p.id}：cls 必须是 solo 或 weave`);
    const req = p.requires || [];
    if (p.cls === 'solo' && req.length !== 0) errs.push(`${p.id}：A 类独石成就的 requires 必须为空`);
    if (p.cls === 'weave' && req.length < 2) errs.push(`${p.id}：B 类交织成就必须 requires ≥2 条成就`);
    if (!Array.isArray(p.nodes) || p.nodes.length === 0) errs.push(`${p.id}：nodes 不能为空`);
    const asNames = new Set(p.nodes.map((n) => n.as));
    for (const e of p.edges || []) {
      if (!asNames.has(e.from) || !asNames.has(e.to)) errs.push(`${p.id}：边引用了未声明的 as（${e.from}→${e.to}）`);
      // 禁止用"自环边"占位：同一节点之间不存在关系边，这种写法只会骗过校验
      if (e.from === e.to) errs.push(`${p.id}：不允许自环边（${e.from}→${e.to}）；请用模式级 where 谓词`);
    }
    if (typeof p.where === 'function' && (p.edges || []).some((e) => e.from === e.to)) errs.push(`${p.id}：where 与自环边同时存在`);
  }
  return errs;
}
