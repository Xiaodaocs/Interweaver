// 回归断言（数据丢失级 bug）：加载场景后新建实体**不得覆盖已有实体**。
//
// 背景（用户实测）：建一个圆 → 右键「以此创建坐标系」→ 圆被删除。
// 根因：deserializeScene 提交时只搬了实体/绑定/变量…，**没搬 id 与标签计数器**
//       → st.seq 退回 1，而实体 id 仍是 e1..eN → 下一个 addEntity 生成的 id 撞号，
//       Map.set 直接覆盖掉那个实体。
// 这条断言覆盖两种入口：显式加载场景、以及每次打开工作台都会走的自动草稿恢复。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { createState, addEntity, ensureEvaluated } from "../src/state.js";
import { serializeScene, deserializeScene } from "../src/scenes/schema.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };

// ① 造一个场景：圆 + 线段
const src = createState();
const c1 = addEntity(src, "circle", { cx: 0, cy: 0, r: 2 });
const s1 = addEntity(src, "segment", { x1: -3, y1: -3, x2: 3, y2: -3 });
ensureEvaluated(src);
const text = JSON.stringify(serializeScene(src, "回归", null));
const beforeIds = [...src.entities.keys()];
console.log(`源场景：${beforeIds.join(", ")}（seq=${src.seq}）`);

// ② 载入到一个**全新状态**（模拟打开工作台 / 草稿恢复）
const st = createState();
const r = deserializeScene(st, { createState, addEntity, addVariable: () => {}, addBinding: () => ({ ok: true }), addConstraint: () => ({ ok: true }), addProbe: () => {}, addExprProbe: () => {}, ensureEvaluated }, text, null);
ok(r.ok, `加载场景成功（${r.ok ? r.counts.entities + " 实体" : r.error}）`);

const afterLoad = { ids: [...st.entities.keys()], seq: st.seq, counters: JSON.stringify(st.counters) };
console.log(`加载后：ids=[${afterLoad.ids.join(", ")}] seq=${afterLoad.seq} counters=${afterLoad.counters}`);
ok(afterLoad.seq > 1, `加载后 id 计数器已推进（seq=${afterLoad.seq}，修复前恒为 1）`);
ok(Object.keys(JSON.parse(afterLoad.counters)).length > 0, `加载后标签计数器已恢复（${afterLoad.counters}）`);

// ③ 关键：加载后再新建实体（用户场景就是"新建坐标系"）
const sizeBefore = st.entities.size;
const fresh = addEntity(st, "coordsys", { x: 0, y: 0, scale: 50, rot: 0 });
const afterIds = [...st.entities.keys()];
const lost = beforeIds.filter((id) => !afterIds.includes(id));
console.log(`新建后：新 id=${fresh.id} ids=[${afterIds.join(", ")}] 数量 ${sizeBefore} → ${st.entities.size}`);

ok(st.entities.size === sizeBefore + 1, `新建实体使数量 +1（${sizeBefore} → ${st.entities.size}；相等即说明发生了覆盖）`);
ok(lost.length === 0, `原有实体一个都没丢（丢失=${JSON.stringify(lost)}）`);
ok(!beforeIds.includes(fresh.id), `新实体的 id 不与已有实体撞号（新 id=${fresh.id}，已有=[${beforeIds.join(", ")}]）`);

// ④ 再确认那两个实体仍是**原来的类型**（防"同 id 换内容"这种更隐蔽的覆盖）
const types = [...st.entities.values()].map((e) => e.type).sort().join(",");
ok(types === "circle,coordsys,segment", `实体类型集合正确（${types}）`);

console.log(`\n加载场景后新建实体（数据丢失回归）：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
