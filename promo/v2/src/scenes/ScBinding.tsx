import React from 'react';
import { CanvasStage } from '../components/CanvasStage';
import { Captions } from '../components/Captions';
import { draw } from '../gen/binding';
import { COL } from '../design';
import { useCurrentFrame } from 'remotion';
import { BEAT_INT, FPS, SHOTS } from '../beats';

const CAPS = [
  { from: 96.5, to: 111.4, text: '如果，圆会听滑杆的话？', y: 150, size: 60, weight: 300, ls: 5 },
  { from: 112.6, to: 121.5, text: '反过来呢？', y: 150, size: 60, weight: 300, ls: 5 },
  { from: 116, to: 123.4, text: '拖图形，变量自己动 —— 反向求解', y: 950, size: 34, color: COL.ink2, ls: 3 },
  { from: 124.6, to: 131, text: '一根线，能牵动几个世界？', y: 130, size: 60, weight: 300, ls: 5 },
  { from: 129, to: 147.6, text: 'θ 同时驱动圆与波 —— 它们本是同一件事', y: 1016, size: 34, color: COL.ink2, ls: 3 },
  { from: 148.6, to: 152.2, text: '这，就是「关联」。', y: 420, size: 76, weight: 600, ls: 4 },
  { from: 149.4, to: 152.4, text: '实体 · 参数 · 变量 · 绑定 · 约束 —— 五个原语，组合无穷', y: 520, size: 34, color: COL.accent, ls: 2 },
];

export const ScBinding: React.FC = () => {
  const frame = useCurrentFrame();
  const b = SHOTS.S3_binding.from / FPS / BEAT_INT + frame / FPS / BEAT_INT;
  return (
    <>
      <CanvasStage beatFrom={88} draw={(g, bb) => draw(g, bb)} />
      <Captions beat={b} items={CAPS} />
    </>
  );
};
