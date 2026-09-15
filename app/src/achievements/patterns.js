// S2 · A 类独石成就（cls: 'solo'，requires 必须为空）
// 判据全部读语义图上的**实测特征**，带容差；任何"看起来像"都不算。
import { near, angleNear, FN_TYPES } from './engine.js';
import { EGG_PATTERNS } from './easterEggs.js';
import { applyHints } from './hints.js';
import { CIRCLE_PATTERNS } from './circleFamily.js';
import { TRIANGLE_PATTERNS } from './triangleFamily.js';
import { FUNCTION_PATTERNS } from './functionFamily.js';

const f = (binds, sg, as) => sg.features.get(binds[as]);
const label = (binds, sg, as) => sg.byId.get(binds[as])?.label || binds[as];

// ---- A 组：最基础的"有一个 X"（火种级）----
export const SOLO_PATTERNS = [
  {
    id: 'geo.point.first', title: '第一个点', flavor: '一切从"一个位置"开始。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'point', as: 'pt' }],
    evidence: (b, sg) => ({ text: `点 ${label(b, sg, 'pt')} 在 (${f(b, sg, 'pt').x.toFixed(2)}, ${f(b, sg, 'pt').y.toFixed(2)})`, values: { x: f(b, sg, 'pt').x, y: f(b, sg, 'pt').y } }),
  },
  {
    id: 'geo.segment.first', title: '第一条线段', flavor: '两点之间，直的。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'segment', as: 's', where: (ft) => ft.length > 1e-6 }],
    evidence: (b, sg) => ({ text: `线段 ${label(b, sg, 's')} 长 ${f(b, sg, 's').length.toFixed(3)}`, values: { length: f(b, sg, 's').length } }),
  },
  {
    id: 'geo.circle.first', title: '一个圆', flavor: '到定点等距的所有点。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'circle', as: 'c', where: (ft) => ft.r > 1e-6 }],
    evidence: (b, sg) => ({ text: `半径 ${f(b, sg, 'c').r.toFixed(3)}`, values: { r: f(b, sg, 'c').r } }),
  },
  {
    id: 'geo.polygon.first', title: '闭合的多边形', flavor: '边首尾相接，围出一块面积。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) >= 3 && (ft.area || 0) > 0.1 }],
    evidence: (b, sg) => { const ft = f(b, sg, 'pg'); return { text: `${ft.count} 边形，面积 ${ft.area.toFixed(3)}`, values: { count: ft.count, area: ft.area } }; },
  },
  {
    id: 'geo.triangle.born', title: '第一块基石', flavor: '三条线，一个世界。欧几里得从这里开始。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) === 3 && (ft.area || 0) > 0.1 }],
    evidence: (b, sg) => ({ text: `三角形面积 ${f(b, sg, 'pg').area.toFixed(3)}`, values: { area: f(b, sg, 'pg').area } }),
  },
  {
    id: 'geo.edgepoint.on', title: '会滑动的点', flavor: '点在线上，线动它也跟着动。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'edgepoint', as: 'ep' }],
    where: (sg, b) => sg.edges.some((e) => e.kind === 'onHost' && e.from === b.ep),
    evidence: (b, sg) => ({ text: `线上点 t = ${f(b, sg, 'ep').t.toFixed(4)}`, values: { t: f(b, sg, 'ep').t } }),
  },
  {
    id: 'geo.var.first', title: '第一个变量', flavor: '把"可以变的量"取个名字。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'variable', as: 'v' }],
    evidence: (b, sg) => { const ft = f(b, sg, 'v'); return { text: `${ft.type === 'variable' ? label(b, sg, 'v') : ''} = ${ft.value}（${ft.min}~${ft.max}）`, values: { value: ft.value } }; },
  },
  {
    id: 'geo.func.first', title: '第一根函数曲线', flavor: '让 x 牵着 y 走。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'func', as: 'fu', where: null }],
    evidence: (b, sg) => ({ text: `f(x) = ${f(b, sg, 'fu').expr || '（函数）'}`, values: { expr: f(b, sg, 'fu').expr } }),
  },
  {
    id: 'geo.sine.first', title: '一条正弦波', flavor: '圆周运动的影子，是一条波。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'sine', as: 'sn' }],
    evidence: (b, sg) => { const ft = f(b, sg, 'sn'); return { text: `A=${ft.A} 波长 λ=${ft.lam}`, values: { A: ft.A, lam: ft.lam } }; },
  },
  {
    id: 'geo.parabola.first', title: '一条抛物线', flavor: '等加速运动的轨迹。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'parabola', as: 'pb' }],
    evidence: (b, sg) => ({ text: `抛物线 ${label(b, sg, 'pb')}`, values: {} }),
  },

  // ---- B 组：关系类（绑定 / 约束 / 重合）----
  {
    id: 'geo.binding.first', title: '第一次关联', flavor: '一个量被另一个量牵着走。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: '*', as: 't' }],
    where: (sg, b) => sg.edges.some((e) => e.kind === 'binding' && e.to === b.t),
    evidence: (b, sg) => ({ text: `${label(b, sg, 't')} 的参数已被别处驱动`, values: {} }),
  },
  {
    id: 'geo.binding.point.xy', title: '一点两命', flavor: 'x 与 y 都被别处决定，这个点完全属于别人了。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'point', as: 'pt' }],
    where: (sg, b) => {
      const params = new Set(sg.edges.filter((e) => e.kind === 'binding' && e.to === b.pt).map((e) => e.detail?.param));
      return params.has('x') && params.has('y');
    },
    evidence: (b, sg) => ({ text: `点 ${label(b, sg, 'pt')} 的 x、y 都被驱动`, values: {} }),
  },
  {
    id: 'geo.contact.endpoint', title: '接点', flavor: '线的一头扎在点上，从此同进同退。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'segment', as: 's' }, { type: 'edgepoint', as: 'ep' }],
    edges: [{ kind: 'coincident', from: 's', to: 'ep' }],
    evidence: (b, sg) => ({ text: `线段 ${label(b, sg, 's')} 的端点与线上点 ${label(b, sg, 'ep')} 重合`, values: {} }),
  },
  {
    id: 'geo.constraint.first', title: '第一次约束', flavor: '不是画成那样，而是"必须是那样"。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'constraint', as: 'c' }],
    evidence: (b, sg) => ({ text: `挂了约束：${f(b, sg, 'c').kind}`, values: { kind: f(b, sg, 'c').kind } }),
  },

  // ---- C 组：角 ----
  {
    id: 'geo.angle.first', title: '量出一个角', flavor: '两条射线张开的那块地方，现在有名字了。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => Number.isFinite(ft.deg) && ft.deg > 0.5 && ft.deg < 179.5 }],
    evidence: (b, sg) => { const ft = f(b, sg, 'j'); return { text: `夹角 ${ft.deg.toFixed(2)}°，交点在 (${ft.ix.toFixed(2)}, ${ft.iy.toFixed(2)})`, values: { deg: ft.deg, ix: ft.ix, iy: ft.iy } }; },
  },
  {
    id: 'geo.angle.right', title: '直角', flavor: '90°：最稳的那一个角。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => angleNear(ft.deg, 90, 0.5) }],
    evidence: (b, sg) => ({ text: `夹角 ${f(b, sg, 'j').deg.toFixed(3)}°（容差 ±0.5°）`, values: { deg: f(b, sg, 'j').deg } }),
  },
  {
    id: 'geo.angle.flat', title: '平角', flavor: '180°：两条射线背对背。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => angleNear(ft.deg, 180, 0.5) }],
    evidence: (b, sg) => ({ text: `夹角 ${f(b, sg, 'j').deg.toFixed(3)}°`, values: { deg: f(b, sg, 'j').deg } }),
  },
  {
    id: 'geo.angle.zero', title: '零角', flavor: '0°：方向完全一致，也是一种角。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => angleNear(ft.deg, 0, 0.5) }],
    evidence: (b, sg) => ({ text: `夹角 ${f(b, sg, 'j').deg.toFixed(3)}°（退化/重合态）`, values: { deg: f(b, sg, 'j').deg } }),
  },

  // ---- D 组：微积分实体 ----
  {
    id: 'calc.tangent.first', title: '切线', flavor: '只碰一下，却指出了方向。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'tangent', as: 'tg' }],
    evidence: (b, sg) => ({ text: `切线斜率 ${(f(b, sg, 'tg').m ?? NaN).toFixed(4)}`, values: { m: f(b, sg, 'tg').m } }),
  },
  {
    id: 'calc.secant.first', title: '割线', flavor: '两点连一线，平均变化率。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'secant', as: 'sc' }],
    evidence: (b, sg) => ({ text: `割线斜率 ${(f(b, sg, 'sc').m ?? NaN).toFixed(4)}`, values: { m: f(b, sg, 'sc').m } }),
  },
  {
    id: 'calc.integral.first', title: '积分区域', flavor: '把面积切成一条条细长条。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'integral', as: 'it' }],
    evidence: (b, sg) => ({ text: `黎曼和 ${(f(b, sg, 'it').sum ?? f(b, sg, 'it').area ?? NaN).toFixed(4)}`, values: {} }),
  },
  {
    id: 'calc.derivcurve.first', title: '导函数曲线', flavor: '把每一点的斜率连起来，是一条新曲线。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'derivcurve', as: 'dc' }],
    evidence: () => ({ text: '导函数曲线已生成', values: {} }),
  },
  {
    id: 'calc.probe.first', title: '第一个观察器', flavor: '把一个量"钉"出来盯着看。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'probe', as: 'pr' }],
    evidence: () => ({ text: '观察器已创建', values: {} }),
  },
];

