// S6 知识网终章：canvas 星图 + DOM 主题句（带暗色晕保证可读）。
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { CanvasStage } from '../components/CanvasStage';
import { Captions } from '../components/Captions';
import { draw } from '../gen/starmap';
import { BEAT_INT, FPS, SHOTS } from '../beats';
import { COL, FONT } from '../design';

export const ScNet: React.FC = () => {
  const frame = useCurrentFrame();
  const b = SHOTS.S6_net.from / FPS / BEAT_INT + frame / FPS / BEAT_INT;
  const heroP = interpolate(b, [251, 252.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <CanvasStage beatFrom={200} draw={(g, bb, W, H) => draw(g, bb, W, H)} />
      <Captions beat={b} items={[
        { from: 208, to: 215.5, text: '每一次交织，都被记住。', y: 120, size: 56, weight: 300, ls: 5, color: 'rgba(245,243,255,0.92)' },
      ]} />
      {/* 主题句（暗色晕 + 双行） */}
      {b > 250.6 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 330, bottom: 620,
            background: 'radial-gradient(ellipse 46% 60% at 50% 50%, rgba(11,11,18,0.72), rgba(11,11,18,0) 70%)',
            opacity: heroP,
          }} />
          <div style={{
            position: 'absolute', width: 1920, top: 400, textAlign: 'center',
            fontFamily: FONT.ui, fontSize: 76, fontWeight: 500, letterSpacing: 8, color: '#F5F3FF',
            opacity: heroP, transform: `translateY(${(1 - heroP) * 30}px)`,
          }}>原来，知识是一张网。</div>
          <div style={{
            position: 'absolute', width: 1920, top: 516, textAlign: 'center',
            fontFamily: FONT.ui, fontSize: 48, fontWeight: 300, letterSpacing: 6, color: COL.goldL,
            opacity: interpolate(b, [253.6, 254.8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}>而你，是交织者。</div>
        </div>
      )}
    </>
  );
};
