// 表达式引擎：分词 / 递归下降解析 / 求值 / 方程归一化 / 自由字母检测
// 纯模块（无 DOM），Node 可直接测试。AST 为纯 JSON 可序列化结构。

export class ExprError extends Error {}

// ★ issue#7 第 1 条：函数全表（「支持所有数学界使用的三角函数指令」）
//   约定（写清楚，免得以后又要猜）：
//     · 反三角同时接受 asin/acos/atan 与 **arc 系**（arcsin/arccos/arctan）——两种命名数学界都通用；
//     · log = log10（沿用本引擎既有语义，未改），另补 log2 / log10 的显式写法；
//     · mod/clamp/lerp 是本应用内部工具函数，保留（老场景里有引用）。
export const FUNCS = {
  // 三角 + 倒数三角
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  cot: (a) => 1 / Math.tan(a), sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a),
  // 反三角（asin 系 + arc 系，同一实现：别名必须与原名逐位等价）
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  // 双曲 + 反双曲
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  // 幂 / 根 / 指对数
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, pow: Math.pow,
  ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10,
  // 取整 / 符号 / 绝对值
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  // 多参数工具（保持原有）
  min: Math.min, max: Math.max, mod: (a, b) => ((a % b) + b) % b,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => a + (b - a) * t,
};

// ★ issue#7 第 2 条：允许「函数名后不写括号」（sin x）的**一元**函数。
//   多参数函数裸写必然歧义（max 3 是一个参数还是三个？），一律要求括号 —— 这条边界要清楚。
export const UNARY_FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'sqrt', 'cbrt', 'exp', 'ln', 'log', 'log2', 'log10',
  'abs', 'floor', 'ceil', 'round', 'sign',
]);

// 参数个数表：写错个数时给一句人话（min/max 是变参，不在此表里）
const ARITY = Object.fromEntries([...UNARY_FUNCS].map((k) => [k, [1, 1]]));
Object.assign(ARITY, { atan2: [2, 2], pow: [2, 2], mod: [2, 2], clamp: [3, 3], lerp: [3, 3] });

// ★ issue#7 第 3 条：虚数单位（用大写 I 表示）。
//   表示就是一个普通对象（AST 仍然 100% 可 JSON 序列化）；**虚部为 0 时收回成普通数字**，
//   所以 I^2 就是数字 -1、(1+I)(1-I) 就是数字 2 —— 实数作图侧看到的仍是老样子。
export const IMAG_UNIT = { re: 0, im: 1, cplx: 1 };
export const isComplex = (v) => !!v && typeof v === 'object' && v.cplx === 1;

// ★ issue#7 第 4 条：自然常数「都使用大写字母，例如 PI，E 等」。
//   pi/π/e/tau/τ 这些老写法一个都不许坏（老场景、老测试都在用）。
export const CONSTS = {
  pi: Math.PI, PI: Math.PI, 'π': Math.PI,
  e: Math.E, E: Math.E,
  tau: Math.PI * 2, TAU: Math.PI * 2, 'τ': Math.PI * 2,
  I: IMAG_UNIT,
};

