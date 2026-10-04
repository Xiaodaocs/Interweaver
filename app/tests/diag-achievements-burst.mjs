// 实测："一个操作会同时解锁多少条成就" —— 用户报告"新用户一上来可能会解锁大量成就、
// 某个操作会同时解锁多个"。这里用假时钟 + 真引擎，跑若干典型操作，数每次触发了几条。
// 运行： node tests/diag-achievements-burst.mjs
import * as S from '../src/state.js';
import { compileSemantic } from '../src/semantic.js';
import { matchAll } from '../src/achievements/engine.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from '../src/achievements/patterns.js';

const ALL = [...SOLO_PATTERNS, ...WEAVE_PATTERNS];
const byId = new Map(ALL.map((p) => [p.id, p]));

const fire = (build) => {
  const st = S.createState();
  const cam = { x: 0, y: 0, z: 40 };
  void cam;
  build(st, S);
  S.ensureEvaluated(st);
  const sg = compileSemantic(st);
  // ★ 带上"真实历史"：新用户刚把图形画出来、什么都还没动过。
  //   否则那些"要求刻意操作/亲自动手"的判据会因为"无历史时放行"而全部通过，
  //   量出来的就不是生产环境的行为了（这正是我第一次复测没变化的原因）。
  sg.history = {
    maxEntities: st.entities.size, deleted: false, lastCount: st.entities.size,
    touched: new Map(), sig: new Map(), userTouched: new Set(),
  };
  return matchAll(sg, ALL);
};

const scenes = [
  ['画一条线段', (st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); }],
  // ★ 上一轮遗漏的两类：约束类（7 条同源候选）与角类（6 条同源候选）
  ['线段 + 水平约束', (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    if (S2.addConstraint) S2.addConstraint(st, 'horizontal', [a.id]);
  }],
  ['两条线段 + 水平约束', (st, S2) => {
    // 注意：两条线段的长度**故意不同**，否则「等长的两条线」会因为我造场景的巧合而成立，
    // 量出来的就不是真实情况了（第一次就是这么量出 9 条的）。
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    const b = S2.addEntity(st, 'segment', { x1: 0, y1: 1.2, x2: 5.1, y2: 1.2 });
    if (S2.addConstraint) { S2.addConstraint(st, 'horizontal', [a.id]); S2.addConstraint(st, 'horizontal', [b.id]); }
  }],
  ['线段 + 中点约束', (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    const p = S2.addEntity(st, 'point', { x: 1.5, y: 0 });
    if (S2.addConstraint) S2.addConstraint(st, 'midpoint', [p.id, a.id]);
  }],
  ['一个直角（两条垂直射线）', (st, S2) => {
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 0, y2: 3 });
  }],
  ['一个平角（两条反向射线）', (st, S2) => {
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: -3, y2: 0 });
  }],
  ['一个锐角（30°）', (st, S2) => {
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 2.6, y2: 1.5 });
  }],
  ['画一个圆', (st, S2) => { S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); }],
  ['画圆 + 两个线上点', (st, S2) => { const c = S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); S2.addEdgePoint(st, c.id, 0.3); S2.addEdgePoint(st, c.id, 1.2); }],
  ['画三角形', (st, S2) => { S2.addEntity(st, 'polygon', { pts: [[0, 0], [3, 0], [0, 2]] }); }],
  ['画矩形', (st, S2) => { S2.addEntity(st, 'polygon', { pts: [[0, 0], [3, 0], [3, 2], [0, 2]] }); }],
  ['两条线段 + 水平约束', (st, S2) => { const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); void a; S2.addEntity(st, 'segment', { x1: 0, y1: 1, x2: 3, y2: 1 }); }],
  ['一个角（两条射线）', (st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 0, y2: 3 }); }],
  ['正弦波', (st, S2) => { S2.addEntity(st, 'sine', { A: 1.5, lam: 6.28, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 }); }],
  ['圆 + 自由点', (st, S2) => { const c = S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); S2.addEntity(st, 'point', { x: 5, y: 1 }); void c; }],
];

let worst = 0;
const rows = [];
for (const [name, build] of scenes) {
  const fired = fire(build);
  rows.push([name, fired.length, fired.map((f) => f.title)]);
  if (fired.length > worst) worst = fired.length;
}
console.log(`典型操作 → 同时成立的成就数（引擎实跑，含尚未"稳定 500ms"的）`);
for (const [name, n, titles] of rows) {
  console.log(`\n【${name}】→ ${n} 条`);
  console.log('   ' + titles.join('、'));
}
console.log(`\n最多的一次同时成立 ${worst} 条`);

// 找出"总是成对/成组一起出现"的成就（在以上场景里从未单独出现）
const soloOnce = new Map();
const together = new Map();
for (const [, , titles] of rows) {
  const ids = titles.map((t) => ALL.find((p) => p.title === t)?.id);
  for (const id of ids) {
    if (!soloOnce.has(id)) soloOnce.set(id, { fired: 0, alone: 0, withOthers: 0 });
    const rec = soloOnce.get(id);
    rec.fired++;
    if (ids.length === 1) rec.alone++; else rec.withOthers++;
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const k = [ids[i], ids[j]].sort().join(' + ');
      together.set(k, (together.get(k) || 0) + 1);
    }
  }
}
const pairs = [...together.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
console.log(`\n"总是同时出现"的成就对（≥3 个场景）：${pairs.length} 对`);
for (const [k, n] of pairs.slice(0, 12)) {
  const [a, b] = k.split(' + ');
  console.log(`  · 「${byId.get(a)?.title || a}」+「${byId.get(b)?.title || b}」  同现 ${n} 次`);
}
const alwaysTogether = [...soloOnce.entries()].filter(([, r]) => r.fired >= 3 && r.alone === 0).map(([id]) => id);
console.log(`\n"从未单独出现过"的成就（≥3 次触发全都有同伴）：${alwaysTogether.length} 条`);
console.log('  ' + alwaysTogether.map((id) => `「${byId.get(id)?.title || id}」`).join('、'));
