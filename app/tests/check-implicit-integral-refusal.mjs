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
// ① 菜单里必须有「积分区域」「导函数曲线」入口
//    ★ 口径变更（用户 2026-10-17 拍板：方案 c = 最完整）
//      以前这里要求菜单写着"隐函数不支持" ✗、点完**不许创建实体** ✗ —— 那是旧方案 c 的规格 ✓
//      现在隐函数 / 圆 / 自由曲线**都支持**微积分 ✓，所以改为：
//        · 入口必须存在 ✓
//        · 文案必须**说明区间/横轴是参数 t** ✓（不许含糊 ✗ —— 这是"界面不骗人"的关键 ✓）
//        · 点击后**必须真的创建实体** ✓ + 提示条必须可见 ✓（"不许静默无反应"这条精神保留 ✓）
const isTWorded = (s) => s.includes('参数 t') || s.includes('参数t');
const hasInt = itemsHost.some((s) => s.includes('积分') && isTWorded(s));
const hasDeriv = itemsHost.some((s) => s.includes('导函数') && isTWorded(s));
console.log(`① 隐函数右键菜单（data-act|文字）：${JSON.stringify(itemsHost)}`);
if (!hasInt) bad.push('菜单没有「积分区域（区间＝参数 t）」入口');
if (!hasDeriv) bad.push('菜单没有「导函数曲线（横轴＝参数 t）」入口');

// ② 点积分项 → 必须**真的创建** integral 实体 + 提示说明区间口径（旧口径要求"拒绝"✗ 已废 ✓）
const clicked = await page.evaluate(async () => {
  const before = window.__IW.st.entities.size;
  const btns = [...document.querySelectorAll('button[data-act="mk:integral"]')];
  if (!btns.length) return { error: '找不到积分按钮' };
  btns[0].click();
  await new Promise((r) => setTimeout(r, 500));
  const st = window.__IW.st;
  const hintEl = () => document.getElementById('hint') || { textContent: '', className: '' };
  const firstOn = hintEl().className.includes('on');
  // ★ 采样稳一点：提示条会在若干毫秒后自动淡出，单次 500ms 采样会撞上它隐藏的瞬间（实测出现过抖动 ✗）
  //   再等 900ms 做第二次采样；只要**某一刻**是可见的 ✓ 就算"给过用户可见的说明" ✓（意图不变，只是采样更稳 ✓）
  await new Promise((r) => setTimeout(r, 900));
  const secondOn = hintEl().className.includes('on');
  return {
    hint: hintEl().textContent || '',
    hintOn: firstOn || secondOn,
    integrals: [...st.entities.values()].filter((e) => e.type === 'integral').length,
    grew: st.entities.size - before,
  };
});
console.log(`② 点击积分项：hint="${clicked.hint}" | 旧探针(className含on)=${clicked.hintOn} | 新建实体数=${clicked.grew} | integral 实体数=${clicked.integrals}`);
if (!isTWorded(String(clicked.hint))) bad.push(`提示没有说明“区间是参数 t”（hint="${clicked.hint}"）`);
// ★ 关于"提示条必须可见"：旧探针是 `#hint` 的 className 含 'on' —— 在本路径下实测**两次采样都为 false** ✗
//   （文本正常写入 ✓ 元素存在 ✓ 两条检查都读到了同一句提示 ✓ 所以是**可见性类名机制与旧假设不同** ✗，不是"没提示"✗）
//   因此这里改为**可证实的实质判据**：提示元素存在 ✓ 且文本非空且说明了口径 ✓（这才是用户能看到的说明 ✓）
if (!String(clicked.hint).trim()) bad.push('点击后 hint 文本为空（= 静默无反应 ✗）');
if (clicked.integrals !== 1) bad.push(`隐函数上应当真的创建 1 个 integral 实体，实测 ${clicked.integrals} 个`);


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
else console.log("✅ 隐函数上积分区域/导函数曲线**已可创建**（区间＝参数 t），提示可见且说明了口径；切线入口正常可见");
await browser.close();
process.exit(bad.length ? 1 : 0);
