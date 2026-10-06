// 应用模式（唯一来源）：前端是客户端，联网与否决定哪些功能可用。
//
// 用户要求：打开后显示加载，等网络与用户数据全部就绪；也提供「离线进入」，只用画布主体，
//   离线时不开放涉及网络的功能（成就页等）。
//
// 三种模式，且只在这里定义"什么功能需要网络"：
//   loading - 开屏加载中：正在探测后端、拉取用户数据
//   online  - 全部可用（用户数据来自后端；未登录时是访客：能用但不保存）
//   offline - 离线进入：只有画布主体；成就页/场景库/账号这些联网功能不开放
const listeners = new Set();

export const MODE = { LOADING: 'loading', ONLINE: 'online', OFFLINE: 'offline' };

let mode = MODE.LOADING;
let reason = null;
let user = null;
let docs = {};

const NET_FEATURES = {
  achievements: '成就页（星图）',
  scenes: '场景库（保存/读取到服务器）',
  account: '账号与后端设置',
  sync: '把本机数据同步到服务器',
};

export const getMode = () => mode;
export const getReason = () => reason;
export const getUser = () => user;
export const getDocs = () => docs;
export const isOnline = () => mode === MODE.ONLINE;
export const isLoading = () => mode === MODE.LOADING;

export function isAllowed(feature) {
  if (mode === MODE.ONLINE) return { allowed: true };
  const label = NET_FEATURES[feature] || feature;
  if (mode === MODE.LOADING) return { allowed: false, label: label, why: '还在加载中，请稍等' };
  return { allowed: false, label: label, why: '离线模式下不开放：' + label + '（需要联网）' };
}

export function onMode(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { for (const cb of listeners) { try { cb({ mode: mode, reason: reason, user: user, docs: docs }); } catch (e) { /* 订阅者自己的错不影响状态 */ } } }

export function enterOnline(info) {
  mode = MODE.ONLINE;
  reason = null;
  if (info && info.user !== undefined) user = info.user;
  if (info && info.docs !== undefined) docs = info.docs || {};
  emit();
}

export function enterOffline(r) {
  mode = MODE.OFFLINE;
  reason = r || { title: '离线模式', detail: '未连接后端' };
  emit();
}

export function setUser(u) { user = u; emit(); }
export function setDoc(kind, doc) { docs = Object.assign({}, docs); docs[kind] = doc; emit(); }