// 本轮细节 1 的验收：选中一张知识卡片时
//   ① 镜头**移动**到"它 + 与它直接相连的卡片"上（后者必须全部进入视野）
//   ② 被选中的那张卡片**本身略放大**
// 用真实鼠标点击（不是直接调函数）。
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
await wait(1500);

// ★ 注意：入场动画会移动镜头，**必须等到动画结束再量卡片坐标**，
//   否则点到的是"动画中途的旧位置"（我第一版就是这么错的：click 打在空处，误判成功能坏了）。
await wait(0);
const pick = await page.evaluate(() => {
  const view = document.querySelector('#starMap .smView').getBoundingClientRect();
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return cx >= view.left && cx <= view.right && cy >= view.top && cy <= view.bottom;
  };
  const adj = new Map();
  for (const p of document.querySelectorAll('#starMap .smCanvas > svg path')) {
    const a = p.dataset.a, b = p.dataset.b;
    if (!a || !b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  // 只在**当前视野内、左半区（避开右侧详情栏）、且点上去真的能命中自己**的卡片里挑邻居最多的那张。
  // 注意：右侧栏（.smSide）会在渲染后盖住地图右半边 —— 我第一版就是点到了栏里的 SPAN 上，
  // 于是"功能坏了"是假象。真实用户点的也是"看得见、够得着"的那张。
  const safeRight = view.left + view.width * 0.62;
  const cands = [...document.querySelectorAll('#starMap .smNode')]
    .filter(inView)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { id: el.dataset.node, n: (adj.get(el.dataset.node) || new Set()).size, cx, cy, hit: !!top && top.closest('.smNode') === el };
    })
    .filter((c) => c.hit && c.cx < safeRight)
    .sort((a, b) => b.n - a.n);
  if (!cands.length) return null;
  const { id, n, cx, cy } = cands[0];
  return { id, n, x: Math.round(cx), y: Math.round(cy), neighbors: [...(adj.get(id) || [])] };
});
if (!pick) { console.log('❌ 视野内没有可点的卡片'); await browser.close(); process.exit(1); }
console.log(`  选中「${pick.id}」（视野内、直接邻居 ${pick.n} 个）→ 真实鼠标点击 (${pick.x}, ${pick.y})`);

const before = await page.evaluate(() => {
  const c = window.__IW.starmapCam.get();
  return { scale: c.scale, tx: c.tx, ty: c.ty };
});

