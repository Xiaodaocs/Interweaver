// Canvas 渲染原语（v1 promo/film/lib.mjs 的 TS 移植；视觉口径不变）
import { COL } from '../design';

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    x = clamp01(x);
    let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-5) break; const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    if (sx(t) - x > 1e-4) { let lo = 0, hi = 1; t = x; for (let i = 0; i < 24; i++) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return sy(t);
  };
}
export const IOS = bezier(0.32, 0.72, 0, 1);
export const SPRING = bezier(0.34, 1.4, 0.44, 1);
export const SMOOTH = bezier(0.65, 0, 0.35, 1);
export const segs = (t: number, a: number, b: number, ease: (u: number) => number = IOS) => ease(seg(t, a, b));

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let z = Math.imul(s ^ (s >>> 15), 1 | s); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- 辉光精灵 ----------
const spriteCache = new Map<string, HTMLCanvasElement>();
export function colorWithA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function glowSprite(color: string, size = 128) {
  const key = color + '/' + size;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color); grad.addColorStop(0.25, colorWithA(color, 0.5)); grad.addColorStop(1, colorWithA(color, 0));
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
}
export function glow(g: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) {
  const spr = glowSprite(color);
  const s = 128 * scale;
  g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = 'lighter';
  g.drawImage(spr, x - s / 2, y - s / 2, s, s);
  g.restore();
}

// ---------- 文字 ----------
export interface TextOpt { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; ls?: number; alpha?: number; font?: string }
export function text(g: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpt = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.font = `${o.weight ?? 400} ${o.size ?? 40}px ${o.font ?? '"PingFang SC","Microsoft YaHei",sans-serif'}`;
  g.textAlign = o.align ?? 'center'; g.textBaseline = 'middle';
  const gg = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if (gg.letterSpacing !== undefined) gg.letterSpacing = (o.ls ?? 0) + 'px';
  g.fillStyle = o.color ?? COL.ink;
  g.fillText(str, x, y);
  g.restore();
}

// ---------- 圆角矩形 / 玻璃卡 ----------
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
export function glassCard(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 16, o: { dark?: boolean; alpha?: number; border?: string } = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.shadowColor = o.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.13)';
  g.shadowBlur = 28; g.shadowOffsetY = 8;
  rrect(g, x, y, w, h, r);
  g.fillStyle = o.dark ? 'rgba(20,20,30,0.82)' : 'rgba(255,255,255,0.78)';
  g.fill();
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  rrect(g, x, y, w, h, r);
  g.strokeStyle = o.border || (o.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)');
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

// ---------- 丝线（产品连接视图同款） ----------
export function threadPts(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const dx = Math.max(60, Math.abs(x1 - x0) * 0.45);
  const s = Math.sign(x1 - x0 || 1);
  return [[x0, y0], [x0 + s * dx, y0], [x1 - s * dx, y1], [x1, y1]];
}
export function cubicPt(p: [number, number][], u: number): [number, number] {
  const v = 1 - u;
  return [
    v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0],
    v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1],
  ];
}
export function thread(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, tSec: number,
  o: { alpha?: number; rgb?: string; lw?: number; speed?: number; growU?: number; pulseUs?: number[]; pulseColor?: string } = {}) {
  const { alpha = 1, rgb = '94,92,230', lw = 1.5, speed = 26, growU = 1, pulseUs = [], pulseColor = '#5E5CE6' } = o;
  const pts = threadPts(x0, y0, x1, y1);
  g.save();
  g.globalAlpha = alpha;
  if (growU < 1) {
    const L = 1400;
    g.setLineDash([L * growU, L * 2]);
    g.strokeStyle = `rgba(${rgb},0.9)`; g.lineWidth = lw + 0.5;
  } else {
    g.setLineDash([3, 7]);
    g.lineDashOffset = -tSec * speed;
    g.strokeStyle = `rgba(${rgb},0.6)`; g.lineWidth = lw;
  }
  g.beginPath();
  g.moveTo(x0, y0);
  g.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], x1, y1);
  g.stroke();
  g.setLineDash([]);
  if (growU >= 1) {
    g.fillStyle = `rgba(${rgb},0.85)`;
    g.beginPath(); g.arc(x1, y1, 3, 0, 7); g.fill();
  } else {
    const tip = cubicPt(pts, growU);
    g.fillStyle = `rgba(${rgb},0.95)`;
    g.beginPath(); g.arc(tip[0], tip[1], 3.4, 0, 7); g.fill();
  }
  for (const u of pulseUs) {
    const [px, py] = cubicPt(pts, u % 1);
    glow(g, px, py, 0.3, pulseColor, 0.75 * alpha);
    g.fillStyle = pulseColor;
    g.beginPath(); g.arc(px, py, 2.6, 0, 7); g.fill();
  }
  g.restore();
}

