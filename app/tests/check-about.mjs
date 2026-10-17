// 设置 →「关于」的永久检查（issue：显示版本信息（VERSION 文件）+ 更新日志（GitHub releases））
//
// 判据（都要有可复现的来源 ✓ 不靠"看起来对"）：
//   ① 左栏出现「关于」分类 ✓
//   ② 版本号 = **运行时 /VERSION 的响应**（与仓库根目录的 VERSION 文件一致 ✓ 不硬编码 ✗）
//   ③ 联网时：至少 1 条 release 可见 ✓ tag / 名字 / 日期 / 正文都非空 ✓
//      · 若 GitHub 取不到（离线/被墙/限流）→ **不判失败** ✗，但必须要么显示缓存提示、要么如实报错 ✓
//        （打印是哪种情况 ✓ 不静默 ✓）
//   ④ **拦截 api.github.com** 模拟断网 → 必须显示「缓存」提示或如实报错 ✓（二者之一 ✓ 不许空白 ✗）
//   ⑤ 全程原生弹窗探针 = 0 ✓（项目硬规矩 ✓）· 页面运行时错误 = 0 ✓
//   ⑥ 有缓存时，缓存提示必须写明"不一定最新" ✓（不许假装是最新 ✗）
//
// 用法：node tests/check-about.mjs（需要 5188 上有前端 ✓ 与 check-class-census 同一约定 ✓）
//   只读检查 ✓ 不写后端 ✓ 不碰真实库 ✓
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const WEB = process.env.IW_WEB || 'http://localhost:5188';
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); };

// 运行时取一次 /VERSION，作为"版本号应该是什么"的唯一来源（不硬编码 ✗）
let expectVersion = null;
try {
  const r = await fetch(WEB + '/VERSION', { cache: 'no-store' });
  if (r.ok) expectVersion = String(await r.text()).trim().split(/\r?\n/)[0].trim();
} catch { /* 下面会按"取不到"处理 ✓ */ }

const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

// 原生弹窗探针（项目硬规矩：零原生 alert/confirm/prompt ✓）
await page.evaluateOnNewDocument(() => {
  window.__native = [];
  for (const k of ['alert', 'confirm', 'prompt']) {
    const orig = window[k];
    window[k] = function (...a) { window.__native.push(k); return orig ? orig.apply(this, a) : undefined; };
  }
});

const openAbout = async () => {
  await page.goto(WEB + '/settings.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  const navs = await page.evaluate(() => [...document.querySelectorAll('#setWrap [data-goto]')].map((x) => x.dataset.goto));
  if (!navs.includes('about')) return { okNav: false, navs };
  await page.evaluate(() => { document.querySelector('#setWrap [data-goto="about"]').click(); });
  await new Promise((r) => setTimeout(r, 2600));   // 等 /VERSION + GitHub（有缓存会很快 ✓）
  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector('[data-iw-about="' + s + '"]');
    const rels = [...document.querySelectorAll('[data-iw-about="release"]')];
    const notes = ['note-live', 'note-cached', 'note-error'].map((k) => ({ k, t: (document.querySelector('[data-iw-about="' + k + '"]') || {}).textContent || '' })).filter((x) => x.t);
    return {
      navs: [...document.querySelectorAll('#setWrap [data-goto]')].map((x) => x.dataset.goto),
      version: (q('value') || {}).textContent || '',
      releases: rels.length,
      heads: rels.map((e) => (e.querySelector('[data-iw-about="rel-head"]') || {}).textContent || ''),
      dates: rels.map((e) => (e.querySelector('[data-iw-about="rel-date"]') || {}).textContent || ''),
      bodies: rels.map((e) => (e.querySelector('[data-iw-about="rel-body"]') || {}).textContent || ''),
      notes,
      native: (window.__native || []).length,
    };
  });
  return { okNav: true, ...r };
};

// ── ① 联网（或已有缓存）时的表现 ─────────────────────────────────────────────
const a = await openAbout();
console.log(`① 左栏分类：${JSON.stringify(a.navs)}`);
ok(a.okNav, '设置左栏里没有「关于」分类');
if (a.okNav) {
  const hasErr = !!(a.notes.find((n) => n.k === 'note-error'));
  const hasCache = !!(a.notes.find((n) => n.k === 'note-cached'));
  console.log(`① 版本 = "${a.version}" | release 条数 = ${a.releases} | 状态 = ${JSON.stringify(a.notes.map((n) => n.k))}`);
  if (expectVersion) {
    ok(a.version === expectVersion, `版本号应等于运行时 /VERSION 的响应「${expectVersion}」，实测「${a.version}」`);
  } else {
    ok(!!a.version && !a.version.startsWith('—'), '取不到 /VERSION 时页面也必须有明确交代（不能是占位符 —）');
  }
  if (a.releases > 0) {
    ok(a.heads.every((h) => h.trim().length > 0), '每条 release 都必须有 tag/名字');
    ok(a.dates.every((d) => d.trim().length > 0), '每条 release 都必须有日期');
    ok(a.bodies.some((b) => b.trim().length > 20), '至少一条 release 的正文非空（纯文本）');
    console.log(`① 首条：${JSON.stringify(a.heads[0])} · ${a.dates[0]} · 正文 ${a.bodies[0].length} 字`);
  } else {
    ok(hasErr || hasCache, '既没有 release，也没有缓存提示/错误说明（= 空白 ✗）');
    console.log(`① GitHub 不可达（${hasCache ? '显示缓存' : '如实报错'}）→ 按规则不算失败 ✓`);
  }
  ok(a.native === 0, `不该弹原生弹窗，实测 ${a.native} 次`);
}

