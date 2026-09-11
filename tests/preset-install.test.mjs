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
const { planPresetInstall, installCcPreset, presetTargetRoot } = host;

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

// —— 清理 ——
if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome;
for (const d of [sandboxHome]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 110)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
