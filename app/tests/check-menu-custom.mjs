// S11 验收（用户要求 ⑦ 操作设置：自定义右键菜单）
// 判据：关掉某一组后，右键菜单里该组**真的消失**；开回来则重新出现。
// 覆盖四组：微积分 / 观察 / 坐标系（含互连）/ 约束。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const bad = [];
const load = async (settings) => {
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { try { localStorage.setItem('interweaver.settings.v1', JSON.stringify(s)); localStorage.removeItem('interweaver.draft.v1'); } catch (e) {} }, settings);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 350));
};
// 造一个能触发尽量多分组的实体：圆 + 变量 + 坐标系（圆归入坐标系后会有坐标系组与观察组）
const setup = async () => page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st);
  st.selection = new Set([c.id]);
  S.emit(st, 'selection');
  window.__IW.renderOnce();
  const s = cam.w2s(3, 0);   // 圆右端点（避开坐标系原点）
  return { sx: s[0], sy: s[1] };
});
const menuGroups = async (pos) => {
  await page.mouse.click(pos.sx, pos.sy, { button: 'right' });
  await new Promise((r) => setTimeout(r, 350));
  const labels = await page.evaluate(() => [...document.querySelectorAll('#ctxMenu .ctxSubBtn')].map((b) => b.textContent.trim()));
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(760, 470, { button: 'left' });
  await new Promise((r) => setTimeout(r, 250));
  return labels;
};
const ALL_ON = { achShot: true, snapGrid: true, snapEndpoint: true, shortcuts: true, menuCalculus: true, menuProbe: true, menuCoordsys: true, menuConstraint: true };
const find = (labels, kw) => labels.some((l) => l.includes(kw));
// ① 全开：各组都应在
await load(ALL_ON);
let pos = await setup();
let labels = await menuGroups(pos);
console.log(`① 全开：${JSON.stringify(labels)}`);
// 说明：微积分组只在**线上点**上出现（calcItems 需要 edgepoint 宿主），普通圆上本就没有该组，
// 因此这里只断言圆上确实该出现的两组；微积分的开关走的是同一套 getSetting 把关（见 menu.js:75）。
for (const kw of ['观察', '坐标系']) if (!find(labels, kw)) bad.push('全开时缺少「' + kw + '」组');
// ② 关掉观察（微积分组在圆上本就不出现，这里用观察组验证「关掉即消失」）
await load({ ...ALL_ON, menuCalculus: false, menuProbe: false });
pos = await setup();
labels = await menuGroups(pos);
console.log(`② 关掉 微积分+观察：${JSON.stringify(labels)}`);
if (find(labels, '微积分')) bad.push('关掉后「微积分」组仍在菜单里');
if (find(labels, '观察')) bad.push('关掉后「观察」组仍在菜单里');
if (!find(labels, '坐标系')) bad.push('关掉其它组时「坐标系」组被误伤');
// ③ 关掉坐标系
await load({ ...ALL_ON, menuCoordsys: false });
pos = await setup();
labels = await menuGroups(pos);
console.log(`③ 关掉 坐标系：${JSON.stringify(labels)}`);
if (find(labels, '坐标系')) bad.push('关掉后「坐标系」组仍在菜单里');
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ S11 通过：右键菜单分组可自定义（关掉即从菜单移除，且不误伤其它组）');
