// 音频总线：BGM（bgm prop 可关）+ 中央 SFX 钉帧表（全部 beatF 派生，beats.ts 是唯一事实源）。
import React from 'react';
import { Audio, Sequence, staticFile, interpolate, useCurrentFrame } from 'remotion';
import { SFX, BGM_START_F, TOTAL_FRAMES, BEAT_INT, FPS } from './beats';

export const FilmAudio: React.FC<{ bgm: boolean }> = ({ bgm }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {bgm && (
        <Audio
          src={staticFile('audio/bgm-tech-house.mp3')}
          startFrom={BGM_START_F}
          endAt={BGM_START_F + TOTAL_FRAMES}
          volume={(f) =>
            0.34 *
            interpolate(f, [0, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
            interpolate(f, [TOTAL_FRAMES - 70, TOTAL_FRAMES - 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          }
        />
      )}
      {SFX.map((s, i) => (
        <Sequence
          key={i}
          from={s.from}
          durationInFrames={s.beats ? Math.round(s.beats * BEAT_INT * FPS) : undefined}
        >
          <Audio src={staticFile(s.src.startsWith('fs-') ? 'audio/sfx/' + s.src : 'audio/' + s.src)} volume={s.volume} />
        </Sequence>
      ))}
    </>
  );
};
