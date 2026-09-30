// 实体注册表：每类实体的参数表 / 派生量 / 绘制 / 命中 / 拖拽 / 吸附特征点
// 纯模块（无 DOM）：draw 只接收传入的 2D 上下文，Node 测试可安全导入。
//
// 两套取值约定：
//   V(key)                 本实体参数值（含绑定求值）
//   env = { val(id,k), ent(id), st }
//      env.val 可读取【任意实体】的任意参数（含派生量，如 ep1.x、a1.len）
//      env.ent 用于按 id 取宿主实体（线上点、圆弧依赖宿主）
import { dist, distToSegment, distToPolyline, clamp } from './util.js';
import { collectRefs } from './expr.js';
import { lineLikeOf, intersectLines, angleBetween, angleBetweenDirs, properIntersection, raysAt, tOfIntersection, rayLength } from './lines.js';

const TAU = Math.PI * 2;
// T0：纸面/强调色统一走主题（深色宇宙为默认）——不再硬编码浅色，
// 否则选中标记的"底垫"在深色下会是一块刺眼的白斑。
import { currentTheme } from './theme.js';
const PAPER = () => currentTheme().paper;
const ACCENT = () => currentTheme().accent;
const SUBS = '₀₁₂₃₄₅₆₇₈₉';

const sub = (i) => (i >= 0 && i <= 9 ? SUBS[i] : `#${i}`);

// 把圆心角规整到 (-2π, 2π)，避免拖端点时绕圈累积
function clampSweep(sw) {
  let s = sw;
  while (s > TAU) s -= TAU;
  while (s < -TAU) s += TAU;
  return s;
}

// ---------- 通用工具 ----------

// 3 以上顶点数 → 中文名（用于提示与属性面板）
export function polygonName(n) {
  return ({ 3: '三角形', 4: '四边形', 5: '五边形', 6: '六边形', 7: '七边形', 8: '八边形' })[n] || `${n}边形`;
}

// 顶点的参数键与显示名
const vk = (i, axis) => `v${i}${axis}`;
const vname = (i, axis) => `顶点${sub(i)} ${axis}`;

// 隐函数：几何核心是 implicitGeom 的等值线 + 弧长参数化（纯模块，已被 T2 断言覆盖）。
import { buildContours } from './implicitGeom.js';

// 等值线依赖**当前视野**与表达式引用的所有值 → 按 (表达式, 依赖值, 视野, 格步) 缓存。
// 缓存放 WeakMap（跟着实体走，不进存档、不污染序列化）。
const implicitCache = new WeakMap();

// 目标：屏幕上一格 ≈ 6px → 世界格 = 6 / 缩放。这样任何缩放下分辨率稳定、开销可预期。
const IMPLICIT_PX_PER_CELL = 6;

// 依赖签名：表达式引用到的**所有量的当前值**（变量 + 实体参数）。
// collectRefs 的真实返回是 { vars: Set<string>, refs: [{ ent, param }] }（见 expr.js:144），不是集合。
function depsSignature(ent, scope) {
  if (!ent.ast || !scope) return '';
  const { vars, refs } = collectRefs(ent.ast);
  let sig = '';
  for (const name of [...vars].sort()) {
    let v = NaN;
    // x / y 是**坐标**而不是工作区量：scope.resolve 按设计会抛「未定义的量」，
    // 这正是我们想要的语义（它们不是隐函数的缓存依赖）。
    try { v = scope.resolve(name); } catch { v = NaN; }
    sig += name + ':' + (Number.isFinite(v) ? v.toFixed(9) : 'nan') + ';';
  }
  for (const r of refs) {
    let v = NaN;
    try { v = scope.resolveRef(r.ent, r.param); } catch { v = NaN; }
    sig += r.ent + '.' + r.param + ':' + (Number.isFinite(v) ? v.toFixed(9) : 'nan') + ';';
  }
  return sig;
}

// 计算/取用某隐函数实体的等值线（cam 可选：有 cam 才重建；无 cam 时只读缓存）
function contoursOf(ent, env, cam) {
  const scope = env && env.st && env.st.scope;
  if (!ent.ast || !scope) return null;
  if (!cam) { const hit0 = implicitCache.get(ent); return hit0 ? hit0.data : null; }
  const size = typeof cam.size === 'function' ? cam.size() : null;
  if (!size) return null;
  const a = cam.s2w(0, 0), b = cam.s2w(size.w, size.h);
  const padX = Math.abs(b.x - a.x) * 0.05, padY = Math.abs(b.y - a.y) * 0.05;
  const rect = {
    x0: Math.min(a.x, b.x) - padX, x1: Math.max(a.x, b.x) + padX,
    y0: Math.min(a.y, b.y) - padY, y1: Math.max(a.y, b.y) + padY,
  };
  const cell = Math.max(1e-4, IMPLICIT_PX_PER_CELL / Math.max(1e-9, Math.abs(cam.z || 1)));
  const key = [ent.expr || '', depsSignature(ent, scope), rect.x0.toFixed(5), rect.x1.toFixed(5), rect.y0.toFixed(5), rect.y1.toFixed(5), cell.toFixed(6)].join('|');
  const prev = implicitCache.get(ent);
  if (prev && prev.key === key) return prev.data;
  const data = buildContours({ ...rect, cell, F: (x, y) => { try { return scope.evalWith2(ent.ast, x, y); } catch { return NaN; } } });
  implicitCache.set(ent, { key, data });
  return data;
}

const cachedContours = (ent) => { const h = implicitCache.get(ent); return h ? h.data : null; };

// ③ 归属判定：cs 目前是单个坐标系 id；同时兼容数组形式（一个实体属于两个坐标系）。
export function isMemberOf(ent, csId) {
  if (!ent || !csId) return false;
  const cs = ent.cs;
  if (Array.isArray(cs)) return cs.includes(csId);
  return cs === csId;
}

