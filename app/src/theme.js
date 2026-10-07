// T0 · 主题系统（默认浅色；成就页在新账号下默认深色）
//
// 设计依据：docs/P15-成就页宇宙化重设计.md §1.1
//   · 提供 深色 / 浅色 / 跟随系统 三选，持久化到 localStorage（本轮起：**逐页**持久化，见下）
//   · 深色下：纸面 #0B0E16、网格线改为低对比冷灰、实体色走 dark 变体
//   · 所有读颜色的地方统一从这里取（render.js 的 PAPER/GRID/ACCENT 等），
//     不在各处散落 # 常量 —— 否则深色只能是"反色"，而我要的是"重新设计"。
//
// ★ 主题属于**用户数据**：按账号分键（interweaver.u<id>.theme）。
//   用户要求"每个账号都是独立的"—— 同一浏览器换账号后，主题必须各是各的。
//   读/写都走 userScope（读的时候允许回退到还没归属的全局旧键，旧值不丢；
//   归属由 userScope.claimLegacy 在登录成功时落定）。见 src/userScope.js。
import { readUserValue, writeUserValue, onScopeChange } from './userScope.js';

const STORAGE_KEY = 'interweaver.theme';

// ★★ 本轮（用户要求）：**每个页面各自记一个主题**，同时保留"跟随全局默认"。
//
// 解析顺序（唯一来源；themeBoot.js 里有一份等价的 ES5 精简版，两处必须一起改）：
//   ① 本页覆盖：interweaver.pagetheme.<页面id>（「设置 → 个性化」里逐页选择）
//   ② 全局默认：interweaver.theme —— **沿用这个老键**，不新建键、不做一次性搬迁
//   ③ 页面默认：starmap → dark（用户要求：新账号的成就页默认深色），其它页面 → light
//
// 迁移策略：**沿用老的全局键当"全局默认"**，不做复制式搬迁。理由：
//   · 老用户原来的 interweaver.theme 原地继续生效（值一格都不丢，见①③都落空时才用它）；
//   · userScope 的认领清单（USER_KEYS）与登录页的旧数据导入完全不用改，
//     "访客主题带进第一个账号""绝不进第二个账号"这些既有性质原样成立；
//   · 若改成"把老键复制成每页一份再删老键"，那份复制是把五份值钉死成同一时刻的快照
//     （以后改全局默认再也影响不到它们），而且删/改老键会牵动认领与导入两条链路。
//   于是"跟随全局默认"是**活的**：本页没有①时永远看②，改②就一起变。
//
// 写入语义：
//   setTheme(m)       = 写①本页 + 写②全局默认（◐ 按钮、设置页都用它）——
//                       本页立刻变（用户看得见），没单独设过的页面继续跟着全局走，
//                       与改动前"三页同时变"的行为保持一致；老的调用方与断言都不用改。
//   setGlobalTheme(m) = 只写②（「外观 → 显示模式」＝全局默认；本页没①时本页也跟着变）
//   clearPageTheme()  = 删① → 本页回到"跟随全局默认"
//
// ★★ 画面怎么切（用户两轮要求合起来）：**软边横扫**，而且"已经变过来的那半边必须也是页面"
//   （不是盖一层纸面色）。实现见 sweepTheme()：一次 document.startViewTransition()，
//   浏览器留下"切换前 / 切换后"两张**真渲染快照**，样式表里只给新快照加一条柔和的斜向 mask
//   并把 mask-position 从左上推到右下 —— 于是揭开顺序是左上 → 右下、边界模糊，
//   而两侧都是真页面（文字、按钮、画布都在）。跨页同理：themeBoot 先把新页面按**上一页的主题**
//   画出来（用户要求"先是浅色"），首绘之后再由 finishPendingTheme() 播同一条横扫。
const PAGE_PREFIX = 'interweaver.pagetheme.';
const DEFAULT_MODE = 'light';                    // 非成就页的默认（与改动前一致）
const PAGE_DEFAULT_MODES = { starmap: 'dark' };  // 用户要求：新账号的成就页默认深色
const VALID_MODES = ['dark', 'light', 'system'];

