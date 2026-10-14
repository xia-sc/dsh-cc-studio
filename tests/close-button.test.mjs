/**
 * 工作坊关闭按钮（✕）回归测试（不随插件发布，files 未含 tests）。
 *
 * 需求（用户）：工具条右侧那枚「收起」改成「X」图标按钮，点击关闭工坊，**鼠标移入用红色背景**。
 * 动机：它原来是一段文字（「收起」/「Collapse」），既占宽度，又跟旁边的步骤胶囊抢注意力；
 * 而红色悬停是「离开 / 收起」的通用暗示，平时保持低调的描边样式。
 *
 * 内联样式没有伪类，所以 hover 由组件内的局部 state 驱动 —— 本文件直接断言渲染出来的 props：
 * 文案是 ✕、提示走词表、默认透明底 → 悬停红底白字 → 移开复原、鼠标按下不抢焦点、点击后工坊真的收起。
 *
 * 运行：node tests/close-button.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 假 React：hook 槽位按渲染顺序保留（否则 setHoverKey 之后重渲染看不到新值）——
const effectQueue = [];
const hooks = { slots: [], idx: 0 };
const React = {
  createElement(type, props) {
    return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) };
  },
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

// —— 定时器全部收集起来不触发（否则 1s 的 DOM 轮询会掺进断言里）——
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
globalThis.setTimeout = function (fn, ms) { return 1; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function (fn, ms) { return 1; };
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

const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call() { return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } }); } } },
};

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
function run(effects) { effects.forEach((fn) => { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } }); }
function redraw() { return render().tree; }

function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}
const closeBtns = () => flatten(redraw()).filter((n) => n.type === 'button' && n.children[0] === '✕');

// —— 源码级：文案不许再被塞回按钮，但词表键要留着（库折叠按钮的 title 还在用）——
const zhSrc = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
const enSrc = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
check('① 工作坊头部不再把「收起」当按钮文案（✕ 是唯一形态）',
  !/t\("action\.close"\)\s*\)/.test(src.split('\n').filter(function (l) { return l.indexOf('setPanel(false)') >= 0; }).join('\n')),
  '');
check('①b 词表里 action.close 仍保留（库折叠按钮的 tooltip 用它，别顺手删）',
  zhSrc.indexOf('"action.close":"收起"') >= 0 && enSrc.indexOf('"action.close":"Collapse"') >= 0, '');

// —— 开工坊 ——
store.setPanel(true);
run(render().effects);
redraw();
let btns = closeBtns();
check('② 头部恰有 1 枚 ✕ 关闭按钮', btns.length === 1, String(btns.length));
let btn = btns[0];
check('②b 它带 tooltip 与 aria-label（图标按钮没有可读文字，读屏与悬停都要能解释它是「收起」）',
  btn.props.title === 'action.close' && btn.props['aria-label'] === 'action.close',
  String(btn.props.title) + ' / ' + String(btn.props['aria-label']));
check('②c 是固定 30×30 的图标按钮（不再随文案长短变宽）',
  btn.props.style.width === 30 && btn.props.style.height === 30, btn.props.style.width + '×' + btn.props.style.height);

// —— 默认态：低调的描边按钮 ——
check('③ 默认透明底 + 主题描边 + 主文本色（平时不抢注意力）',
  btn.props.style.background === 'transparent' &&
  btn.props.style.border === '1px solid var(--dsw-alias-border-l1)' &&
  btn.props.style.color === 'var(--dsw-alias-label-primary)',
  String(btn.props.style.background) + ' / ' + String(btn.props.style.border) + ' / ' + String(btn.props.style.color));

// —— 鼠标移入：红色背景（用户要的就是这个）——
const snapBefore = JSON.stringify(store.getSnapshot());
btn.props.onMouseEnter();
btn = closeBtns()[0];
check('④ 鼠标移入变红底白字（危险色 + 白字，够醒目）',
  btn.props.style.background === '#e05555' && btn.props.style.color === '#fff' && btn.props.style.border === '1px solid #e05555',
  String(btn.props.style.background) + ' / ' + String(btn.props.style.color));
check('④b 过渡写在样式里（不是硬切）', String(btn.props.style.transition || '').indexOf('background') >= 0, String(btn.props.style.transition));
check('④c 悬停只是局部视觉状态，没写进 store（否则鼠标一动就重渲染整棵工坊）',
  JSON.stringify(store.getSnapshot()) === snapBefore, '');

// —— 移开：复原 ——
btn.props.onMouseLeave();
btn = closeBtns()[0];
check('⑤ 鼠标移开后回到透明底', btn.props.style.background === 'transparent', String(btn.props.style.background));

// —— 鼠标按下不抢焦点（同步骤项的处理，免得留下一圈焦点描边）——
let prevented = 0;
btn.props.onMouseDown({ preventDefault() { prevented++; } });
check('⑥ 鼠标按下拦掉默认行为（焦点不会留在按钮上）', prevented === 1, String(prevented));

// —— 点击：关闭工坊 ——
btn.props.onClick({});
check('⑦ 点击后工坊收起（panelOpen=false）', store.getSnapshot().panelOpen === false, String(store.getSnapshot().panelOpen));
check('⑦b 收起后整棵工坊树不再渲染（✕ 也一并消失）', closeBtns().length === 0, String(closeBtns().length));

// —— 再打开：按钮仍是干净的默认态（hover 状态没有残留）——
store.setPanel(true);
btn = closeBtns()[0];
check('⑧ 重新打开后按钮回到默认态（悬停状态不残留）',
  btn.props.style.background === 'transparent', String(btn.props.style.background));

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
