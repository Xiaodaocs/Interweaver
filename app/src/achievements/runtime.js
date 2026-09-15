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
    if (now - lastAt < nextGap) return null;
    lastAt = now;
    try {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const sg = compileSemantic(st);
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
      nextGap = Math.max(throttleMs, Math.min(4000, lastCompileMs * 20));
      return {
        newly: res.newly, pending: res.pending,
        litNodes: newlyNodes, woven, granted: tracker.granted.size, grew,
      };
    } catch (err) {
      errors++; void err;
      return null;      // 成就系统出错绝不影响画布
    }
  }

  return {
    tracker, net, step, load, save,
    stats: () => ({ granted: tracker.granted.size, lit: net.nodes.size, edges: net.edges.size, errors, lastCompileMs: Math.round(lastCompileMs), gap: Math.round(nextGap) }),
    reset: () => { tracker.granted.clear(); tracker.since.clear(); tracker.pending.clear(); net.nodes.clear(); net.edges.clear(); },
  };
}