/** 页面 id：由**路径**推出来，不写死页面清单 —— 以后新增 xxx.html 自动就有自己的主题键 */
export function pageIdOf(pathname) {
  const p = String(pathname === undefined ? (typeof location !== 'undefined' ? location.pathname : '') : pathname);
  const last = p.split('/').filter(Boolean).pop() || 'index';
  const id = last.replace(/\.html?$/i, '').toLowerCase();
  return /^[a-z0-9_-]+$/.test(id) ? id : 'index';
}
export function currentPageId() { return pageIdOf(); }

/** 本页覆盖键（基准键；真实键名再经 userScope 按账号命名空间化） */
export function pageThemeKey(pageId = currentPageId()) { return PAGE_PREFIX + pageIdOf0(pageId); }
function pageIdOf0(id) { return /^[a-z0-9_-]+$/.test(String(id)) ? String(id) : 'index'; }

/** 某页的出厂默认（没有任何偏好时用） */
export function pageDefaultMode(pageId = currentPageId()) {
  return PAGE_DEFAULT_MODES[pageIdOf0(pageId)] || DEFAULT_MODE;
}

function readMode(key) {
  try {
    const v = readUserValue(key);
    return VALID_MODES.includes(v) ? v : null;
  } catch { return null; }
}

/** 全局默认（②）；从没设过 → null（= 还没有任何主题偏好） */
export function globalMode() { return readMode(STORAGE_KEY); }
/** 本页是否单独设过（①） */
export function hasPageTheme(pageId = currentPageId()) { return readMode(pageThemeKey(pageId)) !== null; }

/**
 * 解析某页最终用哪个模式：{ mode, source }，source = page | global | default。
 * 这是"每页主题"的唯一判定入口（themeBoot.js 里的 ES5 版必须与它逐条一致）。
 */
export function resolvePageMode(pageId = currentPageId()) {
  const own = readMode(pageThemeKey(pageId));
  if (own) return { mode: own, source: 'page' };
  const g = globalMode();
  if (g) return { mode: g, source: 'global' };
  return { mode: pageDefaultMode(pageId), source: 'default' };
}


export const THEMES = {
  dark: {
    id: 'dark', name: '深色（宇宙）',
    paper: '#0B0E16',            // 画布纸面
    gridLine: 'rgba(160,170,205,0.055)',   // 低对比冷灰
    gridAxis: 'rgba(190,200,230,0.16)',
    gridText: '#6B7590',
    accent: '#7C8CFF',
    gold: '#F0C35B',             // 点亮金（成就）
    goldSoft: '#FFE6A8',         // 交织/流动光点
    pending: '#8FA6FF',
    locked: '#3A4152',
    ink: '#E8ECF8',
    ink2: '#9AA3BD',
    labelBg: 'rgba(14,19,32,0.86)',
    entitySatBoost: 1.12,        // 实体色在深底上提亮 12% 饱和度
    entityLightBoost: 0.08,
  },
  light: {
    id: 'light', name: '浅色',
    paper: '#F5F5F7',
    gridLine: 'rgba(0,0,0,0.045)',
    gridAxis: 'rgba(0,0,0,0.16)',
    gridText: '#8E8E93',
    accent: '#5E5CE6',
    gold: '#C9A227',
    goldSoft: '#E3D68C',
    pending: '#5E5CE6',
    locked: '#B9B9C0',
    ink: '#1D1D1F',
    ink2: 'rgba(60,60,67,0.6)',
    labelBg: 'rgba(250,250,252,0.9)',
    entitySatBoost: 1,
    entityLightBoost: 0,
  },
};

