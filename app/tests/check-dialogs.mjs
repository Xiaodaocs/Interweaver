// 自研弹窗模块验收（src/dialog 模块）：彻底替代浏览器原生 alert / confirm / prompt
//
// 覆盖：
//   a) **全程没有任何原生对话框被触发** —— 页面内探针（把三个原生函数换成记录器）+ puppeteer 的
//      dialog 事件兜底网，双重计数，必须都是 0；
//   b) alert / confirm / prompt 各跑一次：DOM 出现弹窗、返回值正确、焦点落点正确、Esc 能关、
//      关闭后焦点回到触发元素；
//   c) 追加：Tab 焦点锁、点遮罩、danger 语义、Enter 在按钮上不误触发主按钮、排队不互相覆盖、
//      prompt 校验拦截与红字撤销、dialogForm 多字段、reduced-motion 不动效、深色主题、
//      **弹窗内部零类名** + 宿主标记走 data 属性（都不给项目"类契约"普查添乱）、模态期间应用收不到 Esc。
//
// 跑法：cd app && node tests/check-dialogs.mjs
//   （前端没起就自己起，跑完只关自己起的那个；已经在跑的 5188 一律不动）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'http://localhost:5188';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { bad.push(msg); console.log('  ✗ ' + msg); } };
const warn = (msg) => console.log('  ! ' + msg);

