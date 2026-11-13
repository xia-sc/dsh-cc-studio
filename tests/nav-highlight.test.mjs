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

import { check, finish, createFakeReact } from './harness.mjs';

// —— 假 React：hook 槽位按渲染顺序保留（这样 setHover/setFocus 之后重渲染能看到新值）——
const { React, effectQueue, hooks } = createFakeReact();;

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
// 假角色库：折叠态的头像条要靠真实条目数来断言，空库时「渲染了 0 个头像」与「根本没写头像条」分不清。
const FAKE_LIB = [
  { id: 'lib-a', name: '陆昭', loreCount: 5, groupId: 'g1', tags: [] },
  { id: 'lib-b', name: '白十三', loreCount: 3, groupId: 'g1', tags: [] },
  { id: 'lib-c', name: '谢无咎', loreCount: 3, groupId: '', tags: [] },
];
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) {
    calls.push({ endpoint, payload });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: FAKE_LIB } });
    if (endpoint === 'cc_listGroups') return Promise.resolve({ ok: true, value: { groups: [] } });
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
function run(effects) {
  const cleanups = [];
  effects.forEach((fn) => {
    try { const c = fn(); if (typeof c === 'function') cleanups.push(c); }
    catch (e) { console.log('FAIL  effect 抛错: ' + e.message); }
  });
  return cleanups;
}
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
  btns.length === 7 && stepChips(tree).length === 0,
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

// —— 0.22.0：顶部旧的「1.总览 2.角色 3.世界书」写作步骤胶囊已删除（由锚点栏取代）——
check('⑧ 顶部不再渲染旧写作步骤胶囊（避免与锚点栏重复）',
  stepChips(redraw()).length === 0, String(stepChips(redraw()).length));


// —— 0.22.0：单页滚动 + 顶部锚点（左侧 200px 导航列已删除）——
const sections = flatten(tree).filter((n) => n.type === 'section' && n.props && n.props['data-cur'] !== undefined);
check('⑩ 七个章节在同一页常驻渲染（滚轮就能看全卡，不用翻页）',
  sections.length === 7, 'sections=' + sections.length);
check('⑩b 章节顺序 = 总览→角色→五维→世界书→开场→关系→共享书',
  sections.map((x) => x.props['data-cur']).join(',') === '5,1,0,2,6,4,7',
  sections.map((x) => x.props['data-cur']).join(','));
check('⑩c 主区滚动容器带 id=cc-scroller（锚点跳转与滚动高亮都靠它）',
  flatten(tree).some((n) => n.props && n.props.id === 'cc-scroller'), '');
check('⑩d 顶部锚点栏渲染出 7 个 tab（与章节一一对应）',
  flatten(tree).filter((n) => n.type === 'button' && n.props && n.props['aria-current'] !== undefined || (n.type === 'button' && n.props && n.props.style && n.props.style.boxShadow && String(n.props.style.boxShadow).indexOf('inset 0 -2px') >= 0)).length >= 1,
  '');

