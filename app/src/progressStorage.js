// 成就进度的"存储适配器"：把 runtime 的 storage 接口只对 **progress 键** 改道到后端。
//
// 背景（前后端分离）：createRuntime 的存储本来就是**可注入**的（见 runtime.js 文件头第 ③ 条：
//   "时间由外部传入、存储可注入 → Node 里能用假时钟与假存储跑完整链路"），所以进度这条
//   **不需要改 runtime 内部**，只要从 main.js 传一个适配器进来。
//
// 刻意只改一个键：
//   · STORAGE_KEY（interweaver.progress.v1）= **用户数据** → 走后端（登录后保存/读取）；
//   · LIVE_KEY（interweaver.live.v1）= "正在使用中"的**临时界面状态**（60 秒 TTL，成就页跨页读取）
//     → 仍然走 localStorage：它不是用户数据，且成就页现在读的是 localStorage。
//     这样既完成了"用户数据在后端"，又不会弄坏既有的"使用中"高亮。
//
// 离线 / 访客：**不写任何东西**（不静默退回本地存用户数据）—— 与项目"不搞假后端"的纪律一致；
//   失败由 api.js 的 onBackendState 上报并显示（绝不假装成功）。
import { STORAGE_KEY } from './achievements/runtime.js';
import { putDoc } from './api.js';
import * as M from './appMode.js';

export function createProgressStorage() {
  let remoteDoc = null;      // 后端取回的进度文档（由 seed 注入，在**第一次 tick 之前**完成）
  let pushed = 0;            // 成功推送次数（便于检查与诊断）

  return {
    /** 由开屏闸门在揭层前调用：把后端返回的进度文档放进内存（runtime.load() 随后会读到它） */
    seed(doc) {
      if (doc && typeof doc === 'object') { remoteDoc = doc; return true; }
      return false;
    },
    getItem(key) {
      if (key !== STORAGE_KEY) {
        try { return localStorage.getItem(key); } catch { return null; }   // live 等临时键：原样
      }
      if (remoteDoc !== null) return JSON.stringify(remoteDoc);
      try { return localStorage.getItem(key); } catch { return null; }   // 访客/离线：本地进度
    },
    setItem(key, value) {
      if (key !== STORAGE_KEY) {
        try { localStorage.setItem(key, value); } catch { /* 隐私模式等 */ }
        return;
      }
      // ★ 两种模式，别混淆：
      //   · 已登录 + 在线：进度是**用户数据** → 只落后端（绝不静默退回本地 ✗）
      //   · 访客 / 离线：没有服务器账号 → 仍落 localStorage
      //     （这不是"给登录用户偷偷兜底"，而是访客自己的本地进度；成就页读的也是它，
      //       否则访客的画布进度跨页就断了 —— 上一版正是这么把 8 个界面类弄没的）
      if (!M.isOnline() || !M.getUser()) {
        try { localStorage.setItem(key, value); } catch { /* 隐私模式等 */ }
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(value); } catch { return; }
      remoteDoc = parsed;
      putDoc('progress', parsed).then(() => { pushed += 1; }).catch(() => { /* 已在 onBackendState 上报，不假装成功 */ });
    },
    removeItem(key) {
      if (key === STORAGE_KEY) { remoteDoc = null; return; }
      try { localStorage.removeItem(key); } catch { /* 忽略 */ }
    },
    /** 诊断用：已成功推送到后端的次数 */
    stats() { return { pushed, hasRemote: remoteDoc !== null }; },
  };
}
