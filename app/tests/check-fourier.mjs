// issue #1「傅里叶变换」的永久检查（数学判据 + 真浏览器两条用户流程 + 演示图）
//
// 用户口径（2026-10-18 确认）：
//   ① 点「fx」→ 选项卡「函数绘制器 / 傅里叶变换」→ 后者弹**关联式卡片**（勾选波 + N）→ 确定
//      → **在画布上点一下放置**合成波
//   ② **任何一条曲线**右键 →「傅里叶变换 → 转换为多个波」
//   ③ 演示图放 app/docs/demo/ ✓（本检查会顺便生成 ✓ 纳入 PR ✓ 符合 issue 的"需要有演示图片" ✓）
//
// 判据（每条都对应一个真实失败模式 ✓）：
//   A. 数学层：FFT 与朴素 DFT 逐点一致 · IFFT 还原 · 精确频点的幅值/相位精确 · 合成口径与 sine 一致 · NaN 被计数
//   B. 流程①：选项卡出现且**不直接弹函数绘制器** · 卡片列出画布上的波 · 确定后进入武装放置 · 画布点击后**恰好**新增 1 个合成波
//      · 合成波的谐波数 = 设定的 N · 原始取样点 > 0 · 工具自动回到 select
//   C. 流程②：曲线右键菜单里有「傅里叶变换 → 转换为多个波」· 点击后**新增 ≥2 个 sine** · 提示里带 RMS · 新波被选中
//   D. 零原生弹窗 · 零页面运行时错误
//
// 用法：node tests/check-fourier.mjs（需要 5188 上有前端 ✓ 与其它浏览器检查同一约定 ✓）
//   只读检查 ✓ 不写后端 ✓ 不碰真实库 ✓；演示图写到 app/docs/demo/ ✓（刻意入库 ✓ 因为 issue 要求演示图片 ✓）
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fft, ifft, analyze, synthesize } from '../src/fourier.js';

const WEB = process.env.IW_WEB || 'http://localhost:5188';
const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(HERE, '..', 'docs', 'demo');
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════ A. 数学层（Node 侧 ✓ 不需要浏览器 ✓）════════════════════
{
  const n = 64;
  const re = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(2 * Math.PI * 3 * i / n) + 0.5 * Math.cos(2 * Math.PI * 7 * i / n);
  const aRe = Float64Array.from(re), aIm = new Float64Array(n);
  fft(aRe, aIm);
  let maxErr = 0;
  for (let k = 0; k < n; k++) {
    let dr = 0, di = 0;
    for (let t = 0; t < n; t++) { const ang = -2 * Math.PI * k * t / n; dr += re[t] * Math.cos(ang); di += re[t] * Math.sin(ang); }
    maxErr = Math.max(maxErr, Math.abs(aRe[k] - dr), Math.abs(aIm[k] - di));
  }
  ok(maxErr < 1e-9, `FFT 与朴素 DFT 不一致（最大误差 ${maxErr}）`);
  const bRe = Float64Array.from(aRe), bIm = Float64Array.from(aIm);
  ifft(bRe, bIm);
  let invErr = 0;
  for (let i = 0; i < n; i++) invErr = Math.max(invErr, Math.abs(bRe[i] - re[i]));
  ok(invErr < 1e-9, `IFFT 还原误差过大（${invErr}）`);

  // 精确频点：k=16 → f=2.5Hz、A=1.3、φ=0.4；k=48 → f=7.5Hz、A=0.6、φ=−1.2
  const M = 128, dt = 0.05;
  const sig = new Float64Array(M);
  for (let i = 0; i < M; i++) sig[i] = 1.3 * Math.sin(2 * Math.PI * 16 * i / M + 0.4) + 0.6 * Math.sin(2 * Math.PI * 48 * i / M - 1.2);
  const r = analyze(sig, dt, { keep: 2 });
  const g1 = r.harmonics.find((h) => h.k === 16), g2 = r.harmonics.find((h) => h.k === 48);
  ok(!!g1 && Math.abs(g1.amp - 1.3) < 1e-6, 'k=16 幅值应精确为 1.3');
  ok(!!g1 && Math.abs(Math.atan2(Math.sin(g1.phase - 0.4), Math.cos(g1.phase - 0.4))) < 1e-6, 'k=16 相位应精确为 0.4');
  ok(!!g2 && Math.abs(g2.amp - 0.6) < 1e-6, 'k=48 幅值应精确为 0.6');
  ok(!!g2 && Math.abs(Math.atan2(Math.sin(g2.phase + 1.2), Math.cos(g2.phase + 1.2))) < 1e-6, 'k=48 相位应精确为 −1.2');
  // 合成口径与 sine 实体 yAt 一致
  const A = 1.3, lam = 2.5, phi = 0.4, cx = 3, cy = -2, x = 7;
  const mine = synthesize([{ amp: A, freq: 1 / lam, phase: phi }], x, { cx, cy });
  const sine = cy + A * Math.sin((2 * Math.PI / lam) * (x - cx) + phi);
  ok(Math.abs(mine - sine) < 1e-12, 'synthesize 必须与 sine 实体的 yAt 口径一致');
  ok(analyze(new Float64Array([0, 1, NaN, 3, 4, 5, 6, 7]), 0.1).badPoints === 1, 'NaN 取样点必须被计数（不许静默吞 ✗）');
  console.log(`A. 数学层：DFT 对拍误差 ${maxErr.toExponential(2)} · IFFT 误差 ${invErr.toExponential(2)} · 精确频点幅值/相位全对 ✓`);
}

