// T3/T5 验收：隐函数在真实浏览器里能创建、能渲染、能被"用点切出曲线"。
//
// 走**真实用户路径**：打开函数创作器 → 输入 x^2+y^2=1 → 点"在画布上生成图像"；
// 然后：
//   ① 实体确实被创建为 implicit，且表达式已归一为 F = (x^2+y^2) - (1)
//   ② 像素断言：画布上出现该实体颜色的**圆环像素**（> 阈值）
//   ③ 弧长参数化真的可用：pointOnHost(t) 的点满足 |F| ≈ 0；projectOnHost 往返一致
//   ④ y^2 = x^3 - x 是**两个连通分量**（隐函数的本质能力，单值函数做不到）
//   ⑤ 帧耗时 < 32ms（用户设定的渲染预算）
// 说明：用 import('/src/entities.js') 取**同一个模块实例**（ESM 缓存），因此不往产品代码加任何测试后门。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on("unhandledRejection", (e) => { console.log("崩溃(async)：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1500,940", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.__IW);
await new Promise((r) => setTimeout(r, 700));

const bad = [];

// ① 用真实 UI 创建隐函数
const created = await page.evaluate(async () => {
  // 打开函数创作器（工具栏 fx 按钮）
  document.querySelector('#toolbar button[data-tool="fx"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const input = document.querySelector('#fxInput');
  if (!input) return { error: '找不到 #fxInput' };
  input.value = 'x^2+y^2=1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const errText = document.querySelector('#fxErr')?.textContent || '';
  document.querySelector('#fxGo')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const st = window.__IW.st;
  const ent = [...st.entities.values()].find((e) => e.type === 'implicit');
  return {
    errText,
    found: !!ent,
    expr: ent ? ent.expr : null,
    color: ent ? ent.color : null,
    id: ent ? ent.id : null,
  };
});
console.log(`① 创建：errText="${created.errText}" | 隐函数实体=${created.found} expr=${created.expr}`);
if (created.error) bad.push(created.error);
if (!created.found) bad.push("真实 UI 路径没有创建出 implicit 实体");
if (created.expr && created.expr.indexOf("(x^2+y^2) - (1)") < 0) bad.push(`表达式未归一为 F：${created.expr}`);

// ② 像素断言：该实体颜色的圆环像素
//    注意：fx 生成后会把新实体设为**选中**，而选中态是按 ACCENT 颜色绘制的 →
//    先清空选中，曲线才会用自身颜色（否则会统计错颜色，得到假 0）。
await page.evaluate(() => { window.__IW.st.selection.clear(); window.__IW.S.emit(window.__IW.st, 'selection'); });
await new Promise((r) => setTimeout(r, 700));
const b64 = await page.screenshot({ encoding: "base64" });
const pix = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const st = window.__IW.st;
  const ent = [...st.entities.values()].find((e) => e.type === "implicit");
  const hex = (ent && ent.color ? ent.color : "#000000").replace("#", "");
  const tr = parseInt(hex.slice(0, 2), 16), tg = parseInt(hex.slice(2, 4), 16), tb = parseInt(hex.slice(4, 6), 16);
  let hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - tr) < 40 && Math.abs(d[i + 1] - tg) < 40 && Math.abs(d[i + 2] - tb) < 40) hit++;
  }
  // 诊断：曲线世界坐标包围盒 vs 当前视口
  let bbox = null;
  try {
    const GE = window.__IW;
    const c = (ent && ent.ast) ? null : null;
    void c;
    const pts = [];
    bbox = { n: pts.length };
  } catch { bbox = null; }
  // 形状断言所需：曲线像素的包围盒 + 相机缩放下的预期直径
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - tr) < 40 && Math.abs(d[i + 1] - tg) < 40 && Math.abs(d[i + 2] - tb) < 40) {
      const px = (i / 4) % cv.width, py = Math.floor((i / 4) / cv.width);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
  }
  const cam = window.__IW.cam;
  const rPx = (cam && cam.z ? cam.z : 50) * 1;   // 半径 1 世界单位 → 屏幕像素
  return { hit, color: ent ? ent.color : null,
    box: Number.isFinite(minX) ? { w: maxX - minX, h: maxY - minY } : null,
    expectD: 2 * rPx };
}, "data:image/png;base64," + b64);
console.log(`② 像素：实体颜色 ${pix.color} 的像素数 = ${pix.hit}`);
if (pix.hit < 150) bad.push(`曲线上色像素过少（${pix.hit}）→ 隐函数可能没画出来`);
if (pix.box) {
  const { w, h } = pix.box;
  console.log(`② 形状：包围盒 ${w}×${h} px（预期直径 ≈ ${Math.round(pix.expectD)} px；圆的包围盒应接近正方形）`);
  if (Math.abs(w - h) > Math.max(12, 0.15 * Math.max(w, h))) bad.push(`包围盒不是正方形（${w}×${h}）→ 渲染出来的不是圆`);
  if (Math.abs(w - pix.expectD) > 0.2 * pix.expectD) bad.push(`直径 ${w}px 与预期 ${Math.round(pix.expectD)}px 相差超过 20%`);
} else bad.push('没有找到任何曲线像素的包围盒');

