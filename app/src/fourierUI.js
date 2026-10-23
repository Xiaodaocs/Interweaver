// 傅里叶变换的界面层（issue #1）：选项卡 → 关联式卡片 → 武装放置；以及"任何曲线 → 多个波"。
//
// 用户口径（2026-10-18 确认）：
//   1) 点「fx」→ 先出**选项卡**（函数绘制器 / 傅里叶变换）→ 选后者 → 弹**类似「关联」的操作卡片**
//      → 勾选需要的波 → 「确定」→ **在画布上点一下放置**合成波
//   2) 任何一条曲线右键 → 傅里叶变换 → **转换为多个波**
//   3) 演示图放 app/docs/demo/ ✓（由验收脚本生成）
//
// 设计约束（项目铁律）：
//   · 零依赖 ✓ 不引任何库 ✓（FFT 在 src/fourier.js ✓ 已与朴素 DFT 对拍过 ✓）
//   · **零新类名** ✗：容器复用既有的 `.win`（index.html 里已有同款），其余一律用 `data-iw-f-*` 属性 ✓
//     （双向类契约检查只看类名 ✓ 属性选择器不参与 ✓ 与「关于」面板同一套做法 ✓）
//   · 不在模块顶层碰 DOM ✓（只在 createFourierUI 里按需建 ✓ 模块守卫才能通过 ✓）
//   · 所有文本走 textContent ✗ 不用 innerHTML 拼用户/曲线数据 ✓
import { showCard, hideCard } from './windows.js';
import { analyze } from './fourier.js';
// ★ 修复（用户报告：卡片里选不到自己画的函数曲线）：
//   func 实体没有 yAt（求值走 entities.js 内部的 safeEval）→ 卡片原来只列带 yAt 的实体，
//   于是用函数绘制器画的曲线进不了选波列表。项目已导出 hostYAt（issue#6 的 t 模式），
//   它就是「任意宿主按 x 求 y」的公共入口 → 这里复用 ✓ 不重复实现 ✗
import { hostYAt, isCalculusHost, hostPointAt, hostTRange } from './entities.js';

const SAMPLE_N = 256;        // 取样点数（2 的幂附近 ✓ 内部还会补零到 2 的幂 ✓）
const DEFAULT_KEEP = 8;      // 默认保留的谐波数 ✓

