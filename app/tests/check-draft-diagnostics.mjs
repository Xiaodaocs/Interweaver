// 验收：草稿读不出来时必须**看得见原因**（原来是静默空白，用户无从判断）
//   ① 坏 JSON ② 结构缺 text ③ 场景校验不通过 ④ 正常草稿不能误报
//
// 注意（脚本自身的隔离，踩过坑）：不能用同一个页面 goto 来注入坏草稿 ——
// 离开工作台时 beforeunload/pagehide 会**存一次好草稿**，把注入的坏数据覆盖掉，
// 于是永远测到"已恢复"。这里改成：在**新标签页**里先停到设置页（设置页不写草稿），
// 注入坏草稿，再导航到工作台。
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

const runCase = async (label, raw, expect) => {
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });   // 设置页不写草稿
  await p.evaluate((r) => { if (r === null) localStorage.removeItem('interweaver.draft.v1'); else localStorage.setItem('interweaver.draft.v1', r); }, raw);
  await p.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => !!window.__IW);
  await wait(800);
  const h = await p.evaluate(() => (document.getElementById('hint') || {}).textContent || '');
  const n = await p.evaluate(() => window.__IW.st.entities.size);
  await p.close();
  const okCase = expect ? h.includes(expect) : (n >= 1 && !h.includes('⚠'));
  console.log(`  ${label}: 实体=${n} 提示=${JSON.stringify(h)}  ${okCase ? '✓' : '✗'}`);
  if (!okCase) bad.push(`${label}：期望提示含「${expect || '已恢复且不误报'}」，实测 ${JSON.stringify(h)}`);
  if (errs.length) bad.push(`${label}：运行时错误 ${errs.slice(0, 1).join('')}`);
};

await runCase('坏 JSON', 'not-json-at-all', 'JSON');
await runCase('结构缺 text', JSON.stringify({ name: 'x' }), '结构不对');
await runCase('场景校验不通过', JSON.stringify({ name: 'x', text: '{"kind":"wrong","v":1}' }), '校验');

// ④ 正常草稿：先在没有工作台的页面上放一个**合法**草稿，再进工作台
const legit = await (async () => {
  const p = await browser.newPage();
  await p.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.removeItem('interweaver.draft.v1'));
  await p.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => !!window.__IW);
  await p.evaluate(() => {
    const S = window.__IW.S, st = window.__IW.st;
    S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
    S.ensureEvaluated(st);
  });
  await wait(4600);                       // 等自动保存写出合法草稿
  const raw = await p.evaluate(() => localStorage.getItem('interweaver.draft.v1'));
  await p.close();
  return raw;
})();
console.log(`  （合法草稿 ${legit ? legit.length : 0} 字节）`);
await runCase('正常草稿', legit, null);

if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); await browser.close(); process.exit(1); }
await browser.close();
console.log('✅ 通过：草稿读不出来时会给出可读原因；正常草稿仍能恢复且不误报');
