// 场景状态：实体/变量/绑定的单源事实 + 撤销重做 + 序列化
// 纯模块（无 DOM），Node 可测。
import { REGISTRY, paramsOf, derivedOf, writeAliasOf, jointOfLine, isValidParam, polygonName, projectOnHost, canHostPoint, arcGeom, samplePiece, pointOnHost, lineAngleInfo } from './entities.js';
import { parseExpression, collectRefs, linearize, numericSolve, evalAst } from './expr.js';
import { evaluateAll, wouldCycle, findByLabel, makeEnv } from './graph.js';
import { solveConstraints } from './constraints.js';
import { lineLikeOf, intersectLines, properIntersection, jointsNear, quadrantExists } from './lines.js';
import { PALETTE } from './util.js';

export function createState() {
  return {
    entities: new Map(),   // id → { id, type, label, params, bound, color, pts?, exprSrc?, ast? }
    variables: new Map(),  // name → { name, value, min, max, step }
    bindings: new Map(),   // id → { id, target:{ent,param}, src, ast, sources }
    constraints: new Map(),// id → { id, kind, refs, error }
    probes: new Map(),     // name → { name, entId, key }（只读观测器，可被表达式引用）
    counters: {}, seq: 1, bseq: 1, cseq: 1, colorIdx: 0,
    selection: new Set(),
    values: new Map(), scope: null, base: null,
    dirty: true,
    listeners: new Set(),
    undoStack: [], redoStack: [],
    tool: 'select', hover: null, ghost: null, snap: null,
    connOn: false, connFlashUntil: 0,
    boxSelect: null,
  };
}

export function on(st, fn) { st.listeners.add(fn); }
export function emit(st, kind = 'change') {
  st.dirty = true;
  for (const fn of st.listeners) fn(kind);
}
// 相机变动通知：曲线采样会在移动期间降档、停下来再全精度重采
export { notifyCameraMoved } from './entities.js';

// ---------- 求值 ----------
export function ensureEvaluated(st, { solve = false, pin = null } = {}) {
  const { values, base, scope, env } = evaluateAll(st);
  st.values = values; st.base = base; st.scope = scope; st.env = env;
  if (solve && st.constraints && st.constraints.size) {
    // 求解后参数可能被改写 → 再求值一次，保证 UI 拿到的是满足约束后的结果
    const r = solveConstraints(st, { pin: pin || st.pin || new Set() });
    if (r.iterations) {
      // 求解后参数可能被改写 → 再求值一次，让 UI 拿到满足约束后的结果。
      // 只走一遍：以前为了"旋转优先"走过两遍，会让角度别名每帧被重复施加，
      // 表现为线在两侧来回跳；现在旋转本身是幂等的（绝对方向 + 单次写入），不需要它。
      const again = evaluateAll(st);
      st.values = again.values; st.base = again.base; st.scope = again.scope; st.env = again.env;
    }
    return r;
  }
  return null;
}

// ---------- 约束 ----------
export function addConstraint(st, kind, refs) {
  const valid = refs.filter((id) => st.entities.has(id));
  if (valid.length !== refs.length) return { error: '有图形已被删除' };
  const dup = [...st.constraints.values()].some((c) => c.kind === kind && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]));
  if (dup) return { error: '这条约束已经存在了' };
  pushUndo(st);
  const id = 'k' + st.cseq++;
  st.constraints.set(id, { id, kind, refs: [...refs], error: null });
  const r = solveConstraints(st, { pin: st.pin || new Set() });
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, id, solved: r };
}

export function removeConstraint(st, id) {
  if (!st.constraints.has(id)) return;
  pushUndo(st);
  st.constraints.delete(id);
  emit(st, 'structure');
}

// ---------- 交点/夹角（①角度工具 ④悬停显示 ⑨双击绑定 共用）----------
// aPt/bPt：用户按下与松开的位置，用来判断"取哪一个角"（交点四周有四个角）
export function addJoint(st, aId, bId, aPt, bPt) {
  const ea = st.entities.get(aId), eb = st.entities.get(bId);
  if (!ea || !eb) return { error: '找不到那两条线' };
  if (aId === bId) return { error: '要两条不同的线才能量角' };
  const env = envNow(st);
  const la = lineLikeOf(ea, env), lb = lineLikeOf(eb, env);
  if (!la || !lb) return { error: '这两条里至少有一条不是直线型（线段 / 圆的直径 / 切线 / 割线 才行）' };
  // 只认真实相交：交点必须落在两条线各自画出来的范围内（延长线相交不算角）
  const X = properIntersection(la, lb, 0.03);
  if (!X) {
    return { error: intersectLines(la, lb)
      ? '这两条线本身没有相交（只是延长线会交叉）——角要长在真正的交点上'
      : '这两条线平行，没有交点' };
  }
  const dup = [...st.entities.values()].find((e) => e.type === 'joint'
    && ((e.a === aId && e.b === bId) || (e.a === bId && e.b === aId)));
  if (dup) return { entity: dup, existed: true };
  // 取用户点向的那一侧的角
  const sa = aPt ? (Math.sign((aPt[0] - X.x) * la.d[0] + (aPt[1] - X.y) * la.d[1]) || 1) : 1;
  const sb = bPt ? (Math.sign((bPt[0] - X.x) * lb.d[0] + (bPt[1] - X.y) * lb.d[1]) || 1) : 1;
  // ★ 鼠标点的那一侧必须真的有线：T 字外侧（180° 那条空边）没有角，就不许建
  if ((aPt || bPt) && !quadrantExists(la, lb, X, sa, sb)) {
    return { error: '这里没有角——你点的那一侧并没有线（比如 T 字的空边）。请点在真的有两段线的夹角处' };
  }
  pushUndo(st);
  const j = addEntity(st, 'joint', { r: 1.4, sa, sb }, { a: aId, b: bId }, true);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { entity: j };
}

