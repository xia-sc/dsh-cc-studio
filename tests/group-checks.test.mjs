/**
 * 卡组层（0.10.0）回归测试之三：**检查注册表**（groupChecks）。
 *
 * 背景：0.8/0.9 两轮里「卡组体检」是 checkGroup 里的一个 if 序列，「共享书质量」长在 cc_get_shared_book 里、
 * 重复检测又长在 scanSharedEntries 里 —— 三份格式相近、口径不同的清单（issue 的 code/level/refs 各一套）。
 * 0.10.0 起一份清单、一套 issue 形状、一个 byCheck 计数：**新检查 = 注册表加一项**。
 *
 * 本文件钉住的不变式：
 *   · 0.8/0.9 那 6 类可达 issue 的 code / level / message / refs **逐字未变**（这就是「重构不是改行为」）
 *   · stats 的形状与数值不变；issue 只是**新增** check 字段
 *   · checks:[...] 只跑指定类别；byCheck 的键集合 = 注册表的类别集合（每个 code 只归一类）
 *   · 传 metrics 与不传 metrics，预算类数字一致（数字只有一个来源）
 *   · 已知不可达：type-unknown（normalizeGroup 已把未知 type 归一到 other）—— 记录下来，别再当成能用的检查
 *
 * 运行：node tests/group-checks.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-gchecks-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');
const layer = await import('../lib/group-layer.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function entry(content, keys, extra) {
  return Object.assign({ keys: keys || [], content: content, enabled: true, constant: false,
    insertion_order: 0, use_regex: false, extensions: {} }, extra || {});
}

// ———————————————— ① 注册表自身 ————————————————
const ids = layer.GROUP_CHECKS.map(c => c.id);
const allCodes = layer.GROUP_CHECKS.reduce((n, c) => n.concat(c.codes), []);
check('① 注册表：类别 id 唯一、每个 code 只归属一个类别（否则 byCheck 会出现同一个 code 算两次）',
  new Set(ids).size === ids.length && new Set(allCodes).size === allCodes.length,
  JSON.stringify({ ids: ids, codes: allCodes.length }));
check('①b 注册表覆盖 0.8/0.9 既有的 7 个 code（迁移不许漏项）',
  ['dangling-edge', 'orphan-node', 'duplicate-name', 'type-unknown', 'unrendered', 'stale-render', 'constant-budget']
    .every(c => allCodes.indexOf(c) >= 0), JSON.stringify(allCodes));

// ———————————————— ② 0.8/0.9 那几类：code/level/message/refs 逐字未变 ————————————————
const group = host.normalizeGroup({
  id: 'g-full', name: '满检组', rev: 7,
  nodes: [
    { id: 'n1', kind: 'card', cardId: 'c1', name: '甲', aliases: [] },
    { id: 'n2', kind: 'card', cardId: 'c2', name: '乙', aliases: ['甲'] },
    { id: 'n3', kind: 'card', cardId: 'gone-card', name: '已删的卡', aliases: [] },
    { id: 'n4', kind: 'npc', name: '路人', aliases: [] },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'friend', strength: 3, direction: 'one-way' },
    { id: 'e2', from: 'n1', to: 'n9', type: 'friend', strength: 1, direction: 'one-way' },
  ],
});
const cards = [
  { id: 'c1', name: '甲', description: '【关系】段还没渲染过', constantTokens: 900, tokenBudget: 1000 },
  { id: 'c2', name: '乙', description: '<!-- cc-relations:begin rev=3 -->\n旧内容\n<!-- cc-relations:end -->', constantTokens: 300, tokenBudget: 1000 },
];
const sharedEntries = [entry('书常驻', [], { constant: true })];

const res = layer.runGroupChecks({ group: group, members: ['c1', 'c2'], cards: cards, sharedEntries: sharedEntries });
const codes = res.issues.map(i => i.code);
check('② 六类 issue 的 code 顺序与 0.8/0.9 一致（dangling → orphan → duplicate-name → unrendered → stale-render → constant-budget）',
  same(codes, ['dangling-edge', 'orphan-node', 'duplicate-name', 'unrendered', 'stale-render', 'constant-budget']),
  JSON.stringify(codes));
check('②b 每条 message 与 refs 逐字未变（这是「重构不是改行为」的直接证据）',
  res.issues[0].message === '1 条关系的端点节点已不存在（数据可能被外部改坏）' && same(res.issues[0].refs, ['e2'])
    && res.issues[1].message === '1 个节点指向的卡已不在库里：已删的卡' && same(res.issues[1].refs, ['n3'])
    && res.issues[2].message === '1 组名字/别名落在多个节点上（渲染会指向同一个人）：甲' && same(res.issues[2].refs, [])
    && res.issues[3].refs.join(',') === 'c1' && res.issues[4].refs.join(',') === 'c2'
    && res.issues[5].message === '群聊每轮固定开销偏高：成员卡常驻 1200 + 共享书常驻 3 = 合计约 1203 token（已达最小预算 1000 的 120%）',
  JSON.stringify(res.issues.map(i => i.message)));
check('②c level 分布不变（2 个 error：dangling / duplicate-name；其余 warn）',
  res.errorCount === 2 && res.issues.filter(i => i.level === 'warn').length === 4, JSON.stringify({ errors: res.errorCount }));
check('②d issue 新增 check 字段标明类别（纯增量，老字段一个没少）',
  res.issues.every(i => typeof i.check === 'string' && typeof i.level === 'string' && typeof i.message === 'string' && Array.isArray(i.refs)),
  JSON.stringify(res.issues.map(i => i.check)));
check('②e stats 的形状与数值不变（节点/边/成员/constantTokens 三段/minBudget）',
  same(res.stats, { nodes: 4, edges: 2, members: 2, constantTokens: { card: 1200, shared: 3, total: 1203 }, minBudget: 1000 }),
  JSON.stringify(res.stats));

// ———————————————— ③ 类别过滤 ————————————————
const onlyStruct = layer.runGroupChecks({ group: group, members: ['c1', 'c2'], cards: cards, sharedEntries: sharedEntries, opts: { checks: ['structure'] } });
check('③ checks:["structure"] → 只跑结构类，ran 如实回报跑的类别',
  same(onlyStruct.ran, ['structure']) && onlyStruct.issues.every(i => i.check === 'structure')
    && onlyStruct.issues.length === 3,
  JSON.stringify({ ran: onlyStruct.ran, codes: onlyStruct.issues.map(i => i.code) }));
check('③b checks:["relations","budget"] → 两类，结构类不再出现',
  same(layer.runGroupChecks({ group: group, members: ['c1', 'c2'], cards: cards, sharedEntries: sharedEntries,
    opts: { checks: ['relations', 'budget'] } }).issues.map(i => i.code), ['unrendered', 'stale-render', 'constant-budget']), '');
check('③c 空数组 / 不传 checks → 全跑（默认行为）',
  same(layer.runGroupChecks({ group: group, members: [], cards: [], sharedEntries: [], opts: { checks: [] } }).ran, ids), '');
check('③d byCheck 的键集合 = 注册表类别集合，且计数与 issues 一一对应',
  same(Object.keys(res.byCheck).sort(), ids.slice().sort())
    && ids.every(id => res.byCheck[id] === res.issues.filter(i => i.check === id).length),
  JSON.stringify(res.byCheck));

// ———————————————— ④ 预算数字只有一个来源：传 metrics 与不传一致 ————————————————
const members = [
  { id: 'c1', name: '甲', entries: [entry('甲常驻', [], { constant: true })], tokenBudget: 1000, world: {} },
  { id: 'c2', name: '乙', entries: [entry('乙常驻一', [], { constant: true }), entry('乙常驻二', [], { constant: true })], tokenBudget: 1000, world: {} },
];
const metrics = layer.groupMetrics({ cardId: 'c1', card: [], members: members, book: sharedEntries });
const withMetrics = layer.runGroupChecks({ group: group, members: ['c1', 'c2'], cards: cards, sharedEntries: sharedEntries, metrics: metrics });
check('④ 传 metrics：预算数字取自 metrics.derived.groupConstant（与 checkGroup.stats 同源）',
  metrics.derived.groupConstant.total === withMetrics.stats.constantTokens.total
    && withMetrics.stats.constantTokens.card === metrics.derived.groupConstant.card
    && withMetrics.stats.minBudget === metrics.derived.groupConstant.minBudget,
  JSON.stringify({ metrics: metrics.derived.groupConstant, stats: withMetrics.stats.constantTokens }));

// ———————————————— ⑤ 新类别 lore-quality（共享书自身条目质量） ————————————————
const badBook = [entry('死条目', []), entry('维度条目', ['地理']), entry('好条目', ['好'])];
const lq = layer.runGroupChecks({ group: group, members: [], cards: [], sharedEntries: badBook,
  opts: { checks: ['lore-quality'] } });
check('⑤ 共享书条目质量成为正式检查：死 key / 只有维度名的 key / keys 不在正文都报，source 标明是书',
  lq.issues.map(i => i.code).join(',') === 'no-keys,dim-only-keys,key-not-in-content'
    && lq.issues.every(i => i.check === 'lore-quality' && i.source === 'book') && lq.errorCount === 2,
  JSON.stringify(lq.issues.map(i => i.code + '@' + i.source)));
check('⑤b 书里没有条目时不报（空书不是问题）',
  layer.runGroupChecks({ group: group, sharedEntries: [], opts: { checks: ['lore-quality'] } }).issues.length === 0, '');
check('⑤c checks:["budget"] 时 lore-quality 不参与（类别互不串味）',
  layer.runGroupChecks({ group: group, sharedEntries: badBook, opts: { checks: ['budget'] } }).issues.length === 0, '');

// ———————————————— ⑥ 两半 checkGroup 逐字同构（旧签名与旧输出形状） ————————————————
const hCheck = host.checkGroup(group, ['c1', 'c2'], cards, sharedEntries);
const aCheck = agent.checkGroup(group, ['c1', 'c2'], cards, sharedEntries);
check('⑥ 两半 checkGroup 输出逐字相同（实现只有 group-layer 一份）', same(hCheck, aCheck), '');
check('⑥b 旧签名仍然可用：不传 opts / metrics 时行为与 0.9.x 完全一致',
  same(hCheck.issues.map(i => i.code), codes) && same(hCheck.stats, res.stats), '');

// ———————————————— ⑦ 已知不可达：type-unknown ————————————————
const weird = host.normalizeGroup({ id: 'g-w', name: 'W', nodes: [{ id: 'n1', name: '甲' }, { id: 'n2', name: '乙' }],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'no-such-type', strength: 3 }] });
check('⑦ 已知不可达：normalizeGroup 已把未知 type 归一到 other，所以 type-unknown 永远不会报 —— 记录在案，别再当它是有效检查',
  weird.edges[0].type === 'other'
    && layer.runGroupChecks({ group: weird, cards: [] }).issues.every(i => i.code !== 'type-unknown'),
  JSON.stringify(weird.edges.map(e => e.type)));

// ———————————————— ⑧ 端到端：工具 cc_group_check ————————————————
const tools = new Map();
agent.apply({ get() { return null; }, tools: { register(d) { tools.set(d.name, d); } } });
const exec = { agent: { session: { id: 'session-checks-test' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

const A = 'chk-card-a', B = 'chk-card-b';
await host.saveLibraryEntry({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '甲',
  character_book: { name: '甲书', token_budget: 1200, entries: [entry('甲常驻', [], { constant: true })] }, extensions: {} } }, { id: A });
await host.saveLibraryEntry({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '乙',
  character_book: { name: '乙书', token_budget: 1200, entries: [entry('乙条目', ['乙'], {})] }, extensions: {} } }, { id: B });
await host.writeGroup({ id: 'grp-chk', name: '体检组', nodes: [], edges: [] });
await host.assignCardToGroup(A, 'grp-chk');
await host.assignCardToGroup(B, 'grp-chk');
await host.writeBook('grp-chk', host.normalizeBook({ data: { name: '体检组·共享设定',
  entries: [entry('共享死条目', []), entry('共享好条目', ['好'])] } }, 'grp-chk'));
await host.writeDraftOrigin('session-checks-test', A, '甲');

const r1 = await call('cc_group_check', {});
check('⑧ 工具端到端：cc_group_check 返回 issues / stats / checks / byCheck（byCheck 供界面分组计数）',
  r1.ok === true && Array.isArray(r1.issues) && r1.stats.members === 2
    && Array.isArray(r1.checks) && r1.checks.length === ids.length && typeof r1.byCheck === 'object',
  JSON.stringify({ members: r1.stats.members, byCheck: r1.byCheck }));
check('⑧b 端到端能报出共享书的死 key（这一格此前没有人体检）',
  r1.issues.some(i => i.check === 'lore-quality' && i.code === 'no-keys'), JSON.stringify(r1.issues.map(i => i.check + ':' + i.code)));
const r2 = await call('cc_group_check', { checks: ['structure'] });
check('⑧c 工具的 checks 参数生效：只跑 structure 时 issues 全是结构类',
  r2.checks.join(',') === 'structure' && r2.issues.every(i => i.check === 'structure'),
  JSON.stringify({ ran: r2.checks, codes: r2.issues.map(i => i.code) }));
check('⑧d message 仍是旧文案（发现 N 个问题 / 体检通过）',
  (r1.issues.length ? /^分组「体检组」发现 \d+ 个问题（\d+ 个会真的不工作）：/.test(r1.message)
    : /^分组「体检组」体检通过：/.test(r1.message)), String(r1.message).slice(0, 60));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  ' + (r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length === 0 ? 0 : 1);
