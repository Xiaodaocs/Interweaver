// 后端验收（前后端分离 · 数据库 + 用户系统）
//   自己拉起 server-api.mjs（测试端口 5199 + 临时数据库文件），跑完整功能后关掉并清理，
//   因此**不依赖**任何预先跑着的进程，可直接挂在 verify 链里。
//
// 判据（对齐用户要求与项目纪律）：
//   · 真数据库（node:sqlite）落盘可用；数据在**重启后仍在**（关掉再起来读同一个库验证）；
//   · 用户系统：注册（首个用户=管理员）/ 登录 / 登出 / me；密码错 401；重名 409；弱密码 400；
//   · **每用户数据隔离**：B 读不到 A 的场景与文档（这是"给部署用"的底线）；
//   · 文档（settings/progress/draft）与场景 的 CRUD 往返一致；
//   · 旧数据导入：只填空位、**不覆盖**已有数据；
//   · 错误**详细**：401/400/404/405/409/403 都带 code + hint/details；
//   · 跨源：白名单 GET 带 allow-origin、OPTIONS 204、非白名单 403。
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5199;
const BASE = `http://localhost:${PORT}/api/v1`;
const ORIGIN = 'http://localhost:5188';
const TMP = join(APP, 'data', 'test-api');
const DBFILE = join(TMP, 'test.db');

const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
function startApi() {
  child = spawn(process.execPath, ['server-api.mjs'], {
    cwd: APP,
    env: { ...process.env, PORT_API: String(PORT), API_DB: DBFILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let boot = '';
  child.stdout.on('data', (d) => { boot += d.toString(); });
  child.stderr.on('data', (d) => { boot += d.toString(); });
  child.bootLog = () => boot;
  return child;
}
async function stopApi() {
  if (!child) return;
  const c = child; child = null;
  try { c.kill(); } catch { /* 已退出 */ }
  await sleep(250);
}
async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch { /* 未就绪 */ }
    await sleep(200);
  }
  return false;
}

const req = async (path, { method = 'GET', body, token, origin, raw } = {}) => {
  const headers = {};
  if (origin) headers.origin = origin;
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : (raw || JSON.stringify(body)) });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, json, headers: res.headers };
};

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
process.on('exit', () => { try { child && child.kill(); } catch { /* 忽略 */ } });
process.on('uncaughtException', async (e) => { console.log('崩溃：' + e.message); await stopApi(); process.exit(1); });

startApi();
if (!await waitUp()) {
  console.log('✗ 后端没起来（8 秒内探活失败）');
  console.log('  日志：' + (child ? child.bootLog().trim().slice(0, 500) : '(无)'));
  await stopApi(); process.exit(1);
}
console.log('  后端已就绪（SQLite 落盘：' + DBFILE.replace(APP, '.') + '）');

