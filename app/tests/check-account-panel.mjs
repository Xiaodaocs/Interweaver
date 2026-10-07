// 「我的」面板验收（设置页的「我的」分类）
//
// ★ 本文件测的是**新行为**。用户要求：把"登录"从设置页删掉（登录/注册是独立页面 login.html 的事），
//   并在设置里**新增「我的」**（改用户名 / 头像 / 云端场景 / 退出登录）。
//   原来那段"设置页内嵌登录表单 → 界面注册 → 已注册并登录 → 自动导入"的断言，测的是**已经被删掉的功能**，
//   所以这里整段改写：不放宽、不跳过、也不从 verify 链里摘掉。
//
// 断言清单（逐条对应新行为）：
//   ① 反向断言：设置页**每个**分类下都不存在账号/密码输入框，也没有登录/注册按钮；
//   ② 正向断言：存在指向独立登录页的入口（a[href*=login.html]），而且那个地址真的打得开；
//   ③ 登录态：未登录 → 明确说明；已登录 → **只读**的用户名 / 身份 / 注册时间（与后端返回逐字一致）；
//   ④ 后端不可达 → 账号区域把**详细报错**贴出来（连不上的地址 + code + 怎么办），不是空白、不是静默失败；
//   ⑤ 切换设置分类 → 面板**复用同一节点**（标记还在、只有一份、不重复探测后端）；
//   ⑥ 需要确认/输入的地方走 src/dialog.js（原生 alert/confirm/prompt 零触发：页内探针 + puppeteer 兜底网双重计数）。
//
// 跑法：cd app && node iw-cli.mjs start && node tests/check-account-panel.mjs
import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

/* ---------- 现生成一张真 PNG（零依赖：自己拼 PNG 块 + 自写 CRC32）----------
   用来测「头像支持本地上传」：仓库里不放二进制样本，测试用的图**当场生成**。
   故意做成非正方形（240×180），这样才能验证"短边居中裁剪"真的发生了。 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function makePng(w, h, fill = (x, y) => [(x * 37) & 255, (y * 53) & 255, 128]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                                        // 每行的 filter type = 0（None）
    for (let x = 0; x < w; x++) { const [r, g, b] = fill(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;    // 8bit / truecolor / deflate / 无隔行
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),      // PNG 魔数
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const APP = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'http://localhost:5188';
const API_PORT = 5298;                              // 本检查自带的测试后端（与共用的 5189 互不干扰）
const API_BASE = `http://localhost:${API_PORT}`;
const DEAD_BASE = 'http://localhost:5398';          // 故意指向一个没人监听的端口
const TMP = join(APP, 'data', 'test-acc');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };
const warn = (msg) => console.log('  ! ' + msg);

/* ---------------- 0. 测试后端：独立端口 + 独立临时库 ---------------- */
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: {
    ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'acc.db'),
    // 日志也落在临时目录：不动仓库里的 data/api.log、data/events.log（别的检查可能同时在读）
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

/* ---------------- 1. 前端静态服务：没起就自己起（只关自己起的那个） ---------------- */
const webAlive = async () => { try { const r = await fetch(WEB + '/settings.html'); return r.ok; } catch { return false; } };
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

/* ---------------- 2. 浏览器 ---------------- */
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// 兜底网：真有原生弹窗冒出来，记录下来并立刻 dismiss（否则用例会卡死）
const nativeEvents = [];
page.on('dialog', async (d) => {
  nativeEvents.push(d.type() + '：' + d.message().slice(0, 60));
  try { await d.dismiss(); } catch { /* 已经关了 */ }
});
// ★ 必须在**页面自己的脚本执行之前**注入 API 基址：面板在页面加载时就会探测一次后端，
//   注入晚了它就用默认的 5189（本检查的测试后端不在那个端口），状态会错误地显示"未连接"。
//   同一处顺便装"原生弹窗探针"：三个原生函数换成记录器（返回值取安全默认）。
await page.evaluateOnNewDocument(([base]) => {
  globalThis.__IW_API_BASE__ = base;
  window.__nativeCalls = [];
  window.alert = function (m) { window.__nativeCalls.push('alert:' + String(m).slice(0, 80)); return undefined; };
  window.confirm = function (m) { window.__nativeCalls.push('confirm:' + String(m).slice(0, 80)); return false; };
  window.prompt = function (m) { window.__nativeCalls.push('prompt:' + String(m).slice(0, 80)); return null; };
}, [API_BASE]);

