// 「个性化」验收（用户要求，★ 含本轮两处收紧）：
//   ① 每个页面各自的深色/浅色（+ 新账号的成就页默认深色 + 按账号隔离 + 老的全局主题不丢）
//   ② 画布实体颜色：**只在设置里按实体类型**设默认色（选中单个实体的属性面板**不提供**改色）；
//      颜色定制收在「颜色详细定制」折叠里（默认不展开，展开后列表自带滚动条）；
//      老数据里的 colorUser 仍然认（兼容），并且照旧进序列化/草稿/导出
//   ③ 主题切换的**软边横扫**：不是圆、没有明显明暗边界，从左上角漫到右下角；
//      深→浅 与 浅→深 **两个方向都要有**；★ 已经变过来的那半边必须是**真页面**
//      （文字/按钮/画布都在，不是盖一层纯色）—— 用 View Transition 的两张真渲染快照实现，
//      测试里用"菜单栏文字结构 + 红圆像素"来证明；prefers-reduced-motion: reduce → 不播（直接切换）
//   ④ 跨页也要有：浅色画布 → 点进成就页 → **新页面先是浅色**（真页面），再从左上漫到右下（同样是真页面）
//
// 跑法：node tests/check-personalize.mjs   （需要 5188 静态服务在跑；verify 外壳会起好）
// ★ 本检查**不需要后端**：账号隔离那一节直接调 userScope.rememberAuth（api.js 登录成功后
//   调的就是它），所以既能独立跑，也不会往任何真实数据库里写测试账号。
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const WEB = 'http://localhost:5188';
const VW = 1400, VH = 900;
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// ---------- 小工具 ----------
const goto = async (p, opt = {}) => { await page.goto(WEB + '/' + p, { waitUntil: opt.waitUntil || 'networkidle0' }); };
const gotoIndex = async () => { await goto('index.html'); await page.waitForFunction(() => !!window.__IW, { timeout: 15000 }); await wait(350); };
const gotoStarmap = async () => {
  await page.goto(WEB + '/starmap.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#starMap', { timeout: 15000 }).catch(() => {});
  await wait(200);
};
const gotoSettings = async () => { await goto('settings.html'); await page.waitForFunction(() => !!window.__SET, { timeout: 15000 }); await wait(250); };
const openPersonalize = async () => {
  await page.evaluate(() => { const b = document.querySelector('[data-goto="personalize"]'); if (b) b.click(); });
  await page.waitForSelector('[data-iw-personalize]', { timeout: 8000 });
  await wait(150);
};
const themeNow = () => page.evaluate(() => document.documentElement.dataset.theme);
/** 画布取像素：某个世界坐标附近"最接近目标色"的那个像素 */
const canvasProbe = (wx, wy, hex) => page.evaluate(([x, y, h]) => {
  const cv = document.getElementById('cv');
  const g = cv.getContext('2d');
  const cam = window.__IW.cam;
  const scale = cv.width / cam.size().w;
  const [sx, sy] = cam.w2s(x, y);
  const d = g.getImageData(Math.round(sx * scale) - 8, Math.round(sy * scale) - 8, 16, 16).data;
  const t = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  let best = 1e9, hit = null;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - t[0], d[i + 1] - t[1], d[i + 2] - t[2]);
    if (dist < best) { best = dist; hit = [d[i], d[i + 1], d[i + 2]]; }
  }
  return { dist: Math.round(best * 10) / 10, hit: hit.join(',') };
}, [wx, wy, hex]);
/**
 * 截一张图送回浏览器里解码，再量若干点的平均色 + 亮度标准差（浏览器替我们解 PNG，零依赖、零外链）。
 * 平均色用来验横扫的**方向**（左上已变 / 右下未变）；标准差用来验"那一侧是**页面**还是纯色"
 * （纯色层的标准差 ≈ 0；有文字/图形时明显 > 0）。
 */
