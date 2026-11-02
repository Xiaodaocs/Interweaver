// S6 知识网终章（b200–b272）：七星逐拍点亮 → 英雄路径生长 → 全网级联 → 心跳 → 主题句。
// v2 修复：布局扩散贴近产品星图（层距 340 / 组带距 260）；镜头跟随点亮扫过全图后持续拉远。
import { COL } from '../design';
import { voidBg, glow, hashStr, seg, segs, clamp01, lerp, easeInOutCubic, easeOutCubic, text, colorWithA } from './engine';
import { buildNet, LIT7, STAR_BEATS } from './knowledge';
import { rng } from './engine';

const NET = { current: null as null | ReturnType<typeof buildNet> };
function net() { if (!NET.current) NET.current = buildNet(); return NET.current; }

// ---------- 相机：跟随七星点亮，随后持续拉远 ----------
interface CamKey { b: number; cx: number; cy: number; z: number }
function camKeys(): CamKey[] {
  const { nodes } = net();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ks: CamKey[] = LIT7.map((id, i) => {
    const p = byId.get(id)!;
    return { b: STAR_BEATS[i], cx: p.x, cy: p.y, z: 1.7 - i * 0.08 };
  });
  return [
    { b: 200, cx: byId.get('n.point')!.x, cy: byId.get('n.point')!.y, z: 1.75 },
    ...ks,
    { b: 222, cx: 1320, cy: 700, z: 1.05 },
    { b: 240, cx: 1320, cy: 700, z: 0.78 },
    { b: 249, cx: 1320, cy: 700, z: 0.72 },     // 心跳
    { b: 258, cx: 1320, cy: 690, z: 0.62 },
    { b: 272, cx: 1320, cy: 690, z: 0.60 },
  ];
}
function camAt(b: number): { cx: number; cy: number; z: number } {
  const ks = camKeys();
  if (b <= ks[0].b) return ks[0];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], kk = ks[i + 1];
    if (b <= kk.b) {
      const u = easeInOutCubic(seg(b, a.b, kk.b));
      return { cx: lerp(a.cx, kk.cx, u), cy: lerp(a.cy, kk.cy, u), z: lerp(a.z, kk.z, u) };
    }
  }
  return ks[ks.length - 1];
}

