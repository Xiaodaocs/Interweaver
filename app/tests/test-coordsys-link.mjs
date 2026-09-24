// S8b 断言（用户要求 ③：不同坐标系之间也可以互连）
//
// 互连语义 = 父子关系，父坐标系的变换**复合**到子坐标系及其成员。用闭式解做数值断言：
//   子坐标系原点 (10,0) 挂在父坐标系（原点 (0,0)）下：
//     · 父旋转 90° → 子原点应到 (0,10)、子的成员圆（在 (12,0)）应到 (0,12)
//     · 父平移 (5,0) → 子到 (5,10)、成员到 (5,12)
//     · 父缩放 ×2 → 子到 (10,20)、成员到 (10,24)（相对父原点的距离翻倍）
//   注意：缩放/旋转的中心是**根坐标系的当前位置**（前面已把它平移到 (5,0)），因此第三步 x 不变、y 相对它翻倍。
//   另外断言：未归入任何坐标系的图形**不受影响**（隔离性）；成环连接被拒绝；断开互连生效。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { createState, addEntity, assignCoordsys, linkCoordsys, unlinkCoordsys, applyCoordsysDelta, ensureEvaluated } from "../src/state.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const P = (st, id) => st.entities.get(id).params;

const st = createState();
// 父坐标系 B 在原点；子坐标系 A 在 (10,0)；A 的成员圆在 (12,0)；另有一个"局外"圆在 (100,0)
const B = addEntity(st, "coordsys", { x: 0, y: 0, scale: 50, rot: 0 });
const A = addEntity(st, "coordsys", { x: 10, y: 0, scale: 50, rot: 0 });
const m = addEntity(st, "circle", { cx: 12, cy: 0, r: 1 });
const outsider = addEntity(st, "circle", { cx: 100, cy: 0, r: 1 });
ensureEvaluated(st);

// 归属：A 的成员
const asg = assignCoordsys(st, [m.id], A.id);
ok(asg.ok && P(st, m.id).cs === undefined && st.entities.get(m.id).cs === A.id, "把成员圆归入子坐标系 A");

// 互连：A 挂到 B 下
const lk = linkCoordsys(st, A.id, B.id);
ok(lk.ok && st.entities.get(A.id).parent === B.id, "A 互连到 B（A.parent = B）");

// ① 父旋转 90°
let r = applyCoordsysDelta(st, B.id, { drot: Math.PI / 2 });
ok(r.ok && r.moved >= 1, `对父坐标系旋转 90°（带动成员 ${r.moved} 个）`);
ok(near(P(st, B.id).x, 0) && near(P(st, B.id).y, 0), "父原点不动（旋转中心是它自己）");
ok(near(P(st, A.id).x, 0, 1e-9) && near(P(st, A.id).y, 10, 1e-9), `子坐标系原点 (10,0) → (${P(st, A.id).x.toFixed(4)}, ${P(st, A.id).y.toFixed(4)})，期望 (0,10)`);
ok(near(P(st, m.id).cx, 0, 1e-9) && near(P(st, m.id).cy, 12, 1e-9), `子坐标系的成员 (12,0) → (${P(st, m.id).cx.toFixed(4)}, ${P(st, m.id).cy.toFixed(4)})，期望 (0,12)`);
ok(near(P(st, outsider.id).cx, 100) && near(P(st, outsider.id).cy, 0), "未归入任何坐标系的图形不受影响（隔离性）");

// ② 父平移 (5,0)
r = applyCoordsysDelta(st, B.id, { dx: 5, dy: 0 });
ok(near(P(st, B.id).x, 5), "父平移 → 父原点 (5,0)");
ok(near(P(st, A.id).x, 5) && near(P(st, A.id).y, 10), `子坐标系随之到 (${P(st, A.id).x.toFixed(4)}, ${P(st, A.id).y.toFixed(4)})，期望 (5,10)`);
ok(near(P(st, m.id).cx, 5) && near(P(st, m.id).cy, 12), `成员随之到 (${P(st, m.id).cx.toFixed(4)}, ${P(st, m.id).cy.toFixed(4)})，期望 (5,12)`);

// ③ 父缩放 ×2（以父原点为中心）
r = applyCoordsysDelta(st, B.id, { dk: 2 });
ok(near(P(st, B.id).scale, 100), `父单位长度 ×2（50 → ${P(st, B.id).scale.toFixed(0)}）`);
ok(near(P(st, A.id).x, 5) && near(P(st, A.id).y, 20), `子坐标系到 (${P(st, A.id).x.toFixed(4)}, ${P(st, A.id).y.toFixed(4)})，期望 (5,20)（缩放中心 = 父当前位置 (5,0)）`);
ok(near(P(st, m.id).cx, 5) && near(P(st, m.id).cy, 24), `成员到 (${P(st, m.id).cx.toFixed(4)}, ${P(st, m.id).cy.toFixed(4)})，期望 (5,24)`);
ok(near(P(st, m.id).r, 2), `成员的尺寸随缩放（r 1 → ${P(st, m.id).r.toFixed(2)}）`);

// ④ 成环被拒绝：B 连到 A（A 已是 B 的子）
const cyc = linkCoordsys(st, B.id, A.id);
ok(!cyc.ok && /环/.test(cyc.error || ''), `成环连接被拒绝（${cyc.error}）`);

// ⑤ 自连被拒绝
const self = linkCoordsys(st, A.id, A.id);
ok(!self.ok, `自连被拒绝（${self.error}）`);

// ⑥ 断开互连后，父的变换不再带动子
const un = unlinkCoordsys(st, A.id);
ok(un.ok && !st.entities.get(A.id).parent, "断开互连");
const ax = P(st, A.id).x, mx = P(st, m.id).cx;
applyCoordsysDelta(st, B.id, { dx: 100, dy: 0 });
ok(near(P(st, A.id).x, ax) && near(P(st, m.id).cx, mx), "断开后父的变换不再带动子坐标系与其成员");

console.log(`\nS8b 坐标系互连：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
