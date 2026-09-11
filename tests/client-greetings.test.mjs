/**
 * 问候语字段保真回归测试（不随插件发布，files 未包含 tests）。
 *
 * 背景（两段历史）：
 *  1) 0.3.0 移除「点子」页时把 `⛶` 抽成 fieldHead()，数组字段用「每行一条」表示：
 *     `(raw||[]).join('\n')` 配 `String(v).split('\n')` —— 而 `''.split('\n')` 得到 `['']`，
 *     于是空数组往返一趟变成 1 个空问候语。
 *  2) 更根本的问题：**「一条问候语」和「一行文本」被当成同一个东西**。问候语本来就可以是多段文本，
 *     序列化后元素内部的换行会被拆成多条。导入带多段问候语的卡后，在行内 textarea 里敲一个字
 *     就会把 1 条拆成 N 条，而且**能通过 host 校验、静默导出**（host 只检查 Array.isArray）。
 *
 * 现方案：每条问候语一个独立 textarea，**不做任何序列化**，只保留纯数组访问器。
 * 本测试锁住这些不变量，以及「10 条上限」与宿主截断点和已知一致。
 *
 * 运行：node tests/client-greetings.test.mjs   （全绿退出码 0）
 */import { readFileSync } from 'node:fs';

const url = (p) => new URL(p, import.meta.url);
const src = readFileSync(url('../lib/client.js'), 'utf8');
const agentSrc = readFileSync(url('../lib/agent.js'), 'utf8');
const indexSrc = readFileSync(url('../lib/index.js'), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

// 从源码里摘出真实实现执行（client.js 是 window.__ModuleLoader__ 外壳，无法直接 import）
function grabFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到 function ${name}(`);
  let depth = 0;
  const open = source.indexOf('{', start);
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`function ${name} 括号不闭合`);
}
const maxMatch = src.match(/const GREETING_MAX\s*=\s*(\d+)/);
if (!maxMatch) { console.log('FAIL  源码中找不到 GREETING_MAX'); process.exit(1); }
const GREETING_MAX = Number(maxMatch[1]);
const { setGreetingAt, removeGreetingAt, appendGreeting } = new Function(
  `const GREETING_MAX=${GREETING_MAX};` +
  `${grabFunction(src, 'setGreetingAt')}; ${grabFunction(src, 'removeGreetingAt')}; ${grabFunction(src, 'appendGreeting')};` +
  'return { setGreetingAt, removeGreetingAt, appendGreeting };'
)();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// —— 1) 核心回归：多段问候语在编辑后必须仍是「一条」 ——
{
  const arr = ['段一\n段二', 'other'];
  // 模拟用户在「第 1 条」的独立 textarea 里敲了一个字
  const after = setGreetingAt(arr, 0, arr[0] + '。');
  check('多段问候语编辑后仍是 1 条（长度 2 不变）', after.length === 2, JSON.stringify(after));
  check('多段问候语内部换行原样保留', after[0] === '段一\n段二。', JSON.stringify(after[0]));
  // 对照：旧的「每行一条」编码会把它拆成 3 条（仅用于说明旧 bug，不是实现）
  const oldEncoding = String(arr.join('\n')).split('\n');
  check('对照：旧的 join/split 编码确实会拆成 3 条', oldEncoding.length === 3, JSON.stringify(oldEncoding));
  check('新旧行为确有差异（回归有效）', oldEncoding.length !== after.length, `old=${oldEncoding.length} new=${after.length}`);
}

// —— 2) 只改目标索引，其他元素不受影响 ——
{
  const arr = ['a', 'b', 'c'];
  const after = setGreetingAt(arr, 1, 'B');
  check('只替换目标索引', after[1] === 'B' && after[0] === 'a' && after[2] === 'c', JSON.stringify(after));
}

// —— 3) 纯函数：不得就地改写传入数组（updateDraft 靠深拷贝，这里额外兜底） ——
{
  const arr = ['a', 'b'];
  setGreetingAt(arr, 0, 'X');
  removeGreetingAt(arr, 0);
  appendGreeting(arr);
  check('访问器不改写入参数组', eq(arr, ['a', 'b']), JSON.stringify(arr));
}

// —— 4) 越界索引必须是 no-op（大框「取消」的回滚路径会用到） ——
{
  const arr = ['a', 'b'];
  check('setGreetingAt 越界 no-op', eq(setGreetingAt(arr, 9, 'X'), arr), JSON.stringify(setGreetingAt(arr, 9, 'X')));
  check('setGreetingAt 负索引 no-op', eq(setGreetingAt(arr, -1, 'X'), arr), JSON.stringify(setGreetingAt(arr, -1, 'X')));
  check('removeGreetingAt 越界 no-op', eq(removeGreetingAt(arr, 9), arr), JSON.stringify(removeGreetingAt(arr, 9)));
  check('非数组入参安全', eq(setGreetingAt(undefined, 0, 'X'), []) && eq(removeGreetingAt(null, 0), []) && eq(appendGreeting(undefined), ['']), '');
}

// —— 5) 删除 / 新增 ——
{
  check('删除中间一条', eq(removeGreetingAt(['a', 'b', 'c'], 1), ['a', 'c']), JSON.stringify(removeGreetingAt(['a', 'b', 'c'], 1)));
  check('删除唯一一条 → 空数组', eq(removeGreetingAt(['a'], 0), []), JSON.stringify(removeGreetingAt(['a'], 0)));
  check('新增一条（空串，用户显式动作）', eq(appendGreeting(['a']), ['a', '']), JSON.stringify(appendGreeting(['a'])));
  check('空数组新增 → 1 条空串', eq(appendGreeting([]), ['']), JSON.stringify(appendGreeting([])));
}

// —— 6) 10 条上限：UI 不得造出会被宿主 patch 静默截断的数据 ——
{
  const full = Array.from({ length: GREETING_MAX }, (_, i) => 'g' + i);
  check('GREETING_MAX 为 10', GREETING_MAX === 10, String(GREETING_MAX));
  check('达上限后 append 不再增长', appendGreeting(full).length === GREETING_MAX, String(appendGreeting(full).length));
  check('达上限后 append 保持原内容', eq(appendGreeting(full), full), '');
  // 宿主截断点必须与 UI 上限一致，否则 UI 能造出随后被砍掉的数据
  const hostGreetingSlices = (src, label) =>
    [...src.matchAll(/(alternate_greetings|group_only_greetings)[^\n]*slice\(0,\s*(\d+)\)/g)]
      .map((m) => ({ label, field: m[1], cap: Number(m[2]) }));
  const slices = [...hostGreetingSlices(agentSrc, 'agent.js'), ...hostGreetingSlices(indexSrc, 'index.js')];
  check('宿主存在问候语截断点', slices.length >= 3, slices.map((s) => `${s.label}:${s.field}=${s.cap}`).join(' | '));
  const mismatched = slices.filter((s) => s.cap !== GREETING_MAX);
  check('宿主截断上限与 GREETING_MAX 一致', mismatched.length === 0, mismatched.map((s) => `${s.label}:${s.cap}`).join(', '));
}

// —— 7) 序列化必须彻底消失（这才是本次修复的本质） ——
{
  check('arrayToLines 已移除', !/function arrayToLines\s*\(/.test(src), '');
  check('linesToArray 已移除', !/function linesToArray\s*\(/.test(src), '');
  const greetingSerialization = [...src.matchAll(/d\.(alternate_greetings|group_only_greetings)[^;]*?(join|split)\s*\(/g)];
  check('问候语字段不再有 join/split', greetingSerialization.length === 0, greetingSerialization.map((m) => m[0].slice(0, 60)).join(' | '));
  check('源码中不再出现每行一条的标签', !src.includes('（每行一条）'), '');
}

// —— 8) UI 接线：每条一个编辑框，fieldHead 只服务 string ——
{
  const defs = [...src.matchAll(/function greetingList\s*\(/g)].length;
  const uses = [...src.matchAll(/greetingList\("([a-z_]+)"/g)].map((m) => m[1]);
  check('greetingList 定义 1 次', defs === 1, String(defs));
  check('greetingList 被两个问候语字段使用', eq(uses, ['alternate_greetings', 'group_only_greetings']), JSON.stringify(uses));
  check('fieldHead 签名不含 isArray', /function fieldHead\(title, key\)/.test(src), '');
  check('fieldHead 调用点均为 2 参（无数组分支）', !/fieldHead\([^)]*,\s*true\s*\)/.test(src), '');
  check('每条问候语有独立 textarea（value 取元素原文）', /value:String\(text==null\? "": text\)/.test(src), '');
}

// —— 9) 已删除的死代码不得回流（宿主 dispatch 无 expandIdea/expandWorld，67172fd 已删 mock；
//        dismiss 唯一调用点是胶囊上已移除的 × 按钮；
//        trigger 无调用点，triggered 的唯一写入者是 setIsCcMode 且写值恒等于 isCcMode） ——
for (const id of ['expandIdea', 'expandWorld', 'setCustomTag', 'addCustomTag', 'removeTag', 'toggleTag', 'setIdea', 'chipOn', 'dismiss', 'trigger', 'triggered']) {
  const hit = src.split('\n').filter((l) => new RegExp(`\\b${id}\\b`).test(l)).filter((l) => !/^\s*(\/\/|\*)/.test(l));
  check(`死代码已移除：${id}`, hit.length === 0, hit.map((l) => l.trim().slice(0, 70)).join(' | '));
}

// —— 10) store.<name>() 调用点必须都在 createStore 的导出对象里，且都有函数声明 ——
{
  const exportLine = src.split('\n').find((l) => l.includes('return { getSnapshot:getSnapshot'));
  const exported = new Set([...exportLine.matchAll(/([A-Za-z_$][\w$]*):[A-Za-z_$][\w$]*/g)].map((m) => m[1]));
  const usedNames = new Set([...src.matchAll(/store\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const missingExport = [...usedNames].filter((k) => !exported.has(k) && k !== '_pullDraft');
  check('UI 调用的 store.* 均已导出', missingExport.length === 0, missingExport.join(', '));
  const declared = new Set([...src.matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const missingDecl = [...exported].filter((k) => !declared.has(k));
  check('导出的 store.* 均有函数声明', missingDecl.length === 0, missingDecl.join(', '));
}

// —— 11) 大框「取消」必须走回滚而不是静默落盘 ——
{
  check('长文本「取消」绑定 cancelEditingText', /store\.cancelEditingText\(\);\s*\}\},\s*t\("action\.cancel"\)/.test(src), '');
  check('世界观「取消」绑定 cancelEditingWorld', /store\.cancelEditingWorld\(\);\s*\}\},\s*t\("action\.cancel"\)/.test(src), '');
  check('setEditingText 携带 revert 闭包', /function setEditingText\(title, value, setter, revert\)/.test(src), '');
  const perItemRevert = [...src.matchAll(/setGreetingAt\(d\[key\], i, raw\)/g)].length;
  check('每条问候语的大框也有回滚', perItemRevert >= 1, String(perItemRevert));
}

// —— 12) 胶囊文案必须走词表（英文界面下不得出现中文 / 反之） ——
{
  check('胶囊展开态走 t("capsule.expanded")', /t\("capsule\.expanded"\)/.test(src), '');
  check('胶囊折叠态走 t("capsule\.collapseHint")', /t\("capsule\.collapseHint"\)/.test(src), '');
  check('胶囊不再硬编码「已展开」/「点击展开」', !/"— 已展开"/.test(src) && !/"— 点击展开"/.test(src), '');
  // zh 词表里这两个键的取值必须与原硬编码一致，否则中文界面会变样
  const zhBlock = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
  check('capsule.expanded 中文值仍为「已展开」', /"capsule\.expanded":"已展开"/.test(zhBlock), '');
  check('capsule.collapseHint 中文值仍为「点击展开」', /"capsule\.collapseHint":"点击展开"/.test(zhBlock), '');

  // 胶囊的 lore 计数也必须走词表，不得再硬编码 " entries" / " lore"
  check('胶囊计数走 t("common.loreCount")', /t\("common\.loreCount"\)\.replace\("\{n\}"/.test(src), '');
  check('胶囊不再硬编码 " entries · "', !/loreCount\+" entries/.test(src), '');
  check('胶囊不再硬编码 " lore " 拼接', !/loreCount\+" lore/.test(src), '');
  // 插值键必须存在且双语都有，否则 replace 后仍是 "{n}"
  const enBlock = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
  check('common.loreCount 在 zh 存在且含 {n}', /"common\.loreCount":"\{n\} lore"/.test(zhBlock), '');
  check('common.loreCount 在 en 存在且含 {n}', /"common\.loreCount":"\{n\} lore"/.test(enBlock), '');
}

// —— 13) 全量 i18n 守卫：UI 层（词表之外）不得再出现中文字面量 ——
// 历史背景：词表此前就建好了，但大量调用点硬编码中文，切到 English 仍是中文。
// 此守卫把「新写的中文必须进词表」变成硬约束，防止回退。
{
  const lines = src.split('\n');
  const zhStart = lines.findIndex((l) => l.includes('var zh='));
  const enEnd = lines.findIndex((l) => l.includes('function h(type,props)'));
  const cjk = /[\u4e00-\u9fff]/;
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > zhStart && i < enEnd) continue;                       // 词表本身
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[i].trim())) continue;      // 注释
    for (const m of lines[i].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      if (cjk.test(m[1])) offenders.push(`${i + 1}: ${JSON.stringify(m[1]).slice(0, 50)}`);
    }
  }
  check('UI 层无硬编码中文字面量', offenders.length === 0, offenders.slice(0, 6).join(' | '));

  // 词表双方必须键集一致、无重复，且插值占位符一致
  const keys = (b) => [...b.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"\s*:/g)].map((m) => m[1]);
  const zhBlock = src.slice(src.indexOf('var zh='), src.indexOf('var en='));
  const enBlock = src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'));
  const zk = keys(zhBlock);
  const ek = keys(enBlock);
  const u = (a) => [...new Set(a)];
  const zhOnly = u(zk).filter((k) => !ek.includes(k));
  const enOnly = u(ek).filter((k) => !zk.includes(k));
  check('词表 en 无缺键', zhOnly.length === 0, zhOnly.join(', '));
  check('词表 zh 无缺键', enOnly.length === 0, enOnly.join(', '));
  check('词表无重复键', u(zk).length === zk.length && u(ek).length === ek.length, `zh ${zk.length}/${u(zk).length}, en ${ek.length}/${u(ek).length}`);

  // 每个 t("...") 引用的键必须在词表里存在
  const usedKeys = u([...src.matchAll(/\bt\("([A-Za-z][A-Za-z0-9_.]*)"\)/g)].map((m) => m[1]));
  const missing = usedKeys.filter((k) => !u(zk).includes(k));
  check('t() 引用的键均存在于词表', missing.length === 0, missing.join(', '));

  // 占位符一致性：zh/en 的 {name} 集合必须相同，否则某语言会漏替换
  const parse = (from, to) => {
    const m = new Map();
    const seg = lines.slice(from, to).join('\n');
    for (const mm of seg.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) m.set(mm[1], mm[2]);
    return m;
  };
  const zm = parse(zhStart, src.split('\n').findIndex((l) => l.includes('var en=')));
  const em = parse(src.split('\n').findIndex((l) => l.includes('var en=')), enEnd);
  const holders = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((x) => !['char', 'user'].includes(x)).sort().join(',');
  const mismatch = [...zm.entries()].filter(([k, zv]) => em.has(k) && holders(zv) !== holders(em.get(k))).map(([k]) => k);
  check('词表 zh/en 占位符一致', mismatch.length === 0, mismatch.join(', '));

  // 中文保真：i18n 改造后插值输出必须与改造前的硬编码拼接「逐字一致」，否则中文界面被无声改动。
  // 期望值 = 改造前源码里的实际拼接结果。
  const zhT = (k, p) => {
    const tpl = zm.get(k);
    if (tpl === undefined) return `<<MISSING ${k}>>`;
    if (!p) return tpl;
    return tpl.replace(/\{(\w+)\}/g, (mm, n) => (n in p ? String(p[n]) : mm));
  };
  const fidelity = [
    ['问候语逐条标签', zhT('workshop.greeting.entryLabel', { title: 'alternate_greetings', n: 1 }), 'alternate_greetings' + ' · 第 ' + 1 + ' 条'],
    ['世界观字数', zhT('workshop.world.chars', { n: '140' }), '140' + '字'],
    ['世界书条数', zhT('common.entries', { n: 3 }), 3 + ' 条'],
    ['群聊问候条数', zhT('common.groupGreetings', { n: 2 }), 'group_only_greetings: ' + 2 + ' 条'],
    ['世界观大框字数', zhT('workshop.world.charsHint', { n: '88' }), '88' + ' 字｜失焦自动保存，关闭即生效'],
    ['长文本大框字数', zhT('workshop.edit.charsSync', { n: '77' }), '77' + ' 字｜输入即同步'],
    ['世界观大框标题', zhT('workshop.edit.title', { title: '① 年表 Timeline' }), '① 年表 Timeline' + ' · 大框编辑'],
    ['大框标题兜底', zhT('workshop.edit.title', { title: zhT('workshop.edit.fallbackTitle') }), '编辑' + ' · 大框编辑'],
    ['超上限提示', zhT('workshop.greeting.atMax', { max: 10 }), '已达 ' + 10 + ' 条上限'],
    ['保存提示', zhT('workshop.library.saveTip', { name: '未命名' }), '保存当前草稿（' + '未命名' + '）'],
    ['已载入 ID', zhT('workshop.library.loaded', { id: 'abc12345' }), '已载入 ID:' + 'abc12345' + ' · 再次保存将更新此卡'],
    ['Lore 计数', zhT('common.loreCount', { n: 3 }), 3 + ' lore'],
    // 这条曾真实回归过：原 label 带前导空格（" JSON"），若模板漏掉空格会变成「已导入JSON：」
    ['导入结果(含前导空格)', zhT('store.importedOk', { k: 'JSON', name: '雨城', n: 3 }), '已导入' + ' JSON' + '：' + '雨城' + ' · ' + 3 + ' lore（可在侧边栏 ★ 保存）'],
  ];
  const fBad = fidelity.filter(([, got, want]) => got !== want);
  check('中文插值输出与改造前逐字一致', fBad.length === 0, fBad.map(([n, got, want]) => `${n}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`).join(' | '));
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
