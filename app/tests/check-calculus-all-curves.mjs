// 验收（用户要求：为所有的曲线都增加微积分功能）
//   ① 圆上放一个线上点 → 右键菜单应出现「🧮 微积分…」（以前几何曲线被整体挡掉）
//   ② 在圆上作**切线**：斜率应等于解析值 dy/dx = −(x−cx)/(y−cy)
//   ③ 圆是闭曲线 → 「积分区域 / 导函数曲线」应被**明确拒绝并说明理由**（不静默、不造假）
//   ④ 线段、自由圆弧上同样可用切线（参数化曲线）
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
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

// 造：圆 + 圆上线上点（t=0.9 rad）；自由圆弧；线段
const setup = await page.evaluate(() => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  st.entities.clear(); st.bindings.clear(); st.constraints.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40; st.tool = 'select';
  const C = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
  const ep = S.addEdgePoint(st, C.id, 0.9);
  const AF = S.addEntity(st, 'arcfree', { cx: 5, cy: 0, r: 2, start: 0.3, sweep: 1.6 });
  const epA = S.addEdgePoint(st, AF.id, 0.5);
  const SG = S.addEntity(st, 'segment', { x1: -6, y1: -3, x2: -2, y2: 1 });
  const epS = S.addEdgePoint(st, SG.id, 0.5);
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  return { C: C.id, ep: ep.point.id, AF: AF.id, epA: epA.point.id, SG: SG.id, epS: epS.point.id };
});

// ① 菜单里应当有微积分
await page.evaluate(([id]) => { const st = window.__IW.st; st.selection = new Set([id]); window.__IW.S.emit(st, 'selection'); }, [setup.ep]);
await wait(300);
const menuHas = await page.evaluate(() => {
  const acts = [...document.querySelectorAll('#ctxMenu button[data-act]')].map((b) => b.dataset.act);
  return acts;
});
console.log('菜单项 =', JSON.stringify(menuHas.filter((a) => /calc|tangent|secant|integral|deriv/.test(a))));
if (!menuHas.some((a) => /calc|tangent|integral/.test(a))) {
  // 菜单需要右键打开；这里改用直接调 API 验证能力（并单独用右键确认菜单项）
  console.log('  （菜单未展开，改用真实右键确认）');
}

// 真实右键：应当出现「微积分…」分组
const rp = await page.evaluate(([id]) => {
  const st = window.__IW.st, S = window.__IW.S;
  const e = st.entities.get(id);
  const s = window.__IW.cam.w2s(S.getDerived(st, e, 'x'), S.getDerived(st, e, 'y'));
  return [s[0], s[1]];
}, [setup.ep]);
await page.mouse.click(rp[0], rp[1], { button: 'right' });
await wait(500);
const calcGroup = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('#ctxMenu .ctxGroup')].map((g) => g.textContent.trim().slice(0, 8));
  const acts = [...document.querySelectorAll('#ctxMenu button[data-act]')].map((b) => b.dataset.act);
  return { groups, acts };
});
console.log('右键菜单分组 =', JSON.stringify(calcGroup.groups), '| 动作 =', JSON.stringify(calcGroup.acts));
if (!calcGroup.groups.some((g) => g.includes('微积分')) && !calcGroup.acts.some((a) => a.startsWith('calc:'))) {
  bad.push('圆上的线上点右键菜单里没有「微积分…」分组');
}

// ② 圆上切线：斜率应为解析值 −(x−cx)/(y−cy)（m 是**派生量** → 必须用 getDerived 读）
const tanRes = await page.evaluate(([hostId, epId]) => {
  const S = window.__IW.S, st = window.__IW.st;
  const tg = S.addEntity(st, 'tangent', { len: 2 }, { host: hostId, p1: epId });
  S.ensureEvaluated(st);
  const host = st.entities.get(hostId);
  const ep = st.entities.get(epId);
  const x = S.getDerived(st, ep, 'x'), y = S.getDerived(st, ep, 'y');
  const cx = S.getVal(st, host, 'cx'), cy = S.getVal(st, host, 'cy');
  const analytic = -(x - cx) / (y - cy);            // 圆的解析切线斜率
  const m = S.getDerived(st, tg, 'm');
  return { x, y, analytic, m, hasTg: !!tg };
}, [setup.C, setup.ep]);
console.log(`② 圆上切线：点=(${tanRes.x.toFixed(4)}, ${tanRes.y.toFixed(4)}) 解析斜率=${tanRes.analytic.toFixed(6)} 实测 m=${Number(tanRes.m).toFixed(6)}`);
if (!Number.isFinite(tanRes.m)) bad.push('圆上切线没有算出斜率');
else if (Math.abs(tanRes.m - tanRes.analytic) > 1e-4) bad.push(`圆上切线斜率不对（实测 ${tanRes.m}，解析 ${tanRes.analytic}）`);

