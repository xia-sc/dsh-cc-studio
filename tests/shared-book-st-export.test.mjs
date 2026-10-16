/**
 * 共享世界书 → SillyTavern 世界书（导出）回归测试（不随插件发布，files 未含 tests）。
 *
 * 现象（用户实机）：把工坊导出的共享书拖进本地 SillyTavern 的「世界信息 → 导入」，报
 *   Error importing world info: Error: Failed to import world info: Bad Request
 *
 * 根因（对着本地 SillyTavern 1.19.0 源码 + 实测复现）：
 *   ① 服务端 `src/endpoints/worldinfo.js` 的 `/api/worldinfo/import` 拿到文件后第一句就是
 *        if (!('entries' in worldContent)) throw new Error('File must contain a world info entries list')
 *      —— 顶层没有 `entries` 一律 **400**（实测：把 `~/.dsh/cc-books/<id>.json` 原样 POST 上去，
 *      返回 `400 Is not a valid world info file`，也没有落盘）。而 CCv3 独立 lorebook 的顶层是
 *      `{spec:"lorebook_v3", data}` —— 于是 100% 撞这一枪。
 *   ② 客户端 `public/scripts/world-info.js` 的 `importWorldInfo()` 只转 Novel / Agnai / Risu 三种；
 *      整份文件里**搜不到 `lorebook_v3`** —— ST 根本不认这个规范，不是「换个后缀」能解决的。
 *   ③ 而且 ST 的 `parseDecorators()` 只认 `@@activate` / `@@dont_activate`（KNOWN_DECORATORS），
 *      其余 `@@` 行会被它**连同正文一起丢掉**（从第一个非 `@@` 行开始截取正文）—— 不翻译的话，
 *      autoLorebook 生成的 `@@position` / `@@depth` 会静默消失、5 条全落在默认插入位置。
 *
 * 本次（0.9.1）：新增「SillyTavern 世界书」导出（`{entries:{"<uid>":{…}}}`），条目字段按 ST 自己的
 * `convertCharacterBook()` 映射，`@@position` / `@@depth` 翻译成 ST 的 position / depth 并从正文删掉
 * （`@@activate` 原样留给 ST —— 它本来就有这个语义）。CCv3 那份**保持不变**（各有各的读者）。
 *
 * 运行：node tests/shared-book-st-export.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
// 工具半也要看：共享书相关提示里必须点名「SillyTavern 要用哪一份」（下面是 URL 被替换前先读好）
const agentSrc = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

const zhSrc = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
const enSrc = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
const hasKey = (hay, key) => hay.indexOf('"' + key + '":') >= 0;
const zhVal = (key) => {
  const m = new RegExp('"' + key.replace(/\./g, '\\.') + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(zhSrc);
  return m ? m[1] : null;
};

// —— 假 document / Blob / URL：导出走 a.click()，要能看到「下载了什么、叫什么名字」 ——
const downloads = [];
let lastBlob = null;
globalThis.document = {
  createElement(tag) {
    const el = {
      tag,
      _href: '',
      download: '',
      set href(v) { el._href = v; },
      get href() { return el._href; },
      click() { downloads.push({ tag, download: el.download, blob: lastBlob }); },
    };
    return el;
  },
};
globalThis.Blob = function Blob(parts, opts) { this.parts = parts; this.type = opts && opts.type; };
globalThis.URL = { createObjectURL(b) { lastBlob = b; return 'blob:test'; }, revokeObjectURL() {} };

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

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
globalThis.setTimeout = function () { return 0; };
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

// —— 共享书样本：照用户那本「锁天司·共享设定」的形状（autoLorebook 的 5 条 + 1 条手工条目）——
const BOOK_ENTRIES = [
  {
    keys: ['天门开', '三千年前', '年表', 'timeline'],
    content: '@@position after_desc\n【三千年前·天门开】天裂初现。',
    enabled: true, insertion_order: 0, case_sensitive: false, use_regex: false, constant: false,
    name: '年表', priority: 10, id: 1792051448665, cc_auto: true,
    extensions: { cc_auto: true, cc_world_ref: 'timeline' },
  },
  {
    keys: ['锁天司', '司主印', '势力', 'faction'],
    content: '@@depth 4\n锁天司（本司）：隐于九霄城地底。',
    enabled: true, insertion_order: 1, constant: false,
    name: '势力', priority: 9, id: 1792051453403, cc_auto: true,
    extensions: { cc_auto: true, cc_world_ref: 'factions' },
  },
  {
    keys: ['九霄城', '地理', 'geography'],
    content: '@@position scenario\n九霄城：一千年前沉入地底的旧边城。',
    enabled: true, insertion_order: 2, constant: false,
    name: '地理', priority: 8, id: 1792051452699, cc_auto: true,
    extensions: { cc_auto: true, cc_world_ref: 'geo' },
  },
  {
    keys: ['锁道', '力量体系', 'power'],
    content: '@@activate\n【锁道】以人之所有为一「锁」。',
    enabled: true, insertion_order: 3, constant: true,
    name: '力量体系', priority: 9, id: 1792051448094, cc_auto: true,
    extensions: { cc_auto: true, cc_world_ref: 'power' },
  },
  {
    keys: ['钟惊', '日常', 'daily'],
    content: '@@depth 5\n【司中作息】地底没有昼夜，以「钟惊」为号。',
    enabled: true, insertion_order: 4, constant: false,
    name: '日常', priority: 7, id: 1792051448917, cc_auto: true,
    extensions: { cc_auto: true, cc_world_ref: 'daily' },
  },
  // 手工条目：没有 id（uid 要退回下标）、旧式 position 枚举、未知装饰器、被禁用、有 secondary_keys
  {
    keys: ['断刃井'],
    secondary_keys: ['井'],
    content: '@@weird_thing\n井里都是旧剑。',
    enabled: false, insertion_order: 5, constant: false, selective: true,
    position: 'before_char', name: '断刃井', priority: 5,
  },
];
const BOOK = {
  spec: 'lorebook_v3',
  data: {
    name: '锁天司·共享设定',
    description: '四卡共用',
    scan_depth: 4,
    token_budget: 2000,
    recursive_scanning: false,
    entries: BOOK_ENTRIES,
    extensions: { cc: { groupId: 'g1', rev: 13 } },
  },
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
    if (endpoint === 'cc_getBook') return Promise.resolve({ ok: true, value: { exists: true, groupId: 'g1', book: BOOK, rev: 13, tokens: 1234, cards: [], scan: { candidates: [], bookDupes: [] } } });
    if (endpoint === 'cc_getGroup') return Promise.resolve({ ok: true, value: { group: { id: 'g1', name: '锁天司', nodes: [], edges: [] }, members: [], rev: 1 } });
    if (endpoint === 'cc_listGroups') return Promise.resolve({ ok: true, value: { groups: [{ id: 'g1', name: '锁天司', members: 4 }] } });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: [] } });
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

function render() {
  hooks.idx = 0;
  effectQueue.length = 0;
  const tree = overlay.comp({ store, t: (k) => k });
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
const texts = (tree, label) => flatten(tree).filter((n) => n.children && n.children[0] === label);

// —— 打开工坊 + 选中分组（setCurrentGroupId 会顺带 loadBook）——
store.setPanel(true);
run(render().effects);
await tick();
// 选中分组（setCurrentGroupId 会顺带 loadGroup + loadBook）
store.setCurrentGroupId('g1');
await tick();
await tick();
let tree = redraw();

// —— 断言用的辅助 ——
const lastDownload = () => downloads[downloads.length - 1];
const stJson = () => JSON.parse(String(lastDownload().blob.parts.join('')));
const byUid = (o, uid) => o.entries[String(uid)];
/** ST 服务端 `/api/worldinfo/import` 的判据（逐字照抄 src/endpoints/worldinfo.js:114-121）。 */
function stImportGate(worldContent) {
  if (!('entries' in worldContent)) throw new Error('File must contain a world info entry list');
}
const ST_TEMPLATE_KEYS = ['key', 'keysecondary', 'comment', 'content', 'constant', 'vectorized', 'selective', 'selectiveLogic',
  'addMemo', 'order', 'position', 'disable', 'ignoreBudget', 'excludeRecursion', 'preventRecursion', 'matchPersonaDescription',
  'matchCharacterDescription', 'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes',
  'delayUntilRecursion', 'probability', 'useProbability', 'depth', 'outletName', 'group', 'groupOverride', 'groupWeight',
  'scanDepth', 'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId', 'role', 'sticky', 'cooldown', 'delay', 'triggers'];

