// 交织者后端 API（**与前端不同源**）：
//   · 真数据库：node:sqlite（Node 内置，**零 npm 依赖**）；单文件落盘 data/interweaver.db
//   · 用户系统：注册 / 登录 / 登出 / 我是谁；密码用 node:crypto 的 scrypt + 随机盐 + 定长比较
//   · 所有用户数据入库：docs（settings/progress/draft）+ scenes（场景），**按 user_id 隔离**
//   · 跨源：白名单 + OPTIONS 预检（前端静态服务默认 5188，本服务默认 5189）
//   · **绝不假装成功**：任何失败都返回明确状态码 + 尽可能详细的 {ok:false, code, error, hint?, details?}
//
// 环境变量（部署用）：
//   PORT_API=5189            监听端口
//   API_DB=<path>            数据库文件（默认 app/data/interweaver.db；测试可用 :memory:）
//   API_ORIGINS=a,b          允许的前端来源（逗号分隔）
//   API_ALLOW_REGISTER=0     关闭开放注册（部署到公网时建议关；第一个注册的用户自动是管理员）
//   API_SESSION_DAYS=30      会话有效期（天）
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT_API || 5189);
const DB_PATH = process.env.API_DB || join(ROOT, 'data', 'interweaver.db');
const API_VERSION = 'v1';
const ALLOWED_ORIGINS = (process.env.API_ORIGINS || 'http://localhost:5188,http://127.0.0.1:5188')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_REGISTER = process.env.API_ALLOW_REGISTER !== '0';
const SESSION_MS = Number(process.env.API_SESSION_DAYS || 30) * 86400_000;
const MAX_BODY = 8 * 1024 * 1024;
const DOC_KINDS = new Set(['settings', 'progress', 'draft']);
let logFailures = 0;      // 请求日志写盘失败次数（正常应为 0；在 /health 里可见）
// 画布动作流水：与请求日志分开的文件 + 一条累计计数（/health 里可见，便于监控）
const EVENTS_FILE = process.env.API_EVENTS_LOG || join(ROOT, 'data', 'events.log');
let eventsLogged = 0;

// ---------- 数据库 ----------
if (DB_PATH !== ':memory:') await mkdir(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ua TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS docs (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_scenes_user ON scenes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- 错误（尽量详细：code + error + hint + details）----------
class ApiError extends Error {
  constructor(status, code, error, { hint, details } = {}) {
    super(error);
    this.status = status; this.code = code; this.error = error; this.hint = hint; this.details = details;
  }
}
const fail = (status, code, error, extra) => { throw new ApiError(status, code, error, extra); };

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(res.__cors || {}),
  });
  res.end(body);
};

