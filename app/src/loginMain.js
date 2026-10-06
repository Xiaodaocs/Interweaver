// 独立的登录/注册页（用户要求：像一个真正的产品那样有登录/注册页，而不是躺在设置里）
//
// 设计要点：
//   · 只通过 src/api.js 访问后端（**唯一出口**：不自己拼 URL、不自己 fetch）；
//   · 错误**尽量详细**（用户要求）：把后端返回的 code/hint/details 与"连不上后端"的完整说明都贴出来；
//   · 登录/注册成功后：若本机有旧数据，**自动导入**（后端只填空位，不覆盖），然后回画布；
//   · 「先逛逛」= 直接进画布（访客：能用，但数据不保存到服务器）—— 与开屏闸门的"离线进入"同一套语义；
//   · 已登录时直接提示并给"回画布"入口，不用重复登录。
import { login, register, me, getToken, clearToken, importLegacy, ApiError, apiBase, probeBackend } from './api.js';

const $ = (id) => document.getElementById(id);
const userEl = $('user'); const passEl = $('pass'); const goEl = $('go');
const statusEl = $('status'); const detailEl = $('detail');
const tabs = [...document.querySelectorAll('[data-tab]')];

let mode = 'login';

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  // 状态用 data-kind 表达（不是类）：与设置页面板同一理由 —— 只在特定状态才出现的类会被类契约判死规则
  statusEl.dataset.kind = kind || '';
}
function showDetail(text) {
  detailEl.hidden = !text;
  detailEl.textContent = text || '';
}
/** 后端错误 → 一段可直接读的详细说明（与设置页面板同一套写法） */
function explain(e, what) {
  if (e instanceof ApiError) return what + '\n' + e.toDetailText(apiBase());
  return what + '\n   原因：' + ((e && e.message) || e);
}

function setMode(next) {
  mode = next;
  for (const t of tabs) t.classList.toggle('on', t.dataset.tab === mode);
  goEl.textContent = mode === 'login' ? '登录' : '注册并登录';
  passEl.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  showDetail('');
  setStatus(mode === 'login' ? '' : '注册后会自动登录，并把本机已有数据导入服务器。');
}
tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.tab)));

/** 本机旧数据（老版本都放在 localStorage 里）→ 交给后端 import（只填空位、不覆盖） */
function collectLegacy() {
  const read = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const docs = {};
  const s = read('interweaver.settings.v1'); if (s && typeof s === 'object') docs.settings = s;
  const p = read('interweaver.progress.v1'); if (p && typeof p === 'object') docs.progress = p;
  const d = read('interweaver.draft.v1'); if (d && typeof d === 'object') docs.draft = d;
  return { docs, scenes: [] };   // 场景：老版本是"下载成文件"，本机没有场景库 → 如实返回空
}

async function doAuth(kind) {
  const username = userEl.value.trim();
  const password = passEl.value;
  showDetail('');
  if (!username) { setStatus('请填用户名', 'bad'); userEl.focus(); return; }
  if (password.length < 6) { setStatus('密码至少 6 位', 'bad'); passEl.focus(); return; }
  goEl.disabled = true;
  setStatus(kind === 'register' ? '正在注册…' : '正在登录…');
  try {
    const r = kind === 'register' ? await register(username, password) : await login(username, password);
    setStatus(`✓ 已${kind === 'register' ? '注册并登录' : '登录'}：${r.user.username}${r.user.isAdmin ? '（管理员）' : ''}`, 'ok');
    // 旧数据自动导入（只填空位）
    const legacy = collectLegacy();
    if (Object.keys(legacy.docs).length) {
      try {
        const imp = await importLegacy(legacy.docs, legacy.scenes);
        const docs = (imp.applied && imp.applied.docs) || [];
        setStatus(`✓ 已登录：${r.user.username}　·　已导入本机旧数据：${docs.length ? docs.join('/') : '无空位'}${imp.skipped ? `（跳过 ${imp.skipped} 项：服务器已有）` : ''}`, 'ok');
      } catch (e) {
        showDetail(explain(e, '登录成功，但导入本机旧数据失败：'));
      }
    }
    setTimeout(() => { location.href = './index.html'; }, 700);
  } catch (e) {
    setStatus(kind === 'register' ? '注册失败' : '登录失败', 'bad');
    showDetail(explain(e, kind === 'register' ? '注册失败：' : '登录失败：'));
  } finally {
    goEl.disabled = false;
  }
}

$('form').addEventListener('submit', (ev) => { ev.preventDefault(); doAuth(mode); });

// 打开时：后端可达吗？已登录吗？（都给出明确状态，不猜）
(async () => {
  const probe = await probeBackend();
  if (!probe.ok) {
    setStatus(`未连接后端（${apiBase()}）`, 'bad');
    showDetail(explain(probe.error, '后端不可用：') + '\n\n（你仍然可以点「先逛逛」用画布；离线模式下不开放成就页等联网功能。）');
    return;
  }
  if (getToken()) {
    try {
      const r = await me();
      setStatus(`✓ 已登录：${r.user.username}${r.user.isAdmin ? '（管理员）' : ''}　·　可以直接回画布`, 'ok');
      goEl.textContent = '回画布';
      $('form').onsubmit = (ev) => { ev.preventDefault(); location.href = './index.html'; };
      return;
    } catch (e) {
      // token 失效：清掉，让用户重新登录（并说明原因）
      if (e instanceof ApiError && e.status === 401) { clearToken(); setStatus('上次的登录已失效，请重新登录。', 'bad'); }
      else showDetail(explain(e, '读取账号信息失败：'));
    }
  }
  setStatus('');
  userEl.focus();
})();
