// 需求②验收：选平行/垂直时**不用简易列表**，列表样式与「关联」操作面板一致
//
// 判据：
//   ① 右键菜单里只剩「约束…」一个入口（不再把各约束类型平铺成简易列表）
//   ② 约束面板显示在**左上操作面板**里且真的可见（计算 opacity，不能只看 hidden）
//   ③ 参照是**按钮列表**（.wizList + .wizVarBtn），**没有** <select> 下拉
//   ④ 选参照=另一条线后，类型标签自动变成「平行 / 垂直」（语义正确）
//   ⑤ 点「添加约束」真的加上对应 kind
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  const a = S.addEntity(st, "segment", { x1: -6, y1: -2, x2: -2, y2: -2 });
  S.addEntity(st, "segment", { x1: 2, y1: 1, x2: 6, y2: 1 });
  S.ensureEvaluated(st);
  st.selection = new Set([a.id]); S.emit(st, "selection");
  window.__IW.renderOnce();
});
await page.evaluate(() => {
  const s = window.__IW.cam.w2s(-4, -2);
  document.getElementById("cv").dispatchEvent(new MouseEvent("contextmenu", { clientX: s[0], clientY: s[1], bubbles: true, cancelable: true }));
});
await wait(400);
const acts = await page.evaluate(() => [...document.querySelectorAll("button[data-act]")].map((x) => x.getAttribute("data-act")));
const constraintActs = acts.filter((a) => a.startsWith("constraint"));
console.log(`① 约束相关菜单项 = ${JSON.stringify(constraintActs)}`);
if (constraintActs.length !== 1 || constraintActs[0] !== "constraintConfig") {
  bad.push(`约束入口不是"单一入口 + 面板"（实测 ${JSON.stringify(constraintActs)}）`);
}

await page.evaluate(() => { const b = document.querySelector('button[data-act="constraintConfig"]'); if (b) b.click(); });
await wait(600);
const panel = await page.evaluate(() => {
  const op = document.getElementById("opPop");
  const cs = getComputedStyle(op);
  const r = op.getBoundingClientRect();
  return {
    hidden: op.hidden, opacity: Number(cs.opacity), x: Math.round(r.x), y: Math.round(r.y),
    title: (document.querySelector("#opPopBody .wizTitle") || {}).textContent || "",
    refBtns: [...document.querySelectorAll("#opPopBody [data-ref]")].map((b) => b.textContent.trim().split(" ")[0]),
    tabs: [...document.querySelectorAll("#opPopBody [data-cc]")].map((b) => b.textContent.trim()),
    hasSelect: !!document.querySelector("#opPopBody select"),
    listCls: !!document.querySelector("#opPopBody .wizList"),
    btnCls: document.querySelectorAll("#opPopBody .wizVarBtn").length,
  };
});
console.log(`② 面板：hidden=${panel.hidden} opacity=${panel.opacity} 位置=(${panel.x},${panel.y}) 标题="${panel.title}"`);
console.log(`   参照=按钮列表${JSON.stringify(panel.refBtns)}（.wizList=${panel.listCls}，.wizVarBtn×${panel.btnCls}）| 下拉 select=${panel.hasSelect} | 类型=${JSON.stringify(panel.tabs)}`);
if (panel.hidden || !(panel.opacity > 0.9)) bad.push("约束面板不可见（或没在操作面板里）");
if (!(panel.x < 400)) bad.push(`约束面板不在左上角（x=${panel.x}）`);
if (panel.hasSelect) bad.push("参照仍然是下拉简易列表（应为关联面板式按钮列表）");
if (!panel.listCls || panel.btnCls < 2) bad.push("参照列表没有采用关联面板的按钮列表样式");
if (panel.tabs.join(",") !== "水平,竖直") bad.push(`参照=世界坐标系时类型应为 水平/竖直（实测 ${panel.tabs.join(",")}）`);

// ③ 选参照=另一条线 → 类型变 平行/垂直
await page.evaluate(() => { const b = document.querySelectorAll("#opPopBody [data-ref]")[1]; if (b) b.click(); });
await wait(400);
const tabs2 = await page.evaluate(() => [...document.querySelectorAll("#opPopBody [data-cc]")].map((b) => b.textContent.trim()));
console.log(`③ 参照=另一条线 → 类型 = ${JSON.stringify(tabs2)}`);
if (tabs2.join(",") !== "平行,垂直") bad.push(`参照是线时类型应变为 平行/垂直（实测 ${tabs2.join(",")}）`);

// ④ 添加约束
await page.evaluate(() => { const g = document.getElementById("ccGo"); if (g) g.click(); });
await wait(500);
const res = await page.evaluate(() => {
  const st = window.__IW.st;
  const c = [...st.constraints.values()][0];
  return { n: st.constraints.size, kind: c && c.kind, refs: c && c.refs };
});
console.log(`④ 添加结果 = ${JSON.stringify(res)}`);
if (res.n !== 1 || res.kind !== "parallel") bad.push(`没有加上平行约束（实测 ${JSON.stringify(res)}）`);

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
await page.screenshot({ path: "D:/zhuo_mian/Interweaver/app/tests/artifacts/constraint-panel.png" });
console.log("截图 → tests/artifacts/constraint-panel.png");
await browser.close();
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); process.exit(1); }
console.log("✅ 需求② 通过：约束选择走左上操作面板，参照用关联面板式按钮列表，类型随参照动态变化");
