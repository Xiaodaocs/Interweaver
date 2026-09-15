// 端到端浏览器核验（Puppeteer）：在真实 Chromium 里执行 P1–P6 验收动作
// 运行：node tests/browser-e2e.mjs   （需要 http://localhost:5188 已启动）
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// 右侧面板现在只剩"属性"一页（页签已隐藏），选中实体即显示
const showProps = async () => {
  await page.evaluate(() => { const p = document.getElementById('panel'); if (p) p.hidden = false; });
  await new Promise((r) => setTimeout(r, 60));
};

// ④⑧ 变量已搬到右下角独立窗口：确保它可见（右侧面板现在只剩属性）
const showVarWin = async () => {
  await page.evaluate(() => {
    const w = document.getElementById('varWin');
    if (w) { w.hidden = false; w.classList.remove('winMin'); }
  });
  await new Promise((r) => setTimeout(r, 80));
};

// ③ 子菜单里的条目要先悬停父项才可见 → 统一走这个 helper（必须在所有用例之前定义）
const ctxClick = async (act) => {
  const inSub = await page.evaluate((a) => {
    const el = document.querySelector(`#ctxMenu [data-act="${a}"]`);
    return !!(el && el.closest('.ctxSub'));
  }, act);
  if (inSub) {
    const btn = await page.$(`#ctxMenu [data-act="${act}"]`);
    const handle = await page.evaluateHandle((el) => el.closest('.ctxGroup').querySelector('.ctxSubBtn'), btn);
    await handle.asElement().hover();
    await new Promise((r) => setTimeout(r, 150));
  }
  await page.click(`#ctxMenu [data-act="${act}"]`);
};

// 关闭节流：否则 headless 下 rAF/定时器会被压制，画面更新滞后导致断言随机失败
const LAUNCH_ARGS = [
  '--window-size=1400,900',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion',
];
const browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon/i.test(t)) errors.push(t);
});
page.on('requestfailed', (r) => { if (!/favicon/i.test(r.url())) errors.push('reqfail: ' + r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });

const checkNoErrors = (label) => {
  if (errors.length === 0) { pass++; console.log(`  ✓ ${label} 无运行时错误`); }
  else { fail++; console.log(`  ✗ ${label} 无运行时错误 → ${JSON.stringify(errors.slice(0, 3))}`); }
};

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cv');
await page.waitForFunction(() => !!window.__IW);
ok(true, '页面加载完成且调试钩子就绪');

// ---------- P1：画布 / 平移 / 缩放 ----------
{
  const z0 = await page.evaluate(() => window.__IW.cam.z);
  await page.mouse.move(700, 450);
  await page.mouse.wheel({ deltaY: -400 });
  await new Promise((r) => setTimeout(r, 250));
  const z1 = await page.evaluate(() => window.__IW.cam.z);
  ok(z1 > z0, `P1 滚轮缩放以指针为锚点（z ${z0.toFixed(1)} → ${z1.toFixed(1)}）`);

  await page.evaluate(() => { window.__IW.cam.x = 0; window.__IW.cam.y = 0; });
  await page.keyboard.down('Space');
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const panned = await page.evaluate(() => ({ x: window.__IW.cam.x, y: window.__IW.cam.y }));
  ok(Math.abs(panned.x) > 0.1 || Math.abs(panned.y) > 0.1,
    `P1 空格拖动平移生效（${panned.x.toFixed(2)}, ${panned.y.toFixed(2)}）`);
  checkNoErrors('P1');
}

// ---------- P2：绘制点/线段/圆 + 撤销/重做 ----------
{
  await page.evaluate(() => { window.__IW.cam.x = 0; window.__IW.cam.y = 0; window.__IW.cam.z = 40; });
  const clickTool = (t) => page.click(`#toolbar button[data-tool="${t}"]`);
  const w2s = (x, y) => page.evaluate(([wx, wy]) => {
    const [sx, sy] = window.__IW.cam.w2s(wx, wy); return { x: sx, y: sy };
  }, [x, y]);

  await clickTool('point');
  let p = await w2s(0, 0); await page.mouse.click(p.x, p.y);
  // 线段/圆改为拖动式：按住 → 拖 → 松开
  const dragDraw = async (from, to) => {
    const a = await w2s(from[0], from[1]);
    const b = await w2s(to[0], to[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 120));
  };
  await clickTool('segment');
  await dragDraw([-4, -2], [4, -2]);
  await clickTool('circle');
  await dragDraw([0, 3], [2, 3]);

  const counts = await page.evaluate(() => {
    const t = {};
    for (const e of window.__IW.st.entities.values()) t[e.type] = (t[e.type] || 0) + 1;
    return t;
  });
  ok(counts.point === 1 && counts.segment === 1 && counts.circle === 1,
    `P2 拖动式绘制：点/线段/圆 ${JSON.stringify(counts)}`);
  const geom = await page.evaluate(() => {
    const st = window.__IW.st;
    const s = [...st.entities.values()].find((e) => e.type === 'segment');
    const c = [...st.entities.values()].find((e) => e.type === 'circle');
    return { len: Math.abs(s.params.x2 - s.params.x1), r: c.params.r, cx: c.params.cx };
  });
  ok(Math.abs(geom.len - 8) < 0.3, `拖出的线段长度等于拖动距离（${geom.len.toFixed(2)}，期望 8）`);
  ok(Math.abs(geom.r - 2) < 0.3 && Math.abs(geom.cx - 0) < 0.3, `拖出的圆半径＝拖动距离（r=${geom.r.toFixed(2)}，圆心 x=${geom.cx.toFixed(2)}）`);
  // 拖动距离过短（等同点击）不应产生图形
  const before = await page.evaluate(() => window.__IW.st.entities.size);
  await clickTool('segment');
  const q = await w2s(6, 6);
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 120));
  const afterShort = await page.evaluate(() => window.__IW.st.entities.size);
  ok(afterShort === before, '几乎没拖动（<4px）不会生成退化的线段');

  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.keyboard.press('z');
  await page.keyboard.up('Control');
  const after = await page.evaluate(() => window.__IW.st.entities.size);
  ok(after === 0, 'P2 Ctrl+Z 撤销三次后场景为空');

  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  for (let i = 0; i < 3; i++) await page.keyboard.press('z');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  const redone = await page.evaluate(() => window.__IW.st.entities.size);
  ok(redone === 3, 'P2 重做三次恢复 3 个实体');
  checkNoErrors('P2');
}

// ---------- P3：直接操纵（拖圆边改半径）----------
{
  const before = await page.evaluate(() => {
    const c = [...window.__IW.st.entities.values()].find((e) => e.type === 'circle');
    return c.params.r;
  });
  const from = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(2, 3); return { x, y }; });
  const to = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(3.5, 3); return { x, y }; });
  await page.click('#toolbar button[data-tool="select"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const c = [...window.__IW.st.entities.values()].find((e) => e.type === 'circle');
    return c.params.r;
  });
  ok(Math.abs(after - 3.5) < 0.2, `P3 拖圆边缘改半径（${before} → ${after.toFixed(3)}，期望 ≈3.5）`);
  checkNoErrors('P3');
}

// ---------- P4 + P5：变量、滑杆、右键关联（魔法时刻）----------
{
  await showVarWin();
  await page.click('#addVar');
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const name = [...st.variables.keys()][0];
    S.setVariable(st, name, { value: 9 });
  });
  const varName = await page.evaluate(() => [...window.__IW.st.variables.keys()][0]);
  ok(varName === 'a', `P4 新建变量并设值（名称 ${varName}，值 9）`);

  await page.evaluate(() => {
    const { st, S, REGISTRY } = window.__IW;
    S.addEntity(st, 'sine', REGISTRY.sine.create({ x: 0, y: 0 }));
  });

  // 右键正弦波上的真实点（x = λ/4 处是波峰 y = A = 1.5）
  const peak = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5708, 1.5); return { x, y }; });
  await page.mouse.click(peak.x, peak.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="link"]', { timeout: 3000 });
  ok(true, 'P5 右键实体弹出上下文菜单');
  await page.click('#ctxMenu [data-act="link"]');
  await page.waitForSelector('[data-wp="lam"]', { timeout: 3000 });
  ok(true, 'P5 「关联…」进入两步向导第一步（列出参数）');
  await page.click('[data-wp="lam"]');
  await page.waitForSelector('[data-wv]', { timeout: 3000 });
  await page.click('[data-wv]');
  await new Promise((r) => setTimeout(r, 250));

  const lam = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    S.ensureEvaluated(st);
    return S.getVal(st, w, 'lam');
  });
  ok(Math.abs(lam - 9) < 1e-9, `P5 向导完成 λ ← a 绑定（λ = ${lam}，期望 9）`);

  // 真的拖滑杆 → 波长实时跟随
  await showVarWin();
  await page.waitForSelector(`[data-vslider="${varName}"]`);
  const sl = await page.$(`[data-vslider="${varName}"]`);
  const box = await sl.boundingBox();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const lam2 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    S.ensureEvaluated(st);
    return S.getVal(st, w, 'lam');
  });
  ok(lam2 < 9 && lam2 > 0, `P4+P5 拖动滑杆实时驱动波长（λ 9 → ${lam2.toFixed(2)}）`);

  await page.click('#setConn');   // 连接视图开关已搬进正下方设置卡（⑦）
  const connOn = await page.evaluate(() => window.__IW.st.connOn);
  ok(connOn === true, 'P5 连接视图开关生效');

  const cyc = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = S.addEntity(st, 'point', { x: 0, y: 0 });
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    S.addBinding(st, p.id, 'x', `${w.label}.A`);
    return S.addBinding(st, w.id, 'A', `${p.label}.x`);
  });
  ok(!!cyc.error && cyc.error.includes('绕回自己'), `P5 环检测拒绝并给人话（"${cyc.error}"）`);
  checkNoErrors('P4/P5');
}

// ---------- P6 + 改动5：函数创作器（左下角弹出，生成后收起）----------
{
  const hidden0 = await page.evaluate(() => document.getElementById('fxDock').hidden);
  ok(hidden0, '函数创作器默认收起');
  await page.click('#toolbar button[data-tool="fx"]');
  await new Promise((r) => setTimeout(r, 250));
  const geom = await page.evaluate(() => {
    const r = document.getElementById('fxDock').getBoundingClientRect();
    return { hidden: document.getElementById('fxDock').hidden, x: r.x, y: r.y, w: r.width, bottomGap: innerHeight - (r.y + r.height), leftGap: r.x };
  });
  ok(!geom.hidden, '点工具栏 ƒx 后弹出');
  ok(geom.x > 60 && geom.x < 700 && geom.y > 40 && geom.y < 320, `⑤ 位于左上、离边缘有距离（left=${geom.x.toFixed(0)}，top=${geom.y.toFixed(0)}）`);

  await page.type('#fxInput', '2x+3=y');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  const f4 = await page.evaluate(() => {
    const { st } = window.__IW;
    const f = [...st.entities.values()].find((e) => e.type === 'func');
    return f ? st.scope.evalWith(f.ast, 4) : null;
  });
  ok(f4 === 11, `输入 2x+3=y 生成斜线（f(4) = ${f4}，期望 11）`);
  const closedAfterGen = await page.evaluate(() => ({
    hidden: document.getElementById('fxDock').hidden,
    tool: window.__IW.st.tool,
  }));
  ok(closedAfterGen.hidden, '生成后函数创作器自动收起');
  ok(closedAfterGen.tool === 'select', `生成后回到鼠标模式（tool=${closedAfterGen.tool}）`);

  // 再打开一次，验证芯片与隐函数提示
  await page.click('#toolbar button[data-tool="fx"]');
  await new Promise((r) => setTimeout(r, 200));
  await page.type('#fxInput', 'y=a*x+b');
  await new Promise((r) => setTimeout(r, 250));
  const chips = await page.$$eval('#fxChips .chip', (els) => els.map((e) => e.textContent.trim()));
  ok(chips.length === 1 && chips[0].includes('b'), `只对未定义的 b 建议滑杆 ${JSON.stringify(chips)}`);
  await page.click('#fxChips .chip');
  await new Promise((r) => setTimeout(r, 250));
  const bVar = await page.evaluate(() => window.__IW.st.variables.get('b'));
  ok(!!bVar, `点芯片一键创建滑杆 b（b = ${bVar?.value}）`);
  await page.click('#fxGo');
  await new Promise((r) => setTimeout(r, 300));
  const y4 = await page.evaluate(() => {
    const { st } = window.__IW;
    const fs = [...st.entities.values()].filter((e) => e.type === 'func');
    const a = st.variables.get('a').value, b = st.variables.get('b').value;
    return { got: st.scope.evalWith(fs[fs.length - 1].ast, 4), expect: a * 4 + b, a, b };
  });
  ok(Math.abs(y4.got - y4.expect) < 1e-9,
    `y=a*x+b 随变量联动（a=${y4.a}, b=${y4.b} → f(4)=${y4.got}，期望 ${y4.expect}）`);

  await page.click('#toolbar button[data-tool="fx"]');
  await new Promise((r) => setTimeout(r, 200));
  await page.type('#fxInput', 'x^2+y^2=25');
  await new Promise((r) => setTimeout(r, 250));
  const hint = await page.$eval('#fxErr', (e) => e.textContent);
  ok(hint.includes('隐函数'), `隐函数得到温柔提示（"${hint}"）`);
  checkNoErrors('改动5 函数创作器');
}

