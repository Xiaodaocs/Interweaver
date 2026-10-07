// T6 · 成就详情卡（设计 §7.2）
//
// 已激活：当时快照 / **如何触发**（由判据数据生成的人话版）/ 需要先点亮的前置 / 它代表什么 / 当时的数据
// 未激活：灰形状 + 标题 + **一句暗示**（≤22 字，来自 pattern.hint）
// 卡片可拖动（⠿ 手柄），位置持久化；双击手柄复位。
//
// 「如何触发」不去编故事：它由**模式自身的判据数据**（需要哪些节点类型、哪些关系、
// 是否有 where 谓词）+ 手写 hint 组合而成 —— 这样它永远与真正生效的判据一致。
import { renderBadge, TIERS, tierOf } from './achievementShapes.js';
import { readUserValue, writeUserValue, removeUserValue } from './userScope.js';

// ★ 详情卡位置属于**用户数据**：按账号分键（interweaver.u<id>.detailPos）——
//   用户要求"每个账号都是独立的"：换账号后卡片位置各是各的。
//   读写都走 userScope（还没归属的全局旧键仍会被本人读到，旧位置不丢）。
const POS_KEY = 'interweaver.detailPos';

const NODE_CN = {
  '*': '任意图形', point: '点', edgepoint: '线上点', segment: '线段', polygon: '多边形',
  circle: '圆', arc: '弧', arcfree: '自由弧段', freehand: '手绘曲线', sine: '正弦波',
  parabola: '抛物线', func: '函数曲线', sinepiece: '函数段', joint: '角', constraint: '约束',
  variable: '变量', probe: '观察器', tangent: '切线', secant: '割线', integral: '积分区域',
  derivcurve: '导函数曲线', curvepiece: '截取段',
};
const EDGE_CN = {
  coincident: '两端重合', onHost: '落在宿主曲线上', constraint: '几何约束', binding: '被别处驱动',
  sharedVar: '共享同一个变量', observe: '被观察器盯着',
};

export function triggerTextOf(p) {
  if (!p) return '';
  const parts = [];
  const nodes = (p.nodes || []).map((n) => NODE_CN[n.type] || n.type);
  if (nodes.length) parts.push(`场景里要有：${[...new Set(nodes)].join('、')}`);
  const edges = (p.edges || []).map((e) => EDGE_CN[e.kind] || e.kind);
  if (edges.length) parts.push(`它们之间要有：${[...new Set(edges)].join('、')}`);
  if (typeof p.where === 'function') parts.push('并且要满足该成就专属的数值条件（见「当时的数据」）');
  if (p.hint) parts.push(`提示：${p.hint}`);
  return parts.join('；');
}

function ensurePos(card) {
  let pos = null;
  try { pos = JSON.parse(readUserValue(POS_KEY) || 'null'); } catch { pos = null; }
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    card.style.left = pos.x + 'px';
    card.style.top = pos.y + 'px';
    card.style.right = 'auto';
  }
}

/**
 * 打开详情卡。
 * @param opts { id, patterns, tracker, net, achNode, onClose }
 */
