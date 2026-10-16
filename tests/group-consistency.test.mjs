/**
 * 卡组层（0.10.0）回归测试之四：**跨卡一致性检查**（cross-card 类别）。
 *
 * 这是「卡组的第五个功能」的验收用例：它是一个新的检查类别，加进来**没有改动任何既有工具的口径** ——
 * 只往 GROUP_CHECKS 的 cross-card 里加了四项判定，simulate / lint / preview_export / validate /
 * get_shared_book 一行未动（`tests/group-layer-guard.test.mjs` 另有守卫）。
 *
 * 四类问题**单卡体检永远看不到**（它们在「卡与卡之间」）：
 *   ① cross-card-duplicate-keys  同一个触发词被多张卡/共享书共用（群聊时一句话同时带出）
 *   ② book-duplicate-in-card     卡内条目与共享书逐字重复（书里已经有了，卡里那份纯浪费）
 *   ③ world-drift                同一维度在多张成员卡里写成不同设定
 *   ④ card-auto-only             某张成员卡的世界书全是 auto 条目（等于没有自己的设定）
 *
 * 本文件钉住：正例各一条、反例各一条（不该报的绝不报）、无 scope 时整类跳过、端到端 byCheck。
 *
 * 运行：node tests/group-consistency.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-gcons-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');
const layer = await import('../lib/group-layer.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

function entry(content, keys, extra) {
  return Object.assign({ keys: keys || [], content: content, enabled: true, constant: false,
    insertion_order: 0, use_regex: false, extensions: {} }, extra || {});
}
function scopeOf(members, bookEntries, cardId) {
  return { ok: true, groupId: 'g', cardId: cardId || '', members: members, memberIds: members.map(m => m.id),
    missing: [], truncated: false,
    book: bookEntries ? { name: '书', rev: 1, entries: bookEntries, lastPromote: null } : null };
}
function run(scope, opts) {
  return layer.runGroupChecks({ group: host.normalizeGroup({ id: 'g', name: 'G', rev: 1, nodes: [], edges: [] }),
    members: scope.memberIds, cards: [], sharedEntries: scope.book ? scope.book.entries : [],
    scope: scope, opts: Object.assign({ checks: ['cross-card'] }, opts || {}) });
}

// ———————————————— ① 跨卡触发词冲突 ————————————————
const members1 = [
  { id: 'c1', name: '甲', entries: [entry('甲的公会', ['公会', '剑冢'])], tokenBudget: 1200, world: {} },
  { id: 'c2', name: '乙', entries: [entry('乙的剑冢', ['剑冢'])], tokenBudget: 1200, world: {} },
];
const r1 = run(scopeOf(members1, [entry('书里的剑冢', ['剑冢'])]));
const dupIssue = r1.issues.find(i => i.code === 'cross-card-duplicate-keys') || null;
check('① 跨卡冲突：同一个触发词出现在两张卡与共享书里 → 报一条，refs 是冲突的触发词',
  !!dupIssue && dupIssue.check === 'cross-card' && dupIssue.level === 'warn'
    && dupIssue.refs.indexOf('剑冢') >= 0, JSON.stringify(dupIssue && dupIssue.refs));
check('①b message 说清「谁和谁共用」与后果（群聊时一句话同时带出）',
  !!dupIssue && dupIssue.message.indexOf('剑冢') >= 0 && dupIssue.message.indexOf('甲') >= 0
    && dupIssue.message.indexOf('共享书') >= 0 && dupIssue.message.indexOf('群聊') >= 0,
  String(dupIssue && dupIssue.message).slice(0, 90));
const r1b = run(scopeOf([
  { id: 'c1', name: '甲', entries: [entry('甲的公会', ['公会'])], tokenBudget: 1200, world: {} },
  { id: 'c2', name: '乙', entries: [entry('乙的剑冢', ['剑冢'])], tokenBudget: 1200, world: {} },
], [entry('书的年表', ['年表'])]));
check('①c 反例：各卡与书的触发词互不重叠 → 一条都不报',
  r1b.issues.length === 0, JSON.stringify(r1b.issues.map(i => i.code)));
check('①d 同一张卡内部重复的 key 不算「跨卡冲突」（那属于单卡世界书的自检）',
  run(scopeOf([{ id: 'c1', name: '甲', entries: [entry('一', ['同词']), entry('二', ['同词'])], tokenBudget: 1200, world: {} }], null))
    .issues.filter(i => i.code === 'cross-card-duplicate-keys').length === 0, '');

// ———————————————— ② 卡内条目与共享书逐字重复 ————————————————
const members2 = [
  { id: 'c1', name: '甲', entries: [entry('共享的年表', ['年表'])], tokenBudget: 1200, world: {} },
  { id: 'c2', name: '乙', entries: [entry('差不多但不完全一样', ['年表'])], tokenBudget: 1200, world: {} },
];
const r2 = run(scopeOf(members2, [entry('共享的年表', ['年表'])]));
const bookDup = r2.issues.find(i => i.code === 'book-duplicate-in-card') || null;
check('② 卡内条目与共享书逐字相同 → 报一条，refs 点名是哪张卡里的副本',
  !!bookDup && bookDup.refs.join(',') === 'c1' && bookDup.message.indexOf('逐字重复') >= 0,
  JSON.stringify(bookDup && { refs: bookDup.refs, msg: bookDup.message.slice(0, 60) }));
check('②b 反例：内容只差一个字 → 不算逐字重复（签名相同也必须在动手前逐字比对）',
  r2.issues.filter(i => i.code === 'book-duplicate-in-card').length === 1, '');
check('②c 包里没有共享书 → 这一项自然不参与（也不崩）',
  run(scopeOf(members2, null)).issues.filter(i => i.code === 'book-duplicate-in-card').length === 0, '');

// ———————————————— ③ 组内五维漂移 ————————————————
const members3 = [
  { id: 'c1', name: '甲', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
  { id: 'c2', name: '乙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇铁门，门后是广播室' } },
  { id: 'c3', name: '丙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
];
const r3 = run(scopeOf(members3, null));
const drift = r3.issues.find(i => i.code === 'world-drift') || null;
check('③ 五维漂移：同一维度两套设定 → 报一条，refs 是维度 key，message 用中文维度名',
  !!drift && drift.refs.join(',') === 'geo' && drift.message.indexOf('地理') >= 0
    && drift.message.indexOf('不一致') >= 0, String(drift && drift.message).slice(0, 80));
check('③b 反例：一方是另一方子串（详略不同）→ 不报；逐字相同也不报',
  run(scopeOf([
    { id: 'c1', name: '甲', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
    { id: 'c2', name: '乙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门，门后是广播室' } },
    { id: 'c3', name: '丙', entries: [], tokenBudget: 1200, world: { geo: '旧校舍的地下有一扇门' } },
  ], null)).issues.length === 0, '');

// ———————————————— ④ 成员卡世界书全 auto ————————————————
const r4 = run(scopeOf([
  { id: 'c1', name: '甲', entries: [entry('年表', ['timeline'], { cc_auto: true }), entry('日常', ['daily'], { cc_auto: true })], tokenBudget: 1200, world: {} },
  { id: 'c2', name: '乙', entries: [entry('年表', ['timeline'], { cc_auto: true }), entry('乙自己的设定', ['乙'])], tokenBudget: 1200, world: {} },
], null));
const autoOnly = r4.issues.find(i => i.code === 'card-auto-only') || null;
check('④ 全 auto 的成员卡 → 报一条并点名（auto 条目以维度名当 key，在组里等于没有自己的设定）',
  !!autoOnly && autoOnly.refs.join(',') === 'c1' && autoOnly.message.indexOf('甲') >= 0,
  JSON.stringify(autoOnly && { refs: autoOnly.refs, msg: autoOnly.message.slice(0, 70) }));
check('④b 反例：只要有一条共创条目就不算全 auto',
  r4.issues.filter(i => i.code === 'card-auto-only').length === 1, '');
check('④c 反例：世界书完全空白的卡不算「全 auto」（那是「没写」，不是「只有自动条目」）',
  run(scopeOf([{ id: 'c1', name: '甲', entries: [], tokenBudget: 1200, world: {} }], null))
    .issues.filter(i => i.code === 'card-auto-only').length === 0, '');

// ———————————————— ⑤ 没有 scope 时整类跳过 ————————————————
const noScope = layer.runGroupChecks({ group: host.normalizeGroup({ id: 'g', name: 'G', rev: 1, nodes: [], edges: [] }),
  members: [], cards: [], sharedEntries: [entry('书里的剑冢', ['剑冢'])] });
check('⑤ 没传 scope（老的 checkGroup 调用点）→ cross-card 整类跳过、不崩、也不误报',
  noScope.issues.filter(i => i.check === 'cross-card').length === 0 && noScope.byCheck['cross-card'] === 0, '');
check('⑤b 但 lore-quality 照常工作（它只需要书条目，不依赖 scope）',
  layer.runGroupChecks({ group: host.normalizeGroup({ id: 'g', name: 'G', rev: 1, nodes: [], edges: [] }),
    members: [], cards: [], sharedEntries: [entry('死条目', [])] }).issues.filter(i => i.check === 'lore-quality').length === 1, '');

// ———————————————— ⑥ 端到端：工具 cc_group_check 报出全部四类 ————————————————
const tools = new Map();
agent.apply({ get() { return null; }, tools: { register(d) { tools.set(d.name, d); } } });
const exec = { agent: { session: { id: 'session-cons-test' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

const A = 'cons-card-a', B = 'cons-card-b', C = 'cons-card-c';
const card = (name, entries) => ({ spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: name, character_book: { name: name + '书', token_budget: 1200, entries: entries }, extensions: {} } });
await host.saveLibraryEntry(card('甲', [entry('甲的公会', ['公会', '剑冢'])]), { id: A });
await host.saveLibraryEntry(card('乙', [entry('乙的剑冢', ['剑冢'])]), { id: B });
await host.saveLibraryEntry(card('丙', [entry('年表', ['timeline'], { cc_auto: true }),
  entry('日常', ['daily'], { cc_auto: true })]), { id: C });
await host.writeGroup({ id: 'grp-cons', name: '一致性组', nodes: [], edges: [] });
await host.assignCardToGroup(A, 'grp-cons');
await host.assignCardToGroup(B, 'grp-cons');
await host.assignCardToGroup(C, 'grp-cons');
await host.writeBook('grp-cons', host.normalizeBook({ data: { name: '一致性组·共享设定',
  entries: [entry('乙的剑冢', ['剑冢']), entry('共享的年表', ['年表'])] } }, 'grp-cons'));
await host.writeDraftOrigin('session-cons-test', A, '甲');

const e2e = await call('cc_group_check', {});
const ccCodes = e2e.issues.filter(i => i.check === 'cross-card').map(i => i.code);
check('⑥ 端到端：一次体检同时报出跨卡冲突 / 卡内-书重复 / 全 auto（三类当场命中）',
  ccCodes.indexOf('cross-card-duplicate-keys') >= 0 && ccCodes.indexOf('book-duplicate-in-card') >= 0
    && ccCodes.indexOf('card-auto-only') >= 0, JSON.stringify(ccCodes));
check('⑥b byCheck 给出每类计数（界面按类分组显示就靠它）',
  e2e.byCheck['cross-card'] === ccCodes.length && e2e.byCheck['cross-card'] >= 3,
  JSON.stringify(e2e.byCheck));
check('⑥c checks:["cross-card"] 只跑这一类，其它类不参与也不误报',
  (await call('cc_group_check', { checks: ['cross-card'] })).issues.every(i => i.check === 'cross-card'), '');
check('⑥d 全部 issue 都带 check 字段（界面不需要猜 code 属于哪一类）',
  e2e.issues.every(i => typeof i.check === 'string' && i.check.length > 0),
  JSON.stringify(e2e.issues.map(i => i.check + ':' + i.code)));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  ' + (r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length === 0 ? 0 : 1);