// ---------- 品牌标记（app/brand/logo.svg 三段路径，代码重绘） ----------
export const LOGO_PATHS = {
  u1: 'M26.843 37.036C25.962 37.856 25.091 38.632 24.236 39.346C23.382 40.060 22.544 40.711 21.728 41.283C20.912 41.855 20.118 42.348 19.351 42.750C18.584 43.151 17.843 43.460 17.135 43.671C16.426 43.881 15.749 43.991 15.107 43.999C14.466 44.008 13.861 43.914 13.295 43.720C12.729 43.526 12.203 43.232 11.720 42.845C11.238 42.459 10.798 41.980 10.404 41.421C10.010 40.862 9.662 40.222 9.362 39.519C9.063 38.815 8.811 38.047 8.609 37.235C8.407 36.422 8.254 35.565 8.153 34.686C8.051 33.806 8.000 32.903 8.000 32.000',
  u2: 'M56.000 32.000C56.000 31.097 55.949 30.194 55.847 29.314C55.746 28.435 55.593 27.578 55.391 26.765C55.189 25.953 54.937 25.185 54.638 24.481C54.338 23.778 53.990 23.138 53.596 22.579C53.202 22.020 52.762 21.541 52.280 21.155C51.797 20.768 51.271 20.474 50.705 20.280C50.139 20.086 49.534 19.992 48.893 20.001C48.251 20.009 47.574 20.119 46.865 20.329C46.157 20.540 45.416 20.849 44.649 21.250C43.882 21.652 43.088 22.145 42.272 22.717C41.456 23.289 40.618 23.940 39.764 24.654C38.909 25.368 38.038 26.144 37.157 26.964',
  o: 'M8.000 32.000C8.000 30.953 8.069 29.906 8.205 28.894C8.342 27.883 8.547 26.907 8.818 26.000C9.089 25.093 9.426 24.255 9.827 23.515C10.228 22.774 10.692 22.131 11.215 21.608C11.739 21.084 12.322 20.680 12.960 20.409C13.597 20.138 14.289 20.000 15.029 20.000C15.770 20.000 16.559 20.138 17.390 20.409C18.221 20.680 19.093 21.084 20.000 21.608C20.907 22.131 21.848 22.774 22.816 23.515C23.783 24.255 24.777 25.093 25.788 26.000C26.800 26.907 27.829 27.883 28.867 28.894C29.906 29.906 30.953 30.953 32.000 32.000C33.047 33.047 34.094 34.094 35.133 35.106C36.171 36.117 37.200 37.093 38.212 38.000C39.223 38.907 40.217 39.745 41.184 40.485C42.152 41.226 43.093 41.869 44.000 42.392C44.907 42.916 45.779 43.320 46.610 43.591C47.441 43.862 48.230 44.000 48.971 44.000C49.711 44.000 50.403 43.862 51.040 43.591C51.678 43.320 52.261 42.916 52.785 42.392C53.308 41.869 53.772 41.226 54.173 40.485C54.574 39.745 54.911 38.907 55.182 38.000C55.453 37.093 55.658 36.117 55.795 35.106C55.931 34.094 56.000 33.047 56.000 32.000',
};
let logoP2D: Record<string, Path2D> | null = null;
export function logoMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, o: { dark?: boolean; alpha?: number; drawU?: number } = {}) {
  if (!logoP2D) logoP2D = { u1: new Path2D(LOGO_PATHS.u1), u2: new Path2D(LOGO_PATHS.u2), o: new Path2D(LOGO_PATHS.o) };
  const over = o.dark ? '#B9B6FF' : '#5E5CE6';
  const under = o.dark ? '#8B86FF' : '#817DF2';
  g.save();
  g.translate(x, y); g.scale(size / 64, size / 64);
  g.globalAlpha = o.alpha ?? 1;
  g.lineWidth = 6;
  const drawU = o.drawU ?? 1;
  if (drawU < 1) g.setLineDash([220 * drawU, 440]);
  g.strokeStyle = under; g.lineCap = 'round';
  g.stroke(logoP2D.u1); g.stroke(logoP2D.u2);
  g.strokeStyle = over; g.lineCap = 'butt';
  g.stroke(logoP2D.o);
  g.restore();
}

