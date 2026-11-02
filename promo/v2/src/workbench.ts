// 动效工作台接入清单（workbench.md §2）：时间表与 Root.tsx 同源（beats.ts 是唯一事实源）。
// 镜头=场景组件；SFX/BGM 表直接 import。字幕文案在场景内 CAPS 常量（未暴露为 props ——
// 本片字幕少且与画面深度耦合，属性面板不提供逐字编辑，镜头级时间调整不受影响）。
import { SHOTS, TOTAL_FRAMES, SFX } from './beats';
import { ScPrologue } from './scenes/ScPrologue';
import { ScBeauty } from './scenes/ScBeauty';
import { ScBinding } from './scenes/ScBinding';
import { ScCalc } from './scenes/ScCalc';
import { ScEuler } from './scenes/ScEuler';
import { ScNet } from './scenes/ScNet';
import { ScEnd } from './scenes/ScEnd';

export const WORKBENCH = {
  name: '交织者 Interweaver · 主旨宣传片 v2',
  fps: 30, width: 1920, height: 1080,
  total: TOTAL_FRAMES,
  background: '#F5F5F7',
  revision: 'v2.0',
  shots: [
    { id: 's0s1', label: '序章·图形接力（句号→点→圆→三角→单位圆）', from: SHOTS.S0_opening.from, duration: SHOTS.S1_morph.to - SHOTS.S0_opening.from, component: ScPrologue },
    { id: 's2', label: '数学之美混剪', from: SHOTS.S2_beauty.from, duration: SHOTS.S2_beauty.to - SHOTS.S2_beauty.from, component: ScBeauty },
    { id: 's3', label: '关联 Q&A（滑杆⇄圆 / θ 同驱圆波）', from: SHOTS.S3_binding.from, duration: SHOTS.S3_binding.to - SHOTS.S3_binding.from, component: ScBinding },
    { id: 's4', label: '微积分三连闪 + 2×2', from: SHOTS.S4_calc.from, duration: SHOTS.S4_calc.to - SHOTS.S4_calc.from, component: ScCalc },
    { id: 's5', label: '欧拉之环 · 成就砸落', from: SHOTS.S5_euler.from, duration: SHOTS.S5_euler.to - SHOTS.S5_euler.from, component: ScEuler },
    { id: 's6', label: '知识网终章（原来，知识是一张网）', from: SHOTS.S6_net.from, duration: SHOTS.S6_net.to - SHOTS.S6_net.from, component: ScNet },
    { id: 's7', label: '落版（一笔画 + 字版）', from: SHOTS.S7_end.from, duration: TOTAL_FRAMES - SHOTS.S7_end.from, component: ScEnd },
  ],
  sfx: SFX.map((s) => ({
    from: s.from,
    duration: s.beats ? Math.round(s.beats * 0.48387 * 30) : 60,
    src: (s.src.startsWith('fs-') ? 'audio/sfx/' : 'audio/') + s.src,
    volume: s.volume,
    label: s.note,
  })),
  bgm: [{ from: 0, duration: TOTAL_FRAMES, src: 'audio/bgm-tech-house.mp3', volume: 0.34 }],
};
