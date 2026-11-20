/**
 * 诊断日志（0.28.0）：等级判定 / 条目脱敏 / 行格式化的**唯一实现**。
 *
 * 为什么要有这个文件：前几轮排查「删不净」花了几个小时，最后靠翻磁盘时间戳才定位到
 * 「客户端的 RPC 一直在失败、插件把失败静默吞了」。一个能导出的日志能让用户直接把它贴回来。
 *
 * 三条例律（改动前先读）：
 *  ① **绝不记卡内容**：卡名 / 描述 / 世界书正文 / 问候语 / 卡 JSON 一律不进日志。
 *     这里只接受**扁平标量**（字符串截断到 160 字符，换行折成字面 `\n`），
 *     对象 / 数组整体丢弃 —— 不是为了好看，而是为了「用户敢把日志贴给作者」。
 *  ② 等级：`off < error < warn < info < debug`。configured 是**上限**（debug 记全部，off 什么都不记）。
 *  ③ 时间戳一律 UTC ISO（跨时区反馈不歧义），行格式固定：
 *     `<ISO8601> [<level>] [<src>] <event> k=v k=v`
 *
 * 宿主半 import 本文件做过滤与格式化（IO 在 lib/index.js）；客户端半是手写 bundle
 * （只能 require react），不能 import 本仓模块 —— 它只维护「同名的等级数组 + flush 队列」，
 * 等级值与这里逐字一致（tests/log.test.mjs 会比对两处）。
 */
export const LOG_LEVELS = ["off", "error", "warn", "info", "debug"];

const RANK = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };
const SOURCES = new Set(["host", "client", "agent"]);
/** 单条日志数据的字符串上限：够放端点名 / id / 错误码，放不下任何正文。 */
export const LOG_VALUE_MAX = 160;
/** 单个日志文件上限；超过就滚成 `.1`（只保留一份旧档，避免无限增长）。 */
export const LOG_MAX_BYTES = 512 * 1024;
/** 内存环形缓冲的条数（导出时即使还没落盘也能拿到）。 */
export const LOG_BUFFER_MAX = 800;

export function normalizeLogLevel(value, fallback = "info") {
  const v = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK, v) ? v : fallback;
}

/** 等级数值（越大越啰嗦）。未知值按 off 处理，避免拼错等级把日志意外打开。 */
export function levelRank(level) {
  const v = normalizeLogLevel(level, "off");
  return Object.prototype.hasOwnProperty.call(RANK, v) ? RANK[v] : 0;
}

/**
 * 这条日志要不要记：`configured` 是用户设置的上限，`entryLevel` 是这条的级别。
 * off 在任何方向都返回 false（关掉就是关掉，不偷偷留 error）。
 */
export function shouldLog(configured, entryLevel) {
  const cap = levelRank(configured);
  const lv = levelRank(entryLevel);
  if (cap === 0 || lv === 0) return false;
  return lv <= cap;
}

/**
 * 数据脱敏：只留一层标量。
 * - 字符串：换行折成 `\n` 字面、超长截断并标出原始长度（截断后仍要看得出「这里有长文本」，
 *   但正文本身不进日志）；
 * - 数字 / 布尔保留；`null` / `undefined` / 对象 / 数组 / 函数一律丢弃。
 * 键名限定 `[A-Za-z0-9_.-]`，避免把用户数据当键名塞进来。
 */
export function sanitizeLogData(data, maxLen = LOG_VALUE_MAX) {
  const out = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  const limit = Math.max(8, Math.min(1024, Number(maxLen) || LOG_VALUE_MAX));
  for (const key of Object.keys(data)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) continue;
    const v = data[key];
    if (v === null || v === undefined) continue;
    const ty = typeof v;
    if (ty === "boolean") { out[key] = v; continue; }
    if (ty === "number") { if (Number.isFinite(v)) out[key] = v; continue; }
    if (ty !== "string") continue;
    const flat = v.replace(/\r\n|\r|\n/g, "\\n");
    out[key] = flat.length > limit ? flat.slice(0, limit) + "…(" + flat.length + ")" : flat;
  }
  return out;
}

/** 一条日志 → 一行文本（`at` 可为字符串或毫秒时间戳，缺省取当前时间）。 */
export function formatLogLine(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  let at;
  if (typeof e.at === "string" && e.at) at = e.at;
  else if (typeof e.at === "number" && Number.isFinite(e.at)) at = new Date(e.at).toISOString();
  else at = new Date().toISOString();
  const level = normalizeLogLevel(e.level, "info");
  const src = SOURCES.has(String(e.src || "")) ? String(e.src) : "host";
  const event = String(e.event || "event").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || "event";
  const data = sanitizeLogData(e.data);
  const kv = Object.keys(data).map((k) => k + "=" + String(data[k])).join(" ");
  return at + " [" + level + "] [" + src + "] " + event + (kv ? " " + kv : "");
}

/** 文件要不要滚动：只要超过上限就滚（宿主每次写前 stat 一次，成本可忽略）。 */
export function shouldRotate(size) {
  const n = Number(size);
  return Number.isFinite(n) && n > LOG_MAX_BYTES;
}

/** 日志设置（`cc-logs/settings.json`）：坏文件一律回退默认等级，绝不让日志把插件弄崩。 */
export function parseLogSettings(raw, fallback = "info") {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return { level: normalizeLogLevel(fallback, "info") };
    return { level: normalizeLogLevel(obj.level, fallback) };
  } catch (e) {
    return { level: normalizeLogLevel(fallback, "info") };
  }
}

export function serializeLogSettings(level) {
  return JSON.stringify({ level: normalizeLogLevel(level, "info") }, null, 2) + "\n";
}
