/**
 * 卡组层（0.10.0）**耦合守卫**测试 —— 钉住「一层」这件事本身。
 *
 * 这一层存在的唯一理由：0.9.x 里同一个语义散在多处，于是「改了四个、漏了第五个」连出两轮。
 * 所以本文件不测功能（功能在 group-scope / group-metrics / group-checks / group-consistency 里测），
 * 它测**形状**：口径实现只有一份、读数工具不再自己读盘与求和、新检查项不许绕过注册表。
 *
 * 每条断言失败时都说清「新代码该走哪条路」——守卫的价值在于把下一个人推回正确的路，而不是拦住他。
 *
 * 运行：node tests/group-layer-guard.test.mjs   （全绿退出码 0）
 * 说明：本文件只读源码，不落盘、不需要隔离环境。
 */
import { readFileSync } from 'node:fs';

const HOST = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
const AGENT = readFileSync(new URL('../lib/agent.js', import.meta.url), 'utf8');
const LAYER = readFileSync(new URL('../lib/group-layer.js', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function countIn(src, needle) { return src.split(needle).length - 1; }
/** 去掉整行注释后的代码（注释里可以提到 code —— 那是说明，不是实现）。 */
function codeOnly(src) {
  return src.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
  }).join('\n');
}
const HOST_CODE = codeOnly(HOST), AGENT_CODE = codeOnly(AGENT);

/** 把 lib/agent.js 按 `name: "cc_xxx"` 切成每个工具的源码块（到该工具定义的 `});` 为止）。 */
function toolBlocks(src) {
  const re = /name: "cc_([a-z_]+)",/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ name: 'cc_' + m[1], at: m.index });
  const out = {};
  marks.forEach((mk, i) => {
    const nextMark = (i + 1 < marks.length) ? marks[i + 1].at : src.length;
    // ⚠️ 必须以本工具自己的 `\n  });` 收尾：最后一个工具（cc_validate）后面还有一大堆函数定义，
    // 不切边界的话「工具块里不许出现 readBookRaw」会对文件尾部误报。
    const end = src.indexOf('\n  });', mk.at);
    out[mk.name] = src.slice(mk.at, (end >= 0 && end < nextMark) ? end : nextMark);
  });
  return out;
}
const BLOCKS = toolBlocks(AGENT);

// ———————————————— ① 口径实现只有一份（在 lib/group-layer.js） ————————————————
const LAYER_ONLY = [
  'function lorebookMetrics(', 'function groupMetrics(', 'function auditLoreEntries(',
  'function worstCaseTrigger(', 'function scanSharedEntries(', 'function isAutoEntry(',
  'function looksLikeLegacyAuto(', 'function contentKeyOf(', 'function estimateTokens(',
  'function duplicateKeyGroups(', 'function worldDriftOf(', 'function assembleScope(',
  'const REL_TYPES =', 'const REL_TYPE_LABELS =', 'const REL_BEGIN =', 'const REL_END =',
  'const AUTO_NAMES =', 'const WORLD_DIMS =', 'const GROUP_CHECKS =', 'function runGroupChecks(',
];
const leaked = LAYER_ONLY.filter(d => HOST.indexOf(d) >= 0 || AGENT.indexOf(d) >= 0);
check('① 口径类函数 / 常量只在 lib/group-layer.js 定义（两半里再抄一份 = 回到「改了四个、漏了第五个」）',
  leaked.length === 0, JSON.stringify(leaked));
check('①b 反向自检：卡组层里确实有这些实现（避免「文件被删所以两半 0 次」的假绿）',
  LAYER_ONLY.every(d => LAYER.indexOf(d) >= 0),
  JSON.stringify(LAYER_ONLY.filter(d => LAYER.indexOf(d) < 0)));
check('①c 检查项的 code 只写在卡组层（工具里出现 = 有人绕过注册表自己拼清单）',
  ['cross-card-duplicate-keys', 'book-duplicate-in-card', 'card-auto-only', 'world-drift',
    'dangling-edge', 'unrendered', 'constant-budget'].every(c => HOST_CODE.indexOf(c) < 0 && AGENT_CODE.indexOf(c) < 0),
  '新检查项请加进 GROUP_CHECKS（lib/group-layer.js），别在工具里 issues.push');

// ———————————————— ② checkGroup 只是薄包装 ————————————————
check('② 两半各只有一个 checkGroup（薄包装），实现走 runGroupChecks',
  countIn(HOST_CODE, 'function checkGroup(') === 1 && countIn(AGENT_CODE, 'function checkGroup(') === 1
    && countIn(HOST_CODE, 'runGroupChecks({') === 1 && countIn(AGENT_CODE, 'runGroupChecks({') === 1,
  JSON.stringify({ hostDef: countIn(HOST_CODE, 'function checkGroup('), agentDef: countIn(AGENT_CODE, 'function checkGroup('),
    hostCall: countIn(HOST_CODE, 'runGroupChecks({'), agentCall: countIn(AGENT_CODE, 'runGroupChecks({') }));
{
  // 薄包装 = 函数体里只有一次 runGroupChecks 调用（不再有 if 序列）
  const bodyOf = (src) => {
    const i = src.indexOf('function checkGroup(');
    return src.slice(i, src.indexOf('\n}', i) + 2);
  };
  const hb = bodyOf(HOST), ab = bodyOf(AGENT);
  check('②b checkGroup 的函数体不超过 8 行（它以前是 48 行 if 序列 —— 那些判定现在都在注册表里）',
    hb.split('\n').length <= 8 && ab.split('\n').length <= 8,
    JSON.stringify({ host: hb.split('\n').length, agent: ab.split('\n').length }));
}

