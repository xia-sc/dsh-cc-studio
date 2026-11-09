/**
 * SillyTavern 目标适配层（0.13.0）—— ST 作为 CCv3 的一个**实现层**。
 *
 * 这里只放「ST 特有、CCv3 规范之外」的东西：
 * - PNG 的 `chara` 块（V2 回填）+ `ccv3` 块（规范 MUST）双块策略；
 * - ST 世界书 `{entries:{…}}` 的字段映射（照抄 ST 1.19 的 `convertCharacterBook()`）；
 * - `@@position` / `@@depth` / `@@role` / `@@scan_depth` / `@@additional_keys` / `@@exclude_keys`
 *   等装饰器 → ST 结构化字段的翻译；
 * - 卡内世界书（`data.character_book`）导出副本上写 `extensions.position/depth/role` ——
 *   ST 的 `convertCharacterBook()` 只读这些字段，**不解析 content 里的 `@@`**；
 * - `data.extensions.world` 角色↔世界书绑定（值 = ST 世界文件名 = sanitize 后的书名）；
 * - 能力矩阵与审计（ST 不支持 `use_regex` / `priority` / `@@is_greeting` 等，给出可读告警）。
 *
 * 纯函数、零 IO；被宿主半（index.js）与预设半（agent.js）import；浏览器半不 import（走宿主 RPC）。
 * 1.x 版本从 lib/client.js 搬来；行为与 0.12.4 的 ST 导出逐字一致（golden 见 tests/compat-adapter.test.mjs）。
 */
import { stV2Projection, sanitizeWorldName, parseDecorators, normalizeNewlines, validateDecorators } from "../core.js";

// ST 1.19 的 `newWorldInfoEntryTemplate`（完整字段集；ST 编辑器缺字段会读到 undefined）。
export const ST_ENTRY_TEMPLATE = { key:[], keysecondary:[], comment:"", content:"", constant:false, vectorized:false, selective:true, selectiveLogic:0, addMemo:false, order:100, position:0, disable:false, ignoreBudget:false, excludeRecursion:false, preventRecursion:false, matchPersonaDescription:false, matchCharacterDescription:false, matchCharacterPersonality:false, matchCharacterDepthPrompt:false, matchScenario:false, matchCreatorNotes:false, delayUntilRecursion:0, probability:100, useProbability:true, depth:4, outletName:"", group:"", groupOverride:false, groupWeight:100, scanDepth:null, caseSensitive:null, matchWholeWords:null, useGroupScoring:null, automationId:"", role:0, sticky:null, cooldown:null, delay:null, triggers:[] };
/** ST 的 `world_info_position`：before=0 / after=1 / ANTop=2 / ANBottom=3 / atDepth=4 / EMTop=5 / EMBottom=6。 */
export const ST_POSITION = { before:0, before_char:0, before_desc:0, after:1, after_char:1, after_desc:1, an_top:2, antop:2, an_bottom:3, anbottom:3, at_depth:4, atdepth:4, em_top:5, emtop:5, em_bottom:6, embottom:6 };
/** ST 的 `extension_prompt_roles`：SYSTEM 0 / USER 1 / ASSISTANT 2。 */
export const ST_ROLE = { system:0, user:1, assistant:2 };
/** ST 的 `world_info_logic`：AND_ANY 0 / NOT_ALL 1 / NOT_ANY 2 / AND_ALL 3。 */
export const ST_SELECTIVE_LOGIC = { and_any:0, not_all:1, not_any:2, and_all:3 };
/** ST 的 `??` 语义：`extensions.<key>` 优先，缺省才用默认值（与 convertCharacterBook 逐行对应）。 */
export function stExt(ext, key, dflt){ var v = ext[key]; return (v === undefined || v === null)? dflt : v; }
function intArg(v, min){
  var n = parseInt(String(v == null? "" : v).trim(), 10);
  return (isFinite(n) && n >= (min == null? 0 : min))? n : null;
}
function keyList(arg){
  return String(arg == null? "" : arg).split(",").map(function(s){ return s.trim(); }).filter(Boolean);
}
/**
 * 解析正文**开头连续**的 `@@` 行（与 ST 的 `parseDecorators` 同构：只认开头那一段）。
 *
 * 翻译 ST 不认、但 ST 有等价结构化字段的装饰器：
 * `@@position`→position、`@@depth`→position=4+depth、`@@role`→role、
 * `@@scan_depth`→scanDepth、`@@additional_keys`→keysecondary+AND_ANY、
 * `@@exclude_keys`→keysecondary+NOT_ANY、`@@sticky/@@cooldown/@@delay`→同名字段。
 * `@@activate` / `@@dont_activate` 与真正无法映射的写法原样留下 —— ST 自己有语义、或者自己会丢，不猜。
 */
