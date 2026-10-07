// 账号隔离验收（用户报告的 bug）：**一个账号的数据只能被它自己看到**。
//
// 用户原话："我用账号 2 可以打开账号 1 的存档和数据，需要修改每个账号都是独立的，
//           也就是说，一个新注册的账号从成就到画布和存档都是崭新的，同一个账号才能读取和使用同一份数据。"
//
// 这条检查真在浏览器里跑（自己拉起临时后端 + 临时库，跑完删掉），断言四件事：
//   ① 账号 A：画一个圆 + 在**设置页真实 UI** 上改一项 + 写进度/草稿 → 后端确实有 A 的三份文档；
//   ② 清掉 token（= 退出登录）→ **同一浏览器、不清 localStorage** 注册账号 B →
//      B 的画布空、设置是默认值、成就空、草稿空，且 B 的 GET /settings|/progress|/draft 都是空（doc=null）；
//      浏览器里也不该再留下旧的全局数据键（interweaver.settings.v1 / progress.v1 / draft.v1 已被归属收走）；
//   ③ 切回 A → A 的数据**原样回来**（画布 1 个实体、成就还在、设置还是改过的那份）—— 隔离不能把本人数据弄丢；
//   ④ 后端隔离：拿 B 的 token 去取 A 的云端场景 → 404；B 的场景列表为空；A 自己取 → 200（后端本来就是对的，这里钉住它）；
//   ⑤ 访客数据只进一个账号："先逛逛"画的东西可以带进**第一个**登录/注册的账号，
//      但再换一个账号时**一份都不导**（这是原 bug 的第二条通道：登录页的旧数据自动导入）。
//   ⑥ 成就页（/starmap.html，独立页面）读的必须是**当前账号**那一份：A 在画布上点亮的成就，
//      打开成就页要看得见；换成 B 是空的；切回 A 又回来（以前这一页读的是全局键 → 谁都读不到）。
//   ⑦ 浏览器级偏好（主题 / 音效开关 / 拍摄开关 / 详情卡位置）也一人一份，换账号互不可见。
//
// 跑法：node tests/check-account-isolation.mjs   （需要 5188 静态服务在跑；verify 外壳会起好）
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { claimPort, assertOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = 5295;                     // 本检查自带的测试后端（与共用的 5189 互不干扰）
const API = `http://localhost:${API_PORT}`;
const WEB = 'http://localhost:5188';
const TMP = join(APP, 'data', 'test-account-isolation');
const API_LOG = join(TMP, 'api.log');      // 临时日志 + "是我起的"身份标识
const API_EVENTS_LOG = join(TMP, 'events.log');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

// ★ 端口必须由本检查**独占**：5295 上有别人在跑（最坏情况是连着用户真实库的后端）→ 拒绝运行，绝不复用。
await claimPort(API_PORT, 'check-account-isolation');
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP, env: { ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'iso.db'), API_LOG, API_EVENTS_LOG },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
api.stdout.on('data', (d) => { boot += d.toString(); }); api.stderr.on('data', (d) => { boot += d.toString(); });
const stopAll = () => { try { api.kill(); } catch { /* 已退出 */ } };
process.on('exit', stopAll);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + ((e && e.message) || e)); stopAll(); process.exit(1); });

