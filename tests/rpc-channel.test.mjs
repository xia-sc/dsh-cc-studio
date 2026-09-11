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
import { mkdtempSync, rmSync } from 'node:fs';
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
