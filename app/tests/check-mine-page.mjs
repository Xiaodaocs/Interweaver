// 「我的」独立页面（app/mine.html）验收
//
// ★ 用户要求（两轮）：
//   · 第一轮：把「我的」从设置里**单拿出来**，单独成一个页面（app/mine.html）并深度美化
//     （重构布局与样式，但沿用项目既有的样式格式与令牌）。设置页从此不再有「我的」分类。
//   · 第二轮：入口**改到画布总导航栏**里、紧挨着「设置」（index.html 的 #menubar），
//     **不放在设置页里** —— 所以第一轮加在设置页页头的那条入口已经删掉，本文件也跟着改断言。
//   本文件专门测这条链路；设置页那一侧的对应检查改在 check-account-panel.mjs 里（那条同样不放宽）。
//
// 断言清单（逐条对应要求）：
//   ① 登录门：未登录访问 /mine.html → **真跳** /login.html（不是弹提示、不是空白页、不是停在原页）；
//   ② 反向断言：「我的」的分类项、面板根节点、`window.__SET.nav` 三处都**不再有** mine，
//      设置页页头里**也没有**入口了，面板模块也不再被设置页 import（面板逻辑只有一处）；
//      正向：画布总导航栏里有「我的」入口、指向 ./mine.html、就在「设置」旁边（同一行同一组），
//      且那个地址真的打得开（HTTP 200）；
//   ③ 已登录：用户名 / 身份 / 注册时间 / 头像 / 云端场景区都渲染出来，且与后端逐字一致，账号卡只读；
//   ④ 已登录但后端不可达：**不跳转、不空白** —— 账号卡下方给出详细报错块（连不上的地址 + code + 怎么办），
//      整页结构照样在（这正是类契约普查单独跑时走的那条路）；
//   ⑤ 云端场景：空态文案 → 有数据时列出来（名字 / 时间·体积）→ 重命名与删除都走 src/dialog.js 的自研弹窗，
//      并且「取消」真的什么都不做（删除取消后后端仍有那条）；
//   ⑥ 头像：点内置符号、点主题色 → 立刻写进后端（GET /api/v1/me 的 avatar 真的变了，且两种改动都保留另一半）；
//   ⑦ 全程零原生弹窗（页内探针 + puppeteer 兜底网双重计数）、零 JS 运行时错误；
//   ⑧ 窄屏（390×844）不横向溢出：scrollWidth == clientWidth，且没有任何元素越过视口右边界。
//
// 跑法：cd app && node iw-cli.mjs start && node tests/check-mine-page.mjs
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

import { claimPort, assertOwnApi } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'http://localhost:5188';
const API_PORT = 5299;                              // 本检查自带的测试后端（5298 被 check-account-panel 占着）
const API_BASE = `http://localhost:${API_PORT}`;
const DEAD_BASE = 'http://localhost:5398';          // 故意指向一个没人监听的端口
const TMP = join(APP, 'data', 'test-mine');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

/* ---------------- 0. 测试后端：独立端口 + 独立临时库（绝不碰 5189 上的真实数据） ---------------- */
// ★ 端口必须由本检查**独占**：5299 上有别人在跑（最坏情况是连着用户真实库的后端）→ 拒绝运行，绝不复用。
await claimPort(API_PORT, 'check-mine-page');
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: {
    ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'mine.db'),
    API_LOG: join(TMP, 'api.log'), API_EVENTS_LOG: join(TMP, 'events.log'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
api.stdout.on('data', (d) => { boot += d.toString(); });
api.stderr.on('data', (d) => { boot += d.toString(); });

let web = null;                                     // 自己拉起的前端（复用别人在跑的就保持 null）
const stopAll = () => {
  try { api.kill(); } catch { /* 已退出 */ }
  try { if (web) web.kill(); } catch { /* 已退出 */ }
};
process.on('exit', stopAll);
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message)); stopAll(); process.exit(1); });

let up = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(API_BASE + '/api/v1/health'); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ } await wait(200); }
if (!up) { console.log('✗ 测试后端没起来：' + boot.slice(0, 300)); stopAll(); process.exit(1); }
await assertOwnApi(API_PORT, 'check-mine-page', join(TMP, 'api.log'));   // ★ 复核：应答的必须是我起的那个

