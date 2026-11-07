// 成就瞬间必须跨 export/import、云端合并与页面重载保留。
import { createTracker, exportTracker, importTracker } from '../src/achievements/tracker.js';

const shot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//';
const a = createTracker();
a.granted.set('weave.thales', { at: 1200, title: '泰勒斯之圆', cls: 'weave', evidence: { text: '90°' }, shot });
const b = createTracker();
if (importTracker(b, exportTracker(a)) !== 1) throw new Error('快照记录没有导入');
if (b.granted.get('weave.thales').shot !== shot) throw new Error('导出/导入丢失 shot');

// 同账号的云端旧档可能尚无快照，不能把本地已经记录的画面合并掉。
importTracker(b, { granted: [{ id: 'weave.thales', at: 1200, title: '泰勒斯之圆', cls: 'weave' }] });
if (b.granted.get('weave.thales').shot !== shot) throw new Error('无图旧档抹掉了已有快照');
importTracker(b, { granted: [{ id: 'weave.thales', at: 1000, title: '泰勒斯之圆', cls: 'weave' }] });
if (b.granted.get('weave.thales').shot !== shot || b.granted.get('weave.thales').at !== 1000) {
  throw new Error('取最早时间时丢了快照，或没有更新时间');
}

for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://example.invalid/a.jpg']) {
  const c = createTracker();
  importTracker(c, { granted: [{ id: 'x', at: 1, shot: unsafe }] });
  if ('shot' in c.granted.get('x')) throw new Error('接受了不安全的快照地址');
}
console.log('成就快照：导出、合并、最早时间与地址校验全部通过');