// 双击接点：把"接触在一起的两样东西"绑起来。三种情形（按优先级）：
//   ① 一个点 + 另一图形的**端点**正好压在这个点上 → 把那端点的 x、y 绑到这个点
//      （例：圆上有个点，另一条线的一个端点搭在那里 → 线跟着点走）
//   ② 两条线真实相交处有个点 → 把这个点绑到交点（j.ix / j.iy）
//   ③ 两条线真实相交、但那个交点上有 ≥3 条线（会出现多个角）→ 只提示，不做任何绑定
export function bindContact(st, wp, tol = 0.2) {
  const env = envNow(st);
  const posOf = (e) => [env.val(e.id, 'x'), env.val(e.id, 'y')];
  // ---- 找一个"点"实体（自由点或线上点）----
  let ptEnt = null, best = Infinity;
  for (const e of st.entities.values()) {
    if (e.type !== 'point' && e.type !== 'edgepoint') continue;
    const [x, y] = posOf(e);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = Math.hypot(x - wp[0], y - wp[1]);
    if (d < Math.max(tol * 1.8, 0.18) && d < best) { best = d; ptEnt = e; }
  }
  if (!ptEnt) return { error: '这里没有点：先落一个点（或在线上截一个点）再双击' };
  const [px, py] = posOf(ptEnt);

  // ---- ① 找压在这个点上的"其他图形的端点" ----
  const ends = [];
  for (const e of st.entities.values()) {
    if (e.id === ptEnt.id) continue;
    const pairs = endpointKeysOf(e);
    for (const [kx, ky] of pairs) {
      const x = env.val(e.id, kx), y = env.val(e.id, ky);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (Math.hypot(x - px, y - py) <= Math.max(tol * 1.6, 0.16)) ends.push({ ent: e, kx, ky });
    }
  }
  if (ends.length) {
    // 只对"自由端点"下手：已经被绑定的就跳过，避免把别人的绑定踩掉
    const free = ends.filter((z) => !z.ent.bound?.[z.kx] && !z.ent.bound?.[z.ky]);
    if (!free.length) return { error: '这里的端点已经被关联过了' };
    pushUndo(st);
    const done = [];
    for (const z of free) {
      const b1 = addBinding(st, z.ent.id, z.kx, `${ptEnt.label}.x`);
      const b2 = addBinding(st, z.ent.id, z.ky, `${ptEnt.label}.y`);
      if (b1.error || b2.error) return { error: b1.error || b2.error };
      done.push(`${z.ent.label}.${z.kx}/${z.ky}`);
    }
    ensureEvaluated(st);
    emit(st, 'structure');
    return { ok: true, mode: 'endpoint', point: ptEnt, targets: done, parts: done };
  }

  // ---- ② / ③ 两条线真实相交 ----
  let near = [];
  try { near = jointsNear(st, env, [px, py], Math.max(tol * 2, 0.22)); } catch { near = []; }
  if (!near.length) {
    // 已经绑过了就说清楚（不要让"再点一次"看起来像出错）
    const b = ptEnt.bound?.x ? st.bindings.get(ptEnt.bound.x) : null;
    if (b && /\.ix$/.test(b.src || '')) {
      return { error: `这个点已经绑在 ${b.src.replace(/\.ix$/, '')}（两条线的交点）上了` };
    }
    return { error: '这个点附近没有两条线相交（只有一条线通过，或只是延长线交叉）' };
  }
  const J0 = near[0];
  if (J0.ambiguous) {
    return { error: `这个交点上有 ${J0.through} 条线（会出现好几个角）——这里只能预览，不能一键绑定` };
  }
  const rr = addJoint(st, J0.a.ent.id, J0.b.ent.id, [px, py], [px, py]);
  if (rr.error) return rr;
  const J = rr.entity;
  const parts = [];
  if (ptEnt.type === 'point') {
    const b1 = addBinding(st, ptEnt.id, 'x', `${J.label}.ix`);
    const b2 = addBinding(st, ptEnt.id, 'y', `${J.label}.iy`);
    if (b1.error) return b1;
    if (b2.error) return b2;
    parts.push('x、y');
  } else {
    const host = st.entities.get(ptEnt.host);
    if (!host) return { error: '这个线上点已经没有宿主了' };
    let srcText = null;
    if (host.type === 'segment') {
      const L = `${host.label}`;
      srcText = `((${J.label}.ix - ${L}.x1)*(${L}.x2 - ${L}.x1) + (${J.label}.iy - ${L}.y1)*(${L}.y2 - ${L}.y1)) / ${L}.length^2`;
    } else if (host.type === 'sine' || host.type === 'parabola' || host.type === 'func') {
      srcText = `${J.label}.ix`;
    } else if (host.type === 'circle') {
      srcText = `atan2(${J.label}.iy - ${host.label}.cy, ${J.label}.ix - ${host.label}.cx)`;
    } else {
      return { error: `${host.label} 这种宿主暂时不支持一键绑交点（可以手动关联 t）` };
    }
    const b = addBinding(st, ptEnt.id, 't', srcText);
    if (b.error) return b;
    parts.push(`t ← ${srcText}`);
  }
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, mode: 'joint', joint: J, point: ptEnt, parts, existed: !!rr.existed };
}

// 一个实体有哪些"端点"参数对（供接点绑定用）
function endpointKeysOf(e) {
  if (e.type === 'segment') return [['x1', 'y1'], ['x2', 'y2']];
  if (e.type === 'polygon') {
    const out = [];
    for (let i = 1; i <= (e.count || 0); i++) out.push([`v${i}x`, `v${i}y`]);
    return out;
  }
  if (e.type === 'arcfree') return [];   // 圆弧两端由 start/sweep 决定，不是自由坐标
  if (e.type === 'freehand') return [];
  return [];
}

// ---------- 角度绑定自检 + 反解 ----------
// 拖动结束时调用：谁被拖不重要（可能是圆上的点、线段、宿主），只要实测角度与
// 绑定表达式的值不一致，就把这个变化**推给上游变量** —— 这样"手动转线 → 变量跟着动"。
// 同一轮里同一条链只解一次（visited 护栏），避免 A 推 B、B 推 A 互相追。
export function syncAngleBindings(st) {
  const done = [];
  for (const b of [...st.bindings.values()]) {
    if (!b.alias || b.target.param !== 'angle') continue;
    const ent = st.entities.get(b.target.ent);
    if (!ent) continue;
    const info = lineAngleInfo(st, ent);
    if (!info || !Number.isFinite(info.deg)) continue;
    const want = st.env ? st.env.val(ent.id, 'angle') : NaN;
    if (!Number.isFinite(want) || Math.abs(want - info.deg) < 0.05) continue;
    const r = inverseSolve(st, b, info.deg, 0, new Set([b.id]));
    if (r.ok) done.push({ binding: b.id, deg: info.deg, how: r.how, name: r.name });
  }
  if (done.length) ensureEvaluated(st);
  return done;
}

export function constraintsOf(st, entId) {
  return [...st.constraints.values()].filter((c) => c.refs.includes(entId));
}

// ---------- 观察器（P10 / 2.0）----------
// 两种：derived＝挂某个图形的派生量（如 切线.斜率 m）；expr＝任意表达式（如 `m割 − m切`）。
// 名字都能像变量一样写进表达式（只读）
function uniqueProbeName(st, base) {
  const clean = String(base).replace(/[^A-Za-z0-9_]/g, '') || 'p';
  let name = clean, i = 2;
  while (st.probes.has(name) || st.variables.has(name)) name = `${clean}${i++}`;
  return name;
}

