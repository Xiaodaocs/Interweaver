// 音效系统（用户要求：给工作画布的部分操作增加音效，包括成就音效）
//
// 设计约束（沿用本项目既有原则）：
//   · **零素材**：全部用 WebAudio 现场合成，不引入任何音频文件；
//   · **不抢背景音乐**：独立音频上下文 + 极低的主增益（0.10），音色取正弦/三角，短促衰减，
//     与 ambientAudio 的氛围垫（−28dB）层次分明、互不打架；
//   · **遵守自动播放策略**：AudioContext 在**首次用户手势**后才创建（armSfx()），失败静默忽略；
//   · **可关**：设置卡里一个开关（localStorage: interweaver.sfx，默认开）。
//
// ★ 音效开关属于**用户数据**：按账号分键（interweaver.u<id>.sfx）——
//   用户要求"每个账号都是独立的"：同一个浏览器换账号后，音效开关各是各的。
//   读写都走 userScope（还没归属的全局旧键仍会被本人读到，不会因为分键而把设置弄丢）。
import { readUserValue, writeUserValue } from './userScope.js';

// 音效清单（对应画布上的操作）：
//   select  轻点（选中/取消选中）
//   create  上行短音（创建实体）
//   delete  下行闷音（删除实体）
//   achSolo 明亮钟音（独石成就点亮）
//   achWeave 五度双音（交织成就点亮 —— 比独石更"成对"）
const STORAGE_KEY = "interweaver.sfx";

let ctx = null;
let master = null;
let enabled = readEnabled();
let armed = false;

function readEnabled() {
  try {
    const v = readUserValue(STORAGE_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch { /* 忽略 */ }
  return true;   // 默认开（用户要求"给操作加音效"）
}

function saveEnabled(v) {
  try { writeUserValue(STORAGE_KEY, v ? "on" : "off"); } catch { /* 忽略 */ }
}

export function sfxEnabled() { return enabled; }

export function setSfxEnabled(on) {
  enabled = !!on;
  saveEnabled(enabled);
  if (master && ctx) {
    try { master.gain.setTargetAtTime(enabled ? 0.1 : 0, ctx.currentTime, 0.02); } catch { /* 忽略 */ }
  }
  return enabled;
}

/** 在首次用户手势里调用一次：创建音频上下文（自动播放策略要求） */
export function armSfx() {
  if (armed) return true;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.1 : 0;
    master.connect(ctx.destination);
    armed = true;
    // 调试/核验钩子：让自动化能证明音效链路真的可用（不改业务逻辑）
    try { globalThis.__IW_SFX = { armed: () => armed, enabled: () => enabled, play: playSfx, set: setSfxEnabled, state: () => (ctx ? ctx.state : 'none') }; } catch { /* 忽略 */ }
    return true;
  } catch {
    ctx = null; master = null; armed = false;
    return false;
  }
}

/** 一个短音的原语：振荡器 + 指数衰减包络（t0 起，dur 秒内衰完） */
function blip(type, freqFrom, freqTo, dur, gain = 1, t0 = null) {
  if (!ctx || !master) return;
  const start = t0 === null ? ctx.currentTime : t0;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, start);
  if (freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(0.012, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g); g.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/**
 * 播放一个音效。name ∈ select | create | delete | achSolo | achWeave
 * 未 arm / 已静音 / 不支持音频时**静默返回**（绝不影响画布与成就逻辑）。
 */
export function playSfx(name) {
  if (!enabled || !armed || !ctx || !master) return false;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    switch (name) {
      case "select":
        blip("sine", 660, 660, 0.045, 0.35, t);
        break;
      case "create":
        blip("triangle", 440, 880, 0.09, 0.5, t);
        break;
      case "delete":
        blip("sine", 330, 150, 0.13, 0.5, t);
        break;
      case "achSolo":
        // 明亮钟音：基音 + 五度泛音，衰减约 0.5s
        blip("sine", 1046.5, 1046.5, 0.5, 0.42, t);
        blip("sine", 1568.0, 1568.0, 0.34, 0.2, t + 0.02);
        break;
      case "achWeave":
        // 五度双音 + 高八度微光：比独石更"成对/更盛"
        blip("sine", 523.25, 523.25, 0.62, 0.4, t);
        blip("sine", 783.99, 783.99, 0.62, 0.32, t + 0.04);
        blip("sine", 1046.5, 1046.5, 0.4, 0.16, t + 0.16);
        break;
      default:
        return false;
    }
    return true;
  } catch {
    return false;   // 音频失败绝不影响功能
  }
}