const shotProbe = async (points) => {
  const b64 = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async ([b64, pts, vw, vh]) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const out = {};
    for (const p of pts) {
      const x = Math.round(p.x / vw * img.width), y = Math.round(p.y / vh * img.height);
      const w = p.w || 7;
      const d = g.getImageData(Math.max(0, Math.min(img.width - w, x - (w >> 1))), Math.max(0, Math.min(img.height - w, y - (w >> 1))), w, w).data;
      let r = 0, gg = 0, b = 0, n = 0;
      const lums = [];
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
        lums.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      }
      const mean = lums.reduce((s, v) => s + v, 0) / Math.max(1, lums.length);
      const sd = Math.sqrt(lums.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, lums.length));
      const item = { rgb: [Math.round(r / n), Math.round(gg / n), Math.round(b / n)], sd: Math.round(sd * 10) / 10 };
      if (p.toward) {                       // 这一小块里**最接近**某个颜色的像素（细线抗锯齿会把它平均掉，所以要取最近邻）
        const t = [parseInt(p.toward.slice(1, 3), 16), parseInt(p.toward.slice(3, 5), 16), parseInt(p.toward.slice(5, 7), 16)];
        let best = 1e9, hit = null;
        for (let i = 0; i < d.length; i += 4) {
          const dist = Math.hypot(d[i] - t[0], d[i + 1] - t[1], d[i + 2] - t[2]);
          if (dist < best) { best = dist; hit = [d[i], d[i + 1], d[i + 2]]; }
        }
        item.best = Math.round(best * 10) / 10;
        item.hit = hit;
      }
      out[p.name] = item;
    }
    return out;
  }, [b64, points, VW, VH]);
};
const DIAG_PTS = Array.from({ length: 9 }, (_, i) => ({ name: 'd' + i, x: 40 + (VW - 80) * i / 8, y: 40 + (VH - 80) * i / 8 }));

