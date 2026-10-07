// 部署形态的端到端验收：**两个源**（前端 5188 类 ↔ 后端 5189 类）+ 真登录 + 数据往返 + **重启后端**
//   与前面几条检查的区别：
//     · check-api        —— 只打后端 HTTP，不开浏览器；
//     · check-frontend-api —— 浏览器 + 前端模块，但不开前端静态服务（用现成的 5188）；
//     · 本条             —— **两个服务都由本检查自己拉起**（前端端口也用测试端口），
//                            完整模拟部署形态：跨源、真登录、写数据、**重启后端**、前端仍读得到。
//   这正是"分开前后端"要证明的事：数据在独立后端里活着，前端只是客户端。
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { claimPort, assertOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const WEB_PORT = 5288;          // 前端静态服务（测试端口）
const API_PORT = 5289;          // 后端 API（测试端口）
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const TMP = join(APP, 'data', 'test-deploy');
const DBF = join(TMP, 'deploy.db');
const API_LOG = join(TMP, 'api.log');            // 临时日志 + "是我起的"身份标识
const API_EVENTS_LOG = join(TMP, 'events.log');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

// ★ 端口必须由本检查**独占**：这两个端口上有别人在跑（最坏情况是连着用户真实库的后端）
//   → 拒绝运行，绝不复用。复用会让下面的跨源注册 / 写文档 / 建场景落到别人的库里。
await claimPort(WEB_PORT, 'check-deploy-e2e（前端静态）');
await claimPort(API_PORT, 'check-deploy-e2e（后端 API）');

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

let web = null; let api = null;
const startWeb = () => {
  web = spawn(process.execPath, ['server.mjs'], {
    cwd: APP, env: { ...process.env, PORT: String(WEB_PORT), API_ORIGINS: WEB }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  web.stdout.on('data', () => {}); web.stderr.on('data', () => {});
};
const startApi = () => {
  api = spawn(process.execPath, ['server-api.mjs'], {
    cwd: APP,
    // 允许来源 = 前端测试端口（部署时改成真实前端域名）
    env: { ...process.env, PORT_API: String(API_PORT), API_DB: DBF, API_ORIGINS: WEB, API_LOG, API_EVENTS_LOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', () => {}); api.stderr.on('data', () => {});
};
const stopWeb = () => { try { web && web.kill(); } catch { /* 忽略 */ } };
const stopApi = () => { try { api && api.kill(); } catch { /* 忽略 */ } };
const stopAll = () => { stopWeb(); stopApi(); };
process.on('exit', stopAll);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + e.message); stopAll(); process.exit(1); });

async function waitFor(url) {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(url); if (r.ok) return true; } catch { /* 未就绪 */ } await wait(200); }
  return false;
}

startWeb(); startApi();
ok(await waitFor(WEB + '/index.html'), `前端静态服务已起（${WEB}）`);
ok(await waitFor(API + '/api/v1/health'), `后端 API 已起（${API}，允许来源 ${WEB}）`);
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); stopAll(); process.exit(1); }
await assertOwnApi(API_PORT, 'check-deploy-e2e', API_LOG);   // ★ 复核：应答的必须是我起的那个（否则可能连着真实库）
ok(WEB_PORT !== API_PORT, '两个服务**不同源**（端口不同）—— 这就是"不再前后端同源"');

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// 让页面在**自己的脚本之前**把 API 基址指向测试后端
await page.evaluateOnNewDocument(([base]) => { globalThis.__IW_API_BASE__ = base; }, [API]);

// ---------- ① 前端页面能起来，并确认它是**纯静态**（没有 API 同源） ----------
{
  await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
  const info = await page.evaluate(() => ({ hasIW: !!window.__IW, meta: document.querySelector('meta[name="iw-api"]')?.getAttribute('content') }));
  ok(info.hasIW, '① 前端页面正常起来（window.__IW 就绪）');
  ok(info.meta && info.meta.includes('5189'), `① 页面里声明了后端地址（meta iw-api = ${info.meta}）`);
  // 前端静态服务**不应该**提供 API：同源打 /api/v1/health 必须是 404
  const sameOriginApi = await page.evaluate(async () => {
    const r = await fetch('/api/v1/health').catch(() => null);
    return r ? r.status : 'fetch-failed';
  });
  ok(sameOriginApi === 404 || sameOriginApi === 'fetch-failed',
    `① 前端静态服务**不提供** API（同源 /api/v1/health → ${sameOriginApi}）—— 前后端职责已分开`);
}

