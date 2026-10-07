// 前端接入后端（src/api.js）的**浏览器实测**：
//   ① 后端在：注册/登录/me/拿不到 token 的接口/文档往返/场景往返/旧数据导入，全部走通；
//   ② 后端**不在**：报错必须是**详细的**（code/error/hint/details/状态），
//      且**绝不能假装成功**（不能返回假数据、不能静默退回本地存储）；
//   ③ 401（未登录/token 失效）与"后端挂了"必须区分开 —— 前者是业务状态，后者是连接问题。
//
// 做法：自己拉起 server-api.mjs（测试端口 5293 + 临时库），浏览器里直接用 /src/api.js；
// 通过 globalThis.__IW_API_BASE__ 切换"后端在/不在"，跑完关掉并清理。
// ★ 端口必须独占：5293 上有别人在跑（最坏情况是用户真实库的后端）→ 拒绝运行（见 tests/_own-backend.mjs）。
//   原先这里用的 5299 与 check-mine-page.mjs **撞号**，谁先起谁被复用（测试库互相污染），一并改开。
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { claimPort, assertOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = 5293;
const API_BASE = `http://localhost:${API_PORT}`;
const DEAD_BASE = 'http://localhost:5399';           // 没人监听 → 用来验"后端挂了"
const TMP = join(APP, 'data', 'test-frontend-api');
const API_LOG = join(TMP, 'api.log');                // 临时日志 + "是我起的"身份标识
const API_EVENTS_LOG = join(TMP, 'events.log');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await claimPort(API_PORT, 'check-frontend-api');     // ★ 绝不复用别人的后端
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: { ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'fe.db'), API_LOG, API_EVENTS_LOG },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
api.stdout.on('data', (d) => { boot += d.toString(); });
api.stderr.on('data', (d) => { boot += d.toString(); });
const stopAll = () => { try { api.kill(); } catch { /* 已退出 */ } };
process.on('exit', stopAll);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + e.message); stopAll(); process.exit(1); });

// 等后端起来
let up = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(API_BASE + '/api/v1/health'); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ } await wait(200); }
if (!up) { console.log('✗ 后端没起来：' + boot.slice(0, 300)); stopAll(); process.exit(1); }
await assertOwnApi(API_PORT, 'check-frontend-api', API_LOG);   // ★ 复核：应答的必须是我起的那个

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,860', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 860 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// 打开一个同源页面（前端静态服务 5188），注入 API 基址覆盖
await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate((b) => { globalThis.__IW_API_BASE__ = b; }, API_BASE);

