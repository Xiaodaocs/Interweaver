// T1 · 星空背景（设计 §1.4）
//
// 规格（照方案实现，不自行发挥）：
//   · 三层视差星场：远 800 颗 0.6px 极暗 / 中 300 颗 1px / 近 60 颗 1.4px 带十字光晕
//   · 微闪烁：每颗星**独立相位与频率**（0.08–0.35Hz），亮度表 + 相位预计算
//   · 缓慢漂移：整体 60s 横移一个屏幕宽度的 3%
//   · 星云：两张极低对比径向渐变（深蓝/紫）在最底层
//   · 性能：**按透明度分桶**批量绘制（每帧只切换十几次 fillStyle，而不是每颗星一次），
//     目标 1000 颗 <0.4ms/帧 —— 分桶是关键，逐颗设 fillStyle 会直接吃掉预算。
const LAYERS = [
  { n: 800, size: 0.6, minA: 0.06, maxA: 0.18, parallax: 0.06, drift: 0.006, cross: false },
  { n: 300, size: 1.0, minA: 0.10, maxA: 0.32, parallax: 0.14, drift: 0.014, cross: false },
  { n: 60, size: 1.4, minA: 0.26, maxA: 0.58, parallax: 0.26, drift: 0.026, cross: true },
];
const BUCKETS = 12;          // 透明度分桶数：每帧 12 次 fillStyle（而不是 n 次）
const FIELD = 2400;          // 星场虚拟范围（世界单位），循环平铺
const DRIFT_PER_SEC = 0.03 / 60;   // 60s 漂移一个屏幕宽度的 3%

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成星场（确定性：同一 seed 每次打开位置一致，可复现、可测试） */
export function buildStarfield(seed = 20260914) {
  const rnd = mulberry32(seed);
  const layers = LAYERS.map((L) => {
    const stars = [];
    for (let i = 0; i < L.n; i++) {
      stars.push({
        x: rnd() * FIELD,
        y: rnd() * FIELD,
        phase: rnd() * Math.PI * 2,
        freq: 0.08 + rnd() * (0.35 - 0.08),     // 0.08–0.35Hz（规格区间）
        a: L.minA + rnd() * (L.maxA - L.minA),
      });
    }
    return { ...L, stars };
  });
  return { seed, layers, field: FIELD };
}

const STAR_COLOR = { dark: '255,255,255', light: '40,44,70' };

/**
 * 绘制星场。t 为秒；cam 用于视差；themeId 决定星色（深色用白、浅色用极淡蓝灰）。
 * 返回本次绘制的星点数（供核验）。
 */
export function drawStarfield(g, cam, w, h, t, themeId = 'dark', field = null) {
  const sf = field || buildStarfield();
  const rgb = STAR_COLOR[themeId] || STAR_COLOR.dark;
  const [ox, oy] = cam.w2s(0, 0);
  const driftPx = (t * DRIFT_PER_SEC) * w;      // 60s 漂移 3% 屏宽
  let drawn = 0;

  // 星云：两张极低对比径向渐变（深蓝 / 紫），视差最慢
  const nebula = [
    { x: ox + w * 0.22, y: oy + h * 0.30, r: Math.max(w, h) * 0.55, c: '60,90,190' },
    { x: ox + w * 0.78, y: oy + h * 0.72, r: Math.max(w, h) * 0.45, c: '120,70,190' },
  ];
  for (const nb of nebula) {
    const grad = g.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
    grad.addColorStop(0, `rgba(${nb.c},${themeId === 'dark' ? 0.055 : 0.035})`);
    grad.addColorStop(1, `rgba(${nb.c},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  // 分层绘制：每层按透明度分桶，桶内一次 fillStyle 批量画完
  for (let li = 0; li < sf.layers.length; li++) {
    const L = sf.layers[li];
    const buckets = Array.from({ length: BUCKETS }, () => []);
    const px = (L.x || 0); void px;
    for (const s of L.stars) {
      // 视差 + 漂移：把星点位置投影到屏幕并环绕平铺
      const sx = ((s.x - ox * L.parallax * 0.02 + driftPx * L.drift * 40) % FIELD + FIELD) % FIELD;
      const sy = ((s.y - oy * L.parallax * 0.02) % FIELD + FIELD) % FIELD;
      const X = sx / FIELD * w;
      const Y = sy / FIELD * h;
      if (X < -2 || X > w + 2 || Y < -2 || Y > h + 2) continue;
      // 微闪烁：亮度 = 基值 × (1 + 0.25·sin(2π f t + φ)) —— 幅度 25%，上限不超过 1
      const tw = 1 + 0.25 * Math.sin(2 * Math.PI * s.freq * t + s.phase);
      const alpha = Math.max(0.02, Math.min(1, s.a * tw));
      const bi = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS));
      buckets[bi].push([X, Y]);
      drawn++;
    }
    for (let bi = 0; bi < BUCKETS; bi++) {
      const list = buckets[bi];
      if (!list.length) continue;
      const alpha = (bi + 0.5) / BUCKETS;
      g.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      const r = L.size / 2;
      for (const [X, Y] of list) {
        if (L.cross) {
          g.fillRect(X - r, Y - r, L.size, L.size);
          // 十字光晕（仅最近一层，60 颗，代价可控）
          g.fillRect(X - r * 3, Y - 0.35, L.size * 3, 0.7);
          g.fillRect(X - 0.35, Y - r * 3, 0.7, L.size * 3);
        } else {
          g.fillRect(X - r, Y - r, L.size, L.size);
        }
      }
    }
  }
  return drawn;
}

/** 供核验：某时刻某层的平均闪烁幅度（理论应为 25% 的基值） */
export function twinkleAmplitude(field, layerIndex, t) {
  const L = field.layers[layerIndex];
  let mn = Infinity, mx = -Infinity;
  for (const s of L.stars) {
    const v = 1 + 0.25 * Math.sin(2 * Math.PI * s.freq * t + s.phase);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
}
