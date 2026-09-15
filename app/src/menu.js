// 右键上下文菜单（DOM 模块）：条目随所选对象与选区变化
import * as S from './state.js';
import { availableKinds, KINDS } from './constraints.js';
import { REGISTRY } from './entities.js';

export function createMenu(st, hooks = {}) {
  const menu = document.getElementById('ctxMenu');
  let currentEnt = null;

  function build(ent) {
    const items = [];
    const selEnts = [...st.selection].map((id) => st.entities.get(id)).filter(Boolean);
    const selSegs = selEnts.filter((e) => e.type === 'segment');
    const host = ent.host ? st.entities.get(ent.host) : null;

    items.push({ act: 'link', label: '⛓ 关联…' });

    if (ent.type === 'polygon') {
      items.push({ act: 'explode', label: `✂ 解绑（拆成 ${ent.count} 条线段）` });
    }
    if (ent.type === 'segment' && selSegs.length >= 2) {
      items.push({ act: 'merge', label: `⧉ 绑定为一个整体（${selSegs.length} 条线段）` });
    }
    if (ent.type === 'arc' || ent.type === 'curvepiece') {
      items.push({ act: 'detach', label: '✂ 解绑（脱离宿主，可自由拖动）' });
    }
    if (ent.type === 'edgepoint' && host?.type === 'polygon') {
      items.push({ act: 'roam', label: `${ent.roam ? '✓' : '　'} 允许绕到其它边` });
    }
    // P9 约束：收进一个「约束 ▸ 」子菜单（悬停展开），不再平铺。
    // ★ 水平/垂直 合并成**一个入口**："相对于什么"改到属性页里详细配置（世界坐标系 / 另一个实体）。
    const constraintItems = [];
    if (selEnts.length >= 1) {
      const types = selEnts.map((e) => e.type);
      const ref = selEnts.find((e) => e.id !== ent.id);
      if (types.some((t) => t === 'segment')) {
        constraintItems.push({ act: 'constraintConfig', label: '⊥ 水平 / 垂直…（在属性页选参照）' });
      }
      for (const kind of availableKinds(types)) {
        if (kind === 'horizontal' || kind === 'vertical' || kind === 'parallel' || kind === 'perpendicular') continue;
        let label = KINDS[kind].label;
        constraintItems.push({ act: `constraint:${kind}`, label: `◆ ${label}` });
      }
      void ref;
    }
    for (const c of S.constraintsOf(st, ent.id)) {
      constraintItems.push({ act: `unconstrain:${c.id}`, label: `✕ 删除约束：${KINDS[c.kind].label}`, danger: true });
    }
    if (constraintItems.length) {
      items.push({ label: '◆ 约束…', sub: constraintItems });
    }

    // P10 微积分工具：依宿主/选点情况给出入口
    const hostEnt = ent.host ? st.entities.get(ent.host) : null;
    const isFnHost = (e) => e && (e.type === 'sine' || e.type === 'parabola' || e.type === 'func');
    const calcItems = [];
    if (ent.type === 'edgepoint' && isFnHost(hostEnt)) {
      const others = selEnts.filter((e) => e.type === 'edgepoint' && e.host === ent.host && e.id !== ent.id);
      calcItems.push({ act: 'mk:tangent', label: '⟋ 在这一点作切线' });
      if (others.length) calcItems.push({ act: 'mk:secant', label: '⟍ 与另一个点连成割线' });
    }
    if (isFnHost(ent)) {
      calcItems.push({ act: 'mk:derivcurve', label: 'ƒ′ 生成导函数曲线' });
      calcItems.push({ act: 'mk:integral', label: '∫ 添加积分区域（黎曼和）' });
    }
    if (calcItems.length) items.push({ label: '🧮 微积分…', sub: calcItems });

    // 观察器：收进一个「观察 ▸ 」子菜单（①③：不再每个派生量占一行）
    const probeItems = [];
    {
      const def = REGISTRY[ent.type];
      for (const d of (def?.derived || [])) {
        probeItems.push({ act: `probe:${ent.id}:${d.k}`, label: `👁 ${d.name}` });
      }
      const sub = st.entities.get(ent.host);
      if (sub) {
        for (const d of (REGISTRY[sub.type]?.derived || [])) {
          probeItems.push({ act: `probe:${sub.id}:${d.k}`, label: `👁 宿主 ${sub.label} 的 ${d.name}` });
        }
      }
    }
    if (probeItems.length) items.push({ label: '👁 观察…', sub: probeItems });

    items.push({ act: 'delete', label: '🗑 删除', danger: true });
    return items;
  }

  function open(x, y, ent) {
    currentEnt = ent;
    const items = build(ent);
    menu.innerHTML = items
      .map((it) => (it.sub
        ? `<div class="ctxGroup">
             <button class="ctxSubBtn">${it.label}<span class="ctxArrow">›</span></button>
             <div class="ctxSub">${it.sub.map((s) => `<button data-act="${s.act}" class="${s.danger ? 'danger' : ''}">${s.label}</button>`).join('')}</div>
           </div>`
        : `<button data-act="${it.act}" class="${it.danger ? 'danger' : ''}">${it.label}</button>`))
      .join('');
    menu.hidden = false;
    // 尺寸估算：子菜单都算一行
    const rows = items.reduce((n, it) => n + (it.sub ? 1 : 1), 0);
    const mw = 250, mh = rows * 32 + 12;
    menu.style.left = Math.min(x, innerWidth - mw - 10) + 'px';
    menu.style.top = Math.min(y, innerHeight - mh - 10) + 'px';
    // 悬停展开子菜单：靠右缘时向左展开
    menu.querySelectorAll('.ctxGroup').forEach((grp) => {
      const sub = grp.querySelector('.ctxSub');
      grp.addEventListener('pointerenter', () => {
        const r = grp.getBoundingClientRect();
        if (r.right + 210 > innerWidth) {
          sub.style.right = '100%';
          sub.style.left = 'auto';
        } else {
          sub.style.left = '100%';
          sub.style.right = 'auto';
        }
      });
    });

    const entId = ent.id;
    const onClick = (act) => {
      close();
      switch (act) {
        case 'link':
          hooks.openWizard?.(entId);
          break;
        case 'delete':
          S.removeEntities(st, [entId]);
          break;
        case 'explode': {
          const r = S.explodePolygon(st, entId);
          hooks.hint?.(r.error ? `⚠ ${r.error}` : `✦ 已解绑为 ${r.count} 条线段：可分别选取；选中多条后再右键「绑定为一个整体」`);
          break;
        }
        case 'merge': {
          const ids = [...st.selection].filter((id) => st.entities.get(id)?.type === 'segment');
          const r = S.mergeSegments(st, ids);
          hooks.hint?.(r.error ? `⚠ ${r.error}` : `✦ 已绑定为一个${r.name}（${r.sides} 条边）`);
          break;
        }
        case 'detach': {
          const r = S.detachPiece(st, entId);
          hooks.hint?.(r.error ? `⚠ ${r.error}` : '✦ 已解绑：这段图形现在是独立的，可以直接拖走');
          break;
        }
        case 'roam': {
          const e = st.entities.get(entId);
          const next = !e.roam;
          S.setEdgePointRoam(st, entId, next);
          hooks.hint?.(next
            ? '✦ 已允许绕行：这个点可以滑到多边形的其它边上'
            : '✦ 已锁回原边：这个点只能在自己的那条边上滑动');
          break;
        }
        default: {
          if (act.startsWith('constraint:')) {
            const kind = act.slice('constraint:'.length);
            const refs = [...st.selection];
            const r = S.addConstraint(st, kind, refs);
            if (r.error) hooks.hint?.(`⚠ ${r.error}`);
            else hooks.hint?.(r.solved && r.solved.maxResidual < 1e-7
              ? `✦ 已添加约束「${KINDS[kind].label}」并满足（拖动任一方都会自动维持）`
              : `✦ 已添加约束「${KINDS[kind].label}」，但当前只能近似满足（残差 ${r.solved?.maxResidual?.toExponential(1) ?? '?'}）`);
          } else if (act === 'constraintConfig') {
            hooks.openConstraint?.(entId);
          } else if (act.startsWith('unconstrain:')) {
            S.removeConstraint(st, act.slice('unconstrain:'.length));
            hooks.hint?.('✦ 已删除该约束（图形不再被强制维持关系）');
          } else if (act.startsWith('mk:')) {
            hooks.make?.(act.slice(3), entId);
          } else if (act.startsWith('probe:')) {
            const [, id, key] = act.split(':');
            const r = S.addProbe(st, id, key);
            hooks.hint?.(r.error ? `⚠ ${r.error}` : `✦ 已在变量面板添加观测器「${r.name}」——它也能写进表达式`);
          }
          break;
        }
      }
    };
    menu.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => onClick(b.dataset.act));
    });
  }

  function close() { menu.hidden = true; currentEnt = null; }

  window.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) close();
  });
  window.addEventListener('blur', close);

  return { open, close, isOpen: () => !menu.hidden };
}
