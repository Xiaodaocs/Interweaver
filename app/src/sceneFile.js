// .iwz 文件格式与自动草稿（用户要求 ⑦：可保存、可打开的自创文件格式）
//
// 设计：
//   · 文件内容 = scenes/schema.js 的 serializeScene 产物（JSON，带 kind/版本号），扩展名 .iwz；
//     打开时用 inspectScene 校验（不是本程序的文件、版本过新、实体类型不认识都会明确报错），
//     再由 deserializeScene **先建临时状态再提交**（失败完全不改动当前画布）。
//   · 打开方式（用户拍板 Q2）：浏览器下载 + 文件选择；另配**自动草稿**（localStorage）防丢。
//   · 不做静默失败：每一步失败都返回 { ok:false, error } 交给界面提示。
import { serializeScene, deserializeScene, inspectScene } from './scenes/schema.js';

export const FILE_EXT = '.iwz';
export const FILE_MIME = 'application/json';
const DRAFT_KEY = 'interweaver.draft.v1';

/** 场景 → 文件文本 */
export function sceneToText(st, name, cam) {
  return JSON.stringify(serializeScene(st, name, cam), null, 2);
}

/** 触发浏览器下载；返回文件名 */
export function downloadScene(st, cam, name) {
  const safe = String(name || '未命名场景').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '未命名场景';
  const filename = safe + FILE_EXT;
  const text = sceneToText(st, safe, cam);
  const blob = new Blob([text], { type: FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, filename, bytes: text.length };
}

/** 弹出文件选择并载入；返回 Promise<{ok, error?, name?, counts?}> */
export function pickSceneFile(st, S, cam) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_EXT + ',.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) { input.remove(); resolve({ ok: false, error: '没有选择文件' }); return; }
      const rd = new FileReader();
      rd.onload = () => {
        const text = String(rd.result || '');
        const info = inspectScene(text);
        if (!info.ok) { input.remove(); resolve({ ok: false, error: info.error }); return; }
        const r = deserializeScene(st, S, text, cam);
        input.remove();
        if (!r.ok) { resolve({ ok: false, error: r.error }); return; }
        resolve({ ok: true, name: info.name, counts: r.counts || null });
      };
      rd.onerror = () => { input.remove(); resolve({ ok: false, error: '读取文件失败' }); };
      rd.readAsText(f);
    });
    input.click();
  });
}

/** 新建：清空到干净状态（与"打开空场景"等价，并把草稿一并清掉，避免下次又被恢复） */
export function newScene(st, S, cam) {
  st.entities.clear();
  st.bindings.clear();
  st.selection.clear();
  st.variables.clear();
  st.constraints.clear();
  st.probes.clear();
  // ★ 用户报告（⑩）："新建画布后所有实体的名称仍然根据最早打开软件那一刻开始记的数量，
  //   需要调整为每次新打开软件数量归零（放第一个点为 p1）"。
  //   命名用的是 st.counters（按前缀计数）+ st.seq/bseq/cseq（id 序号），
  //   它们只在 createState() 时初始化一次，而"新建"是复用同一个 state 对象 → 计数一直往上加。
  //   这里把命名相关的计数器一并归零：新建之后第一个点就是 p1。
  st.counters = {};
  st.seq = 1;
  st.bseq = 1;
  st.cseq = 1;
  st.colorIdx = 0;
  if (cam) { cam.x = 0; cam.y = 0; cam.z = 40; }
  S.ensureEvaluated(st);
  S.emit(st, 'structure');
  clearDraft();
  return { ok: true };
}

// ---------- 自动草稿（防丢；与文件格式同源） ----------

// 最近一次草稿操作的结果（供 UI 提示与排查）。原来的实现把失败**静默吞掉**，
// 用户遇到"草稿没了"时既没有提示、也无从判断是哪一步坏的 —— 实测就是这样。
export let lastDraftStatus = null;

export function saveDraft(st, cam, name) {
  try {
    const text = JSON.stringify({ name: name || '未命名场景', text: sceneToText(st, name || '未命名场景', cam), at: Date.now() });
    writeDraftRaw(text);   // 登录后落后端；访客/离线落本地（见文件末尾的适配层）
    lastDraftStatus = { ok: true, at: Date.now(), bytes: text.length };
    return true;
  } catch (e) {
    lastDraftStatus = { ok: false, why: '写入失败：' + String((e && e.message) || e) };
    return false;
  }
}

