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
import { layoutNeural, layoutStats, COL_W, BAND_H, PAD_X, PAD_Y, hash01, TIER_HALF } from './starmapLayout.js';
import { openDetail } from './achievementDetail.js';
import { buildSidePanel } from './starmapSide.js';
import { renderBadge, tierOf } from './achievementShapes.js';
import { SOLO_PATTERNS, WEAVE_PATTERNS } from './achievements/patterns.js';
import { LIVE_KEY, LIVE_TTL_MS } from './achievements/runtime.js';


/**
 * ★ 用户要求（两轮修正后的最终规则）：
 *   ① "神经网络的线是每一层只传给下一层……但是受限于我们的知识卡片和布局设计，无法完全进行这种设计，
 *      但是你需要尽量这么做"（尽量逐层）；
 *   ② "不要说完全找逐层相邻跳转，这样忽略了知识卡片之间的逻辑联系准确性。例如『平行四边形』和
 *      『欧拉之环』并无关联，这种情况下就继续找『平行』分支出来的适合的项，如果没有就只能直接连『平行』"
 *
 * 所以最终算法是"**语义优先**"：
 *   · 中转的**每一跳都必须是图谱里本来就存在的关系**（依赖边 / 相关边），且方向从左往右
 *     —— 绝不为了凑"相邻层"而编造连接（上一版就是那么错的：造出了毫无关联的中转）；
 *   · 长跳边在这些**真实关系**组成的图上找一条从左往右的链，找得到就拆成若干跳（尽量逐层）；
 *   · **找不到就保留原来那条直达边**（哪怕跨层）—— 因为它本身就是一条真实关系，
 *     这正对应用户说的"如果没有就只能直接连『平行』"。
 */
function routeByLayers(edges, nodes, extraLinks = []) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const L = (id) => byId.get(id)?.layer ?? 0;
  // 语义跳图：只收**真实关系**，且只保留"从左往右"的方向（保证连线一路向右）
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  const relSet = new Set();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [a, b] of [...edges, ...extraLinks]) {
    if (!byId.has(a) || !byId.has(b) || a === b) continue;
    relSet.add(key(a, b));
    if (L(a) < L(b)) add(a, b);
    else if (L(b) < L(a)) add(b, a);
  }
  const rel = (a, b) => relSet.has(key(a, b));

  // 在语义跳图上找"A→…→B"（只能向右走）：跳数最少者优先，
  // 同跳数时优先经过"与两端之一直接相关"的节点（更讲得通）。
  const path = (from, to) => {
    if (from === to || L(from) >= L(to)) return null;
    const prev = new Map([[from, null]]);
    let frontier = [from];
    for (let hop = 0; hop < 8 && frontier.length; hop++) {
      const next = [];
      for (const cur of frontier) {
        for (const nx of (adj.get(cur) || [])) {
          if (prev.has(nx)) continue;
          prev.set(nx, cur);
          if (nx === to) {
            const out = [];
            for (let k = to; k != null; k = prev.get(k)) out.push(k);
            return out.reverse();
          }
          next.push(nx);
        }
      }
      // 同层优先取"与两端相关"的节点，让中转更讲得通
      next.sort((x, y) => (rel(from, y) || rel(to, y) ? 1 : 0) - (rel(from, x) || rel(to, x) ? 1 : 0));
      frontier = next;
    }
    return null;
  };

  const out = [];
  const seen = new Set();
  const push = (a, b) => {
    const k = key(a, b);
    if (a === b || seen.has(k)) return;
    seen.add(k);
    out.push(L(a) <= L(b) ? [a, b] : [b, a]);
  };
  let split = 0, kept = 0, invented = 0;
  for (const [a, b] of edges) {
    const p = path(a, b);
    // path 只有 1 跳时，那跳就是这条边自己 —— 不算"拆开"
    if (!p || p.length <= 2) {
      if (!rel(a, b)) invented++;      // 理论上不该发生：原始边一定是真实关系
      push(a, b);
      kept++;
      continue;
    }
    for (let i = 0; i + 1 < p.length; i++) push(p[i], p[i + 1]);
    split++;
  }
  // 自检：画出来的每一跳都必须是**真实关系**（防止"为了凑逐层而编造连接"回归）
  const fakeHop = out.filter(([a, b]) => !rel(a, b));
  return { edges: out, split, kept, invented, fakeHop: fakeHop.length };
}