// ① 两处入口都渲染出新按钮（共享世界书页 cur=7 / 导出页 cur=3）
store.setCur(7);
tree = redraw();
const stBtnBookPage = byLabel(tree, 'export.book.buttonSt');
check('① 共享世界书页渲染出「SillyTavern 世界书」按钮（与 CCv3 那枚并列，各 1 枚）',
  stBtnBookPage.length === 1 && byLabel(tree, 'export.book.button').length === 1,
  'st=' + stBtnBookPage.length + ' ccv3=' + byLabel(tree, 'export.book.button').length);
store.setCur(3);
tree = redraw();
const stBtnExportPage = byLabel(tree, 'export.book.buttonSt');
check('①b 导出页的共享书块同样有这一枚（同一个实现，两处入口）',
  stBtnExportPage.length === 1 && byLabel(tree, 'export.book.button').length === 1,
  'st=' + stBtnExportPage.length + ' ccv3=' + byLabel(tree, 'export.book.button').length);

// ② 点它 → 真的下载，且文件名 = 书名（ST 用上传文件名当世界名）
const dl0 = downloads.length;
stBtnExportPage[0].props.onClick({});
check('② 点它触发下载并回报 book.exportedSt（不是静默失败）',
  downloads.length === dl0 + 1 && String(store.getSnapshot().lastMsg).indexOf('book.exportedSt') === 0,
  'downloads+' + (downloads.length - dl0) + ' lastMsg=' + String(store.getSnapshot().lastMsg));
