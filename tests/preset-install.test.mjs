/**
 * CC 预设自动安装回归测试（不随插件发布，files 未包含 tests）。
 *
 * 背景：预设此前必须手工拷贝，但 dsh 的预设发现只扫三个根（shipped / config.roots / 用户根
 * <DSH_HOME>/.agent-presets），插件包内的 presets/ 不在其中。本插件因此在挂载时把模板装进用户根。
 * 这条路径会写用户主目录，所以必须把「绝不覆盖用户改动」的规则钉死。
 *
 * 运行：node tests/preset-install.test.mjs   （全绿退出码 0）
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离副作用：插件用 DSH_HOME / homedir() 解析预设根，测试前改到沙箱
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-test-'));
process.env.DSH_HOME = sandboxHome;

const host = await import('../lib/index.js');
const { planPresetInstall, installCcPreset, supportsDeclaredPresets, presetTargetRoot } = host;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PRESET_DIR = join(sandboxHome, '.agent-presets', 'cc');
const TPL_A = 'preset.yml 模板 A';
const TPL_B = 'preset.yml 模板 B';
// 与实现同算法，用于构造「我们上次写入时的哈希」记录
const sha256Of = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

// —— 1) 纯决策函数：planPresetInstall 的四条规则 ——
{
  // 目标缺失 → 写
  let p = planPresetInstall({ 'preset.yml': null }, { 'preset.yml': TPL_A }, null);
  check('缺文件 → 写入', eq(p.write, ['preset.yml']) && eq(p.skip, []), JSON.stringify(p));

  // 与模板一致 → 不动
  p = planPresetInstall({ 'preset.yml': TPL_A }, { 'preset.yml': TPL_A }, null);
  check('与模板一致 → 不动', eq(p.write, []) && eq(p.ok, ['preset.yml']), JSON.stringify(p));

  // 与记录一致（我们写的、用户没改）且模板已变 → 安全更新
  const recorded = { files: { 'preset.yml': sha256Of(TPL_A) } };
  p = planPresetInstall({ 'preset.yml': TPL_A }, { 'preset.yml': TPL_B }, recorded);
  check('我们写的且未改 + 模板变化 → 更新', eq(p.write, ['preset.yml']), JSON.stringify(p));

  // 用户改过（内容既非模板也非记录）→ 跳过
  p = planPresetInstall({ 'preset.yml': '用户手改的内容' }, { 'preset.yml': TPL_B }, recorded);
  check('用户改过 → 跳过', eq(p.write, []) && eq(p.skip, ['preset.yml']), JSON.stringify(p));

  // 无记录的历史手工拷贝（内容非模板）→ 跳过（这正是本机现状）
  p = planPresetInstall({ 'preset.yml': '历史手工拷贝' }, { 'preset.yml': TPL_B }, null);
  check('无记录的手工拷贝 → 跳过', eq(p.write, []) && eq(p.skip, ['preset.yml']), JSON.stringify(p));

  // force → 连用户改动一起覆盖
  p = planPresetInstall({ 'preset.yml': '用户手改的内容' }, { 'preset.yml': TPL_B }, recorded, true);
  check('force → 覆盖用户改动', eq(p.write, ['preset.yml']) && eq(p.skip, []), JSON.stringify(p));
}

// —— 2) 集成：全新安装（沙箱里第一次） ——
{
  const out = installCcPreset({}, undefined);
  check('全新环境 → installed', out.status === 'installed', JSON.stringify(out));
  check('preset.yml 已落盘', existsSync(join(PRESET_DIR, 'preset.yml')), '');
  check('agent.cordis.yml 已落盘', existsSync(join(PRESET_DIR, 'agent.cordis.yml')), '');
  check('安装了全部受管文件', out.installed.length === 2, JSON.stringify(out.installed));
  check('落盘内容 = 插件模板', readFileSync(join(PRESET_DIR, 'preset.yml'), 'utf8') === readFileSync(new URL('../presets/cc/preset.yml', import.meta.url), 'utf8'), '');
  check('写了安装记录', existsSync(join(PRESET_DIR, '.dsh-cc-studio-preset.json')), '');
  const marker = JSON.parse(readFileSync(join(PRESET_DIR, '.dsh-cc-studio-preset.json'), 'utf8'));
  check('记录含版本与文件哈希', typeof marker.version === 'string' && Object.keys(marker.files).length === 2, JSON.stringify(marker));
  check('presetTargetRoot 指向 DSH_HOME', presetTargetRoot() === PRESET_DIR, presetTargetRoot());
}

// —— 3) 集成：二次调用幂等 ——
{
  const out = installCcPreset({}, undefined);
  check('二次调用 → current（幂等，不重写）', out.status === 'current', JSON.stringify(out));
  check('更新列表为空', out.updated.length === 0, JSON.stringify(out));
}

// —— 4) 集成：用户改过受管文件 → 保留且告警 ——
{
  const p = join(PRESET_DIR, 'agent.cordis.yml');
  const userEdit = '用户自己改的预设内容';
  writeFileSync(p, userEdit, 'utf8');
  const out = installCcPreset({}, undefined);
  check('用户改动被保留（未覆盖）', readFileSync(p, 'utf8') === userEdit, readFileSync(p, 'utf8').slice(0, 40));
  check('用户改动被报告为 skipped', out.skipped.includes('agent.cordis.yml'), JSON.stringify(out.skipped));

  // 关键不变量：标记只声明「我们拥有的」内容。若把跳过的用户文件也记成模板哈希，
  // 下一轮就会把它误判成「我们写的、用户没改」从而覆盖用户内容。
  const marker = JSON.parse(readFileSync(join(PRESET_DIR, '.dsh-cc-studio-preset.json'), 'utf8'));
  check('标记未声明被跳过的用户文件', marker.files['agent.cordis.yml'] === undefined, JSON.stringify(marker.files));
  check('标记仍声明了我们拥有的文件', typeof marker.files['preset.yml'] === 'string', JSON.stringify(marker.files));

  // 再跑一次：仍必须跳过，绝不能因为标记过而改写
  const again = installCcPreset({}, undefined);
  check('重复运行仍跳过用户文件', again.skipped.includes('agent.cordis.yml') && readFileSync(p, 'utf8') === userEdit, JSON.stringify(again.skipped));
}

// —— 5) 集成：presetInstall: "off" 完全不碰磁盘 ——
{
  const dir2 = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-off-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir2;
  const out = installCcPreset({}, { presetInstall: 'off' });
  check('off → status=off', out.status === 'off', JSON.stringify(out));
  check('off → 未创建预设目录', !existsSync(join(dir2, '.agent-presets')), '');
  process.env.DSH_HOME = prev;
}

// —— 5b) 环境变量开关（轻量逃生口）：off 生效，且 config 优先于 env ——
{
  const dirEnv = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-env-'));
  const prevHome = process.env.DSH_HOME;
  const prevEnv = process.env.DSH_CC_STUDIO_PRESET_INSTALL;
  process.env.DSH_HOME = dirEnv;
  process.env.DSH_CC_STUDIO_PRESET_INSTALL = 'off';
  const offByEnv = installCcPreset({}, undefined);
  check('env=off → status=off', offByEnv.status === 'off', JSON.stringify(offByEnv));
  check('env=off → 未创建预设目录', !existsSync(join(dirEnv, '.agent-presets')), '');
  // config 优先：env 说 off，但 config 说 auto → 应安装
  const cfgWins = installCcPreset({}, { presetInstall: 'auto' });
  check('config 优先于 env（auto 覆盖 off）', cfgWins.status === 'installed', JSON.stringify(cfgWins));
  if (prevEnv === undefined) delete process.env.DSH_CC_STUDIO_PRESET_INSTALL; else process.env.DSH_CC_STUDIO_PRESET_INSTALL = prevEnv;
  process.env.DSH_HOME = prevHome;
}

// —— 6) 集成：force 覆盖用户改动 ——
{
  const p = join(PRESET_DIR, 'agent.cordis.yml');
  writeFileSync(p, '又要被覆盖的内容', 'utf8');
  const out = installCcPreset({}, { presetInstall: 'force' });
  check('force → 已更新', out.updated.includes('agent.cordis.yml'), JSON.stringify(out));
  check('force → 内容回到模板', readFileSync(p, 'utf8') === readFileSync(new URL('../presets/cc/agent.cordis.yml', import.meta.url), 'utf8'), '');
}

// —— 7) 集成：模板缺失时不炸（模拟打包漏了 presets） ——
{
  const dir3 = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-notpl-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir3;
  // 直接调 planPresetInstall，空模板
  const pl = planPresetInstall({}, {}, null);
  check('空模板 → 无写入', pl.write.length === 0, JSON.stringify(pl));
  process.env.DSH_HOME = prev;
}

// —— 8) 集成：全是用户文件（纯手工拷贝）→ 不写任何记录、目录保持原样 ——
{
  const dir5 = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-manual-'));
  const presetDir = join(dir5, '.agent-presets', 'cc');
  mkdirSync(presetDir, { recursive: true });
  writeFileSync(join(presetDir, 'preset.yml'), '手工的 preset', 'utf8');
  writeFileSync(join(presetDir, 'agent.cordis.yml'), '手工的 agent', 'utf8');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir5;
  const out = installCcPreset({}, undefined);
  check('纯手工拷贝 → 全部跳过', out.skipped.length === 2 && out.status === 'skipped-user-edited', JSON.stringify(out.skipped));
  check('纯手工拷贝 → 不写记录文件（不留痕迹）', !existsSync(join(presetDir, '.dsh-cc-studio-preset.json')), readdirSync(presetDir).join(','));
  check('纯手工拷贝 → 目录内容原样', readFileSync(join(presetDir, 'preset.yml'), 'utf8') === '手工的 preset', '');
  process.env.DSH_HOME = prev;
}

// —— 9) apply() 会触发安装（反馈所说的「装完即有」） ——
{
  const dir4 = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-apply-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir4;
  // 复用 rpc-channel 测试的最小假 ctx 形状
  const fakeCtx = {
    effect(fn) { fn(); return () => {}; },
    get() { return undefined; },
    webServer: { register() { return () => {}; } },
  };
  const out = await host.apply(fakeCtx);
  check('apply() 返回 undefined（不改变既有契约）', out === undefined, String(out));
  check('apply() 已自动安装预设', existsSync(join(dir4, '.agent-presets', 'cc', 'preset.yml')), '');
  process.env.DSH_HOME = prev;
}

// —— 10) 预设模板行契约：与 dsh 内置 standard 的同步不许悄悄回退 ——
//
// 这一类漂移是本项目历史上最贵的 bug（0.3.1：`workflow-worker-thread` 下线后仍写在
// 预设里，整份 CC 预设被判 broken、在 roster 里直接消失；0.3.4：`present` 整行漏抄与
// `modelSelectionSettings` 漏抄，两者都不报错，只是静默少能力）。这里钉死的是「行必须
// 存在且名字正确」这类不变量，纯读模板、不依赖本机装了哪个 dsh，所以 CI 上也能跑。
// 至于「逐行 diff 内置 standard」，那是升级时要做的动作，见 AGENTS.md §4。
{
  const tpl = readFileSync(new URL('../presets/cc/agent.cordis.yml', import.meta.url), 'utf8');
  const lines = tpl.split('\n');

  // 取 `- id: X` 那一个整块（含其后缩进更深的行，遇到同级或更浅的缩进行即结束）
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

  const idRows = lines.filter((l) => /^\s*- id: \S/.test(l));
  const nameRows = lines.filter((l) => /^\s*name: \S/.test(l));
  check('每个 - id 行都有 name（漏一个 name = 整份预设 broken）', idRows.length === nameRows.length && idRows.length > 0, `ids=${idRows.length} names=${nameRows.length}`);

  const wf = blockOf('workflow-ptc');
  check('workflow 行仍指向 dsh-workflow-ptc', /name:\s*'@deepseek-ai\/dsh-workflow-ptc'/.test(wf), (wf.split('\n')[1] || 'missing').trim());
  check('没有已下线的 workflow-worker-thread 行（0.3.1 事故回归）', !/name:\s*'@deepseek-ai\/dsh-workflow-worker-thread'/.test(tpl), '');

  const spawn = blockOf('tool-subagent');
  check('tool-subagent（spawn）开了 modelSelectionSettings', /modelSelectionSettings:\s*true/.test(spawn), (spawn.split('\n')[0] || 'missing').trim());
  const fork = blockOf('tool-subagent-fork');
  check('tool-subagent-fork 不加 modelSelectionSettings（须与父代理同 provider/model）', fork !== '' && !/modelSelectionSettings/.test(fork), (fork.split('\n')[0] || 'missing').trim());

  const present = blockOf('present');
  check('present 行存在且指向 dsh-tool-present（0.3.4 补回）', /name:\s*'@deepseek-ai\/dsh-tool-present'/.test(present), (present.split('\n')[1] || 'missing').trim());
  const pm = blockOf('tool-plugin-manager');
  check('tool-plugin-manager 行存在且 disabled（alpha.2 新增，抄来只为行差干净）', /disabled:\s*true/.test(pm), (pm.split('\n')[1] || 'missing').trim());
}

// —— 11) dsh >= 0.1.7-alpha.1：目录安装让位（预设改由随包补丁层 presets/cc.patch.yml 声明） ——
//
// 0.1.7-alpha.1 起 dsh 的预设只来自组合里的声明行，<DSH_HOME>/.agent-presets 已经没有任何代码
// 读取 —— 这正是「升级后 CC 模式从 roster 消失」的根因。新版上就不要再往那个死目录写字；
// 但**不能**因此让老版 dsh 少一个预设，所以检测要窄：要求 0.1.7 才引入的两个方法同时存在。
{
  const newRegistry = { register() {}, compositionInventory() {}, composedPreset() {}, list() {} };
  const oldService = { discoverPresets() {}, composedPreset() {}, inactiveRows() {} };

  check('supportsDeclaredPresets：无 ctx → false', supportsDeclaredPresets(undefined) === false, '');
  check('supportsDeclaredPresets：ctx 无 get → false', supportsDeclaredPresets({}) === false, '');
  check('supportsDeclaredPresets：get 抛错 → false（探测自己不炸）', supportsDeclaredPresets({ get() { throw new Error('boom'); } }) === false, '');
  check('supportsDeclaredPresets：老服务（只有 discoverPresets）→ false', supportsDeclaredPresets({ get: () => oldService }) === false, '');
  check('supportsDeclaredPresets：新注册表（register + compositionInventory）→ true', supportsDeclaredPresets({ get: () => newRegistry }) === true, '');

  const prevHome = process.env.DSH_HOME;
  const dirNative = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-native-'));
  process.env.DSH_HOME = dirNative;
  const logged = [];
  const newCtx = { get: () => newRegistry, logger: { info: (m) => logged.push(m), warn: (m) => logged.push(m) } };
  const outNative = installCcPreset(newCtx, undefined);
  check('新版 dsh → status=native', outNative.status === 'native', JSON.stringify(outNative));
  check('新版 dsh → 不再创建 .agent-presets 目录（那里已经没人读）', !existsSync(join(dirNative, '.agent-presets')), '');
  check('新版 dsh → 日志说明了原因（含补丁层文件名）', logged.some((m) => m.includes('presets/cc.patch.yml')), logged.join(' | ').slice(0, 120));

  const dirOld = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-old-'));
  process.env.DSH_HOME = dirOld;
  const outOld = installCcPreset({ get: () => oldService }, undefined);
  check('老版 dsh → 仍走目录安装（status=installed）', outOld.status === 'installed', JSON.stringify(outOld));
  check('老版 dsh → preset.yml 已落盘', existsSync(join(dirOld, '.agent-presets', 'cc', 'preset.yml')), '');

  const dirNativeOff = mkdtempSync(join(tmpdir(), 'dsh-cc-preset-native-off-'));
  process.env.DSH_HOME = dirNativeOff;
  const outNativeOff = installCcPreset(newCtx, { presetInstall: 'off' });
  check('presetInstall: off 依旧最优先（新版上也不写盘）', outNativeOff.status === 'off' && !existsSync(join(dirNativeOff, '.agent-presets')), JSON.stringify(outNativeOff));
  process.env.DSH_HOME = prevHome;
}

// —— 12) 声明层 presets/cc.patch.yml：0.1.7 的投递通道，不许与目录模板漂移 ——
//
// 两份清单服务两代 dsh：本文件（声明行，>=0.1.7）与 presets/cc/agent.cordis.yml（目录形态，
// <=0.1.6）。它们必须除注释外逐字一致 —— 0.3.1 的教训是「预设里一个包名不对 = 整个 CC 模式
// 消失」，漂移就是下一个同类 bug。纯读文件、不依赖本机装了哪个 dsh，CI 上也能跑。
{
  const patchText = readFileSync(new URL('../presets/cc.patch.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const tplText = readFileSync(new URL('../presets/cc/agent.cordis.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const metaText = readFileSync(new URL('../presets/cc/preset.yml', import.meta.url), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const metaField = (k) => (metaText.split('\n').find((l) => l.startsWith(k + ':')) || '').slice(k.length + 1).trim();
  const patchLines = patchText.split('\n');
  const pluginsAt = patchLines.findIndex((l) => /^\s*plugins:\s*$/.test(l));

  check('补丁层存在且只有一个 plugins 列表', pluginsAt > 0 && patchLines.filter((l) => /^\s*plugins:\s*$/.test(l)).length === 1, `pluginsAt=${pluginsAt}`);

  const bodyText = patchLines.slice(pluginsAt + 1).join('\n');
  const idRows = bodyText.split('\n').filter((l) => /^\s*- id: \S/.test(l));
  const nameRows = bodyText.split('\n').filter((l) => /^\s*name: \S/.test(l));
  check('补丁层里每个 - id 行都有 name（漏一个 = 整个预设挂不起来）', idRows.length > 0 && idRows.length === nameRows.length, `ids=${idRows.length} names=${nameRows.length}`);

  // 除注释外逐字一致：只允许行首那 10 空格缩进差异（声明层的 plugins 比目录模板深一层）
  const significant = (text, strip) => text
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
    .map((l) => (strip ? l.slice(strip) : l));
  const fromPatch = significant(bodyText, 10);
  const fromTemplate = significant(tplText, 0);
  const firstDiff = fromPatch.findIndex((l, i) => l !== fromTemplate[i]);
  check('两份清单除注释外逐字一致（防漂移）',
    fromPatch.length === fromTemplate.length && fromPatch.length > 0 && firstDiff === -1,
    firstDiff === -1 ? `${fromPatch.length} 行` : `第 ${firstDiff + 1} 行不同：${JSON.stringify(fromPatch[firstDiff])} vs ${JSON.stringify(fromTemplate[firstDiff])}`);

  // —— 12b) prompt 变量白名单：dsh 0.2.1-rc.2 只注册 provider / model ——
  //
  // 0.10.1 用户实机报错：`unknown prompt variable "cwd" in section "deployment:persona-prefix";
  // registered variables: provider, model`（原文里 cwd 外面是双花括号）。dsh-system-prompt 对段文本
  // **严格插值**：未知引用会在任何模型请求之前抛错，于是 CC 模式的每一轮都失败 —— 而预设本身挂载
  // 正常、roster 里也照常可选，属于最难归类的那类（`--dump-config` 与 broken 诊断都看不出来）。
  // dsh 0.2.1-rc.2 起注册表只有 provider / model：工作目录改由 working-directory 服务以
  // runtime context 形式给模型，cwd 变量被移除，内置 standard 的 persona 也只写 model。
  // 这里把「预设里允许出现哪些变量」钉成显式白名单：dsh 升级若改注册表，先回来核对这张表，
  // 而不是等用户在线上每轮撞一次「本轮运行失败」。
  const PROMPT_VARIABLES = ['provider', 'model'];
  const codeLines = (text) => text.split('\n').filter((l) => !l.trimStart().startsWith('#'));
  const variablesIn = (text) => [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim());
  const patchVars = variablesIn(codeLines(patchText).join('\n'));
  const tplVars = variablesIn(codeLines(tplText).join('\n'));
  const allVars = [...new Set([...patchVars, ...tplVars])];
  check('预设里不出现 cwd prompt 变量（0.10.1 线上每轮报错的直接原因）',
    !allVars.includes('cwd'), allVars.join(', ') || '(无变量)');
  check('预设的 prompt 变量都在 dsh 0.2.1-rc.2 的注册表白名单内（provider / model）',
    allVars.every((v) => PROMPT_VARIABLES.includes(v)), allVars.join(', ') || '(无变量)');
  check('两份清单的 prompt 变量集合一致（模板与声明层不许各用一套）',
    eq([...new Set(patchVars)], [...new Set(tplVars)]), `${[...new Set(patchVars)].join(',')} vs ${[...new Set(tplVars)].join(',')}`);
  check('persona 仍介绍模型（{{model}} 不该被一并删掉）',
    patchVars.includes('model') && tplVars.includes('model'), allVars.join(', '));
  // 0.10.2：DSH provider 对 tool input 严格 JSON.parse，模型偶发尾逗号 → 整轮 MALFORMED_RESPONSE。
  // persona 是模型最关注的文本，JSON 卫生 + 分小步写的规则必须留在里面（两份清单都要有）。
  check('persona 含工具参数 JSON 卫生规则（尾逗号会让 provider 判本轮失败）',
    codeLines(patchText).join('\n').includes('工具参数必须是严格合法的 JSON')
    && codeLines(tplText).join('\n').includes('工具参数必须是严格合法的 JSON'), '');
  // 0.11.0 用户实测：角色卡完成后 LLM 不会主动释放草稿锁，工坊一直只读。流程引导必须写进 persona
  // （模型最关注的文本）——「cc_validate 通过 = 创作完成，必须调用 cc_release_draft 收口」。
  check('persona 含草稿锁交还规则（cc_validate 通过后必须 cc_release_draft；两份清单都有）',
    codeLines(patchText).join('\n').includes('cc_release_draft')
    && codeLines(tplText).join('\n').includes('cc_release_draft'), '');

  check("声明行是 preset-cc + '@deepseek-ai/dsh-agent-preset'",
    /- id: preset-cc/.test(patchText) && /name: '@deepseek-ai\/dsh-agent-preset'/.test(patchText), '');
  check('预设 id 恒为 cc（宿主 isCcPreset 与前端 CC_PRESET_ID 都按它精确比较）', /^\s*id: cc$/m.test(patchText), '');
  check('显示名与目录模板 preset.yml 一致', patchText.includes('name: ' + metaField('name')), metaField('name'));
  check('描述与目录模板 preset.yml 一致', patchText.includes('description: ' + metaField('description')), metaField('description').slice(0, 30));
  check('roster 排序号存在（内置四个是 1..4，CC 排在后面）', /^\s*order: \d+$/m.test(patchText), '');
  check('CC 工具行仍挂在本预设下', /- id: cc-agent\s*\n\s*name: '@xia-sc\/dsh-cc-studio\/agent'/.test(patchText), '');
  check('平台条件行仍是未求值的 !!js（disabled 表达式必须留到子行自己求值）', (patchText.match(/disabled: !!js /g) || []).length >= 2, '');
  check('三个 isolate 组都在（planning / compaction / delegation）',
    ['planMode: true', 'compaction: true', 'workflowEngine: true'].every((k) => patchText.includes(k)), '');

  // 0.3.7：本预设的行集是内置 `standard` 那份 plugins 的副本，有意差异只有一处 ——
  // `+ cc-agent`（本插件自己的 14 个 Tool 挂在本预设下）。其余每一行都必须与 standard 对齐。
  //
  // 漏掉整行的代价（0.3.7 实测）：`command-goal` 从初次拷贝起就缺，而它是 standard 自
  // `0.1.6-alpha.2` 起一直有的一行 —— 不报错、预设不判 broken、胶囊与工坊全正常，只是
  // CC 模式会话里没有 `/goal` 斜杠命令。与 0.3.4 补回的 `present`、`modelSelectionSettings`
  // 是同一类「静默少能力」，所以这里把行集钉成显式快照：少一行或多一行都直接红，逼人回到
  // AGENTS.md §4 第 4 步「与目标版本内置 standard 逐行对一遍」，而不是等用户发现少了功能。
  // 升级 dsh 后若 standard 增删了行，先确认它是不是 CC 模式该有的能力，再来改这份快照。
  const rowIds = bodyText.split('\n').filter((l) => /^\s*- id: \S/.test(l)).map((l) => l.trim().replace(/^- id: /, ''));
  const EXPECTED_ROWS = [
    'persona', 'agent-instructions', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
    'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal',
    'planning', 'plan-mode',
    'compaction', 'compaction-basic', 'command-compact', 'tool-result-pruner',
    'delegation', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork',
    'tool-subagent-codex', 'tool-subagent-claude-code', 'workflow-ptc', 'tool-workflow', 'tool-ralph',
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
  check("command-goal 已补回且包名正确（0.3.7 修的自始漏抄）",
    /- id: command-goal\s*\n\s*name: '@deepseek-ai\/dsh-command-goal'/.test(patchText), '');

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const patches = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  check('package.json 的 dsh.bundle.patch 列两层补丁', Array.isArray(patches) && patches.length === 2, JSON.stringify(patches));
  check('两层补丁都指向真实存在的文件',
    Array.isArray(patches) && patches.every((p) => existsSync(new URL('../' + p.replace(/^\.\//, ''), import.meta.url))), JSON.stringify(patches));
  check('声明层在补丁列表里（插件行 + 预设声明各一层）',
    Array.isArray(patches) && patches.includes('./presets/cc.patch.yml') && patches.includes('./cordis.patch.yml'), JSON.stringify(patches));

  // —— DSH STORE 上架契约（issue #1173）——
  // STORE 自动策略（registry/automation-policy.json 的 automaticApproval）里「声明类」门禁是可修的：
  // repository 规范化后必须等于 canonical 仓库、必须有 DSH/Node 兼容声明、不能有运行依赖与生命周期脚本。
  // 而 files / credentials 两个权限信号是本插件的固有能力（草稿与角色库落盘、读 DSH_HOME 环境变量），
  // 触发即意味着自动低风险通道（source-verified）永远不可能通过，商城对这类合法插件只会按
  // user-reviewed（本机逐次确认）收录 —— 所以**不要**为了消除信号去改运行时代码（那是规避扫描器）。
  // 这里只把「声明类」门禁钉死，防止再次静默漂移。
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
  const runtimeDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) });
  check('没有运行/可选依赖（STORE allowRuntimeDependencies=false）', runtimeDeps.length === 0, runtimeDeps.join(', '));
  check('没有 preinstall/install/postinstall/prepare 生命周期脚本（STORE allowLifecycleScripts=false）',
    ['preinstall', 'install', 'postinstall', 'prepare'].every((k) => (pkg.scripts || {})[k] === undefined),
    Object.keys(pkg.scripts || {}).join(', '));
  check('files 显式声明分发清单（STORE requireExplicitFiles）',
    Array.isArray(pkg.files) && pkg.files.length > 0, JSON.stringify(pkg.files));
  const externalImports = ['index.js', 'agent.js'].flatMap((name) => {
    const src = readFileSync(new URL('../lib/' + name, import.meta.url), 'utf8');
    return [...src.matchAll(/^\s*import[^;\n]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1])
      .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
  });
  check('宿主半与预设半只 import node: 内建 / 相对路径（重新引入外部包 = 多一条供应链审查）',
    externalImports.length === 0, externalImports.join(', '));
  const readmeText = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  check('README 有「兼容与权限」披露节（STORE 的权限元数据取自 manifest / README / 运行时代码）',
    readmeText.includes('## 兼容与权限'), '');
}

// —— 清理 ——
if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome;
for (const d of [sandboxHome]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 110)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
