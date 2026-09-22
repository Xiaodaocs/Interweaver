// 表达式引擎：分词 / 递归下降解析 / 求值 / 方程归一化 / 自由字母检测
// 纯模块（无 DOM），Node 可直接测试。AST 为纯 JSON 可序列化结构。

export class ExprError extends Error {}

export const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  min: Math.min, max: Math.max, mod: (a, b) => ((a % b) + b) % b,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => a + (b - a) * t,
};
export const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, 'τ': Math.PI * 2 };

const ID_CHARS = 'A-Za-z0-9_πθλφΩωα-ωΑ-Ω';

export function tokenize(src) {
  const raw = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?\d+)?/.exec(src.slice(i));
      raw.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length; continue;
    }
    if (/[A-Za-z_πθλφΩωα-ωΑ-Ω]/.test(ch)) {
      const m = new RegExp(`^[A-Za-z_πθλφΩωα-ωΑ-Ω][${ID_CHARS}]*`).exec(src.slice(i));
      raw.push({ t: 'id', v: m[0] });
      i += m[0].length; continue;
    }
    if ('+-*/^(),='.includes(ch)) { raw.push({ t: ch }); i++; continue; }
    if (ch === '.') { raw.push({ t: '.' }); i++; continue; }
    throw new ExprError(`无法识别的字符 "${ch}"`);
  }
  // 隐式乘法：2x、2(x+1)、a b、(a+b)(c+d)
  const out = [];
  const isValueEnd = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === ')');
  const isValueStart = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');
  for (let k = 0; k < raw.length; k++) {
    const tk = raw[k];
    const prev = out[out.length - 1];
    if (isValueEnd(prev) && isValueStart(tk)) {
      // 已知函数名后跟 ( 是函数调用，不插 *
      if (!(prev.t === 'id' && tk.t === '(' && FUNCS[prev.v])) out.push({ t: '*' });
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
        return { k: 'call', fn: tk.v, args };
      }
      if (peek() && peek().t === '.') {
        eat('.');
        const p = eat();
        if (!p || p.t !== 'id') throw new ExprError('"." 后面应该是参数名，例如 c1.r');
        return { k: 'ref', ent: tk.v, param: p.v };
      }
      if (CONSTS[tk.v] !== undefined) return { k: 'num', v: CONSTS[tk.v] };
      return { k: 'var', name: tk.v };
    }
    if (tk.t === '(') { eat('('); const e = parseExpr(); eat(')'); return e; }
    throw new ExprError(`这里不应该出现 "${tk.v ?? tk.t}"`);
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
    case 'neg': return -evalAst(node.a, scope);
    case 'call': return FUNCS[node.fn](...node.args.map((a) => evalAst(a, scope)));
    case 'bin': {
      const l = evalAst(node.l, scope);
      if (node.op === '^') return Math.pow(l, evalAst(node.r, scope));
      const r = evalAst(node.r, scope);
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
