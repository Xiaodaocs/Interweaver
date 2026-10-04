// 用户给的**具体例子**验收：选中"三角函数"时，圆、三角形、关联…以及它们之间的线都要亮起。
// 同时验收"正在使用中"在**更丰富的画布内容**下能标出多张卡片。
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
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await wait(400);

// ---------- 画布上放一个"圆 + 三角形 + 关联"的丰富场景 ----------
await page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  const C = S.addEntity(st, 'circle', { cx: -3, cy: 0, r: 2.2 });
  S.ensureEvaluated(st);
  // 圆上两点 + 弦 → 三角形/弦/直径/线上点 等知识点都会"正在使用中"
  const a = S.addEdgePoint(st, C.id, 0.4);
  const b = S.addEdgePoint(st, C.id, 2.2);
  S.ensureEvaluated(st);
  const T = S.addEntity(st, 'segment', { x1: -8, y1: -3, x2: -8, y2: 3 });
  S.ensureEvaluated(st);
  void a; void b; void T;
  window.__IW.renderOnce();
});
await wait(1500);   // 等运行时判定（节流 200ms + 稳定 500ms）

const live = await page.evaluate(() => {
  const raw = localStorage.getItem('interweaver.live.v1');
  const d = raw ? JSON.parse(raw) : null;
  return d ? d.ids : [];
});
console.log('画布内容 → 正在使用中的知识点：[' + live.join(', ') + ']');
ok(live.length >= 2, `丰富画布下能标出多张"正在使用中"的卡片（${live.length} 张）`);

// ---------- 进成就页，按用户的例子选中"三角函数" ----------
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(900);

const inuse = await page.evaluate(() => [...document.querySelectorAll('#starMap .smNode[data-inuse="1"]')].map((n) => n.dataset.node));
console.log('星图页标为"正在使用中"：[' + inuse.join(', ') + ']');
ok(inuse.length >= 2, `星图页确实给多张卡片加了"正在使用中"效果（${inuse.length} 张）`);
ok(inuse.every((id) => live.includes(id)), '标记的卡片与工作台写入的一致');

// 用户原话的例子：选中"三角函数"
const example = await page.evaluate(() => {
  const titleOf = (id) => {
    const el = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === id);
    return el ? (el.querySelector('.smCap')?.textContent || id) : id;
  };
  const sine = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === 'n.sine');
  if (!sine) return { none: true };
  sine.click();
  const lit = [...document.querySelectorAll('#starMap .smNode.lit')].map((n) => n.dataset.node);
  const litTitles = lit.map(titleOf);
  return {
    sineTitle: titleOf('n.sine'),
    litCount: lit.length,
    litTitles,
    hasCircle: lit.includes('n.circle'),
    hasTriangle: lit.includes('n.triangle'),
    hasBinding: lit.includes('n.binding'),
    litEdges: document.querySelectorAll('#starMap .smCanvas > svg path.lit').length,
  };
});
if (example.none) { console.log('  ✗ 星图里找不到"三角函数"卡片'); bad.push('找不到 n.sine'); }
else {
  console.log(`选中「${example.sineTitle}」→ 亮起 ${example.litCount} 个知识点：${example.litTitles.slice(0, 14).join('、')}${example.litTitles.length > 14 ? ' …' : ''}`);
  console.log(`  直接邻居：圆=${example.hasCircle} 三角形=${example.hasTriangle} 关联=${example.hasBinding} 亮起的线=${example.litEdges} 条`);
  ok(example.litCount > 1, '选中三角函数后亮起的不止它自己');
  // ★ 本轮用户修正："更改为只有直接连接的才亮"。
  //   所以这里断言的是**一跳邻居**：正弦波的直接邻居是 函数曲线/切线/欧拉之环/滑杆驱动的波/
  //   圆与波同源/三角形（最后这条是上一轮按用户举例补的跨组同源桥）。
  //   「圆」「关联」与正弦波隔了 2 跳以上 → **不该亮** —— 这正是本轮修改生效的证据。
  ok(example.hasTriangle, '「三角形」是正弦波的**直接**邻居 → 亮起（跨组同源桥那条边）');
  ok(!example.hasCircle, '「圆」与正弦波不是直接相连 → **不亮**（本轮"只亮直接相连"生效）');
  ok(!example.hasBinding, '「关联」与正弦波不是直接相连 → **不亮**（本轮"只亮直接相连"生效）');
  ok(example.litCount < 15, `亮起的数量很小（${example.litCount} 个），不再是"整片亮起"`);
  ok(example.litEdges > 0, `与它直接相连的线亮起（${example.litEdges} 条）`);
}

await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-example-sine.png' });
console.log('截图 → tests/artifacts/starmap-example-sine.png');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：高亮只亮**直接相连**的（用户本轮修正）—— 选中正弦波时「三角形」这类直接邻居亮起，'
  + '而隔了 2 跳的「圆」「关联」不亮；"正在使用中"能同时标出多张卡片。');