// ── ② 断网模拟：拦截 api.github.com → 必须显示缓存提示或如实报错 ─────────────
await page.setRequestInterception(true);
page.on('request', (req) => {
  // ★ 防御：下面 ④ 段会 `setRequestInterception(false)` 回到联网态 ✓
  //   那一刻**已经在飞的**请求仍会进到这里 ✗ → 调 continue()/abort() 会抛
  //   "Request Interception is not enabled!" ✗（实测踩过 ✓）→ 竞态无害 ✓，吞掉即可 ✓
  try {
    if (req.url().includes('api.github.com')) req.abort();
    else req.continue();
  } catch { /* 拦截已关闭时的竞态：忽略 ✓ */ }
});
const b = await openAbout();
if (b.okNav) {
  const kinds = b.notes.map((n) => n.k);
  console.log(`② 断网后：release 条数 = ${b.releases} | 状态 = ${JSON.stringify(kinds)} | 版本 = "${b.version}"`);
  ok(kinds.length > 0, '断网时必须给出说明（缓存提示或如实报错），不许空白 ✗');
  if (kinds.includes('note-cached')) {
    const t = (b.notes.find((n) => n.k === 'note-cached') || {}).t || '';
    ok(/不一定是最新|缓存/.test(t), '缓存提示必须写明"是缓存的/不一定最新"（不许假装最新 ✗）');
  }
  ok(b.version === a.version || !!b.version, '断网时版本号仍应可读（/VERSION 是同源请求，不受 GitHub 影响）');
  ok(b.native === 0, `断网路径也不该弹原生弹窗，实测 ${b.native} 次`);
}

// ── ③ 运行时错误 ─────────────────────────────────────────────────────────────
// ── ④ 滚动 · ⑤ Readme 渲染 · ⑥ 字号（用户 2026-10-17 追加的三条要求）─────────────
// ★ 关掉拦截前**必须先摘掉 request 监听器** ✗
//   否则那一刻"已经在飞"的请求仍会进监听器 → 调 continue() → puppeteer 内部**异步 reject** ✗
//   （实测报 "Request Interception is not enabled!" ✓ 且 try/catch **抓不到** ✓ 因为是 Promise 侧的错误 ✓）
try { page.removeAllListeners('request'); await page.setRequestInterception(false); } catch { /* 忽略 ✓ */ }
const c = await openAbout();
if (c.okNav) {
  const m = await page.evaluate(() => {
    const body = document.body;
    body.scrollTop = 0;
    const over = body.scrollHeight - body.clientHeight;
    body.scrollTop = 400;            // ★ 滚动容器是 **body**：html 是 overflow:hidden（画布页需要）✓ 见 styles.css 里的注释
    const scrolled = body.scrollTop;
    const rb = document.querySelector('[data-iw-about="rel-body"]');
    const has = (s) => (rb ? !!rb.querySelector(s) : false);
    const txt = rb ? rb.textContent : '';
    const cs = rb ? getComputedStyle(rb) : null;
    return {
      over, scrolled,
      h: has('h1') || has('h2') || has('h3'), li: has('li'), strong: has('strong'), code: has('code'), pre: has('pre'),
      literalHash: /(^|\n)\s*#/.test(txt), literalBold: txt.includes('**'), literalFence: txt.includes('```'),
      font: cs ? parseFloat(cs.fontSize) : 0,
      scriptTags: document.querySelectorAll('[data-iw-about] script').length,
      innerScroll: cs ? (cs.maxHeight !== 'none' && cs.overflowY === 'auto') : false,
    };
  });
  console.log(`④ 滚动：内容超出 ${m.over}px · body.scrollTop=${m.scrolled}（>0 = 能滚 ✓）· 嵌套滚动条=${m.innerScroll}`);
  ok(m.over > 0 ? m.scrolled > 0 : true, `「关于」内容超出却滚不动（超出 ${m.over}px，scrollTop=${m.scrolled}）`);
  ok(!m.innerScroll, '正文不该再有自己的嵌套滚动条（应整页滚 ✓）');
  console.log(`⑤ Readme：标题=${m.h} 列表=${m.li} 粗体=${m.strong} 行内码=${m.code} 代码块=${m.pre} · 残留字面量 #/**/代码围栏 = ${m.literalHash}/${m.literalBold}/${m.literalFence}`);
  ok(m.h, 'Readme 标题没被渲染成元素（h1/h2/h3）');
  ok(m.li, 'Readme 列表没被渲染成 <li>');
  ok(m.strong || m.code || m.pre, 'Readme 的行内/块级标记没被渲染成元素');
  ok(!m.literalHash && !m.literalBold && !m.literalFence, '正文里仍残留 markdown 字面量记号（# / ** / 代码围栏）');
  ok(m.scriptTags === 0, 'Readme 渲染不许生成 script 元素');
  console.log(`⑥ 正文字号 = ${m.font}px（要求 ≥14）`);
  ok(m.font >= 14, `正文字号应 ≥14px，实测 ${m.font}px`);
} else {
  bad.push('追加检查时无法打开「关于」栏');
}

ok(pageErrors.length === 0, '页面运行时错误：' + JSON.stringify(pageErrors.slice(0, 3)));

// ── 深色主题截图（给人看的证据 ✓ 放 artifacts ✓ 已 gitignore）────────────────
try {
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'tests/artifacts/about-dark.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'tests/artifacts/about-light.png', fullPage: true });
  console.log('  截图 → tests/artifacts/about-light.png / about-dark.png');
} catch { /* 截图失败不影响判据 */ }

await browser.close();

if (bad.length) {
  console.log('❌ 未通过：');
  for (const m of bad) console.log('   - ' + m);
  process.exit(1);
}
console.log('✅ 通过：设置里有「关于」，版本号与 VERSION 逐字一致，更新日志来自 GitHub Releases；断网时会显示缓存或如实报错，零原生弹窗、零运行时错误');
