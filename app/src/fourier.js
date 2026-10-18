// 傅里叶变换的数学核心（零依赖 ✓ 纯函数 ✓ 不在模块顶层碰 DOM ✓）
//
// 为什么自己写：项目铁律是**零依赖**（不引任何库）✓；基 2 FFT 是 Cooley–Tukey，几十行就够 ✓，
//   而且**可以逐步验证**（与朴素 DFT 对拍 ✓ 与解析值对拍 ✓）—— 比引一个库更可信 ✓。
//
// 对外契约：
//   fft(re, im, inverse)                     原地基 2 FFT（长度必须是 2 的幂 ✓ 由调用方保证）
//   ifft(re, im)                             逆变换（含 1/N 归一 ✓）
//   analyze(samples, dt, opts)               → { harmonics: [{ freq, amp, phase, k }], n, reconstructed }
//                                              对实序列做频谱分析（补零到 2 的幂 ✓ 补零长度如实返回 ✓）
//   synthesize(harmonics, x, opts)           → y = cy + Σ amp·sin(2π·freq·(x−cx) + phase)
//   rmsError(a, b)                           → 均方根误差（衡量"合成波 vs 原曲线" ✓ 数字可检验 ✓）
//   resample(xs, ys, n)                      等距重采样（原始曲线常常是不等距取样 ✗ FFT 需要等距 ✓）

/** 原地基 2 FFT（inverse=true 时做逆变换，但**不含** 1/N 归一 ✓ 由 ifft 负责 ✓）
 *  教科书级 Cooley–Tukey：位反转重排 + 蝶形 ✓ 迭代版（不用递归 ✓ 栈深固定 ✓） */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re/im 长度不一致');
  if (n === 0) return;
  if ((n & (n - 1)) !== 0) throw new Error('fft: 长度必须是 2 的幂（实际 ' + n + '）');
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // 蝶形
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** 逆变换（含 1/N 归一 ✓） */
export function ifft(re, im) {
  fft(re, im, true);
  const n = re.length;
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  return { re, im };
}

/** 等距重采样：把任意 (xs, ys) 采样点重采到 n 个等距点上（线性插值 ✓ 越界返回 NaN ✓）
 *  FFT 要求等距取样 ✓ 而曲线取样常常不等距（尤其按参数取样时）✗ 所以先统一 ✓ */
export function resample(xs, ys, n) {
  const out = new Float64Array(n);
  if (!xs.length) { out.fill(NaN); return out; }
  let x0 = xs[0], x1 = xs[xs.length - 1];
  if (!(x1 > x0)) { out.fill(NaN); return out; }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    while (j < xs.length - 2 && xs[j + 1] < x) j++;
    const xa = xs[j], xb = xs[j + 1], ya = ys[j], yb = ys[j + 1];
    if (!Number.isFinite(ya) || !Number.isFinite(yb) || !(xb > xa)) out[i] = Number.isFinite(ya) ? ya : NaN;
    else out[i] = ya + ((yb - ya) * (x - xa)) / (xb - xa);
  }
  return out;
}

/** 频谱分析（实序列）✓
 *  @param samples 实序列（等距 ✓ NaN 会被替换成 0 并计数 ✓ 不静默：返回 badPoints）
 *  @param dt      取样间隔（世界单位 ✓ = (x1−x0)/(n−1)）
 *  @returns { harmonics, n, nfreq, badPoints, mean, reconstructed }
 *    harmonics: 按幅值从大到小 ✓ 每项 { k, freq, amp, phase } ✓ k 是频点序号 ✓
 *    n: 补零后的 FFT 长度（2 的幂）✓ nfreq: 有效频点数（n/2）✓ */
export function analyze(samples, dt, opts = {}) {
  const raw = Array.from(samples);
  let badPoints = 0;
  // 去均值 ✓（否则直流分量会盖住一切 ✓ 而且我们关心的是"波"不是偏置 ✓）
  let sum = 0, cnt = 0;
  const clean = raw.map((v) => {
    if (!Number.isFinite(v)) { badPoints++; return 0; }
    sum += v; cnt++; return v;
  });
  const mean = cnt ? sum / cnt : 0;
  for (let i = 0; i < clean.length; i++) clean[i] -= mean;
  // 补零到 2 的幂
  let n = 1;
  while (n < clean.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < clean.length; i++) re[i] = clean[i];
  fft(re, im, false);
  const nfreq = n >> 1;
  const harmonics = [];
  for (let k = 1; k <= nfreq; k++) {        // k=0 是直流（已去均值 ✓ 跳过）
    // ★ 归一：一般频点用 2/n（正负频率各一半 ✓）；
    //   但 **Nyquist 频点（k = n/2）** 的正负频率是**重叠**的 ✗ → 必须用 1/n ✓
    //   （实测踩过：dt=0.05 → 采样率 20Hz → Nyquist=10Hz，我的测试信号里正好有一个 10Hz 分量，
    //     用 2/n 时幅值量成 0.644 ✗ 而不是 0.5 ✓；这条是教科书细节 ✓）
    const scale = (k === n / 2) ? 1 / n : 2 / n;
    const amp = Math.hypot(re[k], im[k]) * scale;
    if (!(amp > 0)) continue;
    // ★ 相位：DFT 的相位是**余弦基**的相位 ✓ 而我们的合成与 sine 实体都用**正弦基** ✓
    //   sin(θ+φ) = cos(θ+φ−π/2) ✓ → 反推 φ = ψ + π/2 ✓（实测踩过：不加 π/2 时纯 sin 的相位量成 −1.571 ✗）
    const psi = Math.atan2(im[k], re[k]);
    const phase = psi + Math.PI / 2;
    harmonics.push({ k, freq: 0, amp, phase });
  }
  // freq 的口径：世界坐标里"每个单位长度几个周期" ✓ = k / (n·dt) ✓（dt 是取样间隔 ✓）
  for (const h of harmonics) h.freq = h.k / (n * dt);
  harmonics.sort((a, b) => b.amp - a.amp);
  const keep = Math.max(1, Math.min(harmonics.length, opts.keep ?? 8));
  const top = harmonics.slice(0, keep);
  return { harmonics: top, all: harmonics, n, nfreq, badPoints, mean, dt };
}

/** 合成：y = cy + Σ amp·sin(2π·freq·(x−cx) + phase) ✓
 *  与 sine 实体的 yAt 口径一致 ✓（V('cy') + V('A')·sin(2π/lam·(x−cx)+φ) ✓ 其中 freq = 1/lam ✓）*/
export function synthesize(harmonics, x, opts = {}) {
  const cx = Number.isFinite(opts.cx) ? opts.cx : 0;
  const cy = Number.isFinite(opts.cy) ? opts.cy : 0;
  let y = cy;
  for (const h of harmonics) {
    if (!Number.isFinite(h.amp) || !Number.isFinite(h.freq)) continue;
    y += h.amp * Math.sin(2 * Math.PI * h.freq * (x - cx) + h.phase);
  }
  return y;
}

/** 均方根误差（衡量"合成波 vs 原曲线" ✓ 数字可检验 ✓ 不是"看着像" ✗） */
export function rmsError(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = x - y; s += d * d; c++;
  }
  return c ? Math.sqrt(s / c) : NaN;
}
