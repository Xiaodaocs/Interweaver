// 画布动作监控验收（用户要求："画布内部动作也应该进监控"，且要含变量/观察器/参数值）
//
// 为什么要有它：这条链路跨了 前端埋点 → telemetry 批量 → api.postEvents → 后端 /events → events.log，
//   少一环就静默失效。而且上一轮我用手写探针测时**踩了两个坑**（都记在这里，免得以后重犯）：
//     ① 必须先注册/有 token **再刷新页面** —— 开屏闸门在加载时读 token 决定模式，
//        注册发生在闸门之后时 appMode.user 仍是 null，flush() 会按设计拒绝（offline-or-guest）；
//     ② 点「云端存储」会弹 window.prompt —— puppeteer 默认没有对话框处理器会直接崩，
//        所以本检查显式注册 page.on('dialog')，并且只点**不弹框**的动作（工具切换 / 撤销）。
//
// ★★ 基建纪律（本轮修的一处**污染用户真实库**的缺陷，写在这里防重犯）：
//   老写法用 spawnIfFree('server-api.mjs', { PORT_API: '5189', API_DB: …tel.db })，
//   判据是"**5189 上已经有人应答健康检查 → 认为已就绪、不再自己起**"。
//   可是 5189 上跑的常常是**用户自己的后端**（连的是真实库 app/data/interweaver.db）——
//   于是下面那句 `api.register('tel_…')` 与之后的事件上报**全写进了用户的真实库**
//   （现场抓到过多个 tel_* 账号；data/verify-api/ 空着就是"它确实没起自己的库"的旁证）。
//   现在改成：本检查**自带独占端口 5292 + 独占临时库 + 独占临时日志**；
//   端口上有别人 → 直接拒绝运行（见 tests/_own-backend.mjs），绝不复用、绝不静默通过。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { startOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'http://localhost:5188';
const API_PORT = 5292;                       // ★ 本检查独占（不是共用的 5189！）
const API = `http://localhost:${API_PORT}`;
const TMP = join(APP, 'data', 'test-telemetry');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (c, m) => { if (!c) bad.push(m); else console.log('  ✓ ' + m); };

// 起测试后端：独占端口 + 独占临时库 + 独占事件流水（端口被占 / 起的不是我自己的 → 拒绝运行）
const { eventsFile: EVENTS, stop: stopApi } = await startOwnApi({ port: API_PORT, who: 'check-telemetry', dbFile: join(TMP, 'tel.db') });
console.log(`· 测试后端：${API}（临时库 ${TMP.replace(APP, '.')}；事件流水 ${EVENTS.replace(APP, '.')}）`);

// 前端静态服务（无状态，可以复用别人在跑的那个 5188；只关自己起的）
let web = null;
const stopWeb = () => { try { if (web) web.kill(); } catch { /* 已退出 */ } };
const webAlive = async () => { try { const r = await fetch(WEB + '/index.html'); return r.ok; } catch { return false; } };
if (await webAlive()) {
  console.log('  · 复用已在运行的 ' + WEB + '（不动它）');
} else {
  web = spawn(process.execPath, ['server.mjs'], { cwd: APP, env: { ...process.env, PORT: '5188' }, stdio: ['ignore', 'pipe', 'pipe'] });
  web.stdout.on('data', () => {}); web.stderr.on('data', () => {});
  // ★ 管道 unref：万一忘了 stopWeb()，子进程也不会把本检查永远吊在事件循环里
  //   （实测过一次：check-telemetry 打完 ✅ 却不退出，把整条 verify 链卡死）
  for (const s of [web.stdout, web.stderr]) { try { s.unref(); } catch { /* 忽略 */ } }
  try { web.unref(); } catch { /* 忽略 */ }
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { up = await webAlive(); if (!up) await wait(200); }
  if (!up) { console.log('✗ 前端 ' + WEB + ' 起不来 —— 本检查需要静态服务'); process.exit(1); }
  console.log('  · 自起前端 ' + WEB + '（跑完关掉）');
}
process.on('exit', stopWeb);

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
console.log('  · 独占临时流水新增 ' + fresh.length + ' 行');
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
stopApi();                                   // ★ 关掉本检查自己的测试后端（别留进程占着 5292）
stopWeb();                                   // ★ 只关自己起的前端（复用别人的就不动）
await wait(250);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }   // 临时库随跑随清（与 check-api 等一致）
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log(`✅ 通过：画布动作（含变量/观察器参数）确实进入监控流水（本检查的独占临时流水 ${EVENTS.replace(APP, '.')}）`);
