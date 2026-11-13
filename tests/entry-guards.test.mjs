/**
 * 入口 / 清单守卫（ROADMAP 4.1 L1）。
 *
 * 解决的问题：`npm test` 之前**没有**一条测试保证「三个入口能被真正加载」——
 * 语法错、导出改名、`exports` 漏一项、bundle id 与包名对不上，都只会在用户装包后才暴露
 * （其中 bundle id 对不上 = 整个客户端半加载失败，宿主按包名精确匹配）。
 *
 * 为什么不用 `node --check`：那要起子进程，禁子进程的沙箱 / 受限 CI 里直接 EPERM ——
 * 这正是 4.1 要消除的那类失败。这里是等价检查：
 * - 宿主半 / 预设半是 ESM，`await import()` 就是解析 + 求值；
 * - 客户端半是 `window.__ModuleLoader__` 外壳，用 harness 的 `loadClient()` 整段执行。
 *
 * 运行：node tests/entry-guards.test.mjs   （全绿退出码 0）
 */
import { existsSync } from 'node:fs';
import { check, finish, loadClient, readRepo } from './harness.mjs';

const pkg = JSON.parse(readRepo('package.json'));

// —— ① 三个入口都能加载 ——
const host = await import('../lib/index.js');
check('lib/index.js 可加载，导出 apply + inject',
  typeof host.apply === 'function' && Array.isArray(host.inject), typeof host.apply);

const agent = await import('../lib/agent.js');
check('lib/agent.js 可加载，导出 apply', typeof agent.apply === 'function', typeof agent.apply);

const { registration } = loadClient();
check('lib/client.js 整段可执行，并调用 __ModuleLoader__.load',
  !!registration && typeof registration.factory === 'function', registration && registration.id);

// —— ② bundle id 必须等于包名（AGENTS §1：对不上整个客户端半加载失败）——
// draft-slot-sync 里硬编码了包名；这里以 package.json 为真源，改包名时两边一起红。
check('客户端 bundle id === package.json.name', registration.id === pkg.name,
  `${registration.id} vs ${pkg.name}`);

// —— ③ exports 三入口存在且指向真实文件（AGENTS §1：漏一处 = 发布后加载失败）——
const exportsMap = pkg.exports || {};
for (const [sub, rel] of [['.', './lib/index.js'], ['./client', './lib/client.js'], ['./agent', './lib/agent.js']]) {
  check(`exports["${sub}"] → ${rel}`, exportsMap[sub] === rel, String(exportsMap[sub]));
}

// —— ④ dsh.bundle.patch 的两层补丁文件都在（漏一层 = 宿主组合不完整）——
const patch = (pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) || [];
const patchPaths = patch.map((p) => p.replace(/^\.\//, ''));
check('dsh.bundle.patch 恰好两层且文件都存在',
  patch.length === 2 && patchPaths.every((p) => existsSync(new URL('../' + p, import.meta.url))),
  patch.join(', '));

finish();