// 由约束求解真正满足的水平约束（残差 < 1e-6 才算"真的水平了"）
SOLO_PATTERNS.push({
  id: 'geo.constraint.h_ok', title: '水平', flavor: '不是画平了，而是被约束成平的。', cls: 'solo', tier: 'spark', requires: [],
  nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'horizontal' && Math.abs(ft.error) < 1e-6 }],
  evidence: (b, sg) => ({ text: `水平约束已满足（残差 ${Math.abs(f(b, sg, 'c').error).toExponential(1)}）`, values: { error: f(b, sg, 'c').error } }),
});

void FN_TYPES; void near;

// ---- B 类 · 交织成就（必须由**多个**已达成成就的内容组合而成）----
export const WEAVE_PATTERNS = [
  {
    id: 'weave.thales', title: '泰勒斯之圆', flavor: '直径所对的圆周角，永远是直角。', cls: 'weave', tier: 'structure',
    // 需要：会滑动的点（线上点）+ 量出一个角；缺任一 → 只登记 ⏳ 待补前置
    requires: ['geo.edgepoint.on', 'geo.angle.first'],
    nodes: [
      { type: 'circle', as: 'c', where: (ft) => ft.r > 1e-6 },
      { type: 'edgepoint', as: 'ep' },
      { type: 'segment', as: 's', where: (ft) => ft.length > 1e-6 },
      { type: 'joint', as: 'j', where: (ft) => angleNear(ft.deg, 90, 0.5) },
    ],
    where: (sg, b) => sg.edges.some((e) => e.kind === 'onHost' && e.from === b.ep && e.to === b.c)
      && sg.edges.some((e) => e.kind === 'coincident' && ((e.from === b.s && e.to === b.ep) || (e.to === b.s && e.from === b.ep))),
    evidence: (b, sg) => ({ text: `圆上点与线段端点重合，夹角 ${f(b, sg, 'j').deg.toFixed(2)}°（直角）`, values: { deg: f(b, sg, 'j').deg } }),
  },
  {
    id: 'weave.euler.ring', title: '欧拉之环', flavor: '圆在转动，波在生长——原来它们是同一件事。', cls: 'weave', tier: 'weave',
    // 需要：圆 + 变量 + 第一次关联（θ 同时驱动圆上的点与函数曲线）
    requires: ['geo.circle.first', 'geo.var.first', 'geo.binding.first'],
    nodes: [
      { type: 'circle', as: 'c', where: (ft) => ft.r > 1e-6 },
      { type: 'variable', as: 'th' },
      { type: '*', as: 't1' },
      { type: '*', as: 't2' },
    ],
    where: (sg, b) => {
      const driven = (id) => sg.edges.filter((e) => e.kind === 'binding' && e.to === id).length;
      // θ 必须**同时**驱动两处（圆上的点，以及另一条曲线），这就是"交织"
      const fromTh = sg.edges.filter((e) => e.kind === 'binding' && e.from === 'var:' + sg.byId.get(b.th).label);
      const targets = new Set(fromTh.map((e) => e.to));
      return driven(b.t1) > 0 && driven(b.t2) > 0 && targets.size >= 2;
    },
    evidence: (b, sg) => ({ text: `变量 ${sg.byId.get(b.th).label} 同时驱动了 ${sg.edges.filter((e) => e.kind === 'binding' && e.from === 'var:' + sg.byId.get(b.th).label).length} 处`, values: {} }),
  },
];

