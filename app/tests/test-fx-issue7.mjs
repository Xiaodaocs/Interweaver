// issue #7「G4_函数生成器语法修正和支持」的可执行验收清单。
//
// 用法：`node tests/test-fx-issue7.mjs`（**暂未挂进 tests/run.mjs** ✗ ——
//   等 P2~P4 做完、这个文件全绿之后再挂 ✓ 否则基线会变红 ✗）。
//
// 它是**施工清单**也是**回归护栏**：
//   · 项1/2/3/4/6 与 项7 的硬限，在基线（eed9e34）上**预期是红的** ✗ —— 红的就是待做的活 ✓
//   · 项5 运算顺序在基线（eed9e34）上**已经是绿的** ✓ —— 原样固化，防止以后退化 ✓
//
// 判据来源：队长在干净基线上逐条探测的原始输出（见会话记录 P1）。
//   基线实测（逐字）：FUNCS 只有 17 个（sin cos tan asin acos atan atan2 sqrt abs ln log exp
//   floor ceil sign min max mod clamp lerp）· CONSTS 只有 pi π e tau τ · 没有 normalizeSymbols ·
//   `sin x` 报「未定义的量 sin」· `I`/`PI`/`E` 全部未定义 · `√9` 报「无法识别的字符 √」·
//   `pow(2,3)` 报「这里应该是 ")"」· func.params = dmin/dmax/cx/cy 且 create() 默认 -30..30。
import { test, eq, approx, ok, throws } from './harness.mjs';
import {
  parseExpression, evalAst, FUNCS, CONSTS, ExprError,
} from '../src/expr.js';
import { sampleCurve, REGISTRY } from '../src/entities.js';

// ── 求值脚手架：expr.js 是纯函数（无 DOM）✓ 可在 Node 里直接测 ✓ ────────────────
const scopeOf = (vars = {}) => ({
  resolve: (n) => {
    if (n in vars) return vars[n];
    throw new ExprError(`未定义的量 "${n}"`);
  },
  resolveRef: () => { throw new ExprError('no ref'); },
});
const ev = (src, vars = {}) => evalAst(parseExpression(src), scopeOf(vars));

// ── 假相机：与 state.js 的投影同一套约定（y 轴向上、z = 像素/世界单位）──────
const mkCam = (z, x = 0, y = 0, w = 1200, h = 700) => ({
  x, y, z,
  size: () => ({ w, h }),
  s2w: (sx, sy) => ({ x: sx / z - w / (2 * z) + x, y: -(sy / z - h / (2 * z)) + y }),
  w2s: (wx, wy) => [(wx - x) * z + w / 2, -(wy - y) * z + h / 2],
});

// ════════════════ 项1：所有数学界使用的三角函数指令（含 arc 写法）════════════════
test('issue7-1 函数全表存在：三角/反三角(含 arc 别名)/双曲/对数/取整', () => {
  // issue 原文：「支持所有数学界使用的三角函数指令（例如 arc）」
  const need = [
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'asin', 'acos', 'atan', 'atan2',
    'arcsin', 'arccos', 'arctan',            // ★ issue 点名的 arc 写法
    'sinh', 'cosh', 'tanh',
    'sqrt', 'cbrt', 'abs', 'ln', 'log', 'log2', 'log10', 'exp',
    'floor', 'ceil', 'round', 'sign', 'min', 'max', 'mod', 'pow',
  ];
  for (const name of need) ok(typeof FUNCS[name] === 'function', `FUNCS 里有 ${name}`);
});

test('issue7-1 三角函数数值正确（含 arc 别名与双曲）', () => {
  approx(ev('sin(1)'), Math.sin(1), 1e-15);
  approx(ev('cos(1)'), Math.cos(1), 1e-15);
  approx(ev('tan(1)'), Math.tan(1), 1e-15);
  approx(ev('cot(1)'), 1 / Math.tan(1), 1e-12);
  approx(ev('sec(1)'), 1 / Math.cos(1), 1e-12);
  approx(ev('csc(1)'), 1 / Math.sin(1), 1e-12);
  approx(ev('asin(0.5)'), Math.asin(0.5), 1e-15);
  approx(ev('atan2(1,1)'), Math.PI / 4, 1e-15);
  approx(ev('sinh(1)'), Math.sinh(1), 1e-15);
  approx(ev('cosh(1)'), Math.cosh(1), 1e-15);
  approx(ev('tanh(1)'), Math.tanh(1), 1e-15);
  approx(ev('log2(8)'), 3, 1e-12);
  approx(ev('cbrt(8)'), 2, 1e-12);
  approx(ev('round(1.5)'), 2, 1e-12);
  // arc 别名必须与 asin/acos/atan **等价**（不是另算一套 ✓）
  for (const [short, arc] of [['asin', 'arcsin'], ['acos', 'arccos'], ['atan', 'arctan']]) {
    approx(ev(`${arc}(0.5)`), ev(`${short}(0.5)`), 1e-15, `${arc} 与 ${short} 等价`);
  }
});

