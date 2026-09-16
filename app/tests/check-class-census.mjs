// 运行时类普查（精简版）：快（<90s）+ 稳，可直接进 npm run verify
//
// 设计取舍（前面的教训换来的）：
//   · 静态扫描抓不到动态拼的类（class="${cls}" / mkPoly(...,'smDep') / setAttribute）→ 必须运行时普查
//   · 普查必须覆盖到界面，否则"死规则"全是假阳性 → 保留高收益界面
//   · 巡检类工具必须**快**，否则进不了回归 → 去掉"盲点式点几十个按钮"的低收益步骤
//   · 阈值必须取**稳定上界**（该计数曾在 25–26 间波动）→ 基线 26
//   · 崩溃必须打印 message（此前只留栈帧，白花两轮）→ 顶层崩溃保护
process.on('uncaughtException', (e) => { console.log('普查崩溃(uncaught)：' + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('普查崩溃(rejection)：' + (e && e.message ? e.message : String(e))); process.exit(1); });

import fs from 'fs';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const ROOT = 'D:/zhuo_mian/Interweaver/app/';
const WHITELIST = new Set(['achShape', 't1', 't2', 't3', 'achBl', 'concept', 'smCam', 'smCols']);
const DEAD_BASELINE = 23;                    // 稳定上界（连续 3 次实测 22–23；取上界，避免 flaky）

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--window-size=1500,940', '--no-sandbox'] });
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
  console.log(`  · ${label}：累计 ${seen.size} 类`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(400);
await harvest('画布');
await page.evaluate(() => {
  const { st, cam, S } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear(); st.probes.clear();
  cam.x = 0; cam.y = 0; cam.z = 50;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addEdgePoint(st, c.id, 0.6);
  S.addVariable(st, 'k', { value: 2, min: 0, max: 5 });
  S.ensureEvaluated(st); S.emit(st, 'structure');
});
await wait(1400);
await harvest('画布(含变量/成就)');

// ①-d 属性面板的绑定态（pbound/punbind/pname/pval/pv/alias…）：程序化选中**被绑定**的实体
//      （比盲点式点击可靠：直接改 selection 再 emit 一次重绘）
await page.evaluate(() => {
  const { st, S } = window.__IW;
  const bound = [...st.bindings.values()].map((b) => b.target && b.target.ent).filter(Boolean);
  if (bound.length) { st.selection.clear(); st.selection.add(bound[0]); }
  else if (st.entities.size) { st.selection.clear(); st.selection.add([...st.entities.keys()][0]); }
  S.ensureEvaluated(st); S.emit(st, 'structure');
});
await wait(500);
await harvest('选中被绑定实体（属性面板）');

// ①-f 关联向导 / 约束配置向导：在选中实体后，盲点 #panelBody 里的按钮把它打开
//      （源码依据：panel.js 把向导渲染进 #panelBody，产出 wizTitle/wizSub/wizTabs/wizParam/wizVarBtn/wizCancel）
for (let i = 0; i < 4; i++) {
  const ok = await page.evaluate((idx) => {
    const body = document.getElementById('panelBody');
    const btns = body ? [...body.querySelectorAll('button')] : [];
    if (btns[idx]) { btns[idx].click(); return true; }
    return false;
  }, i);
  if (!ok) break;
  await wait(350);
  await harvest('panelBody 第 ' + (i + 1) + ' 个按钮（可能进入向导）');
}
// 向导内再点一次（第二步：选来源），确保 wizVarBtn / fxInput / addBtn 等出现
for (let i = 0; i < 3; i++) {
  const ok = await page.evaluate((idx) => {
    const body = document.getElementById('panelBody');
    const btns = body ? [...body.querySelectorAll('button')] : [];
    const b2 = btns.filter((b) => /wizVarBtn|wizParam|wizTabs|完成|关联|加水平|垂直/.test(b.className + b.textContent))[idx];
    if (b2) { b2.click(); return true; }
    return false;
  }, i);
  if (!ok) break;
  await wait(350);
  await harvest('向导内第 ' + (i + 1) + ' 次点击');
}

// ①-e2 预设坞与面板标签：各点前 4 个按钮（函数创作向导 wiz* 通常从这些入口打开）
for (const cid of ['presetDock', 'panelTabs']) {
  for (let i = 0; i < 4; i++) {
    const ok = await page.evaluate(([id, idx]) => {
      const el = document.getElementById(id);
      const btns = el ? [...el.querySelectorAll('button')] : [];
      if (btns[idx]) { btns[idx].click(); return true; }
      return false;
    }, [cid, i]);
    if (!ok) break;
    await wait(300);
    await harvest('#' + cid + ' 第 ' + (i + 1) + ' 个按钮');
    await page.keyboard.press('Escape'); await wait(180);
  }
}

// ①-e 函数坞前 3 个按钮（限定次数以保持普查快：总时长目标 < 90s）
for (let i = 0; i < 3; i++) {
  const ok = await page.evaluate((idx) => {
    const el = document.getElementById('fxDock');
    const btns = el ? [...el.querySelectorAll('button')] : [];
    if (btns[idx]) { btns[idx].click(); return true; }
    return false;
  }, i);
  if (!ok) break;
  await wait(350);
  await harvest('函数坞第 ' + (i + 1) + ' 个按钮');
  await page.keyboard.press('Escape'); await wait(200);
}

await page.click('#achBtn');
await page.waitForSelector('#starMap');
await wait(1200);
await harvest('星图(宽屏)');
await page.evaluate(() => (document.querySelector('#starMap .smNode.granted') || document.querySelector('#starMap .smNode'))?.focus());
await page.keyboard.press('Enter');
await wait(400);
await harvest('详情卡(已点亮)');
await page.keyboard.press('Escape'); await wait(250);
await page.keyboard.press('Escape'); await wait(250);

await page.mouse.click(760, 470, { button: 'right' });
await wait(350);
await harvest('右键菜单');
await page.keyboard.press('Escape');
await wait(200);

await page.click('#sceneBtn');
await wait(600);
await harvest('场景列表');
await page.keyboard.press('Escape');
await wait(250);

await page.evaluate(() => {
  const d = document.createElement('div');
  d.innerHTML = '<div class="achCard weave"><div class="achText"><b>t</b><span class="achFlavor">f</span>'
    + '<span class="achEv">e</span></div><div class="achWeaveRow">w<b>x</b></div><div class="achChips"><i>a</i></div>'
    + '<div class="achFoot">脚</div><button class="achOk">知道了</button><span class="achMini"></span></div>'
    + '<div class="achBubble">b</div>';
  document.body.appendChild(d);
});
await harvest('成就卡/气泡(合成)');

await page.setViewport({ width: 520, height: 900 });
await page.click('#achBtn');
await wait(900);
await harvest('星图(窄屏列表)');

// 先剥掉注释再提取类名：注释里提到的旧类名（说明文字里的 .cl-item）会被误当成死规则 —— 实测踩过
const cssRaw = fs.readFileSync(ROOT + 'styles.css', 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[[^\]]*\]/g, '');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
  .filter((c) => c.length > 1 && !['css', 'png', 'js', 'html', 'json', 'svg'].includes(c)));
