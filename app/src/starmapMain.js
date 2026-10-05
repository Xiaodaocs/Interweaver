// 成就页入口（独立页面 starmap.html）
//
// 用户要求：成就页与工作台**完全分离，不在同一个 html 上**。
// 本入口只做三件事：
//   ① 从 localStorage 读取成就进度（与工作台共用 interweaver.progress.v1）
//   ② 把星图挂到 #stage（本页没有画布，所以星图就是页面的全部内容）
//   ③ 关闭时返回工作台 index.html
//
// 这样"拖动时在工作台与成就页之间跳""连线被甩没"这类现象从结构上不再可能：
// 本页没有工作台可跳，也没有那块 2845×3258 的巨大合成层盖在任何东西上面。
import { createRuntime } from './achievements/runtime.js';
import { openStarMap } from './starmap.js';

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

// 进度：与工作台共用同一份存档；读不到就展示全未点亮的初始状态
const rt = createRuntime();
let granted = 0;
try { granted = rt.load(); } catch { granted = 0; }

// 打开星图（stage 作为挂载点；关闭 → 回工作台）
openStarMap({
  tracker: rt.tracker,
  net: rt.net,
  mount: stage,
  onClose: () => { window.location.href = './index.html'; },
});

console.log('[starmap page] 已点亮成就 =', granted, '| 知识点 =', rt.net.nodes.size, '| 存档 = interweaver.progress.v1');
