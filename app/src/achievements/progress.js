// S7 · 进度导出/导入（成就 + 知识网）
//
// 三条硬规则（对应用户决策）：
//   ① 成就**只增不减**：导入是"并集"，同一条成就取**更早**的达成时间；
//   ② 非法文件**报错且不写库**（绝不做"尽力而为"的部分写入）；
//   ③ 版本可迁移：当前 v1；未知/更高版本给出明确错误，不猜。
import { exportTracker, importTracker } from './tracker.js';
import { exportNet, importNet } from './weave.js';

export const PROGRESS_VERSION = 1;

export function exportProgress(rt) {
  return {
    kind: 'interweaver.progress',
    v: PROGRESS_VERSION,
    exportedAt: new Date().toISOString(),
    tracker: exportTracker(rt.tracker),
    net: exportNet(rt.net),
  };
}

export function serializeProgress(rt) {
  return JSON.stringify(exportProgress(rt), null, 2);
}

/** 只校验，不写入 —— 便于 UI 先给用户看清楚"要导入什么" */
export function inspectProgress(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; }
  catch { return { ok: false, error: '不是合法的 JSON 文件' }; }
  if (!data || typeof data !== 'object') return { ok: false, error: '内容不是一个对象' };
  if (data.kind !== 'interweaver.progress') return { ok: false, error: '这不是交织者的进度文件（缺少 kind 标记）' };
  if (!Number.isInteger(data.v)) return { ok: false, error: '缺少版本号' };
  if (data.v > PROGRESS_VERSION) return { ok: false, error: `文件版本 v${data.v} 比当前程序（v${PROGRESS_VERSION}）更新，请先升级` };
  if (!data.tracker || !Array.isArray(data.tracker.granted)) return { ok: false, error: '缺少成就数据' };
  if (!data.net || !Array.isArray(data.net.nodes) || !Array.isArray(data.net.edges)) return { ok: false, error: '缺少知识网数据' };
  return {
    ok: true, version: data.v,
    achievements: data.tracker.granted.length,
    nodes: data.net.nodes.length,
    edges: data.net.edges.length,
    exportedAt: data.exportedAt || null,
  };
}

/** 旧版本迁移（目前只有 v1；留出迁移位，未知版本已在 inspect 阶段拦下） */
export function migrateProgress(data) {
  if (data.v === PROGRESS_VERSION) return data;
  return null;
}

/**
 * 导入。
 * @param mode 'merge'（默认，并集）| 'replace'（先清空）
 * @returns { ok, added:{achievements,nodes,edges}, error? }
 */
export function importProgress(rt, text, { mode = 'merge' } = {}) {
  const info = inspectProgress(text);
  if (!info.ok) return { ok: false, error: info.error };
  const data = migrateProgress(typeof text === 'string' ? JSON.parse(text) : text);
  if (!data) return { ok: false, error: '版本迁移失败（未知版本）' };

  if (mode === 'replace') rt.reset();
  const a = importTracker(rt.tracker, data.tracker);
  const netRes = importNet(rt.net, data.net);
  rt.save();
  return { ok: true, added: { achievements: a, nodes: netRes.nodes, edges: netRes.edges }, inspected: info };
}
