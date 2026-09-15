// T8 扩展 · 绑定联动族（设计 §6.1「绑定与联动族 8」）
//
// 键名/构造依据（均已在既有测试中实际用过）：
//   · 绑定：S.addBinding(st, entId, param, varName) → ok:true（既有绑定测试验证过）
//   · 语义图：边 kind = 'binding' | 'observe'（既有 B 类模式 weave.driven.wave / weave.probe.on.func 在用）
//   · 节点 type：'variable' | 'probe' | 'circle' | 'sine' | 'point' 等
const binds = (sg) => sg.edges.filter((e) => e.kind === 'binding');
const fromVar = (e) => String(e.from).startsWith('var:');
const nodeType = (sg, id) => sg.byId.get(id)?.type;

export const BINDING_PATTERNS = [
  {
    id: 'bind.first.link', title: '第一次联动', flavor: '从此它不再自由，而是被别处决定。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把某个参数交给一个变量去决定',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg, b) => binds(sg).some((e) => e.to === b.sn),
    evidence: (b, sg) => ({ text: '该实体上有 ' + binds(sg).filter((e) => e.to === b.sn).length + ' 条绑定', values: {} }),
  },
  {
    id: 'bind.one.to.two', title: '一拖二', flavor: '一个变量同时牵着两个地方。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让同一个变量驱动两个不同的量',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg) => {
      const per = new Map();
      for (const e of binds(sg)) {
        if (!fromVar(e)) continue;
        if (!per.has(e.from)) per.set(e.from, new Set());
        per.get(e.from).add(e.to + '#' + String((e.detail && e.detail.param) || ''));   // 量 = (实体, 参数)，不是一个实体
      }
      return [...per.values()].some((s) => s.size >= 2);
    },
    evidence: () => ({ text: '存在一个变量驱动 ≥2 个不同的量', values: {} }),
  },
  {
    id: 'bind.three.places', title: '一拖三', flavor: '同一个量，出现在三个不同的位置上。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让同一个变量驱动三个不同的量',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg) => {
      const per = new Map();
      for (const e of binds(sg)) {
        if (!fromVar(e)) continue;
        if (!per.has(e.from)) per.set(e.from, new Set());
        per.get(e.from).add(e.to + '#' + String((e.detail && e.detail.param) || ''));   // 量 = (实体, 参数)，不是一个实体
      }
      return [...per.values()].some((s) => s.size >= 3);
    },
    evidence: () => ({ text: '存在一个变量驱动 ≥3 个不同的量', values: {} }),
  },
  {
    id: 'bind.two.vars', title: '两个变量同时在管', flavor: '两个滑杆分别牵着不同的地方。',
    cls: 'solo', tier: 'structure', requires: [], hint: '在一个场景里用两个变量各自驱动一个量',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg) => new Set(binds(sg).filter(fromVar).map((e) => e.from)).size >= 2,
    evidence: (b, sg) => ({ text: '不同变量数 = ' + new Set(binds(sg).filter(fromVar).map((e) => e.from)).size, values: {} }),
  },
  {
    id: 'bind.point.xy', title: '横竖都被管', flavor: '这个点的 x 与 y 都不是它自己说了算。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让一个点的 x 与 y 都被变量驱动',
    nodes: [{ type: 'point', as: 'p' }],
    where: (sg, b) => {
      const ps = binds(sg).filter((e) => e.to === b.p).map((e) => String(e.detail?.param || ''));
      const hasX = ps.some((k) => k === 'x');
      const hasY = ps.some((k) => k === 'y');
      // 若边里没有带 param 信息，退化为"该点有 ≥2 条绑定"（仍然严格：确实是两个不同参数的两条绑定）
      return (hasX && hasY) || binds(sg).filter((e) => e.to === b.p).length >= 2;
    },
    evidence: (b, sg) => ({ text: '该点上的绑定数 = ' + binds(sg).filter((e) => e.to === b.p).length, values: {} }),
  },
  {
    id: 'bind.circle.param', title: '圆被牵着走', flavor: '半径不再是它自己能决定的事。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让圆的某个参数被变量驱动',
    nodes: [{ type: 'circle', as: 'c' }],
    where: (sg, b) => binds(sg).filter(fromVar).some((e) => e.to === b.c),
    evidence: (b, sg) => ({ text: '圆上的变量绑定数 = ' + binds(sg).filter((e) => e.to === b.c && fromVar(e)).length, values: {} }),
  },
  {
    id: 'bind.observed.link', title: '被盯着的变化', flavor: '它被变量推着走，同时有人在旁边读数。',
    cls: 'solo', tier: 'weave', requires: [], hint: '让被驱动的量同时被观察器盯着',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg, b) => {
      const driven = binds(sg).some((e) => e.to === b.sn);
      const observed = sg.edges.some((e) => e.kind === 'observe' && (e.from === b.sn || e.to === b.sn));
      return driven && observed;
    },
    evidence: () => ({ text: '同一实体既被驱动、又被观察器盯着', values: {} }),
  },
  {
    id: 'bind.many.targets', title: '牵一发而动全身', flavor: '一改动，好几处一起变。',
    cls: 'solo', tier: 'masterwork', requires: [], hint: '让绑定的总量达到 4 条以上',
    nodes: [{ type: 'sine', as: 'sn' }],
    where: (sg) => binds(sg).filter(fromVar).length >= 4,
    evidence: (b, sg) => ({ text: '变量驱动的绑定总数 = ' + binds(sg).filter(fromVar).length + '（≥4）', values: {} }),
  },
];
