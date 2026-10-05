// 渲染器：网格 / 实体 / 选择态 / 吸附指示 / 框选 / 连接线（DOM 模块）
import { REGISTRY, jointRays, lineAngleInfo, hostYAt } from './entities.js';
import { V, getVal } from './state.js';
import { gridStep, gridLines, formatGridValue } from './camera.js';
import { fmt } from './util.js';
import { KINDS as CONSTRAINT_KINDS } from './constraints.js';
import { lineLikeOf, intersectLines, angleBetween, angleBetweenDirs, jointsNear, pickRays, quadrantsAt } from './lines.js';

// 颜色统一从主题取（T0：默认深色宇宙，浅色兼容）
import { currentTheme, entityColor } from './theme.js';
const theme = () => currentTheme();
const PAPER = () => theme().paper;
const GRID_LINE = () => theme().gridLine;
const GRID_AXIS = () => theme().gridAxis;
const ACCENT = () => theme().accent;

export function drawFrame(g, st, cam, canvas, env) {
  const { w, h } = cam.size();
  g.save();
  g.clearRect(0, 0, w, h);
  g.fillStyle = PAPER();
  g.fillRect(0, 0, w, h);

  // 星空背景已从工作台彻底移除（用户要求：只在成就页存在）。

  drawGrid(g, st, cam, w, h);

  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // ④ 参数标签：**先画**，让实体本身与它的选中环/控制点永远盖在标签之上。
  //    （以前标签画在实体之后，贴边后会把选中点的圆环盖掉一侧。）
  if (st.showParams !== false) drawParamLabels(g, st, cam);
  else st._paramLabels = 0;

  // 取值环境（含 val/ent/st）直接作为绘制上下文传给实体：
  // 线上点、多边形、圆弧等需要读其它实体的参数，因此必须是同一个对象。
  const envEnt = st.env || { val: () => NaN, ent: () => null, st };
  // ★ 坐标系垫在所有图形**之下**：它是参考网格，后建的坐标系若按插入顺序绘制就会盖在图形上面
  //   （用户报告「会挡住下面的图形」）。这里只把 coordsys 提到最前，其余保持原有插入顺序（稳定排序）。
  const drawOrder = [...st.entities.values()];
  drawOrder.sort((a2, b2) => ((a2.type === 'coordsys' ? 0 : 1) - (b2.type === 'coordsys' ? 0 : 1)));
  for (const ent of drawOrder) {
    const def = REGISTRY[ent.type];
    const selected = st.selection.has(ent.id);
    const hover = st.hover === ent.id;
    envEnt.selected = selected;
    envEnt.hover = hover;
    g.save();
    if (selected) {
      g.strokeStyle = ACCENT(); g.fillStyle = ACCENT() + '18';
      g.shadowColor = ACCENT() + '55'; g.shadowBlur = 10; g.lineWidth = 2.4;
    } else {
      g.strokeStyle = ent.color; g.fillStyle = ent.color + '14';
      g.lineWidth = hover ? 2.8 : 2;
    }
    // 弹簧态：正在被拖动但反解失败的那个参数，画面上先跟着指针走（松手弹回）
    const springKey = (st.spring && st.spring.entId === ent.id) ? st.spring.key : null;
    const Vent = springKey ? (k) => (k === springKey ? st.spring.value : getVal(st, ent, k)) : V(st, ent);
    def.draw(g, ent, Vent, cam, envEnt);
    g.restore();
  }

  if (env.toolPreview) env.toolPreview(g, cam);
  if (st.ghost) drawGhost(g, st, cam);
  if (st.constraints && st.constraints.size) drawConstraintBadges(g, st, cam);
  // ④ 交点角度悬停提示（标签已在实体之前画过，见上方）
  drawHoverAngle(g, st, cam);
  if (st.snap) drawSnap(g, cam, st.snap);
  if (st.boxSelect) drawBox(g, st.boxSelect);
  if (st.connOn || performance.now() < st.connFlashUntil) drawConnections(g, st, cam, env);

  g.restore();
}

