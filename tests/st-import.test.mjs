/**
 * 远程导入（SillyTavern）回归测试（0.15.0，不随插件发布）。
 *
 * 两层：
 *   ① 纯函数（lib/compat/remote.js）：地址规范化 / multipart 编码 / 书名决策 / 错误分类；
 *   ② 宿主端点（cc_stProbe / cc_stImport）对着一个**假的 SillyTavern HTTP 服务**跑：
 *      假服务照 ST 1.19 的真实协议实现 —— 先 GET /csrf-token 拿 token + set-cookie，
 *      之后所有请求必须带 `x-csrf-token` 与同一 session cookie；世界书/角色卡都是
 *      `multer().single('avatar')` 的 multipart；世界名 = 上传文件名。
 *
 * 这里不启动 dsh、不写真实用户目录（三个变量一起隔离，理由见 AGENTS §2.6）。
 *
 * 运行：node tests/st-import.test.mjs   （全绿退出码 0）
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-studio-st-import-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.DSH_HOME = sandboxHome;

const compat = await import('../lib/compat/index.js');
const host = await import('../lib/index.js');

import { check, finish } from './harness.mjs';

// ============================================================
// ① 纯函数
// ============================================================
{
  const base = compat.normalizeStBaseUrl('127.0.0.1:8000', 'http://fallback:1');
  check('①a 缺 scheme 时补 http://，默认端口原样保留', base === 'http://127.0.0.1:8000', base);
  check('①b 空地址回退 adapter 给的默认值', compat.normalizeStBaseUrl('', 'http://127.0.0.1:8000') === 'http://127.0.0.1:8000', '');
  check('①c 去掉尾斜杠、query 与 hash',
    compat.normalizeStBaseUrl('http://127.0.0.1:8000///?x=1#y').replace(/\/+$/, '') === 'http://127.0.0.1:8000',
    compat.normalizeStBaseUrl('http://127.0.0.1:8000///?x=1#y'));
  check('①d 保留子路径（反向代理场景）', compat.normalizeStBaseUrl('https://host/st/') === 'https://host/st', compat.normalizeStBaseUrl('https://host/st/'));
  let bad = null;
  try{ compat.normalizeStBaseUrl('ftp://127.0.0.1/x'); }catch(e){ bad = e.code; }
  check('①e 只允许 http/https', bad === 'st-bad-url', String(bad));
  bad = null;
  try{ compat.normalizeStBaseUrl('http://user:pass@127.0.0.1:8000'); }catch(e){ bad = e.code; }
  check('①f 拒绝 URL 里带凭据', bad === 'st-bad-url', String(bad));
  bad = null;
  try{ compat.normalizeStBaseUrl('http://'); }catch(e){ bad = e.code; }
  check('①g 非法地址抛 st-bad-url', bad === 'st-bad-url', String(bad));
  check('①h stUrl 拼接不产生双斜杠',
    compat.stUrl('http://a:1/', '/api/x') === 'http://a:1/api/x' && compat.stUrl('http://a:1', 'api/x') === 'http://a:1/api/x', '');

  const cookie = compat.cookieFromSetCookie([
    'session-abc=xyz=123; Path=/; HttpOnly; SameSite=Lax',
    'other=1; Path=/',
  ]);
  check('①i set-cookie → cookie 串（值里的 = 保留、属性丢掉）', cookie === 'session-abc=xyz=123; other=1', cookie);
  const headers = compat.buildStHeaders({ token: 'tok', cookie: 'a=1', username: 'u', password: 'p' });
  check('①j 请求头：csrf + cookie + Basic',
    headers['x-csrf-token'] === 'tok' && headers.cookie === 'a=1'
    && headers.authorization === 'Basic ' + Buffer.from('u:p').toString('base64'),
    JSON.stringify(headers));

  const mp = compat.encodeMultipart({ file_type: 'png' }, [{ field: 'avatar', filename: '共享书一.json', contentType: 'application/json', data: Buffer.from('{"entries":{}}', 'utf8') }], { boundary: 'B' });
  const mpText = mp.body.toString('utf8');
  check('①k multipart：字段 + 文件名（UTF-8）+ 内容 + 结束边界',
    mp.contentType === 'multipart/form-data; boundary=B'
    && mpText.indexOf('name="file_type"\r\n\r\npng') >= 0
    && mpText.indexOf('filename="共享书一.json"') >= 0
    && mpText.indexOf('{"entries":{}}') >= 0
    && mpText.endsWith('--B--\r\n'),
    mpText.slice(0, 160));

  const shared = { data: { name: '共享书一', entries: [{ content: 'x' }] } };
  const cardBook = { name: '卡内书', entries: [{ content: 'y' }] };
  const p1 = compat.decideStImportPlan({ stWorld: '共享书一', groupBook: shared, existingWorlds: [], cardBook: cardBook });
  check('①l 共享书优先：有内容且 ST 没有同名书 → 导入', p1.source === 'shared' && p1.action === 'import' && p1.worldName === '共享书一', JSON.stringify(p1));
  const p2 = compat.decideStImportPlan({ stWorld: '共享书一', groupBook: shared, existingWorlds: ['共享书一'] });
  check('①m ST 已有同名书 → 默认 skip（不覆盖用户改过的书）', p2.action === 'skip' && p2.existed === true, JSON.stringify(p2));
  const p3 = compat.decideStImportPlan({ stWorld: '共享书一', groupBook: shared, existingWorlds: ['共享书一'], worldMode: 'overwrite' });
  check('①n worldMode=overwrite 才覆盖', p3.action === 'import', JSON.stringify(p3));
  const p4 = compat.decideStImportPlan({ cardBook: cardBook, existingWorlds: [] });
  check('①o 没有共享书时用卡内书（书名 = character_book.name）', p4.source === 'card' && p4.worldName === '卡内书' && p4.action === 'import', JSON.stringify(p4));
  const p5 = compat.decideStImportPlan({ cardName: '无名书卡', cardBook: { entries: [{ content: 'z' }] }, existingWorlds: [] });
  check('①p 卡内书没有 name → <卡名>\'s Lorebook（与 ST 前端一致）', p5.worldName === "无名书卡's Lorebook", JSON.stringify(p5));
  const p6 = compat.decideStImportPlan({ stWorld: '丢了', groupBook: null, existingWorlds: [] });
  check('①q 共享书读不到 → skip + warning（卡照导，绑定可能悬空）',
    p6.action === 'skip' && p6.warning === 'shared-book-missing', JSON.stringify(p6));
  const p7 = compat.decideStImportPlan({ stWorld: '', cardBook: { entries: [] }, existingWorlds: [] });
  check('①r 两边都没有书 → none（不导书也不写绑定）', p7.source === 'none' && p7.action === 'none', JSON.stringify(p7));

  check('①s /api/worldinfo/list 的返回 → file_id 列表（去重、兼容 name）',
    JSON.stringify(compat.worldListNames([{ file_id: 'a', name: 'A' }, { name: 'b' }, { file_id: 'a' }, null]))
    === JSON.stringify(['a', 'b']), JSON.stringify(compat.worldListNames([{ file_id: 'a' }, { file_id: 'a' }])));
  check('①t 导书响应没有 name 时退回预期名', compat.pickWorldName({}, '预期') === '预期' && compat.pickWorldName({ name: '实际' }, '预期') === '实际', '');

  const lore = compat.lorebookOfCardBook(cardBook);
  check('①u 卡内书 → lorebook_v3 形状（深拷贝，不动原对象）',
    lore && lore.spec === 'lorebook_v3' && lore.data.entries.length === 1 && cardBook.name === '卡内书',
    JSON.stringify(lore && lore.spec));
  check('①v 卡内书为空 → null（不导空书）', compat.lorebookOfCardBook({ entries: [] }) === null, '');

  const f401 = compat.classifyStFailure(401, '');
  const f403 = compat.classifyStFailure(403, 'Invalid CSRF token');
  const f403b = compat.classifyStFailure(403, '<html>forbidden</html>');
  const f404 = compat.classifyStFailure(404, '');
  const f500 = compat.classifyStFailure(500, '<html><body>boom</body></html>');
  check('①w 错误分类：401 / 403+CSRF / 403 / 404 / 500',
    f401.code === 'st-auth' && f403.code === 'st-csrf' && f403b.code === 'st-forbidden'
    && f404.code === 'st-bad-response' && f500.code === 'st-import-failed',
    [f401.code, f403.code, f403b.code, f404.code, f500.code].join(','));
  check('①x 错误分类：错误体去掉 HTML 标签并截断', f500.message.indexOf('<html>') < 0 && f500.message.length < 120, f500.message);

  const fe1 = compat.classifyFetchError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  const fe2 = compat.classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  const fe3 = compat.classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
  check('①y 连接错误分类：超时 / 端口未监听 / 域名解析失败',
    fe1.code === 'st-timeout' && fe2.code === 'st-offline' && fe3.code === 'st-offline',
    [fe1.code, fe2.code, fe3.code].join(','));
}

// ============================================================
// ② 假 SillyTavern（照 ST 1.19 的真实协议）
// ============================================================
const stState = {
  mode: 'ok',                 // ok | auth | forbidden | csrf-fail
  worlds: [],
  worldImportStatus: 200,
  cardImportStatus: 200,
  token: 'tok-1',
  cookieName: 'session-test',
  cookieValue: 'abc123',
  requests: [],
  worldImports: [],
  cardImports: [],
};
function parseMultipart(body, contentType){
  const m = /boundary=([^;]+)/i.exec(String(contentType || ''));
  const boundary = m ? m[1].replace(/^"|"$/g, '') : '';
  if(!boundary) return [];
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let idx = 0;
  while(true){
    const start = body.indexOf(delim, idx);
    if(start < 0) break;
    const after = start + delim.length;
    if(body.slice(after, after + 2).toString('latin1') === '--') break;
    const headStart = after + 2; // CRLF
    const next = body.indexOf(delim, headStart);
    if(next < 0) break;
    const part = body.slice(headStart, next - 2); // 去掉分隔符前的 CRLF
    const sep = part.indexOf('\r\n\r\n');
    if(sep < 0){ idx = next; continue; }
    const head = part.slice(0, sep).toString('utf8');
    const data = part.slice(sep + 4);
    parts.push({
      name: (/name="([^"]*)"/.exec(head) || [])[1] || '',
      filename: (/filename="([^"]*)"/.exec(head) || [])[1] || '',
      contentType: (/Content-Type:\s*([^\r\n]+)/i.exec(head) || [])[1] || '',
      data: data,
    });
    idx = next;
  }
  return parts;
}
const stServer = createServer(async function(req, res){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  stState.requests.push({ method: req.method, url: req.url, headers: req.headers, body: body });
  const sendJson = function(status, obj, headers){
    res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, headers || {}));
    res.end(JSON.stringify(obj));
  };
  const sendText = function(status, text, headers){
    res.writeHead(status, Object.assign({ 'content-type': 'text/html' }, headers || {}));
    res.end(text);
  };
  // ST 的 /csrf-token 在 requireLoginMiddleware **之前**，无需登录；但它自己走 Basic auth
  // 与 whitelist（这里只用 mode 模拟结果）。
  if(req.url === '/csrf-token' && req.method === 'GET'){
    if(stState.mode === 'auth'){ sendText(401, 'unauthorized'); return; }
    if(stState.mode === 'forbidden'){ sendText(403, 'forbidden'); return; }
    sendJson(200, { token: stState.token }, {
      'set-cookie': stState.cookieName + '=' + stState.cookieValue + '; Path=/; HttpOnly; SameSite=Lax',
    });
    return;
  }
  // 之后所有请求都必须带同一会话 cookie + CSRF 头（ST 的 csrfSync 会这样校验）
  if(stState.mode === 'csrf-fail'){
    sendText(403, 'Invalid CSRF token. Please refresh the page and try again.');
    return;
  }
  const cookieOk = String(req.headers.cookie || '').indexOf(stState.cookieName + '=' + stState.cookieValue) >= 0;
  const tokenOk = String(req.headers['x-csrf-token'] || '') === stState.token;
  if(!cookieOk || !tokenOk){ sendText(403, 'Invalid CSRF token. Please refresh the page and try again.'); return; }
  if(req.url === '/version' && req.method === 'GET'){ sendJson(200, { pkgVersion: '1.19.0' }); return; }
  if(req.url === '/api/worldinfo/list' && req.method === 'POST'){
    sendJson(200, stState.worlds.map(function(n){ return { file_id: n, name: n }; }));
    return;
  }
  if(req.url === '/api/worldinfo/import' && req.method === 'POST'){
    if(stState.worldImportStatus !== 200){ sendText(stState.worldImportStatus, 'bad'); return; }
    const parts = parseMultipart(body, req.headers['content-type']);
    const file = parts.filter(function(p){ return p.name === 'avatar'; })[0];
    stState.worldImports.push(file || null);
    const name = file ? String(file.filename || '').replace(/\.json$/i, '') : '';
    sendJson(200, { name: name });
    return;
  }
  if(req.url === '/api/characters/import' && req.method === 'POST'){
    if(stState.cardImportStatus !== 200){ sendText(stState.cardImportStatus, 'bad'); return; }
    const parts = parseMultipart(body, req.headers['content-type']);
    stState.cardImports.push({ parts: parts, fileType: (parts.filter(function(p){ return p.name === 'file_type'; })[0] || {}).data ? (parts.filter(function(p){ return p.name === 'file_type'; })[0].data.toString('utf8')) : '' });
    sendJson(200, { file_name: '工坊测试卡' });
    return;
  }
  sendText(404, 'no route');
});

// ============================================================
// 宿主 RPC 通道（与 rpc-channel.test.mjs 同一套假 ctx）
// ============================================================
let route = null;
const fakeCtx = {
  effect(fn){ fn(); return function(){}; },
  get(){ return undefined; },
  webServer: { register(r){ route = r; return function(){ route = null; }; } },
};
await host.apply(fakeCtx);
const rpcServer = createServer(function(req, res){
  if(route && (req.url === route.path || req.url.startsWith(route.path + '/'))){
    route.handler(req, res);
    return;
  }
  res.statusCode = 404;
  res.end('no route');
});
await new Promise(function(resolve){ rpcServer.listen(0, '127.0.0.1', resolve); });
await new Promise(function(resolve){ stServer.listen(0, '127.0.0.1', resolve); });
const rpcBase = 'http://127.0.0.1:' + rpcServer.address().port;
const stBase = 'http://127.0.0.1:' + stServer.address().port;

async function rpc(endpoint, args){
  const res = await fetch(rpcBase + '/dsh-cc-studio-rpc/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rid-' + endpoint, method: endpoint, payload: { args: args || {} } }),
  });
  const text = await res.text();
  let json = null;
  try{ json = JSON.parse(text); }catch{}
  return { status: res.status, json: json, text: text };
}
function failCode(json){ return json && json.result && !json.result.ok ? json.result.error.details.code : null; }

check('② 宿主注册了 RPC 前缀路由', !!route && route.kind === 'prefix', route ? route.kind : 'null');

// —— 草稿与共享书 ——
const CARD = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '工坊测试卡', nickname: '', description: '描述', personality: '', scenario: '',
    first_mes: '开场', mes_example: '', tags: ['测试'], creator: '我',
    group_only_greetings: ['群聊开场'], alternate_greetings: ['备用开场'],
    creation_date: 1794000000, modification_date: 1794000000,
    extensions: {},
    character_book: {
      name: '卡内书', description: '',
      entries: [{ keys: ['卡内键'], content: '卡内正文', enabled: true, insertion_order: 0 }],
    },
  },
};
const seed = await rpc('cc_setDraft', { sessionId: 's-st', draft: CARD });
check('②b 播种草稿成功', seed.json && seed.json.result && seed.json.result.ok, JSON.stringify(seed.json && seed.json.result && seed.json.result.error));

mkdirSync(join(sandboxHome, 'cc-books'), { recursive: true });
writeFileSync(join(sandboxHome, 'cc-books', 'g1.json'), JSON.stringify({
  spec: 'lorebook_v3', spec_version: '1.0',
  data: {
    name: '共享书一', description: '组共享',
    entries: [{ keys: ['共享键'], content: '共享正文', enabled: true, insertion_order: 0 }],
    extensions: { cc: { rev: 1, groupId: 'g1' } },
  },
}, null, 2), 'utf8');

function resetStState(){
  stState.mode = 'ok';
  stState.worlds = [];
  stState.worldImportStatus = 200;
  stState.cardImportStatus = 200;
  stState.requests.length = 0;
  stState.worldImports.length = 0;
  stState.cardImports.length = 0;
}

// ============================================================
// ③ 探测
// ============================================================
{
  resetStState();
  const r = await rpc('cc_stProbe', { baseUrl: stBase });
  const v = r.json && r.json.result && r.json.result.value;
  check('③a cc_stProbe：在线 + 版本 + 世界书数量',
    !!v && v.online === true && v.auth === 'none' && v.version === '1.19.0' && v.worlds === 0,
    JSON.stringify(v));
  check('③b 探测确实走了 /csrf-token → /version → /api/worldinfo/list',
    stState.requests.map(function(x){ return x.url; }).join(',') === '/csrf-token,/version,/api/worldinfo/list',
    stState.requests.map(function(x){ return x.url; }).join(','));
  check('③c 探测不把 CSRF token / cookie 回给客户端',
    !!v && v.token === undefined && v.cookie === undefined, JSON.stringify(v));
}
{
  resetStState();
  stState.mode = 'auth';
  const r = await rpc('cc_stProbe', { baseUrl: stBase });
  const v = r.json && r.json.result && r.json.result.value;
  check('③d cc_stProbe：401 → online=true + auth=basic-required',
    !!v && v.online === true && v.auth === 'basic-required' && v.error && v.error.code === 'st-auth',
    JSON.stringify(v));
}
{
  resetStState();
  stState.mode = 'forbidden';
  const r = await rpc('cc_stProbe', { baseUrl: stBase });
  const v = r.json && r.json.result && r.json.result.value;
  check('③e cc_stProbe：403 → online=true + auth=forbidden（whitelist / 登录模式）',
    !!v && v.online === true && v.auth === 'forbidden' && v.error && v.error.code === 'st-forbidden',
    JSON.stringify(v));
}
{
  const dead = createServer(function(_q, s){ s.end(); });
  await new Promise(function(resolve){ dead.listen(0, '127.0.0.1', resolve); });
  const port = dead.address().port;
  await new Promise(function(resolve){ dead.close(resolve); });
  const r = await rpc('cc_stProbe', { baseUrl: 'http://127.0.0.1:' + port });
  const v = r.json && r.json.result && r.json.result.value;
  check('③f cc_stProbe：端口没人监听 → online=false + st-offline（不抛 500）',
    !!v && v.online === false && v.error && v.error.code === 'st-offline', JSON.stringify(v));
  check('③g 探测失败仍然是 ok 帧（离线是正常状态，不是异常）',
    r.json && r.json.result && r.json.result.ok === true, JSON.stringify(r.json && r.json.result));
}
{
  const r = await rpc('cc_stProbe', { baseUrl: 'ftp://127.0.0.1:8000' });
  check('③h 非法地址 → fail(st-bad-url)', failCode(r.json) === 'st-bad-url', JSON.stringify(r.json && r.json.result));
}

// ============================================================
// ④ 导入：草稿 + 共享书
// ============================================================
{
  resetStState();
  const before = await rpc('cc_getDraft', { sessionId: 's-st' });
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, groupId: 'g1', stWorld: '共享书一' });
  const v = r.json && r.json.result && r.json.result.value;
  check('④a cc_stImport 成功：返回卡文件名 + 世界书动作', !!v && v.card && v.card.fileName === '工坊测试卡.png' && v.world && v.world.action === 'imported',
    JSON.stringify(v));
  check('④b 先 GET /csrf-token，再 list → world import → card import（顺序固定）',
    stState.requests.map(function(x){ return x.url; }).join(',') === '/csrf-token,/api/worldinfo/list,/api/worldinfo/import,/api/characters/import',
    stState.requests.map(function(x){ return x.url; }).join(','));
  const wi = stState.worldImports[0];
  check('④c 世界书 multipart：字段名 avatar、文件名 = 书名.json、内容顶层只有 entries',
    !!wi && wi.filename === '共享书一.json' && wi.contentType === 'application/json'
    && JSON.parse(wi.data.toString('utf8')).entries !== undefined
    && JSON.parse(wi.data.toString('utf8')).spec === undefined,
    wi ? wi.filename : 'missing');
  const worldText = wi ? wi.data.toString('utf8') : '';
  check('④d 共享书条目按 ST 形态转换（keys → key / content 保留）',
    worldText.indexOf('共享正文') >= 0 && worldText.indexOf('"key"') >= 0, worldText.slice(0, 120));
  const ci = stState.cardImports[0];
  const cardFile = ci && ci.parts.filter(function(p){ return p.name === 'avatar'; })[0];
  check('④e 角色卡 multipart：字段名 avatar、file_type=png、PNG MIME',
    !!ci && ci.fileType === 'png' && !!cardFile && cardFile.contentType === 'image/png'
    && cardFile.data.slice(0, 8).toString('hex') === '89504e470d0a1a0a',
    ci ? ci.fileType + ' / ' + (cardFile ? cardFile.contentType : 'no file') : 'missing');
  let exported = null;
  try{ exported = host.extractCardFromPngBytes(new Uint8Array(cardFile.data)); }catch(e){ exported = { error: String(e && e.message || e) }; }
  check('④f 导入的 PNG 里 ccv3 是 CCv3 卡，且绑定到实际世界书名',
    !!exported && exported.spec === 'chara_card_v3' && exported.data && exported.data.extensions && exported.data.extensions.world === '共享书一',
    JSON.stringify(exported && exported.data && exported.data.extensions && exported.data.extensions.world));
  check('④g 卡内 character_book 原样保留（ST 不读它，但数据不能丢）',
    !!exported && exported.data && exported.data.character_book
    && exported.data.character_book.entries[0].content === '卡内正文',
    JSON.stringify(exported && exported.data && exported.data.character_book && exported.data.character_book.entries));
  const after = await rpc('cc_getDraft', { sessionId: 's-st' });
  check('④h 导入只写导出副本：本地草稿一个字节没动',
    JSON.stringify(after.json.result.value.draft) === JSON.stringify(before.json.result.value.draft),
    'draft changed');
}
{
  // 同名书默认 skip：不覆盖用户改过的书，但卡仍绑定这个名字
  resetStState();
  stState.worlds = ['共享书一'];
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, groupId: 'g1', stWorld: '共享书一' });
  const v = r.json && r.json.result && r.json.result.value;
  check('④i ST 已有同名书 → 默认跳过书导入（不发 worldinfo/import），卡照导并绑定该名',
    !!v && v.world.action === 'skipped' && v.world.existed === true
    && stState.requests.map(function(x){ return x.url; }).indexOf('/api/worldinfo/import') < 0
    && v.world.name === '共享书一',
    JSON.stringify(v && v.world));
}
{
  resetStState();
  stState.worlds = ['共享书一'];
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, groupId: 'g1', stWorld: '共享书一', worldMode: 'overwrite' });
  check('④j worldMode=overwrite → 发 worldinfo/import', stState.worldImports.length === 1, String(stState.worldImports.length));
  const v = r.json && r.json.result && r.json.result.value;
  check('④k 覆盖时仍以 ST 返回的实际书名为准绑定', !!v && v.world.action === 'imported' && v.world.name === '共享书一', JSON.stringify(v && v.world));
}
{
  // 书导入失败 → 中止，不导卡
  resetStState();
  stState.worldImportStatus = 400;
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, groupId: 'g1', stWorld: '共享书一' });
  check('④l 世界书导入失败 → fail(st-book-failed) 且**不导卡**（避免悬空绑定）',
    failCode(r.json) === 'st-book-failed' && stState.cardImports.length === 0,
    failCode(r.json) + ' / cards=' + stState.cardImports.length);
}
{
  resetStState();
  stState.cardImportStatus = 400;
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, groupId: 'g1', stWorld: '共享书一' });
  check('④m 角色卡导入失败 → fail(st-import-failed)', failCode(r.json) === 'st-import-failed', failCode(r.json));
}
{
  resetStState();
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase });
  const v = r.json && r.json.result && r.json.result.value;
  check('④n 没有共享书、也不传 stWorld → 用卡内书（书名 = character_book.name）',
    !!v && v.world.action === 'imported' && v.world.name === '卡内书'
    && stState.worldImports[0] && stState.worldImports[0].filename === '卡内书.json',
    JSON.stringify(v && v.world));
}
{
  resetStState();
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, importBook: false });
  const v = r.json && r.json.result && r.json.result.value;
  check('④o importBook=false → 不导书，卡上也不写绑定',
    !!v && v.world.action === 'none' && stState.worldImports.length === 0,
    JSON.stringify(v && v.world));
}
{
  resetStState();
  stState.mode = 'auth';
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase });
  check('④p 认证失败 → fail(st-auth)（客户端据此展开认证栏）', failCode(r.json) === 'st-auth', failCode(r.json));
}
{
  resetStState();
  stState.mode = 'csrf-fail';
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase });
  check('④q CSRF 被拒 → 不会误报成功', failCode(r.json) !== null, failCode(r.json));
}

// ============================================================
// ⑤ 库卡模式 + 空卡（无书）
// ============================================================
{
  resetStState();
  const saved = await rpc('cc_saveToLibrary', { sessionId: 's-st', draft: CARD, name: '库卡' });
  const id = saved.json && saved.json.result && saved.json.result.value && saved.json.result.value.id;
  check('⑤a 播种库卡成功', !!id, JSON.stringify(saved.json && saved.json.result && saved.json.result.error));
  const r = await rpc('cc_stImport', { cardId: id, baseUrl: stBase, groupId: 'g1', stWorld: '共享书一' });
  const v = r.json && r.json.result && r.json.result.value;
  check('⑤b 库卡模式（cardId）：导出的是库里那张卡，source=library',
    !!v && v.source === 'library' && v.cardId === id && v.card.name === '库卡',
    JSON.stringify(v && { source: v.source, cardId: v.cardId, card: v.card }));
}
{
  resetStState();
  const emptyCard = JSON.parse(JSON.stringify(CARD));
  delete emptyCard.data.character_book;
  await rpc('cc_setDraft', { sessionId: 's-empty', draft: emptyCard });
  const r2 = await rpc('cc_stImport', { sessionId: 's-empty', baseUrl: stBase });
  const v = r2.json && r2.json.result && r2.json.result.value;
  check('⑤c 无书可导：world.action=none，仍能导卡（不写 extensions.world）',
    !!v && v.world.action === 'none' && v.world.name === '' && stState.cardImports.length === 1,
    JSON.stringify(v && v.world) + ' cards=' + stState.cardImports.length);
  const ci = stState.cardImports[0];
  const file = ci && ci.parts.filter(function(p){ return p.name === 'avatar'; })[0];
  let exported = null;
  try{ exported = host.extractCardFromPngBytes(new Uint8Array(file.data)); }catch{}
  check('⑤d 无书时卡副本没有悬空的世界书绑定',
    !!exported && exported.data && (!exported.data.extensions || !exported.data.extensions.world),
    JSON.stringify(exported && exported.data && exported.data.extensions));
}

// ============================================================
// ⑥ 封面（0.15.1 用户实机：选了 JPG 封面 → 导入失败且文案误报「未检测到 ST」）
// ============================================================
{
  resetStState();
  const coverPng = host.buildPngWithCard(CARD);
  const coverB64 = Buffer.from(coverPng).toString('base64');
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, imageB64: coverB64 });
  const v = r.json && r.json.result && r.json.result.value;
  const ci = stState.cardImports[0];
  const file = ci && ci.parts.filter(function(p){ return p.name === 'avatar'; })[0];
  check('⑥a 带 PNG 封面导入成功，且底图被嵌入（导出 PNG 仍是合法 CCv3 卡）',
    !!v && !!file && file.data.slice(0, 8).toString('hex') === '89504e470d0a1a0a',
    JSON.stringify(v && v.card));
  let exported = null;
  try{ exported = host.extractCardFromPngBytes(new Uint8Array(file.data)); }catch{}
  check('⑥b 嵌入封面后 ccv3 块仍可解析', !!exported && exported.spec === 'chara_card_v3', String(exported && exported.spec));
}
{
  resetStState();
  const r = await rpc('cc_stImport', { sessionId: 's-st', baseUrl: stBase, imageB64: Buffer.from('not a png at all').toString('base64') });
  check('⑥c 非 PNG 封面 → fail(bad-cover)，不再误报成「未检测到 ST」',
    failCode(r.json) === 'bad-cover' && stState.cardImports.length === 0,
    failCode(r.json) + ' cards=' + stState.cardImports.length);
}

// ============================================================
// 清理
// ============================================================
await new Promise(function(resolve){ rpcServer.close(resolve); });
await new Promise(function(resolve){ stServer.close(resolve); });
rmSync(sandboxHome, { recursive: true, force: true });
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.env.DSH_HOME = originalDshHome;

finish();
