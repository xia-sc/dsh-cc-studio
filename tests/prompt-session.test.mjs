/**
 * 「让模型修」宿主端点回归测试（0.24.0）。
 *
 * 背景：工坊的「去修」只是把用户送到对应章节，用户并不知道时间锚定 / canon / 台账的标准，
 *   最后还是得让模型去改。新增 `cc_promptSession`：把拼好的提示词当**用户消息**发进当前会话，
 *   走宿主的 `sessionController.prompt`（与用户在输入框打字等价），由 CC 模式的模型自己调工具。
 *
 * 本文件用假 cordis ctx + 真实 node:http 服务锁住端点契约：
 *   透传字段、空内容拦截、缺服务时的明确错误码、下游 RemoteError 的透出、长度上限。
 *
 * 运行：node tests/prompt-session.test.mjs   （全绿退出码 0）
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-prompt-test-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.DSH_HOME = sandboxHome;

const host = await import('../lib/index.js');

import { check, finish } from './harness.mjs';

let route = null;
const promptCalls = [];
// scMode: "ok" | "missing" | "throw"
let scMode = 'ok';
const fakeCtx = {
  effect(fn) { fn(); return () => {}; },
  get(name) {
    if (name === 'connection') return { requestRejection: () => undefined };
    if (name === 'sessionController') {
      if (scMode === 'missing') return undefined;
      return {
        async prompt(req, signal) {
          promptCalls.push({ req, signal });
          if (scMode === 'throw') {
            const e = new Error('session "s-gone" not found');
            e.code = 'session/not-found';
            throw e;
          }
          return { accepted: true };
        },
      };
    }
    return undefined;
  },
  webServer: {
    register(r) {
      route = r;
      return () => { route = null; };
    },
  },
};

const server = createServer((req, res) => {
  if (route && (req.url === route.path || req.url.startsWith(route.path + '/'))) {
    route.handler(req, res);
    return;
  }
  res.statusCode = 404;
  res.end('no route');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

await host.apply(fakeCtx);
await new Promise((r) => setTimeout(r, 50));

async function call(endpoint, args) {
  const res = await fetch(base + '/dsh-cc-studio-rpc/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rid-' + endpoint, method: endpoint, payload: { args } }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// ① 正常路径：透传给 sessionController.prompt
{
  promptCalls.length = 0;
  const r = await call('cc_promptSession', { sessionId: 's-1', text: '  【工坊·定点修改】只改这一处  ' });
  const value = r.json && r.json.result && r.json.result.value;
  check('① 发送成功返回 accepted=true', r.status === 200 && !!value && value.accepted === true, JSON.stringify(r.json && r.json.result));
  check('①b 只调用一次 sessionController.prompt', promptCalls.length === 1, 'calls=' + promptCalls.length);
  const call0 = promptCalls[0] || {};
  const req = call0.req || {};
  check('② 透传 sessionId 与 content:[{type:"text",text}]，文本已 trim',
    req.sessionId === 's-1' && Array.isArray(req.content) && req.content.length === 1
      && req.content[0].type === 'text' && req.content[0].text === '【工坊·定点修改】只改这一处',
    JSON.stringify(req.content));
  check('②b 每次调用带唯一 requestId（prompt 的重试身份，不许重复）',
    typeof req.requestId === 'string' && req.requestId.indexOf('cc-studio-') === 0 && req.requestId.length > 12,
    String(req.requestId));
  check('②c 传了 AbortSignal（下游取消通道）', !!call0.signal && typeof call0.signal.aborted === 'boolean', typeof call0.signal);
}

// ③ 空文本 / 纯空白：拦在客户端契约层，一次都不调用下游
{
  promptCalls.length = 0;
  const r1 = await call('cc_promptSession', { sessionId: 's-1', text: '   ' });
  const r2 = await call('cc_promptSession', { sessionId: 's-1' });
  const code = (j) => j && j.json && j.json.result && j.json.result.error && j.json.result.error.details && j.json.result.error.details.code;
  check('③ 空文本 → empty-prompt，且下游一次都没被调用',
    code(r1) === 'empty-prompt' && code(r2) === 'empty-prompt' && promptCalls.length === 0,
    code(r1) + '/' + code(r2) + ' calls=' + promptCalls.length);
}

// ④ 缺 sessionId
{
  promptCalls.length = 0;
  const r = await call('cc_promptSession', { text: '改一下' });
  check('④ 缺 sessionId → no-session', r.json && r.json.result.error.details.code === 'no-session' && promptCalls.length === 0,
    JSON.stringify(r.json && r.json.result.error));
}

// ⑤ 部署里没有 sessionController：明确报错，不假装成功
{
  scMode = 'missing';
  const r = await call('cc_promptSession', { sessionId: 's-1', text: '改一下' });
  check('⑤ 没有 sessionController → no-session-controller（不静默成功）',
    r.json && r.json.result.error.details.code === 'no-session-controller',
    JSON.stringify(r.json && r.json.result.error));
  scMode = 'ok';
}

// ⑥ 下游 RemoteError：透出 prompt-failed + 原 code
{
  scMode = 'throw';
  const r = await call('cc_promptSession', { sessionId: 's-gone', text: '改一下' });
  const details = r.json && r.json.result.error && r.json.result.error.details;
  check('⑥ 下游抛 session/not-found → prompt-failed，原 code 落在 remoteCode',
    !!details && details.code === 'prompt-failed' && details.remoteCode === 'session/not-found',
    JSON.stringify(details));
  scMode = 'ok';
}

// ⑦ 长度上限
{
  promptCalls.length = 0;
  const r = await call('cc_promptSession', { sessionId: 's-1', text: 'x'.repeat(4001) });
  check('⑦ 超过 4000 字 → prompt-too-long', r.json && r.json.result.error.details.code === 'prompt-too-long' && promptCalls.length === 0,
    JSON.stringify(r.json && r.json.result.error));
}

await new Promise((resolve) => server.close(resolve));
rmSync(sandboxHome, { recursive: true, force: true });
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.env.DSH_HOME = originalDshHome;

finish();
