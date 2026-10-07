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
// 头像方案（用户本轮要求「支持本地上传」，同时**保留内置符号 + 颜色作默认值与兜底**）：
//   **两种形态**存在同一个 users.avatar 字段里，靠前缀区分 —— 这也是"老数据一行都不用迁"的原因：
//     a) 内置符号 + 主题色：字符串形如 "⟡|#5E5CE6"（≤ 32 字符，server-api.mjs 里有同一份白名单）；
//     b) 本地上传的图片：data URL（"data:image/webp;base64,…"）—— 选图后在**浏览器里**用 canvas
//        缩到 128×128 再编码，**原图不上传**（用户可能选 5MB 的照片）；后端只做严格校验、不落文件。
//   avatarOf(user) 是**唯一**的分流处：kind='image' → 显示 <img>，kind='glyph' → 显示符号 + 颜色。
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
/** 上传头像的 data URL 前缀 —— 与 server-api.mjs 的 AVATAR_MIMES 三选一，多一个都不认 */
const AVATAR_DATA_RE = /^data:image\/(png|jpeg|webp);base64,/;
// 缩略尺寸 / 上限：这几个数必须与 server-api.mjs 的 AVATAR_DATA_URL_MAX、AVATAR_BYTES_MAX 对齐。
// 前端先按同一把尺子自己压（不把注定被拒的东西发出去），后端仍然会**再查一遍**（前端校验不算数）。
const AVATAR_PX = 128;                              // 头像方图的边长（用户要求 128×128）
const AVATAR_DATA_URL_MAX = 96 * 1024;              // data URL 字符串上限
const AVATAR_BYTES_MAX = 64 * 1024;                 // data URL 解码后字节数上限（硬上限）
const UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const UPLOAD_MAX_FILE = 24 * 1024 * 1024;           // 本地闸：再大的文件解码会吃内存/卡住页面，先劝退
const UPLOAD_TIP = '支持 PNG / JPEG / WebP；图片先在你的浏览器里缩到 128×128 再上传，原图不会上传。';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 没设置过头像的账号（老库里的用户）→ 由用户名**确定性地**派一个默认头像：每次打开都一样 */
export function defaultAvatar(username) {
  const s = String(username || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { symbol: AVATAR_SYMBOLS[h % AVATAR_SYMBOLS.length], color: AVATAR_COLORS[(h >>> 5) % AVATAR_COLORS.length] };
}

/**
 * 账号对象 → 头像 { kind, symbol, color, dataUrl, custom }。
 *   · kind='image'：账号里存的是上传的图片（data URL）→ 调用方显示 <img src=dataUrl>；
 *   · kind='glyph'：内置符号 + 主题色 → 显示 symbol（底色 color）。
 * ★ symbol / color **永远有值**（图片形态时给的是按用户名派生的默认值）——
 *   于是"图片头像时点一下色板"就自然变成"切回内置形态"，调用方也不用到处判空。
 * custom=false 表示这个账号还没保存过头像（显示的是按用户名派生的默认值）。
 * ★ 画布 / 设置 / 星图要显示头像时都调这一个函数，别各写一遍（"函数几何被抄四遍"的教训）。
 */
export function avatarOf(user) {
  const d = (user && user.username) ? defaultAvatar(user.username) : FALLBACK;
  const raw = (user && typeof user.avatar === 'string') ? user.avatar.trim() : '';
  if (AVATAR_DATA_RE.test(raw)) {
    return { kind: 'image', dataUrl: raw, symbol: d.symbol, color: d.color, custom: true };
  }
  const m = AVATAR_RE.exec(raw);
  if (m && AVATAR_SYMBOLS.includes(m[1]) && AVATAR_COLORS.includes(m[2])) {
    return { kind: 'glyph', symbol: m[1], color: m[2], dataUrl: '', custom: true };
  }
  return { kind: 'glyph', symbol: d.symbol, color: d.color, dataUrl: '', custom: false };
}

/** data URL 解码后的字节数（不真解码：base64 长度 → 字节数，够用来做上限判断） */
function dataUrlBytes(url) {
  const i = String(url).indexOf(',');
  const b64 = i < 0 ? '' : String(url).slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
}

/**
 * 选中的文件 → 可画的位图（调用方负责 release()）。
 * 优先 createImageBitmap：不经过 <img>、失败能拿到原因；老浏览器退回 <img> + blob URL。
 * 两条路都失败就抛**中文**错误 —— 调用方拿去 dialogAlert（项目里不许用原生 alert）。
 */
async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (e) {
      throw new Error('浏览器解不开这张图片（文件可能损坏，或者只是把别的文件改了扩展名）：' + ((e && e.message) || e));
    }
    if (!bmp.width || !bmp.height) { try { bmp.close(); } catch { /* 忽略 */ } throw new Error('这张图片的尺寸是 0（空图或损坏的图）。'); }
    return { source: bmp, w: bmp.width, h: bmp.height, release: () => { try { bmp.close(); } catch { /* 忽略 */ } } };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('浏览器解不开这张图片（文件可能损坏，或者只是把别的文件改了扩展名）。'));
      img.src = url;
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error('这张图片的尺寸是 0（空图或损坏的图）。');
  }
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/**
 * 位图 → 128×128 的 data URL。
 * 裁剪方式：**按短边居中裁剪（cover）**。理由：头像在界面上是圆/方形，等比缩放（contain）会在
 *   两侧留下透明或黑边，套进圆形头像里就是一圈难看的镶边；短边裁剪保证画面**填满**方框、
 *   主体留在正中（用户选的通常是头像照或图形，主体本来就在中间）。
 * 编码：先要 WebP（同画质体积约为 PNG 的几分之一，还支持透明）；浏览器不支持 WebP 时
 *   toDataURL 会**原样退回 PNG** —— 用返回值的真实前缀判断，不靠 UA 猜。
 * 质量阶梯：128×128 正常只有几 KB；万一压不进上限就往下调质量，而不是把失败直接甩给用户。
 */
