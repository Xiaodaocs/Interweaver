import puppeteer from "file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 200000, args: ["--window-size=1400,900","--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
const errs = []; p.on("pageerror", e => errs.push(e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto("http://localhost:5188/index.html", { waitUntil: "networkidle0" });
await wait(1400);
const setup = await p.evaluate(async () => {
  const M = await import("/src/entities.js");
  const R = await import("/src/presetRecipes.js");
  const { st, S, cam } = window.__IW;
  st.entities.clear(); st.bindings.clear(); st.selection.clear();
  cam.x = 0; cam.y = 0; cam.z = 40;
  const preset = M.PRESETS.find((x) => x.key === "damped");
  const at = { x: 0, y: 0 };
  const params = M.createFromPreset(preset, at);
  const [dmin, dmax] = S.viewDomainX(cam);
  params.dmin = dmin; params.dmax = dmax;
  const extra = R.presetExtraWithExpr(preset, at, M.presetExtra ? M.presetExtra(preset, at) : undefined);
  const f = S.addEntity(st, preset.type, params, extra, true);
  const ig = S.addEntity(st, "integral", { a: -2, b: 2, n: 8, method: 0 }, { host: f.id }, true);
  S.ensureEvaluated(st); window.__IW.renderOnce();
  // 积分区域在屏幕上的外接框（a..b 与 0..max|y| 之间）
  const { hostYAt } = await import("/src/entities.js");
  const ys = [];
  for (let i = 0; i <= 8; i++) ys.push(hostYAt(f, st.env, -2 + (4 * i) / 8));
  const top = Math.max(...ys.filter(Number.isFinite), 0.5);
  const s1 = cam.w2s(-2.2, top + 0.4), s2 = cam.w2s(2.2, -0.6);
  return { f: f.id, ig: ig.id, clip: { x: Math.round(Math.min(s1[0], s2[0])), y: Math.round(Math.min(s1[1], s2[1])),
    width: Math.round(Math.abs(s2[0] - s1[0])), height: Math.round(Math.abs(s2[1] - s1[1])) } };
});
console.log("  积分区域屏幕外接框 =", JSON.stringify(setup.clip));
const shotA = await p.screenshot({ encoding: "base64", clip: setup.clip });
// 真鼠标：在积分区域**之外**的曲线上抓（x = -9），横拖 +140px
const g = await p.evaluate(async () => {
  const { hostYAt } = await import("/src/entities.js");
  const { st, cam } = window.__IW;
  const f = [...st.entities.values()].find((e) => e.type === "func");
  const s = cam.w2s(-9, hostYAt(f, st.env, -9));
  return { x: s[0], y: s[1] };
});
await p.evaluate(() => { window.__IW.st.tool = "select"; });
await p.mouse.move(g.x, g.y);
await p.mouse.down();
for (let i = 1; i <= 10; i++) { await p.mouse.move(g.x + i * 14, g.y); await wait(20); }
await p.mouse.up();
await wait(400);
const shotB = await p.screenshot({ encoding: "base64", clip: setup.clip });
const diff = await p.evaluate(async ([a, c]) => {
  const load = async (u) => { const i = new Image(); await new Promise((res, rej) => { i.onload = res; i.onerror = () => rej(new Error("d")); i.src = u; });
    const cv = document.createElement("canvas"); cv.width = i.width; cv.height = i.height;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(i, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
  const A = await load(a), B = await load(c);
  let n = 0, total = A.length / 4;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 10 || Math.abs(A[i+1] - B[i+1]) > 10 || Math.abs(A[i+2] - B[i+2]) > 10) n++;
  return { n, total, pct: +(100 * n / total).toFixed(1) };
}, ["data:image/png;base64," + shotA, "data:image/png;base64," + shotB]);
const after = await p.evaluate(async ([fid, igid]) => {
  const { st, S } = window.__IW;
  const f = st.entities.get(fid), ig = st.entities.get(igid);
  return { cx: +S.getVal(st, f, "cx").toFixed(3), S: +S.getDerived(st, ig, "S").toFixed(4) };
}, [setup.f, setup.ig]);
console.log("  拖动后：函数 cx =", after.cx, "| 积分 S =", after.S);
console.log("  画面比对：积分区域外接框内 **变了 " + diff.pct + "% 的像素**（" + diff.n + "/" + diff.total + "）");
console.log("  判定：", diff.pct > 2 ? "积分区域的**画面确实变了** ✓✓（不是只有数值变）" : "画面几乎没变 ✗");
console.log("  页面错误：", errs.length ? errs.slice(0,2).join(" | ") : "无");
await b.close();
