// S6 · 横向星图（成就页）
//
// 布局：**X＝难度层级（左易右难）**，Y＝四个分组色带；同层内用重心法排序减少交叉。
// 这是用户要的那个效果：越往右越难，全部点亮时右侧自然形成**密集交织团**。
//
// 三态（成就只增不减，所以只有这三种）：
//   locked  未点亮：雾中灰点
//   pending ⏳ 待补前置：虚线圈 + ⏳，悬浮列出"差哪几步"
//   granted 已点亮：暖金实心 + 外发光（**醒目，不用变暗表达任何状态**）
// 结节点：kind:'weave' 的知识点（B 类交织成就的成果）画成**菱形结**，与圆形知识点区分。
import { KNOWLEDGE_NODES, GROUPS, ACH_NODE, allDepEdges, allRelatedEdges } from './achievements/nodes.js';
import { layoutOrganic, layoutStats, COL_W, BAND_H, PAD_X, PAD_Y } from './starmapLayout.js';
import { openDetail } from './achievementDetail.js';
import { routeEdges } from './edgeRouting.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from './achievements/patterns.js';


/** T2 有机布局：层波动 + 软组带 + 确定性抖动 + 松弛（设计 §2.1–§2.3） */
export function layoutStarMap(nodes = KNOWLEDGE_NODES, patterns = [...SOLO_PATTERNS, ...WEAVE_PATTERNS]) {
  const deps = allDepEdges(patterns);
  const L = layoutOrganic(nodes, GROUPS, deps);
  return {
    pos: L.pos, layers: L.layers, width: L.width, height: L.height,
    deps, related: allRelatedEdges(),
    stats: layoutStats(nodes, L),
  };
}

/**
 * 打开成就页。
 * @param deps { tracker, net, patterns, onClose }
 */
