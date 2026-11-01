// Act 1（16–52s）· 数学之美混剪：一支笔从头到尾不落笔 ——
// 圆规画圆 → 圆内接三角形（泰勒斯直角）→ 多边形 n→∞ 回归圆 → 单位圆长出正弦波
// → 谐波叠成方波（傅里叶）→ 抛物线焦点 → 黄金螺线 → 双纽线（品牌之形）。
// 每次形态衔接都是"上一根线画到的地方，正是下一根线起笔的地方"。
import { COL, text, paperGrid, paperGrain, rng, seg, segs, clamp01, easeInOutCubic, easeOutCubic, IOS, glow, colorWithA, lerp } from './lib.mjs';
import { A1, W, H } from './timeline.mjs';

// 段落相机关键帧
const CAM = [
  { t: 16.0, cx: 960, cy: 520, z: 1.00 },
  { t: 20.0, cx: 960, cy: 520, z: 1.03 },
  { t: 24.0, cx: 960, cy: 520, z: 1.05 },
  { t: 28.0, cx: 1010, cy: 505, z: 0.94 },
  { t: 34.0, cx: 1010, cy: 510, z: 0.94 },
  { t: 39.0, cx: 960, cy: 560, z: 0.95 },
  { t: 43.0, cx: 960, cy: 540, z: 1.00 },
  { t: 47.0, cx: 960, cy: 520, z: 1.03 },
  { t: 52.0, cx: 960, cy: 520, z: 1.03 },
];
function camAt(t) {
  for (let i = 0; i < CAM.length - 1; i++) {
    const a = CAM[i], b = CAM[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = easeInOutCubic(seg(t, a.t, Math.min(b.t, a.t + 0.9)));
      const hold = { cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), z: lerp(a.z, b.z, u) };
      return hold;
    }
  }
  return CAM[CAM.length - 1];
}

