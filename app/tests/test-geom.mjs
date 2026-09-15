// 几何 / 相机 / 实体行为测试（支撑 P1/P3/P6 验收）
import { test, eq, approx, ok } from './harness.mjs';
import { makeCamera, gridStep, gridLines, formatGridValue } from '../src/camera.js';
import { distToSegment } from '../src/util.js';
import { REGISTRY, PRESETS, createFromPreset, presetExtra, paramsOf, pointOnHost, projectOnHost, polygonName } from '../src/entities.js';

test('P1 相机投影往返一致（世界↔屏幕）', () => {
  const cam = makeCamera(1200, 800);
  cam.x = 3.7; cam.y = -2.1; cam.z = 55;
  for (const [wx, wy] of [[0, 0], [5.3, -7.8], [-12, 40]]) {
    const [sx, sy] = cam.w2s(wx, wy);
    const back = cam.s2w(sx, sy);
    approx(back.x, wx, 1e-9);
    approx(back.y, wy, 1e-9);
  }
});

test('P1 y 轴翻转：世界上方 = 屏幕上方', () => {
  const cam = makeCamera(800, 600);
  const [, syUp] = cam.w2s(0, 5);
  const [, syDown] = cam.w2s(0, -5);
  ok(syUp < syDown, 'y=5 应在 y=-5 的上方（屏幕 y 更小）');
});

test('P1 zoomAt 锚点不动', () => {
  const cam = makeCamera(800, 600);
  const anchor = cam.s2w(200, 150);
  cam.zoomAt(200, 150, 1.5);
  const after = cam.s2w(200, 150);
  approx(after.x, anchor.x, 1e-9);
  approx(after.y, anchor.y, 1e-9);
});

test('P1 缩放范围钳制 1%–5000%', () => {
  const cam = makeCamera(800, 600);
  for (let i = 0; i < 100; i++) cam.zoomAt(400, 300, 1.5);
  ok(cam.z <= 50 * 40, '不应超过 5000%');
  for (let i = 0; i < 300; i++) cam.zoomAt(400, 300, 0.5);
  ok(cam.z >= 0.05 * 40, '不应低于 1%');
});

test('P1 网格步长为 1/2/5 进制且屏幕间距合理', () => {
  for (const z of [2, 7, 13, 40, 88, 200, 640, 1500]) {
    const step = gridStep(z);
    const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
    ok([1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-9), `z=${z} 步长 ${step} 应为 1/2/5 进制`);
    const px = step * z;
    ok(px >= 40 && px <= 260, `z=${z} 屏幕间距 ${px}px 应合理`);
  }
});

test('P2 点到线段距离（命中测试基础）', () => {
  approx(distToSegment(1, 1, 0, 0, 2, 0), 1);
  approx(distToSegment(-1, 0, 0, 0, 2, 0), 1); // 端点外
  approx(distToSegment(1, 0, 0, 0, 2, 0), 0);
});

test('P3 圆的命中：边缘=调半径，圆心=移动', () => {
  const V = (k) => ({ cx: 0, cy: 0, r: 2 })[k];
  const hitEdge = REGISTRY.circle.hit(V, { x: 2, y: 0 }, 0.1);
  eq(hitEdge.part, 'r');
  const hitCenter = REGISTRY.circle.hit(V, { x: 0, y: 0 }, 0.1);
  eq(hitCenter.part, 'body');
  eq(REGISTRY.circle.hit(V, { x: 1, y: 1 }, 0.1), null);
});

test('P3 圆边缘拖拽 → 半径更新', () => {
  const patch = REGISTRY.circle.drag.r({ cx: 0, cy: 0, r: 2 }, { x: 3, y: 4 });
  approx(patch.r, 5);
});

test('P3 线段端点命中优先于本体', () => {
  const V = (k) => ({ x1: 0, y1: 0, x2: 4, y2: 0 })[k];
  const hit = REGISTRY.segment.hit(V, { x: 0.05, y: 0.05 }, 0.1);
  eq(hit.part, 'p1');
});

