// T1 单元测试：graph.js 的 evalWith2(ast, x, y) —— 隐函数的双变量求值地基。
//
// 覆盖（全部对比**真实求值结果**，无桩、无兜底）：
//   ① 纯双变量：x + y
//   ② 圆方程：x² + y² − 1 在 (1,0) 与 (0,0) 的正负
//   ③ 引用工作区变量：x + y*k（k=2）
//   ④ 引用实体参数：x² + y² − c.r²（c.r=3）
//   ⑤ 只用 y 不依赖 x
//   ⑥ 只用 x 时与既有 evalWith 结果一致（保证扩展没改变旧语义）
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { createState, addEntity, addVariable, ensureEvaluated } from "../src/state.js";
import { evaluateAll } from "../src/graph.js";
import { parseExpression } from "../src/expr.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };
const close = (a, b, eps = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= eps;

const st = createState();
addVariable(st, "k", { value: 2, min: 0, max: 10 });
const c = addEntity(st, "circle", { cx: 0, cy: 0, r: 3 });
ensureEvaluated(st);
const { scope } = evaluateAll(st);
const E = (s) => parseExpression(s);

ok(typeof scope.evalWith2 === "function", "scope 暴露 evalWith2");
ok(close(scope.evalWith2(E("x+y"), 2, 3), 5), "① x+y 在 (2,3) = 5");
ok(close(scope.evalWith2(E("x^2+y^2-1"), 1, 0), 0), "② x²+y²−1 在 (1,0) = 0（在曲线上）");
ok(close(scope.evalWith2(E("x^2+y^2-1"), 0, 0), -1), "② x²+y²−1 在 (0,0) = −1（在曲线内）");
ok(scope.evalWith2(E("x^2+y^2-1"), 2, 0) > 0, "② x²+y²−1 在 (2,0) > 0（在曲线外）");
ok(close(scope.evalWith2(E("x+y*k"), 1, 3), 7), "③ x+y*k 引用了工作区变量 k=2（1+3×2=7）");
const label = c.label;
ok(close(scope.evalWith2(E("x^2+y^2-" + label + ".r^2"), 3, 0), 0), "④ 引用了实体参数 " + label + ".r（3²−3²=0）");
ok(close(scope.evalWith2(E("y*2"), 0, 4), 8), "⑤ 只用 y：y*2 在 y=4 = 8");
ok(close(scope.evalWith2(E("x*3"), 5, 99), scope.evalWith(E("x*3"), 5)), "⑥ 只用 x 时与 evalWith 完全一致");

console.log(`\nT1 evalWith2：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
