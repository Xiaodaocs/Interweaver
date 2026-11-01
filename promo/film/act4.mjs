// Act 4（120–148s）· 震撼终章：原来，知识是一张网。
// 数据 = 产品真实知识网（promo/film/knowledgeData.js，由 app/src/achievements 提取）：
// 65 个知识点 × 7 难度层 × 4 学科组带；80 条依赖边 + 9 条相关边。
// 编排：七颗星依次亮起（镜头跟随扫过全图）→ 英雄路径慢速生长 → 全网级联 → 心跳。
import { COL, text, voidBg, seg, segs, clamp01, easeInOutCubic, easeOutCubic, IOS, glow, colorWithA, hashStr, lerp } from './lib.mjs';
import { A4, LIT7, W, H, edgeSchedule } from './timeline.mjs';
import { KNOWLEDGE } from './knowledgeData.js';

const GROUP_Y = { '点与绑定': 300, '角与旋转': 470, '构造与约束': 640, '微积分': 810 };
const LAYER_X = (l) => 240 + l * 240;

// ---------- 布局（解析式，一次算定；与产品 starmapLayout 同思路：列=难度，带=学科） ----------
let NET = null;
function layout() {
  if (NET) return NET;
  const byCell = new Map();
  for (const n of KNOWLEDGE.nodes) {
    const k = n.layer + '|' + n.group;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(n);
  }
  const pos = new Map();
  for (const [k, list] of byCell) {
    list.sort((a, b) => a.id < b.id ? -1 : 1);
    list.forEach((n, i) => {
      const h = hashStr(n.id);
      const jx = ((h & 255) / 255 - 0.5) * 30;
      const jy = (((h >> 8) & 255) / 255 - 0.5) * 22;
      pos.set(n.id, {
        x: LAYER_X(n.layer) + jx,
        y: GROUP_Y[n.group] + (i - (list.length - 1) / 2) * 66 + jy,
        node: n,
      });
    });
  }
  const sched = edgeSchedule();
  // 节点点亮时刻：LIT7 用各自的星亮时间；其余 = 第一条长完的入边
  const litAt = new Map();
  LIT7.forEach((id, i) => litAt.set(id, A4.stars[i]));
  for (const e of sched) {
    if (!litAt.has(e.to)) litAt.set(e.to, e.t0 + e.grow);
  }
  NET = { pos, sched, litAt };
  return NET;
}

// ---------- 相机关键帧：跟随七星点亮扫过全图，再持续拉远 ----------
function camKeys() {
  const { pos } = layout();
  const ks = LIT7.map((id, i) => {
    const p = pos.get(id);
    return { t: A4.stars[i], cx: p.x, cy: p.y, z: 1.75 - i * 0.06 };
  });
  return [
    { t: 119.8, cx: pos.get('n.point').x, cy: pos.get('n.point').y, z: 1.8 },
    ...ks,
    { t: 129.0, cx: 960, cy: 555, z: 1.0 },
    { t: 140.0, cx: 960, cy: 555, z: 0.92 },
    { t: 148.0, cx: 960, cy: 540, z: 0.9 },
  ];
}
function camAt(t) {
  const ks = camKeys();
  if (t <= ks[0].t) return ks[0];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t <= b.t) {
      const u = easeInOutCubic(seg(t, a.t, b.t));
      return { cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), z: lerp(a.z, b.z, u) };
    }
  }
  return ks[ks.length - 1];
}

// 边长估计（dash 截断用）
function bez(x0, y0, x1, y1) {
  const dx = Math.max(60, Math.abs(x1 - x0) * 0.45), s = Math.sign(x1 - x0 || 1);
  return [[x0, y0], [x0 + s * dx, y0], [x1 - s * dx, y1], [x1, y1]];
}
function bezLen(p) {
  let L = 0, lx = p[0][0], ly = p[0][1];
  for (let i = 1; i <= 20; i++) {
    const u = i / 20, v = 1 - u;
    const x = v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0];
    const y = v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1];
    L += Math.hypot(x - lx, y - ly); lx = x; ly = y;
  }
  return L;
}