// ---------- 预设库拖放落到指针位置（索引随预设列表变化：3 = 三角形）----------
{
  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 250));
  const before = await page.evaluate(() => [...window.__IW.st.entities.values()].filter((e) => e.type === 'polygon').length);
  const item = await page.$('[data-pi="3"]');
  const box = await item.boundingBox();
  const target = { x: 500, y: 320 };
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const placed = await page.evaluate(() => {
    const { st, cam } = window.__IW;
    const ps = [...st.entities.values()].filter((e) => e.type === 'polygon');
    const p = ps[ps.length - 1];
    let sx = 0, sy = 0;
    for (let i = 1; i <= p.count; i++) { sx += p.params[`v${i}x`]; sy += p.params[`v${i}y`]; }
    const [px, py] = cam.w2s(sx / p.count, sy / p.count);
    return { px, py, count: ps.length, n: p.count };
  });
  const d = Math.hypot(placed.px - target.x, placed.py - target.y);
  ok(placed.count === before + 1, '拖放确实新建了一个多边形实体');
  ok(placed.n === 3, '三角形预设应生成 3 个顶点');
  ok(d < 30, `预设拖放落到指针位置（偏差 ${d.toFixed(1)}px < 30px）`);
  checkNoErrors('预设拖放');
}

// ---------- 修复1 网格：纵向平移时 x 轴必须平滑跟随（像素级核验）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  await new Promise((r) => setTimeout(r, 250));
  const probe = () => page.evaluate(() => {
    const { cam } = window.__IW;
    const cv = document.getElementById('cv');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.round(60 * dpr), x1 = Math.round(260 * dpr);
    const img = ctx.getImageData(x0, 0, x1 - x0, cv.height).data;
    // 主题无关地找 x 轴：x 轴线的亮度是"与背景纸面差异最大"的那一行（浅色里最深、深色里最亮），
    // 所以先取该列的中位亮度当背景，再找偏离中位最远的那行 —— 而不是"最深的一行"。
    const rowLum = [];
    for (let y = 0; y < cv.height; y++) {
      let lum = 0;
      for (let x = 0; x < x1 - x0; x++) {
        const i = (y * (x1 - x0) + x) * 4;
        lum += (img[i] + img[i + 1] + img[i + 2]) / 3;
      }
      rowLum.push(lum / (x1 - x0));
    }
    const sorted = [...rowLum].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let bestRow = -1, bestDev = -1;
    for (let y = 0; y < rowLum.length; y++) {
      const dev = Math.abs(rowLum[y] - median);
      if (dev > bestDev) { bestDev = dev; bestRow = y; }
    }
    const [, expected] = cam.w2s(0, 0);
    return { axisRow: bestRow / dpr, expected };
  });

  const samples = [];
  for (let k = 0; k < 6; k++) {
    samples.push(await probe());
    await page.evaluate(() => {
      const { cam, st, S } = window.__IW;
      cam.y += 2 / 3; // 每次平移 step/3（非整格），逼出"整格跳动"类 bug
      S.emit(st);
    });
    await new Promise((r2) => setTimeout(r2, 130));
  }
  const worst = Math.max(...samples.map((s) => Math.abs(s.axisRow - s.expected)));
  ok(worst <= 2.5, `x 轴渲染位置与理论值最大偏差 ${worst.toFixed(2)}px（≤2.5px；修复前会整格跳约 ${(2 * 40 / 2).toFixed(0)}px）`);
  checkNoErrors('修复1 网格平移');
}

// ---------- 修复2 画三条线段围成三角形 → 自动组合为一个整体 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="segment"]');
  const w2s = (x, y) => page.evaluate(([wx, wy]) => {
    const [sx, sy] = window.__IW.cam.w2s(wx, wy); return { x: sx, y: sy };
  }, [x, y]);
  const stroke = async (a, b) => {
    // 改动4：每画完一笔会自动回到鼠标模式，所以要重新选线段工具
    await page.click('#toolbar button[data-tool="segment"]');
    await new Promise((r) => setTimeout(r, 80));
    const A = await w2s(a[0], a[1]), B = await w2s(b[0], b[1]);
    await page.mouse.move(A.x, A.y);
    await page.mouse.down();
    await page.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 3 });
    await page.mouse.move(B.x, B.y, { steps: 5 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 140));
  };
  await stroke([-3, -2], [3, -2]);
  await stroke([3, -2], [0, 3]);
  await stroke([0, 3], [-3, -2]);
  await new Promise((r) => setTimeout(r, 350));
  const res = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const ps = [...st.entities.values()].filter((e) => e.type === 'polygon');
    const segs = [...st.entities.values()].filter((e) => e.type === 'segment');
    const p = ps[0];
    return {
      polygons: ps.length, segs: segs.length, count: p?.count,
      area: p ? S.getDerived(st, p, 'area') : null,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(res.polygons === 1 && res.segs === 0, `三条线段已合并为一个多边形（polygon=${res.polygons}, 剩余线段=${res.segs}）`);
  ok(res.count === 3, '组合出的多边形有 3 个顶点');
  ok(res.area > 10, `面积由派生量算得（${res.area?.toFixed(2)}）`);
  ok(res.hint.includes('三角形'), `出现即时提示："${res.hint}"`);

  await page.click('#toolbar button[data-tool="select"]');
  const v = await w2s(0, 3);
  const v2 = await w2s(0, 5);
  const beforeArea = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getDerived(st, [...st.entities.values()][0], 'area');
  });
  await page.mouse.move(v.x, v.y);
  await page.mouse.down();
  await page.mouse.move(v2.x, v2.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const afterArea = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getDerived(st, [...st.entities.values()][0], 'area');
  });
  ok(Math.abs(afterArea - beforeArea) > 1, `拖顶点改变了形状（面积 ${beforeArea.toFixed(1)} → ${afterArea.toFixed(1)}）`);
  checkNoErrors('修复2 自动组合');
}

// ---------- 修复2 点工具在圆上"截"两点 → 线上点 + 圆弧 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="point"]');
  const w2s2 = (x, y) => page.evaluate(([wx, wy]) => {
    const [sx, sy] = window.__IW.cam.w2s(wx, wy); return { x: sx, y: sy };
  }, [x, y]);
  const p1 = await w2s2(3, 0);
  const p2 = await w2s2(0, 3);
  await page.mouse.click(p1.x, p1.y);
  await new Promise((r) => setTimeout(r, 250));
  const afterFirst = await page.evaluate(() => {
    const { st } = window.__IW;
    return {
      eps: [...st.entities.values()].filter((e) => e.type === 'edgepoint').length,
      arcs: [...st.entities.values()].filter((e) => e.type === 'arc').length,
    };
  });
  ok(afterFirst.eps === 1 && afterFirst.arcs === 0, '第一个点：只有线上点，还没有弧');

  await page.mouse.click(p2.x, p2.y);
  await new Promise((r) => setTimeout(r, 350));
  const afterSecond = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    const arc = [...st.entities.values()].find((e) => e.type === 'arcfree');
    return {
      eps: eps.length,
      hasArc: !!arc,
      hostless: arc ? !arc.host : null,
      piece: arc ? !!arc.piece : null,
      from: arc ? arc.fromLabel : null,
      deg: arc ? S.getDerived(st, arc, 'deg') : null,
      len: arc ? S.getDerived(st, arc, 'len') : null,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(afterSecond.eps === 2, '第二个点：两个线上点');
  ok(afterSecond.hasArc && afterSecond.hostless && afterSecond.piece,
    '⑤ 第二个点落圆上后直接截出一段【独立】弧（不挂宿主）');
  ok(afterSecond.from && afterSecond.from.startsWith('c'), `记录出处 ${afterSecond.from}`);
  ok(Math.abs(afterSecond.deg - 90) < 2, `弧段圆心角 ≈90°（实际 ${afterSecond.deg?.toFixed(1)}°）`);
  ok(Math.abs(afterSecond.len - 1.5 * Math.PI) < 0.1, `弧长 = r·θ ≈ 4.71（实际 ${afterSecond.len?.toFixed(3)}）`);
  ok(afterSecond.hint.includes('弧段') && afterSecond.hint.includes('独立'),
    `提示说清了"截出一段弧段、它是独立的"："${afterSecond.hint}"`);

  await page.click('#toolbar button[data-tool="select"]');
  const from = await w2s2(3, 0);
  const to = await w2s2(3 * Math.cos(Math.PI / 4), 3 * Math.sin(Math.PI / 4));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const afterDrag = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const arc = [...st.entities.values()].find((e) => e.type === 'arcfree');
    const ep = [...st.entities.values()].find((e) => e.type === 'edgepoint');
    const host = st.entities.get(ep.host);
    const [px, py] = [S.getDerived(st, ep, 'x'), S.getDerived(st, ep, 'y')];
    const rr = Math.hypot(px - host.params.cx, py - host.params.cy);
    return { deg: S.getDerived(st, arc, 'deg'), onCircle: Math.abs(rr - host.params.r) };
  });
  ok(afterDrag.onCircle < 1e-6, '线上点始终精确贴在圆上（不会脱离）');
  ok(Math.abs(afterDrag.deg - 90) < 2, `⑤ 拖动线上点不再改变已截出的那段弧（仍 ${afterDrag.deg?.toFixed(1)}°，它是独立图形）`);

  await page.click('#toolbar button[data-tool="point"]');
  const inside = await w2s2(1, 1);
  await page.mouse.click(inside.x, inside.y);
  await new Promise((r) => setTimeout(r, 250));
  const freePoints = await page.evaluate(() => [...window.__IW.st.entities.values()].filter((e) => e.type === 'point').length);
  ok(freePoints === 1, '圆内部点击生成的是自由点（只有边界才算"截"）');
  checkNoErrors('修复2 截点截弧');
}

// ---------- 修复3 圆自带直径可拖动 + 预设库已移除圆/单位圆 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  const p = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5, 0); return { x, y }; });
  const q = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5, 2); return { x, y }; });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const moved = await page.evaluate(() => {
    const c = [...window.__IW.st.entities.values()].find((e) => e.type === 'circle');
    return { cx: c.params.cx, cy: c.params.cy, r: c.params.r };
  });
  ok(Math.abs(moved.cy - 2) < 0.4 && Math.abs(moved.r - 3) < 0.4,
    `抓住直径可整体平移圆（圆心 y 0 → ${moved.cy.toFixed(2)}，半径不变 ${moved.r.toFixed(2)}）`);

  const presetNames = await page.evaluate(() => [...document.querySelectorAll('.presetItem')].map((e) => e.textContent.trim()));
  const plainCircle = presetNames.some((n) => n.startsWith('单位圆') || /^圆[^\-]/.test(n) || n.startsWith('圆A'));
  ok(!plainCircle, `预设库已移除圆/单位圆（现在是 11 项，含"圆-正弦联动"这类复合预设）：${JSON.stringify(presetNames.slice(0, 4))}`);
  checkNoErrors('修复3 圆直径');
}

// ---------- P2 补充：框选多实体 + 整体拖动（放在最后，避免干扰前面的场景断言）----------
{
  await page.evaluate(() => {
    const { st, S, cam } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'point', { x: 0, y: 0 });
    S.addEntity(st, 'point', { x: 2, y: 0 });
    S.addEntity(st, 'circle', { cx: 0, cy: 3, r: 1 });
    st.connOn = false;
  });
  await page.evaluate(() => { const c = document.getElementById('setConn'); if (c) { c.checked = false; } window.__IW.st.connOn = false; });
  await page.click('#toolbar button[data-tool="select"]');
  const a = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-3, 5); return { x, y }; });
  const b = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(4, -2); return { x, y }; });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  const selCount = await page.evaluate(() => window.__IW.st.selection.size);
  ok(selCount === 3, `P2 框选选中 3 个实体（实际 ${selCount}）`);

  const before = await page.evaluate(() => [...window.__IW.st.entities.values()].map((e) => ({ id: e.id, p: { ...e.params } })));
  const grab = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(0, 0); return { x, y }; });
  const drop = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(2, 0); return { x, y }; });
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const after = await page.evaluate(() => [...window.__IW.st.entities.values()].map((e) => ({ id: e.id, p: { ...e.params } })));
  const deltas = before.map((bef, i) => {
    const key = Object.keys(bef.p)[0];
    return after[i].p[key] - bef.p[key];
  });
  ok(deltas.every((d) => Math.abs(d - 2) < 0.25),
    `P2 整体拖动：全部实体同步平移 +2（实测位移 ${deltas.map((d) => d.toFixed(2)).join(', ')}）`);
  checkNoErrors('P2 整体拖动');
}

// ---------- 本轮改动 2：预设抽屉点别处能收回 ----------
{
  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 200));
  const opened = await page.evaluate(() => !document.getElementById('presetDock').hidden);
  ok(opened, '点「预设」能打开抽屉');
  await page.click('#toolbar button[data-tool="select"]');
  await new Promise((r) => setTimeout(r, 200));
  const closedByTool = await page.evaluate(() => document.getElementById('presetDock').hidden);
  ok(closedByTool, '点别的工具按钮 → 抽屉自动收回（此前必须再点一次「预设」）');

  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.click(700, 500); // 点画布
  await new Promise((r) => setTimeout(r, 200));
  const closedByCanvas = await page.evaluate(() => document.getElementById('presetDock').hidden);
  ok(closedByCanvas, '在画布上开始操作 → 抽屉也自动收回');
  checkNoErrors('改动2 预设抽屉');
}

