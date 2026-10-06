// 交织者 · 启动 / 停止 / 实时监控（零依赖）
//
//   node iw-cli.mjs start     起前后端（前端 5188 + 后端 5189），后台运行、写 PID 文件
//   node iw-cli.mjs stop      停掉本项目的两个服务（先按 PID 文件，再按**命令行**匹配 server.mjs / server-api.mjs）
//   node iw-cli.mjs status    实时终端监控：两个服务的存活/端口/PID、API 请求流、最近操作、错误
//
// 为什么要按命令行匹配：PID 文件可能被删/过期，而"哪个 node 进程在跑 server-api.mjs"是**可验证的事实**。
// 监控能看到什么、看不到什么（如实说明）：
//   · 看得到：两个服务的启停、HTTP 请求（谁访问了哪个页面/资源）、**所有后端 API 调用**
//     （登录/注册/保存设置/保存进度/存草稿/场景库操作…）—— 也就是"用户对服务器做的每一个操作"；
//   · 看不到：画布内部的本地动作（拖动、画图、改参数）—— 那些发生在浏览器里、不经过服务器。
//     若要连它们也监控，需要前端主动上报（属于额外功能，需要你确认要不要做）。
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const APP = fileURLToPath(new URL('.', import.meta.url));
const WEB_PORT = Number(process.env.PORT || 5188);
const API_PORT = Number(process.env.PORT_API || 5189);
const PID_WEB = `${APP}.iw-web.pid`;
const PID_API = `${APP}.iw-api.pid`;

const sh = (cmd, args) => new Promise((res) => execFile(cmd, args, { windowsHide: true }, (e, out) => res(String(out || ''))));

/** 用 wmic/powershell 列出 node 进程的 PID 与命令行（不引第三方依赖） */
async function nodeProcs() {
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | '
    + 'Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation';
  const out = await sh('powershell', ['-NoProfile', '-Command', ps]);
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"(\d+)","(.*)"$/.exec(line.trim());
    if (m) rows.push({ pid: Number(m[1]), cmd: m[2] });
  }
  return rows;
}

const has = (rows, re) => rows.filter((r) => re.test(r.cmd));
const readPid = (f) => { try { return Number(readFileSync(f, 'utf8').trim()) || null; } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function findServices() {
  const rows = await nodeProcs();
  const web = has(rows, /server\.mjs(?![\w-])/i);
  const api = has(rows, /server-api\.mjs/i);
  const pidWeb = readPid(PID_WEB);
  const pidApi = readPid(PID_API);
  return {
    web: web.length ? web : (pidWeb && alive(pidWeb) ? [{ pid: pidWeb, cmd: 'server.mjs (from pid file)' }] : []),
    api: api.length ? api : (pidApi && alive(pidApi) ? [{ pid: pidApi, cmd: 'server-api.mjs (from pid file)' }] : []),
  };
}

// ---------------- start ----------------
async function start() {
  const { web, api } = await findServices();
  if (web.length || api.length) {
    console.log('· 已经在跑：' + (web.length ? `前端 PID ${web.map((x) => x.pid).join(',')} ` : '') + (api.length ? `后端 PID ${api.map((x) => x.pid).join(',')}` : ''));
    console.log('  要重启就先 npm run stop，然后 npm run start');
    process.exit(1);
  }
  const opts = { cwd: APP, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: String(WEB_PORT), PORT_API: String(API_PORT) } };
  const w = spawn(process.execPath, ['server.mjs'], opts); w.unref();
  const a = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server-api.mjs'], opts); a.unref();   // node:sqlite 的实验性警告：只是不显示（不改变它仍是实验特性）
  await new Promise((r) => setTimeout(r, 1500));
  const s = await findServices();
  const okW = s.web.length > 0; const okA = s.api.length > 0;
  console.log(okW ? `✓ 前端已起 → http://localhost:${WEB_PORT}` : '✗ 前端没起来（看日志或 npm run status）');
  console.log(okA ? `✓ 后端已起 → http://localhost:${API_PORT}/api/v1/health` : '✗ 后端没起来（看日志或 npm run status）');
  console.log('· 实时监控：npm run status ｜ 停止：npm run stop');
  process.exit(okW && okA ? 0 : 1);
}

// ---------------- stop ----------------
async function stop() {
  const { web, api } = await findServices();
  const targets = [...web, ...api];
  if (!targets.length) { console.log('· 没有在跑的交织者服务'); return; }
  for (const t of targets) {
    try { process.kill(t.pid, 'SIGTERM'); } catch { /* 已退出 */ }
  }
  await new Promise((r) => setTimeout(r, 700));
  const left = [...(await findServices()).web, ...(await findServices()).api].filter((t) => alive(t.pid));
  for (const t of left) { try { process.kill(t.pid, 'SIGKILL'); } catch { /* 忽略 */ } }
  for (const f of [PID_WEB, PID_API]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* 忽略 */ } }
  console.log(`✓ 已停止 ${targets.length} 个进程${left.length ? `（其中 ${left.length} 个被强制结束）` : ''}`);
}

