/**
 * CC 模式探测回归测试（不随插件发布，files 未包含 tests）。
 *
 * 历史（issue #5）：首次切到 CC 模式时胶囊不出现，只有刷新页面或切换会话才出现。
 * 根因是探测逻辑读错了字段，且 effect 依赖数组永不变化（读 sess.preset / presetId /
 * agentPreset / mode，而真实字段是 session.projectionValues.agentPreset）。
 *
 * 0.12.3 的 bug（用户实机复现）：进入 CC 模式会话「角色卡工坊」→ 胶囊出现；切到非 CC
 * 会话 → 胶囊**不消失**；再切一次非 CC 会话 → 才消失。根因不是字段读错，而是：
 *   ① isCcMode 只是一个全局布尔，没有「它属于哪个会话」—— 切会话时旧结论被当成新会话的结论；
 *   ② 旧判定在「有会话、但会话投影还没到」时返回 `prevIsCc ? true : null`，一旦为 true 就粘住；
 *   ③ 唯一的权威补救（cc_isCcMode）写在 `if(!isCcMode)` 分支里 —— 从「是」切到「不是」这条
 *      路径永远问不到主机，只能等下一次切换时投影恰好可用（=「再切一次才消失」）。
 *
 * 本文件三层：
 *   1) 纯函数：ccPresetIdOf / ccPresetOfValue / ccModeFromDom / decideCcVerdict / ccSessionIdOfProps
 *   2) 运行时：把 lib/client.js 真的装进假 React/假 slot/假 RPC 里，断言「切会话的瞬间状态变什么」
 *   3) 源码级守卫：钉住上面三条根因的修法（免得以后又被「顺手保持旧值」改回去）
 *
 * 运行：node tests/cc-detection.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// 从源码里摘出真实实现执行（client.js 是 window.__ModuleLoader__ 外壳，无法直接 import）
function grabFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到 function ${name}(`);
  let depth = 0;
  const open = src.indexOf('{', start);
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} 括号不闭合`);
}
const CC_ID = (src.match(/var CC_PRESET_ID\s*=\s*"([^"]+)"/) || [])[1];
if (!CC_ID) { console.log('FAIL  源码中找不到 CC_PRESET_ID'); process.exit(1); }

// —— 1) ccPresetIdOf：只认 projectionValues.agentPreset（旧字段兜底是错误来源，已删）——
const ccPresetIdOf = new Function(`${grabFunction('ccPresetIdOf')}; return ccPresetIdOf;`)();
{
  check('读取 projectionValues.agentPreset（旧代码漏掉的字段）',
    ccPresetIdOf({ projectionValues: { agentPreset: 'cc' } }) === 'cc',
    String(ccPresetIdOf({ projectionValues: { agentPreset: 'cc' } })));
  check('非 CC 预设也如实返回', ccPresetIdOf({ projectionValues: { agentPreset: 'standard' } }) === 'standard', '');
  check('projectionValues 缺失 → null', ccPresetIdOf({}) === null, String(ccPresetIdOf({})));
  check('agentPreset 非字符串 → null', ccPresetIdOf({ projectionValues: { agentPreset: 42 } }) === null, '');
  check('空字符串 → null（不把空串当预设）', ccPresetIdOf({ projectionValues: { agentPreset: '' } }) === null, '');
  check('session 为 null/undefined 安全', ccPresetIdOf(null) === null && ccPresetIdOf(undefined) === null, '');
  // 旧实现还有 `sess.preset || sess.presetId || sess.agentPreset || sess.mode` 兜底：
  // 那几个字段在 dsh 里从来不存在，而 `mode` 是别的语义 —— 兜底只会制造假结论，已删除。
  check('不再从 sess.preset / presetId / agentPreset / mode 兜底',
    ccPresetIdOf({ preset: 'cc' }) === null && ccPresetIdOf({ mode: 'cc' }) === null,
    String(ccPresetIdOf({ preset: 'cc' })));
}

// —— 2) ccPresetOfValue：三态必须分开（未知 / 确定没有 / 有值） ——
const ccPresetOfValue = new Function(`${grabFunction('ccPresetOfValue')}; return ccPresetOfValue;`)();
{
  const undef = ccPresetOfValue(undefined);
  check('undefined = 未知（来源还没到）', undef.known === false && undef.preset === null, JSON.stringify(undef));
  const nul = ccPresetOfValue(null);
  check('null = 已确定没有预设（能下「不是 CC」的结论）', nul.known === true && nul.preset === null, JSON.stringify(nul));
  const str = ccPresetOfValue('cc');
  check('字符串 = 预设 id', str.known === true && str.preset === 'cc', JSON.stringify(str));
  check('数字/对象 = 未知（不猜）', ccPresetOfValue(42).known === false && ccPresetOfValue({}).known === false, '');
}

// —— 3) ccModeFromDom：只认预设芯片，且排除自身 UI、忽略不可见元素 ——
const ccModeFromDom = new Function(`${grabFunction('ccModeFromDom')}; return ccModeFromDom;`)();
function stubDom(buttons) {
  globalThis.document = {
    querySelectorAll(sel) {
      // 被测实现只用 button[aria-haspopup="menu"] 这一个选择器
      if (sel !== 'button[aria-haspopup="menu"]') return [];
      return buttons.filter((b) => b.menuTrigger !== false);
    },
  };
}
function btn(text, { visible = true, ours = false, menuTrigger = true } = {}) {
  return {
    textContent: text,
    offsetParent: visible ? {} : null,
    menuTrigger,
    closest(sel) { return ours && sel === '[data-dsh-cc-studio]' ? {} : null; },
  };
}
{
  stubDom([btn('CC 模式')]);
  check('芯片显示 CC 模式 → true', ccModeFromDom('CC 模式') === true, '');
  stubDom([btn('Standard mode')]);
  check('芯片显示其它模式 → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('CC 模式', { visible: false })]);
  check('不可见元素不算 → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('CC 模式', { ours: true })]);
  check('排除本插件自身 UI → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('DeepSeek V4.1 Flash (CC) Default')]);
  check('模型选择器（含 "(CC)"）不误判', ccModeFromDom('CC 模式') === false, '');
  stubDom([]);
  check('无按钮 → false', ccModeFromDom('CC 模式') === false, '');
  check('label 为空 → false（避免空串匹配一切）', ccModeFromDom('') === false, '');
  delete globalThis.document;
}

// —— 4) decideCcVerdict：判定表 ——
// 依赖模块级常量 CC_PRESET_ID 与 isCcPresetId，摘函数时一并注入作用域。
const decideCcVerdict = new Function(
  `var CC_PRESET_ID=${JSON.stringify(CC_ID)}; ${grabFunction('isCcPresetId')}; ${grabFunction('decideCcVerdict')}; return decideCcVerdict;`,
)();
const verdictOf = (input) => decideCcVerdict(input);
{
  // ① 会话投影权威
  check('投影=cc → true(projection)',
    verdictOf({ sessionId: 's1', presetKnown: true, presetId: 'cc' }).verdict === true
      && verdictOf({ sessionId: 's1', presetKnown: true, presetId: 'cc' }).source === 'projection', '');
  check('投影=CC 大小写不敏感 → true',
    verdictOf({ sessionId: 's1', presetKnown: true, presetId: 'CC' }).verdict === true, '');
  check('投影=standard → false（DOM 说不算，有会话时 DOM 不参与）',
    verdictOf({ sessionId: 's1', presetKnown: true, presetId: 'standard', domVerdict: true }).verdict === false, '');
  check('投影=null（会话没有预设）→ false',
    verdictOf({ sessionId: 's1', presetKnown: true, presetId: null }).verdict === false, '');
  // ② 同会话主机结论
  check('投影未知 + 同会话主机说 true → true(host)',
    verdictOf({ sessionId: 's1', presetKnown: false, presetId: null, hostVerdict: true }).verdict === true, '');
  check('投影未知 + 同会话主机说 false → false(host)',
    verdictOf({ sessionId: 's1', presetKnown: false, presetId: null, hostVerdict: false }).verdict === false, '');
  // ③ 未知：**不再沿用旧结论**（旧实现在这里 `prevIsCc ? true : null`，于是永远粘住）
  const pending = verdictOf({ sessionId: 's1', presetKnown: false, presetId: null, hostVerdict: null,
    prevIsCc: true, domVerdict: false });
  check('有会话 + 两个来源都缺 → null(pending)：必须去问主机，而不是保持 true',
    pending.verdict === null && pending.source === 'pending', JSON.stringify(pending));
  check('有会话时 DOM 的 false 不能当权威（运行中会话的预设标签是 <span>，必然判 false）',
    verdictOf({ sessionId: 's1', presetKnown: false, presetId: null, domVerdict: false }).verdict === null, '');
  // ④ 新会话页：芯片是唯一信号
  check('无会话 + 芯片 CC → true(dom)',
    verdictOf({ sessionId: null, domVerdict: true }).verdict === true, '');
  // ⑤ 没有会话上下文时，芯片没说 CC 就是「不是 CC」。根域只能在新会话页表态 ——
  //    有会话时它的写入会被 applyChromeCc 拒掉，所以这里下否是安全的。
  check('无会话 + 芯片非 CC → false(dom)',
    verdictOf({ sessionId: null, domVerdict: false }).verdict === false, '');
}

// —— 5) ccSessionIdOfProps：会话 id 只能从 slot props 里取 ——
// 背景（issue #5）：旧代码用 useSessions(s => s.current) 当「当前会话」，而 alpha.2 的
// SessionListState 只有 ids / byId / phase（dsh-api-session-controller sessions/service.d.ts），
// 没有 current —— 于是恒为 null，「会话投影权威」这条路从未生效，且 currentId 会退化成
// props.session（整个 SessionSnapshot 对象），传给主机后被 typeof 判掉 → 落到 default 槽。
const ccSessionIdOfProps = new Function(`${grabFunction('ccSessionIdOfProps')}; return ccSessionIdOfProps;`)();
{
  check('session 域标准属性 props.sessionId', ccSessionIdOfProps({ sessionId: 'session-abc' }) === 'session-abc', '');
  check('ownerProps.session 的快照 id', ccSessionIdOfProps({ session: { sessionId: 'session-abc' } }) === 'session-abc', '');
  check('props.sessionId 是对象时读它的 .sessionId（异形兜底）',
    ccSessionIdOfProps({ sessionId: { sessionId: 'session-abc' } }) === 'session-abc', '');
  check('根域（shell.overlay）没有任何会话绑定 → null',
    ccSessionIdOfProps({ useSessions: function(){} }) === null, '');
  check('空串/非字符串不算会话 id', ccSessionIdOfProps({ sessionId: '' }) === null && ccSessionIdOfProps({ sessionId: 42 }) === null, '');
  check('props 缺失安全', ccSessionIdOfProps(null) === null && ccSessionIdOfProps(undefined) === null, '');
}

// ============================================================
// 6) 运行时回归：真把 bundle 装进假 React / 假 slot / 假 RPC 跑
// ============================================================
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
  // 0.12.4：组件快照走 useSyncExternalStore（生产路径）；测试里只需返回当前快照。
  useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); },
};
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

let registration = null;
globalThis.window = { __ModuleLoader__: { load(def) { registration = def; } } };
new Function('window', src)(globalThis.window);
if (!registration) { console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load'); process.exit(1); }

const calls = [];
let handler = function () { return { ok: false, error: { code: 'internal', message: 'no handler' } }; };
const rpcCall = function (channel, endpoint, payload) {
  calls.push({ channel, endpoint, payload });
  return Promise.resolve(handler(endpoint, payload));
};
const callsOf = (endpoint) => calls.filter((c) => c.endpoint === endpoint);

const registered = {};
const fakeCtx = {
  effect(fn) { fn(); return () => {}; },
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
const store = dock.opts.inject('warmup').store;
const t = (k) => k;

function render(comp, props) {
  effectQueue.length = 0;
  const tree = comp(props);
  const effects = effectQueue.slice();
  effectQueue.length = 0;
  return { tree, effects };
}
/** 跑一次渲染收集到的 effect，返回它们的清理函数（用于模拟组件卸载）。 */
function run(effects) {
  const cleanups = [];
  effects.forEach((fn) => {
    try { const c = fn(); if (typeof c === 'function') cleanups.push(c); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); }
  });
  return cleanups;
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