await page.goto(WEB + '/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());     // 干净起点：没有 token、没有旧偏好

// 页面内小工具：按 data-goto 点分类（render() 会整批重建导航，所以每次重新查询，不用 elementHandle）
await page.evaluate(() => {
  // 扫"设置页里不该有的登录痕迹"：只要 DOM 里有就算命中（隐藏的也算 —— 用户要的是"删掉"）
  window.__scanLoginForm = () => {
    const forbid = ['[data-role="user"]', '[data-role="pass"]', '[data-role="register"]', '[data-role="login"]',
      'input[type="password"]', 'input[name="username"]', 'input[name="password"]'];
    const btnText = ['登录', '注册', '登录/注册', '注册/登录', '立即登录', '立即注册', '登录账号', '注册账号', '注册并登录', '登录并注册'];
    const hits = [];
    for (const sel of forbid) { const n = document.querySelectorAll(sel).length; if (n) hits.push(sel + ' ×' + n); }
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim();
      if (btnText.includes(t)) hits.push('登录/注册按钮「' + t + '」');
    }
    return hits;
  };
});
const catList = () => page.evaluate(() => [...document.querySelectorAll('[data-goto]')].map((b) => ({ id: b.dataset.goto, label: (b.textContent || '').trim() })));
async function gotoCat(id) {
  const i = await page.evaluate((id) => [...document.querySelectorAll('[data-goto]')].findIndex((b) => b.dataset.goto === id), id);
  if (i < 0) { ok(false, `设置页左栏里找不到分类 ${id}（导航结构变了？）`); return false; }
  await page.evaluate((i) => document.querySelectorAll('[data-goto]')[i].click(), i);
  await wait(420);
  return true;
}

/* ---------------- ① 反向断言：设置页里没有内嵌登录表单 ---------------- */
console.log('\n【① 设置页里没有账号/密码输入框，也没有登录/注册按钮】');
const groups = await catList();
ok(groups.length >= 2 && groups.some((g) => g.id === 'mine'),
  `左栏分类含「我的」（实测 ${groups.length} 个：${groups.map((g) => g.label).join(' / ')}）`);
{
  const hitsAll = [];
  for (const g of groups) {
    if (!(await gotoCat(g.id))) continue;
    const hits = await page.evaluate(() => window.__scanLoginForm());
    if (hits.length) hitsAll.push(`「${g.label}」→ ${hits.join('、')}`);
  }
  ok(hitsAll.length === 0, `每个分类下都没有账号/密码输入框、没有登录/注册按钮`
    + `（实测：${hitsAll.length ? hitsAll.join(' ｜ ') : '一处也没有'}）`);
}
const otherId = (groups.find((g) => g.id !== 'mine') || {}).id || 'general';

/* ---------------- ② 指向独立登录页的入口 ---------------- */
console.log('\n【② 设置页里有指向独立登录页的入口】');
await gotoCat('mine');
const entry = await page.evaluate(() => {
  const a = document.querySelector('a[href*="login.html"]');
  if (!a) return { found: false };
  const u = new URL(a.getAttribute('href'), location.href);
  return {
    found: true, href: u.href, path: u.pathname, text: (a.textContent || '').trim(),
    visible: a.getClientRects().length > 0, hidden: a.hidden,
  };
});
ok(entry.found && entry.path === '/login.html', `入口指向独立登录页（实测 ${entry.found ? entry.href : '没找到 a[href*=login.html]'}）`);
ok(entry.found && entry.visible && !entry.hidden, `入口是**看得见、点得到**的：「${String(entry.text).slice(0, 40)}」`);
const loginPage = await fetch(WEB + '/login.html').then((r) => ({ ok: r.ok, status: r.status })).catch((e) => ({ ok: false, status: String(e.message) }));
ok(loginPage.ok, `那个地址确实打得开（GET /login.html → ${loginPage.status}）`);