// ② 坐标系格子的覆盖范围：由**成员图形的世界包围盒**换算到该坐标系的本地坐标。
//    （用户要求：格子默认只覆盖这个坐标系里有的图形，而不是铺满整个视口）
//    返回 null 表示没有成员 → 调用方退回一个小范围。
function memberBoxLocal(cs, env, toLocal) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (wx, wy) => {
    const [lx, ly] = toLocal(wx, wy);
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) return;
    if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
  };
  for (const e of env.st.entities.values()) {
    if (e.type === 'coordsys' || !isMemberOf(e, cs.id)) continue;
    const def = REGISTRY[e.type];
    if (def && typeof def.features === 'function') {
      let pts = [];
      try { pts = def.features((k) => env.val(e.id, k), e, env) || []; } catch { pts = []; }
      for (const q of pts) if (Array.isArray(q)) add(q[0], q[1]);
    }
    // 尺寸类参数扩边：圆/圆弧只有中心点时也要把半径算进去，否则格子会小得看不见
    const V = (k) => { try { return env.val(e.id, k); } catch { return NaN; } };
    const rad = Math.abs(V('r') || V('rad') || 0);
    if (rad > 0) { const cx = V('cx'), cy = V('cy'); add(cx + rad, cy); add(cx - rad, cy); add(cx, cy + rad); add(cx, cy - rad); }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function paramsOf(ent) {
  const def = REGISTRY[ent.type];
  if (!def) return [];
  return def.paramList ? def.paramList(ent) : (def.params || []);
}

export function derivedOf(ent, key) {
  return REGISTRY[ent.type]?.derived?.find((d) => d.k === key) || null;
}

// 多边形的面积/周长：直接由参数算出（供别名写回用）
function polyMeasure(P, ent, which) {
  const n = ent?.count || 0;
  if (n < 3) return 0;
  const pt = (i) => [P[vk(i, 'x')], P[vk(i, 'y')]];
  if (which === 'area') {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = pt(i + 1), b = pt(((i + 1) % n) + 1);
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }
  let L = 0;
  for (let i = 0; i < n; i++) {
    const a = pt(i + 1), b = pt(((i + 1) % n) + 1);
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

// 绕重心等比缩放到指定面积/周长
function polyScaleTo(P, ent, which, target) {
  const n = ent?.count || 0;
  if (n < 3 || !(target > 0)) return {};
  const cur = polyMeasure(P, ent, which);
  if (!(cur > 0)) return {};
  const k = which === 'area' ? Math.sqrt(target / cur) : target / cur;
  let cx = 0, cy = 0;
  for (let i = 1; i <= n; i++) { cx += P[vk(i, 'x')]; cy += P[vk(i, 'y')]; }
  cx /= n; cy /= n;
  const out = {};
  for (let i = 1; i <= n; i++) {
    out[vk(i, 'x')] = cx + (P[vk(i, 'x')] - cx) * k;
    out[vk(i, 'y')] = cy + (P[vk(i, 'y')] - cy) * k;
  }
  return out;
}

export function isBaseParam(ent, key) {
  return paramsOf(ent).some((p) => p.k === key);
}

// 可写别名（如 线段.角度 / 线段.长度 / 圆.直径）：既是"可读的派生量"，
// 又能作为绑定的【目标】——绑定时把值翻译回底层参数写回去。
export function writeAliasOf(ent, key) {
  return REGISTRY[ent.type]?.writeAliases?.[key] || null;
}

// 关联向导要列出的"可绑定目标"＝基础参数 + 可写别名
// 这条线"相关"的角度实体（引用它的 joint）：没有就说明这条线没有角度量
export function jointOfLine(st, ent) {
  if (!st || !ent) return null;
  for (const e of st.entities.values()) {
    if (e.type !== 'joint') continue;
    if (e.a === ent.id || e.b === ent.id) return e;
  }
  return null;
}

// 线的"角度量"＝相关角度实体的实时夹角（不再是中心点方向角）
//   返回 { joint, deg, X, other } —— other 是另一条线，X 是交点
export function lineAngleInfo(st, ent) {
  const j = jointOfLine(st, ent);
  if (!j || !st.env) return null;
  const R = jointRays(j, st.env);
  if (!R) return null;
  const otherId = j.a === ent.id ? j.b : j.a;
  return { joint: j, deg: R.deg, X: R.X, other: st.entities.get(otherId) || null };
}

// 驱动线的某一端是否绑在某个"点实体"上（线段.x2 ← ep.x、线段.y2 ← ep.y 这种）
function attachedPointOf(ent, env) {
  const st = env?.st;
  if (!st || ent.type !== 'segment') return null;
  for (const end of ['p1', 'p2']) {
    const kx = end === 'p1' ? 'x1' : 'x2';
    const ky = end === 'p1' ? 'y1' : 'y2';
    const bx = ent.bound?.[kx] ? st.bindings.get(ent.bound[kx]) : null;
    const by = ent.bound?.[ky] ? st.bindings.get(ent.bound[ky]) : null;
    if (!bx || !by) continue;
    const ids = (b) => (b.sources || []).filter((s) => s.kind === 'param').map((s) => s.ent);
    const a = ids(bx), b = ids(by);
    if (a.length === 1 && b.length === 1 && a[0] === b[0]) {
      const pt = st.entities.get(a[0]);
      if (pt && (pt.type === 'point' || pt.type === 'edgepoint')) return { point: pt, whichEnd: end, otherEnd: end === 'p1' ? 'p2' : 'p1' };
    }
  }
  return null;
}

// 这条线"取哪一侧"的基准信息（与 joint 的 sa/sb 约定一致）
function selfRayInfo(ent, env) {
  const st = env?.st;
  const info = lineAngleInfo(st, ent);
  if (!info?.X) return null;
  const j = info.joint;
  const selfIsA = j.a === ent.id;
  const sa = Number(env.val(j.id, 'sa')) || 1;
  const sb = Number(env.val(j.id, 'sb')) || 1;
  const other = env.ent(selfIsA ? j.b : j.a);
  const otherLine = other ? lineLikeOf(other, st.env) : null;
  if (!otherLine) return null;
  const mul = (d, s) => [d[0] * (s >= 0 ? 1 : -1), d[1] * (s >= 0 ? 1 : -1)];
  const baseRay = unit(mul(otherLine.d, selfIsA ? sb : sa));
  if (!baseRay) return null;
  return { j, X: info.X, baseRay, selfSide: selfIsA ? sa : sb };
}

// 给定"这条线的原始方向"，joint 会量到多少度
function measuredDeg(info, rawDir) {
  const s = info.selfSide >= 0 ? 1 : -1;
  const selfRay = unit([rawDir[0] * s, rawDir[1] * s]);
  return selfRay ? angleBetweenDirs(info.baseRay, selfRay) : NaN;
}

// 一维数值求根（割线法 + 多起点；周期性宿主换种子），返回解或 null
function solveParam1D(errAt, t0, periodic) {
  const wrap = (v) => (periodic ? ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : v);
  if (Math.abs(errAt(t0)) < 1e-7) return t0;
  const seeds = periodic
    ? [t0, t0 + Math.PI / 2, t0 - Math.PI / 2, t0 + Math.PI, 0, Math.PI]
    : [t0, t0 + 0.1, t0 - 0.1, 0, 1];
  let best = null, bestScore = Infinity, bestDist = Infinity;
  for (const s0 of seeds) {
    let a = wrap(s0), fa = errAt(a), b = wrap(a + (periodic ? 0.15 : 0.05)), fb = errAt(b);
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
    for (let i = 0; i < 60; i++) {
      if (Math.abs(fb) < 1e-10) break;
      const den = fb - fa;
      if (Math.abs(den) < 1e-14) break;
      const c = wrap(b - (fb * (b - a)) / den);
      const fc = errAt(c);
      if (!Number.isFinite(fc)) break;
      a = b; fa = fb; b = c; fb = fc;
    }
    const score = Math.abs(fb);
    if (score > 1e-4) continue;
    // 多个解（例如圆上有两个方向都能给出同一个夹角）→ 取**离当前值最近**的那个，
    // 这样拖滑杆时是"就近滑过去"，不会突然跳到对面。
    const dist = periodic ? Math.abs(((b - t0 + Math.PI) % (2 * Math.PI)) - Math.PI) : Math.abs(b - t0);
    if (score < bestScore - 1e-9 || (score < 1e-4 && dist < bestDist)) { bestScore = score; bestDist = dist; best = b; }
  }
  return best;
}

// 若线端绑在一个点上 → 驱动**那个点**（它才是这条链上真正自由的量）
function realizeViaAttachedPoint(ent, env, target, info) {
  const att = attachedPointOf(ent, env);
  if (!att) return null;
  const pt = att.point;
  const okey = att.otherEnd === 'p1' ? ['x1', 'y1'] : ['x2', 'y2'];
  const O = [env.val(ent.id, okey[0]), env.val(ent.id, okey[1])];
  if (!O.every(Number.isFinite)) return {};

  if (pt.type === 'point') {
    if (pt.bound?.x || pt.bound?.y) return {};          // 点自己也被钉住：本轮不动
    const cur = [env.val(pt.id, 'x'), env.val(pt.id, 'y')];
    const dist = Math.hypot(cur[0] - O[0], cur[1] - O[1]);
    const s = info.selfSide >= 0 ? 1 : -1;
    const th = (target * Math.PI) / 180;
    const ray = [
      info.baseRay[0] * Math.cos(s * th) - info.baseRay[1] * Math.sin(s * th),
      info.baseRay[0] * Math.sin(s * th) + info.baseRay[1] * Math.cos(s * th),
    ];
    const raw = [ray[0] * s, ray[1] * s];
    const sgn = (raw[0] * (cur[0] - O[0]) + raw[1] * (cur[1] - O[1])) >= 0 ? 1 : -1;
    return { __ent: pt.id, x: O[0] + raw[0] * dist * sgn, y: O[1] + raw[1] * dist * sgn };
  }

  // 线上点：解它的参数 t（圆上就是角度、线段上就是比例、函数上就是横坐标）
  const host = env.ent(pt.host);
  if (!host) return {};
  const t0 = env.val(pt.id, 't');
  if (!Number.isFinite(t0)) return {};
  const errAt = (t) => {
    const P = pointOnHost(host, env, t);
    if (!P || !P.every(Number.isFinite)) return NaN;
    const d = [P[0] - O[0], P[1] - O[1]];
    if (Math.hypot(d[0], d[1]) < 1e-9) return NaN;
    return measuredDeg(info, d) - target;
  };
  const periodic = host.type === 'circle' || host.type === 'arcfree';
  const solved = solveParam1D(errAt, t0, periodic);
  if (solved === null) return {};                        // 解不出来 → 不动，避免乱转
  return { __ent: pt.id, t: solved };
}

// 让【这条线】绕当初那个交点旋转到与另一条线成 target 度。
// 0° 是合法角度（与基准线平行）。
// 顺序：① 线端绑在点上 → 驱动那个点（线上点解 t / 自由点摆位置）；② 两端自由 → 刚性绝对摆放；③ 都不行 → 不动
function rotateLineAboutJoint(ent, env, target) {
  const info = selfRayInfo(ent, env);
  if (!info) return {};
  // 越界（<0 或 >180）**不写几何**：以前钳到 0/180 会把线段按到与基准线平行，
  // 而平行时又没有交点 → 整条链断掉 → 再也转不回来。
  const raw = Number(target);
  if (!Number.isFinite(raw) || raw < 0 || raw > 180) return {};
  const tgt = raw;
  const viaPoint = realizeViaAttachedPoint(ent, env, tgt, info);
  if (viaPoint !== null) return viaPoint;
  return rigidPlaceAboutJoint(ent, env, tgt, info);
}

// 刚性摆放（两端都自由时）：保持各端到交点的带符号距离，把整条线摆到目标方向上。
// 用绝对方向而不是"再转一个增量"，所以是幂等的，不会每帧追。
function rigidPlaceAboutJoint(ent, env, target, info) {
  const st = env.st;
  if (ent.type !== 'segment') return {};
  const la = lineLikeOf(ent, st.env);
  if (!la) return {};
  const dirSelf = unit(la.d);
  if (!dirSelf) return {};
  const s = info.selfSide >= 0 ? 1 : -1;
  const selfRay = unit([dirSelf[0] * s, dirSelf[1] * s]);
  const side = (info.baseRay[0] * selfRay[1] - info.baseRay[1] * selfRay[0]) >= 0 ? 1 : -1;
  const th = (target * Math.PI) / 180;
  const ray = [
    info.baseRay[0] * Math.cos(side * th) - info.baseRay[1] * Math.sin(side * th),
    info.baseRay[0] * Math.sin(side * th) + info.baseRay[1] * Math.cos(side * th),
  ];
  const free = (k) => !ent.bound?.[k];
  if (!(free('x1') && free('y1')) || !(free('x2') && free('y2'))) return {};
  const p1 = [env.val(ent.id, 'x1'), env.val(ent.id, 'y1')];
  const p2 = [env.val(ent.id, 'x2'), env.val(ent.id, 'y2')];
  if (![...p1, ...p2].every(Number.isFinite)) return {};
  const raw = [ray[0] * s, ray[1] * s];
  const u = dirSelf;
  const s1 = (p1[0] - info.X.x) * u[0] + (p1[1] - info.X.y) * u[1];
  const s2 = (p2[0] - info.X.x) * u[0] + (p2[1] - info.X.y) * u[1];
  return {
    x1: info.X.x + raw[0] * s1, y1: info.X.y + raw[1] * s1,
    x2: info.X.x + raw[0] * s2, y2: info.X.y + raw[1] * s2,
  };
}

// 关联向导要列出的"可绑定目标"＝基础参数 + 可写别名。
// ① 线段的「角度」只在这条线**有相关角度实体**时才存在（否则这个属性就被取消掉）。
// 按"假设这条线的端点是 P"来算它与另一条线的夹角（反解要用，否则会读到旧角度）
function lineAngleFromParams(P, ent, env) {
  const st = env?.st;
  const info = lineAngleInfo(st, ent);
  if (!info || !P) return NaN;
  const j = info.joint;
  const sa = Number(env.val(j.id, 'sa')) || 1;
  const sb = Number(env.val(j.id, 'sb')) || 1;
  const selfIsA = (j.a === ent.id);
  const mul = (d, s) => [d[0] * (s >= 0 ? 1 : -1), d[1] * (s >= 0 ? 1 : -1)];
  const selfDir = unit([P.x2 - P.x1, P.y2 - P.y1]);
  const otherLine = lineLikeOf(env.ent(info.other.id), st.env);
  if (!selfDir || !otherLine) return NaN;
  return angleBetweenDirs(mul(selfDir, selfIsA ? sa : sb), mul(unit(otherLine.d), selfIsA ? sb : sa));
}

export function bindableParamsOf(ent, st) {
  const out = paramsOf(ent).map((p) => ({ ...p, alias: false }));
  const wa = REGISTRY[ent.type]?.writeAliases || {};
  const hasJoint = st ? !!jointOfLine(st, ent) : true;   // 不带 st 时保持旧行为（内部调用）
  for (const [k, a] of Object.entries(wa)) {
    if (k === 'angle' && !hasJoint) continue;
    out.push({ k, name: a.name, alias: true });
  }
  return out;
}

// 可作为表达式来源：基础参数或派生量
export function isValidParam(ent, key) {
  return isBaseParam(ent, key) || !!derivedOf(ent, key);
}

// 哪些实体可以把"线上点"钉在自己身上（点本身不能再挂点）
// implicit 也在列：隐函数的 t 是弧长参数，pointOnHost/projectOnHost 已按其语义实现（T2 的 implicitGeom），
// 因此线上点、裁切段（curvepiece 只依赖 samplePiece→pointOnHost）都能直接用在隐函数上。
export const HOSTABLE = ['segment', 'circle', 'arc', 'arcfree', 'polygon', 'sine', 'parabola', 'func', 'freehand', 'implicit'];
export function canHostPoint(ent) {
  return !!ent && HOSTABLE.includes(ent.type);
}

// 拖拽处理：支持静态表（drag.p1）与动态表（dynDrag，顶点数量不定时使用）
export function dragHandler(def, part, ent) {
  if (!def) return null;
  if (def.drag && def.drag[part]) return def.drag[part];
  if (def.dynDrag) return def.dynDrag(part, ent);
  return null;
}

// 多边形顶点坐标
function vertexAt(ent, env, i) {
  return [env.val(ent.id, vk(i, 'x')), env.val(ent.id, vk(i, 'y'))];
}
function polygonEdges(ent, env) {
  const n = ent.count || 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push([vertexAt(ent, env, i + 1), vertexAt(ent, env, ((i + 1) % n) + 1)]);
  return out;
}

// ---------- 宿主几何：线上点 / 圆弧 依赖宿主实体求位置 ----------

// t → 世界坐标（各宿主类型对 t 的语义见下方注释）
export function pointOnHost(host, env, t) {
  const V = (k) => env.val(host.id, k);
  switch (host.type) {
    case 'segment': {
      const x1 = V('x1'), y1 = V('y1'), dx = V('x2') - x1, dy = V('y2') - y1;
      return [x1 + t * dx, y1 + t * dy];
    }
    case 'circle': {
      const cx = V('cx'), cy = V('cy'), r = V('r');
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    }
    case 'arc':
    case 'arcfree': {   // 自由圆弧与圆弧共用同一套 t 语义（t∈[0,1] → start + t·sweep）
      const cx = V('cx'), cy = V('cy'), r = V('r'), a = V('start') + t * V('sweep');
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    case 'polygon': {
      const n = host.count || 0;
      if (n < 2) return [NaN, NaN];
      let i = Math.floor(t), f = t - i;
      i = ((i % n) + n) % n;
      const a = vertexAt(host, env, i + 1), b = vertexAt(host, env, ((i + 1) % n) + 1);
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    case 'implicit': {
      // t 是**弧长参数**（T2 的 implicitGeom 约定 t∈[0,1]）；没有几何时（本帧尚未绘制）无从给出点。
      const c = cachedContours(host);
      if (!c) return [NaN, NaN];
      const pt = c.pointAt(t);
      return pt ? [pt.x, pt.y] : [NaN, NaN];
    }
    case 'sine': return [t, REGISTRY.sine.yAt(V, t)];
    case 'parabola': return [t, REGISTRY.parabola.yAt(V, t)];
    case 'func': {
      try { return [t, env.st.scope.evalWith(host.ast, t)]; } catch { return [t, NaN]; }
    }
    case 'freehand': {
      const pts = host.pts || [];
      if (pts.length < 2) return [NaN, NaN];
      const f = clamp(t, 0, 1) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(f)), fr = f - i;
      return [pts[i][0] + fr * (pts[i + 1][0] - pts[i][0]), pts[i][1] + fr * (pts[i + 1][1] - pts[i][1])];
    }
    default: return [NaN, NaN];
  }
}

// 世界坐标 → t（pointOnHost 的逆，用于把点击/拖拽投影到宿主上）
// lockEdge：仅多边形宿主使用。给了边序号则只能在该边内滑动（默认行为），
//           为 null 则允许在最近的一条边上自由"绕行"到别的边。
export function projectOnHost(host, env, pt, lockEdge = null) {
  const V = (k) => env.val(host.id, k);
  switch (host.type) {
    case 'segment': {
      const x1 = V('x1'), y1 = V('y1'), dx = V('x2') - x1, dy = V('y2') - y1;
      const len2 = dx * dx + dy * dy;
      return len2 < 1e-12 ? 0 : clamp(((pt.x - x1) * dx + (pt.y - y1) * dy) / len2, 0, 1);
    }
    case 'circle': {
      // 取 (-π, π]，两点间的"较短弧"由圆弧实体负责
      return Math.atan2(pt.y - V('cy'), pt.x - V('cx'));
    }
    case 'arc':
    case 'arcfree': {   // 自由圆弧与圆弧共用同一套 t 语义（t∈[0,1] → start + t·sweep）
      const cx = V('cx'), cy = V('cy'), a = Math.atan2(pt.y - cy, pt.x - cx);
      const sweep = V('sweep');
      if (Math.abs(sweep) < 1e-12) return 0;
      let d = sweep > 0 ? (a - V('start')) : (V('start') - a);
      d = ((d % TAU) + TAU) % TAU;
      return clamp(d / Math.abs(sweep), 0, 1);
    }
    case 'polygon': {
      const n = host.count || 0;
      const fracOn = (i) => {
        const a = vertexAt(host, env, i + 1), b = vertexAt(host, env, ((i + 1) % n) + 1);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const f = len2 < 1e-12 ? 0 : clamp(((pt.x - a[0]) * dx + (pt.y - a[1]) * dy) / len2, 0, 1);
        const d = Math.hypot(pt.x - (a[0] + f * dx), pt.y - (a[1] + f * dy));
        return { f, d };
      };
      if (lockEdge != null) {
        const i = ((Math.round(lockEdge) % n) + n) % n;
        // 上界留出余量：t = i+1 会被解释成下一条边
        return i + Math.min(fracOn(i).f, 0.9999);
      }
      let best = { t: 0, d: Infinity };
      for (let i = 0; i < n; i++) {
        const { f, d } = fracOn(i);
        if (d < best.d) best = { t: i + f, d };
      }
      return Math.min(best.t, n - 0.0001);
    }
    case 'implicit': {
      // 与 freehand 同一约定：t∈[0,1] 沿曲线；多分量时落到**最近的那个分量**（T2 已断言）。
      const c = cachedContours(host);
      if (!c) return 0;
      const r = c.project(pt.x, pt.y);
      return r ? r.t : 0;
    }
    case 'sine': case 'parabola': case 'func':
      return pt.x; // t 即横坐标
    case 'freehand': {
      const pts = host.pts || [];
      if (pts.length < 2) return 0;
      let best = { t: 0, d: Infinity };
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
        const len2 = dx * dx + dy * dy;
        const f = len2 < 1e-12 ? 0 : clamp(((pt.x - pts[i][0]) * dx + (pt.y - pts[i][1]) * dy) / len2, 0, 1);
        const d = Math.hypot(pt.x - (pts[i][0] + f * dx), pt.y - (pts[i][1] + f * dy));
        if (d < best.d) best = { t: (i + f) / (pts.length - 1), d };
      }
      return best.t;
    }
    default: return 0;
  }
}

// 线上点的 t 修正：锁定在所属边内（roam=false 且宿主是多边形时）
export function lockEdgeOf(ent) {
  if (!ent || ent.type !== 'edgepoint') return null;
  if (ent.roam) return null;
  return ent.edge == null ? null : ent.edge;
}

// 锁定模式下把 t 夹在所属边内（t = edge + f，f 必须 < 1，否则会被解释成下一条边）
function clampT(ent, env, t) {
  const edge = lockEdgeOf(ent);
  if (edge == null || !Number.isFinite(t)) return t;
  return edge + Math.min(Math.max(t - edge, 0), 0.9999);
}

// 沿宿主从 t1 到 t2 采样（用于"裁切段"的绘制/命中）
// n 可给固定值；绘制时用 pieceSampleCount() 按屏幕长度自适应，保证大图/缩小都不失真。
export function samplePiece(host, env, t1, t2, n = 64) {
  const out = [];
  if (!host || !Number.isFinite(t1) || !Number.isFinite(t2)) return out;
  const N = Math.max(2, Math.min(8000, Math.round(n)));
  for (let i = 0; i <= N; i++) {
    const t = t1 + (t2 - t1) * (i / N);
    const p = pointOnHost(host, env, t);
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push(p);
  }
  return out;
}

// 按屏幕长度决定裁切段要采多少点（约每 1.2 像素一个点）
export function pieceSampleCount(host, env, t1, t2, cam) {
  if (!cam || !Number.isFinite(t1) || !Number.isFinite(t2)) return 128;
  const probe = samplePiece(host, env, t1, t2, 24); // 粗采一遍量屏幕长度（已是全程）
  let px = 0;
  for (let i = 1; i < probe.length; i++) {
    const a = cam.w2s(probe[i - 1][0], probe[i - 1][1]);
    const b = cam.w2s(probe[i][0], probe[i][1]);
    px += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return Math.max(48, Math.min(6000, Math.ceil((px || 1) / 1.2) + 16));
}

// 宿主上 t 处的切线方向（用于线上点的手柄朝向，可选）
export function normalOnHost(host, env, t) {
  const V = (k) => env.val(host.id, k);
  switch (host.type) {
    case 'segment': { const dx = V('x2') - V('x1'), dy = V('y2') - V('y1'); const L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; }
    case 'circle': { const a = t; return [Math.cos(a), Math.sin(a)]; }
    case 'arc': { const a = V('start') + t * V('sweep'); return [Math.cos(a), Math.sin(a)]; }
    default: return [0, 0];
  }
}

// 圆弧几何：宿主圆 + 两个线上点决定；取两点的较短弧（|sweep| ≤ π）
export function arcGeom(ent, env) {
  const host = env.ent(ent.host);
  if (!host || ent.p1 == null || ent.p2 == null) return null;
  const cx = env.val(host.id, 'cx'), cy = env.val(host.id, 'cy'), r = env.val(host.id, 'r');
  const t1 = env.val(ent.p1, 't'), t2 = env.val(ent.p2, 't');
  let d = ((t2 - t1) % TAU + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return { cx, cy, r, start: t1, sweep: d, host };
}

// ---------- 绘制小工具 ----------

// 顶点/端点手柄：纸色底垫 + 实体色圆点，保证在任何背景上清晰可见
function handle(g, sx, sy, color, radius = 4.2) {
  g.beginPath(); g.arc(sx, sy, radius + 1.8, 0, 7); g.fillStyle = PAPER(); g.fill();
  g.beginPath(); g.arc(sx, sy, radius, 0, 7); g.fillStyle = color; g.fill();
}

// ---------- 实体注册表 ----------
// 交点／夹角（①角度工具 ④交点悬停 ⑨双击接点绑定 三处共用同一套数学）
// 引用两条"直线型"实体（线段/圆的直径/切线/割线），派生交点和夹角。
export const JOINT_DEF = {
  label: '交点', prefix: 'j',
  params: [
    { k: 'r', name: '角符号半径' },
    { k: 'sa', name: 'A 侧 +1/−1' },
    { k: 'sb', name: 'B 侧 +1/−1' },
  ],
  derived: [
    { k: 'ix', name: '交点 x', compute: (V, ent, env) => (jointGeom(ent, env)?.X.x ?? NaN) },
    { k: 'iy', name: '交点 y', compute: (V, ent, env) => (jointGeom(ent, env)?.X.y ?? NaN) },
    { k: 'deg', name: '夹角°', compute: (V, ent, env) => {
      const R = jointRays(ent, env);
      return R ? R.deg : NaN;
    } },
    { k: 'rad', name: '夹角弧度', compute: (V, ent, env) => {
      const R = jointRays(ent, env);
      return R ? (R.deg * Math.PI) / 180 : NaN;
    } },
  ],
  create: () => ({ r: 1.4, sa: 1, sb: 1 }),
  anchor: (V, ent, env) => { const g = jointGeom(ent, env); return g ? [g.X.x, g.X.y] : [0, 0]; },
  features: (V, ent, env) => { const g = jointGeom(ent, env); return g ? [[g.X.x, g.X.y]] : []; },
  draw(g, ent, V, cam, env) {
    const R = jointArcOf(ent, env, cam);
    if (!R) return;                      // 没有真实相交 → 不画（延长线相交不算角）
    const { X, dirA, dirB, deg } = R;
    const r = R.rEff;                    // ★ 半径随两侧线长自适应：线短也不会让弧伸出线外
    const [cx, cy] = cam.w2s(X.x, X.y);
    const rr = r * cam.z;
    const color = g.strokeStyle;
    g.save();
    g.lineWidth = 2;
    // canvas 的 y 朝下 → 世界角取负
    const a0 = -Math.atan2(dirA[1], dirA[0]);
    const a1 = -Math.atan2(dirB[1], dirB[0]);
    let sweep = a1 - a0;                 // 取"较近的那一侧"——这正是夹角本身（≤180°）
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    if (deg < 0.5 || R.degenerate) {
      // 0°（两条线重合方向）：画不出弧，用**交点处的小三角形**表示这里有个 0° 角
      const t = Math.max(0.18, rr / cam.z);
      const along = [1, 0];                       // 沿基准线方向
      const perp = [-along[1], along[0]];
      const tip = [cx + (along[0] * 0.6 + perp[0] * 0.0) * t * cam.z, cy - (along[1] * 0.6 + perp[1] * 0.0) * t * cam.z];
      const b1 = [cx + (along[0] * 0.1 + perp[0] * 0.45) * t * cam.z, cy - (along[1] * 0.1 + perp[1] * 0.45) * t * cam.z];
      const b2 = [cx + (along[0] * 0.1 - perp[0] * 0.45) * t * cam.z, cy - (along[1] * 0.1 - perp[1] * 0.45) * t * cam.z];
      g.beginPath();
      g.moveTo(tip[0], tip[1]);
      g.lineTo(b1[0], b1[1]);
      g.lineTo(b2[0], b2[1]);
      g.closePath();
      g.stroke();
    } else if (Math.abs(deg - 90) < 0.5) {
      // 直角：画小方块，两条边分别沿两条射线
      const p = (d, mix) => [cx + (dirA[0] * mix + d * dirB[0] * (1 - mix)) * rr * 1, cy - (dirA[1] * mix + d * dirB[1] * (1 - mix)) * rr * 1];
      g.beginPath();
      g.moveTo(p(1, 1)[0], p(1, 1)[1]);
      g.lineTo(cx + (dirA[0] + dirB[0]) * rr, cy - (dirA[1] + dirB[1]) * rr);
      g.lineTo(cx + dirB[0] * rr, cy - dirB[1] * rr);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(cx, cy, rr, sweep >= 0 ? a0 : a0 + sweep, sweep >= 0 ? a0 + sweep : a0);
      g.stroke();
      // 记录实际画出的弧（供核验：弧心/半径/起止角），确认它落在"该在的那个象限"
      const midA = a0 + sweep / 2;
      ent._arc = { cx, cy, rr, a0, sweep, midX: cx + rr * Math.cos(midA), midY: cy + rr * Math.sin(midA) };
    }
    // 度数的落点：两条射线的角平分线方向（一定在角的内部，不会跑到背面）
    let bx = dirA[0] + dirB[0], by = dirA[1] + dirB[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) { bx = -dirA[1]; by = dirA[0]; } else { bx /= bl; by /= bl; }
    const lx = cx + bx * (rr + 14);
    const ly = cy - by * (rr + 14);
    const txt = `${deg.toFixed(deg < 10 ? 2 : 1)}°`;
    g.font = '12px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = PAPER();
    const w = g.measureText(txt).width + 8;
    g.fillRect(lx - w / 2, ly - 8, w, 16);
    g.fillStyle = color;
    g.fillText(txt, lx, ly);
    g.restore();
  },
  // Only the drawn arc (or the right-angle mark) counts as a hit: no more "big disc at
  // the vertex" swallowing clicks meant for the two lines next to it.
  hit(V, pt, tol, ent, cam, env) {
    const A = jointArcOf(ent, env, cam);
    if (!A) return null;
    const d = dist(pt.x, pt.y, A.X.x, A.X.y);
    return Math.abs(d - A.rEff) < Math.max(tol * 1.6, 0.14) ? { part: 'body' } : null;
  },
  drag: { body: null },
  translate: null,
  // 夹角可直接关联：关联后【绕交点旋转 B 那条线】来满足角度（A 不动）
  // 角度实体的角度量**不可关联**（它只作为"读数"来源）；
  // 要驱动旋转，请关联【那条线】的「角度」——那会绕这个交点转。
};

// 角弧的"实际半径"：
//   · 不能超过两侧可用长度的 45%，否则线短的那一边会碰不到弧
//   · 也不能太小：屏幕上至少 ~20px，且不至于缩成一个点
export function jointArcOf(ent, env, cam) {
  const R = jointRays(ent, env);
  if (!R) return null;
  const want = Math.max(0.15, Number(env.val(ent.id, 'r')) || 1.4);
  const ta = tOfIntersection(R.la, R.X), tb = tOfIntersection(R.lb, R.X);
  const sa = Number(env.val(ent.id, 'sa')) || 1;
  const sb = Number(env.val(ent.id, 'sb')) || 1;
  const lenA = rayLength(R.la, ta, sa), lenB = rayLength(R.lb, tb, sb);
  const capByLines = 0.45 * Math.max(1e-6, Math.min(lenA || Infinity, lenB || Infinity));
  const floor = cam ? 22 / Math.max(4, cam.z) : 0.3;
  const rEff = Math.max(Math.min(want, capByLines), Math.min(floor, capByLines));
  return { ...R, rEff, lenA, lenB };
}

// 交点的几何：两条直线 + 交点。
// ★ 平行/无真实交点时**不再断链**：沿用"上一次的有效交点"（记在实体上），
//   并把角度视为 0°（或 180°）。这样"拖到边界又拖回来"不会把线永久卡死。
export function jointGeom(ent, env) {
  if (!ent?.a || !ent?.b || !env) return null;
  const ea = env.ent(ent.a), eb = env.ent(ent.b);
  if (!ea || !eb) return null;
  const la = lineLikeOf(ea, env), lb = lineLikeOf(eb, env);
  if (!la || !lb) return null;
  const X = properIntersection(la, lb, 0.03);
  if (X) {
    ent.lastX = X.x; ent.lastY = X.y;          // 记下有效交点，供平行时退化使用
    return { la, lb, X, degenerate: false };
  }
  if (Number.isFinite(ent.lastX) && Number.isFinite(ent.lastY)) {
    return { la, lb, X: { x: ent.lastX, y: ent.lastY }, degenerate: true };
  }
  return null;
}

// 交点 + 两条射线的方向 + 夹角。
// 退化（平行）时：夹角＝0，射线取"驱动线指向基准线投影"的那一侧。
export function jointRays(ent, env) {
  const g0 = jointGeom(ent, env);
  if (!g0) return null;
  const sa = Number(env.val(ent.id, 'sa')) || 1;
  const sb = Number(env.val(ent.id, 'sb')) || 1;
  const R = raysAt(g0.X, g0.la, g0.lb, sa, sb);
  if (!R) return null;
  // 退化（平行）时按"两条射线同向还是反向"区分：同向 = 0°，反向 = 180°
  const deg = g0.degenerate
    ? ((R.a[0] * R.b[0] + R.a[1] * R.b[1]) >= 0 ? 0 : 180)
    : angleBetweenDirs(R.a, R.b);
  return { X: g0.X, la: g0.la, lb: g0.lb, dirA: R.a, dirB: R.b, deg, degenerate: g0.degenerate };
}

// 绕交点把 B 线转到与 A 成 target 度（只对"线段"型 B 生效：整条线段绕交点刚性旋转）
// 做法：算出 B 应该指向的方向（保持当前所在的那一侧），再把 B 的端点绕交点转过去。
function rotateBTo(ent, env, target) {
  const g0 = jointGeom(ent, env);
  if (!g0) return {};
  const eb = env.ent(ent.b);
  if (!eb || eb.type !== 'segment') return {};   // 圆/切线/割线的方向不是自由参数，暂不支持
  const sa = env.val(ent.id, 'sa') || 1;
  const dirA = unit([g0.la.d[0] * sa, g0.la.d[1] * sa]);
  const dirB = unit(g0.lb.d);
  if (!dirA || !dirB) return {};
  if (!Number.isFinite(target) || target <= 0) return {};
  const side = (dirA[0] * dirB[1] - dirA[1] * dirB[0]) >= 0 ? 1 : -1;   // 保持当前所在的那一侧
  const th = (Math.min(180, target) * Math.PI) / 180;
  const wantAng = Math.atan2(dirA[0] * Math.sin(side * th) + dirA[1] * Math.cos(side * th),
    dirA[0] * Math.cos(side * th) - dirA[1] * Math.sin(side * th));
  let d = wantAng - Math.atan2(dirB[1], dirB[0]);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const [X, Y] = [g0.X.x, g0.X.y];
  const rot = (px, py) => {
    const dx = px - X, dy = py - Y;
    return [X + dx * Math.cos(d) - dy * Math.sin(d), Y + dx * Math.sin(d) + dy * Math.cos(d)];
  };
  const [nx1, ny1] = rot(env.val(eb.id, 'x1'), env.val(eb.id, 'y1'));
  const [nx2, ny2] = rot(env.val(eb.id, 'x2'), env.val(eb.id, 'y2'));
  return { __ent: eb.id, x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}
function unit(v) {
  const L = Math.hypot(v[0], v[1]);
  return L > 1e-12 ? [v[0] / L, v[1] / L] : null;
}

export const REGISTRY = {
  point: {
    label: '点', prefix: 'p',
    params: [{ k: 'x', name: 'x' }, { k: 'y', name: 'y' }],
    derived: [],
    create: (at) => ({ x: at.x, y: at.y }),
    anchor: (V) => [V('x'), V('y')],
    features: (V) => [[V('x'), V('y')]],
    draw(g, ent, V, cam, env) {
      const [sx, sy] = cam.w2s(V('x'), V('y'));
      const color = g.strokeStyle;
      // 纸色大底垫：把网格和曲线压住，点才"跳"得出来
      g.beginPath(); g.arc(sx, sy, 7, 0, 7); g.fillStyle = PAPER(); g.fill();
      g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fillStyle = color; g.fill();
      g.lineWidth = 1.2; g.strokeStyle = '#FFFFFF'; g.stroke();
      if (env.selected || env.hover) {
        g.lineWidth = 2; g.strokeStyle = PAPER();
        g.beginPath(); g.arc(sx, sy, 10, 0, 7); g.stroke();
      }
    },
    hit: (V, pt, tol) => (dist(pt.x, pt.y, V('x'), V('y')) < Math.max(tol * 1.8, 0.16) ? { part: 'body' } : null),
    drag: { body: (S, cur) => ({ x: cur.x, y: cur.y }) },
    translate: (P, dx, dy) => ({ x: P.x + dx, y: P.y + dy }),
  },

  // 线上点：被"钉"在某个实体的边/曲线上，只能沿它滑动。
  // 参数 t 的含义按宿主而定：线段 [0,1]；圆/圆弧 弧度；多边形 边序号+边内比例；函数 横坐标；自由曲线 [0,1]
  // edge/roam：多边形宿主专用——默认锁在自己所属的那条边上（roam=false），可在关联选项里打开"允许绕行"。
  edgepoint: {
    label: '线上点', prefix: 'ep',
    params: [{ k: 't', name: '位置 t' }],
    derived: [
      { k: 'x', name: 'x', compute: (V, ent, env) => pointOnHost(env.ent(ent.host), env, clampT(ent, env, V('t')))[0] },
      { k: 'y', name: 'y', compute: (V, ent, env) => pointOnHost(env.ent(ent.host), env, clampT(ent, env, V('t')))[1] },
    ],
    create: () => ({ t: 0 }),
    anchor: (V, ent, env) => pointOnHost(env.ent(ent.host), env, clampT(ent, env, V('t'))),
    features: (V, ent, env) => [pointOnHost(env.ent(ent.host), env, clampT(ent, env, V('t')))],
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!host) return;
      const [wx, wy] = pointOnHost(host, env, clampT(ent, env, V('t')));
      const [sx, sy] = cam.w2s(wx, wy);
      const color = g.strokeStyle;
      g.beginPath(); g.arc(sx, sy, 7.5, 0, 7); g.fillStyle = PAPER(); g.fill();   // 底垫
      g.lineWidth = 2.6; g.strokeStyle = color;
      g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.stroke();                        // 空心环＝"贴着线"
      g.beginPath(); g.arc(sx, sy, 1.7, 0, 7); g.fillStyle = color; g.fill();
      if (env.selected || env.hover) {
        g.lineWidth = 2; g.strokeStyle = PAPER();
        g.beginPath(); g.arc(sx, sy, 10.5, 0, 7); g.stroke();
      }
    },
    hit(V, pt, tol, ent, cam, env) {
      const host = env.ent(ent.host);
      if (!host) return null;
      const [wx, wy] = pointOnHost(host, env, clampT(ent, env, V('t')));
      return dist(pt.x, pt.y, wx, wy) < Math.max(tol * 1.8, 0.16) ? { part: 'body' } : null;
    },
    drag: {
      body: (S, cur, start, d, ctx) => {
        const host = ctx.st.entities.get(ctx.ent.host);
        if (!host) return {};
        const t0 = projectOnHost(host, ctx.env, cur, lockEdgeOf(ctx.ent));
        // ★ 修复「转不过 180°」：圆宿主的投影用 Math.atan2，取值被限制在 (−π, π]，
        //   拖到 180°（t=π）再往前一个像素就回绕到 −π 侧 → 点跳到对面，看起来就是转不过去。
        //   这里把结果**展开**到离「当前 t」最近的那一圈：t = a + 2π·round((t_now − a)/2π)。
        //   于是可以连续转过多圈（正反向都行），而点的位置不变 —— cos/sin 本来就是周期函数。
        //   锚点用**当前** t（拖拽每帧都在写它，等价于连续累加），而不是拖动起点的 t，
        //   否则一次手势内转过半圈以上仍会歧义。
        if (host.type === 'circle' && Number.isFinite(t0)) {
          const now = Number.isFinite(S && S.t) ? S.t : null;
          const live = (() => {
            try { const v = ctx.env.val(ctx.ent.id, 't'); return Number.isFinite(v) ? v : null; } catch { return null; }
          })();
          const anchor = live != null ? live : now;
          if (anchor != null) {
            const TAU = Math.PI * 2;
            return { t: t0 + TAU * Math.round((anchor - t0) / TAU) };
          }
        }
        return { t: t0 };
      },
    },
    translate: null, // 受宿主约束，不可整体平移
  },

  // 裁切段：在任意曲线（线段/正弦/抛物线/函数图/自由曲线）上用两个线上点截下来的一段
  curvepiece: {
    label: '裁切段', prefix: 'cp',
    params: [],
    derived: [
      { k: 'len', name: '长度', compute: (V, ent, env) => {
        const host = env.ent(ent.host);
        const t1 = env.val(ent.p1, 't'), t2 = env.val(ent.p2, 't');
        // ★ 解析优先（本项目一贯标准）：圆/圆弧/线段这类有闭式弧长的宿主直接算，别采样。
        //   实测：采样折线在 90° 上给出 3.14151，而 π = 3.14159 —— 有 8e-5 的误差，
        //   而且缩放画布时误差还会变。曲线型宿主（正弦/函数/自由曲线）没有闭式解，才退回采样。
        if (host) {
          try {
            if (host.type === 'circle') {
              const r = env.val(host.id, 'r');
              let d = Math.abs(t2 - t1) % (2 * Math.PI);
              if (d > Math.PI) d = 2 * Math.PI - d;      // 取较短的那一段
              return Math.abs(r) * d;
            }
            if (host.type === 'arc') {
              const r = env.val(host.id, 'r'), sweep = env.val(host.id, 'sweep');
              return Math.abs(r) * Math.abs(sweep) * Math.abs(t2 - t1);
            }
            if (host.type === 'segment') {
              const dx = env.val(host.id, 'x2') - env.val(host.id, 'x1');
              const dy = env.val(host.id, 'y2') - env.val(host.id, 'y1');
              return Math.hypot(dx, dy) * Math.abs(t2 - t1);
            }
          } catch { /* 宿主参数取不到就退回采样 */ }
        }
        const pts = samplePiece(host, env, t1, t2);
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        return L;
      } },
      { k: 't1', name: '起点参数', compute: (V, ent, env) => env.val(ent.p1, 't') },
      { k: 't2', name: '终点参数', compute: (V, ent, env) => env.val(ent.p2, 't') },
    ],
    create: () => ({}),
    anchor: (V, ent, env) => {
      const host = env.ent(ent.host);
      const t1 = env.val(ent.p1, 't'), t2 = env.val(ent.p2, 't');
      return pointOnHost(host, env, (t1 + t2) / 2);
    },
    features: (V, ent, env) => {
      const host = env.ent(ent.host);
      const t1 = env.val(ent.p1, 't'), t2 = env.val(ent.p2, 't');
      return [pointOnHost(host, env, t1), pointOnHost(host, env, t2), pointOnHost(host, env, (t1 + t2) / 2)];
    },
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!host) return;
      const t1 = env.val(ent.p1, 't'), t2 = env.val(ent.p2, 't');
      const pts = samplePiece(host, env, t1, t2, pieceSampleCount(host, env, t1, t2, cam));
      if (pts.length < 2) return;
      const color = g.strokeStyle;
      g.save();
      g.lineWidth = 3.4;
      g.beginPath();
      const p0 = cam.w2s(pts[0][0], pts[0][1]);
      g.moveTo(p0[0], p0[1]);
      for (let i = 1; i < pts.length; i++) { const p = cam.w2s(pts[i][0], pts[i][1]); g.lineTo(p[0], p[1]); }
      g.stroke();
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const s = cam.w2s(p[0], p[1]);
        handle(g, s[0], s[1], color, 2.8);
      }
      g.restore();
    },
    hit(V, pt, tol, ent, cam, env) {
      const host = env.ent(ent.host);
      if (!host) return null;
      const pts = samplePiece(host, env, env.val(ent.p1, 't'), env.val(ent.p2, 't'), 400);
      if (pts.length < 2) return null;
      return distToPolyline(pt.x, pt.y, pts) < tol ? { part: 'body' } : null;
    },
    drag: { body: null },
    translate: null,
  },

  segment: {
    label: '线段', prefix: 's',
    params: [{ k: 'x1', name: '端点₁ x' }, { k: 'y1', name: '端点₁ y' }, { k: 'x2', name: '端点₂ x' }, { k: 'y2', name: '端点₂ y' }],
    derived: [
      { k: 'length', name: '长度', compute: (V) => dist(V('x1'), V('y1'), V('x2'), V('y2')) },
      { k: 'angle', name: '角度°', compute: (V) => Math.atan2(V('y2') - V('y1'), V('x2') - V('x1')) * 180 / Math.PI },
      { k: 'midx', name: '中点 x', compute: (V) => (V('x1') + V('x2')) / 2 },
      { k: 'midy', name: '中点 y', compute: (V) => (V('y1') + V('y2')) / 2 },
    ],
    create: (at) => ({ x1: at.x, y1: at.y, x2: at.x + 3, y2: at.y }),
    anchor: (V) => [(V('x1') + V('x2')) / 2, (V('y1') + V('y2')) / 2],
    features: (V) => [[V('x1'), V('y1')], [V('x2'), V('y2')], [(V('x1') + V('x2')) / 2, (V('y1') + V('y2')) / 2]],
    draw(g, ent, V, cam, env) {
      const [a, b] = [cam.w2s(V('x1'), V('y1')), cam.w2s(V('x2'), V('y2'))];
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      const color = g.strokeStyle;
      if (env.selected || env.hover) for (const p of [a, b]) handle(g, p[0], p[1], color);
    },
    hit(V, pt, tol) {
      if (dist(pt.x, pt.y, V('x1'), V('y1')) < tol * 1.6) return { part: 'p1' };
      if (dist(pt.x, pt.y, V('x2'), V('y2')) < tol * 1.6) return { part: 'p2' };
      if (distToSegment(pt.x, pt.y, V('x1'), V('y1'), V('x2'), V('y2')) < tol) return { part: 'body' };
      return null;
    },
    drag: {
      p1: (S, cur) => ({ x1: cur.x, y1: cur.y }),
      p2: (S, cur) => ({ x2: cur.x, y2: cur.y }),
      body: (S, cur, start, d) => ({ x1: S.x1 + d.dx, y1: S.y1 + d.dy, x2: S.x2 + d.dx, y2: S.y2 + d.dy }),
    },
    translate: (P, dx, dy) => ({ x1: P.x1 + dx, y1: P.y1 + dy, x2: P.x2 + dx, y2: P.y2 + dy }),
    // 可写别名：能被「关联…」当成目标来绑定
    // 注意：角度的含义已改为**由角度实体定义**——
    //   · 这条线上没有角度实体 → 根本没有「角度」这个可关联量（见 bindableParamsOf）
    //   · 有角度实体 → 角度量的值＝该角度实体的实时夹角，且被驱动时**绕那个交点旋转**
    writeAliases: {
      angle: {
        name: '角度°（由角度实体定义·绕交点旋转）', deps: ['x1', 'y1', 'x2', 'y2'],
        get: (V, ent, env) => (lineAngleInfo(env?.st, ent)?.deg ?? NaN),
        // 反解用：按"这一帧将要落到的端点 P"算角度（否则拖拽时读到的是旧角度）
        fromParams: (P, ent, env) => lineAngleFromParams(P, ent, env),
        apply: (P, deg, ent, env) => rotateLineAboutJoint(ent, env, deg),
      },
      length: {
        name: '长度（绕中点伸缩）', deps: ['x1', 'y1', 'x2', 'y2'],
        get: (V) => Math.hypot(V('x2') - V('x1'), V('y2') - V('y1')),
        fromParams: (P) => Math.hypot(P.x2 - P.x1, P.y2 - P.y1),
        apply: (P, len) => {
          const mx = (P.x1 + P.x2) / 2, my = (P.y1 + P.y2) / 2;
          const L = Math.hypot(P.x2 - P.x1, P.y2 - P.y1) || 1;
          const half = Math.max(0, len) / 2;
          const ux = (P.x2 - P.x1) / L, uy = (P.y2 - P.y1) / L;
          return { x1: mx - ux * half, y1: my - uy * half, x2: mx + ux * half, y2: my + uy * half };
        },
      },
    },
  },

  // 闭合多边形：由"线段自动组合"或预设创建；顶点数任意
  polygon: {
    label: '多边形', prefix: 'pg',
    params: [],
    paramList: (ent) => {
      const out = [];
      for (let i = 1; i <= (ent.count || 0); i++) {
        out.push({ k: vk(i, 'x'), name: vname(i, 'x') }, { k: vk(i, 'y'), name: vname(i, 'y') });
      }
      return out;
    },
    derived: [
      { k: 'n', name: '边数', compute: (V, ent) => ent.count || 0 },
      { k: 'area', name: '面积', compute: (V, ent, env) => {
        const n = ent.count || 0;
        let s = 0;
        for (let i = 0; i < n; i++) {
          const a = vertexAt(ent, env, i + 1), b = vertexAt(ent, env, ((i + 1) % n) + 1);
          s += a[0] * b[1] - b[0] * a[1];
        }
        return Math.abs(s) / 2;
      } },
      { k: 'perim', name: '周长', compute: (V, ent, env) => polygonEdges(ent, env).reduce((acc, [a, b]) => acc + dist(a[0], a[1], b[0], b[1]), 0) },
    ],
    create: (at) => ({ v1x: at.x - 2, v1y: at.y - 1.5, v2x: at.x + 2, v2y: at.y - 1.5, v3x: at.x, v3y: at.y + 1.8 }),
    anchor: (V, ent, env) => {
      const n = ent.count || 0;
      let sx = 0, sy = 0;
      for (let i = 1; i <= n; i++) { const p = vertexAt(ent, env, i); sx += p[0]; sy += p[1]; }
      return [sx / n, sy / n];
    },
    features: (V, ent, env) => {
      const n = ent.count || 0;
      const out = [];
      for (let i = 1; i <= n; i++) out.push(vertexAt(ent, env, i));
      for (const [a, b] of polygonEdges(ent, env)) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      return out;
    },
    draw(g, ent, V, cam, env) {
      const n = ent.count || 0;
      if (n < 2) return;
      const pts = [];
      for (let i = 1; i <= n; i++) pts.push(cam.w2s(...vertexAt(ent, env, i)));
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill(); g.stroke();
      const color = g.strokeStyle;
      for (const p of pts) handle(g, p[0], p[1], color, 3.6);
    },
    hit(V, pt, tol, ent, cam, env) {
      const n = ent.count || 0;
      for (let i = 1; i <= n; i++) {
        const p = vertexAt(ent, env, i);
        if (dist(pt.x, pt.y, p[0], p[1]) < tol * 1.7) return { part: `v${i}` };
      }
      for (const [a, b] of polygonEdges(ent, env)) {
        if (distToSegment(pt.x, pt.y, a[0], a[1], b[0], b[1]) < tol) return { part: 'body' };
      }
      return null;
    },
    drag: {
      // 抓本体＝整体平移（此前这里漏了 body，导致多边形根本无法整体拖动）
      body: (S, cur, start, d) => {
        const out = {};
        for (const k in S) if (/^v\d+[xy]$/.test(k)) out[k] = S[k] + (k.endsWith('x') ? d.dx : d.dy);
        return out;
      },
    },
    dynDrag: (part, ent) => {
      const m = /^v(\d+)$/.exec(part);
      if (!m) return null;
      const i = Number(m[1]);
      return (S, cur) => ({ [vk(i, 'x')]: cur.x, [vk(i, 'y')]: cur.y });
    },
    translate: (P, dx, dy) => {
      const out = {};
      for (const k in P) if (/^v\d+[xy]$/.test(k)) out[k] = P[k] + (k.endsWith('x') ? dx : dy);
      return out;
    },
    // 面积/周长也能作为关联目标：绕重心等比缩放（形状相似，只改大小）
    writeAliases: {
      area: {
        name: '面积（绕重心缩放）', depsRe: /^v\d+[xy]$/,
        apply: (P, target, ent) => polyScaleTo(P, ent, 'area', target),
        fromParams: (P, ent) => polyMeasure(P, ent, 'area'),
      },
      perim: {
        name: '周长（绕重心缩放）', depsRe: /^v\d+[xy]$/,
        apply: (P, target, ent) => polyScaleTo(P, ent, 'perim', target),
        fromParams: (P, ent) => polyMeasure(P, ent, 'perim'),
      },
    },
  },

  circle: {
    label: '圆', prefix: 'c',
    params: [{ k: 'cx', name: '圆心 x' }, { k: 'cy', name: '圆心 y' }, { k: 'r', name: '半径 r' }],
    derived: [
      { k: 'd', name: '直径 2r', compute: (V) => 2 * V('r') },
      { k: 'area', name: '面积', compute: (V) => Math.PI * V('r') ** 2 },
      { k: 'circ', name: '周长', compute: (V) => 2 * Math.PI * V('r') },
    ],
    create: (at) => ({ cx: at.x, cy: at.y, r: 2 }),
    anchor: (V) => [V('cx'), V('cy')],
    features: (V) => [[V('cx'), V('cy')], [V('cx') + V('r'), V('cy')], [V('cx') - V('r'), V('cy')], [V('cx'), V('cy') + V('r')], [V('cx'), V('cy') - V('r')]],
    draw(g, ent, V, cam, env) {
      const cx = V('cx'), cy = V('cy'), r = V('r');
      const [sx, sy] = cam.w2s(cx, cy);
      const color = g.strokeStyle;
      g.beginPath(); g.arc(sx, sy, Math.abs(r * cam.z), 0, 7); g.stroke();
      // 自带直径线段：既是读数参照，也是最顺手的拖拽把手
      const [lx, ly] = cam.w2s(cx - r, cy);
      const [rx, ry] = cam.w2s(cx + r, cy);
      g.save();
      g.lineWidth = 1.6; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(rx, ry); g.stroke();
      g.globalAlpha = 1;
      handle(g, lx, ly, color, 3.4);
      handle(g, rx, ry, color, 3.4);
      g.beginPath(); g.arc(sx, sy, 2.6, 0, 7); g.fillStyle = color; g.fill();
      if (env.selected || env.hover) {
        g.lineWidth = 2; g.strokeStyle = PAPER();
        g.beginPath(); g.arc(lx, ly, 7, 0, 7); g.stroke();
        g.beginPath(); g.arc(rx, ry, 7, 0, 7); g.stroke();
      }
      g.restore();
    },
    hit(V, pt, tol) {
      const cx = V('cx'), cy = V('cy'), r = V('r');
      const d = dist(pt.x, pt.y, cx, cy);
      if (Math.abs(d - r) < tol) return { part: 'r' };
      if (distToSegment(pt.x, pt.y, cx - r, cy, cx + r, cy) < tol) return { part: 'body' }; // 直径＝拖动条
      if (d < tol * 1.6) return { part: 'body' };
      return null;
    },
    drag: {
      r: (S, cur) => ({ r: Math.max(0.01, dist(S.cx, S.cy, cur.x, cur.y)) }),
      body: (S, cur, start, d) => ({ cx: S.cx + d.dx, cy: S.cy + d.dy }),
    },
    translate: (P, dx, dy) => ({ cx: P.cx + dx, cy: P.cy + dy }),
    // 直径可直接关联（等价于改半径）——此前「直径 2r」只能看
    writeAliases: {
      d: {
        name: '直径 2r（＝改半径）', deps: ['r'],
        get: (V) => 2 * V('r'),
        fromParams: (P) => 2 * P.r,
        apply: (P, d) => ({ r: Math.max(0.001, d / 2) }),
      },
    },
  },

  // 圆弧：由宿主圆 + 两个线上点"截"出来（较短弧），随宿主与两点实时变化
  arc: {
    label: '圆弧', prefix: 'a',
    params: [],
    derived: [
      { k: 'r', name: '半径', compute: (V, ent, env) => arcGeom(ent, env)?.r ?? NaN },
      { k: 'start', name: '起始角', compute: (V, ent, env) => arcGeom(ent, env)?.start ?? NaN },
      { k: 'sweep', name: '圆心角', compute: (V, ent, env) => arcGeom(ent, env)?.sweep ?? NaN },
      { k: 'len', name: '弧长', compute: (V, ent, env) => { const G = arcGeom(ent, env); return G ? Math.abs(G.sweep) * G.r : NaN; } },
      { k: 'deg', name: '圆心角°', compute: (V, ent, env) => { const G = arcGeom(ent, env); return G ? Math.abs(G.sweep) * 180 / Math.PI : NaN; } },
    ],
    create: () => ({}),
    anchor: (V, ent, env) => {
      const G = arcGeom(ent, env);
      if (!G) return [NaN, NaN];
      const a = G.start + G.sweep / 2;
      return [G.cx + G.r * Math.cos(a), G.cy + G.r * Math.sin(a)];
    },
    features: (V, ent, env) => {
      const G = arcGeom(ent, env);
      if (!G) return [];
      const pt = (a) => [G.cx + G.r * Math.cos(a), G.cy + G.r * Math.sin(a)];
      return [pt(G.start), pt(G.start + G.sweep), pt(G.start + G.sweep / 2)];
    },
    draw(g, ent, V, cam, env) {
      const G = arcGeom(ent, env);
      if (!G || !Number.isFinite(G.r)) return;
      const [sx, sy] = cam.w2s(G.cx, G.cy);
      const R = Math.abs(G.r * cam.z);
      const color = g.strokeStyle;
      g.save();
      g.lineWidth = 3.4;
      g.beginPath();
      g.arc(sx, sy, R, -G.start, -(G.start + G.sweep), G.sweep > 0);
      g.stroke();
      // 两端小把手，表示"这段弧由这两个点截出来"
      const ends = [G.start, G.start + G.sweep].map((a) => cam.w2s(G.cx + G.r * Math.cos(a), G.cy + G.r * Math.sin(a)));
      for (const p of ends) handle(g, p[0], p[1], color, 2.8);
      g.restore();
    },
    hit(V, pt, tol, ent, cam, env) {
      const G = arcGeom(ent, env);
      if (!G || !Number.isFinite(G.r)) return null;
      const d = dist(pt.x, pt.y, G.cx, G.cy);
      if (Math.abs(d - G.r) > tol) return null;
      const a = Math.atan2(pt.y - G.cy, pt.x - G.cx);
      let rel = G.sweep > 0 ? (a - G.start) : (G.start - a);
      rel = ((rel % TAU) + TAU) % TAU;
      return rel <= Math.abs(G.sweep) + 1e-6 ? { part: 'body' } : null;
    },
    // ★ 修复（用户报告：从圆上截出的圆弧「不能直接拖出」）：自由圆弧本来是**独立图形**
    //   （解绑后的形态，见本实体上方说明），但这里 drag/translate 都是 null → 根本拖不动，
    //   与注释声称的"可拖动"矛盾。它的参数是 cx/cy/r/start/sweep，平移就是改圆心（与 circle 同写法）。
    drag: { body: (S, cur, start, d) => ({ cx: S.cx + d.dx, cy: S.cy + d.dy }) },
    translate: (P, dx, dy) => ({ cx: P.cx + dx, cy: P.cy + dy }),
  },

  freehand: {
    label: '自由曲线', prefix: 'f',
    params: [],
    derived: [
      { k: 'length', name: '轨迹长', compute: (V, ent) => { let L = 0; const p = ent.pts || []; for (let i = 1; i < p.length; i++) L += dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]); return L; } },
    ],
    create: (at) => ({}),
    anchor: (V, ent) => ent.pts?.[0] ?? [0, 0],
    features: (V, ent) => (ent.pts?.length ? [ent.pts[0], ent.pts[ent.pts.length - 1]] : []),
    draw(g, ent, V, cam, env) {
      if (!ent.pts || ent.pts.length < 2) return;
      g.beginPath();
      const p0 = cam.w2s(ent.pts[0][0], ent.pts[0][1]); g.moveTo(p0[0], p0[1]);
      for (let i = 1; i < ent.pts.length; i++) { const p = cam.w2s(ent.pts[i][0], ent.pts[i][1]); g.lineTo(p[0], p[1]); }
      g.stroke();
    },
    hit: (V, pt, tol, ent) => (ent.pts && distToPolyline(pt.x, pt.y, ent.pts) < tol ? { part: 'body' } : null),
    drag: { body: null, translatePts: true },
    translate: null,
  },

  sine: {
    label: '正弦波', prefix: 'w',
    params: [
      { k: 'A', name: '振幅 A' }, { k: 'lam', name: '波长 λ' }, { k: 'phi', name: '相位 φ' },
      { k: 'cx', name: '中心 x' }, { k: 'cy', name: '中心 y' },
      { k: 'dmin', name: '起点 x' }, { k: 'dmax', name: '终点 x' },
    ],
    derived: [
      { k: 'freq', name: '频率', compute: (V) => (Math.abs(V('lam')) < 1e-9 ? NaN : 1 / Math.abs(V('lam'))) },
    ],
    create: (at) => ({ A: 1.5, lam: 6.28, phi: 0, cx: at.x, cy: at.y, dmin: -1e4, dmax: 1e4 }),
    yAt: (V, x) => V('cy') + V('A') * Math.sin((2 * Math.PI / V('lam')) * (x - V('cx')) + V('phi')),
    anchor: (V) => [V('cx'), V('cy')],
    features: (V) => [[V('cx'), V('cy')]],
    draw(g, ent, V, cam, env) { drawSampled(g, cam, (x) => REGISTRY.sine.yAt(V, x), dom(V, 'dmin'), dom(V, 'dmax'), curveSig(ent, env, cam)); },
    hit: (V, pt, tol, ent, cam) => hitSampled(pt, tol, cam, (x) => REGISTRY.sine.yAt(V, x), dom(V, 'dmin'), dom(V, 'dmax')),
    drag: { body: (S, cur, start, d) => ({ cx: S.cx + d.dx, cy: S.cy + d.dy }) },
    translate: (P, dx, dy) => ({ cx: P.cx + dx, cy: P.cy + dy }),
  },

  parabola: {
    label: '抛物线', prefix: 'pb',
    params: [
      { k: 'a', name: '开口 a' }, { k: 'h', name: '顶点 x' }, { k: 'k', name: '顶点 y' },
      { k: 'dmin', name: '起点 x' }, { k: 'dmax', name: '终点 x' },
    ],
    derived: [],
    create: (at) => ({ a: 0.25, h: at.x, k: at.y, dmin: -1e4, dmax: 1e4 }),
    yAt: (V, x) => V('k') + V('a') * (x - V('h')) ** 2,
    anchor: (V) => [V('h'), V('k')],
    features: (V) => [[V('h'), V('k')]],
    draw(g, ent, V, cam, env) { drawSampled(g, cam, (x) => REGISTRY.parabola.yAt(V, x), dom(V, 'dmin'), dom(V, 'dmax'), curveSig(ent, env, cam)); },
    hit: (V, pt, tol, ent, cam) => hitSampled(pt, tol, cam, (x) => REGISTRY.parabola.yAt(V, x), dom(V, 'dmin'), dom(V, 'dmax')),
    drag: { body: (S, cur, start, d) => ({ h: S.h + d.dx, k: S.k + d.dy }) },
    translate: (P, dx, dy) => ({ h: P.h + dx, k: P.k + dy }),
  },

  // 自由圆弧：解绑后的圆弧（不再依赖宿主圆），参数完全可绑定、可拖动
  arcfree: {
    label: '自由圆弧', prefix: 'fa',
    params: [
      { k: 'cx', name: '圆心 x' }, { k: 'cy', name: '圆心 y' }, { k: 'r', name: '半径 r' },
      { k: 'start', name: '起始角' }, { k: 'sweep', name: '圆心角' },
    ],
    derived: [
      { k: 'len', name: '弧长', compute: (V) => Math.abs(V('sweep')) * V('r') },
      { k: 'deg', name: '圆心角°', compute: (V) => Math.abs(V('sweep')) * 180 / Math.PI },
    ],
    create: (at) => ({ cx: at.x, cy: at.y, r: 2, start: 0, sweep: Math.PI / 2 }),
    anchor: (V) => {
      const a = V('start') + V('sweep') / 2;
      return [V('cx') + V('r') * Math.cos(a), V('cy') + V('r') * Math.sin(a)];
    },
    features: (V) => [V('start'), V('start') + V('sweep'), V('start') + V('sweep') / 2].map((a) => {
      // 用当前参数直接算，避免依赖 V 之外的上下文
      return [V('cx') + V('r') * Math.cos(a), V('cy') + V('r') * Math.sin(a)];
    }),
    draw(g, ent, V, cam, env) {
      const [sx, sy] = cam.w2s(V('cx'), V('cy'));
      const R = Math.abs(V('r') * cam.z);
      const st0 = V('start'), sw = V('sweep');
      const color = g.strokeStyle;
      g.save();
      g.lineWidth = 3;
      g.beginPath();
      g.arc(sx, sy, R, -st0, -(st0 + sw), sw > 0);
      g.stroke();
      const ends = [st0, st0 + sw].map((a) => cam.w2s(V('cx') + V('r') * Math.cos(a), V('cy') + V('r') * Math.sin(a)));
      for (const p of ends) handle(g, p[0], p[1], color, 3.2);
      g.restore();
    },
    hit(V, pt, tol) {
      const cx = V('cx'), cy = V('cy'), r = V('r');
      const d = dist(pt.x, pt.y, cx, cy);
      const ends = [V('start'), V('start') + V('sweep')];
      const ep = ends.map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      if (dist(pt.x, pt.y, ep[0][0], ep[0][1]) < tol * 1.8) return { part: 'e1' };
      if (dist(pt.x, pt.y, ep[1][0], ep[1][1]) < tol * 1.8) return { part: 'e2' };
      if (Math.abs(d - r) > tol) return null;
      const a = Math.atan2(pt.y - cy, pt.x - cx);
      const sw = V('sweep');
      let rel = sw > 0 ? (a - V('start')) : (V('start') - a);
      rel = ((rel % TAU) + TAU) % TAU;
      return rel <= Math.abs(sw) + 1e-6 ? { part: 'body' } : null;
    },
    drag: {
      e1: (S, cur) => {
        const end = S.start + S.sweep;
        let start = Math.atan2(cur.y - S.cy, cur.x - S.cx);
        return { start, sweep: clampSweep(end - start) };
      },
      e2: (S, cur) => {
        const end = Math.atan2(cur.y - S.cy, cur.x - S.cx);
        return { sweep: clampSweep(end - S.start) };
      },
      body: (S, cur, start, d) => ({ cx: S.cx + d.dx, cy: S.cy + d.dy }),
    },
    translate: (P, dx, dy) => ({ cx: P.cx + dx, cy: P.cy + dy }),
  },

  joint: JOINT_DEF,

  // ★ 隐函数（F(x,y)=0）：几何走 implicitGeom 的等值线；t 为弧长参数，可与线上点/切线/割线配合。
  implicit: {
    label: '隐函数', prefix: 'im',
    params: [],                                  // 表达式存在 ent.expr / ent.ast；暂无用户可调参数
    features: () => [],
    create: () => ({}),
    anchor: () => [0, 0],                        // 曲线铺满视野，锚点取原点（标签落点用）
    draw(g, ent, V, cam, env) {
      const c = contoursOf(ent, env, cam);
      if (!c || !c.polys.length) return;
      g.beginPath();
      for (const poly of c.polys) {
        const s0 = cam.w2s(poly[0][0], poly[0][1]);
        g.moveTo(s0[0], s0[1]);
        for (let i = 1; i < poly.length; i++) {
          const s = cam.w2s(poly[i][0], poly[i][1]);
          g.lineTo(s[0], s[1]);
        }
      }
      g.stroke();                                // 颜色/线宽由 render 的绘制循环设好（与其它实体一致）
    },
    hit(V, pt, tol, ent, cam, env) {
      const c = cachedContours(ent);
      if (!c) return false;
      const r = c.project(pt.x, pt.y);
      return !!r && r.dist <= tol;
    },
  },
  // ★ 坐标系（用户要求 ③）：为图形提供**独立参考系** —— 有自己的原点/缩放/旋转，并画出坐标轴与网格。
  //    本期实现坐标系本身（可创建、可显示、可选中、可存档、参数可在属性面板编辑）；
  //    图形的归属与坐标系之间的互连在 S8 补齐（那需要新的归属关系与变换复合，不在本期硬塞）。
  coordsys: {
    label: '坐标系', prefix: 'cs',
    params: [
      { k: 'x', name: '原点 x' }, { k: 'y', name: '原点 y' },
      { k: 'scale', name: '单位长度' }, { k: 'rot', name: '旋转' },
    ],
    derived: [],
    create: (at) => ({ x: at.x, y: at.y, scale: 50, rot: 0 }),
    anchor: (V) => [V('x'), V('y')],
    features: () => [],
    draw(g, ent, V, cam, env) {
      if (ent.visible === false) return;   // ③ 坐标系视图：隐藏的坐标系不绘制
      const ox = V('x'), oy = V('y'), sc = Math.abs(V('scale')) || 1, rot = V('rot') || 0;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      // 本地坐标 → 世界坐标：world = origin + R(rot) · (local · scale)
      const toWorld = (lx, ly) => [ox + (lx * cos - ly * sin) * sc, oy + (lx * sin + ly * cos) * sc];
      const toScreen = (lx, ly) => { const w = toWorld(lx, ly); return cam.w2s(w[0], w[1]); };
      // 网格步长：让屏幕上大约每 28px 一条 → 取「好看的数」（1/2/5 × 10^n）
      const pxPerLocal = sc * (cam.z || 1);
      const raw = 28 / Math.max(1e-9, pxPerLocal);
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) || 10 * pow;
      // 覆盖范围（用户要求 ②）：默认**只覆盖这个坐标系里有的图形** ——
      //   取成员图形的世界包围盒换算到本地坐标，再向外扩 2 格（留出边距）。
      //   没有成员时退回原点附近的小范围（而不是铺满视口）。
      const toLocal = (wx, wy) => { const dx = wx - ox, dy = wy - oy; return [(dx * cos + dy * sin) / sc, (-dx * sin + dy * cos) / sc]; };
      const box = memberBoxLocal(ent, env, toLocal);
      const pad = nice;   // 只向外扩 1 格（够放下边界上的点，也不至于铺太开）
      let minX, minY, maxX, maxY;
      if (box) {
        minX = box.minX - pad; maxX = box.maxX + pad;
        minY = box.minY - pad; maxY = box.maxY + pad;
      } else {
        const d = nice * 5;   // 空坐标系：只在原点周围给一小块参考网格
        minX = -d; maxX = d; minY = -d; maxY = d;
      }
      const nX = Math.min(240, Math.ceil((maxX - minX) / nice)), nY = Math.min(240, Math.ceil((maxY - minY) / nice));
      g.save();
      g.lineWidth = 1;
      g.globalAlpha = 0.35;
      g.beginPath();
      for (let i = 0; i <= nX; i++) {
        const lx = minX + i * nice;
        const a = toScreen(lx, minY), b = toScreen(lx, maxY);
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
      }
      for (let j = 0; j <= nY; j++) {
        const ly = minY + j * nice;
        const a = toScreen(minX, ly), b = toScreen(maxX, ly);
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
      }
      g.stroke();
      // 两条主轴：更粗更实，端点带箭头
      g.globalAlpha = 1;
      g.lineWidth = 2.2;
      g.beginPath();
      const ax0 = toScreen(minX, 0), ax1 = toScreen(maxX, 0);
      g.moveTo(ax0[0], ax0[1]); g.lineTo(ax1[0], ax1[1]);
      const ay0 = toScreen(0, minY), ay1 = toScreen(0, maxY);
      g.moveTo(ay0[0], ay0[1]); g.lineTo(ay1[0], ay1[1]);
      g.stroke();
      // 原点
      const o = cam.w2s(ox, oy);
      g.beginPath();
      g.arc(o[0], o[1], 4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    },
    hit(V, pt, tol) {
      const ox = V('x'), oy = V('y');
      return Math.hypot(pt.x - ox, pt.y - oy) <= Math.max(tol, 6) ? { part: 'body' } : null;
    },
    drag: { body: 'xy' },
    translate: (P, dx, dy) => ({ ...P, x: (P.x || 0) + dx, y: (P.y || 0) + dy }),
  },
  func: {
    label: '函数', prefix: 'fx',
    params: [{ k: 'dmin', name: '定义域左' }, { k: 'dmax', name: '定义域右' }, { k: 'cy', name: '竖直偏移 cy' }],
    derived: [],
    create: (at) => ({ dmin: -30, dmax: 30, cy: 0 }),
    anchor: (V, ent, env) => { const x = (V('dmin') + V('dmax')) / 2; const y = safeEval(ent, env, x); return [x, Number.isFinite(y) ? y : 0]; },
    features: () => [],
    draw(g, ent, V, cam, env) {
      drawSampled(g, cam, (x) => safeEval(ent, env, x), dom(V, 'dmin'), dom(V, 'dmax'), curveSig(ent, env, cam));
    },
    hit: (V, pt, tol, ent, cam, env) => hitSampled(pt, tol, cam, (x) => safeEval(ent, env, x), dom(V, 'dmin'), dom(V, 'dmax')),
    // 抓本体 = 平移整段：横move 挪定义域窗口，竖move 挪竖直偏移（⑤ 让截出来的函数段能整体拖走）
    drag: {
      body: (S, cur, start, d) => ({ dmin: S.dmin + d.dx, dmax: S.dmax + d.dx, cy: (S.cy || 0) + d.dy }),
    },
    translate: (P, dx, dy) => ({ dmin: P.dmin + dx, dmax: P.dmax + dx, cy: (P.cy || 0) + dy }),
  },

  // 切线：过曲线上一点、斜率＝该点导数的直线（斜率 m 可观察、可绑定）
  tangent: {
    label: '切线', prefix: 'tg',
    params: [{ k: 'len', name: '半长' }],
    derived: [
      { k: 'x0', name: '切点 x', compute: (V, ent, env) => hostPointAt(env.ent(ent.host), env, env.val(ent.p1, 't'))[0] },
      { k: 'y0', name: '切点 y', compute: (V, ent, env) => hostPointAt(env.ent(ent.host), env, env.val(ent.p1, 't'))[1] },
      { k: 'm', name: '斜率 m', compute: (V, ent, env) => hostSlopeAtT(env.ent(ent.host), env, env.val(ent.p1, 't')) },
    ],
    create: () => ({ len: 2 }),
    anchor: (V, ent, env) => hostPointAt(env.ent(ent.host), env, env.val(ent.p1, 't')),
    features: () => [],
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!isCalculusHost(host)) return;
      const [x0, y0] = hostPointAt(host, env, env.val(ent.p1, 't'));
      const m = hostSlopeAtT(host, env, env.val(ent.p1, 't'));
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || Number.isNaN(m)) return;
      const L = Math.max(1e-6, V('len'));
      // 竖直切线（隐函数上很常见，例如圆的最左/最右点）：m 发散 → 画竖直线
      const a = Number.isFinite(m) ? cam.w2s(x0 - L, y0 - m * L) : cam.w2s(x0, y0 - L);
      const b2 = Number.isFinite(m) ? cam.w2s(x0 + L, y0 + m * L) : cam.w2s(x0, y0 + L);
      g.save();
      g.setLineDash([6, 4]);
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke();
      g.restore();
    },
    hit(V, pt, tol, ent, cam, env) {
      const host = env.ent(ent.host);
      if (!isCalculusHost(host)) return null;
      const [x0, y0] = hostPointAt(host, env, env.val(ent.p1, 't'));
      const m = hostSlopeAtT(host, env, env.val(ent.p1, 't'));
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || Number.isNaN(m)) return null;
      const L = Math.max(1e-6, V('len'));
      const ax = Number.isFinite(m) ? x0 - L : x0, ay = Number.isFinite(m) ? y0 - m * L : y0 - L;
      const bx = Number.isFinite(m) ? x0 + L : x0, by = Number.isFinite(m) ? y0 + m * L : y0 + L;
      return distToSegment(pt.x, pt.y, ax, ay, bx, by) < tol ? { part: 'body' } : null;
    },
    drag: { body: null },
    translate: null,
  },

  // 割线：过曲线上两点（斜率就是差商；让两点靠近即可看到"逼近切线"）
  secant: {
    label: '割线', prefix: 'sc',
    params: [{ k: 'len', name: '半长' }],
    derived: [
      // ★ Δx/Δy/差商都用**两点的真实坐标差**：显函数下与 Δt 等价（行为不变），
      //   隐函数下 t 是弧长参数，必须走 hostPointAt 取坐标，否则 Δx 会算错。
      { k: 'dx', name: 'Δx', compute: (V, ent, env) => { const h = env.ent(ent.host); const p1 = hostPointAt(h, env, env.val(ent.p1, 't')); const p2 = hostPointAt(h, env, env.val(ent.p2, 't')); return p2[0] - p1[0]; } },
      { k: 'dy', name: 'Δy', compute: (V, ent, env) => { const h = env.ent(ent.host); const p1 = hostPointAt(h, env, env.val(ent.p1, 't')); const p2 = hostPointAt(h, env, env.val(ent.p2, 't')); return p2[1] - p1[1]; } },
      { k: 'm', name: '差商 m', compute: (V, ent, env) => {
        const h = env.ent(ent.host);
        const p1 = hostPointAt(h, env, env.val(ent.p1, 't'));
        const p2 = hostPointAt(h, env, env.val(ent.p2, 't'));
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        // 竖直割线（dx→0，隐函数上会出现）：斜率发散是正确数学行为，不返回 0 掩盖
        if (Math.abs(dx) < 1e-12) return Math.abs(dy) < 1e-12 ? NaN : (dy > 0 ? Infinity : -Infinity);
        return dy / dx;
      } },
    ],
    create: () => ({ len: 2 }),
    anchor: (V, ent, env) => {
      const h = env.ent(ent.host);
      const a = hostPointAt(h, env, env.val(ent.p1, 't'));
      const b = hostPointAt(h, env, env.val(ent.p2, 't'));
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    },
    features: () => [],
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!isCalculusHost(host)) return;
      const pa = hostPointAt(host, env, env.val(ent.p1, 't'));
      const pb = hostPointAt(host, env, env.val(ent.p2, 't'));
      if (!Number.isFinite(pa[0]) || !Number.isFinite(pb[0])) return;
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      if (Math.hypot(dx, dy) < 1e-12) return;
      const xm = (pa[0] + pb[0]) / 2, ym = (pa[1] + pb[1]) / 2;
      const L = Math.max(1e-6, V('len'));
      // 依方向延长：竖直割线（dx→0）时按竖直方向延长
      const len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const a = cam.w2s(xm - ux * L, ym - uy * L);
      const b2 = cam.w2s(xm + ux * L, ym + uy * L);
      g.save();
      g.lineWidth = 2;
      g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke();
      g.restore();
    },
    hit(V, pt, tol, ent, cam, env) {
      const host = env.ent(ent.host);
      if (!isCalculusHost(host)) return null;
      const pa = hostPointAt(host, env, env.val(ent.p1, 't'));
      const pb = hostPointAt(host, env, env.val(ent.p2, 't'));
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      const len0 = Math.hypot(dx, dy);
      if (!Number.isFinite(len0) || len0 < 1e-12) return null;
      const xm = (pa[0] + pb[0]) / 2, ym = (pa[1] + pb[1]) / 2;
      const L = Math.max(1e-6, V('len'));
      const ux = dx / len0, uy = dy / len0;
      return distToSegment(pt.x, pt.y, xm - ux * L, ym - uy * L, xm + ux * L, ym + uy * L) < tol ? { part: 'body' } : null;
    },
    drag: { body: null },
    translate: null,
  },

  // 导函数曲线：把宿主的数值导数画成曲线（对照"导数就是切线斜率"）
  derivcurve: {
    label: '导函数', prefix: 'dv',
    params: [{ k: 'dmin', name: '起点 x' }, { k: 'dmax', name: '终点 x' }],
    derived: [],
    create: () => ({ dmin: -1e4, dmax: 1e4 }),
    anchor: (V, ent, env) => { const x = (V('dmin') + V('dmax')) / 2; return [x, hostSlopeAt(env.ent(ent.host), env, x)]; },
    features: () => [],
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!isFunctionHost(host)) return;
      drawSampled(g, cam, (x) => hostSlopeAt(host, env, x), dom(V, 'dmin'), dom(V, 'dmax'), curveSig(ent, env, cam));
    },
    hit: (V, pt, tol, ent, cam, env) => {
      const host = env.ent(ent.host);
      if (!isFunctionHost(host)) return null;
      return hitSampled(pt, tol, cam, (x) => hostSlopeAt(host, env, x), dom(V, 'dmin'), dom(V, 'dmax'));
    },
    drag: { body: null },
    translate: null,
  },

  // 积分区域：黎曼和（矩形/梯形）；a、b、n、方式都可改、可绑定，S 与误差可被观察
  integral: {
    label: '积分区域', prefix: 'ig',
    params: [
      { k: 'a', name: '区间左 a' }, { k: 'b', name: '区间右 b' },
      { k: 'n', name: '分割数 n' }, { k: 'method', name: '方式 0左1右2中3梯' },
    ],
    derived: [
      { k: 'S', name: '近似值 S', compute: (V, ent, env) => riemannSum(env.ent(ent.host), env, V('a'), V('b'), Math.max(1, Math.round(V('n'))), Math.round(V('method'))) },
      { k: 'exact', name: '精确值', compute: (V, ent, env) => integrateFine(env.ent(ent.host), env, V('a'), V('b')) },
      { k: 'err', name: '误差', compute: (V, ent, env) => {
        const s1 = riemannSum(env.ent(ent.host), env, V('a'), V('b'), Math.max(1, Math.round(V('n'))), Math.round(V('method')));
        return Math.abs(s1 - integrateFine(env.ent(ent.host), env, V('a'), V('b')));
      } },
    ],
    create: (at) => ({ a: Math.round(at.x) - 2, b: Math.round(at.x) + 2, n: 8, method: 0 }),
    anchor: (V, ent, env) => [(V('a') + V('b')) / 2, hostYAt(env.ent(ent.host), env, (V('a') + V('b')) / 2)],
    features: () => [],
    draw(g, ent, V, cam, env) {
      const host = env.ent(ent.host);
      if (!isFunctionHost(host)) return;
      const a = V('a'), b = V('b');
      const N = Math.max(1, Math.min(400, Math.round(V('n'))));
      const method = Math.round(V('method'));
      if (!(b > a)) return;
      const w = (b - a) / N;
      g.save();
      g.globalAlpha = 0.22;
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x0 = a + w * i, x1 = x0 + w;
        if (method === 3) {
          const y0 = hostYAt(host, env, x0), y1 = hostYAt(host, env, x1);
          if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
          const p0 = cam.w2s(x0, 0), p1 = cam.w2s(x1, 0), q1 = cam.w2s(x1, y1), q0 = cam.w2s(x0, y0);
          g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(q1[0], q1[1]); g.lineTo(q0[0], q0[1]); g.closePath();
        } else {
          const xs = method === 1 ? x1 : (method === 2 ? (x0 + x1) / 2 : x0);
          const y = hostYAt(host, env, xs);
          if (!Number.isFinite(y)) continue;
          const p0 = cam.w2s(x0, 0), p1 = cam.w2s(x1, 0), top = cam.w2s(x0, y);
          g.rect(p0[0], top[1], p1[0] - p0[0], p0[1] - top[1]);
        }
      }
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 1.6;
      g.stroke();
      g.restore();
    },
    hit(V, pt) {
      const a = Math.min(V('a'), V('b')) - 0.1, b2 = Math.max(V('a'), V('b')) + 0.1;
      return pt.x >= a && pt.x <= b2 ? { part: 'body' } : null;
    },
    drag: { body: (S, cur, start, d) => ({ a: S.a + d.dx, b: S.b + d.dx }) },
    translate: (P, dx) => ({ a: P.a + dx, b: P.b + dx }),
  },
};

