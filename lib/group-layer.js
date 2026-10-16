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
const WORLD_DIM_LABELS = { timeline:"年表", factions:"势力", geo:"地理", power:"力量体系", daily:"日常" };
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
      // 五维（extensions.cc_world）：组内世界观漂移检查要它 —— 是在这里顺手带出，而不是让每个
      // 检查自己去翻 draft（summary 模式本来不带 draft，翻不到就会「静默不检查」）。
      world: (d.extensions && d.extensions.cc_world && typeof d.extensions.cc_world === "object") ? d.extensions.cc_world : {},
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
      // 完整的归一化文档（引用同一份，不额外占内存）：书级参数（description / scan_depth / token_budget…）
      // 与「全部条目（含 enabled:false）」只有它上面才有 —— 导出/编辑类调用点需要，摘要不够。
      doc: book,
    } : null,
  };
}

/**
 * 一条世界书条目的基础统计（「段」）。字段名与 0.9.x `lorebookMetrics` 的输出**逐字一致** ——
 * 老调用点与既有断言不许因为这次收口而变。
 */
function seg(list){
  const l = Array.isArray(list) ? list : [];
  return {
    entries: l.length,
    tokens: lorebookTokens(l),
    constant: l.filter(e => e && e.constant === true).length,
    constantTokens: l.filter(e => e && e.constant === true).reduce((n, e) => n + estimateTokens(e && e.content), 0),
    manual: l.filter(e => !isAutoEntry(e)).length,
    hasDecorator: l.some(e => String((e && e.content) || "").includes("@@")),
  };
}
/**
 * 卡组口径：**所有「多少条 / 多少 token」的数字只在这里产生**。
 *
 * 为什么收口（0.9.0/0.9.1 两轮实测的教训）：共享书改变了**数据的位置**，却没有改变工具的**度量口径** ——
 * simulate / lint / group_check / preview_export / validate 五个工具各自补了一遍「把共享书算进来」，
 * 于是连着两轮出现「改了四个、漏了第五个」。这个函数就是那唯一一处：它同时给
 * 「当前卡 / 每张成员卡 / 成员卡合计 / 共享书 / 全部」五个范围，各消费点只是挑自己那个范围。
 *
 * 入参：{ cardId?, card: 当前卡条目, members: [{id, name, entries, tokenBudget, world}], book: 共享书条目 }
 * 出参：
 *   card / book              —— 两段基本统计
 *   members.byId / .total    —— 每张成员卡 / 成员卡合计
 *   group                    —— 成员卡合计（别名，读起来顺）
 *   all                      —— 当前卡 + 成员卡 + 共享书（群聊时真正会一起进 prompt 的那些）
 *   legacy                   —— 0.9.x `lorebookMetrics` 的形状（card/shared/total/all），供旧调用点
 *   derived                  —— 派生量：群聊固定开销 / 最坏情况单次触发 / 跨卡重复触发词 / 组内五维漂移
 *
 * `opts.derived === false` 跳过派生计算（旧的 lorebookMetrics 包装用它，避免每次白算一遍）。
 * ⚠️ `derived.worstCase` 的范围是**当前卡 + 共享书**（与 0.9.x 的 cc_lint_lorebook 逐字一致）；
 * 组级的「成员卡合计最坏情况」由需要它的检查用同一个 worstCaseTrigger() 换范围算 —— 口径同一个，范围各表。
 */
