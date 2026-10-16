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

// ——————————————————————————————————————————————————————————————
// ⑦ 度量口径：四个「读」类工具必须把共享书算进去（LLM 侧报告的核心）
//    共享书改变了数据的**位置**，度量却还按「卡内就是全部」算 —— simulate 会把「会命中」报成
//    「不会命中」（实测低估约 3 倍）、lint 的最坏情况漏掉共享书的 constant、group_check 的群聊
//    固定开销只算一半、preview_export 让用户以为「世界书就这么多」。此处的场景正是报告里的那一个：
//    卡里只剩私有条目、共享书里躺着「年表」。
// ——————————————————————————————————————————————————————————————
r = await call('cc_simulate_trigger', { text: '年表上写了什么' });
check('⑦ cc_simulate_trigger 把共享书一起模拟，并在命中里标注来源（卡内 / 共享书）',
  r.ok === true && r.results[0].hits.some(h => h.source === 'shared')
    && r.results[0].sharedTokens > 0 && r.sharedBook && r.sharedBook.entries === 1,
  JSON.stringify({ hits: r.results[0].hits.map(h => h.name + '@' + h.source), split: r.tokenSplit }));

r = await call('cc_lint_lorebook', {});
check('⑦b cc_lint_lorebook：tokenSplit / entriesSplit 拆成 卡内 / 共享 / 合计，总量把共享书算进去',
  r.tokenSplit && r.tokenSplit.shared > 0 && r.tokenSplit.total === r.tokenSplit.card + r.tokenSplit.shared
    && r.entriesSplit.shared === 1 && r.lorebookTokens === r.tokenSplit.total && r.worstCase.sharedEntries === 1,
  JSON.stringify({ split: r.tokenSplit, entriesSplit: r.entriesSplit }));

r = await call('cc_group_check', {});
check('⑦c cc_group_check：群聊每轮固定开销拆成 {card, shared, total}（共享书的 constant 同样每轮插入）',
  r.ok === true && r.stats.constantTokens && typeof r.stats.constantTokens === 'object'
    && r.stats.constantTokens.total === r.stats.constantTokens.card + r.stats.constantTokens.shared,
  JSON.stringify(r.stats && r.stats.constantTokens));

r = await call('cc_preview_export', {});
check('⑦d cc_preview_export：明说「本卡所属组另有共享世界书 N 条 / 约 M token」，并给出叠加后的合计',
  r.lorebookSplit && r.lorebookSplit.shared > 0 && r.sharedBook && r.sharedBook.entries === 1
    && r.lorebookSplit.total === r.lorebookSplit.card + r.lorebookSplit.shared
    && r.message.indexOf('共享世界书') >= 0,
  r.sharedBook ? JSON.stringify(r.lorebookSplit) : 'no sharedBook');

const gRaw = JSON.parse(readFileSync(join(host.bookDir(), gid + '.json'), 'utf8'));
check('⑦e 提升时新建的共享书带默认书名 `<组名>·共享设定`（不是一本"匿名书"）',
  gRaw.data.name === '共享书测试组·共享设定', JSON.stringify(gRaw.data.name));

const lastPromote = (gRaw.data.extensions && gRaw.data.extensions.cc) ? gRaw.data.extensions.cc.lastPromote : null;
check('⑦f 提升的收益留存进 extensions.cc.lastPromote（去重完再查也看得到省了多少）',
  !!lastPromote && lastPromote.savedChars > 0 && lastPromote.removed === 2,
  JSON.stringify(lastPromote));

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
  r.ok === false && r.staleBookRev === true && r.actualBookRev === 2 && (await host.readBookRaw(gid)).obj.data.entries.length === 2,
  JSON.stringify({ stale: r.staleBookRev, actual: r.actualBookRev }));

