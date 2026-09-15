// S2 · 成就触发跟踪器
//
// 引擎只回答"**此刻**是否成立"；这里负责把它变成真正的成就记录：
//   ① 稳定确认：结构必须**连续**成立 ≥500ms 才算（拖动途中、一闪而过都不算）；
//   ② 每成就只记一次：达成后**永不撤销、永不重复**（记录永久保留，这是产品决定）；
//   ③ 前置门控：B 类交织成就若前置未达成 → 不点亮，登记为 `⏳ 待补前置`（列出差哪几个）；
//      前置一旦达成，因为它仍在"此刻成立"里，下一 tick 会**自动晋升**，无需特殊代码。
//
// 纯逻辑：时间由外部传入（便于单测用假时钟）。
export const STABLE_MS = 500;

export function createTracker() {
  return {
    since: new Map(),      // id → 首次成立的时间戳
    granted: new Map(),    // id → { at, evidence, title, cls }
    pending: new Map(),    // id → { missing: string[], evidence }
  };
}

/**
 * 推进一帧。
 * @param tracker createTracker() 的返回值
 * @param fired   matchAll() 的结果（"此刻成立"的模式）
 * @param all     全部模式（用于按 id 查 requires）
 * @param now     当前时间（ms）
 * @returns { newly, pending, grantedCount }
 */
export function tick(tracker, fired, all, now) {
  const byId = new Map(all.map((p) => [p.id, p]));
  const firedIds = new Set(fired.map((r) => r.id));

  // 不再成立的：清掉"连续计时"（必须连续成立，中断就重新计）
  for (const id of [...tracker.since.keys()]) {
    if (!firedIds.has(id) || tracker.granted.has(id)) tracker.since.delete(id);
  }

  const newly = [];
  const pending = [];
  for (const r of fired) {
    if (tracker.granted.has(r.id)) continue;
    const p = byId.get(r.id);
    if (!p) continue;

    // ① 稳定确认的计时**从它首次成立时开始**（即使此刻还缺前置也算"结构已经在那儿了"）。
    //    这样前置一旦达成即可立即晋升，而不是再多等 500ms —— 与产品语义"前置一达成就点亮"一致。
    if (!tracker.since.has(r.id)) tracker.since.set(r.id, now);

    // ③ 前置门控：缺哪个就登记哪个（不点亮）
    const missing = (p.requires || []).filter((rid) => !tracker.granted.has(rid));
    if (missing.length) {
      tracker.pending.set(r.id, { missing: [...missing], evidence: r.evidence || null });
      pending.push({ id: r.id, title: p.title, missing: [...missing], evidence: r.evidence || null });
      continue;
    }
    tracker.pending.delete(r.id);

    // ② 稳定确认：必须**连续**成立满 STABLE_MS
    if (now - tracker.since.get(r.id) < STABLE_MS) continue;

    // ② 记录（一次，永久）
    tracker.granted.set(r.id, { at: now, evidence: r.evidence || null, title: p.title, cls: p.cls || 'solo' });
    tracker.since.delete(r.id);
    newly.push({ id: r.id, title: p.title, flavor: p.flavor, cls: p.cls || 'solo', evidence: r.evidence || null });
  }

  // 已经登记为"待补前置"、但这轮不再成立的 → 保留登记（用户仍应看到"差哪几步"）。
  // ★ missing 必须**按当前的已达成集合重算**：前置可能刚刚被达成，旧清单会误导用户。
  for (const [id, info] of tracker.pending) {
    const p2 = byId.get(id);
    const missingNow = (p2?.requires || []).filter((rid) => !tracker.granted.has(rid));
    if (missingNow.length === 0) { tracker.pending.delete(id); continue; }   // 前置已齐：等它下次成立即自动晋升
    tracker.pending.set(id, { ...info, missing: missingNow });
    if (!pending.some((x) => x.id === id)) {
      pending.push({ id, title: p2?.title || id, missing: missingNow, evidence: info.evidence });
    }
  }

  return { newly, pending, grantedCount: tracker.granted.size };
}

// 供 UI 使用：某个成就当前处于哪一态
export function statusOf(tracker, id) {
  if (tracker.granted.has(id)) return { state: 'granted', ...tracker.granted.get(id) };
  if (tracker.pending.has(id)) return { state: 'pending', ...tracker.pending.get(id) };
  return { state: 'locked' };
}

// 导出/导入（S7 会用；这里先给出稳定结构）
export function exportTracker(tracker) {
  return {
    granted: [...tracker.granted.entries()].map(([id, g]) => ({ id, at: g.at, title: g.title, cls: g.cls, evidence: g.evidence })),
  };
}

export function importTracker(tracker, data) {
  if (!data || !Array.isArray(data.granted)) return 0;
  let n = 0;
  for (const g of data.granted) {
    if (!g || typeof g.id !== 'string') continue;
    const prev = tracker.granted.get(g.id);
    // 合并语义：取最早达成时间（成就永不丢失）
    if (!prev || (Number.isFinite(g.at) && g.at < prev.at)) {
      tracker.granted.set(g.id, { at: g.at, title: g.title || prev?.title || g.id, cls: g.cls || prev?.cls || 'solo', evidence: g.evidence ?? prev?.evidence ?? null });
      n++;
    }
  }
  return n;
}
