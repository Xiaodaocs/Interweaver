// 宣传片时间轴 —— 视频（film.js）与音频（audio.mjs）共享的唯一事实来源。
// 所有关键时刻都以"秒"定义在这里：改节奏只改这一个文件。
import { KNOWLEDGE } from './knowledgeData.js';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const DUR = 158;                    // 总时长（秒）→ 4740 帧
export const BPM = 90;
export const BEAT = 60 / BPM;              // 0.6667s，所有幕边界都落在拍点上

// 幕结构（秒）：
//  Act0 吐槽枯燥       0 – 16
//  Act1 数学之美混剪  16 – 52   （一线到底的蒙太奇）
//  Act2 什么是关联    52 – 104  （自问自答 + 功能演示 + 组合蒙太奇）
//  Act3 顿悟·欧拉之环 104 – 120
//  Act4 知识是一张网  120 – 148
//  Act5 落版         148 – 158
export const ACT = { t0: 0, t1: 16, t2: 52, t3: 104, t4: 120, t5: 148 };

// ---------------- Act 0 ----------------
export const A0 = {
  stamps: [2.5, 4.0, 5.5],        // 「背公式。/ 刷题。/ 考试。」砸章（软纸闷响）
  push: [8.0, 12.0],              // 推镜头，符号墙压迫感
  freeze: 12.0,                   // 一切静止
  glitch: [12.2, 14.0],           // 墙开始抖动/失谐
  sweep: [14.2, 15.4],            // 紫色正弦扫过，灰色被抹成纸白
  beautyText: 15.0,               // 「数学，本来很美。」
};

// ---------------- Act 1（段落边界 = 变奏点，全部在拍上） ----------------
export const A1 = {
  seg: [
    { id: 'compass',  t0: 16.0, t1: 20.0 },   // 圆规画圆
    { id: 'thales',   t0: 20.0, t1: 24.0 },   // 圆内接三角形 · 直角闪现
    { id: 'polygon',  t0: 24.0, t1: 28.0 },   // 边数→∞ 回归圆
    { id: 'unitsine', t0: 28.0, t1: 34.0 },   // 单位圆 → 正弦波生长
    { id: 'fourier',  t0: 34.0, t1: 39.0 },   // 谐波叠加 → 方波
    { id: 'parabola', t0: 39.0, t1: 43.0 },   // 抛物线 · 焦点
    { id: 'spiral',   t0: 43.0, t1: 47.0 },   // 黄金螺线
    { id: 'lemn',     t0: 47.0, t1: 52.0 },   // 双纽线（品牌之形）
  ],
  whooshes: [20, 24, 28, 34, 39, 43, 47],     // 每次形态衔接的风声
  captions: {
    polygon: 'n → ∞',
    lemn: '原语极少，组合无穷。',
  },
};

// ---------------- Act 2 ----------------
export const A2 = {
  q1: 52.3,                       // 「如果，圆会听滑杆的话？」
  cardIn: 52.8,                   // 变量卡滑入
  connect1: 56.6,                 // 丝线连上 r（水晶音）
  drag1: [57.6, 63.0],            // 拖滑杆 → 圆呼吸
  q2: 64.0,                       // 「反过来呢？」
  grab: [65.6, 69.2],             // 直接拖圆 → 滑杆自己动（反向求解）
  q3: 70.0,                       // 「一根线，能牵动几个世界？」
  rigBuild: [71.0, 74.0],         // 圆+波+θ 装置搭建，三条丝线依次连上
  rigChimes: [71.6, 72.6, 73.6],
  thetaPlay: [74.0, 82.0],        // θ 自动播放：圆转、波长、梭线来回
  montage: [
    { id: 'secant',   t0: 82.0, t1: 84.5, cap: '割线逼近切线 —— 极限，亲眼看见' },
    { id: 'deriv',    t0: 84.5, t1: 87.0, cap: '每一点的斜率，连成一条新曲线' },
    { id: 'integral', t0: 87.0, t1: 89.5, cap: '无限细分，便是积分' },
    { id: 'thales',   t0: 89.5, t1: 92.0, cap: '直径所对的角，永远是 90°' },
  ],
  grid: [92.0, 94.0],             // 四个画面收缩成 2×2 同播
  verdict: 96.0,                  // 「这，就是『关联』。」
  primitives: 98.5,               // 「实体 · 参数 · 变量 · 绑定 · 约束」
};

// ---------------- Act 3 ----------------
export const A3 = {
  rigBack: 104.0,                 // 回到圆波装置
  webClose: [105.5, 108.0],       // 绑定网闭合成环
  dimPulse: [108.0, 110.0],       // 全场压暗 + 实体两次发光呼吸
  ach: 110.2,                     // 成就卡弹入（app 原版 achWeave 三音 + 低音轰鸣）
  achCard: [110.2, 115.0],        // 卡片停留
  achAway: [115.0, 116.0],        // 卡片上滑收走
  fall: [116.0, 120.0],           // 纸面坠入深空，实体坍缩成星
  fallText: 117.5,                // 「你刚刚，发现了什么。」
};

// ---------------- Act 4 ----------------
export const LIT7 = ['n.point', 'n.circle', 'n.variable', 'n.binding', 'n.sine', 'n.limit', 'n.euler'];
export const A4 = {
  stars: [120.6, 121.4, 122.2, 123.0, 123.8, 124.6, 125.4],  // 七颗星依次亮起
  starsText: 124.2,               // 「每一次交织，都被记住。」
  weave0: 126.4,                  // 织网开始
  heartbeat: 140.2,               // 整网心跳一次（低音）
  netText: 142.5,                 // 「原来，知识是一张网。」
  youText: 144.6,                 // 「而你，是交织者。」
  converge: [146.0, 148.0],       // 光向内收拢
};