export function openDetail(opts) {
  const { id, patterns, tracker, achNode } = opts;
  const p = patterns.find((x) => x.id === id);
  if (!p) return null;
  const granted = tracker.granted.get(id) || null;
  const lit = !!granted;
  const tier = tierOf(opts.layer || 2);
  const nodeId = achNode ? achNode[id] : null;

  const el = document.createElement('div');
  el.id = 'achDetail';
  el.className = lit ? 'lit' : 'locked';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `成就详情：${p.title}`);
  const shot = granted && typeof granted.shot === 'string' ? granted.shot : null;
  const reqs = (p.requires || []).map((rid) => {
    const rp = patterns.find((x) => x.id === rid);
    return { id: rid, title: rp?.title || rid, done: tracker.granted.has(rid) };
  });
  const ev = granted && granted.evidence && granted.evidence.text ? granted.evidence.text : null;

  el.innerHTML = `
    <div class="adHead" data-drag>
      <span class="adGrip" title="拖动卡片（双击复位）">⠿</span>
      <span class="adBadge">${renderBadge({ id, layer: opts.layer || 2, cls: p.cls, lit })}</span>
      <b class="adTitle">${lit ? p.title : '？？？'}</b>
      <span class="adTier">${p.cls === 'weave' ? '交织' : '独石'} · T${tier} ${TIERS[tier].name}</span>
      <button class="adClose" title="关闭（Esc）">✕</button>
    </div>
    ${lit ? `
      <div class="adShot">${shot
        ? `<img src="${shot}" alt="解锁时的画面" width="320" height="200">`
        : '<div class="adNoShot">当时没留下画面（可在设置里开启「记录成就解锁时的画面」）</div>'}</div>
      <div class="adSect"><span class="adK">如何触发</span><span>${triggerTextOf(p)}</span></div>
      ${reqs.length ? `<div class="adSect"><span class="adK">需要先点亮</span><span>${reqs
        .map((r) => `${r.done ? '✦' : '⏳'} ${r.title}`).join('　')}</span></div>` : ''}
      <div class="adSect"><span class="adK">它代表什么</span><span class="adFlavor">${p.flavor || ''}</span></div>
      ${ev ? `<div class="adSect"><span class="adK">当时的数据</span><span class="adEv">${ev}</span></div>` : ''}
      <div class="adFoot">${granted.at ? '达成于 ' + new Date(granted.at).toLocaleString('zh-CN', { hour12: false }) : ''}
        ${nodeId ? `　·　知识点 ${nodeId}` : ''}</div>
    ` : `
      <div class="adHint"><span class="adK">提示</span><span class="adHintText">${p.hint || '（这条还没有暗示）'}</span></div>
      ${reqs.length ? `<div class="adSect"><span class="adK">需要先点亮</span><span>${reqs
        .map((r) => `${r.done ? '✦' : '⏳'} ${r.title}`).join('　')}</span></div>` : ''}
      <div class="adFoot">尚未达成 —— 达成后会在这里显示当时的画面与数据</div>
    `}`;

  document.body.appendChild(el);
  ensurePos(el);

  // 拖动（⠿ 手柄或标题栏），位置持久化；双击复位
  const head = el.querySelector('[data-drag]');
  let drag = null;
  let moved = false;                 // 本次拖动是否真的移动过（"没动就不记位置"）
  const evtOrder = [];               // 事件顺序（供核验：dblclick 与 pointerup 谁先谁后）
  window.__IW = window.__IW || {};
  window.__IW.detailEvt = evtOrder;
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick']) {
    head.addEventListener(ev, () => evtOrder.push(ev), true);
  }
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.detail >= 2) return;      // 双击的第二下不再开始拖动，否则 dblclick 永远收不到
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    moved = false;
    el.style.right = 'auto';
    head.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(4, Math.min(e.clientX - drag.dx, innerWidth - el.offsetWidth - 4));
    const y = Math.max(4, Math.min(e.clientY - drag.dy, innerHeight - 40));
    if (Math.abs(x - el.offsetLeft) > 0.5 || Math.abs(y - el.offsetTop) > 0.5) moved = true;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
  const stop = () => {
    if (!drag) return;
    drag = null;
    // ★ 只有真的移动过才写位置：否则双击复位（清 key）会被随后的 pointerup 又写回去，
    // 表现为"双击无效"。这是行为上的正确规则，不是为了让测试通过。
    if (!moved) return;
    try { writeUserValue(POS_KEY, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch { /* 忽略 */ }
  };
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);
  head.addEventListener('dblclick', () => {
    try { removeUserValue(POS_KEY); } catch { /* 忽略 */ }
    el.style.left = ''; el.style.top = ''; el.style.right = '24px';
  });

  const close = () => { el.remove(); window.removeEventListener('keydown', onKey); opts.onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  el.querySelector('.adClose').addEventListener('click', close);
  return { el, close, triggerText: triggerTextOf(p) };
}
