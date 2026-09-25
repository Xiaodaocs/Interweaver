// 需求验收（物理类比）：被硬约束的线是「被魔法固定成水平的铁棍」——不会变形，只会整体平移，
// 并把位移沿绑定链传给粘在它上面的东西。
//
// 复现用户的场景：
//   ① 线段 L 被约束为水平；L 的**左端**绑定到点 P（用户：绑定到一个点 + 另一条线）
//   ② L 的**右端**粘着一个圆 C（C.cx/C.cy 绑定到 L.x2/L.y2）
//   ③ 移动 P（等价于"拖动另一条线"把力传过来）
// 期望：
//   · L 仍然水平（约束严格成立）
//   · L 是**整体平移**：右端跟着走同样的位移（不被拉斜）
//   · C 跟着 L 一起平移，且全程保持绑定（C.cx === L.x2、C.cy === L.y2）
//   · 竖直约束同样成立（用户要求"保证垂直和水平可以使用"）
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { createState, addEntity, addVariable, addBinding, addConstraint, ensureEvaluated, getVal } from "../src/state.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ---------- 场景 A：水平铁棍 + 左端被驱动 + 右端粘着圆 ----------
{
  const st = createState();
  const L = addEntity(st, "segment", { x1: -5, y1: 0, x2: 5, y2: 0 });
  const P = addEntity(st, "point", { x: -5, y: 0 });
  const C = addEntity(st, "circle", { cx: 5, cy: 0, r: 1 });
  const r1 = addConstraint(st, "horizontal", [L.id]);
  addBinding(st, L.id, "x1", `${P.label}.x`);
  addBinding(st, L.id, "y1", `${P.label}.y`);
  addBinding(st, C.id, "cx", `${L.label}.x2`);
  addBinding(st, C.id, "cy", `${L.label}.y2`);
  ensureEvaluated(st, { solve: true });
  const before = { Lx1: getVal(st, L, "x1"), Ly1: getVal(st, L, "y1"), Lx2: getVal(st, L, "x2"), Ly2: getVal(st, L, "y2"), Cx: getVal(st, C, "cx"), Cy: getVal(st, C, "cy") };
  ok(r1.ok, `加了水平约束（${r1.error || "ok"}）`);
  console.log(`  初始：L=(${before.Lx1},${before.Ly1})→(${before.Lx2},${before.Ly2})  C=(${before.Cx},${before.Cy})`);

  // ③ 移动 P：位移 (3, 2)（相当于拖动另一条线，把力传过来）
  P.params.x = -5 + 3; P.params.y = 0 + 2;
  ensureEvaluated(st, { solve: true });
  const after = { Lx1: getVal(st, L, "x1"), Ly1: getVal(st, L, "y1"), Lx2: getVal(st, L, "x2"), Ly2: getVal(st, L, "y2"), Cx: getVal(st, C, "cx"), Cy: getVal(st, C, "cy") };
  console.log(`  移动 P 后：L=(${after.Lx1},${after.Ly1})→(${after.Lx2},${after.Ly2})  C=(${after.Cx},${after.Cy})`);

  ok(near(after.Ly1, after.Ly2, 1e-9), `铁棍仍然水平：y1=${after.Ly1} y2=${after.Ly2}（差 ${Math.abs(after.Ly2 - after.Ly1).toExponential(1)}）`);
  ok(near(after.Lx1, -5 + 3) && near(after.Ly1, 0 + 2), `被驱动的左端仍在它该在的位置（${after.Lx1}, ${after.Ly1}）`);
  ok(near(after.Lx2, 5 + 3, 1e-9) && near(after.Ly2, 0 + 2, 1e-9), `右端被**整体平移**带走同样的位移（${after.Lx2}, ${after.Ly2}，期望 (8, 2)）`);
  ok(near(after.Cx, after.Lx2, 1e-9) && near(after.Cy, after.Ly2, 1e-9), `圆跟着一起平移且保持绑定：C=(${after.Cx}, ${after.Cy}) === L 的右端`);
  ok(near(after.Cx, 8, 1e-9) && near(after.Cy, 2, 1e-9), `圆确实移动了同样的位移（期望 (8, 2)）`);
}

