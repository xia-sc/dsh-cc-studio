/**
 * 工坊「关系视图」渲染回归测试（不随插件发布，files 未含 tests）。
 *
 * 现象（用户截图）：组里明明有 6 个节点、18 条关系，关系视图却显示「关系 · 0」、NPC 名字区空白，
 *   而 rev 7 与「成员卡 · 4」完全正常 —— 看起来像「卡里的关系没读到」。
 * 根因：**客户端读错了返回形状**。宿主半 `cc_getGroup` 返回 `{ group, members, rev }`，
 *   节点与边在 `group` **里面**；而关系视图按工具半 `cc_get_relations` 的形状去读顶层的
 *   `s.relations.nodes` / `.edges` → 永远得到空数组。rev 在 group 里、members 在顶层，
 *   所以那两处恰好是对的，反而掩盖了错误。
 * 修法：渲染改用 `relGroup.nodes` / `relGroup.edges`（见 lib/client.js 关系视图那几行）。
 *
 * 本文件把 lib/client.js 真装进假 React harness 里渲染，并且**故意只喂宿主半真实会返回的形状**
 * （顶层没有 nodes / edges）—— 这样一旦有人再改回读顶层，断言立刻红。
 *
 * 运行：node tests/relations-view.test.mjs   （全绿退出码 0）
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

// —— 定时器全部收集起来不触发（否则 1s 的 DOM 轮询会掺进断言里）——
globalThis.setTimeout = function () { return 1; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 1; };
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

// —— 宿主半 cc_getGroup 的真实返回形状：节点与边在 group **里面** ——
const GID = 'g-lock';
const GROUP = {
  id: GID, name: '锁天司', note: '', rev: 7,
  nodes: [
    { id: 'n1', kind: 'card', cardId: 'c1', name: '谢无咎', aliases: [], orphanOf: null },
    { id: 'n2', kind: 'card', cardId: 'c2', name: '云中君', aliases: [], orphanOf: null },
    { id: 'n3', kind: 'card', cardId: 'c3', name: '白十三', aliases: [], orphanOf: null },
    { id: 'n4', kind: 'card', cardId: 'c4', name: '陆昭', aliases: [], orphanOf: null },
    { id: 'n5', kind: 'npc', cardId: null, name: '{{user}}', aliases: [], orphanOf: null },
    { id: 'n6', kind: 'npc', cardId: null, name: '第八代司主', aliases: [], orphanOf: null },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'superior', label: '', strength: 4, direction: 'one-way', note: '' },
    { id: 'e2', from: 'n2', to: 'n1', type: 'debt', label: '', strength: 5, direction: 'one-way', note: '她的名字是他给的' },
    { id: 'e3', from: 'n1', to: 'n4', type: 'mentor', label: '', strength: 4, direction: 'one-way', note: '' },
    { id: 'e4', from: 'n3', to: 'n1', type: 'other', label: '照顾', strength: 4, direction: 'one-way', note: '' },
    { id: 'e5', from: 'n2', to: 'n3', type: 'colleague', label: '', strength: 3, direction: 'mutual', note: '' },
    { id: 'e6', from: 'n6', to: 'n1', type: 'other', label: '', strength: 1, direction: 'one-way', note: '他认不出任何人' },
  ],
};
// ⚠️ 顶层**故意不放** nodes / edges —— 真实宿主返回就是这样，读顶层就是空
const FIXTURE = {
  group: GROUP,
  members: [{ id: 'c1', name: '谢无咎' }, { id: 'c2', name: '云中君' }, { id: 'c3', name: '白十三' }, { id: 'c4', name: '陆昭' }],
  rev: GROUP.rev,
};

const calls = [];
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: {
    rpc: {
      call(channel, endpoint, payload) {
        calls.push({ endpoint, payload });
        if (endpoint === 'cc_getGroup') return Promise.resolve({ ok: true, value: FIXTURE });
        return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
      },
    },
  },
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
/** 渲染树里所有字符串节点的拼接（文案断言用；t() 返回 key 本身）。 */
function textOf(tree) {
  return flatten(tree).filter((n) => typeof n.children[0] === 'string').map((n) => n.children[0]).join(' | ');
}
const texts = (tree) => flatten(tree).filter((n) => typeof n.children[0] === 'string').map((n) => n.children[0]);