// —— 0.22.1 回归：滚下方正文时，顶部锚点高亮必须跟着走 ——
// 现象（用户截图）：打开工坊、手动滚正文，顶部锚点高亮一动不动；点锚点本身能跳。
// 根因：滚动监听 effect 依赖 [s.cur]，而 Workshop 关着时也挂在 shell.overlay 上 ——
//   首帧渲染时 #cc-scroller 还没进 DOM，effect 里 getElementById 拿到 null 就 return；
//   打开面板时 cur 没变（默认 0），effect 不重跑 → scroll 监听器一次都没装上。
// 修法：依赖改 [s.panelOpen]（开了才绑、关了解绑），回调里用 getSnapshot 读 cur；
//   平滑滚动窗口内不反推，用户一滚轮/触摸/按键立刻解锁。
{
  // ① 依赖守卫（假 React 不执行依赖比较，这条只能读源码）
  const effSrc = src.slice(src.indexOf('滚轮滚动时反推'), src.indexOf('打开工坊自动跑一次校验'));
  check('⑭ 滚动监听按面板开关绑定（依赖 [s.panelOpen]，不再跟 cur 重建）',
    /\},\s*\[s\.panelOpen\]\);/.test(effSrc) && !/\},\s*\[s\.cur\]\);/.test(effSrc) && effSrc.indexOf('if(!s.panelOpen) return;') > 0,
    (/\},\s*\[s\.[a-zA-Z]+\]\);/.exec(effSrc) || [''])[0]);

  // ② 行为：假 DOM —— 7 个 section + 一个滚动容器
  const ORDER = ['5', '1', '0', '2', '6', '4', '7'];
  const BASE = { 5: -300, 1: 80, 0: 560, 2: 880, 6: 1200, 4: 1500, 7: 1800 };
  let scrollTop = 0;
  const listeners = {};
  const scEl = {
    scrollTop: 0, clientHeight: 800, scrollHeight: 4000, lastScrollTo: null,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((x) => x !== fn); },
    querySelectorAll() {
      return ORDER.map((cur) => ({
        getAttribute(k) { return k === 'data-cur' ? cur : null; },
        getBoundingClientRect() { return { top: 100 + BASE[cur] - scrollTop }; },
      }));
    },
    getBoundingClientRect() { return { top: 100 }; },
    scrollTo(o) { this.lastScrollTo = o; },
  };
  const prevDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === 'cc-scroller') return scEl;
      const cur = String(id || '').replace('cc-sec-', '');
      return { getBoundingClientRect() { return { top: 100 + (BASE[cur] || 0) }; } };
    },
  };
  // 90ms 节流：文件顶部已把 setTimeout 换成不触发的桩，这里收集起来手动 flush
  const prevTimeout = globalThis.setTimeout;
  let timers = [];
  globalThis.setTimeout = function (fn) { timers.push(fn); return timers.length; };
  function flush() {
    const q = timers; timers = [];
    q.forEach((fn) => { try { fn(); } catch (e) { console.log('FAIL  scroll 回调抛错: ' + e.message); } });
  }

  // 打开面板后渲染一轮，只跑滚动监听那条 effect（不动其它 effect，避免触发校验请求）
  const cleanups = [];
  render().effects.forEach((fn) => {
    if (String(fn).indexOf('cc-scroller') >= 0) {
      const c = fn();
      if (typeof c === 'function') cleanups.push(c);
    }
  });
  check('⑭b 面板打开后 scroll 监听真的装到了 #cc-scroller 上（旧代码这里是空的）',
    (listeners.scroll || []).length === 1 && (listeners.wheel || []).length === 1 && (listeners.touchstart || []).length === 1,
    'scroll=' + (listeners.scroll || []).length + ' wheel=' + (listeners.wheel || []).length + ' touchstart=' + (listeners.touchstart || []).length);

  // 手动滚到「角色」附近：高亮自己切过去
  // （先发一次 wheel：③ 那步点锚点留下的平滑滚动窗口还在，真实用户滚动时正是这个事件解锁）
  store.setCur(0);
  (listeners.wheel || []).forEach((fn) => fn());
  scrollTop = 500; scEl.scrollTop = 500;
  (listeners.scroll || []).forEach((fn) => fn());
  flush();
  check('⑭c 手动滚动后高亮反推到可见章节（cur 0 → 1）', store.getSnapshot().cur === 1, String(store.getSnapshot().cur));

  // 点锚点「世界书」：立刻跳过去；平滑滚动途中经过「角色」也不许改高亮
  const loreTab = navButtons(redraw()).find((b) => NAV_CUR[b.children[0]] === 2);
  check('⑭d 锚点 tab 仍可点（scrollToSection 入口在）', !!loreTab && typeof loreTab.props.onClick === 'function', '');
  loreTab.props.onClick({});
  check('⑭e 点锚点后 cur 立刻是目标章节', store.getSnapshot().cur === 2, String(store.getSnapshot().cur));
  scrollTop = 300; scEl.scrollTop = 300;   // 途中：可见的其实是「角色」
  (listeners.scroll || []).forEach((fn) => fn());
  flush();
  check('⑭f 平滑滚动途中不反推（高亮留在目标章节，不会一路乱跳）', store.getSnapshot().cur === 2, String(store.getSnapshot().cur));

  // 用户自己动滚轮：立刻解锁，反推恢复
  (listeners.wheel || []).forEach((fn) => fn());
  (listeners.scroll || []).forEach((fn) => fn());
  flush();
  check('⑭g 用户滚轮后反推恢复（cur 跟着可见章节回到 1）', store.getSnapshot().cur === 1, String(store.getSnapshot().cur));

  // 滚到底：最后一节够不到顶部，也要能亮
  scrollTop = 3200; scEl.scrollTop = 3200;
  (listeners.scroll || []).forEach((fn) => fn());
  flush();
  check('⑭h 滚到底直接认最后一节（共享书，cur=7）', store.getSnapshot().cur === 7, String(store.getSnapshot().cur));

  // 关掉面板：监听必须解绑（关着的时候不许再改 cur）
  store.setPanel(false);
  redraw();
  cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
  check('⑭i 面板关闭后 scroll/wheel/touchstart/keydown 全部解绑',
    (listeners.scroll || []).length === 0 && (listeners.wheel || []).length === 0 && (listeners.touchstart || []).length === 0 && (listeners.keydown || []).length === 0,
    'scroll=' + (listeners.scroll || []).length);
  store.setPanel(true);
  redraw();

  globalThis.setTimeout = prevTimeout;
  if (prevDocument === undefined) delete globalThis.document; else globalThis.document = prevDocument;
}