// ---------- 纸面网格 / 颗粒 / 深空 ----------
let gridSpr: HTMLCanvasElement | null = null;
export function paperGrid(g: CanvasRenderingContext2D, W: number, H: number, alpha = 1, camX = 0, camY = 0, zoom = 1) {
  if (!gridSpr) {
    gridSpr = document.createElement('canvas'); gridSpr.width = gridSpr.height = 96;
    const gg = gridSpr.getContext('2d')!;
    gg.fillStyle = COL.paper; gg.fillRect(0, 0, 96, 96);
    gg.fillStyle = 'rgba(0,0,0,0.055)';
    for (const [px, py] of [[0, 0], [48, 0], [0, 48], [48, 48]]) { gg.beginPath(); gg.arc(px, py, 1.1, 0, 7); gg.fill(); }
    gg.strokeStyle = 'rgba(0,0,0,0.045)'; gg.lineWidth = 1;
    gg.strokeRect(0.5, 0.5, 96, 96);
  }
  g.save(); g.globalAlpha = alpha;
  const s = 96 * zoom;
  const ox = ((-camX * zoom) % s + s) % s - s;
  const oy = ((-camY * zoom) % s + s) % s - s;
  for (let x = ox; x < W; x += s) for (let y = oy; y < H; y += s) g.drawImage(gridSpr, x, y, s, s);
  g.restore();
}
let grainSpr: HTMLCanvasElement | null = null;
export function paperGrain(g: CanvasRenderingContext2D, W: number, H: number, alpha = 0.05) {
  if (!grainSpr) {
    grainSpr = document.createElement('canvas'); grainSpr.width = grainSpr.height = 256;
    const gg = grainSpr.getContext('2d')!;
    const img = gg.createImageData(256, 256);
    const r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + r() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22;
    }
    gg.putImageData(img, 0, 0);
  }
  g.save(); g.globalAlpha = alpha;
  for (let x = 0; x < W; x += 256) for (let y = 0; y < H; y += 256) g.drawImage(grainSpr, x, y);
  g.restore();
}
export function voidBg(g: CanvasRenderingContext2D, W: number, H: number) {
  const grad = g.createRadialGradient(W * 0.5, H * 0.46, 80, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
  grad.addColorStop(0, '#14141F'); grad.addColorStop(0.55, COL.void); grad.addColorStop(1, '#060609');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
}
export function mixColor(c1: string, c2: string, u: number) {
  const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  return `rgb(${Math.round(lerp(ch(a, 16), ch(b, 16), u))},${Math.round(lerp(ch(a, 8), ch(b, 8), u))},${Math.round(lerp(ch(a, 0), ch(b, 0), u))})`;
}
