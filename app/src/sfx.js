// 音效系统（用户要求：给工作画布的部分操作增加音效，包括成就音效）
//
// 设计约束（沿用本项目既有原则）：
//   · **零素材**：全部用 WebAudio 现场合成，不引入任何音频文件；
//   · **不抢背景音乐**：独立音频上下文 + 极低的主增益（0.10），音色取正弦/三角，短促衰减，
//     与 ambientAudio 的氛围垫（−28dB）层次分明、互不打架；
//   · **遵守自动播放策略**：AudioContext 在**首次用户手势**后才创建（armSfx()），失败静默忽略；
//   · **可关**：设置页的「音效」开关（默认开）。
//
// ★ 音效开关**只有一个事实来源**：设置库（settings.js 的 sfx 键）。
//   以前这里自己存一个键（interweaver.sfx / interweaver.u<id>.sfx），设置库又存一个 sfx，
//   两个来源互相覆盖：换账号/刷新时"把设置库推给运行时"会顺手把用户关掉的音效写回 on ✗。
//   现在本文件只**读**设置库那份（按账号分键 + 会同步到后端 = 用户数据），
//   用户切换开关时也只**写**它；旧键只做一次性认领（见 claimLegacySfx），认领后即删除。
//   本文件被 index/starmap/settings/login 等多个页面 import：
//   不依赖"设置页已经加载"—— 设置库没有 localStorage 时自己退化为内存默认值，模块顶层也从不碰 DOM。
import { getSetting, setSetting, onSettingChange } from './settings.js';
import { readUserValue, removeUserValue, scopedKey, currentUserId, onScopeChange } from './userScope.js';
import { getToken } from './api.js';

// 音效清单（对应画布上的操作）：
//   select  轻点（选中/取消选中）
//   create  上行短音（创建实体）
//   delete  下行闷音（删除实体）
//   achSolo 明亮钟音（独石成就点亮）
//   achWeave 五度双音（交织成就点亮 —— 比独石更"成对"）
const SETTING_KEY = 'sfx';                  // 设置库里的键 —— 唯一事实来源（bool，默认 true）
const LEGACY_KEY = 'interweaver.sfx';       // 升级前的旧键：只读一次、认领后删除，**不再写**

let ctx = null;
let master = null;
let armed = false;
let enabled = true;                         // 运行时缓存；真值来自设置库（syncEnabled 刷新）
let claimed = false;                        // 旧键认领是否已处理（无论有没有旧键都只处理一次）

/** localStorage（Node / 隐私模式下没有） */
function ls() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * **一次性认领**旧键（interweaver.sfx / interweaver.u<id>.sfx）→ 并进设置库。
 * 策略与理由：
 *   · 旧键的值是 "on"/"off"，设置库的 sfx 是 bool 且**默认 true** —— 只有 "off" 与默认不同，
 *     所以**只有 "off" 需要搬**：用户当初真的关过音效（这是他的真实选择，绝不能丢）；
 *     "on" 与默认一致，不写（也就不会覆盖设置库里用户后来改的值）。
 *   · 搬完**删掉旧键**：从此旧键不再存在，"只剩一份"由数据本身保证，而不是靠约定。
 *   · 读旧键走 userScope.readUserValue（该键在认领清单里）：归属规则说了算 ——
 *     不是本人的旧数据读不到，也就不会被当前账号误认领。
 *   · 命名空间还没定（只有 token、/auth/me 未回）时先不动手，等 onScopeChange 再认领。
 */
function claimLegacySfx() {
  if (claimed) return;
  const id = currentUserId();
  if (id === null && getToken()) return;      // 可能是登录用户，只是账号还没认出来 → 等通知
  claimed = true;
  const scoped = scopedKey(LEGACY_KEY);       // 本账号命名空间里的旧键（访客时 = 全局旧键本身）
  let raw = null, fromScoped = false;
  try {
    const s = ls();
    const sv = s ? s.getItem(scoped) : null;
    if (sv !== null) { raw = sv; fromScoped = true; }
    else raw = readUserValue(LEGACY_KEY);     // 退回全局旧键（是否属于本人由 userScope 判）
  } catch { return; }
  if (raw === null) return;                   // 没有旧键 → 什么都不做
  if (raw === 'off') {
    try { setSetting(SETTING_KEY, false); } catch { claimed = false; return; }   // 写不进去就别删旧键（宁可下次再试，也不能丢）
  } else if (raw !== 'on') {
    return;                                   // 不认识的值：不猜（对齐 userScope 的"坏数据不导入"）
  }
  try { removeUserValue(LEGACY_KEY); } catch { /* 忽略 */ }                      // 删掉本账号那份旧键
  if (!fromScoped) { try { const s = ls(); if (s) s.removeItem(LEGACY_KEY); } catch { /* 忽略 */ } }   // 以及全局旧键
}

/** 把开关推到音频主增益上（还没 arm 时什么都不用做：armSfx 会按 enabled 设初值） */
function applyGain() {
  if (!master || !ctx) return;
  try { master.gain.setTargetAtTime(enabled ? 0.1 : 0, ctx.currentTime, 0.02); } catch { /* 忽略 */ }
}

/** 从设置库刷新运行时缓存（并顺手把还没处理的旧键认领掉） */
function syncEnabled() {
  claimLegacySfx();
  try { enabled = getSetting(SETTING_KEY) !== false; } catch { enabled = true; }
  applyGain();
  return enabled;
}

/**
 * 写回设置库。★ 值没变就**不写、不通知**：
 * main.js 的 applySettings 会把设置库的值回灌给 setSfxEnabled，
 * 无脑写会造成 "写 → 通知 → applySettings → 再写" 的自激循环 ✗。
 */
function saveEnabled(v) {
  try {
    if (getSetting(SETTING_KEY) === !!v) return;
    setSetting(SETTING_KEY, !!v);
  } catch { /* 忽略：设置库不可用时只保留内存值 */ }
}

syncEnabled();                              // 模块加载即从设置库取真值（没有设置页也成立：默认 true）
// 设置页/其它文档改了 sfx（含 storage 事件带来的跨页变更）→ 刷新缓存；
// 换账号 → 命名空间变了 → 重新取值，并处理那次可能才被 claimLegacy 搬过来的旧键。
try { onSettingChange((key) => { if (key === SETTING_KEY) syncEnabled(); }); } catch { /* 忽略 */ }
try { onScopeChange(() => { claimed = false; syncEnabled(); }); } catch { /* 忽略 */ }

export function sfxEnabled() { return syncEnabled(); }

export function setSfxEnabled(on) {
  enabled = !!on;
  saveEnabled(enabled);
  applyGain();
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
