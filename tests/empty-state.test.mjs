/**
 * 0.25.2：空草稿时的空状态引导。
 *
 * 背景（用户截图）：没有载入角色、模型也还没写的时候，总览直接铺「校验未通过 / 4 个必须修 /
 * 结构·时间锚定·设定铁律」的一屏报错 —— 用户什么都没做就看到一屏红字，只会以为插件坏了。
 *
 * 修法：`draftHasContent(s.draft)` 为假且不在预览时，总览渲染空状态卡片：
 * 让模型开始写 / 导入 JSON·PNG·CHARX / 看已存角色 三个入口，不渲染体检报告。
 *
 * 运行：node tests/empty-state.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient, readRepo } from './harness.mjs';

const src = readRepo('lib/client.js');

// —— ① 源码守卫 ——
check('① 空状态卡片函数存在，且总览按「草稿是否有内容」分流',
  src.includes('function overviewEmptyCard()') && /emptyDraft = !draftHasContent\(s\.draft\) && !s\.preview/.test(src), '');
check('①b 空草稿时不渲染体检（分支在 auditReport 之前）',
  /secs\[5\]=emptyDraft \? overviewEmptyCard\(\) : h\("div",null,/.test(src), '');
check('①c 三个入口都接线：让模型开始 / 导入 / 看库',
  /store\.promptModel\(t\("workshop\.empty\.startPrompt"\)\)/.test(src)
  && /store\.importAny\(\); \}\}, t\("workshop\.empty\.import"\)/.test(src)
  && /store\.toggleLibraryCollapsed\(\); \}\}, t\("workshop\.empty\.library"\)/.test(src), '');
check('①d 非 CC 模式 / 无会话时「让模型开始写」禁用并给出原因',
  /canPrompt = !!\(s\.isCcMode && s\.currentSessionId\)/.test(src)
  && /title: canPrompt \? "" : t\("workshop\.empty\.startDisabled"\)/.test(src), '');
check('①e 中英文案齐全（8 个键各两份）',
  ['workshop.empty.title', 'workshop.empty.hint', 'workshop.empty.start', 'workshop.empty.startPrompt',
    'workshop.empty.startDisabled', 'workshop.empty.import', 'workshop.empty.library', 'workshop.empty.hint2']
    .every((k) => (src.match(new RegExp(`"${k.replace(/\./g, '\\.')}"`, 'g')) || []).length >= 2), '');

// —— ② 行为：空草稿渲染空状态、有内容渲染体检 ——
const { registration, React, hooks, effectQueue } = loadClient({ timers: 'drop', windowExtra: { confirm: () => true } });
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) {} return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call() { return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } }); } } },
};
const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);
const overlay = registered['shell.overlay'];
const store = registered['conversation.input.dock'].opts.inject('warmup').store;
const t = (k) => k;
const flatten = (node, out) => {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
};
const texts = (tree) => flatten(tree).map((n) => (n.children && n.children[0]) || '').filter((x) => typeof x === 'string');
const has = (tree, key) => texts(tree).includes(key);

// 与 client.js 的 makeDraft 同形的空卡（渲染整棵工坊需要 character_book 等字段齐全）
const emptyCard = () => ({
  spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    system_prompt: '', post_history_instructions: '', creator: '', creator_notes: '',
    tags: [], alternate_greetings: [], group_only_greetings: [], extensions: {},
    character_book: { name: '', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {}, entries: [] },
  },
});
const filledCard = () => {
  const c = emptyCard();
  c.data.name = '有内容的卡';
  c.data.description = '设定';
  return c;
};

store.setPanel(true);
// 每次渲染都清空 hook 槽位：useStoreSnapshot 用 useState 缓存快照，只重置 idx 会读到上一次的旧快照。
const resetHooks = () => { hooks.slots.length = 0; hooks.idx = 0; };
store.setDraftFromHost(emptyCard());
resetHooks();
const emptyTree = overlay.comp({ store, t });
check('② 空草稿：渲染空状态标题', has(emptyTree, 'workshop.empty.title'), '');
check('②b 空草稿：三个入口按钮都在',
  has(emptyTree, 'workshop.empty.start') && has(emptyTree, 'workshop.empty.import') && has(emptyTree, 'workshop.empty.library'), '');
check('②c 空草稿：不渲染体检报告（没有「体检」标题，也没有「校验未通过」一屏红字）',
  !has(emptyTree, 'workshop.audit.title') && !has(emptyTree, 'workshop.audit.cannotExport'), '');

store.setDraftFromHost(filledCard());
resetHooks();
const fullTree = overlay.comp({ store, t });
check('②d 有内容：不再显示空状态（切回体检报告）',
  !has(fullTree, 'workshop.empty.title'), '');
check('②e 有内容：体检区回来了', has(fullTree, 'workshop.audit.title') || has(fullTree, 'workshop.audit.notRun'), '');

delete globalThis.window;
finish();
