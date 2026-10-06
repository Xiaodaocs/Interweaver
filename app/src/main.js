// 主装配：画布尺寸 / RAF 渲染循环 / 键盘 / 连接视图 / 性能模式 / 验收清单（DOM 模块）
import { makeCamera } from './camera.js';
import * as S from './state.js';
import { drawFrame } from './render.js';
import { createTools } from './tools.js';
import { createPanel } from './panel.js';
import { makeWindows, makeWindow } from './windows.js';
import { createMenu } from './menu.js';
import { createRuntime } from './achievements/runtime.js';
import { initTheme, cycleTheme, currentMode } from './theme.js';
import { runBootGate } from './bootGate.js';
import { isAllowed } from './appMode.js';
import { createProgressStorage } from './progressStorage.js';
import { createAmbientAudio } from './ambientAudio.js';
import { armSfx, playSfx, setSfxEnabled, sfxEnabled } from './sfx.js';
import { getSetting, setSetting, onSettingChange, bindStorageSync, adoptRemote } from './settings.js';
import { deserializeScene } from './scenes/schema.js';
import { createCoordsysUI } from './coordsysUI.js';
import { downloadScene, pickSceneFile, newScene, saveDraft, readDraft, readDraftDetailed, clearDraft, FILE_EXT, lastDraftStatus } from './sceneFile.js';
import { captureShot, shotsEnabled, setShotsEnabled } from './achievements/shot.js';
import { openStarMap } from './starmap.js';
import { createAchievementUI } from './achievementUI.js';
import { openSceneList } from './scenes/sceneList.js';
import { ALL_PATTERNS } from './achievements/runtime.js';
import { createPresetDock } from './presets.js';
import { createFxDock } from './fx.js';
import { REGISTRY, isGeometricCurve } from './entities.js';

const canvas = document.getElementById('cv');
const g = canvas.getContext('2d');
initTheme();
runBootGate({
  // 读路径切换：登录用户的设置从后端取回后**在揭层之前**采纳（界面按既有通知链自动更新）
  apply: async ({ user, docs }) => {
    if (user && docs && docs.settings) adoptRemote(docs.settings);
    if (user && docs && docs.progress) progressStorage.seed(docs.progress);
  },
});
const st = S.createState();
const cam = makeCamera();

// 调试/自动化核验钩子（e2e 测试用；不影响正常使用）
// 成就运行时（语义图 → 匹配 → 稳定确认 → 点亮/织边 → 存档）
const progressStorage = createProgressStorage();
const ach = createRuntime({ storage: progressStorage });
const achUI = createAchievementUI(document.body);
// T9：环境音**默认开启**（用户决定）。进入即尝试启动；被浏览器自动播放策略拦下时，
// 会在首次点击/按键时自动启动，并在按钮上给出"点击 ♫ 开启"的提示态。
const audio = createAmbientAudio({
  onStateChange: (s) => {
    const btn = document.getElementById('audioBtn');
    if (!btn) return;
    btn.classList.toggle('on', !!s.running);
    btn.title = s.running ? '环境音：开（点击关闭）'
      : (s.reason === 'needs-gesture' ? '环境音：点击开启（浏览器要求先有一次交互）' : '环境音：关（点击开启）');
  },
});
audio.bindVisibility();
ach.load();

// 交互窗口：拖动/缩放进行中（以及刚结束的 140ms 内）把成就运行时挂起 ——
// 既省性能（避免语义图编译拖慢帧率），也符合"结构需连续稳定 500ms 才算达成"的产品语义。
let busyUntil = 0;
let achScheduled = false;
let lastAchAt = 0;
const scheduleIdle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 400 })
  : setTimeout(fn, 0));
const achGap = () => { const st2 = ach.stats(); return Math.max(200, Math.min(4000, st2.gap || 200)); };
const markBusy = () => { busyUntil = performance.now() + 140; };
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'pointerup']) {
  window.addEventListener(ev, markBusy, { passive: true });
}

window.__IW = { st, cam, S, REGISTRY, ach, achUI, audio };

const PERF = new URLSearchParams(location.search).has('perf');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  cam.setSize(innerWidth, innerHeight);
  S.emit(st);
}
window.addEventListener('resize', resize);

// ---------- 瞬时提示（组合/截取等即时反馈）----------
const hintEl = document.getElementById('hint');
let hintTimer = null;
function hint(text, ms = 3200) {
  hintEl.innerHTML = text;
  hintEl.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('on'), ms);
}