function safeEval(ent, env, x) {
  if (!ent.ast || !env?.st?.scope) return NaN;
  try {
    const base = env.st.scope.evalWith(ent.ast, x);
    const cy = Number.isFinite(ent.params?.cy) ? ent.params.cy : 0;
    return base + cy;
  } catch { return NaN; }
}

// ---------- 自适应采样绘制 ----------
// 目标：不再用固定采样数。分两级应对
//   1) 逐像素基础采样 + 自适应细分：屏幕上二阶弯曲超过 tolPx 的区间继续插点；
//   2) 包络带：当曲线振荡得比像素还密（细分到上限仍然每个像素列跨度很大）时，
//      改用"每像素列 min/max 构成的带"，这才是缩小后对高频曲线的正确画法。
// 返回 { pts: [x,y][], dense: bool, columns: Map<px,[minY,maxY]> }
export function sampleCurve(cam, f, dmin = -Infinity, dmax = Infinity, opts = {}) {
  const { w, h } = cam.size();
  const x0 = Math.max(cam.s2w(0, 0).x, dmin);
  const x1 = Math.min(cam.s2w(w, 0).x, dmax);
  if (!(x1 > x0)) return { pts: [], dense: false, columns: null };
  const cap = opts.cap ?? 12000;
  const tolPx = opts.tolPx ?? 0.35;
  const toSy = (y) => (cam.y - y) * cam.z + h / 2;

  const n0 = Math.max(32, Math.min(opts.baseCount ?? 1600, Math.ceil(w * 1.5)));
  let pts = [];
  for (let i = 0; i <= n0; i++) {
    const x = x0 + ((x1 - x0) * i) / n0;
    pts.push([x, f(x)]);
  }
  // 自适应细分
  for (let round = 0; round < 7 && pts.length < cap; round++) {
    const next = [pts[0]];
    let added = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
      const sa = toSy(ya), sb = toSy(yb);
      if (Number.isFinite(ya) && Number.isFinite(yb)) {
        const xm = (xa + xb) / 2;
        const ym = f(xm);
        const sm = toSy(ym);
        // 中点相对弦的屏幕偏离超过容差 → 该区间弯曲明显，插入中点
        if (Number.isFinite(ym) && Math.abs(sm - (sa + sb) / 2) > tolPx && pts.length + (next.length - i) < cap) {
          next.push([xm, ym]);
          added = true;
        }
      }
      next.push(pts[i + 1]);
    }
    pts = next;
    if (!added) break;
  }

  // 按屏幕列统计 min/max，判断是否"比像素还密"
  const buildColumns = (list) => {
    const cols = new Map();
    for (const [x, y] of list) {
      if (!Number.isFinite(y)) continue;
      const [sx, sy] = cam.w2s(x, y);
      if (sy < -h * 3 || sy > h * 4) continue;
      const c = Math.round(sx);
      const cur = cols.get(c);
      if (!cur) cols.set(c, [sy, sy]);
      else { if (sy < cur[0]) cur[0] = sy; if (sy > cur[1]) cur[1] = sy; }
    }
    return cols;
  };
  let cols = buildColumns(pts);
  // 「比像素还密」的真正标志是【振荡】（局部极值比像素列还多），而不是"竖直跨度大"——
  // 陡峭但光滑的曲线每一列跨度也很大，但它应该老老实实画成一条线。
  const countExtrema = (list) => {
    let n = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const a = list[i - 1][1], b = list[i][1], c = list[i + 1][1];
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
      const s0 = b - a, s1 = c - b;
      if (s0 !== 0 && s1 !== 0 && Math.sign(s0) !== Math.sign(s1)) n++;
    }
    return n;
  };
  const extrema = countExtrema(pts);
  const dense = cols.size > 0 && extrema > cols.size * 0.35;

  // 一旦判定为"比像素还密"，再按每像素 8 个点重采一遍，让包络带贴住真实的上下界
  if (dense) {
    const nDense = Math.min(24000, Math.ceil(w * 8));
    const fine = [];
    for (let i = 0; i <= nDense; i++) {
      const x = x0 + ((x1 - x0) * i) / nDense;
      fine.push([x, f(x)]);
    }
    cols = buildColumns(fine);
  }
  return { pts, dense, columns: cols };
}

