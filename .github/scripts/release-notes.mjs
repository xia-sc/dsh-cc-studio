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
 * 本文件不随 npm 包发布（package.json 的 files 白名单里没有 .github）。
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("用法: node .github/scripts/release-notes.mjs <version>（可带 v 前缀）");
  process.exit(2);
}

const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.trim() === `## ${version}`);

let notes;
if (start === -1) {
  // 不静默产出空正文：宁可带一句显式说明，也不要一个看起来正常的空 Release
  console.warn(`[release-notes] CHANGELOG.md 里没有 ${version} 小节，退化为占位正文`);
  notes = [`（CHANGELOG.md 里没有 ${version} 小节）`];
} else {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  notes = lines.slice(start + 1, end).join("\n").trim().split("\n");
}

// 标题沿用本仓库既有的 Release 命名习惯 `vX.Y.Z — 短描述`：
// 短描述取小节第一行，去掉 ** 强调、截到第一个冒号为止，避免出现一整屏的标题。
const firstLine = notes.find((line) => line.trim() !== "") ?? version;
const summary = firstLine.replace(/\*\*/g, "").split(/[：:]/)[0].trim().slice(0, 60);

writeFileSync("release-notes.md", notes.join("\n").trim() + "\n", "utf8");
writeFileSync("release-title.txt", (summary || version) + "\n", "utf8");

console.log(`[release-notes] 版本 ${version} → 标题「${summary || version}」`);
console.log("[release-notes] 正文:");
console.log(notes.join("\n").trim());
