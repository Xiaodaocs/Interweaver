import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/settings.html", { waitUntil: "networkidle0" });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("interweaver.theme", "light");
  localStorage.setItem("interweaver.live.v1", JSON.stringify({ at: Date.now(), ids: ["n.circle","n.segment"] })); });
await p.goto("http://localhost:5188/starmap.html", { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.querySelectorAll("#starMap .smNode").length > 0);
await wait(1200);
// 打开侧栏 + 详情浮窗，覆盖全部可见文本
await p.evaluate(() => { document.querySelector("#starMap .smNode")?.click(); });
await wait(700);
await p.evaluate(() => { const d = document.querySelector(".smAchDetail"); if (d) d.click(); });
await wait(700);
const r = await p.evaluate(() => {
  const lum = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a < 0.12) return null;
    return 0.299*+m[1] + 0.587*+m[2] + 0.114*+m[3]; };
  // 有效背景：向上找第一个不透明的背景色
  const bgOf = (el) => {
    let e = el;
    while (e) { const c = getComputedStyle(e).backgroundColor;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m) { const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a > 0.6) return 0.299*+m[1] + 0.587*+m[2] + 0.114*+m[3]; }
      e = e.parentElement;
    }
    return null; // 一直透明 → 由画布/渐变兜底（跳过）
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("#starMap *, #achDetail *")) {
    // 只看直接含文本的元素
    let txt = "";
    for (const n of el.childNodes) if (n.nodeType === 3) txt += n.textContent;
    txt = txt.trim();
    if (!txt) continue;
    const rc = el.getBoundingClientRect();
    if (rc.width < 4 || rc.height < 4 || rc.bottom < 0 || rc.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
    const fg = lum(cs.color);
    const bg = bgOf(el.parentElement || el);
    if (fg === null || bg === null) continue;
    const contrast = (Math.max(fg, bg) + 5) / (Math.min(fg, bg) + 5);   // 简化对比度（亮度比）
    if (contrast < 2.2) {                                              // 浅底浅字：明显看不清
      const key = el.tagName + "|" + (typeof el.className === "string" ? el.className : "") + "|" + Math.round(fg) + "|" + Math.round(bg);
      if (seen.has(key)) continue; seen.add(key);
      const chain = [];
      let a = el;
      for (let i = 0; i < 4 && a; i++) {
        chain.push(a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") + (typeof a.className === "string" && a.className ? "." + a.className.trim().split(/\s+/).slice(0,3).join(".") : ""));
        a = a.parentElement;
      }
      out.push({ chain: chain.join("  <  "),
        el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0,2).join(".") : ""),
        text: txt.slice(0, 18), color: cs.color, bgLum: Math.round(bg), fgLum: Math.round(fg), ratio: +contrast.toFixed(2) });
    }
  }
  return { count: out.length, out: out.slice(0, 18) };
});
console.log("  浅色下文字也偏浅、看不清的文本元素：共 " + r.count + " 处");
for (const o of r.out) { console.log("    " + o.el.padEnd(34) + " ratio=" + String(o.ratio).padEnd(5) + " color=" + o.color.padEnd(22) + " 文本=\"" + o.text + "\""); console.log("        链: " + o.chain); }
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await p.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/light-text-audit.png" });
await b.close();
