// 测试基建守卫：**独占端口 + 独占临时库**；不是自己起的就**拒绝运行**（被各检查 import）。
//
// 为什么必须有它（血泪教训，已实测污染用户真实库两次）：
//   老写法 `spawnIfFree(...)` 的判据是"端口上有人应答健康检查 → 复用它、不再自己起"。
//   可端口上跑的可能是**用户自己的后端**（连的是真实库 app/data/interweaver.db）——
//   于是检查紧接着的 register / PUT doc / 建场景 / POST events 全都写进了用户的真实库
//   （现场抓到过 tel_* 测试账号）。而且这条路径**静默通过**：检查自己还以为一切正常。
//
// 本模块给两种正确姿势兜底：
//   ① 首选：每个检查**自带独占端口 + 独占临时库**（用 startOwnApi；项目已有先例：
//      check-api 5199 / check-account-isolation 5295 / check-account-panel 5298 / check-mine-page 5299）；
//   ② 兜底：万一某处确实不能换端口，就必须**独占**——用 claimPort + assertOwnApi，
//      端口上有别人（或起出来的不是我的）→ exit 1 打印人话，**绝不复用、绝不静默跳过断言**。
//
// 身份判据（不用改 server-api.mjs 就能拿到）：
//   server-api 的 /health 会把 `process.env.API_LOG` **原样**回显在 `log` 字段里。
//   我们给自己起的后端传一个独一无二的临时日志路径 → "健康响应里的 log == 我传的那个路径"
//   就等价于"这个后端是我起的"。用户真实后端的 /health 恒为 `log:"data/api.log"`，永远对不上。
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));      // = app/（本文件在 app/tests/ 下）
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 端口上有没有**任何**东西在监听（TCP 连接得通 = 有活着的监听者） */
export function portBusy(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { s.destroy(); } catch { /* 忽略 */ } resolve(v); } };
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
    s.setTimeout(timeoutMs, () => fin(false));
  });
}

/** 探活：端口上是不是一个 interweaver-api；是就返回它的 /health JSON，否则 null。 */
export async function probeHealth(port, timeoutMs = 1200) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && j.service === 'interweaver-api' ? j : null;
  } catch { return null; }
}

const healthHint = (h) => (h
  ? `它的 /health：users=${h.users}、log=${h.log}${h.log === 'data/api.log' ? ' ← 这是**默认日志路径**，很像用户的真实后端（data/interweaver.db）' : ''}`
  : '（它不像是交织者的后端，或未在 /api/v1/health 上应答）');

/** 拒绝运行：绝不"端口被占就跳过断言/静默通过"。 */
export function refuse(port, who, lines = []) {
  console.error(`\n❌ ${port} 上跑的不是本检查（${who}）的测试后端（很可能是用户真实库）→ 拒绝写入；请先停掉它，或改用本检查自己的端口`);
  for (const l of lines) console.error('   · ' + l);
  console.error('   · 怎么办：npm run status 看是谁占着 / npm run stop 停掉本项目服务；或把本检查的端口常量改成一个空闲端口');
  console.error('   · 本项目纪律：每个检查要么**自带独占端口 + 独占临时库**，要么**拒绝运行**——绝不复用别人的后端\n');
  process.exit(1);
}

/**
 * 前置：本检查要独占 port。
 * 端口上已经有人（不管是不是交织者后端）→ 拒绝运行。
 * 为什么连"别的交织者后端"也拒绝：它可能连着真实库，而复用正是污染用户数据的入口。
 */
export async function claimPort(port, who) {
  if (!(await portBusy(port))) return;
  const h = await probeHealth(port);
  refuse(port, who, [healthHint(h)]);
}

