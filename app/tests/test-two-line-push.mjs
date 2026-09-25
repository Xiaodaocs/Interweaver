process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import { createState, addEntity, addBinding, addConstraint, ensureEvaluated, getDerived, addEdgePoint } from '../src/state.js';

// 用户要求第 2 项：两条线之间的**平行/垂直**，在"两端都被绑定"时也要能靠推上游满足。
// 场景：L2 的两端各绑到自由点；L1 的两端绑到一个会转动的驱动者（圆上点 + 圆心）。
// 改变 L1 的方向 → 力必须推到 L2 端点的来源（那两个点），把 L2 转成与 L1 平行。
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fails.push(m); console.log('  ✗ ' + m); } };

const eff = (st, id, k) => { const v = st.values.get(id + ':' + k); if (Number.isFinite(v)) return v; const e = st.entities.get(id); return e && Number.isFinite(e.params[k]) ? e.params[k] : NaN; };

const run = (kind) => {
  const st = createState();
  const C = addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  const ap = addEdgePoint(st, C.id, 0.2);
  const P = ap && ap.point ? ap.point : ap;
  // L1：半径（端点绑到圆心与圆上点）→ 会随圆上点转动
  const L1 = addEntity(st, 'segment', { x1: 0, y1: 0, x2: 1, y2: 0 });
  // L2：两端各绑到一个自由点
  const P1 = addEntity(st, 'point', { x: 1, y: 4 });
  const P2 = addEntity(st, 'point', { x: 4, y: 4 });
  const L2 = addEntity(st, 'segment', { x1: 1, y1: 4, x2: 4, y2: 4 });
  addBinding(st, L1.id, 'x1', C.label + '.cx'); addBinding(st, L1.id, 'y1', C.label + '.cy');
  addBinding(st, L1.id, 'x2', P.label + '.x');  addBinding(st, L1.id, 'y2', P.label + '.y');
  addBinding(st, L2.id, 'x1', P1.label + '.x'); addBinding(st, L2.id, 'y1', P1.label + '.y');
  addBinding(st, L2.id, 'x2', P2.label + '.x'); addBinding(st, L2.id, 'y2', P2.label + '.y');
  const rc = addConstraint(st, kind, [L1.id, L2.id]);
  ensureEvaluated(st, { solve: true });
  ok(rc.ok, `${kind}：约束已添加`);
  ok(Object.keys(L2.bound || {}).length === 4, `${kind}：L2 两端四参全被绑定（这正是原来失效的情形）`);

  const dirOf = (id) => {
    const dx = eff(st, id, 'x2') - eff(st, id, 'x1'), dy = eff(st, id, 'y2') - eff(st, id, 'y1');
    const L = Math.hypot(dx, dy) || 1;
    return { ux: dx / L, uy: dy / L, L };
  };
  const residual = (id1, id2) => {
    const a = dirOf(id1), b = dirOf(id2);
    return kind === 'parallel' ? Math.abs(a.ux * b.uy - a.uy * b.ux) : Math.abs(a.ux * b.ux + a.uy * b.uy);
  };
  console.log(`  ${kind} 初始：残差=${residual(L1.id, L2.id).toExponential(1)}  L2 方向=[${dirOf(L2.id).ux.toFixed(3)}, ${dirOf(L2.id).uy.toFixed(3)}] L=${dirOf(L2.id).L.toFixed(3)}`);

  // 转动驱动者（改圆上点的 t）→ L1 方向变化 → 约束必须靠推上游维持
  let allGood = true;
  for (const deg of [50, 100, 150, 210]) {
    P.params.t = (deg * Math.PI) / 180;
    ensureEvaluated(st, { solve: true, pin: new Set([P.id + ':t']) });
    const r1 = residual(L1.id, L2.id);
    const d2 = dirOf(L2.id);
    const lenKept = Math.abs(d2.L - 3) < 1e-6;    // L2 原长 3（刚体旋转不应改长度）
    console.log(`    转到 ${deg}°：残差=${r1.toExponential(1)}  L2 方向=[${d2.ux.toFixed(3)}, ${d2.uy.toFixed(3)}] L=${d2.L.toFixed(3)}  长度保持=${lenKept}`);
    if (!(r1 < 1e-6)) { ok(false, `${kind}：转到 ${deg}° 后两线关系被破坏（残差 ${r1.toExponential(2)}）`); allGood = false; }
  }
  ok(allGood, `${kind}：L2 始终被推着维持与 L1 的关系（力沿绑定链传到了它端点的来源）`);
};

run('parallel');
run('perpendicular');
console.log(`\n两线平行/垂直的推上游：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
