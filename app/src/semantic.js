// S1 · 语义图编译器（成就检测引擎的输入层）
//
// 把"画布上的东西"编译成一张**语义图**：节点＝实体（带关键特征），
// 边＝实体之间**真实存在**的关系。成就模式库只对这张图做子图匹配 + 数值谓词，
// 因此这一层必须：① 只读事实、不猜；② 判据里的每个量都能被复核；③ 纯函数、可在 Node 里单测。
//
// 边只有五类（与 docs/03 §2.1 对齐）：
//   coincident  端点/点 重合
//   onHost      点落在某条宿主曲线上（含"近到算落在上面"）
//   constraint  几何约束（水平/垂直/平行/垂直/等长/重合/中点/相切…）
//   binding     绑定：某个参数被别的实体/变量驱动
//   sharedVar   共享变量：同一个变量驱动了两处以上（这是"织边"的核心证据之一）
//   observe     观察器：某个实体/派生量被一个观察器盯住
import { REGISTRY, paramsOf, derivedOf } from './entities.js';

const K = (entId, param) => `${entId}:${param}`;

// 一条实体的"端点/顶点"清单（用于重合判定）：{ key, x, y }
export // 派生量观察器的当前值（与 st.values 同源：由 evaluateAll 写入 st.env）
function probeValue(st, pr) {
  try { return st.env.val(pr.entId, pr.key); } catch { return NaN; }
}

function anchorPointsOf(ent, val) {
  const out = [];
  const push = (key, x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) out.push({ key, x, y }); };
  switch (ent.type) {
    case 'point':
    case 'edgepoint':
      push('p', val(ent.id, 'x'), val(ent.id, 'y'));
      break;
    case 'segment':
      push('p1', val(ent.id, 'x1'), val(ent.id, 'y1'));
      push('p2', val(ent.id, 'x2'), val(ent.id, 'y2'));
      break;
    case 'polygon': {
      const n = ent.count || 0;
      for (let i = 1; i <= n; i++) push(`v${i}`, val(ent.id, `v${i}x`), val(ent.id, `v${i}y`));
      break;
    }
    default: break;
  }
  return out;
}

// 实体特征：模式库的 where 谓词读的就是这些量
// 注意：REGISTRY[type].derived 是**数组** [{k, name, compute(V, ent, env)}]，
// 不是按名字索引的对象 —— 必须遍历取 d.k / d.compute。
export function featuresOf(ent, val, der, env) {
  const f = { type: ent.type };
  for (const p of paramsOf(ent)) {
    const v = val(ent.id, p.k);
    if (Number.isFinite(v)) f[p.k] = v;
  }
  for (const d of REGISTRY[ent.type]?.derived || []) {
    let v = NaN;
    try { v = d.compute((kk) => val(ent.id, kk), ent, env); } catch { v = NaN; }
    if (Number.isFinite(v)) f[d.k] = v;
  }
  if (ent.type === 'polygon') f.count = ent.count || 0;
  if (ent.type === 'edgepoint') f.host = ent.host || null;
  if (ent.type === 'circle' || ent.type === 'arcfree' || ent.type === 'arc') f.r = Math.abs(val(ent.id, 'r'));
  if (ent.type === 'joint') { f.a = ent.a; f.b = ent.b; f.sa = ent.sa; f.sb = ent.sb; }
  if (ent.type === 'func' && ent.expr != null) f.expr = String(ent.expr).replace(/\s+/g, '');
  if (ent.type === 'sinepiece') f.expr = ent.ast ? JSON.stringify(ent.ast) : null;
  void der;
  return f;
}

/**
 * 编译语义图。
 * @param st 状态（st.entities / st.bindings / st.constraints / st.variables / st.env）
 * @param opts.tol 端点重合的绝对容差（世界单位），默认 1e-3
 * @returns { nodes, edges, byId, features, coupling }
 */
