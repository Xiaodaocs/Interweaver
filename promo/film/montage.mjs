// Act 2 蒙太奇的四个微场景（82–92s 逐个全屏；92–104s 缩成 2×2 同播）。
// 每个微场景都是"画进给定 ctx（自带宽高）+ 本地循环时间"的纯函数，两种场合复用同一套。
// 内容全部来自产品真实能力（docs/02 §10 微积分工具组、§7 约束）：
//   secant   割线逼近切线（h→0，差值观察器归零）—— 成就「极限的一瞥」
//   deriv    切线点滑动，导函数曲线在下方同步生长 —— 「函数与导函数」
//   integral 积分区域矩形加密，S 收敛 —— 「积分区域」
//   thales   半圆上的点拖动，圆周角恒为 90° —— 「泰勒斯定理」
import { COL, text, rrect, glassCard, clamp01, segs, easeInOutCubic, glow } from './lib.mjs';

const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';

function axes(g, cw, ch) {
  g.strokeStyle = 'rgba(29,29,31,0.28)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(36, ch - 58); g.lineTo(cw - 26, ch - 58); g.stroke();   // x 轴
  g.beginPath(); g.moveTo(56, 24); g.lineTo(56, ch - 40); g.stroke();             // y 轴
}

// 演示曲线（四个微场景共用同一个"山包"，视觉统一）
const fx = (u) => Math.sin(u * Math.PI) * 0.82 + 0.1;   // u∈[0,1] → 0..0.92
const dfx = (u) => Math.cos(u * Math.PI) * Math.PI * 0.82;
function plot(g, cw, ch, u) {
  return [60 + u * (cw - 120), ch - 58 - fx(u) * (ch - 150)];
}
function curve(g, cw, ch, color = COL.accent, lw = 3.6) {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 80; i++) {
    const [x, y] = plot(g, cw, ch, i / 80);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}
