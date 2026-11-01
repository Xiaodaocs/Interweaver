// 由 app/src/achievements/nodes.js + patterns.js 提取生成（宣传片星图数据，勿手改）
export const KNOWLEDGE = {
 "groups": [
  "点与绑定",
  "角与旋转",
  "构造与约束",
  "微积分"
 ],
 "nodes": [
  {
   "id": "n.point",
   "title": "点",
   "group": "点与绑定",
   "layer": 0,
   "kind": "concept",
   "desc": "一个位置，由 x、y 两个参数决定。"
  },
  {
   "id": "n.segment",
   "title": "线段",
   "group": "点与绑定",
   "layer": 0,
   "kind": "concept",
   "desc": "两点之间的直段，有长度与方向。"
  },
  {
   "id": "n.circle",
   "title": "圆",
   "group": "点与绑定",
   "layer": 0,
   "kind": "concept",
   "desc": "到定点等距的所有点。"
  },
  {
   "id": "n.variable",
   "title": "变量",
   "group": "点与绑定",
   "layer": 0,
   "kind": "concept",
   "desc": "一个可以被滑杆、动画或别处驱动的量。"
  },
  {
   "id": "n.edgepoint",
   "title": "线上点",
   "group": "点与绑定",
   "layer": 1,
   "kind": "concept",
   "desc": "按参数 t 挂在某条曲线上的点。"
  },
  {
   "id": "n.binding",
   "title": "关联",
   "group": "点与绑定",
   "layer": 1,
   "kind": "concept",
   "desc": "一个参数由另一个量决定（单向依赖）。"
  },
  {
   "id": "n.contact",
   "title": "接点",
   "group": "点与绑定",
   "layer": 2,
   "kind": "concept",
   "desc": "线端与点重合绑定，从此同进同退。"
  },
  {
   "id": "n.pointxy",
   "title": "双端驱动",
   "group": "点与绑定",
   "layer": 2,
   "kind": "concept",
   "desc": "一个点的 x 与 y 都由别处决定。"
  },
  {
   "id": "n.angle",
   "title": "角",
   "group": "角与旋转",
   "layer": 1,
   "kind": "concept",
   "desc": "两条射线张开的那块地方。"
  },
  {
   "id": "n.right",
   "title": "直角",
   "group": "角与旋转",
   "layer": 2,
   "kind": "concept",
   "desc": "90°：最稳的那一个角。"
  },
  {
   "id": "n.flat",
   "title": "平角与零角",
   "group": "角与旋转",
   "layer": 2,
   "kind": "concept",
   "desc": "180° 与 0°：方向相反或一致。"
  },
  {
   "id": "n.angledrive",
   "title": "角度驱动",
   "group": "角与旋转",
   "layer": 3,
   "kind": "concept",
   "desc": "用变量驱动一条线的角度。"
  },
  {
   "id": "n.spin",
   "title": "绕交点旋转",
   "group": "角与旋转",
   "layer": 4,
   "kind": "concept",
   "desc": "旋转的中心是当初设立角度的那个交点。"
  },
  {
   "id": "n.polygon",
   "title": "多边形",
   "group": "构造与约束",
   "layer": 1,
   "kind": "concept",
   "desc": "闭合的边围出一块面积。"
  },
  {
   "id": "n.triangle",
   "title": "三角形",
   "group": "构造与约束",
   "layer": 2,
   "kind": "concept",
   "desc": "三条边、三个角、一块面积。"
  },
  {
   "id": "n.chord",
   "title": "弦与直径",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "两端落在圆上的线段；过圆心的那条是直径。"
  },
  {
   "id": "n.quad",
   "title": "矩形与正方形",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "四边形的直角与等边条件。"
  },
  {
   "id": "n.arc",
   "title": "弧与手绘曲线",
   "group": "点与绑定",
   "layer": 2,
   "kind": "concept",
   "desc": "圆的一段、扫出的弧、以及直接画出来的曲线。"
  },
  {
   "id": "n.exprProbe",
   "title": "表达式观察器",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "不只是看一个量，而是看一个式子（例如差）。"
  },
  {
   "id": "n.constraint",
   "title": "约束",
   "group": "构造与约束",
   "layer": 2,
   "kind": "concept",
   "desc": "声明式的\"必须是那样\"，由求解器负责摆平。"
  },
  {
   "id": "n.acuteObtuse",
   "title": "锐角与钝角",
   "group": "角与旋转",
   "layer": 2,
   "kind": "concept",
   "desc": "小于 90° 与大于 90°：角的大小是个连续量。"
  },
  {
   "id": "n.parallel",
   "title": "平行",
   "group": "构造与约束",
   "layer": 2,
   "kind": "concept",
   "desc": "方向完全相同、永不相遇。"
  },
  {
   "id": "n.perpendicular",
   "title": "垂直",
   "group": "构造与约束",
   "layer": 2,
   "kind": "concept",
   "desc": "方向正交：点积为零。"
  },
  {
   "id": "n.equal",
   "title": "等长",
   "group": "构造与约束",
   "layer": 2,
   "kind": "concept",
   "desc": "一样长：比值为 1。"
  },
  {
   "id": "n.golden",
   "title": "黄金比例",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "1.618：较长段与全长之比等于较短段与较长段之比。"
  },
  {
   "id": "n.midpoint",
   "title": "中点",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "把一个点钉在一段的正中间。"
  },
  {
   "id": "n.tangency",
   "title": "相切",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "只碰一下，却不穿过。"
  },
  {
   "id": "n.collinear",
   "title": "共线",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "若干点排在同一条直线上。"
  },
  {
   "id": "n.horizontal",
   "title": "水平与竖直",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "相对世界坐标系的水平/竖直，残差 <1e-6 才算真的满足。"
  },
  {
   "id": "n.thales",
   "title": "泰勒斯定理",
   "group": "构造与约束",
   "layer": 5,
   "kind": "weave",
   "desc": "直径所对的圆周角是直角——把\"圆\"与\"角\"接上了。"
  },
  {
   "id": "n.func",
   "title": "函数曲线",
   "group": "微积分",
   "layer": 1,
   "kind": "concept",
   "desc": "让 x 牵着 y 走。"
  },
  {
   "id": "n.sine",
   "title": "正弦波",
   "group": "微积分",
   "layer": 2,
   "kind": "concept",
   "desc": "圆周运动的影子是一条波。"
  },
  {
   "id": "n.parabola",
   "title": "抛物线",
   "group": "微积分",
   "layer": 2,
   "kind": "concept",
   "desc": "等加速运动的轨迹。"
  },
  {
   "id": "n.tangent",
   "title": "切线",
   "group": "微积分",
   "layer": 3,
   "kind": "concept",
   "desc": "只碰一下，却指出了方向（瞬时变化率）。"
  },
  {
   "id": "n.secant",
   "title": "割线",
   "group": "微积分",
   "layer": 3,
   "kind": "concept",
   "desc": "两点连一线，平均变化率。"
  },
  {
   "id": "n.integral",
   "title": "积分区域",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "把面积切成一条条细长条。"
  },
  {
   "id": "n.derivcurve",
   "title": "导函数曲线",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "把每一点的斜率连起来。"
  },
  {
   "id": "n.probe",
   "title": "观察器",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "把一个量钉出来盯着看。"
  },
  {
   "id": "n.euler",
   "title": "欧拉之环",
   "group": "微积分",
   "layer": 6,
   "kind": "weave",
   "desc": "圆在转、波在长，θ 同时驱动它们——三者本是一件事。"
  },
  {
   "id": "w.drivenWave",
   "title": "滑杆驱动的波",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "正弦的参数交给变量——波形随你呼吸。"
  },
  {
   "id": "w.drivenCircle",
   "title": "会呼吸的圆",
   "group": "点与绑定",
   "layer": 4,
   "kind": "weave",
   "desc": "半径被一个量牵着，圆一张一缩。"
  },
  {
   "id": "w.limit",
   "title": "割线逼近切线",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "两点越靠越近，割线就变成了切线——这是极限。"
  },
  {
   "id": "w.calculus",
   "title": "微积分的钥匙",
   "group": "微积分",
   "layer": 6,
   "kind": "weave",
   "desc": "切线、积分区域与观察器同框：变化与累积同时可见。"
  },
  {
   "id": "w.spin",
   "title": "让角自己转",
   "group": "角与旋转",
   "layer": 5,
   "kind": "weave",
   "desc": "角被变量驱动，线绕当初那个交点转起来。"
  },
  {
   "id": "w.congruent",
   "title": "全等三角形",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "两个三角形面积与构成一致——可以叠合。"
  },
  {
   "id": "w.midpointDriven",
   "title": "被牵着的中点",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "中点约束与变量驱动合起来：一动全都动。"
  },
  {
   "id": "w.probes",
   "title": "对照观察",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "两个观察器同时盯着，差别自己浮出来。"
  },
  {
   "id": "w.parallelogram",
   "title": "平行四边形",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "两组对边各自平行：平行与等长在这里握手。"
  },
  {
   "id": "w.tangency",
   "title": "直线与圆相切",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "圆的相切关系：只碰一下却不穿过。"
  },
  {
   "id": "w.chordMid",
   "title": "弦被平分",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "弦与中点约束合起来：精确平分。"
  },
  {
   "id": "w.diameterRight",
   "title": "直径上的直角",
   "group": "构造与约束",
   "layer": 5,
   "kind": "weave",
   "desc": "直径 + 直角 + 圆：泰勒斯定理的另一种呈现。"
  },
  {
   "id": "w.funcDeriv",
   "title": "函数与导函数",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "把每一点的斜率连起来得到新曲线。"
  },
  {
   "id": "w.integralDriven",
   "title": "被驱动的累积量",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "变量一动，积分区域跟着重算。"
  },
  {
   "id": "w.probeFunc",
   "title": "盯着函数看",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "观察器与函数曲线之间的 observe 关系。"
  },
  {
   "id": "w.contactSpin",
   "title": "接点也在转",
   "group": "角与旋转",
   "layer": 5,
   "kind": "weave",
   "desc": "端点钉在点上、角又被驱动：转起来同步。"
  },
  {
   "id": "w.circleWave",
   "title": "圆与波同源",
   "group": "微积分",
   "layer": 5,
   "kind": "weave",
   "desc": "同一变量同时牵着圆与波。"
  },
  {
   "id": "w.constrainedPoly",
   "title": "被约束的多边形",
   "group": "构造与约束",
   "layer": 4,
   "kind": "weave",
   "desc": "形状由约束说了算，不再随手变形。"
  },
  {
   "id": "n.unitcircle",
   "title": "单位圆",
   "group": "角与旋转",
   "layer": 2,
   "kind": "concept",
   "desc": "半径归一化后，圆上的位置只剩一个数：角。几何走向分析的第一道门。"
  },
  {
   "id": "n.phase",
   "title": "相位",
   "group": "角与旋转",
   "layer": 3,
   "kind": "concept",
   "desc": "让角随时间走，它就成了相位——旋转与波之间唯一的那座桥。"
  },
  {
   "id": "n.family",
   "title": "参数族",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "让参数扫一遍取值域，得到的不是一个图形，而是一族图形。"
  },
  {
   "id": "n.invariant",
   "title": "不变量",
   "group": "构造与约束",
   "layer": 3,
   "kind": "concept",
   "desc": "允许怎么变、什么不允许变——结构就是这样被定义的。"
  },
  {
   "id": "n.limit",
   "title": "极限",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "不是\"到了\"，而是\"要多近有多近\"。现代分析的全部地基。"
  },
  {
   "id": "n.rate",
   "title": "变化率",
   "group": "微积分",
   "layer": 4,
   "kind": "concept",
   "desc": "两点之间的平均变化，随着第二点逼近第一点，逼出\"此刻\"的变化。"
  },
  {
   "id": "n.accum",
   "title": "累积",
   "group": "微积分",
   "layer": 5,
   "kind": "concept",
   "desc": "无限细分再求和——积分的抽象面，与变化率互为逆运算。"
  },
  {
   "id": "n.readout",
   "title": "读数",
   "group": "微积分",
   "layer": 5,
   "kind": "concept",
   "desc": "把几何量变成数：观察器之所以算\"仪器\"，就在这一步。"
  }
 ],
 "depEdges": [
  [
   "n.segment",
   "n.edgepoint"
  ],
  [
   "n.edgepoint",
   "n.contact"
  ],
  [
   "n.binding",
   "n.contact"
  ],
  [
   "n.binding",
   "n.pointxy"
  ],
  [
   "n.angle",
   "n.right"
  ],
  [
   "n.angle",
   "n.angledrive"
  ],
  [
   "n.angledrive",
   "n.spin"
  ],
  [
   "n.polygon",
   "n.triangle"
  ],
  [
   "n.constraint",
   "n.horizontal"
  ],
  [
   "n.func",
   "n.sine"
  ],
  [
   "n.func",
   "n.parabola"
  ],
  [
   "n.sine",
   "n.tangent"
  ],
  [
   "n.tangent",
   "n.integral"
  ],
  [
   "n.tangent",
   "n.derivcurve"
  ],
  [
   "n.circle",
   "n.thales"
  ],
  [
   "n.angle",
   "n.thales"
  ],
  [
   "n.circle",
   "n.euler"
  ],
  [
   "n.sine",
   "n.euler"
  ],
  [
   "n.variable",
   "n.euler"
  ],
  [
   "n.binding",
   "n.euler"
  ],
  [
   "n.edgepoint",
   "n.unitcircle"
  ],
  [
   "n.unitcircle",
   "n.phase"
  ],
  [
   "n.phase",
   "w.drivenCircle"
  ],
  [
   "w.drivenCircle",
   "w.circleWave"
  ],
  [
   "w.circleWave",
   "n.euler"
  ],
  [
   "n.variable",
   "n.func"
  ],
  [
   "n.sine",
   "n.family"
  ],
  [
   "n.family",
   "n.rate"
  ],
  [
   "n.rate",
   "w.integralDriven"
  ],
  [
   "w.integralDriven",
   "n.euler"
  ],
  [
   "n.secant",
   "n.limit"
  ],
  [
   "n.limit",
   "n.accum"
  ],
  [
   "n.tangent",
   "n.rate"
  ],
  [
   "n.integral",
   "n.accum"
  ],
  [
   "n.probe",
   "n.readout"
  ],
  [
   "n.invariant",
   "n.integral"
  ],
  [
   "n.edgepoint",
   "n.thales"
  ],
  [
   "n.sine",
   "w.drivenWave"
  ],
  [
   "n.variable",
   "w.drivenWave"
  ],
  [
   "n.binding",
   "w.drivenWave"
  ],
  [
   "n.circle",
   "w.drivenCircle"
  ],
  [
   "n.variable",
   "w.drivenCircle"
  ],
  [
   "n.binding",
   "w.drivenCircle"
  ],
  [
   "n.secant",
   "w.limit"
  ],
  [
   "n.tangent",
   "w.limit"
  ],
  [
   "n.binding",
   "w.limit"
  ],
  [
   "n.tangent",
   "w.calculus"
  ],
  [
   "n.integral",
   "w.calculus"
  ],
  [
   "n.probe",
   "w.calculus"
  ],
  [
   "n.angle",
   "w.spin"
  ],
  [
   "n.variable",
   "w.spin"
  ],
  [
   "n.binding",
   "w.spin"
  ],
  [
   "n.triangle",
   "w.congruent"
  ],
  [
   "n.equal",
   "w.congruent"
  ],
  [
   "n.midpoint",
   "w.midpointDriven"
  ],
  [
   "n.binding",
   "w.midpointDriven"
  ],
  [
   "n.variable",
   "w.midpointDriven"
  ],
  [
   "n.probe",
   "w.probes"
  ],
  [
   "n.variable",
   "w.probes"
  ],
  [
   "n.parallel",
   "w.parallelogram"
  ],
  [
   "n.equal",
   "w.parallelogram"
  ],
  [
   "n.tangency",
   "w.tangency"
  ],
  [
   "n.circle",
   "w.tangency"
  ],
  [
   "n.chord",
   "w.chordMid"
  ],
  [
   "n.midpoint",
   "w.chordMid"
  ],
  [
   "n.chord",
   "w.diameterRight"
  ],
  [
   "n.right",
   "w.diameterRight"
  ],
  [
   "n.func",
   "w.funcDeriv"
  ],
  [
   "n.derivcurve",
   "w.funcDeriv"
  ],
  [
   "n.integral",
   "w.integralDriven"
  ],
  [
   "n.variable",
   "w.integralDriven"
  ],
  [
   "n.binding",
   "w.integralDriven"
  ],
  [
   "n.probe",
   "w.probeFunc"
  ],
  [
   "n.func",
   "w.probeFunc"
  ],
  [
   "n.contact",
   "w.contactSpin"
  ],
  [
   "n.angle",
   "w.contactSpin"
  ],
  [
   "n.circle",
   "w.circleWave"
  ],
  [
   "n.sine",
   "w.circleWave"
  ],
  [
   "n.polygon",
   "w.constrainedPoly"
  ],
  [
   "n.constraint",
   "w.constrainedPoly"
  ]
 ],
 "relatedEdges": [
  [
   "n.point",
   "n.segment"
  ],
  [
   "n.point",
   "n.circle"
  ],
  [
   "n.right",
   "n.flat"
  ],
  [
   "n.secant",
   "n.tangent"
  ],
  [
   "n.integral",
   "n.probe"
  ],
  [
   "n.parallel",
   "n.perpendicular"
  ],
  [
   "n.equal",
   "n.golden"
  ],
  [
   "n.midpoint",
   "n.collinear"
  ],
  [
   "n.sine",
   "n.triangle"
  ]
 ]
};
