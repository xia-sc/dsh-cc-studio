/**
 * 0.24.3：切换角色前「未保存草稿」拦截的回归测试。
 *
 * 背景（用户反馈）：模型写完卡没落库，用户在工坊左栏点另一张卡载入，当前草稿被直接覆盖。
 * 宿主有备份（`cc-drafts/backups`，保留 20 份）但没有恢复入口，等于丢。
 *
 * 修法：
 *   ① `draftIsUnsaved()` 纯函数判定「有内容 && 与上次保存不一致」；
 *   ② 载入 / 导入前先确认（可「先保存再切换」）；拿不到确认框就中止；
 *   ③ 锁 active 时载入只进只读预览、不写草稿 —— 不打扰。
 *
 * 0.25.3 追加（用户反馈「来回切卡什么都没改也弹确认框」）：`draftFingerprint()` 必须**忽略**
 * `data.modification_date` —— 宿主每次 setDraftFor 都会刷新它，载入后 4 秒轮询把带新时间戳的
 * 宿主草稿拉回来，内容只差一个时间戳也会被判成「未保存」。⑥ 就是这条真实链路的回归。
 *
 * 运行：node tests/unsaved-guard.test.mjs   （全绿退出码 0）
 */
import { check, finish, loadClient } from './harness.mjs';
import { readRepo } from './harness.mjs';

const src = readRepo('lib/client.js');

function grabFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到 function ${name}(`);
  let depth = 0;
  const open = src.indexOf('{', start);
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} 括号不闭合`);
}

const draftFingerprint = new Function(`${grabFunction('draftFingerprint')}; return draftFingerprint;`)();
const draftHasContent = new Function(`${grabFunction('draftHasContent')}; return draftHasContent;`)();
// draftIsUnsaved 内部会调用上面两个 —— 提取时要把它们放在同一个作用域里。
const draftIsUnsaved = new Function(
  `${grabFunction('draftFingerprint')}; ${grabFunction('draftHasContent')}; ${grabFunction('draftIsUnsaved')}; return draftIsUnsaved;`,
)();

const card = (name) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: {
  name, description: '设定', personality: '安静', first_mes: '[时间：2026-01-01 08:00]\n开场。',
  character_book: { entries: [{ name: '旧校舍' }] },
} });

// —— ① 内容判定 ——
check('① 没有 data 的草稿 = 没有内容',
  draftHasContent(null) === false && draftHasContent({}) === false && draftHasContent({ data: {} }) === false, '');
check('①b name / description / personality / first_mes 任一非空就算有内容',
  draftHasContent({ data: { name: '甲' } }) === true
  && draftHasContent({ data: { description: '设定' } }) === true
  && draftHasContent({ data: { personality: '安静' } }) === true
  && draftHasContent({ data: { first_mes: '开场' } }) === true, '');
check('①c 只有世界书条目也算有内容',
  draftHasContent({ data: { character_book: { entries: [{ name: '旧校舍' }] } } }) === true, '');
check('①d 空白字符串不算内容',
  draftHasContent({ data: { name: '   ', description: '' } }) === false, '');

// —— ② 未保存判定 ——
check('② 有内容、没有来源 id → 未保存',
  draftIsUnsaved(card('甲'), null, null) === true, '');
check('②b 有来源 id 且内容和保存时一致 → 已保存（切卡不打扰）',
  draftIsUnsaved(card('甲'), 'lib-1', draftFingerprint(card('甲'))) === false, '');
check('②c 有来源 id 但内容变了（模型/用户又写了） → 未保存',
  draftIsUnsaved(card('乙'), 'lib-1', draftFingerprint(card('甲'))) === true, '');
check('②d 空草稿即使没有来源 id 也不算未保存（新会话直接切不弹框）',
  draftIsUnsaved({ data: {} }, null, null) === false, '');
check('②e 指纹函数对同一份草稿稳定、对不同草稿不同',
  draftFingerprint(card('甲')) === draftFingerprint(card('甲'))
  && draftFingerprint(card('甲')) !== draftFingerprint(card('乙')), '');

// —— ②f/②g：0.25.3「只有时间戳变了不算未保存」——
const withModDate = (d, ts) => {
  const c = JSON.parse(JSON.stringify(d));
  c.data.modification_date = ts;
  return c;
};
check('②f 只有 data.modification_date 不同 → 指纹相同（宿主每次写草稿都会刷这个字段）',
  draftFingerprint(withModDate(card('甲'), 111)) === draftFingerprint(withModDate(card('甲'), 222)), '');
