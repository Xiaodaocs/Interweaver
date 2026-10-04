// 成就运行时：把"语义图 → 匹配 → 稳定确认 → 点亮/织边 → 存档"串成一条可被帧循环调用的链
//
// 三条工程约束（来自之前的教训）：
//   ① **不得拖慢画布**：编译与匹配节流（默认 200ms 一次），且默认放在空闲时段（idle callback）；
//   ② **出错绝不影响画布**：整条链包在 try/catch 里，失败只记日志（不能像上次那样把拖动收尾打断）；
//   ③ **可测**：时间由外部传入、存储可注入 → Node 里能用假时钟与假存储跑完整链路。
import { compileSemantic } from '../semantic.js';
import { matchAll } from './engine.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from './patterns.js';
import { ACH_NODE } from './nodes.js';
import { createTracker, tick as tickTracker, exportTracker, importTracker } from './tracker.js';
import { createNet, igniteNodes, weaveFromScene, weaveInto, exportNet, importNet } from './weave.js';

export const ALL_PATTERNS = [...SOLO_PATTERNS, ...WEAVE_PATTERNS];
export const THROTTLE_MS = 200;
export const STORAGE_KEY = 'interweaver.progress.v1';
// ★ 用户要求（成就页"正在使用中"）：工作台每次判定后，把"**当前画布内容涉及到的知识点**"
//   写到这里，成就页（独立页面、同源）打开时读取它 → 给这些卡片加"正在使用中"的金色上升圆点。
//   只写一个小数组，节流后每 200ms 一次，成本可忽略；读不到就当作"没有正在使用中的知识点"。
export const LIVE_KEY = 'interweaver.live.v1';
export const LIVE_TTL_MS = 60000;      // 超过 1 分钟没更新视为过期（页面关了就不该再亮）

export function createRuntime(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const patterns = opts.patterns || ALL_PATTERNS;
  const throttleMs = Number.isFinite(opts.throttleMs) ? opts.throttleMs : THROTTLE_MS;
  const tracker = createTracker();
  const net = createNet();
  let lastAt = -Infinity;
  let errors = 0;
  let loaded = false;
  let lastCompileMs = 0;
  let lastLive = [];        // 最近一次判定时"正在使用中"的知识点 id（见 LIVE_KEY）
  // 自适应退避：编译本身耗时越长，下一次间隔越大（目标：编译占用 < 5% 的帧时间）。
  // 1000 实体的大场景因此会自动从 200ms 退到 1s 以上，而不是每 200ms 硬编一次拖垮帧率。
  let nextGap = throttleMs;

  function load() {
    if (loaded || !storage) return 0;
    loaded = true;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      importTracker(tracker, data.tracker);
      importNet(net, data.net);
      return tracker.granted.size;
    } catch (err) { errors++; void err; return 0; }
  }

  function save() {
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1, savedAt: Date.now(), tracker: exportTracker(tracker), net: exportNet(net),
      }));
      return true;
    } catch (err) { errors++; return false; }
  }

  /** 推进一次（内部节流）。返回 null 表示这次被节流跳过。 */
  function step(st, now, opts = {}) {
    if (!st || !Number.isFinite(now)) return null;
    // 交互中（拖动实体 / 缩放）**直接挂起**：成就本来就需要"连续稳定 500ms"，
    // 拖动途中既不该判定，也不该让语义图编译拖慢帧率。
    if (opts.interactive) return null;
    // ★ "曾经"类判据需要一点历史（用户要求把「一条线的孤独」改成
    //   "画布上出现大于 5 个实体后，删到只剩一条线"）。这里维护两个极小的计数，
    //   与场景一起放进语义图（sg.history），模式里就能用：
    //     sg.history.maxEntities —— 这个场景曾经达到过的最大实体数
    //     sg.history.deleted     —— 是否发生过"实体变少"（即删除）
    //   刻意只记两个数字：不存实体快照、不随场景增长，成本可忽略。
    if (!st.history) st.history = { maxEntities: 0, deleted: false, lastCount: null, touched: new Map(), sig: new Map() };
    const count = st.entities ? st.entities.size : 0;
    if (count > st.history.maxEntities) st.history.maxEntities = count;
    if (st.history.lastCount !== null && count < st.history.lastCount) st.history.deleted = true;
    st.history.lastCount = count;
    // ★ "哪些参数被刻意改过"：每个实体留一份极便宜的签名（数值参数拼串）。
    //   上一步就存在、这一步签名变了 ⇒ 用户动过它。这一步才创建的不算（默认值不是"刻意"）。
    //   用来修用户报告的"参数值类成就白送"：例如画一个默认 r=2 的圆不该直接送来「整数半径」。
    if (st.entities) {
      const paramsOf = (ent) => (ent && (ent.params || ent.p)) || {};
      for (const [id, ent] of st.entities) {
        const pr = paramsOf(ent);
        let sig = '';
        for (const k of Object.keys(pr)) {
          const v = pr[k];
          sig += k + '=' + (typeof v === 'number' ? v.toFixed(4) : String(v)) + ';';
        }
        const prev = st.history.sig.get(id);
        st.history.sig.set(id, sig);
        if (prev === undefined || prev === sig) continue;   // 新实体 / 没变
        let set = st.history.touched.get(id);
        if (!set) { set = new Set(); st.history.touched.set(id, set); }
        for (const k of Object.keys(pr)) set.add(k);
      }
      // 实体被删掉后清掉记录，避免无限增长
      for (const id of [...st.history.sig.keys()]) {
        if (!st.entities.has(id)) { st.history.sig.delete(id); st.history.touched.delete(id); }
      }
    }
    if (now - lastAt < nextGap) return null;
    lastAt = now;
    try {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const sg = compileSemantic(st);
      sg.history = st.history;        // 供模式使用（见上面的说明）
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      lastCompileMs = t1 - t0;
      const fired = matchAll(sg, patterns);
      const before = tracker.granted.size;
      const res = tickTracker(tracker, fired, patterns, now);
      const newlyNodes = res.newly.map((r) => ACH_NODE[r.id]).filter(Boolean);
      igniteNodes(net, newlyNodes);
      const pairs = weaveFromScene(sg, fired, ACH_NODE);
      const woven = weaveInto(net, pairs, now);
      const grew = tracker.granted.size !== before;
      // ★ "正在使用中"：当前**成立**的所有模式所映射到的知识点（去重）→ 供成就页显示金色上升圆点
      const liveNodes = [...new Set(fired.map((f) => ACH_NODE[f.id]).filter(Boolean))];
      lastLive = liveNodes;
      try {
        if (storage) storage.setItem(LIVE_KEY, JSON.stringify({ at: Date.now(), ids: liveNodes }));
      } catch (err) { errors++; void err; }
      nextGap = Math.max(throttleMs, Math.min(4000, lastCompileMs * 20));
      return {
        newly: res.newly, pending: res.pending,
        litNodes: newlyNodes, woven, granted: tracker.granted.size, grew,
        liveNodes,
      };
    } catch (err) {
      errors++; void err;
      return null;      // 成就系统出错绝不影响画布
    }
  }

  return {
    tracker, net, step, load, save,
    liveNodes: () => lastLive,
    stats: () => ({ granted: tracker.granted.size, lit: net.nodes.size, edges: net.edges.size, errors, lastCompileMs: Math.round(lastCompileMs), gap: Math.round(nextGap) }),
    reset: () => { tracker.granted.clear(); tracker.since.clear(); tracker.pending.clear(); net.nodes.clear(); net.edges.clear(); lastLive = []; },
  };
}
