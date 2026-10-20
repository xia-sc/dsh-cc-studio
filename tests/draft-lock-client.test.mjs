/**
 * 草稿锁客户端半回归测试（不随插件发布，files 未包含 tests）—— 0.11.0。
 *
 * 背景：LLM 在工坊草稿里创作 A 卡时，用户点「载入」B 卡会把同一会话槽的草稿整份替换，
 * LLM 已写入但未保存的内容被覆盖。宿主半加了「LLM 创作锁」，客户端半负责三件事：
 *   ① 只读：锁 active（且设置里没关「LLM 创作保护」）时，所有写草稿的 store 动作都不发 RPC；
 *   ② 只读预览：锁定时载入/导入只显示「假如载入会变成什么」，绝不覆盖 LLM 的草稿，
 *      期间轮询只更新 llmDraft 快照，退出预览后原样回到 LLM 那份草稿；
 *   ③ 开关：设置页关掉保护 → 所有写 RPC 带 force:true，完全恢复旧行为。
 *
 * 本文件把 lib/client.js 真装进假 React / 假 slot / 假 RPC harness 里跑起来，断言
 * 「哪些请求发出去了、store 变成什么、横幅渲染了什么」—— 与 draft-slot-sync.test.mjs 同一套模式。
 *
 * 运行：node tests/draft-lock-client.test.mjs   （全绿退出码 0）
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

// —— 全局替身：定时器全部收集起来由测试按需触发（1.2s/3s 的 CC 探测重试不能掺进断言）——
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
const callsOf = (endpoint) => calls.filter((c) => c.endpoint === endpoint);
let handler = function () { return { ok: false, error: { code: 'internal', message: 'no handler' } }; };
const rpcCall = function (channel, endpoint, payload) {
  calls.push({ channel, endpoint, payload });
  return Promise.resolve(handler(endpoint, payload));
};

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
async function flush() { for (let i = 0; i < 14; i++) await Promise.resolve(); }

// 把渲染树里的文本（字符串 child）全部摊平，用来断言横幅显示的是哪一条文案键
function texts(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  (node.children || []).forEach((c) => {
    if (typeof c === 'string') out.push(c);
    else texts(c, out);
  });
  return out;
}

// 主机 getDraftFor 保证的草稿形态（character_book.entries 一定存在）
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
function lockFixture(over) {
  return Object.assign({ owner: 'llm', cardName: '锁天司', since: 1000, updatedAt: 2000,
    ageSec: 120, ttlSec: 1800, stale: false, active: true }, over || {});
}
function capsProps(sid, preset) {
  return {
    store, t,
    sessionId: sid,
    session: { sessionId: sid },
    useSessions: (sel) => sel({ ids: [sid], byId: { [sid]: { id: sid, projectionValues: { agentPreset: preset } } } }),
  };
}

// —— 0) 默认设置：锁保护是开的（老用户升级上来也一样）——
check('① 默认 draftLock=true（localStorage 里没有这个键时按开处理）',
  store.getSnapshot().draftLock === true, String(store.getSnapshot().draftLock));

// —— 1) 锁定的会话槽：getDraft 的 draftStatus.lock → store.lock ——
const S1 = 'session-lock-1';
const S2 = 'session-lock-2';
const S3 = 'session-lock-3';
const S4 = 'session-lock-4';
let hostLock = lockFixture();
let hostDraftName = 'LLM 草稿';
let setDraftFail = false;
handler = (endpoint, payload) => {
  const sid = (payload && payload.args && payload.args.sessionId) || S1;
  if (endpoint === 'cc_getDraft') {
    return { ok: true, value: { key: sid, keySource: 'arg', draft: fullDraft(hostDraftName, [{ content: 'a' }]),
      draftStatus: { isNew: false, key: sid, lock: hostLock } } };
  }
  if (endpoint === 'cc_loadFromLibrary') {
    return { ok: true, value: { locked: true, lock: hostLock,
      preview: { id: 'c9', draft: fullDraft('预览卡', [{ content: 'p' }]), meta: { name: '预览卡' } }, key: sid } };
  }
  if (endpoint === 'cc_setDraft') {
    if (setDraftFail) return { ok: false, error: { code: 'draft-locked', message: 'locked', details: { code: 'draft-locked' } } };
    return { ok: true, value: { ok: true } };
  }
  return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
};
{
  const r = render(dock.comp, capsProps(S1, 'cc'));
  run(r.effects);
  await flush();
  const s = store.getSnapshot();
  check('② 轮询把 draftStatus.lock 放进 store.lock（owner/cardName/active 都在）',
    !!s.lock && s.lock.owner === 'llm' && s.lock.active === true && s.lock.cardName === '锁天司',
    JSON.stringify(s.lock));
  check('②b 锁 active + 开关开 → isLockActive() 与 isReadOnly() 都为真',
    store.isLockActive() === true && store.isReadOnly() === true,
    String(store.isLockActive()) + '/' + String(store.isReadOnly()));
  // 工坊打开时横幅必须是「LLM 正在创作」那条（不是预览）
  store.setPanel(true);
  const banner = texts(render(overlay.comp, { store, t }).tree);
  check('②c 无预览时横幅显示 lock.bar.active（并带上释放提示）',
    banner.indexOf('lock.bar.active') >= 0 && banner.indexOf('lock.bar.activeHint') >= 0 && banner.indexOf('lock.bar.preview') < 0,
    banner.filter((x) => x.indexOf('lock.') === 0).join(','));
}

// —— 2) 锁定时载入 → 只进只读预览，不写草稿、不发 cc_setDraft ——
let previewSnapshot = null;
{
  // 模拟「4s 轮询还没到」：清掉 store.lock，锁只能从载入响应里的 lock 字段恢复。
  store.setLock(null);
  check('③a store.lock 已清空（下面验证载入响应自带锁，不只依赖轮询）',
    store.getSnapshot().lock === null, JSON.stringify(store.getSnapshot().lock));
  const setDraftBefore = callsOf('cc_setDraft').length;
  const draftBefore = JSON.stringify(store.getSnapshot().draft);
  await store.loadFromLibrary('c9');
  await flush();
  const s = store.getSnapshot();
  previewSnapshot = s.preview;
  check('③ 载入返回 locked:true → 进入预览（id/name/meta 已记录）',
    !!s.preview && s.preview.id === 'c9' && s.preview.name === '预览卡',
    JSON.stringify(s.preview));
  check('③f 载入响应里的 lock 直接生效（退出预览后立刻只读，不等下一次轮询）',
    !!s.lock && s.lock.owner === 'llm' && s.lock.active === true, JSON.stringify(s.lock));
  check('③b 显示的是预览卡，currentLibraryId 保持原样（预览不算载入）',
    s.draft.data.name === '预览卡' && s.currentLibraryId === null,
    JSON.stringify({ name: s.draft.data.name, cur: s.currentLibraryId }));
  check('③c 预览期间一次 cc_setDraft 都没发（草稿文件没被覆盖）',
    callsOf('cc_setDraft').length === setDraftBefore && JSON.stringify(s.llmDraft) === draftBefore,
    'setDraft=' + (callsOf('cc_setDraft').length - setDraftBefore));
  check('③d 预览期间仍只读（isReadOnly=true）', store.isReadOnly() === true, String(store.isReadOnly()));
  const banner = texts(render(overlay.comp, { store, t }).tree);
  check('③e 预览横幅优先显示（lock.bar.preview + 退出按钮），不再显示「正在创作」',
    banner.indexOf('lock.bar.preview') >= 0 && banner.indexOf('lock.preview.exit') >= 0 && banner.indexOf('lock.bar.active') < 0,
    banner.filter((x) => x.indexOf('lock.') === 0).join(','));
}

// —— 3) 预览期间轮询：只更新 llmDraft，不覆盖正在显示的预览卡 ——
{
  hostDraftName = 'LLM 草稿 v2';
  store._pullDraft(S2);
  await flush();
  const s = store.getSnapshot();
  check('④ 预览期间轮询不覆盖预览卡（显示仍是「预览卡」）',
    s.draft.data.name === '预览卡' && !!s.preview, String(s.draft.data.name));
  check('④b 轮询把 LLM 的最新草稿存进 llmDraft / llmDraftStatus（退出预览时用它恢复）',
    s.llmDraft && s.llmDraft.data.name === 'LLM 草稿 v2' && s.llmDraftStatus && s.llmDraftStatus.lock && s.llmDraftStatus.lock.owner === 'llm',
    JSON.stringify({ llm: s.llmDraft && s.llmDraft.data.name, status: s.llmDraftStatus && s.llmDraftStatus.lock }));
}

// —— 4) 退出预览：用 llmDraft 恢复，锁仍在 → 仍只读 ——
{
  store.exitPreview();
  await flush();
  const s = store.getSnapshot();
  check('⑤ 退出预览后显示 LLM 的最新草稿（不是进入预览前那份旧快照）',
    s.preview === null && s.draft.data.name === 'LLM 草稿 v2', String(s.draft.data.name));
  check('⑤b 锁还 active → 退出预览后依旧只读',
    s.lock && s.lock.active === true && store.isReadOnly() === true, JSON.stringify(s.lock));
  check('⑤c 退出预览给出提示文案', s.lastMsg === 'lock.msg.exitPreview', String(s.lastMsg));
}

// —— 5) 锁定时 updateDraft 直接返回：不改本地草稿、不排 cc_setDraft ——
{
  const timersBefore = timeouts.length;
  const draftBefore = JSON.stringify(store.getSnapshot().draft);
  const setDraftBefore = callsOf('cc_setDraft').length;
  store.updateDraft(function (d) { d.name = '用户抢着改的名字'; });
  timeouts.slice(timersBefore).forEach((x) => { try { x.fn(); } catch (e) {} });
  await flush();
  check('⑥ 锁定时 updateDraft 不改草稿、不排落盘（旧代码会 120ms 后发 cc_setDraft 覆盖 LLM）',
    JSON.stringify(store.getSnapshot().draft) === draftBefore &&
    timeouts.length === timersBefore && callsOf('cc_setDraft').length === setDraftBefore,
    'timers=' + (timeouts.length - timersBefore) + ' setDraft=' + (callsOf('cc_setDraft').length - setDraftBefore));
}

// —— 6) 锁超时（stale）：自动解锁，不置只读 ——
{
  hostLock = lockFixture({ stale: true, active: false, ageSec: 4000, updatedAt: 1000 });
  hostDraftName = 'LLM 草稿 v2b';
  store._pullDraft(S3);
  await flush();
  const s = store.getSnapshot();
  check('⑦ stale 锁不置只读（TTL 是安全阀：LLM 再写会重新上锁）',
    s.lock && s.lock.stale === true && store.isLockActive() === false && store.isReadOnly() === false,
    JSON.stringify({ lock: s.lock, ro: store.isReadOnly() }));
}

// —— 7) 锁释放后 updateDraft 恢复落盘，且写请求不带 force（保护开着）——
{
  hostLock = null;
  hostDraftName = 'LLM 草稿 v3';
  store._pullDraft(S4);
  await flush();
  check('⑧ getDraft 返回 lock=null → store.lock 清空、可编辑',
    store.getSnapshot().lock === null && store.isReadOnly() === false, JSON.stringify(store.getSnapshot().lock));
  const timersBefore = timeouts.length;
  store.updateDraft(function (d) { d.name = '用户改的名字'; });
  const scheduled = timeouts.slice(timersBefore);
  check('⑧b 可编辑时 updateDraft 重新排一次 cc_setDraft（120ms 落盘）',
    scheduled.length === 1 && store.getSnapshot().draft.data.name === '用户改的名字',
    'scheduled=' + scheduled.length);
  scheduled.forEach((x) => { try { x.fn(); } catch (e) {} });
  await flush();
  const sets = callsOf('cc_setDraft');
  const last = sets[sets.length - 1];
  check('⑧c 落盘请求带 sessionId、不带 force（开关开着时宿主照常做锁检查）',
    !!last && last.payload.args.sessionId === S4 && last.payload.args.draft.data.name === '用户改的名字' &&
    last.payload.args.force !== true,
    last ? JSON.stringify({ sid: last.payload.args.sessionId, force: last.payload.args.force }) : 'none');
}

// —— 8) 拉草稿与写草稿之间的竞态：宿主回 draft-locked → 刷新锁 + 明说没写入 ——
{
  hostLock = lockFixture();
  hostDraftName = 'LLM 草稿 v4';
  setDraftFail = true;
  const getBefore = callsOf('cc_getDraft').length;
  store.updateDraft(function (d) { d.name = '竞态里改的名字'; });
  const pending = timeouts[timeouts.length - 1];
  pending.fn();
  await flush();
  const s = store.getSnapshot();
  check('⑨ pushDraftToHost 收到 details.code=draft-locked → 提示「本次修改未写入」',
    s.lastMsg === 'lock.msg.writeBlocked', String(s.lastMsg));
  check('⑨b 自动拉一次 cc_getDraft 把锁状态刷新回来（重新变只读）',
    callsOf('cc_getDraft').length > getBefore && !!s.lock && s.lock.owner === 'llm' && store.isReadOnly() === true,
    'getDraft+' + (callsOf('cc_getDraft').length - getBefore));
  setDraftFail = false;
}

// —— 9) 设置里关掉保护：载入直接写、带 force:true、不进入预览 ——
{
  store.setDraftLock(false);
  const saved = JSON.parse(storage.get('dsh-cc-studio-settings') || '{}');
  check('⑩ 设置页开关写进 localStorage（draftLock=false），store 同步',
    store.getSnapshot().draftLock === false && saved.draftLock === false,
    JSON.stringify(saved));
  check('⑩b 开关关闭后锁不再置只读（即使宿主还报着锁）',
    store.isLockActive() === false && store.isReadOnly() === false, String(store.isReadOnly()));
  // 关掉保护 = 旧行为：宿主会直接写并清锁，所以这里返回的是普通草稿，而不是 locked+preview
  const savedHandler = handler;
  handler = (endpoint, payload) => {
    const sid = (payload && payload.args && payload.args.sessionId) || S4;
    if (endpoint === 'cc_loadFromLibrary') return { ok: true, value: { draft: fullDraft('直接载入'), meta: { name: '直接载入' }, key: sid } };
    if (endpoint === 'cc_setDraft') return { ok: true, value: { ok: true } };
    return savedHandler(endpoint, payload);
  };
  await store.loadFromLibrary('c1');
  await flush();
  const loads = callsOf('cc_loadFromLibrary');
  const lastLoad = loads[loads.length - 1];
  const s = store.getSnapshot();
  check('⑪ 关掉保护后载入带 force:true（宿主据此跳过锁检查并清锁）',
    !!lastLoad && lastLoad.payload.args.force === true && lastLoad.payload.args.id === 'c1',
    lastLoad ? JSON.stringify(lastLoad.payload.args) : 'none');
  check('⑪b 关掉保护后载入即普通载入：不进预览、显示被替换、恢复可编辑',
    s.preview === null && s.draft.data.name === '直接载入' && store.isReadOnly() === false,
    JSON.stringify({ preview: s.preview, name: s.draft.data.name }));
  // 写 RPC 也必须带 force（否则宿主仍会按锁拒绝）
  const timersBefore = timeouts.length;
  store.updateDraft(function (d) { d.name = '关掉保护后的修改'; });
  timeouts.slice(timersBefore).forEach((x) => { try { x.fn(); } catch (e) {} });
  await flush();
  const sets = callsOf('cc_setDraft');
  const lastSet = sets[sets.length - 1];
  check('⑪c 关掉保护后 cc_setDraft 也带 force:true',
    !!lastSet && lastSet.payload.args.force === true, lastSet ? JSON.stringify(lastSet.payload.args.force) : 'none');
}

// —— 10) 词表：锁相关键中英各一份、键集一致、占位符一致 ——
{
  const zhBlock = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
  const enBlock = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
  const keys = (b) => [...b.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"\s*:/g)].map((m) => m[1]);
  const zhKeys = keys(zhBlock), enKeys = keys(enBlock);
  const lockKeys = [...new Set(zhKeys.filter((k) => k.indexOf('lock.') === 0))];
  const settingsKeys = ['settings.behavior.draftLock', 'settings.behavior.draftLockDesc'];
  const missing = lockKeys.filter((k) => enKeys.indexOf(k) < 0).concat(settingsKeys.filter((k) => enKeys.indexOf(k) < 0 || zhKeys.indexOf(k) < 0));
  check('⑫ 锁相关键中英齐全（lock.* + settings.behavior.draftLock*）',
    lockKeys.length >= 11 && missing.length === 0, 'lockKeys=' + lockKeys.length + ' missing=' + missing.join(','));
  const holders = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((x) => x !== 'char' && x !== 'user').sort().join(',');
  const pick = (block, k) => {
    const m = block.match(new RegExp('"' + k.replace(/\./g, '\\.') + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1] : null;
  };
  const bad = lockKeys.concat(settingsKeys).filter((k) => {
    const zv = pick(zhBlock, k), ev = pick(enBlock, k);
    return zv === null || ev === null || holders(zv) !== holders(ev);
  });
  check('⑫b 锁相关键 zh/en 占位符集合一致', bad.length === 0, bad.join(','));
  check('⑫c 预览横幅的退出按钮走词表（UI 层不出现中文字面量）',
    /t\("lock\.preview\.exit"\)/.test(src) && /store\.exitPreview\(\)/.test(src), '');
}

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
