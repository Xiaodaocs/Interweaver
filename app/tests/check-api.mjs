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
import { deflateSync } from 'node:zlib';

/* ---------- 现生成一张真 PNG（零依赖：自己拼 PNG 块 + 自写 CRC32）----------
   为什么不用现成的图片文件：仓库里不放二进制样本，测试也不该依赖某张图还在不在。
   这段只服务"头像支持本地上传"那一组断言：需要一段**真的** PNG 字节（魔数/内容都要对得上）。 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function makePng(w, h, fill = (x, y) => [(x * 37) & 255, (y * 53) & 255, 128]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                                        // 每行的 filter type = 0（None）
    for (let x = 0; x < w; x++) { const [r, g, b] = fill(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;    // 8bit / truecolor / deflate / 无隔行
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),      // PNG 魔数
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

// ---------- ⑦ 改资料：PATCH /me（用户名 / 头像）----------
// 对齐用户要求：设置页「我的」里改用户名与头像 → 后端 PATCH /api/v1/me。
// 判据：只改传进来的字段；用户名 3~20 位字母/数字/下划线/中文且唯一；头像 = 内置符号 + 主题色、逐字 ≤ 32；
//       **改完旧 token 仍然有效**；错误仍是既有形状（code + error + hint/details）。
{
  const noTok = await req('/me', { method: 'PATCH', body: { username: 'nobody1' } });
  ok(noTok.status === 401 && noTok.json.code === 'NO_TOKEN' && noTok.json.hint, '⑦ 不带 token 改资料 → 401 + NO_TOKEN + hint');
  const none = await req('/me', { method: 'PATCH', token: A.token, body: {} });
  ok(none.status === 400 && none.json.code === 'NO_FIELDS' && none.json.hint, '⑦ 请求体里没有可改字段 → 400 + NO_FIELDS + hint');

  // 改用户名：成功 + **旧 token 仍有效** + GET /me 带上新字段
  const rn = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'alice2' } });
  ok(rn.status === 200 && rn.json.user.username === 'alice2', `⑦ PATCH /me 改用户名 → 200 + 新名字（实测 ${rn.json.user && rn.json.user.username}）`);
  const stillOk = await req('/auth/me', { token: A.token });
  ok(stillOk.status === 200 && stillOk.json.user.username === 'alice2', '⑦ **旧 token 仍然有效**（改完不用重新登录）');
  const gme = await req('/me', { token: A.token });
  ok(gme.status === 200 && Object.prototype.hasOwnProperty.call(gme.json.user, 'avatar'),
    '⑦ GET /api/v1/me 可用，且返回里带 avatar 字段（前端据此刷新）');

  // 冲突与格式：两类错误都必须是**明确的 code**（前端要原样显示给用户）
  const dupName = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'bob' } });
  ok(dupName.status === 409 && dupName.json.code === 'USER_EXISTS' && dupName.json.hint, '⑦ 改成别人已占用的名字 → 409 + USER_EXISTS + hint');
  const shortName = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'ab' } });
  ok(shortName.status === 400 && shortName.json.code === 'BAD_USERNAME' && shortName.json.hint, '⑦ 用户名太短（<3）→ 400 + BAD_USERNAME + hint');
  const badName = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'a b!' } });
  ok(badName.status === 400 && badName.json.code === 'BAD_USERNAME', '⑦ 用户名含空格/符号 → 400 + BAD_USERNAME');
  const longName = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'x'.repeat(21) } });
  ok(longName.status === 400 && longName.json.code === 'BAD_USERNAME', '⑦ 用户名超过 20 字符 → 400 + BAD_USERNAME');
  const cnName = await req('/me', { method: 'PATCH', token: A.token, body: { username: '数学迷_01' } });
  ok(cnName.status === 200 && cnName.json.user.username === '数学迷_01', '⑦ 中文 + 下划线 + 数字是合法用户名');

  // 头像：符号 + 主题色（白名单校验）
  const av = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: '⟡|#5E5CE6' } });
  ok(av.status === 200 && av.json.user.avatar === '⟡|#5E5CE6', '⑦ PATCH /me 存头像（"符号|#RRGGBB"）');
  const avBack = await req('/auth/me', { token: A.token });
  ok(avBack.json.user.avatar === '⟡|#5E5CE6', '⑦ 头像能读回来（GET /auth/me 与 GET /me 同一形状）');
  const longAv = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'x'.repeat(33) } });
  ok(longAv.status === 400 && longAv.json.code === 'BAD_AVATAR' && longAv.json.details && longAv.json.details.max === 32,
    '⑦ 头像超过 32 字符 → 400 + BAD_AVATAR + details.max=32（长度是硬上限）');
  const badSym = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: '💥|#5E5CE6' } });
  ok(badSym.status === 400 && badSym.json.code === 'BAD_AVATAR', '⑦ 非内置符号 → 400 + BAD_AVATAR（白名单拒绝）');
  const badCol = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: '⟡|red' } });
  ok(badCol.status === 400 && badCol.json.code === 'BAD_AVATAR', '⑦ 非主题色 → 400 + BAD_AVATAR');

  /* ---------- ⑦b 头像第二种形态：本地上传的图片（data URL）----------
     用户要求：头像要支持本地上传，同时保留"内置符号 + 颜色"作为默认值与兜底。
     后端只做**严格校验**（前缀 / base64 / 解码长度 / 魔数），不落文件、不引图片库。
     判据：合法能存能读、重启还在；SVG / 超大 / 坏 base64 / 冒名格式一律 400 + BAD_AVATAR。 */
  const pngUrl = 'data:image/png;base64,' + Buffer.from(makePng(8, 8)).toString('base64');
  const upOk = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: pngUrl } });
  ok(upOk.status === 200 && upOk.json.user.avatar === pngUrl,
    `⑦b 上传的图片（data:image/png;base64,…）能存进去，且原样读回来（${pngUrl.length} 字符）`);
  const upBack = await req('/me', { token: A.token });
  ok(upBack.status === 200 && upBack.json.user.avatar === pngUrl, '⑦b GET /me 读回来的还是那个 data URL（前端据此渲染 <img>）');

  // 落盘：重启后端，图片头像必须还在（users.avatar 是 TEXT —— 结构一行没动，本来就放得下）
  await stopApi(); startApi();
  ok(await waitUp(), '⑦b 存完图片再重启后端：可用');
  const upBoot = await req('/me', { token: A.token });
  ok(upBoot.json.user.avatar === pngUrl, '⑦b 重启后图片头像还在（真落盘，不是内存里的）');

  // ★ 明确拒绝 SVG：这不是"不支持"，而是**必须拒绝**（可执行文档 → 存储型 XSS）——
  //   所以 error 文本里必须写清理由，hint 里给出可行替代。
  const svgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>').toString('base64');
  const svgRes = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/svg+xml;base64,' + svgB64 } });
  ok(svgRes.status === 400 && svgRes.json.code === 'BAD_AVATAR' && /SVG/.test(svgRes.json.error) && /XSS/.test(svgRes.json.error) && /PNG/.test(svgRes.json.hint || ''),
    '⑦b SVG 头像被明确拒绝（400 + BAD_AVATAR，error 写明"可执行文档 → XSS"，hint 让人换 PNG/JPEG/WebP）');
  const svgRaw = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/svg+xml,<svg onload="alert(1)"></svg>' } });
  ok(svgRaw.status === 400 && svgRaw.json.code === 'BAD_AVATAR', '⑦b 非 base64 的 SVG data URL 同样被拒（只认 ;base64, 形式）');

  // 超大：解码后 64KB 是**硬上限**
  const bigUrl = 'data:image/png;base64,' + Buffer.concat([makePng(8, 8), Buffer.alloc(70 * 1024, 7)]).toString('base64');
  const bigRes = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: bigUrl } });
  ok(bigRes.status === 400 && bigRes.json.code === 'BAD_AVATAR' && bigRes.json.details && bigRes.json.details.max === 64 * 1024 && /太大/.test(bigRes.json.hint || ''),
    `⑦b 解码后超过 64KB → 400 + BAD_AVATAR，hint 是"图片太大，请换一张或重试"（details.max=${bigRes.json.details && bigRes.json.details.max}）`);
  // 整个字符串长度也另有一道上限（base64 比原图大 1/3，所以 80KB 的字节先撞到字符串上限）
  const hugeRes = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/png;base64,' + Buffer.alloc(80 * 1024, 7).toString('base64') } });
  ok(hugeRes.status === 400 && hugeRes.json.code === 'BAD_AVATAR' && hugeRes.json.details && hugeRes.json.details.max === 96 * 1024,
    `⑦b data URL 字符串长度超过 96KB → 400 + BAD_AVATAR（总长度另有上限，details.max=${hugeRes.json.details && hugeRes.json.details.max}）`);

  // 坏 base64：非法字符 / 长度不是 4 的倍数 / 内容与声明不符
  const badB64 = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/png;base64,!!!!not-base64!!!!' } });
  ok(badB64.status === 400 && badB64.json.code === 'BAD_AVATAR' && /base64/.test(badB64.json.error), '⑦b base64 里含非法字符 → 400 + BAD_AVATAR');
  const cutB64 = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/png;base64,AAAAA' } });
  ok(cutB64.status === 400 && cutB64.json.code === 'BAD_AVATAR' && /4 的倍数/.test(cutB64.json.error), '⑦b base64 长度不是 4 的倍数（数据被截断）→ 400 + BAD_AVATAR');
  const gifRes = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } });
  ok(gifRes.status === 400 && gifRes.json.code === 'BAD_AVATAR' && gifRes.json.details && Array.isArray(gifRes.json.details.allowed) && gifRes.json.details.allowed.length === 3,
    `⑦b 只放行 png/jpeg/webp（GIF → 400 + BAD_AVATAR，details.allowed=${JSON.stringify(gifRes.json.details && gifRes.json.details.allowed)}）`);
  const fakePng = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: 'data:image/png;base64,' + Buffer.from('hello world, not a png').toString('base64') } });
  ok(fakePng.status === 400 && fakePng.json.code === 'BAD_AVATAR' && /不符/.test(fakePng.json.error), '⑦b 声明 png 但内容不是 PNG（魔数不符）→ 400 + BAD_AVATAR');
  const untouched = await req('/me', { token: A.token });
  ok(untouched.json.user.avatar === pngUrl, '⑦b 一连串非法请求之后，账号上存的仍是那张合法图片（拒绝 = 一个字节都不动）');

  // 恢复内置：再存一个 "符号|#RRGGBB" 就切回来了 —— 两种形态同一个字段，不需要额外接口
  const backGlyph = await req('/me', { method: 'PATCH', token: A.token, body: { avatar: '⟡|#5E5CE6' } });
  ok(backGlyph.status === 200 && backGlyph.json.user.avatar === '⟡|#5E5CE6',
    '⑦b 「恢复内置头像」= 再存一个 "符号|#RRGGBB" → 200（同一个字段，两种形态）');
  const m405 = await req('/me', { method: 'PUT', token: A.token });
  ok(m405.status === 405 && m405.json.code === 'METHOD_NOT_ALLOWED', '⑦ PUT /me → 405 + code（只支持 GET / PATCH）');

  // 跨源预检必须允许 PATCH：前端 5188 ↔ 后端 5189 不同源，缺了它浏览器会直接拦掉
  const pre = await fetch(BASE + '/me', {
    method: 'OPTIONS',
    headers: { origin: ORIGIN, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' },
  });
  ok(pre.status === 204 && (pre.headers.get('access-control-allow-methods') || '').includes('PATCH'),
    '⑦ 预检允许 PATCH（跨源改名/换头像才真的发得出去）');

  // 落盘：再重启一次，用户名与头像都还在
  await stopApi(); startApi();
  ok(await waitUp(), '⑦ 改完资料再重启后端：可用');
  const afterBoot = await req('/me', { token: A.token });
  ok(afterBoot.json.user.username === '数学迷_01' && afterBoot.json.user.avatar === '⟡|#5E5CE6', '⑦ 重启后用户名与头像都在（真落盘，不是内存）');
  const backName = await req('/me', { method: 'PATCH', token: A.token, body: { username: 'alice' } });
  ok(backName.status === 200 && backName.json.user.username === 'alice', '⑦ 改回原名也走得通（唯一性检查认得自己）');
}

