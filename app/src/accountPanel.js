// 账号 / 后端面板（设置页「通用」分类里的第一张卡）
//
// 为什么要有它（用户要求：分开前后端 + 用户系统 + 旧的本地数据自动导入 + 后端挂了要详细报错）：
//   · 显示后端连接状态；**连不上时把详细报错原样贴出来**（地址 / code / 怎么办 / 细节），
//     而不是只写"失败"三个字；
//   · 登录 / 注册 / 登出（第一个注册的用户自动是管理员，部署时用来建站）；
//   · 登录成功后**自动导入本机旧数据**（localStorage 里的设置/进度/草稿），
//     后端只填空位、不覆盖 —— 所以重复导入是安全的。
//
// 只用 src/api.js 这一个出口访问后端（不自己 fetch、不自己拼 URL）。
import { probeBackend, getBackendState, onBackendState, login, register, logout, me, getToken, importLegacy, ApiError, apiBase, health } from './api.js';

/** 本机旧数据（老版本全放在 localStorage 里）→ 准备给后端 import（只填空位） */
export function collectLegacy() {
  const read = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const docs = {};
  const s = read('interweaver.settings.v1');
  if (s && typeof s === 'object') docs.settings = s;
  const p = read('interweaver.progress.v1');
  if (p && typeof p === 'object') docs.progress = p;
  const d = read('interweaver.draft.v1');
  if (d && typeof d === 'object') docs.draft = d;
  // 场景：老版本是"下载成文件"，本机没有场景库；这里如实返回空数组（不编造）
  const scenes = [];
  return { docs, scenes, hasAny: Object.keys(docs).length > 0 || scenes.length > 0 };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createAccountPanel({ mount }) {
  const el = document.createElement('div');
  el.className = 'accCard';
  el.innerHTML = `
    <div class="accHead"><b>账号与后端</b><span class="accState" data-role="state">检测中…</span></div>
    <div class="accHint">前端不再自带后端：数据存在独立后端（默认 5189）。后端不在时**不会**偷偷退回本地存储，而是明确报错。</div>
    <div class="accDetail" data-role="detail" hidden></div>
    <form class="accForm" data-role="form" autocomplete="off">
      <input data-role="user" placeholder="用户名（3~32 位字母/数字/_ . -）" autocomplete="username">
      <input data-role="pass" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password">
      <div class="accBtns">
        <button type="submit" data-role="login">登录</button>
        <button type="button" data-role="register">注册</button>
        <button type="button" data-role="retry">重试连接</button>
      </div>
    </form>
    <a class="accHint" href="./login.html" style="text-decoration:none">打开独立登录页 →（推荐：那里有完整的注册/登录与详细报错）</a>
    <div class="accMe" data-role="me" hidden></div>
  `;
  mount.appendChild(el);
  const q = (r) => el.querySelector(`[data-role="${r}"]`);
  // ★ 导入提示存成状态（而不是直接写进 DOM）：renderMe() 会重建账号行，
  //   直接把文本写进旧节点会被下一次重建抹掉（这个 bug 表现为"提示时有时无"）。
  let impText = '本机旧数据：登录后自动导入';
  const setDetail = (text) => { const d = q('detail'); d.hidden = !text; d.textContent = text || ''; };
  // ★ 状态用 data-state 表达（不是类）：一是语义更准，二是类契约普查要求
  //   "非条件性死规则必须为 0" —— 只在"后端在"或"已登录"时才出现的类会被判为死规则。
  const setState = (ok, txt) => {
    const s = q('state');
    s.textContent = txt;
    s.dataset.state = ok === true ? 'ok' : (ok === false ? 'bad' : 'unknown');
  };

  /** 后端错误 → 一段详细、可直接读的说明（用户要求"越详细越好"） */
  const explain = (e, what) => {
    if (e instanceof ApiError) return `${what}\n${e.toDetailText(apiBase())}`;
    return `${what}\n   原因：${(e && e.message) || e}`;
  };

  async function refreshState(showDetail = false) {
    const r = await probeBackend();
    if (r.ok) {
      setState(true, `已连接（${apiBase()}）`);
      if (showDetail) setDetail('');
    } else {
      setState(false, `未连接（${apiBase()}）`);
      setDetail(explain(r.error, '后端不可用：'));
    }
    // ★ 无条件渲染"账号行"：后端不在时也要看清"未登录"和"旧数据会在登录后自动导入"，
    //   而不是一片空白（也免得只在特定状态下才出现的类被判成死规则）。
    await renderMe();
    return r.ok;
  }

  async function renderMe() {
    const box = q('me');
    // ★ 未登录时也把这一行渲染出来（元素常驻；否则只在登录后才出现的类会被类契约判成死规则）
    if (!getToken()) {
      box.hidden = false;
      box.innerHTML = '<span class="accUser">未登录</span>'
        + `<span class="accImp" data-role="imp">${esc(impText)}</span>`;
      return;
    }
    try {
      const r = await me();
      box.hidden = false;
      // 管理员身份直接用文字标注（不再单独造一个只对管理员才出现的类 —— 那种类会被类契约判成死规则）
      box.innerHTML = `<span class="accUser"${r.user.isAdmin ? ' data-admin="1"' : ''}>${esc(r.user.username)}${r.user.isAdmin ? '（管理员）' : ''}</span>`
        + `<button type="button" data-role="logout">登出</button>`
        + `<span class="accImp" data-role="imp">${esc(impText)}</span>`;
      box.querySelector('[data-role="logout"]').addEventListener('click', async () => {
        try { await logout(); } catch { /* 登出失败也让本地 token 清掉 */ }
        renderMe(); setDetail('');
      });
    } catch (e) {
      box.hidden = false;
      box.innerHTML = '<span class="accUser">未登录</span>';
      if (e instanceof ApiError && e.status !== 401) setDetail(explain(e, '读取账号信息失败：'));
    }
  }

  /** 登录/注册成功后：把本机旧数据自动送进后端（后端只填空位，不覆盖） */
  async function autoImportLegacy() {
    const legacy = collectLegacy();
    if (!legacy.hasAny) { impText = '本机没有旧数据需要导入'; await renderMe(); return; }
    try {
      const r = await importLegacy(legacy.docs, legacy.scenes);
      const docs = (r.applied && r.applied.docs) || [];
      impText = `已自动导入本机旧数据：${docs.length ? docs.join('/') : '无空位'}${r.skipped ? `（跳过 ${r.skipped} 项：后端已有，不覆盖）` : ''}`;
    } catch (e) {
      impText = '自动导入失败（见下方详细报错）';
      setDetail(explain(e, '自动导入旧数据失败：'));
    }
    await renderMe();     // 统一由 renderMe 渲染，避免被下一次重建抹掉
  }

  const doAuth = async (kind) => {
    const username = q('user').value.trim();
    const password = q('pass').value;
    setDetail('');
    try {
      const r = kind === 'register' ? await register(username, password) : await login(username, password);
      setState(true, `已连接（${apiBase()}）`);
      setDetail(`✓ 已${kind === 'register' ? '注册并登录' : '登录'}：${r.user.username}${r.user.isAdmin ? '（管理员）' : ''}`);
      q('pass').value = '';
      await renderMe();
      await autoImportLegacy();       // ★ 用户要求：旧数据自动导入
    } catch (e) {
      setDetail(explain(e, kind === 'register' ? '注册失败：' : '登录失败：'));
    }
  };

  q('form').addEventListener('submit', (ev) => { ev.preventDefault(); doAuth('login'); });
  el.querySelector('[data-role="register"]').addEventListener('click', () => doAuth('register'));
  el.querySelector('[data-role="retry"]').addEventListener('click', async () => {
    setState(null, '检测中…');
    const okNow = await refreshState(true);
    if (okNow) setDetail(`✓ 后端可用：${apiBase()}\n   接口自证：${JSON.stringify(await health().then((h) => ({ db: h.db, users: h.users, allowRegister: h.allowRegister })).catch(() => ({})))}`);
  });
  // 后端状态变化（api.js 在任何请求失败时都会通知）→ 同步到界面
  onBackendState((st) => {
    if (st.ok === false && st.reason instanceof ApiError) {
      setState(false, `未连接（${st.base}）`);
      setDetail(explain(st.reason, '后端不可用：'));
    } else if (st.ok === true) {
      setState(true, `已连接（${st.base}）`);
    }
  });

  refreshState(false);
  return { el, refreshState, renderMe };
}