// —— 打开工坊 + 切到关系视图（s.cur === 4，不在左侧导航里的视图）——
store.setPanel(true);
store.setCur(4);
store.setCurrentGroupId(GID);
await store.loadGroup(GID);
run(render().effects);
const tree = redraw();
const all = texts(tree);
const joined = textOf(tree);

check('① 关系视图真的读到了宿主返回的节点与边：标题行报出边数、成员数（曾经恒为 0）',
  all.indexOf('workshop.rel.edges · 6') >= 0 && all.indexOf('workshop.rel.members · 4') >= 0,
  all.filter((x) => String(x).indexOf('workshop.rel.edges') === 0 || String(x).indexOf('workshop.rel.members') === 0).join(' / '));
check('② 边列表渲染出每条的端点名字（用节点表查名，因为宿主返回的边只有 from/to 的 id）',
  joined.indexOf('谢无咎') >= 0 && joined.indexOf('云中君') >= 0 && joined.indexOf('陆昭') >= 0
    && all.indexOf('workshop.rel.noEdge') < 0,
  'noEdge 占位是否出现=' + (all.indexOf('workshop.rel.noEdge') >= 0));
check('③ 组织者/NPC 区列出 kind:"npc" 的节点（截图里那块是空白的）',
  joined.indexOf('第八代司主') >= 0, all.filter((x) => String(x).indexOf('{{user}}') >= 0).join(' / '));
check('④ 成员卡徽章按顶层 members 渲染（它一直是对的 —— 所以 bug 才像「只有关系没读到」）',
  all.indexOf('workshop.rel.members · 4') >= 0, '');
check('⑤ 边上不可见的字段也要出来：note 与 mutual 的对等箭头 ⇄（one-way 是 →）',
  joined.indexOf('她的名字是他给的') >= 0 && joined.indexOf('他认不出任何人') >= 0 && joined.indexOf('⇄') >= 0 && joined.indexOf('→') >= 0,
  '');
// 0.9.0：类型/强度/方向三个内联下拉挪进了二级弹窗 —— 列表回到「一行只读 + 一枚编辑」的形态
const inlineSelects = flatten(tree).filter((n) => n.type === 'select').length;
const editBtns = flatten(tree).filter((n) => n.type === 'button' && n.children[0] === 'workshop.rel.edit').length;
check('⑥ 关系列表是只读一行 + 每行一枚「编辑」（不再有 3×N 个内联下拉，那正是把整页占满的东西）',
  inlineSelects === 0 && editBtns === 6, JSON.stringify({ selects: inlineSelects, editBtns: editBtns }));
const addBtn = flatten(tree).filter((n) => n.type === 'button' && n.children[0] === 'workshop.rel.add')[0];
if (addBtn) addBtn.props.onClick({});
const selCounts = flatten(redraw()).filter((n) => n.type === 'select')
  .map((sel) => flatten(sel).filter((c) => c && c.type === 'option').length);
check('⑥b 点「＋ 添加关系」开弹窗后，从/到两个下拉各列出全部 6 个节点（默认已选好当前卡 → 对方）',
  selCounts.filter((n) => n === 6).length === 2, JSON.stringify(selCounts));
check('⑦ 数据层与渲染同源：store 里就是宿主那一份（group.nodes / group.edges），不是另存的副本',
  (() => {
    const rel = store.getSnapshot().relations;
    return rel && rel.group && rel.group.nodes.length === 6 && rel.group.edges.length === 6;
  })(),
  JSON.stringify((() => { const r = store.getSnapshot().relations; return r && r.group ? { n: r.group.nodes.length, e: r.group.edges.length } : r; })()));

