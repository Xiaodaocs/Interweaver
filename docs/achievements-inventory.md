# 成就完整信息清单（自动生成，请勿手改）

生成来源：`src/achievements/patterns.js` + `src/achievements/nodes.js`

- 成就总数：**134**（A 类独石 114 / B 类交织 20）
- 知识点：**65** 个
- **判定条件完全同源的组：7 组，涉及 22 条成就**（这些就是"一个操作同时解锁多个"的重灾区）

## ⚠ 判定条件完全同源的组（同一份判据被多条成就共用）

### 组：「第一条线段」 / 「反向操作」 / 「长到没边」

- id：`geo.segment.first`、`egg.reversed`、`egg.very.long`
- 类别：solo、solo、solo｜前置：无、无、无
- 判据形状：节点 [segment]｜边 []｜模式级 where=无
- 归属知识点：线段、线段、线段

### 组：「闭合的多边形」 / 「第一块基石」 / 「这也行？」

- id：`geo.polygon.first`、`geo.triangle.born`、`egg.tiny.area`
- 类别：solo、solo、solo｜前置：无、无、无
- 判据形状：节点 [polygon]｜边 []｜模式级 where=无
- 归属知识点：多边形、三角形、多边形

### 组：「第一次约束」 / 「水平」 / 「中点」 / 「相切」

- id：`geo.constraint.first`、`geo.constraint.h_ok`、`geo.constraint.midpoint`、`geo.constraint.tangent`
- 类别：solo、solo、solo、solo｜前置：无、无、无、无
- 判据形状：节点 [constraint]｜边 []｜模式级 where=无
- 归属知识点：约束、水平与竖直、中点、相切

### 组：「量出一个角」 / 「直角」 / 「平角」 / 「零角」 / 「锐角」 / 「钝角」

- id：`geo.angle.first`、`geo.angle.right`、`geo.angle.flat`、`geo.angle.zero`、`geo.angle.acute`、`geo.angle.obtuse`
- 类别：solo、solo、solo、solo、solo、solo｜前置：无、无、无、无、无、无
- 判据形状：节点 [joint]｜边 []｜模式级 where=无
- 归属知识点：角、直角、平角与零角、平角与零角、锐角与钝角、锐角与钝角

### 组：「第一个观察器」 / 「表达式观察器」

- id：`calc.probe.first`、`calc.probe.expr`
- 类别：solo、solo｜前置：无、无
- 判据形状：节点 [probe]｜边 []｜模式级 where=无
- 归属知识点：观察器、表达式观察器

### 组：「自由弧段」 / 「四分之一弧」

- id：`geo.arcfree.first`、`geo.arc.quarter`
- 类别：solo、solo｜前置：无、无
- 判据形状：节点 [arcfree]｜边 []｜模式级 where=无
- 归属知识点：弧与手绘曲线、弧与手绘曲线

### 组：「严丝合缝」 / 「真的水平了」

- id：`con.one.exact`、`con.horizontal.exact`
- 类别：solo、solo｜前置：无、无
- 判据形状：节点 [constraint]｜边 []｜模式级 where=有
- 归属知识点：约束、约束

## 全部成就一览

