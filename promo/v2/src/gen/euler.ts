// S5 欧拉之环（b176–b200）：L 型装置闭环 → 成就砸落（DOM 层在场景壳里）→ 坠入深空。
// 几何诚实：sin 向右（水平投影）、cos 向下（竖直投影），r=amp、圆心 y=sin 基线。
import { COL } from '../design';
import { glow, glassCard, thread, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, easeInCubic, IOS, mixColor, text } from './engine';

const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';
const CX = 640, CY = 420, R = 150;
const SIN_X0 = 880, SIN_BASE = 420, AMP = 150, K = 62;
const COS_Y0 = 690;
const CARD = { x: 1150, y: 850, w: 470, h: 140 };

function thetaAt(b: number) {
  const play = Math.max(0, b - 176.5);
  const slow = segs(b, 181, 182.2, easeInOutCubic);          // 砸落后减速定住
  return 0.6 + play * 0.5 * (1 - slow) + play * 0.06 * slow;
}

export function draw(g: CanvasRenderingContext2D, b: number, W: number, H: number) {
  const fall = segs(b, 194, 200, easeInOutCubic);
  g.fillStyle = mixColor(COL.paper, COL.void, easeInCubic(fall));
  g.fillRect(0, 0, W, H);

  const inP = segs(b, 176, 177.4, easeOutCubic);
  const dim = segs(b, 180.2, 180.8) * (1 - fall * 0.5);
  const theta = thetaAt(b);
  const thPlay = Math.max(0.6, theta);
  const P: [number, number] = [CX + Math.cos(thPlay) * R, CY - Math.sin(thPlay) * R];
  const winS = 9, winC = 6.2;
  const thLoS = Math.max(0.6, thPlay - winS);
  const thLoC = Math.max(0.6, thPlay - winC);
  const S: [number, number] = [SIN_X0 + (thPlay - thLoS) * K, SIN_BASE - Math.sin(thPlay) * AMP];
  const C: [number, number] = [CX + Math.cos(thPlay) * AMP, COS_Y0 + (thPlay - thLoC) * K];

  // 坠落：装置缩成星
  const cs = 1 - fall * 0.55;
  g.save();
  g.translate(W / 2, H / 2 - fall * 150); g.scale(cs, cs); g.translate(-W / 2, -H / 2);

  g.save();
  g.globalAlpha = inP * (1 - fall);
  // 圆 + 半径
  g.strokeStyle = COL.ink; g.lineWidth = 4;
  g.beginPath(); g.arc(CX, CY, R, 0, 7); g.stroke();
  g.strokeStyle = COL.palette[0]; g.lineWidth = 2.8;
  g.beginPath(); g.moveTo(CX, CY); g.lineTo(P[0], P[1]); g.stroke();
  // sin
  g.strokeStyle = 'rgba(29,29,31,0.25)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(SIN_X0 - 40, SIN_BASE); g.lineTo(1560, SIN_BASE); g.stroke();
  g.strokeStyle = COL.accent; g.lineWidth = 4.2; g.lineCap = 'round';
  g.beginPath();
  for (let th = thLoS; th <= thPlay; th += 0.04) {
    const x = SIN_X0 + (th - thLoS) * K, y = SIN_BASE - Math.sin(th) * AMP;
    th === thLoS ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // cos 竖波
  g.strokeStyle = COL.palette[2]; g.lineWidth = 4.2;
  g.beginPath();
  for (let th = thLoC; th <= thPlay; th += 0.04) {
    const x = CX + Math.cos(th) * AMP, y = COS_Y0 + (th - thLoC) * K;
    th === thLoC ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // 参考线（严格水平/竖直）
  g.setLineDash([3, 6]); g.strokeStyle = 'rgba(110,110,115,0.85)'; g.lineWidth = 1.7;
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(S[0], S[1]); g.stroke();
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(C[0], C[1]); g.stroke();
  g.setLineDash([]);
  for (const [x, y, c] of [[P[0], P[1], COL.palette[0]], [S[0], S[1], COL.accent], [C[0], C[1], COL.palette[2]]] as [number, number, string][]) {
    g.fillStyle = c; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
  }
  // θ 卡
  varThetaCard(g, thPlay, inP * (1 - fall));
  // 三条丝线
  const anchor: [number, number] = [CARD.x, CARD.y + 70];
  ([P, S, C] as [number, number][]).forEach((tp, i) => {
    thread(g, anchor[0], anchor[1], tp[0], tp[1], b, {
      alpha: 0.9 * inP * (1 - fall),
      pulseUs: b < 180 ? [(b * 1.1 + i * 0.37) % 1] : [],
    });
  });
  g.restore();

  // 绑定网闭合成金环（b178–180.2，Catmull-Rom 闭环生长）
  const ring = segs(b, 178, 180.2, easeInOutCubic);
  if (ring > 0 && fall < 1) drawRing(g, ring, (1 - fall) * (1 - dim * 0.4));

  g.restore();

  // 压暗 + 两次呼吸
  if (dim > 0) {
    g.fillStyle = `rgba(11,11,18,${0.22 * dim})`;
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 2; k++) {
      const bp = seg(b, 180.4 + k * 0.55, 180.9 + k * 0.55);
      if (bp > 0 && bp < 1) {
        const a = Math.sin(bp * Math.PI);
        for (const [x, y, c] of [[CX, CY, '#B9B6FF'], [1440, 420, '#8B86FF'], [640, 1000, '#8B86FF'], [1385, 920, '#B9B6FF']] as [number, number, string][]) {
          glow(g, x, y, 0.9 + a * 0.9, c, 0.5 * a * (1 - fall));
        }
      }
    }
  }

  // 坠落末段：实体坍缩成星
  if (fall > 0) {
    const starA = segs(b, 195, 196.6) * (1 - segs(b, 199, 200));
    [[CX, CY, '#B9B6FF'], [1440, 420, '#8B86FF'], [640, 1000, '#30D5C8'], [1385, 920, '#B9B6FF']].forEach(([x, y0, c], i) => {
      const y = (y0 as number) - fall * fall * 300 - i * 24 * fall;
      glow(g, x as number, y, 0.7, c as string, starA * 0.9);
      g.fillStyle = '#F5F3FF'; g.globalAlpha = starA;
      g.beginPath(); g.arc(x as number, y, 3, 0, 7); g.fill();
      g.globalAlpha = 1;
    });
  }
}

function varThetaCard(g: CanvasRenderingContext2D, theta: number, alpha: number) {
  glassCard(g, CARD.x, CARD.y, CARD.w, CARD.h, 16, { alpha });
  g.save(); g.globalAlpha = alpha;
  g.font = `600 28px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = COL.ink; g.fillText('θ', CARD.x + 28, CARD.y + 44);
  g.fillStyle = COL.accent; g.textAlign = 'right';
  g.fillText((theta / Math.PI).toFixed(2) + 'π', CARD.x + CARD.w - 28, CARD.y + 44);
  const tx0 = CARD.x + 28, tx1 = CARD.x + CARD.w - 28, ty = CARD.y + 96;
  g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(tx1, ty); g.stroke();
  const u = (theta % (Math.PI * 2)) / (Math.PI * 2);
  g.strokeStyle = COL.accent;
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(lerp(tx0, tx1, u), ty); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(lerp(tx0, tx1, u), ty, 10, 0, 7); g.fill();
  g.strokeStyle = COL.accent; g.lineWidth = 2.6; g.stroke();
  g.restore();
}

function drawRing(g: CanvasRenderingContext2D, p: number, alpha: number) {
  const pts: [number, number][] = [[CX, CY], [1440, 420], [1385, 920], [640, 1000]];
  const n = pts.length;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = COL.gold; g.lineWidth = 2.4;
  g.shadowColor = 'rgba(201,162,39,0.6)'; g.shadowBlur = 12;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  const prog = p * n;
  for (let i = 0; i < n; i++) {
    const local = clamp01(prog - i);
    if (local <= 0) break;
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    if (local >= 1) { g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]); continue; }
    // 段内 de Casteljau 截断
    const mm = (a: [number, number], bb: [number, number]) => [lerp(a[0], bb[0], local), lerp(a[1], bb[1], local)] as [number, number];
    const q0 = mm(p1, c1), q1 = mm(c1, c2), q2 = mm(c2, p2);
    const r0 = mm(q0, q1), r1 = mm(q1, q2), s = mm(r0, r1);
    g.bezierCurveTo(q0[0], q0[1], r0[0], r0[1], s[0], s[1]);
  }
  g.stroke();
  g.restore();
}
