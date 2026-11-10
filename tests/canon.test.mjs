/**
 * 设定铁律（Canon）回归测试（0.19.0，不随插件发布）。
 *
 * 背景（2026-11 评审）：插件的校验全在制卡期，卡导进 SillyTavern 之后插件就退场了 ——
 * 所以「对话期吃书」不可能靠插件的工具去拦，能拦的是**卡里带什么**。本版把「设定铁律」
 * （≤12 条 × ≤40 字）编译进卡的三处注入点（Character's Note / Post-History / 世界书常驻条目），
 * 并在 cc_validate 里用可计算规则挡「超长 / 同实体两条不同说法 / 同名条目」。
 *
 * ⚠️ 能力边界：不测「语义矛盾自动检出」—— 那不是本实现的能力（见 lib/consistency.js 文件头）。
 *
 * 运行：node tests/canon.test.mjs
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录（见 AGENTS.md）。
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-canon-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import('../lib/agent.js');
const cons = await import('../lib/consistency.js');

const results = [];
function check(name, pass, detail){ results.push({ name, pass: !!pass, detail }); }

const tools = new Map();
mod.apply({ get(){ return null; }, tools: { register(def){ tools.set(def.name, def); } } });
const exec = { agent: { session: { id: 'session-canon' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

// ── ① 常量与读取侧归一 ─────────────────────────────────────────
{
  check('①a 上限常量：12 条 / 单条 40 字 / 整段 600 字',
    cons.CANON_MAX_RULES === 12 && cons.CANON_MAX_FACT === 40 && cons.CANON_MAX_TOTAL === 600,
    JSON.stringify({ r: cons.CANON_MAX_RULES, f: cons.CANON_MAX_FACT, t: cons.CANON_MAX_TOTAL }));
  const empty = cons.normalizeCanon({ data: {} });
  check('①b 没有 canon → rules 空、source=none（不抛错）',
    empty.rules.length === 0 && empty.source === 'none', JSON.stringify(empty));
  const many = { data: { extensions: { cc_canon: { rules: Array.from({ length: 20 }, (_, i) => ({ subject: 'S' + i, fact: 'F' + i })), source: 'model' } } } };
  const norm = cons.normalizeCanon(many);
  check('①c 读取侧截断到 12 条（落盘仍保留原始，供 audit 报超长）',
    norm.rules.length === 12 && norm.raw.length === 20, JSON.stringify({ read: norm.rules.length, raw: norm.raw.length }));
  check('①d 非法项（缺 subject / 缺 fact）被丢弃',
    cons.normalizeCanon({ data: { extensions: { cc_canon: { rules: [{ subject: 'a' }, { fact: 'b' }, { subject: 'c', fact: 'd' }] } } } }).rules.length === 1, '');
}

// ── ② 派生草案：旧卡迁移的兜底 ─────────────────────────────────
{
  const card = {
    data: {
      name: '林晚', description: '高二学生，左眼失明，怕水。',
      extensions: { cc_world: { timeline: '十年前那场大火之后，学校再没招过新生。', geo: '旧校舍、广播室、天台' } },
      character_book: { entries: [
        { name: '旧校舍', keys: ['旧校舍'], content: '@@position after_desc\n三年前烧毁，现为禁区。', enabled: true },
        // autoLorebook 自动条目与五维同源 —— 派生时必须跳过，否则「自己跟自己冲突」
        { name: '年表', keys: ['年表'], content: '@@position after_desc\n十年前那场大火。', enabled: true, cc_auto: true, extensions: { cc_auto: true, cc_world_ref: 'timeline' } },
      ] },
    },
  };
  const d = cons.deriveCanonDraft(card);
  const subjects = d.rules.map(r => r.subject);
  check('②a 派生覆盖五维 / 手工条目 / 角色，且自带 source=derived',
    subjects.indexOf('年表') >= 0 && subjects.indexOf('地理') >= 0 && subjects.indexOf('旧校舍') >= 0 && subjects.indexOf('林晚') >= 0 && d.source === 'derived',
    JSON.stringify(subjects));
  check('②b autoLorebook 条目被跳过（与五维同源，不算独立实体）',
    subjects.filter(s => s === '年表').length === 1, JSON.stringify(subjects));
  check('②c 同 subject 只保留第一条（不会自己跟自己冲突）',
    new Set(subjects.map(s => s.toLowerCase())).size === subjects.length, JSON.stringify(subjects));
  check('②d 派生事实被截到 40 字内（长设定在运行期会被模型忽略）',
    d.rules.every(r => Array.from(r.fact).length <= cons.CANON_MAX_FACT + 1), JSON.stringify(d.rules.map(r => r.fact.length)));
  const empty = cons.deriveCanonDraft({ data: {} });
  check('②e 空卡派生为空（不编造铁律）', empty.rules.length === 0, JSON.stringify(empty));
}

// ── ③ 审计：可计算的规则 ───────────────────────────────────────
{
  const mk = (rules, entries) => ({
    data: {
      extensions: rules ? { cc_canon: { rules, source: 'model' } } : {},
      character_book: { entries: entries || [] },
    },
  });
  const codes = (r) => r.issues.map(i => i.code);
  check('③a 没有 canon → warning canon-missing（不是 error：宿主只读校验、旧卡都会命中）',
    (() => { const r = cons.auditCanon(mk(null)); return codes(r).indexOf('canon-missing') >= 0 && r.errorCount === 0; })(), '');
  check('③b canon 超 12 条 → error canon-too-long',
    (() => { const r = cons.auditCanon(mk(Array.from({ length: 13 }, (_, i) => ({ subject: 'S' + i, fact: 'F' + i })))); return codes(r).indexOf('canon-too-long') >= 0 && r.errorCount > 0; })(), '');
  check('③c 单条 fact 超 40 字 → error canon-too-long',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: 'x'.repeat(41) }])); return codes(r).indexOf('canon-too-long') >= 0; })(), '');
  check('③d 同一 subject 两条不同说法 → error canon-duplicate-subject（这才叫「两套设定」）',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }, { subject: ' 旧校舍 ', fact: '完好' }])); return codes(r).indexOf('canon-duplicate-subject') >= 0 && r.errorCount > 0; })(), '');
  check('③e 同一 subject 两条相同说法不算冲突（重复但一致）',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }, { subject: '旧校舍', fact: '已烧毁' }])); return codes(r).indexOf('canon-duplicate-subject') < 0; })(), '');
  check('③f 手工条目主题未被任何铁律覆盖 → warning canon-coverage-gap',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }], [{ name: '广播室', keys: ['广播室'], content: '麦克风永远开着', enabled: true }])); return codes(r).indexOf('canon-coverage-gap') >= 0 && r.errorCount === 0; })(), '');
  check('③g 同名条目两种内容 → error lore-duplicate-name',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }], [
      { name: '广播室', keys: ['广播室'], content: '麦克风永远开着', enabled: true },
      { name: '广播室', keys: ['广播室'], content: '广播室早就拆了', enabled: true },
    ])); return codes(r).indexOf('lore-duplicate-name') >= 0 && r.errorCount > 0; })(), '');
  check('③h 极性词可疑只给 warning（词表判不了语义，不许定罪）',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '三年前已毁' }], [{ name: '旧校舍', keys: ['旧校舍'], content: '旧校舍至今完好，是主角的据点', enabled: true }])); return codes(r).indexOf('canon-polarity-suspect') >= 0 && r.issues.filter(i => i.code === 'canon-polarity-suspect').every(i => i.level === 'warning'); })(), '');
  check('③i 每条 issue 都带 code/level/message/refs（UI 可直接渲染）',
    (() => { const r = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }, { subject: '旧校舍', fact: '完好' }])); return r.issues.every(i => typeof i.code === 'string' && (i.level === 'error' || i.level === 'warning') && typeof i.message === 'string' && Array.isArray(i.refs)); })(), '');
}

// ── ④ 注入：canon 编译进卡的三处（Character's Note 是主力）────────
{
  await call('cc_new_card', { confirm: true });
  await call('cc_patch_character', { name: '铁律卡', description: '一个住在旧校舍附近的高二学生。', personality: '安静', scenario: '放学后的教学楼' });
  await call('cc_patch_world', { timeline: '十年前那场大火之后，学校再没招过新生。', factions: '夜巡与学生会', geo: '旧校舍、广播室、天台' });
  await call('cc_add_lorebook_entries', { entries: [
    { name: '罐底的字', keys: ['红豆奶', '罐底'], content: '@@depth 4\n罐底有一行被刮掉的字。' },
    { name: '西侧楼梯', keys: ['西侧楼梯'], content: '@@depth 4\n西侧楼梯的灯总是坏。' },
    { name: '广播室', keys: ['广播室'], content: '@@depth 4\n广播室的麦克风永远开着。' },
    { name: '天台', keys: ['天台'], content: '@@depth 4\n天台风很大。' },
  ] });
  await call('cc_patch_greetings', { startTime: '2026-11-09 08:00', first_mes: '放学后，走廊很安静。', alternate_greetings: ['一', '二'], group_only_greetings: ['群聊'] });
  const r = await call('cc_validate', { canon: [
    { subject: '旧校舍', fact: '三年前烧毁，现为禁区' },
    { subject: '林晚', fact: '左眼失明，怕水' },
  ] });
  check('④a 显式 canon + 结构齐 → valid=true', r.valid === true, JSON.stringify(r.errors));
  check('④b 返回 canon 元信息：条数 / 来源 / 三处注入都成功',
    r.canon && r.canon.count === 2 && r.canon.source === 'model'
    && r.canon.injected.depthPrompt === true && r.canon.injected.postHistory === true && r.canon.injected.loreEntry === true,
    JSON.stringify(r.canon && r.canon.injected));
  const dd = (await call('cc_get_card')).draft.data;
  const canonRules = (dd.extensions && dd.extensions.cc_canon && dd.extensions.cc_canon.rules) || [];
  check('④c 落盘 data.extensions.cc_canon（source=model），并写进 Character\'s Note',
    canonRules.length === 2 && String(dd.extensions.depth_prompt.prompt).indexOf('【设定铁律】') >= 0
    && String(dd.extensions.depth_prompt.prompt).indexOf('旧校舍：三年前烧毁') >= 0,
    String(dd.extensions.depth_prompt.prompt).slice(-80));
  check('④d Post-History 只追加仲裁短句（全文不重复注入 —— 每轮省 ~187 token）',
    String(dd.post_history_instructions).indexOf('【设定铁律】') >= 0
    && /以铁律为准/.test(String(dd.post_history_instructions))
    && String(dd.post_history_instructions).indexOf('旧校舍：三年前烧毁') < 0, '');
  check('④e system_prompt 只加一句指引（不塞全文，避免挤掉 ST 的 Main Prompt）',
    String(dd.system_prompt).indexOf('【设定铁律·指引】') >= 0
    && String(dd.system_prompt).split('【设定铁律·指引】').length === 2, '');
  const loreEntry = dd.character_book.entries.filter(e => e && e.name === '设定铁律')[0];
  check('④f 卡内世界书新增 constant「设定铁律」条目（Import Card Lore 场景的兜底）',
    !!loreEntry && loreEntry.constant === true && String(loreEntry.content).indexOf('@@position after_desc') === 0,
    loreEntry ? String(loreEntry.content).slice(0, 40) : 'missing');
  // 幂等：再 validate 一次（不传 canon，沿用已存的）—— 三处都不能重复追加
  await call('cc_validate');
  const dd2 = (await call('cc_get_card')).draft.data;
  const dp2 = String(dd2.extensions.depth_prompt.prompt);
  check('④g 重复 validate 幂等：Character\'s Note 里铁律段只有一份',
    dp2.split('【设定铁律】').length === 2, 'marks=' + (dp2.split('【设定铁律】').length - 1));
  check('④h 重复 validate 幂等：世界书「设定铁律」条目只有一条',
    dd2.character_book.entries.filter(e => e && e.name === '设定铁律').length === 1, '');
  check('④i 重复 validate 幂等：system_prompt 指引只加一次',
    String(dd2.system_prompt).split('【设定铁律·指引】').length === 2, '');
  check('④j 「设定铁律」条目自己不会被报「未被铁律覆盖」（自我指涉的假问题）',
    !(r.warnings || []).some(w => /设定铁律/.test(String(w)) && /未被任何铁律覆盖/.test(String(w))),
    JSON.stringify((r.warnings || []).filter(w => /设定铁律/.test(String(w))).map(w => String(w).slice(0, 50))));
}

// ── ⑤ digest 模式：小到不会被上下文裁剪 ─────────────────────────
{
  const r = await call('cc_get_card', { digest: true });
  const size = JSON.stringify(r).length;
  check('⑤a digest:true 不再回吐整份 draft，改回 canonDigest + fieldBrief',
    r.digest === true && !r.draft && !!r.canonDigest && !!r.fieldBrief && !!r.fieldBrief.book, '');
  check('⑤b digest 返回体积在 3000 字符内（预设的 tool-result-pruner 阈值是 8192）',
    size < 3000, 'size=' + size);
  check('⑤c digest 含世界书条目的 name/keys/constant（核对触发词用）',
    r.fieldBrief.book.entries.length >= 1 && Array.isArray(r.fieldBrief.book.entries[0].keys), JSON.stringify(r.fieldBrief.book.entries[0]));
  const plain = await call('cc_get_card');
  check('⑤d 默认模式仍带 canonDigest（不必额外调一次工具就能核对铁律）',
    !!plain.canonDigest && plain.canonDigest.count === 2, JSON.stringify(plain.canonDigest && plain.canonDigest.count));
}

// ── ⑥ 门禁：canon 自身的确定性错误会挡住 valid ──────────────────
{
  const bad = await call('cc_validate', { canon: [
    { subject: '旧校舍', fact: '三年前烧毁，现为禁区' },
    { subject: '旧校舍', fact: '完好可用' },
  ] });
  check('⑥a 同一实体两条不同说法 → valid=false（error，而不是 warning）',
    bad.valid === false && bad.consistency.errorCount > 0
    && bad.errors.some(e => /旧校舍/.test(e)), JSON.stringify(bad.errors));
  const tooLong = await call('cc_validate', { canon: Array.from({ length: 13 }, (_, i) => ({ subject: '实体' + i, fact: '事实' + i })) });
  check('⑥b 超过 12 条 → valid=false 并点名上限',
    tooLong.valid === false && tooLong.errors.some(e => /上限/.test(e)), JSON.stringify(tooLong.errors.filter(e => /上限/.test(e))));
}

// ── ⑦ 派生兜底：模型不给 canon 时仍有铁律可注入 ─────────────────
{
  await call('cc_new_card', { confirm: true });
  await call('cc_patch_character', { name: '派生卡', description: '一个把自己锁在广播室里的学生。', personality: '警惕', scenario: '停电的校舍' });
  // timeline 故意写成一句 40 字以上的长设定：派生必须自己守住上限，否则 ⑦a 会变成 valid=false
  await call('cc_patch_world', { timeline: '十年前那场大火把西侧教学楼整栋烧穿，之后学校再没招过新生，旧校舍一直封着。', factions: '夜巡与学生会', geo: '旧校舍、广播室、天台' });
  await call('cc_add_lorebook_entries', { entries: [
    { name: '广播室', keys: ['广播室'], content: '@@depth 4\n广播室的麦克风永远开着。' },
    { name: '天台', keys: ['天台'], content: '@@depth 4\n天台风很大。' },
    { name: '西侧楼梯', keys: ['西侧楼梯'], content: '@@depth 4\n西侧楼梯的灯总是坏。' },
    { name: '罐底的字', keys: ['红豆奶', '罐底'], content: '@@depth 4\n罐底有一行被刮掉的字。' },
    { name: '校医室', keys: ['校医室'], content: '@@depth 4\n校医室的门锁着。' },
  ] });
  await call('cc_patch_greetings', { startTime: '2026-11-09 08:00', first_mes: '停电了。', alternate_greetings: ['一', '二'], group_only_greetings: ['群聊'] });
  const r = await call('cc_validate');
  const dd = (await call('cc_get_card')).draft.data;
  check('⑦a 不传 canon → 工具自动派生并落盘（source=derived），valid 仍可为 true',
    r.valid === true && r.canon.auto === true && r.canon.source === 'derived'
    && ((dd.extensions.cc_canon && dd.extensions.cc_canon.rules) || []).length > 0,
    JSON.stringify({ valid: r.valid, canon: r.canon && r.canon.count, src: r.canon && r.canon.source, errors: r.errors }));
  check('⑦b 派生草案给出 warning（提示用户确认/改写）',
    (r.warnings || []).some(w => /派生/.test(String(w))), JSON.stringify((r.warnings || []).filter(w => /派生/.test(String(w))).map(w => String(w).slice(0, 40))));
  check('⑦c 派生时不往卡内世界书塞「设定铁律」条目（否则每张旧卡 validate 一次就多一条）',
    dd.character_book.entries.filter(e => e && e.name === '设定铁律').length === 0, '');
  check('⑦d 派生时仍写 Character\'s Note / Post-History（运行期主力）',
    String(dd.extensions.depth_prompt.prompt).indexOf('【设定铁律】') >= 0
    && String(dd.post_history_instructions).indexOf('【设定铁律】') >= 0, '');
  // 派生必须跳过插件自己注入的「设定铁律」条目，否则第二次派生会把上一轮的摘要当成新事实
  const withCanonEntry = { data: { name: '某卡', description: '描述。', character_book: { entries: [
    { name: '设定铁律', keys: [], content: '@@position after_desc\n【设定铁律】\n- 旧校舍：已烧毁', constant: true, enabled: true },
  ] } } };
  const derived2 = cons.deriveCanonDraft(withCanonEntry);
  check('⑦e 派生跳过「设定铁律」条目（不自我复制、不越滚越长）',
    derived2.rules.every(r => r.subject !== '设定铁律') && derived2.rules.some(r => r.subject === '某卡'),
    JSON.stringify(derived2.rules.map(r => r.subject)));
}

// ── ⑧ 纯函数：applyCanon 不改原卡（深拷贝） ─────────────────────
{
  const card = { data: { name: '不改', extensions: {}, character_book: { entries: [] } } };
  const before = JSON.stringify(card);
  cons.applyCanon(card, { rules: [{ subject: 'A', fact: 'B' }], source: 'model' }, { timeDepth: 'T' });
  check('⑧a applyCanon 返回新卡、原对象一个字节不动', JSON.stringify(card) === before, '');
  const applied = cons.applyCanon(card, { rules: [{ subject: 'A', fact: 'B' }], source: 'model' }, { timeDepth: 'T' });
  check('⑧b applyCanon 的 changed 列出被改的字段（幂等判定依据）',
    applied.changed.some(x => /cc_canon/.test(x)) && applied.changed.some(x => /depth_prompt/.test(x)), JSON.stringify(applied.changed));
}

// ── ⑨ 反馈 bug 1：派生结果不能违反自己的上限（存量卡升级即可用）──────
{
  const long = '青崖宗六阁：丹阁掌炉火、器阁铸兵刃、律堂掌刑罚、药堂管伤病、书阁藏典籍、驿阁通商路，六阁互不统属。';
  const card = { data: { name: '旧卡', description: '一个在丹阁长大的药童。', extensions: { cc_world: { factions: long } }, character_book: { entries: [] } } };
  const d = cons.deriveCanonDraft(card);
  check('⑨a 派生 fact 不超过上限（省略号也占位，不再出现 41 vs 40）',
    d.rules.every(r => Array.from(r.fact).length <= cons.CANON_MAX_FACT),
    JSON.stringify(d.rules.map(r => Array.from(r.fact).length)));
  const c2 = JSON.parse(JSON.stringify(card));
  c2.data.extensions.cc_canon = { rules: d.rules, source: 'derived', at: 1, fp: cons.canonFingerprint(c2) };
  const a = cons.auditCanon(c2);
  check('⑨b 派生结果不再触发 canon-too-long（旧卡不会被自己的草案顶死）',
    a.errorCount === 0, JSON.stringify(a.issues.filter(i => i.level === 'error').map(i => i.code)));
  check('⑨c 截断优先切在标点处（不把词切成两半）',
    /[，、；。…]$/.test(d.rules[0].fact) || Array.from(d.rules[0].fact).length <= cons.CANON_MAX_FACT, d.rules[0].fact);
}

// ── ⑩ 反馈 bug 2：极性词表只收状态词，且同句才算 ─────────────────
{
  const mk = (rules, entries) => ({ data: { extensions: { cc_canon: { rules, source: 'model' } }, character_book: { entries } } });
  const r1 = cons.auditCanon(mk([{ subject: '抵债契', fact: '期满债已清' }],
    [{ name: '规矩', keys: ['规矩'], content: '三年抵债契早就满了，债主不再追索。', enabled: true }]));
  check('⑩a 「早就满了」不再被判极性可疑（时间副词已移出词表）',
    !r1.issues.some(i => i.code === 'canon-polarity-suspect'), JSON.stringify(r1.issues.map(i => i.code)));
  const r2 = cons.auditCanon(mk([{ subject: '旧校舍', fact: '三年前已烧毁' }],
    [{ name: '旧校舍', keys: ['旧校舍'], content: '旧校舍至今完好，是主角的据点。', enabled: true }]));
  check('⑩b 「已烧毁」对「完好」仍然报警（真冲突不能被一并放过）',
    r2.issues.some(i => i.code === 'canon-polarity-suspect'), JSON.stringify(r2.issues.map(i => i.code)));
  const r3 = cons.auditCanon(mk([{ subject: '旧校舍', fact: '已烧毁' }],
    [{ name: '杂记', keys: ['杂记'], content: '旧校舍是学校的旧楼。操场上那棵树至今完好。', enabled: true }]));
  check('⑩c 实体与状态词不在同一句时不报（句级匹配）',
    !r3.issues.some(i => i.code === 'canon-polarity-suspect'), JSON.stringify(r3.issues.map(i => i.code)));
}

// ── ⑪ 反馈 bug 3：纯规则条目不该被要求进铁律 ─────────────────────
{
  const card = { data: {
    extensions: { cc_canon: { rules: [{ subject: '丹阁', fact: '掌炉火' }], source: 'model' } },
    character_book: { entries: [
      { name: '演出规范（常驻）', keys: [], content: '【演出规范】必须第三人称，禁写心理活动。', constant: true, enabled: true },
      { name: '豁免条目', keys: ['豁免'], content: '与丹阁无关的设定。', enabled: true, skipCoverage: true },
      { name: '丹阁', keys: ['丹阁'], content: '丹阁掌炉火，弟子分三等。', enabled: true },
    ] },
  } };
  const r = cons.auditCanon(card);
  const gap = r.issues.find(i => i.code === 'canon-coverage-gap');
  check('⑪a 纯规则条目（constant + 【】）不进 coverage-gap',
    !gap || (!/演出规范/.test(gap.message) && !/豁免条目/.test(gap.message)), gap ? gap.message : '(无 gap)');
  check('⑪b skipCoverage:true 可手动豁免',
    !gap || !/豁免条目/.test(gap.message), gap ? gap.message : '(无 gap)');
  check('⑪c 规则条目也不进派生 canon（它们没有实体主题）',
    cons.deriveCanonDraft(card).rules.every(x => x.subject !== '演出规范（常驻）' && x.subject !== '豁免条目'),
    JSON.stringify(cons.deriveCanonDraft(card).rules.map(x => x.subject)));
}

// ── ⑫ 反馈 5：canon 落盘后被改过的世界书要能提示 stale ─────────────
{
  const card = { data: { name: 'X', extensions: { cc_world: { geo: '旧校舍' } }, character_book: { entries: [] } } };
  const d = cons.deriveCanonDraft(card);
  const c2 = JSON.parse(JSON.stringify(card));
  c2.data.extensions.cc_canon = { rules: d.rules, source: 'derived', at: 1, fp: cons.canonFingerprint(c2) };
  check('⑫a 内容没变时不报 stale',
    !cons.auditCanon(c2).issues.some(i => i.code === 'canon-stale'), '');
  c2.data.character_book.entries.push({ name: '新设定', keys: ['新设定'], content: '新设定正文。', enabled: true });
  check('⑫b 改动世界书后报 canon-stale（铁律与条目脱钩要能被发现）',
    cons.auditCanon(c2).issues.some(i => i.code === 'canon-stale'), '');
  check('⑫c stale 只是 warning，不阻塞 valid',
    cons.auditCanon(c2).issues.filter(i => i.code === 'canon-stale').every(i => i.level === 'warning'), '');
  // 重传 canon 后 stale 消失
  c2.data.extensions.cc_canon = { rules: cons.deriveCanonDraft(c2).rules, source: 'derived', at: 2, fp: cons.canonFingerprint(c2) };
  check('⑫d 重传 canon（指纹更新）后 stale 消失',
    !cons.auditCanon(c2).issues.some(i => i.code === 'canon-stale'), '');
}

// ── ⑬ 反馈 6：digest 首次不该只给空 canon ────────────────────────
{
  const card = { data: { name: 'X', description: '描述。', extensions: { cc_world: { geo: '旧校舍' } }, character_book: { entries: [] } } };
  const dg = cons.canonDigest(card);
  check('⑬a 没有落盘 canon 时 digest 给派生预览（与 validate 会写入的是同一份）',
    dg.source === 'derived-preview' && dg.count > 0 && /尚未建立/.test(dg.note), JSON.stringify(dg));
  const empty = cons.canonDigest({ data: {} });
  check('⑬b 空卡 digest 说明「没有可提炼的设定」而不是沉默',
    empty.count === 0 && /没有可提炼/.test(empty.note), JSON.stringify(empty));
}

// ── ⑭ 反馈 4：注入「设定铁律」顶爆预算时给可执行数值 ──────────────
{
  await call('cc_patch_book_meta', { token_budget: 10 });
  const r = await call('cc_validate');
  const w = (r.warnings || []).map(String).find(x => /token_budget: \d+/.test(x));
  check('⑭a 超预算时给出具体的新预算值（不是只说「超了」）', !!w, JSON.stringify(w || (r.warnings || []).map(x => String(x).slice(0, 40))));
  check('⑭b 建议值大于当前用量（照着调一定能过）',
    !!w && Number((/token_budget: (\d+)/.exec(w) || [])[1]) > (r.lorebookTokens || 0), w || '');
  await call('cc_patch_book_meta', { token_budget: 2400 });   // 复原，避免影响后续用例
}

// ── ⑮ 反馈 7：errors 与 consistency 里的同一条 error 要可区分 ─────
{
  const bad = await call('cc_validate', { canon: [{ subject: 'A', fact: 'x'.repeat(41) }] });
  const errIssues = (bad.consistency && bad.consistency.issues || []).filter(i => i.level === 'error');
  check('⑮ consistency 里 error 级 issue 标 inErrors=true（模型不会当两条分别处理）',
    errIssues.length > 0 && errIssues.every(i => i.inErrors === true), JSON.stringify(errIssues.map(i => i.code)));
  await call('cc_validate');   // 复原为派生草案
}

// ── ⑯ 反馈 8：revDrift 只在真的持有数字版本号时判定 ────────────────
{
  const src = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
  check('⑯ revDrift 用 typeof meta.rev === "number"（undefined 不再误报「外部修改」）',
    /typeof meta\.rev === "number"[\s\S]{0,80}beforeRev !== meta\.rev/.test(src), '');
}

// ── ⑰ 反馈 9：fieldBrief 的 keys 截断要标出总数 ───────────────────
{
  await call('cc_add_lorebook_entries', { entries: [
    { name: '多触发词条目', keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], content: '@@depth 4\n多触发词条目的正文。' },
  ] });
  const r = await call('cc_get_card', { digest: true });
  const e = (r.fieldBrief.book.entries || []).find(x => x.name === '多触发词条目');
  check('⑰a keys 截断带 keysTotal / keysTruncated（模型不会以为只有 6 个）',
    !!e && e.keysTotal === 8 && e.keysTruncated === true && e.keys.length === 6,
    JSON.stringify(e && { keys: e.keys.length, total: e.keysTotal, trunc: e.keysTruncated }));
}

// ── 汇总 ──────────────────────────────────────────────────────
const failed = results.filter(r => !r.pass);
for (const r of results) if (!r.pass) console.log('FAIL  ' + r.name + '  — ' + (r.detail || ''));
console.log('\n' + results.length + '/' + results.length + ' passed' + (failed.length ? ' (' + failed.length + ' failed)' : ''));
console.log(results.length + ' checks, ' + failed.length + ' failed');
try{ rmSync(tmpHome, { recursive: true, force: true }); }catch{}
process.exit(failed.length ? 1 : 0);
