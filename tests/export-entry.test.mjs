/**
 * 导出入口回归测试（不随插件发布，files 未含 tests）。
 *
 * 历史：0.4.1 把「顶部导出 JSON / 导航第 4 步 / 卡片导出」三处归一成「左下角入口 + 卡片入口」，
 * 中栏是一整页「校验与导出」。
 *
 * 0.14.0（用户截图反馈）：导出**不再占用中栏一整页**，改成独立弹层——
 *   - 中栏是「读卡」的地方，导出是「把卡交出去」的动作，两者混在一页里，用户滑一段正文就会
 *     撞见一排下载按钮；离开后那一页的校验错误清单也跟着消失；
 *   - 三个入口（左下角「校验导出」/ 总览页按钮 / 已存角色卡片上的「导出」）一律打开弹层，
 *     **不再改 cur**；`exportOpen` 状态在 store，关闭按钮 / 点遮罩 / 6s 跳转提示都只动这一处；
 *   - 弹层打开时工坊树仍在（遮罩覆盖），所以入口按钮不会出现「选中态」这种第二处高亮。
 *
 * 本文件把 lib/client.js 真装进假 React harness 里渲染，断言的是「点一下之后发生了什么」，
 * 不只是源码正则。
 *
 * 运行：node tests/export-entry.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

import { check, finish, createFakeReact } from './harness.mjs';

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

// —— 假 React：hook 槽位按渲染顺序保留（这样 setExportOpen / setHover 之后重渲染能看到新值）——
const { React, effectQueue, hooks } = createFakeReact();;

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

// —— 假 RPC：角色库返回一条卡片；JSON 导出（0.13.0 起由宿主导出）返回一个固定文本 ——
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
    if (endpoint === 'cc_getLibraryEntry') return Promise.resolve({ ok: true, value: { id: 'abcdef1234', meta: { name: '测试卡', groupId: 'g-lib' }, draft: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '测试卡', group_only_greetings: [], assets: [], tags: [], creation_date: 1791960000, modification_date: 1791960000 } } } });
    if (endpoint === 'cc_getBook') return Promise.resolve({ ok: true, value: { exists: true, groupId: 'g-lib', book: { spec: 'lorebook_v3', data: { name: '库组书', entries: [{ keys: ['x'], content: 'c' }] } }, rev: 1, tokens: 12, scan: null } });
    if (endpoint === 'cc_exportJson') return Promise.resolve({ ok: true, value: { filename: '工坊卡.json', mime: 'application/json', content: '{"spec":"chara_card_v3","data":{"name":"工坊卡"}}', merged: 0 } });
    // 0.15.0 远程导入：目标表 + 探测 + 导入（模拟本机 ST 在线）
    if (endpoint === 'cc_listTargets') return Promise.resolve({ ok: true, value: { defaultTarget: 'sillytavern', targets: [
      { id: 'ccv3', label: 'CCv3', capabilities: {} },
      { id: 'sillytavern', label: 'SillyTavern', capabilities: {}, remote: { label: 'SillyTavern', defaultBaseUrl: 'http://127.0.0.1:8000', auth: 'basic' } },
    ] } });
    if (endpoint === 'cc_stProbe') return Promise.resolve({ ok: true, value: { online: true, baseUrl: 'http://127.0.0.1:8000', version: '1.19.0', worlds: 3, auth: 'none', error: null } });
    if (endpoint === 'cc_stImport') return Promise.resolve({ ok: true, value: { card: { fileName: '工坊卡.png', name: '工坊卡' }, world: { action: 'imported', name: '锁天司·共享设定', existed: false }, warnings: [] } });
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
const byAria = (tree, label) => buttons(tree).filter((b) => b.props && b.props['aria-label'] === label);
// 「选中」的判据：有底色 + 有 inset 左竖条（不写死色值，换品牌色不该让测试红）
function isActive(style) {
  if (!style) return false;
  return String(style.background || '') !== '' && String(style.background) !== 'transparent' && String(style.boxShadow || '').indexOf('inset') >= 0;
}
const exportOpen = () => !!store.getSnapshot().exportOpen;

// —— 打开工坊（panelOpen=false 时整棵工坊树不渲染）——
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
check('①f 弹层关闭键 export.close 在 zh 与 en 都在（键集同步，切英文不退化）',
  hasKey(zhSrc, 'export.close') && hasKey(enSrc, 'export.close'), '');

// ② 顶部工具条：那枚「导出 JSON」必须消失
check('② 顶部工具条里再也找不到「导出 JSON」按钮',
  byLabel(tree, 'action.export').length === 0, 'buttons=' + byLabel(tree, 'action.export').length);

// ③ 底部：「校验导出」与「校验」合并成唯一一枚入口
const entryBtns = byLabel(tree, 'step.export');
check('③ 左下角恰有 1 枚「校验导出」入口（原来导航第 4 项 + 底部「校验」两枚已合并）',
  entryBtns.length === 1, String(entryBtns.length));
check('③b 没打开弹层时它是普通主按钮样子，且不带 aria-current',
  entryBtns[0].props['aria-current'] == null && !isActive(entryBtns[0].props.style),
  String(entryBtns[0].props['aria-current']) + ' / ' + String(entryBtns[0].props.style.background));
check('③c 它拦掉鼠标按下时的默认行为（不抢焦点，免得留下一圈焦点描边）',
  (function () { let n = 0; entryBtns[0].props.onMouseDown({ preventDefault() { n++; } }); return n === 1; })(), '');

// ④ 点入口 → 打开导出弹层（不再切页 / 不改 cur）
const curBefore = store.getSnapshot().cur;
const beforeEntry = calls.length;
entryBtns[0].props.onClick({});
check('④ 点它打开导出弹层（store.exportOpen=true），且不改 cur（导出是动作，不是页面）',
  exportOpen() === true && store.getSnapshot().cur === curBefore,
  'open=' + exportOpen() + ' cur=' + store.getSnapshot().cur + ' before=' + curBefore);
// 0.15.0：打开弹层会顺带做一次**只读**远程探测（cc_listTargets / cc_stProbe）——
// 但校验/导出/写草稿类动作仍然只在用户点按钮时发生。
const PROBE_ONLY = ['cc_listTargets', 'cc_stProbe'];
const probeAdded = calls.slice(beforeEntry).map((c) => c.endpoint);
check('④b 打开弹层不触发校验/导出（只允许顺带探测 ST 的只读 RPC）',
  probeAdded.every((ep) => PROBE_ONLY.indexOf(ep) >= 0), probeAdded.join(',') || '(无新增 RPC)');

tree = redraw();
check('④c 弹层渲染出关闭按钮（aria-label=export.close，与工坊 ✕ 区分）',
  byAria(tree, 'export.close').length === 1, String(byAria(tree, 'export.close').length));

// 0.15.0：打开弹层顺带探测本机 SillyTavern（目标表 → cc_stProbe），在线后出现「导入到 ST」区块
await tick(); await tick(); await tick();
tree = redraw();
const onlineBadge = flatten(tree).filter((n) => n.children && String(n.children[0]).indexOf('● st.online') === 0);
check('④d 弹层里出现远程导入区块，且探测结果为在线（带 ST 版本）',
  textNodes(tree, 'st.title').length === 1 && onlineBadge.length === 1,
  'title=' + textNodes(tree, 'st.title').length + ' online=' + onlineBadge.length
  + ' probe=' + JSON.stringify(store.getSnapshot().stProbe));
const stImportBtn = byLabel(tree, 'st.import')[0];
check('④e 在线后「开始导入」按钮不再是禁用态', !!stImportBtn && stImportBtn.props.disabled === false,
  stImportBtn ? String(stImportBtn.props.disabled) : 'missing');
check('④e2 区块提供「选择封面」（可选，不选就用占位图）',
  byLabel(tree, 'st.cover').length === 1 && typeof store.pickStCover === 'function' && typeof store.clearStCover === 'function',
  'cover=' + byLabel(tree, 'st.cover').length);
const beforeImport = calls.length;
if (stImportBtn) stImportBtn.props.onClick({});
await tick(); await tick();
const stImportCall = calls.slice(beforeImport).filter((c) => c.endpoint === 'cc_stImport')[0];
check('④f 点「开始导入」调 cc_stImport（草稿模式不带 cardId，带 baseUrl）',
  !!stImportCall && !stImportCall.payload.args.cardId
  && stImportCall.payload.args.baseUrl === 'http://127.0.0.1:8000',
  stImportCall ? JSON.stringify(stImportCall.payload.args) : 'no cc_stImport');
check('④g 导入成功后回报「已导入：卡 · 世界书」',
  store.getSnapshot().lastMsg === 'st.imported', String(store.getSnapshot().lastMsg));

const entryNow = byLabel(tree, 'step.export')[0];
// 弹层打开时工坊树仍在（遮罩覆盖），入口按钮不做选中态 —— 否则又是「两处看起来像选中」。
check('⑤ 入口按钮不随弹层开关改变外观（不许造出第二处「看起来像选中」）',
  !isActive(entryNow.props.style) && entryNow.props['aria-current'] == null && entryNow.props.style.background === '#7c5cff',
  String(entryNow.props['aria-current']) + ' / ' + String(entryNow.props.style.background));

// ⑥ 弹层本身：四枚导出 + 一枚校验，一处都不少
// 0.22.0：校验 / 导出 / 保存 收口到顶部锚点栏常驻，所以「校验」在全局会有 2 枚
// （锚点栏 + 弹层内）。这里只保证四枚导出动作各恰好 1 枚、校验入口仍在。
const ACTION_KEYS = ['action.exportJson', 'action.exportPng', 'action.embedPng', 'action.exportCharx'];
check('⑥ 弹层内仍渲染出 4 枚导出动作 + 校验入口',
  ACTION_KEYS.every((k) => byLabel(tree, k).length === 1) && byLabel(tree, 'action.validate').length >= 1,
  ACTION_KEYS.map((k) => k + ':' + byLabel(tree, k).length).join(', ') + ' validate:' + byLabel(tree, 'action.validate').length);
check('⑥b 弹层写明了「导出的是当前工坊里的卡」',
  textNodes(tree, 'workshop.export.currentHint').length === 1, String(textNodes(tree, 'workshop.export.currentHint').length));
check('⑥c 弹层标题与校验徽章仍在（就是原来那个「校验与导出」）',
  textNodes(tree, 'workshop.export.title').length === 1 && (textNodes(tree, 'workshop.export.passed').length + textNodes(tree, 'workshop.export.failed').length) === 1, '');
const titleNode = textNodes(tree, 'workshop.export.title')[0];
const nameSpan = titleNode && titleNode.children && titleNode.children[1];
check('⑥d 标题后面挂上当前卡名（让用户知道这次导的是哪张卡）',
  !!nameSpan && nameSpan.children[0] === '· 工坊卡', nameSpan ? String(nameSpan.children[0]) : 'missing');
store.updateDraft(function (d) { d.name = ''; });
tree = redraw();
const emptyNameSpan = textNodes(tree, 'workshop.export.title')[0].children[1];
check('⑥e 卡还没名字时显示「未命名」，而不是留个空标题',
  emptyNameSpan.children[0] === '· workshop.library.unnamed', String(emptyNameSpan.children[0]));
store.updateDraft(function (d) { d.name = '工坊卡'; });
tree = redraw();

// ⑦ 导出动作仍然真的能下载（搬进弹层没有把功能砍掉）
const dlBefore = downloads.length;
byLabel(tree, 'action.exportJson')[0].props.onClick({});
await tick(); await tick();   // 0.13.0：JSON 导出走宿主 RPC（转换在 lib/compat/adapters，客户端只下载）
check('⑦ 弹层里的「⬇ JSON」仍然触发下载并回报 store.exportedJson',
  downloads.length === dlBefore + 1 && store.getSnapshot().lastMsg === 'store.exportedJson',
  'downloads+' + (downloads.length - dlBefore) + ' lastMsg=' + String(store.getSnapshot().lastMsg));

// ⑧ 写作用途的导航仍可用：点导航只改 cur，弹层保持打开（直到用户关）
byLabel(tree, 'step.world')[0].props.onClick({});
tree = redraw();
check('⑧ 点左侧写作步骤只切 cur，弹层仍开着（导航与导出是两件事）',
  store.getSnapshot().cur === 0 && exportOpen() === true && byLabel(tree, 'action.exportJson').length === 1,
  'cur=' + store.getSnapshot().cur + ' open=' + exportOpen());

// ⑨ 0.22.0：卡片按原型简化 —— 整块可点 = 载入；载入/导出/删除/分组都收口到顶部动作区
const libCards = flatten(tree).filter((n) => n.type === 'div' && n.props && n.props.title === '测试卡');
check('⑨ 卡片只剩「头像 + 名字 + 一行副标题」（卡片内部没有任何按钮）',
  libCards.length === 1 && byLabel(tree, 'workshop.library.export').length === 0
  && byLabel(tree, 'workshop.library.load').length === 0
  && flatten(libCards[0]).filter((n) => n.type === 'button').length === 0,
  'cards=' + libCards.length + ' exportBtn=' + byLabel(tree, 'workshop.library.export').length
  + ' loadBtn=' + byLabel(tree, 'workshop.library.load').length);
const beforeCardLoad = calls.length;
libCards[0].props.onClick({});
await tick(); await tick();
check('⑨b 点卡片整块 = 载入这张卡（不再需要单独的「载入」按钮）',
  calls.slice(beforeCardLoad).some((c) => c.endpoint === 'cc_loadFromLibrary'),
  calls.slice(beforeCardLoad).map((c) => c.endpoint).join(',') || '(无新增 RPC)');

// ⑩ 关闭弹层：✕ / 点遮罩都只动 store.exportOpen，工坊回到原页面
byAria(tree, 'export.close')[0].props.onClick({});
check('⑩ 点弹层 ✕ 关闭：exportOpen=false，弹层内容消失',
  exportOpen() === false && byLabel(redraw(), 'action.exportJson').length === 0,
  'open=' + exportOpen());
// 再打开一次，验证「点面板内部不关、点遮罩才关」
byLabel(redraw(), 'step.export')[0].props.onClick({});
tree = redraw();
check('⑩b0 普通入口（草稿模式）不沿用上一张库卡的共享书（当前组没有书就显示 none）',
  flatten(tree).filter((n) => n.children && String(n.children[0]) === '库组书').length === 0, '');
const mask = flatten(tree).filter((n) => n.props && n.props.style && n.props.style.zIndex === 45)[0];
check('⑩b 点面板内部（target !== currentTarget）不会关闭弹层', (function () {
  if (!mask) return false;
  mask.props.onClick({ target: {}, currentTarget: mask });
  return exportOpen() === true;
})(), 'mask=' + !!mask + ' open=' + exportOpen());
check('⑩c 点遮罩（target===currentTarget）→ exportOpen=false',
  !!mask && (function () {
    mask.props.onClick({ target: mask, currentTarget: mask });
    return exportOpen() === false && byLabel(redraw(), 'action.exportJson').length === 0;
  })(),
  'open=' + exportOpen() + ' mask=' + !!mask);

// ⑪ 顶部胶囊与左侧导航都只剩写作三步
byLabel(tree, 'step.export')[0].props.onClick({});
tree = redraw();
const chips = flatten(tree).filter((n) => n.type === 'span' && typeof n.children[0] === 'string' && /^\d\. step\./.test(n.children[0]));
const navBtns = flatten(tree).filter((n) => n.type === 'button' && ['step.world', 'step.char', 'step.lore'].indexOf(n.children[0]) >= 0);
// ⑪ 0.22.0：顶部旧的写作步骤胶囊已删除；章节导航只剩顶部锚点栏（导出是动作，不是章节）
check('⑪ 顶部旧胶囊已删除，锚点栏里仍是那三个写作章节',
  chips.length === 0 && navBtns.length === 3, 'chips=' + chips.length + ' nav=' + navBtns.length);

// ⑫ 收起工坊：整棵树不再渲染（面板开关没被这次改动碰坏）
store.setPanel(false);
check('⑫ 收起工坊后不再渲染任何导出按钮', byLabel(redraw(), 'action.exportJson').length === 0, '');

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;
delete globalThis.document;
delete globalThis.Blob;

finish();