// ---------- 采样缓存 ----------
// 自适应采样比原来密得多（每像素 ~1.5 个基础点 + 细分），所以必须缓存：
// 只有"实体参数 / 它引用的量 / 相机 / 画布尺寸"真正变了才重采，否则直接复用上一帧结果。
const curveCache = new Map();

// 相机移动期间降档渲染（拖动画布时每帧都在变，全精度重采会吃掉帧预算），
// 停止移动后再用全精度重采一帧。
let camMovingUntil = 0;
export function notifyCameraMoved() {
  camMovingUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 160;
}
function cameraMoving() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now < camMovingUntil;
}

// 采样签名：用数值滚动哈希（避免每帧为每条曲线拼字符串 + 大量 toFixed 分配）
export function curveSig(ent, env, cam) {
  const st = env?.st;
  const { w, h } = cam.size();
  let hash = 7;
  const mix = (v) => {
    const q = Number.isFinite(v) ? Math.round(v * 1e5) : 1000000007;
    hash = (hash * 2053 + q) % 1e15;
  };
  // 实体 id 参与（不同实体即使参数相同也不能共用缓存）
  for (let i = 0; i < ent.id.length; i++) mix(ent.id.charCodeAt(i) * 7.7);
  mix(cam.x); mix(cam.y); mix(cam.z); mix(w * 13); mix(h * 17);
  for (const p of paramsOf(ent)) mix(env?.val?.(ent.id, p.k));
  // 函数实体可能引用别的实体参数（如 y = c1.r * x）
  if (ent.ast) {
    try {
      const { refs } = collectRefs(ent.ast);
      for (const r of refs) {
        const target = findByLabelId(st, r.ent);
        if (target) { mix(target.id.length); mix(env.val(target.id, r.param)); }
      }
    } catch { /* 表达式坏了就算了，反正会重采 */ }
  }
  if (st) for (const v of st.variables.values()) mix(v.value);
  return hash;
}

