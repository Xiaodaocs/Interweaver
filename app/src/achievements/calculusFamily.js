// T8 扩展 · 微积分族（设计 §6.1「微积分族 8」）
//
// 只用**已在 entities.js 中查证**的特征量：
//   · tangent（1245 行）：x0 切点 x / y0 切点 y / m 斜率
//   · secant（1285 行）：dx Δx / dy Δy / m 差商
//   · integral（1358 行）：S 近似值 / exact 精确值 / err 误差
// 不可用的（已查证无特征量，故不写判据）：derivcurve、func（features: () => []）。
const near = (a, b, tol) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * tol);
const fin = (v) => Number.isFinite(v);

export const CALCULUS_PATTERNS = [
  {
    id: 'calc.integral.converged', title: '积分收敛了', flavor: '分得越细，近似值越贴近精确值。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '把积分误差压到 0.01 以内',
    nodes: [{ type: 'integral', as: 'ig' }],
    where: (sg, b) => { const e = sg.features.get(b.ig)?.err; return fin(e) && e <= 0.01; },
    evidence: (b, sg) => ({ text: `|S − 精确值| = ${(sg.features.get(b.ig)?.err ?? NaN).toExponential(2)}（≤0.01）`, values: {} }),
  },
  {
    id: 'calc.integral.err.tiny', title: '误差微不可察', flavor: '好到看不出差别。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '把积分误差压到 1e-4 以内',
    nodes: [{ type: 'integral', as: 'ig' }],
    where: (sg, b) => { const e = sg.features.get(b.ig)?.err; return fin(e) && e <= 1e-4; },
    evidence: (b, sg) => ({ text: `误差 ${(sg.features.get(b.ig)?.err ?? NaN).toExponential(2)}（≤1e-4）`, values: {} }),
  },
  {
    id: 'calc.integral.exact.int', title: '整数面积', flavor: '曲线下的面积刚好是整数。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让积分精确值成为整数',
    nodes: [{ type: 'integral', as: 'ig' }],
    where: (sg, b) => {
      const v = sg.features.get(b.ig)?.exact;
      return fin(v) && Math.abs(v) > 0.5 && Math.abs(v - Math.round(v)) <= Math.abs(v) * 0.01;
    },
    evidence: (b, sg) => ({ text: `精确值 ${(sg.features.get(b.ig)?.exact ?? NaN).toFixed(4)}`, values: {} }),
  },
  {
    id: 'calc.integral.net.zero', title: '正负抵消', flavor: '上面与下面刚好一样多。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让积分近似值接近 0',
    nodes: [{ type: 'integral', as: 'ig' }],
    where: (sg, b) => { const s = sg.features.get(b.ig)?.S; return fin(s) && Math.abs(s) <= 0.01; },
    evidence: (b, sg) => ({ text: `近似值 S = ${(sg.features.get(b.ig)?.S ?? NaN).toExponential(2)}`, values: {} }),
  },
  {
    id: 'calc.tangent.slope.one', title: '斜率正好是 1', flavor: '45° 的切线。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让切线斜率等于 1',
    nodes: [{ type: 'tangent', as: 'tg' }],
    where: (sg, b) => near(sg.features.get(b.tg)?.m ?? NaN, 1),
    evidence: (b, sg) => ({ text: `斜率 m = ${(sg.features.get(b.tg)?.m ?? NaN).toFixed(4)}（1±1%）`, values: {} }),
  },
  {
    id: 'calc.tangent.slope.zero', title: '水平切线', flavor: '那一刻，曲线既不升也不降。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让切线斜率等于 0（水平）',
    nodes: [{ type: 'tangent', as: 'tg' }],
    where: (sg, b) => { const m = sg.features.get(b.tg)?.m; return fin(m) && Math.abs(m) <= 0.01; },
    evidence: (b, sg) => ({ text: `斜率 m = ${(sg.features.get(b.tg)?.m ?? NaN).toExponential(2)}（|m|≤0.01）`, values: {} }),
  },
  {
    id: 'calc.secant.small.dx', title: '两点靠得很近', flavor: '割线的两个点几乎重合。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让割线的 Δx 小于 0.1',
    nodes: [{ type: 'secant', as: 'sc' }],
    where: (sg, b) => { const d = sg.features.get(b.sc)?.dx; return fin(d) && Math.abs(d) <= 0.1; },
    evidence: (b, sg) => ({ text: `Δx = ${(sg.features.get(b.sc)?.dx ?? NaN).toFixed(4)}（≤0.1）`, values: {} }),
  },
  {
    id: 'calc.secant.matches.tangent', title: '差商趋于斜率', flavor: '两点越近，割线越像切线 —— 这就是导数。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让割线差商与切线斜率一致',
    nodes: [{ type: 'secant', as: 'sc' }, { type: 'tangent', as: 'tg' }],
    where: (sg, b) => {
      const ms = sg.features.get(b.sc)?.m, mt = sg.features.get(b.tg)?.m;
      return fin(ms) && fin(mt) && Math.abs(ms - mt) <= 0.05;
    },
    evidence: (b, sg) => ({
      text: `差商 ${(sg.features.get(b.sc)?.m ?? NaN).toFixed(4)} vs 切线斜率 ${(sg.features.get(b.tg)?.m ?? NaN).toFixed(4)}（差 ≤0.05）`,
      values: {},
    }),
  },
];
