// 相机：世界坐标（y 向上）↔ 屏幕坐标（y 向下），平移/缩放/自适应网格
// 纯模块（无 DOM），Node 可测。
import { clamp } from './util.js';

export function makeCamera(viewW = 800, viewH = 600) {
  return {
    x: 0, y: 0, z: 40,           // (x,y) = 屏幕中心对应的世界点；z = 像素/单位
    _w: viewW, _h: viewH,
    setSize(w, h) { this._w = w; this._h = h; },
    size() { return { w: this._w, h: this._h }; },
    w2s(wx, wy) { return [(wx - this.x) * this.z + this._w / 2, (this.y - wy) * this.z + this._h / 2]; },
    s2w(sx, sy) { return { x: (sx - this._w / 2) / this.z + this.x, y: this.y - (sy - this._h / 2) / this.z }; },
    zoomAt(sx, sy, factor) {
      const before = this.s2w(sx, sy);
      this.z = clamp(this.z * factor, 0.05 * 40, 50 * 40);
      const after = this.s2w(sx, sy);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    },
    panByScreen(dx, dy) { this.x -= dx / this.z; this.y += dy / this.z; },
  };
}

// 1/2/5 进制自适应网格步长：保证屏幕间距在 [48, 240] px
export function gridStep(z) {
  const target = 80; // 期望屏幕间距
  let unit = target / z;               // 期望世界间距
  let step = Math.pow(10, Math.ceil(Math.log10(unit)));
  if (step / 5 >= unit) step /= 5;
  else if (step / 2 >= unit) step /= 2;
  return step;
}

// 网格线（纯函数，可测）：横向/纵向线都必须锚定在世界坐标的 step 整数倍上。
// 若某一族从屏幕边缘起算（不吸附），会出现两个严重后果：
//   1) 坐标轴被画在"离 0 最近的那条生成线"上，纵向平移时会在格线之间整格跳动；
//   2) 该族线相对世界坐标持续偏移，由于线彼此同形，纵向平移时网格看起来完全不动。
export function gridLines(cam, w, h) {
  const step = gridStep(cam.z);
  const left = cam.s2w(0, 0).x;
  const right = cam.s2w(w, 0).x;
  const top = cam.s2w(0, 0).y;
  const bottom = cam.s2w(0, h).y;
  const vlines = [];
  const hlines = [];
  const EPS = 1e-9;
  const ix0 = Math.floor(left / step), ix1 = Math.ceil(right / step);
  for (let i = ix0; i <= ix1; i++) {
    const x = i * step;
    if (x >= left - EPS && x <= right + EPS) vlines.push({ v: x, axis: i === 0 });
  }
  const iy0 = Math.floor(bottom / step), iy1 = Math.ceil(top / step);
  for (let i = iy0; i <= iy1; i++) {
    const y = i * step;
    if (y >= bottom - EPS && y <= top + EPS) hlines.push({ v: y, axis: i === 0 });
  }
  return { step, vlines, hlines };
}

// 网格刻度文字的小数位数与格式化：step=2 → 整数；step=0.2 → 1 位小数
export function gridDecimals(step) {
  return clamp(Math.ceil(-Math.log10(step)), 0, 6);
}
export function formatGridValue(v, step) {
  const d = gridDecimals(step);
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return String(Object.is(r, -0) ? 0 : r);
}
