// 诊断（用户反馈：拖动卡顿 + 停止后页面仍不断刷新）：
//   ① 拖动期间的实测 FPS（分「面板开/关」两种情况，面板带 backdrop-filter 是重活的首要嫌疑）
//   ② 停止后**仍在运行的动画**（持续刷新/重绘的来源）
//   ③ 星图页上昂贵的 CSS 属性（backdrop-filter / filter / animation）清单
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))));

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 2000));

// ② 停止后仍在运行的动画
const anims = await page.evaluate(() => {
  const running = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === "running");
  const byEl = new Map();
  for (const a of running) {
    const el = a.effect && a.effect.target;
    const key = el ? (el.tagName + "." + (el.getAttribute && (el.getAttribute("class") || "")).toString().split(" ")[0]) : "?";
    byEl.set(key, (byEl.get(key) || 0) + 1);
  }
  return [...byEl.entries()].map(([k, v]) => k + " x" + v);
});
console.log("② 停止后仍在运行的动画：", anims.length ? anims.join("  ") : "无");

// ③ 昂贵 CSS 属性
const costly = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("#starMap *")) {
    const cs = getComputedStyle(el);
    if (cs.backdropFilter && cs.backdropFilter !== "none") out.push("backdrop-filter: " + el.tagName + "." + (el.className || "").toString().split(" ")[0]);
    if (cs.filter && cs.filter !== "none") out.push("filter: " + el.tagName + "." + (el.className || "").toString().split(" ")[0]);
  }
  return [...new Set(out)];
});
console.log("③ 昂贵 CSS：", costly.length ? costly.join(" | ") : "无");

// ① FPS 测量：拖动 1.5 秒，数 rAF 帧数
const measureFps = async (label, prep) => {
  if (prep) await prep();
  const fps = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const loop = () => {
        frames++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(loop);
        else resolve(frames / ((performance.now() - t0) / 1000));
      };
      requestAnimationFrame(loop);
    });
  });
  console.log("① " + label + "：拖动期间 FPS = " + fps.toFixed(1));
  return fps;
};

const drag = async () => {
  await page.mouse.move(750, 470);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) { await page.mouse.move(750 - i * 18, 470 - i * 9); await new Promise((r) => setTimeout(r, 30)); }
  await page.mouse.up();
};

// 面板关闭时拖动
await drag();
await new Promise((r) => setTimeout(r, 400));
await measureFps("面板关闭");
// 打开面板后拖动
await page.evaluate(() => document.querySelector("#starMap .smNode").dispatchEvent(new MouseEvent("click", { bubbles: true })));
await new Promise((r) => setTimeout(r, 600));
const sideOpen = await page.evaluate(() => { const s = document.querySelector("#starMap .smSide"); return s && !s.hidden; });
console.log("   面板已打开 =", sideOpen);
await drag();
await new Promise((r) => setTimeout(r, 400));
await measureFps("面板打开(backdrop-filter)");
await browser.close();
