// 逐项二分：每次只改动一处，跑一遍四条不变量，再还原。
// 目的：用数据定位"间距 3.7px / 3 对重叠 / 穿线 58"是哪一项改动引入的
//（我此前两次靠推理的回滚都被证伪，所以改成测量）。
import fs from 'fs';
import { execSync } from 'child_process';

const ROOT = 'D:/zhuo_mian/Interweaver/app/';
const FILE = ROOT + 'src/starmapLayout.js';
const orig = fs.readFileSync(FILE, 'utf8');

const VARS = [
  { name: '① BAND_H 回到 152', from: 'const BAND_H = 176;', to: 'const BAND_H = 152;' },
  { name: '② 去掉带宽上限', from: 'const need = Math.min(2 * (worst + MARGIN), BAND_H * 1.35);', to: 'const need = 2 * (worst + MARGIN);' },
  {
    name: '③ 带宽改用"跨度"而非"最大偏离"',
    from: 'const worst = Math.max(...ys.map((y) => Math.abs(y - center)));',
    to: 'const worst = Math.max(...ys.map((y) => y)) - Math.min(...ys.map((y) => y));',
  },
  {
    name: '④ 子道数回到"按最挤格子"',
    from: `  const lanesOfCol = new Map();
  const perGroupCol = new Map();
  for (const [k, arr] of cells) {
    const [layerStr, group0] = k.split('|');
    const col0 = layers.indexOf(Number(layerStr));
    const key0 = \`\${group0}|\${col0}\`;
    perGroupCol.set(key0, (perGroupCol.get(key0) || 0) + arr.length);
  }
  for (const [key0, total] of perGroupCol) {
    const col0 = Number(key0.split('|')[1]);
    const L0 = Math.max(1, Math.ceil(total / maxPerLaneBand));
    lanesOfCol.set(col0, Math.max(lanesOfCol.get(col0) || 1, L0));
  }`,
    to: `  const lanesOfCol = new Map();
  for (const [k, arr] of cells) {
    const col0 = layers.indexOf(Number(k.split('|')[0]));
    const L0 = Math.max(1, Math.ceil(arr.length / maxPerLaneBand));
    lanesOfCol.set(col0, Math.max(lanesOfCol.get(col0) || 1, L0));
  }`,
  },
];

const run = () => {
  let out = '';
  try { out = execSync('node tests/t2t3-shot.mjs', { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const lay = (out.split('\n').find((l) => l.includes('布局：')) || '').replace('布局：', '').trim();
  const rou = (out.split('\n').find((l) => l.includes('走线：')) || '').replace('走线：', '').trim();
  const ok = /✅/.test(out);
  return { lay, rou, ok };
};

console.log('基线（当前代码）：', JSON.stringify(run()));
for (const v of VARS) {
  if (!orig.includes(v.from)) { console.log(`\n${v.name}：⚠ 锚点未匹配，跳过`); continue; }
  try {
    fs.writeFileSync(FILE, orig.replace(v.from, v.to));
    const r = run();
    console.log(`\n${v.name}：`);
    console.log('  ' + r.lay);
    console.log('  ' + r.rou);
    console.log('  ' + (r.ok ? '✅ 四条不变量全过' : '✗ 未全过'));
  } finally {
    fs.writeFileSync(FILE, orig);
  }
}
fs.writeFileSync(FILE, orig);
console.log('\n已还原为改动前的代码。');
