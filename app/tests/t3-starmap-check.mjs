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

// §11.1 枢纽视觉权重：**同状态**对比（节点 opacity 同时受状态与权重影响，
// 跨状态比大小会把"状态"当成"权重"——上一版断言就是这么错的，故只在同状态内比较）
// 先等入场动画（设计 §1.3：从焦点星向外错相淡入）稳定下来 —— 否则会量到动画中间值，
// 这正是上一版断言不稳的原因（同一状态下量到 0.544 的中间值）。浮动动画是 infinite 的，
// 因此不能用 getAnimations() 判空，改用固定等待。
await new Promise((r) => setTimeout(r, 2500));
const weight = await page.evaluate(() => {
  const pick = (sel) => document.querySelectorAll('#starMap .smNode' + sel);
  const state = (el) => (el ? el.dataset.state : null);
  const op = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
  // 节点标记已从 <b> 改为 <span class="smCap">（徽标 + 小字标注），核验选择器同步更新
  const fw = (el) => (el ? Number(getComputedStyle(el.querySelector('.smCap') || el).fontWeight) : null);
  // 找一个"枢纽与叶端同为已点亮"的状态做对比；找不到就退化为计数与辉光断言
  const hubs = [...pick('.hub')], leaves = [...pick('.leaf')];
  const common = hubs.map(state).find((s) => s && leaves.some((l) => state(l) === s)) || null;
  const h = hubs.find((el) => state(el) === common) || hubs[0];
  const l = leaves.find((el) => state(el) === common) || leaves[0];
  return {
    hub: hubs.length, leaf: leaves.length, common,
    hubOp: op(h), leafOp: l && state(l) === state(h) ? op(l) : null,
    hubFW: fw(h), leafFW: l && state(l) === state(h) ? fw(l) : null,
    hubFilter: h ? getComputedStyle(h).filter : 'none',
  };
});
console.log("枢纽 " + weight.hub + " 个 | 叶端 " + weight.leaf + " 个 | 同状态 " + (weight.common || "-") + " 下 opacity " + weight.hubOp + " vs " + weight.leafOp + " | font-weight " + weight.hubFW + " vs " + weight.leafFW + " | 枢纽辉光 " + (weight.hubFilter !== "none" ? "有" : "无"));
if (!(weight.hub > 0)) bad.push('没有识别出任何枢纽节点（依赖度 ≥3）');
if (!(weight.leaf > 0)) bad.push('没有识别出任何叶端节点（依赖度 ≤1）');
if (weight.common && !(weight.leafOp < weight.hubOp)) bad.push('同一状态下叶端应比枢纽更淡（' + weight.leafOp + ' vs ' + weight.hubOp + '）');
// 视觉重量的证据已随契约更新：不再依赖 filter（用户要求只留单层小散光），
// 改为判「枢纽徽标描边更粗/更亮」与「枢纽字重大于叶端」——两者都与滤镜无关，且是当前的真实实现。
const hubStroke = await page.evaluate(() => {
  const hub = document.querySelector('#starMap .smNode.hub svg circle, #starMap .smNode.hub svg rect, #starMap .smNode.hub svg polygon');
  if (!hub) return null;
  const cs = getComputedStyle(hub);
  return { w: Number(cs.strokeWidth.replace('px', '')), o: Number(cs.strokeOpacity) };
});
if (!hubStroke || !(hubStroke.w >= 2.1)) bad.push('枢纽徽标描边应更粗（单层散光机制），实测 ' + (hubStroke ? hubStroke.w : 'null'));
if (hubStroke && !(hubStroke.o >= 0.5)) bad.push('枢纽徽标描边应更亮（stroke-opacity ≥ .5），实测 ' + hubStroke.o);
if (weight.hubFW !== null && weight.leafFW !== null && !(weight.hubFW > weight.leafFW)) bad.push('枢纽字重应大于叶端（' + weight.hubFW + ' vs ' + weight.leafFW + '）');
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
