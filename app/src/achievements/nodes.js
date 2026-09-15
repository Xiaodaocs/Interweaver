// 知识网节点注册表 + 成就→知识点 映射
//
// 为什么需要它：织边（S4）要知道"哪些成就点亮了哪些知识点、两两之间能不能连"；
// 横向星图（S6）要知道"每个知识点排在第几层"（左易右难）。
// 这里全部是**数据**，并由单测守住三条硬不变式：
//   ① 每条成就都必须映射到一个真实存在的知识点；
//   ② B 类交织成就映射到 kind:'weave' 的"结"节点（视觉上与普通知识点区分）；
//   ③ **层号单调**：任何 B 类成就的节点层，必须严格大于它所有前置成就的节点层
//      —— 这样星图上每条依赖连线都是"从左指向右"，不会出现回头线。
//
// group 决定星图上的横向色带（四组）；layer 决定列（0 最左＝最基本）。

export const GROUPS = ['点与绑定', '角与旋转', '构造与约束', '微积分'];

export const KNOWLEDGE_NODES = [
  // —— 点与绑定 ——
  { id: 'n.point', title: '点', group: '点与绑定', layer: 0, kind: 'concept', desc: '一个位置，由 x、y 两个参数决定。' },
  { id: 'n.segment', title: '线段', group: '点与绑定', layer: 0, kind: 'concept', desc: '两点之间的直段，有长度与方向。' },
  { id: 'n.circle', title: '圆', group: '点与绑定', layer: 0, kind: 'concept', desc: '到定点等距的所有点。' },
  { id: 'n.variable', title: '变量', group: '点与绑定', layer: 0, kind: 'concept', desc: '一个可以被滑杆、动画或别处驱动的量。' },
  { id: 'n.edgepoint', title: '线上点', group: '点与绑定', layer: 1, kind: 'concept', desc: '按参数 t 挂在某条曲线上的点。' },
  { id: 'n.binding', title: '关联', group: '点与绑定', layer: 1, kind: 'concept', desc: '一个参数由另一个量决定（单向依赖）。' },
  { id: 'n.contact', title: '接点', group: '点与绑定', layer: 2, kind: 'concept', desc: '线端与点重合绑定，从此同进同退。' },
  { id: 'n.pointxy', title: '双端驱动', group: '点与绑定', layer: 2, kind: 'concept', desc: '一个点的 x 与 y 都由别处决定。' },

  // —— 角与旋转 ——
  { id: 'n.angle', title: '角', group: '角与旋转', layer: 1, kind: 'concept', desc: '两条射线张开的那块地方。' },
  { id: 'n.right', title: '直角', group: '角与旋转', layer: 2, kind: 'concept', desc: '90°：最稳的那一个角。' },
  { id: 'n.flat', title: '平角与零角', group: '角与旋转', layer: 2, kind: 'concept', desc: '180° 与 0°：方向相反或一致。' },
  { id: 'n.angledrive', title: '角度驱动', group: '角与旋转', layer: 3, kind: 'concept', desc: '用变量驱动一条线的角度。' },
  { id: 'n.spin', title: '绕交点旋转', group: '角与旋转', layer: 4, kind: 'concept', desc: '旋转的中心是当初设立角度的那个交点。' },

  // —— 构造与约束 ——
  { id: 'n.polygon', title: '多边形', group: '构造与约束', layer: 1, kind: 'concept', desc: '闭合的边围出一块面积。' },
  { id: 'n.triangle', title: '三角形', group: '构造与约束', layer: 2, kind: 'concept', desc: '三条边、三个角、一块面积。' },
  { id: 'n.chord', title: '弦与直径', group: '构造与约束', layer: 3, kind: 'concept', desc: '两端落在圆上的线段；过圆心的那条是直径。' },
  { id: 'n.quad', title: '矩形与正方形', group: '构造与约束', layer: 3, kind: 'concept', desc: '四边形的直角与等边条件。' },
  { id: 'n.arc', title: '弧与手绘曲线', group: '点与绑定', layer: 2, kind: 'concept', desc: '圆的一段、扫出的弧、以及直接画出来的曲线。' },
  { id: 'n.exprProbe', title: '表达式观察器', group: '微积分', layer: 4, kind: 'concept', desc: '不只是看一个量，而是看一个式子（例如差）。' },
  { id: 'n.constraint', title: '约束', group: '构造与约束', layer: 2, kind: 'concept', desc: '声明式的"必须是那样"，由求解器负责摆平。' },
  { id: 'n.acuteObtuse', title: '锐角与钝角', group: '角与旋转', layer: 2, kind: 'concept', desc: '小于 90° 与大于 90°：角的大小是个连续量。' },
  { id: 'n.parallel', title: '平行', group: '构造与约束', layer: 2, kind: 'concept', desc: '方向完全相同、永不相遇。' },
  { id: 'n.perpendicular', title: '垂直', group: '构造与约束', layer: 2, kind: 'concept', desc: '方向正交：点积为零。' },
  { id: 'n.equal', title: '等长', group: '构造与约束', layer: 2, kind: 'concept', desc: '一样长：比值为 1。' },
  { id: 'n.golden', title: '黄金比例', group: '构造与约束', layer: 3, kind: 'concept', desc: '1.618：较长段与全长之比等于较短段与较长段之比。' },
  { id: 'n.midpoint', title: '中点', group: '构造与约束', layer: 3, kind: 'concept', desc: '把一个点钉在一段的正中间。' },
  { id: 'n.tangency', title: '相切', group: '构造与约束', layer: 3, kind: 'concept', desc: '只碰一下，却不穿过。' },
  { id: 'n.collinear', title: '共线', group: '构造与约束', layer: 3, kind: 'concept', desc: '若干点排在同一条直线上。' },
  { id: 'n.horizontal', title: '水平与竖直', group: '构造与约束', layer: 3, kind: 'concept', desc: '相对世界坐标系的水平/竖直，残差 <1e-6 才算真的满足。' },
  { id: 'n.thales', title: '泰勒斯定理', group: '构造与约束', layer: 5, kind: 'weave', desc: '直径所对的圆周角是直角——把"圆"与"角"接上了。' },

  // —— 微积分 ——
  { id: 'n.func', title: '函数曲线', group: '微积分', layer: 1, kind: 'concept', desc: '让 x 牵着 y 走。' },
  { id: 'n.sine', title: '正弦波', group: '微积分', layer: 2, kind: 'concept', desc: '圆周运动的影子是一条波。' },
  { id: 'n.parabola', title: '抛物线', group: '微积分', layer: 2, kind: 'concept', desc: '等加速运动的轨迹。' },
  { id: 'n.tangent', title: '切线', group: '微积分', layer: 3, kind: 'concept', desc: '只碰一下，却指出了方向（瞬时变化率）。' },
  { id: 'n.secant', title: '割线', group: '微积分', layer: 3, kind: 'concept', desc: '两点连一线，平均变化率。' },
  { id: 'n.integral', title: '积分区域', group: '微积分', layer: 4, kind: 'concept', desc: '把面积切成一条条细长条。' },
  { id: 'n.derivcurve', title: '导函数曲线', group: '微积分', layer: 4, kind: 'concept', desc: '把每一点的斜率连起来。' },
  { id: 'n.probe', title: '观察器', group: '微积分', layer: 4, kind: 'concept', desc: '把一个量钉出来盯着看。' },
  { id: 'n.euler', title: '欧拉之环', group: '微积分', layer: 6, kind: 'weave', desc: '圆在转、波在长，θ 同时驱动它们——三者本是一件事。' },
  { id: 'w.drivenWave', title: '滑杆驱动的波', group: '微积分', layer: 5, kind: 'weave', desc: '正弦的参数交给变量——波形随你呼吸。' },
  { id: 'w.drivenCircle', title: '会呼吸的圆', group: '点与绑定', layer: 4, kind: 'weave', desc: '半径被一个量牵着，圆一张一缩。' },
  { id: 'w.limit', title: '割线逼近切线', group: '微积分', layer: 5, kind: 'weave', desc: '两点越靠越近，割线就变成了切线——这是极限。' },
  { id: 'w.calculus', title: '微积分的钥匙', group: '微积分', layer: 6, kind: 'weave', desc: '切线、积分区域与观察器同框：变化与累积同时可见。' },
  { id: 'w.spin', title: '让角自己转', group: '角与旋转', layer: 5, kind: 'weave', desc: '角被变量驱动，线绕当初那个交点转起来。' },
  { id: 'w.congruent', title: '全等三角形', group: '构造与约束', layer: 4, kind: 'weave', desc: '两个三角形面积与构成一致——可以叠合。' },
  { id: 'w.midpointDriven', title: '被牵着的中点', group: '构造与约束', layer: 4, kind: 'weave', desc: '中点约束与变量驱动合起来：一动全都动。' },
  { id: 'w.probes', title: '对照观察', group: '微积分', layer: 5, kind: 'weave', desc: '两个观察器同时盯着，差别自己浮出来。' },
  { id: 'w.parallelogram', title: '平行四边形', group: '构造与约束', layer: 4, kind: 'weave', desc: '两组对边各自平行：平行与等长在这里握手。' },
  { id: 'w.tangency', title: '直线与圆相切', group: '构造与约束', layer: 4, kind: 'weave', desc: '圆的相切关系：只碰一下却不穿过。' },
  { id: 'w.chordMid', title: '弦被平分', group: '构造与约束', layer: 4, kind: 'weave', desc: '弦与中点约束合起来：精确平分。' },
  { id: 'w.diameterRight', title: '直径上的直角', group: '构造与约束', layer: 5, kind: 'weave', desc: '直径 + 直角 + 圆：泰勒斯定理的另一种呈现。' },
  { id: 'w.funcDeriv', title: '函数与导函数', group: '微积分', layer: 5, kind: 'weave', desc: '把每一点的斜率连起来得到新曲线。' },
  { id: 'w.integralDriven', title: '被驱动的累积量', group: '微积分', layer: 5, kind: 'weave', desc: '变量一动，积分区域跟着重算。' },
  { id: 'w.probeFunc', title: '盯着函数看', group: '微积分', layer: 5, kind: 'weave', desc: '观察器与函数曲线之间的 observe 关系。' },
  { id: 'w.contactSpin', title: '接点也在转', group: '角与旋转', layer: 5, kind: 'weave', desc: '端点钉在点上、角又被驱动：转起来同步。' },
  { id: 'w.circleWave', title: '圆与波同源', group: '微积分', layer: 5, kind: 'weave', desc: '同一变量同时牵着圆与波。' },
  { id: 'w.constrainedPoly', title: '被约束的多边形', group: '构造与约束', layer: 4, kind: 'weave', desc: '形状由约束说了算，不再随手变形。' },
];