function groupMetrics(input, opts){
  const opt = input || {};
  const wantDerived = !(opts && opts.derived === false);
  const card = Array.isArray(opt.card) ? opt.card : [];
  const rows = (Array.isArray(opt.members) ? opt.members : []).map(r => ({
    id: String((r && r.id) || ""),
    name: String((r && r.name) || ""),
    entries: (r && Array.isArray(r.entries)) ? r.entries : [],
    tokenBudget: Number(r && r.tokenBudget) || 1200,
    world: (r && r.world && typeof r.world === "object") ? r.world : {},
  }));
  const book = Array.isArray(opt.book) ? opt.book : [];
  const byId = {};
  const memberAll = [];
  rows.forEach(r => { byId[r.id] = seg(r.entries); memberAll.push(...r.entries); });
  const memberSeg = seg(memberAll);
  const cardSeg = seg(card);
  const bookSeg = seg(book);
  const out = {
    card: cardSeg,
    members: { byId: byId, total: memberSeg },
    book: bookSeg,
    group: memberSeg,
    all: seg(card.concat(memberAll, book)),
    legacy: { card: cardSeg, shared: bookSeg, total: seg(card.concat(book)), all: card.concat(book) },
  };
  if(!wantDerived) return out;
  // 群聊每轮固定开销 = 所有成员卡的 constant 之和 + 共享书的 constant（书在群聊里同样每轮插入）。
  // 判据与 0.9.x 的 checkGroup 完全一致（那里就是这两项相加），数字现在是同一份。
  const cardConst = rows.reduce((n, r) => n + byId[r.id].constantTokens, 0);
  const sharedConst = bookSeg.constantTokens;
  const minBudget = rows.length ? rows.reduce((n, r) => Math.min(n, r.tokenBudget), Infinity) : 1200;
  out.derived = {
    groupConstant: {
      card: cardConst, shared: sharedConst, total: cardConst + sharedConst,
      minBudget: minBudget, ratio: minBudget > 0 ? (cardConst + sharedConst) / minBudget : 0,
    },
    worstCase: worstCaseTrigger(card.concat(book)),
    duplicateKeys: duplicateKeyGroups(
      [{ kind: "card", id: String(opt.cardId || ""), entries: card }]
        .concat(rows.map(r => ({ kind: "card", id: r.id, name: r.name, entries: r.entries })))
        .concat([{ kind: "book", id: "", entries: book }])),
    worldDrift: worldDriftOf(rows),
  };
  return out;
}
/**
 * 0.9.x 的公开形状（逐字保留）：`{card, shared, total, all}`。
 * 现在只是 groupMetrics 的一层薄包装 —— 老调用点（lint / validate / 测试）一个都不用改。
 */
function lorebookMetrics(cardEntries, sharedEntries){
  return groupMetrics({ card: cardEntries, book: sharedEntries }, { derived: false }).legacy;
}
/**
 * 分段统计的**轻量投影**（去掉 `all` 原始条目数组）。
 *
 * 为什么必须瘦身：`workflow` 会随**每一个**工具的返回出去，而 `lorebookMetrics().all` 是条目的
 * 原始数组（含 content 全文）—— 0.10.0 的 LLM 侧回归实测：四卡套里一次
 * `cc_load_from_library(includeDraft:false)` 被它多带出约 1800 token，把「省 token」的初衷整个抵消。
 * 数字（entries / tokens / constant / constantTokens / manual / hasDecorator）一个不少，条目正文一个不带。
 */
function metricsBrief(m){
  const src = (m && typeof m === "object") ? m : {};
  const seg = (s) => (s && typeof s === "object") ? {
    entries: s.entries, tokens: s.tokens, constant: s.constant,
    constantTokens: s.constantTokens, manual: s.manual, hasDecorator: s.hasDecorator,
  } : null;
  return { card: seg(src.card), shared: seg(src.shared), total: seg(src.total) };
}
/**
 * 组内五维漂移：同一维度在多张成员卡上都写了、且**实质不一致**才算。
 * 逐字相同不算（同一份设定复制过去的，很正常）；一方是另一方子串也不算（详略不同）；
 * 维度内容短于 6 个字符不算（与「五维填了没」的既有判据一致，避免把「TBD」当设定）。
 */
function worldDriftOf(rows){
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  WORLD_DIMS.forEach(dim => {
    const hits = list
      .map(r => ({ id: String((r && r.id) || ""), name: String((r && r.name) || ""), text: String(((r && r.world) || {})[dim] || "").trim() }))
      .filter(h => h.text.length >= 6);
    if(hits.length < 2) return;
    const distinct = [];
    hits.forEach(h => {
      if(!distinct.some(x => x.text === h.text || x.text.indexOf(h.text) >= 0 || h.text.indexOf(x.text) >= 0)) distinct.push(h);
    });
    if(distinct.length >= 2) out.push({ dim: dim, cards: distinct });
  });
  return out;
}
/**
 * 触发词冲突（并查集口径）：同一个词被 ≥2 条条目共用 = 用户一句话会把它们同时带出来。
 * 跨来源一起算（当前卡 / 各成员卡 / 共享书）—— 群聊时它们本来就会一起进 prompt。
 * 大小写不敏感（与 cc_lint_lorebook 的既有口径一致）。
 */
