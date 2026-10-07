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
//
// ★★ 再一轮（本轮用户要求）：
//   ③ **设置里删掉登录**：原来「通用」最上面那张"账号与后端"卡带内嵌登录表单（输入框 + 登录/注册按钮）
//      —— 全部移除。登录/注册/旧数据导入是**独立页面** login.html 的职责，设置里只留
//      只读状态 + 一个「打开登录页」的入口（用户要求：不要在设置里做登录）。
//   ④ **「我的」分类已整体移出设置页**：上一轮它是这里的一个分类（内容由 accountPanel.js 渲染）；
//      本轮用户要求"把「我的」从设置中单拿出来、单独成一个页面"，于是它成了独立页面 app/mine.html
//      （页头 + 账号卡 + 头像 + 云端场景，见 src/mineMain.js）。
//      ★ 设置页因此**不再 import accountPanel.js**、不再有 mine 分类、也不再挂载面板 ——
//        面板逻辑只有一处实现，不存在两份。
//      ★★ 入口也不在设置页（用户第二轮要求）：去**画布总导航栏**里找，就在「设置」旁边
//        （index.html 的 #menubar 里那个 <a class="mbTop" href="./mine.html">我的</a>）。
//        设置页从此只剩偏好设置这一件事，页头里没有、也不该有「我的」入口。
import { SETTINGS_SCHEMA, GROUPS, getSetting, setSetting, resetSettings, allSettings } from './settings.js';
import { initTheme, setGlobalTheme, globalMode, hasPageTheme, reapplyPageTheme } from './theme.js';
import { renderPersonalizeSection, bindPersonalizeSection, resetPersonalize, personalizeDebug } from './personalize.js';

// ★ 左栏 = settings.js 的 GROUPS（四个**偏好**分组）本身：键表仍是单一事实来源，
//   这里不再往里塞任何"没有偏好键的分类"（「我的」搬去 mine.html 了）。
// ★ **本轮（用户要求）：新增「个性化」** —— 它有自己的偏好数据，但**不进** settings.js 的键表：
//   那张表只放 bool/enum 的通用偏好，而个性化是"逐页显示模式"（theme.js）与
//   "每类实体的默认色"（personalize.js）：两者都按账号分键存在 userScope 命名空间里，
//   所以照「我的」的先例，只在本页把导航项接上，不抄第二份偏好表。
const NAV_GROUPS = [...GROUPS, { id: 'personalize', label: '个性化' }];

const wrap = document.getElementById('setWrap');
const back = document.getElementById('setBack');
const reset = document.getElementById('setReset');
const hintEl = document.querySelector('#setTop .setHint');

// ① 主题：本页自己那份（逐页主题）—— 解析顺序见 theme.js：
//   本页覆盖 → 全局默认 → 页面默认（成就页深色，其它浅色）。
initTheme();
// ★ 老的收敛路径保留但**不再把本页钉死**：以前这里无条件 setTheme(getSetting('themeMode'))，
//   那会立刻写下"本页覆盖"（逐页主题下等于把设置页钉在某一档）。现在只在
//   "本页还没单独设过 + 全局也还没设过 + 设置库里的值不是默认值"时，把它认成全局默认
//   （后端取回的用户数据里可能只有 themeMode 这一份）——不写任何本页覆盖。
try {
  const m = String(getSetting('themeMode'));
  if (!hasPageTheme() && globalMode() === null && m !== 'light') setGlobalTheme(m, { animate: false });
} catch { /* 设置库/存储在隐私模式下不可用时忽略 */ }

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
const PERS_HINT = '逐页显示模式 · 实体默认色（按账号保存）';

/** 个性化里改动后：给一行反馈 + 稍后重绘右栏（下拉里的"当前跟随…"说明要跟着更新） */
let persTimer = 0;
function onPersonalizeChanged(msg) {
  flashHint(msg);
  clearTimeout(persTimer);
  persTimer = setTimeout(() => { if (current === 'personalize') render(); }, 520);
}

