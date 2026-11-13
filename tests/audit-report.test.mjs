/**
 * 体检报告回归测试（0.23.1）。
 *
 * 背景（ROADMAP 第 3 项）：问题散在七处，用户没有「这张卡健康吗」的一屏视图；
 *   0.22.0 虽然在总览里铺了分组，但只覆盖内容体检（consistency.issues），
 *   结构错误仍藏在导出弹层里当平铺字符串，两条清单各铺一份。
 *
 * 本次：一处报告 = 结构 / 时间锚定 / 设定铁律 / 未结案钩子 / 世界书 / 其他 六组，
 *   每条带一句「这样改」与「去修 →」跳章节；导出弹层只留摘要，不再平铺清单。
 *
 * 运行：node tests/audit-report.test.mjs   （全绿退出码 0）
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

// 一份「典型的坏卡」校验结果：结构 1 条 warning、内容 5 条（其中 2 条 error）
const REPORT = {
  valid: false,
  errors: ['缺 data.system_prompt（时间锚定）', '设定铁律里「沈照雪」有 2 条不同说法'],
  warnings: ['assets 中 icon/main 应恰好 1 个（缺省会自动补）', '没有设定铁律（canon）'],
  structural: { valid: true, errors: [], warnings: ['assets 中 icon/main 应恰好 1 个（缺省会自动补）'] },
  consistency: {
    issues: [
      { level: 'error', code: 'anchor-system-missing', message: '缺 data.system_prompt（时间锚定）：卡里没有时间规则', refs: ['system_prompt'] },
      { level: 'error', code: 'canon-duplicate-subject', message: '设定铁律里「沈照雪」有 2 条不同说法', refs: [] },
      { level: 'warning', code: 'canon-missing', message: '没有设定铁律（canon）：运行期事实清单为空', refs: [] },
      { level: 'warning', code: 'unsettled-hook', message: '开场里有 2 处未结案细节', refs: ['first_mes：「桌上那碗粥还热着」'] },
      { level: 'warning', code: 'no-keys', message: '条目「锁天司」缺少关键词', refs: ['锁天司'] },
    ],
    errorCount: 2, canonCount: 0, canonSource: 'none',
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

// 组标题：details > summary，第二个 child 是 i18n 组名（结构 / 时间锚定 / …）
const groupHeads = (tree) => flatten(tree)
  .filter((n) => n.type === 'summary' && n.children && n.children[1] && n.children[1].children
    && typeof n.children[1].children[0] === 'string' && n.children[1].children[0].indexOf('workshop.audit.') === 0)
  .map((n) => ({ key: n.children[1].children[0], count: String(n.children[2] && n.children[2].children[0]) }));
const textNodes = (tree) => flatten(tree).map((n) => (n.children && n.children[0]) || '').filter((x) => typeof x === 'string');

// —— 打开工坊 ——
store.setPanel(true);
render().effects.forEach((fn) => { try { fn(); } catch (e) {} });
let tree = redraw();

check('① 未校验时总览给「立即体检」入口（不是一片空白让人以为没问题）',
  textNodes(tree).indexOf('workshop.audit.notRun') >= 0, '');
check('①b 未校验时不渲染任何分组标题', groupHeads(tree).length === 0, String(groupHeads(tree).length));

// 跑一次校验（走 fake RPC 拿到上面那份 REPORT）
await store.validate();
tree = redraw();

check('② 只渲染有内容的组，顺序 = 结构 → 时间锚定 → 设定铁律 → 未结案钩子 → 世界书',
  groupHeads(tree).map((g) => g.key).join(',') === ['workshop.audit.structure', 'workshop.audit.anchor', 'workshop.audit.canon', 'workshop.audit.hook', 'workshop.audit.lore'].join(','),
  groupHeads(tree).map((g) => g.key).join(','));
check('③ 每组标题带条数（1 / 1 / 2 / 1 / 1）',
  groupHeads(tree).map((g) => g.count).join(',') === '(1),(1),(2),(1),(1)',
  groupHeads(tree).map((g) => g.count).join(','));
check('④ 结构组来自 structural.warnings（不再只藏在导出弹层里）',
  textNodes(tree).some((x) => x.indexOf('assets 中 icon/main') >= 0), '');
check('⑤ 摘要徽章：不可导出时显示「有 N 个必须修」+ 错误/提示计数',
  textNodes(tree).indexOf('workshop.audit.cannotExport') >= 0 && textNodes(tree).indexOf('workshop.audit.summary') >= 0,
  '');
check('⑥ 每条 issue 带「这样改」与对应修法文案（锚定 / canon / 钩子 / 世界书各一条）',
  textNodes(tree).some((x) => String(x).indexOf('workshop.audit.howto') >= 0)
    && ['workshop.fix.anchor-system-missing', 'workshop.fix.canon-duplicate-subject', 'workshop.fix.unsettled-hook', 'workshop.fix.no-keys']
      .every((k) => textNodes(tree).some((x) => String(x).indexOf(k) >= 0)),
  '');
check('⑦ 没找到修法映射的条目（如结构类）不硬塞一句空话',
  textNodes(tree).indexOf('workshop.fix.structural') < 0, '');

// —— 「去修 →」把当前章节切到对应位置 ——
{
  const gotoBtns = flatten(tree).filter((n) => n.type === 'button' && n.children && typeof n.children[0] === 'string' && n.children[0].indexOf('workshop.audit.goto') === 0);
  const seen = [];
  gotoBtns.forEach((b) => { b.props.onClick({}); seen.push(store.getSnapshot().cur); });
  // 组顺序：结构(1) 锚定(1) canon(2) 钩子(6) 世界书(2)
  check('⑧ 「去修 →」逐组跳到对应章节（锚定→角色 1、canon/世界书→世界书 2、钩子→开场 6）',
    seen.join(',') === '1,1,2,2,6,2', seen.join(','));
}

// —— ⑪ 切卡 / 草稿被改之后，旧体检必须作废（用户截图：切角色后仍显示上一张卡的 3 个必须修）——
{
  await store.validate();
  const rep1 = store.getSnapshot().validationReport;
  check('⑪ 体检结果带「卡 + rev」key', !!rep1 && typeof rep1.key === 'string' && rep1.key.length > 0, rep1 && rep1.key);
  // 换一张卡：status.cardId 变
  store.setDraftFromHost(store.getSnapshot().draft, { cardId: 'lib-other', rev: 7, isNew: false });
  const after = store.getSnapshot();
  check('⑪b 切卡后旧体检立刻作废（不会拿上一张卡的结论显示）',
    after.validationReport === null, String(after.validationReport));
  check('⑪c 卡版本变了，reportKey 也跟着变（新 key 与旧 key 不同）',
    store.reportKey() !== rep1.key, store.reportKey() + ' vs ' + rep1.key);
  tree = redraw();
  check('⑪d 作废后总览回到「立即体检」入口（不会停在旧分组上）',
    textNodes(tree).indexOf('workshop.audit.notRun') >= 0, '');
}

// —— 导出弹层不再铺第二份清单 ——
check('⑨ 导出弹层不再平铺 errors/warnings 字符串（同一份清单不做两份）',
  src.indexOf('v.errors.map') < 0 && src.indexOf('v.warnings.map') < 0, '');
check('⑩ 导出弹层改调 auditDigest()，并给出「详细在总览」的去处',
  src.indexOf('auditDigest()') >= 0 && src.indexOf('workshop.audit.seeOverview') >= 0, '');

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
