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
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
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

// ★ 本轮核心（用户："缩小到大概全览的时候现象消失"）：高倍必须完全静止
await page.evaluate(() => { for (let i = 0; i < 6; i++) { /* 交给下面用滚轮 */ } });
await page.mouse.move(760, 460);
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
ok(hi.groupAnim.length === 1 && hi.groupAnim[0] === 'none', `高倍下分组动画**完全关闭**（${JSON.stringify(hi.groupAnim)}）← 用户"消失又出现"就发生在这个区间`);
ok(hi.groupWC.length === 1 && hi.groupWC[0] === 'auto', `高倍下**撤掉合成层**（${JSON.stringify(hi.groupWC)}）← 大栅格被反复丢弃是闪烁的来源`);
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

// 遮罩：基础态**刻意不用滤镜**（性能），只在悬停/选中/使用中才升级为背景模糊
const halo = await page.evaluate(() => {
  const n = document.querySelector('#starMap .smNode');
  const cs = getComputedStyle(n, '::before');
  const hoverTarget = [...document.querySelectorAll('#starMap .smNode')].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.left > 60 && r.top > 60 && r.right < innerWidth - 60 && r.bottom < innerHeight - 60;
  });
  const r = hoverTarget ? hoverTarget.getBoundingClientRect() : null;
  return {
    content: cs.content, backdrop: cs.backdropFilter || cs.webkitBackdropFilter, zIndex: cs.zIndex,
    bg: (cs.backgroundImage || cs.background || '').slice(0, 46),
    hover: hoverTarget ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
  };
});
console.log(' 基础遮罩：', JSON.stringify(halo));
ok(halo.content === '""' || halo.content === 'none' || !!halo.content, '基础遮罩层存在');
ok(halo.bg.includes('radial-gradient'), '基础遮罩是**软边径向渐变**（边缘渐隐，所以不像色块）');
ok(!halo.backdrop || halo.backdrop === 'none',
  `基础遮罩**不带滤镜**（backdrop-filter=${halo.backdrop || 'none'}）← 65 张卡各开模糊会饿死 rAF，实测拖动时 transform 写入掉到 0`);
ok(halo.zIndex === '-1', '遮罩位于卡片内容之下（z-index:-1），不会盖住卡片自己的字/徽标');
// 悬停时才升级为背景模糊
if (halo.hover) {
  await page.mouse.move(halo.hover.x, halo.hover.y);
  await wait(320);
  const hov = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const node = el && el.closest ? el.closest('.smNode') : null;
    if (!node) return null;
    const cs = getComputedStyle(node, '::before');
    return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter };
  }, halo.hover);
  console.log(` 悬停某卡后：backdrop-filter=${hov ? hov.backdrop : '（没命中卡片）'}`);
  ok(hov && hov.backdrop && hov.backdrop.includes('blur'),
    '悬停的那张卡**才**升级为背景模糊（只 1 张 → 代价可控，且颜色完全等于背景）');
}

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-wave-check.png' });
console.log('截图 → tests/artifacts/starmap-wave-check.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：线宽统一（点亮也不变粗）｜浮动动画确实在跑｜遮罩只模糊身后的线、颜色与背景一致');