// —— 0.22.0 回归：**hooks 必须在 early return 之前** ——
// 假 React 不校验 hook 顺序，所以这条只能靠源码顺序守卫。
// 踩过的坑：把滚动监听 effect 加在 `if(!s.panelOpen) return null;` 之后 →
// 面板关着 0 个 hook、点开 1 个，真实浏览器抛「Rendered more hooks than during the previous render」，
// 工坊白屏、点胶囊「没反应」（而 npm test 全绿）。
{
  const body = src.slice(src.indexOf('function Workshop(props){'), src.indexOf('function SettingsView(props){'));
  const retIdx = body.indexOf('if(!s.panelOpen) return null;');
  const hookIdx = body.indexOf('滚轮滚动时反推');
  check('⑪ 滚动监听 effect 在 Workshop 的 early return 之前（否则真实浏览器白屏）',
    retIdx > 0 && hookIdx > 0 && hookIdx < retIdx, 'ret=' + retIdx + ' hook=' + hookIdx);
  const hooks = [];
  const re = /React\.use(State|Effect|Ref|Memo|Callback)\(/g;
  let mm;
  while ((mm = re.exec(body))) hooks.push(mm.index);
  check('⑪b Workshop 里没有任何 React hook 落在 early return 之后',
    hooks.every((at) => at < retIdx), hooks.filter((at) => at > retIdx).join(','));
}

// —— 0.22.0：左栏折叠态照原型做（56px 图标条）——
// 现象：折叠后 40px 里写「已存角色 7」，中文被挤成竖排字，比展开态更吵（用户截图）。
// 修法：折叠 = 顶部「»」+ 一列头像方块，点头像即载入；文字（标题/搜索/副标题）全部不渲染。
{
  const avatarEls = (tree) => flatten(tree).filter((n) => n.props && n.props.style && String(n.props.style.background || '').indexOf('linear-gradient(135deg') === 0);
  await store.refreshLibrary();
  redraw();
  check('⑫ 展开态按库条目渲染卡片头像（假库 3 张）', avatarEls(redraw()).length === FAKE_LIB.length, 'avatars=' + avatarEls(redraw()).length);

  store.toggleLibraryCollapsed();
  tree = redraw();
  const flat = flatten(tree);
  check('⑫b 折叠后只剩图标条：「角色库」标题与搜索框都不再渲染（不再出现竖排文字）',
    src.indexOf('writingMode') < 0
      && !flat.some((n) => n.children && n.children[0] === 'workshop.library.title')
      && !flat.some((n) => n.type === 'input' && String(n.props.placeholder || '').indexOf('workshop.library.searchPlaceholder') >= 0),
    'vertical=' + (src.indexOf('writingMode') >= 0) + ' inputs=' + flat.filter((n) => n.type === 'input').length);
  const avatars = avatarEls(tree);
  check('⑫c 折叠条一列头像，数量与库条目一致', avatars.length === FAKE_LIB.length, 'avatars=' + avatars.length);
  check('⑫d 折叠条首格是「»」展开按钮（点回去回到 250px 卡片列表）',
    flat.some((n) => n.type === 'button' && n.children[0] === '»'), '');
  const before = calls.filter((c) => c.endpoint === 'cc_loadFromLibrary').length;
  avatars[0].props.onClick();
  await new Promise((r) => realSetTimeout(r, 0));
  check('⑫e 头像整块可点 = 载入该卡（与展开态卡片同一个入口）',
    calls.filter((c) => c.endpoint === 'cc_loadFromLibrary').length > before, '');

  store.toggleLibraryCollapsed();
  tree = redraw();
  check('⑫f 展开后卡片列表回来（头像 + 搜索框都在，不残留折叠条）',
    avatarEls(tree).length === FAKE_LIB.length && flatten(tree).some((n) => n.type === 'input')
      && !flatten(tree).some((n) => n.type === 'button' && n.children[0] === '»'),
    'avatars=' + avatarEls(tree).length);
}

// —— 0.22.0：库卡片不挂静态描边（照原型只在 hover 时显边）——
// 现象：未选中的卡每张都有一圈浅白细边，暗色主题下像一排白框（用户："选中再离开会留白边"）。
// 根因：卡片静态写了 `border:1px solid var(--dsw-alias-border-l1)`，原型是透明边 + hover 才显。
{
  const cardOf = (tree, name) => flatten(tree).find((n) => n.props && n.props.title === name && n.props.style && n.props.style.cursor === 'pointer');
  const card = cardOf(tree, '陆昭');
  check('⑬ 未选中的库卡片默认没有描边（border: transparent，不再挂 l1）',
    !!card && String(card.props.style.border).indexOf('transparent') >= 0 && String(card.props.style.border).indexOf('border-l1') < 0,
    card && String(card.props.style.border));
  const ps = { borderColor: 'transparent' };
  card.props.onMouseEnter({ currentTarget: { style: ps } });
  check('⑬b hover 才显一圈细边', String(ps.borderColor).indexOf('border-l1') >= 0, ps.borderColor);
  card.props.onMouseLeave({ currentTarget: { style: ps } });
  check('⑬c 移开后描边回到透明', ps.borderColor === 'transparent', ps.borderColor);
  check('⑬d 卡片不给浏览器留焦点环（onMouseDown 阻止抢焦点）', typeof card.props.onMouseDown === 'function', '');
  store.setCurrentLibraryId('lib-c');
  tree = redraw();
  const curCard = cardOf(tree, '谢无咎');
  check('⑬e 当前卡是品牌紫描边（页面里只有这一处「选中」）',
    !!curCard && String(curCard.props.style.border).indexOf('#7c5cff') >= 0, curCard && String(curCard.props.style.border));
}

// —— 收起工坊：整棵工坊树不再渲染（面板开关本身没被这次改动碰坏）——
store.setPanel(false);
check('⑨ 收起工坊后不再渲染任何步骤项', navButtons(redraw()).length === 0, String(navButtons(redraw()).length));

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

finish();