const corsHeaders = (origin) => (!origin || !ALLOWED_ORIGINS.includes(origin) ? {} : {
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '600',
  vary: 'Origin',
});

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(new ApiError(413, 'BODY_TOO_LARGE', `请求体超过上限 ${MAX_BODY} 字节`, { details: { size } })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const readJsonBody = async (req) => {
  const text = await readBody(req);
  if (!text) fail(400, 'EMPTY_BODY', '请求体是空的', { hint: '这些接口都需要 JSON 请求体' });
  try { return JSON.parse(text); }
  catch (e) { fail(400, 'BAD_JSON', '请求体不是合法 JSON：' + e.message, { hint: '请带 content-type: application/json' }); }
};

// ---------- 用户 ----------
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const hashPassword = (pw, saltHex) => scryptSync(pw, Buffer.from(saltHex, 'hex'), 64).toString('hex');
const verifyPassword = (pw, saltHex, hashHex) => {
  const got = Buffer.from(hashPassword(pw, saltHex), 'hex');
  const want = Buffer.from(hashHex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};
const publicUser = (row) => ({ id: row.id, username: row.username, isAdmin: !!row.is_admin, createdAt: row.created_at });

const findUser = (name) => db.prepare('SELECT * FROM users WHERE username = ?').get(name);
const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

function createUser(username, password) {
  if (!USERNAME_RE.test(username || '')) {
    fail(400, 'BAD_USERNAME', '用户名不合法：只允许 3~32 位字母/数字/下划线/点/短横', { details: { got: username } });
  }
  if (typeof password !== 'string' || password.length < 6) {
    fail(400, 'BAD_PASSWORD', '密码至少 6 位', { details: { length: typeof password === 'string' ? password.length : null } });
  }
  if (findUser(username)) fail(409, 'USER_EXISTS', `用户名 ${username} 已被占用`, { hint: '换一个用户名，或直接登录' });
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const first = countUsers() === 0;
  const info = db.prepare('INSERT INTO users (username, salt, hash, is_admin, created_at) VALUES (?,?,?,?,?)')
    .run(username, salt, hash, first ? 1 : 0, Date.now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
}

function issueSession(userId, ua) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ua) VALUES (?,?,?,?,?)')
    .run(token, userId, now, now + SESSION_MS, String(ua || '').slice(0, 200));
  return { token, expiresAt: now + SESSION_MS };
}

const bearer = (req) => {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+([A-Za-z0-9]+)$/.exec(h);
  return m ? m[1] : null;
};

function requireUser(req) {
  const token = bearer(req);
  if (!token) {
    fail(401, 'NO_TOKEN', '这个接口需要登录：缺少 Authorization: Bearer <token>', { hint: '先调用 /auth/login 或 /auth/register 拿 token' });
  }
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) fail(401, 'BAD_TOKEN', 'token 无效（可能已被登出或服务端换过数据库）', { details: { tokenPrefix: token.slice(0, 6) + '…' } });
  if (s.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    fail(401, 'TOKEN_EXPIRED', 'token 已过期', { details: { expiredAt: s.expires_at, now: Date.now() }, hint: '重新登录' });
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u) fail(401, 'USER_GONE', 'token 对应的用户已不存在');
  return { user: u, token };
}

// 登录/注册的简单限流（部署到公网时的最低保护；内存计数，够用且零依赖）
const attempts = new Map();
function rateLimit(req, key, limit = 12, windowMs = 60_000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?');
  const k = key + '|' + ip;
  const now = Date.now();
  const rec = attempts.get(k);
  if (!rec || now - rec.at > windowMs) { attempts.set(k, { at: now, n: 1 }); return; }
  rec.n += 1;
  if (rec.n > limit) {
    fail(429, 'RATE_LIMITED', `尝试过于频繁（${rec.n}/${limit} 每分钟）`, { hint: '等一分钟再试', details: { ip, windowMs } });
  }
}

// ---------- 路由 ----------
const parseSceneId = (raw) => {
  const id = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    fail(400, 'BAD_ID', '场景 id 不合法：只允许 1~64 位字母/数字/下划线/短横', { details: { got: raw } });
  }
  return id;
};

