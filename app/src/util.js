// 纯工具函数（无 DOM，Node 可测）
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const lerp = (a, b, t) => a + (b - a) * t;

export function fmt(v, digits = 4) {
  if (!Number.isFinite(v)) return '—';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(Object.is(r, -0) ? 0 : r);
}

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function distToPolyline(px, py, pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

// 探索色板（06 文档 §2.1，色盲安全）
export const PALETTE = ['#0A84FF', '#5E5CE6', '#30D5C8', '#30B0C7', '#FF9F0A', '#FF6482', '#64D2FF', '#98989D'];
