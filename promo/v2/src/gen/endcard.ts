// S7 落版（b272–b300）：深空收拢成一点光 → 纸面 → 双纽线一笔画 → 字版落定 → 淡出。
import { COL } from '../design';
import { paperGrid, logoMark, glow, seg, segs, lerp, easeInOutCubic, easeOutCubic, mixColor, text } from './engine';

const W = 1920, H = 1080;

export function draw(g: CanvasRenderingContext2D, b: number) {
  const inP = segs(b, 272, 274.5, easeInOutCubic);
  g.fillStyle = mixColor(COL.void, COL.paper, inP);
  g.fillRect(0, 0, W, H);

  // 收拢的光点（S6 的网余韵）落回纸面中心
  const convergeGlow = 1 - segs(b, 274, 277.5, easeOutCubic);
  if (convergeGlow > 0) {
    const s = lerp(6, 1.2, segs(b, 272, 276, easeInOutCubic));
    glow(g, W / 2, 470, s, '#8B86FF', 0.5 * convergeGlow * (1 - inP * 0.5));
  }
  if (inP > 0.4) paperGrid(g, W, H, (inP - 0.4) * 1.4);

  // 双纽线一笔画（b276–292.6）
  const drawP = segs(b, 276, 292.6, easeInOutCubic);
  const size = 190;
  const mx = W / 2 - size / 2, my = 296;
  if (drawP > 0) {
    logoMark(g, mx, my, size, { drawU: drawP });
    if (drawP < 1) glow(g, mx + size / 2, my + size / 2, 0.9, COL.accentL, 0.5);
  }

  // 落定一刻（b293）：轻辉
  const land = seg(b, 293, 293.5) - seg(b, 293.5, 294.8);
  if (land > 0) glow(g, W / 2, my + size / 2, 2.2, COL.accentL, 0.5 * land);

  // 落幕淡出
  const out = segs(b, 298, 300, easeInOutCubic);
  if (out > 0) {
    g.fillStyle = `rgba(245,245,247,${out})`;
    g.fillRect(0, 0, W, H);
  }
}
