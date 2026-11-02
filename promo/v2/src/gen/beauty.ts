// S2 数学之美混剪（b40–b88）：五段硬切，切点全压拍。
//   单位圆生正弦（几何诚实：r=amp、圆心 y=波基线 → 投影线严格水平）
//   → 傅里叶谐波叠方波 → 抛物线焦点 → 黄金螺线 → 双纽线（品牌之形，留线头给 S3）
import { COL } from '../design';
import { glow, rng, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, IOS, text } from './engine';

const W = 1920, H = 1080;

// ---------- 段一：单位圆 → 正弦（b40–b56） ----------
function unitSine(g: CanvasRenderingContext2D, b: number) {
  // 圆接自 S1 落点：(640,540) r=150；相机同位起始 → 连续
  const cx = 640, cy = 540, r = 150;
  const x0 = 810, base = 540, amp = 150, k = 47.75;
  const theta = Math.max(0, b - 40.5) * (Math.PI * 2 / 3.7);   // 16 拍 ≈ 2.2 圈
  const thMax = Math.min(theta, 4.35 * Math.PI);
  const P = [cx + Math.cos(thMax) * r, cy - Math.sin(thMax) * r];
  const headX = x0 + thMax * k;
  const headY = base - Math.sin(thMax) * amp;

  // 基线
  g.strokeStyle = 'rgba(29,29,31,0.25)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(x0 - 60, base); g.lineTo(1620, base); g.stroke();
  // 圆 + 半径
  g.strokeStyle = COL.ink; g.lineWidth = 3.6;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = COL.palette[0]; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(P[0], P[1]); g.stroke();
  // 波
  g.strokeStyle = COL.accent; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath();
  for (let th = 0; th <= thMax; th += 0.03) {
    const x = x0 + th * k, y = base - Math.sin(th) * amp;
    th === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // 投影线：严格水平（P.y === headY，恒等）
  g.setLineDash([3, 6]); g.strokeStyle = 'rgba(110,110,115,0.85)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(headX, P[1]); g.stroke();
  g.setLineDash([]);
  g.fillStyle = COL.palette[0]; g.beginPath(); g.arc(P[0], P[1], 6, 0, 7); g.fill();
  g.fillStyle = COL.accent; g.beginPath(); g.arc(headX, headY, 6, 0, 7); g.fill();
  glow(g, headX, headY, 0.42, COL.accentL, 0.85);
  // 解说字幕（产品原句：正弦波节点的 flavor）
  text(g, '圆周运动的影子，是一条波。', 960, 940, {
    size: 36, color: COL.ink2, ls: 3,
    alpha: segs(b, 44, 45) * (1 - segs(b, 54.6, 55.6)),
  });
}

// ---------- 段二：傅里叶（b56–b64） ----------
function fourier(g: CanvasRenderingContext2D, b: number) {
  const x0 = 260, x1 = 1660, base = 540, kk = 120;
  // 入场窗口前移过切点（b56）：切帧即有内容（硬切，无空帧）
  const ghostIn = segs(b, 55.5, 56.6);
  const merge = segs(b, 57.5, 60, easeInOutCubic);
  const head = segs(b, 58, 62.2, easeInOutCubic);
  const spread = [0, 168, 300];
  const HARMS = [
    { k: 1, amp: 132, col: COL.accent, lw: 3.4, a: 0.95 },
    { k: 3, amp: 44, col: COL.accentL, lw: 2.5, a: 0.7 },
    { k: 5, amp: 26.4, col: COL.palette[3], lw: 2.5, a: 0.6 },
  ];
  for (let hi = 0; hi < 3; hi++) {
    const h = HARMS[hi];
    g.save();
    g.globalAlpha = ghostIn * h.a * (hi === 0 ? 1 - merge * 0.3 : 1 - merge * 0.92);
    g.strokeStyle = h.col; g.lineWidth = h.lw; g.lineCap = 'round';
    g.beginPath();
    for (let x = x0; x <= x1; x += 6) {
      const th = (x - x0) / kk;
      const y = base - Math.sin(th * h.k) * h.amp + (1 - merge) * spread[hi];
      x === x0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }
  if (head > 0) {
    const xe = x0 + (x1 - x0) * head;
    g.save();
    g.strokeStyle = COL.palette[5]; g.lineWidth = 4.4; g.lineCap = 'round';
    g.shadowColor = 'rgba(255,159,10,0.35)'; g.shadowBlur = 10;
    g.beginPath();
    for (let x = x0; x <= xe; x += 4) {
      const th = (x - x0) / kk;
      const y = base - (Math.sin(th) * 132 + Math.sin(3 * th) * 44 + Math.sin(5 * th) * 26.4);
      x === x0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
    const th = (xe - x0) / kk;
    glow(g, xe, base - (Math.sin(th) * 132 + Math.sin(3 * th) * 44 + Math.sin(5 * th) * 26.4), 0.55, COL.palette[5], 0.9);
  }
  text(g, 'sin x  +  sin 3x / 3  +  sin 5x / 5  +  …', 960, 920, {
    size: 38, color: COL.ink2, font: '"SF Mono",Consolas,monospace',
    alpha: segs(b, 61.5, 62.5) * (1 - segs(b, 63.4, 64)),
  });
}

// ---------- 段三：抛物线（b64–b72） ----------
function parabola(g: CanvasRenderingContext2D, b: number) {
  const vx = 960, span = 430;
  const drawIn = segs(b, 63.6, 65.4, easeInOutCubic);   // 前移过切点：切帧已有弧段
  g.save();
  g.strokeStyle = COL.palette[3]; g.lineWidth = 4.2; g.lineCap = 'round';
  g.beginPath();
  const xs = vx - span, xe = vx - span + 2 * span * drawIn;
  for (let x = xs; x <= xe; x += 6) {
    const y = 330 + (x - vx) * (x - vx) / 320;
    x === xs ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.restore();
  // 焦点 + 准线
  const fIn = segs(b, 67, 67.8);
  if (fIn > 0) {
    const fY = 330 + 80;
    g.save(); g.globalAlpha = fIn;
    g.setLineDash([6, 7]); g.strokeStyle = 'rgba(110,110,115,0.8)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(vx - span, 330 + 320); g.lineTo(vx + span, 330 + 320); g.stroke();
    g.setLineDash([]);
    g.fillStyle = COL.gold; g.beginPath(); g.arc(vx, fY, 6, 0, 7); g.fill();
    glow(g, vx, fY, 0.55, COL.goldL, 0.9);
    g.restore();
  }
  // 抛体点（沿抛物线飞）
  const fly = seg(b, 68, 71);
  if (fly > 0) {
    const x = vx - span + 2 * span * fly;
    const y = 330 + (x - vx) * (x - vx) / 320;
    for (let i = 1; i <= 6; i++) {
      const xf = x - i * 30;
      if (xf < vx - span) break;
      g.save(); g.globalAlpha = 0.5 * (1 - i / 7);
      g.fillStyle = COL.palette[3]; g.beginPath(); g.arc(xf, 330 + (xf - vx) * (xf - vx) / 320, 3.6, 0, 7); g.fill();
      g.restore();
    }
    g.fillStyle = COL.palette[3]; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
  }
}

// ---------- 段四：黄金螺线（b72–b80） ----------
function fibonacci(g: CanvasRenderingContext2D, b: number) {
  const u = 34;
  const ox = 960 - 21 * u / 2, oy = 530 - 13 * u / 2;
  const BLK: [[number, number, number], [number, number], [number, number], [number, number]][] = [
    [[0, 0, 13], [13, 13], [0, 13], [13, 0]],
    [[13, 0, 8], [13, 8], [13, 0], [21, 8]],
    [[16, 8, 5], [16, 8], [21, 8], [16, 13]],
    [[13, 10, 3], [16, 10], [16, 13], [13, 10]],
    [[13, 8, 2], [15, 10], [13, 10], [15, 8]],
    [[15, 8, 1], [15, 9], [15, 8], [16, 9]],
    [[15, 9, 1], [15, 9], [16, 9], [15, 10]],
  ];
  const grow = segs(b, 71.6, 76.8, easeInOutCubic) * BLK.length;   // 前移过切点
  BLK.forEach(([sq, c, A, B], i) => {
    const local = clamp01(grow - i);
    if (local <= 0) return;
    const [sx, sy, ss] = sq;
    g.save();
    g.globalAlpha = 0.4 * local;
    g.strokeStyle = COL.gold; g.lineWidth = 1.4;
    g.strokeRect(ox + sx * u, oy + sy * u, ss * u, ss * u);
    g.restore();
    const cxp = c[0] * u + ox, cyp = c[1] * u + oy;
    const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
    const a1 = Math.atan2(B[1] - c[1], B[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    g.save();
    g.strokeStyle = COL.gold; g.lineWidth = 3.6; g.lineCap = 'round';
    g.shadowColor = 'rgba(201,162,39,0.3)'; g.shadowBlur = 8;
    g.beginPath();
    const steps = Math.max(2, Math.ceil(26 * local));
    for (let kk = 0; kk <= steps; kk++) {
      const a = a0 + da * local * (kk / steps);
      const x = cxp + Math.cos(a) * ss * u, y = cyp + Math.sin(a) * ss * u;
      kk ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.restore();
    if (i === Math.floor(grow) && local < 1) {
      const end = a0 + da * local;
      glow(g, cxp + Math.cos(end) * ss * u, cyp + Math.sin(end) * ss * u, 0.5, COL.goldL, 0.85);
    }
  });
  text(g, 'φ = 1.618…', 960 + 350, 800, {
    size: 38, color: COL.ink2, font: '"SF Mono",Consolas,monospace',
    alpha: segs(b, 78, 78.8) * (1 - segs(b, 79.4, 80)),
  });
}

// ---------- 段五：双纽线（b80–b88） ----------
export function lemniscatePt(cx: number, cy: number, sc: number, th: number): [number, number] {
  const d = 1 + Math.sin(th) * Math.sin(th);
  return [cx + (sc * Math.cos(th)) / d, cy + ((sc * 0.72 * Math.sin(th) * Math.cos(th)) / d) * 2];
}
function lemniscate(g: CanvasRenderingContext2D, b: number) {
  const cx = 960, cy = 500, sc = 440;
  const drawP = segs(b, 79.6, 85.2, easeInOutCubic);   // 前移过切点：切帧已有线头
  const thEnd = Math.PI * 2 * drawP;
  g.save();
  g.strokeStyle = COL.accent; g.lineWidth = 5; g.lineCap = 'round';
  g.shadowColor = 'rgba(94,92,230,0.4)'; g.shadowBlur = 14;
  g.beginPath();
  for (let th = 0; th <= thEnd; th += 0.02) {
    const [x, y] = lemniscatePt(cx, cy, sc, th);
    th === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.restore();
  if (drawP > 0 && drawP < 1) {
    const [x, y] = lemniscatePt(cx, cy, sc, thEnd);
    glow(g, x, y, 0.62, COL.accentL, 0.9);
  }
  if (drawP >= 1) {
    const beat = Math.sin(b * Math.PI) * 0.5 + 0.5;         // 随拍呼吸
    glow(g, cx, cy, 0.5 + beat * 0.28, COL.accentL, 0.4);
    // 线头（右端）持续发亮 —— S3 线头接力从这里出发
    const [tx, ty] = lemniscatePt(cx, cy, sc, Math.PI * 2);
    glow(g, tx, ty, 0.4, COL.accent, 0.7);
  }
  text(g, '原语极少，组合无穷。', 960, 890, {
    size: 40, color: COL.ink, ls: 5,
    alpha: segs(b, 84, 85),
  });
}

// ---------- 主入口：硬切 ----------
export function draw(g: CanvasRenderingContext2D, b: number) {
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);
  // 镜头：每段一次极缓推近（元素层不动，相机 1→1.03）
  const segStart = b < 56 ? 40 : b < 64 ? 56 : b < 72 ? 64 : b < 80 ? 72 : 80;
  const z = 1 + 0.05 * seg(b, segStart, segStart + 8);
  g.save();
  g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-960, -540);

  if (b < 56) unitSine(g, b);
  else if (b < 64) fourier(g, b);
  else if (b < 72) parabola(g, b);
  else if (b < 80) fibonacci(g, b);
  else lemniscate(g, b);

  g.restore();
}