// ★ 两个状态要分清（本轮用户要求"新页面先是旧主题、再漫过去"之后必须拆开）：
//   · mode    = 本页**选定**的模式（用户的选择 / 存储里的值）—— 一改就是新值；
//   · painted = 此刻**真的画在屏幕上**的主题 id —— 横扫动画期间它还是旧的，动画结束那一帧才变。
//   于是：currentMode() 立刻反映用户的选择（◐ 按钮、设置镜像、老断言都不受影响），
//        而 currentTheme()/CSS 变量在动画期间仍是旧主题（画布、实体颜色照旧画），画面才有"漫过来"的过程。
let mode = null;      // 'dark' | 'light' | 'system'
let painted = null;   // 'dark' | 'light'（已解析成实际 id）

function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.dark : THEMES.light; }
  catch { return THEMES.dark; }
}
function systemId() { return systemTheme().id; }

/** 模式 → 真正落到 data-theme 上的 id（system 解析成本机当前的深/浅） */
export function themeIdOf(m) {
  if (m === 'system') return systemId();
  return THEMES[m] ? m : THEMES.light.id;
}

export function currentMode() { return mode || resolvePageMode().mode; }
/** 此刻**画**用的主题（横扫动画期间是旧的那一个） */
export function paintedThemeId() { return painted || themeIdOf(currentMode()); }
export function currentTheme() { return THEMES[paintedThemeId()] || THEMES.light; }

/**
 * 把"画面上这一版主题"落定：写 data-theme + 记住本标签页刚画出来的是什么
 * （跨页横扫据此判断下一页要不要播、从哪个颜色开始）。
 */
function paint(id) {
  painted = id;
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = id;
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(WIPE_FROM_KEY, id); } catch { /* 隐私模式 */ }
}

/**
 * 应用本页主题。首屏那一次由 themeBoot.js（阻塞脚本）先定好，这里是模块侧的正式应用：
 *   · 若 themeBoot 留下了"待播的跨页切换"（上一页主题与本页不同）→ **先不切**：
 *     页面此刻按上一页的主题画着（用户要求：新页面先是浅色），等 themeBoot 在首绘之后
 *     调 finishPendingTheme() 播横扫，结束时才真正切过去；
 *   · 否则立即按存储解析并落定（首屏不闪）；与上一次不同（例如系统深浅改了）→ 播横扫。
 */
export function initTheme() {
  const pend = takePending();
  if (pend) {
    pending = pend;
    mode = pend.to;
    paint(pend.from);
    // 兜底：万一 themeBoot 那条链没跑起来，也不能一直停在旧主题上
    setTimeout(() => { if (pending) finishPendingTheme(); }, 2500);
    return currentTheme();
  }
  const prev = mode;
  mode = resolvePageMode().mode;
  if (prev && themeIdOf(prev) !== themeIdOf(mode)) return switchTo(mode, {});
  paint(themeIdOf(mode));
  return currentTheme();
}

/**
 * 把本页主题切到 target：
 *   · mode 立刻更新（用户的选择立刻生效）；
 *   · 画面通过一次 **View Transition** 换过去（见 sweepTheme）：旧渲染当底、新渲染被一条柔和的
 *     斜向 mask 从左上到右下"揭开" —— 已经变过来的那半边是**真正的新页面**（文字/按钮/画布都在），
 *     而不是盖一层纯色（用户本轮明确要求）。
 * fromId 只在"跨页动画"里显式给（那一帧的画面是 themeBoot 画上去的上一页主题，
 * 而此时本模块可能还没跑过 initTheme —— 例如 login.html 根本没有模块入口）。
 */
function switchTo(target, { animate = true, duration = SWEEP_MS, fromId = null } = {}) {
  if (!VALID_MODES.includes(target)) return currentTheme();
  const from = fromId || paintedThemeId();
  const toId = themeIdOf(target);
  mode = target;
  if (toId === from) { paint(toId); return currentTheme(); }
  const canAnimate = animate && !reducedMotion() && typeof document !== 'undefined' && document.body;
  if (canAnimate && sweepTheme(() => paint(toId), duration)) return currentTheme();
  paint(toId);                       // reduce / 浏览器不支持 View Transition → 直接切（不假装播了动画）
  return currentTheme();
}