function drawGrid(g, st, cam, w, h) {
  // ⑦ 外观设置生效：关掉网格就整块不画（刻度数字由 st.showTicks 单独控制）
  if (st.showGrid === false) return;
  const { step, vlines, hlines } = gridLines(cam, w, h);
  const labelEvery = st.showTicks !== false && step * cam.z >= 30;   // ⑦ 刻度数字开关 + 默认缩放也能看到轴数字
  const [ox, oy] = cam.w2s(0, 0);
  // 记录轴标签的屏幕坐标与文字值（供核验：深色主题下不能靠"深字浅底"的像素探针定位标签，
  // 数据才是权威 —— 与 st._labelBoxes 同一原则）
  const axisLabels = { x: [], y: [] };

  g.lineWidth = 1;
  g.font = '10px ui-monospace, monospace';

  for (const { v: x, axis } of vlines) {
    const [sx] = cam.w2s(x, 0);
    g.strokeStyle = axis ? GRID_AXIS() : GRID_LINE();
    g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, h); g.stroke();
    if (labelEvery && !axis) {
      const ty = Math.min(Math.max(oy - 4, 12), h - 6);
      g.fillStyle = theme().gridText;   // 修复：轴标签用主题文字色（此前硬编码深色 30% 透明度，在深色画布上不可见）
      g.fillText(formatGridValue(x, step), sx + 3, ty);
      axisLabels.x.push({ v: x, text: formatGridValue(x, step), sx: sx + 3, sy: ty });
    }
  }
  for (const { v: y, axis } of hlines) {
    const [, sy] = cam.w2s(0, y);
    g.strokeStyle = axis ? GRID_AXIS() : GRID_LINE();
    g.beginPath(); g.moveTo(0, sy); g.lineTo(w, sy); g.stroke();
    if (labelEvery && !axis) {
      const tx = Math.min(Math.max(ox + 4, 4), w - 30);
      g.fillStyle = theme().gridText;   // 修复：轴标签用主题文字色（此前硬编码深色 30% 透明度，在深色画布上不可见）
      g.fillText(formatGridValue(y, step), tx, sy - 3);
      axisLabels.y.push({ v: y, text: formatGridValue(y, step), sx: tx, sy: sy - 3 });
    }
  }
  st._axisLabels = axisLabels;
  // 原点
  if (ox > -10 && ox < w + 10 && oy > -10 && oy < h + 10) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(ox, oy, 3, 0, 7); g.fill();
  }
}

function drawGhost(g, st, cam) {
  const { type, params, extra } = st.ghost;
  const def = REGISTRY[type];
  const ent = { id: '__ghost', type, params, ...(extra || {}) };
  // 幽灵预览的取值环境：所有参数都从 ghost.params 里取
  const ghostEnv = { val: (id, k) => params[k], ent: () => null, st, selected: false, hover: false };
  g.save();
  g.globalAlpha = 0.45;
  g.strokeStyle = ACCENT(); g.fillStyle = ACCENT() + '14'; g.lineWidth = 2;
  def.draw(g, ent, (k) => params[k], cam, ghostEnv);
  g.restore();
}

function drawSnap(g, cam, sn) {
  const [sx, sy] = cam.w2s(sn.x, sn.y);
  g.save();
  g.strokeStyle = ACCENT(); g.lineWidth = 1.5;
  g.beginPath(); g.arc(sx, sy, 7, 0, 7); g.stroke();
  g.beginPath(); g.arc(sx, sy, 2, 0, 7); g.fillStyle = ACCENT(); g.fill();
  g.restore();
}

function drawBox(g, box) {
  g.save();
  g.fillStyle = ACCENT() + '12'; g.strokeStyle = ACCENT(); g.lineWidth = 1;
  const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1);
  g.fillRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
  g.strokeRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
  g.restore();
}

