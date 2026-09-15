// 极简测试框架
export const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

export function ok(cond, msg = '') {
  if (!cond) throw new Error('断言失败 ' + msg);
}
export function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)} ${msg}`);
}
export function approx(a, b, eps = 1e-9, msg = '') {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`期望 ≈${b}，得到 ${a} ${msg}`);
}
export function throws(fn, partOfMsg = '') {
  try { fn(); } catch (e) {
    if (partOfMsg && !String(e.message).includes(partOfMsg)) {
      throw new Error(`抛出的错误不含 "${partOfMsg}"：${e.message}`);
    }
    return;
  }
  throw new Error('期望抛出异常，但没有抛');
}

export async function run() {
  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
  }
  console.log(`\n${pass} 通过, ${fail} 失败, 共 ${tests.length}`);
  process.exit(fail ? 1 : 0);
}