// ---------- ① 探活与跨源 ----------
let A = null;   // { user, token }
{
  const r = await req('/health', { origin: ORIGIN });
  ok(r.status === 200 && r.json.ok && r.json.db === 'sqlite' && r.json.users === 0, '① 探活：db=sqlite、用户数 0（新库）');
  ok(r.headers.get('access-control-allow-origin') === ORIGIN, '① 白名单来源带 allow-origin（跨源可用）');
  const evil = await req('/health', { origin: 'http://evil.example' });
  ok(evil.status === 403 && evil.json.code === 'ORIGIN_NOT_ALLOWED', '① 非白名单来源 → 403 + code（不假装允许）');
  const opt = await fetch(BASE + '/health', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization' } });
  ok(opt.status === 204 && (opt.headers.get('access-control-allow-headers') || '').includes('authorization'),
    '① 预检 204 且允许 authorization 头（前端带 token 跨源必需）');
}

// ---------- ② 用户系统 ----------
{
  const reg = await req('/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret123' }, origin: ORIGIN });
  A = { user: reg.json.user, token: reg.json.token };
  ok(reg.status === 200 && !!A.token && A.user.username === 'alice', '② 注册 alice → 200 + token');
  ok(A.user.isAdmin === true, '② **第一个注册的用户自动是管理员**（部署时用来建站）');
  const dupe = await req('/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret123' } });
  ok(dupe.status === 409 && dupe.json.code === 'USER_EXISTS' && dupe.json.hint, '② 重名 → 409 + code + hint');
  const weak = await req('/auth/register', { method: 'POST', body: { username: 'bob', password: '123' } });
  ok(weak.status === 400 && weak.json.code === 'BAD_PASSWORD', '② 弱密码 → 400 + code');
  const badName = await req('/auth/register', { method: 'POST', body: { username: 'a b!', password: 'secret123' } });
  ok(badName.status === 400 && badName.json.code === 'BAD_USERNAME', '② 非法用户名 → 400 + code');
  const wrong = await req('/auth/login', { method: 'POST', body: { username: 'alice', password: 'nope' } });
  ok(wrong.status === 401 && wrong.json.code === 'BAD_CREDENTIALS', '② 密码错 → 401 + code');
  const login = await req('/auth/login', { method: 'POST', body: { username: 'alice', password: 'secret123' } });
  ok(login.status === 200 && !!login.json.token, '② 正确密码登录 → 200 + 新 token');
  const me = await req('/auth/me', { token: login.json.token });
  ok(me.status === 200 && me.json.user.username === 'alice', '② GET /auth/me（带 Bearer）→ 200 + 用户信息');
  const noAuth = await req('/auth/me');
  ok(noAuth.status === 401 && noAuth.json.code === 'NO_TOKEN' && noAuth.json.hint, '② 不带 token → 401 + code + hint（错误足够详细）');
  const badTok = await req('/auth/me', { token: 'deadbeef' });
  ok(badTok.status === 401 && badTok.json.code === 'BAD_TOKEN', '② 假 token → 401 + code（BAD_TOKEN）');
  const out = await req('/auth/logout', { method: 'POST', token: login.json.token });
  const after = await req('/auth/me', { token: login.json.token });
  ok(out.status === 200 && after.status === 401 && after.json.code === 'BAD_TOKEN', '② 登出后旧 token 立刻失效');
  // 注册第二个用户（隔离测试用）
  const b = await req('/auth/register', { method: 'POST', body: { username: 'bob', password: 'secret123' } });
  ok(b.status === 200 && b.json.user.isAdmin === false, '② 第二个用户不是管理员');
  globalThis.B = { user: b.json.user, token: b.json.token };
}

// ---------- ③ 文档 CRUD（settings/progress/draft） ----------
for (const kind of ['settings', 'progress', 'draft']) {
  const before = await req('/' + kind, { token: A.token });
  const payload = { fromTest: true, kind, n: 7 };
  const put = await req('/' + kind, { method: 'PUT', body: payload, token: A.token });
  const after = await req('/' + kind, { token: A.token });
  ok(put.status === 200 && JSON.stringify(after.json.doc) === JSON.stringify(payload),
    `③ /${kind}：PUT → GET 往返一致（写入前 ${before.json.doc === null ? '空' : '有值'}）`);
}
{
  const badDoc = await req('/settings', { method: 'PUT', body: [1, 2], token: A.token });
  ok(badDoc.status === 400 && badDoc.json.code === 'BAD_DOC' && badDoc.json.details, '③ body 是数组 → 400 + code + details');
  const unknown = await req('/nope', { token: A.token });
  ok(unknown.status === 404 && unknown.json.code === 'NO_ROUTE' && unknown.json.hint, '③ 未知接口 → 404 + code + hint');
}