export function addProbe(st, entId, key) {
  const ent = st.entities.get(entId);
  if (!ent) return { error: '实体不存在' };
  if (!derivedOf(ent, key)) return { error: `${ent.label} 没有派生量 ${key}` };
  const name = uniqueProbeName(st, `${ent.label}_${key}`);
  pushUndo(st);
  st.probes.set(name, { name, kind: 'derived', entId, key });
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, name };
}

// 表达式观察器：例如 `m割 − m切`
export function addExprProbe(st, srcText) {
  const src = String(srcText || '').trim();
  if (!src) return { error: '表达式是空的' };
  let ast;
  try { ast = parseExpression(src); } catch (e) { return { error: e.message }; }
  const { vars } = collectRefs(ast);
  for (const v of vars) {
    if (!st.variables.has(v) && !st.probes.has(v)) return { error: `未定义的量 "${v}"` };
  }
  const name = uniqueProbeName(st, src.replace(/[^A-Za-z_]/g, '').slice(0, 6) || 'p');
  pushUndo(st);
  st.probes.set(name, { name, kind: 'expr', src, ast });
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, name };
}

export function renameProbe(st, oldName, newName) {
  const p = st.probes.get(oldName);
  if (!p) return { error: '观察器不存在' };
  const name = String(newName).trim();
  if (name === oldName) return { ok: true, name };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `"${name}" 不能作为名字` };
  if (st.probes.has(name) || st.variables.has(name)) return { error: `"${name}" 已被占用` };
  pushUndo(st);
  st.probes.delete(oldName);
  st.probes.set(name, { ...p, name });
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, name };
}

export function removeProbe(st, name) {
  if (!st.probes.has(name)) return;
  pushUndo(st);
  st.probes.delete(name);
  emit(st, 'structure');
}

export function probeValue(st, probe) {
  if (!probe) return NaN;
  if (probe.kind === 'expr') {
    try { return evalAst(probe.ast, st.scope); } catch { return NaN; }
  }
  const ent = st.entities.get(probe.entId);
  if (!ent) return NaN;
  return st.env ? st.env.val(ent.id, probe.key) : NaN;
}
export function getVal(st, ent, key) {
  const k = `${ent.id}:${key}`;
  return st.values.has(k) ? st.values.get(k) : ent.params[key];
}
export function V(st, ent) {
  return (key) => getVal(st, ent, key);
}
// 派生量（含依赖宿主的派生量，如线上点的 x/y、圆弧的弧长）
export function getDerived(st, ent, key) {
  const env = st.env || makeEnv(st, (id, k) => getVal(st, st.entities.get(id), k));
  return env.val(ent.id, key);
}

// ---------- 撤销/重做（快照式） ----------
export function serialize(st) {
  return JSON.stringify({
    entities: [...st.entities.values()],
    variables: [...st.variables.values()],
    bindings: [...st.bindings.values()],
    constraints: [...st.constraints.values()],
    probes: [...st.probes.values()],
    counters: st.counters, seq: st.seq, bseq: st.bseq, cseq: st.cseq, colorIdx: st.colorIdx,
  });
}
export function restore(st, json) {
  const d = JSON.parse(json);
  st.entities = new Map(d.entities.map((e) => [e.id, e]));
  st.variables = new Map(d.variables.map((v) => [v.name, v]));
  st.bindings = new Map(d.bindings.map((b) => [b.id, b]));
  st.constraints = new Map((d.constraints || []).map((c) => [c.id, c]));
  st.probes = new Map((d.probes || []).map((p) => [p.name, p]));
  st.counters = d.counters; st.seq = d.seq; st.bseq = d.bseq; st.cseq = d.cseq ?? 1; st.colorIdx = d.colorIdx ?? 0;
  st.selection = new Set([...st.selection].filter((id) => st.entities.has(id)));
  ensureEvaluated(st);
  emit(st, 'structure');
}
export function pushUndo(st) {
  st.undoStack.push(serialize(st));
  if (st.undoStack.length > 500) st.undoStack.shift();
  st.redoStack = [];
}
export function undo(st) {
  if (!st.undoStack.length) return false;
  st.redoStack.push(serialize(st));
  restore(st, st.undoStack.pop());
  return true;
}
export function redo(st) {
  if (!st.redoStack.length) return false;
  st.undoStack.push(serialize(st));
  restore(st, st.redoStack.pop());
  return true;
}
// 手势级撤销：pointerdown 时 begin，pointerup 时若 changed 则把开始快照入栈
export function beginGesture(st) { st._gesture = serialize(st); }
export function endGesture(st, changed) {
  if (changed && st._gesture && st._gesture !== serialize(st)) {
    st.undoStack.push(st._gesture);
    st.redoStack = [];
  }
  st._gesture = null;
}

// ---------- 实体 ----------
export function addEntity(st, type, params, extra = {}, skipUndo = false) {
  const def = REGISTRY[type];
  if (!def) throw new Error(`未知实体类型 ${type}`);
  if (!skipUndo) pushUndo(st);
  const n = (st.counters[def.prefix] = (st.counters[def.prefix] || 0) + 1);
  // 先用注册表的默认值补齐（调用方可以只给部分参数，例如只有 A/lam/cx/cy 的正弦波），
  // 否则读取新增参数（如 dmin/dmax）会拿到 undefined，采样范围变 NaN。
  const defaults = typeof def.create === 'function' ? def.create({ x: 0, y: 0 }) : {};
  const ent = {
    id: 'e' + st.seq++, type, label: def.prefix + n,
    params: { ...defaults, ...params }, bound: {},
    color: PALETTE[st.colorIdx++ % PALETTE.length],
    ...extra,
  };
  st.entities.set(ent.id, ent);
  ensureEvaluated(st);
  emit(st, 'structure');
  return ent;
}

export function removeEntities(st, ids) {
  const list = [...ids].filter((id) => st.entities.has(id));
  if (!list.length) return;
  pushUndo(st);
  const doomedBindings = new Set();
  for (const id of list) {
    const ent = st.entities.get(id);
    for (const p in ent.bound) doomedBindings.add(ent.bound[p]);
  }
  // 级联：源引用了被删实体的绑定一并移除
  for (const b of st.bindings.values()) {
    if (b.sources.some((s) => s.kind === 'param' && list.includes(s.ent))) doomedBindings.add(b.id);
  }
  for (const bId of doomedBindings) {
    const b = st.bindings.get(bId);
    if (b) { const t = st.entities.get(b.target.ent); if (t) delete t.bound[b.target.param]; }
    st.bindings.delete(bId);
  }
  for (const id of list) { st.entities.delete(id); st.selection.delete(id); }
  // 指向被删实体的观察器一并清掉
  for (const [nm, p] of [...(st.probes || new Map())]) if (list.includes(p.entId)) st.probes.delete(nm);
  // 引用被删实体的约束一并清掉
  for (const c of [...st.constraints.values()]) {
    if (c.refs.some((r) => list.includes(r))) st.constraints.delete(c.id);
  }
  ensureEvaluated(st);
  emit(st, 'structure');
}

