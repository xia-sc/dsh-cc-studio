/**
 * 从 CHANGELOG.md 里抽出某个版本的小节，产出 GitHub Release 的正文与标题。
 *
 * 由 .github/workflows/publish.yml 在「打 tag 且发布成功后」调用；也可以本地手动跑：
 *   node .github/scripts/release-notes.mjs 0.3.2
 * 产物写在当前目录：release-notes.md（正文）、release-title.txt（标题）
 *
 * 为什么单独放个文件而不是内联在 workflow 里：内联 shell 没法本地验证，而这段解析
 * （找 `## <version>` 到下一个 `## ` 之间）必须与 CHANGELOG.md 的既有格式严格对齐 ——
 * 格式一旦漂移，Release 正文就会变成空或串版本，而那只会在下次发版时才暴露。
 *
 * 0.24.x（ROADMAP 4.1 L1）：解析抽成 `buildRelease()` 纯函数，CLI 只做 IO。
 * 之前测试靠 `execFileSync` 起子进程读 cwd 的 CHANGELOG.md —— 禁子进程的沙箱 / 受限 CI
 * 里直接 EPERM，`npm test` 跑不完。现在测试 import 纯函数，不再 spawn。
 *
 * 本文件不随 npm 包发布（package.json 的 files 白名单里没有 .github）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * 纯函数：给定版本与 CHANGELOG 全文，算出 Release 的标题与正文，不碰文件系统。
 *
 * @param {string} version 版本号（允许带 v 前缀）
 * @param {string} changelog CHANGELOG.md 的全文
 * @returns {{ title: string, notes: string }} notes 以换行结尾，可直接写文件
 */
export function buildRelease(version, changelog) {
  const v = String(version ?? "").replace(/^v/, "");
  const lines = String(changelog ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${v}`);

  let body;
  if (start === -1) {
    // 不静默产出空正文：宁可带一句显式说明，也不要一个看起来正常的空 Release
    body = `（CHANGELOG.md 里没有 ${v} 小节）`;
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    body = lines.slice(start + 1, end).join("\n").trim();
  }

  // 标题沿用本仓库既有的 Release 命名习惯 `vX.Y.Z — 短描述`：
  // 短描述取小节第一行、去掉 ** 强调。冒号前若只是「新增」「修复」这类模板词（< 8 字），
  // 不截断整行（否则标题会退化成两个字）。
  // 0.23.0 事故：小节第一行是 `### 变更` 时，标题变成了「0.23.0 — ### 变更」。
  // 标题只认**正文**行 —— 跳过 Markdown 标题（# / ## / ###）与空行，避免格式漂移直接污染 Release 名称。
  const firstLine = body.split("\n").find((line) => {
    const l = line.trim();
    return l !== "" && !l.startsWith("#");
  }) ?? v;
  const plain = firstLine.replace(/\*\*/g, "").trim();
  const head = plain.split(/[：:]/)[0].trim();
  const summary = (head.length >= 8 ? head : plain.replace(/[。．.]$/, "")).slice(0, 60);

  return { title: summary || v, notes: body.trim() + "\n" };
}

/** CLI 入口：读 cwd 的 CHANGELOG.md、写两个产物文件、把结果打到 stdout。 */
export function main(argv = process.argv) {
  const version = (argv[2] ?? "").replace(/^v/, "");
  if (!version) {
    console.error("用法: node .github/scripts/release-notes.mjs <version>（可带 v 前缀）");
    return 2;
  }
  const { title, notes } = buildRelease(version, readFileSync("CHANGELOG.md", "utf8"));
  writeFileSync("release-notes.md", notes, "utf8");
  writeFileSync("release-title.txt", title + "\n", "utf8");
  console.log(`[release-notes] 版本 ${version} → 标题「${title}」`);
  console.log("[release-notes] 正文:");
  console.log(notes.trim());
  return 0;
}

// 只有被直接执行时才跑 CLI；被测试 import 时什么都不做。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
