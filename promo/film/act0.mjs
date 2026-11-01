// Act 0（0–16s）· 吐槽：数学 = 背公式、刷题、考试？
// 纸面上灰蒙蒙的符号墙越压越近，直到一条紫色正弦把它扫开 —— 「数学，本来很美。」
import { COL, text, textIn, paperGrid, paperGrain, rng, seg, segs, clamp01, easeOutCubic, easeInOutCubic, IOS, glow, colorWithA, rrect } from './lib.mjs';
import { A0, W, H } from './timeline.mjs';

const GLYPHS = [
  '∫ x² dx = x³/3 + C', 'e^(iπ) + 1 = 0', 'lim  h→0', '(f(x+h)−f(x))/h', 'a² + b² = c²',
  'Σ 1/n² = π²/6', 'sin²θ + cos²θ = 1', 'y = kx + b', 'Δy/Δx', '√2 ≈ 1.4142',
  '∀ε>0 ∃δ>0', 'f′(x)', 'x = (−b ± √D) / 2a', 'log(ab) = log a + log b', 'tanθ = sinθ/cosθ',
  'S = πr²', 'V = ⁴⁄₃πr³', 'm = (y₂−y₁)/(x₂−x₁)', 'θ = 60°', 'P(A∪B) = P(A)+P(B)−P(A∩B)',
  'dy/dx = 2x', 'π ≈ 3.14159', 'C(n,k) = n!/k!(n−k)!', 'sin(α+β) = …', '∂z/∂x', 'λ = 2π/k',
  'f(x) = 0', 'x³ − 2x + 1', '√(x²+y²)', 'n! = n·(n−1)!', 'ζ(s) = Σ 1/nˢ', 'cos 2θ = 1 − 2sin²θ',
];

let wall = null;            // 预渲染的符号墙
let particles = null;       // 扫开时飞溅的灰色符号
let wallSeed = null;

