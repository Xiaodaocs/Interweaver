import { hostYAt } from './entities.js';
// 直线型实体的统一抽象 + 交点/夹角解析计算（纯模块，Node 可测）
// 用途：① 角度工具 ④ 交点悬停显示角度 ⑨ 双击接点绑定 ⑩ 角度驱动旋转
//
// 关键约定（本次重写）：
//   · 每条"线"都带有**实际画出来的范围** tRange（线段是 [0,1]；圆直径是 [-r,+r]；切线/割线是 ±len）
//   · 只有交点**落在两条线各自的范围之内**才算"真的相交"——延长线相交不算
//   · 角的方位由"从交点出发、沿用户点的那一侧延伸"的两条射线决定，不再出现画在背面
//   · 同一个交点上有 3 条以上线（多个角）时标记为 ambiguous：只做悬停预览，不给点击实体化

// 取一条"直线"的表示：
//   p:[x,y] 线上一点、d:[dx,dy] 方向、tRange:[t0,t1] 实际画出的参数范围、ent
export function lineLikeOf(ent, env) {
  if (!ent || !env) return null;
  const V = (k) => env.val(ent.id, k);
  try {
    switch (ent.type) {
      case 'segment': {
        const x1 = V('x1'), y1 = V('y1'), x2 = V('x2'), y2 = V('y2');
        if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
        return { p: [x1, y1], d: [x2 - x1, y2 - y1], tRange: [0, 1], ent, kind: 'segment' };
      }
      case 'circle': {
        // 圆的"自带动径"：过圆心、当前画成水平的那一条（左右各 r）
        const cx = V('cx'), cy = V('cy'), r = Math.abs(V('r'));
        if (![cx, cy, r].every(Number.isFinite)) return null;
        return { p: [cx - r, cy], d: [2 * r, 0], tRange: [0, 1], ent, kind: 'circle' };
      }
      case 'tangent': {
        const host = env.ent?.(ent.host);
        if (!host || !ent.p1) return null;
        const x0 = env.val(ent.p1, 't');
        const m = slopeAt(host, env, x0);
        const y0 = yAt(host, env, x0);
        const len = Math.max(1e-6, V('len') || 2);
        if (![x0, y0, m].every(Number.isFinite)) return null;
        // 画出来的是 [x0-len, x0+len]
        return { p: [x0 - len, y0 - m * len], d: [2 * len, 2 * len * m], tRange: [0, 1], ent, kind: 'tangent' };
      }
      case 'secant': {
        const host = env.ent?.(ent.host);
        if (!host || !ent.p1 || !ent.p2) return null;
        const x1 = env.val(ent.p1, 't'), x2 = env.val(ent.p2, 't');
        const y1 = yAt(host, env, x1), y2 = yAt(host, env, x2);
        if (![x1, y1, x2, y2].every(Number.isFinite) || Math.abs(x2 - x1) < 1e-12) return null;
        const m = (y2 - y1) / (x2 - x1);
        const xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
        const len = Math.max(1e-6, V('len') || 2);
        return { p: [xm - len, ym - m * len], d: [2 * len, 2 * len * m], tRange: [0, 1], ent, kind: 'secant' };
      }
      default: return null;
    }
  } catch { return null; }
}

// ★ 唯一来源（用户报告"移动函数本体不生效"的根因清理）：
//   这里原来把 func / sine / parabola 的映射**各抄了一遍**（func 那份还漏了横向偏移 cx），
//   切线/割线的取点因此与绘制路径不一致 —— 现在一律委托 entities.js 的 hostYAt。
function yAt(host, env, x) {
  return hostYAt(host, env, x);
}
function slopeAt(host, env, x) {
  const h = Math.max(1e-6, Math.abs(x) * 1e-6 + 1e-7);
  return (yAt(host, env, x + h) - yAt(host, env, x - h)) / (2 * h);
}

// 两条线的交点（按无限直线求交）：{ x, y, t1, t2 }；平行/退化返回 null
export function intersectLines(l1, l2) {
  if (!l1 || !l2) return null;
  const [ax, ay] = l1.p, [adx, ady] = l1.d;
  const [bx, by] = l2.p, [bdx, bdy] = l2.d;
  const den = adx * bdy - ady * bdx;
  if (Math.abs(den) < 1e-12) return null;
  if (Math.hypot(adx, ady) < 1e-12 || Math.hypot(bdx, bdy) < 1e-12) return null;
  const t1 = ((bx - ax) * bdy - (by - ay) * bdx) / den;
  const t2 = ((bx - ax) * ady - (by - ay) * adx) / den;
  return { x: ax + adx * t1, y: ay + ady * t1, t1, t2 };
}

