process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import { createState, addEntity, addBinding, addConstraint, ensureEvaluated, getDerived, addEdgePoint } from '../src/state.js';

// 用户场景的「直径上的点是**线上点**」版本：
//   圆 C + 圆上点 P + 半径段 S1 + **直径线段 D** + D 上的线上点 Q（只有参数 t）+ 线段 S2（两端都绑定）
//   + S2 约束竖直。期望：拖 P → S2 保持竖直 → 力推到 Q → **Q 沿直径滑动（调整它的 t）**。
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fails.push(m); console.log('  ✗ ' + m); } };

const st = createState();
const C = addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
const ap = addEdgePoint(st, C.id, 0.2);
const P = ap && ap.point ? ap.point : ap;
const D = addEntity(st, 'segment', { x1: -3, y1: 0, x2: 3, y2: 0 });   // 直径
const aq = addEdgePoint(st, D.id, 0.9);
const Q = aq && aq.point ? aq.point : aq;                                // 直径上的**线上点**
const S1 = addEntity(st, 'segment', { x1: 0, y1: 0, x2: 1, y2: 1 });
const S2 = addEntity(st, 'segment', { x1: 0, y1: 0, x2: 2, y2: 0 });
addBinding(st, S1.id, 'x1', C.label + '.cx'); addBinding(st, S1.id, 'y1', C.label + '.cy');
addBinding(st, S1.id, 'x2', P.label + '.x');  addBinding(st, S1.id, 'y2', P.label + '.y');
addBinding(st, S2.id, 'x1', P.label + '.x');  addBinding(st, S2.id, 'y1', P.label + '.y');
addBinding(st, S2.id, 'x2', Q.label + '.x');  addBinding(st, S2.id, 'y2', Q.label + '.y');
addConstraint(st, 'vertical', [S2.id]);
ensureEvaluated(st, { solve: true });

const eff = (id, k) => { const v = st.values.get(id + ':' + k); if (Number.isFinite(v)) return v; const e = st.entities.get(id); return e ? e.params[k] : NaN; };
ok(Q.type === 'edgepoint', `直径上的点确实是线上点（type=${Q.type}，paramsOf 只有 t）`);

let prevQx = null, allGood = true;
for (const deg of [40, 70, 110, 150, 200]) {
  const rad = (deg * Math.PI) / 180;
  P.params.t = rad;
  ensureEvaluated(st, { solve: true, pin: new Set([P.id + ':t']) });
  const px = getDerived(st, P, 'x');
  const x1 = eff(S2.id, 'x1'), x2 = eff(S2.id, 'x2');
  const qx = getDerived(st, Q, 'x'), qt = eff(Q.id, 't');
  const resid = Math.abs(x2 - x1);
  const onD = Math.abs(getDerived(st, Q, 'y')) < 1e-9 && qx >= -3 - 1e-9 && qx <= 3 + 1e-9;
  console.log(`  ${deg}°: P.x=${px.toFixed(4)}  S2=(x1:${x1.toFixed(4)}, x2:${x2.toFixed(4)})  Q=(${qx.toFixed(4)},${getDerived(st, Q, 'y').toFixed(4)}) t=${qt.toFixed(4)}  残差=${resid.toExponential(1)}`);
  if (!(resid < 1e-6)) { ok(false, `${deg}° 时 S2 不竖直（残差 ${resid.toExponential(2)}）`); allGood = false; }
  if (!onD) { ok(false, `${deg}° 时 Q 跑到直径外了`); allGood = false; }
  if (Math.abs(qx - px) > 1e-6) { ok(false, `${deg}° 时 Q 没跟上（Q.x=${qx.toFixed(4)} vs P.x=${px.toFixed(4)}）`); allGood = false; }
  if (prevQx !== null && Math.abs(qx - prevQx) < 1e-6) { ok(false, `${deg}° 时 Q 实际没动`); allGood = false; }
  prevQx = qx;
}
ok(allGood, '线上点（直径上的点）全程：S2 严格竖直 + Q 沿直径滑动 + Q 始终在直径上');
console.log(`\n线上点版本（推上游按宿主 t 反解）：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
