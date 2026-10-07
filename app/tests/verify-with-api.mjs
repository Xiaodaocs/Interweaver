// verify 链的"带后端"外壳（方案 A）：
//   verify 链里有一批检查会点画布上的「成就页」入口（#achBtn）。按用户要求，
//   **离线模式下不开放成就页** —— 而此前 verify 是"没有后端"跑的，于是这些检查必然超时。
//   正确做法不是让检查绕开这道门（那等于把用户要的行为绕过去），而是**让测试环境具备后端**：
//   本外壳先在页面 meta 指向的端口（5189）起一个测试后端，再跑原有的整条链，跑完关掉。
//
// 说明：
//   · 零第三方依赖（只用 node: 内置）；
//   · 用独立的临时数据库（app/data/verify-api/…），跑完删除，不碰用户数据；
//   · 断言"离线行为"的检查不受影响：它们用 globalThis.__IW_API_BASE__ 显式指向死端口
//     （例如 check-boot-overlay / check-frontend-api），与 5189 无关；
//   · 链本身仍是原来的那些命令（package.json 的 verify:raw），本外壳只负责起/停后端。
//
// ★★ 基建纪律（本轮修的一处**污染用户真实库**的缺陷，务必保留）：
//   老写法起完 server-api 只等"**5189 上有健康应答**"就认为"我的测试后端起来了"。
//   可 5189 上跑的可能是**用户自己的后端**（连的是真实库 app/data/interweaver.db）：
//     ① 本外壳的 server-api 因 EADDRINUSE 当场退出（但仍会先建出临时库文件，极具迷惑性）；
//     ② 探活却照样 ok（应答来自用户的后端）→ 外壳以为一切正常 → **整条链的页面都指向真实库**；
//     ③ 于是链里任何一个会写后端的检查（例如 check-telemetry 的 register('tel_…')）
//        就把测试账号写进用户的真实库。现场抓到过 tel_* 账号。
//   现在：5189 必须**独占**——端口上已经有任何人在跑，就直接拒绝运行（exit 1 + 人话），
//   绝不复用；起完之后还要用"身份标识"复核（见下）。
import { spawn } from 'node:child_process';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort, probeHealth, refuse, sleep as wait } from './_own-backend.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const TMP = join(APP, 'data', 'verify-api');
const DB = join(TMP, 'verify.db');
const API_LOG = join(TMP, 'api.log');                 // ★ 同时是"这个后端是我起的"的身份标识
const API_EVENTS_LOG = join(TMP, 'events.log');       // 事件流水也留在临时目录，不动 data/events.log
const PORT = 5189;                       // = 三个页面 <meta name="iw-api"> 里的端口（不能换：整条链靠 meta 找后端）

// ★ 端口独占检查：必须在 rm -rf 临时目录**之前**做 —— 拒绝运行时不能顺手删掉别人（比如另一条
//   正在跑的 verify）的临时库。
await claimPort(PORT, 'verify 外壳');

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

let web = null;                          // 前端静态服务（可能在跑、也可能由本外壳拉起）
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: { ...process.env, PORT_API: String(PORT), API_DB: DB, API_LOG, API_EVENTS_LOG },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
api.stdout.on('data', (d) => { boot += d.toString(); });
api.stderr.on('data', (d) => { boot += d.toString(); });

// ★ 前端静态服务也要由外壳拉起：整条链里大量检查会打开 http://localhost:5188/。
//   以前它"能过"是因为本机恰好有个残留的 server.mjs 在顶着 5188 —— 那是隐藏依赖，不是设计。
//   现在外壳把它一并起/停，verify 自给自足（端口占用会由 server.mjs 给出可操作提示并退出 2）。
const WEB_PORT = Number(process.env.PORT || 5188);
if (!process.env.IW_VERIFY_NO_WEB) {
  const webProbe = await fetch(`http://localhost:${WEB_PORT}/index.html`).then(() => true).catch(() => false);
  if (webProbe) {
    console.log(`· verify 外壳：前端 ${WEB_PORT} 已在运行 —— 复用（不重复起）`);
  } else {
    web = spawn(process.execPath, ['server.mjs'], {
      cwd: APP, env: { ...process.env, PORT: String(WEB_PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    web.stdout.on('data', () => {}); web.stderr.on('data', () => {});
    let webUp = false;
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(`http://localhost:${WEB_PORT}/index.html`); if (r.ok) { webUp = true; break; } } catch { /* not ready */ }
      await wait(200);
    }
    if (!webUp) {
      console.log(`✗ 前端 ${WEB_PORT} 起不来 —— 链里的浏览器检查都会失败`);
      try { api.kill(); } catch { /* ignore */ }
      try { web && web.kill(); } catch { /* ignore */ }
      process.exit(1);
    }
    console.log(`· verify 外壳：前端已起在 ${WEB_PORT}`);
  }
}

// 等后端起来 —— 不只看"有人在应答"，还要看**应答的是不是我起的那个**：
//   server-api 的 /health 会把 API_LOG 原样回显在 log 字段上，所以 log === 我传进去的路径
//   就等价于"这个后端是我起的"。真实后端的 /health 恒为 log:"data/api.log"，永远对不上。
let up = false;
for (let i = 0; i < 50; i++) {
  if (api.exitCode !== null) break;                    // 自己起的当场退出（EADDRINUSE 等）→ 下面统一报错
  const h = await probeHealth(PORT);
  if (h) {
    if (h.log !== API_LOG) {
      try { api.kill(); } catch { /* 忽略 */ }
      refuse(PORT, 'verify 外壳', [`端口上应答的后端不是我起的（/health 的 log=${h.log}，我传的是 ${API_LOG}）`]);
    }
    if (h.users !== 0) {                               // 临时库刚 rm 过，必然是 0 个用户
      try { api.kill(); } catch { /* 忽略 */ }
      refuse(PORT, 'verify 外壳', [`我起的后端连的临时库应该是空的，但 /health 报 users=${h.users}`]);
    }
    up = true;
    break;
  }
  await wait(200);
}
if (!up) {
  console.log('✗ 测试后端没能在 5189 起来 —— 后续检查会在离线模式下跑（成就页入口会被挡住）');
  console.log('  启动输出：' + boot.trim().slice(0, 400));
  try { api.kill(); } catch { /* ignore */ }
  process.exit(1);
}
console.log(`· verify 外壳：测试后端已起在 ${PORT}（数据库 ${DB.replace(APP, '.')}，独占端口已复核）`);

// 读出原来的整条链（verify:raw），跑它
const pkg = JSON.parse(await readFile(join(APP, 'package.json'), 'utf8'));
const raw = (pkg.scripts && pkg.scripts['verify:raw']) || '';
if (!raw) {
  console.log('✗ package.json 里没有 verify:raw（原链）—— 请检查脚本配置');
  try { api.kill(); } catch { /* ignore */ }
  process.exit(1);
}

const chain = spawn(raw, { cwd: APP, shell: true, stdio: 'inherit', env: process.env });
const code = await new Promise((res) => chain.on('exit', (c) => res(c ?? 1)));

try { api.kill(); } catch { /* ignore */ }
try { if (web) web.kill(); } catch { /* ignore */ }     // 只关我们自己拉起的前端；复用别人的就不动
await wait(250);
await rm(TMP, { recursive: true, force: true }).catch(() => {});
console.log(`· verify 外壳：链结束（exit=${code}），测试后端${web ? '与前端' : ''}已关闭`);
process.exit(code);
