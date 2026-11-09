/**
 * 「原生 CCv3 客户端」目标适配器 —— 0.13.0 的**扩展性样板**。
 *
 * 这不是插件默认启用的目标（默认只有 SillyTavern + CCv3，见 registry.js 的 TARGETS）。
 * 它演示「新增一个基于 CCv3 的标准 = 只加一个实现层」的完整形状：
 *
 * 1. 在本目录新建 `<id>.js`，导出 `{ id, label, version, capabilities, prepareCard,
 *    pngChunks?, toBookExport, audit }`（纯函数、零 IO）；
 * 2. 在 `lib/compat/registry.js` 的 TARGETS 里加一行（或运行时调 `registerTarget()`）；
 * 3. 不改 lib/index.js / lib/client.js / lib/agent.js —— 客户端共享书页按 `cc_listTargets`
 *    自动多出按钮，导出走 `cc_exportBook` / `cc_exportBook` 的同一个端点。
 *
 * 下面这个实现故意与 `ccv3.js` 有差异（世界书文件名用 `.world.json`、PNG 只写 ccv3），
 * 用来证明「平台特色可以只活在自己的实现层里」，核心不需要知道它。
 */
import { sanitizeWorldName } from "../core.js";

function bookData(book){
  return (book && book.data && typeof book.data === "object")? book.data : (book || {});
}
export const ccv3NativeAdapter = {
  id: "ccv3-native",
  label: "CCv3 native",
  version: "3.0",
  capabilities: {
    lorebookV3: true,
    entriesObject: false,
    decorators: ["@@activate", "@@dont_activate", "@@position", "@@depth", "@@role", "@@scan_depth", "@@is_greeting"],
    useRegex: true,
    priority: true,
    v3Fields: {
      nickname: true,
      groupOnlyGreetings: true,
      assets: true,
      creatorNotesMultilingual: true,
      source: true,
      creationDate: true,
      modificationDate: true,
    },
    charx: { import: true, export: true },
    pngReadPriority: "ccv3",
  },
  prepareCard(card){ return { card, warnings: [] }; },
  pngChunks(card){ return [{ keyword: "ccv3", json: card }]; },
  toBookExport(book){
    const data = bookData(book);
    const name = String(data.name || "").trim() || "shared-lorebook";
    return {
      filename: sanitizeWorldName(name) + ".world.json",
      mime: "application/json",
      content: JSON.stringify({ spec: "lorebook_v3", data }, null, 2),
      warnings: [],
    };
  },
  audit(){ return []; },
};
