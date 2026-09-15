// T9 · 环景音频（设计 §9）：空灵、悠长、神秘 —— **纯 WebAudio 实时合成**
//
// 方案要点（照此实现）：
//   · 三声部缓慢移动的和声垫（根音 + 纯五度 + 九度），-28dB 起步
//   · 每 20–40s 随机换和弦（6 个和弦池，避免小调刺耳），1.8s 交叉淡入淡出
//   · 每 8–20s 一个"风铃"点缀（高八度正弦 + 4s 指数衰减）
//   · 程序生成噪声脉冲做 3.2s 混响（ConvolverNode）
//   · 55Hz 正弦以 ±0.4dB 呼吸（"悠长"的底）
//   · **默认开启**（用户决定）：进入即尝试启动；被浏览器自动播放策略拦下时，
//     挂一次性手势监听，用户第一次点击/按键即启动，并在 UI 给出"点击 ♫ 开启"的提示
//   · 页面隐藏 / 关闭时 1.2s 淡出；所有声音挂在一条 masterGain 下，可 0 延迟静音
//
// 注意：**不使用任何受版权保护的音频素材**（C418 的曲子只作为听感方向），
// 全部由振荡器 + 噪声 + 卷积混响实时生成。
const CHORDS = [
  [110.00, 164.81, 246.94],   // A2 + E3 + B3
  [98.00, 146.83, 220.00],    // G2 + D3 + A3
  [130.81, 196.00, 293.66],   // C3 + G3 + D4
  [87.31, 130.81, 196.00],    // F2 + C3 + G3
  [116.54, 174.61, 261.63],   // A#2 + F3 + C4
  [103.83, 155.56, 233.08],   // G#2 + D#3 + A#3
];
const SWAP_MIN = 20, SWAP_MAX = 40;      // 换和弦间隔（秒）
const BELL_MIN = 8, BELL_MAX = 20;       // 风铃间隔（秒）
const PAD_DB = -28, BELL_DB = -34, SUB_DB = -32;
const FADE_OUT = 1.2;

const dbToGain = (db) => Math.pow(10, db / 20);

export function createAmbientAudio(opts = {}) {
  const AC = opts.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = null, master = null, padGain = null, voices = [], sub = null, reverb = null;
  let running = false, muted = false, timer = null, bellTimer = null;
  let cur = 0;
  let onStateChange = opts.onStateChange || (() => {});

  /** 程序生成的混响脉冲（3.2s 指数衰减噪声） */
  function makeImpulse(context, seconds = 3.2, decay = 2.6) {
    const rate = context.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = context.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;                       // 从 0 淡入
    reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    master.connect(dry).connect(ctx.destination);
    master.connect(reverb).connect(wet).connect(ctx.destination);

    // 三声部和声垫
    padGain = ctx.createGain();
    padGain.gain.value = dbToGain(PAD_DB);
    padGain.connect(master);
    voices = CHORDS[cur].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.32;
      osc.connect(g).connect(padGain);
      osc.start();
      return { osc, g };
    });

    // 55Hz 底音（±0.4dB 呼吸）
    sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 55;
    const subGain = ctx.createGain();
    subGain.gain.value = dbToGain(SUB_DB);
    sub.connect(subGain).connect(master);
    sub.start();
    const breathe = () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      subGain.gain.cancelScheduledValues(t);
      subGain.gain.setValueAtTime(subGain.gain.value, t);
      subGain.gain.linearRampToValueAtTime(dbToGain(SUB_DB + 0.4), t + 6);
      subGain.gain.linearRampToValueAtTime(dbToGain(SUB_DB - 0.4), t + 12);
      setTimeout(breathe, 12000);
    };
    setTimeout(breathe, 200);
    return ctx;
  }

  function swapChord() {
    if (!ctx) return;
    cur = (cur + 1 + Math.floor(Math.random() * (CHORDS.length - 1))) % CHORDS.length;
    const t = ctx.currentTime;
    voices.forEach((v, i) => {
      v.osc.frequency.cancelScheduledValues(t);
      v.osc.frequency.setValueAtTime(v.osc.frequency.value, t);
      v.osc.frequency.linearRampToValueAtTime(CHORDS[cur][i], t + 1.8);   // 1.8s 交叉
    });
    timer = setTimeout(swapChord, (SWAP_MIN + Math.random() * (SWAP_MAX - SWAP_MIN)) * 1000);
  }

  function bell() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = CHORDS[cur][2] * 2 * (Math.random() < 0.5 ? 1 : 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(dbToGain(BELL_DB), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);                   // 4s 指数衰减
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 4.1);
    bellTimer = setTimeout(bell, (BELL_MIN + Math.random() * (BELL_MAX - BELL_MIN)) * 1000);
  }

  function start() {
    if (running) return true;
    const c = ensureCtx();
    if (!c) { onStateChange({ running: false, reason: 'no-audiocontext' }); return false; }
    const go = () => {
      running = true;
      muted = false;
      c.resume().catch(() => {});
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(0.0001, c.currentTime);
      master.gain.linearRampToValueAtTime(dbToGain(-6), c.currentTime + 2.5);   // 2.5s 淡入
      timer = setTimeout(swapChord, (SWAP_MIN + Math.random() * (SWAP_MAX - SWAP_MIN)) * 1000);
      bellTimer = setTimeout(bell, 3000);
      onStateChange({ running: true });
    };
    if (c.state === 'suspended') {
      c.resume().then(go).catch(() => {
        // 被自动播放策略拦下 → 挂一次性手势监听（默认开启策略下的必要兜底）
        const once = () => {
          window.removeEventListener('pointerdown', once);
          window.removeEventListener('keydown', once);
          start();
        };
        window.addEventListener('pointerdown', once);
        window.addEventListener('keydown', once);
        onStateChange({ running: false, reason: 'needs-gesture' });
      });
      return false;
    }
    go();
    return true;
  }

  function stop(fade = FADE_OUT) {
    if (!ctx || !running) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0.0001, t + fade);
    running = false;
    clearTimeout(timer); clearTimeout(bellTimer);
    onStateChange({ running: false, reason: 'stopped' });
  }

  const api = {
    start, stop,
    toggle: () => (running ? (stop(), false) : (start(), true)),
    isRunning: () => running,
    state: () => (ctx ? ctx.state : 'none'),
    // 页面隐藏时淡出（方案 §9）
    bindVisibility: (win = window) => {
      win.addEventListener('visibilitychange', () => {
        if (win.document.hidden) {
          if (running) { api.stop(); api._wasRunning = true; }
        } else if (api._wasRunning) {
          api._wasRunning = false;
          start();
        }
      });
    },
  };
  return api;
}
