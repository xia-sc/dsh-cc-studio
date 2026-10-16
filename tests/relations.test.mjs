/**
 * 人物关系图谱（0.8.0）回归测试 —— 不随插件发布，files 未含 tests。
 *
 * 背景：群聊场景要「一批有关系的卡」。CCv3 没有关系字段，所以设计成两层：
 *   ① 插件层关系图谱（<DSH_HOME>/cc-groups/<id>.json，三维：方向 × 类型 × 强度）是真源；
 *   ② 用 cc_render_relations 把它渲染进 description 的固定标记区，让分享出去的卡自包含。
 * 「卡属于哪个组」记在库条目 meta.groupId（单一真源），分组文件里**不存成员列表**。
 *
 * 本文件钉住的是**不变式**（这些坏了会静默丢用户数据或不一致）：
 *   · 两半（lib/index.js / lib/agent.js）的同构实现必须逐字一致 —— 渲染输出、落盘根
 *   · normalizeGroup 不得丢弃端点不存在的边（那是用户数据，只报错不删除）
 *   · spliceRelations 必须幂等（重复渲染不能越写越长）、能替换、能一键清空
 *   · 非法 op 只进 rejected，不能半途改坏图谱
 *   · expectedRev 不符 → 拒绝且零副作用
 *   · 删卡只把节点降级为 orphan（保留边）、改名同步节点名
 *
 * 运行：node tests/relations.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-rel-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const tools = new Map();
agent.apply({ get() { return null; }, tools: { register(d) { tools.set(d.name, d); } } });
const exec = { agent: { session: { id: 'session-rel-test' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

// ——————————————————————————————————————————————————————————————
// ① 纯函数：结构兜底与 op 校验
// ① 纯函数：结构兜底与 op 校验
// ——————————————————————————————————————————————————————————————
const messy = host.normalizeGroup({
  id: 'g1', name: '组',
  nodes: [{ id: 'n1', kind: 'card', cardId: 'c1', name: '甲' }, { id: 'n2', name: '柳长老' }, { name: '没有 id' }],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'mentor', strength: 99, direction: 'weird' },
    { id: 'e2', from: 'n1', to: 'nx' },      // 端点不存在 —— 必须保留（用户数据）
  ],
});
check('① normalizeGroup：补齐 seq/rev/updatedAt 等缺省字段，并丢掉没有 id 的节点',
  messy.nextNodeSeq === 3 && messy.nextEdgeSeq === 3 && messy.rev === 0 && messy.nodes.length === 2,
  JSON.stringify({ nodes: messy.nodes.length, nextNodeSeq: messy.nextNodeSeq, rev: messy.rev }));
check('①b normalizeGroup：strength 夹到 1..5、direction 归一到 one-way、type 未知归 other',
  messy.edges[0].strength === 5 && messy.edges[0].direction === 'one-way' && messy.edges[0].type === 'mentor',
  JSON.stringify(messy.edges[0]));
check('①c normalizeGroup：**不丢弃**端点不存在的边（交给体检报 dangling-edge，绝不静默删数据）',
  messy.edges.length === 2 && messy.edges[1].to === 'nx', JSON.stringify(messy.edges.map(e => e.id)));

const base = host.normalizeGroup({ id: 'g2', name: '校验组', nodes: [{ id: 'n1', name: '甲' }, { id: 'n2', name: '乙' }], edges: [] });
check('①d validateGroupOp：strength 越界被拒', !!host.validateGroupOp(base, { op: 'addEdge', from: 'n1', to: 'n2', strength: 9 }), '');
check('①e validateGroupOp：from 不存在被拒', !!host.validateGroupOp(base, { op: 'addEdge', from: 'nx', to: 'n2' }), '');
check('①f validateGroupOp：自环被拒', !!host.validateGroupOp(base, { op: 'addEdge', from: 'n1', to: 'n1' }), '');
check('①g validateGroupOp：节点名撞车被拒（否则渲染会指向同一个人）',
  !!host.validateGroupOp(base, { op: 'addNode', kind: 'npc', name: '甲' }), '');
check('①h validateGroupOp：合法 op 通过', host.validateGroupOp(base, { op: 'addEdge', from: 'n1', to: 'n2', type: 'rival', strength: 2 }) === null, '');

const applied = host.applyGroupOps(base, [
  { op: 'addNode', kind: 'npc', name: '柳长老' },
  { op: 'addEdge', from: 'n1', to: 'n3', type: 'mentor', strength: 4, direction: 'one-way', note: '嘴上不认' },
  { op: 'addEdge', from: 'n1', to: 'n1' },          // 会被拒
  { op: 'removeEdge', edgeId: 'e404' },             // 会被拒
]);
check('①i applyGroupOps：合法 op 生效、非法 op 只进 rejected（不半途改坏图谱）',
  applied.applied.length === 2 && applied.rejected.length === 2 && applied.group.edges.length === 1,
  JSON.stringify({ applied: applied.applied.map(a => a.op), rejected: applied.rejected.length }));
check('①j applyGroupOps：不修改入参（纯函数）', base.nodes.length === 2 && base.edges.length === 0, '');

// ——————————————————————————————————————————————————————————————
// ② 渲染：追加 / 替换 / 幂等 / 只出边 / 清空
// ——————————————————————————————————————————————————————————————
const g = host.normalizeGroup({
  id: 'g3', name: '渲染组',
  nodes: [
    { id: 'n1', kind: 'card', cardId: 'c1', name: '江晚' },
    { id: 'n2', kind: 'card', cardId: 'c2', name: '陆亭舟' },
    { id: 'n3', kind: 'npc', name: '柳听寒' },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n3', type: 'mentor', strength: 4, direction: 'one-way', note: '嘴上不认' },
    { id: 'e2', from: 'n1', to: 'n2', type: 'rival', strength: 2, direction: 'mutual' },
    { id: 'e3', from: 'n2', to: 'n1', type: 'friend', strength: 5, direction: 'one-way', note: '单方面示好' },
  ],
});
const section = host.renderRelationsSection('n1', g.nodes, g.edges, {});
check('② 只渲染出边（我对别人的看法），互向有关系标记',
  section.indexOf('柳听寒') >= 0 && section.indexOf('陆亭舟') >= 0 && section.indexOf('互向') >= 0 && section.indexOf('单方面示好') < 0,
  section);
const sectionIn = host.renderRelationsSection('n1', g.nodes, g.edges, { includeIncoming: true });
check('②b includeIncoming:true 时追加「他们眼中的我」一节',
  sectionIn.indexOf('他们眼中的我') >= 0 && sectionIn.indexOf('单方面示好') >= 0, '');

const desc0 = '【身份】她是转学生。';
const once = host.spliceRelations(desc0, section, 'rev=1 group=g3');
const twice = host.spliceRelations(once, section, 'rev=1 group=g3');
check('②c spliceRelations：没有标记区时追加，且带标记', once.indexOf(desc0) === 0 && once.indexOf('cc-relations:begin') > 0, '');
check('②d spliceRelations **幂等**：同一段内容渲染两次结果逐字相同（不会越写越长）', once === twice, '');
const replaced = host.spliceRelations(once, host.renderRelationsSection('n2', g.nodes, g.edges, {}), 'rev=2 group=g3');
check('②e spliceRelations：有标记区时**整段替换**（旧关系不残留、rev 更新）',
  replaced.indexOf('柳听寒') < 0 && replaced.indexOf('rev=2') > 0 && replaced.indexOf(desc0) === 0, replaced);
check('②f spliceRelations：section 为空 = 一键清空标记区（正文原样保留）',
  host.spliceRelations(once, '', '') === desc0, '');
check('②g 渲染空图谱时给「（暂无）」占位，而不是空白段',
  host.renderRelationsSection('n1', g.nodes, [], {}).indexOf('（暂无）') > 0, '');

// ——— B5 回归：mutual（对等）边反向写着也必须渲染 ———
// 曾经的 bug：outgoing 只取 from === 我，而 incoming 又排除 mutual → mutual 边**两头都不落**，
// 用户在图谱里建的「对等关系」在导出的卡里彻底消失（而且完全静默）。
const gMut = host.normalizeGroup({
  id: 'g4', name: '对等组',
  nodes: [
    { id: 'n1', kind: 'card', cardId: 'c1', name: '江晚' },
    { id: 'n2', kind: 'card', cardId: 'c2', name: '顾淮' },
    { id: 'n3', kind: 'npc', name: '米' },
  ],
  edges: [
    { id: 'e1', from: 'n2', to: 'n1', type: 'debt', strength: 3, direction: 'mutual', note: '互相欠着' },  // 反向写的对等边
    { id: 'n2', from: 'n3', to: 'n1', type: 'other', strength: 2, direction: 'mutual' },                     // 全新节点对的对等边
    { id: 'e3', from: 'n1', to: 'n3', type: 'friend', strength: 4, direction: 'one-way' },
    { id: 'e4', from: 'n1', to: 'n2', type: 'rival', strength: 1, direction: 'one-way' },
    { id: 'e5', from: 'n3', to: 'n1', type: 'enemy', strength: 2, direction: 'one-way' },                    // 普通入边，进「他们眼中的我」
  ],
});
const sMut = host.renderRelationsSection('n1', gMut.nodes, gMut.edges, {});
check('②h mutual 边（指向我、反向写着）照样渲染进【关系】，并带「，互向」标记',
  sMut.indexOf('顾淮（恩义｜3/5，互向）：互相欠着') > 0 && sMut.indexOf('米（其他｜2/5，互向）') > 0, sMut);
check('②i 出边口径 = 我发出的边 + 指向我的 mutual 边（渲染与计数共用 outgoingEdgesOf）',
  host.outgoingEdgesOf('n1', gMut.edges).length === 4, String(host.outgoingEdgesOf('n1', gMut.edges).length));
const sMutIn = host.renderRelationsSection('n1', gMut.nodes, gMut.edges, { includeIncoming: true });
const countOf = (s2, sub) => s2.split(sub).length - 1;
check('②j 对等边不在「他们眼中的我」里重复一遍（出边那节已带「互向」），普通 one-way 入边照旧进那一节',
  sMutIn.indexOf('他们眼中的我') > 0 && sMutIn.indexOf('米（敌对｜2/5）') > 0
    && countOf(sMutIn, '恩义') === 1 && countOf(sMutIn, '，互向）') === 2, sMutIn);

// ——————————————————————————————————————————————————————————————
// ③ 两半同构：渲染输出与落盘根必须逐字一致
// ——————————————————————————————————————————————————————————————
check('③ 两半渲染逐字一致（lib/index.js 与 lib/agent.js 的同构实现不许漂移）',
  host.renderRelationsSection('n1', g.nodes, g.edges, { includeIncoming: true })
    === agent.renderRelationsSection('n1', g.nodes, g.edges, { includeIncoming: true }), '');
check('③b 两半 spliceRelations 一致',
  host.spliceRelations(desc0, section, 'rev=9 group=g3') === agent.spliceRelations(desc0, section, 'rev=9 group=g3'), '');
check('③c 两半落盘根一致（同一台机器上必须算出同一个 cc-groups 目录）',
  JSON.stringify(host.groupDirs()) === JSON.stringify(agent.groupDirs()), JSON.stringify(host.groupDirs()));
check('③d 两半的组文件路径一致',
  host.groupPath('abc-1') === agent.groupPath('abc-1'), host.groupPath('abc-1'));
check('③e safeGroupId 挡住路径穿越（id 直接进文件名）',
  host.safeGroupId('../../etc/passwd') === 'etcpasswd' && host.safeGroupId('a b/c') === 'abc',
  host.safeGroupId('../../etc/passwd'));
check('③f 两半 outgoingEdgesOf 一致（口径分叉会让「预览说 N 条、实际写 M 条」）',
  JSON.stringify(host.outgoingEdgesOf('n1', gMut.edges)) === JSON.stringify(agent.outgoingEdgesOf('n1', gMut.edges)), '');
check('③g 两半 mutual 渲染逐字一致（B5 的修复必须两边同时生效）',
  host.renderRelationsSection('n1', gMut.nodes, gMut.edges, { includeIncoming: true })
    === agent.renderRelationsSection('n1', gMut.nodes, gMut.edges, { includeIncoming: true }), '');
check('③h 两半 findGroupByName 一致（查重规则若分叉，界面能建出模型建不了的同名组）',
  !!host.findGroupByName([{ id: 'g1', name: '测试' }], ' 测试 ', '')
    === !!agent.findGroupByName([{ id: 'g1', name: '测试' }], ' 测试 ', '')
    && host.findGroupByName([{ id: 'g1', name: '测试' }], '测试', 'g1') === null
    && agent.findGroupByName([{ id: 'g1', name: '测试' }], '测试', 'g1') === null, '');

// ——————————————————————————————————————————————————————————————
// ④ 落盘：写主根、rev 递增、列表
// ——————————————————————————————————————————————————————————————
const created = await host.writeGroup({ id: 'grp-live', name: '实战组', nodes: [], edges: [] });
check('④ writeGroup：新建的组 rev=1 且落到主根',
  created.rev === 1 && created.id === 'grp-live', JSON.stringify({ rev: created.rev, id: created.id }));
const after = host.applyGroupOps(created, [{ op: 'addNode', kind: 'npc', name: '甲' }]).group;
const saved2 = await host.writeGroup(after);
check('④b 每次写入 rev 递增（多端同时改时才能靠 rev 发现）', saved2.rev === 2, 'rev=' + saved2.rev);
const listed = await host.listGroups();
check('④c listGroups 能列出并统计节点/关系数',
  listed.some(x => x.id === 'grp-live' && x.nodes.length === 1 && x.name === '实战组'), JSON.stringify(listed.map(x => x.id)));

// ——————————————————————————————————————————————————————————————
// ⑤ 端到端（工具半）：建卡 → 入组 → 建关系 → 渲染 → 体检
// ——————————————————————————————————————————————————————————————
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '角色甲', description: '【身份】甲。' });
let r = await call('cc_save_to_library', {});
const cardA = r.id;
check('⑤ 首张卡入库：action=created', r.action === 'created' && !!cardA, JSON.stringify({ action: r.action }));
r = await call('cc_save_to_library', { id: 'grp-card-b', name: '角色乙' });
check('⑤b **派生**（传一个库里不存在的新 id）必须报 created —— 0.8.0 修的就是这里曾谎报 updated',
  r.action === 'created' && r.id === 'grp-card-b', JSON.stringify({ action: r.action, id: r.id }));
const cardB = r.id;

// 入组：用户侧走 RPC 的 cc_setCardGroup（会自动补节点）；这里直接打宿主半的等价操作
await host.patchLibraryMeta(cardA, { groupId: 'grp-live' });
await host.patchLibraryMeta(cardB, { groupId: 'grp-live' });
const grpNow = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj);
grpNow.nodes = [
  { id: 'n1', kind: 'card', cardId: cardA, name: '角色甲', aliases: [] },
  { id: 'n2', kind: 'card', cardId: cardB, name: '角色乙', aliases: [] },
].concat(grpNow.nodes.filter(n => n.kind === 'npc' && n.id !== 'n1' && n.id !== 'n2'));
grpNow.nextNodeSeq = 4;
await host.writeGroup(grpNow);
check('⑤c 成员由库条目 meta.groupId 派生（分组文件里不存成员列表）',
  JSON.stringify(await host.groupMemberIds('grp-live')) === JSON.stringify([cardA, cardB]),
  JSON.stringify(await host.groupMemberIds('grp-live')));

r = await call('cc_get_relations', {});
check('⑤d cc_get_relations：按当前卡的来源 id 找到分组与自己的节点',
  r.ok === true && r.group.id === 'grp-live' && r.myNodeId === 'n2', JSON.stringify({ group: r.group && r.group.id, myNodeId: r.myNodeId }));

// 先加 NPC 节点、拿回它的真实 id，再连边（节点 id 由服务端分配，测试里不许硬编码）
r = await call('cc_patch_relations', { ops: [{ op: 'addNode', kind: 'npc', name: '柳长老' }] });
const elderId = (r.applied[0] && r.applied[0].nodeId) || '';
check('⑤e0 cc_patch_relations：加 NPC 节点回执真实 nodeId', r.ok === true && /^n\d+$/.test(elderId), JSON.stringify({ nodeId: elderId }));
r = await call('cc_patch_relations', { ops: [
  { op: 'addEdge', from: 'n2', to: elderId, type: 'mentor', strength: 4, direction: 'one-way', note: '亦师亦友' },
  { op: 'addEdge', from: 'n2', to: 'n1', type: 'rival', strength: 2, direction: 'mutual' },
] });
check('⑤e cc_patch_relations：批量生效并回执新 rev',
  r.ok === true && r.applied.length === 2 && r.rejected.length === 0 && r.group.rev >= 3,
  JSON.stringify({ applied: r.applied.length, rev: r.group && r.group.rev }));

r = await call('cc_render_relations', { dryRun: true });
check('⑤f cc_render_relations({dryRun}) 只回预览：含【关系】段、列出出边、且尚未改动草稿',
  r.ok === true && r.dryRun === true && r.outgoing === 2 && r.section.indexOf('柳长老') > 0
    && (await call('cc_get_card')).draft.data.description.indexOf('cc-relations:begin') < 0,
  JSON.stringify(r).slice(0, 300));

r = await call('cc_render_relations', {});
const descAfter = (await call('cc_get_card')).draft.data.description;
check('⑤g cc_render_relations：把关系写进 description 的标记区',
  r.ok === true && r.changed === true && descAfter.indexOf('cc-relations:begin') > 0 && descAfter.indexOf('柳长老') > 0,
  JSON.stringify({ ok: r.ok, changed: r.changed, ret: String(r.description || '').slice(0, 70), got: descAfter.slice(0, 70) }));
const before2 = descAfter;
r = await call('cc_render_relations', {});
check('⑤h 重复渲染是替换而非追加（幂等）：description 逐字不变、changed=false',
  r.changed === false && (await call('cc_get_card')).draft.data.description === before2, '');

r = await call('cc_group_check', {});
check('⑤i cc_group_check：跨卡体检能报出未渲染的成员卡（角色甲还没渲染过）',
  r.ok === true && r.stats.members === 2 && r.issues.some(i => i.code === 'unrendered'),
  JSON.stringify({ members: r.stats.members, codes: r.issues.map(i => i.code) }));

// ——————————————————————————————————————————————————————————————
// ⑥ CAS：expectedRev 不符 → 拒绝且零副作用
// ——————————————————————————————————————————————————————————————
const revNow = (await call('cc_get_relations', {})).group.rev;
r = await call('cc_patch_relations', { expectedGroupRev: 999, ops: [{ op: 'addNode', kind: 'npc', name: '不该出现' }] });
const afterCas = (await call('cc_get_relations', {})).nodes.map(n => n.name);
check('⑥ expectedRev 不符 → staleRev 拒绝，且图谱没有任何变化（零副作用）',
  r.ok === false && r.staleGroupRev === true && afterCas.indexOf('不该出现') < 0,
  JSON.stringify({ ok: r.ok, staleGroupRev: r.staleGroupRev }));
r = await call('cc_patch_relations', { expectedGroupRev: revNow, ops: [{ op: 'addNode', kind: 'npc', name: '该出现' }] });
check('⑥b expectedRev 相符 → 正常写入', r.ok === true && r.applied.length === 1,
  JSON.stringify({ ok: r.ok, staleRev: r.staleRev, expectedRev: r.expectedRev, actualRev: r.actualRev, group: r.group, error: r.error, needGroup: r.needGroup, groups: r.groups }));

// ——————————————————————————————————————————————————————————————
// ⑦ 联动：删卡降级为 orphan（保留边）、改名同步节点名
// ——————————————————————————————————————————————————————————————
const touched = await host.orphanCardNodes(cardA, '角色甲');
const gAfterDel = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj);
const orphan = gAfterDel.nodes.find(n => n.id === 'n1');
check('⑦ 删卡：节点降级为 orphan（cardId 置空、名字保留），**边一条不删**',
  touched.indexOf('grp-live') >= 0 && orphan && orphan.cardId === null && orphan.orphanOf === '角色甲'
    && gAfterDel.edges.some(e => e.to === 'n1' || e.from === 'n1'),
  JSON.stringify({ touched, orphan: orphan && { cardId: orphan.cardId, orphanOf: orphan.orphanOf }, edges: gAfterDel.edges.length }));
const touched2 = await host.syncCardNodeName(cardB, '角色乙（改名）');
const gAfterRename = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj);
check('⑦b 改名：图谱节点名跟着改（否则关系里还挂着旧名）',
  touched2.indexOf('grp-live') >= 0 && gAfterRename.nodes.find(n => n.id === 'n2').name === '角色乙（改名）', '');

// ——————————————————————————————————————————————————————————————
// ⑧ 工具契约：9 个关系/分组工具、返回体干净、build 存在
// ——————————————————————————————————————————————————————————————
const FORBIDDEN = ['next', 'hint', 'notice', 'warning'];
let dirty = [];
for (const [n, a] of [
  ['cc_get_relations', {}], ['cc_patch_relations', { ops: [] }], ['cc_render_relations', { dryRun: true }], ['cc_group_check', {}],
  ['cc_list_groups', {}], ['cc_create_group', { name: '契约探针组' }],
  ['cc_rename_group', { groupId: 'grp-live', name: '实战组' }],   // 改成同名 = 无改动，不写盘
  ['cc_delete_group', { groupId: 'grp-live' }],                   // 不带 confirm，只会回盘点
  ['cc_set_card_group', { cardId: 'no-such-card-contract-probe' }],   // 探针不能真改数据：用不存在的卡
]) {
  const out = await call(n, a);
  for (const f of FORBIDDEN) if (Object.prototype.hasOwnProperty.call(out, f)) dirty.push(n + '.' + f);
  if (typeof out.build !== 'string') dirty.push(n + '.build');
  try { if (JSON.stringify(JSON.parse(JSON.stringify(out))) !== JSON.stringify(out)) dirty.push(n + '.lossless'); } catch { dirty.push(n + '.throw'); }
}
check('⑧ 9 个关系/分组工具的返回体：无顶层 next/hint/notice/warning 副本、带 build、可无损 JSON 化',
  dirty.length === 0, dirty.join(','));
check('⑧b cc_get_relations 在没入组时明确告知而不是猜（needGroup + groups 列表）',
  typeof (await call('cc_get_relations', { groupId: 'no-such-group' })).message === 'string', '');

// ——————————————————————————————————————————————————————————————
// ⑨ LLM 侧的分组增删改查（0.8.0 补：此前模型只能读写组内图谱，改不了「哪张卡属于哪个组」）
// ——————————————————————————————————————————————————————————————
r = await call('cc_list_groups', {});
check('⑨ cc_list_groups：列出全部分组 + 当前卡所在组（isMine）+ 未分组卡，成员数由库条目派生',
  r.ok === true && r.groups.some(x => x.id === 'grp-live' && x.memberCount === 2 && x.isMine === true)
    && r.groupId === 'grp-live' && Array.isArray(r.ungroupedCards),
  JSON.stringify({ groupId: r.groupId, groups: r.groups.map(x => ({ id: x.id, m: x.memberCount, mine: x.isMine })) }));

r = await call('cc_create_group', { name: '第二组', note: '群聊' });
const grp2 = (r.group && r.group.id) || '';
check('⑨b cc_create_group：建组成功、rev=1、回全量分组',
  r.ok === true && !!grp2 && r.group.rev === 1 && r.groups.some(x => x.id === grp2), JSON.stringify(r.group));
r = await call('cc_create_group', { name: '第二组' });
check('⑨c 建组查重：同名默认拒绝并回已有 id（否则侧栏里会出现两个「第二组」）',
  r.ok === false && r.duplicate === true && r.existingGroupId === grp2, JSON.stringify({ dup: r.duplicate, id: r.existingGroupId }));
r = await call('cc_create_group', { name: '第二组', allowDuplicate: true });
check('⑨d 显式 allowDuplicate:true 才允许重名', r.ok === true && r.group.id !== grp2, JSON.stringify({ id: r.group && r.group.id }));

// 归位：把「角色乙」从 grp-live 换到 grp2（显式 cardId）
r = await call('cc_set_card_group', { cardId: cardB, groupId: grp2 });
check('⑨e cc_set_card_group：换组成功、记下 previousGroupId、组里自动补节点',
  r.ok === true && r.groupId === grp2 && r.previousGroupId === 'grp-live' && /^n\d+$/.test(r.nodeId || ''),
  JSON.stringify({ groupId: r.groupId, prev: r.previousGroupId, nodeId: r.nodeId }));
check('⑨f 成员关系由**库条目 meta.groupId** 派生（grp-live 少一张、grp2 多一张）',
  JSON.stringify(await host.groupMemberIds('grp-live')) === JSON.stringify([cardA])
    && JSON.stringify(await host.groupMemberIds(grp2)) === JSON.stringify([cardB]),
  JSON.stringify({ live: await host.groupMemberIds('grp-live'), g2: await host.groupMemberIds(grp2) }));

// 移出 / 放回：节点与边都不许丢
const edgesBefore = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj).edges.length;
r = await call('cc_set_card_group', { cardId: cardA, groupId: null });
const liveAfter = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj);
check('⑨g 移出组：只清 meta.groupId，**节点与边都保留**（关系是用户资产，挪回来还在）',
  r.ok === true && r.groupId === null && liveAfter.edges.length === edgesBefore && liveAfter.nodes.some(n => n.id === 'n1'),
  JSON.stringify({ edges: liveAfter.edges.length, group: r.groupId }));
r = await call('cc_set_card_group', { cardId: cardA, groupId: 'grp-live' });
const liveBack = host.normalizeGroup((await host.readGroupRaw('grp-live')).obj);
check('⑨h 放回去：**复活原来的 orphan 节点**（不新建第二个同名节点），边一条不少',
  r.ok === true && r.nodeId === 'n1' && r.revived === true && liveBack.edges.length === edgesBefore
    && liveBack.nodes.filter(n => n.kind === 'card' && n.name === '角色甲').length === 1,
  JSON.stringify({ nodeId: r.nodeId, revived: r.revived, edges: liveBack.edges.length }));

// 「移出」的推荐写法是**不传 groupId**（比依赖 null 通过参数校验更稳），必须也走移出这条路
r = await call('cc_set_card_group', { cardId: cardA });
check('⑨g2 不传 groupId = 移出分组（工具描述推荐的写法）',
  r.ok === true && r.groupId === null
    && !String((((await host.listLibraryEntries()).find(e => e.id === cardA)) || {}).groupId || ''),
  JSON.stringify({ groupId: r.groupId }));
r = await call('cc_set_card_group', { cardId: cardA, groupId: 'grp-live' });   // 归位，供后面的断言用

const revBeforeRename = (await call('cc_list_groups', {})).groups.find(x => x.id === grp2).rev;
r = await call('cc_rename_group', { groupId: grp2, name: '群聊组' });
check('⑨i cc_rename_group：改名成功且 rev 递增 1',
  r.ok === true && r.group.name === '群聊组' && r.group.rev === revBeforeRename + 1, JSON.stringify(r.group));
r = await call('cc_rename_group', { groupId: grp2, name: '群聊组' });
check('⑨j 改到同一个名字：不写盘、不涨 rev（空改动不该消耗版本号，同 N4 家规）',
  r.ok === true && r.changed.length === 0 && r.group.rev === revBeforeRename + 1, JSON.stringify({ changed: r.changed, rev: r.group.rev }));
r = await call('cc_rename_group', { groupId: grp2, name: '实战组' });
check('⑨k 改名撞车：默认拒绝并回 existingGroupId（指向已有那个组）',
  r.ok === false && r.duplicate === true && r.existingGroupId === 'grp-live', JSON.stringify({ id: r.existingGroupId }));

// 删组：破坏性 → 先 confirm
r = await call('cc_delete_group', { groupId: grp2 });
check('⑨l cc_delete_group 不带 confirm：只回盘点（节点/边/成员数），**不执行删除**',
  r.ok === false && r.needConfirm === true && r.group.memberCount === 1 && !!(await host.readGroupRaw(grp2)), JSON.stringify(r.group));
r = await call('cc_delete_group', { groupId: grp2, confirm: true });
check('⑨m 带 confirm:true 才真删：组文件消失、成员卡**不删**只清 groupId',
  r.ok === true && r.memberCleared === 1 && (await host.readGroupRaw(grp2)) === null
    && !String(((await host.listLibraryEntries()).find(e => e.id === cardB) || {}).groupId || ''),
  JSON.stringify({ deleted: r.deleted, cleared: r.memberCleared }));

r = await call('cc_set_card_group', { cardId: cardA, groupId: 'no-such-group' });
check('⑨n 目标组不存在：明确拒绝并回可用分组（绝不静默建组）',
  r.ok === false && r.notFound === true && Array.isArray(r.groups), JSON.stringify({ notFound: r.notFound }));
r = await call('cc_set_card_group', { cardId: 'no-such-card', groupId: 'grp-live' });
check('⑨o 卡不存在：明确拒绝并回库里现有卡（不写坏任何文件）',
  r.ok === false && r.notFound === true && Array.isArray(r.cards), '');

// ——————————————————————————————————————————————————————————————
// ⑩ UI 源码守卫（0.8.1）：实机反馈「按钮点了没反应」的三个根因，别让它们回来
// ——————————————————————————————————————————————————————————————
const clientSrc = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
check('⑩ 关系/分组的新交互不再依赖 window.prompt（内嵌 webview 会拦掉原生对话框 → 表现为「点了没反应」）',
  clientSrc.indexOf('window.prompt(t("workshop.group.prompt")') < 0 && clientSrc.indexOf('window.prompt(t("workshop.rel.nodePrompt")') < 0, '');
check('⑩b 打开面板时会拉分组列表（否则 groups 恒为空 → 卡片上的归组下拉只有「未分组」、新建的组也不出现）',
  clientSrc.indexOf('store.refreshLibrary(); store.refreshGroups();') > 0, '');
check('⑩c 分组面板标题上有「关系」入口（直接进那个组的关系视图，不再靠先选分组）',
  clientSrc.indexOf('store.openRelationsFor(sec.id)') > 0, '');

// ——————————————————————————————————————————————————————————————
// ⑪ B4 回归：保存一张**已归组**的卡，不许把它踢出分组
// ——————————————————————————————————————————————————————————————
await call('cc_set_card_group', { cardId: cardA, groupId: 'grp-live' });
await call('cc_load_from_library', { id: cardA, includeDraft: false });
await call('cc_patch_character', { creator: '回归测试' });
r = await call('cc_save_to_library', {});
const metaA = (await host.listLibraryEntries()).find(e => e.id === cardA);
check('⑪ 保存已归组的卡：action=updated 且 **meta.groupId 保留**（B4：工具半重建 meta 时曾把它抹掉 → 卡静默退组）',
  r.action === 'updated' && metaA && String(metaA.groupId || '') === 'grp-live',
  JSON.stringify({ action: r.action, groupId: metaA && metaA.groupId }));

// 两半的 patchLibraryMeta 交叉读写：工具半写 → 宿主半读 → 宿主半写 → 工具半读
await agent.patchLibraryMeta(cardA, { groupId: null });
const seenByHost = ((await host.listLibraryEntries()).find(e => e.id === cardA) || {}).groupId;
await host.patchLibraryMeta(cardA, { groupId: 'grp-live' });
const seenByAgent = ((await agent.listLibraryEntries()).find(e => e.id === cardA) || {}).groupId;
check('⑪b patchLibraryMeta 两半同构（工具半写→宿主半读、宿主半写→工具半读，落在同一份文件上）',
  !String(seenByHost || '') && String(seenByAgent || '') === 'grp-live',
  JSON.stringify({ seenByHost, seenByAgent }));

// 两半的归位实现交叉：宿主半入组（含自动补节点）→ 工具半读得到；工具半移出 → 宿主半读得到
await host.writeGroup({ id: 'grp-half', name: '同构组', nodes: [], edges: [] });
const assignedByHost = await host.assignCardToGroup(cardB, 'grp-half');
const seenByAgentAfterHost = ((await agent.listLibraryEntries()).find(e => e.id === cardB) || {}).groupId;
const assignedByAgent = await agent.assignCardToGroup(cardB, null);
const seenByHostAfterAgent = ((await host.listLibraryEntries()).find(e => e.id === cardB) || {}).groupId;
check('⑪c 两半 assignCardToGroup 同构：宿主半入组（自动补节点）→ 工具半读得到；工具半移出 → 宿主半读得到',
  assignedByHost.groupId === 'grp-half' && /^n\d+$/.test(assignedByHost.nodeId || '')
    && String(seenByAgentAfterHost || '') === 'grp-half'
    && assignedByAgent.groupId === null && !String(seenByHostAfterAgent || ''),
  JSON.stringify({ hostSet: assignedByHost.groupId, seenByAgent: String(seenByAgentAfterHost || ''), agentSet: assignedByAgent.groupId }));

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