// =====================================================================================
console.log('\n① 每页各自的深/浅 + 新账号成就页默认深色 + 按账号隔离');
// =====================================================================================
await goto('settings.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* 忽略 */ } });

await gotoIndex();
const freshIndex = await themeNow();
await gotoStarmap();
const freshStar = await themeNow();
ok(freshIndex === 'light', `出厂：画布是浅色（实测 ${freshIndex}）`);
ok(freshStar === 'dark', `出厂：成就页是**深色**（实测 ${freshStar}）—— 用户要求"新账号默认深色"`);

await gotoSettings();
await openPersonalize();
const pageRows = await page.evaluate(() => [...document.querySelectorAll('[data-iw-page]')].map((s) => s.dataset.iwPage));
ok(['index', 'starmap', 'settings', 'login'].every((id) => pageRows.includes(id)),
  `「个性化」列出了各页面（${pageRows.join('/')}）`);
ok(pageRows.includes('mine'), `新页面自动出现在列表里（含另一个 agent 新增的 mine：${pageRows.join('/')}）`);
await page.select('[data-iw-page="starmap"]', 'light');
await wait(300);
const afterStarLight = await page.evaluate(async () => {
  const P = await import('/src/personalize.js');
  return { setting: P.pageModeSetting('starmap'), keys: P.personalizeDebug().keys };
});
ok(afterStarLight.setting === 'light', `成就页被单独设成浅色（${afterStarLight.setting}）`);
ok(afterStarLight.keys.some((k) => /pagetheme\.starmap$/.test(k)), `按页分键保存（键：${afterStarLight.keys.join(', ')}）`);

await gotoIndex();
await page.click('#themeBtn');
await wait(900);
const canvasDark = await themeNow();
ok(canvasDark === 'dark', `◐ 按钮把画布切到深色（实测 ${canvasDark}）`);
await gotoStarmap();
const starStillLight = await themeNow();
ok(starStillLight === 'light', `成就页仍是它自己那份浅色（实测 ${starStillLight}）—— 每页互不影响`);

await page.reload({ waitUntil: 'networkidle0' });
await wait(600);
const starAfterReload = await themeNow();
await gotoIndex();
const canvasAfterReload = await themeNow();
ok(starAfterReload === 'light' && canvasAfterReload === 'dark',
  `刷新后各自保持（画布 ${canvasAfterReload} / 成就页 ${starAfterReload}）`);

await gotoSettings();
await openPersonalize();
await page.select('[data-iw-global]', 'light');
await wait(200);
await page.select('[data-iw-global]', 'dark');
await wait(300);
await goto('login.html', { waitUntil: 'networkidle0' });
await wait(400);
const legacy = await page.evaluate(() => ({
  loginTheme: document.documentElement.dataset.theme,
  global: localStorage.getItem('interweaver.theme'),
  canvasOwn: localStorage.getItem('interweaver.pagetheme.index'),
  starOwn: localStorage.getItem('interweaver.pagetheme.starmap'),
}));
ok(legacy.global === 'dark', `全局默认写在老的全局键 interweaver.theme 上（${legacy.global}）—— 老键沿用、不做搬迁`);
ok(!!legacy.canvasOwn && legacy.starOwn === 'light', `画布/成就页各自那份仍在（画布 ${legacy.canvasOwn} / 成就页 ${legacy.starOwn}）`);
ok(legacy.loginTheme === 'dark', `没单独设过的页面（登录页）跟随全局默认（${legacy.loginTheme}）—— themeBoot 首绘就定好了`);

await gotoIndex();
const byAccount = await page.evaluate(async () => {
  const U = await import('/src/userScope.js');
  const T = await import('/src/theme.js');
  const P = await import('/src/personalize.js');
  const snap = () => ({
    mode: T.resolvePageMode().mode,
    source: T.resolvePageMode().source,
    star: T.resolvePageMode('starmap').mode,
    starSrc: T.resolvePageMode('starmap').source,
    keys: P.personalizeDebug().keys.slice().sort(),
  });
  U.rememberAuth({ token: 't-a', user: { id: 901, username: '检查用A' } });   // = api.js 登录成功后的入口
  const a0 = snap();
  T.setTheme('dark');
  const a1 = snap();
  U.rememberAuth({ token: 't-b', user: { id: 902, username: '检查用B' } });
  const b = snap();
  U.rememberAuth({ token: 't-a', user: { id: 901, username: '检查用A' } });
  const a2 = snap();
  U.forgetAuth();
  return { a0, a1, b, a2 };
});
ok(byAccount.a0.keys.every((k) => k.startsWith('interweaver.u901.') || /^interweaver\.(auth|scope)\./.test(k)),
  `登录后访客的逐页主题被认领进 A 的命名空间（${byAccount.a0.keys.join(', ')}）`);
ok(byAccount.a1.mode === 'dark', `A 的画布 = 深色（${byAccount.a1.mode}/${byAccount.a1.source}）`);
ok(byAccount.b.mode === 'light' && byAccount.b.source === 'default',
  `换到 B：画布回到默认浅色（${byAccount.b.mode}/${byAccount.b.source}）—— 没继承 A`);
ok(byAccount.b.star === 'dark' && byAccount.b.starSrc === 'default',
  `换到 B：成就页回到**出厂深色**（${byAccount.b.star}/${byAccount.b.starSrc}）`);
ok(byAccount.b.keys.filter((k) => k.startsWith('interweaver.u902.')).length === 0,
  `B 的命名空间里没有任何个性化键（B 名下 ${byAccount.b.keys.filter((k) => k.startsWith('interweaver.u902.')).length} 个）`);
ok(byAccount.a2.mode === 'dark', `切回 A：深色原样回来（${byAccount.a2.mode}/${byAccount.a2.source}）`);

// =====================================================================================
console.log('\n② 实体颜色：只在设置里按类型设（面板不提供改色 + 颜色详细定制默认收起/可滚动）');
// =====================================================================================
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* 忽略 */ } });
await gotoSettings();
await openPersonalize();

// ②-a 「颜色详细定制」默认不展开；展开后列表自带滚动条
const collapsed = await page.evaluate(() => {
  const d = document.querySelector('[data-iw-more]');
  const body = document.querySelector('[data-iw-more-body]');
  return { exists: !!d, open: d ? d.open : null, summary: d ? d.querySelector('summary').textContent.trim().slice(0, 24) : '', rows: body ? body.querySelectorAll('[data-iw-swatches]').length : 0 };
});
ok(collapsed.exists && collapsed.open === false,
  `「颜色详细定制」默认**不展开**（summary=「${collapsed.summary}…」，open=${collapsed.open}）`);
ok(collapsed.rows >= 10, `收起时逐类色板仍在 DOM 里（${collapsed.rows} 类）—— 展开即可编辑`);
await page.evaluate(() => { const d = document.querySelector('[data-iw-more]'); if (d) d.open = true; });
await wait(350);
const expanded = await page.evaluate(() => {
  const body = document.querySelector('[data-iw-more-body]');
  return { rows: body.querySelectorAll('[data-iw-swatches]').length, swatches: body.querySelectorAll('[data-iw-swatch]').length, scrollH: body.scrollHeight, clientH: body.clientHeight, overflowY: getComputedStyle(body).overflowY };
});
ok(expanded.rows >= 10 && expanded.swatches >= 100, `展开后逐类色板都在（${expanded.rows} 类 / ${expanded.swatches} 个色块）`);
ok(expanded.overflowY === 'auto' && expanded.scrollH > expanded.clientH,
  `★ 展开后列表自带滚动条（scrollHeight ${expanded.scrollH} > clientHeight ${expanded.clientH}，overflow-y=${expanded.overflowY}）`);
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '页面不横向溢出');