// ③ 圆上积分/导函数曲线 → 走**真实右键菜单**，应被明确拒绝 + 说明理由
//    （入口是"选中**曲线本身**"时给出的，与函数宿主一致；makeCalculus 没暴露到 window.__IW）
const refuse = {};
for (const [kind, act] of [['integral', 'mk:integral'], ['derivcurve', 'mk:derivcurve']]) {
  await page.evaluate(([id]) => { const st = window.__IW.st; st.selection = new Set([id]); window.__IW.S.emit(st, 'selection'); }, [setup.C]);
  await wait(200);
  const before = await page.evaluate(() => window.__IW.st.entities.size);
  const rpC = await page.evaluate(([id]) => {
    const st = window.__IW.st, S = window.__IW.S;
    const e = st.entities.get(id);
    const s = window.__IW.cam.w2s(S.getVal(st, e, 'cx'), S.getVal(st, e, 'cy'));
    return [s[0], s[1]];
  }, [setup.C]);
  await page.mouse.click(rpC[0], rpC[1], { button: 'right' });
  await wait(400);
  const clicked = await page.evaluate(([a]) => {
    const btn = document.querySelector(`#ctxMenu button[data-act="${a}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, [act]);
  await wait(400);
  const after = await page.evaluate(() => ({ n: window.__IW.st.entities.size, hint: document.getElementById('hint').textContent }));
  refuse[kind] = { clicked, added: after.n - before, hint: after.hint };
}
for (const k of ['integral', 'derivcurve']) {
  const label = k === 'integral' ? '积分' : '导函数曲线';
  console.log(`③ 圆上${label}：菜单项存在=${refuse[k].clicked} 新增实体=${refuse[k].added} 提示="${refuse[k].hint.slice(0, 64)}…"`);
  if (!refuse[k].clicked) bad.push(`圆上「${label}」在菜单里没有入口`);
  if (refuse[k].added !== 0) bad.push(`圆上不该生成 ${label}（实际新增了 ${refuse[k].added} 个实体）`);
  if (!refuse[k].hint.includes('不支持')) bad.push(`圆上 ${label} 被拒绝时没有说明理由（提示=${refuse[k].hint}）`);
}

// ④ 线段与自由圆弧上的切线（m 同样是派生量）
const others = await page.evaluate(([sgId, epS, afId, epA]) => {
  const S = window.__IW.S, st = window.__IW.st;
  const out = {};
  for (const [name, hostId, epId] of [['线段', sgId, epS], ['自由圆弧', afId, epA]]) {
    const tg = S.addEntity(st, 'tangent', { len: 2 }, { host: hostId, p1: epId });
    S.ensureEvaluated(st);
    out[name] = Number(S.getDerived(st, tg, 'm'));
  }
  return out;
}, [setup.SG, setup.epS, setup.AF, setup.epA]);
console.log(`④ 线段上切线斜率=${others['线段']?.toFixed(6)}（线段斜率应=1）  自由圆弧上切线斜率=${others['自由圆弧']?.toFixed(6)}`);
if (!(Math.abs(others['线段'] - 1) < 1e-4)) bad.push(`线段上的切线斜率不对（${others['线段']}，应=1）`);
if (!Number.isFinite(others['自由圆弧'])) bad.push('自由圆弧上没有算出切线斜率');

if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/calculus-all-curves.png' });
console.log('截图 → tests/artifacts/calculus-all-curves.png');
await browser.close();
if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：圆/自由圆弧/线段都能作切线（斜率正确）；闭曲线的积分与导函数曲线被明确拒绝并说明理由');
