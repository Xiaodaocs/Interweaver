import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CanvasStage } from '../components/CanvasStage';
import { Captions } from '../components/Captions';
import { draw } from '../gen/calculus';
import { BEAT_INT, FPS, SHOTS } from '../beats';
import { COL } from '../design';

const CAPS = [
  { from: 171.2, to: 176.2, text: '同一根线，织出微积分。', x: 1180, y: 480, width: 660, size: 56, weight: 500, ls: 3 },
  { from: 172.4, to: 176.2, text: '割线 · 切线 · 导函数 · 积分 —— 全是「关联」的组合', x: 1180, y: 570, width: 660, size: 34, color: COL.ink2, ls: 2 },
];

export const ScCalc: React.FC = () => {
  const frame = useCurrentFrame();
  const b = SHOTS.S4_calc.from / FPS / BEAT_INT + frame / FPS / BEAT_INT;
  return (
    <>
      <CanvasStage beatFrom={152} draw={(g, bb, W, H) => draw(g, bb, W, H)} />
      <Captions beat={b} items={CAPS} />
    </>
  );
};