test('issue7-1 基线 bug：pow(2,3) 必须能调通（基线报「这里应该是 ")"」）', () => {
  approx(ev('pow(2,3)'), 8, 1e-12);
  approx(ev('pow(2, 10)'), 1024, 1e-12);
});

// ════════════════ 项2：sin x 的写法（不止 sin(x)）════════════════════════════
test('issue7-2 sin x 无括号写法', () => {
  // issue 原文：「支持 sin x 的写法，不止是 sin(x)」
  approx(ev('sin x', { x: 1 }), Math.sin(1), 1e-15);
  approx(ev('sin 2x', { x: 1 }), Math.sin(2), 1e-15);
  approx(ev('2 sin x', { x: 1 }), 2 * Math.sin(1), 1e-15);
  approx(ev('sin x cos x', { x: 1 }), Math.sin(1) * Math.cos(1), 1e-12);
  approx(ev('sin sin x', { x: 1 }), Math.sin(Math.sin(1)), 1e-15);
  approx(ev('cos 2x + 1', { x: 1 }), Math.cos(2) + 1, 1e-15);
});

test('issue7-2 优先级：sin x + 1 = sin(x)+1，**不是** sin(x+1)', () => {
  // 无括号函数应用只吃**一个因子**：这样才符合数学书写惯例 ✓ 也是本项最容易写错的地方 ✗
  approx(ev('sin x + 1', { x: 1 }), Math.sin(1) + 1, 1e-15);
  approx(ev('sin x * 2', { x: 1 }), Math.sin(1) * 2, 1e-15);
  approx(ev('sin 2x + 1', { x: 1 }), Math.sin(2) + 1, 1e-15);
  approx(ev('sin(x) + 1', { x: 1 }), Math.sin(1) + 1, 1e-15);   // 括号写法必须与无括号**同值**
  approx(ev('sin (x + 1)', { x: 1 }), Math.sin(2), 1e-15);      // 有括号才吃整个表达式 ✓
});

// ════════════════ 项3：虚数（大写 I）═══════════════════════════════════════
test('issue7-3 虚数 I 可解析：I^2 = -1，且 2I / (1+I)(1-I) 不报未定义', () => {
  // issue 原文：「支持虚数，用大写I表示」
  // 口径（队长确认过）：至少**能解析** ✓；实数作图下复数点按"未定义/不画"处理 ✓ 不静默出 NaN ✗
  approx(ev('I^2'), -1, 1e-12);
  approx(ev('(1+I)*(1-I)'), 2, 1e-12);
  ok(!Number.isNaN(ev('2I')), '2I 不该是 NaN');
});

// ════════════════ 项4：自然常数（大写）══════════════════════════════════════
test('issue7-4 大写常数 PI/E/TAU 可用，且小写与 π τ 不被写坏', () => {
  // issue 原文：「支持自然常数，都使用大写字母，例如PI ，E 等」
  approx(ev('PI'), Math.PI, 1e-15);
  approx(ev('E'), Math.E, 1e-15);
  approx(ev('TAU'), Math.PI * 2, 1e-15);
  approx(ev('2PI'), Math.PI * 2, 1e-15);
  approx(ev('E^2'), Math.E ** 2, 1e-12);
  // 老的写法**一个都不能坏** ✗（基线里它们是绿的 ✓）
  approx(ev('pi'), Math.PI, 1e-15);
  approx(ev('e'), Math.E, 1e-15);
  approx(ev('tau'), Math.PI * 2, 1e-15);
  approx(ev('π'), Math.PI, 1e-15);
  approx(ev('τ'), Math.PI * 2, 1e-15);
  ok(typeof CONSTS.PI === 'number' && typeof CONSTS.E === 'number', 'CONSTS 里要有大写项');
});

