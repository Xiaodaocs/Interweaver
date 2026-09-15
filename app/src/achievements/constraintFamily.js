// T8 扩展 · 约束族（设计 §6.1「约束族 8」）
//
// 键名依据（都经过既有测试验证）：
//   · 约束节点的特征量：kind（种类名）、error（残差）—— 既有模式 geo.constraint.midpoint / .tangent 已在用；
//   · 可构造的约束种类：horizontal（S.addConstraint(st,'horizontal',[segId])）、
//     midpoint（[pointId, segId]）、tangent —— 均已在既有测试中实际构造成功。
// 其余 5 条采用**与约束种类无关**的判据（残差、约束数量、共享实体），这样就不必猜那些未证实的中文种类名。
const con = (sg) => sg.nodes.filter((n) => n.type === 'constraint').map((n) => ({ id: n.id, f: sg.features.get(n.id) })).filter((c) => c.f);
const fin = (v) => Number.isFinite(v);

export const CONSTRAINT_PATTERNS = [
  {
    id: 'con.one.exact', title: '严丝合缝', flavor: '残差小到 1e-9 —— 求解器这次很认真。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让某个约束的残差小于 1e-9',
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-9 }],
    evidence: (b, sg) => ({ text: '约束残差 |err| = ' + Math.abs(sg.features.get(b.c)?.error ?? NaN).toExponential(2) + '（≤1e-9）', values: {} }),
  },
  {
    id: 'con.two.hold', title: '两个约束同时成立', flavor: '同时满足两条规矩，不容易。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让场景里同时有两个约束成立',
    nodes: [{ type: 'constraint', as: 'c1', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-6 },
      { type: 'constraint', as: 'c2', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-6 }],
    evidence: (b, sg) => ({ text: '同场景有 ' + con(sg).filter((c) => Math.abs(c.f.error) <= 1e-6).length + ' 个约束满足残差 ≤1e-6', values: {} }),
  },
  {
    id: 'con.three.hold', title: '三个约束同时成立', flavor: '三条规矩一起压着，图形居然还很乖。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让场景里同时有三个约束成立',
    nodes: [{ type: 'constraint', as: 'c1', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-6 },
      { type: 'constraint', as: 'c2', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-6 },
      { type: 'constraint', as: 'c3', where: (ft) => fin(ft.error) && Math.abs(ft.error) <= 1e-6 }],
    evidence: () => ({ text: '同场景 ≥3 个约束同时成立', values: {} }),
  },
  {
    id: 'con.shared.entity', title: '连锁反应', flavor: '两条约束盯着同一个东西 —— 它动一下，两边都要重算。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让两个约束引用同一个实体',
    nodes: [{ type: 'constraint', as: 'c1' }, { type: 'constraint', as: 'c2' }],
    where: (sg, b) => {
      const r1 = sg.features.get(b.c1)?.refs, r2 = sg.features.get(b.c2)?.refs;
      if (!Array.isArray(r1) || !Array.isArray(r2)) return false;
      return r1.some((x) => r2.includes(x));
    },
    evidence: (b, sg) => ({ text: '两条约束共享至少一个被引用实体', values: {} }),
  },
  {
    id: 'con.chained.on.entity', title: '一个实体背两条', flavor: '它同时被两条约束管着。',
    cls: 'solo', tier: 'structure', requires: [], hint: '给同一个实体加两条约束',
    nodes: [{ type: 'constraint', as: 'c1' }],
    where: (sg) => {
      const counts = new Map();
      for (const c of con(sg)) {
        for (const r of (c.f.refs || [])) counts.set(r, (counts.get(r) || 0) + 1);
      }
      return [...counts.values()].some((v) => v >= 2);
    },
    evidence: () => ({ text: '存在一个实体被 ≥2 条约束引用', values: {} }),
  },
  {
    id: 'con.horizontal.exact', title: '真的水平了', flavor: '一条水平的线，稳得像地平线。',
    cls: 'solo', tier: 'spark', requires: [], hint: '给一条线段加水平约束',
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => String(ft.kind || '').includes('horizontal') && fin(ft.error) && Math.abs(ft.error) <= 1e-6 }],
    evidence: () => ({ text: '水平约束的残差 ≤1e-6（真的水平）', values: {} }),
  },
  {
    id: 'con.midpoint.exact', title: '正好一半', flavor: '不多不少，就在正中间。',
    cls: 'solo', tier: 'spark', requires: [], hint: '加一条中点约束并让它成立',
    nodes: [{ type: 'constraint', as: 'c', where: (ft) => String(ft.kind || '').includes('midpoint') && fin(ft.error) && Math.abs(ft.error) <= 1e-6 }],
    evidence: () => ({ text: '中点约束的残差 ≤1e-6', values: {} }),
  },
  {
    id: 'con.all.satisfied', title: '全都被满足', flavor: '每一条规矩都兑现了。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让场景里所有约束的残差都达标',
    nodes: [{ type: 'constraint', as: 'c' }],
    where: (sg) => {
      const list = con(sg);
      return list.length >= 2 && list.every((c) => fin(c.f.error) && Math.abs(c.f.error) <= 1e-6);
    },
    evidence: (b, sg) => ({ text: '场景内 ' + con(sg).length + ' 条约束全部满足（≤1e-6）', values: {} }),
  },
];