function duplicateKeyGroups(sources){
  const srcs = (Array.isArray(sources) ? sources : []).map(s => ({
    kind: String((s && s.kind) || "card"),
    id: String((s && s.id) || ""),
    name: String((s && s.name) || ""),
    entries: (s && Array.isArray(s.entries) ? s.entries : []).filter(e => e && e.enabled !== false),
  }));
  const seen = new Map();
  srcs.forEach(s => s.entries.forEach(e => (Array.isArray(e.keys) ? e.keys : []).forEach(k => {
    const kk = String(k).trim().toLowerCase();
    if(!kk) return;
    if(!seen.has(kk)) seen.set(kk, []);
    seen.get(kk).push({ kind: s.kind, id: s.id, cardName: s.name, name: String(e.name || ""), content: String(e.content || "") });
  })));
  const out = [];
  seen.forEach((hits, key) => { if(hits.length > 1) out.push({ key: key, hits: hits }); });
  out.sort((a, b) => b.hits.length - a.hits.length || (a.key < b.key ? -1 : 1));
  return out;
}
/**
 * 最坏情况单次触发量（0.7.0，N2；0.10.0 搬到本文件，范围由调用方决定）。
 *
 * 为什么不能只看总量：`token_budget` 管的是**一轮对话**里世界书能塞多少，而真正的坑是
 * 「用户随便一句话被好几个条目同时命中」—— 实测：总量 2272 / 预算 1200 看着只是超一点，
 * 但一句「剑冢到底是什么地方」单独就吃掉 1139 token。
 * 更糟的是它太好「修好」了：把 token_budget 调大，lint 立刻只剩一条 warning，可单次爆炸一点没变。
 *
 * 算法：把**共享同一个触发词的条目**并成一组（传递闭包 —— A/B 共享 x、B/C 共享 y，那么一句话
 * 可以把三条全带出来），再叠加**每轮必插的 constant**，取最大的那组作为最坏情况。
 * 单字符 key 不参与共现（"a" 这种会把整本书并成一组，报告全是噪音）。
 */
function worstCaseTrigger(entries){
  const list = (Array.isArray(entries) ? entries : []).filter(e => e && e.enabled !== false);
  const constantEntries = list.filter(e => e.constant);
  const constantTokens = constantEntries.reduce((n, e) => n + estimateTokens(e && e.content), 0);
  const varEntries = list.filter(e => !e.constant);
  const parent = new Map();
  const find = x => { let r = x; while(parent.get(r) !== r) r = parent.get(r); while(parent.get(x) !== r){ const nx = parent.get(x); parent.set(x, r); x = nx; } return r; };
  varEntries.forEach((e, i) => parent.set(i, i));
  const byKey = new Map();
  varEntries.forEach((e, i) => {
    (Array.isArray(e.keys) ? e.keys : []).forEach(k => {
      const kk = String(k).trim().toLowerCase();
      if(kk.length < 2) return;
      if(!byKey.has(kk)) byKey.set(kk, []);
      byKey.get(kk).push(i);
    });
  });
  byKey.forEach(idxList => { for(let i = 1; i < idxList.length; i++) parent.set(find(idxList[i]), find(idxList[0])); });
  const groups = new Map();
  varEntries.forEach((e, i) => {
    const root = find(i);
    if(!groups.has(root)) groups.set(root, { tokens: 0, names: [] });
    const g = groups.get(root);
    g.tokens += estimateTokens(e && e.content);
    g.names.push(String((e && e.name) || ""));
  });
  let best = { tokens: constantTokens, names: [] };
  groups.forEach(g => {
    if(g.tokens + constantTokens > best.tokens) best = { tokens: g.tokens + constantTokens, names: g.names.slice() };
  });
  // 单条自己就最重的情况已含在上面（没有共享 key 的条目自成一组），这里只把常驻条目的名字补进名单。
  const names = best.names.concat(constantEntries.map(e => String((e && e.name) || "")));
  return { tokens: best.tokens, constantTokens, entries: names };
}
/**
 * 世界书条目的**逐条质量检查** —— 一把尺子，卡内与共享书共用。
 *
 * 四类：非 constant 却没 keys / keys 只有维度名 / keys 与正文无交集 / 触发词被多条条目共用。
 *
 * 为什么收口（第五轮报告）：这四类此前只写在 `cc_lint_lorebook` 里、只作用于**卡内**，当时的理由是
 * 「共享书条目的质量走 `cc_get_shared_book` 那条线」—— 可那条线上**根本没有这个能力**（只有重复检测），
 * 于是共享书成了没人体检的一格：往书里塞一条同时踩三类的坏条目，两个工具都不出声。
 * 而共享书恰恰**比卡内更需要主动报**：它多卡共用（一条死 key 在**所有**成员卡上都不生效）、
 * 又**没有「卡」这个载体**（用户不会顺手翻到它）。
 *
 * 用法：`auditLoreEntries([{ source:"card", entries }, { source:"shared", entries: sharedEntries }])`。
 * 来源标签可以更细（0.10.0 起组体检会传 `card:<id>` / `book`）—— 单卡调用时的输出与 0.9.x 逐字一致。
 * 触发词冲突**跨来源一起算** —— 同一个词同时命中卡内与共享书的两条，是真实存在的 token 叠加。
 * 每条 issue 带 `entries`（条目名，冲突类则是**冲突的触发词**）、`contentKeys`（便于直接定位改）、
 * 与 `source`（单一来源名 / `mixed`）。
 */
