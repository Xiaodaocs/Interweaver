// 表达式引擎测试（支撑 P5/P6 验收）
import { test, eq, approx, ok, throws } from './harness.mjs';
import { parseExpression, parseEquation, evalAst, freeLetters, collectRefs, ExprError } from '../src/expr.js';

const scopeOf = (vars = {}) => ({
  resolve: (n) => {
    if (n in vars) return vars[n];
    throw new ExprError(`未定义的量 "${n}"`);
  },
  resolveRef: () => { throw new ExprError('no ref'); },
});
const ev = (src, vars = {}) => evalAst(parseExpression(src), scopeOf(vars));

test('四则运算与优先级', () => {
  approx(ev('1+2*3'), 7);
  approx(ev('(1+2)*3'), 9);
  approx(ev('10/4'), 2.5);
});

test('幂与一元负号：-2^2 = -4，2^-3 = 0.125', () => {
  approx(ev('-2^2'), -4);
  approx(ev('2^-3'), 0.125);
  approx(ev('2^3^2'), 512); // 右结合
});

test('隐式乘法：2x、2(x+1)、a b、)(', () => {
  approx(ev('2x', { x: 5 }), 10);
  approx(ev('2(x+1)', { x: 2 }), 6);
  approx(ev('a b', { a: 3, b: 4 }), 12);
  approx(ev('(1+1)(2+1)'), 6);
});

test('函数与常量：sin(π)=0、sqrt、clamp、lerp、max', () => {
  approx(ev('sin(π)'), 0, 1e-12);
  approx(ev('sqrt(16)'), 4);
  approx(ev('clamp(15, 0, 10)'), 10);
  approx(ev('lerp(0, 10, 0.3)'), 3, 1e-12);
  approx(ev('max(3, 7, 5)'), 7);
  approx(ev('e^1'), Math.E);
});

test('希腊字母变量名可用', () => {
  approx(ev('2θ', { θ: 1.5 }), 3);
});

test('实体参数引用解析为 ref 节点', () => {
  const ast = parseExpression('c1.r*2');
  const { refs } = collectRefs(ast);
  eq(refs.length, 1);
  eq(refs[0].ent, 'c1');
  eq(refs[0].param, 'r');
});

test('错误信息友好：坏字符 / 括号未闭合 / 未知函数', () => {
  throws(() => parseExpression('2$'), '无法识别的字符');
  throws(() => parseExpression('sin(1'), '表达式不完整');
  // foo(1) 按数学惯例解析为隐式乘法 f*o*o*1；未定义变量在求值/绑定时才报
  throws(() => ev('q + 1'), '未定义的量');
});

test('方程归一化：2x+3=y 与 y=2x+3 等价', () => {
  const a = parseEquation('2x+3=y');
  const b = parseEquation('y=2x+3');
  eq(a.kind, 'explicit'); eq(b.kind, 'explicit');
  approx(evalAst(a.ast, scopeOf({ x: 4 })), 11);
  approx(evalAst(b.ast, scopeOf({ x: 4 })), 11);
});

test('裸表达式 sin(x) 视为显函数', () => {
  const r = parseEquation('sin(x)');
  eq(r.kind, 'explicit');
  approx(evalAst(r.ast, scopeOf({ x: Math.PI / 2 })), 1);
});

test('隐函数识别：x^2+y^2=25 → implicit（P6 后支持，走温柔提示）', () => {
  const r = parseEquation('x^2+y^2=25');
  eq(r.kind, 'implicit');
});

test('自由字母检测：排除 x、常量、已定义变量', () => {
  const ast = parseExpression('a*x + b + π + k');
  const free = freeLetters(ast, new Set(['k']));
  eq(free.sort().join(','), 'a,b');
});

test('自由字母不含实体引用名', () => {
  const ast = parseExpression('c1.r + q');
  const free = freeLetters(ast, new Set());
  eq(free.join(','), 'q');
});