// ②-b 给「圆」设默认色（真实 UI 点色板）
await page.evaluate(() => {
  const b = document.querySelector('[data-iw-swatches] button[data-iw-kind="circle"][data-iw-swatch="#E5484D"]');
  if (b) b.click();
});
await wait(400);
const typeSet = await page.evaluate(async () => (await import('/src/personalize.js')).typeColor('circle'));
ok(typeSet === '#E5484D', `「圆」的默认色已保存（${typeSet}）`);
ok(await page.evaluate(() => !!document.querySelector('[data-iw-more]')?.open), '改完颜色后折叠面板仍保持展开（不会每改一下就收回去）');

// ②-c 新建的圆必须画成类型默认色；属性面板**没有**颜色行
await gotoIndex();
const byType = await page.evaluate(() => {
  const { st, cam, S } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear();
  st.seq = 1; st.counters = {}; st.colorIdx = 0;
  cam.x = 0; cam.y = 0; cam.z = 60;
  const c = S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 2 });
  S.addEntity(st, 'segment', { x1: -5, y1: -3, x2: -2, y2: -3 });
  st.selection.clear();
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  return { id: c.id, colorField: c.color, colorUser: c.colorUser || null };
});
const pxType = await canvasProbe(2, 0, '#E5484D');
ok(byType.colorUser === null && byType.colorField !== '#E5484D',
  `新建的圆没有"单独特例"（color 字段仍是建实体时分的 ${byType.colorField}）`);
ok(pxType.dist < 40, `新建的圆**真的画成了类型默认色 #E5484D**（圆周像素 rgb(${pxType.hit})，距目标 ${pxType.dist}）`);

await page.evaluate((id) => {
  const { st, S } = window.__IW;
  st.selection = new Set([id]);
  S.emit(st, 'selection');
}, byType.id);
await wait(400);
const panel = await page.evaluate(() => ({
  visible: !document.getElementById('panel').hidden,
  rows: document.querySelectorAll('#panelBody .propRow').length,
  colorRow: !!document.querySelector('[data-iw-colorrow]'),
  swatches: document.querySelectorAll('#panelBody [data-iw-eswatch]').length,
  name: !!document.querySelector('#panelBody #nameInput'),
}));
ok(panel.visible && panel.rows > 0 && panel.name, `属性面板照常显示（${panel.rows} 行，含改名输入框）`);
ok(!panel.colorRow && panel.swatches === 0, `★ 属性面板**不提供**自定义颜色（颜色行 ${panel.colorRow ? 1 : 0} 个、色块 ${panel.swatches} 个）`);

// ②-d 老数据兼容：实体上写着 colorUser 时仍然认（旧场景/旧草稿），并且照旧进序列化
const legacyColor = await page.evaluate(async () => {
  const { st, cam, S } = window.__IW;
  const ent = [...st.entities.values()].find((e) => e.type === 'circle');
  ent.colorUser = '#0A84FF';
  st.selection.clear();
  S.ensureEvaluated(st);
  window.__IW.renderOnce();
  const schema = await import('/src/scenes/schema.js');
  const text = JSON.stringify(schema.serializeScene(st, '检查用场景', cam));
  const rec = JSON.parse(text).entities.find((e) => e.type === 'circle');
  const r = schema.deserializeScene(st, S, text, cam);
  const back = [...st.entities.values()].find((e) => e.type === 'circle');
  return { recColorUser: rec.colorUser || null, okLoad: r.ok, backColorUser: (back && back.colorUser) || null };
});
const pxLegacy = await canvasProbe(2, 0, '#0A84FF');
ok(pxLegacy.dist < 40, `老数据里的 colorUser 仍然生效（圆周像素 rgb(${pxLegacy.hit})，距 #0A84FF ${pxLegacy.dist}）`);
ok(legacyColor.recColorUser === '#0A84FF' && legacyColor.okLoad && legacyColor.backColorUser === '#0A84FF',
  'colorUser 仍进序列化并能还原（老场景/老草稿不会坏）');

