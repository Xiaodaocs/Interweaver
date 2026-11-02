// S4 微积分三连闪（b152–b176）：beat-cut paparazzi —— 三闪各压一拍，闪后沉降。
//   一闪 割线→切线（极限）/ 二闪 导函数生长 / 三闪 黎曼和收敛；末尾 2×2 同播收束。
// 微场景全部取自产品微积分工具组的真实语义（docs/02 §10）。
import { COL } from '../design';
import { glassCard, hashStr, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, SPRING, IOS, text } from './engine';

const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';

// 演示曲线（与 v1 同一座"山包"）
const fx = (u: number) => Math.sin(u * Math.PI) * 0.82 + 0.1;
const dfx = (u: number) => Math.cos(u * Math.PI) * Math.PI * 0.82;

function plot(cw: number, ch: number, u: number): [number, number] {
  return [60 + u * (cw - 120), ch - 58 - fx(u) * (ch - 150)];
}
function axes(g: CanvasRenderingContext2D, cw: number, ch: number) {
  g.strokeStyle = 'rgba(29,29,31,0.28)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(36, ch - 58); g.lineTo(cw - 26, ch - 58); g.stroke();
  g.beginPath(); g.moveTo(56, 24); g.lineTo(56, ch - 40); g.stroke();
}
function curve(g: CanvasRenderingContext2D, cw: number, ch: number, color = COL.accent, lw = 3.6) {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 80; i++) {
    const [x, y] = plot(cw, ch, i / 80);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}
