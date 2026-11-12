/**
 * Release 标题抽取回归测试（0.23.0 事故）。
 *
 * 现象：v0.23.0 的 GitHub Release 名字变成「0.23.0 — ### 变更」。
 * 根因：CHANGELOG 的 `## 0.23.0` 小节第一行直接是 `### 变更`（缺摘要段），
 *   而 `.github/scripts/release-notes.mjs` 把小节第一行非空行原样当标题。
 * 修法：标题只认正文行 —— 跳过 Markdown 标题与空行；顺带给 0.23.0 补回摘要段。
 *
 * 本文件用临时目录跑真实脚本（脚本读 cwd 下的 CHANGELOG.md），不碰仓库文件。
 *
 * 运行：node tests/release-notes.test.mjs   （全绿退出码 0）
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../.github/scripts/release-notes.mjs', import.meta.url));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

function runWith(changelog) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-relnotes-'));
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog, 'utf8');
    const out = execFileSync(process.execPath, [script, '0.0.1'], { cwd: dir, encoding: 'utf8' });
    return {
      out,
      title: readFileSync(join(dir, 'release-title.txt'), 'utf8').trim(),
      notes: readFileSync(join(dir, 'release-notes.md'), 'utf8').trim(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ① 事故形态：小节第一行就是 ### 小标题
{
  const r = runWith('# 更新日志\n\n## 0.0.1\n\n### 变更\n\n- 改了点东西\n');
  check('① 第一行是「### 变更」时，标题不会被当成 ### 变更',
    !r.title.startsWith('#') && r.title.indexOf('#') < 0, r.title);
  check('①b 正文仍保留完整小节（标题行不被吃掉）',
    r.notes.indexOf('### 变更') >= 0 && r.notes.indexOf('改了点东西') >= 0, r.notes.slice(0, 40));
}

// ② 正常形态：小节第一行是摘要段
{
  const r = runWith('# 更新日志\n\n## 0.0.1\n\n**入口收敛 + 分组可见：把三件事一起修掉。**\n\n### 变更\n\n- x\n');
  check('② 有摘要段时标题取冒号前那一段',
    r.title === '入口收敛 + 分组可见', r.title);
}

// ③ 版本小节不存在：不产出空正文
{
  const r = runWith('# 更新日志\n\n## 0.0.2\n\n- 别的版本\n');
  check('③ 找不到版本小节时给显式占位正文（不是空 Release）',
    r.notes.indexOf('CHANGELOG.md 里没有 0.0.1 小节') >= 0, r.notes.slice(0, 40));
}

// ④ 仓库自己的 CHANGELOG：0.23.0 必须带摘要段（否则 CI 又会把 ### 当标题）
{
  const real = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const m = real.match(/## 0\.23\.0\r?\n+([^\r\n]*)/);
  check('④ 仓库 CHANGELOG 的 0.23.0 小节第一行是摘要（不是 ### 标题）',
    !!m && m[1].trim().indexOf('#') !== 0, m ? m[1].slice(0, 40) : 'MISS');
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 160)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
