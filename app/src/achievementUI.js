// S5 · 成就反馈：双类徽章 + 成就卡 + 气泡队列
//
// 两类徽章必须在**形状与配色**上一眼可分（用户明确要求"视觉上可以被感受到"）：
//   A 类独石：**单环**徽章（暖金）
//   B 类交织：**双环交织结形**（暖金 + 暖黄，更大、外发光更强），并在卡上多一行
//            「由这些成就织成」+ 依赖成就的小徽章缩略 + 一张小星图缩略（两节点之间亮起一条边）
//
// 队列规则（对齐 docs/03 §4）：同一时刻只展示一张卡；探索高峰期（连发）时，
// 第 2 条起降级为右下角小气泡，**不打断操作、不遮挡画布中心**。
const CARD_MS = 3400;

function badgeSVG(cls) {
  if (cls === 'weave') {
    // 双环交织：两个圆互相咬合，双色
    return `<svg viewBox="0 0 40 40" class="achBadge weave" aria-hidden="true">
      <circle cx="15" cy="20" r="10.5" fill="none" stroke="#C9A227" stroke-width="2.4"/>
      <circle cx="25" cy="20" r="10.5" fill="none" stroke="#E3D68C" stroke-width="2.4"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 40 40" class="achBadge solo" aria-hidden="true">
    <circle cx="20" cy="20" r="11" fill="none" stroke="#C9A227" stroke-width="2.4"/>
    <circle cx="20" cy="20" r="3.4" fill="#C9A227"/>
  </svg>`;
}

function miniMapSVG(requiresTitles) {
  // 小星图缩略：左点（前置成就）——亮起的边——右点（本条交织成就）
  const n = Math.max(1, Math.min(3, requiresTitles.length));
  const W = 22 + n * 22 + 22;
  let s = `<svg viewBox="0 0 ${W} 34" class="achMini" aria-hidden="true">`;
  for (let i = 0; i < n; i++) {
    const x = 14 + i * 22, y = 17;
    s += `<line x1="${x}" y1="${y}" x2="${20 + n * 22}" y2="17" stroke="#C9A227" stroke-width="1.6" opacity=".85"/>`;
    s += `<circle cx="${x}" cy="${y}" r="4.6" fill="#FBF3D6" stroke="#C9A227" stroke-width="1.4"/>`;
  }
  s += `<circle cx="${20 + n * 22}" cy="17" r="6" fill="#C9A227"/>`;
  s += '</svg>';
  return s;
}

export function createAchievementUI(host) {
  const layer = document.createElement('div');
  layer.id = 'achLayer';
  host.appendChild(layer);
  const bubbleLayer = document.createElement('div');     // 气泡独立一层：右下角、不接收点击
  bubbleLayer.id = 'achBubbles';
  host.appendChild(bubbleLayer);

  let showing = false;
  let currentCard = null;      // 当前展示的卡；若它被外部移除，showing 必须跟着复位（否则队列会永久卡住）
  const queue = [];      // 连发时降级为气泡
  const bubbles = [];

  function renderCard(a) {
    showing = true;
    currentCard = null;
    const card = document.createElement('div');
    card.className = `achCard ${a.cls === 'weave' ? 'weave' : 'solo'}`;
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const weavePart = a.cls === 'weave'
      ? `<div class="achWeaveRow">
           ${miniMapSVG(a.requiresTitles || [])}
           <span>由这些成就织成：</span>
           <span class="achChips">${(a.requiresTitles || []).map((t) => `<i>${t}</i>`).join('')}</span>
         </div>`
      : '';
    card.innerHTML = `
      <div class="achRow">
        ${badgeSVG(a.cls)}
        <div class="achText">
          <b>${a.title}</b>
          <span class="achFlavor">${a.flavor || ''}</span>
          ${a.evidence ? `<span class="achEv">证据：${a.evidence.text}</span>` : ''}
        </div>
        <button class="achOk" title="知道了">知道了</button>
      </div>
      ${weavePart}
      <div class="achFoot">✦ 已织入知识网 · 第 ${a.starIndex || 1} 颗星</div>`;
    layer.appendChild(card);
    currentCard = card;
    let timer = setTimeout(done, CARD_MS);
    card.querySelector('.achOk').addEventListener('click', () => { clearTimeout(timer); done(); });
    function done() {
      clearTimeout(timer);
      card.classList.add('out');
      setTimeout(() => {
        card.remove();
        showing = false;
        if (queue.length) renderCard(queue.shift());
        else renderBubbles();
      }, 220);
    }
  }

  function renderBubbles() {
    for (const b of bubbles.splice(0)) b.remove();
    for (const a of queue) {
      const el = document.createElement('div');
      el.className = `achBubble ${a.cls === 'weave' ? 'weave' : ''}`;
      el.innerHTML = `${badgeSVG(a.cls)}<span>${a.title}</span>`;
      el.title = a.flavor || a.title;
      bubbleLayer.appendChild(el);
      bubbles.push(el);
    }
  }

  function push(a) {
    if (!a || !a.id) return;
    // 展示状态以"当前卡是否仍在文档里"为准：外部把卡移除时不会卡住队列
    if (showing && (!currentCard || !currentCard.isConnected)) { showing = false; currentCard = null; }
    if (showing) { queue.push(a); renderBubbles(); }
    else renderCard(a);
  }

  return { push, get queueLength() { return queue.length; }, isShowing: () => showing };
}