function buildWall() {
  wall = document.createElement('canvas');
  wall.width = 2400; wall.height = 1400;
  const g = wall.getContext('2d');
  const r = rng(20261101);
  // 满墙灰色公式，像写满的板书
  for (let row = 0; row < 15; row++) {
    const y = 60 + row * 92 + (r() - 0.5) * 30;
    let x = 40 + r() * 80;
    while (x < 2320) {
      const s = GLYPHS[Math.floor(r() * GLYPHS.length)];
      const size = 17 + r() * 13;
      const rot = (r() - 0.5) * 0.06;
      g.save();
      g.translate(x, y); g.rotate(rot);
      g.font = `${r() < 0.25 ? 600 : 400} ${size}px "SF Mono","Cascadia Mono",Consolas,monospace`;
      g.fillStyle = `rgba(110,110,115,${0.32 + r() * 0.42})`;
      g.textBaseline = 'middle';
      g.fillText(s, 0, 0);
      x += g.measureText(s).width + 26 + r() * 60;
      g.restore();
    }
  }
  // 随手的小几何草图（灰）
  for (let i = 0; i < 9; i++) {
    const cx = 120 + r() * 2160, cy = 120 + r() * 1160, rad = 26 + r() * 42;
    g.save();
    g.strokeStyle = `rgba(110,110,115,${0.25 + r() * 0.3})`;
    g.lineWidth = 1.6;
    if (r() < 0.5) { g.beginPath(); g.arc(cx, cy, r2(r, 26, 42), 0, 7); g.stroke(); }
    else {
      g.beginPath();
      for (let k = 0; k <= 3; k++) {
        const a = -Math.PI / 2 + k * (Math.PI * 2 / 3) + r() * 0.2;
        const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }
  function r2(rr, a, b) { return a + rr() * (b - a); }
  // 扫开时的飞溅粒子
  const pr = rng(9917);
  particles = [];
  for (let i = 0; i < 110; i++) {
    particles.push({
      ch: '∫ΣπθΔ√λ∂φ∞±≈'[Math.floor(pr() * 12)],
      dy: (pr() - 0.5) * 760, dx: pr() * 300,
      vx: 60 + pr() * 320, vy: -(40 + pr() * 260),
      rot: (pr() - 0.5) * 2, vr: (pr() - 0.5) * 3,
      size: 14 + pr() * 22, delay: pr() * 0.25,
    });
  }
}

export function render(g, t) {
  if (!wall) buildWall();
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);

  // 镜头：8–12s 缓推近（压迫感），12s 后定住
  const z = 1 + 0.38 * segs(t, A0.push[0], A0.push[1], easeInOutCubic);
  const cx = W * 0.5 + 90 * segs(t, A0.push[0], A0.push[1], easeInOutCubic);
  const cy = H * 0.52;

  g.save();
  g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cx, -cy);

  // 符号墙：glitch 期间切片错位 + 闪烁
  const glitch = segs(t, A0.glitch[0], A0.glitch[1]);
  if (glitch <= 0) {
    g.drawImage(wall, -300, -230);
  } else {
    const r = rng(Math.floor(t * 30));   // 帧级抖动（确定性）
    const slices = 16;
    for (let i = 0; i < slices; i++) {
      const sy = -300 + (i / slices) * 1700;
      const off = (r() - 0.5) * 46 * glitch;
      g.globalAlpha = 1 - glitch * 0.25 * r();
      g.drawImage(wall, 0, (sy + 300), 2400, 1400 / slices, -300 + off, sy, 2400, 1400 / slices);
    }
    g.globalAlpha = 1;
  }

  // 扫开：纸白从左侧覆盖到扫弦前沿，前沿是紫色正弦
  const sw = segs(t, A0.sweep[0], A0.sweep[1], IOS);
  if (sw > 0) {
    const front = -320 + (W + 640) * sw;
    const grad = g.createLinearGradient(front - 560, 0, front, 0);
    grad.addColorStop(0, COL.paper); grad.addColorStop(1, colorWithA('#F5F5F7', 0));
    g.fillStyle = COL.paper; g.fillRect(-600, -400, front - 560 + 600, 2000);
    g.fillStyle = grad; g.fillRect(front - 560, -400, 560, 2000);
    // 粒子飞溅
    const st = t - A0.sweep[0];
    for (const p of particles) {
      const pt = st - p.delay;
      if (pt <= 0 || pt > 1.1) continue;
      const px = front - p.dx + p.vx * pt;
      const py = H * 0.5 + p.dy + p.vy * pt + 400 * pt * pt;
      g.save();
      g.translate(px, py); g.rotate(p.rot + p.vr * pt);
      g.globalAlpha = clamp01(1 - pt / 1.1) * 0.85;
      g.font = `${p.size}px Consolas,monospace`;
      g.fillStyle = COL.ink2; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.ch, 0, 0);
      g.restore();
    }
    // 紫色正弦扫线：前沿振幅最大，向后渐息
    g.save();
    g.strokeStyle = COL.accent; g.lineWidth = 5; g.lineCap = 'round';
    g.shadowColor = 'rgba(94,92,230,0.55)'; g.shadowBlur = 18;
    g.beginPath();
    const base = H * 0.5;
    let first = true;
    for (let x = -320; x <= front; x += 8) {
      const env = clamp01((front - x) / 520) * (0.3 + 0.7 * clamp01((front - x) / 200));
      const y = base + Math.sin(x * 0.021 + t * 2.2) * 190 * env;
      first ? g.moveTo(x, y) : g.lineTo(x, y);
      first = false;
    }
    g.stroke();
    g.restore();
    glow(g, front, base + Math.sin(front * 0.021 + t * 2.2) * 190, 1.6, COL.accentL, 0.9);
  }
  g.restore();

  paperGrain(g, W, H, 0.05);

  // ---- UI 层（不随镜头） ----
  // 砸章：背公式。/ 刷题。/ 考试。
  const stamps = ['背公式。', '刷题。', '考试。'];
  A0.stamps.forEach((ts, i) => {
    const p = segs(t, ts, ts + 0.38, easeOutCubic);
    if (p <= 0) return;
    const sc = 1.35 - 0.35 * p;
    const x = 330, y = 300 + i * 128;
    g.save();
    g.translate(x, y); g.rotate(-0.035 + i * 0.012); g.scale(sc, sc);
    g.globalAlpha = p * (t < A0.sweep[0] ? 1 : Math.max(0, 1 - segs(t, A0.sweep[0], A0.sweep[0] + 0.4) * 1.4));
    g.font = `600 52px "PingFang SC","Microsoft YaHei",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(29,29,31,0.88)';
    g.fillText(stamps[i], 0, 0);
    g.strokeStyle = 'rgba(29,29,31,0.5)'; g.lineWidth = 2.5;
    const tw = g.measureText(stamps[i]).width;
    rrect(g, -tw / 2 - 26, -44, tw + 52, 88, 10); g.stroke();
    g.restore();
  });

  // 「数学，好像只是这些。」
  if (t > 8.6 && t < A0.glitch[0] + 0.3) {
    textIn(g, '数学，好像只是这些。', W * 0.5, H * 0.5, segs(t, 8.6, 9.4), { size: 60, weight: 300, color: 'rgba(29,29,31,0.85)', ls: 4 });
  }

  // 「数学，本来很美。」
  if (t > A0.beautyText) {
    const p = segs(t, A0.beautyText, A0.beautyText + 0.9, easeOutCubic);
    const out = segs(t, 15.9, 16.4);
    text(g, '数学，本来很美。', W * 0.5, H * 0.34 + (1 - p) * 30, {
      size: 76, weight: 500, color: COL.ink, ls: 8, alpha: p * (1 - out),
    });
    text(g, '它从来不是符号的牢笼，而是万物相连的线索。', W * 0.5, H * 0.34 + 74, {
      size: 26, weight: 300, color: COL.ink2, ls: 3, alpha: segs(t, A0.beautyText + 0.5, A0.beautyText + 1.3) * (1 - out),
    });
  }
}
