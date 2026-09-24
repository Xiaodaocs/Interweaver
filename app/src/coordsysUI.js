// ③ 坐标系工具的三个子工具（用户要求）：
//   1) 创建新坐标系 —— 武装放置工具（点画布落一个坐标系），即原来的行为
//   2) 坐标系视图   —— 选择显示/隐藏哪些坐标系；支持隐藏「世界坐标系」（画布主网格），甚至全部隐藏
//   3) 坐标系管理   —— 删除坐标系；把当前选中的实体放入某个坐标系，**或同时放入两个坐标系**
//
// 实现约定：视图/管理面板都渲染到左上角操作弹窗 #opPop（与既有「单卡片操作统一在左上弹窗」一致，
// 自动获得统一毛玻璃、统一滑入动画与"不用时收回"），三选项菜单则贴在底部工具条之上浮动。
import { getSetting, setSetting } from './settings.js';
import { isMemberOf } from './entities.js';
import { showCard, hideCard } from './windows.js';

const CS_TYPE = 'coordsys';

export function createCoordsysUI({ st, cam, S, hooks = {} }) {
  const menu = document.getElementById('csMenu');
  // 用独立卡片：panel.js 会按「有没有向导」收起 #opPop，共用会互相打架
  const csPanel = document.getElementById('csPanel');
  const opBody = document.getElementById('csPanelBody');
  const opTitle = document.getElementById('csPanelTitle');
  const hint = (m) => hooks.hint?.(m);

  const allCs = () => [...st.entities.values()].filter((e) => e.type === CS_TYPE);
  const labelOf = (e) => e.label || e.id;
  const redraw = () => hooks.redraw?.();

  // ---------- 三选项菜单 ----------
  let menuOpen = false;
  // ★ 必须走统一的 showCard/hideCard：菜单在 HTML 里带了 data-slide="up"，
  //   而 .win[data-slide="up"] 含 opacity:0 —— 只把 hidden 置 false 的话菜单会**完全透明**（实测 opacity=0，用户看不见）。
  function showMenu() { menuOpen = true; showCard(menu, 'up'); }
  function hideMenu() { menuOpen = false; hideCard(menu); }
  function toggleMenu() { if (menuOpen) hideMenu(); else showMenu(); }
  const isMenuOpen = () => menuOpen;

  // ---------- 视图面板：显示 / 隐藏 ----------
  function renderView() {
    const csList = allCs();
    const worldHidden = !getSetting('grid');
    opTitle.textContent = '坐标系视图';
    opBody.innerHTML = [
      '<div class="paneHint" style="text-align:left;padding:2px 2px 8px">勾选＝显示。可以隐藏世界坐标系（画布主网格），也可以全部隐藏。</div>',
      '<label class="setRow2"><input type="checkbox" data-world' + (worldHidden ? '' : ' checked') + '><span class="setLabel">世界坐标系（画布主网格）</span></label>',
      csList.length
        ? csList.map((c) => '<label class="setRow2"><input type="checkbox" data-cs="' + c.id + '"' + (c.visible === false ? '' : ' checked') + '><span class="setLabel">⌖ ' + labelOf(c) + '</span></label>').join('')
        : '<div class="paneHint" style="text-align:left;padding:6px 2px">还没有坐标系。</div>',
      '<div class="csBtnRow">',
      '  <button class="addBtn" data-act="allOn">全部显示</button>',
      '  <button class="addBtn" data-act="allOff">全部隐藏</button>',
      '</div>',
    ].join('');
    opBody.querySelector('[data-world]')?.addEventListener('change', (e) => {
      setSetting('grid', e.target.checked);       // 世界坐标系 = 画布主网格
      redraw();
      hint(e.target.checked ? '✦ 已显示世界坐标系（主网格）' : '✦ 已隐藏世界坐标系（主网格）');
    });
    for (const cb of opBody.querySelectorAll('[data-cs]')) {
      cb.addEventListener('change', () => {
        const cs = st.entities.get(cb.dataset.cs);
        if (!cs) return;
        cs.visible = cb.checked;
        redraw();
        hint((cb.checked ? '✦ 已显示 ' : '✦ 已隐藏 ') + labelOf(cs));
      });
    }
    opBody.querySelector('[data-act="allOn"]')?.addEventListener('click', () => {
      for (const c of allCs()) c.visible = true;
      setSetting('grid', true);
      redraw(); renderView();
      hint('✦ 已显示全部坐标系');
    });
    opBody.querySelector('[data-act="allOff"]')?.addEventListener('click', () => {
      for (const c of allCs()) c.visible = false;
      setSetting('grid', false);
      redraw(); renderView();
      hint('✦ 已隐藏全部坐标系（含世界坐标系）');
    });
    showCard(csPanel, 'tl');
  }

  // ---------- 管理面板：删除 + 归属（可同时属于两个） ----------
  function renderManage() {
    const csList = allCs();
    const sel = [...st.selection].map((id) => st.entities.get(id)).filter(Boolean);
    const membersOf = (csId) => [...st.entities.values()].filter((e) => e.type !== CS_TYPE && isMemberOf(e, csId));
    opTitle.textContent = '坐标系管理';
    const rows = csList.map((c) => {
      const n = membersOf(c.id).length;
      return [
        '<div class="csRow" data-row="' + c.id + '">',
        '  <div class="csRowTop"><b>⌖ ' + labelOf(c) + '</b><span class="csCount">' + n + ' 个图形</span>',
        '    <button class="addBtn csDel" data-del="' + c.id + '">删除</button></div>',
        '  <div class="csBtnRow">',
        sel.length
          ? '    <button class="addBtn" data-put="' + c.id + '">把选中的 ' + sel.length + ' 个放入</button>' +
            '    <button class="addBtn" data-add="' + c.id + '">同时加入（保留原归属）</button>'
          : '    <span class="paneHint" style="padding:0">先在画布上选中实体，这里就能把它们放入该坐标系</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    opBody.innerHTML = (csList.length ? rows : '<div class="paneHint" style="text-align:left;padding:6px 2px">还没有坐标系。先用「创建新坐标系」放一个。</div>')
      + (sel.length ? '<div class="paneHint" style="text-align:left;padding:8px 2px 0">当前选中：' + sel.map((e) => e.label || e.id).join('、') + '</div>' : '');

    for (const b of opBody.querySelectorAll('[data-del]')) {
      b.addEventListener('click', () => {
        const r = S.removeCoordsys(st, b.dataset.del);
        if (r.error) { hint('⚠ ' + r.error); return; }
        redraw(); renderManage();
        hint('✦ 已删除该坐标系（成员图形保留，共解绑 ' + r.unassigned + ' 个）');
      });
    }
    for (const b of opBody.querySelectorAll('[data-put]')) {
      b.addEventListener('click', () => {
        const ids = [...st.selection];
        const r = S.assignCoordsys(st, ids, b.dataset.put);
        if (r.error) { hint('⚠ ' + r.error); return; }
        redraw(); renderManage();
        hint('✦ 已把 ' + r.n + ' 个图形放入该坐标系（原有归属被替换）');
      });
    }
    for (const b of opBody.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => {
        const ids = [...st.selection];
        const r = S.assignCoordsys(st, ids, b.dataset.add, { add: true });
        if (r.error) { hint('⚠ ' + r.error); return; }
        redraw(); renderManage();
        hint('✦ 已把 ' + r.n + ' 个图形**同时**加入该坐标系（保留原有归属 → 可同时属于两个）');
      });
    }
    showCard(csPanel, 'tl');
  }

  document.getElementById('csPanelClose')?.addEventListener('click', () => hideCard(csPanel));

  // ---------- 菜单按钮 ----------
  if (menu) {
    menu.querySelector('[data-csact="create"]')?.addEventListener('click', () => {
      hideMenu();
      hooks.setTool?.('coordsys');
      hint('✦ 在画布上点一下即可建立坐标系');
    });
    menu.querySelector('[data-csact="view"]')?.addEventListener('click', () => { hideMenu(); renderView(); });
    menu.querySelector('[data-csact="manage"]')?.addEventListener('click', () => { hideMenu(); renderManage(); });
  }
  // 点别处收起菜单
  document.addEventListener('click', (e) => {
    if (!menuOpen) return;
    if (e.target.closest && (e.target.closest('#csMenu') || e.target.closest('#toolbar'))) return;
    hideMenu();
  });

  return { toggleMenu, showMenu, hideMenu, isMenuOpen, renderView, renderManage };
}
