// 验收（用户要求）：成就页与工作台**完全分离，不在同一个 html 上**。
//
// 判据：
//   ① 直接打开 /starmap.html → 星图正常渲染（节点 57、神经式曲线 > 0、0 报错）
//   ② 该页**没有工作台**（无 #cv 画布、无 #toolbar、无 #panel、无 #varWin）
//   ③ 打开 /index.html → **没有星图**（无 #starMap），说明两者不再叠加
//   ④ 工作台里点击成就按钮 → 跳转到 /starmap.html（真实导航，不是叠加）
//   ⑤ 成就页点 ✕ → 返回 /index.html
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { KNOWLEDGE_NODES } from '../src/achievements/nodes.js';
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const BASE = "http://localhost:5188";
const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const bad = [];

// ① 独立成就页
await page.goto(BASE + "/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap", { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));
const s1 = await page.evaluate(() => ({
  starMap: !!document.getElementById("starMap"),
  nodes: document.querySelectorAll("#starMap .smNode").length,
  polys: document.querySelectorAll("#starMap .smCanvas > svg > path").length,   // 神经式曲线（原 polyline 已随布线改造删除）
  hasCanvas: !!document.getElementById("cv"),
  hasToolbar: !!document.getElementById("toolbar"),
  hasPanel: !!document.getElementById("panel"),
  hasVarWin: !!document.getElementById("varWin"),
  side: !!document.querySelector("#starMap .smSide"),
}));
console.log("① 独立成就页：星图=" + s1.starMap + " 节点=" + s1.nodes + " 曲线=" + s1.polys
  + " | 工作台残留：画布=" + s1.hasCanvas + " 工具栏=" + s1.hasToolbar + " 面板=" + s1.hasPanel + " 变量窗=" + s1.hasVarWin);
if (!s1.starMap) bad.push("独立成就页没有渲染星图");
// 节点数从数据读（图谱加了中间知识点后不该假失败）
const want = KNOWLEDGE_NODES.length;
if (s1.nodes !== want) bad.push("独立成就页节点数应为 " + want + "（= 知识图谱节点数），实测 " + s1.nodes);
if (s1.polys === 0) bad.push("独立成就页没有连线（神经式曲线）");
if (s1.hasCanvas || s1.hasToolbar || s1.hasPanel || s1.hasVarWin) bad.push("独立成就页仍含工作台元素（未完全分离）");
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-standalone-page.png" });

// ② 工作台页不应有星图
await page.goto(BASE + "/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);
const s2 = await page.evaluate(() => ({
  starMap: !!document.getElementById("starMap"),
  canvas: !!document.getElementById("cv"),
  achBtn: !!document.getElementById("achBtn"),
}));
console.log("② 工作台页：星图=" + s2.starMap + "（应为 false）| 画布=" + s2.canvas + " | 成就按钮=" + s2.achBtn);
if (s2.starMap) bad.push("工作台页仍含星图（两者未分离）");
if (!s2.canvas) bad.push("工作台页缺少画布");

// ③ 工作台点成就按钮 → 真实跳转
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {}),
  page.click("#achBtn"),
]);
await new Promise((r) => setTimeout(r, 1500));
const s3 = await page.evaluate(() => ({ url: location.pathname, starMap: !!document.getElementById("starMap") }));
console.log("③ 点击成就按钮后：URL=" + s3.url + " | 星图=" + s3.starMap);
if (!s3.url.includes("starmap.html")) bad.push("点击成就按钮没有跳转到 starmap.html（实测 " + s3.url + "）");

// ④ 成就页点 ✕ → 回工作台
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {}),
  page.click("#smClose"),
]);
await new Promise((r) => setTimeout(r, 1200));
const s4 = await page.evaluate(() => ({ url: location.pathname, canvas: !!document.getElementById("cv") }));
console.log("④ 点 ✕ 后：URL=" + s4.url + " | 画布=" + s4.canvas);
if (!s4.url.includes("index.html")) bad.push("成就页关闭后没有回到 index.html（实测 " + s4.url + "）");

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 两页完全分离：成就页是独立文档（无工作台），工作台无星图，双向跳转正常");
await browser.close();
process.exit(bad.length ? 1 : 0);