// 交点是否落在该线"真正画出来"的范围内（延长线不算）
export function withinExtent(line, t, pad = 0.02) {
  if (!line?.tRange) return false;
  const [t0, t1] = line.tRange;
  const lo = Math.min(t0, t1) - pad, hi = Math.max(t0, t1) + pad;
  return t >= lo && t <= hi;
}

// 这条线在交点的某一侧**有没有实际画出来的部分**（射线是否可用）。
// 用途：T 字口那种"外侧 180° 的地方根本没有角"——那一侧没有线，就不该出角。
export function rayAvailable(line, tAtX, sign, minFrac = 0.06) {
  if (!line?.tRange) return false;
  const [t0, t1] = line.tRange;
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const span = hi - lo;
  const need = Math.max(span * minFrac, 1e-6);
  // t 增大 = 朝 +d 方向
  return sign >= 0 ? (hi - tAtX) >= need : (tAtX - lo) >= need;
}

// 交点在某条线上的参数
export function tOfIntersection(line, X) {
  const len2 = line.d[0] * line.d[0] + line.d[1] * line.d[1];
  if (len2 < 1e-18) return NaN;
  return ((X.x - line.p[0]) * line.d[0] + (X.y - line.p[1]) * line.d[1]) / len2;
}

// 一个点落在交点的哪个"象限"（由两条线各自取哪一侧决定）
export function sideOfPoint(line, X, pt) {
  if (!pt) return 1;
  const v = [pt[0] - X.x, pt[1] - X.y];
  return (v[0] * line.d[0] + v[1] * line.d[1]) >= 0 ? 1 : -1;
}

// 这个象限真的是"角"吗？两条射线都必须有实际画出来的线才行
export function quadrantExists(la, lb, X, sa, sb) {
  return rayAvailable(la, tOfIntersection(la, X), sa) && rayAvailable(lb, tOfIntersection(lb, X), sb);
}

// 真实相交：交点必须同时落在两条线的范围内
export function properIntersection(l1, l2, pad = 0.02) {
  const X = intersectLines(l1, l2);
  if (!X) return null;
  if (!withinExtent(l1, X.t1, pad) || !withinExtent(l2, X.t2, pad)) return null;
  return X;
}

// 从交点出发，两条线的方向（保留"哪一侧"这个信息，由 sideA/sideB 的符号决定）
export function raysAt(X, la, lb, sideA = 1, sideB = 1) {
  const da = norm([la.d[0] * (sideA >= 0 ? 1 : -1), la.d[1] * (sideA >= 0 ? 1 : -1)]);
  const db = norm([lb.d[0] * (sideB >= 0 ? 1 : -1), lb.d[1] * (sideB >= 0 ? 1 : -1)]);
  if (!da || !db) return null;
  return { a: da, b: db, origin: [X.x, X.y] };
}

