// 前端访问后端的**唯一出口**（前后端分离后的"门"）
//
// 为什么只有这一个文件：此前"这条数据存哪、怎么存"散落在 settings.js / sceneFile.js /
// achievements/runtime.js / 场景库 里各写一遍 localStorage —— 与"函数几何被抄四遍"是同一类病。
// 现在：**所有**后端访问都从这里走；其它模块只调用这里的函数，不自己拼 URL、不自己 fetch。
//
// 约定（对齐用户要求）：
//   · 后端地址：globalThis.__IW_API_BASE__（测试用）→ <meta name="iw-api"> → 默认 http://localhost:5189
//   · 后端**挂了**或返回错误：抛 ApiError，带 code / status / hint / details / path / method
//     —— 调用方据此**明确报错**，绝不静默退回本地存储（本项目明令不搞假后端）；
//   · token 是**凭证**（不是用户数据），存 localStorage 的 interweaver.token；
//   · 网络失败与业务失败分开：BACKEND_UNREACHABLE / TIMEOUT / BAD_RESPONSE / 后端的 code。
const DEFAULT_BASE = 'http://localhost:5189';
const TOKEN_KEY = 'interweaver.token';

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', error = '未知错误', hint, details, path, method, cause } = {}) {
    super(error);
    this.name = 'ApiError';
    this.status = status; this.code = code; this.error = error;
    this.hint = hint; this.details = details; this.path = path; this.method = method; this.cause = cause;
  }
  /** 给人看的详细一段话（UI 直接显示这个） */
  toDetailText(base) {
    const lines = [`✗ 后端请求失败：${this.method || 'GET'} ${(base || '') + (this.path || '')}`];
    lines.push(`   原因：${this.error}（code=${this.code}${this.status ? '，HTTP ' + this.status : ''}）`);
    if (this.hint) lines.push(`   怎么办：${this.hint}`);
    if (this.details) { try { lines.push(`   细节：${JSON.stringify(this.details)}`); } catch { /* 忽略 */ } }
    return lines.join('\n');
  }
}

export function apiBase() {
  const override = globalThis.__IW_API_BASE__;
  if (typeof override === 'string' && override) return override.replace(/\/+$/, '');
  const meta = typeof document !== 'undefined' && document.querySelector('meta[name="iw-api"]');
  const fromMeta = meta && meta.getAttribute('content');
  if (fromMeta) return String(fromMeta).replace(/\/+$/, '');
  return DEFAULT_BASE;
}

// ---------- token（凭证，不是用户数据）----------
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 隐私模式 */ } };
export const clearToken = () => setToken(null);

// ---------- 连接状态（供 UI 显示"后端未连接"横幅）----------
let backendState = { ok: null, base: apiBase(), reason: null, at: 0 };
const listeners = new Set();
export const onBackendState = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
export const getBackendState = () => ({ ...backendState });
function setBackendState(ok, reason) {
  backendState = { ok, base: apiBase(), reason: reason || null, at: Date.now() };
  for (const cb of listeners) { try { cb(getBackendState()); } catch { /* 监听者自己的错不该影响请求 */ } }
}

// ---------- 请求 ----------
export async function apiFetch(path, { method = 'GET', body, token = getToken(), timeoutMs = 8000, raw = false } = {}) {
  const base = apiBase();
  const url = base + '/api/v1' + path;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError');
    const err = new ApiError({
      code: aborted ? 'TIMEOUT' : 'BACKEND_UNREACHABLE',
      status: 0,
      error: aborted ? `请求超时（${timeoutMs}ms 没响应）` : `连不上后端 ${base}`,
      hint: '确认后端已启动：npm run start:api（或 npm start 同时起前后端）；地址可在页面 <meta name="iw-api"> 里改',
      details: { url, base, cause: (e && e.message) || String(e) },
      path, method, cause: e,
    });
    setBackendState(false, err);
    throw err;
  }
  if (timer) clearTimeout(timer);

  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; }
  catch {
    const err = new ApiError({
      code: 'BAD_RESPONSE', status: res.status,
      error: '后端返回的不是 JSON（可能不是本后端，或中间有代理）',
      hint: `确认 ${base} 跑的是本项目的 server-api.mjs`,
      details: { url, contentType: res.headers.get('content-type'), preview: text.slice(0, 120) },
      path, method,
    });
    setBackendState(false, err);
    throw err;
  }
  if (!res.ok || !payload || payload.ok !== true) {
    const err = new ApiError({
      status: res.status,
      code: (payload && payload.code) || 'HTTP_' + res.status,
      error: (payload && payload.error) || `后端返回 HTTP ${res.status}`,
      hint: payload && payload.hint,
      details: payload && payload.details,
      path, method,
    });
    // 401（没登录/token 失效）不算"后端挂了"——这是正常的业务状态
    if (res.status !== 401) setBackendState(false, err);
    else setBackendState(true, null);
    throw err;
  }
  setBackendState(true, null);
  return payload;
}

// ---------- 具体接口（其它模块只调这些）----------
export const health = () => apiFetch('/health', { timeoutMs: 3000 });

export async function probeBackend() {
  try { const r = await health(); setBackendState(true, null); return { ok: true, info: r }; }
  catch (e) { return { ok: false, error: e }; }
}

export const register = async (username, password) => {
  const r = await apiFetch('/auth/register', { method: 'POST', body: { username, password }, token: null });
  setToken(r.token); return r;
};
export const login = async (username, password) => {
  const r = await apiFetch('/auth/login', { method: 'POST', body: { username, password }, token: null });
  setToken(r.token); return r;
};
export const logout = async () => {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } finally { clearToken(); }
};
export const me = () => apiFetch('/auth/me');

export const getDoc = (kind) => apiFetch('/' + kind);
export const putDoc = (kind, doc) => apiFetch('/' + kind, { method: 'PUT', body: doc });

export const listScenes = () => apiFetch('/scenes');
export const getScene = (id) => apiFetch('/scenes/' + encodeURIComponent(id));
export const putScene = (id, { name, data }) => apiFetch('/scenes/' + encodeURIComponent(id), { method: 'PUT', body: { name, data } });
export const createScene = ({ name, data, id }) => apiFetch('/scenes', { method: 'POST', body: { name, data, id } });
export const deleteScene = (id) => apiFetch('/scenes/' + encodeURIComponent(id), { method: 'DELETE' });

/** 旧数据一次性导入（后端**只填空位、不覆盖**） */
export const importLegacy = (docs, scenes) => apiFetch('/import', { method: 'POST', body: { docs, scenes } });
