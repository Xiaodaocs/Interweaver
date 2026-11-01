// Act 5（148–158s）· 落版：深空落回纸白，双纽线一笔画成，字版收束。
import { COL, text, paperGrid, paperGrain, segs, seg, clamp01, easeOutCubic, easeInOutCubic, logoMark, glow, mixColor } from './lib.mjs';
import { A5, W, H } from './timeline.mjs';

export function render(g, t) {
  const inP = segs(t, A5.fadeIn[0], A5.fadeIn[1], easeInOutCubic);
  g.fillStyle = mixColor(COL.void, COL.paper, inP);
  g.fillRect(0, 0, W, H);
  if (inP > 0.4) paperGrid(g, W, H, (inP - 0.4) * 1.2);

  // 双纽线一笔画（品牌三段路径，带画头辉光）
  const draw = segs(t, A5.logoDraw[0], A5.logoDraw[1], easeInOutCubic);
  const size = 168;
  const mx = W / 2 - size / 2, my = 300;
  if (draw > 0) {
    logoMark(g, mx, my, size, { drawU: draw });
    if (draw < 1) glow(g, mx + size / 2, my + size / 2, 1.6, COL.accentL, 0.5);
  }

  const wm = segs(t, A5.wordmark, A5.wordmark + 0.9, easeOutCubic);
  if (wm > 0) {
    text(g, '交织者', W / 2, 560 + (1 - wm) * 20, { size: 64, weight: 500, color: COL.ink, ls: 14, alpha: wm });
    text(g, 'I N T E R W E A V E R', W / 2, 616 + (1 - wm) * 16, { size: 22, weight: 400, color: COL.ink2, ls: 4, alpha: wm * 0.9 });
  }
  const sl = segs(t, A5.slogan, A5.slogan + 0.9, easeOutCubic);
  if (sl > 0) {
    text(g, '连一根线，看见整个世界。', W / 2, 714 + (1 - sl) * 18, { size: 34, weight: 400, color: COL.accent, ls: 4, alpha: sl });
  }
  const sub = segs(t, A5.sub, A5.sub + 0.9, easeOutCubic);
  if (sub > 0) {
    text(g, '一张有数学灵魂的电子草稿纸', W / 2, 768, { size: 21, weight: 300, color: COL.ink2, ls: 3, alpha: sub });
  }

  paperGrain(g, W, H, 0.045);

  // 落幕
  const out = segs(t, A5.fadeOut[0], A5.fadeOut[1], easeInOutCubic);
  if (out > 0) {
    g.fillStyle = `rgba(245,245,247,${out})`;
    g.fillRect(0, 0, W, H);
  }
}
