// 工具与指针交互：选择/拖动、点、线段、圆、画笔、平移缩放、吸附、框选（DOM 模块）
import { REGISTRY, dragHandler, canHostPoint, paramsOf } from './entities.js';
import { lineLikeOf, jointsNear, intersectLines } from './lines.js';
import * as S from './state.js';
import { gridStep } from './camera.js';
import { dist } from './util.js';

export function createTools(st, cam, canvas, hooks = {}) {
  let spaceDown = false;
  let gesture = null;
  let lastClick = null;   // 自己判双击（时间+距离）       // { kind:'drag'|'pan'|'box'|'draw-seg'|'draw-circle'|'draw-free', ... }

  const TOL = () => 8 / cam.z;

  function worldOf(e) {
    const r = canvas.getBoundingClientRect();
    return cam.s2w(e.clientX - r.left, e.clientY - r.top);
  }
  function screenOf(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 吸附：网格交点 + 实体特征点（端点/中点/圆心），10px 磁性
  function snapPoint(wp, excludeId = null) {
    const tolPx = 10;
    let best = null, bestD = tolPx;
    const step = gridStep(cam.z);
    const gx = Math.round(wp.x / step) * step, gy = Math.round(wp.y / step) * step;
    const gd = screenDist(wp, { x: gx, y: gy });
    if (gd < bestD) { best = { x: gx, y: gy }; bestD = gd; }
    for (const ent of st.entities.values()) {
      if (ent.id === excludeId) continue;
      const def = REGISTRY[ent.type];
      for (const [fx, fy] of def.features(S.V(st, ent), ent, envOf())) {
        const d = screenDist(wp, { x: fx, y: fy });
        if (d < bestD) { best = { x: fx, y: fy }; bestD = d; }
      }
    }
    return best;
  }
  function screenDist(a, b) {
    const [ax, ay] = cam.w2s(a.x, a.y), [bx, by] = cam.w2s(b.x, b.y);
    return Math.hypot(ax - bx, ay - by);
  }

  // 供实体读取其它实体参数（线上点/圆弧需要宿主几何）：直接用全场景取值环境
  function envOf() { return st.env || { val: () => NaN, ent: () => null, st }; }

  // 拖动起点必须用【求值后】的参数（被绑定的参数其 params 里存的是自由值，
  // 直接拿它会得到过时的基准，导致反向求解算错）。
  function effParams(ent) {
    const out = {};
    for (const p of paramsOf(ent)) out[p.k] = S.getVal(st, ent, p.k);
    return out;
  }

  function hitTest(wp, scale = 1) {
    // 命中优先级：
    //   1) 小把手（点 / 线上点）永远优先——它们常常正好压在别的图形上，必须抓得到；
    //   2) 其余按 z 序（后画的在上）决定——这样叠在宿主曲线上的"裁切段"能先被选中，
    //      而裁切段本身没有拖拽处理，不能用"是否可拖"来排序。
    const ents = [...st.entities.values()].reverse();
    const hits = [];
    for (const ent of ents) {
      const def = REGISTRY[ent.type];
      const hit = def.hit(S.V(st, ent), wp, TOL() * scale, ent, cam, envOf());
      if (hit) hits.push({ ent, part: hit.part });
    }
    if (!hits.length) return null;
    const handle = hits.find((h) => h.ent.type === 'point' || h.ent.type === 'edgepoint');
    return handle || hits[0];
  }

  function setTool(name) {
    st.tool = name;
    st.preview = null;
    gesture = null;
    canvas.style.cursor = name === 'select' ? 'default' : 'crosshair';
    document.querySelectorAll('#toolbar button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === name));
  }

  // 一次绘制完成后自动回到鼠标（选择）模式；hooks.autoSelect=false 可关掉
  function afterDraw() {
    if (hooks.autoSelect === false) return;
    setTool('select');
  }

  // ---------- 指针事件 ----------
  // 触控命中容差：手指比鼠标粗，按 pointerType 放大；再乘 devicePixelRatio 的平方根，
  // 让高 dpi 屏幕上的"手指尺度"保持一致（否则 dpr=3 的手机上会明显难以点中）。
  const touchScale = (e) => {
    if (e && e.pointerType === 'touch') {
      const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
      return 1.8 * Math.sqrt(dpr);
    }
    return 1;
  };
  let activePointers = 0;      // 多指检测：≥2 指时不拖实体（避免双指缩放误拖）

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    activePointers++;
    if (activePointers >= 2 && gesture) {
      // 第二根手指落下 → 取消当前手势（不拖实体），交给相机/后续手势
      gesture = null;
      st.dragActive = false;
      st.draggingEnt = null;
    }
    // setPointerCapture 在"指针已失效 / 合成事件"等边界会抛错，不能让它打断手势启动
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 忽略：捕获失败不影响后续逻辑 */ }
    const wp = worldOf(e);
    const sp = screenOf(e);
    if (activePointers >= 2) return;      // 多指期间不启动任何"拖实体"手势

    // 平移：中键 或 空格+左键
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      gesture = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      canvas.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;

    switch (st.tool) {
      case 'select': {
        // ⑨ 双击接点：把"接触在一起的两样东西"绑起来（点是锚，别的端点/交点跟着它）
        // 自己判双击（时间 + 距离），不依赖 e.detail——合成事件里 detail 常常是 1
        const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const dbl = e.detail >= 2
          || (lastClick && nowT - lastClick.t < 380 && Math.hypot(wp.x - lastClick.x, wp.y - lastClick.y) < 10 / cam.z);
        lastClick = { t: nowT, x: wp.x, y: wp.y };
        if (dbl) {
          const r = S.bindContact(st, [wp.x, wp.y], TOL() * touchScale(e));
          if (r.error) hooks.hint?.(`⚠ ${r.error}`);
          else {
            st.selection = new Set([r.point.id]);
            S.emit(st, 'selection');
            hooks.hint?.(r.mode === 'endpoint'
              ? `✦ 已把 ${r.targets.join('、')} 的端点绑到这个点上 —— 拖动这个点，那条线的一端就跟着走`
              : `✦ 已把这个点绑到 ${r.joint.label}（两条线的交点）：绑定 ${r.parts.join(' + ')} —— 拖动任一条线，它都会跟着走`);
          }
          gesture = null;
          lastClick = null;
          S.emit(st);
          break;
        }
        // ④ 单击某颗"角的小球" → 把**那个角**变成实体。
        //    小球摆在每个角内部的平分线上（十字有 4 颗），所以点哪颗就建哪个角；
        //    必须在普通命中之前判断（交点必然落在线上）。
        {
          const balls = st._angleBalls || [];
          let pick = null, bestD = Infinity;
          for (const b of balls) {
            const d = Math.hypot(b.sx - sp.x, b.sy - sp.y);
            if (d < bestD) { bestD = d; pick = b; }
          }
          if (pick && bestD < 18) {
            const J = S.addJoint(st, pick.a, pick.b, [wp.x, wp.y], [wp.x, wp.y]);
            if (!J.error) {
              st.selection = new Set([J.entity.id]);
              S.emit(st, 'selection');
              hooks.hint?.(`✦ 已把这个角变成实体（${J.entity.label}，${S.getDerived(st, J.entity, 'deg').toFixed(1)}°）：可以关联给变量，让其中一条线转起来`);
              gesture = null;
              break;
            }
            hooks.hint?.(`⚠ ${J.error}`);
            gesture = null;
            break;
          }
        }
        const hit = hitTest(wp, touchScale(e));
        if (hit) {
          if (!st.selection.has(hit.ent.id)) {
            if (!e.shiftKey) st.selection.clear();
            st.selection.add(hit.ent.id);
            S.emit(st, 'selection');
          }
          const def = REGISTRY[hit.ent.type];
          S.beginGesture(st);
          const dragFn = dragHandler(def, hit.part, hit.ent);
          // 多选 + 抓本体 → 整组拖动（P2：徒手画三角形后整体拖动）
          const groupIds = (hit.part === 'body' && st.selection.size > 1)
            ? [...st.selection].filter((id) => {
                const en = st.entities.get(id);
                return en && REGISTRY[en.type].translate;
              })
            : [];
          gesture = {
            kind: 'drag', ent: hit.ent, part: hit.part,
            start: effParams(hit.ent), startPts: hit.ent.pts ? hit.ent.pts.map((p) => [...p]) : null,
            startW: wp, moved: false,
            canDrag: !!(dragFn || (hit.part === 'body' && def.drag.translatePts)),
            dragFn,
            group: groupIds.length > 1
              ? groupIds.map((id) => {
                  const en = st.entities.get(id);
                  return { ent: en, start: effParams(en), startPts: en.pts ? en.pts.map((p) => [...p]) : null };
                })
              : null,
          };
        } else {
          gesture = { kind: 'box', x0: sp.x, y0: sp.y, additive: e.shiftKey };
          st.boxSelect = { x0: sp.x, y0: sp.y, x1: sp.x, y1: sp.y };
        }
        break;
      }
      case 'angle': {
        // ① 角度工具：从一条直线型实体拖到另一条 → 建交点/夹角实体
        const onA = hitTest(wp, touchScale(e));
        const la = onA ? lineLikeOf(onA.ent, envOf()) : null;
        if (!la) {
          hooks.hint?.('✦ 请从一条线段（或圆的直径、切线、割线）上按下，拖到另一条线上');
          break;
        }
        gesture = { kind: 'draw-angle', a: onA.ent.id, aPt: wp };
        st.preview = { kind: 'angle', a: wp, b: wp };
        S.emit(st);
        break;
      }
      case 'point': {
        // 先看是否落在已有图形的边/曲线上 —— 是则"截"出一个线上点（可沿边滑动、可绑定 t）
        const onShape = hitTest(wp, touchScale(e));
        if (onShape && canHostPoint(onShape.ent)) {
          const t = S.projectOnEntity(st, onShape.ent, wp);
          const r = S.addEdgePoint(st, onShape.ent.id, t);
          if (r) {
            st.selection = new Set([r.point.id]);
            if (r.arc) {
              // ⑤ 截出来的是一段**独立**图形（不再挂宿主、拖它只平移）
              st.selection = new Set([r.arc.id]);
              const nm = S.pieceNameOf(r.arc);
              hooks.hint?.(r.arc.fromLabel
                ? `✦ 从 ${r.arc.fromLabel} 上截出一${nm === '线段' ? '段' : '段'}${nm}，它是独立图形：直接拖就整体搬走（不再跟着原曲线变形）`
                : `✦ 已截出一段${nm}：它是独立图形，直接拖就整体搬走`);
            } else {
              hooks.hint?.(`✦ 已"截"出线上点：它只能沿 ${onShape.ent.label} 滑动，参数 t 可以绑到变量`);
            }
            S.emit(st, 'selection');
          }
          // 截点通常要连点两下（例如圆上两点截弧），这一步不切回鼠标
          break;
        }
        const sn = snapPoint(wp);
        const at = sn || wp;
        const ent = S.addEntity(st, 'point', REGISTRY.point.create(at));
        st.selection = new Set([ent.id]);
        S.emit(st, 'selection');
        afterDraw();
        break;
      }
      case 'segment': {
        // 拖动式：按住 → 拖 → 松开
        const sn = snapPoint(wp);
        const at = sn || wp;
        gesture = { kind: 'draw-seg', a: at, b: at };
        st.preview = { kind: 'seg', a: at, b: at };
        break;
      }
      case 'circle': {
        // 拖动式：按住圆心 → 拖出半径 → 松开（松手即得到带直径的圆）
        const sn = snapPoint(wp);
        const at = sn || wp;
        gesture = { kind: 'draw-circle', a: at, b: at };
        st.preview = { kind: 'circle', a: at, b: at };
        break;
      }
      case 'freehand': {
        gesture = { kind: 'draw-free', pts: [[wp.x, wp.y]], last: wp };
        st.preview = { kind: 'free', pts: gesture.pts }; // 边画边看轨迹
        S.emit(st);
        break;
      }
    }
  }

  function onPointerMove(e) {
    const wp = worldOf(e);
    const sp = screenOf(e);

    // 吸附指示（绘制工具 & 拖动中）
    if (['point', 'segment', 'circle'].includes(st.tool) || (gesture && gesture.kind === 'drag')) {
      st.snap = snapPoint(wp, gesture?.ent?.id ?? null);
    } else st.snap = null;

    if (!gesture) {
      // hover（记下世界坐标：④ 交点角度悬停提示要用）
      st.hoverPt = { x: wp.x, y: wp.y };
      if (st.tool === 'select') {
        const hit = hitTest(wp, touchScale(e));
        const id = hit?.ent.id ?? null;
        if (id !== st.hover) { st.hover = id; S.emit(st); }
        canvas.style.cursor = hit ? 'move' : 'default';
      }
      return;
    }

    switch (gesture.kind) {
      case 'pan': {
        cam.panByScreen(e.clientX - gesture.lastX, e.clientY - gesture.lastY);
        gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        S.notifyCameraMoved();
        S.emit(st);
        break;
      }
      case 'box': {
        st.boxSelect = { x0: gesture.x0, y0: gesture.y0, x1: sp.x, y1: sp.y };
        S.emit(st);
        break;
      }
      case 'drag': {
        if (!gesture.canDrag) break;
        gesture.moved = true;
        const def = REGISTRY[gesture.ent.type];
        const sn = snapPoint(wp, gesture.ent.id);
        const cur = (gesture.part !== 'body' && sn) ? sn : wp;
        const d = { dx: wp.x - gesture.startW.x, dy: wp.y - gesture.startW.y };
        // 本次拖动真正改了哪些参数 —— 供约束求解器"钉住"。
        // 注意：必须在这里（能拿到 patch 的作用域）收集，早期版本把收集写在分支外，
        // 结果 pin 恒为空集，求解器把被拖的端点也当自由变量，于是水平/竖直约束的
        // 修正被平摊到两端 → 被抓住的端点追不上指针、另一端反向乱跑、线最后变歪。
        const movedParams = new Set();
        if (gesture.group) {
          // 整组平移（保持相对位置）
          for (const item of gesture.group) {
            const gdef = REGISTRY[item.ent.type];
            const gp = gdef.translate ? gdef.translate(item.start, d.dx, d.dy) : null;
            if (gp) { Object.assign(item.ent.params, gp); for (const k of Object.keys(gp)) movedParams.add(`${item.ent.id}:${k}`); }
            else if (item.startPts) item.ent.pts = item.startPts.map(([x, y]) => [x + d.dx, y + d.dy]);
          }
        } else if (gesture.part === 'body' && def.drag.translatePts) {
          gesture.ent.pts = gesture.startPts.map(([x, y]) => [x + d.dx, y + d.dy]);
        } else {
          const fn = gesture.dragFn || dragHandler(def, gesture.part, gesture.ent);
          if (fn) {
            const patch = fn(gesture.start, cur, gesture.startW, d, { st, env: envOf(), ent: gesture.ent, cam }) || {};
            const applied = {};
            let sprang = null;

            // ① 别名反解：拖动改到了"被绑定的别名"依赖的底层参数时（例如拧一条
            //    「角度 ← a/9」的线段的端点），先把别名值算出来再反解上游。
            const aliasHandled = new Set();
            const aliasDefs = REGISTRY[gesture.ent.type]?.writeAliases || {};
            st.draggingEnt = gesture.ent.id;   // 拖动期间跳过别名写回（②b）
            st.dragActive = true;              // ★ 拖动进行中：所有角度别名都暂停写回（③）
            for (const [ak, ad] of Object.entries(aliasDefs)) {
              const bId = gesture.ent.bound?.[ak];
              if (!bId) continue;
              const keys = Object.keys(patch);
              const touched = (ad.deps || []).some((k) => k in patch)
                || (ad.depsRe && keys.some((k) => ad.depsRe.test(k)));
              if (!touched) continue;
              const merged = { ...gesture.ent.params, ...patch };
              const desired = ad.fromParams(merged, gesture.ent);
              if (!Number.isFinite(desired)) continue;
              const res = S.inverseSolve(st, st.bindings.get(bId), desired);
              if (res.ok) {
                if (!gesture.inverted) gesture.inverted = res;
                for (const k of keys) if (!ad.deps || ad.deps.includes(k) || (ad.depsRe && ad.depsRe.test(k))) aliasHandled.add(k);
              } else {
                // 不可反解 → 弹簧：底层参数照常跟手，别名写回那一帧被跳过，松手弹回
                for (const k of keys) if (!ad.deps || ad.deps.includes(k) || (ad.depsRe && ad.depsRe.test(k))) applied[k] = patch[k];
                sprang = { key: ak, value: desired, why: res.reason };
              }
            }

            // ② 普通参数：被绑定的尝试反解上游
            for (const [k, v] of Object.entries(patch)) {
              if (aliasHandled.has(k)) continue;
              const bId = gesture.ent.bound?.[k];
              if (!bId) { applied[k] = v; continue; }
              const res = S.inverseSolve(st, st.bindings.get(bId), v);
              if (res.ok) {
                if (!gesture.inverted) gesture.inverted = res;
              } else {
                applied[k] = v; // 先跟着指针（弹簧感），松手会弹回
                sprang = { key: k, value: v, why: res.reason };
              }
            }
            Object.assign(gesture.ent.params, applied);
            for (const k of Object.keys(applied)) movedParams.add(`${gesture.ent.id}:${k}`);
            st.spring = sprang ? { entId: gesture.ent.id, key: sprang.key, value: sprang.value } : null;
            gesture.sprang = sprang;
          }
        }
        S.ensureEvaluated(st, { solve: true, pin: movedParams });
        S.emit(st);
        break;
      }
      case 'draw-seg':
      case 'draw-circle': {
        const sn = snapPoint(wp);
        gesture.b = sn || wp;
        st.preview = { kind: gesture.kind === 'draw-seg' ? 'seg' : 'circle', a: gesture.a, b: gesture.b };
        S.emit(st);
        break;
      }
      case 'draw-angle': {
        const onB = hitTest(wp, touchScale(e));
        const lb = onB ? lineLikeOf(onB.ent, envOf()) : null;
        gesture.b = (lb && onB.ent.id !== gesture.a) ? onB.ent.id : null;
        st.preview = { kind: 'angle', a: gesture.aPt, b: wp, ok: !!gesture.b };
        S.emit(st);
        break;
      }
      case 'draw-free': {
        if (dist(wp.x, wp.y, gesture.last.x, gesture.last.y) > 3 / cam.z) {
          gesture.pts.push([wp.x, wp.y]);
          gesture.last = wp;
          st.preview = { kind: 'free', pts: gesture.pts }; // 轨迹实时增长
          S.emit(st);
        }
        break;
      }
    }
  }

  function onPointerUp(e) {
    activePointers = Math.max(0, activePointers - 1);
    if (!gesture) { canvas.classList.remove('panning'); return; }
    const wp = worldOf(e);
    switch (gesture.kind) {
      case 'pan':
        canvas.classList.remove('panning');
        break;
      case 'box': {
        const box = st.boxSelect;
        st.boxSelect = null;
        if (box && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 6) {
          // 注意：屏幕 y 向下、世界 y 向上，取出四角后必须重新归一化，否则 y 区间恒为空
          const c0 = cam.s2w(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
          const c1 = cam.s2w(Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
          const wx0 = Math.min(c0.x, c1.x), wx1 = Math.max(c0.x, c1.x);
          const wy0 = Math.min(c0.y, c1.y), wy1 = Math.max(c0.y, c1.y);
          if (!gesture.additive) st.selection.clear();
          for (const ent of st.entities.values()) {
            const def = REGISTRY[ent.type];
            const fs = def.features(S.V(st, ent), ent, envOf());
            if (fs.some(([fx, fy]) => fx >= wx0 && fx <= wx1 && fy >= wy0 && fy <= wy1)) st.selection.add(ent.id);
          }
          S.emit(st, 'selection');
        } else if (!gesture.additive) {
          st.selection.clear();
          S.emit(st, 'selection');
        }
        break;
      }
      case 'draw-seg': {
        st.preview = null;
        const [pa, pb] = [cam.w2s(gesture.a.x, gesture.a.y), cam.w2s(gesture.b.x, gesture.b.y)];
        const dragPx = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        if (dragPx >= 4) {
          const ent = S.addEntity(st, 'segment',
            { x1: gesture.a.x, y1: gesture.a.y, x2: gesture.b.x, y2: gesture.b.y });
          st.selection = new Set([ent.id]);
          // 画完这一笔就检查是否围成了封闭图形 → 自动组合为一个整体
          const group = S.detectClosedShape(st, ent.id, 12 / cam.z);
          if (group) {
            st.selection = new Set([group.polygon.id]);
            hooks.hint?.(`✦ 已自动组合为${group.name}（${group.sides} 条边）：拖顶点改形状，拖边整体移动`);
          }
          S.emit(st, 'selection');
          afterDraw();
        }
        break;
      }
      case 'draw-circle': {
        st.preview = null;
        const A = cam.w2s(gesture.a.x, gesture.a.y), B = cam.w2s(gesture.b.x, gesture.b.y);
        const rPx = Math.hypot(A[0] - B[0], A[1] - B[1]);
        if (rPx >= 4) {
          const ent = S.addEntity(st, 'circle',
            { cx: gesture.a.x, cy: gesture.a.y, r: Math.max(0.02, dist(gesture.a.x, gesture.a.y, gesture.b.x, gesture.b.y)) });
          st.selection = new Set([ent.id]);
          S.emit(st, 'selection');
          afterDraw();
        }
        break;
      }
      case 'draw-angle': {
        st.preview = null;
        const aId = gesture.a, bId = gesture.b;
        if (!bId) {
          hooks.hint?.('✦ 松开的位置不在另一条线上——角度要两条相交的线（线段/圆的直径/切线/割线）');
          break;
        }
        const J = S.addJoint(st, aId, bId);
        if (J.error) { hooks.hint?.(`⚠ ${J.error}`); break; }
        st.selection = new Set([J.entity.id]);
        hooks.hint?.(`✦ 角已量出 ${S.getDerived(st, J.entity, 'deg').toFixed(1)}° —— 它是个实体：可以被别的量引用，也可以在属性页把「夹角°」关联给变量，让 B 线绕交点转起来`);
        S.emit(st, 'selection');
        afterDraw();
        break;
      }
      case 'drag': {
        S.endGesture(st, gesture.moved);
        st.spring = null;
        st.draggingEnt = null;
        // ★ 松手：恢复别名写回之前，先做一次"角度自检 + 反解" —— 把手动转出来的
        //   角度反解到上游变量（拖圆上的点带动线段转 → 变量跟着动）。
        st.dragActive = false;
        try {
          const synced = S.syncAngleBindings(st);
          if (synced.length) {
            const s0 = synced[0];
            hooks.hint?.(`✦ 你手动转了角度：已把它反解回「${s0.name || '上游变量'}」（${s0.deg.toFixed(1)}°）`);
          }
        } catch (err) {
          // 自检反解只是"锦上添花"，绝不能因为它让拖动收不了尾（点会粘在指针上）
          console.warn('syncAngleBindings failed:', err);
        }
        if (gesture.moved) {
          if (gesture.sprang) {
            const bId = gesture.ent.bound?.[gesture.sprang.key];
            const b = bId ? st.bindings.get(bId) : null;
            hooks.hint?.(`✦ 这个参数正由「${b?.src || '上游'}」驱动，拖不动它 —— 改上游的值（或拖它的滑杆）试试`);
          } else if (gesture.inverted) {
            hooks.hint?.('✦ 你拖的是被驱动的参数：上游已经跟着变了（这就是反向求解）');
          }
          S.emit(st, 'structure');
        }
        break;
      }
      case 'draw-free': {
        st.preview = null;
        if (gesture.pts.length > 1) {
          const ent = S.addEntity(st, 'freehand', {}, { pts: gesture.pts });
          st.selection = new Set([ent.id]);
          S.emit(st, 'selection');
          // 一次绘制完成后回到鼠标模式
          afterDraw();
        }
        break;
      }
    }
    gesture = null;
    st.snap = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const sp = screenOf(e);
    cam.zoomAt(sp.x, sp.y, Math.exp(-e.deltaY * 0.0012));
    S.notifyCameraMoved();
    S.emit(st);
  }

  function cancelPending() {
    gesture = null;
    st.preview = null;
    st.snap = null;
    S.emit(st);
  }

  // 绘制预览（拖动式：按住时实时显示将要生成的图形）
  function drawToolPreview(g, cam2) {
    const pv = st.preview;
    if (!pv) return;
    g.save();
    if (pv.kind === 'free') {
      // 自由绘制：边画边显示轨迹（用最终线型，不是虚线）
      const pts = pv.pts || [];
      if (pts.length > 1) {
        g.strokeStyle = '#5E5CE6';
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.beginPath();
        const p0 = cam2.w2s(pts[0][0], pts[0][1]);
        g.moveTo(p0[0], p0[1]);
        for (let i = 1; i < pts.length; i++) {
          const p = cam2.w2s(pts[i][0], pts[i][1]);
          g.lineTo(p[0], p[1]);
        }
        g.stroke();
      }
      g.restore();
      return;
    }
    if (pv.kind === 'angle') {
      // 角度工具：从起点拉一条指示线，落到第二条线上时高亮（绿=可建）
      const a = cam2.w2s(pv.a.x, pv.a.y), b = cam2.w2s(pv.b.x, pv.b.y);
      g.setLineDash([4, 4]);
      g.strokeStyle = pv.ok ? 'rgba(48,209,88,0.9)' : 'rgba(94,92,230,0.7)';
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(a[0], a[1], 4, 0, 7); g.fillStyle = g.strokeStyle; g.fill();
      if (pv.ok) { g.beginPath(); g.arc(b[0], b[1], 7, 0, 7); g.stroke(); }
      g.restore();
      return;
    }
    g.setLineDash([5, 5]);
    g.strokeStyle = 'rgba(94,92,230,0.75)';
    g.lineWidth = 1.6;
    const a = cam2.w2s(pv.a.x, pv.a.y), b = cam2.w2s(pv.b.x, pv.b.y);
    if (pv.kind === 'seg') {
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      // 实时长度，方便拖到想要的尺寸
      g.setLineDash([]);
      g.fillStyle = 'rgba(94,92,230,0.9)';
      g.font = '11px ui-monospace, monospace';
      g.fillText(dist(pv.a.x, pv.a.y, pv.b.x, pv.b.y).toFixed(2), (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2 - 6);
    } else {
      const r = dist(pv.a.x, pv.a.y, pv.b.x, pv.b.y) * cam2.z;
      g.beginPath(); g.arc(a[0], a[1], r, 0, 7); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(94,92,230,0.9)';
      g.font = '11px ui-monospace, monospace';
      g.fillText(`r = ${dist(pv.a.x, pv.a.y, pv.b.x, pv.b.y).toFixed(2)}`, b[0] + 8, b[1] - 8);
    }
    g.restore();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', (e) => { st._cursorW = worldOf(e); onPointerMove(e); });
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { spaceDown = true; canvas.classList.add('pan'); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; canvas.classList.remove('pan', 'panning'); }
  });

  return { setTool, cancelPending, drawToolPreview, snapPoint, hitTest };
}
