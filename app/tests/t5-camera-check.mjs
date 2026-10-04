import fs from 'fs';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
const outDir = 'D:/zhuo_mian/Interweaver/app/tests/artifacts';
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const bad = [];

await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
// 点亮若干成就，让"最近点亮的那颗星"存在
await page.evaluate(() => {
  const { st, cam, S, ach } = window.__IW;
  ach.reset();
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 50;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addEdgePoint(st, c.id, 0.6);
  const s = S.addEntity(st, 'segment', { x1: -3, y1: 3, x2: 3, y2: 3 });
  S.addVariable(st, 'k', { value: 2, min: 0, max: 5 });
  S.ensureEvaluated(st); S.addBinding(st, s.id, 'length', 'k');
  S.ensureEvaluated(st); S.emit(st, 'structure');
});
await new Promise((r) => setTimeout(r, 1900));
await page.click('#achBtn');
await page.waitForSelector('#starMap', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 1200));   // 等入场动画结束

const countVisible = () => page.evaluate(() => {
  const view = document.querySelector('#starMap .smView');
  const vr = view.getBoundingClientRect();
  let n = 0;
  for (const el of document.querySelectorAll('#starMap .smNode')) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= vr.left && cx <= vr.right && cy >= vr.top && cy <= vr.bottom) n++;
  }
  return n;
});

const cam = await page.evaluate(() => window.__IW.starmapCam.get());
console.log('相机 =', JSON.stringify(cam));
const vis = await countVisible();
// ★ 入场镜头的行为在本轮按用户要求改了：
//   用户反馈"我看不到使用中的效果"，诊断出的头号原因是**使用中的卡片不在初始视野里**
//   （旧行为：默认 1.6×、对准"最近点亮的那颗星"）。
//   现在：**有"使用中"的卡片时，入场镜头把它们全部框进视野**；没有时才退回旧逻辑（1.6×）。
//   所以断言从"缩放必须 1.6"改成"缩放合法 + 使用中的卡片必须在视野内"（后者才是真正要保的性质）。
const liveCards = await page.evaluate(() => {
  const view = document.querySelector('#starMap .smView').getBoundingClientRect();
  const inuse = [...document.querySelectorAll('#starMap .smNode[data-inuse="1"]')];
  const onScreen = inuse.filter((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return cx >= view.left && cx <= view.right && cy >= view.top && cy <= view.bottom;
  }).length;
  return { total: inuse.length, onScreen };
});
console.log(`首屏可见节点数 = ${vis}｜"正在使用中"的卡片 ${liveCards.onScreen}/${liveCards.total} 在视野内`);
if (!(cam.scale >= 0.4 && cam.scale <= 1.6)) bad.push(`初始缩放应在 0.4~1.6，实为 ${cam.scale.toFixed(2)}`);
if (liveCards.total > 0 && liveCards.onScreen !== liveCards.total) {
  bad.push(`有 ${liveCards.total} 张"正在使用中"的卡片，但只有 ${liveCards.onScreen} 张在首屏视野内（用户要求：一进来就该看得到）`);
}
if (liveCards.total === 0 && Math.abs(cam.scale - 1.6) > 0.02) {
  bad.push(`没有"正在使用中"的卡片时应退回默认 1.6×，实为 ${cam.scale.toFixed(2)}`);
}
if (vis < 3) bad.push(`首屏可见节点数 ${vis} 太少（至少要能看到点东西）`);
if (!cam.focusId) bad.push('没有确定"最近点亮的那颗星"（无使用中卡片时的兜底焦点）');
const btn = await page.evaluate(() => ({ mine: !!document.getElementById('smMine'), fit: !!document.getElementById('smFit') }));
console.log('相机按钮 =', JSON.stringify(btn));
if (!btn.mine || !btn.fit) bad.push('缺少「回到我的星」/「全览」按钮');

// 全览：应看到远多于首屏的节点，且缩放变小
await page.click('#smFit');
await new Promise((r) => setTimeout(r, 500));
const visAll = await countVisible();
const camAll = await page.evaluate(() => window.__IW.starmapCam.get());
console.log('全览后：可见', visAll, '个节点，缩放 =', camAll.scale.toFixed(3));
if (!(visAll > vis)) bad.push(`全览后可见节点数应增加（${vis} → ${visAll}）`);
if (!(camAll.scale < 1.6)) bad.push('全览后缩放应变小');

// 回到我的星：应回到 1.6
await page.click('#smMine');
await new Promise((r) => setTimeout(r, 2600));
const camBack = await page.evaluate(() => window.__IW.starmapCam.get());
console.log('回到我的星后缩放 =', camBack.scale.toFixed(2));
if (Math.abs(camBack.scale - 1.6) > 0.02) bad.push(`「回到我的星」后缩放应回到 1.6，实为 ${camBack.scale.toFixed(2)}`);
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));

await page.screenshot({ path: outDir + '/p15-t5-camera.png' });
console.log('截图 →', outDir + '/p15-t5-camera.png');
if (bad.length) { console.log('❌ T5 断言失败：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ T5 相机断言全部通过');
await browser.close();
process.exit(bad.length ? 1 : 0);
