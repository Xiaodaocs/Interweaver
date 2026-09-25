process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import { createState, addEntity, addBinding, addConstraint, ensureEvaluated, getDerived, addEdgePoint } from '../src/state.js';

// 用户场景（单位圆 → 正弦曲线）的**回归断言**：
//   圆 + 圆上点 P + 半径段 S1（两端绑到圆心与 P）+ 直径点 Q + 线段 S2（两端都绑定）+ S2 约束竖直。
//   拖 P（连续多次）→ S2 必须始终严格竖直，且 Q 被带着沿直径左右平移。
// 这一条锁住两个真 bug：① 两端都被绑定时约束无自由变量、力传不出去；
//   ② constraints.js 的 syncValues 曾把「被绑定参数的原始参数」写进生效值缓存，把正确值抹成 0。
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fails.push(m); console.log('  ✗ ' + m); } };

const st = createState();
const C = addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
const ap = addEdgePoint(st, C.id, 0.2);
const P = ap && ap.point ? ap.point : ap;
const S1 = addEntity(st, 'segment', { x1: 0, y1: 0, x2: 1, y2: 1 });
const Q = addEntity(st, 'point', { x: 2, y: 0 });
const S2 = addEntity(st, 'segment', { x1: 0, y1: 0, x2: 2, y2: 0 });
addBinding(st, S1.id, 'x1', C.label + '.cx'); addBinding(st, S1.id, 'y1', C.label + '.cy');
addBinding(st, S1.id, 'x2', P.label + '.x');  addBinding(st, S1.id, 'y2', P.label + '.y');
addBinding(st, S2.id, 'x1', P.label + '.x');  addBinding(st, S2.id, 'y1', P.label + '.y');
addBinding(st, S2.id, 'x2', Q.label + '.x');  addBinding(st, S2.id, 'y2', Q.label + '.y');
const rc = addConstraint(st, 'vertical', [S2.id]);
ensureEvaluated(st, { solve: true });
ok(rc.ok, '加了竖直约束（线段2 垂直于世界坐标系）');
ok(Object.keys(S2.bound || {}).length === 4, `线段2 两端四参全部被绑定（${JSON.stringify(Object.keys(S2.bound || {}))}）—— 这正是原来失效的场景`);

const eff = (id, k) => { const v = st.values.get(id + ':' + k); if (Number.isFinite(v)) return v; const e = st.entities.get(id); return e ? e.params[k] : NaN; };

let prevQx = null;
const seq = [0.35, 0.6, 0.9, 0.15, 0.5];
for (const t of seq) {
  P.params.t = t;
  ensureEvaluated(st, { solve: true, pin: new Set([P.id + ':t']) });
  const px = getDerived(st, P, 'x');
  const x1 = eff(S2.id, 'x1'), x2 = eff(S2.id, 'x2');
  const qx = eff(Q.id, 'x');
  const resid = Math.abs(x2 - x1);
  console.log(`  t=${t}: P.x=${px.toFixed(4)}  S2=(x1:${x1.toFixed(4)}, x2:${x2.toFixed(4)})  Q.x=${qx.toFixed(4)}  残差=${resid.toExponential(1)}`);
  ok(resid < 1e-6, `t=${t}：线段2 严格竖直（残差 ${resid.toExponential(1)}）`);
  ok(Math.abs(x1 - px) < 1e-6, `t=${t}：一端仍被圆上点驱动（x1=${x1.toFixed(4)} = P.x）`);
  ok(Math.abs(qx - px) < 1e-6, `t=${t}：Q 被带着走（Q.x=${qx.toFixed(4)} = P.x）`);
  if (prevQx !== null) ok(Math.abs(qx - prevQx) > 1e-6, `t=${t}：Q 相对上一步确实左右移动了（${prevQx.toFixed(4)} → ${qx.toFixed(4)}）`);
  prevQx = qx;
}
console.log(`\n三角函数构造（两端都绑定 + 连续拖动）：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