// ════════════════ 项5：运算顺序（基线已全对 ✓ 固化防退化 ✓）════════════════
test('issue7-5 运算顺序严格按数学惯例（不是从左到右）', () => {
  eq(ev('2+3*4'), 14);
  eq(ev('(2+3)*4'), 20);
  eq(ev('-2^2'), -4);          // 一元负号低于幂 ✓
  eq(ev('2^3^2'), 512);        // 幂**右结合** ✓
  eq(ev('1-2-3'), -4);         // 减法左结合 ✓
  eq(ev('8/4/2'), 1);          // 除法左结合 ✓
  eq(ev('2x', { x: 1 }), 2);   // 隐式乘法 ✓
  eq(ev('1/2x', { x: 1 }), 0.5); // 隐式乘法与除法的结合方式：1/(2x) 还是 (1/2)x —— 基线是 0.5 ✓ 保持
  approx(ev('sin 2^2'), Math.sin(4), 1e-12); // 函数应用**外**、幂**内**：sin(2^2) ✓
});

// ════════════════ 项6：便捷符号（根号等）═══════════════════════════════════
test('issue7-6 便捷符号：√ ∛ ² ³ × ÷ − 都要能输入', () => {
  // issue 原文：「为根号等数学算数增加相关便捷符号来输入」
  approx(ev('√9'), 3, 1e-12);
  approx(ev('√(x+1)', { x: 8 }), 3, 1e-12);
  approx(ev('2√x', { x: 4 }), 4, 1e-12);
  approx(ev('√x√y', { x: 4, y: 9 }), 6, 1e-12);
  approx(ev('∛8'), 2, 1e-12);
  approx(ev('x²', { x: 3 }), 9, 1e-12);
  approx(ev('x³', { x: 2 }), 8, 1e-12);
  approx(ev('3×4'), 12, 1e-12);
  approx(ev('8÷2'), 4, 1e-12);
  approx(ev('1−2'), -1, 1e-12);   // U+2212 减号
  approx(ev('2π'), Math.PI * 2, 1e-15);
});

// ════════════════ 项7：去掉左右长度限制 + 缩放自适应采样 ════════════════════
test('issue7-7 func 实体不再有 dmin/dmax 这对"左右长度限制"', () => {
  // issue 原文：「删除掉函数的生成左右长度限制，改为实时生成和渲染用户电脑画面中的内容」
  // 基线：params = dmin/dmax/cx/cy，create() 默认 -30..30 ✗
  const keys = (REGISTRY.func.params || []).map((p) => p.k);
  ok(!keys.includes('dmin'), 'func.params 里不该再有 dmin');
  ok(!keys.includes('dmax'), 'func.params 里不该再有 dmax');
  ok(keys.includes('cx') && keys.includes('cy'), 'cx/cy（平移）要保留 ✓');
});

test('issue7-7 采样密度随 cam.z 自适应：屏幕步长恒定 0.5px，世界步长 = 1/(2·cam.z)', () => {
  // 口径（用户确认）：「**缩放自适应采样**」✓ —— 采样密度随缩放自适应 ✓ 不是把定义域绑到视口 ✗
  // ★ 这条断言要**双向证明**（临时破坏实现必须变红 ✓ 再还原 ✓）—— 不许写成永远绿 ✗
  const w = 1200, h = 700;
  for (const z of [20, 200, 2000]) {
    const cam = mkCam(z, 0, 0, w, h);
    const r = sampleCurve(cam, (x) => Math.sin(x));
    const pts = (r && r.pts) || [];
    ok(pts.length > 2, `cam.z=${z} 应当有采样点`);
    const step = pts[1][0] - pts[0][0];
    approx(step * z, 0.5, 0.06, `cam.z=${z} 时屏幕步长应≈0.5px（实测 ${(step * z).toFixed(3)}px）`);
    approx(step, 1 / (2 * z), 0.02 * (1 / (2 * z)) + 1e-9, `cam.z=${z} 时世界步长应≈1/(2z)`);
  }
});

test('issue7-7 去掉限制后：视野平移到任意远处，曲线仍被采样', () => {
  // 这是"左右长度限制已删除"的**行为证据** ✓（基线 -30..30 时这里必然是空 ✗）
  for (const far of [1e3, 1e5, 1e7]) {
    const cam = mkCam(40, far, 0);
    const r = sampleCurve(cam, (x) => Math.sin(x));
    const pts = (r && r.pts) || [];
    ok(pts.length > 100, `视野在 x=${far} 时仍应采样出曲线（实测 ${pts.length} 点）`);
    const xs = pts.map((p) => p[0]);
    ok(Math.min(...xs) <= far && far <= Math.max(...xs), `采样区间应跨过视野中心 ${far}`);
  }
});
