// T8 扩展 · 三角形族（设计 §6.1「三角形族 8」）
//
// 判据全部由多边形的**顶点坐标**直接算出（边长、内角、面积、重心），带 1% 容差。
// 每条自带 hint（§7.3）。
const side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pt = (f, i) => [f[`v${i}x`], f[`v${i}y`]];
const rel = (a, b, tol = 0.01) => b > 1e-9 && Math.abs(a / b - 1) <= tol;
const dotAbs = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1]);
const norm = (u) => Math.hypot(u[0], u[1]) || 1;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

/** 三角形的三条边与三个内角 */
function tri(f) {
  if (!f || f.count !== 3) return null;
  const A = pt(f, 1), B = pt(f, 2), C = pt(f, 3);
  if (![...A, ...B, ...C].every(Number.isFinite)) return null;
  const sides = [side(A, B), side(B, C), side(C, A)];
  const angleAt = (P, Q, R) => {
    const u = sub(Q, P), v = sub(R, P);
    const c = (u[0] * v[0] + u[1] * v[1]) / (norm(u) * norm(v));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  };
  const angles = [angleAt(A, B, C), angleAt(B, A, C), angleAt(C, A, B)];
  const centroid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2;
  return { A, B, C, sides, angles, centroid, area };
}

const TRI = (extra = {}) => ({
  nodes: [{ type: 'polygon', as: 'pg', where: (ft) => ft.count === 3 && (ft.area || 0) > 1e-6 }],
  ...extra,
});

export const TRIANGLE_PATTERNS = [
  {
    id: 'tri.isosceles', title: '等腰三角形', flavor: '两条边一样长，于是两个角也相等。',
    cls: 'solo', tier: 'spark', requires: [], hint: '画一个两条边等长的三角形',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t) return false;
      const [a, c, e] = t.sides;
      return rel(a, c) || rel(c, e) || rel(e, a);
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      return { text: `三边 ${t.sides.map((x) => x.toFixed(3)).join(' / ')}（有两边相对误差 ≤1%）`, values: {} };
    },
  },
  {
    id: 'tri.equilateral', title: '等边三角形', flavor: '三条边一样长，三个角都是 60°。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让三边等长、三角都是 60°',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t) return false;
      const [a, c, e] = t.sides;
      return rel(a, c) && rel(c, e) && t.angles.every((x) => Math.abs(x - 60) <= 0.5);
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      return { text: `三边 ${t.sides.map((x) => x.toFixed(2)).join('/')}，三角 ${t.angles.map((x) => x.toFixed(1)).join('/')}°`, values: {} };
    },
  },
  {
    id: 'tri.right', title: '直角三角形', flavor: '一个直角，撑起整个三角学。',
    cls: 'solo', tier: 'spark', requires: [], hint: '画一个带直角的三角形',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      return !!t && t.angles.some((x) => Math.abs(x - 90) <= 0.5);
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      return { text: `三个内角 ${t.angles.map((x) => x.toFixed(2)).join(' / ')}°（有一个 ≈90°±0.5°）`, values: {} };
    },
  },
  {
    id: 'tri.right.isosceles', title: '等腰直角', flavor: '45°、45°、90°：最省料的那个三角形。',
    cls: 'solo', tier: 'structure', requires: [], hint: '既要有一个直角，又要两条边等长',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t) return false;
      const [a, c, e] = t.sides;
      const iso = rel(a, c) || rel(c, e) || rel(e, a);
      return iso && t.angles.some((x) => Math.abs(x - 90) <= 0.5);
    },
    evidence: () => ({ text: '同时满足"等腰"与"有一个直角"', values: {} }),
  },
  {
    id: 'tri.pythagoras', title: '勾股定理', flavor: '两条直角边的平方和，正好等于斜边的平方。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让两条边的平方和等于第三边的平方',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t) return false;
      const s = [...t.sides].sort((x, y) => x - y);
      return Math.abs(s[0] * s[0] + s[1] * s[1] - s[2] * s[2]) <= s[2] * s[2] * 0.01;
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      const s = [...t.sides].sort((x, y) => x - y);
      return { text: `a²+b²=${(s[0] ** 2 + s[1] ** 2).toFixed(3)}，c²=${(s[2] ** 2).toFixed(3)}（相对误差 ≤1%）`, values: {} };
    },
  },
  {
    id: 'tri.centroid.grid', title: '重心在格点', flavor: '三条中线的交点，正好落在整点上。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让三角形重心落在整数坐标上',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t) return false;
      return t.centroid.every((v) => Math.abs(v - Math.round(v)) <= 0.01);
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      return { text: `重心 (${t.centroid[0].toFixed(2)}, ${t.centroid[1].toFixed(2)})`, values: {} };
    },
  },
  {
    id: 'tri.area.integer', title: '整数面积', flavor: '面积刚好是一个整数。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让三角形面积刚好是整数',
    ...TRI(),
    where: (sg, b) => {
      const t = tri(sg.features.get(b.pg));
      if (!t || t.area < 0.5) return false;
      return Math.abs(t.area - Math.round(t.area)) <= t.area * 0.01;
    },
    evidence: (b, sg) => {
      const t = tri(sg.features.get(b.pg));
      return { text: `面积 ${t.area.toFixed(3)}（与整数相差 ≤1%）`, values: {} };
    },
  },
  {
    id: 'tri.vertex.on.line', title: '顶点落在线上', flavor: '三角形的一个角，正好踩在另一条线上。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让三角形的一个顶点落在别的线段上',
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => ft.count === 3 }, { type: 'segment', as: 's' }],
    where: (sg, b) => {
      const f = sg.features.get(b.pg), s = sg.features.get(b.s);
      if (!f || !s) return false;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const L = Math.hypot(dx, dy) || 1;
      for (let i = 1; i <= 3; i++) {
        const p = pt(f, i);
        const d = Math.abs((p[0] - s.x1) * dy - (p[1] - s.y1) * dx) / L;   // 点到直线的距离
        const t2 = ((p[0] - s.x1) * dx + (p[1] - s.y1) * dy) / (L * L);     // 是否落在线段范围内
        if (d <= 0.02 && t2 >= -0.02 && t2 <= 1.02) return true;
      }
      return false;
    },
    evidence: () => ({ text: '三角形的一个顶点落在某条线段上（距离 ≤0.02）', values: {} }),
  },
];