// ---------- ② 跨源注册 + 写数据（从浏览器里走 src/api.js） ----------
{
  const r = await page.evaluate(async () => {
    const api = await import('/src/api.js');
    const reg = await api.register('deployuser', 'secret123');
    await api.putDoc('progress', { unlocked: { 'geo.circle.first': 1 }, at: 'round5' });
    await api.putDoc('settings', { grid: false, from: 'e2e' });
    const sc = await api.createScene({ name: '部署场景', data: { entities: [{ type: 'circle' }] } });
    return { user: reg.user.username, isAdmin: reg.user.isAdmin, sceneId: sc.id };
  });
  ok(r.user === 'deployuser' && r.isAdmin === true, '② 跨源注册成功（首个用户=管理员）');
  ok(!!r.sceneId, `② 跨源建场景成功（id=${r.sceneId}）`);
  globalThis.__scene = r.sceneId;
}

// ---------- ③ 重启后端：数据必须还在（真数据库） ----------
{
  stopApi();
  await wait(400);
  const down = await fetch(API + '/api/v1/health').then(() => true).catch(() => false);
  ok(down === false, '③ 后端确实被停掉了（探活失败）');
  const errInBrowser = await page.evaluate(async () => {
    const api = await import('/src/api.js?restart=1');
    try { await api.getDoc('settings'); return null; }
    catch (e) { return { code: e.code, text: e.toDetailText(api.apiBase()) }; }
  });
  ok(errInBrowser && errInBrowser.code === 'BACKEND_UNREACHABLE' && errInBrowser.text.includes('npm run start:api'),
    '③ 后端停着的时候：前端**明确报错**（不是悄悄用本地缓存）');

  startApi();
  ok(await waitFor(API + '/api/v1/health'), '③ 后端重启完成');
  await assertOwnApi(API_PORT, 'check-deploy-e2e', API_LOG);   // ★ 重启后同样复核身份
  const after = await page.evaluate(async ([sid]) => {
    const api = await import('/src/api.js?after=1');   // 重新求值拿新模块实例
    const p = await api.getDoc('progress');
    const s = await api.getDoc('settings');
    const sc = await api.getScene(sid);
    const list = await api.listScenes();
    return { progress: p.doc, settings: s.doc, scene: sc.doc, names: list.scenes.map((x) => x.name) };
  }, [globalThis.__scene]);
  ok(after.progress && after.progress.at === 'round5', '③ 重启后**进度文档还在**（读回 at=round5）');
  ok(after.settings && after.settings.from === 'e2e', '③ 重启后**设置文档还在**');
  ok(after.scene && after.scene.name === '部署场景' && after.names.includes('部署场景'), '③ 重启后**场景还在**（列表里能看到）');
}

// ---------- ④ 跨源隔离：换个来源必须被拒 ----------
// ★ 必须在 **Node 侧**验：浏览器禁止脚本手动设置 Origin 头（forbidden header），
//   在页面里 fetch 只会带上页面自身的来源（= 白名单里的那个），所以那样测不出隔离。
{
  const r = await fetch(API + '/api/v1/health', { headers: { origin: 'http://evil.example' } });
  const body = await r.json().catch(() => null);
  ok(r.status === 403 && body && body.code === 'ORIGIN_NOT_ALLOWED',
    `④ 非白名单来源被拒（实测 ${r.status} + code=${body && body.code}）`);
  // 白名单来源必须放行，并且回带 allow-origin（否则浏览器会拦下响应）
  const good = await fetch(API + '/api/v1/health', { headers: { origin: WEB } });
  ok(good.status === 200 && good.headers.get('access-control-allow-origin') === WEB,
    '④ 白名单来源放行并回带 allow-origin（跨源可用）');
}

if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 2).join(' | '));
await browser.close();
stopAll();
await wait(300);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：部署形态端到端可用（两个源各自启动 / 跨源注册与写数据 / 重启后端数据仍在 / 来源白名单生效）');
