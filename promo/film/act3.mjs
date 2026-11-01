// Act 3（104–120s）· 顿悟：绑定网闭合成环 → 「✦ 欧拉之环」弹卡 → 坠入深空
// 视觉规格对齐 docs/03 §4：形状自内向外两次发光呼吸、卡片弹簧入场、
// 音效对应 app/src/sfx.js 的 achWeave（523.25 + 783.99 + 1046.5 Hz）。
import { COL, text, paperGrid, paperGrain, seg, segs, clamp01, easeInCubic, easeInOutCubic, easeOutCubic, SPRING, IOS, glow, glassCard, thread, lerp, mixColor, colorWithA } from './lib.mjs';
import { A3, W, H } from './timeline.mjs';

const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';

export function render(g, t) {
  // 坠落进度：116–120 纸面 → 深空（背景用加速曲线，缩短中灰过渡期）
  const fall = segs(t, A3.fall[0], A3.fall[1], easeInOutCubic);
  g.fillStyle = mixColor(COL.paper, COL.void, easeInCubic(fall));
  g.fillRect(0, 0, W, H);
  paperGrid(g, W, H, 0.9 * (1 - fall));

  const dim = segs(t, A3.dimPulse[0], A3.dimPulse[0] + 0.6) * (1 - fall * 0.4);

  g.save();
  // 坠落时装置缩成星
  const cs = 1 - fall * 0.55;
  const cy = lerp(0, -140, fall);
  g.translate(W / 2, H / 2 + cy); g.scale(cs, cs); g.translate(-W / 2, -H / 2);

  rigEuler(g, t, 1 - fall);

  // 环闭光线（webClose）
  const ring = segs(t, A3.webClose[0], A3.webClose[1], easeInOutCubic);
  if (ring > 0 && fall < 1) drawRing(g, t, ring, 1 - fall);

  g.restore();

  // 压暗 + 两次发光呼吸
  if (dim > 0) {
    g.fillStyle = `rgba(11,11,18,${0.22 * dim})`;
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 2; k++) {
      const bt = A3.dimPulse[0] + 0.15 + k * 0.55;
      const bp = seg(t, bt, bt + 0.5);
      if (bp > 0 && bp < 1) {
        const a = Math.sin(bp * Math.PI);
        for (const [x, y, c] of [[700, 520, '#B9B6FF'], [1310, 380, '#8B86FF'], [1310, 660, '#8B86FF'], [1120, 880, '#B9B6FF']]) {
          glow(g, x, y, 1.4 + a * 1.3, c, 0.5 * a);
        }
      }
    }
  }

  achCard(g, t);
  fallStars(g, t, fall);

  if (t > A3.fallText && t < 120.2) {
    text(g, '你刚刚，发现了什么。', W * 0.5, H * 0.42, {
      size: 46, weight: 300, color: mixColor(COL.ink, COL.lit, fall), ls: 6,
      alpha: segs(t, A3.fallText, A3.fallText + 0.9) * (1 - segs(t, 119.4, 120.1)),
    });
  }
  paperGrain(g, W, H, 0.045 * (1 - fall));
}

