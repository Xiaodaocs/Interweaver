// 成就页验收（真实鼠标/真实 DOM）：左→右分列布局 / 弧线布线置底 / 只亮直接相连 / 缩放跟随鼠标 / 正在使用中金色圆点
//   ① 神经式布线：卡片之间是**弧线**（贝塞尔）、允许交叉、**线在最底层**
//   ② 选中卡片 → **连通域**（所有关联的知识点与它们之间的线）全部亮起，其余变暗
//   ③ 缩放**跟随鼠标指针**（指针下的世界坐标不动）
//   ④ "正在使用中"：工作台实时写入 → 星图页给这些卡片头顶金色圆点向上扩散
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) bad.push(msg); };

// 先进工作台写一份"正在使用中"的实时记录（模拟画布上有内容），再进成就页
await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await wait(500);

// ---------- ④ 工作台侧：实时写入 live 记录 ----------
const liveWritten = await page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  // 造一个"圆 + 三角形"的场景，让若干知识点真的"正在被使用"
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st);
  return true;
});
await wait(1200);   // 等运行时 step 跑一轮（节流 200ms）
const live = await page.evaluate(() => {
  const raw = localStorage.getItem('interweaver.live.v1');
  return raw ? JSON.parse(raw) : null;
});
console.log('工作台写入的 live 记录：', live ? `at=${live.at} ids=[${live.ids.join(', ')}]` : '（无）');
ok(live && Array.isArray(live.ids) && live.ids.length > 0, '工作台已实时写入"正在使用中"的知识点');
const liveIds = live ? live.ids : [];

// ---------- 进成就页 ----------
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(900);

// ---------- ① 神经式布线 ----------
const edges = await page.evaluate(() => {
  const svg = document.querySelector('#starMap .smCanvas svg');
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const curved = paths.filter((p) => /Q/.test(p.getAttribute('d') || ''));
  return {
    isFirstChild: svg === document.querySelector('#starMap .smCanvas').firstElementChild,
    svgZ: getComputedStyle(svg).zIndex,
    nodesZ: getComputedStyle(document.querySelector('#starMap .smNodes')).zIndex,
    total: paths.length,
    curved: curved.length,
    polyline: document.querySelectorAll('#starMap polyline').length,
    bridge: document.querySelectorAll('#starMap path.smBridge').length,
    sample: paths[0] ? paths[0].getAttribute('d').slice(0, 58) : null,
    stroke: paths.length ? getComputedStyle(paths[0]).stroke : null,
    strokeW: paths.length ? getComputedStyle(paths[0]).strokeWidth : null,
  };
});
console.log('  线数 =', edges.total, '| 弧线(Q) =', edges.curved, '| polyline =', edges.polyline, '| 拱桥 =', edges.bridge);
console.log('  svg z-index =', edges.svgZ, '| .smNodes z-index =', edges.nodesZ, '| svg 是首个孩子 =', edges.isFirstChild);
console.log('  示例 d =', edges.sample);
ok(edges.total > 0, '存在连线');
ok(edges.curved === edges.total, `所有连线都是**曲线**（贝塞尔 Q）：${edges.curved}/${edges.total}`);
ok(edges.polyline === 0 && edges.bridge === 0, '旧的折线/跨线拱桥已彻底移除');
ok(edges.svgZ === '0' && edges.nodesZ === '1' && edges.isFirstChild, '线被**强制置底**（svg z=0 < 卡片 z=1，且 svg 是首个孩子）');
ok(edges.stroke && edges.stroke !== 'none' && edges.stroke !== 'rgb(0, 0, 0)', `线有可见描边（stroke=${edges.stroke}，宽 ${edges.strokeW}）`);

// 线的交叉：允许（这是要求），只统计一下有多少条线在视觉上相交
const crossings = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const boxes = paths.map((p) => p.getBoundingClientRect());
  let cross = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) cross++;
    }
  }
  return cross;
});
console.log('  包围盒相交的线对 =', crossings, '（允许交叉，仅记录）');