/* ---------------- 1. 前端静态服务：没起就自己起（只关自己起的那个） ---------------- */
const webAlive = async () => { try { const r = await fetch(WEB + '/mine.html'); return r.ok; } catch { return false; } };
if (await webAlive()) {
  console.log('  · 复用已在运行的 ' + WEB + '（不动它）');
} else {
  web = spawn(process.execPath, ['server.mjs'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let webBoot = '';
  web.stdout.on('data', (d) => { webBoot += d.toString(); });
  web.stderr.on('data', (d) => { webBoot += d.toString(); });
  for (let i = 0; i < 40 && !(await webAlive()); i++) await wait(200);
  if (!(await webAlive())) { console.log('✗ 前端起不来（' + WEB + '）：' + webBoot.slice(0, 300)); stopAll(); process.exit(1); }
  console.log('  · 自起前端 ' + WEB + '（跑完关掉）');
}

/* ---------------- 2. Node 侧的后端小工具（测试自己造数据，不经过界面） ---------------- */
let TOKEN = '';
const apiGet = (p, token = TOKEN) => fetch(API_BASE + '/api/v1' + p, { headers: token ? { authorization: 'Bearer ' + token } : {} })
  .then((r) => r.json()).catch(() => null);
const apiSend = (p, method, body, token = TOKEN) => fetch(API_BASE + '/api/v1' + p, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
}).then((r) => r.json()).catch(() => null);

const reg = await apiSend('/auth/register', 'POST', { username: 'mineuser', password: 'secret123' }, '');
ok(!!(reg && reg.ok && reg.token), `测试账号注册成功（HTTP 返回 ok=${reg && reg.ok}，用户名 mineuser）`);
if (!(reg && reg.token)) { console.log('✗ 拿不到 token —— 后面的检查无法进行'); stopAll(); process.exit(1); }
TOKEN = reg.token;

/* ---------------- 3. 浏览器 ---------------- */
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1440,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// 兜底网：真有原生弹窗冒出来，记录下来并立刻 dismiss（否则用例会卡死）
const nativeEvents = [];
page.on('dialog', async (d) => {
  nativeEvents.push(d.type() + '：' + d.message().slice(0, 60));
  try { await d.dismiss(); } catch { /* 已经关了 */ }
});
// ★ 必须在**页面自己的脚本执行之前**注入三件事：
//   ① 后端基址（面板一加载就探测后端，注入晚了它会去打 5189 上的真实后端）；
//   ② 登录态（由 Node 侧控制 localStorage 的 iw.test.token，每份新文档开头同步成 interweaver.token）；
//   ③ 原生弹窗探针（顺便写进 sessionStorage，跨导航累计 —— 否则每次跳转计数都会归零）。
await page.evaluateOnNewDocument(([apiBase, deadBase]) => {
  try {
    const t = localStorage.getItem('iw.test.token');
    if (t) localStorage.setItem('interweaver.token', t); else localStorage.removeItem('interweaver.token');
  } catch { /* 隐私模式：忽略 */ }
  try { globalThis.__IW_API_BASE__ = (localStorage.getItem('iw.test.deadApi') === '1') ? deadBase : apiBase; } catch { globalThis.__IW_API_BASE__ = apiBase; }
  window.__nativeCalls = [];
  const record = (s) => {
    window.__nativeCalls.push(s);
    try { const k = 'iw.test.native'; const prev = JSON.parse(sessionStorage.getItem(k) || '[]'); prev.push(s); sessionStorage.setItem(k, JSON.stringify(prev)); } catch { /* 忽略 */ }
  };
  window.alert = function (m) { record('alert:' + String(m).slice(0, 80)); return undefined; };
  window.confirm = function (m) { record('confirm:' + String(m).slice(0, 80)); return false; };
  window.prompt = function (m) { record('prompt:' + String(m).slice(0, 80)); return null; };
}, [API_BASE, DEAD_BASE]);

const setLoginToken = (t) => page.evaluate((v) => { if (v) localStorage.setItem('iw.test.token', v); else localStorage.removeItem('iw.test.token'); }, t);
const setDeadApi = (on) => page.evaluate((v) => { if (v) localStorage.setItem('iw.test.deadApi', '1'); else localStorage.removeItem('iw.test.deadApi'); }, on);
const pathNow = () => page.evaluate(() => location.pathname);
const q = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? { text: (el.textContent || '').trim(), state: el.dataset.state || '', hidden: el.hidden, color: (el.style.getPropertyValue('--c') || '').trim() } : null;
}, sel);

