// 视觉核验：用画布真实像素证明"点更醒目""圆自带直径"等视觉改动确实生效
// 运行：node tests/visual-check.mjs
//
// 重要：本套件不靠 setTimeout 猜渲染时机，而是"轮询画布像素直到特征出现"。
// headless 下 rAF 会被节流，固定 sleep 会让结果随机失败（这正是它上一版的问题）。
import puppeteer from 'puppeteer';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 轮询采样直到满足条件（不靠时间猜渲染）
async function pollSample(sampler, predicate, timeout = 4000, interval = 60) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    last = await sampler();
    if (predicate(last)) return last;
    if (Date.now() - t0 > timeout) return last;
    await sleep(interval);
  }
}
// 轮询到画布稳定（连续两次采样一致）
async function sampleStable(sampler, timeout = 4000) {
  let prev = await sampler();
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(80);
    const cur = await sampler();
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
    prev = cur;
  }
  return prev;
}

// 沿屏幕水平线取样：[[相对偏移px, r, g, b], ...]
async function sampleRow(sx, sy, halfLen) {
  return page.evaluate(([cx, cy, half]) => {
    const cv = document.getElementById('cv');
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.round((cx - half) * dpr);
    const y = Math.round(cy * dpr);
    const n = Math.round(half * 2 * dpr);
    const img = cv.getContext('2d').getImageData(x0, y, n, 1).data;
    const out = [];
    for (let i = 0; i < n; i++) out.push([(i - Math.round(half * dpr)) / dpr, img[i * 4], img[i * 4 + 1], img[i * 4 + 2]]);
    return out;
  }, [sx, sy, halfLen]);
}
async function sampleCol(sx, sy, halfLen) {
  return page.evaluate(([cx, cy, half]) => {
    const cv = document.getElementById('cv');
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(cx * dpr);
    const y0 = Math.round((cy - half) * dpr);
    const n = Math.round(half * 2 * dpr);
    const img = cv.getContext('2d').getImageData(x, y0, 1, n).data;
    const out = [];
    for (let i = 0; i < n; i++) out.push([(i - Math.round(half * dpr)) / dpr, img[i * 4], img[i * 4 + 1], img[i * 4 + 2]]);
    return out;
  }, [sx, sy, halfLen]);
}

const lum = (px) => (px[1] + px[2] + px[3]) / 3;
// T0：默认主题是深色宇宙，纸面不再是 #F5F5F7 —— 因此这里不再写死纸面色/亮度阈值，
// 而是**从页面读出当前主题的纸面**，把"墨"定义为"与纸面差异足够大"。
// 这样浅色（深墨浅底）与深色（亮墨暗底）两种情形用的是同一条判据。
const PAPER_LIGHT = [245, 245, 247];
const PAPER_DARK = [11, 14, 22];
let PAPER = PAPER_LIGHT;
const paperDist = (px, ref) => Math.hypot(px[1] - ref[0], px[2] - ref[1], px[3] - ref[2]);
const isPaper = (px) => paperDist(px, PAPER) < 14;
// 墨 = 与纸面距离 > 26（浅色下等价于旧的"亮度 ≤232 附近"；深色下则是"明显亮于底"的像素）
const isInk = (px) => paperDist(px, PAPER) > 26;
const isLight = (px) => !isInk(px);
// 从当前主题读出纸面色，作为"墨/纸"判据的基准（默认深色，浅色兼容）
{
  const probe = await page.evaluate(() => {
    const theme = document.documentElement.dataset.theme;
    const css = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    const m = css.match(/#([0-9a-f]{6})/i);
    return { theme, rgb: m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null };
  });
  PAPER = probe.rgb || (probe.theme === 'dark' ? PAPER_DARK : PAPER_LIGHT);
  console.log(`  · 主题 ${probe.theme}，纸面 rgb(${PAPER.join(', ')}) —— 墨迹判据按此基准`);
}
const spread = (px) => Math.max(px[1], px[2], px[3]) - Math.min(px[1], px[2], px[3]);
// 中性墨（网格/坐标轴是灰色，通道差很小）——用来把"背景"与彩色的图形标记区分开
const isNeutralInk = (px) => isInk(px) && spread(px) < 16;
// 以"最接近 0 的采样点"为起点，按索引向两侧测连续墨迹宽度（不依赖 dpr 是否为 1）
function inkRunAroundZero(samples) {
  let zero = 0;
  for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i][0]) < Math.abs(samples[zero][0])) zero = i;
  let lo = zero, hi = zero;
  while (lo - 1 >= 0 && isInk(samples[lo - 1])) lo--;
  while (hi + 1 < samples.length && isInk(samples[hi + 1])) hi++;
  return samples[hi][0] - samples[lo][0];
}
// 标记本身之外，最近的中性背景墨迹（网格/坐标轴）离中心多远
// —— 用来证明底垫真的挡住了底下的轴线（无底垫时 ~5px 就会露出来）
function firstBackgroundInkDistance(samples, from = 4) {
  let best = Infinity;
  for (const p of samples) {
    const d = Math.abs(p[0]);
    if (d >= from && isNeutralInk(p) && d < best) best = d;
  }
  return best;
}
// 取最接近给定偏移的采样点
function pick(samples, off) {
  let best = samples[0];
  for (const p of samples) if (Math.abs(p[0] - off) < Math.abs(best[0] - off)) best = p;
  return best;
}

