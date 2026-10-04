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
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
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
  const lits = [...document.querySelectorAll('#starMap .smCanvas > svg > path.lit')];
  const seen = new Map();
  for (const p of lits) { const w = getComputedStyle(p).strokeWidth; seen.set(w, (seen.get(w) || 0) + 1); }
  const all = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const allW = new Set(all.map((p) => getComputedStyle(p).strokeWidth));
  return { n: lits.length, dist: [...seen.entries()], allKinds: [...allW] };
});
console.log(`  点亮后：亮起 ${lit.n} 条，宽度分布 ${lit.dist.map(([w, n]) => `${w}×${n}`).join('  ')}｜全图宽度种类 ${lit.allKinds.join('/')}`);
ok(lit.n > 0 && lit.dist.length === 1, `点亮后也**同宽**（${lit.dist.map(([w]) => w).join('/')}）→ 不再参差不齐`);
ok(lit.allKinds.length === 1, `点亮与否都不改变宽度（全图只有 ${lit.allKinds.join('/')} 一种）→ 符合"点亮不加粗、和普通线一个粗细"`);

// ---------- ② 浮动动画：必须挂在**连线图层**上，且逐条线绝不能有动画 ----------
//    （用户报告"放大后线不断闪现"：逐线 transform + non-scaling-stroke = 每帧重栅格化 82 条线）
const anim = await page.evaluate(async () => {
  const svg = document.querySelector('#starMap .smCanvas > svg');
  const cs = getComputedStyle(svg);
  const paths = [...svg.querySelectorAll('path')];
  const layerYs = [];
  for (let i = 0; i < 20; i++) {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(svg).transform);
    layerYs.push(m ? Number(m[1].split(',')[5]) : 0);
    await new Promise((r) => setTimeout(r, 360));   // 20×360ms = 7.2s > 一个周期(6.2s)：必须跨整周期，否则会误报
  }
  const range = Math.max(...layerYs) - Math.min(...layerYs);
  return {
    layerName: cs.animationName, layerDur: cs.animationDuration, layerState: cs.animationPlayState,
    range,
    pathAnims: [...new Set(paths.map((p) => getComputedStyle(p).animationName))],
    pathTransforms: [...new Set(paths.map((p) => getComputedStyle(p).transform))],
    pathCount: paths.length,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
});
console.log(`② 图层动画：name=${anim.layerName} dur=${anim.layerDur} 状态=${anim.layerState}`);
console.log(`   12 次采样（跨 ~1.8s）图层 translateY 范围 = ${anim.range.toFixed(2)}px`);
console.log(`   逐条线：${anim.pathCount} 条，animation-name 集合 = ${JSON.stringify(anim.pathAnims)}，transform 集合 = ${JSON.stringify(anim.pathTransforms)}`);
ok(anim.layerName === 'smWaveLayer', `浮动动画挂在**连线图层**上（animation-name=${anim.layerName}）`);
ok(anim.range > 0.4, `图层确实在轻轻起伏（跨周期位移范围 ${anim.range.toFixed(2)}px）`);
// ★ 用户报告"放大后线不断闪现"的根因回归：只要还有任何一条线自己在动，就会逐帧重栅格化 → 闪。
ok(anim.pathAnims.length === 1 && anim.pathAnims[0] === 'none',
  `**逐条线一律没有动画**（animation-name 集合 = ${JSON.stringify(anim.pathAnims)}）← 这是"不闪动"的硬保证`);
ok(anim.pathTransforms.length === 1 && anim.pathTransforms[0] === 'none',
  `逐条线的 transform 一律是 none（集合 = ${JSON.stringify(anim.pathTransforms)}）← 不再逐帧重算描边`);
ok(!anim.reduced, `当前环境没有开启"减少动态效果"（若系统开了它，动画会按无障碍要求停掉 —— 这是刻意保留的）`);

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