// ②-e 调色板对比度（实测）
const contrast = await page.evaluate(async () => {
  const P = await import('/src/personalize.js');
  const T = await import('/src/theme.js');
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const Y = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
  const cr = (a, b) => { const y1 = Math.max(a, b), y2 = Math.min(a, b); return (y1 + 0.05) / (y2 + 0.05); };
  const papers = { light: Y(T.THEMES.light.paper), dark: Y(T.THEMES.dark.paper) };
  return P.PALETTE.map((p) => {
    const y = Y(p.hex);
    return { hex: p.hex, name: p.name, light: Math.round(cr(y, papers.light) * 100) / 100, dark: Math.round(cr(y, papers.dark) * 100) / 100 };
  });
});
const worst = contrast.reduce((m, c) => Math.min(m, c.light, c.dark), 99);
console.log('    ' + contrast.map((c) => `${c.name} ${c.hex} 浅${c.light}/深${c.dark}`).join('  '));
ok(worst >= 3, `调色板每一种色在**深浅两套纸面**上都 ≥ 3:1（最差 ${worst}:1，共 ${contrast.length} 色）`);

// =====================================================================================
console.log('\n③ 软边横扫（View Transition）：不是圆、没有明显边界、左上→右下；两侧都是**真页面**不是纯色');
// =====================================================================================
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await gotoIndex();
// 左上角放一个红圆（实体颜色与主题无关）：用来判断"已经变过来的那半边有没有页面内容"
await page.evaluate(async () => {
  const T = await import('/src/theme.js');
  const P = await import('/src/personalize.js');
  const { st, cam, S } = window.__IW;
  P.setTypeColor('circle', '#E5484D');
  st.entities.clear(); st.bindings.clear(); st.selection.clear(); st.variables.clear(); st.constraints.clear();
  st.seq = 1; st.counters = {}; st.colorIdx = 0;
  cam.x = 0; cam.y = 0; cam.z = 60;
  S.addEntity(st, 'circle', { cx: -8, cy: 5, r: 2 });
  st.selection.clear();
  S.ensureEvaluated(st);
  T.setTheme('light', { animate: false });
  window.__IW.renderOnce();
});
await wait(700);

// ③-a 机制：一次 View Transition + 伪元素上的 mask 动画（真实 420ms）
const sw = await page.evaluate(async () => {
  const T = await import('/src/theme.js');
  const hasVT = typeof document.startViewTransition === 'function';
  const maskOf = () => { try { return getComputedStyle(document.documentElement, '::view-transition-new(root)').maskPosition; } catch (e) { return 'n/a'; } };
  const imgOf = () => { try { return getComputedStyle(document.documentElement, '::view-transition-new(root)').maskImage; } catch (e) { return 'n/a'; } };
  const sizeOf = () => { try { return getComputedStyle(document.documentElement, '::view-transition-new(root)').maskSize; } catch (e) { return 'n/a'; } };
  const vtAnims = () => document.getAnimations()
    .filter((a) => a.effect && /view-transition/.test(a.effect.pseudoElement || ''))
    .map((a) => ({ pseudo: a.effect.pseudoElement, name: a.animationName || null, ms: a.effect.getTiming ? a.effect.getTiming().duration : null }));
  const before = document.documentElement.dataset.theme;
  T.setTheme('dark');                                    // 触发一次"本页样式单独切换"
  const afterSync = document.documentElement.dataset.theme;
  const modeAt0 = T.currentMode();
  await new Promise((r) => setTimeout(r, 60));
  const after60 = document.documentElement.dataset.theme;
  const anims = vtAnims();
  const m60 = maskOf(); const img = imgOf(); const size = sizeOf();
  await new Promise((r) => setTimeout(r, 140));
  const m200 = maskOf();
  await new Promise((r) => setTimeout(r, 900));
  const mEnd = maskOf();
  return { hasVT, before, afterSync, after60, modeAt0, anims, m60, m200, mEnd, img, size, after: document.documentElement.dataset.theme, animsAfter: vtAnims().length };
});
ok(sw.hasVT, '浏览器支持 View Transition（本动画的实现基础；不支持时直接切，不假装播了）');
ok(sw.before === 'light' && (sw.afterSync === 'dark' || sw.after60 === 'dark') && sw.after === 'dark',
  `主题在切换开始后就落定（${sw.before} → ${sw.after60}）—— 画面由旧/新两张**真渲染快照**呈现`);
