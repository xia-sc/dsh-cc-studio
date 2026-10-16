/**
 * 提升去重之后的「界面草稿同步」回归测试（不随插件发布，files 未含 tests）。
 *
 * 背景（用户报告的第 1 条，工具半与界面半同一个坑）：`cc_promoteBook` / `cc_promote_shared_entries`
 * 删的是**库里的卡**，而界面（以及模型）手里那份**草稿**是另一个副本。提升完之后草稿里那几条
 * 重复条目还在 —— 用户接着点「保存当前」，重复就被原样写回卡里：去重白做，且全程零提示。
 *
 * 修法：提升成功后，若「这次真的被删过条目」的卡正是当前界面编辑的那张，就从界面草稿里
 * 删掉那几条（**只认内容逐字相符**），并走同一条 `cc_setDraft` 落盘路。
 * 两条硬约束由本文件钉住：① 不是当前卡时一个字节都不许动；② 共享书没读到时不猜着删。
 *
 * 运行：node tests/promote-draft-sync.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

// —— 假 React / 定时器：与 tests/relations-view.test.mjs 同一套 harness ——
const effectQueue = [];
const hooks = { slots: [], idx: 0 };
const React = {
  createElement(type, props) { return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }; },
  useState(init) {
    const i = hooks.idx++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof init === 'function' ? init() : init;
    return [hooks.slots[i], function (v) { hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v; }];
  },
  useRef(init) { const i = hooks.idx++; if (!(i in hooks.slots)) hooks.slots[i] = { current: init }; return hooks.slots[i]; },
  useCallback(fn) { return fn; },
  useEffect(fn) { effectQueue.push(fn); },
  useMemo(fn) { return fn(); },
};

// setTimeout 收集起来（不自动触发）：既能拦住 1s 轮询，又能在需要时手动 flush 出
// `updateDraft` 里那条 120ms 的落盘（cc_setDraft）—— 那正是「界面与磁盘同步」的证据。
const timers = [];
globalThis.setTimeout = function (fn) { timers.push(fn); return timers.length; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 1; };
globalThis.clearInterval = function () {};
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

// —— fixture：卡里两条，其中「共用设定」与共享书**逐字相同** ——
const GID = 'g-sync';
const SHARED = '@@position after_desc\n【共同设定】三千年前。';
const PRIVATE = '甲自己的条目。';
const sharedEntry = () => ({ name: '共用设定', keys: ['共用'], content: SHARED, enabled: true, constant: false, insertion_order: 100, case_sensitive: false, extensions: {} });
const privateEntry = () => ({ name: '甲私有', keys: ['甲'], content: PRIVATE, enabled: true, constant: false, insertion_order: 100, case_sensitive: false, extensions: {} });
const draftFixture = () => ({
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: '甲角色', description: '', character_book: { name: '甲的书', entries: [sharedEntry(), privateEntry()] } },
});

const calls = [];
let promoted = { dryRun: false, promoted: 1, removedTotal: 2, perCard: [{ id: 'c1', removed: 1, left: 1 }, { id: 'c2', removed: 1, left: 1 }] };
let bookOk = true;
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
        if (endpoint === 'cc_loadFromLibrary') return Promise.resolve({ ok: true, value: { draft: draftFixture(), meta: { groupId: GID, name: '甲角色' } } });
        if (endpoint === 'cc_promoteBook') return Promise.resolve({ ok: true, value: JSON.parse(JSON.stringify(promoted)) });
        if (endpoint === 'cc_getBook') {
          return bookOk
            ? Promise.resolve({ ok: true, value: { book: { spec: 'lorebook_v3', data: { name: '草稿同步测试组·共享设定', description: '', scan_depth: 4, token_budget: 2000, recursive_scanning: false, entries: [sharedEntry()] } }, rev: 3 } })
            : Promise.resolve({ ok: false, error: { code: 'internal', message: '读共享书失败' } });
        }
        return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
      },
    },
  },
};
const registered = {};
const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);

const store = registered['conversation.input.dock'].opts.inject('warmup').store;
const entriesOf = () => store.getSnapshot().draft.data.character_book.entries.map(e => e.name);
const flushTimers = () => { timers.splice(0).forEach(fn => { try { fn(); } catch (e) {} }); };

// ——————————————————————————————————————————————————————————————
await store.loadFromLibrary('c1');
check('① 准备：界面草稿里有 2 条（含那条与共享书逐字重复的「共用设定」）',
  entriesOf().length === 2 && store.getSnapshot().currentLibraryId === 'c1',
  JSON.stringify(entriesOf()));

await store.promoteBook(null, true);
check('② 提升后：**界面草稿同步删掉那条重复**（库里与界面不再是两个副本，各剩 1 条）',
  entriesOf().length === 1 && entriesOf()[0] === '甲私有',
  JSON.stringify(entriesOf()));

flushTimers();
const pushed = calls.filter(c => c.endpoint === 'cc_setDraft').pop();
check('③ 同步走的是同一条落盘路：cc_setDraft 推给宿主的那一份也只有 1 条',
  !!pushed && pushed.payload.args.draft.data.character_book.entries.length === 1
    && pushed.payload.args.draft.data.character_book.entries[0].name === '甲私有',
  pushed ? JSON.stringify(pushed.payload.args.draft.data.character_book.entries.map(e => e.name)) : 'no cc_setDraft');

// 反例一：这次被删的是**别人**那张卡 → 当前草稿一个字节都不许动
await store.loadFromLibrary('c1');
promoted = { dryRun: false, promoted: 1, removedTotal: 1, perCard: [{ id: 'c2', removed: 1, left: 1 }] };
await store.promoteBook(null, true);
check('④ 被删的是别人那张卡时不越界：当前草稿原样不动（2 条仍在）',
  entriesOf().length === 2,
  JSON.stringify(entriesOf()));

// 反例二：共享书没读到（state.book 为空）→ 宁可不同步，也不猜着删
promoted = { dryRun: false, promoted: 1, removedTotal: 2, perCard: [{ id: 'c1', removed: 1, left: 1 }, { id: 'c2', removed: 1, left: 1 }] };
bookOk = false;
await store.promoteBook(null, true);
check('⑤ 共享书没读到时不猜着删（宁可不同步）：草稿仍是 2 条',
  entriesOf().length === 2,
  JSON.stringify(entriesOf()));

// 反例三：预览（dryRun）本来就什么都没改
bookOk = true;
promoted = { dryRun: true, wouldPromote: 1, removedTotal: 2, perCard: [] };
await store.promoteBook(null, false);
check('⑥ 预览（dryRun）不写任何东西：草稿 2 条不变',
  entriesOf().length === 2,
  JSON.stringify(entriesOf()));

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
