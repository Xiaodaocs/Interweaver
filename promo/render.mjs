// 宣传片渲染管线：
//   node render.mjs probe 15.0 52.5 …   → 渲染指定秒数的单帧到 promo/probes/（调视觉用）
//   node render.mjs full [--workers 4]  → 全片：4740 帧 PNG 流直推 ffmpeg + 音频合成 mp4
// 帧是纯函数 renderFrame(t)：30fps × 158s = 4740 帧，确定性，无 wall-clock。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');          // 项目根（服务它，影片才能 import 产品数据）
const OUT = path.join(__dirname, 'out');
const PROBES = path.join(__dirname, 'probes');

const require = createRequire(path.join(ROOT, 'app', 'package.json'));
const puppeteer = require('puppeteer-core');

const CHROME = process.env.PROMO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.PROMO_FFMPEG
  || 'C:/Users/25402/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu-vsync', '--mute-audio'],
  });
  return browser;
}
async function makePage(browser, port) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/promo/film.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction('typeof window.__render === "function"');
  return page;
}
async function framePng(page, t) {
  const dataUrl = await page.evaluate((tt) => {
    window.__render(tt);
    return document.getElementById('film').toDataURL('image/png');
  }, t);
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

// ---------------- probe 模式 ----------------
async function probe(times) {
  fs.mkdirSync(PROBES, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await launch();
  const page = await makePage(browser, port);
  for (const t of times) {
    const buf = await framePng(page, t);
    const f = path.join(PROBES, `t${String(t).replace('.', '_')}.png`);
    fs.writeFileSync(f, buf);
    console.log('probe', t, '→', f);
  }
  await browser.close(); srv.close();
}

// ---------------- full 模式 ----------------
async function full(workers) {
  const wav = path.join(OUT, 'audio.wav');
  if (!fs.existsSync(wav)) {
    console.error('缺少音频：先运行 node audio.mjs 生成 out/audio.wav');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await launch();
  const pages = [];
  for (let i = 0; i < workers; i++) pages.push(await makePage(browser, port));

  // 从页面读取真实参数
  const info = await pages[0].evaluate(() => window.__INFO);
  const totalFrames = Math.round(info.DUR * info.FPS);
  console.log(`渲染 ${totalFrames} 帧 @ ${info.FPS}fps，${workers} 个并行页面`);

  const outMp4 = path.join(OUT, 'interweaver-promo.mp4');
  const ff = spawn(FFMPEG, [
    '-y',
    '-f', 'image2pipe', '-framerate', String(info.FPS), '-i', '-',
    '-i', wav,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium',
    '-r', String(info.FPS),
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    outMp4,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', (e) => { console.error('ffmpeg 启动失败：', e.message); process.exit(1); });

  const pending = new Map();     // frame → Promise<Buffer>
  let nextWrite = 0;
  const t0 = Date.now();
  async function schedule(f) {
    const page = pages[f % workers];
    pending.set(f, page ? framePng(page, f / info.FPS) : Promise.reject(new Error('no page')));
  }
  for (let f = 0; f < totalFrames; f++) {
    schedule(f);
    if (pending.size >= workers * 3) {
      const buf = await pending.get(nextWrite);
      pending.delete(nextWrite);
      await writeFrame(ff, buf, nextWrite);
      nextWrite++;
    }
  }
  while (pending.size) {
    const buf = await pending.get(nextWrite);
    pending.delete(nextWrite);
    await writeFrame(ff, buf, nextWrite);
    nextWrite++;
  }
  ff.stdin.end();
  await new Promise((ok, no) => { ff.on('close', (c) => c === 0 ? ok() : no(new Error('ffmpeg exit ' + c))); });
  await browser.close(); srv.close();
  console.log(`完成：${outMp4}（${((Date.now() - t0) / 60000).toFixed(1)} 分钟）`);
}
function writeFrame(ff, buf, f) {
  return new Promise((ok) => {
    if (!ff.stdin.write(buf)) ff.stdin.once('drain', ok);
    else ok();
  });
}

// ---------------- 入口 ----------------
const [, , mode, ...rest] = process.argv;
if (mode === 'probe') {
  await probe(rest.map(Number));
} else if (mode === 'full') {
  const w = rest.indexOf('--workers');
  await full(w >= 0 ? Number(rest[w + 1]) : 4);
} else {
  console.log('用法：node render.mjs probe <秒...> | node render.mjs full [--workers 4]');
}