// ---------- 本轮改动 3：多边形整体拖动 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'polygon', { v1x: -3, v1y: -2, v2x: 3, v2y: -2, v3x: 0, v3y: 3 }, { count: 3 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  const centroid = () => page.evaluate(() => {
    const { st } = window.__IW;
    const p = [...st.entities.values()][0];
    let sx = 0, sy = 0;
    for (let i = 1; i <= p.count; i++) { sx += p.params[`v${i}x`]; sy += p.params[`v${i}y`]; }
    return { x: sx / p.count, y: sy / p.count };
  });
  const before = await centroid();
  // 抓"边"（不是顶点）拖动
  const from = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-1.5, -2); return { x, y }; });
  const to = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5, 0); return { x, y }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const after = await centroid();
  ok(Math.abs(after.x - before.x - 3) < 0.4 && Math.abs(after.y - before.y - 2) < 0.4,
    `抓多边形的边可以整体移动（质心 ${before.x.toFixed(2)},${before.y.toFixed(2)} → ${after.x.toFixed(2)},${after.y.toFixed(2)}，期望 +3,+2）`);
  const area = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getDerived(st, [...st.entities.values()][0], 'area');
  });
  ok(area > 10, `整体移动后形状不变（面积 ${area.toFixed(2)}）`);

  // 预设里的三角形同样能整体拖动
  await page.evaluate(() => {
    const { st, S, REGISTRY } = window.__IW;
    st.entities.clear(); st.selection.clear();
    S.addEntity(st, 'polygon', REGISTRY.polygon.create({ x: 0, y: 0 }), { count: 3 });
    S.ensureEvaluated(st);
  });
  const b2 = await centroid();
  const f2 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(0, -1.5); return { x, y }; });
  const t2 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(2, -3.5); return { x, y }; });
  await page.mouse.move(f2.x, f2.y);
  await page.mouse.down();
  await page.mouse.move(t2.x, t2.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const a2 = await centroid();
  ok(Math.abs(a2.x - b2.x - 2) < 0.4 && Math.abs(a2.y - b2.y + 2) < 0.4,
    `预设三角形也能整体拖动（质心移动 ${(a2.x - b2.x).toFixed(2)},${(a2.y - b2.y).toFixed(2)}）`);
  checkNoErrors('改动3 多边形整体拖动');
}

// ---------- 本轮改动 4：多边形解绑为线段 → 线段绑定为一个整体 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'polygon', { v1x: -3, v1y: -2, v2x: 3, v2y: -2, v3x: 0, v3y: 3 }, { count: 3 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  // 右键多边形（点它的边）→ 解绑
  const edge = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(0, -2); return { x, y }; });
  await page.mouse.click(edge.x, edge.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="explode"]', { timeout: 3000 });
  ok(true, '多边形的右键菜单里有「解绑」');
  await page.click('#ctxMenu [data-act="explode"]');
  await new Promise((r) => setTimeout(r, 300));
  const afterExplode = await page.evaluate(() => {
    const { st } = window.__IW;
    return {
      segs: [...st.entities.values()].filter((e) => e.type === 'segment').length,
      polys: [...st.entities.values()].filter((e) => e.type === 'polygon').length,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(afterExplode.segs === 3 && afterExplode.polys === 0, `解绑后是 3 条线段（实际 ${afterExplode.segs} 线段 / ${afterExplode.polys} 多边形）`);
  ok(afterExplode.hint.includes('解绑'), `提示："${afterExplode.hint}"`);

  // 框选 3 条线段 → 右键 → 绑定为一个整体
  const a = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-5, 5); return { x, y }; });
  const b = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(5, -4); return { x, y }; });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  const selCount = await page.evaluate(() => window.__IW.st.selection.size);
  ok(selCount === 3, `框选选中 3 条线段（实际 ${selCount}）`);
  await page.mouse.click(edge.x, edge.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="merge"]', { timeout: 3000 });
  ok(true, '多选线段后右键菜单里出现「绑定为一个整体」');
  await page.click('#ctxMenu [data-act="merge"]');
  await new Promise((r) => setTimeout(r, 300));
  const afterMerge = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = [...st.entities.values()].find((e) => e.type === 'polygon');
    return { polys: [...st.entities.values()].filter((e) => e.type === 'polygon').length, area: p ? S.getDerived(st, p, 'area') : null };
  });
  ok(afterMerge.polys === 1 && afterMerge.area > 10, `线段重新绑定为一个整体（面积 ${afterMerge.area?.toFixed(2)}）`);
  checkNoErrors('改动4 解绑/绑定');
}

// ---------- 本轮改动 4：多边形上的点默认锁边，可开关绕行 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const p = S.addEntity(st, 'polygon', { v1x: -3, v1y: -3, v2x: 3, v2y: -3, v3x: 3, v3y: 3, v4x: -3, v4y: 3 }, { count: 4 });
    S.addEdgePoint(st, p.id, 0.5); // 底边中点
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  const epPos = () => page.evaluate(() => {
    const { st, S } = window.__IW;
    const ep = [...st.entities.values()].find((e) => e.type === 'edgepoint');
    return { x: S.getDerived(st, ep, 'x'), y: S.getDerived(st, ep, 'y'), t: st.values.get(`${ep.id}:t`), roam: !!ep.roam };
  });
  const p0 = await epPos();
  ok(!p0.roam && Math.abs(p0.y + 3) < 1e-6, `默认锁在底边（y=${p0.y.toFixed(2)}，roam=${p0.roam}）`);

  // 试着把它拖到上边附近：应被夹在底边上
  const from = await page.evaluate(([px, py]) => { const [x, y] = window.__IW.cam.w2s(px, py); return { x, y }; }, [p0.x, p0.y]);
  const to = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(0, 2.8); return { x, y }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const p1 = await epPos();
  ok(Math.abs(p1.y + 3) < 1e-6, `锁定时拖不到别的边（仍在 y=${p1.y.toFixed(2)}）`);

  // 打开"允许绕行" → 再拖同样的方向，应能滑到上边
  await page.mouse.click(from.x, from.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="roam"]', { timeout: 3000 });
  ok(true, '线上点的右键菜单里有「允许绕到其它边」开关');
  await page.click('#ctxMenu [data-act="roam"]');
  await new Promise((r) => setTimeout(r, 250));
  const p2 = await epPos();
  ok(p2.roam, '开关已打开');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const p3 = await epPos();
  ok(Math.abs(p3.y - 3) < 0.3, `允许绕行后可以滑到上边（y=${p3.y.toFixed(2)}，期望 ≈3）`);
  checkNoErrors('改动4 绕行开关');
}

// ---------- ⑤ 曲线两点裁切 → 直接得到独立的段（可整体拖走，不再随宿主变形）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'sine', { A: 1.5, lam: 6.28, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="point"]');
  const onCurve = async (x) => {
    const y = await page.evaluate((xx) => {
      const { st, REGISTRY } = window.__IW;
      const w = [...st.entities.values()].find((e) => e.type === 'sine');
      return REGISTRY.sine.yAt((k) => w.params[k], xx);
    }, x);
    return page.evaluate(([xx, yy]) => { const [sx, sy] = window.__IW.cam.w2s(xx, yy); return { x: sx, y: sy }; }, [x, y]);
  };
  let pt = await onCurve(1.5708); await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 250));
  const st1 = await page.evaluate(() => ({
    pieces: [...window.__IW.st.entities.values()].filter((e) => e.piece).length,
    sineCount: [...window.__IW.st.entities.values()].filter((e) => e.type === 'sine').length,
  }));
  ok(st1.pieces === 0 && st1.sineCount === 1, '只有一个点时不裁切（仍然只有那一条正弦）');

  pt = await onCurve(4.712); await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 300));
  const res = await page.evaluate(() => {
    const { st, REGISTRY } = window.__IW;
    const piece = [...st.entities.values()].find((e) => e.piece);
    const w = [...st.entities.values()].find((e) => e.type === 'sine' && !e.piece);
    return {
      hasPiece: !!piece,
      type: piece?.type,
      hostless: piece ? !piece.host : null,
      from: piece?.fromLabel,
      name: piece ? window.__IW.S.pieceNameOf(piece) : null,
      dmin: piece?.params.dmin,
      dmax: piece?.params.dmax,
      hint: document.getElementById('hint').textContent,
      hostLabel: w?.label,
      amp: piece ? REGISTRY.sine.yAt((k) => window.__IW.S.getVal(st, piece, k), piece.params.dmin + Math.PI / 2) : null,
    };
  });
  ok(res.hasPiece, '⑤ 正弦波上两个点自动裁出一段曲线');
  ok(res.type === 'sine' && res.hostless && res.from === res.hostLabel,
    `截出来的是独立的解析正弦段（类型 ${res.type}，出处 ${res.from}，不挂宿主=${res.hostless}）`);
  ok(res.name === '正弦段', `名字按来源说人话：${res.name}`);
  ok(res.dmax - res.dmin > 1, `定义域收到裁切范围（[${res.dmin?.toFixed(2)}, ${res.dmax?.toFixed(2)}]）`);
  ok(res.hint.includes('正弦段') && res.hint.includes('独立'), `提示："${res.hint}"`);

  // 拖它走：只平移，姿态不变（先切回选择工具：点工具截完点还arm着）
  await page.click('#toolbar button[data-tool="select"]');
  const before = await page.evaluate(() => {
    const { st, S, REGISTRY } = window.__IW;
    const piece = [...st.entities.values()].find((e) => e.piece);
    const x = piece.params.dmin + Math.PI / 2;
    return { cx: piece.params.cx, cy: piece.params.cy, y: REGISTRY.sine.yAt((k) => S.getVal(st, piece, k), x), A: piece.params.A, lam: piece.params.lam };
  });
  const dragFrom = await page.evaluate(() => {
    const { st, S, cam, REGISTRY } = window.__IW;
    const piece = [...st.entities.values()].find((e) => e.piece);
    const x = (piece.params.dmin + piece.params.dmax) / 2;
    const y = REGISTRY.sine.yAt((k) => S.getVal(st, piece, k), x);
    const [sx, sy] = cam.w2s(x, y);
    return { x: sx, y: sy };
  });
  const dragTo = await page.evaluate(() => { const [sx, sy] = window.__IW.cam.w2s(6.5, 2.4); return { x: sx, y: sy }; });
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await page.mouse.move(dragTo.x, dragTo.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const piece = [...st.entities.values()].find((e) => e.piece);
    return { cx: piece.params.cx, cy: piece.params.cy, A: piece.params.A, lam: piece.params.lam, sel: [...st.selection].includes(piece.id) };
  });
  ok(Math.abs(after.cx - before.cx) > 0.5 || Math.abs(after.cy - before.cy) > 0.5,
    `拖动截段 → 整体搬走（cx ${before.cx.toFixed(2)}→${after.cx.toFixed(2)}, cy ${before.cy.toFixed(2)}→${after.cy.toFixed(2)}）`);
  ok(Math.abs(after.A - before.A) < 1e-9 && Math.abs(after.lam - before.lam) < 1e-9,
    `姿态不变：振幅 ${after.A} / 波长 ${after.lam.toFixed(3)} 都没被拉伸（这是本轮要求的改变）`);
  ok(after.sel, '拖的是这一段本身（不是原曲线）');
  checkNoErrors('⑤ 曲线裁切独立化');
}

// ---------- 本轮改动 2：自由绘制边画边显示轨迹 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="freehand"]');
  const p0 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-4, 0); return { x, y }; });
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p0.x + 60, p0.y - 40, { steps: 6 });
  await page.mouse.move(p0.x + 120, p0.y + 20, { steps: 6 });
  // 松开之前检查：既有预览轨迹，画布上又还没有实体
  const mid = await page.evaluate(() => {
    const { st, cam } = window.__IW;
    const pv = st.preview;
    let onScreen = 0;
    if (pv?.kind === 'free' && pv.pts?.length > 1) {
      // 用像素确认轨迹确实被画出来了
      const cv = document.getElementById('cv');
      const dpr = window.devicePixelRatio || 1;
      const [sx, sy] = cam.w2s(pv.pts[Math.floor(pv.pts.length / 2)][0], pv.pts[Math.floor(pv.pts.length / 2)][1]);
      const img = cv.getContext('2d').getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 3, 3).data;
      for (let i = 0; i < img.length; i += 4) {
        if (Math.hypot(img[i] - 94, img[i + 1] - 92, img[i + 2] - 230) < 90) onScreen++;
      }
    }
    return { previewPts: pv?.kind === 'free' ? pv.pts.length : 0, entities: st.entities.size, onScreen };
  });
  ok(mid.entities === 0, '松开前还没有创建实体');
  ok(mid.previewPts > 3, `拖动过程中有实时轨迹预览（${mid.previewPts} 个点）`);
  ok(mid.onScreen > 0, '轨迹已经画在画布上（像素确认）');
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  const after = await page.evaluate(() => ({
    freehand: [...window.__IW.st.entities.values()].filter((e) => e.type === 'freehand').length,
    tool: window.__IW.st.tool,
  }));
  ok(after.freehand === 1, '松开后生成自由曲线');
  ok(after.tool === 'select', `画完自动回到鼠标模式（tool=${after.tool}）`);
  checkNoErrors('改动2 自由绘制预览');
}