// ④ 默认在画布上显示关键参数（线段长度、圆半径、多边形面积、弧长、线上点角度…）
//    每个实体只挑一到两个最该看的量；标签**贴着几何体**放（沿法线偏出一点），
//    而不是堆在端点旁边。
function drawParamLabels(g, st, cam) {
  let drawn = 0;
  const boxes = [];            // 供核验：每个标签在屏幕上的位置
  g.save();
  g.font = '11px ui-monospace, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const envE = st.env || { val: () => NaN, ent: () => null, st };
  // 性能：1000 实体时"每个实体每帧算一遍标签几何"会把帧率打垮（实测拖到 ~10 fps）。
  // 做法（安全且简单）：两趟 + 每帧上限。
  //   第一趟只处理**选中/悬停**的实体（用户此刻真正关心的）；第二趟再按迭代顺序补足余量。
  //   几百个标签本来也没法读，所以上限同时是产品上的改进，而不是单纯的性能补丁。
  const MAX_LABELS = 80;
  const pri = [];
  const rest = [];
  for (const ent of st.entities.values()) {
    if (st.selection.has(ent.id) || st.hover === ent.id) pri.push(ent); else rest.push(ent);
  }
  const ordered = pri.concat(rest);
  for (const ent of ordered) {
    if (drawn >= MAX_LABELS) break;
    const Vf = V(st, ent);
    const items = paramLabelsOf(st, ent, Vf);
    if (!items.length) continue;
    const spot = labelSpotOf(st, ent, Vf, envE);
    if (!spot || !Number.isFinite(spot.p[0])) continue;
    const [sx, sy] = cam.w2s(spot.p[0], spot.p[1]);
    if (sx < -60 || sx > cam.size().w + 60 || sy < -30 || sy > cam.size().h + 30) continue;
    const BH = 15;                                   // 标签盒子高度
    // ★ 严格贴边：盒子**近边**离几何体只留 3px（以前是"沿法线偏 13px + 再内缩 4~6px"，
    //   看起来浮在旁边）。法线接近竖直时盒子沿切向居中 → 真正"贴"在线上。
    const nx = spot.n?.[0] || 0, ny = spot.n?.[1] || 0;
    const off = spot.inside ? 0 : (BH / 2 + 3);
    const bx = sx + nx * off;
    const by = sy - ny * off;
    let dy = -((items.length - 1) * 8);
    for (const it of items) {
      const txt = `${it.name} ${typeof it.v === 'string' ? it.v : fmt(it.v)}`;
      const w = g.measureText(txt).width;
      let left;
      if (spot.inside) left = bx - w / 2 - 4;
      else if (Math.abs(nx) < 0.5) left = bx - w / 2 - 4;      // 法线基本竖直 → 居中贴
      else left = nx < 0 ? bx - w - 3 : bx + 3;                // 法线横向 → 外侧，近边贴线
      g.fillStyle = theme().labelBg;
      g.fillRect(left, by + dy - BH / 2, w + 8, BH);
      g.fillStyle = ent.color || '#1d1d1f';
      g.fillText(txt, left + 4, by + dy);
      boxes.push({ id: ent.id, type: ent.type, name: it.name, x: left, y: by + dy - BH / 2, w: w + 8, h: BH });
      dy += 16;
      drawn++;
    }
  }
  st._paramLabels = drawn;
  st._labelBoxes = boxes;
  g.restore();
}

