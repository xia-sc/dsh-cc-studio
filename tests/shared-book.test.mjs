/**
 * 组级共享世界书（0.9.0）回归测试 —— 不随插件发布，files 未含 tests。
 *
 * 背景：群聊卡的世界设定在每张成员卡里**逐字重复**。实测锁天司那组 4 张卡共 20 条，
 * 其中 5 条（年表/势力/地理/力量体系/日常）完全相同 —— 约 4500 字符纯冗余，改一条要改 4 遍。
 * CCv3 规范给了两个依据：① Lorebook 可以**单独导出**（`{ spec:"lorebook_v3", data }`）；
 * ② `character_book` 是「角色专属」的那一本，应与全局 lorebook **叠加**。
 * 于是把共享设定提到组级独立文件（`<DSH_HOME>/cc-books/<groupId>.json`），卡里只留私有条目。
 *
 * 本文件钉住的不变式（坏了会静默丢用户数据）：
 *   · 提升/回填是**零转换搬运** —— 条目字段逐字保留（含 `cc_auto` / `extensions` / `id` 这类非标准字段）
 *   · **只删内容逐字相符的条目**（签名只用来筛，绝不按哈希删数据）；二次提升幂等
 *   · 默认 dryRun —— `apply:true` 才动手；删条目后卡条目 meta 的其余字段原样保留（B4 的教训）
 *   · 两半（lib/index.js / lib/agent.js）纯函数输出一致、落盘根一致
 *
 * 运行：node tests/shared-book.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-book-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const tools = new Map();
agent.apply({ get() { return null; }, tools: { register(d) { tools.set(d.name, d); } } });
const exec = { agent: { session: { id: 'session-book-test' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

// ——————————————————————————————————————————————————————————————
// ① 纯函数：签名、结构兜底与保真
// ——————————————————————————————————————————————————————————————
check('① contentKeyOf：只差空白/换行的两条算同一条（实测里自动条目与手工条目常差这点空白）',
  host.contentKeyOf({ content: '甲\n\n乙  丙' }) === host.contentKeyOf({ content: ' 甲 乙 丙 ' })
    && host.contentKeyOf({ content: '甲' }) !== host.contentKeyOf({ content: '乙' }),
  host.contentKeyOf({ content: '甲\n乙' }));

const raw = {
  spec: 'lorebook_v3',
  顶层未知字段: '也要保留',
  data: {
    name: '锁天司·共享',
    scan_depth: 5,
    自定义顶层字段: '要保留',
    entries: [{ keys: ['甲'], content: '内容甲', name: '甲条', cc_auto: true, id: 42, priority: 7, extensions: { cc_world_ref: 'timeline' }, 未知字段: '要保留' }],
  },
};
const norm = host.normalizeBook(raw, 'g-book');
check('①b normalizeBook：补 spec/token_budget/recursive_scanning，rev 挂到 data.extensions.cc（规范允许的 application specific 位置）',
  norm.spec === 'lorebook_v3' && norm.data.token_budget === 2000 && norm.data.recursive_scanning === false
    && norm.data.extensions.cc.groupId === 'g-book' && norm.data.extensions.cc.rev === 0,
  JSON.stringify(norm.data.extensions.cc));
check('①c normalizeBook **保真**：未知顶层字段、未知条目字段、cc_auto / id / priority / extensions 一个都不许丢',
  norm.顶层未知字段 === '也要保留' && norm.data.自定义顶层字段 === '要保留' && norm.data.entries[0].未知字段 === '要保留'
    && norm.data.entries[0].cc_auto === true && norm.data.entries[0].id === 42 && norm.data.entries[0].priority === 7
    && norm.data.entries[0].extensions.cc_world_ref === 'timeline',
  JSON.stringify(norm.data.entries[0]));
check('①d 两半 contentKeyOf / normalizeBook 输出一致（同构实现不许漂移）',
  host.contentKeyOf(norm.data.entries[0]) === agent.contentKeyOf(norm.data.entries[0])
    && JSON.stringify(host.normalizeBook(raw, 'g-book')) === JSON.stringify(agent.normalizeBook(raw, 'g-book')),
  '');

// ——————————————————————————————————————————————————————————————
// ② 扫描：哪些条目算「重复」
// ——————————————————————————————————————————————————————————————
const shared = { keys: ['年表'], content: '@@position after_desc\n【三千年前】天门开。', name: '年表' };
const cards = [
  { id: 'c1', name: '谢无咎', entries: [shared, { keys: ['印'], content: '司主印。', name: '司主的玄皮簿子' }] },
  { id: 'c2', name: '云中君', entries: [shared, { keys: ['名'], content: '她没有名字。', name: '一个没有名字的人' }] },
  { id: 'c3', name: '白十三', entries: [{ keys: ['丹'], content: '续命丹。', name: '续命丹' }, { keys: ['年表'], content: '@@position after_desc\n【三千年前】天门开。', name: '年表（抄的）' }] },
];
const scan = host.scanSharedEntries(cards);
check('② 扫描：出现在 ≥2 张卡里的内容才算候选（这里只有「年表」）',
  scan.candidates.length === 1 && scan.candidates[0].signature === host.contentKeyOf(shared)
    && scan.candidates[0].cards.length === 3,
  JSON.stringify(scan.candidates.map(c => ({ name: c.name, cards: c.cards.length }))));
check('②b 同内容不同名要如实标注（nameMismatch），不替用户下结论',
  scan.candidates[0].nameMismatch === true && scan.candidates[0].cardNames.join(',') === '谢无咎,云中君,白十三',
  JSON.stringify({ nameMismatch: scan.candidates[0].nameMismatch, cardNames: scan.candidates[0].cardNames }));
check('②c 统计：重复条目数 = 各卡出现次数之和，savedChars = 内容长度 ×(卡数-1)',
  scan.stats.cards === 3 && scan.stats.totalEntries === 6 && scan.stats.duplicatedEntries === 3
    && scan.stats.savedChars === shared.content.length * 2,
  JSON.stringify(scan.stats));
check('②d 两半扫描一致', JSON.stringify(host.scanSharedEntries(cards)) === JSON.stringify(agent.scanSharedEntries(cards)), '');

// ——————————————————————————————————————————————————————————————
// ③ 提升：搬运 + 去重，且只删内容相符的
// ——————————————————————————————————————————————————————————————
const sig = scan.candidates[0].signature;
const plan = host.applyBookPromotion(cards, [], [sig]);
check('③ 提升：候选进共享书一份，各卡里的副本被删掉（3 张卡共删 3 条）',
  plan.bookEntries.length === 1 && plan.removedTotal === 3
    && plan.cards.every(c => !c.entries.some(e => host.contentKeyOf(e) === sig)),
  JSON.stringify(plan.cards.map(c => ({ n: c.name, removed: c.removed, left: c.entries.length }))));
check('③b 提升搬运**逐字保真**：共享书里的条目与卡里原来那条逐字段相同',
  JSON.stringify(plan.bookEntries[0]) === JSON.stringify(host.makeBookEntry(shared)), '');
check('③c 只删内容相符的：不相干的条目一条不动（各卡私有条目仍在）',
  plan.cards[0].entries.length === 1 && plan.cards[0].entries[0].name === '司主的玄皮簿子'
    && plan.cards[2].entries.length === 1 && plan.cards[2].entries[0].name === '续命丹', '');
const plan2 = host.applyBookPromotion(plan.cards, plan.bookEntries, [sig]);
check('③d 二次提升幂等：共享书不会多出一条，卡里也没东西可删',
  plan2.bookEntries.length === 1 && plan2.removedTotal === 0, JSON.stringify({ book: plan2.bookEntries.length, removed: plan2.removedTotal }));
check('③e 两半提升结果一致', JSON.stringify(host.applyBookPromotion(cards, [], [sig])) === JSON.stringify(agent.applyBookPromotion(cards, [], [sig])), '');

// ——————————————————————————————————————————————————————————————
// ④ 回填：合并进卡（同内容跳过）
// ——————————————————————————————————————————————————————————————
// 回填用「提升之后的卡」（只剩私有条目）—— 用提升前的卡会因为同内容已存在而加 0 条（那正是幂等）
const merged = host.mergeBookEntries(plan.bookEntries, plan.cards[0].entries);
check('④ 回填：共享条目补进卡里、且同内容不重复添加',
  merged.added.length === 1 && merged.entries.length === 2, JSON.stringify(merged.entries.map(e => e.name)));
check('④b 回填幂等：再来一次加 0 条（同内容已在卡里）',
  host.mergeBookEntries(plan.bookEntries, merged.entries).added.length === 0
    && host.mergeBookEntries(plan.bookEntries, cards[0].entries).added.length === 0,
  '');
check('④c 两半回填一致', JSON.stringify(host.mergeBookEntries(plan.bookEntries, plan.cards[0].entries)) === JSON.stringify(agent.mergeBookEntries(plan.bookEntries, plan.cards[0].entries)), '');

// ——————————————————————————————————————————————————————————————
// ⑤ 落盘：rev 递增、读回、删书、两半同根
// ——————————————————————————————————————————————————————————————
check('⑤ 两半落盘根一致（同一台机器上必须是同一个 cc-books 目录）',
  JSON.stringify(host.bookDirs()) === JSON.stringify(agent.bookDirs()) && host.bookPath('g1') === agent.bookPath('g1'),
  host.bookPath('g1'));
const saved1 = await host.writeBook('g-sbook', { data: { name: '共享书', entries: [shared] } });
const saved2 = await host.writeBook('g-sbook', { data: { name: '共享书（改名）', entries: [shared] } });
check('⑤b writeBook：首次 rev=1、再次 rev=2（与 writeGroup 同一套乐观锁语义），名字改了',
  host.bookRevOf(saved1) === 1 && host.bookRevOf(saved2) === 2 && saved2.data.name === '共享书（改名）',
  JSON.stringify({ r1: host.bookRevOf(saved1), r2: host.bookRevOf(saved2) }));
const back = await host.readBookRaw('g-sbook');
check('⑤c 读回：工具半读得到宿主半写的书（同一份文件）',
  !!back && agent.bookRevOf(back.obj) === 2 && (await agent.readBookRaw('g-sbook')) !== null, '');
check('⑤d 落盘的文件本身就是可发布的 lorebook_v3 JSON（spec + data.entries）',
  JSON.parse(readFileSync(host.bookPath('g-sbook'), 'utf8')).spec === 'lorebook_v3', '');
check('⑤e deleteBook 真的删掉（返回 true），再删返回 false',
  (await host.deleteBook('g-sbook')) === true && (await agent.deleteBook('g-sbook')) === false, '');

// ——————————————————————————————————————————————————————————————
// ⑥ 端到端（工具半）：建组 → 两张重复的卡 → 扫描 → 提升 → 回填
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '甲角色' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '年表', keys: ['年表'], content: '@@position after_desc\n【共同设定】三千年前。' },
  { name: '甲私有', keys: ['甲'], content: '只有甲有的条目。' },
] });
let r = await call('cc_save_to_library', {});
const cardA = r.id;
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '乙角色' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '年表', keys: ['年表'], content: '@@position after_desc\n【共同设定】三千年前。' },
  { name: '乙私有', keys: ['乙'], content: '只有乙有的条目。' },
] });
r = await call('cc_save_to_library', {});
const cardB = r.id;

r = await call('cc_create_group', { name: '共享书测试组' });
const gid = r.group.id;
await call('cc_set_card_group', { cardId: cardA, groupId: gid });
await call('cc_set_card_group', { cardId: cardB, groupId: gid });

r = await call('cc_get_shared_book', {});
check('⑥ cc_get_shared_book：还没建书时明确告知，并报出「有几条重复、能省多少字符」',
  r.ok === true && r.exists === false && r.duplicates.length === 1 && r.duplicateStats.savedChars > 0,
  JSON.stringify({ dup: r.duplicates.length, saved: r.duplicateStats.savedChars }));

r = await call('cc_promote_shared_entries', {});
const dupSig = r.duplicates[0].signature;
check('⑥b 提升默认只预览（dryRun）：不写盘、报出将删几条', r.ok === true && r.dryRun === true && r.removedTotal === 2 && r.wouldPromote === 1,
  JSON.stringify({ dryRun: r.dryRun, removed: r.removedTotal }));
check('⑥c 预览时书还没被创建（dryRun 真的没副作用）', (await host.readBookRaw(gid)) === null, '');

r = await call('cc_promote_shared_entries', { apply: true, keys: [dupSig] });
check('⑥d apply:true 才动手：共享书里 1 条、两张卡各删 1 条',
  r.ok === true && r.promoted === 1 && r.removedTotal === 2 && r.bookEntries === 1
    && r.perCard.every(c => c.removed === 1 && c.left === 1),
  JSON.stringify({ promoted: r.promoted, perCard: r.perCard }));

const rawA = JSON.parse(readFileSync(join(host.libDir(), cardA + '.json'), 'utf8'));
check('⑥e 提升后卡里只剩私有条目，**meta 的其余字段原样保留**（只更新 loreCount/updatedAt —— B4 的教训）',
  rawA.draft.data.character_book.entries.length === 1 && rawA.draft.data.character_book.entries[0].name === '甲私有'
    && rawA.meta.id === cardA && rawA.meta.groupId === gid && rawA.meta.loreCount === 1,
  JSON.stringify({ entries: rawA.draft.data.character_book.entries.map(e => e.name), loreCount: rawA.meta.loreCount, groupId: rawA.meta.groupId }));

r = await call('cc_get_shared_book', { includeContent: true });
check('⑥f 提升后：书里有 1 条（带全文）、卡片间已无重复、条目字段与卡内同构（keys/content/name 都在）',
  r.exists === true && r.book.entries.length === 1 && r.duplicates.length === 0
    && r.book.entries[0].content.indexOf('三千年前') >= 0 && r.book.entries[0].keys[0] === '年表',
  JSON.stringify({ entries: r.book.entries.length, dup: r.duplicates.length }));

r = await call('cc_apply_shared_book', { cardId: cardA, dryRun: true });
check('⑥g 回填预览：这张卡会补回 1 条', r.ok === true && r.dryRun === true && r.wouldAdd === 1, JSON.stringify(r));
r = await call('cc_apply_shared_book', { cardId: cardA });
check('⑥h 回填执行：卡里变回 2 条，再填一次加 0 条（幂等）',
  r.added === 1 && r.loreCount === 2 && (await call('cc_apply_shared_book', { cardId: cardA })).added === 0,
  JSON.stringify({ added: r.added, loreCount: r.loreCount }));

r = await call('cc_patch_shared_book', { name: '共享设定集', ops: [{ op: 'addEntry', entry: { keys: ['势力'], content: '锁天司四职：司主/剑侍/丹修/录事。', name: '势力' } }] });
check('⑥i cc_patch_shared_book：加条目 + 改书名，rev 递增、回执 applied/rejected 分离',
  r.ok === true && r.changed === true && r.applied.length === 2 && r.rejected.length === 0 && r.bookRev === 2 && r.book.entries === 2,
  JSON.stringify({ rev: r.bookRev, entries: r.book.entries, applied: r.applied.length }));

r = await call('cc_patch_shared_book', { expectedBookRev: 999, ops: [{ op: 'addEntry', entry: { keys: ['x'], content: '不该写进去' } }] });
check('⑥j 乐观锁：expectedBookRev 不符 → 拒绝且零副作用',
  r.ok === false && r.staleRev === true && r.actualBookRev === 2 && (await host.readBookRaw(gid)).obj.data.entries.length === 2,
  JSON.stringify({ stale: r.staleRev, actual: r.actualBookRev }));

r = await call('cc_delete_group', { groupId: gid, confirm: true });
check('⑥k 删组时共享世界书一并删除（不留孤儿文件），成员卡本身还在',
  r.ok === true && r.bookDeleted === true && (await host.readBookRaw(gid)) === null
    && (await host.listLibraryEntries()).some(e => e.id === cardA),
  JSON.stringify({ bookDeleted: r.bookDeleted }));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