function findByLabelId(st, label) {
  if (!st) return null;
  for (const e of st.entities.values()) if (e.label === label) return e;
  return null;
}

// 带缓存的采样
export function cachedSampleCurve(cam, f, dmin, dmax, sig) {
  const moving = cameraMoving();
  if (sig && !moving) {
    const hit = curveCache.get(sig);
    if (hit) return hit;
  }
  const res = sampleCurve(cam, f, dmin, dmax, moving
    ? { baseCount: Math.max(64, Math.ceil(cam.size().w / 3)), tolPx: 3, cap: 3000 }
    : {});
  if (sig && !moving) {
    if (curveCache.size > 400) curveCache.clear(); // 简单上限，避免长会话泄漏
    curveCache.set(sig, res);
  }
  return res;
}

// 采样绘制曲线：低频走折线，高频（缩小后）走包络带
// 定义域兜底：参数缺失/非法时按"无界"处理，否则采样范围会变成 NaN（曲线画不出来也点不中）
function dom(V, k) {
  const v = V(k);
  return Number.isFinite(v) ? v : (k === 'dmin' ? -Infinity : Infinity);
}

export function drawSampled(g, cam, f, dmin = -Infinity, dmax = Infinity, sig = null) {
  const { h } = cam.size();
  const { pts, dense, columns } = cachedSampleCurve(cam, f, dmin, dmax, sig);
  if (!pts.length) return;

  if (dense) {
    // 包络带：每个像素列画一条竖线，视觉上就是"这条曲线在这个尺度下覆盖的范围"
    g.save();
    g.lineWidth = 1;
    g.beginPath();
    for (const [c, [a, b]] of columns) {
      g.moveTo(c, Math.max(a, -h));
      g.lineTo(c, Math.min(b, h * 2));
    }
    g.stroke();
    g.restore();
    return;
  }

  g.beginPath();
  let pen = false, prevSy = 0;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y)) { pen = false; continue; }
    const [sx, sy] = cam.w2s(x, y);
    if (sy < -h * 2 || sy > h * 3) { pen = false; continue; }
    if (pen && Math.abs(sy - prevSy) > h * 1.5) pen = false; // 渐近线防连线
    if (pen) g.lineTo(sx, sy); else g.moveTo(sx, sy);
    pen = true; prevSy = sy;
  }
  g.stroke();
}

