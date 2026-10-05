import * as S from "../src/state.js";
import { compileSemantic } from "../src/semantic.js";
const st = S.createState();
const c = S.addEntity(st, "circle", { cx: 0, cy: 0, r: 3 });
S.ensureEvaluated(st);
S.addEdgePoint(st, c.id, 0);
S.addEdgePoint(st, c.id, Math.PI / 2);
S.ensureEvaluated(st);
const sg = compileSemantic(st);
const fh = sg.nodes.filter((n) => n.type === "freehand");
console.log("  freehand 节点数 =", fh.length);
if (fh.length) {
  const n = fh[0];
  console.log("  节点字段 =", JSON.stringify(Object.keys(n)));
  console.log("  node.piece =", n.piece, "| node.features.piece =", n.features ? n.features.piece : "(无 features)");
  console.log("  features 字段（前 14）= ", JSON.stringify(Object.keys(n.features || {}).slice(0, 14)));
  const ent = sg.byId ? sg.byId.get(n.id) : null;
  console.log("  byId.get(id) 的字段（前 14）= ", ent ? JSON.stringify(Object.keys(ent).slice(0, 14)) : "(取不到)");
  console.log("  byId.get(id).piece =", ent ? ent.piece : "n/a");
  console.log("  byId 是 Map =", sg.byId instanceof Map, "| byId.size =", sg.byId ? sg.byId.size : "n/a");
}