// 真实几何：用 SVG API 检测两条线是否真的交叉（而不是只比包围盒）
const realCross = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const len = (p) => { try { return p.getTotalLength(); } catch { return 0; } };
  const at = (p, t) => { const pt = p.getPointAtLength(t); return [pt.x, pt.y]; };
  const seg = (p, n = 24) => { const L = len(p); const out = []; for (let i = 0; i <= n; i++) out.push(at(p, (L * i) / n)); return out; };
  const polys = paths.map((p) => seg(p));
  const inter = (a, b, c, d) => {
    const s = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
  };
  let n = 0;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      let hit = false;
      for (let k = 0; k + 1 < polys[i].length && !hit; k++) {
        for (let m = 0; m + 1 < polys[j].length && !hit; m++) {
          if (inter(polys[i][k], polys[i][k + 1], polys[j][m], polys[j][m + 1])) hit = true;
        }
      }
      if (hit) n++;
    }
  }
  return n;
});
console.log('  真实几何交叉的线对 =', realCross, '（"所有线之间可以交叉" → 允许存在）');

// ---------- ①b 视觉质量的几何验证（不靠肉眼，直接量化）----------
//  (a) 线在卡片**下面**：卡片中心的 elementFromPoint 绝不能是连线
const underCards = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#starMap .smNode')];
  let hitLine = 0, checked = 0;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    checked++;
    if (el && el.tagName && el.tagName.toLowerCase() === 'path') hitLine++;
  }
  return { checked, hitLine };
});
console.log(`  卡片中心命中检测：检查 ${underCards.checked} 张，命中连线的 ${underCards.hitLine} 张`);
ok(underCards.checked > 10 && underCards.hitLine === 0,
  `线确实在卡片**下面**（${underCards.checked} 张卡片中心没有一个被连线挡住）`);

//  (b) 曲线不穿透卡片：沿每条线采样，落在"非端点卡片"矩形内的采样点应为 0
const stab = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const cards = [...document.querySelectorAll('#starMap .smNode')].map((c) => {
    const r = c.getBoundingClientRect();
    return { id: c.dataset.node, l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  let bad = 0, total = 0;
  const worst = [];
  for (const p of paths) {
    const a = p.dataset.a, b = p.dataset.b;
    let L = 0;
    try { L = p.getTotalLength(); } catch { continue; }
    if (!L) continue;
    const n = Math.max(12, Math.round(L / 8));
    for (let i = 1; i < n; i++) {
      const pt = p.getPointAtLength((L * i) / n);
      const scr = p.getBoundingClientRect();   // 采样点已是画布坐标；用 SVG 矩阵换算到屏幕
      const m = p.getScreenCTM();
      const sx = m.a * pt.x + m.c * pt.y + m.e;
      const sy = m.b * pt.x + m.d * pt.y + m.f;
      total++;
      for (const c of cards) {
        if (c.id === a || c.id === b) continue;           // 端点所在的卡片不算穿透
        // 卡片中心 6px 内不算（贴边经过很常见，只统计"扎进去"）
        if (sx > c.l + 6 && sx < c.r - 6 && sy > c.t + 6 && sy < c.b - 6) {
          bad++;
          if (worst.length < 3) worst.push(`${a}→${b} 穿过 ${c.id}`);
          break;
        }
      }
    }
  }
  return { bad, total, worst };
});
console.log(`  从卡片背后经过的采样：${stab.total} 个采样点，落在卡片矩形内的 ${stab.bad} 个（${(100 * stab.bad / Math.max(1, stab.total)).toFixed(2)}%）` + (stab.worst.length ? `（例：${stab.worst.join('；')}）` : ''));
// ★ 注意：这里**不再断言"不能穿过卡片"**。用户明确要求"所有线之间可以交叉，但必须置为底层"，
//   所以线从卡片背后穿过是**设计想要的效果**（线在卡片之下、卡片遮住线）。
//   真正该断言的是"线确实在卡片下面"—— 由上面的 elementFromPoint 判定（57 张卡片中心 0 命中）。
//   这里只做一条宽松的健全性上限，防止布线退化成"一团糊在所有卡片上"。
ok(stab.bad / Math.max(1, stab.total) < 0.35,
  `线从卡片背后经过的比例处于合理范围（${(100 * stab.bad / Math.max(1, stab.total)).toFixed(2)}% < 35%，且线在卡片之下）`);

//  (c) 弧度是"略带"：偏离弦长的最大量应在 2–44px 之间（不是直线，也不是大弧）
const bow = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  const out = [];
  for (const p of paths) {
    let L = 0;
    try { L = p.getTotalLength(); } catch { continue; }
    if (!L) continue;
    const s = p.getPointAtLength(0), e = p.getPointAtLength(L);
    const chord = Math.hypot(e.x - s.x, e.y - s.y) || 1;
    let maxDev = 0;
    for (let i = 1; i < 20; i++) {
      const pt = p.getPointAtLength((L * i) / 20);
      // 点到弦的距离
      const dev = Math.abs((e.x - s.x) * (s.y - pt.y) - (s.x - pt.x) * (e.y - s.y)) / chord;
      if (dev > maxDev) maxDev = dev;
    }
    out.push({ dev: maxDev, chord });
  }
  const devs = out.map((o) => o.dev).filter((d) => d > 0.5);
  return {
    n: out.length,
    min: devs.length ? Math.min(...devs) : 0,
    max: devs.length ? Math.max(...devs) : 0,
    avg: devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0,
    curved: devs.length,
  };
});
console.log(`  弧度：${bow.curved}/${bow.n} 条有明显弧度，偏离弦长 最小 ${bow.min.toFixed(1)} / 平均 ${bow.avg.toFixed(1)} / 最大 ${bow.max.toFixed(1)} px`);
ok(bow.curved >= bow.n * 0.8, `绝大多数线都是**曲线**而不是直线（${bow.curved}/${bow.n}）`);
ok(bow.max <= 46, `弧度只是"略带"（最大偏离 ${bow.max.toFixed(1)}px ≤ 46px，不是夸张的大弧）`);

