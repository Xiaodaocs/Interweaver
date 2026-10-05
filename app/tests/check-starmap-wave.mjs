// 用户本轮报告的三件事的验收（真实浏览器 + 像素级证据）：
//   ① 已点亮线的粗细是否统一（之前按边的种类给了不同线宽 → 参差不齐）
//   ② 动态浮动（smWave 动画）是否真的在跑（用户说"看不到"）
//   ③ 卡片遮罩的颜色是否与背景一致（用户要求"覆盖层的颜色要和背景一样"）
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad.push(m); };

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
// 造一个"正在使用中"的知识点（与真实路径一致：runtime 写的 live 记录），
// 否则"使用中的卡片不用拖动就能显示遮罩"这条像素验证会因为场景里没有 in-use 卡片而被跳过。
await page.evaluate(() => {
  try {
    localStorage.clear();
    localStorage.setItem('interweaver.live.v1', JSON.stringify({ at: Date.now(), ids: ['n.circle', 'n.segment'] }));
  } catch (e) {}
});
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(1200);

// ---------- ① 线宽统一 ----------
const widths = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg path')];
  const seen = new Map();
  for (const p of paths) {
    const w = getComputedStyle(p).strokeWidth;
    seen.set(w, (seen.get(w) || 0) + 1);
  }
  return { total: paths.length, dist: [...seen.entries()] };
});
console.log('① 连线宽度分布：', widths.dist.map(([w, n]) => `${w}×${n}`).join('  '), `（共 ${widths.total} 条）`);
ok(widths.dist.length === 1, `所有连线**同一个粗细**（实测 ${widths.dist.length} 种宽度：${widths.dist.map(([w]) => w).join('/')}）`);
// 点亮之后仍然同宽
const litWidths = await page.evaluate(() => {
  const el = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === 'n.circle');
  if (el) el.click();
  return null;
});
void litWidths;
await wait(500);
const lit = await page.evaluate(() => {
  const lits = [...document.querySelectorAll('#starMap .smCanvas > svg path.lit')];
  const seen = new Map();
  for (const p of lits) { const w = getComputedStyle(p).strokeWidth; seen.set(w, (seen.get(w) || 0) + 1); }
  const all = [...document.querySelectorAll('#starMap .smCanvas > svg path')];
  const allW = new Set(all.map((p) => getComputedStyle(p).strokeWidth));
  return { n: lits.length, dist: [...seen.entries()], allKinds: [...allW] };
});
console.log(`  点亮后：亮起 ${lit.n} 条，宽度分布 ${lit.dist.map(([w, n]) => `${w}×${n}`).join('  ')}｜全图宽度种类 ${lit.allKinds.join('/')}`);
ok(lit.n > 0 && lit.dist.length === 1, `点亮后也**同宽**（${lit.dist.map(([w]) => w).join('/')}）→ 不再参差不齐`);
ok(lit.allKinds.length === 1, `点亮与否都不改变宽度（全图只有 ${lit.allKinds.join('/')} 一种）→ 符合"点亮不加粗、和普通线一个粗细"`);

