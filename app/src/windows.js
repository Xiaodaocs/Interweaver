// ⑧ 工具卡片窗口化：标题条可拖动、最小化吸附到最近边缘。
// ⑥ 按钮统一：关闭在最右，最小化在其左侧且更小。
// 左侧工具栏与提示气泡不参与（它们不是卡片）。
// 位置只活在本次会话里（持久化属 P11）。
export function makeWindow(el, opts = {}) {
  if (!el || el.dataset.winReady) return;
  // 标题条：优先用显式标记的；否则复用卡片自己的第一个子元素（ƒx 面板、预设抽屉都有自己的头部）
  let bar = el.querySelector('[data-winbar]');
  if (!bar) {
    const first = el.firstElementChild;
    if (first) {
      bar = first;
      first.setAttribute('data-winbar', '');
      first.classList.add('winBar');
    }
  }
  // 内容还没渲染出来（例如空的预设抽屉）→ 先不动，等它有了头部再调一次
  if (!bar) return;
  el.dataset.winReady = '1';

  // ---- ⑥ 最小化按钮：插在"关闭"按钮左侧（没有按钮盒就建一个）----
  let box = bar.querySelector('.winBtns');
  if (!box) {
    box = document.createElement('span');
    box.className = 'winBtns';
    // 把已有的按钮（例如 ×）挪进盒子，保持它们在右端
    const closeBtn = bar.querySelector('button');
    if (closeBtn) { bar.appendChild(box); box.appendChild(closeBtn); }
    else bar.appendChild(box);
  }
  if (!el.querySelector('[data-winmin]')) {
    const minBtn = document.createElement('button');
    minBtn.setAttribute('data-winmin', '');
    minBtn.title = '最小化（再点展开）';
    minBtn.textContent = '—';
    const closeBtn = box.querySelector('button:not([data-winmin])');
    if (closeBtn) box.insertBefore(minBtn, closeBtn);   // ← 最小化在关闭左边
    else box.appendChild(minBtn);
  }

  // ---- ⑥ 最小化 = 吸附到最近的边缘（小胶囊），再点还原 ----
  const minBtn = el.querySelector('[data-winmin]');
  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const min = el.classList.toggle('winMin');
    if (min) {
      const r = el.getBoundingClientRect();
      el._restoreRect = { left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, w: r.width, h: r.height, useRight: el.style.right !== '', useBottom: el.style.bottom !== '' };
      // 先收起内容，量出胶囊尺寸，再吸到最近的边缘
      requestAnimationFrame(() => {
        const pr = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dist = { left: cx, right: innerWidth - cx, top: cy, bottom: innerHeight - cy };
        const nearest = Object.keys(dist).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
        el.style.left = 'auto'; el.style.right = 'auto'; el.style.top = 'auto'; el.style.bottom = 'auto';
        el.style.transform = 'none';
        const M = 10;
        if (nearest === 'left') { el.style.left = M + 'px'; el.style.top = Math.min(Math.max(cy - pr.height / 2, M), innerHeight - pr.height - M) + 'px'; }
        else if (nearest === 'right') { el.style.right = M + 'px'; el.style.top = Math.min(Math.max(cy - pr.height / 2, M), innerHeight - pr.height - M) + 'px'; }
        else if (nearest === 'top') { el.style.top = M + 'px'; el.style.left = Math.min(Math.max(cx - pr.width / 2, M), innerWidth - pr.width - M) + 'px'; }
        else { el.style.bottom = M + 'px'; el.style.left = Math.min(Math.max(cx - pr.width / 2, M), innerWidth - pr.width - M) + 'px'; }
        el.dataset.snapEdge = nearest;
      });
    } else {
      const s = el._restoreRect;
      if (s) {
        el.style.left = 'auto'; el.style.right = 'auto'; el.style.top = 'auto'; el.style.bottom = 'auto';
        if (s.useRight) el.style.right = s.right + 'px'; else el.style.left = s.left + 'px';
        if (s.useBottom) el.style.bottom = s.bottom + 'px'; else el.style.top = s.top + 'px';
      }
    }
  });

  // ---- 拖动：按住标题条移动整个卡片 ----
  if (opts.drag !== false) {
    bar.style.cursor = 'grab';
    let dragging = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;    // 别把按钮点击当拖动
      const r = el.getBoundingClientRect();
      dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.style.transition = 'none';
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      bar.setPointerCapture?.(e.pointerId);
      bar.style.cursor = 'grabbing';
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = e.clientX - dragging.dx, y = e.clientY - dragging.dy;
      x = Math.max(4, Math.min(x, innerWidth - w - 4));
      y = Math.max(4, Math.min(y, innerHeight - Math.max(28, h * 0.3)));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = null;
      bar.style.cursor = 'grab';
      try { bar.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    };
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  }
}

// 把场景里这些卡片都窗口化
export function makeWindows(list) {
  for (const el of list) if (el) makeWindow(el);
}
