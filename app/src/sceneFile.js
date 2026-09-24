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
  if (cam) { cam.x = 0; cam.y = 0; cam.z = 40; }
  S.ensureEvaluated(st);
  S.emit(st, 'structure');
  clearDraft();
  return { ok: true };
}

// ---------- 自动草稿（防丢；与文件格式同源） ----------

export function saveDraft(st, cam, name) {
  try {
    const text = JSON.stringify({ name: name || '未命名场景', text: sceneToText(st, name || '未命名场景', cam), at: Date.now() });
    localStorage.setItem(DRAFT_KEY, text);
    return true;
  } catch { return false; }
}

export function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.text !== 'string') return null;
    const info = inspectScene(o.text);
    if (!info.ok) return null;
    return { name: o.name || '未命名场景', text: o.text, at: o.at || 0 };
  } catch { return null; }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
}

export const DRAFT_STORAGE_KEY = DRAFT_KEY;
