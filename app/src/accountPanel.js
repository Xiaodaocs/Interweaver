// 「我的」面板 —— 设置页新分类「我的」的全部内容（账号信息 / 头像 / 云端场景）
//
// ★ 本轮用户要求（两条一起看）：
//   ① 设置里**删掉登录**：登录/注册是独立页面（login.html），不该躺在设置里。
//      所以这里**没有**输入框、**没有**登录/注册按钮 —— 只有只读状态 + 一个「打开登录页」的入口；
//   ② 设置里**增加「我的」**：改用户名、改头像、管理云端场景，以及退出登录。
//
// 设计约束（项目硬性规矩，改这个文件前先读）：
//   · 只用 src/api.js 访问后端（唯一出口：不自己 fetch、不自己拼 URL）；
//   · 需要确认/输入一律用 src/dialog.js（项目里**不许**再出现原生 alert/confirm/prompt）；
//   · 状态一律用 data 属性（data-state / data-role），**不造"只在某状态才出现"的类** ——
//     类契约普查是双向的：跑了没定义的类＝失灵类，定义了没跑到的类＝死规则。
//     因此本模块**一次性把所有结构都建出来**（未登录时也在 DOM 里），再按状态改文本/属性；
//   · 错误一律显示后端返回的原文（code / error / hint）—— 已经被占用、格式不合法这些，
//     后端写得比前端清楚，前端**不另编一套文案**；
//   · 导入时**不碰 DOM**（模块守卫会在浏览器里 import 它），首次调用 createMinePanel 才建节点。
//
// 头像方案（用户未指定，这里选方案 a）：**内置符号 + 主题色**，零依赖、不占存储、不用上传文件。
//   存进后端的字符串形如 "⟡|#5E5CE6"（≤ 32 字符，server-api.mjs 里有同一份白名单做校验）。
import {
  probeBackend, onBackendState, logout, me, updateMe, getToken, clearToken,
  listScenes, putScene, deleteScene, ApiError, apiBase,
} from './api.js';
import { dialogAlert, dialogConfirm, dialogPrompt } from './dialog.js';

