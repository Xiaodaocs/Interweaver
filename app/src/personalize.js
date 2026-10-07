// 「个性化」（用户要求）：设置里新增一个分类，管两件事 ——
//
//   ① **每个页面各自的深色/浅色**：数据与解析全部在 theme.js（唯一事实来源），
//      本模块只负责 ⑴「设置 → 个性化」里的界面 ⑵ 页面清单。
//      页面清单不是写死的四五个名字：已知页面给中文名，**本机出现过的页面键**（localStorage 里
//      真实存在的 interweaver.pagetheme.<id>）与"当前页"都自动进列表 ——
//      以后新增 xxx.html（本轮就有「我的」）不改这里也能被单独设置。
//
//   ② **画布实体的颜色**（★ 用户本轮收紧了口径）：
//      只在设置里按**实体类型**设默认色 —— interweaver.entitycolors.v1（按账号分键，见 userScope）；
//      **选中单个实体的属性面板不再提供改色**（panel.js 里那块 UI 已按用户要求撤掉）。
//      历史兼容：实体上的 colorUser 字段仍然认（老场景/老草稿里可能已经写着），
//      解析顺序（effectiveColor）：colorUser（旧数据）→ 类型默认色 → 建实体时分的调色板色。
//      ★ 没有任何自定义时，第三档就是改动前的行为 —— 画面逐像素不变，老场景的颜色也原样。
//      界面上这一大块收在「颜色详细定制」折叠里（默认不展开，展开后列表自带滚动条）。
//
//   调色板是**预设色**（用户要求：不要自由输入框）：每个色都实测过在深、浅两套纸面上的
//   对比度（见 tests/check-personalize.mjs 的对比度一节，全部 ≥ 3:1），所以两套主题下都看得清。
import { REGISTRY } from './entities.js';
import { readUserValue, writeUserValue, removeUserValue, currentUserId, onScopeChange } from './userScope.js';
import {
  pageIdOf, pageThemeKey, currentPageId, resolvePageMode, reapplyPageTheme, setGlobalTheme,
  globalMode, THEMES, currentTheme,
} from './theme.js';

const COLOR_KEY = 'interweaver.entitycolors.v1';   // { <实体类型>: '#RRGGBB' }

/** 预设色板（名字 → 十六进制）。每个都与深浅两套纸面 ≥3:1（实测，勿凭感觉改） */
export const PALETTE = [
  { hex: '#5E5CE6', name: '靛蓝' },
  { hex: '#0A84FF', name: '天蓝' },
  { hex: '#2E9E4F', name: '青草' },
  { hex: '#0F9B8E', name: '湖绿' },
  { hex: '#C25E00', name: '琥珀' },
  { hex: '#E5484D', name: '朱红' },
  { hex: '#D6336C', name: '品红' },
  { hex: '#BF5AF2', name: '紫罗兰' },
  { hex: '#A2845E', name: '岩棕' },
  { hex: '#7C7C82', name: '石墨' },
];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 已知页面的中文名（只是**显示名**；页面本身仍由路径自动识别，不在这里注册） */
const PAGE_LABELS = { index: '画布', starmap: '成就 · 星图', settings: '设置', login: '登录', mine: '我的' };

// ---------- ① 页面清单 ----------
function lsKeys() {
  const out = [];
  try {
    if (typeof localStorage === 'undefined') return out;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); }
  } catch { /* 隐私模式 */ }
  return out;
}

/**
 * 可以单独设显示模式的页面：已知页面（按固定顺序）+ 本机真实出现过的页面键 + 当前页。
 * 键名可能是命名空间化的（interweaver.u7.pagetheme.starmap）→ 统一取出页面 id。
 */
export function knownPages() {
  const ids = Object.keys(PAGE_LABELS);
  const seen = new Set(ids);
  const extra = [];
  for (const k of lsKeys()) {
    const m = /^interweaver\.(?:u\d+\.)?pagetheme\.([a-z0-9_-]+)$/.exec(k);
    if (m && !seen.has(m[1])) { seen.add(m[1]); extra.push(m[1]); }
  }
  if (!seen.has(currentPageId())) extra.push(currentPageId());
  return ids.concat(extra).map((id) => ({ id, label: PAGE_LABELS[id] || id, current: id === currentPageId() }));
}

/** 某页当前的设置状态：'' = 跟随全局默认 */
export function pageModeSetting(pageId) {
  const key = pageThemeKey(pageId);
  let v = null;
  try { v = readUserValue(key); } catch { v = null; }
  return (v === 'dark' || v === 'light' || v === 'system') ? v : '';
}

/** 写某页的显示模式（'' = 回到"跟随全局默认"）；改的是本页就立即生效并播横扫 */
export function setPageMode(pageId, mode) {
  const id = pageIdOf(pageId);
  try {
    if (mode === 'dark' || mode === 'light' || mode === 'system') writeUserValue(pageThemeKey(id), mode);
    else removeUserValue(pageThemeKey(id));
  } catch { /* 存储不可用：至少界面即时反馈 */ }
  if (id === currentPageId()) reapplyPageTheme();
  return pageModeSetting(id);
}