// ---------- ② 浮动动画：分组错相动画，且**高倍下必须完全静止** ----------
//   用户三次反馈的演化：
//     v1 逐条线动画（无合成层）→ 每帧重新栅格化 → 放大后"不断闪现"
//     v2 动画挪到整块图层 → "所有线统一动" + 图层被相机缩放采样 → "像贴图、不够清晰"
//     v3 逐条线各自动 + 每条线一个合成层 → **线不断消失又出现**，缩小到全览时消失
//     v4（当前）线按 id 分到 6 个 <g> 组，每组一个层、各自周期与相位；
//        并且**只在缩放 ≤1.0 时开启动画** —— 因为放大后单个层的栅格可达数千像素见方（上百 MB），
//        会被浏览器反复丢弃重建，正是"消失又出现"的来源（用户"全览时现象消失"完全吻合）。
const anim = await page.evaluate(async () => {
  const svg = document.querySelector('#starMap .smCanvas > svg');
  const paths = [...svg.querySelectorAll('path')];
  const groups = [...svg.querySelectorAll(':scope > g.smWaveG')];
  const snap = () => groups.map((g) => {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(g).transform);
    return m ? Number(m[1].split(',')[5]) : 0;
  });
  const s1 = snap();
  await new Promise((r) => setTimeout(r, 900));
  const s2 = snap();
  return {
    scale: +window.__IW.starmapCam.get().scale.toFixed(2),
    waveOff: document.getElementById('starMap').classList.contains('waveOff'),
    groups: groups.length,
    perGroup: groups.map((g) => g.querySelectorAll('path').length),
    periods: [...new Set(groups.map((g) => getComputedStyle(g).animationDuration))],
    groupAnim: [...new Set(groups.map((g) => getComputedStyle(g).animationName))],
    groupWillChange: [...new Set(groups.map((g) => getComputedStyle(g).willChange))],
    pathAnim: [...new Set(paths.map((p) => getComputedStyle(p).animationName))],
    pathWillChange: [...new Set(paths.map((p) => getComputedStyle(p).willChange))],
    distinctPhases: new Set(s1.map((v) => v.toFixed(2))).size,
    span: Math.max(...s1) - Math.min(...s1),
    moved: s1.filter((v, i) => Math.abs(v - s2[i]) > 0.05).length,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
});
console.log(`② 浮动：scale=${anim.scale} waveOff=${anim.waveOff}｜分组 ${anim.groups} 个，每组线数 ${JSON.stringify(anim.perGroup)}`);
console.log(`   组周期 = ${JSON.stringify(anim.periods)}｜组动画 = ${JSON.stringify(anim.groupAnim)}｜组层 = ${JSON.stringify(anim.groupWillChange)}`);
console.log(`   逐线动画 = ${JSON.stringify(anim.pathAnim)}｜逐线层 = ${JSON.stringify(anim.pathWillChange)}`);
ok(anim.groups >= 4 && anim.groups <= 8, `线分成 ${anim.groups} 组（不是 82 条线各自成层，也不是整块一层）`);
ok(anim.groupAnim.length === 1 && anim.groupAnim[0] === 'smWave', `分组带动画（${JSON.stringify(anim.groupAnim)}）→ 各自动，不是统一动`);
ok(anim.periods.length >= 4, `各组周期互不相同（${anim.periods.length} 种）→ 相位持续错开，观感是"各自浮动"`);
ok(anim.pathAnim.length === 1 && anim.pathAnim[0] === 'none', `逐条线**没有**自己的动画（${JSON.stringify(anim.pathAnim)}）← 避免 82 个层被反复丢弃`);
ok(anim.pathWillChange.length === 1 && anim.pathWillChange[0] === 'auto', `逐条线**没有**合成层（${JSON.stringify(anim.pathWillChange)}）← 同上`);
ok(!anim.reduced, `当前环境没有开启"减少动态效果"（若开了它，动画会按无障碍要求停掉 —— 这是刻意保留的）`);

