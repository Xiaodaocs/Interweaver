// 交织者后端 API（**与前端不同源**）：零依赖，数据落地为 data/*.json
//
// 为什么要有它（用户要求"分开前后端，不再使用前后端同源"）：
//   此前 server.mjs 既发静态页面又"顺带"当后端 —— 其实一行后端逻辑都没有，
//   所有用户数据（设置/进度/草稿/场景）都躺在浏览器的 localStorage 里。
//   现在把**用户数据**搬到真正的后端：前端静态服务（默认 5188）与 API 服务（默认 5189）
//   是两个来源，跨源访问必须走 CORS 白名单。
//
// 纪律（对齐本项目的既有规矩）：
//   · 零第三方依赖：只用 node: 内置模块；
//   · **绝不假装成功**：任何失败都返回明确的状态码 + {ok:false,error}，
//     不静默退回、不返回假数据（前端据此显式报错）；
//   · 写入**原子**：先写 <file>.tmp 再 rename 覆盖，避免半截文件；
//   · 数据放在 app/data/（运行时生成，不进 git）。
import http from 'node:http';
import { readFile, writeFile, mkdir, rename, readdir, unlink, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const SCENES_DIR = join(DATA_DIR, 'scenes');
const PORT = Number(process.env.PORT_API || 5189);
const API_VERSION = 'v1';

// 允许来源白名单：前端静态服务的来源（可加，不要用 *）
const ALLOWED_ORIGINS = (process.env.API_ORIGINS
  || 'http://localhost:5188,http://127.0.0.1:5188').split(',').map((s) => s.trim()).filter(Boolean);

const MAX_BODY = 8 * 1024 * 1024;          // 8 MB：场景文件够用，避免被塞爆
const DOCS = new Set(['settings', 'progress', 'draft']);   // 单文档集合

// ---------- 小工具 ----------
// CORS 头**显式**挂在每个响应上（在请求入口算一次、存到 res.__cors）。
// ★ 刻意不 monkey-patch http.ServerResponse.prototype —— 那会污染 Node 内置原型、
//   把"跨源策略"变成全局隐式副作用，属于本项目明令避免的那类写法。
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

const corsHeaders = (origin) => {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// 原子写：临时文件 + rename（同目录 rename 在 Windows 上也是原子的）
async function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(obj), 'utf8');
  await rename(tmp, file);
}

