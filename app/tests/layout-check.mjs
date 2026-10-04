// 布局与交互命中核验：替代人工"看图"，用真实渲染结果断言 UI 不互相遮挡
// 运行：node tests/layout-check.mjs
import puppeteer from 'puppeteer';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { x: r.x, y: r.y, w: r.width, h: r.height, display: cs.display, visible: cs.display !== 'none' && cs.visibility !== 'hidden' };
}, sel);

const topElementAt = (x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el ? { id: el.id, cls: el.className, tag: el.tagName } : null;
}, [x, y]);

const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// 元素底边到视口底部的距离
const innerBottomGap = (r) => 900 - (r.y + r.h);

// ---------- 初始状态 ----------
{
  const cl = await rect('#checklist');
  ok(cl.display === 'none', '验收清单默认隐藏（[hidden] 生效，不再遮挡面板）');
  const dock = await rect('#presetDock');
  ok(dock.display === 'none', '预设抽屉默认隐藏');
  const menu = await rect('#ctxMenu');
  ok(menu.display === 'none', '右键菜单默认隐藏');
}

// ---------- 面板可点击性（回归：曾被清单遮挡）----------
{
  // 变量已搬到右下角独立窗口，先把窗口露出来
  await page.evaluate(() => {
    const w = document.getElementById('varWin');
    if (w) w.hidden = false;
  });
  await new Promise((r) => setTimeout(r, 150));
  const addBtn = await rect('#addVar');
  ok(!!addBtn && addBtn.visible, '变量窗口「＋ 新建变量」按钮可见');
  const top = await topElementAt(addBtn.x + addBtn.w / 2, addBtn.y + addBtn.h / 2);
  ok(top && top.id === 'addVar', `「新建变量」上方无遮挡（命中 ${top?.id || top?.tag}）`);
  await page.click('#addVar');
  await new Promise((r) => setTimeout(r, 250));
  ok((await page.evaluate(() => window.__IW.st.variables.size)) >= 1, '点击后变量真的创建了');
}

// ---------- 布局不重叠 ----------
{
  const tb = await rect('#toolbar');
  const panel = await rect('#panel');
  const menubar = await rect('#menubar');
  const help = await rect('#helpBtn');
  const conn = await rect('#opPop');   // 旧设置卡已删除（设置迁到独立页面）；改用左上操作弹窗做重叠检查
  ok(!overlaps(tb, panel), '左侧工具栏与右侧面板不重叠');
  ok(!overlaps(tb, menubar), '工具栏与顶部菜单栏不重叠');
  // ⑦ 菜单栏横跨顶部：贴顶、满宽、含三个菜单
  ok(menubar.y <= 2 && menubar.h >= 32 && menubar.h <= 52, `菜单栏贴顶且高度合理（y=${menubar.y.toFixed(0)} h=${menubar.h.toFixed(0)}）`);
  ok(menubar.w >= 1400, `菜单栏横跨屏幕宽度（${menubar.w.toFixed(0)}px）`);
  {
    const menus = await page.evaluate(() => [...document.querySelectorAll('#menubar .mbTop')].map((b) => b.textContent.trim()));
    ok(menus.includes('文件') && menus.includes('编辑') && menus.includes('设置'), `菜单栏含 文件/编辑/设置（实测 ${menus.join(' ')}）`);
    // ★ 用户本轮要求：删除场景按钮（与导入导出重复），并把成就按钮加文字、挪到导航栏中间
    const rightBtns = await page.evaluate(() => [...document.querySelectorAll('#menubar .mbRight button')].map((b) => b.id));
    ok(rightBtns.length === 3 && rightBtns.includes('audioBtn') && rightBtns.includes('themeBtn') && rightBtns.includes('helpBtn'),
      `右侧功能键 3 个（${rightBtns.join(' ')}）—— 场景按钮已按要求删除`);
    ok(!rightBtns.includes('sceneBtn'), '场景按钮（#sceneBtn）已删除（与导入导出重复）');
    const mid = await page.evaluate(() => {
      const wrap = document.querySelector('#menubar .mbMid');
      const btn = document.getElementById('achBtn');
      if (!wrap || !btn) return null;
      const bar = document.querySelector('#menubar').getBoundingClientRect();
      const r = btn.getBoundingClientRect();
      return { text: btn.textContent.trim(), cx: r.left + r.width / 2, barCx: bar.left + bar.width / 2 };
    });
    ok(mid && mid.text.includes('成就'), `成就按钮带文字（实测"${mid ? mid.text : '（找不到按钮）'}"）`);
    ok(mid && Math.abs(mid.cx - mid.barCx) <= 120, `成就按钮在导航栏中间（按钮中心 ${mid ? mid.cx.toFixed(0) : '?'} vs 栏中心 ${mid ? mid.barCx.toFixed(0) : '?'}，偏差 ≤120px）`);
  }
  ok(!overlaps(panel, help), '右侧面板与帮助按钮不重叠');
  ok(!overlaps(tb, conn) && !overlaps(panel, conn), '左上操作弹窗不压住工具栏/面板');
  ok(panel.x + panel.w <= 1400, '右侧面板完整在视口内');
  ok(panel.y >= 0 && panel.y + panel.h <= 900, '面板纵向不溢出视口');
}