function bez(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const dx = Math.max(60, Math.abs(x1 - x0) * 0.45), s = Math.sign(x1 - x0 || 1);
  return [[x0, y0], [x0 + s * dx, y0], [x1 - s * dx, y1], [x1, y1]];
}
function bezPt(p: [number, number][], u: number): [number, number] {
  const v = 1 - u;
  return [
    v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0],
    v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1],
  ];
}
function bezLen(p: [number, number][]) {
  let L = 0, prev = bezPt(p, 0);
  for (let i = 1; i <= 20; i++) { const q = bezPt(p, i / 20); L += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
  return L;
}

// 心跳包络（lub-dub 双峰）
function heartbeat(b: number) {
  const d = b - 249;
  if (d < -0.4 || d > 3) return 0;
  return Math.exp(-Math.pow(d / 0.18, 2)) + 0.65 * Math.exp(-Math.pow((d - 0.55) / 0.18, 2));
}

// 氛围尘埃（种子化，确定性）
let dustPts: { x: number; y: number; r: number; sp: number; ph: number }[] | null = null;
function dust(g: CanvasRenderingContext2D, b: number, W: number, H: number) {
  if (!dustPts) {
    dustPts = [];
    const r = rng(4242);
    for (let i = 0; i < 130; i++) dustPts.push({ x: r() * W, y: r() * H, r: 0.6 + r() * 1.4, sp: 0.5 + r() * 1.4, ph: r() * 7 });
  }
  g.save();
  for (const d of dustPts) {
    const a = 0.05 + 0.07 * (Math.sin(b * 0.26 + d.ph) * 0.5 + 0.5);
    g.fillStyle = `rgba(185,182,255,${a})`;
    g.beginPath(); g.arc((d.x + b * d.sp) % W, d.y, d.r, 0, 7); g.fill();
  }
  g.restore();
}

export function draw(g: CanvasRenderingContext2D, b: number, W: number, H: number) {
  const { nodes, edges, litBeat } = net();
  voidBg(g, W, H);
  dust(g, b, W, H);

  const cam = camAt(b);
  g.save();
  g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-cam.cx, -cam.cy);

  const beat = heartbeat(b);
  const converge = segs(b, 268, 272, easeInOutCubic);   // 收尾：光向内收拢

  // ---- 亲缘暗网（b216 起显形） ----
  const dimWeb = segs(b, 214, 218);
  if (dimWeb > 0) {
    g.save(); g.globalAlpha = 0.5 * dimWeb;
    g.strokeStyle = '#2A2A3A'; g.lineWidth = 1 / cam.z;
    g.setLineDash([2, 8]);
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from)!, bb2 = nodes.find((n) => n.id === e.to)!;
      const p = bez(a.x, a.y, bb2.x, bb2.y);
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], bb2.x, bb2.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }

  // ---- 织边 ----
  for (const e of edges) {
    const growP = seg(b, e.beat, e.beat + e.grow);
    if (growP <= 0) continue;
    const a = nodes.find((n) => n.id === e.from)!, bN = nodes.find((n) => n.id === e.to)!;
    const p = bez(a.x, a.y, bN.x, bN.y);
    const col = e.kind === 'rel' ? '185,182,255' : '139,134,255';
    if (growP < 1) {
      const L = bezLen(p);
      g.save();
      g.strokeStyle = `rgba(${col},0.95)`; g.lineWidth = 2.2 / cam.z; g.lineCap = 'round';
      g.setLineDash([L * easeOutCubic(growP), L * 2]);
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], bN.x, bN.y);
      g.stroke();
      g.restore();
      const tip = bezPt(p, easeOutCubic(growP));
      glow(g, tip[0], tip[1], 0.3 / cam.z, '#B9B6FF', 0.9);
    } else {
      g.save();
      g.strokeStyle = `rgba(${col},0.55)`; g.lineWidth = 1.6 / cam.z;
      g.setLineDash([3, 7]); g.lineDashOffset = -b * 13;
      g.beginPath(); g.moveTo(a.x, a.y);
      g.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], bN.x, bN.y);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      const h = hashStr(e.from + e.to);
      const pu = (b * 0.11 + (h % 100) / 100) % 1;
      const pp = bezPt(p, pu);
      glow(g, pp[0], pp[1], 0.22 / cam.z, '#B9B6FF', 0.6);
    }
  }

  // ---- 节点 ----
  for (const n of nodes) {
    const lit0 = litBeat.get(n.id);
    const lit = lit0 != null ? seg(b, lit0, lit0 + 1.2) : 0;
    const revealed = lit > 0 || edges.some((e) => (e.to === n.id || e.from === n.id) && b > e.beat - 0.4);
    const fl = Math.sin(b * 0.44 + hashStr(n.id) % 10) * 4;
    let x = n.x, y = n.y + fl;
    if (converge > 0) {   // 收拢：向质心轻拉
      x = lerp(x, 1320, converge * 0.22);
      y = lerp(y, 690, converge * 0.22);
    }
    const gc = COL.group[n.group] || COL.star;
    if (lit > 0) {
      const breathe = 1 + 0.4 * beat;
      glow(g, x, y, 0.55 * breathe, gc, 0.85 * lit);
      g.fillStyle = COL.lit; g.globalAlpha = lit;
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = gc; g.lineWidth = 2; g.globalAlpha = 0.9 * lit;
      if (n.kind === 'weave') {
        g.beginPath();
        for (let kk = 0; kk < 6; kk++) {
          const a = Math.PI / 6 + (kk * Math.PI) / 3;
          const px = x + Math.cos(a) * 14, py = y + Math.sin(a) * 14;
          kk ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, 13, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
      // 标签防互压：近景（z≥1.15）显示全部点亮标签；远景只留七星主角与交织节点
      const showLabel = cam.z >= 1.15 || n.kind === 'weave' || LIT7.includes(n.id);
      if (showLabel) {
        text(g, n.title, x, y + 34, { size: 26, color: colorWithA('#F5F3FF', 0.92 * lit), ls: 1, alpha: lit });
      }
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

  // 交接 S7：星网整体淡出成一点收拢的光（b270–272）
  const handoff = segs(b, 270, 272, easeInOutCubic);
  if (handoff > 0) {
    g.fillStyle = `rgba(11,11,18,${handoff})`;
    g.fillRect(0, 0, W, H);
    glow(g, W / 2, H * 0.47, 2.4 * (1 - handoff) + 0.8, '#8B86FF', 0.6 * handoff);
  }
}

// 主题句（文字仍由 DOM 层负责；这里提供暗色晕的钩子给场景壳）
export { heartbeat };
