import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 240000, args: ["--window-size=1500,950","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/settings.html", { waitUntil: "networkidle0" });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("interweaver.theme", "light");
  localStorage.setItem("interweaver.live.v1", JSON.stringify({ at: Date.now(), ids: ["n.circle"] })); });
await p.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.querySelectorAll("#starMap .smNode").length > 0);
await wait(1200);
// 打开侧栏 + 详情浮窗，让所有面板都进入"可见"状态
await p.evaluate(() => { document.querySelector("#starMap .smNode")?.click(); });
await wait(600);
await p.evaluate(() => { const d = document.querySelector(".smAchDetail"); if (d) d.click(); });
await wait(600);
const bad = await p.evaluate(() => {
  const lum = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a < 0.15) return null;   // 近乎全透明不算
    return { l: 0.299*+m[1] + 0.587*+m[2] + 0.114*+m[3], a, raw: c }; };
  const out = [];
  for (const el of document.querySelectorAll("#starMap *, #achDetail *, .ctxGroup *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.1) continue;
    const bg = lum(cs.backgroundColor);
    const bi = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : null;
    let darkImg = false;
    if (bi) { const m = bi.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g); if (m) { const first = lum(m[0]); if (first && first.l < 100 && first.a > 0.3) darkImg = true; } }
    const isDark = (bg && bg.l < 100 && bg.a > 0.3) || darkImg;
    if (isDark) {
      const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).slice(0,3).join(".");
      out.push({ tag: el.tagName.toLowerCase(), id: el.id || "", cls, bg: cs.backgroundColor, img: bi ? bi.slice(0, 46) : null,
        at: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
  }
  // 去重（同 tag+cls+尺寸 只留一个）
  const seen = new Set(); const uniq = [];
  for (const o of out) { const k = o.tag + "|" + o.id + "|" + o.cls + "|" + o.at[2] + "x" + o.at[3]; if (seen.has(k)) continue; seen.add(k); uniq.push(o); }
  return { count: out.length, uniq };
});
console.log("  浅色模式下**背景仍是深色**的可见元素：共 " + bad.count + " 个（去重后 " + bad.uniq.length + " 种）");
for (const o of bad.uniq.slice(0, 14)) {
  console.log("    <" + o.tag + (o.id ? "#" + o.id : "") + (o.cls ? "." + o.cls : "") + ">  bg=" + o.bg + (o.img ? "  img=" + o.img : "") + "  @" + JSON.stringify(o.at));
}
if (!bad.count) console.log("    （一个都没有 ✓）");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
