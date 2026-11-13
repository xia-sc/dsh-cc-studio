/**
 * 时间锚定回归测试（0.16.0，不随插件发布）。
 *
 * 背景：LLM 写卡时不带时间观念，上一段还是早晨、下一段就把事情推到晚上。
 * 方案：CC 模式强制给卡写 system_prompt（时间规则）与 post_history_instructions（生成前自检），
 * 并让 first_mes 以 `[时间：YYYY-MM-DD HH:MM]` 开头。ST 里这两个字段默认生效
 * （prefer_character_prompt / prefer_character_jailbreak 默认开，分别替换 main 与 jailbreak）。
 *
 * 运行：node tests/time-anchor.test.mjs
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录（见 AGENTS.md）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'cc-time-anchor-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import('../lib/agent.js');
const compat = await import('../lib/compat/index.js');

import { check, finish } from './harness.mjs';

const tools = new Map();
mod.apply({ get(){ return null; }, tools: { register(def){ tools.set(def.name, def); } } });
const exec = { agent: { session: { id: 'session-time-anchor' } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

// ── ① 模板常量 ────────────────────────────────────────────────
{
  check('①a 时间锚点正则：接受 [时间：YYYY-MM-DD HH:MM]',
    mod.TIME_ANCHOR_RE.test('[时间：2026-11-09 08:00]'), '');
  check('①b 时间锚点正则：缺时刻 / 缺日期都不匹配',
    !mod.TIME_ANCHOR_RE.test('[时间：2026-11-09]') && !mod.TIME_ANCHOR_RE.test('[时间：08:00]'), '');
  check('①c system_prompt 模板含规则、ST 宏与格式说明',
    /\[时间：/.test(mod.TIME_SYSTEM_PROMPT)
    && mod.TIME_SYSTEM_PROMPT.includes('{{char}}') && mod.TIME_SYSTEM_PROMPT.includes('{{user}}')
    && /不得无过渡跳时段/.test(mod.TIME_SYSTEM_PROMPT),
    mod.TIME_SYSTEM_PROMPT.slice(0, 60));
  check('①d post_history 模板含生成前自检与格式要求',
    /自检/.test(mod.TIME_POST_HISTORY) && /\[时间：/.test(mod.TIME_POST_HISTORY)
    && /只能向前/.test(mod.TIME_POST_HISTORY),
    mod.TIME_POST_HISTORY.slice(0, 60));
  // A+（0.18.0-alpha.2）：宽松锚点 + 双轨
  check('①e 宽松锚点正则：接受自定义纪年（架空历法）',
    mod.TIME_ANCHOR_ANY_RE.test('[时间：天启三年九月十二 辰时]')
    && mod.TIME_ANCHOR_ANY_RE.test('[时间：星历 3042 年·第二周期]'), '');
  check('①f 宽松锚点正则：拒绝空内容 / 无闭合 / 超长',
    !mod.TIME_ANCHOR_ANY_RE.test('[时间：]')
    && !mod.TIME_ANCHOR_ANY_RE.test('[时间：天启三年')
    && !mod.TIME_ANCHOR_ANY_RE.test('[时间：' + 'x'.repeat(81) + ']'), '');
  check('①g 三份模板都写了双轨写法（ISO 前缀 + 自定义纪年）',
    /双轨/.test(mod.TIME_SYSTEM_PROMPT) && /双轨/.test(mod.TIME_POST_HISTORY)
    && /双轨/.test(mod.TIME_DEPTH_PROMPT) && /双轨/.test(mod.TIME_LORE_PROMPT), '');
}

// ── ② 自动写入：模型漏写时工具兜底 ─────────────────────────────
{
  await call('cc_new_card', { confirm: true });
  const r = await call('cc_patch_character', { name: '时间卡', description: '描述', personality: '冷静', scenario: '教室' });
  check('②a 首次 cc_patch_character 自动写入 system_prompt / post_history_instructions',
    r.changed.indexOf('system_prompt') >= 0 && r.changed.indexOf('post_history_instructions') >= 0,
    JSON.stringify(r.changed));
  const card = (await call('cc_get_card')).draft;
  check('②b 自动写入的内容就是模板（不是空串）',
    card.data.system_prompt === mod.TIME_SYSTEM_PROMPT
    && card.data.post_history_instructions === mod.TIME_POST_HISTORY,
    '');
  const r2 = await call('cc_patch_character', { nickname: '昵称' });
  check('②c 已有模板时不重复写、changed 只记真改动',
    r2.changed.indexOf('system_prompt') < 0 && r2.changed.indexOf('post_history_instructions') < 0,
    JSON.stringify(r2.changed));
  const r3 = await call('cc_patch_character', { system_prompt: '自定义时间规则 [时间：YYYY-MM-DD HH:MM]' });
  check('②d 显式传 system_prompt 时以调用方为准（不覆盖成模板）',
    (await call('cc_get_card')).draft.data.system_prompt === '自定义时间规则 [时间：YYYY-MM-DD HH:MM]',
    JSON.stringify(r3.changed));
  // 恢复模板，后续用例用标准卡
  await call('cc_patch_character', { system_prompt: mod.TIME_SYSTEM_PROMPT });
  const dp = (await call('cc_get_card')).draft.data.extensions.depth_prompt;
  check('②e 自动写入 Character\'s Note（depth_prompt）：形状 prompt/depth/role 正确',
    !!dp && dp.prompt === mod.TIME_DEPTH_PROMPT && dp.depth === 4 && dp.role === 'system',
    JSON.stringify(dp && { depth: dp.depth, role: dp.role }));
  await call('cc_patch_character', { depthPrompt: '自定义深度提示 [时间：YYYY-MM-DD HH:MM]' });
  check('②f 显式 depthPrompt 覆盖自动模板',
    (await call('cc_get_card')).draft.data.extensions.depth_prompt.prompt === '自定义深度提示 [时间：YYYY-MM-DD HH:MM]', '');
  await call('cc_patch_character', { depthPrompt: '' });
  check('②g depthPrompt 传空串可清空（不再强行写回模板）',
    !(await call('cc_get_card')).draft.data.extensions.depth_prompt, '');
  await call('cc_patch_character', { timeVariable: true });
  const withVar = (await call('cc_get_card')).draft.data;
  check('②h timeVariable:true 时 system_prompt 与 depth_prompt 都追加 {{getvar::cc_story_time}}',
    withVar.system_prompt.includes('{{getvar::cc_story_time}}')
    && String(withVar.extensions.depth_prompt && withVar.extensions.depth_prompt.prompt).includes('{{getvar::cc_story_time}}'),
    JSON.stringify({ sys: withVar.system_prompt.includes('{{getvar::cc_story_time}}') }));
  check('②i 默认（不传 timeVariable）不含变量占位',
    !mod.TIME_SYSTEM_PROMPT.includes('{{getvar::cc_story_time}}') && !mod.TIME_DEPTH_PROMPT.includes('{{getvar::cc_story_time}}'), '');
  // 恢复成默认模板 + 默认 depth_prompt，后续 validate 用例按标准卡走
  await call('cc_patch_character', { system_prompt: mod.TIME_SYSTEM_PROMPT, depthPrompt: mod.TIME_DEPTH_PROMPT });
}

// ── ③ first_mes 时间锚：startTime 自动补前缀 ────────────────────
{
  await call('cc_patch_greetings', { first_mes: '开场白。', alternate_greetings: ['一', '二'], group_only_greetings: ['群聊'] });
  let card = (await call('cc_get_card')).draft;
  check('③a 没有时间锚点的 first_mes 会被 validate 拦下（还没补）',
    !mod.TIME_ANCHOR_RE.test(card.data.first_mes), String(card.data.first_mes).slice(0, 20));
  await call('cc_patch_greetings', { startTime: '2026-11-09 08:00' });
  card = (await call('cc_get_card')).draft;
  check('③b startTime 自动补 [时间：…] 前缀', card.data.first_mes.indexOf('[时间：2026-11-09 08:00]') === 0,
    String(card.data.first_mes).slice(0, 40));
  await call('cc_patch_greetings', { startTime: '2026-11-09 09:00' });
  card = (await call('cc_get_card')).draft;
  check('③c 已有锚点时不重复加前缀（第二次 startTime 不生效）',
    (card.data.first_mes.match(/\[时间：/g) || []).length === 1, String(card.data.first_mes).slice(0, 40));
  // A+：任意纪年锚点
  await call('cc_patch_greetings', { first_mes: '架空开场。' });
  const rAnchor = await call('cc_patch_greetings', { startAnchor: '天启三年九月十二 辰时' });
  card = (await call('cc_get_card')).draft;
  check('③d startAnchor 支持自定义纪年：自动补 [时间：天启三年九月十二 辰时]',
    card.data.first_mes.indexOf('[时间：天启三年九月十二 辰时]') === 0
    && rAnchor.greetings.timeAnchored === true && rAnchor.greetings.timeAnchoredISO === false,
    String(card.data.first_mes).slice(0, 40));
}

// ── ④ validate：缺时间锚定不通过，补齐后通过 ────────────────────
{
  // 用盘上改写模拟「旧卡没有时间锚定」
  await call('cc_patch_world', {
    timeline: '十年前那场大火之后，学校就没有再招过新生。',
    factions: '夜巡与学生会', geo: '旧校舍、广播室、天台',
    power: '遗忘会沉淀为异常', daily: '晚自习后走廊很安静',
    timeLore: true,
  });
  const lore = (await call('cc_get_card')).draft.data.character_book.entries.filter(e => e && e.name === '时间锚定')[0];
  check('④c timeLore:true 生成 constant 的「时间锚定」条目（带 @@ 装饰器）',
    !!lore && lore.constant === true && String(lore.content).indexOf('@@position') === 0,
    lore ? String(lore.content).slice(0, 30) : 'missing');
  await call('cc_patch_world', { timeline: '十年前那场大火之后，学校就没有再招过新生。', timeLore: false });
  check('④d timeLore:false 不生成条目（也不重复添加）',
    (await call('cc_get_card')).draft.data.character_book.entries.filter(e => e && e.name === '时间锚定').length === 1, '');
  await call('cc_add_lorebook_entries', { entries: [
    { name: '罐底的字', keys: ['红豆奶', '罐底'], content: '@@depth 4\n罐底有一行被刮掉的字。' },
    { name: '西侧楼梯', keys: ['西侧楼梯'], content: '@@depth 4\n西侧楼梯的灯总是坏。' },
    { name: '广播室', keys: ['广播室'], content: '@@depth 4\n广播室的麦克风永远开着。' },
    { name: '天台', keys: ['天台'], content: '@@depth 4\n天台风很大。' },
  ] });
  const ok = await call('cc_validate');
  check('④a 时间锚定齐全 + 其它必填齐 → valid=true',
    ok.valid === true, JSON.stringify(ok.errors));
  check('④b validate 给出「system_prompt 会替换 ST Main Prompt」的提示',
    (ok.warnings || []).some(w => /Main Prompt/.test(String(w))),
    JSON.stringify((ok.warnings || []).map(w => String(w).slice(0, 30))));
  check('④e validate 说明「时间锚定」条目在 ST 里要手动 Import Card Lore（卡内书不会被自动转成世界书）',
    (ok.warnings || []).some(w => /Import Card Lore/.test(String(w))),
    JSON.stringify((ok.warnings || []).filter(w => /时间锚定/.test(String(w))).map(w => String(w).slice(0, 40))));
  // A+：纯自定义纪年 first_mes 也应通过（只给 ISO 双轨 warning）
  await call('cc_patch_greetings', { first_mes: '[时间：天启三年九月十二 辰时]\n架空开场白。' });
  const okAny = await call('cc_validate');
  check('④f 纯自定义纪年锚点 → valid=true，但 warning 提示补 ISO 双轨前缀',
    okAny.valid === true && (okAny.warnings || []).some(w => /ISO/.test(String(w))),
    JSON.stringify({ valid: okAny.valid, warnings: (okAny.warnings || []).filter(w => /ISO/.test(String(w))).map(w => String(w).slice(0, 40)) }));
}

// ── ⑤ 导出投影保留两个字段（PNG 的 chara 块 / JSON 用同一条投影） ──
{
  const card = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: '投影卡', description: 'd', personality: 'p', scenario: 's',
      first_mes: '[时间：2026-11-09 08:00]\n开场。',
      system_prompt: mod.TIME_SYSTEM_PROMPT, post_history_instructions: mod.TIME_POST_HISTORY,
      extensions: { depth_prompt: { prompt: mod.TIME_DEPTH_PROMPT, depth: 4, role: 'system' } },
    },
  };
  const proj = compat.stV2Projection(card);
  check('⑤ V2 投影（ST 的 chara 块/JSON）保留 system_prompt 与 post_history_instructions',
    proj.data.system_prompt === mod.TIME_SYSTEM_PROMPT
    && proj.data.post_history_instructions === mod.TIME_POST_HISTORY,
    String(proj.data.system_prompt).slice(0, 40));
  check('⑤b V2 投影保留 extensions.depth_prompt（ST 的 Character\'s Note）',
    proj.data.extensions && proj.data.extensions.depth_prompt
    && proj.data.extensions.depth_prompt.prompt === mod.TIME_DEPTH_PROMPT,
    JSON.stringify(proj.data.extensions && proj.data.extensions.depth_prompt));
}

rmSync(tmpHome, { recursive: true, force: true });

finish();