export function setParams(st, ent, patch, { gesture = false } = {}) {
  if (!gesture) pushUndo(st);
  Object.assign(ent.params, patch);
  ensureEvaluated(st, { solve: true });
  emit(st);
}

// ---------- 线上点与"截" ----------
function envNow(st) {
  return st.env || makeEnv(st, (id, k) => getVal(st, st.entities.get(id), k));
}

// 世界坐标 → 宿主上的参数 t（供工具层把点击位置投影到图形上）
export function projectOnEntity(st, ent, pt) {
  return projectOnHost(ent, envNow(st), pt);
}

// 在宿主实体的边/曲线上钉一个点（参数 t 可被绑定，可当滑杆用）
export function addEdgePoint(st, hostId, t) {
  const host = st.entities.get(hostId);
  if (!host || !canHostPoint(host)) return null;
  pushUndo(st);
  const extra = { host: hostId };
  // 多边形：记住它属于哪条边，并默认"锁"在这条边上（roam=false）
  if (host.type === 'polygon') {
    const n = host.count || 1;
    extra.edge = Math.min(Math.max(Math.floor(t), 0), n - 1);
    extra.roam = false;
  }
  const point = addEntity(st, 'edgepoint', { t }, extra, true);
  let piece = null;
  // 宿主上已有另一个线上点 → 自动截出中间那一段
  if (host.type === 'circle') piece = maybeCut(st, host, point, 'arc');
  else if (host.type !== 'arc') piece = maybeCut(st, host, point, 'curvepiece');
  ensureEvaluated(st);
  emit(st, 'structure');
  return { point, arc: piece };
}

// 两点裁切：跟宿主上已有线上点里"参数距离最近"的那个配对，截出中间一段。
// ⑤ 按用户要求：截出来的就是**独立实体**（不再挂宿主、不再每帧重采样），
// 所以拖动它只会平移、不会改姿态；类型按宿主解析化（圆→自由圆弧、正弦→带定义域的正弦…）。
function maybeCut(st, host, fresh, kind) {
  const others = [...st.entities.values()].filter((e) => e.type === 'edgepoint' && e.host === host.id && e.id !== fresh.id);
  if (!others.length) return null;
  const t0 = getVal(st, fresh, 't');
  const circular = host.type === 'circle';
  let best = others[0], bestD = Infinity;
  for (const o of others) {
    let d = Math.abs(getVal(st, o, 't') - t0);
    if (circular) {
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      d = Math.min(d, 2 * Math.PI - d);
    }
    if (d < bestD) { bestD = d; best = o; }
  }
  const t1 = getVal(st, best, 't'), t2 = t0;
  const made = materializePiece(st, host, t1, t2);
  return made;
}

// 由宿主 + 参数区间，解析化地造出一个**独立**的图形实体（切开/解绑共用）
export function materializePiece(st, host, t1, t2, color) {
  const env = envNow(st);
  const a = Math.min(t1, t2), b = Math.max(t1, t2);
  // 带上出处：属性页可以显示"由 w1 截出"，类型名也能说成"正弦段/弧段"而不是笼统"圆弧"
  const meta = { piece: true, fromLabel: host.label, fromType: host.type };
  let made = null;
  if (host.type === 'circle') {
    // 圆上截出 → 自由圆弧（圆心/半径/起止角都是可绑定的真实参数）
    let G = null;
    try {
      const sweep = ((t2 - t1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      G = { cx: env.val(host.id, 'cx'), cy: env.val(host.id, 'cy'), r: env.val(host.id, 'r'), start: t1, sweep };
    } catch { G = null; }
    made = addEntity(st, 'arcfree', G || { cx: 0, cy: 0, r: 1, start: 0, sweep: Math.PI / 2 }, { ...meta }, true);
  } else if (host.type === 'segment') {
    const p = pointOnHost(host, env, t1), q = pointOnHost(host, env, t2);
    made = addEntity(st, 'segment', { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }, { ...meta }, true);
  } else if (host.type === 'sine') {
    const V = (k) => env.val(host.id, k);
    made = addEntity(st, 'sine', {
      A: V('A'), lam: V('lam'), phi: V('phi'), cx: V('cx'), cy: V('cy'), dmin: a, dmax: b,
    }, { ...meta }, true);
  } else if (host.type === 'parabola') {
    const V = (k) => env.val(host.id, k);
    made = addEntity(st, 'parabola', { a: V('a'), h: V('h'), k: V('k'), dmin: a, dmax: b }, { ...meta }, true);
  } else if (host.type === 'func') {
    made = addEntity(st, 'func', { dmin: a, dmax: b, cy: (() => { try { return env.val(host.id, 'cy') || 0; } catch { return 0; } })() },
      { exprSrc: host.exprSrc, ast: host.ast, ...meta }, true);
  } else if (host.type === 'freehand') {
    const pts = host.pts || [];
    const i0 = Math.max(0, Math.round(a * (pts.length - 1)));
    const i1 = Math.max(i0 + 1, Math.round(b * (pts.length - 1)));
    made = addEntity(st, 'freehand', {}, { pts: pts.slice(i0, i1 + 1).map((p) => [...p]), ...meta }, true);
  } else {
    const pts = samplePiece(host, env, t1, t2, 256);
    if (pts.length >= 2) made = addEntity(st, 'freehand', {}, { pts, ...meta }, true);
  }
  if (made && color) made.color = color;
  return made;
}

// 截出来的独立段的类型名（⑤：不再一律叫"圆弧"，按来源说人话）
export const PIECE_NAMES = {
  arcfree: '弧段',
  segment: '线段',
  sine: '正弦段',
  parabola: '抛物线段',
  func: '函数段',
  freehand: '曲线段',
};
export function pieceNameOf(ent) {
  if (!ent) return '一段';
  return PIECE_NAMES[ent.type] || '一段曲线';
}

// 开关"允许绕到其它边"（多边形上的线上点）
export function setEdgePointRoam(st, id, roam) {
  const ent = st.entities.get(id);
  if (!ent || ent.type !== 'edgepoint') return;
  const host = st.entities.get(ent.host);
  pushUndo(st);
  ent.roam = !!roam;
  // 重新锁上时把 t 收回原先那条边
  if (!ent.roam && host?.type === 'polygon') {
    const n = host.count || 1;
    let t = getVal(st, ent, 't');
    let i = Math.floor(((t % n) + n) % n);
    if (ent.edge != null) i = ent.edge;
    const f = t - Math.floor(t);
    const edge = Math.min(Math.max(ent.edge ?? i, 0), n - 1);
    ent.edge = edge;
    ent.params.t = edge + Math.min(Math.max(f, 0), 0.9999);
  }
  ensureEvaluated(st);
  emit(st, 'structure');
}

// ---------- 解绑 / 绑定 ----------
// 连带清理：删除 ids 及其所有依赖者（线上点/裁切段引用了它，绑定引用了它的参数）
function removeWithDependents(st, ids) {
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of st.entities.values()) {
      if (doomed.has(e.id)) continue;
      if ((e.host && doomed.has(e.host)) || (e.p1 && doomed.has(e.p1)) || (e.p2 && doomed.has(e.p2))) {
        doomed.add(e.id);
        grew = true;
      }
    }
  }
  const doomedBindings = new Set();
  for (const id of doomed) {
    const e = st.entities.get(id);
    for (const p in (e?.bound || {})) doomedBindings.add(e.bound[p]);
  }
  for (const b of st.bindings.values()) {
    if (b.sources.some((src) => src.kind === 'param' && doomed.has(src.ent))) doomedBindings.add(b.id);
  }
  for (const bId of doomedBindings) {
    const b = st.bindings.get(bId);
    if (b) { const t = st.entities.get(b.target.ent); if (t) delete t.bound[b.target.param]; }
    st.bindings.delete(bId);
  }
  for (const id of doomed) { st.entities.delete(id); st.selection.delete(id); }
  return doomed;
}