// ---------- ④ 场景 CRUD + 每用户隔离 ----------
let sid = null;
{
  const post = await req('/scenes', { method: 'POST', body: { name: 'A 的场景', data: { entities: [1, 2, 3] } }, token: A.token });
  sid = post.json.id;
  ok(post.status === 200 && !!sid, `④ A 建场景 → id=${sid}`);
  const list = await req('/scenes', { token: A.token });
  ok(list.json.scenes.some((s) => s.id === sid && s.name === 'A 的场景' && s.bytes > 0), '④ A 的列表里能看到（含名字/时间/体积）');
  const one = await req('/scenes/' + sid, { token: A.token });
  ok(one.status === 200 && one.json.doc.data.entities.length === 3, '④ A 取到完整内容');
  // ★ 隔离：B 不能看 / 不能改 / 不能删 A 的场景
  const bList = await req('/scenes', { token: globalThis.B.token });
  ok(bList.json.scenes.length === 0, '④ **B 的列表是空的**（数据按用户隔离）');
  const bGet = await req('/scenes/' + sid, { token: globalThis.B.token });
  ok(bGet.status === 404 && bGet.json.code === 'SCENE_NOT_FOUND', `④ B 取 A 的场景 → 404（实测 ${bGet.status}）`);
  const bDel = await req('/scenes/' + sid, { method: 'DELETE', token: globalThis.B.token });
  ok(bDel.status === 404, '④ B 删 A 的场景 → 404（删不掉）');
  const stillThere = await req('/scenes/' + sid, { token: A.token });
  ok(stillThere.status === 200, '④ A 的场景安然无恙 ✓');
  // 其余常规操作
  const put = await req('/scenes/' + sid, { method: 'PUT', body: { name: '改名了' }, token: A.token });
  const after = await req('/scenes/' + sid, { token: A.token });
  ok(put.status === 200 && put.json.created === false && after.json.doc.name === '改名了', '④ PUT 覆盖生效（created=false）');
  const del = await req('/scenes/' + sid, { method: 'DELETE', token: A.token });
  const gone = await req('/scenes/' + sid, { token: A.token });
  ok(del.status === 200 && gone.status === 404, '④ DELETE 后 GET → 404');
  const badId = await req('/scenes/..%2Fsecret', { token: A.token });
  ok(badId.status === 400 && badId.json.code === 'BAD_ID', '④ 路径穿越式 id → 400 + code');
}

// ---------- ⑤ 旧数据自动导入（只填空位、不覆盖） ----------
{
  const imp = await req('/import', {
    method: 'POST', token: globalThis.B.token,
    body: { docs: { settings: { legacy: true }, progress: { legacy: 1 } }, scenes: [{ id: 'old1', name: '旧场景', data: { entities: [] } }] },
  });
  ok(imp.status === 200 && imp.json.applied.docs.length === 2 && imp.json.applied.scenes === 1, '⑤ 导入旧数据 → 2 份文档 + 1 个场景');
  const again = await req('/import', {
    method: 'POST', token: globalThis.B.token,
    body: { docs: { settings: { legacy: 'CHANGED' } }, scenes: [{ id: 'old1', name: '改了' }] },
  });
  const doc = await req('/settings', { token: globalThis.B.token });
  ok(again.json.skipped >= 2 && doc.json.doc.legacy === true, '⑤ 再导入**不覆盖**已有数据（导入只填空位）');
}

// ---------- ⑥ 数据在重启后仍在（真数据库） ----------
{
  await stopApi();
  startApi();
  const up = await waitUp();
  ok(up, '⑥ 关掉后端再起来：仍然可用（数据库落盘）');
  const me = await req('/auth/me', { token: A.token });
  ok(me.status === 200 && me.json.user.username === 'alice', '⑥ 重启后 A 的会话与用户仍在 ✓');
  const list = await req('/scenes', { token: globalThis.B.token });
  ok(list.json.scenes.some((s) => s.id === 'old1' && s.name === '旧场景'), '⑥ 重启后 B 的导入场景仍在 ✓');
}

// ---------- 收尾 ----------
await stopApi();
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：SQLite 数据库 + 用户系统 + 每用户隔离 + 旧数据导入 + 详细错误 + 跨源 全部符合');
