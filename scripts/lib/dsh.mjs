/**
 * 脚本共用的「本机 dsh」工具（L2 `scripts/dump-config.mjs` / L3 `scripts/e2e-smoke.mjs`）。
 *
 * 三件事：
 * - `findDsh()`：找桌面版/解包版安装里的 exe 与 CLI 入口（asar 内路径 `existsSync` 看不到，
 *   所以只校验 exe + `resources/app.asar` 存在）。
 * - `prepareInstance()`：建一个**隔离** DSH_HOME + profile（dsh-base + dsh-web-app + 本插件），
 *   不碰真实 `~/.dsh`；结束 `cleanup()`。
 * - `freePort()` / `runDshSync()`：端口与同步调用。子进程的 stdout/stderr 一律接**文件描述符**
 *   （禁子进程的沙箱里管道会 EPERM）。
 */
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 插件仓库根（本文件在 scripts/lib/ 下）。 */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const BIN_REL = ['resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'];

/** 探测本机 dsh 安装；返回 `{ exe, bin }` 或 `null`。`DSH_EXE` / `DSH_BIN` 优先。 */
export function findDsh() {
  const list = [];
  if (process.env.DSH_EXE) list.push({ exe: process.env.DSH_EXE, bin: process.env.DSH_BIN || '' });
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const user = process.env.USERNAME || '';
    const bases = [
      join(local, 'Programs', 'DeepSeek Harness'),
      join(local, 'Programs', 'DeepSeekHarness'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'DeepSeek Harness'),
    ];
    // 安装器可能装在非系统盘（本机就是 D:），按盘符扫一遍按用户安装位置。
    for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
      if (!user) break;
      bases.push(`${drive}:\\Users\\${user}\\AppData\\Local\\Programs\\DeepSeek Harness`);
    }
    for (const base of bases) list.push({ exe: join(base, 'DeepSeek Harness.exe'), bin: join(base, ...BIN_REL) });
  } else if (process.platform === 'darwin') {
    const base = '/Applications/DeepSeek Harness.app/Contents';
    list.push({ exe: join(base, 'MacOS', 'DeepSeek Harness'), bin: join(base, ...BIN_REL) });
  } else {
    for (const base of ['/opt/deepseek-harness', join(homedir(), '.local', 'share', 'deepseek-harness')]) {
      list.push({ exe: join(base, 'DeepSeek Harness'), bin: join(base, ...BIN_REL) });
    }
  }
  return list.find((c) => {
    if (!c.exe || !existsSync(c.exe)) return false;
    if (c.bin && existsSync(c.bin)) return true;
    return existsSync(join(dirname(c.exe), 'resources', 'app.asar'));
  }) || null;
}

/**
 * 建隔离实例：`<root>/.compat-tmp/<name>-gen/` 下放一个临时 DSH_HOME 与 profile，
 * profile 的 bundles = dsh-base + dsh-web-app + 本插件（插件文件复制过去）。
 * 返回 `{ work, home, profileDir, profile, env, cleanup() }`。
 */
export function prepareInstance({ name = 'l2', root = ROOT } = {}) {
  const work = join(root, '.compat-tmp', `${name}-gen`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const home = join(work, 'home');
  const profileDir = join(home, 'profiles', name);
  const dest = join(profileDir, 'node_modules', '@xia-sc', 'dsh-cc-studio');
  mkdirSync(dest, { recursive: true });
  for (const item of ['lib', 'presets']) cpSync(join(root, item), join(dest, item), { recursive: true });
  for (const item of ['cordis.patch.yml', 'package.json', 'icon.svg']) copyFileSync(join(root, item), join(dest, item));
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@xia-sc/dsh-cc-studio'] } },
  }, null, 2) + '\n');
  const env = { ...process.env, DSH_HOME: home, HOME: home, USERPROFILE: home, ELECTRON_RUN_AS_NODE: '1' };
  return {
    work,
    home,
    profileDir,
    profile: name,
    env,
    cleanup() { rmSync(work, { recursive: true, force: true }); },
  };
}

/** 同步跑一次 dsh CLI（stdout+stderr 写同一个文件），返回 `{ status, text }`。 */
export function runDshSync(dsh, args, { env, timeout = 180_000, logFile = '' } = {}) {
  const outFile = logFile || join(process.env.TEMP || '/tmp', `dsh-run-${Date.now()}.log`);
  const fd = openSync(outFile, 'w');
  let result;
  try {
    result = spawnSync(dsh.exe, [dsh.bin, ...args], { env, stdio: ['ignore', fd, fd], timeout });
  } finally {
    closeSync(fd);
  }
  const text = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  return { status: result.status, error: result.error, text, logFile: outFile };
}

/** 拿一个空闲端口（listen 0 后立即关）。 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
