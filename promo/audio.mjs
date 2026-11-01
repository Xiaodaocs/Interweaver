// 宣传片音频：纯代码合成的配乐 + 音效 → out/audio.wav（48kHz 立体声 16bit PCM）。
// 设计对齐产品自身的声音 DNA：
//   · 和声垫和弦池取自 app/src/ambientAudio.js 的 CHORDS（根音+纯五度+九度）
//   · 成就音 = app/src/sfx.js 的 achWeave 三音（523.25 / 783.99 / 1046.5 Hz）
//   · 零素材、零采样，全部振荡器 + 噪声 + 程序混响
// 与画面同步的唯一事实来源：promo/film/timeline.mjs（与视频共享）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUR, BPM, BEAT, A0, A1, A2, A3, A4, A5, PAD_PLAN, MOTIF, BELL_SCALE, edgeSchedule } from './film/timeline.mjs';

const SR = 48000;
const NS = Math.round((DUR + 0.6) * SR);
const L = new Float32Array(NS), R = new Float32Array(NS);
const sendL = new Float32Array(NS), sendR = new Float32Array(NS);   // 混响发送总线

// ---------------- 基础 ----------------
function add(t, dur, fn, pan = 0, send = 0.25) {
  const s0 = Math.max(0, Math.floor(t * SR));
  const s1 = Math.min(NS, Math.ceil((t + dur) * SR));
  if (s1 <= s0) return;
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s0; i < s1; i++) {
    const v = fn((i - s0) / SR, i);
    L[i] += v * gl; R[i] += v * gr;
    if (send > 0) { sendL[i] += v * send * gl; sendR[i] += v * send * gr; }
  }
}
const sr2 = (s) => { let x = s >>> 0; return () => { x = (x + 0x6D2B79F5) >>> 0; let z = Math.imul(x ^ (x >>> 15), 1 | x); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; }; };
const rnd = sr2(13579);

// 简易混响：每声道 4 梳状 + 2 全通（Freeverb 拓扑，房间感 2.2s）
function reverb(inp, out) {
  const combT = [[1116, 0.72], [1188, 0.70], [1277, 0.68], [1356, 0.66]];
  const apT = [[556, 0.5], [441, 0.5]];
  for (let ch = 0; ch < 2; ch++) {
    const src = ch ? sendR : sendL, dst = ch ? R : L;
    const wet = new Float32Array(NS);
    for (const [len, fb] of combT) {
      const dly = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < NS; i++) {
        const v = dly[idx];
        dly[idx] = src[i] + v * fb;
        wet[i] += v * 0.24;
        idx = (idx + 1) % len;
      }
    }
    for (const [len, g] of apT) {
      const dly = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < NS; i++) {
        const dv = dly[idx];
        const v = -wet[i] + dv;
        dly[idx] = wet[i] + dv * g;
        wet[i] = v;
        idx = (idx + 1) % len;
      }
    }
    for (let i = 0; i < NS; i++) dst[i] += wet[i] * 0.32;
  }
}

