// T8 · 彩蛋成就（设计 §6.2）
//
// 用户明确要求：**不标注"这是非主线"**，混在正常成就里等你撞见；
// 判据依然"可被程序严格判定"（不能是"看起来像"）；文案幽默、克制、不解释笑点。
// 标题与文案长度遵守 §6.3（标题 ≤8 字、flavor ≤48 字、hint ≤22 字）——
// 用户点名的「线上点上线上点」是 7 字，所以标题上限取 8（§6.3 的"≤6"据此修正，待回填文档）。
const entityNodes = (sg) => sg.nodes.filter((n) => !['variable', 'probe', 'constraint'].includes(n.type));

export const EGG_PATTERNS = [
  {
    id: 'egg.nested.oncurve', title: '线上点上线上点', flavor: '作者敢想，你敢做。',
    cls: 'solo', tier: 'spark', requires: [], hint: '让一条曲线挂在另一条曲线上',
    nodes: [{ type: 'edgepoint', as: 'ep' }],
    where: (sg, b) => {
      // ≥2 层嵌套：这条线上点的宿主，本身又是"线上点"，或挂在截取段/曲线段上
      const chain = (id, depth) => {
        if (depth > 4) return depth;
        const hosts = sg.edges.filter((e) => e.kind === 'onHost' && e.from === id).map((e) => e.to);
        if (!hosts.length) return depth;
        return Math.max(...hosts.map((h) => chain(h, depth + 1)));
      };
      return chain(b.ep, 0) >= 2;
    },
    evidence: (b, sg) => ({ text: `线上点 ${sg.byId.get(b.ep)?.label} 的宿主链深度 ≥2`, values: {} }),
  },
  {
    id: 'egg.tiny.area', title: '这也行？', flavor: '数学不管你想干什么，它只管你干了什么。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把一个多边形压到几乎没有面积',
    nodes: [{ type: 'polygon', as: 'pg', where: (ft) => (ft.count || 0) >= 3 && (ft.area || 0) < 0.01 }],
    evidence: (b, sg) => ({ text: `多边形面积 ${(sg.features.get(b.pg)?.area ?? 0).toExponential(1)}（<0.01 仍算一个图形）`, values: {} }),
  },
  {
    id: 'egg.too.many', title: '够了，真的够了', flavor: '你造了一座城市，而它居然是稳的。',
    cls: 'solo', tier: 'structure', requires: [], hint: '同一场景堆到 60 个实体以上',
    nodes: [{ type: 'segment', as: 's' }],
    where: (sg) => entityNodes(sg).length >= 60,
    evidence: (b, sg) => ({ text: `场景里已有 ${entityNodes(sg).length} 个实体`, values: {} }),
  },
  {
    id: 'egg.pi.precise', title: '无用的精确', flavor: 'π 在这里毫无用处，但你就是想打。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把某个参数调成 π 的前 12 位',
    nodes: [{ type: '*', as: 'any' }],
    where: (sg, b) => {
      const f = sg.features.get(b.any);
      if (!f) return false;
      for (const v of Object.values(f)) {
        if (typeof v === 'number' && Math.abs(v - Math.PI) < 1e-12) return true;
      }
      return false;
    },
    evidence: () => ({ text: '某个参数精确等于 π（误差 <1e-12）', values: {} }),
  },
  {
    id: 'egg.mirror', title: '完 美 对 称', flavor: '美，是一种可以被测出来的东西。',
    cls: 'solo', tier: 'structure', requires: [], hint: '让整幅图关于一条线左右镜像',
    nodes: [{ type: 'segment', as: 's' }],
    where: (sg) => {
      // 以 y 轴（x=0）为镜：把所有锚点镜像后，仍能在锚点集合里找到配对（误差 ≤1%）
      const pts = [];
      for (const e of sg.edges) {
        if (e.kind !== 'coincident') continue;
        const d = e.detail?.at;
        if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) pts.push([d.x, d.y]);
      }
      if (pts.length < 2) return false;
      return pts.every(([x, y]) => pts.some(([x2, y2]) => Math.abs(x2 + x) < 0.02 * Math.max(1, Math.abs(x)) && Math.abs(y2 - y) < 0.02));
    },
    evidence: () => ({ text: '所有重合点都能在 y 轴另一侧找到镜像伙伴', values: {} }),
  },
  {
    id: 'egg.lonely.line', title: '一条线的孤独', flavor: '它在等另一条线。',
    cls: 'solo', tier: 'spark', requires: [], hint: '在一个空场景里只画一条线段',
    nodes: [{ type: 'segment', as: 's' }],
    where: (sg) => entityNodes(sg).length === 1,
    evidence: () => ({ text: '整个场景只有这一条线段', values: {} }),
  },
  {
    id: 'egg.reversed', title: '反向操作', flavor: '你成功地什么也没改变。',
    cls: 'solo', tier: 'spark', requires: [], hint: '把一条线段的两端前后颠倒',
    nodes: [{ type: 'segment', as: 's', where: (ft) => ft.x1 > ft.x2 }],
    evidence: (b, sg) => {
      const f = sg.features.get(b.s);
      return { text: `线段两端被颠倒（x1=${f.x1.toFixed(2)} > x2=${f.x2.toFixed(2)}）`, values: {} };
    },
  },
  {
    id: 'egg.very.long', title: '长到没边', flavor: '它已经不需要尺子了。',
    cls: 'solo', tier: 'spark', requires: [], hint: '画一条长度超过 100 的线段',
    nodes: [{ type: 'segment', as: 's', where: (ft) => ft.length > 100 }],
    evidence: (b, sg) => ({ text: `线段长度 ${(sg.features.get(b.s)?.length ?? 0).toFixed(1)}`, values: {} }),
  },
  {
    id: 'egg.probe.hoard', title: '观察成瘾', flavor: '三个不够，你还想要第四个。',
    cls: 'solo', tier: 'structure', requires: [], hint: '在同一个场景里放三个观察器',
    nodes: [{ type: 'probe', as: 'p1' }, { type: 'probe', as: 'p2' }, { type: 'probe', as: 'p3' }],
    evidence: () => ({ text: '同场景存在 ≥3 个观察器', values: {} }),
  },
  {
    id: 'egg.collector', title: '收藏家', flavor: '你不是在用工具，你是在收集它们。',
    cls: 'solo', tier: 'structure', requires: [], hint: '在同一场景里用上八种不同的图形',
    nodes: [{ type: 'segment', as: 's1' }],
    where: (sg) => new Set(entityNodes(sg).map((n) => n.type)).size >= 8,
    evidence: (b, sg) => ({ text: `场景里出现了 ${new Set(entityNodes(sg).map((n) => n.type)).size} 种图形`, values: {} }),
  },
];