// ——————————————————————————————————————————————————————————————
// ⑧ 提升之后的**草稿同步**（用户报告的第 1、2 条）
//    提升改的是**库里的卡**，而模型正在编辑的是**草稿** —— 两个副本。库里删干净了、草稿里那份
//    还在，模型接着 cc_save_to_library 就会把重复**原样写回卡里**：去重白做，且全程零提示。
//    规则：① 来源卡正是这次被删过条目的卡 → 顺手同步删掉；② 不适用/内容被改过 → 不猜不动，
//    退回一条明确的「保存前先 cc_load_from_library 重新载入」警告。
// ——————————————————————————————————————————————————————————————
const SHARED_TEXT = '@@position after_desc\n【共同设定】三千年前。';
const ddupes = agent.draftBookDupes(
  [{ name: '逐字同', content: '甲 乙' }, { name: '签名同但内容变了', content: '甲\n乙' }, { name: '无关', content: '丙' }],
  [{ name: '逐字同', content: '甲 乙' }, { name: '签名同但内容变了', content: '甲 乙' }]);
check('⑧a draftBookDupes：只认**内容逐字相符**的重复（签名相同但改过内容的一律不动 —— 哈希碰撞不能变成删数据）',
  ddupes.dupes.length === 1 && ddupes.dupes[0].name === '逐字同' && ddupes.kept.length === 2
    && ddupes.kept.some(e => e.name === '签名同但内容变了'),
  JSON.stringify({ dupes: ddupes.dupes.map(e => e.name), kept: ddupes.kept.map(e => e.name) }));

await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '丙角色' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '共用设定', keys: ['共用'], content: SHARED_TEXT },
  { name: '丙私有', keys: ['丙'], content: '丙自己的条目。' },
] });
r = await call('cc_save_to_library', {});
const cardC = r.id;
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '丁角色' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '共用设定', keys: ['共用'], content: SHARED_TEXT },
  { name: '丁私有', keys: ['丁'], content: '丁自己的条目。' },
] });
r = await call('cc_save_to_library', {});
const cardD = r.id;
r = await call('cc_create_group', { name: '草稿同步测试组' });
const g2 = r.group.id;
await call('cc_set_card_group', { cardId: cardC, groupId: g2 });
await call('cc_set_card_group', { cardId: cardD, groupId: g2 });

await call('cc_load_from_library', { id: cardC });   // 现在**草稿**里也有「共用设定」（库里那张卡马上会被删掉）
const revBefore = (await call('cc_get_card', { fields: ['name'] })).draftStatus.rev;
r = await call('cc_promote_shared_entries', { groupId: g2, apply: true });
check('⑧b 来源卡正是被提升的卡 → 库里删的同时**草稿也同步删掉**',
  r.ok === true && r.removedTotal === 2 && r.draftSync.synced === true && r.draftSync.removed === 1
    && r.draftSync.applicable === true && r.draftSync.cardId === cardC,
  JSON.stringify(r.draftSync));
check('⑧c 同步走的是同一套落盘（rev 递增），message 里明说「已同步」、且不再发警告',
  r.draftStatus.rev > revBefore && r.message.indexOf('已同步删掉 1 条') >= 0 && !r.warnings,
  JSON.stringify({ before: revBefore, after: r.draftStatus.rev, warnings: r.warnings || null }));

let draftNow = (await call('cc_get_card', { fields: ['character_book'] })).draft;
check('⑧d 草稿里只剩私有条目（那条共享条目在草稿里也没了）',
  draftNow.data.character_book.entries.length === 1 && draftNow.data.character_book.entries[0].name === '丙私有',
  JSON.stringify(draftNow.data.character_book.entries.map(e => e.name)));

await call('cc_save_to_library', {});
const rawC = JSON.parse(readFileSync(join(host.libDir(), cardC + '.json'), 'utf8'));
check('⑧e 闭环：同步之后再保存，**重复不会复活**（库里仍是 1 条 —— 这正是同步要防的那件事）',
  rawC.draft.data.character_book.entries.length === 1 && rawC.draft.data.character_book.entries[0].name === '丙私有'
    && rawC.meta.loreCount === 1,
  JSON.stringify(rawC.draft.data.character_book.entries.map(e => e.name)));