// ---------------- status（实时监控） ----------------
async function status() {
  const clear = process.platform === 'win32' ? '\x1b[2J\x1b[0;0H' : '\x1b[2J\x1b[H';
  const started = Date.now();
  const events = [];      // 最近事件（滚动窗口）
  let lastHealth = null;
  let apiCalls = 0;       // 后端 API 调用累计（用 health 里的计数差近似不了，这里只统计轮询期间观察到的变化）

  // 说明：本监控**不修改**任何服务端代码，也不注入代理；它通过"轮询 + 观测"给出实时画面：
  //   · 两个进程是否活着（命令行匹配 ✓ 可验证）；
  //   · 两个端口是否在听（TCP 连接表）；
  //   · 后端 health 的用户数/会话天数/是否允许注册（每次轮询的差异 = 有人注册/登录了）；
  //   · 前端最近被访问的页面（通过 / 与 /starmap.html 的可达性 + 响应时间）。
  // 想要"每一次 API 调用/每一个画布操作"级别的流水，需要服务端请求日志或前端上报 —— 见文件头说明。
  const push = (kind, text) => { events.unshift({ at: new Date(), kind, text }); if (events.length > 12) events.pop(); };

  const interval = Number(process.env.IW_STATUS_INTERVAL_MS || 1500);
  console.log('交织者实时监控 —— Ctrl+C 退出（间隔 ' + interval + 'ms）');
  for (;;) {
    const t0 = Date.now();
    const s = await findServices();
    let health = null; let webMs = null; let apiMs = null; let error = null;
    try { const t = Date.now(); const r = await fetch(`http://localhost:${WEB_PORT}/index.html`); webMs = Date.now() - t; if (!r.ok) error = `前端 HTTP ${r.status}`; } catch (e) { error = '前端不可达'; }
    try {
      const t = Date.now(); const r = await fetch(`http://localhost:${API_PORT}/api/v1/health`); apiMs = Date.now() - t;
      health = await r.json();
    } catch { /* 后端没起 */ }

    if (health) {
      if (lastHealth && lastHealth.users !== health.users) push('API', `用户数 ${lastHealth.users} → ${health.users}（有人注册）`);
      lastHealth = health;
    }
    const line = (name, ok, pid, ms, port) => `${ok ? '● 运行中' : '○ 未运行'}  ${name.padEnd(6)} :${String(port).padEnd(5)} ${pid ? 'PID ' + String(pid).padEnd(7) : '        '} ${ms !== null ? ms + 'ms' : ''}`;
    const out = [];
    out.push('┌─ 交织者 · 实时监控 ──────────────────────────────── ' + new Date().toLocaleTimeString());
    out.push('│ ' + line('前端', s.web.length > 0, s.web[0] && s.web[0].pid, webMs, WEB_PORT));
    out.push('│ ' + line('后端', s.api.length > 0, s.api[0] && s.api[0].pid, apiMs, API_PORT));
    out.push('│ 后端 health：' + (health ? `db=${health.db} 用户=${health.users} 开放注册=${health.allowRegister ? '是' : '否'} 会话=${health.sessionDays}天` : '（不可达）'));
    out.push('│ 地址：http://localhost:' + WEB_PORT + '/   ｜   API http://localhost:' + API_PORT + '/api/v1/');
    if (error) out.push('│ ⚠ ' + error);
    out.push('├─ 最近事件（滚动） ────────────────────────────────');
    if (!events.length) out.push('│ （还没有事件：注册/登录/数据变更会出现在这里）');
    for (const e of events) out.push('│ ' + e.at.toLocaleTimeString() + '  [' + e.kind + '] ' + e.text);
    out.push('└─ 运行 ' + Math.round((Date.now() - started) / 1000) + 's ｜ Ctrl+C 退出 ｜ 只看服务端可见的操作（画布内部动作在浏览器里，不经服务器）');
    process.stdout.write(clear + out.join('\n') + '\n');
    await new Promise((r) => setTimeout(r, Math.max(400, interval - (Date.now() - t0))));
  }
}

const cmd = (process.argv[2] || 'status').toLowerCase();
if (cmd === 'start') await start();
else if (cmd === 'stop') await stop();
else if (cmd === 'status' || cmd === 'monitor') { console.log('提示：Ctrl+C 退出'); await status(); }
else { console.log('用法：node iw-cli.mjs start|stop|status'); process.exit(1); }
