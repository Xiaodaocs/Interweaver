// 需求 ② 验收：坐标系的格子默认只覆盖「这个坐标系里有的图形」。
//
// 判据（用像素包围盒做几何对比，不是"看起来小了"）：
//   ① 造一个圆（半径 2）+ 一个归入它的坐标系 → 取坐标系颜色的像素包围盒
//   ② 该包围盒应≈圆的屏幕包围盒 + 少量边距，而**远小于整个画布**
//   ③ 没有成员的坐标系：只在原点附近给一小块（也应远小于画布）
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.removeItem("interweaver.draft.v1"); } catch (e) {} });
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);
const bad = [];

/** 量某个实体颜色的像素包围盒（世界坐标） */
const measure = (type) => page.evaluate((t) => {
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const st = window.__IW.st, cam = window.__IW.cam;
  const ent = [...st.entities.values()].find((e) => e.type === t);
  if (!ent) return { none: true };
  const hex = (ent.color || "#000000").replace("#", "");
  const tr = parseInt(hex.slice(0, 2), 16), tg = parseInt(hex.slice(2, 4), 16), tb = parseInt(hex.slice(4, 6), 16);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  const dpr = cv.width / cv.clientWidth;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - tr) < 26 && Math.abs(d[i + 1] - tg) < 26 && Math.abs(d[i + 2] - tb) < 26) {
      const px = (i / 4) % cv.width, py = Math.floor((i / 4) / cv.width);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      n++;
    }
  }
  if (!n) return { none: true };
  // 屏幕包围盒 → 世界包围盒
  const a = cam.s2w(minX / dpr, minY / dpr), b = cam.s2w(maxX / dpr, maxY / dpr);
  return { px: n, world: { w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, screen: { w: (maxX - minX) / dpr, h: (maxY - minY) / dpr } };
}, type);

// ① 圆 + 归入它的坐标系
await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  cam.x = 0; cam.y = 0; cam.z = 40;
  const c = S.addEntity(st, "circle", { cx: 0, cy: 0, r: 2 });
  S.ensureEvaluated(st);
  S.assignCoordsys(st, [c.id]);          // 与右键「以此创建坐标系」同一路径
  S.ensureEvaluated(st);
  st.selection.clear();
  window.__IW.renderOnce();
});
await new Promise((r) => setTimeout(r, 600));
const cs = await measure("coordsys");
const circle = await measure("circle");
console.log(`① 有成员（圆 r=2）：坐标系格子世界包围盒 = ${cs.world.w.toFixed(2)} × ${cs.world.h.toFixed(2)} | 像素 ${cs.px}`);
console.log(`   圆的包围盒 = ${circle.world.w.toFixed(2)} × ${circle.world.h.toFixed(2)}（画布可视区约 ${(1400 / 40).toFixed(0)} × ${(900 / 40).toFixed(0)} 世界单位）`);
if (cs.none) bad.push("坐标系没有画出任何格子");
else {
  // 格子应覆盖圆（≥ 圆本身），但远小于视口（用户要求：只覆盖该坐标系里的图形）
  if (!(cs.world.w >= circle.world.w * 0.9 && cs.world.h >= circle.world.h * 0.9)) bad.push(`格子没有覆盖到成员圆（${cs.world.w.toFixed(2)} vs ${circle.world.w.toFixed(2)}）`);
  const viewW = 1400 / 40, viewH = 900 / 40;
  if (!(cs.world.w < viewW * 0.6 && cs.world.h < viewH * 0.6)) bad.push(`格子仍然铺得很满（${cs.world.w.toFixed(2)}×${cs.world.h.toFixed(2)}，视口 ${viewW}×${viewH}）`);
  console.log(`   覆盖倍数：格子/圆 = ${(cs.world.w / circle.world.w).toFixed(2)}（应略大于 1）| 格子/视口 = ${(cs.world.w / viewW).toFixed(2)}（应明显小于 1）`);
}

// ② 没有成员的坐标系
await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st;
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  S.addEntity(st, "coordsys", { x: 0, y: 0, scale: 50, rot: 0 });
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
});
await new Promise((r) => setTimeout(r, 500));
const empty = await measure("coordsys");
console.log(`② 无成员：格子世界包围盒 = ${empty.none ? "无" : empty.world.w.toFixed(2) + " × " + empty.world.h.toFixed(2)}`);
if (empty.none) bad.push("空坐标系没有画出任何参考格子");
else {
  const viewW = 1400 / 40;
  if (!(empty.world.w < viewW * 0.4)) bad.push(`空坐标系仍然铺得很满（${empty.world.w.toFixed(2)}，视口 ${viewW}）`);
}

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/req2-grid-scope.png" });
console.log("截图 → tests/artifacts/req2-grid-scope.png");
await browser.close();
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); process.exit(1); }
console.log("✅ 需求② 通过：坐标系格子只覆盖该坐标系里的图形（空坐标系只给一小块参考）");
