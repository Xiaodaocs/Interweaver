// 右侧知识点详情面板（用户要求）：点击星图卡片 → 右侧打开详情，列出**该知识点涉及的全部成就**。
//
// 背景（取证结论）：
//   · 此前点击只更新底部细栏；Enter 打开 T6 卡片时用 .find(...) 只取**第一条**成就，
//     而实测每个知识点平均挂 2.44 条、最多 9 条 → 与"包含该知识点涉及的成就（复数）"不符。
//   · 本模块把"该知识点的成就清单"完整列出：已点亮显示标题+flavor；待补前置显示 ⏳；
//     未点亮显示 ？？？ + ≤22 字暗示（沿用既有设计）。
//
// 用法：buildSidePanel({ root, nodes, patterns, tracker, net, achNode, openDetail }) → showSide(el)
export function buildSidePanel(ctx) {
  const { root, nodes, patterns, tracker, net, achNode, openDetail } = ctx;
  const sideEl = root.querySelector('.smSide');
  if (!sideEl) return () => {};

  // 已点亮集合：兼容 Map / Set / Array 三种可能的 tracker 形态；取不到就退化为"节点状态"
  const grantedSet = (() => {
    const g = tracker && tracker.granted;
    if (g instanceof Map) return new Set(g.keys());
    if (g instanceof Set) return g;
    if (Array.isArray(g)) return new Set(g);
    return null;
  })();

  const achOfNode = (nid) => Object.keys(achNode).filter((k) => achNode[k] === nid);
  const patById = new Map(patterns.map((x) => [x.id, x]));

  const close = () => { sideEl.hidden = true; sideEl.classList.remove('open'); };

  return function showSide(el) {
    if (!el) return;
    const id = el.dataset.node;
    const meta = nodes.find((x) => x.id === id) || {};
    const state = el.dataset.state;
    const stateText = state === 'granted' ? '已点亮' : (state === 'pending' ? '⏳ 待补前置' : '未点亮');
    const list = achOfNode(id);
    const litCount = grantedSet ? list.filter((x) => grantedSet.has(x)).length
      : (state === 'granted' ? list.length : 0);

    const rows = list.map((aid) => {
      const pat = patById.get(aid) || {};
      const lit = grantedSet ? grantedSet.has(aid) : state === 'granted';
      const pend = !lit && !!(tracker && tracker.pending && tracker.pending.has && tracker.pending.has(aid));
      const cls = lit ? 'lit' : (pend ? 'pend' : 'locked');
      const title = lit ? (pat.title || aid) : '？？？';
      const sub = lit ? (pat.flavor || '') : (pend ? '⏳ 待补前置' : (pat.hint || '继续探索'));
      return '<button class="smAchRow ' + cls + '" data-ach="' + aid + '">'
        + '<span class="smAchTitle">' + title + '</span>'
        + '<span class="smAchSub">' + sub + '</span></button>';
    }).join('');

    sideEl.innerHTML = '<div class="smSideHead"><b>' + (meta.title || id) + '</b>'
      + '<span class="smSideState">' + stateText + '</span>'
      + '<button class="smSideClose" title="关闭">✕</button></div>'
      + '<div class="smSideDesc">' + (meta.desc || '') + '</div>'
      + '<div class="smSideCount">涉及成就 <b>' + list.length + '</b> 条（已点亮 ' + litCount + '）</div>'
      + '<div class="smAchList">' + (rows || '<span class="smAchSub">该知识点暂无成就</span>') + '</div>';
    sideEl.hidden = false;
    sideEl.classList.add('open');

    const closeBtn = sideEl.querySelector('.smSideClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    for (const btn of sideEl.querySelectorAll('.smAchRow')) {
      btn.addEventListener('click', () => {
        const aid = btn.dataset.ach;
        if (typeof openDetail === 'function') {
          openDetail({ id: aid, patterns, tracker, net, achNode, layer: meta.layer });
        }
      });
    }
  };
}
