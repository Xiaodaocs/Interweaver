// 画布自适应回归：CSS 像素、backing store、相机与绘制 DPR 必须一致。
// 运行前启动前端：node server.mjs；再运行 node tests/check-canvas-responsive.mjs。
import puppeteer from 'puppeteer';

// 可用 PUPPETEER_EXECUTABLE_PATH 指定浏览器；本机测试优先使用已安装的 Edge。
// 这样只替换浏览器二进制，不改变测试所跑的 Chromium 与真实应用代码。
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let pass = 0, fail = 0;
const ok = (condition, label) => {
  if (condition) { pass++; console.log('PASS ' + label); }
  else { fail++; console.error('FAIL ' + label); }
};

try {
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5188/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__IW);
  // 用真实圆与直径检查像素位置，不只看 width/height 属性。
  await page.evaluate(() => {
    const { st, S } = window.__IW;
    st.entities.clear();
    st.bindings.clear();
    st.selection.clear();
    st.showParams = false;
    st.showTicks = false;
    S.addEntity(st, 'circle', { cx: 0, cy: 0, r: 3 });
    S.ensureEvaluated(st);
    window.__IW.renderOnce();
  });

  for (const [w, h, dpr] of [[1400, 900, 1], [1920, 1080, 2], [1000, 760, 1.5]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
    await page.waitForFunction((expectedW, expectedH, expectedDpr) => {
      const { cam } = window.__IW;
      const cv = document.getElementById('cv');
      return Math.round(expectedW * expectedDpr) === cv.width
        && Math.round(expectedH * expectedDpr) === cv.height
        && cam.size().w === expectedW && cam.size().h === expectedH
        && document.documentElement.clientWidth === expectedW
        && document.documentElement.clientHeight === expectedH
        && devicePixelRatio === expectedDpr;
    }, {}, w, h, dpr);
    const measure = await page.evaluate(() => {
      const { cam } = window.__IW;
      window.__IW.renderOnce();
      const cv = document.getElementById('cv');
      const dprX = cv.width / cam.size().w;
      const dprY = cv.height / cam.size().h;
      const [sx, sy] = cam.w2s(0, 0);
      const rgba = [...cv.getContext('2d').getImageData(Math.round(sx * dprX), Math.round(sy * dprY), 1, 1).data];
      const rect = cv.getBoundingClientRect();
      return { rect: [rect.width, rect.height], camera: cam.size(), rgba };
    });
    ok(measure.rect[0] === w && measure.rect[1] === h, `CSS 画布覆盖视口 ${w}x${h} @${dpr}x`);
    ok(measure.camera.w === w && measure.camera.h === h, `相机使用 CSS 像素 ${w}x${h}`);
    ok(measure.rgba[3] === 255, `视口中心实际有非透明像素 @${dpr}x：${measure.rgba}`);
  }

  // DPR 改变但视口不变：模拟跨显示器，仍应同步 backing store 并保持全屏。
  await page.setViewport({ width: 1000, height: 760, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.getElementById('cv').width === 1000 && devicePixelRatio === 1);
  await page.setViewport({ width: 1000, height: 760, deviceScaleFactor: 2 });
  await page.waitForFunction(() => document.getElementById('cv').width === 2000 && devicePixelRatio === 2);
  const switched = await page.evaluate(() => {
    window.__IW.renderOnce();
    const cv = document.getElementById('cv');
    const { cam } = window.__IW;
    return {
      size: [cv.width, cv.height],
      css: [cv.clientWidth, cv.clientHeight],
      camera: cam.size(),
      // drawFrame 的 save/restore 会恢复外部变换；在同步包裹中读取内部值。
      transform: (() => {
        const g = cv.getContext('2d');
        const original = g.save.bind(g);
        let inner = null;
        g.save = () => { inner = [g.getTransform().a, g.getTransform().d]; original(); };
        window.__IW.renderOnce();
        g.save = original;
        return inner;
      })(),
    };
  });
  ok(switched.size[0] === 2000 && switched.size[1] === 1520, '同视口 DPR 1 -> 2 时像素尺寸更新');
  ok(switched.css[0] === 1000 && switched.css[1] === 760, 'DPR 改变不改变 CSS 尺寸');
  ok(switched.camera.w === 1000 && switched.camera.h === 760, 'DPR 改变不改变相机坐标');
  ok(switched.transform[0] === 2 && switched.transform[1] === 2, 'DPR 改变后强制单帧绘制仍使用新缩放');

  // 真实指针走 tools.js：拖圆周上的半径手柄（单击圆心会走双击绑定语义）。
  await page.click('[data-tool="select"]');
  await page.waitForFunction(() => window.__IW.st.tool === 'select');
  await page.mouse.move(620, 380);
  await page.mouse.down();
  await page.mouse.move(700, 380, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const { st } = window.__IW;
    const c = [...st.entities.values()].find((e) => e.type === 'circle');
    return c ? { cx: c.params.cx, cy: c.params.cy, r: c.params.r } : null;
  });
  ok(dragged && Math.abs(dragged.cx) < 0.01 && Math.abs(dragged.cy) < 0.01 && Math.abs(dragged.r - 5) < 0.01,
    `高 DPR 下拖拽仍按 CSS 坐标换算：${JSON.stringify(dragged)}`);
  ok(errors.length === 0, '无浏览器脚本异常：' + errors.join('; '));
} finally {
  await browser.close();
}
console.log(`画布自适应：${pass} 通过，${fail} 失败`);
if (fail) process.exitCode = 1;
