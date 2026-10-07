// 独立的登录/注册页（用户要求：像一个真正的产品那样有登录/注册页，而不是躺在设置里）
//
// 设计要点：
//   · 只通过 src/api.js 访问后端（**唯一出口**：不自己拼 URL、不自己 fetch）；
//   · 错误**尽量详细**（用户要求）：把后端返回的 code/hint/details 与"连不上后端"的完整说明都贴出来，
//     并且**以弹窗呈现** —— #detail 仍旧是那段文案唯一的落点，改动只在于它现在住在一个浮层里；
//   · 登录/注册成功后：若本机有旧数据，**自动导入**（后端只填空位，不覆盖），然后回画布；
//   · 「先逛逛」= 直接进画布（访客：能用，但数据不保存到服务器）—— 与开屏闸门的"离线进入"同一套语义；
//   · 已登录时直接提示并给"回画布"入口，不用重复登录；
//   · 两处细节动效（都不碰 DOM 契约、也不新增状态类，状态一律走 data 属性）：
//       ‣ 输密码时左栏的几何角色闭上眼睛 → body[data-eyes="closed"]（样式在 styles.css 里接）
//       ‣ 鼠标移动时几何元素原地轻微视差 → 只往 body 上写 --mx / --my 两个自定义属性，
//         每个图形晃多少由 CSS 里的 --k 决定（JS 不碰元素本身，也就不可能晃乱布局）
import { login, register, me, logout, getToken, clearToken, importLegacy, ApiError, apiBase, probeBackend } from './api.js';
import { legacyBlobs, mayImportLegacyFor, claimLegacy } from './userScope.js';

const $ = (id) => document.getElementById(id);
const userEl = $('user'); const passEl = $('pass'); const goEl = $('go');
const statusEl = $('status'); const detailEl = $('detail');
const scrimEl = $('errScrim'); const errOkEl = $('errOk'); const errTitleEl = $('errTitle'); const moreBtnEl = $('moreBtn');
const tabs = [...document.querySelectorAll('[data-tab]')];

let mode = 'login';
let lastFocus = null;

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  // 状态用 data-kind 表达（不是类）：与设置页面板同一理由 —— 只在特定状态才出现的类会被类契约判死规则
  statusEl.dataset.kind = kind || '';
}

/** 详细说明 → 弹窗。开合只用 hidden（不造 .open 之类只在某状态出现的类） */
function showDetail(text, title) {
  const body = text || '';
  detailEl.textContent = body;
  moreBtnEl.hidden = !body;            // 弹窗被关掉后，"查看详情"还能把它叫回来
  if (!body) { closeDetail(); return; }
  if (title) errTitleEl.textContent = title;
  lastFocus = document.activeElement;
  scrimEl.hidden = false;
  errOkEl.focus();                     // 无障碍：弹窗一开就把焦点交给它唯一的按钮
}
function closeDetail() {
  if (scrimEl.hidden) return;
  scrimEl.hidden = true;
  if (lastFocus && lastFocus !== document.body && lastFocus.focus) lastFocus.focus();
  lastFocus = null;
}
errOkEl.addEventListener('click', closeDetail);
moreBtnEl.addEventListener('click', () => { if (detailEl.textContent) showDetail(detailEl.textContent, errTitleEl.textContent); });
scrimEl.addEventListener('click', (ev) => { if (ev.target === scrimEl) closeDetail(); });   // 点弹窗以外 = 关掉
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeDetail(); });

/** 后端错误 → 一段可直接读的详细说明（与设置页面板同一套写法） */
function explain(e, what) {
  if (e instanceof ApiError) return what + '\n' + e.toDetailText(apiBase());
  return what + '\n   原因：' + ((e && e.message) || e);
}

