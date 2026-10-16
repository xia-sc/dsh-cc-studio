/**
 * SillyTavern 兼容层回归测试（不随插件发布，files 未含 tests）。
 *
 * 背景（0.9.1，用户实机 + 本地 SillyTavern 1.19.0 源码核对）：ST 与 CCv3 的差异**不在卡片这一层**
 * —— ST 能把 CCv3 卡连未知字段一起存下来 —— 真正要适配的是三件事：
 *   ① ST 与 CCv3 都读 PNG 的 tEXt 块，但 ST 自己**两个块都写**（`chara` = V2 回填用、`ccv3` = 规范 MUST），
 *      且读取时优先 `ccv3`（`src/character-card-parser.js:15-78`）。我们此前只写 `ccv3`，
 *      等于放弃了「只认 `chara` 的老 ST / V2 工具」；而且我们的读取器是「取第一个命中的块」，
 *      遇到 ST 导出的 PNG（chara 在前）会读到 V2 那份，直接报「spec 需为 chara_card_v3」。
 *   ② 规范（SPEC_V3「PNG/APNG」）写明：可以直接放 `chara` 块做 V2 回填，两个块都在时 SHOULD 用 `ccv3`；
 *      同时「On backfilling V2, the application SHOULD remove all decorators」。
 *   ③ ST 的「角色↔世界书」绑定是 `data.extensions.world = <世界书文件名>`；我们导出的共享书就叫
 *      `<书名>.json`，所以导出时把书名写进 `extensions.world`，用户在 ST 里导完书再导卡就自动绑上。
 * 规范同样写明**不许**往 CharacterCard 对象里加应用私有字段（顶层 V1 平铺那套），所以兼容层只活在
 * `chara` 块与 `extensions` 里，卡片顶层一个 ST 私有键都不加。
 *
 * 运行：node tests/st-compat.test.mjs   （全绿退出码 0）
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离副作用（同 rpc-channel.test.mjs）：host 半会读 dirs 并可能写草稿 —— HOME/USERPROFILE/DSH_HOME 一起改
const originalHome = process.env.HOME, originalUserProfile = process.env.USERPROFILE, originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-studio-stcompat-'));
process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.DSH_HOME = sandboxHome;

const host = await import('../lib/index.js');
const clientSrc = (await import('node:fs')).readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

// —— 极简 PNG tEXt 扫描器（测试自己解，不用被测代码解，免得自证）——
function pngTextChunks(bytes) {
  const out = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (off + 8 + len + 4 > bytes.length) break;
    const data = bytes.slice(off + 8, off + 8 + len);
    if (type === 'tEXt') {
      const zero = data.indexOf(0);
      const kw = String.fromCharCode.apply(null, Array.from(data.slice(0, zero)));
      const text = Buffer.from(data.slice(zero + 1)).toString('utf8');
      out.push({ keyword: kw, json: JSON.parse(Buffer.from(Buffer.from(text, 'base64').toString('utf8'), 'utf8')) });
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}
/** 极简 zip 读取器（只认我们自己的存储法条目）。 */
function zipEntry(bytes, want) {
  let off = 0;
  while (off + 30 <= bytes.length) {
    if (!(bytes[off] === 0x50 && bytes[off + 1] === 0x4B && bytes[off + 2] === 0x03 && bytes[off + 3] === 0x04)) break;
    const size = (bytes[off + 18] | (bytes[off + 19] << 8) | (bytes[off + 20] << 16) | (bytes[off + 21] << 24)) >>> 0;
    const nameLen = bytes[off + 26] | (bytes[off + 27] << 8);
    const extraLen = bytes[off + 28] | (bytes[off + 29] << 8);
    const name = Buffer.from(bytes.slice(off + 30, off + 30 + nameLen)).toString('utf8');
    const start = off + 30 + nameLen + extraLen;
    if (name === want) return Buffer.from(bytes.slice(start, start + size)).toString('utf8');
    off = start + size;
  }
  return null;
}

