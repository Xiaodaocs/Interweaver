// 验收（用户拍板方案 c）：隐函数上**明确禁用**积分/导函数曲线，并给出理由（不是静默无反应）。
// 同时验证：菜单里那份重复的宿主判断已修好 —— 隐函数宿主现在**能拿到**切线/割线入口。
//
// 判据：
//   ① 在隐函数上右键 → 菜单出现「∫ 积分（隐函数不支持）」与「ƒ′ 导函数曲线（隐函数不支持）」
//   ② 点击积分项 → hint 里出现**具体理由**（含"隐函数不支持积分"），且**没有**创建 integral 实体
//   ③ 隐函数上的线上点右键 → 菜单出现「在这一点作切线」（引擎已支持，入口此前被本地判断挡住）
//   ④ 0 运行时错误
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

const bad = [];

// 建隐函数 + 线上点（走应用 API，几何与 check-implicit-calculus 一致）
const ids = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st;
  const PE = await import('/src/expr.js');
  const eq = PE.parseEquation('x^2+y^2=1');
  const host = S.addEntity(st, 'implicit', {}, { expr: eq.fSrc, ast: eq.ast });
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  const ep = S.addEdgePoint(st, host.id, 0.25);
  S.ensureEvaluated(st);
  return { host: host.id, point: ep && ep.point ? ep.point.id : null };
});
console.log(`准备：隐函数 ${ids.host} | 线上点 ${ids.point}`);

// ① 右键隐函数本体 → 菜单项
async function menuOn(entId, probeT) {
  void probeT;
  const pos = await page.evaluate(async (id) => {
    const st = window.__IW.st;
    const ent = st.entities.get(id);
    const cam = window.__IW.cam;
    const E = await import('/src/entities.js');
    let wx = 0, wy = 0;
    if (ent.type === 'edgepoint') {
      const p = E.pointOnHost(st.entities.get(ent.host), st.env, st.env.val(ent.id, 't'));
      wx = p[0]; wy = p[1];
    } else if (ent.type === 'implicit') {
      // 关键：隐函数的锚点是原点，而圆 x²+y²=1 **不经过原点**，
      // 右键必须落在**曲线上的点**才会命中该实体（否则落在空白处，菜单为空）。
      const p = E.pointOnHost(ent, st.env, 0.6);
      wx = p[0]; wy = p[1];
    }
    return cam.w2s(wx, wy);
  }, entId);
  await page.evaluate(() => { window.__IW.st.selection = new Set(); });
  await page.mouse.click(pos[0], pos[1], { button: "right" });
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => [...document.querySelectorAll('button[data-act]')].map((b) => b.getAttribute('data-act') + '|' + b.textContent.trim()));
}

const itemsHost = await menuOn(ids.host);   // 曲线 t=0.6 处（0.25 处已被线上点占据）
const hasInt = itemsHost.some((s) => s.includes("积分") && s.includes("隐函数不支持"));
const hasDeriv = itemsHost.some((s) => s.includes("导函数") && s.includes("隐函数不支持"));
console.log(`① 隐函数右键菜单（data-act|文字）：${JSON.stringify(itemsHost)}`);
if (!hasInt) bad.push("菜单没有「∫ 积分（隐函数不支持）」入口");
if (!hasDeriv) bad.push("菜单没有「ƒ′ 导函数曲线（隐函数不支持）」入口");

// ② 点积分项 → 明确理由 + 不创建实体
const clicked = await page.evaluate(async () => {
  const before = window.__IW.st.entities.size;
  const btns = [...document.querySelectorAll('button[data-act="mk:integral"]')];
  if (!btns.length) return { error: '找不到积分按钮' };
  btns[0].click();
  await new Promise((r) => setTimeout(r, 500));
  const st = window.__IW.st;
  return {
    hint: (document.getElementById('hint') || {}).textContent || '',
    hintOn: (document.getElementById('hint') || { className: '' }).className.includes('on'),
    integrals: [...st.entities.values()].filter((e) => e.type === 'integral').length,
    grew: st.entities.size - before,
  };
});
console.log(`② 点击积分项：hint="${clicked.hint}" | 提示可见=${clicked.hintOn} | 新建实体数=${clicked.grew} | integral 实体数=${clicked.integrals}`);
if (!String(clicked.hint).includes("隐函数不支持积分")) bad.push(`提示未说明原因（hint="${clicked.hint}"）`);
if (clicked.integrals !== 0) bad.push(`不应该创建 integral 实体，实测 ${clicked.integrals} 个`);

// ③ 线上点右键 → 应出现「在这一点作切线」（隐函数宿主已支持）
if (ids.point) {
  await page.evaluate((pid) => { window.__IW.st.selection = new Set([pid]); }, ids.point);
  const itemsPt = await menuOn(ids.point);
  const hasTg = itemsPt.some((s) => s.includes("mk:tangent"));
  console.log(`③ 线上点右键菜单（data-act|文字）：${JSON.stringify(itemsPt)}`);
  if (!hasTg) bad.push("隐函数的线上点没有「在这一点作切线」入口（引擎已支持，入口不该被挡）");
} else bad.push("没有创建出线上点");

if (errors.length) bad.push("运行时错误：" + errors.slice(0, 2).join(" | "));
if (bad.length) { console.log("❌ 未通过："); for (const b of bad) console.log("   - " + b); }
else console.log("✅ 隐函数的积分/导函数曲线已明确禁用并说明理由，且切线入口正常可见");
await browser.close();
process.exit(bad.length ? 1 : 0);
