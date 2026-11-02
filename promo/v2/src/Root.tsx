import React from 'react';
import { Composition, Sequence, AbsoluteFill, useCurrentFrame } from 'remotion';
import { SHOTS, TOTAL_FRAMES, FPS, BEAT_INT } from './beats';
import { ScPrologue } from './scenes/ScPrologue';
import { ScBeauty } from './scenes/ScBeauty';
import { ScBinding } from './scenes/ScBinding';
import { ScCalc } from './scenes/ScCalc';
import { ScEuler } from './scenes/ScEuler';
import { ScNet } from './scenes/ScNet';
import { ScEnd } from './scenes/ScEnd';
import { CornerLogo } from './components/CornerLogo';
import { FilmAudio } from './audio';

const Main: React.FC<{ bgm: boolean }> = ({ bgm }) => {
  const frame = useCurrentFrame();
  const beat = frame / FPS / BEAT_INT;
  return (
    <AbsoluteFill style={{ background: '#F5F5F7' }}>
      <Sequence from={SHOTS.S0_opening.from} durationInFrames={SHOTS.S1_morph.to}><ScPrologue /></Sequence>
      <Sequence from={SHOTS.S2_beauty.from} durationInFrames={SHOTS.S2_beauty.to - SHOTS.S2_beauty.from}><ScBeauty /></Sequence>
      <Sequence from={SHOTS.S3_binding.from} durationInFrames={SHOTS.S3_binding.to - SHOTS.S3_binding.from}><ScBinding /></Sequence>
      <Sequence from={SHOTS.S4_calc.from} durationInFrames={SHOTS.S4_calc.to - SHOTS.S4_calc.from}><ScCalc /></Sequence>
      <Sequence from={SHOTS.S5_euler.from} durationInFrames={SHOTS.S5_euler.to - SHOTS.S5_euler.from}><ScEuler /></Sequence>
      <Sequence from={SHOTS.S6_net.from} durationInFrames={SHOTS.S6_net.to - SHOTS.S6_net.from}><ScNet /></Sequence>
      <Sequence from={SHOTS.S7_end.from} durationInFrames={TOTAL_FRAMES - SHOTS.S7_end.from}><ScEnd /></Sequence>
      <CornerLogo beat={beat} />
      <FilmAudio bgm={bgm} />
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="InterweaverPromo"
    component={Main}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ bgm: true }}
  />
);