/**
 * 改**本页**显示模式（◐ 按钮、设置页的「显示模式」、个性化里给某一页选值都用它）。
 * 同时写全局默认（见文件头）：本页立刻变，没单独设过的页面继续跟着变。
 */
export function setTheme(m, { animate = true, duration = SWEEP_MS } = {}) {
  if (!VALID_MODES.includes(m)) return currentTheme();
  try { writeUserValue(pageThemeKey(), m); } catch { /* 存储不可用：本次仍生效 */ }
  try { writeUserValue(STORAGE_KEY, m); } catch { /* 同上 */ }
  return switchTo(m, { animate, duration });
}

/** 只改**全局默认**（②）：本页没有①时跟着变（并横扫）；本页有①则本页不动 */
export function setGlobalTheme(m, { animate = true, duration = SWEEP_MS } = {}) {
  if (!VALID_MODES.includes(m)) return currentTheme();
  try { writeUserValue(STORAGE_KEY, m); } catch { /* 忽略 */ }
  if (hasPageTheme()) return currentTheme();       // 本页自己有覆盖 → 本次不影响它
  return switchTo(m, { animate, duration });
}

/**
 * 重新按存储解析本页主题并生效（存储被别人改过之后调用：个性化里改了本页、
 * 或清掉了本页覆盖 → 回到"跟随全局默认"）。与已画着的不一样才播横扫。
 */
export function reapplyPageTheme({ animate = true, duration = SWEEP_MS } = {}) {
  const want = resolvePageMode().mode;
  if (themeIdOf(want) === paintedThemeId() && want === mode) return currentTheme();
  return switchTo(want, { animate, duration });
}

export function cycleTheme() {
  return setTheme(currentMode() === 'dark' ? 'light' : (currentMode() === 'light' ? 'system' : 'dark'));
}

// ---------- 主题切换的"软边横扫"（用户要求：左上 → 右下，模糊地漫过去；不要圆、不要明显边界）----------
const WIPE_FROM_KEY = 'interweaver.wipe.v1';   // 与 themeBoot.js 同一个键：本标签页上一次**画出来**的主题
const SWEEP_KEY = '__IW_THEME_SWITCH';         // themeBoot 交给模块侧的"待播跨页切换"（见 initTheme/finishPendingTheme）
const SWEEP_MS = 420;                          // 用户给的区间 260~420ms
let pending = null;                            // { from, to }：等着 themeBoot 在首绘之后叫我们播的那一次切换

