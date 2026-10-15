/**
 * 左侧步骤导航高亮回归测试（不随插件发布，files 未含 tests）。
 *
 * 现象（用户截图）：点过左侧「世界书」之后再用顶部「1. 5维世界观」切回去，左侧会同时出现
 *   两处「看起来像选中」的东西 —— 新选中项的底色 + 旧项残留的焦点描边（dsh 给按钮的统一
 *   focus 描边）。顶部胶囊是 span，点它不抢焦点，所以「切走」后旧项的光环格外显眼。
 * 根因：navItem 只按 `s.cur` 画选中态，完全没管浏览器焦点 —— 鼠标点击让按钮一直保持 :focus。
 *
 * 修法（本次）：
 *   ① onMouseDown preventDefault —— 鼠标点击不把焦点抢到按钮上，键盘 Tab 仍可聚焦；
 *   ② 自己管 outline：默认 none，只有 `:focus-visible`（键盘进来）才画品牌色环；
 *   ③ 选中态改成品牌紫（淡底 + 左竖条）+ aria-current，并补 hover 反馈；
 *   ④ 选中态始终唯一：焦点/hover 都不许再造出第二个「高亮」。
 *
 * 本文件不只做源码守卫：它把 lib/client.js 真装进一个假 React harness 里渲染，
 * 直接断言「渲染出来的 props.style 长什么样、点一下之后选中态落到谁身上」。
 *
 * 运行：node tests/nav-highlight.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 假 React：hook 槽位按渲染顺序保留（这样 setHover/setFocus 之后重渲染能看到新值）——
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

const calls = [];
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) { calls.push({ endpoint, payload }); return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } }); } } },
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
// 0.9.0：左侧从「写作三步」改成**卡片结构导航**（总览 / 角色 / 世界观 / 世界书 / 开场与示例 /
// 关系与分组 / 共享世界书）。测试改为**按 key 定位**，不再依赖顺序 —— 顺序以后还会调。
const STEP_KEYS = ['step.overview', 'step.char', 'step.world', 'step.lore', 'step.greetings', 'step.rel', 'step.book'];
const NAV_CUR = { 'step.overview': 5, 'step.char': 1, 'step.world': 0, 'step.lore': 2, 'step.greetings': 6, 'step.rel': 4, 'step.book': 7 };
const navButtons = (tree) => flatten(tree).filter((n) => n.type === 'button' && STEP_KEYS.indexOf(n.children[0]) >= 0);
const curIndex = (tree, cur) => navButtons(tree).findIndex((b) => NAV_CUR[b.children[0]] === cur);
const stepChips = (tree) => flatten(tree).filter((n) => n.type === 'span' && typeof n.children[0] === 'string' && /^\d\. step\./.test(n.children[0]));

// 「选中」的判据：有底色 + 有 inset 左竖条（不写死色值，换品牌色不该让测试红）
function isActive(style) {
  if (!style) return false;
  return String(style.background || '') !== '' && String(style.background) !== 'transparent' && String(style.boxShadow || '').indexOf('inset') >= 0;
}
const activeFlags = (els) => els.map((e) => isActive(e.props.style));
const onlyIndex = (els, k) => { const f = activeFlags(els); return f.filter(Boolean).length === 1 && f[k] === true; };

// —— 打开工坊（panelOpen=false 时整棵工坊树不渲染）——
// 注意顺序：先开面板再首渲染。假 React 的 useState 只在首次渲染跑惰性初始化，
// 若先在关闭状态渲染一次，槽位就固化成「关闭」的快照了（真实 React 靠 setS 重渲染，这里不会自动跑）。
store.setPanel(true);
run(render().effects);          // 建立 store 订阅（否则重渲染读到的永远是第一份快照）
let tree = redraw();
let btns = navButtons(tree);
const iWorld = curIndex(tree, 0), iLore = curIndex(tree, 2);

check('① 左侧卡片结构导航渲染出 7 项（总览/角色/世界观/世界书/开场与示例/关系与分组/共享世界书），顶部胶囊仍是 3 个',
  btns.length === 7 && stepChips(tree).length === 3,
  'nav=' + btns.length + ' chips=' + stepChips(tree).length + ' keys=' + btns.map((b) => b.children[0]).join(','));
check('② 初始只有「世界观」一项是选中态（cur=0；剩下的都是透明底）',
  iWorld >= 0 && onlyIndex(btns, iWorld), JSON.stringify(activeFlags(btns)));
check('②b 选中项带 aria-current="step"，其余不带（屏幕阅读器也知道当前项）',
  btns[iWorld].props['aria-current'] === 'step' && btns.filter((b, i) => i !== iWorld).every((b) => b.props['aria-current'] == null),
  btns.map((b) => String(b.props['aria-current'])).join(','));

// —— 点「世界书」：选中态转移，且不许「多出第二个高亮」——
btns[iLore].props.onClick({});
check('③ 点击「世界书」后 cur 变成 2（它是卡片结构里的第 4 项，不再是「第 3 步」）', store.getSnapshot().cur === 2, String(store.getSnapshot().cur));
btns = navButtons(redraw());
check('③b 选中态整项转移（不是又亮一个）', onlyIndex(btns, iLore), JSON.stringify(activeFlags(btns)));
check('③c 旧项（世界观）回到透明底', btns[iWorld].props.style.background === 'transparent', String(btns[iWorld].props.style.background));

// —— 核心修复：鼠标点击不抢焦点 ——
const other = iWorld === 0 ? 1 : 0;   // 任意一个「非选中」项
let prevented = 0;
btns.forEach((b) => b.props.onMouseDown({ preventDefault() { prevented++; } }));
check('④ 7 个导航项都用 onMouseDown preventDefault 阻止鼠标抢焦点（旧项不会再留着焦点环）',
  prevented === 7, String(prevented));
check('④b 导航项默认不画 outline（焦点环只由我们自己在键盘焦点时给）',
  btns.every((b) => b.props.style.outline === 'none'),
  btns.map((b) => String(b.props.style.outline)).join(','));

// —— 键盘焦点：仍然要看得见 ——
btns[other].props.onFocus({ currentTarget: { matches: (sel) => sel === ':focus-visible' } });
btns = navButtons(redraw());
check('⑤ 键盘 Tab 进来仍有可见焦点环（可访问性不被这次修复牺牲）',
  String(btns[other].props.style.outline || '').indexOf('2px solid') === 0, String(btns[other].props.style.outline));
check('⑤b 焦点不等于选中：选中项依旧只有 1 个（还是「世界书」）',
  onlyIndex(btns, iLore), JSON.stringify(activeFlags(btns)));
btns[other].props.onBlur();
btns = navButtons(redraw());
check('⑤c 失焦后焦点环消失', btns[other].props.style.outline === 'none', String(btns[other].props.style.outline));

// —— 鼠标点出来的焦点（:focus-visible 不匹配）不许画环，否则又是第二个「高亮」——
btns[other].props.onFocus({ currentTarget: { matches: () => false } });
btns = navButtons(redraw());
check('⑥ 鼠标式焦点不画环 → 左侧不会同时出现两处「像选中」的样式',
  btns[other].props.style.outline === 'none' && onlyIndex(btns, iLore),
  String(btns[other].props.style.outline) + ' / ' + JSON.stringify(activeFlags(btns)));

// —— 混合输入：键盘聚焦后改用鼠标（点顶部胶囊切步），旧项的光环必须收起 ——
btns[other].props.onFocus({ currentTarget: { matches: (sel) => sel === ':focus-visible' } });
btns = navButtons(redraw());
check('⑥b 键盘聚焦的环先亮着', String(btns[other].props.style.outline || '').indexOf('2px solid') === 0, String(btns[other].props.style.outline));
let root = redraw();
check('⑥c 工坊根节点挂了「鼠标一操作就收起焦点环」的处理', typeof root.props.onMouseDown === 'function', typeof root.props.onMouseDown);
root.props.onMouseDown({ preventDefault() {} });
btns = navButtons(redraw());
check('⑥d 鼠标操作后旧项的光环收起，左侧只剩当前项一处高亮',
  btns[other].props.style.outline === 'none' && onlyIndex(btns, iLore),
  String(btns[other].props.style.outline) + ' / ' + JSON.stringify(activeFlags(btns)));

// —— 悬停反馈 ——
btns[other].props.onMouseEnter();
btns = navButtons(redraw());
check('⑦ 鼠标悬停非选中项有底色反馈', btns[other].props.style.background === 'var(--dsw-alias-bg-layer-2)', String(btns[other].props.style.background));
check('⑦b 悬停不会把选中态挪走（选中仍是「世界书」）', onlyIndex(btns, iLore), JSON.stringify(activeFlags(btns)));
btns[other].props.onMouseLeave();
btns = navButtons(redraw());
check('⑦c 移开后底色回到透明', btns[other].props.style.background === 'transparent', String(btns[other].props.style.background));

btns[iLore].props.onMouseEnter();
btns = navButtons(redraw());
check('⑦d 悬停选中项不会顶掉选中样式', onlyIndex(btns, iLore), JSON.stringify(activeFlags(btns)));
btns[iLore].props.onMouseLeave();

// —— 顶部胶囊同款：悬停有反馈、选中唯一 ——
let chips = stepChips(redraw());
check('⑧ 顶部胶囊只有当前步是品牌底', chips.filter((c) => String(c.props.style.background) === '#7c5cff').length === 1,
  chips.map((c) => String(c.props.style.background)).join(','));
chips[0].props.onMouseEnter();
chips = stepChips(redraw());
check('⑧b 顶部胶囊悬停有反馈（非当前步才变）',
  chips[0].props.style.background === 'var(--dsw-alias-bg-layer-1)' && chips[2].props.style.background === '#7c5cff',
  chips.map((c) => String(c.props.style.background)).join(','));
chips[0].props.onMouseLeave();
chips = stepChips(redraw());
check('⑧c 移开后回到默认底', chips[0].props.style.background === 'var(--dsw-alias-bg-layer-2)', String(chips[0].props.style.background));

// —— 收起工坊：整棵工坊树不再渲染（面板开关本身没被这次改动碰坏）——
store.setPanel(false);
check('⑨ 收起工坊后不再渲染任何步骤项', navButtons(redraw()).length === 0, String(navButtons(redraw()).length));

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
