// 节拍网格（analysis/tech-house/beat_data.json 实测，勿手改）
// 曲：bgm-tech-house.mp3 · BPM=124.00 · T=0.48387s · t0=9.4552s · inliers 477/487 · 残差 p95=9.4ms
// 选段：曲目 b161–b467（开场落在 breakdown 平静段，混剪段正好压 b207 大 drop）
export const FPS = 30;
export const SOURCE_BEAT0 = 9.4552;          // 源音乐网格 t0（审计真值，永不改）
export const BEAT_INT = 0.48387;             // 源音乐拍长 T
export const TRACK_OFFSET_BEATS = 161;       // 胶片拍 0 = 曲目拍 161
// 渲后回测（music-beat-sync §5b）实测：三次快门探针一致 2.16/2.07/1.97f，平均 68.9ms
// —— 输出编码链路（AAC priming）系统性滞后，按 sound-design §4.6 统一从这里扣回。
export const OUTPUT_AUDIO_OFFSET_SEC = 0.069;

export const beatSecOfFilm = (n: number) => n * BEAT_INT;                          // 胶片拍 → 胶片秒
export const trackSecOfFilmBeat = (n: number) =>
  SOURCE_BEAT0 + (n + TRACK_OFFSET_BEATS) * BEAT_INT;                              // 胶片拍 → 曲目秒
export const beatF = (n: number) => Math.round(beatSecOfFilm(n) * FPS);            // 胶片拍 → 帧
export const secF = (s: number) => Math.round(s * FPS);

// BGM 在 <Audio> 里的起点（帧）：让胶片帧 0 对齐曲目拍 161；并提前扣掉输出音轨偏移
export const BGM_START_F = Math.round(trackSecOfFilmBeat(0) * FPS) - Math.round(OUTPUT_AUDIO_OFFSET_SEC * FPS);

// ---------------- 镜头时间轴（拍号制，唯一事实源） ----------------
export const DUR_BEATS = 300;
export const SHOTS = {
  S0_opening: { from: beatF(0), to: beatF(14) },       // 0–6.77s   句子 + 句号特写
  S1_morph:   { from: beatF(14), to: beatF(40) },      // 6.77–19.35s 句号→点→圆→三角→n→∞→单位圆
  S2_beauty:  { from: beatF(40), to: beatF(88) },      // 19.35–42.58s 数学之美混剪（硬切卡拍）
  S3_binding: { from: beatF(88), to: beatF(152) },     // 42.58–73.55s 关联 Q&A
  S4_calc:    { from: beatF(152), to: beatF(176) },    // 73.55–85.16s 微积分三连闪 + 2×2
  S5_euler:   { from: beatF(176), to: beatF(200) },    // 85.16–96.77s 欧拉之环 + 成就砸落(b181)
  S6_net:     { from: beatF(200), to: beatF(272) },    // 96.77–131.61s 知识网终章（心跳 b249）
  S7_end:     { from: beatF(272), to: beatF(300) },    // 131.61–145.16s 落版（落定 b293）
};
export const TOTAL_FRAMES = beatF(DUR_BEATS);

// 三个大 slam（全画面冲击名额，R4 ≤3）：成就砸落 / 星网心跳 / logo 落定
export const SLAMS = { achievement: 181, heartbeat: 249, logoLand: 293 };

// ---------------- SFX 钉帧表（全部从 beatF 派生） ----------------
// 音源峰值滞后（秒→拍换算在 sfxFrom 里做；实测见 public/audio/sfx/audio-manifest.json）
export const PEAK_SEC: Record<string, number> = {
  'fs-449645.mp3': 0.125,   // whoosh soft shimmer
  'fs-270435.mp3': 0.085,   // camera shutter
  'fs-748236.mp3': 0.935,   // riser-hit 078
  'fs-685256.mp2': 2.745,   // riser short（占位防呆；真名 .mp3 见下）
  'fs-685256.mp3': 2.745,   // riser short
  'fs-632478.mp3': 0.625,   // pencil writing 3 strokes
  'fs-687127.mp3': 0.275,   // drawing circles by pen
  'fs-784658.mp3': 0.035,   // heartbeat sub kick
  'fs-398493.mp3': 0.015,   // wind chimes single
  'fs-169854.mp3': 0.005,   // wind chime crunch
  'achWeave.wav': 0.008,    // 产品成就音（合成，基音起振）
};
// 目标拍 → Sequence 起点帧：峰值落在目标拍上（sound-design §4.6 公式）
export const sfxFrom = (targetBeat: number, src: string) =>
  Math.max(0, Math.round((beatSecOfFilm(targetBeat) - (PEAK_SEC[src] ?? 0) - OUTPUT_AUDIO_OFFSET_SEC) * FPS));

