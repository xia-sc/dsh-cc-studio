/**
 * 隐私守卫：发布日志与文档里**不出现任何真实角色名 / 本机路径 / 具体会话 id**。
 *
 * 背景（用户明确要求）：之前几次发版，CHANGELOG 小节的「现象」里直接写了用户反馈里的
 * 真实卡名（例如「角色名仍是 ***」「characters/***.png」「ST 里出现两张「***」」），
 * Release 正文又由 CHANGELOG 抽取 —— 于是这些名字被公开到 GitHub Release 上。
 * 用户要求：日志里不要出现任何卡的名字。
 *
 * 这个文件刻意**不硬编码任何卡名**：仓库是公开的，把名单写进来等于二次泄露。
 * 只挡可泛化的形态（真实卡名必然以其中一种形态出现）：
 *   ① `data/default-user/characters/<真名>.png` —— 占位 `<角色名>` 放行；
 *   ② `角色名仍是/是/：<真名>` 句式；
 *   ③ 本机绝对路径（`E:\...`）；
 *   ④ 具体会话 id（`session-<8位hex>-...`）。
 * 判据是「占位写法不算违规」，所以修法永远是把具体值换成 `<角色名>` / `<会话 id>` 这类占位。
 *
 * 运行：node tests/privacy-scrub.test.mjs   （全绿退出码 0）
 */
import { check, finish, readRepo } from './harness.mjs';

const DOCS = ['CHANGELOG.md', 'README.md', 'README_EN.md', 'ROADMAP.md', 'COMPAT-AUDIT.md', 'AGENTS.md'];

const RULES = [
  { name: '具体角色 PNG 文件名（应写成 <角色名>.png）', re: /data\/default-user\/characters\/(?!<)[^\s`"'）)]+\.png/g },
  { name: '「角色名仍是/是/：」后跟真名', re: /角色名(?:仍?是|：)\s*[^\s，。；）)]{2,}/g },
  { name: '本机绝对路径（应写成 <本机路径>）', re: /[A-Za-z]:\\/g },
  { name: '具体会话 id（应写成 session-<id>）', re: /session-[0-9a-f]{8}-[0-9a-f]{4}/g },
];

for (const doc of DOCS) {
  let text = '';
  try { text = readRepo(doc); } catch (e) { continue; }
  for (const rule of RULES) {
    const hits = text.match(rule.re) || [];
    check(`${doc}｜不含${rule.name}`, hits.length === 0, hits.slice(0, 3).join(' | '));
  }
}

// 守卫自身的元断言：规则必须真的能命中「坏例子」，否则就是一条永远绿的空检查。
// 坏例子用占位化的假名（`示例名`），不涉及任何真实卡名。
{
  const sample = '现象：工坊中间还挂着那张（角色名仍是示例名），报 data/default-user/characters/示例名.png，'
    + '会话 session-0123abcd-4567，报告在 E:\\some\\path.md';
  for (const rule of RULES) {
    check(`守卫自检：${rule.name} 能命中坏例子`, new RegExp(rule.re.source, 'g').test(sample), '');
  }
  const good = '现象：工坊中间还挂着刚删的那张（名字都还在），报 data/default-user/characters/<角色名>.png，'
    + '会话 session-<id>，报告在 <本机路径>';
  for (const rule of RULES) {
    check(`守卫自检：${rule.name} 不误报占位写法`, !new RegExp(rule.re.source, 'g').test(good), '');
  }
}

finish();
