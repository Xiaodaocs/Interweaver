// S3 验收（用户要求 ①②③按钮部分）：
//   ① 八个工具在**画布下方**横排，工具栏宽 ≈ 屏宽 2/3，按钮高 ≈ 原 1.5 倍（36→54）
//   ② 预设库按钮**移出**八项、单独一组在工具栏**左侧**、比工具按钮略大、与工具栏有间隔
//   ③ 八项里出现「坐标系」工具（替换了预设库的位置），且点击画布能建立**真实**坐标系实体
//      （不是占位：实体可创建、可选中、能画出坐标轴与网格像素）
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
await new Promise((r) => setTimeout(r, 600));

const bad = [];
const geo = await page.evaluate(() => {
  const tb = document.getElementById('toolbar').getBoundingClientRect();
  const pb = document.getElementById('presetBtn').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#toolbar button[data-tool]')];
  const b0 = btns[0].getBoundingClientRect();
  return {
    vw: innerWidth, vh: innerHeight,
    tb: { x: tb.x, y: tb.y, w: tb.width, h: tb.height },
    pb: { x: pb.x, y: pb.y, w: pb.width, h: pb.height },
    btnW: b0.width, btnH: b0.height,
    tools: btns.map((b) => b.dataset.tool),
    row: [...document.querySelectorAll('#toolbar button')].every((b) => Math.abs(b.getBoundingClientRect().top - b0.top) < 3),
  };
});
const ratio = geo.tb.w / geo.vw;
console.log(`① 工具栏：x=${geo.tb.x.toFixed(0)} y=${geo.tb.y.toFixed(0)} 宽=${geo.tb.w.toFixed(0)}（屏宽 ${geo.vw} 的 ${(ratio * 100).toFixed(1)}%）高=${geo.tb.h.toFixed(0)} | 按钮 ${geo.btnW.toFixed(0)}×${geo.btnH.toFixed(0)}`);
console.log(`   八项 = ${geo.tools.join(',')} | 同一行 = ${geo.row}`);
if (Math.abs(ratio - 2 / 3) > 0.04) bad.push(`工具栏宽应为屏宽 2/3，实测 ${(ratio * 100).toFixed(1)}%`);
if (geo.tb.y + geo.tb.h < geo.vh - 120) bad.push(`工具栏应在画布下方（实测底边距视口底 ${(geo.vh - geo.tb.y - geo.tb.h).toFixed(0)}px）`);
if (Math.abs(geo.btnH - 54) > 3) bad.push(`按钮高应约 54px（36 的 1.5 倍），实测 ${geo.btnH.toFixed(0)}`);
if (!geo.row) bad.push('八个工具不在同一行');
if (geo.tools.length !== 8) bad.push(`工具数应为 8，实测 ${geo.tools.length}`);
if (!geo.tools.includes('coordsys')) bad.push('八项里没有坐标系工具');
if (geo.tools.includes('presets')) bad.push('预设库仍在八项里（应已移出）');

const gap = geo.tb.x - (geo.pb.x + geo.pb.w);
console.log(`② 预设库按钮：x=${geo.pb.x.toFixed(0)} 宽=${geo.pb.w.toFixed(0)} | 在工具栏左侧 = ${geo.pb.x < geo.tb.x} | 间隔 = ${gap.toFixed(0)}px | 比工具按钮大 = ${geo.pb.w > geo.btnW}`);
if (!(geo.pb.x < geo.tb.x)) bad.push('预设库按钮不在工具栏左侧');
if (gap <= 4) bad.push(`预设库与工具栏之间应有小间隔，实测 ${gap.toFixed(0)}px`);
if (!(geo.pb.w > geo.btnW)) bad.push('预设库按钮应比工具按钮略大');

// ③ 坐标系工具：真实创建 + 真实渲染
const coord = await page.evaluate(async () => {
  const before = window.__IW.st.entities.size;
  document.querySelector('#toolbar button[data-tool="coordsys"]').click();
  await new Promise((r) => setTimeout(r, 200));
  const tool = window.__IW.st.tool;
  const cv = document.getElementById('cv');
  const r = cv.getBoundingClientRect();
  // 点画布中央偏左，避开底部工具条
  const x = r.left + r.width * 0.45, y = r.top + r.height * 0.45;
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 7 }));
  cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 7 }));
  await new Promise((r2) => setTimeout(r2, 500));
  const st = window.__IW.st;
  const cs = [...st.entities.values()].find((e) => e.type === 'coordsys');
  return {
    toolBefore: tool,
    created: !!cs,
    id: cs ? cs.id : null,
    params: cs ? { x: Math.round(cs.params.x), y: Math.round(cs.params.y), scale: cs.params.scale, rot: cs.params.rot } : null,
    grew: st.entities.size - before,
    toolAfter: st.tool,
  };
});
console.log(`③ 坐标系工具：点击后工具=${coord.toolBefore} | 新建实体=${coord.grew} | 实体=${coord.id} 参数=${JSON.stringify(coord.params)} | 用后自动回选择工具=${coord.toolAfter === 'select'}`);
if (!coord.created) bad.push('点画布没有建立坐标系实体（工具没生效）');
if (coord.toolAfter !== 'select') bad.push('建立后应自动回到选择工具');

// 像素：坐标系应画出网格/坐标轴（统计该实体颜色像素）
// 注意：工具建立后会**选中**新实体，而选中态按 ACCENT 颜色绘制 → 先取消选中，否则统计的是错颜色（假 0）
await page.evaluate(() => { window.__IW.st.selection.clear(); window.__IW.S.emit(window.__IW.st, 'selection'); });
await new Promise((r) => setTimeout(r, 600));
const b64 = await page.screenshot({ encoding: "base64" });
const pix = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const st = window.__IW.st;
  const ent = [...st.entities.values()].find((e) => e.type === 'coordsys');
  const hex = (ent && ent.color ? ent.color : '#000000').replace('#', '');
  const tr = parseInt(hex.slice(0, 2), 16), tg = parseInt(hex.slice(2, 4), 16), tb = parseInt(hex.slice(4, 6), 16);
  let hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - tr) < 42 && Math.abs(d[i + 1] - tg) < 42 && Math.abs(d[i + 2] - tb) < 42) hit++;
  }
  return { hit, color: ent ? ent.color : null };
}, "data:image/png;base64," + b64);
console.log(`③ 坐标系渲染：颜色 ${pix.color} 像素数 = ${pix.hit}（网格+坐标轴+原点）`);
if (pix.hit < 500) bad.push(`坐标系的网格/坐标轴像素过少（${pix.hit}）→ 可能没画出来`);

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/ui-S3-toolbar.png" });
console.log("截图 → tests/artifacts/ui-S3-toolbar.png");
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ S3 通过：工具栏在底部且宽 2/3、按钮 ×1.5、预设库单独在左且有间隔、坐标系工具真实可用");
await browser.close();
process.exit(bad.length ? 1 : 0);
