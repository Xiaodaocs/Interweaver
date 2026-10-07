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
//
// 跑法：node tests/check-account-isolation.mjs   （需要 5188 静态服务在跑；verify 外壳会起好）
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = 5295;                     // 本检查自带的测试后端（与共用的 5189 互不干扰）
const API = `http://localhost:${API_PORT}`;
const WEB = 'http://localhost:5188';
const TMP = join(APP, 'data', 'test-account-isolation');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP, env: { ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'iso.db') },
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