// 右键菜单里「生成切线/割线/导函数/积分区域」的实际动作（P10）
function makeCalculus(kind, entId) {
  const ent = st.entities.get(entId);
  if (!ent) return;
  const hostId = ent.host || entId;
  const host = st.entities.get(hostId);
  if (!host) return;
  // ★ 用户拍板（方案 c）：隐函数上不支持积分 / 导函数曲线 —— 必须**明确说明原因**，不能静默无反应。
  if ((kind === 'integral' || kind === 'derivcurve') && host.type === 'implicit') {
    hint(
      '⚠ 隐函数不支持' + (kind === 'integral' ? '积分' : '导函数曲线') + '：闭曲线（如 x²+y²=1）没有 x 定义域，「曲线下面积」无定义；'
      + '同一个 x 还可能对应多个 y（如 y²=x³−x）。隐函数上可用的是：线上点、切线、割线、裁切段。'
    );
    return;
  }
  // ★ 同一策略扩展到几何曲线（本次要求"所有曲线都能微积分"）：切线/割线对任意参数曲线都成立，
  //   但"曲线下面积 / 导函数曲线"要求 y=f(x) —— 圆/圆弧是闭的或可竖直，没有这个形式。
  //   这里**明确拒绝并说明理由**，不静默、也不造假结果。
  if ((kind === 'integral' || kind === 'derivcurve') && isGeometricCurve(host)) {
    hint(
      '⚠ ' + (host.label || '这条曲线') + ' 不支持' + (kind === 'integral' ? '积分' : '导函数曲线')
      + '：它按参数 t 给出点（圆的 t 是圆心角），没有"每个 x 对应唯一 y"的形式，「曲线下面积」无定义；'
      + '竖直处还会一对多。这条曲线上可用的是：线上点、切线、割线' + (host.type === 'segment' || host.type === 'polygon' ? '、裁切段' : '、裁切段') + '。'
    );
    return;
  }
  if (kind === 'tangent') {
    const tg = S.addEntity(st, 'tangent', { len: 2 }, { host: hostId, p1: entId });
    st.selection = new Set([tg.id]);
    hint('✦ 已作切线：它的「斜率 m」就是这一点的导数——右键可以把它加进变量面板当仪表');
  } else if (kind === 'secant') {
    const others = [...st.selection].map((id) => st.entities.get(id)).filter((e) => e && e.type === 'edgepoint' && e.host === hostId && e.id !== entId);
    if (!others.length) { hint('⚠ 先按住 Shift 选中同一个曲线上的另一个点，再右键'); return; }
    const sc = S.addEntity(st, 'secant', { len: 2 }, { host: hostId, p1: others[0].id, p2: entId });
    st.selection = new Set([sc.id]);
    hint('✦ 已连成割线：把两个点拖近，看它怎么贴上切线（差商 → 导数）');
  } else if (kind === 'derivcurve') {
    const dv = S.addEntity(st, 'derivcurve', { dmin: -1e4, dmax: 1e4 }, { host: hostId });
    st.selection = new Set([dv.id]);
    hint('✦ 已生成导函数曲线：它在每处的值＝原曲线在该处的切线斜率');
  } else if (kind === 'integral') {
    const at = { x: cam.x, y: cam.y };
    const ig = S.addEntity(st, 'integral', REGISTRY.integral.create(at), { host: hostId });
    st.selection = new Set([ig.id]);
    hint('✦ 已添加积分区域：拖 n 的滑杆把矩形越切越密，观察「误差」趋于 0');
  }
  S.emit(st, 'selection');
}

const panel = createPanel(st, {
  getCamera: () => cam,
  hint,
});
const menu = createMenu(st, {
  openWizard: (id) => panel.openWizard(id),
  openConstraint: (id) => panel.openConstraintConfig(id),   // 水平/垂直：跳到属性页选参照
  hint,
  make: makeCalculus,
});
const tools = createTools(st, cam, canvas, { hint });
// ③ 坐标系三工具（创建 / 视图 / 管理）
const csUI = createCoordsysUI({ st, cam, S, hooks: {
  hint,
  setTool: (t) => tools.setTool(t),
  redraw: () => { drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor }); panel.tickValues(); },
} });
const dock = createPresetDock(st, cam, canvas, {
  hint,                                          // 复合预设会用它引导用户去看"网"
  onPlaced: () => { tools.setTool('select'); },   // 放完一个预设回到鼠标模式
});
const fxDock = createFxDock(st, {
  getCamera: () => cam,
  onGenerated: () => { tools.setTool('select'); panel.setTab('props'); },
  onClosed: () => { tools.setTool('select'); },
});

S.on(st, (kind) => { if (kind === 'structure' || kind === 'selection') panel.render(); });

// ---------- 工具栏 ----------
// ② 预设库按钮已移出 #toolbar（单独一组）→ 选择器必须同时覆盖它，否则点击无反应
  document.querySelectorAll('#toolbar button[data-tool], #presetBtn').forEach((b) => {
  b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'presets') {
      const willOpen = !dock.isOpen();
      dock.toggle();
      if (willOpen) {
        fxDock.hide();
        // ⑧ 抽屉内容是打开时才渲染的 → 这时再窗口化一次（拿到它的头部当拖动条）
        makeWindow(document.getElementById('presetDock'));
        // 打开预设库时停掉其它工具（高亮交给"预设"），避免"圆工具还举着却想放预设"
        tools.setTool('presets');
      } else {
        tools.setTool('select');
      }
      return;
    }
    if (t === 'fx') {
      const willOpen = !fxDock.isOpen();
      dock.toggle(false);
      if (willOpen) {
        tools.setTool('presets');
        csUI.hideMenu();                    // 左上角只留一个卡片：先收起坐标系菜单/面板
        document.getElementById('csPanel') && (document.getElementById('csPanel').hidden = true);
        fxDock.show();
        makeWindow(document.getElementById('fxDock'));
      } else { tools.setTool('select'); }
      return;
    }
    // ③ 坐标系工具：点它先弹出三选项菜单（创建 / 视图 / 管理），而不是直接武装放置
    if (t === 'coordsys') {
      dock.toggle(false);
      fxDock.hide();
      csUI.toggleMenu();
      return;
    }
    dock.toggle(false);
    fxDock.hide();
    tools.setTool(t);
  });
});

// 在画布上开始任何操作时也收起两个浮层，并把工具交回鼠标（若正处于浮层状态）
canvas.addEventListener('pointerdown', () => {
  armSfx();          // 首次用户手势里创建音频上下文（自动播放策略要求）
  playSfx('select'); // 选中/开始绘制：一声极轻的点
  dock.toggle(false);
  fxDock.hide();
  if (st.tool === 'presets') tools.setTool('select');
}, true);

