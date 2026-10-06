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
import { spawn } from 'node:child_process';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const TMP = join(APP, 'data', 'verify-api');
const DB = join(TMP, 'verify.db');
const PORT = 5189;                       // = 三个页面 <meta name="iw-api"> 里的端口
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

let web = null;                          // 前端静态服务（可能在跑、也可能由本外壳拉起）
const api = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: { ...process.env, PORT_API: String(PORT), API_DB: DB },
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

let up = false;
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/api/v1/health`); if (r.ok) { up = true; break; } } catch { /* not ready */ }
  await wait(200);
}
if (!up) {
  console.log('✗ 测试后端没能在 5189 起来 —— 后续检查会在离线模式下跑（成就页入口会被挡住）');
  console.log('  启动输出：' + boot.trim().slice(0, 400));
  try { api.kill(); } catch { /* ignore */ }
  process.exit(1);
}
console.log(`· verify 外壳：测试后端已起在 ${PORT}（数据库 ${DB.replace(APP, '.')}）`);

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