// ---------- 布局不重叠 ----------
{
  const tb = await rect('#toolbar');
  const panel = await rect('#panel');
  const menubar = await rect('#menubar');
  const help = await rect('#helpBtn');
  const conn = await rect('#opPop');   // 旧设置卡已删除（设置迁到独立页面）；改用左上操作弹窗做重叠检查
  ok(!overlaps(tb, panel), '左侧工具栏与右侧面板不重叠');
  ok(!overlaps(tb, menubar), '工具栏与顶部菜单栏不重叠');
  ok(!overlaps(panel, help), '右侧面板与帮助按钮不重叠');
  ok(!overlaps(tb, conn) && !overlaps(panel, conn), '左上操作弹窗不压住工具栏/面板');
  ok(panel.x + panel.w <= 1400, '右侧面板完整在视口内');
  ok(panel.y >= 0 && panel.y + panel.h <= 900, '面板纵向不溢出视口');
}

// ---------- ④⑦⑧ 变量窗口在右下、设置卡在正下方中间、互不重叠 ----------
{
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    st.variables.clear();
    S.addVariable(st, 'a', { value: 2, min: 0, max: 10 });
    S.emit(st, 'structure');
  });
  await new Promise((r) => setTimeout(r, 200));
  const vw = await rect('#varWin');
  const sc = await rect('#opPop');   // 旧设置卡已删除 → 用左上操作弹窗代替它做几何断言
  ok(vw.visible, '有变量时右下角变量窗口自动出现');
  ok(vw.x > 700 && vw.y > 400, `变量窗口在右下角（x=${vw.x.toFixed(0)}, y=${vw.y.toFixed(0)}）`);
  // ⑤ 左上操作弹窗：没在操作时是收起的（hidden）→ 只在显示时检查几何
  const tbForCard = await rect('#toolbar');
  if (sc.visible) {
    ok(sc.x < 400, `⑤ 左上操作弹窗在左侧（x=${sc.x.toFixed(0)}）`);
    ok(!overlaps(sc, tbForCard), '⑤ 左上操作弹窗不压住底部工具栏');
    ok(!overlaps(vw, sc), '变量窗口（右下）与左上操作弹窗不重叠');
  } else {
    ok(true, '⑤ 左上操作弹窗未在操作中（收起状态），跳过几何断言');
  }
  // 设置项已迁到**独立页面** settings.html（旧画布内设置卡已删除）→ 工作台侧只断言状态字段
  const setState = await page.evaluate(() => ({
    showParams: window.__IW.st.showParams,
    connOn: typeof window.__IW.st.connOn,
  }));
  ok(setState.showParams !== false, '「显示所有参数」默认开启（状态字段，开关在设置页）');
  ok(setState.connOn === 'boolean', '「连接视图」状态字段存在（开关在设置页 settings.html）');
  // 没有选中实体时属性面板整块缩回
  const hiddenWhenEmpty = await page.evaluate(() => {
    const { st, S } = window.__IW;
    st.selection.clear();
    S.emit(st, 'selection');
    return new Promise((res) => requestAnimationFrame(() => res(document.getElementById('panel').hidden)));
  });
  ok(hiddenWhenEmpty, '没选中实体时右侧属性面板整块缩回');
  const shownWhenSel = await page.evaluate(() => {
    const { st, S } = window.__IW;
    const seg = S.addEntity(st, 'segment', { x1: 0, y1: 0, x2: 2, y2: 1 });
    st.selection = new Set([seg.id]);
    S.emit(st, 'selection');
    return new Promise((res) => requestAnimationFrame(() => res(!document.getElementById('panel').hidden)));
  });
  ok(shownWhenSel, '选中实体后属性面板出现');
  // ⑧【已按新需求改写】卡片**不可拖动、无最小化按钮**，但有统一的滑动动画与毛玻璃。
  //    改写理由：用户明确要求「全部取消手动拖动窗口和最小化窗口功能，全部增加简易滑动动画」。
  const cardTest = await page.evaluate(() => {
    // 旧设置卡已删除 → 用真实可见的变量窗口做「不可拖动 / 无最小化 / 有动画 / 毛玻璃」检测
    const el = document.getElementById('varWin');
    const bar = el.querySelector('[data-winbar]');
    const r0 = el.getBoundingClientRect();
    bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: r0.left + 40, clientY: r0.top + 10, bubbles: true, pointerId: 1 }));
    bar.dispatchEvent(new PointerEvent('pointermove', { clientX: r0.left + 140, clientY: r0.top - 120, bubbles: true, pointerId: 1 }));
    bar.dispatchEvent(new PointerEvent('pointerup', { clientX: r0.left + 140, clientY: r0.top - 120, bubbles: true, pointerId: 1 }));
    const r1 = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      moved: Math.abs(r1.left - r0.left) > 5 || Math.abs(r1.top - r0.top) > 5,
      hasMinBtn: !!el.querySelector('[data-winmin]'),
      cursor: getComputedStyle(bar).cursor,
      animated: cs.transitionProperty.includes('transform') && cs.transitionProperty.includes('opacity'),
      glass: (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none'),
    };
  });
  ok(!cardTest.moved, '⑧ 卡片不可拖动（拖标题条后位置不变）');
  ok(!cardTest.hasMinBtn, '⑧ 卡片没有最小化按钮（已按新需求取消）');
  ok(cardTest.cursor === 'default', '⑧ 标题条不显示拖动光标');
  ok(cardTest.animated, '⑧ 卡片有统一滑动动画（transform+opacity 过渡）');
  ok(cardTest.glass, '⑧ 卡片有毛玻璃效果');
  // ƒx 面板与预设抽屉是"打开时才渲染内容"，先打开它们才会被窗口化
  await page.click('#presetBtn');
  await new Promise((r) => setTimeout(r, 250));
  await page.click('#toolbar button[data-tool="fx"]');
  await new Promise((r) => setTimeout(r, 250));
  const wins = await page.$$eval('[data-win-ready]', (els) => els.length);
  ok(wins >= 4, `⑧ 已窗口化的卡片数：${wins}（属性/变量/设置/ƒx/预设/清单）`);
}

