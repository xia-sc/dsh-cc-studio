/**
 * 「让模型修 / ✨ 让模型改」客户端回归测试（0.24.0）。
 *
 * 现象（用户截图）：体检报告的「去修 →」只是跳到对应章节，用户并不知道时间锚定 / canon
 *   这些标准，最后还是得让模型改 —— 跳过去没有实际意义。
 *
 * 修法：体检每条带「让模型修」（把问题 + 参考 + 建议 + 规则拼成一条消息发给模型），
 *   动作栏再给一个「✨ 让模型改」（用户自己描述哪里不合理）。两处共用同一套提示模板，
 *   且只在 CC 模式 + 有会话时可用（否则模型手里没有工坊工具）。
 *
 * 运行：node tests/model-fix.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 假 React ——
const effectQueue = [];
const hooks = { slots: [], idx: 0 };
const React = {
  createElement(type, props) { return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }; },
  useState(init) {
    const i = hooks.idx++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof init === 'function' ? init() : init;
    return [hooks.slots[i], function (v) { hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v; }];
  },
  useRef(init) {
    const i = hooks.idx++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: init };
    return hooks.slots[i];
  },
  useCallback(fn) { return fn; },
  useEffect(fn) { effectQueue.push(fn); },
  useMemo(fn) { return fn(); },
};

const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
};

// —— 假 DOM：工坊的「选中即引用」需要 window.getSelection 与 #cc-scroller ——
const listeners = {};
const QUOTE_TEXT = '蓝黑色的头发垂在肩上';
const quoteEl = {
  nodeType: 1,
  getAttribute: (name) => (name === 'data-cc-ref' ? 'character_book.entries[0] · 云中君' : null),
  parentNode: null,
};
const quoteTextNode = { nodeType: 3, parentNode: quoteEl };
const fakeScroller = {
  contains: () => true,
  getBoundingClientRect: () => ({ left: 300, top: 100 }),
  scrollLeft: 0, scrollTop: 200, clientWidth: 800, clientHeight: 600,
};
const fakeSelection = {
  rangeCount: 1,
  toString: () => QUOTE_TEXT,
  getRangeAt: () => ({
    commonAncestorContainer: quoteTextNode,
    getBoundingClientRect: () => ({ left: 120, top: 320, width: 80, height: 18 }),
  }),
};
globalThis.document = {
  addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((x) => x !== fn); },
  getElementById(id) { return id === 'cc-scroller' ? fakeScroller : null; },
  createElement() { return { setAttribute() {}, appendChild() {}, textContent: '' }; },
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
};

let registration = null;
globalThis.window = {
  __ModuleLoader__: { load(def) { registration = def; } },
  getSelection: () => fakeSelection,
  innerWidth: 1200,
};
new Function('window', src)(globalThis.window);
if (!registration) { console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load'); process.exit(1); }

// 一份带「时间锚定」错误的最小校验结果（体检条目 → 一个「让模型修」按钮）
const REPORT = {
  valid: false,
  errors: ['缺 data.system_prompt（时间锚定）'],
  warnings: [],
  structural: { valid: true, errors: [], warnings: [] },
  consistency: {
    issues: [{ level: 'error', code: 'anchor-system-missing', message: '缺 data.system_prompt（时间锚定）：卡里没有时间规则', refs: ['system_prompt'] }],
    errorCount: 1, canonCount: 0, canonSource: 'none',
  },
  canon: { count: 0, source: 'none' },
};

const calls = [];
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) {
    calls.push({ endpoint, payload });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: [] } });
    if (endpoint === 'cc_listGroups') return Promise.resolve({ ok: true, value: { groups: [] } });
    if (endpoint === 'validate') return Promise.resolve({ ok: true, value: REPORT });
    if (endpoint === 'cc_promptSession') return Promise.resolve({ ok: true, value: { accepted: true } });
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
  } } },
};
const registered = {};

const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);

const overlay = registered['shell.overlay'];
const store = registered['conversation.input.dock'].opts.inject('warmup').store;
const t = (k) => k;

function render() {
  hooks.idx = 0;
  effectQueue.length = 0;
  const tree = overlay.comp({ store, t });
  const effects = effectQueue.slice();
  effectQueue.length = 0;
  return { tree, effects };
}
function redraw() {
  hooks.idx = 0;
  effectQueue.length = 0;
  return overlay.comp({ store, t });
}
function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}
const btns = (tree, label) => flatten(tree).filter((n) => n.type === 'button' && n.children && n.children[0] === label);
const textNodes = (tree) => flatten(tree).map((n) => (n.children && n.children[0]) || '').filter((x) => typeof x === 'string');
const sentTexts = () => calls.filter((x) => x.endpoint === 'cc_promptSession').map((x) => String((x.payload && x.payload.args && x.payload.args.text) || ''));

// —— 打开工坊 + 跑一次校验 ——
store.setPanel(true);
render().effects.forEach((fn) => { try { fn(); } catch (e) {} });
await store.validate();
store.setSessionId('s-1');
store.applyCcVerdict('s-1', true, 'host');
let tree = redraw();

// ① CC 模式 + 有会话：体检每条都有「让模型修」
{
  const fixBtns = btns(tree, 'workshop.fixModel.fixThis');
  check('① 体检每条渲染「让模型修」按钮（CC 模式 + 有会话时可用）',
    fixBtns.length === 1 && !fixBtns[0].props.disabled, 'btns=' + fixBtns.length + ' disabled=' + (fixBtns[0] && fixBtns[0].props.disabled));
  calls.length = 0;
  fixBtns[0].props.onClick({});
  await new Promise((r) => setTimeout(r, 0));
  const texts = sentTexts();
  check('② 点「让模型修」→ 调 cc_promptSession，sessionId 是当前会话',
    texts.length === 1 && String(calls.find((x) => x.endpoint === 'cc_promptSession').payload.args.sessionId) === 's-1',
    'calls=' + texts.length);
  const text = texts[0] || '';
  check('③ 消息是「定点修改」模板：含表头、问题原文、参考、规则（禁止重写整卡）',
    text.indexOf('workshop.fixModel.headFix') >= 0
      && text.indexOf('缺 data.system_prompt（时间锚定）') >= 0
      && text.indexOf('system_prompt') >= 0
      && text.indexOf('workshop.fixModel.rule2') >= 0,
    text.slice(0, 120).replace(/\n/g, ' / '));
}

// ④ 关掉 CC 模式：按钮禁用，点了也不发
{
  store.setSessionId('s-1');
  store.applyCcVerdict('s-1', false, 'host');
  tree = redraw();
  const fixBtns = btns(tree, 'workshop.fixModel.fixThis');
  calls.length = 0;
  check('④ 非 CC 模式 → 「让模型修」禁用并说明原因',
    fixBtns.length === 1 && fixBtns[0].props.disabled === true && String(fixBtns[0].props.title).indexOf('workshop.fixModel.noCc') >= 0,
    'disabled=' + (fixBtns[0] && fixBtns[0].props.disabled) + ' title=' + (fixBtns[0] && fixBtns[0].props.title));
  // disabled 的按钮在真实浏览器里点不动；这里直接调 onClick 证明还有第二道闸（store 里也会挡）
  const topBtn = btns(tree, '✨ workshop.fixModel.open')[0];
  check('④b 动作栏「✨ 让模型改」同样禁用', !!topBtn && topBtn.props.disabled === true, topBtn && String(topBtn.props.disabled));
}

// ⑤ 没有会话：禁用
{
  store.setSessionId(null);
  tree = redraw();
  const fixBtns = btns(tree, 'workshop.fixModel.fixThis');
  check('⑤ 没有当前会话 → 禁用（顺手清掉 CC 结论）',
    fixBtns.length === 1 && fixBtns[0].props.disabled === true && String(fixBtns[0].props.title).indexOf('workshop.fixModel.noSession') >= 0,
    fixBtns[0] && String(fixBtns[0].props.title));
}

// —— ⑥「✨ 让模型改」弹框 ——
{
  store.setSessionId('s-1');
  store.applyCcVerdict('s-1', true, 'host');
  tree = redraw();
  const topBtn = btns(tree, '✨ workshop.fixModel.open')[0];
  check('⑥ 动作栏有「✨ 让模型改」，且可用', !!topBtn && !topBtn.props.disabled, topBtn && String(topBtn.props.disabled));
  topBtn.props.onClick({});
  tree = redraw();
  const boxes = flatten(tree).filter((n) => n.type === 'textarea' && n.props && n.props.rows === 5);
  check('⑦ 点开是弹框：一个多行输入 + 空内容时发不出去',
    boxes.length === 1 && btns(tree, 'workshop.fixModel.send')[0].props.disabled === true,
    'boxes=' + boxes.length);
  boxes[0].props.onChange({ target: { value: '时间锚定那块按标准补一下' } });
  tree = redraw();
  const sendBtn = btns(tree, 'workshop.fixModel.send')[0];
  check('⑦b 输入内容后可以发送', !!sendBtn && sendBtn.props.disabled !== true, sendBtn && String(sendBtn.props.disabled));
  calls.length = 0;
  sendBtn.props.onClick({});
  await new Promise((r) => setTimeout(r, 0));
  const texts = sentTexts();
  check('⑧ 发出的消息含用户描述 + 自定义模板表头（不是体检那套）',
    texts.length === 1 && texts[0].indexOf('时间锚定那块按标准补一下') >= 0 && texts[0].indexOf('workshop.fixModel.headCustom') >= 0,
    (texts[0] || '').slice(0, 100).replace(/\n/g, ' / '));
  check('⑨ 发送后弹框关闭（不留在界面上挡视线）',
    flatten(redraw()).filter((n) => n.type === 'textarea' && n.props && n.props.rows === 5).length === 0, '');
}

// —— ⑫ 选中正文 → 浮出小按钮 → 弹框写「哪里不好」→ 带着引用发出去 ——
{
  (listeners['mouseup'] || []).forEach((fn) => { try { fn(); } catch (e) {} });
  tree = redraw();
  const bubble = btns(tree, '✨ workshop.fixModel.quoteBtn');
  check('⑫ 选中正文后浮出「让模型改」小按钮（只认 #cc-scroller 内的选区）',
    bubble.length === 1, 'bubble=' + bubble.length + ' listeners=' + (listeners['mouseup'] || []).length);
  // 0.24.0 实测：首版用 position:fixed + 视口坐标，overlay 的 backdrop-filter 让浮条飘到窗口左上角。
  // 现在必须是 absolute（相对主区）且坐标是「滚动容器内容坐标」。
  const wrap = flatten(tree).filter((x) => x.props && x.props.style && x.props.style.position === 'absolute'
    && typeof x.props.style.left === 'number' && typeof x.props.style.top === 'number')[0];
  const bs = wrap && wrap.props.style;
  check('⑫b 浮条用 absolute + 滚动容器内容坐标（不再 fixed 飘到窗口左上角）',
    !!bs && bs.position === 'absolute' && Number(bs.top) > 100 && Number(bs.left) >= 8,
    bs ? 'pos=' + bs.position + ' left=' + bs.left + ' top=' + bs.top : 'no style');
  bubble[0].props.onClick({});
  tree = redraw();
  check('⑬ 弹框里显示引用原文与位置（用户知道自己在改哪一段）',
    textNodes(tree).some((x) => String(x).indexOf(QUOTE_TEXT) >= 0)
      && textNodes(tree).some((x) => String(x).indexOf('character_book.entries[0]') >= 0),
    textNodes(tree).filter((x) => String(x).indexOf(QUOTE_TEXT) >= 0).length + ' hits');
  const box = flatten(tree).filter((n) => n.type === 'textarea' && n.props && n.props.rows === 5)[0];
  box.props.onChange({ target: { value: '这段太长了，压到 50 字以内' } });
  tree = redraw();
  const send = btns(tree, 'workshop.fixModel.send')[0];
  calls.length = 0;
  send.props.onClick({});
  await new Promise((r) => setTimeout(r, 0));
  const texts = sentTexts();
  check('⑭ 发出的消息含：引用原文 + 位置 + 用户描述 + 自定义模板表头',
    texts.length === 1 && texts[0].indexOf(QUOTE_TEXT) >= 0
      && texts[0].indexOf('character_book.entries[0]') >= 0
      && texts[0].indexOf('这段太长了，压到 50 字以内') >= 0
      && texts[0].indexOf('workshop.fixModel.headCustom') >= 0,
    (texts[0] || '').slice(0, 140).replace(/\n/g, ' / '));
  tree = redraw();
  check('⑮ 发送后引用与浮条都清掉（不会带到下一次）',
    btns(tree, '✨ workshop.fixModel.quoteBtn').length === 0
      && flatten(tree).filter((n) => n.type === 'textarea' && n.props && n.props.rows === 5).length === 0,
    '');
}

// —— ⑩ 源码守卫：提示模板只有一份 ——
// 规则清单只有一份：数组定义 1 处；rule1 这个键在 zh / en 两张表各一次（共 3 次字符串出现）。
check('⑩ 规则清单只有 MODEL_FIX_RULES 一份（定义只有一处）',
  (src.match(/var MODEL_FIX_RULES/g) || []).length === 1
    && (src.split('workshop.fixModel.rule1').length - 1) === 3,
  'def=' + (src.match(/var MODEL_FIX_RULES/g) || []).length + ' rule1=' + (src.split('workshop.fixModel.rule1').length - 1));
check('⑪ 两个入口共用 modelFixTail()（体检 / 弹框不许各写一套规则）',
  src.indexOf('function buildFixPrompt') >= 0 && src.indexOf('function buildCustomPrompt') >= 0
    && (src.match(/modelFixTail\(\)/g) || []).length === 3,
  'tail=' + (src.match(/modelFixTail\(\)/g) || []).length);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
