// 设置存储（用户要求 ⑦：独立设置页 + 所有设置及时生效）
//
// 设计要点：
//   · **单一事实来源**：全部偏好键、默认值、读写与变更通知都在这里，设置页与工作台共用，
//     避免"页面写一个键、工作台读另一个键"这种分裂（本项目此前 theme / sfx 各自散落）。
//   · **跨页及时生效**：设置页是独立文档 → 写入 localStorage 后，工作台通过 storage 事件
//     立刻收到变更并应用（浏览器对其它文档的 localStorage 变更会派发 storage 事件）。
//   · **Node 安全**：没有 localStorage 时退化为内存存储（单元测试可直接断言，不依赖浏览器）。
//
// 分组与键（对应设置页的四个分区）：
//   general    常用：showParams 显示所有参数 / connView 连接视图 / sfx 音效
//   appearance 外观：themeMode 显示模式(dark|light|system) / grid 网格 / ticks 刻度 / labels 参数标签
//   operation  操作：snapGrid 网格吸附 / snapEndpoint 端点吸附 / snapAngle 角度吸附 / shortcuts 快捷键开关
//   other      其它：achShot 拍摄成就瞬间画面

const NS = 'interweaver.settings.v1';

/** 每个键的元信息：分组、默认值、类型（用于设置页渲染与读写校验） */
export const SETTINGS_SCHEMA = [
  { group: 'general', key: 'showParams', label: '显示所有参数', type: 'bool', def: true },
  { group: 'general', key: 'connView', label: '连接视图（Tab）', type: 'bool', def: false },
  { group: 'general', key: 'sfx', label: '音效', type: 'bool', def: true },

  { group: 'appearance', key: 'themeMode', label: '显示模式', type: 'enum', def: 'light', options: ['light', 'dark', 'system'] },
  { group: 'appearance', key: 'grid', label: '显示网格', type: 'bool', def: true },
  { group: 'appearance', key: 'ticks', label: '显示刻度数字', type: 'bool', def: true },
  { group: 'appearance', key: 'labels', label: '显示参数标签', type: 'bool', def: true },

  { group: 'operation', key: 'snapGrid', label: '吸附到网格', type: 'bool', def: true },   // 默认 true：此前该行为恒开，改成 false 会静默改变手感
  { group: 'operation', key: 'snapEndpoint', label: '吸附到端点/交点', type: 'bool', def: true },
  { group: 'operation', key: 'snapAngle', label: '角度吸附（15°）', type: 'bool', def: false },
  { group: 'operation', key: 'shortcuts', label: '启用快捷键', type: 'bool', def: true },
  // ⑦ 自定义右键菜单：分组开关（默认全开 = 保持现有行为；关掉即从右键菜单里移除该组）
  { group: 'operation', key: 'menuCalculus', label: '右键菜单：微积分', type: 'bool', def: true },
  { group: 'operation', key: 'menuProbe', label: '右键菜单：观察（观察器）', type: 'bool', def: true },
  { group: 'operation', key: 'menuCoordsys', label: '右键菜单：坐标系（含互连）', type: 'bool', def: true },
  { group: 'operation', key: 'menuConstraint', label: '右键菜单：约束', type: 'bool', def: true },

  { group: 'other', key: 'achShot', label: '拍摄成就瞬间画面', type: 'bool', def: true },
];

export const GROUPS = [
  { id: 'general', label: '通用' },
  { id: 'appearance', label: '外观' },
  { id: 'operation', label: '操作' },
  { id: 'other', label: '其它' },
];

const DEFAULTS = (() => {
  const o = {};
  for (const s of SETTINGS_SCHEMA) o[s.key] = s.def;
  return o;
})();

/** 内存回退（Node / 隐私模式）：没有 localStorage 时也能读写与通知 */
const memory = { ...DEFAULTS };
const listeners = new Set();
let useMemory = false;

function ls() {
  if (useMemory) return null;
  try {
    if (typeof localStorage === 'undefined') { useMemory = true; return null; }
    return localStorage;
  } catch { useMemory = true; return null; }
}

function readAll() {
  const store = ls();
  if (!store) return { ...memory };
  try {
    const raw = store.getItem(NS);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch { return { ...DEFAULTS }; }
}

function writeAll(obj) {
  const store = ls();
  if (!store) { Object.assign(memory, obj); return; }
  try { store.setItem(NS, JSON.stringify(obj)); } catch { Object.assign(memory, obj); }
}

function coerce(def, value) {
  if (typeof def === 'boolean') return !!value;
  if (typeof def === 'string') return String(value);
  if (typeof def === 'number') return Number(value);
  return value;
}

export function getSetting(key) {
  const spec = SETTINGS_SCHEMA.find((s) => s.key === key);
  const all = readAll();
  const v = all[key];
  if (spec) {
    if (spec.type === 'enum') return spec.options.includes(v) ? v : spec.def;
    return coerce(spec.def, v === undefined ? spec.def : v);
  }
  return v;
}

export function allSettings() {
  const out = {};
  for (const s of SETTINGS_SCHEMA) out[s.key] = getSetting(s.key);
  return out;
}

/** 写入一个设置并**立即通知**订阅者（设置页与工作台共用同一条通知链） */
export function setSetting(key, value) {
  const spec = SETTINGS_SCHEMA.find((s) => s.key === key);
  if (!spec) throw new Error('未知设置项：' + key);
  const v = spec.type === 'enum' ? (spec.options.includes(value) ? value : spec.def) : coerce(spec.def, value);
  const all = readAll();
  all[key] = v;
  writeAll(all);
  for (const cb of listeners) {
    try { cb(key, v); } catch { /* 单个订阅者出错不影响其它订阅者 */ }
  }
  return v;
}

export function resetSettings() {
  writeAll({ ...DEFAULTS });
  for (const s of SETTINGS_SCHEMA) for (const cb of listeners) { try { cb(s.key, s.def); } catch { /* 忽略 */ } }
  return allSettings();
}

/** 订阅设置变更；返回取消订阅函数 */
export function onSettingChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 跨文档实时同步：设置页是独立页面，写入后由工作台通过 storage 事件收到并应用。
 * 返回取消订阅函数。
 */
export function bindStorageSync() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const handler = (e) => {
    if (e && e.key && e.key !== NS) return;
    const all = readAll();
    for (const s of SETTINGS_SCHEMA) for (const cb of listeners) { try { cb(s.key, all[s.key]); } catch { /* 忽略 */ } }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** 键名（供测试与诊断使用） */
export const STORAGE_KEY = NS;