export function readDraft() {
  const r = readDraftDetailed();
  return r.ok ? r.draft : null;
}

/** 读草稿并**说明原因**：以前三条失败路径都是静默 return null，导致"草稿没了还没有提示"。
 *  返回值：{ ok:true, draft } 或 { ok:false, why:'…', hadDraft:boolean } */
export function readDraftDetailed() {
  let raw = null;
  try { raw = readDraftRaw(); }
  catch (e) { return { ok: false, why: '无法读取本地存储：' + String((e && e.message) || e), hadDraft: false }; }
  if (!raw) return { ok: false, why: '本地存储里没有草稿', hadDraft: false };
  let o = null;
  try { o = JSON.parse(raw); }
  catch (e) { return { ok: false, why: '草稿不是合法 JSON（' + raw.length + ' 字节）：' + String((e && e.message) || e), hadDraft: true }; }
  if (!o || typeof o.text !== 'string') return { ok: false, why: '草稿结构不对（缺少 text 字段）', hadDraft: true };
  const info = inspectScene(o.text);
  if (!info.ok) return { ok: false, why: '草稿场景校验不通过：' + (info.error || '未知原因'), hadDraft: true };
  return { ok: true, draft: { name: o.name || '未命名场景', text: o.text, at: o.at || 0 } };
}

export function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch { /* 忽略 */ }
}

/** 基准键名（真实键名按账号命名空间化，见 userScope.js） */
export const DRAFT_STORAGE_KEY = DRAFT_KEY;

// ---------------------------------------------------------------------------
// 草稿的"前后端分离"适配层
//   · 已登录 + 在线：草稿是**用户数据** → 落后端（putDoc('draft')）；
//   · 访客 / 离线：没有服务器账号 → 仍落 localStorage（与切换前完全一致 ✓）
//   · 闸门在揭层之前调用 adoptRemoteDraft(doc)，把后端草稿放进内存 → 上面的读取函数直接用它
//   · 之所以放在文件末尾：函数声明会提升，可被上面的代码调用；import 在模块里同样提升。
//
// ★ 每个账号独立（用户报告的 bug）：本地键按账号命名空间化。已登录时**绝不**读旧的全局键 ——
//   同一浏览器换账号登录，新账号读到的只会是自己命名空间里的草稿（没有就是空的）。
//   已登录时本地那份是**镜像**（与后端同一份字节），这样"开屏时先恢复画布"（main.js 在闸门之前
//   就跑 readDraft）仍然拿得到自己的草稿，而不会像以前那样把上一号的草稿恢复出来。
// ---------------------------------------------------------------------------
import { putDoc } from './api.js';
import * as IW_MODE from './appMode.js';
import { scopedKey } from './userScope.js';

let remoteDraftText = null;      // 后端草稿文本（'' 视为"没有草稿"）
let remoteSavedAt = null;        // 后端那份的 savedAt（用于判断"服务器是不是更新"）

function draftKey() { return scopedKey(DRAFT_KEY); }

function readLocal() {
  try { return localStorage.getItem(draftKey()); } catch { return null; }
}
/** 草稿外壳 {name,text,at} 的本地时间戳（取不到 → null） */
function localStamp(raw) {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return Number.isFinite(o && o.at) ? o.at : null; } catch { return null; }
}

/**
 * 后端草稿文档 → 本模块统一的"草稿外壳文本"（{"name":…,"text":<场景JSON>,"at":…}）。
 * 两种形态都要认（**踩过**）：
 *   · 本模块写上去的：{ text: <外壳文本>, savedAt }；
 *   · 旧数据导入（/import）把本机那份外壳**原样**存进 docs.draft：{ name, text: <场景JSON>, at } ——
 *     这时 doc.text 是**场景**文本，doc 自己才是外壳。以前只认第一种，于是导入过的账号一开机就
 *     提示"草稿结构不对（缺少 text 字段）"，草稿等于读不出来。
 */