test('P6 正弦波参数语义：λ 是完整周期的 x 长度', () => {
  const V = (k) => ({ A: 2, lam: 4, phi: 0, cx: 0, cy: 1 })[k];
  const yAt = (x) => REGISTRY.sine.yAt(V, x);
  approx(yAt(0), 1);          // 中心线
  approx(yAt(1), 3);          // 1/4 λ 处达峰
  approx(yAt(4), yAt(0));     // 一个 λ 后回到同相位
});

test('P6 预设库齐全且可实例化（圆/单位圆已按用户要求移除；P8 扩充到 11 个）', () => {
  eq(PRESETS.length, 11);
  const keys = PRESETS.map((p) => p.key);
  ok(keys.slice(0, 5).join(',') === 'sine,cosine,parabola,triangle,square', `基础五件套在最前：${keys.slice(0, 5).join(',')}`);
  ok(!keys.includes('circle') && !keys.includes('unitcircle'), '不应再有圆/单位圆预设');
  for (const p of PRESETS) {
    const params = createFromPreset(p, { x: 1, y: 2 });
    ok(params && typeof params === 'object', `${p.key} 应能创建参数`);
  }
  const tri = createFromPreset(PRESETS.find((p) => p.key === 'triangle'), { x: 0, y: 0 });
  const triExtra = presetExtra(PRESETS.find((p) => p.key === 'triangle'), { x: 0, y: 0 });
  eq(triExtra.count, 3, '三角形预设应生成 3 个顶点');
  ok(tri.v1x !== undefined && tri.v3y !== undefined, '三角形预设应给出 v1x..v3y');
  const sq = createFromPreset(PRESETS.find((p) => p.key === 'square'), { x: 0, y: 0 });
  eq(presetExtra(PRESETS.find((p) => p.key === 'square'), { x: 0, y: 0 }).count, 4);
  ok(sq.v4x !== undefined && sq.v4y !== undefined, '正方形预设应给出 4 个顶点');
  const cos = createFromPreset(PRESETS.find((p) => p.key === 'cosine'), { x: 0, y: 0 });
  approx(cos.phi, Math.PI / 2);
});

test('修复1 网格线必须锚定在世界坐标倍数上（横竖两族都不能漂）', () => {
  const cam = makeCamera(1200, 800);
  for (const [cx, cy, z] of [[0, 0, 40], [0.37, -1.23, 40], [12.7, 5.31, 13], [-3.3, 8.8, 200]]) {
    cam.x = cx; cam.y = cy; cam.z = z;
    const { step, vlines, hlines } = gridLines(cam, 1200, 800);
    ok(vlines.length > 0 && hlines.length > 0, `视口内应有网格线 (x=${cx},y=${cy},z=${z})`);
    for (const l of vlines) approx(l.v / step, Math.round(l.v / step), 1e-9, '竖线应在 step 整数倍上');
    for (const l of hlines) approx(l.v / step, Math.round(l.v / step), 1e-9, '横线应在 step 整数倍上');
    // 坐标轴在视口内时必须恰好一条，且精确落在 0 上
    const view = { x0: cam.s2w(0, 0).x, x1: cam.s2w(1200, 0).x, y0: cam.s2w(0, 800).y, y1: cam.s2w(0, 0).y };
    const ax = vlines.filter((l) => l.axis);
    const ay = hlines.filter((l) => l.axis);
    if (view.x0 <= 0 && 0 <= view.x1) {
      eq(ax.length, 1, 'y 轴应恰好一条');
      eq(ax[0].v, 0, 'y 轴必须精确落在 x=0');
    } else eq(ax.length, 0, 'x=0 不在视口内时不应画 y 轴');
    if (view.y0 <= 0 && 0 <= view.y1) {
      eq(ay.length, 1, 'x 轴应恰好一条');
      eq(ay[0].v, 0, 'x 轴必须精确落在 y=0');
    } else eq(ay.length, 0, 'y=0 不在视口内时不应画 x 轴');
  }
});

