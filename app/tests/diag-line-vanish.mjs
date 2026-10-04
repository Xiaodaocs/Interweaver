// A/B 诊断：线"消失又出现"到底由什么造成
// 方法：在高倍下连拍 8 帧，逐帧统计"线的像素数"（亮而细的冷色像素）。
//   如果这个数在帧间大幅振荡 → 就是用户看到的"线不断消失又出现"。
//   三种配置对比：A 逐线动画 + will-change（当前）｜B 逐线动画、无 will-change｜C 完全不动画
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 240000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1400);

const setMode = (mode) => page.evaluate((m) => {
  let st = document.getElementById('wave-ab');
  if (st) st.remove();
  st = document.createElement('style');
  st.id = 'wave-ab';
  if (m === 'A') st.textContent = '';                                  // 当前实现
  if (m === 'B') st.textContent = '#starMap path.smDep,#starMap path.smRel,#starMap path.smWoven{will-change:auto !important}';
  if (m === 'C') st.textContent = '#starMap path.smDep,#starMap path.smRel,#starMap path.smWoven{animation:none !important}';
  document.head.appendChild(st);
}, mode);

const countLinePixels = (dataUrl) => page.evaluate(async (url) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("decode fail")); img.src = url; });
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const W = cv.width, H = cv.height;
  const d = g.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], bb = d[i + 2];
    const lum = 0.299 * r + 0.587 * gg + 0.114 * bb;
    if (lum > 46 && lum < 205 && bb >= r) n++;
  }
  return n;
}, dataUrl);

// MUST sample frame by frame: passing 8 base64 shots into one evaluate fails on payload size
const sampleFrames = async (frames = 8) => {
  const counts = [];
  for (let i = 0; i < frames; i++) {
    const shot = await page.screenshot({ encoding: "base64" });
    counts.push(await countLinePixels("data:image/png;base64," + shot));
    await wait(120);
  }
  const min = Math.min(...counts), max = Math.max(...counts);
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
  return { counts, min, max, mean, swing: (max - min) / Math.max(1, mean) };
};

const zoomIn = async (n) => { for (let i = 0; i < n; i++) { await page.mouse.move(700, 450); await page.mouse.wheel({ deltaY: -240 }); await wait(60); } await wait(500); };

console.log('配置 A：逐线动画 + will-change（当前实现）');
await zoomIn(6);
const scaleA = await page.evaluate(() => window.__IW.starmapCam.get().scale);
const A = await sampleFrames();
console.log(`  scale=${scaleA.toFixed(2)}｜8 帧线像素数 = ${A.counts.join(', ')}`);
console.log(`  最小 ${A.min}｜最大 ${A.max}｜均值 ${A.mean.toFixed(0)}｜波动 ${(A.swing * 100).toFixed(1)}%`);

console.log('配置 B：逐线动画、但不要 will-change');
await setMode('B');
await wait(400);
const B = await sampleFrames();
console.log(`  8 帧线像素数 = ${B.counts.join(', ')}`);
console.log(`  最小 ${B.min}｜最大 ${B.max}｜均值 ${B.mean.toFixed(0)}｜波动 ${(B.swing * 100).toFixed(1)}%`);

console.log('配置 C：完全不动画');
await setMode('C');
await wait(400);
const C = await sampleFrames();
console.log(`  8 帧线像素数 = ${C.counts.join(', ')}`);
console.log(`  最小 ${C.min}｜最大 ${C.max}｜均值 ${C.mean.toFixed(0)}｜波动 ${(C.swing * 100).toFixed(1)}%`);

console.log('对照 D：缩放回全览（用户说这里现象消失）');
await setMode('A');
await page.evaluate(() => { document.getElementById('smFit')?.click(); });
await wait(900);
const scaleD = await page.evaluate(() => window.__IW.starmapCam.get().scale);
const D = await sampleFrames();
console.log(`  scale=${scaleD.toFixed(2)}｜8 帧线像素数 = ${D.counts.join(', ')}`);
console.log(`  最小 ${D.min}｜最大 ${D.max}｜均值 ${D.mean.toFixed(0)}｜波动 ${(D.swing * 100).toFixed(1)}%`);

await page.evaluate(() => document.getElementById('wave-ab')?.remove());
await browser.close();
