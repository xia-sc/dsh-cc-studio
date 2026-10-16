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

export { REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END, WORLD_DIMS, AUTO_NAMES,
  isAutoEntry, looksLikeLegacyAuto, estimateTokens, lorebookTokens, contentKeyOf, assembleScope,
  seg, groupMetrics, lorebookMetrics, worstCaseTrigger, auditLoreEntries, duplicateKeyGroups, worldDriftOf };
