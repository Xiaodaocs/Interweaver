// 诊断：按用户真实路径复现"看不到使用中的效果"
//   工作台画东西 → 等运行时判定 → 点成就按钮（真实跳转）→ 在成就页看金点
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

// 画一个圆（真实操作：点工具 + 在画布上拖）
await page.click('#toolbar button[data-tool="circle"]').catch(() => {});
const p1 = await page.evaluate(() => { const s = window.__IW.cam.w2s(-3, 0); return [s[0], s[1]]; });
const p2 = await page.evaluate(() => { const s = window.__IW.cam.w2s(0, 3); return [s[0], s[1]]; });
await page.mouse.move(p1[0], p1[1]);
await page.mouse.down();
await page.mouse.move(p2[0], p2[1], { steps: 12 });
await page.mouse.up();
await wait(1500);

const live = await page.evaluate(() => {
  const raw = localStorage.getItem('interweaver.live.v1');
  return raw ? JSON.parse(raw) : null;
});
console.log('工作台 live 记录 =', live ? `at=${live.at} ids=[${live.ids.join(', ')}]` : '（无）');
console.log('  → 距今', live ? (Date.now() - live.at) + 'ms' : '-');

// 真实点击"成就"按钮跳转
const jumped = await page.evaluate(() => {
  const b = document.getElementById('achBtn');
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
});
console.log('点击成就按钮 =', jumped);
await page.waitForFunction(() => location.pathname.endsWith('starmap.html'), { timeout: 15000 }).catch(() => {});
await wait(2200);

const view = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#starMap .smNode')];
  const inuse = cards.filter((c) => c.dataset.inuse === '1');
  const first = inuse[0];
  const dots = first ? [...first.querySelectorAll('.smLive i')] : [];
  const cs = dots[0] ? getComputedStyle(dots[0]) : null;
  const rect = dots[0] ? dots[0].getBoundingClientRect() : null;
  return {
    url: location.pathname,
    scale: window.__IW.starmapCam.get().scale,
    cards: cards.length,
    inuseCount: inuse.length,
    inuseIds: inuse.map((c) => c.dataset.node),
    dotsPerCard: dots.length,
    dotPx: rect ? { w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) } : null,
    dotCss: cs ? { w: cs.width, h: cs.height, bg: (cs.backgroundImage || '').slice(0, 40), anim: cs.animationName, dur: cs.animationDuration } : null,
    liveRaw: (() => { try { return JSON.parse(localStorage.getItem('interweaver.live.v1') || 'null'); } catch { return null; } })(),
  };
});
console.log('成就页：url =', view.url, '| 缩放 =', view.scale.toFixed(2), '| 卡片 =', view.cards);
console.log('  标为"正在使用中" =', view.inuseCount, '张 →', JSON.stringify(view.inuseIds));
console.log('  每张卡的圆点数 =', view.dotsPerCard, '| 圆点屏幕尺寸 =', JSON.stringify(view.dotPx), '| CSS =', JSON.stringify(view.dotCss));
console.log('  页面读到的 live 记录 =', view.liveRaw ? `at=${view.liveRaw.at} ids=[${view.liveRaw.ids.join(', ')}]` : '（无）');

// 关键：金点在不同时刻的"可见度"——连续采样它的不透明度与位置
const frames = [];
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const d = document.querySelector('#starMap .smNode[data-inuse="1"] .smLive i');
    if (!d) return null;
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return { op: cs.opacity, ty: r.top, w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  });
  frames.push(s);
  await wait(200);
}
console.log('  圆点 10 帧采样（每 200ms）：');
for (const f of frames) console.log('    ', f ? `opacity=${f.op} y=${f.ty.toFixed(0)} size=${f.w}×${f.h}` : 'null');

if (errors.length) console.log('运行时错误：', errors.slice(0, 3));
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/diag-inuse.png' });
console.log('截图 → tests/artifacts/diag-inuse.png');
await browser.close();
