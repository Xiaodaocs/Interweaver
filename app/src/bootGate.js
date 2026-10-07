// 开屏闸门：等"网络 + 用户数据"就绪再进画布；也可「离线进入」（只用画布主体）。
//
// 用户要求：打开后显示加载，等网络与用户数据全部准备完毕；也加上离线进入，方便只使用主体，
//   不开放涉及网络的成就页面等。
//
// 行为：探测后端 -> 读账号 -> 拉用户数据 -> 进入 online；
//       连不上则**明确报错**（地址/原因/code/怎么办）并转 offline（画布可用、联网功能不开放），
//       底部提示条 + 重试联网；加载过程中随时可点「离线进入」。
// 只用 src/api.js（唯一出口）与 src/appMode.js（模式唯一来源）。
import { probeBackend, me, getDoc, getToken, apiBase, ApiError } from './api.js';
import * as M from './appMode.js';

const PROBE_TIMEOUT_MS = 2500;

const CSS_TEXT = [
  '#iwBoot{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;',
  'justify-content:center;gap:14px;background:var(--iwb,#101319);color:var(--iwf,#E8ECF8);',
  'font:13px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;transition:opacity .28s ease;pointer-events:none}',
  '#iwBoot[data-hide="1"]{opacity:0;pointer-events:none}',
  '#iwBootTitle{font-size:17px;font-weight:600;letter-spacing:.04em}',
  '#iwBootSteps{min-width:300px;max-width:560px;display:flex;flex-direction:column;gap:4px;',
  'font:12px/1.7 ui-monospace,monospace;opacity:.92}',
  '#iwBootSp{width:22px;height:22px;border-radius:50%;border:2px solid #FFFFFF33;border-top-color:#E8ECF8;',
  'animation:iwspin .9s linear infinite}@keyframes iwspin{to{transform:rotate(360deg)}}',
  '#iwBootDetail{white-space:pre-wrap;max-width:620px;padding:10px 12px;border-radius:10px;background:#D9534F1A;',
  'border:.5px solid #D9534F44;color:#FFB4B0;font:11.5px/1.6 ui-monospace,monospace}',
  '#iwBoot .row{display:flex;gap:10px}',
  '#iwBoot button{padding:7px 14px;border-radius:9px;border:.5px solid #FFFFFF33;background:#FFFFFF14;',
  'color:inherit;font-size:12.5px;cursor:pointer;pointer-events:auto}#iwBoot button:hover{background:#FFFFFF24}',
  ':root[data-theme="light"] #iwBoot{--iwb:#F7F8FA;--iwf:#1D1D1F}',
  ':root[data-theme="light"] #iwBootDetail{color:#B3261E;background:#B3261E12;border-color:#B3261E33}',
  '#iwOfflineTip{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9998;display:none;pointer-events:none;',
  'align-items:center;gap:10px;padding:7px 12px;border-radius:999px;background:#0E1320E6;color:#FFE6A8;',
  'font:12px/1.4 -apple-system,"PingFang SC",sans-serif;border:.5px solid #F0C35B44}',
  '#iwOfflineTip.on{display:flex}',
  ':root[data-theme="light"] #iwOfflineTip{background:#FFFFFFF2;color:#6B5406;border-color:#6B540633;box-shadow:0 4px 16px #0001}',
  '#iwOfflineTip button{border:none;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0;pointer-events:auto}',
].join('');