async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  const parts = p.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== API_VERSION) {
    fail(404, 'NO_ROUTE', `未知路径 ${p}`, { hint: `本服务的接口都在 /api/${API_VERSION}/ 下`, details: { apiVersion: API_VERSION } });
  }
  const rest = parts.slice(2);

  // 探活（公开）
  if (method === 'GET' && rest.length === 1 && rest[0] === 'health') {
    const u = countUsers();
    return json(res, 200, {
      ok: true, service: 'interweaver-api', apiVersion: API_VERSION, db: DB_PATH === ':memory:' ? ':memory:' : 'sqlite',
      users: u, allowRegister: ALLOW_REGISTER, sessionDays: SESSION_MS / 86400_000,
      logFailures: logFailures, log: (process.env.API_LOG || 'data/api.log'),
      allowedOrigins: ALLOWED_ORIGINS, time: Date.now(),
    });
  }

  // ---- 用户系统 ----
  if (rest[0] === 'auth') {
    const act = rest[1];
    if (method === 'POST' && act === 'register') {
      if (!ALLOW_REGISTER) fail(403, 'REGISTER_DISABLED', '本服务已关闭开放注册', { hint: '用已有账号登录；或让管理员打开 API_ALLOW_REGISTER' });
      rateLimit(req, 'register');
      const body = await readJsonBody(req);
      const user = createUser(body.username, body.password);
      const s = issueSession(user.id, req.headers['user-agent']);
      return json(res, 200, { ok: true, user: publicUser(user), ...s });
    }
    if (method === 'POST' && act === 'login') {
      rateLimit(req, 'login');
      const body = await readJsonBody(req);
      const user = findUser(body.username);
      // 不区分"用户不存在"和"密码错"的措辞差异，避免账号枚举；但 code 给出可诊断的原因
      if (!user || !verifyPassword(String(body.password || ''), user.salt, user.hash)) {
        fail(401, 'BAD_CREDENTIALS', '用户名或密码不正确', { details: { username: body.username } });
      }
      const s = issueSession(user.id, req.headers['user-agent']);
      return json(res, 200, { ok: true, user: publicUser(user), ...s });
    }
    if (method === 'POST' && act === 'logout') {
      const { token } = requireUser(req);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && act === 'me') {
      const { user } = requireUser(req);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }
    fail(404, 'NO_AUTH_ROUTE', `未知的用户接口 ${p}`, { hint: '可用：POST /auth/register、POST /auth/login、POST /auth/logout、GET /auth/me' });
  }

  // 以下都要登录
  const { user } = requireUser(req);

  // ---- 单文档：settings / progress / draft ----
  if (rest.length === 1 && DOC_KINDS.has(rest[0])) {
    const kind = rest[0];
    if (method === 'GET') {
      const row = db.prepare('SELECT json, updated_at FROM docs WHERE user_id = ? AND kind = ?').get(user.id, kind);
      return json(res, 200, { ok: true, doc: row ? JSON.parse(row.json) : null, updatedAt: row ? row.updated_at : null });
    }
    if (method === 'PUT') {
      const doc = await readJsonBody(req);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        fail(400, 'BAD_DOC', 'body 必须是对象', { details: { gotType: Array.isArray(doc) ? 'array' : typeof doc } });
      }
      const now = Date.now();
      db.prepare(`INSERT INTO docs (user_id, kind, json, updated_at) VALUES (?,?,?,?)
                  ON CONFLICT(user_id, kind) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
        .run(user.id, kind, JSON.stringify(doc), now);
      return json(res, 200, { ok: true, savedAt: now });
    }
    fail(405, 'METHOD_NOT_ALLOWED', `${method} 不支持（这里是 GET / PUT）`, { details: { path: p } });
  }

  // ---- 场景 ----
  if (rest[0] === 'scenes') {
    if (rest.length === 1) {
      if (method === 'GET') {
        const rows = db.prepare('SELECT id, name, updated_at, created_at, length(data) AS bytes FROM scenes WHERE user_id = ? ORDER BY updated_at DESC')
          .all(user.id);
        return json(res, 200, { ok: true, scenes: rows.map((r) => ({ id: r.id, name: r.name, savedAt: r.updated_at, createdAt: r.created_at, bytes: r.bytes })) });
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const id = body.id ? parseSceneId(body.id) : ('s' + Date.now().toString(36) + randomBytes(3).toString('hex'));
        const dup = db.prepare('SELECT id FROM scenes WHERE user_id = ? AND id = ?').get(user.id, id);
        if (dup) fail(409, 'SCENE_EXISTS', `场景 id ${id} 已存在`, { hint: '换个 id，或用 PUT /scenes/:id 覆盖', details: { id } });
        const now = Date.now();
        db.prepare('INSERT INTO scenes (id, user_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, user.id, String(body.name || '未命名场景'), JSON.stringify(body.data ?? null), now, now);
        return json(res, 200, { ok: true, id });
      }
      fail(405, 'METHOD_NOT_ALLOWED', `${method} 不支持（这里是 GET / POST）`, { details: { path: p } });
    }
    const id = parseSceneId(rest[1]);
    const row = db.prepare('SELECT * FROM scenes WHERE user_id = ? AND id = ?').get(user.id, id);
    if (method === 'GET') {
      if (!row) fail(404, 'SCENE_NOT_FOUND', `没有场景 ${id}`, { hint: 'GET /scenes 看看有哪些' });
      return json(res, 200, { ok: true, doc: { id: row.id, name: row.name, savedAt: row.updated_at, data: JSON.parse(row.data) } });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const now = Date.now();
      if (row) {
        db.prepare('UPDATE scenes SET name = ?, data = ?, updated_at = ? WHERE user_id = ? AND id = ?')
          .run(String(body.name ?? row.name), JSON.stringify(body.data ?? JSON.parse(row.data)), now, user.id, id);
      } else {
        db.prepare('INSERT INTO scenes (id, user_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, user.id, String(body.name || '未命名场景'), JSON.stringify(body.data ?? null), now, now);
      }
      return json(res, 200, { ok: true, id, created: !row });
    }
    if (method === 'DELETE') {
      const info = db.prepare('DELETE FROM scenes WHERE user_id = ? AND id = ?').run(user.id, id);
      if (!info.changes) fail(404, 'SCENE_NOT_FOUND', `没有场景 ${id} 可删`, { details: { id } });
      return json(res, 200, { ok: true, deleted: id });
    }
    fail(405, 'METHOD_NOT_ALLOWED', `${method} 不支持（这里是 GET / PUT / DELETE）`, { details: { path: p } });
  }

  // ---- 旧数据导入（前端首次登录后自动调用）----
  // ---- 画布动作流水（用户要求："画布内部动作也应该进监控"，且要含变量/观察器/参数值）----
  // 前端只从这里进：src/api.js 的 postEvents() ← src/telemetry.js 的批量上报。
  // 落 app/data/events.log（与 api.log 分开：api.log 是"请求流水"，这里是"用户动作流水"）。
  // 只在登录后接收（访客/离线的动作由前端缓冲，登录后补传）。
  if (method === 'POST' && rest.length === 1 && rest[0] === 'events') {
    rateLimit(req, 'events', 120, 60_000);          // 小批量 + 限流：正常前端约 1 次/秒
    const body = await readJsonBody(req);
    const list = Array.isArray(body.events) ? body.events.slice(0, 200) : null;
    if (!list) fail(400, 'BAD_EVENTS', 'body.events 必须是数组', { hint: '前端由 src/telemetry.js 统一上报' });
    const session = String(body.session || '-').slice(0, 32);
    const lines = list.map((e) => {
      const t = Number.isFinite(e && e.t) ? new Date(e.t).toISOString() : new Date().toISOString();
      const k = String((e && e.k) || '?').slice(0, 40);
      const d = e && e.d !== undefined && e.d !== null ? String(e.d).slice(0, 700) : '';
      return [t, 'user=' + user.id, 'session=' + session, k, d].join(' | ');
    }).join('\n');
    if (lines) {
      appendFile(EVENTS_FILE, lines + '\n')
        .then(() => { eventsLogged += list.length; })
        .catch(() => { logFailures += 1; });        // 写不进去也不影响请求（计数可见）
    }
    return json(res, 200, { ok: true, accepted: list.length });
  }

  if (method === 'POST' && rest.length === 1 && rest[0] === 'import') {
    const body = await readJsonBody(req);
    const now = Date.now();
    const applied = { docs: [], scenes: 0 };
    let skipped = 0;
    for (const [kind, doc] of Object.entries(body.docs || {})) {
      if (!DOC_KINDS.has(kind) || !doc || typeof doc !== 'object') { skipped++; continue; }
      const exists = db.prepare('SELECT 1 AS x FROM docs WHERE user_id = ? AND kind = ?').get(user.id, kind);
      if (exists) { skipped++; continue; }        // ★ 不覆盖后端已有数据（导入只补空位）
      db.prepare('INSERT INTO docs (user_id, kind, json, updated_at) VALUES (?,?,?,?)').run(user.id, kind, JSON.stringify(doc), now);
      applied.docs.push(kind);
    }
    for (const s of body.scenes || []) {
      const id = s && s.id ? String(s.id) : null;
      if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) { skipped++; continue; }
      const exists = db.prepare('SELECT 1 AS x FROM scenes WHERE user_id = ? AND id = ?').get(user.id, id);
      if (exists) { skipped++; continue; }
      db.prepare('INSERT INTO scenes (id, user_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, user.id, String(s.name || '未命名场景'), JSON.stringify(s.data ?? null), now, now);
      applied.scenes++;
    }
    return json(res, 200, { ok: true, applied, skipped, hint: skipped ? '已有数据不会被覆盖（导入只填空位）' : undefined });
  }

  fail(404, 'NO_ROUTE', `未知接口 ${p}`, { hint: `可用接口见 /api/${API_VERSION}/health 的说明或 README` });
}

// ---------- 启动 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const origin = req.headers.origin;
  res.__cors = corsHeaders(origin);        // 显式挂 CORS（不 patch Node 内置原型）

  if (req.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return json(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: `来源 ${origin || '(无)'} 不在白名单里`, details: { allowedOrigins: ALLOWED_ORIGINS } });
    }
    res.writeHead(204, res.__cors); res.end(); return;
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: `来源 ${origin} 不在白名单里`, hint: '把前端来源加进 API_ORIGINS', details: { allowedOrigins: ALLOWED_ORIGINS } });
  }

  // ★ 请求日志（用户选的监控方案 C）：每个 API 请求一行 → data/api.log，npm run status 会 tail 它。
  //   只记服务端看得到的东西：时间 | 方法 | 路径 | 状态码 | 耗时 | 来源 | 客户端 IP | 是否带凭证。
  //   **绝不记 token 本身、绝不记密码**；写日志失败也**绝不影响请求**（只累加计数，见 /health 的 logFailures）。
  const logFile = process.env.API_LOG || join(ROOT, 'data', 'api.log');
  const t0 = Date.now();
  let logged = false;
  const logLine = (status, extra) => {
    if (logged) return;
    logged = true;
    const line = [
      new Date().toISOString(), String(req.method || 'GET'), url.pathname, String(status),
      String(Date.now() - t0) + 'ms',
      'ip=' + String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?'),
      origin ? 'origin=' + origin : 'origin=-',
      req.headers.authorization ? 'auth=yes' : 'auth=no',
      extra || '',
    ].join(' | ');
    appendFile(logFile, line + '\n').catch(() => { logFailures += 1; });
  };
  res.on('finish', () => logLine(res.statusCode));

  try {
    await handle(req, res, url);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : (e && e.status) || 500;
    const body = {
      ok: false,
      code: e.code || 'INTERNAL',
      error: (e && e.message) || '服务端异常',
      hint: e.hint,
      details: e.details,
      path: url.pathname,
      method: req.method,
    };
    if (!(e instanceof ApiError)) body.stack = String(e && e.stack || '').split('\n').slice(0, 3);
    logLine(status, 'code=' + body.code);
    json(res, status, body);
  }
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n✗ 后端端口 ${PORT} 已被占用 —— 启动不了。`);
    console.error('  可能原因：上一次的后端没退干净，或另一个交织者实例还在跑。');
    console.error('  怎么办：npm run stop（停掉本项目的两个服务）；或换个端口：PORT_API=5289 npm run start:api');
    console.error('  看谁占着：npm run status');
  } else {
    console.error(`\n✗ 后端服务启动失败：${(e && e.message) || e}`);
  }
  process.exit(2);
});

server.listen(PORT, () => {
  try { writeFileSync(fileURLToPath(new URL('./.iw-api.pid', import.meta.url)), String(process.pid)); } catch { /* 忽略 */ }
  console.log(`Interweaver API → http://localhost:${PORT}/api/${API_VERSION}/health`);
  console.log(`  数据库：${DB_PATH}`);
  console.log(`  允许来源：${ALLOWED_ORIGINS.join(', ')}　开放注册：${ALLOW_REGISTER ? '是' : '否'}　会话：${SESSION_MS / 86400_000} 天`);
});
