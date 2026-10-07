// 场景往返检查（用户报告的原话："观察器无法被正确保存，无论云端还是刷新都会丢失。
//                 请仔细是否仍然存在这种应该被保存但没有被正确存储的东西"）
//
// 为什么要有这条检查：`scenes/schema.js` **确实**把 probes 写进了文件（所以"没存"这个猜测是错的），
// 真正的问题是"存了但恢复不回来"。只有**逐字段实测**才能把这两者分开，所以这条检查：
//   ① 在**真浏览器**里用**真实模块入口**（/src/scenes/schema.js、/src/sceneFile.js、/src/state.js）
//      造一个覆盖注册表**全部实体类型**、并带上变量/绑定/约束/观察器/坐标系/相机的场景；
//   ② serializeScene → deserializeScene（载入到一个**全新** state，与"刷新页面/换设备/从云端打开"同一路径）；
//   ③ 逐字段比对并**按类别**打印一致 / 不一致（不一致逐条列出，这是本检查最有价值的产出）；
//   ④ 另外三个场景：引用稳定性（实体 id 不连续）、草稿路径（sceneFile.saveDraft → readDraft）、
//      以及"刻意不入档"的清单（每条写明理由，避免以后有人把运行时缓存当数据）。
//
// 跑法：node tests/check-scene-roundtrip.mjs   （需要 5188 静态服务在跑；verify 外壳会起好）
process.on('uncaughtException', (e) => { console.log('崩溃：' + ((e && e.message) || e)); process.exit(1); });
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const WEB = 'http://localhost:5188';
const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); };

// ---------- 比较工具（Node 侧：页面只回传纯数据快照） ----------
const J = (v, n = 160) => {
  let s;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
/** 数值规范化：NaN/±Infinity/-0 与浮点噪声都要能被稳定比较 */
function norm(v) {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    const r = Math.round(v * 1e9) / 1e9;
    return Object.is(r, -0) ? 0 : r;
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
    return o;
  }
  return v;
}
function diff(a, b, path, out) {
  const x = norm(a), y = norm(b);
  if (x === undefined && y === undefined) return out;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    if (J(x) !== J(y)) out.push(`${path || '<根>'}: ${J(x)} → ${J(y)}`);
    return out;
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) { out.push(`${path}: ${J(x)} → ${J(y)}`); return out; }
    if (x.length !== y.length) out.push(`${path}.length: ${x.length} → ${y.length}`);
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff(x[i], y[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], path ? `${path}.${k}` : k, out);
  return out;
}
function countLeaves(v, skip = new Set()) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + countLeaves(x, skip), 0);
  if (v && typeof v === 'object') return Object.keys(v).reduce((n, k) => n + (skip.has(k) ? 0 : countLeaves(v[k], skip)), 0);
  return 1;
}
let mismatchTotal = 0;
function category(title, a, b) {
  const out = diff(a, b, '', []);
  mismatchTotal += out.length;
  if (!out.length) console.log(`${title}：✓ 一致（比对 ${countLeaves(a)} 个字段）`);
  else {
    console.log(`${title}：✗ 不一致 ${out.length} 处`);
    for (const l of out.slice(0, 60)) console.log('     - ' + l);
    if (out.length > 60) console.log(`     …（还有 ${out.length - 60} 处）`);
  }
  return out.length;
}
function same(title, a, b) {
  const out = diff(a, b, '', []);
  mismatchTotal += out.length;
  if (!out.length) console.log(`${title}：✓ 一致`);
  else { console.log(`${title}：✗ 不一致 ${out.length} 处`); for (const l of out.slice(0, 30)) console.log('     - ' + l); }
  return out.length;
}

// ---------- 真浏览器 ----------
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 200000, args: ['--window-size=1500,940', '--no-sandbox'] });
// 独立浏览器上下文（= 全新设备：没有任何 localStorage / token）——不碰本机任何账号的存档
const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1500, height: 940 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const consoleWarn = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') consoleWarn.push(m.text().slice(0, 200)); });

await page.goto(WEB + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__IW, { timeout: 20000 });