// 标签该贴在哪儿：{ p: 几何体上的点, n: 单位法线（朝外/朝上）, inside: 是否画在内部（面积这类） }
function labelSpotOf(st, ent, V, env) {
  const up = (n) => (n[1] < 0 ? [-n[0], -n[1]] : n);
  const unit = (v) => { const L = Math.hypot(v[0], v[1]); return L > 1e-9 ? [v[0] / L, v[1] / L] : [0, 1]; };
  try {
    switch (ent.type) {
      case 'segment': {
        const d = [V('x2') - V('x1'), V('y2') - V('y1')];
        return { p: [(V('x1') + V('x2')) / 2, (V('y1') + V('y2')) / 2], n: up(unit([-d[1], d[0]])) };
      }
      case 'circle':
        return { p: [V('cx'), V('cy') + Math.abs(V('r'))], n: [0, 1] };      // 贴在圆周上方
      case 'arcfree': {
        const mid = V('start') + V('sweep') / 2;
        return { p: [V('cx') + V('r') * Math.cos(mid), V('cy') + V('r') * Math.sin(mid)], n: up([Math.cos(mid), Math.sin(mid)]) };
      }
      case 'polygon': {
        // 面积这类量画在形状内部（重心），本来就不该贴某条边
        let cx = 0, cy = 0;
        const n0 = ent.count || 1;
        for (let i = 1; i <= n0; i++) { cx += V(`v${i}x`); cy += V(`v${i}y`); }
        return { p: [cx / n0, cy / n0], n: [0, 1], inside: true };
      }
      case 'edgepoint': {
        const host = st.entities.get(ent.host);
        let n = [0, 1];
        const L = host ? lineLikeOf(host, env) : null;
        if (L) n = up(unit([-L.d[1], L.d[0]]));
        return { p: [V('x'), V('y')], n };
      }
      // ★ 唯一来源：sine / parabola / func 三种函数曲线在这里**合并成一条**，
      //   统一用 hostYAt（世界 x → y）——它内部处理窗口偏移与 cx/cy。
      //   此前 sine/parabola 直接调实体 yAt、func 自己 evalWith + cy：
      //   两份都漏了"偏移"这一层（func 尤其漏了 cx），于是法线/锚点画在旧位置上。
      case 'sine':
      case 'parabola':
      case 'func': {
        const off = (ent.type === 'parabola') ? (V('h') || 0) : (V('cx') || 0);
        const x = (V('dmin') + V('dmax')) / 2 + off;
        const f = (xx) => hostYAt(ent, env, xx);
        const h = 1e-4;
        const m = (f(x + h) - f(x - h)) / (2 * h);
        const y = f(x);
        return Number.isFinite(y) ? { p: [x, y], n: up(unit([-m, 1])) } : null;   // 曲线法线（朝上）
      }
      case 'tangent':
      case 'secant': {
        const L = lineLikeOf(ent, env);
        if (!L) return null;
        return { p: [L.p[0] + L.d[0] / 2, L.p[1] + L.d[1] / 2], n: up(unit([-L.d[1], L.d[0]])) };
      }
      case 'joint': {
        const R = jointRays(ent, env);
        if (!R) return null;
        let b = [R.dirA[0] + R.dirB[0], R.dirA[1] + R.dirB[1]];
        const bl = Math.hypot(b[0], b[1]);
        b = bl > 1e-6 ? [b[0] / bl, b[1] / bl] : [0, 1];
        return { p: R.X, n: b, inside: true };
      }
      default: {
        const anchors = REGISTRY[ent.type].features ? REGISTRY[ent.type].features(V, ent, env) : [];
        if (anchors && anchors.length) return { p: anchors[anchors.length - 1], n: [0, 1], inside: true };
        return null;
      }
    }
  } catch { return null; }
}

