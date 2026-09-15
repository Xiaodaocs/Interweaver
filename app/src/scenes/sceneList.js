// S7 · 场景列表页（保存当前场景 / 载入 / 删除 / 导出 / 导入）
//
// 目标（路线图 P11 验收）：刷新不丢；列表流畅。这里用 IndexedDB（不可用则内存降级并明确提示）。
import { serializeScene, deserializeScene, inspectScene } from './schema.js';
import { createSceneStore } from './store.js';

export function openSceneList({ st, cam, S, store = createSceneStore(), onLoaded }) {
  const root = document.createElement('div');
  root.id = 'sceneList';
  root.innerHTML = `
    <div class="slInner">
      <div class="slHead">
        <b>场景</b>
        <span class="slMeta"></span>
        <button id="slSave">保存当前场景</button>
        <button id="slImport">导入文件</button>
        <input id="slFile" type="file" accept="application/json,.json" hidden>
        <button id="slClose" title="关闭（Esc）">✕</button>
      </div>
      <div class="slBody"><div class="slEmpty">还没有保存过场景。</div></div>
    </div>`;
  document.body.appendChild(root);
  const meta = root.querySelector('.slMeta');
  const body = root.querySelector('.slBody');

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtBytes = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

  async function refresh() {
    const rows = await store.list();
    meta.textContent = `${rows.length} 个场景 · 存储：${store.kind === 'indexeddb' ? 'IndexedDB' : (store.degraded ? '内存（本次不会保存）' : '内存')}`;
    if (!rows.length) { body.innerHTML = '<div class="slEmpty">还没有保存过场景。</div>'; return; }
    body.innerHTML = rows.map((r) => `
      <div class="slRow" data-id="${r.id}">
        <div class="slName"><b>${r.name}</b><span>${fmtTime(r.savedAt)} · ${r.entities} 个实体 · ${fmtBytes(r.bytes)}</span></div>
        <button data-act="load">载入</button>
        <button data-act="export">导出</button>
        <button data-act="del" class="slDel">删除</button>
      </div>`).join('');
  }

  async function saveCurrent(name) {
    const scene = serializeScene(st, name, cam);
    const res = await store.save(name, scene);
    if (!res.ok) { meta.textContent = '⚠ 保存失败：' + res.error; return; }
    await refresh();
    meta.textContent = `✓ 已保存「${name}」（${scene.entities.length} 个实体）`;
  }

  root.querySelector('#slSave').addEventListener('click', async () => {
    const n = (prompt('场景名称', '场景 ' + new Date().toLocaleString('zh-CN', { hour12: false }).slice(5, 16)) || '').trim();
    if (!n) return;
    await saveCurrent(n);
  });
  root.querySelector('#slImport').addEventListener('click', () => root.querySelector('#slFile').click());
  root.querySelector('#slFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const info = inspectScene(text);
    if (!info.ok) { meta.textContent = '⚠ 导入失败：' + info.error; return; }
    const res = deserializeScene(st, S, text, cam);
    if (!res.ok) { meta.textContent = '⚠ 导入失败：' + res.error; return; }
    onLoaded?.();
    close();
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.slRow')?.dataset.id;
    const act = btn.dataset.act;
    if (act === 'load') {
      const r = await store.load(id);
      if (!r.ok) { meta.textContent = '⚠ ' + r.error; return; }
      const res = deserializeScene(st, S, JSON.stringify(r.record.scene), cam);
      if (!res.ok) { meta.textContent = '⚠ 载入失败：' + res.error; return; }
      onLoaded?.();
      meta.textContent = `✓ 已载入「${r.record.name}」`;
      close();
    } else if (act === 'export') {
      const r = await store.load(id);
      if (!r.ok) { meta.textContent = '⚠ ' + r.error; return; }
      const blob = new Blob([JSON.stringify(r.record.scene, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${r.record.name}.interweaver-scene.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (act === 'del') {
      if (!confirm('删除这个场景？')) return;
      await store.remove(id);
      await refresh();
    }
  });

  const close = () => { root.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  root.querySelector('#slClose').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  refresh();
  return { root, close, refresh, store };
}