const sceneIdOf = (raw) => {
  // 只允许安全字符组成 id，避免路径穿越
  const id = String(raw || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
};

async function listScenes() {
  const out = [];
  let names = [];
  try { names = await readdir(SCENES_DIR); } catch { return out; }
  for (const n of names) {
    if (extname(n) !== '.json') continue;
    const id = n.slice(0, -5);
    try {
      const doc = await readJson(join(SCENES_DIR, n));
      const st = await stat(join(SCENES_DIR, n));
      out.push({ id, name: (doc && doc.name) || id, savedAt: st.mtimeMs, bytes: st.size });
    } catch { /* 坏文件跳过（不让一个坏文件毁掉整个列表） */ }
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

// ---------- 路由 ----------
async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  const parts = p.split('/').filter(Boolean);   // ['api','v1', ...]

  if (parts[0] !== 'api' || parts[1] !== API_VERSION) {
    return json(res, 404, { ok: false, error: `未知路径 ${p}（本服务的接口都在 /api/${API_VERSION}/ 下）` });
  }
  const rest = parts.slice(2);

  // 探活
  if (method === 'GET' && rest.length === 1 && rest[0] === 'health') {
    return json(res, 200, { ok: true, service: 'interweaver-api', version: API_VERSION, dataDir: DATA_DIR, time: Date.now() });
  }

  // 单文档：settings / progress / draft
  if (rest.length === 1 && DOCS.has(rest[0])) {
    const file = join(DATA_DIR, rest[0] + '.json');
    if (method === 'GET') {
      const doc = await readJson(file);
      return json(res, 200, { ok: true, doc });
    }
    if (method === 'PUT') {
      const text = await readBody(req);
      let doc;
      try { doc = JSON.parse(text); } catch { return json(res, 400, { ok: false, error: 'body 不是合法 JSON' }); }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return json(res, 400, { ok: false, error: 'body 必须是对象' });
      }
      await writeJsonAtomic(file, doc);
      return json(res, 200, { ok: true, savedAt: Date.now() });
    }
    return json(res, 405, { ok: false, error: `${method} 不支持（这里是 GET / PUT）` });
  }

  // 场景集合
  if (rest[0] === 'scenes') {
    if (rest.length === 1) {
      if (method === 'GET') return json(res, 200, { ok: true, scenes: await listScenes() });
      if (method === 'POST') {
        const text = await readBody(req);
        let body;
        try { body = JSON.parse(text); } catch { return json(res, 400, { ok: false, error: 'body 不是合法 JSON' }); }
        const id = sceneIdOf(body && body.id) || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        if (!sceneIdOf(id)) return json(res, 400, { ok: false, error: 'id 非法（只允许字母数字_-，≤64）' });
        const doc = { id, name: String((body && body.name) || '未命名场景'), savedAt: Date.now(), data: (body && body.data) ?? null };
        await writeJsonAtomic(join(SCENES_DIR, id + '.json'), doc);
        return json(res, 200, { ok: true, id });
      }
      return json(res, 405, { ok: false, error: `${method} 不支持（这里是 GET / POST）` });
    }
    const id = sceneIdOf(rest[1]);
    if (!id) return json(res, 400, { ok: false, error: 'id 非法' });
    const file = join(SCENES_DIR, id + '.json');
    if (method === 'GET') {
      const doc = await readJson(file);
      if (!doc) return json(res, 404, { ok: false, error: `没有场景 ${id}` });
      return json(res, 200, { ok: true, doc });
    }
    if (method === 'PUT') {
      const text = await readBody(req);
      let body;
      try { body = JSON.parse(text); } catch { return json(res, 400, { ok: false, error: 'body 不是合法 JSON' }); }
      const doc = { id, name: String((body && body.name) || '未命名场景'), savedAt: Date.now(), data: (body && body.data) ?? null };
      await writeJsonAtomic(file, doc);
      return json(res, 200, { ok: true, id });
    }
    if (method === 'DELETE') {
      try { await unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return json(res, 200, { ok: true, deleted: id });
    }
    return json(res, 405, { ok: false, error: `${method} 不支持（这里是 GET / PUT / DELETE）` });
  }

  return json(res, 404, { ok: false, error: `未知接口 ${p}` });
}

// ---------- 启动 ----------
await mkdir(SCENES_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const origin = req.headers.origin;
  // 每个响应用的 CORS 头在入口算一次（json() 会带上它）
  res.__cors = corsHeaders(origin);

  // 预检：来自白名单就直接放行，否则 403（不假装允许）
  if (req.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      res.writeHead(403, {}); res.end(); return;
    }
    res.writeHead(204, res.__cors); res.end(); return;
  }
  // 带 Origin 但不是白名单 → 明确 403（浏览器会拦住响应，但服务端态度要明确）
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(res, 403, { ok: false, error: `来源 ${origin} 不在白名单里` });
  }

  try {
    await handle(req, res, url);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    // 绝不吞错：把原因如实返回（前端据此显式报错，而不是"看起来成功了"）
    json(res, status, { ok: false, error: (e && e.message) || '服务端异常' });
  }
});

server.listen(PORT, () => {
  console.log(`Interweaver API → http://localhost:${PORT}/api/${API_VERSION}/health`);
  console.log(`  数据目录：${DATA_DIR}`);
  console.log(`  允许来源：${ALLOWED_ORIGINS.join(', ')}`);
});
