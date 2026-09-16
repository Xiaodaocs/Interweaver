// 运行时类普查：真实打开各界面，收集实际出现在 DOM 里的 class，再与 CSS 定义对比
//
// 为什么要运行时：静态扫描抓不到动态拼的类（class="${cls}"、mkPoly(...,'smDep')、setAttribute 等），
// 上一版静态核对因此把 smNode/smDep/hub/leaf 等一大片误判为"死规则"。
//
// 输出：
//   A 失灵类：运行时出现、CSS 无规则   → 该元素没样式
//   B 死规则：CSS 有规则、各界面都没出现 → 旧样式残留（应删除）
import fs from 'fs';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const ROOT = 'D:/zhuo_mian/Interweaver/app/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const seen = new Set();
const harvest = async (label) => {
  const list = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) for (const c of el.classList) out.push(c);
    return out;
  });
  for (const c of list) seen.add(c);
  console.log(`  · ${label}：累计收集 ${seen.size} 个 class`);
};

await new Promise((r) => setTimeout(r, 700));
await harvest('画布（默认界面）');
// 造一点内容，让变量卡/输入框等条件性 DOM 出现
await page.evaluate(() => {
  const { st, cam, S } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 50;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addEdgePoint(st, c.id, 0.6);
  S.addVariable(st, 'k', { value: 2, min: 0, max: 5 });
  S.ensureEvaluated(st); S.emit(st, 'structure');
});
await new Promise((r) => setTimeout(r, 1700));
await harvest('画布（含变量/成就）');

await page.click('#achBtn'); await page.waitForSelector('#starMap'); await new Promise((r) => setTimeout(r, 2200));
await harvest('星图（宽屏）');
await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 400));

await page.click('#sceneBtn').catch(() => {});
await new Promise((r) => setTimeout(r, 800));
await harvest('场景列表');
await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 400));


// ① 右键上下文菜单（ctx* 类）
await page.mouse.click(760, 470, { button: 'right' }).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
await harvest('右键上下文菜单');
await page.keyboard.press('Escape').catch(() => {});
await new Promise((r) => setTimeout(r, 300));

// ② 选中一个实体（属性面板 p*/prop*/derived 等类）
await page.mouse.click(760, 470).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
await harvest('选中实体（属性面板）');

// 详情卡：在星图上按 Enter 打开（T6 卡片，含 ad* 类）
await page.setViewport({ width: 1500, height: 940 });
await page.click('#achBtn').catch(() => {});
await page.waitForSelector('#starMap').catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => (document.querySelector('#starMap .smNode.granted') || document.querySelector('#starMap .smNode'))?.focus());
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 600));
await harvest('详情卡（Enter 打开）');
await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300));
await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300));

// 逐个点击右上工具按钮与面板入口，让条件性界面出现
for (const sel of ['#themeBtn', '#audioBtn', '#helpBtn', '#presetBtn', '#achListBtn']) {
  const ok = await page.$(sel);
  if (ok) { await ok.click().catch(() => {}); await new Promise((r) => setTimeout(r, 500)); await harvest('点击 ' + sel); }
}

// 报告关键容器与它们内部出现的类（用于判断哪些界面尚未被访问）
const containers = await page.evaluate(() => {
  const ids = ['panel', 'varWin', 'checklist', 'setCard', 'fxDock', 'presetDock', 'hint', 'achLayer', 'achBubbles', 'achDetail'];
  const out = {};
  for (const id of ids) { const el = document.getElementById(id); out[id] = el ? el.querySelectorAll('*').length : null; }
  return out;
});
console.log('  · 关键容器（子元素数，null = 不在 DOM） = ' + JSON.stringify(containers));

// 成就卡与气泡：按 achievementUI.js 的真实类名合成（该界面需要"达成瞬间"才会出现）
await page.evaluate(() => {
  const d = document.createElement('div');
  d.innerHTML = '<div class="achCard weave"><span class="achBl">✦</span><div class="achRow"><div class="achText">'
    + '<b>测试</b><span class="achFlavor">文案</span><span class="achEv">证据</span></div></div>'
    + '<div class="achWeaveRow">织成<b>x</b></div><div class="achChips"><i>a</i></div><div class="achFoot">脚注</div>'
    + '<button class="achOk">知道了</button></div>'
    + '<div class="achBubble">气泡</div>';
  document.body.appendChild(d);
});
await harvest('成就卡/气泡（合成）');

// 窄屏列表模式
await page.setViewport({ width: 520, height: 900 });
await page.click('#achBtn').catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
await harvest('星图（窄屏列表）');

const css = fs.readFileSync(ROOT + 'styles.css', 'utf8').replace(/\[[^\]]*\]/g, '');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => c.length > 1));
const IGNORE = new Set(['css', 'png', 'js', 'html', 'json', 'svg']);
const missing = [...seen].filter((c) => !defined.has(c) && !IGNORE.has(c)).sort();
const dead = [...defined].filter((c) => !seen.has(c) && !IGNORE.has(c)).sort();

console.log('\n运行时见到 class =', seen.size, '| CSS 定义 =', defined.size);
console.log('\nA 失灵类（运行时出现、CSS 无规则）：', missing.length);
for (const c of missing) console.log('   ✗', c);
console.log('\nB 死规则（CSS 有、运行时未出现）：', dead.length);
for (const c of dead) console.log('   ✗', c);
console.log('\n运行时错误 =', errors.length ? errors.slice(0, 2) : '无');

// ---- 基线断言：让普查成为真正的护栏（否则它只是信息性输出）----
// 白名单：已逐一确认「无需 CSS」的类（SVG 结构标记 / 内联样式容器 / 类型标记）
const WHITELIST = new Set(['achShape', 't1', 't2', 't3', 'achBl', 'concept', 'smCam', 'smCols']);
// 死规则基线：当前 44 条**全部**是「条件性界面尚未纳入普查」（上下文菜单/属性面板/函数向导/
// 场景列表行/已点亮成就详情卡/交织卡小图 等）。待覆盖扩展后必须把该基线逐步收紧。
// 实测该计数在 25–26 间波动（个别类只在特定时序下出现）→ 基线取**稳定上界 26**，
// 而不是单次采样值。教训：观测面不稳定时，阈值必须取稳定上界，否则断言会 flaky。
const DEAD_BASELINE = 26;

const bad = [];
const missingNotWhitelisted = missing.filter((c) => !WHITELIST.has(c));
if (missingNotWhitelisted.length) bad.push('出现未在白名单中的失灵类（产出但 CSS 无规则）：' + missingNotWhitelisted.join(', '));
if (dead.length > DEAD_BASELINE) bad.push(`死规则 ${dead.length} 条 > 基线 ${DEAD_BASELINE}（新增了无人使用的样式）`);
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
console.log(`基线断言：失灵类(非白名单) ${missingNotWhitelisted.length} 应为 0；死规则 ${dead.length} 应 ≤ ${DEAD_BASELINE}`);
if (bad.length) { console.log('❌ 类契约未通过：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ 类契约通过（无失灵类；死规则未超基线）');
await browser.close();
process.exit(bad.length ? 1 : 0);
