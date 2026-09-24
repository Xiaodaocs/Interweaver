// S7 · 场景序列化 schema v1 + 版本迁移
//
// 设计要点（都是为了避免"存了但还原不出来"这类坑）：
//   ① 只存**可重建的事实**：实体（类型/参数/附加字段）、变量、绑定（存 `src` 文本而不是 AST，
//      因为 AST 里的实体引用是**标签**，重建时按同样顺序加回实体即可得到同样的标签）、
//      约束、观察器、相机；
//   ② 反序列化**先在临时状态里建完**，全部成功才提交 —— 任何一步失败都返回 error 且**不改动当前场景**；
//   ③ 版本迁移：当前 v1；更高版本明确拒绝（不猜、不"尽力而为"）。
import { REGISTRY } from '../entities.js';
import { ALL_PATTERNS } from '../achievements/runtime.js';

export const SCENE_VERSION = 1;
export const SCENE_KIND = 'interweaver.scene';

void ALL_PATTERNS;

export function serializeScene(st, name = '未命名场景', cam = null) {
  const entities = [...st.entities.values()].map((e) => {
    const rec = { type: e.type, label: e.label, color: e.color, params: { ...e.params } };
    for (const k of ['count', 'host', 'a', 'b', 'sa', 'sb', 'expr', 'roam', 'kind', 'cs', 'parent']) {   // cs/parent = ③ 坐标系归属与互连
      if (e[k] !== undefined) rec[k] = e[k];
    }
    if (e.ast) rec.ast = e.ast;
    return rec;
  });
  const variables = [...st.variables.values()].map((v) => ({ name: v.name, value: v.value, min: v.min, max: v.max, step: v.step, anim: !!v.anim }));
  const bindings = [...st.bindings.values()].map((b) => ({ target: { ent: b.target.ent, param: b.target.param }, src: b.src }));
  const constraints = [...st.constraints.values()].map((c) => ({ kind: c.kind, refs: [...(c.refs || [])] }));
  const probes = [...st.probes.values()].map((p) => ({ ...p }));
  return {
    kind: SCENE_KIND, v: SCENE_VERSION, name,
    savedAt: new Date().toISOString(),
    cam: cam ? { x: cam.x, y: cam.y, z: cam.z } : null,
    entities, variables, bindings, constraints, probes,
  };
}

export function inspectScene(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; }
  catch { return { ok: false, error: '不是合法的 JSON' }; }
  if (!data || typeof data !== 'object') return { ok: false, error: '内容不是一个对象' };
  if (data.kind !== SCENE_KIND) return { ok: false, error: '这不是交织者的场景文件（缺少 kind 标记）' };
  if (!Number.isInteger(data.v)) return { ok: false, error: '缺少版本号' };
  if (data.v > SCENE_VERSION) return { ok: false, error: `场景版本 v${data.v} 比当前程序（v${SCENE_VERSION}）更新，请先升级` };
  if (!Array.isArray(data.entities)) return { ok: false, error: '缺少实体列表' };
  for (const e of data.entities) {
    if (!e || typeof e.type !== 'string' || !REGISTRY[e.type]) return { ok: false, error: `不认识的实体类型：${e && e.type}` };
  }
  return { ok: true, version: data.v, name: data.name || '未命名场景', entities: data.entities.length, bindings: (data.bindings || []).length, savedAt: data.savedAt || null };
}

export function migrateScene(data) {
  if (!data || data.v === SCENE_VERSION) return data;
  return null;
}

/**
 * 反序列化并**提交**到 st（失败则完全不改动 st）。
 * @param st 目标状态
 * @param S  状态模块（注入，便于测试与依赖清晰）
 * @returns { ok, error?, counts? }
 */
export function deserializeScene(st, S, text, cam = null) {
  const data = typeof text === 'string' ? (() => { try { return JSON.parse(text); } catch { return null; } })() : text;
  const info = inspectScene(data);
  if (!info.ok) return { ok: false, error: info.error };
  const migrated = migrateScene(data);
  if (!migrated) return { ok: false, error: '版本迁移失败（未知版本）' };

  // ① 先在"临时状态"里完整重建（不动 st）
  const tmp = S.createState();
  const labelToId = new Map();
  try {
    for (const rec of migrated.entities) {
      const ent = S.addEntity(tmp, rec.type, { ...rec.params }, rec, true);
      if (!ent) throw new Error(`实体 ${rec.label}（${rec.type}）创建失败`);
      labelToId.set(rec.label, ent.id);
    }
    for (const v of migrated.variables || []) S.addVariable(tmp, v.name, { value: v.value, min: v.min, max: v.max, step: v.step, anim: v.anim });
    for (const b of migrated.bindings || []) {
      const id = labelToId.get(b.target.ent) || b.target.ent;
      const r = S.addBinding(tmp, id, b.target.param, b.src, true);
      if (r.error) throw new Error(`绑定 ${b.target.ent}.${b.target.param} ← ${b.src} 失败：${r.error}`);
    }
    for (const c of migrated.constraints || []) {
      const refs = (c.refs || []).map((x) => labelToId.get(x) || x);
      const r = S.addConstraint(tmp, c.kind, refs);
      if (r && r.error) throw new Error(`约束 ${c.kind} 失败：${r.error}`);
    }
    for (const p of migrated.probes || []) {
      const id = labelToId.get(p.entId) || p.entId;
      if (p.kind === 'derived') S.addProbe(tmp, id, p.key);
      else if (p.expr) S.addExprProbe(tmp, p.expr);
    }
    S.ensureEvaluated(tmp, { solve: true });
  } catch (err) {
    return { ok: false, error: String(err.message || err) };        // ② 失败：st 一点没动
  }

  // ③ 提交：整体替换
  st.entities = tmp.entities;
  st.bindings = tmp.bindings;
  st.variables = tmp.variables;
  st.constraints = tmp.constraints;
  st.probes = tmp.probes;
  st.selection = new Set();
  st.values = tmp.values; st.base = tmp.base; st.scope = tmp.scope; st.env = tmp.env;
  // ★ 修复（数据丢失级）：必须同时接管 id / 标签计数器。
  //   此前只搬实体、不搬计数器 → 加载场景（含每次打开工作台时的自动草稿恢复）后
  //   st.seq 退回 1，而实体 id 仍是 e1..eN → 下一个 addEntity 生成的 id 与已有实体撞号，
  //   Map.set 直接**覆盖**掉那个实体（用户实测：建一个圆 → 右键「以此创建坐标系」→ 圆被删除）。
  //   注：撤销栈的快照 serialize/deserialize 早已正确搬运这些计数器（见 state.js），
  //   这里属于漏搬，不是设计取舍。
  st.seq = tmp.seq;
  st.bseq = tmp.bseq;
  st.cseq = tmp.cseq;
  st.counters = tmp.counters;
  st.colorIdx = tmp.colorIdx;
  if (cam && migrated.cam) { cam.x = migrated.cam.x; cam.y = migrated.cam.y; cam.z = migrated.cam.z; }
  S.ensureEvaluated(st, { solve: true });
  return { ok: true, counts: { entities: st.entities.size, bindings: st.bindings.size, variables: st.variables.size } };
}
