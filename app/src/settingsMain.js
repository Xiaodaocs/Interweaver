// 设置页（用户要求 ⑦：单独页面、精致、四分区、所有设置及时生效）
//
// 实现方式：**数据驱动** —— 界面完全由 settings.js 的 SETTINGS_SCHEMA / GROUPS 生成，
// 不复制一份键表（避免"页面写一个键、工作台读另一个键"的分裂）。
// 每次改动立即 setSetting(...) 落盘并通知；工作台通过 storage 事件即时应用（见 settings.js）。
//
// ★ 本轮两项修改（用户要求）：
//   ① 颜色同步：以前 settings.html 里写死 data-theme="light"，而且**从不调用 initTheme()** ——
//      工作台切到深色，设置页仍然是白的。现在启动即 initTheme()（读同一个键 interweaver.theme），
//      "显示模式"改动后立刻重新应用，跟随系统时也监听系统深浅色切换。
//   ② 布局：分类独立成**左侧一栏**，右侧显示该分类的具体设置（原来是全部竖着堆在一起）。
import { createAccountPanel } from './accountPanel.js';
import { SETTINGS_SCHEMA, GROUPS, getSetting, setSetting, resetSettings, allSettings } from './settings.js';
import { initTheme, setTheme } from './theme.js';

const wrap = document.getElementById('setWrap');
const back = document.getElementById('setBack');
const reset = document.getElementById('setReset');

// ① 主题：与工作台共用同一个存储键（theme.js 的 interweaver.theme）与同一套应用逻辑
// 以设置库里的 themeMode 为准，写进 theme.js 的同一个键（两边从此一致）
setTheme(String(getSetting('themeMode')));
initTheme();

// ★ 用户本轮要求：删掉设置页的星空背景（成就页那份上一轮已删）。整段已移除。


/** 一个设置项 → 一行控件 */
function rowHTML(s) {
  const v = getSetting(s.key);
  if (s.type === 'bool') {
    return '<label class="setRow2">'
      + '<input type="checkbox" data-sk="' + s.key + '"' + (v ? ' checked' : '') + '>'
      + '<span class="setLabel">' + s.label + '</span>'
      + '</label>';
  }
  const opts = (s.options || []).map((o) => '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>'
    + ({ light: '浅色', dark: '深色', system: '跟随系统' }[o] || o) + '</option>').join('');
  return '<label class="setRow2">'
    + '<span class="setLabel">' + s.label + '</span>'
    + '<select class="setSelect" data-sk="' + s.key + '">' + opts + '</select>'
    + '</label>';
}

let current = GROUPS[0].id;
let accEl = null;   // 「账号与后端」卡的节点（跨 render 复用，避免输入被清空 / 重复探测）

function render() {
  // ② 左侧分类栏 + 右侧具体设置
  const nav = GROUPS.map((g) => {
    const items = SETTINGS_SCHEMA.filter((s) => s.group === g.id);
    const changed = items.filter((s) => getSetting(s.key) !== s.def).length;
    return '<button class="setNavItem' + (g.id === current ? ' on' : '') + '" data-goto="' + g.id + '">'
      + '<span class="setNavLabel">' + g.label + '</span>'
      + (changed ? '<span class="setNavDot" title="' + changed + ' 项已改动"></span>' : '')
      + '</button>';
  }).join('');
  const g = GROUPS.find((x) => x.id === current) || GROUPS[0];
  const items = SETTINGS_SCHEMA.filter((s) => s.group === g.id);
  const body = '<section class="setSec" data-group="' + g.id + '">'
    + '<h3>' + g.label + '<span class="setSecHint">' + items.length + ' 项 · 改动立即生效</span></h3>'
    + items.map(rowHTML).join('')
    + '</section>';
  wrap.innerHTML = '<div class="setLayout"><nav class="setNav">' + nav + '</nav><div class="setBody">' + body + '</div></div>';
  // 左侧分类切换
  wrap.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => { current = el.dataset.goto; render(); });
  });
  // ★ 前后端分离：在「通用」分类最上面放一张"账号与后端"卡
  //   （登录/注册、连接状态；连不上时把**详细报错**原样贴出来；登录后自动导入本机旧数据）
  //   ★ 注意：render() 每次都用 innerHTML 重建右栏 —— 所以这里**只创建一次**，之后每次
  //     把**同一个 DOM 节点**重新插进去（否则输入框内容会被清空、还会反复探测后端造成闪烁）。
  if (g.id === (GROUPS[0] && GROUPS[0].id)) {
    const host = wrap.querySelector('.setBody');
    if (host) {
      if (!accEl) accEl = createAccountPanel({ mount: document.createElement('div') }).el;
      host.insertBefore(accEl, host.firstChild);
    }
  }
  // 绑定：改动 → 立即写盘（单一事实来源）
  wrap.querySelectorAll('[data-sk]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.sk;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      setSetting(key, val);
      el.classList.add('justChanged');
      setTimeout(() => el.classList.remove('justChanged'), 420);
      // ① 显示模式一改，页面颜色立刻跟着变。
      //    ★ 关键：设置项存在设置库里（settings.js），而主题存在 theme.js 的 interweaver.theme ——
      //      两套键原本**互不相通**，所以在这里把显示模式**同时写给 theme.js**
      //      （工作台的 ◐ 按钮也写这个键，于是两边彻底一致）。
      if (key === 'themeMode') { setTheme(String(val)); }
      // 重新渲染：左侧"已改动"小圆点要跟着更新（等刚才的高亮动画走完再重绘）
      setTimeout(() => render(), 480);
    });
  });
}

reset.addEventListener('click', () => { resetSettings(); setTheme(String(getSetting('themeMode'))); render(); });
back.addEventListener('click', () => { window.location.href = './index.html'; });

render();
// 跟随系统时，系统切换深浅色 → 页面同步
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => initTheme());
} catch { /* 老浏览器忽略 */ }
// 供验收脚本读取当前页面的设置快照
window.__SET = { all: allSettings, set: setSetting, schema: SETTINGS_SCHEMA, groups: GROUPS };
