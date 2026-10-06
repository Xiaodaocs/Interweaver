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
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
}

export const DRAFT_STORAGE_KEY = DRAFT_KEY;

// ---------------------------------------------------------------------------
// 草稿的"前后端分离"适配层
//   · 已登录 + 在线：草稿是**用户数据** → 只落后端（绝不静默退回本地 ✗）
//   · 访客 / 离线：没有服务器账号 → 仍落 localStorage（与切换前完全一致 ✓）
//   · 闸门在揭层之前调用 adoptRemoteDraft(doc)，把后端草稿放进内存 → 上面的读取函数直接用它
//   · 之所以放在文件末尾：函数声明会提升，可被上面的代码调用；import 在模块里同样提升。
// ---------------------------------------------------------------------------
import { putDoc } from './api.js';
import * as IW_MODE from './appMode.js';

let remoteDraftText = null;      // 后端草稿文本（'' 视为"没有草稿"）

export function adoptRemoteDraft(doc) {
  if (doc && typeof doc === 'object' && typeof doc.text === 'string') { remoteDraftText = doc.text; return true; }
  if (typeof doc === 'string') { remoteDraftText = doc; return true; }
  return false;
}

function readDraftRaw() {
  if (remoteDraftText !== null) return remoteDraftText === '' ? null : remoteDraftText;
  try { return localStorage.getItem(DRAFT_KEY); } catch { return null; }
}

function writeDraftRaw(text) {
  if (IW_MODE.isOnline() && IW_MODE.getUser()) {
    remoteDraftText = text;
    putDoc('draft', { text: text, savedAt: Date.now() }).catch(() => { /* 已在 onBackendState 上报，不假装成功 */ });
    return;
  }
  try { localStorage.setItem(DRAFT_KEY, text); } catch { /* 隐私模式等 */ }
}
