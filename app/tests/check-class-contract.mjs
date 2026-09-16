// 双向契约核对（修正版）：JS/HTML 产出的 class ↔ CSS 定义的 class
//
// 相对上一版的两处修正（否则结论不可信）：
//   ① 产出侧要包含 index.html（成就清单等静态标记在那里，上一版误报为"死规则"）
//   ② 过滤噪声：属性选择器的值（[href$=".css"] 里的 css/png/js…）与正则抓到的 JS 片段（===/a/cls）
import fs from 'fs';

const ROOT = 'D:/zhuo_mian/Interweaver/app/';
const listJs = (dir) => fs.readdirSync(ROOT + dir, { withFileTypes: true }).flatMap((d) => {
  if (d.isDirectory()) return listJs(dir + '/' + d.name);
  return d.name.endsWith('.js') ? [dir + '/' + d.name] : [];
});
const sources = listJs('src').concat(['index.html']);

const NOISE = new Set(['===', 'a', 'cls', 'css', 'png', 'js', 'html', 'json', 'svg', 'jpg', 'jpeg', 'webp', 'gif']);

const emitted = new Map();
for (const rel of sources) {
  const src = fs.readFileSync(ROOT + rel, 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/class="([^"$`]+)"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
  for (const m of src.matchAll(/className\s*=\s*[`'"]([^`'"]+)[`'"]/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => found.add(c));
  for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) found.add(q[1]);
  }
  for (const m of src.matchAll(/className\s*=\s*`([^`]+)`/g)) {
    for (const q of m[1].matchAll(/([a-zA-Z][\w-]*)/g)) if (!q[1].includes('$')) found.add(q[1]);
  }
  for (const c of found) if (c && !c.includes('$') && !NOISE.has(c) && c.length > 1) emitted.set(c, (emitted.get(c) || 0) + 1);
}

const css = fs.readFileSync(ROOT + 'styles.css', 'utf8');
// 去掉属性选择器里的值，避免把 [href$=".css"] 当成类
const cssNoAttr = css.replace(/\[[^\]]*\]/g, '');
const defined = new Map();
for (const m of cssNoAttr.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
  const c = m[1];
  if (NOISE.has(c) || c.length <= 1) continue;
  defined.set(c, (defined.get(c) || 0) + 1);
}

const missing = [...emitted].filter(([c]) => !defined.has(c)).map(([c, n]) => `${c}（产出 ${n} 处，CSS 无规则）`);
const dead = [...defined].filter(([c]) => !emitted.has(c)).map(([c, n]) => `.${c}（CSS ${n} 处，产出侧未出现）`);

console.log('产出侧 class 数 =', emitted.size, '（来源：src/**/*.js + index.html）');
console.log('CSS 定义 class 数 =', defined.size, '（已剔除属性选择器）');
console.log('\nA 失灵类（产出、CSS 无规则）：', missing.length);
for (const x of missing) console.log('   ✗', x);
console.log('\nB 死规则（CSS 有、产出侧未出现）：', dead.length);
for (const x of dead) console.log('   ✗', x);
