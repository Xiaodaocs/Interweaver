// T8 扩展 · 变换族（设计 §6.1「变换族 8」）
//
// 只用**已验证存在**的特征量：
//   · 点：x / y（在「三点共线」「圆上的点」批次中验证过）
//   · 多边形：count / v{i}x / v{i}y / area（在「三角形族」批次中验证过）
//   · 线段：x1/y1/x2/y2/length（在「弦」「等长」批次中验证过）
// 不引入任何未证实的键名 —— 这是第 66/67 轮两条死判据换来的规则。
const P = (f) => (i) => [f[`v${i}x`], f[`v${i}y`]];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ptsOf = (sg) => sg.nodes.filter((n) => n.type === 'point').map((n) => sg.features.get(n.id)).filter(Boolean);

export const TRANSFORM_PATTERNS = [
  {
    id: 'tf.points.mirror.x', title: '关于 x 轴对称', flavor: '每个点都有一个上下镜像的伙伴。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让点集关于 x 轴对称',
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }],
    where: (sg) => {
      const pts = ptsOf(sg);
      if (pts.length < 2) return false;
      return pts.every((a) => pts.some((b) => near(b.x, a.x, 0.02) && near(b.y, -a.y, 0.02)));
    },
    evidence: () => ({ text: '每个点都能在 x 轴另一侧找到镜像伙伴（≤0.02）', values: {} }),
  },
  {
    id: 'tf.points.mirror.y', title: '关于 y 轴对称', flavor: '左右镜像，一个不少。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让点集关于 y 轴对称',
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }],
    where: (sg) => {
      const pts = ptsOf(sg);
      if (pts.length < 2) return false;
      return pts.every((a) => pts.some((b) => near(b.x, -a.x, 0.02) && near(b.y, a.y, 0.02)));
    },
    evidence: () => ({ text: '每个点都能在 y 轴另一侧找到镜像伙伴（≤0.02）', values: {} }),
  },
  {
    id: 'tf.points.center.symmetric', title: '中心对称', flavor: '绕原点转 180°，点集回到自己。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让点集关于原点中心对称',
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }],
    where: (sg) => {
      const pts = ptsOf(sg);
      if (pts.length < 2) return false;
      return pts.every((a) => pts.some((b) => near(b.x, -a.x, 0.02) && near(b.y, -a.y, 0.02)));
    },
    evidence: () => ({ text: '每个点都能在原点另一侧找到对称伙伴（≤0.02）', values: {} }),
  },
  {
    id: 'tf.polygon.mirror.y', title: '多边形左右对称', flavor: '这个多边形的左右两半完全一样。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让多边形关于 y 轴对称',
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) >= 3 }],
    where: (sg, b) => {
      const f = sg.features.get(b.pg);
      if (!f) return false;
      const V = [];
      for (let i = 1; i <= f.count; i++) V.push(P(f)(i));
      return V.every((a) => V.some((c) => near(c[0], -a[0], 0.02) && near(c[1], a[1], 0.02)));
    },
    evidence: (b, sg) => ({ text: `${sg.features.get(b.pg)?.count} 边形的每个顶点都有左右镜像伙伴`, values: {} }),
  },
  {
    id: 'tf.polygon.rot180', title: '多边形中心对称', flavor: '转半圈，它还是它。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让多边形关于原点中心对称',
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) >= 3 }],
    where: (sg, b) => {
      const f = sg.features.get(b.pg);
      if (!f) return false;
      const V = [];
      for (let i = 1; i <= f.count; i++) V.push(P(f)(i));
      return V.every((a) => V.some((c) => near(c[0], -a[0], 0.02) && near(c[1], -a[1], 0.02)));
    },
    evidence: () => ({ text: '每个顶点都能在原点另一侧找到对称顶点', values: {} }),
  },
  {
    id: 'tf.points.grid', title: '全都落在格点', flavor: '所有点都站在整数坐标上。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让所有点都在整数格点上',
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }, { type: 'point', as: 'p3' }],
    where: (sg) => {
      const pts = ptsOf(sg);
      if (pts.length < 3) return false;
      return pts.every((a) => near(a.x, Math.round(a.x), 0.01) && near(a.y, Math.round(a.y), 0.01));
    },
    evidence: (b, sg) => ({ text: `${ptsOf(sg).length} 个点全部落在整数格点上`, values: {} }),
  },
  {
    id: 'tf.points.same.height', title: '同一高度', flavor: '三个点排在同一水平线上。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让三个点 y 坐标完全相同',
    nodes: [{ type: 'point', as: 'p1' }, { type: 'point', as: 'p2' }, { type: 'point', as: 'p3' }],
    where: (sg) => {
      const pts = ptsOf(sg);
      if (pts.length < 3) return false;
      const y0 = pts[0].y;
      return pts.every((a) => near(a.y, y0, 0.01));
    },
    evidence: (b, sg) => ({ text: `所有点的 y 都等于 ${ptsOf(sg)[0].y.toFixed(3)}`, values: {} }),
  },
  {
    id: 'tf.segments.mirror.y', title: '两条线左右镜像', flavor: '一条线段是另一条的镜像。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让两条线段关于 y 轴对称',
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }],
    where: (sg, b) => {
      const a = sg.features.get(b.s1), c = sg.features.get(b.s2);
      if (!a || !c) return false;
      const same = near(c.x1, -a.x1, 0.02) && near(c.y1, a.y1, 0.02) && near(c.x2, -a.x2, 0.02) && near(c.y2, a.y2, 0.02);
      const swapped = near(c.x1, -a.x2, 0.02) && near(c.y1, a.y2, 0.02) && near(c.x2, -a.x1, 0.02) && near(c.y2, a.y1, 0.02);
      const notSame = Math.abs(Math.abs(a.x1) - Math.abs(c.x1)) > 1e-9 || Math.abs(a.x1 - c.x1) > 1e-9;
      return (same || swapped) && notSame;
    },
    evidence: () => ({ text: '两条线段的端点互为 y 轴镜像', values: {} }),
  },
];
