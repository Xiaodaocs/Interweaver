// 设计 tokens（对齐 docs/06-前端设计规范.md + app/brand/index.html）
export const COL = {
  paper: '#F5F5F7', ink: '#1D1D1F', ink2: '#6E6E73',
  accent: '#5E5CE6', accentL: '#817DF2',
  void: '#0B0B12', thread: '#8B86FF', star: '#B9B6FF', lit: '#F5F3FF', dim: '#3A3A4A',
  gold: '#C9A227', goldL: '#E3D68C', orange: '#FF9F0A',
  palette: ['#0A84FF', '#5E5CE6', '#30D5C8', '#30B0C7', '#64D2FF', '#FF9F0A', '#FF6482', '#98989D'],
  group: { '点与绑定': '#0A84FF', '角与旋转': '#5E5CE6', '构造与约束': '#C9A227', '微积分': '#30D5C8' } as Record<string, string>,
};

export const FONT = {
  ui: '"PingFang SC","Microsoft YaHei Light","Microsoft YaHei",-apple-system,sans-serif',
  num: '"SF Mono","Cascadia Mono",Consolas,ui-monospace,monospace',
};

// Q11 硬线：叙事字幕 ≥56px，辅助文字 ≥32px
export const TEXT = {
  hero: 76,      // 主题句
  question: 60,  // 叙事问句/字幕
  sub: 40,
  aux: 34,       // 辅助说明
  tiny: 32,      // 最小可用（辅助）
};

// 品牌缓动
export const EASE = {
  ios: [0.32, 0.72, 0, 1] as const,
  snappy: [0.62, 0, 0.32, 1] as const,
  exit: [0.7, 0, 0.84, 0] as const,
  smooth: [0.65, 0, 0.35, 1] as const,   // line-carry 横移
};