// ---------- ⑧ 老库兼容：users 表没有 avatar 列时，启动自动 ALTER TABLE ----------
// 这一段**故意手写一个"旧版本"的库**（users 没有 avatar 列 + 一个用户 + 一个会话），
// 再用它启动后端：能起来、列被补上、老用户读出来 avatar=null、新头像能存进去 —— 才算"兼容已存在的库"。
{
  const { DatabaseSync } = await import('node:sqlite');
  const LEG_PORT = 5209;
  const LEG_BASE = `http://localhost:${LEG_PORT}/api/v1`;
  const legFile = join(TMP, 'legacy.db');
  const ldb = new DatabaseSync(legFile);
  ldb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, ua TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE docs (user_id INTEGER NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind));
    CREATE TABLE scenes (id TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id));
    INSERT INTO users (username, salt, hash, is_admin, created_at) VALUES ('olduser', '00', '00', 0, 1);
    INSERT INTO sessions (token, user_id, created_at, expires_at, ua)
      VALUES ('legacytoken', 1, 1, ${Date.now() + 86400_000}, 'check-api');
  `);
  ldb.close();

  const leg = spawn(process.execPath, ['server-api.mjs'], {
    cwd: APP, env: { ...process.env, PORT_API: String(LEG_PORT), API_DB: legFile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let legBoot = '';
  leg.stdout.on('data', (d) => { legBoot += d.toString(); });
  leg.stderr.on('data', (d) => { legBoot += d.toString(); });
  const legReq = async (path, opt = {}) => {
    const headers = {};
    if (opt.token) headers.authorization = 'Bearer ' + opt.token;
    if (opt.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(LEG_BASE + path, { method: opt.method || 'GET', headers, body: opt.body === undefined ? undefined : JSON.stringify(opt.body) });
    let j = null; try { j = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, json: j };
  };
  let legUp = false;
  for (let i = 0; i < 40; i++) { try { const r = await fetch(LEG_BASE + '/health'); if (r.ok) { legUp = true; break; } } catch { /* 未就绪 */ } await sleep(200); }
  ok(legUp, '⑧ 用"旧结构"的库也能起来（自动迁移，不需要手工改库）');
  if (legUp) {
    const me0 = await legReq('/me', { token: 'legacytoken' });
    ok(me0.status === 200 && me0.json.user.username === 'olduser' && me0.json.user.avatar === null,
      '⑧ 老用户读出来 avatar=null（没设置过就是 null，不编造默认值）');
    const set0 = await legReq('/me', { method: 'PATCH', token: 'legacytoken', body: { avatar: 'π|#D9822B' } });
    const me1 = await legReq('/me', { token: 'legacytoken' });
    ok(set0.status === 200 && me1.json.user.avatar === 'π|#D9822B', '⑧ 老库补列之后能存头像，且读得回来');
    // 兼容老库必须覆盖**新形态**：ALTER 补出来的列同样是 TEXT → 上传的图片（data URL）也存得下。
    const legPng = 'data:image/png;base64,' + Buffer.from(makePng(8, 8)).toString('base64');
    const setLegImg = await legReq('/me', { method: 'PATCH', token: 'legacytoken', body: { avatar: legPng } });
    const legImgBack = await legReq('/me', { token: 'legacytoken' });
    ok(setLegImg.status === 200 && legImgBack.json.user.avatar === legPng,
      '⑧ 老库补列之后也能存 data URL 头像（老账号同样能上传本地图片）');
    await legReq('/me', { method: 'PATCH', token: 'legacytoken', body: { avatar: 'π|#D9822B' } });   // 复原，下面按原值比对重启后的读回
    ok(/迁移/.test(legBoot), '⑧ 启动日志里能看到"补列"这一步（迁移真的跑了，而不是库恰好就是新结构）');
    leg.kill();
    await sleep(300);
    const leg2 = spawn(process.execPath, ['server-api.mjs'], {
      cwd: APP, env: { ...process.env, PORT_API: String(LEG_PORT), API_DB: legFile }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let up2 = false;
    for (let i = 0; i < 40; i++) { try { const r = await fetch(LEG_BASE + '/health'); if (r.ok) { up2 = true; break; } } catch { /* 未就绪 */ } await sleep(200); }
    const me2 = up2 ? await legReq('/me', { token: 'legacytoken' }) : { json: null };
    ok(up2 && me2.json && me2.json.user.avatar === 'π|#D9822B', '⑧ 第二次启动同一（已迁移过的）库仍然正常 —— 迁移幂等');
    try { leg2.kill(); } catch { /* 已退出 */ }
  } else {
    console.log('  迁移日志：' + legBoot.trim().slice(0, 300));
  }
  try { leg.kill(); } catch { /* 已退出 */ }
  await sleep(250);
}

// ---------- 收尾 ----------
await stopApi();
try { await rm(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：SQLite 数据库 + 用户系统 + 每用户隔离 + 旧数据导入 + 详细错误 + 跨源 全部符合');
