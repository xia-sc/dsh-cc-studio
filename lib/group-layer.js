/**
 * 卡组层（0.10.0）—— 「人物关系分组 + 组级共享世界书」的**唯一口径**。
 *
 * 为什么要有这个文件（一句话）：共享书把一部分世界设定挪到了「组」上之后，每个工具都自己写了一遍
 * 「取作用域 → 数条目 → 拼数字」，于是连着两轮出现「改了四个、漏了第五个」（见 CHANGELOG 0.9.0/0.9.1）。
 * 根因不是谁手滑，而是**同一个语义存在多份实现**：卡组数据读取两半各一份、取作用域每个工具各一遍、
 * 卡组级统计与 lorebookMetrics 平行两套。
 *
 * 所以这里放**纯函数**（零 IO、零环境变量、不读 DSH_HOME）：
 *   · assembleScope()  —— 卡组作用域组装（两半各自读盘后都交给它，形状只有一种）
 *   · groupMetrics()   —— 卡内 / 成员卡 / 共享书 / 合计 的分段统计（数字只在这里产生）
 *   · auditLoreEntries() —— 条目逐条质量（一把尺子，卡内与共享书共用）
 *   · worstCaseTrigger() —— 最坏情况单次触发量
 * 两半（lib/index.js 宿主半、lib/agent.js 预设半）**都 import 这个文件**，而不再各自抄一份：
 * 以前「两半同构」是靠测试逐字比对两份拷贝维持的，改一处漏一处就是线上分叉。
 * ⚠️ 落盘根（dataRoots/libDirs/groupDirs/bookDirs）与读写盘**不在这里** —— 那部分仍是两半各自的
 * 同构实现（见 AGENTS.md §2.6），本文件只吃「已经读到的数据」。
 * ⚠️ 这里是**基础统计与体检**的唯一实现；各工具只在其上做自己的派生（文案、预算、建议），
 * 不许再自己 for 循环数条目 —— 那正是这一层要消灭的东西。
 */

/** 关系图谱的三个常量（曾同时存在于两半；现在两半都从这里取，改一处就够）。 */
const REL_TYPES = ["family","romance","mentor","friend","colleague","rival","enemy","debt","superior","other"];
const REL_TYPE_LABELS = { family:"亲属", romance:"恋慕", mentor:"师徒", friend:"挚友", colleague:"同门", rival:"竞争", enemy:"敌对", debt:"恩义", superior:"上下级", other:"其他" };
const REL_BEGIN = "<!-- cc-relations:begin";
const REL_END = "<!-- cc-relations:end -->";

/** 五维（世界观）与 autoLorebook 生成的条目名（旧数据没有 cc_auto 标记，靠名字兜底）。 */
const WORLD_DIMS = ["timeline","factions","geo","power","daily"];
const AUTO_NAMES = new Set(["年表","势力","地理","力量体系","日常"]);

/** 是不是 autoLorebook 自动生成的条目（0.5.0：必须看标记，名字只用于旧数据兜底）。 */
function isAutoEntry(e){
  return !!(e && (e.cc_auto === true || (e.extensions && e.extensions.cc_auto)));
}
/** 旧数据（没有 cc_auto 标记）的自动条目：名字是维度名**且**内容/keys 符合自动条目的特征。 */
function looksLikeLegacyAuto(e){
  if(!e || !AUTO_NAMES.has(String(e.name||""))) return false;
  return /^\s*@@/.test(String(e.content||"")) || Array.isArray(e.keys) && e.keys.some(k => ["timeline","faction","geography","power","daily"].includes(String(k)));
}
/** 粗略 token 估算：CJK 一字≈1 token，其余按 4 字符≈1 token。 */
function estimateTokens(text){
  const s = String(text||"");
  let cjk = 0;
  for(const ch of s){ if(ch.charCodeAt(0) > 0x2E7F) cjk++; }
  const rest = s.length - cjk;
  return Math.ceil(cjk + rest/4);
}
function lorebookTokens(entries){
  return (Array.isArray(entries)? entries : []).reduce((n,e) => n + estimateTokens(e && e.content), 0);
}
/** 内容签名（折叠空白 + djb2 + 长度）：只用来**筛**，真正搬运/删除前一律再逐字比对内容。 */
function contentKeyOf(entry){
  const s = String((entry && entry.content) != null ? entry.content : "").replace(/\s+/g, " ").trim();
  let h = 5381;
  for(let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return "c" + h.toString(36) + "-" + s.length;
}

/**
 * 卡组作用域的**纯组装**（零 IO）。
 *
 * 两半各自负责读盘（各自的 libDirs/groupDirs/bookDirs 与回退语义），读完统一交给它 —— 于是
 * 「模型看到的组」与「界面看到的组」形状只有一种，不会一边有 book 一边没有。
 *
 * 入参：{ groupId, cardId, group（已 normalize）, cards（该组成员的库快照行）, book（已 normalize）,
 *        bookRev, include: "summary"|"full", maxCards }
 * ⚠️ members[].entries 是**原始条目数组**（不是计数）—— 计数属于 groupMetrics 的口径，不在这一层产生，
 * 这样「数字从哪来」永远只有一个答案。返回给模型/界面时由调用方决定放摘要还是放全文。
 */
function assembleScope(input){
  const opt = input || {};
  const include = opt.include === "full" ? "full" : "summary";
  const maxCards = Number(opt.maxCards) > 0 ? Math.floor(Number(opt.maxCards)) : 50;
  const group = opt.group || null;
  const groupId = String((group && group.id) || opt.groupId || "");
  const rows = Array.isArray(opt.cards) ? opt.cards : [];
  const allIds = rows.map(r => String(r.id));
  const memberIds = allIds.slice(0, maxCards);
  const truncated = allIds.length > memberIds.length;
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const members = memberIds.map(id => {
    const row = byId.get(id) || {};
    const draft = row.draft || null;
    const d = (draft && draft.data) ? draft.data : {};
    const entries = Array.isArray(d.character_book && d.character_book.entries) ? d.character_book.entries : [];
    const m = {
      id: id,
      name: String(d.name || (row.meta && row.meta.name) || ""),
      groupId: String((row.meta && row.meta.groupId) || ""),
      entries: entries,
      tokenBudget: Number(d.character_book && d.character_book.token_budget) || 1200,
    };
    if(include === "full") m.draft = draft;
    return m;
  });
  const book = opt.book || null;
  const bookEntries = (book && book.data && Array.isArray(book.data.entries))
    ? book.data.entries.filter(e => e && e.enabled !== false) : [];
  const ext = (book && book.data && book.data.extensions) || {};
  const cc = (ext.cc && typeof ext.cc === "object") ? ext.cc : {};
  return {
    ok: !!(group && groupId),
    groupId: groupId,
    group: group,
    rev: group ? (Number(group.rev) || 0) : 0,
    cardId: String(opt.cardId || ""),
    members: members,
    memberIds: memberIds,
    missing: Array.isArray(opt.missing) ? opt.missing.slice() : [],
    truncated: truncated,
    book: book ? {
      name: String((book.data && book.data.name) || ""),
      rev: Number.isFinite(Number(opt.bookRev)) ? Number(opt.bookRev) : 0,
      entries: bookEntries,
      lastPromote: (cc.lastPromote && typeof cc.lastPromote === "object") ? cc.lastPromote : null,
    } : null,
  };
}

export { REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END, WORLD_DIMS, AUTO_NAMES,
  isAutoEntry, looksLikeLegacyAuto, estimateTokens, lorebookTokens, contentKeyOf, assembleScope };
