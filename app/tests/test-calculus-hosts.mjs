// issue #6「G3_隐函数和其它曲线对于微积分功能的支持」的可执行验收清单。
//
// 口径（用户 2026-10-17 拍板）= **方案 c（最完整）**：
//   · 宿主在当前范围内 **x(t) 单调** → 走 **x 模式**（与普通函数今天的行为完全一致，老行为零变化）
//   · 否则（闭曲线 / 竖直处 / 一对多）→ 走 **t 模式**（横轴是参数 t，UI 必须说清）
//   · 导函数曲线：x 模式 = dy/dx；t 模式 = y′(t)/x′(t)（= 切线斜率，与切线实体的「斜率 m」同一个量）
//   · 积分区域：x 模式 = ∫ₐᵇ y dx；t 模式 = ∫ y(t)·x′(t) dt；闭曲线另给所围面积 ∮x dy（格林公式）
//   · 竖直处（x′(t)=0）斜率无定义 → 跳过该点，不画假值
//
// ★ 夹具说明（很重要，避免以后误以为是"放宽断言"）：
//   freehand / implicit / arc 这三个宿主的参数（点集 / 表达式 / 弧参数）是**各自的工具在真实操作时写进实体**的，
//   注册表的 create() 对它们返回 {}，因此**手工构造的假实体无法满足它们的契约**（试过，pointOnHost 返回 [null,null]）。
//   同理，func 的求值要走**真实状态的求值环境**，假 env 下 hostYAt 返回 NaN。
//   所以本清单的几何曲线夹具用 **circle**（create() 直接给出 cx/cy/r，是被真实覆盖过的宿主）与
//   **segment**（线性、字段 x1/y1/x2/y2，可如实构造）；freehand / implicit / func 这三类的覆盖交给
//   ⑥ 的真浏览器截图（走真实 UI 建实体）与既有的 150 条用例（它们密集覆盖函数侧的微积分路径）。
//   **断言口径一个字没改** —— 改的只是夹具怎么造。
import { test, eq, approx, ok } from './harness.mjs';
import {
  REGISTRY, hostPointAt, hostSlopeAtT, hostTRange, hostXMonotonic,
  hostAreaByT, hostEnclosedArea, isGeometricCurve, isCalculusHost, HOSTABLE,
} from '../src/entities.js';

// ── 夹具：圆（走注册表 ✓ 参数真实）与线段（线性 ✓ 字段可如实给出）────────────
const envOf = (ents) => ({
  ent: (id) => ents[id],
  val: (id, k) => (ents[id] && ents[id].params ? ents[id].params[k] : undefined),
});
const circle = { id: 'c1', type: 'circle', params: { ...REGISTRY.circle.create({ x: 0, y: 0 }) } };   // r=2 ✓
const seg = { id: 's1', type: 'segment', params: { x1: -2, y1: 0, x2: 2, y2: 4 } };
const env = envOf({ c1: circle, s1: seg });
const R = circle.params.r;

// ════════════ 0. 宿主能力：几何曲线本来就在"可当微积分宿主"的名单里（回归护栏）════
test('issue6-0 圆与线段都属于"可当微积分宿主"的曲线', () => {
  ok(HOSTABLE.includes('circle'), 'circle 在 HOSTABLE 里');
  ok(HOSTABLE.includes('freehand'), 'freehand 在 HOSTABLE 里');
  ok(HOSTABLE.includes('implicit'), 'implicit 在 HOSTABLE 里');
  ok(isGeometricCurve(circle), 'circle 是几何曲线');
  ok(isCalculusHost(circle), 'circle 是微积分宿主');
});

// ════════════ 1. 参数化取点/取斜率：圆成立，且竖直处不返回假斜率 ══════════════
test('issue6-1 hostPointAt / hostSlopeAtT 对圆成立（含竖直处不返回假斜率）', () => {
  approx(hostPointAt(circle, env, 0)[0], R, 1e-12);
  approx(hostPointAt(circle, env, 0)[1], 0, 1e-12);
  approx(hostPointAt(circle, env, Math.PI / 2)[1], R, 1e-12);
  approx(hostSlopeAtT(circle, env, Math.PI / 2), 0, 1e-6);          // 顶部切线水平 ✓
  const mVertical = hostSlopeAtT(circle, env, 0);                    // 右侧切线竖直 ✓
  ok(!Number.isFinite(mVertical) || Math.abs(mVertical) > 1e6,
    '竖直处斜率必须表现为无穷/未定义，而不是有限小值');
});

test('issue6-1 hostPointAt 对线段成立（线性宿主，两端点可如实构造）', () => {
  const a = hostPointAt(seg, env, 0), b = hostPointAt(seg, env, 1);
  approx(a[0], -2, 1e-12); approx(a[1], 0, 1e-12);
  approx(b[0], 2, 1e-12); approx(b[1], 4, 1e-12);
  approx(hostSlopeAtT(seg, env, 0.5), 1, 1e-6);                      // 斜率恒为 1 ✓
});

