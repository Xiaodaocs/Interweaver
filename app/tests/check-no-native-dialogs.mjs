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
// ★ 本轮收紧（用户要求）：这一层原来 `page.goto()` 失败被 catch 吞掉 → `fired` 为空 → **判绿**，
//   也就是"页面根本没打开"和"打开后确实没弹框"完全分不清 —— 属于假通过。
//   现在三个页面必须**真的加载成功**：HTTP 200 **且**关键元素出现；任何一页失败 → 红，
//   并把"哪一页 / 状态码 / 错误 / 当时在等哪个元素"全部打印出来。
//   ⚠️ login.html 在"已登录"时会自动跳去 index.html（见 src/loginMain.js）→ 断言必须同时接受
//      "跳转后落在 index.html"与"停在 login.html"两种结果，绝不能写成"必须停在 login"。
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

// 每页的"关键元素"判据。函数体必须自包含：puppeteer 会把它序列化到页面里执行。
const PAGES = [
  { path: '/index.html', what: '#cv 或 window.__IW', ready: () => !!(document.getElementById('cv') || window.__IW) },
  { path: '/settings.html', what: '#setWrap（设置根节点）', ready: () => !!document.getElementById('setWrap') },
  {
    path: '/login.html', what: '#user 或 #form（若已登录并自动跳转，则按 index.html 的 #cv / __IW 判）',
    ready: () => (/\/index\.html$/i.test(location.pathname)
      ? !!(document.getElementById('cv') || window.__IW)
      : !!(document.getElementById('user') || document.getElementById('form'))),
  },
];

const notLoaded = [];
for (const p of PAGES) {
  let status = null, navError = null;
  try {
    const resp = await page.goto(WEB + p.path, { waitUntil: 'networkidle0', timeout: 20000 });
    status = resp ? resp.status() : null;
  } catch (e) { navError = (e && e.message) || String(e); }
  await new Promise((r) => setTimeout(r, 1200));      // 停留：给"间接触发"的原生框留出时间（原有语义）
  let ready = false;
  try { await page.waitForFunction(p.ready, { timeout: 8000 }); ready = true; } catch { /* 下面统一报 */ }
  const url = await page.evaluate(() => location.pathname).catch(() => '(取不到)');
  // 通过条件：关键元素在，且那次导航拿到了 200。
  // 唯一例外：login.html 因"已登录"自动 replace 到 index 时，原来那次导航会被取代（可能抛 ERR_ABORTED），
  // 这不是加载失败 —— 只要最终落在 index.html 且它的关键元素在，就算通过。
  const superseded = !!navError && p.path === '/login.html' && /\/index\.html$/i.test(url);
  const ok = ready && (status === 200 || superseded);
  if (ok) {
    console.log(`  ✓ ${p.path} 加载成功（HTTP ${status === null ? '被自动跳转取代，最终 ' + url : status}，关键元素「${p.what}」在）`);
    continue;
  }
  notLoaded.push([
    `页面 ${p.path}`,
    `HTTP ${status === null ? '(没有响应)' : status}`,
    navError ? `导航异常：${navError}` : null,
    `最终 URL：${url}`,
    ready ? null : `关键元素没出现（要求：${p.what}）`,
  ].filter(Boolean).join(' · '));
}
await browser.close();

let failed = false;
if (notLoaded.length) {
  console.log('❌ 浏览器层：有页面没能真正加载出来 —— 这一层等于没验证（以前正是这样假通过的）：');
  for (const x of notLoaded) console.log('   - ' + x);
  failed = true;
}
if (fired.length) {
  console.log('❌ 打开页面时触发了浏览器原生对话框：');
  for (const f of fired) console.log('   - ' + f);
  failed = true;
}
if (failed) process.exit(1);
console.log('✅ 浏览器层：index / settings / login 三个页面都真的加载成功（HTTP 200 + 关键元素在），且全程没有触发原生对话框');
