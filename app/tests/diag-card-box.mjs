// 诊断：量出星图卡片的**真实渲染盒**（徽标 + 标题/标注），按难度档分别统计。
// 这是布局常量（CARD_W / CARD_H / CARD_PAD）的依据 —— 布局此前只有"中心距 46px"判据，
// 完全没有卡片尺寸概念，因此实渲 86×111 的卡片在 46px 中心距下必然重叠。
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1600,1000", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await page.waitForSelector("#starMap");
await new Promise((r) => setTimeout(r, 2200));

const res = await page.evaluate(() => {
  const scale = window.__IW.starmapCam.get().scale;
  const nodes = [...document.querySelectorAll("#starMap .smNode")];
  const byTier = new Map();
  for (const el of nodes) {
    const t = Number(el.dataset.tier) || 3;
    const r = el.getBoundingClientRect();
    const w = r.width / scale, h = r.height / scale;
    if (!byTier.has(t)) byTier.set(t, { n: 0, wmax: 0, hmax: 0 });
    const g = byTier.get(t);
    g.n++; g.wmax = Math.max(g.wmax, w); g.hmax = Math.max(g.hmax, h);
  }
  const out = {};
  for (const [t, g] of byTier) out[t] = { count: g.n, w: Math.round(g.wmax * 10) / 10, h: Math.round(g.hmax * 10) / 10 };
  // 顺便量当前"中心距判据"下的最紧一对，看视觉重叠有多严重
  const xs = nodes.map((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: 0, h: 0 }));
  let worst = null;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i].getBoundingClientRect();
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j].getBoundingClientRect();
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 0 && overlapY > 0) {
        const area = overlapX * overlapY;
        if (!worst || area > worst.area) worst = { area: Math.round(area / (scale * scale)), ids: [nodes[i].dataset.node, nodes[j].dataset.node] };
      }
    }
  }
  return { scale: Math.round(scale * 100) / 100, byTier: out, total: nodes.length, worst };
});

console.log("缩放 =", res.scale, "| 卡片总数 =", res.total);
console.log("按难度档的真实盒（世界坐标 px）：", JSON.stringify(res.byTier));
console.log("当前最严重的视觉重叠（世界坐标面积）：", JSON.stringify(res.worst));
await browser.close();