// 多边形"解绑"：拆散为逐条线段（原有依赖它的线上点/裁切段会一并清理）
export function explodePolygon(st, polyId) {
  const poly = st.entities.get(polyId);
  if (!poly || poly.type !== 'polygon') return { error: '只有多边形可以解绑为线段' };
  const n = poly.count || 0;
  if (n < 2) return { error: '多边形顶点不足' };
  pushUndo(st);
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push([getVal(st, poly, `v${i}x`), getVal(st, poly, `v${i}y`)]);
  const color = poly.color;
  removeWithDependents(st, [polyId]);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const s = addEntity(st, 'segment', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, {}, true);
    s.color = color;
    segs.push(s);
  }
  ensureEvaluated(st);
  emit(st, 'structure');
  return { segments: segs, count: segs.length };
}

// 线段"绑定"：把选中的若干线段合并为一个多边形（必须首尾相连围成闭环）
export function mergeSegments(st, ids, tolWorld = 0.05) {
  const segs = [...new Set(ids)].map((id) => st.entities.get(id)).filter((e) => e && e.type === 'segment');
  if (segs.length < 3) return { error: '至少需要 3 条线段才能围成一个图形' };

  const clusters = [];
  const clusterOf = (p) => {
    for (const c of clusters) if (Math.hypot(p[0] - c.sx / c.n, p[1] - c.sy / c.n) <= tolWorld) return c;
    return null;
  };
  const nodesOf = new Map();
  for (const s of segs) {
    const pts = [[getVal(st, s, 'x1'), getVal(st, s, 'y1')], [getVal(st, s, 'x2'), getVal(st, s, 'y2')]];
    nodesOf.set(s.id, pts.map((p) => {
      let c = clusterOf(p);
      if (!c) { c = { id: clusters.length, sx: 0, sy: 0, n: 0, links: [] }; clusters.push(c); }
      c.sx += p[0]; c.sy += p[1]; c.n++;
      return c;
    }));
  }
  for (const s of segs) {
    const [a, b] = nodesOf.get(s.id);
    if (a === b) { clusters.forEach((c) => { c.links = []; }); return { error: '存在退化线段（两端重合）' }; }
    a.links.push({ seg: s, other: b });
    b.links.push({ seg: s, other: a });
  }
  for (const c of clusters) {
    if (c.links.length !== 2) {
      return { error: `这些线段没有首尾相连围成一个闭合图形（有 ${c.links.length} 条线交于同一处）` };
    }
  }
  // 沿环路走一圈
  const start = clusters[0];
  const verts = [];
  const usedSegs = new Set();
  let node = start, from = null;
  do {
    verts.push(node);
    const link = node.links.find((l) => l.seg !== from);
    if (!link || usedSegs.has(link.seg.id)) return { error: '这些线段没有围成一个单一闭合图形' };
    usedSegs.add(link.seg.id);
    from = link.seg;
    node = link.other;
  } while (node !== start && verts.length <= clusters.length + 1);
  if (node !== start || usedSegs.size !== segs.length || verts.length !== clusters.length) {
    return { error: '这些线段没有围成一个单一闭合图形' };
  }

  pushUndo(st);
  const params = {};
  verts.forEach((c, i) => { params[`v${i + 1}x`] = c.sx / c.n; params[`v${i + 1}y`] = c.sy / c.n; });
  const color = segs[0].color;
  for (const s of segs) removeWithDependents(st, [s.id]);
  const cnt = (st.counters.pg = (st.counters.pg || 0) + 1);
  const poly = {
    id: 'e' + st.seq++, type: 'polygon', label: 'pg' + cnt,
    params, bound: {}, color, count: verts.length, merged: true,
  };
  st.entities.set(poly.id, poly);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { polygon: poly, sides: verts.length, name: polygonName(verts.length) };
}

// 裁切段/圆弧"解绑"：脱离宿主，变成一段可以自由拖走的独立图形。
// （⑤ 之后新截出来的段本来就是独立的；这个入口保留给旧场景里的 arc/curvepiece。）
// 关键：不做"把采样点烤进实体"这种会永久失真的做法——
// 能解析表达的一律还原成【带定义域的解析实体】。
export function detachPiece(st, pieceId) {
  const piece = st.entities.get(pieceId);
  if (!piece || (piece.type !== 'arc' && piece.type !== 'curvepiece')) {
    return { error: '只有裁切出来的段可以解绑（现在截出来的段本来就是独立的）' };
  }
  const host = st.entities.get(piece.host);
  if (!host) return { error: '宿主图形已不存在' };
  const env = envNow(st);

  // 取这一段的参数范围
  let t1, t2;
  if (piece.type === 'arc') {
    const G = arcGeom(piece, env);
    if (!G) return { error: '这段圆弧取不到有效几何' };
    t1 = G.start; t2 = G.start + G.sweep;
  } else {
    t1 = env.val(piece.id, 't1');
    t2 = env.val(piece.id, 't2');
  }
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return { error: '这段图形取不到有效参数范围' };

  pushUndo(st);
  const color = piece.color;
  removeWithDependents(st, [pieceId]);
  const made = materializePiece(st, host, t1, t2, color);
  if (!made) return { error: '这段图形取不到有效路径' };

  st.selection = new Set([made.id]);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { entity: made, kind: made.type };
}

