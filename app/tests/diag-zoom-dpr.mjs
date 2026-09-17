// 复现尝试：把设备像素比设成 2（多数笔记本/外接屏的常见值），重复"缩小 + 平移"操作，
// 看是否出现元素丢失。假设：canvas 提升为合成层后，纹理尺寸 = 2845×3258 × DPR，
// DPR=2 时约 5690×6516，超过部分 GPU 的 4096/8192 上限 → 超出区域被丢弃（表现为元素消失）。
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const DPR = Number(process.env.DPR || 2);
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: DPR });
await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__IW);

const snap = async (label) => {
  const s = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#starMap .smNode')];
    const polys = [...document.querySelectorAll('#starMap polyline')];
    // 用"元素是否真的能被画到"来判定：检查每个元素是否落在 canvas 的绘制范围内
    const canvas = document.querySelector('#starMap .smCanvas');
    const cr = canvas.getBoundingClientRect();
    let outside = 0;
    for (const el of [...nodes, ...polys]) {
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      if (r.right < cr.left - 1 || r.left > cr.right + 1 || r.bottom < cr.top - 1 || r.top > cr.bottom + 1) outside++;
    }
    const cs = canvas ? getComputedStyle(canvas) : null;
    return { nodes: nodes.length, polys: polys.length, outside,
      willChange: cs ? cs.willChange : null,
      canvasCss: canvas ? { w: canvas.style.width, h: canvas.style.height } : null,
      scaled: { w: Math.round(cr.width), h: Math.round(cr.height) } };
  });
  console.log(`${label}：节点 ${s.nodes} | 折线 ${s.polys} | 落在画布绘制范围外 ${s.outside} | will-change=${s.willChange}`);
  console.log(`    画布 CSS 尺寸 ${JSON.stringify(s.canvasCss)} → 屏幕 ${JSON.stringify(s.scaled)}（DPR ${DPR}）`);
  return s;
};

await page.click('#achBtn');
await page.waitForSelector('#starMap');
await new Promise((r) => setTimeout(r, 2200));
await snap('① 打开');
await page.click('#smFit').catch(() => {});
await new Promise((r) => setTimeout(r, 900));
await snap('② 全览');
await page.mouse.move(700, 500);
await page.mouse.down();
for (let i = 0; i < 8; i++) { await page.mouse.move(700 - i * 40, 500 - i * 20); await new Promise((r) => setTimeout(r, 40)); }
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));
await snap('③ 拖动后');
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/check-zoom-dpr' + DPR + '.png' });
console.log('截图 → tests/artifacts/check-zoom-dpr' + DPR + '.png');
await browser.close();