function auditLoreEntries(groups){
  const gs = (Array.isArray(groups) ? groups : []).map(g => ({
    source: String((g && g.source) || "card"),
    list: (g && Array.isArray(g.entries) ? g.entries : []).filter(e => e && e.enabled !== false),
  }));
  const all = gs.reduce((n, g) => n.concat(g.list), []);
  // 来源按**对象身份**查（以前是 indexOf 线性查找 —— 条目一多就是 O(n²)，组体检会把整组条目并起来算）
  const ownerOf = new Map();
  gs.forEach(g => g.list.forEach(e => { if(!ownerOf.has(e)) ownerOf.set(e, g.source); }));
  const sourceOf = (e) => ownerOf.get(e) || "card";
  const srcOf = (items) => { const out = []; items.forEach(e => { const s = sourceOf(e); if(out.indexOf(s) < 0) out.push(s); }); return out.length > 1 ? "mixed" : (out[0] || "card"); };
  const issues = [];
  const push = (level, code, message, items) => issues.push({ level, code, message,
    entries: items.map(e => String((e && e.name) || "")).filter(Boolean),
    contentKeys: items.map(contentKeyOf), source: srcOf(items) });
  const isDimKey = k => AUTO_NAMES.has(String(k)) || ["timeline","faction","geography","power","daily"].includes(String(k));
  const nonConst = all.filter(e => !e.constant);
  const keyed = nonConst.filter(e => Array.isArray(e.keys) && e.keys.length > 0);
  const noKeys = nonConst.filter(e => !Array.isArray(e.keys) || e.keys.length === 0);
  if(noKeys.length) push("error", "no-keys", noKeys.length + " 条非 constant 条目没有 keys（永远触发不了）", noKeys);
  const dimOnly = keyed.filter(e => e.keys.every(isDimKey));
  if(dimOnly.length) push("error", "dim-only-keys", dimOnly.length + " 条条目的 keys 只有维度名，真实对话不会命中（可用 cc_simulate_trigger 验证）", dimOnly);
  const notInContent = keyed.filter(e => !e.keys.some(k => String(e.content || "").indexOf(String(k)) >= 0));
  if(notInContent.length) push("warn", "key-not-in-content", notInContent.length + " 条条目的 keys 在自身 content 里找不到（可能误填或内容已改）", notInContent);
  const seen = new Map();
  all.forEach(e => (Array.isArray(e.keys) ? e.keys : []).forEach(k => {
    const kk = String(k).toLowerCase();
    if(!seen.has(kk)) seen.set(kk, []);
    const arr = seen.get(kk);
    if(arr.indexOf(e) < 0) arr.push(e);
  }));
  const dup = [...seen.entries()].filter(p => p[1].length > 1);
  if(dup.length){
    const items = [];
    dup.forEach(p => p[1].forEach(e => { if(items.indexOf(e) < 0) items.push(e); }));
    issues.push({ level: "warn", code: "duplicate-keys",
      message: dup.length + " 个触发词被多条条目共用（会同时触发，可能互相打架）",
      entries: dup.map(p => p[0]),          // 与既有行为一致：这一项的 entries 是**冲突的触发词**
      contentKeys: items.map(contentKeyOf), source: srcOf(items) });
  }
  return { issues, errorCount: issues.filter(i => i.level === "error").length };
}

