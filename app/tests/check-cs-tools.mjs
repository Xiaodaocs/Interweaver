// 需求 ③ 验收：坐标系工具提供三个子工具
//   1) 创建新坐标系（武装放置工具）
//   2) 坐标系视图（显示/隐藏各坐标系；支持隐藏世界坐标系＝画布主网格；支持全部隐藏）
//   3) 坐标系管理（删除坐标系；把选中的实体放入某坐标系，**或同时放入两个**）
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1) 点坐标系工具 → 弹出三选项菜单 ----------
await page.click('#toolbar button[data-tool="coordsys"]');
await wait(400);
const menu = await page.evaluate(() => {
  const m = document.getElementById('csMenu');
  const r = m.getBoundingClientRect();
  const tb = document.getElementById('toolbar').getBoundingClientRect();
  return { hidden: m.hidden, items: [...m.querySelectorAll('[data-csact]')].map((b) => b.dataset.csact), y: r.y, h: r.height, toolbarTop: tb.top };
});
console.log(`① 三选项菜单：显示=${!menu.hidden} 项=${JSON.stringify(menu.items)} 底边=${(menu.y + menu.h).toFixed(0)} 工具栏顶=${menu.toolbarTop.toFixed(0)}`);
if (menu.hidden) bad.push('点坐标系工具没有弹出三选项菜单');
if (menu.items.join(',') !== 'create,view,manage') bad.push('菜单项不是 创建/视图/管理 三个');
if (!(menu.y + menu.h <= menu.toolbarTop + 1)) bad.push('三选项菜单压住了底部工具栏');

// ---------- 1b) 创建新坐标系：武装工具 ----------
await page.evaluate(() => document.querySelector('[data-csact="create"]').click());
await wait(300);
const armed = await page.evaluate(() => window.__IW.st.tool);
console.log(`① 创建新坐标系 → st.tool = ${armed}`);
if (armed !== 'coordsys') bad.push('点「创建新坐标系」没有武装放置工具');

// 放两个坐标系 + 一个圆，供视图/管理用
await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  cam.x = 0; cam.y = 0; cam.z = 40;
  const csA = S.addEntity(st, 'coordsys', { x: -5, y: 0, scale: 50, rot: 0 });
  const csB = S.addEntity(st, 'coordsys', { x: 5, y: 0, scale: 50, rot: 0 });
  const c = S.addEntity(st, 'circle', { cx: -5, cy: 0, r: 2 });
  S.ensureEvaluated(st);
  window.__CSIDS = { a: csA.id, b: csB.id, c: c.id };
  st.selection = new Set([c.id]); S.emit(st, 'selection');
  window.__IW.renderOnce();
});
await wait(300);

// ---------- 2) 坐标系视图：隐藏/显示 ----------
await page.evaluate(() => { window.__IW.st.tool = 'select'; document.querySelector('#toolbar button[data-tool="coordsys"]').click(); });
await wait(300);
await page.evaluate(() => document.querySelector('[data-csact="view"]').click());
await wait(500);
const view = await page.evaluate(() => {
  const p = document.getElementById('csPanel');
  return { hidden: p.hidden, title: document.getElementById('csPanelTitle').textContent,
    hasWorld: !!document.querySelector('#csPanelBody [data-world]'),
    csChecks: [...document.querySelectorAll('#csPanelBody [data-cs]')].length,
    allOn: !!document.querySelector('#csPanelBody [data-act="allOn"]'), allOff: !!document.querySelector('#csPanelBody [data-act="allOff"]') };
});
console.log(`② 视图面板：显示=${!view.hidden} 标题=${view.title} 世界坐标系开关=${view.hasWorld} 坐标系开关=${view.csChecks} 全部显示/隐藏=${view.allOn}/${view.allOff}`);
if (view.hidden) bad.push('坐标系视图面板没有显示');
if (!view.hasWorld) bad.push('视图面板里没有「世界坐标系」开关');
if (view.csChecks !== 2) bad.push(`视图面板里的坐标系开关数应为 2，实测 ${view.csChecks}`);

