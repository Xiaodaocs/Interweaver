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
import { buildSidePanel } from './starmapSide.js';
import { renderBadge } from './achievementShapes.js';
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
        </div>
        <aside class="smSide" hidden></aside>
        <div style="display:none">
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  // 用户要求：成就页与工作台是**两个独立页面** —— 打开时把工作台整体隐藏并置为 inert，
  // 这样两者不可能互相"跳"（也不会再有指针/键盘事件落到工作台上）。
  document.body.classList.add('achpage');
  for (const el of [...document.body.children]) {
    if (el === root || el.tagName === 'SCRIPT') continue;
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  }

  const svg = root.querySelector('svg');
  const nodeLayer = root.querySelector('.smNodes');


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
    // 用户要求：删除小球特效（流动光点）。
    // 它此前用 SVG SMIL <animate> 实现 —— SMIL 会让浏览器持续重绘，是"成就页太卡"的主要来源之一，
    // 因此这次删除同时解决"视觉不需要"与"性能"两个问题。
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
    // ★ §11.1 枢纽视觉权重：依赖度 ≥3 的节点在视觉上"更重"，叶端更淡。
    //   这是"该密的时候密"在分层布局里的**可行**表达（几何上"枢纽更紧凑"已实测不可达：比值 2.64 vs ≤0.75）。
    let deg = 0;
    for (const [da, db] of L.deps) if (da === n2.id || db === n2.id) deg++;
    const weight = deg >= 3 ? 'hub' : (deg <= 1 ? 'leaf' : '');
    const cls = ['smNode', n2.kind === 'weave' ? 'weave' : 'concept', state, weight].filter(Boolean).join(' ');
    // 徽标形状（圆/圆角方/六边形 + 外环，按难度档）—— 与 tests/artifacts/p15-t3-routing.png 同一套观感，
    // 组件来自 achievementShapes.renderBadge（T6 详情卡已在用，形状与档位一致）。
    const lit = state === 'granted';
    const badgeSvg = renderBadge({ id: n2.id, layer: n2.layer, cls: n2.kind === 'weave' ? 'weave' : 'solo', lit });
    const mark = state === 'granted' ? '✦' : (state === 'pending' ? '⏳' : '');
    const stateText = state === 'granted' ? '已点亮' : (state === 'pending' ? '待补前置' : '未点亮');
    return `<div class="${cls}" data-node="${n2.id}" data-state="${state}" data-col="${p2.col}" data-row="${p2.row}"
      tabindex="0" role="button" aria-label="${n2.title}（${stateText}）"
      style="left:${p2.x}px;top:${p2.y}px" title="${n2.title}：${n2.desc}">`
      + badgeSvg
      + `<span class="smCap">${n2.title}${mark ? `<i class="smMark">${mark}</i>` : ''}</span></div>`;
  }).join('');

  // 悬浮说明 + 平移缩放 + 关闭
  const view = root.querySelector('.smView');
  const canvasEl = root.querySelector('.smCanvas');
  // ★ T5 相机（用户要求："刚打开时大到看不到全貌，需要缩小才能看到"）
  //   默认 1.6×、镜头对准**最近点亮的那颗星**（没有则对准最左最基本的一列），
  //   入场 700ms 从 2.4× 缓推到 1.6×（prefers-reduced-motion 下静态）。
  //   首屏因此只看到 8–14 个节点 —— 全貌需要缩小（⤢ 全览）才能看到。
  let scale = 1, tx = 0, ty = 0;
  const apply = () => { canvasEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const viewSize = () => ({ w: view.clientWidth || 1200, h: view.clientHeight || 800 });
  const centerOn = (id, s) => {
    const p = L.pos.get(id);
    if (!p) return;
    const { w, h } = viewSize();
    scale = s; tx = w / 2 - p.x * s; ty = h / 2 - p.y * s; apply();
  };
  const fitAll = () => {
    const { w, h } = viewSize();
    scale = Math.max(0.4, Math.min(w / L.width, h / L.height));
    tx = (w - L.width * scale) / 2; ty = (h - L.height * scale) / 2; apply();
  };
  const focusId = (() => {
    const lit = [...(net.nodes && net.nodes.keys ? net.nodes.keys() : [])].filter((id) => L.pos.has(id));
    if (lit.length) return lit[lit.length - 1];
    const first = [...L.pos.entries()].sort((a, b) => (a[1].col - b[1].col) || (a[1].y - b[1].y))[0];
    return first ? first[0] : null;
  })();
  const reduceMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  if (focusId) centerOn(focusId, reduceMotion ? 1.6 : 2.4);
  if (focusId && !reduceMotion) {
    const t0 = performance.now();
    const animate = () => {
      const k = Math.min(1, (performance.now() - t0) / 700);
      centerOn(focusId, 2.4 - 0.8 * k);
      if (k < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  const camBar = document.createElement('div');
  camBar.className = 'smCam';
  camBar.style.cssText = 'position:absolute;left:12px;bottom:12px;display:flex;gap:8px;z-index:6';
  const btnCss = 'padding:5px 10px;border-radius:9px;border:.5px solid #FFFFFF22;background:#0E1320E6;color:#E8ECF8;font:12px -apple-system,sans-serif;cursor:pointer';
  camBar.innerHTML = `<button id="smMine" style="${btnCss}" title="回到我的星（最近点亮的那颗）">⌖ 回到我的星</button>`
    + `<button id="smFit" style="${btnCss}" title="全览（缩小看全图）">⤢ 全览</button>`;
  view.appendChild(camBar);
  // ★ 探针实测：直接调用 fit() 有效（1.60→0.40），但点击按钮无效 —— 且该点最上层元素就是按钮本身。
  //   原因是 .smView 的 pointerdown 里调用了 setPointerCapture，后续指针/点击事件被重定向到 view，
  //   按钮自己的 click 收不到。所以两个按钮都要**阻止 pointerdown 冒泡**。
  for (const el of [camBar.querySelector('#smMine'), camBar.querySelector('#smFit')]) {
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); });
  }
  camBar.querySelector('#smMine').addEventListener('click', (e) => { e.stopPropagation(); if (focusId) centerOn(focusId, 1.6); });
  camBar.querySelector('#smFit').addEventListener('click', (e) => { e.stopPropagation(); fitAll(); });
  window.__IW = window.__IW || {};
  window.__IW.starmapCam = { get: () => ({ scale, tx, ty, focusId, w: L.width, h: L.height }), mine: () => focusId && centerOn(focusId, 1.6), fit: fitAll };
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(1.6, Math.max(0.4, scale * (e.deltaY < 0 ? 1.08 : 0.93)));
    apply();
  }, { passive: false });
  let drag = null;
  // ★ 用户反馈的根因修复：拖动结束后浏览器会补发一次 click，此前它会命中 root 触发 close()，
  //   表现为"在工作台与成就页之间不断跳"。这里记录拖动位移，位移超过阈值就把随后的 click 忽略掉。
  let dragMoved = 0;
  view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - tx, y: e.clientY - ty, sx: e.clientX, sy: e.clientY }; dragMoved = 0; view.setPointerCapture?.(e.pointerId); });
  view.addEventListener('pointermove', (e) => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; dragMoved = Math.max(dragMoved, Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy)); apply(); } });
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
  const showSide = buildSidePanel({ root, nodes, patterns, tracker, net, achNode: ACH_NODE, openDetail });
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
  nodeLayer.addEventListener('focusin', (e) => { const el = e.target.closest?.('.smNode'); if (el) { if (dragMoved > 6) return; showDetail(el); showSide(el); } });
  nodeLayer.addEventListener('click', (e) => { const el = e.target.closest?.('.smNode'); if (el) { showDetail(el); showSide(el); } });

  // 窄屏：星图改竖向列表（按层→组排序），不靠横向拖拽也能读完
  const narrow = () => window.matchMedia('(max-width: 720px)').matches;
  const applyNarrow = () => {
    root.classList.toggle('narrow', narrow());
    if (!narrow()) return;
    const ordered = [...nodes].sort((a, b) => (a.layer - b.layer) || (GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)));
    nodeLayer.innerHTML = ordered.map((n2) => {
      const state = net.nodes.has(n2.id) ? 'granted' : (pendingNodeIds.has(n2.id) ? 'pending' : 'locked');
      const lit2 = state === 'granted';
      // 与主视图统一：徽标 SVG（按难度档）+ 小字标注 + 层/组元信息（此前用 <b> 旧结构、且无徽标）
      const mark2 = renderBadge({ id: n2.id, layer: n2.layer, cls: n2.kind === 'weave' ? 'weave' : 'solo', lit: lit2 });
      return `<div class="smNode list ${n2.kind === 'weave' ? 'weave' : 'concept'} ${state}" data-node="${n2.id}" data-state="${state}"
        tabindex="0" role="button" aria-label="${n2.title}（${state === 'granted' ? '已点亮' : state === 'pending' ? '待补前置' : '未点亮'}）">
        ${mark2}<span class="smCap">${n2.title}</span>
        <span class="smListMeta">L${n2.layer} · ${n2.group}</span>${state === 'granted' ? '<i class="smMark">✦</i>' : ''}</div>`;
    }).join('');
    svg.innerHTML = '';
  };
  applyNarrow();
  window.addEventListener('resize', applyNarrow);

  const close = () => {
    root.remove();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', applyNarrow);
    document.body.classList.remove('achpage');
    for (const el of [...document.body.children]) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  };
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
  root.addEventListener('click', (e) => {
    if (dragMoved > 6) return;            // 刚拖动过 → 忽略这次补发的 click（用户反馈的跳页根因）
    if (e.target === root) close();
  });

  // 入场：按层从左到右依次淡入
  nodeLayer.querySelectorAll('.smNode').forEach((el) => {
    const id = el.dataset.node;
    const col = L.pos.get(id).col;
    el.style.animationDelay = `${col * 60}ms`;
  });

  return { root, close, layout: L, counts: { grantedSolo, totalSolo, grantedWeave, totalWeave } };
}
