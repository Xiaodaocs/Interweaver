// 验收：① 坐标系工具的操作面板必须**真的可见**（不是 hidden=false 就算数）
//       ② 函数创作器属于「操作面板」，须在左上角、与其它面板样式统一
//       ③ 统一性普查：所有弹出面板的毛玻璃与圆角必须一致
//
// 教训：此前 check-cs-tools 只断言 hidden=false，而菜单实际是 opacity:0（完全透明）→ 用户看不见却"测试通过"。
//       本文件一律用**计算样式**判定可见性与统一性。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.removeItem("interweaver.draft.v1"); } catch (e) {} });
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

const geo = (id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    hidden: el.hidden, opacity: Number(cs.opacity),
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    glass: (cs.backdropFilter || cs.webkitBackdropFilter || "none"),
    radius: cs.borderRadius,
  };
}, id);
const barBottom = await page.evaluate(() => Math.round(document.getElementById("menubar").getBoundingClientRect().bottom));

// ---------- ① 坐标系工具的操作面板：真的可见 ----------
await page.click('#toolbar button[data-tool="coordsys"]');
await wait(700);
const menu = await geo("csMenu");
console.log(`① 坐标系菜单：hidden=${menu.hidden} opacity=${menu.opacity} 位置=(${menu.x},${menu.y}) 尺寸=${menu.w}×${menu.h}`);
if (menu.hidden) bad.push("点坐标系工具没有弹出面板");
if (!(menu.opacity > 0.9)) bad.push(`坐标系菜单不可见（opacity=${menu.opacity}）`);
if (!(menu.w > 100 && menu.h > 60)) bad.push("坐标系菜单尺寸异常（可能没有内容）");
// 三个子工具都在，且能点
const items = await page.evaluate(() => [...document.querySelectorAll("#csMenu [data-csact]")].map((b) => b.dataset.csact));
console.log(`   子工具 = ${JSON.stringify(items)}`);
if (items.join(",") !== "create,view,manage") bad.push("三个子工具不齐");

// 切到视图/管理面板，确认面板也真的可见
await page.evaluate(() => document.querySelector('[data-csact="view"]').click());
await wait(700);
const panel = await geo("csPanel");
console.log(`① 视图面板：hidden=${panel.hidden} opacity=${panel.opacity} 位置=(${panel.x},${panel.y})`);
if (panel.hidden || !(panel.opacity > 0.9)) bad.push("坐标系视图面板不可见");
await page.evaluate(() => { const b = document.getElementById("csPanelClose"); if (b) b.click(); });
await wait(500);

// ---------- ② 函数创作器：在左上角、与操作面板同位置同尺寸 ----------
await page.click('#toolbar button[data-tool="fx"]');
await wait(800);
const fx = await geo("fxDock");
const opPopCss = await page.evaluate(() => {
  // 操作面板此刻可能是 hidden，直接取它的 CSS 定位值来对照
  const el = document.getElementById("opPop");
  const cs = getComputedStyle(el);
  return { left: cs.left, top: cs.top, width: cs.width };
});
console.log(`② 函数创作器：hidden=${fx.hidden} opacity=${fx.opacity} 位置=(${fx.x},${fx.y}) 尺寸=${fx.w}×${fx.h}`);
console.log(`   操作面板 CSS：left=${opPopCss.left} top=${opPopCss.top} width=${opPopCss.width}`);
if (fx.hidden || !(fx.opacity > 0.9)) bad.push("函数创作器不可见");
if (!(fx.x < 400)) bad.push(`函数创作器不在左上角（x=${fx.x}）`);
const gap = fx.y - barBottom;
if (!(gap >= 4 && gap <= 24)) bad.push(`函数创作器与菜单栏的间隙异常（${gap}px，应 4–24）`);
if (!(Math.abs(fx.w - parseFloat(opPopCss.width)) <= 1)) bad.push(`函数创作器宽度与操作面板不一致（${fx.w} vs ${opPopCss.width}）`);
if (Math.abs(fx.x - parseFloat(opPopCss.left)) > 1 || Math.abs(fx.y - parseFloat(opPopCss.top)) > 1) bad.push(`函数创作器位置与操作面板不一致（(${fx.x},${fx.y}) vs (${opPopCss.left},${opPopCss.top})）`);

// ---------- ③ 统一性普查：所有弹出面板的毛玻璃与圆角一致 ----------
await page.click('#toolbar button[data-tool="coordsys"]');   // 打开菜单（同时会收起创作器）
await wait(500);
const ids = ["fxDock", "csPanel", "opPop", "csMenu", "presetDock", "varWin", "checklist"];
const all = {};
for (const id of ids) all[id] = await geo(id);
const glasses = new Set(), radii = new Set();
console.log("③ 统一性普查：");
for (const [id, g] of Object.entries(all)) {
  if (!g) { console.log(`   ${id}: 不存在`); continue; }
  glasses.add(g.glass); radii.add(g.radius);
  console.log(`   ${id.padEnd(11)} 毛玻璃=${g.glass}  圆角=${g.radius}`);
}
console.log(`   → 毛玻璃种类 = ${glasses.size}（应 1）| 圆角种类 = ${radii.size}（应 1）`);
if (glasses.size !== 1) bad.push(`毛玻璃不统一：${[...glasses].join(" / ")}`);
if (radii.size !== 1) bad.push(`圆角不统一：${[...radii].join(" / ")}`);

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-panel-unify.png" });
console.log("截图 → tests/artifacts/check-panel-unify.png");
await browser.close();
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); process.exit(1); }
console.log("✅ 通过：坐标系面板真的可见；函数创作器已在左上角并与操作面板同位置同尺寸；七块面板毛玻璃与圆角完全统一");
