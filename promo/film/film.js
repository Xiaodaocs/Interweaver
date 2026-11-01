// 宣传片总装：六幕调度 + 交叠淡入淡出 + 常驻左上角 logo。
// 确定性渲染：每一帧只是 t（秒）的纯函数 —— 无 wall-clock、无随机漂移（所有随机源都是种子化的）。
import { cornerLogo, mixColor, clamp01, segs } from './lib.mjs';
import { DUR, FPS, W, H } from './timeline.mjs';
import * as act0 from './act0.mjs';
import * as act1 from './act1.mjs';
import * as act2 from './act2.mjs';
import * as act3 from './act3.mjs';
import * as act4 from './act4.mjs';
import * as act5 from './act5.mjs';

// 各幕窗口：[起始, 结束] —— 相邻幕有交叠区，绘制时按 alpha 渐变合成
const ACTS = [
  { m: act0, t0: 0.0, t1: 16.45 },
  { m: act1, t0: 15.85, t1: 52.45 },
  { m: act2, t0: 51.75, t1: 104.55 },
  { m: act3, t0: 103.75, t1: 120.35 },
  { m: act4, t0: 119.95, t1: 149.25 },
  { m: act5, t0: 148.05, t1: DUR },
];

// 画面明暗基调（决定左上角 logo 的深浅色）：Act3 坠落转深，Act5 落版回浅
function darkness(t) {
  return segs(t, 116.0, 117.6) - segs(t, 148.0, 149.4);
}

export function renderFrame(g, t) {
  g.clearRect(0, 0, W, H);
  let first = true;
  for (const a of ACTS) {
    if (t < a.t0 || t > a.t1) continue;
    // 头部淡入（与前幕交叠）/ 尾部淡出
    let alpha = 1;
    if (a.t0 > 0) alpha = Math.min(alpha, clamp01((t - a.t0) / 0.6));
    alpha = Math.min(alpha, clamp01((a.t1 - t) / 0.45));
    if (alpha <= 0) continue;
    g.save();
    if (!first) g.globalAlpha = alpha;
    a.m.render(g, t);
    g.restore();
    first = false;
  }
  // 常驻品牌角标
  const la = segs(t, 2.2, 3.0) * (1 - segs(t, DUR - 1.6, DUR - 0.9));
  if (la > 0) cornerLogo(g, darkness(t) > 0.5, la);
}

// 浏览器侧钩子
if (typeof window !== 'undefined') {
  const canvas = document.getElementById('film');
  const g = canvas.getContext('2d');
  window.__INFO = { W, H, FPS, DUR };
  window.__render = (t) => { renderFrame(g, t); };
  // 手动预览模式：?t=123.4 定格某一秒
  const q = new URLSearchParams(location.search);
  if (q.has('t')) {
    const show = () => renderFrame(g, parseFloat(q.get('t')) || 0);
    document.fonts.ready.then(show);
  }
}