// ---- 第二批 A 类（角度族 / 线与线关系 / 约束族 / 曲线上点）----
const degOf = (b, sg, as) => sg.features.get(b[as])?.deg;
const dirOfSeg = (ft) => {
  const dx = ft.x2 - ft.x1, dy = ft.y2 - ft.y1;
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L, L];
};
SOLO_PATTERNS.push(
  {
    id: 'geo.angle.acute', title: '锐角', flavor: '小于 90°：张得开，但没到直角。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => Number.isFinite(ft.deg) && Math.abs(ft.deg - 60) <= 0.5 }],
    evidence: (b, sg) => ({ text: `夹角 ${degOf(b, sg, 'j').toFixed(3)}°（判据 60°±0.5）`, values: { deg: degOf(b, sg, 'j') } }),
  },
  {
    id: 'geo.angle.obtuse', title: '钝角', flavor: '大于 90°：两条射线张得很开。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => Number.isFinite(ft.deg) && Math.abs(ft.deg - 120) <= 0.5 }],
    evidence: (b, sg) => ({ text: `夹角 ${degOf(b, sg, 'j').toFixed(3)}°（判据 120°±0.5）`, values: { deg: degOf(b, sg, 'j') } }),
  },
  {
    id: 'geo.lines.parallel', title: '两条平行线', flavor: '方向完全相同，却永不相遇。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }],
    where: (sg, b) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      if (!f1 || !f2) return false;
      const [ax, ay] = dirOfSeg(f1), [bx, by, blen] = dirOfSeg(f2);
      if (!ax || !blen) return false;
      const cross = ax * by - ay * bx;                       // 方向共线
      if (Math.abs(cross) > 0.01) return false;
      const nx = -ay, ny = ax;                               // 两线距离（不能是同一条线）
      const dist = Math.abs((f2.x1 - f1.x1) * nx + (f2.y1 - f1.y1) * ny);
      return dist > Math.max(0.05, blen * 0.02);
    },
    evidence: (b, sg) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      const [ax, ay] = dirOfSeg(f1), [bx, by] = dirOfSeg(f2);
      const cross = ax * by - ay * bx;
      return { text: `方向叉积 ${Math.abs(cross).toExponential(1)}（< 0.01 视为平行）`, values: { cross: Math.abs(cross) } };
    },
  },
  {
    id: 'geo.lines.perpendicular', title: '两条垂直线', flavor: '方向正交：点积为零。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }],
    where: (sg, b) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      if (!f1 || !f2) return false;
      const [ax, ay] = dirOfSeg(f1), [bx, by] = dirOfSeg(f2);
      return Math.abs(ax * bx + ay * by) < 0.01;
    },
    evidence: (b, sg) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      const [ax, ay] = dirOfSeg(f1), [bx, by] = dirOfSeg(f2);
      return { text: `方向点积 ${Math.abs(ax * bx + ay * by).toExponential(1)}（< 0.01 视为垂直）`, values: {} };
    },
  },
  {
    id: 'geo.segments.equal', title: '等长的两条线', flavor: '一样长：比值 1。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }],
    where: (sg, b) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      if (!f1 || !f2) return false;
      const l1 = f1.length, l2 = f2.length;
      return Number.isFinite(l1) && Number.isFinite(l2) && l2 > 1e-6 && Math.abs(l1 / l2 - 1) <= 0.01;
    },
    evidence: (b, sg) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      return { text: `长度 ${f1.length.toFixed(3)} 与 ${f2.length.toFixed(3)}（相对误差 ≤1%）`, values: { l1: f1.length, l2: f2.length } };
    },
  },
  {
    id: 'geo.golden.ratio', title: '黄金比例', flavor: '较长一段与全长之比 ≈ 0.618 —— 它自己就是自己的"下一段"。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }],
    where: (sg, b) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      if (!f1 || !f2) return false;
      const a = Math.max(f1.length, f2.length), c = Math.min(f1.length, f2.length);
      if (!(c > 1e-6)) return false;
      return Math.abs(a / c - 1.618) <= 0.016;               // 相对误差 ≤1%
    },
    evidence: (b, sg) => {
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      const a = Math.max(f1.length, f2.length), c = Math.min(f1.length, f2.length);
      return { text: `长度比 ${(a / c).toFixed(4)}（目标 1.618±1%）`, values: { ratio: a / c } };
    },
  },
  {
    id: 'geo.constraint.midpoint', title: '中点', flavor: '把一个点钉在另一段的正中间。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'midpoint' && Math.abs(ft.error) < 1e-6 }],
    evidence: () => ({ text: '中点约束已满足（残差 <1e-6）', values: {} }),
  },
  {
    id: 'geo.constraint.tangent', title: '相切', flavor: '只碰一下，却不穿过。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'tangent' && Math.abs(ft.error) < 1e-6 }],
    evidence: () => ({ text: '相切约束已满足（残差 <1e-6）', values: {} }),
  },
  {
    id: 'geo.edgepoint.onCurve', title: '曲线上的点', flavor: '点在曲线上，随曲线一起呼吸。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'edgepoint', as: 'ep' }],
    where: (sg, b) => sg.edges.some((e) => e.kind === 'onHost' && e.from === b.ep
      && ['sine', 'parabola', 'func', 'sinepiece', 'arcfree', 'arc'].includes(sg.byId.get(e.to)?.type)),
    evidence: (b, sg) => ({ text: `曲线上点 t=${(sg.features.get(b.ep)?.t ?? NaN).toFixed(4)}`, values: {} }),
  },
  {
    id: 'geo.points.collinear', title: '三点共线', flavor: '三个点排成一条直线。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }, { type: 'point', as: 'p3' }],
    where: (sg, b) => {
      const f = (x) => sg.features.get(b[x]);
      const [A, B, C] = [f('p1'), f('p2'), f('p3')];
      if (!A || !B || !C) return false;
      const area = Math.abs((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)) / 2;
      const scale = Math.max(1, Math.hypot(C.x - A.x, C.y - A.y));
      return area / scale <= 0.01;                          // 面积/尺度 = 到直线的距离
    },
    evidence: (b, sg) => {
      const f = (x) => sg.features.get(b[x]);
      const [A, B, C] = [f('p1'), f('p2'), f('p3')];
      const area = Math.abs((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)) / 2;
      return { text: `三点构成的三角形面积 ${area.toExponential(1)}（≤ 尺度×0.01 视为共线）`, values: { area } };
    },
  },
);