| # | id | 标题 | 类别 | 前置 | 判据（节点/边） | 归属知识点 |
|---|----|------|------|------|------------------|------------|
| 1 | `geo.point.first` | 第一个点 | A 独石 | — | point | 点 |
| 2 | `geo.segment.first` | 第一条线段 | A 独石 | — | segment(谓词) | 线段 |
| 3 | `geo.circle.first` | 一个圆 | A 独石 | — | circle(谓词) | 圆 |
| 4 | `geo.polygon.first` | 闭合的多边形 | A 独石 | — | polygon(谓词) | 多边形 |
| 5 | `geo.triangle.born` | 第一块基石 | A 独石 | — | polygon(谓词) | 三角形 |
| 6 | `geo.edgepoint.on` | 会滑动的点 | A 独石 | — | edgepoint（+模式级谓词） | 线上点 |
| 7 | `geo.var.first` | 第一个变量 | A 独石 | — | variable | 变量 |
| 8 | `geo.func.first` | 第一根函数曲线 | A 独石 | — | func | 函数曲线 |
| 9 | `geo.sine.first` | 一条正弦波 | A 独石 | — | sine | 正弦波 |
| 10 | `geo.parabola.first` | 一条抛物线 | A 独石 | — | parabola | 抛物线 |
| 11 | `geo.binding.first` | 第一次关联 | A 独石 | — | *（+模式级谓词） | 关联 |
| 12 | `geo.binding.point.xy` | 一点两命 | A 独石 | — | point（+模式级谓词） | 双端驱动 |
| 13 | `geo.contact.endpoint` | 接点 | A 独石 | — | segment + edgepoint｜coincident | 接点 |
| 14 | `geo.constraint.first` | 第一次约束 | A 独石 | — | constraint | 约束 |
| 15 | `geo.angle.first` | 量出一个角 | A 独石 | — | joint(谓词) | 角 |
| 16 | `geo.angle.right` | 直角 | A 独石 | — | joint(谓词) | 直角 |
| 17 | `geo.angle.flat` | 平角 | A 独石 | — | joint(谓词) | 平角与零角 |
| 18 | `geo.angle.zero` | 零角 | A 独石 | — | joint(谓词) | 平角与零角 |
| 19 | `calc.tangent.first` | 切线 | A 独石 | — | tangent | 切线 |
| 20 | `calc.secant.first` | 割线 | A 独石 | — | secant | 割线 |
| 21 | `calc.integral.first` | 积分区域 | A 独石 | — | integral | 积分区域 |
| 22 | `calc.derivcurve.first` | 导函数曲线 | A 独石 | — | derivcurve | 导函数曲线 |
| 23 | `calc.probe.first` | 第一个观察器 | A 独石 | — | probe | 观察器 |
| 24 | `geo.constraint.h_ok` | 水平 | A 独石 | — | constraint(谓词) | 水平与竖直 |
| 25 | `geo.angle.acute` | 锐角 | A 独石 | — | joint(谓词) | 锐角与钝角 |
| 26 | `geo.angle.obtuse` | 钝角 | A 独石 | — | joint(谓词) | 锐角与钝角 |
| 27 | `geo.lines.parallel` | 两条平行线 | A 独石 | — | segment + segment（+模式级谓词） | 平行 |
| 28 | `geo.lines.perpendicular` | 两条垂直线 | A 独石 | — | segment + segment（+模式级谓词） | 垂直 |
| 29 | `geo.segments.equal` | 等长的两条线 | A 独石 | — | segment + segment（+模式级谓词） | 等长 |
| 30 | `geo.golden.ratio` | 黄金比例 | A 独石 | — | segment + segment（+模式级谓词） | 黄金比例 |
| 31 | `geo.constraint.midpoint` | 中点 | A 独石 | — | constraint(谓词) | 中点 |
| 32 | `geo.constraint.tangent` | 相切 | A 独石 | — | constraint(谓词) | 相切 |
| 33 | `geo.edgepoint.onCurve` | 曲线上的点 | A 独石 | — | edgepoint（+模式级谓词） | 线上点 |
| 34 | `geo.points.collinear` | 三点共线 | A 独石 | — | point + point + point（+模式级谓词） | 共线 |
| 35 | `geo.chord.on.circle` | 弦 | A 独石 | — | segment + circle(谓词)（+模式级谓词） | 弦与直径 |
| 36 | `geo.diameter` | 直径 | A 独石 | — | segment + circle(谓词)（+模式级谓词） | 弦与直径 |
| 37 | `geo.quad.rect` | 矩形 | A 独石 | — | polygon(谓词)（+模式级谓词） | 矩形与正方形 |
| 38 | `geo.quad.square` | 正方形 | A 独石 | — | polygon(谓词)（+模式级谓词） | 矩形与正方形 |
| 39 | `geo.arc.first` | 一条弧 | A 独石 | — | arc | 弧与手绘曲线 |
| 40 | `geo.arcfree.first` | 自由弧段 | A 独石 | — | arcfree | 弧与手绘曲线 |
| 41 | `geo.freehand.first` | 手绘的曲线 | A 独石 | — | freehand | 弧与手绘曲线 |
| 42 | `calc.probe.expr` | 表达式观察器 | A 独石 | — | probe(谓词) | 表达式观察器 |
| 43 | `egg.nested.oncurve` | 线上点上线上点 | A 独石 | — | edgepoint（+模式级谓词） | 线上点 |
| 44 | `egg.tiny.area` | 这也行？ | A 独石 | — | polygon(谓词) | 多边形 |
| 45 | `egg.too.many` | 够了，真的够了 | A 独石 | — | segment（+模式级谓词） | 线段 |
| 46 | `egg.pi.precise` | 无用的精确 | A 独石 | — | *（+模式级谓词） | 变量 |
| 47 | `egg.mirror` | 完 美 对 称 | A 独石 | — | segment（+模式级谓词） | 共线 |
| 48 | `egg.lonely.line` | 一条线的孤独 | A 独石 | — | segment（+模式级谓词） | 线段 |
| 49 | `egg.reversed` | 反向操作 | A 独石 | — | segment(谓词) | 线段 |
| 50 | `egg.very.long` | 长到没边 | A 独石 | — | segment(谓词) | 线段 |
| 51 | `egg.probe.hoard` | 观察成瘾 | A 独石 | — | probe + probe + probe | 观察器 |
| 52 | `egg.collector` | 收藏家 | A 独石 | — | segment（+模式级谓词） | 弧与手绘曲线 |
| 53 | `geo.circle.integer.r` | 整数半径 | A 独石 | — | circle(谓词)（+模式级谓词） | 圆 |
| 54 | `geo.circle.two` | 两个圆 | A 独石 | — | circle + circle | 圆 |
| 55 | `geo.circle.concentric` | 同心圆 | A 独石 | — | circle + circle（+模式级谓词） | 圆 |
| 56 | `geo.circle.equal.r` | 等半径 | A 独石 | — | circle + circle（+模式级谓词） | 圆 |
| 57 | `geo.circle.center.point` | 圆心上的点 | A 独石 | — | point + circle（+模式级谓词） | 圆 |
| 58 | `geo.chord.equal` | 等长两弦 | A 独石 | — | segment + segment + circle（+模式级谓词） | 弦与直径 |
| 59 | `geo.diameter.bisects` | 直径平分弦 | A 独石 | — | segment + segment + circle（+模式级谓词） | 弦与直径 |
| 60 | `geo.polygon.inscribed` | 圆内接多边形 | A 独石 | — | polygon(谓词) + circle（+模式级谓词） | 多边形 |
| 61 | `geo.arc.quarter` | 四分之一弧 | A 独石 | — | arcfree(谓词) | 弧与手绘曲线 |
| 62 | `geo.tangent.two` | 两条切线 | A 独石 | — | tangent + tangent（+模式级谓词） | 切线 |
| 63 | `tri.isosceles` | 等腰三角形 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 64 | `tri.equilateral` | 等边三角形 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 65 | `tri.right` | 直角三角形 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 66 | `tri.right.isosceles` | 等腰直角 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 67 | `tri.pythagoras` | 勾股定理 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 68 | `tri.centroid.grid` | 重心在格点 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 69 | `tri.area.integer` | 整数面积 | A 独石 | — | polygon(谓词)（+模式级谓词） | 三角形 |
| 70 | `tri.vertex.on.line` | 顶点落在线上 | A 独石 | — | polygon(谓词) + segment（+模式级谓词） | 三角形 |
| 71 | `fn.sine.amp.one` | 标准振幅 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 72 | `fn.sine.amp.int` | 整数振幅 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 73 | `fn.sine.lam.2pi` | 标准波长 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 74 | `fn.sine.wavelength.int` | 整数波长 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 75 | `fn.sine.phi.zero` | 相位为零 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 76 | `fn.sine.through.origin` | 过原点的波 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 77 | `fn.sine.even` | 偶函数 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 78 | `fn.sine.periodic.sampled` | 确实是周期 | A 独石 | — | sine（+模式级谓词） | 正弦波 |
| 79 | `fn.parabola.opens.up` | 开口向上 | A 独石 | — | parabola（+模式级谓词） | 抛物线 |
| 80 | `fn.parabola.opens.down` | 开口向下 | A 独石 | — | parabola（+模式级谓词） | 抛物线 |
| 81 | `fn.parabola.vertex.on.axis` | 顶点在 y 轴 | A 独石 | — | parabola（+模式级谓词） | 抛物线 |
| 82 | `fn.func.identity` | 恒等函数 | A 独石 | — | func（+模式级谓词） | 函数曲线 |
| 83 | `tf.points.mirror.x` | 关于 x 轴对称 | A 独石 | — | point + point（+模式级谓词） | 共线 |
| 84 | `tf.points.mirror.y` | 关于 y 轴对称 | A 独石 | — | point + point（+模式级谓词） | 共线 |
| 85 | `tf.points.center.symmetric` | 中心对称 | A 独石 | — | point + point（+模式级谓词） | 共线 |
| 86 | `tf.polygon.mirror.y` | 多边形左右对称 | A 独石 | — | polygon(谓词)（+模式级谓词） | 矩形与正方形 |
| 87 | `tf.polygon.rot180` | 多边形中心对称 | A 独石 | — | polygon(谓词)（+模式级谓词） | 矩形与正方形 |
| 88 | `tf.points.grid` | 全都落在格点 | A 独石 | — | point + point + point（+模式级谓词） | 点 |
| 89 | `tf.points.same.height` | 同一高度 | A 独石 | — | point + point + point（+模式级谓词） | 共线 |
| 90 | `tf.segments.mirror.y` | 两条线左右镜像 | A 独石 | — | segment + segment（+模式级谓词） | 线段 |
| 91 | `calc.integral.converged` | 积分收敛了 | A 独石 | — | integral（+模式级谓词） | 积分区域 |
| 92 | `calc.integral.err.tiny` | 误差微不可察 | A 独石 | — | integral（+模式级谓词） | 积分区域 |
| 93 | `calc.integral.exact.int` | 整数面积 | A 独石 | — | integral（+模式级谓词） | 积分区域 |
| 94 | `calc.integral.net.zero` | 正负抵消 | A 独石 | — | integral（+模式级谓词） | 积分区域 |
| 95 | `calc.tangent.slope.one` | 斜率正好是 1 | A 独石 | — | tangent（+模式级谓词） | 切线 |
| 96 | `calc.tangent.slope.zero` | 水平切线 | A 独石 | — | tangent（+模式级谓词） | 切线 |
| 97 | `calc.secant.small.dx` | 两点靠得很近 | A 独石 | — | secant（+模式级谓词） | 割线 |
| 98 | `calc.secant.matches.tangent` | 差商趋于斜率 | A 独石 | — | secant + tangent（+模式级谓词） | 割线 |
| 99 | `con.one.exact` | 严丝合缝 | A 独石 | — | constraint(谓词)（+模式级谓词） | 约束 |
| 100 | `con.two.hold` | 两个约束同时成立 | A 独石 | — | constraint(谓词) + constraint(谓词) | 约束 |
| 101 | `con.three.hold` | 三个约束同时成立 | A 独石 | — | constraint(谓词) + constraint(谓词) + constraint(谓词) | 约束 |
| 102 | `con.shared.entity` | 连锁反应 | A 独石 | — | constraint + constraint（+模式级谓词） | 约束 |
| 103 | `con.chained.on.entity` | 一个实体背两条 | A 独石 | — | constraint（+模式级谓词） | 约束 |
| 104 | `con.horizontal.exact` | 真的水平了 | A 独石 | — | constraint(谓词)（+模式级谓词） | 约束 |
| 105 | `con.midpoint.exact` | 正好一半 | A 独石 | — | constraint(谓词)（+模式级谓词） | 约束 |
| 106 | `con.all.satisfied` | 全都被满足 | A 独石 | — | constraint（+模式级谓词） | 约束 |
| 107 | `bind.first.link` | 第一次联动 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 108 | `bind.one.to.two` | 一拖二 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 109 | `bind.three.places` | 一拖三 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 110 | `bind.two.vars` | 两个变量同时在管 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 111 | `bind.point.xy` | 横竖都被管 | A 独石 | — | point（+模式级谓词） | 关联 |
| 112 | `bind.circle.param` | 圆被牵着走 | A 独石 | — | circle（+模式级谓词） | 关联 |
| 113 | `bind.observed.link` | 被盯着的变化 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 114 | `bind.many.targets` | 牵一发而动全身 | A 独石 | — | sine（+模式级谓词） | 关联 |
| 115 | `weave.thales` | 泰勒斯之圆 | B 交织 | geo.edgepoint.on+geo.angle.first | circle(谓词) + edgepoint + segment(谓词) + joint(谓词)（+模式级谓词） | 泰勒斯定理 |
| 116 | `weave.euler.ring` | 欧拉之环 | B 交织 | geo.circle.first+geo.var.first+geo.binding.first | circle(谓词) + variable + * + *（+模式级谓词） | 欧拉之环 |
| 117 | `weave.driven.wave` | 波浪驯服者 | B 交织 | geo.sine.first+geo.var.first+geo.binding.first | sine（+模式级谓词） | 滑杆驱动的波 |
| 118 | `weave.driven.circle` | 会呼吸的圆 | B 交织 | geo.circle.first+geo.var.first+geo.binding.first | circle（+模式级谓词） | 会呼吸的圆 |
| 119 | `weave.secant.meets.tangent` | 极限的一瞥 | B 交织 | calc.secant.first+calc.tangent.first+geo.binding.first | secant + tangent（+模式级谓词） | 割线逼近切线 |
| 120 | `weave.calculus.keys` | 微积分的钥匙 | B 交织 | calc.tangent.first+calc.integral.first+calc.probe.first | tangent + integral + probe（+模式级谓词） | 微积分的钥匙 |
| 121 | `weave.angle.driven.spin` | 让角自己转 | B 交织 | geo.angle.first+geo.var.first+geo.binding.first | joint（+模式级谓词） | 让角自己转 |
| 122 | `weave.congruent.triangles` | 全等三角形 | B 交织 | geo.triangle.born+geo.segments.equal | polygon(谓词) + polygon(谓词)（+模式级谓词） | 全等三角形 |
| 123 | `weave.midpoint.driven` | 被牵着的中点 | B 交织 | geo.constraint.midpoint+geo.binding.first+geo.var.first | constraint(谓词)（+模式级谓词） | 被牵着的中点 |
| 124 | `weave.probes.contrast` | 对照观察 | B 交织 | calc.probe.first+geo.var.first | probe + probe | 对照观察 |
| 125 | `weave.parallelogram` | 平行四边形 | B 交织 | geo.lines.parallel+geo.segments.equal | polygon(谓词)（+模式级谓词） | 平行四边形 |
| 126 | `weave.tangency.circle` | 直线与圆相切 | B 交织 | geo.constraint.tangent+geo.circle.first | constraint(谓词) + circle(谓词) | 直线与圆相切 |
| 127 | `weave.chord.midpoint` | 弦被平分 | B 交织 | geo.chord.on.circle+geo.constraint.midpoint | constraint(谓词)（+模式级谓词） | 弦被平分 |
| 128 | `weave.diameter.right` | 直径上的直角 | B 交织 | geo.diameter+geo.angle.right | joint(谓词)（+模式级谓词） | 直径上的直角 |
| 129 | `weave.func.derivative` | 函数与它的导函数 | B 交织 | geo.func.first+calc.derivcurve.first | func + derivcurve | 函数与导函数 |
| 130 | `weave.integral.driven` | 被驱动的累积量 | B 交织 | calc.integral.first+geo.var.first+geo.binding.first | integral（+模式级谓词） | 被驱动的累积量 |
| 131 | `weave.probe.on.func` | 盯着函数看 | B 交织 | calc.probe.first+geo.func.first | probe + func（+模式级谓词） | 盯着函数看 |
| 132 | `weave.contact.spin` | 接点也在转 | B 交织 | geo.contact.endpoint+geo.angle.first | joint + edgepoint（+模式级谓词） | 接点也在转 |
| 133 | `weave.circle.wave` | 圆与波同源 | B 交织 | geo.circle.first+geo.sine.first | circle + sine（+模式级谓词） | 圆与波同源 |
| 134 | `weave.constrained.polygon` | 被约束的多边形 | B 交织 | geo.polygon.first+geo.constraint.first | polygon + constraint | 被约束的多边形 |

