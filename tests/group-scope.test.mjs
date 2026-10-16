/**
 * 卡组层（0.10.0）回归测试之一：**卡库快照 + 卡组作用域**。
 *
 * 背景：共享书把一部分世界设定挪到了「组」上之后，每个工具都自己写了一遍「来源卡 → meta.groupId
 * → 读那本组共享书」，于是连着两轮出现「改了四个、漏了第五个」。0.10.0 起卡组数据只从这一个入口出：
 *   readLibrarySnapshot() —— 一次遍历 + 一次 parse，meta 与 draft 一起留下（以前解析完就把 draft 丢了）
 *   groupScope()          —— 哪个组 / 组里有哪些卡 / 这本书是什么，纯组装在 lib/group-layer.js（两半共用）
 *
 * 本文件钉住的不变式：
 *   · 两半（lib/index.js 宿主半 / lib/agent.js 预设半）对同一份磁盘数据算出**逐字相同**的作用域
 *   · 快照只读一次盘：传了 snapshot 就用它（用「磁盘上不存在的卡」反证，禁止偷偷回读）
 *   · 成员摘要里的 entries 是**原始条目数组**（计数是 groupMetrics 的口径，不在这层产生）
 *   · 拿不到卡 / 没入组 / 组不存在 / 组无书 → 形状完整的空作用域（调用方无需判空）
 *   · groupScope 是纯读：跑完三个落盘根一个字节都不变
 *
 * 运行：node tests/group-scope.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-gscope-'));
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
function cardDraft(name, entries, budget) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: name, description: name + ' 的简介', personality: '', scenario: '', first_mes: '', tags: [],
    character_book: { name: name + '书', description: '', scan_depth: 4, token_budget: budget || 1200,
      recursive_scanning: false, extensions: {}, entries: entries || [] },
    extensions: {},
  } };
}

// ———————————————— 造数据：3 张卡（2 张入组）+ 1 组 + 1 本共享书 ————————————————
const A = 'card-a', B = 'card-b', C = 'card-c';
await host.saveLibraryEntry(cardDraft('甲', [entry('甲的私密设定', ['甲']), entry('共用的年表', ['年表'], { constant: true })]), { id: A });
await host.saveLibraryEntry(cardDraft('乙', [entry('乙的私密设定', ['乙'])], 2000), { id: B });
await host.saveLibraryEntry(cardDraft('丙', [entry('丙的设定', ['丙'])]), { id: C });
await host.writeGroup({ id: 'grp-a', name: '甲组', nodes: [], edges: [] });
await host.assignCardToGroup(A, 'grp-a');
await host.assignCardToGroup(B, 'grp-a');
await host.writeBook('grp-a', host.normalizeBook({ data: { name: '甲组·共享设定', entries: [
  entry('共享的年表', ['年表']), entry('共享的地理', ['地理']), entry('停用的条目', ['停用'], { enabled: false }),
] } }, 'grp-a'));
// 一个空组（有成员、没有书），和一个「有书没成员」的组
await host.writeGroup({ id: 'grp-empty', name: '空书组', nodes: [], edges: [] });
await host.saveLibraryEntry(cardDraft('丁', [entry('丁的设定', ['丁'])]), { id: 'card-d' });
await host.assignCardToGroup('card-d', 'grp-empty');

// ———————————————— ① 卡库快照 ————————————————
const snap = await host.readLibrarySnapshot();
check('① readLibrarySnapshot：每张卡都带 meta 与 draft（以前解析完就把 draft 丢了 → 组体检要重读一遍盘）',
  snap.length === 4 && snap.every(r => r.meta && r.meta.id === r.id && r.draft && r.draft.data),
  JSON.stringify(snap.map(r => r.id + '/' + (r.draft ? 'draft' : 'none'))));
check('①b 快照是 listLibraryEntries 的来源：两者的 meta 列表逐字一致（旧的签名与排序语义未变）',
  same((await host.listLibraryEntries()).map(m => m.id), snap.map(r => r.meta.id)),
  JSON.stringify(snap.map(r => r.meta.id)));

// 旧格式兜底：只有 draft、没有 meta/id 的文件（0.3.x 之前的形态）
writeFileSync(join(host.libDirs()[0], 'legacy-1.json'), JSON.stringify({ draft: cardDraft('旧格式卡', [entry('旧', ['旧'])]) }), 'utf8');
const snap2 = await host.readLibrarySnapshot();
const legacy = snap2.find(r => r.id === 'legacy-1') || null;
check('①c 旧格式（只有 draft）照样进快照：meta 由 makeLibraryEntryMeta 重建',
  !!legacy && legacy.meta.name === '旧格式卡' && legacy.draft.data.character_book.entries.length === 1,
  JSON.stringify(legacy && legacy.meta && legacy.meta.name));

// ———————————————— ② groupScope 基本形状 ————————————————
const sA = await host.groupScope({ groupId: 'grp-a' });
check('② groupScope：ok/groupId/rev 正确，成员卡按 meta.groupId 派生',
  sA.ok === true && sA.groupId === 'grp-a' && sA.rev === sA.group.rev
    && sA.memberIds.slice().sort().join(',') === 'card-a,card-b',
  JSON.stringify({ ok: sA.ok, ids: sA.memberIds }));
const m0 = sA.members.find(m => m.id === A);
check('②b 成员摘要：entries 是**原始条目数组**（不是计数），且 name / groupId / tokenBudget 都在',
  !!m0 && Array.isArray(m0.entries) && m0.entries.length === 2 && m0.name === '甲'
    && m0.groupId === 'grp-a' && m0.tokenBudget === 1200,
  JSON.stringify(m0 && { entries: Array.isArray(m0.entries) ? m0.entries.length : 'not-array', name: m0.name, budget: m0.tokenBudget }));
check('②c 默认不带 draft（省内存）；include:"full" 才带',
  !('draft' in m0) && (await host.groupScope({ groupId: 'grp-a', include: 'full' })).members.find(m => m.id === A).draft.data.name === '甲',
  JSON.stringify(Object.keys(m0)));

// ———————————————— ③ 共享书段 ————————————————
check('③ book 段：name / rev / entries（enabled:false 已过滤）/ lastPromote 都在',
  !!sA.book && sA.book.name === '甲组·共享设定' && sA.book.rev === 1
    && sA.book.entries.length === 2 && sA.book.entries.every(e => e.enabled !== false)
    && sA.book.lastPromote === null,
  JSON.stringify({ name: sA.book && sA.book.name, rev: sA.book && sA.book.rev, n: sA.book && sA.book.entries.length }));
check('③b 组里没有书 → ok:true 但 book:null（不是错误：组可以先建卡后建书）',
  (await host.groupScope({ groupId: 'grp-empty' })).ok === true
    && (await host.groupScope({ groupId: 'grp-empty' })).book === null,
  '');

// ———————————————— ④ 空作用域的四种来路 ————————————————
const sC = await host.groupScope({ cardId: C });
check('④ 卡没入组 → ok:false、groupId 空、members 空（形状完整，调用方不用判空）',
  sC.ok === false && sC.groupId === '' && sC.members.length === 0 && sC.book === null && sC.truncated === false,
  JSON.stringify({ ok: sC.ok, groupId: sC.groupId }));
const sNone = await host.groupScope({});
check('④b 完全没给输入 → ok:false、cardId 空、missing 空',
  sNone.ok === false && sNone.cardId === '' && sNone.missing.length === 0, JSON.stringify(sNone.missing));
const sGhost = await host.groupScope({ groupId: 'nope-1' });
check('④c 显式传的组不存在 → ok:false，但 groupId 原样回显（便于调用方报错说清是哪个组）',
  sGhost.ok === false && sGhost.groupId === 'nope-1', JSON.stringify(sGhost.groupId));
const sBad = await host.groupScope({ groupId: '@@@' });
check('④d 非法 groupId（safeGroupId 归一成空）→ 视为没有组，不去猜一个文件',
  sBad.ok === false && sBad.groupId === '', JSON.stringify(sBad.groupId));

// ———————————————— ⑤ cardId / sessionKey 两条来源路径 ————————————————
const sByCard = await host.groupScope({ cardId: A });
check('⑤ 传 cardId：组从库条目 meta.groupId 解析出来（界面侧就是这条路）',
  sByCard.ok === true && sByCard.groupId === 'grp-a' && sByCard.cardId === A, JSON.stringify(sByCard.groupId));
await host.writeDraftOrigin('sess-1', A, '甲');
const sBySess = await agent.groupScope({ sessionKey: 'sess-1' });
check('⑤b 传 sessionKey：组从草稿 sidecar（origin.json）的来源卡解析（模型侧就是这条路）',
  sBySess.ok === true && sBySess.groupId === 'grp-a' && sBySess.cardId === A && sBySess.memberIds.length === 2,
  JSON.stringify({ gid: sBySess.groupId, cardId: sBySess.cardId }));
await host.writeDraftOrigin('sess-2', 'ghost-9', '已删掉的卡');
const sGhostCard = await agent.groupScope({ sessionKey: 'sess-2' });
check('⑤c 来源卡已被删除 → ok:false 且 missing 里点名那张卡（不静默当成「没入组」）',
  sGhostCard.ok === false && sGhostCard.cardId === 'ghost-9' && sGhostCard.missing.join(',') === 'ghost-9',
  JSON.stringify(sGhostCard.missing));

// ———————————————— ⑥ 只读一次盘（用「磁盘上不存在的卡」反证） ————————————————
const fakeSnap = [{ id: 'fake-1', dir: '', meta: { id: 'fake-1', name: '假卡', groupId: 'grp-a', updatedAt: 1 },
  draft: cardDraft('假卡', [entry('假', ['假'])]) }];
const sFake = await host.groupScope({ groupId: 'grp-a', snapshot: fakeSnap });
check('⑥ 传 snapshot 就**只用**它：成员里出现的是快照里的假卡（证明没有偷偷回读盘）',
  sFake.memberIds.length === 1 && sFake.memberIds[0] === 'fake-1' && sFake.members[0].name === '假卡',
  JSON.stringify(sFake.memberIds));

// ———————————————— ⑦ maxCards / truncated ————————————————
await host.writeGroup({ id: 'grp-big', name: '大组', nodes: [], edges: [] });
for (const id of ['big-1', 'big-2', 'big-3']) {
  await host.saveLibraryEntry(cardDraft('大' + id, [entry('x', ['x'])]), { id });
  await host.assignCardToGroup(id, 'grp-big');
}
const sBig = await host.groupScope({ groupId: 'grp-big', maxCards: 2 });
check('⑦ maxCards：只返回前 N 张成员卡并置 truncated（组很大时不把整组卡灌进内存）',
  sBig.memberIds.length === 2 && sBig.members.length === 2 && sBig.truncated === true,
  JSON.stringify({ n: sBig.memberIds.length, truncated: sBig.truncated }));
check('⑦b 不传 maxCards：默认上限 50，这组 3 张全在、truncated=false',
  (await host.groupScope({ groupId: 'grp-big' })).truncated === false, '');

// ———————————————— ⑧ 两半逐字同构 ————————————————
const hScope = await host.groupScope({ groupId: 'grp-a', include: 'full' });
const aScope = await agent.groupScope({ groupId: 'grp-a', include: 'full' });
check('⑧ 两半 groupScope 对同一份磁盘数据输出**逐字相同**（纯组装共用 lib/group-layer.js）',
  same(hScope, aScope), JSON.stringify({ host: hScope.memberIds, agent: aScope.memberIds }));
check('⑧b 空作用域也逐字相同（最短路径最容易两边写得不一样）',
  same(await host.groupScope({}), await agent.groupScope({})), '');

// ———————————————— ⑨ libraryCardsFor 改造后语义不变 ————————————————
const cards = await host.libraryCardsFor([A, 'ghost-x']);
const cardA = cards.find(c => c.id === A) || null;
check('⑨ libraryCardsFor：卡不在库里照样跳过（原实现是读盘抛错→跳过），摘要数字不变',
  cards.length === 1 && !!cardA && cardA.name === '甲' && cardA.constantTokens > 0 && cardA.tokenBudget === 1200,
  JSON.stringify(cards.map(c => c.id)));
check('⑨b 两半 libraryCardsFor 输出逐字相同',
  same(await host.libraryCardsFor([A, B]), await agent.libraryCardsFor([A, B])), '');

// ———————————————— ⑩ 纯读：跑完三个落盘根一个字节不变 ————————————————
function dirsDump() {
  const out = [];
  for (const d of [host.libDirs()[0], host.groupDirs()[0], host.bookDirs()[0]]) {
    let files = [];
    try { files = readdirSync(d); } catch { continue; }
    files.slice().sort().forEach(f => { out.push(f + ':' + readFileSync(join(d, f), 'utf8')); });
  }
  return out.join('\n');
}
const before = dirsDump();
await host.groupScope({ groupId: 'grp-a' });
await agent.groupScope({ sessionKey: 'sess-1' });
await host.groupScope({ groupId: 'nope-2' });
check('⑩ groupScope 是纯读：库 / 组 / 书三个落盘根的内容逐字未变（体检动作绝不能改数据）',
  dirsDump() === before, '');

// ———————————————— ⑪ 纯函数层单独可用 ————————————————
const pure = layer.assembleScope({ groupId: 'g', group: { id: 'g', name: 'G', rev: 3 }, cards: [], book: null });
check('⑪ group-layer.assembleScope 可独立调用（零 IO）：只吃数据、只出形状',
  pure.ok === true && pure.rev === 3 && pure.members.length === 0 && pure.book === null && pure.truncated === false,
  JSON.stringify({ ok: pure.ok, rev: pure.rev }));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  ' + (r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length === 0 ? 0 : 1);
