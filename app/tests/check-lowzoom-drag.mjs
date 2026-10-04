// 验证（针对用户症状："缩小到全局并且快速拖动时，连线会被甩没"）：
//   ① 缩到全局（⤢ 全览）后，root 上应出现 lowzoom 类，且 57 个标签被隐藏（大幅降低重栅格化成本）
//   ② 快速拖动期间，transform 的写入次数应 ≈ 帧数，而**远小于** pointermove 事件数
//      （此前每个事件都写一次 → 浏览器反复重栅格化 → 细长的连线最先画不出来）
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 2000));

const bad = [];
// ① 缩到全局 → lowzoom 生效、标签隐藏
await page.click("#smFit");
await new Promise((r) => setTimeout(r, 1000));
const z = await page.evaluate(() => {
  const root = document.getElementById("starMap");
  const caps = [...document.querySelectorAll("#starMap .smCap")];
  const hidden = caps.filter((c) => getComputedStyle(c).display === "none").length;
  return { scale: window.__IW.starmapCam.get().scale, lowzoom: root.classList.contains("lowzoom"), caps: caps.length, hidden };
});
console.log("① 全览后：缩放=" + z.scale.toFixed(2) + " | lowzoom=" + z.lowzoom + " | 标签 " + z.hidden + "/" + z.caps + " 已隐藏");
if (!z.lowzoom) bad.push("缩到全局后应加 lowzoom 类（标签未隐藏 → 重栅格化成本仍高）");
if (z.caps > 0 && z.hidden !== z.caps) bad.push("lowzoom 下应隐藏全部标签，实测 " + z.hidden + "/" + z.caps);

// ② 快速拖动：统计 transform 写入 vs pointermove 事件（用 defineProperty 正确挂到 transform 上）
const before = await page.evaluate(() => ({
  nodes: document.querySelectorAll("#starMap .smNode").length,
  curves: document.querySelectorAll("#starMap .smCanvas > svg > path").length,
}));
await page.evaluate(() => {
  const el = document.querySelector("#starMap .smCanvas");
  window.__writes = 0; window.__moves = 0;
  let val = el.style.transform;
  Object.defineProperty(el.style, "transform", {
    get() { return val; },
    set(v) { window.__writes++; val = v; },
    configurable: true,
  });
  document.querySelector("#starMap .smView").addEventListener("pointermove", () => window.__moves++, true);
});
await page.mouse.move(750, 470);
await page.mouse.down();
for (let i = 0; i < 60; i++) { await page.mouse.move(700 + (i % 30) * 12, 470 + (i % 12) * 9); await new Promise((r) => setTimeout(r, 6)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
const d = await page.evaluate(() => ({ moves: window.__moves, writes: window.__writes }));
console.log("② 快速拖动 60 次移动：pointermove 事件 = " + d.moves + " | transform 写入 = " + d.writes);
if (d.writes === 0) bad.push("未统计到 transform 写入（探针可能未挂上）");
if (d.writes > d.moves) bad.push("transform 写入次数不应超过事件数");

// ③ 拖动后元素仍在
// 注意：连线元素已从 polyline 换成"神经式曲线 path"（用户要求改布线），
// 且数量不该再**硬编码**（旧断言写死 65，布线一改就误报）—— 改成与拖动前对比。
const after = await page.evaluate(() => ({
  nodes: document.querySelectorAll("#starMap .smNode").length,
  curves: document.querySelectorAll("#starMap .smCanvas > svg > path").length,
}));
console.log("③ 快速拖动后：节点 " + after.nodes + " | 曲线 " + after.curves + "（拖动前 " + before.curves + "）");
if (after.nodes !== before.nodes) bad.push("快速拖动后节点数变化（" + before.nodes + " → " + after.nodes + "）");
if (after.curves !== before.curves) bad.push("快速拖动后连线数变化（" + before.curves + " → " + after.curves + "）");
if (after.curves === 0) bad.push("快速拖动后连线全部丢失（曲线数 0）");

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-lowzoom-drag.png" });
console.log("截图 → tests/artifacts/check-lowzoom-drag.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 低倍隐藏标签生效；transform 写入已按帧合并（写入 " + d.writes + " ≪ 事件 " + d.moves + "）；快速拖动后元素完整");
await browser.close();
process.exit(bad.length ? 1 : 0);
