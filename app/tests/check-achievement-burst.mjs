// 回归检查：防止"一个操作同时解锁一大堆成就"再次出现
//   用户报告："新用户一上来可能会解锁大量成就。而通常某个操作会同时解锁多个成就。
//   例如：'一条线的孤独'和'第一条线段'判定条件相同，这个时候就得修改。"
// 这里用真引擎实跑典型操作，钉住"同时成立条数"的上限，并点名用户举的例子。
import * as S from '../src/state.js';
import { compileSemantic } from '../src/semantic.js';
import { matchAll } from '../src/achievements/engine.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from '../src/achievements/patterns.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const ALL = [...SOLO_PATTERNS, ...WEAVE_PATTERNS];
const fire = (build, history) => {
  const st = S.createState();
  build(st, S);
  S.ensureEvaluated(st);
  const sg = compileSemantic(st);
  if (history) sg.history = history;
  return matchAll(sg, ALL).map((r) => r.id);
};
// 带"真实历史"的版本：先造场景，再按场景内容构造 history（模拟 runtime.step 维护出来的那份）
const fireWith = (build, mkHistory) => {
  const st = S.createState();
  build(st, S);
  S.ensureEvaluated(st);
  const sg = compileSemantic(st);
  sg.history = mkHistory(st);
  return matchAll(sg, ALL).map((r) => r.id);
};
/** 造一份"什么都没动过"的历史（新用户刚把图形画出来，全是默认值） */
const untouched = () => ({ maxEntities: 9, deleted: false, lastCount: 0, touched: new Map(), sig: new Map(), userTouched: new Set() });
/** 造一份"动过某实体某个参数"的历史 */
const touchedOne = (entId, key) => ({ maxEntities: 9, deleted: false, lastCount: 0, touched: new Map([[entId, new Set([key])]]), sig: new Map(), userTouched: new Set() });
/** 造一份"用户**亲手**动过某实体"的历史（state.setParams 的 gesture=true 才记，与求解器的自动调整区分） */
const userMovedOne = (entId) => ({ maxEntities: 9, deleted: false, lastCount: 0, touched: new Map(), sig: new Map(), userTouched: new Set([entId]) });
const firstEntId = (st, type) => { for (const [id, e] of st.entities) if (e.type === type) return id; return null; };

// ① 用户点名的例子：画第一条线段，现在只应解锁「第一条线段」一条
const segFirst = fire((st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); });
ok(segFirst.length === 1, `画一条线段 → 同时成立 ${segFirst.length} 条（要求 1）：${segFirst.join('、')}`);
ok(segFirst.includes('geo.segment.first'), '其中包含「第一条线段」');
ok(!segFirst.includes('egg.lonely.line'), '**不再**同时解锁「一条线的孤独」（用户点名的重复判据）← 它现在要求"曾经堆过 >5 个实体再删到只剩一条"');

// ② 「一条线的孤独」的新契约：有历史才成立
ok(fire((st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); }, { maxEntities: 7, deleted: true }).includes('egg.lonely.line'),
  '有历史（曾经 7 个实体、发生过删除）+ 只剩一条线段 → 「一条线的孤独」成立');
ok(!fire((st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); }, { maxEntities: 4, deleted: true }).includes('egg.lonely.line'),
  '没超过 5 个实体 → 不成立');

// ③ 其它典型操作：同时成立条数要有上限（"一上来解锁一大堆"是不允许的）
//    ★ 注意：这里带上**真实历史**（新用户刚画出来、什么都没调过）
//      —— 参数值类成就（整数半径/标准波长/整数波长/相位为零/过原点/确实是周期）都不该白送。
const scenes = [
  ['画一个圆（默认 r=2，没调过）', (st, S2) => { S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); }, 1],
  ['画圆 + 两个线上点', (st, S2) => { const c = S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); S2.addEdgePoint(st, c.id, 0.3); S2.addEdgePoint(st, c.id, 1.2); }, 2],
  ['两条线段', (st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); S2.addEntity(st, 'segment', { x1: 0, y1: 1, x2: 3, y2: 1 }); }, 3],
  ['一个角（两条射线）', (st, S2) => { S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 }); S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 0, y2: 3 }); }, 3],
  ['正弦波（默认参数，没调过）', (st, S2) => { S2.addEntity(st, 'sine', { A: 1.5, lam: 6.28, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 }); }, 1],
];
for (const [name, build, limit] of scenes) {
  const ids = fireWith(build, untouched);
  ok(ids.length <= limit, `${name} → 同时成立 ${ids.length} 条（上限 ${limit}）：${ids.join('、')}`);
}

// ★ 反面：刻意调过参数之后，对应的成就**应该**成立（否则就成了"永远拿不到"）
const sineLam = fireWith(
  (st, S2) => { S2.addEntity(st, 'sine', { A: 1.5, lam: 6.28, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 }); },
  (st) => touchedOne(firstEntId(st, 'sine'), 'lam'),
);
ok(sineLam.includes('fn.sine.lam.2pi'), '把波长**刻意调成 2π** → 「标准波长」成立（不是白送，但拿得到）');
const circleR = fireWith(
  (st, S2) => { S2.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 }); },
  (st) => touchedOne(firstEntId(st, 'circle'), 'r'),
);
ok(circleR.includes('geo.circle.integer.r'), '把半径**刻意调成整数** → 「整数半径」成立');

// ★ 约束类 / 角类：上一轮量出来的两个重灾区（5 条 / 9 条）。
//   修法：「严丝合缝」「真的水平了」「正好一半」要求**用户亲手动过被约束的对象**
//   （state.setParams 的 gesture=true 才记，与求解器把残差压到 0 区分开）。
const conScenes = [
  ['线段 + 水平约束', (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    if (S2.addConstraint) S2.addConstraint(st, 'horizontal', [a.id]);
  }, 3],
  ['线段 + 中点约束', (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    const pt = S2.addEntity(st, 'point', { x: 1.5, y: 0 });
    if (S2.addConstraint) S2.addConstraint(st, 'midpoint', [pt.id, a.id]);
  }, 4],
  ['两条线段 + 2 个水平约束（长度故意不同）', (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    const b = S2.addEntity(st, 'segment', { x1: 0, y1: 1.2, x2: 5.1, y2: 1.2 });
    if (S2.addConstraint) { S2.addConstraint(st, 'horizontal', [a.id]); S2.addConstraint(st, 'horizontal', [b.id]); }
  }, 6],
];
for (const [name, build, limit] of conScenes) {
  const ids = fireWith(build, untouched);
  ok(ids.length <= limit, `${name} → 同时成立 ${ids.length} 条（上限 ${limit}）：${ids.join('、')}`);
}
// 反向验证：用户**亲手**动过被约束的对象后，精确度成就应该拿得到
const mid = fireWith(
  (st, S2) => {
    const a = S2.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 0 });
    if (S2.addConstraint) S2.addConstraint(st, 'horizontal', [a.id]);
  },
  (st) => userMovedOne(firstEntId(st, 'segment')),
);
ok(mid.includes('con.horizontal.exact'), '亲手调过那条线段后再加水平约束 → 「真的水平了」成立（挣得到，不是白送）');

// ④ 全局上限：任何单步操作都不该一次点亮"一大堆"（用户描述的现象）
const worst = Math.max(...scenes.map(([, build]) => fireWith(build, untouched).length),
  ...conScenes.map(([, build]) => fireWith(build, untouched).length));
console.log(`  · 本组场景里的最大同时成立数 = ${worst}`);
ok(worst <= 6, `单步操作最多同时成立 ${worst} 条（上限 6）`);

console.log(`\n成就并发解锁核验: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
