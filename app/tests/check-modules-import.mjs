// 模块守卫：**每个前端模块都必须能在浏览器里被 import 成功**。
// 起因：本轮新写的两个模块在浏览器里报 `Unexpected token 'export'`（Node 的 --check 却通过），
//       内容重写后即恢复 —— 属于"文件字节层面坏了但语法检查看不出来"的一类问题。
//       这类问题必须在 verify 里挡住，所以逐个模块真在浏览器里 import 一遍。
//
// 说明：入口模块（会自行启动界面/操作 DOM）不 import，只检查它们**能被 fetch 到且不是坏字节**；
//       其它模块逐个动态 import，失败即报错（连同错误信息一起打印，便于定位）。
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = new Set(['main.js', 'starmapMain.js', 'settingsMain.js', 'themeBoot.js']);

const files = (await readdir(join(APP, 'src'))).filter((f) => f.endsWith('.js')).sort();
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:5188/', { waitUntil: 'domcontentloaded' });

const bad = [];
// 入口模块：只验证能取到、且不是 HTML 错误页
for (const f of files.filter((x) => ENTRY.has(x))) {
  const r = await page.evaluate(async (u) => {
    const res = await fetch(u);
    const t = await res.text();
    return { status: res.status, ct: res.headers.get('content-type'), len: t.length, html: /^\s*</.test(t) };
  }, '/src/' + f);
  if (r.status !== 200 || r.html || r.len < 10) bad.push(`入口模块 ${f} 取不到正常内容（status=${r.status}, ct=${r.ct}, len=${r.len}）`);
  else console.log(`  ✓ 入口模块 ${f} 可取（${r.len} 字节）`);
}
// 其它模块：真 import
const libs = files.filter((x) => !ENTRY.has(x));
const results = await page.evaluate(async (list) => {
  const out = [];
  for (const f of list) {
    try { await import('/src/' + f + '?guard=' + Date.now()); out.push({ f, ok: true }); }
    catch (e) { out.push({ f, ok: false, err: String((e && e.message) || e) }); }
  }
  return out;
}, libs);
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.f} 浏览器 import 成功`);
  else bad.push(`${r.f} 浏览器 import 失败：${r.err}`);
}
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log(`✅ 通过：${files.length} 个前端模块全部能在浏览器里加载（入口 ${ENTRY.size} 个 / 库模块 ${libs.length} 个）`);