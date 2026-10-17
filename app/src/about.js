// 「关于」面板的数据层与渲染（issue：设置里加「关于」→ 版本信息 + 更新日志）
//
// 设计要点（每条都有理由）：
//  · **零新类名** ✗ —— 全部用 `data-iw-about-*` 属性选择器 ✓
//    本项目有一条**双向类契约**检查（运行时出现而 CSS 没定义的类 = 失灵类 ✗），
//    属性选择器不参与类名统计 ✓ 所以既不会引入失灵类，也不会被算成死规则 ✓
//    样式集中在 styles.css 的 `[data-iw-about-...]` 段里（与主题令牌联动 ✓ 深浅两套都好看 ✓）。
//  · **不在模块顶层碰 DOM** ✓ —— 顶层只有常量与纯函数 ✓ 模块导入守卫（48 个模块全部能在浏览器加载）才不会被拖累 ✓
//  · 版本号**现取** `GET /VERSION`（server.mjs 现读仓库根目录的 VERSION ✓ 不复制一份 ✗ 两份迟早不一致 ✗）
//  · 更新日志从 GitHub **releases** 取 ✓ 但必须处理三种现实情况：
//      离线 / 被墙 / 未认证限流（60 次/小时）→ 用 localStorage 里的**上次成功结果**兜底 ✓
//      且**明确标注"这是缓存，不是最新的"** ✗ 不假装是最新 ✓（诚实优先）
//  · release 正文是 markdown/HTML ✓ → **一律按纯文本**渲染 ✗ 绝不注入 HTML ✓（无 innerHTML ✗）
//  · 零依赖 ✓ 不加任何库 ✓

export const ABOUT_CACHE_KEY = 'interweaver.about.v1';   // 全局键（版本/日志不是用户数据 ✓ 不按账号分 ✓）
export const RELEASES_URL = 'https://api.github.com/repos/Xiaodaocs/Interweaver/releases?per_page=20';

const safeStorage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/** 取版本号：返回 { ok, version } 或 { ok:false, error } */
export async function fetchVersion(fetcher = globalThis.fetch) {
  try {
    const r = await fetcher('/VERSION', { cache: 'no-store' });
    if (!r || !r.ok) return { ok: false, error: 'HTTP ' + (r ? r.status : '?') };
    const txt = String(await r.text()).trim().split(/\r?\n/)[0].trim();
    if (!txt) return { ok: false, error: 'VERSION 文件是空的' };
    return { ok: true, version: txt };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** release 正文 → 纯文本（去掉常见 markdown 标记，保留换行 ✓） */
export function plainText(md) {
  return String(md == null ? '' : md)
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, ''))   // 代码块去掉围栏
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                                 // 图片去掉
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')                            // 链接留文字
    .replace(/^#{1,6}\s*/gm, '')                                          // 标题井号
    .replace(/[*_`>]+/g, '')                                              // 强调/引用/反引号
    .replace(/^\s*[-+]\s+/gm, '· ')                                       // 列表项
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 取 releases：成功 → 写缓存；失败 → 读缓存并标 cached ✓（都没有就如实报错 ✗） */
export async function fetchReleases(fetcher = globalThis.fetch, storage = safeStorage()) {
  try {
    const r = await fetcher(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
    const arr = await r.json();
    const releases = (Array.isArray(arr) ? arr : []).map((x) => ({
      tag: String(x.tag_name || ''),
      name: String(x.name || x.tag_name || ''),
      date: String(x.published_at || x.created_at || ''),
      draft: !!x.draft,
      body: plainText(x.body || ''),
      url: String(x.html_url || ''),
    })).filter((x) => !x.draft);
    try { storage && storage.setItem(ABOUT_CACHE_KEY, JSON.stringify({ at: Date.now(), releases })); } catch { /* 存不了不影响显示 */ }
    return { ok: true, cached: false, releases };
  } catch (e) {
    let cached = null;
    try { const raw = storage && storage.getItem(ABOUT_CACHE_KEY); if (raw) cached = JSON.parse(raw); } catch { cached = null; }
    if (cached && Array.isArray(cached.releases) && cached.releases.length) {
      return { ok: true, cached: true, at: cached.at || 0, releases: cached.releases };
    }
    return { ok: false, error: String((e && e.message) || e), releases: [] };
  }
}

// ── 渲染：只用 data-iw-about-* 属性（零类名 ✓）────────────────────────────────
const el = (tag, attrs = {}, text) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv; }
    else n.setAttribute(k, v);
  }
  if (text != null) n.textContent = String(text);   // ← 永远 textContent ✗ 不用 innerHTML ✓
  return n;
};

/** 把「关于」内容画到 root 里（root 由调用方给 ✓ 通常是设置页右栏） */
export function paintAbout(root, state = {}) {
  if (!root) return;
  root.textContent = '';
  const wrap = el('div', { 'data-iw-about': 'root' });

  // ① 版本信息
  const verBox = el('div', { 'data-iw-about': 'version' });
  verBox.appendChild(el('div', { 'data-iw-about': 'row' }, '版本'));
  verBox.appendChild(el('div', { 'data-iw-about': 'value' }, state.version ? state.version : (state.versionError ? '读不到版本号（' + state.versionError + '）' : '—')));
  wrap.appendChild(verBox);

  // ② 更新日志标题 + 状态说明
  const head = el('div', { 'data-iw-about': 'section' });
  head.appendChild(el('div', { 'data-iw-about': 'title' }, '更新日志'));
  if (state.releases && state.releases.length) {
    head.appendChild(el('div', { 'data-iw-about': state.cached ? 'note-cached' : 'note-live' },
      state.cached
        ? '⚠ 离线或取不到 GitHub，下面是**上次缓存的**更新日志' + (state.at ? '（' + new Date(state.at).toLocaleString() + '）' : '') + '，不一定是最新'
        : '· 来源：GitHub Releases（已取到 ' + state.releases.length + ' 条）'));
  } else if (state.releasesError) {
    head.appendChild(el('div', { 'data-iw-about': 'note-error' }, '取不到更新日志：' + state.releasesError + '（联网后重开本页即可）'));
  }
  wrap.appendChild(head);

  // ③ 每条 release：标签 · 名字 · 日期 · 正文（纯文本 ✓）
  for (const r of (state.releases || [])) {
    const item = el('div', { 'data-iw-about': 'release' });
    item.appendChild(el('div', { 'data-iw-about': 'rel-head' }, (r.tag ? r.tag + ' · ' : '') + (r.name || '(未命名)')));
    if (r.date) item.appendChild(el('div', { 'data-iw-about': 'rel-date' }, new Date(r.date).toLocaleDateString()));
    if (r.body) item.appendChild(el('pre', { 'data-iw-about': 'rel-body' }, r.body));
    wrap.appendChild(item);
  }
  root.appendChild(wrap);
  return wrap;
}

/** 一步到位：取版本 + 取 releases → 渲染（失败也渲染，只是如实说明 ✓） */
export async function loadAbout(root, opts = {}) {
  const fetcher = opts.fetcher || globalThis.fetch;
  const storage = opts.storage !== undefined ? opts.storage : safeStorage();
  if (root) root.setAttribute('data-iw-about', 'loading');
  const [v, rel] = await Promise.all([fetchVersion(fetcher), fetchReleases(fetcher, storage)]);
  const state = {
    version: v.ok ? v.version : '',
    versionError: v.ok ? '' : v.error,
    releases: rel.releases || [],
    cached: !!rel.cached,
    at: rel.at || 0,
    releasesError: rel.ok ? '' : rel.error,
  };
  if (typeof document !== 'undefined') paintAbout(root, state);
  return state;
}
