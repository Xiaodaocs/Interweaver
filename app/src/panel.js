import { showCard, hideCard } from './windows.js';
// 右侧面板：变量 / 属性 两页签 + 两步关联向导（DOM 模块）
// 函数创作器已移到左下角独立面板（见 fx.js）
import { REGISTRY, paramsOf, bindableParamsOf, polygonName } from './entities.js';
import * as S from './state.js';
import { fmt } from './util.js';
import { KINDS } from './constraints.js';

export function createPanel(st, hooks = {}) {
  const body = document.getElementById('panelBody');
  // ⑥ 单卡片操作（关联/约束等）改到左上角弹窗里进行；属性仍留在右侧面板
  const opPop = document.getElementById('opPop');
  const opBody = document.getElementById('opPopBody');
  let tab = 'vars';
  let wizard = null; // { entId, param, sourceTab }

  document.querySelectorAll('#panelTabs button').forEach((b) => {
    b.addEventListener('click', () => { wizard = null; setTab(b.dataset.tab); });
  });

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#panelTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
  }

  function render() {
    // ⑥ 有操作在进行 → 左上弹窗滑入；操作结束/取消 → 自动收回
    if (wizard) showCard(opPop, 'tl'); else hideCard(opPop);
    if (wizard?.mode === 'constraint') return renderConstraintConfig();
    if (wizard) return renderWizard();
    // 右侧面板只剩属性；变量搬到右下角独立窗口（④）
    renderProps();
  }

  // ---------- 变量页 ----------
  // 变量与观察器现在住在右下角的独立窗口里（④），所以这里拆成"生成 HTML" + "绑事件"两半，
  // 由 main.js 渲染到 #varWinBody；右侧面板只剩属性。
  function varsHTML() {
    const vars = [...st.variables.values()];
    const probes = [...st.probes.values()];
    return `
      ${probes.map((p) => {
        const ent = st.entities.get(p.entId);
        const from = p.kind === 'expr' ? `＝ ${p.src}` : `👁 ${ent ? ent.label : '?'}${ent ? '.' + p.key : ''}`;
        return `<div class="varCard probeCard" data-probe="${p.name}">
          <div class="row1">
            <input class="vname" value="${p.name}" data-proname="${p.name}" spellcheck="false" style="font-family:var(--font-num);font-size:13px">
            <span class="vbinds" title="观察器">${from}</span>
            <span class="vval" data-probeval="${p.name}">—</span>
            <button class="vdel" data-probedel="${p.name}" title="移除观测器">×</button>
          </div>
        </div>`;
      }).join('')}
      ${vars.map((v) => `
        <div class="varCard" data-varcard="${v.name}">
          <div class="row1">
            <input class="vname" value="${v.name}" data-vname="${v.name}" spellcheck="false">
            <span class="vbinds" data-vbinds="${v.name}">⛓${S.boundByCount(st, v.name) || ''}</span>
            <input class="vval" value="${fmt(v.value)}" data-vval="${v.name}" spellcheck="false">
            <button class="vanim${v.anim ? ' on' : ''}" data-vanim="${v.name}" title="自动往返动画">▶</button>
            <button class="vdel" data-vdel="${v.name}" title="删除变量">×</button>
          </div>
          <input type="range" min="${v.min}" max="${v.max}" step="${v.step > 0 ? v.step : (v.max - v.min) / 200}"
                 value="${v.value}" data-vslider="${v.name}">
          <div class="row3">
            <label>min</label><input value="${v.min}" data-vmin="${v.name}">
            <label>max</label><input value="${v.max}" data-vmax="${v.name}">
            ${v.anim ? `<label>周期s</label><input value="${(v.period || 4000) / 1000}" data-vperiod="${v.name}" style="width:44px">` : ''}
          </div>
        </div>`).join('')}
      <div class="addRow">
        <button class="addBtn" id="addVar">＋ 新建变量</button>
        <button class="addBtn" id="addProbe" title="算一个量，如 m割 − m切">＋ 观察器</button>
      </div>
      <div id="probeInput" hidden style="margin-top:6px">
        <input class="fxInput" id="probeExpr" placeholder="表达式，可引用变量与已有观察器" spellcheck="false">
        <div class="fxErr" id="probeErr"></div>
      </div>
      ${vars.length === 0 && probes.length === 0 ? '<div class="paneHint">连一根线，从这里开始。<br>新建变量后，右键画布上的图形 →「关联…」</div>' : ''}
    `;
  }

  function renderVars() {
    body.innerHTML = varsHTML();
    bindVars(body);
  }

  // 把事件绑到任意容器（变量窗口 / 面板 body 都能用）
  function bindVars(root) {
    const vars = [...st.variables.values()];
    root.querySelectorAll('[data-probedel]').forEach((b) => {
      b.addEventListener('click', () => S.removeProbe(st, b.dataset.probedel));
    });
    root.querySelectorAll('[data-proname]').forEach((inp) => {
      const commit = () => {
        const r = S.renameProbe(st, inp.dataset.proname, inp.value);
        if (r.error) { hooks.hint?.(`⚠ ${r.error}`); inp.value = inp.dataset.proname; }
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('blur', commit);
    });
    root.querySelector('#addVar').addEventListener('click', () => {
      const candidates = ['a', 'b', 'c', 'k', 'm', 'n', 'h', 'θ'];
      const name = candidates.find((c) => !st.variables.has(c)) || 'v' + st.variables.size;
      S.addVariable(st, name, { value: 1, min: 0, max: 10 });
    });
    // 表达式观察器：内联输入，回车即建（剧本三的「差 = m割 − m切」）
    {
      const btn = root.querySelector('#addProbe');
      const box = root.querySelector('#probeInput');
      const inp = root.querySelector('#probeExpr');
      const err = root.querySelector('#probeErr');
      btn.addEventListener('click', () => {
        box.hidden = !box.hidden;
        if (!box.hidden) inp.focus();
      });
      const commitProbe = () => {
        const r = S.addExprProbe(st, inp.value);
        if (r.error) { err.textContent = r.error; return; }
        hooks.hint?.(`✦ 已添加观察器「${r.name}」——它也能写进表达式`);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitProbe(); });
    }

    for (const v of vars) {
      const slider = root.querySelector(`[data-vslider="${v.name}"]`);
      const valInput = root.querySelector(`[data-vval="${v.name}"]`);
      slider.addEventListener('pointerdown', () => S.beginGesture(st));
      slider.addEventListener('input', () => {
        S.setVariable(st, v.name, { value: parseFloat(slider.value) }, { gesture: true });
        valInput.value = fmt(st.variables.get(v.name).value);
      });
      slider.addEventListener('pointerup', () => S.endGesture(st, true));
      valInput.addEventListener('change', () => {
        const num = parseFloat(valInput.value);
        if (Number.isFinite(num)) S.setVariable(st, v.name, { value: num });
        else valInput.value = fmt(v.value);
      });
      // 改上下限要**立即生效**：以前只调 setVariable，滑杆的 min/max 属性要等面板重建
      // （只有 structure 事件才重建，例如新建变量）才更新 → 看起来"得刷新一下"。
      // 这里就地更新滑杆与数值框，不整块重建，避免抢输入焦点。
      const syncRange = (name) => {
        const vv = st.variables.get(name);
        if (!vv) return;
        const sl = root.querySelector(`[data-vslider="${name}"]`);
        if (sl) {
          sl.min = String(vv.min);
          sl.max = String(vv.max);
          const clamped = Math.min(vv.max, Math.max(vv.min, Number(sl.value)));
          sl.value = String(clamped);
          if (clamped !== vv.value) S.setVariable(st, name, { value: clamped });
        }
        const vi = root.querySelector(`[data-vval="${name}"]`);
        if (vi && document.activeElement !== vi) vi.value = fmt(vv.value);
        S.ensureEvaluated(st);
      };
      root.querySelector(`[data-vmin="${v.name}"]`).addEventListener('change', (e) => {
        const num = parseFloat(e.target.value);
        if (Number.isFinite(num)) S.setVariable(st, v.name, { min: num });
        syncRange(v.name);
      });
      root.querySelector(`[data-vmax="${v.name}"]`).addEventListener('change', (e) => {
        const num = parseFloat(e.target.value);
        if (Number.isFinite(num)) S.setVariable(st, v.name, { max: num });
        syncRange(v.name);
      });
      // ▶ 自动动画：在 min↔max 间往返（周期可调）
      root.querySelector(`[data-vanim="${v.name}"]`).addEventListener('click', (e) => {
        e.stopPropagation();
        S.setVariable(st, v.name, { anim: !st.variables.get(v.name).anim });
        const on = st.variables.get(v.name).anim;
        if (on) hooks.hint?.(`✦ ${v.name} 开始自动往返（在 min↔max 之间）——再点 ▶ 停下`);
        render();
      });
      const per = root.querySelector(`[data-vperiod="${v.name}"]`);
      if (per) {
        per.addEventListener('change', (e) => {
          const sec = parseFloat(e.target.value);
          if (Number.isFinite(sec) && sec > 0.2) S.setVariable(st, v.name, { period: Math.round(sec * 1000) });
        });
      }
      root.querySelector(`[data-vdel="${v.name}"]`).addEventListener('click', () => S.removeVariable(st, v.name));
      root.querySelector(`[data-vname="${v.name}"]`).addEventListener('change', (e) => {
        const nn = e.target.value.trim();
        if (nn !== v.name) {
          // 重命名 = 删旧建新（绑定源同步改）
          const old = st.variables.get(v.name);
          const r = S.addVariable(st, nn, old);
          if (r.error) { e.target.value = v.name; return; }
          for (const b of st.bindings.values()) {
            b.sources = b.sources.map((s) => (s.kind === 'var' && s.name === v.name ? { ...s, name: nn } : s));
          }
          S.removeVariable(st, v.name);
        }
      });
    }
  }

  // 水平/垂直 的参照配置（约束合成一个入口，参照与模式在这里选）
  function openConstraintConfig(entId) {
    wizard = { mode: 'constraint', entId };
    render();
  }

  function renderConstraintConfig() {
    const body = opBody;   // ⑥ 局部遮蔽：该操作的 UI 渲染到左上角弹窗
    const ent = st.entities.get(wizard.entId);
    if (!ent) { wizard = null; render(); return; }
    const others = [...st.entities.values()].filter((e) => e.id !== ent.id && e.type === 'segment');
    // 用户要求：参照**不用下拉简易列表**，改成与「关联」操作面板一致的按钮列表（wizVarBtn）；
    // 类型标签随参照动态变化 —— 参照是另一条线时，语义就是「平行 / 垂直」。
    let refId = '';
    let mode = 'h';
    const renderBody = () => {
      const withRef = !!refId;
      body.innerHTML = `
        <div class="wizTitle">给「${ent.label}」加约束</div>
        <div class="wizSub">先选参照，再选约束类型</div>
        <div class="wizSub" style="padding-top:4px">参照</div>
        <div class="wizList">
          <button class="wizVarBtn${refId === '' ? ' on' : ''}" data-ref="">世界坐标系 <span style="color:var(--ink-2)">画布主网格</span></button>
          ${others.map((o) => `<button class="wizVarBtn${refId === o.id ? ' on' : ''}" data-ref="${o.id}">${o.label} <span style="color:var(--ink-2)">${REGISTRY[o.type].label}</span></button>`).join('')}
        </div>
        <div class="wizSub" style="padding-top:8px">类型</div>
        <div class="wizTabs">
          <button data-cc="h" class="${mode === 'h' ? 'on' : ''}">${withRef ? '平行' : '水平'}</button>
          <button data-cc="v" class="${mode === 'v' ? 'on' : ''}">${withRef ? '垂直' : '竖直'}</button>
        </div>
        <div class="paneHint" style="text-align:left;padding:4px 2px">
          ${withRef
            ? '把这条线转成与参照线平行 / 垂直；拖动时会先整体平移、必要时连带联动对方，约束始终保持。'
            : '把这条线调成水平 / 竖直（参照是世界坐标系）。'}</div>
        <button class="addBtn fxGo" id="ccGo">添加约束</button>
        <button class="wizCancel" id="wizCancel">取消</button>
      `;
      body.querySelectorAll('[data-ref]').forEach((btn) => {
        btn.addEventListener('click', () => { refId = btn.dataset.ref; renderBody(); });
      });
      body.querySelectorAll('[data-cc]').forEach((btn) => {
        btn.addEventListener('click', () => { mode = btn.dataset.cc; renderBody(); });
      });
      body.querySelector('#wizCancel').addEventListener('click', () => { wizard = null; render(); });
      body.querySelector('#ccGo').addEventListener('click', () => {
        const kind = refId ? (mode === 'h' ? 'parallel' : 'perpendicular') : (mode === 'h' ? 'horizontal' : 'vertical');
        const refs = refId ? [ent.id, refId] : [ent.id];
        const r = S.addConstraint(st, kind, refs);
        if (r.error) { hooks.hint?.(`⚠ ${r.error}`); return; }
        const refLabel = refId ? (st.entities.get(refId) || {}).label : null;
        hooks.hint?.(refLabel
          ? `✦ 已添加「${KINDS[kind].label}」：${ent.label} 与 ${refLabel}（拖动时会严格保持）`
          : `✦ 已添加「${KINDS[kind].label}」：${ent.label}（拖动时会严格保持）`);
        wizard = null;
        render();
      });
    };
    renderBody();
  }

  // ---------- 属性页 ----------
  function renderProps() {
    const sel = [...st.selection].map((id) => st.entities.get(id)).filter(Boolean);
    if (sel.length === 0) {
      // ④ 没有选中实体时整块缩回（不再占地方、也不再显示提示）
      const p = document.getElementById('panel');
      if (p) p.hidden = true;
      body.innerHTML = '';
      return;
    }
    const p = document.getElementById('panel');
    if (p) p.hidden = false;
    const ent = sel[sel.length - 1];
    const def = REGISTRY[ent.type];
    const boundList = S.bindingsOf(st, ent.id);
    const params = bindableParamsOf(ent, st);   // 基础参数 + 可写别名（②a：别名绑定也要能看见、能解绑）
    const typeLabel = ent.piece ? S.pieceNameOf(ent) : (ent.type === 'polygon' ? polygonName(ent.count) : def.label);
    const relation = [];
    if (ent.piece && ent.fromLabel) relation.push(`由 ${ent.fromLabel} 上截出（独立图形，可直接拖走）`);
    if (ent.host) {
      const h = st.entities.get(ent.host);
      if (h) relation.push(`宿主 ${h.label}`);
    }
    if (ent.p1 && ent.p2) {
      const a = st.entities.get(ent.p1), b = st.entities.get(ent.p2);
      if (a && b) relation.push(`由 ${a.label} 与 ${b.label} 截出`);
    }
    body.innerHTML = `
      <div class="propHead"><b>${typeLabel}</b>
        <input class="nameInput" id="nameInput" value="${escapeAttr(ent.label)}" spellcheck="false" title="改名（表达式里用它来引用这个图形）">
        ${ent.exprSrc ? `<span style="margin-left:auto">${ent.exprSrc}</span>` : ''}</div>
      ${relation.length ? `<div class="propRel">${relation.join(' · ')}</div>` : ''}
      ${params.map((p) => {
        const bound = ent.bound[p.k] ? st.bindings.get(ent.bound[p.k]) : null;
        const val = S.getVal(st, ent, p.k);
        const isAngle = ent.type === 'edgepoint' && st.entities.get(ent.host)?.type === 'circle';
        const shown = isAngle && p.k === 't' ? `${fmt(val / Math.PI * 180, 1)}°` : fmt(val);
        if (bound) {
          // 已关联（含别名）：显示来源 + 实时值 + 解除按钮
          return `<div class="propRow" data-param="${p.k}">
            <span class="pname">${p.name}${p.alias ? '<span class="aliasTag">可写</span>' : ''}</span>
            <span class="pbound" title="绑定表达式">← ${bound.src}</span>
            <span style="font-family:var(--font-num);font-size:12px" data-liveval="${ent.id}:${p.k}">${shown}</span>
            <button class="punbind" data-unbind="${bound.id}" title="解除关联">✕</button>
          </div>`;
        }
        if (p.alias) {
          // 别名未关联：不可直接编辑（它是派生的），提示可以关联
          return `<div class="propRow" data-param="${p.k}">
            <span class="pname">${p.name}<span class="aliasTag">可写</span></span>
            <span class="pbound" style="opacity:.55">未关联 · 右键可关联</span>
            <span style="font-family:var(--font-num);font-size:12px" data-livederived="${ent.id}:${p.k}">${shown}</span>
          </div>`;
        }
        return `<div class="propRow" data-param="${p.k}">
          <span class="pname">${p.name}</span>
          <input class="pval" value="${fmt(val)}" data-pedit="${p.k}">
        </div>`;
      }).join('')}
      ${(def.derived || []).filter((d) => !params.some((p) => p.k === d.k)).map((d) => `
        <div class="propRow derived">
          <span class="pname">${d.name}</span>
          <span class="pval" data-livederived="${ent.id}:${d.k}">${fmt(S.getDerived(st, ent, d.k))}</span>
        </div>`).join('')}
      ${ent.pts ? `<div class="propRow derived"><span class="pname">采样点</span><span class="pval">${ent.pts.length}</span></div>` : ''}
      ${roamRow(ent)}
      ${constraintRows(st, ent)}
      ${actionRows(ent)}
      ${boundList.length ? '' : `<div class="paneHint">${quickHint(ent)}</div>`}
    `;

    const nameBox = body.querySelector('#nameInput');
    if (nameBox) {
      const commitName = () => {
        const want = nameBox.value.trim();
        if (want === ent.label) return;
        const r = S.renameEntity(st, ent.id, want);
        if (r.error) {
          hooks.hint?.(`⚠ ${r.error}`);
          nameBox.value = ent.label;
        } else {
          hooks.hint?.(`✦ 已改名为 ${r.label}${r.from ? `（原 ${r.from}）` : ''}：表达式里的引用已同步更新`);
        }
      };
      nameBox.addEventListener('change', commitName);
      nameBox.addEventListener('blur', commitName);
      nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { nameBox.blur(); e.stopPropagation(); }
        if (e.key === 'Escape') { nameBox.value = ent.label; nameBox.blur(); }
      });
    }
    const roamBox = body.querySelector('#roamToggle');
    if (roamBox) {
      roamBox.addEventListener('change', () => S.setEdgePointRoam(st, ent.id, roamBox.checked));
    }
    const exBtn = body.querySelector('#actExplode');
    if (exBtn) {
      exBtn.addEventListener('click', () => {
        const r = S.explodePolygon(st, ent.id);
        hooks.hint?.(r.error ? `⚠ ${r.error}` : `✦ 已解绑为 ${r.count} 条线段：选中多条后再右键「绑定为一个整体」`);
      });
    }
    const mergeBtn = body.querySelector('#actMerge');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        const ids = [...st.selection].filter((id) => st.entities.get(id)?.type === 'segment');
        const r = S.mergeSegments(st, ids);
        hooks.hint?.(r.error ? `⚠ ${r.error}` : `✦ 已绑定为一个${r.name}（${r.sides} 条边）`);
      });
    }
    body.querySelectorAll('[data-unconstrain]').forEach((b) => {
      b.addEventListener('click', () => S.removeConstraint(st, b.dataset.unconstrain));
    });
    const dBtn = body.querySelector('#actDetach');
    if (dBtn) {
      dBtn.addEventListener('click', () => {
        const r = S.detachPiece(st, ent.id);
        hooks.hint?.(r.error ? `⚠ ${r.error}` : '✦ 已解绑：这段图形现在是独立的，可以直接拖走');
      });
    }

    body.querySelectorAll('[data-pedit]').forEach((input) => {
      input.addEventListener('change', () => {
        const num = parseFloat(input.value);
        if (Number.isFinite(num)) S.setParams(st, ent, { [input.dataset.pedit]: num });
        else input.value = fmt(S.getVal(st, ent, input.dataset.pedit));
      });
    });
    body.querySelectorAll('[data-unbind]').forEach((btn) => {
      btn.addEventListener('click', () => S.removeBinding(st, btn.dataset.unbind));
    });
  }

  // ---------- 关联向导 ----------
  function openWizard(entId) {
    wizard = { entId, param: null, sourceTab: 'var' };
    setTabKeep('props');
    render();
  }
  function setTabKeep(t) {
    tab = t;
    document.querySelectorAll('#panelTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  }

  function renderWizard() {
    const body = opBody;   // ⑥ 局部遮蔽：该操作的 UI 渲染到左上角弹窗
    const ent = st.entities.get(wizard.entId);
    if (!ent) { wizard = null; render(); return; }
    const def = REGISTRY[ent.type];
    const params = bindableParamsOf(ent, st);   // 基础参数 + 可写别名（角度/长度/直径…）
    const typeLabel = ent.type === 'polygon' ? polygonName(ent.count) : def.label;

    if (!wizard.param) {
      body.innerHTML = `
        <div class="wizTitle">把「${typeLabel} ${ent.label}」的什么连出去？</div>
        <div class="wizSub">第一步：选择一个参数</div>
        ${params.map((p) => {
          const bound = ent.bound[p.k];
          // 别名（角度/长度/面积/直径…）都与同名派生量共存，直接取值即可
          const shown = fmt(S.getVal(st, ent, p.k));
          return `<button class="wizParam${p.alias ? ' alias' : ''}" data-wp="${p.k}">
            ${p.name}${p.alias ? '<span class="aliasTag">可写</span>' : ''}<span class="pv">${bound ? '← ' + st.bindings.get(bound).src : shown}</span>
          </button>`;
        }).join('')}
        <div class="paneHint" style="text-align:left;padding:6px 2px">标「可写」的是派生量（如线段角度、圆直径）——关联后由表达式驱动它。</div>
        <button class="wizCancel" id="wizCancel">取消</button>
      `;
      body.querySelectorAll('[data-wp]').forEach((b) => {
        b.addEventListener('click', () => { wizard.param = b.dataset.wp; wizard.srcEnt = null; render(); });
      });
    } else {
      const p = params.find((pp) => pp.k === wizard.param) || { k: wizard.param, name: wizard.param };
      const vars = [...st.variables.values()];
      const probes = [...st.probes.values()];
      body.innerHTML = `
        <div class="wizTitle">${typeLabel} ${ent.label} · ${p.name}</div>
        <div class="wizSub">第二步：选择驱动它的来源</div>
        <div class="wizTabs">
          <button data-wt="var" class="${wizard.sourceTab === 'var' ? 'on' : ''}">变量</button>
          <button data-wt="ent" class="${wizard.sourceTab === 'ent' ? 'on' : ''}">实体参数</button>
          <button data-wt="expr" class="${wizard.sourceTab === 'expr' ? 'on' : ''}">表达式</button>
        </div>
        <div id="wizSrc"></div>
        <div class="fxErr" id="wizErr"></div>
        <button class="wizCancel" id="wizBack">← 返回</button>
        <button class="wizCancel" id="wizCancel">取消</button>
      `;
      const srcBox = body.querySelector('#wizSrc');
      const errBox = body.querySelector('#wizErr');
      body.querySelectorAll('[data-wt]').forEach((b) => {
        b.addEventListener('click', () => { wizard.sourceTab = b.dataset.wt; render(); });
      });
      body.querySelector('#wizBack').addEventListener('click', () => { wizard.param = null; render(); });

      if (wizard.sourceTab === 'var') {
        const cards = [
          ...vars.map((v) => `<button class="wizVarBtn" data-wv="${v.name}">${v.name} <span style="color:var(--ink-2)">= ${fmt(v.value)}</span></button>`),
          ...probes.map((pr) => `<button class="wizVarBtn" data-wv="${pr.name}">👁 ${pr.name} <span style="color:var(--ink-2)">= ${fmt(S.probeValue(st, pr))}</span></button>`),
        ];
        srcBox.innerHTML = cards.length ? cards.join('') : '<div class="paneHint">还没有变量。取消后去变量页 ＋ 新建一个。</div>';
        srcBox.querySelectorAll('[data-wv]').forEach((b) => b.addEventListener('click', () => commit(b.dataset.wv)));
      } else if (wizard.sourceTab === 'ent') {
        // 选画布上另一个实体 → 再选它的参数（含派生量与可写别名）→ 自动拼成 label.param
        if (!wizard.srcEnt) {
          const others = [...st.entities.values()].filter((e) => e.id !== ent.id);
          srcBox.innerHTML = others.length
            ? others.map((e) => `<button class="wizVarBtn" data-we="${e.id}">${e.label} <span style="color:var(--ink-2)">${REGISTRY[e.type].label}</span></button>`).join('')
            : '<div class="paneHint">画布上还没有别的图形。</div>';
          srcBox.querySelectorAll('[data-we]').forEach((b) => {
            b.addEventListener('click', () => { wizard.srcEnt = b.dataset.we; render(); });
          });
        } else {
          const src = st.entities.get(wizard.srcEnt);
          if (!src) { wizard.srcEnt = null; render(); return; }
          const list = [
            ...paramsOf(src).map((pp) => ({ k: pp.k, name: pp.name })),
            ...(REGISTRY[src.type].derived || []).map((dd) => ({ k: dd.k, name: dd.name })),
          ];
          srcBox.innerHTML = `
            <div class="wizSub" style="padding:2px 0 6px">${src.label} 的哪个量？</div>
            ${list.map((pp) => `<button class="wizVarBtn" data-wp2="${pp.k}">${pp.name} <span style="color:var(--ink-2)">${src.label}.${pp.k} = ${fmt(S.getVal(st, src, pp.k))}</span></button>`).join('')}
            <button class="wizCancel" id="wizPickBack">← 换个实体</button>
          `;
          srcBox.querySelectorAll('[data-wp2]').forEach((b) => {
            b.addEventListener('click', () => commit(`${src.label}.${b.dataset.wp2}`));
          });
          srcBox.querySelector('#wizPickBack').addEventListener('click', () => { wizard.srcEnt = null; render(); });
        }
      } else {
        srcBox.innerHTML = `
          <input class="fxInput" id="wizExpr" placeholder="如 a/2，或 c1.r*2，或 sin(a)" spellcheck="false">
          <div class="paneHint" style="text-align:left;padding:6px 2px">可引用：变量名、观察器名、其他实体的参数（如 c1.r、s1.length、s1.angle）、π/e、sin cos sqrt…</div>
          <button class="addBtn fxGo" id="wizGo">完成关联</button>
        `;
        const inp = srcBox.querySelector('#wizExpr');
        inp.focus();
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(inp.value); });
        srcBox.querySelector('#wizGo').addEventListener('click', () => commit(inp.value));
      }

      function commit(src) {
        const r = S.addBinding(st, ent.id, wizard.param, src);
        if (r.error) { errBox.textContent = r.error; return; }
        wizard = null;
        render();
      }
    }
    body.querySelector('#wizCancel').addEventListener('click', () => { wizard = null; render(); });
  }

  function varCardAnchor(name) {
    const el = document.querySelector(`[data-varcard="${name}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      return [r.left, r.top + r.height / 2];
    }
    // 变量页未激活时：丝线从面板左缘引出，保证连接视图始终可见
    const panel = document.getElementById('panel');
    const pr = panel.getBoundingClientRect();
    return [pr.left, pr.top + 60];
  }

  // 每帧轻量刷新：绑定值/派生值/变量值显示（不重建 DOM）
  function tickValues() {
    if (wizard) return;
    // 变量窗口与右侧面板都要就地刷新（变量已搬到右下角独立窗口）
    const roots = [body, document.getElementById('varWinBody')].filter(Boolean);
    for (const root of roots) tickIn(root);
  }

  function tickIn(root) {
    root.querySelectorAll('[data-liveval]').forEach((el) => {
      const [id, key] = el.dataset.liveval.split(':');
      const ent = st.entities.get(id);
      if (ent) el.textContent = fmt(S.getVal(st, ent, key));
    });
    root.querySelectorAll('[data-livederived]').forEach((el) => {
      const [id, key] = el.dataset.livederived.split(':');
      const ent = st.entities.get(id);
      if (ent) el.textContent = fmt(S.getDerived(st, ent, key));
    });
    root.querySelectorAll('[data-vslider]').forEach((el) => {
      const v = st.variables.get(el.dataset.vslider);
      if (v && document.activeElement !== el && Math.abs(parseFloat(el.value) - v.value) > 1e-9) el.value = v.value;
    });
    root.querySelectorAll('[data-vval]').forEach((el) => {
      const v = st.variables.get(el.dataset.vval);
      if (v && document.activeElement !== el) el.value = fmt(v.value);
    });
    root.querySelectorAll('[data-probeval]').forEach((el) => {
      const p = st.probes.get(el.dataset.probeval);
      if (p) el.textContent = fmt(S.probeValue(st, p));
    });
    root.querySelectorAll('[data-vbinds]').forEach((el) => {
      const n = S.boundByCount(st, el.dataset.vbinds);
      el.textContent = n ? `⛓${n}` : '';
    });
  }

  return { render, setTab, openWizard, openConstraintConfig, varCardAnchor, tickValues, isWizard: () => !!wizard, varsHTML, bindVars, renderVars };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 属性面板底部的引导语：按实体类型给出下一步最值得做的事
function quickHint(ent) {
  switch (ent.type) {
    case 'edgepoint':
      return '它在图形上滑动 → 拖它试试。<br>参数 t 可以绑到变量（例如让滑杆驱动它绕圆转）。';
    case 'arc':
      return '这段弧由两个线上点截出，跟着宿主走。<br>右键「解绑」可以把它独立出来拖走。';
    case 'curvepiece':
      return '这一段由两个线上点从曲线上截出。<br>右键「解绑」＝脱离宿主，就能拖出来当独立曲线用。';
    case 'polygon':
      return '拖顶点改形状，拖边或内部＝整体移动。<br>右键「解绑」可拆散成线段；选中多条线段可再「绑定为一个整体」。';
    case 'circle':
      return '拖直径两端改半径，拖直径整体移动。<br>点工具点在圆上可以截出弧。';
    default:
      return '右键画布中的它 →「关联…」<br>把参数连到变量上';
  }
}

// 多边形上的线上点：是否允许滑到其它边（默认锁定在自己的那条边）
function roamRow(ent) {
  if (ent.type !== 'edgepoint') return '';
  const host = null;
  return `<div class="propRow"><span class="pname">允许绕行</span>
    <label class="switch"><input type="checkbox" id="roamToggle" ${ent.roam ? 'checked' : ''}>
    <span>${ent.roam ? '可滑到其它边' : '只能在本边滑动'}</span></label></div>`;
}

// 该对象参与的所有约束（可逐条删除）
// 注意：本函数在 createPanel 之外，st 必须由调用方传入
function constraintRows(st, ent) {
  const list = S.constraintsOf(st, ent.id);
  if (!list.length) return '';
  return `<div class="propRel" style="margin-top:8px">约束</div>` + list.map((c) => {
    const bad = (c.error || 0) > 1e-3;
    const names = c.refs.map((id) => st.entities.get(id)?.label || '?').join(' · ');
    return `<div class="propRow">
      <span class="pname">${KINDS[c.kind]?.label || c.kind}</span>
      <span style="font-size:11px;color:${bad ? 'var(--warn)' : 'var(--ink-2)'}">${names}${bad ? '（未完全满足）' : ''}</span>
      <button class="punbind" data-unconstrain="${c.id}" title="删除约束">✕</button>
    </div>`;
  }).join('');
}

// 解绑 / 绑定 的动作按钮
function actionRows(ent) {
  const out = [];
  if (ent.type === 'polygon') {
    out.push(`<button class="addBtn actBtn" id="actExplode">✂ 解绑为 ${ent.count} 条线段</button>`);
  }
  if (ent.type === 'segment') {
    out.push('<button class="addBtn actBtn" id="actMerge">⧉ 绑定选中的线段为一个整体</button>');
  }
  if (ent.type === 'arc' || ent.type === 'curvepiece') {
    out.push('<button class="addBtn actBtn" id="actDetach">✂ 解绑（脱离宿主，可自由拖动）</button>');
  }
  return out.join('');
}