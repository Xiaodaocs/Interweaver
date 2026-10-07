// S7 · 场景序列化 schema v1 + 版本迁移
//
// 设计要点（都是为了避免"存了但还原不出来"这类坑）：
//   ① 只存**可重建的事实**：实体（类型/参数/附加字段）、变量、绑定（存 `src` 文本而不是 AST，
//      因为 AST 里的实体引用是**标签**，重建时按同样顺序加回实体即可得到同样的标签）、
//      约束、观察器、相机；
//   ② 反序列化**先在临时状态里建完**，全部成功才提交 —— 任何一步失败都返回 error 且**不改动当前场景**；
//   ③ 版本迁移：当前 v1；更高版本明确拒绝（不猜、不"尽力而为"）。
//
// ★ 修订（用户报告："观察器无法被正确保存，无论云端还是刷新都会丢失。请仔细是否仍然存在这种
//   应该被保存但没有被正确存储的东西"）。实测（tests/check-scene-roundtrip.mjs）查明的根因**不是"没存"**，
//   而是三类"存了但回不来"：
//     · 实体附加字段原来是一张**白名单**（count/host/a/b/sa/sb/expr/roam/kind/cs/parent/ast）——
//       白名单外的字段一律丢：pts（自由曲线的采样点）、p1/p2（截取段/切线/割线/圆弧的两端）、
//       edge（多边形线上点属于哪条边）、diameterOf/fromLabel/fromType/picksFirst、autoGrouped、exprSrc…
//       → 现在**反过来**：除明确列出的"运行时重算缓存"外，实体的**所有字段**都入档（见 ENT_CACHE_KEYS）。
//       以后新增字段自动跟着场景走，"忘了补白名单"这一类静默丢失从结构上不再可能；
//     · 观察器恢复时**重新算名字**（addProbe 按"实体标签_派生量"生成）→ 改过名的派生观察器换了名字，
//       引用它的表达式与表达式观察器一起失效；表达式观察器更是**从来没被恢复过**（读的是 p.expr，
//       而真实字段叫 p.src）→ 现在按原名恢复（state.js 的 probeName），并同时认 src / expr 两种字段名；
//     · 结构引用（host/p1/p2/a/b/cs/parent/diameterOf、绑定的目标实体、约束 refs、观察器 entId）
//       存的是**实体 id**，而恢复时实体 id 是**重新发的**（e1..eN）→ 只要原场景删过实体（id 有空档，
//       例如"四条边自动并成多边形"就会删掉四条线段），最高那几个 id 在新场景里根本不存在：
//       绑定恢复失败 → **整个场景拒绝载入**（用户看到的"刷新/云端打开就全没了"）。
//       → 现在实体自己把 id 一起入档，恢复时建一张 旧 id → 新 id 的表，所有结构引用都按它重映射。
import { REGISTRY } from '../entities.js';
import { ALL_PATTERNS } from '../achievements/runtime.js';

export const SCENE_VERSION = 1;
export const SCENE_KIND = 'interweaver.scene';

// 运行时**重算/重建**的缓存：不入档（每一项都有理由，见 tests/check-scene-roundtrip.mjs 末尾清单）
//   · bound      —— 参数 → 绑定 id 的索引，addBinding 会自己回填
//   · _arc       —— 采样得到的圆弧几何缓存（evaluate 时重算）
//   · lastX/lastY—— 平行退化时用的"上一个有效交点"（求值过程量）
const ENT_CACHE_KEYS = new Set(['bound', '_arc', 'lastX', 'lastY']);
// 指向**别的实体**的字段：入档时原样存 id，恢复时必须按"旧 id → 新 id"重映射
const ENT_REF_KEYS = ['host', 'a', 'b', 'p1', 'p2', 'diameterOf', 'parent'];

void ALL_PATTERNS;