export function render(g, t) {
  const { pos, sched, litAt } = layout();
  voidBg(g, W, H, t);

  // 极轻的氛围尘埃（确定性漂移）
  dust(g, t);

  const cam = camAt(t);
  g.save();
  g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-cam.cx, -cam.cy);

  // ---- 亲缘暗网（126 起显形） ----
  const dimWeb = segs(t, 126.0, 128.5);
  if (dimWeb > 0) {
    g.save(); g.globalAlpha = 0.5 * dimWeb;
    g.strokeStyle = '#2A2A3A'; g.lineWidth = 1 / cam.z;
    g.setLineDash([2, 8]);
    for (const e of sched) {
      const a = pos.get(e.from), b = pos.get(e.to);
      const p = bez(a.x, a.y, b.x, b.y);
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], b.x, b.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }

  // ---- 织边生长 ----
  for (const e of sched) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const growP = seg(t, e.t0, e.t0 + e.grow);
    if (growP <= 0) continue;
    const p = bez(a.x, a.y, b.x, b.y);
    const col = e.kind === 'rel' ? '185,182,255' : '139,134,255';
    if (growP < 1) {
      const L = bezLen(p);
      g.save();
      g.strokeStyle = `rgba(${col},0.95)`; g.lineWidth = 2.2 / cam.z; g.lineCap = 'round';
      g.setLineDash([L * easeOutCubic(growP), L * 2]);
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], b.x, b.y);
      g.stroke();
      g.restore();
      // 生长头光点
      const u = easeOutCubic(growP);
      const v = 1 - u;
      const hx = v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0];
      const hy = v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1];
      glow(g, hx, hy, 0.55 / cam.z, '#B9B6FF', 0.9);
    } else {
      // 已成边：行进虚线 + 周期光脉冲
      g.save();
      g.strokeStyle = `rgba(${col},0.55)`; g.lineWidth = 1.6 / cam.z;
      g.setLineDash([3, 7]); g.lineDashOffset = -t * 26;
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], b.x, b.y);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      const h = hashStr(e.from + e.to);
      const pu = (t * 0.45 + (h % 100) / 100) % 1;
      const v = 1 - pu;
      const px2 = v * v * v * p[0][0] + 3 * v * v * pu * p[1][0] + 3 * v * pu * pu * p[2][0] + pu * pu * pu * p[3][0];
      const py2 = v * v * v * p[0][1] + 3 * v * v * pu * p[1][1] + 3 * v * pu * pu * p[2][1] + pu * pu * pu * p[3][1];
      glow(g, px2, py2, 0.4 / cam.z, '#B9B6FF', 0.65);
    }
  }

  // ---- 节点 ----
  const beat = heartbeat(t);
  for (const [id, p] of pos) {
    const n = p.node;
    const lit = litAt.has(id) ? seg(t, litAt.get(id), litAt.get(id) + 0.5) : 0;
    const revealed = lit > 0 || sched.some((e) => (e.to === id || e.from === id) && t > e.t0 - 0.4);
    const fl = Math.sin(t * 0.7 + hashStr(id) % 10) * 3;   // 浮动感
    const x = p.x, y = p.y + fl;
    const gc = COL.group[n.group] || COL.star;
    if (lit > 0) {
      const breathe = 1 + 0.4 * beat;
      glow(g, x, y, (0.9 + 0.35 * lit) * breathe, gc, 0.85 * lit);
      g.fillStyle = COL.lit; g.globalAlpha = lit;
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
      g.globalAlpha = 1;
      // 学科色外环（交织节点用六边形）
      g.strokeStyle = gc; g.lineWidth = 1.8; g.globalAlpha = 0.9 * lit;
      if (n.kind === 'weave') {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + k * Math.PI / 3;
          const px3 = x + Math.cos(a) * 12, py3 = y + Math.sin(a) * 12;
          k ? g.lineTo(px3, py3) : g.moveTo(px3, py3);
        }
        g.closePath(); g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
      text(g, n.title, x, y + 28, { size: 14, color: colorWithA('#F5F3FF', 0.92 * lit), ls: 1, alpha: lit });
    } else if (revealed) {
      g.fillStyle = COL.dim; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill();
      g.globalAlpha = 1;
    } else {
      g.fillStyle = '#23232F'; g.globalAlpha = 0.55;
      g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
  }
  g.restore();

  // ---- 文案 ----
  if (t > A4.starsText && t < 128.6) {
    text(g, '每一次交织，都被记住。', W * 0.5, 150, {
      size: 34, weight: 300, color: colorWithA('#F5F3FF', 0.9), ls: 5,
      alpha: segs(t, A4.starsText, A4.starsText + 0.8) * (1 - segs(t, 127.8, 128.6)),
    });
  }
  if (t > A4.netText) {
    const p = segs(t, A4.netText, A4.netText + 1.1, easeOutCubic);
    // 文字背后的暗色晕，保证在亮网上的可读性
    const halo = g.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 560);
    halo.addColorStop(0, `rgba(11,11,18,${0.72 * p})`);
    halo.addColorStop(1, 'rgba(11,11,18,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    glow(g, W / 2, H * 0.40, 6, '#5E5CE6', 0.25 * p);
    text(g, '原来，知识是一张网。', W * 0.5, H * 0.40 + (1 - p) * 30, {
      size: 74, weight: 500, color: '#F5F3FF', ls: 8, alpha: p,
    });
  }
  if (t > A4.youText) {
    text(g, '而你，是交织者。', W * 0.5, H * 0.40 + 96, {
      size: 40, weight: 300, color: COL.goldL, ls: 6,
      alpha: segs(t, A4.youText, A4.youText + 1.0),
    });
  }
}

// 心跳：140.2 的双鼓包（lub-dub）
function heartbeat(t) {
  const d = t - A4.heartbeat;
  if (d < -0.2 || d > 1.4) return 0;
  return Math.exp(-Math.pow(d / 0.09, 2)) + 0.65 * Math.exp(-Math.pow((d - 0.24) / 0.09, 2));
}

// 尘埃
let dustPts = null;
function dust(g, t) {
  if (!dustPts) {
    dustPts = [];
    let s = 4242;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 130; i++) dustPts.push({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 1.4, sp: 2 + rnd() * 6, ph: rnd() * 7 });
  }
  g.save();
  for (const d of dustPts) {
    const a = 0.05 + 0.07 * (Math.sin(t * 0.4 + d.ph) * 0.5 + 0.5);
    g.fillStyle = `rgba(185,182,255,${a})`;
    g.beginPath(); g.arc((d.x + t * d.sp) % W, d.y, d.r, 0, 7); g.fill();
  }
  g.restore();
}
