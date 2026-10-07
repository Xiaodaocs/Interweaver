// 「我的」独立页面（app/mine.html）的入口。
//
// 这一页自己只做三件事，其余全部交给 src/accountPanel.js（「我的」面板的**唯一**实现）：
//   ① 登录门：没有 token 就**直接**去 login.html —— 用户定的规矩，不弹提示、也不渲染半个页面；
//   ② 主题：与工作台 / 设置页 / 登录页共用同一个存储键（themeBoot.js 预置 + theme.js 的 initTheme）；
//   ③ 页头：返回画布。
//
// ★ 为什么本模块在 import 时**什么都不做**：
//   tests/check-modules-import.mjs 的模块守卫会在 index.html 里 import 每一个**非入口**模块，
//   而它的 ENTRY 名单是写死的（main / starmapMain / settingsMain / themeBoot / loginMain）——
//   mineMain.js 不在里面，所以它会被真的 import 一遍。那一刻页面里没有 #mineWrap，
//   本模块必须安静地什么都不干（不报错、不跳转、不建节点）。
//   于是启动条件是"宿主节点在不在"，而不是"我是不是被当成入口加载的"。
//
// ★ 登录门与"后端不可达"是两件事，别混：
//   · 没有 token            → 立刻 location.replace('./login.html')（不留痕、不进历史）；
//   · 有 token 但后端连不上 → **留在本页**：面板照常把整页结构渲染出来，
//                            并在账号卡下方的报错块里给出后端原文（code / hint / 连不上的地址）。
//   · 有 token 但后端判它失效（401）→ 面板回调 onAuthLost，同样回登录页（那就是"未登录"）。
import { getToken } from './api.js';
import { initTheme } from './theme.js';
import { createMinePanel } from './accountPanel.js';

const wrap = document.getElementById('mineWrap');

if (wrap) {
  if (!getToken()) {
    location.replace('./login.html');
  } else {
    initTheme();
    const back = document.getElementById('mineBack');
    if (back) back.addEventListener('click', () => { location.href = './index.html'; });
    const panel = createMinePanel({
      mount: wrap,
      // token 失效（后端 401）→ 清凭证后回登录页；这一页没有"半个账号"可看
      onAuthLost: () => location.replace('./login.html'),
    });
    // 跟随系统时，系统切换深浅色 → 页面同步（与设置页同一写法）
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => initTheme()); } catch { /* 老浏览器忽略 */ }
    // 验收脚本的只读出口（与设置页的 window.__SET 同一性质：不参与类契约，也不改任何行为）
    window.__IW_MINE = { refresh: panel.refresh, el: panel.el };
  }
}
