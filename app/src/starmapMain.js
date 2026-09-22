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

// 主题：沿用工作台里选过的主题（theme.js 存在 interweaver.theme），默认深色
// 成就页固定深色宇宙（用户要求：深色应用于成就页面）—— 不跟随工作台的浅色设置。
document.documentElement.dataset.theme = 'dark';

// 成就页星空（用户要求：只在成就页存在）：纯 CSS box-shadow 星点 —— 零 canvas、零素材、极便宜。
(function makeStarLayer() {
  const host = document.querySelector('.bgStars');
  if (!host) return;
  let seed = 20260914;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mk = (cnt, size, op) => {
    const d = document.createElement('i');
    const sh = [];
    for (let k = 0; k < cnt; k++) {
      sh.push(Math.round(rnd() * 2200) + 'px ' + Math.round(rnd() * 1500) + 'px 0 ' + size + 'px rgba(255,255,255,' + op + ')');
    }
    d.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;border-radius:50%;box-shadow:' + sh.join(',') + ';';
    host.appendChild(d);
  };
  mk(150, 1, 0.9);    // 远星（多而小）
  mk(60, 1.7, 0.5);   // 近星（少而大）
})();

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
