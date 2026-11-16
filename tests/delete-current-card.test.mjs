/**
 * 0.25.1：删除「当前载入的卡」后草稿必须一起清空（用户反馈的死锁）。
 *
 * 现象：
 *   ① 点删除 → 删除成功 → 再点另一张卡，弹「当前角色卡还没保存到角色库」；
 *   ② 删到只剩最后一张时删不掉：删除后 currentLibraryId 已清 → 动作栏「删除」disabled，
 *      而草稿里还挂着那张卡 → 点它载入又被「未保存」拦 → 死锁，只能退出 dsh。
 *
 * 根因：`deleteFromLibrary` 只清了 `currentLibraryId`，没清草稿与 `savedFingerprint`。
 * 修法：删除的是**当前载入**的卡时，草稿一起清空（只读/锁保护时只清关联并提示）。
 *
 * 运行：node tests/delete-current-card.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient, readRepo, installClientRpc } from './harness.mjs';

const src = readRepo('lib/client.js');

// —— ① 源码守卫 ——
check('① 删除当前卡后清空草稿（clearDraft）',
  /var wasCurrent = state\.currentLibraryId===id;[\s\S]{0,400}clearDraft\(\)/.test(src), '');
check('①b 删除当前卡时同时清 savedFingerprint（否则切卡仍判未保存）',
  /wasCurrent[\s\S]{0,200}savedFingerprint:null/.test(src), '');
check('①c 只读/锁保护时不硬清草稿，只给提示',
  /else set\(\{lastMsg:t\("store\.deletedLocked"\)\}\)/.test(src), '');
check('①d 提示文案中英各一份',
  (src.match(/"store\.deletedLocked"/g) || []).length >= 2, '');

// —— ② 行为：删除当前卡 → 草稿空、来源清、再切卡不弹确认 ——
const { registration, React } = loadClient();
let confirmCalls = 0;
globalThis.window.confirm = function () { confirmCalls += 1; return true; };

const card = (name) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: {
  name, description: '设定', personality: '安静', first_mes: '[时间：2026-01-01 08:00]\n开场。',
  character_book: { entries: [] },
} });
const registered = {};
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) {} return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
};
const calls = installClientRpc((endpoint, payload) => {
    if (endpoint === 'cc_loadFromLibrary') {
      const id = payload && payload.args && payload.args.id;
      return Promise.resolve({ ok: true, value: { draft: card(id === 'lib-2' ? '乙卡' : '甲卡'), meta: { name: id }, draftStatus: {} } });
    }
    if (endpoint === 'cc_deleteFromLibrary') return Promise.resolve({ ok: true, value: { id: 'lib-1', remaining: 0, originCleared: true } });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: [] } });
    if (endpoint === 'cc_setDraft' || endpoint === 'cc_setOrigin') return Promise.resolve({ ok: true, value: {} });
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
});

const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);
const store = registered['conversation.input.dock'].opts.inject('warmup').store;

await store.loadFromLibrary('lib-1');
check('② 载入后 currentLibraryId 指向该卡', store.getSnapshot().currentLibraryId === 'lib-1', String(store.getSnapshot().currentLibraryId));

confirmCalls = 0;
await store.deleteFromLibrary('lib-1');
check('②b 删除当前卡后草稿清空（工坊不再挂着已删除的卡）',
  !String(store.getSnapshot().draft.data.name || '').trim(),
  JSON.stringify(store.getSnapshot().draft.data.name));
check('②c 删除当前卡后 currentLibraryId 清空', store.getSnapshot().currentLibraryId === null, String(store.getSnapshot().currentLibraryId));
check('②d 删除当前卡后 savedFingerprint 清空', store.getSnapshot().savedFingerprint === null, String(store.getSnapshot().savedFingerprint));

confirmCalls = 0;
await store.loadFromLibrary('lib-2');
check('②e 删除后切另一张卡不再弹「未保存」确认（confirm 一次都没调）',
  confirmCalls === 0, `confirmCalls=${confirmCalls}`);
check('②f 切卡成功（草稿换成乙卡）', String(store.getSnapshot().draft.data.name) === '乙卡', String(store.getSnapshot().draft.data.name));

delete globalThis.window;
finish();