// ---------- 复数小工具（只在**真的超出实数**时才用到） ----------
// CX：虚部为 0 → 实数；任一分量非有限 → NaN（= 实数平面上"该点未定义"）。
// 对 NaN/Infinity 的这种归一化很重要：作图侧只认有限实数，不必认识复数。
const CX = (re, im) => (!Number.isFinite(re) || !Number.isFinite(im) ? NaN : (im === 0 ? re : { re, im, cplx: 1 }));
const RE = (v) => (isComplex(v) ? v.re : v);
const IM = (v) => (isComplex(v) ? v.im : 0);
const cAdd = (a, b) => CX(RE(a) + RE(b), IM(a) + IM(b));
const cSub = (a, b) => CX(RE(a) - RE(b), IM(a) - IM(b));
const cMul = (a, b) => CX(RE(a) * RE(b) - IM(a) * IM(b), RE(a) * IM(b) + IM(a) * RE(b));
const cDiv = (a, b) => {
  const d = RE(b) * RE(b) + IM(b) * IM(b);
  if (d === 0) return NaN;
  const r = RE(a), i = IM(a), br = RE(b), bi = IM(b);
  return CX((r * br + i * bi) / d, (i * br - r * bi) / d);
};
const cAbs = (a) => Math.hypot(RE(a), IM(a));
const cExp = (a) => { const m = Math.exp(RE(a)); return CX(m * Math.cos(IM(a)), m * Math.sin(IM(a))); };
const cLog = (a) => { const r = cAbs(a); return r === 0 ? NaN : CX(Math.log(r), Math.atan2(IM(a), RE(a))); };
const cSqrt = (a) => {
  const r = cAbs(a);
  if (!Number.isFinite(r)) return NaN;
  return CX(Math.sqrt((r + RE(a)) / 2), (IM(a) < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - RE(a)) / 2)));
};
// 复数幂：整数指数走**乘方展开**（I^2 精确等于 -1，不走 exp/log，避免 1e-16 残渣）；
// 其余走主值 z^w = exp(w·ln z)。数学上"负数的非整数次幂"在主值意义下就是复数（√-4 = 2i）。
function complexPow(l, r) {
  if (!isComplex(r) && Number.isInteger(r) && Math.abs(r) <= 64) {
    let n = Math.abs(r), base = l, acc = 1;
    while (n > 0) { if (n & 1) acc = cMul(acc, base); base = cMul(base, base); n >>= 1; }
    const p = r < 0 ? cDiv(1, acc) : acc;
    return CX(RE(p), IM(p));
  }
  return cExp(cMul(r, cLog(l)));
}
// 入参已经是复数时的函数支持面：开方/指对数/绝对值/幂 —— 三角与取整只对实数定义（→ NaN = 该点未定义）
const COMPLEX_FNS = {
  sqrt: cSqrt, exp: cExp, ln: cLog, abs: cAbs,
  log: (a) => cDiv(cLog(a), Math.LN10),
  log10: (a) => cDiv(cLog(a), Math.LN10),
  log2: (a) => cDiv(cLog(a), Math.LN2),
  pow: (a, b) => complexPow(a, b),
};
function complexCall(fn, args) {
  const f = COMPLEX_FNS[fn];
  return f ? f(...args) : NaN;
}
// 实数入参、实数域无解（负数开方 / 负数取对数）→ 复数主值。这是"不许静默 NaN"的那一半：
// 数学上确实有值的，就把值算出来（sqrt(-1) = I）；真没有值的（如 1/0）才留 NaN/Infinity。
function complexRealFallback(fn, x) {
  if (!(x < 0)) return NaN;
  if (fn === 'sqrt') return CX(0, Math.sqrt(-x));
  if (fn === 'ln') return CX(Math.log(-x), Math.PI);
  if (fn === 'log' || fn === 'log10') return CX(Math.log(-x) / Math.LN10, Math.PI / Math.LN10);
  if (fn === 'log2') return CX(Math.log(-x) / Math.LN2, Math.PI / Math.LN2);
  return NaN;
}
// 表达式里是否出现虚数单位（UI 用它给出"实数平面上只画取实值的点"的提示）
export function astUsesImaginary(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.k === 'num') return isComplex(node.v);
  if (node.k === 'neg') return astUsesImaginary(node.a);
  if (node.k === 'bin') return astUsesImaginary(node.l) || astUsesImaginary(node.r);
  if (node.k === 'call') return node.args.some(astUsesImaginary);
  return false;
}

