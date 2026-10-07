// 成就进度的"存储适配器"：把 runtime 的 storage 接口只对 **progress 键** 改道到后端。
//
// 背景（前后端分离）：createRuntime 的存储本来就是**可注入**的（见 runtime.js 文件头第 ③ 条：
//   "时间由外部传入、存储可注入 → Node 里能用假时钟与假存储跑完整链路"），所以进度这条
//   **不需要改 runtime 内部**，只要从 main.js 传一个适配器进来。
//
// 刻意只改一个键：
//   · STORAGE_KEY（interweaver.progress.v1）= **用户数据** → 走后端（登录后保存/读取）；
//   · LIVE_KEY（interweaver.live.v1）= "正在使用中"的**临时界面状态**（60 秒 TTL，成就页跨页读取）
//     → 仍然走 localStorage（它不是用户数据），但也**按账号命名空间化**：
//     否则账号 2 会看到账号 1 刚刚在用的知识点（用户要求"每个账号都是独立的"）。
//
// ★ 每个账号独立（用户报告的 bug）：所有键都经 userScope.scopedKey() 命名空间化。
//   以前"后端没有就退回全局 localStorage"这条兜底，正是"账号 2 打开就拿到账号 1 的成就"的入口。
//   现在：已登录 → 只读**本账号命名空间**的镜像 + 后端那一份；访客 → 仍旧的全局键（行为不变）。
//
// ★ 与开屏闸门的先后顺序（关键，之前这里丢过账号自己的进度）：
//   main.js 是 `ach.load()`（模块求值时同步执行）**早于**闸门把后端文档 seed() 进来，
//   而 runtime.load() 只会执行一次（`loaded` 标志）。所以：
//     · 本地那份是**镜像**（每次保存都同步写），load() 先按镜像起量；
//     · seed(后端文档) 到达时，用**并集**语义（成就只增不减：importTracker 取最早达成时间、
//       importNet 取最大强度）把它并进**正在运行的** runtime（window.__IW.ach），
//       并把并集写回镜像 —— 于是"切回账号 1，成就原样回来"，也不会用空进度覆盖服务器。
//
// 离线 / 访客：**不写后端**（不静默退回本地存用户数据）—— 与项目"不搞假后端"的纪律一致；
//   失败由 api.js 的 onBackendState 上报并显示（绝不假装成功）。
import { STORAGE_KEY, LIVE_KEY } from './achievements/runtime.js';
import { createTracker, importTracker, exportTracker } from './achievements/tracker.js';
import { createNet, importNet, exportNet } from './achievements/weave.js';
import { putDoc } from './api.js';
import { scopedKey, currentUserId } from './userScope.js';
import * as M from './appMode.js';

/** 两个文档按"成就只增不减"的并集语义合并（成就取最早达成时间、知识网取并集/最大强度） */
function unionDocs(docs) {
  const t = createTracker();
  const n = createNet();
  let any = false;
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    any = true;
    try { importTracker(t, d.tracker); } catch { /* 坏档忽略 */ }
    try { importNet(n, d.net); } catch { /* 坏档忽略 */ }
  }
  if (!any) return null;
  return { v: 1, savedAt: Date.now(), tracker: exportTracker(t), net: exportNet(n) };
}

function parse(raw) {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key, raw) {
  try { localStorage.setItem(key, raw); return true; } catch { return false; }
}

export function createProgressStorage() {
  let remoteDoc = null;      // 后端取回的进度文档（由 seed 注入）
  let pushed = 0;            // 成功推送次数（便于检查与诊断）
  let unioned = 0;           // seed 时并进运行时的次数（便于检查与诊断）

  const loggedIn = () => M.isOnline() && M.getUser() && currentUserId() !== null;
  const mirrorKey = () => scopedKey(STORAGE_KEY);

  /** 把一份文档并进**正在运行的** runtime（存在的话）—— 让账号自己的成就在本趟就显示出来 */
  function mergeIntoRuntime(doc) {
    if (!doc) return 0;
    const IW = globalThis.__IW;
    const ach = IW && IW.ach;
    if (!ach || !ach.tracker || !ach.net) return 0;
    let n = 0;
    try { n += importTracker(ach.tracker, doc.tracker); } catch { /* 忽略 */ }
    try { importNet(ach.net, doc.net); } catch { /* 忽略 */ }
    unioned += 1;
    return n;
  }

  return {
    /** 由开屏闸门在揭层前调用：把后端返回的进度文档放进内存（并立刻并进正在跑的 runtime） */
    seed(doc) {
      if (doc && typeof doc === 'object') {
        remoteDoc = doc;
        const merged = unionDocs([doc, parse(readLocal(mirrorKey()))]);
        if (merged) writeLocal(mirrorKey(), JSON.stringify(merged));   // 镜像 = 并集（下一次开屏先按它起量）
        mergeIntoRuntime(doc);
        return true;
      }
      return false;
    },
    getItem(key) {
      if (key === STORAGE_KEY) {
        // ★ 判据是"**有没有账号**"（不是"这一刻 online 没有"）：闸门揭层前 runtime.load() 就跑了，
        //   那时 appMode 还是 loading —— 以前正是这条缝隙让它读到全局键（= 上一号的成就）。
        if (currentUserId() !== null) {
          const merged = unionDocs([parse(readLocal(mirrorKey())), remoteDoc]);   // 只认本账号的镜像 + 后端那一份
          return merged ? JSON.stringify(merged) : null;
        }
        if (remoteDoc !== null) return JSON.stringify(remoteDoc);
        return readLocal(key);       // 访客/离线：本机进度（行为同以前）
      }
      if (key === LIVE_KEY) return readLocal(scopedKey(LIVE_KEY));       // 临时界面状态：按账号分键，仍走本地
      return readLocal(key);
    },
    setItem(key, value) {
      if (key === STORAGE_KEY) {
        // ★ 两种模式，别混淆：
        //   · 已登录 + 在线：进度是**用户数据** → 落后端（绝不静默退回本地 ✗），本地只留镜像
        //   · 访客 / 离线：没有服务器账号 → 仍落 localStorage（成就页读的也是它）
        if (currentUserId() === null || !M.isOnline() || !M.getUser()) {
          writeLocal(mirrorKey(), value);         // 已登录但离线 → 写进**本账号**的命名空间，不写全局键
          return;
        }
        const merged = unionDocs([parse(value), remoteDoc, parse(readLocal(mirrorKey()))]);
        if (!merged) return;
        remoteDoc = merged;
        const raw = JSON.stringify(merged);
        writeLocal(mirrorKey(), raw);                       // 本账号的镜像（下一次开屏先按它起量）
        putDoc('progress', merged).then(() => { pushed += 1; }).catch(() => { /* 已在 onBackendState 上报，不假装成功 */ });
        return;
      }
      // live 等临时键：原样落本地，但按账号分键
      writeLocal(scopedKey(key), value);
    },
    removeItem(key) {
      if (key === STORAGE_KEY) {
        remoteDoc = null;
        try { localStorage.removeItem(mirrorKey()); } catch { /* 忽略 */ }
        return;
      }
      try { localStorage.removeItem(scopedKey(key)); } catch { /* 忽略 */ }
    },
    /** 诊断用：已成功推送到后端的次数 / 是否已拿到后端文档 / 镜像键与并集次数 */
    stats() { return { pushed, hasRemote: remoteDoc !== null, unioned, key: mirrorKey(), liveKey: scopedKey(LIVE_KEY) }; },
  };
}