export function compileSemantic(st, opts = {}) {
  const tol = Number.isFinite(opts.tol) ? opts.tol : 1e-3;
  const env = st.env || {};
  const val = (id, k) => (typeof env.val === 'function' ? env.val(id, k) : NaN);
  const der = (id, k) => {
    const e = st.entities.get(id);
    if (!e) return NaN;
    const fn = REGISTRY[e.type]?.derived?.[k];
    if (!fn) return NaN;
    try { return fn((kk) => val(id, kk), e, env); } catch { return NaN; }
  };

  // ---------- 节点 ----------
  const nodes = [];
  const features = new Map();
  const anchors = [];
  for (const ent of st.entities.values()) {
    const f = featuresOf(ent, val, null, env);
    features.set(ent.id, f);
    nodes.push({ id: ent.id, type: ent.type, label: ent.label, color: ent.color, features: f });
    for (const a of anchorPointsOf(ent, val)) anchors.push({ entId: ent.id, ...a });
  }
  // 变量也是节点：docs/03 的模式库把 Variable 当节点用（欧拉之环里的 θ 就是节点）
  const varNodeId = (name) => `var:${name}`;
  for (const v of st.variables.values()) {
    const f = { type: 'variable', value: v.value, min: v.min, max: v.max, step: v.step, anim: !!v.anim };
    features.set(varNodeId(v.name), f);
    nodes.push({ id: varNodeId(v.name), type: 'variable', label: v.name, features: f });
  }
  // 观察器（st.probes，不是实体）也是节点：它是一个"被盯住的量"
  const probeNodeId = (name) => `probe:${name}`;
  for (const pr of st.probes.values()) {
    const value = typeof pr.value === 'number' ? pr.value
      : (pr.kind === 'derived' ? (typeof env.val === 'function' ? probeValue(st, pr) : NaN) : NaN);
    const f = { type: 'probe', kind: pr.kind, entId: pr.entId || null, key: pr.key || null, expr: pr.expr || null, value };
    features.set(probeNodeId(pr.name), f);
    nodes.push({ id: probeNodeId(pr.name), type: 'probe', label: pr.name, features: f });
  }

  // ---------- 边 ----------
  const edges = [];
  const add = (kind, from, to, detail) => {
    if (!from || !to || from === to) return;
    edges.push({ kind, from, to, detail: detail || null });
  };

  // ① coincident：端点/点两两重合（不同实体之间才记）
  //    用**网格分桶**代替"每个锚点扫一遍已有分组"，把这一段的复杂度从 O(n²) 降到近似 O(n)：
  //    容差 tol 决定格子边长，落在同一格或相邻格的点才需要比较。
  const groups = [];
  const cell = Math.max(tol, 1e-6);
  const buckets = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const a of anchors) {
    const bx = Math.floor(a.x / cell), by = Math.floor(a.y / cell);
    let g = null;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get(`${bx + dx},${by + dy}`);
        if (!bucket) continue;
        for (const cand of bucket) {
          if (Math.hypot(a.x - cand.a.x, a.y - cand.a.y) <= tol) { g = cand.g; break outer; }
        }
      }
    }
    if (!g) { g = []; groups.push(g); }
    g.push(a);
    const k = keyOf(a.x, a.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push({ a, g });
  }
  for (const g of groups) {
    const ids = [...new Set(g.map((a) => a.entId))];
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair = g.filter((a) => a.entId === ids[i] || a.entId === ids[j]);
        add('coincident', ids[i], ids[j], { at: { x: pair[0].x, y: pair[0].y }, keys: pair.map((a) => `${a.entId}.${a.key}`) });
      }
    }
  }

  // ② onHost：线上点 → 它的宿主；（自由点/端点"正好落在某条曲线上"也算，标注 near）
  for (const ent of st.entities.values()) {
    if (ent.type === 'edgepoint' && ent.host && st.entities.has(ent.host)) {
      add('onHost', ent.id, ent.host, { t: val(ent.id, 't'), exact: true });
    }
  }
  // 自由点"正好落在某条曲线上"：用**包围盒网格**只查邻近候选，
  // 否则 1000 实体时这一步是 O(点数 × 实体数) ≈ 百万次距离计算（实测会把帧率打垮）。
  const hostBoxes = [];
  for (const host of st.entities.values()) {
    if (host.type === 'edgepoint') continue;
    const box = hostBoxOf(host, val);
    if (box) hostBoxes.push({ host, box });
  }
  const hcell = Math.max(tol * 4, 0.5);
  const hgrid = new Map();
  for (const item of hostBoxes) {
    const [x0, y0, x1, y1] = item.box;
    for (let gx = Math.floor(x0 / hcell); gx <= Math.floor(x1 / hcell); gx++) {
      for (let gy = Math.floor(y0 / hcell); gy <= Math.floor(y1 / hcell); gy++) {
        const k = `${gx},${gy}`;
        if (!hgrid.has(k)) hgrid.set(k, []);
        hgrid.get(k).push(item);
      }
    }
  }
  for (const ent of st.entities.values()) {
    if (ent.type !== 'point') continue;
    const p = [val(ent.id, 'x'), val(ent.id, 'y')];
    if (!p.every(Number.isFinite)) continue;
    const gx = Math.floor(p[0] / hcell), gy = Math.floor(p[1] / hcell);
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const item of hgrid.get(`${gx + dx},${gy + dy}`) || []) {
          if (seen.has(item.host.id) || item.host.id === ent.id) continue;
          seen.add(item.host.id);
          const d = distanceToHost(null, item.host, p, val);
          if (Number.isFinite(d) && d <= tol * 2) add('onHost', ent.id, item.host.id, { distance: d, exact: false });
        }
      }
    }
  }

  // ③ constraint：**约束本身是节点**（一元约束如水平/垂直只有一个 ref，用两两连边表达不了）。
  //    每个被约束的实体 → 约束节点 连一条 constraint 边；约束的种类与残差放在约束节点的特征上。
  const conNodeId = (id) => `con:${id}`;
  for (const c of st.constraints.values()) {
    const refs = (c.refs || []).filter((id) => st.entities.has(id));
    const cf = { type: 'constraint', kind: c.kind, error: Number.isFinite(c.error) ? c.error : 0, refs: [...refs], refCount: refs.length };
    const cid = conNodeId(c.id);
    features.set(cid, cf);
    nodes.push({ id: cid, type: 'constraint', label: c.kind, features: cf });
    for (const r of refs) add('constraint', r, cid, { kind: c.kind, error: cf.error });
  }

  // ④ binding：被引用的实体/变量 → 目标实体
  //    权威来源是 binding.sources（已解析成实体 id / 变量名）；
  //    **不能**从 ast 的 ref.ent 取 —— 那是标签（如 'p2'），而实体按 id（'e2'）索引，
  //    直接 has(label) 永远为假，绑定边会被静默丢掉。
  const varUsers = new Map();     // 变量名 → Set(被驱动的实体 id)
  for (const b of st.bindings.values()) {
    const target = b.target?.ent;
    if (!target || !st.entities.has(target)) continue;
    const sources = Array.isArray(b.sources) ? b.sources : [];
    for (const s of sources) {
      if (!s) continue;
      if (s.kind === 'param' && st.entities.has(s.ent)) {
        add('binding', s.ent, target, { param: b.target.param, src: b.src, via: s.param });
      }
      if (s.kind === 'var' && s.name) {
        add('binding', varNodeId(s.name), target, { param: b.target.param, src: b.src, variable: s.name });
        if (!varUsers.has(s.name)) varUsers.set(s.name, new Set());
        varUsers.get(s.name).add(target);
      }
    }
  }

  // ⑤ sharedVar：同一个变量驱动了两处以上 → 这些被驱动实体之间两两连边（织边的关键证据）
  for (const [name, users] of varUsers) {
    const ids = [...users];
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) add('sharedVar', ids[i], ids[j], { variable: name });
    }
  }

  // ⑥ observe：被观察实体 → 观察器（这是"盯着看"的关系，供模式库使用）
  for (const pr of st.probes.values()) {
    if (pr.entId && st.entities.has(pr.entId)) add('observe', pr.entId, probeNodeId(pr.name), { key: pr.key || null, expr: pr.expr || null });
  }

  // 供织边使用的耦合索引
  const coupling = new Map();     // "u|v" → { kinds:Set, detail }
  const key2 = (u, v) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  for (const e of edges) {
    const k = key2(e.from, e.to);
    if (!coupling.has(k)) coupling.set(k, { u: e.from < e.to ? e.from : e.to, v: e.from < e.to ? e.to : e.from, kinds: new Set(), details: [] });
    const c = coupling.get(k);
    c.kinds.add(e.kind);
    if (e.detail) c.details.push(e.detail);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, edges, byId, features, coupling, tol };
}

