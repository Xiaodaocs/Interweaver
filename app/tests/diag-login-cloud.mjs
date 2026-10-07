// 一次性实测：真页面 login.html 的注册/登录 + 文件菜单的云端存储/从云端打开。
// 关键点（都是之前踩过的坑，写在这里防重犯）：
//   · 开屏闸门在页面加载时读 token 决定模式 → 注册后要**刷新**才进 online；
//   · 「云端存储」会 window.prompt → 必须注册 page.on('dialog')，否则 puppeteer 直接崩；
//   · 两个服务（5188 前端 / 5189 后端）缺哪个就先起哪个，跑完只关自己起的。
import { spawn } from 'node:child_process';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = 'D:/zhuo_mian/Interweaver/app';
const WEB = 'http://localhost:5188', API = 'http://localhost:5189';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const ensure = async (file, env, url) => {
  try { const r = await fetch(url); if (r.ok) { console.log('  · reuse ' + file); return; } } catch { /* not up */ }
  const p = spawn(process.execPath, [file], { cwd: APP, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  procs.push(p);
  for (let i = 0; i < 40; i++) { try { const r = await fetch(url); if (r.ok) break; } catch { /* wait */ } await wait(200); }
  console.log('  · started ' + file);
};
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } });
await ensure('server.mjs', { PORT: '5188' }, WEB + '/login.html');
await ensure('server-api.mjs', { PORT_API: '5189', API_DB: APP + '/data/interweaver.db' }, API + '/api/v1/health');

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
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
const reg = await page.evaluate(() => ({ url: location.pathname, status: document.getElementById('status').textContent }));
console.log('  ① register on real page -> ' + JSON.stringify(reg));

// ② 回到登录页，用同一账号登录（证明账号真的在库里）
await page.goto(WEB + '/login.html', { waitUntil: 'networkidle0' });
await wait(900);
const pre = await page.evaluate(() => document.getElementById('status').textContent);
console.log('  ② already-signed-in banner: ' + JSON.stringify(pre.slice(0, 60)));

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
for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