// ---- B 类第二批：每一条都必须把"多个已达成成就的内容"组合起来 ----
const hasBindingInto = (sg, id) => sg.edges.some((e) => e.kind === 'binding' && e.to === id);
// 簇：与 id 通过 onHost 直接相连的实体的集合（含自身）。共享变量的证据常常落在"圆上的点"上，
// 若不做簇闭包，圆就够不到那条证据 —— 与 weave.js 里的处理保持一致。
const clusterOf = (sg, id) => {
  const set = new Set([id]);
  for (const e of sg.edges) {
    if (e.kind !== 'onHost') continue;
    if (e.from === id) set.add(e.to);
    if (e.to === id) set.add(e.from);
  }
  return set;
};
const hasBindingFromVar = (sg, id) => sg.edges.some((e) => e.kind === 'binding' && e.to === id && String(e.from).startsWith('var:'));
WEAVE_PATTERNS.push(
  {
    id: 'weave.driven.wave', title: '波浪驯服者', flavor: '把正弦的参数交给一个滑杆——波形随你呼吸。',
    cls: 'weave', tier: 'weave', requires: ['geo.sine.first', 'geo.var.first', 'geo.binding.first'],
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg, b) => hasBindingFromVar(sg, b.sn),
    evidence: (b, sg) => ({ text: `正弦波被变量驱动（${sg.edges.filter((e) => e.kind === 'binding' && e.to === b.sn).length} 条绑定）`, values: {} }),
  },
  {
    id: 'weave.driven.circle', title: '会呼吸的圆', flavor: '半径被一个量牵着——圆开始一张一缩。',
    cls: 'weave', tier: 'weave', requires: ['geo.circle.first', 'geo.var.first', 'geo.binding.first'],
    nodes: [{ type: 'circle', as: 'c' }],
    where: (sg, b) => hasBindingFromVar(sg, b.c),
    evidence: (b, sg) => ({ text: `圆的参数被变量驱动（${sg.edges.filter((e) => e.kind === 'binding' && e.to === b.c).length} 条绑定）`, values: {} }),
  },
  {
    id: 'weave.secant.meets.tangent', title: '极限的一瞥', flavor: '割线的两点越靠越近，它就变成了切线。',
    cls: 'weave', tier: 'weave', requires: ['calc.secant.first', 'calc.tangent.first', 'geo.binding.first'],
    nodes: [{ type: 'secant', as: 'sc' }, { type: 'tangent', as: 'tg' }],
    where: (sg, b) => {
      const m1 = sg.features.get(b.sc)?.m, m2 = sg.features.get(b.tg)?.m;
      return Number.isFinite(m1) && Number.isFinite(m2) && Math.abs(m1 - m2) <= 0.05;
    },
    evidence: (b, sg) => ({ text: `割线斜率 ${(sg.features.get(b.sc)?.m ?? NaN).toFixed(4)} ≈ 切线斜率 ${(sg.features.get(b.tg)?.m ?? NaN).toFixed(4)}（差 ≤0.05）`, values: {} }),
  },
  {
    id: 'weave.calculus.keys', title: '微积分的钥匙', flavor: '切线、积分区域与观察器同框——看得见"变化"与"累积"。',
    cls: 'weave', tier: 'masterwork', requires: ['calc.tangent.first', 'calc.integral.first', 'calc.probe.first'],
    nodes: [{ type: 'tangent', as: 'tg' }, { type: 'integral', as: 'it' }, { type: 'probe', as: 'pr' }],
    evidence: () => ({ text: '切线 + 积分区域 + 观察器同时存在（同一场景里对照着看）', values: {} }),
  },
  {
    id: 'weave.angle.driven.spin', title: '让角自己转', flavor: '角被变量驱动，线就绕着当初那个交点转起来。',
    cls: 'weave', tier: 'weave', requires: ['geo.angle.first', 'geo.var.first', 'geo.binding.first'],
    nodes: [{ type: 'joint', as: 'j' }],
    where: (sg, b) => {
      const j = sg.byId.get(b.j);
      const feat = sg.features.get(b.j);
      if (!j || !feat) return false;
      return hasBindingInto(sg, feat.a) || hasBindingInto(sg, feat.b);
    },
    evidence: (b, sg) => ({ text: `角的两条线中至少一条被驱动（${sg.byId.get(b.j)?.label}）`, values: {} }),
  },
  {
    id: 'weave.congruent.triangles', title: '全等三角形', flavor: '面积相等、边数相同——它们是全等的候选。',
    cls: 'weave', tier: 'structure', requires: ['geo.triangle.born', 'geo.segments.equal'],
    nodes: [{ type: 'polygon', as: 'p1', where: (ft) => ft.count === 3 }, { type: 'polygon', as: 'p2', where: (ft) => ft.count === 3 }],
    where: (sg, b) => {
      const a1 = sg.features.get(b.p1)?.area, a2 = sg.features.get(b.p2)?.area;
      return Number.isFinite(a1) && Number.isFinite(a2) && a2 > 1e-6 && Math.abs(a1 / a2 - 1) <= 0.01;
    },
    evidence: (b, sg) => ({ text: `两个三角形面积 ${(sg.features.get(b.p1)?.area ?? NaN).toFixed(3)} 与 ${(sg.features.get(b.p2)?.area ?? NaN).toFixed(3)}（相对误差 ≤1%）`, values: {} }),
  },
  {
    id: 'weave.midpoint.driven', title: '被牵着的中点', flavor: '中点约束 + 变量驱动：一动全都动。',
    cls: 'weave', tier: 'weave', requires: ['geo.constraint.midpoint', 'geo.binding.first', 'geo.var.first'],
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'midpoint' }],
    where: (sg) => sg.edges.some((e) => e.kind === 'binding' && String(e.from).startsWith('var:')),
    evidence: () => ({ text: '中点约束成立，且场景里存在变量驱动的量', values: {} }),
  },
  {
    id: 'weave.probes.contrast', title: '对照观察', flavor: '两个观察器同时盯着——差别自己就浮出来了。',
    cls: 'weave', tier: 'weave', requires: ['calc.probe.first', 'geo.var.first'],
    nodes: [{ type: 'probe', as: 'p1' }, { type: 'probe', as: 'p2' }],
    evidence: () => ({ text: '同场景存在两个观察器（可以对照着观察）', values: {} }),
  },
);