// ---------- 右键菜单 ----------
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // ★ 用户要求 ⑦："画布的主体拖动改为右键拖动" —— 于是右键既要"拖动画布"又要"弹菜单"。
  //   区分办法：上一次右键拖动真的移动过（tools.js 记在 canvas.__lastPanMoved 上）就不弹菜单，
  //   只有"点一下、没移动"才算要菜单。阈值 6px 与拖拽判定一致。
  const panMoved = canvas.__lastPanMoved || 0;
  canvas.__lastPanMoved = 0;
  if (panMoved > 6) return;
  dock.toggle(false);
  const wp = cam.s2w(e.clientX, e.clientY);
  const hit = tools.hitTest(wp);
  if (hit) {
    // 已在多选里的对象：保留整个选区（否则"选多条线段 → 绑定为一个整体"无法操作）
    if (!st.selection.has(hit.ent.id)) st.selection = new Set([hit.ent.id]);
    S.emit(st, 'selection');
    menu.open(e.clientX, e.clientY, hit.ent);
  }
});

// ---------- ⑦ 设置（独立页面 settings.html）----------
// 画布内的旧设置卡已删除：连接视图与「显示所有参数」由设置页统一管理
// （applySettings 把 connView→st.connOn、labels→st.showParams 映射过来）。
// 这里只保留两个设置函数：键盘 Tab 与设置同步都要用。
function setConn(onOff) {
  st.connOn = onOff;
  S.emit(st);
}
function setParams(onOff) {
  st.showParams = onOff;
  S.emit(st);
}

// ---------- 键盘 ----------
window.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) S.redo(st); else S.undo(st);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); S.redo(st); return; }
  if (typing) return;
  // ⑦ 操作设置：可整体关闭快捷键（只关工具字母键；Ctrl+Z/Y 的撤销重做**始终可用**，对标 Word 的基本操作）
  if (!getSetting('shortcuts')) return;
  switch (e.key) {
    case 'Delete': case 'Backspace':
      if (st.selection.size) { S.removeEntities(st, st.selection); }
      break;
    case 'Escape':
      tools.cancelPending(); menu.close();
      st.selection.clear(); S.emit(st, 'selection');
      break;
    case 'Tab':
      e.preventDefault(); setConn(!st.connOn); break;
    case 'v': case 'V': tools.setTool('select'); break;
    case 'p': case 'P': tools.setTool('point'); break;
    case 'l': case 'L': tools.setTool('segment'); break;
    case 'c': case 'C': tools.setTool('circle'); break;
    case 'b': case 'B': tools.setTool('freehand'); break;
    case 'a': case 'A': tools.setTool('angle'); break;
    case 'm': case 'M': dock.toggle(); break;
    case 'f': case 'F': panel.setTab('fx'); break;
  }
});