// ★ issue#7 第 6 条：便捷符号归一化 —— **纯函数**，只此一层，tokenize 之前调用。
//   √x → sqrt x、∛8 → cbrt 8（两侧留空格：否则 √x√y 会被粘成一个标识符 "xsqrt"）；
//   x² → x^2、x¹² → x^12、x⁻¹ → x^-1（上标连读成一整段指数）；
//   × · ⋅ → *、÷ ∶ → /、− – — ﹣ → -、全角括号/逗号/等号与全角数字 → 半角。
//   它只做字符替换，**不碰任何运算顺序**（优先级仍是解析器那一处的事）。
const SYM_MAP = {
  '×': '*', '✕': '*', '✖': '*', '·': '*', '⋅': '*', '∙': '*',
  '÷': '/', '∶': '/', '／': '/',
  '−': '-', '–': '-', '—': '-', '﹣': '-', '－': '-',
  '＋': '+', '＝': '=', '（': '(', '）': ')', '，': ',', '．': '.', '。': '.',
};
const SUP_DIGITS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const FULLWIDTH_DIGITS = '０１２３４５６７８９';

export function normalizeSymbols(src) {
  const s = String(src);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (SUP_DIGITS[ch] !== undefined) {                 // 上标：连读成一整段指数
      let j = i, exp = '';
      while (j < s.length && SUP_DIGITS[s[j]] !== undefined) { exp += SUP_DIGITS[s[j]]; j++; }
      if (out.endsWith('^')) out = out.slice(0, -1);     // 已经写了 ^ 就别再来一个（x^²）
      out += '^' + exp;
      i = j - 1; continue;
    }
    if (ch === '√') { out += ' sqrt '; continue; }
    if (ch === '∛') { out += ' cbrt '; continue; }
    const fw = FULLWIDTH_DIGITS.indexOf(ch);
    if (fw >= 0) { out += String(fw); continue; }
    out += SYM_MAP[ch] ?? ch;
  }
  return out;
}

const ID_CHARS = 'A-Za-z0-9_πθλφΩωα-ωΑ-Ω';

export function tokenize(src) {
  const norm = normalizeSymbols(src);
  const raw = [];
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(norm[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?\d+)?/.exec(norm.slice(i));
      raw.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length; continue;
    }
    if (/[A-Za-z_πθλφΩωα-ωΑ-Ω]/.test(ch)) {
      const m = new RegExp(`^[A-Za-z_πθλφΩωα-ωΑ-Ω][${ID_CHARS}]*`).exec(norm.slice(i));
      raw.push({ t: 'id', v: m[0] });
      i += m[0].length; continue;
    }
    if ('+-*/^(),='.includes(ch)) { raw.push({ t: ch }); i++; continue; }
    if (ch === '.') { raw.push({ t: '.' }); i++; continue; }
    throw new ExprError(`无法识别的字符 "${ch}"`);
  }
  // 隐式乘法（并置）：2x、2(x+1)、a b、(a+b)(c+d)
  // 补进去的乘号带 im:true —— 解析器要区分「用户写的 *」（sin x * 2 里那个）
  // 与「并置补的 *」（sin 2x 里那个），否则 sin x * 2 会被误读成 sin(x*2)。
  const out = [];
  const isValueEnd = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === ')');
  const isValueStart = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');
  for (let k = 0; k < raw.length; k++) {
    const tk = raw[k];
    const prev = out[out.length - 1];
    if (isValueEnd(prev) && isValueStart(tk)) {
      // 不插乘号的两处：① 已知函数名后跟 ( = 函数调用；② 已知**一元**函数名后跟值 = 函数应用（sin x）
      const isCall = prev.t === 'id' && FUNCS[prev.v]
        && (tk.t === '(' || (UNARY_FUNCS.has(prev.v) && (tk.t === 'num' || tk.t === 'id')));
      if (!isCall) out.push({ t: '*', im: true });
    }
    out.push(tk);
  }
  return out;
}

