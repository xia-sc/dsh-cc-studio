/**
 * L2：把「目标 dsh 版本组合出这份 CC 预设」的结果固化成 fixture（ROADMAP 4.1 L2）。
 *
 * 为什么需要它：`tests/preset-install.test.mjs` 只读静态文件，能抓「行集漏抄」，但抓不到
 * 「这行在目标 dsh 上能不能被解析」—— 包名写错的后果是**整份预设 broken**（roster 里
 * 看得到「CC 模式」但带诊断、组不出会话），而那只会在用户装包后才暴露。本脚本真的跑一次
 * `dsh <profile> --dump-config`，证明这份 patch 在目标版本上组合成功，并把结果存成
 * `tests/fixtures/preset-composition.json`；`tests/preset-composition.test.mjs` 离线比对它。
 *
 * 用法（仓库根）：
 *   node scripts/dump-config.mjs                 # 探测本机 dsh，重建 fixture
 *   node scripts/dump-config.mjs --if-installed  # 没装 dsh 就跳过（CI 用）
 *   node scripts/dump-config.mjs --out <path>    # 写别处（临时实例默认建在 .compat-tmp/）
 *   node scripts/dump-config.mjs --keep          # 保留临时实例目录，便于排错
 *
 * 不写真实用户目录：临时 DSH_HOME 由 `scripts/lib/dsh.mjs` 的 `prepareInstance()` 建在
 * `.compat-tmp/l2-gen/`（已 gitignore），结束即删（`--keep` 除外）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, findDsh, prepareInstance, runDshSync } from './lib/dsh.mjs';

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'preset-composition.json');
const args = process.argv.slice(2);
const ifInstalled = args.includes('--if-installed');
const keep = args.includes('--keep');
const outAt = args.indexOf('--out');
const FIXTURE_OUT = outAt >= 0 && args[outAt + 1] ? args[outAt + 1] : FIXTURE;

function log(msg) { console.log(`[dump-config] ${msg}`); }
function fail(msg, code = 1) { console.error(`[dump-config] ${msg}`); process.exit(code); }

const dsh = findDsh();
if (!dsh) {
  if (ifInstalled) {
    log('没找到本机 dsh 安装（可用 DSH_EXE / DSH_BIN 指定），按 --if-installed 跳过');
    process.exit(0);
  }
  fail('没找到本机 dsh 安装：设置 DSH_EXE / DSH_BIN，或加 --if-installed');
}
log(`dsh: ${dsh.exe}`);

const instance = prepareInstance({ name: 'l2' });
try {
  const dumpRun = runDshSync(dsh, [instance.profile, '--dump-config'], { env: instance.env, logFile: join(instance.work, 'dump.yml') });
  if (dumpRun.status !== 0) {
    console.error(dumpRun.text.split('\n').slice(-20).join('\n'));
    fail(`--dump-config 失败（exit=${dumpRun.status}${dumpRun.error ? `, ${dumpRun.error.code}` : ''}）`);
  }
  const dump = dumpRun.text;
  log(`dump 成功（${dump.split('\n').length} 行）`);

  // 版本单独问一次（dump 是 YAML，没有 JSON 版本字段）。
  const verRun = runDshSync(dsh, ['--version'], { env: instance.env, logFile: join(instance.work, 'version.txt') });
  const DSH_VERSION = verRun.status === 0
    ? verRun.text.trim().split(/\r?\n/).pop()
    : 'unknown';
  if (!/^\d+\.\d+\.\d+/.test(DSH_VERSION)) log(`警告：拿不到 dsh 版本（${JSON.stringify(DSH_VERSION)}），fixture 会写 unknown`);

  // —— 解析：插件贡献段 + preset-cc 下的 plugins 行集 ——
  const lines = dump.split(/\r?\n/);
  const sectionAt = lines.findIndex((l) => l.trim() === '# == @xia-sc/dsh-cc-studio');
  if (sectionAt < 0) fail('dump 里找不到 `# == @xia-sc/dsh-cc-studio` 段（插件没被组合进来？）');
  const section = lines.slice(sectionAt);

  /** 在第 index 行取 `- id:` + 紧随其后的 `name:`；返回 {indent,id,name} 或 null。 */
  function rowAt(index) {
    const line = section[index] ?? '';
    const idLine = line.match(/^(\s*)- id:\s*(\S+)\s*$/);
    if (!idLine) return null;
    const indent = idLine[1].length;
    const id = idLine[2];
    for (let k = 1; k < 4; k++) {
      const next = section[index + k] ?? '';
      const nameLine = next.match(/^\s*name:\s*'?([^'\r\n]+?)'?\s*$/);
      if (nameLine) return { indent, id, name: nameLine[1].trim() };
      if (next.trim() === '' || next.search(/\S/) < indent) break;
    }
    return { indent, id, name: null };
  }

  const rows = [];
  for (let i = 0; i < section.length; i++) {
    const row = rowAt(i);
    if (row) rows.push(row);
  }
  const topRows = rows.filter((row) => row.indent === 0);
  if (!topRows.some((row) => row.id === 'preset-cc')) fail('dump 的插件段里没有 preset-cc 行');

  // preset-cc.config.plugins 的**直接**子项：缩进 6；组内行更深（8+）。
  const presetRows = rows.filter((row) => row.indent === 6);
  if (presetRows.length === 0) fail('preset-cc.config.plugins 解析出 0 行');
  const nestedRows = rows.filter((row) => row.indent > 6);

  // preset-cc 自己的 config 摘要（id=cc 是宿主与前端精确比较的硬契约）
  const presetAt = section.findIndex((l) => /^- id: preset-cc\s*$/.test(l));
  const presetConfig = { id: null, name: null };
  for (let i = presetAt + 1; i < Math.min(presetAt + 12, section.length); i++) {
    const idLine = section[i].match(/^\s{4}id:\s*(\S+)\s*$/);
    if (idLine && presetConfig.id === null) presetConfig.id = idLine[1];
    const nameLine = section[i].match(/^\s{4}name:\s*(.+?)\s*$/);
    if (nameLine && presetConfig.name === null) presetConfig.name = nameLine[1];
  }

  const fixture = {
    generatedAt: new Date().toISOString().slice(0, 10),
    dshVersion: DSH_VERSION,
    source: 'dsh <profile> --dump-config（隔离 DSH_HOME，bundles = dsh-base + dsh-web-app + @xia-sc/dsh-cc-studio）',
    topRows: topRows.map(({ id, name }) => ({ id, name })),
    presetRows: presetRows.map(({ id, name }) => ({ id, name })),
    nestedRows: nestedRows.map(({ id, name, indent }) => ({ id, name, indent })),
    presetConfig,
  };
  mkdirSync(dirname(FIXTURE_OUT), { recursive: true });
  writeFileSync(FIXTURE_OUT, JSON.stringify(fixture, null, 2) + '\n');
  log(`fixture 已写：${FIXTURE_OUT}（dsh ${DSH_VERSION}，顶层 ${presetRows.length} 行 + 组内 ${nestedRows.length} 行）`);
} finally {
  if (keep) log(`临时实例保留在 ${instance.work}`);
  else instance.cleanup();
}
