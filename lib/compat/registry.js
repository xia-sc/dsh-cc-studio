/**
 * 目标适配器注册表（0.13.0）。
 *
 * 新增一个「基于 CCv3 的标准」= 在 lib/compat/adapters/ 加一个文件 + 在下面 TARGETS 加一行；
 * 不要改 index.js / client.js / agent.js 里的平台分支（家规见 AGENTS.md）。
 *
 * 纯函数、零 IO。`renderCard` / `renderBook` 只做数据变换；落盘/读盘留在 lib/index.js。
 */
import { ccv3Adapter } from "./adapters/ccv3.js";
import { sillytavernAdapter } from "./adapters/sillytavern.js";

/** 所有可用目标。顺序 = UI 展示顺序（共享书页按钮按此顺序渲染）。 */
export const TARGETS = {
  ccv3: ccv3Adapter,
  sillytavern: sillytavernAdapter,
};
/** 历史默认目标：插件此前的卡导出/共享书导出行为就是 ST 形态，保持默认不破坏既有用户。 */
export const DEFAULT_TARGET_ID = "sillytavern";

export function getTarget(id){
  const key = String(id == null ? "" : id).trim();
  return Object.prototype.hasOwnProperty.call(TARGETS, key) ? TARGETS[key] : null;
}
/**
 * 注册一个新目标（未来平台/插件式适配器用；默认目标不在这里注册）。
 * 纯内存操作，进程内有效；生产插件默认只注册 ST + CCv3（见 TARGETS）。
 */
export function registerTarget(target){
  if(!target || typeof target !== "object" || !target.id) throw new Error("目标适配器必须有 id");
  TARGETS[String(target.id)] = target;
  return target;
}
/**
 * 目标元数据（给客户端 `cc_listTargets` 用；不要在这里塞函数）。
 * `remote` 是 0.15.0 的「远程导入」描述（纯数据）：有它的目标才会在导出弹层里出现
 * 「导入到 <label>」区块，客户端不写死平台名。
 */
export function listTargets(){
  return Object.keys(TARGETS).map(function(id){
    const t = TARGETS[id];
    return { id: id, label: t.label, version: t.version, capabilities: t.capabilities, remote: t.remote || null };
  });
}
/** 卡导出副本：target 未指定/未知时回退默认目标（ST），与历史行为一致。 */
export function renderCard(targetId, card, opts){
  const t = getTarget(targetId) || TARGETS[DEFAULT_TARGET_ID];
  return t.prepareCard(card, opts || {});
}
/** 世界书导出物：返回 `{filename, mime, content}`。 */
export function renderBook(targetId, book, opts){
  const t = getTarget(targetId) || TARGETS[DEFAULT_TARGET_ID];
  return t.toBookExport(book, opts || {});
}
/** 目标能力审计：返回 `[{level, code, message}]`。 */
export function auditForTarget(targetId, input){
  const t = getTarget(targetId) || TARGETS[DEFAULT_TARGET_ID];
  return t.audit(input || {});
}
/** PNG 卡块：返回 `[{keyword, json}]`（由调用方转成 tEXt 块）。 */
export function pngChunksForTarget(targetId, card){
  const t = getTarget(targetId) || TARGETS[DEFAULT_TARGET_ID];
  return t.pngChunks ? t.pngChunks(card) : null;
}