function reducedMotion() {
  try {
    return !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

/** 取走 themeBoot 留下的"待播跨页切换"（取一次就删，避免重复播） */
function takePending() {
  if (typeof window === 'undefined') return null;
  const w = window[SWEEP_KEY];
  if (!w || !w.from || !w.to || w.from === w.to) return null;
  try { delete window[SWEEP_KEY]; } catch { window[SWEEP_KEY] = null; }
  return { from: themeIdOf(w.from), to: themeIdOf(w.to) };
}

/**
 * 播一次"旧页面 → 新页面"的**软边横扫**：`applyFn()` 负责把主题真正切过去（paint），
 * 画面由一次 **View Transition** 呈现 —— 已经变过来的那半边是**真正的新页面**
 * （文字/按钮/画布都在，不是盖一层纯色），没变到的半边是真正的旧页面，中间是一条没有清晰分界的斜带。
 *
 * 做法（零依赖、零图片、零快照库）：浏览器原生 View Transition 会把切换前后的两张渲染各截一张
 * 快照放进 ::view-transition-old/new(root)，我们只在样式表里给 new 那层加一条 `to bottom right`
 * 的柔渐变 mask，并把 mask-position 从 100% 100%（整块透明 = 还没揭开）推到 0% 0%（铺满 = 全揭开）：
 *   · old 层保持不动当底（动画禁掉，不跟随默认的交叉淡入淡出）；
 *   · 于是"揭开"的顺序就是**左上 → 右下**，边界柔和（mask 的过渡带），且两层都是真页面。
 * 时长由这里直接写给那个伪元素（View Transition 的伪元素不在 documentElement 的继承链上，
 * 写在 :root 上的自定义属性传不进去 —— 实测过），值取用户给的区间 260~420ms。
 *
 * 不支持 View Transition 的浏览器 → 返回 false，调用方直接切（宁可没有动画，也不假装播了）。
 * prefers-reduced-motion: reduce → 同样直接切（用户要求：不播）。
 * 开机闸门（#iwBoot）盖着时也照样播 —— 用户要求"任何一次页面/样式切换都要有这段动画"。
 */
export function sweepTheme(applyFn, duration = SWEEP_MS) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') { return false; }
  let styleEl = null;
  try {
    // ★ View Transition 的伪元素**不在 documentElement 的继承链上**（实测：写在 :root 上的
    //   --iw-sweep-ms 传不进去，只有样式表里那条 var() 的兜底值生效），所以时长直接用一条
    //   临时样式表规则写给那个伪元素本身，动画结束后移除。
    styleEl = document.createElement('style');
    styleEl.textContent = '::view-transition-new(root){animation-duration:' + duration + 'ms !important}';
    document.head.appendChild(styleEl);
    const cleanup = () => { try { styleEl.remove(); } catch { /* 已移除 */ } };
    setTimeout(cleanup, duration + 800);
    const vt = document.startViewTransition(applyFn);
    // ★ 一次切换还没走完就又切了一次时，浏览器会**跳过**前一次并让它的 promise 以 AbortError 拒绝；
    //   那是正常的（连点两下 ◐ 就是这样），但必须接住，否则页面上会多一条"未处理的 promise 拒绝"。
    const swallow = () => { /* 被新的切换接管：什么都不用做 */ };
    if (vt.ready && typeof vt.ready.catch === 'function') vt.ready.catch(swallow);
    if (vt.updateCallbackDone && typeof vt.updateCallbackDone.catch === 'function') vt.updateCallbackDone.catch(swallow);
    if (vt.finished && typeof vt.finished.then === 'function') vt.finished.then(cleanup, cleanup);
    return true;
  } catch {
    if (styleEl) { try { styleEl.remove(); } catch { /* 忽略 */ } }
    try { applyFn(); } catch { /* 忽略 */ }
    return false;
  }
}

/**
 * 播 themeBoot 留下的那次跨页切换（由 themeBoot 在**首绘之后**调用，见 src/themeBoot.js）。
 * 没有待播切换时什么也不做（例如直接打开本页、或主题本来就一样）。
 */
export function finishPendingTheme({ duration = SWEEP_MS } = {}) {
  const sw = pending || takePending();
  pending = null;
  if (!sw) return null;
  return switchTo(sw.to, { duration, fromId: sw.from });
}

// ★ 切账号（登录 / 注册 / 退出：userScope.rememberAuth / forgetAuth 会广播）→
//   本页主题可能属于另一个账号（例如页面先按访客主题画完，随后 /auth/me 才认了身份）→ 立刻重解析。
try {
  onScopeChange(() => {
    const want = resolvePageMode().mode;
    if (themeIdOf(want) === paintedThemeId() && want === mode) return;
    switchTo(want, {});
  });
} catch { /* 订阅失败不影响主题本身 */ }

// 调色板变体：在深色下提亮实体色（饱和度 +12%、明度 +8%）
export function entityColor(hex, theme = currentTheme()) {
  if (!theme || theme.id !== 'dark' || !hex || !hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return hex;
  const d = mx - mn;
  const s = l < 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  const ns = Math.min(1, s * theme.entitySatBoost);
  const nl = Math.min(1, l + theme.entityLightBoost);
  return hslToHex(hueOf(r, g, b), ns, nl);
}

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  if (mx === r) return (60 * ((g - b) / d) + 360) % 360;
  if (mx === g) return 60 * ((b - r) / d) + 120;
  return 60 * ((r - g) / d) + 240;
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
