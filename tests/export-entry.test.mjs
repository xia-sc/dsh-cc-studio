/**
 * 导出入口归一回归测试（不随插件发布，files 未含 tests）。
 *
 * 现象（用户截图）：同一个「导出」在工坊里出现了三处，彼此重复：
 *   ① 顶部工具条右侧的「⬇ 导出 JSON」；
 *   ② 左侧导航第 4 步「校验导出」（中栏是一整页 JSON / PNG / 写入PNG / CHARX 按钮）；
 *   ③ 已存角色卡片里的「导出」（直接下载那张卡的 JSON，与工坊当前内容无关）。
 *
 * 本次（0.4.1）：
 *   ① 删掉顶部那枚「导出 JSON」；
 *   ② 左侧导航与顶部胶囊都只留写作三步 ——「校验导出」与左下角原来那枚「校验」按钮合并成一枚：
 *      点它切到导出页，校验与导出动作都只留在那一页里；
 *   ③ 已存角色卡片上的「导出」保留原位置，但改成切到同一页（不再自己下载 JSON）——
 *      导出页导出的始终是当前工坊里的卡，想导某张已存角色先「载入」；
 *   ④ store 里的旁路实现 exportLibraryEntry 一并删除：同一次导出不许有两套行为。
 *
 * 反馈补强（同版）：① 导出页标题后面挂上当前卡名（「… CHARX · 测试卡」，还没名字时显示「未命名」），
 * 让用户一眼知道这一页在导哪张卡；② 卡片上的「导出」点下去按钮自己先变（「已切到 ✓」）并自动收起，
 * 同时在导出页把「导出的仍是工坊里那张、你点的那张还没载入」写成醒目提示 —— 只切页太安静了，
 * 用户的视线在右侧卡片上，中栏换了内容他未必看得见。
 *
 * 修正（用户第二轮实机反馈）：左下角那枚「校验导出」入口**不做选中态**。上一版给它加过淡紫选中态 +
 * `aria-current`，从卡片点「导出」时它和卡片那枚「已切到 ✓」同时发亮 —— 又成了「两处看起来像选中」，
 * 正是 0.4.0 修过、用户最敏感的那类问题。「现在在导出页」改由中栏标题（带卡名）表达。
 *
 * 本文件把 lib/client.js 真装进假 React harness 里渲染，断言的是「点一下之后发生了什么」，
 * 不只是源码正则。
 *
 * 运行：node tests/export-entry.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 源码级：旧入口的残留物必须一起消失，否则「归一」会在下一次改动里悄悄长回来 ——
const zhSrc = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
const enSrc = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
const hasKey = (hay, key) => hay.indexOf('"' + key + '":') >= 0;

// —— 假 document / Blob / URL：导出走 a.click()，要能观察到 ——
const downloads = [];
globalThis.document = {
  createElement(tag) {
    return {
      tag,
      _href: '',
      set href(v) { this._href = v; },
      get href() { return this._href; },
      click() { downloads.push(tag); },
    };
  },
};
globalThis.Blob = function Blob(parts, opts) { this.parts = parts; this.type = opts && opts.type; };
globalThis.URL = { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} };

// —— 假 React：hook 槽位按渲染顺序保留（这样 setCur / setHover 之后重渲染能看到新值）——
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
const timers = [];
globalThis.setTimeout = function (fn, ms) { timers.push({ fn, ms }); return timers.length; };
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

// —— 假 RPC：只让角色库返回一条卡片，其余端点一律失败（导出按钮只调本地逻辑，不该发请求）——
const calls = [];
const LIB_ENTRY = { id: 'abcdef1234', name: '测试卡', loreCount: 1, tags: ['测试'], updatedAt: 1791960000, descriptionSnippet: '' };
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) {
    calls.push({ endpoint, payload });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: [LIB_ENTRY] } });
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
  } } },
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
const tick = () => new Promise((r) => setImmediate(r));

function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}
const buttons = (tree) => flatten(tree).filter((n) => n.type === 'button');
const byLabel = (tree, label) => buttons(tree).filter((b) => b.children[0] === label);
const textNodes = (tree, label) => flatten(tree).filter((n) => n.children && n.children[0] === label);
// 「选中」的判据：有底色 + 有 inset 左竖条（不写死色值，换品牌色不该让测试红）
function isActive(style) {
  if (!style) return false;
  return String(style.background || '') !== '' && String(style.background) !== 'transparent' && String(style.boxShadow || '').indexOf('inset') >= 0;
}

// —— 打开工坊（panelOpen=false 时整棵工坊树不渲染）——
// 顺序同 nav-highlight：先开面板再首渲染，否则 useState 的惰性初始化会把「关闭」快照固化下来。
// 给工坊里的卡起个名字：标题里的卡名、以及「点的那张 ≠ 工坊里这张」都靠它区分（库里那张叫「测试卡」）。
store.updateDraft(function (d) { d.name = '工坊卡'; });
store.setPanel(true);
run(render().effects);
await tick();          // 等角色库回来（卡片上的「导出」按钮要渲染出来才测得到）
let tree = redraw();

// ① 源码级：旧的旁路实现与旧词条一起删干净
check('① 词表两表都不再有 action.export（顶部那枚「导出 JSON」已无文案可用）',
  !hasKey(zhSrc, 'action.export') && !hasKey(enSrc, 'action.export'), '');
check('①b step.export.desc 随导航第 4 项一起删除（step.export 仍留给底部入口）',
  !hasKey(zhSrc, 'step.export.desc') && !hasKey(enSrc, 'step.export.desc') && hasKey(zhSrc, 'step.export') && hasKey(enSrc, 'step.export'), '');
check('①c store.exported / store.errExportFailed 随 exportLibraryEntry 一起删除',
  !['store.exported', 'store.errExportFailed'].some((k) => hasKey(zhSrc, k) || hasKey(enSrc, k)), '');
check('①d store 不再暴露 exportLibraryEntry（旁路不删，「导出」就会有两套行为）',
  !/function exportLibraryEntry/.test(src) && !/exportLibraryEntry:exportLibraryEntry/.test(src), '');
check('①e 新键 workshop.export.currentHint / workshop.library.exportTip 在 zh 与 en 都在',
  ['workshop.export.currentHint', 'workshop.library.exportTip'].every((k) => hasKey(zhSrc, k) && hasKey(enSrc, k)), '');

// ② 顶部工具条：那枚「导出 JSON」必须消失
check('② 顶部工具条里再也找不到「导出 JSON」按钮',
  byLabel(tree, 'action.export').length === 0, 'buttons=' + byLabel(tree, 'action.export').length);

// ③ 底部：「校验导出」与「校验」合并成唯一一枚入口
const entryBtns = byLabel(tree, 'step.export');
check('③ 左下角恰有 1 枚「校验导出」入口（原来导航第 4 项 + 底部「校验」两枚已合并）',
  entryBtns.length === 1, String(entryBtns.length));
check('③b 不在导出页时它是普通主按钮样子，且不带 aria-current',
  entryBtns[0].props['aria-current'] == null && !isActive(entryBtns[0].props.style),
  String(entryBtns[0].props['aria-current']) + ' / ' + String(entryBtns[0].props.style.background));
check('③c 它拦掉鼠标按下时的默认行为（不抢焦点，免得留下一圈焦点描边）',
  (function () { let n = 0; entryBtns[0].props.onMouseDown({ preventDefault() { n++; } }); return n === 1; })(), '');

// ④ 点入口 → 切到导出页，且不发任何 RPC（它只是入口）
const beforeEntry = calls.length;
entryBtns[0].props.onClick({});
check('④ 点它切到导出页（cur=3）', store.getSnapshot().cur === 3, String(store.getSnapshot().cur));
check('④b 切页本身不发 RPC（校验/导出动作只发生在导出页里）',
  calls.length === beforeEntry, '新增 ' + (calls.length - beforeEntry) + ' 条');

tree = redraw();
const entryNow = byLabel(tree, 'step.export')[0];
// 上一版给过它淡紫选中态 + aria-current，结果从右侧卡片点「导出」时，它和卡片那枚「已切到 ✓」同时发亮 ——
// 又是「两处看起来像选中」（0.4.0 修过的同一个坑）。所以这枚入口按钮不做选中态：
// 「现在在导出页」由中栏标题（带卡名）表达，不靠按钮。
check('⑤ 入口按钮不随所在页面改变外观（不许再造出第二处「看起来像选中」）',
  !isActive(entryNow.props.style) && entryNow.props['aria-current'] == null && entryNow.props.style.background === '#7c5cff',
  String(entryNow.props['aria-current']) + ' / ' + String(entryNow.props.style.background));

// ⑥ 导出页本身：四枚导出 + 一枚校验，一处都不少
const ACTION_KEYS = ['action.exportJson', 'action.exportPng', 'action.embedPng', 'action.exportCharx', 'action.validate'];
check('⑥ 导出页仍渲染出 5 枚动作按钮（JSON / PNG / 写入 PNG / CHARX / 校验）',
  ACTION_KEYS.every((k) => byLabel(tree, k).length === 1),
  ACTION_KEYS.map((k) => k + ':' + byLabel(tree, k).length).join(', '));
check('⑥b 导出页写明了「导出的是当前工坊里的卡」',
  textNodes(tree, 'workshop.export.currentHint').length === 1, String(textNodes(tree, 'workshop.export.currentHint').length));
check('⑥c 导出页标题与校验徽章仍在（这页就是原来那个「校验与导出」）',
  textNodes(tree, 'workshop.export.title').length === 1 && (textNodes(tree, 'workshop.export.passed').length + textNodes(tree, 'workshop.export.failed').length) === 1, '');
const titleNode = textNodes(tree, 'workshop.export.title')[0];
const nameSpan = titleNode && titleNode.children && titleNode.children[1];
check('⑥d 标题后面挂上当前卡名（让用户知道这页在导哪张卡）',
  !!nameSpan && nameSpan.children[0] === '· 工坊卡', nameSpan ? String(nameSpan.children[0]) : 'missing');
store.updateDraft(function (d) { d.name = ''; });
tree = redraw();
const emptyNameSpan = textNodes(tree, 'workshop.export.title')[0].children[1];
check('⑥e 卡还没名字时显示「未命名」，而不是留个空标题',
  emptyNameSpan.children[0] === '· workshop.library.unnamed', String(emptyNameSpan.children[0]));
store.updateDraft(function (d) { d.name = '工坊卡'; });
tree = redraw();

// ⑦ 导出动作仍然真的能下载（归一没有把功能砍掉）
const dlBefore = downloads.length;
byLabel(tree, 'action.exportJson')[0].props.onClick({});
check('⑦ 导出页的「⬇ JSON」仍然触发下载并回报 store.exportedJson',
  downloads.length === dlBefore + 1 && store.getSnapshot().lastMsg === 'store.exportedJson',
  'downloads+' + (downloads.length - dlBefore) + ' lastMsg=' + String(store.getSnapshot().lastMsg));

// ⑧ 回到写作步骤：入口按钮的选中态必须收回（选中态唯一）
byLabel(tree, 'step.world')[0].props.onClick({});
tree = redraw();
check('⑧ 回到写作步骤后它仍是同一副主按钮样子（与在导出页时逐字一致，没有任何「选中」痕迹）',
  byLabel(tree, 'step.export')[0].props['aria-current'] == null && !isActive(byLabel(tree, 'step.export')[0].props.style) && byLabel(tree, 'step.export')[0].props.style.background === entryNow.props.style.background,
  String(byLabel(tree, 'step.export')[0].props.style.background));

// ⑨ 已存角色卡片上的「导出」：位置不变，行为改成切页
const cardExport = byLabel(tree, 'workshop.library.export');
check('⑨ 已存角色卡片上的「导出」还在原位（有卡片时恰 1 枚）', cardExport.length === 1, String(cardExport.length));
check('⑨b 它带上了说明用的 tooltip（导出的是当前工坊里的卡）',
  cardExport[0].props.title === 'workshop.library.exportTip', String(cardExport[0].props.title));
const beforeCard = calls.length;
cardExport[0].props.onClick({});
check('⑨c 点它同样只是切到导出页', store.getSnapshot().cur === 3, String(store.getSnapshot().cur));
const added = calls.slice(beforeCard).map((c) => c.endpoint);
check('⑨d 不自动载入、也不直接下载（不碰 cc_loadFromLibrary / cc_getLibraryEntry）',
  added.indexOf('cc_loadFromLibrary') < 0 && added.indexOf('cc_getLibraryEntry') < 0,
  added.join(',') || '(无新增 RPC)');
tree = redraw();
check('⑨e 切页后当前草稿没被换掉（卡片名不会变成工坊里的卡名）',
  store.getSnapshot().currentLibraryId == null, String(store.getSnapshot().currentLibraryId));
check('⑨f 点完按钮自己先变（「已切到 ✓」）—— 视线在右侧也看得见反应',
  byLabel(tree, 'workshop.library.exportJumped').length === 1, String(byLabel(tree, 'workshop.library.exportJumped').length));
check('⑨g 导出页顶部换成醒目提示：导的是工坊里那张、你点的那张还没载入',
  textNodes(tree, 'workshop.export.jumpedOther').length === 1 && textNodes(tree, 'workshop.export.currentHint').length === 0,
  'jumped=' + textNodes(tree, 'workshop.export.jumpedOther').length + ' hint=' + textNodes(tree, 'workshop.export.currentHint').length);
// 用户实机报的正是这一条：从卡片点「导出」时，左下角那枚入口按钮**不许**跟着变亮
check('⑨g2 从卡片跳转后左下角入口按钮没有被一起点亮（还是「两处看起来像选中」的坑）',
  !isActive(byLabel(tree, 'step.export')[0].props.style) && byLabel(tree, 'step.export')[0].props['aria-current'] == null,
  String(byLabel(tree, 'step.export')[0].props.style.background));
const jumpTimer = timers.filter(function (x) { return x.ms === 6000; })[0];check('⑨h 反馈会自己收起（安排了一个 6s 的清除定时器，不常驻打扰）', !!jumpTimer, timers.length + ' timers');
if (jumpTimer) {
  jumpTimer.fn();
  tree = redraw();
  check('⑨i 收起后回到常态：按钮文案复原、提示换回常驻说明',
    byLabel(tree, 'workshop.library.export').length === 1 && byLabel(tree, 'workshop.library.exportJumped').length === 0 && textNodes(tree, 'workshop.export.currentHint').length === 1,
    'export=' + byLabel(tree, 'workshop.library.export').length + ' hint=' + textNodes(tree, 'workshop.export.currentHint').length);
}

// ⑩ 顶部胶囊与左侧导航都只剩写作三步
const chips = flatten(tree).filter((n) => n.type === 'span' && typeof n.children[0] === 'string' && /^\d\. step\./.test(n.children[0]));
const navBtns = flatten(tree).filter((n) => n.type === 'button' && ['step.world', 'step.char', 'step.lore'].indexOf(n.children[0]) >= 0);
check('⑩ 顶部胶囊与左侧导航都只有 3 个写作步骤（导出不再是第 4 步）',
  chips.length === 3 && navBtns.length === 3, 'chips=' + chips.length + ' nav=' + navBtns.length);

// ⑪ 收起工坊：整棵树不再渲染（面板开关没被这次改动碰坏）
store.setPanel(false);
check('⑪ 收起工坊后不再渲染任何导出按钮', byLabel(redraw(), 'action.exportJson').length === 0, '');

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;
delete globalThis.document;
delete globalThis.Blob;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
