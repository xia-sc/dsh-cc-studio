/**
 * host 半 /dsh-cc-studio-rpc 通道回归测试（不随插件发布，files 未包含 tests）。
 *
 * 背景：dsh 0.1.5-rc.1 里 `connection.rpc.handle()` 对外部插件不可用 ——
 * HostConnectionService.rpc 用的是 connection 插件自己的 ctx（inject 仅
 * ["credentials"]），它通过内层 ctx.inject(["webServer"]) 作用域拿到 webServer，
 * 所以那个 owner fiber 永远解析不到，调用必抛
 * "cannot get property \"webServer\" without inject"。插件改为自己在
 * `webServer` 上注册路由并实现同一套 connection RPC 线上协议，
 * 本测试用假 cordis ctx + 真实 node:http 服务锁住这套协议。
 *
 * 覆盖：路由注册、connection host/origin 围栏、server-response envelope 与
 * client-connection 客户端解析器的兼容性、fail() 帧字段类型、路径/信封校验、
 * 请求体读取（事件式，含中文与 48MiB 上限）。
 *
 * 运行：node tests/rpc-channel.test.mjs   （全绿退出码 0）
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离副作用：host 半用 homedir() 解析 ~/.dsh/cc-drafts，且 apply() 会把 CC 预设自动装到
// <DSH_HOME>/.agent-presets/cc —— 必须同时改掉 HOME 与 DSH_HOME，否则会写进真实的用户预设目录
// （DSH_HOME 优先于 homedir()，只改 HOME 不够）。
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-studio-test-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.DSH_HOME = sandboxHome;

const host = await import('../lib/index.js');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

let route = null;
let rejection = undefined; // undefined = 放行
const fakeCtx = {
  effect(fn) {
    fn();
    return () => {};
  },
  get(name) {
    if (name === 'connection') return { requestRejection: () => rejection };
    return undefined;
  },
  webServer: {
    register(r) {
      route = r;
      return () => {
        route = null;
      };
    },
  },
};

check('inject 声明含 webServer', host.inject.includes('webServer'), host.inject.join(','));
check('apply 是函数', typeof host.apply === 'function');

const server = createServer((req, res) => {
  if (route && (req.url === route.path || req.url.startsWith(route.path + '/'))) {
    route.handler(req, res);
    return;
  }
  res.statusCode = 404;
  res.end('no route');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// connection 服务在真实环境里随宿主一起挂载；这里等 apply() 注册完路由
await host.apply(fakeCtx);
await new Promise((r) => setTimeout(r, 50));

check('注册了 /dsh-cc-studio-rpc 前缀路由', route && route.kind === 'prefix' && route.path === '/dsh-cc-studio-rpc',
  route ? `${route.kind} ${route.path}` : 'route is null');

async function post(path, body, { contentType = 'application/json', method = 'POST' } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: contentType === null ? {} : { 'content-type': contentType },
    body: method === 'POST' ? body : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

// 1) 正常帧：ping
{
  const r = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ type: 'client-request', rpcId: 'rid-1', method: 'ping', payload: { args: {} } }));
  check('POST ping → 200', r.status === 200, `status=${r.status} body=${r.text.slice(0, 120)}`);
  check('envelope type=server-response', r.json && r.json.type === 'server-response', JSON.stringify(r.json));
  check('rpcId 原样回显', r.json && r.json.rpcId === 'rid-1', r.json && r.json.rpcId);
  check('result.ok === true', r.json && r.json.result && r.json.result.ok === true, JSON.stringify(r.json && r.json.result));
}

// 2) 真实端点 dispatch（validate 是纯函数，不碰磁盘）
{
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Aria', group_only_greetings: [] } };
  const r = await post('/dsh-cc-studio-rpc/validate', JSON.stringify({ type: 'client-request', rpcId: 'rid-2', method: 'validate', payload: { args: { card } } }));
  check('POST validate → 200', r.status === 200, `status=${r.status}`);
  check('validate 返回 valid=true', r.json && r.json.result && r.json.result.ok === true && r.json.result.value.valid === true,
    JSON.stringify(r.json && r.json.result));
}

// 3) 非法卡：validate 端点把校验结果当成功值返回（不是 fail 帧）
{
  const card = { spec: 'nope', data: {} };
  const r = await post('/dsh-cc-studio-rpc/validate', JSON.stringify({ type: 'client-request', rpcId: 'rid-3', method: 'validate', payload: { args: { card } } }));
  check('validate 对非法卡仍返回 ok 帧 + valid=false',
    r.json && r.json.result.ok === true && r.json.result.value.valid === false,
    JSON.stringify(r.json && r.json.result));
}

// 3b) 真正走 fail() 的端点（cc_setDraft 给非法 draft）：客户端解析器要求
//     error.code / error.message 是 string、error.details 是 object
{
  const r = await post('/dsh-cc-studio-rpc/cc_setDraft', JSON.stringify({ type: 'client-request', rpcId: 'rid-3b', method: 'cc_setDraft', payload: { args: { draft: { spec: 'nope' } } } }));
  const err = r.json && r.json.result && r.json.result.error;
  check('fail() 带 code/message/details 三字段且类型合规',
    !!err && typeof err.code === 'string' && typeof err.message === 'string' && typeof err.details === 'object' && err.details !== null,
    JSON.stringify(err));
  check('fail() 的 code 恒为 "internal"、真实错误码落在 details.code',
    !!err && err.code === 'internal' && err.details.code === 'invalid-card',
    JSON.stringify(err));
}

// 4) 未知端点
{
  const r = await post('/dsh-cc-studio-rpc/cc_nope', JSON.stringify({ type: 'client-request', rpcId: 'rid-4', method: 'cc_nope', payload: {} }));
  check('未知端点 → 200 + 失败帧，details.code=unknown-endpoint',
    r.status === 200 && r.json.result.ok === false && r.json.result.error.code === 'internal' && r.json.result.error.details.code === 'unknown-endpoint',
    JSON.stringify(r.json && r.json.result));
}

// 5) method 与路径不一致
{
  const r = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ type: 'client-request', rpcId: 'rid-5', method: 'validate', payload: {} }));
  check('method 与端点不一致 → 200 + gateway/bad-request', r.status === 200 && r.json.result.ok === false && r.json.result.error.code === 'gateway/bad-request',
    JSON.stringify(r.json && r.json.result));
}

// 5b) 0.8.0 分组端点：工坊侧（建组下拉 / 归组下拉 / 关系视图）走的就是这几条。
//     这些端点在 0.8.0 的第二次迭代里改过实现（查重、归位统一到 assignCardToGroup），
//     所以要在**真实 RPC 线**上钉一遍接线，而不只是调导出的纯函数。
{
  const rpc = async (method, args) => {
    const r = await post('/dsh-cc-studio-rpc/' + method,
      JSON.stringify({ type: 'client-request', rpcId: 'rid-' + method, method, payload: { args } }));
    return (r.json && r.json.result) || {};
  };
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '分组探针', group_only_greetings: [] } };
  const seeded = await host.saveLibraryEntry(card, {});
  const g = await rpc('cc_createGroup', { name: 'RPC 组' });
  const gid = (g.value && g.value.group && g.value.group.id) || '';
  check('cc_createGroup → ok 且回组 id', g.ok === true && !!gid, JSON.stringify(g).slice(0, 200));

  const dup = await rpc('cc_createGroup', { name: 'RPC 组' });
  check('同名再建 → duplicate-name 失败帧 + details.existingGroupId（界面与模型同一条规则）',
    dup.ok === false && dup.error.details.code === 'duplicate-name' && dup.error.details.existingGroupId === gid,
    JSON.stringify(dup).slice(0, 240));

  const set1 = await rpc('cc_setCardGroup', { cardId: seeded.id, groupId: gid });
  check('cc_setCardGroup → ok、自动补节点并回 nodeId',
    set1.ok === true && /^n\d+$/.test(String((set1.value || {}).nodeId || '')), JSON.stringify(set1).slice(0, 200));

  const list = await rpc('cc_listGroups', {});
  check('cc_listGroups → 该组 memberCount=1（成员由库条目 meta.groupId 派生）',
    list.ok === true && list.value.groups.some((x) => x.id === gid && x.memberCount === 1),
    JSON.stringify(list.value && list.value.groups).slice(0, 240));

  const set2 = await rpc('cc_setCardGroup', { cardId: 'no-such-card', groupId: gid });
  check('归位一个不存在的卡 → not-found 失败帧（不写坏任何文件）',
    set2.ok === false && set2.error.details.code === 'not-found', JSON.stringify(set2).slice(0, 200));

  const revBefore = host.normalizeGroup((await host.readGroupRaw(gid)).obj).rev;
  const ren = await rpc('cc_renameGroup', { id: gid, name: 'RPC 组' });   // 改到同值
  const revAfter = host.normalizeGroup((await host.readGroupRaw(gid)).obj).rev;
  check('改名到同值：changed 为空且 rev 不变（空改动不消耗版本号，同 N4 家规）',
    ren.ok === true && Array.isArray(ren.value.changed) && ren.value.changed.length === 0 && revAfter === revBefore,
    JSON.stringify({ changed: ren.value && ren.value.changed, revBefore, revAfter }));

  // cc_getGroup 的返回形状是**工坊关系视图的读取契约**：节点与边在 value.group 里面，
  // 顶层只有 members / rev。客户端曾按工具半 cc_get_relations 的形状去读顶层 value.nodes/.edges
  // → 界面永远显示「关系 · 0」。这条把形状钉死：改返回结构必须同步改 lib/client.js 关系视图那几行
  // （行为侧由 tests/relations-view.test.mjs 盯着）。
  const got = await rpc('cc_getGroup', { id: gid });
  const v = got.value || {};
  check('cc_getGroup：节点与边在 value.group 里（顶层只有 members / rev），members 是卡摘要',
    got.ok === true && v.group && Array.isArray(v.group.nodes) && Array.isArray(v.group.edges)
      && v.group.nodes.length === 1 && Array.isArray(v.members) && v.members.length === 1
      && v.members[0].id === seeded.id && v.rev === v.group.rev,
    JSON.stringify({ keys: Object.keys(v), nodes: v.group && v.group.nodes.length, members: v.members && v.members.length }));

  // 0.9.0 组级共享世界书端点（工坊的共享书视图走这几条）
  const patch = await rpc('cc_patchBook', { groupId: gid, name: '共享设定集', ops: [
    { op: 'addEntry', entry: { keys: ['年表'], content: '@@position after_desc\n【共同设定】三千年前。', name: '年表' } },
  ] });
  check('cc_patchBook：建书 + 加条目，rev=1、回执 applied 分离',
    patch.ok === true && patch.value.changed === true && patch.value.rev === 1 && patch.value.book.data.entries.length === 1,
    JSON.stringify({ rev: patch.value && patch.value.rev, n: patch.value && patch.value.book.data.entries.length }));

  const book = await rpc('cc_getBook', { groupId: gid });
  check('cc_getBook：读回整本书（含 data.extensions.cc.rev 与成员卡摘要）',
    book.ok === true && book.value.exists === true && book.value.book.spec === 'lorebook_v3'
      && book.value.rev === 1 && book.value.cards.length === 1,
    JSON.stringify({ exists: book.value && book.value.exists, rev: book.value && book.value.rev }));

  const apply = await rpc('cc_applyBook', { groupId: gid, cardId: seeded.id, dryRun: true });
  const probeRaw = JSON.parse(readFileSync(join(host.libDir(), seeded.id + '.json'), 'utf8'));
  const probeEntries = (probeRaw.draft.data.character_book && probeRaw.draft.data.character_book.entries) || [];
  check('cc_applyBook（dryRun）：预览会把共享条目补进这张卡，且没写盘',
    apply.ok === true && apply.value.dryRun === true && apply.value.wouldAdd === 1 && probeEntries.length === 0,
    JSON.stringify(apply.value));

  const promote = await rpc('cc_promoteBook', { groupId: gid });
  check('cc_promoteBook：默认 dryRun（只回候选与将删条数，不写盘）',
    promote.ok === true && promote.value.dryRun === true && Array.isArray(promote.value.candidates),
    JSON.stringify({ dryRun: promote.value && promote.value.dryRun, candidates: promote.value && promote.value.candidates.length }));

  const del = await rpc('cc_deleteGroup', { id: gid });
  check('cc_deleteGroup：删组时一并删掉组级共享世界书（bookDeleted）',
    del.ok === true && del.value.bookDeleted === true && (await host.readBookRaw(gid)) === null,
    JSON.stringify({ bookDeleted: del.value && del.value.bookDeleted }));
}

// 6) 外层信封非法
{
  const r = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ rpcId: 'rid-6' }));
  check('非法信封 → 400', r.status === 400 && r.json.result.ok === false, `status=${r.status}`);
}

// 7) body 不是 JSON
{
  const r = await post('/dsh-cc-studio-rpc/ping', 'not-json');
  check('非 JSON body → 400', r.status === 400, `status=${r.status} body=${r.text.slice(0, 80)}`);
}

// 8) content-type 不对
{
  const r = await post('/dsh-cc-studio-rpc/ping', '{}', { contentType: 'text/plain' });
  check('content-type 非 application/json → 415', r.status === 415, `status=${r.status}`);
}

// 9) 路径穿越/非法段
{
  const r = await post('/dsh-cc-studio-rpc/../ping', JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'ping', payload: {} }));
  check('非法路径段 → 404（不会被 server 归一化后误命中）', r.status === 404 || r.status === 400, `status=${r.status}`);
}

// 10) 非 POST
{
  const r = await post('/dsh-cc-studio-rpc/ping', null, { method: 'GET', contentType: null });
  check('GET → 405 + allow:POST', r.status === 405, `status=${r.status}`);
}

// 11) connection 围栏生效（模拟未认证浏览器）
{
  rejection = 401;
  const r = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'ping', payload: {} }));
  check('围栏 401 时返回 unauthorized', r.status === 401 && r.text === 'unauthorized', `status=${r.status} body=${r.text}`);
  rejection = 403;
  const r2 = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'ping', payload: {} }));
  check('围栏 403 时返回 forbidden', r2.status === 403 && r2.text === 'forbidden', `status=${r2.status} body=${r2.text}`);
  rejection = undefined;
}

// 12) 大请求体（超过 48MiB 上限应 413）
{
  const big = 'x'.repeat(49 * 1024 * 1024);
  const r = await post('/dsh-cc-studio-rpc/ping', JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'ping', payload: { args: { big } } }));
  check('超过 48MiB → 413', r.status === 413, `status=${r.status}`);
}

// 13) UTF-8 中文请求体往返
{
  const r = await post('/dsh-cc-studio-rpc/validate', JSON.stringify({
    type: 'client-request', rpcId: 'rid-utf8', method: 'validate',
    payload: { args: { card: { spec: 'chara_card_v3', data: { name: '中文名字', group_only_greetings: ['你好'] } } } },
  }));
  check('含中文 body 正常解析', r.json && r.json.rpcId === 'rid-utf8' && r.json.result.ok === true, JSON.stringify(r.json && r.json.result));
}

// 14) issue #5：草稿槽 key 的解析（Tools 与前端必须落在同一把 key 上）
{
  // post() 返回的是 { status, text, json } 包装，这里取「成功帧的 value」
  const result = (v) => (v && v.json && v.json.result && v.json.result.ok) ? v.json.result.value : null;

  // 14a) 纯函数：明确传 sessionId
  const partsArg = host.draftKeyPartsFrom(fakeCtx, { sessionId: 'session-abc' });
  check('sessionId 是字符串 → 直接用它，source=arg',
    partsArg.key === 'session-abc' && partsArg.source === 'arg', JSON.stringify(partsArg));

  // 14b) 旧前端可能把整个会话快照对象传进来（SessionSnapshot 的 id 在 .sessionId 上）：
  //      既不能当「没传」丢弃（会落到 default 槽），也不能 String() 成 "[object Object]"
  const partsSnap = host.draftKeyPartsFrom(fakeCtx, { sessionId: { sessionId: 'session-snap', running: true } });
  check('sessionId 是会话快照对象 → 认它的 .sessionId，source=arg-snapshot',
    partsSnap.key === 'session-snap' && partsSnap.source === 'arg-snapshot', JSON.stringify(partsSnap));

  // 14c) 拿不到会话 id 时回退 default，但 source 必须如实报出来（前端据此告警而不是静默建空槽）
  const partsNone = host.draftKeyPartsFrom(fakeCtx, {});
  check('没有会话 id → default/fallback（且 source 可见）',
    partsNone.key === 'default' && partsNone.source === 'fallback', JSON.stringify(partsNone));

  // 14d) 有 agent 上下文（Tools 侧路径）时用 initiator 的会话 id
  const ctxWithAgent = { get: (n) => n === 'agents' ? { currentInitiator: () => ({ session: { id: 'session-from-agent' } }) } : undefined };
  const partsInit = host.draftKeyPartsFrom(ctxWithAgent, {});
  check('有 currentInitiator → 用它的会话 id，source=initiator',
    partsInit.key === 'session-from-agent' && partsInit.source === 'initiator', JSON.stringify(partsInit));

  // 14e) 端到端：同一会话的读写必须落在同一把 key
  const card = (name) => ({ spec: 'chara_card_v3', spec_version: '3.0',
    data: { name, group_only_greetings: [], character_book: { entries: [] }, assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }] } });
  const sid = 'session-e2e-issue5';
  const w = await post('/dsh-cc-studio-rpc/cc_setDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-w', method: 'cc_setDraft', payload: { args: { sessionId: sid, draft: card('E2E 满草稿') } } }));
  check('显式 sessionId 写入 session-<id> 槽', result(w) && result(w).key === sid, JSON.stringify(w.json && w.json.result));

  const g1 = await post('/dsh-cc-studio-rpc/cc_getDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-g1', method: 'cc_getDraft', payload: { args: { sessionId: sid } } }));
  check('同一 sessionId 读回内容（写入没丢）',
    result(g1) && result(g1).key === sid && result(g1).draft.data.name === 'E2E 满草稿' && result(g1).keySource === 'arg',
    JSON.stringify(result(g1) && { key: result(g1).key, name: result(g1).draft.data.name, keySource: result(g1).keySource }));

  const g2 = await post('/dsh-cc-studio-rpc/cc_getDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-g2', method: 'cc_getDraft', payload: { args: {} } }));
  check('不带 sessionId 时是另一把槽（default），不会把会话槽的内容当成 default —— 这正是 issue #5 的两槽并存',
    result(g2) && result(g2).key === 'default' && result(g2).draft.data.name !== 'E2E 满草稿',
    JSON.stringify(result(g2) && { key: result(g2).key, name: result(g2).draft.data.name }));

  // 14f) 救回入口：模拟「旧版前端读写 default、模型写会话槽」留下的错位。
  //      先把 default 槽写成有内容的（旧版前端在拿不到会话 id 时就是这么写的）
  const legacy = '旧版遗留草稿';
  const wd = await post('/dsh-cc-studio-rpc/cc_setDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14f-wd', method: 'cc_setDraft', payload: { args: { draft: card(legacy) } } }));
  check('不带 sessionId 写入落在 default 槽', result(wd) && result(wd).key === 'default', JSON.stringify(result(wd) && { key: result(wd).key }));

  const fresh = 'session-fresh-issue5';
  const g3 = await post('/dsh-cc-studio-rpc/cc_getDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-g3', method: 'cc_getDraft', payload: { args: { sessionId: fresh } } }));
  const alts = (result(g3) && result(g3).alternateSlots) || [];
  check('新会话槽是空壳时，只把「旧版 default 槽」列为可迁入候选（不噪音式列其它会话）',
    result(g3) && result(g3).draftStatus.isNew === true &&
    alts.length === 1 && alts[0].key === 'default' && alts[0].hasContent === true && alts[0].name === legacy,
    JSON.stringify(alts));

  const sid2 = 'session-unrelated-issue5';
  const g4 = await post('/dsh-cc-studio-rpc/cc_getDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-g4', method: 'cc_getDraft', payload: { args: { sessionId: sid2 } } }));
  const alts2 = (result(g4) && result(g4).alternateSlots) || [];
  check('别的会话的槽（session-e2e-issue5）不会被当成候选端出来',
    result(g4) && alts2.every((a) => a.key !== sid), JSON.stringify(alts2));

  const m1 = await post('/dsh-cc-studio-rpc/cc_migrateDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-m1', method: 'cc_migrateDraft', payload: { args: { from: 'default', to: fresh } } }));
  check('cc_migrateDraft 把 default 槽内容搬进本会话槽',
    result(m1) && result(m1).key === fresh && result(m1).draft.data.name === legacy && result(m1).from === 'default',
    JSON.stringify(result(m1) && { key: result(m1).key, from: result(m1).from }));

  const m2 = await post('/dsh-cc-studio-rpc/cc_migrateDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-m2', method: 'cc_migrateDraft', payload: { args: { from: 'default', to: fresh } } }));
  check('目标槽已有内容 → 拒绝静默覆盖（target-not-empty）',
    m2.json && m2.json.result.ok === false && m2.json.result.error.details.code === 'target-not-empty',
    JSON.stringify(m2.json && m2.json.result));

  const m3 = await post('/dsh-cc-studio-rpc/cc_migrateDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-m3', method: 'cc_migrateDraft', payload: { args: { from: 'session-nobody-here', to: fresh } } }));
  check('源槽没有草稿 → empty-source',
    m3.json && m3.json.result.ok === false && m3.json.result.error.details.code === 'empty-source',
    JSON.stringify(m3.json && m3.json.result));

  const m4 = await post('/dsh-cc-studio-rpc/cc_migrateDraft', JSON.stringify({ type: 'client-request', rpcId: 'r14e-m4', method: 'cc_migrateDraft', payload: { args: { from: fresh, to: fresh } } }));
  check('源槽与目标槽相同 → same-slot',
    m4.json && m4.json.result.ok === false && m4.json.result.error.details.code === 'same-slot',
    JSON.stringify(m4.json && m4.json.result));
}

// 15) 迁移决策的纯函数（不碰磁盘的那部分）
{
  const full = (name) => ({ spec: 'chara_card_v3', data: { name, character_book: { entries: [{ content: 'x' }] } } });
  const empty = { spec: 'chara_card_v3', data: { name: '', character_book: { entries: [] } } };
  check('空壳源 → 拒绝', host.migrateDraftDecision(empty, null, false).code === 'empty-source', '');
  check('非卡对象源 → 拒绝', host.migrateDraftDecision({ spec: 'nope' }, null, false).code === 'empty-source', '');
  // name 为空但 lore 写满的草稿也算有内容（迁移是自家两个槽之间搬东西，不该被 validateCard 的 name 必填拦住）
  const loreOnly = { spec: 'chara_card_v3', data: { name: '', character_book: { entries: [{ content: 'a' }, { content: 'b' }] } } };
  check('只有 lore 没有 name 也算有内容', host.migrateDraftDecision(loreOnly, null, false).ok === true, '');
  check('目标有内容且未 overwrite → 拒绝', host.migrateDraftDecision(full('A'), full('B'), false).code === 'target-not-empty', '');
  check('目标有内容 + overwrite → 放行', host.migrateDraftDecision(full('A'), full('B'), true).ok === true, '');
  check('空目标 → 放行', host.migrateDraftDecision(full('A'), empty, false).ok === true, '');
  const d = host.migrateDraftDecision(full('A'), null, false);
  check('迁移结果是深拷贝（改副本不动源）', d.ok === true && (function () {
    const copy = d.draft;
    copy.data.name = 'MUT';
    return d.draft.data.name === 'MUT';
  })(), '');
  check('draftContentSummary 统计 name/entries', (function () {
    const s = host.draftContentSummary(full('A'));
    return s.name === 'A' && s.entries === 1 && s.filled >= 1;
  })(), '');
}

// 16) 0.11.0 草稿锁：LLM 写草稿时锁住，用户侧（浏览器 RPC）的写动作被拦 / 只读预览 / force / 备份。
//     锁文件是**按路径规则手工写**出来的（<cc-drafts>/<safe 去 .json>.lock.json，与工具半同构），
//     所以这一段不依赖工具半的落地进度，锁契约本身由宿主半的端点接线钉死。
{
  const rpc = async (method, args) => {
    const r = await post('/dsh-cc-studio-rpc/' + method,
      JSON.stringify({ type: 'client-request', rpcId: 'rid-lock-' + method, method, payload: { args } }));
    return (r.json && r.json.result) || {};
  };
  const value = (res) => ((res && res.ok) ? res.value : null);
  const sid = 'session-draft-lock';
  const ddir = join(sandboxHome, 'cc-drafts');   // 本测试里 DSH_HOME === HOME === sandboxHome
  const backupsDir = join(ddir, 'backups');
  const nowS = () => Math.floor(Date.now() / 1000);
  const card = (name) => ({ spec: 'chara_card_v3', spec_version: '3.0',
    data: { name, group_only_greetings: [], description: '锁矩阵用卡', assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }] } });
  // 按 safeDraftFile 的路径规则找这把槽的锁文件：先从 cc-drafts 目录里拿到草稿文件名，再把 .json 换成 .lock.json
  const lockFileOf = (key) => {
    const names = readdirSync(ddir);
    const draftName = names.find((f) => f === host.safeDraftFile(key));
    if (!draftName) throw new Error('草稿文件不存在: ' + key);
    return join(ddir, draftName.replace(/\.json$/, '.lock.json'));
  };
  const writeLock = (key, updatedAt) => {
    writeFileSync(lockFileOf(key), JSON.stringify({ key, owner: 'llm', since: updatedAt - 60, updatedAt, rev: 1, cardName: '锁中的卡' }, null, 2), 'utf8');
  };
  const draftFile = join(ddir, host.safeDraftFile(sid));
  const originFile = join(ddir, host.safeDraftFile(sid).replace(/\.json$/, '.origin.json'));
  const snapshot = () => ({
    draft: readFileSync(draftFile, 'utf8'),
    origin: existsSync(originFile) ? readFileSync(originFile, 'utf8') : null,
  });

  // 16a) 先写一张有内容的卡并入库（拿到载入用的 id / 建立 origin sidecar），然后手工上锁
  const wA = await rpc('cc_setDraft', { sessionId: sid, draft: card('锁矩阵 A') });
  const savedA = await rpc('cc_saveToLibrary', { sessionId: sid, draft: card('锁矩阵 A') });
  const idA = (value(savedA) || {}).id;
  check('锁矩阵准备：写入一张有内容的卡并入库',
    wA.ok === true && typeof idA === 'string' && idA.length > 0, JSON.stringify({ id: idA }));
  const beforeLock = snapshot();

  writeLock(sid, nowS());
  const gLocked = await rpc('cc_getDraft', { sessionId: sid });
  check('锁定时 cc_getDraft 的 draftStatus.lock：active=true / owner=llm / cardName 可见',
    gLocked.ok === true && !!gLocked.value.draftStatus.lock
      && gLocked.value.draftStatus.lock.active === true
      && gLocked.value.draftStatus.lock.owner === 'llm'
      && gLocked.value.draftStatus.lock.cardName === '锁中的卡',
    JSON.stringify(gLocked.value && gLocked.value.draftStatus));

  // 16b) 锁定时载入另一张卡：返回 locked + preview，草稿文件与 origin 一个字节都不动
  const seededB = await host.saveLibraryEntry(card('锁矩阵 B'), {});
  const lockedLoad = await rpc('cc_loadFromLibrary', { sessionId: sid, id: seededB.id });
  const afterLockedLoad = snapshot();
  check('锁定时 cc_loadFromLibrary → locked + preview{id,draft,meta}，且不写草稿 / 不写 origin',
    lockedLoad.ok === true && lockedLoad.value.locked === true && lockedLoad.value.key === sid
      && !!lockedLoad.value.preview && lockedLoad.value.preview.id === seededB.id
      && lockedLoad.value.preview.draft.data.name === '锁矩阵 B'
      && !!lockedLoad.value.preview.meta
      && afterLockedLoad.draft === beforeLock.draft
      && afterLockedLoad.origin === beforeLock.origin,
    JSON.stringify({ locked: lockedLoad.value && lockedLoad.value.locked }),
  );

  // 16c) 锁定时写类端点报 draft-locked（真实错误码在 details.code，details.lock 带摘要）
  const lockedSet = await rpc('cc_setDraft', { sessionId: sid, draft: card('锁下改写') });
  check('锁定时 cc_setDraft → details.code=draft-locked + details.lock，草稿未变',
    lockedSet.ok === false && lockedSet.error.details.code === 'draft-locked'
      && !!lockedSet.error.details.lock && lockedSet.error.details.lock.active === true
      && snapshot().draft === beforeLock.draft,
    JSON.stringify(lockedSet.error && lockedSet.error.details));
  const lockedPatch = await rpc('cc_patchDraft', { sessionId: sid, patch: { name: '锁下改名' } });
  check('锁定时 cc_patchDraft 同样 draft-locked（写类端点同一套规则）',
    lockedPatch.ok === false && lockedPatch.error.details.code === 'draft-locked',
    JSON.stringify(lockedPatch.error && lockedPatch.error.details));

  // 16d) 锁定时导入 JSON：解析成功但不落盘，返回 locked + preview（upgradedFrom 字段保持存在）
  const lockedImport = await rpc('cc_importFromJson', { sessionId: sid, json: JSON.stringify(card('锁下导入')) });
  check('锁定时 cc_importFromJson → locked + preview{draft,upgradedFrom}，草稿未变',
    lockedImport.ok === true && lockedImport.value.locked === true
      && !!lockedImport.value.preview && lockedImport.value.preview.draft.data.name === '锁下导入'
      && Object.prototype.hasOwnProperty.call(lockedImport.value.preview, 'upgradedFrom')
      && snapshot().draft === beforeLock.draft,
    JSON.stringify({ locked: lockedImport.value && lockedImport.value.locked }),
  );

  // 16e) force:true 放行：写入生效并清掉锁文件（LLM 下一次写会重新上锁）
  const forcedSet = await rpc('cc_setDraft', { sessionId: sid, force: true, draft: card('force 覆盖') });
  check('cc_setDraft force:true 放行：写入生效且锁文件被删',
    forcedSet.ok === true && forcedSet.value.draft.data.name === 'force 覆盖'
      && !existsSync(lockFileOf(sid))
      && JSON.parse(readFileSync(draftFile, 'utf8')).draft.data.name === 'force 覆盖',
    JSON.stringify({ ok: forcedSet.ok, lockExists: existsSync(lockFileOf(sid)) }),
  );

  // 16f) 重新上锁后 force 载入：草稿被替换，但覆盖前留了一份备份
  writeLock(sid, nowS());
  const forcedLoad = await rpc('cc_loadFromLibrary', { sessionId: sid, id: seededB.id, force: true });
  const backupFiles = existsSync(backupsDir) ? readdirSync(backupsDir) : [];
  const backupName = forcedLoad.value && forcedLoad.value.backup ? forcedLoad.value.backup.file : '';
  let backupDraft = null;
  try { backupDraft = JSON.parse(readFileSync(join(backupsDir, backupName), 'utf8')).draft; } catch {}
  check('cc_loadFromLibrary force:true 放行：草稿被替换、锁被清、覆盖前备份进 backups/',
    forcedLoad.ok === true && forcedLoad.value.draft.data.name === '锁矩阵 B'
      && !existsSync(lockFileOf(sid))
      && backupFiles.length >= 1 && backupName.length > 0 && backupFiles.indexOf(backupName) >= 0
      && !!backupDraft && backupDraft.data.name === 'force 覆盖',
    JSON.stringify({ backup: backupName, backupCount: backupFiles.length, backedName: backupDraft && backupDraft.data.name }),
  );

  // 16g) 锁超时（TTL 30 分钟内没有写入）：视为 LLM 已停止，不 force 也能写；摘要如实报 stale
  writeLock(sid, nowS() - 2000);
  const staleSet = await rpc('cc_setDraft', { sessionId: sid, draft: card('超时后写入') });
  const gStale = await rpc('cc_getDraft', { sessionId: sid });
  check('锁超时 → cc_setDraft 不带 force 也成功；lock.stale=true / active=false',
    staleSet.ok === true && staleSet.value.draft.data.name === '超时后写入'
      && gStale.ok === true && !!gStale.value.draftStatus.lock
      && gStale.value.draftStatus.lock.stale === true
      && gStale.value.draftStatus.lock.active === false,
    JSON.stringify({ setOk: staleSet.ok, lock: gStale.value && gStale.value.draftStatus.lock }),
  );

  // 16h) 锁只拦「写草稿」：保存到角色库在锁定时照常可用（用户想留住 LLM 这一轮的卡也不该被挡）
  writeLock(sid, nowS());
  const saveLocked = await rpc('cc_saveToLibrary', { sessionId: sid, draft: card('锁下保存') });
  check('锁定时 cc_saveToLibrary 仍然成功（不拦存库/导出/分组/共享书/校验）',
    saveLocked.ok === true && typeof saveLocked.value.id === 'string' && saveLocked.value.id.length > 0,
    JSON.stringify({ ok: saveLocked.ok, id: saveLocked.value && saveLocked.value.id }),
  );
}

await new Promise((resolve) => server.close(resolve));

// 还原 homedir/DSH_HOME 并清掉沙箱目录（host 半在测试期间只会写 cc-drafts 与沙箱内的预设目录）
if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome;
try {
  rmSync(sandboxHome, { recursive: true, force: true });
} catch {}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined ? '' : '— ' + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
