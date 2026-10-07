// 自研弹窗模块：彻底替代浏览器原生的三个对话框（alert / confirm / prompt）
//
// 为什么要自研（原生三件套的实际问题）：
//   · 原生弹窗会**阻塞渲染线程**：弹窗开着的时候画布停帧、星图/成就的动画全停（拖影卡住）；
//   · 样式完全不可控，和"Apple 式克制"的整体风格割裂，也塞不进 detail / kind 这类语义；
//   · 原生 prompt 不能校验（用户输错只能关掉重来）、不能多字段；
//   · 自动化验收里原生弹窗会**卡住页面**（必须由 puppeteer 手动 dismiss 才能继续）。
//
// 设计约束（项目硬性规矩，改这个文件前先读）：
//   · **零类名**：弹窗 DOM 只用 id + 标签 + data-* 属性，样式全部走 #iwDialogRoot 作用域。
//     原因是项目的"类契约"是**双向**的：DOM 用了而样式表没定义 = 失灵类；
//     样式表定义了而运行时没出现 = 死规则。而弹窗是**惰性创建**的 ——
//     类普查脚本跑的时候它根本不在 DOM 里，只要写了类就必然被判成死规则。
//   · 状态一律用 data 属性（data-kind / data-tone / data-field-row …），不造"只在某状态下才出现"的类。
//   · 惰性：模块 import 时**不碰 DOM**（模块守卫要在无 DOM 的上下文里 import 它）；
//     首次真正调用时才创建 #iwDialogRoot 骨架，并给 <body> 挂宿主标记 **data-iw-dialog**（打开期间在，关掉即摘）。
//     ★ 宿主标记必须是 **data 属性**，不能是类名：项目的"类契约"是**双向**的 ——
//       类名出现在 DOM 而样式表里没规则 = 失灵类；样式表里有规则而运行时没出现 = 死规则。
//       宿主标记只在弹窗打开期间存在，往哪一边写都会被误判；而 data 属性 / id 都不参与类契约，从根上不进那张表。
//       样式表这边一律只用 id 作用域；将来真需要"仅弹窗打开时生效"的规则，写 body[data-iw-dialog] #iwDialogRoot。
//   · 零依赖、原生 ESM、无构建步骤；本模块内**不存在**任何原生 alert / confirm / prompt 调用。
//
// API（三个主力 + 一个备用，全部 Promise 化、可排队、可 Esc）：
//   dialogAlert({ title, body, detail, kind })                    → Promise<void>
//   dialogConfirm({ title, body, detail, danger })                → Promise<boolean>
//   dialogPrompt({ title, label, value, placeholder, validate })  → Promise<string|null>
//   dialogForm({ title, fields })                                 → Promise<Record<string,string>|null>
//   另有 isDialogOpen() / dialogCloseAll() 两个调试用出口。
//
// 用法（两三行）：
//   import { dialogConfirm, dialogPrompt } from './dialog.js';
//   if (!await dialogConfirm({ title: '新建场景', body: '当前画布会被清空。', danger: true })) return;
//   const name = await dialogPrompt({ title: '另存为', label: '文件名', value: cur, validate: (v) => (v.trim() ? null : '名字不能为空') });
//
// 键盘约定：Enter = 主按钮（焦点在按钮上时按浏览器原生行为走，所以"取消"上按 Enter 仍然是取消）；
//           Esc = 取消；Tab 锁在弹窗内循环；关闭后焦点还给触发者。

const HOST_ATTR = 'iwDialog';   // 宿主标记的 data 属性名（<body data-iw-dialog>；不许写成类名，理由见文件头）

// 焦点锁的选择器：可见且未被禁用的可聚焦元素
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

let root = null;          // #iwDialogRoot（惰性创建，之后复用）
let card = null;          // #iwDialogCard
let el = null;            // 各部位引用
let bound = false;        // document 级监听是否已挂（只挂一次）
let opener = null;        // 触发者：关闭后把焦点还给它的元素
let active = null;        // 正在展示的那一条（含 spec / resolve / busy）
let fieldInputs = new Map();   // 字段名 → 输入控件（不靠选择器查，避免转义问题）
const queue = [];         // 排队中的调用：连续调用依次显示，不互相覆盖

/* ============================ 骨架（首次调用才建） ============================ */

