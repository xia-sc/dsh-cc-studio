/**
 * 0.25.0：工坊「⟳ 刷新」按钮的回归测试。
 *
 * 背景（用户反馈）：LLM 写完卡，工坊里有时还是历史版本 —— 心跳可能被关掉、这一轮轮询被节流、
 * 或响应在切会话时被丢掉。动作栏「校验」左边加一个手动刷新：按当前会话强制再拉一次草稿。
 *
 * 钉住：
 *   · 按钮在动作栏、在校验左边，文案与提示都在（中英各一份）；
 *   · 手动刷新**跳过节流**（走 store._pullDraftNow，而不是节流的 _pullDraft）；
 *   · 没有会话 id 时不发 RPC，只给提示（issue #5 的教训：绝不拿 default 槽顶替）；
 *   · 轮询的节流函数返回值是 Promise（按钮要据此给「已刷新 / 失败」回执）。
 *
 * 运行：node tests/refresh-draft.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient, readRepo } from './harness.mjs';

const src = readRepo('lib/client.js');

// —— ① 源码守卫：按钮接线 ——
check('① 动作栏有刷新按钮，且在校验按钮之前',
  /store\.refreshDraft\(\)[\s\S]{0,400}store\.validate\(\)/.test(src), '');
check('①b 按钮带 tooltip（说明什么时候该点它）',
  /title:t\("action\.refreshDraftHint"\)/.test(src), '');
check('①c 中英文案齐全（按钮 / 提示 / 刷新中）',
  ['action.refreshDraft', 'action.refreshDraftHint', 'action.refreshing']
    .every((k) => (src.match(new RegExp(`"${k.replace('.', '\\.')}"`, 'g')) || []).length >= 2), '');
check('①d 提示文案中英各一份（已刷新 / 预览中 / 无会话 / 失败）',
  ['store.refreshed', 'store.refreshedPreview', 'store.refreshNoSession', 'store.refreshFailed']
    .every((k) => (src.match(new RegExp(`"${k.replace('.', '\\.')}"`, 'g')) || []).length >= 2), '');
check('①e 手动刷新走不节流的拉取（apply 注入 setDraftPuller(pullDraft)）',
  src.includes('store.setDraftPuller(pullDraft)') && src.includes('function refreshDraft()') && src.includes('draftPuller(sid)'), '');
check('①f 节流函数把 Promise 交出去（按钮据此给回执）',
  /lastPullKey = key;\s*\n\s*return pullDraft\(key\);/.test(src), '');

// —— ② 行为：刷新真的按当前会话拉一次 ——
const { registration, React } = loadClient();
const calls = [];
const registered = {};
const draftOf = (name) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'x', character_book: { entries: [] } } });
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) {} return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) {
    calls.push({ endpoint, payload });
    if (endpoint === 'cc_getDraft') {
      return Promise.resolve({ ok: true, value: { draft: draftOf('宿主最新版'), key: payload && payload.args && payload.args.sessionId, keySource: 'arg', draftStatus: { key: payload.args.sessionId, lock: null } } });
    }
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
  } } },
};
const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);
const store = registered['conversation.input.dock'].opts.inject('warmup').store;

check('② 没有会话 id 时刷新不发 RPC', (await store.refreshDraft(), calls.filter((c) => c.endpoint === 'cc_getDraft').length === 0), '');

store.setSessionId('sess-refresh');
await store.refreshDraft();
const pulled = calls.filter((c) => c.endpoint === 'cc_getDraft');
check('②b 有会话 id 时刷新发一次 cc_getDraft，且带对了 sessionId',
  pulled.length === 1 && pulled[0].payload.args.sessionId === 'sess-refresh',
  JSON.stringify(pulled.map((c) => c.payload.args)));
check('②c 刷新后草稿显示成宿主那一版',
  String(store.getSnapshot().draft.data.name) === '宿主最新版',
  String(store.getSnapshot().draft.data.name));
check('②d 刷新给出回执（busy 清空 + lastMsg 有内容）',
  store.getSnapshot().busy === null && !!store.getSnapshot().lastMsg,
  `busy=${store.getSnapshot().busy} lastMsg=${store.getSnapshot().lastMsg}`);

// 连续两次刷新都要真发（证明没被 500ms 节流吞掉）
await store.refreshDraft();
check('②e 连续两次刷新都真的发请求（跳过节流）',
  calls.filter((c) => c.endpoint === 'cc_getDraft').length === 2,
  String(calls.filter((c) => c.endpoint === 'cc_getDraft').length));

delete globalThis.window;
finish();
