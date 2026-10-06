// 开屏闸门验收（用户要求：等网络与用户数据就绪；也可离线进入；离线不开放成就页）
//   设计是"先盖、后揭"：runBootGate() 同步插入加载层（不 await），探针一有结果就揭。
//   ① 后端在：加载层先出现 → 自动揭掉 → online（无离线提示条、成就页入口开放）
//   ② 后端不在：**明确报错**（地址 / 原因 / code / 怎么办）→ offline + 底部提示条（含重试联网）
//   ③ 离线时成就页入口**被挡住并说明原因**（不是点了没反应）
//   ④ 加载层里有「离线进入（只用画布）」按钮
//   ⑤ **闸门不挡启动**：即便探针还没回来，画布也已经完成接线（这里用"能否立即拖动绘制"间接验证）
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = 5286;
const API = `http://localhost:${API_PORT}`;
const DEAD = 'http://localhost:5386';
const TMP = join(APP, 'data', 'test-gate');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
let api = null;
const startApi = () => {
  api = spawn(process.execPath, ['server-api.mjs'], {
    cwd: APP, env: { ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'gate.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', () => {}); api.stderr.on('data', () => {});
};
const stopApi = () => { try { api && api.kill(); } catch { /* 忽略 */ } };
process.on('exit', stopApi);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + e.message); stopApi(); process.exit(1); });

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });

// ---------- ② ③ ④ ⑤：后端不在 ----------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  await page.evaluateOnNewDocument(([b]) => { globalThis.__IW_API_BASE__ = b; }, [DEAD]);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
  const during = await page.evaluate(() => {
    const b = document.getElementById('iwBoot');
    return {
      exists: !!b,
      offlineBtn: !!b && [...b.querySelectorAll('button')].some((x) => x.textContent.includes('离线进入')),
      iwReady: !!window.__IW,
    };
  });
  ok(during.exists, '④ 打开即出现加载层（未 await，仍同步盖上）');
  ok(during.offlineBtn, '④ 加载层里有「离线进入（只用画布）」按钮');
  ok(during.iwReady, '⑤ 闸门没有挡住启动：window.__IW 已就绪（cover, then reveal）');
  await wait(3500);
  const after = await page.evaluate(() => {
    const b = document.getElementById('iwBoot');
    const tip = document.getElementById('iwOfflineTip');
    return {
      bootGone: !b || b.classList.contains('hide'),
      tipOn: !!tip && tip.classList.contains('on'),
      tipText: tip ? tip.textContent : '',
    };
  });
  ok(after.bootGone, '② 探针失败后加载层被揭掉（不再是模态，不会吃掉画布输入）');
  ok(after.tipOn, '② 转离线后出现底部提示条');
  ok(after.tipText.includes('5386'), '② 提示条里写明连不上的地址（详细报错没丢）');
  ok(after.tipText.includes('BACKEND_UNREACHABLE'), '② 提示条里带 code');
  ok(after.tipText.includes('start:api'), '② 提示条里给出怎么办（怎么起后端）');
  ok(after.tipText.includes('重试联网'), '② 提示条提供「重试联网」');

  const blocked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a')].find((b) => /成就|星图/.test(b.textContent || ''));
    if (btn) btn.click();
    const h = document.getElementById('hint');
    return { hint: h ? h.textContent : '' };
  });
  await wait(500);
  const nav = await page.evaluate(() => location.href);
  ok(!nav.includes('starmap.html'), '③ 离线时没有跳到成就页');
  ok((blocked.hint || '').includes('离线') || (blocked.hint || '').includes('不开放'),
    `③ 并说明了原因（"${(blocked.hint || '').slice(0, 44)}"）`);
  const mode = await page.evaluate(async () => {
    const m = await import('/src/appMode.js');
    return { mode: m.getMode(), ach: m.isAllowed('achievements') };
  });
  ok(mode.mode === 'offline' && mode.ach.allowed === false, `③ 模式唯一来源 = offline，成就页不开放（实测 ${mode.mode}）`);
  await page.close();
}

// ---------- ① 后端在 ----------
{
  startApi();
  let up = false;
  for (let i = 0; i < 40; i++) { try { const r = await fetch(API + '/api/v1/health'); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ } await wait(200); }
  ok(up, `① 测试后端已起（${API}）`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  await page.evaluateOnNewDocument(([b]) => { globalThis.__IW_API_BASE__ = b; }, [API]);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const b = document.getElementById('iwBoot');
    return !b || b.classList.contains('hide');
  }, { timeout: 12000 }).catch(() => {});
  const after = await page.evaluate(async () => {
    const m = await import('/src/appMode.js');
    const b = document.getElementById('iwBoot');
    const tip = document.getElementById('iwOfflineTip');
    return {
      mode: m.getMode(), bootGone: !b || b.classList.contains('hide'),
      tipOn: !!tip && tip.classList.contains('on'), ach: m.isAllowed('achievements'),
    };
  });
  ok(after.bootGone, '① 后端可用时加载层自动揭掉');
  ok(after.mode === 'online', `① 模式 = online（实测 ${after.mode}）`);
  ok(after.tipOn === false, '① 在线时没有离线提示条');
  ok(after.ach && after.ach.allowed === true, '① 在线时成就页入口开放');
  await page.close();
}

await browser.close();
stopApi();
await wait(250);
await rm(TMP, { recursive: true, force: true }).catch(() => {});
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：先盖后揭（不挡启动）；连不上则详细报错并可离线进入；离线不开放成就页');
