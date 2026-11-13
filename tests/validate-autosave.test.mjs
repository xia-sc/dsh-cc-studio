/**
 * 0.24.3：`cc_validate` 通过后**自动落库**的回归测试。
 *
 * 背景（用户反馈）：模型写完卡经常忘记 `cc_save_to_library`，随后在工坊左栏点另一张卡载入，
 * 当前草稿就被覆盖了 —— 宿主其实有备份（`cc-drafts/backups`，20 份），但没有恢复入口，
 * 用户等于丢数据。
 *
 * 修法：`valid=true`（创作完成）时自动保存到角色库 —— 有来源 id 就更新原卡、没有就新建；
 * 失败不阻塞校验结果；`autoSave:false` 可明确关闭。
 *
 * 运行：node tests/validate-autosave.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 三个一起指向临时目录（见 AGENTS.md §2.6）。
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-autosave-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const agent = await import('../lib/agent.js');
import { check, finish } from './harness.mjs';

const tools = new Map();
agent.apply({ get() { return null; }, tools: { register(d) { tools.set(d.name, d); } } });
const exec = { agent: { session: { id: 'session-autosave' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

const libDir = join(tmpHome, 'cc-library');
const libFiles = () => {
  try { return readdirSync(libDir).filter((f) => f.endsWith('.json') && !f.includes('.origin')); }
  catch { return []; }
};

async function buildCard(name) {
  await call('cc_patch_character', {
    name,
    description: '测试用角色：安静、话少。',
    personality: '安静',
    scenario: '放学后的教室。',
    system_prompt: agent.TIME_SYSTEM_PROMPT,
    post_history_instructions: agent.TIME_POST_HISTORY,
  });
  await call('cc_patch_world', {
    timeline: '十年前那场大火之后，学校再也没有招过新生。',
    factions: '夜巡与学生会。',
    geo: '旧校舍、广播室、天台。',
  });
  await call('cc_add_lorebook_entries', {
    entries: ['旧校舍', '广播室', '天台', '夜巡', '学生会'].map((n) => ({
      name: n, keys: [n], content: '@@depth 4\n' + n + '的记录。',
    })),
  });
  await call('cc_patch_greetings', {
    first_mes: '[时间：2026-01-01 08:00]\n开场。',
    alternate_greetings: ['备选一', '备选二'],
    group_only_greetings: ['群聊开场'],
    mes_example: '{{user}}: 在吗\n{{char}}: 在。',
  });
}

// —— ① 第一次通过校验 → 新建一张库卡 ——
await buildCard('自动落库甲');
const before = libFiles().length;
const r1 = await call('cc_validate', {});
check('① 校验通过且自动落库（savedToLibrary.auto=true）',
  r1.valid === true && !!r1.savedToLibrary && r1.savedToLibrary.auto === true,
  JSON.stringify(r1.savedToLibrary || null));
check('①b 首次落库是 created，且库目录里多了一份',
  r1.savedToLibrary.action === 'created' && libFiles().length === before + 1,
  `action=${r1.savedToLibrary && r1.savedToLibrary.action} files=${libFiles().length} before=${before}`);
check('①c 回执进了 workflow.next（模型/用户都能看到「已保存」）',
  String((r1.workflow && r1.workflow.next) || '').includes('已自动保存到角色库'),
  String((r1.workflow && r1.workflow.next) || '').slice(0, 80));
check('①d message 里也有「已自动保存」',
  String(r1.message || '').includes('已自动保存'),
  String(r1.message || '').slice(0, 80));

// —— ② 再次通过校验（同一草稿）→ 更新同一张，不新建 ——
const id1 = r1.savedToLibrary.id;
const r2 = await call('cc_validate', {});
check('② 二次校验走 updated 同一张（不产生重复卡）',
  r2.savedToLibrary && r2.savedToLibrary.action === 'updated' && r2.savedToLibrary.id === id1,
  JSON.stringify(r2.savedToLibrary || null));
check('②b 库目录里仍只有一张（before+1）', libFiles().length === before + 1, `files=${libFiles().length}`);

// —— ③ autoSave:false 时只校验、不落库 ——
await call('cc_new_card', { confirm: true });
await buildCard('自动落库乙');
const beforeOff = libFiles().length;
const r3 = await call('cc_validate', { autoSave: false });
check('③ autoSave:false → valid 仍为 true，但不落库',
  r3.valid === true && r3.savedToLibrary === null && libFiles().length === beforeOff,
  `valid=${r3.valid} saved=${JSON.stringify(r3.savedToLibrary)} files=${libFiles().length}`);
check('③b 关闭自动落库时 next 里不再出现「已自动保存」',
  !String((r3.workflow && r3.workflow.next) || '').includes('已自动保存到角色库'),
  String((r3.workflow && r3.workflow.next) || '').slice(0, 60));

// —— ④ 未通过校验时不落库（半成品不该进库）——
await call('cc_new_card', { confirm: true });
await call('cc_patch_character', { name: '半成品' });
const beforeBad = libFiles().length;
const r4 = await call('cc_validate', {});
check('④ valid=false 时不自动落库（库目录不变）',
  r4.valid === false && r4.savedToLibrary === null && libFiles().length === beforeBad,
  `valid=${r4.valid} saved=${JSON.stringify(r4.savedToLibrary)} files=${libFiles().length}`);

rmSync(tmpHome, { recursive: true, force: true });
finish();
