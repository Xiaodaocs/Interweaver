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
    if (p === '/') p = '/index.html';
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
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
