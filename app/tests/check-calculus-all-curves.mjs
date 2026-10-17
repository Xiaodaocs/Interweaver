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

// ③ 圆上积分/导函数曲线 → 走**真实右键菜单**，应当**真的生成**实体
//    ★ 口径变更（用户 2026-10-17 拍板：方案 c = 最完整）：旧版这里断言"不该生成 + 提示含不支持" ✗ 已废 ✓
//    ★ 同时修掉旧版**检查自身**的一个时序 bug ✗：
//      它右键在**圆心 (cx, cy)** 而不是圆周上（圆是空心的 → 那一点不在曲线上）✗；
//      而且第二次迭代时，第一次生成的积分区域正好盖住那一点 → 菜单变成了那个实体的菜单 ✗
//      → 于是「圆上导函数曲线在菜单里没有入口」是**假红** ✗（menu.js 里两个入口是一起 push 的 ✓）
//    现在：右键**圆周上**一点 ✓ → 断言入口存在 ✓ → 点击 → 断言**恰好新增 1 个实体** ✓ → 提示说明"参数 t" ✓
//          → 每轮结束把刚建的实体删掉 ✓（避免它影响下一次右键 ✓）
const made = {};
for (const [kind, act] of [['integral', 'mk:integral'], ['derivcurve', 'mk:derivcurve']]) {
  await page.evaluate(([id]) => { const st = window.__IW.st; st.selection = new Set([id]); window.__IW.S.emit(st, 'selection'); }, [setup.C]);
  await wait(200);
  const before = await page.evaluate(() => window.__IW.st.entities.size);
  const rpC = await page.evaluate(([id]) => {
    const st = window.__IW.st, S = window.__IW.S;
    const e = st.entities.get(id);
    const cx = S.getVal(st, e, 'cx'), cy = S.getVal(st, e, 'cy'), r = S.getVal(st, e, 'r');
    const s = window.__IW.cam.w2s(cx, cy);   // ★ 右键在**圆心**：菜单来自"选中态" ✓ 圆心不在曲线上 → 不会把选中换掉 ✓
                                             //   （我一度改成圆周上 ✗ 结果命中了曲线/线上点 → 选中被替换 → 菜单变成别的实体 ✗ 两处都 false ✓ 已改回）
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
  made[kind] = { clicked, added: after.n - before, hint: after.hint };
  await page.evaluate(([a]) => {
    const st = window.__IW.st;
    const t = a === 'mk:integral' ? 'integral' : 'derivcurve';
    const e = [...st.entities.values()].find((x) => x.type === t);
    if (e) st.entities.delete(e.id);
  }, [act]);
  await wait(150);
}
for (const k of ['integral', 'derivcurve']) {
  const label = k === 'integral' ? '积分区域' : '导函数曲线';
  console.log(`③ 圆上${label}：菜单项存在=${made[k].clicked} 新增实体=${made[k].added} 提示="${made[k].hint.slice(0, 64)}…"`);
  if (!made[k].clicked) bad.push(`圆上「${label}」在菜单里没有入口`);
  if (made[k].added !== 1) bad.push(`圆上应当真的创建 1 个${label}实体（实际 ${made[k].added} 个）`);
  if (!made[k].hint.includes('参数 t')) bad.push(`圆上 ${label} 的提示没有说明"区间/横轴是参数 t"（提示=${made[k].hint}）`);
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
console.log('✅ 通过：圆/自由圆弧/线段都能作切线（斜率正确）；圆上的积分区域与导函数曲线**都能真的生成**（区间/横轴＝参数 t）');
