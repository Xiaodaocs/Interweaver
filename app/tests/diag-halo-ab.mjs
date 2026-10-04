// A/B 对照：卡片遮罩（::before）是否压暗了卡片**自己的**内容？
//   方法：同一页拍两张图 —— ① 正常（遮罩开）② 临时关掉遮罩（display:none）——
//   然后比较每张卡**内部**的亮像素数。若两者接近，说明遮罩只挡了后面的线、没盖内容。
process.on('uncaughtException', (e) => { console.log('崩溃：' + (e && e.message ? e.message : String(e))); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1600,1000', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:5188/settings.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://localhost:5188/starmap.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('#starMap .smNode').length > 0);
await wait(900);
await page.click('#smFit');
await wait(1200);

const measure = async (label, killHalo) => {
  await page.evaluate((kill) => {
    let st = document.getElementById('halo-kill');
    if (kill && !st) {
      st = document.createElement('style');
      st.id = 'halo-kill';
      st.textContent = '#starMap .smNode::before { display: none !important; }';
      document.head.appendChild(st);
    } else if (!kill && st) { st.remove(); }
  }, killHalo);
  await wait(400);
  const b64 = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async ([dataUrl, label2]) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const W = cv.width, H = cv.height;
    const d = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const cards = [...document.querySelectorAll('#starMap .smNode')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 4 && r.height > 4);
    const out = { label: label2, cards: cards.length, perCard: [], bright: 0, veryBright: 0 };
    for (const r of cards) {
      const ix = Math.round(r.width * 0.25), iy = Math.round(r.height * 0.25);
      let b = 0, vb = 0;
      for (let y = Math.max(0, Math.round(r.top + iy)); y <= Math.min(H - 1, Math.round(r.bottom - iy)); y++) {
        for (let x = Math.max(0, Math.round(r.left + ix)); x <= Math.min(W - 1, Math.round(r.right - ix)); x++) {
          const [rr, gg, bb] = at(x, y);
          const s = rr + gg + bb;
          if (s > 120) b++;
          if (s > 260) vb++;
        }
      }
      out.perCard.push([b, vb]);
      out.bright += b; out.veryBright += vb;
    }
    out.perCard.sort((a, c) => a[1] - c[1]);
    out.minVB = out.perCard.length ? out.perCard[0][1] : 0;
    out.medianVB = out.perCard.length ? out.perCard[Math.floor(out.perCard.length / 2)][1] : 0;
    out.zeroVB = out.perCard.filter((p) => p[1] === 0).length;
    return out;
  }, [`data:image/png;base64,${b64}`, label]);
};

const on = await measure('遮罩开', false);
const off = await measure('遮罩关', true);
console.log(`  遮罩开：卡片 ${on.cards} 张｜内部亮像素(>120) 合计 ${on.bright}、很亮(>260) 合计 ${on.veryBright}｜很亮的中位数 ${on.medianVB}、最少 ${on.minVB}、为 0 的卡片 ${on.zeroVB} 张`);
console.log(`  遮罩关：卡片 ${off.cards} 张｜内部亮像素(>120) 合计 ${off.bright}、很亮(>260) 合计 ${off.veryBright}｜很亮的中位数 ${off.medianVB}、最少 ${off.minVB}、为 0 的卡片 ${off.zeroVB} 张`);
console.log(`  → 遮罩对"卡片自身内容亮度"的影响：很亮像素 ${off.veryBright} → ${on.veryBright}（${off.veryBright ? (100 * (on.veryBright - off.veryBright) / off.veryBright).toFixed(1) : 'n/a'}%）`);
await page.evaluate(() => { const st = document.getElementById('halo-kill'); if (st) st.remove(); });
await page.screenshot({ path: 'D:/zhuo_mian/Interweaver/app/tests/artifacts/diag-halo-ab.png' });
console.log('截图 → tests/artifacts/diag-halo-ab.png（当前为遮罩开）');
await browser.close();
