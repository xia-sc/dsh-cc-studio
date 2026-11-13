/**
 * persona 预算回归测试（ROADMAP 4.2）。
 *
 * 背景：`presets/cc.patch.yml` 的 persona 是 `prefix`，**每一轮**都在 system prompt 里
 * （不是首轮一次）。0.24.1 时实测 2634 字符（CJK 954 / ASCII 1476），其中「时间锚定」
 * 语义出现 3 处、`cc_release_draft` 2 处、`cc_validate` 5 处，另有一整段把 11 个工具名
 * 又抄了一遍（工具 description 本来就有）。规则互相稀释、弱模型尤其明显。
 *
 * 本测试做三件事，都是机械可检的：
 *   ① 预算棘轮：persona 字符数 ≤ 上限，防止半年后又涨回去；
 *   ② 规则不重复：几个高频规则的出现次数有上限（不是「越少越好」，是「别抄第二遍」）；
 *   ③ 必留锚点：AGENTS §3.2 要求 persona 里必须有的引导（JSON 卫生 / release 收口 /
 *      canon + canonDigest / 时间锚定三件套 / 六步顺序）一条都不能被删。
 *
 * 不做的事：**不假装能自动评测行为**。persona 改了要人工跑固定 3 场景
 * （新卡 / 改卡 / 交付收口）看工具调用序列，见 ROADMAP 4.2。
 *
 * 运行：node tests/persona-budget.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const patchText = readFileSync(new URL('../presets/cc.patch.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = patchText.split('\n');

// 取 `- id: X` 那一个整块（含其后缩进更深的行，遇到同级或更浅的缩进行即结束）
function blockOf(id) {
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
}

import { check, finish } from './harness.mjs';

// persona 正文 = `prefix: |` 之后的行，去掉空行与缩进来的注释，再剥掉公共缩进
const block = blockOf('persona');
check('presets/cc.patch.yml 里有 persona 块', block !== '', block === '' ? 'block is empty' : '');

const prefixAt = block.split('\n').findIndex((l) => /^\s*prefix:\s*\|/.test(l));
check('persona 用 prefix 块标量（不是旧 text 键）', prefixAt >= 0, `prefixAt=${prefixAt}`);

const bodyLines = block.split('\n').slice(prefixAt + 1)
  .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
const indent = bodyLines.length ? Math.min(...bodyLines.map((l) => l.search(/\S/))) : 0;
const persona = bodyLines.map((l) => l.slice(indent)).join('\n').trim();

const count = (needle) => persona.split(needle).length - 1;

// —— ① 预算棘轮 ——
// 上限取整不取精确值：它是防止再涨的闸门，不是「这就是最优长度」。
// 改 persona 先跑本测试；确实需要涨，就同步抬上限并在 CHANGELOG 写清为什么。
const PERSONA_MAX_CHARS = 2200;
check(`persona 字符数 ≤ ${PERSONA_MAX_CHARS}（当前 ${persona.length}）`,
  persona.length > 0 && persona.length <= PERSONA_MAX_CHARS, `${persona.length} 字符`);

// —— ② 规则不重复 ——
// 时间锚定只留执行点（第 2 步）+ 规则段一句「三件套」，不再逐段复述；
// cc_validate 只在第 6 步、规则段、以及 canon 参数示例里出现；
// cc_release_draft 必须两处（第 6 步执行点 + 规则段收口强调），但不能更多。
check('「时间锚定」只出现 1 次（不再逐段复述）', count('时间锚定') <= 1, `${count('时间锚定')} 次`);
check('cc_validate 出现 ≤ 3 次', count('cc_validate') <= 3, `${count('cc_validate')} 次`);
check('cc_release_draft 出现 2 次（执行点 + 收口强调）',
  count('cc_release_draft') === 2, `${count('cc_release_draft')} 次`);
check('persona 里的 cc_* 工具名 ≤ 10 个（不许再抄整段工具清单）',
  new Set(persona.match(/cc_[a-z_]+/g) || []).size <= 10,
  [...new Set(persona.match(/cc_[a-z_]+/g) || [])].join(', '));

// —— ③ 必留锚点（删掉任何一条都是行为回退，测试要红）——
const ANCHORS = [
  ['{{model}}', 'persona 仍介绍模型'],
  ['spec: chara_card_v3', '仍声明 CCv3 目标格式'],
  ['工具参数必须是严格合法的 JSON', 'JSON 卫生规则（0.10.2 事故）'],
  ['cc_release_draft', '草稿锁交还（0.11.0 事故）'],
  ['「设定铁律」canon', '交付前给 canon（0.19.0）'],
  ['cc_validate({canon', 'canon 走 cc_validate 参数'],
  ['canonDigest', '写前先对账（先看再写）'],
  ['first_mes 的 [时间：', '时间锚定三件套含 first_mes 时间戳'],
  ['workflow.next', '只认工具返回的 workflow.next'],
];
for (const [needle, why] of ANCHORS) {
  check(`必留锚点：${why}`, persona.includes(needle), needle);
}

// —— ④ 六步顺序（顺序本身就是契约，模型照抄）——
const STEPS = ['cc_get_card', 'cc_patch_character', 'cc_patch_world', 'cc_add_lorebook_entries', 'cc_patch_greetings', 'cc_validate'];
const stepPos = STEPS.map((s, i) => persona.indexOf(`${i + 1}) ${s}`));
check('六步工作流按 1)…6) 顺序出现',
  stepPos.every((p) => p >= 0) && stepPos.every((p, i) => i === 0 || p > stepPos[i - 1]),
  stepPos.join(','));
check('第 2 步要求先问起始时间再照抄时间模板',
  persona.includes('先问故事起始时间') && persona.includes('照抄工具参数说明里的 system_prompt'), '');
check('第 6 步包含 cc_release_draft 引导', /6\) cc_validate[^\n]*cc_release_draft/.test(persona), '');

finish();