function render() {
  // ② 左侧分类栏 + 右侧具体设置
  const nav = NAV_GROUPS.map((g) => {
    const items = SETTINGS_SCHEMA.filter((s) => s.group === g.id);
    const changed = items.filter((s) => getSetting(s.key) !== s.def).length;
    return '<button class="setNavItem' + (g.id === current ? ' on' : '') + '" data-goto="' + g.id + '">'
      + '<span class="setNavLabel">' + g.label + '</span>'
      + (changed ? '<span class="setNavDot" title="' + changed + ' 项已改动"></span>' : '')
      + '</button>';
  }).join('');
  const g = NAV_GROUPS.find((x) => x.id === current) || NAV_GROUPS[0];
  const isPers = g.id === 'personalize';
  const items = SETTINGS_SCHEMA.filter((s) => s.group === g.id);
  const body = '<section class="setSec" data-group="' + g.id + '">'
    + '<h3>' + g.label + '<span class="setSecHint">'
    + (isPers ? PERS_HINT : items.length + ' 项 · 改动立即生效') + '</span></h3>'
    + (isPers ? renderPersonalizeSection() : items.map(rowHTML).join(''))
    + '</section>';
  wrap.innerHTML = '<div class="setLayout"><nav class="setNav">' + nav + '</nav><div class="setBody">' + body + '</div></div>';
  // 左侧分类切换
  wrap.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => { current = el.dataset.goto; render(); });
  });
  // ★ 「个性化」：逐页显示模式 + 每类实体的默认色（内容由 personalize.js 生成与绑定）
  if (isPers) bindPersonalizeSection(wrap.querySelector('.setSec[data-group="personalize"]'), onPersonalizeChanged);
  // 绑定：改动 → 立即写盘（单一事实来源）
  wrap.querySelectorAll('[data-sk]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.sk;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      setSetting(key, val);
      el.classList.add('justChanged');
      setTimeout(() => el.classList.remove('justChanged'), 420);
      // ① 显示模式一改，页面颜色立刻跟着变。
      //    ★ 本轮改成 setGlobalTheme：这个下拉是**全局默认**（逐页主题见「个性化」分类）——
      //      它只写全局默认（本页没单独设过就跟着变，不会把本页钉死），
      //      而工作台的 ◐ 按钮走 theme.js 的 setTheme（本页 + 全局一起写），两边仍然一致。
      if (key === 'themeMode') { setGlobalTheme(String(val)); }
      // 重新渲染：左侧"已改动"小圆点要跟着更新（等刚才的高亮动画走完再重绘）
      setTimeout(() => render(), 480);
    });
  });
}

reset.addEventListener('click', () => {
  resetSettings();
  // ★ 个性化也一起回出厂：逐页显示模式覆盖 + 全局默认 + 每类实体默认色
  //   （只清当前账号命名空间，见 personalize.resetPersonalize 的注释）
  resetPersonalize();
  reapplyPageTheme({ animate: false });     // 清完立刻按新状态重画（恢复默认不该有过渡动画）
  render();
});
back.addEventListener('click', () => { window.location.href = './index.html'; });

/** 一行临时反馈（设置页没有专门的提示条，就借用页头那句说明，2.4s 后还原） */
const HINT_TEXT = hintEl ? hintEl.textContent : '';
let hintTimer = 0;
function flashHint(msg) {
  if (!hintEl || !msg) return;
  hintEl.textContent = msg;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintEl.textContent = HINT_TEXT; }, 2400);
}

render();
// 跟随系统时，系统切换深浅色 → 页面同步
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => initTheme());
} catch { /* 老浏览器忽略 */ }
// 供验收脚本读取当前页面的设置快照（nav = 左栏实际的分类 = 偏好分组 + 「个性化」；
// pers = 个性化诊断：当前页解析结果 / 已设过哪些键 / 类型默认色）
window.__SET = { all: allSettings, set: setSetting, schema: SETTINGS_SCHEMA, groups: GROUPS, nav: NAV_GROUPS, pers: personalizeDebug };
