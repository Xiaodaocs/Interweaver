// T8 扩展 · 函数族（设计 §6.1「函数族 12」；实装 11 条）
// 注（两条因"特征量名未证实"而移除的判据，等查证后可重新加回）：
//   · 「顶点在 y 轴」：抛物线顶点 x 的真实特征量是 h（entities.js 已确认），我原先写的 cx 不存在；
//   · 「恒等函数」：func 实体的表达式特征量名未证实（grep 'k: expr' 无匹配）。
// 教训：新增成就前必须先在 entities.js 里查证该实体的 params/derived 键名，再写判据。
//
// 判据全部由已有特征量算出（正弦：A/lam/phi/cx/cy；抛物线：a/cx/cy；函数：expr），
// 每条自带 hint（未激活暗示，≤22 字）。
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * tol);
const isInt = (v, tol = 0.01) => Math.abs(v - Math.round(v)) <= Math.max(0.001, Math.abs(v) * tol);
const sineAt = (f, x) => f.A * Math.sin(f.lam * x + (f.phi || 0));
const SINE = (extra = {}) => ({ nodes: [{ type: 'sine', as: 'sn' }], ...extra });
const PARA = (extra = {}) => ({ nodes: [{ type: 'parabola', as: 'pa' }], ...extra });

export const FUNCTION_PATTERNS = [
  {
    id: 'fn.sine.amp.one', title: '标准振幅', flavor: '振幅正好是 1：波峰在 1，波谷在 −1。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把正弦的振幅调成 1',
    ...SINE(),
    where: (sg, b) => near(sg.features.get(b.sn)?.A ?? NaN, 1),
    evidence: (b, sg) => ({ text: `振幅 ${(sg.features.get(b.sn)?.A ?? NaN).toFixed(4)}（判据 1±1%）`, values: {} }),
  },
  {
    id: 'fn.sine.amp.int', title: '整数振幅', flavor: '波峰刚好落在整数上。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把振幅调成整数',
    ...SINE(),
    where: (sg, b) => { const A = sg.features.get(b.sn)?.A; return Number.isFinite(A) && Math.abs(A) > 0.5 && isInt(A); },
    evidence: (b, sg) => ({ text: `振幅 ${(sg.features.get(b.sn)?.A ?? NaN).toFixed(3)}`, values: {} }),
  },
  {
    id: 'fn.sine.lam.2pi', title: '标准波长', flavor: '一个周期正好是 2π。',
    cls: 'solo', tier: 'structure', requires: [], hint: '把正弦的角频率调成 2π',
    ...SINE(),
    where: (sg, b) => near(sg.features.get(b.sn)?.lam ?? NaN, 2 * Math.PI),
    evidence: (b, sg) => ({ text: `λ ${(sg.features.get(b.sn)?.lam ?? NaN).toFixed(4)}（2π=${(2 * Math.PI).toFixed(4)}）`, values: {} }),
  },
  {
    id: 'fn.sine.wavelength.int', title: '整数波长', flavor: '一个周期刚好是整数长度。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让周期（2π/λ）成为整数',
    ...SINE(),
    where: (sg, b) => {
      const lam = sg.features.get(b.sn)?.lam;
      if (!Number.isFinite(lam) || Math.abs(lam) < 1e-6) return false;
      return isInt(2 * Math.PI / lam);
    },
    evidence: (b, sg) => ({ text: `周期 2π/λ = ${(2 * Math.PI / (sg.features.get(b.sn)?.lam ?? 1)).toFixed(4)}`, values: {} }),
  },
  {
    id: 'fn.sine.phi.zero', title: '相位为零', flavor: '从原点出发的那条正弦。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把相位调成 0',
    ...SINE(),
    where: (sg, b) => Math.abs(sg.features.get(b.sn)?.phi ?? NaN) <= 0.01,
    evidence: (b, sg) => ({ text: `相位 ${(sg.features.get(b.sn)?.phi ?? NaN).toFixed(4)}`, values: {} }),
  },
  {
    id: 'fn.sine.through.origin', title: '过原点的波', flavor: '波形从 (0,0) 穿过去。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让波在原点处取值为 0',
    ...SINE(),
    where: (sg, b) => {
      const f = sg.features.get(b.sn);
      if (!f) return false;
      return Math.abs(sineAt(f, 0)) <= 0.01;
    },
    evidence: (b, sg) => ({ text: `f(0) = ${sineAt(sg.features.get(b.sn), 0).toFixed(4)}`, values: {} }),
  },
  {
    id: 'fn.sine.even', title: '偶函数', flavor: '左右镜像重合：f(−x) = f(x)。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让波形关于 y 轴对称',
    ...SINE(),
    where: (sg, b) => {
      const f = sg.features.get(b.sn);
      if (!f) return false;
      // 采样 6 个点比对 f(-x) 与 f(x)
      for (const x of [0.3, 0.7, 1.1, 1.7, 2.3, 3.1]) {
        if (Math.abs(sineAt(f, -x) - sineAt(f, x)) > 0.02 * Math.max(1, Math.abs(f.A))) return false;
      }
      return true;
    },
    evidence: () => ({ text: '采样 6 点：f(−x) 与 f(x) 差异 ≤2%|A|', values: {} }),
  },
  {
    id: 'fn.sine.periodic.sampled', title: '确实是周期', flavor: '往前走一个周期，波形回到原处。',
    cls: 'solo', tier: 'structure', requires: [], hint: '采样验证 f(x+T)=f(x)',
    ...SINE(),
    where: (sg, b) => {
      const f = sg.features.get(b.sn);
      if (!f || Math.abs(f.lam) < 1e-6) return false;
      const T = 2 * Math.PI / f.lam;
      for (const x of [0.2, 0.9, 1.6, 2.4, 3.3]) {
        if (Math.abs(sineAt(f, x + T) - sineAt(f, x)) > 0.02 * Math.max(1, Math.abs(f.A))) return false;
      }
      return true;
    },
    evidence: (b, sg) => ({ text: `周期 T = ${(2 * Math.PI / sg.features.get(b.sn).lam).toFixed(4)}，采样 5 点吻合`, values: {} }),
  },
  {
    id: 'fn.parabola.opens.up', title: '开口向上', flavor: '二次项系数为正，抛物线向上张口。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让抛物线开口向上',
    ...PARA(),
    where: (sg, b) => (sg.features.get(b.pa)?.a ?? 0) > 0.05,
    evidence: (b, sg) => ({ text: `a = ${(sg.features.get(b.pa)?.a ?? NaN).toFixed(3)}（>0）`, values: {} }),
  },
  {
    id: 'fn.parabola.opens.down', title: '开口向下', flavor: '二次项系数为负，抛物线向下张口。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让抛物线开口向下',
    ...PARA(),
    where: (sg, b) => (sg.features.get(b.pa)?.a ?? 0) < -0.05,
    evidence: (b, sg) => ({ text: `a = ${(sg.features.get(b.pa)?.a ?? NaN).toFixed(3)}（<0）`, values: {} }),
  },
  {
    id: 'fn.parabola.vertex.on.axis', title: '顶点在 y 轴', flavor: '对称轴正好是 y 轴。',
    cls: 'solo', tier: 'structure', requires: [], hint: '把抛物线左右移到 y 轴上',
    ...PARA(),
    // 特征量名有据：entities.js:1147 → { k: 'a' }, { k: 'h', name: '顶点 x' }, { k: 'k', name: '顶点 y' }
    where: (sg, b) => Math.abs(sg.features.get(b.pa)?.h ?? NaN) <= 0.02,
    evidence: (b, sg) => ({ text: `顶点 x = h = ${(sg.features.get(b.pa)?.h ?? NaN).toFixed(3)}`, values: {} }),
  },
  {
    id: 'fn.func.identity', title: '恒等函数', flavor: '最朴素的那条：f(x) = x。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把函数写成 f(x)=x',
    nodes: [{ type: 'func', as: 'fu' }],
    // 判据依据：semantic.js:64 对 func 显式暴露 expr（并去掉空白），所以这里可直接比对
    where: (sg, b) => String(sg.features.get(b.fu)?.expr || '') === 'x',
    evidence: (b, sg) => ({ text: '表达式 "' + String(sg.features.get(b.fu)?.expr || '') + '"', values: {} }),
  },
];