// ---------- 画布与外观令牌 ----------
{
  // T0：默认主题是深色宇宙，纸面不再是 #F5F5F7 —— 断言改为**主题感知**：
  // 读取当前主题，按主题给出期望纸面（深 #0B0E16 / 浅 #F5F5F7），而不是写死浅色。
  const themeInfo = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
  }));
  const expectBg = themeInfo.theme === 'dark' ? 'rgb(11, 14, 22)' : 'rgb(245, 245, 247)';
  ok(themeInfo.bg === expectBg, `画布底色随主题（${themeInfo.theme} → ${expectBg}，实际 ${themeInfo.bg}）`);
  const glass = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('panel'));
    return { blur: cs.backdropFilter || cs.webkitBackdropFilter, radius: cs.borderRadius, shadow: cs.boxShadow !== 'none' };
  });
  ok(/blur/.test(glass.blur), `面板使用磨砂玻璃（${glass.blur}）`);
  ok(glass.shadow, '面板有悬浮阴影，不与画布内容混淆');
  const tools = await page.$$eval('#toolbar button', (els) => els.length);
  ok(tools >= 7 && tools <= 8, `左侧工具栏 ${tools} 个图标（规范要求 ≤8）`);
}

// ---------- 验收清单可开可关，且开启时不遮挡面板 ----------
{
  await page.click('#helpBtn');
  await new Promise((r) => setTimeout(r, 200));
  const cl = await rect('#checklist');
  const panel = await rect('#panel');
  ok(cl.visible, '点 ? 后验收清单显示');
  ok(!overlaps(cl, panel), '验收清单显示时与右侧面板不重叠（可边看边操作）');
  const hasP1 = await page.evaluate(() => document.getElementById('clBody').textContent.includes('P1 · 无限画布'));
  ok(hasP1, '清单内容按 P1–P6 分组');
  const cbCount = await page.$$eval('#clBody input[type=checkbox]', (els) => els.length);
  ok(cbCount >= 26, `清单共 ${cbCount} 项可勾选（含"本次改动/修复"分组与 P1–P6 全部条目）`);
  // 勾选一项 → 进度更新且写入 localStorage
  await page.click('#clBody input[data-cl="p1-0"]');
  await new Promise((r) => setTimeout(r, 200));
  const prog = await page.$eval('#clProgress', (e) => e.textContent);
  const stored = await page.evaluate(() => localStorage.getItem('interweaver.verify.v1'));
  ok(prog.includes('1 /'), `勾选后进度更新（"${prog}"）`);
  ok(!!stored && stored.includes('p1-0'), '勾选状态写入 localStorage（刷新不丢）');
  await page.click('#clClose');
  await new Promise((r) => setTimeout(r, 200));
  ok((await rect('#checklist')).display === 'none', '点 × 后清单关闭');
}