function paramLabelsOf(st, ent, V) {
  const out = [];
  const num = (v) => Number.isFinite(v);
  try {
    switch (ent.type) {
      case 'segment': {
        const L = Math.hypot(V('x2') - V('x1'), V('y2') - V('y1'));
        if (num(L)) out.push({ name: '长度', v: L });
        // 角度：只有这条线上有角度实体时才显示（值＝那个角度实体的实时夹角）
        const info = lineAngleInfo(st, ent);
        if (info && Number.isFinite(info.deg)) out.push({ name: '角度', v: info.deg });
        break;
      }
      case 'circle':
        if (num(V('r'))) out.push({ name: 'r', v: V('r') });
        break;
      case 'arcfree':
        if (num(V('sweep')) && num(V('r'))) out.push({ name: '弧长', v: Math.abs(V('sweep')) * V('r') });
        break;
      case 'polygon': {
        const d = REGISTRY.polygon.derived.find((x) => x.k === 'area');
        const a = d ? d.compute(V, ent, st.env) : NaN;
        if (num(a)) out.push({ name: '面积', v: a });
        break;
      }
      case 'edgepoint': {
        const host = st.entities.get(ent.host);
        if (host && (host.type === 'circle' || host.type === 'arcfree')) out.push({ name: '角度', v: (V('t') * 180) / Math.PI });
        else if (host && (host.type === 'sine' || host.type === 'parabola' || host.type === 'func')) out.push({ name: 'x', v: V('t') });
        break;
      }
      case 'sine':
        if (num(V('A'))) out.push({ name: 'A', v: V('A') });
        break;
      case 'joint': {
        const g2 = jointGeomOf(st, ent);
        if (g2) out.push({ name: '夹角', v: `${g2.deg.toFixed(1)}°` });
        break;
      }
      default: break;
    }
  } catch { /* 算不出来就不显示 */ }
  return out.slice(0, 2);
}

function jointGeomOf(st, ent) {
  try {
    const ea = st.entities.get(ent.a), eb = st.entities.get(ent.b);
    if (!ea || !eb || !st.env) return null;
    const la = lineLikeOf(ea, st.env), lb = lineLikeOf(eb, st.env);
    const X = intersectLines(la, lb);
    if (!X) return null;
    const deg = angleBetween(la, lb, getVal(st, ent, 'sa'), getVal(st, ent, 'sb'));
    return { X, deg };
  } catch { return null; }
}

// ④ 悬停在"两线真实相交处"：**每个可用的角各摆一颗小球**（十字＝4 颗，T 字＝2 颗），
//    小球放在角**内部**的平分线方向上（不在顶点、彼此不重叠）；浅灰黄色。
//    鼠标最靠近哪颗，就高亮哪颗并显示"点击变成实体"。
function drawHoverAngle(g, st, cam) {
  const wp = st.hoverPt;
  if (!wp || st.tool === 'angle') return;
  let list = [];
  try { list = jointsNear(st, st.env, [wp.x, wp.y], 12 / cam.z); } catch { return; }
  if (!list.length) return;
  const balls = [];
  for (const pair of list) {
    let qs = [];
    try { qs = quadrantsAt(pair); } catch { qs = []; }
    for (const q of qs) {
      const d = 26 / cam.z;                        // 小球离交点 26px，落在角里面
      const wx = q.X.x + q.bisector[0] * d;
      const wy = q.X.y + q.bisector[1] * d;
      const [sx, sy] = cam.w2s(wx, wy);
      balls.push({ q, sx, sy });
    }
  }
  if (!balls.length) return;
  // 找离鼠标最近的那颗
  const [mx, my] = cam.w2s(wp.x, wp.y);
  let best = null, bestD = Infinity;
  for (const b of balls) {
    const d = Math.hypot(b.sx - mx, b.sy - my);
    if (d < bestD) { bestD = d; best = b; }
  }
  const hot = bestD < 16;
  st._angleBalls = balls.map((b) => ({ sx: b.sx, sy: b.sy, deg: b.q.deg, sa: b.q.sa, sb: b.q.sb, a: b.q.a.ent.id, b: b.q.b.ent.id, hot: b === best && hot }));
  g.save();
  for (const b of balls) {
    const isHot = hot && b === best;
    const r = isHot ? 8 : 6;
    g.beginPath();
    g.arc(b.sx, b.sy, r, 0, 7);
    g.fillStyle = isHot ? '#E3D68C' : '#EDE6B8';       // 浅灰黄
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = isHot ? '#B9A85E' : '#CFC38A';
    g.stroke();
  }
  if (hot && best) {
    const txt = `${best.q.deg.toFixed(best.q.deg < 10 ? 2 : 1)}°`;
    const tip = '点击变成实体';
    g.font = '12px ui-monospace, monospace';
    const w = Math.max(g.measureText(txt).width, g.measureText(tip).width) + 14;
    const bx = best.sx + 12, by = best.sy - 26;
    g.fillStyle = PAPER();
    g.strokeStyle = '#CFC38A';
    g.lineWidth = 1;
    g.beginPath();
    g.rect(bx, by, w, 34);
    g.fill(); g.stroke();
    g.fillStyle = '#8A7A33';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(txt, bx + 7, by + 11);
    g.fillStyle = 'rgba(60,60,67,0.75)';
    g.font = '10px -apple-system, sans-serif';
    g.fillText(tip, bx + 7, by + 25);
  }
  g.restore();
}