// AST: {k:'num',v} {k:'var',name} {k:'ref',ent,param} {k:'neg',a} {k:'bin',op,l,r} {k:'call',fn,args}
export function parseExpression(src) {
  const toks = tokenize(src);
  if (!toks.length) throw new ExprError('表达式是空的');
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (t) => {
    const tk = toks[pos];
    if (!tk || (t && tk.t !== t)) {
      if (!tk) throw new ExprError('表达式不完整');
      throw new ExprError(`这里应该是 "${t}"`);
    }
    pos++; return tk;
  };
  function parseExpr() {
    let l = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = eat().t;
      l = { k: 'bin', op, l, r: parseTerm() };
    }
    return l;
  }
  function parseTerm() {
    let l = parseUnary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = eat().t;
      l = { k: 'bin', op, l, r: parseUnary() };
    }
    return l;
  }
  function parseUnary() {
    if (peek() && peek().t === '-') { eat(); return { k: 'neg', a: parseUnary() }; }
    if (peek() && peek().t === '+') { eat(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parsePrimary();
    if (peek() && peek().t === '^') { eat(); return { k: 'bin', op: '^', l: base, r: parseUnary() }; }
    return base;
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new ExprError('表达式不完整');
    if (tk.t === 'num') { eat(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'id') {
      eat();
      if (peek() && peek().t === '(') {
        if (!FUNCS[tk.v]) throw new ExprError(`未知函数 "${tk.v}"`);
        eat('(');
        const args = [parseExpr()];
        while (peek() && peek().t === ',') { eat(); args.push(parseExpr()); }
        eat(')');
        checkArity(tk.v, args.length);
        return { k: 'call', fn: tk.v, args };
      }
      if (peek() && peek().t === '.') {
        eat('.');
        const p = eat();
        if (!p || p.t !== 'id') throw new ExprError('"." 后面应该是参数名，例如 c1.r');
        return { k: 'ref', ent: tk.v, param: p.v };
      }
      // ★ issue#7 第 2 条：函数名后不写括号（sin x，不止 sin(x)）。
      //   规则边界（本项最容易写错的地方，逐条写清楚）：
      //     ① 只对**一元**函数开放（UNARY_FUNCS）——多参数函数裸写必然歧义；
      //     ② 后一位必须是"值的开头"（数字/名字），否则退回普通变量名（老场景里叫 sin 的滑杆不受影响）；
      //     ③ 参数按**并置因子串**取：sin 2x = sin(2x)、sin sin x = sin(sin(x))；
      //        遇到"能自己吃参数的一元函数名"就收尾 → sin x cos x = sin(x)·cos(x)（不是 sin(x·cos(x))）；
      //     ④ 显式写的 * / + − ^ ) , 一律留给外层 → sin x * 2 = sin(x)·2、sin x + 1 = sin(x)+1；
      //     ⑤ 裸写负号不当作参数（sin -x 请写 sin(-x)）：否则 "sin - x" 会被悄悄改成 sin(-x)。
      const nx = peek();
      if (UNARY_FUNCS.has(tk.v) && nx && (nx.t === 'num' || nx.t === 'id')) {
        return { k: 'call', fn: tk.v, args: [parseJuxtaArg()] };
      }
      if (UNARY_FUNCS.has(tk.v) && nx && (nx.t === '+' || nx.t === '-')) {
        throw new ExprError(`函数 "${tk.v}" 后面要跟参数：写成 ${tk.v} x 或 ${tk.v}(x)；${tk.v} -x 请写成 ${tk.v}(-x)`);
      }
      if (CONSTS[tk.v] !== undefined) return { k: 'num', v: CONSTS[tk.v] };
      return { k: 'var', name: tk.v };
    }
    if (tk.t === '(') { eat('('); const e = parseExpr(); eat(')'); return e; }
    if (tk.t === '^') throw new ExprError('"^" 前面缺少底数');
    throw new ExprError(`这里不应该出现 "${tk.v ?? tk.t}"`);
  }
  // 参数个数检查：写错个数时给人话（例如 pow(2) / atan2(1)），而不是悄悄算出 NaN
  function checkArity(fn, n) {
    const a = ARITY[fn];
    if (!a || (n >= a[0] && n <= a[1])) return;
    throw new ExprError(a[0] === a[1]
      ? `函数 "${fn}" 需要 ${a[0]} 个参数，现在给了 ${n} 个`
      : `函数 "${fn}" 需要 ${a[0]}–${a[1]} 个参数，现在给了 ${n} 个`);
  }
  // 「并置因子串」：只跨过分词器补的乘号（im:true），不碰用户写的 * / 与 + − ^ ) ,
  function parseJuxtaArg() {
    let arg = parsePower();
    while (peek() && peek().t === '*' && peek().im === true) {
      const after = toks[pos + 1];
      if (!after || (after.t === 'id' && UNARY_FUNCS.has(after.v))) break;   // 下一个因子是新的函数应用 → 收尾
      eat();
      arg = { k: 'bin', op: '*', l: arg, r: parsePower() };
    }
    return arg;
  }
  const ast = parseExpr();
  if (pos < toks.length) throw new ExprError('表达式末尾多了内容');
  return ast;
}

export function evalAst(node, scope) {
  switch (node.k) {
    case 'num': return node.v;
    case 'var': return scope.resolve(node.name);
    case 'ref': return scope.resolveRef(node.ent, node.param);
    case 'neg': {
      const a = evalAst(node.a, scope);
      return isComplex(a) ? CX(-a.re, -a.im) : -a;
    }
    case 'call': {
      const args = node.args.map((a) => evalAst(a, scope));
      if (args.some(isComplex)) return complexCall(node.fn, args);   // 有虚部 → 复数支路
      const v = FUNCS[node.fn](...args);
      // 实数快路径与改动前**逐位一致**；只有"数学上确实有复数主值"的负数开方/取对数才转复数
      return Number.isNaN(v) ? (args.length === 1 ? complexRealFallback(node.fn, args[0]) : v) : v;
    }
    case 'bin': {
      const l = evalAst(node.l, scope);
      if (node.op === '^') {
        const r = evalAst(node.r, scope);
        if (isComplex(l) || isComplex(r)) return complexPow(l, r);
        const p = Math.pow(l, r);
        // 负底数 + 非整数指数：实数域无定义，复数域有主值（(-1)^0.5 = I、√-4 = 2I）
        return (Number.isNaN(p) && l < 0) ? complexPow(l, r) : p;
      }
      const r = evalAst(node.r, scope);
      if (isComplex(l) || isComplex(r)) {
        if (node.op === '+') return cAdd(l, r);
        if (node.op === '-') return cSub(l, r);
        if (node.op === '*') return cMul(l, r);
        return cDiv(l, r);
      }
      return node.op === '+' ? l + r : node.op === '-' ? l - r : node.op === '*' ? l * r : l / r;
    }
  }
  throw new ExprError('表达式内部错误');
}

// 收集引用：变量名集合 + 实体参数引用列表
export function collectRefs(ast, out = { vars: new Set(), refs: [] }) {
  switch (ast.k) {
    case 'var': out.vars.add(ast.name); break;
    case 'ref': out.refs.push({ ent: ast.ent, param: ast.param }); break;
    case 'neg': collectRefs(ast.a, out); break;
    case 'bin': collectRefs(ast.l, out); collectRefs(ast.r, out); break;
    case 'call': ast.args.forEach((a) => collectRefs(a, out)); break;
  }
  return out;
}

// 自由字母：排除坐标变量 x、常量、函数、已定义变量（defined 为 Set）
export function freeLetters(ast, defined = new Set()) {
  const { vars } = collectRefs(ast);
  const free = [];
  for (const v of vars) {
    if (v === 'x' || defined.has(v)) continue;
    free.push(v);
  }
  return [...new Set(free)];
}

// ============ P7 反向求解：把表达式对某个符号"反解"出来 ============
// 思路分两档：
//   1) 解析档：把表达式对目标符号线性化（a·x + b），直接 x = (目标 − b)/a；
//   2) 数值档：牛顿迭代 + 多个初值挑"离当前值最近"的那个解（保证分支连续）。
// 两者都不成 → 调用方回退到"弹簧回弹"。

// 对某个符号线性化：返回 {a, b} 表示 a·name + b；非线性则返回 null
// resolveConst(name) / resolveRef(ent, param) 用来把"其它量"当成常数求值
export function linearize(ast, name, scope) {
  const K = (a, b) => ({ a, b });
  const walk = (node) => {
    switch (node.k) {
      case 'num': return K(0, node.v);
      case 'var': return node.name === name ? K(1, 0) : K(0, scope.resolve(node.name));
      case 'ref': return K(0, scope.resolveRef(node.ent, node.param));
      case 'neg': { const v = walk(node.a); return v && K(-v.a, -v.b); }
      case 'call': return null;
      case 'bin': {
        const l = walk(node.l), r = walk(node.r);
        if (!l || !r) return null;
        switch (node.op) {
          case '+': return K(l.a + r.a, l.b + r.b);
          case '-': return K(l.a - r.a, l.b - r.b);
          case '*':
            if (l.a === 0) return K(r.a * l.b, r.b * l.b);
            if (r.a === 0) return K(l.a * r.b, l.b * r.b);
            return null;
          case '/':
            if (r.a === 0) {
              if (Math.abs(r.b) < 1e-300) return null;
              return K(l.a / r.b, l.b / r.b);
            }
            return null;
          case '^':
            if (r.a === 0 && Math.abs(r.b) < 1e-12) return K(0, 1);           // x^0
            if (r.a === 0 && Math.abs(Math.abs(r.b) - 1) < 1e-12) return K(l.a, l.b); // x^1
            return null;
          default: return null;
        }
      }
      default: return null;
    }
  };
  try { return walk(ast); } catch { return null; }
}

// 数值反解：找 f(x) = target。多个初值 → 取"离 current 最近"的收敛解（保持分支连续）
export function numericSolve(f, target, current, seeds) {
  const newton = (x0) => {
    let x = x0;
    for (let i = 0; i < 60; i++) {
      const y = f(x) - target;
      if (!Number.isFinite(y)) return null;
      if (Math.abs(y) < 1e-10) return x;
      const h = Math.max(1e-7, Math.abs(x) * 1e-7);
      const dy = (f(x + h) - f(x - h)) / (2 * h);
      if (!Number.isFinite(dy) || Math.abs(dy) < 1e-12) return null;
      const nx = x - y / dy;
      if (!Number.isFinite(nx)) return null;
      if (Math.abs(nx - x) < 1e-13) return Math.abs(f(nx) - target) < 1e-7 ? nx : null;
      x = nx;
    }
    return Math.abs(f(x) - target) < 1e-6 ? x : null;
  };
  const startList = seeds && seeds.length ? seeds
    : [current, current + 1, current - 1, current + 10, current - 10, 0, 1, -1];
  let best = null;
  for (const s0 of startList) {
    const r = newton(s0);
    if (r === null) continue;
    if (best === null || Math.abs(r - current) < Math.abs(best - current)) best = r;
  }
  return best;
}

// 方程归一化：y=f(x) / f(x)=y / 裸表达式 都归一为显函数；其余形如 x^2+y^2=25 判为隐函数（后续支持）
export function parseEquation(src) {
  const trimmed = src.trim();
  const eqCount = (trimmed.match(/=/g) || []).length;
  if (eqCount === 0) return { kind: 'explicit', ast: parseExpression(trimmed), src: trimmed };
  if (eqCount > 1) throw new ExprError('暂时只支持一个等号');
  const [l, r] = trimmed.split('=').map((s) => s.trim());
  if (l === 'y') return { kind: 'explicit', ast: parseExpression(r), src: trimmed };
  if (r === 'y') return { kind: 'explicit', ast: parseExpression(l), src: trimmed };
  // 两侧都不是单独 y：这是**隐函数** F(x,y) = 左式 − 右式。
  // 用括号包住两侧再相减，保证优先级正确；parseExpression 同时完成了语法校验。
  const fSrc = '(' + l + ') - (' + r + ')';
  return { kind: 'implicit', ast: parseExpression(fSrc), fSrc, src: trimmed };
}