// 宿主曲线的轴对齐包围盒（用于网格索引；拿不到就返回 null，退化为不索引）
function hostBoxOf(host, val) {
  const num = (k) => val(host.id, k);
  if (host.type === 'segment') {
    const xs = [num('x1'), num('x2')], ys = [num('y1'), num('y2')];
    if (![...xs, ...ys].every(Number.isFinite)) return null;
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (host.type === 'circle' || host.type === 'arcfree' || host.type === 'arc') {
    const cx = num('cx'), cy = num('cy'), r = Math.abs(num('r'));
    if (![cx, cy, r].every(Number.isFinite)) return null;
    return [cx - r, cy - r, cx + r, cy + r];
  }
  if (host.type === 'sine' || host.type === 'func' || host.type === 'parabola') {
    const cy = num('cy') || 0;
    const x0 = num('dmin'), x1 = num('dmax');
    const A = Math.abs(num('A') || num('a') || 1) + Math.abs(cy);
    if (![x0, x1].every(Number.isFinite)) return null;
    return [Math.min(x0, x1), cy - A, Math.max(x0, x1), cy + A];
  }
  return null;
}

// 宿主上用于距离判定的采样点（线段/圆/弧/函数曲线各自给一组）
function anchorsOfHost(host, val) {
  switch (host.type) {
    case 'segment':
      return [[val(host.id, 'x1'), val(host.id, 'y1')], [val(host.id, 'x2'), val(host.id, 'y2')]];
    case 'circle': case 'arcfree': case 'arc':
      return null;   // 用解析距离
    default:
      return null;
  }
}

function distanceToHost(A, host, p, val) {
  if (host.type === 'circle' || host.type === 'arcfree' || host.type === 'arc') {
    const cx = val(host.id, 'cx'), cy = val(host.id, 'cy'), r = Math.abs(val(host.id, 'r'));
    if (![cx, cy, r].every(Number.isFinite)) return NaN;
    return Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r);
  }
  if (host.type === 'segment' && A && A.length === 2) {
    const [a, b] = A;
    if (![...a, ...b].every(Number.isFinite)) return NaN;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  return NaN;
}

export { K as semanticKey };