function detachPieceLegacy(st, piece, host, env, t1, t2) {
  let made = null;

  if (host.type === 'circle') {
    // 圆弧 → 自由圆弧（圆心/半径/起止角都是可绑定的真实参数）
    const G = arcGeom(piece, env) || { cx: 0, cy: 0, r: 1, start: 0, sweep: 0 };
    made = addEntity(st, 'arcfree', { cx: G.cx, cy: G.cy, r: G.r, start: G.start, sweep: G.sweep }, {}, true);
  } else if (host.type === 'segment') {
    const a = pointOnHost(host, env, t1), b = pointOnHost(host, env, t2);
    made = addEntity(st, 'segment', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, {}, true);
  } else if (host.type === 'sine') {
    const V = (k) => env.val(host.id, k);
    made = addEntity(st, 'sine', {
      A: V('A'), lam: V('lam'), phi: V('phi'), cx: V('cx'), cy: V('cy'),
      dmin: Math.min(t1, t2), dmax: Math.max(t1, t2),
    }, {}, true);
  } else if (host.type === 'parabola') {
    const V = (k) => env.val(host.id, k);
    made = addEntity(st, 'parabola', {
      a: V('a'), h: V('h'), k: V('k'), dmin: Math.min(t1, t2), dmax: Math.max(t1, t2),
    }, {}, true);
  } else if (host.type === 'func') {
    // 函数图保留原表达式，只把定义域收到这一段
    made = addEntity(st, 'func', { dmin: Math.min(t1, t2), dmax: Math.max(t1, t2) },
      { exprSrc: host.exprSrc, ast: host.ast }, true);
  } else if (host.type === 'freehand') {
    // 自由曲线本来就是采样点，取原点的子段（不额外损失）
    const pts = host.pts || [];
    const i0 = Math.max(0, Math.round(Math.min(t1, t2) * (pts.length - 1)));
    const i1 = Math.max(i0 + 1, Math.round(Math.max(t1, t2) * (pts.length - 1)));
    made = addEntity(st, 'freehand', {}, { pts: pts.slice(i0, i1 + 1).map((p) => [...p]) }, true);
  } else {
    // 其它宿主（例如弧上再裁）：退化为采样折线
    const pts = samplePiece(host, env, t1, t2, 256);
    if (pts.length < 2) return { error: '这段图形取不到有效路径' };
    made = addEntity(st, 'freehand', {}, { pts }, true);
  }

  made.color = color;
  st.selection = new Set([made.id]);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { entity: made, kind: made.type };
}

// ---------- 闭合图形自动组合 ----------
// 端点在容差内视为同一顶点；若能沿线段走回起点，则把这些线段合并为一个多边形实体。
export function detectClosedShape(st, newSegId, tolWorld) {
  const segs = [...st.entities.values()].filter((e) => e.type === 'segment');
  if (segs.length < 3) return null;
  const seed = st.entities.get(newSegId);
  if (!seed || seed.type !== 'segment') return null;

  // 顶点聚类（容差内合并）
  const clusters = [];
  const clusterOf = (p) => {
    for (const c of clusters) if (Math.hypot(p[0] - c.sx / c.n, p[1] - c.sy / c.n) <= tolWorld) return c;
    return null;
  };
  const nodeOfSeg = new Map();
  for (const s of segs) {
    const ends = [[getVal(st, s, 'x1'), getVal(st, s, 'y1')], [getVal(st, s, 'x2'), getVal(st, s, 'y2')]];
    nodeOfSeg.set(s.id, ends.map((p) => {
      let c = clusterOf(p);
      if (!c) { c = { id: clusters.length, sx: 0, sy: 0, n: 0 }; clusters.push(c); }
      c.sx += p[0]; c.sy += p[1]; c.n++;
      return c;
    }));
  }
  const [na, nb] = nodeOfSeg.get(newSegId);

  // 邻接表（排除新线段本身）
  const adj = new Map();
  const push = (n, entry) => { if (!adj.has(n.id)) adj.set(n.id, []); adj.get(n.id).push(entry); };
  for (const s of segs) {
    if (s.id === newSegId) continue;
    const [a, b] = nodeOfSeg.get(s.id);
    push(a, { seg: s, other: b });
    push(b, { seg: s, other: a });
  }

  // 从 B 找回 A 的简单路径
  const path = [];
  const visited = new Set([nb.id]);
  const dfs = (node) => {
    if (node.id === na.id) return true;
    for (const e of adj.get(node.id) || []) {
      if (visited.has(e.other.id)) continue;
      visited.add(e.other.id);
      path.push({ seg: e.seg, to: e.other });
      if (dfs(e.other)) return true;
      path.pop();
      visited.delete(e.other.id);
    }
    return false;
  };
  if (!dfs(nb)) return null;
  if (path.length < 2) return null; // 至少 3 条边才构成封闭图形

  const involved = [seed, ...path.map((p) => p.seg)];
  const n = involved.length;
  // 顶点顺序：na → nb →（从 B 回到 A 的路径上的中间顶点）；路径最后一项就是 na 本身，
  // 它是"闭合点"而不是新顶点，必须去掉，否则多边形会退化成 v1==vn 的蝴蝶形（面积为 0 或减半）。
  const verts = [na, nb, ...path.slice(0, -1).map((p) => p.to)];
  if (verts.length !== n) return null;

  // 退化保护：面积约等于 0（三点共线之类的"假闭合"）时不要组合，
  // 否则用户随手画三笔共线的线，却被告知"已组合为三角形"。
  const pts = verts.map((c) => [c.sx / c.n, c.sy / c.n]);
  let signed = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(signed) / 2 < 1e-6) return null;

  // 合并为一个多边形实体（顶点取聚类平均位置，保证严格闭合）
  pushUndo(st);
  const params = {};
  verts.forEach((c, i) => {
    params[`v${i + 1}x`] = c.sx / c.n;
    params[`v${i + 1}y`] = c.sy / c.n;
  });
  const doomedBindings = new Set();
  for (const s of involved) {
    for (const p in s.bound) doomedBindings.add(s.bound[p]);
  }
  for (const b of st.bindings.values()) {
    if (b.sources.some((src) => src.kind === 'param' && involved.some((s) => s.id === src.ent))) doomedBindings.add(b.id);
  }
  for (const bId of doomedBindings) {
    const b = st.bindings.get(bId);
    if (b) { const t = st.entities.get(b.target.ent); if (t) delete t.bound[b.target.param]; }
    st.bindings.delete(bId);
  }
  const color = seed.color;
  for (const s of involved) { st.entities.delete(s.id); st.selection.delete(s.id); }

  const cnt = (st.counters.pg = (st.counters.pg || 0) + 1);
  const poly = {
    id: 'e' + st.seq++, type: 'polygon', label: 'pg' + cnt,
    params, bound: {}, color, count: n, autoGrouped: true,
  };
  st.entities.set(poly.id, poly);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { polygon: poly, name: polygonName(n), sides: n, removed: involved.length };
}

