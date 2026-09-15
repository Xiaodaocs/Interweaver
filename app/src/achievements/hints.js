// T6/T8 · 未激活时的"一句暗示"（设计 §7.3：每条成就都必须有 hint，≤22 字，由单测强制）
//
// 写作规则（§6.3 的暗示部分）：**短而精**、给方向不给答案、不用"试试看"这类空话。
// 彩蛋的暗示写在 easterEggs.js 里（随彩蛋数据一起），这里覆盖其余 62 条。
export const HINTS = {
  // —— 基础构造 ——
  'geo.point.first': '先放一个位置下来',
  'geo.segment.first': '两点之间连一条直的',
  'geo.circle.first': '画一个到定点等距的图形',
  'geo.polygon.first': '让几条边首尾相接围起来',
  'geo.triangle.born': '三条线，首尾相接',
  'geo.edgepoint.on': '把点放在一条线上',
  'geo.edgepoint.onCurve': '把点放在一条曲线（波/抛物线）上',
  'geo.var.first': '给一个可以变的量取个名',
  'geo.func.first': '让 x 牵着 y 走',
  'geo.sine.first': '画一条会起伏的波',
  'geo.parabola.first': '画一条等加速的轨迹',
  // —— 关系与绑定 ——
  'geo.binding.first': '让一个参数由另一个量决定',
  'geo.binding.point.xy': '把一个点的 x 和 y 都交给别处',
  'geo.contact.endpoint': '把线的一头按在点上',
  'geo.constraint.first': '声明"它必须是那样"',
  'geo.constraint.h_ok': '让一条线真正被约束成水平',
  'geo.constraint.midpoint': '把一个点钉在一段的正中间',
  'geo.constraint.tangent': '让一条线只碰圆一下',
  // —— 角 ——
  'geo.angle.first': '量出两条线之间的那个角',
  'geo.angle.right': '让两条线正好正交',
  'geo.angle.flat': '让两条射线背对背',
  'geo.angle.zero': '让两条射线方向完全一致',
  'geo.angle.acute': '量一个比直角小的角',
  'geo.angle.obtuse': '量一个比直角大的角',
  // —— 线与线 ——
  'geo.lines.parallel': '画两条方向完全一样、却不相遇的线',
  'geo.lines.perpendicular': '让两条线的方向正交',
  'geo.segments.equal': '让两段线一样长',
  'geo.golden.ratio': '让两段长度之比靠近 1.618',
  'geo.points.collinear': '让三个点排成一条直线',
  // —— 圆 ——
  'geo.chord.on.circle': '让一条线段两端都落在圆上',
  'geo.diameter': '让这条弦穿过圆心',
  'geo.arc.first': '取圆的一段作为弧',
  'geo.arcfree.first': '自己扫出一段弧',
  'geo.freehand.first': '不用公式，直接画一条曲线',
  // —— 四边形 ——
  'geo.quad.rect': '画一个四个角都是直角的四边形',
  'geo.quad.square': '让四边等长，且有一个直角',
  // —— 微积分 ——
  'calc.tangent.first': '在曲线上的某点作切线',
  'calc.secant.first': '在曲线上连两点的割线',
  'calc.integral.first': '把曲线下的面积切成细条',
  'calc.derivcurve.first': '把每一点的斜率连成一条新曲线',
  'calc.probe.first': '把一个量钉出来盯着看',
  'calc.probe.expr': '让观察器盯一个式子而不是单个量',

  // —— B 类交织 ——
  'weave.thales': '直径所对的圆周角，试试看成多少度',
  'weave.euler.ring': '把圆和波接到同一个变量上',
  'weave.driven.wave': '把波的参数交给一个滑杆',
  'weave.driven.circle': '让圆的半径被一个量牵着',
  'weave.secant.meets.tangent': '让割线的两点越靠越近',
  'weave.calculus.keys': '把切线、积分区域与观察器放到同一场景',
  'weave.angle.driven.spin': '让角的两条线里至少一条被驱动',
  'weave.congruent.triangles': '画两个面积与构成一致的三角形',
  'weave.midpoint.driven': '中点约束 + 一个变量驱动的量',
  'weave.probes.contrast': '放两个观察器，对比着看',
  'weave.parallelogram': '四边形两组对边各自平行',
  'weave.tangency.circle': '给圆和直线之间加一条相切约束',
  'weave.chord.midpoint': '在圆里画一条弦，再把它平分',
  'weave.diameter.right': '圆里画一条直径，再找个直角',
  'weave.func.derivative': '同场景里放函数与它的导函数曲线',
  'weave.integral.driven': '让一个变量驱动积分区域里的量',
  'weave.probe.on.func': '用观察器盯住一条函数曲线',
  'weave.contact.spin': '接点 + 一个角，放在同一场景',
  'weave.circle.wave': '同一个变量同时牵着圆与波',
  'weave.constrained.polygon': '给多边形挂上一条几何约束',
};

/** 把暗示补到模式上（已自带 hint 的彩蛋不动） */
export function applyHints(patterns) {
  let filled = 0;
  for (const p of patterns) {
    if (!p.hint && HINTS[p.id]) { p.hint = HINTS[p.id]; filled++; }
  }
  return filled;
}