/** 内置头像符号（与后端 AVATAR_SYMBOLS 保持一致） */
export const AVATAR_SYMBOLS = ['⟡', '⌖', '∑', 'π', '△', '∞', '◇', '∮', '⊕', '√', '≈', '◐'];
/** 内置主题色（与后端 AVATAR_COLORS 保持一致） */
export const AVATAR_COLORS = ['#5E5CE6', '#2E9E6B', '#D9822B', '#D9534F', '#3B82F6', '#8B5CF6', '#0E9AA7', '#8A8F98'];
const FALLBACK = { symbol: '⟡', color: '#8A8F98' };
const AVATAR_RE = /^([^|]{1,4})\|(#[0-9A-Fa-f]{6})$/;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 没设置过头像的账号（老库里的用户）→ 由用户名**确定性地**派一个默认头像：每次打开都一样 */
export function defaultAvatar(username) {
  const s = String(username || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { symbol: AVATAR_SYMBOLS[h % AVATAR_SYMBOLS.length], color: AVATAR_COLORS[(h >>> 5) % AVATAR_COLORS.length] };
}

/**
 * 账号对象 → 头像 { symbol, color, custom }。
 * custom=false 表示这个账号还没保存过头像（显示的是按用户名派生的默认值）。
 * ★ 画布 / 设置 / 星图要显示头像时都调这一个函数，别各写一遍（"函数几何被抄四遍"的教训）。
 */
export function avatarOf(user) {
  const raw = user && user.avatar;
  const m = typeof raw === 'string' ? AVATAR_RE.exec(raw) : null;
  if (m && AVATAR_SYMBOLS.includes(m[1]) && AVATAR_COLORS.includes(m[2])) {
    return { symbol: m[1], color: m[2], custom: true };
  }
  return { ...(user && user.username ? defaultAvatar(user.username) : FALLBACK), custom: false };
}

const pad = (n) => String(n).padStart(2, '0');
/** 时间戳 → "2026-10-07 12:40"（本机时区，给人看） */
function fmtTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** 字节数 → "1.2 KB" */
function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}

/** 云端场景列表的"空态/未登录/读取失败"都复用行结构（.mineRow）—— 见文件头"类契约"那条 */
const infoRow = (title, hint) => '<div class="mineRow" data-state="empty">'
  + '<span class="mineRowName">' + esc(title) + '</span>'
  + '<span class="mineRowMeta">' + esc(hint) + '</span></div>';

const sceneRow = (s) => '<div class="mineRow" data-id="' + esc(s.id) + '">'
  + '<span class="mineRowName" title="' + esc(s.name) + '">' + esc(s.name) + '</span>'
  + '<span class="mineRowMeta">' + esc(fmtTime(s.savedAt)) + ' · ' + esc(fmtBytes(s.bytes)) + '</span>'
  + '<button class="mineMini" type="button" data-act="rename">重命名</button>'
  + '<button class="mineMini" type="button" data-act="del">删除</button>'
  + '</div>';

/**
 * 建「我的」面板。返回 { el, refresh }。
 * mount：宿主节点（只用于 appendChild；面板自己不管宿主长什么样）。
 */
export function createMinePanel({ mount } = {}) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="accCard" data-role="accountCard">
      <div class="accHead"><b>账号与登录</b><span class="accState" data-role="conn">检测中…</span></div>
      <div class="accMe">
        <span class="mineAvatar" data-role="avatar" aria-hidden="true">⟡</span>
        <span class="accUser" data-role="who">未登录</span>
        <span class="accImp" data-role="role">—</span>
      </div>
      <div class="mineKv"><span class="mineK">用户名</span><span class="mineV" data-role="kvName">未登录</span></div>
      <div class="mineKv"><span class="mineK">身份</span><span class="mineV" data-role="kvRole">—</span></div>
      <div class="mineKv"><span class="mineK">注册时间</span><span class="mineV" data-role="kvCreated">—</span></div>
      <div class="accBtns">
        <button type="button" data-role="rename">更改用户名</button>
        <button type="button" data-role="logout">退出登录</button>
        <button type="button" data-role="retry">重试连接</button>
      </div>
      <div class="accDetail" data-role="detail" hidden></div>
      <a class="accHint" data-role="loginLink" href="./login.html">打开登录页 →（注册 / 登录 / 导入本机旧数据都在那一页）</a>
      <div class="accImp" data-role="note">未登录时数据只留在本机；登录后可以在登录页把本机旧数据导入服务器（只填空位，不覆盖）。</div>
    </div>

    <div class="accCard" data-role="avatarCard">
      <div class="accHead"><b>头像</b><span class="accState" data-role="avatarState">—</span></div>
      <div class="accHint">内置符号 + 主题色，点一下即保存到服务器 —— 不用上传图片，也不占存储。</div>
      <div class="accForm mineGlyphs" data-role="glyphs">${
        AVATAR_SYMBOLS.map((s) => '<button class="mineGlyph" type="button" data-state="off" data-glyph="' + esc(s) + '" title="符号 ' + esc(s) + '">' + esc(s) + '</button>').join('')
      }</div>
      <div class="accForm mineSwatches" data-role="colors">${
        AVATAR_COLORS.map((c) => '<button class="mineSwatch" type="button" data-state="off" data-color="' + esc(c) + '" style="--c:' + esc(c) + '" title="主题色 ' + esc(c) + '" aria-label="主题色 ' + esc(c) + '"></button>').join('')
      }</div>
    </div>

    <div class="accCard" data-role="cloudCard">
      <div class="accHead"><b>云端场景</b><span class="accState" data-role="sceneState">检测中…</span>
        <button class="mineMini" type="button" data-role="reload">刷新</button></div>
      <div class="accHint">画布「文件 → 保存到云端」存上来的场景；在这里可以重命名或删除（画布本机文件不受影响）。</div>
      <div class="mineList" data-role="scenes"></div>
    </div>
  `;
  if (mount) mount.appendChild(el);

  const q = (r) => el.querySelector(`[data-role="${r}"]`);
  let user = null;          // 后端返回的账号对象（原样），未登录 = null
  let scenes = [];          // 云端场景列表
  let avatarSeq = 0;        // 头像连点：只认最后一次请求的结果

  const setDetail = (text) => { const d = q('detail'); d.hidden = !text; d.textContent = text || ''; };

  /** 后端错误 → 一段可直接读的说明（与登录页同一套写法；用户要求"越详细越好"） */
  const explain = (e, what) => (e instanceof ApiError ? `${what}\n${e.toDetailText(apiBase())}` : `${what}\n   原因：${(e && e.message) || e}`);

  /** 弹窗里**原样**显示后端的 error / hint / details，同时把详细说明留在卡片下方（不假装成功） */
  async function reportError(title, e) {
    setDetail(explain(e, title + '：'));
    const detail = [
      e && e.hint ? '怎么办：' + e.hint : '',
      e && e.details ? '细节：' + JSON.stringify(e.details) : '',
    ].filter(Boolean).join('\n');
    await dialogAlert({
      kind: 'error',
      title,
      body: (e && (e.error || e.message)) || String(e),
      detail,
    });
  }

  function paintAvatar(node, av) {
    node.textContent = av.symbol;
    node.style.setProperty('--c', av.color);
  }

  function renderAccount() {
    const av = avatarOf(user);
    paintAvatar(q('avatar'), av);
    q('who').textContent = user ? user.username : '未登录';
    q('role').textContent = user ? (user.isAdmin ? '管理员' : '普通用户') : '—';
    q('kvName').textContent = user ? user.username : '未登录';
    q('kvRole').textContent = user ? (user.isAdmin ? '管理员' : '普通用户') : '—';
    q('kvCreated').textContent = user ? fmtTime(user.createdAt) : '—';
    q('rename').disabled = !user;
    q('logout').disabled = !user;
    q('note').textContent = user
      ? '退出登录不会删除服务器上的数据，重新登录即可取回。'
      : '未登录时数据只留在本机；登录后可以在登录页把本机旧数据导入服务器（只填空位，不覆盖）。';
  }

  function renderAvatar() {
    const av = avatarOf(user);
    q('avatarState').textContent = !user ? '登录后可保存'
      : (av.custom ? '已保存到云端' : '默认（点一下即保存）');
    for (const b of q('glyphs').children) b.dataset.state = (user && b.dataset.glyph === av.symbol) ? 'on' : 'off';
    for (const b of q('colors').children) b.dataset.state = (user && b.dataset.color === av.color) ? 'on' : 'off';
  }

  // mode: 'guest' 未登录 | 'list' 正常列表 | 'failed' 读取失败
  function renderScenes(mode) {
    const box = q('scenes');
    const st = q('sceneState');
    if (mode === 'guest') { st.textContent = '未登录'; box.innerHTML = infoRow('未登录：登录后这里会列出服务器上的场景', '登录页里可以注册或登录'); return; }
    if (mode === 'failed') { st.textContent = '读取失败'; box.innerHTML = infoRow('云端场景读取失败', '原因见上方详细报错，可点「刷新」重试'); return; }
    const bytes = scenes.reduce((n, s) => n + (Number(s.bytes) || 0), 0);
    st.textContent = scenes.length ? `${scenes.length} 个 · 共 ${fmtBytes(bytes)}` : '还没有场景';
    box.innerHTML = scenes.length ? scenes.map(sceneRow).join('') : infoRow('还没有云端场景', '在画布「文件 → 保存到云端」即可创建');
  }

  async function loadScenes() {
    if (!getToken()) { scenes = []; renderScenes('guest'); return; }
    q('sceneState').textContent = '读取中…';
    try {
      scenes = (await listScenes()).scenes || [];
      renderScenes('list');
    } catch (e) {
      scenes = [];
      renderScenes('failed');
      await reportError('读取云端场景失败', e);
    }
  }

  /** 拉一次账号：刷新按钮、登录状态变化、改完资料都走这里 */
  async function refresh() {
    const probe = await probeBackend();
    const conn = q('conn');
    conn.textContent = probe.ok ? `后端已连接（${apiBase()}）` : `后端未连接（${apiBase()}）`;
    conn.dataset.state = probe.ok ? 'ok' : 'bad';
    if (!probe.ok) setDetail(explain(probe.error, '后端不可用：'));

    if (!getToken()) { user = null; renderAccount(); renderAvatar(); renderScenes('guest'); return; }
    try {
      user = (await me()).user;
      if (probe.ok) setDetail('');
      renderAccount(); renderAvatar();
      await loadScenes();
    } catch (e) {
      // token 失效（401）＝ 正常的业务状态：清掉本地凭证，如实显示"未登录"
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        user = null; renderAccount(); renderAvatar(); renderScenes('guest');
        setDetail(explain(e, '登录状态已失效：'));
      } else {
        renderAccount();
        renderScenes('failed');
        await reportError('读取账号信息失败', e);
      }
    }
  }

  /** 未登录时还去点"保存"类操作 → 问一句要不要去登录页（不悄悄失败） */
  async function needLogin() {
    const go = await dialogConfirm({
      title: '需要先登录',
      body: '这个操作会把改动保存到你的账号上，所以要先进登录页。',
      okLabel: '去登录页',
      cancelLabel: '先不',
    });
    if (go) location.href = './login.html';
  }

  /** ① 改用户名：dialogPrompt 收新名字 → PATCH /me → 成功后界面同步刷新 */
  async function renameUser() {
    if (!user) { await needLogin(); return; }
    const name = await dialogPrompt({
      title: '更改用户名',
      label: '新用户名',
      value: user.username,
      placeholder: '3~20 位字母 / 数字 / 下划线 / 中文',
      okLabel: '保存',
    });
    if (name === null) return;                       // 取消
    try {
      const r = await updateMe({ username: name });
      user = r.user;
      renderAccount(); renderAvatar();
      await dialogAlert({
        kind: 'success',
        title: '用户名已更新',
        body: `现在你是 ${user.username}。`,
        detail: '旧 token 仍然有效，不需要重新登录。',
      });
    } catch (e) {
      // ★「已被占用」= 409 USER_EXISTS、「格式不合法」= 400 BAD_USERNAME ——
      //   两者都把后端给的 code/error/hint **原样**显示出来（下面这一句不做任何改写）
      await reportError('更改用户名失败', e);
    }
  }

  /** ② 头像：点符号或颜色 → 立刻 PATCH /me（符号与颜色一起提交，后端只认白名单） */
  async function pickAvatar(patch) {
    if (!user) { await needLogin(); return; }
    const cur = avatarOf(user);
    const next = { symbol: patch.symbol || cur.symbol, color: patch.color || cur.color };
    const seq = ++avatarSeq;
    q('avatarState').textContent = '保存中…';
    try {
      const r = await updateMe({ avatar: next.symbol + '|' + next.color });
      if (seq !== avatarSeq) return;                 // 连点：只认最后一次的结果，避免旧响应把新的盖回去
      user = r.user;
      renderAccount(); renderAvatar();
    } catch (e) {
      if (seq !== avatarSeq) return;
      renderAvatar();
      await reportError('保存头像失败', e);
    }
  }

  /** ③ 退出登录：api.logout()（内部一定会清 token）→ 回独立登录页 */
  async function doLogout() {
    const yes = await dialogConfirm({
      title: '退出登录',
      body: '退出后画布仍然可用，但数据只留在本机。',
      detail: '服务器上的数据不会被删除，重新登录即可取回。',
      okLabel: '退出登录',
    });
    if (!yes) return;
    try { await logout(); } catch { /* 登出失败也让本地 token 清掉（api.logout 的 finally 已经清了） */ }
    location.href = './login.html';
  }

  async function renameScene(item) {
    const name = await dialogPrompt({ title: '重命名云端场景', label: '场景名', value: item.name, okLabel: '保存' });
    if (name === null) return;
    const nm = name.trim();
    if (!nm) { await dialogAlert({ title: '场景名不能为空', body: '名字没有改。' }); return; }
    try {
      // 只传 name：data 不传 → 后端保留场景原有内容（PUT /scenes/:id 的既有语义）
      await putScene(item.id, { name: nm });
      await loadScenes();
    } catch (e) {
      await reportError('重命名失败', e);
    }
  }

  async function removeScene(item) {
    const yes = await dialogConfirm({
      title: '删除云端场景',
      body: `确定删除「${item.name}」？`,
      detail: '删除后无法恢复；本机画布与导出的文件不受影响。',
      danger: true,
      okLabel: '删除',
    });
    if (!yes) return;
    try {
      await deleteScene(item.id);
      await loadScenes();
    } catch (e) {
      await reportError('删除失败', e);
    }
  }

  /**
   * 事件处理器的兜底：任何没预料到的异常都变成一次"操作失败"提示，**绝不冒成未捕获的 Promise**
   * （未捕获的 Promise 在浏览器里会变成 pageerror，类契约普查会因此判失败）。
   */
  function guard(fn) {
    return (...args) => {
      try {
        const r = fn(...args);
        if (r && typeof r.then === 'function') r.catch((e) => reportError('操作失败', e));
      } catch (e) {
        reportError('操作失败', e);
      }
    };
  }

  // ---- 事件绑定（一次性；面板节点跨分类复用，所以监听器不会重复挂）----
  q('rename').addEventListener('click', guard(renameUser));
  q('logout').addEventListener('click', guard(doLogout));
  q('retry').addEventListener('click', guard(() => refresh()));
  q('reload').addEventListener('click', guard(loadScenes));
  q('glyphs').addEventListener('click', guard((ev) => {
    const b = ev.target.closest('[data-glyph]');
    if (b) return pickAvatar({ symbol: b.dataset.glyph });
    return undefined;
  }));
  q('colors').addEventListener('click', guard((ev) => {
    const b = ev.target.closest('[data-color]');
    if (b) return pickAvatar({ color: b.dataset.color });
    return undefined;
  }));
  q('scenes').addEventListener('click', guard((ev) => {
    const btn = ev.target.closest('[data-act]');
    const row = btn && btn.closest('.mineRow');
    const item = row && scenes.find((s) => s.id === row.dataset.id);
    if (!item) return undefined;
    return btn.dataset.act === 'rename' ? renameScene(item) : removeScene(item);
  }));
  // 后端状态变化（api.js 在**连不上/5xx**时会通知）→ 同步到状态行
  onBackendState((st) => {
    const conn = q('conn');
    if (!conn) return;
    if (st.ok === false && st.reason instanceof ApiError) {
      conn.textContent = `后端未连接（${st.base}）`;
      conn.dataset.state = 'bad';
      setDetail(explain(st.reason, '后端不可用：'));
    } else if (st.ok === true) {
      conn.textContent = `后端已连接（${st.base}）`;
      conn.dataset.state = 'ok';
    }
  });

  renderAccount();
  renderAvatar();
  renderScenes('guest');
  // 异步拉状态；内部已逐段处理错误 —— 这一句 .catch 是**兜底**，只为保证不冒出未捕获的 Promise
  // （未捕获的 Promise 在浏览器里会变成 pageerror，类契约普查会因此判失败）。
  refresh().catch((e) => {
    setDetail('刷新账号状态时出错：' + ((e && e.message) || e));
    console.error('[我的] 刷新失败：', e);
  });
  return { el, refresh };
}
