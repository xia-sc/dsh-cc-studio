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
  r.ok === false && r.staleRev === true && afterCas.indexOf('不该出现') < 0,
  JSON.stringify({ ok: r.ok, staleRev: r.staleRev }));
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
// ⑧ 工具契约：4 个新工具、返回体干净、build 存在
// ——————————————————————————————————————————————————————————————
const FORBIDDEN = ['next', 'hint', 'notice', 'warning'];
let dirty = [];
for (const [n, a] of [['cc_get_relations', {}], ['cc_patch_relations', { ops: [] }], ['cc_render_relations', { dryRun: true }], ['cc_group_check', {}]]) {
  const out = await call(n, a);
  for (const f of FORBIDDEN) if (Object.prototype.hasOwnProperty.call(out, f)) dirty.push(n + '.' + f);
  if (typeof out.build !== 'string') dirty.push(n + '.build');
  try { if (JSON.stringify(JSON.parse(JSON.stringify(out))) !== JSON.stringify(out)) dirty.push(n + '.lossless'); } catch { dirty.push(n + '.throw'); }
}
check('⑧ 4 个关系工具的返回体：无顶层 next/hint/notice/warning 副本、带 build、可无损 JSON 化',
  dirty.length === 0, dirty.join(','));
check('⑧b cc_get_relations 在没入组时明确告知而不是猜（needGroup + groups 列表）',
  typeof (await call('cc_get_relations', { groupId: 'no-such-group' })).message === 'string', '');

// —— 收尾：清掉临时落盘根 ——
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
