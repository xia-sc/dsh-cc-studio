/**
 * L2：预设组合快照回归（ROADMAP 4.1 L2）。
 *
 * `tests/preset-install.test.mjs` 只读静态文件，能抓「行集漏抄」，但抓不到「这行在目标 dsh
 * 上能不能被解析」—— 包名写错的后果是整份预设 `broken`（roster 里看得到「CC 模式」但带诊断、
 * 组不出会话），而那要等用户装包后才发现。
 *
 * 本测试读 `tests/fixtures/preset-composition.json`：它是真的跑一次
 * `dsh <profile> --dump-config`（隔离 DSH_HOME，bundles 只含 dsh-base + dsh-web-app + 本插件）
 * 后从 dump 里解析出的 preset-cc 行集。断言三件事：
 *   ① 快照对应的 dsh 版本是 `package.json` 里声明 compatible 的版本；
 *   ② dump 解析出的行集 / 包名与 `presets/cc.patch.yml` 逐行一致（源文件改了必须重跑脚本）；
 *   ③ preset-cc 的声明形态没漂（id=cc、name=CC 模式、cc-agent 指向本插件的 /agent 入口）。
 *
 * 重生成：`node scripts/dump-config.mjs`（要本机装了 dsh；CI 用 `--if-installed` 跳过）。
 *
 * 运行：node tests/preset-composition.test.mjs   （全绿退出码 0）
 */
import { existsSync } from 'node:fs';
import { check, finish, readRepo } from './harness.mjs';

const FIXTURE_REL = 'tests/fixtures/preset-composition.json';

if (!existsSync(new URL('../' + FIXTURE_REL, import.meta.url))) {
  console.error(`缺 ${FIXTURE_REL}：先跑 node scripts/dump-config.mjs 生成（需要本机 dsh）`);
  process.exit(1);
}

const fixture = JSON.parse(readRepo(FIXTURE_REL));
const pkg = JSON.parse(readRepo('package.json'));

// —— 解析 patches/cc.patch.yml 的行集（只取 plugins 段）——
const patch = readRepo('presets/cc.patch.yml').split('\n');
const pluginsAt = patch.findIndex((l) => /^\s*plugins:\s*$/.test(l));
check('presets/cc.patch.yml 有 plugins 段', pluginsAt >= 0, `pluginsAt=${pluginsAt}`);

const patchRows = [];
for (let i = pluginsAt + 1; i < patch.length; i++) {
  const m = patch[i].match(/^(\s*)- id:\s*(\S+)\s*$/);
  if (!m) continue;
  const indent = m[1].length;
  let name = null;
  for (let k = 1; k < 4; k++) {
    const next = patch[i + k] ?? '';
    const n = next.match(/^\s*name:\s*'?([^'\r\n]+?)'?\s*$/);
    if (n) { name = n[1].trim(); break; }
    if (next.trim() === '' || next.search(/\S/) < indent) break;
  }
  patchRows.push({ id: m[2], name, indent });
}
// plugins 段的直接子项 = 该段里最浅的缩进（组内行更深）
const minIndent = Math.min(...patchRows.map((r) => r.indent));
const patchTop = patchRows.filter((r) => r.indent === minIndent);
const patchNested = patchRows.filter((r) => r.indent > minIndent);

// —— ① 快照版本必须是声明过 compatible 的版本 ——
check('fixture 记录了完整 SemVer 的 dsh 版本', /^\d+\.\d+\.\d+/.test(String(fixture.dshVersion)), fixture.dshVersion);
const releases = (pkg.dsh && pkg.dsh.compatibility && pkg.dsh.compatibility.dshReleases) || {};
check('快照对应的 dsh 版本在 dshReleases 里且为 compatible',
  releases[fixture.dshVersion] === 'compatible', `${fixture.dshVersion} → ${releases[fixture.dshVersion]}`);

// —— ② dump 行集 / 包名与源文件一致 ——
const sameIds = (a, b) => a.length === b.length && a.every((row, i) => row.id === b[i].id);
check(`顶层行集与源文件一致（${patchTop.length} 行）`,
  sameIds(fixture.presetRows, patchTop),
  `fixture=[${fixture.presetRows.map((r) => r.id).join(',')}] patch=[${patchTop.map((r) => r.id).join(',')}]`);
check(`组内行集与源文件一致（${patchNested.length} 行）`,
  sameIds(fixture.nestedRows, patchNested),
  `fixture=[${fixture.nestedRows.map((r) => r.id).join(',')}] patch=[${patchNested.map((r) => r.id).join(',')}]`);

const merged = [...fixture.presetRows, ...fixture.nestedRows];
const byId = new Map([...patchTop, ...patchNested].map((row) => [row.id, row]));
const nameMismatch = merged.filter((row) => byId.get(row.id) && row.name !== byId.get(row.id).name);
check('每行的包名与源文件逐字一致（改一个包名必须重生成快照）',
  nameMismatch.length === 0,
  nameMismatch.map((r) => `${r.id}: ${r.name} vs ${byId.get(r.id)?.name}`).join(' | '));
check('每条 dump 行都解析出了包名（null = 该行在目标 dsh 上组合不出来）',
  merged.every((r) => typeof r.name === 'string' && (r.name.includes('/') || r.name.startsWith('cordis:'))),
  merged.filter((r) => !r.name || !(r.name.includes('/') || r.name.startsWith('cordis:'))).map((r) => r.id).join(',') || 'ok');

// —— ③ preset-cc 的声明形态 ——
check('dump 里有 preset-cc 行，name 指向 dsh-agent-preset',
  fixture.topRows.some((r) => r.id === 'preset-cc' && r.name === '@deepseek-ai/dsh-agent-preset'),
  JSON.stringify(fixture.topRows));
check('cc-agent 行指向本插件的 /agent 入口',
  merged.some((r) => r.id === 'cc-agent' && r.name === '@xia-sc/dsh-cc-studio/agent'),
  merged.filter((r) => r.id === 'cc-agent').map((r) => r.name).join(',') || 'missing');
check('有意的两行差异不在组合结果里（tool-schedule / tool-plugin-market）',
  !merged.some((r) => r.id === 'tool-schedule' || r.id === 'tool-plugin-market'),
  merged.filter((r) => r.id === 'tool-schedule' || r.id === 'tool-plugin-market').map((r) => r.id).join(','));

// —— ④ 预设声明字段（dump 里解析出的 config 摘要）——
check('fixture 记录了预设显示名与 id（id 是宿主/前端精确比较的硬契约）',
  fixture.presetConfig && fixture.presetConfig.id === 'cc' && fixture.presetConfig.name === 'CC 模式',
  JSON.stringify(fixture.presetConfig || null));

finish();