// 反例：草稿的来源卡这次**没被删过条目**（库里那张卡已无重复），但草稿里又手工加回了同样内容
await call('cc_load_from_library', { id: cardD });
await call('cc_add_lorebook_entries', { entries: [{ name: '共用设定', keys: ['共用'], content: SHARED_TEXT }] });
r = await call('cc_promote_shared_entries', { groupId: g2, apply: true });
check('⑧f 来源卡不适用时不猜、不动手：草稿原样保留，但**明确警告**「这次只改了库里的卡」',
  r.ok === true && r.draftSync.applicable === false && r.draftSync.synced === false
    && r.draftSync.remaining === 1 && Array.isArray(r.warnings)
    && r.warnings.some(w => w.indexOf('cc_load_from_library') >= 0 && w.indexOf('库里的卡') >= 0)
    && r.message.indexOf('只改了库里的卡') >= 0,
  JSON.stringify({ sync: r.draftSync, warnings: r.warnings || [] }));

draftNow = (await call('cc_get_card', { fields: ['character_book'] })).draft;
check('⑧g 警告分支下草稿一个字节都没动（2 条仍在 —— 不适用 ≠ 可以乱删）',
  draftNow.data.character_book.entries.length === 2,
  JSON.stringify(draftNow.data.character_book.entries.map(e => e.name)));

// ——————————————————————————————————————————————————————————————
// ⑨ P0（第二轮报告）：世界书口径 —— 「按最佳实践去重」的卡不许再被判不合格
//    共享书把一部分设定挪到**组**上以后，「≥5 条且至少 1 条共创」这个**收尾判定**却还在只数卡内：
//    用户照推荐做法去重（卡里只留私密条目），`cc_validate` 反而必然失败、`workflow.state.lore`
//    永远 partial —— 只剩两条路（忍着失败 / 把冗余抄回卡里，后者等于取消共享书）。现在统一成合计口径。
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '口径角色', description: '口径测试用', personality: '冷静', scenario: '在测试里' });
await call('cc_patch_world', { autoLorebook: false, timeline: '很久以前的一场大灾', factions: '两个对立的势力', geo: '一座沿海的城' });
await call('cc_add_lorebook_entries', { entries: [
  { name: '私有甲', keys: ['甲'], content: '@@position after_desc\n甲的私设。' },
  { name: '私有乙', keys: ['乙'], content: '乙的私设。', constant: true },
  { name: '私有丙', keys: ['丙'], content: '丙的私设。' },
] });
await call('cc_patch_greetings', { first_mes: '开场白。', alternate_greetings: ['备选一。', '备选二。'], group_only_greetings: ['群聊开场。'] });
r = await call('cc_save_to_library', {});
const cardE = r.id;

r = await call('cc_validate', {});
check('⑨a 基准（还没进组）：卡内 3 条 → 仍判不合格，且错误信息给出「卡内 + 共享书 = 合计」三段',
  r.valid === false && r.loreTotal === 3 && r.sharedLoreCount === 0
    && r.errors.some(e => e.indexOf('卡内 3 条 + 共享书 0 条 = 合计 3 条') >= 0),
  JSON.stringify({ valid: r.valid, errors: r.errors }));

r = await call('cc_create_group', { name: '口径测试组' });
const g3 = r.group.id;
await call('cc_set_card_group', { cardId: cardE, groupId: g3 });
r = await call('cc_patch_shared_book', { groupId: g3, ops: [
  { op: 'addEntry', entry: { name: '年表', keys: ['年表'], content: '@@position after_desc\n共享年表。' } },
  { op: 'addEntry', entry: { name: '势力', keys: ['势力'], content: '共享势力。' } },
  { op: 'addEntry', entry: { name: '地理', keys: ['地理'], content: '共享地理。' } },
  { op: 'addEntry', entry: { name: '力量', keys: ['力量'], content: '共享力量。' } },
  { op: 'addEntry', entry: { name: '日常', keys: ['日常'], content: '共享日常。' } },
] });
check('⑨b 新建共享书的名字默认带上组名（报告 4.2：多个组不再都叫「共享设定」）',
  r.ok === true && r.book.name === '口径测试组·共享设定' && r.book.entries === 5,
  JSON.stringify({ name: r.book.name, entries: r.book.entries }));

