import fs from 'fs';
import puppeteer from 'file:///D:/zhuo_mian/Interweaver/app/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { layoutStarMap } from '../src/starmap.js';
import { routeEdges, NODE_W, NODE_H } from '../src/edgeRouting.js';
import { KNOWLEDGE_NODES, GROUPS } from '../src/achievements/nodes.js';
import { tierOf, TIERS } from '../src/achievementShapes.js';

const outDir = 'D:/zhuo_mian/Interweaver/app/tests/artifacts';
fs.mkdirSync(outDir, { recursive: true });

// ---- 真实几何：同一份布局 + 同一份走线 ----
const L = layoutStarMap();
const nodes = KNOWLEDGE_NODES.map((n) => {
  const p = L.pos.get(n.id);
  return { id: n.id, x: p.x, y: p.y, col: p.col, layer: n.layer, group: n.group, title: n.title };
});
const byId = new Map(nodes.map((n) => [n.id, n]));
const edges = L.deps.map(([from, to]) => ({ from, to, kind: 'dep' }));
const routed = routeEdges(nodes, edges);

const bad = [];
if (L.stats.minGap < 45.5) bad.push(`最小间距 ${L.stats.minGap.toFixed(1)} < 46`);
if (L.stats.overlaps.length) bad.push(`重叠 ${L.stats.overlaps.length} 对`);
if (L.stats.bandOut > 0.5) bad.push(`带外溢出 ${L.stats.bandOut.toFixed(1)}px`);
if (routed.stats.passThrough !== 0) bad.push(`穿非端点节点 ${routed.stats.passThrough} 段`);

// ---- 画到静态页（同一份数据，只为取证）----
const W = Math.round(L.width), H = Math.round(L.height);
const paint = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#070A12}canvas{display:block}</style>
<canvas id="cv" width="${W}" height="${H}"></canvas>
<script>
const nodes = ${JSON.stringify(nodes)};
const paths = ${JSON.stringify(routed.paths.map((p) => ({ points: p.points, bridges: p.bridges, kind: p.kind })))};
const tiers = ${JSON.stringify(TIERS)};
const tierOfLayer = (layer) => (layer <= 1 ? 1 : (layer <= 3 ? 2 : 3));
const g = document.getElementById('cv').getContext('2d');
// 星云底 + 网格
g.fillStyle = '#0B0E16'; g.fillRect(0, 0, ${W}, ${H});
for (const nb of [[0.25, 0.3, '60,90,190'], [0.75, 0.7, '120,70,190']]) {
  const grad = g.createRadialGradient(${W}*nb[0], ${H}*nb[1], 0, ${W}*nb[0], ${H}*nb[1], Math.max(${W},${H})*0.5);
  grad.addColorStop(0, 'rgba(' + nb[2] + ',0.06)'); grad.addColorStop(1, 'rgba(' + nb[2] + ',0)');
  g.fillStyle = grad; g.fillRect(0, 0, ${W}, ${H});
}
// 正交走线（依赖边）
for (const p of paths) {
  g.strokeStyle = 'rgba(140,150,190,0.34)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(p.points[0][0], p.points[0][1]);
  for (let i = 1; i < p.points.length; i++) g.lineTo(p.points[i][0], p.points[i][1]);
  g.stroke();
  // 跨线小拱桥（Minecraft 风格）：一条边跨过另一条，画一个小小的半圆
  for (const [bx, by] of p.bridges) {
    g.strokeStyle = 'rgba(240,195,91,0.5)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(bx, by, 3.4, Math.PI, 0); g.stroke();
  }
}
// 节点：三档形状（T4）+ 发光（T1/§1.2 的"点亮才发光"）
for (const n of nodes) {
  const t = tierOfLayer(n.layer), T = tiers[t];
  const r = T.size / 2;
  const lit = false;   // 布局/走线预览里不假设任何成就已点亮
  const gold = '#3A4152';
  g.save(); g.translate(n.x, n.y);
  g.fillStyle = '#141926'; g.strokeStyle = gold; g.lineWidth = 2.2;
  g.beginPath();
  if (T.shape === 'circle') g.arc(0, 0, r, 0, Math.PI * 2);
  else if (T.shape === 'square') { const s = T.size; g.roundRect ? g.roundRect(-r, -r, s, s, 12) : g.rect(-r, -r, s, s); }
  else { for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = r * Math.cos(a), y = r * Math.sin(a); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }
  g.fill(); g.stroke();
  for (let i = 0; i < T.rings; i++) { g.beginPath(); g.arc(0, 0, r + 4 + i * 4, 0, Math.PI * 2); g.strokeStyle = i === 0 ? '#2A2E3A' : '#3A4152'; g.lineWidth = 1.4 - i * 0.4; g.stroke(); }
  g.fillStyle = '#9AA3BD'; g.font = '10px ui-monospace, monospace'; g.textAlign = 'center';
  g.fillText(n.title, 0, r + 16);
  g.restore();
}
</script>`;
fs.writeFileSync(outDir + '_preview-t2t3.html', paint);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
// 只截取一块有代表性的区域（全图太大），并额外出一张全景缩略
await page.setViewport({ width: 1400, height: 900 });
await page.goto('file:///' + outDir.replace(/\\/g, '/') + '_preview-t2t3.html');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: outDir + '/p15-t2-layout.png', clip: { x: 60, y: 60, width: 1300, height: 820 } });
// 全景（缩到可见全貌，作为"需要缩小才能看全"的反证/对照）
await page.setViewport({ width: W > 2400 ? 2400 : W, height: H > 1400 ? 1400 : H });
await page.reload();
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: outDir + '/p15-t3-routing.png', clip: { x: 0, y: 0, width: Math.min(W, 2400), height: Math.min(H, 1400) } });
await browser.close();

console.log('数据：节点', nodes.length, '边', routed.stats.edges, '拱桥', routed.stats.bridgeCount, '画布', W + '×' + H);
console.log('布局：最小间距', L.stats.minGap.toFixed(1), '重叠', L.stats.overlaps.length, '带外溢出', L.stats.bandOut.toFixed(1));
console.log('走线：穿非端点节点', routed.stats.passThrough, '无法避开', routed.paths.filter((x) => x.blocked).length);
console.log('截图 →', outDir + '/p15-t2-layout.png（局部）', outDir + '/p15-t3-routing.png（全景）');
if (bad.length) { console.log('❌ 断言失败：'); for (const b of bad) console.log('   -', b); }
else console.log('✅ T2 布局三条不变量 + T3 走线硬要求全部通过');
process.exit(bad.length ? 1 : 0);
