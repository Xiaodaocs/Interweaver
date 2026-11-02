// S3 关联 Q&A（b88–b152）：
//   line-carry 转场开场（双纽线线头接力 → 拐角围出变量卡框）
//   Q1 拖滑杆圆呼吸（正向）→ Q2 拖圆滑杆自己动（反向求解）→ Q3 θ 同驱圆+sin+cos（L 型装置）
// 几何诚实铁律：投影参考线处，圆 r = 波幅 amp、圆心 y = 波基线 —— 水平/竖直投影严格为直线。
import { COL } from '../design';
import { glow, glassCard, thread, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, IOS, SMOOTH, text } from './engine';
import { lemniscatePt } from './beauty';

const W = 1920, H = 1080;
const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';

// ---------------- line-carry 路径 ----------------
// 双纽线右端头 (1400,500) → 右行 → 下拐 → 围出变量卡框 (1120,690,460,160) → 停在滑杆轨左端
const CARD = { x: 1120, y: 690, w: 460, h: 160 };
const TRACK = { x0: CARD.x + 44, x1: CARD.x + CARD.w - 44, y: CARD.y + 102 };
const CARRY_PATH: [number, number][] = [
  [1400, 500], [2060, 500], [2060, 770], [CARD.x + CARD.w, 770],
  [CARD.x + CARD.w, CARD.y], [CARD.x, CARD.y], [CARD.x, 770], [TRACK.x0, 770], [TRACK.x0, TRACK.y],
];
const CARRY_LENS: number[] = [];
let CARRY_TOTAL = 0;
for (let i = 1; i < CARRY_PATH.length; i++) {
  CARRY_TOTAL += Math.hypot(CARRY_PATH[i][0] - CARRY_PATH[i - 1][0], CARRY_PATH[i][1] - CARRY_PATH[i - 1][1]);
  CARRY_LENS.push(CARRY_TOTAL);
}
function carryPt(u: number): { x: number; y: number; ang: number } {
  const d = u * CARRY_TOTAL;
  let acc = 0;
  for (let i = 1; i < CARRY_PATH.length; i++) {
    const segLen = CARRY_LENS[i - 1] - acc;
    if (d <= CARRY_LENS[i - 1]) {
      const f = (d - acc) / segLen;
      return {
        x: lerp(CARRY_PATH[i - 1][0], CARRY_PATH[i][0], f),
        y: lerp(CARRY_PATH[i - 1][1], CARRY_PATH[i][1], f),
        ang: Math.atan2(CARRY_PATH[i][1] - CARRY_PATH[i - 1][1], CARRY_PATH[i][0] - CARRY_PATH[i - 1][0]),
      };
    }
    acc = CARRY_LENS[i - 1];
  }
  const last = CARRY_PATH[CARRY_PATH.length - 1];
  return { x: last[0], y: last[1], ang: 0 };
}

// 线头接力相机：笔尖钉在屏幕 x≈1420（line-carry 命门：跟线横移）
function carryCam(b: number): { cx: number; cy: number; z: number } {
  const u = segs(b, 88, 95, SMOOTH);
  const tip = carryPt(u);
  const settle = segs(b, 95, 96.5, IOS);
  const cx = lerp(tipCamX(tip.x), 960, settle);
  const cy = lerp(540, 540, settle);
  return { cx, cy, z: 1 };
}
function tipCamX(tipX: number) { return tipX - 1420 + 960; }