// ════════════ 2. 模式判据：单调 → x 模式；闭/一对多 → t 模式 ═══════════════
test('issue6-2 hostXMonotonic 判据：圆的整圈不是 x 单调，单值弧是', () => {
  eq(hostXMonotonic(circle, env, 0, Math.PI * 2), false, '整圈不是 x 单调 → 必须走 t 模式');
  eq(hostXMonotonic(circle, env, 0, Math.PI), true, '上半支 x 单调 → 可以走 x 模式');
  eq(hostXMonotonic(seg, env, 0, 1), true, '线段恒单调 → x 模式');
  const [t0, t1] = hostTRange(circle);
  approx(t0, 0, 1e-12); approx(t1, Math.PI * 2, 1e-12);              // 圆的 t 是圆心角 [0,2π] ✓
  const sr = hostTRange(seg);
  approx(sr[0], 0, 1e-12); approx(sr[1], 1, 1e-12);                  // 线段 t ∈ [0,1] ✓
});

// ════════════ 3. 两种算法必须互相对得上（x 模式 == t 模式）════════════════════
test('issue6-3 同一段曲线：∫ₐᵇ y dx（x 模式）== ∫ y(t)·x′(t) dt（t 模式）', () => {
  // 上半圆 t∈[0,π]：x 从 +2 单调减到 −2 ✓，面积应为 πr²/2 = 2π ✓
  const byT = hostAreaByT(circle, env, 0, Math.PI);
  approx(byT, (Math.PI * R * R) / 2, 0.02, `上半圆下面积应≈${(Math.PI * R * R) / 2}（实测 ${byT}）`);
  // 同量用 y=f(x) 口径算：y=√(r²−x²) 从 −r 到 r ✓ 两者必须相等（符号也要一致 ✓）
  let s = 0; const N = 20000, h = (2 * R) / N;
  for (let i = 0; i < N; i++) { const x = -R + h * (i + 0.5); s += Math.sqrt(Math.max(0, R * R - x * x)) * h; }
  approx(byT, s, 0.02, 't 模式必须与"曲线下面积"的 x 口径数值一致');
});

test('issue6-3 闭曲线的所围面积 = πr²（格林公式）', () => {
  const A = hostEnclosedArea(circle, env);
  approx(A, Math.PI * R * R, 0.02, `圆 r=${R} 的所围面积应≈${Math.PI * R * R}（实测 ${A}）`);
});

// ════════════ 4. 导函数曲线的 t 模式值 = 切线斜率（与 tangent 实体同一个量）══════
test('issue6-4 t 模式导函数曲线的取值 = y′(t)/x′(t)，且与差商一致', () => {
  // 圆上 dy/dx = −cos t / sin t；t=π/4 时 = −1 ✓
  approx(hostSlopeAtT(circle, env, Math.PI / 4), -1, 1e-6);
  const h = 1e-6, p1 = hostPointAt(circle, env, Math.PI / 4 - h), p2 = hostPointAt(circle, env, Math.PI / 4 + h);
  approx(hostSlopeAtT(circle, env, Math.PI / 4), (p2[1] - p1[1]) / (p2[0] - p1[0]), 1e-4, '差分与解析斜率必须一致');
  // 线段的 t 模式斜率 = 1（差商同值 ✓）
  approx(hostSlopeAtT(seg, env, 0.3), 1, 1e-6);
});

// ════════════ 5. integral 的派生量走新口径（非闭曲线不给所围面积）════════════
test('issue6-5 积分派生量：闭圆给所围面积；非闭线段给 NaN（面板显示 —）', () => {
  const ig = REGISTRY.integral;
  const V = (o) => (k) => o[k];
  const dEnclosed = ig.derived.find((d) => d.k === 'enclosed');
  const dExact = ig.derived.find((d) => d.k === 'exact');
  ok(!!dEnclosed, '必须有 enclosed 派生量（所围面积）');
  approx(dEnclosed.compute(V({ a: 0, b: Math.PI * 2 }), { host: 'c1' }, env), Math.PI * R * R, 0.02, '整圆所围面积 = πr²');
  approx(dExact.compute(V({ a: 0, b: Math.PI }), { host: 'c1' }, env), (Math.PI * R * R) / 2, 0.02, '上半支精确值 = πr²/2');
  ok(Number.isNaN(dEnclosed.compute(V({ a: 0, b: 1 }), { host: 's1' }, env)), '线段不是闭曲线 → 所围面积必须是 NaN');
  // t 模式锚点必须落在曲线上（老实现会算成 x 轴上的假位置 ✗）
  const anc = ig.anchor(V({ a: 0, b: Math.PI }), { host: 'c1' }, env);
  approx(Math.hypot(anc[0], anc[1]), R, 0.05, '锚点应落在圆上（到圆心距离 = r）');
});