// 约束徽章：画在涉及对象的锚点附近，一眼看出"这里有个几何关系"
function drawConstraintBadges(g, st, cam) {
  g.save();
  g.font = '12px ui-monospace, monospace';
  for (const c of st.constraints.values()) {
    const anchors = c.refs
      .map((id) => st.entities.get(id))
      .filter(Boolean)
      .map((ent) => REGISTRY[ent.type].anchor(V(st, ent), ent, st.env || { val: () => NaN, ent: () => null, st }));
    if (!anchors.length) continue;
    const ax = anchors.reduce((s, a) => s + a[0], 0) / anchors.length;
    const ay = anchors.reduce((s, a) => s + a[1], 0) / anchors.length;
    const [sx, sy] = cam.w2s(ax, ay);
    if (sx < -40 || sx > cam.size().w + 40 || sy < -40 || sy > cam.size().h + 40) continue;
    const glyph = (CONSTRAINT_KINDS[c.kind] || {}).badge || '◆';
    const bad = (c.error || 0) > 1e-3;
    g.save();
    g.beginPath();
    g.arc(sx, sy - 16, 10, 0, 7);
    g.fillStyle = bad ? '#FF9F0Acc' : '#5E5CE6cc';
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, sx, sy - 15);
    g.restore();
  }
  g.restore();
}
// 连接视图 v1：变量卡 → 目标实体 / 源实体 → 目标实体的发光丝线
function drawConnections(g, st, cam, env) {
  const t = performance.now() / 1000;
  for (const b of st.bindings.values()) {
    const target = st.entities.get(b.target.ent);
    if (!target) continue;
    const def = REGISTRY[target.type];
    const [tx, ty] = def.anchor(V(st, target), target, st.env || { val: () => NaN, ent: () => null, st });
    const [tsx, tsy] = cam.w2s(tx, ty);

    for (const s of b.sources) {
      let srcPt = null;
      if (s.kind === 'var') {
        const anchor = env.varCardAnchor?.(s.name);
        if (anchor) srcPt = anchor;
      } else {
        const se = st.entities.get(s.ent);
        if (se) {
          const sdef = REGISTRY[se.type];
          const [ax, ay] = sdef.anchor(V(st, se), se, st.env || { val: () => NaN, ent: () => null, st });
          srcPt = cam.w2s(ax, ay);
        }
      }
      if (!srcPt) continue;
      drawThread(g, srcPt[0], srcPt[1], tsx, tsy, t);
    }
  }
}

function drawThread(g, x0, y0, x1, y1, t) {
  const dx = Math.max(60, Math.abs(x1 - x0) * 0.45);
  g.save();
  g.strokeStyle = 'rgba(94,92,230,0.5)';
  g.lineWidth = 1.5;
  g.setLineDash([3, 7]);
  g.lineDashOffset = -t * 26;
  g.beginPath();
  g.moveTo(x0, y0);
  g.bezierCurveTo(x0 + Math.sign(x1 - x0 || 1) * dx, y0, x1 - Math.sign(x1 - x0 || 1) * dx, y1, x1, y1);
  g.stroke();
  g.setLineDash([]);
  // 目标端光点
  g.fillStyle = 'rgba(94,92,230,0.85)';
  g.beginPath(); g.arc(x1, y1, 3, 0, 7); g.fill();
  g.restore();
}