// θ 同驱：圆 + sin + cos 三线装置（比 Act2 更满的构图）
function rigEuler(g, t, alpha) {
  if (alpha <= 0) return;
  const inP = segs(t, A3.rigBack, A3.rigBack + 0.8, easeOutCubic);
  const cx = 700, cy = 520, r = 150;
  const theta = 16.2 + (t - A3.rigBack) * 2.0 * (1 - segs(t, 109.0, 110.2) * 0.85);
  const P = [cx + Math.cos(theta) * r, cy - Math.sin(theta) * r];
  const waves = [
    { x0: 940, base: 380, fn: Math.sin, col: COL.accent },
    { x0: 940, base: 660, fn: Math.cos, col: COL.palette[2] },
  ];
  const wk = 62, amp = 110;
  const win = 10;
  const thLo = Math.max(0, theta - win);
  const heads = [];

  g.save(); g.globalAlpha = alpha * inP;
  // 圆
  g.strokeStyle = COL.ink; g.lineWidth = 3.6;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = COL.palette[0]; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(P[0], P[1]); g.stroke();
  g.fillStyle = COL.palette[0]; g.beginPath(); g.arc(P[0], P[1], 6, 0, 7); g.fill();
  // 两条波
  for (const wv of waves) {
    g.strokeStyle = 'rgba(29,29,31,0.22)'; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(wv.x0 - 40, wv.base); g.lineTo(1660, wv.base); g.stroke();
    g.strokeStyle = wv.col; g.lineWidth = 3.8; g.lineCap = 'round';
    g.beginPath();
    for (let th = thLo; th <= theta; th += 0.045) {
      const x = wv.x0 + (th - thLo) * wk, y = wv.base - wv.fn(th) * amp;
      th === thLo ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    const head = [wv.x0 + (theta - thLo) * wk, wv.base - wv.fn(theta) * amp];
    heads.push(head);
    g.fillStyle = wv.col; g.beginPath(); g.arc(head[0], head[1], 5.5, 0, 7); g.fill();
    // 梭线
    g.setLineDash([3, 6]); g.strokeStyle = 'rgba(110,110,115,0.7)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(head[0], head[1]); g.stroke();
    g.setLineDash([]);
  }
  // θ 卡（底部中央，简洁版）
  const cardX = 900, cardY = 872, cardW = 440, cardH = 108;
  glassCard(g, cardX, cardY, cardW, cardH, 16, { alpha: inP * alpha });
  g.save(); g.globalAlpha = inP * alpha;   // 卡内元素也要随坠落淡出
  g.font = `600 24px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = COL.ink; g.fillText('θ', cardX + 24, cardY + 40);
  g.fillStyle = COL.accent; g.textAlign = 'right';
  g.fillText((theta / Math.PI).toFixed(2) + 'π', cardX + cardW - 24, cardY + 40);
  const tx0 = cardX + 28, tx1 = cardX + cardW - 28, ty = cardY + 76;
  g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(tx1, ty); g.stroke();
  const u = (theta % (Math.PI * 2)) / (Math.PI * 2);
  g.strokeStyle = COL.accent;
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(lerp(tx0, tx1, u), ty); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(lerp(tx0, tx1, u), ty, 9, 0, 7); g.fill();
  g.strokeStyle = COL.accent; g.lineWidth = 2.4; g.stroke();
  g.restore();
  // 三条丝线
  const anch = [cardX + 30, cardY + 50];
  for (const [i, tp] of [P, heads[0], heads[1]].entries()) {
    thread(g, anch[0], anch[1], tp[0], tp[1], t, {
      alpha: 0.9 * alpha,
      pulseUs: t < 109 ? [(t * 1.7 + i * 0.31) % 1] : [],
    });
  }
  g.restore();
}

// 绑定网闭合成环：四点之间的平滑闭环逐段生长（Catmull-Rom 闭合样条）
function drawRing(g, t, p, alpha) {
  const pts = [[700, 520], [1310, 380], [1310, 660], [1120, 880]];
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = COL.gold; g.lineWidth = 2.2;
  g.shadowColor = 'rgba(201,162,39,0.6)'; g.shadowBlur = 12;
  // 闭合 Catmull-Rom → 贝塞尔段；按 p 沿弧长截断
  const n = pts.length;
  const segsOut = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segsOut.push([p1, c1, c2, p2]);
  }
  const total = segsOut.length;
  const prog = p * total;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  segsOut.forEach(([a, c1, c2, b], i) => {
    const local = clamp01(prog - i);
    if (local <= 0) return;
    if (local >= 1) { g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]); return; }
    // 段内截断：de Casteljau 分割
    const [s] = splitBez(a, c1, c2, b, local);
    g.bezierCurveTo(s[1][0], s[1][1], s[2][0], s[2][1], s[3][0], s[3][1]);
  });
  g.stroke();
  g.restore();
}
function splitBez(p0, p1, p2, p3, u) {
  const m = (a, b) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const q0 = m(p0, p1), q1 = m(p1, p2), q2 = m(p2, p3);
  const r0 = m(q0, q1), r1 = m(q1, q2);
  const s = m(r0, r1);
  return [[p0, q0, r0, s], [s, r1, q2, p3]];
}

// 成就卡：110.2 弹簧落入，115 上滑收走
function achCard(g, t) {
  const [a0, a1] = A3.achCard;
  if (t < a0 - 0.02 || t > A3.achAway[1]) return;
  const enter = SPRING(seg(t, a0, a0 + 0.9));
  const leave = segs(t, A3.achAway[0], A3.achAway[1], easeInOutCubic);
  const cw = 780, chh = 210;
  const x = (W - cw) / 2;
  const y = lerp(-280, 120, clamp01(enter)) - leave * 340;
  const alpha = clamp01(enter) * (1 - leave);
  if (alpha <= 0) return;

  // 背后金色泛光
  glow(g, W / 2, y + chh / 2, 5.5, COL.goldL, 0.35 * alpha);

  glassCard(g, x, y, cw, chh, 20, { dark: true, alpha, border: 'rgba(227,214,140,0.45)' });
  g.save(); g.globalAlpha = alpha;
  // 交织双环徽章（左）：两环相扣
  const bx = x + 108, by = y + chh / 2, br = 30, gap = 26;
  drawWovenBadge(g, bx, by, br, gap);
  // 文案
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `600 44px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.fillStyle = '#F5F3FF';
  g.fillText('欧拉之环', x + 190, by - 44);
  g.font = `300 24px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.fillStyle = 'rgba(245,243,255,0.82)';
  g.fillText('圆在转动，波在生长 —— 原来它们是同一件事。', x + 190, by + 6);
  const subP = segs(t, a0 + 0.8, a0 + 1.5);
  g.font = `400 20px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.fillStyle = `rgba(227,214,140,${0.95 * subP})`;
  g.fillText('✦ 已织入知识网 · 第 7 颗星', x + 190, by + 52);
  g.restore();
}
function drawWovenBadge(g, bx, by, br, gap) {
  // 环 A 完整；环 B 在两个交点处断开（"穿过去"的编织错觉）
  g.save();
  g.strokeStyle = COL.goldL; g.lineWidth = 4.5; g.lineCap = 'round';
  g.shadowColor = 'rgba(227,214,140,0.55)'; g.shadowBlur = 10;
  g.beginPath(); g.arc(bx - gap / 2, by, br, 0, 7); g.stroke();
  // 交点角：d=gap, r=br → cosθ = d/(2r)
  const th = Math.acos(Math.min(1, gap / (2 * br)));
  const cx2 = bx + gap / 2;
  const g1 = 0.16;   // 断口半角
  g.beginPath(); g.arc(cx2, by, br, th + g1, Math.PI - th - g1); g.stroke();
  g.beginPath(); g.arc(cx2, by, br, Math.PI + th + g1, -th - g1 + Math.PI * 2); g.stroke();
  g.restore();
}

// 坠落：四个关键位置坍缩成星
function fallStars(g, t, fall) {
  if (fall <= 0) return;
  const pts = [
    [700, 520, '#B9B6FF'], [1310, 380, '#8B86FF'], [1310, 660, '#8B86FF'], [1120, 880, '#B9B6FF'],
  ];
  pts.forEach(([x, y0, c], i) => {
    const y = y0 - fall * fall * 260 - i * 18 * fall;
    const a = segs(t, A3.fall[0] + 0.4, A3.fall[0] + 1.4) * (1 - segs(t, 119.2, 120.0));
    glow(g, x, y, 1.2, c, a * 0.9);
    if (a > 0.05) {
      g.fillStyle = '#F5F3FF'; g.globalAlpha = a;
      g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
  });
}