function setMode(next) {
  mode = next;
  // .on 是样式钩子（styles.css 里的 body.iwLogin .tabs button.on），aria-pressed 是同一个状态给读屏器的那一份
  for (const t of tabs) {
    const on = t.dataset.tab === mode;
    t.classList.toggle('on', on);
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  goEl.textContent = mode === 'login' ? '登录' : '注册并登录';
  passEl.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  showDetail('');
  setStatus(mode === 'login' ? '' : '注册后会自动登录，并把本机已有数据导入服务器。');
}
tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.tab)));

// ---- 细节动效之一：输密码时闭眼（写 data 属性，样式在 styles.css 的 body.iwLogin[data-eyes="closed"]）----
passEl.addEventListener('focus', () => { document.body.dataset.eyes = 'closed'; });
passEl.addEventListener('blur', () => { delete document.body.dataset.eyes; });

// ---- 细节动效之二：几何元素随鼠标原地轻微晃动 ----
const stillOK = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (stillOK) {
  let px = 0, py = 0, raf = 0;
  const flush = () => {
    raf = 0;
    document.body.style.setProperty('--mx', px.toFixed(3));
    document.body.style.setProperty('--my', py.toFixed(3));
  };
  const track = (ev) => {
    px = Math.max(-1, Math.min(1, (ev.clientX / window.innerWidth) * 2 - 1));
    py = Math.max(-1, Math.min(1, (ev.clientY / window.innerHeight) * 2 - 1));
    if (!raf) raf = requestAnimationFrame(flush);   // 每帧最多写一次，拖动时不抖动
  };
  const recenter = () => { px = 0; py = 0; if (!raf) raf = requestAnimationFrame(flush); };
  window.addEventListener('pointermove', track, { passive: true });
  document.addEventListener('mouseleave', recenter);
  window.addEventListener('blur', recenter);
}

/**
 * 本机旧数据（老版本都放在**全局** localStorage 键里）→ 交给后端 import（只填空位、不覆盖）。
 *
 * ★ 必须在**登录之前**读出来：登录成功的那一刻 userScope 就会给这份旧数据定归属
 *   （可能是这台浏览器上一个用过的账号），并把全局键复制进那个账号的命名空间、清掉全局键。
 * ★ 每个账号完全独立（用户报告的 bug）：如果这份旧数据已经归属**别的账号**，
 *  调用方会用 mayImportLegacyFor() 拦下 —— 一份旧数据只导一次，绝不导进第二个账号。
 */
function collectLegacy() {
  const blobs = legacyBlobs();          // { 'interweaver.settings.v1': {…}, 'interweaver.progress.v1': {…}, 'interweaver.draft.v1': {…} }
  const docs = {};
  if (blobs['interweaver.settings.v1']) docs.settings = blobs['interweaver.settings.v1'];
  if (blobs['interweaver.progress.v1']) docs.progress = blobs['interweaver.progress.v1'];
  if (blobs['interweaver.draft.v1']) docs.draft = blobs['interweaver.draft.v1'];
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
  const legacy = collectLegacy();          // ★ 先读（登录会改变这份数据的归属）
  const legacyKinds = Object.keys(legacy.docs);
  try {
    const r = kind === 'register' ? await register(username, password) : await login(username, password);
    setStatus(`✓ 已${kind === 'register' ? '注册并登录' : '登录'}：${r.user.username}${r.user.isAdmin ? '（管理员）' : ''}`, 'ok');
    const uid = r.user && r.user.id;
    // 旧数据自动导入（只填空位；**只导一次**，且绝不导进别的账号）
    if (legacyKinds.length && !mayImportLegacyFor(uid)) {
      setStatus(`✓ 已${kind === 'register' ? '注册并登录' : '登录'}：${r.user.username}　·　本机旧数据已属于另一个账号，未导入（每个账号的数据各自独立）`, 'ok');
    } else if (legacyKinds.length) {
      try {
        const imp = await importLegacy(legacy.docs, legacy.scenes);
        claimLegacy(uid);                  // 打标记：这份旧数据从此归属本账号，别的账号再也导不走
        const docs = (imp.applied && imp.applied.docs) || [];
        setStatus(`✓ 已登录：${r.user.username}　·　已导入本机旧数据：${docs.length ? docs.join('/') : '无空位'}${imp.skipped ? `（跳过 ${imp.skipped} 项：服务器已有）` : ''}`, 'ok');
      } catch (e) {
        showDetail(explain(e, '登录成功，但导入本机旧数据失败：'), '导入本机旧数据失败');
      }
    }
    setTimeout(() => { location.href = './index.html'; }, 700);
  } catch (e) {
    setStatus(kind === 'register' ? '注册失败' : '登录失败', 'bad');
    showDetail(explain(e, kind === 'register' ? '注册失败：' : '登录失败：'), kind === 'register' ? '注册失败' : '登录失败');
  } finally {
    goEl.disabled = false;
  }
}

