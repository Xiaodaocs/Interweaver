// 画布动作监控验收（用户要求："画布内部动作也应该进监控"，且要含变量/观察器/参数值）
//
// 为什么要有它：这条链路跨了 前端埋点 → telemetry 批量 → api.postEvents → 后端 /events → events.log，
//   少一环就静默失效。而且上一轮我用手写探针测时**踩了两个坑**（都记在这里，免得以后重犯）：
//     ① 必须先注册/有 token **再刷新页面** —— 开屏闸门在加载时读 token 决定模式，
//        注册发生在闸门之后时 appMode.user 仍是 null，flush() 会按设计拒绝（offline-or-guest）；
//     ② 点「云端存储」会弹 window.prompt —— puppeteer 默认没有对话框处理器会直接崩，
//        所以本检查显式注册 page.on('dialog')，并且只点**不弹框**的动作（工具切换 / 撤销）。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API = 'http://localhost:5189';
const WEB = 'http://localhost:5188';
const EVENTS = join(APP, 'data', 'events.log');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (c, m) => { if (!c) bad.push(m); else console.log('  ✓ ' + m); };

// 起两个服务（自给自足；已起就复用）
const procs = [];
const spawnIfFree = async (file, env, probe) => {
  try { const r = await fetch(probe); if (r.ok) return null; } catch { /* 没起 */ }
  const p = spawn(process.execPath, [file], { cwd: APP, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  procs.push(p);
  return p;
};
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch { /* 已退出 */ } } });

await spawnIfFree('server.mjs', { PORT: '5188' }, WEB + '/index.html');
await spawnIfFree('server-api.mjs', { PORT_API: '5189', API_DB: join(APP, 'data', 'verify-api', 'tel.db') }, API + '/api/v1/health');
for (let i = 0; i < 40; i++) {
  try { const a = await fetch(WEB + '/index.html'); const b = await fetch(API + '/api/v1/health'); if (a.ok && b.ok) break; } catch { /* 未就绪 */ }
  await wait(200);
}

const lines = () => { try { return readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const before = lines().length;

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
// ★ 坑②：注册对话框处理器（本检查只点不弹框的动作，但防以后加的动作弹框把检查搞崩）
page.on('dialog', (d) => { d.accept('telemetry-check').catch(() => {}); });
await page.evaluateOnNewDocument(([base]) => { globalThis.__IW_API_BASE__ = base; }, [API]);

// ① 先用 api.js 注册一个账号（token 落在 localStorage）
await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
await wait(1200);
const user = await page.evaluate(async () => {
  const api = await import('/src/api.js');
  const r = await api.register('tel_' + Math.random().toString(36).slice(2, 8), 'secret123');
  return r.user.username;
});
ok(!!user, `① 注册测试账号 ${user}（token 已存）`);

// ★ 坑①：刷新，让开屏闸门带着 token 进入 online（否则 flush 按设计拒绝）
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW, { timeout: 10000 });
await wait(2200);
const mode = await page.evaluate(async () => {
  const m = await import('/src/appMode.js');
  return { mode: m.getMode(), user: (m.getUser() || {}).username || null };
});
ok(mode.mode === 'online' && mode.user === user, `① 刷新后闸门进入 online（mode=${mode.mode}, user=${mode.user}）`);

// ② 真鼠标点：切换工具（tool:pick）+ 撤销（menu:act）—— 两者都不弹框
await page.click('#toolbar button[data-tool="circle"]');
await wait(400);
await page.click('[data-mbtop="edit"]');
await wait(250);
await page.click('[data-act="edit:undo"]');
await wait(400);
// ③ 直接补两条带参数的（变量 / 观察器）：验证"参数完整送达"
await page.evaluate(async () => {
  const tel = await import('/src/telemetry.js');
  tel.track('var:set', { name: 'k', value: 3, min: 0, max: 5 });
  tel.track('observer:add', { expr: 'length(L1)' });
  await tel.flush();
});
await wait(1200);

const after = lines();
const fresh = after.slice(before);
console.log('  · events.log 新增 ' + fresh.length + ' 行');
for (const l of fresh.slice(-5)) console.log('    ' + l.slice(0, 116));
const kinds = fresh.map((l) => l.split(' | ')[3] || '');
ok(kinds.includes('tool:pick'), '② 真实点击"工具"→ 流水里出现 tool:pick（埋点生效）');
ok(kinds.includes('menu:act'), '② 真实点击菜单 → 流水里出现 menu:act');
ok(fresh.some((l) => l.includes('var:set') && l.includes('"value":3') && l.includes('"max":5')),
  '③ 变量参数完整送达（名/值/范围都在行里）');
ok(fresh.some((l) => l.includes('observer:add') && l.includes('length(L1)')),
  '③ 观察器参数完整送达（表达式在行里）');
ok(fresh.every((l) => l.includes('user=') && l.includes('session=')), '③ 每行都带 user 与 session（可按会话串起来）');

await browser.close();
for (const p of procs) { try { p.kill(); } catch { /* 忽略 */ } }
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：画布动作（含变量/观察器参数）确实进入监控流水');