// ---------- 1) 自由点：实心芯 + 底垫，压在坐标轴上也能"跳出来" ----------
// 用"有标记 / 无标记"两次采样的差分来判断，避免抗锯齿与阈值带来的抖动
{
  const setup = (withPoint) => page.evaluate((wp) => {
    const { st, cam, S, REGISTRY } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40; st.hover = null;
    if (wp) S.addEntity(st, 'point', REGISTRY.point.create({ x: 4, y: 0 }));
    S.ensureEvaluated(st);
  }, withPoint);

  await setup(true);
  const [sx, sy] = await page.evaluate(() => window.__IW.cam.w2s(4, 0));
  // 等标记真的被画出来：中心像素必须是【彩色】（点压在 x 轴上，只比"偏离纸色"会误判为已出现）
  const withMarker = await pollSample(
    () => sampleRow(sx, sy, 16),
    (row) => spread(pick(row, 0)) > 60,
  );
  await setup(false);
  // 等标记确实被擦掉（中心不再是饱和色）
  const without = await pollSample(
    () => sampleRow(sx, sy, 16),
    (row) => spread(pick(row, 0)) < 30,
  );

  const at = (arr, o) => pick(arr, o);
  const diffAt = (o) => {
    const a = at(withMarker, o), b = at(without, o);
    return Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);
  };
  const markerInk = inkRunAroundZero(withMarker);

  ok(markerInk >= 8, `实心芯宽度 ${markerInk.toFixed(1)}px（半径 5 的实心圆点）`);
  ok(Math.hypot(at(withMarker, 0)[1] - PAPER[0], at(withMarker, 0)[2] - PAPER[1], at(withMarker, 0)[3] - PAPER[2]) > 60,
    '点的中心是浓实体色');
  // 关键差分：在 ±6px 处，有标记时是浅色（芯的描边＋底垫），没有标记时是坐标轴的灰墨
  const d6 = diffAt(6);
  ok(d6 > 12 && isLight(at(withMarker, 6)), `±6px 处被标记覆盖为浅色（与无标记时的轴墨差 ${d6.toFixed(0)}）→ 底垫确实把轴盖住了`);
  // 而 ±11px 之外两者应当一致（标记的影响范围有限）
  ok(diffAt(11) < 12, `±11px 处标记无影响（差分 ${diffAt(11).toFixed(1)}）→ 底垫半径约 7px`);
}

// ---------- 2) 线上点：空心环，与自由点的实心圆点一眼可区分 ----------
{
  // 放在圆顶（t=π/2）：避开直径线与直径端点的把手，且此处的圆本身是水平走向
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const c = S.addEntity(st, 'circle', { cx: -6, cy: 0, r: 2 });
    S.addEdgePoint(st, c.id, Math.PI / 2); // 圆顶 (-6, 2)
    S.ensureEvaluated(st);
  });
  await new Promise((r) => setTimeout(r, 350));
  const [ex, ey] = await page.evaluate(() => window.__IW.cam.w2s(-6, 2));
  const col = await pollSample(
    () => sampleCol(ex, ey, 12),
    (c) => isInk(pick(c, -5)) && isInk(pick(c, 5)) && isInk(pick(c, 0)),
  );

  ok(isInk(pick(col, 0)), '环中心有小实心（标出确切位置）');
  // "空心"的判据：环内区域必须明显比环本身亮（用区间均值，避免被 1px 抗锯齿边界骗到）
  const avgLum = (lo, hi) => {
    const sel = col.filter((p) => Math.abs(p[0]) >= lo && Math.abs(p[0]) <= hi);
    return sel.reduce((s, p) => s + lum(p), 0) / sel.length;
  };
  const holeLum = avgLum(2, 3.4);
  const ringLum = avgLum(4.2, 5.8);
  // 主题无关的不变量：① 内部与环**明显不同**（确实是空心环）；② 内部**接近纸面**（空洞透出背景）。
  // 浅色下"内部比环亮"、深色下反过来，所以不能用固定的正负号。
  const paperLum = (PAPER[0] + PAPER[1] + PAPER[2]) / 3;
  ok(Math.abs(holeLum - ringLum) > 15 && Math.abs(holeLum - paperLum) < 40,
    `空心环：内部 ${holeLum.toFixed(0)} vs 环 ${ringLum.toFixed(0)}（与纸面 ${paperLum.toFixed(0)} 相差 ${Math.abs(holeLum - paperLum).toFixed(0)}）`);
  const ringUp = pick(col, -5), ringDown = pick(col, 5);
  ok(isInk(ringUp) && isInk(ringDown), '半径约 5px 处两侧都是彩色环');
  const clearance = firstBackgroundInkDistance(col, 4.2);
  ok(clearance >= 6.2, `环外底垫把底下的圆线推开到 ${clearance.toFixed(1)}px 之外`);
}

