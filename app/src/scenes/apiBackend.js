// 场景库的"服务器 backend"：实现 scenes/store.js 里 backend 的那五个方法
// （all / get / put / remove / count），让登录用户的场景库落在后端数据库里。
//
// 为什么这样做：createSceneStore({ backend }) 与 openSceneList({ store }) **本来就是可注入的**
//   —— 与成就运行时"存储可注入"同一个设计。所以这条同样**不改模块内部**，只从 main.js 换一个 backend。
//
// 规则（用户确认）：
//   · 登录 + 在线 → 用本 backend（场景是用户数据，存服务器）；
//   · 访客 / 离线 → **完全保持现状**：IndexedDB + 「文件 → 下载 / 选择文件」的本地导入导出
//     （那是本地操作，不是"假后端"，也不是偷偷兜底）。
//
// 说明：列表接口只返回元信息（id/name/savedAt/bytes），所以 all() 需要再逐个取内容。
//       场景库通常只有几十条，这个 N+1 可以接受；若以后变大，再让列表接口带上内容即可。
import { listScenes, getScene, putScene, deleteScene } from '../api.js';

const unwrap = (doc) => {
  if (!doc) return null;
  const data = doc.data || {};
  return {
    id: doc.id,
    name: doc.name,
    savedAt: doc.savedAt ? new Date(doc.savedAt).toISOString() : new Date().toISOString(),
    sceneJson: data.sceneJson !== undefined ? data.sceneJson : null,
    thumb: data.thumb !== undefined ? data.thumb : null,
  };
};

export function apiSceneBackend() {
  return {
    async all() {
      const list = await listScenes();
      const rows = (list.scenes || []).map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt }));
      const full = await Promise.all(rows.map((r) => getScene(r.id).then((d) => unwrap(d.doc)).catch(() => null)));
      return full.filter(Boolean);
    },
    async get(id) {
      try { return unwrap((await getScene(id)).doc); }
      catch { return null; }                     // 404 等 → 视作"没有这条"（与 memory/idb backend 语义一致）
    },
    async put(rec) {
      await putScene(rec.id, {
        name: rec.name,
        data: { sceneJson: rec.sceneJson, thumb: rec.thumb },
      });
      return true;
    },
    async remove(id) {
      await deleteScene(id);
      return true;
    },
    async count() {
      const list = await listScenes();
      return (list.scenes || []).length;
    },
  };
}