await call('cc_load_from_library', { id: cardE });
r = await call('cc_validate', {});
check('⑨c 卡内 3 条 + 共享书 5 条 → **校验通过**，口径与 cc_lint_lorebook 一致（state.lore=ok、三段 token 都在）',
  r.valid === true && r.loreCount === 3 && r.sharedLoreCount === 5 && r.loreTotal === 8
    && r.workflow.state.lore === 'ok' && r.lorebookSplit.shared > 0
    && r.lorebookSplit.total === r.lorebookSplit.card + r.lorebookSplit.shared,
  JSON.stringify({ valid: r.valid, lore: r.workflow.state.lore, split: r.lorebookSplit }));
check('⑨d message 分段显示「卡内 3 + 共享书 5」，并提醒「共享书不跟着卡走」',
  r.message.indexOf('卡内 3 + 共享书 5') >= 0
    && r.warnings.some(w => w.indexOf('共享书不会跟着卡走') >= 0),
  JSON.stringify({ message: r.message.slice(0, 100) }));

r = await call('cc_get_card', {});
check('⑨e cc_get_card 的 workflow 同一口径（state.lore=ok、loreTotal / sharedLoreCount 都在）',
  r.workflow.state.lore === 'ok' && r.workflow.loreTotal === 8 && r.workflow.sharedLoreCount === 5,
  JSON.stringify({ lore: r.workflow.state.lore, total: r.workflow.loreTotal }));

// —— 第三轮报告：`constant` / `@@decorator` 这两条「整本世界书」的存在性检查也必须合计口径 ——
// 只数卡内时，卡里没 constant、共享书里有的卡每次都收到一条无意义的提醒（实测 4 张卡里 3 张如此）。
// 这里把卡内改造成「3 条、全无 @@、无 constant」，共享书第一条则是 constant + 带 @@。
r = await call('cc_get_shared_book', { groupId: g3, includeContent: true });
await call('cc_patch_shared_book', { groupId: g3, ops: [{ op: 'updateEntry', contentKey: r.book.entries[0].contentKey,
  patch: { constant: true, content: '@@position after_desc\n共享年表（常驻）。' } }] });
await call('cc_delete_lorebook_entries', { names: ['私有甲', '私有乙'] });
await call('cc_add_lorebook_entries', { entries: [
  { name: '私有甲新', keys: ['甲'], content: '甲的私设（不写 decorator）。' },
  { name: '私有乙新', keys: ['乙'], content: '乙的私设（不写 decorator）。' },
] });
r = await call('cc_validate', {});
check('⑨f constant 检查与 cc_lint_lorebook 同一口径：卡内 0 条、共享书 1 条 → 不再误报',
  r.valid === true && r.constantEntries.card === 0 && r.constantEntries.shared === 1 && r.constantEntries.total === 1
    && !r.warnings.some(w => w.indexOf('没有任何 constant') >= 0),
  JSON.stringify({ constant: r.constantEntries }));
check('⑨g @@decorator 检查同样看合计：卡内 3 条都没写 @@，但共享书里有 → 不该报',
  !r.warnings.some(w => w.indexOf('@@decorator') >= 0),
  JSON.stringify(r.warnings.filter(w => w.indexOf('@@') >= 0)));

// 第四轮报告：同一个检查点在 `cc_lint_lorebook` 里漏改了 —— 同一份返回里
// `constantEntries: 1`（算上共享书）与「没有 constant 常驻条目」（只数卡内）并列出现。
const validateNow = r;
r = await call('cc_lint_lorebook', {});
check('⑨h cc_lint_lorebook 的存在性检查也用合计口径（第四轮报告：计算改了、判断没换变量）',
  r.constantEntries === 1 && r.entriesSplit.card === 3 && r.entriesSplit.shared === 5
    && !r.issues.some(i => String(i.message).indexOf('没有 constant 常驻条目') >= 0)
    && !r.issues.some(i => String(i.message).indexOf('@@decorator') >= 0),
  JSON.stringify({ constant: r.constantEntries, split: r.entriesSplit, issues: r.issues.map(i => i.message) }));
