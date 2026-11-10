/**
 * CC 预设 + 上架契约测试（不随插件发布，files 未包含 tests）。
 *
 * 0.12.0 起只有**一种**预设投递形态：随包补丁层 `presets/cc.patch.yml` 的声明行
 * （dsh >= 0.2.0-rc.2 全部走它）。旧的「挂载时把 presets/cc 装进 <DSH_HOME>/.agent-presets/cc」
 * 随 0.2.0 以下兼容一起删除，所以本文件只读静态文件：不启动宿主、不写任何用户目录。
 * 同时把「旧世界不许回流」钉成源码级守卫 —— 有人再把 installCcPreset / .agent-presets
 * 写回来会直接红（见第 8 节）。
 *
 * 运行：node tests/preset-install.test.mjs   （全绿退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const patchText = read('presets/cc.patch.yml');
const pkg = JSON.parse(read('package.json'));

const patchLines = patchText.split('\n');
const pluginsAt = patchLines.findIndex((l) => /^\s*plugins:\s*$/.test(l));
const bodyText = pluginsAt >= 0 ? patchLines.slice(pluginsAt + 1).join('\n') : '';
const rowIds = bodyText.split('\n').filter((l) => /^\s*- id: \S/.test(l)).map((l) => l.trim().replace(/^- id: /, ''));

// 取 `- id: X` 那一个整块（含其后缩进更深的行，遇到同级或更浅的缩进行即结束）
const lines = patchText.split('\n');
const blockOf = (id) => {
  const start = lines.findIndex((l) => new RegExp(`^\\s*- id: ${id}$`).test(l));
  if (start < 0) return '';
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
};

// —— 1) 单载体结构：只有一份 plugins 清单 ——
{
  check('presets/cc.patch.yml 存在且只有一个 plugins 列表',
    pluginsAt > 0 && patchLines.filter((l) => /^\s*plugins:\s*$/.test(l)).length === 1, `pluginsAt=${pluginsAt}`);

  const idRows = bodyText.split('\n').filter((l) => /^\s*- id: \S/.test(l));
  const nameRows = bodyText.split('\n').filter((l) => /^\s*name: \S/.test(l));
  check('每个 - id 行都有 name（漏一个 = 整个预设挂不起来）',
    idRows.length > 0 && idRows.length === nameRows.length, `ids=${idRows.length} names=${nameRows.length}`);

  check("声明行是 preset-cc + '@deepseek-ai/dsh-agent-preset'",
    /- id: preset-cc/.test(patchText) && /name: '@deepseek-ai\/dsh-agent-preset'/.test(patchText), '');
  check('预设 id 恒为 cc（宿主 isCcPreset 与前端 CC_PRESET_ID 都按它精确比较）', /^\s*id: cc$/m.test(patchText), '');
  check('显示名仍是「CC 模式」（DOM 兜底探测按 chip 文本认预设，见 tests/cc-detection.test.mjs）',
    /^\s*name: CC 模式$/m.test(patchText), '');
  check('描述含 CCv3 工坊定位', /^\s*description: .*CCv3 角色卡工坊/m.test(patchText), '');
  check('roster 排序号存在（内置四个是 1..4，CC 排在后面）', /^\s*order: \d+$/m.test(patchText), '');
  check('CC 工具行仍挂在本预设下', /- id: cc-agent\s*\n\s*name: '@xia-sc\/dsh-cc-studio\/agent'/.test(patchText), '');
  check('平台条件行仍是未求值的 !!js（disabled 表达式必须留到子行自己求值）',
    (patchText.match(/disabled: !!js /g) || []).length >= 2, '');
  check('三个 isolate 组都在（planning / compaction / delegation）',
    ['planMode: true', 'compaction: true', 'workflowEngine: true'].every((k) => patchText.includes(k)), '');
}

// —— 2) 行级契约：与 dsh 内置 standard 的同步不许悄悄回退 ——
//
// 这一类漂移是本项目历史上最贵的 bug（0.3.1：`workflow-worker-thread` 下线后仍写在
// 预设里，整份 CC 预设被判 broken、在 roster 里直接消失；0.3.4：`present` 整行漏抄与
// `modelSelectionSettings` 漏抄，两者都不报错，只是静默少能力）。这里钉死的是「行必须
// 存在且名字正确」这类不变量，纯读模板、不依赖本机装了哪个 dsh，所以 CI 上也能跑。
{
  const wf = blockOf('workflow-ptc');
  check('workflow 行仍指向 dsh-workflow-ptc', /name:\s*'@deepseek-ai\/dsh-workflow-ptc'/.test(wf), (wf.split('\n')[1] || 'missing').trim());
  check('没有已下线的 workflow-worker-thread 行（0.3.1 事故回归）', !/name:\s*'@deepseek-ai\/dsh-workflow-worker-thread'/.test(patchText), '');

  const spawn = blockOf('tool-subagent');
  // 0.2.2-rc.1 把 dsh-tool-subagent 的 `modelSelectionSettings` 拆成
  // `modelSelection` + `modelDiscovery`（rc.5 及更早只有旧键）。预设必须两个世代**双写**：
  // 只写旧键在新版上静默少能力，只写新键在老版上同样静默少能力，两种都既不报错也不 broken。
  check('tool-subagent（spawn）新键 modelSelection + modelDiscovery 都在',
    /modelSelection:\s*true/.test(spawn) && /modelDiscovery:\s*true/.test(spawn), (spawn.split('\n')[0] || 'missing').trim());
  check('tool-subagent（spawn）同时保留旧键 modelSelectionSettings（兼容 0.2.0-rc.2 / 0.2.1.x）',
    /modelSelectionSettings:\s*true/.test(spawn), (spawn.split('\n')[0] || 'missing').trim());
  const fork = blockOf('tool-subagent-fork');
  check('tool-subagent-fork 不加任何 modelSelection 键（须与父代理同 provider/model）',
    fork !== '' && !/modelSelection|modelDiscovery/.test(fork), (fork.split('\n')[0] || 'missing').trim());

  const present = blockOf('present');
  check('present 行存在且指向 dsh-tool-present（0.3.4 补回）', /name:\s*'@deepseek-ai\/dsh-tool-present'/.test(present), (present.split('\n')[1] || 'missing').trim());
  const pm = blockOf('tool-plugin-manager');
  check('tool-plugin-manager 行存在且 disabled（与 standard 保持一致）', /disabled:\s*true/.test(pm), (pm.split('\n')[1] || 'missing').trim());
  const cg = blockOf('command-goal');
  check('command-goal 行存在且包名正确（0.3.7 修的自始漏抄）', /name:\s*'@deepseek-ai\/dsh-command-goal'/.test(cg), (cg.split('\n')[1] || 'missing').trim());
  const tc = blockOf('time-context');
  check('time-context 行存在且无 config（0.2.1 起在预设层，0.2.0 的 host 组合没挂它）', /name:\s*'@deepseek-ai\/dsh-time-context'/.test(tc), (tc.split('\n')[1] || 'missing').trim());
}

// —— 3) 行集快照：漏一行 / 多一行都直接红 ——
//
// 行集对齐 dsh 0.2.1 的内置 standard，有意差异只有 tool-schedule / tool-plugin-market
// 两行（下限 0.2.0-rc.2 的依赖里没有这两个包，理由写在预设文件末尾的注释块里）。
// 快照是刻意的：它把 AGENTS.md §4 的「与目标版本内置 standard 逐行对一遍」变成机械可检的，
// 而不是等用户发现少了功能。升级 dsh 后若 standard 增删了行，先确认它是不是 CC 模式该有的
// 能力，再来改这份快照。
{
  const EXPECTED_ROWS = [
    'persona', 'agent-instructions', 'time-context', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
    'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal',
    'planning', 'plan-mode',
    'compaction', 'compaction-basic', 'command-compact', 'tool-result-pruner',
    'delegation', 'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork',
    'workflow-ptc', 'tool-workflow',
    'tool-ask-user', 'tool-todo', 'tool-web', 'present', 'tool-plugin-manager',
    'cc-agent',
  ];
  const missingRows = EXPECTED_ROWS.filter((id) => !rowIds.includes(id));
  const extraRows = rowIds.filter((id) => !EXPECTED_ROWS.includes(id));
  check('行集与内置 standard 对齐（快照：漏抄/多抄一整行都会红）',
    missingRows.length === 0 && extraRows.length === 0,
    missingRows.length || extraRows.length
      ? `缺 [${missingRows.join(', ') || '-'}] 多 [${extraRows.join(', ') || '-'}]`
      : `${rowIds.length} 行`);

  // 有意差异守卫：这两个包在 0.2.0-rc.2 的依赖里不存在，加回来会让整个预设 broken。
  check('刻意不带 tool-schedule（@deepseek-ai/dsh-tool-schedule 0.2.1 才有）',
    !rowIds.includes('tool-schedule'), rowIds.filter((r) => r.includes('schedule')).join(',') || 'ok');
  check('刻意不带 tool-plugin-market（0.2.0-rc.2 没有 dsh-plugin-market 包）',
    !rowIds.includes('tool-plugin-market'), rowIds.filter((r) => r.includes('market')).join(',') || 'ok');
  check('差异原因写在预设文件注释里（含「抬到 0.2.1-rc.2」的提示，防止下次误加）',
    patchText.includes('0.2.0-rc.2') && patchText.includes('dsh-tool-schedule'), '');
}

// —— 4) prompt 变量白名单：dsh 0.2.1-rc.2 起只注册 provider / model ——
//
// 0.10.1 用户实机报错：`unknown prompt variable "cwd" in section "deployment:persona-prefix";
// registered variables: provider, model`。dsh-system-prompt 对段文本**严格插值**：未知引用会在
// 任何模型请求之前抛错，于是 CC 模式的每一轮都失败 —— 而预设本身挂载正常、roster 里也照常可选，
// 属于最难归类的那类（`--dump-config` 与 broken 诊断都看不出来）。
// 这里把「预设里允许出现哪些变量」钉成显式白名单：dsh 升级若改注册表，先回来核对这张表，
// 而不是等用户在线上每轮撞一次「本轮运行失败」。
{
  const PROMPT_VARIABLES = ['provider', 'model'];
  const codeLines = (text) => text.split('\n').filter((l) => !l.trimStart().startsWith('#'));
  const variablesIn = (text) => [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim());
  const allVars = [...new Set(variablesIn(codeLines(patchText).join('\n')))];

  check('预设里不出现 cwd prompt 变量（0.10.1 线上每轮报错的直接原因）', !allVars.includes('cwd'), allVars.join(', ') || '(无变量)');
  check('预设的 prompt 变量都在 dsh 0.2.1-rc.2 的注册表白名单内（provider / model）',
    allVars.every((v) => PROMPT_VARIABLES.includes(v)), allVars.join(', ') || '(无变量)');
  check('persona 仍介绍模型（{{model}} 不该被一并删掉）', allVars.includes('model'), allVars.join(', '));

  // 0.10.2：DSH provider 对 tool input 严格 JSON.parse，模型偶发尾逗号 → 整轮 MALFORMED_RESPONSE。
  // persona 是模型最关注的文本，JSON 卫生 + 分小步写的规则必须留在里面。
  check('persona 含工具参数 JSON 卫生规则（尾逗号会让 provider 判本轮失败）',
    codeLines(patchText).join('\n').includes('工具参数必须是严格合法的 JSON'), '');

  // 0.11.0 用户实测：角色卡完成后 LLM 不会主动释放草稿锁，工坊一直只读。流程引导必须写进 persona
  // （模型最关注的文本）——「cc_validate 通过 = 创作完成，必须调用 cc_release_draft 收口」。
  check('persona 含草稿锁交还规则（cc_validate 通过后必须 cc_release_draft）',
    codeLines(patchText).join('\n').includes('cc_release_draft'), '');

  // 0.19.0：设定铁律（canon）必须由 persona 要求模型在交付前给出 —— 这条如果只写在工具描述里，
  // 模型选工具时未必读；而「运行期吃书」的根因是卡里没有可注入的事实清单，不是插件校验不够。
  const personaText = codeLines(patchText).join('\n');
  check('persona 含设定铁律规则（交付前给 canon：条数上限 + 写进卡的三处）',
    personaText.includes('设定铁律') && personaText.includes('canon') && personaText.includes('cc_validate({canon'), '');
  check('persona 要求写前先看 canonDigest（先对账再写，而不是写完再说）',
    personaText.includes('canonDigest'), '');
}

// —— 5) 投递层：package.json 必须仍然只列两层补丁，且第二层是预设声明 ——
{
  const patches = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  check('package.json 的 dsh.bundle.patch 列两层补丁', Array.isArray(patches) && patches.length === 2, JSON.stringify(patches));
  check('两层补丁都指向真实存在的文件',
    Array.isArray(patches) && patches.every((p) => existsSync(new URL('../' + p.replace(/^\.\//, ''), import.meta.url))), JSON.stringify(patches));
  check('声明层在补丁列表里（插件行 + 预设声明各一层）',
    Array.isArray(patches) && patches.includes('./presets/cc.patch.yml') && patches.includes('./cordis.patch.yml'), JSON.stringify(patches));
  check('files 不再包含旧的 presets/cc 目录形态（只宣布 presets 根）',
    Array.isArray(pkg.files) && pkg.files.includes('presets') && !pkg.files.some((f) => f.includes('presets/cc')), JSON.stringify(pkg.files));
}

// —— 6) 旧世界不许回流（0.12.0 的删除是刻意的，不是临时规避） ——
//
// 0.11.5 及更早的插件会在挂载时把 presets/cc 装到 <DSH_HOME>/.agent-presets/cc。
// 0.12.0 起不再兼容 dsh < 0.2.0，那段代码（以及目录模板）被整体删除；这里做两道守卫：
// 源码里任何一处重新出现旧标识符 / 旧落盘路径都直接红，避免有人「顺手兼容一下」又把它带回来。
{
  const hostSrc = read('lib/index.js');
  const agentSrc = read('lib/agent.js');
  const LEGACY = ['installCcPreset', 'planPresetInstall', 'supportsDeclaredPresets', 'presetTargetRoot',
    'presetSourceRoot', 'DSH_CC_STUDIO_PRESET_INSTALL', '.agent-presets'];
  for (const token of LEGACY) {
    check(`宿主/预设半不得再出现旧标识符 ${token}`,
      !hostSrc.includes(token) && !agentSrc.includes(token),
      [hostSrc.includes(token) ? 'lib/index.js' : '', agentSrc.includes(token) ? 'lib/agent.js' : ''].filter(Boolean).join(','));
  }
  check('旧的目录模板 presets/cc/ 已删除（目录形态只服务 dsh ≤0.1.6-alpha.2）',
    !existsSync(new URL('../presets/cc/', import.meta.url)), '');
  check('presets/ 下只剩声明层', existsSync(new URL('../presets/cc.patch.yml', import.meta.url))
    && !existsSync(new URL('../presets/cc/preset.yml', import.meta.url)), '');
}

// —— 7) README 里的版本号守卫（0.11.2 事故：dsh 版本被写坏成 0.4.x） ——
//
// 事故形态：中文 README 里的一批 dsh 版本号被写成了 `0.4.x`（dsh 从来没有 0.4 系列），
// 而文档完全没有测试盯着 —— 错误一路发到 npm 页面（npm 渲染的就是包里的 README.md），
// 直到用户读安装引导时才发现。这里把「两份 README 里出现的 0.x 版本号」钉在并集内：
//   ① `dshReleases` 的键；② `dsh.compatibility.dsh` 范围里的版本；
//   ③ dsh 主版本前缀（正文常简写成「0.2.1 起」「dsh 0.2.0」）；
//   ④ 插件自身版本（CHANGELOG 的 `## x.y.z` 标题）；再加明示「未声明」的 dsh 版本。
// 不在并集里的 0.x token 直接红。非 0 开头（SillyTavern `1.19.0`）与 IP 地址不归本守卫管。
{
  const changelog = read('CHANGELOG.md');
  const pluginVersions = (changelog.match(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/gm) || []).map((l) => l.slice(3));
  const compat = pkg.dsh.compatibility;
  const declaredDsh = Object.keys(compat.dshReleases);
  const rangeDsh = String(compat.dsh).match(/\d+\.\d+\.\d+(?:-[A-Za-z]+\.\d+)?/g) || [];
  const majorPrefixes = [...declaredDsh, ...rangeDsh].map((v) => v.split('-')[0]);
  // 「没实测过、但 README / 矩阵需要如实点名」的版本：只进白名单，不进 dshReleases。
  const unverified = ['0.2.0-rc.1', '0.2.1-alpha.1', '0.2.1-rc.4'];
  const allowedVersions = new Set([...declaredDsh, ...rangeDsh, ...majorPrefixes, ...unverified, ...pluginVersions]);

  const VERSION = /\b\d+\.\d+\.\d+(?:-[A-Za-z]+\.\d+)?\b/g;
  const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const stray = [];
  for (const file of ['README.md', 'README_EN.md']) {
    read(file).split('\n').forEach((raw, i) => {
      const line = raw.replace(IPV4, '<ip>');
      for (const m of line.matchAll(VERSION)) {
        const v = m[0];
        if (allowedVersions.has(v)) continue;
        if (!v.startsWith('0.')) continue;   // SillyTavern 1.19.0 之类不归本守卫管
        stray.push(`${file}:${i + 1} ${v}`);
      }
    });
  }
  check('README 里的 0.x 版本号都在 dshReleases / 未实测 / 插件版本并集内（0.4.x 那类写坏会红）',
    stray.length === 0, stray.slice(0, 8).join(' | ') || 'ok');
}

// —— 8) DSH STORE 上架契约（issue #1173）——
// STORE 自动策略（registry/automation-policy.json 的 automaticApproval）里「声明类」门禁是可修的：
// repository 规范化后必须等于 canonical 仓库、必须有 DSH/Node 兼容声明、不能有运行依赖与生命周期脚本。
// 而 files / credentials 两个权限信号是本插件的固有能力（草稿与角色库落盘、读 DSH_HOME 环境变量），
// 触发即意味着自动低风险通道（source-verified）永远不可能通过，商城对这类合法插件只会按
// user-reviewed（本机逐次确认）收录 —— 所以**不要**为了消除信号去改运行时代码（那是规避扫描器）。
// 这里只把「声明类」门禁钉死，防止再次静默漂移。
{
  const canonicalRepository = (value) => String(value ?? '')
    .replace(/^git\+/, '').replace(/^git:\/\//, 'https://')
    .replace(/\.git\/?$/i, '').replace(/\/$/, '');
  check('repository 规范化后等于 canonical GitHub 仓库（STORE requireManifestRepositoryMatch）',
    canonicalRepository(pkg.repository && pkg.repository.url) === 'https://github.com/xia-sc/dsh-cc-studio',
    canonicalRepository(pkg.repository && pkg.repository.url));
  check('engines.node 明确声明（STORE requireNodeCompatibility）',
    typeof pkg.engines?.node === 'string' && pkg.engines.node.trim() !== '', String(pkg.engines?.node));
  const compat = (pkg.dsh && pkg.dsh.compatibility) || {};
  const releases = compat.dshReleases || {};
  const releaseKeys = Object.keys(releases);
  const FULL_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  check('dsh.compatibility.dshReleases 的键是完整 SemVer（STORE 只额外认 rc.7 / rc.8 两个历史别名）',
    releaseKeys.length > 0 && releaseKeys.every((k) => FULL_SEMVER.test(k)), releaseKeys.join(', '));
  check('dshReleases 的值域是 compatible / incompatible / unknown',
    Object.values(releases).every((v) => ['compatible', 'incompatible', 'unknown'].includes(v)),
    JSON.stringify(releases));
  check('至少一条精确 compatible（商城 latest-three 窗口要求 ≥1，范围声明不算证据）',
    Object.values(releases).includes('compatible'), JSON.stringify(releases));
  check('声明 DSH 兼容范围（范围只显示「待验证」，不替代逐版本证据）',
    typeof compat.dsh === 'string' && compat.dsh.trim() !== '', String(compat.dsh));
  check('兼容下限已是 0.2.0-rc.2（0.12.0 起不再兼容 0.2.0 以下的 dsh）',
    String(compat.dsh) === '>=0.2.0-rc.2' && !releaseKeys.some((k) => /^0\.[01]\./.test(k)), String(compat.dsh));
  const runtimeDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) });
  check('没有运行/可选依赖（STORE allowRuntimeDependencies=false）', runtimeDeps.length === 0, runtimeDeps.join(', '));
  check('没有 preinstall/install/postinstall/prepare 生命周期脚本（STORE allowLifecycleScripts=false）',
    ['preinstall', 'install', 'postinstall', 'prepare'].every((k) => (pkg.scripts || {})[k] === undefined),
    Object.keys(pkg.scripts || {}).join(', '));
  check('files 显式声明分发清单（STORE requireExplicitFiles）',
    Array.isArray(pkg.files) && pkg.files.length > 0, JSON.stringify(pkg.files));
  const externalImports = ['index.js', 'agent.js'].flatMap((name) => {
    const src = read('lib/' + name);
    return [...src.matchAll(/^\s*import[^;\n]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1])
      .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
  });
  check('宿主半与预设半只 import node: 内建 / 相对路径（重新引入外部包 = 多一条供应链审查）',
    externalImports.length === 0, externalImports.join(', '));
  const readmeText = read('README.md');
  check('README 有「兼容与权限」披露节（STORE 的权限元数据取自 manifest / README / 运行时代码）',
    readmeText.includes('## 兼容与权限'), '');
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 110)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