// ---------------- 乐器 ----------------
function pluck(t, f, vel = 0.3, dur = 0.7, pan = (rnd() - 0.5) * 0.7) {
  add(t, dur, (x) => {
    const env = Math.exp(-x * 6.5) * Math.min(1, x / 0.004);
    return (Math.sin(2 * Math.PI * f * x) * 0.62 + Math.sin(2 * Math.PI * f * 2 * x) * 0.28 + Math.sin(2 * Math.PI * f * 3.01 * x) * 0.1) * env * vel;
  }, pan, 0.3);
}
function pad(t, freqs, dur, vel = 0.16) {
  for (const [i, f] of freqs.entries()) {
    const ph = rnd() * 7;
    add(t, dur + 2.2, (x) => {
      const a = Math.min(1, x / 1.6), r = Math.min(1, Math.max(0, (dur + 2.2 - x) / 2.2));
      const vib = 1 + 0.0012 * Math.sin(2 * Math.PI * 4.7 * x + ph);
      const w = i === 0
        ? Math.sin(2 * Math.PI * f * vib * x) * 0.7 + Math.sin(2 * Math.PI * f * 2 * vib * x) * 0.12
        : Math.sin(2 * Math.PI * f * vib * x);
      return w * a * r * vel * (i === 0 ? 0.62 : 0.4);
    }, (i - 1) * 0.5, 0.35);
  }
}
function kick(t, vel = 0.5) {
  add(t, 0.3, (x) => {
    const f = 135 * Math.exp(-x * 34) + 42;
    return Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 15) * vel;
  }, 0, 0.05);
}
function hat(t, vel = 0.1) {
  let lp = 0;
  add(t, 0.045, () => {
    const n = rnd() * 2 - 1;
    lp += 0.28 * (n - lp);
    return (n - lp) * vel;
  }, (rnd() - 0.5) * 0.5, 0.1);
}
function chime(t, f, vel = 0.3, dur = 1.1) {
  add(t, dur, (x) => {
    const env = Math.exp(-x * 3.2) * Math.min(1, x / 0.006);
    return (Math.sin(2 * Math.PI * f * x) + Math.sin(2 * Math.PI * f * 2.76 * x) * 0.16) * env * vel;
  }, (rnd() - 0.5) * 0.8, 0.5);
}
function sub(t, dur, vel = 0.3, f = 55) {
  add(t, dur, (x) => {
    const a = Math.min(1, x / (dur * 0.3)), r = Math.min(1, Math.max(0, (dur - x) / (dur * 0.35)));
    return Math.sin(2 * Math.PI * f * x) * a * r * vel;
  }, 0, 0);
}
function whoosh(t, dur, vel = 0.24, up = true) {
  let lp = 0, hp = 0;
  add(t, dur, (x) => {
    const u = x / dur;
    const cut = up ? 0.02 + 0.4 * u * u : 0.42 - 0.4 * u * u;
    const n = rnd() * 2 - 1;
    lp += cut * (n - lp);
    hp += 0.05 * (lp - hp);
    const env = Math.sin(Math.PI * Math.min(1, u)) ** 1.2;
    return (lp - hp) * env * vel;
  }, 0, 0.3);
}
function thud(t, vel = 0.5) {
  let lp = 0;
  add(t, 0.22, (x) => {
    const n = rnd() * 2 - 1;
    lp += 0.06 * (n - lp);
    const env = Math.exp(-x * 22);
    return (lp * 0.7 + Math.sin(2 * Math.PI * 68 * x) * 0.5) * env * vel;
  }, 0, 0.12);
}
function tick(t, vel = 0.12) {
  add(t, 0.035, (x) => Math.sin(2 * Math.PI * 1900 * x) * Math.exp(-x * 120) * vel, (rnd() - 0.5) * 0.4, 0.05);
}
function boom(t, vel = 0.65) {
  add(t, 1.6, (x) => {
    const env = Math.exp(-x * 2.6);
    return (Math.sin(2 * Math.PI * 41 * x) * 0.9 + Math.sin(2 * Math.PI * 61.5 * x) * 0.35) * env * vel;
  }, 0, 0.12);
  let lp = 0;
  add(t, 0.9, (x) => {
    const n = rnd() * 2 - 1;
    lp += 0.045 * (n - lp);
    return lp * Math.exp(-x * 4) * vel * 0.5;
  }, 0, 0.15);
}
function gliss(t0, t1, vel = 0.2) {
  const dur = t1 - t0;
  for (let k = 0; k < 3; k++) {
    add(t0 + k * 0.06, dur, (x) => {
      const u = x / dur;
      const f = 240 * Math.pow(9, u) * (1 + k * 0.003);
      const env = Math.sin(Math.PI * Math.min(1, u)) ** 1.4;
      return Math.sin(2 * Math.PI * f * x) * env * vel / (k + 1);
    }, (k - 1) * 0.5, 0.4);
  }
}

// ---------------- 配乐 ----------------
// Act 0：枯燥的机械固定音型（干、平、微微走调），14s 起飞
{
  const OST = [220, 261.63, 329.63, 261.63];
  for (let b = 0; b < Math.floor(13.4 / BEAT); b++) {
    const detune = 1 + (b / 20) * 0.006 * (b % 2 ? 1 : -1);   // 越来越"不对劲"
    pluck(1.0 + b * BEAT, OST[b % 4] * detune, 0.15, 0.38, 0);
  }
  for (const s of A0.stamps) thud(s, 0.55);
  gliss(A0.glitch[0] + 0.4, A0.sweep[0] + 0.2, 0.16);
  whoosh(A0.sweep[0], A0.sweep[1] - A0.sweep[0] + 0.5, 0.3, true);
  chime(A0.beautyText, 1046.5, 0.2, 1.4);
}

// 和声垫：全部段落
for (const p of PAD_PLAN) pad(p.t, p.freqs, p.dur, 0.15);