/**
 * 跨成员卡找「同一份设定」+「卡内条目与共享书逐字重复」（纯函数，0.9.0 起就有，0.10.0 搬到这里共用）。
 *
 * `candidates`：内容签名相同、出现在 **≥2 张卡**里的条目（动作 = 提升到共享书）。
 * `bookDupes`  ：卡内条目与共享书**逐字相符**（动作 = 只清理卡内副本，不必再搬进书）。
 * 只报候选、不下结论 —— 同内容不同名、同名不同内容都如实标注（nameMismatch / keysMismatch）。
 * ⚠️ 签名（contentKeyOf）只用来**筛**，判等一律再逐字比对内容 —— 哈希碰撞绝不能变成搬错数据。
 */
function scanSharedEntries(cards, bookEntries){
  const list = Array.isArray(cards) ? cards : [];
  const seen = new Map();
  list.forEach(c => {
    (Array.isArray(c.entries) ? c.entries : []).forEach(e => {
      if(!String((e && e.content) || "").trim()) return;
      const sig = contentKeyOf(e);
      if(!seen.has(sig)) seen.set(sig, { signature: sig, content: String(e.content), name: String(e.name || ""), keys: (e.keys || []).map(String), constant: e.constant === true, chars: String(e.content).length, cards: [], cardNames: [], nameMismatch: false, keysMismatch: false });
      const g = seen.get(sig);
      if(g.cards.indexOf(c.id) < 0){ g.cards.push(c.id); g.cardNames.push(c.name); }
      if(String(e.name || "") !== g.name) g.nameMismatch = true;
      if(JSON.stringify((e.keys || []).map(String)) !== JSON.stringify(g.keys)) g.keysMismatch = true;
    });
  });
  const candidates = [...seen.values()].filter(g => g.cards.length >= 2)
    .sort((a, b) => b.cards.length - a.cards.length || b.chars - a.chars)
    .map(g => Object.assign({}, g, { preview: g.content.slice(0, 80).replace(/\s+/g, " "), savedChars: g.chars * (g.cards.length - 1) }));
  // 第二轮报告 P1：还有一类重复是「卡 ↔ 共享书」—— `cc_apply_shared_book` 回填进卡里的副本。
  // 它和「卡间重复」的**动作不同**：书里已经有了，只需把卡里那份删掉，不必再往书里搬。
  // 判据同样是**逐字相符**（签名只用来筛候选）；回填过的、手工抄进卡的都算。
  const bookDupes = [];
  (Array.isArray(bookEntries) ? bookEntries : []).forEach(be => {
    const content = String((be && be.content) == null ? "" : be.content);
    const g = content.trim() ? seen.get(contentKeyOf(be)) : null;
    if(!g || g.content !== content) return;
    bookDupes.push({ kind: "card-vs-book", signature: g.signature, name: String((be && be.name) || g.name || ""),
      content, keys: (be.keys || []).map(String), chars: content.length,
      cards: g.cards.slice(), cardNames: g.cardNames.slice(),
      preview: content.slice(0, 80).replace(/\s+/g, " "), savedChars: content.length * g.cards.length });
  });
  const totalEntries = list.reduce((n, c) => n + (Array.isArray(c.entries) ? c.entries.length : 0), 0);
  return { candidates, bookDupes, stats: { cards: list.length, totalEntries,
    duplicatedEntries: candidates.reduce((n, g) => n + g.cards.length, 0),
    savedChars: candidates.reduce((n, g) => n + g.savedChars, 0),
    bookDuplicatedEntries: bookDupes.reduce((n, g) => n + g.cards.length, 0),
    bookDupeCount: bookDupes.length,
    bookSavedChars: bookDupes.reduce((n, g) => n + g.savedChars, 0) } };
}

/**
 * 卡组检查注册表 —— **卡组的下一个新功能就是往这里加一项**（0.10.0 的验收标准）。
 *
 * 为什么做成注册表而不是再多一个工具：0.8/0.9 两轮里，「卡组体检」的能力是长在 checkGroup 里的一个
 * if 序列，而「共享书质量」长在 cc_get_shared_book 里、重复检测又长在 scanSharedEntries 里 ——
 * 三个地方各报各的，用户看到的是三份格式相近、口径不同的清单（issue 的 code / level / refs 各一套）。
 * 现在一份清单、一套 issue 形状、一个 byCheck 计数；加一项检查 = 加一个 code + 一段 run 逻辑，
 * 不需要动任何既有工具的口径（`tests/group-layer-guard.test.mjs` 会钉住这一点）。
 *
 * 每个 code 只归属一个类别 —— 否则 byCheck 会出现「同一个 code 算两次」的糊涂账。
 */
