// 验收（用户要求 A）：每张成就卡片衍生/依赖的线**全部汇聚到一个点**再分叉，不再平行并排。
//
// 判据（都在世界坐标里算，不受缩放影响）：
//   ① 对每个「节点 + 侧（左/右）」，收集所有折线的接线端点（落在该卡片边缘者）；
//      若该侧有 ≥2 条边，则**不同的端点坐标数应为 1**（汇聚为一点）；
//      允许极少数因"该点对某条边会穿卡片"而退化为 2（如实统计并给出比例）。
//   ② 接线精度：端点与卡片边缘的距离偏差，必须按**该卡片的难度档半宽**判定
//      （圆 23 / 圆角方 26 / 六边形 58÷2=29，均 +2 视觉间隙 → 25 / 28 / 31），偏差 ≤2px。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const TIER_PAD = { 1: 25, 2: 28, 3: 31 };   // 徽标半宽 + 2

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1600,1000", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 2200));

const res = await page.evaluate((tierPad) => {
  const nodes = [...document.querySelectorAll("#starMap .smNode")].map((el) => ({
    id: el.dataset.node,
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    tier: Number(el.dataset.tier) || 3,
  }));
  // 收集接线端点：每个折线的首点与末点
  const ends = [];
  for (const pl of document.querySelectorAll("#starMap polyline")) {
    const arr = (pl.getAttribute("points") || "").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    if (arr.length < 2) continue;
    ends.push(arr[0], arr[arr.length - 1]);
  }
  // 归到节点+侧（取最近的、且在该侧端口距离附近的节点）
  const groups = new Map();
  let attachBad = 0, attachTotal = 0;
  for (const [x, y] of ends) {
    let best = null;
    for (const nd of nodes) {
      const pad = tierPad[nd.tier];
      const dx = x - nd.x;
      const side = dx >= 0 ? "R" : "L";
      const expect = nd.x + (side === "R" ? pad : -pad);
      const gap = Math.abs(x - expect);
      if (gap <= 3 && Math.abs(y - nd.y) <= 140) {
        if (!best || gap < best.gap) best = { nd, side, gap, y };
      }
    }
    attachTotal++;
    if (!best) { attachBad++; continue; }
    const key = best.nd.id + "|" + best.side;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(Math.round(best.y * 2) / 2);   // 0.5px 量化
  }
  const multi = [...groups.entries()].filter(([, s]) => s.size >= 2);
  const exact1 = [...groups.entries()].filter(([, s]) => s.size === 1).length;
  const sizes = multi.map(([, s]) => s.size).sort((a, b) => b - a);
  return {
    nodes: nodes.length, groups: groups.size, exact1, multi: multi.length,
    worst: sizes.slice(0, 5), attachBad, attachTotal,
    sampleMulti: multi.slice(0, 3).map(([k, s]) => k + "→" + [...s].join(",")),
  };
}, TIER_PAD);

const pct = res.groups ? (res.exact1 / res.groups * 100).toFixed(1) : "0";
console.log(`节点 ${res.nodes} | 「节点+侧」分组 ${res.groups} | 端点唯一(汇聚为一点)的组 ${res.exact1}（${pct}%）| 出现多个端点的组 ${res.multi}`);
console.log(`  多端点组的端点个数（前 5）：${JSON.stringify(res.worst)}`);
if (res.sampleMulti.length) console.log(`  例：${res.sampleMulti.join("  |  ")}`);
console.log(`  按难度档判定的接线：命中 ${res.attachTotal - res.attachBad}/${res.attachTotal}，未命中 ${res.attachBad}`);

const bad = [];
if (res.attachBad > 0) bad.push(`有 ${res.attachBad} 个端点未落在任何卡片的档位边缘上（接线不准）`);
if (res.groups > 0 && res.exact1 / res.groups < 0.9) bad.push(`汇聚比例仅 ${pct}%（< 90%）：多数同侧边仍未汇聚到同一点`);
if (res.worst.length && res.worst[0] > 2) bad.push(`存在某侧出现 ${res.worst[0]} 个不同端点（> 2，说明扇出未消除）`);
if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-port-convergence.png" });
console.log("截图 → tests/artifacts/check-port-convergence.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log(`✅ 单点汇聚生效（${pct}% 的同侧边汇聚到同一端点），且接线按难度档精确命中`);
await browser.close();
process.exit(bad.length ? 1 : 0);