// ———————————————— ③ 读数工具不再自己读盘 ————————————————
// 判据：这几个工具里不许再出现「自己去读组 / 读书 / 按 meta.groupId 扫库」——
// 那是 groupScope 的活。允许出现的是**卡组层与数据层的既有函数**（scanSharedEntries 在卡组层、
// bookCardsFor/libraryCardsFor 已统一吃卡库快照）：调用它们是「用一层」，不是「复制一层」；
// 区分二者的判据是「口径实现有几份」（守卫 ①）而不是「有没有调用」。
const READERS = ['cc_simulate_trigger', 'cc_lint_lorebook', 'cc_preview_export', 'cc_validate', 'cc_get_shared_book'];
const FORBIDDEN_IN_READERS = ['readBookRaw(', 'normalizeBook(', 'groupMemberIds('];
const hits = [];
READERS.forEach(name => {
  const body = BLOCKS[name] || '';
  FORBIDDEN_IN_READERS.forEach(bad => { if (body.indexOf(bad) >= 0) hits.push(name + ' → ' + bad); });
});
check('③ 五个读数工具里不再自己读组 / 读书（作用域一律来自 groupScope）',
  hits.length === 0, JSON.stringify(hits));
check('③b 数据层函数（libraryCardsFor / bookCardsFor）在两半各只有一份定义，且都吃卡库快照',
  countIn(AGENT, 'async function libraryCardsFor(') === 1 && countIn(HOST, 'async function libraryCardsFor(') === 1
    && countIn(AGENT, 'async function bookCardsFor(') === 1 && countIn(HOST, 'async function bookCardsFor(') === 1
    && countIn(AGENT, 'readLibrarySnapshot()') >= 2 && countIn(HOST, 'readLibrarySnapshot()') >= 2,
  '');
check('③c cc_group_check 也不再自己读书（成员摘要除外 —— 关系段检查要 description）',
  (BLOCKS['cc_group_check'] || '').indexOf('readBookRaw(') < 0 && (BLOCKS['cc_group_check'] || '').indexOf('normalizeBook(') < 0,
  '');
check('③d 新功能没有污染既有工具：跨卡一致性的检查项不出现在四个读数工具里',
  READERS.every(name => (BLOCKS[name] || '').indexOf('cross-card') < 0),
  JSON.stringify(READERS.filter(name => (BLOCKS[name] || '').indexOf('cross-card') >= 0)));

// ———————————————— ④ 数字只有一个来源 ————————————————
{
  // groupMetrics / lorebookMetrics 是唯一的求和入口：工具里不许再出现"遍历 shared 求和"的写法
  const suspicious = [];
  READERS.concat(['cc_group_check', 'cc_get_card']).forEach(name => {
    const body = BLOCKS[name] || '';
    // 允许：对"命中集合"求 token（simulate 的 hits）、对书自身求 token（patch_book_meta）
    if (/shared[^\n]*\.reduce\(/.test(body) && body.indexOf('lorebookMetrics(') < 0 && body.indexOf('groupMetrics(') < 0) {
      suspicious.push(name);
    }
  });
  check('④ 读数工具里不再自己 for/reduce 求和（分段统计只有 groupMetrics / lorebookMetrics 一处）',
    suspicious.length === 0, JSON.stringify(suspicious));
}
check('④b 体检的预算数字来自 metrics.derived.groupConstant（工具传 metrics，工具自己不算）',
  (BLOCKS['cc_group_check'] || '').indexOf('groupMetrics(') >= 0
    && (BLOCKS['cc_group_check'] || '').indexOf('metrics: metrics') >= 0,
  '');
check('④c 跨卡检查的数据入口是 scope（成员条目与五维），不是 cards 摘要',
  (BLOCKS['cc_group_check'] || '').indexOf('scope: scope') >= 0, '');

// ———————————————— ⑤ 客户端只显示、不统计 ————————————————
check('⑤ 客户端不 import / 不重复实现卡组口径（它只能显示宿主返回的 issues / byCheck）',
  ['lorebookMetrics', 'groupMetrics', 'runGroupChecks', 'assembleScope', 'duplicateKeyGroups', 'worldDriftOf']
    .every(k => CLIENT.indexOf(k) < 0),
  '');
check('⑤b 客户端渲染体检清单只读 check / level / message 三个字段（统计留给卡组层与宿主）',
  CLIENT.indexOf('relIssues') >= 0 && CLIENT.indexOf('i.check') >= 0 && CLIENT.indexOf('i.level') >= 0,
  '');

// ———————————————— ⑥ 检查注册表的形状 ————————————————
{
  const codes = [...LAYER.matchAll(/codes: \[([^\]]*)\]/g)].map(m => m[1]);
  check('⑥ 注册表里的类别都用 codes 数组声明（byCheck 才能按类计数）', codes.length >= 5, JSON.stringify(codes.length));
  check('⑥b 每个 code 只属于一个类别（同一个 code 出现在两处 = byCheck 会算两次）',
    (() => {
      const all = codes.join(',').split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
      return new Set(all).size === all.length;
    })(), '');
}

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  ' + (r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 180)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length === 0 ? 0 : 1);
