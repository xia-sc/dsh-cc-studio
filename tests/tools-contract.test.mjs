/**
 * CC 模式工具链（lib/agent.js）回归测试 —— 不随插件发布，files 未含 tests。
 *
 * 背景：一位 LLM 以「工具使用者」身份把 14 个 cc_* 工具走了一遍完整流程（做了一张卡 + 存库回环），
 * 交回 15 条发现。本文件钉住 0.5.0 针对这些发现做的全部结构性改动：
 *
 *   P0-1 autoLorebook 的 keys 只有维度名（真实对话永不命中）→ 新增 loreKeys 让模型自报触发词
 *   P0-2 auto 生成 5 条就把第 4 步「共创」顶掉了，而工具契约写着必调 → lore 完成态要求「≥5 条且至少 1 条共创」
 *   P0-3 校验通过后 next 仍写着「必须 cc_validate」→ 通过后有终态（done + step 7 + 导出指引）
 *   P0-4 载入后不传 id 保存会新建一张同名重复卡 → 草稿旁记来源 id（sidecar），保存时沿用
 *   P1-4 patch 类全量回吐整张卡 → 默认只回 changed，verbose:true 才给 draft
 *   P1-5 validate 只查「齐不齐」→ 补 keys/预算/命名/常驻等 10+ 条 warnings
 *   P1-6 世界书顶层参数不可改 → cc_patch_book_meta
 *   P2-7 characterOk 与 characterPartial 同时为 true → 四态改三态 state{character,world,lore,greetings}
 *   P2-8 同一次返回里 next/hint/notice/warning 重复 4-6 份 → 只留 workflow.next 一份
 *   另：源码复核发现「按名字兜底删自动条目」会误删用户手工建的「日常」条目 → 兜底同时看内容
 *   0.11.0 另加草稿锁：LLM 每次写草稿都建立 <草稿>.lock.json，创作告一段落时调 cc_release_draft 交还
 *   （否则用户载入别的卡会覆盖 LLM 还没保存的内容；TTL 兜底防崩溃后永久锁死）。
 *
 * 运行：node tests/tools-contract.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// —— 先隔离落盘根，再 import 工具半（草稿/角色库都落在这里）——
const tmpHome = mkdtempSync(join(tmpdir(), 'cc-tools-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import('../lib/agent.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const tools = new Map();
mod.apply({
  get() { return null; },
  tools: { register(def) { tools.set(def.name, def); } },
});
const exec = { agent: { session: { id: 'session-tools-test' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);
// 0.7.1 起工具返回是 JSON 往返后的**拷贝**（B1 的输出卫生），**改返回值不再影响内存草稿**。
// 需要「从外部改草稿」的用例统一走真实路径：写回磁盘 + 递增 rev，下一次调用以盘为准重载。
function patchDraftOnDisk(mutate) {
  const dir = mod.draftDirs()[0];
  // 0.11.0：草稿目录里多了 .lock.json（草稿锁）—— 扫草稿文件时必须排除，否则会读到锁文件。
  const f = join(dir, readdirSync(dir).filter(x => x.endsWith('.json') && !x.endsWith('.origin.json') && !x.endsWith('.lock.json'))[0]);
  const obj = JSON.parse(readFileSync(f, 'utf8'));
  obj.rev = (obj.rev || 1) + 1;
  mutate(obj.draft);
  writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  return f;
}

// ——————————————————————————————————————————————————————————————
// ① 工具集与返回契约
// ——————————————————————————————————————————————————————————————
const NAMES = [...tools.keys()];
check('① 14 个既有 + 5 个 0.5.0 + 4 个 0.8.0 关系 + 5 个 0.8.0 分组 + 4 个 0.9.0 共享世界书 + 1 个 0.11.0 草稿锁 = 33 个', NAMES.length === 33, NAMES.length + '：' + NAMES.join(', '));
['cc_new_card', 'cc_patch_book_meta', 'cc_simulate_trigger', 'cc_lint_lorebook', 'cc_preview_export',
 'cc_get_relations', 'cc_patch_relations', 'cc_render_relations', 'cc_group_check',
 // 0.8.0 分组管理：LLM 侧的增删改查（此前模型改不了「哪张卡属于哪个组」）
 'cc_list_groups', 'cc_create_group', 'cc_rename_group', 'cc_delete_group', 'cc_set_card_group',
 // 0.9.0 组级共享世界书：群聊卡世界书去重（一份设定整组共用，卡里只留私有条目）
 'cc_get_shared_book', 'cc_patch_shared_book', 'cc_promote_shared_entries', 'cc_apply_shared_book',
 // 0.11.0 草稿锁：LLM 写草稿即上锁，创作告一段落后交还用户编辑
 'cc_release_draft'].forEach(n => {
  check('①b 新工具已注册：' + n, tools.has(n) && String(tools.get(n).description || '').length > 10, '');
});
check('①c 每个工具都有 description 与 parameters 声明（模型看不到声明就不会调）',
  NAMES.every(n => tools.get(n).description && tools.get(n).parameters), NAMES.filter(n => !tools.get(n).description || !tools.get(n).parameters).join(','));

// 统一返回契约：顶层不许再出现 next / hint / notice / warning 的副本（只留 workflow.next + workflow.hint + message）
const FORBIDDEN = ['next', 'hint', 'notice', 'warning'];
const contractProbe = [
  ['cc_get_card', {}],
  ['cc_validate', {}],
  ['cc_lint_lorebook', {}],
  ['cc_preview_export', {}],
  ['cc_patch_character', { name: '契约探针' }],
  ['cc_patch_world', { timeline: '很久很久以前，这里还没有名字。', geo: '旧校舍、天台与西侧楼梯。' }],
  ['cc_add_lorebook_entries', { entries: [{ name: '旧校舍', keys: ['旧校舍'], content: '@@depth 4\n旧校舍的窗户永远关不严。' }] }],
  ['cc_patch_greetings', { first_mes: '你来了。' }],
];
let contractBad = [];
for (const [n, a] of contractProbe) {
  const r = await call(n, a);
  for (const f of FORBIDDEN) if (Object.prototype.hasOwnProperty.call(r, f)) contractBad.push(n + '.' + f);
  if (r.workflow) {
    const wf = r.workflow;
    const states = Object.values(wf.state || {});
    if (!states.length || states.some(s => ['missing', 'partial', 'ok'].indexOf(s) < 0)) contractBad.push(n + '.state');
    if (typeof wf.step !== 'number' || !wf.next || !wf.hint) contractBad.push(n + '.workflow');
  }
}
check('①d 顶层不再有 next/hint/notice/warning 副本，且 workflow 为三态结构', contractBad.length === 0, contractBad.join(','));
const src = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
check('①e 源码里不再出现旧的 Ok/Partial 双真相字段（注释里提到旧名不算）',
  !/const characterPartial|const greetingsPartial|wf\.loreOk|wf\.worldOk/.test(src), '');

// 0.10.2：DSH 的 DeepSeek provider 在流结束时对 tool input 做严格 JSON.parse，模型偶发一个
// 尾逗号就会让整轮 MALFORMED_RESPONSE（用户只看到「本轮运行失败」），工具根本不会被调用 ——
// 插件侧唯一能施加影响的是模型可见文本。写类工具必须带上 JSON 卫生规则（分小步写 + 禁尾逗号）。
const JSON_HYGIENE_TOOLS = ['cc_patch_character', 'cc_patch_world', 'cc_add_lorebook_entries', 'cc_patch_greetings', 'cc_patch_book_meta'];
check('①f 写类工具 description 含严格 JSON 规则（尾逗号会让 provider 直接判本轮失败）',
  JSON_HYGIENE_TOOLS.every(n => /严格合法的 JSON/.test(String(tools.get(n).description || ''))),
  JSON_HYGIENE_TOOLS.filter(n => !/严格合法的 JSON/.test(String(tools.get(n).description || ''))).join(','));

// ——————————————————————————————————————————————————————————————
// ② 状态机（P0-2 / P0-3）
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
let r = await call('cc_get_card');
check('② 空卡：step=2 且 character=missing', r.workflow.step === 2 && r.workflow.state.character === 'missing', JSON.stringify(r.workflow.state));

await call('cc_patch_character', { name: '江晚', description: '同桌', personality: '安静', scenario: '教室' });
r = await call('cc_get_card');
check('②b 角色齐 → step=3', r.workflow.step === 3 && r.workflow.state.character === 'ok', String(r.workflow.step));

r = await call('cc_patch_world', { timeline: '十年前那场大火之后，学校就没有再招过新生。', factions: '夜巡与学生会', geo: '旧校舍、广播室、天台', power: '遗忘会沉淀为异常', daily: '晚自习后走廊很安静' });
check('②c 五维齐 + autoLorebook 生成条目后，step **仍是 4**（自动条目不顶替第 4 步共创）',
  r.workflow.step === 4 && r.workflow.loreCount === 5 && r.workflow.manualLoreCount === 0,
  'step=' + r.workflow.step + ' lore=' + r.workflow.loreCount + ' manual=' + r.workflow.manualLoreCount);
check('②d 此时 next 明确要求继续第 4 步共创', /cc_add_lorebook_entries/.test(r.workflow.next), r.workflow.next.slice(0, 60));

r = await call('cc_validate');
check('②e 只有自动条目时 validate 不通过，且 errors 点明「只有自动条目、未完成共创」',
  r.valid === false && r.errors.some(e => /自动条目/.test(e)), JSON.stringify(r.errors));

await call('cc_add_lorebook_entries', { entries: [{ name: '罐底的字', keys: ['红豆奶', '罐底'], content: '@@depth 4\n罐底有一行被刮掉的字。', constant: false }] });
r = await call('cc_get_card');
check('②f 补 1 条共创条目后 step=5（世界书完成态 = ≥5 条且 ≥1 条共创）',
  r.workflow.step === 5 && r.workflow.manualLoreCount === 1, 'step=' + r.workflow.step + ' manual=' + r.workflow.manualLoreCount);

r = await call('cc_patch_greetings', { first_mes: '黄昏的教室只剩下你们两个人。', alternate_greetings: ['早晨的值日表', '天台的夜巡'], group_only_greetings: ['白天的面具'] });
check('②g 问候语齐 → step=6 且 readyToValidate=true', r.workflow.step === 6 && r.workflow.readyToValidate === true, 'step=' + r.workflow.step);

r = await call('cc_validate');
check('②h 校验通过后有终态：done=true、step=7，且 next 不再指向 cc_validate（P0-3 的死循环诱因）',
  r.valid === true && r.done === true && r.workflow.step === 7 && !/必须 cc_validate/.test(r.workflow.next),
  'valid=' + r.valid + ' step=' + r.workflow.step + ' next=' + String(r.workflow.next).slice(0, 40));
check('②i 通过后的 next 指向导出/保存（导出页入口名称与 0.4.1 的 UI 一致），并提醒交还草稿锁',
  /校验导出/.test(r.workflow.next) && /保存当前/.test(r.workflow.next)
    && /cc_release_draft/.test(r.workflow.next) && r.workflow.releaseRequired === true,
  String(r.workflow.next).slice(0, 120) + ' / releaseRequired=' + r.workflow.releaseRequired);
check('②j cc_validate 的 description 明确「通过后必须调用 cc_release_draft」（模型选工具时就能看到）',
  /cc_release_draft/.test(String(tools.get('cc_validate').description || '')),
  String(tools.get('cc_validate').description).slice(0, 110));

// ——————————————————————————————————————————————————————————————
// ③ autoLorebook 的 keys（P0-1）
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
r = await call('cc_patch_world', { geo: '旧校舍、广播室、天台与西侧楼梯。', daily: '晚自习后走廊很安静。' });
const draftAfterAuto = (await call('cc_get_card')).draft;
const geoEntry = draftAfterAuto.data.character_book.entries.find(e => e.name === '地理');
check('③ 不给 loreKeys 时：keys = 维度名 + 英文名（兜底，且会给出警告）',
  r.ok === true && geoEntry && geoEntry.keys[0] === '地理' && geoEntry.keys.indexOf('geography') >= 0,
  geoEntry ? JSON.stringify(geoEntry.keys) : 'missing');
check('③b 返回里明确警告「只用了维度名当触发词、真实对话不会命中」',
  Array.isArray(r.warnings) && r.warnings.some(w => /维度名/.test(w)), JSON.stringify(r.warnings || []).slice(0, 120));

await call('cc_new_card', { confirm: true });
r = await call('cc_patch_world', {
  timeline: '十年前那场大火之后，学校就没有再招过新生。',
  geo: '旧校舍、广播室、天台与西侧楼梯。',
  loreKeys: { geo: ['旧校舍', '广播室', '天台', '西侧楼梯'], timeline: ['十年前的大火'] },
});
const draftWithKeys = (await call('cc_get_card')).draft;
const geoEntry2 = draftWithKeys.data.character_book.entries.find(e => e.name === '地理');
check('③c 给了 loreKeys：实体名优先，维度名退到最后兜底',
  geoEntry2 && geoEntry2.keys[0] === '旧校舍' && geoEntry2.keys.indexOf('天台') >= 0 && geoEntry2.keys[geoEntry2.keys.length - 1] === 'geography',
  geoEntry2 ? JSON.stringify(geoEntry2.keys) : 'missing');
check('③d 给了 loreKeys 就不再刷警告', !(r.warnings || []).some(w => /维度名/.test(w)), JSON.stringify(r.warnings || []).slice(0, 80));

// ——————————————————————————————————————————————————————————————
// ④ 兜底误删（源码复核发现：按名字删会吃掉用户手工建的「日常」条目）
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_add_lorebook_entries', { entries: [{ name: '日常', keys: ['午休', '值日'], content: '午休时走廊里全是脚步声。' }] });
await call('cc_patch_world', { daily: '晚自习后走廊很安静，只有值班老师在。' });
const afterAuto = (await call('cc_get_card')).draft;
check('④ 手工建的「日常」条目（内容不是 @@ 自动格式）不会被 autoLorebook 误删',
  afterAuto.data.character_book.entries.some(e => e.name === '日常' && !e.cc_auto), 
  JSON.stringify(afterAuto.data.character_book.entries.map(e => e.name)));

await call('cc_new_card', { confirm: true });
await call('cc_patch_world', { daily: '晚自习后走廊很安静，只有值班老师在。' });
// 模拟 0.3.x 时代的旧数据：没有 cc_auto 标记，但名字与内容都是自动生成的形态
patchDraftOnDisk(d => { d.data.character_book.entries.push({ name: '日常', keys: ['日常', 'daily'], content: '@@depth 5\n旧格式自动条目', enabled: true, constant: false, insertion_order: 9, id: 999999 }); });
check('④b 测试注入生效（旧格式自动条目已随磁盘草稿进入内存）',
  (await call('cc_get_card')).draft.data.character_book.entries.some(e => e.id === 999999), '');
await call('cc_patch_world', { daily: '晚自习后走廊很安静，只有值班老师在。' });
check('④c 旧格式自动条目（无标记但名字+内容都是自动形态）会被清掉，不会重复堆叠',
  !(await call('cc_get_card')).draft.data.character_book.entries.some(e => e.id === 999999), '');

// ——————————————————————————————————————————————————————————————
// ⑤ P1-4：patch 类默认不再回吐整张卡
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
r = await call('cc_patch_character', { name: '精简测试', description: '只回 changed' });
check('⑤ patch 默认只回 changed 字段名，不回 draft', r.ok === true && Array.isArray(r.changed) && r.draft === undefined, 'changed=' + JSON.stringify(r.changed));
r = await call('cc_patch_character', { personality: '安静', verbose: true });
check('⑤b verbose:true 时才回吐 draft', !!r.draft && r.draft.data.personality === '安静', '');
r = await call('cc_get_card', { fields: ['name', 'tags'] });
check('⑤c cc_get_card({fields}) 只回指定字段',
  r.draft.data.name === '精简测试' && Array.isArray(r.draft.data.tags) && r.draft.data.personality === undefined,
  JSON.stringify(Object.keys(r.draft.data)));

// ——————————————————————————————————————————————————————————————
// ⑥ 新增工具
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '待重置' });
r = await call('cc_new_card', {});
check('⑥ cc_new_card 不带 confirm → 拒绝执行且草稿不变',
  r.ok === false && r.needsConfirm === true && (await call('cc_get_card')).draft.data.name === '待重置', '');
r = await call('cc_new_card', { confirm: true });
check('⑥b cc_new_card(confirm:true) → 空卡', r.ok === true && r.reset === true && (await call('cc_get_card')).draft.data.name === '', '');

r = await call('cc_patch_book_meta', { name: '明和中学夜巡手册', scan_depth: 6, token_budget: 2400 });
check('⑥c cc_patch_book_meta 能改世界书顶层参数（此前一个都改不了）',
  r.ok === true && r.book.scan_depth === 6 && r.book.token_budget === 2400 && r.book.name === '明和中学夜巡手册',
  JSON.stringify(r.book));

await call('cc_patch_world', { geo: '旧校舍、广播室、天台。', loreKeys: { geo: ['旧校舍', '广播室'] } });
await call('cc_add_lorebook_entries', { entries: [{ name: '力量体系', keys: [], constant: true, content: '@@activate\n遗忘会沉淀为异常。' }] });
r = await call('cc_simulate_trigger', { text: '我们去旧校舍看看吧' });
check('⑥d cc_simulate_trigger 命中实体词的条目',
  r.ok === true && r.results[0].hitCount >= 2 && r.results[0].hits.some(x => x.name === '地理'),
  'hits=' + JSON.stringify(r.results[0].hits.map(x => x.name)));
r = await call('cc_simulate_trigger', { texts: ['今天天气不错', '旧校舍'] });
check('⑥e 支持 texts 批量，且 constant 条目永远算命中',
  r.ok === true && r.simulated === 2 && r.results[0].hits.some(x => x.constant),
  'simulated=' + r.simulated);
r = await call('cc_simulate_trigger', {});
check('⑥f 不给测试文本 → 明确报错而不是静默成功', r.ok === false && /text/.test(r.error || ''), String(r.error));

r = await call('cc_lint_lorebook');
check('⑥g cc_lint_lorebook 能跑并给出结构化 issues', r.ok === true && Array.isArray(r.issues) && typeof r.errorCount === 'number', 'issues=' + r.issues.length);

r = await call('cc_preview_export');
check('⑥h cc_preview_export 回体积/token/字段清单，并量化五维与条目的重复内容',
  r.ok === true && r.bytes > 0 && r.exportedFields.indexOf('character_book') >= 0 && r.worldDuplicatedChars > 0,
  'bytes=' + r.bytes + ' dup=' + r.worldDuplicatedChars);
check('⑥i preview 顺带回答了「五维会不会导出」：extensions 里列出 cc_world',
  Array.isArray(r.extensionsExported) && r.extensionsExported.indexOf('cc_world') >= 0, JSON.stringify(r.extensionsExported));

// ——————————————————————————————————————————————————————————————
// ⑦ 存库回环与来源 id（P0-4）与 meta 修正
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '回环卡', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
r = await call('cc_save_to_library', {});
check('⑦ 首次保存：action=created 且拿到 id', r.ok === true && r.action === 'created' && !!r.id, JSON.stringify({ action: r.action, id: r.id }));
const firstId = r.id;
check('⑦b meta.tagsTotal 记下真实标签数（列表只展示 6 个，但总数要如实）',
  r.meta.tagsTotal === 7 && r.meta.tags.length === 6, 'total=' + r.meta.tagsTotal + ' shown=' + r.meta.tags.length);

const draftsDir = join(tmpHome, 'cc-drafts');
const originName = existsSync(draftsDir) ? readdirSync(draftsDir).find(f => f.endsWith('.origin.json')) : null;
r = await call('cc_load_from_library', { id: firstId, includeDraft: false });
check('⑦c load 支持 includeDraft:false（省上下文）', r.ok === true && r.draft === undefined, '');
check('⑦d 载入后写了来源 sidecar（*.origin.json，内容是那张卡的 id）',
  !!originName && readFileSync(join(draftsDir, originName), 'utf8').indexOf(firstId) >= 0, String(originName));

r = await call('cc_save_to_library', {});
check('⑦e 载入后不传 id 保存 → **updated 同一张**，不再新建重复卡（P0-4）',
  r.ok === true && r.action === 'updated' && r.id === firstId, JSON.stringify({ action: r.action, id: r.id, firstId }));
r = await call('cc_list_library', {});
check('⑦f 库里仍然只有 1 张（没有重复卡）', r.count === 1, 'count=' + r.count);

r = await call('cc_rename_in_library', { id: firstId, name: '回环卡改名' });
check('⑦g 改名同时同步 meta.name 与 draft.data.name（单一事实来源）',
  r.ok === true && r.meta.name === '回环卡改名' && r.syncedDraftName === true, '');
const loaded = await call('cc_get_library_entry', { id: firstId, includeDraft: true });
check('⑦h 库里那份 draft 的 data.name 也改了（导出后就是新名字）',
  loaded.draft.data.name === '回环卡改名', String(loaded.draft.data.name));

r = await call('cc_delete_from_library', { id: firstId });
check('⑦i 删除返回 remaining 与 originCleared',
  r.ok === true && r.remaining === 0 && r.originCleared === true, JSON.stringify({ remaining: r.remaining, originCleared: r.originCleared }));

// ——————————————————————————————————————————————————————————————
// ⑧ sidecar 两半互通（工具半写、宿主半读，路径必须算成同一个）
// ——————————————————————————————————————————————————————————————
const indexMod = await import('../lib/index.js');
const ORIGIN_KEY = 'session-tools-test';
indexMod.writeDraftOrigin(ORIGIN_KEY, 'card-from-host', '宿主写的卡');
check('⑧ 宿主半写的来源 id，工具半读得到（两半同构，否则工坊侧刷新后仍会新建重复卡）',
  (mod.readOriginSync(ORIGIN_KEY) || {}).libraryId === 'card-from-host', JSON.stringify(mod.readOriginSync(ORIGIN_KEY)));
check('⑧b 半路径也一致（同一把草稿 key 必须落到同一个 origin 文件）',
  indexMod.originFilePath(ORIGIN_KEY) === mod.originPath(ORIGIN_KEY),
  indexMod.originFilePath(ORIGIN_KEY) + ' vs ' + mod.originPath(ORIGIN_KEY));
mod.writeOriginSync(ORIGIN_KEY, 'card-from-tools', '工具写的卡');
check('⑧c 反过来也通（工具半写、宿主半读）',
  (indexMod.readDraftOrigin(ORIGIN_KEY) || {}).libraryId === 'card-from-tools', JSON.stringify(indexMod.readDraftOrigin(ORIGIN_KEY)));
indexMod.writeDraftOrigin(ORIGIN_KEY, null);
check('⑧d 清了之后两边都读不到（清空草稿 / 新建卡时靠这条，否则会更新不该动的卡）',
  mod.readOriginSync(ORIGIN_KEY) === null && indexMod.readDraftOrigin(ORIGIN_KEY) === null, '');

// ——————————————————————————————————————————————————————————————
// ⑨ 0.6.0：草稿身份与版本（P0-6）、状态机残留（R1/R2/R3）、覆盖提醒（R4）
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '身份卡', description: '用于身份回归' });
r = await call('cc_get_card');
check('⑨ 写类返回带身份：cardName / cardId（未关联已存卡时 null，一眼看出你在改哪张卡）',
  r.cardName === '身份卡' && r.cardId === null, JSON.stringify({ cardName: r.cardName, cardId: r.cardId }));
check('⑨b draftStatus 改说 sessionKey（不再用会误导的 key 冒充草稿身份），并带 rev',
  r.draftStatus.sessionKey === 'session-tools-test' && r.draftStatus.key === undefined && typeof r.draftStatus.rev === 'number',
  JSON.stringify(r.draftStatus));

const rev1 = r.draftStatus.rev;
await call('cc_patch_character', { nickname: '更一下' });
r = await call('cc_get_card');
check('⑨c 每次落盘 rev 递增（跨进程唯一的版本号，落在草稿文件里）',
  r.draftStatus.rev === rev1 + 1, rev1 + ' → ' + r.draftStatus.rev);

// 模拟「工坊界面 / host 从另一条路径改了草稿」：直接改草稿文件并递增 rev
const ddir = mod.draftDirs()[0];
const dfName = readdirSync(ddir).filter(f => f.endsWith('.json') && !f.endsWith('.origin.json') && !f.endsWith('.lock.json'))[0];
const dfPath = join(ddir, dfName);
const onDisk = JSON.parse(readFileSync(dfPath, 'utf8'));
onDisk.rev = (onDisk.rev || 1) + 1;
onDisk.draft.data.name = '被外部换掉的卡';
writeFileSync(dfPath, JSON.stringify(onDisk, null, 2), 'utf8');

r = await call('cc_get_card');
check('⑨d 发现草稿被外部换过：以盘为准重载 + 明确提示（P0-6 的核心，第二轮就是在这里误伤了江晚）',
  r.cardName === '被外部换掉的卡' && (r.warnings || []).some(w => /已被外部修改/.test(w)),
  JSON.stringify({ cardName: r.cardName, warnings: r.warnings }));
const again = await call('cc_get_card');
check('⑨e 该提示只出现一次（读后即清，不每次调用都刷）',
  !(again.warnings || []).some(w => /已被外部修改/.test(w)), JSON.stringify(again.warnings));

const revNow = (await call('cc_get_card')).draftStatus.rev;
r = await call('cc_patch_character', { nickname: 'CAS', expectedRev: revNow - 1 });
check('⑨f expectedRev 不符（乐观锁）→ 直接拒绝并回 staleRev，不写盘',
  r.ok === false && r.staleRev === true && typeof r.error === 'string', JSON.stringify({ ok: r.ok, staleRev: r.staleRev }));
r = await call('cc_patch_character', { nickname: 'CAS', expectedRev: revNow });
check('⑨g expectedRev 相符 → 正常写入', r.ok === true && r.changed.indexOf('nickname') >= 0, JSON.stringify(r.changed));

r = await call('cc_new_card', { confirm: true });
check('⑨h cc_new_card 之后 draftStatus.isNew 为 true（此前两轮它从未出现过 true）',
  r.draftStatus.isNew === true, String(r.draftStatus.isNew));

// R1 / R2 / R3：状态机与返回体的残留
await call('cc_patch_character', { name: '收口卡', description: 'd', personality: 'p', scenario: 's' });
await call('cc_patch_world', { timeline: '很久以前这里还没有名字。', factions: '夜巡小组与学生会两股势力。', geo: '旧校舍、天台与西侧楼梯。' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '常量', keys: [], constant: true, content: '@@activate\n基调' },
  { name: '彩蛋', keys: ['旧校舍'], content: '@@depth 4\n旧校舍很旧' },
  { name: '第二条', keys: ['天台'], content: '@@depth 4\n天台风大' },
  { name: '第三条', keys: ['广播'], content: '@@depth 4\n广播室' },
] });
await call('cc_patch_greetings', { first_mes: '你来了。', alternate_greetings: ['一', '二'], group_only_greetings: ['群聊'] });
r = await call('cc_validate');
check('⑨i R1：校验通过后 hint 与 next 同源（hint 不再说「下一步必须 cc_validate」，也不再写 6/6）',
  r.workflow.step === 7 && /7\/7/.test(r.workflow.hint) && !/必须 cc_validate/.test(r.workflow.hint),
  r.workflow.hint);
check('⑨j R2：hint 只报进度，不再内嵌 next 全文',
  r.workflow.hint.indexOf(r.workflow.next) < 0 && !/下一步必须/.test(r.workflow.hint), r.workflow.hint);
const gc = await call('cc_get_card');
check('⑨k R2：message 与 hint 不再一字不差（message 是给用户看的一句复述）',
  gc.message !== gc.workflow.hint && /当前进度：/.test(gc.message), String(gc.message).slice(0, 60));
check('⑨l R3：validate 的 message 里「校验通过」只出现一次',
  (String(r.message).match(/校验通过/g) || []).length === 1, r.message);

// R4：手工改过 keys 的自动条目被重建时要说出来
await call('cc_patch_world', { geo: '旧校舍与天台。', loreKeys: { geo: ['旧校舍'] } });
patchDraftOnDisk(d => {   // 模拟用户后来在工坊里手工改过这几条的 keys
  const e = d.data.character_book.entries.find(x => x.name === '地理');
  if (e) e.keys = ['旧校舍', '天台', '广播室', '西侧楼梯'];
});
r = await call('cc_patch_world', { geo: '旧校舍与天台。' });        // 不带 loreKeys → 重建回默认
check('⑨m R4：重建时检测到「keys 曾被手工改过」并报 autoLoreEdited + warning',
  r.autoLoreEdited >= 1 && (r.warnings || []).some(w => /手工改过/.test(w)),
  JSON.stringify({ autoLoreEdited: r.autoLoreEdited, warnings: (r.warnings || []).map(w => String(w).slice(0, 24)) }));

// ——————————————————————————————————————————————————————————————
// ⑩ 0.7.0：第四轮报告 —— N1 creator 写入路径 / S2 重置不再误报 / S1 rev 漂移提醒 /
//     N2 单次触发爆炸预警 / N4 空改动不涨版本号
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
r = await call('cc_validate');
check('⑩b N1：creator 为空的警告现在带解法（此前反复催一个没有写入路径的字段）',
  (r.warnings || []).some(w => /creator 为空/.test(w) && /cc_patch_character/.test(w)), JSON.stringify(r.warnings));

r = await call('cc_patch_character', { name: '第四轮卡', creator: 'CC 模式测试' });
check('⑩ N1：cc_patch_character 能写 creator 了（此前传进来被静默忽略、changed 为空）',
  r.changed.indexOf('creator') >= 0 && (await call('cc_get_card')).draft.data.creator === 'CC 模式测试',
  JSON.stringify(r.changed));
check('⑩c S2：主动 cc_new_card 之后的写入不再报「内容可能已丢失」（误报会训练人和模型忽略 warning）',
  !(r.warnings || []).some(w => /可能已丢失/.test(w)), JSON.stringify((r.warnings || []).map(w => String(w).slice(0, 26))));
r = await call('cc_validate');
check('⑩d N1：填上 creator 之后 validate 不再警告它为空',
  !(r.warnings || []).some(w => /creator 为空/.test(w)), JSON.stringify(r.warnings));

// 对照：内存与磁盘都没有草稿（host 重启后的新会话）时，那条提示仍然该出现
globalThis.__CC_DRAFTS__.delete('session-tools-test');
globalThis.__CC_DRAFT_META__.delete('session-tools-test');
rmSync(mod.draftDirs()[0], { recursive: true, force: true });
r = await call('cc_patch_character', { nickname: '新会话探针' });
check('⑩e S2 对照：确实没有草稿时才提示「可能已丢失」（成因分流，不是把警告删掉了）',
  (r.warnings || []).some(w => /可能已丢失/.test(w)), JSON.stringify((r.warnings || []).map(w => String(w).slice(0, 26))));

// S1：不传 expectedRev 也要能发现「上次调用之后有别人写过」
await call('cc_get_card');
const draftFileOf = () => {
  const dir = mod.draftDirs()[0];
  return join(dir, readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.origin.json') && !f.endsWith('.lock.json'))[0]);
};
const bumpDisk = (mutate) => {
  const f = draftFileOf();
  const o = JSON.parse(readFileSync(f, 'utf8'));
  o.rev = (o.rev || 1) + 1;
  mutate(o.draft);
  writeFileSync(f, JSON.stringify(o, null, 2), 'utf8');
};
bumpDisk(d => { d.data.nickname = '工坊改的'; });
r = await call('cc_patch_character', { nickname: '漂移后写入' });   // 故意不传 expectedRev
check('⑩f S1：不传 expectedRev 也会报出 rev 漂移（revDrift + 提示），弱模型也有兜底',
  r.revDrift && r.revDrift.to === r.revDrift.from + 1 && (r.warnings || []).some(w => /已被外部修改/.test(w)),
  JSON.stringify({ revDrift: r.revDrift, warnings: (r.warnings || []).map(w => String(w).slice(0, 34)) }));

// N4：空改动不消耗版本号
r = await call('cc_get_card');
const revIdle = r.draftStatus.rev;
const idleWrite = await call('cc_patch_character', {});
const revIdle2 = (await call('cc_get_card')).draftStatus.rev;
check('⑩g N4：什么都没改的写入不落盘、不递增 rev（此前空改动也让 rev 7→8，白打掉别人的前提）',
  idleWrite.changed.length === 0 && revIdle2 === revIdle, JSON.stringify({ changed: idleWrite.changed, revIdle, revIdle2 }));

// N4 宿主半同构：工坊侧每次编辑都会调 cc_setDraft，同值覆盖也不该涨 rev
const hostKey = 'session-tools-test';
const hostDraft = JSON.parse(JSON.stringify((await call('cc_get_card')).draft));
hostDraft.data.nickname = '宿主半改的';
indexMod.setDraftFor(hostKey, hostDraft);
const revHost1 = JSON.parse(readFileSync(draftFileOf(), 'utf8')).rev;
indexMod.setDraftFor(hostKey, JSON.parse(JSON.stringify(hostDraft)));   // 同值再来一次
const revHost2 = JSON.parse(readFileSync(draftFileOf(), 'utf8')).rev;
check('⑩h N4 宿主半同构：工坊侧同值写入不涨 rev（两半一套规则，否则工具侧的 rev 前提会被无变化打掉）',
  revHost1 === revHost2 && revHost1 > 0, revHost1 + ' → ' + revHost2);

// N2：loreKeys 跨维度重复 → 写入时当场说破（不必等写完跑 lint）
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '预算卡', description: '单次触发爆炸的样本' });
r = await call('cc_patch_world', {
  geo: '剑冢埋在听雪峰下，终年不化雪，宗门的剑都从那里取。',
  factions: '问剑宗分听雪峰与断雷峰两支，彼此不太来往。',
  loreKeys: { geo: ['剑冢', '听雪峰'], factions: ['剑冢', '断雷峰'] },
});
check('⑩i N2：同一个实体被分给多个维度时**当场**警告（此前只有写完后的 lint 才报「触发词共用」）',
  Array.isArray(r.sharedLoreKeys) && r.sharedLoreKeys.some(x => /剑冢/.test(x)) && (r.warnings || []).some(w => /同时分给了多个维度/.test(w)),
  JSON.stringify(r.sharedLoreKeys));

await call('cc_patch_book_meta', { token_budget: 30 });
r = await call('cc_lint_lorebook');
check('⑩j N2：lint 报出「最坏情况单次触发量」，并指出调大 token_budget 盖不住这条',
  !!r.worstCase && r.worstCase.tokens > 0 && r.worstCase.overBudget === true && r.issues.some(i => /最坏情况单次触发/.test(i.message)),
  JSON.stringify(r.worstCase));
const sim = await call('cc_simulate_trigger', { text: '剑冢到底在听雪峰的什么地方' });
check('⑩k N2 对照：实测「一句话命中整组」的 token 与 worstCase 吻合（共现组 + 常驻）',
  sim.results[0].hitCount >= 2 && sim.results[0].tokens === r.worstCase.tokens,
  'sim=' + sim.results[0].tokens + ' worst=' + r.worstCase.tokens + ' hits=' + JSON.stringify(sim.results[0].hits.map(x => x.name)));

await call('cc_new_card', { confirm: true });
r = await call('cc_patch_world', { daily: '夜巡的人在雪地里走，脚下每一步都留下一个印子。'.repeat(20) });
check('⑩l N2：auto 条目原文照搬导致的「单条过重」也会提示（五维写多细，单次命中就多贵）',
  r.heavyAutoEntries >= 1 && (r.warnings || []).some(w => /超过 400 token/.test(w)),
  JSON.stringify({ heavyAutoEntries: r.heavyAutoEntries, warnings: (r.warnings || []).map(w => String(w).slice(0, 30)) }));

// ——————————————————————————————————————————————————————————————
// ⑪ 0.7.1：B1（外部导入卡缺字段 → 返回非法 JSON）+ B2（changed 与 rev 判据不一致）+ build 标识
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '缺字段卡', description: 'd' });
// 模拟「PNG/CHARX 导入的卡」：盘上草稿缺 spec_version 与 creation_date（第五轮 B1 定位到的两个泄漏点）
patchDraftOnDisk(d => { delete d.spec_version; delete d.data.creation_date; });
let b1 = null;
try { b1 = await call('cc_get_card', { fields: ['name', 'creator', 'creator_notes'] }); }
catch (e) { b1 = { thrown: e.message }; }
const notLossless = (v) => { try { return JSON.stringify(JSON.parse(JSON.stringify(v))) !== JSON.stringify(v); } catch { return true; } };
check('⑪ B1：草稿缺 spec_version / creation_date 时，cc_get_card 不再返回非法 JSON（第五轮重启后首次调用炸在这里）',
  !b1.thrown && b1.draft && b1.draft.spec_version === '3.0' && b1.draftStatus.creation_date !== undefined && !notLossless(b1),
  JSON.stringify({ thrown: b1.thrown, spec_version: b1.draft && b1.draft.spec_version, creation_date: b1.draftStatus && b1.draftStatus.creation_date }));

const b1full = await call('cc_get_card');
check('⑪b B1：全量路径同样补齐（creation_date 被空卡模板填回时间戳，creator 补成空串）',
  typeof b1full.draft.data.creation_date === 'number' && typeof b1full.draft.data.creator === 'string' && !notLossless(b1full),
  JSON.stringify({ creation_date: b1full.draft.data.creation_date, creator: b1full.draft.data.creator }));

const hostFixed = indexMod.normalizeCardShape({ spec: 'chara_card_v3', data: { name: '外部导入卡' } });
check('⑪c B1 宿主半同构：工坊侧读到外部导入卡时也补齐（否则前端会把 undefined 直接渲染出来）',
  hostFixed.spec_version === '3.0' && hostFixed.data.creator === '' && typeof hostFixed.data.creation_date === 'number'
    && Array.isArray(hostFixed.data.character_book.entries) && hostFixed.data.character_book.token_budget === 2400,
  JSON.stringify({ spec_version: hostFixed.spec_version, creator: hostFixed.data.creator, kind: typeof hostFixed.data.creation_date }));

check('⑪d 每次返回都带 build 版本标识（LLM 能自己确认「我测的是不是最新代码」，第五轮为此白跑一轮）',
  typeof b1full.build === 'string' && /^\d+\.\d+\.\d+$/.test(b1full.build), String(b1full.build));
check('⑪e draftStatus.watchedRev 报出「本次调用开始前工具半记着的盘上版本」（S1 的可对账字段）',
  Object.prototype.hasOwnProperty.call(b1full.draftStatus, 'watchedRev')
    && (b1full.draftStatus.watchedRev === null || typeof b1full.draftStatus.watchedRev === 'number'),
  JSON.stringify(b1full.draftStatus));

await call('cc_patch_character', { creator: '作者甲' });
r = await call('cc_patch_character', { creator: '作者甲' });      // 传与原值相同
const revB2 = r.draftStatus.rev;
check('⑪f B2：传与原值相同的字段 → changed 为空（不再出现「说改了 creator、rev 却纹丝不动」的自相矛盾）',
  r.changed.length === 0 && (await call('cc_get_card')).draftStatus.rev === revB2,
  JSON.stringify({ changed: r.changed, rev: r.draftStatus.rev }));
r = await call('cc_patch_character', { creator: '作者乙' });
check('⑪g B2 对照：值真变了才记进 changed，rev 同步递增（两者同一套判据）',
  r.changed.indexOf('creator') >= 0 && r.draftStatus.rev === revB2 + 1,
  JSON.stringify({ changed: r.changed, rev: r.draftStatus.rev }));
await call('cc_patch_book_meta', { token_budget: 1500 });
r = await call('cc_patch_book_meta', { token_budget: 1500 });
check('⑪h B2：cc_patch_book_meta 也只记真改动（同值写入 changed 为空）',
  r.changed.length === 0, JSON.stringify(r.changed));

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
check('⑪i build 与 package.json 的 version 同步（发版时两处一起改，别让 build 变成谎报）',
  b1full.build === pkg.version, b1full.build + ' vs ' + pkg.version);

// ——————————————————————————————————————————————————————————————
// ⑫ 多行文本转义（0.10.3，用户实机报告 P1）
//
// 模型经常把换行写成**字面** `\n`（JSON 层多转义一层的 `"A\\nB"`），落盘后导出的卡在
// SillyTavern 里显示成「说完这句话。\n\n下一段」。工具层必须把字面 `\n` / `\r` / `\t`
// 解成真字符（多层转义逐层收敛），同时不能碰真换行。
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', {
  name: '换行测试',
  description: 'A\\nB',
  personality: 'P\\nQ',
  scenario: '真\n换行',
});
r = await call('cc_get_card', { fields: ['description', 'personality', 'scenario'] });
const nlCard = r.draft.data;
check('⑫a 字面 \\n 解码为真换行（cc_patch_character 的三个字段）',
  nlCard.description === 'A\nB' && nlCard.personality === 'P\nQ'
    && !String(nlCard.description).includes('\\n') && !String(nlCard.personality).includes('\\n'),
  JSON.stringify({ description: nlCard.description, personality: nlCard.personality }));
check('⑫b 真换行原样保留（不因解码被二次处理）',
  nlCard.scenario === '真\n换行' && nlCard.scenario.split('\n').length === 2, JSON.stringify(nlCard.scenario));

await call('cc_patch_character', { description: 'X\\\\nY' });   // 双层转义：模型多写了一个反斜杠
r = await call('cc_get_card', { fields: ['description'] });
check('⑫c 多层转义也收敛（传 X\\\\nY → 两个字符的反斜杠+n → 真换行）',
  r.draft.data.description === 'X\nY', JSON.stringify(r.draft.data.description));

await call('cc_patch_greetings', { first_mes: 'F\\nG', alternate_greetings: ['H\\nI'], group_only_greetings: ['J\\nK'] });
r = await call('cc_get_card', { fields: ['first_mes', 'alternate_greetings', 'group_only_greetings'] });
check('⑫d 问候语同样解码（first_mes / alternate / group_only）',
  r.draft.data.first_mes === 'F\nG' && r.draft.data.alternate_greetings[0] === 'H\nI' && r.draft.data.group_only_greetings[0] === 'J\nK',
  JSON.stringify({ first: r.draft.data.first_mes, alt: r.draft.data.alternate_greetings[0] }));

await call('cc_add_lorebook_entries', { entries: [{ name: '条\\n目', keys: ['换行键'], content: '@@depth 4\\n第一行\\n第二行' }] });
r = await call('cc_get_card', { fields: ['character_book'] });
const nlEntry = r.draft.data.character_book.entries.find(e => e.name === '条\n目');
check('⑫e 世界书条目 content / name 也解码（不是只有角色字段）',
  !!nlEntry && nlEntry.content.includes('\n第一行\n第二行') && !nlEntry.content.includes('\\n'),
  JSON.stringify({ name: nlEntry && nlEntry.name, content: nlEntry && nlEntry.content.slice(0, 40) }));

await call('cc_patch_book_meta', { name: '书\\n名', description: '说\\t明' });
r = await call('cc_get_card', { fields: ['character_book'] });
check('⑫f 世界书元信息 name / description 同样解码（含 \\t）',
  r.draft.data.character_book.name === '书\n名' && r.draft.data.character_book.description === '说\t明',
  JSON.stringify({ name: r.draft.data.character_book.name, description: r.draft.data.character_book.description }));

// ——————————————————————————————————————————————————————————————
// ⑬ 0.11.0：草稿锁（LLM 写草稿即上锁 / cc_release_draft 交还 / TTL 兜底）
//
// 事故：LLM 正在工坊草稿里创作时，用户点「载入」另一张卡，同一会话槽的草稿被整份替换 ——
// LLM 已写入但未保存的内容被覆盖。修法：工具半每次写草稿都建立 <safeDraftFile>.lock.json，
// 宿主侧看到 active 锁就只读 / 预览；交还由 LLM 调 cc_release_draft（另有 TTL 兜底，防崩溃后锁死）。
// 纯函数与超时边界在 tests/draft-lock.test.mjs；这里只钉工具链侧的接线。
// ——————————————————————————————————————————————————————————————
await call('cc_release_draft', {});   // 先清掉前面流程留下的锁，验证「首次上锁」的流程引导
r = await call('cc_new_card', { confirm: true });
check('⑬g 首次建立草稿锁的返回带交还引导（模型第一次写草稿就知道完成时要释放）',
  Array.isArray(r.warnings) && r.warnings.some(w => /cc_release_draft/.test(String(w))),
  JSON.stringify(r.warnings || []).slice(0, 180));
await call('cc_patch_character', { name: '锁契约卡', description: '给草稿锁用' });
const lockDir = mod.draftDirs()[0];
const lockName = mod.safeDraftFile('session-tools-test').replace(/\.json$/, '.lock.json');
const lockFull = join(lockDir, lockName);
check('⑬ 写类工具跑完后草稿目录出现 .lock.json（与会话槽同基名，owner=llm）',
  existsSync(lockFull) && JSON.parse(readFileSync(lockFull, 'utf8')).owner === 'llm', lockFull);
r = await call('cc_get_card');
check('⑬b cc_get_card 的 draftStatus.lock.active=true（客户端据此把工坊置为只读）',
  !!r.draftStatus.lock && r.draftStatus.lock.active === true && r.draftStatus.lock.cardName === '锁契约卡',
  JSON.stringify(r.draftStatus.lock));
check('⑬c 工具返回顶层没有多余的锁副本（锁只经 draftStatus.lock 一个出口；契约 ①d 的追加样本）',
  !Object.prototype.hasOwnProperty.call(r, 'lock') && !Object.prototype.hasOwnProperty.call(r, 'next')
    && !Object.prototype.hasOwnProperty.call(r, 'hint'), Object.keys(r).join(','));

r = await call('cc_release_draft', {});
check('⑬d cc_release_draft 交还：released=true、锁文件消失、sessionKey 对得上',
  r.ok === true && r.released === true && r.sessionKey === 'session-tools-test' && !existsSync(lockFull),
  JSON.stringify({ released: r.released, sessionKey: r.sessionKey, exists: existsSync(lockFull) }));
check('⑬e 释放后 draftStatus.lock 显式 null（工坊恢复可编辑）',
  r.draftStatus.lock === null, JSON.stringify(r.draftStatus.lock));
r = await call('cc_release_draft', {});
check('⑬f 无锁再释放幂等成功（released=false，不报错也不乱清东西）',
  r.ok === true && r.released === false && r.draftStatus.lock === null, JSON.stringify({ ok: r.ok, released: r.released }));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