// 织网边调度：先"英雄路径"慢速逐条生长，再全网级联爆发。
// 返回值：[{from,to,t0,grow}]，t0 为开始时刻（秒），grow 为生长时长。
// 视频画线、音频挂铃铛都用它 —— 同一个函数，两边不可能错拍。
const HERO_PATHS = [
  ['n.circle', 'n.euler'],               // 先一条长弧跨空（直达边）
  ['n.edgepoint', 'n.unitcircle'], ['n.unitcircle', 'n.phase'],
  ['n.phase', 'w.drivenCircle'], ['w.drivenCircle', 'w.circleWave'], ['w.circleWave', 'n.euler'],
  ['n.variable', 'n.func'], ['n.func', 'n.sine'], ['n.sine', 'n.family'],
  ['n.family', 'n.rate'], ['n.rate', 'w.integralDriven'], ['w.integralDriven', 'n.euler'],
  ['n.secant', 'n.limit'], ['n.limit', 'n.accum'], ['n.tangent', 'n.rate'], ['n.probe', 'n.readout'],
];
export function edgeSchedule() {
  const deps = KNOWLEDGE.depEdges.map(([a, b]) => ({ from: a, to: b, kind: 'dep' }));
  const rels = KNOWLEDGE.relatedEdges.map(([a, b]) => ({ from: a, to: b, kind: 'rel' }));
  const heroKey = new Set(HERO_PATHS.map(([a, b]) => a + '|' + b));
  const hero = [], rest = [];
  for (const e of [...deps, ...rels]) (heroKey.has(e.from + '|' + e.to) ? hero : rest).push(e);
  // 英雄路径：按声明顺序，慢速（0.42s 间隔）
  const heroOrd = HERO_PATHS.map(([a, b]) => hero.find((e) => e.from === a && e.to === b)).filter(Boolean);
  const sched = heroOrd.map((e, i) => ({ ...e, t0: A4.weave0 + i * 0.42, grow: 0.95 }));
  const tHeroEnd = A4.weave0 + heroOrd.length * 0.42;   // ≈ 133.3
  // 级联：rest 按"起点是否已在亮集"分轮次 BFS 排序，再映射到越来越密的时间轴
  const t0Cascade = 131.0, t1Cascade = 139.7;
  const total = rest.length;
  const lit = new Set(LIT7);
  const rounds = [];
  const placed = new Set();
  let guard = 0;
  while (placed.size < rest.length && guard++ < 40) {
    const round = [];
    for (const e of rest) {
      const k = e.from + '|' + e.to;
      if (placed.has(k)) continue;
      if (lit.has(e.from) || (e.kind === 'rel' && lit.has(e.to))) {
        round.push(e); placed.add(k);
        lit.add(e.to); lit.add(e.from);
      }
    }
    if (round.length === 0) {   // 兜底：剩余的边全部进下一轮（保持连通，不放空转）
      for (const e of rest) {
        const k = e.from + '|' + e.to;
        if (!placed.has(k)) { round.push(e); placed.add(k); lit.add(e.from); lit.add(e.to); }
      }
    }
    rounds.push(round);
  }
  const flat = rounds.flat();
  return sched.concat(flat.map((e, i) => ({
    ...e,
    t0: t0Cascade + (t1Cascade - t0Cascade) * Math.pow(i / Math.max(1, total - 1), 0.8),
    grow: 0.8,
  }))).sort((a, b) => a.t0 - b.t0);
}

// ---------------- Act 5 ----------------
export const A5 = {
  fadeIn: [148.0, 149.2],         // 深空落回纸白
  logoDraw: [148.6, 151.2],       // 双纽线一笔画
  wordmark: 151.0,                // 交织者 Interweaver
  slogan: 152.2,                  // 连一根线，看见整个世界。
  sub: 153.4,                     // 一张有数学灵魂的电子草稿纸
  fadeOut: [156.4, 158.0],
};

// ---------------- 音乐和弦计划（取自 app ambientAudio 的和弦池） ----------------
// 每个元素：[开始秒, [频率...], 持续秒, 力度]
const CH = {
  A: [110.00, 164.81, 246.94],   // A2 E3 B3
  G: [98.00, 146.83, 220.00],
  C: [130.81, 196.00, 293.66],
  F: [87.31, 130.81, 196.00],
  Bb: [116.54, 174.61, 261.63],
  Gs: [103.83, 155.56, 233.08],
};
export const PAD_PLAN = [
  [16.0, CH.C, 10], [24.0, CH.G, 6], [28.0, CH.A, 8], [36.0, CH.F, 8], [44.0, CH.C, 8],
  [52.0, CH.A, 12], [64.0, CH.F, 7], [70.0, CH.C, 12], [82.0, CH.G, 10], [92.0, CH.A, 12],
  [110.2, CH.A, 6], [116.0, CH.F, 10],
  [120.0, CH.C, 8], [128.0, CH.G, 7], [134.0, CH.A, 7], [140.2, CH.C, 3.2],
  [146.0, CH.A, 6], [148.5, CH.A, 9.5],
].map(([t, ch, dur]) => ({ t, freqs: ch, dur, vel: 1 }));

export const MOTIF = {
  // 落版主题：app sfx.js 的 achSolo/achWeave 音高（产品声音 DNA）
  achWeave: [523.25, 783.99, 1046.5],
  achSolo: [1046.5, 1568.0],
};

// 铃铛音阶：A 大调五声，织网时逐边上爬
export const BELL_SCALE = [440, 493.88, 554.37, 659.25, 739.99, 880, 987.77, 1108.73, 1318.51];
