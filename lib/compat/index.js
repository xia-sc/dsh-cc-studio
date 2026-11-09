/**
 * CCv3 兼容层公共入口（0.13.0）。
 *
 * 分层：
 * - `core.js`：CCv3 规范核心（纯函数、零 IO）；
 * - `adapters/*.js`：各前端平台（SillyTavern / 原生 CCv3 / 未来的新标准）；
 * - `registry.js`：目标注册表与渲染/审计入口。
 *
 * 宿主半（lib/index.js）与预设半（lib/agent.js）可 import 本文件；浏览器半（lib/client.js）**不** import
 * —— 它是手写 bundle，只能 require react，一律走宿主 RPC。
 */
export * from "./core.js";
export * from "./registry.js";
// 远程导入的纯计算（0.15.0）：地址规范化、multipart、书名决策、错误分类
export * from "./remote.js";
export { sillytavernAdapter } from "./adapters/sillytavern.js";
export { ccv3Adapter } from "./adapters/ccv3.js";
// 扩展性样板：不默认注册；新增平台照它加文件 + registry.registerTarget()
export { ccv3NativeAdapter } from "./adapters/ccv3-native.js";
// 兼容层内部转换函数（测试与宿主端点直接使用；不属于对外 API）
export { ST_ENTRY_TEMPLATE, ST_POSITION, stExt, unfurlBookDecorators, bookEntryToSt, bookToStWorldInfo } from "./adapters/sillytavern.js";
export { buildTEXtChunk as _buildTEXtChunk } from "./core.js";