// —— 测试样本：带装饰器、带 V3 独有字段、带 character_book 的卡 ——
const CARD = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '锁天司·探针', nickname: 'NICK', description: '简介', personality: '性格', scenario: '场景',
    first_mes: '开场', mes_example: '示例', creator_notes: '注释', system_prompt: 'SYS', post_history_instructions: 'PHI',
    alternate_greetings: ['备选一'], group_only_greetings: ['群聊开场'], tags: ['a', 'b'], creator: 'tester',
    character_version: '1.0', creator_notes_multilingual: { zh: '中文注' }, source: ['https://example.com'],
    creation_date: 1700000000, modification_date: 1700000001,
    assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
    extensions: { cc_world: { timeline: 'T' }, depth_prompt: { prompt: 'DP', depth: 4, role: 'system' } },
    character_book: {
      name: '卡内书', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {},
      entries: [
        { keys: ['年表'], content: '@@position after_desc\n【三千年前】天门开。', enabled: true, insertion_order: 0, name: '年表', id: 1, extensions: {} },
        { keys: ['锁道'], content: '@@activate\n【锁道】以人之所有为一「锁」。', enabled: true, insertion_order: 1, constant: true, name: '锁道', id: 2, extensions: {} },
        { keys: ['日常'], content: '正文开头没有装饰器，中间提到 @@ 也不是装饰器行。', enabled: false, insertion_order: 2, name: '日常', id: 3, extensions: {} },
      ],
    },
  },
};

// ① 装饰器摘除
{
  const s = host.stripDecorators;
  check('① 开头的 @@ 行被摘掉，正文保留',
    s('@@position after_desc\n@@depth 4\n正文') === '正文', JSON.stringify(s('@@position after_desc\n@@depth 4\n正文')));
  check('①b 装饰器后的空行一起收掉', s('@@activate\n\n正文') === '正文', JSON.stringify(s('@@activate\n\n正文')));
  check('①c 正文中间的 @@ 不动（只摘开头连续段）',
    s('正文第一行\n@@activate\n第二行') === '正文第一行\n@@activate\n第二行', JSON.stringify(s('正文第一行\n@@activate\n第二行')));
  check('①d 没有装饰器时原样返回', s('普通正文') === '普通正文', '');
}