// ---- 第三批 A 类：圆上关系 / 四边形 / 其余实体族 ----
const distTo = (fx, fy, gx, gy) => Math.hypot(fx - gx, fy - gy);
SOLO_PATTERNS.push(
  {
    id: 'geo.chord.on.circle', title: '弦', flavor: '两端都落在圆上的一段。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'segment', as: 's' }, { type: 'circle', as: 'c', where: (ft) => ft.r > 1e-6 }],
    where: (sg, b) => {
      const f = sg.features.get(b.s), c = sg.features.get(b.c);
      if (!f || !c) return false;
      const d1 = distTo(f.x1, f.y1, c.cx, c.cy), d2 = distTo(f.x2, f.y2, c.cx, c.cy);
      return Math.abs(d1 - c.r) <= Math.max(0.02, c.r * 0.01) && Math.abs(d2 - c.r) <= Math.max(0.02, c.r * 0.01);
    },
    evidence: (b, sg) => {
      const f = sg.features.get(b.s), c = sg.features.get(b.c);
      return { text: `两端到圆心距离 ${distTo(f.x1, f.y1, c.cx, c.cy).toFixed(3)} / ${distTo(f.x2, f.y2, c.cx, c.cy).toFixed(3)}（半径 ${c.r}）`, values: {} };
    },
  },
  {
    id: 'geo.diameter', title: '直径', flavor: '穿过圆心的那条弦，是最长的一条。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'segment', as: 's' }, { type: 'circle', as: 'c', where: (ft) => ft.r > 1e-6 }],
    where: (sg, b) => {
      const f = sg.features.get(b.s), c = sg.features.get(b.c);
      if (!f || !c) return false;
      const d1 = distTo(f.x1, f.y1, c.cx, c.cy), d2 = distTo(f.x2, f.y2, c.cx, c.cy);
      const midOk = distTo((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, c.cx, c.cy) <= Math.max(0.02, c.r * 0.01);
      return midOk && Math.abs(d1 - c.r) <= Math.max(0.02, c.r * 0.01) && Math.abs(d2 - c.r) <= Math.max(0.02, c.r * 0.01);
    },
    evidence: (b, sg) => {
      const f = sg.features.get(b.s), c = sg.features.get(b.c);
      return { text: `中点离圆心 ${distTo((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, c.cx, c.cy).toExponential(1)}（≈0 且两端在圆上）`, values: {} };
    },
  },
  {
    id: 'geo.quad.rect', title: '矩形', flavor: '四个直角：稳稳当当。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => ft.count === 4 }],
    where: (sg, b) => {
      const ft = sg.features.get(b.pg);
      const pt = (i) => [ft['v' + i + 'x'], ft['v' + i + 'y']];
      const d = (i, j) => { const a = pt(i), c = pt(j); return [c[0] - a[0], c[1] - a[1]]; };
      const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
      const norm = (u) => Math.hypot(u[0], u[1]) || 1;
      const e1 = d(1, 2), e2 = d(2, 3), e3 = d(3, 4);
      return Math.abs(dot(e1, e2)) / (norm(e1) * norm(e2)) <= 0.01
        && Math.abs(dot(e2, e3)) / (norm(e2) * norm(e3)) <= 0.01;
    },
    evidence: () => ({ text: '四边形且相邻两边方向正交（点积 ≤1%）', values: {} }),
  },
  {
    id: 'geo.quad.square', title: '正方形', flavor: '四条边一样长、四个角都是直角。', cls: 'solo', tier: 'structure', requires: [],
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => ft.count === 4 }],
    where: (sg, b) => {
      const ft = sg.features.get(b.pg);
      const pt = (i) => [ft['v' + i + 'x'], ft['v' + i + 'y']];
      const L = (i, j) => { const a = pt(i), c = pt(j); return Math.hypot(c[0] - a[0], c[1] - a[1]); };
      const d = (i, j) => { const a = pt(i), c = pt(j); return [c[0] - a[0], c[1] - a[1]]; };
      const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
      const norm = (u) => Math.hypot(u[0], u[1]) || 1;
      const l1 = L(1, 2), l2 = L(2, 3), l3 = L(3, 4), l4 = L(4, 1);
      const equal = [l1, l2, l3, l4].every((x) => Math.abs(x / l1 - 1) <= 0.01);
      const e1 = d(1, 2), e2 = d(2, 3);
      return equal && Math.abs(dot(e1, e2)) / (norm(e1) * norm(e2)) <= 0.01;
    },
    evidence: () => ({ text: '四边等长（相对误差 ≤1%）且有一个直角', values: {} }),
  },
  {
    id: 'geo.arc.first', title: '一条弧', flavor: '圆的一段：有起点、有扫过的角。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'arc', as: 'a' }],
    evidence: (b, sg) => ({ text: `弧长 ${(sg.features.get(b.a)?.length ?? NaN).toFixed(3)}`, values: {} }),
  },
  {
    id: 'geo.arcfree.first', title: '自由弧段', flavor: '自己扫出来的一段圆弧。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'arcfree', as: 'a' }],
    evidence: () => ({ text: '自由弧段已创建', values: {} }),
  },
  {
    id: 'geo.freehand.first', title: '手绘的曲线', flavor: '不用公式，直接画——它也是一条曲线。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'freehand', as: 'fh' }],
    evidence: () => ({ text: '手绘曲线已创建', values: {} }),
  },
  {
    id: 'calc.probe.expr', title: '表达式观察器', flavor: '把两个量相减，直接盯着"差"。', cls: 'solo', tier: 'spark', requires: [],
    nodes: [{ type: 'probe', as: 'pr', where: (ft) => ft.kind === 'expr' }],
    evidence: (b, sg) => ({ text: `观察表达式 ${sg.features.get(b.pr)?.expr || ''}`, values: {} }),
  },
);