$('form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  // 已登录（后端确认过）时，这个按钮是「回画布」（见文件末尾的自动回画布逻辑）
  if (backMode) { location.href = './index.html'; return; }
  doAuth(mode);
});

// ★ 已登录 → **自动回画布**（用户本轮要求：不要在登录表单上停着）。
//   两条护栏（缺一不可）：
//     ① 防死循环 / 防抖：只在"有 token **且后端确认有效**"时跳，且只跳一次（location.replace，
//        不往历史里塞一条，返回键不会又弹回登录页）；后端不可用时留在本页（既有的详细报错块）。
//     ② 防锁死：跳转前先把「退出登录 / 切换账号」亮出来，并留一小段可见时间 —— 点它就取消这次
//        自动跳转、真的登出（后端 /auth/logout + 清本地 token），人留在本页换账号。
//        否则已登录的人再也见不到登录表单，等于被锁在自动回画布里。
const AUTO_BACK_MS = 1200;
let backMode = false;
let autoBackTimer = 0;
const switchEl = $('switchAcct');

switchEl.addEventListener('click', async () => {
  if (autoBackTimer) { clearTimeout(autoBackTimer); autoBackTimer = 0; }
  backMode = false;
  goEl.textContent = '登录';
  switchEl.hidden = true;
  switchEl.disabled = true;
  setStatus('正在退出登录…');
  try { await logout(); }                        // 后端把该 token 作废；失败也照样清本地（api.logout 的 finally）
  catch { clearToken(); }
  setStatus('已退出登录：现在可以用另一个账号登录了。', 'ok');
  userEl.focus();
});

// 打开时：后端可达吗？已登录吗？（都给出明确状态，不猜）
(async () => {
  const probe = await probeBackend();
  if (!probe.ok) {
    setStatus(`未连接后端（${apiBase()}）`, 'bad');
    showDetail(explain(probe.error, '后端不可用：') + '\n\n（你仍然可以点「先逛逛」用画布；离线模式下不开放成就页等联网功能。）', '未连接后端');
    return;
  }
  if (getToken()) {
    try {
      const r = await me();
      // 后端确认 token 有效 → 自动回画布（护栏②：先把"退出登录 / 切换账号"亮出来再跳）
      backMode = true;
      goEl.textContent = '回画布';
      switchEl.hidden = false;
      switchEl.disabled = false;
      setStatus(`✓ 已登录：${r.user.username}${r.user.isAdmin ? '（管理员）' : ''}　·　正在回到画布…（要换账号就点「退出登录 / 切换账号」）`, 'ok');
      autoBackTimer = setTimeout(() => { location.replace('./index.html'); }, AUTO_BACK_MS);
      return;
    } catch (e) {
      // token 失效：清掉，让用户重新登录（并说明原因）
      if (e instanceof ApiError && e.status === 401) { clearToken(); setStatus('上次的登录已失效，请重新登录。', 'bad'); }
      else showDetail(explain(e, '读取账号信息失败：'), '读取账号信息失败');
    }
  }
  setStatus('');
  userEl.focus();
})();