await page.goto(WEB + '/login.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());          // 干净起点：没有 token、没有旧偏好

/* ---------------- ① 设置页反向断言：「我的」不在了；入口在**画布总导航栏**的「设置」旁边 ---------------- */
console.log('\n【①-a 设置页：「我的」分类与面板都已移除，入口也不在这里】');
await page.goto(WEB + '/settings.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__SET).catch(() => {});
await wait(500);
const set = await page.evaluate(() => {
  const entry = document.querySelector('a[href*="mine.html"]');
  const u = entry ? new URL(entry.getAttribute('href'), location.href) : null;
  return {
    navIds: [...document.querySelectorAll('[data-goto]')].map((b) => b.dataset.goto),
    navLabels: [...document.querySelectorAll('.setNavItem')].map((b) => (b.textContent || '').trim()),
    setNav: ((window.__SET && window.__SET.nav) || []).map((g) => g.id),
    secGroups: [...document.querySelectorAll('.setSec')].map((s) => s.dataset.group),
    panelNodes: document.querySelectorAll('#setWrap [data-role="accountCard"], #setWrap .mineBody, #setWrap .mineGrid, #setWrap .mineHero, #setWrap .mineRow').length,
    avatarNodes: document.querySelectorAll('#setWrap [data-role="avatar"], #setWrap [data-role="preview"]').length,
    loginInputs: document.querySelectorAll('#setWrap input[type="password"], #setWrap input[name="username"], #setWrap [data-role="login"], #setWrap [data-role="register"]').length,
    entryCount: document.querySelectorAll('a[href*="mine.html"]').length,
    entry: entry ? { found: true, path: u.pathname, href: u.href, text: (entry.textContent || '').trim(), visible: entry.getClientRects().length > 0, hidden: entry.hidden } : { found: false },
  };
});
ok(!set.navIds.includes('mine') && !set.setNav.includes('mine') && !set.secGroups.includes('mine'),
  `左栏分类里没有「我的」（实测分类：${set.navLabels.join(' / ')}；__SET.nav = ${set.setNav.join(',')}；面板分组 = ${set.secGroups.join(',')}）`);
ok(set.panelNodes === 0, `设置页 DOM 里**不存在**面板根节点（accountCard / mineBody / mineGrid / mineHero / mineRow 合计 ${set.panelNodes} 个）`);
ok(set.avatarNodes === 0, `设置页里也没有头像节点（[data-role=avatar] / [data-role=preview] 合计 ${set.avatarNodes} 个）`);
ok(set.loginInputs === 0, `设置页里依然没有账号/密码输入框、没有登录/注册按钮（合计 ${set.loginInputs} 个）—— 上一轮的规矩没被破坏`);
ok(set.entryCount === 0, `设置页页头里也**没有**「我的」入口了（a[href*=mine.html] 实测 ${set.entryCount} 个）—— 用户要求入口改到画布导航栏去`);

console.log('\n【①-b 画布总导航栏：「我的」就在「设置」旁边（同一行、同一组）】');
await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW).catch(() => {});
await wait(600);
const nav = await page.evaluate(() => {
  const a = document.querySelector('#menubar a[href*="mine.html"]');
  const setBtn = document.querySelector('#menubar [data-mbtop="settings"]');
  if (!a || !setBtn) return { entry: !!a, setBtn: !!setBtn };
  const ra = a.getBoundingClientRect();
  const rs = setBtn.getBoundingClientRect();
  return {
    entry: true, setBtn: true,
    text: (a.textContent || '').trim(),
    path: new URL(a.getAttribute('href'), location.href).pathname,
    visible: ra.width > 0 && ra.height > 0 && getComputedStyle(a).visibility !== 'hidden',
    underline: getComputedStyle(a).textDecorationLine,
    sameGroup: !!a.closest('.mbLeft') && !!setBtn.closest('.mbLeft'),
    sameRow: Math.abs((ra.top + ra.bottom) / 2 - (rs.top + rs.bottom) / 2) < 8,
    gap: Math.round(ra.left - rs.right),
    order: ra.left >= rs.right ? '紧跟在「设置」右边' : '在「设置」左边',
    menubarButtons: document.querySelectorAll('#menubar button, #menubar .mbTop').length,
  };
});
ok(nav.entry && nav.setBtn && nav.text === '我的' && nav.path === '/mine.html' && nav.visible,
  `画布导航栏里有「我的」入口且指向 ./mine.html（文字"${nav.text}"，实测 ${nav.path}，看得见=${nav.visible}）`);
ok(nav.sameGroup && nav.sameRow && nav.gap >= 0 && nav.gap <= 24,
  `它就在「设置」旁边（${nav.order}：同一行=${nav.sameRow}、水平间距 ${nav.gap}px、同在左组=${nav.sameGroup}）`);
ok(nav.underline === 'none', `入口是按导航项排版的，不带 <a> 的默认下划线（text-decoration-line=${nav.underline}）`);

const mineHtml = await fetch(WEB + '/mine.html').then((r) => ({ ok: r.ok, status: r.status, len: 0 })).catch((e) => ({ ok: false, status: String(e.message) }));
ok(mineHtml.ok, `那个地址确实打得开（GET /mine.html → ${mineHtml.status}）`);
const settingsSrc = await fetch(WEB + '/src/settingsMain.js').then((r) => r.text()).catch(() => '');
// 只看**代码**、不看注释：本文件头就写着"不再 import accountPanel.js"，直接正则会被自己的说明命中
const settingsCode = settingsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(settingsCode.length > 100 && !/from\s*['"][^'"]*accountPanel\.js['"]/.test(settingsCode),
  '设置页入口脚本**不再 import** accountPanel.js（面板逻辑只有一处实现，不存在两份）');

/* ---------------- ② 登录门：未登录 → 直接跳 /login.html ---------------- */
console.log('\n【② 登录门：未登录访问 /mine.html → 直接跳登录页（不弹提示）】');
await setLoginToken(null);
await page.goto(WEB + '/mine.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => /\/login\.html$/.test(location.pathname), { timeout: 8000 }).catch(() => {});
await wait(300);
const gate = await page.evaluate(() => ({ path: location.pathname, hasForm: !!document.getElementById('user'), hasPanel: !!document.querySelector('[data-role="accountCard"]'), token: !!localStorage.getItem('interweaver.token') }));
ok(gate.path === '/login.html', `未登录访问 /mine.html → 落在独立登录页（实测 ${gate.path}）`);
ok(gate.hasForm && !gate.hasPanel, '登录页的表单真的在，而且**没有**渲染出「我的」的半个面板（不是空白页、也不是停留原页）');
ok(nativeEvents.length === 0, `这次跳转没有借助任何原生弹窗（puppeteer 兜底网计数 ${nativeEvents.length}）`);

/* ---------------- ③ 已登录：整页渲染，账号信息与后端逐字一致 ---------------- */
console.log('\n【③ 已登录：用户名 / 身份 / 注册时间 / 头像 / 云端场景区都渲染出来，且只读】');
await setLoginToken(TOKEN);
await page.goto(WEB + '/mine.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const n = document.querySelector('[data-role="kvName"]');
  return n && n.textContent === 'mineuser' && !/检测中|读取中/.test((document.querySelector('[data-role="sceneState"]') || {}).textContent || '');
}, { timeout: 12000 }).catch(() => {});
const mine = await page.evaluate(() => {
  const qq = (r) => document.querySelector('[data-role="' + r + '"]');
  const card = qq('accountCard');
  return {
    path: location.pathname,
    title: document.title,
    bodyClass: document.body.className,
    who: (qq('who') || {}).textContent || '',
    role: (qq('role') || {}).textContent || '',
    kvName: (qq('kvName') || {}).textContent || '',
    kvRole: (qq('kvRole') || {}).textContent || '',
    kvCreated: (qq('kvCreated') || {}).textContent || '',
    kvTags: ['kvName', 'kvRole', 'kvCreated'].map((r) => ((qq(r) || {}).tagName || '?')),
    inputs: card ? card.querySelectorAll('input, textarea, select').length : -1,
    avatar: !!qq('avatar'), avatarState: qq('avatar') ? qq('avatar').dataset.state : '',
    avatarGlyph: ((qq('avatar') || {}).querySelector ? qq('avatar').querySelector('[data-paint="glyph"]').textContent : ''),
    avatarColor: qq('avatar') ? (qq('avatar').style.getPropertyValue('--c') || '').trim() : '',
    preview: !!qq('preview'), previewState: qq('preview') ? qq('preview').dataset.state : '',
    glyphs: document.querySelectorAll('[data-role="glyphs"] [data-glyph]').length,
    colors: document.querySelectorAll('[data-role="colors"] [data-color]').length,
    glyphOn: document.querySelectorAll('[data-role="glyphs"] [data-state="on"]').length,
    colorOn: document.querySelectorAll('[data-role="colors"] [data-state="on"]').length,
    sceneState: (qq('sceneState') || {}).textContent || '',
    scenes: (qq('scenes') || {}).textContent || '',
    back: !!document.getElementById('mineBack'),
    settingsLink: !!document.querySelector('a[href*="settings.html"]'),
    hasGrid: !!document.querySelector('.mineGrid'),
    hasHero: !!document.querySelector('.mineHero'),
    hasKvBox: !!document.querySelector('.mineKvBox'),
    hasFoot: !!document.querySelector('.mineFoot'),
    heads: [...document.querySelectorAll('.accHead b')].map((b) => b.textContent),
  };
});
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ts) => { const d = new Date(Number(ts)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const wantRole = reg.user && reg.user.isAdmin ? '管理员' : '普通用户';
const wantTime = fmtTime(reg.user && reg.user.createdAt);
ok(mine.path === '/mine.html', `已登录时停在「我的」页（实测 ${mine.path}）`);
ok(/我的/.test(mine.title) && mine.bodyClass.includes('iwMine'), `页面标题与作用域类都对（title="${mine.title}"，body.class="${mine.bodyClass}"）`);
ok(mine.who === 'mineuser' && mine.kvName === 'mineuser', `显示当前用户名（who="${mine.who}"，用户名="${mine.kvName}"）`);
ok(mine.role === wantRole && mine.kvRole === wantRole, `显示身份且与后端一致（实测"${mine.kvRole}"，后端 isAdmin=${!!(reg.user && reg.user.isAdmin)}）`);
ok(mine.kvCreated === wantTime, `显示注册时间且与后端一致（实测"${mine.kvCreated}"，期望"${wantTime}"）`);
ok(mine.kvTags.every((t) => t === 'SPAN') && mine.inputs === 0,
  `账号卡是**只读**的（三行信息标签实测 ${mine.kvTags.join('/')}，卡内 input/textarea/select 合计 ${mine.inputs} 个）`);
ok(mine.avatar && mine.preview && mine.avatarState === 'glyph' && mine.previewState === 'glyph' && mine.avatarGlyph.length > 0,
  `头像渲染出来了（账号卡 data-state="${mine.avatarState}"、预览框 data-state="${mine.previewState}"、符号"${mine.avatarGlyph}"、底色 ${mine.avatarColor}）`);
ok(mine.glyphs === 12 && mine.colors === 8 && mine.glyphOn === 1 && mine.colorOn === 1,
  `内置头像选项齐全且当前项被选中（符号 ${mine.glyphs} 个/选中 ${mine.glyphOn}；主题色 ${mine.colors} 个/选中 ${mine.colorOn}）`);
ok(mine.sceneState === '还没有场景' && mine.scenes.includes('还没有云端场景'),
  `云端场景空态文案正确（状态行"${mine.sceneState}"，列表"${mine.scenes.slice(0, 20)}…"）`);
ok(mine.back && mine.settingsLink, '页头有「返回画布」与「设置」两个出口');
ok(mine.hasHero && mine.hasKvBox && mine.hasGrid && mine.hasFoot && mine.heads.length === 3,
  `页面结构是重构后的样子（hero/只读信息格/两栏网格/页脚都在，三个区块标题：${mine.heads.join(' / ')}）`);

/* ---------------- ④ 已登录 + 后端不可达：详细报错块，不跳转、不空白 ---------------- */
console.log('\n【④ 已登录但后端不可达：留在本页 + 账号卡下方给出详细报错块】');
await setDeadApi(true);
await page.goto(WEB + '/mine.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const d = document.querySelector('[data-role="detail"]');
  return d && d.hidden === false && d.textContent.length > 40;
}, { timeout: 12000 }).catch(() => {});
await wait(300);
const dead = await page.evaluate(() => {
  const d = document.querySelector('[data-role="detail"]');
  return {
    path: location.pathname,
    conn: (document.querySelector('[data-role="conn"]') || {}).textContent || '',
    detail: d ? d.textContent : '',
    visible: d ? d.getClientRects().length > 0 : false,
    hasPanel: !!document.querySelector('[data-role="accountCard"]'),
    glyphs: document.querySelectorAll('[data-role="glyphs"] [data-glyph]').length,
    sceneState: (document.querySelector('[data-role="sceneState"]') || {}).textContent || '',
  };
});
ok(dead.path === '/mine.html', `后端不可达**不会**被当成"未登录"打发走（实测仍在 ${dead.path}）`);
ok(dead.hasPanel && dead.glyphs === 12, '整页结构照样渲染出来（不是空白页：面板在、12 个内置符号都在）');
ok(dead.conn.includes('未连接'), `状态行如实写"未连接"（实测"${dead.conn}"）`);
ok(dead.visible && dead.detail.length > 40, `详细报错块**真的显示出来**了（共 ${dead.detail.length} 字，不是"失败"两个字）`);
ok(dead.detail.includes(DEAD_BASE), '报错里写明**连不上的地址**');
ok(dead.detail.includes('BACKEND_UNREACHABLE'), '报错里带着 code（BACKEND_UNREACHABLE）');
ok(dead.detail.includes('start:api'), '报错里给出**怎么办**（怎么起后端）');
ok(dead.sceneState === '读取失败' || dead.sceneState === '未登录', `云端场景区也如实反映读不到（状态行"${dead.sceneState}"）`);
await page.keyboard.press('Escape');                 // 关掉自研报错弹窗（它只是"知道了"）
await setDeadApi(false);
await wait(200);

/* ---------------- ⑤ 云端场景：空态 → 有数据 → 重命名 / 删除都走自研弹窗 ---------------- */
console.log('\n【⑤ 云端场景：列出来 → 重命名 → 删除（全部走 src/dialog.js 的自研弹窗）】');
const sceneNames = ['双曲线与渐近线', '单位圆上的三角函数', '抛物线焦点弦'];
for (const [i, name] of sceneNames.entries()) {
  const r = await apiSend('/scenes', 'POST', { name, data: { entities: [], cam: { x: 0, y: 0, z: 50 } }, id: 'mine-check-' + i });
  if (!(r && r.ok)) bad.push(`测试场景 ${name} 没造出来：${JSON.stringify(r)}`);
}
await page.goto(WEB + '/mine.html', { waitUntil: 'networkidle0' });
await page.waitForFunction((n) => document.querySelectorAll('[data-role="scenes"] .mineRow').length === n, { timeout: 12000 }, sceneNames.length).catch(() => {});
const listed = await page.evaluate(() => ({
  state: (document.querySelector('[data-role="sceneState"]') || {}).textContent || '',
  rows: [...document.querySelectorAll('[data-role="scenes"] .mineRow')].map((r) => ({
    id: r.dataset.id, name: (r.querySelector('.mineRowName') || {}).textContent || '',
    meta: (r.querySelector('.mineRowMeta') || {}).textContent || '',
    acts: [...r.querySelectorAll('button[data-act]')].map((b) => b.dataset.act),
  })),
}));
ok(listed.rows.length === sceneNames.length, `有数据时按行列出（实测 ${listed.rows.length} 行：${listed.rows.map((r) => r.name).join(' / ')}）`);
ok(sceneNames.every((n) => listed.rows.some((r) => r.name === n)), '每行的场景名与后端一致');
ok(listed.rows.every((r) => /·/.test(r.meta) && /B|KB|MB/.test(r.meta)), `每行都有"时间 · 体积"元信息（实测"${listed.rows[0].meta}"）`);
ok(listed.rows.every((r) => r.acts.join(',') === 'rename,del'), '每行都有「重命名」「删除」两个按钮');

// ⑤-1 重命名：自研输入弹窗（预填当前名字）→ 改完落库
const target = listed.rows[0];
const newName = '改名后的场景' + Date.now().toString().slice(-4);
await page.click(`[data-role="scenes"] .mineRow[data-id="${target.id}"] button[data-act="rename"]`);
await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
const rnDlg = await page.evaluate(() => {
  const input = document.querySelector('#iwDialogFields [data-field-input]');
  return {
    open: !!document.querySelector('#iwDialogRoot') && document.querySelector('#iwDialogRoot').hidden === false,
    title: (document.querySelector('#iwDialogTitle') || {}).textContent || '',
    value: input ? input.value : null,
    role: (document.querySelector('#iwDialogCard') || {}).getAttribute ? document.querySelector('#iwDialogCard').getAttribute('role') : '',
  };
});
ok(rnDlg.open && rnDlg.value === target.name, `点「重命名」弹出**自研**输入弹窗并预填原名（标题"${rnDlg.title}"，role=${rnDlg.role}，预填"${rnDlg.value}"）`);
// 全选后重打：弹窗是"改一个已有的名字"，真人也是这么干的（★ 不要用 clickCount:3 —— 实测它不会
// 触发浏览器的三击全选，结果是**追加**而不是替换，断言会以"名字被拼长"这种奇怪的方式失败）
await page.focus('#iwDialogFields [data-field-input]');
await page.keyboard.down('Control');
await page.keyboard.press('KeyA');
await page.keyboard.up('Control');
await page.keyboard.type(newName);
const typed = await page.$eval('#iwDialogFields [data-field-input]', (el) => el.value);
ok(typed === newName, `弹窗里输入框的内容被**替换**成新名字（实测"${typed}"）`);
await page.click('#iwDialogOk');
await page.waitForFunction((n) => [...document.querySelectorAll('[data-role="scenes"] .mineRowName')].some((e) => e.textContent === n), { timeout: 8000 }, newName).catch(() => {});
const afterRename = await page.evaluate(() => [...document.querySelectorAll('[data-role="scenes"] .mineRowName')].map((e) => e.textContent));
const backendAfterRename = await apiGet('/scenes');
ok(afterRename.includes(newName), `界面上出现新名字（实测列表：${afterRename.join(' / ')}）`);
ok(!!(backendAfterRename && (backendAfterRename.scenes || []).some((s) => s.id === target.id && s.name === newName)),
  '后端 GET /scenes 里那条场景的名字也变了（不是只改了个界面）');

// ⑤-2 删除：自研确认框；先点「取消」→ 后端仍在；再点「删除」→ 后端真没了
const delSel = `[data-role="scenes"] .mineRow[data-id="${target.id}"] button[data-act="del"]`;
await page.click(delSel);
await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
const delDlg = await page.evaluate(() => {
  const card = document.querySelector('#iwDialogCard');
  const cancel = document.querySelector('#iwDialogCancel');
  return {
    open: !!document.querySelector('#iwDialogRoot') && document.querySelector('#iwDialogRoot').hidden === false,
    title: (document.querySelector('#iwDialogTitle') || {}).textContent || '',
    body: (document.querySelector('#iwDialogBody') || {}).textContent || '',
    tone: card ? card.getAttribute('data-tone') : '',
    hasCancel: cancel ? cancel.hidden === false : false,
  };
});
ok(delDlg.open && delDlg.hasCancel && delDlg.tone === 'danger' && /删除/.test(delDlg.title),
  `点「删除」弹出两个按钮的自研确认框并标成危险色（标题"${delDlg.title}"，正文"${delDlg.body}"，data-tone=${delDlg.tone}）`);
await page.click('#iwDialogCancel');
await wait(400);
const afterCancel = await apiGet('/scenes');
const stillThere = await page.evaluate((id) => !!document.querySelector(`[data-role="scenes"] .mineRow[data-id="${id}"]`), target.id);
ok(stillThere && !!(afterCancel && (afterCancel.scenes || []).some((s) => s.id === target.id)),
  '点「取消」真的什么都不做（界面与后端那条场景都还在）');
await page.click(delSel);
await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
await page.click('#iwDialogOk');
await page.waitForFunction((id) => !document.querySelector(`[data-role="scenes"] .mineRow[data-id="${id}"]`), { timeout: 8000 }, target.id).catch(() => {});
const afterDelete = await apiGet('/scenes');
ok(!(afterDelete && (afterDelete.scenes || []).some((s) => s.id === target.id)),
  `确认删除后后端那条场景真的没了（剩 ${afterDelete && afterDelete.scenes ? afterDelete.scenes.length : '?'} 条）`);
const rowsLeft = await page.evaluate(() => document.querySelectorAll('[data-role="scenes"] .mineRow').length);
ok(rowsLeft === sceneNames.length - 1, `列表跟着刷新（实测剩 ${rowsLeft} 行）`);

/* ---------------- ⑥ 头像：点符号 / 点色板 → 立刻写进后端 ---------------- */
console.log('\n【⑥ 头像：内置符号与主题色点选后写进后端（GET /api/v1/me 的 avatar 变化）】');
const av0 = await apiGet('/me');
const avatar0 = (av0 && av0.user && av0.user.avatar) || '';
const pick = await page.evaluate(() => {
  const on = document.querySelector('[data-role="glyphs"] [data-state="on"]');
  const all = [...document.querySelectorAll('[data-role="glyphs"] [data-glyph]')];
  const t = all.find((b) => b !== on) || all[0];
  t.click();
  return { glyph: t.dataset.glyph, prev: on ? on.dataset.glyph : null };
});
const pollAvatar = async (pred, ms = 10000) => {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    const r = await apiGet('/me');
    last = (r && r.user && r.user.avatar) || '';
    if (pred(last)) return last;
    await wait(250);
  }
  return last;
};
// ★ 等**页面自己**把这一步落定（选中态跟上 + 状态行不再是"保存中…"）再点下一个控件。
//   为什么必须等：pollAvatar 轮询的是**后端**（Node 侧另开一条连接），后端写完的那一刻，
//   页面可能还没处理 PATCH 的响应 —— 此时立刻点色板，产品会拿"页面里还没更新的旧头像"去拼请求体。
//   真人是看着界面变的（状态行"保存中…"→"已保存到云端"、选中框换过去）才点下一个，所以这里
//   补上的正是"人眼确认"这一步。这条竞态实测红过一次（verify 第 5 步）：点符号「⟡」之后
//   立刻点 #5E5CE6，后端被写成 "∑|#5E5CE6" —— ⟡ 被用户名派生的默认符号盖了回去。
//   ★ 断言一条都没放宽：写没写进后端仍然由 pollAvatar 直查 GET /me 判定，这里只是别抢跑。
const waitPageSynced = (want) => page.waitForFunction((w) => {
  const st = document.querySelector('[data-role="avatarState"]');
  if (!st || /保存中/.test(st.textContent)) return false;
  const gOn = document.querySelector('[data-role="glyphs"] [data-state="on"]');
  const cOn = document.querySelector('[data-role="colors"] [data-state="on"]');
  if (w.glyph && (!gOn || gOn.dataset.glyph !== w.glyph)) return false;
  if (w.color && (!cOn || cOn.dataset.color !== w.color)) return false;
  return true;
}, { timeout: 12000 }, want).catch(() => {});
const avatar1 = await pollAvatar((a) => a.startsWith(pick.glyph + '|'));
ok(avatar1.startsWith(pick.glyph + '|') && avatar1 !== avatar0,
  `点符号「${pick.glyph}」（原来 ${pick.prev || '无'}）→ 后端 avatar 变成 "${avatar1}"（原 "${avatar0 || '空'}"）`);
