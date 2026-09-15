// S7 · 场景仓库
//
// 存储分层（按计划）：成就/知识网是小数据 → localStorage；场景（可能很大）→ IndexedDB。
// 三个工程要求：
//   ① 后端可注入 → Node 单测能跑（浏览器里用 IndexedDB，测试里用内存后端）；
//   ② IndexedDB 不可用（隐私模式等）时**降级到内存**并明确告知调用方，不静默丢数据；
//   ③ 所有写操作返回结果对象，UI 能据实提示，不抛到主循环。
export const SCENE_STORE_VERSION = 1;
const DB_NAME = 'interweaver';
const STORE = 'scenes';

/** 内存后端（也是降级方案）；接口与 IndexedDB 后端一致 */
export function memoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    async all() { return [...m.values()]; },
    async get(id) { return m.get(id) || null; },
    async put(rec) { m.set(rec.id, rec); return true; },
    async remove(id) { m.delete(id); return true; },
    async count() { return m.size; },
  };
}

/** IndexedDB 后端；打开失败返回 null，由 createSceneStore 决定降级 */
export function idbBackend(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return null;
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, SCENE_STORE_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const out = fn(store);
      t.oncomplete = () => resolve(out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    kind: 'indexeddb',
    all: () => tx('readonly', (s) => s.getAll()),
    get: (id) => tx('readonly', (s) => s.get(id)),
    put: (rec) => tx('readwrite', (s) => { s.put(rec); return true; }),
    remove: (id) => tx('readwrite', (s) => { s.delete(id); return true; }),
    count: () => tx('readonly', (s) => s.count()),
  };
}

export function createSceneStore({ backend } = {}) {
  let be = backend || null;
  let degraded = false;
  if (!be) {
    be = idbBackend();
    if (!be) { be = memoryBackend(); degraded = true; }
  }
  const newId = () => 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

  return {
    kind: be.kind,
    degraded,
    async list() {
      try {
        const rows = await be.all();
        return rows.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
      } catch { return []; }
    },
    async save(name, sceneJson, thumb = null) {
      try {
        const rec = {
          id: newId(), name: name || '未命名场景', savedAt: new Date().toISOString(),
          entities: Array.isArray(sceneJson?.entities) ? sceneJson.entities.length : 0,
          bytes: JSON.stringify(sceneJson).length,
          thumb, scene: sceneJson,
        };
        await be.put(rec);
        return { ok: true, id: rec.id, record: rec };
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    },
    async update(id, patch) {
      try {
        const prev = await be.get(id);
        if (!prev) return { ok: false, error: '场景不存在' };
        const rec = { ...prev, ...patch, id, savedAt: new Date().toISOString() };
        await be.put(rec);
        return { ok: true, record: rec };
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    },
    async load(id) {
      try {
        const rec = await be.get(id);
        return rec ? { ok: true, record: rec } : { ok: false, error: '场景不存在' };
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    },
    async remove(id) {
      try { await be.remove(id); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err.message || err) }; }
    },
    async count() { try { return await be.count(); } catch { return 0; } },
  };
}
