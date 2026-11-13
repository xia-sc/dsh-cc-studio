/**
 * L3：真机 smoke（ROADMAP 4.1 L3）—— 起一个真实 dsh web 实例，走一遍「页面 / RPC / 写草稿 / 导出」。
 *
 * 为什么单独一个脚本、不进 `npm test`：它依赖本机装了 dsh（桌面版）、会占端口、会起 Electron 进程；
 * CI 上没有这些条件。L1/L2 已经覆盖「纯函数 + 组合快照」，这一层补的是**唯一**能验证
 * 「slot 真挂上、客户端资源真能加载、RPC 端点真能在宿主里跑」的东西。
 *
 * 用法（仓库根）：
 *   node scripts/e2e-smoke.mjs                 # 探测本机 dsh，跑一遍
 *   node scripts/e2e-smoke.mjs --if-installed  # 没装 dsh 就跳过（CI 用）
 *   node scripts/e2e-smoke.mjs --keep          # 保留实例与日志
 *
 * 断言顺序：起实例 → 日志里拿 token URL → 换会话 cookie → 首页 200 且带 boot 清单
 * → RPC `ping` / `cc_isCcMode` / `cc_listTargets` → `cc_setDraft` 写一张最小卡
 * → `cc_exportJson` 拿回卡并核对 spec / name / 时间锚定字段。
 *
 * 不写真实用户目录：实例由 `scripts/lib/dsh.mjs` 的 `prepareInstance()` 建在 `.compat-tmp/`，
 * 结束 kill + 清理（`--keep` 除外）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDsh, freePort, prepareInstance } from './lib/dsh.mjs';

const args = process.argv.slice(2);
const ifInstalled = args.includes('--if-installed');
const keep = args.includes('--keep');

let failures = 0;
function pass(msg) { console.log(`PASS  ${msg}`); }
function check(msg, cond, detail = '') {
  if (cond) { pass(msg); return; }
  failures += 1;
  console.log(`FAIL  ${msg}${detail === '' ? '' : `  — ${String(detail).slice(0, 300)}`}`);
}
function log(msg) { console.log(`[e2e] ${msg}`); }
/** 实例还没建起来时用：直接退出。 */
function bail(msg) { console.error(`[e2e] FAIL ${msg}`); process.exit(1); }
/** 实例起来之后用：抛错交给 finally 清理（process.exit 会跳过 finally，会漏杀进程/漏删目录）。 */
function fail(msg) { throw new Error(msg); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dsh = findDsh();
if (!dsh) {
  if (ifInstalled) {
    log('没找到本机 dsh 安装（可用 DSH_EXE / DSH_BIN 指定），按 --if-installed 跳过');
    process.exit(0);
  }
  bail('没找到本机 dsh 安装：设置 DSH_EXE / DSH_BIN，或加 --if-installed');
}
log(`dsh: ${dsh.exe}`);

const instance = prepareInstance({ name: 'e2e' });
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const logFile = join(instance.work, 'web.log');
const logFd = openSync(logFile, 'w');
log(`实例：${instance.work}（port ${port}）`);

let child = null;
function stopChild() {
  if (!child) return;
  const pid = child.pid;
  try {
    if (process.platform === 'win32') {
      // Electron 主进程会再 spawn 子进程：/T 杀整棵树；失败只报告，不误伤用户自己开着的 GUI。
      const killed = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      if (killed.status !== 0) log(`taskkill 返回 ${killed.status}（进程可能已退出）`);
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    log(`停止实例失败：${e && e.message}`);
  }
  child = null;
}

try {
  child = spawn(dsh.exe, [dsh.bin, '--profile', instance.profile, '--no-open', '--port', String(port)], {
    env: instance.env,
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);

  // —— 等启动：日志里出现带 token 的 URL（或用时 90s 超时）——
  let tokenUrl = '';
  for (let i = 0; i < 180; i += 1) {
    await sleep(500);
    const text = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    const m = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=([A-Za-z0-9._~-]+)/);
    if (m) { tokenUrl = m[0]; break; }
    if (child.exitCode !== null) break;
  }
  if (!tokenUrl) {
    console.error((existsSync(logFile) ? readFileSync(logFile, 'utf8') : '').split('\n').slice(-30).join('\n'));
    fail('没等到 web 启动（日志里没有带 token 的 URL）');
  }
  log(`启动成功：${base}`);
  check('web 实例启动并打印了 token URL', tokenUrl.includes(`:${port}/?token=`), tokenUrl.replace(/token=.*/, 'token=***'));

  // —— 换会话 cookie ——
  const tokenRes = await fetch(tokenUrl, { redirect: 'manual' });
  const setCookies = typeof tokenRes.headers.getSetCookie === 'function'
    ? tokenRes.headers.getSetCookie()
    : [tokenRes.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  check('token URL 换到了会话 cookie', cookie.length > 0 && tokenRes.status < 400, `status=${tokenRes.status} cookie=${cookie.slice(0, 40)}`);

  // —— 首页：200 + boot 清单里有本插件 ——
  const home = await fetch(base + '/', { headers: { cookie } });
  const html = await home.text();
  check('首页 200', home.status === 200, `status=${home.status}`);
  check('首页带 boot 数据（__DSH_BOOT__）', html.includes('__DSH_BOOT__'), `len=${html.length}`);
  check('boot 清单里有本插件 @xia-sc/dsh-cc-studio', html.includes('@xia-sc/dsh-cc-studio'), '');

  // —— 客户端资源：boot 里的 entry URL 必须真的能取到 ——
  // AGENTS §6：客户端资源 URL 含 `??` 与批次 `rev`，缺一个就 404（`??` 是多模块合并的路径约定）。
  // 这里按 boot 数据原样请求一次，并验证「rev 改掉 → 404」，把这条约定钉死。
  const bootMatch = html.match(/__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  let boot = null;
  try { boot = bootMatch ? JSON.parse(bootMatch[1]) : null; } catch { /* 解析失败按缺数据算 */ }
  check('首页能解析出 __DSH_BOOT__ 的 JSON', !!boot && typeof boot.rev === 'string', boot ? boot.rev : 'unparsable');

  const pluginEntry = boot && Array.isArray(boot.entries)
    ? boot.entries.find((e) => e.id === '@xia-sc/dsh-cc-studio')
    : null;
  check('boot 里本插件有条目且 URL 带批次 rev',
    !!pluginEntry && !!pluginEntry.url && /rev=[0-9a-f]+/.test(pluginEntry.url),
    pluginEntry ? pluginEntry.url : 'missing');

  if (pluginEntry && pluginEntry.url) {
    const bundleRes = await fetch(new URL(pluginEntry.url, base + '/'), { headers: { cookie } });
    const bundleText = await bundleRes.text();
    check('客户端资源 200 且是 JS bundle',
      bundleRes.status === 200
      && /javascript/i.test(bundleRes.headers.get('content-type') || '')
      && bundleText.length > 1000,
      `status=${bundleRes.status} type=${bundleRes.headers.get('content-type')} len=${bundleText.length}`);
    check('取到的是 bundle 外壳（__ModuleLoader__），不是错误页',
      bundleText.includes('__ModuleLoader__'), bundleText.slice(0, 80).replace(/\n/g, ' '));

    // 负向断言：批次 rev 不是可忽略参数，改掉就必须 404。
    const staleUrl = pluginEntry.url.replace(/rev=[0-9a-f]+/, 'rev=000000000000');
    const staleRes = await fetch(new URL(staleUrl, base + '/'), { headers: { cookie } });
    check('rev 不匹配 → 404（批次 rev 是硬契约）', staleRes.status === 404, `status=${staleRes.status}`);

    // 页面主资源（./assets/index-*.js）也要能取到。
    const mainScript = (html.match(/<script[^>]*src="(\.\/assets\/index-[^"]+)"/) || [])[1];
    check('首页能找到主资源脚本', !!mainScript, mainScript || 'missing');
    if (mainScript) {
      const mainRes = await fetch(new URL(mainScript, base + '/'), { headers: { cookie } });
      check('主资源 200', mainRes.status === 200 && (await mainRes.text()).length > 1000, `status=${mainRes.status}`);
    }
  }

  // —— RPC：信封 + 三个只读端点 ——
  let seq = 0;
  async function rpc(method, payloadArgs) {
    const res = await fetch(`${base}/dsh-cc-studio-rpc/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `e2e-${++seq}`, method, payload: { args: payloadArgs || {} } }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON = 线协议坏了 */ }
    return { status: res.status, json, text };
  }

  const ping = await rpc('ping');
  check('RPC ping → 200 + server-response 信封', ping.status === 200 && ping.json && ping.json.type === 'server-response', `status=${ping.status}`);
  check('RPC ping → result.ok', !!ping.json && ping.json.result && ping.json.result.ok === true, JSON.stringify(ping.json && ping.json.result));

  const isCc = await rpc('cc_isCcMode', { sessionId: 'e2e' });
  check('cc_isCcMode → 返回 isCc 布尔（宿主里真能跑）',
    !!isCc.json && isCc.json.result && isCc.json.result.ok === true && typeof isCc.json.result.value.isCc === 'boolean',
    JSON.stringify(isCc.json && isCc.json.result));

  const targets = await rpc('cc_listTargets');
  const targetValue = targets.json && targets.json.result && targets.json.result.ok ? targets.json.result.value : null;
  check('cc_listTargets → 至少一个导出目标 + defaultTarget',
    !!targetValue && Array.isArray(targetValue.targets) && targetValue.targets.length > 0 && !!targetValue.defaultTarget,
    JSON.stringify(targetValue));

  // —— 写一张最小卡（cc_setDraft 只做结构校验）——
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'E2E 冒烟卡',
      description: 'e2e',
      first_mes: '[时间：2026-01-01 08:00]\n开场。',
      system_prompt: '【时间线规则】每段以 [时间：YYYY-MM-DD HH:MM] 开头。',
      post_history_instructions: '生成前自检：先确认上一段时间。',
      group_only_greetings: [],
    },
  };
  const set = await rpc('cc_setDraft', { sessionId: 'e2e', draft: card });
  check('cc_setDraft → 写入成功', !!set.json && set.json.result && set.json.result.ok === true, JSON.stringify(set.json && set.json.result).slice(0, 200));

  // —— 导出：拿回卡并核对字段 ——
  const exported = await rpc('cc_exportJson', { sessionId: 'e2e' });
  const exportValue = exported.json && exported.json.result && exported.json.result.ok ? exported.json.result.value : null;
  let exportedCard = null;
  try { exportedCard = exportValue ? JSON.parse(exportValue.content) : null; } catch { /* 内容坏了 */ }
  check('cc_exportJson → 返回可解析的 JSON 卡', !!exportedCard && exportedCard.spec === 'chara_card_v3', exportedCard ? exportedCard.spec : 'missing');
  check('导出的卡保住了名字与时间锚定',
    !!exportedCard && exportedCard.data.name === 'E2E 冒烟卡'
    && /\[时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(exportedCard.data.first_mes || '')
    && String(exportedCard.data.system_prompt || '').includes('时间线规则'),
    JSON.stringify(exportedCard && { name: exportedCard.data.name, first: String(exportedCard.data.first_mes).slice(0, 30) }));
} catch (e) {
  failures += 1;
  console.error(`FAIL  ${e && e.message ? e.message : e}`);
} finally {
  stopChild();
  // 等进程树退出再删目录（Windows 上句柄没松时 rm 会 EPERM/EBUSY）。
  await sleep(1200);
  if (keep) log(`实例与日志保留在 ${instance.work}（web.log）`);
  else instance.cleanup();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  e2e smoke：${failures} 个失败`);
process.exit(failures === 0 ? 0 : 1);