function ensureRoot() {
  if (root && root.isConnected) return root;

  root = document.createElement('div');
  root.id = 'iwDialogRoot';
  root.hidden = true;

  const scrim = document.createElement('div');
  scrim.id = 'iwDialogScrim';
  scrim.setAttribute('aria-hidden', 'true');

  card = document.createElement('div');
  card.id = 'iwDialogCard';
  card.tabIndex = -1;                       // 无按钮时仍有可聚焦落点
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'iwDialogTitle');
  card.setAttribute('data-kind', 'info');

  const title = document.createElement('h2');
  title.id = 'iwDialogTitle';

  const main = document.createElement('div');
  main.id = 'iwDialogMain';

  const body = document.createElement('p');
  body.id = 'iwDialogBody';
  body.hidden = true;

  const detail = document.createElement('pre');
  detail.id = 'iwDialogDetail';
  detail.hidden = true;

  const fields = document.createElement('div');
  fields.id = 'iwDialogFields';
  fields.hidden = true;
  // 用户一开始改输入就撤掉旧的红字提示（否则"改对了还挂着错"很像坏了）
  fields.addEventListener('input', () => { el.err.hidden = true; el.err.textContent = ''; });

  main.append(body, detail, fields);

  const err = document.createElement('p');
  err.id = 'iwDialogError';
  err.hidden = true;
  err.setAttribute('role', 'alert');

  const foot = document.createElement('div');
  foot.id = 'iwDialogFoot';

  const cancel = document.createElement('button');
  cancel.id = 'iwDialogCancel';
  cancel.type = 'button';
  cancel.textContent = '取消';

  const ok = document.createElement('button');
  ok.id = 'iwDialogOk';
  ok.type = 'button';
  ok.textContent = '确定';

  foot.append(cancel, ok);
  card.append(title, main, err, foot);
  root.append(scrim, card);

  el = { scrim, title, main, body, detail, fields, err, foot, cancel, ok };

  // 点遮罩：alert = 确认（它没有取消可言），confirm / prompt / danger = 取消 —— 由 spec.scrim 指定
  scrim.addEventListener('click', (e) => {
    if (!active || e.target !== scrim) return;
    settleActive(active.spec.scrim === 'ok' ? 'ok' : 'cancel');
  });
  cancel.addEventListener('click', () => settleActive('cancel'));
  ok.addEventListener('click', () => { onOkClick(); });

  (document.body || document.documentElement).appendChild(root);

  if (!bound) {
    bound = true;
    // document 捕获阶段：比 main.js 的 window 冒泡监听更早，stopPropagation 之后
    // 应用自身的 Esc / 字母快捷键在弹窗打开期间**完全不响应**（模态的正确语义）。
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusIn, true);
  }
  return root;
}

/* ============================ 焦点 ============================ */

function focusables() {
  return [...card.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.getClientRects().length > 0);
}

function focusFirst() {
  const target = card.querySelector('[data-autofocus]') || el.ok;
  try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch { /* 忽略 */ } }
  // 输入框默认全选：prompt 的常见用法是"改一个已有的名字"
  if (target.hasAttribute && target.hasAttribute('data-select') && typeof target.select === 'function') {
    try { target.select(); } catch { /* 忽略 */ }
  }
}

function restoreFocus() {
  const back = opener && opener.isConnected ? opener : null;
  opener = null;
  if (!back) return;
  try { back.focus({ preventScroll: true }); } catch { try { back.focus(); } catch { /* 触发者可能已不可聚焦 */ } }
}

function onFocusIn(e) {
  if (!active || !root || root.hidden) return;
  if (root.contains(e.target)) return;
  focusFirst();          // 兜底：脚本把焦点挪到弹窗外面时拉回来
}

function trapTab(e) {
  const list = focusables();
  if (!list.length) { e.preventDefault(); card.focus(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const cur = document.activeElement;
  const inside = card.contains(cur);
  if (e.shiftKey) {
    if (!inside || cur === first || cur === card) { e.preventDefault(); last.focus(); }
  } else if (!inside || cur === last || cur === card) {
    e.preventDefault(); first.focus();
  }
}

/* ============================ 键盘 ============================ */

function onKeydown(e) {
  if (!active || !root || root.hidden) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); settleActive('cancel'); return; }
  if (k === 'Tab') { trapTab(e); e.stopPropagation(); return; }
  if (k === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target;
    // 焦点已在按钮上：交给浏览器原生激活（否则在"取消"上按 Enter 会变成"确定"）
    if (t && t.tagName === 'BUTTON') { e.stopPropagation(); return; }
    // 多行输入里回车 = 换行
    if (t && t.tagName === 'TEXTAREA') { e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
    onOkClick();
  }
}

/* ============================ 字段 ============================ */

function buildFields(fields) {
  el.fields.replaceChildren();
  fieldInputs = new Map();
  for (const f of fields) {
    const row = document.createElement('label');
    row.setAttribute('data-field-row', '');
    if (f.name) row.setAttribute('data-field-name', f.name);

    const cap = document.createElement('span');
    cap.setAttribute('data-field-label', '');
    cap.textContent = f.label || '';
    if (!f.label) cap.hidden = true;

    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = f.rows || 3;
    } else if (f.type === 'select') {
      input = document.createElement('select');
      for (const o of f.options || []) {
        const op = document.createElement('option');
        const val = (o && typeof o === 'object') ? (o.value === undefined ? o.label : o.value) : o;
        const lab = (o && typeof o === 'object') ? (o.label === undefined ? o.value : o.label) : o;
        op.value = val == null ? '' : String(val);
        op.textContent = lab == null ? '' : String(lab);
        input.appendChild(op);
      }
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
    }
    input.setAttribute('data-field-input', '');
    input.value = f.value == null ? '' : String(f.value);
    if (f.placeholder) input.placeholder = String(f.placeholder);
    if (f.maxLength) input.maxLength = Number(f.maxLength);
    if (f.autofocus) input.setAttribute('data-autofocus', '');
    if (f.select) input.setAttribute('data-select', '');

    row.append(cap, input);
    el.fields.appendChild(row);
    if (f.name) fieldInputs.set(f.name, input);
  }
}