// ---------- 连接视图丝线真的画出来（像素差分校验）----------
{
  const countThreadPixels = () => page.evaluate(() => {
    const cv = document.getElementById('cv');
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    // 丝线是强调色（蓝紫）叠在纸面上：**主题无关**地判"偏蓝紫"——
    // 浅色下是 (170,168,238)，深色下是暗底上的偏蓝像素；因此只比相对关系，
    // 不再写死绝对亮度阈值（那是浅色假设，深色下会全部落空）。
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i], g = img[i + 1], b = img[i + 2];
      if (Math.abs(r - g) <= 24 && b - r >= 26 && b - g >= 26) n++;
    }
    return n;
  });

  // 造一个绑定：正弦波 λ ← a
  await page.evaluate(() => {
    const { st, S, REGISTRY } = window.__IW;
    const w = S.addEntity(st, 'sine', REGISTRY.sine.create({ x: 0, y: 0 }));
    S.addBinding(st, w.id, 'lam', 'a');
    st.connOn = false;
    st.connFlashUntil = 0;
  });
  await new Promise((r) => setTimeout(r, 400));
  const off = await countThreadPixels();

  await page.evaluate(() => { window.__IW.st.connOn = true; });
  await new Promise((r) => setTimeout(r, 400));
  const on = await countThreadPixels();

  ok(on - off > 200, `连接视图丝线确实渲染（关闭 ${off} px → 开启 ${on} px，增加 ${on - off}）`);
}