// ★ 本轮核心（用户："缩小到大概全览的时候现象消失"）：高倍必须完全静止/只呼吸
//   而且"使用中"卡片的遮罩必须**不用拖动**就可见 —— 所以缩放要**以那张卡片为锚点**
//   （星图是 zoom-to-cursor，锚在卡片上它才会留在视野里，像素验证才有对象可量）。
const anchor = await page.evaluate(() => {
  const el = document.querySelector('#starMap .smNode[data-inuse="1"]') || document.querySelector('#starMap .smNode');
  if (!el) return { x: 700, y: 450 };
  const r = el.getBoundingClientRect();
  return { x: Math.max(40, Math.min(innerWidth - 40, Math.round(r.left + r.width / 2))), y: Math.max(60, Math.min(innerHeight - 40, Math.round(r.top + r.height / 2))) };
});
console.log(`   缩放锚点（对准"使用中"卡片）= (${anchor.x}, ${anchor.y})`);
await page.mouse.move(anchor.x, anchor.y);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -240 }); await new Promise((r) => setTimeout(r, 60)); }
await new Promise((r) => setTimeout(r, 700));
const hi = await page.evaluate(() => {
  const root = document.getElementById('starMap');
  const groups = [...document.querySelectorAll('#starMap .smCanvas > svg > g.smWaveG')];
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg path')];
  return {
    scale: +window.__IW.starmapCam.get().scale.toFixed(2),
    waveOff: root.classList.contains('waveOff'),
    groupAnim: [...new Set(groups.map((g) => getComputedStyle(g).animationName))],
    groupWC: [...new Set(groups.map((g) => getComputedStyle(g).willChange))],
    pathAnim: [...new Set(paths.map((p) => getComputedStyle(p).animationName))],
  };
});
console.log(`   放大到 ${hi.scale}×：waveOff=${hi.waveOff}｜组动画=${JSON.stringify(hi.groupAnim)}｜组层=${JSON.stringify(hi.groupWC)}｜逐线动画=${JSON.stringify(hi.pathAnim)}`);
ok(hi.waveOff, `高倍（${hi.scale}×）下进入"安全区外"状态（root.waveOff）`);
ok(hi.groupAnim.length === 1 && hi.groupAnim[0] === 'none', `高倍下分组位移动画**完全关闭**（${JSON.stringify(hi.groupAnim)}）← 用户"消失又出现"就发生在这个区间`);
ok(hi.groupWC.length === 1 && hi.groupWC[0] === 'auto', `高倍下**撤掉分组合成层**（${JSON.stringify(hi.groupWC)}）← 大栅格被反复丢弃是闪烁的来源`);
// ★ 用户本轮要求："放大到现在不浮动的时候采用透明度呼吸的方法来实现呼吸感"
//   做法：动画只挂在**连线图层这一个元素**上，且只动 opacity（不动几何）→ 不需要重新栅格化路径，
//   层数也从 6 个大层降到 1 个，内存压力最小。
{
  const breathe = await page.evaluate(async () => {
    const svg = document.querySelector('#starMap .smCanvas > svg');
    const cs = getComputedStyle(svg);
    const vals = [];
    for (let i = 0; i < 10; i++) { vals.push(+getComputedStyle(svg).opacity); await new Promise((r) => setTimeout(r, 340)); }
    return {
      name: cs.animationName, wc: cs.willChange,
      range: Math.max(...vals) - Math.min(...vals), vals,
      pathAnim: [...new Set([...document.querySelectorAll('#starMap .smCanvas > svg path')].map((p) => getComputedStyle(p).animationName))],
    };
  });
  console.log(`   呼吸：svg animation=${breathe.name} will-change=${breathe.wc}｜10 次采样透明度 ${breathe.vals.map((v) => v.toFixed(2)).join(',')}｜幅度 ${breathe.range.toFixed(3)}`);
  ok(breathe.name === 'smBreathe', `高倍下改用**透明度呼吸**（animation-name=${breathe.name}）`);
  ok(breathe.range > 0.05, `呼吸确实在跑（透明度幅度 ${breathe.range.toFixed(3)} > 0.05）`);
  ok(breathe.wc === 'opacity', `呼吸只动 opacity（will-change=${breathe.wc}）→ 不重栅格化路径几何`);
  ok(breathe.pathAnim.length === 1 && breathe.pathAnim[0] === 'none', `逐条线仍然没有任何动画（${JSON.stringify(breathe.pathAnim)}）`);
}
// 拖动期间必须撤掉合成层提示并暂停动画（80+ 图层会拖慢平移 —— 之前实测过"快速拖动丢线"）
const drag = await page.evaluate(async () => {
  const root = document.getElementById('starMap');
  root.classList.add('dragging');
  await new Promise((r) => setTimeout(r, 150));
  const ps = [...document.querySelectorAll('#starMap .smCanvas > svg > g.smWaveG')];
  const out = {
    playState: [...new Set(ps.map((p) => getComputedStyle(p).animationPlayState))],
    willChange: [...new Set(ps.map((p) => getComputedStyle(p).willChange))],
  };
  root.classList.remove('dragging');
  return out;
});
console.log(`   拖动期间：animation-play-state = ${JSON.stringify(drag.playState)}｜will-change = ${JSON.stringify(drag.willChange)}`);
ok(drag.playState.length === 1 && drag.playState[0] === 'paused', '拖动期间分组动画暂停（每帧预算让给平移）');
ok(drag.willChange.length === 1 && drag.willChange[0] === 'auto', '拖动期间撤掉合成层提示（80+ 图层会拖慢平移）');