ok(sw.modeAt0 === 'dark', `currentMode() 立刻就是新选择（${sw.modeAt0}）—— ◐ 按钮/设置镜像不受动画影响`);
ok(sw.anims.some((a) => /view-transition-new/.test(a.pseudo || '') && a.name === 'iw-theme-sweep'),
  `★ 走的是 View Transition：伪元素 ${(sw.anims.find((a) => a.name === 'iw-theme-sweep') || {}).pseudo} 上跑 iw-theme-sweep（${JSON.stringify(sw.anims.map((a) => a.name))}）`);
ok(/linear-gradient/.test(sw.img || '') && !/circle/.test(sw.img || ''),
  `★ 不是圆：新层用**渐变 mask** 揭开（mask-image = ${String(sw.img).slice(0, 56)}…）`);
ok(sw.size === '220% 220%', `mask 放大到 220%（mask-size=${sw.size}）—— 只动 mask-position 就等于"一条柔和的斜带走过去"`);
ok(sw.m60 !== sw.m200 && /%/.test(sw.m60 || ''),
  `中间帧：new 层 mask-position 在动（60ms ${sw.m60} → 200ms ${sw.m200}）`);
ok(sw.animsAfter === 0, `动画结束后没有残留的过渡动画（伪元素动画 ${sw.animsAfter} 条）`);

// ③-b 中间帧的像素证据：已经变过来的半边是**真页面**（有文字/实体），右下还是旧页面；边界柔和
const measure = async (from, to) => {
  await page.evaluate(async ([f, t]) => {
    const T = await import('/src/theme.js');
    T.setTheme(f, { animate: false });
    await new Promise((r) => requestAnimationFrame(r));
    T.setTheme(t, { duration: 1600 });        // 同一条横扫，只是放慢便于截图量化
  }, [from, to]);
  await wait(620);
  const pts = await shotProbe([
    { name: 'tl', x: 60, y: 60, w: 9 },
    { name: 'br', x: VW - 60, y: VH - 60, w: 9 },
    { name: 'menu', x: 34, y: 20, w: 9 },                                  // 左上角的菜单栏文字（页面内容）
    { name: 'circle', x: 218, y: 152, w: 9, toward: '#E5484D' },           // 左上角那个红圆的圆周
    ...DIAG_PTS,
  ]);
  await wait(1500);
  await page.evaluate(async (t) => { const T = await import('/src/theme.js'); T.setTheme(t, { animate: false }); }, to);
  await wait(250);
  return { pts, diag: DIAG_PTS.map((p) => lum(pts[p.name].rgb)) };
};
const near = (rgb, hex, tol) => {
  const t = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return Math.hypot(rgb[0] - t[0], rgb[1] - t[1], rgb[2] - t[2]) <= tol;
};
const fwd = await measure('light', 'dark');
console.log(`    浅→深 中间帧：左上 rgb(${fwd.pts.tl.rgb}) 右下 rgb(${fwd.pts.br.rgb})｜对角线亮度 ${fwd.diag.map((v) => v.toFixed(0)).join(' → ')}`);
ok(lum(fwd.pts.tl.rgb) < 60, `左上角**已经变深**（rgb(${fwd.pts.tl.rgb})）—— 蔓延从左上开始`);
ok(lum(fwd.pts.br.rgb) > 180, `右下角**还是浅色**（rgb(${fwd.pts.br.rgb})）—— 还没漫到`);
ok(fwd.pts.menu.sd > 15, `★ 已经变深的那半边**是页面**：左上菜单栏位置有文字结构（亮度标准差 ${fwd.pts.menu.sd}，纯色层会是 0）`);
ok(fwd.pts.circle.best < 80, `★ 那个红圆在**已经变深**的区域里照样看得见（最近像素 rgb(${fwd.pts.circle.hit})，距 #E5484D ${fwd.pts.circle.best}）—— 不是盖一层纸面色`);
const jumpOf = (d) => Math.max(...d.slice(1).map((v, i) => Math.abs(v - d[i])));
ok(jumpOf(fwd.diag) < 190 && fwd.diag.some((v) => v > 70 && v < 210),
  `★ 边界是**模糊**的：对角线最大相邻跳变 ${jumpOf(fwd.diag).toFixed(0)}（<190，硬边会是 ~230），且存在中间过渡值`);
