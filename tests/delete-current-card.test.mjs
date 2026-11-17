/**
 * 0.25.1 / 0.27.2：删除「当前载入的卡」（尤其是**最后一张**）后，草稿必须真的清干净。
 *
 * 0.25.1 的现象：点删除 → 删除成功 → 再点另一张卡，弹「当前角色卡还没保存到角色库」；
 *   删到只剩最后一张时删不掉（删除后 currentLibraryId 已清 → 「删除」按钮 disabled，
 *   而草稿里还挂着那张卡 → 点它载入又被「未保存」拦）。
 *
 * 0.27.2 的现象（用户截图）：已存角色 0，但工坊中间仍挂着刚删掉的那张卡（沈照雪），
 *   「删除」按钮 disabled、「清空」又不敢点 —— 看起来就是「最后一张卡删不净」。
 *   根因：0.25.1 的清空是「只读时只提示、不清」；而 CC 模式里模型每写一次草稿就自动上锁
 *   （30 分钟 TTL），删除时几乎总是只读 → `clearDraft()` 直接 return，盘上草稿一个字没变，
 *   4 秒轮询又把它画回界面。
 *
 * 修法：删除的是「当前载入的卡」**或**宿主回报 `originCleared`（草稿的来源卡）时，
 *   无条件 `clearDraft(true)` —— 强制清内存 + 强制落盘空卡（force:true 穿过创作锁），
 *   同时撤掉只读预览与锁状态。用户点删除前已经二次确认，意图明确；宿主还留着覆盖前备份。
 *
 * 运行：node tests/delete-current-card.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient, readRepo, installClientRpc } from './harness.mjs';

const src = readRepo('lib/client.js');

// —— ① 源码守卫 ——
check('① 删除当前卡后强制清空草稿（clearDraft(true) —— 无视创作锁）',
  /clearDraft\(true\)/.test(src), '');
check('①b 判定同时认宿主回报的 originCleared（内存 currentLibraryId 没对齐时也要清）',
  /var wasOrigin = !!\(res\.value && res\.value\.originCleared\)/.test(src)
  && /if\(wasCurrent \|\| wasOrigin\)/.test(src), '');
check('①c force 清空必须真的落盘：pushDraftToHost(force) 且 setDraft 带 force:true',
  /function pushDraftToHost\(force\)\{[\s\S]{0,600}forceArgs\(args, !!force\)/.test(src)
  && /function forceArgs\(args, hard\)\{[\s\S]{0,400}if\(hard \|\| !state\.draftLock\) out\.force = true;/.test(src), '');
check('①d 强制清空会撤掉只读预览与锁状态（卡都删了不该还挂着预览横幅）',
  /if\(force\)\{\s*\n\s*up\.preview = null;/.test(src), '');
check('①e 不再有「只读时只提示、不清草稿」的死分支（store.deletedLocked 词条一并删除）',
  !/deletedLocked/.test(src), '');

// —— 行为脚手架 ——
const DRAFT = (name) => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name,
    description: '设定',
    personality: '安静',
    first_mes: '[时间：2026-01-01 08:00]\n开场。',
    character_book: { entries: [] },
  },
});

const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

async function boot({ originCleared = true, lockActive = false } = {}) {
  const { registration, React, timers } = loadClient({ timers: 'queue' });
  let confirmCalls = 0;
  globalThis.window.confirm = function () { confirmCalls += 1; return true; };
  const registered = {};
  const calls = installClientRpc((endpoint, payload) => {
    const args = payload && payload.args ? payload.args : {};
    if (endpoint === 'cc_loadFromLibrary') {
      const id = args.id;
      return Promise.resolve({ ok: true, value: { draft: DRAFT(id === 'lib-2' ? '乙卡' : '甲卡'), meta: { name: id }, draftStatus: {} } });
    }
    if (endpoint === 'cc_deleteFromLibrary') {
      return Promise.resolve({ ok: true, value: { id: args.id, remaining: 0, originCleared } });
    }
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: [] } });
    if (endpoint === 'cc_setDraft' || endpoint === 'cc_setOrigin') return Promise.resolve({ ok: true, value: {} });
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
  });
  const fakeCtx = {
    effect(fn) { try { fn(); } catch (e) {} return () => {}; },
    locale: { register() { return () => {}; }, bind() { return (k) => k; } },
    slots: {
      inject(name, cb) { cb(); return () => {}; },
      register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
    },
  };
  const mod = registration.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  });
  await mod.apply(fakeCtx);
  const store = registered['conversation.input.dock'].opts.inject('warmup').store;
  if (lockActive) store.setLock({ owner: 'llm', active: true, stale: false, at: Math.floor(Date.now() / 1000) });
  return { store, calls, timers, confirmCount: () => confirmCalls };
}

/** 跑掉 setDraft 延迟写盘（80ms 的 pushDraftToHost）。 */
const runTimers = async (timers) => {
  timers.forEach((t) => { try { t.fn(); } catch (e) {} });
  await flush();
};
const lastSetDraft = (calls) => {
  const sets = calls.filter((c) => c.endpoint === 'cc_setDraft');
  return sets.length ? sets[sets.length - 1] : null;
};