// ---------- 场景 B：竖直铁棍（用户要求"保证垂直和水平可以使用"） ----------
{
  const st = createState();
  const L = addEntity(st, "segment", { x1: 0, y1: -5, x2: 0, y2: 5 });
  const P = addEntity(st, "point", { x: 0, y: 5 });
  const r1 = addConstraint(st, "vertical", [L.id]);
  addBinding(st, L.id, "x2", `${P.label}.x`);
  addBinding(st, L.id, "y2", `${P.label}.y`);
  ensureEvaluated(st, { solve: true });
  P.params.x = 3; P.params.y = 7;
  ensureEvaluated(st, { solve: true });
  const a = { x1: getVal(st, L, "x1"), y1: getVal(st, L, "y1"), x2: getVal(st, L, "x2"), y2: getVal(st, L, "y2") };
  console.log(`  竖直场景：L=(${a.x1},${a.y1})→(${a.x2},${a.y2})`);
  ok(r1.ok, "加了竖直约束");
  ok(near(a.x1, a.x2, 1e-9), `铁棍仍然竖直：x1=${a.x1} x2=${a.x2}（差 ${Math.abs(a.x2 - a.x1).toExponential(1)}）`);
  ok(near(a.x1, 3, 1e-9) && near(a.y1, -5 + 2, 1e-9), `另一端被整体平移带走（期望 (3, -3)，实测 (${a.x1}, ${a.y1})）`);
}

// ---------- 场景 C：平行约束 + 绑定驱动（"被拽歪"的另一类） ----------
{
  const st = createState();
  const L1 = addEntity(st, "segment", { x1: -5, y1: 0, x2: 5, y2: 0 });     // 铁棍 1（与 L2 平行）
  const L2 = addEntity(st, "segment", { x1: -5, y1: 4, x2: 5, y2: 4 });     // 铁棍 2（参照）
  const P = addEntity(st, "point", { x: -5, y: 0 });
  const Drv = addEntity(st, "segment", { x1: -5, y1: 0, x2: -1, y2: 0 });   // 驱动者
  const r1 = addConstraint(st, "parallel", [L1.id, L2.id]);
  addBinding(st, L1.id, "x1", `${P.label}.x`);
  addBinding(st, L1.id, "y1", `${P.label}.y`);
  addBinding(st, P.id, "x", `${Drv.label}.x1`);
  addBinding(st, P.id, "y", `${Drv.label}.y1`);
  ensureEvaluated(st, { solve: true });
  const b0 = { x1: getVal(st, L1, "x1"), y1: getVal(st, L1, "y1"), x2: getVal(st, L1, "x2"), y2: getVal(st, L1, "y2") };
  const len0 = Math.hypot(b0.x2 - b0.x1, b0.y2 - b0.y1);
  Drv.params.x1 = -5 + 2; Drv.params.y1 = 0 + 1.5;
  ensureEvaluated(st, { solve: true });
  const a0 = { x1: getVal(st, L1, "x1"), y1: getVal(st, L1, "y1"), x2: getVal(st, L1, "x2"), y2: getVal(st, L1, "y2") };
  const len1 = Math.hypot(a0.x2 - a0.x1, a0.y2 - a0.y1);
  const dL1 = [a0.x1 - b0.x1, a0.y1 - b0.y1], dL2 = [a0.x2 - b0.x2, a0.y2 - b0.y2];
  console.log(`  平行场景：L1=(${a0.x1},${a0.y1})→(${a0.x2},${a0.y2})  两端位移=(${dL1})/(${dL2})`);
  ok(r1.ok, "加了平行约束");
  ok(Math.abs(dL1[0] - dL2[0]) < 1e-9 && Math.abs(dL1[1] - dL2[1]) < 1e-9, `两端位移一致 = 整体平移（(${dL1}) vs (${dL2})）`);
  ok(Math.abs(len1 - len0) < 1e-9, `长度不变（${len0.toFixed(3)} → ${len1.toFixed(3)}，刚体不变形）`);
  ok(Math.abs(a0.y2 - a0.y1) < 1e-9, `仍然水平 → 与 L2 平行（y1=${a0.y1} y2=${a0.y2}）`);
}

console.log(`\n刚体修复（铁棍模型）：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