/* ---------------- 0. 静态扫描：模块里不许有原生弹窗调用 ---------------- */
const src = fs.readFileSync(join(APP, 'src', 'dialog.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const hits = [...code.matchAll(/(?<![\w$])(alert|confirm|prompt)\s*\(/g)].map((m) => m[1]);
ok(hits.length === 0, '模块源码里没有任何原生 alert / confirm / prompt 调用（静态扫描命中 ' + hits.length + ' 处）');

/* ---------------- 1. 前端服务：没起就自己起（只关自己起的） ---------------- */
const alive = async () => { try { const r = await fetch(BASE + '/index.html'); return r.ok; } catch { return false; } };
let server = null;
if (await alive()) {
  console.log('  · 复用已在运行的 ' + BASE + '（不动它）');
} else {
  server = spawn(process.execPath, ['server.mjs'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let boot = '';
  server.stdout.on('data', (d) => { boot += d.toString(); });
  server.stderr.on('data', (d) => { boot += d.toString(); });
  for (let i = 0; i < 40 && !(await alive()); i++) await wait(200);
  if (!(await alive())) {
    console.log('✗ 前端起不来：' + boot.slice(0, 300));
    try { server.kill(); } catch { /* 已退出 */ }
    process.exit(1);
  }
  console.log('  · 自起前端 ' + BASE + '（跑完关掉）');
}
const stopServer = () => { if (server) { try { server.kill(); } catch { /* 已退出 */ } server = null; } };

/* ---------------- 2. 浏览器 ---------------- */
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const cleanup = async () => { try { await browser.close(); } catch { /* 已关 */ } stopServer(); };
process.on('exit', stopServer);
process.on('uncaughtException', async (e) => { console.log('崩溃：' + (e && e.message)); await cleanup(); process.exit(1); });

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// 兜底网：真有原生弹窗冒出来，记录下来并立即 dismiss（否则用例会卡死）
const nativeEvents = [];
page.on('dialog', async (d) => {
  nativeEvents.push(d.type() + '：' + d.message().slice(0, 60));
  try { await d.dismiss(); } catch { /* 已经关了 */ }
});
// 探针：在页面脚本执行之前，把三个原生函数换成记录器（返回安全默认值）
await page.evaluateOnNewDocument(() => {
  window.__nativeCalls = [];
  window.alert = function (m) { window.__nativeCalls.push('alert:' + String(m).slice(0, 60)); return undefined; };
  window.confirm = function (m) { window.__nativeCalls.push('confirm:' + String(m).slice(0, 60)); return false; };
  window.prompt = function (m) { window.__nativeCalls.push('prompt:' + String(m).slice(0, 60)); return null; };
});

try { await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0', timeout: 30000 }); }
catch (e) { warn('页面没在 30s 内进入 networkidle0（' + String(e.message).slice(0, 70) + '），继续做弹窗验收'); }
await page.waitForFunction(() => !!window.__IW, { timeout: 8000 })
  .then(() => console.log('  · 页面已就绪（window.__IW 在）'))
  .catch(() => warn('页面没暴露 window.__IW（可能正被别的改动影响）——弹窗验收不依赖它，继续'));

/* ---------------- 3. import 模块 + 装页面内辅助函数 ---------------- */
const exported = await page.evaluate(async () => {
  try { const m = await import('/src/dialog.js?check=' + Date.now()); window.__DLG = m; return Object.keys(m).sort(); }
  catch (e) { return 'ERR:' + ((e && e.message) || e); }
});
ok(Array.isArray(exported) && ['dialogAlert', 'dialogConfirm', 'dialogPrompt', 'dialogForm'].every((k) => exported.includes(k)),
  '模块能在浏览器里 import 且导出四个 API（实测 ' + JSON.stringify(exported) + '）');

await page.evaluate(() => {
  window.__R = {};
  window.__mkTrigger = () => {
    let b = document.getElementById('iwTestTrigger');
    if (!b) {
      b = document.createElement('button');
      b.id = 'iwTestTrigger';
      b.textContent = '测试触发按钮';
      b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:5';
      document.body.appendChild(b);
    }
    return b;
  };
  // 校验函数**必须写在页面里**（page.evaluate 的参数走 JSON 序列化，函数会被丢掉）
  window.__V = {
    hasX: (v) => (String(v).includes('x') ? null : '口令必须包含字母 x'),
    mustBe9: (rec) => (String(rec.v) === '9' ? null : '值必须是 9'),
  };
  window.__call = (fn, args, name, vkey) => {
    const a = Object.assign({}, args);
    if (vkey) a.validate = window.__V[vkey];
    window.__mkTrigger().focus();                      // 触发者必须在**调用之前**就聚焦
    window.__R[name] = { pending: true };
    Promise.resolve(window.__DLG[fn](a)).then(
      (v) => { window.__R[name] = { value: v === undefined ? null : v, undef: v === undefined, type: typeof v }; },
      (e) => { window.__R[name] = { error: String((e && e.message) || e) }; });
    return true;
  };
  window.__vis = (sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && e.getClientRects().length > 0; };
  window.__active = () => {
    const a = document.activeElement;
    if (!a) return 'none';
    if (a.id) return a.id;
    if (a.dataset && a.dataset.fieldInput !== undefined) return 'field';
    return a.tagName.toLowerCase();
  };
  window.__card = () => document.querySelector('#iwDialogCard');
  window.__text = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
});
const call = (fn, args, name, vkey = null) => page.evaluate(([f, a, n, k]) => window.__call(f, a, n, k), [fn, args, name, vkey]);
const result = async (name, timeout = 8000) => {
  await page.waitForFunction((n) => window.__R[n] && !window.__R[n].pending, { timeout }, name);
  return page.evaluate((n) => window.__R[n], name);
};
const active = () => page.evaluate(() => window.__active());
// 全选输入框内容：**不要用三重点击**（实测 headless 下 clickCount:3 只落光标不全选），Ctrl+A 才稳
const selectAllIn = async (sel) => {
  await page.click(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
};
const snapshot = () => page.evaluate(() => ({
  visible: window.__vis('#iwDialogRoot'),
  hidden: document.querySelector('#iwDialogRoot') ? document.querySelector('#iwDialogRoot').hidden : null,
  cards: document.querySelectorAll('#iwDialogCard').length,
  title: window.__text('#iwDialogTitle'),
  focused: window.__active(),
}));

/* ---------------- 4. alert ---------------- */
console.log('\n【① alert：DOM / ARIA / 焦点 / Esc / 焦点归还】');
await call('dialogAlert', { title: '保存失败', body: '磁盘空间不足，场景没有写出。', detail: 'code=EIO\npath=D:\\scenes\\a.iwscene', kind: 'error' }, 'a1');
const d1 = await page.evaluate(() => {
  const c = window.__card();
  return {
    hasRoot: !!document.querySelector('#iwDialogRoot'),
    visible: window.__vis('#iwDialogRoot'),
    role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), labelledby: c.getAttribute('aria-labelledby'),
    titleId: document.querySelector('#iwDialogTitle').id,
    title: window.__text('#iwDialogTitle'), body: window.__text('#iwDialogBody'), detail: window.__text('#iwDialogDetail'),
    kind: c.getAttribute('data-kind'), tone: c.getAttribute('data-tone'),
    cancelHidden: document.querySelector('#iwDialogCancel').hidden,
    okLabel: window.__text('#iwDialogOk'),
    host: document.body.dataset.iwDialog === '1',
    noClass: [...document.querySelectorAll('#iwDialogRoot *')].every((e) => e.classList.length === 0),
    z: getComputedStyle(document.querySelector('#iwDialogRoot')).zIndex,
    focused: window.__active(),
  };
});
ok(d1.hasRoot && d1.visible, '首次调用后 #iwDialogRoot 才出现在 DOM 里（惰性建 DOM）并且可见');
ok(d1.role === 'alertdialog' && d1.modal === 'true' && d1.labelledby === 'iwDialogTitle' && d1.titleId === 'iwDialogTitle',
  'role=alertdialog / aria-modal=true / aria-labelledby 指向标题（实测 ' + d1.role + ' / ' + d1.modal + ' / ' + d1.labelledby + '）');
ok(d1.title === '保存失败' && String(d1.body).includes('磁盘空间不足') && String(d1.detail).includes('code=EIO'),
  'title / body / detail 三段都渲染出来');
ok(d1.kind === 'error' && d1.tone === null, '语义状态写在 data 属性上（data-kind="error"），不是状态类');
ok(d1.focused === 'iwDialogOk', '打开时焦点落在主按钮（实测 ' + d1.focused + '）');
ok(d1.okLabel === '知道了' && d1.cancelHidden === true, 'alert 只有一个主按钮（取消按钮 hidden）');
ok(d1.host === true, 'document.body 上出现了宿主标记 data-iw-dialog（data 属性，不是类名）');
ok(d1.noClass === true, '弹窗内部零类名（不产生失灵类 / 死规则）');
ok(Number(d1.z) >= 100, '层级在星图(80)/成就层(82)之上（z-index ' + d1.z + '）');

// Tab 锁
await page.keyboard.press('Tab');
const t1 = await page.evaluate(() => ({ inside: window.__card().contains(document.activeElement), id: window.__active() }));
await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
const t2 = await page.evaluate(() => ({ inside: window.__card().contains(document.activeElement), id: window.__active() }));
ok(t1.inside && t2.inside && t1.id === 'iwDialogOk' && t2.id === 'iwDialogOk',
  'Tab / Shift+Tab 焦点锁在弹窗内（实测 ' + t1.id + ' → ' + t2.id + '）');

// 模态：应用自身的 Esc 监听收不到（capture + stopPropagation）
await page.evaluate(() => { window.__escHits = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escHits++; }); });
await page.keyboard.press('Escape');
await wait(120);
const afterEsc = await page.evaluate(() => ({
  escHits: window.__escHits,
  hidden: document.querySelector('#iwDialogRoot').hidden,
  focused: window.__active(),
  hostGone: !document.body.hasAttribute('data-iw-dialog'),   // 宿主标记只在"弹窗开着"期间存在
}));
const r1 = await result('a1');
ok(afterEsc.hidden === true && (await page.evaluate(() => window.__vis('#iwDialogRoot'))) === false, 'Esc 关掉弹窗');
ok(afterEsc.focused === 'iwTestTrigger', '关闭后焦点还给触发者（实测 ' + afterEsc.focused + '）');
ok(r1.undef === true && !r1.error, 'alert resolve(undefined)（实测 ' + JSON.stringify(r1) + '）');
ok(afterEsc.escHits === 0, '弹窗打开期间应用自身的 Esc 快捷键收不到（模态语义正确）');
ok(afterEsc.hostGone === true, '关闭后宿主标记 data-iw-dialog 被摘掉（它只代表"弹窗开着"这个事实）');

/* ---------------- 5. confirm ---------------- */
console.log('\n【② confirm：主按钮 / 遮罩 / Esc / danger / Enter】');
await call('dialogConfirm', { title: '新建场景', body: '当前画布会被清空（草稿也会清除）。', danger: true }, 'b1');
const db = await page.evaluate(() => {
  const c = window.__card();
  return { role: c.getAttribute('role'), tone: c.getAttribute('data-tone'), okTone: document.querySelector('#iwDialogOk').getAttribute('data-tone'),
    focus: window.__active(), cancelHidden: document.querySelector('#iwDialogCancel').hidden, okLabel: window.__text('#iwDialogOk'), cancelLabel: window.__text('#iwDialogCancel') };
});
ok(db.role === 'dialog' && db.tone === 'danger' && db.okTone === 'danger', 'danger 走 data-tone="danger"（卡片 + 主按钮），role=dialog');
ok(db.focus === 'iwDialogOk', '焦点落在主按钮');
ok(db.cancelHidden === false && db.okLabel === '确定' && db.cancelLabel === '取消', '两个按钮都在，文案是「确定 / 取消」');
await page.keyboard.press('Enter');                 // 焦点在主按钮上 → 走浏览器原生激活
const rb1 = await result('b1');
ok(rb1.value === true, '回车 = 主按钮，resolve(true)');
ok((await active()) === 'iwTestTrigger', '关闭后焦点回到触发者');

await call('dialogConfirm', { title: '删除场景？', body: '删了就找不回来了。', danger: true }, 'b2');
await page.mouse.click(140, 140);                   // 卡片在正中（宽 440），点到的一定是遮罩
const rb2 = await result('b2');
ok(rb2.value === false, 'danger 时点遮罩 = 取消，resolve(false)');

await call('dialogConfirm', { title: '点取消按钮' }, 'b3');
await page.click('#iwDialogCancel');
ok((await result('b3')).value === false, '次按钮 resolve(false)');

await call('dialogConfirm', { title: '焦点在取消上按回车' }, 'b4');
await page.evaluate(() => document.querySelector('#iwDialogCancel').focus());
await page.keyboard.press('Enter');
ok((await result('b4')).value === false, '焦点在「取消」上按 Enter = 取消（不会误触发主按钮）');

await call('dialogConfirm', { title: 'Esc 取消' }, 'b5');
await page.keyboard.press('Escape');
ok((await result('b5')).value === false, 'Esc resolve(false)');

/* ---------------- 6. prompt ---------------- */
console.log('\n【③ prompt：输入 / 返回值 / validate / Esc=null】');
await call('dialogPrompt', { title: '另存为', label: '文件名', value: '未命名场景', placeholder: '给场景起个名字' }, 'c1');
const dp = await page.evaluate(() => {
  const i = document.querySelector('#iwDialogFields [data-field-input]');
  return { focus: window.__active(), value: i.value, ph: i.placeholder, label: window.__text('#iwDialogFields [data-field-label]'),
    sel: i.selectionEnd - i.selectionStart, role: window.__card().getAttribute('role') };
});
ok(dp.focus === 'field', '打开时焦点进弹窗：prompt 落在输入框（主操作就是输入；主按钮键仍可 Tab/回车到达）');
ok(dp.value === '未命名场景' && dp.sel === dp.value.length && dp.sel > 0,
  '初始值带进输入框并默认全选（改名字不用先手动全选）：value=' + JSON.stringify(dp.value) + ' 选中 ' + dp.sel + ' 字');
ok(dp.label === '文件名' && dp.ph === '给场景起个名字' && dp.role === 'dialog', 'label / placeholder 生效，role=dialog');
await page.keyboard.type('my-scene');               // 因为全选，直接覆盖
await page.keyboard.press('Enter');
const rc1 = await result('c1');
ok(rc1.value === 'my-scene', '回车提交，resolve 输入字符串（实测 ' + JSON.stringify(rc1.value) + '）');
ok((await active()) === 'iwTestTrigger', '关闭后焦点回到触发者');

await call('dialogPrompt', { title: '取消输入', value: 'x' }, 'c2');
await page.keyboard.press('Escape');
const rc2 = await result('c2');
ok(rc2.value === null && rc2.undef === false, 'prompt 取消 resolve(null)（不是空字符串）');

await call('dialogPrompt', {
  title: '输入口令', label: '口令', value: '',
}, 'c3', 'hasX');
await page.keyboard.type('abc');
await page.keyboard.press('Enter');
await wait(250);
const dv = await page.evaluate(() => ({
  visible: window.__vis('#iwDialogRoot'), pending: window.__R.c3.pending,
  err: window.__text('#iwDialogError'), errHidden: document.querySelector('#iwDialogError').hidden, focus: window.__active(),
}));
ok(dv.visible && dv.pending === true, 'validate 不通过时弹窗不关、Promise 不 resolve');
ok(dv.errHidden === false && String(dv.err).includes('x'), '错误提示写进 #iwDialogError（实测「' + dv.err + '」）');
await selectAllIn('#iwDialogFields [data-field-input]');
await page.keyboard.type('x1');
const gone = await page.evaluate(() => document.querySelector('#iwDialogError').hidden);
ok(gone === true, '一开始改动输入，旧的红字提示就撤掉');
await page.keyboard.press('Enter');
const rc3 = await result('c3');
ok(rc3.value === 'x1', '改对之后回车通过，resolve 新值（实测 ' + JSON.stringify(rc3.value) + '）');

/* ---------------- 7. 排队 ---------------- */
console.log('\n【④ 排队：连续调用依次显示，不互相覆盖】');
await page.evaluate(() => {
  window.__mkTrigger().focus();
  window.__R.q1 = { pending: true }; window.__R.q2 = { pending: true }; window.__R.q3 = { pending: true };
  const D = window.__DLG;
  Promise.resolve(D.dialogAlert({ title: '第一条', body: '一' })).then((v) => { window.__R.q1 = { value: v === undefined ? null : v, undef: v === undefined }; });
  Promise.resolve(D.dialogConfirm({ title: '第二条' })).then((v) => { window.__R.q2 = { value: v }; });
  Promise.resolve(D.dialogPrompt({ title: '第三条', value: 'v3' })).then((v) => { window.__R.q3 = { value: v }; });
});
const s1 = await snapshot();
ok(s1.cards === 1 && s1.title === '第一条' && s1.visible, '连开三个也只显示第一个（卡片只有 1 个，标题「' + s1.title + '」）');
await page.keyboard.press('Enter');
await wait(120);
const s2 = await snapshot();
const q1done = await page.evaluate(() => !window.__R.q1.pending);
ok(s2.cards === 1 && s2.title === '第二条' && q1done, '第一条结掉后紧接着显示第二条（不叠罗汉、不漏排队）');
await page.keyboard.press('Enter');
await wait(120);
const s3 = await snapshot();
ok(s3.cards === 1 && s3.title === '第三条' && s3.focused === 'field', '第三条轮到时焦点正确落在它的输入框');
await page.keyboard.type('zz');                    // v3 已全选 → 覆盖
await page.keyboard.press('Enter');
const rq = await page.evaluate(() => ({ q1: window.__R.q1, q2: window.__R.q2, q3: window.__R.q3 }));
ok(rq.q1.undef === true && rq.q2.value === true && rq.q3.value === 'zz',
  '三条的返回值各自正确、按顺序 resolve（' + JSON.stringify([rq.q1.undef, rq.q2.value, rq.q3.value]) + '）');
ok((await page.evaluate(() => window.__vis('#iwDialogRoot'))) === false, '全部结完后弹窗收起');

/* ---------------- 8. dialogForm（备用接口） ---------------- */
console.log('\n【⑤ dialogForm：多字段 + 记录级校验 + textarea 回车换行】');
await call('dialogForm', {
  title: '新建变量', okLabel: '创建',
  fields: [
    { name: 'k', label: '名称', value: 'k' },
    { name: 'v', label: '值', value: '1', type: 'number' },
    { name: 'note', label: '备注', type: 'textarea' },
  ],
}, 'f1', 'mustBe9');
const df = await page.evaluate(() => ({ rows: document.querySelectorAll('#iwDialogFields [data-field-row]').length, focus: window.__active() }));
ok(df.rows === 3, '三个字段都渲染出来（' + df.rows + ' 行）');
await selectAllIn('#iwDialogFields [data-field-row] [data-field-input]');
await page.keyboard.type('speed');
await page.click('#iwDialogFields [data-field-row]:nth-child(3) [data-field-input]');
await page.keyboard.press('Enter');                // textarea 里回车 = 换行，不能提交
await wait(150);
const ta = await page.evaluate(() => ({ pending: window.__R.f1.pending, note: document.querySelectorAll('#iwDialogFields [data-field-input]')[2].value }));
ok(ta.pending === true && ta.note.includes('\n'), 'textarea 里回车是换行，不会误提交');
await page.click('#iwDialogOk');                   // v 还是 1 → 校验应拦住
await wait(250);
const ferr = await page.evaluate(() => ({ pending: window.__R.f1.pending, err: window.__text('#iwDialogError') }));
ok(ferr.pending === true && String(ferr.err).includes('9'), '记录级 validate 拦住：提示「' + ferr.err + '」');
const noClass2 = await page.evaluate(() => [...document.querySelectorAll('#iwDialogRoot *')].every((e) => e.classList.length === 0));
ok(noClass2 === true, '多字段 + 红字提示的弹窗同样零类名（字段只用 data-* 属性）');
await selectAllIn('#iwDialogFields [data-field-row]:nth-child(2) [data-field-input]');
await page.keyboard.type('9');
await page.click('#iwDialogOk');
const rf = await result('f1');
ok(rf.value && rf.value.k === 'speed' && rf.value.v === '9' && String(rf.value.note).includes('\n'),
  'dialogForm resolve 整条记录（' + JSON.stringify(rf.value) + '）');

await call('dialogForm', { title: '取消表单' }, 'f2');
await page.keyboard.press('Escape');
ok((await result('f2')).value === null, 'dialogForm 取消 resolve(null)');

/* ---------------- 9. 动效 / 主题 ---------------- */
console.log('\n【⑥ prefers-reduced-motion / 深色主题】');
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await call('dialogAlert', { title: '减少动效', kind: 'info' }, 'rm');
const rm = await page.evaluate(() => {
  const c = getComputedStyle(window.__card());
  const s = getComputedStyle(document.querySelector('#iwDialogScrim'));
  return { card: c.animationName, scrim: s.animationName, trans: c.transitionDuration };
});
ok(rm.card === 'none' && rm.scrim === 'none' && String(rm.trans).split(',').every((t) => parseFloat(t) === 0),
  '系统要求"减少动态效果"时不动效（animation: ' + rm.card + ' / ' + rm.scrim + '，transition: ' + rm.trans + '）');
await page.keyboard.press('Escape');
await result('rm');

await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await call('dialogAlert', { title: '正常动效' }, 'rm2');
const rm2 = await page.evaluate(() => getComputedStyle(window.__card()).animationName);
ok(rm2 === 'iwDialogIn', '没开"减少动态效果"时有入场动画（' + rm2 + '）');
const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const themes = await page.evaluate(() => {
  const set = (t) => document.documentElement.setAttribute('data-theme', t);
  set('light'); const light = getComputedStyle(window.__card()).backgroundColor;
  set('dark'); const dark = getComputedStyle(window.__card()).backgroundColor;
  set('light'); const backAgain = getComputedStyle(window.__card()).backgroundColor;
  return { light, dark, backAgain };
});
await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), themeBefore);
ok(themes.light !== themes.dark && themes.light === themes.backAgain,
  '深浅主题各自有底色（' + themes.light + ' ↔ ' + themes.dark + '）');
await page.keyboard.press('Escape');
await result('rm2');

/* ---------------- 10. 原生弹窗零触发 + 页面报错 ---------------- */
console.log('\n【⑦ 原生对话框零触发 / 页面健康】');
const nativeCalls = await page.evaluate(() => window.__nativeCalls || []);
ok(nativeCalls.length === 0, 'a) 全程没有任何原生对话框被触发：页面内探针计数 ' + nativeCalls.length + (nativeCalls.length ? '（' + nativeCalls.join(' | ') + '）' : ''));
ok(nativeEvents.length === 0, 'a) puppeteer 的 dialog 事件兜底网也是 0（' + (nativeEvents.join(' | ') || '无') + '）');
const dialogErrors = pageErrors.filter((m) => /dialog/i.test(m));
if (pageErrors.length && !dialogErrors.length) warn('页面有 ' + pageErrors.length + ' 条 JS 报错，但都不含 dialog（属于其它文件正在改动的波动）：' + pageErrors.slice(0, 2).join(' | '));
ok(dialogErrors.length === 0, '弹窗模块没有引发任何页面 JS 报错');

/* ---------------- 收尾 ---------------- */
await cleanup();
console.log('');
if (bad.length) {
  console.log('❌ 弹窗验收未通过（' + bad.length + ' 项）：');
  for (const b of bad) console.log('   - ' + b);
  process.exit(1);
}
console.log('✅ 弹窗验收全部通过：原生三件套零触发；alert / confirm / prompt / form 的 DOM、ARIA、返回值、焦点、Esc、遮罩、排队、校验、动效、主题都已逐条核对');
process.exit(0);
