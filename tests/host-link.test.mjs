/**
 * 0.27.3：客户端 ↔ 宿主失联必须**看得见**，以及「孤儿草稿」的出口。
 *
 * 背景（用户第三次反馈「删不净」）：本机实测 `~/.dsh/cc-drafts` / `cc-library` 从 11-17 16:32 起
 * **零写入**，而用户界面里那张卡在整台机器上都不存在（.dsh 全目录 utf8/utf16 搜不到）——
 * 界面显示的全是浏览器内存态。也就是说：客户端的 RPC 一直在失败，而插件把失败**静默**掉了：
 *   · 角色库拉不到 → 左栏显示「还没有已存角色」（看起来像自己删光了）；
 *   · 写草稿失败 → 界面照常显示，盘上一个字节没变；
 *   · 删除失败 → 只有底部一行小字，用户根本注意不到。
 *
 * 修法：
 *   ① `rpc()` 区分「端点回 ok:false」与「传输失败」，后者通知订阅者 → `store.rpcError` →
 *      工坊顶部红色横幅（带端点 / 错误码 / 重试按钮）；
 *   ② 角色库区分 `libraryLoaded`：读不到时左栏说「读不到角色库」，不再冒充空库；
 *   ③ 孤儿草稿（库空 + 无来源 + 草稿有内容）给一条明确提示 + 「清空草稿」按钮；
 *   ④ `pullDraft` 把「来源 id 不在库里」当成孤儿来源，避免「删除」拿着一个不存在的 id。
 *
 * 运行：node tests/host-link.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient, readRepo } from './harness.mjs';

const src = readRepo('lib/client.js');

// —— ① 源码守卫 ——
check('① rpc() 在非信封响应 / 网络异常时通知失败（不再静默返回 ok:false）',
  /notifyRpcFailure\(\{ endpoint:endpoint, code:"transport\/http-"\+res\.status, status:res\.status \}\)/.test(src)
  && /notifyRpcFailure\(\{ endpoint:endpoint, code:"transport\/network"/.test(src), '');
check('①b rpc() 有 catch：网络异常不会变成 unhandled rejection',
  /\.catch\(function\(e\)\{\s*\n\s*notifyRpcFailure\(\{ endpoint:endpoint, code:"transport\/network"/.test(src), '');
check('①c store 订阅失败并写进 rpcError',
  /onRpcFailure\(function\(info\)\{[\s\S]{0,600}set\(\{rpcError:next\}\)/.test(src), '');
check('①d 工坊横幅用 rpcError 渲染（含重试按钮 → store.retryHost）',
  /if\(s\.rpcError\)\{[\s\S]{0,900}store\.retryHost\(\)/.test(src), '');
check('①e store.retryHost 已导出',
  /retryHost:retryHost/.test(src), '');

check('② 角色库区分「读不到」与「空库」：失败时置 libraryLoaded=false 且不清空已有列表',
  /else set\(\{libraryLoaded:false\}\)/.test(src)
  && /set\(\{library: res\.value\.entries, libraryLoaded:true\}\)/.test(src)
  && !/set\(\{library: \[\]\}\)/.test(src), '');
check('②b 左栏空状态用 workshop.library.unreachable 表示「读不到」',
  /s\.libraryLoaded \? t\("workshop\.library\.empty"\) : t\("workshop\.library\.unreachable"\)/.test(src), '');

check('③ 孤儿草稿横幅：库已加载且为空 + 无来源 + 草稿有内容 → 给出「清空草稿」',
  /s\.libraryLoaded && \(s\.library\|\|\[\]\)\.length===0 && !s\.currentLibraryId && draftHasContent\(s\.draft\)/.test(src)
  && /host\.orphanClear/.test(src)
  && /store\.clearDraft\(\)/.test(src), '');

check('④ pullDraft 把「来源 id 不在库里」当成孤儿（不把删除指向不存在的卡）',
  /if\(snapLib\.libraryLoaded\)\{[\s\S]{0,400}if\(!inLib\) originId = null;/.test(src), '');

check('⑤ 词条中英各一份',
  ['host.bar.failed', 'host.bar.failedHint', 'host.retry', 'host.retrying', 'host.bar.orphan', 'host.bar.orphanHint', 'host.orphanClear', 'workshop.library.unreachable']
    .every((k) => (src.match(new RegExp(`"${k.replace(/\./g, '\\.')}"`, 'g')) || []).length >= 2), '');

// —— ② 行为：RPC 传输失败 → rpcError；恢复后自动清；重试会重新拉列表 ——
const card = (name) => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: { name, description: '设定', first_mes: '[时间：2026-01-01 08:00]\n开场。', character_book: { entries: [] } },
});

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const req = JSON.parse(init.body);
    calls.push({ endpoint: req.method, payload: req.payload });
    const out = await handler(req.method, req.payload);
    if (out && out.__raw !== undefined) return { status: out.__status || 500, text: async () => out.__raw };
    return { status: 200, text: async () => JSON.stringify({ type: 'server-response', rpcId: req.rpcId, result: out }) };
  };
  return calls;
}

let mode = 'down';   // down = 返回 404 的 HTML；up = 正常信封
const library = [];
const calls = stubFetch((endpoint, payload) => {
  if (mode === 'down') return { __raw: '<!doctype html><h1>404</h1>', __status: 404 };
  if (endpoint === 'cc_listLibrary') return { ok: true, value: { entries: library.slice() } };
  if (endpoint === 'cc_getDraft') {
    const args = payload && payload.args ? payload.args : {};
    const originId = args.sessionId === 'sess-gone' ? 'lib-gone' : 'lib-a';
    return { ok: true, value: { key: args.sessionId, draft: card('甲卡'), draftStatus: {}, originId } };
  }
  return { ok: true, value: {} };
});

const { registration, React, hooks } = loadClient();
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) {} return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
};
const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);
const store = registered['conversation.input.dock'].opts.inject('warmup').store;

// 传输失败：refreshLibrary 失败 → rpcError 有值、libraryLoaded 仍为 false
await store.refreshLibrary();
let s = store.getSnapshot();
check('⑥ 传输失败（HTTP 404 的非信封响应）→ rpcError 被记录',
  !!s.rpcError && s.rpcError.code === 'transport/http-404' && s.rpcError.status === 404,
  JSON.stringify(s.rpcError));
check('⑥b 失败时 libraryLoaded 仍为 false（左栏会说「读不到角色库」而不是空库）',
  s.libraryLoaded === false, String(s.libraryLoaded));

// 恢复：成功一次 → rpcError 自动清掉、libraryLoaded=true
mode = 'up';
library.push({ id: 'lib-a', name: '甲卡', groupId: null });
await store.refreshLibrary();
s = store.getSnapshot();
check('⑥c 恢复后 rpcError 被清空、libraryLoaded=true、列表到位',
  s.rpcError === null && s.libraryLoaded === true && s.library.length === 1,
  JSON.stringify({ err: s.rpcError, loaded: s.libraryLoaded, n: s.library.length }));

// 拉草稿：originId 在库里 → currentLibraryId 正常；不在库里 → 视为孤儿
await store._pullDraft('sess-ok');
check('⑦ 来源 id 在库里 → currentLibraryId 正常恢复',
  store.getSnapshot().currentLibraryId === 'lib-a', String(store.getSnapshot().currentLibraryId));
await store._pullDraft('sess-gone');
check('⑦b 来源 id 不在库里 → 视为孤儿（currentLibraryId=null，删除按钮不会指向不存在的卡）',
  store.getSnapshot().currentLibraryId === null, String(store.getSnapshot().currentLibraryId));

// 重试：down 状态下点「重试连接」→ 重新拉列表并给出提示
mode = 'down';
const before = calls.filter((c) => c.endpoint === 'cc_listLibrary').length;
store.retryHost();
for (let i = 0; i < 12; i += 1) await Promise.resolve();
const after = calls.filter((c) => c.endpoint === 'cc_listLibrary').length;
check('⑧ retryHost() 真的重新拉了一次角色库',
  after === before + 1, `${before} → ${after}`);

// 渲染：rpcError 存在时工坊顶部必须出现红色横幅文案
mode = 'down';
await store.refreshLibrary();
store.setPanel(true);
hooks.slots.length = 0;   // fake React 按渲染顺序缓存 hook 槽位：重渲染前必须重置，否则拿到上一次的 state
const tree = registered['shell.overlay'].comp({ store, t: (k) => k });
const flat = [];
(function walk(n) {
  if (!n) return;
  if (typeof n === 'string') { flat.push(n); return; }
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.children) n.children.forEach(walk);
})(tree);
check('⑨ 工坊渲染出连通性横幅（host.bar.failed）',
  flat.some((x) => String(x).indexOf('host.bar.failed') === 0), flat.filter((x) => String(x).indexOf('host.') === 0).join(','));

delete globalThis.window;
finish();