// ---------- ① 后端在：全流程 ----------
{
  const r = await page.evaluate(async () => {
    const api = await import('/src/api.js');
    const out = { base: api.apiBase() };
    const h = await api.health();
    out.health = { ok: h.ok, db: h.db, users: h.users };
    // 未登录访问受保护接口 → 401 + NO_TOKEN（业务状态，不是"后端挂了"）
    try { await api.me(); } catch (e) { out.noToken = { code: e.code, status: e.status, hasHint: !!e.hint }; }
    const reg = await api.register('feuser', 'secret123');
    out.registered = { user: reg.user.username, isAdmin: reg.user.isAdmin, hasToken: !!api.getToken() };
    const me = await api.me();
    out.me = me.user.username;
    await api.putDoc('settings', { from: 'frontend', n: 1 });
    out.doc = (await api.getDoc('settings')).doc;
    const sc = await api.createScene({ name: '前端建的场景', data: { entities: [1, 2] } });
    out.sceneId = sc.id;
    out.scenes = (await api.listScenes()).scenes.map((s) => s.name);
    out.sceneDoc = (await api.getScene(sc.id)).doc.data.entities.length;
    // ★ 导入的真实契约是"只填空位、不覆盖"：
    //   settings 我刚才已经写过 → 必须被跳过；progress 还是空的 → 必须被应用。
    const imp = await api.importLegacy(
      { settings: { legacy: 'SHOULD_NOT_WIN' }, progress: { legacy: true } },
      [{ id: 'legacy1', name: '旧场景', data: {} }],
    );
    out.imported = imp.applied;
    out.skipped = imp.skipped;
    out.docAfterImport = (await api.getDoc('settings')).doc;
    out.progressDoc = (await api.getDoc('progress')).doc;
    out.sceneNamesAfterImport = (await api.listScenes()).scenes.map((s) => s.name);
    await api.deleteScene(sc.id);
    out.afterDeleteNames = (await api.listScenes()).scenes.map((s) => s.name);
    out.state = api.getBackendState();
    return out;
  });
  ok(r.base === API_BASE, `① apiBase() 取到注入的后端地址（${r.base}）`);
  ok(r.health.ok && r.health.db === 'sqlite', '① health 可用且报告 db=sqlite');
  ok(r.noToken && r.noToken.code === 'NO_TOKEN' && r.noToken.status === 401 && r.noToken.hasHint,
    '① 未登录访问受保护接口 → 401 + NO_TOKEN + hint（业务状态）');
  ok(r.registered.isAdmin === true && r.registered.hasToken, '① 注册成功（首个用户=管理员）且 token 已存');
  ok(r.me === 'feuser', '① me 返回当前用户');
  ok(r.doc && r.doc.from === 'frontend', '① 文档写入后端并回读一致');
  ok(r.scenes.includes('前端建的场景') && r.sceneDoc === 2, '① 场景建/列/取 都通');
  ok(r.imported && r.imported.docs.length === 1 && r.imported.docs[0] === 'progress' && r.imported.scenes === 1,
    `① 旧数据导入：空位被填（progress + 1 场景），已有内容被跳过（applied=${JSON.stringify(r.imported)}）`);
  ok(r.docAfterImport && r.docAfterImport.from === 'frontend' && r.docAfterImport.legacy === undefined,
    '① **导入不覆盖已有数据**（settings 仍是前端写的那份，没被旧数据顶掉）');
  ok(r.progressDoc && r.progressDoc.legacy === true, '① 空位（progress）确实被旧数据填上了');
  ok(r.afterDeleteNames && !r.afterDeleteNames.includes('前端建的场景') && r.afterDeleteNames.includes('旧场景'),
    `① 删的是指定场景（剩下：${JSON.stringify(r.afterDeleteNames)}）`);
  ok(r.state.ok === true, '① 连接状态被标记为 ok（供 UI 用）');
}

// ---------- ② 后端不在：报错必须详细、且不假装成功 ----------
{
  const r = await page.evaluate(async (dead) => {
    globalThis.__IW_API_BASE__ = dead;                 // 指向没人监听的端口
    const api = await import('/src/api.js?dead=1');    // 换个 query 重新求值，避免模块缓存
    const out = {};
    try { await api.getDoc('settings'); out.err = null; }
    catch (e) {
      out.err = { code: e.code, status: e.status, error: e.error, hint: e.hint,
        details: e.details, path: e.path, method: e.method, name: e.name,
        text: typeof e.toDetailText === 'function' ? e.toDetailText(api.apiBase()) : null };
    }
    out.state = api.getBackendState();
    try { await api.health(); out.healthOk = true; } catch { out.healthOk = false; }
    return out;
  }, DEAD_BASE);
  ok(r.err, '② 后端不在时**抛错**（没有假装成功）');
  ok(r.err && r.err.code === 'BACKEND_UNREACHABLE', `② code = BACKEND_UNREACHABLE（实测 ${r.err && r.err.code}）`);
  ok(r.err && r.err.error && r.err.error.includes(DEAD_BASE), '② 错误里写明**连不上的地址**');
  ok(r.err && r.err.hint && r.err.hint.includes('npm run start:api'), '② hint 告诉用户**怎么修**（怎么起后端）');
  ok(r.err && r.err.details && r.err.details.url && r.err.details.cause, '② details 带 url 与底层 cause（诊断够用）');
  ok(r.err && r.err.path === '/settings' && r.err.method === 'GET', '② 错误带上是哪个接口、什么方法');
  ok(r.err && r.err.text && r.err.text.includes('后端请求失败') && r.err.text.includes('怎么办'), '② toDetailText() 是一段可直接显示给人看的详细说明');
  ok(r.state && r.state.ok === false && r.state.reason, '② 连接状态被标记为 down 且带原因（UI 可据此出横幅）');
  ok(r.healthOk === false, '② health 在后端不在时也是失败（不返回假 ok）');
}

// ---------- ③ 收尾 ----------
await page.evaluate(() => { delete globalThis.__IW_API_BASE__; }).catch(() => {});
if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 2).join(' | '));
await browser.close();
stopAll();
await wait(250);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：前端唯一出口可用（后端在=全流程通；后端不在=详细报错且不假装成功）');