let up = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(API + '/api/v1/health'); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ } await wait(200); }
if (!up) { console.log('✗ 测试后端没起来：' + boot.slice(0, 300)); stopAll(); process.exit(1); }
await assertOwnApi(API_PORT, 'check-account-isolation', API_LOG);   // ★ 复核：应答的必须是我起的那个
console.log(`· 测试后端已起：${API}（临时库 ${TMP.replace(APP, '.')}）`);

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
await page.evaluateOnNewDocument(([b]) => { globalThis.__IW_API_BASE__ = b; }, [API]);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// ---------- 小工具 ----------
const loginForm = async (name, pass, how) => {
  await page.goto(WEB + '/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { const api = await import('/src/api.js'); api.clearToken(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#user', { timeout: 8000 });
  await page.evaluate(([u, p, m]) => {
    document.querySelector('[data-tab="' + m + '"]').click();
    document.getElementById('user').value = u;
    document.getElementById('pass').value = p;
    document.getElementById('go').click();
  }, [name, pass, how]);
  await page.waitForFunction(() => /index\.html/.test(location.pathname), { timeout: 15000 });
  await settle();
};
const settle = async () => {
  await page.waitForFunction(() => !!window.__IW, { timeout: 15000 });
  await page.waitForFunction(async () => { const M = await import('/src/appMode.js'); return M.getMode() !== 'loading'; }, { timeout: 15000 });
  await wait(900);
};
const toIndex = async () => { await page.goto(WEB + '/index.html', { waitUntil: 'domcontentloaded' }); await settle(); };
const toSettings = async () => { await page.goto(WEB + '/settings.html', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#setWrap', { timeout: 8000 }); };
const facts = () => page.evaluate(async () => {
  const S = await import('/src/settings.js');
  const F = await import('/src/sceneFile.js');
  const U = await import('/src/userScope.js');
  const d = F.readDraft();
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('interweaver')) ls[k] = (localStorage.getItem(k) || '').length; }
  return {
    entities: window.__IW ? window.__IW.st.entities.size : null,
    granted: window.__IW ? window.__IW.ach.tracker.granted.size : null,
    grantedIds: window.__IW ? [...window.__IW.ach.tracker.granted.keys()].slice(0, 6) : null,
    settings: { grid: S.getSetting('grid'), snapGrid: S.getSetting('snapGrid'), snapAngle: S.getSetting('snapAngle') },
    settingsKey: S.settingsDebug().key,
    draftKey: F.draftDebug().key,
    draft: d ? { name: d.name, bytes: d.text.length } : null,
    scope: U.scopeInfo(),
    ls,
  };
});
const token = () => page.evaluate(() => localStorage.getItem('interweaver.token'));
const apiJson = async (path, tok, init) => {
  const r = await fetch(API + '/api/v1/' + path, {
    ...init,
    headers: { ...(init && init.body ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...((init && init.headers) || {}) },
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const docOf = async (kind, tok) => (await apiJson(kind, tok)).json;
const drawCircle = () => page.evaluate(() => {
  const { st, S } = window.__IW;
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.ensureEvaluated(st);
  S.emit(st, 'structure');
});
const saveDraftNow = () => page.evaluate(async () => {
  const F = await import('/src/sceneFile.js');
  return F.saveDraft(window.__IW.st, window.__IW.cam, '验收场景');
});
const globalUserKeysLeft = (ls) => ['interweaver.settings.v1', 'interweaver.progress.v1', 'interweaver.draft.v1'].filter((k) => ls[k] !== undefined);

// ---------- 成就页（独立页面 /starmap.html）----------
// 这一页没有 window.__IW（没有工作台），所以断言直接落在**页面上真正点亮的知识点**上：
//   .smNode[data-state="granted"] —— 星图里已点亮的知识卡片。
// 同时把"它读的是哪个键、读到了几条成就"一并取回来（键名必须落在当前账号的命名空间里）。
const toStarmap = async () => {
  await page.goto(WEB + '/starmap.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#starMap', { timeout: 15000 }).catch(() => {});
  await wait(1500);
};
const starFacts = () => page.evaluate(async () => {
  const U = await import('/src/userScope.js');
  const key = U.scopedKey('interweaver.progress.v1');
  let ids = [];
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    // exportTracker() 的 granted 是**数组** [{id,at,…}]（不是对象）—— 两种形状都认，别猜
    const g = d && d.tracker && d.tracker.granted;
    ids = Array.isArray(g) ? g.map((x) => x && x.id).filter(Boolean)
      : (g && typeof g === 'object' ? Object.keys(g) : []);
  } catch { ids = []; }
  const hud = document.querySelector('#starMap .smHud');
  return {
    userId: U.currentUserId(),
    key,
    archiveIds: ids,
    grantedNodes: document.querySelectorAll('#starMap .smNode[data-state="granted"]').length,
    allNodes: document.querySelectorAll('#starMap .smNode').length,
    hud: hud ? hud.textContent.replace(/\s+/g, ' ').trim() : '',
    globalProgressLeft: localStorage.getItem('interweaver.progress.v1') !== null,
  };
});

// ---------- 浏览器级偏好（主题 / 音效 / 拍摄 / 详情卡位置）----------
const prefFacts = () => page.evaluate(async () => {
  const T = await import('/src/theme.js');
  const X = await import('/src/sfx.js');
  const H = await import('/src/achievements/shot.js');
  const S = await import('/src/settings.js');
  const U = await import('/src/userScope.js');
  const K = (b) => U.scopedKey(b);
  return {
    userId: U.currentUserId(),
    theme: T.currentMode(),
    themeKey: K('interweaver.theme'),
    themeRaw: localStorage.getItem(K('interweaver.theme')),
    sfx: X.sfxEnabled(),
    sfxRaw: localStorage.getItem(K('interweaver.sfx')),   // 旧键：音效改成单一事实来源后这里应恒为 null
    sfxSetting: S.getSetting('sfx'),                      // ★ 音效的**唯一事实来源**：设置库的 sfx 键（按账号存 + 落后端）
    // ★ 拍摄开关有两个入口：shot.js 自己的键 + 设置库的 achShot。
    //   工作台启动时 main.js 会用**设置库**里那份覆盖 shot.js 的键
    //   （main.js 的 applySettings：setShotsEnabled(getSetting('achShot'))，默认 true），
    //   所以这里两样都取回来，断言才落在真实路径上，而不是落在某一个默认值上。
    shots: H.shotsEnabled(),
    shotsRaw: localStorage.getItem(K('interweaver.shots')),
    achShot: S.getSetting('achShot'),
    detailPos: localStorage.getItem(K('interweaver.detailPos')),
    globalTheme: localStorage.getItem('interweaver.theme'),
    globalSfx: localStorage.getItem('interweaver.sfx'),
    globalShots: localStorage.getItem('interweaver.shots'),
    globalDetailPos: localStorage.getItem('interweaver.detailPos'),
  };
});
const setPrefs = (theme, sfx, shots, pos) => page.evaluate(async ([t, s, h, p]) => {
  const T = await import('/src/theme.js');
  const X = await import('/src/sfx.js');
  const H = await import('/src/achievements/shot.js');
  const S = await import('/src/settings.js');
  const U = await import('/src/userScope.js');
  T.setTheme(t); X.setSfxEnabled(s);
  S.setSetting('achShot', h);    // 设置库（按账号存 + 落后端）—— 工作台启动时就是用它驱动拍摄开关
  H.setShotsEnabled(h);          // 同一时刻即时生效
  U.writeUserValue('interweaver.detailPos', JSON.stringify(p));   // achievementDetail.js 写位置用的就是这个入口
  return { theme: T.currentMode(), sfx: X.sfxEnabled(), shots: H.shotsEnabled() };
}, [theme, sfx, shots, pos]);

// =====================================================================================
// ① 账号 A：画圆 + 设置页真实 UI 改一项 + 进度/草稿 → 后端确实有 A 的三份文档
// =====================================================================================
console.log('\n① 账号 A：画一个圆 + 在设置页改一项（真实 UI）+ 产生进度与草稿');
await page.goto(WEB + '/settings.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());                      // 干净起点
await loginForm('isoAlice', 'secret123', 'register');
await drawCircle();
await saveDraftNow();
await wait(5000);                                                     // 等成就判定（连续稳定 ≥500ms）
const A1 = await facts();
const tokA = await token();
ok(A1.entities === 1, `A 画布上有 1 个实体（实测 ${A1.entities}）`);
ok(A1.granted >= 1, `A 拿到成就 ${A1.granted} 个：${JSON.stringify(A1.grantedIds)}`);
ok(!!A1.draft, `A 有草稿（${A1.draft ? A1.draft.bytes + ' 字节' : '无'}）`);
ok(/^interweaver\.u\d+\./.test(A1.settingsKey || ''), `A 的设置键已按账号命名空间化（实测 ${A1.settingsKey}）`);
ok(/^interweaver\.u\d+\./.test(A1.draftKey || ''), `A 的草稿键已按账号命名空间化（实测 ${A1.draftKey}）`);

// 设置页真实 UI：切到「操作」分区，把「吸附到网格」从默认 true 关掉
await toSettings();
await page.evaluate(() => { const b = document.querySelector('[data-goto="operation"]'); if (b) b.click(); });
await page.waitForFunction(() => !!document.querySelector('[data-sk="snapGrid"]'), { timeout: 6000 }).catch(() => {});
const uiClick = await page.evaluate(() => {
  const el = document.querySelector('[data-sk="snapGrid"]');
  if (!el) return { found: false };
  const before = el.checked;
  el.click();
  return { found: true, before, after: el.checked };
});
ok(uiClick.found && uiClick.before === true && uiClick.after === false,
  `设置页 UI：勾选框「吸附到网格」由 ${uiClick.before} → ${uiClick.after}`);
let aSettingsDoc = null;
for (let i = 0; i < 15; i++) { aSettingsDoc = await docOf('settings', tokA); if (aSettingsDoc && aSettingsDoc.doc) break; await wait(200); }
ok(!!(aSettingsDoc && aSettingsDoc.doc), 'A 的设置已同步到后端 settings 文档（开屏闸门读的就是它）');
ok(!!(aSettingsDoc && aSettingsDoc.doc && aSettingsDoc.doc.snapGrid === false), `后端记住的是 A 改过的值（snapGrid=${aSettingsDoc && aSettingsDoc.doc && aSettingsDoc.doc.snapGrid}）`);
await toIndex();
const A2 = await facts();
ok(A2.settings.snapGrid === false, `回到画布后 A 的设置仍是自己那份（snapGrid=${A2.settings.snapGrid}）`);
const aProg = await docOf('progress', tokA);
const aDraftDoc = await docOf('draft', tokA);
ok(!!(aProg && aProg.doc), 'A 的进度在后端（progress 文档非空）');
ok(!!(aDraftDoc && aDraftDoc.doc), 'A 的草稿在后端（draft 文档非空）');

// ------------------------------------------------------------------------------------
// ①′ 成就页（/starmap.html）也必须看到 A 点亮的成就（以前它读全局键 → 登录用户永远读不到）
// ------------------------------------------------------------------------------------
console.log('\n①′ 成就页（独立页面）：A 在画布上点亮的成就，在成就页上也要看得见');
await toStarmap();
const SA1 = await starFacts();
ok(SA1.grantedNodes >= 1,
  `成就页上已点亮知识点 ${SA1.grantedNodes}/${SA1.allNodes} 个（页面 HUD：「${SA1.hud}」）`);
ok(/^interweaver\.u\d+\.progress\.v1$/.test(SA1.key),
  `成就页读的是**当前账号**的存档键（实测 ${SA1.key}）`);
ok(SA1.archiveIds.length === A2.granted,
  `成就页读到的成就条数与画布一致（成就页 ${SA1.archiveIds.length} 条 = 画布 ${A2.granted} 条）`);
ok(!SA1.globalProgressLeft, '全局键 interweaver.progress.v1 没有残留（已被收进账号命名空间）');

// =====================================================================================
// ② 退出（清 token，**不清 localStorage**）→ 同一浏览器注册 B → B 必须是崭新的
// =====================================================================================
console.log('\n② 同一个浏览器换账号：注册 B（不清 localStorage）');
await page.goto(WEB + '/login.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { const api = await import('/src/api.js'); api.clearToken(); });   // = 退出登录（清凭证 + 忘掉账号）
await loginForm('isoBob', 'secret123', 'register');
const B1 = await facts();
const tokB = await token();
ok(B1.entities === 0, `B 的画布是空的（实体 ${B1.entities}）—— 没有看到 A 的图形`);
ok(B1.granted === 0, `B 的成就是空的（${B1.granted}）—— 没有拿到 A 的成就`);
ok(B1.draft === null, `B 没有草稿（${JSON.stringify(B1.draft)}）—— 没有恢复 A 的草稿`);
ok(B1.settings.grid === true && B1.settings.snapGrid === true && B1.settings.snapAngle === false,
  `B 的设置是**默认值**（${JSON.stringify(B1.settings)}）—— 没有继承 A 改过的设置`);
ok(B1.settingsKey !== A1.settingsKey && B1.draftKey !== A1.draftKey,
  `B 用的是自己的键（${B1.settingsKey} / ${B1.draftKey}），与 A 的（${A1.settingsKey} / ${A1.draftKey}）不同`);
const left = globalUserKeysLeft(B1.ls);
ok(left.length === 0, `B 的浏览器里没有遗留的全局用户数据键（${left.length ? left.join(',') : '无'}）`);
const bSettings = await docOf('settings', tokB);
const bProgress = await docOf('progress', tokB);
const bDraft = await docOf('draft', tokB);
ok(!(bSettings && bSettings.doc), `B 的后端 settings 是空的（doc=${bSettings && JSON.stringify(bSettings.doc)}）—— 登录页没有把 A 的设置导进来`);
ok(!(bProgress && bProgress.doc), `B 的后端 progress 是空的（doc=${bProgress && JSON.stringify(bProgress.doc)}）`);
ok(!(bDraft && bDraft.doc), `B 的后端 draft 是空的（doc=${bDraft && JSON.stringify(bDraft.doc)}）`);
const bScenes = await apiJson('scenes', tokB);
ok(((bScenes.json && bScenes.json.scenes) || []).length === 0, 'B 的云端场景列表是空的');

// B 的成就页同样必须是空的（读的是 B 自己的命名空间）
console.log('\n②′ B 的成就页：空的');
await toStarmap();
const SB = await starFacts();
ok(SB.grantedNodes === 0,
  `成就页上已点亮知识点 0 个（实测 ${SB.grantedNodes}；页面 HUD：「${SB.hud}」）—— 看不到 A 的成就`);
ok(SB.key !== SA1.key, `B 的成就页读的是自己的键（${SB.key} ≠ ${SA1.key}）`);
ok(SB.archiveIds.length === 0, `B 的成就页存档是空的（${SB.archiveIds.length} 条）`);

// =====================================================================================
// ③ 切回 A：A 自己的数据必须原样回来（隔离不能把本人数据弄丢）
// =====================================================================================
console.log('\n③ 切回账号 A：自己的数据要原样回来');
await loginForm('isoAlice', 'secret123', 'login');
const A3 = await facts();
ok(A3.entities === 1, `A 的画布恢复（实体 ${A3.entities}）—— 自己画的圆还在`);
ok(A3.granted >= 1, `A 的成就恢复（${A3.granted}：${JSON.stringify(A3.grantedIds)}）`);
ok(A3.settings.snapGrid === false, `A 的设置恢复（snapGrid=${A3.settings.snapGrid}）—— 在设置页改的那一项还在`);
ok(!!A3.draft, `A 的草稿恢复（${A3.draft ? A3.draft.bytes + ' 字节' : '无'}）`);

// 切回 A：成就页必须**原样回来**（隔离不能把本人看得见的东西弄丢）
console.log('\n③′ 切回 A：成就页上的成就原样回来');
await toStarmap();
const SA2 = await starFacts();
ok(SA2.grantedNodes === SA1.grantedNodes && SA2.grantedNodes >= 1,
  `成就页恢复（${SA2.grantedNodes} 个已点亮知识点，与切走前的 ${SA1.grantedNodes} 个一致）`);
ok(SA2.key === SA1.key, `读的还是 A 自己的键（${SA2.key}）`);

// ------------------------------------------------------------------------------------
// ③‴ 「全新设备」：**另一个浏览器上下文**（localStorage 全空）+ 只放一个已登录 token
//      → 直接用书签打开 /starmap.html（这一趟**从没进过画布页**，所以没有任何本地镜像）
//      → 也必须看得到该账号**后端 progress 文档**里的成就
//   用户原话："成就也是用户数据"。改动前这一页只读 scopedStorage 解析出的本账号本地镜像，
//   全新设备上那份镜像是空的 → 空星图（只有画布页的开屏闸门才会 GET 后端并 seed 进镜像）。
// ------------------------------------------------------------------------------------
console.log('\n③‴ 全新设备（新浏览器上下文，本地存储全空）：只带 token 直接打开成就页');
const aProgForFresh = await docOf('progress', tokA);
const backendIds = (() => {
  const g = aProgForFresh && aProgForFresh.doc && aProgForFresh.doc.tracker && aProgForFresh.doc.tracker.granted;
  if (Array.isArray(g)) return g.map((x) => x && x.id).filter(Boolean);
  return (g && typeof g === 'object') ? Object.keys(g) : [];
})();
const freshCtx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
const freshPage = await freshCtx.newPage();
const freshErrors = [];
freshPage.on('pageerror', (e) => freshErrors.push(e.message));
await freshPage.evaluateOnNewDocument(([base]) => { globalThis.__IW_API_BASE__ = base; }, [API]);
// 先按访客打开一次（新设备上用户还没把 token 放进来），再只放 token 重新加载 ——
// **不**写 interweaver.auth.v1、不写任何镜像：命名空间必须靠页面自己去 /auth/me 认出来。
await freshPage.goto(WEB + '/starmap.html', { waitUntil: 'domcontentloaded' });
await freshPage.evaluate((t) => { localStorage.clear(); localStorage.setItem('interweaver.token', t); }, tokA);
await freshPage.reload({ waitUntil: 'domcontentloaded' });
await freshPage.waitForSelector('#starMap', { timeout: 15000 }).catch(() => {});
await wait(1500);
const freshFacts = () => freshPage.evaluate(async () => {
  const U = await import('/src/userScope.js');
  const key = U.scopedKey('interweaver.progress.v1');
  let ids = [];
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    const g = d && d.tracker && d.tracker.granted;
    ids = Array.isArray(g) ? g.map((x) => x && x.id).filter(Boolean) : (g && typeof g === 'object' ? Object.keys(g) : []);
  } catch { ids = []; }
  const hud = document.querySelector('#starMap .smHud');
  return {
    userId: U.currentUserId(), key, ids,
    grantedNodes: document.querySelectorAll('#starMap .smNode[data-state="granted"]').length,
    allNodes: document.querySelectorAll('#starMap .smNode').length,
    mirror: localStorage.getItem(key) !== null,
    token: localStorage.getItem('interweaver.token') !== null,
    hud: hud ? hud.textContent.replace(/\s+/g, ' ').trim() : '',
  };
});
const F1 = await freshFacts();
ok(F1.grantedNodes >= 1,
  `全新设备直接打开成就页就能看到 ${F1.grantedNodes}/${F1.allNodes} 个已点亮知识点（页面 HUD：「${F1.hud}」）—— 这一趟从没进过画布页`);
ok(F1.grantedNodes === SA2.grantedNodes,
  `与后端那份一致（新设备 ${F1.grantedNodes} = 本机切回 A 后 ${SA2.grantedNodes}）`);
ok(F1.userId === SA2.userId, `命名空间靠页面自己 /auth/me 认出来（uid ${F1.userId}）`);
ok(F1.ids.length === backendIds.length && backendIds.every((id) => F1.ids.includes(id)),
  `成就条数与后端 progress 文档一致（页面 ${F1.ids.length} 条 = 后端 ${backendIds.length} 条：${JSON.stringify(backendIds.slice(0, 4))}）`);
ok(F1.mirror && /^interweaver\.u\d+\.progress\.v1$/.test(F1.key),
  `拉回来的进度写进了**这个账号**的本地镜像（${F1.key}）`);

// ------------------------------------------------------------------------------------
// ③‴′ 同一台"全新设备"上再打开**工作台**：账号里的画布（draft 文档）必须真的被放到画布上。
//   实测过的数据丢失级 bug（本轮修掉）：sceneFile.adoptRemoteDraft 原来是
//   mirrorRemote() → applyToCanvasIfNeeded()，而后者开头有"本地镜像与后端这份字节相同就跳过"的
//   提前返回 —— 全新设备上镜像刚被自己写下去，于是这句话立刻成立，后端草稿**从没被放到画布上**，
//   画布是空的；4 秒后的自动保存再把这份空画布写回账号 = 另一台设备的画布被抹掉。
// ------------------------------------------------------------------------------------
await freshPage.goto(WEB + '/index.html', { waitUntil: 'domcontentloaded' });
await freshPage.waitForFunction(() => !!window.__IW, { timeout: 15000 });
await freshPage.waitForFunction(async () => { const M = await import('/src/appMode.js'); return M.getMode() !== 'loading'; }, { timeout: 15000 });
await wait(1500);
const freshCanvas = await freshPage.evaluate(() => ({ entities: window.__IW.st.entities.size, variables: window.__IW.st.variables.size }));
ok(freshCanvas.entities >= 1,
  `全新设备登录后打开工作台：账号里的画布被恢复（实体 ${freshCanvas.entities} / 变量 ${freshCanvas.variables}）—— 而不是"空画布等着 4 秒后的自动保存覆盖账号里的草稿"`);
// 反面：退出登录（api.clearToken = 清凭证 + forgetAuth，命名空间回到访客）→ 同一上下文里必须看不到任何成就。
// 注意必须走**应用自己的退出路径**：只删 token 而不 forgetAuth 时，userScope 里的"上一个账号"仍在，
// 命名空间仍然解析到 u<id>（画布页也是这个语义），那不是"未登录"，不能拿来当反面。
await freshPage.evaluate(async () => { const api = await import('/src/api.js'); api.clearToken(); });
await freshPage.reload({ waitUntil: 'domcontentloaded' });
await freshPage.waitForSelector('#starMap', { timeout: 15000 }).catch(() => {});
await wait(900);
const F2 = await freshFacts();
ok(F2.grantedNodes === 0, `反面：退出登录后同一页面看不到任何成就（实测 ${F2.grantedNodes} 个已点亮）`);
if (freshErrors.length) bad.push('全新设备成就页运行时错误：' + freshErrors.slice(0, 2).join(' | '));
await freshPage.close();
await freshCtx.close();

// ------------------------------------------------------------------------------------
// ③″ 浏览器级偏好（主题 / 音效开关 / 拍摄开关 / 详情卡位置）也一人一份
//     用户要求"每个账号都是独立的"——这些以前是**浏览器级全局键**，账号 2 一开就是账号 1 的样子。
// ------------------------------------------------------------------------------------
console.log('\n③″ 浏览器级偏好：A 设一套 → 换 B 必须是 B 自己的默认值 → 切回 A 原样回来');
await toIndex();
// A 设一套非默认值：主题 dark、音效关、拍摄关、详情卡位置 {137,251}
await setPrefs('dark', false, false, { x: 137, y: 251 });
const PA = await prefFacts();
ok(PA.themeRaw === 'dark' && /^interweaver\.u\d+\.theme$/.test(PA.themeKey),
  `A 的主题写进自己的命名空间（${PA.themeKey} = ${PA.themeRaw}）`);
// ★ 断言按**新语义**重述：音效只有一份 —— 设置库的 sfx 键（按账号 + 落后端）。
//   A 把它关掉 → 设置库里就是 false，且**没有第二个键**（旧的 interweaver.sfx 已不存在）。
ok(PA.sfx === false && PA.sfxSetting === false && PA.sfxRaw === null,
  `A 把音效关掉：运行时 sfx=${PA.sfx}、设置库 sfx=${PA.sfxSetting}（唯一事实来源），旧键 ${PA.sfxRaw}`);
ok(PA.shots === false && PA.achShot === false && PA.shotsRaw === '0',
  `A 的拍摄开关按账号存（shots=${PA.shots}，设置库 achShot=${PA.achShot}，键值 ${PA.shotsRaw}）`);
ok(PA.detailPos === '{"x":137,"y":251}', `A 的详情卡位置按账号存（${PA.detailPos}）`);
ok(PA.globalTheme === null && PA.globalSfx === null && PA.globalShots === null && PA.globalDetailPos === null,
  `A 没有把偏好写回全局键（theme=${PA.globalTheme}, sfx=${PA.globalSfx}, shots=${PA.globalShots}, detailPos=${PA.globalDetailPos}）`);

// ★ 最关键的一条：**刷新后仍是关的**。原 bug 正是"启动时把设置库推给运行时"顺手把用户
//   关掉的音效写回 on —— 只要这一条红了，就说明音效又回到了两个事实来源互相覆盖的状态。
await toIndex();
const PA1b = await prefFacts();
ok(PA1b.sfx === false && PA1b.sfxSetting === false && PA1b.sfxRaw === null,
  `A 刷新后音效仍是关的（运行时 sfx=${PA1b.sfx}、设置库 sfx=${PA1b.sfxSetting}）—— 用户关掉的没有被改回来`);

await loginForm('isoBob', 'secret123', 'login');
const PB = await prefFacts();
ok(PB.userId !== PA.userId, `确实换到 B 了（uid ${PA.userId} → ${PB.userId}）`);
ok(PB.theme === 'light' && PB.themeRaw === null && PB.sfx === true && PB.sfxSetting === true && PB.sfxRaw === null && PB.detailPos === null,
  `B 的主题/音效/详情位置都是**默认值**（主题 ${PB.theme}、音效 ${PB.sfx}（设置库 ${PB.sfxSetting}）、详情位置 ${PB.detailPos}）—— 没有继承 A 关掉的那份`);
ok(PB.shots === true && PB.achShot === true && PB.shotsRaw === '1',
  `B 的拍摄开关是**它自己的默认 true**（设置库 achShot=${PB.achShot}），不是 A 关掉的那个 false（键值 ${PB.shotsRaw}）`);

await loginForm('isoAlice', 'secret123', 'login');
const PA2 = await prefFacts();
ok(PA2.theme === 'dark' && PA2.sfx === false && PA2.sfxSetting === false && PA2.shots === false && PA2.detailPos === '{"x":137,"y":251}',
  `切回 A 偏好原样回来（主题 ${PA2.theme}、音效 ${PA2.sfx}（设置库 ${PA2.sfxSetting}）、拍摄 ${PA2.shots}、详情位置 ${PA2.detailPos}）`);

// =====================================================================================
// ④ 后端隔离（直接调 API）：B 的 token 拿 A 的场景 → 404
// =====================================================================================
console.log('\n④ 后端隔离：直接用 B 的 token 去取 A 的云端场景');
const created = await apiJson('scenes', tokA, { method: 'POST', body: JSON.stringify({ name: 'A 的云端场景', data: { entities: [1, 2, 3] } }) });
ok(!!(created.json && created.json.id), `A 建了一个云端场景（id=${created.json && created.json.id}）`);
const aGet = await apiJson('scenes/' + (created.json && created.json.id), tokA);
const bGet = await apiJson('scenes/' + (created.json && created.json.id), tokB);
ok(aGet.status === 200, `A 自己取得到（HTTP ${aGet.status}）`);
ok(bGet.status === 404, `B 取 A 的场景 → 404（实测 ${bGet.status}）—— 后端按 user_id 隔离`);
const bDel = await apiJson('scenes/' + (created.json && created.json.id), tokB, { method: 'DELETE' });
ok(bDel.status === 404, `B 删 A 的场景 → 404（实测 ${bDel.status}）`);
const stillThere = await apiJson('scenes/' + (created.json && created.json.id), tokA);
ok(stillThere.status === 200, 'A 的场景没有被 B 删掉（仍然 200）');
const bDocPeek = await apiJson('progress', tokB);
ok(!(bDocPeek.json && bDocPeek.json.doc), 'B 的 progress 依旧是空（A 的数据没有被"顺手"写过去）');

// =====================================================================================
// ⑤ 访客数据只能进一个账号（原 bug 的第二条通道：登录页"旧数据自动导入"）
// =====================================================================================
console.log('\n⑤ 访客 → 第一个账号（可以带进去）；再换账号 → 一份都不导');
await page.goto(WEB + '/settings.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { const api = await import('/src/api.js'); api.clearToken(); localStorage.removeItem('interweaver.scope.v1'); localStorage.removeItem('interweaver.auth.v1'); localStorage.clear(); });
await toIndex();                                                    // 无 token → 访客（先逛逛）
const G0 = await facts();
ok(G0.entities === 0, '访客起点是空画布');
await drawCircle();
await saveDraftNow();
await wait(5000);
const G1 = await facts();
ok(G1.entities === 1 && G1.granted >= 1, `访客画了 1 个圆、拿到 ${G1.granted} 个成就（本地）`);
await loginForm('isoCarol', 'secret123', 'register');               // 第一个账号：访客数据应当带进来
const C1 = await facts();
const tokC = await token();
ok(C1.entities === 1, `第一个账号 C 把访客的画布带进来了（实体 ${C1.entities}）`);
const cProg = await docOf('progress', tokC);
const cDraft = await docOf('draft', tokC);
ok(!!(cProg && cProg.doc) && !!(cDraft && cDraft.doc), 'C 的后端 progress/draft 已被访客数据填入（= 既有的"旧数据导入"，只填空位）');
await loginForm('isoDave', 'secret123', 'register');                // 换一个账号：一份都不许导
const D1 = await facts();
const tokD = await token();
const dProg = await docOf('progress', tokD);
const dDraft = await docOf('draft', tokD);
ok(D1.entities === 0, `新账号 D 的画布是空的（实体 ${D1.entities}）—— 访客那份没有跟过来`);
ok(D1.granted === 0, `新账号 D 的成就是空的（${D1.granted}）`);
ok(!(dProg && dProg.doc) && !(dDraft && dDraft.doc), `新账号 D 的后端 progress/draft 是空的（p=${!!(dProg && dProg.doc)}, d=${!!(dDraft && dDraft.doc)}）`);
const leftD = globalUserKeysLeft(D1.ls);
ok(leftD.length === 0, `D 的浏览器里没有遗留的全局用户数据键（${leftD.length ? leftD.join(',') : '无'}）`);
await loginForm('isoCarol', 'secret123', 'login');
const C2 = await facts();
ok(C2.entities === 1 && C2.granted >= 1, `切回 C：自己的画布与成就还在（实体 ${C2.entities}，成就 ${C2.granted}）`);

if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 2).join(' | '));
await browser.close();
stopAll();
await wait(250);
await rm(TMP, { recursive: true, force: true }).catch(() => {});

if (bad.length) { console.log('\n❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('\n✅ 通过：新账号从画布/设置/成就/草稿到后端文档都是崭新的；切回原账号数据原样回来；后端按 user_id 隔离（404）');