// ② V2 投影（PNG 的 chara 块）
{
  const p = host.stV2Projection(CARD);
  check('② 投影是诚实的 V2 卡（spec/spec_version）', p.spec === 'chara_card_v2' && p.spec_version === '2.0', p.spec + '/' + p.spec_version);
  const v3Only = ['nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'assets', 'creation_date', 'modification_date'];
  check('②b V3 独有字段一个都不进 V2 投影（V2 里它们不存在）',
    v3Only.every((k) => p.data[k] === undefined), v3Only.filter((k) => p.data[k] !== undefined).join(','));
  const v2Required = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags', 'creator', 'character_version', 'extensions', 'character_book'];
  check('②c V2 的字段一个不少', v2Required.every((k) => p.data[k] !== undefined), v2Required.filter((k) => p.data[k] === undefined).join(','));
  check('②d character_book 跟着走，且条目正文里的装饰器被摘掉（规范：回填 V2 要移除装饰器）',
    p.data.character_book.entries[0].content === '【三千年前】天门开。'
    && p.data.character_book.entries[1].content.indexOf('@@') < 0
    && p.data.character_book.entries[2].content === CARD.data.character_book.entries[2].content,
    JSON.stringify(p.data.character_book.entries[0].content));
  check('②e extensions 原样带过（ST 要的绑定就在里面）',
    p.data.extensions.cc_world.timeline === 'T' && p.data.extensions.depth_prompt.prompt === 'DP', '');
  check('②f 投影不改调用方传进来的对象（真源不许被兼容层污染）',
    CARD.data.character_book.entries[0].content.startsWith('@@') && CARD.data.nickname === 'NICK', '');
}

// ③ ST 世界书绑定
{
  const withWorld = host.withStWorld(CARD, '锁天司·共享设定');
  check('③ 导出副本上写 data.extensions.world = 书名',
    withWorld.data.extensions.world === '锁天司·共享设定', String(withWorld.data.extensions.world));
  check('③b 原卡（草稿/库里的那份）一个字节都没多',
    CARD.data.extensions.world === undefined, String(CARD.data.extensions.world));
  check('③c 空书名不写绑定（不给 ST 留悬空的世界名）',
    host.withStWorld(CARD, '') === CARD && host.withStWorld(CARD, '   ') === CARD, '');
  check('③d 绑定也出现在 V2 投影里（老 ST 只读 chara 块时同样能绑上）',
    host.stV2Projection(withWorld).data.extensions.world === '锁天司·共享设定', '');
}

// ④ 导出 PNG：两个块
{
  const png = host.buildPngWithCard(CARD);
  check('④ 是合法 PNG（签名 + 以 IEND 收尾）',
    png[0] === 0x89 && png[1] === 0x50 && png.length > 12 && Buffer.from(png.slice(-8, -4)).toString('latin1') === 'IEND', '');
  const chunks = pngTextChunks(png);
  const kw = chunks.map((c) => c.keyword);
  check('④b 卡片块恰好两个：chara（V2 回填）+ ccv3（规范 MUST），顺序与 ST 一致（chara 在前）',
    kw.join(',') === 'chara,ccv3', kw.join(','));
  const byKw = Object.fromEntries(chunks.map((c) => [c.keyword, c.json]));
  check('④c ccv3 是**纯 CCv3**：spec/data 与 V3 独有字段原样',
    byKw.ccv3.spec === 'chara_card_v3' && byKw.ccv3.data.nickname === 'NICK' && byKw.ccv3.data.assets.length === 1, '');
  check('④d ccv3 里的装饰器一个不少（CCv3 那份是原文）',
    byKw.ccv3.data.character_book.entries[0].content.startsWith('@@position') && byKw.ccv3.data.character_book.entries[1].content.startsWith('@@activate'), '');
  check('④e chara 是 V2 投影（V2 独有字段缺席、装饰器已摘）',
    byKw.chara.spec === 'chara_card_v2' && byKw.chara.data.nickname === undefined
    && byKw.chara.data.character_book.entries[0].content.indexOf('@@') < 0, '');
  check('④f 卡片 JSON 顶层没有 ST 私有键（规范禁止往 CharacterCard 里加应用字段）',
    Object.keys(byKw.ccv3).join(',') === 'spec,spec_version,data', Object.keys(byKw.ccv3).join(','));
}

// ⑤ 读回来：**按载荷里的 spec 判**，块名与顺序都不作数
{
  const png = host.buildPngWithCard(CARD);
  const back = host.extractCardFromPngBytes(png);
  check('⑤ 我们自己导的 PNG 读回来还是 CCv3（读到 chara 的话 normalizeDraft 会直接抛）',
    back.spec === 'chara_card_v3' && back.data.character_book.entries[0].content.startsWith('@@position'), back.spec);
  // 造一张「块名骗人」的 PNG：`chara` 里放纯 CCv3、`ccv3` 里放 V2 投影 —— 应当按载荷判、取那份 CCv3
  const sig = png.slice(0, 8), iend = png.slice(-12);
  const swapped = Buffer.concat([sig, host.buildTEXtChunk(CARD, 'chara'), host.buildTEXtChunk(host.stV2Projection(CARD), 'ccv3'), iend]);
  const got = host.extractCardFromPngBytes(swapped);
  check('⑤b 判据是载荷里的 spec 而不是块名/顺序（chara 里放 V3 也要认出来）',
    got.spec === 'chara_card_v3' && got.data.nickname === 'NICK', got.spec + '/' + String(got.data && got.data.nickname));
  // 只有 V2 块（ST 落盘那种、老工具那种）→ 不再抛错，交出去由上层升级（B2）
  const v2Only = Buffer.concat([sig, host.buildTEXtChunk(host.stV2Projection(CARD), 'chara'), iend]);
  const gotV2 = host.extractCardFromPngBytes(v2Only);
  check('⑤c 只有 V2 块时返回那份 V2 卡（不抛错，交给 normalizeDraft 升级）',
    gotV2.spec === 'chara_card_v2' && gotV2.data.nickname === undefined, gotV2.spec);
  const upV2 = host.upgradeCardToV3(gotV2);
  check('⑤c2 升级后就是 CCv3：spec/spec_version 改写、V2 的 data 全保留、from 报出来',
    upV2.card.spec === 'chara_card_v3' && upV2.card.spec_version === '3.0' && upV2.from === 'chara_card_v2'
    && upV2.card.data.name === '锁天司·探针' && upV2.card.data.character_book.entries.length === 3, upV2.from);
  let emptyErr = '';
  try { host.extractCardFromPngBytes(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])); } catch (e) { emptyErr = e.message; }
  check('⑤d 没有卡片块的 PNG 报的是「未找到 ccv3/chara 块」', emptyErr.indexOf('未找到') >= 0, emptyErr);
}

