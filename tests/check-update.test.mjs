/**
 * 「检查更新」回归测试（0.11.3，不随插件发布，files 未包含 tests）。
 *
 * 功能：设置页「角色卡工坊」底部的「检查更新」按钮 → 宿主查 npm registry 的 latest，
 * 与 package.json 的 version 比较；有更新时界面给出可复制的 `@xia-sc/dsh-cc-studio@版本`。
 *
 * 三条不变量（本文件逐条钉住）：
 *   ① 版本比较是 SemVer 第 11 条那一套（预发布段小于正式版、数字标识符按数值比），
 *      脏数据（"unknown" / 空串）不得被误报成「有更新」；
 *   ② 网络只在宿主做，且只在用户点按钮时做 —— `{network:false}` 的探测不得发起 fetch；
 *      查询失败必须回 `check-update-failed` 且带上本机 current（界面要能显示「当前版本」）；
 *   ③ 客户端 store 的 checkUpdate / markUpdateCopied 与设置页渲染走词表键（zh/en 由
 *      client-greetings.test.mjs 的全量守卫兜底），复制优先 clipboard API、失败退回 execCommand。
 *
 * 运行：node tests/check-update.test.mjs   （全绿退出码 0）
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离副作用：apply() 会把 CC 预设装到 <DSH_HOME>/.agent-presets/cc（见 AGENTS.md §2.6，
// 三个变量一起改，只改 DSH_HOME 时读盘会回退真实 ~/.dsh）。
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-update-home-'));
const sandboxDsh = mkdtempSync(join(tmpdir(), 'dsh-cc-update-dsh-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.DSH_HOME = sandboxDsh;

const host = await import('../lib/index.js');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const realFetch = globalThis.fetch;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// ————————————————— 1) 版本比较（纯函数） —————————————————
{
  const cmp = host.compareVersions;
  check('相同版本 → 0', cmp('0.11.2', '0.11.2') === 0, `${cmp('0.11.2', '0.11.2')}`);
  check('patch 更新 → 1', cmp('0.11.3', '0.11.2') === 1, `${cmp('0.11.3', '0.11.2')}`);
  check('patch 更旧 → -1', cmp('0.11.1', '0.11.2') === -1, `${cmp('0.11.1', '0.11.2')}`);
  check('minor / major 比较正确', cmp('0.12.0', '0.11.9') === 1 && cmp('1.0.0', '0.99.99') === 1,
    `${cmp('0.12.0', '0.11.9')} / ${cmp('1.0.0', '0.99.99')}`);
  check('容忍 v 前缀', cmp('v0.11.3', '0.11.2') === 1, `${cmp('v0.11.3', '0.11.2')}`);
  check('忽略 build 元数据', cmp('0.11.3+build.9', '0.11.3') === 0, `${cmp('0.11.3+build.9', '0.11.3')}`);
  check('预发布版 < 同号正式版', cmp('0.12.0-rc.1', '0.12.0') === -1 && cmp('0.12.0', '0.12.0-rc.1') === 1,
    `${cmp('0.12.0-rc.1', '0.12.0')} / ${cmp('0.12.0', '0.12.0-rc.1')}`);
  check('预发布数字标识符按数值比（rc.2 < rc.10）', cmp('0.12.0-rc.2', '0.12.0-rc.10') === -1,
    `${cmp('0.12.0-rc.2', '0.12.0-rc.10')}`);
  check('预发布字母标识符按 ASCII 比（alpha < beta）', cmp('0.12.0-alpha', '0.12.0-beta') === -1,
    `${cmp('0.12.0-alpha', '0.12.0-beta')}`);
  check('数字标识符 < 字母标识符', cmp('0.12.0-1', '0.12.0-alpha') === -1, `${cmp('0.12.0-1', '0.12.0-alpha')}`);
  check('预发布前缀相同时短的更小', cmp('0.12.0-rc', '0.12.0-rc.1') === -1, `${cmp('0.12.0-rc', '0.12.0-rc.1')}`);
  check('脏数据不比出「有更新」（一律 0）',
    cmp('unknown', '0.11.2') === 0 && cmp('', '0.11.2') === 0 && cmp(null, '0.11.2') === 0,
    `${cmp('unknown', '0.11.2')} / ${cmp('', '0.11.2')} / ${cmp(null, '0.11.2')}`);

  check('parseSemver 拆数字段', JSON.stringify(host.parseSemver('1.2.3')) === JSON.stringify({ numbers: [1, 2, 3], pre: [] }),
    JSON.stringify(host.parseSemver('1.2.3')));
  check('parseSemver 拆预发布段', JSON.stringify(host.parseSemver('1.2.3-rc.1')) === JSON.stringify({ numbers: [1, 2, 3], pre: ['rc', '1'] }),
    JSON.stringify(host.parseSemver('1.2.3-rc.1')));
  check('parseSemver 拒绝半截版本号', host.parseSemver('1.2') === null && host.parseSemver('abc') === null,
    `${host.parseSemver('1.2')} / ${host.parseSemver('abc')}`);

  const meta = host.pluginMeta();
  check('pluginMeta 的 name/version 与 package.json 一致', meta.name === pkg.name && meta.version === pkg.version,
    JSON.stringify(meta));
  check('npm 查询地址是 scoped 编码后的 /latest', host.NPM_LATEST_URL === 'https://registry.npmjs.org/@xia-sc%2Fdsh-cc-studio/latest',
    host.NPM_LATEST_URL);
}

// ————————————————— 2) 宿主端点（走真实 HTTP 信封，与浏览器同一条路） —————————————————
let route = null;
const fakeCtx = {
  effect(fn) { fn(); return () => {}; },
  get(name) { return name === 'connection' ? { requestRejection: () => undefined } : undefined; },
  webServer: { register(r) { route = r; return () => { route = null; }; } },
};
const server = createServer((req, res) => {
  if (route && (req.url === route.path || req.url.startsWith(route.path + '/'))) { route.handler(req, res); return; }
  res.statusCode = 404;
  res.end('no route');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
await host.apply(fakeCtx);
await new Promise((r) => setTimeout(r, 50));

let rpcSeq = 0;
async function callEndpoint(endpoint, args) {
  const body = JSON.stringify({ type: 'client-request', rpcId: 'rid-' + (++rpcSeq), method: endpoint, payload: { args: args || {} } });
  const res = await realFetch(base + '/dsh-cc-studio-rpc/' + endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  return JSON.parse(await res.text());
}

let fetchCalls = [];
function stubFetch(impl) {
  fetchCalls = [];
  globalThis.fetch = function (url, opts) { fetchCalls.push({ url, opts }); return impl(url, opts); };
}
const jsonOk = (obj) => ({ ok: true, status: 200, json: async () => obj });

{
  // ① network:false：只回本地版本，**一次 fetch 都不发**
  stubFetch(() => { throw new Error('probe must not touch the network'); });
  const r = await callEndpoint('cc_checkUpdate', { network: false });
  check('探测帧 ok', r && r.result && r.result.ok === true, JSON.stringify(r && r.result && r.result.error));
  const v = (r.result && r.result.value) || {};
  check('探测帧带回 package.json 的版本', v.current === pkg.version && v.package === pkg.name, JSON.stringify(v));
  check('探测帧 source=local、latest 为空、不报可更新',
    v.source === 'local' && v.latest === null && v.updateAvailable === false && v.localNewer === false, JSON.stringify(v));
  check('探测帧给出 installSpec（包名@当前版本）', v.installSpec === pkg.name + '@' + pkg.version, v.installSpec);
  check('探测帧没有发起任何网络请求', fetchCalls.length === 0, `fetchCalls=${fetchCalls.length}`);
}

{
  // ② latest 更新：可更新 + 版本号 + 可复制 spec
  stubFetch(async () => jsonOk({ name: pkg.name, version: '99.0.0' }));
  const r = await callEndpoint('cc_checkUpdate', {});
  const v = (r.result && r.result.value) || {};
  check('可更新时 updateAvailable=true', v.updateAvailable === true, JSON.stringify(v));
  check('可更新时 latest / source / checkedAt 都对',
    v.latest === '99.0.0' && v.source === 'registry' && typeof v.checkedAt === 'number', JSON.stringify(v));
  check('可更新时 installSpec = 包名@latest', v.installSpec === pkg.name + '@99.0.0', v.installSpec);
  check('只查 latest 一个地址、且带 accept: application/json',
    fetchCalls.length === 1 && fetchCalls[0].url === host.NPM_LATEST_URL && /application\/json/.test(fetchCalls[0].opts.headers.accept),
    JSON.stringify(fetchCalls[0] && { url: fetchCalls[0].url }));
}

{
  // ③ latest 与本地相同 / 更旧
  stubFetch(async () => jsonOk({ version: pkg.version }));
  const same = ((await callEndpoint('cc_checkUpdate', {})).result.value) || {};
  check('同版本 → 不可更新、不是 dev 版本',
    same.updateAvailable === false && same.localNewer === false && same.installSpec === pkg.name + '@' + pkg.version,
    JSON.stringify(same));

  stubFetch(async () => jsonOk({ version: '0.0.1' }));
  const older = ((await callEndpoint('cc_checkUpdate', {})).result.value) || {};
  check('npm 上的更旧 → localNewer=true（本机是开发版本）',
    older.updateAvailable === false && older.localNewer === true && older.latest === '0.0.1', JSON.stringify(older));
}

{
  // ④ 各种失败：必须回 check-update-failed + 本机 current（界面要能显示当前版本）
  stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  const httpErr = await callEndpoint('cc_checkUpdate', {});
  check('registry 5xx → fail 帧 + check-update-failed',
    httpErr.result.ok === false && httpErr.result.error.details.code === 'check-update-failed',
    JSON.stringify(httpErr.result.error && httpErr.result.error.details));
  check('失败帧仍带本机 current / registry',
    httpErr.result.error.details.current === pkg.version && httpErr.result.error.details.registry === host.NPM_LATEST_URL,
    JSON.stringify(httpErr.result.error.details));

  stubFetch(async () => jsonOk({ version: 'not-a-version' }));
  const badVer = await callEndpoint('cc_checkUpdate', {});
  check('脏版本号 → 失败而不是误报更新',
    badVer.result.ok === false && badVer.result.error.details.code === 'check-update-failed',
    JSON.stringify(badVer.result.error && badVer.result.error.message));

  stubFetch(() => Promise.reject(new Error('ENOTFOUND registry.npmjs.org')));
  const netErr = await callEndpoint('cc_checkUpdate', {});
  check('断网 → 失败帧的原 message 透出来',
    netErr.result.ok === false && /ENOTFOUND/.test(netErr.result.error.message),
    JSON.stringify(netErr.result.error && netErr.result.error.message));
  check('网络异常不会写坏本机版本号（current 仍是 package.json）',
    netErr.result.error.details.current === pkg.version, JSON.stringify(netErr.result.error.details));

  globalThis.fetch = realFetch;
}

server.close();

// ————————————————— 3) 客户端 store + 设置页渲染 —————————————————
const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// 假 React：hook 顺序可预期，effect 收集起来由测试手动跑
const effectQueue = [];
const React = {
  createElement(type, props) { return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }; },
  useState(init) { return [typeof init === 'function' ? init() : init, function () {}]; },
  useCallback(fn) { return fn; },
  useEffect(fn) { effectQueue.push(fn); },
  useMemo(fn) { return fn(); },
  useRef(init) { return { current: init }; },
};

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
const timeouts = [];
const intervals = [];
globalThis.setTimeout = function (fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function (fn, ms) { intervals.push({ fn, ms }); return intervals.length; };
globalThis.clearInterval = function () {};

const storage = new Map();
globalThis.localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
};

const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let clipboardWrites = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: { clipboard: { writeText(s) { clipboardWrites.push(String(s)); return Promise.resolve(); } } },
});

const calls = [];
let handler = function () { return { ok: false, error: { code: 'internal', message: 'no handler' } }; };
const rpcCall = function (channel, endpoint, payload) { calls.push({ channel, endpoint, payload }); return Promise.resolve(handler(endpoint, payload)); };
const callsOf = (endpoint) => calls.filter((c) => c.endpoint === endpoint);

const registered = {};
const clientCtx = {
  effect(fn) { fn(); return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call: rpcCall } },
};

let registration = null;
globalThis.window = { __ModuleLoader__: { load(def) { registration = def; } } };
new Function('window', src)(globalThis.window);
const mod = registration.factory((id) => { if (id === 'react') return React; throw new Error('unexpected require: ' + id); });
await mod.apply(clientCtx);

const settingsReg = registered['settings.section'];
const store = settingsReg.opts.inject().store;
const t = (k) => k;

function renderSettings(useStore) {
  effectQueue.length = 0;
  const tree = settingsReg.comp({ store: useStore || store, t });
  const effects = effectQueue.slice();
  effectQueue.length = 0;
  return { tree, effects };
}
function runEffects(effects) { effects.forEach((fn) => { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } }); }
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function texts(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  (node.children || []).forEach((c) => {
    if (typeof c === 'string') out.push(c);
    else texts(c, out);
  });
  return out;
}
function buttonsWith(tree, label) {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button' && node.props && typeof node.props.onClick === 'function' && texts(node).indexOf(label) >= 0) out.push(node);
    (node.children || []).forEach(walk);
  })(tree);
  return out;
}

{
  // ④ 挂载探测：只问本地版本（network:false），拿到就显示「当前版本」
  handler = function (endpoint, payload) {
    if (endpoint === 'cc_checkUpdate' && payload.args.network === false) {
      return { ok: true, value: { package: pkg.name, current: '9.9.9', latest: null, updateAvailable: false, localNewer: false,
        installSpec: pkg.name + '@9.9.9', registry: host.NPM_LATEST_URL, checkedAt: null, source: 'local' } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected' } };
  };
  const { tree, effects } = renderSettings();
  runEffects(effects);
  await flush();
  const probe = callsOf('cc_checkUpdate');
  check('设置页挂载时探测一次、且带 network:false（不打网络）',
    probe.length === 1 && probe[0].payload.args.network === false, JSON.stringify(probe.map((c) => c.payload.args)));
  check('探测结果写进 store.update（status=done / current）',
    store.getSnapshot().update && store.getSnapshot().update.status === 'done' && store.getSnapshot().update.current === '9.9.9',
    JSON.stringify(store.getSnapshot().update));
  check('探测后渲染出「当前版本」文案键', texts(renderSettings().tree).indexOf('settings.update.current') >= 0, texts(renderSettings().tree).join(' | ').slice(0, 160));
}

{
  // ⑤ 点「检查更新」：可更新 → 版本号 + 可复制 spec
  handler = function (endpoint) {
    if (endpoint === 'cc_checkUpdate') {
      return { ok: true, value: { package: pkg.name, current: '9.9.9', latest: '9.9.10', updateAvailable: true, localNewer: false,
        installSpec: pkg.name + '@9.9.10', registry: host.NPM_LATEST_URL, checkedAt: 1700000000, source: 'registry' } };
    }
    return { ok: false, error: { code: 'internal', message: 'unexpected' } };
  };
  const before = renderSettings();
  const btn = buttonsWith(before.tree, 'settings.update.recheck')[0];
  check('设置页里有「重新检查」按钮（探测后文案）', !!btn, texts(before.tree).join(' | ').slice(0, 160));
  if (btn) btn.props.onClick();
  await flush();
  const st = store.getSnapshot().update;
  check('点按钮 → 发一次不带 network:false 的检查请求',
    callsOf('cc_checkUpdate').slice(-1)[0].payload.args.network === undefined, JSON.stringify(callsOf('cc_checkUpdate').slice(-1)[0].payload.args));
  check('可更新状态进 store', st.status === 'done' && st.updateAvailable === true && st.latest === '9.9.10', JSON.stringify(st));
  const after = renderSettings().tree;
  check('渲染出「发现新版本」与可复制的 spec', texts(after).indexOf('settings.update.available') >= 0 && texts(after).indexOf(pkg.name + '@9.9.10') >= 0,
    texts(after).join(' | ').slice(0, 200));
  check('渲染出复制按钮与更新命令提示',
    buttonsWith(after, 'settings.update.copy').length === 1 && texts(after).indexOf('settings.update.commandHint') >= 0,
    texts(after).join(' | ').slice(0, 200));
}

{
  // ⑥ 复制：优先 clipboard API
  clipboardWrites = [];
  const tree = renderSettings().tree;
  const copyBtn = buttonsWith(tree, 'settings.update.copy')[0];
  if (copyBtn) copyBtn.props.onClick();
  await flush();
  check('复制按钮写剪贴板的内容正是 包名@版本', clipboardWrites.length === 1 && clipboardWrites[0] === pkg.name + '@9.9.10',
    JSON.stringify(clipboardWrites));
  check('复制后 store.update.copied=ok，按钮文案变「已复制」',
    store.getSnapshot().update.copied === 'ok' && texts(renderSettings().tree).indexOf('settings.update.copied') >= 0,
    JSON.stringify(store.getSnapshot().update.copied));
  // 2s 后复位
  const reset = timeouts[timeouts.length - 1];
  if (reset) reset.fn();
  await flush();
  check('2s 后复制状态复位（按钮变回「复制」）',
    store.getSnapshot().update.copied === null && texts(renderSettings().tree).indexOf('settings.update.copy') >= 0,
    JSON.stringify(store.getSnapshot().update.copied));
}

{
  // ⑦ 复制失败：clipboard 不可用 → 退回 textarea + execCommand；再失败给「复制失败」提示
  const navDescNow = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let execResult = true;
  let execText = null;
  const removed = [];
  globalThis.document = {
    body: { appendChild() {}, removeChild(n) { removed.push(n); } },
    createElement() { return { style: {}, value: '', setAttribute() {}, select() {} }; },
    execCommand(cmd) { execText = cmd; return execResult; },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {} });
  try {
    const tree = renderSettings().tree;
    const copyBtn = buttonsWith(tree, 'settings.update.copy')[0];
    if (copyBtn) copyBtn.props.onClick();
    await flush();
    check('clipboard 不可用 → 退回 execCommand("copy")，且清理临时 textarea',
      execText === 'copy' && removed.length === 1, `cmd=${execText} removed=${removed.length}`);
    check('execCommand 成功 → copied=ok', store.getSnapshot().update.copied === 'ok', JSON.stringify(store.getSnapshot().update.copied));

    execResult = false;
    store.markUpdateCopied(null);
    const tree2 = renderSettings().tree;
    const copyBtn2 = buttonsWith(tree2, 'settings.update.copy')[0];
    if (copyBtn2) copyBtn2.props.onClick();
    await flush();
    check('两种复制手段都失败 → copied=failed 且渲染「复制失败」提示',
      store.getSnapshot().update.copied === 'failed' && texts(renderSettings().tree).indexOf('settings.update.copyFailed') >= 0,
      JSON.stringify(store.getSnapshot().update.copied));
  } finally {
    Object.defineProperty(globalThis, 'navigator', navDescNow);
    delete globalThis.document;
  }
}

{
  // ⑧ 已是最新 / 本机更新 / 检查失败三种结果各自的文案
  handler = function () {
    return { ok: true, value: { package: pkg.name, current: pkg.version, latest: pkg.version, updateAvailable: false, localNewer: false,
      installSpec: pkg.name + '@' + pkg.version, registry: host.NPM_LATEST_URL, checkedAt: 1, source: 'registry' } };
  };
  await store.checkUpdate();
  await flush();
  check('同版本 → 渲染「已是最新版本」', texts(renderSettings().tree).indexOf('settings.update.upToDate') >= 0,
    texts(renderSettings().tree).join(' | ').slice(0, 160));

  handler = function () {
    return { ok: true, value: { package: pkg.name, current: '9.9.9', latest: '9.9.8', updateAvailable: false, localNewer: true,
      installSpec: pkg.name + '@9.9.8', registry: host.NPM_LATEST_URL, checkedAt: 1, source: 'registry' } };
  };
  await store.checkUpdate();
  await flush();
  check('本机更新 → 渲染 dev 版本提示', texts(renderSettings().tree).indexOf('settings.update.localNewer') >= 0,
    texts(renderSettings().tree).join(' | ').slice(0, 160));

  handler = function () {
    return { ok: false, error: { code: 'internal', message: 'boom', details: { code: 'check-update-failed', current: '9.9.9' } } };
  };
  await store.checkUpdate();
  await flush();
  const st = store.getSnapshot().update;
  check('检查失败 → status=error、保留 current（界面仍能显示当前版本）',
    st.status === 'error' && st.error === 'boom' && st.current === '9.9.9', JSON.stringify(st));
  check('检查失败 → 渲染出失败文案', texts(renderSettings().tree).indexOf('settings.update.error') >= 0,
    texts(renderSettings().tree).join(' | ').slice(0, 160));
}

{
  // ⑨ 老宿主（没有 cc_checkUpdate 端点）：探测失败必须静默，设置页不报错
  await mod.apply(clientCtx);                       // 换一个全新 store（update 回到 null）
  const freshStore = registered['settings.section'].opts.inject().store;
  handler = function () { return { ok: false, error: { code: 'internal', message: 'unknown endpoint', details: { code: 'unknown-endpoint' } } }; };
  const { tree, effects } = renderSettings(freshStore);
  runEffects(effects);
  await flush();
  check('老宿主上探测失败 → store.update 保持 null（不显示错误）', freshStore.getSnapshot().update === null,
    JSON.stringify(freshStore.getSnapshot().update));
  check('老宿主上设置页仍能正常渲染（有检查按钮）', buttonsWith(tree, 'settings.update.check').length === 1,
    texts(tree).join(' | ').slice(0, 160));
}

// ————————————————— 收尾 —————————————————
globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearTimeout = realClearTimeout;
globalThis.clearInterval = realClearInterval;
delete globalThis.window;
delete globalThis.localStorage;
if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.env.DSH_HOME = originalDshHome;
try { rmSync(sandboxHome, { recursive: true, force: true }); } catch {}
try { rmSync(sandboxDsh, { recursive: true, force: true }); } catch {}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 200)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
