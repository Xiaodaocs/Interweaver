// 验收（用户症状："缩小到全局 + 快速拖动 → 连线被甩没"）：
//
// 已确证原因：连线 1.5 用户单位描边 → 缩到全局（0.40×）后有效宽度仅 0.60 设备像素（DPR=1），
// 属亚像素 → 浏览器快速拖动重栅格化时直接丢弃 → 停下才补画。
// 修复：vector-effect: non-scaling-stroke（描边宽度不随缩放变化，任何缩放都保持 1.5 屏幕像素）。
//
// 断言：
//   ① 机制：折线/拱桥/徽标描边必须全部 non-scaling-stroke
//   ② 结果：**真实截图**解码后，全局视图下必须能数到连线像素（不靠公式、不靠肉眼）
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });   // DPR=1 最严苛
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 1800));

const bad = [];

// ① 机制
const mech = await page.evaluate(() => {
  const okOf = (els) => els.length === 0 ? null : els.every((el) => getComputedStyle(el).vectorEffect === "non-scaling-stroke");
  return {
    polys: document.querySelectorAll("#starMap polyline").length,
    polyOk: okOf([...document.querySelectorAll("#starMap polyline")]),
    bridges: document.querySelectorAll("#starMap path.smBridge").length,
    bridgeOk: okOf([...document.querySelectorAll("#starMap path.smBridge")]),
    badge: document.querySelectorAll("#starMap .smNode svg *").length,
    badgeOk: okOf([...document.querySelectorAll("#starMap .smNode svg *")]),
  };
});
console.log("① 机制：折线 " + mech.polys + " non-scaling-stroke=" + mech.polyOk
  + " | 拱桥 " + mech.bridges + "=" + mech.bridgeOk + " | 徽标图元 " + mech.badge + "=" + mech.badgeOk);
if (mech.polyOk !== true) bad.push("折线未全部 non-scaling-stroke");
if (mech.bridgeOk === false) bad.push("拱桥未 non-scaling-stroke");
if (mech.badgeOk === false) bad.push("徽标描边未 non-scaling-stroke");

// ② 结果：缩到全局 → 真实截图 → 页面内解码数像素
await page.click("#smFit");
await new Promise((r) => setTimeout(r, 1000));
const b64 = await page.screenshot({ encoding: "base64" });
const pix = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let line = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    total++;
    // 连线色偏冷白蓝（169,180,216），背景是深色星云（约 11–30）→ 用"明显亮于背景且偏蓝"判定
    if (b > 120 && b > r + 15 && g > 90) line++;
  }
  return { w: cv.width, h: cv.height, line, total };
}, "data:image/png;base64," + b64);
console.log("② 结果：全屏截图 " + pix.w + "×" + pix.h + " → 判定为连线色像素 " + pix.line + " 个（占比 " + (pix.line / pix.total * 100).toFixed(3) + "%）");
if (pix.line < 500) bad.push("全局视图下连线像素过少（" + pix.line + "）→ 线可能画不出来");

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-line-visibility.png" });
console.log("截图 → tests/artifacts/check-line-visibility.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 连线 non-scaling-stroke 生效，且全局视图下像素级可见（" + pix.line + " 像素）");
await browser.close();
process.exit(bad.length ? 1 : 0);