function probeCard(g: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, value: string, color = COL.accent) {
  glassCard(g, x, y, w, 56, 12, {});
  g.font = `400 16px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = COL.ink2; g.fillText(label, x + 14, y + 28);
  g.font = `600 20px ${NUM}`; g.textAlign = 'right';
  g.fillStyle = color; g.fillText(value, x + w - 14, y + 28);
}
function lineThrough(g: CanvasRenderingContext2D, x0: number, y0: number, m: number, cw: number) {
  g.beginPath();
  g.moveTo(30, y0 + (x0 - 30) * m);
  g.lineTo(cw - 20, y0 - (cw - 20 - x0) * m);
  g.stroke();
}

// ---- 三个微场景（本地拍 bl = b − 段起） ----
function secant(g: CanvasRenderingContext2D, cw: number, ch: number, bl: number) {
  axes(g, cw, ch); curve(g, cw, ch);
  const h = 0.42 * (1 - easeInOutCubic(clamp01(bl / 4.4))) + 0.012;
  const uP = 0.34, uQ = Math.min(0.34 + h, 0.96);
  const [px, py] = plot(cw, ch, uP);
  const [qx, qy] = plot(cw, ch, uQ);
  const mT = (dfx(uP) * (ch - 150)) / (cw - 120);
  g.save(); g.globalAlpha = 0.9; g.strokeStyle = COL.gold; g.lineWidth = 2.6;
  lineThrough(g, px, py, mT, cw); g.restore();
  const mS = -(qy - py) / (qx - px);
  g.strokeStyle = COL.accent; g.lineWidth = 3.2;
  lineThrough(g, px, py, mS, cw);
  g.fillStyle = COL.ink; g.beginPath(); g.arc(px, py, 5.5, 0, 7); g.fill();
  g.fillStyle = COL.accent; g.beginPath(); g.arc(qx, qy, 5.5, 0, 7); g.fill();
  const diff = Math.abs(mS - mT);
  probeCard(g, cw - 276, 22, 254, 'm割 − m切', diff < 0.02 ? '≈ 0.000' : diff.toFixed(3), diff < 0.06 ? COL.gold : COL.accent);
}
function deriv(g: CanvasRenderingContext2D, cw: number, ch: number, bl: number) {
  axes(g, cw, ch); curve(g, cw, ch);
  const uA = 0.08 + 0.8 * easeInOutCubic(clamp01(bl / 4.6));
  const [ax, ay] = plot(cw, ch, uA);
  const m = (dfx(uA) * (ch - 150)) / (cw - 120);
  g.strokeStyle = COL.gold; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(ax - 100, ay + 100 * m); g.lineTo(ax + 100, ay - 100 * m); g.stroke();
  g.fillStyle = COL.ink; g.beginPath(); g.arc(ax, ay, 5.5, 0, 7); g.fill();
  const bandY = ch - 30;
  g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(56, bandY); g.lineTo(cw - 26, bandY); g.stroke();
  g.strokeStyle = COL.palette[2]; g.lineWidth = 2.8; g.lineCap = 'round';
  g.beginPath();
  for (let u = 0.06; u <= uA; u += 0.01) {
    const x = 60 + u * (cw - 120), y = bandY + 8 - dfx(u) * 14;
    u === 0.06 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = COL.palette[2];
  g.beginPath(); g.arc(60 + uA * (cw - 120), bandY + 8 - dfx(uA) * 14, 4.5, 0, 7); g.fill();
  text(g, 'f′', cw - 48, bandY + 2, { size: 20, color: COL.ink2, font: NUM });
}
function integral(g: CanvasRenderingContext2D, cw: number, ch: number, bl: number) {
  axes(g, cw, ch);
  const n = Math.round(4 + 26 * clamp01(bl / 4.6));
  const u0 = 0.12, u1 = 0.9;
  for (let i = 0; i < n; i++) {
    const ua = u0 + (u1 - u0) * (i / n), ub = u0 + (u1 - u0) * ((i + 1) / n);
    const [xa] = plot(cw, ch, ua);
    const [xb] = plot(cw, ch, ub);
    const [, ym] = plot(cw, ch, (ua + ub) / 2);
    const base = ch - 58;
    g.fillStyle = `rgba(94,92,230,${0.16 + 0.1 * (n / 30)})`;
    g.fillRect(xa, ym, xb - xa - 0.5, base - ym);
    g.strokeStyle = 'rgba(94,92,230,0.55)'; g.lineWidth = 1;
    g.strokeRect(xa, ym, xb - xa - 0.5, base - ym);
  }
  curve(g, cw, ch);
  let S = 0;
  for (let i = 0; i < n; i++) S += fx(u0 + (u1 - u0) * ((i + 0.5) / n)) * ((u1 - u0) / n);
  probeCard(g, cw - 276, 22, 254, 'S（n=' + n + '）', S.toFixed(4), n > 26 ? COL.gold : COL.accent);
}
function thales(g: CanvasRenderingContext2D, cw: number, ch: number, bl: number) {
  const cx = cw / 2, cy = ch - 130, r = Math.min(cw, ch) * 0.34;
  g.strokeStyle = COL.ink; g.lineWidth = 3.4;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.stroke();
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
  const swing = Math.sin(bl * 1.4) * 0.5 + 0.5;
  const a = Math.PI * (0.24 + 0.52 * easeInOutCubic(swing));
  const P: [number, number] = [cx - Math.cos(a) * r, cy - Math.sin(a) * r];
  g.strokeStyle = COL.accent; g.lineWidth = 2.8;
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(P[0], P[1]); g.lineTo(cx + r, cy); g.stroke();
  const v1 = [cx - r - P[0], cy - P[1]], v2 = [cx + r - P[0], cy - P[1]];
  const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
  const s = 16;
  g.strokeStyle = COL.gold; g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(P[0] + (v1[0] / n1) * s, P[1] + (v1[1] / n1) * s);
  g.lineTo(P[0] + (v1[0] / n1) * s + (v2[0] / n2) * s, P[1] + (v1[1] / n1) * s + (v2[1] / n2) * s);
  g.lineTo(P[0] + (v2[0] / n2) * s, P[1] + (v2[1] / n2) * s);
  g.stroke();
  g.fillStyle = COL.ink; g.beginPath(); g.arc(P[0], P[1], 5.5, 0, 7); g.fill();
  probeCard(g, cw - 276, 22, 254, '圆周角 ∠P', '90.00°', COL.gold);
}

const MINIS = { secant, deriv, integral, thales } as const;
type MiniId = keyof typeof MINIS;
const miniCanvases = new Map<string, HTMLCanvasElement>();
function miniCanvas(id: string, w: number, h: number) {
  let c = miniCanvases.get(id);
  if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; miniCanvases.set(id, c); }
  return c;
}
function renderMini(id: MiniId, w: number, h: number, bl: number) {
  const c = miniCanvas(id + w + 'x' + h, w, h);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  MINIS[id](g, w, h, bl);
  return c;
}

// 三连闪配置：[切点拍, 场景, caption]
const FLASHES: [number, MiniId, string][] = [
  [152, 'secant', '割线逼近切线 —— 极限，亲眼看见'],
  [158, 'deriv', '每一点的斜率，连成一条新曲线'],
  [164, 'integral', '无限细分，便是积分'],
];
const GRID_META: { id: MiniId; label: string }[] = [
  { id: 'secant', label: '割线 → 切线' },
  { id: 'deriv', label: '函数与它的导函数' },
  { id: 'integral', label: '积分区域 · 黎曼和' },
  { id: 'thales', label: '泰勒斯定理' },
];

export function draw(g: CanvasRenderingContext2D, b: number, W: number, H: number) {
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);

  if (b < 170) {
    // ---- 三连闪（paparazzi）：当前段场景 + 白闪 + 沉降 ----
    const idx = FLASHES.findIndex(([fb]) => b >= fb && b < fb + 6);
    const cur = FLASHES[idx < 0 ? 2 : idx];
    const [fb, id, cap] = cur;
    const bl = b - fb;
    // 沉降：scale 1.03→1 + y −16→0（6f≈0.2 拍）
    const settle = segs(bl, 0, 0.22, easeOutCubic);
    const shake = bl < 0.14 ? (hashStr('f' + Math.floor(bl * 30)) % 5) - 2 : 0;
    g.save();
    g.translate(W / 2, H / 2 + (1 - settle) * -16 + shake);
    g.scale(1.03 - 0.03 * settle, 1.03 - 0.03 * settle);
    g.translate(-W / 2, -H / 2);
    const fw = 1560, fh = 740, fx0 = 180, fy0 = 130;
    glassCard(g, fx0 - 24, fy0 - 24, fw + 48, fh + 48, 20, {});
    g.drawImage(renderMini(id, fw, fh, bl + 1.2), fx0, fy0);
    text(g, cap, 960, 968, { size: 34, color: COL.ink, ls: 2, alpha: segs(bl, 0.5, 1.2) });
    g.restore();
    // 白闪：0.95→0 走 4f
    if (bl < 0.14) {
      g.fillStyle = `rgba(255,255,255,${0.95 * (1 - bl / 0.14)})`;
      g.fillRect(0, 0, W, H);
    }
    return;
  }

  // ---- 2×2 同播收束（b170–b176） ----
  const cw = 513, ch = 330, gap = 24, gx0 = 80, gy0 = 210;
  GRID_META.forEach((m, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const cellX = gx0 + col * (cw + gap), cellY = gy0 + row * (ch + gap);
    const p = SPRING(seg(b, 170 + i * 0.28, 170 + i * 0.28 + 2.4));
    if (p <= 0) return;
    const sx = lerp(180, cellX, p), sy = lerp(130, cellY, p);
    const sw = lerp(1560, cw, p), sh = lerp(740, ch, p);
    glassCard(g, sx - 16, sy - 48, sw + 32, sh + 82, 18, { alpha: clamp01(p) });
    g.save(); g.globalAlpha = clamp01(p);
    g.drawImage(renderMini(m.id, cw, ch, b - 170 + 1.2), sx, sy, sw, sh);
    g.restore();
    text(g, m.label, sx + 4, sy - 24, { size: 32, color: COL.ink2, align: 'left', alpha: clamp01(p) });
  });
  // 网格就绪前（b170–170.4），上一幕闪景淡出垫底
  const holdA = 1 - segs(b, 170, 170.5);
  if (holdA > 0) {
    g.save(); g.globalAlpha = holdA;
    g.drawImage(renderMini('integral', 1560, 740, b - 164 + 1.2), 180, 130);
    g.restore();
  }
}