function circlePath(g, cx, cy, r, a0, a1) {
  g.beginPath(); g.arc(cx, cy, r, a0, a1);
}
function polyPath(g, n, cx, cy, r, rot) {   // 支持分数边数：最后一条边画一半
  const full = Math.floor(n), frac = n - full;
  g.beginPath();
  for (let i = 0; i <= full; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  if (frac > 0.001 && full >= 2) {
    const a0 = rot + (full / n) * Math.PI * 2, a1 = rot + Math.PI * 2;
    g.lineTo(cx + Math.cos(lerp(a0, a1, frac)) * r, cy + Math.sin(lerp(a0, a1, frac)) * r);
  }
}

// 段落进度别名
const S = (t, id) => { const s = A1.seg.find((x) => x.id === id); return { ...s, p: seg(t, s.t0, s.t1) }; };

export function render(g, t) {
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);
  const cam = camAt(t);
  paperGrid(g, W, H, 0.9, cam.cx - W / 2, cam.cy - H / 2, 1);

  g.save();
  g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-cam.cx, -cam.cy);

  const fadeAll = 1 - segs(t, 51.7, 52.4);      // 幕尾整体让位给 Act2
  g.globalAlpha = fadeAll;

  const pen = { x: 0, y: 0, on: false };        // 笔尖辉光

  // ---------- S1 圆规画圆（16–20） ----------
  {
    const { p } = S(t, 'compass');
    if (p > 0) {
      const cx = 960, cy = 520, r = 230;
      const sweep = segs(t, 16.4, 18.2, easeInOutCubic) * Math.PI * 2;
      const armA = -Math.PI / 2 + sweep;
      const fadeArm = 1 - segs(t, 18.6, 19.4);
      const fadeC = S(t, 'polygon').p > 0 ? 1 - segs(t, 24.2, 25.0) : 1;   // 多边形段把墨圆接走
      if (fadeC > 0) {
        g.save(); g.globalAlpha *= fadeC;
        g.strokeStyle = COL.ink; g.lineWidth = 4; g.lineCap = 'round';
        circlePath(g, cx, cy, r, -Math.PI / 2, -Math.PI / 2 + sweep);
        g.stroke();
        if (sweep >= Math.PI * 2) { circlePath(g, cx, cy, r, 0, 7); g.stroke(); }
        g.restore();
      }
      if (fadeArm > 0) {   // 圆规臂 + 圆心
        g.save(); g.globalAlpha *= fadeArm * 0.85;
        g.strokeStyle = COL.ink2; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(armA) * r, cy + Math.sin(armA) * r); g.stroke();
        g.fillStyle = COL.ink;
        g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();
        g.beginPath(); g.arc(cx + Math.cos(armA) * r, cy + Math.sin(armA) * r, 5, 0, 7);
        g.fillStyle = COL.accent; g.fill();
        g.restore();
        pen.x = cx + Math.cos(armA) * r; pen.y = cy + Math.sin(armA) * r; pen.on = sweep < Math.PI * 2;
      }
    }
  }

  // ---------- S2 泰勒斯（20–24） ----------
  {
    const { p } = S(t, 'thales');
    if (p > 0) {
      const cx = 960, cy = 520, r = 230;
      const A = 200 * Math.PI / 180, B = 340 * Math.PI / 180, C = 88 * Math.PI / 180;
      const P = [cx + Math.cos(A) * r, cy + Math.sin(A) * r];
      const Q = [cx + Math.cos(B) * r, cy + Math.sin(B) * r];
      const R = [cx + Math.cos(C) * r, cy + Math.sin(C) * r];
      const e1 = segs(t, 20.3, 21.0, IOS), e2 = segs(t, 21.0, 21.6, IOS), e3 = segs(t, 21.6, 22.1, IOS);
      const thin = 1 - segs(t, 23.6, 24.4);          // 段落结束即完整退场（多边形接棒）
      g.save(); g.globalAlpha *= Math.max(0, thin);
      // 直径
      if (e1 > 0) {
        g.strokeStyle = COL.palette[0]; g.lineWidth = 3.5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(lerp(P[0], Q[0], e1), lerp(P[1], Q[1], e1)); g.stroke();
      }
      if (e2 > 0) {
        g.strokeStyle = COL.ink; g.lineWidth = 3.5;
        g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(lerp(P[0], R[0], e2), lerp(P[1], R[1], e2)); g.stroke();
      }
      if (e3 > 0) {
        g.strokeStyle = COL.ink; g.lineWidth = 3.5;
        g.beginPath(); g.moveTo(R[0], R[1]); g.lineTo(lerp(R[0], Q[0], e3), lerp(R[1], Q[1], e3)); g.stroke();
      }
      // 直角标记 + 金色一闪
      const ra = segs(t, 21.7, 22.0, easeOutCubic);
      if (ra > 0) {
        const u1 = [P[0] - R[0], P[1] - R[1]], u2 = [Q[0] - R[0], Q[1] - R[1]];
        const n1 = Math.hypot(...u1), n2 = Math.hypot(...u2), s = 20;
        const c1 = [R[0] + u1[0] / n1 * s, R[1] + u1[1] / n1 * s];
        const c2 = [R[0] + u2[0] / n2 * s, R[1] + u2[1] / n2 * s];
        g.save(); g.globalAlpha *= ra;
        g.strokeStyle = COL.gold; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(c1[0], c1[1]); g.lineTo(c1[0] + c2[0] - R[0], c1[1] + c2[1] - R[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        g.restore();
        glow(g, R[0], R[1], 1.1, COL.goldL, segs(t, 21.9, 22.3) * (1 - segs(t, 22.3, 23.4)) * fadeAll);
      }
      g.restore();
    }
  }

  // ---------- S3 多边形 n→∞（24–28） ----------
  {
    const { p } = S(t, 'polygon');
    if (p > 0) {
      const cx = 960, cy = 520, r = 230;
      const n = 3 + 33 * segs(t, 24.3, 27.2, easeInOutCubic);
      const col = t < 26 ? COL.accent : COL.accentL;
      g.save();
      g.strokeStyle = col; g.lineWidth = 3.6; g.lineJoin = 'round';
      g.globalAlpha *= 1 - segs(t, 27.4, 27.9);
      polyPath(g, n, cx, cy, r, -Math.PI / 2);
      g.stroke();
      g.restore();
      // 顶点小点
      const vn = Math.floor(n);
      if (vn <= 14) {
        g.save(); g.fillStyle = COL.accent; g.globalAlpha *= 0.8 * (1 - segs(t, 27.0, 27.5));
        for (let i = 0; i < vn; i++) {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.4, 0, 7); g.fill();
        }
        g.restore();
      }
      if (t > 25.4 && t < 27.8) {
        text(g, A1.captions.polygon, cx + r + 66, cy + 30, { size: 22, color: COL.ink2, font: '"SF Mono",Consolas,monospace', alpha: segs(t, 25.4, 26.0) * (1 - segs(t, 27.2, 27.8)) * fadeAll });
      }
    }
  }

  // ---------- S4 单位圆 → 正弦波（28–34） ----------
  const waveX0 = 800, waveBase = 505, waveK = 54.2;   // k px/rad → λ=2π·k≈340
  {
    const { p } = S(t, 'unitsine');
    if (p > 0) {
      const inP = segs(t, 28.0, 28.9, easeInOutCubic);
      const cx = lerp(960, 545, inP), cy = waveBase, r = lerp(230, 165, inP);
      const theta = Math.max(0, t - 29.0) * 2.35;
      const fadeRig = 1 - segs(t, 34.0, 34.6);
      // 单位圆
      g.save(); g.globalAlpha *= fadeRig;
      g.strokeStyle = COL.ink; g.lineWidth = 3.2;
      circlePath(g, cx, cy, r, 0, 7); g.stroke();
      // 旋转半径
      const pa = -Math.PI / 2 + theta;
      const px = cx + Math.cos(pa) * r, py = cy + Math.sin(pa) * r;
      g.strokeStyle = COL.palette[0]; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
      g.fillStyle = COL.palette[0]; g.beginPath(); g.arc(px, py, 5.5, 0, 7); g.fill();
      // 参考虚线 → 波头
      const headX = waveX0 + theta * waveK;
      const headY = waveBase - Math.sin(theta) * 120;
      g.setLineDash([2, 6]); g.strokeStyle = 'rgba(110,110,115,0.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(headX, headY); g.stroke();
      g.setLineDash([]);
      // 基线
      g.strokeStyle = 'rgba(29,29,31,0.25)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(waveX0 - 60, waveBase); g.lineTo(1560, waveBase); g.stroke();
      // 正弦波（随 θ 生长）
      g.strokeStyle = COL.accent; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath();
      for (let x = waveX0; x <= Math.min(headX, 1560); x += 5) {
        const th = (x - waveX0) / waveK;
        const y = waveBase - Math.sin(th) * 120;
        x === waveX0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = COL.accent; g.beginPath(); g.arc(headX, headY, 5.5, 0, 7); g.fill();
      glow(g, headX, headY, 0.9, COL.accentL, 0.8 * fadeRig);
      g.restore();
      pen.x = waveX0 + theta * waveK; pen.y = waveBase - Math.sin(theta) * 120; pen.on = p > 0.12 && fadeRig > 0.5;
    }
  }

  // ---------- S5 傅里叶（34–39） ----------
  {
    const { p } = S(t, 'fourier');
    const exit = 1 - segs(t, 39.0, 39.7);            // 抛物线接棒即退场
    if (p > 0 && exit > 0) {
      const x0 = waveX0 - 30, x1 = 1640, base = 512;
      const head = segs(t, 35.6, 38.4, easeInOutCubic);   // 方波合成推进
      // 三条谐波（f, 3f, 5f），先竖排淡入，再垂直合流
      const ghostA = segs(t, 34.3, 35.2) * exit;
      const merge = segs(t, 35.6, 37.0, easeInOutCubic);
      const spread = [0, 150, 265];
      const HARMS = [
        { k: 1, amp: 120, col: COL.accent, a: 0.95, lw: 3.2 },
        { k: 3, amp: 40, col: COL.accentL, a: 0.65, lw: 2.4 },
        { k: 5, amp: 24, col: COL.palette[3], a: 0.55, lw: 2.4 },
      ];
      for (let hi = 0; hi < 3; hi++) {
        const h = HARMS[hi];
        g.save();
        g.globalAlpha *= ghostA * h.a * (hi === 0 ? 1 - merge * 0.25 : 1 - merge * 0.9);
        g.strokeStyle = h.col; g.lineWidth = h.lw;
        g.beginPath();
        for (let x = x0; x <= x1; x += 6) {
          const th = (x - x0) / waveK;
          const y = base - Math.sin(th * h.k) * h.amp + (1 - merge) * spread[hi];
          x === x0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      }
      // 合成方波（从左推进）
      if (head > 0) {
        const xe = x0 + (x1 - x0) * head;
        g.save();
        g.globalAlpha *= exit;
        g.strokeStyle = COL.palette[5]; g.lineWidth = 4.2; g.lineCap = 'round';
        g.shadowColor = 'rgba(255,159,10,0.35)'; g.shadowBlur = 10;
        g.beginPath();
        for (let x = x0; x <= xe; x += 4) {
          const th = (x - x0) / waveK;
          const y = base - (Math.sin(th) * 120 + Math.sin(3 * th) * 40 + Math.sin(5 * th) * 24);
          x === x0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
        const th = (xe - x0) / waveK;
        glow(g, xe, base - (Math.sin(th) * 120 + Math.sin(3 * th) * 40 + Math.sin(5 * th) * 24), 1.0, COL.palette[5], 0.8 * fadeAll * exit);
      }
      if (t > 38.2 && t < 39.4) {
        text(g, 'sin x  +  sin 3x / 3  +  sin 5x / 5  +  …', 990, 800, { size: 24, color: COL.ink2, font: '"SF Mono",Consolas,monospace', alpha: segs(t, 38.2, 38.8) * (1 - segs(t, 39.0, 39.4)) * fadeAll });
      }
    }
  }

  // ---------- S6 抛物线（39–43） ----------
  {
    const { p } = S(t, 'parabola');
    const exitP = 1 - segs(t, 43.0, 43.7);           // 螺线接棒即退场
    if (p > 0 && exitP > 0) {
      const inA = segs(t, 39.0, 39.8, easeInOutCubic) * exitP;
      const vx = 960, span = 400;
      g.save(); g.globalAlpha *= inA;
      // 抛物线：顶点 (960, 360)，开口向上
      g.strokeStyle = COL.palette[3]; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath();
      for (let x = vx - span; x <= vx + span; x += 6) {
        const y = 360 + (x - vx) * (x - vx) / 300;
        x === vx - span ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      // 焦点与准线
      const fa = segs(t, 40.2, 40.9);
      if (fa > 0) {
        const fY = 360 + 75;
        g.globalAlpha *= fa;
        g.setLineDash([6, 7]); g.strokeStyle = 'rgba(110,110,115,0.8)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(vx - span, 360 + 225); g.lineTo(vx + span, 360 + 225); g.stroke();
        g.setLineDash([]);
        g.fillStyle = COL.gold; g.beginPath(); g.arc(vx, fY, 5.5, 0, 7); g.fill();
        glow(g, vx, fY, 0.9, COL.goldL, 0.9);
      }
      // 抛体点 + 轨迹残影
      const fly = segs(t, 40.6, 42.8) % 1;
      if (fly > 0) {
        const x = vx - span + 2 * span * fly;
        const y = 360 + (x - vx) * (x - vx) / 300;
        for (let i = 1; i <= 6; i++) {
          const xf = x - i * 26;
          if (xf < vx - span) break;
          const yf = 360 + (xf - vx) * (xf - vx) / 300;
          g.save(); g.globalAlpha *= 0.5 * (1 - i / 7);
          g.fillStyle = COL.palette[3]; g.beginPath(); g.arc(xf, yf, 3.4, 0, 7); g.fill();
          g.restore();
        }
        g.fillStyle = COL.palette[3]; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      }
      g.restore();
    }
  }

  // ---------- S7 黄金螺线（43–47）：斐波那契方块 + 象限弧经典构图 ----------
  {
    const { p } = S(t, 'spiral');
    if (p > 0) {
      const u = 34;                                   // 单位（px）
      const ox = 960 - 21 * u / 2, oy = 545 - 13 * u / 2;
      // [方(x,y,边), 弧心(cx,cy), 起角点 A, 终角点 B]（坐标单位=u，经典 21×13 排布）
      const BLK = [
        [[0, 0, 13], [13, 13], [0, 13], [13, 0]],
        [[13, 0, 8], [13, 8], [13, 0], [21, 8]],
        [[16, 8, 5], [16, 8], [21, 8], [16, 13]],
        [[13, 10, 3], [16, 10], [16, 13], [13, 10]],
        [[13, 8, 2], [15, 10], [13, 10], [15, 8]],
        [[15, 8, 1], [15, 9], [15, 8], [16, 9]],
        [[15, 9, 1], [15, 9], [16, 9], [15, 10]],
      ];
      const fadeS = 1 - segs(t, 47.0, 47.5);
      const grow = segs(t, 43.3, 46.3, easeInOutCubic);
      const totalArc = BLK.length;
      const prog = grow * totalArc;                   // 弧生长进度（逐条）
      BLK.forEach(([sq, c, A, B], i) => {
        const [sx, sy, ss] = sq;
        const local = clamp01(prog - i);
        if (local <= 0) return;
        // 方块边框（随弧出现）
        g.save();
        g.globalAlpha *= 0.4 * local * fadeS;
        g.strokeStyle = COL.gold; g.lineWidth = 1.4;
        g.strokeRect(ox + sx * u, oy + sy * u, ss * u, ss * u);
        g.restore();
        // 象限弧：自动选扫向（中点落在方块内为准）
        const cxp = c[0] * u + ox, cyp = c[1] * u + oy;
        const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
        const a1 = Math.atan2(B[1] - c[1], B[0] - c[0]);
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const rr = ss * u;
        const end = a0 + da * local;
        g.save();
        g.globalAlpha *= fadeS;
        g.strokeStyle = COL.gold; g.lineWidth = 3.4; g.lineCap = 'round';
        g.shadowColor = 'rgba(201,162,39,0.3)'; g.shadowBlur = 8;
        g.beginPath();
        const steps = Math.max(2, Math.ceil(26 * local));
        for (let k = 0; k <= steps; k++) {
          const a = a0 + da * local * (k / steps);
          const x = cxp + Math.cos(a) * rr, y = cyp + Math.sin(a) * rr;
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
        g.restore();
        if (i === Math.floor(prog) && local < 1) {    // 笔尖
          pen.x = cxp + Math.cos(end) * rr; pen.y = cyp + Math.sin(end) * rr; pen.on = true;
        }
      });
      if (pen.on && fadeS > 0.3) glow(g, pen.x, pen.y, 0.9, COL.goldL, 0.85 * fadeAll);
      if (t > 46.0 && t < 47.4) {
        text(g, 'φ = 1.618…', 960 + 300, 545 + 240, { size: 22, color: COL.ink2, font: '"SF Mono",Consolas,monospace', alpha: segs(t, 46.0, 46.5) * (1 - segs(t, 47.0, 47.4)) * fadeAll });
      }
    }
  }

  // ---------- S8 双纽线（47–52） ----------
  {
    const { p } = S(t, 'lemn');
    if (p > 0) {
      const cx = 960, cy = 515, sc = 440;
      const draw = segs(t, 47.4, 50.2, easeInOutCubic);
      const thEnd = Math.PI * 2 * draw;
      const pt = (th) => {
        const d = 1 + Math.sin(th) * Math.sin(th);
        return [cx + sc * Math.cos(th) / d, cy + sc * 0.72 * Math.sin(th) * Math.cos(th) / d * 2];
      };
      g.save();
      g.strokeStyle = COL.accent; g.lineWidth = 5; g.lineCap = 'round';
      g.shadowColor = 'rgba(94,92,230,0.4)'; g.shadowBlur = 14;
      g.beginPath();
      for (let th = 0; th <= thEnd; th += 0.02) {
        const [x, y] = pt(th);
        th === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
      if (draw > 0 && draw < 1) { const [x, y] = pt(thEnd); glow(g, x, y, 1.1, COL.accentL, 0.9 * fadeAll); }
      // 成形后：中心交点一次呼吸
      if (draw >= 1) {
        const beat = Math.sin((t - 50.2) * 2.4) * 0.5 + 0.5;
        glow(g, cx, cy, 1.0 + beat * 0.5, COL.accentL, 0.35 * fadeAll);
      }
      if (t > 50.6) {
        text(g, A1.captions.lemn, cx, 872, { size: 30, color: COL.ink, ls: 6, alpha: segs(t, 50.6, 51.3) * fadeAll });
      }
    }
  }

  g.restore();
  paperGrain(g, W, H, 0.045);
}