function probeCard(g, x, y, w, label, value, alpha = 1, color = COL.accent) {
  g.save(); g.globalAlpha = alpha;
  glassCard(g, x, y, w, 56, 12, {});
  g.font = `400 15px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = COL.ink2; g.fillText(label, x + 14, y + 28);
  g.font = `600 19px ${NUM}`; g.textAlign = 'right';
  g.fillStyle = color; g.fillText(value, x + w - 14, y + 28);
  g.restore();
}

export const MINIS = {
  // ---- 割线 → 切线 ----
  secant(g, cw, ch, tl) {
    axes(g, cw, ch);
    curve(g, cw, ch);
    const cyc = (tl % 3.0) / 3.0;
    const h = 0.42 * (1 - easeInOutCubic(clamp01(cyc * 1.35))) + 0.012;   // h: 0.43→0.012
    const uP = 0.34, uQ = Math.min(0.34 + h, 0.96);
    const [px, py] = plot(g, cw, ch, uP);
    const [qx, qy] = plot(g, cw, ch, uQ);
    // 切线（目标，淡金）
    const mT = dfx(uP) * (ch - 150) / (cw - 120);
    g.save(); g.globalAlpha = 0.9;
    g.strokeStyle = COL.gold; g.lineWidth = 2.6;
    line(g, px, py, mT, cw, ch);
    g.restore();
    // 割线（紫，随 h 旋转贴合）—— line() 的 m 约定为 y = y0 − m·(x−x0)，屏幕斜率取反
    const mS = -(qy - py) / (qx - px);
    g.strokeStyle = COL.accent; g.lineWidth = 3.2;
    line(g, px, py, mS, cw, ch);
    // P、Q 点
    for (const [x, y, c] of [[px, py, COL.ink], [qx, qy, COL.accent]]) {
      g.fillStyle = c; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
    }
    const diff = Math.abs(mS - mT);
    probeCard(g, cw - 268, 22, 246, 'm割 − m切', diff < 0.02 ? '≈ 0.000' : diff.toFixed(3), 1, diff < 0.06 ? COL.gold : COL.accent);
    function line(g, x0, y0, m, cw, ch) {
      g.beginPath();
      g.moveTo(30, y0 + (x0 - 30) * m);
      g.lineTo(cw - 20, y0 - (cw - 20 - x0) * m);
      g.stroke();
    }
  },

  // ---- 导函数生长 ----
  deriv(g, cw, ch, tl) {
    axes(g, cw, ch);
    curve(g, cw, ch);
    const cyc = (tl % 3.4) / 3.4;
    const uA = 0.08 + 0.8 * easeInOutCubic(clamp01(cyc * 1.2));
    const [ax, ay] = plot(g, cw, ch, uA);
    const m = dfx(uA) * (ch - 150) / (cw - 120);
    g.strokeStyle = COL.gold; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(ax - 90, ay + 90 * m); g.lineTo(ax + 90, ay - 90 * m); g.stroke();
    g.fillStyle = COL.ink; g.beginPath(); g.arc(ax, ay, 5.5, 0, 7); g.fill();
    // 下方导函数带：随 uA 生长
    const bandY = ch - 30;
    g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(56, bandY); g.lineTo(cw - 26, bandY); g.stroke();
    g.strokeStyle = COL.palette[2]; g.lineWidth = 2.8; g.lineCap = 'round';
    g.beginPath();
    for (let u = 0.06; u <= uA; u += 0.01) {
      const x = 60 + u * (cw - 120);
      const yy = bandY + 8 - dfx(u) * 14;
      u === 0.06 ? g.moveTo(x, yy) : g.lineTo(x, yy);
    }
    g.stroke();
    g.fillStyle = COL.palette[2];
    g.beginPath(); g.arc(60 + uA * (cw - 120), bandY + 8 - dfx(uA) * 14, 4.5, 0, 7); g.fill();
    text(g, 'f′', cw - 44, bandY + 2, { size: 17, color: COL.ink2, font: NUM });
  },

  // ---- 积分矩形加密 ----
  integral(g, cw, ch, tl) {
    axes(g, cw, ch);
    const cyc = (tl % 3.4) / 3.4;
    const n = Math.round(4 + 26 * clamp01(cyc * 1.3));
    const u0 = 0.12, u1 = 0.9;
    // 矩形（在曲线下层）
    for (let i = 0; i < n; i++) {
      const ua = u0 + (u1 - u0) * (i / n), ub = u0 + (u1 - u0) * ((i + 1) / n);
      const [xa] = plot(g, cw, ch, ua);
      const [xb] = plot(g, cw, ch, ub);
      const [, ym] = plot(g, cw, ch, (ua + ub) / 2);
      const base = ch - 58;
      g.fillStyle = `rgba(94,92,230,${0.16 + 0.1 * (n / 30)})`;
      g.fillRect(xa, ym, xb - xa - 0.5, base - ym);
      g.strokeStyle = 'rgba(94,92,230,0.55)'; g.lineWidth = 1;
      g.strokeRect(xa, ym, xb - xa - 0.5, base - ym);
    }
    curve(g, cw, ch);
    // S 收敛
    let S = 0;
    for (let i = 0; i < n; i++) S += fx(u0 + (u1 - u0) * ((i + 0.5) / n)) * ((u1 - u0) / n);
    probeCard(g, cw - 268, 22, 246, 'S（n=' + n + '）', S.toFixed(4), 1, n > 26 ? COL.gold : COL.accent);
  },

  // ---- 泰勒斯：半圆上的直角 ----
  thales(g, cw, ch, tl) {
    const cx = cw / 2, cy = ch - 130, r = Math.min(cw, ch) * 0.34;
    g.strokeStyle = COL.ink; g.lineWidth = 3.4;
    g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
    const cyc = (tl % 4.0) / 4.0;
    const swing = Math.sin(cyc * Math.PI * 2) * 0.5 + 0.5;
    const a = Math.PI * (0.24 + 0.52 * easeInOutCubic(swing));
    const P = [cx - Math.cos(a) * r, cy - Math.sin(a) * r];
    // 两条弦
    g.strokeStyle = COL.accent; g.lineWidth = 2.8;
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(P[0], P[1]); g.lineTo(cx + r, cy); g.stroke();
    // 直角标记
    const v1 = [cx - r - P[0], cy - P[1]], v2 = [cx + r - P[0], cy - P[1]];
    const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2), s = 16;
    g.strokeStyle = COL.gold; g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(P[0] + v1[0] / n1 * s, P[1] + v1[1] / n1 * s);
    g.lineTo(P[0] + v1[0] / n1 * s + v2[0] / n2 * s, P[1] + v1[1] / n1 * s + v2[1] / n2 * s);
    g.lineTo(P[0] + v2[0] / n2 * s, P[1] + v2[1] / n2 * s);
    g.stroke();
    g.fillStyle = COL.ink; g.beginPath(); g.arc(P[0], P[1], 5.5, 0, 7); g.fill();
    probeCard(g, cw - 268, 22, 246, '圆周角 ∠P', '90.00°', 1, COL.gold);
  },
};