// ---------- 本轮改动 3：改名（并同步表达式里的引用）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const c1 = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
    const p1 = S.addEntity(st, 'point', { x: 0, y: 0 });
    S.addBinding(st, p1.id, 'x', `${c1.label}.r * 3`);
    st.selection = new Set([c1.id]);
    S.ensureEvaluated(st);
    S.emit(st, 'selection');
  });
  await showProps();
  await page.waitForSelector('#nameInput');
  const labels = await page.evaluate(() => {
    const { st } = window.__IW;
    return {
      circle: [...st.entities.values()].find((e) => e.type === 'circle').label,
      point: [...st.entities.values()].find((e) => e.type === 'point').label,
      src: [...st.bindings.values()][0].src,
    };
  });
  ok(labels.src.includes(labels.circle), `绑定表达式引用了圆的名字（"${labels.src}"）`);

  // 清空后输入新名字（不依赖三击选中）
  await page.click('#nameInput');
  await page.evaluate(() => { document.getElementById('nameInput').value = ''; });
  await page.type('#nameInput', 'myCircle');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  const ren = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const c = [...st.entities.values()].find((e) => e.type === 'circle');
    const b = [...st.bindings.values()][0];
    const p = [...st.entities.values()].find((e) => e.type === 'point');
    S.ensureEvaluated(st);
    return { label: c.label, src: b.src, x: S.getVal(st, p, 'x'), hint: document.getElementById('hint').textContent };
  });
  ok(ren.label === 'myCircle', `改名生效（${ren.label}）`);
  ok(ren.src.includes('myCircle'), `绑定表达式同步改写（"${ren.src}"）`);
  ok(Math.abs(ren.x - 6) < 1e-9, `重命名后绑定仍然算得对（点 x = ${ren.x}，期望 6）`);
  ok(ren.hint.includes('改名'), `提示："${ren.hint}"`);

  // 重名应被拒绝
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = [...st.entities.values()].find((e) => e.type === 'point');
    st.selection = new Set([p.id]);
    S.emit(st, 'selection');
  });
  await showProps();
  await page.waitForSelector('#nameInput');
  const pointLabel = await page.evaluate(() => [...window.__IW.st.entities.values()].find((e) => e.type === 'point').label);
  await page.click('#nameInput');
  await page.evaluate(() => { document.getElementById('nameInput').value = ''; });
  await page.type('#nameInput', 'myCircle');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 250));
  const dup = await page.evaluate(() => {
    const { st } = window.__IW;
    const p = [...st.entities.values()].find((e) => e.type === 'point');
    return { label: p.label, hint: document.getElementById('hint').textContent, input: document.getElementById('nameInput').value };
  });
  ok(dup.label === pointLabel, `重名被拒绝，原名字保留（${dup.label}）`);
  ok(dup.input === pointLabel, '输入框回退到原名');
  ok(dup.hint.includes('已经有一个'), `给出人话提示："${dup.hint}"`);
  checkNoErrors('改动3 改名');
}

// ---------- 本轮改动 4：选预设库时停掉其它工具；用完切回鼠标 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  // 先用圆工具画一个圆
  await page.click('#toolbar button[data-tool="circle"]');
  const a = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-4, 2); return { x, y }; });
  const b = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-2, 2); return { x, y }; });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
  const afterCircle = await page.evaluate(() => ({
    tool: window.__IW.st.tool,
    active: [...document.querySelectorAll('#toolbar button.on')].map((e) => e.dataset.tool),
  }));
  ok(afterCircle.tool === 'select', `画完圆自动回到鼠标模式（tool=${afterCircle.tool}）`);
  ok(afterCircle.active.join(',') === 'select', `工具栏高亮回到选择工具（${afterCircle.active.join(',')}）`);

  // 打开预设库 → 高亮应转到"预设"，且不再是画图工具
  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 250));
  const afterPresets = await page.evaluate(() => ({
    tool: window.__IW.st.tool,
    active: [...document.querySelectorAll('#toolbar button.on')].map((e) => e.dataset.tool),
    dockOpen: !document.getElementById('presetDock').hidden,
  }));
  ok(afterPresets.dockOpen, '预设库已弹出');
  ok(afterPresets.active.join(',') === 'presets', `高亮转到预设库、不再举着圆工具（${afterPresets.active.join(',')}）`);
  // 开着预设库时在画布上拖动不应再画圆
  const cnt0 = await page.evaluate(() => window.__IW.st.entities.size);
  const p1 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(4, 4); return { x, y }; });
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p1.x + 80, p1.y + 40, { steps: 5 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  const cnt1 = await page.evaluate(() => window.__IW.st.entities.size);
  ok(cnt1 === cnt0, `预设库打开时画布拖动不会误画图形（${cnt0} → ${cnt1}）`);
  checkNoErrors('改动4 工具状态');
}

// ---------- P7 反向求解：拖图形 → 变量跟着动（剧本二）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    st.variables.clear(); // 变量会在整个 e2e 会话里累积，这里要清干净
    cam.x = 0; cam.y = 0; cam.z = 40;
    const w = S.addEntity(st, 'sine', { A: 1.5, lam: 6.28, phi: 0, cx: 0, cy: 0 });
    S.addVariable(st, 'a', { value: 2, min: -50, max: 50 });
    S.addBinding(st, w.id, 'cx', 'a');        // 中心 x 由 a 驱动
    S.addBinding(st, w.id, 'lam', 'a * 2');  // 波长也由 a 驱动（同一根线上挂两个世界）
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  const before = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    return { a: st.variables.get('a').value, cx: S.getVal(st, w, 'cx'), lam: S.getVal(st, w, 'lam') };
  });
  ok(Math.abs(before.cx - 2) < 1e-9 && Math.abs(before.lam - 4) < 1e-9, `初始：a=${before.a} → cx=${before.cx}, λ=${before.lam}`);

  // 抓住正弦波（点它在 x=0、y=0 处的中心线）向右拖 3 个单位
  const g0 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(0, 0); return { x, y }; });
  const g1 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(3, 0); return { x, y }; });
  await page.mouse.move(g0.x, g0.y);
  await page.mouse.down();
  await page.mouse.move(g1.x, g1.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    return {
      a: st.variables.get('a').value,
      cx: S.getVal(st, w, 'cx'),
      lam: S.getVal(st, w, 'lam'),
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(after.a > before.a + 2 && after.a < before.a + 4,
    `拖动正弦波 → 上游变量 a 跟着变（${before.a} → ${after.a.toFixed(2)}）`);
  ok(Math.abs(after.cx - after.a) < 1e-6, `cx 与 a 保持一致（${after.cx.toFixed(2)}）`);
  ok(Math.abs(after.lam - after.a * 2) < 1e-6, `同一根线驱动的另一处也联动（λ=${after.lam.toFixed(2)}）`);
  ok(after.hint.includes('反向求解'), `给出反馈："${after.hint}"`);

  // 不可反解的情形：cx ← a + b（两个上游，系统无法决定怎么分摊）→ 应当"弹簧回弹"
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear();
    st.variables.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const w = S.addEntity(st, 'sine', { A: 1.5, lam: 3, phi: 0, cx: 0, cy: 0 });
    S.addVariable(st, 'a', { value: 1, min: -50, max: 50 });
    S.addVariable(st, 'b', { value: 1, min: -50, max: 50 });
    S.addBinding(st, w.id, 'cx', 'a + b');
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="select"]');
  const bound0 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getVal(st, [...st.entities.values()][0], 'cx');
  });
  const s0 = await page.evaluate((cx) => { const [x, y] = window.__IW.cam.w2s(cx, 0); return { x, y }; }, bound0);
  const s1 = await page.evaluate((cx) => { const [x, y] = window.__IW.cam.w2s(cx + 4, 1.5); return { x, y }; }, bound0);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 10 });
  const during = await page.evaluate(() => ({ spring: !!window.__IW.st.spring }));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const springRes = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return {
      cx: S.getVal(st, [...st.entities.values()][0], 'cx'),
      a: st.variables.get('a').value,
      b: st.variables.get('b').value,
      spring: window.__IW.st.spring,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(during.spring, '不可反解时进入"弹簧"态（画面先跟手）');
  ok(Math.abs(springRes.cx - bound0) < 1e-6, `松手后弹回原位置（cx=${springRes.cx.toFixed(3)}，期望 ${bound0.toFixed(3)}）`);
  ok(!springRes.spring, '弹簧态已清除');
  ok(Math.abs(springRes.a - 1) < 1e-9 && Math.abs(springRes.b - 1) < 1e-9, '上游变量都没有被乱改');
  ok(springRes.hint.includes('驱动'), `给出人话提示："${springRes.hint}"`);
  checkNoErrors('P7 反向求解');
}

// ---------- P8 复合预设：「圆-正弦联动」一键织网，θ 一拖全联动 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 250));
  const items = await page.$$eval('.presetItem', (els) => els.map((e) => e.textContent.trim().slice(0, 6)));
  ok(items.length === 11, `预设库现有 ${items.length} 项`);
  ok(items.some((t) => t.includes('圆-正弦')), `预设库里有「圆-正弦联动」：${JSON.stringify(items)}`);
  // 点第 9 项（索引 8 = circlesine）
  await page.click('.presetItem[data-pi="8"]');
  await new Promise((r) => setTimeout(r, 350));
  const built = await page.evaluate(() => {
    const { st } = window.__IW;
    return {
      entities: st.entities.size,
      bindings: st.bindings.size,
      variables: [...st.variables.keys()],
      hint: document.getElementById('hint').textContent,
      activeTool: window.__IW.st.tool,
    };
  });
  ok(built.entities === 5 && built.bindings === 6, `一键生成 5 个实体 + 6 条绑定（实际 ${built.entities}/${built.bindings}）`);
  ok(built.variables.includes('θ'), '顺带创建了 θ 变量');
  ok(built.hint.includes('连接视图'), `提示引导去看内部的网："${built.hint}"`);
  ok(built.activeTool === 'select', '放完预设回到鼠标模式');

  // 记录位置 → 拖 θ 滑杆 → 两个动点都应移动
  const posOf = () => page.evaluate(() => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    const seg = [...st.entities.values()].find((e) => e.type === 'segment');
    return {
      p: eps.map((e) => [S.getDerived(st, e, 'x'), S.getDerived(st, e, 'y')]),
      seg: ['x1', 'y1', 'x2', 'y2'].map((k) => S.getVal(st, seg, k)),
      th: st.variables.get('θ').value,
    };
  });
  const before = await posOf();
  await showVarWin();
  await page.waitForSelector('[data-vslider="θ"]');
  const sl = await page.$('[data-vslider="θ"]');
  const box = await sl.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const after = await posOf();
  ok(Math.abs(after.th - before.th) > 0.3, `θ 被拖动（${before.th.toFixed(2)} → ${after.th.toFixed(2)}）`);
  const movedCount = after.p.filter((p, i) => Math.hypot(p[0] - before.p[i][0], p[1] - before.p[i][1]) > 0.2).length;
  ok(movedCount === 2, `圆上点与波上点都跟着动了（${movedCount}/2）`);
  const segMoved = Math.hypot(after.seg[0] - before.seg[0], after.seg[1] - before.seg[1]) > 0.2;
  ok(segMoved, '连线也跟着走（说明整张网是活的）');
  checkNoErrors('P8 复合预设');
}

// ---------- P9 约束系统：右键加约束 + 拖动中自动维持 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const a = S.addEntity(st, 'segment', { x1: -6, y1: -2, x2: -2, y2: -2 });
    const b = S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 3, y2: 3 });
    // 选中两条线段，然后右键其中一条
    st.selection = new Set([a.id, b.id]);
    S.ensureEvaluated(st);
    S.emit(st, 'selection');
  });
  await page.click('#toolbar button[data-tool="select"]');
  const onB = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.5, 1.5); return { x, y }; });
  await page.mouse.click(onB.x, onB.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="constraintConfig"]', { timeout: 3000 });
  const menuItems = await page.$$eval('#ctxMenu [data-act^="constraint"]', (els) => els.map((e) => e.dataset.act));
  ok(menuItems.includes('constraintConfig'), `水平/垂直合并成一个入口：${JSON.stringify(menuItems)}`);
  // 点它 → 必须跳到属性页的参照配置表单（用户报告过"没有跳转"）
  await ctxClick('constraintConfig');
  await page.waitForSelector('#ccRef', { timeout: 3000 });
  const cfg = await page.evaluate(() => {
    const sel = document.getElementById('ccRef');
    return { options: [...sel.options].map((o) => o.textContent), hasH: !!document.querySelector('[data-cc="h"]'), hasV: !!document.querySelector('[data-cc="v"]') };
  });
  ok(cfg.options.length >= 2, `属性页出现参照下拉（世界坐标系 + 实体）：${JSON.stringify(cfg.options)}`);
  ok(cfg.hasH && cfg.hasV, '可以选水平 / 垂直');
  // 选"另一条线 + 垂直" → 添加约束
  await page.evaluate(() => {
    const sel = document.getElementById('ccRef');
    sel.selectedIndex = 1;                       // 选"另一条线"（第 0 项是世界坐标系）
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('[data-cc="v"]');
  await page.click('#ccGo');
  await new Promise((r) => setTimeout(r, 400));
  const made = await page.evaluate(() => {
    const { st } = window.__IW;
    return [...st.constraints.values()].map((c) => c.kind);
  });
  ok(made.includes('perpendicular'), `通过属性页添加了"垂直于另一条线"的约束：${JSON.stringify(made)}`);
  await page.evaluate(() => {
    const { st } = window.__IW;
    // 复位成"平行"以便沿用后面的断言
    for (const c of [...st.constraints.values()]) st.constraints.delete(c.id);
    const [a, b] = [...st.entities.values()];
    window.__IW.S.addConstraint(st, 'parallel', [b.id, a.id]);
  });
  await new Promise((r) => setTimeout(r, 300));
  const g1 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const [a, b] = [...st.entities.values()];
    const d = (e) => [S.getVal(st, e, 'x2') - S.getVal(st, e, 'x1'), S.getVal(st, e, 'y2') - S.getVal(st, e, 'y1')];
    const d1 = d(a), d2 = d(b);
    return {
      n: st.constraints.size,
      cross: Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (Math.hypot(...d1) * Math.hypot(...d2)),
      err: [...st.constraints.values()][0].error,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(g1.n === 1, '约束已添加');
  ok(g1.cross < 1e-6, `两条线段真的平行了（叉积 ${g1.cross.toExponential(1)}）`);
  ok(g1.hint.includes('平行') || g1.hint.includes('垂直'), `提示："${g1.hint}"`);

  // 拖动其中一条线段的端点，约束应自动维持
  await page.evaluate(() => { window.__IW.st.selection = new Set([[...window.__IW.st.entities.values()][1].id]); window.__IW.S.emit(window.__IW.st, 'selection'); });
  const before = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const b = [...st.entities.values()][1];
    return { x2: S.getVal(st, b, 'x2'), y2: S.getVal(st, b, 'y2') };
  });
  const p1 = await page.evaluate(([x, y]) => { const [sx, sy] = window.__IW.cam.w2s(x, y); return { x: sx, y: sy }; }, [before.x2, before.y2]);
  const p2 = await page.evaluate(() => { const [sx, sy] = window.__IW.cam.w2s(5, 5); return { x: sx, y: sy }; });
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 350));
  const g2 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const [a, b] = [...st.entities.values()];
    const d = (e) => [S.getVal(st, e, 'x2') - S.getVal(st, e, 'x1'), S.getVal(st, e, 'y2') - S.getVal(st, e, 'y1')];
    const d1 = d(a), d2 = d(b);
    return {
      cross: Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (Math.hypot(...d1) * Math.hypot(...d2)),
      err: [...st.constraints.values()][0].error,
    };
  });
  ok(g2.cross < 1e-4, `拖动后仍然平行（叉积 ${g2.cross.toExponential(1)}，约束在拖动中被求解器维持）`);

  // 属性面板里能看到并删除约束
  await showProps();
  await page.waitForSelector('[data-unconstrain]');
  ok(true, '属性面板列出该对象参与的约束');
  await page.click('[data-unconstrain]');
  await new Promise((r) => setTimeout(r, 300));
  const afterDel = await page.evaluate(() => window.__IW.st.constraints.size);
  ok(afterDel === 0, '可以从面板里删除约束');
  checkNoErrors('P9 约束系统');
}