function encodeAvatar({ source, w, h }) {
  const side = Math.min(w, h);
  const sx = Math.round((w - side) / 2);
  const sy = Math.round((h - side) / 2);
  const cv = document.createElement('canvas');
  cv.width = AVATAR_PX;
  cv.height = AVATAR_PX;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('浏览器拿不到 2D 画布，没法缩放图片。');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  let out = '';
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    let url = cv.toDataURL('image/webp', q);
    if (!/^data:image\/webp;base64,/.test(url)) url = cv.toDataURL('image/png');   // 不支持 WebP → 退回 PNG
    out = url;
    if (url.length <= AVATAR_DATA_URL_MAX - 512 && dataUrlBytes(url) <= AVATAR_BYTES_MAX) break;
  }
  if (!AVATAR_DATA_RE.test(out)) throw new Error('图片编码失败（浏览器没有产出可用的 data URL）。');
  if (out.length > AVATAR_DATA_URL_MAX || dataUrlBytes(out) > AVATAR_BYTES_MAX) {
    throw new Error('这张图片压缩后还是太大，请换一张更简单的图（或先裁剪一下再上传）。');
  }
  return out;
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
        <span class="mineAvatar" data-role="avatar" data-state="glyph" aria-hidden="true"><span class="mineAvatarGlyph" data-paint="glyph">⟡</span><img class="mineAvatarImg" data-paint="img" alt="" hidden></span>
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
      <div class="accHint">两种都行：上传一张本地图片（会先缩到 128×128），或者用内置符号 + 主题色（点一下即保存）。</div>
      <div class="mineUpload" data-role="upload" data-busy="off">
        <div class="minePreview" data-role="preview" data-state="glyph">
          <span class="minePreviewGlyph" data-paint="glyph" aria-hidden="true">⟡</span><img class="minePreviewImg" data-paint="img" alt="当前头像预览" hidden>
        </div>
        <div class="mineUploadSide">
          <div class="mineUploadBtns">
            <button class="mineMini" type="button" data-role="pick">上传图片…</button>
            <button class="mineMini" type="button" data-role="reset">恢复内置头像</button>
          </div>
          <div class="accImp" data-role="uploadTip">${UPLOAD_TIP}</div>
        </div>
        <input class="mineFile" data-role="file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
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

  /** 弹窗里**原样**显示后端的 error / code / hint / details，同时把详细说明留在卡片下方（不假装成功） */
  async function reportError(title, e) {
    setDetail(explain(e, title + '：'));
    const detail = [
      e && e.code ? '错误码：' + e.code + (e.status ? `（HTTP ${e.status}）` : '') : '',
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

  /**
   * 把一个"头像框"画成 av 的样子。
   * ★ 两种形态的节点**一开始就都在 DOM 里**（类契约普查是双向的：只在某状态才出现的类会被判成死规则），
   *   这里只切 data-state 与 hidden / src —— 不做"按需创建/删除节点"。
   */
  function paintAvatarBox(box, av) {
    if (!box) return;
    const isImg = av.kind === 'image';
    box.dataset.state = isImg ? 'img' : 'glyph';
    box.style.setProperty('--c', av.color);
    const glyph = box.querySelector('[data-paint="glyph"]');
    const img = box.querySelector('[data-paint="img"]');
    if (glyph) glyph.textContent = av.symbol;
    if (img) {
      if (isImg) { img.src = av.dataUrl; img.hidden = false; }
      else { img.hidden = true; img.removeAttribute('src'); }
    }
  }

  function renderAccount() {
    const av = avatarOf(user);
    paintAvatarBox(q('avatar'), av);
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

  /** 上传区的状态：data-busy 走 data 属性；三个控件的可用性跟着"登录 + 当前形态 + 是否在处理中" */
  function setUploadBusy(busy, tip) {
    const av = avatarOf(user);
    q('upload').dataset.busy = busy ? 'on' : 'off';
    q('pick').disabled = !!busy || !user;
    q('reset').disabled = !!busy || !user || av.kind !== 'image';
    q('file').disabled = !!busy || !user;
    q('uploadTip').textContent = tip || UPLOAD_TIP;
  }

  function renderAvatar() {
    const av = avatarOf(user);
    paintAvatarBox(q('preview'), av);
    q('avatarState').textContent = !user ? '登录后可保存'
      : (av.kind === 'image' ? '已保存到云端（上传的图片）' : (av.custom ? '已保存到云端' : '默认（点一下即保存）'));
    // 图片形态时，内置符号/色板都不选中（当前用的不是它们）；点一下就会切回内置形态
    for (const b of q('glyphs').children) b.dataset.state = (user && av.kind === 'glyph' && b.dataset.glyph === av.symbol) ? 'on' : 'off';
    for (const b of q('colors').children) b.dataset.state = (user && av.kind === 'glyph' && b.dataset.color === av.color) ? 'on' : 'off';
    setUploadBusy(false);
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

  /** ② 头像（内置形态）：点符号或颜色 → 立刻 PATCH /me（符号与颜色一起提交，后端只认白名单）。
   *  当前是上传的图片时，cur 给的是"按用户名派生的默认符号/颜色" → 点一下就等于切回内置形态。 */
  async function pickAvatar(patch) {
    if (!user) { await needLogin(); return; }
    const cur = avatarOf(user);
    const next = { symbol: patch.symbol || cur.symbol, color: patch.color || cur.color };
    const seq = ++avatarSeq;
    q('avatarState').textContent = '保存中…';
    q('uploadTip').textContent = '正在切回内置头像…';
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

  /**
   * ②b 头像（上传形态）：选中的本地图片 → 浏览器里缩放 → 立即预览 → PATCH /me。
   * 顺序刻意是"**先预览、再保存**"：用户马上看到结果，而不是盯着一个没反应的按钮；
   * 保存失败时把预览**退回服务器上的真实状态**（见 catch）——不假装成功、也不留一个没存上的图。
   */
  async function uploadAvatar(file) {
    if (!user) { await needLogin(); return; }
    if (!file) return;
    // ① 本地预检：类型（accept 只是给文件对话框的**建议**，用户完全可以强行选别的文件）
    const type = String(file.type || '').toLowerCase();
    if (!UPLOAD_MIMES.includes(type)) {
      await dialogAlert({
        kind: 'error',
        title: '这个文件不是支持的图片格式',
        body: `选中的文件类型是 ${type || '（浏览器没给出类型）'}，文件名 ${file.name || '（未知）'}。`,
        detail: /svg/i.test(type)
          ? 'SVG 不能当头像：它是可执行的文档（能内嵌脚本），服务器也会拒绝。请换 PNG / JPEG / WebP 图片。'
          : '只支持 PNG / JPEG / WebP 三种图片。可以先用系统截图工具截一张，再上传。',
      });
      return;
    }
    if (file.size > UPLOAD_MAX_FILE) {
      await dialogAlert({
        kind: 'error',
        title: '这张图片太大了',
        body: `文件 ${fmtBytes(file.size)}，超过本地上限 ${fmtBytes(UPLOAD_MAX_FILE)}。`,
        detail: '头像最终只有 128×128，不需要这么大的原图；请先裁剪或导出一张小一点的。',
      });
      return;
    }
    setUploadBusy(true, `正在处理「${file.name || '图片'}」（${fmtBytes(file.size)}）…`);
    // ② 解码：失败要给明确的中文原因，而不是"上传失败"四个字
    let decoded;
    try {
      decoded = await decodeImageFile(file);
    } catch (e) {
      setUploadBusy(false);
      await dialogAlert({ kind: 'error', title: '这张图片打不开', body: (e && e.message) || String(e), detail: '换一张图片试试（PNG / JPEG / WebP）。' });
      return;
    }
    let dataUrl;
    try {
      dataUrl = encodeAvatar(decoded);              // 128×128，短边居中裁剪，WebP（不支持则 PNG）
    } catch (e) {
      setUploadBusy(false);
      await dialogAlert({ kind: 'error', title: '图片处理失败', body: (e && e.message) || String(e), detail: '换一张图片试试（PNG / JPEG / WebP）。' });
      return;
    } finally {
      decoded.release();
    }
    // ③ 立即预览（还没保存）
    const seq = ++avatarSeq;
    const draft = { kind: 'image', dataUrl, symbol: avatarOf(user).symbol, color: avatarOf(user).color };
    paintAvatarBox(q('preview'), draft);
    setUploadBusy(true, `已缩到 ${AVATAR_PX}×${AVATAR_PX}（${fmtBytes(dataUrlBytes(dataUrl))}），正在保存到服务器…`);
    q('avatarState').textContent = '保存中…';
    try {
      const r = await updateMe({ avatar: dataUrl });
      if (seq !== avatarSeq) return;
      user = r.user;
      renderAccount(); renderAvatar();
      q('file').value = '';                          // 允许再次选同一个文件
      q('uploadTip').textContent = `已保存到云端（${AVATAR_PX}×${AVATAR_PX}，${fmtBytes(dataUrlBytes(dataUrl))}）。`;
    } catch (e) {
      if (seq !== avatarSeq) return;
      renderAccount(); renderAvatar();               // 回到服务器上的真实状态：没存上就不显示成存上了
      await reportError('保存头像失败', e);           // 后端返回的 error / code / hint 原样显示
    }
  }

  /** ②c 恢复内置头像：把上传的图片删掉，回到"符号 + 颜色"（默认值 = 按用户名派生，与账号一一对应） */
  async function resetAvatar() {
    if (!user) { await needLogin(); return; }
    if (avatarOf(user).kind !== 'image') {
      await dialogAlert({ title: '现在就是内置头像', body: '没有上传过图片，不需要恢复。', detail: '想换一个符号或颜色，直接点上面的方框和圆点即可。' });
      return;
    }
    const d = defaultAvatar(user.username);
    const seq = ++avatarSeq;
    setUploadBusy(true, '正在恢复内置头像…');
    try {
      const r = await updateMe({ avatar: d.symbol + '|' + d.color });
      if (seq !== avatarSeq) return;
      user = r.user;
      q('file').value = '';
      renderAccount(); renderAvatar();
      q('uploadTip').textContent = `已恢复内置头像：${d.symbol} ${d.color}（也可以点下面的符号或色板换一个）。`;
    } catch (e) {
      if (seq !== avatarSeq) return;
      renderAvatar();
      await reportError('恢复内置头像失败', e);
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
  // 「上传图片…」按钮只是个门面：真正干活的是那个隐藏的 <input type="file">（原生文件对话框只能由它唤起）
  q('pick').addEventListener('click', guard(() => {
    if (!user) return needLogin();
    q('file').click();
    return undefined;
  }));
  q('file').addEventListener('change', guard(() => {
    const f = q('file').files && q('file').files[0];
    return f ? uploadAvatar(f) : undefined;
  }));
  q('reset').addEventListener('click', guard(resetAvatar));
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
