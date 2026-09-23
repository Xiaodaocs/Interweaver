// S1（用户要求 ⑧）：卡片统一化 —— **取消手动拖动窗口与最小化**，只保留统一的滑入/滑出动画。
// 位置与尺寸一律由 CSS 决定（不再写内联 left/top，也不再有吸边胶囊）。
// 保留 makeWindow/makeWindows 两个旧入口，避免调用方改动（行为已按新要求收敛）。

const SLIDE_MS = 260;

/** 显示卡片并播放滑入动画；dir: 'up' | 'left' | 'tl' */
export function showCard(el, dir = 'up') {
  if (!el) return;
  el.dataset.slide = dir;
  el.hidden = false;
  el.classList.remove('on');
  requestAnimationFrame(() => el.classList.add('on'));
}

/** 播放滑出动画后隐藏 */
export function hideCard(el) {
  if (!el || el.hidden) return;
  el.classList.remove('on');
  setTimeout(() => { el.hidden = true; }, SLIDE_MS);
}

export function isCardOpen(el) {
  return !!el && !el.hidden;
}

/** 兼容旧入口：只做统一化处理（清掉历史最小化按钮），不再安装拖动/最小化 */
export function makeWindow(el) {
  if (!el || el.dataset.winReady) return;
  el.dataset.winReady = '1';
  for (const b of el.querySelectorAll('[data-winmin]')) b.remove();   // ⑧ 最小化已取消
  if (el.dataset.slide) el.classList.add('on');
}

export function makeWindows(list) {
  for (const el of list) if (el) makeWindow(el);
}