export function hitSampled(pt, tol, cam, f, dmin = -Infinity, dmax = Infinity) {
  const { w } = cam.size();
  const x0 = Math.max(cam.s2w(0, 0).x, dmin);
  const x1 = Math.min(cam.s2w(w, 0).x, dmax);
  if (!(x1 > x0)) return null;
  // 命中测试不需要绘制级密度：按"每 3 像素一个采样点"再自适应补一遍即可
  const n = Math.max(24, Math.min(1200, Math.ceil(w / 3)));
  let best = Infinity;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = f(x);
    if (!Number.isFinite(y)) { prev = null; continue; }
    // 与上一采样点连成的线段求距离，避免采样点之间"漏点"
    if (prev) best = Math.min(best, distToSegment(pt.x, pt.y, prev[0], prev[1], x, y));
    else best = Math.min(best, Math.hypot(pt.x - x, pt.y - y));
    prev = [x, y];
  }
  return best < tol ? { part: 'body' } : null;
}

// ---------- P10 微积分工具组 ----------
// 只对"显函数型"宿主（正弦/抛物线/函数图）生效：它们的 t 就是横坐标 x，求导/求和都自然。
export function hostYAt(host, env, x) {
  if (!host) return NaN;
  const V = (k) => env.val(host.id, k);
  try {
    if (host.type === 'sine') return REGISTRY.sine.yAt(V, x);
    if (host.type === 'parabola') return REGISTRY.parabola.yAt(V, x);
    if (host.type === 'func') return env.st.scope.evalWith(host.ast, x) + (Number.isFinite(V('cy')) ? V('cy') : 0);
  } catch { return NaN; }
  return NaN;
}
export function isFunctionHost(host) {
  return !!host && (host.type === 'sine' || host.type === 'parabola' || host.type === 'func');
}
// ★ 统一宿主契约（隐函数接入微积分的关键）：
//   显函数型（sine/parabola/func）：t 就是横坐标 x —— 行为与以前**完全一致**；
//   隐函数（implicit）：t 是**弧长参数**（implicitGeom 的 t∈[0,1]）—— 由 hostPointAt/hostSlopeAtT 翻译。
//   这样切线/割线等工具不必再假设 t=x，隐函数因此可用（且能正确处理竖直切线）。
// ★ 用户要求「为所有的曲线都增加微积分功能」：几何曲线（圆/圆弧/自由圆弧/多边形/自由曲线/线段）
//   也纳入微积分宿主。它们的 t 是**参数**（圆是弧度角、多边形是边序号+分数、自由曲线是 [0,1]），
//   因此切线/割线只要走 hostPointAt/hostSlopeAtT 就成立；而「曲线下面积」需要 y=f(x)，
//   闭曲线与可竖直的曲线没有这个形式 —— 那两种工具按隐函数同一条策略**明确拒绝并说明理由**。
export const GEOMETRIC_CURVES = ['circle', 'arc', 'arcfree', 'polygon', 'freehand', 'segment'];
export function isGeometricCurve(host) {
  return !!host && GEOMETRIC_CURVES.includes(host.type);
}
export function isCalculusHost(host) {
  return isFunctionHost(host) || isGeometricCurve(host) || (!!host && host.type === 'implicit');
}
// 宿主上参数 t 处的点 [x, y]
export function hostPointAt(host, env, t) {
  if (!host) return [NaN, NaN];
  if (host.type === 'implicit') {
    const c = cachedContours(host);          // 与 draw 共用同一份几何（同一帧内自洽）
    if (!c) return [NaN, NaN];
    const pt = c.pointAt(t);
    return pt ? [pt.x, pt.y] : [NaN, NaN];
  }
  // 几何曲线：t 是曲线参数（不是横坐标）→ 直接用统一的参数化取点
  if (isGeometricCurve(host)) return pointOnHost(host, env, t);
  return [t, hostYAt(host, env, t)];         // 显函数：x=t、y=f(t)
}
// 宿主上参数 t 处的切线斜率 dy/dx
export function hostSlopeAtT(host, env, t) {
  if (!host) return NaN;
  if (host.type === 'implicit') {
    // 隐式微分：dy/dx = −F_x / F_y（中心差分求偏导）。
    // F_y→0 表示**竖直切线**，斜率发散 —— 这是正确的数学行为，不是错误，由绘制侧按竖直线处理。
    const scope = env && env.st && env.st.scope;
    if (!scope || !host.ast) return NaN;
    const [x0, y0] = hostPointAt(host, env, t);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return NaN;
    const h = Math.max(1e-6, Math.abs(x0) * 1e-6 + 1e-7);
    const fx = (scope.evalWith2(host.ast, x0 + h, y0) - scope.evalWith2(host.ast, x0 - h, y0)) / (2 * h);
    const fy = (scope.evalWith2(host.ast, x0, y0 + h) - scope.evalWith2(host.ast, x0, y0 - h)) / (2 * h);
    if (Math.abs(fy) < 1e-12) return fx === 0 ? NaN : (fx > 0 ? Infinity : -Infinity);
    return -fx / fy;
  }
  // 几何曲线：参数化求切线斜率 dy/dx —— 中心差分，dx→0 时是**竖直切线**（返回 ±Infinity，
  //   这是正确的数学行为，绘制侧按竖直线处理，不是错误）。
  if (isGeometricCurve(host)) {
    const h = 1e-6;
    const [x1, y1] = hostPointAt(host, env, t + h);
    const [x0, y0] = hostPointAt(host, env, t - h);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x0) || !Number.isFinite(y0)) return NaN;
    const dx = x1 - x0, dy = y1 - y0;
    if (Math.abs(dx) < 1e-12) return Math.abs(dy) < 1e-12 ? NaN : (dy > 0 ? Infinity : -Infinity);
    return dy / dx;
  }
  return hostSlopeAt(host, env, t);          // 显函数：与以前一致
}
// 数值导数（中心差分，步长随尺度自适应）
export function hostSlopeAt(host, env, x, h) {
  const step = h ?? Math.max(1e-6, Math.abs(x) * 1e-6 + 1e-7);
  const y1 = hostYAt(host, env, x + step);
  const y0 = hostYAt(host, env, x - step);
  return (y1 - y0) / (2 * step);
}
// 定积分的细算参考值（用于展示"近似 vs 精确"）
export function integrateFine(host, env, a, b, n = 4000) {
  if (!(b > a)) return 0;
  const w = (b - a) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += hostYAt(host, env, a + w * (i + 0.5)) * w; // 中点法最准
  return s;
}
export function riemannSum(host, env, a, b, n, method = 0) {
  const N = Math.max(1, Math.round(n));
  const w = (b - a) / N;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const x0 = a + w * i, x1 = x0 + w;
    if (method === 3) { // 梯形
      const y0 = hostYAt(host, env, x0), y1 = hostYAt(host, env, x1);
      s += ((y0 + y1) / 2) * w;
    } else {
      const xs = method === 1 ? x1 : (method === 2 ? (x0 + x1) / 2 : x0);
      s += hostYAt(host, env, xs) * w;
    }
  }
  return s;
}


