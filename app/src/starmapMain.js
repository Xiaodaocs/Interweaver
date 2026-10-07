// 成就页入口（独立页面 starmap.html）
//
// 用户要求：成就页与工作台**完全分离，不在同一个 html 上**。
// 本入口只做三件事：
//   ① 读取成就进度（★ 与工作台共用**当前账号**那一份：interweaver.u<id>.progress.v1；
//      访客仍是 interweaver.progress.v1）
//   ② 把星图挂到 #stage（本页没有画布，所以星图就是页面的全部内容）
//   ③ 关闭时返回工作台 index.html
//
// 这样"拖动时在工作台与成就页之间跳""连线被甩没"这类现象从结构上不再可能：
// 本页没有工作台可跳，也没有那块 2845×3258 的巨大合成层盖在任何东西上面。
//
// ★ 用户要求（"新注册的账号从成就到画布都是崭新的"）：本页以前直接读**全局键**
//   interweaver.progress.v1，于是登录用户在画布上点亮的成就，他打开成就页却看不到
//   （画布那份已经写进 interweaver.u<id>.progress.v1 的镜像）。现在整页的存储都过
//   userScope.scopedStorage()：同一个账号两边看同一份，换账号就是空的。
// ★ 用户要求（"成就也是用户数据"）：本页**自己也要能拉一次后端**。
//   以前这一页只读 scopedStorage() 解析出来的**本账号本地镜像** interweaver.u<id>.progress.v1：
//   在**全新设备**上直接用书签打开 /starmap.html（从没进过画布页）时那份镜像是空的 → 空星图；
//   只有画布页的开屏闸门（bootGate）才会 GET 后端 progress 并 seed 进镜像。现在本页开机就补齐这一步：
//     · 有 token → 探活 → GET /api/v1/progress（api.js 的 getDoc('progress'），后端同一条文档）
//       → seed 进正在运行的 runtime（并集语义，与画布 progressStorage.seed 完全同一套）；
//     · 未登录 / 离线 / 后端报错 → **静默走本地镜像**（语义与画布一致），只在控制台留一行，绝不弹窗打断。
import { createRuntime } from './achievements/runtime.js';
import { openStarMap } from './starmap.js';
import { createProgressStorage } from './progressStorage.js';
import { getDoc, getToken, probeBackend, me } from './api.js';

// 主题：**跟随全局设置**（用户本轮要求："确保在画布的导航栏中的深色/浅色按钮能应用到全局
// （包括成就，设置等）并作为用户数据的一部分存储"）。
// ★ 这是对更早一轮要求的**反转**：当时要求"成就页固定深色宇宙、不跟随工作台"，现在改为跟随 —— 以本轮为准。
//   theme.js 与工作台、设置页共用同一个存储键 interweaver.theme，
//   所以导航栏那个 ◐ 按钮一按，工作台 / 成就页 / 设置页三处同时变。
import { initTheme } from './theme.js';
initTheme();

// ★ 用户本轮要求（⑤）："删掉『星空』的背景逻辑（之前曾经加到过成就页面里）"
//   —— 原 makeStarLayer 在这里生成 150 颗远星 + 60 颗近星（纯 CSS box-shadow）。
//   整段已删除；starmap.html 里的 <div class="bgStars"> 也一并删掉，不留空壳。
//   注：设置页（settings.html）自己也有一份同样的星空逻辑，用户这次只点了成就页，
//       那边暂未改动 —— 若要一起删，说一声即可。

const stage = document.getElementById('stage');

// 进度：与工作台共用**同一个账号**的那一份存档。
// ★ 存储适配器换成 progressStorage（**与画布完全同一个**）：
//   · progress 键 → 本账号镜像 + 后端文档的并集（读），写仍按原样落本账号镜像（见下方说明）；
//   · live 等临时键 → 本账号命名空间下的本地键（scopedKey），与以前一致。
//   为什么写不落后端：这一页没有开屏闸门，appMode 停在 loading（M.isOnline()=false、M.getUser()=null），
//   于是 progressStorage 的写路只落本地镜像 —— 与改动前 scopedStorage 的行为**逐字一致**；
//   而"往一个从没有过进度的新账号写一份空文档"正是账号隔离检查里被钉住的反面（后端 doc 必须保持 null）。
//   画布的写路（开屏后 setItem → putDoc）不变，本页改动的是**读路**。
const storage = createProgressStorage();
const rt = createRuntime({ storage });
// seed() 要把后端文档并进"**正在运行的** runtime"（与画布同一条：main.js 的 window.__IW.ach）。
// 本页没有工作台，所以这里自己把它挂上（starmap.js 也会往 window.__IW 上挂 starmapCam，互不冲突）。
globalThis.__IW = globalThis.__IW || {};
globalThis.__IW.ach = rt;
let granted = 0;
try { granted = rt.load(); } catch { granted = 0; }     // 先按本账号的本地镜像起量

/**
 * 拉一次后端进度并 seed 进 runtime。返回值只用于日志与断言，不影响页面可用性。
 * 顺序与画布的开屏闸门一致：探活 → /auth/me（**顺便确定"我是谁"**：键名要按账号命名空间解析，
 * 全新设备上 interweaver.auth.v1 还不存在，只有 me() 回来才知道 uid）→ GET progress。
 */
async function pullRemoteProgress() {
  if (!getToken()) return { ok: false, why: 'no-token' };
  let probe = null;
  try { probe = await probeBackend(); } catch (e) { return { ok: false, why: 'probe', error: e }; }
  if (!probe || !probe.ok) return { ok: false, why: 'offline', error: probe && probe.error };
  let user = null;
  try { const r = await me(); user = (r && r.user) || null; }
  catch (e) { return { ok: false, why: 'me', error: e }; }
  try {
    const r = await getDoc('progress');
    if (r && r.doc) { storage.seed(r.doc); return { ok: true, doc: true, user }; }
    return { ok: true, doc: false, user };            // 账号里还没有进度：不是错误，按空星图渲染
  } catch (e) { return { ok: false, why: 'doc', error: e }; }
}

const pulled = await pullRemoteProgress();
const pullErr = pulled.error && (pulled.error.code || pulled.error.message);
if (!pulled.ok) {
  // 未登录 / 离线 / 后端报错：保持"读本账号本地镜像"的行为不变，只在控制台留痕（不打断页面）
  console.warn('[starmap page] 没取到后端进度，改用本账号本地镜像：' + pulled.why + (pullErr ? '（' + pullErr + '）' : ''));
} else {
  granted = rt.tracker.granted.size;                  // seed = 并集，取并集之后的数量
}

// 打开星图（stage 作为挂载点；关闭 → 回工作台）
openStarMap({
  tracker: rt.tracker,
  net: rt.net,
  mount: stage,
  storage,                                  // "正在使用中"的 live 记录同样按账号读
  onClose: () => { window.location.href = './index.html'; },
});

console.log('[starmap page] 已点亮成就 =', granted, '| 知识点 =', rt.net.nodes.size,
  '| 后端进度 =', (pulled.ok ? (pulled.doc ? '有' : '空') : '未取到（' + pulled.why + '）'),
  '| 存档 =', storage.stats().key);
