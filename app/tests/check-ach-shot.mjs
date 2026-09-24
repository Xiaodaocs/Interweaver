// S10 验收（用户要求 ⑦ 其它设置：拍摄成就瞬间画面）
// 判据：
//   ① 开启该设置时，成就点亮会真的存下一张**有效缩略图**（dataURL + 尺寸 + 成就 id/标题）
//   ② 关闭该设置后不再新增（设置真正生效）
//   ③ 历史有界：超过上限时先进先出，不会无限增长
//   ④ 0 运行时错误
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
  await page.evaluate((s) => { try { localStorage.setItem('interweaver.settings.v1', JSON.stringify(s)); localStorage.removeItem('interweaver.draft.v1'); localStorage.removeItem('interweaver.achshots.v1'); } catch (e) {} }, settings);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 400));
};
// ① 开启：建一个圆 → 成就点亮 → 应存下缩略图
await load({ achShot: true, snapGrid: true, snapEndpoint: true, shortcuts: true });
const onRes = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st;
  const before = window.__IW.lastAchievements ? window.__IW.lastAchievements.length : 0;
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  await new Promise((r) => setTimeout(r, 1200));   // 等成就引擎在帧循环里判定并点亮
  const F = await import('/src/achShot.js');
  const shots = F.listShots();
  const s0 = shots[0];
  return { newly: (window.__IW.lastAchievements || []).map((a) => a.id), count: shots.length,
    first: s0 ? { id: s0.id, title: s0.title, w: s0.w, h: s0.h, isJpeg: /^data:image\/jpeg;base64,/.test(s0.data), bytes: s0.data.length } : null };
});
console.log(`① 开启：点亮 ${JSON.stringify(onRes.newly)} | 存下 ${onRes.count} 张 | 首张 = ${JSON.stringify(onRes.first)}`);
if (onRes.count < 1) bad.push('开启了拍摄却没有存下任何成就画面');
if (!onRes.first || !onRes.first.isJpeg || onRes.first.bytes < 1000) bad.push('存下的不是有效缩略图（需 JPEG dataURL 且体积合理）');
if (!onRes.first || !onRes.first.id || !onRes.first.title) bad.push('画面里缺少成就 id/标题');
// ② 关闭：再点亮一个成就 → 不应新增
await load({ achShot: false, snapGrid: true, snapEndpoint: true, shortcuts: true });
const offRes = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st;
  S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 4, y2: 0 });
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  await new Promise((r) => setTimeout(r, 1400));
  const F = await import('/src/achShot.js');
  return { newly: (window.__IW.lastAchievements || []).length, count: F.listShots().length };
});
console.log(`② 关闭：点亮 ${offRes.newly} 个成就 | 存下 ${offRes.count} 张（应为 0）`);
if (offRes.count !== 0) bad.push('关闭拍摄后仍然存了画面（设置没生效）');
// ③ 有界：直接连写超过上限，检查先进先出
await load({ achShot: true, snapGrid: true, snapEndpoint: true, shortcuts: true });
const capRes = await page.evaluate(async () => {
  const F = await import('/src/achShot.js');
  const cv = document.getElementById('cv');
  for (let i = 0; i < F.MAX_SHOTS + 3; i++) F.recordShot(cv, { id: 'test' + i, title: 'T' + i, cls: 'solo' });
  const list = F.listShots();
  return { max: F.MAX_SHOTS, count: list.length, newest: list[0].id, oldest: list[list.length - 1].id };
});
console.log(`③ 有界：上限 ${capRes.max} | 实际 ${capRes.count} | 最新 ${capRes.newest} | 最旧 ${capRes.oldest}`);
if (capRes.count !== capRes.max) bad.push('历史没有被限制在上限内');
if (capRes.oldest === 'test0') bad.push('超出上限时没有先进先出（最旧的仍是最早那条）');
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ S10 通过：成就瞬间画面按设置拍摄、可关闭、历史有界');
