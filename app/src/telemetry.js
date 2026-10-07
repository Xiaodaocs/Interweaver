// 画布动作上报（用户要求："画布内部动作也应该进监控"）——**唯一上报出口**。
//
// 为什么单独一个文件：上报如果散落在各处自己 fetch，就会变成"同一个映射抄四遍"那类病。
//   · 只有这里发请求（并且**只通过 src/api.js**，不自己拼 URL）；
//   · 业务代码只需要 `track('entity:add', 'circle')` 一行。
//
// 上报边界（**用户明确要求后调整过的口径**，别再按旧注释理解）：
//   · 现在**记录画布上发生的一切**：动作类型、时间、会话 id，**以及参数值** ——
//     包括变量（名/值/范围）、观察器、函数参数、几何参数、拖动前后的数值等；
//   · 数据发往**你自己的后端**（同一台机器/你的服务器）→ 落 app/data/events.log → npm run status 可见；
//   · 默认开启；`setTelemetryEnabled(false)` 可**一键关闭**（关掉后连缓冲都不再攒）。
//   · 仍然**不主动**记录：密码、token（凭证永远不进上报）、用户输入的自由文本（如场景名，
//     只在动作标签里带"有名字"这一事实，不带名字本身）。
//
// 性能（守项目红线"不得拖慢画布"）：
//   · `track()` 只做"入队"：同步返回，绝不 await、绝不阻塞绘制；
//   · 参数用 JSON 序列化并**限长**（默认 600 字符），超长的截断并标记，避免大对象把队列撑爆；
//   · 约每 1s 或攒够 20 条才发一次；失败/离线就留在环形缓冲里，等联网登录后再补传；
//   · 缓冲上限 200 条，超出丢最旧的（监控不是账本，不能吃内存）。
let enabled = true;
let queue = [];
let timer = null;
let sending = false;
let sent = 0;
let dropped = 0;
let sessionId = null;

const MAX_QUEUE = 200;
const FLUSH_MS = 1000;
const FLUSH_AT = 20;

function sid() {
  if (sessionId) return sessionId;
  try {
    // 会话 id：随机、不关联身份（服务端只按它把一串动作串起来）
    sessionId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : String(Math.random()).slice(2, 10);
  } catch { sessionId = 'anon'; }
  return sessionId;
}

export function setTelemetryEnabled(on) {
  enabled = !!on;
  if (!enabled) { queue = []; if (timer) { clearTimeout(timer); timer = null; } }
}
export const isTelemetryEnabled = () => enabled;
export const telemetryStats = () => ({ queued: queue.length, sent, dropped, enabled, sessionId });

/** 把参数压成一行、限长（默认 600 字符）：监控要看"发生了什么 + 参数是多少"，
 *  但不能因为某个大对象（比如整张实体表）把队列撑爆、把画布拖慢。 */
function pack(data) {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string') return data.slice(0, 200);
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  try {
    const s = JSON.stringify(data);
    if (s === undefined) return null;
    return s.length > 600 ? (s.slice(0, 600) + '…(截断)') : s;
  } catch { return '(无法序列化)'; }
}

/** 记一个动作。同步、极轻（只入队），可以放心放在热路径上。
 *  kind 用 `域:动作` 命名（如 'tool:pick' / 'entity:add' / 'drag:end' / 'var:set' / 'observer:add'）。
 *  data 可以给**任意可 JSON 化的参数**（用户要求记录变量/观察器/参数值）：会自动压缩并限长。 */
export function track(kind, data) {
  if (!enabled) return;
  try {
    queue.push({ k: String(kind).slice(0, 40), d: pack(data), t: Date.now() });
    while (queue.length > MAX_QUEUE) { queue.shift(); dropped += 1; }
    if (queue.length >= FLUSH_AT) { void flush(); return; }
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
  } catch { /* 上报绝不影响画布 */ }
}

/** 把缓冲发出去。失败就把条目放回队首（等下次），并保留原因供 UI/状态查看。 */
export async function flush() {
  if (sending || !queue.length) return { ok: true, sent: 0 };
  sending = true;
  const batch = queue.slice(0, 50);
  try {
    const [api, mode] = await Promise.all([import('./api.js'), import('./appMode.js')]);
    // 离线或未登录：留在缓冲里（后端只服务登录用户的动作流水），等联网后再补
    if (!(mode.isOnline() && mode.getUser())) return { ok: false, reason: 'offline-or-guest' };
    await api.postEvents({ session: sid(), events: batch });
    queue = queue.slice(batch.length);
    sent += batch.length;
    return { ok: true, sent: batch.length };
  } catch (e) {
    return { ok: false, reason: (e && e.code) || (e && e.message) || String(e) };
  } finally {
    sending = false;
    if (queue.length) { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS); }
  }
}
