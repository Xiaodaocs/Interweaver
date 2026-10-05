import { showCard, hideCard } from './windows.js';
// 预设库抽屉：拖出到落点放置 / 纯点击放到视野中心（DOM 模块）
import { PRESETS, createFromPreset, presetExtra } from './entities.js';
import { RECIPES, presetExtraWithExpr } from './presetRecipes.js';
import * as S from './state.js';

export function createPresetDock(st, cam, canvas, hooks = {}) {
  const dock = document.getElementById('presetDock');
  let open = false;
  let drag = null; // { preset, downX, downY }

  dock.innerHTML = `<h4>预设库 · 拖到画布</h4>` + PRESETS.map((p, i) => `
    <div class="presetItem" data-pi="${i}">
      <svg viewBox="0 0 20 18"><path d="${p.icon}"/></svg>
      <span>${p.name}<small>${p.desc}</small></span>
    </div>`).join('');

  function toggle(show) {
    open = show ?? !open;
    // ⑧ 统一滑动动画 + ② 从**屏幕左下角**滑出（不再直接切 hidden，那样没有动画）
    if (open) showCard(dock, 'left');
    else hideCard(dock);
  }

  dock.querySelectorAll('[data-pi]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      drag = { preset: PRESETS[Number(el.dataset.pi)], downX: e.clientX, downY: e.clientY };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // 仅当指针悬于画布本体之上时显示放置预览
      if (document.elementFromPoint(e.clientX, e.clientY) === canvas) {
        const r = canvas.getBoundingClientRect();
        const w = cam.s2w(e.clientX - r.left, e.clientY - r.top);
        st.ghost = { type: drag.preset.type, params: createFromPreset(drag.preset, w), extra: presetExtra(drag.preset, w), at: w };
      } else {
        st.ghost = null;
      }
      S.emit(st);
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const preset = drag.preset;
      const moved = Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 6;
      drag = null;
      st.ghost = null;
      const elAt = document.elementFromPoint(e.clientX, e.clientY);
      if (!moved) {
        // 纯点击 → 放到视野中心
        place(preset, { x: cam.x, y: cam.y });
      } else if (elAt === canvas) {
        const r = canvas.getBoundingClientRect();
        place(preset, cam.s2w(e.clientX - r.left, e.clientY - r.top));
      }
      // 落在面板/其他 UI 上 → 视为取消放置
      S.emit(st);
    });
  });

  function place(preset, at) {
    // 复合预设（"预织网"）：一次生成多个实体 + 预置绑定
    if (preset.type === 'composite') {
      const r = RECIPES[preset.key]?.(st, at);
      if (r) {
        hooks.hint?.(`✦ 已放下「${preset.name}」：打开左下「连接视图」看它内部的绑定网${r.variable ? `，拖 ${r.variable} 的滑杆即可联动` : ''}`);
      }
      hooks.onPlaced?.();
      return;
    }
    const params = createFromPreset(preset, at);
    // ★ A 方案：与函数生成器共用同一条「定义域=当前视野」规则（func 类预设，如阻尼振荡）
    if (preset.type === 'func') {
      const [dmin, dmax] = S.viewDomainX(cam);
      params.dmin = dmin; params.dmax = dmax;
    }
    const extra = presetExtraWithExpr(preset, at, presetExtra(preset, at));
    const ent = S.addEntity(st, preset.type, params, extra);
    st.selection = new Set([ent.id]);
    S.emit(st, 'selection');
    hooks.onPlaced?.(ent); // 放完一个预设就回到鼠标模式
  }

  return { toggle, isOpen: () => open };
}
