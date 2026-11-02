// S0+S1 序章·图形接力（b0–b40）：
//   「数学 = 背公式 + 刷题 + 考试。」逐字写出 → 镜头推近句号 →
//   句号离纸浮起成"点" → 点镂空鼓成"圆"（circle-match-iris 命门：实心盘半径长大、描边从直径收细）→
//   圆径向坍缩成内接三角形（泰勒斯直角，A/B 严格为直径两端）→ n→∞ 弹回圆 → 圆左移收成单位圆。
// 全段一支笔、一台相机，无剪切 —— v2 核心修复：开场到混剪的丝滑过渡。
import { COL } from '../design';
import { glow, paperGrid, paperGrain, rng, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, IOS, SMOOTH, text, mixColor, colorWithA } from './engine';

const W = 1920, H = 1080;
const SENT = '数学 = 背公式 + 刷题 + 考试';      // 句号单独作为"点"处理
const PERIOD = '。';

interface Cam { cx: number; cy: number; z: number }
function camApply(g: CanvasRenderingContext2D, c: Cam) {
  g.translate(W / 2, H / 2); g.scale(c.z, c.z); g.translate(-c.cx, -c.cy);
}

// 句子的世界坐标排版：居中于 (960, 520)，句号中心世界坐标在 init 时量出
let measure: { periodX: number; periodY: number; baseY: number; widths: number[] } | null = null;
function ensureMeasure(g: CanvasRenderingContext2D) {
  if (measure) return measure;
  g.save();
  g.font = `500 84px "PingFang SC","Microsoft YaHei",sans-serif`;
  const chars = [...SENT, PERIOD];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const x0 = 960 - total / 2;
  let px = x0;
  for (let i = 0; i < chars.length - 1; i++) px += widths[i];
  const periodX = px + widths[widths.length - 1] / 2;
  g.restore();
  measure = { periodX, periodY: 520, baseY: 520, widths };
  return measure;
}

// 背景板书里漂浮的灰色公式（纸面上下文，极淡）
const GLYPHS = ['∫ x² dx', 'e^(iπ)+1=0', 'a²+b²=c²', 'lim h→0', 'Σ 1/n²=π²/6', 'sin²θ+cos²θ=1', 'y = kx + b', 'Δy/Δx', '∀ε>0 ∃δ>0', '√2≈1.414', 'f′(x)', 'θ=60°', 'S=πr²', 'm=(y₂−y₁)/(x₂−x₁)'];
let ghosts: { x: number; y: number; s: string; size: number; rot: number }[] | null = null;
function ensureGhosts() {
  if (ghosts) return ghosts;
  const r = rng(4242);
  ghosts = [];
  for (let i = 0; i < 26; i++) {
    ghosts.push({
      x: -300 + r() * (W + 600), y: -200 + r() * (H + 400),
      s: GLYPHS[Math.floor(r() * GLYPHS.length)],
      size: 20 + r() * 14, rot: (r() - 0.5) * 0.08,
    });
  }
  return ghosts;
}

// 正多边形径向函数（圆→多边形诚实 morph）：方向 θ 上 n 边形边界半径（外接圆半径 r）
function polyRadius(theta: number, n: number, r: number, rot: number) {
  const k = Math.PI / n;
  const local = ((theta - rot) % (2 * k) + 2 * k) % (2 * k) - k;
  return (r * Math.cos(k)) / Math.cos(local);
}

