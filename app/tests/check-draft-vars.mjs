// 验收（用户报告）：草稿恢复后**变量必须回来**（变量窗口要有内容，且绑定仍然生效）
//   ① 建圆 + 变量 k + 绑定 r←k → 等自动保存
//   ② 切到设置页再回来（用户路径）
//   ③ 变量窗口应显示 k；圆的 r 生效值应等于 k
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });   // 在设置页（不写草稿）里清
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  cam.x = 0; cam.y = 0; cam.z = 40;
  const C = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addVariable(st, 'k', { value: 3, min: 0, max: 9 });
  S.addBinding(st, C.id, 'r', 'k');
  S.ensureEvaluated(st, { solve: true });
  S.emit(st, 'structure');
  window.__IW.renderOnce();
});
await wait(4600);   // 等一次自动保存

const before = await page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  const C = [...st.entities.values()].find((e) => e.type === 'circle');
  return { vars: [...st.variables.keys()], r: st.values.get(C.id + ':r'),
    winHidden: document.getElementById('varWin').hidden,
    winText: (document.getElementById('varWinBody') || {}).textContent || '' };
});
console.log(`编辑后：变量=${JSON.stringify(before.vars)} r生效=${before.r} 变量窗隐藏=${before.winHidden} 窗内文本=${JSON.stringify(before.winText.slice(0, 40))}`);

// 走用户路径：设置页 → 回来
await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await wait(600);
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await wait(1200);

const after = await page.evaluate(() => {
  const st = window.__IW.st, S = window.__IW.S;
  const C = [...st.entities.values()].find((e) => e.type === 'circle');
  // 变量行是 <input>：textContent 永远读不到名字 → 读输入框的值（上一版断言就错在这里）
  const inputs = [...document.querySelectorAll('#varWinBody input')].map((el) => el.value).filter(Boolean);
  return { n: st.entities.size, vars: [...st.variables.keys()], r: C ? st.values.get(C.id + ':r') : null,
    winHidden: document.getElementById('varWin').hidden,
    inputs,
    hint: (document.getElementById('hint') || {}).textContent || '' };
});
console.log(`回来后：实体=${after.n} 变量=${JSON.stringify(after.vars)} r生效=${after.r} 变量窗隐藏=${after.winHidden}`);
console.log(`        变量输入框里的值=${JSON.stringify(after.inputs)}`);
console.log(`        提示=${JSON.stringify(after.hint)}`);

if (!(after.n >= 1)) bad.push('图形没恢复');
if (!after.vars.includes('k')) bad.push('变量 k 没恢复');
if (!(Math.abs(after.r - 3) < 1e-9)) bad.push(`绑定 r←k 没恢复（r=${after.r}，应 3）`);
if (after.winHidden) bad.push('变量窗口仍然是隐藏的（用户看不到变量）');
if (!after.inputs.includes('k')) bad.push('变量窗口里没有变量 k');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：草稿恢复后变量与绑定都在，变量窗口也显示出来');