// ---------------- 变量卡（画布内） ----------------
function varCard(g: CanvasRenderingContext2D, x: number, y: number, w: number, name: string, valStr: string, u: number,
  o: { breath?: number; alpha?: number; boxByLine?: boolean } = {}) {
  const h = 160;
  const { breath = 0, alpha = 1 } = o;
  g.save(); g.globalAlpha = alpha;
  if (!o.boxByLine) glassCard(g, x, y, w, h, 18, { alpha });
  // 名称与数值
  g.font = `600 30px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = o.boxByLine ? COL.ink : COL.ink; g.fillText(name, x + 30, y + 46);
  g.font = `500 26px ${NUM}`; g.textAlign = 'right';
  g.fillStyle = COL.accent; g.fillText(valStr, x + w - 30, y + 46);
  g.font = `400 15px ${NUM}`; g.fillStyle = COL.ink2;
  g.textAlign = 'left'; g.fillText('0', x + 44, y + 134);
  g.textAlign = 'right'; g.fillText('4.5', x + w - 44, y + 134);
  // 滑杆轨
  const tx0 = x + 44, tx1 = x + w - 44, ty = y + 102;
  g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(tx1, ty); g.stroke();
  g.strokeStyle = COL.accent;
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(lerp(tx0, tx1, u), ty); g.stroke();
  const thx = lerp(tx0, tx1, u);
  if (breath > 0) glow(g, thx, ty, 0.34 + 0.16 * Math.sin(performanceBeat * Math.PI * 2), COL.accentL, 0.8 * breath);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(thx, ty, 11, 0, 7); g.fill();
  g.strokeStyle = COL.accent; g.lineWidth = 2.8; g.stroke();
  g.restore();
}
let performanceBeat = 0;   // 由 draw() 写入的确定性"表"（拍）

// ---------------- Q1/Q2 装置 ----------------
function rigSlider(g: CanvasRenderingContext2D, b: number) {
  const cx = 620, cy = 480;
  // 滑杆编舞（拍点落值）：b100/104/108/112，每步 1.6 拍缓动
  const moves: [number, number][] = [[100, 0.78], [104, 0.22], [108, 0.62], [112, 0.46]];
  let u = 0.3, prev = 0.3;
  for (const [mb, v] of moves) {
    u = lerp(prev, v, segs(b, mb - 1.6, mb, easeInOutCubic));
    if (b >= mb) prev = v;
  }
  // Q2 反向拖圆（半径路径驱动，滑杆跟随）
  const grabs: [number, number, number][] = [[114, 116, 0.14], [118, 120, 0.72], [121.5, 122.5, 0.5]];
  let grabbing = false;
  for (const [a, bb, v] of grabs) {
    const p = segs(b, a, bb, easeInOutCubic);
    if (p > 0) { u = lerp(prev, v, p); if (b >= bb) prev = v; if (b < bb) grabbing = true; }
  }
  const val = 0.5 + 4 * u;
  const r = 90 + u * 160;

  // 圆（b96 一笔画出）
  const drawP = segs(b, 96, 96.9, easeInOutCubic);
  if (drawP > 0) {
    g.save();
    g.strokeStyle = COL.ink; g.lineWidth = 4.5; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * drawP); g.stroke();
    // 半径指示
    const rp = segs(b, 97.4, 98);
    if (rp > 0) {
      g.globalAlpha = rp;
      g.setLineDash([4, 5]); g.strokeStyle = COL.ink2; g.lineWidth = 1.7;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r, cy); g.stroke();
      g.setLineDash([]);
      g.font = `500 24px ${NUM}`; g.fillStyle = COL.ink2; g.textAlign = 'center';
      g.fillText('r', cx + r / 2, cy - 18);
    }
    g.restore();
  }

  // 丝线：b98 连上（卡左缘 → 圆半径端点）
  const grow = segs(b, 98, 98.6, easeOutCubic);
  if (grow > 0) {
    const active = (b >= 99 && b < 113) || grabbing;
    const pulses: number[] = [];
    const n = active ? 3 : 1;
    const sp = active ? 1.4 : 0.4;
    for (let i = 0; i < n; i++) pulses.push((b * sp + i / n) % 1);
    thread(g, CARD.x, CARD.y + 80, cx + r, cy, b, { growU: grow, pulseUs: grow >= 1 ? pulses : [] });
  }

  // Q2 抓取光标
  if (b > 113.4 && b < 123) {
    const gp = segs(b, 113.4, 114, easeOutCubic) * (1 - segs(b, 122.4, 123));
    const gx = cx + r, gy = cy;
    glow(g, gx, gy, 0.4, '#8B86FF', 0.85 * gp);
    g.save(); g.globalAlpha = gp;
    g.strokeStyle = COL.accent; g.lineWidth = 3;
    g.beginPath(); g.arc(gx, gy, 16 + Math.sin(b * Math.PI * 3.5) * 2.6, 0, 7); g.stroke();
    g.restore();
  }

  // 变量卡
  const cardIn = segs(b, 96, 96.8, easeOutCubic);
  if (cardA(b) > 0) varCard(g, CARD.x, CARD.y, CARD.w, 'r', val.toFixed(2), u, { breath: b > 113.4 && b < 123 ? 1 : 0, alpha: cardA(b) });
  return { r, cx, cy };
}
function cardA(b: number) { return segs(b, 96, 96.8, easeOutCubic); }

// ---------------- Q3 L 型装置 ----------------
function rigTheta(g: CanvasRenderingContext2D, b: number) {
  const inP = segs(b, 124.2, 125.4, easeInOutCubic) * (1 - segs(b, 148.4, 149.4) * 0.72);   // 落版时装置退到后景
  if (inP <= 0) return;
  const cx = 560, cy = 430, r = 140;
  const sinX0 = 820, sinBase = 430, amp = 140, k = 52;
  const cosY0 = 680;
  const theta = (b - 128) * 0.5 + 0.6;   // b128 起播
  const thPlay = Math.max(0.6, theta);
  const P = [cx + Math.cos(thPlay) * 140, cy - Math.sin(thPlay) * 140];
  const winS = 9, winC = 6.5;
  const thLoS = Math.max(0.6, thPlay - winS);
  const thLoC = Math.max(0.6, thPlay - winC);
  const S = [sinX0 + (thPlay - thLoS) * k, sinBase - Math.sin(thPlay) * amp];
  const C = [cx + Math.cos(thPlay) * 140, cosY0 + (thPlay - thLoC) * k];

  g.save();
  g.globalAlpha = inP;
  // 圆 + 半径
  g.strokeStyle = COL.ink; g.lineWidth = 4;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = COL.palette[0]; g.lineWidth = 2.8;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(P[0], P[1]); g.stroke();
  // sin 基线 + 波（窗口随 θ 滚动）
  g.strokeStyle = 'rgba(29,29,31,0.25)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(sinX0 - 40, sinBase); g.lineTo(1500, sinBase); g.stroke();
  g.strokeStyle = COL.accent; g.lineWidth = 4.2; g.lineCap = 'round';
  g.beginPath();
  for (let th = thLoS; th <= thPlay; th += 0.04) {
    const x = sinX0 + (th - thLoS) * k, y = sinBase - Math.sin(th) * amp;
    th === thLoS ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // cos 竖波（挂在圆下）：x = cx + r·cosφ，y 向下展开
  g.strokeStyle = COL.palette[2]; g.lineWidth = 4.2;
  g.beginPath();
  for (let th = thLoC; th <= thPlay; th += 0.04) {
    const x = cx + Math.cos(th) * amp, y = cosY0 + (th - thLoC) * k;
    th === thLoC ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // 参考虚线：P→S 严格水平（P.y === S.y），P→C 严格竖直（P.x === C.x）
  g.setLineDash([3, 6]); g.strokeStyle = 'rgba(110,110,115,0.85)'; g.lineWidth = 1.7;
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(S[0], S[1]); g.stroke();
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(C[0], C[1]); g.stroke();
  g.setLineDash([]);
  // 动点
  for (const [x, y, c] of [[P[0], P[1], COL.palette[0]], [S[0], S[1], COL.accent], [C[0], C[1], COL.palette[2]]] as [number, number, string][]) {
    g.fillStyle = c; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
    glow(g, x, y, 0.38, c, 0.8);
  }
  g.restore();

  // θ 卡 + 三条丝线（b125/126/127 逐条连上）
  const cp = segs(b, 124.6, 125.4, easeOutCubic);
  if (cp > 0) {
    const cardX = 1150, cardY = 836, cardW = 470;
    varCard(g, cardX, cardY, cardW, 'θ', (thPlay / Math.PI).toFixed(2) + 'π', (thPlay % (Math.PI * 2)) / (Math.PI * 2), { alpha: cp });
    const anchor: [number, number] = [cardX, cardY + 80];
    const targets: [number, number][] = [[P[0], P[1]], [S[0], S[1]], [C[0], C[1]]];
    [125, 126, 127].forEach((cb, i) => {
      const gw = segs(b, cb, cb + 0.55, easeOutCubic);
      if (gw > 0) {
        thread(g, anchor[0], anchor[1], targets[i][0], targets[i][1], b, {
          growU: gw, alpha: inP,
          pulseUs: gw >= 1 && b > 128 ? [(b * 1.1 + i * 0.37) % 1] : [],
        });
      }
    });
  }
}

// ---------------- 主入口 ----------------
export function draw(g: CanvasRenderingContext2D, b: number) {
  performanceBeat = b;
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);

  // line-carry 段（b88–96.5）用跟随相机；此后相机归位
  const inCarry = b < 96.5;
  g.save();
  if (inCarry) {
    const cam = carryCam(b);
    g.translate(960 - cam.cx, 540 - cam.cy);   // 世界→屏幕：笔尖钉在 x≈1420
  }

  // 双纽线残影（b88–89 淡出）
  const lemnA = 1 - segs(b, 88, 89.2);
  if (lemnA > 0) {
    g.save();
    g.globalAlpha = lemnA;
    g.strokeStyle = COL.accent; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath();
    for (let th = 0; th <= Math.PI * 2; th += 0.02) {
      const [x, y] = lemniscatePt(960, 500, 440, th);
      th === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  // 线头接力：b88–95.5 画路径；笔尖发光
  const carryU = segs(b, 88, 95.5, SMOOTH);
  if (carryU > 0 && b < 97.5) {
    const d = carryU * CARRY_TOTAL;
    g.save();
    g.strokeStyle = COL.accent; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(CARRY_PATH[0][0], CARRY_PATH[0][1]);
    let acc = 0;
    for (let i = 1; i < CARRY_PATH.length; i++) {
      const segLen = CARRY_LENS[i - 1] - acc;
      if (d >= CARRY_LENS[i - 1]) { g.lineTo(CARRY_PATH[i][0], CARRY_PATH[i][1]); acc = CARRY_LENS[i - 1]; continue; }
      const f = (d - acc) / segLen;
      g.lineTo(lerp(CARRY_PATH[i - 1][0], CARRY_PATH[i][0], f), lerp(CARRY_PATH[i - 1][1], CARRY_PATH[i][1], f));
      break;
    }
    g.stroke();
    const tip = carryPt(carryU);
    glow(g, tip.x, tip.y, 0.5, COL.accentL, 0.9);
    g.restore();
  }

  if (!inCarry) {
    if (b < 124.2) rigSlider(g, b);
    rigTheta(g, b);
  }
  g.restore();
}