export interface Sfx { from: number; src: string; volume: number; beats?: number; note: string }
export const SFX: Sfx[] = [
  { from: sfxFrom(1.5, 'fs-632478.mp3'), src: 'fs-632478.mp3', volume: 0.15, note: 'S0 句子书写（铅笔）' },
  { from: sfxFrom(14, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.5, note: 'S1 句号离纸浮起' },
  { from: sfxFrom(18, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.32, note: 'S1 点两次脉冲' },
  { from: sfxFrom(22, 'fs-687127.mp3'), src: 'fs-687127.mp3', volume: 1.6, note: 'S1 点鼓成圆（画圆笔声）' },
  { from: sfxFrom(40, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.42, note: 'S2 单位圆生正弦' },
  { from: sfxFrom(56, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.36, note: 'S2 切：傅里叶' },
  { from: sfxFrom(64, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.3, note: 'S2 切：抛物线' },
  { from: sfxFrom(72, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.3, note: 'S2 切：黄金螺线' },
  { from: sfxFrom(80, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.3, note: 'S2 切：双纽线' },
  { from: sfxFrom(90, 'fs-632478.mp3'), src: 'fs-632478.mp3', volume: 0.14, note: 'S3 线头接力生长' },
  { from: sfxFrom(98, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.4, note: 'S3 丝线连上 r（连接）' },
  { from: sfxFrom(116, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.3, note: 'S3 反向拖圆起手' },
  { from: sfxFrom(125, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.4, note: 'S3 θ 丝线 1' },
  { from: sfxFrom(126, 'fs-398493.mp3'), src: 'fs-398493.mp3', volume: 0.5, beats: 2.2, note: 'S3 θ 丝线 2' },
  { from: sfxFrom(127, 'fs-169854.mp3'), src: 'fs-169854.mp3', volume: 0.26, note: 'S3 θ 丝线 3' },
  { from: sfxFrom(152, 'fs-270435.mp3'), src: 'fs-270435.mp3', volume: 0.55, note: 'S4 一闪：割线→切线' },
  { from: sfxFrom(158, 'fs-270435.mp3'), src: 'fs-270435.mp3', volume: 0.46, note: 'S4 二闪：导函数' },
  { from: sfxFrom(164, 'fs-270435.mp3'), src: 'fs-270435.mp3', volume: 0.4, note: 'S4 三闪：黎曼和' },
  { from: sfxFrom(176, 'fs-685256.mp3'), src: 'fs-685256.mp3', volume: 0.5, beats: 5.7, note: 'S5 riser 蓄力（尾峰对 b181）' },
  { from: sfxFrom(179.07, 'fs-748236.mp3'), src: 'fs-748236.mp3', volume: 0.62, note: 'S5 成就砸落（峰值对 b181）' },
  { from: sfxFrom(181.1, 'achWeave.wav'), src: 'achWeave.wav', volume: 0.5, note: 'S5 产品成就音动机' },
  { from: sfxFrom(196, 'fs-449645.mp3'), src: 'fs-449645.mp3', volume: 0.34, note: 'S5→S6 坠入深空' },
  // S6 七星点亮（音量阶梯递减 + 双样本交替）
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({
    from: sfxFrom(202 + i * 2, i % 2 ? 'fs-169854.mp3' : 'fs-398493.mp3'),
    src: i % 2 ? 'fs-169854.mp3' : 'fs-398493.mp3',
    volume: 0.4 - i * 0.035,
    beats: i % 2 ? undefined : 1.6,
    note: `S6 第 ${i + 1} 颗星点亮`,
  } as Sfx)),
  { from: sfxFrom(249, 'fs-784658.mp3'), src: 'fs-784658.mp3', volume: 0.85, note: 'S6 心跳 lub' },
  { from: sfxFrom(249.5, 'fs-784658.mp3'), src: 'fs-784658.mp3', volume: 0.55, note: 'S6 心跳 dub' },
  { from: sfxFrom(251, 'fs-398493.mp3'), src: 'fs-398493.mp3', volume: 0.5, beats: 2.4, note: 'S6 主题句' },
  { from: sfxFrom(282, 'fs-687127.mp3'), src: 'fs-687127.mp3', volume: 1.2, note: 'S7 logo 一笔画' },
  { from: sfxFrom(293, 'fs-784658.mp3'), src: 'fs-784658.mp3', volume: 0.5, note: 'S7 logo 落定' },
  { from: sfxFrom(294, 'fs-398493.mp3'), src: 'fs-398493.mp3', volume: 0.4, beats: 2.6, note: 'S7 slogan 落定' },
];