check('②b 文件名 = 书名 + .json（ST 拿文件名建世界，不能再挂 .lorebook）',
  lastDownload().download === '锁天司·共享设定.json', lastDownload().download);

const out = stJson();

// ③ 顶层形状：这是 ST 400 的那一枪
let gateOk = true, gateErr = '';
try { stImportGate(out); } catch (e) { gateOk = false; gateErr = e.message; }
check('③ 顶层带 entries（ST 服务端那句 !(\'entries\' in worldContent) 不再触发）', gateOk, gateErr);
check('③b 顶层**没有** spec / data（CCv3 的壳必须去掉，否则 ST 连门都进不去）',
  !('spec' in out) && !('data' in out), Object.keys(out).join(','));
check('③c entries 是「uid → 条目」的对象（ST 的 world 就是这个形状）',
  out.entries && typeof out.entries === 'object' && !Array.isArray(out.entries) && Object.keys(out.entries).length === BOOK_ENTRIES.length,
  'keys=' + Object.keys(out.entries || {}).length);
check('③d 插件自己的状态不外带（data.extensions.cc 是插件状态，不进 ST 文件）',
  JSON.stringify(out).indexOf('"cc":{') < 0 && JSON.stringify(out).indexOf('lastPromote') < 0, '');

// ④ 字段映射：逐条对照 ST 自己的 convertCharacterBook()
const st = byUid(out, 1792051448665);
check('④ key ← keys（数组原样）', JSON.stringify(st.key) === JSON.stringify(BOOK_ENTRIES[0].keys), JSON.stringify(st.key));
check('④b comment ← name（ST 编辑器显示的条目名）+ addMemo=true', st.comment === '年表' && st.addMemo === true, st.comment + '/' + st.addMemo);
check('④c order ← insertion_order、uid ← id、displayIndex ← 下标', st.order === 0 && st.uid === 1792051448665 && st.displayIndex === 0,
  'order=' + st.order + ' uid=' + st.uid + ' displayIndex=' + st.displayIndex);