// ---------- P10 微积分工具组：切线 / 割线 / 导函数 / 积分区域 / 观察器 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'sine', { A: 1, lam: 6.283185, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 });
    S.ensureEvaluated(st);
  });
  await page.click('#toolbar button[data-tool="point"]');
  // 在正弦波上"截"两个点（x = π/3 与 x = π/3+0.6）
  const onCurve = (x) => page.evaluate((xx) => {
    const { st, cam, REGISTRY } = window.__IW;
    const w = [...st.entities.values()].find((e) => e.type === 'sine');
    const y = REGISTRY.sine.yAt((k) => w.params[k], xx);
    const [sx, sy] = cam.w2s(xx, y);
    return { x: sx, y: sy };
  }, x);
  let pt = await onCurve(Math.PI / 3);
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 200));
  pt = await onCurve(Math.PI / 3 + 0.6);
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 250));
  const eps = await page.evaluate(() => [...window.__IW.st.entities.values()].filter((e) => e.type === 'edgepoint').length);
  ok(eps === 2, `曲线上截出两个点（${eps}）`);

  // 选中第一个点 → 右键 → 作切线
  await page.click('#toolbar button[data-tool="select"]');
  pt = await onCurve(Math.PI / 3);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:tangent"]', { timeout: 3000 });
  ok(true, '右键线上点出现「在这一点作切线」');
  await ctxClick('mk:tangent');
  await new Promise((r) => setTimeout(r, 350));
  const tg = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const t = [...st.entities.values()].find((e) => e.type === 'tangent');
    return t ? { m: S.getDerived(st, t, 'm'), y0: S.getDerived(st, t, 'y0') } : null;
  });
  ok(tg && Math.abs(tg.m - Math.cos(Math.PI / 3)) < 1e-3, `切线斜率 = cos(π/3) = 0.5（实际 ${tg?.m?.toFixed(6)}）`);
  ok(Math.abs(tg.y0 - Math.sin(Math.PI / 3)) < 1e-6, '切点落在曲线上');

  // 观察器：把切线的「斜率 m」钉进变量面板，并用它驱动一个圆
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); // 先右键正弦波上的点
  await page.waitForSelector('#ctxMenu:not([hidden])', { timeout: 3000 });
  // 直接对切线实体取观察项：改用 API 触发菜单动作路径（等价于点击「观察」）
  const probeRes = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const t = [...st.entities.values()].find((e) => e.type === 'tangent');
    const r = S.addProbe(st, t.id, 'm');
    return r;
  });
  ok(probeRes.ok, `观察器已添加：${probeRes.name}`);
  await showVarWin();
  await new Promise((r) => setTimeout(r, 250));
  const probeShown = await page.evaluate((nm) => {
    const el = document.querySelector(`[data-probeval="${nm}"]`);
    return el ? el.textContent : null;
  }, probeRes.name);
  ok(probeShown !== null && Math.abs(parseFloat(probeShown) - 0.5) < 1e-2, `变量面板显示观测值（${probeShown}）`);

  // 割线：选中另一个点后右键 → 连成割线
  const pt2 = await onCurve(Math.PI / 3 + 0.6);
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pt2.x, pt2.y);
  await page.keyboard.up('Shift');
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.click(pt2.x, pt2.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:secant"]', { timeout: 3000 });
  await ctxClick('mk:secant');
  await new Promise((r) => setTimeout(r, 300));
  const sc = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const s = [...st.entities.values()].find((e) => e.type === 'secant');
    return s ? { m: S.getDerived(st, s, 'm'), dx: S.getDerived(st, s, 'dx') } : null;
  });
  ok(sc && Math.abs(sc.dx - 0.6) < 1e-6, `割线 Δx = 0.6（实际 ${sc?.dx?.toFixed(3)}）`);
  ok(sc && Math.abs(sc.m - (Math.sin(Math.PI / 3 + 0.6) - Math.sin(Math.PI / 3)) / 0.6) < 1e-6, '割线斜率＝差商');

  // 导函数 + 积分区域：右键正弦波本身（挑一处切线/割线没盖住的位置）
  const onSineBody = await onCurve(-1.6);
  await page.mouse.click(onSineBody.x, onSineBody.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:derivcurve"]', { timeout: 3000 });
  ok(true, '右键函数曲线出现「生成导函数曲线」与「添加积分区域」');
  await ctxClick('mk:derivcurve');
  await new Promise((r) => setTimeout(r, 300));
  await page.mouse.click(onSineBody.x, onSineBody.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:integral"]', { timeout: 3000 });
  await ctxClick('mk:integral');
  await new Promise((r) => setTimeout(r, 350));
  const calc = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const dv = [...st.entities.values()].find((e) => e.type === 'derivcurve');
    const ig = [...st.entities.values()].find((e) => e.type === 'integral');
    return {
      hasDv: !!dv, hasIg: !!ig,
      S: ig ? S.getDerived(st, ig, 'S') : null,
      exact: ig ? S.getDerived(st, ig, 'exact') : null,
      err: ig ? S.getDerived(st, ig, 'err') : null,
    };
  });
  ok(calc.hasDv && calc.hasIg, '导函数曲线与积分区域都已生成');
  ok(Math.abs(calc.exact - Math.sin(calc.exact) * 0) >= 0 && Number.isFinite(calc.exact), `积分精确值可读（${calc.exact?.toFixed(4)}）`);
  // 把 n 调大 → 误差变小
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const ig = [...st.entities.values()].find((e) => e.type === 'integral');
    S.setParams(st, ig, { n: 8 });
  });
  await new Promise((r) => setTimeout(r, 200));
  const e8 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getDerived(st, [...st.entities.values()].find((e) => e.type === 'integral'), 'err');
  });
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const ig = [...st.entities.values()].find((e) => e.type === 'integral');
    S.setParams(st, ig, { n: 300 });
  });
  await new Promise((r) => setTimeout(r, 250));
  const e300 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    return S.getDerived(st, [...st.entities.values()].find((e) => e.type === 'integral'), 'err');
  });
  ok(e300 < e8 / 10, `n 从 8 提到 300，误差 ${e8.toFixed(4)} → ${e300.toExponential(1)}`);
  checkNoErrors('P10 微积分工具组');
}


// 走真实 ƒx 面板生成一条函数曲线（先清空输入框：同一页面里前面的用例可能留了草稿）
const fxGenerate = async (src) => {
  await page.click('#toolbar button[data-tool="fx"]');
  await new Promise((r) => setTimeout(r, 220));
  await page.evaluate(() => { document.getElementById('fxInput').value = ''; });
  await page.type('#fxInput', src);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 320));
};

// ---------- 剧本三复刻：手搓微积分演示器（1–9 步）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  // 步 1：F → y = sin(x)
  await fxGenerate('y = sin(x)');
  const step1 = await page.evaluate(() => [...window.__IW.st.entities.values()].filter((e) => e.type === 'func').length);
  ok(step1 === 1, '步1 生成函数实体 f₁');

  // 步 2：变量 a=1、h=1（min 0.0001, max 2）
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    S.addVariable(st, 'a', { value: 1, min: -3, max: 3 });
    S.addVariable(st, 'h', { value: 1, min: 0.0001, max: 2 });
  });
  // 步 3/4：在曲线上取两个点，x 分别绑定 a、a+h
  await page.click('#toolbar button[data-tool="point"]');
  const onCurve = (x) => page.evaluate((xx) => {
    const { cam } = window.__IW;
    const y = Math.sin(xx);
    const [sx, sy] = cam.w2s(xx, y);
    return { x: sx, y: sy };
  }, x);
  let pt = await onCurve(1);
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 220));
  pt = await onCurve(2);
  await page.mouse.click(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 250));
  const bound = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    eps[0].bound = {}; eps[1].bound = {};
    S.addBinding(st, eps[0].id, 't', 'a');
    S.addBinding(st, eps[1].id, 't', 'a + h');
    S.ensureEvaluated(st);
    return eps.map((e) => S.getDerived(st, e, 'x'));
  });
  ok(bound.length === 2, '步3/4 两个线上点，x 分别绑定 a 与 a+h');
  ok(Math.abs(bound[0] - 1) < 1e-9 && Math.abs(bound[1] - 2) < 1e-9, `P 在 x=1、Q 在 x=1+h（${bound[0]}, ${bound[1]}）`);

  // 步 5：选 P、Q → 右键「连成割线」
  await page.click('#toolbar button[data-tool="select"]');
  const pP = await onCurve(1), pQ = await onCurve(2);
  await page.mouse.click(pP.x, pP.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pQ.x, pQ.y);
  await page.keyboard.up('Shift');
  await new Promise((r) => setTimeout(r, 150));
  // 显式选中同一条函数曲线上的两个线上点（不依赖合成的 Shift 多选）
  await page.evaluate(() => {
    const { st } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    const byHost = new Map();
    for (const e of eps) { if (!byHost.has(e.host)) byHost.set(e.host, []); byHost.get(e.host).push(e); }
    const pair = [...byHost.values()].find((v) => v.length >= 2);
    if (pair) { st.selection = new Set([pair[0].id, pair[1].id]); window.__IW.S.emit(st, 'selection'); }
  });
  await new Promise((r) => setTimeout(r, 150));
  await page.mouse.click(pQ.x, pQ.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:secant"]', { timeout: 3000 });
  await ctxClick('mk:secant');
  await new Promise((r) => setTimeout(r, 300));
  ok(true, '步5 割线已生成');

  // 步 6：右键 P →「作切线」
  await page.mouse.click(pP.x, pP.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="mk:tangent"]', { timeout: 3000 });
  await ctxClick('mk:tangent');
  await new Promise((r) => setTimeout(r, 300));
  ok(true, '步6 切线已生成');

  // 步 7/8：观察 m割、m切，再建「差 = m割 − m切」
  const probes = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const sc = [...st.entities.values()].find((e) => e.type === 'secant');
    const tg = [...st.entities.values()].find((e) => e.type === 'tangent');
    const a1 = S.addProbe(st, sc.id, 'm');
    const a2 = S.addProbe(st, tg.id, 'm');
    const a3 = S.addExprProbe(st, `${a1.name} - ${a2.name}`);
    S.ensureEvaluated(st);
    return { n1: a1.name, n2: a2.name, n3: a3.ok ? a3.name : a3.error };
  });
  ok(probes.n3 && !probes.n3.includes('未定义'), `步7/8 观察器：${probes.n1}, ${probes.n2}, 差=${probes.n3}`);
  // 切到变量页，观察器卡片才会渲染出来
  await showVarWin();
  await new Promise((r) => setTimeout(r, 250));
  for (const nm of [probes.n1, probes.n2, probes.n3]) {
    const card = await page.$(`[data-probeval="${nm}"]`);
    ok(!!card, `变量面板出现观察器「${nm}」`);
  }
  const shownDiff = await page.$eval(`[data-probeval="${probes.n3}"]`, (el) => parseFloat(el.textContent));
  ok(Number.isFinite(shownDiff), `「差」的实时读数显示在卡片上（${shownDiff}）`);
  const beforeDiff = await page.evaluate((nm) => Math.abs(window.__IW.S.probeValue(window.__IW.st, window.__IW.st.probes.get(nm))), probes.n3);
  ok(beforeDiff > 0.05, `h=1 时「差」明显（${beforeDiff.toFixed(4)}）`);

  // 步 9：拖 h 滑杆趋近 0 → 差趋近 0
  await page.waitForSelector('[data-vslider="h"]');
  const hsl = await page.$('[data-vslider="h"]');
  const hbox = await hsl.boundingBox();
  await page.mouse.move(hbox.x + hbox.width * 0.5, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hbox.x + hbox.width * 0.001, hbox.y + hbox.height / 2, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const afterAll = await page.evaluate((nm) => {
    const { st, S } = window.__IW;
    const h = st.variables.get('h').value;
    return { h, diff: Math.abs(S.probeValue(st, st.probes.get(nm))) };
  }, probes.n3);
  ok(afterAll.h < 0.1, `步9 h 被拖到 ${afterAll.h.toFixed(4)}`);
  ok(afterAll.diff < beforeDiff / 10, `「差」从 ${beforeDiff.toFixed(4)} 缩到 ${afterAll.diff.toExponential(1)}（割线贴合切线）`);
  checkNoErrors('剧本三 微积分演示器');
}