test('修复1 平移时坐标轴平滑滑动，不会整格跳动', () => {
  const cam = makeCamera(1200, 800);
  cam.z = 40;
  const step = gridStep(40);
  const axisScreenY = [];
  // 以 1/7 步长缓慢纵向平移，采样 x 轴的屏幕位置
  for (let k = 0; k < 15; k++) {
    cam.y = (k * step) / 7;
    const { hlines } = gridLines(cam, 1200, 800);
    const axis = hlines.find((l) => l.axis);
    const [, sy] = cam.w2s(0, axis.v);
    axisScreenY.push(sy);
  }
  const deltas = axisScreenY.slice(1).map((v, i) => v - axisScreenY[i]);
  const pxPerStep = step * cam.z;
  const expected = pxPerStep / 7; // 每次平移 step/7 → 屏幕上应移动这么多像素
  for (const d of deltas) approx(d, expected, 1e-6, '坐标轴应随平移平滑等速移动');
  ok(Math.max(...deltas) - Math.min(...deltas) < 1e-6, '不应出现整格跳动');
});

test('修复1 网格刻度文字按步长取整（不出现 3.2700000000004 这类怪值）', () => {
  eq(formatGridValue(2, 2), '2');
  eq(formatGridValue(-4, 2), '-4');
  eq(formatGridValue(0.2, 0.2), '0.2');
  eq(formatGridValue(0.6000000000000001, 0.2), '0.6');
  eq(formatGridValue(-0.30000000000000004, 0.1), '-0.3');
  eq(formatGridValue(0, 5), '0');
});

test('P3 多边形派生量：面积与周长（替代原三角形专用实体）', () => {
  const env = { val: (id, k) => ({ v1x: 0, v1y: 0, v2x: 4, v2y: 0, v3x: 0, v3y: 3 })[k], ent: () => null };
  const ent = { id: 'g', type: 'polygon', count: 3, params: {} };
  const area = REGISTRY.polygon.derived.find((d) => d.k === 'area').compute(() => NaN, ent, env);
  const perim = REGISTRY.polygon.derived.find((d) => d.k === 'perim').compute(() => NaN, ent, env);
  approx(area, 6);
  approx(perim, 12); // 3-4-5
  eq(polygonName(3), '三角形');
  eq(polygonName(4), '四边形');
  eq(polygonName(7), '七边形');
  const pl = paramsOf({ type: 'polygon', count: 4 });
  eq(pl.length, 8, '四边形应暴露 8 个顶点参数');
  eq(pl[0].k, 'v1x');
  eq(pl[7].k, 'v4y');
});

test('修复3 圆自带直径：命中率提升（直径＝拖动条），半径/直径派生量正确', () => {
  const V = (k) => ({ cx: 0, cy: 0, r: 2 })[k];
  eq(REGISTRY.circle.hit(V, { x: 1, y: 0 }, 0.1).part, 'body', '直径线上可拖动');
  eq(REGISTRY.circle.hit(V, { x: 2, y: 0 }, 0.1).part, 'r', '边缘用于改半径');
  eq(REGISTRY.circle.hit(V, { x: 1.2, y: 1.2 }, 0.1), null, '圆内部仍然穿透');
  approx(REGISTRY.circle.derived.find((d) => d.k === 'd').compute(V), 4);
});

