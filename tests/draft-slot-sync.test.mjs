/**
 * 草稿槽同步回归测试（不随插件发布，files 未包含 tests）—— issue #5。
 *
 * 背景：前端与 Tools 读到了**不同的草稿槽**。三个原因叠加：
 *   ① `useCcPreset` 用 `useSessions(s=>s.current)` 当「当前会话」，而 dsh 0.1.6-alpha.2 的
 *      SessionListState 只有 ids/byId/phase（没有 current）→ 恒为 null，投影权威失效，
 *      currentId 退化成整个 SessionSnapshot 对象；
 *   ② `apply()` 里先 `pullDraftThrottled(null)` 占了 500ms 全局节流，会话就绪后的第一次正式
 *      拉取被吞掉 → `store.currentSessionId` 永远是 null → 4s 轮询一直拿 null 去拉；主机在
 *      HTTP 上下文里 `currentInitiator()` 为空，回退成 "default" 槽；
 *   ③ `Capsule`（会话域）与 `Workshop`（`shell.overlay` 根域，拿不到会话 id）共用一份 store，
 *      根域实例每秒 evaluate() 一次，旧 decideCcMode 在 `!hasSession` 时返回 false，
 *      把会话域实例刚判定为 true 的 isCcMode 清掉 → 胶囊一闪一闪。
 *
 * 本文件不再只做源码级守卫：它把 lib/client.js 真的装进一个假 React/假 slot/假 RPC 的 harness
 * 里跑起来，直接断言「哪些请求发出去了、渲染了什么、状态变成什么」。
 * 例如最核心的一条：**启动后一次 cc_getDraft 都不许发** —— 旧代码会发一次 `args: {}`。
 *
 * 运行：node tests/draft-slot-sync.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 假 React：hook 顺序可预期，effect 收集起来由测试手动跑 ——
const effectQueue = [];
const intervals = [];
const timeouts = [];
const React = {
  createElement(type, props) {
    return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) };
  },
  useState(init) { return [typeof init === 'function' ? init() : init, function () {}]; },
  useCallback(fn) { return fn; },
  useEffect(fn) { effectQueue.push(fn); },
  useMemo(fn) { return fn(); },
  useRef(init) { return { current: init }; },
};

// —— 全局替身：定时器全部收集起来不触发（否则 1.2s 的重试会掺进断言里）——
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
globalThis.setTimeout = function (fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function (fn, ms) { intervals.push({ fn, ms }); return intervals.length; };
globalThis.clearInterval = function () {};
const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
};

// —— 装载 bundle（client.js 是 window.__ModuleLoader__ 外壳）——
let registration = null;
globalThis.window = { __ModuleLoader__: { load(def) { registration = def; } } };
new Function('window', src)(globalThis.window);
if (!registration) { console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load'); process.exit(1); }

// —— 假 RPC：记录每一次调用，并按 endpoint 返回可编程的信封 ——
const calls = [];
let handler = function () { return { ok: false, error: { code: 'internal', message: 'no handler' } }; };
const rpcCall = function (channel, endpoint, payload) {
  calls.push({ channel, endpoint, payload });
  return Promise.resolve(handler(endpoint, payload));
};
const callsOf = (endpoint) => calls.filter((c) => c.endpoint === endpoint);

// —— 假 slot：把注册的三个组件与它们的 inject（拿到 store）都接住 ——
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call: rpcCall } },
};

const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
if (registration.id !== '@xia-sc/dsh-cc-studio') check('bundle 的 id 等于包名', false, registration.id);
await mod.apply(fakeCtx);

const dock = registered['conversation.input.dock'];
const overlay = registered['shell.overlay'];
check('三个挂载点都注册了（dock / overlay / settings）',
  !!(dock && overlay && registered['settings.section']),
  Object.keys(registered).join(','));
const store = dock.opts.inject('warmup').store;
const t = (k) => k;

// 渲染一次组件：收集本次渲染的 effect，交给调用方按需执行
function render(comp, props) {
  effectQueue.length = 0;
  const tree = comp(props);
  const effects = effectQueue.slice();
  effectQueue.length = 0;
  return { tree, effects };
}
function run(effects) { effects.forEach((fn) => { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } }); }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

// 主机 getDraftFor 保证的草稿形态（character_book.entries 一定存在）——前端 Capsule 直接读它
function fullDraft(name, entries) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: name, nickname: '', tags: [], creator: '', character_version: '0.1',
    description: '', personality: '', scenario: '', system_prompt: '', post_history_instructions: '',
    first_mes: '', alternate_greetings: [], group_only_greetings: [], mes_example: '', creator_notes: '',
    creator_notes_multilingual: {}, source: [], assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
    creation_date: 1, modification_date: 1,
    character_book: { name: '', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {}, entries: entries || [] },
  } };
}

function capsProps(sid, preset) {
  return {
    store, t,
    sessionId: sid,
    session: { sessionId: sid },
    useSessions: (sel) => sel({ ids: [sid], byId: { [sid]: { id: sid, projectionValues: { agentPreset: preset } } } }),
  };
}

// —— 1) 启动不许发任何 keyless cc_getDraft ——
check('① apply() 之后一次 cc_getDraft 都没发（旧代码会发 args={} → 主机回退 default 槽）',
  callsOf('cc_getDraft').length === 0, JSON.stringify(calls));

// —— 2) 根域实例（shell.overlay）无权把 CC 状态清成 false ——
{
  store.setIsCcMode(true);
  const r = render(overlay.comp, { store, t });   // 根域：没有 sessionId / session / useSessions
  run(r.effects);
  check('② 根域实例渲染后 isCcMode 保持 true（旧代码在这里写成 false → 胶囊闪退）',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
  // 1s DOM 轮询也要走同一判定
  const polls = intervals.slice();
  polls.forEach((x) => { try { x.fn(); } catch (e) {} });
  check('②b 根域实例的 1s 轮询也不会把 isCcMode 清成 false',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
  check('②c 没有会话上下文时不会去拉草稿', callsOf('cc_getDraft').length === 0, String(callsOf('cc_getDraft').length));
}

// —— 3) 会话域实例：会话 id 来自 slot props，拉草稿必须带上它 ——
const S1 = 'session-1111';
{
  handler = (endpoint, payload) => {
    if (endpoint === 'cc_getDraft' && payload.args.sessionId === S1) {
      return { ok: true, value: { key: S1, keySource: 'arg', draft: fullDraft('S1 的草稿', [{ content: 'a' }]), draftStatus: { isNew: false, key: S1 } } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const r = render(dock.comp, capsProps(S1, 'cc'));
  run(r.effects);
  check('③a 会话 id 从 props.sessionId 取出并发布到 store',
    store.getSnapshot().currentSessionId === S1, String(store.getSnapshot().currentSessionId));
  const pulls = callsOf('cc_getDraft');
  check('③b 拉草稿带上了同一会话 id（不是 args={}）',
    pulls.length === 1 && pulls[0].payload.args.sessionId === S1, JSON.stringify(pulls.map((p) => p.payload)));
  check('③c 投影来自 byId[会话id]（不再读不存在的 s.current）→ 判定为 CC 模式',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
  await flush();
  check('③d 满草稿被渲染进 store（同一把 key 读写）',
    store.getSnapshot().draft.data.name === 'S1 的草稿' && store.getSnapshot().slotWarn === null,
    JSON.stringify({ name: store.getSnapshot().draft.data.name, warn: store.getSnapshot().slotWarn }));
}

// —— 4) 主机回的 key 与点名的 key 不一致：不渲染，只告警 ——
const S2 = 'session-2222';
{
  handler = (endpoint) => {
    if (endpoint === 'cc_getDraft') {
      return { ok: true, value: { key: 'default', keySource: 'fallback', draft: fullDraft('别的槽的空壳'), draftStatus: { isNew: true, key: 'default' } } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const r = render(dock.comp, capsProps(S2, 'cc'));
  run(r.effects);
  await flush();
  const warn = store.getSnapshot().slotWarn;
  check('④a key 不一致时不渲染该草稿（保留上一份，而不是画成空壳）',
    store.getSnapshot().draft.data.name === 'S1 的草稿', String(store.getSnapshot().draft.data.name));
  check('④b 不一致被记录成告警（requested / got / source）',
    !!warn && warn.requested === S2 && warn.got === 'default' && warn.source === 'fallback', JSON.stringify(warn));
}

// —— 5) 救回入口：候选槽只报 default，迁过一次就不再提示 ——
const S3 = 'session-3333';
{
  handler = (endpoint) => {
    if (endpoint === 'cc_getDraft') {
      return { ok: true, value: { key: S3, keySource: 'arg', draft: fullDraft(''), draftStatus: { isNew: true, key: S3 },
        alternateSlots: [{ key: 'default', updatedAt: 1, name: '旧版遗留', entries: 2, hasContent: true }] } };
    }
    if (endpoint === 'cc_migrateDraft') {
      return { ok: true, value: { key: S3, from: 'default', draft: fullDraft('旧版遗留', [{ content: 'a' }, { content: 'b' }]),
        moved: { name: '旧版遗留', entries: 2, filled: 3 }, draftStatus: { isNew: false, key: S3 } } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const r = render(dock.comp, capsProps(S3, 'cc'));
  run(r.effects);
  await flush();
  const alts = store.getSnapshot().alternateSlots;
  check('⑤a 空壳会话槽 + 盘上有 default 草稿 → 提示可迁入',
    !!alts && alts.length === 1 && alts[0].key === 'default', JSON.stringify(alts));

  store.migrateSlot('default');
  await flush();
  const mig = callsOf('cc_migrateDraft');
  check('⑤b 迁移请求带 from/to/sessionId（to 就是当前会话槽）',
    mig.length === 1 && mig[0].payload.args.from === 'default' && mig[0].payload.args.to === S3 && mig[0].payload.args.sessionId === S3,
    JSON.stringify(mig.map((m) => m.payload)));
  check('⑤c 迁过一次后写下 localStorage 标记（源槽内容不删，但不再反复弹横幅）',
    storage.get('dsh-cc-studio-legacy-notice') === '1', String(storage.get('dsh-cc-studio-legacy-notice')));

  // 再开一个新会话（仍是 default 候选）→ 因为已标记，不再提示
  const S4 = 'session-4444';
  handler = (endpoint) => {
    if (endpoint === 'cc_getDraft') {
      return { ok: true, value: { key: S4, keySource: 'arg', draft: fullDraft(''), draftStatus: { isNew: true, key: S4 },
        alternateSlots: [{ key: 'default', updatedAt: 1, name: '旧版遗留', entries: 2, hasContent: true }] } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const r2 = render(dock.comp, capsProps(S4, 'cc'));
  run(r2.effects);
  await flush();
  check('⑤d 已标记过则不再重复提示', store.getSnapshot().alternateSlots === null, JSON.stringify(store.getSnapshot().alternateSlots));
}

// —— 6) 切会话后回来的过期响应必须丢掉 ——
const S5 = 'session-5555';
const S6 = 'session-6666';
{
  let releaseS5 = null;
  handler = (endpoint, payload) => {
    if (endpoint === 'cc_getDraft' && payload.args.sessionId === S5) {
      return new Promise((resolve) => { releaseS5 = () => resolve({ ok: true, value: { key: S5, draft: fullDraft('S5 的草稿'), draftStatus: { isNew: false, key: S5 } } }); });
    }
    if (endpoint === 'cc_getDraft' && payload.args.sessionId === S6) {
      return { ok: true, value: { key: S6, draft: fullDraft('S6 的草稿'), draftStatus: { isNew: false, key: S6 } } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const r = render(dock.comp, capsProps(S5, 'cc'));
  run(r.effects);
  check('⑥a S5 的请求已发出且当前会话是 S5', store.getSnapshot().currentSessionId === S5, String(store.getSnapshot().currentSessionId));
  store.setSessionId(S6);                       // 用户切到 S6
  if (releaseS5) releaseS5();
  await flush();
  check('⑥b S5 的过期响应被丢弃（没把 S5 的草稿画进 S6）',
    store.getSnapshot().draft.data.name !== 'S5 的草稿', String(store.getSnapshot().draft.data.name));
  check('⑥c 当前会话仍是 S6', store.getSnapshot().currentSessionId === S6, String(store.getSnapshot().currentSessionId));
}

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 140)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