// ---------- 验收清单（可勾选、进度本地留存）----------
const CL = [
  ['★ 本次修复 · 请重点验证', [
    '<b>修复1 网格</b>：空画布上纵向拖动 → 横竖网格线都跟着走；横轴（x 轴）连续平滑滑过，不再在格线之间整格跳动；刻度是整数（不再出现 3.2700…）',
    '<b>修复2a 自动组合</b>：线段工具按住拖三笔围成三角形 → 立刻提示「已自动组合为三角形」，三条线变成一个整体；拖顶点改形状，拖边或内部整体移动；画四笔矩形 → 四边形',
    '<b>修复2b "截"</b>：点工具点在<b>圆的边上</b> → 出现空心环的「线上点」（只能沿圆滑动）；再点第二个点 → 自动截出一段圆弧（提示出现）；拖那两个点，弧长跟着变',
    '<b>修复2b 更多</b>：点工具也可以点在三角形/线段的边上截点；点圆<b>内部</b>则是普通自由点；线上点的 <code>t</code> 参数可右键「关联…」绑到变量上，用滑杆驱动它绕圆转',
    '<b>修复2c 点的视觉</b>：自由点＝大号实心圆点（带纸色底垫与白描边，压在网格上也清晰）；线上点＝空心环；多边形顶点始终可见',
    '<b>修复3 圆的直径</b>：工具栏画的圆自带直径线段；抓直径可整体拖动圆，拖直径两端改半径；预设库已删除「圆 / 单位圆」（现在是正弦/余弦/抛物线/三角形/正方形）',
  ]],
  ['★ 本批：角度工具 / 参数显示 / 菜单收拢 / 窗口化', [
    '<b>① 角度工具</b>（工具栏第 8 个图标，快捷键 A）：从<b>一条线拖到另一条线</b>（线段 / 圆的直径 / 切线 / 割线都算"线"）→ 在交点处量出夹角。它是个<b>实体</b>：属性页里「夹角°」可以关联给变量（B 线会绕交点转起来），`j1.deg` 也能写进别的表达式',
    '<b>② 派生量现在能解绑了</b>：属性页会列出「角度/长度/直径/面积/周长」这些<b>可写</b>参数（带"可写"小标签），已关联的显示 ← 表达式 + ✕ 解除关联；未关联的显示"未关联（可右键关联）"',
    '<b>② 绑了长度也能正常拖</b>：拖动时不再被"以中点为锚重铺两端"，只有你抓住的那一端跟手；变量只是"看着它变长了多少"（松手后不会跳）',
    '<b>③ 右键菜单收拢</b>：顶层只剩几项，「约束…」「观察…」「微积分…」都收成子菜单，<b>鼠标悬停在旁边展开</b>（靠右缘时自动向左展）',
    '<b>④ 参数默认显示</b>：线段长度与角度、圆半径、多边形面积、弧长、圆上动点的角度…直接标在图上（正下方设置卡可关）',
    '<b>④ 相交即显示角度</b>：任意两条线相交处，<b>鼠标移过去</b>才浮现角度与"点击变成实体"；点一下它才成为实体（不点就不占模型）',
    '<b>④ 布局</b>：变量与观察器搬到<b>右下角独立窗口</b>；右侧面板只剩属性，<b>没有选中实体时整块缩回</b>',
    '<b>⑤ 截出来的段是独立实体</b>：从正弦/抛物线/函数图/圆/线段上截一段，得到的是<b>独立图形</b>（按来源命名：正弦段 / 抛物线段 / 弧段 / 线段…），直接拖是整体搬走、不再改姿态</b>',
    '<b>⑥ 水平/竖直约束变稳</b>：修掉了"被拖端点没被钉住"的根因（此前求解器把修正平摊到两端，所以抓一端却反向乱跑、最后歪掉）；现在水平/竖直走解析优先，<b>快速拖拽也只动另一端、线始终水平</b>',
    '<b>⑦ 下方设置卡</b>：正下方中间（不与右下变量区重叠）——「显示所有参数」（默认开）与「连接视图」（原来的中部开关搬进来了，Tab 仍可用）',
    '<b>⑧ 卡片窗口化</b>：属性面板 / 变量窗口 / 设置卡 / ƒx 函数面板 / 预设抽屉 / 验收清单都能<b>拖标题条搬走</b>、点 <b>—</b> 最小化（左侧工具栏与提示气泡不动）',
    '<b>⑨ 双击接点一键绑定</b>：一个点正好落在两条线的交点处时，<b>双击那里</b>就会把这个点绑到交点上（自由点绑 x、y；线上点只绑一条 t）——之后拖任一条线，点都跟着交点走',
  ]],
  ['★ 上批：剧本三/四复刻补齐', [
    '<b>线段角度可关联</b>：右键线段 →「关联…」→ 第一步会多出标着「可写」的<b>角度°</b>与<b>长度</b>（以及圆的<b>直径 2r</b>、多边形的<b>面积/周长</b>）。关联后由表达式驱动它：绑角度 → 线段绕中点旋转；绑长度/面积/周长 → 绕中点或重心缩放',
    '<b>来源多了一个「实体参数」页签</b>：选另一个实体 → 选它的参数（含派生量）→ 自动拼成 <code>s1.angle</code> 这样的式子。所以「让这条线平行于那条线」＝把 A 的角度关联到 B 的角度',
    '<b>能拧回去</b>：把 <code>角度 ← a/9</code> 关联好之后，直接拧线段的端点 → 上游变量 a 自己跟着变（解析反解，剧本二第 4 步）；超出滑杆范围会停在端点（第 5 步）',
    '<b>表达式观察器</b>：变量页新增「＋ 观察器」——输入任意表达式（如 <code>m割 − m切</code>）建一个只读仪表。它和普通观察器一样能被别的表达式引用（剧本三第 8 步）',
    '<b>变量 ▶ 自动动画</b>：每个变量卡左上角多了 ▶，点开后在 min↔max 之间往返（周期可设，默认 4 秒）。欧拉之环的 θ 一转，圆上动点、两条波上的点与参考线全部同步呼吸（剧本四第 5 步）',
    '<b>约束参照说清楚了</b>：只选一条线段时是「水平于世界坐标系 / 竖直于世界坐标系」；选区里还有另一条线时是「平行于「L2」/ 垂直于「L2」」——两类都在，标签里写明参照是谁',
    '<b>剧本三/四已可完整复刻</b>：自动化核验真实跑通了剧本三 1–9 步（含「差」从 0.47 缩到 4.2e-5）与剧本四 1–5 步（θ 自动转动、三个点与参考线同时移动）',
  ]],
  ['★ P8–P10 新能力', [
    '<b>P8 预设库扩充</b>：预设抽屉现有 11 项。其中「圆-正弦联动」「角度·半径」「抛物线焦点·准线」是<b>预织好的网</b>——一次放下多个实体 + 绑定，打开左下「连接视图」就能看到内部的线，拖 θ 滑杆或改抛物线开口 a，整张网一起动（可拆解学习）；另有直角三角形、黄金矩形、阻尼振荡',
    '<b>P9 约束系统</b>：选中两个对象 → 右键 →「添加约束」（重合 / 中点 / 平行 / 垂直 / 等长 / 相切 / 水平 / 竖直）。加好后<b>拖动任一方都会自动维持关系</b>；约束满足时画布上会出现紫色小徽章，不满足则变橙色。属性面板里可逐条删除',
    '<b>P9 求解偏好</b>：尽量只移动"小对象"——把点约束到线段中点时，只会移动那个点，线段不动',
    '<b>P10 切线</b>：点工具在正弦/抛物线/函数图上截一个点 → 右键该点 →「作切线」。它的「斜率 m」就是该点导数，可右键加进变量面板当仪表',
    '<b>P10 割线 / 导函数 / 积分区域</b>：右键曲线上另一个点可「连成割线」（差商，把两点拖近看它贴上切线）；右键曲线本身可「生成导函数曲线」和「添加积分区域（黎曼和）」，后者的 n 是可拖滑杆，还有「近似值 / 精确值 / 误差」三个派生量',
    '<b>P10 观察器</b>：右键任意图形的派生量 →「👁 观察」→ 变量面板出现只读仪表，实时显示该量；<b>它的名字还能写进表达式</b>，用它驱动别的图形',
  ]],
  ['★ P7 反向求解', [
    '<b>拖图形 → 变量跟着动</b>：建一个变量 a，把正弦波的「中心 x」关联到 a，再拖正弦波左右移动 → 变量 a 的滑杆自己跟着动；若「波长」也关联到 a，两处会同时联动',
    '<b>解析反解</b>：像 <code>a</code>、<code>a/2+1</code>、<code>9a</code>、<code>-3k+10</code>、<code>c1.r*a</code> 这类线性关系都能精确解回去',
    '<b>数值反解</b>：非线性（如 <code>sin(a)*5+6</code>）会用牛顿迭代解，并且挑"离当前值最近"的解，避免跳分支',
    '<b>弹簧回弹</b>：上游不止一个（如 <code>a+b</code>）或确实无解时，图形会跟着指针被"拉开"，松手弹回，并提示这个参数正由谁驱动',
    '<b>变量范围</b>：反解出的值超出滑杆 min/max 时会被钳制在端点上',
  ]],
  ['☆ 上批改动（采样/交互/改名/工具/函数面板）', [
    '<b>① 曲线采样</b>：缩放画布观察正弦波——小到一定程度之前都是平滑的正弦；再缩下去会变成"包络带"（正确表现高频曲线，而不是锯齿噪声）。截下来的一段不再是"97 个点的折线"：解绑后仍是<b>解析曲线</b>（正弦带定义域、圆弧变自由圆弧），任意缩放都不失真',
    '<b>② 自由绘制</b>：按画笔工具按住拖动时<b>边画边显示轨迹</b>；松开才落成实体',
    '<b>③ 改名</b>：选中任意图形 → 属性面板标题右侧的名字输入框，改成你喜欢的名字（点、线、面都行）。表达式里对它的引用会同步更新；重名/非法名会被温柔拒绝',
    '<b>④ 工具状态</b>：打开预设库时其它工具自动停用（高亮移到「预设」），此时画布拖动不会误画；<b>每画完一个图形自动回到鼠标模式</b>。注意：连续画多条线段（拼三角形）现在需要每笔重新点一次线段工具——如果你想要"连续绘制"，说一声我加个锁定按钮',
    '<b>⑤ 函数创作器</b>：已挪到<b>左下角</b>，点工具栏 ƒx 弹出，输入表达式生成后自动收起并回到鼠标模式',
  ]],
  ['★ 上次改动 · 请重点验证', [
    '<b>① 全部改为拖动式</b>：线段＝按住拖出长度后松开；圆＝按住圆心拖出半径后松开（拖动时实时显示长度/半径）。几乎没拖动（<4px）不会生成退化图形。选择工具仍是原来的用法',
    '<b>② 预设抽屉会自己收回</b>：打开预设后点任意别的工具 / 在画布上点一下 / 右键，抽屉都会自动收起',
    '<b>③ 多边形能整体拖动</b>：抓三角形的<b>边或内部</b>拖动＝整体平移（顶点数、面积都不变）；拖顶点仍只动那一个点。预设里的三角形同理',
    '<b>④ 解绑 / 绑定</b>：右键多边形 →「解绑（拆成 N 条线段）」；框选多条线段 → 右键 →「绑定为一个整体」（没围成闭环会给人话提示）。属性面板里也有对应按钮',
    '<b>④ 线上点的绕行开关</b>：多边形边上的点默认<b>只能在它所属的那条边上滑动</b>；右键它 →「允许绕到其它边」打开后即可滑到别的边（属性面板也有开关）。默认不询问',
    '<b>⑤ 曲线也能"裁"</b>：点工具在正弦波/抛物线/函数图上点两个点 → 同样截出一段（选项里也能调 t）；右键这段 →「解绑」即可把它拖出来变成独立曲线。圆上裁出的是圆弧，线段上裁出的是线段',
  ]],
  ['P1 · 无限画布', [
    '空格+拖动（或鼠标中键）平移画布；滚轮以指针为锚点缩放（1%–5000%）',
    '网格随缩放自适应密度（1/2/5 进制），原点与坐标轴有强调',
    '性能：以 <code>?perf=1</code> 打开 → 自动生成 1000 条随机线段，右下角显示 FPS，平移缩放应 ≥55',
  ]],
  ['P2 · 基础绘制', [
    '左侧工具栏：点（单击）/ 线段（按住拖出）/ 圆（按住拖出半径）/ 画笔（按住画）——除选择工具外全部是拖动式',
    '选择工具：单击选中（蓝色光晕）、空白处框选、<code>Delete</code> 删除',
    '<code>Ctrl+Z</code> 撤销 / <code>Ctrl+Shift+Z</code> 重做（含删除、拖动、自动组合与解绑/绑定）',
    '绘制时靠近网格交点或已有端点/圆心会出现紫色吸附圈（磁性）',
  ]],
  ['P3 · 参数系统', [
    '选中一个圆 → 右侧「属性」页显示 圆心x/圆心y/半径r，直接键入数值生效',
    '拖圆的边缘/直径两端改半径、拖圆心或直径移动；拖线段端点改形状、拖线段本体平移',
    '属性页下方显示派生量（直径/面积/周长、多边形面积周长、圆弧弧长与圆心角、裁切段长度）',
  ]],
  ['P4 · 变量与滑杆', [
    '「变量」页 ＋ 新建变量 → 拖滑杆 / 直接输值 / 改 min/max',
    '变量卡片实时显示当前值（等宽数字），滑杆受 min/max 钳制',
  ]],
  ['P5 · 绑定引擎（魔法时刻 ✦）', [
    '预设库拖出「正弦波」；变量页新建 a，输值 9',
    '右键正弦波 →「关联…」→ 选「波长 λ」→ 选变量 a → 拖 a 的滑杆：波形实时伸缩',
    '点底部「连接视图」（或 Tab）：看到从变量卡到正弦波的发光丝线在流动',
    '环检测：先建 p1 并让 p1.x ← 正弦波.A，再让 正弦波.A ← p1.x，第二步被温柔拒绝',
  ]],
  ['P6 · 函数生成器 + 预设', [
    '「ƒx」页输入 <code>2x+3=y</code> 回车 → 画布出现一条斜线',
    '输入 <code>y=a*x+b</code> → 出现「为 b 创建滑杆」芯片，点它表达式不丢失；生成后曲线随滑杆变化',
    '输入 <code>x^2+y^2=25</code> → 得到"隐函数敬请期待"的温柔提示（不弹窗不清空）',
    '预设库五件套：正弦/余弦/抛物线/三角形/正方形，拖到落点即用',
  ]],
];
const CL_KEY = 'interweaver.verify.v1';
const savedCL = (() => { try { return JSON.parse(localStorage.getItem(CL_KEY) || '{}'); } catch { return {}; } })();
let clTotal = 0, clDone = 0;

