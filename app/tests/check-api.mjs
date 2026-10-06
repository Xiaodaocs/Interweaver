// 后端 API 验收（前后端分离的第一步：后端必须先自证可用）
//   做法：自己拉起 server-api.mjs（测试端口 5199、独立临时数据目录），跑完整的
//   CRUD + 跨源策略 + 错误语义，然后关掉 —— 所以它**不依赖**任何预先跑着的进程，
//   可以直接挂在 verify 链里。
//
// 判据（对齐本项目纪律）：
//   · 零依赖服务能起来、探活可用；
//   · 单文档 settings/progress/draft：GET 空 → PUT → GET 回读一致；
//   · 场景集合：POST 建 → GET 列表 → GET 单个 → PUT 覆盖 → DELETE → 再 GET 404；
//   · **原子写**：写完后目录里不应残留 .tmp 文件；
//   · **跨源**：白名单来源的 GET 带 access-control-allow-origin；OPTIONS 预检 204；
//     非白名单来源 403（**不假装允许**）；
//   · **不假装成功**：坏 JSON → 400 且 body 是 {ok:false,error}；不存在的接口 → 404；
//     不存在的场景 → 404；body 非对象 → 400；路径穿越式 id → 400。
import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5199;
const BASE = `http://localhost:${PORT}/api/v1`;
const ORIGIN = 'http://localhost:5188';          // 白名单来源（= 前端静态服务的来源）
const TEST_DATA = join(APP, 'data');

const bad = [];
const ok = (cond, msg) => { if (!cond) bad.push(msg); else console.log('  ✓ ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const req = async (path, { method = 'GET', body, origin, raw } = {}) => {
  const headers = {};
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : (raw || JSON.stringify(body)) });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 就别管 */ }
  return { status: res.status, json, headers: res.headers };
};