// 成就 → 知识点（每条成就都必须在这里出现，单测守着）
export const ACH_NODE = {
  'geo.point.first': 'n.point',
  'geo.segment.first': 'n.segment',
  'geo.circle.first': 'n.circle',
  'geo.var.first': 'n.variable',
  'geo.edgepoint.on': 'n.edgepoint',
  'geo.binding.first': 'n.binding',
  'geo.binding.point.xy': 'n.pointxy',
  'geo.contact.endpoint': 'n.contact',
  'geo.constraint.first': 'n.constraint',
  'geo.constraint.h_ok': 'n.horizontal',
  'geo.angle.first': 'n.angle',
  'geo.angle.right': 'n.right',
  'geo.angle.flat': 'n.flat',
  'geo.angle.zero': 'n.flat',
  'geo.polygon.first': 'n.polygon',
  'geo.triangle.born': 'n.triangle',
  'geo.func.first': 'n.func',
  'geo.sine.first': 'n.sine',
  'geo.parabola.first': 'n.parabola',
  'calc.tangent.first': 'n.tangent',
  'calc.secant.first': 'n.secant',
  'calc.integral.first': 'n.integral',
  'calc.derivcurve.first': 'n.derivcurve',
  'calc.probe.first': 'n.probe',
  'geo.angle.acute': 'n.acuteObtuse',
  'geo.angle.obtuse': 'n.acuteObtuse',
  'geo.lines.parallel': 'n.parallel',
  'geo.lines.perpendicular': 'n.perpendicular',
  'geo.segments.equal': 'n.equal',
  'geo.golden.ratio': 'n.golden',
  'geo.constraint.midpoint': 'n.midpoint',
  'geo.constraint.tangent': 'n.tangency',
  'geo.edgepoint.onCurve': 'n.edgepoint',
  'geo.points.collinear': 'n.collinear',
  'geo.chord.on.circle': 'n.chord',
  'geo.diameter': 'n.chord',
  'geo.quad.rect': 'n.quad',
  'geo.quad.square': 'n.quad',
  'geo.arc.first': 'n.arc',
  'geo.arcfree.first': 'n.arc',
  'geo.freehand.first': 'n.arc',
  'calc.probe.expr': 'n.exprProbe',
  'weave.driven.wave': 'w.drivenWave',
  'weave.driven.circle': 'w.drivenCircle',
  'weave.secant.meets.tangent': 'w.limit',
  'weave.calculus.keys': 'w.calculus',
  'weave.angle.driven.spin': 'w.spin',
  'weave.congruent.triangles': 'w.congruent',
  'weave.midpoint.driven': 'w.midpointDriven',
  'weave.probes.contrast': 'w.probes',
  'weave.parallelogram': 'w.parallelogram',
  'weave.tangency.circle': 'w.tangency',
  'weave.chord.midpoint': 'w.chordMid',
  'weave.diameter.right': 'w.diameterRight',
  'weave.func.derivative': 'w.funcDeriv',
  'weave.integral.driven': 'w.integralDriven',
  'weave.probe.on.func': 'w.probeFunc',
  'weave.contact.spin': 'w.contactSpin',
  'weave.circle.wave': 'w.circleWave',
  'weave.constrained.polygon': 'w.constrainedPoly',
  // T8 彩蛋：挂到各自主题相关的知识点上（不新增"彩蛋"分类，避免被看出来）
  'egg.nested.oncurve': 'n.edgepoint',
  'egg.tiny.area': 'n.polygon',
  'egg.too.many': 'n.segment',
  'egg.pi.precise': 'n.variable',
  'egg.mirror': 'n.collinear',
  'egg.lonely.line': 'n.segment',
  'egg.reversed': 'n.segment',
  'egg.very.long': 'n.segment',
  'egg.probe.hoard': 'n.probe',
  'egg.collector': 'n.arc',
  // T8 扩展：圆与弦族
  'geo.circle.integer.r': 'n.circle',
  'geo.circle.two': 'n.circle',
  'geo.circle.concentric': 'n.circle',
  'geo.circle.equal.r': 'n.circle',
  'geo.circle.center.point': 'n.circle',
  'geo.chord.equal': 'n.chord',
  'geo.diameter.bisects': 'n.chord',
  'geo.polygon.inscribed': 'n.polygon',
  'geo.arc.quarter': 'n.arc',
  'geo.tangent.two': 'n.tangent',
  // T8 扩展：三角形族
  'tri.isosceles': 'n.triangle',
  'tri.equilateral': 'n.triangle',
  'tri.right': 'n.triangle',
  'tri.right.isosceles': 'n.triangle',
  'tri.pythagoras': 'n.triangle',
  'tri.centroid.grid': 'n.triangle',
  'tri.area.integer': 'n.triangle',
  'tri.vertex.on.line': 'n.triangle',
  // T8 扩展：函数族
  'fn.sine.amp.one': 'n.sine',
  'fn.sine.amp.int': 'n.sine',
  'fn.sine.lam.2pi': 'n.sine',
  'fn.sine.wavelength.int': 'n.sine',
  'fn.sine.phi.zero': 'n.sine',
  'fn.sine.through.origin': 'n.sine',
  'fn.sine.even': 'n.sine',
  'fn.sine.periodic.sampled': 'n.sine',
  'fn.parabola.opens.up': 'n.parabola',
  'fn.parabola.opens.down': 'n.parabola',
  'fn.parabola.vertex.on.axis': 'n.parabola',
  'fn.func.identity': 'n.func',
  'weave.thales': 'n.thales',
  'weave.euler.ring': 'n.euler',
};

