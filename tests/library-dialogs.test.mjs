/**
 * 角色库入口 / 弹框回归测试（0.23.0）。
 *
 * 现象（用户截图）：左栏「⋯」菜单里的「另存为新 / 重命名 / ＋ 组」三项已经没用；
 *   重命名与新建分组应该放到顶部动作栏（校验 / 导出 / 保存 / 分组 / 删除 / 清空那一行），
 *   点击弹输入框完成；「另存为新」整条删除。
 *
 * 本文件把 lib/client.js 装进假 React harness，直接断言渲染出来的按钮、弹框与 RPC 调用。
 *
 * 运行：node tests/library-dialogs.test.mjs   （全绿退出码 0）
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

let registration = null;
globalThis.window = { __ModuleLoader__: { load(def) { registration = def; } } };
new Function('window', src)(globalThis.window);
if (!registration) { console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load'); process.exit(1); }

const calls = [];
const FAKE_LIB = [
  { id: 'lib-a', name: '陆昭', loreCount: 5, groupId: 'g1', tags: [] },
  { id: 'lib-b', name: '白十三', loreCount: 3, groupId: 'g1', tags: [] },
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
    if (endpoint === 'cc_renameInLibrary') return Promise.resolve({ ok: true, value: { id: payload.args.id, name: payload.args.name } });
    if (endpoint === 'cc_createGroup') return Promise.resolve({ ok: true, value: { group: { id: 'g-new', name: payload.args.name } } });
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
function redraw() { return render().tree; }
function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}
const byLabel = (tree, key) => flatten(tree).filter((n) => n.type === 'button' && n.children && n.children[0] === key);
const tick = () => new Promise((r) => setTimeout(r, 0));

// 打开工坊（panelOpen=false 时整棵工坊树不渲染）
store.setPanel(true);
render().effects.forEach((fn) => { try { fn(); } catch (e) {} });
await tick(); await tick();   // 等 refreshLibrary 把假库拉回来（否则「重命名」没有对象可预填）
let tree = redraw();

// —— ① 左栏「⋯」菜单只剩导入 ——
const menuDivs = flatten(tree).filter((n) => n.type === 'div' && n.props && n.props.style && n.props.style.boxShadow
  && String(n.props.style.boxShadow).indexOf('0 8px 24px') >= 0);
const menuButtons = menuDivs.length ? flatten(menuDivs[0]).filter((n) => n.type === 'button') : [];
check('① 左栏「⋯」菜单只剩「导入」一项（另存为新 / 重命名 / ＋ 组 都不在菜单里）',
  menuButtons.length === 1 && menuButtons[0].children[0] === 'workshop.library.import',
  'items=' + menuButtons.map((b) => b.children[0]).join(','));

// —— ② 顶部动作栏出现「重命名」「＋ 组」 ——
check('② 顶部动作栏渲染出「重命名」与「＋ 组」两个按钮',
  byLabel(tree, 'workshop.library.rename').length === 1 && byLabel(tree, 'workshop.group.new').length === 1,
  'rename=' + byLabel(tree, 'workshop.library.rename').length + ' group=' + byLabel(tree, 'workshop.group.new').length);

// —— ③ 没载入库卡时「重命名」禁用 ——
check('③ 没载入库卡时「重命名」是禁用态（没有对象可改名）',
  byLabel(tree, 'workshop.library.rename')[0].props.disabled === true,
  String(byLabel(tree, 'workshop.library.rename')[0].props.disabled));

// —— ④ 载入一张卡 → 点重命名 → 弹框出现，输入框预填当前名字 ——
store.setCurrentLibraryId('lib-b');
tree = redraw();
const renameBtn = byLabel(tree, 'workshop.library.rename')[0];
check('④ 载入库卡后「重命名」可点', renameBtn.props.disabled === false, String(renameBtn.props.disabled));
renameBtn.props.onClick({});
tree = redraw();
const inputEls = flatten(tree).filter((n) => n.type === 'input');
const dialogInput = inputEls[inputEls.length - 1];
check('④b 点「重命名」弹出输入框，预填当前卡名（白十三）',
  !!dialogInput && dialogInput.props.value === '白十三' && dialogInput.props.autoFocus === true,
  dialogInput ? String(dialogInput.props.value) : 'missing');

// 弹框标题与遮罩：一个输入 + 明确标题
const dialogTitles = flatten(tree).filter((n) => n.type === 'strong' && n.children && n.children[0] === 'workshop.library.renameTitle');
check('④c 弹框标题写明「重命名」', dialogTitles.length === 1, String(dialogTitles.length));

// —— ⑤ 空名字时「完成」禁用 ——
dialogInput.props.onChange({ target: { value: '   ' } });
tree = redraw();
const doneBtns = byLabel(tree, 'action.done');
check('⑤ 名字为空（或全空格）时「完成」按钮禁用，不会提交空名字',
  doneBtns.length === 1 && doneBtns[0].props.disabled === true,
  'done=' + doneBtns.length + ' disabled=' + (doneBtns[0] && doneBtns[0].props.disabled));

// —— ⑥ 输入新名字并点「完成」→ 调用 cc_renameInLibrary(id, name)，弹框关闭 ——
const inputNow = flatten(tree).filter((n) => n.type === 'input').slice(-1)[0];
inputNow.props.onChange({ target: { value: '白十三·改' } });
tree = redraw();
const doneNow = byLabel(tree, 'action.done')[0];
check('⑥ 输入非空名字后「完成」可点', !!doneNow && doneNow.props.disabled === false, doneNow ? String(doneNow.props.disabled) : 'missing');
doneNow.props.onClick({});
await tick(); await tick();
const renameCall = calls.find((c) => c.endpoint === 'cc_renameInLibrary');
check('⑥b 点「完成」发出 cc_renameInLibrary，payload 是 {id, name}',
  !!renameCall && renameCall.payload.args.id === 'lib-b' && renameCall.payload.args.name === '白十三·改',
  renameCall ? JSON.stringify(renameCall.payload.args) : 'no call');
tree = redraw();
check('⑥c 提交后弹框自动关闭（不会第二次弹出来）',
  flatten(tree).filter((n) => n.type === 'input').every((n) => n.props.value !== '白十三·改'),
  '');

// —— ⑦ 取消：只关弹框，不发请求 ——
const beforeCancel = calls.length;
byLabel(tree, 'workshop.library.rename')[0].props.onClick({});
tree = redraw();
byLabel(tree, 'action.cancel')[0].props.onClick({});
tree = redraw();
check('⑦ 点「取消」关闭弹框且不发 RPC',
  calls.length === beforeCancel && flatten(tree).filter((n) => n.type === 'input').length === inputEls.length - 1,
  'newCalls=' + (calls.length - beforeCancel));

// —— ⑧ 「＋ 组」→ 弹框 → 输入 → 完成 → cc_createGroup ——
byLabel(tree, 'workshop.group.new')[0].props.onClick({});
tree = redraw();
const groupInput = flatten(tree).filter((n) => n.type === 'input').slice(-1)[0];
check('⑧ 点「＋ 组」弹出输入框，标题写明「新建分组」，初始为空',
  !!groupInput && groupInput.props.value === ''
  && flatten(tree).some((n) => n.type === 'strong' && n.children && n.children[0] === 'workshop.group.newTitle'),
  groupInput ? String(groupInput.props.value) : 'missing');
groupInput.props.onChange({ target: { value: '仙侠组' } });
tree = redraw();
const groupDone = byLabel(tree, 'action.done')[0];
groupDone.props.onClick({});
await tick(); await tick();
const groupCall = calls.find((c) => c.endpoint === 'cc_createGroup');
check('⑧b 点「完成」发出 cc_createGroup，payload 是新分组名',
  !!groupCall && groupCall.payload.args.name === '仙侠组',
  groupCall ? JSON.stringify(groupCall.payload.args) : 'no call');

// —— ⑨ 源码守卫：另存为新的旁路与旧内联输入都不许回来 ——
check('⑨ 「另存为新」的 store 方法 / 词条 / 菜单项都已删除（不再有两套保存行为）',
  src.indexOf('store.saveAsNewToLibrary') < 0 && src.indexOf('saveAsNewToLibrary:saveAsNewToLibrary') < 0
  && src.indexOf('workshop.library.saveAs') < 0 && src.indexOf('store.savedAsNew') < 0, '');
check('⑨b 分组名的内联输入（groupDraft）已删除，重命名/建组统一走弹框',
  src.indexOf('groupDraft') < 0 && src.indexOf('function inputDialog(') > 0 && src.indexOf('window.prompt(') < 0, '');
check('⑨c 删掉分组折叠视图后，关系章节有自己的分组选择器（openRelationsFor 仍可达）',
  src.indexOf('store.openRelationsFor(v)') > 0, '');

delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