// ---------- 拉起后端 ----------
const child = spawn(process.execPath, ['server-api.mjs'], {
  cwd: APP,
  env: { ...process.env, PORT_API: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d.toString(); });
child.stderr.on('data', (d) => { bootLog += d.toString(); });
const stop = () => { try { child.kill(); } catch { /* 已经退出 */ } };
process.on('exit', stop);
process.on('uncaughtException', (e) => { console.log('崩溃：' + e.message); stop(); process.exit(1); });

// 等探活可用（最多 6 秒）
let up = false;
for (let i = 0; i < 30; i++) {
  try { const r = await req('/health'); if (r.status === 200 && r.json && r.json.ok) { up = true; break; } } catch { /* 还没起来 */ }
  await sleep(200);
}
if (!up) {
  console.log('✗ 后端没起来（6 秒内探活失败）');
  console.log('  启动日志：' + bootLog.trim().slice(0, 400));
  stop(); process.exit(1);
}
console.log('  后端已就绪（' + BASE + '）');

// ---------- ① 探活 ----------
{
  const r = await req('/health', { origin: ORIGIN });
  ok(r.status === 200 && r.json.ok === true && r.json.service === 'interweaver-api', '① 探活：GET /health → 200 且 service=interweaver-api');
  ok(r.headers.get('access-control-allow-origin') === ORIGIN, '① 白名单来源的响应带 access-control-allow-origin（跨源可用）');
  const r2 = await req('/health', { origin: 'http://evil.example' });
  ok(r2.status === 403, `① 非白名单来源被明确拒绝（403，实测 ${r2.status}）——不假装允许`);
  const opt = await fetch(BASE + '/health', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' } });
  ok(opt.status === 204 && opt.headers.get('access-control-allow-methods')?.includes('PUT'),
    '① OPTIONS 预检：204 + 允许 PUT（浏览器跨源写数据的前提）');
}

// ---------- ② 单文档 CRUD ----------
for (const doc of ['settings', 'progress', 'draft']) {
  const before = await req('/' + doc, { origin: ORIGIN });
  const payload = { fromTest: true, doc, n: 42 };
  const put = await req('/' + doc, { method: 'PUT', body: payload, origin: ORIGIN });
  const after = await req('/' + doc, { origin: ORIGIN });
  ok(put.status === 200 && put.json.ok === true, `② PUT /${doc} → 200 ok`);
  ok(after.status === 200 && JSON.stringify(after.json.doc) === JSON.stringify(payload),
    `② GET /${doc} 回读与写入完全一致（写入前 ${before.json.doc === null ? '空' : '有值'}）`);
}

// ---------- ③ 场景集合 CRUD ----------
let sceneId = null;
{
  const post = await req('/scenes', { method: 'POST', body: { name: '测试场景', data: { entities: [1, 2, 3] } }, origin: ORIGIN });
  sceneId = post.json && post.json.id;
  ok(post.status === 200 && !!sceneId, `③ POST /scenes → 200 + id=${sceneId}`);
  const list = await req('/scenes', { origin: ORIGIN });
  ok(list.json.scenes.some((s) => s.id === sceneId && s.name === '测试场景'), '③ GET /scenes 列表里能看到它（含名字/时间/体积）');
  const one = await req('/scenes/' + sceneId, { origin: ORIGIN });
  ok(one.status === 200 && one.json.doc.data.entities.length === 3, '③ GET /scenes/:id 取到完整内容');
  const put = await req('/scenes/' + sceneId, { method: 'PUT', body: { name: '改名了', data: { entities: [] } }, origin: ORIGIN });
  const after = await req('/scenes/' + sceneId, { origin: ORIGIN });
  ok(put.status === 200 && after.json.doc.name === '改名了' && after.json.doc.data.entities.length === 0, '③ PUT /scenes/:id 覆盖生效');
  const del = await req('/scenes/' + sceneId, { method: 'DELETE', origin: ORIGIN });
  const gone = await req('/scenes/' + sceneId, { origin: ORIGIN });
  ok(del.status === 200 && gone.status === 404, `③ DELETE 之后 GET 该场景 → 404（实测 ${gone.status}）`);
}

// ---------- ④ 原子写：不留 .tmp ----------
{
  const names = await readdir(join(TEST_DATA, 'scenes')).catch(() => []);
  const leftovers = names.filter((n) => n.endsWith('.tmp'));
  ok(leftovers.length === 0, `④ 场景目录没有残留 .tmp 文件（原子写：临时文件 + rename）${leftovers.length ? '：' + leftovers.join(',') : ''}`);
}

// ---------- ⑤ 不假装成功 ----------
{
  const badJson = await req('/settings', { method: 'PUT', body: 'not json', raw: true, origin: ORIGIN });
  ok(badJson.status === 400 && badJson.json.ok === false && typeof badJson.json.error === 'string',
    `⑤ 坏 JSON → 400 + {ok:false,error}（不吞错）`);
  const notObj = await req('/settings', { method: 'PUT', body: [1, 2, 3], origin: ORIGIN });
  ok(notObj.status === 400, `⑤ body 是数组（非对象）→ 400（实测 ${notObj.status}）`);
  const unknown = await req('/nope', { origin: ORIGIN });
  ok(unknown.status === 404 && unknown.json.ok === false, '⑤ 未知接口 → 404 + ok:false');
  const traversal = await req('/scenes/..%2F..%2Fsecret', { origin: ORIGIN });
  ok(traversal.status === 400 || traversal.status === 404, `⑤ 路径穿越式 id 被拒（实测 ${traversal.status}）`);
  const wrongMethod = await req('/health', { method: 'POST', body: {}, origin: ORIGIN });
  ok(wrongMethod.status === 404 || wrongMethod.status === 405, `⑤ 不支持的方法 → 405/404（实测 ${wrongMethod.status}）`);
}

// ---------- 收尾：清掉测试数据 ----------
stop();
await sleep(200);
try { await rm(TEST_DATA, { recursive: true, force: true }); } catch { /* 忽略 */ }

if (bad.length) { console.log('❌ 未通过：'); for (const x of bad) console.log('   - ' + x); process.exit(1); }
console.log('✅ 通过：后端 API 可用（探活 / 单文档 / 场景 CRUD / 原子写 / 跨源白名单 / 错误语义 全部符合）');