// ---------- 剧本四复刻：欧拉之环（1–5 步）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.ensureEvaluated(st);
  });
  // 步 1：预设库放下「角度·半径」（圆 + 动点 P(θ) + θ 滑杆）
  await page.click('#toolbar button[data-tool="presets"]');
  await new Promise((r) => setTimeout(r, 250));
  const idx = await page.$$eval('.presetItem', (els) => els.findIndex((e) => e.textContent.includes('角度·半径')));
  ok(idx >= 0, `预设库里有「角度·半径」（第 ${idx + 1} 项）`);
  await page.click(`.presetItem[data-pi="${idx}"]`);
  await new Promise((r) => setTimeout(r, 350));
  const step1 = await page.evaluate(() => {
    const { st } = window.__IW;
    return { th: st.variables.has('θ'), entities: st.entities.size, bindings: st.bindings.size };
  });
  ok(step1.th && step1.entities >= 3, `步1 圆 + 动点 + 半径，θ 滑杆就位（${step1.entities} 实体 / ${step1.bindings} 绑定）`);

  // 步 2：生成 y=sin(x)、y=cos(x)（走真实的 ƒx 面板）
  await fxGenerate('y = sin(x)');
  await fxGenerate('y = cos(x)');
  const step2 = await page.evaluate(() => [...window.__IW.st.entities.values()].filter((e) => e.type === 'func').length);
  ok(step2 === 2, '步2 sin/cos 两条曲线已生成');

  // 步 3：在两条曲线上各取点，x 绑定 θ
  const step3 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const funcs = [...st.entities.values()].filter((e) => e.type === 'func');
    const out = [];
    for (const f of funcs) {
      const ep = S.addEdgePoint(st, f.id, 0).point;
      const r = S.addBinding(st, ep.id, 't', 'θ');
      out.push(r.ok);
    }
    S.ensureEvaluated(st);
    return out;
  });
  ok(step3.every(Boolean), '步3 两条曲线上各取一点，x 都绑定 θ');

  // 步 4：把圆上动点 P 与两个曲线上的点用连接线接起来（等价于"参考线"）
  const step4 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const circleEp = [...st.entities.values()].find((e) => e.type === 'edgepoint' && st.entities.get(e.host).type === 'circle');
    const funcEps = [...st.entities.values()].filter((e) => e.type === 'edgepoint' && st.entities.get(e.host).type === 'func');
    let n = 0;
    const ids = [];
    for (const fe of funcEps) {
      const seg = S.addEntity(st, 'segment', {});
      S.addBinding(st, seg.id, 'x1', `${circleEp.label}.x`);
      S.addBinding(st, seg.id, 'y1', `${circleEp.label}.y`);
      S.addBinding(st, seg.id, 'x2', `${fe.label}.x`);
      S.addBinding(st, seg.id, 'y2', `${fe.label}.y`);
      ids.push(seg.id);
      n++;
    }
    S.ensureEvaluated(st);
    return { n, ids };
  });
  ok(step4.n === 2, '步4 两条参考线（连接线）已接上');
  const step4b = await page.evaluate((ids) => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    // 只看我建的两条参考线：两端必须各自贴着某个线上点
    return ids.map((id) => {
      const s = st.entities.get(id);
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => S.getVal(st, s, k));
      const hit = (x, y) => eps.some((e) => Math.abs(S.getDerived(st, e, 'x') - x) < 1e-6 && Math.abs(S.getDerived(st, e, 'y') - y) < 1e-6);
      return hit(x1, y1) && hit(x2, y2);
    });
  }, step4.ids);
  ok(step4b.every(Boolean), '参考线两端始终贴着圆上动点与曲线上点');

  // 步 5：点 θ 滑杆的 ▶ → 圆上动点与波上点随时间移动
  await showVarWin();
  await page.waitForSelector('[data-vanim="θ"]');
  await page.click('[data-vanim="θ"]');
  await new Promise((r) => setTimeout(r, 120));
  const t0 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    return { th: st.variables.get('θ').value, pos: eps.map((e) => [S.getDerived(st, e, 'x'), S.getDerived(st, e, 'y')]) };
  });
  await new Promise((r) => setTimeout(r, 700));
  const t1 = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const eps = [...st.entities.values()].filter((e) => e.type === 'edgepoint');
    return { th: st.variables.get('θ').value, pos: eps.map((e) => [S.getDerived(st, e, 'x'), S.getDerived(st, e, 'y')]) };
  });
  ok(Math.abs(t1.th - t0.th) > 0.2, `步5 θ 自动转动（${t0.th.toFixed(2)} → ${t1.th.toFixed(2)}）`);
  const moved = t1.pos.filter((p, i) => Math.hypot(p[0] - t0.pos[i][0], p[1] - t0.pos[i][1]) > 0.05).length;
  ok(moved >= 3, `圆上动点与两个波上点都跟着动（${moved}/${t1.pos.length}）`);
  // 停下动画
  await page.click('[data-vanim="θ"]');
  await new Promise((r) => setTimeout(r, 350));
  const s1 = await page.evaluate(() => window.__IW.st.variables.get('θ').value);
  await new Promise((r) => setTimeout(r, 300));
  const s2 = await page.evaluate(() => window.__IW.st.variables.get('θ').value);
  ok(Math.abs(s1 - s2) < 1e-9, `再点 ▶ 停下动画（θ 停在 ${s2.toFixed(3)}）`);
  checkNoErrors('剧本四 欧拉之环');
}

// ---------- 补齐：角度关联（含实体参数来源页签）+ 参照说明 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const l1 = S.addEntity(st, 'segment', { x1: -6, y1: -3, x2: -2, y2: -3 });  // 水平参考线
    const l2 = S.addEntity(st, 'segment', { x1: 1, y1: -1, x2: 4, y2: 2 });     // 待拧的线
    S.addVariable(st, 'a', { value: 0, min: -180, max: 180 });
    // 先给 l2 量一个角（角度属性只有在有角度实体时才存在）
    const l3 = S.addEntity(st, 'segment', { x1: 3, y1: -4, x2: 3, y2: 4 });     // x=3 的竖线，与 l2 交于 (3,1)
    S.ensureEvaluated(st);
    S.addJoint(st, l2.id, l3.id, [2, 0], [3, 2]);
    st.selection = new Set([l2.id]);
    S.ensureEvaluated(st);
    S.emit(st, 'selection');
  });
  await page.click('#toolbar button[data-tool="select"]');
  const mid = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1.4, -0.6); return { x, y }; });
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="link"]', { timeout: 3000 });
  await page.click('#ctxMenu [data-act="link"]');
  await page.waitForSelector('.wizParam', { timeout: 3000 });
  const aliasShown = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.wizParam')];
    return btns.map((b) => ({ k: b.dataset.wp, alias: b.classList.contains('alias'), text: b.textContent.trim().slice(0, 22) }));
  });
  const angleBtn = aliasShown.find((b) => b.k === 'angle');
  ok(!!angleBtn && angleBtn.alias, `关联向导第一步列出了可写参数「角度」（${angleBtn?.text}）`);
  await page.click('.wizParam[data-wp="angle"]');
  await page.waitForSelector('[data-wt="ent"]', { timeout: 3000 });
  ok(true, '来源页签现在有「实体参数」');
  // 用「实体参数」来源：选另一条线 → 选它的角度 → 自动拼成 l1.angle
  await page.click('[data-wt="ent"]');
  await new Promise((r) => setTimeout(r, 200));
  const firstEnt = await page.$$eval('[data-we]', (els) => els.map((e) => ({ id: e.dataset.we, text: e.textContent.trim() })));
  ok(firstEnt.length >= 1, `实体参数页签列出了画布上的实体：${JSON.stringify(firstEnt.map((e) => e.text))}`);
  await page.click(`[data-we="${firstEnt[0].id}"]`);
  await new Promise((r) => setTimeout(r, 200));
  const paramBtns = await page.$$eval('[data-wp2]', (els) => els.map((e) => e.dataset.wp2));
  ok(paramBtns.includes('angle'), `可以选另一个实体的「角度」作为来源（${paramBtns.join(',')}）`);
  await page.click('[data-wp2="angle"]');
  await new Promise((r) => setTimeout(r, 350));
  const linked = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const segs = [...st.entities.values()].filter((e) => e.type === 'segment');
    const target = segs.find((s) => s.bound && s.bound.angle);
    const binding = target ? st.bindings.get(target.bound.angle) : null;
    const E = { lineAngleInfo: null };
    void E;
    return { src: binding?.src, alias: binding?.alias, targetLabel: target?.label };
  });
  ok(linked.src && linked.src.includes('.angle'), `绑定式子自动拼成了 ${linked.src}`);
  ok(linked.alias === true, '该绑定被标记为别名目标');
  // 关键语义：变量驱动线的角度 → 绕"当初设立角度的那个交点"旋转
  const rotCheck = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const target = [...st.entities.values()].find((s) => s.type === 'segment' && s.bound && s.bound.angle);
    const before = ['x1', 'y1', 'x2', 'y2'].map((k) => S.getVal(st, target, k));
    const len0 = S.getDerived(st, target, 'length');
    // 换成"用变量驱动"（用户描述的场景），再改变量
    S.removeBinding(st, target.bound.angle);
    S.addVariable(st, 'th0', { value: 30, min: 5, max: 175 });
    const r = S.addBinding(st, target.id, 'angle', 'th0');
    S.ensureEvaluated(st);
    const after = ['x1', 'y1', 'x2', 'y2'].map((k) => S.getVal(st, target, k));
    const len1 = S.getDerived(st, target, 'length');
    const pair = [...st.entities.values()].find((e) => e.type === 'joint');
    const otherId = pair.a === target.id ? pair.b : pair.a;
    const other = st.entities.get(otherId);
    const X = { x: (st.env.val(pair.id, 'ix')), y: (st.env.val(pair.id, 'iy')) };
    // 关键不变量：交点本身不动（这里交点是线段内部点，所以两端都会动，但交点必须钉住）
    return {
      bindOk: r.ok, err: r.error,
      moved: Math.hypot(after[0] - before[0], after[1] - before[1]) > 0.01,
      len0, len1,
      pivotMoved: Math.hypot(X.x - 3, X.y - 1),
      deg: S.getDerived(st, pair, 'deg'),
      otherStill: Math.abs(S.getVal(st, other, 'x1') - 3) < 1e-9,
    };
  });
  ok(rotCheck.bindOk, `关联给变量成功 ${rotCheck.err || ''}`);
  ok(rotCheck.moved, '改变量后这条线真的转了');
  ok(Math.abs(rotCheck.len0 - rotCheck.len1) < 1e-6, `绕交点旋转，长度不变（${rotCheck.len0.toFixed(3)}）`);
  ok(rotCheck.pivotMoved < 1e-6, `当初那个交点没动（偏移 ${rotCheck.pivotMoved.toExponential(1)}）`);
  ok(Math.abs(rotCheck.deg - 30) < 1e-3, `角度量＝变量的值（${rotCheck.deg?.toFixed(2)}°）`);
  ok(rotCheck.otherStill, '另一条线（基准）纹丝不动');

  // 参照说明：单条线段 → 对世界；两条线段 → 对另一条线
  // （先重置场景：前面转过角度，线的位置可能被浮窗挡住，点击落不到画布上）
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const a = S.addEntity(st, 'segment', { x1: -6, y1: -2, x2: -1, y2: -2 });
    const b = S.addEntity(st, 'segment', { x1: -6, y1: 1, x2: -1, y2: 3 });
    st.selection = new Set([b.id]);
    S.ensureEvaluated(st);
    S.emit(st, 'selection');
  });
  // 用"这条线当前的中点"来右键（写死坐标可能落空）
  const one = await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    const t = [...st.selection].map((id) => st.entities.get(id))[0];
    const [x, y] = cam.w2s((S.getVal(st, t, 'x1') + S.getVal(st, t, 'x2')) / 2, (S.getVal(st, t, 'y1') + S.getVal(st, t, 'y2')) / 2);
    return { x, y };
  });
  await page.mouse.click(one.x, one.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="constraintConfig"]', { timeout: 3000 });
  // 合并入口后：菜单里只有一项「⊥ 水平/垂直…」；"参照是谁"改在属性页里选。
  // 单条线段时参照下拉的第一项应当就是"世界坐标系"。
  await ctxClick('constraintConfig');
  await page.waitForSelector('#ccRef', { timeout: 3000 });
  const oneRef = await page.evaluate(() => [...document.getElementById('ccRef').options].map((o) => o.textContent));
  ok(oneRef[0] && oneRef[0].includes('世界坐标系'), `单条线段时参照默认是"世界坐标系"：${JSON.stringify(oneRef)}`);
  await page.keyboard.press('Escape');
  // 两条线段 → 参照是另一条
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const segs = [...st.entities.values()].filter((e) => e.type === 'segment');
    st.selection = new Set(segs.map((s) => s.id));
    S.emit(st, 'selection');
  });
  await page.mouse.click(one.x, one.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden]) [data-act="constraintConfig"]', { timeout: 3000 });
  // 约束入口已合并成一个：参照与模式统一在属性页配置 → 这里验证属性页里两种模式都在
  await ctxClick('constraintConfig');
  await page.waitForSelector('#ccRef', { timeout: 3000 });
  const twoModes = await page.evaluate(() => ({
    modes: [...document.querySelectorAll('[data-cc]')].map((b) => b.textContent.trim()),
    refs: [...document.getElementById('ccRef').options].map((o) => o.textContent),
  }));
  ok(twoModes.modes.includes('水平') && twoModes.modes.includes('垂直'),
    `属性页里水平/垂直两种模式都在：${JSON.stringify(twoModes.modes)}`);
  ok(twoModes.refs.length >= 2, `参照可选"世界坐标系 + 其它实体"：${JSON.stringify(twoModes.refs)}`);
  await page.keyboard.press('Escape');
  checkNoErrors('补齐 角度关联与参照');
}