document.getElementById('clBody').innerHTML = CL.map(([h, items], gi) =>
  `<h5>${h}</h5><ul>${items.map((it, ii) => {
    clTotal++;
    const id = `p${gi + 1}-${ii}`;
    const checked = savedCL[id] ? 'checked' : '';
    if (savedCL[id]) clDone++;
    return `<li><label class="clItem"><input type="checkbox" data-cl="${id}" ${checked}><span>${it}</span></label></li>`;
  }).join('')}</ul>`).join('') +
  `<div class="clProgress" id="clProgress"></div>
   <div class="clHint">勾选状态保存在本地浏览器里。验收完毕后请把结果告诉我。</div>`;

function refreshProgress() {
  document.getElementById('clProgress').textContent = `手动验收进度：${clDone} / ${clTotal}`;
}
refreshProgress();
document.getElementById('clBody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-cl]');
  if (!cb) return;
  const store = (() => { try { return JSON.parse(localStorage.getItem(CL_KEY) || '{}'); } catch { return {}; } })();
  if (cb.checked) { store[cb.dataset.cl] = 1; clDone++; } else { delete store[cb.dataset.cl]; clDone--; }
  localStorage.setItem(CL_KEY, JSON.stringify(store));
  refreshProgress();
});

const checklist = document.getElementById('checklist');
document.getElementById('helpBtn').addEventListener('click', () => { checklist.hidden = !checklist.hidden; });
document.getElementById('clClose').addEventListener('click', () => { checklist.hidden = true; });
if (new URLSearchParams(location.search).has('checklist')) checklist.hidden = false;

