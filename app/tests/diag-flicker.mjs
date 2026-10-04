// 诊断：放大后画面里的线为什么会"不断闪现/刷新"
// 做法：放大到高倍，然后在 2 秒内统计——
//   ① rAF 帧数（渲染是否一直在跑）
//   ② SVG 边图层上的 DOM 变动次数（子节点增删 = 重建；属性变化 = 重画）
//   ③ path 的 d / stroke-width 是否被改写
//   ④ 相机 transform 写入次数
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);

const install = () => page.evaluate(() => {
  const svg = document.querySelector('#starMap .smCanvas > svg');
  const canvas = document.querySelector('#starMap .smCanvas');
  window.__diag = { frames: 0, childAdded: 0, childRemoved: 0, attrChanged: 0, dChanged: 0, widthChanged: 0, camWrites: 0, animEvents: 0, samples: [] };
  const tick = () => { window.__diag.frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') { window.__diag.childAdded += m.addedNodes.length; window.__diag.childRemoved += m.removedNodes.length; }
      else if (m.type === 'attributes') {
        window.__diag.attrChanged++;
        if (m.attributeName === 'd') window.__diag.dChanged++;
        if (m.attributeName === 'stroke-width') window.__diag.widthChanged++;
      }
    }
  }).observe(svg, { childList: true, subtree: true, attributes: true });
  let t = canvas.style.transform;
  Object.defineProperty(canvas.style, 'transform', { get() { return t; }, set(v) { window.__diag.camWrites++; t = v; }, configurable: true });
  // 监听动画事件（若动画在重启动，会不断触发 animationstart）
  svg.addEventListener('animationstart', () => window.__diag.animEvents++, true);
  svg.addEventListener('animationiteration', () => window.__diag.animEvents++, true);
});

await install();
// 放大到高倍：连续滚轮
for (let i = 0; i < 8; i++) { await page.mouse.move(800, 500); await page.mouse.wheel({ deltaY: -240 }); await wait(60); }
await wait(700);
const cam1 = await page.evaluate(() => window.__IW.starmapCam.get());
await page.evaluate(() => {
  const svg = document.querySelector('#starMap .smCanvas > svg');
  window.__diag.animSample = [...svg.querySelectorAll('path')].slice(0, 3).map((p) => getComputedStyle(p).transform);
});
await wait(2000);
const d = await page.evaluate(() => {
  const svg = document.querySelector('#starMap .smCanvas > svg');
  return {
    ...window.__diag,
    animSample2: [...svg.querySelectorAll('path')].slice(0, 3).map((p) => getComputedStyle(p).transform),
    animNames: [...svg.querySelectorAll('path')].slice(0, 3).map((p) => getComputedStyle(p).animationName),
    paths: svg.querySelectorAll('path').length,
    nonScaling: [...svg.querySelectorAll('path')].slice(0, 2).map((p) => getComputedStyle(p).vectorEffect),
  };
});
console.log(`放大后 scale = ${cam1.scale.toFixed(2)}｜path 数 = ${d.paths}`);
console.log(`2 秒内：rAF 帧 ${d.frames} 帧（≈${(d.frames / 2).toFixed(0)}/秒）`);
console.log(`  DOM：新增子节点 ${d.childAdded}｜删除子节点 ${d.childRemoved}｜属性变化 ${d.attrChanged}（其中 d=${d.dChanged}、stroke-width=${d.widthChanged}）`);
console.log(`  相机 transform 写入 ${d.camWrites}｜动画事件 ${d.animEvents}`);
console.log(`  动画名 = ${JSON.stringify(d.animNames)}｜vector-effect = ${JSON.stringify(d.nonScaling)}`);
console.log(`  path transform 采样：${JSON.stringify(d.animSample)}`);
console.log(`               2 秒后：${JSON.stringify(d.animSample2)}`);
const flicker = d.childAdded + d.childRemoved + d.dChanged + d.widthChanged;
console.log(flicker > 0 ? `\n→ 有 ${flicker} 次"结构性"变动（就是肉眼看到的闪现/刷新）` : '\n→ 没有结构性变动：闪烁只能来自动画重绘本身');
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/diag-flicker.png' });
await browser.close();
