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
await p.evaluate(() => { document.querySelector("#starMap .smNode")?.click(); });
await wait(700);
await p.evaluate(() => { const d = document.querySelector(".smAchDetail"); if (d) d.click(); });
await wait(600);
const r = await p.evaluate(() => {
  const lum = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? 0.299*+m[1] + 0.587*+m[2] + 0.114*+m[3] : null; };
  const dark = [];
  for (const el of document.querySelectorAll("#starMap *, #achDetail *")) {
    const q = el.getBoundingClientRect();
    if (q.width < 8 || q.height < 8 || q.bottom < 0 || q.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.1) continue;
    const bg = lum(cs.backgroundColor);
    const mm = cs.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    const alpha = mm && mm[4] !== undefined ? parseFloat(mm[4]) : 1;
    if (bg !== null && bg < 100 && alpha > 0.3) dark.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + " bg=" + cs.backgroundColor);
  }
  const det = document.querySelector("#achDetail"), side = document.querySelector("#starMap .smSide") || document.querySelector("#starMap .smDetail");
  const a = det && det.getBoundingClientRect(), b2 = side && side.getBoundingClientRect();
  return { dark, det: a ? [Math.round(a.left), Math.round(a.top), Math.round(a.width), Math.round(a.height)] : null,
    side: b2 ? [Math.round(b2.left), Math.round(b2.width)] : null,
    cap: (() => { const c = document.querySelector("#starMap .smNode.granted .smCap") || document.querySelector("#starMap .smNode .smCap"); return c ? getComputedStyle(c).color : null; })(),
    detText: det ? getComputedStyle(det).color : null,
    btn: (() => { const x = document.querySelector("#starMap #smFit"); return x ? getComputedStyle(x).backgroundColor : null; })() };
});
console.log("  仍深色的元素 =", r.dark.length, r.dark.length ? JSON.stringify(r.dark.slice(0,6)) : "✓");
console.log("  #achDetail =", JSON.stringify(r.det), " 右侧面板 =", JSON.stringify(r.side));
console.log("  气泡在右侧面板左边 =", (r.det && r.side) ? (r.det[0] + r.det[2] <= r.side[0] + 2 ? "YES ✓" : "NO ✗") : "?");
console.log("  卡片文字 =", r.cap, " | 详情文字 =", r.detText, " | #smFit 背景 =", r.btn);
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
