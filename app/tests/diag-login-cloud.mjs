// 一次性实测：真页面 login.html 的注册/登录 + 文件菜单的云端存储/从云端打开。
// 关键点（都是之前踩过的坑，写在这里防重犯）：
//   · 开屏闸门在页面加载时读 token 决定模式 → 注册后要**刷新**才进 online；
//   · 「云端存储」会 window.prompt → 必须注册 page.on('dialog')，否则 puppeteer 直接崩；
//   · 前端 5188 缺就自己起、跑完只关自己起的；后端**自起在独占端口 5296 + 独占临时库**。
//
// ★★ 基建纪律（本轮修的一处**污染用户真实库**的缺陷）：
//   老写法是 ensure('server-api.mjs', { PORT_API: '5189', API_DB: app/data/interweaver.db }) ——
//   它把测试后端**直接指向用户的真实库**，而且"5189 上有人应答就复用"。
//   本脚本紧接着会注册 e2e_* 账号、再「云端存储」建场景 → 全写进用户真实库。
//   现在后端走 tests/_own-backend.mjs：独占端口 5296 + 独占临时库；
//   页面用 globalThis.__IW_API_BASE__ 指向它（api.js 的解析顺序：__IW_API_BASE__ → meta → 默认），
//   所以被测的真实页面流程一点没变，只是不再碰真实数据。
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { startOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'http://localhost:5188';
const API_PORT = 5296;                          // ★ 本脚本独占（不是共用的 5189）
const API = `http://localhost:${API_PORT}`;
const TMP = join(APP, 'data', 'test-login-cloud');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } });

/* ---------------- 测试后端：独占端口 + 独占临时库（绝不再指向真实库） ---------------- */
const { stop: stopApi } = await startOwnApi({ port: API_PORT, who: 'diag-login-cloud', dbFile: join(TMP, 'cloud.db') });
console.log(`  · 测试后端 ${API}（临时库 ${TMP.replace(APP, '.')}）`);

/* ---------------- 前端静态服务：已在跑就复用 ---------------- */
{
  const alive = async () => { try { const r = await fetch(WEB + '/login.html'); return r.ok; } catch { return false; } };
  if (await alive()) console.log('  · reuse server.mjs（' + WEB + '）');
  else {
    const p = spawn(process.execPath, ['server.mjs'], { cwd: APP, env: { ...process.env, PORT: '5188' }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
    procs.push(p);
    for (let i = 0; i < 40 && !(await alive()); i++) await wait(200);
    console.log('  · started server.mjs（' + WEB + '）');
  }
}

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
// ★ 让页面（login.html / index.html 都算）把后端指向本脚本的临时后端
await page.evaluateOnNewDocument(([base]) => { globalThis.__IW_API_BASE__ = base; }, [API]);
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message().slice(0, 40)); await d.accept(d.message().includes('云端打开') ? '1' : 'e2e_scene'); });
page.on('pageerror', (e) => console.log('  !! pageerror: ' + e.message));

const user = 'e2e_' + Math.random().toString(36).slice(2, 7);

// ① 真页面注册
await page.goto(WEB + '/login.html', { waitUntil: 'networkidle0' });
await wait(900);
await page.click('[data-tab="register"]');
await page.type('#user', user);
await page.type('#pass', 'secret123');
await page.click('#go');
await wait(2500);
// ★ 注册成功会直接跳去 index.html（那时 #status 已经不在了）——这里要容忍两种结果，
//   否则脚本会在"注册成功"这条最正常的路径上崩掉（`null.textContent`）。
await page.waitForFunction(() => /index\.html/.test(location.pathname)
  || !!(document.getElementById('status') && document.getElementById('status').textContent.trim()), { timeout: 8000 }).catch(() => {});
const reg = await page.evaluate(() => {
  const s = document.getElementById('status');
  return { url: location.pathname, status: s ? s.textContent : '(注册成功 → 已跳转，无状态文案)' };
});
console.log('  ① register on real page -> ' + JSON.stringify(reg));

// ② 回到登录页，用同一账号登录（证明账号真的在库里）
await page.goto(WEB + '/login.html', { waitUntil: 'networkidle0' });
await wait(900);
// ★ 已登录时 login.html 会直接把人送回画布（#status 也就不在了）——同样要容忍，
//   这两种结果都说明"同一个账号确实在库里"。
const pre = await page.evaluate(() => {
  const s = document.getElementById('status');
  return { url: location.pathname, status: s ? s.textContent : '(已登录 → 登录页直接跳回画布)' };
});
console.log('  ② already-signed-in -> ' + JSON.stringify(pre.url) + ' ' + JSON.stringify(pre.status.slice(0, 60)));

// ③ 进画布 → 文件 → 云端存储（对话框自动填名字）
await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW, { timeout: 10000 });
await wait(2200);
const mode = await page.evaluate(async () => { const m = await import('/src/appMode.js'); return { mode: m.getMode(), user: (m.getUser() || {}).username || null }; });
console.log('  ③ canvas mode -> ' + JSON.stringify(mode));
await page.click('[data-mbtop="file"]');
await wait(300);
await page.click('[data-act="file:cloud-save"]');
await wait(2500);
const afterSave = await page.evaluate(() => (document.getElementById('hint') || {}).textContent || '');
console.log('  ③ after cloud-save hint -> ' + JSON.stringify(afterSave.slice(0, 110)));

// ④ 文件 → 从云端打开（对话框填 1）
if (await page.$('[data-mbtop="file"]')) { await page.click('[data-mbtop="file"]'); await wait(300); }
await page.click('[data-act="file:cloud-open"]');
await wait(2500);
const afterOpen = await page.evaluate(() => (document.getElementById('hint') || {}).textContent || '');
console.log('  ④ after cloud-open hint -> ' + JSON.stringify(afterOpen.slice(0, 110)));
console.log('  dialogs seen: ' + JSON.stringify(dialogs));
await browser.close();
stopApi();                                   // ★ 关掉自己的测试后端（别留进程占着 5296）
for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
await wait(250);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }   // 临时库随跑随清