// ⑥ 嵌入底图：旧块必须被清掉（否则 ST 导出过的图里会留两套，读第一套）
{
  const stLike = host.buildPngWithCard(CARD); // 已经有 chara+ccv3
  const replaced = host.embedCardIntoPngBytes(stLike, { ...CARD, data: { ...CARD.data, name: '换过的卡' } });
  const chunks = pngTextChunks(replaced);
  check('⑥ 嵌入后卡片块仍然恰好两个（旧的 chara/ccv3 被清掉，不留双份）',
    chunks.length === 2 && chunks.map((c) => c.keyword).join(',') === 'chara,ccv3', chunks.map((c) => c.keyword).join(','));
  check('⑥b 两个块都是新卡（不会新旧混用）',
    chunks.every((c) => c.json.data.name === '换过的卡'), chunks.map((c) => c.json.data.name).join(','));
}

// ⑦ 真实 RPC 线：stWorld → 导出副本；草稿不受污染
{
  let route = null;
  const fakeCtx = {
    effect(fn) { fn(); return () => {}; },
    get(name) { if (name === 'connection') return { requestRejection: () => undefined }; return undefined; },
    webServer: { register(r) { route = r; return () => {}; } },
  };
  await host.apply(fakeCtx);
  const server = createServer((req, res) => {
    if (route && (req.url === route.path || req.url.startsWith(route.path + '/'))) { route.handler(req, res); return; }
    res.statusCode = 404; res.end('no route');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const rpc = async (method, args) => {
    const res = await fetch(base + '/dsh-cc-studio-rpc/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'r-' + method, method, payload: { args } }),
    });
    const j = JSON.parse(await res.text());
    return (j && j.result) || {};
  };
  const set = await rpc('cc_setDraft', { sessionId: 'st-1', draft: CARD });
  check('⑦ 播种草稿成功', set.ok === true, JSON.stringify(set).slice(0, 120));

  const withWorld = await rpc('cc_exportPng', { sessionId: 'st-1', stWorld: '锁天司·共享设定' });
  const png = Buffer.from((withWorld.value || {}).b64 || '', 'base64');
  const ccv3 = pngTextChunks(png).find((c) => c.keyword === 'ccv3');
  check('⑦b cc_exportPng 带 stWorld → PNG 里 ccv3 块写上了 extensions.world',
    !!ccv3 && ccv3.json.data.extensions.world === '锁天司·共享设定', ccv3 && JSON.stringify(ccv3.json.data.extensions.world));
  check('⑦c 返回给客户端的 draft 里**没有**这个 ST 专有字段（草稿不动，同「并入本卡」家规）',
    withWorld.value && withWorld.value.draft && withWorld.value.draft.data.extensions.world === undefined,
    JSON.stringify(withWorld.value && withWorld.value.draft && withWorld.value.draft.data.extensions.world));

  const noWorld = await rpc('cc_exportPng', { sessionId: 'st-1' });
  const ccv3No = pngTextChunks(Buffer.from((noWorld.value || {}).b64 || '', 'base64')).find((c) => c.keyword === 'ccv3');
  check('⑦d 没传 stWorld → 不写绑定（不给 ST 留悬空世界名）',
    !!ccv3No && ccv3No.json.data.extensions.world === undefined, JSON.stringify(ccv3No && ccv3No.json.data.extensions.world));

  const chx = await rpc('cc_exportCharx', { sessionId: 'st-1', stWorld: '锁天司·共享设定' });
  const cardJson = zipEntry(Buffer.from((chx.value || {}).b64 || '', 'base64'), 'card.json');
  const chxCard = cardJson ? JSON.parse(cardJson) : null;
  check('⑦e cc_exportCharx 同样带上绑定（card.json 里）',
    !!chxCard && chxCard.data.extensions.world === '锁天司·共享设定' && chxCard.spec === 'chara_card_v3', cardJson ? 'ok' : 'card.json 没解析出来');

  const imp = await rpc('cc_importFromPng', { sessionId: 'st-2', b64: png.toString('base64') });
  check('⑦f 导回工坊仍然按 CCv3 走（读到 chara 会抛 spec 不符）',
    imp.ok === true && imp.value.draft.spec === 'chara_card_v3' && imp.value.draft.data.character_book.entries[0].content.startsWith('@@position'),
    JSON.stringify((imp.value && imp.value.draft && imp.value.draft.spec) || imp).slice(0, 120));

  // —— B2：V2 / V1 走真实 RPC 线（升级而不是拒绝）——
  const v2rpc = await rpc('cc_importFromJson', {
    sessionId: 'st-2',
    json: JSON.stringify({
      spec: 'chara_card_v2', spec_version: '2.0', name: 'V2-RPC', creatorcomment: '注释', talkativeness: 0.6,
      data: { name: 'V2-RPC', description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', tags: [], character_book: { name: 'b', extensions: {}, entries: [{ keys: ['年表'], content: '@@position after_desc\n年表正文' }] } },
    }),
  });
  check('⑦g cc_importFromJson：V2 升级导入、回 upgradedFrom、书条目与装饰器都在',
    v2rpc.ok === true && v2rpc.value.upgradedFrom === 'chara_card_v2' && v2rpc.value.draft.spec === 'chara_card_v3'
    && v2rpc.value.draft.data.creator_notes === '注释' && v2rpc.value.draft.data.extensions.talkativeness === 0.6
    && v2rpc.value.draft.data.character_book.entries[0].content.startsWith('@@position'),
    JSON.stringify(v2rpc.value && { from: v2rpc.value.upgradedFrom, n: v2rpc.value.draft.data.creator_notes }));
  const wrapped = await rpc('cc_importFromJson', { sessionId: 'st-2', json: JSON.stringify({ key: 'k', rev: 3, draft: CARD }) });
  check('⑦h 自家草稿文件那种 {draft:…} 包一层也能直接喂进去（upgradedFrom=null = 本来就是 V3）',
    wrapped.ok === true && wrapped.value.upgradedFrom === null && wrapped.value.draft.data.name === '锁天司·探针', '');
  const badJson = await rpc('cc_importFromJson', { sessionId: 'st-2', json: '{ not json' });
  check('⑦i 不是 JSON 时给可读错误', badJson.ok === false && String(badJson.error.message).indexOf('不是合法 JSON') >= 0,
    JSON.stringify(badJson.error && badJson.error.message));
  const v1rpc = await rpc('cc_importFromJson', { sessionId: 'st-2', json: JSON.stringify({ name: 'V1-RPC', description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '' }) });
  check('⑦j 纯 V1 也能进（from=chara_card_v1）', v1rpc.ok === true && v1rpc.value.upgradedFrom === 'chara_card_v1' && v1rpc.value.draft.data.name === 'V1-RPC', String(v1rpc.value && v1rpc.value.upgradedFrom));
  const v2Png = Buffer.concat([png.slice(0, 8), host.buildTEXtChunk(host.stV2Projection(CARD), 'chara'), png.slice(-12)]);
  const impV2 = await rpc('cc_importFromPng', { sessionId: 'st-3', b64: v2Png.toString('base64') });
  check('⑦k 只有 chara（V2）的 PNG 也能导入，并报 upgradedFrom=chara_card_v2',
    impV2.ok === true && impV2.value.upgradedFrom === 'chara_card_v2' && impV2.value.draft.spec === 'chara_card_v3'
    && impV2.value.draft.data.name === '锁天司·探针', JSON.stringify(impV2.value && impV2.value.upgradedFrom));
  const impV3 = await rpc('cc_importFromPng', { sessionId: 'st-4', b64: png.toString('base64') });
  check('⑦l 双块 PNG 仍然优先 ccv3（upgradedFrom=null，装饰器原样）',
    impV3.ok === true && impV3.value.upgradedFrom === null && impV3.value.draft.data.character_book.entries[0].content.startsWith('@@position'), String(impV3.value && impV3.value.upgradedFrom));

  await new Promise((r) => server.close(r));
}

// ⑨ B2：V2 / V1 卡升级（PNG / CHARX / JSON 三条导入路径共用同一份 upgradeCardToV3）
{
  const v2 = {
    spec: 'chara_card_v2', spec_version: '2.0',
    name: 'V2 卡', description: '顶层描述', first_mes: '顶层开场', creatorcomment: '顶层注释', talkativeness: 0.7, fav: true, tags: 'a, b',
    data: {
      name: 'V2 卡', description: '', personality: 'p', scenario: 's', first_mes: '', mes_example: '',
      alternate_greetings: ['alt'], character_book: { name: '书', extensions: {}, entries: [{ keys: ['k'], content: 'c' }] },
    },
  };
  const up = host.upgradeCardToV3(v2);
  check('⑨ V2 → CCv3：spec/spec_version 改写、from 报出来',
    up.card.spec === 'chara_card_v3' && up.card.spec_version === '3.0' && up.from === 'chara_card_v2', up.from);
  check('⑨b 顶层 V1 平铺字段只在 data 缺值时补（不覆盖 data 自己已有的值）',
    up.card.data.description === '' && up.card.data.first_mes === '' && up.card.data.creator_notes === '顶层注释', 
    JSON.stringify({ d: up.card.data.description, f: up.card.data.first_mes, c: up.card.data.creator_notes }));
  check('⑨c tags 从逗号字符串变数组；ST 的 talkativeness / fav 落进 data.extensions',
    Array.isArray(up.card.data.tags) && up.card.data.tags.join(',') === 'a,b'
    && up.card.data.extensions.talkativeness === 0.7 && up.card.data.extensions.fav === true,
    JSON.stringify(up.card.data.tags));
  check('⑨d 升级是深拷贝：调用方传进来的原对象没被改',
    v2.spec === 'chara_card_v2' && v2.data.description === '' && v2.data.creator_notes === undefined, '');
  const up1 = host.upgradeCardToV3({ name: 'V1 卡', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: 'ex', creatorcomment: 'v1 注释' });
  check('⑨e 纯 V1（没有 data）被包成 data，from=chara_card_v1',
    up1.from === 'chara_card_v1' && up1.card.data.name === 'V1 卡' && up1.card.data.creator_notes === 'v1 注释', up1.from);
  const up3 = host.upgradeCardToV3(CARD);
  check('⑨f 本来就是 CCv3 的原样放行（from=null，连对象都不复制）',
    up3.from === null && up3.card === CARD, String(up3.from));
  let junk = '';
  try { host.upgradeCardToV3({ foo: 1 }); } catch (e) { junk = e.message; }
  check('⑨g 不是卡片时报可读的错（不静默造一张空卡）', junk.indexOf('没有名称') >= 0, junk);
  let nul = '';
  try { host.upgradeCardToV3(null); } catch (e) { nul = e.message; }
  check('⑨h null / 非对象同样被挡住', nul.indexOf('必须是对象') >= 0, nul);
}

// ⑧ 客户端半：绑定是「导出时算、只在副本上写」
{
  const hasKey = (k) => clientSrc.indexOf('"' + k + '"') >= 0;
  check('⑧ 客户端半有 stWorldName 与 export.stWorldBound 词条（zh/en 各一份，四处导出都用它）',
    /function stWorldName\(\)/.test(clientSrc)
    && (clientSrc.match(/"export\.stWorldBound":/g) || []).length === 2
    && (clientSrc.match(/t\("export\.stWorldBound"/g) || []).length === 4,
    'keys=' + (clientSrc.match(/"export\.stWorldBound":/g) || []).length + ' uses=' + (clientSrc.match(/t\("export\.stWorldBound"/g) || []).length);
  check('⑧b 三个 RPC 导出（PNG / 写入 PNG / CHARX）都传 stWorld',
    (clientSrc.match(/args\.stWorld=bound/g) || []).length === 3, String((clientSrc.match(/args\.stWorld=bound/g) || []).length));
  check('⑧c JSON 导出也在导出副本上写绑定（out===state.draft 时先深拷贝）',
    /if\(out===state\.draft\) out=JSON\.parse\(JSON\.stringify\(state\.draft\)\);/.test(clientSrc), '');
  check('⑧d 三条导入路径都把 upgradedFrom 交给提示（JSON / PNG / CHARX），JSON 走宿主 cc_importFromJson',
    (clientSrc.match(/res\.value\.upgradedFrom/g) || []).length === 3 && /cc_importFromJson/.test(clientSrc),
    String((clientSrc.match(/res\.value\.upgradedFrom/g) || []).length));
  check('⑧e 客户端不再自己 parse 卡 JSON：三个老错误键（errNotCcJson / errSpecMismatch / errNoData）已删',
    !/store\.errNotCcJson/.test(clientSrc) && !/store\.errSpecMismatch/.test(clientSrc) && !/store\.errNoData/.test(clientSrc), '');
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 150)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
