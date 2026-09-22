// 响应式计算图：绑定求值（拓扑惰性 + 记忆化）、环检测、表达式作用域与取值环境
// 纯模块（无 DOM），Node 可测。
import { evalAst, ExprError } from './expr.js';
import { paramsOf, derivedOf, isBaseParam, writeAliasOf } from './entities.js';

const keyOf = (entId, param) => `${entId}:${param}`;

export function findByLabel(st, label) {
  for (const ent of st.entities.values()) if (ent.label === label) return ent;
  return null;
}

// 统一的取值环境：
//   env.val(entId, key)  任意实体的任意参数（基础参数或派生量，如 circle.area、ep1.x、a1.len）
//   env.ent(id)          按 id 取实体
//   env.st               场景（函数实体求 y=f(x) 时需要 scope）
// base(entId, key) 由调用方提供（负责绑定求值），此处只补上"派生量"这一层。
export function makeEnv(st, base) {
  const visiting = new Set();
  let env;
  const val = (entId, key) => {
    const ent = st.entities.get(entId);
    if (!ent) return NaN;
    if (isBaseParam(ent, key)) return base(entId, key);
    const d = derivedOf(ent, key);
    if (!d) return NaN;
    const kk = keyOf(entId, key);
    if (visiting.has(kk)) return NaN; // 兜底：防止派生量互相依赖成环
    visiting.add(kk);
    let v = NaN;
    try { v = d.compute((k) => val(entId, k), ent, env); } catch { v = NaN; }
    visiting.delete(kk);
    return v;
  };
  env = { val, ent: (id) => st.entities.get(id), st };
  return env;
}

export function makeScope(st, env) {
  const probeEval = new Set(); // 表达式观察器的环保护
  const scope = {
    resolve(name) {
      const v = st.variables.get(name);
      if (v) return v.value;
      // 观察器：只读量，也能写进表达式
      const p = st.probes?.get(name);
      if (p) {
        if (p.kind === 'expr') {
          // 表达式观察器：递归求值（带环保护）
          if (probeEval.has(name)) throw new ExprError(`观察器 "${name}" 绕回了自己`);
          probeEval.add(name);
          try { return evalAst(p.ast, scope); } finally { probeEval.delete(name); }
        }
        const ent = st.entities.get(p.entId);
        if (ent) return env.val(ent.id, p.key);
        throw new ExprError(`观察器 "${name}" 指向的图形已删除`);
      }
      throw new ExprError(`未定义的量 "${name}"`);
    },
    resolveRef(label, param) {
      const ent = findByLabel(st, label);
      if (!ent) throw new ExprError(`找不到实体 ${label}`);
      if (!isBaseParam(ent, param) && !derivedOf(ent, param) && !writeAliasOf(ent, param)) {
        throw new ExprError(`${label} 没有参数 "${param}"`);
      }
      return env.val(ent.id, param);
    },
    // 供函数实体求 y=f(x)：注入坐标 x
    evalWith(ast, x) {
      return evalAst(ast, { ...scope, resolve: (n) => (n === 'x' ? x : scope.resolve(n)) });
    },
    // 供**隐函数**实体求 F(x, y)：同时注入两个坐标。
    // 与 evalWith 同一模式（重写 resolve 拦截注入名），不复制求值逻辑、不做任何兜底；
    // 变量名若与 x/y 同名则被本函数的坐标覆盖 —— 与 evalWith 对 x 的既有行为一致。
    evalWith2(ast, x, y) {
      return evalAst(ast, { ...scope, resolve: (n) => (n === 'x' ? x : (n === 'y' ? y : scope.resolve(n))) });
    },
  };
  return scope;
}

// 全量求值：返回 { values, base, scope, env }
export function evaluateAll(st) {
  const values = new Map();
  const inProgress = new Set();

  const base = (entId, param) => {
    const k = keyOf(entId, param);
    if (values.has(k)) return values.get(k);
    const ent = st.entities.get(entId);
    if (!ent) return NaN;
    const bId = ent.bound?.[param];
    const binding = bId ? st.bindings.get(bId) : null;
    if (!binding) {
      const v = ent.params[param] ?? NaN;
      values.set(k, v);
      return v;
    }
    if (inProgress.has(k)) { binding.error = '检测到循环'; return NaN; }
    inProgress.add(k);
    let v;
    try {
      v = evalAst(binding.ast, scope);
      binding.error = null;
      // 可写别名（角度/长度/直径/面积…）：把值翻译回底层参数
      const alias = writeAliasOf(ent, param);
      if (alias) {
        // ① 弹簧态：拖不动的时候让图形先跟着指针（跳过写回），松手弹回；
        // ② 正在拖动这个实体时不写回 —— 否则拖动每一帧都被"以中点为锚重铺两端"，
        //    表现为"抓一端却两端一起长"。此时上游已由反向求解更新，松手后写回是恒等操作。
        // ③ ★ 任何拖动进行中都不写角度别名：手动转线时（例如拖圆上的点带动线段），
        //    每帧写回会把手动转出来的角度当场拽回变量值，表现就是"拖不动"。
        // 注意：用闭包里的 st，不要去读 scope.st（makeScope 返回的对象上没有 st，会让判断恒为假）
        const springing = (st.spring && st.spring.entId === entId && st.spring.key === param)
          || st.draggingEnt === entId
          || (param === 'angle' && st.dragActive);
        if (!springing) {
          const patch = alias.apply(ent.params, v, ent, env);
          if (patch && Object.keys(patch).length) {
            // 别名可以改"别的实体"（例如交点夹角 → 绕交点旋转 B 线）：用 __ent 指定
            const { __ent, ...rest } = patch;
            const target = __ent ? st.entities.get(__ent) : ent;
            if (target && Object.keys(rest).length) {
              Object.assign(target.params, rest);
              for (const kk of Object.keys(rest)) values.delete(keyOf(target.id, kk)); // 底层参数作废重算
            }
          }
        }
      }
    } catch (e) {
      binding.error = e.message;
      v = NaN;
    }
    inProgress.delete(k);
    values.set(k, v);
    return v;
  };

  const env = makeEnv(st, base);
  const scope = makeScope(st, env);

  for (const ent of st.entities.values()) {
    for (const param in (ent.bound || {})) base(ent.id, param);
  }
  return { values, base, scope, env };
}

// 环检测：新增 target ← sources 是否会成环（沿现有绑定图从每个源出发能否到达 target）
export function wouldCycle(st, target, sources) {
  const targetKey = keyOf(target.ent, target.param);

  const reach = (entId, param, seen) => {
    const k = keyOf(entId, param);
    if (k === targetKey) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    const ent = st.entities.get(entId);
    if (!ent) return false;
    // 派生量依赖该实体全部基础参数
    if (!isBaseParam(ent, param) && derivedOf(ent, param)) {
      for (const p of paramsOf(ent)) if (reach(entId, p.k, seen)) return true;
      return false;
    }
    const bId = ent.bound?.[param];
    if (!bId) return false;
    const b = st.bindings.get(bId);
    if (!b) return false;
    for (const s of b.sources) {
      if (s.kind === 'param' && reach(s.ent, s.param, seen)) return true;
    }
    return false;
  };

  for (const s of sources) {
    if (s.kind !== 'param') continue;
    if (keyOf(s.ent, s.param) === targetKey) return true; // 直接自引用
    if (reach(s.ent, s.param, new Set())) return true;
  }
  return false;
}

// 求值性能基准（P4 验收辅助）
export function benchChain(st) {
  const t0 = performance.now();
  evaluateAll(st);
  return performance.now() - t0;
}
