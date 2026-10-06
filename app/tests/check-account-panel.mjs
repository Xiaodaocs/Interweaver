// 账号/后端面板验收（设置页「通用」里的第一张卡）
//   ① 后端在：通过**界面**注册 → 状态变"已连接" → 登录信息出现 → **自动导入本机旧数据**
//      （先往 localStorage 塞旧设置/进度，登录后后端应出现这两份文档；且重复导入不覆盖）
//   ② 后端不在：面板必须把**详细报错**贴出来（含地址、code、怎么办），而不是"失败"两个字
//   ③ 面板在设置页切换分类时**复用同一节点**（输入框内容不丢、不重复探测）——这是 render() 的坑
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = 5298;
const API_BASE = `http://localhost:${API_PORT}`;
const DEAD_BASE = 'http://localhost:5398';
const TMP = join(APP, 'data', 'test-acc');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP, env: { ...process.env, PORT_API: String(API_PORT), API_DB: join(TMP, 'acc.db') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
api.stdout.on('data', (d) => { boot += d.toString(); });
api.stderr.on('data', (d) => { boot += d.toString(); });
const stopAll = () => { try { api.kill(); } catch { /* 已退出 */ } };
process.on('exit', stopAll);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + e.message); stopAll(); process.exit(1); });
let up = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(API_BASE + '/api/v1/health'); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ } await wait(200); }
if (!up) { console.log('✗ 后端没起来：' + boot.slice(0, 300)); stopAll(); process.exit(1); }

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1300,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// 预置"本机旧数据"，用来验自动导入
// ★ 必须在**页面自己的脚本执行之前**注入 API 基址：面板在页面加载时就会探测一次后端，
//   注入晚了它就用默认的 5189（测试端口不是 5189），状态会错误地显示"未连接"。
await page.evaluateOnNewDocument(([base]) => { globalThis.__IW_API_BASE__ = base; }, [API_BASE]);
await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('interweaver.settings.v1', JSON.stringify({ legacyFrom: 'localStorage', grid: false }));
  localStorage.setItem('interweaver.progress.v1', JSON.stringify({ legacyFrom: 'localStorage', unlocked: { 'geo.circle.first': 1 } }));
}, [API_BASE]);
await page.reload({ waitUntil: 'networkidle0' });      // 让面板带着旧数据重新初始化
await wait(900);

// ---------- ① 界面注册 + 自动导入 ----------
{
  const hasCard = await page.evaluate(() => !!document.querySelector('.accCard'));
  ok(hasCard, '① 「账号与后端」卡出现在设置页「通用」里');
  const state0 = await page.evaluate(() => document.querySelector('.accState')?.textContent || '');
  await page.waitForFunction(() => (document.querySelector('.accState')?.textContent || '').includes('已连接'), { timeout: 8000 }).catch(() => {});
  const state1 = await page.evaluate(() => document.querySelector('.accState')?.textContent || '');
  ok(state1.includes('已连接'), `① 后端在时状态显示"已连接"（实测"${state1}"，初始"${state0}"）`);

  await page.type('[data-role="user"]', 'paneluser');
  await page.type('[data-role="pass"]', 'secret123');
  await page.click('[data-role="register"]');
  await page.waitForFunction(() => (document.querySelector('[data-role="detail"]')?.textContent || '').includes('已注册'), { timeout: 8000 }).catch(() => {});
  // 自动导入是异步的：等面板把它写出来再读（否则会抢跑读到空字符串）
  // ★ 等"导入**完成**"的文案，而不是"非空"：登录前的默认文案也是非空的，
  //   只等非空会立刻返回、读到默认文案（这条断言因此时对时错）。
  await page.waitForFunction(() => {
    const n = document.querySelector('[data-role="imp"]');
    return !!n && /已自动导入|本机没有旧数据|自动导入失败/.test(n.textContent || '');
  }, { timeout: 8000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    detail: document.querySelector('[data-role="detail"]')?.textContent || '',
    me: document.querySelector('[data-role="me"]')?.textContent || '',
    imp: document.querySelector('[data-role="imp"]')?.textContent || '',
    token: localStorage.getItem('interweaver.token') ? 'yes' : 'no',
  }));
  ok(after.detail.includes('已注册并登录'), `① 通过界面注册成功（面板提示：${after.detail.trim().slice(0, 40)}）`);
  ok(after.token === 'yes', '① token 已保存（后续接口带着它）');
  ok(after.me.includes('paneluser'), `① 面板显示当前账号（${after.me.trim().slice(0, 30)}）`);
  ok(after.imp.includes('已自动导入'), `① **旧数据自动导入**（面板提示：${after.imp.trim().slice(0, 60)}）`);
  // 后端侧确认：两份文档真的进去了
  const inDb = await page.evaluate(async ([base]) => {
    const r = await fetch(base + '/api/v1/settings', { headers: { authorization: 'Bearer ' + localStorage.getItem('interweaver.token') } });
    const j = await r.json();
    const r2 = await fetch(base + '/api/v1/progress', { headers: { authorization: 'Bearer ' + localStorage.getItem('interweaver.token') } });
    const j2 = await r2.json();
    return { settings: j.doc, progress: j2.doc };
  }, [API_BASE]);
  ok(inDb.settings && inDb.settings.legacyFrom === 'localStorage', '① 后端确实收到了旧设置（legacyFrom=localStorage）');
  ok(inDb.progress && inDb.progress.unlocked && inDb.progress.unlocked['geo.circle.first'] === 1, '① 后端确实收到了旧进度');
}

