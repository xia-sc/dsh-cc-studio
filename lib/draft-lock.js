/**
 * 草稿锁（LLM 创作保护 / 读写分离）—— 纯函数与常量，零 IO，**宿主半与预设半共用这一份**。
 *
 * 背景（0.11.0）：LLM 正在工坊草稿里创作 A 卡时，用户点「载入」B 卡，`cc_loadFromLibrary`
 * 直接把同一会话槽的草稿整份替换 —— LLM 已写入但未保存的内容被覆盖，只能从历史对话里捞。
 * 现在 LLM 每次写草稿都会建立一把**创作锁**；锁 active 期间用户侧（浏览器 RPC）的写草稿动作
 * 一律被拦，载入/导入只进入只读预览。权限完全由 LLM 控制：它调用 `cc_release_draft` 交还，
 * 或锁超过 TTL 无写入自动失效（防 LLM 崩溃后永久锁死的安全阀）。
 *
 * 为什么判定放在这里而不是两半各写一份（同 lib/group-layer.js 的教训）：
 * 「锁算不算 active / 超时算不算过期 / 能不能写」是同一套语义，两半各写一份必然漂移 ——
 * 一边说锁住了、另一边照写，比没有锁更危险。IO 仍由两半各持一份（各自的 dataRoots），
 * 那是真正需要两份的东西。
 *
 * 锁文件：<主根>/cc-drafts/<safeDraftFile(key) 去掉 .json>.lock.json（与 .origin.json 同模式）。
 * 锁**不写进草稿 JSON**：用户只读/LLM 交还不重写草稿，草稿的 `rev` 仍然只反映内容变化。
 */

/** 目前唯一的锁持有者。用户侧没有「接管锁」这种状态 —— 权限由 LLM 持有或释放。 */
export const LOCK_OWNER_LLM = "llm";
/** 锁多久没有刷新算超时（秒）。LLM 每次写草稿都会续期；超时视为 LLM 已停止创作。 */
export const LOCK_TTL_SEC = 30 * 60;
/** 锁文件后缀（草稿文件是 .json，来源 sidecar 是 .origin.json，锁是 .lock.json）。 */
export const LOCK_FILE_SUFFIX = ".lock.json";

function nowOf(nowSec){
  const n = Number(nowSec);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : Math.floor(Date.now() / 1000);
}

/**
 * 把磁盘上的锁对象归一成内部形状；任何不合法的输入一律返回 null（= 没有锁）。
 *
 * 降级方向必须是「无锁」：锁文件损坏、被手工改坏、或 key 对不上时，宁可放弃保护也不能
 * 让用户永远编辑不了草稿。真正需要「锁得住」的是 LLM 自己刚写下的那份（写入即合法）。
 */
export function normalizeLock(obj, key){
  const src = (obj && typeof obj === "object") ? obj : null;
  if(!src) return null;
  if(src.owner !== LOCK_OWNER_LLM && String(src.owner == null ? "" : src.owner) !== LOCK_OWNER_LLM) return null;
  const k = (key == null) ? "" : String(key);
  // key 不匹配 = 这不是这把槽的锁（防 hash 碰撞 / 手工拷贝 / 改名后的残文件）
  if(k && src.key != null && String(src.key) !== k) return null;
  const updatedAt = Math.max(0, Math.round(Number(src.updatedAt) || 0));
  if(updatedAt <= 0) return null;
  const since = Math.max(0, Math.round(Number(src.since) || 0)) || updatedAt;
  const rev = Math.max(0, Math.round(Number(src.rev) || 0));
  return {
    key: k || (src.key == null ? "" : String(src.key)),
    owner: LOCK_OWNER_LLM,
    since,
    updatedAt,
    rev,
    cardName: String(src.cardName == null ? "" : src.cardName).slice(0, 120),
  };
}

/** 锁是否已超时（TTL 内没有刷新）。无锁恒为 false。 */
export function isLockStale(lock, nowSec){
  if(!lock) return false;
  return (nowOf(nowSec) - lock.updatedAt) > LOCK_TTL_SEC;
}

/**
 * 给界面 / 工具返回用的锁摘要。`stale` 不是「锁失效了但还挡着」—— 语义是
 * 「LLM 已经很久没写了，视为可编辑；它若再写会自动重新上锁」。
 * 无锁返回 null（工具返回里必须是显式 null，不能漏成 undefined，见 B1 的 lossless-JSON 教训）。
 */
export function lockSummary(lock, nowSec){
  if(!lock) return null;
  const now = nowOf(nowSec);
  const ageSec = Math.max(0, now - lock.updatedAt);
  const stale = ageSec > LOCK_TTL_SEC;
  return {
    owner: lock.owner,
    cardName: lock.cardName,
    since: lock.since,
    updatedAt: lock.updatedAt,
    ageSec,
    ttlSec: LOCK_TTL_SEC,
    stale,
    active: !stale,
  };
}

/**
 * 用户侧写草稿之前问一句「现在能不能写」。
 * - `force:true`：设置页把「LLM 创作保护」关掉时客户端会带上它 —— 等价于旧行为。
 * - 无锁 / 已超时：放行（超时是安全阀，不是用户抢权）。
 * - 锁 active：拦下，reason 给上层拼错误码与提示。
 */
export function lockBlocksDraftWrite(lock, nowSec, force){
  if(force === true) return { blocked:false, reason:"force", stale: isLockStale(lock, nowSec) };
  if(!lock) return { blocked:false, reason:"none", stale:false };
  const stale = isLockStale(lock, nowSec);
  if(stale) return { blocked:false, reason:"stale", stale:true };
  return { blocked:true, reason:"llm-locked", stale:false };
}