// ════════════════ B/C/D. 真浏览器两条用户流程 ═════════════════════════════
const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1400,900', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
await page.evaluateOnNewDocument(() => {
  window.__native = [];
  for (const k of ['alert', 'confirm', 'prompt']) {
    const orig = window[k];
    window[k] = function (...a) { window.__native.push(k); return orig ? orig.apply(this, a) : undefined; };
  }
});
const openCanvas = async () => {
  await page.goto(WEB + '/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW, { timeout: 15000 });
  await wait(1200);
};
const mkTwoWaves = () => page.evaluate(() => {
  const IW = window.__IW;
  const a = IW.S.addEntity(IW.st, 'sine', { A: 1.2, lam: 3, phi: 0, cx: 0, cy: 0, dmin: -1e4, dmax: 1e4 });
  IW.S.addEntity(IW.st, 'sine', { A: 0.6, lam: 1.2, phi: 0.8, cx: 0, cy: 0.5, dmin: -1e4, dmax: 1e4 });
  IW.st.selection = new Set([a.id]); IW.S.emit(IW.st, 'selection'); IW.renderOnce();
  return a.id;
});
const snap = () => page.evaluate(() => {
  const IW = window.__IW;
  return {
    tool: IW.st.tool, n: IW.st.entities.size,
    fw: [...IW.st.entities.values()].filter((e) => e.type === 'fourierwave').length,
    sines: [...IW.st.entities.values()].filter((e) => e.type === 'sine').length,
    sel: IW.st.selection.size,
    hint: (document.getElementById('hint') || {}).textContent || '',
    native: (window.__native || []).length,
  };
});

try {
  mkdirSync(DEMO_DIR, { recursive: true });
} catch { /* 目录已存在 */ }

// ── 流程①：fx → 选项卡 → 傅里叶变换卡片 → 勾选 → 确定 → 点画布放置
await openCanvas();
const wid = await mkTwoWaves();
await wait(250);
const n0 = (await snap()).n;
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /(^|\s)fx(\s|$)|函数/.test((x.id || '') + ' ' + (x.title || '') + ' ' + (x.dataset.tool || ''))); if (b) b.click(); });
await wait(400);
const chooser = await page.evaluate(() => {
  const c = document.querySelector('[data-iw-f="chooser"]');
  return { exists: !!c, visible: c ? !c.hidden : false, acts: c ? [...c.querySelectorAll('[data-iw-f-act]')].map((x) => x.getAttribute('data-iw-f-act')) : [] };
});
console.log(`B. ① fx 选项卡：exists=${chooser.exists} visible=${chooser.visible} 按钮=${JSON.stringify(chooser.acts)}`);
ok(chooser.exists && chooser.visible, '点「fx」应出现选项卡（两个按钮）');
ok(chooser.acts.includes('drawer') && chooser.acts.includes('fourier'), '选项卡里应有「函数绘制器」与「傅里叶变换」两个选项');
// 选项卡出现时**不应**同时弹出函数绘制器 ✗
const drawerOpen = await page.evaluate(() => { const d = document.getElementById('fxDock'); return d ? !d.hidden : false; });
ok(!drawerOpen, '点「fx」时不应直接弹出函数绘制器（issue 明确要求先出选项卡 ✗）');
await page.screenshot({ path: join(DEMO_DIR, 'fourier-1-tab.png'), fullPage: false });
await page.evaluate(() => { const el = document.querySelector('[data-iw-f-act="fourier"]'); if (el) el.click(); });
await wait(450);
const card = await page.evaluate(() => {
  const c = document.querySelector('[data-iw-f="card"]');
  return { visible: c ? !c.hidden : false, waves: c ? c.querySelectorAll('[data-iw-f-wave]').length : 0 };
});
console.log(`B. ② 卡片：visible=${card.visible} 列出的波=${card.waves}`);
ok(card.visible, '选「傅里叶变换」应弹出关联式卡片');
ok(card.waves >= 2, `卡片应列出画布上的波（实测 ${card.waves} 个，至少 2 个）`);
await page.screenshot({ path: join(DEMO_DIR, 'fourier-2-card.png'), fullPage: false });
await page.evaluate(() => {
  // ★ 卡片已按「关联」页面重排：每个波是一行 button.wizParam（点击切换选中 ✓ 右侧 span.pv 显示「✓ 已选」）
  //   旧写法 cb.checked = true 对 <button> 无效 ✗ —— 那是卡片改版前的复选框协议 ✗（实测因此链红 ✓ 已改 ✓）
  for (const row of document.querySelectorAll('[data-iw-f="item"]')) {
    if (!/✓/.test(row.textContent)) row.click();
  }
  const n = document.querySelector('[data-iw-f="n"]'); if (n) { n.value = '4'; n.dispatchEvent(new Event('change', { bubbles: true })); }
  const okb = document.querySelector('[data-iw-f-act="ok"]'); if (okb) okb.click();
});
await wait(450);
const armed = await snap();
console.log(`B. ③ 确定后：tool=${armed.tool} 实体数=${armed.n}（应未变 ${n0} ✓）`);
ok(armed.tool === 'fourierplace', `确定后应进入武装放置（tool 实测 ${armed.tool}）`);
ok(armed.n === n0, `武装放置阶段不该提前创建实体（实测 ${armed.n} vs ${n0}）`);
await page.mouse.click(780, 430);
await wait(500);
const placed = await snap();
console.log(`B. ④ 画布点击后：合成波=${placed.fw} tool=${placed.tool} 实体数=${placed.n}`);
ok(placed.fw === 1, `画布点击后应恰好新增 1 个合成波（实测 ${placed.fw}）`);
ok(placed.tool === 'select', `放置完成后工具应回到 select（实测 ${placed.tool}）`);
const fwInfo = await page.evaluate(() => {
  const IW = window.__IW;
  const e = [...IW.st.entities.values()].find((x) => x.type === 'fourierwave');
  if (!e) return null;
  const R = IW.REGISTRY.fourierwave;
  const rms = R.derived.find((d) => d.k === 'rms').compute((k) => e.params[k], e, { ent: () => e, val: (id, k) => e.params[k] });
  return { params: e.params, harmonics: (e.harmonics || []).length, srcLen: (e.srcY || []).length, rms };
});
console.log(`B. ⑤ 合成波：params=${JSON.stringify(fwInfo && fwInfo.params)} 谐波=${fwInfo && fwInfo.harmonics} 取样=${fwInfo && fwInfo.srcLen} RMS=${fwInfo && fwInfo.rms}`);
ok(fwInfo && fwInfo.harmonics === 4, `合成波应保留设定的 N=4 个谐波（实测 ${fwInfo && fwInfo.harmonics}）`);
ok(fwInfo && fwInfo.srcLen >= 64, `合成波应带原始取样（实测 ${fwInfo && fwInfo.srcLen} 点）`);
ok(fwInfo && Number.isFinite(fwInfo.rms), '合成波应能算出 RMS 误差（数字可检验 ✓）');
await page.screenshot({ path: join(DEMO_DIR, 'fourier-3-placed.png'), fullPage: false });

