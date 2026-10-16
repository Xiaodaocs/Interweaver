// 函数创作器：左下角弹出面板（点击工具栏 ƒx 打开，生成后自动收起）
import * as S from './state.js';
import { parseEquation, freeLetters, astUsesImaginary, isComplex } from './expr.js';
import { showCard, hideCard } from './windows.js';

// issue#7 第 6 条：便捷符号按钮（√ ∛ ² ³ × ÷ − π）——插入到光标处，复用既有的 .chip 芯片样式。
// ★ 类契约（tests/check-class-census.mjs）：.chip 原本**没有**样式规则（A 失灵类只要在采集里见到它就判失败，
//   本项第一次这么写时被抓到：A = 1 chip）→ 已在 styles.css 里补上 .chip / :hover / .done 三条规则；
//   行容器沿用既有且已定义的 .fxChips，按钮带 data-sym（状态一律走 data 属性）。
const QUICK_SYMS = ['√', '∛', '²', '³', '×', '÷', '−', 'π'];

export function createFxDock(st, hooks = {}) {
  const dock = document.getElementById('fxDock');
  const draft = { text: '', free: [] };
  let open = false;

  dock.innerHTML = `
    <div class="fxHead">
      <b>函数创作</b>
      <button id="fxClose" title="收起">×</button>
    </div>
    <input class="fxInput" id="fxInput" placeholder="sin x、√(x+1)、x²、arcsin x、y = 2x + 3" spellcheck="false">
    <div class="fxChips" id="fxSyms">${QUICK_SYMS.map((s) => `<button class="chip" data-sym="${s}" title="插入 ${s}">${s}</button>`).join('')}</div>
    <div class="fxErr" id="fxErr"></div>
    <div class="fxChips" id="fxChips"></div>
    <button class="addBtn fxGo" id="fxGo">在画布上生成图像</button>
    <div class="fxTip"><span id="fxNote"></span>sin x 可以不写括号；√ ∛ ² ³ × ÷ − 等符号可直接输入；常量支持 PI / E / TAU，虚数单位写 I。未知字母会提示建滑杆；已定义变量（如 a）可直接用，曲线随滑杆实时变化。</div>
  `;

  const input = dock.querySelector('#fxInput');
  const err = dock.querySelector('#fxErr');
  const chips = dock.querySelector('#fxChips');
  const note = dock.querySelector('#fxNote');
  let ast = null;

  // issue#7 第 6 条：把便捷符号插到**光标处**（再派发一次 input，复用既有 analyze，不另写一套）
  function insertSym(s) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + s + input.value.slice(end);
    const caret = start + s.length;
    input.focus();
    try { input.setSelectionRange(caret, caret); } catch { /* 某些环境下无光标 API */ }
    input.dispatchEvent(new Event('input'));
  }
  dock.querySelectorAll('#fxSyms [data-sym]').forEach((b) => {
    b.addEventListener('click', () => insertSym(b.dataset.sym));
  });

  // issue#7 第 3 条：虚数/复数的**人话提示**（不许静默）。
  //   ① 表达式里出现虚数单位 I → 直接说明；
  //   ② 否则在本视野里抽 33 个 x 探一下：真有取复数值的点（例如 sqrt(x) 的 x<0 那一段）也说明。
  function complexNote() {
    if (!ast) return '';
    if (astUsesImaginary(ast)) return '含虚数单位 I：实数平面上只画取实值的点，复数点跳过不画。';
    if (!st.scope) return '';
    const cam = hooks.getCamera?.();
    if (!cam) return '';
    const x0 = cam.s2w(0, 0).x, x1 = cam.s2w(cam.size().w, 0).x;
    let n = 0;
    for (let i = 0; i <= 32; i++) {
      const x = x0 + ((x1 - x0) * i) / 32;
      try { if (isComplex(st.scope.evalWith(ast, x))) n++; } catch { return ''; }
    }
    return n ? '这段视野里有取复数值的点（例如负数开方）：它们不画，只画取实值的部分。' : '';
  }

  function analyze() {
    err.textContent = ''; chips.innerHTML = ''; ast = null; note.textContent = '';
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
      note.textContent = complexNote();
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
    const ent = draft.implicit
      ? S.addEntity(st, 'implicit', {}, { expr: draft.fSrc || input.value.trim(), ast })
      // ★ issue#7 第 7 条：不再写死 dmin/dmax（"左右长度限制"已删除）——
      //   函数只记表达式与偏移，采样区间/密度由当前视野与 cam.z 现算。
      : S.addEntity(st, 'func', {}, { exprSrc: input.value.trim(), ast });
    st.selection = new Set([ent.id]);
    draft.text = '';
    input.value = ''; err.textContent = ''; chips.innerHTML = ''; note.textContent = '';
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
    showCard(dock, 'tl');   // 统一滑动动画（从左上角滑入）
    input.value = draft.text;
    input.focus();
    analyze();
  }
  function hide() {
    open = false;
    hideCard(dock);
  }
  function toggle() { if (open) { hide(); hooks.onClosed?.(); } else show(); }

  return { show, hide, toggle, isOpen: () => open };
}