export const nodeById = (id) => KNOWLEDGE_NODES.find((n) => n.id === id) || null;

// 依赖连线（左→右）：由"成就 requires"自动推导 + 显式补充的依赖链
// 依赖连线：**严格从左到右**（起点层 < 终点层）。这些才是"先掌握 A 才可能做 B"。
export const EXTRA_DEP_EDGES = [
  ['n.segment', 'n.edgepoint'],
  ['n.edgepoint', 'n.contact'], ['n.binding', 'n.contact'], ['n.binding', 'n.pointxy'],
  ['n.angle', 'n.right'], ['n.angle', 'n.angledrive'],
  ['n.angledrive', 'n.spin'], ['n.polygon', 'n.triangle'], ['n.constraint', 'n.horizontal'],
  ['n.func', 'n.sine'], ['n.func', 'n.parabola'], ['n.sine', 'n.tangent'],
  ['n.tangent', 'n.integral'], ['n.tangent', 'n.derivcurve'],
  ['n.circle', 'n.thales'], ['n.angle', 'n.thales'],
  ['n.circle', 'n.euler'], ['n.sine', 'n.euler'], ['n.variable', 'n.euler'], ['n.binding', 'n.euler'],
];

// 同组相关连线：表达"这两个知识点是一家人"，**不表示先后**，因此允许同层。
// （画在星图上是同层内的横向连线；依赖连线才是跨列的斜线。）
export const RELATED_EDGES = [
  ['n.point', 'n.segment'], ['n.point', 'n.circle'],     // 都由点构成，但谁先谁后取决于用户
  ['n.right', 'n.flat'],                                  // 90° 与 0°/180°：同一套射线关系的不同情形
  ['n.secant', 'n.tangent'],                              // 平均变化率 → 瞬时变化率
  ['n.integral', 'n.probe'],                              // 积分与观察器常在同一个探究里出现
  ['n.parallel', 'n.perpendicular'],                      // 一对"方向关系"的两种极端
  ['n.equal', 'n.golden'],                                // 比的两种特殊值：1 与 1.618
  ['n.midpoint', 'n.collinear'],                          // 都在讲"点之间的位置关系"
];

// 自动推导：B 类成就的 requires → 其节点与前置成就的节点之间的连线
export function derivedDepEdges(patterns) {
  const out = [];
  for (const p of patterns) {
    const to = ACH_NODE[p.id];
    if (!to) continue;
    for (const rid of p.requires || []) {
      const from = ACH_NODE[rid];
      if (from && from !== to) out.push([from, to]);
    }
  }
  return out;
}

export function allRelatedEdges() {
  return RELATED_EDGES.filter(([a, b]) => a !== b && nodeById(a) && nodeById(b));
}

export function allDepEdges(patterns) {
  const seen = new Set();
  const out = [];
  for (const [a, b] of [...EXTRA_DEP_EDGES, ...derivedDepEdges(patterns)]) {
    const k = `${a}|${b}`;
    if (seen.has(k) || a === b) continue;
    seen.add(k);
    out.push([a, b]);
  }
  return out;
}