// ── 流程②：任何曲线右键 → 傅里叶变换 → 转换为多个波
await openCanvas();
const wid2 = await mkTwoWaves();
await wait(250);
const before2 = await snap();
const pos = await page.evaluate((id) => {
  const IW = window.__IW;
  const e = IW.st.entities.get(id);
  const y = 1.2 * Math.sin(2 * Math.PI / 3 * 1);
  const s = IW.cam.w2s(1, y);
  return [s[0], s[1]];
}, wid2);
await page.mouse.click(pos[0], pos[1], { button: 'right' });
await wait(500);
const menu = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#ctxMenu button')].find((x) => (x.dataset.act || '') === 'mk:fourier');
  return { has: !!btn, label: btn ? btn.textContent.trim() : null };
});
console.log(`C. ① 右键菜单有「傅里叶变换」入口=${menu.has} 文案=${JSON.stringify(menu.label)}`);
ok(menu.has, '任何曲线右键菜单里应有「傅里叶变换 → 转换为多个波」');
await page.screenshot({ path: join(DEMO_DIR, 'fourier-4-rightclick.png'), fullPage: false });
await page.evaluate(() => { const el = [...document.querySelectorAll('#ctxMenu button')].find((x) => (x.dataset.act || '') === 'mk:fourier'); if (el) el.click(); });
await wait(700);
const after2 = await snap();
const added = after2.n - before2.n;
console.log(`C. ② 点击后：实体数 ${before2.n} → ${after2.n}（新增 ${added}）· sine ${before2.sines} → ${after2.sines} · 选中=${after2.sel}`);
console.log(`   提示="${after2.hint.slice(0, 80)}"`);
ok(added >= 2, `「转换为多个波」应至少新增 2 个波（实测 ${added} 个）`);
ok(after2.sines > before2.sines, '新增的应当是 sine 实体（波 ✓）');
ok(/RMS/.test(after2.hint), `提示里应给出 RMS 误差（实测 "${after2.hint}"）`);
ok(after2.sel >= 2, `新生成的波应被选中（实测 ${after2.sel} 个）`);
await page.screenshot({ path: join(DEMO_DIR, 'fourier-5-waves.png'), fullPage: false });