export function openStarMap({ tracker, net, patterns = [...SOLO_PATTERNS, ...WEAVE_PATTERNS], nodes = KNOWLEDGE_NODES }) {
  const L = layoutStarMap(nodes, patterns);
  const all = patterns;
  const totalSolo = all.filter((p) => p.cls !== 'weave').length;
  const totalWeave = all.filter((p) => p.cls === 'weave').length;
  const grantedSolo = [...tracker.granted.values()].filter((g) => g.cls !== 'weave').length;
  const grantedWeave = [...tracker.granted.values()].filter((g) => g.cls === 'weave').length;

  const root = document.createElement('div');
  root.id = 'starMap';
  root.innerHTML = `
    <div class="smInner">
      <div class="smHead">
        <b>知识网</b>
        <span class="smHud">独石 ${grantedSolo}/${totalSolo}　·　交织 ${grantedWeave}/${totalWeave}　·　知识点 ${net.nodes.size}/${nodes.length}　·　连线 ${net.edges.size}</span>
        <span class="smLegend">
          <i class="lgDot"></i>知识点
          <i class="lgWeave"></i>交织（结）
          <i class="lgEdge" style="opacity:.35"></i><i class="lgEdge"></i><i class="lgEdge" style="opacity:1"></i>织边 1/2/3 档
          <i class="lgRel"></i>同组相关
        </span>
        <button id="smExport" title="导出进度（成就 + 知识网）">导出</button>
        <button id="smImport" title="导入进度文件">导入</button>
        <input id="smFile" type="file" accept="application/json,.json" hidden>
        <button id="smClose" title="关闭（Esc）">✕</button>
      </div>
      <div class="smView">
        <div class="smCanvas" style="width:${L.width}px;height:${L.height}px">
          <svg width="${L.width}" height="${L.height}"></svg>
          <div class="smNodes"></div>
          <div class="smCols"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const svg = root.querySelector('svg');
  const nodeLayer = root.querySelector('.smNodes');
  const colLayer = root.querySelector('.smCols');

  // 列标签与分组色带
  colLayer.innerHTML = L.layers.map((lay, i) => `<div class="smCol" style="left:${PAD_X + i * COL_W}px;top:${PAD_Y - 34}px">L${lay}</div>`).join('')
    + GROUPS.map((g, i) => `<div class="smBand" style="top:${PAD_Y + i * BAND_H - 12}px;height:${BAND_H - 8}px"><span>${g}</span></div>`).join('');

  // 边：**正交走线 + 车道分配 + 障碍绕行**（设计 §3，已拍板 A+α）
  // 不再用斜直线直连 —— 直线在密集处会糊成一团；正交走线保证"多而不乱"，
  // 水平段与竖向段相交处画 2px 小拱桥（Minecraft 成就系统那种"一眼能看出是两条线"）。
  const svgNS = 'http://www.w3.org/2000/svg';
  const routeNodes = [...L.pos.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, col: p.col }));
  const routeSet = (list, kind) => routeEdges(routeNodes, list.map(([from, to]) => ({ from, to, kind })));
  const routedDep = routeSet(L.deps, 'dep');
  const routedRel = routeSet(L.related, 'rel');
  let floatSeed = 0;
  const mkPoly = (points, cls, width = 1) => {
    const el = document.createElementNS(svgNS, 'polyline');
    el.setAttribute('points', points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    el.setAttribute('fill', 'none');
    el.setAttribute('class', cls);
    el.setAttribute('stroke-width', String(width));
    el.setAttribute('stroke-linejoin', 'round');
    // 错相浮动：每条线不同的延迟，避免整体同步起伏（"浮动感"而不是"整块抖动"）
    el.style.animationDelay = ((floatSeed++ * 0.37) % 7).toFixed(2) + 's';
    svg.appendChild(el);
    return el;
  };
  const mkBridge = (x, y) => {                       // 跨线小拱桥
    const el = document.createElementNS(svgNS, 'path');
    el.setAttribute('d', `M ${(x - 3.4).toFixed(1)} ${y.toFixed(1)} A 3.4 3.4 0 0 1 ${(x + 3.4).toFixed(1)} ${y.toFixed(1)}`);
    el.setAttribute('fill', 'none');
    el.setAttribute('class', 'smBridge');
    svg.appendChild(el);
    return el;
  };
  for (const p of routedDep.paths) {
    mkPoly(p.points, 'smDep', 1);
    for (const [bx, by] of p.bridges) mkBridge(bx, by);
  }
  for (const p of routedRel.paths) {
    mkPoly(p.points, 'smRel', 1);
    for (const [bx, by] of p.bridges) mkBridge(bx, by);
  }

  // 织出来的边：强度 1–3 → 粗细/亮度；同样走正交路线，并带流动光点
  const woven = [...net.edges.values()].filter((e) => L.pos.has(e.u) && L.pos.has(e.v));
  for (const e of woven) {
    const r = routeSet([[e.u, e.v]], 'woven');
    const path = r.paths[0];
    if (!path) continue;
    mkPoly(path.points, 'smWoven', 1 + e.strength * 1.1);
    for (const [bx, by] of path.bridges) mkBridge(bx, by);
    const A = path.points[0], B = path.points[path.points.length - 1];
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('r', String(1.6 + e.strength * 0.5));
    dot.setAttribute('class', 'smFlow');
    dot.setAttribute('cx', String(A[0])); dot.setAttribute('cy', String(A[1]));
    const mid = path.points[2] || A;
    dot.innerHTML = `<animate attributeName="cx" from="${A[0]}" to="${mid[0]}" dur="${1.2 - e.strength * 0.2}s" repeatCount="indefinite"/>`
      + `<animate attributeName="cy" from="${A[1]}" to="${mid[1]}" dur="${1.2 - e.strength * 0.2}s" repeatCount="indefinite"/>`;
    svg.appendChild(dot);
  }

  // 节点：三态 + 结节点形状
  //   状态只由两处事实决定：net.nodes（已点亮）与 tracker.pending（待补前置，经 成就→知识点 映射）
  const pendingNodeIds = new Set();
  for (const [achId, info] of tracker.pending) {
    const nodeId = ACH_NODE[achId];
    if (nodeId && (info.missing || []).length) pendingNodeIds.add(nodeId);
  }
  nodeLayer.innerHTML = nodes.map((n2) => {
    const p2 = L.pos.get(n2.id);
    const state = net.nodes.has(n2.id) ? 'granted' : (pendingNodeIds.has(n2.id) ? 'pending' : 'locked');
    const cls = ['smNode', n2.kind === 'weave' ? 'weave' : 'concept', state].join(' ');
    const badge = state === 'granted' ? '<i class="smTick">✦</i>' : (state === 'pending' ? '<i class="smPend">⏳</i>' : '');
    const stateText = state === 'granted' ? '已点亮' : (state === 'pending' ? '待补前置' : '未点亮');
    return `<div class="${cls}" data-node="${n2.id}" data-state="${state}" data-col="${p2.col}" data-row="${p2.row}"
      tabindex="0" role="button" aria-label="${n2.title}（${stateText}）"
      style="left:${p2.x}px;top:${p2.y}px" title="${n2.title}：${n2.desc}">`
      + `<b>${n2.title}</b>${badge}</div>`;
  }).join('');

  // 悬浮说明 + 平移缩放 + 关闭
  const view = root.querySelector('.smView');
  const canvasEl = root.querySelector('.smCanvas');
  let scale = 1, tx = 0, ty = 0;
  const apply = () => { canvasEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(1.6, Math.max(0.4, scale * (e.deltaY < 0 ? 1.08 : 0.93)));
    apply();
  }, { passive: false });
  let drag = null;
  view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - tx, y: e.clientY - ty }; view.setPointerCapture?.(e.pointerId); });
  view.addEventListener('pointermove', (e) => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } });
  view.addEventListener('pointerup', () => { drag = null; });
  // —— 无障碍：键盘可在星图上移动焦点；Enter 看详情；窄屏自动改竖向列表 ——
  const detail = document.createElement('div');
  detail.className = 'smDetail';
  detail.setAttribute('role', 'status');
  detail.setAttribute('aria-live', 'polite');
  root.querySelector('.smInner').appendChild(detail);
  const showDetail = (el) => {
    if (!el) return;
    const id = el.dataset.node;
    const meta = nodes.find((x) => x.id === id);
    const st2 = el.dataset.state;
    const related = [...net.edges.values()].filter((e) => e.u === id || e.v === id);
    detail.innerHTML = `<b>${meta?.title || id}</b>　<span class="smState">${
      st2 === 'granted' ? '已点亮' : (st2 === 'pending' ? '⏳ 待补前置' : '未点亮')}</span>`
      + `<span class="smDesc">${meta?.desc || ''}</span>`
      + (related.length ? `<span class="smRel2">连线 ${related.length} 条：${related.slice(0, 4).map((e) => (nodes.find((x) => x.id === (e.u === id ? e.v : e.u))?.title || '')).join('、')}${related.length > 4 ? ' …' : ''}</span>` : '');
  };
  const focusables = () => [...nodeLayer.querySelectorAll('.smNode')];
  const focusNode = (el) => { if (el) { el.focus(); showDetail(el); } };
  const onNodeKey = (e) => {
    const el = e.target.closest?.('.smNode');
    if (!el) return;
    const col = Number(el.dataset.col), row = Number(el.dataset.row);
    const all = focusables();
    const pick = (pred) => all.filter(pred).sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row))[0];
    if (e.key === 'ArrowRight') { e.preventDefault(); focusNode(pick((x) => Number(x.dataset.col) > col)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusNode([...all].filter((x) => Number(x.dataset.col) < col).sort((a, b) => Number(b.dataset.col) - Number(a.dataset.col))[0]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusNode(all.filter((x) => Number(x.dataset.col) === col && Number(x.dataset.row) > row).sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row))[0]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusNode(all.filter((x) => Number(x.dataset.col) === col && Number(x.dataset.row) < row).sort((a, b) => Number(b.dataset.row) - Number(a.dataset.row))[0]); }
    else if (e.key === 'Enter' || e.key === ' ') {
      // T10：Enter 打开 T6 详情卡（详细内容/画面/暗示），底部一行只作为焦点提示
      e.preventDefault();
      showDetail(el);
      const nid = el.dataset.node;
      const achId = Object.keys(ACH_NODE).find((k) => ACH_NODE[k] === nid);
      if (achId) {
        openDetail({ id: achId, patterns, tracker, net, achNode: ACH_NODE, layer: (nodes.find((x) => x.id === nid) || {}).layer });
      }
    }
  };
  nodeLayer.addEventListener('keydown', onNodeKey);
  nodeLayer.addEventListener('focusin', (e) => { const el = e.target.closest?.('.smNode'); if (el) showDetail(el); });
  nodeLayer.addEventListener('click', (e) => { const el = e.target.closest?.('.smNode'); if (el) showDetail(el); });

  // 窄屏：星图改竖向列表（按层→组排序），不靠横向拖拽也能读完
  const narrow = () => window.matchMedia('(max-width: 720px)').matches;
  const applyNarrow = () => {
    root.classList.toggle('narrow', narrow());
    if (!narrow()) return;
    const ordered = [...nodes].sort((a, b) => (a.layer - b.layer) || (GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)));
    nodeLayer.innerHTML = ordered.map((n2) => {
      const state = net.nodes.has(n2.id) ? 'granted' : (pendingNodeIds.has(n2.id) ? 'pending' : 'locked');
      return `<div class="smNode list ${n2.kind === 'weave' ? 'weave' : 'concept'} ${state}" data-node="${n2.id}" data-state="${state}"
        tabindex="0" role="button" aria-label="${n2.title}（${state === 'granted' ? '已点亮' : state === 'pending' ? '待补前置' : '未点亮'}）">
        <b>${n2.title}</b><span class="smListMeta">L${n2.layer} · ${n2.group}</span>${state === 'granted' ? '<i class="smTick">✦</i>' : ''}</div>`;
    }).join('');
    svg.innerHTML = '';
  };
  applyNarrow();
  window.addEventListener('resize', applyNarrow);

  const close = () => { root.remove(); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', applyNarrow); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  root.querySelector('#smClose').addEventListener('click', close);

  // 导出 / 导入：非法文件给出人话错误，且**不写库**（由 importProgress 保证）
  root.querySelector('#smExport').addEventListener('click', () => {
    const text = serializeProgress({ tracker, net });
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'interweaver-progress.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  root.querySelector('#smImport').addEventListener('click', () => root.querySelector('#smFile').click());
  root.querySelector('#smFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = importProgress({ tracker, net, save: () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, tracker: exportTracker(tracker), net: exportNet(net) })); } catch { /* ignore */ } }, reset: () => { tracker.granted.clear(); tracker.since.clear(); tracker.pending.clear(); net.nodes.clear(); net.edges.clear(); } }, text);
    const line = root.querySelector('.smHud');
    if (!res.ok) { line.textContent = '⚠ 导入失败：' + res.error; return; }
    line.textContent = `✓ 已导入（新增成就 ${res.added.achievements} · 节点 ${res.added.nodes} · 边 ${res.added.edges}）`;
    setTimeout(() => { root.remove(); window.removeEventListener('keydown', onKey); openStarMap({ tracker, net, patterns, nodes }); }, 700);
  });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  // 入场：按层从左到右依次淡入
  nodeLayer.querySelectorAll('.smNode').forEach((el) => {
    const id = el.dataset.node;
    const col = L.pos.get(id).col;
    el.style.animationDelay = `${col * 60}ms`;
  });

  return { root, close, layout: L, counts: { grantedSolo, totalSolo, grantedWeave, totalWeave } };
}