function normalizeDraftDoc(doc) {
  if (typeof doc === 'string') return doc || null;
  if (!doc || typeof doc !== 'object' || typeof doc.text !== 'string' || !doc.text) return null;
  const t = doc.text;
  let sceneLike = false;
  try { sceneLike = inspectScene(t).ok; } catch { sceneLike = false; }
  if (!sceneLike) return t;                                   // 第一种形态（或本来就不是场景，原样交给上层校验）
  return JSON.stringify({ name: doc.name || '未命名场景', text: t, at: Number.isFinite(doc.at) ? doc.at : (Number.isFinite(doc.savedAt) ? doc.savedAt : Date.now()) });
}

export function adoptRemoteDraft(doc) {
  if (typeof doc === 'string') { remoteDraftText = doc; remoteSavedAt = null; mirrorRemote(); applyToCanvasIfNeeded(); return true; }
  const normalized = normalizeDraftDoc(doc);
  if (!normalized) return false;
  remoteDraftText = normalized;
  remoteSavedAt = Number.isFinite(doc && doc.savedAt) ? doc.savedAt : (Number.isFinite(doc && doc.at) ? doc.at : null);
  mirrorRemote();
  applyToCanvasIfNeeded();
  return true;
}

/** 把后端草稿镜像到本账号的本地键（与后端同一份字节；下次开屏先由它恢复画布） */
function mirrorRemote() {
  if (remoteDraftText === null || remoteDraftText === '') return;
  try { localStorage.setItem(draftKey(), remoteDraftText); } catch { /* 隐私模式/配额 */ }
}

/**
 * 把**账号里的**草稿放到画布上。
 * 为什么需要这一步：main.js 恢复草稿发生在开屏闸门揭层**之前**（那时后端草稿还没取回来），
 * 所以"后端草稿"必须在这里补一次；否则新设备/清过缓存的账号会看到空画布，
 * 而且 4 秒后的自动保存会把这份空画布**覆盖写回账号**（= 真丢数据）。
 * 只在两种情况下动手：① 画布还是空的；② 服务器那份明显更新（另一台设备写过）。
 */
function applyToCanvasIfNeeded() {
  try {
    const IW = globalThis.__IW;
    const st = IW && IW.st;
    const text = remoteDraftText;
    if (!st || !st.entities || typeof text !== 'string' || !text) return false;
    const local = readLocal();
    if (local === text) return false;                          // 与本地镜像一致：画布已是这份内容
    const empty = st.entities.size === 0;
    const localAt = localStamp(local);
    const serverNewer = Number.isFinite(remoteSavedAt) && (!Number.isFinite(localAt) || remoteSavedAt > localAt + 5000);
    if (!empty && !serverNewer) return false;                  // 保留本机恢复出来的那份（本机才是最新）
    const shell = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const sceneText = shell && typeof shell.text === 'string' ? shell.text : text;
    const r = deserializeScene(st, IW.S, sceneText, IW.cam);
    if (!r || r.ok === false) return false;
    try { IW.S && IW.S.emit && IW.S.emit(st, 'structure'); } catch { /* 忽略 */ }
    try { if (typeof IW.renderOnce === 'function') IW.renderOnce(); } catch { /* 忽略 */ }
    return true;
  } catch { return false; }        // 任何意外都不该影响开机
}

function readDraftRaw() {
  if (remoteDraftText !== null) return remoteDraftText === '' ? null : remoteDraftText;
  return readLocal();              // 本账号命名空间（访客 = 旧的全局键）
}

function writeDraftRaw(text) {
  if (IW_MODE.isOnline() && IW_MODE.getUser()) {
    remoteDraftText = text;
    remoteSavedAt = Date.now();
    try { localStorage.setItem(draftKey(), text); } catch { /* 隐私模式等 */ }   // 本账号的镜像（绝不写全局键）
    putDoc('draft', { text: text, savedAt: Date.now() }).catch(() => { /* 已在 onBackendState 上报，不假装成功 */ });
    return;
  }
  try { localStorage.setItem(draftKey(), text); } catch { /* 隐私模式等 */ }
}

/** 诊断用：当前账号 / 实际键名 / 是否已拿到后端草稿（验收脚本据此断言"没有串号"） */
export function draftDebug() {
  return { key: draftKey(), hasRemote: remoteDraftText !== null, local: readLocal() };
}