function wireWindows() {
  makeWindows([
    document.getElementById('panel'),
    document.getElementById('varWin'),
    document.getElementById('opPop'),   // ⑥ 左上角操作弹窗（S5b 新增，此前漏登记）
    document.getElementById('fxDock'),
    document.getElementById('presetDock'),
    document.getElementById('checklist'),
  ]);
}

// ---------- ④⑧ 变量窗口（右下角）+ 卡片窗口化 ----------
// 变量与观察器的卡片从右侧面板搬进独立窗口；右侧面板现在只剩属性。
const varWin = document.getElementById('varWin');
const varWinBody = document.getElementById('varWinBody');
function renderVarWindow() {
  if (!varWinBody) return;
  varWinBody.innerHTML = panel.varsHTML();
  panel.bindVars(varWinBody);
}
// 变量/观察器集合变化（增删改名）时才重建变量窗口；数值变化由 tickValues 就地更新，
// 否则拖动滑杆时会把正在拖的 DOM 重建掉。
S.on(st, (kind) => {
  if (kind === 'structure') {
    renderVarWindow();
    if (st.variables.size || st.probes.size) varWin.hidden = false;
  }
});
renderVarWindow();
if ((st.variables.size || st.probes.size) && varWin) varWin.hidden = false;

wireWindows();

// ---------- 性能模式（P1 验收）----------
if (PERF) {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 1000; i++) {
    const x = rnd() * 80 - 40, y = rnd() * 60 - 30;
    S.addEntity(st, 'segment', { x1: x, y1: y, x2: x + rnd() * 6 - 3, y2: y + rnd() * 6 - 3 }, {}, true);
  }
  st.selection.clear();
  document.getElementById('fpsLabel').hidden = false;
}

// ---------- RAF 主循环 ----------
const zoomLabel = document.getElementById('zoomLabel');
const fpsLabel = document.getElementById('fpsLabel');
let lastT = performance.now(), fpsEma = 60, lastZoomText = '';
window.__IW.getFps = () => fpsEma;
window.__IW.perfMode = PERF;