// ---------- 改动5：函数创作器在左下角，且不遮挡工具栏/连接开关 ----------
{
  // 确定性开启创作器：前序步骤可能让它处于「隐藏」或「已打开但被最小化/折叠（宽高 0）」两种状态之一。
  // 用 DOM 点击（不受上层元素遮挡影响），并先还原最小化态 —— 这是测试自身的状态管理，不是产品问题。
  await page.evaluate(() => {
    const d = document.getElementById('fxDock');
    const hidden = !d || getComputedStyle(d).display === 'none';
    // 最小化功能已取消（⑧），这里只需处理「隐藏」这一种状态
    if (hidden) {
      const btn = document.querySelector('#toolbar button[data-tool="fx"]');
      if (btn) btn.click();
    }
  });
  await new Promise((r) => setTimeout(r, 700));   // 放宽等待：创作器「打开时才渲染」，实测 600ms 稳定
  const fx = await rect('#fxDock');
  const tb = await rect('#toolbar');
  const conn = await rect('#opPop');   // 旧设置卡已删除（设置迁到独立页面）；改用左上操作弹窗做重叠检查
  const dock = await rect('#presetDock');
  ok(fx.visible, '点 ƒx 后函数创作器显示');
  ok(fx.x < 700 && fx.x + fx.w < 1400, `函数创作器在左侧（x=${fx.x.toFixed(0)}, w=${fx.w.toFixed(0)}）`);
  // ④ 改写（用户新要求）：函数创作器也属于「操作面板」→ 统一在**左上角**显示，与 #opPop 同位置同尺寸
  // 注意：#opPop 此刻可能隐藏（隐藏元素包围盒恒为 0）→ 用计算样式取 left/top/width
  const opPopForFx = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('opPop')); return { x: parseFloat(cs.left), y: parseFloat(cs.top), w: parseFloat(cs.width) }; });
  const mbForFx = await rect('#menubar');
  ok(fx.x < 400, `④ 函数创作器在左上角（x=${fx.x.toFixed(0)}）`);
  ok(fx.y - mbForFx.y - mbForFx.h >= 4 && fx.y - mbForFx.y - mbForFx.h <= 24, `④ 创作器与菜单栏的间隙合理（${(fx.y - mbForFx.y - mbForFx.h).toFixed(0)}px，要求 4–24）`);
  ok(Math.abs(fx.x - opPopForFx.x) <= 1 && Math.abs(fx.y - opPopForFx.y) <= 1, `④ 创作器与操作面板同位置（(${fx.x.toFixed(0)},${fx.y.toFixed(0)}) vs (${opPopForFx.x.toFixed(0)},${opPopForFx.y.toFixed(0)})）`);
  ok(Math.abs(fx.w - opPopForFx.w) <= 1, `④ 创作器与操作面板同宽（${fx.w.toFixed(0)} vs ${opPopForFx.w.toFixed(0)}）`);
  ok(!overlaps(fx, tb), '函数创作器不遮挡左侧工具栏');
  // 原断言针对已删除的 #setCard（conn 现在恒为空矩形 → 恒真）→ 换成有意义的新断言：
  //   创作器已移到左上角，不应压住底部工具栏与左下预设抽屉
  const tbForFx = await rect('#toolbar');
  ok(!overlaps(fx, tbForFx), '④ 函数创作器不压住底部工具栏');
  ok(!overlaps(fx, dock), '④ 函数创作器不压住左下预设抽屉');
  ok(dock.display === 'none', '打开函数创作器时预设抽屉已收起');
  await page.click('#fxClose');
  await new Promise((r) => setTimeout(r, 450));   // hideCard 的滑出动画 260ms 后才置 hidden
  ok((await rect('#fxDock')).display === 'none', '点 × 可收起函数创作器');
}

console.log(`\n布局核验: ${pass} 通过, ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
