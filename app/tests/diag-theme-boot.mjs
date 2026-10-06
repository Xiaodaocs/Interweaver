import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1300,860","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1300, height: 860 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// 先写死"深色"偏好，再打开三个页面，检查**首帧**就是深色（不闪浅色）
for (const page of ["index.html", "settings.html", "starmap.html"]) {
  await p.goto("http://localhost:5188/settings.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(() => localStorage.setItem("interweaver.theme", "dark"));
  await p.goto("http://localhost:5188/" + page, { waitUntil: "domcontentloaded" });
  // 尽早在 document 上读 data-theme（此时模块可能还没跑完）
  const early = await p.evaluate(() => document.documentElement.dataset.theme);
  await wait(700);
  const late = await p.evaluate(() => document.documentElement.dataset.theme);
  console.log(`  ${page.padEnd(15)} 首帧 data-theme = ${early}  →  稳定后 = ${late}  ${early === "dark" && late === "dark" ? "✓ 全程深色（不闪）" : "✗ 有闪烁/不一致"}`);
}
// 再验浅色偏好
await p.goto("http://localhost:5188/settings.html", { waitUntil: "domcontentloaded" });
await p.evaluate(() => localStorage.setItem("interweaver.theme", "light"));
for (const page of ["index.html", "settings.html", "starmap.html"]) {
  await p.goto("http://localhost:5188/" + page, { waitUntil: "domcontentloaded" });
  const early = await p.evaluate(() => document.documentElement.dataset.theme);
  await wait(600);
  const late = await p.evaluate(() => document.documentElement.dataset.theme);
  console.log(`  ${page.padEnd(15)} 浅色偏好：首帧 = ${early}  稳定后 = ${late}  ${early === "light" && late === "light" ? "✓" : "✗"}`);
}
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