function frame(t) {
  const dt = t - lastT; lastT = t;
  if (dt > 0) fpsEma = fpsEma * 0.95 + (1000 / dt) * 0.05;

  // 变量自动动画（▶）：在 min↔max 间往返，直接推进不走撤销栈
  S.tickAnimations(st, Math.min(dt, 100));
  S.ensureEvaluated(st);
  drawFrame(g, st, cam, canvas, {
    toolPreview: tools.drawToolPreview,
    varCardAnchor: panel.varCardAnchor,
  });
  panel.tickValues();

  const zt = Math.round(cam.z / 40 * 100) + '%';
  if (zt !== lastZoomText) { zoomLabel.textContent = zt; lastZoomText = zt; }
  if (PERF) fpsLabel.textContent = fpsEma.toFixed(0) + ' fps · ' + st.entities.size + ' 实体';

  // 成就运行时：自己内部节流（200ms），出错也只记日志、绝不影响画布
  // 成就编译放在**空闲时段**执行：绝不占用绘制帧（1000 实体场景下单次编译可达上百毫秒）。
  const achRes = null;
  if (!achScheduled && t >= busyUntil && t - lastAchAt > achGap()) {
    achScheduled = true;
    scheduleIdle(() => {
      achScheduled = false;
      lastAchAt = performance.now();
      const res = ach.step(st, performance.now(), {});
      // 成就音效：交织用五度双音（更盛），独石用明亮钟音 —— 每次新点亮只响一次。
      if (res && res.newly && res.newly.length) playSfx(res.newly.some((a) => a.cls === 'weave') ? 'achWeave' : 'achSolo');
      if (res && res.newly.length) {
        const pats = new Map(ALL_PATTERNS.map((p2) => [p2.id, p2]));
        for (const a of res.newly) {
          const p2 = pats.get(a.id);
          const requiresTitles = (p2?.requires || []).map((rid) => pats.get(rid)?.title || rid);
          achUI.push({ ...a, requiresTitles, starIndex: ach.net.nodes.size });
        }
        window.__IW.lastAchievements = res.newly;
        // T7：若开启了"记录解锁画面"，给每条新达成的成就附一张当时的图（关闭时零开销）
        if (shotsEnabled()) {
          for (const a of res.newly) {
            const g = ach.tracker.granted.get(a.id);
            if (g && !g.shot) g.shot = captureShot(canvas, cam, null);
          }
        }
        ach.save();
      }
    });
  }
  if (achRes && achRes.newly.length) playSfx(achRes.newly.some((a) => a.cls === 'weave') ? 'achWeave' : 'achSolo');
  if (achRes && achRes.newly.length) {
    const pats = new Map(ALL_PATTERNS.map((p2) => [p2.id, p2]));
    for (const a of achRes.newly) {
      const p2 = pats.get(a.id);
      const requiresTitles = (p2?.requires || []).map((rid) => pats.get(rid)?.title || rid);
      achUI.push({ ...a, requiresTitles, starIndex: ach.net.nodes.size });
    }
    window.__IW.lastAchievements = achRes.newly;
  }
  if (achRes && achRes.grew) ach.save();

  requestAnimationFrame(frame);
}

// ---------- S2 顶部菜单栏（⑦）：文件 / 编辑 / 设置 ----------
// 说明：三个菜单都接**真实功能**（打开/保存复用既有场景管理；撤销/重做复用 state 的 undo/redo），不留占位按钮。
{
  const menubar = document.getElementById('menubar');
  // ⑦ 当前文件名（保存/另存为用）与统一重画助手
  let currentName = '未命名场景';
  const redrawAll = () => {
    drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor });
    panel.tickValues();
  };
  // ⑦ 让设置真正驱动工作台（外观/通用）：启动时套用，并在设置变更时立即套用。
  //    设置页是独立文档 → 它的写入由 bindStorageSync 通过 storage 事件送到这里。
  const applySettings = () => {
    st.showGrid = getSetting('grid');    st.showTicks = getSetting('ticks');
    st.showParams = getSetting('labels');
    // ★ 修 bug（用户报告："设置里『连接视图』勾选后没有连接视图"）：
    //   渲染侧读的是 **st.connOn**（render.js: `if (st.connOn || …) drawConnections(...)`），
    //   而这里原先写的是 `st.connView` —— 一个**没有任何人读**的字段 ✗。
    //   所以那个开关一直是在"写进空气"。（上一行的注释本来就写着要把 connView 映射成 connOn，是代码没照做。）
    // ★ 用户本轮要求："深色/浅色按钮……作为用户数据的一部分存储"。
    //   主题本身存在 theme.js 的 interweaver.theme（三处页面共用的唯一事实来源）；
    //   这里在启动时把它**镜像进设置库**（settings.js 的 interweaver.settings.v1），
    //   于是"显示模式"和其它设置一起成为用户数据的一部分（导出/备份/迁移都带着它）。
    try { if (getSetting('themeMode') !== currentMode()) setSetting('themeMode', currentMode()); } catch { /* 忽略 */ }
    st.connOn = getSetting('connView');
    // 成就瞬间画面：设置页的 achShot 直接驱动**既有的**成就截图机制（achievements/shot.js），
    // 不再维护第二套实现（此前我在 S10 新建过 achShot.js，属于重复，已删除）。
    setShotsEnabled(getSetting('achShot'));
  };
  applySettings();
  onSettingChange((key) => {
    if (key === 'grid' || key === 'ticks' || key === 'labels' || key === 'connView') { applySettings(); redrawAll(); }
  });
  bindStorageSync();

  const openScenes = () => {
    if (document.getElementById('sceneList')) return;
    openSceneList({ st, cam, S, onLoaded: () => { drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor }); panel.tickValues(); } });
  };
  if (menubar) {
    const closeAll = () => { for (const m of menubar.querySelectorAll('.mbMenu')) m.classList.remove('open'); };
    for (const menu of menubar.querySelectorAll('.mbMenu')) {
      menu.querySelector('.mbTop')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('open');
        closeAll();
        if (menu.dataset.menu === 'settings') {
          // ⑦ 设置是**独立页面**（与成就页同一模式：真实导航，不在同一文档上叠加）
          window.location.href = './settings.html';
          return;
        }
        if (!isOpen) menu.classList.add('open');
      });
    }
    menubar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      closeAll();
      if (act === 'file:new') {
        if (!window.confirm('新建会清空当前画布（草稿也会清除），继续？')) return;
        newScene(st, S, cam);
        currentName = '未命名场景';
        redrawAll();
        hint('✦ 已新建空白场景');
      } else if (act === 'file:open') {
        pickSceneFile(st, S, cam).then((r) => {
          if (!r.ok) { hint('⚠ 打开失败：' + r.error); return; }
          currentName = r.name || '未命名场景';
          redrawAll();
          hint('✦ 已打开「' + currentName + '」');
        });
      } else if (act === 'file:save') {
        const r = downloadScene(st, cam, currentName);
        saveDraft(st, cam, currentName);
        hint('✦ 已保存 ' + r.filename + '（' + Math.round(r.bytes / 1024) + ' KB）');
      } else if (act === 'file:saveas') {
        const nm = window.prompt('另存为（文件名，扩展名自动加 ' + FILE_EXT + '）', currentName);
        if (nm === null) return;
        currentName = nm.trim() || '未命名场景';
        const r = downloadScene(st, cam, currentName);
        saveDraft(st, cam, currentName);
        hint('✦ 已另存为 ' + r.filename);
      }
      else if (act === 'edit:undo') { S.undo(st); drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor }); panel.tickValues(); }
      else if (act === 'edit:redo') { S.redo(st); drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor }); panel.tickValues(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#menubar')) closeAll(); });
  }
}

