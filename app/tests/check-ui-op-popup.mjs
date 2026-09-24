// S5b 验收（用户要求 ⑥）：所有单卡片操作（关联/约束/角/坐标系等）统一在**页面左上角弹窗**进行，不用时收回。
//
// 判据：
//   ① 触发「关联…」（右键菜单真实入口）后：左上角 #opPop 显示，且内容渲染在 #opPopBody 里
//   ② 位置：在页面左侧、紧贴顶端留出距离（菜单栏 40px 之下）
//   ③ 右侧属性面板里**不再**出现向导内容（操作已搬走）
//   ④ 取消后弹窗自动收回（等动画结束）
//   ⑤ 0 运行时错误
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);

const bad = [];

// 建实体 + 通过右键菜单真实入口打开「关联…」
const opened = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  S.addVariable(st, 'k', { value: 1, min: 0, max: 5 });
  const c = S.addEntity(st, 'circle', { cx: -2, cy: 0, r: 2 });
  S.ensureEvaluated(st);
  st.selection = new Set([c.id]);
  S.emit(st, 'selection');
  window.__IW.renderOnce();
  const s = cam.w2s(-2 + 2, 0);   // 圆周右端点：右键落在这里才会命中该圆
  return { sx: s[0], sy: s[1], id: c.id };
});
await page.mouse.click(opened.sx, opened.sy, { button: "right" });
await new Promise((r) => setTimeout(r, 400));
const acts = await page.evaluate(() => [...document.querySelectorAll('button[data-act]')].map((b) => b.getAttribute('data-act')));
console.log(`右键菜单项 = ${JSON.stringify(acts)}`);
const linkBtn = await page.$('button[data-act="link"]');
if (!linkBtn) bad.push('右键菜单没有「关联…」入口');
else {
  await linkBtn.click();
  await new Promise((r) => setTimeout(r, 600));
}

const st1 = await page.evaluate(() => {
  const op = document.getElementById('opPop');
  const r = op.getBoundingClientRect();
  const opBody = document.getElementById('opPopBody');
  const panelBody = document.getElementById('panelBody');
  const mb = document.getElementById('menubar').getBoundingClientRect();
  return {
    hidden: op.hidden, slide: op.dataset.slide,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    opText: (opBody.textContent || '').trim().slice(0, 60),
    opHasWizard: !!opBody.querySelector('button, input'),
    panelHasWizard: !!panelBody.querySelector('#wizCancel, [data-wp]'),
    menubarBottom: mb.bottom,
    transition: getComputedStyle(op).transitionProperty,
  };
});
console.log(`① 弹窗：hidden=${st1.hidden} slide=${st1.slide} 位置=(${st1.rect.x.toFixed(0)},${st1.rect.y.toFixed(0)}) 宽=${st1.rect.w.toFixed(0)}`);
console.log(`   内容片段="${st1.opText}" | 弹窗内有向导控件=${st1.opHasWizard} | 右侧面板仍有向导=${st1.panelHasWizard}`);
if (st1.hidden) bad.push('触发关联后左上弹窗没有显示');
if (!st1.opHasWizard) bad.push('左上弹窗里没有渲染出关联向导的内容');
if (st1.panelHasWizard) bad.push('右侧属性面板里仍有向导内容（操作没有搬走）');

// ② 位置：左侧 + 紧贴顶端留出距离（在菜单栏之下）
console.log(`② 位置：x=${st1.rect.x.toFixed(0)}（应<400）y=${st1.rect.y.toFixed(0)}（应 > 菜单栏底 ${st1.menubarBottom.toFixed(0)} 且 < 400）`);
if (!(st1.rect.x < 400)) bad.push('操作弹窗不在页面左侧');
if (!(st1.rect.y > st1.menubarBottom && st1.rect.y < 400)) bad.push('操作弹窗未在"紧贴顶端留出距离"的位置');
if (!st1.transition.includes('transform')) bad.push('操作弹窗没有统一滑动动画');

// ④ 取消后自动收回
const closed = await page.evaluate(async () => {
  const btn = document.querySelector('#opPopBody #wizCancel') || document.querySelector('#opPopBody #wizBack');
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 500));
  return { hidden: document.getElementById('opPop').hidden };
});
console.log(`④ 取消后：弹窗 hidden=${closed.hidden}`);
if (!closed.hidden) {
  // 若取消按钮点了只回退一步，再等一次并确认最终能收回
  await new Promise((r) => setTimeout(r, 400));
  const again = await page.evaluate(() => document.getElementById('opPop').hidden);
  console.log(`   （再等 400ms 后 hidden=${again}）`);
  if (!again) bad.push('取消操作后左上弹窗没有收回');
}

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/ui-S5-oppop.png" });
console.log("截图 → tests/artifacts/ui-S5-oppop.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ S5b 通过：单卡片操作在左上角弹窗进行、位置合规、右侧面板不再承载、取消后自动收回");
await browser.close();
process.exit(bad.length ? 1 : 0);