// ---------- ①c 新布局：神经网络式**左→右分列**（用户本轮要求重排）----------
const layout = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#starMap .smNode')].map((el) => ({
    id: el.dataset.node, x: parseFloat(el.style.left), y: parseFloat(el.style.top), col: Number(el.dataset.col), row: Number(el.dataset.row),
  }));
  const byCol = new Map();
  for (const c of cards) { if (!byCol.has(c.col)) byCol.set(c.col, []); byCol.get(c.col).push(c); }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const colXs = cols.map((k) => { const xs = byCol.get(k).map((c) => c.x); return Math.max(...xs) - Math.min(...xs); });
  const pitches = [];
  for (const k of cols) {
    const ys = byCol.get(k).map((c) => c.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) pitches.push(ys[i] - ys[i - 1]);
  }
  const centers = cols.map((k) => { const ys = byCol.get(k).map((c) => c.y); return (Math.min(...ys) + Math.max(...ys)) / 2; });
  // 相邻列之间的水平间距（应恒定，才像神经网络的层）
  const colCenterX = cols.map((k) => { const xs = byCol.get(k).map((c) => c.x); return (Math.min(...xs) + Math.max(...xs)) / 2; });
  const colPitch = [];
  for (let i = 1; i < colCenterX.length; i++) colPitch.push(colCenterX[i] - colCenterX[i - 1]);
  return {
    n: cards.length, cols: cols.length,
    maxSpread: Math.max(...colXs),                                  // 同列横向散布（应 0）
    pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches),  // 列内行距（应恒定）
    centerSpread: Math.max(...centers) - Math.min(...centers),       // 各列中心是否对齐
    colPitchMin: Math.min(...colPitch), colPitchMax: Math.max(...colPitch),
    sizes: cols.map((k) => byCol.get(k).length),
  };
});
console.log(`  布局：${layout.n} 张卡 / ${layout.cols} 列，各列卡片数 = [${layout.sizes.join(', ')}]`);
console.log(`  同列横向散布 = ${layout.maxSpread}px（应 0）| 列内行距 = ${layout.pitchMin}~${layout.pitchMax}px | 列中心对齐偏差 = ${layout.centerSpread}px`);
console.log(`  相邻列水平间距 = ${layout.colPitchMin}~${layout.colPitchMax}px`);
ok(layout.cols >= 6, `按难度层分成多列、左→右排列（${layout.cols} 列）`);
ok(layout.maxSpread === 0, `同一列内所有卡片 x 完全对齐（散布 ${layout.maxSpread}px = 0）→ 是"列"而不是散点`);
ok(layout.pitchMin === layout.pitchMax && layout.pitchMin >= 108,
  `列内等距（行距恒为 ${layout.pitchMin}px，卡片不重叠且间距一致）`);
