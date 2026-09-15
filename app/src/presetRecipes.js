// 复合预设"配方"：一次生成多个实体 + 预置绑定（即"预织好的网"，供拆解学习）
// 纯模块（不碰 DOM），可在 Node 里直接单测。
import * as S from './state.js';
import { parseEquation } from './expr.js';

export const RECIPES = {
  // 圆与正弦的联动：圆上动点 P(θ) 与正弦波上点 S(θ) 用一条线连起来
  // 拖动 θ 滑杆 → P 绕圆转、S 沿波滑行、连线跟着走（欧拉公式那类演示的地基）
  circlesine(st, at) {
    const c = S.addEntity(st, 'circle', { cx: at.x - 3.2, cy: at.y, r: 2 });
    if (!st.variables.has('θ')) S.addVariable(st, 'θ', { value: 0, min: 0, max: Math.PI * 2, step: 0 });
    const ep1 = S.addEdgePoint(st, c.id, 0).point;
    S.addBinding(st, ep1.id, 't', 'θ');
    const w = S.addEntity(st, 'sine', { A: 2, lam: Math.PI * 2, phi: 0, cx: 0, cy: at.y, dmin: 0, dmax: Math.PI * 2 });
    const ep2 = S.addEdgePoint(st, w.id, 0).point;
    S.addBinding(st, ep2.id, 't', 'θ');
    const seg = S.addEntity(st, 'segment', {});
    S.addBinding(st, seg.id, 'x1', `${ep1.label}.x`);
    S.addBinding(st, seg.id, 'y1', `${ep1.label}.y`);
    S.addBinding(st, seg.id, 'x2', `${ep2.label}.x`);
    S.addBinding(st, seg.id, 'y2', `${ep2.label}.y`);
    st.selection = new Set([c.id, w.id, ep1.id, ep2.id, seg.id]);
    S.emit(st, 'selection');
    return { variable: 'θ', entities: [c.id, w.id, ep1.id, ep2.id, seg.id] };
  },

  // 抛物线的焦点与准线：全部由 a/h/k 派生，拖顶点即变（p = 1/(4a)）
  parafocus(st, at) {
    const pb = S.addEntity(st, 'parabola', { a: 0.35, h: at.x, k: at.y - 1, dmin: -1e4, dmax: 1e4 });
    const f = S.addEntity(st, 'point', { x: at.x, y: at.y });
    S.addBinding(st, f.id, 'x', `${pb.label}.h`);
    S.addBinding(st, f.id, 'y', `${pb.label}.k + 1/(4*${pb.label}.a)`);
    const dir = S.addEntity(st, 'segment', { x1: at.x - 4, y1: at.y, x2: at.x + 4, y2: at.y });
    S.addBinding(st, dir.id, 'y1', `${pb.label}.k - 1/(4*${pb.label}.a)`);
    S.addBinding(st, dir.id, 'y2', `${pb.label}.k - 1/(4*${pb.label}.a)`);
    st.selection = new Set([pb.id, f.id, dir.id]);
    S.emit(st, 'selection');
    return { entities: [pb.id, f.id, dir.id] };
  },

  // 单位圆上的角度演示：圆 + 半径（到动点）+ 动点（θ 驱动）
  unitangle(st, at) {
    const c = S.addEntity(st, 'circle', { cx: at.x, cy: at.y, r: 2 });
    if (!st.variables.has('θ')) S.addVariable(st, 'θ', { value: 0.9, min: 0, max: Math.PI * 2 });
    const ep = S.addEdgePoint(st, c.id, 0).point;
    S.addBinding(st, ep.id, 't', 'θ');
    const r = S.addEntity(st, 'segment', { x1: at.x, y1: at.y, x2: at.x + 2, y2: at.y });
    S.addBinding(st, r.id, 'x1', `${c.label}.cx`);
    S.addBinding(st, r.id, 'y1', `${c.label}.cy`);
    S.addBinding(st, r.id, 'x2', `${ep.label}.x`);
    S.addBinding(st, r.id, 'y2', `${ep.label}.y`);
    st.selection = new Set([c.id, ep.id, r.id]);
    S.emit(st, 'selection');
    return { variable: 'θ', entities: [c.id, ep.id, r.id] };
  },
};

// 简单预设里可能带表达式（例如阻尼振荡）
export function presetExtraWithExpr(preset, at, extra) {
  const out = { ...extra };
  if (preset.expr) {
    const eq = parseEquation(preset.expr);
    if (eq.kind === 'explicit') {
      out.exprSrc = preset.expr;
      out.ast = eq.ast;
    }
  }
  return out;
}