/**
 * 起一个"我自己的"测试后端：独占端口 + 独占临时库 + 独占日志。
 * @param {object} o
 * @param {number} o.port      独占端口
 * @param {string} o.who       检查名（打印用）
 * @param {string} o.dbFile    临时库文件（其父目录会被清空重建）
 * @param {string} [o.logFile] 临时请求日志（默认 <tmp>/api.log；同时用作"是我起的"身份标识）
 * @param {string} [o.eventsFile] 临时事件日志（默认 <tmp>/events.log）
 * @param {string} [o.origins] 允许来源（默认沿用环境变量或 localhost:5188）
 * @returns {Promise<{proc: import('node:child_process').ChildProcess, health: object, logFile: string, eventsFile: string, stop: () => void}>}
 */
export async function startOwnApi({ port, who, dbFile, logFile, eventsFile, origins }) {
  // ★ 先确认端口是空的，再动临时目录：拒绝运行时**一个字节都不留下**
  //   （"目录是空的"曾经是排查污染时的关键旁证，别再制造这种迷惑现场）
  await claimPort(port, who);                       // ★ 绝不复用别人的后端

  const tmp = dirname(dbFile);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const log = logFile || join(tmp, 'api.log');
  const events = eventsFile || join(tmp, 'events.log');

  const proc = spawn(process.execPath, ['server-api.mjs'], {
    cwd: APP,                                       // = app/（server-api.mjs 就在这儿）
    env: {
      ...process.env,
      PORT_API: String(port),
      API_DB: dbFile,
      API_LOG: log,                                 // ★ 同时是身份标识（/health 会原样回显）
      API_EVENTS_LOG: events,
      API_ORIGINS: origins || process.env.API_ORIGINS || 'http://localhost:5188,http://127.0.0.1:5188',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let boot = '';
  proc.stdout.on('data', (d) => { boot += d.toString(); });
  proc.stderr.on('data', (d) => { boot += d.toString(); });
  const stop = () => { try { proc.kill(); } catch { /* 已退出 */ } };
  process.on('exit', stop);

  // 等它起来；期间必须：① 进程还活着；② /health 的 log == 我传的路径（= 确实是我起的）
  let health = null;
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) {
      refuse(port, who, [`自己起的后端当场退出了（exit=${proc.exitCode}）——多半是端口被占或库打不开`, '启动输出：' + boot.trim().slice(0, 300)]);
    }
    const h = await probeHealth(port, 700);
    if (h) {
      if (h.log !== log) {
        stop();
        refuse(port, who, [`端口上应答的后端不是我起的（/health 的 log=${h.log}，我传的是 ${log}）`, healthHint(h)]);
      }
      health = h; break;
    }
    await sleep(200);
  }
  if (!health) {
    stop();
    refuse(port, who, ['自己的测试后端 10 秒内没起来', '启动输出：' + boot.trim().slice(0, 300)]);
  }

  // ★ 起稳之后把子进程与它的管道 unref 掉：**检查里万一忘了 stop()，进程也不会永远挂着**。
  //   为什么必须这么防：pipe 的 stdio 会一直把父进程的事件循环撑住，而 process.on('exit')（负责
  //   杀子进程）只有在"准备退出"时才跑 —— 于是"等子进程死"和"等父进程退"互相等待，
  //   检查会**永远不结束**（实测把整条 verify 链卡死在 check-telemetry 上）。
  //   unref 之后父进程可以自行退出，退出钩子随即杀掉子进程；日志/事件早已落盘，不影响断言。
  for (const s of [proc.stdout, proc.stderr]) { try { s.unref(); } catch { /* 忽略 */ } }
  try { proc.unref(); } catch { /* 忽略 */ }
  return { proc, health, logFile: log, eventsFile: events, stop };
}

/** 事后复核（用于自查脚本/说明）：这个后端还是不是我起的那个 */
export async function assertOwnApi(port, who, logFile) {
  const h = await probeHealth(port);
  if (!h || h.log !== logFile) refuse(port, who, [`端口上应答的后端不是我起的（log=${h && h.log}，我传的是 ${logFile}）`, healthHint(h)]);
  return h;
}