const missing = [...seen].filter((c) => !defined.has(c)).sort();
const dead = [...defined].filter((c) => !seen.has(c)).sort();
const missingNotWhitelisted = missing.filter((c) => !WHITELIST.has(c));

const UNCOVERED = ['slRow', 'slName', 'slDel', 'wizTabs', 'wizTitle', 'wizSub', 'wizParam', 'wizCancel', 'wizVarBtn',
  'done', 'switch', 'pbound', 'punbind', 'pname', 'pval', 'pv', 'probeCard', 'propHead', 'propRel', 'propRow',
  'ctxArrow', 'ctxGroup', 'ctxSub', 'ctxSubBtn', 'winMin', 'alias', 'aliasTag', 'lit', 'pending', 'danger',
  'actBtn', 'smRel2', 'pan', 'panning',
  'adHint', 'adHintText', 'out'];   // 未点亮卡与瞬态类

console.log(`\n运行时见到 ${seen.size} 类 | CSS 定义 ${defined.size} 类`);
console.log('A 失灵类(非白名单) =', missingNotWhitelisted.length, missingNotWhitelisted.join(', ') || '（无）');
const inUncovered = dead.filter((c) => UNCOVERED.includes(c));
const unexpected = dead.filter((c) => !UNCOVERED.includes(c));
console.log(`B 死规则 = ${dead.length}（基线 ${DEAD_BASELINE}）：其中条件性界面未覆盖 ${inUncovered.length} 条；其余 ${unexpected.length} 条 →`, unexpected.join(', ') || '（无）');

const bad = [];
if (missingNotWhitelisted.length) bad.push('未在白名单中的失灵类：' + missingNotWhitelisted.join(', '));
if (dead.length > DEAD_BASELINE) bad.push(`死规则 ${dead.length} > 基线 ${DEAD_BASELINE}`);
if (unexpected.length) bad.push(`出现非"条件性界面"的死规则（可能又写进旧样式）：${unexpected.join(', ')}`);
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
if (bad.length) { console.log('❌ 类契约未通过：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ 类契约通过（无未授权失灵类；死规则全部属"条件性界面未覆盖"且未超基线）');
await browser.close();
process.exit(bad.length ? 1 : 0);