const backM = await measure('dark', 'light');
console.log(`    深→浅 中间帧：左上 rgb(${backM.pts.tl.rgb}) 右下 rgb(${backM.pts.br.rgb})｜对角线亮度 ${backM.diag.map((v) => v.toFixed(0)).join(' → ')}`);
ok(lum(backM.pts.tl.rgb) > 180 && lum(backM.pts.br.rgb) < 60,
  `★ 反方向也播，方向一致（左上先变浅 rgb(${backM.pts.tl.rgb})、右下还是深的 rgb(${backM.pts.br.rgb})）`);
ok(backM.pts.menu.sd > 15 && backM.pts.circle.best < 90,
  `★ 反方向里"已经变浅"的那半边同样是真页面（菜单栏标准差 ${backM.pts.menu.sd}、红圆最近像素 rgb(${backM.pts.circle.hit}) 距 #E5484D ${backM.pts.circle.best}）`);
ok(jumpOf(backM.diag) < 190, `反方向的边界也模糊（最大相邻跳变 ${jumpOf(backM.diag).toFixed(0)} < 190）`);

// ③-c reduced-motion：不播（直接切，且不建 View Transition）
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const reduced = await page.evaluate(async () => {
  const T = await import('/src/theme.js');
  T.setTheme('light', { animate: false });
  await new Promise((r) => setTimeout(r, 80));
  T.setTheme('dark');
  const seen = [];
  const vtAnims = () => document.getAnimations().filter((a) => a.effect && /view-transition/.test(a.effect.pseudoElement || '')).length;
  for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 40)); seen.push(vtAnims()); }
  return { maxAnims: Math.max(...seen), theme: document.documentElement.dataset.theme };
});
ok(reduced.maxAnims === 0 && reduced.theme === 'dark',
  `prefers-reduced-motion: reduce → **完全不建** View Transition（伪元素动画 ${reduced.maxAnims} 条），主题直接切（${reduced.theme}）`);
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

// =====================================================================================
console.log('\n④ 跨页横扫：浅色画布 → 点进成就页（新页面**先是浅色**，再从左漫到右）');
// =====================================================================================
await page.evaluate(async () => {
  const P = await import('/src/personalize.js');
  const T = await import('/src/theme.js');
  P.resetPersonalize();
  T.reapplyPageTheme({ animate: false });
});
await wait(800);
const beforeJump = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  last: sessionStorage.getItem('interweaver.wipe.v1'),
}));
ok(beforeJump.theme === 'light', `跳转前画布是浅色（${beforeJump.theme}），本标签页"上次画的主题" = ${beforeJump.last}`);