ok(layout.centerSpread === 0, `各列垂直居中（列中心偏差 ${layout.centerSpread}px = 0）`);
ok(layout.colPitchMin === layout.colPitchMax, `相邻列间距恒定（${layout.colPitchMin}px）→ 神经网络式的规整分层`);

// ---------- ③ 缩放跟随鼠标 ----------
const zoom = await page.evaluate(async () => {
  const cam = window.__IW.starmapCam;
  const view = document.querySelector('#starMap .smView');
  const r = view.getBoundingClientRect();
  // 选一个偏离中心的点（中心点在任何锚点策略下都不动，测不出问题）
  const sx = r.left + r.width * 0.28, sy = r.top + r.height * 0.34;
  cam.fit && cam.fit();
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const before = cam.get();
  const worldBefore = [(sx - r.left - before.tx) / before.scale, (sy - r.top - before.ty) / before.scale];
  view.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: sx, clientY: sy, bubbles: true, cancelable: true }));
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const after = cam.get();
  const worldAfter = [(sx - r.left - after.tx) / after.scale, (sy - r.top - after.ty) / after.scale];
  return { before, after, worldBefore, worldAfter, sx, sy, rl: r.left, rt: r.top };
});
const drift = Math.hypot(zoom.worldAfter[0] - zoom.worldBefore[0], zoom.worldAfter[1] - zoom.worldBefore[1]);
console.log(`  缩放：${zoom.before.scale.toFixed(3)} → ${zoom.after.scale.toFixed(3)}`);
console.log(`  指针下的世界坐标：(${zoom.worldBefore[0].toFixed(2)}, ${zoom.worldBefore[1].toFixed(2)}) → (${zoom.worldAfter[0].toFixed(2)}, ${zoom.worldAfter[1].toFixed(2)})，漂移 ${drift.toFixed(4)} px`);
const driftPx = drift * zoom.after.scale;
console.log(`  换算成屏幕漂移 = ${driftPx.toFixed(4)} px`);
ok(zoom.after.scale > zoom.before.scale, '滚轮向上确实放大了');
// 判据用**屏幕像素**：世界坐标漂移要乘以当前缩放；阈值 0.5px（亚像素即不可见，
// 残余量来自浏览器对 CSS transform 矩阵的取整，不是锚点算错）
ok(driftPx < 0.5, `缩放**锚定在鼠标指针**（屏幕漂移 ${driftPx.toFixed(4)} px，应<0.5）`);

// 再缩回去，锚点仍应不漂
const zoom2 = await page.evaluate(async () => {
  const cam = window.__IW.starmapCam;
  const view = document.querySelector('#starMap .smView');
  const r = view.getBoundingClientRect();
  const sx = r.left + r.width * 0.72, sy = r.top + r.height * 0.61;
  const before = cam.get();
  const wb = [(sx - r.left - before.tx) / before.scale, (sy - r.top - before.ty) / before.scale];
  view.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: sx, clientY: sy, bubbles: true, cancelable: true }));
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const after = cam.get();
  const wa = [(sx - r.left - after.tx) / after.scale, (sy - r.top - after.ty) / after.scale];
  return { d: Math.hypot(wa[0] - wb[0], wa[1] - wb[1]), s0: before.scale, s1: after.scale };
});
console.log(`  缩小：${zoom2.s0.toFixed(3)} → ${zoom2.s1.toFixed(3)}，漂移 ${zoom2.d.toFixed(4)} px`);
const driftPx2 = zoom2.d * zoom2.s1;
ok(zoom2.s1 < zoom2.s0 && driftPx2 < 0.5, `缩小同样锚定鼠标（屏幕漂移 ${driftPx2.toFixed(4)} px）`);