function ensureStyle() {
  if (document.getElementById('iwBootStyle')) return;
  const s = document.createElement('style');
  s.id = 'iwBootStyle';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function showOfflineTip(reason) {
  let tip = document.getElementById('iwOfflineTip');
  if (!tip) { tip = el('div'); tip.id = 'iwOfflineTip'; document.body.appendChild(tip); }
  tip.textContent = '';
  tip.appendChild(el('span', null, 'Offline: ' + reason.title + (reason.detail ? ' | ' + reason.detail : '')));
  const btn = el('button', null, '重试联网');
  btn.addEventListener('click', () => location.reload());
  tip.appendChild(btn);
  tip.classList.add('on');
}

function explain(e) {
  if (e instanceof ApiError) {
    return {
      title: e.error,
      detail: (e.method || 'GET') + ' ' + apiBase() + (e.path || '') + ' · code=' + e.code + (e.hint ? ' · ' + e.hint : ''),
    };
  }
  return { title: (e && e.message) || '未知问题', detail: String(e) };
}

export async function runBootGate(opts) {
  // opts.apply({user, docs}) 在揭层之前被调用：把后端取回的用户数据采纳进各模块（读路径切换点）
  const apply = (opts && typeof opts.apply === 'function') ? opts.apply : null;
  ensureStyle();
  const box = el('div'); box.id = 'iwBoot';
  const title = el('div', null, '交织者'); title.id = 'iwBootTitle';
  const spin = el('div', null); spin.id = 'iwBootSp';
  const steps = el('div', null); steps.id = 'iwBootSteps';
  const detail = el('div', null); detail.id = 'iwBootDetail'; detail.hidden = true;
  const row = el('div', 'row');
  const btnOffline = el('button', null, '离线进入（只用画布）');
  const btnRetry = el('button', null, '重试'); btnRetry.hidden = true;
  row.appendChild(btnOffline); row.appendChild(btnRetry);
  box.appendChild(title); box.appendChild(spin); box.appendChild(steps);
  box.appendChild(detail); box.appendChild(row);
  document.body.appendChild(box);

  let finished = false;
  const finish = () => {
    if (finished) return false;
    finished = true;
    box.dataset.hide = '1';
    setTimeout(() => box.remove(), 320);
    return true;
  };
  const step = (t) => { const l = el('div', null, t); steps.appendChild(l); return l; };
  const goOffline = (r) => {
    if (finished) return;
    M.enterOffline(r);
    spin.hidden = true;
    detail.hidden = false;
    detail.textContent = '连不上后端，已可离线使用画布。\n后端地址：' + apiBase() + '\n原因：' + r.title
      + (r.detail ? '\n细节：' + r.detail : '') + '\n联网功能（成就页 / 场景库 / 账号同步）在离线模式下不开放。';
    btnRetry.hidden = false;
    showOfflineTip(r);      // 自动转离线时也把底部提示条亮出来
    finish();   // dismiss overlay: a modal would swallow canvas input (wheel/space-drag/D-draw)
  };

  btnOffline.addEventListener('click', () => {
    if (finished) return;
    M.enterOffline(M.getReason() || { title: '用户选择离线进入', detail: '未等待网络' });
    if (finish()) showOfflineTip(M.getReason());
  });
  btnRetry.addEventListener('click', () => location.reload());

  const s1 = step('· 探测后端 …');
  const probe = await probeBackend();
  if (!probe.ok) {
    s1.textContent = '· 探测后端 ✗ 连不上';
    goOffline(explain(probe.error));
    return M.getMode();
  }
  s1.textContent = '· 探测后端 ✓ ' + apiBase();

  const s2 = step('· 读取账号 …');
  let user = null;
  if (getToken()) {
    try {
      const r = await me();
      user = r.user;
      s2.textContent = '· 读取账号 ✓ ' + user.username + (user.isAdmin ? '（管理员）' : '');
    } catch (e) {
      s2.textContent = '· 读取账号 ✗ 登录已失效（按访客进入）';
      if (e instanceof ApiError && e.status !== 401) { goOffline(explain(e)); return M.getMode(); }
    }
  } else {
    s2.textContent = '· 读取账号 — 未登录（按访客进入：能用，但数据不保存到服务器）';
  }

  const docs = {};
  if (user) {
    const s3 = step('· 读取用户数据 …');
    const kinds = ['settings', 'progress', 'draft'];
    const results = await Promise.all(kinds.map((k) => getDoc(k).then((r) => ({ k: k, doc: r.doc })).catch((e) => ({ k: k, err: e }))));
    const failed = results.filter((x) => x.err)[0];
    if (failed) {
      s3.textContent = '· 读取用户数据 ✗ ' + (failed.err.code || failed.err.message);
      goOffline(explain(failed.err));
      return M.getMode();
    }
    for (const x of results) if (x.doc) docs[x.k] = x.doc;
    s3.textContent = '· 读取用户数据 ✓ ' + Object.keys(docs).length + ' 份（' + (Object.keys(docs).join('/') || '空') + '）';
  }

  // 采纳用户数据（读路径切换点）：必须在**揭掉加载层之前**完成，
  // 否则会先按默认值画一帧、再被后端数据改掉（用户明确讨厌这种闪）。
  if (apply) {
    try { await apply({ user: user, docs: docs }); }
    catch (e) { setDetail(explain(e)); }
  }
  M.enterOnline({ user: user, docs: docs });
  const tip = document.getElementById('iwOfflineTip');
  if (tip) tip.classList.remove('on');
  finish();
  return M.getMode();
}
