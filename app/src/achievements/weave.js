// S4 · 织边（Weave）：把"知识点之间真的发生了耦合"变成可看见的连线
//
// 规则（对齐 docs/03 §5.2）：
//   ① 本场景命中的成就 → 它们点亮的知识点集合 K（成就卡上的 binds 告诉我"是哪几个实体"）；
//   ② 在语义图里找 K 中两两之间的**真实耦合证据**：绑定路径 / 约束 / 共享变量 / 重合 / 落在宿主上；
//   ③ 每对存在证据的 (u,v)：边强度 +1（≥1 即亮起，最多 3 档，越亮越实）。
//
// 关键细节（否则"圆—正弦"永远连不上）：线上点算作它宿主的"簇"。
//   例：θ 同时驱动"圆上的点"与"正弦波相位" —— 圆上点通过 onHost 属于圆的簇，
//   于是 圆—正弦 之间出现了耦合证据 ✓ 这正是欧拉之环要把三个知识点连起来的原因。
const COUPLING_KINDS = new Set(['binding', 'constraint', 'sharedVar', 'coincident', 'onHost']);
export const MAX_STRENGTH = 3;

// 知识点 → 场景里的实体/变量 id 集合（含 onHost 一层闭包）
export function nodeEntitiesOf(fired, achNode, sg) {
  const out = new Map();                 // nodeId → Set(entityId)
  const add = (nodeId, entId) => {
    if (!nodeId || !entId) return;
    if (!out.has(nodeId)) out.set(nodeId, new Set());
    out.get(nodeId).add(entId);
  };
  for (const r of fired) {
    const nodeId = achNode[r.id];
    if (!nodeId) continue;
    for (const val of Object.values(r.binds || {})) {
      if (typeof val === 'string') add(nodeId, val);
    }
  }
  // onHost 闭包：**簇内对称** —— 线上点与它的宿主互为同一簇。
  //   为什么必须对称：共享变量的证据常常落在"圆上的点"上（θ 驱动点），
  //   若只把宿主塞进点的簇、不把点塞进宿主的簇，圆就永远够不到那条证据，
  //   "圆—正弦"也就连不上——而那正是欧拉之环要表达的关系。
  for (const e of sg.edges) {
    if (e.kind !== 'onHost') continue;
    for (const [nodeId, set] of out) {
      if (set.has(e.from)) add(nodeId, e.to);
      if (set.has(e.to)) add(nodeId, e.from);
    }
  }
  return out;
}

/**
 * 从"这一刻的场景"提取织边增量（不落盘，纯函数）。
 * @returns [{ u, v, evidence: [{kind, detail}] }] —— 同一对最多出现一次，evidence 里列出全部证据
 */
export function weaveFromScene(sg, fired, achNode) {
  const nodeEnts = nodeEntitiesOf(fired, achNode, sg);
  const entToNodes = new Map();          // entityId → Set(nodeId)
  for (const [nodeId, set] of nodeEnts) {
    for (const entId of set) {
      if (!entToNodes.has(entId)) entToNodes.set(entId, new Set());
      entToNodes.get(entId).add(nodeId);
    }
  }
  const pairs = new Map();               // "u|v" → { u, v, evidence: [] }
  for (const e of sg.edges) {
    if (!COUPLING_KINDS.has(e.kind)) continue;
    const fromNodes = entToNodes.get(e.from) || new Set();
    const toNodes = entToNodes.get(e.to) || new Set();
    for (const u of fromNodes) {
      for (const v of toNodes) {
        if (u === v) continue;            // 同一知识点内部的关系不算"织"
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (!pairs.has(key)) pairs.set(key, { u: u < v ? u : v, v: u < v ? v : u, evidence: [] });
        pairs.get(key).evidence.push({ kind: e.kind, detail: e.detail || null });
      }
    }
  }
  return [...pairs.values()];
}

/**
 * 把一次织边结果并入知识网状态（强度累计，1–3 档）。
 * @param net { edges: Map<'u|v', {u,v,strength,evidence}> }
 */
export function weaveInto(net, pairs, now) {
  const touched = [];
  for (const p of pairs) {
    const key = `${p.u}|${p.v}`;
    const prev = net.edges.get(key);
    const strength = Math.min(MAX_STRENGTH, (prev?.strength || 0) + 1);
    const rec = {
      u: p.u, v: p.v, strength,
      firstAt: prev?.firstAt ?? now,
      lastAt: now,
      // 去重后的证据（保留最近 3 条，避免无限增长）
      evidence: [...(prev?.evidence || []), ...p.evidence].slice(-3),
    };
    net.edges.set(key, rec);
    if (!prev || strength !== prev.strength) touched.push(rec);
  }
  return touched;
}

export function createNet() {
  return { nodes: new Set(), edges: new Map() };
}

// 点亮知识点（来自成就达成；只增不减）
export function igniteNodes(net, nodeIds) {
  const added = [];
  for (const id of nodeIds) {
    if (!id || net.nodes.has(id)) continue;
    net.nodes.add(id);
    added.push(id);
  }
  return added;
}

// 导出/导入（S7 会用）：合并语义 = 节点并集、边强度取最大、时间取最早
export function exportNet(net) {
  return {
    nodes: [...net.nodes],
    edges: [...net.edges.values()].map((e) => ({ u: e.u, v: e.v, strength: e.strength, firstAt: e.firstAt, lastAt: e.lastAt, evidence: e.evidence })),
  };
}

export function importNet(net, data) {
  if (!data) return { nodes: 0, edges: 0 };
  let nn = 0, ne = 0;
  for (const id of data.nodes || []) if (id && !net.nodes.has(id)) { net.nodes.add(id); nn++; }
  for (const e of data.edges || []) {
    if (!e || !e.u || !e.v) continue;
    const key = `${e.u}|${e.v}`;
    const prev = net.edges.get(key);
    if (!prev) {
      net.edges.set(key, { u: e.u, v: e.v, strength: Math.min(MAX_STRENGTH, e.strength || 1), firstAt: e.firstAt ?? 0, lastAt: e.lastAt ?? 0, evidence: e.evidence || [] });
      ne++;
    } else if ((e.strength || 0) > prev.strength) {
      prev.strength = Math.min(MAX_STRENGTH, e.strength);
      ne++;
    }
    if (prev && Number.isFinite(e.firstAt) && (!Number.isFinite(prev.firstAt) || e.firstAt < prev.firstAt)) prev.firstAt = e.firstAt;
  }
  return { nodes: nn, edges: ne };
}
