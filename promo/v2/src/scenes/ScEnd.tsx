// S7 落版：canvas 一笔画 logo + DOM 字版。
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { CanvasStage } from '../components/CanvasStage';
import { draw } from '../gen/endcard';
import { BEAT_INT, FPS, SHOTS } from '../beats';
import { COL, FONT } from '../design';

export const ScEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const b = SHOTS.S7_end.from / FPS / BEAT_INT + frame / FPS / BEAT_INT;
  const wm = interpolate(b, [293, 293.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const slogan = interpolate(b, [295, 296], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sub = interpolate(b, [296.2, 297.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const out = interpolate(b, [298, 300], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <CanvasStage beatFrom={272} draw={(g, bb) => draw(g, bb)} />
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
        <div style={{
          position: 'absolute', width: 1920, top: 560, textAlign: 'center',
          fontFamily: FONT.ui, fontSize: 76, fontWeight: 500, letterSpacing: 14, color: COL.ink,
          opacity: wm, transform: `translateY(${(1 - wm) * 20}px)`,
        }}>交织者</div>
        <div style={{
          position: 'absolute', width: 1920, top: 666, textAlign: 'center',
          fontFamily: FONT.ui, fontSize: 26, fontWeight: 400, letterSpacing: 5, color: COL.ink2,
          opacity: wm * 0.9,
        }}>I N T E R W E A V E R</div>
        <div style={{
          position: 'absolute', width: 1920, top: 776, textAlign: 'center',
          fontFamily: FONT.ui, fontSize: 46, fontWeight: 400, letterSpacing: 4, color: COL.accent,
          opacity: slogan, transform: `translateY(${(1 - slogan) * 18}px)`,
        }}>连一根线，看见整个世界。</div>
        <div style={{
          position: 'absolute', width: 1920, top: 856, textAlign: 'center',
          fontFamily: FONT.ui, fontSize: 34, fontWeight: 300, letterSpacing: 3, color: COL.ink2,
          opacity: sub,
        }}>一张有数学灵魂的电子草稿纸</div>
      </div>
    </>
  );
};