check('⑨i lint 与 validate 在 constant 口径上完全一致（同一个状态，两个工具同一个结论 —— 收口到 lorebookMetrics 的意义）',
  validateNow.constantEntries.total === 1 && r.constantEntries === validateNow.constantEntries.total,
  JSON.stringify({ lint: r.constantEntries, validate: validateNow.constantEntries }));

// ——————————————————————————————————————————————————————————————
// ⑩ P1（第二轮报告）：回填进卡的副本 —— 「卡 ↔ 共享书」重复必须先**看得见**，再能清掉
//    `cc_apply_shared_book` 是给「客户端不支持全局世界书」的兜底；一旦用户改用支持全局书的客户端，
//    卡里那几份会和共享书**双重插入**（token 翻倍），而此前没有任何工具会告诉他这件事。
// ——————————————————————————————————————————————————————————————
r = await call('cc_apply_shared_book', { groupId: g3, cardId: cardE });
check('⑩a 回填：共享书 5 条并进库里的卡（卡内 3 → 8 条）', r.ok === true && r.added === 5 && r.loreCount === 8, JSON.stringify(r));

r = await call('cc_get_shared_book', { groupId: g3 });
check('⑩b 检测看得见了：bookDuplicates 报「卡 ↔ 共享书」逐字重复（kind=card-vs-book），且 message 说清性质',
  r.bookDuplicates.length === 5 && r.bookDuplicates.every(d => d.kind === 'card-vs-book')
    && r.duplicateStats.bookDuplicatedEntries === 5 && r.duplicateStats.bookSavedChars > 0
    && r.duplicates.length === 0 && r.message.indexOf('逐字重复') >= 0,
  JSON.stringify({ n: r.bookDuplicates.length, stats: r.duplicateStats }));

r = await call('cc_promote_shared_entries', { groupId: g3 });
check('⑩c 提升预览把这类也算候选，但如实报成「清理」而不是「提升」',
  r.ok === true && r.dryRun === true && r.wouldClean === 5 && r.wouldPromote === 0 && r.removedTotal === 5,
  JSON.stringify({ wouldPromote: r.wouldPromote, wouldClean: r.wouldClean, removed: r.removedTotal }));

r = await call('cc_promote_shared_entries', { groupId: g3, apply: true });
check('⑩d apply：清掉卡里 5 份副本，书条数**不变**（书里早就有了，不会重复加）',
  r.ok === true && r.cleaned === 5 && r.promoted === 0 && r.removedTotal === 5 && r.bookEntries === 5,
  JSON.stringify({ cleaned: r.cleaned, promoted: r.promoted, bookEntries: r.bookEntries }));

const rawE = JSON.parse(readFileSync(join(host.libDir(), cardE + '.json'), 'utf8'));
check('⑩e 卡里真的只剩私有的 3 条（往返干净）',
  rawE.draft.data.character_book.entries.length === 3 && rawE.meta.loreCount === 3,
  JSON.stringify(rawE.draft.data.character_book.entries.map(e => e.name)));

r = await call('cc_get_shared_book', { groupId: g3 });
check('⑩f 清完再查：bookDuplicates 归零（不会再静默双份插入）',
  r.bookDuplicates.length === 0 && r.duplicateStats.bookDuplicatedEntries === 0, JSON.stringify(r.duplicateStats));

// ——————————————————————————————————————————————————————————————
// ⑫ 第五轮报告：共享书**自己**的逐条质量检查 —— 这把尺子必须两端都量
//    上一版把「共享书条目的质量走 cc_get_shared_book 那条线」写成了事实，可那条线上只有重复检测：
//    往书里塞一条同时踩三类的坏条目，`cc_get_shared_book` 与 `cc_lint_lorebook` 都不出声（那格是空的）。
//    共享书多卡共用、又没有「卡」这个载体，**比卡内更需要主动报**。
// ——————————————————————————————————————————————————————————————
r = await call('cc_patch_shared_book', { groupId: g3, ops: [{ op: 'addEntry', entry: {
  name: '质量检查测试条目', keys: ['年表', '苹果香蕉'], content: '@@depth 1\n这段正文什么都没提。' } }] });
