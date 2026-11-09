/**
 * 原生 CCv3 目标适配器（0.13.0）—— 规范自己的形态，不做任何平台投影。
 *
 * - 卡：原样（`spec:chara_card_v3`）；
 * - PNG：只写 `ccv3` 块（规范 MUST；`chara` 是给 V2 读取器的可选回填，这里不写）；
 * - 世界书：`{spec:"lorebook_v3", data}`；
 * - 无平台绑定（不写 `data.extensions.world`）。
 *
 * 它是「新增一个基于 CCv3 的标准」的最小样板：新平台照这个形状加一个文件 + 在 registry 注册即可。
 */
import { sanitizeWorldName } from "../core.js";

function bookData(book){
  return (book && book.data && typeof book.data === "object")? book.data : (book || {});
}
export const ccv3Adapter = {
  id: "ccv3",
  label: "CCv3",
  version: "3.0",
  capabilities: {
    lorebookV3: true,
    entriesObject: false,
    decorators: ["@@activate", "@@dont_activate", "@@position", "@@depth", "@@role", "@@scan_depth"],
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
  /** 与 ST adapter 同一接口：返回 `[{keyword,json}]`，由宿主转成 tEXt 块（避免适配器各自拼字节）。 */
  pngChunks(card){ return [{ keyword: "ccv3", json: card }]; },
  toBookExport(book){
    const data = bookData(book);
    const name = String(data.name || "").trim() || "shared-lorebook";
    return {
      filename: sanitizeWorldName(name) + ".lorebook.json",
      mime: "application/json",
      content: JSON.stringify({ spec: "lorebook_v3", data }, null, 2),
    };
  },
  audit(){ return []; },
};