// Act 1：琶音 + 律动渐强
{
  const arpEnd = 52;
  for (const p of PAD_PLAN) {
    if (p.t >= 16 && p.t < arpEnd) {
      const tones = [...p.freqs.map((f) => f * 2), ...p.freqs.map((f) => f * 4)];
      const dur = Math.min(p.dur, arpEnd - p.t);
      const n = Math.floor(dur / (BEAT / 2));
      for (let i = 0; i < n; i++) {
        const t = p.t + i * BEAT / 2;
        pluck(t, tones[[0, 2, 4, 3, 1, 4, 2, 5][i % 8] % tones.length], i % 4 === 0 ? 0.2 : 0.1, 0.5);
      }
    }
  }
  for (let t = 28; t < 52; t += BEAT * 4) kick(t, 0.34);
  for (let t = 40; t < 52; t += BEAT / 2) hat(t, 0.06);
  for (const w of A1.whooshes) whoosh(w - 0.35, 0.7, 0.14, true);
}

// Act 2：功能演示段 —— 律动收敛，突出"连接"的仪式感
{
  for (let t = 52; t < 104; t += BEAT * 2) kick(t, 0.22);
  for (let t = 52; t < 104; t += BEAT) hat(t + BEAT / 2, 0.045);
  // 滑杆拖动 / 反向拖动的细密 tick
  for (let t = A2.drag1[0]; t < A2.drag1[1]; t += 0.21) tick(t, 0.1);
  for (let t = A2.grab[0]; t < A2.grab[1]; t += 0.24) tick(t, 0.09);
  // 连接水晶音
  chime(A2.connect1, 1046.5, 0.26, 1.3);
  chime(A2.connect1 + 0.02, 1568, 0.14, 1.0);
  A2.rigChimes.forEach((t, i) => chime(t, [1046.5, 1174.66, 1318.51][i], 0.24, 1.2));
  // θ 段落：跟随旋转的脉动低音
  for (let t = A2.thetaPlay[0]; t < A2.thetaPlay[1]; t += BEAT) sub(t, BEAT * 0.9, 0.1, 73.4);
  // 蒙太奇过场
  for (const m of A2.montage) whoosh(m.t0 - 0.2, 0.55, 0.13, true);
  chime(92.2, 880, 0.2, 1.0);
  chime(A2.verdict, 1046.5, 0.24, 1.4);
  chime(A2.verdict + 0.06, 1318.5, 0.14, 1.1);
}

// Act 3：riser → 成就三音 + 轰鸣 → 坠入深空
{
  whoosh(108.0, 2.2, 0.2, true);
  sub(108.0, 2.2, 0.22, 49);
  for (const [i, f] of MOTIF.achWeave.entries()) chime(A3.ach + i * 0.05, f, 0.34, 2.2);
  boom(A3.ach + 0.05, 0.55);
  whoosh(A3.fall[0], 2.4, 0.22, false);
  sub(A3.fall[0] + 0.4, 3.2, 0.16, 55);
}

// Act 4：星亮点灯音阶 → 织网铃铛雨 → 心跳
{
  A4.stars.forEach((t, i) => chime(t, BELL_SCALE[i], 0.2, 1.3));
  const sched = edgeSchedule();
  sched.forEach((e, i) => {
    const hero = i < 15;
    chime(e.t0 + e.grow * 0.8, BELL_SCALE[i % BELL_SCALE.length] * (hero ? 1 : 2), hero ? 0.16 : 0.07, 0.9);
  });
  boom(A4.heartbeat, 0.7);
  boom(A4.heartbeat + 0.26, 0.4);
  for (const [i, f] of MOTIF.achWeave.entries()) chime(A4.netText + i * 0.07, f, 0.22, 2.4);
  sub(139.8, 3.4, 0.2, 55);
}

// Act 5：落版主题 + 收尾
{
  chime(A5.logoDraw[0] + 0.2, 1046.5, 0.2, 2.0);
  chime(A5.wordmark, 783.99, 0.18, 1.8);
  chime(A5.slogan, 1046.5, 0.16, 2.2);
  chime(A5.slogan + 0.09, 1568, 0.1, 1.6);
}

// ---------------- 总线：混响 → 软压限 → 首尾淡入淡出 → 写 WAV ----------------
reverb();
for (let i = 0; i < NS; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (DUR + 0.4 - t) / 1.6));
  for (const ch of [L, R]) {
    let v = ch[i] * fade * 1.15;
    ch[i] = Math.tanh(v * 1.25) * 0.82;      // 软限幅
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'audio.wav');
const buf = Buffer.alloc(44 + NS * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + NS * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(NS * 4, 40);
for (let i = 0; i < NS; i++) {
  const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, v)) * 32767)));
  buf.writeInt16LE(clamp16(L[i]), 44 + i * 4);
  buf.writeInt16LE(clamp16(R[i]), 44 + i * 4 + 2);
}
fs.writeFileSync(outFile, buf);
console.log(`音频完成：${outFile}（${(DUR + 0.6).toFixed(1)}s，48kHz 立体声）`);