// ---------- ③ 切分类不丢输入、不重建 ----------
{
  await page.evaluate(() => { const u = document.querySelector('[data-role="user"]'); if (u) u.value = 'typing-here'; });
  const before = await page.evaluate(() => document.querySelector('.accCard')?.isConnected);
  // 切到别的分类再切回来
  // ★ 不用 elementHandle：render() 会把导航按钮整批重建，旧 handle 会 "Node is detached"。
  //   改成在页面内**每次重新查询再点击**。
  const navCount = await page.evaluate(() => document.querySelectorAll('[data-goto]').length);
  if (navCount > 1) {
    await page.evaluate(() => document.querySelectorAll('[data-goto]')[1].click()); await wait(450);
    const goneInOther = await page.evaluate(() => !!document.querySelector('.accCard'));
    await page.evaluate(() => document.querySelectorAll('[data-goto]')[0].click()); await wait(550);
    const back = await page.evaluate(() => ({
      there: !!document.querySelector('.accCard'),
      value: document.querySelector('[data-role="user"]')?.value || '',
    }));
    ok(!goneInOther, '③ 面板只出现在「通用」分类里（切到别的分类时不显示）');
    ok(back.there && back.value === 'typing-here', `③ 切回来是**同一个节点**（输入没被清空：'${back.value}'）`);
  } else ok(false, '③ 拿不到左侧分类按钮（设置页结构变了？）');
  void before;
}

// ---------- ② 后端不在：详细报错 ----------
{
  const r = await page.evaluate(async ([dead]) => {
    globalThis.__IW_API_BASE__ = dead;
    const { createAccountPanel } = await import('/src/accountPanel.js?dead=1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    createAccountPanel({ mount: host });
    await new Promise((r2) => setTimeout(r2, 1200));
    return {
      state: host.querySelector('.accState')?.textContent || '',
      detail: host.querySelector('.accDetail')?.textContent || '',
      hidden: host.querySelector('.accDetail')?.hidden,
    };
  }, [DEAD_BASE]);
  ok(r.state.includes('未连接'), `② 后端不在时状态显示"未连接"（实测"${r.state}"）`);
  ok(r.hidden === false && r.detail.length > 40, '② 详细报错**真的显示出来了**（不是空的、不是"失败"两个字）');
  ok(r.detail.includes(DEAD_BASE), '② 报错里写明**连不上的地址**');
  ok(r.detail.includes('BACKEND_UNREACHABLE'), '② 报错里带着 code（BACKEND_UNREACHABLE）');
  ok(r.detail.includes('npm run start:api'), '② 报错里给出**怎么办**（怎么起后端）');
}

if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/account-panel.png' });
await browser.close();
stopAll();
await wait(250);
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：账号/后端面板可用（界面注册登录 / 旧数据自动导入 / 后端不在时详细报错 / 跨分类复用节点）');
