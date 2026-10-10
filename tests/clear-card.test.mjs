/**
 * 「清空当前角色卡」回归测试（不随插件发布，files 未含 tests）。
 *
 * 需求：工坊左侧底部「校验」下面加一枚「清空」按钮，**二次确认**后清空当前角色卡的全部内容。
 *
 * 这里钉住四条不变量（比 UI 长什么样更重要）：
 *   ① 只有确认框返回 true 才清 —— 取消 / 没有 confirm / confirm 抛错，一律字节不动；
 *   ② 清完是「空卡」：字符字段空串、数组字段空数组、Lorebook entries 空、五维世界观全空；
 *   ③ 清完**解除与已存角色的关联**（currentLibraryId=null）—— 否则接着点「保存当前」
 *      会把库里那张卡覆盖成空卡；
 *   ④ 清完照样落盘（cc_setDraft），刷新页面 / 模型侧读到的也是空卡。
 *
 * 运行：node tests/clear-card.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// —— 假 React：hook 槽位按渲染顺序保留 ——
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

// —— 定时器收集起来由测试手动触发（pushDraftToHost 是延迟调用）——
const timers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
globalThis.setTimeout = function (fn, ms) { timers.push({ fn, ms }); return timers.length; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 1; };
globalThis.clearInterval = function () {};
const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
};

// —— 装载 bundle：window 上带一个可编程的 confirm ——
let confirmAnswer = null;      // null = 没有 confirm（模拟拿不到确认框）
let confirmThrows = false;
let confirmCalls = [];
let registration = null;
globalThis.window = {
  __ModuleLoader__: { load(def) { registration = def; } },
  confirm(msg) {
    confirmCalls.push(msg);
    if (confirmThrows) throw new Error('confirm 炸了');
    return confirmAnswer === true;
  },
};
new Function('window', src)(globalThis.window);
if (!registration) { console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load'); process.exit(1); }

const calls = [];
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) { calls.push({ endpoint, payload }); return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } }); } } },
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
const buttonByKey = (tree, key) => flatten(tree).find((n) => n.type === 'button' && n.children[0] === key);
const callsOf = (endpoint) => calls.filter((c) => c.endpoint === endpoint);
function runTimers() { timers.splice(0).forEach((x) => { try { x.fn(); } catch (e) { console.log('FAIL  timer 抛错: ' + e.message); } }); }

// —— 打开工坊 ——
store.setPanel(true);
run(render().effects);
let tree = redraw();

const validateBtn = buttonByKey(tree, 'action.validate');
const clearBtn = buttonByKey(tree, 'action.clear');
check('① 底部动作区渲染出「校验」与「清空」两枚按钮', !!validateBtn && !!clearBtn,
  'validate=' + !!validateBtn + ' clear=' + !!clearBtn);
check('①b 清空按钮排在「校验」之后（用户要的位置：校验下面）',
  flatten(tree).indexOf(clearBtn) > flatten(tree).indexOf(validateBtn),
  String(flatten(tree).indexOf(clearBtn)) + ' > ' + String(flatten(tree).indexOf(validateBtn)));
check('①c 两枚按钮都阻止鼠标点击抢焦点（否则又是一圈焦点描边）',
  typeof validateBtn.props.onMouseDown === 'function' && typeof clearBtn.props.onMouseDown === 'function',
  typeof clearBtn.props.onMouseDown);

// —— 先填点内容，再验证「取消不清」「确认才清」——
store.setCur(2);
store.updateDraft((d) => {
  d.name = '测试卡';
  d.tags = ['a', 'b'];
  d.description = '描述';
  d.first_mes = '开场白';
  d.alternate_greetings = ['第二问候'];
  d.character_book.entries.push({ content: '条目' });
});
store.setWorldPatch('timeline', '年表内容');
runTimers();
calls.length = 0;
confirmCalls = [];

// ② 用户在确认框里点「取消」
confirmAnswer = false;
clearBtn.props.onClick({});
check('② 确认框返回 false → 一个字都不动（取消不清）',
  store.getSnapshot().draft.data.name === '测试卡' && store.getSnapshot().draft.data.character_book.entries.length === 1,
  store.getSnapshot().draft.data.name + ' / entries=' + store.getSnapshot().draft.data.character_book.entries.length);
check('②b 确认框拿到了确认文案键', confirmCalls.length === 1 && confirmCalls[0] === 'store.confirmClear', JSON.stringify(confirmCalls));
check('②c 取消时没有写盘', callsOf('cc_setDraft').length === 0, String(callsOf('cc_setDraft').length));

// ③ 拿不到确认框（window.confirm 缺失）→ 同样不清
const savedConfirm = globalThis.window.confirm;
delete globalThis.window.confirm;
clearBtn.props.onClick({});
check('③ 没有确认框 → 不清（安全默认，不静默清数据）',
  store.getSnapshot().draft.data.name === '测试卡', store.getSnapshot().draft.data.name);
globalThis.window.confirm = savedConfirm;

// ④ 确认框抛错 → 同样不清
confirmThrows = true;
clearBtn.props.onClick({});
check('④ 确认框抛错 → 不清', store.getSnapshot().draft.data.name === '测试卡', store.getSnapshot().draft.data.name);
confirmThrows = false;

// ⑤ 点「确定」→ 清空
confirmAnswer = true;
clearBtn.props.onClick({});
let s = store.getSnapshot();
const d = s.draft.data;
check('⑤ 字符字段清空（name / description / first_mes）',
  d.name === '' && d.description === '' && d.first_mes === '', JSON.stringify({ name: d.name, desc: d.description, first: d.first_mes }));
check('⑤b 数组字段清空（tags / greetings / 开场）',
  d.tags.length === 0 && d.alternate_greetings.length === 0 && d.group_only_greetings.length === 0,
  JSON.stringify({ tags: d.tags.length, alt: d.alternate_greetings.length, grp: d.group_only_greetings.length }));
check('⑤c Lorebook 条目清空', d.character_book.entries.length === 0, String(d.character_book.entries.length));
check('⑤d 五维世界观全空', ['timeline', 'factions', 'geo', 'power', 'daily'].every((k) => s.world[k] === ''), JSON.stringify(s.world));
check('⑤e 清空后是合法空卡骨架（spec / character_book / assets 仍在）',
  s.draft.spec === 'chara_card_v3' && s.draft.spec_version === '3.0' && !!d.character_book && Array.isArray(d.assets) && d.assets.length === 1,
  JSON.stringify({ spec: s.draft.spec, ver: s.draft.spec_version, assets: (d.assets || []).length }));
check('⑤f 校验状态回到「新建」时的默认值', s.valid.valid === true && s.valid.errors.length === 0, JSON.stringify(s.valid));
check('⑤g 大框编辑态被收起（不会有残留的编辑快照）',
  s.editingWorld === null && s.editingWorldRevert === null && s.editingText === null,
  JSON.stringify({ world: s.editingWorld, text: s.editingText }));

// ⑥ 与已存角色的关联必须解除
check('⑥ 解除与已存角色的关联（currentLibraryId=null）→ 再点「保存当前」不会把库里那张卡覆盖成空卡',
  s.currentLibraryId === null, String(s.currentLibraryId));
check('⑥b 状态栏提示「已清空」', s.lastMsg === 'store.cleared', String(s.lastMsg));
check('⑥c 当前步骤不跳（清内容不改视野）', s.cur === 2, String(s.cur));

// ⑦ 清空同样落盘
runTimers();
const pushes = callsOf('cc_setDraft');
check('⑦ 清空后写盘 cc_setDraft（刷新页面 / 模型侧读到的也是空卡）', pushes.length >= 1, String(pushes.length));
check('⑦b 推给宿主的就是空卡', pushes.length > 0 && pushes[pushes.length - 1].payload.args.draft.data.name === '',
  pushes.length > 0 ? JSON.stringify(pushes[pushes.length - 1].payload.args.draft.data.name) : 'no push');

globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