test('修复2 线上点：t 参数化与投影（线段/圆/多边形三种宿主）', () => {
  // 线段
  const seg = { id: 's', type: 'segment', params: { x1: 0, y1: 0, x2: 4, y2: 0 } };
  const envSeg = { val: (id, k) => seg.params[k], ent: () => seg };
  approx(projectOnHost(seg, envSeg, { x: 2, y: 1 }), 0.5);
  approx(projectOnHost(seg, envSeg, { x: 9, y: 0 }), 1, 1e-9, '超出端点应钳制');
  const p = pointOnHost(seg, envSeg, 0.25);
  approx(p[0], 1); approx(p[1], 0);

  // 圆：t 为弧度
  const cir = { id: 'c', type: 'circle', params: { cx: 0, cy: 0, r: 2 } };
  const envCir = { val: (id, k) => cir.params[k], ent: () => cir };
  approx(projectOnHost(cir, envCir, { x: 0, y: 5 }), Math.PI / 2);
  const q = pointOnHost(cir, envCir, 0);
  approx(q[0], 2); approx(q[1], 0);

  // 多边形：t = 边序号 + 边内比例
  const poly = { id: 'g', type: 'polygon', count: 4, params: { v1x: 0, v1y: 0, v2x: 4, v2y: 0, v3x: 4, v3y: 4, v4x: 0, v4y: 4 } };
  const envPoly = { val: (id, k) => poly.params[k], ent: () => poly };
  approx(projectOnHost(poly, envPoly, { x: 2, y: 0 }), 0.5, 1e-9, '第一条边中点 → t=0.5');
  approx(projectOnHost(poly, envPoly, { x: 4, y: 2 }), 1.5, 1e-9, '第二条边中点 → t=1.5');
  const onEdge = pointOnHost(poly, envPoly, 2.5);
  approx(onEdge[0], 2); approx(onEdge[1], 4);
});

test('修复2 圆弧几何：两点截出较短弧，弧长随角距变化', () => {
  const cir = { id: 'c', type: 'circle', params: { cx: 0, cy: 0, r: 2 } };
  const pts = { p1: { t: 0 }, p2: { t: Math.PI / 3 } };
  const env = {
    val: (id, k) => (id === 'c' ? cir.params[k] : pts[id][k]),
    ent: (id) => (id === 'c' ? cir : null),
  };
  const arc = { id: 'a', type: 'arc', host: 'c', p1: 'p1', p2: 'p2', params: {} };
  const g = REGISTRY.arc.derived;
  const sweep = g.find((d) => d.k === 'sweep').compute(() => NaN, arc, env);
  approx(sweep, Math.PI / 3, 1e-9, '60° 截出 60°');
  approx(g.find((d) => d.k === 'len').compute(() => NaN, arc, env), 2 * Math.PI / 3, 1e-9, '弧长 = r·θ');
  approx(g.find((d) => d.k === 'deg').compute(() => NaN, arc, env), 60, 1e-9);
  // 超过 180° 时取较短弧
  const arcBig = { ...arc, p2: 'p2' };
  pts.p2 = { t: Math.PI * 1.5 };
  const sweep2 = g.find((d) => d.k === 'sweep').compute(() => NaN, arcBig, env);
  ok(Math.abs(sweep2) <= Math.PI + 1e-9, `较短弧应 ≤180°，实际 ${(sweep2 * 180 / Math.PI).toFixed(1)}°`);
});

test('修复2 点与线上点的视觉参数：命中半径更大且贴线（回归"点不显眼"）', () => {
  const V = (k) => ({ x: 0, y: 0 })[k];
  ok(REGISTRY.point.hit(V, { x: 0.14, y: 0 }, 0.05) !== null, '点的命中半径应有下限，便于点选');
  const segEnt = { id: 's', type: 'segment', params: { x1: 0, y1: 0, x2: 4, y2: 0 } };
  const ent = { id: 'ep', type: 'edgepoint', host: 's', params: { t: 0.25 } };
  const env = {
    val: (id, k) => (id === 's' ? segEnt.params[k] : ent.params[k]),
    ent: () => segEnt,
  };
  const hit = REGISTRY.edgepoint.hit((k) => ent.params[k], { x: 1.01, y: 0.02 }, 0.05, ent, null, env);
  ok(hit && hit.part === 'body', '线上点应能点中（t=0.25 → 世界 (1,0)）');
});