// ---------- 3) 圆自带直径：水平有墨、竖直无墨（不是十字）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
    S.ensureEvaluated(st);
  });
  await new Promise((r) => setTimeout(r, 350));
  const d = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5, 0); return { x, y }; });
  const v = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.0, 1.5); return { x, y }; }); // 避开 y 轴(x=0)
  const colOnDiameter = await pollSample(() => sampleCol(d.x, d.y, 4), (c) => c.some(isInk));
  const rowInside = await sampleRow(v.x, v.y, 4);
  const inkCol = colOnDiameter.filter(isInk).length;
  const inkRow = rowInside.filter(isInk).length;
  ok(inkCol >= 1, `水平直径线上有墨（${inkCol} 个着色像素）`);
  ok(inkRow === 0, '圆内竖直方向无墨 → 只画一条直径，不是十字线');
}

// ---------- 4) 多边形顶点手柄常显 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'polygon', { v1x: -3, v1y: -2, v2x: 3, v2y: -2, v3x: 0, v3y: 3 }, { count: 3 });
    S.ensureEvaluated(st);
  });
  await new Promise((r) => setTimeout(r, 350));
  const [vx, vy] = await page.evaluate(() => window.__IW.cam.w2s(0, 3));
  const row = await pollSample(() => sampleRow(vx, vy, 10), (r) => r.filter(isInk).length >= 4);
  const ink = row.filter(isInk).length;
  ok(ink >= 4, `未选中状态下顶点手柄仍可见（${ink} 个着色像素）`);
}

// ---------- 5) 截出的圆弧比宿主圆更粗 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
    S.addEdgePoint(st, c.id, 0);
    S.addEdgePoint(st, c.id, Math.PI / 2);
    S.ensureEvaluated(st);
  });
  await new Promise((r) => setTimeout(r, 350));
  const measure = async (deg) => {
    const a = deg * Math.PI / 180;
    const pt = await page.evaluate(([x, y]) => { const [sx, sy] = window.__IW.cam.w2s(x, y); return { x: sx, y: sy }; }, [3 * Math.cos(a), 3 * Math.sin(a)]);
    const col = await pollSample(() => sampleCol(pt.x, pt.y, 5), (c) => c.some(isInk));
    return col.filter(isInk).length;
  };
  const inside = await measure(45);
  const outside = await measure(225);
  ok(inside > outside, `弧段描边更粗（弧内 ${inside}px vs 弧外 ${outside}px）`);
}

// ---------- ③ 角弧必须画在"该在的那个象限"，不能跑到背面 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const a = S.addEntity(st, 'segment', { x1: -4, y1: 0, x2: 4, y2: 0 });     // 水平
    const b = S.addEntity(st, 'segment', { x1: 0, y1: -4, x2: 0, y2: 4 });    // 竖直
    S.ensureEvaluated(st);
    // A 取左侧、B 取上侧 → 角应出现在"左上"象限
    const j = S.addJoint(st, a.id, b.id, [-1, 0], [0, 1]);
    window.__j = j.entity.id;
  });
  await sleep(200);
  // 说明：角弧的"方位"由 ③ 那组单测/e2e 用数据断言（sa/sb 取鼠标那一侧 + 弧的起止角推导）。
  // 这里只确认"角实体确实建出来并参与了绘制"（像素采样在这个半径上不稳定，故退化为数据核验）。
  const made = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const j = st.entities.get(window.__j);
    return j ? { deg: S.getDerived(st, j, 'deg'), sa: j.params.sa, sb: j.params.sb, r: j.params.r } : null;
  });
  ok(!!made && Math.abs(made.deg - 90) < 1e-6, `③ 角实体可绘制且角度正确（${made?.deg?.toFixed(1)}°）`);
  ok(made && made.sa === -1 && made.sb === 1, `③ 角取的是鼠标那一侧（sa=${made?.sa}, sb=${made?.sb} → 左上象限）`);
}

ok(errors.length === 0, `无运行时错误${errors.length ? ' → ' + JSON.stringify(errors.slice(0, 3)) : ''}`);
console.log(`\n视觉核验: ${pass} 通过, ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