/* ---------------- ③（未登录）「我的」如实显示未登录 ---------------- */
console.log('\n【③-未登录 「我的」给出明确说明，不假装已登录】');
await page.waitForFunction(() => /后端(已|未)连接/.test((document.querySelector('#setWrap [data-role="conn"]') || {}).textContent || ''), { timeout: 8000 }).catch(() => {});
const guest = await page.evaluate(() => {
  const q = (r) => document.querySelector('#setWrap [data-role="' + r + '"]');
  const card = q('accountCard');
  return {
    conn: (q('conn') || {}).textContent || '',
    who: (q('who') || {}).textContent || '',
    kvName: (q('kvName') || {}).textContent || '',
    kvRole: (q('kvRole') || {}).textContent || '',
    kvCreated: (q('kvCreated') || {}).textContent || '',
    note: (q('note') || {}).textContent || '',
    sceneState: (q('sceneState') || {}).textContent || '',
    scenes: (q('scenes') || {}).textContent || '',
    inputs: card ? card.querySelectorAll('input, textarea, select').length : -1,
    renameDisabled: !!(q('rename') || {}).disabled,
    logoutDisabled: !!(q('logout') || {}).disabled,
    cards: document.querySelectorAll('#setWrap [data-role="accountCard"]').length,
  };
});
ok(guest.conn.includes('后端已连接'), `后端在时状态行显示"已连接"（实测"${guest.conn}"）`);
ok(guest.who === '未登录' && guest.kvName === '未登录', `未登录时明确写"未登录"（who="${guest.who}"，用户名="${guest.kvName}"）`);
ok(guest.kvRole === '—' && guest.kvCreated === '—', '未登录时身份/注册时间留空位 —— 不编造账号信息');
ok(guest.note.length > 8 && /未登录|本机/.test(guest.note), `未登录时有一段明确说明：「${guest.note.slice(0, 42)}…」`);
ok(guest.inputs === 0, `账号卡里**一个输入控件都没有**（只读：input/textarea/select 合计 ${guest.inputs} 个）`);
ok(guest.renameDisabled && guest.logoutDisabled, '未登录时「更改用户名」「退出登录」都是禁用的（不假装能改）');
ok(guest.sceneState === '未登录' && guest.scenes.includes('未登录'), `云端场景区同样说明"未登录"（状态行"${guest.sceneState}"）`);
ok(guest.cards === 1, `「我的」里只有一份面板（实测 ${guest.cards} 份）`);

/* ---------------- ⑤ 切分类：复用同一节点、不重复探测 ---------------- */
console.log('\n【⑤ 切换设置分类：复用同一节点，不重建、不重复探测】');
const marked = await page.evaluate(() => {
  const card = document.querySelector('#setWrap [data-role="accountCard"]');
  const wrap = card && card.parentElement;              // 面板根节点（settingsMain 跨 render 复用的就是它）
  if (!wrap) return false;
  wrap.__iwPanelMark = 'mine-1';                        // expando：只活在 JS 里，不进 DOM、不碰类契约
  window.__healthHits = 0;                              // 被重建的面板会重新 probe 一次后端 → 计数会 > 0
  const orig = window.fetch;
  window.fetch = function (...a) {
    const u = String((a[0] && a[0].url) || a[0] || '');
    if (u.includes('/api/v1/health')) window.__healthHits++;
    return orig.apply(this, a);
  };
  return true;
});
ok(marked, '拿到「我的」面板根节点（用它验"还是不是同一个节点"）');
await gotoCat(otherId);
const away = await page.evaluate(() => document.querySelectorAll('#setWrap [data-role="accountCard"]').length);
ok(away === 0, `切到别的分类时「我的」面板不显示（实测 ${away} 份）`);
await gotoCat('mine');
const back = await page.evaluate(() => {
  const card = document.querySelector('#setWrap [data-role="accountCard"]');
  return {
    count: document.querySelectorAll('#setWrap [data-role="accountCard"]').length,
    mark: card && card.parentElement ? (card.parentElement.__iwPanelMark || '') : '',
    health: window.__healthHits,
  };
});
ok(back.count === 1, `切回来仍然只有一份面板（实测 ${back.count} 份 —— 不叠罗汉）`);
ok(back.mark === 'mine-1', '切回来是**同一个节点**（切换前打的标记还在，说明面板没被重建）');
ok(back.health === 0, `切换分类**没有重复探测后端**（期间 /health 请求 ${back.health} 次）`);