function readFields(fields) {
  const out = {};
  for (const f of fields) {
    const i = fieldInputs.get(f.name);
    out[f.name] = i ? i.value : '';
  }
  return out;
}

function showError(text) {
  el.err.textContent = text;
  el.err.hidden = false;
  const first = card.querySelector('[data-field-input]');
  if (first) { try { first.focus({ preventScroll: true }); } catch { /* 忽略 */ } }
}

/* ============================ 主按钮 ============================ */

async function onOkClick() {
  if (!active || active.busy) return;
  const ctx = active;
  const spec = ctx.spec;
  let payload = null;

  if (spec.fields) {
    payload = readFields(spec.fields);
    if (spec.validate) {
      ctx.busy = true;
      el.ok.disabled = true;
      let msg = null;
      try {
        // prompt：把**字符串值**交给 validate（最常见）；form（多字段）：交给整条记录
        msg = await spec.validate(spec.single ? payload[spec.fields[0].name] : payload);
      } catch (e) {
        msg = '校验出错：' + ((e && e.message) || e);
      }
      if (active !== ctx) return;          // 等待校验期间被 Esc/遮罩关掉了
      ctx.busy = false;
      el.ok.disabled = false;
      if (msg && msg !== true) { showError(typeof msg === 'string' ? msg : '输入不合法'); return; }
    }
  }
  settleActive('ok', payload);
}

/* ============================ 展示 / 收起 / 排队 ============================ */

function show(ctx) {
  ensureRoot();
  const spec = ctx.spec;

  // 记住触发者：排队时上一个弹窗已经把焦点还回去了，这里拿到的正是同一个触发者
  const ae = document.activeElement;
  if (ae && ae !== document.body && !root.contains(ae)) opener = ae;

  card.setAttribute('role', spec.role);
  card.setAttribute('data-kind', spec.kind);
  if (spec.body) card.setAttribute('aria-describedby', 'iwDialogBody');
  else card.removeAttribute('aria-describedby');
  el.title.textContent = spec.title;
  if (spec.body) { el.body.textContent = spec.body; el.body.hidden = false; }
  if (spec.detail) { el.detail.textContent = spec.detail; el.detail.hidden = false; }

  el.cancel.hidden = !spec.cancelLabel;              // alert 只有一个按钮
  if (spec.cancelLabel) el.cancel.textContent = spec.cancelLabel;
  el.ok.textContent = spec.okLabel;
  if (spec.danger) {
    card.setAttribute('data-tone', 'danger');
    el.ok.setAttribute('data-tone', 'danger');
  }
  if (spec.fields && spec.fields.length) {
    buildFields(spec.fields);
    el.fields.hidden = false;
  }

  root.hidden = false;
  if (document.body) document.body.dataset[HOST_ATTR] = '1';   // 宿主标记：弹窗打开期间存在（关掉即摘，见 hide）
  focusFirst();
}

function hide() {
  if (!root) return;
  root.hidden = true;
  if (document.body) delete document.body.dataset[HOST_ATTR];   // 摘掉宿主标记：它只代表"弹窗开着"这个事实
  el.title.textContent = '';
  el.body.textContent = ''; el.body.hidden = true;
  el.detail.textContent = ''; el.detail.hidden = true;
  el.err.textContent = ''; el.err.hidden = true;
  el.fields.replaceChildren(); el.fields.hidden = true;
  fieldInputs = new Map();
  el.ok.disabled = false;
  card.setAttribute('role', 'dialog');
  card.setAttribute('data-kind', 'info');
  card.removeAttribute('aria-describedby');
  card.removeAttribute('data-tone');
  el.ok.removeAttribute('data-tone');
}

function pump() {
  if (active || !queue.length) return;
  const ctx = queue.shift();
  active = ctx;
  try {
    show(ctx);
  } catch (e) {
    // 展示失败也必须把这一条结掉，否则队列会永久卡住（后续调用全部不显示）
    active = null;
    hide();
    ctx.resolve(ctx.spec.cancelValue);
    console.error('[dialog] 展示失败：', e);
    pump();
  }
}