export function unfurlBookDecorators(content){
  var text = String(content == null? "" : content);
  var lines = text.split("\n");
  var drop = [], pos = null, depth = null, role = null, scanDepth = null;
  var keysecondary = null, selective = null, selectiveLogic = null;
  var sticky = null, cooldown = null, delay = null;
  for(var i=0;i<lines.length;i++){
    var line = lines[i];
    if(line.slice(0,2) !== "@@") break;                    // 装饰器区到头
    if(line.slice(0,3) === "@@@") break;                   // ST 的转义写法：后面全当原文，不碰
    var m = /^@@([a-z_]+)(?:\s+(.*))?$/.exec(line.trim());
    if(!m) break;                                          // 语法可疑：整段交给 ST 自己处理
    var name = m[1], arg = String(m[2] == null? "" : m[2]).trim();
    if(name === "position"){
      // ST 没有「scenario」之类插入点；ST 自己的 convertCharacterBook 对除 before_char 之外的
      // 一律当 after —— 认不出的值就跟它的回退走，不自己发明位置。
      var p = ST_POSITION[arg.toLowerCase().replace(/[\s-]+/g,"_")];
      pos = (typeof p === "number")? p : 1;
      drop.push(i);
    } else if(name === "depth"){
      var n = intArg(arg);
      if(n !== null){ depth = n; pos = 4; drop.push(i); }
    } else if(name === "role"){
      var r = ST_ROLE[arg.toLowerCase()];
      if(r !== undefined){ role = r; drop.push(i); }
    } else if(name === "scan_depth"){
      var sd = intArg(arg);
      if(sd !== null){ scanDepth = sd; drop.push(i); }
    } else if(name === "additional_keys"){
      var ks = keyList(arg);
      if(ks.length){ keysecondary = ks; selective = true; selectiveLogic = ST_SELECTIVE_LOGIC.and_any; drop.push(i); }
    } else if(name === "exclude_keys"){
      var ks2 = keyList(arg);
      if(ks2.length){ keysecondary = ks2; selective = true; selectiveLogic = ST_SELECTIVE_LOGIC.not_any; drop.push(i); }
    } else if(name === "sticky"){
      var st = intArg(arg);
      if(st !== null){ sticky = st; drop.push(i); }
    } else if(name === "cooldown"){
      var cd = intArg(arg);
      if(cd !== null){ cooldown = cd; drop.push(i); }
    } else if(name === "delay"){
      var dl = intArg(arg);
      if(dl !== null){ delay = dl; drop.push(i); }
    }
  }
  if(!drop.length) return { position:null, depth:null, role:null, scanDepth:null, keysecondary:null, selective:null, selectiveLogic:null, sticky:null, cooldown:null, delay:null, content:text };
  var kept = lines.filter(function(_, i){ return drop.indexOf(i) < 0; });
  while(kept.length && !String(kept[0]).trim()) kept.shift();          // 删掉装饰器后留下的空行
  return { position:pos, depth:depth, role:role, scanDepth:scanDepth, keysecondary:keysecondary,
    selective:selective, selectiveLogic:selectiveLogic, sticky:sticky, cooldown:cooldown, delay:delay,
    content: kept.join("\n") };
}
/** 单条条目 → ST 条目（字段映射与优先级见上面那段注释）。 */
export function bookEntryToSt(entry, index){
  var e = entry || {};
  var ext = (e.extensions && typeof e.extensions === "object")? e.extensions : {};
  var dec = unfurlBookDecorators(e.content);
  var title = String(e.comment || e.name || "");
  var pos = dec.position;
  if(pos === null) pos = (typeof ext.position === "number")? ext.position : null;  // ST 自己的位置偏好
  if(pos === null) pos = (String(e.position || "") === "before_char")? 0 : 1;      // ST convertCharacterBook 的判据
  var id = (e.id === undefined || e.id === null || e.id === "")? index : e.id;
  var out = Object.assign({}, ST_ENTRY_TEMPLATE, {
    uid: id,
    key: Array.isArray(e.keys)? e.keys.map(String) : [],
    keysecondary: dec.keysecondary || (Array.isArray(e.secondary_keys)? e.secondary_keys.map(String) : []),
    comment: title,
    content: normalizeNewlines(dec.content),
    constant: e.constant === true,
    selective: (dec.selective !== null)? dec.selective : (e.selective === true),
    selectiveLogic: (dec.selectiveLogic !== null)? dec.selectiveLogic : stExt(ext, "selectiveLogic", 0),
    addMemo: !!title,
    order: (typeof e.insertion_order === "number")? e.insertion_order : 100,
    position: pos,
    disable: e.enabled === false,
    ignoreBudget: ext.ignore_budget === true,
    excludeRecursion: stExt(ext, "exclude_recursion", false),
    preventRecursion: stExt(ext, "prevent_recursion", false),
    matchPersonaDescription: stExt(ext, "match_persona_description", false),
    matchCharacterDescription: stExt(ext, "match_character_description", false),
    matchCharacterPersonality: stExt(ext, "match_character_personality", false),
    matchCharacterDepthPrompt: stExt(ext, "match_character_depth_prompt", false),
    matchScenario: stExt(ext, "match_scenario", false),
    matchCreatorNotes: stExt(ext, "match_creator_notes", false),
    delayUntilRecursion: stExt(ext, "delay_until_recursion", 0),
    probability: stExt(ext, "probability", 100),
    useProbability: stExt(ext, "useProbability", true),
    depth: stExt(ext, "depth", 4),
    outletName: stExt(ext, "outlet_name", ""),
    group: stExt(ext, "group", ""),
    groupOverride: stExt(ext, "group_override", false),
    groupWeight: stExt(ext, "group_weight", 100),
    scanDepth: stExt(ext, "scan_depth", null),
    caseSensitive: stExt(ext, "case_sensitive", null),
    matchWholeWords: stExt(ext, "match_whole_words", null),
    useGroupScoring: stExt(ext, "use_group_scoring", null),
    automationId: stExt(ext, "automation_id", ""),
    role: stExt(ext, "role", 0),
    vectorized: stExt(ext, "vectorized", false),
    sticky: stExt(ext, "sticky", null),
    cooldown: stExt(ext, "cooldown", null),
    delay: stExt(ext, "delay", null),
    displayIndex: stExt(ext, "display_index", index),
    extensions: ext,
    triggers: Array.isArray(ext.triggers)? ext.triggers.slice() : [],
  });
  if(dec.depth !== null && typeof dec.depth === "number") out.depth = dec.depth;
  if(dec.role !== null) out.role = dec.role;
  if(dec.scanDepth !== null) out.scanDepth = dec.scanDepth;
  if(dec.sticky !== null) out.sticky = dec.sticky;
  if(dec.cooldown !== null) out.cooldown = dec.cooldown;
  if(dec.delay !== null) out.delay = dec.delay;
  return out;
}
/**
 * 整本书 → ST 世界书。顶层只留 `entries`：ST 的世界文件就是这个形状，多一个 `spec` 就 400；
 * `data.extensions.cc`（rev / groupId / lastPromote）是插件自己的状态，不往外带。
 */