// 一次真实点击即可（点击会触发"镜头飞到它和它的邻居"）。
// 注意：**不能再按旧坐标点第二次** —— 镜头已经移动，旧坐标可能落到空白处，
// 而点空白会取消选中（我第一版就是这么把功能误判成坏的）。
await page.mouse.click(pick.x, pick.y);
// ★ 等镜头**真正停下来**再测。flyToBox 是 rAF 动画，死等固定毫秒数在负载高时会测到动画中途
//   （实测偶发：直接邻居只有 1/5 落在视野内，重跑又好了 —— 就是这里等不够）。
//   改成轮询相机参数，直到连续两次不变为止。
{
  let prev = null, stable = 0;
  for (let i = 0; i < 50; i++) {
    const c = await page.evaluate(() => {
      const k = window.__IW.starmapCam.get();
      return [k.scale, k.tx, k.ty].map((v) => Math.round(v * 100) / 100);
    });
    const same = prev && c.every((v, j) => Math.abs(v - prev[j]) < 0.01);
    stable = same ? stable + 1 : 0;
    prev = c;
    if (stable >= 2) break;
    await wait(100);
  }
}
// 诊断：点击坐标上到底是什么元素（帮助区分"功能坏了"与"点没打中"）
const hitInfo = await page.evaluate(([x, y, id]) => {
  const el = document.elementFromPoint(x, y);
  const node = el && el.closest ? el.closest('.smNode') : null;
  return { tag: el ? el.tagName : null, cls: el ? (el.getAttribute('class') || '') : null, isNode: !!node, nodeId: node ? node.dataset.node : null, want: id };
}, [pick.x, pick.y, pick.id]);
console.log(`  点击命中检查：该点最上层 = ${hitInfo.tag}.${hitInfo.cls}｜是卡片=${hitInfo.isNode}（id=${hitInfo.nodeId}，期望 ${hitInfo.want}）`);
const after = await page.evaluate(([id, nbs]) => {
  const c = window.__IW.starmapCam.get();
  const view = document.querySelector('#starMap .smView').getBoundingClientRect();
  const box = (el2) => { const r = el2.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const selEl = [...document.querySelectorAll('#starMap .smNode')].find((n) => n.dataset.node === id);
  const nbEls = [...document.querySelectorAll('#starMap .smNode')].filter((n) => nbs.includes(n.dataset.node));
  const inView = (el2) => {
    const r = el2.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return cx >= view.left && cx <= view.right && cy >= view.top && cy <= view.bottom;
  };
  const peer = nbEls[0];
  return {
    cam: { scale: c.scale, tx: c.tx, ty: c.ty },
    selBox: box(selEl), nbBox: peer ? box(peer) : null,
    selCount: document.querySelectorAll('#starMap .smNode.sel').length,
    litCount: document.querySelectorAll('#starMap .smNode.lit').length,
    nbInView: nbEls.filter(inView).length, nbTotal: nbEls.length,
    selInView: inView(selEl),
    selScale: getComputedStyle(selEl).transform,
  };
}, [pick.id, pick.neighbors]);

console.log(`  镜头：scale ${before.scale.toFixed(3)} → ${after.cam.scale.toFixed(3)}`);
console.log(`        tx ${before.tx.toFixed(0)} → ${after.cam.tx.toFixed(0)}｜ty ${before.ty.toFixed(0)} → ${after.cam.ty.toFixed(0)}`);
console.log(`  选中卡在视野内 = ${after.selInView}；它的直接邻居 ${after.nbInView}/${after.nbTotal} 在视野内`);
console.log(`  选中卡尺寸 = ${after.selBox.w.toFixed(1)}×${after.selBox.h.toFixed(1)}px；普通卡尺寸 = ${after.nbBox.w.toFixed(1)}×${after.nbBox.h.toFixed(1)}px`);
console.log(`  选中卡 transform = ${after.selScale}`);
console.log(`  标记 .sel 的卡片数 = ${after.selCount}；点亮 .lit 的卡片数 = ${after.litCount}`);

const moved = Math.hypot(after.cam.tx - before.tx, after.cam.ty - before.ty) + Math.abs(after.cam.scale - before.scale) * 100;
ok(moved > 5, `点击后镜头确实**移动了**（平移 ${Math.hypot(after.cam.tx - before.tx, after.cam.ty - before.ty).toFixed(0)}px，缩放 ${before.scale.toFixed(2)}→${after.cam.scale.toFixed(2)}）`);
ok(after.selInView === true, '选中的卡片在视野内');
ok(after.nbInView === after.nbTotal && after.nbTotal > 0, `它的**全部**直接邻居都在视野内（${after.nbInView}/${after.nbTotal}）← 用户要求"镜头移到它和与其连接的卡片上"`);
ok(after.selCount === 1, `恰好一张卡被标为选中（.sel = ${after.selCount}）`);
const hasScale = /matrix\(([\d.]+)/.exec(after.selScale);
const selW = hasScale ? parseFloat(hasScale[1]) : 1;
ok(selW > 1.1, `被选中的卡片**本身被放大**了（transform 缩放 ${selW.toFixed(3)} × ≈ 1.18）`);
ok(after.selBox.w > after.nbBox.w, `放大可见：选中卡宽 ${after.selBox.w.toFixed(1)}px > 邻居卡宽 ${after.nbBox.w.toFixed(1)}px`);

await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/starmap-select-camera.png' });
console.log('截图 → tests/artifacts/starmap-select-camera.png');
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 3).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：选中卡片时镜头移到"它 + 它的直接邻居"上，且选中卡本身放大约 1.18×');
