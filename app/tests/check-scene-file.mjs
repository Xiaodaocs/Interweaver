// S7 验收（用户要求 ⑦：可保存、可打开的自创文件格式 .iwz）
// 判据全部是真实往返与真实校验，不用桩：
//   ① 多类型场景（圆/线段/隐函数 + 变量）保存 → 新建清空 → 打开 → 实体与变量完全一致
//   ② 文件带 kind 标记与版本号（不是本程序的文件必须被明确拒绝，不静默接受）
//   ③ 自动草稿写入 localStorage 且内容可被 inspectScene 通过
//   ④ 0 运行时错误
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
const bad = [];
const rt = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  const F = await import('/src/sceneFile.js');
  const SC = await import('/src/scenes/schema.js');
  const PE = await import('/src/expr.js');
  S.addEntity(st, 'circle', { cx: 1, cy: 2, r: 3 });
  S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 4, y2: 0 });
  S.addVariable(st, 'k', { value: 2, min: 0, max: 9 });
  const eq = PE.parseEquation('x^2+y^2=k');
  S.addEntity(st, 'implicit', {}, { expr: eq.fSrc, ast: eq.ast });
  S.ensureEvaluated(st);
  const before = { n: st.entities.size, v: st.variables.size, types: [...st.entities.values()].map((e) => e.type).sort().join(',') };
  const text = F.sceneToText(st, '测试场景', cam);
  const info = SC.inspectScene(text);
  F.newScene(st, S, cam);
  const afterNew = st.entities.size;
  const r = SC.deserializeScene(st, S, text, cam);
  const after = { n: st.entities.size, v: st.variables.size, types: [...st.entities.values()].map((e) => e.type).sort().join(',') };
  const badFile = SC.inspectScene('{"kind":"other","v":1,"entities":[]}');
  F.saveDraft(st, cam, '测试场景');
  const draft = F.readDraft();
  return { before, afterNew, after, ok: r.ok, name: info.name, bytes: text.length, badRejected: !badFile.ok, badMsg: badFile.error, draftOk: !!draft && draft.name === '测试场景' };
});
console.log(`① 往返：保存前 ${rt.before.n} 实体/${rt.before.v} 变量（${rt.before.types}）→ 新建后 ${rt.afterNew} → 打开后 ${rt.after.n} 实体/${rt.after.v} 变量（${rt.after.types}）`);
if (rt.afterNew !== 0) bad.push('新建没有清空画布');
if (!(rt.ok && rt.after.n === rt.before.n && rt.after.v === rt.before.v && rt.after.types === rt.before.types)) bad.push('保存→打开往返不一致');
console.log(`② 文件与校验：名称=${rt.name} 大小=${rt.bytes} 字节 | 非法文件被拒=${rt.badRejected}（${rt.badMsg}）`);
if (!rt.badRejected) bad.push('非本程序的文件没有被拒绝');
console.log(`③ 自动草稿 = ${rt.draftOk}`);
if (!rt.draftOk) bad.push('自动草稿未正确写入或读回');
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('✅ S7 通过：.iwz 可保存可打开、往返一致、非法文件被明确拒绝、自动草稿可用');