const color0 = avatar1.split('|')[1] || '';
await waitPageSynced({ glyph: pick.glyph, color: color0 });          // 页面确认"符号那一步"已落定，再点颜色
const pickC = await page.evaluate(() => {
  const on = document.querySelector('[data-role="colors"] [data-state="on"]');
  const all = [...document.querySelectorAll('[data-role="colors"] [data-color]')];
  const t = all.find((b) => b !== on) || all[0];
  t.click();
  return { color: t.dataset.color };
});
const avatar2 = await pollAvatar((a) => a.endsWith('|' + pickC.color));
ok(avatar2 === pick.glyph + '|' + pickC.color,
  `点主题色 ${pickC.color}（原 ${color0}）→ 后端 avatar 变成 "${avatar2}"：符号保留、只换颜色`);
await waitPageSynced({ glyph: pick.glyph, color: pickC.color });     // 界面也落到"已保存"再读选中态
const uiAfter = await page.evaluate(() => ({
  glyphOn: document.querySelectorAll('[data-role="glyphs"] [data-state="on"]').length,
  colorOn: document.querySelectorAll('[data-role="colors"] [data-state="on"]').length,
  onGlyph: (document.querySelector('[data-role="glyphs"] [data-state="on"]') || {}).dataset ? document.querySelector('[data-role="glyphs"] [data-state="on"]').dataset.glyph : '',
  onColor: (document.querySelector('[data-role="colors"] [data-state="on"]') || {}).dataset ? document.querySelector('[data-role="colors"] [data-state="on"]').dataset.color : '',
  heroColor: (document.querySelector('[data-role="avatar"]').style.getPropertyValue('--c') || '').trim(),
  heroGlyph: document.querySelector('[data-role="avatar"] [data-paint="glyph"]').textContent,
  state: (document.querySelector('[data-role="avatarState"]') || {}).textContent || '',
}));
ok(uiAfter.glyphOn === 1 && uiAfter.colorOn === 1 && uiAfter.onGlyph === pick.glyph && uiAfter.onColor === pickC.color,
  `界面上的选中态与刚点的保持一致（符号 ${uiAfter.onGlyph} / 颜色 ${uiAfter.onColor}，各只有 1 个选中）`);
