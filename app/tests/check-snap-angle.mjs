// S12 验收（用户要求 ⑦ 操作设置：鼠标吸附相关的「角度吸附」）
// 判据：开启角度吸附时，拖出的线段方向必须落在 15° 的整数倍上（且长度不变）；
//       关闭时方向保持原始值（不吸附）。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const bad = [];
const load = async (settings) => {
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { try { localStorage.setItem('interweaver.settings.v1', JSON.stringify(s)); localStorage.removeItem('interweaver.draft.v1'); } catch (e) {} }, settings);
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 350));
};
// 拖一条约 20° 的线段（20° 最靠近 15°，离 30° 更远 → 吸附后应为 15°）
const drawSeg = async (deg) => page.evaluate(async (d) => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  // 清空场景：避免草稿恢复把上一次运行的线段带进来（见文件头注释）
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  S.ensureEvaluated(st);
  st.tool = 'segment';
  const rad = d * Math.PI / 180, L = 4;
  const a = { x: -2, y: -1 };
  const b = { x: a.x + Math.cos(rad) * L, y: a.y + Math.sin(rad) * L };
  const sa = cam.w2s(a.x, a.y), sb = cam.w2s(b.x, b.y);
  const cv = document.getElementById('cv');
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: sa[0], clientY: sa[1], bubbles: true, button: 0, pointerId: 21 }));
  for (let i = 1; i <= 6; i++) {
    const x = sa[0] + (sb[0] - sa[0]) * i / 6, y = sa[1] + (sb[1] - sa[1]) * i / 6;
    cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 21 }));
  }
  cv.dispatchEvent(new PointerEvent('pointerup', { clientX: sb[0], clientY: sb[1], bubbles: true, button: 0, pointerId: 21 }));
  await new Promise((r) => setTimeout(r, 350));
  const segs = [...st.entities.values()].filter((e) => e.type === 'segment');
  const seg = segs[segs.length - 1];   // 取这一次画出来的那条（场景已清空，这里只是双保险）
  if (!seg) return { none: true };
  const dx = seg.params.x2 - seg.params.x1, dy = seg.params.y2 - seg.params.y1;
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const len = Math.hypot(dx, dy);
  const onGrid15 = Math.abs(ang / 15 - Math.round(ang / 15)) < 0.01;
  return { ang, len, onGrid15 };
}, deg);
const base = { achShot: true, snapGrid: false, snapEndpoint: false, shortcuts: true };
// ① 开启角度吸附：20° 应被吸到 15°
await load({ ...base, snapAngle: true });
const on = await drawSeg(20);
console.log(`① 角度吸附开：拖 20° → 实测 ${on.none ? '没画出线段' : on.ang.toFixed(3) + '°'}（长度 ${on.none ? '-' : on.len.toFixed(3)}）| 落在 15° 整数倍 = ${on.onGrid15}`);
if (on.none) bad.push('角度吸附开启时没能画出线段');
else {
  if (!on.onGrid15) bad.push('开启角度吸附后方向不在 15° 整数倍上（实测 ' + on.ang.toFixed(3) + '°）');
  if (Math.abs(on.ang - 15) > 0.01) bad.push('20° 应吸到最近的 15°（实测 ' + on.ang.toFixed(3) + '°）');
  if (Math.abs(on.len - 4) > 0.05) bad.push('吸附不应改变长度（实测 ' + on.len.toFixed(3) + '，期望 ≈4）');
}
// ② 关闭角度吸附：方向应保持原始值（约 20°，不是 15°）
await load({ ...base, snapAngle: false });
const off = await drawSeg(20);
console.log(`② 角度吸附关：拖 20° → 实测 ${off.none ? '没画出线段' : off.ang.toFixed(3) + '°'}（长度 ${off.none ? '-' : off.len.toFixed(3)}）`);
if (off.none) bad.push('关闭角度吸附时没能画出线段');
else {
  if (Math.abs(off.ang - 20) > 1.5) bad.push('关闭角度吸附后方向被改动了（实测 ' + off.ang.toFixed(3) + '°，期望 ≈20°）');
  if (off.onGrid15) bad.push('关闭角度吸附后方向却仍落在 15° 整数倍上（疑似仍吸附）');
}
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ S12 通过：角度吸附真实生效（开启吸到 15° 整数倍且不改长度，关闭保持原始方向）');