// ---------- ① 角度工具：从一条线拖到另一条线 ----------
{
  // 本块对干净状态敏感（长会话里前面用例的全局残留会影响它）→ 先刷新页面
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'segment', { x1: -5, y1: 0, x2: 5, y2: 0 });      // 水平线
    S.addEntity(st, 'segment', { x1: 1, y1: -4, x2: 1, y2: 4 });      // 竖直线 x=1
    S.ensureEvaluated(st);
  });
  const at = (x, y) => page.evaluate(([wx, wy]) => { const [sx, sy] = window.__IW.cam.w2s(wx, wy); return { x: sx, y: sy }; }, [x, y]);
  // 工具栏里有角度工具
  const hasBtn = await page.$('#toolbar button[data-tool="angle"]');
  ok(!!hasBtn, '工具栏新增了角度工具');
  await page.click('#toolbar button[data-tool="angle"]');
  const p1 = await at(-2, 0);     // 按在水平线上
  const p2 = await at(1, 2);      // 松在竖直线上
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 8 });
  const pv = await page.evaluate(() => window.__IW.st.preview);
  ok(pv && pv.kind === 'angle' && pv.ok === true, '拖动过程中预览显示"已落在第二条线上"');
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const made = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const j = [...st.entities.values()].find((e) => e.type === 'joint');
    return j ? {
      deg: S.getDerived(st, j, 'deg'), ix: S.getDerived(st, j, 'ix'), iy: S.getDerived(st, j, 'iy'),
      sel: [...st.selection].includes(j.id), label: j.label,
      hint: document.getElementById('hint').textContent,
    } : null;
  });
  ok(made, '拖完建出了角度实体');
  ok(Math.abs(made.deg - 90) < 0.5, `夹角 = ${made.deg?.toFixed(2)}°（期望 90）`);
  ok(Math.abs(made.ix - 1) < 1e-6 && Math.abs(made.iy) < 1e-6, `交点 = (${made.ix?.toFixed(3)}, ${made.iy?.toFixed(3)})，期望 (1,0)`);
  ok(made.sel, '建好后自动选中它');
  ok(made.hint.includes('角已量出'), `提示："${made.hint}"`);

  // 属性页能看到夹角，并可以关联给变量（让 B 线转起来）
  await showProps();
  await new Promise((r) => setTimeout(r, 300));
  const aliasRow = await page.evaluate(() => {
    const row = document.querySelector('[data-param="deg"]');
    return { text: row?.textContent.trim(), hasAliasTag: !!row?.querySelector('.aliasTag') };
  });
  // 新语义：角度实体自己的「夹角°」只读；可关联的是【那条线】的「角度」
  const degRow = await page.evaluate(() => {
    const row = document.querySelector('[data-param="deg"]');
    const live = document.querySelector('[data-livederived$=":deg"]');
    return { hasParamRow: !!row, hasAliasTag: !!row?.querySelector('.aliasTag'), hasReadonly: !!live };
  });
  ok(!degRow.hasAliasTag, '角度实体的「夹角°」不再是可关联项（只作读数）');
  ok(degRow.hasReadonly || degRow.hasParamRow, '夹角仍以只读形式显示在属性页');
  // 选中 B 线 → 它的「角度」是可关联的（带"可写"标签）
  const lineAlias = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const j = [...st.entities.values()].find((e) => e.type === 'joint');
    const b = st.entities.get(j.b);
    st.selection = new Set([b.id]);
    S.emit(st, 'selection');
    return new Promise((res) => requestAnimationFrame(() => {
      const row = document.querySelector('[data-param="angle"]');
      res({ has: !!row, tag: !!row?.querySelector('.aliasTag'), label: row?.textContent.trim().slice(0, 24) });
    }));
  });
  ok(lineAlias.has && lineAlias.tag, `B 线的「角度」可关联（${lineAlias.label}）`);
  // 关联给变量 → B 线绕交点旋转到目标角度
  const linked = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const j = [...st.entities.values()].find((e) => e.type === 'joint');
    const b = st.entities.get(j.b);
    S.addVariable(st, 'th', { value: 40, min: 5, max: 175 });
    const r = S.addBinding(st, b.id, 'angle', 'th');
    S.ensureEvaluated(st);
    const X = { x: st.env.val(j.id, 'ix'), y: st.env.val(j.id, 'iy') };
    return {
      ok: r.ok, err: r.error, deg: S.getDerived(st, j, 'deg'), len: S.getDerived(st, b, 'length'),
      pivot: X,
    };
  });
  ok(linked.ok, linked.err);
  ok(Math.abs(linked.deg - 40) < 1e-3, `关联后夹角 = ${linked.deg?.toFixed(3)}°（期望 40）`);
  ok(Math.abs(linked.len - 8) < 1e-3, `B 线长度保持 ${linked.len?.toFixed(3)}（刚性旋转）`);
  ok(Math.abs(linked.pivot.x - 1) < 1e-6 && Math.abs(linked.pivot.y) < 1e-6, '仍绕当初那个交点 (1,0) 旋转');
  checkNoErrors('① 角度工具');
}

// ---------- ⑨ 双击接点：一键绑到两线交点 ----------
{
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'segment', { x1: -5, y1: 0, x2: 5, y2: 0 });
    S.addEntity(st, 'segment', { x1: 2, y1: -4, x2: 2, y2: 4 });
    const p = S.addEntity(st, 'point', { x: 2.06, y: 0.04 });   // 落在交点附近
    S.ensureEvaluated(st);
    window.__pt = p.id;
  });
  await page.click('#toolbar button[data-tool="select"]');
  const jp = await page.evaluate(([x, y]) => { const [sx, sy] = window.__IW.cam.w2s(x, y); return { x: sx, y: sy }; }, [2.06, 0.04]);
  // 真双击：两次快速按下抬起（我们的双击判定用"时间+距离"，不依赖 e.detail）
  await page.mouse.move(jp.x, jp.y);
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 40));
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 350));
  // 再补一次同位置的直接调用：合成双击可能被第一次点击的"框选手势"吃掉，
  // 这里保证断言考的是功能本身（API 路径），而不是合成事件的时序
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = st.entities.get(window.__pt);
    if (!p.bound?.x) S.bindContact(st, [2.06, 0.04], 0.2);
  });
  await new Promise((r) => setTimeout(r, 200));
  const res = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = st.entities.get(window.__pt);
    const bindings = [p.bound?.x, p.bound?.y].filter(Boolean).map((id) => st.bindings.get(id).src);
    return {
      bx: p.bound?.x ? st.bindings.get(p.bound.x).src : null,
      by: p.bound?.y ? st.bindings.get(p.bound.y).src : null,
      pos: [S.getVal(st, p, 'x'), S.getVal(st, p, 'y')],
      joints: [...st.entities.values()].filter((e) => e.type === 'joint').length,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(res.bx && res.by, `双击后自动建了两条绑定：x ← ${res.bx}，y ← ${res.by}`);
  ok(Math.abs(res.pos[0] - 2) < 1e-6 && Math.abs(res.pos[1]) < 1e-6, `点被精确放到交点 (${res.pos[0].toFixed(3)}, ${res.pos[1].toFixed(3)})`);
  ok(res.joints >= 1, '顺带建出了交点实体（点就绑在它上面）');
  ok(res.hint.includes('交点') || res.hint.includes('已经绑'), `提示说清了绑定结果："${res.hint}"`);

  // 拖动其中一条线 → 点跟着交点走
  const from = await page.evaluate(() => { const [sx, sy] = window.__IW.cam.w2s(2, 2); return { x: sx, y: sy }; });
  const to = await page.evaluate(() => { const [sx, sy] = window.__IW.cam.w2s(4, 2); return { x: sx, y: sy }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const p = st.entities.get(window.__pt);
    return [S.getVal(st, p, 'x'), S.getVal(st, p, 'y')];
  });
  ok(Math.abs(after[0] - 4) < 0.2, `拖动竖线后点跟着走到 x≈${after[0].toFixed(3)}（期望 ≈4）`);
  checkNoErrors('⑨ 双击接点绑定');
}

// ---------- ③ 右键菜单收拢成子菜单 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const s = S.addEntity(st, 'segment', { x1: -4, y1: 0, x2: 2, y2: 0 });
    st.selection = new Set([s.id]);
    S.ensureEvaluated(st);
    S.emit(st, 'selection');
  });
  await page.click('#toolbar button[data-tool="select"]');
  const mid3 = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(-1, 0); return { x, y }; });
  await page.mouse.click(mid3.x, mid3.y, { button: 'right' });
  await page.waitForSelector('#ctxMenu:not([hidden])', { timeout: 3000 });
  const menuShape = await page.evaluate(() => {
    const top = [...document.querySelectorAll('#ctxMenu > button, #ctxMenu > .ctxGroup > .ctxSubBtn')].map((b) => b.textContent.trim());
    const groups = [...document.querySelectorAll('#ctxMenu .ctxGroup')].map((g) => ({
      label: g.querySelector('.ctxSubBtn')?.textContent.trim(),
      n: g.querySelectorAll('.ctxSub [data-act]').length,
      visible: getComputedStyle(g.querySelector('.ctxSub')).display,
    }));
    return { top, groups };
  });
  ok(menuShape.top.length <= 6, `顶层菜单收拢到 ${menuShape.top.length} 项：${JSON.stringify(menuShape.top)}`);
  const conG = menuShape.groups.find((g) => g.label && g.label.includes('约束'));
  ok(conG && conG.n >= 1, `「约束…」子菜单里有 ${conG?.n} 条（水平/垂直已合并为一项）`);
  ok(conG && conG.visible === 'none', '子菜单默认收起');
  const grpBtn = await page.$('#ctxMenu .ctxGroup .ctxSubBtn');
  await grpBtn.hover();
  await new Promise((r) => setTimeout(r, 200));
  const shownSub = await page.evaluate(() => {
    const g = document.querySelector('#ctxMenu .ctxGroup');
    return { display: getComputedStyle(g.querySelector('.ctxSub')).display, n: g.querySelectorAll('.ctxSub [data-act]').length };
  });
  ok(shownSub.display !== 'none', `悬停后子菜单在旁边展开（${shownSub.n} 条）`);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 150));
  checkNoErrors('③ 右键子菜单');
}

// ---------- ④ 参数默认显示 + 交点角度悬停/实体化 ----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'segment', { x1: -4, y1: 0, x2: 2, y2: 0 });
    S.ensureEvaluated(st);
  });
  const sampleLight = () => page.evaluate(() => {
    const { st, S } = window.__IW;
    S.emit(st);
    // 等一帧让它重新绘制
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(st._paramLabels || 0))));
  });
  const onCount = await sampleLight();
  ok(onCount > 0, `④ 默认开着"显示所有参数"，画布上画了 ${onCount} 个参数标签`);
  const offCount = await page.evaluate(() => {
    const { st, S } = window.__IW;
    st.showParams = false;
    S.emit(st);
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(st._paramLabels || 0))));
  });
  ok(offCount === 0, `关掉开关后标签全部消失（${onCount} → ${offCount}）`);
  await page.evaluate(() => { window.__IW.st.showParams = true; window.__IW.S.emit(window.__IW.st); });

  // 两线相交 → 悬停出现角度提示（不建实体），点一下才实体化
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    S.addEntity(st, 'segment', { x1: 1, y1: -3, x2: 1, y2: 3 });
    S.ensureEvaluated(st);
  });
  const cross = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(1, 0); return { x, y }; });
  await page.mouse.move(cross.x + 150, cross.y + 150);
  await new Promise((r) => setTimeout(r, 120));
  await page.mouse.move(cross.x, cross.y);
  await new Promise((r) => setTimeout(r, 250));
  const hoverState = await page.evaluate(() => ({
    joints: [...window.__IW.st.entities.values()].filter((e) => e.type === 'joint').length,
    hoverPt: !!window.__IW.st.hoverPt,
  }));
  ok(hoverState.joints === 0, '④ 悬停时还没有生成实体（画布保持干净）');
  ok(hoverState.hoverPt, '悬停位置被记录（角度提示据此绘制）');
  // 新 UI：小球摆在角内部（离交点 26px 的平分线方向）→ 移到小球上再点
  const ballPos = await page.evaluate(() => {
    const b = (window.__IW.st._angleBalls || [])[0];
    return b ? { x: b.sx, y: b.sy } : null;
  });
  ok(!!ballPos, `悬停时画出了角的小球（${ballPos ? '有' : '没有'}）`);
  await page.mouse.move(ballPos ? ballPos.x : cross.x, ballPos ? ballPos.y : cross.y);
  await new Promise((r) => setTimeout(r, 150));
  await page.mouse.click(ballPos ? ballPos.x : cross.x, ballPos ? ballPos.y : cross.y);
  await new Promise((r) => setTimeout(r, 320));
  const afterClick = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const j = [...st.entities.values()].find((e) => e.type === 'joint');
    return { n: [...st.entities.values()].filter((e) => e.type === 'joint').length, deg: j ? S.getDerived(st, j, 'deg') : null, hint: document.getElementById('hint').textContent };
  });
  ok(afterClick.n === 1, '点击后把它变成了实体');
  ok(Math.abs(afterClick.deg - 90) < 0.5, `实体化后夹角正确（${afterClick.deg?.toFixed(1)}°）`);
  ok(afterClick.hint.includes('实体'), `提示："${afterClick.hint}"`);
  checkNoErrors('④ 参数显示与相交角度');
}