function settleActive(action, payload) {
  if (!active) return;
  const ctx = active;
  active = null;
  const spec = ctx.spec;
  const value = action === 'ok' ? (spec.value ? spec.value(payload) : undefined) : spec.cancelValue;
  hide();
  restoreFocus();
  ctx.resolve(value);
  pump();          // 还有排队的话，紧接着显示下一条（同一个任务里，不会闪）
}

function request(spec) {
  return new Promise((resolve) => {
    queue.push({ spec, resolve, busy: false });
    pump();
  });
}

/* ============================ 对外 API ============================ */

/** 提示（只有一个按钮）。Esc / 点遮罩 = 关掉，都 resolve(undefined)，永不 reject。 */
export function dialogAlert(opts = {}) {
  const o = opts || {};
  return request({
    role: 'alertdialog',
    kind: o.kind || 'info',                 // info | success | warn | error
    title: o.title || '提示',
    body: o.body || '',
    detail: o.detail || '',
    okLabel: o.okLabel || '知道了',
    cancelLabel: null,                      // 单按钮
    danger: false,
    scrim: 'ok',                            // alert 点遮罩 = 确认（与"原生 alert 只能确认"一致）
    value: () => undefined,
    cancelValue: undefined,
  });
}

/** 确认。主按钮 resolve(true)；取消 / Esc / 点遮罩 resolve(false)（danger 时点遮罩同样是取消）。 */
export function dialogConfirm(opts = {}) {
  const o = opts || {};
  return request({
    role: 'dialog',
    kind: o.kind || 'info',
    title: o.title || '请确认',
    body: o.body || '',
    detail: o.detail || '',
    okLabel: o.okLabel || '确定',
    cancelLabel: o.cancelLabel || '取消',
    danger: !!o.danger,                     // true → 主按钮走 data-tone="danger"（红），点遮罩 = 取消
    scrim: 'cancel',
    value: () => true,
    cancelValue: false,
  });
}

/**
 * 输入一行文本。主按钮 resolve(字符串，原样不 trim)；取消 / Esc / 点遮罩 resolve(null)。
 * validate(value) 可以返回字符串（错误提示，弹窗留着不关）或 null/''/true（通过）；支持 async。
 */
export function dialogPrompt(opts = {}) {
  const o = opts || {};
  return dialogForm({
    role: 'dialog',
    kind: o.kind || 'info',
    title: o.title || '请输入',
    body: o.body || '',
    detail: o.detail || '',
    okLabel: o.okLabel || '确定',
    cancelLabel: o.cancelLabel || '取消',
    danger: !!o.danger,
    single: true,
    fields: [{
      name: 'value',
      label: o.label || '',
      value: o.value == null ? '' : o.value,
      placeholder: o.placeholder || '',
      type: o.type || 'text',
      maxLength: o.maxLength,
      autofocus: true,
      select: true,
    }],
    validate: o.validate,
  }).then((r) => (r === null ? null : r.value));
}

/**
 * 多字段表单（备用）。resolve(Record<string,string>)；取消 / Esc / 点遮罩 resolve(null)。
 * fields: [{ name, label, type: 'text'|'password'|'number'|'textarea'|'select', value, placeholder, options, rows, maxLength, autofocus }]
 * validate(record) 同上：返回字符串 = 不通过。
 */
export function dialogForm(opts = {}) {
  const o = opts || {};
  const fields = Array.isArray(o.fields) ? o.fields.filter((f) => f && f.name) : [];
  return request({
    role: 'dialog',
    kind: o.kind || 'info',
    title: o.title || '请填写',
    body: o.body || '',
    detail: o.detail || '',
    okLabel: o.okLabel || '确定',
    cancelLabel: o.cancelLabel || '取消',
    danger: !!o.danger,
    fields,
    single: !!o.single,
    validate: typeof o.validate === 'function' ? o.validate : null,
    scrim: 'cancel',
    value: (rec) => rec || {},
    cancelValue: null,
  });
}

/** 当前是否有弹窗正在展示（调试 / 验收用）。 */
export function isDialogOpen() {
  return !!active;
}

/** 强行关掉当前弹窗与所有排队项（取消语义）。一般只在换页/重置这类场合用。 */
export function dialogCloseAll() {
  const pending = queue.splice(0);
  for (const ctx of pending) ctx.resolve(ctx.spec.cancelValue);
  settleActive('cancel');
}

// 控制台/验收脚本的便捷出口（不依赖模块 import 就能驱动弹窗）。类名之外的唯一全局副作用。
if (typeof window !== 'undefined') {
  window.__IWDialog = { dialogAlert, dialogConfirm, dialogPrompt, dialogForm, isDialogOpen, dialogCloseAll };
}
