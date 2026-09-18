// T0 · 主题系统（默认深色宇宙）
//
// 设计依据：docs/P15-成就页宇宙化重设计.md §1.1
//   · 默认深色；提供 深色 / 浅色 / 跟随系统 三选，持久化到 localStorage
//   · 画布也进深色：纸面 #0B0E16、网格线改为低对比冷灰、实体色走 dark 变体
//   · 所有读颜色的地方统一从这里取（render.js 的 PAPER/GRID/ACCENT 等），
//     不在各处散落 # 常量 —— 否则深色只能是"反色"，而我要的是"重新设计"。
const STORAGE_KEY = 'interweaver.theme';

export const THEMES = {
  dark: {
    id: 'dark', name: '深色（宇宙）',
    paper: '#0B0E16',            // 画布纸面
    gridLine: 'rgba(160,170,205,0.055)',   // 低对比冷灰
    gridAxis: 'rgba(190,200,230,0.16)',
    gridText: '#6B7590',
    accent: '#7C8CFF',
    gold: '#F0C35B',             // 点亮金（成就）
    goldSoft: '#FFE6A8',         // 交织/流动光点
    pending: '#8FA6FF',
    locked: '#3A4152',
    ink: '#E8ECF8',
    ink2: '#9AA3BD',
    labelBg: 'rgba(14,19,32,0.86)',
    entitySatBoost: 1.12,        // 实体色在深底上提亮 12% 饱和度
    entityLightBoost: 0.08,
  },
  light: {
    id: 'light', name: '浅色',
    paper: '#F5F5F7',
    gridLine: 'rgba(0,0,0,0.045)',
    gridAxis: 'rgba(0,0,0,0.16)',
    gridText: '#8E8E93',
    accent: '#5E5CE6',
    gold: '#C9A227',
    goldSoft: '#E3D68C',
    pending: '#5E5CE6',
    locked: '#B9B9C0',
    ink: '#1D1D1F',
    ink2: 'rgba(60,60,67,0.6)',
    labelBg: 'rgba(250,250,252,0.9)',
    entitySatBoost: 1,
    entityLightBoost: 0,
  },
};

let mode = null;    // 'dark' | 'light' | 'system'

function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.dark : THEMES.light; }
  catch { return THEMES.dark; }
}

export function currentMode() { return mode || 'dark'; }
export function currentTheme() {
  const m = currentMode();
  return m === 'system' ? systemTheme() : (THEMES[m] || THEMES.dark);
}

export function initTheme() {
  if (mode) return currentTheme();
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { saved = null; }
  mode = (saved === 'dark' || saved === 'system') ? saved : 'light';   // 默认浅色（用户要求：回到之前的浅色样式）
  apply();
  return currentTheme();
}

export function setTheme(m) {
  if (!THEMES[m] && m !== 'system') return currentTheme();
  mode = m;
  try { localStorage.setItem(STORAGE_KEY, m); } catch { /* 忽略 */ }
  apply();
  return currentTheme();
}

export function cycleTheme() {
  return setTheme(currentMode() === 'dark' ? 'light' : (currentMode() === 'light' ? 'system' : 'dark'));
}

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = currentMode() === 'system' ? systemTheme().id : currentMode();
}

// 调色板变体：在深色下提亮实体色（饱和度 +12%、明度 +8%）
export function entityColor(hex, theme = currentTheme()) {
  if (!theme || theme.id !== 'dark' || !hex || !hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return hex;
  const d = mx - mn;
  const s = l < 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  const ns = Math.min(1, s * theme.entitySatBoost);
  const nl = Math.min(1, l + theme.entityLightBoost);
  return hslToHex(hueOf(r, g, b), ns, nl);
}

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  if (mx === r) return (60 * ((g - b) / d) + 360) % 360;
  if (mx === g) return 60 * ((b - r) / d) + 120;
  return 60 * ((r - g) / d) + 240;
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