// ---- B 类第三批：再补 10 条"多成就组合" ----
WEAVE_PATTERNS.push(
  {
    id: 'weave.parallelogram', title: '平行四边形', flavor: '两组对边各自平行——等长与平行在这里握手。',
    cls: 'weave', tier: 'structure', requires: ['geo.lines.parallel', 'geo.segments.equal'],
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => ft.count === 4 }],
    where: (sg, b) => {
      const ft = sg.features.get(b.pg);
      const pt = (i) => [ft['v' + i + 'x'], ft['v' + i + 'y']];
      const dir = (i, j) => { const a = pt(i), c = pt(j); const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / L, (c[1] - a[1]) / L]; };
      const cross = (u, v) => Math.abs(u[0] * v[1] - u[1] * v[0]);
      return cross(dir(1, 2), dir(3, 4)) <= 0.01 && cross(dir(2, 3), dir(4, 1)) <= 0.01;
    },
    evidence: () => ({ text: '四边形两组对边方向都平行（叉积 ≤1%）', values: {} }),
  },
  {
    id: 'weave.tangency.circle', title: '直线与圆相切', flavor: '圆 + 相切约束：只碰一下却不穿过。',
    cls: 'weave', tier: 'weave', requires: ['geo.constraint.tangent', 'geo.circle.first'],
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'tangent' && Math.abs(ft.error) < 1e-6 }, { type: 'circle', as: 'ci', where: (ft) => ft.r > 1e-6 }],
    evidence: () => ({ text: '相切约束已满足，且场景中有圆', values: {} }),
  },
  {
    id: 'weave.chord.midpoint', title: '弦被平分', flavor: '弦 + 中点约束：这条弦被精确平分。',
    cls: 'weave', tier: 'weave', requires: ['geo.chord.on.circle', 'geo.constraint.midpoint'],
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => ft.kind === 'midpoint' && Math.abs(ft.error) < 1e-6 }],
    where: (sg) => sg.nodes.some((x) => x.type === 'segment') && sg.nodes.some((x) => x.type === 'circle'),
    evidence: () => ({ text: '中点约束成立，且同场景有圆与线段（弦）', values: {} }),
  },
  {
    id: 'weave.diameter.right', title: '直径上的直角', flavor: '直径 + 直角：泰勒斯定理的另一种呈现。',
    cls: 'weave', tier: 'weave', requires: ['geo.diameter', 'geo.angle.right'],
    nodes: [{ type: 'joint', as: 'j', where: (ft) => angleNear(ft.deg, 90, 0.5) }],
    where: (sg) => sg.nodes.some((x) => x.type === 'circle'),
    evidence: () => ({ text: '同场景存在直径、直角与圆', values: {} }),
  },
  {
    id: 'weave.func.derivative', title: '函数与它的导函数', flavor: '把每一点的斜率连起来，得到一条新曲线。',
    cls: 'weave', tier: 'weave', requires: ['geo.func.first', 'calc.derivcurve.first'],
    nodes: [{ type: 'func', as: 'fu' }, { type: 'derivcurve', as: 'dc' }],
    evidence: () => ({ text: '函数曲线与导函数曲线同时存在', values: {} }),
  },
  {
    id: 'weave.integral.driven', title: '被驱动的累积量', flavor: '变量一动，积分区域跟着重算。',
    cls: 'weave', tier: 'weave', requires: ['calc.integral.first', 'geo.var.first', 'geo.binding.first'],
    nodes: [{ type: 'integral', as: 'it' }],
    where: (sg) => sg.edges.some((e) => e.kind === 'binding' && String(e.from).startsWith('var:')),
    evidence: () => ({ text: '存在积分区域，且场景中有变量驱动的量', values: {} }),
  },
  {
    id: 'weave.probe.on.func', title: '盯着函数看', flavor: '观察器监视着一条函数曲线：值一变，读数就变。',
    cls: 'weave', tier: 'weave', requires: ['calc.probe.first', 'geo.func.first'],
    nodes: [{ type: 'probe', as: 'pr' }, { type: 'func', as: 'fu' }],
    where: (sg, b) => sg.edges.some((e) => e.kind === 'observe' && e.to === b.pr && e.from === b.fu),
    evidence: () => ({ text: '存在一个观察器正盯着函数曲线（observe 边）', values: {} }),
  },
  {
    id: 'weave.contact.spin', title: '接点也在转', flavor: '端点钉在点上、角又被驱动——转起来时它俩同步。',
    cls: 'weave', tier: 'weave', requires: ['geo.contact.endpoint', 'geo.angle.first'],
    nodes: [{ type: 'joint', as: 'j' }, { type: 'edgepoint', as: 'ep' }],
    where: (sg) => sg.edges.some((e) => e.kind === 'coincident') && sg.edges.some((e) => e.kind === 'binding'),
    evidence: () => ({ text: '同场景存在接点（重合+绑定）与角', values: {} }),
  },
  {
    id: 'weave.circle.wave', title: '圆与波同源', flavor: '同一个变量同时牵着圆与波——它们是同一件事的两种投影。',
    cls: 'weave', tier: 'weave', requires: ['geo.circle.first', 'geo.sine.first'],
    nodes: [{ type: 'circle', as: 'c' }, { type: 'sine', as: 'sn' }],
    where: (sg, b) => {
      const A = clusterOf(sg, b.c);       // 圆 + 圆上的点
      const B = clusterOf(sg, b.sn);      // 正弦 + 挂在正弦上的点
      return sg.edges.some((e) => e.kind === 'sharedVar'
        && ((A.has(e.from) && B.has(e.to)) || (B.has(e.from) && A.has(e.to))));
    },
    evidence: () => ({ text: '圆与正弦之间存在"共享变量"耦合', values: {} }),
  },
  {
    id: 'weave.constrained.polygon', title: '被约束的多边形', flavor: '多边形 + 约束：形状不再随手变形。',
    cls: 'weave', tier: 'structure', requires: ['geo.polygon.first', 'geo.constraint.first'],
    nodes: [{ type: 'polygon', as: 'pg' }, { type: 'constraint', as: 'c' }],
    evidence: () => ({ text: '同场景存在多边形与约束', values: {} }),
  },
);

// T8：彩蛋成就并入 A 类（不标注"非主线"，混在正常成就里等你撞见）
for (const egg of EGG_PATTERNS) if (!SOLO_PATTERNS.some((p2) => p2.id === egg.id)) SOLO_PATTERNS.push(egg);

// T6/T8：补齐"未激活时的暗示"（彩蛋自带，其余 62 条来自 hints.js）——§7.3 要求每条都有
applyHints([...SOLO_PATTERNS, ...WEAVE_PATTERNS]);

// T8 扩展：圆与弦族并入 A 类
for (const cp of CIRCLE_PATTERNS) if (!SOLO_PATTERNS.some((p2) => p2.id === cp.id)) SOLO_PATTERNS.push(cp);

// T8 扩展：三角形族并入 A 类
for (const tp of TRIANGLE_PATTERNS) if (!SOLO_PATTERNS.some((p2) => p2.id === tp.id)) SOLO_PATTERNS.push(tp);

// T8 扩展：函数族并入 A 类
for (const fp of FUNCTION_PATTERNS) if (!SOLO_PATTERNS.some((p2) => p2.id === fp.id)) SOLO_PATTERNS.push(fp);