const badKey = r.applied.length ? r.applied[0].key : '';
check('⑫a 坏条目入书（keys 同时踩：维度名 + 与既有条目冲突 + 正文不含任何 key）',
  r.ok === true && r.applied.length === 1 && !!badKey, JSON.stringify(r.applied));

r = await call('cc_get_shared_book', { groupId: g3 });
const codes = (r.lint && Array.isArray(r.lint.issues)) ? r.lint.issues.map(i => i.code) : [];
check('⑫b cc_get_shared_book 报**这本书自己的**质量问题（带 code / contentKeys / source，可直接定位改）',
  !!r.lint && r.lint.issues.length >= 1 && r.lint.errorCount >= 1
    && codes.indexOf('dim-only-keys') >= 0 && codes.indexOf('key-not-in-content') >= 0 && codes.indexOf('duplicate-keys') >= 0
    && r.lint.issues.some(i => i.contentKeys.indexOf(badKey) >= 0)
    && r.lint.issues.every(i => i.source === 'shared')
    && r.message.indexOf('这本书自身有') >= 0,
  JSON.stringify({ codes: codes, lint: r.lint.issues.map(i => i.code + '@' + i.source) }));

r = await call('cc_lint_lorebook', {});
check('⑫c cc_lint_lorebook 也报同一条，且每条 issue 标了 source（卡内问题与共享书问题分得开）',
  r.issues.some(i => i.source === 'shared' && i.code === 'key-not-in-content')
    // 卡内那 3 条自身没有逐条质量问题 → 不该被这条牵连（`book-unnamed` 之类是另一回事，允许存在）
    && !r.issues.some(i => i.source === 'card' && ['no-keys', 'dim-only-keys', 'key-not-in-content', 'duplicate-keys'].indexOf(i.code) >= 0)
    && r.issues.every(i => !!i.code && !!i.source)
    && r.errorCount >= 1,
  JSON.stringify(r.issues.map(i => i.code + '@' + i.source)));

r = await call('cc_validate', {});
check('⑫d 边界（有意）：cc_validate 是「这张卡」的收尾判定，不列逐条质量清单 —— 共享书的整改清单归 lint / get_shared_book',
  r.valid === true && !r.warnings.some(w => String(w).indexOf('keys 只有维度名') >= 0 || String(w).indexOf('keys 在自身 content') >= 0),
  JSON.stringify(r.warnings));

await call('cc_patch_shared_book', { groupId: g3, ops: [{ op: 'removeEntry', contentKey: badKey }] });
r = await call('cc_get_shared_book', { groupId: g3 });
check('⑫e 清掉坏条目后：与它相关那条消失，而「keys 只有维度名」仍在（那 5 条的 keys 本就只有维度名 —— 这正是新检查的价值）',
  r.lint.issues.every(i => i.code !== 'key-not-in-content') && r.lint.issues.some(i => i.code === 'dim-only-keys'),
  JSON.stringify(r.lint.issues.map(i => i.code + '@' + i.source)));

// ——————————————————————————————————————————————————————————————
// ⑪ 轻项（第二轮报告 4.1）：删组盘点要提共享世界书 —— 那是「会被删掉且不可恢复」的东西
// ——————————————————————————————————————————————————————————————
r = await call('cc_delete_group', { groupId: g3 });
check('⑪ 盘点（不带 confirm）把共享世界书也算进破坏性提示里',
  r.ok === false && r.needConfirm === true && r.hasBook === true && r.bookEntries === 5
    && r.message.indexOf('共享世界书 5 条') >= 0 && r.message.indexOf('也会一并删除') >= 0,
  JSON.stringify({ entries: r.bookEntries, msg: r.message.slice(0, 130) }));

r = await call('cc_delete_group', { groupId: g3, confirm: true });
check('⑪b 带 confirm 真删：共享书一并删除（不留孤儿文件）',
  r.ok === true && r.bookDeleted === true && (await host.readBookRaw(g3)) === null, '');

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
