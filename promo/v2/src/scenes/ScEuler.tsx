// S5 欧拉之环：canvas 装置 + DOM 成就卡（slam-entrance-moves B score-slam 语法）+ 坠入深空文案。
import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';
import { CanvasStage } from '../components/CanvasStage';
import { Captions } from '../components/Captions';
import { draw } from '../gen/euler';
import { BEAT_INT, FPS, SHOTS } from '../beats';
import { COL, FONT } from '../design';
import { hashStr } from '../gen/engine';

// 成就卡砸落时刻（全片大 slam #1，实测曲区间最强 kick）
const SLAM_B = 181;
const CARD_W = 920, CARD_H = 210;

const AchCard: React.FC<{ b: number }> = ({ b }) => {
  if (b < SLAM_B - 0.81 || b > 196) return null;
  // 悬停蓄力 b180.2–180.8（2.6× 悬在镜头前，虚化半透）→ 砸落 b180.8–181（ease-in quad）→ 弹簧回 1
  const hover = interpolate(b, [SLAM_B - 0.8, SLAM_B - 0.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drop = interpolate(b, [SLAM_B - 0.2, SLAM_B], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad),
  });
  const settle = interpolate(b, [SLAM_B, SLAM_B + 0.55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6)) });
  const leave = interpolate(b, [194, 196], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const scale = b < SLAM_B
    ? 2.6 - drop * (2.6 - 0.965)
    : 0.965 + settle * 0.035;
  const blur = b < SLAM_B ? (1 - drop) * 10 : 0;
  const op = b < SLAM_B ? hover * (0.55 + drop * 0.45) : 1;
  const rot = 5 * (1 - drop) * (b < SLAM_B ? 1 : 0);
  const y = (b < SLAM_B ? -40 * (1 - drop) : 0) + leave * -420;
  const alpha = op * (1 - leave);

  // 冲击环 + 碎片（落点帧起爆）
  const boom = b - SLAM_B;
  const ringR = interpolate(Math.max(0, boom), [0, 0.55], [60, 780], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const ringO = boom >= 0 && boom < 0.9 ? 1 - boom / 0.9 : 0;
  const flashO = boom >= 0 && boom < 0.08 ? 0.55 * (1 - boom / 0.08) : 0;
  const shards = boom >= 0 && boom < 0.9
    ? Array.from({ length: 14 }, (_, i) => {
        const r = hashStr('shard' + i);
        const ang = (i / 14) * Math.PI * 2 + (r % 100) / 100;
        const dist = interpolate(boom, [0, 0.9], [80, 280 + (r % 300)], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
        const fade = 1 - boom / 0.9;
        return { ang, dist, fade, size: 7 + (r % 12), spin: (r % 90) - 45 };
      })
    : [];

  return (
    <>
      {/* 白闪（2f） */}
      {flashO > 0 && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: flashO }} />}
      {/* 冲击环 */}
      {ringO > 0 && (
        <div style={{
          position: 'absolute', left: 960 - ringR, top: 250 - ringR, width: ringR * 2, height: ringR * 2,
          borderRadius: '50%', border: '4px solid rgba(227,214,140,0.9)',
          boxShadow: '0 0 30px rgba(201,162,39,0.7), inset 0 0 30px rgba(201,162,39,0.4)',
          opacity: ringO,
        }} />
      )}
      {/* 金箔碎片 */}
      {shards.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: 960 + Math.cos(s.ang) * s.dist, top: 250 + Math.sin(s.ang) * s.dist * 0.6,
          width: s.size, height: s.size * 0.62, background: i % 3 ? COL.goldL : COL.gold,
          opacity: s.fade, transform: `rotate(${s.spin + boom * 160}deg)`,
        }} />
      ))}
      {/* 卡体 */}
      <div style={{
        position: 'absolute', left: (1920 - CARD_W) / 2, top: 120 + y,
        width: CARD_W, height: CARD_H, borderRadius: 20,
        background: 'rgba(20,20,30,0.86)',
        backdropFilter: 'blur(24px) saturate(180%)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(227,214,140,0.45)',
        opacity: alpha, transform: `scale(${scale}) rotate(${rot}deg)`, filter: blur ? `blur(${blur}px)` : undefined,
        display: 'flex', alignItems: 'center', padding: '0 48px', gap: 36,
      }}>
        {/* 交织双环徽章 */}
        <svg width={120} height={100} viewBox="0 0 120 100">
          <circle cx={46} cy={50} r={30} fill="none" stroke={COL.goldL} strokeWidth={5} strokeLinecap="round" />
          <circle cx={72} cy={50} r={30} fill="none" stroke={COL.goldL} strokeWidth={5} strokeLinecap="round"
            strokeDasharray="120 18 120 999" transform={`rotate(0 72 50)`} />
        </svg>
        <div>
          <div style={{ fontFamily: FONT.ui, fontSize: 44, fontWeight: 600, color: '#F5F3FF' }}>✦ 欧拉之环</div>
          <div style={{ fontFamily: FONT.ui, fontSize: 25, fontWeight: 300, color: 'rgba(245,243,255,0.82)', marginTop: 12, whiteSpace: 'nowrap' }}>
            圆在转动，波在生长 —— 原来它们是同一件事。
          </div>
          <div style={{
            fontFamily: FONT.ui, fontSize: 21, color: 'rgba(227,214,140,0.95)', marginTop: 14,
            opacity: interpolate(b, [SLAM_B + 1.2, SLAM_B + 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}>✦ 已织入知识网 · 第 7 颗星</div>
        </div>
      </div>
    </>
  );
};

export const ScEuler: React.FC = () => {
  const frame = useCurrentFrame();
  const b = SHOTS.S5_euler.from / FPS / BEAT_INT + frame / FPS / BEAT_INT;
  return (
    <>
      <CanvasStage beatFrom={176} draw={(g, bb, W, H) => draw(g, bb, W, H)} />
      <AchCard b={b} />
      <Captions beat={b} items={[
        { from: 195.4, to: 199.6, text: '你刚刚，发现了什么。', y: 430, size: 56, weight: 300, ls: 6, color: '#F5F3FF' },
      ]} />
    </>
  );
};