// ---------- 变量 ----------
export function addVariable(st, name, opts = {}) {
  name = String(name).trim();
  if (!/^[A-Za-z_πθλφα-ωΑ-Ω][A-Za-z0-9_πθλφα-ωΑ-Ω]*$/.test(name)) return { error: `变量名 "${name}" 不合法` };
  if (st.variables.has(name)) return { error: `变量 "${name}" 已存在` };
  if (['x', 'y'].includes(name)) return { error: `"${name}" 是坐标轴保留名` };
  pushUndo(st);
  const v = { name, value: opts.value ?? 1, min: opts.min ?? 0, max: opts.max ?? 10, step: opts.step ?? 0, anim: false, animT: 0, animDir: 1, period: 4000 };
  st.variables.set(name, v);
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, variable: v };
}

export function setVariable(st, name, patch, { gesture = false } = {}) {
  const v = st.variables.get(name);
  if (!v) return;
  if (!gesture) pushUndo(st);
  Object.assign(v, patch);
  if (patch.value !== undefined) {
    let val = Math.min(Math.max(patch.value, v.min), v.max);
    if (v.step > 0) val = v.min + Math.round((val - v.min) / v.step) * v.step;
    v.value = val;
  }
  ensureEvaluated(st);
  emit(st);
}

// 自动动画：让变量在 [min,max] 之间三角波往返。由主循环每帧调用。
export function tickAnimations(st, dtMs) {
  let changed = false;
  for (const v of st.variables.values()) {
    if (!v.anim) continue;
    const period = Math.max(200, v.period || 4000);
    const span = v.max - v.min;
    if (!(span > 0)) continue;
    // 半个周期走完一趟（往返）
    const step = (span / (period / 2)) * dtMs * (v.animDir >= 0 ? 1 : -1);
    let next = v.value + step;
    if (next >= v.max) { next = v.max; v.animDir = -1; }
    if (next <= v.min) { next = v.min; v.animDir = 1; }
    v.value = next;
    changed = true;
  }
  if (changed) { ensureEvaluated(st); emit(st, 'change'); }
  return changed;
}

export function removeVariable(st, name) {
  if (!st.variables.has(name)) return;
  pushUndo(st);
  st.variables.delete(name);
  // 级联：引用它的绑定失效（保留但报错）——这里选择移除，保持场景健康
  for (const b of [...st.bindings.values()]) {
    if (b.sources.some((s) => s.kind === 'var' && s.name === name)) {
      const t = st.entities.get(b.target.ent);
      if (t) delete t.bound[b.target.param];
      st.bindings.delete(b.id);
    }
  }
  ensureEvaluated(st);
  emit(st, 'structure');
}

// ---------- 绑定 ----------
export function addBinding(st, entId, param, srcText, skipUndo = false) {
  const ent = st.entities.get(entId);
  if (!ent) return { error: '实体不存在' };
  const def = REGISTRY[ent.type];
  // 线段的「角度」由角度实体定义：没有相关角度实体时这个属性根本不存在
  if (param === 'angle' && ent.type === 'segment' && !jointOfLine(st, ent)) {
    return { error: '这条线还没有角度实体——先用角度工具量一个角，它才有「角度」可关联' };
  }
  const alias = writeAliasOf(ent, param);
  if (!paramsOf(ent).some((p) => p.k === param) && !alias) {
    return { error: `${ent.label} 的 ${param} 不可绑定` };
  }

  let ast;
  try { ast = parseExpression(srcText); } catch (e) { return { error: e.message }; }
  const { vars, refs } = collectRefs(ast);
  for (const v of vars) {
    // 变量，或"观察器"（只读量，同样能被表达式引用）
    if (!st.variables.has(v) && !st.probes?.has(v)) {
      return { error: `未定义的量 "${v}"——先到变量页创建它` };
    }
  }
  const sources = [...vars].map((name) => ({ kind: 'var', name }));
  for (const r of refs) {
    const target = findByLabel(st, r.ent);
    if (!target) return { error: `找不到实体 "${r.ent}"` };
    if (!isValidParam(target, r.param)) return { error: `${r.ent} 没有参数 "${r.param}"` };
    const isDer = !paramsOf(target).some((p) => p.k === r.param);
    sources.push({ kind: 'param', ent: target.id, param: r.param, derived: isDer });
  }
  if (wouldCycle(st, { ent: entId, param }, sources)) {
    return { error: `这样会绕回自己：${ent.label}.${param} ⇄ …（绑定不能成环）` };
  }
  if (!skipUndo) pushUndo(st);
  // 同参数已有绑定 → 替换
  if (ent.bound[param]) st.bindings.delete(ent.bound[param]);
  const b = { id: 'b' + st.bseq++, target: { ent: entId, param }, src: srcText.trim(), ast, sources, alias: !!alias };
  st.bindings.set(b.id, b);
  ent.bound[param] = b.id;
  ensureEvaluated(st);
  st.connFlashUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 3000;
  emit(st, 'structure');
  return { ok: true, binding: b };
}

export function removeBinding(st, bindingId) {
  const b = st.bindings.get(bindingId);
  if (!b) return;
  pushUndo(st);
  const t = st.entities.get(b.target.ent);
  if (t) delete t.bound[b.target.param];
  st.bindings.delete(bindingId);
  ensureEvaluated(st);
  emit(st, 'structure');
}