// =====================================================================================
// 页面内：造场景 → 序列化 → 反序列化 → 快照（全部走真实模块）
// =====================================================================================
const RES = await page.evaluate(async () => {
  const S = window.__IW.S, st = window.__IW.st, cam = window.__IW.cam;
  const SC = await import('/src/scenes/schema.js');
  const F = await import('/src/sceneFile.js');
  const E = await import('/src/expr.js');
  const REG = (await import('/src/entities.js')).REGISTRY;

  const errors = [];      // 构造阶段的硬失败
  const notes = [];       // 构造阶段的软失败（返回 {error} 而不抛）
  const check = (tag, r) => { if (r && r.error) notes.push(`${tag} → ${r.error}`); return r; };

  // 干净起点（同时清掉草稿，避免上一条检查留下的东西影响本检查）
  F.newScene(st, S, cam);

  const mk = (type, params = {}, extra = {}) => S.addEntity(st, type, params, extra);
  const B = (tag, fn) => { try { return fn(); } catch (e) { errors.push(`构造「${tag}」失败：${(e && e.message) || e}`); return null; } };

  // ---------- ① 基础图元（覆盖注册表里的每一种类型，覆盖率最后自检） ----------
  const p = B('点', () => mk('point', { x: 1, y: 2 }));
  const seg = B('线段', () => mk('segment', { x1: -3, y1: -1, x2: 3, y2: -1 }));
  const cir = B('圆', () => mk('circle', { cx: 0, cy: 0, r: 2 }));
  const sn = B('正弦波', () => mk('sine', { A: 2, lam: Math.PI, phi: 0.3, cx: 0, cy: -3, dmin: -6, dmax: 6 }));
  const pb = B('抛物线', () => mk('parabola', { a: 0.5, h: 0, k: -5, dmin: -4, dmax: 4 }));
  const af = B('自由圆弧', () => mk('arcfree', { cx: 2, cy: 2, r: 1.5, start: 0.2, sweep: 1.5 }));
  const fh = B('自由曲线', () => mk('freehand', {}, { pts: [[0, 0], [1, 1], [2, 0.5], [3, 2]] }));
  const fx = B('函数', () => mk('func', { expr: 'x^2', dmin: -3, dmax: 3, cx: 0, cy: 0 }));
  const im = B('隐函数', () => { const eq = E.parseEquation('x^2+y^2=4'); return mk('implicit', {}, { expr: eq.fSrc, ast: eq.ast }); });

  // ---------- ② 宿主类：线上点 / 截取段 / 圆弧 / 切线 / 割线 / 导函数 / 积分区域 ----------
  const epC = B('圆上的线上点', () => { const r = S.addEdgePoint(st, cir.id, 0.6); return r && r.point; });
  const epC2 = B('圆上的第二个线上点', () => { const r = S.addEdgePoint(st, cir.id, 2.2); return r && r.point; });
  const epS1 = B('正弦上的线上点 1', () => { const r = S.addEdgePoint(st, sn.id, 0.8); return r && r.point; });
  const epS2 = B('正弦上的线上点 2', () => { const r = S.addEdgePoint(st, sn.id, 2.4); return r && r.point; });
  const arcE = B('圆弧（宿主圆 + 两个线上点）', () => mk('arc', {}, { host: cir.id, p1: epC && epC.id, p2: epC2 && epC2.id }));
  const piece = B('截取段（curvepiece）', () => (epS1 && epS2 ? S.makeHostedPiece(st, sn, epS1.id, epS2.id) : null));
  const tg = B('切线', () => mk('tangent', { len: 2.5 }, { host: sn.id, p1: epS1 && epS1.id }));
  const sc = B('割线', () => mk('secant', { len: 2.5 }, { host: sn.id, p1: epS1 && epS1.id, p2: epS2 && epS2.id }));
  const dv = B('导函数', () => mk('derivcurve', { dmin: -2, dmax: 2 }, { host: fx.id }));
  const ig = B('积分区域', () => mk('integral', { a: -1, b: 2, n: 8, method: 2 }, { host: fx.id }));

  // ---------- ③ 多边形（自动分组）+ 多边形上的线上点（edge / roam） ----------
  const poly = B('多边形（四段闭合）', () => {
    mk('segment', { x1: 4, y1: 4, x2: 6, y2: 4 });
    mk('segment', { x1: 6, y1: 4, x2: 6, y2: 6 });
    mk('segment', { x1: 6, y1: 6, x2: 4, y2: 6 });
    const last = mk('segment', { x1: 4, y1: 6, x2: 4, y2: 4 });
    S.ensureEvaluated(st);
    S.detectClosedShape(st, last.id, 0.2);
    return [...st.entities.values()].find((e) => e.type === 'polygon') || null;
  });
  const epPoly = B('多边形上的线上点', () => (poly ? S.addEdgePoint(st, poly.id, 1.35) : null));
  if (epPoly && epPoly.point) check('多边形线上点「允许绕到其它边」', S.setEdgePointRoam(st, epPoly.point.id, true));

  // ---------- ④ 圆的直径线（diameterOf / fromLabel / fromType / picksFirst / piece） ----------
  const dia = B('圆的直径线', () => S.ensureCircleDiameter(st, cir.id));

  // ---------- ⑤ 坐标系（cs 数组、父子互连） ----------
  const csA = B('坐标系 A', () => mk('coordsys', { x: -1, y: 0, scale: 40, rot: 0.3 }));
  const csB = B('坐标系 B', () => mk('coordsys', { x: 3, y: 1, scale: 25, rot: 0 }));
  if (cir && csA) check('圆归入坐标系 A', S.assignCoordsys(st, [cir.id], csA.id));
  if (seg && csA) check('线段归入坐标系 A', S.assignCoordsys(st, [seg.id], csA.id));
  if (seg && csB) check('线段同时归入坐标系 B（cs 变数组）', S.assignCoordsys(st, [seg.id], csB.id, { add: true }));
  if (csA && csB) check('坐标系互连（B.parent = A）', S.linkCoordsys(st, csB.id, csA.id));

  // ---------- ⑥ 交点（joint：a/b/sa/sb） ----------
  const jt = B('交点/夹角', () => (seg && tg ? S.addJoint(st, seg.id, tg.id, [1, 0], [1, 1]) : null));
  if (jt && jt.error) notes.push('交点 → ' + jt.error);

  // ---------- ⑦ 变量（含用户设的"自动动画"与周期） ----------
  check('变量 k', S.addVariable(st, 'k', { value: 2, min: -5, max: 9, step: 0.5 }));
  check('变量 tt', S.addVariable(st, 'tt', { value: 1.5, min: 0, max: 3 }));
  S.setVariable(st, 'tt', { anim: true, period: 2500 });

  // ---------- ⑧ 观察器：派生（改过名字）+ 两个表达式（引用派生那个） ----------
  const pr1 = B('派生观察器（切线斜率）', () => (tg ? S.addProbe(st, tg.id, 'm') : null));
  if (pr1 && pr1.error) notes.push('派生观察器 → ' + pr1.error);
  let pr1name = pr1 && pr1.name;
  if (pr1name) check('观察器改名 mm（与自动名 ' + pr1name + ' 不同）', S.renameProbe(st, pr1name, 'mm'));
  if (pr1name) pr1name = 'mm';
  const pr2 = B('表达式观察器（引用派生观察器）', () => (pr1name ? S.addExprProbe(st, `${pr1name} * 2 + k`) : null));
  if (pr2 && pr2.error) notes.push('表达式观察器 1 → ' + pr2.error);
  const pr3 = B('表达式观察器（k + 1）', () => S.addExprProbe(st, 'k + 1'));
  if (pr3 && pr3.error) notes.push('表达式观察器 2 → ' + pr3.error);

  // ---------- ⑨ 绑定：变量 / 实体参数 / **观察器**（引用观察器的绑定必须在观察器之后恢复） ----------
  if (cir) check('绑定 圆.r ← k + 1', S.addBinding(st, cir.id, 'r', 'k + 1'));
  if (pb) check('绑定 抛物线.k ← k * 2', S.addBinding(st, pb.id, 'k', 'k * 2'));
  if (seg && cir) check('绑定 线段.y1 ← ' + cir.label + '.cy - 3', S.addBinding(st, seg.id, 'y1', cir.label + '.cy - 3'));
  if (af && pr2 && pr2.name) check('绑定 自由圆弧.r ← ' + pr2.name + ' + 1（引用观察器）', S.addBinding(st, af.id, 'r', pr2.name + ' + 1'));

  // ---------- ⑩ 约束 ----------
  if (seg) check('约束：线段水平', S.addConstraint(st, 'horizontal', [seg.id]));

  // ---------- ⑪ 相机 ----------
  cam.x = 3.5; cam.y = -2.25; cam.z = 55;
  S.ensureEvaluated(st, { solve: true });

  // =============== 快照与比对 ===============
  const CACHE = new Set(['bound', '_arc', 'lastX', 'lastY']);   // 运行时重算的缓存（故意不入档，见文末清单）
  const REFS = ['host', 'a', 'b', 'p1', 'p2', 'diameterOf', 'parent'];
  const lab = (state, id) => { const e = id == null ? null : state.entities.get(id); return e ? e.label : (id == null ? null : '<找不到:' + id + '>'); };
  const labList = (state, x) => (Array.isArray(x) ? x.map((i) => lab(state, i)).sort() : lab(state, x));
  const num = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);

  function snap(state) {
    const ents = [...state.entities.values()].map((e) => {
      const base = { type: e.type, label: e.label, color: e.color, params: { ...e.params } };
      const rest = {};
      for (const k of Object.keys(e)) {
        if (['id', 'type', 'label', 'color', 'params'].includes(k)) continue;
        if (CACHE.has(k)) continue;
        rest[k] = REFS.includes(k) ? lab(state, e[k]) : (k === 'cs' ? labList(state, e[k]) : e[k]);
      }
      return { base, rest };
    }).sort((a, b) => (a.base.label < b.base.label ? -1 : a.base.label > b.base.label ? 1 : 0));
    const vars = [...state.variables.values()].map((v) => ({ ...v })).sort((a, b) => (a.name < b.name ? -1 : 1));
    const binds = [...state.bindings.values()].map((b) => ({
      target: lab(state, b.target.ent) + '.' + b.target.param,
      src: b.src,
      sources: (b.sources || []).map((s) => (s.kind === 'param' ? lab(state, s.ent) + '.' + s.param : 'var:' + s.name)).sort(),
    })).sort((a, b) => (a.target < b.target ? -1 : 1));
    const cons = [...state.constraints.values()].map((c) => ({ kind: c.kind, refs: (c.refs || []).map((r) => lab(state, r)).sort() }))
      .sort((a, b) => (a.kind < b.kind ? -1 : 1));
    const probes = [...state.probes.values()].map((q) => ({
      name: q.name, kind: q.kind, ent: q.entId === undefined ? null : lab(state, q.entId),
      key: q.key === undefined ? null : q.key, src: q.src === undefined ? null : q.src,
    })).sort((a, b) => (a.name < b.name ? -1 : 1));
    return { ents, vars, binds, cons, probes };
  }
  function valueSnap(state) {
    const probes = [...state.probes.values()].map((q) => ({ name: q.name, value: num(S.probeValue(state, q)) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const binds = [...state.bindings.values()].map((b) => {
      const e = state.entities.get(b.target.ent);
      return { target: (e ? e.label : '?') + '.' + b.target.param, value: num(e ? S.getVal(state, e, b.target.param) : null) };
    }).sort((a, b) => (a.target < b.target ? -1 : 1));
    const vars = [...state.variables.values()].map((v) => ({ name: v.name, value: num(v.value) })).sort((a, b) => (a.name < b.name ? -1 : 1));
    return { probes, binds, vars };
  }

  const A = snap(st), VA = valueSnap(st);
  const camA = { x: cam.x, y: cam.y, z: cam.z };
  const coverageAll = Object.keys(REG).sort();
  const coverageUsed = [...new Set([...st.entities.values()].map((e) => e.type))].sort();
  const coverageMissing = coverageAll.filter((t) => !coverageUsed.includes(t));

  // ---- 保存（与草稿/云端同一条序列化）→ 载入到一个全新 state（= 刷新页面 / 换设备 / 从云端打开） ----
  const text = F.sceneToText(st, '往返场景', cam);
  const info = SC.inspectScene(text);
  const st2 = S.createState();
  const cam2 = { x: 0, y: 0, z: 40 };
  const r1 = SC.deserializeScene(st2, S, text, cam2);
  const B2 = snap(st2), VB = valueSnap(st2);

  // ---- 场景 B：实体 id 不连续（删掉第一个实体后再存）→ 结构引用必须仍然指向**同一个实体** ----
  const stB = S.createState();
  const b1 = S.addEntity(stB, 'point', { x: 9, y: 9 });
  const b2 = S.addEntity(stB, 'circle', { cx: 0, cy: 0, r: 3 });
  const b3 = S.addEntity(stB, 'segment', { x1: -2, y1: 0, x2: 2, y2: 0 });
  S.ensureEvaluated(stB);
  S.removeEntities(stB, [b1.id]);                       // → 剩下的 id 是 e2/e3（不连续）
  const bEp = S.addEdgePoint(stB, b2.id, 0.9).point;    // host ← e2（圆）
  S.ensureEvaluated(stB);
  S.addVariable(stB, 'v', { value: 0.5, min: -2, max: 2 });
  const bPr = S.addProbe(stB, b3.id, 'length');         // entId ← e3（线段）
  const bBd = S.addBinding(stB, b3.id, 'y2', 'v');      // 绑定目标 ← e3（同一实体）
  if (bBd && bBd.error) notes.push('场景 B 绑定 → ' + bBd.error);
  S.ensureEvaluated(stB);
  const BsnapA = snap(stB);
  const Btext = JSON.stringify(SC.serializeScene(stB, 'id 不连续', null));
  const stB2 = S.createState();
  const rB = SC.deserializeScene(stB2, S, Btext, null);
  const BsnapB = snap(stB2);
  const bIdsBefore = [...stB.entities.keys()];
  const bIdsAfter = [...stB2.entities.keys()];
  const bProbeBack = [...stB2.probes.values()][0] || null;
  const bEpBack = [...stB2.entities.values()].find((e) => e.type === 'edgepoint') || null;
  const bHostLabel = bEpBack && bEpBack.host ? ((stB2.entities.get(bEpBack.host) || {}).label || null) : null;
  const bProbeHostLabel = bProbeBack && bProbeBack.entId ? ((stB2.entities.get(bProbeBack.entId) || {}).label || null) : null;
  const bBindTargetLabel = (() => { const b = [...stB2.bindings.values()][0]; return b ? ((stB2.entities.get(b.target.ent) || {}).label || null) + '.' + b.target.param : null; })();

  // ---- 场景 C：草稿路径（saveDraft → readDraft）必须与直接序列化**同一份文本** ----
  F.saveDraft(st, cam, '往返场景');
  const draft = F.readDraft();
  const draftScene = draft ? JSON.parse(draft.text) : null;
  const directScene = JSON.parse(text);
  delete (draftScene || {}).savedAt; delete directScene.savedAt;
  const st3 = S.createState();
  const r3 = draft && draft.text ? SC.deserializeScene(st3, S, draft.text, { x: 0, y: 0, z: 40 }) : { ok: false, error: '没有草稿' };
  const Csnap = snap(st3);

  return {
    errors, notes, coverageAll, coverageUsed, coverageMissing, counts: {
      entities: st.entities.size, variables: st.variables.size, bindings: st.bindings.size,
      constraints: st.constraints.size, probes: st.probes.size, bytes: text.length,
    },
    sceneName: info.name, sceneOk: info.ok,
    r1: { ok: r1.ok, error: r1.error || null, warnings: r1.warnings || null, counts: r1.counts || null },
    A, B: B2, VA, VB, camA, camB: { x: cam2.x, y: cam2.y, z: cam2.z },
    scenarioB: { ok: rB.ok, error: rB.error || null, idsBefore: bIdsBefore, idsAfter: bIdsAfter, A: BsnapA, B: BsnapB,
      probeName: bPr && bPr.name, probeOk: !!(bPr && bPr.ok), epHostIsCircle: !!(bEp && b2 && bEp.host === b2.id),
      back: { probe: bProbeBack ? bProbeBack.name : null, probeHostLabel: bProbeHostLabel, epHostLabel: bHostLabel, bindTarget: bBindTargetLabel } },
    scenarioC: { ok: r3.ok, error: r3.error || null, draftName: draft ? draft.name : null,
      draftBytes: draft ? draft.text.length : 0, sameText: JSON.stringify(draftScene) === JSON.stringify(directScene), snap: Csnap },
  };
});

// =====================================================================================
// 打印：按类别给出"一致 / 不一致"，不一致逐条列出
// =====================================================================================
console.log('· 场景：' + RES.counts.entities + ' 实体 / ' + RES.counts.variables + ' 变量 / ' + RES.counts.bindings + ' 绑定 / '
  + RES.counts.constraints + ' 约束 / ' + RES.counts.probes + ' 观察器 / ' + RES.counts.bytes + ' 字节（' + RES.sceneName + '）');
console.log('· 实体类型覆盖：' + RES.coverageUsed.length + '/' + RES.coverageAll.length
  + (RES.coverageMissing.length ? '（缺 ' + RES.coverageMissing.join(',') + '）' : '（注册表全部类型都进了一遍往返）'));
if (RES.errors.length) { console.log('· 构造阶段硬失败：'); for (const e of RES.errors) console.log('   ✗ ' + e); }
if (RES.notes.length) { console.log('· 构造阶段软失败（返回 error 而非抛异常）：'); for (const e of RES.notes) console.log('   · ' + e); }
console.log('· 保存：inspectScene ' + (RES.sceneOk ? '通过' : '不通过') + '；载入结果 ok=' + RES.r1.ok + (RES.r1.error ? '（' + RES.r1.error + '）' : '')
  + (RES.r1.counts ? '；counts=' + JSON.stringify(RES.r1.counts) : ''));
if (RES.r1.warnings && RES.r1.warnings.length) { console.log('· 载入期告警（**没有静默吞掉**）：'); for (const w of RES.r1.warnings) console.log('   ! ' + w); }
console.log('');
console.log('【修前/修后一致清单】—— 每行：类别：一致 / 不一致 N 处（不一致逐条列出）');
const n1 = category('① 实体·类型/标签/颜色/全部参数', RES.A.ents.map((e) => e.base), RES.B.ents.map((e) => e.base));
const n2 = category('② 实体·引用字段与结构字段（host/p1/p2/a/b/sa/sb/cs/parent/diameterOf + pts/edge/roam/count/piece/fromLabel/fromType/expr/ast/exprSrc/autoGrouped/…）',
  RES.A.ents.map((e) => e.rest), RES.B.ents.map((e) => e.rest));
const n3 = category('③ 变量（名字/值/范围/步长/自动动画/周期）', RES.A.vars, RES.B.vars);
const n4 = category('④ 绑定（目标参数 / 表达式原文 / 引用来源）', RES.A.binds, RES.B.binds);
const n5 = category('⑤ 约束（类型 / 引用实体）', RES.A.cons, RES.B.cons);
const n6 = category('⑥ 观察器（派生：目标实体/key/显示名；表达式：原文/显示名）', RES.A.probes, RES.B.probes);
const n7 = same('⑦ 视口/相机（x/y/z）', RES.camA, RES.camB);
const n8 = same('⑧ 表达式仍能求值（观察器值 / 绑定生效值 / 变量值）', RES.VA, RES.VB);
console.log('');
console.log('【场景 B】实体 id 不连续（删掉首个实体后保存 → 载入到全新 state）');
console.log('   id：保存前 [' + RES.scenarioB.idsBefore.join(',') + '] → 载入后 [' + RES.scenarioB.idsAfter.join(',') + ']；载入 ok=' + RES.scenarioB.ok);
console.log('   保存前：观察器 ' + RES.scenarioB.probeName + '（建成功=' + RES.scenarioB.probeOk + '）观察线段、线上点宿主是圆=' + RES.scenarioB.epHostIsCircle);
console.log('   载入后：观察器 ' + RES.scenarioB.back.probe + '（观察 ' + RES.scenarioB.back.probeHostLabel + '）；'
  + '线上点宿主 ' + RES.scenarioB.back.epHostLabel + '；绑定目标 ' + RES.scenarioB.back.bindTarget);
const n9 = category('   B·实体/变量/绑定/约束的逐字段比对',
  RES.scenarioB.A.ents.concat(RES.scenarioB.A.vars, RES.scenarioB.A.binds, RES.scenarioB.A.cons),
  RES.scenarioB.B.ents.concat(RES.scenarioB.B.vars, RES.scenarioB.B.binds, RES.scenarioB.B.cons));
const n10 = category('   B·观察器（entId ← 圆）', RES.scenarioB.A.probes, RES.scenarioB.B.probes);
console.log('');
console.log('【场景 C】草稿路径（sceneFile.saveDraft → readDraft）');
console.log('   草稿名=' + RES.scenarioC.draftName + ' / ' + RES.scenarioC.draftBytes + ' 字节；与直接序列化**同一份文本**=' + RES.scenarioC.sameText + '；载入 ok=' + RES.scenarioC.ok);
const n11 = same('   C·草稿文本载入后与原场景逐字段一致', { e: RES.A.ents, v: RES.A.vars, b: RES.A.binds, k: RES.A.cons, p: RES.A.probes },
  { e: RES.scenarioC.snap.ents, v: RES.scenarioC.snap.vars, b: RES.scenarioC.snap.binds, k: RES.scenarioC.snap.cons, p: RES.scenarioC.snap.probes });
console.log('');
console.log('【刻意不入档的东西（每一条都有理由，不是漏存）】');
console.log('   · st.selection / st.tool / st.hover / st.ghost / st.snap / st.boxSelect —— 交互态与鼠标悬停，刷新后无意义');
console.log('   · entity.bound（参数 → 绑定 id 的索引）—— 由 bindings 重建（addBinding 自己回填），存了反而会不一致');
console.log('   · entity._arc / entity.lastX / entity.lastY —— 求值/绘制的中间缓存，每次求值重算');
console.log('   · st.values / st.base / st.scope / st.env —— 派生量缓存，ensureEvaluated 重算');
console.log('   · st.rigidBase —— 刚体约束基线，载入时**必须清空**（否则新场景第一次求值会被旧形状错误平移，见 schema.js 注释）');
console.log('   · 面板/窗口的位置与尺寸 —— windows.js 已取消手动拖动，位置尺寸一律由 CSS 决定，没有"位置"这个数据');
console.log('   · 撤销/重做栈（st.undoStack/redoStack）—— 会话级历史，打开场景后从空栈开始');
console.log('   · 成就进度 / 设置 / 草稿本身 —— 它们是**用户数据文档**（progress/settings/draft），不随场景文件走');

// ---- 判定 ----
ok(RES.errors.length === 0, '构造阶段没有硬失败：' + RES.errors.join(' | '));
ok(RES.coverageMissing.length === 0, '注册表全部实体类型都覆盖到了（缺 ' + RES.coverageMissing.join(',') + '）');
ok(RES.counts.probes === 3, '场景里有 3 个观察器（实测 ' + RES.counts.probes + '）');
ok(RES.r1.ok, '载入成功：' + (RES.r1.error || 'ok'));
ok(n1 === 0, '实体·类型/标签/颜色/参数 往返一致（' + n1 + ' 处不一致）');
ok(n2 === 0, '实体·引用与结构字段 往返一致（' + n2 + ' 处不一致）');
ok(n3 === 0, '变量 往返一致（' + n3 + ' 处不一致）');
ok(n4 === 0, '绑定 往返一致（' + n4 + ' 处不一致）');
ok(n5 === 0, '约束 往返一致（' + n5 + ' 处不一致）');
ok(n6 === 0, '观察器 往返一致（' + n6 + ' 处不一致）★ 用户报告的那一条');
ok(n7 === 0, '相机 往返一致（' + n7 + ' 处不一致）');
ok(n8 === 0, '观察器/绑定表达式在载入后仍能求值且值相同（' + n8 + ' 处不一致）');
ok(n9 === 0 && n10 === 0, 'id 不连续时引用仍然稳定（' + (n9 + n10) + ' 处不一致）');
ok(RES.scenarioB.ok, 'id 不连续场景载入成功');
ok(RES.scenarioB.back.bindTarget === 's1.y2', 'id 不连续时绑定目标落在**原来那个实体**上（载入后 ' + RES.scenarioB.back.bindTarget + '，期望 s1.y2）');
ok(RES.scenarioB.back.probeHostLabel === 's1' && RES.scenarioB.back.epHostLabel === 'c1',
  'id 不连续时观察器/宿主引用仍然指向原实体（观察器 → ' + RES.scenarioB.back.probeHostLabel + '，线上点宿主 → ' + RES.scenarioB.back.epHostLabel + '）');
ok(n11 === 0, '草稿路径与直接序列化一致（' + n11 + ' 处不一致）');
ok(RES.scenarioC.sameText, '草稿文本与直接序列化是同一份（同一序列化器）');
if (pageErrors.length) bad.push('页面运行时错误：' + pageErrors.slice(0, 3).join(' | '));

await browser.close();
if (bad.length) {
  console.log('\n❌ 未通过（共 ' + mismatchTotal + ' 处字段不一致）：');
  for (const b of bad) console.log('   - ' + b);
  process.exit(1);
}
console.log('\n✅ 通过：场景往返逐字段一致（含观察器名字/表达式原文/引用稳定性），草稿与文件同源，' + RES.counts.entities + ' 个实体 / ' + RES.counts.probes + ' 个观察器全部还原');
