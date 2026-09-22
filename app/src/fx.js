// 函数创作器：左下角弹出面板（点击工具栏 ƒx 打开，生成后自动收起）
import * as S from './state.js';
import { parseEquation, freeLetters } from './expr.js';

export function createFxDock(st, hooks = {}) {
  const dock = document.getElementById('fxDock');
  const draft = { text: '', free: [] };
  let open = false;

  dock.innerHTML = `
    <div class="fxHead">
      <b>函数创作</b>
      <button id="fxClose" title="收起">×</button>
    </div>
    <input class="fxInput" id="fxInput" placeholder="y = 2x + 3，或 2x+3=y，或 sin(x)" spellcheck="false">
    <div class="fxErr" id="fxErr"></div>
    <div class="fxChips" id="fxChips"></div>
    <button class="addBtn fxGo" id="fxGo">在画布上生成图像</button>
    <div class="fxTip">未知字母会提示建滑杆；已定义变量（如 a）可直接用，曲线随滑杆实时变化。</div>
  `;

  const input = dock.querySelector('#fxInput');
  const err = dock.querySelector('#fxErr');
  const chips = dock.querySelector('#fxChips');
  let ast = null;

  function analyze() {
    err.textContent = ''; chips.innerHTML = ''; ast = null;
    const src = input.value.trim();
    if (!src) return;
    try {
      const eq = parseEquation(src);
      ast = eq.ast;
      draft.implicit = eq.kind === 'implicit';
      draft.fSrc = eq.fSrc || null;
      // 隐函数里 x、y 是**坐标**而不是待建滑杆的未知量 → 与显函数排除 x 同理，把两者都视为已定义。
      const defined = new Set(st.variables.keys());
      if (draft.implicit) { defined.add('x'); defined.add('y'); }
      draft.free = freeLetters(ast, defined);
      chips.innerHTML = draft.free.map((f) => `<button class="chip" data-chip="${f}">＋ 为 ${f} 创建滑杆</button>`).join('');
      chips.querySelectorAll('[data-chip]').forEach((c) => {
        c.addEventListener('click', () => {
          S.addVariable(st, c.dataset.chip, { value: 1, min: 0, max: 10 });
          c.classList.add('done');
          c.textContent = `✓ ${c.dataset.chip} 已就绪`;
          analyze();
        });
      });
    } catch (e) {
      err.textContent = e.message;
    }
  }

  function generate() {
    analyze();
    if (!ast) {
      if (!input.value.trim()) err.textContent = '先输入一个表达式';
      return;
    }
    if (draft.free.length) {
      err.textContent = `还有未定义的量：${draft.free.join('、')}——点上方芯片创建滑杆`;
      return;
    }
    const cam = hooks.getCamera?.();
    const w0 = cam ? cam.s2w(0, 0).x : -30;
    const w1 = cam ? cam.s2w(cam.size().w, 0).x : 30;
    const ent = draft.implicit
      ? S.addEntity(st, 'implicit', {}, { expr: draft.fSrc || input.value.trim(), ast })
      : S.addEntity(st, 'func',
        { dmin: Math.floor(w0), dmax: Math.ceil(w1) },
        { exprSrc: input.value.trim(), ast });
    st.selection = new Set([ent.id]);
    draft.text = '';
    input.value = ''; err.textContent = ''; chips.innerHTML = '';
    S.emit(st, 'selection');
    hide();                       // 生成后自动收起
    hooks.onGenerated?.(ent);     // 并回到鼠标模式
  }

  input.addEventListener('input', () => { draft.text = input.value; analyze(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generate();
    if (e.key === 'Escape') hide();
  });
  dock.querySelector('#fxGo').addEventListener('click', generate);
  dock.querySelector('#fxClose').addEventListener('click', () => { hide(); hooks.onClosed?.(); });

  function show() {
    open = true;
    dock.hidden = false;
    input.value = draft.text;
    input.focus();
    analyze();
  }
  function hide() {
    open = false;
    dock.hidden = true;
  }
  function toggle() { if (open) { hide(); hooks.onClosed?.(); } else show(); }

  return { show, hide, toggle, isOpen: () => open };
}