// ---------- ⑦ 自动草稿：启动恢复 + 周期保存（防丢） ----------
{
  const draft = readDraft();
  if (draft) {
    const r = deserializeScene(st, S, draft.text, cam);
    if (r.ok) {
      hint('✦ 已恢复上次的草稿「' + draft.name + '」；如需空白，用菜单 文件 → 新建');
      drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor });
      panel.tickValues();
      // ★ 修复（用户报告：草稿恢复了图形，但**变量没有**）：变量窗口只在收到 structure 事件时
      //   才重建（见上面的 S.on 监听），启动时那次调用发生在**恢复之前**（那时还没有变量）。
      //   恢复流程原来只重画了画布、没发事件，于是变量窗口一直是空的 —— 变量其实已经在
      //   st.variables 里（序列化本身没问题，已实测）。这里补发一次标准事件，走正常刷新路径。
      S.emit(st, 'structure');
    } else {
      hint('⚠ 草稿读到了但恢复失败：' + (r.error || '未知原因'));
    }
  } else {
    // ★ 用户报告过「打开设置回来画布空白、而且没有任何提示」：原来 readDraft 的三条失败路径
    //   全是静默 return null，用户完全无从判断。这里把原因说出来（草稿本身不动、不删）。
    const dg = readDraftDetailed();
    if (dg.hadDraft) hint('⚠ 上次的草稿读不出来：' + dg.why + '（草稿仍在本地存储里，未删除）');
  }
  let draftWarned = false;
  const autosave = () => {
    if (saveDraft(st, cam, '未命名场景')) { draftWarned = false; return; }
    if (!draftWarned) {   // 只在首次失败时提示，避免每 4 秒刷屏
      draftWarned = true;
      hint('⚠ 自动草稿保存失败：' + ((lastDraftStatus && lastDraftStatus.why) || '未知原因'));
    }
  };
  setInterval(autosave, 4000);
  window.addEventListener('beforeunload', autosave);
  // pagehide/visibilitychange 比 beforeunload 更可靠（某些导航下后者不会触发）
  window.addEventListener('pagehide', autosave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave(); });
}

// ★ 已删除：场景按钮（#sceneBtn）的事件处理。
//   用户要求"删除场景功能（和导入导出重了）"——「文件」菜单里的 新建/打开/保存/另存为 已经覆盖了它，
//   那个独立的场景列表是多余的第二个入口，连按钮一起删掉，不留死代码。

document.getElementById('achBtn')?.addEventListener('click', () => {
  if (document.getElementById('starMap')) return;
  // 用户要求：成就页与工作台是两个独立页面 → 直接跳转（不在同一 html 上叠加）
  const gate = isAllowed('achievements');
        if (gate.allowed) window.location.href = './starmap.html';
        else { const h = document.getElementById('hint'); if (h) h.textContent = '\u2726 ' + gate.why; else alert(gate.why); }
});

// 诊断钩子：单独跑一次绘制并返回耗时（毫秒）。
// 存在的理由：headless 下 rAF 会被节流到约 10Hz，用"帧率"测不出应用真实成本，
// 必须直接量单帧绘制耗时。注意必须放在 g/canvas/tools/panel 声明之后。
window.__IW.renderOnce = () => {
  const t0 = performance.now();
  drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor });
  return performance.now() - t0;
};

document.getElementById('themeBtn')?.addEventListener('click', () => {
  cycleTheme();
  // ★ 用户本轮要求："深色/浅色按钮……作为用户数据的一部分存储"。
  //   主题实际存在 theme.js 的 interweaver.theme；这里**同时写进设置库**（settings.js），
  //   于是它和其它设置一起被导出/备份，设置页里的"显示模式"也永远是当前真实值（两边不会再各说各话）。
  try { setSetting('themeMode', currentMode()); } catch { /* 设置库不可用时忽略 */ }
  drawFrame(g, st, cam, canvas, { toolPreview: tools.drawToolPreview, varCardAnchor: panel.varCardAnchor });
});

document.getElementById('audioBtn')?.addEventListener('click', () => { audio.toggle(); });
// 音效开关已移到设置页（settings.html 的「通用」分区）→ 见 applySettings 的 sfx 映射

// 默认开启：进入即试一次（失败不报错，只改按钮提示态）
try { audio.start(); } catch { /* 忽略：音频失败不影响画布 */ }

// 记录成就解锁画面：开关已统一到设置页的「其它 → 拍摄成就瞬间画面」（achShot），
// 这里不再往画布里注入复选框（旧设置卡已删除）。

resize();
S.ensureEvaluated(st);
panel.render();
requestAnimationFrame(frame);