// ③ 弧长参数化 + 往返（真实调用 entities.js 的宿主接口）
const param = await page.evaluate(async () => {
  const E = await import("/src/entities.js");
  const st = window.__IW.st;
  const ent = [...st.entities.values()].find((e) => e.type === "implicit");
  if (!ent || !E.pointOnHost || !E.projectOnHost) return { error: "接口不可用" };
  const F = (x, y) => st.scope.evalWith2(ent.ast, x, y);
  let worstF = 0, worstRT = 0, pts = 0;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const p = E.pointOnHost(ent, st.env, t);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { error: "pointOnHost 返回非有限值（t=" + t + "）" };
    pts++;
    worstF = Math.max(worstF, Math.abs(F(p[0], p[1])));
    const t2 = E.projectOnHost(ent, st.env, { x: p[0], y: p[1] });
    worstRT = Math.max(worstRT, Math.abs(t2 - t));
  }
  return { pts, worstF, worstRT };
});
console.log(`③ 参数化：采样 ${param.pts} 个点 | 最大 |F| = ${param.worstF !== undefined ? param.worstF.toExponential(2) : param.error} | 往返误差 ${param.worstRT !== undefined ? param.worstRT.toExponential(2) : "—"}`);
if (param.error) bad.push("参数化接口：" + param.error);
else {
  if (param.worstF > 0.05) bad.push(`pointOnHost 的点不在曲线上：最大 |F| = ${param.worstF}`);
  if (param.worstRT > 5e-3) bad.push(`往返不一致：${param.worstRT}`);
}

// ④ 两块分量：y^2 = x^3 - x
const two = await page.evaluate(async () => {
  const GE = await import("/src/implicitGeom.js");
  const PE = await import("/src/expr.js");
  const eq = PE.parseEquation("y^2=x^3-x");
  const c = GE.buildContours({ x0: -2, y0: -3, x1: 3, y1: 3, cell: 0.03, F: (x, y) => window.__IW.st.scope.evalWith2(eq.ast, x, y) });
  return { kind: eq.kind, comps: c.components.length, total: Math.round(c.total) };
});
console.log(`④ y^2=x^3-x：kind=${two.kind} | 连通分量 = ${two.comps} | 总弧长 ≈ ${two.total}`);
if (two.kind !== "implicit") bad.push("parseEquation 未判为 implicit");
if (two.comps < 2) bad.push(`应有多于 1 个连通分量（实测 ${two.comps}）`);

// ⑤ 帧耗时（32ms 预算）
const perf = await page.evaluate(() => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) window.__IW.renderOnce();
  return (performance.now() - t0) / 20;
});
console.log(`⑤ 单帧绘制 = ${perf.toFixed(2)} ms（预算 32ms）`);
if (perf >= 32) bad.push(`单帧绘制 ${perf.toFixed(2)} ms 超出 32ms 预算`);

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/implicit-circle.png" });
console.log("截图 → tests/artifacts/implicit-circle.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 隐函数可用：真实 UI 创建、像素可见、弧长参数化与往返一致、多分量正确、帧耗时达标");
await browser.close();
process.exit(bad.length ? 1 : 0);