const GROUP_CHECKS = [
  { id: "structure",    title: "图谱结构",       codes: ["dangling-edge", "orphan-node", "duplicate-name", "type-unknown"] },
  { id: "relations",    title: "卡内关系段",     codes: ["unrendered", "stale-render"] },
  { id: "budget",       title: "群聊固定开销",   codes: ["constant-budget"] },
  { id: "lore-quality", title: "共享书条目质量", codes: ["no-keys", "dim-only-keys", "key-not-in-content", "duplicate-keys"] },
  { id: "cross-card",   title: "跨卡一致性",     codes: ["cross-card-duplicate-keys", "book-duplicate-in-card", "world-drift", "card-auto-only"] },
];

/**
 * 跑一组检查（纯函数）。入参：
 *   { group（已 normalize）, members: [cardId], cards: [{id,name,description,constantTokens,tokenBudget}],
 *     sharedEntries, metrics（可选：groupMetrics 的结果，预算类检查的数字来源）, opts: { checks: [类别 id] } }
 * 出参：{ issues, errorCount, stats, byCheck, ran }
 *
 * `issues[].refs` 的语义与 0.8/0.9 完全一致（节点 id / 边 id / 卡 id），新增 `check` 字段标明类别。
 * **不传 metrics 时退化为自己求和** —— 这样老的 `checkGroup(group, members, cards, sharedEntries)`
 * 调用点（含既有测试）行为逐字不变。
 */
