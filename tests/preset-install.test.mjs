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

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const patches = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  check('package.json 的 dsh.bundle.patch 列两层补丁', Array.isArray(patches) && patches.length === 2, JSON.stringify(patches));
  check('两层补丁都指向真实存在的文件',
    Array.isArray(patches) && patches.every((p) => existsSync(new URL('../' + p.replace(/^\.\//, ''), import.meta.url))), JSON.stringify(patches));
  check('声明层在补丁列表里（插件行 + 预设声明各一层）',
    Array.isArray(patches) && patches.includes('./presets/cc.patch.yml') && patches.includes('./cordis.patch.yml'), JSON.stringify(patches));
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
