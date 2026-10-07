// 用户命名空间（唯一来源）：**用户数据型的 localStorage 键一律按账号分键**。
//
// 为什么需要这个文件（用户报告的 bug）：
//   "我用账号 2 可以打开账号 1 的存档和数据" —— 根因是本地键是**全局固定**的
//   （interweaver.settings.v1 / progress.v1 / draft.v1 / live.v1），同一浏览器换账号登录时，
//   上一号留在本地的数据仍然被新号读到；登录页的"旧数据一次性导入"又会把这份残留
//   推进新号在服务器上的空位里 —— 于是**后端也串了**（后端本身是按 user_id 分键的，没问题）。
//
// 本文件给出的规则（就三条）：
//   ① **命名空间**：已登录 + 知道 uid → 键名写成 interweaver.u<id>.<原名>；
//      访客 / 还不知道 uid → 用原来的全局键（访客自己的数据，保持既有行为不变）。
//      token 键（interweaver.token）**保持全局** —— 它就是"我是谁"的凭证，不能按账号分。
//   ② **归属**：本机遗留的全局旧数据（升级前写下的）**只能归一个账号**：
//      先判给"上一个用过这台浏览器的账号"（lastUserId），只有当这台浏览器**从未**有过账号时，
//      才判给当前首次登录/注册的账号（= 既有的"访客数据带进账号"行为）。
//      认领动作 = 复制到该账号的命名空间 + 打标记（claims）+ 删掉全局旧键：
//      数据不会丢（复制过去了），但**再也不会被别的账号或访客读到**。
//   ③ **每份旧数据只导入一次**：认领标记同时就是"已导入"标记，登录页据此跳过重复导入。
//
// 纯 localStorage，无网络、无依赖：Node 里没有 localStorage 时全部退化为"访客、无数据"。
const AUTH_KEY = 'interweaver.auth.v1';     // 凭证缓存：{ token, userId, username, at }（token 本身仍在 api.js 的全局键）
const SCOPE_KEY = 'interweaver.scope.v1';   // 归属记录：{ lastUserId, claims: { <旧键>: uid } }

/**
 * 需要按账号分键的"用户数据"（token 不在此列：它是凭证，必须全局）。
 * 前三个是画布/存档类的数据文档；后四个是**浏览器级的偏好与界面状态** ——
 * 用户要求"每个账号都是独立的"，所以主题 / 音效开关 / 拍摄开关 / 成就详情卡位置
 * 也一并按账号分键（否则账号 2 一打开就是账号 1 的主题与设置）。
 * 这张表同时是 claimLegacy() 的认领清单：升级前留在全局键里的旧值**只会归一个账号**。
 */
export const USER_KEYS = [
  'interweaver.settings.v1', 'interweaver.progress.v1', 'interweaver.draft.v1',
  'interweaver.theme', 'interweaver.sfx', 'interweaver.shots', 'interweaver.detailPos',
];

