// S6 地基断言：设置存储（用户要求 ⑦：独立设置页 + 所有设置及时生效）
//
// 纯 Node 断言（不需要浏览器）：默认值、读写、类型校验、变更通知、分组完整性。
process.on("uncaughtException", (e) => { console.log("崩溃：" + (e && e.message ? e.message : String(e))); process.exit(1); });

import { SETTINGS_SCHEMA, GROUPS, getSetting, allSettings, setSetting, resetSettings, onSettingChange, STORAGE_KEY } from "../src/settings.js";

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fails.push(msg); console.log("  ✗ " + msg); } };

// ① 结构完整：每个分区都有键；键名唯一
{
  const keys = SETTINGS_SCHEMA.map((s) => s.key);
  ok(new Set(keys).size === keys.length, `设置键唯一（${keys.length} 个）`);
  const groups = new Set(SETTINGS_SCHEMA.map((s) => s.group));
  ok(GROUPS.every((g) => groups.has(g.id)), `四个分区都有键：${GROUPS.map((g) => g.label + '(' + g.id + ')').join(' ')}`);
  const need = ['themeMode', 'grid', 'ticks', 'labels', 'snapGrid', 'snapEndpoint', 'snapAngle', 'shortcuts', 'achShot', 'sfx', 'connView', 'showParams'];
  ok(need.every((k) => keys.includes(k)), `需求点名的设置项都在：${need.join(',')}`);
}

// ② 默认值可读
{
  resetSettings();
  const all = allSettings();
  ok(all.themeMode === 'light', `默认显示模式 light（实测 ${all.themeMode}）`);
  ok(all.showParams === true && all.sfx === true && all.achShot === true, '常用/成就截图默认开启');
  ok(all.snapEndpoint === true && all.snapGrid === true, '默认端点吸附与网格吸附都开（保持应用现有手感；用户可关）');
  ok(Object.keys(all).length === SETTINGS_SCHEMA.length, `allSettings 返回全部 ${SETTINGS_SCHEMA.length} 项`);
}

// ③ 读写 + 类型校验（enum 只接受合法值）
{
  setSetting('grid', false);
  ok(getSetting('grid') === false, '布尔项可写入并读回（grid=false）');
  setSetting('themeMode', 'dark');
  ok(getSetting('themeMode') === 'dark', '枚举项可写入（themeMode=dark）');
  setSetting('themeMode', 'rainbow');
  ok(getSetting('themeMode') === 'light', '非法枚举值被拒绝并回到默认（rainbow → light）');
  let threw = false;
  try { setSetting('notAKey', 1); } catch { threw = true; }
  ok(threw, '写入未知键会报错（不静默吞掉）');
}

// ④ 变更通知（设置页与工作台共用同一条通知链 → 这是"及时生效"的机制）
{
  const seen = [];
  const off = onSettingChange((k, v) => seen.push(k + '=' + v));
  setSetting('sfx', false);
  setSetting('snapAngle', true);
  setSetting('ticks', false);
  off();
  setSetting('labels', false);
  ok(seen.length === 3, `订阅者收到 3 次变更（实测 ${seen.length}：${seen.join(' ')}）`);
  ok(seen[0] === 'sfx=false' && seen[1] === 'snapAngle=true', '通知内容为最新值');
  ok(!seen.some((s) => s.startsWith('labels')), '取消订阅后不再收到通知');
  ok(getSetting('labels') === false, '取消订阅不影响写入本身');
}

// ⑤ 重置
{
  setSetting('grid', false);
  const after = resetSettings();
  ok(after.grid === true && getSetting('grid') === true, '重置后回到默认值');
}

ok(typeof STORAGE_KEY === 'string' && STORAGE_KEY.length > 0, `存储键 = ${STORAGE_KEY}`);

console.log(`\nS6 设置存储：${pass} 通过, ${fails.length} 失败`);
process.exit(fails.length ? 1 : 0);
