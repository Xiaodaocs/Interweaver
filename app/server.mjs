// 交织者原型静态服务器：零依赖，仅服务本目录文件
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5188);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // ★ 用户要求：打开 http://localhost:5188/ 默认进**登录页**，而不是画布。
    //   只动"默认入口"这一处：显式路径 /index.html、/settings.html、/starmap.html、/login.html 全部原样可用
    //   —— 核验链里大量检查是直接打开 /index.html 的，把入口页本身改成"会跳转的页面"会把它们全打死。
    //   用 302 而不是"直接把 login.html 当默认文档"：地址栏停在 /login.html，登录页里的相对链接语义不变，
    //   根路径给的是登录页这件事也能从响应头一眼看出来。
    if (p === '/') {
      res.writeHead(302, { location: '/login.html', 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    // ★ 用户要求：设置里加「关于」→ 显示**版本信息（仓库根目录的 VERSION 文件）** ✓
    //   前端是 app/ 下的静态站点 ✗ 取不到上一级的 VERSION ✗ → 这里加一条**极小的只读路由** ✓
    //     · 每次请求**现读**根目录的 VERSION ✓（不复制一份到 app/ ✗ 免得两份迟早不一致 ✗）
    //     · 只返回那个文件的内容（text/plain ✓）· 不暴露目录列表 ✓ · 不缓存（no-store ✓）
    //     · 根目录 = app/ 的上一级 ✓
    if (p === '/VERSION') {
      try {
        const v = await readFile(join(ROOT, '..', 'VERSION'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end(String(v).trim() + '\n');
      } catch {
        // 文件缺失时明确 404（前端会显示"读不到版本号"而不是编一个 ✓）
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('VERSION not found\n');
      }
      return;
    }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// ★ 端口被占时给出**可操作**的说明，而不是甩一坨 EADDRINUSE 堆栈（用户实际踩过这个坑）。
//   常见原因：上一次没退干净、或另一个交织者实例还在跑。停掉它用 npm run stop，或换个端口起。
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n✗ 前端端口 ${PORT} 已被占用 —— 启动不了。`);
    console.error('  可能原因：上一次的前端没退干净，或另一个交织者实例还在跑。');
    console.error('  怎么办：npm run stop（停掉本项目的两个服务）；或换个端口：PORT=5288 npm run start:web');
    console.error('  看谁占着：npm run status');
  } else {
    console.error(`\n✗ 前端服务启动失败：${(e && e.message) || e}`);
  }
  process.exit(2);
});

server.listen(PORT, () => {
  // 把 PID 写进文件：npm run stop / status 靠它精确找到进程（也同时按命令行匹配兜底）
  try {
    const pidFile = fileURLToPath(new URL('./.iw-web.pid', import.meta.url));
    writeFileSync(pidFile, String(process.pid));
  } catch { /* 写不了也不影响服务 */ }
  console.log(`Interweaver proto → http://localhost:${PORT}`);
});