export function draw(g: CanvasRenderingContext2D, b: number) {
  const m = ensureMeasure(g);
  ensureGhosts();
  g.fillStyle = COL.paper; g.fillRect(0, 0, W, H);

  // ---------- 相机 ----------
  const pushE = segs(b, 8, 13.5, easeInOutCubic);            // S0 推近句号
  const dotLift = segs(b, 14, 18, SMOOTH);                   // 点浮起到画面中心
  const settleE = segs(b, 18, 22, easeInOutCubic);           // 落定
  const circleBack = segs(b, 22, 26, easeInOutCubic);        // 圆长大时镜头退开
  const handoff = segs(b, 38, 40, SMOOTH);                   // 交给 S2：左移收小
  const dotX = lerp(m!.periodX, 960, dotLift);
  const dotY = lerp(m!.periodY, 505, dotLift);
  const cam: Cam = handoff > 0
    ? { cx: lerp(960, 700, handoff), cy: lerp(505, 540, handoff), z: lerp(1.02, 1.0, handoff) }
    : dotLift > 0 || b >= 14
      ? { cx: lerp(dotX, 960, settleE * 0.35), cy: lerp(dotY, 520, settleE * 0.35), z: lerp(lerp(2.1, 1.25, dotLift), 1.02, circleBack) }
      : { cx: lerp(960, m!.periodX, pushE), cy: lerp(520, m!.periodY - 6, pushE), z: lerp(1, 2.1, pushE) };

  g.save();
  camApply(g, cam);

  // ---------- 背景板书（推近时变淡） ----------
  const ghostA = 0.15 * (1 - pushE) * (1 - dotLift * 0.7);
  if (ghostA > 0.01) {
    g.save();
    for (const gh of ghosts!) {
      g.save();
      g.translate(gh.x, gh.y); g.rotate(gh.rot);
      g.globalAlpha = ghostA;
      g.font = `${gh.size}px Consolas,monospace`;
      g.fillStyle = COL.ink2; g.textAlign = 'center';
      g.fillText(gh.s, 0, 0);
      g.restore();
    }
    g.restore();
  }

  // ---------- 句子 ----------
  // 逐字写出 b0.5–b5.2（每字 0.4 拍）；点离纸后句子残留散开消隐（b14–b17）
  const scatter = segs(b, 14, 17, easeInOutCubic);
  const sentA = 1 - scatter;
  if (sentA > 0.01) {
    g.save();
    g.font = `500 84px "PingFang SC","Microsoft YaHei",sans-serif`;
    g.textBaseline = 'middle';
    const chars = [...SENT];
    let px = 960 - (m!.widths.reduce((a, c) => a + c, 0)) / 2;
    const r = rng(99);
    chars.forEach((c, i) => {
      const w = m!.widths[i];
      const charAt = 0.5 + i * 0.32;
      const p = segs(b, charAt, charAt + 0.5, easeOutCubic);
      if (p <= 0) { px += w; return; }
      const fade = (1 - scatter) * (1 - pushE * 0.75);
      const dx = scatter * (r() - 0.5) * 260;
      const dy = scatter * (60 + r() * 320);
      const rr = rng(i * 7 + 3);
      g.globalAlpha = p * fade * (b > 8 && i % 3 === 0 ? 1 - pushE * 0.55 : 1);
      g.fillStyle = COL.ink;
      g.fillText(c, px + dx + (1 - p) * 0, m!.baseY + dy + (1 - p) * 14 + scatter * (rr() - 0.5) * 40);
      px += w;
    });
    g.restore();
  }

  // ---------- 主角：句号 → 点 ----------
  // b5.2 句号随句写出；b13 预震；b14 离纸；b18 落定中心
  const periodIn = segs(b, 5.2, 5.7, easeOutCubic);
  if (periodIn > 0 && dotLift < 1) {
    const tremble = segs(b, 13, 14) * 2.2;
    const jx = tremble * Math.sin(b * 47) * 1.5;
    const jy = tremble * Math.cos(b * 39) * 1.5;
    const dx = lerp(m!.periodX, dotX, dotLift) + jx;
    const dy = lerp(m!.periodY, dotY, dotLift) + jy - dotLift * 40 * (1 - dotLift);   // 先上扬的弧线
    const dotR = lerp(13, 15, dotLift);
    const a = periodIn * (1 - segs(b, 21.5, 22.5));      // 镂空成环时实心点退场
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      // 两次预备脉冲（b18 / b19.5）
      for (const pb of [18, 19.5]) {
        const pp = seg(b, pb, pb + 1.1);
        if (pp > 0 && pp < 1) {
          g.globalAlpha = a * 0.8 * (1 - pp);
          g.strokeStyle = COL.accent; g.lineWidth = 2.5 * (1 - pp) + 0.5;
          g.beginPath(); g.arc(dx, dy, dotR + pp * 74, 0, 7); g.stroke();
        }
      }
      const pulseScale = 1 + 0.16 * (Math.max(0, seg(b, 18, 18.5) - seg(b, 18.5, 19.1)) + Math.max(0, seg(b, 19.5, 20) - seg(b, 20, 20.6)));
      g.globalAlpha = a;
      g.fillStyle = COL.accent;
      g.beginPath(); g.arc(dx, dy, dotR * pulseScale, 0, 7); g.fill();
      glow(g, dx, dy, 0.5 * pulseScale, COL.accentL, 0.55 * a);
      g.restore();
    }
  }

  // ---------- 点镂空鼓成圆（b21–b25），随后的一切几何 morph ----------
  // circleNow: 当前"圆"的中心与半径（含 handoff 位移）
  const circleCX = lerp(960, 640, handoff);
  const circleCY = lerp(505, 540, handoff);
  const growE = segs(b, 21, 25, easeOutCubic);             // 半径 13→230
  let R = lerp(13, 230, growE) * lerp(1, 150 / 230, handoff);
  const collapse = segs(b, 28, 32, easeInOutCubic);        // 圆→三角形
  const nRun = 3 + 37 * segs(b, 33, 38, easeInOutCubic);   // 三角形→n→∞
  const backToCircle = segs(b, 38, 39, easeInOutCubic);    // 交班前回到纯圆

  if (growE > 0) {
    const cx = circleCX, cy = circleCY;
    g.save();
    if (b < 28) {
      // 镂空成环：strokeW 从"直径"收到 4px —— 看上去就是实心点长成了圆环
      const strokeW = lerp(26, 4.5, easeOutCubic(seg(b, 21, 24.2)));
      g.strokeStyle = COL.accent;
      g.lineWidth = strokeW;
      g.lineCap = 'round';
      // 画头：环以"画出"的方式生长（角度扫过 + 半径同步）
      const sweep = seg(b, 21, 24.6) * Math.PI * 2;
      g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, sweep));
      g.stroke();
      if (sweep > 0 && sweep < Math.PI * 2) {
        const hx = cx + Math.cos(-Math.PI / 2 + sweep) * R, hy = cy + Math.sin(-Math.PI / 2 + sweep) * R;
        glow(g, hx, hy, 0.55, COL.accentL, 0.9);
        g.fillStyle = COL.accent; g.beginPath(); g.arc(hx, hy, 5, 0, 7); g.fill();
      }
    }
    // 坍缩/演化段：径向 morph（b28 起）
    if (b >= 27.4) {
      const n = b < 33 ? 3 : nRun;
      const u = b < 33 ? collapse : 1 - backToCircle;
      g.strokeStyle = COL.ink;
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.beginPath();
      const rot = -Math.PI / 2;
      for (let i = 0; i <= 240; i++) {
        const th = (i / 240) * Math.PI * 2;
        const rr = lerp(R, polyRadius(th, n, R, rot), u);
        const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
      // 三个顶点（b26 起逐拍点亮）：等边三角形的真实顶点 = rot + k·120°
      const vertAlpha = segs(b, 26, 26.6) * (1 - segs(b, 37.4, 38.4));
      const VA = [270, 30, 150].map((d) => (d * Math.PI) / 180);
      VA.forEach((a, i) => {
        const on = segs(b, 26 + i * 0.5, 26.4 + i * 0.5);
        if (on <= 0 || vertAlpha <= 0) return;
        const rr = lerp(R, polyRadius(a, n, R, rot), u);
        const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr;
        g.save();
        g.globalAlpha = vertAlpha * on;
        g.fillStyle = i < 2 ? COL.palette[0] : COL.accent;
        g.beginPath(); g.arc(vx, vy, 6.5, 0, 7); g.fill();
        g.restore();
      });
    }
    g.restore();
  }

  // n→∞ 小注（画布内辅助文字，≥32px）
  if (b > 34 && b < 37.8) {
    text(g, 'n → ∞', circleCX + R + 90, circleCY + 40, {
      size: 38, color: COL.ink2, font: '"SF Mono",Consolas,monospace',
      alpha: segs(b, 34, 34.8) * (1 - segs(b, 37.2, 37.8)),
    });
  }

  g.restore();

  // S1 段中标题（DOM 之外的唯一句：贴近世界中心下方）
  if (b > 24 && b < 40) {
    text(g, '数学，本来很美。', 960, 900, {
      size: 60, weight: 400, color: COL.ink, ls: 6,
      alpha: segs(b, 24.5, 25.5) * (1 - segs(b, 38.6, 39.8)),
    });
  }
}
