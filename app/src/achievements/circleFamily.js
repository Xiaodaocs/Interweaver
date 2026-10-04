// T8 扩展 · 圆与弦族（设计 §6.1「圆与弦族 10」）
//
// 每条都是**实测判据 + 容差**，并自带 hint（§7.3 要求每条成就都有未激活暗示）。
// 只依赖语义图已有能力（圆的 cx/cy/r、线段的端点/长度/方向、多边形的顶点/面积、弧的扫角）。
import { touchedParam } from './history.js';
const D = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const segDir = (f) => {
  const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L, L];
};
const nearR = (d, r) => Math.abs(d - r) <= Math.max(0.02, r * 0.01);

export const CIRCLE_PATTERNS = [
  {
    id: 'geo.circle.integer.r', title: '整数半径', flavor: '半径刚好是一个整数，世界忽然整齐了。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把圆的半径调成整数（如 2）',
    nodes: [{ type: 'circle', as: 'c', where: (ft) => ft.r > 0.5 && Math.abs(ft.r - Math.round(ft.r)) <= ft.r * 0.01 }],
    // ★ 用户报告"一个操作同时解锁多个"：画一个默认 r=2 的圆会**同时**送来「一个圆」+「整数半径」。
    //   半径本来就是 2，用户并没有"调成整数"这个动作 → 现在要求半径被**刻意改过**。
    where: (sg, b) => touchedParam(sg, b.c, 'r'),
    evidence: (b, sg) => ({ text: `半径 ${(sg.features.get(b.c)?.r ?? 0).toFixed(3)}（与整数相差 ≤1%，且是用户自己调出来的）`, values: {} }),
  },
  {
    id: 'geo.circle.two', title: '两个圆', flavor: '一个圆是形状，两个圆是关系。',
    cls: 'solo', tier: 'spark', requires: [], hint: '在同一个场景里画两个圆',
    nodes: [{ type: 'circle', as: 'c1' }, { type: 'circle', as: 'c2' }],
    evidence: () => ({ text: '同场景存在两个圆', values: {} }),
  },
  {
    id: 'geo.circle.concentric', title: '同心圆', flavor: '同一个心，不同的远近。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让两个圆共用一个圆心',
    nodes: [{ type: 'circle', as: 'c1' }, { type: 'circle', as: 'c2' }],
    where: (sg, b) => {
      const a = sg.features.get(b.c1), c = sg.features.get(b.c2);
      if (!a || !c) return false;
      const sameCenter = D(a.cx, a.cy, c.cx, c.cy) <= Math.max(0.02, Math.max(a.r, c.r) * 0.01);
      return sameCenter && Math.abs(a.r - c.r) > Math.max(0.05, a.r * 0.02);
    },
    evidence: (b, sg) => {
      const a = sg.features.get(b.c1), c = sg.features.get(b.c2);
      return { text: `圆心相距 ${D(a.cx, a.cy, c.cx, c.cy).toFixed(3)}，半径 ${a.r.toFixed(2)} 与 ${c.r.toFixed(2)}`, values: {} };
    },
  },
  {
    id: 'geo.circle.equal.r', title: '等半径', flavor: '两个圆的半径一样长。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让两个圆的半径相等',
    nodes: [{ type: 'circle', as: 'c1' }, { type: 'circle', as: 'c2' }],
    where: (sg, b) => {
      const a = sg.features.get(b.c1), c = sg.features.get(b.c2);
      return a && c && c.r > 1e-6 && Math.abs(a.r / c.r - 1) <= 0.01;
    },
    evidence: (b, sg) => ({ text: `半径 ${(sg.features.get(b.c1)?.r ?? 0).toFixed(3)} 与 ${(sg.features.get(b.c2)?.r ?? 0).toFixed(3)}`, values: {} }),
  },
  {
    id: 'geo.circle.center.point', title: '圆心上的点', flavor: '有个点正好站在圆心上。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把一个点放在圆心上',
    nodes: [{ type: 'point', as: 'p' }, { type: 'circle', as: 'c' }],
    where: (sg, b) => {
      const p = sg.features.get(b.p), c = sg.features.get(b.c);
      return p && c && D(p.x, p.y, c.cx, c.cy) <= Math.max(0.02, c.r * 0.01);
    },
    evidence: (b, sg) => {
      const p = sg.features.get(b.p), c = sg.features.get(b.c);
      return { text: `点到圆心 ${D(p.x, p.y, c.cx, c.cy).toExponential(1)}`, values: {} };
    },
  },
  {
    id: 'geo.chord.equal', title: '等长两弦', flavor: '同样长的两条弦。',
    cls: 'solo', tier: 'structure', requires: [], hint: '在同一个圆里画两条一样长的弦',
    nodes: [{ type: 'segment', as: 's1' }, { type: 'segment', as: 's2' }, { type: 'circle', as: 'c' }],
    where: (sg, b) => {
      const c = sg.features.get(b.c);
      const onCircle = (s) => {
        const f = sg.features.get(s);
        if (!f || !c) return false;
        return nearR(D(f.x1, f.y1, c.cx, c.cy), c.r) && nearR(D(f.x2, f.y2, c.cx, c.cy), c.r);
      };
      const f1 = sg.features.get(b.s1), f2 = sg.features.get(b.s2);
      return onCircle(b.s1) && onCircle(b.s2) && f1 && f2 && f2.length > 1e-6 && Math.abs(f1.length / f2.length - 1) <= 0.01;
    },
    evidence: (b, sg) => ({ text: `两弦长 ${(sg.features.get(b.s1)?.length ?? 0).toFixed(3)} 与 ${(sg.features.get(b.s2)?.length ?? 0).toFixed(3)}，且两端都在圆上`, values: {} }),
  },
  {
    id: 'geo.diameter.bisects', title: '直径平分弦', flavor: '垂直于弦的直径，把弦切成两半。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让一条过圆心的线垂直穿过弦',
    nodes: [{ type: 'segment', as: 'd' }, { type: 'segment', as: 's' }, { type: 'circle', as: 'c' }],
    where: (sg, b) => {
      const c = sg.features.get(b.c), d = sg.features.get(b.d), s = sg.features.get(b.s);
      if (!c || !d || !s) return false;
      // 直径：两端在圆上且中点≈圆心
      const isDia = nearR(D(d.x1, d.y1, c.cx, c.cy), c.r) && nearR(D(d.x2, d.y2, c.cx, c.cy), c.r)
        && D((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, c.cx, c.cy) <= Math.max(0.02, c.r * 0.01);
      const isChord = nearR(D(s.x1, s.y1, c.cx, c.cy), c.r) && nearR(D(s.x2, s.y2, c.cx, c.cy), c.r);
      if (!isDia || !isChord) return false;
      const [dx, dy] = segDir(d), [sx, sy] = segDir(s);
      const perp = Math.abs(dx * sx + dy * sy) <= 0.01;                    // 垂直
      const mid = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
      const through = Math.abs((mid[0] - d.x1) * dy - (mid[1] - d.y1) * dx) <= Math.max(0.03, c.r * 0.02);
      return perp && through;
    },
    evidence: () => ({ text: '存在一条直径，既垂直又穿过弦的中点', values: {} }),
  },
  {
    id: 'geo.polygon.inscribed', title: '圆内接多边形', flavor: '多边形的每个顶点都落在圆上。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让多边形所有顶点都在圆上',
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) >= 3 }, { type: 'circle', as: 'c' }],
    where: (sg, b) => {
      const pg = sg.features.get(b.pg), c = sg.features.get(b.c);
      if (!pg || !c) return false;
      for (let i = 1; i <= (pg.count || 0); i++) {
        if (!nearR(D(pg[`v${i}x`], pg[`v${i}y`], c.cx, c.cy), c.r)) return false;
      }
      return true;
    },
    evidence: (b, sg) => ({ text: `${sg.features.get(b.pg)?.count} 边形的每个顶点都在圆上（容差 1%）`, values: {} }),
  },
  {
    id: 'geo.arc.quarter', title: '四分之一弧', flavor: '圆的一段，正好是 90°。',
    cls: 'solo', tier: 'spark', requires: [], hint: '取圆的一段，扫过 90 度',
    nodes: [{ type: 'arcfree', as: 'a', where: (ft) => Math.abs(Math.abs(ft.sweep) - Math.PI / 2) <= 0.5 * Math.PI / 180 }],
    evidence: (b, sg) => ({ text: `扫角 ${((sg.features.get(b.a)?.sweep ?? 0) * 180 / Math.PI).toFixed(2)}°（判据 90°±0.5°）`, values: {} }),
  },
  {
    id: 'geo.tangent.two', title: '两条切线', flavor: '同一个曲线上，两条只碰一下的线。',
    cls: 'solo', tier: 'structure', requires: [], hint: '在一条曲线上作两条切线',
    nodes: [{ type: 'tangent', as: 't1' }, { type: 'tangent', as: 't2' }],
    where: (sg, b) => sg.features.get(b.t1)?.host === sg.features.get(b.t2)?.host,
    evidence: () => ({ text: '同一条曲线上有两条切线', values: {} }),
  },
];