/* ---------------- ④ 后端不可达：账号区域给出详细报错 ---------------- */
console.log('\n【④ 后端不可达：账号区域给出详细报错】');
await gotoCat(otherId);                                  // 在别的分类下挂一份临时面板（连死端口）
const dead = await page.evaluate(async ([dbase, live]) => {
  globalThis.__IW_API_BASE__ = dbase;                    // 指向没人监听的端口
  const { createMinePanel } = await import('/src/accountPanel.js?dead=1');
  const host = document.createElement('div');
  host.id = 'iwDeadHost';
  document.body.appendChild(host);
  createMinePanel({ mount: host });
  await new Promise((r) => setTimeout(r, 1600));         // 探测 + 渲染（连不上是立刻失败的）
  const el = host.querySelector('[data-role="detail"]');
  const out = {
    hasPanel: !!host.querySelector('[data-role="accountCard"]'),
    state: (host.querySelector('[data-role="conn"]') || {}).textContent || '',
    detail: el ? el.textContent : '',
    hidden: el ? el.hidden : null,
    visible: el ? el.getClientRects().length > 0 : false,
    who: (host.querySelector('[data-role="who"]') || {}).textContent || '',
    dialogOpen: !!document.querySelector('#iwDialogRoot') && document.querySelector('#iwDialogRoot').hidden === false,
  };
  host.remove();                                         // 临时面板不留在页面里（免得影响后面的计数）
  globalThis.__IW_API_BASE__ = live;                     // ★ 恢复真实地址，后面的步骤还要用
  return out;
}, [DEAD_BASE, API_BASE]);
ok(dead.hasPanel, '临时挂载一份面板（地址指向死端口）以验证报错路径');
ok(dead.state.includes('未连接'), `后端不在时状态行显示"未连接"（实测"${dead.state}"）`);
ok(dead.hidden === false && dead.visible && dead.detail.length > 40,
  `详细报错**真的显示出来**了（不是空白、也不是"失败"两个字；共 ${dead.detail.length} 字）`);
ok(dead.detail.includes(DEAD_BASE), '报错里写明**连不上的地址**');
ok(dead.detail.includes('BACKEND_UNREACHABLE'), '报错里带着 code（BACKEND_UNREACHABLE）');
ok(dead.detail.includes('start:api'), '报错里给出**怎么办**（怎么起后端）');
ok(dead.dialogOpen === false, '未登录时后端不可达只写进页内报错块，不会弹个框把界面堵住');
// 恢复正常地址：回到「我的」→ 点「重试连接」→ 面板必须回到"已连接"
await gotoCat('mine');
await page.click('#setWrap [data-role="retry"]');
await page.waitForFunction(() => ((document.querySelector('#setWrap [data-role="conn"]') || {}).textContent || '').includes('已连接'), { timeout: 8000 }).catch(() => {});
const restored = await page.evaluate(() => (document.querySelector('#setWrap [data-role="conn"]') || {}).textContent || '');
ok(restored.includes('已连接'), `地址恢复后点「重试连接」→ 状态回到"已连接"（实测"${restored}"）`);