function ls() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function readJson(key) {
  const s = ls(); if (!s) return null;
  try { const raw = s.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJson(key, obj) {
  const s = ls(); if (!s) return false;
  try { s.setItem(key, JSON.stringify(obj)); return true; } catch { return false; }
}

// ---------- ① 当前账号 ----------
/** 当前账号 id（正整数）；未登录 / 未知 → null */
export function currentUserId() {
  const a = readJson(AUTH_KEY);
  const id = a && Number(a.userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function authRecord() { return readJson(AUTH_KEY); }

/** 账号标识片段：u<id>；没有账号 → ''（= 访客，沿用旧全局键） */
export function scopeTag(userId) {
  const id = userId === undefined ? currentUserId() : Number(userId);
  return Number.isInteger(id) && id > 0 ? 'u' + id : '';
}

/**
 * 用户数据键 → 当前命名空间下的真实键名。
 *   scopedKey('interweaver.draft.v1')  → 'interweaver.u7.draft.v1'（已登录）
 *                                      → 'interweaver.draft.v1'  （访客 / 还不知道 uid）
 */
export function scopedKey(base, userId) {
  const tag = scopeTag(userId);
  if (!tag) return base;
  const m = /^interweaver\.(.+)$/.exec(base);
  return 'interweaver.' + tag + '.' + (m ? m[1] : base);
}

/** 命名空间是否已确定（已登录且知道 uid） */
export function hasScope() { return currentUserId() !== null; }

// ---------- ①′ 读写入口（浏览器级偏好也走这里，见 USER_KEYS） ----------
/**
 * 读一个**用户数据键**（读路径的唯一入口）。
 *   · 已登录 → 本账号命名空间 `interweaver.u<id>.<原名>`；
 *   · 本账号还没有这份数据时，**只有在它还没归属任何别的账号**、且这台浏览器上一个主人
 *     就是当前账号（或从没有过账号）时，才退回升级前的全局旧键
 *     —— 这就是"别把用户既有设置弄丢"：认领之前先让本人看得见。
 *   · 访客 → scopedKey 就是全局键本身（等价于改动前的行为）。
 */
export function readUserValue(base) {
  const s = ls(); if (!s) return null;
  if (!USER_KEYS.includes(base)) return null;                 // 不是用户数据键 → 调用方用错了
  const id = currentUserId();
  let v = null;
  try { v = s.getItem(scopedKey(base, id)); } catch { return null; }
  if (v !== null || id === null) return v;                    // 本账号有 / 访客（此时两者是同一个键）
  const st = scopeState();
  if (st.claims[base] !== undefined) return null;             // 已归属某人（认领过就不再看全局键）
  if (st.lastUserId !== null && st.lastUserId !== id) return null;   // 这台浏览器上一个主人是别的账号
  try { return s.getItem(base); } catch { return null; }
}

/** 写一个用户数据键 → 写进**当前账号**的命名空间（访客写全局旧键） */
export function writeUserValue(base, value) {
  const s = ls(); if (!s) return false;
  try { s.setItem(scopedKey(base), String(value)); return true; } catch { return false; }
}

/** 删掉**当前账号**命名空间里的这个键（不动别人的，也不动全局旧键） */
export function removeUserValue(base) {
  const s = ls(); if (!s) return false;
  try { s.removeItem(scopedKey(base)); return true; } catch { return false; }
}

/**
 * 一个"按当前账号命名空间化"的 storage 适配器（getItem/setItem/removeItem 同名同义）。
 * 给那些**整块存储都要按账号分**的调用方用 —— 例如成就页（starmap）的 runtime：
 * 它按 STORAGE_KEY / LIVE_KEY 读写进度与"正在使用中"，这两个键都属于本账号。
 * 注意：这里**不做**旧键回退（那是 readUserValue 的语义）——
 * 进度有自己的镜像与并集规则（见 progressStorage.js），临时键 live 更不该跨账号读。
 */
export function scopedStorage() {
  const s = ls();
  return {
    getItem(key) { try { return s ? s.getItem(scopedKey(key)) : null; } catch { return null; } },
    setItem(key, value) { try { if (s) s.setItem(scopedKey(key), value); return !!s; } catch { return false; } },
    removeItem(key) { try { if (s) s.removeItem(scopedKey(key)); return !!s; } catch { return false; } },
    /** 诊断用：这个基准键在当前账号下的**真实**键名（测试与页面日志据此断言命名空间） */
    keyOf(key) { return scopedKey(key); },
  };
}

// ---------- 归属记录 ----------
export function scopeState() {
  const s = readJson(SCOPE_KEY);
  const claims = (s && s.claims && typeof s.claims === 'object') ? s.claims : {};
  const last = s && Number(s.lastUserId);
  return { lastUserId: Number.isInteger(last) && last > 0 ? last : null, claims: { ...claims } };
}
function writeScopeState(st) { writeJson(SCOPE_KEY, { v: 1, lastUserId: st.lastUserId, claims: st.claims, at: Date.now() }); }

/** 本机还有哪些"还没归属任何账号"的全局旧数据（登录页据此决定要不要导入） */
export function legacyBlobs() {
  const out = {};
  const s = ls(); if (!s) return out;
  for (const base of USER_KEYS) {
    let raw = null;
    try { raw = s.getItem(base); } catch { /* 隐私模式 */ }
    if (raw === null) continue;
    let val = null;
    try { val = JSON.parse(raw); } catch { continue; }        // 坏数据不导入（不猜）
    if (val && typeof val === 'object') out[base] = val;
  }
  return out;
}

/**
 * 旧数据能不能导入给 uid？
 *   · 只要有一份本机旧数据**已经归属别的账号** → 不行（这就是"每个账号完全独立"的闸门）；
 *   · 认领标记同时就是"已导入过"的标记 → 同一份旧数据不会被第二个账号再导一遍。
 * 注意：判断依据是**归属记录**，不是"此刻全局键里还有没有数据"
 *   （认领时已经把全局键复制走并删掉了，所以要在登录**之前**先把旧数据读进内存，见 loginMain）。
 */
export function mayImportLegacyFor(uid) {
  const id = Number(uid);
  if (!Number.isInteger(id) || id <= 0) return false;
  const st = scopeState();
  for (const base of USER_KEYS) {
    const owner = st.claims[base];
    if (owner && Number(owner) !== id) return false;
  }
  return true;
}

/**
 * 认领本机还没归属的全局旧数据（复制到 uid 的命名空间 + 打标记 + 删掉全局旧键）。
 * 数据不丢（复制过去了），但从这一刻起**只有这个账号读得到**。
 * @returns 被认领的键名数组
 */
export function claimLegacy(uid) {
  const id = Number(uid);
  if (!Number.isInteger(id) || id <= 0) return [];
  const s = ls(); if (!s) return [];
  const st = scopeState();
  const done = [];
  for (const base of USER_KEYS) {
    const owner = st.claims[base];
    if (owner && Number(owner) !== id) continue;             // 已经是别人的 → 绝不碰
    let raw = null;
    try { raw = s.getItem(base); } catch { continue; }
    if (raw === null) continue;                              // 没有旧数据
    if (String(base).startsWith('interweaver.u')) continue;  // 已是命名空间键（防呆）
    try {
      s.setItem(scopedKey(base, id), raw);                   // ① 先复制（复制成功才删）
      s.removeItem(base);                                    // ② 再删全局旧键
      st.claims[base] = id;
      done.push(base);
    } catch { /* 配额等：保留旧键，下次再试（宁可重复也不能丢） */ }
  }
  writeScopeState(st);
  return done;
}

// ---------- 账号变更通知（设置库需要据此换键并重读） ----------
const listeners = new Set();
export function onScopeChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emitScope(from, to) {
  for (const cb of listeners) { try { cb({ from, to }); } catch { /* 订阅者自己的错不影响状态 */ } }
}

/**
 * 记住"当前是哪台账号"（由 api.js 在 login / register / me 成功后调用）。
 * 顺带做归属判定：换号时把本机还没归属的旧数据判给**上一个账号**（绝不留给刚登录的这个）。
 */
export function rememberAuth({ token, user, registered = false } = {}) {
  const id = user && Number(user.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const from = currentUserId();
  const prev = readJson(AUTH_KEY);
  const rec = {
    v: 1, userId: id, username: (user && user.username) || null,
    token: token || (prev && prev.token) || null,
    registered: !!registered, at: Date.now(),
  };
  writeJson(AUTH_KEY, rec);

  const st = scopeState();
  if (st.lastUserId && st.lastUserId !== id) claimLegacy(st.lastUserId);   // ② 旧数据判给上一个账号
  st.lastUserId = id;
  writeScopeState(st);
  claimLegacy(id);                                                        // ② 仍无归属的 → 判给当前账号（访客→注册）

  if (from !== id) emitScope(from, id);
  return rec;
}

/** 忘记当前账号（退出登录 / token 被清 → 回到访客命名空间；账号自己的数据留在自己的命名空间里） */
export function forgetAuth() {
  const from = currentUserId();
  const prev = readJson(AUTH_KEY);
  if (prev && prev.userId) writeJson(AUTH_KEY, { v: 1, userId: null, username: null, token: null, at: Date.now() });
  else { const s = ls(); try { s && s.removeItem(AUTH_KEY); } catch { /* 忽略 */ } }
  if (from !== null) emitScope(from, null);
}

/** 诊断用（验收脚本可以读它看清"当前命名空间 / 归属记录"） */
export function scopeInfo() {
  const st = scopeState();
  const s = ls();
  const keys = [];
  if (s) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith('interweaver')) keys.push(k); }
  return { userId: currentUserId(), lastUserId: st.lastUserId, claims: st.claims, keys: keys.sort() };
}
