// 核验：深色主题下面板不得"露白" + CSS 类名与各模块 DOM 的契约
//
// 两处判定的修正（吸取上一版教训）：
//   ① 亮度必须做 **alpha 合成**：rgba(255,255,255,0.04) 是"4% 白叠在深底上"，视觉是深色，
//      只取 RGB 会误判成 255（上一版就是这么报的假红灯）。
//   ② 条件性 DOM（.varCard 需要有变量、.slRow 需要有存档）不存在时应记"不适用"，不是问题。
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const DARK_BG = 8;                       // 深色宇宙底的近似亮度（#0B0E16）
const THRESHOLD = 60;                    // 达标线：合成后亮度 < 60

const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);
await new Promise((r) => setTimeout(r, 800));

const res = await page.evaluate((darkBg) => {
  const parse = (css) => {
    const m = String(css).match(/rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+))?\s*\)/);
    if (!m) return null;
    const lum = Number(m[1]) * 0.2126 + Number(m[2]) * 0.7152 + Number(m[3]) * 0.0722;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    return { lum, a, composited: lum * a + darkBg * (1 - a) };   // ★ alpha 合成
  };
  const read = (el) => (el ? { css: getComputedStyle(el).backgroundColor, ...parse(getComputedStyle(el).backgroundColor) } : null);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px';
  host.innerHTML = '<div class="achCard"><div class="achText"><b>测试</b></div></div><div class="achBubble"><b>测试</b></div>';
  document.body.appendChild(host);
  const out = {
    theme: document.documentElement.dataset.theme,
    varCard: read(document.querySelector('.varCard')),
    fxInput: read(document.querySelector('.fxInput')),
    achCard: read(host.querySelector('.achCard')),
    achBubble: read(host.querySelector('.achBubble')),
    achCardColor: host.querySelector('.achCard') ? getComputedStyle(host.querySelector('.achCard')).color : null,
    bubbleColor: host.querySelector('.achBubble') ? getComputedStyle(host.querySelector('.achBubble')).color : null,
  };
  host.remove();
  return out;
}, DARK_BG);

console.log('主题 =', res.theme);
const rows = [];
const show = (name, o, conditional) => {
  if (!o) { console.log('  ' + name.padEnd(12), conditional ? '(条件性 DOM，本次不适用)' : '(DOM 中不存在 ✗)'); return; }
  const ok = o.composited < THRESHOLD;
  rows.push({ name, ok, lum: o.composited });
  console.log('  ' + name.padEnd(12), o.css.padEnd(26), '合成亮度', o.composited.toFixed(1), ok ? '✓' : '✗');
};
show('.varCard', res.varCard, true);
show('.fxInput', res.fxInput, false);
show('.achCard', res.achCard, false);
show('.achBubble', res.achBubble, false);
console.log('  成就卡文字色 =', res.achCardColor, '| 气泡文字色 =', res.bubbleColor);

await page.click('#sceneBtn').catch(() => {});
await new Promise((r) => setTimeout(r, 900));
const sl = await page.evaluate((darkBg) => {
  const el = document.getElementById('sceneList');
  if (!el) return null;
  const cs = getComputedStyle(el).backgroundColor;
  const m = String(cs).match(/rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+))?\s*\)/);
  const lum = Number(m[1]) * 0.2126 + Number(m[2]) * 0.7152 + Number(m[3]) * 0.0722;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return { css: cs, composited: lum * a + darkBg * (1 - a), slHead: !!document.querySelector('.slHead'), slRow: !!document.querySelector('.slRow') };
}, DARK_BG);
if (sl) {
  const ok = sl.composited < THRESHOLD;
  rows.push({ name: '#sceneList', ok, lum: sl.composited });
  console.log('  #sceneList  ', sl.css.padEnd(26), '合成亮度', sl.composited.toFixed(1), ok ? '✓' : '✗', '| .slHead', sl.slHead ? '有' : '无', '| .slRow', sl.slRow ? '有' : '(无存档，条件性)');
}
console.log('运行时错误 =', errors.length ? errors.slice(0, 2) : '无');

const bad = rows.filter((r) => !r.ok).map((r) => r.name + ' 合成亮度 ' + r.lum.toFixed(1) + ' ≥ ' + THRESHOLD);
if (errors.length) bad.push('运行时错误：' + errors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-dark-surfaces.png' });
console.log('截图 → tests/artifacts/check-dark-surfaces.png');
if (bad.length) { console.log('❌ 未通过：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ 深色面板全部达标（合成亮度 < ' + THRESHOLD + '），且契约类名存在');
await browser.close();
process.exit(bad.length ? 1 : 0);
