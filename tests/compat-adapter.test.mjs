/**
 * 目标适配层回归测试（0.13.0，不随插件发布，files 未含 tests）。
 *
 * 覆盖：
 * ① SillyTavern adapter：世界书字段映射 golden（position/depth 翻译、未知装饰器保留、模板字段齐全）
 * ② 原生 CCv3 adapter：独立 lorebook / 不写平台绑定 / PNG 只写 ccv3 块
 * ③ 宿主新增端点：cc_listTargets / cc_exportBook / cc_exportJson / cc_exportPng(target)
 * ④ 「新增一个实现层」的契约：registry 只有两个目标时也能按 id 渲染；未知 id 回退默认
 *
 * 运行：node tests/compat-adapter.test.mjs   （全绿退出码 0）
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// 隔离副作用：宿主 apply / writeBook 都会解析 DSH_HOME —— 三个变量一起改（同 st-compat 家规）
const originalHome = process.env.HOME, originalUserProfile = process.env.USERPROFILE, originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-studio-compat-adapter-'));
process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.DSH_HOME = sandboxHome;

const host = await import('../lib/index.js');
const compat = await import('../lib/compat/index.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

// —— 样本：与 shared-book-st-export 同一本「锁天司·共享设定」 ——
const BOOK_ENTRIES = [
  { keys: ['天门开', '年表'], content: '@@position after_desc\n【三千年前·天门开】天裂初现。', enabled: true, insertion_order: 0, name: '年表', priority: 10, id: 11, extensions: { cc_auto: true, cc_world_ref: 'timeline' } },
  { keys: ['锁天司', '势力'], content: '@@depth 4\n锁天司（本司）：隐于九霄城地底。', enabled: true, insertion_order: 1, name: '势力', priority: 9, id: 12, extensions: { cc_auto: true, cc_world_ref: 'factions' } },
  { keys: ['九霄城', '地理'], content: '@@position scenario\n九霄城：一千年前沉入地底的旧边城。', enabled: true, insertion_order: 2, name: '地理', id: 13, extensions: {} },
  { keys: ['锁道', '力量体系'], content: '@@activate\n【锁道】以人之所有为一「锁」。', enabled: true, insertion_order: 3, constant: true, name: '力量体系', id: 14, extensions: {} },
  { keys: ['钟惊', '日常'], content: '@@depth 5\n【司中作息】地底没有昼夜。', enabled: true, insertion_order: 4, name: '日常', id: 15, extensions: {} },
  { keys: ['断刃井'], secondary_keys: ['井'], content: '@@weird_thing\n井里都是旧剑。', enabled: false, insertion_order: 5, selective: true, position: 'before_char', name: '断刃井', id: 16, extensions: {} },
];
const BOOK = {
  spec: 'lorebook_v3',
  data: { name: '锁天司·共享设定', description: '四卡共用', scan_depth: 4, token_budget: 2000, recursive_scanning: false, entries: BOOK_ENTRIES, extensions: { cc: { groupId: 'g1', rev: 3 } } },
};
const CARD = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '适配层探针', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: '',
    creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], group_only_greetings: [], tags: [],
    creator: '', character_version: '', creation_date: 1700000000, modification_date: 1700000001,
    assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
    extensions: {},
    character_book: { name: '卡内书', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {}, entries: [
      { keys: ['年表'], content: '@@position after_desc\n【三千年前】天门开。', enabled: true, insertion_order: 0, name: '年表', id: 1, extensions: {} },
    ] },
  },
};

// ——————————————————————————————————————————————————————————————
// ① SillyTavern adapter：世界书字段映射 golden
// ——————————————————————————————————————————————————————————————
{
  const out = JSON.parse(compat.renderBook('sillytavern', BOOK).content);
  check('① 顶层只有 entries（ST 导入端点只认这个；多一个 spec 就 400）',
    Object.keys(out).join(',') === 'entries', Object.keys(out).join(','));
  check('①b entries 是 uid→条目对象；缺 id 用下标兜底', (() => {
    const e = JSON.parse(compat.renderBook('sillytavern', { data: { name: 'x', entries: [{ keys: ['k'], content: 'c' }] } }).content);
    return e.entries['0'] && e.entries['0'].uid === 0 && !('undefined' in e.entries);
  })(), '');
  const st = out.entries['11'];
  check('①c key/keysecondary/comment/addMemo/order/uid/disable 映射',
    JSON.stringify(st.key) === JSON.stringify(['天门开', '年表']) && st.comment === '年表' && st.addMemo === true
    && st.order === 0 && st.uid === 11 && st.disable === false, JSON.stringify({ comment: st.comment, order: st.order }));
  check('①d @@position after_desc → position 1，正文不再有该行',
    st.position === 1 && st.content.indexOf('@@') < 0 && st.content.indexOf('【三千年前·天门开】') === 0, 'position=' + st.position);
  check('①e @@depth 4 → position 4（atDepth）+ depth 4；@@depth 5 → depth 5',
    out.entries['12'].position === 4 && out.entries['12'].depth === 4
    && out.entries['15'].position === 4 && out.entries['15'].depth === 5, '');
  check('①f @@position scenario → position 1（ST 没有 scenario 插入点，跟它自己的 after 回退）',
    out.entries['13'].position === 1, String(out.entries['13'].position));
  check('①g @@activate 原样留给 ST；constant 照 CCv3 字段走',
    out.entries['14'].content.indexOf('@@activate') === 0 && out.entries['14'].constant === true, '');
  check('①h 未知装饰器不猜、不删（ST 自己会丢这类行）',
    out.entries['16'].content.indexOf('@@weird_thing') === 0, JSON.stringify(out.entries['16'].content.slice(0, 20)));
  check('①i 每条都带齐 ST 模板字段（uid 除外全在）', (() => {
    const TPL = ['key', 'keysecondary', 'comment', 'content', 'constant', 'vectorized', 'selective', 'selectiveLogic', 'addMemo', 'order',
      'position', 'disable', 'ignoreBudget', 'excludeRecursion', 'preventRecursion', 'matchPersonaDescription', 'matchCharacterDescription',
      'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes', 'delayUntilRecursion', 'probability',
      'useProbability', 'depth', 'outletName', 'group', 'groupOverride', 'groupWeight', 'scanDepth', 'caseSensitive', 'matchWholeWords',
      'useGroupScoring', 'automationId', 'role', 'sticky', 'cooldown', 'delay', 'triggers'];
    const missing = [];
    Object.keys(out.entries).forEach(k => { const keys = Object.keys(out.entries[k]); TPL.forEach(f => { if (keys.indexOf(f) < 0) missing.push(k + '.' + f); }); });
    return missing.length === 0;
  })(), '');
  check('①j 没有 undefined 泄漏（JSON 往返逐字相等）', JSON.stringify(JSON.parse(JSON.stringify(out))) === JSON.stringify(out), '');
  check('①k 文件名 = 书名 + .json；书名非法字符被替换', (() => {
    const r = compat.renderBook('sillytavern', { data: { name: 'a/b', entries: [] } });
    return r.filename === 'a_b.json' && r.mime === 'application/json';
  })(), compat.renderBook('sillytavern', BOOK).filename);
}

// ——————————————————————————————————————————————————————————————
// ①L 目标能力审计（ST 不认的字段/装饰器 → 可操作告警；不是 CCv3 规范错误）
{
  const issues = compat.auditForTarget('sillytavern', { entries: [
    { name: '正则条目', keys: ['旧校舍'], use_regex: true, priority: 7, content: '旧校舍', extensions: {} },
    { name: '角色条目', keys: ['剑侍'], content: '@@role assistant\n剑侍是司主近卫。', extensions: {} },
    { name: '非法位置', keys: ['x'], content: '@@position 1\n正文', extensions: {} },
    { name: '只有注解', keys: ['y'], content: '@@position after_desc\n@@depth 4', extensions: {} },
  ] });
  const codes = issues.map(i => i.code);
  check('①l ST 能力审计：use_regex / priority / 非法装饰器值 / 只有注解 都能报出来',
    codes.indexOf('st-use-regex-unsupported') >= 0 && codes.indexOf('st-priority-unsupported') >= 0
    && codes.indexOf('decorator-position-value') >= 0 && codes.indexOf('st-decorator-only-entry') >= 0, codes.join(','));
  check('①m ST 能力审计：@@role 会被本适配器翻译，不应报 unsupported',
    codes.indexOf('st-decorator-unsupported') < 0, codes.join(','));
}

// ①N 卡内世界书：导出副本上把装饰器写进 extensions（ST 的 convertCharacterBook 只读这些，不解析 content）
{
  const prepared = compat.renderCard('sillytavern', CARD, { world: 'a/b' });
  const e = prepared.card.data.character_book.entries[0];
  check('①n 卡内条目 @@position after_desc → extensions.position=1；绑定名与文件名同 sanitize（a/b → a_b）',
    e.extensions.position === 1 && prepared.card.data.extensions.world === 'a_b', JSON.stringify(e.extensions));
  check('①o 原卡不被污染（导出副本家规：装饰器还在 content、原 extensions 没多）',
    CARD.data.character_book.entries[0].extensions.position === undefined
    && CARD.data.character_book.entries[0].content.startsWith('@@position'), '');
  check('①p PNG chara 块（V2 回填）：正文已剥注解、extensions 仍带 position',
    (() => { const chara = compat.stV2Projection(prepared.card); const ce = chara.data.character_book.entries[0];
      return ce.content.indexOf('@@') < 0 && ce.extensions.position === 1; })(), '');
}

// ①Q 世界书导出：@@role / @@scan_depth / @@additional_keys / @@exclude_keys 翻译成 ST 字段；CRLF 归一
{
  const b = { data: { name: '能力书', entries: [
    { keys: ['k'], content: '@@role assistant\n@@scan_depth 3\n@@additional_keys 旧校舍,天台\n@@depth 2\n正文', enabled: true, id: 1, extensions: {} },
    { keys: ['j'], content: '@@exclude_keys 天台\n正文2', enabled: true, id: 2, extensions: {} },
    { keys: ['crlf'], content: '@@activate\r\n正文3', enabled: true, id: 3, extensions: {} },
  ] } };
  const out = JSON.parse(compat.renderBook('sillytavern', b).content);
  const e1 = out.entries['1'];
  check('①q @@role/@@scan_depth/@@additional_keys 翻译 + 正文清干净',
    e1.role === 2 && e1.scanDepth === 3 && JSON.stringify(e1.keysecondary) === JSON.stringify(['旧校舍', '天台'])
    && e1.selective === true && e1.selectiveLogic === 0 && e1.position === 4 && e1.depth === 2
    && e1.content === '正文', JSON.stringify({ role: e1.role, scan: e1.scanDepth, ks: e1.keysecondary }));
  const e2 = out.entries['2'];
  check('①r @@exclude_keys → NOT_ANY（selectiveLogic=2）',
    JSON.stringify(e2.keysecondary) === JSON.stringify(['天台']) && e2.selectiveLogic === 2, '');
  const e3 = out.entries['3'];
  check('①s CRLF 归一：@@activate\\r 归一成 @@activate（ST 不再静默失效）',
    e3.content === '@@activate\n正文3' && e3.content.indexOf('\r') < 0, JSON.stringify(e3.content));
}

// ② 原生 CCv3 adapter
// ——————————————————————————————————————————————————————————————
{
  const out = JSON.parse(compat.renderBook('ccv3', BOOK).content);
  check('② CCv3 世界书：{spec:lorebook_v3,data} 原样、条目内容不动',
    out.spec === 'lorebook_v3' && out.data.entries.length === BOOK_ENTRIES.length
    && out.data.entries[0].content.indexOf('@@position') === 0, '');
  check('②b CCv3 卡导出副本不写平台绑定', compat.renderCard('ccv3', CARD, { world: 'x' }).card.data.extensions.world === undefined, '');
  const png = compat.buildPngWithCard(CARD, [compat.buildTEXtChunk(CARD, 'ccv3')]);
  // 简易 tEXt 块名扫描
  const kws = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const len = (png[off] << 24) | (png[off + 1] << 16) | (png[off + 2] << 8) | png[off + 3];
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === 'tEXt') {
      const data = png.slice(off + 8, off + 8 + len);
      const zero = data.indexOf(0);
      kws.push(String.fromCharCode.apply(null, Array.from(data.slice(0, zero))));
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  check('②c CCv3 目标 PNG 只写 ccv3 块（不写 chara 回填）', kws.join(',') === 'ccv3', kws.join(','));
}

// ——————————————————————————————————————————————————————————————
// ③ 宿主端点：cc_listTargets / cc_exportBook / cc_exportJson / cc_exportPng(target)
// ——————————————————————————————————————————————————————————————
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const rpc = async (method, args) => {
  const res = await fetch(base + '/dsh-cc-studio-rpc/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'a-' + method, method, payload: { args } }),
  });
  return (JSON.parse(await res.text()) || {}).result || {};
};
/** 简易 PNG tEXt 块扫描（测试自己解）。 */
function pngBlocks(b64) {
  const bytes = Buffer.from(b64, 'base64');
  const out = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (type === 'tEXt') {
      const data = bytes.slice(off + 8, off + 8 + len);
      const zero = data.indexOf(0);
      const kw = String.fromCharCode.apply(null, Array.from(data.slice(0, zero)));
      out.push({ keyword: kw, json: JSON.parse(Buffer.from(data.slice(zero + 1).toString('utf8'), 'base64').toString('utf8')) });
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

// 写一本共享书（宿主 writeBook 会落盘到隔离的 DSH_HOME）
await host.writeBook('g1', BOOK);
const seeded = await rpc('cc_setDraft', { sessionId: 'ca-1', draft: CARD });
check('③ 播种草稿成功', seeded.ok === true, JSON.stringify(seeded).slice(0, 100));

const targets = await rpc('cc_listTargets', {});
check('③b cc_listTargets：两个目标 + 默认 ST + 能力矩阵',
  targets.ok === true && targets.value.targets.map(t => t.id).join(',') === 'ccv3,sillytavern'
  && targets.value.defaultTarget === 'sillytavern'
  && targets.value.targets[1].capabilities.lorebookV3 === false, JSON.stringify(targets.value && targets.value.defaultTarget));
// 0.15.0 远程导入：目标表里带 `remote` 描述的目标才会在客户端出现「导入到 …」区块；
// 路径/字段名是 ST 差异的唯一出处（客户端与 index.js 都不写死）。
const stRemote = targets.value && targets.value.targets[1] && targets.value.targets[1].remote;
check('③b2 ST 目标带 remote 描述（探测/CSRF/世界书/角色卡四条路径）',
  !!stRemote && stRemote.defaultBaseUrl === 'http://127.0.0.1:8000'
  && stRemote.probe.path === '/csrf-token' && stRemote.csrf.path === '/csrf-token'
  && stRemote.world.list.path === '/api/worldinfo/list'
  && stRemote.world.import.path === '/api/worldinfo/import'
  && stRemote.card.import.path === '/api/characters/import'
  && stRemote.card.import.field === 'avatar' && stRemote.card.import.typeValue === 'png',
  JSON.stringify(stRemote));
check('③b3 CCv3 目标没有 remote（导出弹层不会出现导入区块）',
  !(targets.value && targets.value.targets[0] && targets.value.targets[0].remote), '');

const bookSt = await rpc('cc_exportBook', { groupId: 'g1', target: 'sillytavern' });
check('③c cc_exportBook(ST)：真实路由返回 {filename, content:{entries}}，文件名 = 书名',
  bookSt.ok === true && bookSt.value.filename === '锁天司·共享设定.json'
  && JSON.parse(bookSt.value.content).entries['11'].position === 1, bookSt.ok && bookSt.value.filename);

const bookCcv3 = await rpc('cc_exportBook', { groupId: 'g1', target: 'ccv3' });
check('③d cc_exportBook(CCv3)：返回 lorebook_v3',
  bookCcv3.ok === true && JSON.parse(bookCcv3.value.content).spec === 'lorebook_v3', bookCcv3.ok && bookCcv3.value.filename);

const bookMissing = await rpc('cc_exportBook', { groupId: 'no-such-group', target: 'sillytavern' });
check('③e cc_exportBook：书不存在 → book-not-found（不静默成功）',
  bookMissing.ok === false && bookMissing.error.details.code === 'book-not-found', JSON.stringify(bookMissing.error && bookMissing.error.details));

const json = await rpc('cc_exportJson', { sessionId: 'ca-1', stWorld: '锁天司·共享设定' });
const jsonCard = JSON.parse(json.value.content);
check('③f cc_exportJson：宿主导出、副本写绑定、返回的 draft 不带绑定',
  json.ok === true && jsonCard.data.extensions.world === '锁天司·共享设定'
  && json.value.draft.data.extensions.world === undefined && json.value.filename === '适配层探针.json',
  json.value.filename);
check('③g cc_exportJson：默认目标 = ST（历史行为不变）', json.value.target === 'sillytavern', json.value.target);

const jsonMerge = await rpc('cc_exportJson', { sessionId: 'ca-1', groupId: 'g1', bookMerge: true });
check('③h cc_exportJson + bookMerge：共享书里卡内没有的条目并进导出副本（只并入 5 条重复之外的那条）',
  jsonMerge.ok === true && jsonMerge.value.merged >= 1
  && JSON.parse(jsonMerge.value.content).data.character_book.entries.length > 1,
  'merged=' + jsonMerge.value.merged);

const pngSt = await rpc('cc_exportPng', { sessionId: 'ca-1', stWorld: '锁天司·共享设定' });
const stBlocks = pngBlocks(pngSt.value.b64);
check('③i cc_exportPng 默认目标：chara + ccv3 两个块、ccv3 带绑定、返回 draft 不带',
  stBlocks.map(b => b.keyword).join(',') === 'chara,ccv3'
  && stBlocks.find(b => b.keyword === 'ccv3').json.data.extensions.world === '锁天司·共享设定'
  && pngSt.value.draft.data.extensions.world === undefined,
  stBlocks.map(b => b.keyword).join(','));

const pngCcv3 = await rpc('cc_exportPng', { sessionId: 'ca-1', target: 'ccv3' });
const ccBlocks = pngBlocks(pngCcv3.value.b64);
check('③j cc_exportPng target=ccv3：只写 ccv3 块（不写 chara）、也无绑定',
  ccBlocks.map(b => b.keyword).join(',') === 'ccv3'
  && ccBlocks[0].json.data.extensions.world === undefined, ccBlocks.map(b => b.keyword).join(','));

const charx = await rpc('cc_exportCharx', { sessionId: 'ca-1', target: 'ccv3' });
check('③k cc_exportCharx：CHARX 容器仍是 card.json，target 只影响导出副本',
  charx.ok === true && charx.value.filename === '适配层探针.charx', charx.ok && charx.value.filename);

// ——————————————————————————————————————————————————————————————
// ④ 扩展性验收：新增一个「基于 CCv3 的标准」= 加一个文件 + registerTarget
// 核心（core/index/client/agent）一行不用改；UI 按 cc_listTargets 自动多出按钮。
// ——————————————————————————————————————————————————————————————
{
  const before = compat.listTargets().map(t => t.id);
  check('④ 默认只有 CCv3 + SillyTavern 两个目标（注册表顺序 = UI 顺序；样板目标不自动上架）',
    before.join(',') === 'ccv3,sillytavern', before.join(','));
  compat.registerTarget(compat.ccv3NativeAdapter);
  const after = compat.listTargets().map(t => t.id);
  check('④b registerTarget 后 listTargets 自动出现（客户端按钮按它渲染）',
    after.indexOf('ccv3-native') >= 0 && after.length === before.length + 1, after.join(','));
  const out = compat.renderBook('ccv3-native', { data: { name: '样板书', entries: [] } });
  check('④c 新目标的平台特色只活在自己的实现层（世界书文件名 .world.json）',
    out.filename === '样板书.world.json' && JSON.parse(out.content).spec === 'lorebook_v3', out.filename);
  check('④d 新目标导出卡不写绑定（核心/客户端无需改）',
    compat.renderCard('ccv3-native', CARD, { world: 'x' }).card.data.extensions.world === undefined, '');
}

// ③L 0.14.1：导出可以指定已存卡（cardId）——点哪张导哪张，不要求先载入
{
  const libDir = join(sandboxHome, 'cc-library');
  mkdirSync(libDir, { recursive: true });
  const libCard = JSON.parse(JSON.stringify(CARD));
  libCard.data.name = '库里的卡';
  writeFileSync(join(libDir, 'lib-1.json'), JSON.stringify({ id: 'lib-1', meta: { name: '库里的卡', groupId: '' }, draft: libCard }), 'utf8');

  const libJson = await rpc('cc_exportJson', { sessionId: 'ca-1', cardId: 'lib-1' });
  const libJsonCard = JSON.parse(libJson.value.content);
  check('③L cc_exportJson 带 cardId：导出库卡（不是草稿），source=library',
    libJson.ok === true && libJsonCard.data.name === '库里的卡'
    && libJson.value.source === 'library' && libJson.value.cardId === 'lib-1',
    libJson.ok && libJsonCard.data.name);

  const libPng = await rpc('cc_exportPng', { sessionId: 'ca-1', cardId: 'lib-1' });
  const libBlocks = pngBlocks(libPng.value.b64);
  check('③L2 cc_exportPng 带 cardId：ccv3 块是库卡内容',
    libPng.ok === true && libBlocks.find(b => b.keyword === 'ccv3').json.data.name === '库里的卡',
    libBlocks.map(b => b.keyword).join(','));

  const missing = await rpc('cc_exportJson', { sessionId: 'ca-1', cardId: 'no-such-card' });
  check('③L3 cardId 不存在 → card-not-found（不静默导出草稿）',
    missing.ok === false && missing.error.details.code === 'card-not-found',
    JSON.stringify(missing.error && missing.error.details));
}

await new Promise(r => server.close(r));
rmSync(sandboxHome, { recursive: true, force: true });
process.env.HOME = originalHome; process.env.USERPROFILE = originalUserProfile; process.env.DSH_HOME = originalDshHome;

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 180)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