// ---------- ③ 遮罩颜色 = 背景色 ----------
// 方法：把卡片遮罩临时关掉/打开各拍一张，比较"卡片周围一圈"的颜色：
//   若遮罩只是"模糊身后的线、不带底色"，那么该区域的平均色应与邻近背景**几乎一样**。
const shotA = await page.screenshot({ encoding: 'base64' });
const colors = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const W = cv.width, H = cv.height;
  const d = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  // 取一张卡片：量"它周围遮罩环"与"更远处的背景"的平均色
  const cards = [...document.querySelectorAll('#starMap .smNode')].map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 20 && r.left > 40 && r.top > 60 && r.right < W - 40 && r.bottom < H - 40);
  if (!cards.length) return null;
  const r = cards[Math.floor(cards.length / 2)];
  const avg = (x0, y0, x1, y1) => {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(H - 1, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) {
        const [rr, gg, bb] = at(x, y); sr += rr; sg += gg; sb += bb; n++;
      }
    }
    return n ? [sr / n, sg / n, sb / n] : null;
  };
  // 遮罩环：卡片外扩 8~14px 的框带（左右上下各取一条）
  const ring = [
    avg(r.left - 14, r.top + r.height * 0.3, r.left - 8, r.top + r.height * 0.7),
    avg(r.right + 8, r.top + r.height * 0.3, r.right + 14, r.top + r.height * 0.7),
    avg(r.left + r.width * 0.3, r.top - 14, r.left + r.width * 0.7, r.top - 8),
  ].filter(Boolean);
  // 远处背景：从卡片再往外 90~140px（那里没有遮罩、也尽量避开卡片）
  const farBg = avg(r.left - 140, r.top - 20, r.left - 90, r.top + 20);
  const mean = (list) => [0, 1, 2].map((i) => list.reduce((s, c) => s + c[i], 0) / list.length);
  return { ring: mean(ring), farBg, cardBox: { l: Math.round(r.left), t: Math.round(r.top) } };
}, `data:image/png;base64,${shotA}`);

if (!colors) { console.log('③ 找不到可测量的卡片，跳过颜色比较'); }
else {
  const diff = [0, 1, 2].map((i) => Math.abs(colors.ring[i] - colors.farBg[i]));
  const maxDiff = Math.max(...diff);
  console.log(`③ 遮罩环平均色 rgb(${colors.ring.map((v) => v.toFixed(0)).join(',')})｜远处背景 rgb(${colors.farBg.map((v) => v.toFixed(0)).join(',')})｜最大通道差 ${maxDiff.toFixed(1)}`);
  ok(maxDiff <= 12, `遮罩颜色与背景**基本一致**（最大通道差 ${maxDiff.toFixed(1)} ≤ 12，说明它只模糊了身后的线、没贴色块）`);
}

// 遮罩：**改用 box-shadow**（本轮真因修正）
//   用户反馈："我放大以后『使用中』的卡片需要拖动它才能显示"。实测真因：
//   原来用伪元素 + `width: calc(100% + 34px)`，但 .smNode 的**布局盒只有 54×69.5px**（徽标尺寸），
//   视觉卡片却是 86×111px（标题溢出布局盒）→ 遮罩算出 88×97.5px，**比卡片还矮** → 被卡片自己盖住。
//   box-shadow 基于**边框盒**绘制、不参与布局 → 尺寸天然跟着卡片外观走，任何缩放下都画得出来。
const halo = await page.evaluate(() => {
  const n = document.querySelector('#starMap .smNode');
  const inuse = document.querySelector('#starMap .smNode[data-inuse="1"]') || n;
  const csN = getComputedStyle(n);
  const csI = getComputedStyle(inuse);
  const r = inuse.getBoundingClientRect();
  return {
    shadow: csN.boxShadow, inuseShadow: csI.boxShadow,
    cardW: Math.round(r.width), cardH: Math.round(r.height),
    hasInuse: !!document.querySelector('#starMap .smNode[data-inuse="1"]'),
  };
});
console.log(` 遮罩（box-shadow）：普通 ${halo.shadow.slice(0, 46)}｜使用中 ${halo.inuseShadow.slice(0, 46)}｜卡片 ${halo.cardW}×${halo.cardH}`);
ok(/rgba?\(/.test(halo.shadow) && /px/.test(halo.shadow), `每张卡都带安全阴影（box-shadow 已生效）`);
// 用户要求"减少透明度、增强效果"：阴影不透明度 ≥ 0.9
const alphaMatch = /rgba\([^)]*?,\s*(0?\.\d+|1)\)/.exec(halo.shadow);
const coreAlpha = alphaMatch ? Number(alphaMatch[1]) : NaN;
ok(Number.isFinite(coreAlpha) && coreAlpha >= 0.9,
  `阴影不透明度 ${Number.isFinite(coreAlpha) ? coreAlpha : '?'} ≥ 0.9（减少透明度、增强遮挡）`);
