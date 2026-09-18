// 验收（用户要求 B）：成就卡片之间不得重叠，且需保留可见间距。
//
// 为什么要有这条：布局里的判据是**算出来的**（按实测盒 + 留白），而这里量的是浏览器**真实渲染盒**
// （徽标 + 标题/标注的实际尺寸）。两者必须一致 —— 此前布局只有中心距 46px 判据，
// 实渲 82px 高的卡片必然压叠（当时实测最严重重叠 2306px²）。
//
// 判据：
//   ① 任意两张卡片的真实矩形**不得重叠**（重叠对数 = 0）
//   ② 最小矩形净距 ≥ MIN_GAP_MARGIN（默认 8px；布局目标是 20px，渲染含文字取整会有几像素出入）
//   ③ 0 运行时错误
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const MIN_GAP_MARGIN = 8;   // 预留：布局目标 20px，渲染盒含文字取整，允许少量出入

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1600,1000", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 2200));

const res = await page.evaluate(() => {
  const scale = window.__IW.starmapCam.get().scale;
  const nodes = [...document.querySelectorAll("#starMap .smNode")].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.node, x: (r.left + r.right) / 2 / scale, y: (r.top + r.bottom) / 2 / scale, w: r.width / scale, h: r.height / scale };
  });
  let overlapPairs = 0, worstOverlap = 0, minGap = Infinity, worstPair = null;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i], B = nodes[j];
      const gx = Math.abs(A.x - B.x) - (A.w + B.w) / 2;
      const gy = Math.abs(A.y - B.y) - (A.h + B.h) / 2;
      const gap = Math.max(gx, gy);          // < 0 = 矩形重叠
      if (gap < minGap) { minGap = gap; worstPair = A.id + " / " + B.id; }
      if (gap < 0) { overlapPairs++; worstOverlap = Math.min(worstOverlap, gap); }
    }
  }
  const canvas = document.querySelector("#starMap .smCanvas");
  return {
    nodes: nodes.length, scale: Math.round(scale * 100) / 100,
    overlapPairs, worstOverlap: Math.round(worstOverlap * 10) / 10,
    minGap: Math.round(minGap * 10) / 10, worstPair,
    canvas: canvas ? { w: canvas.style.width, h: canvas.style.height } : null,
  };
});

console.log(`卡片 ${res.nodes} 张（缩放 ${res.scale}）| 真实矩形重叠对数 ${res.overlapPairs}${res.overlapPairs ? "（最严重 " + res.worstOverlap + "px）" : ""}`);
console.log(`  最小矩形净距 ${res.minGap}px（最紧一对：${res.worstPair}）| 画布 ${JSON.stringify(res.canvas)}`);

const bad = [];
if (res.overlapPairs > 0) bad.push(`有 ${res.overlapPairs} 对卡片真实重叠（最严重 ${res.worstOverlap}px）`);
if (res.minGap < MIN_GAP_MARGIN) bad.push(`最小矩形净距仅 ${res.minGap}px（< ${MIN_GAP_MARGIN}px）`);
if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/check-card-gap.png" });
console.log("截图 → tests/artifacts/check-card-gap.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log(`✅ 卡片互不重叠，且最小净距 ${res.minGap}px ≥ ${MIN_GAP_MARGIN}px（布局目标 20px）`);
await browser.close();
process.exit(bad.length ? 1 : 0);