// —— 反向钉子：顶层放 nodes/edges 而 group 里没有时，界面必须**不**认（说明它读的是唯一真源）——
{
  const bad = { group: { id: 'g2', name: '空组', rev: 1, nodes: [], edges: [] }, nodes: GROUP.nodes, edges: GROUP.edges, members: [], rev: 1 };
  const orig = fakeCtx.connection.rpc.call;
  fakeCtx.connection.rpc.call = (ch, ep, pl) => (ep === 'cc_getGroup' ? Promise.resolve({ ok: true, value: bad }) : orig(ch, ep, pl));
  store.setCurrentGroupId('g2');
  await store.loadGroup('g2');
  const tree2 = redraw();
  const all2 = texts(tree2);
  fakeCtx.connection.rpc.call = orig;
  check('⑧ 反向钉子：只有顶层有 nodes/edges（group 里是空）时界面显示 0 —— 渲染只认 group 这一个真源',
    all2.indexOf('workshop.rel.edges · 0') >= 0 && all2.indexOf('workshop.rel.noEdge') >= 0,
    all2.filter((x) => String(x).indexOf('workshop.rel.edges') === 0).join(' / '));
}

// —— 0.9.0 共享世界书视图（宿主端点给的是**原始文档** book.data.*，界面必须照着读）——
const BOOK_FIXTURE = {
  exists: true, groupId: GID, rev: 3, tokens: 420,
  book: { spec: 'lorebook_v3', data: {
    name: '锁天司·共享设定', description: '', scan_depth: 4, token_budget: 2400, recursive_scanning: false,
    entries: [
      { keys: ['年表'], content: '【三千年前】天门开。', name: '年表', constant: false, enabled: true },
      { keys: ['锁道'], content: '锁天司以命数封裂。', name: '力量体系', constant: true, enabled: true },
    ],
  } },
  cards: [{ id: 'c1', name: '谢无咎', entries: 3 }],
  scan: {
    candidates: [{ signature: 'sig-yb', name: '年表', cardNames: ['谢无咎', '云中君'], cards: 2, chars: 120, savedChars: 120, nameMismatch: false, keysMismatch: false, preview: '【三千年前】天门开。' }],
    bookDupes: [{ kind: 'card-vs-book', signature: 'sig-sf', name: '势力', cardNames: ['谢无咎'], cards: 1, chars: 90, savedChars: 90, preview: '锁天司四职。' }],
    stats: { cards: 4, totalEntries: 20, duplicatedEntries: 8, savedChars: 4500, bookDuplicatedEntries: 1, bookDupeCount: 1, bookSavedChars: 90 },
  },
};
{
  const orig = fakeCtx.connection.rpc.call;
  fakeCtx.connection.rpc.call = (ch, ep, pl) => {
    if (ep === 'cc_getBook') return Promise.resolve({ ok: true, value: BOOK_FIXTURE });
    if (ep === 'cc_listGroups') return Promise.resolve({ ok: true, value: { groups: [{ id: GID, name: '锁天司', memberCount: 4, hasBook: true, bookEntries: 2 }] } });
    return orig(ch, ep, pl);
  };
  store.setCur(7);
  await store.loadBook(GID);
  const tree7 = redraw();
  const all7 = texts(tree7);
  const joined7 = all7.join(' | ');
  check('⑨ 共享世界书视图渲染出书名 / 条目数 / 条目预览（读的是端点给的 book.data.*，不是扁平字段）',
    joined7.indexOf('锁天司·共享设定') >= 0
      || flatten(tree7).some((n) => n.type === 'input' && n.props.defaultValue === '锁天司·共享设定'),
    all7.filter((x) => String(x).indexOf('book.') === 0).join(' / '));
  check('⑨b 条目数 / rev / 条目名与预览都渲染出来（书级参数走 defaultValue，条目走 children）',
    all7.indexOf('book.entries') >= 0 && all7.indexOf('rev 3') >= 0
      && joined7.indexOf('年表') >= 0 && joined7.indexOf('【三千年前】天门开。') >= 0,
    JSON.stringify(all7.filter((x) => String(x).indexOf('book.') === 0 || x === '年表').slice(0, 6)));
  check('⑩ 重复条目区渲染出候选与「可省 N 字符」（那正是要去重的东西）',
    all7.indexOf('book.dupTitle') >= 0 && all7.indexOf('book.dupItem') >= 0 && joined7.indexOf('年表') >= 0,
    '');
  // 第二轮报告 P1：第二类重复（卡内条目与共享书逐字相同 —— `cc_apply_shared_book` 回填的副本）也要在界面上说出来
  check('⑩b 「卡 ↔ 共享书」那一类重复也渲染出来（回填过的卡会静默双份插入）',
    all7.indexOf('book.dupBook') >= 0,
    JSON.stringify(all7.filter((x) => String(x).indexOf('book.dup') === 0)));
  // 总览：四条进度行 + 三态点（写作全交给 LLM 之后，这是工坊的主入口）
  store.setCur(5);
  const all5 = texts(redraw());
  const rows = all5.filter((x) => ['step.char', 'step.world', 'step.lore', 'step.greetings'].indexOf(x) >= 0);
  check('⑪ 总览视图：四条进度行渲染出来，并带三态点（✓/◐/○）与计数',
    rows.length >= 4 && all5.some((x) => ['✓', '◐', '○'].indexOf(x) >= 0) && all5.indexOf('step.overview.desc') >= 0,
    JSON.stringify({ rows: rows.length, dots: all5.filter((x) => ['✓', '◐', '○'].indexOf(x) >= 0) }));
  // ⚠️ 0.8.2 实机事故：导出页读了 `bk.book.entries`（真实形状是 `bk.book.data.entries`）→ 渲染期
  // TypeError → 工坊闪退、dsh 卡死。所以把**所有视图**在「已载入卡 + 当前组有共享书」的状态下各渲染
  // 一遍：任何视图在渲染期抛错都算失败（这类崩溃不是「某个页面没显示」，是整个工坊挂掉）。
  const viewRuns = [0, 1, 2, 3, 4, 5, 6, 7].map((cur) => {
    store.setCur(cur);
    try { redraw(); return { cur: cur, ok: true }; }
    catch (e) { return { cur: cur, ok: false, err: String((e && e.message) || e) }; }
  });
  check('⑬ 8 个视图在「已载入卡 + 有共享书」时都能渲染（渲染期抛错会让整个工坊闪退甚至卡死 dsh）',
    viewRuns.every((v) => v.ok),
    viewRuns.filter((v) => !v.ok).map((v) => 'cur=' + v.cur + ': ' + v.err).join(' | '));
  fakeCtx.connection.rpc.call = orig;
}
// 实机反馈：右侧载入另一张卡之后，「人物关系」还停在上张卡的组里 —— 必须再点一次那个组的
// 「关系」按钮才会切过去，非常费解。关系视图与共享世界书都是**按组**看的，所以「换卡」必须带着组换。
{
  const called = [];
  const orig = fakeCtx.connection.rpc.call;
  fakeCtx.connection.rpc.call = (ch, ep, pl) => {
    called.push(ep);
    if (ep === 'cc_loadFromLibrary') {
      return Promise.resolve({ ok: true, value: {
        draft: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '陆昭', character_book: { entries: [] } } },
        meta: { name: '陆昭', groupId: GID, loreCount: 8 },
      } });
    }
    return orig(ch, ep, pl);
  };
  store.setCurrentGroupId('');
  await store.loadFromLibrary('c4');
  const snap = store.getSnapshot();
  check('⑫ 载入一张卡会**跟着切到它所属的分组**（关系视图/共享书都按组看，不许停留在上张卡的组）',
    snap.currentGroupId === GID && called.indexOf('cc_getGroup') >= 0,
    JSON.stringify({ gid: snap.currentGroupId, called: called.filter((x, i) => called.indexOf(x) === i) }));
  fakeCtx.connection.rpc.call = orig;
}