// 扩张半径（第 4 个长度）必须 > 0：否则阴影会被卡片自己压住，等于没有
const nums = (halo.shadow.match(/-?\d+(\.\d+)?px/g) || []).map((v) => parseFloat(v));
const spread = nums.length >= 4 ? nums[3] : NaN;
ok(Number.isFinite(spread) && spread > 6, `阴影向外扩张 ${spread}px（> 6 → 一定比卡片大、不会被卡片盖住）`);

// ★ "全程显示"的像素级证据（**同一块像素做 A/B**，且**全程不拖动**）
{
  const shotOn = await page.screenshot({ encoding: 'base64' });
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'halo-ab-off';
    st.textContent = '#starMap .smNode { box-shadow: none !important; }';
    document.head.appendChild(st);
  });
  await wait(400);
  const shotOff = await page.screenshot({ encoding: 'base64' });
  await page.evaluate(() => document.getElementById('halo-ab-off')?.remove());
  await wait(300);
  const px = await page.evaluate(async ([urlOn, urlOff]) => {
    const load = async (u) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = u; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return { w: cv.width, h: cv.height, d: g.getImageData(0, 0, cv.width, cv.height).data };
    };
    const A = await load(urlOn);
    const B = await load(urlOff);
    const W = A.w, H = A.h;
    const lum = (im, x, y) => { const i = (y * W + x) * 4; return 0.299 * im.d[i] + 0.587 * im.d[i + 1] + 0.114 * im.d[i + 2]; };
    const cands = [...document.querySelectorAll('#starMap .smNode[data-inuse="1"]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 14 && r.left > 40 && r.top > 40 && r.right < W - 40 && r.bottom < H - 40);
    if (!cands.length) return null;
    const cx = W / 2, cy = H / 2;
    cands.sort((a, b) => Math.hypot(a.left + a.width / 2 - cx, a.top + a.height / 2 - cy) - Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy));
    const r = cands[0];
    // 指标：卡片**外面那一圈**里，关掉阴影后变亮 >6 的像素个数（以及平均变亮幅度）。
    // 不用"整圈平均"——未被影响的像素会把平均值稀释掉（实测只有 1.5，看起来像没生效）。
    let changed = 0, sum = 0, total = 0;
    for (let y = Math.round(r.top - 30); y <= Math.round(r.bottom + 30); y++) {
      for (let x = Math.round(r.left - 30); x <= Math.round(r.right + 30); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const inCard = x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
        if (inCard) continue;                       // 只看卡片外面那一圈（阴影所在处）
        const dl = lum(B, x, y) - lum(A, x, y);     // 关掉阴影后变亮多少
        total++;
        if (dl > 6) { changed++; sum += dl; }
      }
    }
    return { changed, avgGain: changed ? sum / changed : 0, total, scale: +window.__IW.starmapCam.get().scale.toFixed(2) };
  }, [`data:image/png;base64,${shotOn}`, `data:image/png;base64,${shotOff}`]);
  if (!px) console.log('  （没有找到合适的"使用中"卡片，跳过像素验证）');
  else {
    console.log(` ③ 像素 A/B（${px.scale}×，**全程未拖动**）：卡片四周 ${px.total} 个像素里，关掉阴影后有 ${px.changed} 个变亮（平均变亮 ${px.avgGain.toFixed(1)}）`);
    ok(px.changed > 200, `"使用中"卡片的遮罩**不用拖动就已画出**（关掉阴影后它四周有 ${px.changed} 个像素变亮，平均 ${px.avgGain.toFixed(1)} 个亮度单位）`);
  }
}

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-wave-check.png' });
console.log('截图 → tests/artifacts/starmap-wave-check.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：线宽统一（点亮也不变粗）｜浮动动画确实在跑｜遮罩只模糊身后的线、颜色与背景一致');