// 新文档一建立就记录：data-theme 的每一次变化 + 新层 mask-position 的中间帧
await page.evaluateOnNewDocument(() => {
  window.__iwThemes = [];
  window.__iwSweep = [];
  const t0 = performance.now();
  const rec = () => {
    const v = document.documentElement && document.documentElement.dataset.theme;
    if (v && window.__iwThemes[window.__iwThemes.length - 1] !== v) window.__iwThemes.push(v);
  };
  try { new MutationObserver(rec).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* 忽略 */ }
  rec();
  const tick = () => {
    let mask = null;
    try { mask = getComputedStyle(document.documentElement, '::view-transition-new(root)').maskPosition; } catch (e) { mask = null; }
    const vt = document.getAnimations().filter((a) => a.effect && /view-transition-new/.test(a.effect.pseudoElement || ''));
    if (vt.length) window.__iwSweep.push({ t: Math.round(performance.now() - t0), mask, name: vt[0].animationName || null });
    if (performance.now() - t0 < 6000 && window.__iwSweep.length < 120) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
  page.click('#achBtn'),
]);
await page.waitForFunction(() => window.__iwSweep && window.__iwSweep.length >= 2, { timeout: 8000 }).catch(() => {});
const cross = await page.evaluate(() => ({
  themes: window.__iwThemes.slice(),
  sweep: window.__iwSweep.slice(0, 6),
  url: location.pathname,
  theme: document.documentElement.dataset.theme,
}));
ok(/starmap\.html$/.test(cross.url), `确实跳到了成就页（${cross.url}）`);
ok(cross.themes[0] === 'light' && cross.themes.length >= 2,
  `★ 新页面**先按上一页的浅色画出来**（data-theme 变化序列 = ${JSON.stringify(cross.themes)}）—— 用户要求"切换到成就页（先是浅色）"`);
ok(cross.theme === 'dark', `漫完之后完全进入成就页（深色，${cross.theme}）`);
ok(cross.sweep.length >= 2, `跳转后新页面真的播了横扫（采到 ${cross.sweep.length} 帧）`);
if (cross.sweep.length >= 2) {
  const a = cross.sweep[0], b = cross.sweep[cross.sweep.length - 1];
  console.log(`    跨页中间帧：${a.t}ms mask-position=${a.mask}（${a.name}）   →   ${b.t}ms mask-position=${b.mask}`);
  ok(a.mask !== b.mask && a.name === 'iw-theme-sweep',
    `跨页用的是同一条软边横扫（${a.name}：mask-position ${a.mask} → ${b.mask}）`);
}
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-personalize-starmap.png' });
await wait(900);
ok(await page.evaluate(() => document.getAnimations().filter((a) => a.effect && /view-transition/.test(a.effect.pseudoElement || '')).length === 0),
  '跨页动画结束后没有残留的过渡动画');

// ④′ 反方向跨页：深色成就页 → 回画布（画布是浅色）→ 也是"先是深色，再漫成浅色"
await page.evaluateOnNewDocument(() => {
  window.__iwThemes2 = [];
  window.__iwSweep2 = [];
  const t0 = performance.now();
  const rec = () => {
    const v = document.documentElement && document.documentElement.dataset.theme;
    if (v && window.__iwThemes2[window.__iwThemes2.length - 1] !== v) window.__iwThemes2.push(v);
  };
  try { new MutationObserver(rec).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* 忽略 */ }
  rec();
  const tick = () => {
    let mask = null;
    try { mask = getComputedStyle(document.documentElement, '::view-transition-new(root)').maskPosition; } catch (e) { mask = null; }
    const vt = document.getAnimations().filter((a) => a.effect && /view-transition-new/.test(a.effect.pseudoElement || ''));
    if (vt.length) window.__iwSweep2.push({ t: Math.round(performance.now() - t0), mask });
    if (performance.now() - t0 < 6000 && window.__iwSweep2.length < 120) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
  page.click('#smClose'),
]);
await page.waitForFunction(() => window.__iwSweep2 && window.__iwSweep2.length >= 2, { timeout: 8000 }).catch(() => {});
const crossBack = await page.evaluate(() => ({ themes: window.__iwThemes2.slice(), sweep: window.__iwSweep2.slice(0, 6), url: location.pathname, theme: document.documentElement.dataset.theme }));
ok(/index\.html$/.test(crossBack.url), `回到了画布（${crossBack.url}）`);
ok(crossBack.themes[0] === 'dark' && crossBack.theme === 'light',
  `★ 反方向跨页也一样：新页面**先是上一页的深色**、漫完是画布的浅色（序列 ${JSON.stringify(crossBack.themes)}）`);
ok(crossBack.sweep.length >= 2, `回画布这一跳也播了横扫（采到 ${crossBack.sweep.length} 帧，含开机闸门还盖着的那段时间）`);
if (crossBack.sweep.length >= 2) {
  const a = crossBack.sweep[0], b = crossBack.sweep[crossBack.sweep.length - 1];
  console.log(`    跨页(深→浅) 中间帧：${a.t}ms mask-position=${a.mask}   →   ${b.t}ms mask-position=${b.mask}`);
  ok(a.mask !== b.mask, `同一条软边横扫（mask-position ${a.mask} → ${b.mask}）`);
}

// =====================================================================================
if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 3).join(' | '));
await browser.close();
if (bad.length) { console.log('\n❌ 未通过（' + bad.length + ' 项）：'); for (const b of bad) console.log('   - ' + b); process.exit(1); }
console.log('\n✅ 通过：逐页主题（含新账号成就页深色 / 按账号隔离 / 老键沿用）· 实体颜色只在设置里按类型设（面板无改色 / 颜色详细定制默认收起且可滚动）· 软边横扫（非圆、左上→右下、双向、模糊、结束才切）· 跨页（新页面先浅色再漫过去）');
