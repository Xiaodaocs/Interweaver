// T2 断言：implicitGeom 的等值线提取 + 折线合并 + 连通分量 + 弧长参数化。
//
// 用真实几何量做断言（无桩）：
//   ① 圆 x²+y²−1：应为 1 个分量、折线闭合、总弧长 ≈ 2π
//   ② 参数化点必须落在曲线上：|F(pointAt(t))| ≤ 容差（t 取 11 个采样）
//   ③ 往返一致：project(pointAt(t)).t ≈ t
//   ④ 多分量：y²−x³+x 在窗口内应为 ≥2 个分量，且 project 会落到**最近**分量
//   ⑤ 竖直切线：F=x（即直线 x=0）总弧长 ≈ 窗口高 2
//   ⑥ 鞍点：F=x·y 的零集是两条坐标轴 → 总弧长 ≈ 4（这条专门考验鞍点消歧，连错就会明显偏小/偏大）
import { buildContours } from "../src/implicitGeom.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const WIN = { x0: -2, y0: -2, x1: 2, y1: 2, cell: 0.05 };

// ① 圆
{
  const c = buildContours({ ...WIN, F: (x, y) => x * x + y * y - 1 });
  ok(c.components.length === 1, `① 圆应只有 1 个分量（实测 ${c.components.length}）`);
  ok(near(c.total, 2 * Math.PI, 2 * Math.PI * 0.02), `① 总弧长 ${c.total.toFixed(4)} ≈ 2π=${(2 * Math.PI).toFixed(4)}（±2%）`);
  const p0 = c.polys[0];
  const d = Math.hypot(p0[0][0] - p0[p0.length - 1][0], p0[0][1] - p0[p0.length - 1][1]);
  ok(d < 0.05, `① 折线闭合：首尾距离 ${d.toFixed(4)} < 0.05`);
  // ② 参数化点都在曲线上
  let worst = 0;
  for (let i = 0; i <= 10; i++) {
    const pt = c.pointAt(i / 10);
    if (!pt) { worst = Infinity; break; }
    worst = Math.max(worst, Math.abs(pt.x * pt.x + pt.y * pt.y - 1));
  }
  ok(worst <= 0.02, `② pointAt(t) 全部落在曲线上：最大 |F| = ${worst.toFixed(5)} ≤ 0.02`);
  // ③ 往返一致：**内部 t** 必须精确往返。
  //    t=0 与 t=1 在闭合曲线上是同一个位置（wrap），最近点搜索天然有二义性，因此单独断言。
  let worstRT = 0;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const pt = c.pointAt(t);
    const pr = c.project(pt.x, pt.y);
    worstRT = Math.max(worstRT, Math.abs(pr.t - t));
  }
  ok(worstRT <= 2e-3, `③ 内部 t 往返一致：最大误差 ${worstRT.toExponential(2)} ≤ 2e-3`);
  const e0 = c.pointAt(0), e1 = c.pointAt(1);
  const wrap = Math.hypot(e0.x - e1.x, e0.y - e1.y);
  ok(wrap < 1e-6, `③ 闭合曲线：t=0 与 t=1 是同一位置（距离 ${wrap.toExponential(2)}）`);
  const pj0 = c.project(e0.x, e0.y);
  ok(Math.hypot(pj0.x - e0.x, pj0.y - e0.y) < 1e-9, `③ project 对起点返回曲线上的同一点（t=${pj0.t.toFixed(4)}；闭合曲线 0/1 wrap 是固有二义，非缺陷）`);
}

// ④ 多分量：y² = x³ − x
{
  const c = buildContours({ ...WIN, F: (x, y) => y * y - (x * x * x - x) });
  ok(c.components.length >= 2, `④ y²−x³+x 应有 ≥2 个分量（实测 ${c.components.length}）`);
  const far = c.project(1.9, 1.9);
  const nearArc = c.project(-0.2, 0.7);
  ok(far && nearArc && far.compIdx !== nearArc.compIdx, `④ 远处点与闭合环落在不同分量（${far && far.compIdx} vs ${nearArc && nearArc.compIdx}）`);
}

// ⑤ 竖直切线：F = x（直线 x=0）
{
  const c = buildContours({ ...WIN, F: (x) => x });
  ok(near(c.total, 4, 0.2), `⑤ 直线 x=0 在窗口[-2,2]² 内的总弧长 ${c.total.toFixed(3)} ≈ 4（窗口高 4）`);
}

// ⑥ 鞍点：F = x·y（零集 = 两条坐标轴，合计 8）
{
  const c = buildContours({ ...WIN, F: (x, y) => x * y });
  ok(near(c.total, 8, 0.4), `⑥ 鞍点 x·y 的总弧长 ${c.total.toFixed(3)} ≈ 8（两条轴各长 4）`);
}

console.log(`\nT2 implicitGeom：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