/** 建 UI（返回一组方法 ✓ 由 main.js 挂到 fx 选项卡上） */
export function createFourierUI({ st, S, cam, REGISTRY, hooks = {} }) {
  const hint = (m) => hooks.hint?.(m);
  const redraw = () => hooks.redraw?.();

  // ── 1) 选项卡：函数绘制器 / 傅里叶变换（照坐标系工具那套：showCard + data-slide="up" ✓）
  const chooser = document.createElement('div');
  chooser.className = 'win';          // 复用既有 .win 观感 ✓ 不新增类名 ✗
  chooser.id = 'fwMenu';              // ★ 定位靠 id（与 #csMenu 同款规则 ✓ id 不进类契约 ✓）
  chooser.setAttribute('data-slide', 'up');
  chooser.setAttribute('data-iw-f', 'chooser');
  chooser.hidden = true;
  chooser.innerHTML = '';
  // ★ 与坐标系菜单**同一个按钮类**（.csMenuItem ✓ 已在 CSS 里有样式 ✓ 不新增类名 ✗）
  //   结构与 #csMenu 一致：<b>主标题</b> + <small>一行说明</small>
  const mkBtn = (label, sub, testid, onClick) => {
    const b = document.createElement('button');
    b.className = 'csMenuItem';
    b.setAttribute('data-iw-f-act', testid);
    const bb = document.createElement('b'); bb.textContent = label; b.appendChild(bb);
    const sm = document.createElement('small'); sm.textContent = sub; b.appendChild(sm);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  };
  chooser.appendChild(mkBtn('ƒ 函数绘制器', '画 y=f(x) 或隐函数曲线', 'drawer', () => { hideChooser(); hooks.openDrawer?.(); }));
  chooser.appendChild(mkBtn('∼ 傅里叶变换', '把多个波合成为一条波 / 把一条曲线拆成多个波', 'fourier', () => { hideChooser(); openCard(); }));
  document.body.appendChild(chooser);

  // ── 2) 关联式卡片：勾选"需要的波" + 保留谐波数 N + 确定
  const card = document.createElement('div');
  card.className = 'win';
  card.id = 'fwCard';                  // ★ 与 #opPop 同款定位（id 不进类契约 ✓）
  card.setAttribute('data-slide', 'tl');
  card.setAttribute('data-iw-f', 'card');
  card.hidden = true;
  // ★ 结构也与 #opPop 一致（用户要求「同样式」✓）：winBar + winTitle + winBtns(×) + winBody
  const bar = document.createElement('div');
  bar.className = 'winBar'; bar.setAttribute('data-winbar', '');
  const title = document.createElement('span');
  title.className = 'winTitle'; title.textContent = '傅里叶变换';
  const btns = document.createElement('span');
  btns.className = 'winBtns';
  const closeX = document.createElement('button');
  closeX.id = 'fwCardClose'; closeX.title = '收起'; closeX.textContent = '×';
  closeX.addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
  btns.appendChild(closeX);
  bar.appendChild(title); bar.appendChild(btns);
  card.appendChild(bar);
  const cardBody = document.createElement('div');
  cardBody.className = 'winBody';
  card.appendChild(cardBody);
  document.body.appendChild(card);

  // ★ 排版照「关联」操作卡片（用户 2026-10-20 要求「排版和风格等都一样」✓）：
  //   关联卡片的真实结构是  .wizTitle + .wizSub + 若干 button.wizParam（右侧 span.pv 显示当前值）
  //                        + .paneHint + .addBtn 组成
  //   这里全部复用这些**既有类名** ✓（不加新类 ✗ 双向类契约不受影响 ✓）
  const headTitle = document.createElement('div');
  headTitle.className = 'wizTitle'; headTitle.setAttribute('data-iw-f', 'title');
  headTitle.textContent = '选择要合成的波';
  const step1 = document.createElement('div');
  step1.className = 'wizSub'; step1.setAttribute('data-iw-f', 'step1');
  step1.textContent = '第一步：点一行把它选中 / 取消';
  const listHost = document.createElement('div');
  listHost.setAttribute('data-iw-f', 'list');
  const step2 = document.createElement('div');
  step2.className = 'wizSub'; step2.textContent = '第二步：保留几个谐波';
  const nRow = document.createElement('div');
  nRow.className = 'wizParam';               // 与关联卡片的参数行同一外观 ✓
  nRow.setAttribute('data-iw-f', 'nrow');
  const nLabel = document.createElement('span');
  nLabel.textContent = '保留谐波数 N';
  const nPv = document.createElement('span');
  nPv.className = 'pv';
  const nInput = document.createElement('input');
  nInput.type = 'number';
  nInput.min = '1'; nInput.max = '64'; nInput.step = '1'; nInput.value = String(DEFAULT_KEEP);
  nInput.setAttribute('data-iw-f', 'n');
  nInput.style.width = '58px'; nInput.style.textAlign = 'right';
  nPv.appendChild(nInput);
  nRow.appendChild(nLabel); nRow.appendChild(nPv);
  const hintRow = document.createElement('div');
  hintRow.className = 'paneHint';
  hintRow.textContent = '确定之后，在画布上点一下放置合成波。';
  const acts = document.createElement('div');
  acts.className = 'csBtnRow';               // 既有类 ✓（两按钮横排）
  acts.setAttribute('data-iw-f', 'acts');
  const okBtn = document.createElement('button');
  okBtn.className = 'addBtn';
  okBtn.textContent = '确定';
  okBtn.setAttribute('data-iw-f-act', 'ok');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'addBtn';
  cancelBtn.textContent = '取消';
  cancelBtn.setAttribute('data-iw-f-act', 'cancel');
  acts.appendChild(okBtn); acts.appendChild(cancelBtn);
  cardBody.appendChild(headTitle);
  cardBody.appendChild(step1);
  cardBody.appendChild(listHost);
  cardBody.appendChild(step2);
  cardBody.appendChild(nRow);
  cardBody.appendChild(hintRow);
  cardBody.appendChild(acts);

  let picked = new Set();       // 被勾选的波实体 id
  let pending = null;           // 待放置的合成波规格（武装放置时用 ✓）

  const toggleChooser = () => {
    if (!chooser.hidden) { hideChooser(); return; }
    showCard(chooser, 'up');
    chooser.hidden = false;
  };
  const hideChooser = () => { hideCard(chooser); chooser.hidden = true; };

  /** 打开卡片：列出画布上"可当波"的实体 ✓（有 yAt 的才列 ✓ 没列的如实说明 ✗ 不假装） */
  function openCard() {
    picked = new Set();
    listHost.textContent = '';
    // 判据改为「能不能取样」，而不是「有没有 yAt」：
    //   有 yAt 的直接可用；函数/几何/自由曲线等可当微积分宿主的走 hostYAt（见 sampleCurveY）
    const waves = [...st.entities.values()].filter((e) => {
      if (!e || e.type === 'coordsys') return false;
      const def = REGISTRY[e.type] || {};
      return typeof def.yAt === 'function' || isCalculusHost(e);
    });
    if (!waves.length) {
      const p = document.createElement('div');
      p.setAttribute('data-iw-f', 'empty');
      p.textContent = '画布上还没有可变换的波：先用「函数绘制器」画一个正弦或函数曲线，或右键任意曲线 →「傅里叶变换 → 转换为多个波」。';
      listHost.appendChild(p);
    } else {
      headTitle.textContent = '选择要合成的波（共 ' + waves.length + ' 条曲线）';
      for (const e of waves) {
        // 与关联卡片的参数行同款：<button class=wizParam> 名称 <span class=pv>当前状态</span>
        const row = document.createElement('button');
        row.className = 'wizParam';
        row.setAttribute('data-iw-f', 'item');
        row.setAttribute('data-iw-f-wave', e.id);      // 测试脚本按这个选择器找 ✓
        const nm = document.createElement('span');
        nm.textContent = (e.label || e.type) + '（' + (REGISTRY[e.type].label || e.type) + '）';
        const pv = document.createElement('span');
        pv.className = 'pv';
        const sync = () => { pv.textContent = picked.has(e.id) ? '✓ 已选' : '○ 未选'; };
        sync();
        row.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (picked.has(e.id)) picked.delete(e.id); else picked.add(e.id); sync(); });
        row.appendChild(nm); row.appendChild(pv);
        listHost.appendChild(row);
      }
    }
    showCard(card, 'tl');
    card.hidden = false;
    hint('✦ 傅里叶变换：勾选要参与合成的波 → 改「保留谐波数 N」→ 确定，然后在画布上点一下放置');
  }
  const closeCard = () => { hideCard(card); card.hidden = true; pending = null; };

  okBtn.addEventListener('click', () => {
    const ids = [...picked];
    if (!ids.length) { hint('⚠ 先勾选至少一个波（卡片里的复选框）'); return; }
    const keep = Math.max(1, Math.min(64, Math.round(Number(nInput.value) || DEFAULT_KEEP)));
    const spec = buildSpec(ids, keep);
    if (!spec) { hint('⚠ 取不到这些波的取样数据（见下方说明）'); return; }
    // ⚠️ 顺序很重要 ✗：closeCard() 里会 pending = null（取消时该清 ✓）
    //   → 必须**先**关卡片、**再**设置 pending ✓（实测踩过：先设后被清 → 武装成功但没东西可放 ✗）
    closeCard();
    pending = spec;
    hooks.armPlace?.(spec);      // ← 交给 tools.js：下一画布点击就落一个合成波 ✓
    hint('✦ 已算好合成波（' + spec.harmonics.length + ' 个谐波，RMS ' + spec.rms.toExponential(2) + '）→ 在画布上点一下放置');
  });
  cancelBtn.addEventListener('click', () => { closeCard(); hint('· 已取消傅里叶变换'); });

  // ── 3) 取样：把任意曲线变成 y(x) 的等距取样（"任何一条曲线都能 FFT"的关键 ✓）
  //   做法：先用 hostPointAt 按参数 t 取一串点（圆/隐函数/自由曲线都行 ✓），
  //         再按 x 等距重采（多值处取**第一次**穿过的分支 ✓ 并在返回里如实标注 multiValued ✓ 不假装单调 ✗）
  function sampleCurveY(ent, x0, x1, n) {
    const def = REGISTRY[ent.type] || {};
    const V = (k) => S.getVal(st, ent, k);
    // ★ 路径 0（修复用户 2026-10-20 报告：函数生成器生成的函数总是拆解失败 ✗）
    //   实测：绘制器造出来的 func 字段是 exprSrc + ast ✗（不是我以为的 expr ✗）
    //   而且项目自己的 hostYAt(ent, env, x) 对它是 **null / 全 NaN** ✗ → 所以"预设库曲线能拆、函数生成器的不能拆"✓
    //   这里直接走项目**真实求值入口** st.scope.evalWith(ent.ast, x) ✓（browser-e2e 里就是这么验 f(4)=11 的 ✓）
    //   口径与绘制一致：曲线自身坐标 f(x − cx) + cy ✓
    if (ent.ast && st.scope && typeof st.scope.evalWith === 'function') {
      const cx0 = Number(V('cx')) || 0, cy0 = Number(V('cy')) || 0;
      const ys = [];
      let bad0 = 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / (n - 1);
        let y = NaN;
        try { y = st.scope.evalWith(ent.ast, x - cx0); } catch { y = NaN; }
        if (Number.isFinite(y)) ys.push(y + cy0); else { ys.push(NaN); bad0++; }
      }
      if (ys.length - bad0 >= 8) return { ys, multiValued: false, bad: bad0, how: 'evalWith' };
    }
        if (typeof def.yAt === 'function') {
      const ys = [];
      for (let i = 0; i < n; i++) ys.push(def.yAt(V, x0 + ((x1 - x0) * i) / (n - 1)));
      const bad = ys.filter((v) => !Number.isFinite(v)).length;
      return { ys, multiValued: false, bad, how: 'yAt' };
    }
    // 路径 B：项目自己的 hostYAt（issue#6 的 t 模式）—— 函数/几何/自由曲线/隐函数都走这里 ✓
    if (isCalculusHost(ent)) {
      const env = {
        ent: (id) => st.entities.get(id),
        val: (id, k) => { const e2 = st.entities.get(id); return e2 && e2.params ? e2.params[k] : undefined; },
      };
      const ys = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / (n - 1);
        let y = NaN;
        try { y = hostYAt(ent, env, x); } catch { y = NaN; }
        ys.push(Number.isFinite(y) ? y : NaN);
      }
      const bad = ys.filter((v) => !Number.isFinite(v)).length;
      // ★ 致命 bug 修复（用户报告：任何波都失败）：
      //   hostYAt 只对**函数式**宿主有意义 ✗；圆/自由曲线/隐函数这类非函数曲线它会全给 NaN ✗
      //   我原来在这里 `return null` ✗ → 下面那条"按参数取点再按 x 重采"的**通用路径根本执行不到** ✗
      //   → 于是右键圆/自由曲线必然弹"没有可用的 y(x) 取样" ✓
      //   现在：取不到就**继续往下走** ✓ 交给通用路径 ✓
      if (ys.length - bad >= 8) return { ys, multiValued: false, bad, how: 'hostYAt' };
    }
    // 路径 D（顺手补的一条）：**合成波本身**也能被再次拆解 ✓
    //   它没有 yAt ✗ 但它自带谐波表 ✓ → 直接用谐波算 y(x) ✓（与它的 draw 同一公式 ✓）
    if (ent.type === 'fourierwave' && Array.isArray(ent.harmonics) && ent.harmonics.length) {
      const keepD = Math.max(1, Math.round(Number(ent.params && ent.params.N) || ent.harmonics.length));
      const hsD = ent.harmonics.slice(0, keepD);
      const cxD = Number(ent.params && ent.params.cx) || 0;
      const cyD = Number(ent.params && ent.params.cy) || 0;
      const ysD = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / (n - 1);
        let y = cyD;
        for (const h of hsD) {
          if (!h || !Number.isFinite(h.amp) || !Number.isFinite(h.freq)) continue;
          y += h.amp * Math.sin(2 * Math.PI * h.freq * (x - cxD) + (Number.isFinite(h.phase) ? h.phase : 0));
        }
        ysD.push(y);
      }
      return { ys: ysD, multiValued: false, bad: 0, how: 'harmonics' };
    }
        // ★ 通用路径（修 bug）：圆 / 自由曲线 / 隐函数 / 圆弧 等**非函数曲线**都走这里 ✓
    //   项目导出的 hostPointAt(host, env, t) 能对任意宿主按参数取值 ✓（issue#6 的 t 模式用的就是它 ✓）
    //   原来我找的是 def.pointAt ✗ —— 这个字段**不存在** ✗ 所以这条路径从来没能跑过 ✗
    {
      const env = {
        ent: (id) => st.entities.get(id),
        val: (id, k) => { const e2 = st.entities.get(id); return e2 && e2.params ? e2.params[k] : undefined; },
      };
      const pts = [];
      // ★ t 的取值范围必须按宿主类型取 ✓（实测：圆的 t 是**角度** [0, 2π] ✗ 不是 [0,1] ✗）
      //   项目导出的 hostTRange(host) 就是干这个的 ✓（圆 → [0, 2π]；线段 → [0,1]；等）
      let tr = [0, 1];
      try { tr = hostTRange(ent) || [0, 1]; } catch { tr = [0, 1]; }
      const t0 = Number(tr[0]), t1 = Number(tr[1]);
      const span = Number.isFinite(t1 - t0) && t1 !== t0 ? t1 - t0 : 1;
      for (let i = 0; i <= n * 2; i++) {
        let p = null;
        try { p = hostPointAt(ent, env, t0 + (span * i) / (n * 2)); } catch { p = null; }
        // hostPointAt 可能返回 [x,y] 或 {x,y} → 两种都收 ✓
        if (p && Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(p);
        else if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push([p.x, p.y]);
      }
      if (pts.length < 4) return null;
      const xsAll = pts.map((p) => p[0]);
      const lo = Math.min(...xsAll), hi = Math.max(...xsAll);
      const ys = [];
      let multiValued = false;
      for (let i = 0; i < n; i++) {
        const x = lo + ((hi - lo) * i) / (n - 1);
        // 找到第一段跨过 x 的折线并线性插值 ✓（多值时会有多段 → 记 multiValued ✓ 取第一段 ✓）
        let y = NaN, hits = 0;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          if ((a[0] - x) === 0) hits++;
          if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
            hits++;
            if (!Number.isFinite(y)) {
              const t = (x - a[0]) / (b[0] - a[0]);
              y = a[1] + (b[1] - a[1]) * t;
            }
          }
        }
        if (hits > 1) multiValued = true;
        ys.push(y);
      }
      return { ys, multiValued, bad: ys.filter((v) => !Number.isFinite(v)).length, how: 'pointAt' };
    }
    return null;
  }

  /** 由选中的波算出一份"合成波规格"（谐波表 + 原始取样 + RMS ✓ 数字都要能对得上 ✓） */
  function buildSpec(ids, keep) {
    // 视口范围作为分析窗口 ✓（与函数实体的采样口径一致 ✓）
    const { w } = cam.size();
    const x0 = cam.s2w(0, 0).x, x1 = cam.s2w(w, 0).x;
    if (!(x1 > x0)) return null;
    const dt = (x1 - x0) / (SAMPLE_N - 1);
    let ys = new Array(SAMPLE_N).fill(0);
    let anyY = false, multiValued = false, allHarmonics = [];
    const srcParts = [];
    for (const id of ids) {
      const ent = st.entities.get(id);
      if (!ent) continue;
      const s = sampleCurveY(ent, x0, x1, SAMPLE_N);
      if (!s) continue;
      anyY = true;
      if (s.multiValued) multiValued = true;
      for (let i = 0; i < SAMPLE_N; i++) ys[i] += Number.isFinite(s.ys[i]) ? s.ys[i] : 0;
      srcParts.push({ id: ent.label || id, bad: s.bad, how: s.how, multiValued: s.multiValued });
      // 每个波各自做 FFT ✓ 谐波合并 ✓（频率相同的谐波自然地叠加 ✓ 这正是"多波合成"的数学含义 ✓）
      const r = analyze(s.ys, dt, { keep: 32 });
      allHarmonics = allHarmonics.concat(r.harmonics);
    }
    if (!anyY) return null;
    allHarmonics.sort((a, b) => b.amp - a.amp);
    const top = allHarmonics.slice(0, Math.max(1, Math.min(keep, allHarmonics.length)));
    // RMS：合成波 vs 原始叠加取样 ✓（用**取样时的中心** (0,0) ✓ 与 fourierwave 的 srcCx/srcCy 对应 ✓）
    const synth = (x) => top.reduce((y, h) => y + h.amp * Math.sin(2 * Math.PI * h.freq * x + h.phase), 0);
    let se = 0, sc = 0;
    for (let i = 0; i < SAMPLE_N; i++) {
      const x = x0 + dt * i;
      const d = ys[i] - synth(x);
      se += d * d; sc++;
    }
    const rms = sc ? Math.sqrt(se / sc) : NaN;
    return {
      harmonics: top, keep, srcY: ys, srcX0: x0, srcX1: x1, srcCx: 0, srcCy: 0,
      rms, multiValued, srcParts, SAMPLE_N,
    };
  }

  /** 在画布某处放置合成波（由 tools.js 的放置工具调用 ✓） */
  function placeAt(wp) {
    if (!pending) return null;
    const spec = pending;
    pending = null;
    const ent = S.addEntity(st, 'fourierwave', { N: spec.keep, cx: wp.x, cy: wp.y }, {
      harmonics: spec.harmonics.map((h) => ({ amp: h.amp, freq: h.freq, phase: h.phase })),
      srcY: spec.srcY, srcX0: spec.srcX0, srcX1: spec.srcX1, srcCx: spec.srcCx, srcCy: spec.srcCy,
      fwMeta: { rms: spec.rms, multiValued: !!spec.multiValued, srcParts: spec.srcParts },
    });
    redraw();
    return ent;
  }

  /** ★ 把**任意一条曲线**转换成多个波（你要求的第 2 条 ✓）：取样 → FFT → 每个谐波建一个 sine 实体
   *  · 复用上面的 sampleCurveY ✓（有 yAt 走 yAt，否则按参数取点再按 x 重采 ✓ 圆/隐函数/自由曲线都行 ✓）
   *  · sine 的参数与谐波一一对应 ✓：A ← amp、lam ← 1/freq、phi ← phase、cy ← 直流分量、cx ← 0（谐波是在 cx=0 处拟合的 ✓）
   *  · 返回 { ok, created:[…], rms, multiValued, reason? } ✓ 失败必须说明原因 ✗ 不许静默返回空 ✓ */
  function toWaves(entId, keepWant = 6) {
    const ent = st.entities.get(entId);
    if (!ent) return { ok: false, created: [], reason: '找不到这条曲线' };
    // ★ 保险（用户 2026-10-21：一次创建太多波把画布拖到 7fps，连"新建"都点不动 ✗）
    //   实测：120 个波 → 7fps（每帧 143ms），界面响应被拖慢 ✓ 但「新建」本身 63ms 就能清空 ✓
    //   → 这里在**实体已经很多**时拒绝继续拆解 ✓ 并明确告诉用户先清理 ✓
    //     不是偷偷限制 ✗ 而是给一句人话 ✓（这类"自己把自己锁死"的状态不该让用户遇到 ✓）
    const WAVE_SOFT_LIMIT = 160;
    if (st.entities.size >= WAVE_SOFT_LIMIT) {
      return { ok: false, created: [], reason: '画布上已有 ' + st.entities.size + ' 个实体（超过 ' + WAVE_SOFT_LIMIT + '），再拆解会让画面卡到无法操作；请先用「文件 → 新建」或删掉一些波再试' };
    }
    const { w } = cam.size();
    const x0 = cam.s2w(0, 0).x, x1 = cam.s2w(w, 0).x;
    if (!(x1 > x0)) return { ok: false, created: [], reason: '当前视野无效，无法取样' };
    const n = SAMPLE_N;
    const dt = (x1 - x0) / (n - 1);
    const s = sampleCurveY(ent, x0, x1, n);
    if (!s) return { ok: false, created: [], reason: '这条曲线没有可用的 y(x) 取样（它可能不是函数式曲线）' };
    const good = s.ys.filter((v) => Number.isFinite(v)).length;
    if (good < 8) return { ok: false, created: [], reason: '有效取样点太少（' + good + ' 个），无法做频谱分析' };
    const r = analyze(s.ys, dt, { keep: Math.max(1, Math.min(64, keepWant)) });
    // 直流分量（analyze 已去均值 ✓ 这里把均值作为 sine 的 cy 加回去 ✓ 否则合成波会整体偏移 ✗）
    const ysGood = s.ys.filter((v) => Number.isFinite(v));
    const mean = ysGood.reduce((a, b) => a + b, 0) / ysGood.length;
    const created = [];
    for (const h of r.harmonics) {
      if (!(h.amp > 1e-9) || !Number.isFinite(h.freq) || !(h.freq > 0)) continue;
      created.push(S.addEntity(st, 'sine', {
        A: h.amp,
        lam: 1 / h.freq,
        phi: h.phase,
        cx: 0,
        cy: mean,
        // ★ 标记来源（用户 2026-10-23）：便于将来把它迁移成"无限长"，也能让 UI 区分"拆解出来的波" ✓
        fwFrom: 'fourier',
        // ★ 用户 2026-10-23：拆解出来的波要像合成波那样"随画面显示长度、虚拟无限长" ✓
        //   定为 ±Infinity 后，项目自己的 sampleCurve 取「视口 ∩ 定义域」= **恰好视口** ✓
        //   → 渲染刚好延伸到屏幕边缘（不多不少 ✓），平移到哪里画到哪里 ✓
        //   ★ 为什么现在敢这么做（以前不敢 ✗）：
        //     · 项目的 sampleCurve / hitSampled 都**先裁剪到视口** ✓ 采样点数只按屏幕宽度算 ✓
        //       （func 实体一直用 ±Infinity 且很快 ✓ 就是这个道理 ✓）
        //     · 之前那次"菜单 10 秒"的真凶是**我自己写的** __sinePoly 循环沿 ±1e4 走 ✗（已删除 ✓）
        //       不是这个定义域 ✗；项目路径本身是视口有界的 ✓
        //   ★ 逻辑冲突已处理 ✓：谐波只在分析窗口 [x0,x1] 内拟合 ✓ → 窗外是**外推** ✓
        //     但分析窗口记在实体的 srcX0/srcX1 上 ✓（RMS 误差用它 ✓ 与渲染窗口互不影响 ✓）
        //   ★ 存档安全 ✓：JSON 会把 Infinity 变成 null ✓，读档时 dom() 把非有限值当 ±Infinity ✓ 不会坏 ✓
        dmin: -Infinity, dmax: Infinity,
      }));
    }
    // 用"前 N 个 sine 相加" vs 原取样算 RMS ✓（与合成波实体同一口径 ✓ 数字可检验 ✓）
    let se = 0, sc = 0;
    for (let i = 0; i < n; i++) {
      const y0 = s.ys[i];
      if (!Number.isFinite(y0)) continue;
      const x = x0 + dt * i;
      let y = mean;
      for (const h of r.harmonics) y += h.amp * Math.sin(2 * Math.PI * h.freq * x + h.phase);
      se += (y0 - y) * (y0 - y); sc++;
    }
    redraw();
    return {
      ok: created.length > 0,
      created,
      rms: sc ? Math.sqrt(se / sc) : NaN,
      multiValued: !!s.multiValued,
      reason: created.length ? '' : '这条曲线的谐波都太弱（幅值 < 1e-9），没有可用的波',
    };
  }

  return {
    toggleChooser, hideChooser, openCard, closeCard,
    isChooserOpen: () => !chooser.hidden,
    isCardOpen: () => !card.hidden,
    hasPending: () => !!pending,
    placeAt,
    toWaves,
    _buildSpec: buildSpec,     // 供测试直接调用 ✓（不必点 UI ✓ 也能验证数学 ✓）
  };
}