check('④d disable ← !enabled；enabled:false 的手工条目必须搬成 disable:true',
  byUid(out, 5).disable === true && st.disable === false, 'hand=' + byUid(out, 5).disable + ' auto=' + st.disable);
check('④e extensions 原样带过（cc_auto / cc_world_ref 都在，ST 条目本来就有这个自由字段）',
  st.extensions && st.extensions.cc_auto === true && st.extensions.cc_world_ref === 'timeline', JSON.stringify(st.extensions));
const manual = byUid(out, 5);
check('④f 没有 id 的条目用下标当 uid（不出现 "undefined" 键）',
  !('undefined' in out.entries) && manual.uid === 5, Object.keys(out.entries).join(','));
check('④g secondary_keys → keysecondary（ST 用它做 selective 二级触发）',
  JSON.stringify(manual.keysecondary) === JSON.stringify(['井']) && manual.selective === true, JSON.stringify(manual.keysecondary));
check('④h position:"before_char" → ST position 0（无装饰器时走 ST convertCharacterBook 的枚举判据）',
  manual.position === 0, String(manual.position));

// ⑤ 装饰器：ST 认不出的两类必须翻译成字段，并从正文里删掉
check('⑤ @@position after_desc → position 1（after char），正文里不再有该行',
  st.position === 1 && st.content.indexOf('@@') < 0 && st.content.indexOf('【三千年前·天门开】') === 0,
  'position=' + st.position + ' content=' + JSON.stringify(st.content.slice(0, 24)));
const factions = byUid(out, 1792051453403);
check('⑤b @@depth 4 → position 4（atDepth）+ depth 4，正文里不再有该行',
  factions.position === 4 && factions.depth === 4 && factions.content.indexOf('@@') < 0,
  'position=' + factions.position + ' depth=' + factions.depth);
const daily = byUid(out, 1792051448917);
check('⑤c @@depth 5 → depth 5（不是照抄默认 4）', daily.depth === 5 && daily.position === 4, 'depth=' + daily.depth);
const geo = byUid(out, 1792051452699);
check('⑤d @@position scenario → position 1（ST 没有 scenario 这个插入点，跟它自己的回退：非 before_char 一律 after）',
  geo.position === 1, String(geo.position));
const power = byUid(out, 1792051448094);
check('⑤e @@activate 原样留给 ST（它自己就有这个装饰器），constant 照 CCv3 的字段走',
  power.content.indexOf('@@activate') === 0 && power.constant === true, JSON.stringify(power.content.slice(0, 16)));
check('⑤f 未知装饰器不猜、不删（ST 自己会丢掉这类行；删它反而是替用户做决定）',
  manual.content.indexOf('@@weird_thing') === 0, JSON.stringify(manual.content.slice(0, 20)));
check('⑤g 只有 position/depth 两类被翻译：正文里剩下的 @@ 行只有 @@activate / 未知装饰器',
  Object.keys(out.entries).every((k) => {
    const c = out.entries[k].content;
    return c.indexOf('@@position') < 0 && c.indexOf('@@depth') < 0;
  }), '');

// ⑥ 每条都带齐 ST 的模板字段（缺字段 → ST 编辑器读到 undefined）
const missing = [];
Object.keys(out.entries).forEach((k) => {
  const keys = Object.keys(out.entries[k]);
  ST_TEMPLATE_KEYS.forEach((f) => { if (keys.indexOf(f) < 0) missing.push(k + '.' + f); });
  if (keys.indexOf('uid') < 0) missing.push(k + '.uid');
});
check('⑥ 每条都带齐 ST 的 newWorldInfoEntryTemplate 字段（uid 除外全在）', missing.length === 0, missing.slice(0, 6).join(', '));
check('⑥b 没有 undefined 泄漏（JSON 往返后逐字相等，与工具半的 lossless-JSON 家规一致）',
  JSON.stringify(JSON.parse(JSON.stringify(out))) === JSON.stringify(out), '');