// 隐藏 A → 该坐标系不绘制（像素度量）
const pixOf = (csId) => page.evaluate((id) => {
  const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const st = window.__IW.st;
  const ent = st.entities.get(id);
  const hex = (ent.color || '#000000').replace('#', '');
  const tr = parseInt(hex.slice(0, 2), 16), tg = parseInt(hex.slice(2, 4), 16), tb = parseInt(hex.slice(4, 6), 16);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - tr) < 26 && Math.abs(d[i + 1] - tg) < 26 && Math.abs(d[i + 2] - tb) < 26) n++;
  return n;
}, csId);
const beforeHide = await pixOf((await page.evaluate(() => window.__CSIDS.a)));
await page.evaluate(() => {
  const id = window.__CSIDS.a;
  const cb = document.querySelector('#csPanelBody [data-cs="' + id + '"]');
  cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(500);
const afterHide = await pixOf((await page.evaluate(() => window.__CSIDS.a)));
console.log(`② 隐藏坐标系 A：像素 ${beforeHide} → ${afterHide}（应显著减少）`);
if (!(afterHide < beforeHide * 0.5)) bad.push(`取消勾选后坐标系 A 仍在绘制（${beforeHide} → ${afterHide}）`);
const visFlag = await page.evaluate(() => window.__IW.st.entities.get(window.__CSIDS.a).visible);
if (visFlag !== false) bad.push('隐藏后 visible 标记不是 false');

// 全部隐藏 → 世界坐标系（主网格）也应关掉
await page.evaluate(() => document.querySelector('#csPanelBody [data-act="allOff"]').click());
await wait(500);
const afterAllOff = await page.evaluate(async () => {
  const S = await import('/src/settings.js');
  return { grid: S.getSetting('grid'), vis: [...window.__IW.st.entities.values()].filter((e) => e.type === 'coordsys').map((e) => e.visible) };
});
console.log(`② 全部隐藏：世界坐标系(主网格)=${afterAllOff.grid} 各坐标系 visible=${JSON.stringify(afterAllOff.vis)}`);
if (afterAllOff.grid !== false) bad.push('「全部隐藏」没有隐藏世界坐标系（主网格）');
if (afterAllOff.vis.some((v) => v !== false)) bad.push('「全部隐藏」没有隐藏所有坐标系');

// ---------- 3) 坐标系管理：删除 + 归属（一个 / 两个） ----------
await page.evaluate(() => { document.querySelector('#csPanelClose').click(); document.querySelector('#toolbar button[data-tool="coordsys"]').click(); });
await wait(300);
await page.evaluate(() => document.querySelector('[data-csact="manage"]').click());
await wait(500);
const manage = await page.evaluate(() => ({
  hidden: document.getElementById('csPanel').hidden,
  title: document.getElementById('csPanelTitle').textContent,
  rows: [...document.querySelectorAll('#csPanelBody .csRow')].map((r) => r.dataset.row),
  putBtns: document.querySelectorAll('#csPanelBody [data-put]').length,
  addBtns: document.querySelectorAll('#csPanelBody [data-add]').length,
  delBtns: document.querySelectorAll('#csPanelBody [data-del]').length,
}));
console.log(`③ 管理面板：显示=${!manage.hidden} 标题=${manage.title} 行=${manage.rows.length} 放入=${manage.putBtns} 同时加入=${manage.addBtns} 删除=${manage.delBtns}`);
if (manage.hidden) bad.push('坐标系管理面板没有显示');
if (manage.rows.length !== 2) bad.push(`管理面板应有 2 个坐标系行，实测 ${manage.rows.length}`);
if (manage.putBtns !== 2 || manage.addBtns !== 2 || manage.delBtns !== 2) bad.push('管理面板按钮不全（放入/同时加入/删除 各应有 2 个）');

// 3a) 放入 A
await page.evaluate(() => { const id = window.__CSIDS.a; document.querySelector('#csPanelBody [data-put="' + id + '"]').click(); });
await wait(400);
let csVal = await page.evaluate(() => window.__IW.st.entities.get(window.__CSIDS.c).cs);
console.log(`③ 放入坐标系 A：圆的 cs = ${JSON.stringify(csVal)}`);
if (csVal !== (await page.evaluate(() => window.__CSIDS.a))) bad.push('「放入」没有把圆归入坐标系 A');

// 3b) 同时加入 B → 应变成数组（同时属于两个）
await page.evaluate(() => { const id = window.__CSIDS.b; document.querySelector('#csPanelBody [data-add="' + id + '"]').click(); });
await wait(400);
const both = await page.evaluate(() => ({ cs: window.__IW.st.entities.get(window.__CSIDS.c).cs, a: window.__CSIDS.a, b: window.__CSIDS.b }));
console.log(`③ 同时加入坐标系 B：圆的 cs = ${JSON.stringify(both.cs)}（应为数组且含两个 id）`);
if (!Array.isArray(both.cs) || both.cs.length !== 2 || !both.cs.includes(both.a) || !both.cs.includes(both.b)) bad.push('「同时加入」没有让实体同时属于两个坐标系');

// 3c) 删除 B → 只应从数组里摘掉 B，圆仍在
await page.evaluate(() => { const id = window.__CSIDS.b; document.querySelector('#csPanelBody [data-del="' + id + '"]').click(); });
await wait(500);
const afterDel = await page.evaluate(() => ({
  cs: window.__IW.st.entities.get(window.__CSIDS.c).cs,
  bGone: !window.__IW.st.entities.get(window.__CSIDS.b),
  circleAlive: !!window.__IW.st.entities.get(window.__CSIDS.c),
}));
console.log(`③ 删除坐标系 B：圆仍在=${afterDel.circleAlive} B 已删除=${afterDel.bGone} 圆的 cs=${JSON.stringify(afterDel.cs)}`);
if (!afterDel.circleAlive) bad.push('删除坐标系时误删了成员图形');
if (!afterDel.bGone) bad.push('坐标系 B 没有被删除');
if (JSON.stringify(afterDel.cs) !== JSON.stringify(await page.evaluate(() => window.__CSIDS.a))) bad.push('删除 B 后圆的归属没有正确回退为只剩 A');

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/req3-cs-tools.png" });
console.log("截图 → tests/artifacts/req3-cs-tools.png");
await browser.close();
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); process.exit(1); }
console.log("✅ 需求③ 通过：三工具（创建/视图/管理）齐备，隐藏与归属（含同时属于两个）都生效");