## B 类交织成就的前置链

- 「泰勒斯之圆」← 「会滑动的点」 + 「量出一个角」
- 「欧拉之环」← 「一个圆」 + 「第一个变量」 + 「第一次关联」
- 「波浪驯服者」← 「一条正弦波」 + 「第一个变量」 + 「第一次关联」
- 「会呼吸的圆」← 「一个圆」 + 「第一个变量」 + 「第一次关联」
- 「极限的一瞥」← 「割线」 + 「切线」 + 「第一次关联」
- 「微积分的钥匙」← 「切线」 + 「积分区域」 + 「第一个观察器」
- 「让角自己转」← 「量出一个角」 + 「第一个变量」 + 「第一次关联」
- 「全等三角形」← 「第一块基石」 + 「等长的两条线」
- 「被牵着的中点」← 「中点」 + 「第一次关联」 + 「第一个变量」
- 「对照观察」← 「第一个观察器」 + 「第一个变量」
- 「平行四边形」← 「两条平行线」 + 「等长的两条线」
- 「直线与圆相切」← 「相切」 + 「一个圆」
- 「弦被平分」← 「弦」 + 「中点」
- 「直径上的直角」← 「直径」 + 「直角」
- 「函数与它的导函数」← 「第一根函数曲线」 + 「导函数曲线」
- 「被驱动的累积量」← 「积分区域」 + 「第一个变量」 + 「第一次关联」
- 「盯着函数看」← 「第一个观察器」 + 「第一根函数曲线」
- 「接点也在转」← 「接点」 + 「量出一个角」
- 「圆与波同源」← 「一个圆」 + 「一条正弦波」
- 「被约束的多边形」← 「闭合的多边形」 + 「第一次约束」