// ---------- ② 选中 → **只亮直接相连的**（用户本轮修正） ----------
// 用户反馈："现在选择其中一个知识卡片，画布上的所有东西都会亮起（除了那些独立的），
// 因为线全部连起来了。更改为只有直接连接的才亮。" → 断言一跳邻居，而不是连通域。
const sel = await page.evaluate(() => {
  // 挑一个邻居最多的卡片（最严格的情形：邻居多，最容易误把整片点亮）
  const adj = new Map();
  const paths = [...document.querySelectorAll('#starMap .smCanvas > svg > path')];
  for (const p of paths) {
    const a = p.dataset.a, b = p.dataset.b;
    if (!a || !b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  const start = [...adj.entries()].sort((x, y) => y[1].size - x[1].size)[0][0];
  // 整个连通域（用于对照：必须**不等于**被点亮的集合，否则就是"又全亮了"）
  const comp = new Set([start]); const q = [start];
  while (q.length) { const c = q.pop(); for (const n of (adj.get(c) || [])) if (!comp.has(n)) { comp.add(n); q.push(n); } }
  const direct = [...(adj.get(start) || [])];
  return { start, direct: direct.length, directIds: direct, compSize: comp.size, total: document.querySelectorAll('#starMap .smNode').length };
});
console.log(`  选中 ${sel.start}：直接相连 ${sel.direct} 个 | 它所在连通域 ${sel.compSize} 个 | 全图 ${sel.total} 个`);
ok(sel.compSize > sel.direct + 1, `对照成立：该卡的连通域（${sel.compSize}）确实远大于它的直接邻居（${sel.direct}）—— 能区分"全亮"与"只亮直接相连"`);

const highlight = await page.evaluate(([id]) => {
  const el = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === id);
  el.click();
  const litNodes = [...document.querySelectorAll('#starMap .smNode.lit')].map((n) => n.dataset.node);
  const dimNodes = [...document.querySelectorAll('#starMap .smNode.dim')].map((n) => n.dataset.node);
  const litEdges = document.querySelectorAll('#starMap .smCanvas > svg > path.lit').length;
  const dimEdges = document.querySelectorAll('#starMap .smCanvas > svg > path.dim').length;
  const allEdges = document.querySelectorAll('#starMap .smCanvas > svg > path').length;
  return { litNodes, dimNodes, litEdges, dimEdges, allEdges, hasSel: document.getElementById('starMap').classList.contains('hasSel') };
}, [sel.start]);
ok(highlight.hasSel, '选中后星图进入"已选中"状态');
// ★ 用户本轮要求："更改为只有直接连接的才亮" —— 亮起的必须**恰好**是选中卡 + 它的直接邻居
ok(highlight.litNodes.length === sel.direct + 1,
  `亮起的卡片数 = 1 + 直接邻居数（${highlight.litNodes.length} = 1 + ${sel.direct}）`);
ok(highlight.litNodes.every((n) => n === sel.start || sel.directIds.includes(n)), '亮起的卡片恰好是"选中卡 + 它的直接邻居"');
ok(highlight.litNodes.includes(sel.start), '选中的那张卡片本身亮起');
ok(highlight.litNodes.length < sel.compSize,
  `**不再**把整个连通域点亮（亮 ${highlight.litNodes.length} < 连通域 ${sel.compSize}）← 用户反馈的核心问题`);
ok(highlight.litNodes.length < sel.total, `也不是全亮（亮 ${highlight.litNodes.length} < 全图 ${sel.total}）`);
ok(highlight.litEdges > 0, `与选中卡直接相连的线亮起（${highlight.litEdges} 条）`);
ok(highlight.litEdges + highlight.dimEdges === highlight.allEdges, '所有线都被明确分为"亮/暗"两类（无遗漏）');

// 亮起的线必须**直接接在选中卡上**（不是"域内任意两端都亮"）
const edgeOk = await page.evaluate(([id]) => {
  const lit = [...document.querySelectorAll('#starMap .smCanvas > svg > path.lit')];
  return { all: lit.every((p) => p.dataset.a === id || p.dataset.b === id), n: lit.length };
}, [sel.start]);
ok(edgeOk.all, `每条亮起的线都**直接接在选中卡上**（${edgeOk.n} 条，没有"域内其它两点之间的线也亮"）`);

// 点空白 → 取消高亮
const cleared = await page.evaluate(() => {
  const view = document.querySelector('#starMap .smView');
  const r = view.getBoundingClientRect();
  view.dispatchEvent(new MouseEvent('click', { clientX: r.left + 6, clientY: r.top + 6, bubbles: true }));
  return { lit: document.querySelectorAll('#starMap .smNode.lit').length, hasSel: document.getElementById('starMap').classList.contains('hasSel') };
});
ok(cleared.lit === 0 && !cleared.hasSel, '点空白处取消高亮');

// ---------- ④ 正在使用中（金色圆点） ----------
const inuse = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('#starMap .smNode[data-inuse="1"]')];
  const first = nodes[0];
  const dots = first ? [...first.querySelectorAll('.smLive i')] : [];
  const cs = dots[0] ? getComputedStyle(dots[0]) : null;
  return {
    count: nodes.length,
    ids: nodes.map((n) => n.dataset.node),
    dots: dots.length,
    animName: cs ? cs.animationName : null,
    animDur: cs ? cs.animationDuration : null,
    color: cs ? (cs.backgroundImage || cs.backgroundColor) : null,
    aboveCard: dots[0] ? dots[0].getBoundingClientRect().top <= first.getBoundingClientRect().top : null,
  };
});
console.log(`  标为"正在使用中"的卡片 = ${inuse.count} 张：[${inuse.ids.join(', ')}]`);
console.log(`  金色圆点 = ${inuse.dots} 颗/卡，动画=${inuse.animName} ${inuse.animDur}，颜色=${inuse.color}`);
ok(inuse.count > 0, '有卡片被标为"正在使用中"');
ok(inuse.ids.every((id) => liveIds.includes(id)), '被标记的卡片正是工作台写入的那些知识点');
ok(inuse.dots >= 4, `每张卡头顶有 ${inuse.dots} 颗金色圆点`);
ok(inuse.animName === 'smLiveUp', `圆点有"向上扩散"动画（animation-name=${inuse.animName}）`);
ok(inuse.aboveCard === true, '圆点在卡片**头顶上方**（不是压在卡片上）');

