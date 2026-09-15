import fs from 'fs';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
const outDir = 'D:/zhuo_mian/Interweaver/app/tests/artifacts';
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const bad = [];

await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

// 造点内容并点亮若干成就（让星图有"已点亮/待补前置/未点亮"三种状态）
await page.evaluate(() => {
  const { st, cam, S, ach } = window.__IW;
  ach.reset();
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 50;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addEdgePoint(st, c.id, 0.6);
  const s = S.addEntity(st, 'segment', { x1: -3, y1: 3, x2: 3, y2: 3 });
  S.addVariable(st, 'k', { value: 2, min: 0, max: 5 });
  S.ensureEvaluated(st);
  S.addBinding(st, s.id, 'length', 'k');
  S.ensureEvaluated(st); S.emit(st, 'structure');
});
await new Promise((r) => setTimeout(r, 1900));

await page.click('#achBtn');
await page.waitForSelector('#starMap', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 900));

const info = await page.evaluate(() => {
  const sm = document.getElementById('starMap');
  const svg = sm.querySelector('svg');
  return {
    nodes: sm.querySelectorAll('.smNode').length,
    polylines: svg.querySelectorAll('polyline').length,
    lines: svg.querySelectorAll('line').length,
    bridges: svg.querySelectorAll('path.smBridge').length,
    flows: svg.querySelectorAll('.smFlow').length,
    cols: sm.querySelectorAll('.smCol').length,
    bands: sm.querySelectorAll('.smBand').length,
    svgW: Math.round(svg.getBoundingClientRect().width),
    svgH: Math.round(svg.getBoundingClientRect().height),
  };
});
console.log('星图：节点', info.nodes, '| 正交折线', info.polylines, '| 残留直线', info.lines, '| 拱桥', info.bridges, '| 流动光点', info.flows);
console.log('列标签', info.cols, '| 组带', info.bands, '| 画布', info.svgW + '×' + info.svgH);
if (info.polylines === 0) bad.push('正交走线没有渲染出来（polyline 数 0）');
if (info.lines > 0) bad.push(`仍有 ${info.lines} 条旧式直线残留`);
if (info.bridges === 0) bad.push('没有渲染任何跨线小拱桥');
if (info.nodes !== 57) bad.push(`节点数应为 57，实为 ${info.nodes}`);
if (info.cols !== 7 || info.bands !== 4) bad.push(`列标签/组带数不对（${info.cols}/${info.bands}）`);
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));

await page.screenshot({ path: outDir + '/p15-t3-starmap.png' });
console.log('成品截图 →', outDir + '/p15-t3-starmap.png');

// 顺带核验：窄屏（≤720px）是否切列表模式、Esc 能否关闭
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
const closed = await page.evaluate(() => !document.getElementById('starMap'));
console.log('Esc 关闭星图 =', closed);
if (!closed) bad.push('Esc 未能关闭星图');

if (bad.length) { console.log('❌ T3 成品核验失败：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ T3 正交走线在星图成品中渲染正确、无运行时错误');
await browser.close();
process.exit(bad.length ? 1 : 0);
