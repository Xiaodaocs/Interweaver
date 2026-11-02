// DOM 文字层：定时字幕（淡入 + 上浮），Q11 字号硬线由调用处遵守（叙事 ≥56 / 辅助 ≥32）。
import React from 'react';
import { interpolate } from 'remotion';
import { FONT } from '../design';

export interface Cap {
  from: number; to: number; text: string;
  x?: number; y?: number;                 // 省略 = 全幅居中
  size: number; weight?: number; color?: string;
  ls?: number; align?: 'left' | 'center' | 'right';
  width?: number; mono?: boolean;
}

export const Captions: React.FC<{ beat: number; items: Cap[] }> = ({ beat, items }) => (
  <>
    {items.map((c, i) => {
      if (beat < c.from || beat > c.to) return null;
      const p = interpolate(beat, [c.from, c.from + 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const out = interpolate(beat, [c.to - 0.7, c.to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const ease = 1 - Math.pow(1 - p, 3);
      return (
        <div key={i} style={{
          position: 'absolute',
          left: c.x == null ? 0 : c.x, top: c.y ?? 0,
          width: c.width ?? (c.x == null ? 1920 : undefined),
          textAlign: c.align ?? 'center',
          opacity: p * out,
          transform: `translateY(${(1 - ease) * 26}px)`,
          fontFamily: c.mono ? FONT.num : FONT.ui,
          fontSize: c.size, fontWeight: c.weight ?? 400,
          letterSpacing: c.ls ?? 0, color: c.color ?? '#1D1D1F',
          whiteSpace: 'nowrap',
        }}>{c.text}</div>
      );
    })}
  </>
);