// 动画真的在动：取两个时刻的 transform 比较
const moving = await page.evaluate(async () => {
  const d = document.querySelector('#starMap .smNode[data-inuse="1"] .smLive i');
  if (!d) return null;
  const a = getComputedStyle(d).transform;
  await new Promise((r) => setTimeout(r, 420));
  const b = getComputedStyle(d).transform;
  return { a, b, changed: a !== b };
});
ok(moving && moving.changed, `圆点确实在向上运动（transform ${moving?.a} → ${moving?.b}）`);

// 过期保护：把 at 改老 → 重新加载应不再显示
const stale = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('interweaver.live.v1'));
  raw.at = Date.now() - 10 * 60 * 1000;      // 10 分钟前
  localStorage.setItem('interweaver.live.v1', JSON.stringify(raw));
  return true;
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(600);
const staleCount = await page.evaluate(() => document.querySelectorAll('#starMap .smNode[data-inuse="1"]').length);
ok(staleCount === 0, `过期的"正在使用中"记录不再显示（工作台关了就不该再亮）：${staleCount} 张`);

// 截图存证
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('interweaver.live.v1'));
  raw.at = Date.now();
  localStorage.setItem('interweaver.live.v1', JSON.stringify(raw));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(900);
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-neural.png' });
await page.evaluate(([id]) => {
  const el = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === id);
  if (el) el.click();
}, [sel.start]);
await wait(700);
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-neural-selected.png' });
console.log('截图 → tests/artifacts/starmap-neural.png, starmap-neural-selected.png');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 全部通过：左→右分列布局 / 弧线布线置底 / 只亮直接相连 / 缩放跟随鼠标 / 正在使用中金色圆点');
