// 一条命令起"前后端分离"的两个来源（零依赖）：
//   ① 前端静态服务 http://localhost:5188   （server.mjs，只发静态文件，不含任何 API）
//   ② 后端 API 服务  http://localhost:5189   （server-api.mjs，用户数据都在这里）
// 两者**不同源**，跨源访问由后端白名单 + 预检控制（见 server-api.mjs 的 ALLOWED_ORIGINS）。
//
// 也可以分开起：npm run start:web / npm run start:api
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const children = [];

const run = (label, file, env = {}) => {
  const c = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
  c.on('exit', (code, signal) => {
    // 任何一个挂了就把另一个也带走，并如实报出是谁、为什么 —— 不留"半个服务在跑"的假象
    console.log(`[dev] ${label} 退出（code=${code}${signal ? ' signal=' + signal : ''}）—— 一并停止另一个`);
    for (const o of children) { if (o !== c) { try { o.kill(); } catch { /* 已退出 */ } } }
    process.exit(code === 0 ? 0 : 1);
  });
  children.push(c);
  return c;
};

run('web', 'server.mjs');
run('api', 'server-api.mjs');

process.on('SIGINT', () => { for (const c of children) { try { c.kill(); } catch { /* 已退出 */ } } process.exit(0); });
