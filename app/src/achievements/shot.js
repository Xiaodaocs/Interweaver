// T7 · 成就解锁瞬间的"当时的图片"（设计 §7.1）
//
// 用户决定：**默认关闭**，可在设置里开启。关闭时**不产生任何截图开销**。
// 做法：从画布 drawImage 到 320×200 离屏 canvas（居中于触发该成就的实体群包围盒），
//       toDataURL('image/jpeg', 0.72) —— 约 12–25KB；失败则记 shot:null，**不阻塞成就**。
//
// ★ 拍摄开关属于**用户数据**：按账号分键（interweaver.u<id>.shots）——
//   用户要求"每个账号都是独立的"：换账号后这个开关各是各的。
//   读写都走 userScope（还没归属的全局旧键仍会被本人读到，不会弄丢既有选择）。
import { readUserValue, writeUserValue } from '../userScope.js';

const KEY = 'interweaver.shots';
const W = 320, H = 200;
const QUALITY = 0.72;

let enabled = null;

export function shotsEnabled() {
  if (enabled !== null) return enabled;
  try { enabled = readUserValue(KEY) === '1'; } catch { enabled = false; }
  return enabled;                       // 默认关闭
}

export function setShotsEnabled(on) {
  enabled = !!on;
  try { writeUserValue(KEY, on ? '1' : '0'); } catch { /* 忽略 */ }
  return enabled;
}

/**
 * 抓一张"当时"的画面。
 * @param canvas 画布元素
 * @param center 世界坐标下要居中的点（触发该成就的实体群中心）；缺省用画布中心
 * @param cam 相机
 * @returns dataURL | null
 */
export function captureShot(canvas, cam, center) {
  if (!shotsEnabled() || !canvas) return null;
  try {
    const src = canvas;
    const dpr = src.width / Math.max(1, src.clientWidth || src.width);
    // 源区域：以 center 对应屏幕点为中心，取 4:2.5 比例的窗口（与目标尺寸同比例）
    let cx = src.width / 2, cy = src.height / 2;
    if (center && cam && typeof cam.w2s === 'function') {
      const [sx, sy] = cam.w2s(center[0], center[1]);
      cx = sx * dpr; cy = sy * dpr;
    }
    const sw = Math.min(src.width, src.height * (W / H));
    const sh = sw * (H / W);
    const sx0 = Math.max(0, Math.min(src.width - sw, cx - sw / 2));
    const sy0 = Math.max(0, Math.min(src.height - sh, cy - sh / 2));
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const g = off.getContext('2d');
    // 深色主题下先铺一层纸面，避免 JPEG 的黑边（JPEG 不支持透明）
    g.fillStyle = '#0B0E16';
    g.fillRect(0, 0, W, H);
    g.drawImage(src, sx0, sy0, sw, sh, 0, 0, W, H);
    const url = off.toDataURL('image/jpeg', QUALITY);
    return url && url.length > 100 ? url : null;
  } catch {
    return null;                        // 失败不阻塞成就
  }
}

/** 供核验/导出：估算已存快照的总字节数 */
export function shotsBytes(granted) {
  let n = 0, bytes = 0;
  for (const g of granted.values ? granted.values() : []) {
    if (g && typeof g.shot === 'string') { n++; bytes += g.shot.length * 0.75; }
  }
  return { count: n, bytes: Math.round(bytes) };
}