check('⑥c key/keysecondary 一律是数组、comment/content 一律是字符串（类型不随源数据漂）',
  Object.keys(out.entries).every((k) => {
    const e = out.entries[k];
    return Array.isArray(e.key) && Array.isArray(e.keysecondary) && typeof e.comment === 'string' && typeof e.content === 'string';
  }), '');

// ⑦ CCv3 那份没被改坏（两枚按钮各有各的读者，不许「顺手合并」）
const dl1 = downloads.length;
byLabel(tree, 'export.book.button')[0].props.onClick({});
const ccv3 = stJson();
check('⑦ 另一枚按钮仍然导出 CCv3 独立世界书（spec: lorebook_v3 + data）',
  downloads.length === dl1 + 1 && ccv3.spec === 'lorebook_v3' && ccv3.data && Array.isArray(ccv3.data.entries) && ccv3.data.entries.length === BOOK_ENTRIES.length,
  'spec=' + ccv3.spec + ' entries=' + ((ccv3.data && ccv3.data.entries) || []).length);
check('⑦b 两份文件互不嵌套：CCv3 那份没有顶层 entries（它就该被 ST 判 400，这是规范差异不是 bug）',
  !('entries' in ccv3), Object.keys(ccv3).join(','));
check('⑦c 导出文件名各就各位（.lorebook.json 给 CCv3 客户端，<书名>.json 给 ST）',
  downloads[dl1].download === '锁天司·共享设定.lorebook.json', downloads[dl1].download);

// ⑧ 共享世界书页那枚按钮走同一条路（不是两套实现）
const dl2 = downloads.length;
store.setCur(7);
tree = redraw();
byLabel(tree, 'export.book.buttonSt')[0].props.onClick({});
check('⑧ 共享书页那枚点下去产出**同一份**文件（一次实现、两个入口）',
  downloads.length === dl2 + 1 && JSON.stringify(stJson()) === JSON.stringify(out) && lastDownload().download === '锁天司·共享设定.json',
  lastDownload().download);

// ⑨ 词表与说明：zh/en 都要有，且用户看得懂「为什么要挑格式」
check('⑨ 新键 export.book.buttonSt / book.exportedSt 在 zh 与 en 都在',
  hasKey(zhSrc, 'export.book.buttonSt') && hasKey(enSrc, 'export.book.buttonSt')
  && hasKey(zhSrc, 'book.exportedSt') && hasKey(enSrc, 'book.exportedSt'), '');
check('⑨b 两语言的按钮文案不是同一串（没漏翻译）',
  zhVal('export.book.buttonSt') !== null && zhVal('export.book.buttonSt') !== zhVal('export.book.button'),
  String(zhVal('export.book.buttonSt')) + ' / ' + String(zhVal('export.book.button')));
check('⑨c 提示文案点明了「ST 的导入接口只认 {entries:…}，直接拖 CCv3 会 Bad Request」',
  String(zhVal('export.book.hint')).indexOf('Bad Request') >= 0 && String(zhVal('book.hint')).indexOf('SillyTavern') >= 0,
  String(zhVal('export.book.hint')).slice(0, 40));
check('⑨d 工具侧提示也同步了（cc_validate 的共享书警告点名 SillyTavern 要用哪一份）',
  agentSrc.indexOf('SillyTavern 必须拿') > 0 && agentSrc.indexOf('cc_get_shared_book') > 0, '');

// ⑩ store 暴露了新动作（不是只加了个按钮壳子）
check('⑩ store 暴露 exportBookStFile', typeof store.exportBookStFile === 'function', typeof store.exportBookStFile);
check('⑩b 转换不依赖 RPC（点按钮时不该再发一次请求；数据本来就在手里）',
  calls.filter((c) => c.endpoint === 'cc_getBook').length === 1, calls.map((c) => c.endpoint).join(','));

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
