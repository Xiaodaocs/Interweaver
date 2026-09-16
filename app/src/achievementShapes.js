// T4 · 成就形状与手绘图标（设计 §4）
//
// 三档（按难度层）：
//   I  火种 L0–L1 → **圆形** Ø46，外环 0 层，点亮脉冲 1 次
//   II 结构 L2–L3 → **圆角方形** 52（圆角 12），外环 1 层，脉冲 2 次
//   III 交织 L4–L6 → **徽标形（六边形）** 58 + 外环 2 层，脉冲 3 次
// 图标：**全部手写 SVG path**（24×24 viewBox），不使用任何图片素材。
export const TIERS = {
  1: { id: 1, name: '火种', shape: 'circle', size: 46, rings: 0, pulses: 1 },
  2: { id: 2, name: '结构', shape: 'square', size: 52, rings: 1, pulses: 2 },
  3: { id: 3, name: '交织', shape: 'hex', size: 58, rings: 2, pulses: 3 },
};

export function tierOf(layer) {
  const L = Number(layer) || 0;
  return L <= 1 ? 1 : (L <= 3 ? 2 : 3);
}

// 手绘图标（24×24）：每条都是我自己写的路径，尽量"能用眼睛看懂是什么"
const ICONS = {
  point: '<circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="7.2" fill="none" stroke-width="1.1" opacity=".55"/>',
  line: '<path d="M4 19 L20 5" fill="none" stroke-width="1.8"/><circle cx="4" cy="19" r="1.7"/><circle cx="20" cy="5" r="1.7"/>',
  circle: '<circle cx="12" cy="12" r="8" fill="none" stroke-width="1.8"/><circle cx="12" cy="12" r="1.6"/>',
  variable: '<path d="M3 12 H21" fill="none" stroke-width="1.4" opacity=".6"/><circle cx="9" cy="12" r="3"/>',
  angle: '<path d="M4 20 L20 20 M4 20 L17 6" fill="none" stroke-width="1.8"/><path d="M11 20 A7 7 0 0 0 9.2 15.4" fill="none" stroke-width="1.3"/>',
  constraint: '<rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke-width="1.6"/><path d="M8 11 H16 M8 14 H16" fill="none" stroke-width="1.6"/>',
  similar: '<path d="M5 18 L11 6 L17 18 Z" fill="none" stroke-width="1.6"/><path d="M8 21 L14 9 L20 21 Z" fill="none" stroke-width="1.1" opacity=".6"/>',
  weave: '<circle cx="9.5" cy="12" r="6" fill="none" stroke-width="1.8"/><circle cx="14.5" cy="12" r="6" fill="none" stroke-width="1.8" opacity=".75"/>',
  limit: '<path d="M3 5 L21 11 M3 19 L21 13" fill="none" stroke-width="1.6"/><path d="M17 12 H21" fill="none" stroke-width="2.4"/>',
  calculus: '<path d="M14 4 C9 8 15 16 10 20" fill="none" stroke-width="1.8"/><path d="M16 15 L21 15" fill="none" stroke-width="2.2"/>',
  chord: '<circle cx="12" cy="12" r="8" fill="none" stroke-width="1.6"/><path d="M6.4 16.4 L17.6 7.6" fill="none" stroke-width="1.8"/>',
  polygon: '<path d="M12 4 L20 18 H4 Z" fill="none" stroke-width="1.7"/>',
  func: '<path d="M3 18 C7 18 8 6 12 6 C16 6 17 18 21 18" fill="none" stroke-width="1.7"/>',
  tangent: '<path d="M3 17 C8 17 10 7 14 7" fill="none" stroke-width="1.4" opacity=".6"/><path d="M6 20 L20 6" fill="none" stroke-width="1.8"/>',
};

/** 成就 → 图标名（按语义族归类，不依赖 id 全表） */
export function iconNameFor(id = '', cls = 'solo') {
  if (id.startsWith('weave.')) {
    if (id.includes('euler') || id.includes('circle.wave')) return 'weave';
    if (id.includes('limit') || id.includes('secant')) return 'limit';
    if (id.includes('calculus') || id.includes('integral')) return 'calculus';
    if (id.includes('thales') || id.includes('diameter')) return 'angle';
    if (id.includes('parallelogram') || id.includes('constrained')) return 'polygon';
    return 'weave';
  }
  if (id.includes('point')) return 'point';
  if (id.includes('chord') || id.includes('diameter')) return 'chord';
  if (id.includes('circle') || id.includes('arc')) return 'circle';
  if (id.includes('var')) return 'variable';
  if (id.includes('angle')) return 'angle';
  if (id.includes('constraint')) return 'constraint';
  if (id.includes('equal') || id.includes('golden')) return 'line';
  if (id.includes('collinear') || id.includes('quad') || id.includes('polygon') || id.includes('triangle')) return 'polygon';
  if (id.includes('similar')) return 'similar';
  if (id.includes('tangent')) return 'tangent';
  if (id.includes('func') || id.includes('sine') || id.includes('parabola')) return 'func';
  if (id.includes('integral') || id.includes('derivcurve')) return 'calculus';
  if (id.includes('probe')) return 'limit';
  void cls;
  return 'line';
}

/** 形状几何（供渲染与核验共用同一份几何） */
export function shapeGeometry(tier, cx, cy) {
  const T = TIERS[tier] || TIERS[1];
  const r = T.size / 2;
  if (T.shape === 'circle') return { kind: 'circle', cx, cy, r, points: null };
  if (T.shape === 'square') return { kind: 'square', cx, cy, r, side: T.size, radius: 12 };
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { kind: 'hex', cx, cy, r, points: pts };
}

/** 生成一枚徽章的 SVG（供星图/详情卡渲染；lit=false 时用未点亮配色） */
export function renderBadge({ id, layer, cls, lit }) {
  const tier = tierOf(layer);
  const T = TIERS[tier];
  const g = shapeGeometry(tier, 28, 28);
  const gold = lit ? '#F0C35B' : '#3A4152';
  const soft = lit ? '#FFE6A8' : '#2A2E3A';
  const rings = [];
  for (let i = 0; i < T.rings; i++) {
    rings.push(`<circle class="smRing" cx="28" cy="28" r="${g.r + 4 + i * 4}" fill="none" stroke="${i === 0 ? soft : gold}"
      stroke-width="${1.6 - i * 0.4}" opacity="${0.85 - i * 0.25}"/>`);
  }
  const body = g.kind === 'circle'
    ? `<circle cx="28" cy="28" r="${g.r}" fill="${lit ? '#2A220E' : '#141926'}" stroke="${gold}" stroke-width="2.2"/>`
    : g.kind === 'square'
      ? `<rect x="${28 - g.r}" y="${28 - g.r}" width="${g.side}" height="${g.side}" rx="${g.radius}"
           fill="${lit ? '#2A220E' : '#141926'}" stroke="${gold}" stroke-width="2.2"/>`
      : `<polygon points="${g.points.map((p) => p.join(',')).join(' ')}" fill="${lit ? '#2A220E' : '#141926'}"
           stroke="${gold}" stroke-width="2.2"/>`;
  return `<svg viewBox="0 0 56 56" width="${T.size + 8}" height="${T.size + 8}" class="achShape t${tier}">
    ${rings.join('')}${body}
    <g transform="translate(16,16) scale(0.5)" fill="${lit ? '#FFE6A8' : '#5A6377'}" stroke="${lit ? '#FFE6A8' : '#5A6377'}">
      ${ICONS[iconNameFor(id, cls)] || ICONS.line}
    </g>
  </svg>`;
}

export const iconNames = Object.keys(ICONS);
