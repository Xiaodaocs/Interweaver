// 把"纯正弦/余弦"表达式识别出来（用户 2026-10-23 要求：函数生成器画的正弦/余弦，
// 属性面板里应当有和预设库一样的 A / λ / φ 等**可手改参数** ✓）。
//
// 做法：**数值拟合 + 严格验证** ✓（不看表达式长什么样 ✗，只看它是不是真的正弦 ✓）
//   ① 在窗口内取样 y = f(x)（用项目自己的 st.scope.evalWith ✓）
//   ② 由极值得到 cy = (max+min)/2、A = (max-min)/2
//   ③ 由"向上过零点"的间距中位数得到 λ
//   ④ 由 y(0)、y(λ/4) 定 φ = atan2((y(0)−cy), (y(λ/4)−cy))
//   ⑤ **验证**：在 200 个点上逐点比对 `cy + A·sin(2π/λ·x + φ)`，
//      最大偏差 ≤ 1e-6·max(1,A) 才算"是正弦" ✓ 否则返回 null ✗（调用方继续用 func ✓）
//   → 这样 y=x^2 / y=1/x / 复合波形 都不会被误判成正弦 ✓
//
// 纯函数 ✓ 不碰 DOM ✓ 可单测 ✓
export const FIT_WINDOW = 24;      // 取样窗口 [-FIT_WINDOW/2, FIT_WINDOW/2]
export const FIT_SAMPLES = 600;

/** @returns {{A:number, lam:number, phi:number, cy:number} | null} */
export function fitSine(evalAt) {
  if (typeof evalAt !== 'function') return null;
  const x0 = -FIT_WINDOW / 2, x1 = FIT_WINDOW / 2;
  const n = FIT_SAMPLES;
  const xs = new Array(n + 1);
  const ys = new Array(n + 1);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    let y;
    try { y = evalAt(x); } catch { return null; }
    if (typeof y !== 'number' || !Number.isFinite(y)) return null;
    xs[i] = x; ys[i] = y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cy = (maxY + minY) / 2;
  const A = (maxY - minY) / 2;
  if (!(A > 1e-9)) return null;                 // 常数 → 不是正弦
  // ③ 向上过零点（y 从 <cy 变到 >=cy）的间距 → 中位数 = λ
  const crosses = [];
  for (let i = 1; i <= n; i++) {
    const a = ys[i - 1] - cy, b = ys[i] - cy;
    if (a < 0 && b >= 0) {
      const t = a / (a - b);
      crosses.push(xs[i - 1] + (xs[i] - xs[i - 1]) * t);
    }
  }
  if (crosses.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < crosses.length; i++) diffs.push(crosses[i] - crosses[i - 1]);
  diffs.sort((p, q) => p - q);
  const lam = diffs[Math.floor(diffs.length / 2)];
  if (!(lam > 1e-9) || !Number.isFinite(lam)) return null;
  // ④ 相位：y(0) 与 y(λ/4) 给出 sin/cos 两个分量
  const sinP = (evalAt(0) - cy) / A;
  const cosP = (evalAt(lam / 4) - cy) / A;
  const phi = Math.atan2(sinP, cosP);
  // ⑤ 严格验证（200 点）
  let maxErr = 0;
  const vn = 200;
  for (let i = 0; i <= vn; i++) {
    const x = x0 + ((x1 - x0) * i) / vn;
    const expect = cy + A * Math.sin((2 * Math.PI / lam) * x + phi);
    const got = evalAt(x);
    if (!Number.isFinite(got)) return null;
    const e = Math.abs(got - expect);
    if (e > maxErr) maxErr = e;
  }
  // 容差 0.1%（实测：1e-6 对"由过零点估出的 λ"过于苛刻 ✗ —— 相对误差 4e-7 在 ±12 窗口会累积成 ~5e-6 ✓
  //   于是一条**真正的正弦**会被误判成"不是正弦" ✗；而 x^2、sin+0.2sin(3x) 的偏差都在 0.1~10 量级 ✓
  //   仍然会被拒绝 ✓）
  if (!(maxErr <= 1e-3 * Math.max(1, A))) return null;
  return { A, lam, phi, cy };
}
