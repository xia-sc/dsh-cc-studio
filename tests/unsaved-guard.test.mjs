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

finish();