export function bookToStWorldInfo(data){
  var d = data || {};
  var out = { entries: {} };
  (Array.isArray(d.entries)? d.entries : []).forEach(function(e, i){
    var st = bookEntryToSt(e, i);
    out.entries[String(st.uid)] = st;
  });
  return out;
}
/** 共享书数据（adapter 入参可能是整本书 `{spec,data}` 或 data 本身）。 */
function bookData(book){
  return (book && book.data && typeof book.data === "object")? book.data : (book || {});
}
/** 卡内世界书导出副本：把 content 开头的装饰器翻译成 ST 会读的 `extensions.*`（ST 不解析 content）。 */
function stampCharacterBook(entries){
  if(!Array.isArray(entries)) return entries;
  entries.forEach(function(e){
    if(!e || typeof e !== "object") return;
    var dec = parseDecorators(e.content);
    var ext = Object.assign({}, (e.extensions && typeof e.extensions === "object")? e.extensions : {});
    var changed = false;
    if(dec.hasDecorators){
      dec.decorators.forEach(function(d){
        if(d.invalid) return;
        var v = String(d.value || "").toLowerCase();
        if(d.name === "position"){
          var p = ST_POSITION[v.replace(/[\s-]+/g,"_")];
          ext.position = (typeof p === "number")? p : 1; changed = true;
        } else if(d.name === "depth"){
          var n = intArg(d.value);
          if(n !== null){ ext.position = 4; ext.depth = n; changed = true; }
        } else if(d.name === "role"){
          var r = ST_ROLE[v];
          if(r !== undefined){ ext.role = r; changed = true; }
        } else if(d.name === "scan_depth"){
          var sd = intArg(d.value);
          if(sd !== null){ ext.scan_depth = sd; changed = true; }
        }
      });
    }
    if(changed) e.extensions = ext;
    e.content = normalizeNewlines(e.content);
  });
  return entries;
}
/** 一条条目的 ST 能力审计（返回 {level, code, message, refs?, contentKeys?}）。 */
function auditEntries(entries, source){
  var out = [];
  var priorityCount = 0, regexCount = 0;
  (Array.isArray(entries)? entries : []).forEach(function(e, i){
    if(!e || typeof e !== "object") return;
    var content = String(e.content == null? "" : e.content);
    var refs = [String(e.name || e.comment || e.id || ("#" + i))];
    if(e.use_regex === true) regexCount++;
    if(e.priority !== undefined && e.priority !== null) priorityCount++;
    // 装饰器：CCv3 值域错误 + ST 不支持项
    var v = validateDecorators(content);
    v.issues.forEach(function(it){
      out.push({ level: it.level === "error"? "warn": it.level, code: it.code, message: it.message + "（SillyTavern 里不会生效）", refs: refs });
    });
    var parsed = parseDecorators(content);
    parsed.decorators.forEach(function(d){
      if(d.invalid || ["activate","dont_activate","position","depth","role","scan_depth","additional_keys","exclude_keys","sticky","cooldown","delay"].indexOf(d.name) >= 0) return;
      out.push({ level: "warn", code: "st-decorator-unsupported", message: "@@" + d.name + " 是 CCv3 装饰器，但 SillyTavern 不实现它（导出后失效）", refs: refs });
    });
    // 全 @@ 无正文：ST 不会剥离（只有正文行存在时才从第一个非 @@ 行截取）
    if(parsed.hasDecorators && parsed.decoratorOnly){
      out.push({ level: "warn", code: "st-decorator-only-entry", message: "条目只有 @" + "@ 注解、没有正文：SillyTavern 会把注解原样当正文塞进 prompt", refs: refs });
    }
    // CRLF + 注解在开头：ST 不 trim \r，@@activate\r 会“删行但不生效”
    if(/\r\n/.test(content) && content.slice(0,2) === "@@"){
      out.push({ level: "warn", code: "st-crlf-decorator", message: "content 用 CRLF 换行且开头有 @@ 注解：SillyTavern 的 @@activate\\r 会静默失效（导出时已归一为 \\n）", refs: refs });
    }
  });
  if(regexCount){
    out.push({ level: "warn", code: "st-use-regex-unsupported", message: "有 " + regexCount + " 条 use_regex 条目：SillyTavern 1.19 世界书没有 use_regex 字段，正则触发词会退化成普通字符串匹配", refs: [], contentKeys: [] });
  }
  if(priorityCount){
    out.push({ level: "info", code: "st-priority-unsupported", message: "有 " + priorityCount + " 条带 priority（AgnAI 兼容字段）：SillyTavern 不读它，按 token_budget 裁剪时只看 order" });
  }
  return out;
}
/** 卡级审计（V3 独有字段在 ST 里存而不读）。 */
function auditCard(card){
  var out = [];
  var d = (card && card.data) || {};
  if(Array.isArray(d.group_only_greetings) && d.group_only_greetings.length){
    out.push({ level: "warn", code: "st-group-only-greetings", message: "group_only_greetings 有 " + d.group_only_greetings.length + " 条：SillyTavern 1.19 不读它（群聊开场请写进 alternate_greetings）" });
  }
  if(d.nickname) out.push({ level: "info", code: "st-nickname", message: "nickname 在 SillyTavern 里存而不读（{{char}} 仍用 name）" });
  if(d.creator_notes_multilingual && typeof d.creator_notes_multilingual === "object" && Object.keys(d.creator_notes_multilingual).length){
    out.push({ level: "info", code: "st-creator-notes-multilingual", message: "creator_notes_multilingual 在 SillyTavern 里存而不读（只显示 creator_notes）" });
  }
  if(Array.isArray(d.source) && d.source.length){
    out.push({ level: "info", code: "st-source", message: "source 在 SillyTavern 里原样保存、不展示" });
  }
  if(Array.isArray(d.assets) && d.assets.some(function(a){ return a && a.uri && String(a.uri).indexOf("ccdefault:") !== 0; })){
    out.push({ level: "info", code: "st-assets", message: "卡里有非 ccdefault: 的 assets：PNG/JSON 路径下 SillyTavern 不消费它们（只有 CHARX 导入会读 icon 等）" });
  }
  return out;
}
/**
 * SillyTavern 1.19 目标适配器。
 *
 * 能力矩阵记录「ST 真正支持什么」（测试与 lint 共用）：
 * - 装饰器：运行时只认 `@@activate` / `@@dont_activate`（无参）；其余由本适配器翻译成字段或告警；
 * - 世界书：只认 `{entries}` 对象形态，不认 `lorebook_v3`；
 * - 条目字段：无 `use_regex`、无 `priority`；
 * - V3 独有字段存而不读；CHARX 只导入、不导出。
 */
