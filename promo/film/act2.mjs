// Act 2（52–104s）· 自问自答：什么是「关联」？
//  Q1 如果圆会听滑杆的话 → 丝线连上，拖滑杆圆呼吸（正向驱动）
//  Q2 反过来呢？        → 直接拖圆，滑杆自己动（反向求解，产品的核心技术）
//  Q3 一根线牵动几个世界 → θ 同时驱动圆与波（剧本四的可视化）
//  蒙太奇 82–92：割线/导函数/积分/泰勒斯 四个微场景轮播
//  92–104：四画面收成 2×2 同播 → 「这，就是『关联』。」+ 五原语
import { COL, text, textIn, paperGrid, paperGrain, seg, segs, clamp01, easeInOutCubic, easeOutCubic, IOS, SPRING, glow, glassCard, rrect, thread, lerp } from './lib.mjs';
import { A2, W, H } from './timeline.mjs';
import { MINIS } from './montage.mjs';

const NUM = '"SF Mono","Cascadia Mono",Consolas,monospace';

// ---------- 变量滑杆卡（产品右下 #varWin 的视觉语言） ----------
function varCard(g, x, y, w, name, valStr, u, { breath = 0, alpha = 1, badge = '' } = {}) {
  const h = 128;
  glassCard(g, x, y, w, 128, 16, { alpha });
  g.save(); g.globalAlpha = alpha;
  // 名称与数值
  g.font = `600 26px ${NUM}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = COL.ink; g.fillText(name, x + 24, y + 38);
  g.font = `500 22px ${NUM}`; g.textAlign = 'right';
  g.fillStyle = COL.accent; g.fillText(valStr, x + w - 24, y + 38);
  g.font = `400 13px ${NUM}`; g.fillStyle = COL.ink2; g.textAlign = 'left';
  g.fillText('0', x + 28, y + 104);
  g.textAlign = 'right'; g.fillText('4.5', x + w - 28, y + 104);
  // 滑杆轨
  const tx0 = x + 28, tx1 = x + w - 28, ty = y + 78;
  g.strokeStyle = 'rgba(29,29,31,0.18)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(tx1, ty); g.stroke();
  g.strokeStyle = COL.accent; g.lineWidth = 4;
  g.beginPath(); g.moveTo(tx0, ty); g.lineTo(lerp(tx0, tx1, u), ty); g.stroke();
  // 拇指（呼吸光环 = 正在被反向驱动）
  const thx = lerp(tx0, tx1, u);
  if (breath > 0) glow(g, thx, ty, 0.5 + 0.25 * Math.sin(performance0 * 6), COL.accentL, 0.75 * breath);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(thx, ty, 10, 0, 7); g.fill();
  g.strokeStyle = COL.accent; g.lineWidth = 2.6; g.stroke();
  g.restore();
  return { edgeX: x, edgeY: y + 64 };   // 丝线锚点：卡左缘中
}
let performance0 = 0;   // 由 render() 写入的确定性"表"

// ---------- 过场脉冲：Act1 双纽线的线头飞进变量卡 ----------
function flyPulse(g, t) {
  const p = segs(t, 52.0, 52.78, easeInOutCubic);
  if (p <= 0 || p >= 1) return;
  const pts = [[960, 515], [1250, 330], [1240, 620], [1260, 762]];
  const [x, y] = cubic4(pts, p);
  glow(g, x, y, 1.0, COL.accentL, 0.9 * (1 - p * 0.4));
  g.fillStyle = COL.accent; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
}
function cubic4(p, u) {
  const v = 1 - u;
  return [
    v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0],
    v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1],
  ];
}

// ---------- 网格微场景离屏画布 ----------
const miniCanvases = new Map();
function miniCanvas(id, w, h) {
  if (!miniCanvases.has(id)) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    miniCanvases.set(id, c);
  }
  return miniCanvases.get(id);
}

const GRID = { x0: 80, y0: 210, cw: 513, ch: 330, gap: 24 };
const MINI_META = [
  { id: 'secant', label: '割线 → 切线' },
  { id: 'deriv', label: '函数与它的导函数' },
  { id: 'integral', label: '积分区域 · 黎曼和' },
  { id: 'thales', label: '泰勒斯定理' },
];

export function render(g, t) {
  performance0 = t;
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);
  paperGrid(g, W, H, 0.9);
  flyPulse(g, t);

  if (t < 70.4) {   // Q1/Q2 共用同一张「圆 ↔ r」装置
    rigCircle(g, t);
  } else if (t < 82.0) {
    rigTheta(g, t);
  } else if (t < 94.0) {
    montageFull(g, t);
  }
  if (t >= 92.0) gridVerdict(g, t);

  // ---- 问题字幕 ----
  qa(g, t);
  paperGrain(g, W, H, 0.045);
}

function qa(g, t) {
  const qs = [
    { at: A2.q1, out: 63.6, s: '如果，圆会听滑杆的话？' },
    { at: A2.q2, out: 69.6, s: '反过来呢？' },
    { at: A2.q3, out: 73.6, s: '一根线，能牵动几个世界？' },
  ];
  for (const q of qs) {
    if (t < q.at || t > q.out) continue;
    const p = segs(t, q.at, q.at + 0.6, easeOutCubic);
    const fade = 1 - segs(t, q.out - 0.4, q.out);
    text(g, q.s, W * 0.5, 168 + (1 - p) * 22, { size: 44, weight: 300, color: COL.ink, ls: 5, alpha: p * fade });
  }
  // Q2 底部小注
  if (t > 66.6 && t < 70.0) {
    text(g, '拖图形，变量自己动 —— 反向求解', W * 0.5, 948, {
      size: 24, color: COL.ink2, ls: 3, alpha: segs(t, 66.6, 67.2) * (1 - segs(t, 69.4, 70.0)),
    });
  }
}

// ================= Q1/Q2 装置：圆 ↔ 变量 r =================
function rigCircle(g, t) {
  const cx = 700, cy = 520;
  // 数值编舞：Q1 拖滑杆（57.6–63），Q2 拖圆（65.6–69.2）
  let val = 2.0;
  const drags = [
    [57.6, 59.0, 2.0, 4.2], [59.0, 60.4, 4.2, 1.0], [60.4, 62.0, 1.0, 3.2], [62.0, 63.0, 3.2, 2.0],
  ];
  for (const [a, b, v0, v1] of drags) if (t >= a) val = t >= b ? v1 : lerp(v0, v1, segs(t, a, b, easeInOutCubic));
  const grabs = [
    [65.6, 66.6, 2.0, 1.1], [66.6, 68.0, 1.1, 3.8], [68.0, 69.2, 3.8, 2.4],
  ];
  let grabbing = false;
  for (const [a, b, v0, v1] of grabs) if (t >= a) { val = t >= b ? v1 : lerp(v0, v1, segs(t, a, b, easeInOutCubic)); if (t < b) grabbing = true; }
  const dragging = t >= 57.6 && t < 63.0;
  const r = 70 + val * 40;

  // 圆：53.0 一笔画出
  const drawP = segs(t, 53.0, 53.7, easeInOutCubic);
  if (drawP > 0) {
    g.save();
    g.strokeStyle = COL.ink; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * drawP); g.stroke();
    // 半径指示线（丝线的目标端）
    const rp = segs(t, 56.2, 56.8);
    if (rp > 0) {
      g.globalAlpha = rp;
      g.setLineDash([4, 5]); g.strokeStyle = COL.ink2; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r, cy); g.stroke();
      g.setLineDash([]);
      g.font = `500 19px ${NUM}`; g.fillStyle = COL.ink2; g.textAlign = 'center';
      g.fillText('r', cx + r / 2, cy - 14);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // 变量卡：52.8 弹簧落入
  const cp = SPRING(seg(t, A2.cardIn, A2.cardIn + 0.85));
  const cardY = lerp(1160, 690, clamp01(cp)) - (cp > 1 ? (cp - 1) * 40 : 0);
  const cardX = 1230, cardW = 420;
  let anchor = { edgeX: cardX, edgeY: 754 };
  if (cp > 0) {
    anchor = varCard(g, cardX, cardY, cardW, 'r', val.toFixed(2), (val - 0.5) / 4, {
      breath: t > 65.2 && t < 70 ? 1 : 0,
      alpha: clamp01(cp),
    });
  }

  // 丝线：56.6 连上（卡 → 圆的半径端点）
  const grow = segs(t, A2.connect1, A2.connect1 + 0.5, easeOutCubic);
  if (grow > 0) {
    const tx = cx + r, ty = cy;
    const pulses = [];
    if (grow >= 1) {
      const speed = dragging || grabbing ? 2.2 : 0.5;
      const n = dragging || grabbing ? 3 : 1;
      for (let i = 0; i < n; i++) pulses.push((t * speed + i / n) % 1);
    }
    thread(g, anchor.edgeX, anchor.edgeY, tx, ty, t, { growU: grow, pulseUs: pulses });
  }

  // 「关联」小标签（首次连上后挂在丝线中点）
  if (t > 57.4 && t < 64.0) {
    text(g, '关联 Binding', lerp(anchor.edgeX, cx + r, 0.5), lerp(anchor.edgeY, cy, 0.5) - 22, {
      size: 19, color: COL.accent, ls: 2, alpha: segs(t, 57.4, 58.0) * (1 - segs(t, 63.4, 64.0)),
    });
  }

  // Q2 抓取光标：贴着圆边缘的白色光点
  if (t > 65.2 && t < 69.6) {
    const gp = segs(t, 65.2, 65.6, easeOutCubic);
    const fade = 1 - segs(t, 69.2, 69.6);
    const gx = cx + r, gy = cy;
    glow(g, gx, gy, 0.45, '#8B86FF', 0.85 * gp * fade);
    g.save(); g.globalAlpha = gp * fade;
    g.strokeStyle = COL.accent; g.lineWidth = 2.6;
    g.beginPath(); g.arc(gx, gy, 14 + Math.sin(t * 7) * 2.2, 0, 7); g.stroke();
    g.restore();
  }
}

// ================= Q3 装置：θ 同驱圆与波 =================
function rigTheta(g, t) {
  const cx = 585, cy = 470, r = 150;
  const wx0 = 830, wbase = 470, wk = 62, amp = 150;
  const cardX = 1080, cardY = 806, cardW = 460;

  const inP = segs(t, 70.6, 71.6, easeOutCubic);   // 装置入场
  if (inP <= 0) return;
  g.save(); g.globalAlpha = inP;

  // θ 播放：74–82 匀速，末端缓停
  const playT = seg(t, 74.0, 82.0);
  const theta = 2.0 + easeInOutCubic(playT) * 14.2;
  const P = [cx + Math.cos(theta) * r, cy - Math.sin(theta) * r];
  const win = 11;                                    // 波窗口（rad）
  const thLo = Math.max(0, theta - win);
  const S = [wx0 + (theta - thLo) * wk, wbase - Math.sin(theta) * amp];

  // 波基线 + 波
  g.strokeStyle = 'rgba(29,29,31,0.25)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(wx0 - 40, wbase); g.lineTo(1780, wbase); g.stroke();
  g.strokeStyle = COL.accent; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath();
  for (let th = thLo; th <= theta; th += 0.045) {
    const x = wx0 + (th - thLo) * wk, y = wbase - Math.sin(th) * amp;
    th === thLo ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();

  // 圆 + 半径 + P
  g.strokeStyle = COL.ink; g.lineWidth = 3.6;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = COL.palette[0]; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(P[0], P[1]); g.stroke();

  // 梭线：P → S 水平虚线（织布梭）
  g.setLineDash([3, 6]); g.strokeStyle = 'rgba(110,110,115,0.85)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(S[0], S[1]); g.stroke();
  g.setLineDash([]);

  // 动点
  g.fillStyle = COL.palette[0]; g.beginPath(); g.arc(P[0], P[1], 6, 0, 7); g.fill();
  g.fillStyle = COL.accent; g.beginPath(); g.arc(S[0], S[1], 6, 0, 7); g.fill();
  if (t > 74) { glow(g, P[0], P[1], 0.38, COL.palette[0], 0.8); glow(g, S[0], S[1], 0.38, COL.accentL, 0.8); }
  g.restore();

  // θ 卡（71.0 弹入）与三条丝线
  const cp = SPRING(seg(t, 71.0, 71.85));
  if (cp > 0) {
    const y = lerp(1200, cardY, clamp01(cp));
    const anchor = varCard(g, cardX, y, cardW, 'θ', (theta / Math.PI).toFixed(2) + 'π', (theta % (Math.PI * 2)) / (Math.PI * 2), { alpha: clamp01(cp) });
    const chimes = A2.rigChimes;
    const targets = [[P[0], P[1]], [S[0], S[1]], [wx0, wbase]];
    for (let i = 0; i < 3; i++) {
      const gw = segs(t, chimes[i], chimes[i] + 0.55, easeOutCubic);
      if (gw > 0) {
        thread(g, anchor.edgeX, anchor.edgeY, targets[i][0], targets[i][1], t, {
          growU: gw,
          pulseUs: gw >= 1 && t > 74 ? [(t * 1.6 + i * 0.37) % 1] : [],
        });
      }
    }
  }

  // 注解
  if (t > 74.6) {
    text(g, 'θ 同时驱动圆与波 —— 它们本是同一件事', W * 0.5, 972, {
      size: 25, color: COL.ink2, ls: 3, alpha: segs(t, 74.6, 75.4) * (1 - segs(t, 81.2, 82.0)),
    });
  }
}

// ================= 蒙太奇（82–92 全屏轮播） =================
function montageFull(g, t) {
  const items = A2.montage;
  const idx = items.findIndex((m) => t >= m.t0 && t < m.t1);
  const showGridEarly = t >= 92.0;
  if (idx < 0 && !showGridEarly) return;
  const list = idx >= 0 ? [items[idx]] : [];
  // 92 起四格一起出现（由 gridVerdict 接管），这里只负责 82–92 的全屏单格
  for (const m of list) {
    const inX = (1 - SPRING(seg(t, m.t0, m.t0 + 0.45))) * 500;
    const out = 1 - segs(t, m.t1 - 0.25, m.t1);
    const fx0 = 180, fy0 = 130, fw = 1560, fh = 740;
    const c = miniCanvas('full-' + m.id, fw, fh);
    const gg = c.getContext('2d');
    gg.clearRect(0, 0, fw, fh);
    MINIS[m.id](gg, fw, fh, t - m.t0 + 1.2);
    g.save();
    g.globalAlpha = clamp01(out);
    glassCard(g, fx0 - 24 + inX, fy0 - 24, fw + 48, fh + 48, 20, { alpha: clamp01(out) });
    g.drawImage(c, fx0 + inX, fy0);
    text(g, m.cap, fx0 + fw / 2 + inX, 968, { size: 27, color: COL.ink, ls: 2.5, alpha: clamp01(out) * segs(t, m.t0 + 0.3, m.t0 + 0.8) });
    g.restore();
  }
}

// ================= 2×2 同播 + 落版文案（92–104） =================
function gridVerdict(g, t) {
  const { x0, y0, cw, ch, gap } = GRID;
  MINI_META.forEach((m, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const cellX = x0 + col * (cw + gap), cellY = y0 + row * (ch + gap);
    const p = SPRING(seg(t, 92.0 + i * 0.09, 92.0 + i * 0.09 + 0.75));
    if (p <= 0) return;
    // 从全屏位置缩到格位
    const sx = lerp(180, cellX, p), sy = lerp(130, cellY, p);
    const sw = lerp(1560, cw, p), sh = lerp(740, ch, p);
    const c = miniCanvas('cell-' + m.id, cw, ch);
    const gg = c.getContext('2d');
    gg.clearRect(0, 0, cw, ch);
    MINIS[m.id](gg, cw, ch, t);
    g.save();
    glassCard(g, sx - 16, sy - 44, sw + 32, sh + 76, 18, { alpha: clamp01(p) });
    g.globalAlpha = clamp01(p);
    g.drawImage(c, sx, sy, sw, sh);
    text(g, m.label, sx + 4, sy - 20, { size: 18, color: COL.ink2, align: 'left', alpha: clamp01(p) });
    g.restore();
  });

  // 右侧落版（右区 1180–1920，中心 1550）
  const vx = 1550;
  if (t > A2.verdict) {
    text(g, '这，就是「关联」。', vx, 420, {
      size: 54, weight: 600, color: COL.ink, ls: 3,
      alpha: segs(t, A2.verdict, A2.verdict + 0.8),
    });
    text(g, '变量 ⇄ 图形 · 函数 ⇄ 几何', vx, 486, {
      size: 24, color: COL.accent, ls: 2, alpha: segs(t, A2.verdict + 0.4, A2.verdict + 1.2),
    });
  }
  if (t > A2.primitives) {
    const prims = ['实体', '参数', '变量', '绑定', '约束'];
    prims.forEach((s, i) => {
      const p = segs(t, A2.primitives + i * 0.28, A2.primitives + i * 0.28 + 0.5, easeOutCubic);
      if (p <= 0) return;
      const y = 580 + i * 56;
      g.save(); g.globalAlpha = p;
      g.fillStyle = COL.accent; g.beginPath(); g.arc(vx - 180, y, 4.5, 0, 7); g.fill();
      text(g, prims[i], vx - 158, y + 1, { size: 29, color: COL.ink, align: 'left', ls: 4, alpha: p });
      g.restore();
    });
    if (t > 100.9) {
      text(g, '五个原语，组合无穷。', vx, 890, {
        size: 30, weight: 500, color: COL.accent, ls: 3, alpha: segs(t, 100.9, 101.7),
      });
    }
  }
}