function runGroupChecks(input){
  const opt = input || {};
  const g = opt.group || {};
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  const rev = Number(g.rev) || 0;
  const cards = Array.isArray(opt.cards) ? opt.cards : [];
  const members = Array.isArray(opt.members) ? opt.members : [];
  const sharedEntries = Array.isArray(opt.sharedEntries) ? opt.sharedEntries : [];
  const metrics = opt.metrics || null;
  // scope（groupScope 的结果）：跨卡一致性检查要成员卡的**条目与五维** —— cards 摘要是给关系类检查用的，
  // 里面没有条目。没传 scope 时 cross-card 整类自动跳过（老的 checkGroup 调用点就是这个情形）。
  const scope = opt.scope || null;
  const want = (opt.opts && Array.isArray(opt.opts.checks) && opt.opts.checks.length)
    ? opt.opts.checks.map(String) : GROUP_CHECKS.map(c => c.id);
  const on = (id) => want.indexOf(id) >= 0;
  const issues = [];
  const add = (check, level, code, message, refs) => issues.push({ check: check, level: level, code: code, message: message, refs: refs || [] });

  const nodeIds = new Set(nodes.map(n => n.id));
  const byId = new Map(cards.map(c => [c.id, c]));
  const memberCards = members.map(m => byId.get(m)).filter(Boolean);

  // —— 图谱结构（0.8.0 起就在报的四类）——
  if(on("structure")){
    const dangling = edges.filter(e => !nodeIds.has(e.from) || !nodeIds.has(e.to));
    if(dangling.length) add("structure", "error", "dangling-edge", dangling.length + " 条关系的端点节点已不存在（数据可能被外部改坏）", dangling.map(e => e.id));
    const orphans = nodes.filter(n => n.kind === "card" && n.cardId && !byId.has(n.cardId));
    if(orphans.length) add("structure", "warn", "orphan-node", orphans.length + " 个节点指向的卡已不在库里：" + orphans.map(n => n.name).join("、"), orphans.map(n => n.id));
    const seen = new Map();
    nodes.forEach(n => [n.name].concat(n.aliases || []).forEach(x => {
      const k = String(x || "").toLowerCase();
      if(!k) return;
      if(!seen.has(k)) seen.set(k, []);
      if(seen.get(k).indexOf(n.id) < 0) seen.get(k).push(n.id);
    }));
    const dup = [...seen.entries()].filter(p => p[1].length > 1);
    if(dup.length) add("structure", "error", "duplicate-name", dup.length + " 组名字/别名落在多个节点上（渲染会指向同一个人）：" + dup.map(p => p[0]).join("、"), []);
    const unknown = edges.filter(e => REL_TYPES.indexOf(e.type) < 0);
    if(unknown.length) add("structure", "warn", "type-unknown", unknown.length + " 条关系用了未知类型", unknown.map(e => e.id));
  }

  // —— 卡内【关系】段（渲染过没有 / 是否落后于图谱 rev）——
  if(on("relations")){
    const unrendered = [], stale = [];
    memberCards.forEach(c => {
      const desc = String(c.description || "");
      const i = desc.indexOf(REL_BEGIN), j = desc.indexOf(REL_END);
      if(i < 0 || j < 0){ unrendered.push(c.id); return; }
      const m = /cc-relations:begin rev=(\d+)/.exec(desc.slice(i, j));
      if(!m || Number(m[1]) !== rev) stale.push(c.id);
    });
    if(unrendered.length) add("relations", "warn", "unrendered", unrendered.length + " 张成员卡的 description 里还没有【关系】段（关系目前只存在于图谱里，导出的卡看不到）", unrendered);
    if(stale.length) add("relations", "warn", "stale-render", stale.length + " 张成员卡的【关系】段落后于图谱（标记里的 rev 与当前 rev 不一致），建议重新渲染", stale);
  }

  // —— 群聊每轮固定开销（成员卡 constant + 共享书 constant vs 最小预算）——
  // 数字优先取 metrics.derived.groupConstant（卡组层那唯一一份口径）；没传就按老算法自己求和。
  const gc = (metrics && metrics.derived && metrics.derived.groupConstant) ? metrics.derived.groupConstant : null;
  const cardConst = gc ? gc.card : memberCards.reduce((n, c) => n + (Number(c.constantTokens) || 0), 0);
  const sharedConst = gc ? gc.shared : sharedEntries
    .filter(e => e && e.enabled !== false && e.constant)
    .reduce((n, e) => n + estimateTokens(e && e.content), 0);
  const constTokens = cardConst + sharedConst;
  const minBudget = gc ? gc.minBudget
    : (memberCards.length ? memberCards.reduce((n, c) => Math.min(n, Number(c.tokenBudget) || 1200), Infinity) : 1200);
  if(on("budget") && (memberCards.length > 1 || sharedConst > 0) && constTokens > minBudget * 0.8){
    add("budget", "warn", "constant-budget", "群聊每轮固定开销偏高：成员卡常驻 " + cardConst
      + (sharedConst ? " + 共享书常驻 " + sharedConst : "") + " = 合计约 " + constTokens
      + " token（已达最小预算 " + minBudget + " 的 " + Math.round(constTokens / minBudget * 100) + "%）");
  }

  // —— 共享书**自身**的条目质量（多卡共用 → 坏 key 的代价 ×成员数）——
  if(on("lore-quality") && sharedEntries.length){
    auditLoreEntries([{ source: "book", entries: sharedEntries }]).issues
      .forEach(i => issues.push({ check: "lore-quality", level: i.level, code: i.code, message: i.message, refs: [], contentKeys: i.contentKeys, source: i.source }));
  }

  // —— 跨卡一致性（0.10.0 新增的类别；用户的第 5 个卡组功能就落在这里）——
  // 单卡体检永远看不到这些问题：它们在「卡与卡之间」，而共享书既是成员又是被比较的对象。
  if(on("cross-card") && scope){
    const mems = (Array.isArray(scope.members) ? scope.members : []).map(m => ({
      id: String((m && m.id) || ""),
      name: String((m && m.name) || ""),
      entries: (m && Array.isArray(m.entries)) ? m.entries : [],
      world: (m && m.world && typeof m.world === "object") ? m.world : {},
    }));

    // ① 跨卡触发词冲突（含共享书）：全组并查集，同一个词被多条共用 → 一句话同时带出它们
    // ⚠️ 只报**涉及 ≥2 个来源**的（卡↔卡 / 卡↔书）：同一张卡内部两条条目撞词是单卡世界书的自检
    // （cc_lint_lorebook 的 duplicate-keys 已经在报），放在这里报会变成对同一个问题喊两次。
    const dupKeys = duplicateKeyGroups(
      mems.map(m => ({ kind: "card", id: m.id, name: m.name, entries: m.entries }))
        .concat([{ kind: "book", id: "", entries: sharedEntries }]))
      .filter(d => {
        const srcs = [];
        d.hits.forEach(h => { const tag = h.kind + ":" + h.id; if(srcs.indexOf(tag) < 0) srcs.push(tag); });
        return srcs.length > 1;
      });
    if(dupKeys.length){
      const who = [];
      dupKeys.forEach(d => d.hits.forEach(h => {
        const tag = (h.kind === "book") ? "共享书" : (h.cardName || h.id);
        if(tag && who.indexOf(tag) < 0) who.push(tag);
      }));
      const keys = dupKeys.map(d => String(d.key));
      add("cross-card", "warn", "cross-card-duplicate-keys",
        keys.length + " 个触发词被多张卡/共享书共用（群聊时一句话会同时把它们带进上下文）："
          + keys.slice(0, 8).join("、") + (keys.length > 8 ? " 等" : "")
          + "（涉及：" + who.slice(0, 6).join("、") + "）", keys.slice(0, 8));
    }

    // ② 卡内条目与共享书**逐字重复**：书里已经有了，卡里那几份是纯浪费（还可能双重插入）
    if(sharedEntries.length && mems.length){
      const scan = scanSharedEntries(mems.map(m => ({ id: m.id, name: m.name, entries: m.entries })), sharedEntries);
      if(scan.bookDupes.length){
        const cardsHit = [];
        scan.bookDupes.forEach(d => d.cards.forEach(cid => { if(cardsHit.indexOf(cid) < 0) cardsHit.push(cid); }));
        add("cross-card", "warn", "book-duplicate-in-card",
          scan.bookDupes.length + " 条条目在卡内与共享书逐字重复（共 " + scan.stats.bookDuplicatedEntries
            + " 份副本、约 " + scan.stats.bookSavedChars + " 字符）：共享书里已经有了，用 cc_promote_shared_entries 清掉卡里那几份即可（不会再往书里加）",
          cardsHit);
      }
    }

    // ③ 组内五维漂移：同一维度在两三张卡里写成不同设定 —— 群聊时同一件事会有两套说法
    const drift = worldDriftOf(mems);
    if(drift.length){
      const totalCards = drift.reduce((n, d) => n + d.cards.length, 0);
      add("cross-card", "warn", "world-drift",
        "世界观有 " + drift.length + " 个维度在成员卡之间不一致：" + drift.map(d => WORLD_DIM_LABELS[d.dim] || d.dim).join("、")
          + "（涉及 " + totalCards + " 张卡）—— 建议把该维度的共同设定提升进共享书，各卡只留自己独有的部分",
        drift.map(d => String(d.dim)));
    }

    // ④ 成员卡的世界书全是 autoLorebook 生成的条目：在组里等于「这张卡没有自己的设定」
    const autoOnly = mems.filter(m => {
      const live = m.entries.filter(e => e && e.enabled !== false);
      return live.length > 0 && live.every(e => isAutoEntry(e));
    });
    if(autoOnly.length){
      add("cross-card", "warn", "card-auto-only",
        autoOnly.length + " 张成员卡的世界书全是 autoLorebook 生成的条目（没有共创内容）："
          + autoOnly.map(m => m.name || m.id).join("、")
          + " —— 这些卡在组里等于没有自己的设定，补 cc_add_lorebook_entries 或把共有内容并进共享书",
        autoOnly.map(m => m.id));
    }
  }

  const byCheck = {};
  GROUP_CHECKS.forEach(c => { byCheck[c.id] = issues.filter(i => i.check === c.id).length; });
  return {
    issues: issues,
    errorCount: issues.filter(i => i.level === "error").length,
    stats: { nodes: nodes.length, edges: edges.length, members: memberCards.length,
      constantTokens: { card: cardConst, shared: sharedConst, total: constTokens }, minBudget: minBudget },
    byCheck: byCheck,
    ran: want,
  };
}

export { REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END, WORLD_DIMS, WORLD_DIM_LABELS, AUTO_NAMES,
  isAutoEntry, looksLikeLegacyAuto, estimateTokens, lorebookTokens, contentKeyOf, assembleScope,
  seg, groupMetrics, lorebookMetrics, metricsBrief, worstCaseTrigger, auditLoreEntries, duplicateKeyGroups, worldDriftOf,
  scanSharedEntries, GROUP_CHECKS, runGroupChecks };
