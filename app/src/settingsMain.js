// 设置页（用户要求 ⑦：单独页面、精致、四分区、所有设置及时生效）
//
// 实现方式：**数据驱动** —— 界面完全由 settings.js 的 SETTINGS_SCHEMA / GROUPS 生成，
// 不复制一份键表（避免"页面写一个键、工作台读另一个键"的分裂）。
// 每次改动立即 setSetting(...) 落盘并通知；工作台通过 storage 事件即时应用（见 settings.js）。
import { SETTINGS_SCHEMA, GROUPS, getSetting, setSetting, resetSettings, allSettings } from './settings.js';

const wrap = document.getElementById('setWrap');
const back = document.getElementById('setBack');
const reset = document.getElementById('setReset');

// 星空背景（与成就页同一做法：纯 CSS 星点，零素材）
(function stars() {
  const host = document.querySelector('.bgStars');
  if (!host) return;
  let seed = 20260914;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mk = (cnt, size, op) => {
    const d = document.createElement('i');
    const sh = [];
    for (let k = 0; k < cnt; k++) sh.push(Math.round(rnd() * 2200) + 'px ' + Math.round(rnd() * 1500) + 'px 0 ' + size + 'px rgba(255,255,255,' + op + ')');
    d.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;border-radius:50%;box-shadow:' + sh.join(',') + ';';
    host.appendChild(d);
  };
  mk(130, 1, 0.85);
  mk(45, 1.6, 0.45);
})();

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

function render() {
  wrap.innerHTML = GROUPS.map((g) => {
    const items = SETTINGS_SCHEMA.filter((s) => s.group === g.id);
    return '<section class="setSec" data-group="' + g.id + '">'
      + '<h3>' + g.label + '</h3>'
      + items.map(rowHTML).join('')
      + '</section>';
  }).join('');
  // 绑定：改动 → 立即写盘（单一事实来源）
  wrap.querySelectorAll('[data-sk]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.sk;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      setSetting(key, val);
      el.classList.add('justChanged');
      setTimeout(() => el.classList.remove('justChanged'), 420);
    });
  });
}

reset.addEventListener('click', () => { resetSettings(); render(); });
back.addEventListener('click', () => { window.location.href = './index.html'; });

render();
// 供验收脚本读取当前页面的设置快照
window.__SET = { all: allSettings, set: setSetting, schema: SETTINGS_SCHEMA, groups: GROUPS };