export function serializeScene(st, name = '未命名场景', cam = null) {
  const entities = [...st.entities.values()].map((e) => {
    const rec = { id: e.id, type: e.type, label: e.label, color: e.color, params: { ...e.params } };
    for (const k of Object.keys(e)) {
      if (k === 'id' || k === 'type' || k === 'label' || k === 'color' || k === 'params') continue;
      if (ENT_CACHE_KEYS.has(k)) continue;
      rec[k] = e[k];      // ★ 默认入档：新字段自动跟着场景走（不再靠白名单，见文件头 ★ 修订）
    }
    return rec;
  });
  const variables = [...st.variables.values()].map((v) => ({ ...v }));
  const bindings = [...st.bindings.values()].map((b) => ({ target: { ent: b.target.ent, param: b.target.param }, src: b.src }));
  const constraints = [...st.constraints.values()].map((c) => ({ kind: c.kind, refs: [...(c.refs || [])] }));
  // 观察器：原样入档。注意表达式型观察器的**表达式原文**字段叫 `src`（`{name, kind:'expr', src, ast}`），
  // 早期版本的恢复分支却去读 `p.expr` → 于是表达式观察器从来没被恢复过（见文件头 ★ 修订）。
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
  const labelToId = new Map();     // 标签 → 新 id（表达式里的实体引用写的是**标签**）
  const idToId = new Map();        // 档里的旧 id → 新 id（结构引用写的是 **id**，必须重映射，见文件头 ★ 修订）
  const created = [];              // 按档内顺序建出来的实体（供前向引用二次解析）
  const warnings = [];             // 恢复期的问题（不静默吞掉：随结果返回，调用方可以显示/断言）
  const mapEnt = (x) => (x === undefined || x === null ? x : (idToId.get(x) ?? labelToId.get(x) ?? x));
  const mapEntList = (x) => (Array.isArray(x) ? x.map(mapEnt) : mapEnt(x));
  try {
    // 实体：附加字段**全部**照搬；只有指向别的实体的那几个字段需要按 id 重映射
    for (const rec of migrated.entities) {
      const extra = { ...rec };
      // 只摘掉**由 addEntity 现场决定**的 id（档里的 id 是给结构引用做重映射用的，绝不能写回实体，
      // 否则 id 计数器与实体的 id 会错位 → 下一个新建实体会与已有实体撞号并把它覆盖掉）。
      // label / color 必须**留在 extra 里**：addEntity 是按"前缀+计数器"和调色板顺序**现场生成**它们的，
      // 只有 extra 里的值才能把它们原样带回来（否则删过实体的场景会看到标签/颜色被重新编号）。
      delete extra.id; delete extra.type; delete extra.params;
      for (const k of ENT_REF_KEYS) if (k in extra) extra[k] = mapEnt(extra[k]);
      if ('cs' in extra) extra.cs = mapEntList(extra.cs);      // cs 可能是数组（一个图形同属多个坐标系）
      const ent = S.addEntity(tmp, rec.type, { ...rec.params }, extra, true);
      if (!ent) throw new Error(`实体 ${rec.label}（${rec.type}）创建失败`);
      labelToId.set(rec.label, ent.id);
      if (rec.id != null) idToId.set(rec.id, ent.id);
      created.push(ent);
    }
    // 前向引用（手改的文件里可能出现"引用后面才定义的实体"）：实体全建好后再用完整的映射表对一遍
    for (let i = 0; i < migrated.entities.length; i++) {
      const rec = migrated.entities[i], ent = created[i];
      if (!rec || !ent) continue;
      for (const k of ENT_REF_KEYS) {
        if (!(k in rec)) continue;
        const want = mapEnt(rec[k]);
        if (ent[k] !== want) ent[k] = want;
      }
      if ('cs' in rec) {
        const want = mapEntList(rec.cs);
        if (JSON.stringify(ent.cs) !== JSON.stringify(want)) ent.cs = want;
      }
    }
    // 变量：**所有字段**照搬（用户设过的自动动画 anim 与周期 period 也算用户数据）
    for (const v of migrated.variables || []) {
      const r = S.addVariable(tmp, v.name, { ...v });
      if (r && r.error) throw new Error(`变量 ${v.name} 恢复失败：${r.error}`);
      const made = tmp.variables.get(v.name);
      if (made) Object.assign(made, v, { name: v.name });      // addVariable 不认识的字段也不许丢
    }
    // 观察器：**必须在绑定之前**恢复 —— 绑定与别的表达式观察器都可以按名字引用观察器。
    // 名字按档里那份**原样**恢复（不再重算）：名字就是引用键，改名会让引用集体失效。
    for (const p of migrated.probes || []) {
      const want = (typeof p.name === 'string' && p.name) ? p.name : null;
      const isDerived = p.kind === 'derived' || (p.kind === undefined && p.entId != null && p.key != null);
      if (isDerived) {
        const id = mapEnt(p.entId);
        if (id == null || !tmp.entities.has(id)) { warnings.push(`观察器 ${want || '?'}：找不到它观察的实体（${p.entId}）`); continue; }
        const r = S.addProbe(tmp, id, p.key, { name: want });
        if (!r || r.error) warnings.push(`观察器 ${want || '?'} 恢复失败：${(r && r.error) || '未知原因'}`);
        else if (want && r.name !== want) warnings.push(`观察器 ${want} 的名字被改成 ${r.name}（重名或名字不合法）`);
      } else {
        const src = (typeof p.src === 'string' && p.src) ? p.src : ((typeof p.expr === 'string' && p.expr) ? p.expr : '');
        if (!src) { warnings.push(`观察器 ${want || '?'}：表达式原文没了（既没有 src 也没有 expr）`); continue; }
        const r = S.addExprProbe(tmp, src, { name: want });
        if (!r || r.error) warnings.push(`观察器 ${want || '?'}（${src}）恢复失败：${(r && r.error) || '未知原因'}`);
        else if (want && r.name !== want) warnings.push(`观察器 ${want} 的名字被改成 ${r.name}（重名或名字不合法）`);
      }
    }
    // 绑定：目标实体是**旧 id** → 必须重映射（不映射就会出现"目标实体不存在"而整个场景载入失败）
    for (const b of migrated.bindings || []) {
      const id = mapEnt(b.target.ent);
      if (id == null || !tmp.entities.has(id)) throw new Error(`绑定 ${b.target.ent}.${b.target.param} 的目标实体不存在`);
      const r = S.addBinding(tmp, id, b.target.param, b.src, true);
      if (r.error) throw new Error(`绑定 ${b.target.ent}.${b.target.param} ← ${b.src} 失败：${r.error}`);
    }
    for (const c of migrated.constraints || []) {
      const refs = (c.refs || []).map(mapEnt);
      const r = S.addConstraint(tmp, c.kind, refs);
      if (r && r.error) throw new Error(`约束 ${c.kind} 失败：${r.error}`);
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
  // ★ 清空刚体基线：新场景的实体 id 可能沿用 e1/e2…，旧基线会让「铁棍」在第一次求值时被错误平移一次。
  st.rigidBase = new Map();
  st.seq = tmp.seq;
  st.bseq = tmp.bseq;
  st.cseq = tmp.cseq;
  st.counters = tmp.counters;
  st.colorIdx = tmp.colorIdx;
  if (cam && migrated.cam) { cam.x = migrated.cam.x; cam.y = migrated.cam.y; cam.z = migrated.cam.z; }
  S.ensureEvaluated(st, { solve: true });
  // warnings：恢复期"某些东西没能原样回来"的记录（以前是彻底静默 → 用户只看到东西不见了）。
  // 不因此判定失败（旧文件/手改文件仍然尽量载入），但调用方**看得见**。
  if (warnings.length) { try { console.warn('[scene] 载入时的告警：', warnings); } catch { /* 忽略 */ } }
  return { ok: true, counts: { entities: st.entities.size, bindings: st.bindings.size, variables: st.variables.size }, warnings };
}