// ---------- ② 实体颜色 ----------
let colorCache = null;
function readColorMap() {
  if (colorCache) return colorCache;
  const out = {};
  let raw = null;
  try { raw = readUserValue(COLOR_KEY); } catch { raw = null; }
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        for (const k of Object.keys(obj)) if (HEX_RE.test(String(obj[k]))) out[k] = String(obj[k]);
      }
    } catch { /* 坏数据当没有（不猜） */ }
  }
  colorCache = out;
  return out;
}
function writeColorMap(map) {
  colorCache = { ...map };
  try {
    if (Object.keys(map).length) writeUserValue(COLOR_KEY, JSON.stringify(map));
    else removeUserValue(COLOR_KEY);
  } catch { /* 忽略：失败时内存里的那份仍然生效 */ }
}

/** 全部类型默认色（拷贝） */
export function typeColors() { return { ...readColorMap() }; }

// ★ 切账号（登录/注册/退出）→ 颜色缓存必须作废：否则账号 B 打开页面时，
//   画布与设置页会先按账号 A 的"类型默认色"上色（缓存里那份是 A 的）。
//   theme.js 那边没有这个问题（它每次都按当前命名空间重新解析，没有缓存）。
try { onScopeChange(() => { colorCache = null; }); } catch { /* 订阅失败不影响读写 */ }

/** 某一类实体的默认色；没设过 → null（画面回落到 ent.color，与改动前一致） */
export function typeColor(type) { return readColorMap()[type] || null; }

/** 设/清某一类实体的默认色（null 或非法值 = 清除） */
export function setTypeColor(type, hex) {
  const map = { ...readColorMap() };        // 拷贝一份再改：不就地改动缓存对象
  if (hex && HEX_RE.test(String(hex))) map[type] = String(hex);
  else delete map[type];
  writeColorMap(map);
  return map[type] || null;
}

/**
 * 一个实体**最终**画成什么色：单个自定义 → 类型默认 → 建实体时分的调色板色。
 * 返回 null 表示"没有自定义"，调用方用 ent.color（保持老行为）。
 */
export function effectiveColor(ent) {
  if (!ent) return null;
  if (ent.colorUser && HEX_RE.test(String(ent.colorUser))) return ent.colorUser;
  const t = typeColor(ent.type);
  return t || null;
}

/** 实体类型的显示名（问注册表，不抄一份表；以后新增类型自动有名字） */
export function typeLabel(type) {
  const def = REGISTRY[type];
  return (def && def.label) || type;
}

/** 画布上所有可单独设色的实体类型（按注册表顺序 = 与代码里的定义顺序一致） */
export function typeList() { return Object.keys(REGISTRY); }

// ---------- 恢复默认（设置页的「恢复默认」按钮用） ----------
/**
 * 清掉**当前账号**的全部个性化：逐页主题覆盖 + 全局默认 + 类型默认色。
 * 清完"跟随全局默认"就又回到出厂状态（成就页深色、其它页面浅色）。
 * ★ 只动当前命名空间（removeUserValue 按账号分键）——"恢复默认"是"我的设置回出厂"，
 *   绝不能顺手把别的账号在这台机器上的偏好也删了。
 */
export function resetPersonalize() {
  const ids = new Set(knownPages().map((p) => p.id));
  for (const k of lsKeys()) {
    const m = /^interweaver\.(?:u\d+\.)?pagetheme\.([a-z0-9_-]+)$/.exec(k);
    if (m) ids.add(m[1]);
  }
  for (const id of ids) { try { removeUserValue(pageThemeKey(id)); } catch { /* 忽略 */ } }
  try { removeUserValue('interweaver.theme'); } catch { /* 忽略 */ }
  try { removeUserValue(COLOR_KEY); } catch { /* 忽略 */ }
  colorCache = null;
  return true;
}

// ---------- 「设置 → 个性化」的界面 ----------
const MODE_TEXT = { '': '跟随全局默认', dark: '深色', light: '浅色', system: '跟随系统' };
// 「颜色详细定制」是否展开（默认收起，用户要求）。整块 HTML 每次改动后会重建，
// 所以展开状态必须存在模块里，否则用户点开花板、一改就又收回去。
let moreOpen = false;

function modeOptions(sel, allowFollow = true) {
  const list = allowFollow ? ['', 'dark', 'light', 'system'] : ['dark', 'light', 'system'];
  return list.map((v) => `<option value="${v}"${v === sel ? ' selected' : ''}>${MODE_TEXT[v]}</option>`).join('');
}

function swatches(kind, current) {
  const buf = [`<button data-iw-swatch="" data-iw-kind="${kind}"${current ? '' : ' data-iw-on=""'} title="跟随类型默认">默认</button>`];
  for (const p of PALETTE) {
    buf.push(`<button data-iw-swatch="${p.hex}" data-iw-kind="${kind}" title="${p.name} ${p.hex}"`
      + `${p.hex === current ? ' data-iw-on=""' : ''} style="background:${p.hex}"></button>`);
  }
  return `<span data-iw-swatches>${buf.join('')}</span>`;
}