// 两条射线的夹角（度，0~180）
export function angleBetweenDirs(da, db) {
  if (!da || !db) return NaN;
  let c = da[0] * db[0] + da[1] * db[1];
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

// 兼容旧签名：给两条"直线"算夹角（取较小夹角）
export function angleBetween(l1, l2, sa = 1, sb = 1) {
  if (!l1 || !l2) return NaN;
  const R = raysAt({ x: 0, y: 0 }, l1, l2, sa, sb);
  return R ? angleBetweenDirs(R.a, R.b) : NaN;
}

// 场景里所有直线型实体
export function allLineLikes(st, env) {
  const out = [];
  for (const ent of st.entities.values()) {
    if (ent.type === 'joint') continue;
    const L = lineLikeOf(ent, env);
    if (L) out.push(L);
  }
  return out;
}

// 悬停/双击用：找出"真实相交"于某点附近的线对。
// ambiguous = 同一个交点上有 ≥3 条线（会出现多个角）→ 只预览、不许实体化
// 已经建过角度实体的那一对**不再返回**——否则会一直提示"这里可以创建角实体"，
// 用户重复点下去就会堆出一摞重叠的角实体。
export function jointsNear(st, env, pt, tol) {
  const lines = allLineLikes(st, env).filter((L) => {
    const len = Math.hypot(L.d[0], L.d[1]) || 1;
    const dist = Math.abs((pt[0] - L.p[0]) * L.d[1] - (pt[1] - L.p[1]) * L.d[0]) / len;
    return dist <= tol * 2.5;
  });
  const already = new Set();
  if (st?.entities) {
    for (const e of st.entities.values()) {
      if (e.type === 'joint' && e.a && e.b) {
        already.add(`${e.a}|${e.b}`);
        already.add(`${e.b}|${e.a}`);
      }
    }
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (already.has(`${lines[i].ent.id}|${lines[j].ent.id}`)) continue;   // 已经是实体了 → 不再提示
      const X = properIntersection(lines[i], lines[j], 0.03);   // ← 延长线相交不算
      if (!X) continue;
      if (pt && Math.hypot(X.x - pt[0], X.y - pt[1]) > tol * 3) continue;
      // 鼠标所在的那一侧必须**真的有线**（T 字外侧没有角 → 不提示、也不能建）
      let allowed = [true];
      if (pt) {
        const sa = sideOfPoint(lines[i], X, pt);
        const sb = sideOfPoint(lines[j], X, pt);
        allowed = [quadrantExists(lines[i], lines[j], X, sa, sb), sa, sb];
      }
      // 数一数同一个交点上有几条线
      let through = 0;
      for (const L of lines) {
        const len = Math.hypot(L.d[0], L.d[1]) || 1;
        const d = Math.abs((X.x - L.p[0]) * L.d[1] - (X.y - L.p[1]) * L.d[0]) / len;
        const t = ((X.x - L.p[0]) * L.d[0] + (X.y - L.p[1]) * L.d[1]) / (len * len);
        if (d <= tol && withinExtent(L, t, 0.03)) through++;
      }
      if (!allowed[0]) continue;     // 鼠标指的那一侧没有线 → 那里没有角
      out.push({ a: lines[i], b: lines[j], x: X.x, y: X.y, through, ambiguous: through >= 3 });
    }
  }
  return out;
}

// 根据"用户点在哪一侧"决定取哪一个角：返回两条射线的方向
//   clickPt：用户按/松的位置（世界坐标），用来判断沿哪一侧延伸
export function pickRays(la, lb, X, clickA, clickB) {
  const sideOf = (line, pt) => {
    if (!pt) return 1;
    const v = [pt[0] - X.x, pt[1] - X.y];
    return (v[0] * line.d[0] + v[1] * line.d[1]) >= 0 ? 1 : -1;
  };
  const sa = sideOf(la, clickA);
  const sb = sideOf(lb, clickB);
  const R = raysAt(X, la, lb, sa, sb);
  return R ? { ...R, sa, sb } : null;
}

// 交点到该方向上线端的世界距离（决定"角弧能画多大"）
export function rayLength(line, tAtX, sign) {
  if (!line?.tRange) return 0;
  const [t0, t1] = line.tRange;
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const tEnd = sign >= 0 ? hi : lo;
  const t = sign >= 0 ? Math.max(tAtX, lo) : Math.min(tAtX, hi);
  const dt = Math.abs(tEnd - t);
  return dt * Math.hypot(line.d[0], line.d[1]);
}

// 一个交点上的【所有可用角】：十字是 4 个，T 字口只有 1 个。
// 每个角都带"角平分线方向"，小球就摆在那个方向上（不在顶点、彼此不重叠）。
export function quadrantsAt(pair, minFrac = 0.06) {
  const { a, b } = pair;
  const X = { x: pair.x, y: pair.y };     // 注意：jointsNear 返回的是 { x, y } 数字，不是点对象
  const out = [];
  const ta = tOfIntersection(a, X);
  const tb = tOfIntersection(b, X);
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      if (!rayAvailable(a, ta, sa, minFrac) || !rayAvailable(b, tb, sb, minFrac)) continue;
      const da = norm([a.d[0] * sa, a.d[1] * sa]);
      const db = norm([b.d[0] * sb, b.d[1] * sb]);
      if (!da || !db) continue;
      let bis = [da[0] + db[0], da[1] + db[1]];
      const bl = Math.hypot(bis[0], bis[1]);
      bis = bl > 1e-6 ? [bis[0] / bl, bis[1] / bl] : [-da[1], da[0]];
      out.push({
        a, b, X: { x: X.x, y: X.y }, sa, sb, dirA: da, dirB: db, bisector: bis,
        deg: angleBetweenDirs(da, db),
        lenA: rayLength(a, ta, sa), lenB: rayLength(b, tb, sb),
      });
    }
  }
  return out;
}

function norm(v) {
  const L = Math.hypot(v[0], v[1]);
  return L > 1e-12 ? [v[0] / L, v[1] / L] : null;
}
