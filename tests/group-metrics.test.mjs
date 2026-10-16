/**
 * 卡组层（0.10.0）回归测试之二：**世界书分段统计与体检口径**。
 *
 * 背景（0.9.0/0.9.1 两轮实测的教训）：共享书改变了数据的位置，却没有改变工具的度量口径 ——
 * simulate / lint / group_check / preview_export / validate 各自补了一遍「把共享书算进来」，
 * 于是连着两轮出现「改了四个、漏了第五个」。0.10.0 起所有「多少条 / 多少 token」只在
 * lib/group-layer.js 的 groupMetrics() 里产生，各工具只是挑自己那个范围。
 *
 * 本文件钉住的不变式：
 *   · lorebookMetrics(card, shared) 的旧签名输出**逐字不变**（老调用点与既有断言不许被这次收口改到）
 *   · groupMetrics 的五段范围（卡 / 每张成员卡 / 成员卡合计 / 共享书 / 全部）与 derived 派生量
 *   · checkGroup.stats.constantTokens 与 derived.groupConstant **是同一个数**（以前是两处各算一遍）
 *   · 两半都只有一份实现（同一函数引用），常量与 token 估算也不再各写一份
 *
 * 运行：node tests/group-metrics.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-gmetrics-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');
const layer = await import('../lib/group-layer.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function e(content, keys, extra) {
  return Object.assign({ keys: keys || [], content: content, enabled: true, constant: false,
    insertion_order: 0, use_regex: false, extensions: {} }, extra || {});
}

// ———————————————— ① lorebookMetrics 旧签名：逐字不变 ————————————————
// 期望值在这里**独立复算一遍**（不调被测函数）—— 否则「实现改了、期望跟着改」就白测了
function expectSeg(list) {
  return {
    entries: list.length,
    tokens: list.reduce((n, x) => n + layer.estimateTokens(x.content), 0),
    constant: list.filter(x => x.constant === true).length,
    constantTokens: list.filter(x => x.constant === true).reduce((n, x) => n + layer.estimateTokens(x.content), 0),
    manual: list.filter(x => !(x.cc_auto === true || (x.extensions && x.extensions.cc_auto))).length,
    hasDecorator: list.some(x => String(x.content || '').includes('@@')),
  };
}
const cardEntries = [e('甲的私密设定', ['甲']), e('共用的年表', ['年表'], { constant: true }), e('无 keys 条目', [])];
const bookEntries = [e('共享的年表', ['年表'], { constant: true }), e('共享地理 @@position', ['地理'])];
const legacy = layer.lorebookMetrics(cardEntries, bookEntries);
const legacyWant = {
  card: expectSeg(cardEntries), shared: expectSeg(bookEntries),
  total: expectSeg(cardEntries.concat(bookEntries)), all: cardEntries.concat(bookEntries),
};
check('① lorebookMetrics 旧签名输出逐字不变（字段名 / 顺序 / 数值全一致）', same(legacy, legacyWant),
  JSON.stringify(legacy).slice(0, 200));
check('①b 入参不是数组时按空数组处理（旧实现的兜底语义）',
  same(layer.lorebookMetrics(null, undefined).card, expectSeg([]))
    && layer.lorebookMetrics(null, undefined).all.length === 0, '');

// ———————————————— ② groupMetrics 五段范围 ————————————————
const members = [
  { id: 'c1', name: '甲', entries: [e('甲1', ['甲']), e('甲常驻', [], { constant: true })], tokenBudget: 1200,
    world: { geo: '旧校舍的地下有一扇门' } },
  { id: 'c2', name: '乙', entries: [e('乙1', ['乙'])], tokenBudget: 2000, world: {} },
];
const gm = layer.groupMetrics({ cardId: 'c1', card: cardEntries, members: members, book: bookEntries });
check('② groupMetrics：members.byId 每张成员卡一段、members.total 是成员卡合计',
  gm.members.byId.c1.entries === 2 && gm.members.byId.c2.entries === 1 && gm.members.total.entries === 3
    && gm.group.entries === 3 && gm.members.total.constant === 1,
  JSON.stringify({ c1: gm.members.byId.c1.entries, c2: gm.members.byId.c2.entries, total: gm.members.total.entries }));
check('②b all = 当前卡 + 成员卡 + 共享书（群聊时真正会一起进 prompt 的那些）',
  gm.all.entries === cardEntries.length + 3 + bookEntries.length && gm.card.entries === 3 && gm.book.entries === 2,
  JSON.stringify({ all: gm.all.entries, card: gm.card.entries, book: gm.book.entries }));
check('②c legacy 段与 lorebookMetrics 同值（同一个数不会有两个来源）',
  same(gm.legacy.card, expectSeg(cardEntries)) && same(gm.legacy.shared, expectSeg(bookEntries))
    && same(gm.legacy.total, expectSeg(cardEntries.concat(bookEntries))), '');
check('②d opts.derived=false 时不算派生量（旧调用点走这条路，避免每次白算）',
  layer.groupMetrics({ card: [], members: [], book: [] }, { derived: false }).derived === undefined, '');

// ———————————————— ③ 群聊固定开销：与 checkGroup.stats 同一个数 ————————————————
const A = 'm-card-a', B = 'm-card-b';
await host.saveLibraryEntry({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '甲',
  character_book: { name: '甲书', token_budget: 1200, entries: [e('甲常驻一', [], { constant: true }), e('甲常驻二', [], { constant: true })] },
  extensions: {} } }, { id: A });
await host.saveLibraryEntry({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '乙',
  character_book: { name: '乙书', token_budget: 2000, entries: [e('乙常驻', [], { constant: true })] },
  extensions: {} } }, { id: B });
await host.writeGroup({ id: 'grp-m', name: '度量组', nodes: [], edges: [] });
await host.assignCardToGroup(A, 'grp-m');
await host.assignCardToGroup(B, 'grp-m');
await host.writeBook('grp-m', host.normalizeBook({ data: { name: '度量组·共享设定',
  entries: [e('书常驻', [], { constant: true })] } }, 'grp-m'));

const cards = await host.libraryCardsFor([A, B]);
const sharedEntries = host.normalizeBook(await host.readBookRaw('grp-m').then(r => r.obj), 'grp-m').data.entries;
const cg = host.checkGroup({ id: 'grp-m', name: '度量组', nodes: [], edges: [], rev: 1 }, [A, B], cards, sharedEntries);
const snap = await host.readLibrarySnapshot();
const sc = layer.assembleScope({ groupId: 'grp-m', group: { id: 'grp-m', name: '度量组', rev: 1 },
  cards: snap.filter(r => r.meta.groupId === 'grp-m'), book: null, include: 'summary' });
const gm2 = layer.groupMetrics({ card: [], members: sc.members, book: sharedEntries });
check('③ derived.groupConstant 与 checkGroup().stats.constantTokens 三个数都相等（以前是两处各算一遍）',
  cg.stats.constantTokens.card === gm2.derived.groupConstant.card
    && cg.stats.constantTokens.shared === gm2.derived.groupConstant.shared
    && cg.stats.constantTokens.total === gm2.derived.groupConstant.total,
  JSON.stringify({ checkGroup: cg.stats.constantTokens, metrics: gm2.derived.groupConstant }));
check('③b minBudget 也一致（取成员卡里最小的 token_budget）',
  cg.stats.minBudget === gm2.derived.groupConstant.minBudget && gm2.derived.groupConstant.minBudget === 1200,
  JSON.stringify({ a: cg.stats.minBudget, b: gm2.derived.groupConstant.minBudget }));
check('③c ratio = total / minBudget（群聊固定开销占比，界面上要看的就是它）',
  Math.abs(gm2.derived.groupConstant.ratio - gm2.derived.groupConstant.total / 1200) < 1e-9, '');

// ———————————————— ④ 跨卡触发词冲突（含共享书） ————————————————
const dup = layer.groupMetrics({
  card: [e('我的条目', ['共用词'])],
  members: [
    { id: 'c1', name: '甲', entries: [e('甲的条目', ['共用词'])], tokenBudget: 1200 },
    { id: 'c2', name: '乙', entries: [e('乙的条目', ['大小写ABC'])], tokenBudget: 1200 },
    { id: 'c3', name: '丙', entries: [e('丙的条目', ['大小写abc'])], tokenBudget: 1200 },
  ],
  book: [e('书里的条目', ['共用词'])],
}).derived.duplicateKeys;
check('④ 跨卡冲突：同一个词在当前卡 / 成员卡 / 共享书之间被多条共用 → 报一条，hits 带来源',
  dup.some(d => d.key === '共用词' && d.hits.length === 3 && d.hits.some(h => h.kind === 'book')
    && d.hits.some(h => h.id === 'c1') && d.hits.some(h => h.id === '')),
  JSON.stringify(dup.map(d => d.key + ':' + d.hits.length)));
check('④b 大小写不敏感（ABC 与 abc 算同一个词，与 cc_lint_lorebook 的既有口径一致）',
  dup.some(d => d.key === '大小写abc' && d.hits.length === 2), JSON.stringify(dup.map(d => d.key)));
check('④c 没有被共用的词不出现在清单里（只报冲突，不报全部 key）',
  dup.every(d => d.hits.length > 1) && !dup.some(d => d.key === '独有词'), '');
const dupOff = layer.groupMetrics({ card: [], members: [],
  book: [e('停用的', ['停用词'], { enabled: false }), e('启用的', ['停用词'])] }).derived.duplicateKeys;
check('④d enabled:false 的条目不参与冲突判定（停用等于不存在）', dupOff.length === 0, JSON.stringify(dupOff));

// ———————————————— ⑤ 组内五维漂移 ————————————————
const drift = layer.groupMetrics({ card: [], book: [], members: [
  { id: 'd1', name: '甲', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
  { id: 'd2', name: '乙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇铁门，门后是广播室' } },
  { id: 'd3', name: '丙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
] }).derived.worldDrift;
check('⑤ 实质分歧才报：甲与丙逐字相同（不算）、乙写成另一处设定 → 报 geo 一条（代表取先出现的甲与不同的乙）',
  drift.length === 1 && drift[0].dim === 'geo' && drift[0].cards.length === 2
    && drift[0].cards.map(c => c.id).sort().join(',') === 'd1,d2',
  JSON.stringify(drift.map(d => d.dim + ':' + d.cards.map(c => c.id).join('/'))));
const driftSub = layer.groupMetrics({ card: [], book: [], members: [
  { id: 's1', name: '甲', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
  { id: 's2', name: '乙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门，门后是广播室' } },
] }).derived.worldDrift;
check('⑤b 一方是另一方子串（详略不同）不算漂移 —— 否则最常见的「同一设定写细一点」会天天报警',
  driftSub.length === 0, JSON.stringify(driftSub));
const driftShort = layer.groupMetrics({ card: [], book: [], members: [
  { id: 'q1', name: '甲', entries: [], tokenBudget: 1200, world: { geo: '待定' } },
  { id: 'q2', name: '乙', entries: [], tokenBudget: 1200, world: { geo: 'TBD' } },
] }).derived.worldDrift;
check('⑤c 短于 6 字符的维度不算「写了」（与「五维填了没」的既有判据一致）', driftShort.length === 0, '');

// ———————————————— ⑥ 最坏情况单次触发量 ————————————————
const wcEntries = [e('A', ['k1'], { name: 'A' }), e('B', ['k1', 'k2'], { name: 'B' }),
  e('C', ['k2'], { name: 'C' }), e('K', [], { name: 'K', constant: true })];
const wc = layer.worstCaseTrigger(wcEntries);
check('⑥ 传递闭包：A/B 共享 k1、B/C 共享 k2 → 三条并成一组，再加每轮必插的 constant',
  wc.tokens === wcEntries.reduce((n, x) => n + layer.estimateTokens(x.content), 0)
    && wc.entries.slice().sort().join(',') === 'A,B,C,K',
  JSON.stringify(wc));
const wcSingle = layer.worstCaseTrigger([e('D', ['a'], { name: 'D' }), e('E', ['a'], { name: 'E' }), e('F', ['b'], { name: 'F' })]);
check('⑥b 单字符 key 不参与共现（「a」会把整本书并成一组，报告全是噪音）',
  wcSingle.tokens === 1 && wcSingle.entries.join(',') === 'D', JSON.stringify(wcSingle));

// ———————————————— ⑦ auditLoreEntries：一把尺子，来源标签可扩 ————————————————
const aud = layer.auditLoreEntries([
  { source: 'card', entries: [e('缺 keys', []), e('维度名 keys', ['地理']), e('keys 不在正文', ['找不到'])] },
  { source: 'shared', entries: [e('书里也有', ['找不到'])] },
]);
check('⑦ 四类 issue 的顺序与 code 与 0.9.x 逐字一致（no-keys → dim-only-keys → key-not-in-content → duplicate-keys）',
  aud.issues.map(i => i.code).join(',') === 'no-keys,dim-only-keys,key-not-in-content,duplicate-keys',
  JSON.stringify(aud.issues.map(i => i.code)));
check('⑦b 跨来源冲突标 mixed，单来源标自己的名字（单卡调用时输出不变）',
  aud.issues[2].source === 'mixed' && aud.issues[0].source === 'card'
    && layer.auditLoreEntries([{ source: 'shared', entries: [e('x', [])] }]).issues[0].source === 'shared',
  JSON.stringify(aud.issues.map(i => i.source)));
check('⑦c 每条 issue 都带 contentKeys（便于直接定位改）与 errorCount',
  aud.issues.every(i => Array.isArray(i.contentKeys)) && aud.errorCount === 2, JSON.stringify({ errors: aud.errorCount }));
check('⑦d 来源标签可细化到卡 id（组体检要分清「谁的条目」）',
  layer.auditLoreEntries([{ source: 'card:c1', entries: [e('缺 keys', [])] }]).issues[0].source === 'card:c1', '');

// ———————————————— ⑧ 单点：两半不再各有一份实现 ————————————————
// 源码级断言（最本质）：这些函数/常量只能定义在 lib/group-layer.js 里，两半只许 import。
const srcHost = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
const srcAgent = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
const noDefs = ['function lorebookMetrics(', 'function auditLoreEntries(', 'function worstCaseTrigger(',
  'function estimateTokens(', 'function contentKeyOf(', 'const REL_TYPES =', 'function isAutoEntry('];
const hitHost = noDefs.filter(d => srcHost.includes(d));
const hitAgent = noDefs.filter(d => srcAgent.includes(d));
check('⑧ 两半里不再有这些函数/常量的**定义**（只剩 import）—— 口径只有 lib/group-layer.js 一份',
  hitHost.length === 0 && hitAgent.length === 0, JSON.stringify({ host: hitHost, agent: hitAgent }));
check('⑧b token 估算也只有一份：宿主半的 estimateTokensLite 与自己复算一致，且与 layer 同值',
  host.estimateTokensLite('中文abc') === layer.estimateTokens('中文abc')
    && layer.lorebookTokens([e('中文abc', [])]) === layer.estimateTokens('中文abc'), '');
check('⑧c 关系图谱常量取自 group-layer（两半不再各定义一份）',
  host.REL_TYPES === layer.REL_TYPES && host.REL_BEGIN === layer.REL_BEGIN
    && agent.REL_TYPE_LABELS === layer.REL_TYPE_LABELS, '');

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  ' + (r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length === 0 ? 0 : 1);
