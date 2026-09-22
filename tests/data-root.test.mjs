/**
 * 落盘根回归测试：草稿与角色库必须「DSH_HOME 优先 + 读时回退 ~/.dsh」（不随插件发布，files 未含 tests）。
 *
 * 背景（0.3.6）：这两处以前写死 homedir()/.dsh，而预设目录走 DSH_HOME —— 同一个插件有两套根。
 * 后果有两个：① 自定义了 DSH_HOME 的用户，预设装在新根、草稿与角色卡却留在旧根；
 * ② 隔离实测（AGENTS.md §6 的推荐做法）只设 DSH_HOME 时，草稿会写进**真实的** ~/.dsh。
 * 现在统一成一套：写主根（DSH_HOME 优先，未设置则 homedir()/.dsh）、读时回退旧根。
 *
 * 隔离副作用：进程内改掉 HOME / USERPROFILE / DSH_HOME，末尾校验沙箱外没被写。
 * 运行：node tests/data-root.test.mjs   （全绿退出码 0）
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDshHome = process.env.DSH_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-cc-dataroot-home-'));
const sandboxDsh = mkdtempSync(join(tmpdir(), 'dsh-cc-dataroot-dsh-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.DSH_HOME = sandboxDsh;

const host = await import('../lib/index.js');
const agent = await import('../lib/agent.js');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const primaryDrafts = join(sandboxDsh, 'cc-drafts');
const primaryLib = join(sandboxDsh, 'cc-library');
const legacyDrafts = join(sandboxHome, '.dsh', 'cc-drafts');
const legacyLib = join(sandboxHome, '.dsh', 'cc-library');

function draftOf(name) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: { name, group_only_greetings: ['hi'] } };
}
function writeDraftFile(dir, key, name, updatedAt) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, host.safeDraftFile(key)), JSON.stringify({ key, updatedAt: updatedAt || 1000, draft: draftOf(name) }, null, 2), 'utf8');
}
function writeLibFile(dir, id, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, id + '.json'), JSON.stringify({ id, meta: { id, name, createdAt: 1, updatedAt: 2 }, draft: draftOf(name) }, null, 2), 'utf8');
}

// —— 1) 根解析：DSH_HOME 优先，未设置时与 0.3.5 完全一致 ——
{
  check('草稿主根 = <DSH_HOME>/cc-drafts', host.draftDirs()[0] === primaryDrafts, host.draftDirs().join(' | '));
  check('候选表 = [主根, 旧根]（顺序即优先级）', eq(host.draftDirs(), [primaryDrafts, legacyDrafts]), host.draftDirs().join(' | '));
  check('角色库同理', eq(host.libDirs(), [primaryLib, legacyLib]), host.libDirs().join(' | '));
  check('预设根仍走 DSH_HOME（本次未动它）', host.presetTargetRoot() === join(sandboxDsh, '.agent-presets', 'cc'), host.presetTargetRoot());
  check('所有候选根都落在沙箱内（没有一个指向真实用户目录）',
    host.draftDirs().concat(host.libDirs()).every((d) => d.startsWith(sandboxDsh) || d.startsWith(sandboxHome)),
    host.draftDirs().concat(host.libDirs()).join(' | '));

  process.env.DSH_HOME = '';
  check('DSH_HOME 未设置 → 单一根，等于 homedir()/.dsh/cc-drafts（老用户路径零变化）',
    eq(host.draftDirs(), [legacyDrafts]), host.draftDirs().join(' | '));
  check('DSH_HOME 未设置 → 角色库同理', eq(host.libDirs(), [legacyLib]), host.libDirs().join(' | '));

  process.env.DSH_HOME = '   ';
  check('DSH_HOME 全是空白 → 视为未设置', eq(host.draftDirs(), [legacyDrafts]), host.draftDirs().join(' | '));

  process.env.DSH_HOME = sandboxDsh + '   ';
  check('DSH_HOME 两侧空白 → trim 后生效', host.draftDirs()[0] === primaryDrafts, host.draftDirs()[0]);

  process.env.DSH_HOME = join(sandboxHome, '.dsh');
  check('DSH_HOME 恰好等于旧根 → 去重成一条（不重复扫同一目录）', eq(host.draftDirs(), [legacyDrafts]), host.draftDirs().join(' | '));

  process.env.DSH_HOME = sandboxDsh;
}

// —— 2) 两半（host / agent）必须算出同一套路径 ——
{
  const keys = ['default', 'session-abc-123', 'session-中文 与/奇怪 key', ''];
  check('两半的草稿文件名算法一致（同一个 key → 同一个文件）',
    keys.every((k) => agent.safeDraftFile(k) === host.safeDraftFile(k)), keys.map((k) => host.safeDraftFile(k)).join(','));
  check('两半的草稿根一致', eq(agent.draftDirs(), host.draftDirs()), agent.draftDirs().join(' | '));
  check('两半的角色库根一致', eq(agent.libDirs(), host.libDirs()), agent.libDirs().join(' | '));
}

// —— 3) 草稿：写主根、读回退旧根、主根优先 ——
{
  host.persistDraftSync('session-w', draftOf('主根卡'));
  check('写盘落在主根', existsSync(join(primaryDrafts, host.safeDraftFile('session-w'))), primaryDrafts);
  check('写盘不碰旧根', !existsSync(join(legacyDrafts, host.safeDraftFile('session-w'))), legacyDrafts);
  check('读回主根那份', (host.loadPersistedDraftSync('session-w') || {}).data.name === '主根卡', '');

  writeDraftFile(legacyDrafts, 'session-legacy', '旧根卡');
  check('主根没有时读盘回退旧根（升级后老草稿不丢）',
    (host.loadPersistedDraftSync('session-legacy') || {}).data.name === '旧根卡', '');
  check('findDraftPath 如实指向旧根那份',
    host.findDraftPath('session-legacy') === join(legacyDrafts, host.safeDraftFile('session-legacy')),
    String(host.findDraftPath('session-legacy')));

  writeDraftFile(legacyDrafts, 'session-w', '旧根同名（应被主根盖住）');
  check('两处都有时主根优先', (host.loadPersistedDraftSync('session-w') || {}).data.name === '主根卡', '');

  const slots = host.listDraftSlotsOnDisk();
  check('listDraftSlotsOnDisk 是两个根的并集', slots.length === 2, slots.map((s) => s.key).join(','));
  check('同一把槽只报一次，且报主根那份',
    slots.filter((s) => s.key === 'session-w').length === 1 && slots.find((s) => s.key === 'session-w').name === '主根卡',
    JSON.stringify(slots.map((s) => [s.key, s.name])));
}

// —— 4) 角色库：写主根、读回退、list 并集去重、删除要连旧根一起删、改名就地改 ——
{
  await host.saveLibraryEntry(draftOf('主根卡'), { id: 'main-1' });
  check('角色卡写在主根', existsSync(join(primaryLib, 'main-1.json')), primaryLib);
  check('角色卡不碰旧根', !existsSync(join(legacyLib, 'main-1.json')), legacyLib);
  check('读回主根那份', (await host.loadLibraryEntry('main-1')).meta.name === '主根卡', '');

  writeLibFile(legacyLib, 'legacy-1', '旧根卡');
  check('主根没有时回退旧根（升级后老卡还在）',
    (await host.loadLibraryEntry('legacy-1')).draft.data.name === '旧根卡', '');
  const listed = await host.listLibraryEntries();
  check('listLibraryEntries 是两个根的并集', listed.length === 2, listed.map((e) => e.id).join(','));
  check('并集里没有重复 id', new Set(listed.map((e) => e.id)).size === listed.length, listed.map((e) => e.id).join(','));

  writeLibFile(legacyLib, 'main-1', '旧根同名（应被主根盖住）');
  check('两处都有时读主根那份', (await host.loadLibraryEntry('main-1')).meta.name === '主根卡', '');
  check('list 也按主根优先去重',
    (await host.listLibraryEntries()).find((e) => e.id === 'main-1').name === '主根卡', '');

  await host.renameLibraryEntry('legacy-1', '改过的旧根卡');
  check('改名就地写在解析到的那一份（这里是旧根），不搬家',
    JSON.parse(readFileSync(join(legacyLib, 'legacy-1.json'), 'utf8')).meta.name === '改过的旧根卡'
      && !existsSync(join(primaryLib, 'legacy-1.json')), '');
  check('改名后 load 能看到新名字', (await host.loadLibraryEntry('legacy-1')).meta.name === '改过的旧根卡', '');

  await host.deleteLibraryEntry('main-1');
  check('删除会把两个根的同名副本都删掉（否则回退读会把它复活）',
    !existsSync(join(primaryLib, 'main-1.json')) && !existsSync(join(legacyLib, 'main-1.json')), '');
  let threw = false;
  try { await host.deleteLibraryEntry('main-1'); } catch { threw = true; }
  check('删不存在的 id 仍然报错（既有语义不变）', threw, '');
  let loadThrew = false;
  try { await host.loadLibraryEntry('main-1'); } catch { loadThrew = true; }
  check('删除后 load 报错', loadThrew, '');
}

// —— 5) 源码守卫：不许再出现写死的 homedir()/.dsh/cc-* ——
{
  const idx = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const agt = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
  const hardcoded = /join\(\s*homedir\(\)\s*,\s*"\.dsh"\s*,\s*"cc-(drafts|library)"\s*\)/;
  check('lib/index.js 里没有写死的 homedir()/.dsh/cc-*', !hardcoded.test(idx), '');
  check('lib/agent.js 里没有写死的 homedir()/.dsh/cc-*', !hardcoded.test(agt), '');
  check('两半都从 dataRoots("cc-*") 派生',
    /dataRoots\("cc-drafts"\)/.test(idx) && /dataRoots\("cc-library"\)/.test(idx)
      && /dataRoots\("cc-drafts"\)/.test(agt) && /dataRoots\("cc-library"\)/.test(agt), '');
}

// —— 清理 ——
if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome;
for (const d of [sandboxHome, sandboxDsh]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 110)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