/** T2 有机布局：层波动 + 软组带 + 确定性抖动 + 松弛（设计 §2.1–§2.3） */
export function layoutStarMap(nodes = KNOWLEDGE_NODES, patterns = [...SOLO_PATTERNS, ...WEAVE_PATTERNS]) {
  const rawDeps = allDepEdges(patterns);
  const related = allRelatedEdges();
  // 长跳边改走"逐层中转"（用户要求：每层只传给下一层）
  const routed = routeByLayers(rawDeps, nodes, related);
  const deps = routed.edges;
  const L = layoutNeural(nodes, GROUPS, deps);   // 神经网络式：严格按层分列、左→右（用户要求重排）
  return {
    pos: L.pos, layers: L.layers, width: L.width, height: L.height,
    deps, related,
    rawDepCount: rawDeps.length,
    split: routed.split,
    keptLong: routed.kept,
    fakeHop: routed.fakeHop,
    invented: routed.invented,
    stats: layoutStats(nodes, L),
  };
}

/**
 * 打开成就页。
 * @param deps { tracker, net, patterns, onClose }
 */
export function openStarMap({ tracker, net, patterns = [...SOLO_PATTERNS, ...WEAVE_PATTERNS], nodes = KNOWLEDGE_NODES, mount = null, onClose = null }) {
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
        <span class="smHud">独石 ${grantedSolo}/${totalSolo}　·　交织 ${grantedWeave}/${totalWeave}　·　知识点 ${net.nodes.size}/${nodes.length}　·　连线 ${net.edges.size}　·　<span class="smInUseHud"></span></span>
        <span class="smLegend">
          <i class="lgDot"></i>知识点
          <i class="lgWeave"></i>交织（结）
          <i class="lgEdge" style="opacity:.35"></i><i class="lgEdge"></i><i class="lgEdge" style="opacity:1"></i>织边 1/2/3 档
          <i class="lgRel"></i>同组相关
          <i class="lgLive"></i>正在使用中
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
  (mount || document.body).appendChild(root);
  // 独立页面后不再需要「隐藏工作台 + inert」的权宜手段（已随页面分离删除）。

  const svg = root.querySelector('svg');
  const nodeLayer = root.querySelector('.smNodes');


  // 边：**神经网络式曲线布线**（用户要求，替换掉原来的"正交走线 + 车道 + 障碍绕行 + 跨线拱桥"）
  //   ① 卡片之间用**略带弧度的曲线**连接 —— 强调"关联感"，像神经网络的突触；
  //   ② 线之间**允许自由交叉** —— 不再做车道分配与障碍绕行，也不画跨线拱桥；
  //   ③ 所有线**必须在最底层** —— 由 .smCanvas 里 svg(z-index:0) < .smNodes(z-index:1) 保证
  //      （见 styles.css「神经式布线」块；并有浏览器实测用 elementFromPoint 验证线在卡片之下）。
  const svgNS = 'http://www.w3.org/2000/svg';
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // 端点接到**徽标边缘**（TIER_HALF 按难度档 23/26/29，与旧布线同一套视觉意图），
  // 而不是卡片外框（CARD_BOX 更大，会让线头与图形之间留出空隙）。
  const halfOf = (id) => {
    const h = TIER_HALF[tierOf(nodeById.get(id)?.layer)] || TIER_HALF[3];
    return { hw: h, hh: h };
  };
  // 从卡片中心朝目标方向，落到**卡片边框**上的点 —— 线因此不会钻到卡片底下
  const edgePoint = (p, hw, hh, tx, ty) => {
    const dx = tx - p.x, dy = ty - p.y;
    if (!dx && !dy) return [p.x, p.y];
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return [p.x + dx * t, p.y + dy * t];
  };
  let floatSeed = 0;
  // ★ 用户更正（本轮）："我所指的浮动是连接线呈现动态微波状浮动，是说的是动画。
  //   改回之前的神经网络式弯曲布线。" —— 所以线形**改回"单段弧"**（下面的二次贝塞尔），
  //   "浮动"交给 CSS 动画（见 styles.css 的 smWave：便宜的 transform 微幅起伏 + 错相延迟）。
  const mkCurve = (u, v, cls, width = 1.2) => {
    const a = L.pos.get(u), b = L.pos.get(v);
    if (!a || !b) return null;
    const A = halfOf(u), B = halfOf(v);
    const [x1, y1] = edgePoint(a, A.hw, A.hh, b.x, b.y);
    const [x2, y2] = edgePoint(b, B.hw, B.hh, a.x, a.y);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // 弧度大小/方向由两端 id 的确定性哈希决定 —— 每条线都不一样，整体才像神经网络而不是一束平行线
    const bow = Math.min(44, len * 0.13) * (hash01(`${u}>${v}`) - 0.5) * 2;
    const mx = (x1 + x2) / 2 - (dy / len) * bow;
    const my = (y1 + y2) / 2 + (dx / len) * bow;
    const el = document.createElementNS(svgNS, 'path');
    el.setAttribute('d', `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    el.setAttribute('fill', 'none');
    el.setAttribute('class', cls);
    el.setAttribute('stroke-width', String(width));
    el.setAttribute('stroke-linecap', 'round');
    el.dataset.a = u;                    // 供"选中卡片 → 相关线亮起"用
    el.dataset.b = v;
    // 错相延迟：每条线起伏的相位不同，整体才像"活的"而不是整块同步抖动
    el.style.animationDelay = (-(floatSeed++ * 0.53) % 6).toFixed(2) + 's';
    svg.appendChild(el);
    return el;
  };
  // 三类边都走同一套曲线：依赖（结构）/ 同组相关 / 织出来的边（强度 1–3 → 粗细）
  const drawnEdges = [];
  for (const [u, v] of L.deps) { const el = mkCurve(u, v, 'smDep', 1.4); if (el) drawnEdges.push(el); }
  for (const [u, v] of L.related) { const el = mkCurve(u, v, 'smRel', 1.2); if (el) drawnEdges.push(el); }
  const woven = [...net.edges.values()].filter((e) => L.pos.has(e.u) && L.pos.has(e.v));
  for (const e of woven) {
    const el = mkCurve(e.u, e.v, 'smWoven', 1 + e.strength * 1.1);
    if (el) drawnEdges.push(el);
  }
  // 用户要求：删除小球特效（流动光点）—— SMIL 会让浏览器持续重绘，是"成就页太卡"的主因之一。

  // ★ 用户要求（本轮修正）：选中一个知识卡片 → **只有直接相连的**卡片与线亮起。
  //   上一版按"连通域（可达的全部）"高亮，用户反馈："现在选择其中一个知识卡片，画布上的所有东西都会亮起
  //   （除了那些独立的），因为线全部连起来了" —— 所以改成**一跳邻居**：
  //     · 亮起的卡片 = 选中卡 + 它的直接邻居
  //     · 亮起的线   = **与选中卡直接相连**的那些线（不是"域内任意两端都亮"）
  //   其余整体变暗，突出这一小簇。
  const adj = new Map();
  const link = (u, v) => {
    if (!L.pos.has(u) || !L.pos.has(v)) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u).add(v); adj.get(v).add(u);
  };
  for (const [u, v] of L.deps) link(u, v);
  for (const [u, v] of L.related) link(u, v);
  for (const e of woven) link(e.u, e.v);
  /** 一跳邻居（含自己） */
  const neighborsOf = (id) => {
    const out = new Set([id]);
    for (const nb of (adj.get(id) || [])) out.add(nb);
    return out;
  };
  const clearHighlight = () => {
    for (const el of nodeLayer.querySelectorAll('.smNode')) el.classList.remove('lit', 'dim', 'sel');
    for (const el of drawnEdges) el.classList.remove('lit', 'dim');
    root.classList.remove('hasSel');
  };
  // ★ 用户要求："选中其中一个知识卡片时，镜头要移到它和与其连接的卡片上"
  //   把选中卡 + 它的直接邻居一起框进视野（留出边距），平滑过渡 260ms。
  const flyToBox = (pts, pad = 130) => {
    if (!pts.length) return;
    const { w, h } = viewSize();
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const bw = Math.max(1, maxX - minX) + pad * 2;
    const bh = Math.max(1, maxY - minY) + pad * 2;
    const targetScale = Math.max(0.4, Math.min(1.6, Math.min(w / bw, h / bh)));
    const targetTx = w / 2 - (minX + maxX) / 2 * targetScale;
    const targetTy = h / 2 - (minY + maxY) / 2 * targetScale;
    const s0 = scale, t0x = tx, t0y = ty;
    const t0 = performance.now();
    const dur = reduceMotion ? 0 : 260;
    const step = () => {
      const k = dur <= 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);                 // ease-out cubic
      scale = s0 + (targetScale - s0) * e;
      tx = t0x + (targetTx - t0x) * e;
      ty = t0y + (targetTy - t0y) * e;
      paintCam();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const highlightComponent = (id, opts = {}) => {
    if (!id || !L.pos.has(id)) { clearHighlight(); return null; }
    const set = neighborsOf(id);
    root.classList.add('hasSel');
    for (const el of nodeLayer.querySelectorAll('.smNode')) {
      const on = set.has(el.dataset.node);
      el.classList.toggle('lit', on);
      el.classList.toggle('dim', !on);
      el.classList.toggle('sel', el.dataset.node === id);   // 选中的那张自己略放大（CSS）
      el.setAttribute('aria-selected', el.dataset.node === id ? 'true' : 'false');
    }
    for (const el of drawnEdges) {
      // 线只有**直接接在选中卡上**才亮（不是"域内任意两端都亮"）
      const on = el.dataset.a === id || el.dataset.b === id;
      el.classList.toggle('lit', on);
      el.classList.toggle('dim', !on);
    }
    // 镜头：把选中的卡与它的直接邻居一起框进来
    if (opts.fly) flyToBox([...set].map((k) => L.pos.get(k)).filter(Boolean));
    return set;
  };

  // ★ 用户要求："正在使用中"效果 —— 实时监测画布内容涉及到的知识卡片，
  //   打开成就页时给这些卡片头顶加上**金色圆点向上扩散**的动效。
  //   数据来自工作台（同一个源）写进 localStorage 的 live 记录；过期或读不到就当没有。
  const liveIds = (() => {
    try {
      const raw = localStorage.getItem(LIVE_KEY);
      if (!raw) return new Set();
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.ids)) return new Set();
      if (!Number.isFinite(d.at) || (Date.now() - d.at) > LIVE_TTL_MS) return new Set();   // 过期：工作台可能已关闭
      return new Set(d.ids);
    } catch { return new Set(); }
  })();
  // 页头明确写出"正在使用中"的数量 —— 用户反馈"我看不到使用中的效果"，
  // 先让"有没有、有几个"本身可见：0 个时也能一眼看出是"画布上没有涉及知识点"，
  // 而不是"功能坏了"。
  {
    const hud = root.querySelector('.smInUseHud');
    if (hud) {
      hud.textContent = liveIds.size ? `使用中 ${liveIds.size}` : '使用中 0';
      hud.style.color = liveIds.size ? '#FFE6A8' : '#7A8299';
    }
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
    // ★ "正在使用中"：这张卡片此刻正被画布上的内容用到（工作台实时写入）
    const inUse = liveIds.has(n2.id);
    const cls = ['smNode', n2.kind === 'weave' ? 'weave' : 'concept', state, weight, inUse ? 'inuse' : ''].filter(Boolean).join(' ');
    // 徽标形状（圆/圆角方/六边形 + 外环，按难度档）—— 与 tests/artifacts/p15-t3-routing.png 同一套观感，
    // 组件来自 achievementShapes.renderBadge（T6 详情卡已在用，形状与档位一致）。
    const lit = state === 'granted';
    const badgeSvg = renderBadge({ id: n2.id, layer: n2.layer, cls: n2.kind === 'weave' ? 'weave' : 'solo', lit });
    const mark = state === 'granted' ? '✦' : (state === 'pending' ? '⏳' : '');
    const stateText = state === 'granted' ? '已点亮' : (state === 'pending' ? '待补前置' : '未点亮');
    // 头顶金色上升圆点：4 颗错相（CSS 负责动画，只用 transform/opacity → 走合成器，不重绘）
    const liveDots = inUse ? '<span class="smLive" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : '';
    return `<div class="${cls}" data-node="${n2.id}" data-state="${state}" data-col="${p2.col}" data-row="${p2.row}" data-tier="${tierOf(n2.layer)}"${inUse ? ' data-inuse="1"' : ''}
      tabindex="0" role="button" aria-label="${n2.title}（${stateText}${inUse ? '，正在使用中' : ''}）"
      style="left:${p2.x}px;top:${p2.y}px" title="${n2.title}：${n2.desc}${inUse ? '（正在使用中）' : ''}">`
      + liveDots
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
  // ★ 用户反馈：「缩小到全局并快速拖动时，连线会被甩没，停下轻拖才恢复」——
  //   这是**合成器来不及重栅格化**的典型表现：原来每个 pointermove 都直接写一次 transform，
  //   高刷新率鼠标每秒上百次 → 浏览器反复作废并重栅格化整块画布 → 细长的连线最先画不出来。
  //   现在把 transform 写入**合并到每帧一次**（rAF），并顺带按缩放切换「低倍隐藏标签」，
  //   大幅降低重栅格化成本（标签带 text-shadow，是单元素里最贵的一类）。
  let rafPending = false;
  const paintCam = () => {
    canvasEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    // 缩到全局时标签已不可读，隐藏它们可显著降低绘制成本（用户反馈的卡顿/丢元素场景）
    root.classList.toggle('lowzoom', scale < 0.62);
  };
  const apply = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; paintCam(); });
  };
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
  // ★ 用户反馈"我看不到使用中的效果" —— 诊断出的头号原因：
  //   默认镜头对准"最近点亮的那颗星"，而**正在使用中**的卡片往往在视野之外。
  //   所以有"使用中"的卡片时，入场镜头改为**把它们全部框进视野**（有金色圆点的那些），
  //   保证用户一进来就能看到效果；没有使用中的卡片时才退回原来的"最近点亮/最左列"逻辑。
  const liveList = [...liveIds].filter((id) => L.pos.has(id));
  if (liveList.length) {
    const pts = liveList.map((id) => L.pos.get(id));
    const { w, h } = viewSize();
    const pad = 170;
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const s = Math.max(0.4, Math.min(1.6, Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2))));
    scale = s;
    tx = w / 2 - (minX + maxX) / 2 * s;
    ty = h / 2 - (minY + maxY) / 2 * s;
    paintCam();
    // 入场时从略远处推近（与原来的入场手感一致）
    if (!reduceMotion) {
      const t0 = performance.now();
      const s1 = Math.min(1.6, s * 1.5);
      const animate = () => {
        const k = Math.min(1, (performance.now() - t0) / 600);
        const cur = s1 + (s - s1) * (1 - Math.pow(1 - k, 3));
        scale = cur;
        tx = w / 2 - (minX + maxX) / 2 * cur;
        ty = h / 2 - (minY + maxY) / 2 * cur;
        paintCam();
        if (k < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  } else if (focusId) {
    centerOn(focusId, reduceMotion ? 1.6 : 2.4);
    if (!reduceMotion) {
      const t0 = performance.now();
      const animate = () => {
        const k = Math.min(1, (performance.now() - t0) / 700);
        centerOn(focusId, 2.4 - 0.8 * k);
        if (k < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
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
  // ★ 用户要求：**缩放必须跟着鼠标指针**（指针下的那个点保持不动）。
  //   原实现只改 scale、不动 tx/ty → 缩放锚点永远是画布原点(0,0)，鼠标一挪就"跑偏"。
  //   正确做法：把指针位置换算到画布坐标，按缩放比例反推 tx/ty：
  //     world = (mouse - t) / scale  →  要让同一个 world 仍落在 mouse 上：
  //     t' = mouse - world * scale'  =  mouse - (mouse - t) * (scale'/scale)
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const mx = e.clientX - r.left;      // 指针在视口内的坐标（tx/ty 也是这个坐标系）
    const my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.08 : 0.93;
    const ns = Math.min(1.6, Math.max(0.4, scale * k));
    if (ns === scale) return;
    const f = ns / scale;
    tx = mx - (mx - tx) * f;
    ty = my - (my - ty) * f;
    scale = ns;
    apply();
  }, { passive: false });
  let drag = null;
  // ★ 用户反馈的根因修复：拖动结束后浏览器会补发一次 click，此前它会命中 root 触发 close()，
  //   表现为"在工作台与成就页之间不断跳"。这里记录拖动位移，位移超过阈值就把随后的 click 忽略掉。
  let dragMoved = 0;
  // 用户要求：只支持左键；在成就卡片/右侧面板/按钮上按下不平移（取消『拖卡片=拖动地图』）。
  const panStart = (e) => {
    if (e.button !== 0) return false;
    if (e.target.closest && e.target.closest('.smNode, .smSide, .smHead, button')) return false;
    return true;
  };
  view.addEventListener('pointerdown', (e) => {
    if (!panStart(e)) return;
    drag = { x: e.clientX - tx, y: e.clientY - ty, sx: e.clientX, sy: e.clientY };
    dragMoved = 0;
    root.classList.add('dragging');
    view.setPointerCapture?.(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; dragMoved = Math.max(dragMoved, Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy)); apply(); } });
  const endDrag = () => {
    drag = null;
    setTimeout(() => root.classList.remove('dragging'), 180);
  };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  // 点空白处（不是卡片、不是按钮、且没有拖动）→ 取消选中，恢复整体亮度
  view.addEventListener('click', (e) => {
    if (dragMoved > 6) return;
    if (e.target.closest && e.target.closest('.smNode, button, .smSide, .smCam')) return;
    clearHighlight();
  });
  // —— 无障碍：键盘可在星图上移动焦点；Enter 看详情；窄屏自动改竖向列表 ——
  const detail = document.createElement('div');
  detail.className = 'smDetail';
  detail.setAttribute('role', 'status');
  detail.setAttribute('aria-live', 'polite');
  root.querySelector('.smInner').appendChild(detail);
  // fly=true 时才移动镜头（点击选中要移；键盘聚焦/list 视图不移，避免视线被抢）
  const showDetail = (el, opts = {}) => {
    if (!el) return;
    const id = el.dataset.node;
    const meta = nodes.find((x) => x.id === id);
    const st2 = el.dataset.state;
    // ★ 选中即高亮**直接相连**的那些（用户本轮修正），并在文字里说清数量
    const comp = highlightComponent(id, opts);
    const related = [...net.edges.values()].filter((e) => e.u === id || e.v === id);
    detail.innerHTML = `<b>${meta?.title || id}</b>　<span class="smState">${
      st2 === 'granted' ? '已点亮' : (st2 === 'pending' ? '⏳ 待补前置' : '未点亮')}</span>`
      + `<span class="smDesc">${meta?.desc || ''}</span>`
      + (comp && comp.size > 1 ? `<span class="smRel2">已亮起：直接相连 ${comp.size - 1} 个知识点</span>` : '')
      + (related.length ? `<span class="smRel2">织边 ${related.length} 条：${related.slice(0, 4).map((e) => (nodes.find((x) => x.id === (e.u === id ? e.v : e.u))?.title || '')).join('、')}${related.length > 4 ? ' …' : ''}</span>` : '');
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
  nodeLayer.addEventListener('click', (e) => { const el = e.target.closest?.('.smNode'); if (el) { showDetail(el, { fly: true }); showSide(el); } });   // 点击 → 镜头移到它和它相连的卡片上

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
    if (typeof onClose === 'function') onClose();   // 独立成就页 → 返回工作台
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
  root.addEventListener('click', (e) => { if (e.target === root) close(); });   // 注：.smInner 铺满 root，此分支实际不会触发（保留原样，不再加守卫）

  // 入场：按层从左到右依次淡入
  nodeLayer.querySelectorAll('.smNode').forEach((el) => {
    const id = el.dataset.node;
    const col = L.pos.get(id).col;
    el.style.animationDelay = `${col * 60}ms`;
  });

  return { root, close, layout: L, counts: { grantedSolo, totalSolo, grantedWeave, totalWeave } };
}
