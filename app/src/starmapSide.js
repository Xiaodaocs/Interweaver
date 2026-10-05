// 右侧知识点详情面板（用户要求）：点击星图卡片 → 右侧打开详情，列出**该知识点涉及的全部成就**，
// 并且每条成就都要有**详情信息**（状态 / flavor / 暗示 / 前置清单 / 族与档位）。
//
// 用户原话："我要求右侧面板列出全部成就和详情信息"。
// 因此每条成就一行：
//   · 已点亮：标题 + flavor（文案）+ 族/档位/前置条数
//   · 待补前置：标题 + ⏳ + **还缺哪几条**（列出具体成就名）
//   · 未点亮：？？？ + ≤22 字暗示（沿用既有设计，不剧透）
// 点某条成就 → 打开它自己的 T6 详情卡（含当时画面 / 如何触发 / 当时的数据）。
export function buildSidePanel(ctx) {
  const { root, nodes, patterns, tracker, net, achNode, openDetail } = ctx;
  const sideEl = root.querySelector('.smSide');
  if (!sideEl) return () => {};

  const grantedSet = (() => {
    const g = tracker && tracker.granted;
    if (g instanceof Map) return new Set(g.keys());
    if (g instanceof Set) return g;
    if (Array.isArray(g)) return new Set(g);
    return null;
  })();

  const achOfNode = (nid) => Object.keys(achNode).filter((k) => achNode[k] === nid);
  const patById = new Map(patterns.map((x) => [x.id, x]));
  const titleOf = (aid) => {
    const p = patById.get(aid);
    return (p && p.title) || aid;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const close = () => { sideEl.hidden = true; sideEl.classList.remove('open'); };

  return function showSide(el) {
    if (!el) return;
    const id = el.dataset.node;
    const meta = nodes.find((x) => x.id === id) || {};
    const state = el.dataset.state;
    const stateText = state === 'granted' ? '已点亮' : (state === 'pending' ? '⏳ 待补前置' : '未点亮');
    const list = achOfNode(id);
    const isLit = (aid) => (grantedSet ? grantedSet.has(aid) : state === 'granted');
    const litCount = list.filter(isLit).length;

    const rows = list.map((aid) => {
      const pat = patById.get(aid) || {};
      const lit = isLit(aid);
      const pend = !lit && !!(tracker && tracker.pending && tracker.pending.has && tracker.pending.has(aid));
      const cls = lit ? 'lit' : (pend ? 'pend' : 'locked');

      const title = lit ? esc(pat.title || aid) : '？？？';
      let detail = '';
      if (lit) {
        detail = esc(pat.flavor || '');
      } else if (pend) {
        const miss = (tracker && tracker.pending && tracker.pending.get && tracker.pending.get(aid)) || {};
        const need = (miss.missing || []).map((m) => titleOf(m));
        detail = need.length
          ? '还缺：' + esc(need.slice(0, 3).join('、')) + (need.length > 3 ? ' 等 ' + need.length + ' 条' : '')
          : '待补前置';
      } else {
        detail = esc(pat.hint || '继续探索');
      }
      const tier = pat.tier ? String(pat.tier) : '';
      const reqN = Array.isArray(pat.requires) ? pat.requires.length : 0;
      const meta2 = [pat.cls === 'weave' ? '交织' : '独石', tier, reqN ? '前置 ' + reqN + ' 条' : '无前置'].filter(Boolean).join(' · ');

      return '<button class="smAchRow ' + cls + '" data-ach="' + esc(aid) + '">'
        + '<span class="smAchTop"><span class="smAchTitle">' + title + '</span>'
        + '<span class="smAchBadge">' + (lit ? '已点亮' : (pend ? '⏳' : '未点亮')) + '</span></span>'
        + (detail ? '<span class="smAchSub">' + detail + '</span>' : '')
        + '<span class="smAchMeta">' + esc(meta2) + '</span></button>';
    }).join('');

    sideEl.innerHTML = '<div class="smSideHead"><b>' + esc(meta.title || id) + '</b>'
      + '<span class="smSideState">' + stateText + '</span>'
      + '<button class="smSideClose" title="关闭">✕</button></div>'
      + '<div class="smSideDesc">' + esc(meta.desc || '') + '</div>'
      + '<div class="smSideCount">涉及成就 <b>' + list.length + '</b> 条（已点亮 ' + litCount + '）· 全部列出（未点亮显示 ？？？+ 暗示）</div>'
      + '<div class="smAchList">' + (rows || '<span class="smAchSub">该知识点暂无成就</span>') + '</div>';
    sideEl.hidden = false;
    sideEl.classList.add('open');

    const closeBtn = sideEl.querySelector('.smSideClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    // ★ 用户要求（③）："知识卡片详情里面的成就卡片需要增加『详情』按钮，点击后左侧出现浮窗"
    //   原来是**整行点击**就打开详情；现在改成行内一个明确的「详情」按钮，只有点它才开。
    for (const btn of sideEl.querySelectorAll('.smAchRow')) {
      const det = document.createElement('button');
      det.type = 'button';
      det.className = 'smAchDetail';
      det.textContent = '详情';
      det.title = '查看这条成就的详情（左侧浮窗）';
      det.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof openDetail === 'function') {
          openDetail({ id: btn.dataset.ach, patterns, tracker, net, achNode, layer: meta.layer });
        }
      });
      btn.appendChild(det);
    }
  };
}

// ★ 用户要求（③）：浮窗要"点击其它地方关闭"。
//   这里挂一次**全局委托**监听：只要点的地方不在 #achDetail 内、也不是「详情」按钮，
//   就把浮窗移除（浮窗自己的监听器随节点一起消失，不需要额外清理）。
if (typeof document !== 'undefined' && !window.__smDetailOutsideClick) {
  window.__smDetailOutsideClick = true;
  document.addEventListener(
    'click',
    (e) => {
      const det = document.getElementById('achDetail');
      if (!det) return;
      const t = e.target;
      if (det.contains(t)) return;                                   // 点在浮窗内部 → 不关
      if (t && t.closest && t.closest('.smAchDetail')) return;       // 点「详情」按钮 → 交给它自己处理
      det.remove();                                                  // 点其它地方 → 关闭
    },
    true,
  );
}