// ---------- P7 反向求解 ----------
// 拖动"被驱动的参数"时，反过来解出上游的值并写回去。
// 三档策略（与 docs/02 §6.3 一致）：
//   ① 解析反解：表达式对上游符号可线性化 → 直接解出来
//   ② 数值反解：牛顿迭代 + 多初值（挑离当前值最近的解，保证分支连续）
//   ③ 都失败 → 由调用方回退到"弹簧回弹"
export function inverseSolve(st, binding, desired, depth = 0, visited = new Set()) {
  if (!binding || depth > 4) return { ok: false, reason: 'depth' };
  if (visited.has(binding.id)) return { ok: false, reason: 'already-solved-this-round' };
  visited.add(binding.id);
  if (binding.sources.length !== 1) return { ok: false, reason: 'multi' }; // 多源无法反解
  const src = binding.sources[0];
  const base = st.scope || envNow(st);
  const tgt0 = st.entities.get(binding.target.ent);
  const entOf = (id) => st.entities.get(id);

  // 用"把源临时置为 x"的 scope 求值
  const mkScope = (x) => ({
    resolve: (n) => (src.kind === 'var' && n === src.name ? x : base.resolve(n)),
    resolveRef: (label, param) => {
      if (src.kind === 'param') {
        const e = findByLabel(st, label);
        if (e && e.id === src.ent && param === src.param) return x;
      }
      return base.resolveRef(label, param);
    },
    evalWith: (ast, xv) => evalAst(ast, { ...mkScope(x), resolve: (n) => (n === 'x' ? xv : (src.kind === 'var' && n === src.name ? x : base.resolve(n))) }),
  });

  // 当前上游值（作为牛顿迭代的起点 / 分支选择的依据）
  const currentOf = () => (src.kind === 'var'
    ? (st.variables.get(src.name)?.value ?? 0)
    : envNow(st).val(src.ent, src.param));

  const current = currentOf();
  let solved = null;
  let how = null;

  // ① 解析
  const scopeConst = { resolve: (n) => base.resolve(n), resolveRef: (l, p) => base.resolveRef(l, p) };
  const name = src.kind === 'var' ? src.name : null;
  if (name) {
    const lin = linearize(binding.ast, name, scopeConst);
    if (lin && Math.abs(lin.a) > 1e-12) {
      solved = (desired - lin.b) / lin.a;
      how = 'analytic';
    }
  }
  const probe = mkScope(Number.isFinite(current) ? current : 0);
  const f = (x) => {
    try { return evalAst(binding.ast, mkScope(x)); } catch { return NaN; }
  };
  if (solved === null || !Number.isFinite(solved)) {
    // ② 数值
    const r = numericSolve(f, desired, Number.isFinite(current) ? current : 0);
    if (r !== null) { solved = r; how = 'numeric'; }
  }
  if (solved === null || !Number.isFinite(solved)) return { ok: false, reason: 'unsolvable' };
  if (Math.abs(f(solved) - desired) > Math.max(1e-6, Math.abs(desired) * 1e-6)) {
    return { ok: false, reason: 'unsolvable' };
  }

  // 写回上游
  if (src.kind === 'var') {
    const v = st.variables.get(src.name);
    if (!v) return { ok: false, reason: 'missing-var' };
    const clampedRaw = Math.min(Math.max(solved, v.min), v.max);
    const clamped = v.step > 0 ? v.min + Math.round((clampedRaw - v.min) / v.step) * v.step : clampedRaw;
    v.value = clamped;
    ensureEvaluated(st);
    return { ok: true, how, sourceKind: 'var', name: src.name, value: clamped, outOfRange: Math.abs(clamped - solved) > 1e-9 };
  }
  // 上游是别的实体的参数
  const host = entOf(src.ent);
  if (!host) return { ok: false, reason: 'missing-ent' };
  const hostBindingId = host.bound?.[src.param];
  if (hostBindingId) {
    const inner = inverseSolve(st, st.bindings.get(hostBindingId), solved, depth + 1, visited);
    if (inner.ok) return { ok: true, how: `${how}>${inner.how}`, sourceKind: 'param-chain', name: inner.name, value: inner.value };
    return { ok: false, reason: inner.reason };
  }
  host.params[src.param] = solved;
  ensureEvaluated(st);
  return { ok: true, how, sourceKind: 'param', label: host.label, param: src.param, value: solved };
}

export function bindingsOf(st, entId) {
  return [...st.bindings.values()].filter((b) => b.target.ent === entId);
}
export function boundByCount(st, varName) {
  return [...st.bindings.values()].filter((b) => b.sources.some((s) => s.kind === 'var' && s.name === varName)).length;
}

// ---------- 重命名实例（点、线、面……一切有属性的对象）----------
// 名字是表达式里的引用标识，所以重命名必须同步改写：
//   1) 所有绑定表达式 AST 里的 ref 节点与展示用源码文本
//   2) 函数实体的表达式 AST 与源码文本
const ENTITY_NAME_RE = /^[A-Za-z_πθλφα-ωΑ-Ω][A-Za-z0-9_πθλφα-ωΑ-Ω]*$/;

function renameInAst(node, from, to) {
  if (!node || typeof node !== 'object') return node;
  if (node.k === 'ref' && node.ent === from) return { ...node, ent: to };
  if (node.k === 'bin') return { ...node, l: renameInAst(node.l, from, to), r: renameInAst(node.r, from, to) };
  if (node.k === 'neg') return { ...node, a: renameInAst(node.a, from, to) };
  if (node.k === 'call') return { ...node, args: node.args.map((a) => renameInAst(a, from, to)) };
  return node;
}
// 只替换"作为实体名的整词"（后面紧跟 . 参数名），避免误伤变量名
function renameInSource(src, from, to) {
  if (typeof src !== 'string') return src;
  const re = new RegExp(`(^|[^A-Za-z0-9_])${from}(?=\\s*\\.)`, 'g');
  return src.replace(re, (m, p1) => p1 + to);
}

export function renameEntity(st, entId, newLabel) {
  const ent = st.entities.get(entId);
  if (!ent) return { error: '实体不存在' };
  const name = String(newLabel).trim();
  if (!name) return { error: '名字不能为空' };
  if (name === ent.label) return { ok: true, label: name };
  if (!ENTITY_NAME_RE.test(name)) return { error: `"${name}" 不能作为名字（字母开头，只能用字母/数字/下划线/希腊字母）` };
  for (const e of st.entities.values()) {
    if (e.id !== entId && e.label === name) return { error: `已经有一个叫 ${name} 的图形了` };
  }
  const old = ent.label;
  pushUndo(st);
  ent.label = name;
  for (const b of st.bindings.values()) {
    if (b.sources.some((s) => s.kind === 'param' && s.ent === entId)) {
      b.ast = renameInAst(b.ast, old, name);
      b.src = renameInSource(b.src, old, name);
    }
  }
  for (const e of st.entities.values()) {
    if (e.ast) {
      e.ast = renameInAst(e.ast, old, name);
      e.exprSrc = renameInSource(e.exprSrc, old, name);
    }
  }
  ensureEvaluated(st);
  emit(st, 'structure');
  return { ok: true, label: name, from: old };
}