// —— 0.10.0 体检清单：按 error / warn 分组渲染，每条挂一个「检查类别」——
// 旧行为是把 issues 拼成一行 lastMsg；加上跨卡一致性检查后一次可能十来条，一行糊成一片。
// 这里同样只喂**宿主真实会返回的形状**（跟拍宿主 cc_groupCheck 的返回）。
{
  const orig = fakeCtx.connection.rpc.call;
  const CHECK_FIXTURE = {
    groupId: GID, rev: 7, name: '锁天司',
    issues: [
      { check: 'structure', level: 'error', code: 'duplicate-name', message: '1 组名字/别名落在多个节点上（渲染会指向同一个人）：甲', refs: [] },
      { check: 'cross-card', level: 'warn', code: 'cross-card-duplicate-keys', message: '1 个触发词被多张卡/共享书共用（群聊时一句话会同时把它们带进上下文）：锁道', refs: ['锁道'] },
      { check: 'lore-quality', level: 'warn', code: 'no-keys', message: '1 条非 constant 条目没有 keys（永远触发不了）', refs: [] },
    ],
    stats: { nodes: 6, edges: 6, members: 4, constantTokens: { card: 0, shared: 0, total: 0 }, minBudget: 1200 },
    checks: ['structure', 'relations', 'budget', 'lore-quality', 'cross-card'],
    byCheck: { structure: 1, relations: 0, budget: 0, 'lore-quality': 1, 'cross-card': 1 },
    errorCount: 1, warningCount: 2,
  };
  fakeCtx.connection.rpc.call = (ch, ep, pl) => {
    if (ep === 'cc_groupCheck') return Promise.resolve({ ok: true, value: CHECK_FIXTURE });
    if (ep === 'cc_getGroup') return Promise.resolve({ ok: true, value: FIXTURE });
    return orig(ch, ep, pl);
  };
  store.setCurrentGroupId(GID);
  store.setCur(4);
  await store.loadGroup(GID);
  await store.checkGroupNow();
  const tree = redraw();
  const all = texts(tree);
  const joined = all.join(' | ');
  check('⑭ 体检清单渲染：分组标题用 workshop.rel.checkStats（旧的一行拼接装不下十几个问题）',
    all.indexOf('workshop.rel.checkStats') >= 0 && all.indexOf('workshop.rel.checkResult') >= 0,
    JSON.stringify(all.filter((x) => String(x).indexOf('workshop.rel.check') === 0)));
  check('⑭b 每条 issue 的 message 与「检查类别」都渲染出来（类别挂在 badge 上，用户能看出是哪一类问题）',
    joined.indexOf('1 组名字/别名落在多个节点上') >= 0 && joined.indexOf('锁道') >= 0
      && all.indexOf('structure') >= 0 && all.indexOf('cross-card') >= 0 && all.indexOf('lore-quality') >= 0,
    JSON.stringify(all.filter((x) => ['structure', 'cross-card', 'lore-quality'].indexOf(x) >= 0)));
  check('⑭c issues / byCheck 存进 store —— 界面只显示宿主返回的清单，客户端不自己统计',
    (() => { const s = store.getSnapshot(); return Array.isArray(s.relIssues) && s.relIssues.length === 3 && s.relByCheck['cross-card'] === 1; })(),
    JSON.stringify(store.getSnapshot().relByCheck));
  fakeCtx.connection.rpc.call = orig;
  await store.loadGroup(GID);
  check('⑭d 重新载入分组后清单清空（上一次的体检结果不许跟着新组显示）',
    texts(redraw()).indexOf('workshop.rel.checkStats') < 0 && store.getSnapshot().relIssues === null, '');
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