export const sillytavernAdapter = {
  id: "sillytavern",
  label: "SillyTavern",
  version: "1.19.0",
  capabilities: {
    lorebookV3: false,
    entriesObject: true,
    decorators: ["@@activate", "@@dont_activate"],
    translatedDecorators: ["@@position", "@@depth", "@@role", "@@scan_depth", "@@additional_keys", "@@exclude_keys", "@@sticky", "@@cooldown", "@@delay"],
    useRegex: false,
    priority: false,
    v3Fields: {
      nickname: false,
      groupOnlyGreetings: false,
      assets: "charx-only",
      creatorNotesMultilingual: false,
      source: false,
      creationDate: false,
      modificationDate: false,
    },
    charx: { import: true, export: false },
    pngReadPriority: "ccv3",
  },
  /**
   * 远程导入描述（0.15.0）：宿主半据此发 HTTP 请求，`cc_listTargets` 也把它交给客户端
   * 渲染「导入到 <平台>」区块。**纯数据**，路径/字段名是 ST 的差异唯一出处 ——
   * 别把 `/api/characters/import` 之类写进 index.js 或 client.js（家规见 AGENTS §2.9）。
   */
  remote: {
    label: "SillyTavern",
    defaultBaseUrl: "http://127.0.0.1:8000",
    auth: "basic",
    probe: { method: "GET", path: "/csrf-token" },
    version: { method: "GET", path: "/version" },
    csrf: { path: "/csrf-token", header: "x-csrf-token" },
    world: {
      list: { method: "POST", path: "/api/worldinfo/list" },
      import: { method: "POST", path: "/api/worldinfo/import", field: "avatar" },
    },
    card: {
      import: { method: "POST", path: "/api/characters/import", field: "avatar", typeField: "file_type", typeValue: "png" },
    },
  },
  /**
   * 卡导出副本：
   * - 写 ST 的世界书绑定（值 = sanitize 后的书名，与导出的世界文件名一致）；
   * - 卡内世界书条目：把 `@@position/@@depth/@@role/@@scan_depth` 写进 `extensions.*`
   *   —— ST 的 `convertCharacterBook()` 只读这些字段，不解析 content；content 保留（运行时 ST 自己剥离）。
   */
  prepareCard(card, opts){
    var world = String((opts && (opts.world || opts.stWorld)) || "").trim();
    var out = JSON.parse(JSON.stringify(card || {}));
    if(world){
      out.data = out.data || {};
      out.data.extensions = Object.assign({}, out.data.extensions);
      out.data.extensions.world = sanitizeWorldName(world);
    }
    if(out.data && out.data.character_book && Array.isArray(out.data.character_book.entries)){
      stampCharacterBook(out.data.character_book.entries);
    }
    return { card: out, warnings: auditCard(out) };
  },
  /** PNG 卡块：`chara`（V2 回填，装饰器按规范剥掉）+ `ccv3`（规范 MUST，原卡）。 */
  pngChunks(card){ return [{ keyword: "chara", json: stV2Projection(card) }, { keyword: "ccv3", json: card }]; },
  /** 共享书 → ST 原生世界书文件（顶层只有 entries）。 */
  toBookExport(book, opts){
    const data = bookData(book);
    const name = String((opts && opts.worldName) || data.name || "").trim() || "shared-lorebook";
    return {
      filename: sanitizeWorldName(name) + ".json",
      mime: "application/json",
      content: JSON.stringify(bookToStWorldInfo(data), null, 2),
      warnings: auditEntries(data.entries, "shared"),
    };
  },
  /** 目标能力审计：`{card}`（卡级）或 `{book}`/`{entries}`（世界书级）。 */
  audit(input){
    var src = input || {};
    var out = [];
    if(src.card) out = out.concat(auditCard(src.card));
    var entries = src.entries || (src.book && bookData(src.book).entries);
    if(Array.isArray(entries)) out = out.concat(auditEntries(entries, src.source));
    return out;
  },
};