// ── D. 收尾
const fin = await snap();
ok(fin.native === 0, `不该弹原生弹窗（实测 ${fin.native} 次）`);
ok(pageErrors.length === 0, '页面运行时错误：' + JSON.stringify(pageErrors.slice(0, 3)));
console.log(`D. 原生弹窗=${fin.native} · 运行时错误=${pageErrors.length ? JSON.stringify(pageErrors.slice(0, 2)) : '无 ✓'}`);

// ── E. 性能回归（用户 2026-10-19 报告：傅里叶变换后非常卡 ✓ 这里把它变成永久断言 ✓）
//   实测根因（当时）：draw 每帧重算整条曲线 —— 视口 2800 点 × 8 谐波做 sin ≈ 2.2 万次/帧/波
//   修法：按签名缓存 2048 点表 + O(1) 查表 → 单次 1.113ms → 0.223ms ✓
//   这条断言的作用：以后若有人又写成「每帧重算」，链会红 ✗ 而不是等用户感觉卡 ✓
{
  const perf = await page.evaluate(() => new Promise((res) => {
    const IW = window.__IW;
    IW.st.entities.clear(); IW.st.selection.clear();
    for (let k = 0; k < 5; k++) {
      const harmonics = []; for (let i = 0; i < 8; i++) harmonics.push({ amp: 1.2 / (i + 1), freq: 0.2 * (i + 1), phase: i });
      const srcY = []; for (let i = 0; i < 256; i++) srcY.push(Math.sin(i / 15));
      IW.S.addEntity(IW.st, 'fourierwave', { N: 8, cx: k, cy: 0 }, { harmonics, srcY, srcX0: -10, srcX1: 10, srcCx: 0, srcCy: 0 });
    }
    IW.S.ensureEvaluated(IW.st); IW.renderOnce();
    const R = IW.REGISTRY.fourierwave;
    let n = 0, ms = 0; const od = R.draw;
    R.draw = function (...a) { const t0 = performance.now(); const r = od.apply(this, a); n++; ms += performance.now() - t0; return r; };
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else { R.draw = od; res({ frames, n, ms, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 }); } };
    requestAnimationFrame(tick);
  }));
  const fps = perf.frames / 1.5;
  const avg = perf.n ? perf.ms / perf.n : 999;
  console.log(`E. 性能回归：5 个合成波 → ${Math.round(fps)}fps · draw ${avg.toFixed(3)}ms/次（${perf.n} 次）· 堆 ${(perf.heap / 1048576).toFixed(1)}MB`);
  ok(fps >= 45, `5 个合成波时帧率应 ≥45fps（实测 ${fps.toFixed(1)}）— 掉帧说明又变成每帧重算了`);
  ok(avg <= 0.6, `合成波单次 draw 应 ≤0.6ms（实测 ${avg.toFixed(3)}ms）— 修复前是 1.113ms`);
}
await browser.close();

if (bad.length) {
  console.log('❌ 未通过：');
  for (const m of bad) console.log('   - ' + m);
  process.exit(1);
}
console.log('✅ 通过：FFT/IFFT/频谱与朴素 DFT 一致；fx 选项卡→卡片→武装放置→合成波流程成立；任何曲线右键→转换为多个波成立；演示图已写入 app/docs/demo/；零原生弹窗、零运行时错误');