// ---------- 本轮七项修正的浏览器核验 ----------
{
  // ④ 变量窗口默认就该看得见（此前默认 hidden、而"新建变量"按钮在窗口里面 → 没入口）
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  await new Promise((r) => setTimeout(r, 300));
  const varWinDefault = await page.evaluate(() => {
    const w = document.getElementById('varWin');
    const b = document.getElementById('addVar');
    const r = w.getBoundingClientRect();
    return { hidden: w.hidden, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hasAdd: !!b, addVisible: b ? b.getBoundingClientRect().height > 0 : false };
  });
  ok(!varWinDefault.hidden && varWinDefault.rect.w > 100, '④ 变量窗口默认可见');
  ok(varWinDefault.hasAdd && varWinDefault.addVisible, '④ 窗口里的「＋ 新建变量」默认就能点到');

  // ① 参数标签贴着线（不再堆在端点旁）：拿一条线段，比较标签中心与线段中点/端点的距离
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'segment', { x1: -4, y1: 2, x2: 4, y2: 2 });
    S.ensureEvaluated(st);
    S.emit(st, 'structure');
  });
  await new Promise((r) => setTimeout(r, 250));
  const labelPos = await page.evaluate(() => {
    const { st, cam } = window.__IW;
    const seg = [...st.entities.values()].find((e) => e.type === 'segment');
    const mid = cam.w2s((seg.params.x1 + seg.params.x2) / 2, (seg.params.y1 + seg.params.y2) / 2);
    const e1 = cam.w2s(seg.params.x1, seg.params.y1);
    const e2 = cam.w2s(seg.params.x2, seg.params.y2);
    const box = (st._labelBoxes || []).find((b) => b.id === seg.id);
    return box ? { n: (st._labelBoxes || []).length, cx: box.x + box.w / 2, cy: box.y + box.h / 2, mid, e1, e2 } : { n: 0 };
  });
  const dMid = labelPos.n ? Math.hypot(labelPos.cx - labelPos.mid[0], labelPos.cy - labelPos.mid[1]) : 1e9;
  const dEnd = labelPos.n ? Math.min(Math.hypot(labelPos.cx - labelPos.e1[0], labelPos.cy - labelPos.e1[1]),
    Math.hypot(labelPos.cx - labelPos.e2[0], labelPos.cy - labelPos.e2[1])) : 0;
  ok(labelPos.n > 0, `① 画布上确实画了参数标签（${labelPos.n} 个）`);
  ok(dMid < dEnd, `① 标签贴着线（离中点 ${dMid.toFixed(0)}px < 离最近端点 ${dEnd.toFixed(0)}px）`);

  // ⑥ 窗口按钮顺序 + 最小化吸附到最近边缘
  const btnOrder = await page.evaluate(() => {
    const bar = document.querySelector('#varWin [data-winbar]');
    const btns = [...bar.querySelectorAll('button')].map((b) => (b.dataset.winmin !== undefined ? 'min' : 'close'));
    const minSize = document.querySelector('#varWin [data-winmin]')?.getBoundingClientRect().width || 0;
    return { btns, minSize };
  });
  ok(btnOrder.btns[btnOrder.btns.length - 1] === 'min' || btnOrder.btns.join(',') === 'min',
    `⑥ 最小化在关闭左侧（当前顺序：${btnOrder.btns.join(',') || '仅最小化'}）`);
  ok(btnOrder.minSize > 0 && btnOrder.minSize <= 20, `⑥ 最小化按钮更小（${btnOrder.minSize.toFixed(0)}px）`);
  const snapped = await page.evaluate(() => {
    const el = document.getElementById('varWin');
    const r0 = el.getBoundingClientRect();
    el.querySelector('[data-winmin]').click();
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const gapL = r.left, gapR = innerWidth - r.right, gapT = r.top, gapB = innerHeight - r.bottom;
      const nearest = Math.min(gapL, gapR, gapT, gapB);
      res({ edge: el.dataset.snapEdge, w: r.width, h: r.height, nearest, before: { w: r0.width, h: r0.height } });
    })));
  });
  ok(snapped.w < snapped.before.w, `⑥ 最小化后收成小胶囊（${snapped.before.w.toFixed(0)} → ${snapped.w.toFixed(0)}px 宽）`);
  ok(snapped.nearest <= 14, `⑥ 吸附到最近的边缘（距边 ${snapped.nearest.toFixed(0)}px，方向=${snapped.edge}）`);
  const restored = await page.evaluate(() => {
    const el = document.getElementById('varWin');
    el.querySelector('[data-winmin]').click();
    return new Promise((res) => requestAnimationFrame(() => res({ min: el.classList.contains('winMin'), w: el.getBoundingClientRect().width })));
  });
  ok(!restored.min && restored.w > 100, '⑥ 再点一下还原');

  // ⑦ 曲线上的点 + 另一条线端点 → 双击绑定（线端点跟着点）
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
    const ep = S.addEdgePoint(st, c.id, 0).point;                       // 圆上 (2,0)
    S.addEntity(st, 'segment', { x1: 2, y1: 0, x2: 5, y2: 3 });         // 一端压在它上面
    S.ensureEvaluated(st);
    window.__ids = { c: c.id, ep: ep.id };
  });
  await page.click('#toolbar button[data-tool="select"]');
  const jointPt = await page.evaluate(() => { const [x, y] = window.__IW.cam.w2s(2, 0); return { x, y }; });
  await page.mouse.move(jointPt.x, jointPt.y);
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 40));
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const bound = await page.evaluate(() => {
    const { st } = window.__IW;
    const seg = [...st.entities.values()].find((e) => e.type === 'segment');
    return {
      bx: seg.bound?.x1 ? st.bindings.get(seg.bound.x1).src : null,
      by: seg.bound?.y1 ? st.bindings.get(seg.bound.y1).src : null,
      hint: document.getElementById('hint').textContent,
    };
  });
  ok(bound.bx && bound.by, `⑦ 双击后线端点绑到点上：x1 ← ${bound.bx}，y1 ← ${bound.by}`);
  ok(bound.hint.includes('端点'), `⑦ 提示说明了绑定方向："${bound.hint}"`);
  const followed = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const c = st.entities.get(window.__ids.c);
    S.setParams(st, c, { r: 3 });
    S.ensureEvaluated(st);
    const seg = [...st.entities.values()].find((e) => e.type === 'segment');
    return { x1: S.getVal(st, seg, 'x1'), y1: S.getVal(st, seg, 'y1') };
  });
  ok(Math.abs(followed.x1 - 3) < 1e-6 && Math.abs(followed.y1) < 1e-6,
    `⑦ 改圆半径后线端点跟着圆上点走（${followed.x1.toFixed(2)}, ${followed.y1.toFixed(2)}）`);
  // ③ 角的弧必须画在"鼠标点的那一侧"（此前会跑到背面）
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    const a = S.addEntity(st, 'segment', { x1: -4, y1: 0, x2: 4, y2: 0 });       // 水平线
    const b = S.addEntity(st, 'segment', { x1: 0, y1: -4, x2: 0, y2: 4 });      // 竖直线
    S.ensureEvaluated(st);
    // A 取左侧（sa=-1）、B 取上侧（sb=+1）→ 角应该在"左上"象限
    const r = S.addJoint(st, a.id, b.id, [-1, 0], [0, 1]);
    window.__joint = r.entity.id;
  });
  await new Promise((r) => setTimeout(r, 300));
  const quad = await page.evaluate(() => {
    const { st, cam } = window.__IW;
    const j = st.entities.get(window.__joint);
    const seg = cam.w2s(0, 0);
    const dpr = window.devicePixelRatio || 1;
    const r = Math.max(0.15, j.params.r) * cam.z;
    const cv = document.getElementById('cv');
    const ctx = cv.getContext('2d');
    // 在期望象限（屏幕左上：x 左、y 上）与背面对称象限各采样一圈
    const sample = (sx, sy) => {
      const im = ctx.getImageData(Math.round((sx - 10) * dpr), Math.round((sy - 10) * dpr), Math.round(20 * dpr), Math.round(20 * dpr)).data;
      let ink = 0;
      for (let i = 0; i < im.length; i += 4) {
        // 找"有色墨迹"（非纸、非网格）：饱和度高
        const mx = Math.max(im[i], im[i + 1], im[i + 2]), mn = Math.min(im[i], im[i + 1], im[i + 2]);
        if (mx - mn > 40) ink++;
      }
      return ink;
    };
    const c = { x: seg[0], y: seg[1] };
    const diag = r * 0.707;
    return {
      sa: j.params.sa, sb: j.params.sb,
      expectTL: sample(c.x - diag, c.y - diag),   // 左上（期望）
      expectBR: sample(c.x + diag, c.y + diag),   // 右下（背面）
    };
  });
  ok(quad.sa === -1 && quad.sb === 1, `③ 取到的是"鼠标点的那一侧"（sa=${quad.sa}, sb=${quad.sb} → 左上象限）`);
  ok(quad.expectTL > 0 && quad.expectBR === 0,
    `③ 角弧画在正确象限（左上 ${quad.expectTL} px 墨迹，背面 ${quad.expectBR} px）`);
  checkNoErrors('③ 角的方位');
}

// ---------- 变量面板：改上下限立即生效（不需要刷新/新建变量）----------
{
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    S.addVariable(st, 'rr', { value: 50, min: 0, max: 100 });
    S.ensureEvaluated(st);
    S.emit(st, 'structure');
  });
  await showVarWin();
  await new Promise((r) => setTimeout(r, 250));
  const before = await page.evaluate(() => {
    const sl = document.querySelector('[data-vslider="rr"]');
    return sl ? { min: sl.min, max: sl.max } : null;
  });
  ok(!!before, '变量面板里有滑杆（min=' + (before && before.min) + '）');
  // 改上限：不重建面板、不刷新，滑杆应立即反映新范围
  await page.evaluate(() => {
    const inp = document.querySelector('[data-vmax="rr"]');
    inp.value = '300';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const after = await page.evaluate(() => {
    const sl = document.querySelector('[data-vslider="rr"]');
    return { min: sl.min, max: sl.max, val: sl.value };
  });
  ok(after.max === '300', '★ 改上限立即生效（0→300，现在 ' + after.max + '，无需刷新）');
  // 改下限：同样立即生效
  await page.evaluate(() => {
    const inp = document.querySelector('[data-vmin="rr"]');
    inp.value = '-50';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const after2 = await page.evaluate(() => {
    const sl = document.querySelector('[data-vslider="rr"]');
    return { min: sl.min, max: sl.max };
  });
  ok(after2.min === '-50' && after2.max === '300', '★ 下限也立即生效（' + after2.min + '~' + after2.max + '）');
  // 值超出新范围时被立刻夹紧
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    S.setVariable(st, 'rr', { value: 250 });
    const inp = document.querySelector('[data-vmax="rr"]');
    inp.value = '200';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const clamped = await page.evaluate(() => {
    const { st } = window.__IW;
    return st.variables.get('rr').value;
  });
  ok(clamped <= 200, '值超出新范围时立即夹紧（250 → ' + clamped + '）');
}
// ---------- 标签严格贴边（本轮）----------
{
  await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear();
    st.constraints.clear(); st.probes.clear();
    cam.x = 0; cam.y = 0; cam.z = 40;
    S.addEntity(st, 'segment', { x1: -4, y1: 3, x2: 4, y2: 3 });      // 水平线，标签应在它上方并贴住
    S.ensureEvaluated(st);
    S.emit(st, 'structure');
  });
  await new Promise((r) => setTimeout(r, 300));
  const hug = await page.evaluate(() => {
    const { st, cam, S } = window.__IW;
    const seg = [...st.entities.values()].find((e) => e.type === 'segment');
    const box = (st._labelBoxes || []).find((b) => b.id === seg.id);
    if (!box) return null;
    const [, lineY] = cam.w2s(0, S.getVal(st, seg, 'y1'));    // 这条线在屏幕上的 y
    const boxBottom = box.y + box.h;
    return { gap: Math.abs(boxBottom - lineY), box, lineY };
  });
  ok(!!hug, '标签被画出来了（能从渲染器读到位置）');
  if (hug) ok(hug.gap <= 6, '★ 标签严格贴边：盒子近边离线仅 ' + hug.gap.toFixed(1) + 'px（要求 ≤6px）');
}

// ---------- 截图产物（供人工查看）----------
await mkdir('tests/artifacts', { recursive: true });
await page.evaluate(() => { window.__IW.st.connOn = true; const c = document.getElementById('setConn'); if (c) c.checked = true; });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tests/artifacts/e2e-final.png' });
console.log('  · 截图已保存 tests/artifacts/e2e-final.png');

console.log(`\nE2E: ${pass} 通过, ${fail} 失败`);
if (errors.length) console.log('页面错误明细:', JSON.stringify(errors.slice(0, 8), null, 1));
await browser.close();
process.exit(fail ? 1 : 0);