/* ---------------- ③（已登录）只读的账号信息 ---------------- */
console.log('\n【③-已登录 「我的」显示只读的用户名 / 身份 / 注册时间】');
const reg = await fetch(API_BASE + '/api/v1/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'paneluser', password: 'secret123' }),
});
const rj = await reg.json().catch(() => null);
const token = rj && rj.ok === true ? rj.token : null;
ok(!!token, `测试账号注册成功（HTTP ${reg.status}，用户名 paneluser${token ? '，已拿到 token' : '，**没拿到 token**'}）`);
if (token) {
  await page.evaluate((t) => localStorage.setItem('interweaver.token', t), token);
  await page.reload({ waitUntil: 'networkidle0' });       // 让面板带着凭证重新初始化
  await gotoCat('mine');
  await page.waitForFunction(() => {
    const t = (r) => (document.querySelector('#setWrap [data-role="' + r + '"]') || {}).textContent || '';
    return t('kvName') === 'paneluser' && !/检测中|读取中/.test(t('sceneState'));
  }, { timeout: 10000 }).catch(() => {});
  const mine = await page.evaluate(() => {
    const q = (r) => document.querySelector('#setWrap [data-role="' + r + '"]');
    const card = q('accountCard');
    return {
      conn: (q('conn') || {}).textContent || '',
      who: (q('who') || {}).textContent || '',
      kvName: (q('kvName') || {}).textContent || '',
      kvRole: (q('kvRole') || {}).textContent || '',
      kvCreated: (q('kvCreated') || {}).textContent || '',
      tags: ['kvName', 'kvRole', 'kvCreated'].map((r) => ((q(r) || {}).tagName || '?')),
      inputs: card ? card.querySelectorAll('input, textarea, select').length : -1,
      renameDisabled: !!(q('rename') || {}).disabled,
      logoutDisabled: !!(q('logout') || {}).disabled,
      note: (q('note') || {}).textContent || '',
      glyphs: document.querySelectorAll('#setWrap [data-role="glyphs"] [data-glyph]').length,
      colors: document.querySelectorAll('#setWrap [data-role="colors"] [data-color]').length,
      glyphOn: document.querySelectorAll('#setWrap [data-role="glyphs"] [data-state="on"]').length,
      colorOn: document.querySelectorAll('#setWrap [data-role="colors"] [data-state="on"]').length,
      avatarState: (q('avatarState') || {}).textContent || '',
      sceneState: (q('sceneState') || {}).textContent || '',
      scenes: (q('scenes') || {}).textContent || '',
      cards: document.querySelectorAll('#setWrap [data-role="accountCard"]').length,
    };
  });
  // 期望值从后端返回里**算**出来（不写死："管理员/普通用户"和注册时间都以后端为准）
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ts) => {
    const d = new Date(Number(ts));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const wantRole = rj.user && rj.user.isAdmin ? '管理员' : '普通用户';
  const wantTime = fmtTime(rj.user && rj.user.createdAt);
  ok(mine.conn.includes('后端已连接'), `已登录时状态行仍是"已连接"（实测"${mine.conn}"）`);
  ok(mine.who === 'paneluser' && mine.kvName === 'paneluser', `显示当前用户名（who="${mine.who}"，用户名="${mine.kvName}"）`);
  ok(mine.kvRole === wantRole, `显示身份且与后端一致（实测"${mine.kvRole}"，后端 isAdmin=${!!(rj.user && rj.user.isAdmin)}）`);
  ok(mine.kvCreated === wantTime, `显示注册时间且与后端一致（实测"${mine.kvCreated}"，期望"${wantTime}"）`);
  ok(mine.tags.every((t) => t === 'SPAN'), `三行账号信息都是**只读文本**（标签实测 ${mine.tags.join('/')}，不是输入框）`);
  ok(mine.inputs === 0, `账号卡里没有任何可编辑控件（input/textarea/select 合计 ${mine.inputs} 个）`);
  ok(!mine.renameDisabled && !mine.logoutDisabled, '已登录时「更改用户名」「退出登录」可用（未登录时它们是灰的）');
  ok(/退出登录|数据/.test(mine.note), `已登录时的说明换成"退出登录"的口径：「${mine.note.slice(0, 42)}…」`);
  ok(mine.glyphs === 12 && mine.colors === 8, `头像选项：内置符号 ${mine.glyphs} 个 + 主题色 ${mine.colors} 个`);
  ok(mine.glyphOn === 1 && mine.colorOn === 1 && /默认|已保存/.test(mine.avatarState),
    `当前头像被选中（符号 ${mine.glyphOn} 个、颜色 ${mine.colorOn} 个；状态"${mine.avatarState}"）`);
  ok(mine.sceneState === '还没有场景' && mine.scenes.includes('还没有云端场景'),
    `云端场景空态正确（状态行"${mine.sceneState}"，列表"${mine.scenes.slice(0, 24)}…"）`);
  ok(mine.cards === 1, `登录后仍然只有一份面板（实测 ${mine.cards} 份）`);

  /* ---------------- ③b 头像：本地上传（真浏览器里走完整条路）----------------
     用户要求：头像要支持本地上传，内置符号 + 颜色保留为默认值与兜底。
     这里走的是**用户那条路**：喂一个真文件给 <input type="file">（puppeteer 的 uploadFile 会触发
     真实的 change 事件，与手点选图完全同一条代码路径）→ 缩放 → 预览 → 后端存住 → 刷新仍在 → 恢复内置。 */
  console.log('\n【③b 头像支持本地上传：选图 → 缩到 128×128 → 预览 → 存后端 → 刷新仍在 → 恢复内置】');
  const srcPng = join(TMP, 'upload-src.png');
  await writeFile(srcPng, makePng(240, 180));            // 故意非正方形：验证短边居中裁剪
  const entry = await page.evaluate(() => {
    const q = (r) => document.querySelector('#setWrap [data-role="' + r + '"]');
    const file = q('file');
    const box = q('preview');
    return {
      file: !!file, type: file ? file.type : '', accept: file ? (file.getAttribute('accept') || '') : '',
      pickText: ((q('pick') || {}).textContent || '').trim(),
      resetText: ((q('reset') || {}).textContent || '').trim(),
      imgs: box ? box.querySelectorAll('img[data-paint="img"]').length : -1,
      glyphs: box ? box.querySelectorAll('[data-paint="glyph"]').length : -1,
      state: box ? box.dataset.state : '',
      tip: ((q('uploadTip') || {}).textContent || '').trim(),
    };
  });
  ok(entry.file && entry.type === 'file' && /image\/png/.test(entry.accept) && /image\/jpeg/.test(entry.accept) && /image\/webp/.test(entry.accept),
    `头像卡里有 file 输入框，accept 只列 png/jpeg/webp（实测 accept="${entry.accept}"）`);
  ok(/上传/.test(entry.pickText) && /恢复/.test(entry.resetText), `有「${entry.pickText}」与「${entry.resetText}」两个入口`);
  ok(entry.imgs === 1 && entry.glyphs === 1 && entry.state === 'glyph',
    `预览框里两种形态的节点**都在 DOM 里**（图片 ${entry.imgs} 个 / 符号 ${entry.glyphs} 个），当前 data-state="${entry.state}"`);
  ok(/PNG|JPEG|WebP/.test(entry.tip), `上传区写明了支持的格式：「${entry.tip.slice(0, 40)}…」`);

  const fileInput = await page.$('#setWrap [data-role="file"]');
  ok(!!fileInput, '拿到那个隐藏的 file 输入框（「上传图片…」按钮点开的就是它）');
  if (fileInput) {
    await fileInput.uploadFile(srcPng);
    // 预览是**立刻**画的（不等后端）；小头像与状态行是后端确认**之后**才跟上 ——
    // 所以这里分两步等：先等预览出图，再等"保存中…"过去。两段都是产品行为，不是将就。
    await page.waitForFunction(() => {
      const img = document.querySelector('#setWrap [data-role="preview"] img[data-paint="img"]');
      return !!img && img.hidden === false && /^data:image\//.test(img.getAttribute('src') || '');
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => {
      const small = document.querySelector('#setWrap [data-role="avatar"] img[data-paint="img"]');
      const st = (document.querySelector('#setWrap [data-role="avatarState"]') || {}).textContent || '';
      return !!small && small.hidden === false && !/保存中/.test(st);
    }, { timeout: 15000 }).catch(() => {});
  }
  const up = await page.evaluate(() => {
    const box = document.querySelector('#setWrap [data-role="preview"]');
    const img = box && box.querySelector('img[data-paint="img"]');
    const small = document.querySelector('#setWrap [data-role="avatar"] img[data-paint="img"]');
    return {
      state: box ? box.dataset.state : '',
      src: img ? (img.getAttribute('src') || '') : '',
      hidden: img ? img.hidden : null,
      w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0,
      smallIsImg: !!small && small.hidden === false && /^data:image\//.test(small.getAttribute('src') || ''),
      avatarState: ((document.querySelector('#setWrap [data-role="avatarState"]') || {}).textContent || '').trim(),
      tip: ((document.querySelector('#setWrap [data-role="uploadTip"]') || {}).textContent || '').trim(),
    };
  });
  ok(/^data:image\/(webp|png);base64,/.test(up.src),
    `选图后预览立刻出现 <img src="data:image/…">（${up.src.slice(0, 34)}…，共 ${up.src.length} 字符）`);
  ok(up.src.startsWith('data:image/webp;'),
    `浏览器支持 WebP 时编码成 WebP（实测前缀 "${up.src.slice(0, 22)}"，不支持才会退回 PNG）`);
  ok(up.state === 'img' && up.hidden === false, `预览框切到图片形态（data-state="${up.state}"）`);
  ok(up.w === 128 && up.h === 128, `图片在浏览器里被缩到 128×128（实测 ${up.w}×${up.h}；原图是 240×180 的非正方形）`);
  ok(up.smallIsImg, '账号卡里的小头像也换成了这张图（上传与显示是同一条数据）');
  ok(/图片/.test(up.avatarState), `状态行说明这是上传的图片（实测"${up.avatarState}"）`);

  const meAfterUp = await fetch(API_BASE + '/api/v1/me', { headers: { authorization: 'Bearer ' + token } })
    .then((r) => r.json()).catch(() => null);
  const serverAv = (meAfterUp && meAfterUp.user && meAfterUp.user.avatar) || '';
  ok(/^data:image\/(webp|png);base64,/.test(serverAv),
    `后端 GET /me 的 avatar 是 data URL（前 30 字：${serverAv.slice(0, 30)}…，共 ${serverAv.length} 字符）`);
  ok(serverAv === up.src, '后端存的与页面上预览的**逐字相同**（没有二次编码或截断）');

  // 刷新：头像仍是那张图（存在服务器上，不是内存里的临时预览）
  await page.reload({ waitUntil: 'networkidle0' });
  await gotoCat('mine');
  await page.waitForFunction(() => {
    const img = document.querySelector('#setWrap [data-role="preview"] img[data-paint="img"]');
    return !!img && img.hidden === false && /^data:image\//.test(img.getAttribute('src') || '');
  }, { timeout: 12000 }).catch(() => {});
  const reloaded = await page.evaluate(() => {
    const img = document.querySelector('#setWrap [data-role="preview"] img[data-paint="img"]');
    const small = document.querySelector('#setWrap [data-role="avatar"] img[data-paint="img"]');
    return {
      src: img ? (img.getAttribute('src') || '') : '',
      w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0,
      smallIsImg: !!small && small.hidden === false,
    };
  });
  ok(reloaded.src === up.src, '刷新页面后头像仍是那张图（逐字相同的 data URL —— 真存在服务器上）');
  ok(reloaded.w === 128 && reloaded.h === 128 && reloaded.smallIsImg,
    `刷新后仍是 128×128 的图片，小头像也在用（实测 ${reloaded.w}×${reloaded.h}）`);

  // 恢复内置头像：清掉图片，回到"符号 + 颜色"
  await page.click('#setWrap [data-role="reset"]');
  await page.waitForFunction(() => {
    const box = document.querySelector('#setWrap [data-role="preview"]');
    const img = box && box.querySelector('img[data-paint="img"]');
    return !!box && box.dataset.state === 'glyph' && (!img || img.hidden === true);
  }, { timeout: 10000 }).catch(() => {});
  const reset = await page.evaluate(() => {
    const box = document.querySelector('#setWrap [data-role="preview"]');
    const img = box && box.querySelector('img[data-paint="img"]');
    return {
      state: box ? box.dataset.state : '',
      hidden: img ? img.hidden : null,
      glyph: ((box && box.querySelector('[data-paint="glyph"]')) || {}).textContent || '',
      color: box ? (box.style.getPropertyValue('--c') || '').trim() : '',
      glyphOn: document.querySelectorAll('#setWrap [data-role="glyphs"] [data-state="on"]').length,
      colorOn: document.querySelectorAll('#setWrap [data-role="colors"] [data-state="on"]').length,
      tip: ((document.querySelector('#setWrap [data-role="uploadTip"]') || {}).textContent || '').trim(),
    };
  });
  ok(reset.state === 'glyph' && reset.hidden === true,
    `点「恢复内置头像」→ 预览回到符号形态（data-state="${reset.state}"，图片隐藏=${reset.hidden}）`);
  ok(reset.glyphOn === 1 && reset.colorOn === 1,
    `内置符号与颜色重新选中（符号 ${reset.glyphOn} 个、颜色 ${reset.colorOn} 个；实测 "${reset.glyph}" ${reset.color}）`);
  const meAfterReset = await fetch(API_BASE + '/api/v1/me', { headers: { authorization: 'Bearer ' + token } })
    .then((r) => r.json()).catch(() => null);
  const resetAv = (meAfterReset && meAfterReset.user && meAfterReset.user.avatar) || '';
  ok(resetAv === `${reset.glyph}|${reset.color}`,
    `后端 avatar 回到 "符号|#RRGGBB"（实测 ${resetAv} —— 与界面上显示的符号/颜色一致）`);
  ok(/恢复|内置/.test(reset.tip), `上传区说明了刚做的切换：「${reset.tip.slice(0, 40)}…」`);

  /* ---------------- ⑥ 「更改用户名」走自研弹窗（不是原生 prompt） ---------------- */
  console.log('\n【⑥ 「更改用户名」用 src/dialog.js 的输入弹窗】');
  await page.click('#setWrap [data-role="rename"]');
  await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
  const dlgPrompt = await page.evaluate(() => {
    const root = document.querySelector('#iwDialogRoot');
    const input = document.querySelector('#iwDialogFields [data-field-input]');
    return {
      open: !!root && root.hidden === false,
      title: (document.querySelector('#iwDialogTitle') || {}).textContent || '',
      value: input ? input.value : null,
      isInput: !!input,
      role: document.querySelector('#iwDialogCard') ? document.querySelector('#iwDialogCard').getAttribute('role') : '',
      roots: document.querySelectorAll('#iwDialogRoot').length,
    };
  });
  ok(dlgPrompt.open && dlgPrompt.isInput && dlgPrompt.value === 'paneluser',
    `弹出的是项目自研输入弹窗（标题"${dlgPrompt.title}"，role=${dlgPrompt.role}，预填"${dlgPrompt.value}"）`);
  await page.keyboard.press('Escape');
  await wait(250);
  const afterEsc = await page.evaluate(() => ({
    closed: document.querySelector('#iwDialogRoot') ? document.querySelector('#iwDialogRoot').hidden === true : true,
    kvName: (document.querySelector('#setWrap [data-role="kvName"]') || {}).textContent || '',
  }));
  ok(afterEsc.closed && afterEsc.kvName === 'paneluser', 'Esc 取消输入：弹窗关掉、用户名没被改动（取消 ≠ 用空名字覆盖）');
} else {
  ok(false, '拿不到 token —— 「已登录」与「退出登录」相关检查全部无法进行');
}

/* ---------------- ⑥ 退出登录：自研确认框 + 真的回到登录页 ---------------- */
console.log('\n【⑥ 退出登录：自研确认框；确认后回到独立登录页】');
if (token) {
  await page.click('#setWrap [data-role="logout"]');
  await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
  const conf = await page.evaluate(() => {
    const card = document.querySelector('#iwDialogCard');
    return {
      open: !!document.querySelector('#iwDialogRoot') && document.querySelector('#iwDialogRoot').hidden === false,
      title: (document.querySelector('#iwDialogTitle') || {}).textContent || '',
      body: (document.querySelector('#iwDialogBody') || {}).textContent || '',
      ok: (document.querySelector('#iwDialogOk') || {}).textContent || '',
      cancel: (document.querySelector('#iwDialogCancel') || {}).textContent || '',
      haveCancel: document.querySelector('#iwDialogCancel') ? document.querySelector('#iwDialogCancel').hidden === false : false,
      kind: card ? card.getAttribute('data-kind') : '',
    };
  });
  ok(conf.open && conf.haveCancel && /退出登录/.test(conf.title),
    `点「退出登录」弹出**两个按钮**的自研确认框（标题"${conf.title}"，按钮「${conf.cancel} / ${conf.ok}」，data-kind=${conf.kind}）`);
  await page.click('#iwDialogCancel');
  await wait(300);
  const canceled = await page.evaluate(() => ({
    url: location.pathname,
    token: !!localStorage.getItem('interweaver.token'),
    kvName: (document.querySelector('#setWrap [data-role="kvName"]') || {}).textContent || '',
  }));
  ok(canceled.url.includes('settings.html') && canceled.token && canceled.kvName === 'paneluser',
    '点「取消」什么都没发生（仍留在设置页、仍登录、用户名还在）');

  // 原生弹窗与页面报错的计数要在这**最后一次真实交互之前**读（之后会导航去 login.html）
  console.log('\n【⑥ 原生弹窗零触发 / 设置页无运行时错误】');
  const setupErrors = await page.evaluate(() => window.__nativeCalls || []);
  ok(setupErrors.length === 0, `设置页全程没有触发原生 alert/confirm/prompt（页内探针计数 ${setupErrors.length}${setupErrors.length ? '：' + setupErrors.join(' | ') : ''}）`);
  ok(nativeEvents.length === 0, `puppeteer 的 dialog 兜底网也是 0（${nativeEvents.join(' | ') || '无'}）`);
  ok(pageErrors.length === 0, `设置页没有 JS 运行时错误${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' | ') : ''}`);

  await mkdir(join(APP, 'tests', 'artifacts'), { recursive: true });
  await page.screenshot({ path: join(APP, 'tests', 'artifacts', 'account-panel.png') });

  await page.click('#setWrap [data-role="logout"]');
  await page.waitForSelector('#iwDialogRoot:not([hidden])', { timeout: 5000 }).catch(() => {});
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
    page.click('#iwDialogOk'),
  ]);
  await wait(400);
  const out = await page.evaluate(() => ({
    url: location.pathname,
    token: !!localStorage.getItem('interweaver.token'),
    title: document.title,
  }));
  ok(out.url.includes('login.html'), `确认退出后落在**独立登录页**（实测 ${out.url}，标题"${out.title}"）`);
  ok(out.token === false, '退出登录后本地 token 已清掉（不会"退出了还带着凭证"）');
  const lateErrors = pageErrors.slice(3);
  if (lateErrors.length) warn('登录页有 ' + lateErrors.length + ' 条 JS 报错（不属于本检查的范围）：' + lateErrors.slice(0, 2).join(' | '));
} else {
  ok(false, '拿不到 token —— 「退出登录」相关检查无法进行');
}

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
console.log('\n✅ 通过：「我的」面板可用（设置页无内嵌登录表单 / 有独立登录页入口 / 只读账号信息 /'
  + ' 后端不可达时详细报错 / 跨分类复用同一节点 / 确认与输入走 dialog.js）');
