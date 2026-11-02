// 知识网：数据 = 产品真实 nodes.js/patterns.js 提取（promo/film/knowledgeData.js）
// v2 修复：布局扩散贴近原作星图（产品 2712×2350 的疏朗感）——层距 340、组带距 260、微抖动保留。
// @ts-ignore 数据源是生成的 JS 模块（无类型声明）
import { KNOWLEDGE } from '../../../film/knowledgeData.js';
import { hashStr } from './engine';

export const GROUP_Y: Record<string, number> = { '点与绑定': 320, '角与旋转': 580, '构造与约束': 840, '微积分': 1100 };
export const LAYER_X = (l: number) => 300 + l * 340;

export interface NetNode { id: string; title: string; group: string; layer: number; kind: string; x: number; y: number }
export interface NetEdge { from: string; to: string; kind: string; beat: number; grow: number }

// S6 织网时刻（拍）
export const STAR_BEATS = [202, 204, 206, 208, 210, 212, 214];
export const LIT7 = ['n.point', 'n.circle', 'n.variable', 'n.binding', 'n.sine', 'n.limit', 'n.euler'];

const HERO_PATHS = [
  ['n.circle', 'n.euler'],
  ['n.edgepoint', 'n.unitcircle'], ['n.unitcircle', 'n.phase'],
  ['n.phase', 'w.drivenCircle'], ['w.drivenCircle', 'w.circleWave'], ['w.circleWave', 'n.euler'],
  ['n.variable', 'n.func'], ['n.func', 'n.sine'], ['n.sine', 'n.family'],
  ['n.family', 'n.rate'], ['n.rate', 'w.integralDriven'], ['w.integralDriven', 'n.euler'],
  ['n.secant', 'n.limit'], ['n.limit', 'n.accum'], ['n.tangent', 'n.rate'], ['n.probe', 'n.readout'],
];
const HERO_START = 216;       // 英雄路径首边
const HERO_STEP = 1.5;        // 拍/条
const CASCADE_0 = 234;        // 级联起
const CASCADE_1 = 247.5;      // 级联止（心跳 b249 前）

interface RawNode { id: string; title: string; group: string; layer: number; kind: string }
export function buildNet(): { nodes: NetNode[]; edges: NetEdge[]; litBeat: Map<string, number> } {
  const byCell = new Map<string, RawNode[]>();
  for (const n of KNOWLEDGE.nodes as RawNode[]) {
    const k = n.layer + '|' + n.group;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k)!.push(n);
  }
  const nodes: NetNode[] = [];
  for (const list of byCell.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    list.forEach((n, i) => {
      const h = hashStr(n.id);
      nodes.push({
        ...n,
        x: LAYER_X(n.layer) + ((h & 255) / 255 - 0.5) * 46,
        y: GROUP_Y[n.group] + (i - (list.length - 1) / 2) * 74 + (((h >> 8) & 255) / 255 - 0.5) * 34,
      });
    });
  }

  // 边调度：英雄路径慢速逐条 → 级联加速（BFS 轮次保证从已亮节点出发）
  const heroKey = new Set(HERO_PATHS.map(([a, b]) => a + '|' + b));
  const deps = (KNOWLEDGE.depEdges as string[][]).map(([a, b]) => ({ from: a, to: b, kind: 'dep' }));
  const rels = (KNOWLEDGE.relatedEdges as string[][]).map(([a, b]) => ({ from: a, to: b, kind: 'rel' }));
  const hero: { from: string; to: string; kind: string }[] = [];
  const rest: { from: string; to: string; kind: string }[] = [];
  for (const e of [...deps, ...rels]) (heroKey.has(e.from + '|' + e.to) ? hero : rest).push(e);
  const edges: NetEdge[] = [];
  HERO_PATHS.forEach(([a, b], i) => {
    const e = hero.find((x) => x.from === a && x.to === b);
    if (e) edges.push({ ...e, beat: HERO_START + i * HERO_STEP, grow: 2 });
  });
  const lit = new Set(LIT7);
  const placed = new Set(edges.map((e) => e.from + '|' + e.to));
  const rounds: typeof rest[] = [];
  let guard = 0;
  while (placed.size < deps.length + rels.length && guard++ < 40) {
    const round: typeof rest = [];
    for (const e of rest) {
      const k = e.from + '|' + e.to;
      if (placed.has(k)) continue;
      if (lit.has(e.from) || (e.kind === 'rel' && lit.has(e.to))) {
        round.push(e); placed.add(k); lit.add(e.from); lit.add(e.to);
      }
    }
    if (round.length === 0) {
      for (const e of rest) {
        const k = e.from + '|' + e.to;
        if (!placed.has(k)) { round.push(e); placed.add(k); lit.add(e.from); lit.add(e.to); }
      }
    }
    rounds.push(round);
  }
  const flat = rounds.flat();
  flat.forEach((e, i) => {
    const f = i / Math.max(1, flat.length - 1);
    edges.push({ ...e, beat: CASCADE_0 + (CASCADE_1 - CASCADE_0) * Math.pow(f, 0.75), grow: 1.6 });
  });
  edges.sort((a, b) => a.beat - b.beat);

  // 节点点亮拍：LIT7 用星亮拍；其余 = 第一条长完的入边
  const litBeat = new Map<string, number>();
  LIT7.forEach((id, i) => litBeat.set(id, STAR_BEATS[i]));
  for (const e of edges) if (!litBeat.has(e.to)) litBeat.set(e.to, e.beat + e.grow);
  return { nodes, edges, litBeat };
}
