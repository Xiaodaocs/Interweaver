// 确定性画布逐帧渲染壳：draw(g, beat) 是纯函数；delayRender 保证画完再截帧。
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useCurrentFrame, delayRender, continueRender } from 'remotion';
import { BEAT_INT, FPS } from '../beats';

export const CanvasStage: React.FC<{
  draw: (g: CanvasRenderingContext2D, beat: number, W: number, H: number) => void;
  beatFrom: number;    // 本场景起始拍（胶片拍号）
}> = ({ draw, beatFrom }) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('canvas-draw'));
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const beat = beatFrom + frame / FPS / BEAT_INT;
    draw(g, beat, 1920, 1080);
    continueRender(handle);
  });
  return <canvas ref={ref} width={1920} height={1080} style={{ position: 'absolute', inset: 0 }} />;
};