ok(uiAfter.heroColor.toLowerCase() === pickC.color.toLowerCase() && uiAfter.heroGlyph === pick.glyph,
  `账号卡上的大头像立刻跟着变（底色 ${uiAfter.heroColor}、符号「${uiAfter.heroGlyph}」；状态行"${uiAfter.state}"）`);

/* ---------------- ⑦ 零原生弹窗 / 零运行时错误 ---------------- */
console.log('\n【⑦ 原生弹窗零触发 / 页面无 JS 运行时错误】');
const nativeAll = await page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('iw.test.native') || '[]'); } catch { return []; } });
ok(nativeAll.length === 0, `全程没有触发原生 alert/confirm/prompt（页内探针跨导航累计 ${nativeAll.length}${nativeAll.length ? '：' + nativeAll.join(' | ') : ''}）`);
ok(nativeEvents.length === 0, `puppeteer 的 dialog 兜底网也是 0（${nativeEvents.join(' | ') || '无'}）`);
ok(pageErrors.length === 0, `「我的」页没有 JS 运行时错误${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' | ') : ''}`);

await mkdir(join(APP, 'tests', 'artifacts'), { recursive: true });
await page.screenshot({ path: join(APP, 'tests', 'artifacts', 'mine-page.png') });

/* ---------------- ⑧ 窄屏：不横向溢出 ---------------- */
console.log('\n【⑧ 窄屏（390×844）不横向溢出】');
await page.setViewport({ width: 390, height: 844 });
await page.goto(WEB + '/mine.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('[data-role="accountCard"]'), { timeout: 8000 }).catch(() => {});
await wait(600);
const narrow = await page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const over = [...document.querySelectorAll('body *')]
    .filter((e) => e.getBoundingClientRect().right > cw + 1)
    .map((e) => (typeof e.className === 'string' && e.className ? e.className : e.tagName) + '@' + Math.round(e.getBoundingClientRect().right));
  return {
    docScroll: document.documentElement.scrollWidth, docClient: cw,
    bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth,
    over: over.slice(0, 8), overCount: over.length,
    gridCols: getComputedStyle(document.querySelector('.mineGrid')).gridTemplateColumns,
    kvCols: getComputedStyle(document.querySelector('.mineKvBox')).gridTemplateColumns,
    panel: !!document.querySelector('[data-role="accountCard"]'),
  };
});
ok(narrow.docScroll === narrow.docClient, `文档不横向溢出（scrollWidth ${narrow.docScroll} == clientWidth ${narrow.docClient}）`);
ok(narrow.bodyScroll === narrow.bodyClient, `body 也不横向溢出（scrollWidth ${narrow.bodyScroll} == clientWidth ${narrow.bodyClient}）`);
ok(narrow.overCount === 0, `没有任何元素越过视口右边界（越界元素 ${narrow.overCount} 个${narrow.overCount ? '：' + narrow.over.join(', ') : ''}）`);
ok(narrow.panel && !narrow.gridCols.includes(' ') && !narrow.kvCols.includes(' '),
  `窄屏下两栏与三格都落成一列（网格实测 "${narrow.gridCols}"，只读信息格 "${narrow.kvCols}"），页面仍然完整`);
await page.setViewport({ width: 1440, height: 1000 });

/* ---------------- 收尾 ---------------- */
await browser.close();
stopAll();
await wait(250);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) {
  console.log('\n❌ 未通过：');
  for (const x of bad) console.log('   - ' + x);
  process.exit(1);
}
console.log('\n✅ 通过：「我的」是独立页面（未登录直接跳登录页 / 设置页里已经没有它、入口在画布导航栏「设置」旁边 /'
  + ' 账号信息只读且与后端一致 / 后端不可达给详细报错 / 云端场景与头像都真的写进后端 /'
  + ' 弹窗全走自研 / 无运行时错误 / 窄屏不横向溢出）');