// —— ② 普通路径：删除当前卡 → 草稿空、基线清、空卡真的落盘 ——
{
  const { store, calls, timers, confirmCount } = await boot();
  await store.loadFromLibrary('lib-1');
  check('② 载入后 currentLibraryId 指向该卡',
    store.getSnapshot().currentLibraryId === 'lib-1', String(store.getSnapshot().currentLibraryId));

  timers.length = 0;
  await store.deleteFromLibrary('lib-1');
  check('②b 删除当前卡后草稿清空（工坊不再挂着已删除的卡）',
    !String(store.getSnapshot().draft.data.name || '').trim(),
    JSON.stringify(store.getSnapshot().draft.data.name));
  check('②c 删除当前卡后 currentLibraryId 与两个基线都清空',
    store.getSnapshot().currentLibraryId === null
    && store.getSnapshot().savedFingerprint === null
    && store.getSnapshot().originFingerprint === null,
    JSON.stringify({ id: store.getSnapshot().currentLibraryId }));

  await runTimers(timers);
  const set = lastSetDraft(calls);
  check('②d 空卡真的落盘了（否则 4 秒轮询会把旧草稿画回来）',
    !!set && !String(set.payload.args.draft.data.name || '').trim(),
    set ? JSON.stringify(set.payload.args.draft.data.name) : '(没发 cc_setDraft)');
  check('②e 落盘请求带 force:true（穿过创作锁，否则宿主拒绝、盘上还是旧卡）',
    !!set && set.payload.args.force === true,
    set ? JSON.stringify({ force: set.payload.args.force }) : '(没发)');

  let confirmed = 0;
  const base = confirmCount();
  await store.loadFromLibrary('lib-2');
  confirmed = confirmCount() - base;
  check('②f 删除后切另一张卡不再弹「未保存」确认',
    confirmed === 0, 'confirm=' + confirmed);
  check('②g 切卡成功（草稿换成乙卡）',
    String(store.getSnapshot().draft.data.name) === '乙卡',
    String(store.getSnapshot().draft.data.name));
  delete globalThis.window;
}

// —— ③ 创作锁 active（CC 模式里最常见）：删除照样要清干净 ——
{
  const { store, calls, timers } = await boot({ lockActive: true });
  await store.loadFromLibrary('lib-1');
  check('③ 锁 active 时载入仍成功（下面是删除路径）',
    String(store.getSnapshot().draft.data.name) === '甲卡', String(store.getSnapshot().draft.data.name));
  check('③b 前置：此时确实处于只读', store.isReadOnly() === true, String(store.isReadOnly()));

  timers.length = 0;
  await store.deleteFromLibrary('lib-1');
  check('③c 锁 active 也把草稿清空（0.25.1 在这里只提示、不清 → 死锁）',
    !String(store.getSnapshot().draft.data.name || '').trim(),
    JSON.stringify(store.getSnapshot().draft.data.name));
  check('③d 只读状态一并解除（预览/锁都撤掉）',
    store.getSnapshot().preview === null && store.getSnapshot().lock === null,
    JSON.stringify({ preview: !!store.getSnapshot().preview, lock: !!store.getSnapshot().lock }));

  await runTimers(timers);
  const set = lastSetDraft(calls);
  check('③e 空卡照样写进宿主（force:true）',
    !!set && !String(set.payload.args.draft.data.name || '').trim() && set.payload.args.force === true,
    set ? JSON.stringify({ force: set.payload.args.force, len: String(set.payload.args.draft.data.name || '').length }) : '(没发)');
  delete globalThis.window;
}

// —— ④ 内存没对齐（刷新后 currentLibraryId 丢了）：宿主说 originCleared 也要清 ——
{
  const { store, calls, timers } = await boot({ originCleared: true });
  await store.loadFromLibrary('lib-1');
  store.setCurrentLibraryId(null);            // 模拟「页面刚刷新、origin 还没 pull 回来」
  check('④ 前置：内存里的 currentLibraryId 是空的',
    store.getSnapshot().currentLibraryId === null, String(store.getSnapshot().currentLibraryId));

  timers.length = 0;
  await store.deleteFromLibrary('lib-1');
  check('④b 只凭宿主 originCleared 也会清空草稿（消掉「删了但中间还在」）',
    !String(store.getSnapshot().draft.data.name || '').trim(),
    JSON.stringify(store.getSnapshot().draft.data.name));
  await runTimers(timers);
  const set = lastSetDraft(calls);
  check('④c 同样真的落盘空卡', !!set && !String(set.payload.args.draft.data.name || '').trim(), set ? 'ok' : '(没发)');
  delete globalThis.window;
}

finish();