/**
 * 生成「个性化」分类的整块 HTML（settingsMain.js 把它放进右栏）。
 * 状态一律走 data 属性（项目有双向类契约普查：新类名要么同时出现在 DOM 与样式表里，要么别用）。
 */
export function renderPersonalizeSection() {
  const g = globalMode();
  const gText = g ? MODE_TEXT[g] : '未设置（各页按出厂默认：成就页深色、其它浅色）';
  const pages = knownPages().map((p) => {
    const sel = pageModeSetting(p.id);
    const src = resolvePageMode(p.id);
    return '<div class="setRow2">'
      + `<span class="setLabel">${p.label}${p.current ? '（本页）' : ''}`
      + `<span class="setSecHint">${sel ? MODE_TEXT[sel] : '跟随全局默认 · 当前 ' + MODE_TEXT[src.mode]}</span></span>`
      + `<select class="setSelect" data-iw-page="${p.id}">${modeOptions(sel)}</select>`
      + '</div>';
  }).join('');
  const colors = readColorMap();
  const kinds = typeList().map((t) => {
    const cur = colors[t] || '';
    return '<div class="setRow2">'
      + `<span class="setLabel">${typeLabel(t)}<span class="setSecHint">${cur || '未自定义'}</span></span>`
      + swatches(t, cur)
      + '</div>';
  }).join('');
  const changed = Object.keys(colors).length;
  return '<div data-iw-personalize="">'
    + '<div class="setRow2"><span class="setLabel">全局默认'
    + `<span class="setSecHint">没有单独设过的页面跟随它 · 当前 ${gText}</span></span>`
    + `<select class="setSelect" data-iw-global>${modeOptions(g || 'light', false)}</select></div>`
    + '<div data-iw-subhead="">每页显示模式<span class="setSecHint">各页互不影响；换账号后各是各的</span></div>'
    + pages
    // ★ 用户本轮要求（②）：颜色定制**默认不展开**，收进「颜色详细定制」；展开后列表自带滚动条
    //   （几十行逐类色板会把屏幕撑爆 —— 见 styles.css 的 [data-iw-more-body]）。
    + `<details data-iw-more${moreOpen ? ' open' : ''}>`
    + '<summary>颜色详细定制<span class="setSecHint">按实体类型设默认色（共 ' + typeList().length + ' 类'
    + (changed ? ' · 已改 ' + changed + ' 类' : '') + '）</span></summary>'
    + '<div data-iw-more-body>' + kinds + '</div>'
    + '</details>'
    + '<div data-iw-note="">颜色按**实体类型**生效：新建的、以及没单独改过色的同类实体都用它。'
    + '选中单个实体的属性面板不再提供改色。</div>'
    + '</div>';
}

/**
 * 给上面那块 HTML 绑事件。onChange 用于让调用方重绘（左栏计数/提示刷新）。
 * root 必须是包含这些 data 属性的容器（设置页的 `.setSec[data-group="personalize"]`）。
 */
export function bindPersonalizeSection(root, onChange) {
  if (!root) return;
  const done = (msg) => { try { onChange && onChange(msg); } catch { /* 订阅者自己的错不影响状态 */ } };

  root.querySelectorAll('[data-iw-page]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.iwPage;
      setPageMode(id, sel.value);
      done(`✦ ${(PAGE_LABELS[id] || id)}：${MODE_TEXT[sel.value] || sel.value}（${currentUserId() ? '本账号' : '本机访客'}）`);
    });
  });
  root.querySelectorAll('[data-iw-global]').forEach((sel) => {
    sel.addEventListener('change', () => {
      setGlobalTheme(sel.value || 'light');
      done(`✦ 全局默认：${MODE_TEXT[sel.value] || sel.value} —— 没有单独设过的页面会一起变`);
    });
  });
  root.querySelectorAll('[data-iw-swatches]').forEach((box) => {
    box.querySelectorAll('button[data-iw-swatch]').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.dataset.iwKind || '';
        const hex = b.dataset.iwSwatch || null;
        setTypeColor(kind, hex);
        done(hex ? `✦ ${typeLabel(kind)} 的默认色 = ${hex}` : `✦ ${typeLabel(kind)} 恢复默认色`);
      });
    });
  });
  // 折叠面板：记住展开状态（下次重绘时保持展开，不然每改一下就被收回去）
  const more = root.querySelector('[data-iw-more]');
  if (more) more.addEventListener('toggle', () => { moreOpen = !!more.open; });
}

/** 诊断用：当前页/解析结果/已设过的键（验收脚本据此断言"逐页 + 按账号"） */
export function personalizeDebug() {
  const keys = lsKeys().filter((k) => /pagetheme|entitycolors/.test(k));
  return {
    page: currentPageId(),
    resolved: resolvePageMode(),
    globalMode: globalMode(),
    themeId: currentTheme().id,
    paper: currentTheme().paper,
    pages: knownPages().map((p) => p.id),
    typeColors: typeColors(),
    keys,
    availableThemes: Object.keys(THEMES),
  };
}
