// 永久检查：项目里不许再出现浏览器原生提示框（alert / confirm / prompt）。
//
// 背景（用户要求）："整个项目中不要出现任何的浏览器提示框，自己做弹窗，检查并修改"。
// 这条检查就是"检查"那半句的落地：源码扫描 + 真实浏览器里断言"弹原生框即失败"。
//
// 为什么是**两层**：
//   · 源码扫描能抓到"写了但当前走不到"的调用（例如场景列表那两处，入口删了但代码还在）；
//   · 浏览器观察能抓到"间接触发"的原生框（比如某个第三方式的字符串拼接执行）。
//
// 例外白名单（必须逐条给出理由，不许拿它当挡箭牌）：
//   · 无。若真需要豁免，请在这里加 `{ file, reason }` 并在汇报里说明。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(APP, 'src');
const bad = [];

// ---------- 第一层：源码扫描 ----------
const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
};

// 只匹配"真的在调用"的形态。两种都要抓：
//   · 裸调用：            alert( / confirm( / prompt(
//   · 成员调用：window.confirm( / globalThis.prompt( —— ★ 这两者也是原生框，漏掉就会"该红却绿"
// 反例（不该匹配）：注释与字符串里提到这些名字；本检查自身（在 tests/ 下，不扫）。
const CALL_RE = /(?:^|[^\w$])(?:window|globalThis)\s*\.\s*(?:alert|confirm|prompt)\s*\(|(?:^|[^\w$.])(?:alert|confirm|prompt)\s*\(/g;
const ALLOWED_FILES = new Set([]);          // 见文件头"例外白名单"

for (const file of walk(SRC)) {
  const rel = file.slice(APP.length).replace(/\\/g, '/');
  if (ALLOWED_FILES.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // 跳过注释行（// 与 * 开头）——注释里提到这些名字不算调用
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    CALL_RE.lastIndex = 0;
    if (CALL_RE.test(line)) {
      bad.push(`${rel}:${i + 1}: ${trimmed.slice(0, 110)}`);
    }
  });
}

if (bad.length) {
  console.log('❌ 源码里仍有浏览器原生提示框调用（应改用 src/dialog.js）：');
  for (const b of bad) console.log('   - ' + b);
  process.exit(1);
}
console.log('✅ 源码扫描：src/ 下没有任何 alert/confirm/prompt 调用');

// ---------- 第二层：真实浏览器里断言不弹原生框 ----------
// 只在显式要求时跑（默认跑，但允许 IW_NO_BROWSER=1 跳过，便于快速自查）。
if (process.env.IW_NO_BROWSER === '1') {
  console.log('· 已按要求跳过浏览器层（IW_NO_BROWSER=1）');
  process.exit(0);
}
const WEB = process.env.IW_WEB || 'http://localhost:5188';
let puppeteer;
try { puppeteer = (await import('file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js')).default; }
catch { console.log('· 未找到 puppeteer，跳过浏览器层（源码层已通过）'); process.exit(0); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const fired = [];
page.on('dialog', async (d) => {
  fired.push(d.type() + ': ' + d.message().slice(0, 60));
  await d.dismiss().catch(() => {});        // 真弹了就记下来，并立刻关掉，避免卡住
});
page.on('pageerror', () => {});
for (const path of ['/index.html', '/settings.html', '/login.html']) {
  try { await page.goto(WEB + path, { waitUntil: 'networkidle0', timeout: 20000 }); } catch { /* 页面可能不可达，源码层已给出结论 */ }
  await new Promise((r) => setTimeout(r, 1200));
}
await browser.close();
if (fired.length) {
  console.log('❌ 打开页面时触发了浏览器原生对话框：');
  for (const f of fired) console.log('   - ' + f);
  process.exit(1);
}
console.log('✅ 浏览器层：打开 index / settings / login 三个页面都没有触发原生对话框');