function fullDraft(name) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: name, nickname: '', tags: [], creator: '', character_version: '0.1',
    description: '', personality: '', scenario: '', system_prompt: '', post_history_instructions: '',
    first_mes: '', alternate_greetings: [], group_only_greetings: [], mes_example: '', creator_notes: '',
    creator_notes_multilingual: {}, source: [], assets: [],
    creation_date: 1, modification_date: 1,
    character_book: { name: '', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {}, entries: [] },
  } };
}

const S_CC = 'session-cc01';
const S_PLAIN = 'session-plain02';
const S_UNKNOWN = 'session-unknown03';
let hostIsCc = {};

/** 造一份 slot props：list 里只放本会话（真实 dsh 里 byId 是全量，这里只需要本会话那一行）。 */
function sessProps(sid, opts) {
  opts = opts || {};
  const projectionValues = opts.unknown
    ? {}
    : { agentPreset: opts.preset === undefined ? 'standard' : opts.preset };
  return {
    store, t,
    sessionId: sid,
    session: { sessionId: sid },
    useSessions: (sel) => sel({ ids: [sid], byId: { [sid]: { id: sid, projectionValues } } }),
  };
}

// —— ① bug 复现：CC 会话 → 非 CC 会话，胶囊必须**立刻**消失 ——
{
  handler = (endpoint, payload) => {
    if (endpoint === 'cc_getDraft') {
      return { ok: true, value: { key: payload.args.sessionId, keySource: 'arg', draft: fullDraft('草稿'), draftStatus: { isNew: false, key: payload.args.sessionId } } };
    }
    if (endpoint === 'cc_isCcMode') return { ok: true, value: { isCc: !!hostIsCc[payload.args.sessionId] } };
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  const rA = render(dock.comp, sessProps(S_CC, { preset: 'cc' }));
  run(rA.effects);
  await flush();
  check('①a 进入 CC 会话 → 胶囊显示（isCcMode=true）', store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));

  const before = callsOf('cc_isCcMode').length;
  const rB = render(dock.comp, sessProps(S_PLAIN, { preset: 'standard' }));
  run(rB.effects);
  await flush();
  check('①b 切到非 CC 会话 → **立刻**变 false（旧 bug：要再切一次才消失）',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  check('①c 投影已给出结论时不打扰主机（不多打一次 cc_isCcMode）',
    callsOf('cc_isCcMode').length === before, String(callsOf('cc_isCcMode').length - before));
  check('①d 结论归属切到了新会话',
    store.getSnapshot().ccSessionId === S_PLAIN && store.getSnapshot().ccSource === 'projection',
    JSON.stringify({ id: store.getSnapshot().ccSessionId, src: store.getSnapshot().ccSource }));
}

// —— ② 投影未知：立刻按非 CC 处理，并且**必须**去问主机 ——
{
  hostIsCc[S_UNKNOWN] = false;
  const before = callsOf('cc_isCcMode').length;
  const r = render(dock.comp, sessProps(S_UNKNOWN, { unknown: true }));
  run(r.effects);
  const asked = callsOf('cc_isCcMode').length - before;
  check('②a 投影未知 + 上一个结论是 false → 保持 false',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  check('②b 投影未知时必须问主机（旧代码只在 !isCcMode 时才走这条，方向反了）',
    asked >= 1, String(asked));
  check('②c 询问带上了当前会话 id',
    callsOf('cc_isCcMode').some((c) => c.payload.args.sessionId === S_UNKNOWN), '');
  await flush();
  check('②d 主机回 false → 仍是非 CC', store.getSnapshot().isCcMode === false, '');
}

// —— ③ 投影未知 + 主机说是 CC → 先非 CC，确认后亮起 ——
{
  const S2 = 'session-cc04';
  hostIsCc[S2] = true;
  const r = render(dock.comp, sessProps(S2, { unknown: true }));
  run(r.effects);
  check('③a 主机确认前按非 CC 处理（宁可短暂不显示，也不显示错的）',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  await flush();
  check('③b 主机确认后胶囊出现',
    store.getSnapshot().isCcMode === true && store.getSnapshot().ccSource === 'host',
    JSON.stringify({ cc: store.getSnapshot().isCcMode, src: store.getSnapshot().ccSource }));
}

// —— ④ 竞态：上一个会话晚到的 cc_isCcMode 不得污染当前会话 ——
{
  const SLOW = 'session-slow05';
  let releaseSlow = null;
  handler = (endpoint, payload) => {
    if (endpoint === 'cc_getDraft') {
      return { ok: true, value: { key: payload.args.sessionId, keySource: 'arg', draft: fullDraft('草稿'), draftStatus: { isNew: false, key: payload.args.sessionId } } };
    }
    if (endpoint === 'cc_isCcMode') {
      if (payload.args.sessionId === SLOW) {
        return new Promise((resolve) => { releaseSlow = () => resolve({ ok: true, value: { isCc: false } }); });
      }
      return { ok: true, value: { isCc: !!hostIsCc[payload.args.sessionId] } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected ' + endpoint } };
  };
  render(dock.comp, sessProps(SLOW, { unknown: true }));
  run(render(dock.comp, sessProps(SLOW, { unknown: true })).effects);
  check('④a 慢查询已发出', typeof releaseSlow === 'function', String(typeof releaseSlow));
  // 用户立刻切回 CC 会话（投影可用 → true）
  run(render(dock.comp, sessProps(S_CC, { preset: 'cc' })).effects);
  await flush();
  check('④b 切到 CC 会话后状态是 true', store.getSnapshot().isCcMode === true, '');
  releaseSlow();
  await flush();
  check('④c 上一个会话的晚到响应被丢弃（没有把当前会话清成 false）',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
}

// —— ⑤ 根域实例（shell.overlay）无权改写会话域的结论 ——
{
  // 当前停在非 CC 会话（上一步是 CC，先切回非 CC）
  run(render(dock.comp, sessProps(S_PLAIN, { preset: 'standard' })).effects);
  await flush();
  check('⑤a 先回到非 CC 会话', store.getSnapshot().isCcMode === false, '');
  run(render(overlay.comp, { store, t }).effects);
  intervals.forEach((x) => { try { x.fn(); } catch (e) {} });
  check('⑤b 根域渲染 + 每秒轮询都不会把会话域的非 CC 结论改回 true',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  check('⑤c applyChromeCc 在有会话上下文时拒绝写入',
    store.applyChromeCc(true) === false && store.getSnapshot().isCcMode === false, '');
}

// —— ⑥ 切到新会话页：会话域卸载 → 清空 → 根域按预设芯片接管 ——
{
  const cleanups = [];
  run(render(dock.comp, sessProps(S_CC, { preset: 'cc' })).effects);
  const r = render(dock.comp, sessProps(S_CC, { preset: 'cc' }));
  const capsCleanups = run(r.effects);
  await flush();
  check('⑥a 会话域实例挂载时判定为 CC', store.getSnapshot().isCcMode === true, '');
  // 模拟切到新会话页：会话域 slot 卸载（effect cleanup 里把 currentSessionId 清空）
  capsCleanups.forEach((fn) => { try { fn(); } catch (e) {} });
  check('⑥b 卸载后 currentSessionId 清空（旧代码从不写 null，根域永远拿旧会话判定）',
    store.getSnapshot().currentSessionId === null, String(store.getSnapshot().currentSessionId));
  check('⑥c 卸载后 isCcMode 归零', store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));

  // 新会话页：芯片选的是 CC 模式 → 根域轮询把它点亮。
  // 注意根域实例的 ccLabel 来自渲染时的 t("preset.ccLabel")，所以这里要用真实文案重渲染一次。
  const ccT = (k) => (k === 'preset.ccLabel' ? 'CC 模式' : k);
  run(render(overlay.comp, { store, t: ccT }).effects);
  stubDom([btn('CC 模式')]);
  intervals.forEach((x) => { try { x.fn(); } catch (e) {} });
  check('⑥d 新会话页芯片显示 CC → 胶囊出现（根域有权在无会话时表态）',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
  check('⑥e 这条结论的来源是 dom', store.getSnapshot().ccSource === 'dom', String(store.getSnapshot().ccSource));

  // 新会话页换成别的预设 → 熄灭
  stubDom([btn('Standard mode')]);
  intervals.forEach((x) => { try { x.fn(); } catch (e) {} });
  check('⑥f 新会话页换回普通预设 → 胶囊消失',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  delete globalThis.document;
  cleanups.length = 0;
}

// —— ⑦ 会话自身投影（dsh ≥ 0.2.2 的 useProjection）：没有 useSessions 也能判定 ——
// 这是新版宿主上的主路径：值随会话自动跟随，不需要我们先知道会话 id，也不依赖列表投影。
{
  const S7 = 'session-proj07';
  const projProps = (preset) => ({
    store, t, sessionId: S7,
    useProjection: (key) => (key === 'agentPreset' ? preset : undefined),
  });
  run(render(dock.comp, projProps('cc')).effects);
  await flush();
  check('⑦a 只靠 useProjection 也能判定为 CC（新版宿主的主路径）',
    store.getSnapshot().isCcMode === true, String(store.getSnapshot().isCcMode));
  check('⑦b 结论来源是 projection', store.getSnapshot().ccSource === 'projection', String(store.getSnapshot().ccSource));
  run(render(dock.comp, projProps('standard')).effects);
  check('⑦c 同一会话内投影变成非 CC → 立刻熄灭',
    store.getSnapshot().isCcMode === false, String(store.getSnapshot().isCcMode));
  // null = 会话确实没有预设（确定不是 CC），不必再问主机
  const before = callsOf('cc_isCcMode').length;
  run(render(dock.comp, projProps(null)).effects);
  check('⑦d 投影为 null（确定没有预设）→ 判定非 CC 且不问主机',
    store.getSnapshot().isCcMode === false && callsOf('cc_isCcMode').length === before,
    `${store.getSnapshot().isCcMode} / ${callsOf('cc_isCcMode').length - before}`);
}

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

// ============================================================
// 7) 源码级守卫：这些回归必须被钉住
// ============================================================
{
  check('共享一个 hook（不再两份重复实现）',
    (src.match(/function useCcPreset\s*\(/g) || []).length === 1 &&
    (src.match(/= useCcPreset\(store, props, t\)/g) || []).length === 2,
    `def=${(src.match(/function useCcPreset\s*\(/g) || []).length} call=${(src.match(/= useCcPreset\(store, props, t\)/g) || []).length}`);

  // 旧的两份 detectCc 内联实现必须消失
  check('旧的 detectCc 内联实现已移除', !/function detectCc\s*\(/.test(src), '');
  check('不再有 presetOfCurrent 变量（错误字段的来源）', !/var presetOfCurrent/.test(src), '');
  check('旧的 decideCcMode（粘滞判定）已移除', !/function decideCcMode\s*\(/.test(src), '');
  check('存在新的纯判定 decideCcVerdict', /function decideCcVerdict\s*\(/.test(src), '');
  check('三态解析 ccPresetOfValue 存在', /function ccPresetOfValue\s*\(/.test(src), '');

  // DOM 探测必须用精确选择器，而非全量 button 扫描
  check('DOM 探测使用 button[aria-haspopup="menu"]',
    /querySelectorAll\('button\[aria-haspopup="menu"\]'\)/.test(src), '');
  check('不再全量扫描 button', !/querySelectorAll\('button'\)/.test(src), '');

  // 0.12.3：状态必须带会话归属
  check('store 状态带 ccSessionId / ccSource',
    /ccSessionId:null, ccSource:"none"/.test(src), '');
  check('setSessionId 会作废旧会话的 CC 结论（isCcMode + ccSessionId 一起清）',
    /function setSessionId\(id\)\{[\s\S]{0,600}?isCcMode: false,/.test(src) &&
    /function setSessionId\(id\)\{[\s\S]{0,600}?ccSessionId: null,/.test(src), '');
  check('setSessionId 允许传 null（切到新会话页必须能清空）',
    /var next = \(typeof id==="string" && id\) \? id : null;/.test(src), '');
  check('会话域写入口 applyCcVerdict 有归属校验',
    /function applyCcVerdict\(sessionId, isCc, source\)\{[\s\S]{0,400}?sid !== \(state\.currentSessionId\|\|null\)/.test(src), '');
  check('根域写入口 applyChromeCc 有「有会话时拒绝」守卫',
    /function applyChromeCc\(isCc\)\{[\s\S]{0,300}?\(state\.currentSessionId\|\|null\) !== null\) return false;/.test(src), '');
  check('旧的 canConclude 约定已删除（改由 store 写入门在数据层拦住）', !/var canConclude/.test(src), '');

  // —— 0.12.4：渲染层订阅时序（「判定对了、界面不更新」的根因）——
  // 组件必须在 useCcPreset 的写入 effect 之前建立订阅，而且快照要能补上「订阅前错过的 emit」；
  // 另外切会话那一帧 store 里还是上一个会话的 true，必须按会话一致性吞掉。
  check('存在 useStoreSnapshot（优先 useSyncExternalStore）',
    /function useStoreSnapshot\(store\)\{[\s\S]{0,260}?React\.useSyncExternalStore/.test(src), '');
  const capsuleBody = src.slice(src.indexOf('function Capsule(props)'), src.indexOf('function confirmClear'));
  check('Capsule 先 useStoreSnapshot 再 useCcPreset（顺序反了就会丢 emit）',
    capsuleBody.indexOf('useStoreSnapshot(store)') >= 0 &&
      capsuleBody.indexOf('useStoreSnapshot(store)') < capsuleBody.indexOf('useCcPreset(store, props, t)'),
    `snap=${capsuleBody.indexOf('useStoreSnapshot(store)')} probe=${capsuleBody.indexOf('useCcPreset(store, props, t)')}`);
  check('Capsule 用会话一致性挡住旧快照（不点亮不属于本会话的 true）',
    /var sameSession = !!currentId && s\.currentSessionId === currentId;/.test(capsuleBody) &&
      /if\(\(!s\.isCcMode \|\| !sameSession\) && !s\.panelOpen\) return null;/.test(capsuleBody), '');
  const workshopBody = src.slice(src.indexOf('function Workshop(props)'), src.indexOf('function SettingsView'));
  check('Workshop 先 useStoreSnapshot 再 useCcPreset',
    workshopBody.indexOf('useStoreSnapshot(store)') >= 0 &&
      workshopBody.indexOf('useStoreSnapshot(store)') < workshopBody.indexOf('useCcPreset(store, props, t)'),
    `snap=${workshopBody.indexOf('useStoreSnapshot(store)')} probe=${workshopBody.indexOf('useCcPreset(store, props, t)')}`);
  check('不再手写 useState(store.getSnapshot) + store.subscribe 读快照',
    !/useState\(function\(\)\{ return store\.getSnapshot\(\); \}\)/.test(src), '');

  // 0.12.3：主机确认必须覆盖「从是到不是」的路径
  check('会话切换后投影未知就查主机（不再被 !isCcMode 门住）',
    /if\(!preset\.known\)\{\s*\n\s*store\.checkIsCcMode\(ownId, true\)/.test(src), '');
  check('旧的「只有 !isCcMode 才查」已删除',
    !/if\(!store\.getSnapshot\(\)\.isCcMode\) store\.checkIsCcMode/.test(src), '');
  check('主机响应有查询序号校验（晚到的旧响应被丢弃）',
    /var _ccSeq = 0;/.test(src) && /if\(seq !== _ccSeq\) return false;/.test(src), '');
  check('主机响应校验当前会话归属',
    /if\(\(state\.currentSessionId\|\|null\) !== key\) return false;/.test(src), '');
  check('主机查询失败不写假结论', /if\(!res \|\| !res\.ok\) return false;/.test(src), '');

  // 会话 id 的发布与清理
  check('会话域实例发布会话 id', /store\.setSessionId\(ownId\);/.test(src), '');
  check('会话域实例卸载时清空会话 id', /return function\(\)\{ if\(ownId\)\{ try\{ store\.setSessionId\(null\); \}/.test(src), '');
  check('dock 的 inject 显式带上 sessionId（不只靠 framework props）',
    /inject: function\(sessionId\)\{ return \{store:store, sessionId: sessionId\}; \}/.test(src), '');

  // 新会话页切换芯片不会改变 current/preset，必须有轮询兜底
  check('存在本地轮询兜底（捕获芯片切换）', /setInterval\(function\(\)\{ try\{ evaluate\(\); \}/.test(src), '');
  check('投影来源优先 useProjection，回退 useSessions',
    /props\.useProjection/.test(src) && /props\.useSessions/.test(src), '');

  // issue #5 的旧守卫（仍必须成立）
  check('不再用 useSessions(s=>s.current) 当当前会话', !/s && s\.current\) \|\| null/.test(src), '');
  check('pass 里有 ccSessionIdOfProps（会话 id 的唯一取法）', /function ccSessionIdOfProps\(/.test(src), '');
  check('投影按解析出来的会话 id 去 byId 查', /var sid = ownId \|\| store\.getSnapshot\(\)\.currentSessionId \|\| null;/.test(src), '');
  check('pullDraft 没有 key 就不发请求', /if\(!key\) return Promise\.resolve\(\);/.test(src), '');
  check('启动时不再初始拉 default', !/pullDraftThrottled\(null\)/.test(src), '');
  check('轮询在 currentSessionId 未知时不拿 default 顶替', /if\(!sid\) return;\s*\/\/ 会话 id 未知：不拿 default 顶替/.test(src), '');
  check('节流按 key 而非全局时间戳', /if\(key === lastPullKey && now - lastPullAt < 500\) return;/.test(src), '');
  check('主机回传 key 不一致时不渲染该草稿', /if\(gotKey && gotKey !== key\)/.test(src) && /setSlotWarn\(\{ requested:key, got:gotKey/.test(src), '');
  check('丢弃切会话后的过期响应', /if\(cur && cur !== key\) return;/.test(src), '');

  // 预设名进词表（否则触发「UI 层无硬编码中文」守卫）
  check('preset.ccLabel 在 zh 词表', /"preset\.ccLabel":"CC 模式"/.test(src.slice(src.indexOf('var zh='), src.indexOf('var en='))), '');
  check('preset.ccLabel 在 en 词表', /"preset\.ccLabel":"CC 模式"/.test(src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'))), '');

  // 跨文件守卫（0.3.7）：DOM 兜底探测是靠「芯片的 textContent 包含 preset.ccLabel」认出预设芯片的
  // （lib/client.js 的 ccModeFromDom），所以这个词必须**逐字等于**宿主预设的显示名
  // （presets/cc.patch.yml 里那条 `name:` 声明，也就是 roster 芯片上渲染的那串字）。
  // 只钉「zh/en 两表都是 CC 模式」是不够的：把 en 本地化成 "CC Mode" 依然全绿，而英文界面下
  // 这条兜底会静默失效 —— 那时如果会话投影也没拿到值（新会话页的窗口期），胶囊就不出现。
  const presetMeta = readFileSync(new URL('../presets/cc.patch.yml', import.meta.url), 'utf8')
    .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const presetName = (presetMeta.split('\n').find((l) => /^\s*name: \S/.test(l)
    && !/'@/.test(l) && !/cordis:group/.test(l)) || '').replace(/^\s*name:\s*/, '').trim();
  const labelIn = (from, to) => {
    const m = src.slice(src.indexOf(from), src.indexOf(to)).match(/"preset\.ccLabel":"([^"]*)"/);
    return m ? m[1] : undefined;
  };
  const zhLabel = labelIn('var zh=', 'var en=');
  const enLabel = labelIn('var en=', 'function h(type,props)');
  check('preset.ccLabel 与宿主预设显示名逐字一致（DOM 兜底靠它认芯片）',
    !!presetName && zhLabel === presetName && enLabel === presetName,
    `preset.yml=${JSON.stringify(presetName)} zh=${JSON.stringify(zhLabel)} en=${JSON.stringify(enLabel)}`);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 100)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
