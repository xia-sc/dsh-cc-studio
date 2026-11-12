/**
 * 未结案钩子检测回归测试（0.21.0，不随插件发布）。
 *
 * 背景：SillyTavern 里小模型常揪住「一碗粥」不放 —— 只要它在首条消息里是**未完成状态**
 * （粥还热着 / 汤在炉上煨着 / 手机没关），模型就会把它当成本轮待办，之后每轮回收一次、
 * 每轮自我强化。
 * 本版只做「制卡期可计算的那一半」：扫开场三处，提示作者在首条消息里结案。
 * 不做运行期规则注入（那是后续版本的事，且会增加每轮 token）。
 *
 * 运行：node tests/hygiene.test.mjs
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录（见 AGENTS.md）。
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-hygiene-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import('../lib/agent.js');
const cons = await import('../lib/consistency.js');

const results = [];
function check(name, pass, detail){ results.push({ name, pass: !!pass, detail }); }
const H = (data) => cons.auditOpeningHooks({ spec: 'chara_card_v3', spec_version: '3.0', data });

// ── ① 核心判定：未结案 vs 已结案 vs 无关 ────────────────────────
{
  const a = H({ first_mes: '桌上那碗粥还热着。' });
  check('①a 「桌上那碗粥还热着」→ 命中（食物 + 持续状态）',
    a.count === 1 && /粥/.test(a.hits[0].text), JSON.stringify(a.hits));
  const b = H({ first_mes: '粥已经倒了。' });
  check('①b 「粥已经倒了」→ 不命中（有结案标记）', b.count === 0, JSON.stringify(b.hits));
  const c = H({ first_mes: '他喝了一口粥，继续往下走。' });
  check('①c 「他喝了一口粥」→ 不命中（没有未完成状态）', c.count === 0, JSON.stringify(c.hits));
  const d = H({ first_mes: '灯还亮着，手机没关。' });
  check('①d 通用规则：「灯还亮着」+「手机没关」→ 两条',
    d.count === 2, JSON.stringify(d.hits));
}

// ── ② 误报收窄：容易撞上的日常表达不能报 ────────────────────────
{
  const cases = [
    ['没关系，我不介意。', '「没关系」不该被当成「没关」'],
    ['没收作案工具是惯例。', '「没收」不该被当成「没收好」'],
    ['他一直低着头。', '「一直」不是未完成状态'],
  ];
  cases.forEach(([text, why]) => {
    const r = H({ first_mes: text });
    check('② ' + why, r.count === 0, JSON.stringify(r.hits));
  });
}

// ── ③ 结案窗口：同一句或后一句结案都算 ──────────────────────────
{
  const same = H({ first_mes: '粥还热着，她端起来喝完了。' });
  check('③a 同一句里结案 → 不报', same.count === 0, JSON.stringify(same.hits));
  const next = H({ first_mes: '粥还热着。她端起来喝完了，把碗放回桌上。' });
  check('③b 后一句结案 → 不报（窗口 = 该句 + 后一句）', next.count === 0, JSON.stringify(next.hits));
  const noClose = H({ first_mes: '粥还热着。她没管它，转身走了。' });
  check('③c 后一句没结案 → 仍然报（它确实没结束）', noClose.count === 1, JSON.stringify(noClose.hits));
}

// ── ④ 扫描范围：开场三处扫，mes_example / scenario 不扫 ──────────
{
  const alt = H({ alternate_greetings: ['一', '手机还亮着。'] });
  check('④a alternate_greetings 被扫且标注来源',
    alt.count === 1 && /alternate_greetings\[1\]/.test(alt.hits[0].where), JSON.stringify(alt.hits));
  const grp = H({ group_only_greetings: ['群聊里，汤还在炉上煨着。'] });
  check('④b group_only_greetings 被扫', grp.count === 1, JSON.stringify(grp.hits));
  const ex = H({ mes_example: '{{char}}: 粥还热着，你喝吧。' });
  check('④c mes_example 不扫（few-shot 示例不是当前场景状态）', ex.count === 0, JSON.stringify(ex.hits));
  const sc = H({ scenario: '厨房的炉上煨着汤，餐桌上摆着粥。' });
  check('④d scenario 不扫（设定文档，静态物品多、误报高）', sc.count === 0, JSON.stringify(sc.hits));
}

// ── ⑤ 汇总：多钩子合并成一条，样本 ≤5 ───────────────────────────
{
  const many = H({ first_mes: '粥还热着。灯还亮着。手机没关。汤在炉上煨着。饭还热着。茶还热着。菜还热着。' });
  check('⑤a 多条钩子全部计数（count 是真实命中数）', many.count === 7, String(many.count));
  check('⑤b 样本最多 5 个（不刷屏）', many.hits.length === 5, String(many.hits.length));
  check('⑤c 只产出一条汇总文案', /检测到 7 处/.test(many.message) && /消法/.test(many.message), many.message.slice(0, 60));
}

// ── ⑥ 空卡 / 无开场：零 issue、空文案 ───────────────────────────
{
  const empty = H({});
  check('⑥a 空卡 → count 0 且 message 为空串',
    empty.count === 0 && empty.message === '', JSON.stringify(empty));
  const blank = H({ first_mes: '   ', alternate_greetings: [''] });
  check('⑥b 全空白开场 → 不报（squeeze 后为空）', blank.count === 0, JSON.stringify(blank));
}

// ── ⑦ 工具链：不阻塞 valid，且并入 consistency.issues ────────────
const tools = new Map();
mod.apply({ get(){ return null; }, tools: { register(def){ tools.set(def.name, def); } } });
const exec = { agent: { session: { id: 'session-hygiene' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);
{
  await call('cc_new_card', { confirm: true });
  await call('cc_patch_character', { name: '钩子卡', description: '一个在深夜厨房里等人的人。', personality: '安静', scenario: '深夜的厨房' });
  await call('cc_patch_world', { timeline: '十年前那场大火之后，学校再没招过新生。', factions: '夜巡与学生会', geo: '旧校舍、广播室、天台' });
  await call('cc_add_lorebook_entries', { entries: [
    { name: '罐底的字', keys: ['红豆奶', '罐底'], content: '@@depth 4\n罐底有一行被刮掉的字。' },
    { name: '西侧楼梯', keys: ['西侧楼梯'], content: '@@depth 4\n西侧楼梯的灯总是坏。' },
    { name: '广播室', keys: ['广播室'], content: '@@depth 4\n广播室的麦克风永远开着。' },
    { name: '天台', keys: ['天台'], content: '@@depth 4\n天台风很大。' },
    { name: '校医室', keys: ['校医室'], content: '@@depth 4\n校医室的门锁着。' },
  ] });
  await call('cc_patch_greetings', {
    first_mes: '[时间：2026-11-09 08:00]\n桌上那碗粥还热着，她没动。',
    alternate_greetings: ['[时间：2026-11-09 08:00]\n一', '[时间：2026-11-09 08:00]\n二'],
    group_only_greetings: ['[时间：2026-11-09 08:00]\n群聊'],
  });
  const r = await call('cc_validate');
  check('⑦a 命中钩子时 valid 仍为 true（warning 不阻塞）', r.valid === true, JSON.stringify(r.errors));
  check('⑦b warnings 里有「未结案钩子」且给出消法',
    (r.warnings || []).some(w => /未结案钩子/.test(String(w)) && /消法/.test(String(w))),
    JSON.stringify((r.warnings || []).filter(w => /未结案钩子/.test(String(w))).map(w => String(w).slice(0, 40))));
  const issue = (r.consistency && r.consistency.issues || []).find(i => i.code === 'unsettled-hook');
  check('⑦c consistency.issues 里带 unsettled-hook + warning + refs（工坊「校验」据此渲染）',
    !!issue && issue.level === 'warning' && Array.isArray(issue.refs) && issue.refs.length > 0,
    JSON.stringify(issue && { level: issue.level, refs: issue.refs }));
  check('⑦d 钩子不影响 canon 的状态（两条独立）',
    !!r.canon && r.canon.count > 0, JSON.stringify(r.canon && r.canon.count));

  // 结案后应消失
  await call('cc_patch_greetings', { first_mes: '[时间：2026-11-09 08:00]\n桌上那碗粥已经倒了。' });
  const r2 = await call('cc_validate');
  check('⑦e 开场改成已结案后 warning 消失',
    !(r2.warnings || []).some(w => /未结案钩子/.test(String(w))), '');
}

// ── ⑧ 宿主 validateCard 同样接入（源码守卫：不启动 dsh） ────────
{
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  check('⑧a 宿主 validateCard 调用 auditOpeningHooks（工坊「校验」能看到）',
    /auditOpeningHooks\(card\)/.test(src), '');
  check('⑧b 宿主返回里带 unsettled-hook 这条 issue',
    /unsettled-hook/.test(src), '');
}

// ── ⑨ 与时间锚定 / canon 共存不互相干扰 ─────────────────────────
{
  const card = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: '共存卡', description: 'd', personality: 'p', scenario: 's',
      first_mes: '[时间：2026-11-09 08:00]\n粥还热着。',
      system_prompt: mod.TIME_SYSTEM_PROMPT, post_history_instructions: mod.TIME_POST_HISTORY,
      alternate_greetings: [], group_only_greetings: [],
      extensions: { depth_prompt: { prompt: mod.TIME_DEPTH_PROMPT, depth: 4, role: 'system' },
        cc_canon: { rules: [{ subject: '粥', fact: '已经倒了' }], source: 'model', at: 1 } },
      character_book: { name: 'b', description: 'd', entries: [] },
    },
  };
  const hooks = cons.auditOpeningHooks(card);
  check('⑨a 卡里有 canon 时钩子检测照常工作', hooks.count === 1, JSON.stringify(hooks.hits));
  check('⑨b 钩子检测不改卡（纯函数、无副作用）',
    JSON.stringify(card.data.extensions.cc_canon.rules) === JSON.stringify([{ subject: '粥', fact: '已经倒了' }]), '');
}

// ── 汇总 ──────────────────────────────────────────────────────
const failed = results.filter(r => !r.pass);
for (const r of results) if (!r.pass) console.log('FAIL  ' + r.name + '  — ' + (r.detail || ''));
console.log('\n' + results.length + '/' + results.length + ' passed' + (failed.length ? ' (' + failed.length + ' failed)' : ''));
console.log(results.length + ' checks, ' + failed.length + ' failed');
try{ rmSync(tmpHome, { recursive: true, force: true }); }catch{}
process.exit(failed.length ? 1 : 0);