check('②g 载入的库卡（旧时间戳）与宿主草稿（新时间戳）→ 不算未保存',
  draftIsUnsaved(withModDate(card('甲'), 222), 'lib-1', draftFingerprint(withModDate(card('甲'), 111))) === false, '');
check('②h 忽略的是时间戳那一个字段，别的字段变了照样算未保存',
  draftIsUnsaved(withModDate(card('乙'), 222), 'lib-1', draftFingerprint(withModDate(card('甲'), 111))) === true
  && draftFingerprint(withModDate({ data: { name: '甲', description: '设定' } }, 1))
     !== draftFingerprint(withModDate({ data: { name: '甲', description: '设定改' } }, 1)), '');

// —— ③ 源码守卫（接线不许被顺手拆掉）——
check('③ loadFromLibrary 在发 RPC 之前先过 confirmBeforeDiscardDraft',
  /async function loadFromLibrary\(id\)\{\s*\n\s*if\(!id\) return;\s*\n\s*if\(!\(await confirmBeforeDiscardDraft\(\)\)\) return;/.test(src), '');
check('③b 确认流程支持「先保存再切换」（确认后 await saveCurrentToLibrary）',
  /async function confirmBeforeDiscardDraft\(\)\{[\s\S]{0,900}await saveCurrentToLibrary\(\)/.test(src), '');
check('③c 锁 active 时载入只进只读预览 → 不弹确认',
  /async function confirmBeforeDiscardDraft\(\)\{[\s\S]{0,400}isLockActive\(\)\) return true/.test(src), '');
check('③d 拿不到确认框就中止（不静默覆盖）',
  /if\(!canConfirm\)\{ set\(\{lastMsg:t\("store\.unsavedNoConfirm"\)\}\); return false; \}/.test(src), '');
check('③e 导入路径也会确认（不只是载入）',
  /function importAny\(\)\{[\s\S]{0,1600}store\.unsavedImport/.test(src), '');
check('③f 保存成功后记录指纹（否则每次切卡都误判未保存）',
  /savedFingerprint: draftFingerprint\(state\.draft\)/.test(src), '');
check('③g 载入成功后记录指纹', /savedFingerprint: draftFingerprint\(res\.value\.draft\)/.test(src), '');

// —— ④ 中英文案齐全（两处各一份）——
const keys = ['unsavedBeforeLoad', 'unsavedConfirmOverwrite', 'unsavedImport', 'unsavedNoConfirm'];
const missing = keys.filter((k) => (src.match(new RegExp(`"store\\.${k}"`, 'g')) || []).length < 2);
check('④ 四段确认文案中英各一份', missing.length === 0, missing.join(','));

// —— ⑤ 行为：未保存 + 用户在第一个确认点取消 → 不发载入 RPC ——
{
  const { registration, React } = loadClient();
  const calls = [];
  const registered = {};
  globalThis.window.confirm = function () { return false; };   // 用户全部选「取消/不覆盖」
  const fakeCtx = {
    effect(fn) { try { fn(); } catch (e) {} return () => {}; },
    locale: { register() { return () => {}; }, bind() { return (k) => k; } },
    slots: {
      inject(name, cb) { cb(); return () => {}; },
      register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
    },
    connection: { rpc: { call(channel, endpoint, payload) {
      calls.push({ endpoint, payload });
      if (endpoint === 'cc_loadFromLibrary') return Promise.resolve({ ok: true, value: { draft: card('别人的卡'), meta: { name: '别人的卡' }, draftStatus: {} } });
      return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
    } } },
  };
  const mod = registration.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  });
  await mod.apply(fakeCtx);
  const store = registered['conversation.input.dock'].opts.inject('warmup').store;
  store.setDraftFromHost(card('没保存的卡'));
  await store.loadFromLibrary('lib-other');
  check('⑤ 未保存草稿 + 用户取消 → 一次 cc_loadFromLibrary 都没发（草稿不会被覆盖）',
    calls.filter((c) => c.endpoint === 'cc_loadFromLibrary').length === 0,
    calls.map((c) => c.endpoint).join(',') || '(none)');
  check('⑤b 取消后草稿仍是原来那张（没被替换）',
    String(store.getSnapshot().draft.data.name) === '没保存的卡',
    String(store.getSnapshot().draft.data.name));

  // 用户第二轮确认「直接覆盖」→ 才会真发载入。
  let n = 0;
  globalThis.window.confirm = function () { n += 1; return n >= 2; };   // 第一次保存=否，第二次覆盖=是
  await store.loadFromLibrary('lib-other');
  check('⑤c 第二次确认「直接覆盖」后才发 cc_loadFromLibrary',
    calls.filter((c) => c.endpoint === 'cc_loadFromLibrary').length === 1,
    calls.map((c) => c.endpoint).join(','));

  delete globalThis.window;
}

// —— ⑥ 真实链路（0.25.3）：载入一张卡 → 轮询把宿主草稿（只刷新过时间戳）拉回来 →
//      再切另一张卡时**不该**弹「当前角色卡还没保存到角色库」。模型真写了内容时必须照弹。——
{
  let confirmCount = 0;
  const hostCopy = (d, ts) => {
    const c = JSON.parse(JSON.stringify(d));
    c.data.modification_date = ts;
    return c;
  };
  const cardA = hostCopy(card('A 卡'), 1000);
  const cardB = hostCopy(card('B 卡'), 2000);
  const libById = { 'lib-a': cardA, 'lib-b': cardB };
  const registered = {};
  const { registration, React } = loadClient({
    windowExtra: { confirm() { confirmCount += 1; return true; } },
  });
  const fakeCtx = {
    effect(fn) { try { fn(); } catch (e) {} return () => {}; },
    locale: { register() { return () => {}; }, bind() { return (k) => k; } },
    slots: {
      inject(name, cb) { cb(); return () => {}; },
      register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
    },
    connection: { rpc: { call(channel, endpoint, payload) {
      if (endpoint === 'cc_getDraft') {
        // 宿主内存里的草稿：与库里那张卡**同内容**，只是 setDraftFor 把 modification_date 刷成了 nowSec()
        return Promise.resolve({ ok: true, value: { key: 'sess-1', draft: hostCopy(cardA, 9999), draftStatus: {}, originId: 'lib-a' } });
      }
      if (endpoint === 'cc_loadFromLibrary') {
        const id = payload && payload.args ? payload.args.id : null;
        const d = libById[id] || cardA;
        return Promise.resolve({ ok: true, value: { draft: JSON.parse(JSON.stringify(d)), meta: { name: d.data.name }, draftStatus: {} } });
      }
      return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
    } } },
  };
  const mod = registration.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  });
  await mod.apply(fakeCtx);
  const store = registered['conversation.input.dock'].opts.inject('sess-1').store;
  store.setSessionId('sess-1');

  await store.loadFromLibrary('lib-a');
  check('⑥ 空草稿载入 A 卡不弹确认，且真的载入了',
    confirmCount === 0 && String(store.getSnapshot().draft.data.name) === 'A 卡',
    'confirm=' + confirmCount + ' name=' + String(store.getSnapshot().draft.data.name));

  await store._pullDraft('sess-1');
  check('⑥b 轮询拉回宿主草稿（内容相同、时间戳不同）',
    Number(store.getSnapshot().draft.data.modification_date) === 9999,
    String(store.getSnapshot().draft.data.modification_date));

  confirmCount = 0;
  await store.loadFromLibrary('lib-b');
  check('⑥c 只差 modification_date 时切卡不弹「未保存」确认框（0.25.3 的回归点）',
    confirmCount === 0, 'confirm=' + confirmCount);
  check('⑥d 而且真的切到了 B 卡',
    String(store.getSnapshot().draft.data.name) === 'B 卡',
    String(store.getSnapshot().draft.data.name));

  // 对照组：模型真的改了内容（描述被重写）→ 切卡前必须照弹。
  const written = hostCopy(cardB, 3000);
  written.data.description = '模型刚重写过的设定';
  store.setDraftFromHost(written);
  confirmCount = 0;
  await store.loadFromLibrary('lib-a');
  check('⑥e 内容真的变了（模型写入）→ 仍然先弹确认（拦截没有被削弱）',
    confirmCount === 1, 'confirm=' + confirmCount);

  delete globalThis.window;
}

finish();
