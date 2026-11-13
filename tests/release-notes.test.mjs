/**
 * Release 标题抽取回归测试（0.23.0 事故）。
 *
 * 现象：v0.23.0 的 GitHub Release 名字变成「0.23.0 — ### 变更」。
 * 根因：CHANGELOG 的 `## 0.23.0` 小节第一行直接是 `### 变更`（缺摘要段），
 *   而 `.github/scripts/release-notes.mjs` 把小节第一行非空行原样当标题。
 * 修法：标题只认正文行 —— 跳过 Markdown 标题与空行；顺带给 0.23.0 补回摘要段。
 *
 * 0.24.x（ROADMAP 4.1 L1）：脚本已抽出 `buildRelease()` 纯函数，本测试直接 import 它，
 * **不再起子进程、不写临时目录** —— 之前的 `execFileSync` 在禁子进程的沙箱 / 受限 CI
 * 里直接 EPERM，`npm test` 跑不完。
 *
 * 运行：node tests/release-notes.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';
import { check, finish } from './harness.mjs';
import { buildRelease } from '../.github/scripts/release-notes.mjs';

function runWith(changelog) {
  const r = buildRelease('0.0.1', changelog);
  return { title: r.title, notes: r.notes.trim() };
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

// ⑤ 纯函数不依赖 cwd：版本号带 v 前缀也能解析（CLI 与测试同一份逻辑）
{
  const r = buildRelease('v0.0.1', '# 更新日志\n\n## 0.0.1\n\n**入口收敛。**\n');
  check('⑤ 版本号带 v 前缀时照常解析', r.title === '入口收敛', r.title);
  check('⑤b 小节不存在时 notes 仍以换行结尾（写文件不会粘行）', r.notes.endsWith('\n'), JSON.stringify(r.notes));
}

finish();