// 圆与单位圆已移除：工具栏的圆规自带直径线段，预设重复。
// verts = 相对落点的多边形顶点；expr = 直接生成函数曲线；type='composite' → 走 presetRecipes 的"预织网"
export const PRESETS = [
  { key: 'sine', type: 'sine', name: '正弦波', desc: 'A·sin，参数全暴露', icon: 'M2 9 Q5 2 8 9 T14 9 T20 9' },
  { key: 'cosine', type: 'sine', name: '余弦波', desc: '相位平移 π/2', params: { phi: Math.PI / 2 }, icon: 'M2 4 Q5 2 8 9 T14 9 T20 9' },
  { key: 'parabola', type: 'parabola', name: '抛物线', desc: 'y = a(x−h)²+k', icon: 'M3 3 Q10 22 17 3' },
  { key: 'triangle', type: 'polygon', name: '三角形', desc: '三顶点可拖、可截边', extra: () => ({ count: 3 }), icon: 'M10 3 L17 16 L3 16 Z' },
  { key: 'square', type: 'polygon', name: '正方形', desc: '四顶点可拖、可截边', extra: () => ({ count: 4 }), icon: 'M3 3 H17 V17 H3 Z' },
  { key: 'righttri', type: 'polygon', name: '直角三角形', desc: '3-4-5，顶点可拖', extra: () => ({ count: 3 }), verts: [[-1.5, 1], [2.5, 1], [-1.5, -2]], icon: 'M3 3 V15 H17 Z' },
  { key: 'golden', type: 'polygon', name: '黄金矩形', desc: '1 : 1.618', extra: () => ({ count: 4 }), verts: [[-1.6, -1], [1.6, -1], [1.6, 1], [-1.6, 1]], icon: 'M3 5 H17 V13 H3 Z' },
  { key: 'damped', type: 'func', name: '阻尼振荡', desc: 'e^(−kx)·sin(x)', expr: '3*exp(-0.15*x)*sin(2*x)', icon: 'M2 6 Q6 1 8 9 T14 9 T20 9' },
  { key: 'circlesine', type: 'composite', name: '圆-正弦联动', desc: '预织好的网，可拆解', icon: 'M6 9a4 4 0 1 1 0.01 0 M6 5v8 M10 9h8' },
  { key: 'unitangle', type: 'composite', name: '角度·半径', desc: 'θ 滑杆驱动动点', icon: 'M10 10 V3 M10 10 L17 10 M10 4 A6 6 0 0 1 16 10' },
  { key: 'parafocus', type: 'composite', name: '抛物线焦点·准线', desc: '焦点随 a 变化', icon: 'M3 3 Q10 20 17 3 M11 12h5 M13.5 9v6' },
];

// 预设参数：多边形类需要按 extra 生成顶点
export function createFromPreset(preset, at) {
  if (preset.type === 'composite') return {};
  if (preset.type === 'polygon') {
    if (preset.verts) {
      const out = {};
      preset.verts.forEach(([x, y], i) => {
        out[`v${i + 1}x`] = at.x + x;
        out[`v${i + 1}y`] = at.y + y;
      });
      return out;
    }
    const s = 1.8;
    if (preset.key === 'square') {
      return { v1x: at.x - s, v1y: at.y - s, v2x: at.x + s, v2y: at.y - s, v3x: at.x + s, v3y: at.y + s, v4x: at.x - s, v4y: at.y + s };
    }
    const def = REGISTRY.polygon;
    return { ...def.create(at) };
  }
  const def = REGISTRY[preset.type];
  return { ...def.create(at), ...(preset.params || {}) };
}

export function presetExtra(preset, at) {
  return typeof preset.extra === 'function' ? preset.extra(at) : (preset.extra || {});
}
