// 成就瞬间画面（用户要求 ⑦「其它」里的设置项：拍摄成就瞬间画面）
//
// 设计要点：
//   · 只存**缩略图**（等比缩到宽 320 的 JPEG）—— localStorage 只有几 MB，全尺寸截图会很快写爆；
//   · 有界历史（最多 MAX 条，先进先出）—— 不无限增长；
//   · 捕获失败（画布被跨域污染等）必须返回 { ok:false, error }，由调用方提示，**不静默**。
const KEY = 'interweaver.achshots.v1';
export const MAX_SHOTS = 8;

/** 从画布截取缩略图 dataURL；返回 { ok, data?, w?, h? } 或 { ok:false, error } */
export function captureShot(canvas, maxW = 320) {
  if (!canvas || typeof canvas.toDataURL !== 'function') return { ok: false, error: '拿不到画布' };
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return { ok: false, error: '画布还没有尺寸' };
  const scale = Math.min(1, maxW / w);
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
  try {
    const off = document.createElement('canvas');
    off.width = tw; off.height = th;
    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h, 0, 0, tw, th);
    const data = off.toDataURL('image/jpeg', 0.6);
    if (!data || data.length < 64) return { ok: false, error: '截图内容为空' };
    return { ok: true, data, w: tw, h: th };
  } catch (e) {
    return { ok: false, error: '截图失败：' + (e && e.message ? e.message : String(e)) };
  }
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeAll(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); return true; } catch { return false; }
}

/** 记录一次成就瞬间；返回 { ok, shot?, error?, count? } */
export function recordShot(canvas, ach) {
  const cap = captureShot(canvas);
  if (!cap.ok) return { ok: false, error: cap.error };
  const shot = {
    id: ach && ach.id ? String(ach.id) : 'unknown',
    title: ach && ach.title ? String(ach.title) : '成就',
    cls: ach && ach.cls ? String(ach.cls) : 'solo',
    at: Date.now(),
    w: cap.w, h: cap.h,
    data: cap.data,
  };
  const arr = readAll();
  arr.push(shot);
  while (arr.length > MAX_SHOTS) arr.shift();   // 有界：先进先出
  if (!writeAll(arr)) return { ok: false, error: '写入本地存储失败（可能已满）' };
  return { ok: true, shot, count: arr.length };
}

/** 最近的成就在前 */
export function listShots() {
  return readAll().slice().reverse();
}

export function clearShots() {
  try { localStorage.removeItem(KEY); return { ok: true }; } catch { return { ok: false, error: '清除失败' }; }
}

export const SHOTS_STORAGE_KEY = KEY;
