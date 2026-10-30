/**
 * @xia-sc/dsh-cc-studio/agent — CC 模式的 Agent Tools（仅在 CC preset 挂载，合并自 dsh-cc-agent）。
 * 通过 globalThis.__CC_DRAFTS__ 与 host 共享草稿，让 LLM 的工具调用能实时反映到浏览器胶囊。
 * 强制工作流：cc_get_card → cc_patch_character → cc_patch_world(≥3维,autoLorebook) → cc_add_lorebook_entries(≥5条) → cc_patch_greetings → cc_validate
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
// 卡组层（0.10.0）：卡组作用域组装 / 世界书分段统计 / 条目体检的**唯一实现**。
// 宿主半 import 同一个文件 —— 以前这些逻辑两半各抄一份、靠测试逐字比对维持同步，
// 「改了四个、漏了第五个」就是这么来的（见 lib/group-layer.js 顶部）。
import { REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END,
  WORLD_DIMS, AUTO_NAMES, isAutoEntry, looksLikeLegacyAuto,
  estimateTokens, lorebookTokens, contentKeyOf, scanSharedEntries,
  assembleScope, groupMetrics, lorebookMetrics, metricsBrief, auditLoreEntries, runGroupChecks } from "./group-layer.js";
// 草稿锁的判定与常量（0.11.0）：两半共用 lib/draft-lock.js —— 「锁算不算 active / 超时算不算过期」只有一份实现。
// 与 group-layer.js 同一个教训：两半各写一份判定必然漂移，一边说锁住了、另一边照写，比没有锁更危险。
// 这里只 import 工具半真正用到的：上锁时写 owner、读回时归一、返回时给摘要。
import { LOCK_OWNER_LLM, normalizeLock, lockSummary } from "./draft-lock.js";
const name = "dsh-cc-studio-agent";
// 版本标识（0.7.1）：每次工具返回都带 `build`。
// 由来：第五轮实测里测试者第一遍跑出「四项全无变化」，其实只是**没重启 dsh** —— LLM 侧完全无法
// 分辨「代码没改」和「改了但没加载」。有了这个字段，任何一次调用都能先确认自己测的是哪一版。
// 发版时与 package.json 的 version 同步。
const BUILD = "0.11.5";
const inject = ["tools", "agents"];

function nowSec(){ return Math.floor(Date.now()/1000); }

// ── 字面转义解码（0.10.3，用户实机报告 P1）──────────────────────────────────────────
// 模型在 tool call 的 JSON 里经常把换行写成**字面** `\n`（JSON 层多转义一层：`"A\\nB"`），
// JSON.parse 之后字符串里就是「反斜杠 + n」两个字符。以前这些工具原样落盘，导出的卡在
// SillyTavern 里就显示「说完这句话。\n\n下一段」——同一张卡里有的字段正常、有的不正常
// （模型这次写对了），肉眼极难发现（用户实测 18 次调用里 6 次中招）。
// 卡内文本没有「字面反斜杠 n」的正当用途，所以写类工具统一把字面 `\n` / `\r` / `\t` 解成
// 真字符；多层转义（`A\\\\nB`）逐层收敛（最多 4 轮）。只作用于**模型输入的工具参数**，
// 不动工坊保存与导入路径（那两条链路本来就是真换行）。
function decodeEscapedText(v){
  if(typeof v !== "string" || v.indexOf("\\") < 0) return v;
  var s = v;
  for(var round = 0; round < 4; round++){
    var next = s
      .replace(/\\\\/g, "\u0000")   // 成对反斜杠先占位，避免被下面的 \n 规则重复匹配
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\u0000/g, "\\");
    if(next === s) break;
    s = next;
  }
  return s;
}
/** 工具参数里的文本字段：先解码字面转义，再按旧规则 String()。 */
function textArg(v){ return decodeEscapedText(String(v == null ? "" : v)); }

function draftsMap(){ if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map(); return globalThis.__CC_DRAFTS__; }
// —— 落盘根（0.3.6 起统一，与 lib/index.js 是同一套）：DSH_HOME 优先，homedir()/.dsh 兜底 ——
// 草稿与角色库都必须与宿主半算出**同一个路径**，否则又会退化成 issue #5 那种「两边互相看不见」。
// 读盘回退旧根（0.3.6 之前写死 homedir()/.dsh），写在主根。
function legacyDshHomeDir(){
  try{ return join(homedir(), ".dsh"); }catch{ return join(process.cwd(), ".dsh"); }
}
function dshHomeDir(){
  const env = process.env.DSH_HOME;
  if(typeof env === "string" && env.trim().length > 0) return env.trim();
  return legacyDshHomeDir();
}
function dataRoots(sub){
  const primary = join(dshHomeDir(), sub);
  const legacy = join(legacyDshHomeDir(), sub);
  return primary === legacy ? [primary] : [primary, legacy];
}
// —— 草稿持久化（fix #2）：与 host 半共享 <主根>/cc-drafts，变更即落盘，重启后恢复 ——
if(!globalThis.__CC_DRAFT_META__) globalThis.__CC_DRAFT_META__ = new Map();
function draftDirs(){ return dataRoots("cc-drafts"); }
function draftDir(){ return draftDirs()[0]; }
function safeDraftFile(key){
  const raw = String(key || "default");
  let h = 0;
  for(let i=0;i<raw.length;i++){ h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0; }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  const safe = (raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48)) || "default";
  return safe + "-" + hex + ".json";
}
function draftPath(key){ return join(draftDir(), safeDraftFile(key)); }
/** 读盘用：主根没有就回退旧根（0.3.6 之前草稿写死的地方）。找不到返回 null。 */
function findDraftPath(key){
  const file = safeDraftFile(key);
  for(const dir of draftDirs()){
    const p = join(dir, file);
    try{ if(existsSync(p)) return p; }catch{}
  }
  return null;
}
function loadPersistedDraftSync(key){
  try{
    const p = findDraftPath(key);
    if(!p) return null;
    const raw = readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    const d = obj && obj.draft ? obj.draft : null;
    if(d && typeof d === "object" && d.spec === "chara_card_v3" && d.data && typeof d.data === "object") return d;
  }catch{}
  return null;
}
function persistDraftSync(key, draft){
  try{
    mkdirSync(draftDir(), { recursive: true });
    // revision（0.6.0，P0-6）：工具半与宿主半各持各的内存、各写各的文件，**只有文件里的 rev 是共同真相**。
    // 每次落盘 +1；工具侧据此发现「草稿被外部（工坊界面操作 / host 恢复）换过了」——
    // 第二轮实测正是栽在这里：LLM 基于过期草稿 patch，把用户刚改好的 personality 静默清空了。
    let rev = 1;
    try{
      const prev = JSON.parse(readFileSync(draftPath(key), "utf8"));
      if(prev && typeof prev.rev === "number" && prev.rev > 0) rev = prev.rev + 1;
    }catch{}
    writeFileSync(draftPath(key), JSON.stringify({ key: String(key), updatedAt: nowSec(), rev, draft }, null, 2), "utf8");
    return rev;
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft failed:", (e && e.message) || e); }catch{} return null; }
}
/** 盘上这份草稿的 rev（没有文件 / 0.5.x 及以前的旧格式 → null）。 */
function draftRevOnDisk(key){
  try{
    const p = findDraftPath(key);
    if(!p) return null;
    const obj = JSON.parse(readFileSync(p, "utf8"));
    return (obj && typeof obj.rev === "number") ? obj.rev : null;
  }catch{ return null; }
}
// —— 草稿的「来源 id」sidecar（0.5.0，修 P0-4）——
// `cc_load_from_library` 的工具文档承诺「载入后再次保存将按此 ID 更新」，但草稿里此前**没有任何地方
// 记住这个 id**，于是不传 id 保存就新建了一张同名重复卡 —— 用户载入自己的卡、改两笔、保存，侧边栏
// 就多一张重复，反复几次一地垃圾而用户毫无察觉（LLM 侧回环测试实测）。
// 存 sidecar 而不是塞进 draft.extensions：后者会跟着导出进用户的卡里。
function originPath(key){ return join(draftDir(), safeDraftFile(key).replace(/\.json$/, ".origin.json")); }
function readOriginSync(key){
  try{
    const p = originPath(key);
    if(!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, "utf8"));
    if(obj && typeof obj.libraryId === "string" && obj.libraryId) return obj;
  }catch{}
  return null;
}
function writeOriginSync(key, libraryId, name){
  try{
    if(!libraryId){ try{ unlinkSync(originPath(key)); }catch{} return; }
    mkdirSync(draftDir(), { recursive: true });
    writeFileSync(originPath(key), JSON.stringify({ key: String(key), libraryId: String(libraryId), name: String(name||""), savedAt: nowSec() }, null, 2), "utf8");
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft origin failed:", (e && e.message) || e); }catch{} }
}
// —— 草稿锁的 IO（0.11.0）——
// 背景：LLM 正在工坊草稿里创作 A 卡时，用户点「载入」B 卡会把同一会话槽的草稿整份替换，
// LLM 已写入但未保存的内容只能从历史对话里捞。现在工具半**每次写草稿**都给这把槽上一把创作锁，
// 用户侧（宿主 RPC）看到 active 锁就只读 / 进预览；交还由 LLM 调 `cc_release_draft` 完成，
// 另有 TTL 兜底（防 LLM 崩溃后把工坊永久锁死）。
//
// 判定（active / stale / 能不能写）全在 lib/draft-lock.js，两半共用 —— 这里只负责落盘，
// 与 .origin.json 同模式：<safeDraftFile 去 .json>.lock.json。**不写进草稿 JSON**：
// 用户只读与 LLM 交还都不重写草稿，草稿的 `rev` 仍然只反映内容变化。
function draftLockPath(key){ return join(draftDir(), safeDraftFile(key).replace(/\.json$/, ".lock.json")); }
/** 读锁：主根没有就回退旧根（与草稿/来源 sidecar 同一套规则）。损坏 / key 不符一律当「无锁」（见 normalizeLock）。 */
function readDraftLockSync(key){
  const file = safeDraftFile(key).replace(/\.json$/, ".lock.json");
  for(const dir of draftDirs()){
    const p = join(dir, file);
    try{
      if(!existsSync(p)) continue;
      return normalizeLock(JSON.parse(readFileSync(p, "utf8")), String(key));
    }catch(e){}
  }
  return null;
}
/** 写锁：失败只 console.error 不抛 —— 锁是保护用户数据的附加层，写锁失败不能反过来弄坏一次正常的工具调用。 */
function writeDraftLockSync(key, lock){
  try{
    mkdirSync(draftDir(), { recursive: true });
    writeFileSync(draftLockPath(key), JSON.stringify(lock, null, 2), "utf8");
    return true;
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft lock failed:", (e && e.message) || e); }catch{} return false; }
}
/** 清锁：两个根都删 —— 旧根若残留同一把锁，回退读会把它当成本槽的锁，LLM 的「交还」就不算数了。 */
function clearDraftLockSync(key){
  const file = safeDraftFile(key).replace(/\.json$/, ".lock.json");
  for(const dir of draftDirs()){
    try{ unlinkSync(join(dir, file)); }catch(e){}
  }
}
function draftLockSummaryFor(key){ return lockSummary(readDraftLockSync(key), nowSec()); }
/**
 * 上锁 / 续期：LLM 每次写草稿（含「内容无变化」的空写）都调这里。
 * `since` 只在第一次上锁时记下来 —— 它回答「从什么时候开始创作」，每次写都重置就没有意义了。
 * `rev` 取本次落盘后的版本（空写时取内存里记着 / 盘上实际那个），**绝不留 undefined**
 * （B1 的 lossless-JSON 教训：一个 undefined 就让整次工具调用报错）。
 */
function refreshDraftLock(key, draft, rev){
  const k = String(key);
  const prev = readDraftLockSync(k);
  const now = nowSec();
  const cardName = (draft && draft.data && String(draft.data.name || "").trim()) || "";
  const lock = {
    key: k,
    owner: LOCK_OWNER_LLM,
    since: (prev && prev.since > 0) ? prev.since : now,
    updatedAt: now,
    rev: (typeof rev === "number" && rev > 0) ? rev : ((prev && prev.rev) || 0),
    cardName: cardName.slice(0, 120),
  };
  writeDraftLockSync(k, lock);
  return lock;
}
function draftMeta(key){
  const k = String(key || "default");
  if(!globalThis.__CC_DRAFT_META__.has(k)) globalThis.__CC_DRAFT_META__.set(k, { isNew: false, recovered: false, rev: null, pendingFresh: null });
  return globalThis.__CC_DRAFT_META__.get(k);
}
/**
 * 草稿状态（0.6.0，P0-6）：**把「身份」和「会话槽」分开说清楚**。
 * 旧版只有 `key`，而它是会话槽标识（同一会话里恒定不变）+ `isNew`，两个看起来都能标识草稿的字段
 * 其实都不承载卡片身份 —— 第二轮实测中草稿被外部换成另一张卡后，LLM 完全无法察觉。
 * 现在：`sessionKey`（会话槽，明说它不是身份）、`cardId` / `cardName`（真正的身份）、`rev`（版本号）。
 */
function draftStatusFor(key, draft){
  const m = draftMeta(key);
  const k = String(key);
  const origin = readOriginSync(k);
  return {
    isNew: !!m.isNew,
    recovered: !!m.recovered,
    // B1（0.7.1）：`creation_date` 在外部导入的卡上可能整个缺失 —— 缺了就显式给 null，
    // 绝不让 `undefined` 漏进返回值（DSH 的 lossless-JSON 校验会因为一个 undefined 判整次调用失败）。
    creation_date: (draft && draft.data && draft.data.creation_date !== undefined) ? draft.data.creation_date : null,
    sessionKey: k,
    cardId: (origin && origin.libraryId) || null,
    cardName: (draft && draft.data && String(draft.data.name||"").trim()) || "",
    rev: (typeof m.rev === "number") ? m.rev : null,
    // 草稿锁摘要（0.11.0）：active=true 表示 LLM 正在创作，工坊只读 / 载入只预览。
    // 无锁时**显式 null**（不是省略）—— 客户端与测试都按「有值 = 摘要、null = 无锁」判断，
    // 而 undefined 还会踩 lossless-JSON（B1）。
    lock: draftLockSummaryFor(k),
    // watchedRev 由 tool() 包装在调用前捕获后注入：它 = 「本次调用开始前工具半记着的盘上版本」。
    watchedRev: null,
  };
}
/**
 * 取一次「草稿被外部改过」的提示（0.7.0：改由 `tool()` 包装按 rev 漂移驱动，不再靠 getDraft 的 flag）。
 *
 * 判据统一成一句话：**盘上的 rev 与本次调用开始前我记着的 rev 不一致** —— 也就是「在我上次动手之后、
 * 这次动手之前，有别人（工坊界面 / host 恢复 / 另一个会话）写过这份草稿」。自己写的那一次不算。
 * 这条同时兑现了 LLM 侧第四轮的 S1：**不传 expectedRev 的调用也会被提醒**（弱模型不会主动传乐观锁）。
 */
function externalChangeNotice(key, draft, fromRev, toRev){
  const name = (draft && draft.data && String(draft.data.name||"").trim()) || "（未命名）";
  const entries = (draft && draft.data && draft.data.character_book && draft.data.character_book.entries) ? draft.data.character_book.entries.length : 0;
  return "⚠️ 草稿已被外部修改（工坊界面操作或 host 恢复），已自动同步到最新版本（rev " + fromRev + " → " + toRev + "）—— 当前卡片「" + name + "」共 " + entries + " 条世界书。动手改字段前先确认卡片名对不对。";
}
/**
 * 新草稿提示（0.7.0 修 S2）。
 *
 * 原始警告说的是「此前的内容可能已丢失」，而它对**主动 cc_new_card 重置**是确凿的误报
 * （第四轮实测：刚重置完再写入，仍被吓一句）—— 误报会训练用户和模型忽略 warning。
 * 所以改成**待告知标记** `pendingFresh`：只有「内存与磁盘都没有草稿、这次调用才现建了一张空卡」
 * 时才是 `"welcome"`（真·host 重启后的新会话，提示有意义）；`cc_new_card` 主动重置则是 `null`。
 * 用标记而不是当场判断，是因为提示要由 `tool()` 包装在**调用之后**统一发出，那时 `setDraft`
 * 已经把 `isNew` 清掉了。
 */
function freshNotice(meta){
  if(!meta || !meta.pendingFresh) return "";
  return "⚠️ 当前会话此前无草稿（可能为 host 重启后的新会话，或全新会话 id），已新建空白草稿。若此前有未 ★ 保存到侧边栏的内容可能已丢失，请先确认；如需继续旧卡请调 cc_list_library/cc_load_from_library。";
}
/** 卡片内容指纹（忽略 modification_date）：用来判断「这次写入到底有没有真的改变内容」（N4）。 */
function cardFingerprint(draft){
  try{
    const d = JSON.parse(JSON.stringify((draft && draft.data) ? draft.data : {}));
    delete d.modification_date;
    return JSON.stringify(d);
  }catch{ return ""; }
}
function recoveredNotice(key, draft){
  const m = draftMeta(key);
  if(m && m.recovered) return "已从磁盘持久化恢复草稿（host 重启后自动恢复），creation_date=" + ((draft && draft.data && draft.data.creation_date) || "未知") + "。";
  return "";
}
function keyFor(ctx, exec){
  try{
    if(exec && exec.agent){
      const a=exec.agent;
      if(a.session && a.session.id) return String(a.session.id);
      if(a.id) return String(a.id);
      if(a.sessionId) return String(a.sessionId);
    }
  }catch{}
  try{
    const agents = ctx.get("agents");
    if(agents && agents.currentInitiator){
      const cur = agents.currentInitiator();
      if(cur){
        if(cur.session && cur.session.id) return String(cur.session.id);
        if(cur.id) return String(cur.id);
        if(cur.sessionId) return String(cur.sessionId);
      }
    }
  }catch{}
  return "default";
}
/** 空白卡（新草稿与 cc_new_card 共用一份定义，避免两处漂移） */
function makeEmptyCard(){
  return {
    spec:"chara_card_v3", spec_version:"3.0",
    data:{
      name:"", nickname:"", tags:[], creator:"", character_version:"0.1",
      description:"", personality:"", scenario:"", system_prompt:"", post_history_instructions:"",
      first_mes:"", alternate_greetings:[], group_only_greetings:[], mes_example:"",
      creator_notes:"", creator_notes_multilingual:{}, source:[], assets:[{type:"icon",uri:"ccdefault:",name:"main",ext:"png"}],
      creation_date: nowSec(), modification_date: nowSec(),
      character_book:{ name:"", description:"", scan_depth:4, token_budget:2400, recursive_scanning:false, extensions:{}, entries:[] }
    }
  };
}
/**
 * 草稿形状规范化（0.7.1，B1）。
 *
 * 背景：DSH 对工具返回值做 lossless-JSON 校验 —— **任何嵌套 `undefined` / `NaN` / `-0` 都会让整次
 * 工具调用直接报错**（用户看到的是「工具坏了」）。第五轮实测：重启后第一次
 * `cc_get_card({fields:[...]})` 就炸在这里，报 `value is not lossless JSON`。
 *
 * 根因是**外部来源的卡结构不完整**：PNG/CHARX 导入的卡、或早期版本写下的草稿可能没有
 * `spec_version` / `creation_date` 这类字段，而代码直接读它、原样输出 → `undefined` 泄漏。
 * 所以加载草稿时**按空卡模板补齐缺失键**：只补 `undefined`，不覆盖已有值、不改类型
 * （类型不对属于内容问题，交给 cc_validate 报），下游就永远拿到完整结构。
 */
function normalizeCardShape(draft){
  const tpl = makeEmptyCard();
  if(!draft || typeof draft !== "object") return tpl;
  const out = {
    spec: (draft.spec !== undefined && draft.spec !== null) ? draft.spec : tpl.spec,
    spec_version: (draft.spec_version !== undefined && draft.spec_version !== null) ? draft.spec_version : tpl.spec_version,
    data: {},
  };
  const src = (draft.data && typeof draft.data === "object") ? draft.data : {};
  for(const k of Object.keys(tpl.data)){
    out.data[k] = (src[k] !== undefined) ? src[k] : tpl.data[k];
  }
  // 模板之外的字段（用户扩展 / 未来版本新增）原样保留，别吃掉
  for(const k of Object.keys(src)){ if(!(k in out.data)) out.data[k] = src[k]; }
  const book = (out.data.character_book && typeof out.data.character_book === "object") ? out.data.character_book : {};
  const bTpl = tpl.data.character_book;
  const nb = {};
  for(const k of Object.keys(bTpl)){ nb[k] = (book[k] !== undefined) ? book[k] : bTpl[k]; }
  for(const k of Object.keys(book)){ if(!(k in nb)) nb[k] = book[k]; }
  if(!Array.isArray(nb.entries)) nb.entries = [];
  if(!nb.extensions || typeof nb.extensions !== "object") nb.extensions = {};
  out.data.character_book = nb;
  if(!out.data.extensions || typeof out.data.extensions !== "object") out.data.extensions = {};
  return out;
}
/** 输出卫生（0.7.1，B1 的第二道防线）：JSON 往返一趟，丢掉任何 `undefined` 属性。 */
function sanitizeJson(value){
  try{ return JSON.parse(JSON.stringify(value)); }catch{ return value; }
}
/** 值是否真的变了（B2：`changed` 与 `rev` 必须用同一套判据，别一个说改了、一个纹丝不动）。 */
function sameJsonValue(a, b){
  if(a === b) return true;
  try{ return JSON.stringify(a) === JSON.stringify(b); }catch{ return false; }
}
/** 赋值并只在「值真的变了」时记进 `changed`（B2，见上）。 */
function assignIfChanged(target, key, value, changed){
  const before = target[key];
  target[key] = value;
  if(sameJsonValue(before, value)) return false;
  if(changed) changed.push(key);
  return true;
}
function getDraft(ctx, exec){
  const m = draftsMap();
  const k = keyFor(ctx, exec);
  const meta = draftMeta(k);
  // —— P0-6：工坊界面 / host 恢复可能在两次工具调用之间把草稿整份换掉 ——
  // 盘上的 rev 一旦与本半上次见到的不一致，就**以盘为准重载**，绝不拿过期前提去写。
  // （第二轮实测：LLM 基于旧草稿 patch，把用户刚在工坊里改好的 personality 静默清空了。）
  const diskRev = draftRevOnDisk(k);
  if(m.has(k) && diskRev !== null && meta.rev !== null && diskRev !== meta.rev){
    const latest = loadPersistedDraftSync(k);
    if(latest){
      m.set(k, normalizeCardShape(latest));
      meta.isNew = false; meta.recovered = false; meta.pendingFresh = null;
    }
  }
  if(diskRev !== null) meta.rev = diskRev;
  if(!m.has(k)){
    // fix #2：内存 miss 时先尝试从磁盘恢复，而非静默建空
    const restored = loadPersistedDraftSync(k);
    if(restored){
      m.set(k, normalizeCardShape(restored));   // B1：外部来源的卡可能缺字段，恢复时就补齐
      meta.isNew = false; meta.recovered = true; meta.pendingFresh = null;
    } else {
      m.set(k, makeEmptyCard());
      // 内存与磁盘都没有草稿 → 真·新会话：这条提示值得发（可能真丢过内容）
      meta.isNew = true; meta.recovered = false; meta.pendingFresh = "welcome";
    }
  }
  return m.get(k);
}
function setDraft(ctx, draft, exec){
  const m = draftsMap();
  const k = keyFor(ctx, exec);
  const meta = draftMeta(k);
  const prev = m.get(k);
  // N4（0.7.0）：**内容一字未变时不落盘、不递增 rev**。空改动（传了不生效的参数、同值覆盖、
  // 删 0 条条目…）原来也会把 rev 推进一格，于是持有旧 rev 的调用方会无辜失败一次
  // （第四轮实测：`changed: []` 让 rev 7 → 8）。modification_date 也要跟着不动，否则指纹永远不等。
  if(prev && cardFingerprint(prev) === cardFingerprint(draft)){
    // 但「内容没变」不代表 LLM 停手了：锁必须**续期**。updatedAt 是「还在创作」的心跳，
    // 不是「内容变了」的记号 —— 否则 LLM 连着几轮只讨论不改稿，锁会提前超时，
    // 用户又能趁它还在创作时载入别的卡。rev 优先用内存里记着的（上次自己写下的），
    // 再退盘上实际那个，绝不留 undefined（B1）。
    const idleRev = (typeof meta.rev === "number" && meta.rev > 0) ? meta.rev : (draftRevOnDisk(k) || 0);
    refreshDraftLock(k, draft, idleRev);
    return draft;
  }
  draft.data.modification_date = nowSec();
  m.set(k, draft);
  // pendingFresh 刻意不在这里清：新草稿提示由 tool() 包装在**调用之后**统一发，这里清掉就发不出来了。
  meta.isNew = false; meta.recovered = false;
  const rev = persistDraftSync(k, draft);
  if(typeof rev === "number"){
    meta.rev = rev;   // 自己写的这一次不算「外部修改」
    // 写盘成功后上锁 / 续期（0.11.0）：从这一刻起，用户侧对这份草稿的写入一律被拦，
    // 载入/导入只进只读预览 —— 直到 LLM 自己调 cc_release_draft 或锁超时。
    refreshDraftLock(k, draft, rev);
  }
  return draft;
}

// ——————————————————————————————————————————————————————————————
// 人物关系图谱（0.8.0）：分组文件 + 三维关系（方向 × 类型 × 强度）
//
// 与 lib/index.js **同构实现**（与 dataRoots / safeDraftFile 同模式）：同样的常量、同样的纯函数、
// 同样的落盘规则（写主根、读回退旧根）。tests/relations.test.mjs 会逐字比对两半渲染输出 ——
// 改这里必须同步改 lib/index.js，反之亦然。
//
// 「卡属于哪个组」记在库条目 meta.groupId（单一真源），分组文件里刻意**不存成员列表**。
// 关系只活在插件侧；要让分享出去的卡自包含，用 cc_render_relations 渲染进 description 的固定标记区。
// ——————————————————————————————————————————————————————————————
// 关系图谱常量（0.10.0 起由 lib/group-layer.js 提供，两半共用一份）—— 这里不再重复定义。

function groupDirs(){ return dataRoots("cc-groups"); }
function groupDir(){ return groupDirs()[0]; }
function safeGroupId(id){ return String(id == null ? "" : id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64); }
function groupPath(id){ return join(groupDir(), safeGroupId(id) + ".json"); }
function newGroupId(){ return Date.now() + "-" + Math.random().toString(36).slice(2, 6); }
async function ensureGroupDir(){ try{ await mkdir(groupDir(), { recursive: true }); }catch{} }
/** 与 lib/index.js 同构：那边叫 estimateTokensLite（宿主半没有 token 估算），这里复用本半已有的 estimateTokens。 */
function estimateTokensLite(text){ return estimateTokens(text); }
function relTypeOf(t){ const s = String(t == null ? "" : t); return REL_TYPES.indexOf(s) >= 0 ? s : "other"; }
function relLabel(edge){ return (edge && edge.label && String(edge.label).trim()) ? String(edge.label).trim() : (REL_TYPE_LABELS[(edge && edge.type) || "other"] || "其他"); }
function nameOfNode(nodes, id){ const n = (Array.isArray(nodes) ? nodes : []).find(x => x.id === id); return n ? (n.name || "未命名") : "（未知）"; }

/** 结构兜底。⚠️ 不丢弃端点不存在的边（那是用户数据），体检报 dangling-edge、渲染时自动跳过。 */
function normalizeGroup(g){
  const src = (g && typeof g === "object") ? g : {};
  const nodes = Array.isArray(src.nodes) ? src.nodes.filter(n => n && typeof n === "object" && n.id).map(n => ({
    id: String(n.id),
    kind: (n.kind === "card") ? "card" : "npc",
    cardId: (typeof n.cardId === "string" && n.cardId) ? n.cardId : null,
    name: String(n.name || "").slice(0, 60),
    aliases: Array.isArray(n.aliases) ? n.aliases.map(String).map(s => s.trim()).filter(Boolean).slice(0, 8) : [],
    orphanOf: (typeof n.orphanOf === "string" && n.orphanOf) ? n.orphanOf : null,
  })) : [];
  const edges = Array.isArray(src.edges) ? src.edges.filter(e => e && typeof e === "object" && e.id).map(e => ({
    id: String(e.id),
    from: String(e.from || ""),
    to: String(e.to || ""),
    type: relTypeOf(e.type),
    label: String(e.label || "").slice(0, 24),
    strength: Math.max(1, Math.min(5, Math.round(Number(e.strength) || 3))),
    direction: (e.direction === "mutual") ? "mutual" : "one-way",
    note: String(e.note || "").slice(0, 200),
    updatedAt: Number(e.updatedAt) || nowSec(),
  })) : [];
  return {
    id: safeGroupId(src.id),
    name: String(src.name || "").slice(0, 60) || "未命名分组",
    note: String(src.note || "").slice(0, 200),
    nodes, edges,
    nextNodeSeq: Math.max(1, Math.round(Number(src.nextNodeSeq) || (nodes.length + 1))),
    nextEdgeSeq: Math.max(1, Math.round(Number(src.nextEdgeSeq) || (edges.length + 1))),
    rev: Math.max(0, Math.round(Number(src.rev) || 0)),
    updatedAt: Number(src.updatedAt) || nowSec(),
  };
}
function dupNodeName(g, name, aliases, exceptId){
  const wanted = [String(name || "").trim()].concat(Array.isArray(aliases) ? aliases.map(s => String(s).trim()) : [])
    .filter(Boolean).map(s => s.toLowerCase());
  if(!wanted.length) return false;
  return g.nodes.some(n => {
    if(exceptId && n.id === exceptId) return false;
    const have = [n.name].concat(Array.isArray(n.aliases) ? n.aliases : []).filter(Boolean).map(s => String(s).toLowerCase());
    return have.some(x => wanted.indexOf(x) >= 0);
  });
}
function validateGroupOp(g, op){
  if(!op || typeof op !== "object") return "op 必须是对象";
  const kind = String(op.op || "");
  const has = (id) => g.nodes.some(n => n.id === id);
  if(kind === "addNode"){
    if(!String(op.name || "").trim()) return "addNode 需要 name";
    if(dupNodeName(g, op.name, op.aliases, null)) return "节点名或别名与组内既有节点重复：" + String(op.name).trim();
    return null;
  }
  if(kind === "updateNode"){
    const cur = g.nodes.find(n => n.id === String(op.nodeId || ""));
    if(!cur) return "节点不存在：" + op.nodeId;
    if(op.name !== undefined || op.aliases !== undefined){
      const name = (op.name !== undefined) ? op.name : cur.name;
      const aliases = (op.aliases !== undefined) ? op.aliases : cur.aliases;
      if(dupNodeName(g, name, aliases, cur.id)) return "节点名或别名与组内既有节点重复：" + String(name).trim();
    }
    return null;
  }
  if(kind === "removeNode") return has(String(op.nodeId || "")) ? null : "节点不存在：" + op.nodeId;
  if(kind === "addEdge"){
    if(!has(String(op.from || ""))) return "from 节点不存在：" + op.from;
    if(!has(String(op.to || ""))) return "to 节点不存在：" + op.to;
    if(String(op.from) === String(op.to)) return "不能给自己建关系（from 与 to 相同）";
    const st = Number(op.strength === undefined ? 3 : op.strength);
    if(!(st >= 1 && st <= 5)) return "strength 必须在 1..5";
    if(op.type !== undefined && REL_TYPES.indexOf(String(op.type)) < 0) return "type 不在枚举内：" + op.type;
    return null;
  }
  if(kind === "updateEdge"){
    const e = g.edges.find(x => x.id === String(op.edgeId || ""));
    if(!e) return "边不存在：" + op.edgeId;
    if(op.strength !== undefined){ const st = Number(op.strength); if(!(st >= 1 && st <= 5)) return "strength 必须在 1..5"; }
    if(op.type !== undefined && REL_TYPES.indexOf(String(op.type)) < 0) return "type 不在枚举内：" + op.type;
    return null;
  }
  if(kind === "removeEdge") return g.edges.some(e => e.id === String(op.edgeId || "")) ? null : "边不存在：" + op.edgeId;
  return "未知 op：" + kind;
}
function applyGroupOps(group, ops){
  const g = normalizeGroup(JSON.parse(JSON.stringify(group || {})));
  const applied = [], rejected = [];
  (Array.isArray(ops) ? ops : []).forEach(op => {
    const err = validateGroupOp(g, op);
    if(err){ rejected.push({ op, error: err }); return; }
    const kind = String(op.op);
    if(kind === "addNode"){
      const id = "n" + (g.nextNodeSeq++);
      g.nodes.push({
        id, kind: (op.kind === "card") ? "card" : "npc",
        cardId: (op.kind === "card" && op.cardId) ? String(op.cardId) : null,
        name: String(op.name).trim().slice(0, 60),
        aliases: (Array.isArray(op.aliases) ? op.aliases : []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 8),
        orphanOf: null,
      });
      applied.push({ op: kind, nodeId: id });
    } else if(kind === "updateNode"){
      const n = g.nodes.find(x => x.id === String(op.nodeId));
      if(op.name !== undefined) n.name = String(op.name).trim().slice(0, 60);
      if(op.aliases !== undefined) n.aliases = (Array.isArray(op.aliases) ? op.aliases : []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 8);
      applied.push({ op: kind, nodeId: n.id });
    } else if(kind === "removeNode"){
      const nid = String(op.nodeId);
      g.nodes = g.nodes.filter(n => n.id !== nid);
      if(op.removeEdges !== false) g.edges = g.edges.filter(e => e.from !== nid && e.to !== nid);
      applied.push({ op: kind, nodeId: nid, edgesRemoved: (op.removeEdges !== false) });
    } else if(kind === "addEdge"){
      const id = "e" + (g.nextEdgeSeq++);
      g.edges.push({
        id, from: String(op.from), to: String(op.to), type: relTypeOf(op.type),
        label: String(op.label || "").slice(0, 24),
        strength: Math.max(1, Math.min(5, Math.round(Number(op.strength === undefined ? 3 : op.strength)))),
        direction: (op.direction === "mutual") ? "mutual" : "one-way",
        note: String(op.note || "").slice(0, 200), updatedAt: nowSec(),
      });
      applied.push({ op: kind, edgeId: id });
    } else if(kind === "updateEdge"){
      const e = g.edges.find(x => x.id === String(op.edgeId));
      if(op.type !== undefined) e.type = relTypeOf(op.type);
      if(op.label !== undefined) e.label = String(op.label).slice(0, 24);
      if(op.strength !== undefined) e.strength = Math.max(1, Math.min(5, Math.round(Number(op.strength))));
      if(op.direction !== undefined) e.direction = (op.direction === "mutual") ? "mutual" : "one-way";
      if(op.note !== undefined) e.note = String(op.note).slice(0, 200);
      e.updatedAt = nowSec();
      applied.push({ op: kind, edgeId: e.id });
    } else if(kind === "removeEdge"){
      const eid = String(op.edgeId);
      g.edges = g.edges.filter(e => e.id !== eid);
      applied.push({ op: kind, edgeId: eid });
    }
  });
  g.updatedAt = nowSec();
  return { group: g, applied, rejected };
}
/**
 * 出边口径（渲染与 outgoing 计数**共用这一处**，避免「预览说 N 条、实际写出 M 条」）。
 * mutual（对等）边是双向的：不管它从哪一端写的，两端都该看到它 —— 所以「指向我的 mutual 边」
 * 也算我的出边。⚠️ 曾经 outgoing 只认 `from === myNodeId`，而 incoming 又显式排除 mutual，
 * 于是 mutual 边**两头都不落**、渲染时被静默丢弃（做的「对等关系」在导出的卡里彻底消失）。
 */
function outgoingEdgesOf(myNodeId, edges){
  return (Array.isArray(edges) ? edges : []).filter(e => e.from === myNodeId || (e.direction === "mutual" && e.to === myNodeId));
}
function renderRelationsSection(myNodeId, nodes, edges, opts){
  const o = opts || {};
  const byId = new Map((Array.isArray(nodes) ? nodes : []).map(n => [n.id, n]));
  const nameOf = (id) => { const n = byId.get(id); return n ? (n.name || "未命名") : "（未知）"; };
  const all = (Array.isArray(edges) ? edges : []).filter(e => byId.has(e.from) && byId.has(e.to));
  const outgoing = outgoingEdgesOf(myNodeId, all);
  // incoming 仍排除 mutual：同一条对等关系不必在两节各说一遍（出边那节已带「，互向」标记）
  const incoming = all.filter(e => e.to === myNodeId && e.direction !== "mutual");
  const otherOf = (e) => (e.from === myNodeId ? e.to : e.from);   // mutual 边可能是反向写着的，对方在 from 端
  const order = (t) => { const i = REL_TYPES.indexOf(t); return i < 0 ? REL_TYPES.length : i; };
  const fmt = (e, otherId) => "- " + nameOf(otherId) + "（" + relLabel(e) + "｜" + e.strength + "/5" + (e.direction === "mutual" ? "，互向" : "") + "）" + (e.note ? "：" + e.note : "");
  const byTypeThenStrength = (other) => (a, b) => (order(a.type) - order(b.type)) || (b.strength - a.strength) || nameOf(other(a)).localeCompare(nameOf(other(b)));
  const lines = ["【关系】"];
  if(!outgoing.length) lines.push("- （暂无）");
  else outgoing.slice().sort(byTypeThenStrength(otherOf)).forEach(e => lines.push(fmt(e, otherOf(e))));
  if(o.includeIncoming && incoming.length){
    lines.push("", "【他们眼中的我】");
    incoming.slice().sort(byTypeThenStrength(e => e.from)).forEach(e => lines.push(fmt(e, e.from)));
  }
  return lines.join("\n");
}
function spliceRelations(description, section, meta){
  const desc = String(description || "");
  const i = desc.indexOf(REL_BEGIN), j = desc.indexOf(REL_END);
  const block = section ? (REL_BEGIN + (meta ? " " + meta : "") + " -->\n" + section + "\n" + REL_END) : "";
  if(i >= 0 && j > i){
    const before = desc.slice(0, i).replace(/\s*$/, "");
    const after = desc.slice(j + REL_END.length);
    const head = block ? (before + (before ? "\n\n" : "") + block) : before;
    return (head + after).replace(/\n{3,}/g, "\n\n").trim();
  }
  if(!block) return desc;
  const head = desc.replace(/\s*$/, "");
  return (head + (head ? "\n\n" : "") + block).trim();
}
/**
 * 跨卡体检（0.10.0 起是 lib/group-layer.js 的 `runGroupChecks()` 的薄包装）。
 *
 * 老签名与返回形状**逐字保留**（issues[].level/code/message/refs + stats），所以宿主 cc_groupCheck、
 * 工具 cc_group_check 与既有测试都不用改；实现搬去卡组层是为了让「卡组的下一个新检查项」只加一个
 * 注册表项（那里的 GROUP_CHECKS），而不是在三个地方各写一遍清单、各报一套 code。
 * opts.checks 可只跑指定类别（structure / relations / budget / lore-quality / cross-card）。
 */
function checkGroup(group, members, cards, sharedEntries, opts){
  const o = opts || {};
  return runGroupChecks({ group: normalizeGroup(group), members: members, cards: cards,
    sharedEntries: sharedEntries, metrics: o.metrics || null, scope: o.scope || null,
    opts: { checks: o.checks } });
}
async function readGroupRaw(id){
  const file = safeGroupId(id) + ".json";
  for(const dir of groupDirs()){
    try{
      const raw = await readFile(join(dir, file), "utf8");
      const obj = JSON.parse(raw);
      if(obj && typeof obj === "object") return { raw, obj };
    }catch{}
  }
  return null;
}
async function listGroups(){
  await ensureGroupDir();
  const seen = new Map();
  for(const dir of groupDirs()){
    let files = [];
    try{ files = await readdir(dir); }catch{ continue; }
    for(const f of files){
      if(!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/, "");
      if(seen.has(id)) continue;
      try{ seen.set(id, normalizeGroup(JSON.parse(await readFile(join(dir, f), "utf8")))); }catch{}
    }
  }
  return [...seen.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function writeGroup(group){
  await ensureGroupDir();
  const cur = normalizeGroup(group);
  let rev = cur.rev || 0;
  const prev = await readGroupRaw(cur.id);
  if(prev && prev.obj && typeof prev.obj.rev === "number") rev = prev.obj.rev + 1;
  else if(!prev) rev = 1;
  cur.rev = rev;
  cur.updatedAt = nowSec();
  await writeFile(groupPath(cur.id), JSON.stringify(cur, null, 2), "utf8");
  return cur;
}
async function groupMemberIds(groupId){
  const gid = safeGroupId(groupId);
  const entries = await listLibraryEntries();
  return entries.filter(e => String(e.groupId || "") === gid).map(e => e.id);
}
/** 体检 / 渲染需要的卡片摘要（卡不在库里就跳过）—— 0.10.0 起吃卡库快照，不再逐卡重复读盘。 */
async function libraryCardsFor(ids){
  const rows = await readLibrarySnapshot();
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const out = [];
  for(const id of (Array.isArray(ids) ? ids : [])){
    const row = byId.get(String(id));
    if(!row) continue;   // 卡不在库里：原实现是 readLibraryRaw 抛错→跳过，语义一致
    const d = (row.draft && row.draft.data) ? row.draft.data : {};
    const entries = Array.isArray(d.character_book && d.character_book.entries) ? d.character_book.entries : [];
    out.push({
      id: String(id),
      name: String(d.name || ""),
      description: String(d.description || ""),
      constantTokens: entries.filter(e => e && e.constant).reduce((n, e) => n + estimateTokensLite(e && e.content), 0),
      tokenBudget: Number(d.character_book && d.character_book.token_budget) || 2400,
    });
  }
  return out;
}
/** 解析「这次操作哪个分组」：显式 groupId 优先，否则用当前卡（来源 id → 库 meta.groupId）所属组。 */
async function resolveGroupFor(ctx, exec, explicitGroupId){
  const k = keyFor(ctx, exec);
  const origin = readOriginSync(k);
  const cardId = (origin && origin.libraryId) ? String(origin.libraryId) : "";
  const entries = await listLibraryEntries();
  const mine = cardId ? entries.find(e => e.id === cardId) : null;
  const groupId = explicitGroupId ? safeGroupId(explicitGroupId) : ((mine && mine.groupId) ? String(mine.groupId) : "");
  const memberCount = {};
  entries.forEach(e => { const gid = String(e.groupId || ""); if(gid) memberCount[gid] = (memberCount[gid] || 0) + 1; });
  const groups = (await listGroups()).map(g => ({ id: g.id, name: g.name, nodeCount: g.nodes.length, edgeCount: g.edges.length, memberCount: memberCount[g.id] || 0 }));
  if(!groupId) return { ok: false, cardId: cardId || null, groupId: "", groups };
  const found = await readGroupRaw(groupId);
  if(!found) return { ok: false, cardId: cardId || null, groupId, groups, error: "分组不存在：" + groupId };
  const g = normalizeGroup(found.obj);
  const myNode = cardId ? (g.nodes.find(n => n.kind === "card" && n.cardId === cardId) || null) : null;
  return { ok: true, cardId, groupId, group: g, myNode, groups };
}
/**
 * 卡组作用域（0.10.0）—— 取「这次操作哪个组、组里有哪些卡、这个组的书是什么」的**唯一入口**。
 *
 * 为什么立这一层：共享书上线后，每个工具都自己写了一遍「来源卡 → meta.groupId → 读书」，
 * 实测连着两轮出现「改了四个、漏了第五个」。现在数据只从这里出：工具半传 sessionKey
 * （草稿的来源卡 id 记在 sidecar origin.json 里），宿主半传 cardId / groupId。
 * 纯组装在 lib/group-layer.js（两半共用一份），所以「模型看到的组」与「界面看到的组」形状只有一种。
 * 拿不到来源卡 / 没进组 / 组不存在 / 组还没建书 → 返回 ok:false 的空作用域（调用方无需自己判空）。
 */
async function groupScope(input){
  const opt = input || {};
  // 已经读过快照就传进来（opt.snapshot）—— 一次调用里只读一遍盘，也让「只读一次」可被测试钉住
  const snap = opt.snapshot ? opt.snapshot : await readLibrarySnapshot();
  const byId = new Map(snap.map(x => [String(x.id), x]));
  let cardId = opt.cardId ? String(opt.cardId) : "";
  if(!cardId && opt.sessionKey){
    const origin = readOriginSync(String(opt.sessionKey));
    cardId = (origin && origin.libraryId) ? String(origin.libraryId) : "";
  }
  const mine = cardId ? (byId.get(cardId) || null) : null;
  const explicit = opt.groupId ? safeGroupId(opt.groupId) : "";
  const groupId = explicit || ((mine && mine.meta.groupId) ? String(mine.meta.groupId) : "");
  const base = { cardId: cardId, include: opt.include, maxCards: opt.maxCards, missing: (cardId && !mine) ? [cardId] : [] };
  if(!groupId) return assembleScope(Object.assign({ groupId: "" }, base));
  // ⚠️ 组文件缺失（用户手工删过 cc-groups，或历史数据）时**不提前返回**：成员与共享书照样读出来，
  // 只是 group 为 null / ok:false —— 旧实现（sharedBookScopeFor）根本不看组文件，提前返回会让
  // 「组没了但书还在」的卡突然看不到自己的书（0.9.x 行为回归）。
  const found = await readGroupRaw(groupId);
  const cards = snap.filter(x => String(x.meta.groupId || "") === groupId);
  const bf = await readBookRaw(groupId);
  const book = bf ? normalizeBook(bf.obj, groupId) : null;
  return assembleScope(Object.assign({
    groupId: groupId, group: found ? normalizeGroup(found.obj) : null, cards: cards, book: book,
    bookRev: book ? bookRevOf(book) : 0,
  }, base));
}

// —— 0.8.0：分组的增删改查（LLM 侧）——
// 此前 LLM 只能读写**组内图谱**，改不了「哪张卡属于哪个组」：卡一旦因任何原因掉组，
// 模型既救不回来也建不了新组（只能干等用户点界面），而真正高频使用这套工具的恰恰是模型。
// 这四个函数就是那几个工具的实现，落盘规则与宿主半的 cc_createGroup / cc_renameGroup /
// cc_deleteGroup / cc_setCardGroup 逐条对齐（同一份 cc-groups 目录、同一份库条目 meta.groupId）。

/** 按名字找组（建组/改名时查重）：trim 后精确比对；带 exceptId 时排除自己（给自己改名不算撞车）。 */
function findGroupByName(groups, name, exceptId){
  const want = String(name || "").trim();
  if(!want) return null;
  const eid = exceptId ? safeGroupId(exceptId) : "";
  return (Array.isArray(groups) ? groups : []).find(g => g.id !== eid && String(g.name || "").trim() === want) || null;
}
/** 每个组一行摘要：成员数由库条目 meta.groupId **派生**（与 groupMemberIds 同一套口径）。 */
async function groupSummaries(){
  const groups = await listGroups();
  const entries = await listLibraryEntries();
  const countOf = (gid) => entries.filter(e => String(e.groupId || "") === gid).length;
  return groups.map(g => ({
    id: g.id, name: g.name, note: g.note,
    nodeCount: g.nodes.length, edgeCount: g.edges.length,
    memberCount: countOf(g.id), rev: g.rev, updatedAt: g.updatedAt,
  }));
}
/**
 * 把一张已存卡放进分组（groupId 传空 = 移出）。入组时若组里还没有它的节点就自动补一个 ——
 * 调用方只需要表达「把这张卡放进这个组」，不必先手工建节点。
 * 移出**不删节点、不删关系**：那是用户建过的资产，挪回来时关系还在（与「删卡降级 orphan、保留边」同一原则）。
 */
async function assignCardToGroup(cardId, groupId){
  const cid = String(cardId || "");
  if(!cid) throw new Error("需要 cardId");
  const entries = await listLibraryEntries();
  const mine = entries.find(e => e.id === cid);
  if(!mine) throw Object.assign(new Error("找不到角色卡: " + cid), { code: "ENOENT" });
  const gid = (groupId === null || groupId === undefined || groupId === "") ? "" : safeGroupId(groupId);
  if(!gid){
    await patchLibraryMeta(cid, { groupId: null });
    return { cardId: cid, cardName: mine.name, previousGroupId: (mine.groupId ? String(mine.groupId) : null), groupId: null, nodeId: null };
  }
  const found = await readGroupRaw(gid);
  if(!found) throw Object.assign(new Error("分组不存在: " + gid), { code: "not-found" });
  const g = normalizeGroup(found.obj);
  let node = g.nodes.find(n => n.kind === "card" && n.cardId === cid);
  let revived = false;
  if(!node){
    // 卡曾经被删（节点被 orphanCardNodes 降级成 orphan）后又同名回来时**复活那个节点**，
    // 让它原来的关系继续有效；否则会新建第二个同名节点 —— 体检立刻报 duplicate-name，
    // 而旧节点上挂着的那些关系永远悬空（关系是用户资产，不该被一次误删永久切断）。
    node = g.nodes.find(n => n.kind === "card" && !n.cardId && n.orphanOf && n.orphanOf === String(mine.name || ""));
    if(node){ node.cardId = cid; node.orphanOf = null; revived = true; }
  }
  if(!node){
    node = { id: "n" + (g.nextNodeSeq++), kind: "card", cardId: cid, name: mine.name || "未命名角色", aliases: [], orphanOf: null };
    g.nodes.push(node);
    await writeGroup(g);
  } else if(revived){
    await writeGroup(g);
  }
  await patchLibraryMeta(cid, { groupId: gid });
  return { cardId: cid, cardName: mine.name, previousGroupId: (mine.groupId ? String(mine.groupId) : null), groupId: gid, nodeId: node.id, groupRev: g.rev, revived };
}
/** 删组：组文件（节点 + 关系）不可恢复；成员卡**不删**，只清掉它们指向该组的 meta.groupId。组不存在返回 null。 */
async function deleteGroupWithMembers(groupId){
  const gid = safeGroupId(groupId);
  const found = await readGroupRaw(gid);
  if(!found) return null;
  const g = normalizeGroup(found.obj);
  const members = await groupMemberIds(gid);
  await unlink(groupPath(gid));
  let memberCleared = 0;
  for(const id of members){
    try{ await patchLibraryMeta(id, { groupId: null }); memberCleared += 1; }catch{}
  }
  return { deleted: { id: g.id, name: g.name, nodeCount: g.nodes.length, edgeCount: g.edges.length }, memberCleared };
}

// —— 已存角色库：<主根>/cc-library/<id>.json（读盘回退 0.3.6 之前的 homedir()/.dsh）——
function libDirs(){ return dataRoots("cc-library"); }
function libDir(){ return libDirs()[0]; }
async function ensureLibDir(){
  const dir=libDir();
  await mkdir(dir,{recursive:true});
  return dir;
}
/** 读盘用：主根没有就回退旧根。返回 {path, raw}；两边都没有时抛错（与原 readFile 语义一致）。 */
async function readLibraryRaw(id){
  let lastErr=null;
  for(const dir of libDirs()){
    const p=join(dir,String(id)+".json");
    try{ return { path:p, raw: await readFile(p,"utf8") }; }
    catch(e){ lastErr=e; }
  }
  throw lastErr || new Error("找不到角色卡: " + String(id));
}
function makeLibraryEntryMeta(draft, existingMeta, id){
  const data=draft&&draft.data?draft.data:{};
  const now=nowSec();
  const loreCount=Array.isArray(data.character_book?.entries)?data.character_book.entries.length:0;
  const allTags=Array.isArray(data.tags)?data.tags.map(String):[];
  const tags=allTags.slice(0,6);
  return {
    id:String(id),
    name:(data.name && String(data.name).trim()) || (existingMeta && existingMeta.name) || "未命名角色",
    loreCount, tags, tagsTotal: allTags.length,
    descriptionSnippet:String(data.description||"").slice(0,80),
    // 0.8.0 关系图谱：卡属于哪个分组（**单一真源** —— 分组文件里不存成员列表，避免双写漂移）。
    // 继承既有值，所以「改卡内容再保存」不会把卡踢出分组。
    // ⚠️ 这一行曾经**只有宿主半有**：工具半重建 meta 时把 groupId 抹掉，表现为「LLM 侧保存一次，
    // 卡就静默退组」（返回仍是 action:"updated"，零提示），而关系工具在卡退组后全部拒绝服务。
    // 两半的 makeLibraryEntryMeta 必须逐字同构 —— 加字段时两边一起加（tests/relations.test.mjs 钉住）。
    groupId: (existingMeta && existingMeta.groupId) ? String(existingMeta.groupId) : null,
    createdAt: existingMeta && existingMeta.createdAt ? existingMeta.createdAt : now,
    updatedAt: now,
  };
}
/**
 * 卡库快照（0.10.0）：一次目录遍历 + 一次 parse，把 meta 与 draft **一起**留下。
 *
 * 以前 listLibraryEntries() 解析完整份卡 JSON 却只留 meta，于是「组体检」要对每张卡再读一遍盘
 * （N 张成员卡 = 2N 次读盘），而且拿不到 entries —— 卡组级检查（跨卡触发词冲突、五维漂移）根本做不了。
 * 现在读一次就够：listLibraryEntries() 只是它的投影，groupScope() 直接吃它。
 */
async function readLibrarySnapshot(){
  await ensureLibDir();
  const seen=new Map();   // id → {id, meta, draft, dir}：先到先得，主根排在前 → 同名卡片主根优先
  for(const dir of libDirs()){
    let files=[];
    try{ files=await readdir(dir); }catch{ continue; }
    for(const f of files){
      if(!f.endsWith(".json")) continue;
      const id=f.replace(/\.json$/,"");
      if(seen.has(id)) continue;
      try{
        const raw=await readFile(join(dir,f),"utf8");
        const obj=JSON.parse(raw);
        if(obj && obj.meta && obj.id) seen.set(id,{ id:id, meta:obj.meta, draft:obj.draft||null, dir:dir });
        else if(obj && obj.draft) seen.set(id,{ id:id, meta:makeLibraryEntryMeta(obj.draft,null,id), draft:obj.draft, dir:dir });
      }catch{}
    }
  }
  const rows=[...seen.values()];
  rows.sort((a,b)=>((b.meta.updatedAt||0)-(a.meta.updatedAt||0)));
  return rows;
}
/** 库条目 meta 列表（签名与排序语义未变，现在只是卡库快照的投影）。 */
async function listLibraryEntries(){
  const rows = await readLibrarySnapshot();
  return rows.map(r => r.meta);
}
async function saveLibraryEntry(draft, opts){
  const dir=await ensureLibDir();
  let id=opts && opts.id ? String(opts.id) : "";
  let existing=null;
  if(id){
    // 已存在的那份可能在旧根（0.3.6 之前保存的），读过来只为继承 createdAt / 旧 name
    try{ existing=JSON.parse((await readLibraryRaw(id)).raw); }catch{}
  }
  if(!id) id=String(Date.now())+"-"+Math.random().toString(36).slice(2,6);
  const meta=makeLibraryEntryMeta(draft, existing?existing.meta:null, id);
  // 改名 = 单一事实来源：meta.name 与 draft.data.name 一起改（否则「列表名 / 导出名」两套，用户改名看不出效果）
  if(opts && typeof opts.name==="string" && opts.name.trim()){
    const n=String(opts.name).trim().slice(0,60);
    meta.name=n;
    draft.data.name=n;
  }
  const payload={id,meta,draft};
  await writeFile(join(dir,id+".json"), JSON.stringify(payload,null,2), "utf8");
  return {id,meta,draft,action:existing?"updated":"created"};
}
async function loadLibraryEntry(id){
  await ensureLibDir();
  const obj=JSON.parse((await readLibraryRaw(id)).raw);
  if(!obj || !obj.draft) throw new Error("文件格式错误");
  return obj;
}
/** 删除：两个根里的同名副本都要删，否则读盘回退会把刚删掉的卡「复活」；一个都没删到则抛错。 */
async function deleteLibraryEntry(id){
  await ensureLibDir();
  let removed=0;
  for(const dir of libDirs()){
    try{ await unlink(join(dir,String(id)+".json")); removed+=1; }
    catch(e){ if(e && e.code!=="ENOENT") throw e; }
  }
  if(removed===0) throw Object.assign(new Error("找不到角色卡: " + String(id)), { code:"ENOENT" });
}
/** 改名是就地改 meta.name：写在解析到的那一份上（主根优先），不搬家、不复制。 */
async function renameLibraryEntry(id,newName){
  await ensureLibDir();
  const found=await readLibraryRaw(id);
  const obj=JSON.parse(found.raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  const name=String(newName||"").trim().slice(0,60);
  if(!name) throw new Error("name 不能为空");
  obj.meta.name=name;
  obj.meta.updatedAt=nowSec();
  // 单一事实来源（0.5.0）：列表名与卡内 data.name 一起改 —— 此前只改 meta，导出后仍是旧名
  if(obj.draft && obj.draft.data) obj.draft.data.name=name;
  await writeFile(found.path, JSON.stringify(obj,null,2), "utf8");
  return obj.meta;
}
/** 0.8.0：就地改某个库条目的 meta（写在解析到的那一份上，与 renameLibraryEntry 同规，不搬家）。与 lib/index.js 同构。 */
async function patchLibraryMeta(id,patch){
  const found=await readLibraryRaw(id);
  const obj=JSON.parse(found.raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  Object.assign(obj.meta, patch||{});
  obj.meta.updatedAt=nowSec();
  await writeFile(found.path, JSON.stringify(obj,null,2), "utf8");
  return obj;
}

function out(schema){ return { schema, render: (args, result) => [{ type:"text", text: JSON.stringify(result, null, 2) }] }; }

// —— 强制工作流状态计算（0.5.0 重写）——
// 两处结构性修正，都来自 LLM 侧实测反馈：
//   ① **每一项都是三态**（missing / partial / ok），不再有 `characterOk` 与 `characterPartial` 同时为 true
//      的自相矛盾组合（模型无法据此决策，只能忽略）；
//   ② **lore 的「完成」要求至少 1 条非自动条目**：否则 autoLorebook 一次生成 5 条就顶替了第 4 步的共创，
//      而 `cc_add_lorebook_entries` 的契约写着「必调」—— 两条相反指令同时下发正是实测到的卡壳点。
const DIM_NAMES = { timeline:"年表", factions:"势力", geo:"地理", power:"力量体系", daily:"日常" };
// 英文 key 与 0.4.x 生成过的完全一致（老卡里就是这个写法），避免升级后触发词看起来「悄悄变了」
const DIM_EN = { timeline:"timeline", factions:"faction", geo:"geography", power:"power", daily:"daily" };
// WORLD_DIMS / AUTO_NAMES / isAutoEntry / looksLikeLegacyAuto 由 lib/group-layer.js 提供（两半共用）。
// 这里曾经各有一份：AUTO_NAMES 的判据（名字是维度名**且**内容/keys 像自动条目）如果两边漂移，
// 就会出现「工具以为这条是 auto、工坊以为不是」——同一份数据两种结论。
/**
 * 工作流状态。第二个参数是**该组共享世界书**（`{ bookName, entries, tokens }`，没有就传 null/省略）。
 *
 * 第二轮报告 P0：共享书把一部分世界设定挪到了**组**上，而「≥5 条且至少 1 条共创」是**收尾判定** ——
 * 只数卡内的话，「按推荐做法去重」的卡（重复条目提升进共享书、卡里只剩私密条目）反而永远判不合格：
 * 用户完全照最佳实践做，系统判他不通过，只剩两条路（忍受失败 / 把冗余抄回卡里 —— 后者等于取消共享书）。
 * 所以**达标判定走合计口径**，同时把卡内/共享两个数分开报出来，谁都不必去猜：
 *   loreCount / manualLoreCount          = 卡内（写类工具的文案仍按它说，才不会被误读）
 *   sharedLoreCount / sharedManualCount  = 共享书
 *   loreTotal / manualLoreTotal          = 合计（`state.lore` 与 `readyToValidate` 认它）
 */
function workflowStatus(draft, shared){
  const d = draft && draft.data ? draft.data : {};
  const w = (d.extensions && d.extensions.cc_world) ? d.extensions.cc_world : {};
  const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
  const loreCount = entries.length;
  const manualLoreCount = entries.filter(e => !isAutoEntry(e)).length;
  const sharedEntries = (shared && Array.isArray(shared.entries)) ? shared.entries : [];
  const sharedLoreCount = sharedEntries.length;
  const sharedManualCount = sharedEntries.filter(e => !isAutoEntry(e)).length;
  const loreTotal = loreCount + sharedLoreCount;
  const manualLoreTotal = manualLoreCount + sharedManualCount;
  const worldFilled = WORLD_DIMS.filter(k => typeof w[k]==="string" && String(w[k]).trim().length>=6).length;
  // 一行「世界书多少条」的说法：卡内 8 条就说「8 条」，卡内 3 + 共享 5 就说「8 条 = 卡内 3 + 共享书 5」。
  const lorePhrase = sharedLoreCount
    ? loreTotal + " 条 = 卡内 " + loreCount + " + 共享书 " + sharedLoreCount
    : loreTotal + " 条";
  // 第三轮报告：`constant` / `@@decorator` 这两条是**关于整本世界书**的检查，口径必须与
  // `cc_lint_lorebook` 一致（卡内 + 共享书）—— 只数卡内会让「卡里没有 constant、共享书里有」的卡
  // 每次都收到一条无意义的提醒，而误报会被训练成「忽略 warning」。
  // 范围：**存在性**检查（有没有 constant / 有没有 @@）走合计；**逐条质量**检查（死 keys /
  // 只有维度名的 keys / keys 与正文无交集）在 validate 里**只看卡内** —— 这是**有意**的分工（第五轮报告
  // 实测确认过）：validate 是「这张卡」的收尾判定，列条目名不属于它。全量的逐条质量检查归
  // `cc_lint_lorebook`（覆盖卡内 + 共享书，每条 issue 带 `source`），共享书自己那份由
  // `cc_get_shared_book` 的 `lint` 段给出 —— 三处口径不同是分工，不是漏改（上一版这里曾把
  // 「共享书走 cc_get_shared_book」写成事实，而那条线上当时并没有这个能力，这个错已修）。
  const metrics = lorebookMetrics(entries, sharedEntries);   // 三段基础统计：一处实现（见该函数注释）
  const constantEntries = { card: metrics.card.constant, shared: metrics.shared.constant, total: metrics.total.constant };
  const sharedHasDecorator = metrics.shared.hasDecorator;

  const nameOk = !!String(d.name||"").trim();
  const descOk = !!String(d.description||"").trim();
  const characterState = (nameOk && descOk && String(d.personality||"").trim() && String(d.scenario||"").trim())
    ? "ok" : ((nameOk && descOk) ? "partial" : "missing");
  const worldState = worldFilled >= 3 ? "ok" : (worldFilled > 0 ? "partial" : "missing");
  const loreState = (loreTotal >= 5 && manualLoreTotal >= 1) ? "ok" : (loreTotal > 0 ? "partial" : "missing");
  const gFirst = !!String(d.first_mes||"").trim();
  const gAlt = Array.isArray(d.alternate_greetings) ? d.alternate_greetings.length : 0;
  const gGroup = Array.isArray(d.group_only_greetings) ? d.group_only_greetings.length : 0;
  const greetingsState = (gFirst && gAlt>=2 && gGroup>=1) ? "ok" : ((gFirst || gGroup>=1) ? "partial" : "missing");

  let step = 6; let next = "";
  if(characterState !== "ok"){
    step = 2; next = "下一步必须 cc_patch_character：先与用户讨论角色定位（气质/关系张力等，1-2 问）再补齐 name/description/personality/scenario，严禁直接推断填满";
  } else if(worldState !== "ok"){
    step = 3; next = "角色基础已齐，下一步必须 cc_patch_world：先与用户讨论世界观侧重（哪几维最想展开/有无私设）再补 5 维（≥3 项），**并为每一维自报触发词 loreKeys**（真实对话里用户会说的实体名，如 {geo:[\"旧校舍\",\"广播室\"]}）——不给的话自动条目只能用维度名当 key，永远命中不了";
  } else if(loreState !== "ok"){
    step = 4;
    next = manualLoreTotal === 0
      ? "五维已齐，autoLorebook 已自动生成 "+loreTotal+" 条基础条目（"+lorePhrase+"），但它们以维度名当触发词、且不满足共创要求：下一步必须 cc_add_lorebook_entries，先与用户讨论触发词/常驻偏好，至少再补 1 条（合计≥5 条、至少 1 constant、content 头部写 @@decorator）"
      : "五维已齐，下一步必须 cc_add_lorebook_entries：与用户讨论触发词/常驻偏好后补到合计≥5 条（年表/势力/地理/力量/日常各 1，至少 1 constant，@@decorator），当前 "+lorePhrase+"（其中共创 "+manualLoreTotal+" 条）";
  } else if(greetingsState !== "ok"){
    step = 5; next = "世界书已齐（"+lorePhrase+"，其中共创 "+manualLoreTotal+" 条），下一步必须 cc_patch_greetings：先问用户偏好的开场场景/关系阶段/群聊与私聊区分，再补问候语（first_mes + alternate≥2 + group≥1）";
  } else {
    step = 6; next = "结构已齐，下一步必须 cc_validate 校验，valid=true 才可收尾；通过后提醒用户在工坊左下角「校验导出」入口打开导出页（JSON / PNG / CHARX），或点「★ 保存当前」落盘";
  }
  const state = { character: characterState, world: worldState, lore: loreState, greetings: greetingsState };
  return {
    step,
    readyToValidate: step === 6,
    state,
    worldFilled,
    loreCount, manualLoreCount,                  // 卡内
    sharedLoreCount, sharedManualCount,          // 共享书（没有就是 0）
    loreTotal, manualLoreTotal,                  // 合计 —— `state.lore` 认的是这两个
    sharedBook: sharedLoreCount ? { name: String((shared && shared.bookName) || ""), entries: sharedLoreCount, tokens: Number((shared && shared.tokens) || 0) } : null,
    constantEntries,                             // { card, shared, total } —— 与 cc_lint_lorebook 同一口径
    sharedHasDecorator,                          // 共享书里有没有 @@decorator（存在性检查用合计）
    metrics: metricsBrief(metrics),              // 只有数字、**不带条目正文**：`all` 数组会随每个工具的返回出去
                                                 // （0.10.0 LLM 侧实测多带约 1800 token —— 见 metricsBrief 的注释）
    next,
    // 0.6.0（R1/R2）：`hint` 只报**进度**，不再内嵌 `next` 全文 ——
    // 旧版 `hint = 进度 + " → " + next` 让同一句话在一份返回里出现三遍（hint 内嵌 next、message 又等于 hint）。
    // 终态（校验通过）也走同一个函数，所以 `hint` 不会再说「下一步必须 cc_validate」（那是第一轮 P0-3 的半修残留）。
    hint: progressHint(step, state, worldFilled, loreCount, manualLoreCount, false, sharedLoreCount),
  };
}
/** 带共享书口径的工作流状态：**判定完成度**一律用它（纯纯汇报卡内条数的地方才继续用 workflowStatus）。
 *  拿不到共享书（没有来源卡 / 没进组 / 该组还没建书）时，等价于只算卡内 —— 与旧行为完全一致。 */
async function workflowFor(ctx, exec, draft){
  let shared = null;
  try{ shared = await sharedBookScopeFor(ctx, exec); }catch(e){ shared = null; }
  return workflowStatus(draft, shared);
}
/** 一行进度摘要（**不含 next** —— 下一步是 workflow.next 的职责，别再复制一份）。 */
function progressHint(step, state, worldFilled, loreCount, manualLoreCount, done, sharedLoreCount){
  const mark = s => s==="ok" ? "✓" : (s==="partial" ? "◐" : "✗");
  return "工作流 " + step + "/" + (done ? 7 : 6)
    + " " + mark(state.character) + "角色"
    + " " + mark(state.world) + "五维(" + worldFilled + "/5)"
    + " " + mark(state.lore) + "世界书(" + loreCount + (sharedLoreCount ? "+" + sharedLoreCount : "") + (manualLoreCount > 0 ? ",共创" + manualLoreCount : "") + ")"
    + " " + mark(state.greetings) + "问候语"
    + (done ? " · 已完成，可导出/保存；记得调用 cc_release_draft 交还编辑权" : "");
}
// —— 世界书口径与体检的实现都在 lib/group-layer.js（0.10.0）——
// estimateTokens / lorebookTokens / lorebookMetrics / auditLoreEntries / worstCaseTrigger 等
// 以前在这里各有一份、宿主半再抄一份，靠测试逐字比对维持同步（「改了四个、漏了第五个」的根因）；
// 现在两半 import 同一个文件，改口径只改一处。
/**
 * 世界书的三段基础统计：见 lib/group-layer.js 的 `lorebookMetrics()`（0.10.0 起是 groupMetrics 的
 * 薄包装，形状与数字与 0.9.x 逐字一致）。历史与理由（为什么必须收口）也记在那个文件里。
 */
/** 世界书条目的逐条质量检查：见 lib/group-layer.js 的 `auditLoreEntries()`（两半共用一把尺子）。 */
/** 最坏情况单次触发量：见 lib/group-layer.js 的 `worstCaseTrigger()`（算法与理由记在那里）。 */


function apply(ctx){
  // —— 统一收口（0.6.0，P0-6）——
  // 每个工具的返回都补上「我在操作哪张卡」：`cardName` / `cardId`（未关联已存卡时为 null）+
  // `draftStatus`（含 sessionKey / cardId / cardName / rev）。19 个工具各写一遍没有意义，也容易漏。
  // 另外做两件防「静默数据损坏」的事：
  //   ① 盘上 rev 与期望不符（模型传了 expectedRev）→ 直接拒绝，别拿过期前提去写；
  //   ② **上次调用之后有别人写过这份草稿**（0.7.0 起按 rev 漂移判定，见 S1）→ 返回里给一条明确提示。
  // 新草稿提示（S2）也在这里出：调用前捕获成因，`reset` 不报「内容可能已丢失」。
  const tool = (def) => {
    const raw = def.execute;
    def.execute = async function(args, exec){
      const k = keyFor(ctx, exec);
      const meta = draftMeta(k);
      const expected = (args && typeof args.expectedRev === "number") ? args.expectedRev : null;
      const beforeRev = draftRevOnDisk(k);
      // 0.11.0 流程引导：记下本次调用前有没有锁。第一次建立锁时给模型一条明确提示 ——
      // 只靠 cc_validate 终态的 next 提醒，弱模型经常「写完直接总结」而不调 cc_release_draft，
      // 工坊就一直只读。让它第一次写草稿时就知道「完成时必须交还」。
      const lockBefore = readDraftLockSync(k);
      // S1 补充（0.7.1）：把「本次调用开始前工具半记着的盘上版本」捕下来，返回里一并报出 ——
      // 模型可以随时对账：`watchedRev ≠ rev` 就说明这两次调用之间有别人写过。第五轮实测里，
      // 测试者想验证「不传 expectedRev 也能发现漂移」，却在工具序列内造不出漂移（自己写的 rev
      // 会被记成自己的），有了这个字段它就能自己看懂机制，不必靠猜。
      const watchedRevAtStart = (typeof meta.rev === "number") ? meta.rev : null;
      // —— S1（0.7.0）：不传 expectedRev 时的「被动提醒」——
      // 上次调用结束时我记着的 rev（meta.rev）与盘上现在的不一致，说明**在我两次动手之间别人写过**：
      // 工坊界面点了保存、host 恢复、或另一个会话在动同一把槽。弱模型不会主动传 expectedRev，
      // 但它至少该知道自己手上的前提过期了 —— 第四轮实测里 LLM 就是在这里完全无感知的。
      // 自己不传 expectedRev 的写调用不算漂移（rev 由本次自己推进，后置会同步回 meta.rev）。
      const driftFrom = (expected === null && meta.rev !== null && beforeRev !== null && beforeRev !== meta.rev) ? meta.rev : null;
      if(expected !== null){
        const actual = beforeRev;
        if(actual !== null && actual !== expected){
          const d = getDraft(ctx, exec);
          const st = draftStatusFor(k, d);
          return sanitizeJson({ ok:false, staleRev:true, expectedRev:expected, actualRev:actual, build: BUILD,
            cardName: st.cardName, cardId: st.cardId, draftStatus: st,
            error:"草稿已被外部修改（期望 rev=" + expected + "，实际 rev=" + actual + "）—— 你手上的前提过期了。请先 cc_get_card 确认当前卡片（当前卡名：「" + (st.cardName || "未命名") + "」）再决定要不要重试。" });
        }
      }
      const res = await raw(args, exec);
      try{
        const d = getDraft(ctx, exec);
        const st = draftStatusFor(k, d);
        const afterRev = draftRevOnDisk(k);
        if(afterRev !== null) meta.rev = afterRev;   // 记下「本次调用结束时我见到的版本」，供下一次比对
        if(res && typeof res === "object"){
          if(!res.draftStatus) res.draftStatus = st;
          res.draftStatus.watchedRev = watchedRevAtStart;
          res.cardName = st.cardName;
          res.cardId = st.cardId;
          res.build = BUILD;   // 版本标识：测试者能一眼确认「我测的是不是最新代码」（第五轮流程建议）
          if(driftFrom !== null){
            // 显式字段 + 一句话：报告里 S1 要的「不传 rev 也能看出过期」就是这两个东西。
            res.revDrift = { from: driftFrom, to: beforeRev };
            res.warnings = (Array.isArray(res.warnings) ? res.warnings : []).concat([externalChangeNotice(k, d, driftFrom, beforeRev)]);
          }
          // S2（0.7.0）：新草稿提示只在这里出一次 —— `pendingFresh` 由 getDraft 在「内存与磁盘都
          // 没有草稿、现建了一张空卡」时打上，cc_new_card 主动重置则清掉它（有意重置 ≠ 内容丢失）。
          const freshReason = meta.pendingFresh;
          if(freshReason){
            meta.pendingFresh = null;
            const note = freshNotice({ pendingFresh: freshReason });
            if(note && !(Array.isArray(res.warnings) && res.warnings.indexOf(note) >= 0)){
              res.warnings = (Array.isArray(res.warnings) ? res.warnings : []).concat([note]);
            }
          }
          // 首次上锁的流程引导（见函数开头 lockBefore 的注释）：只在「无锁 → 有锁」这一次出现，
          // 之后每次写只是续期，不再刷屏。
          if(!lockBefore){
            const lockAfter = readDraftLockSync(k);
            if(lockAfter){
              const lockNote = "🔒 已为当前草稿建立创作锁（工坊在此期间只读、用户载入只进预览）。创作完成时（cc_validate 通过后）**必须调用 cc_release_draft 交还草稿编辑权**，否则用户无法在工坊微调；你继续写会自动续期，不会重复锁。";
              if(!(Array.isArray(res.warnings) && res.warnings.indexOf(lockNote) >= 0)){
                res.warnings = (Array.isArray(res.warnings) ? res.warnings : []).concat([lockNote]);
              }
            }
          }
        }
      }catch(e){}
      // B1 的第二道防线：无论各工具返回什么，出门前统一过一遍 JSON 往返，绝不把 `undefined`
      // 留给 DSH 的 lossless-JSON 校验（一个 undefined 就会让整次工具调用报错）。
      return sanitizeJson(res);
    };
    return ctx.tools.register(def);
  };
  tool({
    name: "cc_get_card",
    description: "【工作流第1步·必调·先问再填】查看当前 CC 角色卡草稿与工作流进度。CC 模式下必须先调此工具，然后用自然语言向用户总结当前进度（角色/五维/世界书/问候语各缺什么），并用 1-2 个开放问题邀请用户表达偏好，再按步推进。严禁未与用户讨论就直接推断填满。卡较大时可用 fields 只取需要的字段，省上下文。",
    parameters: { type:"object", properties:{ fields:{ type:"array", items:{ type:"string" }, description:"可选：只取 data 下的这些字段（如 [\"name\",\"tags\"]）；省略则返回整份 draft" } }, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true, properties:{ draft:{type:"object"}, workflow:{type:"object"} } }),
    async execute(args, exec){
      const draft = getDraft(ctx, exec);
      const k = keyFor(ctx, exec);
      const st = draftStatusFor(k, draft);
      const wf = await workflowFor(ctx, exec, draft);
      const warnings = [recoveredNotice(k, draft)].filter(Boolean);   // 新草稿提示由 tool() 包装统一注入（S2，只出一份）
      const fields = Array.isArray(args.fields) ? args.fields.map(String).filter(Boolean) : [];
      let outDraft = draft;
      if(fields.length){
        const data = {};
        for(const f of fields){ if(Object.prototype.hasOwnProperty.call(draft.data, f)) data[f] = draft.data[f]; }
        outDraft = { spec: draft.spec, spec_version: draft.spec_version, data };
      }
      const res = { ok:true, draft: outDraft, draftStatus: st, workflow: wf,
        // R2：message 不再与 hint 一字不差 —— 它是**给用户看**的一句复述（进度 + 下一步），
        // 而 workflow.hint 只报进度、workflow.next 只报下一步（各司其职，不再互相复制）。
        message: "当前进度：" + wf.hint + (wf.done ? "。" : "。下一步：" + wf.next) };
      if(fields.length) res.fieldsReturned = Object.keys(outDraft.data);
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_patch_character",
    description: "【工作流第2步·共创】写入角色基础（name/nickname/description/personality/scenario/system_prompt/tags）。调用前必须已与用户讨论：至少问 1 个开放问题（如想要的气质/性别/年龄/与你的关系张力/禁忌），拿到用户偏好后再填；禁止仅凭世界观自行推断一次性填满。必须在 cc_get_card 之后、五维之前调用，之后下一步是 cc_patch_world。一次只传 1-3 个字段（长字段分多次调用写）；tags 等数组字段单独一次调用。参数必须是严格合法的 JSON（最后一个字段/数组元素后不写逗号，不要 ```json 代码块包裹，不要注释与单引号；字符串内换行要转义）。",
    parameters: {
      type:"object",
      properties:{
        name:{type:"string", description:"角色显示名（data.name）"},
        nickname:{type:"string", description:"nickname（{{char}} 用）"},
        description:{type:"string", description:"description 设定"},
        personality:{type:"string", description:"personality"},
        scenario:{type:"string", description:"scenario"},
        system_prompt:{type:"string", description:"system_prompt"},
        post_history_instructions:{type:"string", description:"post_history_instructions"},
        tags:{type:"array", items:{type:"string"}, description:"标签数组，会整体覆盖"},
        creator_notes:{type:"string", description:"creator_notes"},
        // N1（0.7.0）：`data.creator` 此前**没有任何写入路径** —— cc_validate 每次都警告「creator 为空」，
        // 但工具侧和工坊界面都改不了它，等于反复催一个没有解法的问题（第四轮实测：传进来被静默忽略）。
        creator:{type:"string", description:"作者名（data.creator）。cc_validate 会警告它为空时导出后看不到作者，这里就是它的写入路径。"},
        verbose:{type:"boolean", description:"可选：true 时额外回吐整份 draft；默认只回 changed 字段名列表（省上下文）"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev，避免基于过期草稿覆盖别人的修改"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const recNote = recoveredNotice(k, cur);
      // 合并式更新：只有显式传了的字段才动。**传空字符串 = 清空该字段**（P2-10 之前文档没写清），
      // 不传 = 保持原值。
      const changed = [];
      // B2（0.7.1）：`changed` 与 `rev` 用同一套判据 —— 只有值真的变了才记改动，否则会出现
      // 「返回说改了 creator、rev 却纹丝不动」这种自相矛盾（第五轮实测 B2）。
      if(args.name!==undefined) assignIfChanged(cur.data, "name", textArg(args.name).slice(0,120), changed);
      if(args.nickname!==undefined) assignIfChanged(cur.data, "nickname", textArg(args.nickname).slice(0,120), changed);
      if(args.description!==undefined) assignIfChanged(cur.data, "description", textArg(args.description).slice(0,5000), changed);
      if(args.personality!==undefined) assignIfChanged(cur.data, "personality", textArg(args.personality).slice(0,5000), changed);
      if(args.scenario!==undefined) assignIfChanged(cur.data, "scenario", textArg(args.scenario).slice(0,5000), changed);
      if(args.system_prompt!==undefined) assignIfChanged(cur.data, "system_prompt", textArg(args.system_prompt).slice(0,3000), changed);
      if(args.post_history_instructions!==undefined) assignIfChanged(cur.data, "post_history_instructions", textArg(args.post_history_instructions).slice(0,3000), changed);
      if(Array.isArray(args.tags)) assignIfChanged(cur.data, "tags", args.tags.map(textArg).slice(0,12), changed);
      if(args.creator_notes!==undefined) assignIfChanged(cur.data, "creator_notes", textArg(args.creator_notes).slice(0,3000), changed);
      if(args.creator!==undefined) assignIfChanged(cur.data, "creator", textArg(args.creator).slice(0,120), changed);
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const warnings = [];
      if(recNote) warnings.push(recNote);
      // P1-4：patch 类默认不再回吐整份 draft —— 长卡下每改一个字段都要模型重读全卡，纯烧上下文。
      // 需要全量时显式传 verbose:true（cc_get_card 也能按 fields 取）。
      const res = { ok:true, changed, draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已写入胶囊（角色基础：" + (changed.length ? changed.join("/") : "无改动") + "）。" + wf.next };
      if(args.verbose === true) res.draft = cur;
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_patch_world",
    description: "【工作流第3步·共创·必调】写入 5 维世界观（timeline/factions/geo/power/daily 至少 3 项）。若用户已提供世界观文档，先用 2-3 句归纳你理解的 5 维，再问用户“哪几维最想展开？有无私设要加？”；若世界观薄弱，则与用户讨论 1-2 个薄弱点后再填。严禁未与用户讨论就直接照搬文档填满 5 维。⚠️ 若本卡已在**有共享世界书**的分组里，本工具默认**不再**往卡内抄五维骨架（那些共同设定属于共享书，卡内副本会与它双重插入）—— 要卡内副本才显式传 autoLorebook:true。调后下一步是 cc_add_lorebook_entries。loreKeys 这类对象字段建议单独一次调用；参数必须是严格合法的 JSON（最后一个字段/数组元素后不写逗号，不要 ```json 代码块包裹，不要注释与单引号）。",
    parameters: {
      type:"object",
      properties:{
        timeline:{type:"string", description:"年表"},
        factions:{type:"string", description:"势力"},
        geo:{type:"string", description:"地理"},
        power:{type:"string", description:"力量体系"},
        daily:{type:"string", description:"日常"},
        autoLorebook:{type:"boolean", description:"是否基于 5 维在**卡内**自动生成 3-6 条带 @@decorator 的 lorebook 条目。**不传时**：本卡所属分组若已有共享世界书覆盖这些维度 → 不生成（避免与共享书双重插入、触发词互相打架）；否则生成。true 强制生成，false 强制不生成。多卡同组时建议不传或传 false —— 共同设定留在共享书里。"},
        loreKeys:{
          type:"object",
          description:"**强烈建议提供**：为每一维自报触发词（真实对话里用户会说的实体名），如 {\"geo\":[\"旧校舍\",\"广播室\",\"天台\"],\"factions\":[\"夜巡\",\"学生会\"]}。不给的话自动条目只能用维度名当 key —— 用户永远不会说「地理」，那几条等于死条目。",
          additionalProperties:{ type:"array", items:{type:"string"} }
        },
        verbose:{type:"boolean", description:"可选：true 时额外回吐整份 draft；默认只回状态与条目摘要"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev，避免基于过期草稿覆盖别人的修改"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const recNote = recoveredNotice(k, cur);
      cur.data.extensions = cur.data.extensions || {};
      const w = cur.data.extensions.cc_world || {};
      if(args.timeline!==undefined) w.timeline = textArg(args.timeline).slice(0,1000);
      if(args.factions!==undefined) w.factions = textArg(args.factions).slice(0,1000);
      if(args.geo!==undefined) w.geo = textArg(args.geo).slice(0,1000);
      if(args.power!==undefined) w.power = textArg(args.power).slice(0,1000);
      if(args.daily!==undefined) w.daily = textArg(args.daily).slice(0,1000);
      cur.data.extensions.cc_world = w;
      // 0.10.0：默认值必须看得见「组里已经有什么」——
      // 没显式传 autoLorebook 时，若本卡所属分组的共享书已覆盖这些维度，就**不在卡内生成副本**：
      // 用户只想改五维里的一个字，不该被抄回整套骨架（那会抵消共享书的去重价值，并立刻踩
      // 「卡内与书逐字重复」+「跨卡触发词冲突」两条检查）。显式 true / false 一律照办。
      const explicitAuto = (typeof args.autoLorebook === "boolean") ? args.autoLorebook : null;
      let shouldAuto = (explicitAuto === null) ? true : explicitAuto;
      let autoSkipped = null;
      if(explicitAuto === null){
        const cover = await sharedBookCoversDims(ctx, exec);
        if(cover.covered){ shouldAuto = false; autoSkipped = cover; }
      }
      const autoDropped = [];
      const autoEdited = [];
      if(shouldAuto){
        // 移除先前由 autoLorebook 生成的旧条目（保留手动条目）。
        // ⚠️ 0.5.0 修：旧数据没有 cc_auto 标记时**不能只按名字删** —— 用户手工建的、恰好叫「日常」的条目
        // 会被静默吃掉（LLM 侧实测之外的源码复核发现）。现在额外要求内容确实是自动格式（@@ 开头或英文维度 key）。
        // ⚠️ 0.6.0 补（R4）：被删的条目里如果有**手工改过 keys** 的，要报出来 —— 第二轮实测中用户手工把 5 条
        // keys 改成实体词，重新生成后全被覆盖回维度名，而返回只说「替换了 5 条」，用户毫无察觉。
        cur.data.character_book.entries = cur.data.character_book.entries.filter(e => {
          if(isAutoEntry(e) || looksLikeLegacyAuto(e)){
            autoDropped.push(String(e.name||""));
            const ref = (e.extensions && e.extensions.cc_world_ref) || null;
            const keys = Array.isArray(e.keys) ? e.keys.map(String) : [];
            const defaults = ref ? [DIM_NAMES[ref], DIM_EN[ref]] : null;
            const edited = defaults
              ? (keys.length !== defaults.length || keys.some((x, i) => x !== defaults[i]))
              : (keys.length > 2 || (keys.length === 1 && !AUTO_NAMES.has(keys[0])));
            if(edited) autoEdited.push(String(e.name||""));
            return false;
          }
          return true;
        });
        // 重新计算 insertion_order 保持连续（手动条目保留相对顺序）
        cur.data.character_book.entries.forEach((e, i) => e.insertion_order = i);
        // 触发词：模型自报的 loreKeys 优先，维度名固定作为最后一条兜底（至少能命中「年表」这种直球提问）
        const given = (dim, fallback) => {
          const raw = (args.loreKeys && Array.isArray(args.loreKeys[dim])) ? args.loreKeys[dim].map(String).map(s=>s.trim()).filter(Boolean) : [];
          return raw.concat(fallback.filter(k => raw.indexOf(k) < 0)).slice(0, 12);
        };
        const push=(dim, content, priority, constant=false)=>{
          const name = DIM_NAMES[dim];
          cur.data.character_book.entries.push({
            keys: given(dim, [name, DIM_EN[dim]]),
            content, enabled:true, insertion_order: cur.data.character_book.entries.length,
            case_sensitive:false, use_regex:false, constant, name, priority,
            id: Date.now()+Math.floor(Math.random()*10000), cc_auto:true,
            extensions:{ cc_auto:true, cc_world_ref: dim },
          });
        };
        if(w.timeline) push("timeline", "@@position after_desc\n"+w.timeline, 10);
        if(w.factions) push("factions", "@@depth 4\n"+w.factions, 9);
        if(w.geo) push("geo", "@@position scenario\n"+w.geo, 8);
        if(w.power) push("power", "@@activate 100\n"+w.power, 9, true);
        if(w.daily) push("daily", "@@depth 5\n"+w.daily, 7);
      }
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const autoEntries = cur.data.character_book.entries.filter(isAutoEntry);
      const warnings = [];
      if(recNote) warnings.push(recNote);
      const gaveKeys = !!(args.loreKeys && Object.keys(args.loreKeys).length);
      if(autoEntries.length && !gaveKeys){
        warnings.push("自动生成的 " + autoEntries.length + " 条世界书条目只用了维度名当触发词（年表/timeline 这类），真实对话几乎不会命中。建议用 cc_update_lorebook_entry 改成用户会说的实体名（如「旧校舍」「广播室」），或下次调用 cc_patch_world 时带上 loreKeys。");
      }
      // N2 附带（0.7.0）：同一个实体被分给多个维度时**当场说破** —— 第四轮实测里「剑冢」同时落在
      // factions / geo / power，一句「剑冢到底是什么地方」就触发了 4 条、1139 token（预算 1200）。
      // 此前只有写完之后跑 cc_lint_lorebook 才会报「触发词被多条条目共用」，反馈太晚。
      const sharedLoreKeys = (() => {
        if(!args.loreKeys || typeof args.loreKeys !== "object") return [];
        const seen = new Map();
        Object.keys(args.loreKeys).forEach(dim => {
          (Array.isArray(args.loreKeys[dim]) ? args.loreKeys[dim] : []).forEach(raw => {
            const key = String(raw).trim();
            if(!key) return;
            if(!seen.has(key)) seen.set(key, []);
            if(seen.get(key).indexOf(dim) < 0) seen.get(key).push(dim);
          });
        });
        return [...seen.entries()].filter(pair => pair[1].length > 1).map(pair => pair[0] + "(" + pair[1].join("/") + ")");
      })();
      if(shouldAuto && sharedLoreKeys.length){
        warnings.push("这些触发词被同时分给了多个维度：" + sharedLoreKeys.join("、") + " —— 用户一句话提到它们会**同时触发多条**，token 消耗成倍叠加。建议一个实体只留给最贴切的那个维度。");
      }
      // N2（0.7.0）：自动条目的 content 是五维**原文照搬**，维度写得越细，单次命中越贵。
      const heavyAuto = autoEntries.filter(e => estimateTokens(e.content) > 400);
      if(heavyAuto.length){
        warnings.push("有 " + heavyAuto.length + " 条自动条目的内容超过 400 token（" + heavyAuto.map(e => String(e.name||"")).join("、") + "）：auto 条目的 content 是五维原文照搬，写多细就多重，每次命中都会吃这么多上下文。可用 cc_update_lorebook_entry 精炼成摘要，或把对应维度缩短。");
      }
      const res = { ok:true, worldFilled: wf.worldFilled, loreCount: wf.loreCount,
        autoLoreAdded: autoEntries.length, autoLoreReplaced: autoDropped.length, autoLoreEdited: autoEdited.length,
        autoLoreSkipped: !!autoSkipped,
        autoLoreSkipReason: autoSkipped ? "shared-book-covers-dims" : null,
        sharedLoreKeys, heavyAutoEntries: heavyAuto.length,
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已写入五维（" + wf.worldFilled + "/5），"
          + (autoSkipped
            ? "本组共享世界书已覆盖这些维度，**没有**在卡内生成副本（要卡内副本请显式传 autoLorebook:true）"
            : "自动生成 " + autoEntries.length + " 条基础条目")
          + "。" + wf.next };
      if(autoSkipped){
        warnings.push("本卡所属分组已有共享世界书「" + (autoSkipped.bookName || "未命名") + "」，其中 "
          + autoSkipped.count + " 条覆盖了 年表/势力/地理/力量体系/日常 —— 本次**没有**在卡内生成基础条目："
          + "卡内副本会在群聊里与共享书双重插入，触发词也会互相打架（组体检会报「卡内条目与共享书逐字重复」和「跨卡触发词冲突」两类问题）。"
          + "确实需要卡内副本时显式传 autoLorebook:true；正常的下一步是 cc_add_lorebook_entries 补共创条目。");
      }
      if(autoEdited.length) warnings.push("被替换的 " + autoEdited.length + " 条旧自动条目（" + autoEdited.join("、") + "）的 keys 曾被手工改过，这次已重建回默认维度名，手工触发词会丢。想保住它们：先用 cc_update_lorebook_entry 写回，或以后调本工具时带上 loreKeys。");
      if(args.verbose === true) res.draft = cur;
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_add_lorebook_entries",
    description: "【工作流第4步·共创·必调】添加 1-5 条 Lorebook，补到至少 5 条（年表/势力/地理/力量/日常各 1，至少 1 条 constant，@@decorator）。调用前应与用户讨论：问用户想要哪些触发词/常驻条目/要藏什么彩蛋，拿到偏好后再生成。必须在五维之后、问候语之前调用，禁止一次性无讨论批量生成。条目较多时分成多次调用（一次 1-2 条）；参数必须是严格合法的 JSON（数组元素之间不写尾逗号，最后一个元素后不写逗号，不要 ```json 代码块包裹，不要注释与单引号）。",
    parameters: {
      type:"object",
      properties:{
        entries:{
          type:"array", minItems:1, maxItems:5,
          items:{
            type:"object",
            properties:{
              name:{type:"string", description:"条目标题"},
              keys:{type:"array", items:{type:"string"}, description:"触发关键词，为空且 constant=true 时为常驻条目"},
              content:{type:"string", description:"正文，可在开头写 @@decorator 行"},
              constant:{type:"boolean", description:"是否为常驻条目"},
              use_regex:{type:"boolean", description:"keys 是否按正则匹配"},
              priority:{type:"number", description:"优先级 0-10"}
            },
            required:["content"],
            additionalProperties:false
          }
        },
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev"}
      },
      required:["entries"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const recNote = recoveredNotice(k, cur);
      args.entries.forEach(function(e){
        cur.data.character_book.entries.push({
          keys: Array.isArray(e.keys)? e.keys.map(textArg): [],
          content: textArg(e.content).slice(0,5000),
          enabled:true,
          insertion_order: cur.data.character_book.entries.length,
          case_sensitive:false,
          use_regex: !!e.use_regex,
          constant: !!e.constant,
          name: textArg(e.name||"未命名").slice(0,60),
          priority: typeof e.priority==="number"? e.priority: 5,
          id: Date.now()+Math.floor(Math.random()*10000)
        });
      });
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const warnings = [];
      if(recNote) warnings.push(recNote);
      const res = { ok:true, added: args.entries.length, loreCount: wf.loreCount, manualLoreCount: wf.manualLoreCount,
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已新增 " + args.entries.length + " 条世界书条目（共 " + wf.loreCount + " 条，其中共创 " + wf.manualLoreCount + " 条）。" + wf.next };
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_delete_lorebook_entries",
    description: "【Lorebook 管理】按 id 或 name 删除条目（用于清理过时条目，autoLorebook 已自动覆盖旧自动条目，手动条目需显式删除）。至少提供 ids 或 names 之一。",
    parameters: {
      type:"object",
      properties:{
        ids:{type:"array", items:{type:"number"}, description:"要删除的条目 id 列表"},
        names:{type:"array", items:{type:"string"}, description:"要删除的条目 name 列表（精确匹配）"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const before = draftStatusFor(k, cur);
      const beforeRec = recoveredNotice(k, cur);
      const beforeCount = cur.data.character_book.entries.length;
      const idSet = new Set(Array.isArray(args.ids)? args.ids.map(Number): []);
      const nameSet = new Set(Array.isArray(args.names)? args.names.map(String): []);
      if(idSet.size===0 && nameSet.size===0) return { ok:false, error:"请提供 ids 或 names" };
      cur.data.character_book.entries = cur.data.character_book.entries.filter(e => !idSet.has(e.id) && !nameSet.has(e.name));
      // 重排 insertion_order
      cur.data.character_book.entries.forEach((e,i)=> e.insertion_order=i);
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const deleted = beforeCount - wf.loreCount;
      const warnings = [];
      if(beforeRec) warnings.push(beforeRec);
      const res = { ok:true, deleted, loreCount: wf.loreCount, manualLoreCount: wf.manualLoreCount,
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已删除 " + deleted + " 条世界书条目（剩 " + wf.loreCount + " 条，其中共创 " + wf.manualLoreCount + " 条）。" + wf.next };
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_update_lorebook_entry",
    description: "【Lorebook 管理】按 id 更新单条条目（content/keys/name 等），用于修正过时内容而非整批重建。",
    parameters: {
      type:"object",
      properties:{
        id:{type:"number", description:"要更新的条目 id（必填）"},
        name:{type:"string", description:"新标题"},
        keys:{type:"array", items:{type:"string"}, description:"新触发词"},
        content:{type:"string", description:"新正文（含 @@decorator）"},
        enabled:{type:"boolean"},
        constant:{type:"boolean"},
        use_regex:{type:"boolean"},
        priority:{type:"number"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev"}
      },
      required:["id"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const recNote = recoveredNotice(k, cur);
      const e = cur.data.character_book.entries.find(x=> x.id===args.id);
      if(!e) return { ok:false, error:"未找到 id="+args.id };
      const changed = [];
      if(args.name!==undefined) assignIfChanged(e, "name", textArg(args.name).slice(0,60), changed);
      if(Array.isArray(args.keys)) assignIfChanged(e, "keys", args.keys.map(textArg), changed);
      if(args.content!==undefined) assignIfChanged(e, "content", textArg(args.content).slice(0,5000), changed);
      if(args.enabled!==undefined) assignIfChanged(e, "enabled", !!args.enabled, changed);
      if(args.constant!==undefined) assignIfChanged(e, "constant", !!args.constant, changed);
      if(args.use_regex!==undefined) assignIfChanged(e, "use_regex", !!args.use_regex, changed);
      if(typeof args.priority==="number") assignIfChanged(e, "priority", args.priority, changed);
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const warnings = [];
      if(recNote) warnings.push(recNote);
      const res = { ok:true, entry:e, changed, loreCount: wf.loreCount,
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已更新条目「" + String(e.name||"") + "」（" + changed.join("/") + "）。" + wf.next };
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_patch_greetings",
    description: "【工作流第5步·共创】写入开场与示例（first_mes / alternate_greetings≥2 / group_only_greetings≥1 / mes_example）。调用前必须问用户偏好的开场场景/关系阶段/群聊与私聊区分，拿到偏好后再写；禁止未与用户讨论就自行编造全部问候语。必须在角色+五维+世界书(≥5)后调用。一次只传 1-2 个字段（长问候语分多次调用写）；alternate_greetings / group_only_greetings 这类数组字段单独一次调用。参数必须是严格合法的 JSON（最后一个字段/数组元素后不写逗号，不要 ```json 代码块包裹，不要注释与单引号）。",
    parameters: {
      type:"object",
      properties:{
        first_mes:{type:"string", description:"首条开场白"},
        alternate_greetings:{type:"array", items:{type:"string"}, description:"备选开场白数组，至少 2 条"},
        group_only_greetings:{type:"array", items:{type:"string"}, description:"群聊限定开场白（必填至少1条）"},
        mes_example:{type:"string", description:"对话示例（可用 {{user}}/{{char}}）"},
        verbose:{type:"boolean", description:"可选：true 时额外回吐整份 draft；默认只回问候语计数与状态"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev，避免基于过期草稿覆盖别人的修改"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const recNote = recoveredNotice(k, cur);
      if(args.first_mes!==undefined) cur.data.first_mes = textArg(args.first_mes).slice(0,5000);
      if(Array.isArray(args.alternate_greetings)) cur.data.alternate_greetings = args.alternate_greetings.map(textArg).slice(0,10);
      if(Array.isArray(args.group_only_greetings)) cur.data.group_only_greetings = args.group_only_greetings.map(textArg).slice(0,10);
      if(args.mes_example!==undefined) cur.data.mes_example = textArg(args.mes_example).slice(0,5000);
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      // 若世界书/五维未齐，警告但仍写入，让 validate 卡住
      const warnings = [];
      if(recNote) warnings.push(recNote);
      if(wf.state.world !== "ok") warnings.push("五维仅 " + wf.worldFilled + "/5 项（未达 3 项），validate 会失败，请先补 cc_patch_world。");
      if(wf.state.lore !== "ok") warnings.push("世界书未达「≥5 条且至少 1 条共创」（当前 " + wf.loreCount + " 条，其中共创 " + wf.manualLoreCount + " 条），validate 会失败，请先补 cc_add_lorebook_entries。");
      const warnText = warnings.length ? "（" + warnings.join(" ") + "）" : "";
      const res = { ok:true,
        greetings: { first_mes: !!String(cur.data.first_mes||"").trim(), alternate: (cur.data.alternate_greetings||[]).length, group: (cur.data.group_only_greetings||[]).length },
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已写入问候语" + warnText + "。" + wf.next };
      if(args.verbose === true) res.draft = cur;
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  // —— 已存角色库 CRUD（ID 化，模型可直接管理，与工坊侧栏共享 ~/.dsh/cc-library） ——
  tool({
    name: "cc_list_library",
    description: "【库·查】列出已存角色库所有条目（id/name/loreCount/tags/updatedAt），用于让用户挑选载入或让模型决定更新哪一张。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const entries=await listLibraryEntries();
      return { ok:true, entries, count:entries.length };
    }
  });
  tool({
    name: "cc_save_to_library",
    description: "【库·增/改】把当前会话草稿存入已存库（ID 化 CRUD）。**不传 id 时优先沿用草稿的来源 id**（最近一次 cc_load_from_library 载入的那张），所以「载入 → 修改 → 保存」是更新原卡，不会再多出一张同名重复卡；只有从未载入过（或已 cc_new_card 重置）时才新建。传 id 则按该 ID 原地覆盖。返回值 action 说明本次是 created 还是 updated。传 name 会同时写入 meta.name 与 draft.data.name（避免列表名与卡内名两套）。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"要覆盖的已存 ID（不传则沿用草稿来源 id；没有来源才新建）"}, name:{type:"string", description:"新名称（可选；同时写入 meta.name 与 draft.data.name）"} }, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const draft=JSON.parse(JSON.stringify(getDraft(ctx,exec)));
      // 至少需要 name
      if(!draft.data.name || !String(draft.data.name).trim()) return { ok:false, error:"当前草稿缺少 data.name，请先 cc_patch_character 补齐" };
      const explicit = args.id ? String(args.id) : "";
      const origin = explicit ? null : readOriginSync(k);
      const targetId = explicit || (origin ? origin.libraryId : "");
      const res=await saveLibraryEntry(draft, { id: targetId || undefined, name: args.name });
      // 记来源：下次不传 id 时沿用同一张（cc_new_card / 工坊清空草稿会清掉它）
      writeOriginSync(k, res.id, res.meta.name);
      // 0.8.0 修：action 与文案都用 saveLibraryEntry 的**实测判定**（它按「该 id 的文件是否已存在」算）。
      // 旧写法 `targetId ? "updated" : "created"` 在「传一个库里不存在的新 id」时会谎报 updated ——
      // 而那正是群聊场景「从母卡派生出多张角色卡」的唯一路径，模型会以为自己覆盖了别人、不敢继续。
      const created = res.action === "created";
      return { ok:true, action: res.action, id:res.id, meta:res.meta, loreCount:res.meta.loreCount,
        message: (created ? "已新建已存卡「" : "已更新已存卡「") + res.meta.name + "」（id " + res.id + "）。" + (created ? "下次保存（不传 id）会更新这一张。" : "") };
    }
  });
  tool({
    name: "cc_load_from_library",
    description: "【库·载入】按 ID 把已存卡载入当前会话草稿（**会覆盖当前 draft**）。载入后会记住来源 id：之后 cc_save_to_library 不传 id 也按这张更新，不会再新建重复卡。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"已存条目 ID"}, includeDraft:{type:"boolean", description:"默认 true（载入后通常要基于内容继续工作）；false 时只回 meta 与状态，省上下文"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const obj=await loadLibraryEntry(args.id);
      const cur=JSON.parse(JSON.stringify(obj.draft));
      setDraft(ctx,cur,exec);
      const k = keyFor(ctx, exec);
      writeOriginSync(k, obj.id, obj.meta.name);
      const wf = await workflowFor(ctx, exec, cur);
      const res = { ok:true, id:obj.id, meta:obj.meta, draftStatus: draftStatusFor(k, cur), workflow: wf,
        loreCount: wf.loreCount,
        message: "已载入「" + obj.meta.name + "」（id " + obj.id + "，世界书 " + wf.loreCount + " 条）。之后保存（不传 id）会更新这一张。" };
      if(args.includeDraft !== false) res.draft = cur;
      return res;
    }
  });
  tool({
    name: "cc_delete_from_library",
    description: "【库·删】按 ID 删除已存条目，模型可在用户确认后调用。返回值带 remaining（删完后库里还剩几条）。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"要删除的 ID"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const origin = readOriginSync(k);
      const wasOrigin = !!(origin && origin.libraryId === String(args.id));
      await deleteLibraryEntry(args.id);
      // 删掉的正好是当前草稿的来源卡 → 清掉来源，否则下次保存会「更新」一张已不存在的卡
      if(wasOrigin) writeOriginSync(k, null);
      const entries = await listLibraryEntries();
      return { ok:true, id:args.id, remaining: entries.length, originCleared: wasOrigin,
        message: "已删除（id " + args.id + "），库里还剩 " + entries.length + " 条。" + (wasOrigin ? "当前草稿的来源关联也一并解除。" : "") };
    }
  });
  tool({
    name: "cc_rename_in_library",
    description: "【库·改名】按 ID 重命名已存条目。**同时写入 meta.name 与 draft.data.name**（单一事实来源）—— 此前只改 meta，于是侧边栏显示新名、导出的卡里还是旧名，用户反复改名却不明白为什么不生效。",
    parameters: { type:"object", properties:{ id:{type:"string"}, name:{type:"string", description:"新名称（列表名与卡内 data.name 一起改）"} }, required:["id","name"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const meta=await renameLibraryEntry(args.id,args.name);
      const origin = readOriginSync(k);
      if(origin && origin.libraryId === String(args.id)) writeOriginSync(k, String(args.id), meta.name);
      return { ok:true, meta, syncedDraftName: true,
        message: "已改名为「" + meta.name + "」（meta.name 与 draft.data.name 同步更新，导出后就是这个名字）。" };
    }
  });
  tool({
    name: "cc_get_library_entry",
    description: "【库·查单条】按 ID 获取单条完整草稿与 meta，用于模型在重命名/更新前确认内容。只想确认 meta 或某个字段时传 includeDraft:false，省上下文。",
    parameters: { type:"object", properties:{ id:{type:"string"}, includeDraft:{type:"boolean", description:"默认 true；只想确认 meta/字段时传 false"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const obj=await loadLibraryEntry(args.id);
      const res = { ok:true, id:obj.id, meta:obj.meta };
      if(args.includeDraft !== false) res.draft = obj.draft;
      return res;
    }
  });

  // ——————————————————————————————————————————————————————————————
  // 0.5.0 新增工具：都来自 LLM 侧实测反馈的「无工具可调」清单
  // ——————————————————————————————————————————————————————————————

  // 【重置】空白起点。破坏性 → 必须显式 confirm，杜绝模型顺手清空用户的卡。
  tool({
    name: "cc_new_card",
    description: "【卡·重置】把当前会话草稿换成一张全新的空白卡（清空所有字段与世界书，并解除与已存卡的来源关联）。这是**破坏性操作**：必须先向用户确认（说明现状 + 影响），拿到明确同意后再带 confirm:true 调用；不带 confirm 时本工具只返回提示、不改任何数据。若用户只是想换一张已存卡继续，用 cc_list_library + cc_load_from_library。",
    parameters: { type:"object", properties:{ confirm:{type:"boolean", description:"必须在用户明确同意重置后传 true"} }, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      if(args.confirm !== true){
        const cur = getDraft(ctx, exec);
        const wf = await workflowFor(ctx, exec, cur);
        return { ok:false, needsConfirm:true, workflow: wf,
          message:"重置会清空当前草稿的全部内容（角色/五维/世界书/问候语）且无法撤销。当前草稿：" + (String(cur.data.name||"").trim() || "（未命名）") + "，世界书 " + wf.loreCount + " 条。请先向用户说明并征求同意；同意后再以 confirm:true 重新调用。" };
      }
      const fresh = makeEmptyCard();
      setDraft(ctx, fresh, exec);
      writeOriginSync(k, null);
      // P0-6 附带 bug 修：setDraft 会把 isNew 置 false，但重置出来的确实是一张全新草稿 ——
      // 第二轮实测里 `isNew` 两轮从未出现过 true，正是漏了这一处（它本该是「这张卡还没跟已存卡建立关联」的信号）。
      draftMeta(k).isNew = true;
      // S2（0.7.0）：成因是「有意重置」，不是「会话里突然没有草稿了」—— 清掉待告知标记，
      // 之后写入不再报「此前有未保存的内容可能已丢失」（第四轮实测：刚重置完就被吓一句，纯误报）。
      draftMeta(k).pendingFresh = null;
      const wf = await workflowFor(ctx, exec, fresh);
      return { ok:true, reset:true, workflow: wf,
        message:"已重置为空白草稿（并解除与已存卡的来源关联，之后保存会新建一张）。" + wf.next };
    }
  });

  // 【世界书元信息】此前 name/description/scan_depth/token_budget/recursive_scanning 一个都改不了
  tool({
    name: "cc_patch_book_meta",
    description: "【世界书·元信息】改 character_book 的顶层参数：name / description / scan_depth / token_budget / recursive_scanning。这些字段此前没有任何工具能改，导致导出的世界书永远是无名书、预算也调不了。合并式更新，只改传入的字段。参数必须是严格合法的 JSON（不要尾逗号、不要注释、不要单引号）。",
    parameters: {
      type:"object",
      properties:{
        name:{type:"string", description:"世界书名称（character_book.name）"},
        description:{type:"string", description:"世界书说明（character_book.description）"},
        scan_depth:{type:"number", description:"扫描深度：在最近 N 条消息里找触发词，常用 2-8"},
        token_budget:{type:"number", description:"世界书 token 预算，超出会被前端截断"},
        recursive_scanning:{type:"boolean", description:"是否递归扫描（被触发条目里的内容也能再触发其他条目）"},
        expectedRev:{type:"number", description:"可选乐观锁：传上次返回里的 draftStatus.rev；若草稿已被外部（工坊界面 / host 恢复）改过，本次调用直接失败并返回 staleRev"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      cur.data.character_book = cur.data.character_book || {};
      const book = cur.data.character_book;
      const changed = [];
      if(args.name!==undefined) assignIfChanged(book, "name", textArg(args.name).slice(0,120), changed);
      if(args.description!==undefined) assignIfChanged(book, "description", textArg(args.description).slice(0,500), changed);
      if(typeof args.scan_depth==="number") assignIfChanged(book, "scan_depth", Math.max(1, Math.min(50, Math.round(args.scan_depth))), changed);
      if(typeof args.token_budget==="number") assignIfChanged(book, "token_budget", Math.max(0, Math.round(args.token_budget)), changed);
      if(args.recursive_scanning!==undefined) assignIfChanged(book, "recursive_scanning", !!args.recursive_scanning, changed);
      setDraft(ctx, cur, exec);
      const wf = await workflowFor(ctx, exec, cur);
      const used = lorebookTokens(book.entries);
      const res = { ok:true, changed, book: { name:book.name, description:book.description, scan_depth:book.scan_depth, token_budget:book.token_budget, recursive_scanning:book.recursive_scanning },
        lorebookTokens: used, draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已更新世界书元信息（" + (changed.length ? changed.join("/") : "无改动") + "）。当前条目内容估算 " + used + " token / 预算 " + book.token_budget + "。" + wf.next };
      return res;
    }
  });

  // 【触发模拟】给一句话，看哪些条目会被触发 —— 写入时就能发现死条目，不用等用户聊两句
  tool({
    name: "cc_simulate_trigger",
    description: "【世界书·验】给一句用户真的会说的话，返回哪些条目会被触发（constant 条目永远算命中）+ 估算 token。用来在写入时就发现「keys 是维度名、真实对话永远不会命中」这类死条目。用 text 传一句，或用 texts 传多句批量验。",
    parameters: {
      type:"object",
      properties:{
        text:{type:"string", description:"一句测试文本，如「我们去旧校舍看看吧」"},
        texts:{type:"array", items:{type:"string"}, description:"多句批量测试（可与 text 并用）"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = getDraft(ctx, exec);
      const book = cur.data.character_book || {};
      const entries = Array.isArray(book.entries) ? book.entries : [];
      const texts = [];
      // 0.9.0 报告：共享书里的条目在真实聊天里**同样会被触发**（客户端把全局书与卡内 character_book
      // 叠加），所以模拟必须把它们一起算 —— 否则会把「会命中」报成「不会命中」（实测低估约 3 倍）。
      // 0.10.0：作用域与 token 口径都走卡组层（sharedBookScopeFor / lorebookMetrics），本工具不再自己求和。
      const scope = await sharedBookScopeFor(ctx, exec);
      const shared = scope.entries;
      const metrics = lorebookMetrics(entries, shared);
      const pool = entries.map(e => ({ e: e, src: "card" })).concat(shared.map(e => ({ e: e, src: "shared" })));
      if(typeof args.text === "string" && args.text.trim()) texts.push(args.text);
      if(Array.isArray(args.texts)) args.texts.forEach(x => { if(typeof x === "string" && x.trim()) texts.push(x); });
      if(!texts.length) return { ok:false, error:"请用 text 或 texts 提供至少一句测试文本" };
      const hitsOf = (line) => {
        const lower = line.toLowerCase();
        return pool.filter(({ e }) => {
          if(!e || e.enabled === false) return false;
          if(e.constant) return true;                       // 常驻条目永远命中
          const keys = Array.isArray(e.keys) ? e.keys : [];
          return keys.some(k => {
            const key = String(k);
            if(!key) return false;
            if(e.use_regex){ try{ return new RegExp(key, "i").test(line); }catch{ return false; } }
            return lower.indexOf(key.toLowerCase()) >= 0;
          });
        });
      };
      const results = texts.map(line => {
        const hits = hitsOf(line);
        const cardHits = hits.filter(h => h.src === "card").map(h => h.e);
        const sharedHits = hits.filter(h => h.src === "shared").map(h => h.e);
        return {
          text: line, hitCount: hits.length, tokens: lorebookTokens(hits.map(h => h.e)),
          cardTokens: lorebookTokens(cardHits), sharedTokens: lorebookTokens(sharedHits),
          hits: hits.map(h => ({ name: String(h.e.name||""), source: h.src, constant: !!h.e.constant,
            keys: Array.isArray(h.e.keys)?h.e.keys:[], priority: h.e.priority })),
          missed: pool.filter(p => p.e.enabled !== false && hits.indexOf(p) < 0)
            .map(p => String(p.e.name||"") + (p.src === "shared" ? "（共享书）" : "")),
        };
      });
      const warnings = [];
      if(pool.length && results.every(r => r.hitCount === 0)) warnings.push("这些测试句一条都没触发。若用户很可能这么说，说明世界书的 keys 需要改成实体名（cc_update_lorebook_entry 或下次 cc_patch_world 带 loreKeys）");
      const never = entries.filter(e => e.enabled !== false && !e.constant && (!Array.isArray(e.keys) || e.keys.length === 0));
      if(never.length) warnings.push(never.length + " 条非 constant 条目没有 keys，永远触发不了：" + never.map(e=>String(e.name||"")).join("、"));
      const totalTokens = metrics.total.tokens;
      const res = { ok:true, simulated: results.length, results,
        lorebookTokens: totalTokens,
        tokenSplit: { card: metrics.card.tokens, shared: metrics.shared.tokens, total: totalTokens },
        sharedBook: shared.length ? { groupId: scope.groupId, name: scope.bookName, entries: shared.length, tokens: scope.tokens } : null,
        scanDepth: book.scan_depth,
        message: "模拟完成：" + results.map(r => "「" + r.text.slice(0,16) + "」→ 命中 " + r.hitCount + " 条（约 " + r.tokens + " token"
            + (r.sharedTokens ? "，其中共享书 " + r.sharedTokens : "") + "）").join("；")
          + (shared.length ? "。已把该组的共享世界书（" + shared.length + " 条 / 约 " + scope.tokens + " token）一并算入。" : "") };
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  // 【静态体检】不需要测试句的那一半检查
  tool({
    name: "cc_lint_lorebook",
    description: "【世界书·静态检查】体检世界书：空 keys、只有维度名的 keys、keys 与 content 无交集、触发词重复、constant 数量、@@decorator 缺失、token 预算占用、**最坏情况单次触发量**（一句话命中多个条目时的 token 爆炸 —— 这一项调大 token_budget 盖不住）。写完世界书后调一次，比肉眼推理 keys 命中率靠谱。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = getDraft(ctx, exec);
      const book = cur.data.character_book || {};
      const entries = Array.isArray(book.entries) ? book.entries : [];
      const issues = [];
      const add = (level, code, message, names, source) => issues.push({ level, code, message, entries: names || [], source: source || "card" });
      // 0.9.0 报告：共享世界书是同一个世界观的一部分，聊天时与卡内 character_book **一起进 prompt**，
      // 所以预算、最坏情况都得把它们并起来算；同时拆出「卡内 / 共享 / 合计」三段，免得又变成一笔糊涂账。
      const scope = await sharedBookScopeFor(ctx, exec);
      const shared = scope.entries;
      // 0.10.0：三段统计与「最坏情况」都从卡组层取 —— 数字只有一个来源，本工具不再自己求和。
      const metrics = groupMetrics({ card: entries, book: shared });
      const m = metrics.legacy;   // { card, shared, total, all } —— 与 0.9.x 的 lorebookMetrics 同形
      const all = m.all;
      const cardTokens = m.card.tokens;
      const sharedTokens = m.shared.tokens;
      const used = m.total.tokens;
      // —— 逐条质量检查：卡内与共享书**都要查**，触发词冲突跨两者一起算 ——
      // 第五轮报告修正了上一版写下的「边界」：那时说「共享书条目的质量走 cc_get_shared_book 那条线」，
      // 可那条线上根本没有这个能力（只有重复检测），共享书于是成了没人体检的一格 —— 往书里塞一条同时
      // 踩三类的坏条目，两个工具都不出声。共享书多卡共用、又没有「卡」这个载体，**比卡内更需要主动报**。
      // 现在两边共用 auditLoreEntries 这一把尺子。
      auditLoreEntries([{ source: "card", entries: entries }, { source: "shared", entries: shared }])
        .issues.forEach(i => issues.push(i));
      // 存在性检查走**合计**口径（卡内 + 共享书）—— 第四轮报告：这里此前只数卡内，于是同一份返回里
      // 「constantEntries: 1」与「没有 constant 常驻条目」并列出现（计算已经改对了，判断没跟着换变量）。
      if(all.length && !m.total.constant) add("warn", "no-constant", "没有 constant 常驻条目（卡内与共享书都没有）：世界观基调只在命中触发词时才出现", [], "mixed");
      if(all.length && !m.total.hasDecorator) add("warn", "no-decorator", "所有条目都没有 @@decorator（@@position/@@depth/@@activate），插入位置全用默认值", [], "mixed");
      const budget = Number(book.token_budget||0) || 0;
      if(budget>0 && used>budget){
        add("warn", "over-budget", "估算 " + used + " token（卡内 " + cardTokens + " + 共享书 " + sharedTokens + "），已超出本卡 token_budget=" + budget
          + (shared.length ? " —— 注意共享书是**独立一本**、由客户端分别管预算，调本卡预算盖不住它" : ""), [], "card");
      }
      // N2（0.7.0）：总量与「单次触发」是两个独立风险，只报总量会让「调大预算」看起来像修好了。
      // 范围 = 卡内 + 共享书（derived.worstCase 就是按这个范围算的，与 0.9.x 逐字一致）。
      const worst = metrics.derived.worstCase;
      const worstCase = { tokens: worst.tokens, constantTokens: worst.constantTokens, budget, entries: worst.entries,
        overBudget: budget > 0 && worst.tokens > budget, sharedEntries: shared.length };
      if(worstCase.overBudget){
        add("warn", "worst-case-over-budget", "最坏情况单次触发约 " + worst.tokens + " token（含常驻 " + worst.constantTokens + "，预算 " + budget + "）：「" + worst.entries.join(" + ") + "」一句话就吃光整份预算（调大 token_budget 盖不住这条）。", worst.entries, "mixed");
      }
      if(!String(book.name||"").trim()) add("warn", "book-unnamed", "世界书没有名字（character_book.name 为空，导出后是一本无名的书）", [], "card");
      if(shared.length && !String(scope.bookName||"").trim()) add("warn", "shared-book-unnamed", "该组的共享世界书没有名字（导出成 lorebook_v3 文件后别人不知道叫什么）—— 用 cc_patch_shared_book 的 name 参数命名", [], "shared");
      const errorCount = issues.filter(i => i.level === "error").length;
      const lints = issues.filter(i => i.level === "error" || i.level === "warn").length;
      return { ok:true,
        entries: all.length,
        entriesSplit: { card: entries.length, shared: shared.length, total: all.length },
        manualEntries: m.card.manual,
        constantEntries: m.total.constant,
        lorebookTokens: used,
        tokenSplit: { card: cardTokens, shared: sharedTokens, total: used },
        sharedBook: shared.length ? { groupId: scope.groupId, name: scope.bookName, entries: shared.length, tokens: scope.tokens } : null,
        tokenBudget: budget, worstCase,
        issues, errorCount, warningCount: issues.length - errorCount,
        message: (issues.length
          ? "体检发现 " + issues.length + " 个问题（" + errorCount + " 个会真的不工作）：" + issues.map(i=>i.message).join("；")
          : "世界书体检通过：没有发现结构性问题。")
          + (shared.length ? "（含该组共享世界书 " + shared.length + " 条 / 约 " + sharedTokens + " token，共 " + lints + " 项在册）" : "") };
    }
  });

  // ——————————————————————————————————————————————————————————————
  // 0.8.0 新增工具：人物关系图谱（4 个）
  // 关系数据活在插件侧（<DSH_HOME>/cc-groups/），**不写进 CCv3 任何字段**；要让分享出去的卡
  // 自包含，就用 cc_render_relations 把关系渲染进 description 的固定标记区。
  // 分组本身由用户在工坊右侧「已存角色」里创建与维护（「同一世界观拉进同一组」），工具侧只读写关系。
  // ——————————————————————————————————————————————————————————————

  tool({
    name: "cc_get_relations",
    description: "【关系·读】查看当前卡所在分组的人物关系网（三维：方向 from→to / 类型 type / 强度 strength 1-5）。默认只回与当前卡相关的边（省上下文）。关系存在插件侧、不写进卡；卡还没入库或没入组时会明确告知并列出现有分组 —— 别硬猜分组 id。改关系用 cc_patch_relations，写进卡里用 cc_render_relations。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：显式指定分组 id（默认用当前卡所属分组）" },
        scope:{ type:"string", enum:["mine","all"], description:"mine（默认）= 只回与当前卡相关的边；all = 回整组节点与边" },
        includeNodes:{ type:"boolean", description:"是否附带节点清单（默认 true）" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok){
        return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
          message: (r.cardId ? "这张卡（" + r.cardId + "）还没有加入任何分组。" : "当前草稿还没有关联已存卡（没有来源 id）。")
            + "关系网按分组组织：请让用户在工坊右侧「已存角色」里新建分组、把同一世界观的卡拉进同一组，然后重试。现有分组："
            + (r.groups.length ? r.groups.map(g => g.name + "（" + g.id + "，" + g.memberCount + " 卡 / " + g.edgeCount + " 关系）").join("；") : "（暂无）") };
      }
      const g = r.group, myNode = r.myNode;
      const scope = (args.scope === "all") ? "all" : "mine";
      const edges = (scope === "all" || !myNode) ? g.edges.slice() : g.edges.filter(e => e.from === myNode.id || e.to === myNode.id);
      const needIds = new Set();
      edges.forEach(e => { needIds.add(e.from); needIds.add(e.to); });
      if(myNode) needIds.add(myNode.id);
      const nodes = g.nodes.filter(n => scope === "all" || needIds.has(n.id) || n.kind === "card");
      const res = { ok:true,
        group: { id: g.id, name: g.name, rev: g.rev },
        cardId: r.cardId || null, myNodeId: myNode ? myNode.id : null, scope,
        edges: edges.map(e => ({
          id: e.id, from: e.from, to: e.to,
          fromName: nameOfNode(g.nodes, e.from), toName: nameOfNode(g.nodes, e.to),
          type: e.type, typeLabel: REL_TYPE_LABELS[e.type] || e.type, label: e.label || "",
          strength: e.strength, direction: e.direction, note: e.note,
          mine: myNode ? (e.from === myNode.id ? "out" : (e.to === myNode.id ? "in" : null)) : null,
        })),
        groups: r.groups,
        message: "分组「" + g.name + "」共 " + g.nodes.length + " 个节点 / " + g.edges.length + " 条关系"
          + (scope === "mine" ? "；与当前卡相关 " + edges.length + " 条。" : "。") };
      if(args.includeNodes !== false) res.nodes = nodes.map(n => ({ id:n.id, kind:n.kind, cardId:n.cardId, name:n.name, aliases:n.aliases, orphan: n.kind === "card" && !n.cardId }));
      return res;
    }
  });

  tool({
    name: "cc_patch_relations",
    description: "【关系·改】增删改人物关系（三维：方向 from→to / 类型 type / 强度 strength）。ops 是动作数组：{op:\"addNode\",kind:\"npc\"|\"card\",cardId?,name,aliases?} / {op:\"updateNode\",nodeId,name?,aliases?} / {op:\"removeNode\",nodeId,removeEdges?} / {op:\"addEdge\",from,to,type,strength,direction,note?} / {op:\"updateEdge\",edgeId,同 addEdge 的字段} / {op:\"removeEdge\",edgeId}。type 取值 family/romance/mentor/friend/colleague/rival/enemy/debt/superior/other；direction：mutual=对等（一条边即可）｜one-way=不对称（A→B 与 B→A 可以不同，这正是「三维」的价值）。**只改插件侧图谱**，要进卡请再调 cc_render_relations。删节点/删边是破坏性操作，先与用户确认。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        ops:{ type:"array", items:{ type:"object", additionalProperties:true }, description:"动作数组，逐项见工具说明" },
        expectedGroupRev:{ type:"number", description:"可选乐观锁：传上次 cc_get_relations 返回的 group.rev。**注意与 expectedRev 不同** —— expectedRev 是草稿的版本号（包装层统一校验），这里校验的是**分组图谱**的版本" },
      },
      required:["ops"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok){
        return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
          message: "这张卡还没入库或没加入分组，关系无处可放。请让用户先在工坊右侧「已存角色」里建组并把它拉进去。" };
      }
      const g = r.group;
      // ⚠️ 分组 rev 与草稿 rev 是两件事：expectedGroupRev 校验**图谱**，expectedRev（包装层）校验**草稿**。
      // 曾经两者同名，结果传分组 rev 会被包装层当成草稿 rev 拒掉（且错误文案说「草稿已被外部修改」，极具误导性）。
      if(typeof args.expectedGroupRev === "number" && args.expectedGroupRev !== g.rev){
        return { ok:false, staleGroupRev:true, expectedGroupRev: args.expectedGroupRev, actualRev: g.rev,
          group: { id: g.id, name: g.name, rev: g.rev },
          error: "分组「" + g.name + "」已被外部修改（期望 rev=" + args.expectedGroupRev + "，实际 rev=" + g.rev + "）—— 先 cc_get_relations 重新读一遍再改。" };
      }
      const applied = applyGroupOps(g, args.ops);
      if(!applied.applied.length){
        return { ok:false, error:"没有任何 op 生效（原因见 rejected）", rejected: applied.rejected, group: { id: g.id, name: g.name, rev: g.rev } };
      }
      const saved = await writeGroup(applied.group);
      return { ok:true, applied: applied.applied, rejected: applied.rejected,
        group: { id: saved.id, name: saved.name, rev: saved.rev },
        nodes: saved.nodes.map(n => ({ id:n.id, kind:n.kind, name:n.name, cardId:n.cardId, aliases:n.aliases })),
        edges: saved.edges.map(e => ({ id:e.id, from:e.from, to:e.to, type:e.type, strength:e.strength, direction:e.direction, note:e.note })),
        message: "已改 " + applied.applied.length + " 项"
          + (applied.rejected.length ? "（" + applied.rejected.length + " 项被拒：" + applied.rejected.map(x => x.error).join("；") + "）" : "")
          + "。图谱 rev=" + saved.rev + "；把关系写进卡里请再调 cc_render_relations，并 cc_save_to_library 落库。" };
    }
  });

  tool({
    name: "cc_render_relations",
    description: "【关系·渲染】把当前卡在图谱里的关系渲染进 description 的固定标记区（<!-- cc-relations:begin --> … <!-- cc-relations:end -->），让**导出的卡自包含** —— 别人拿到卡就能看到这些关系，不依赖插件数据。默认只写「我对别人的看法」（出边）；includeIncoming:true 时追加一节「他们眼中的我」。dryRun:true 只回预览不改动。渲染后要 cc_save_to_library 才落库；重复渲染是**替换**，不会越写越长。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        includeIncoming:{ type:"boolean", description:"是否额外渲染「他们眼中的我」（默认 false）" },
        dryRun:{ type:"boolean", description:"true = 只回预览、不改草稿" },
        expectedGroupRev:{ type:"number", description:"可选乐观锁：**分组** rev 不符则拒绝（与草稿的 expectedRev 不同）" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok){
        return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
          message: "这张卡还没入库或没加入分组，没有关系可渲染。" };
      }
      const g = r.group;
      if(!r.myNode){
        return { ok:false, error:"分组「" + g.name + "」里没有这张卡的节点：先在工坊关系视图里把它加入分组（或用 cc_patch_relations 加一个 kind:\"card\" 的节点）。" };
      }
      if(typeof args.expectedGroupRev === "number" && args.expectedGroupRev !== g.rev){
        return { ok:false, staleGroupRev:true, expectedGroupRev: args.expectedGroupRev, actualRev: g.rev,
          error:"分组「" + g.name + "」已被外部修改（期望 rev=" + args.expectedGroupRev + "，实际 rev=" + g.rev + "）—— 先 cc_get_relations 重读再渲染。" };
      }
      const section = renderRelationsSection(r.myNode.id, g.nodes, g.edges, { includeIncoming: args.includeIncoming === true });
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const before = String((cur.data && cur.data.description) || "");
      const after = spliceRelations(before, section, "rev=" + g.rev + " group=" + g.id);
      const changed = before !== after;
      // 计数必须与渲染**同一口径**（outgoingEdgesOf 含「指向我的 mutual 边」），否则会出现
      // 「预览说 1 条、实际写出 2 条」这种对不上账的返回。
      const outgoing = outgoingEdgesOf(r.myNode.id, g.edges).length;
      if(args.dryRun === true){
        return { ok:true, dryRun:true, changed, outgoing, section, preview: after,
          group: { id: g.id, name: g.name, rev: g.rev },
          message: "预览：将写入 " + outgoing + " 条关系（" + (changed ? "description 会变化" : "与现状一致，无需重写") + "）。" };
      }
      if(changed){
        // ⚠️ 这一行曾经漏掉：changed 算出来了、setDraft 也调了，但 description 还是旧值 —— 表现是
        // 「返回 changed:true 而卡里什么都没变」，而且不好看出来（rev 照样递增）。
        cur.data.description = after;
        setDraft(ctx, cur, exec);
      }
      return { ok:true, changed, changedFields: changed ? ["description"] : [], outgoing, description: after,
        group: { id: g.id, name: g.name, rev: g.rev }, workflow: await workflowFor(ctx, exec, cur),
        message: (changed ? "已把 " + outgoing + " 条关系写进 description 的【关系】段" : "description 里已经是最新关系，无需改动")
          + "。注意：这只改了**当前草稿**，要落库请再调 cc_save_to_library（或让用户在工坊点「保存当前」）。" };
    }
  });

  tool({
    name: "cc_group_check",
    description: "【关系·体检】跨卡检查一个分组：图谱结构（孤儿节点 / 悬空关系 / 重名节点 / 未知类型）、卡内【关系】段（没渲染 / 落后于图谱）、**群聊每轮固定开销**（成员卡 constant + 共享书 constant vs 最小预算 —— 卡越多这块钱越贵，单卡体检看不出来）、**共享书条目质量**（死 key / 只有维度名的 key）、**跨卡一致性**（同一个触发词被多张卡共用、卡内条目与共享书逐字重复、组内五维漂移、成员卡全 auto）。做完一批群聊卡后调一次。用 checks 可只跑其中几类（structure / relations / budget / lore-quality / cross-card）。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        checks:{ type:"array", items:{ type:"string" }, description:"可选：只跑指定检查类别（structure / relations / budget / lore-quality / cross-card），缺省全跑" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok){
        return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
          message: "这张卡还没入库或没加入分组，没有可体检的对象。" };
      }
      const g = r.group;
      // 0.10.0：成员与共享书从卡组作用域取（一次读盘、形状唯一）—— 不再自己 readBookRaw + normalizeBook。
      const scope = await groupScope({ groupId: g.id, include: "summary" });
      const memberIds = scope.memberIds;
      const cards = await libraryCardsFor(memberIds);
      const sharedEntries = scope.book ? scope.book.entries : [];
      // 数字与跨卡检查的输入都来自卡组层：metrics 给预算类，scope 给跨卡一致性（成员条目与五维）
      const metrics = groupMetrics({ cardId: scope.cardId, card: [], members: scope.members, book: sharedEntries });
      const res = checkGroup(g, memberIds, cards, sharedEntries, { checks: args.checks, scope: scope, metrics: metrics });
      const errorCount = res.issues.filter(i => i.level === "error").length;
      return { ok:true,
        group: { id: g.id, name: g.name, rev: g.rev },
        issues: res.issues, stats: res.stats,
        checks: res.ran, byCheck: res.byCheck,     // 跑过哪些类别 / 每类几条（0.10.0）
        errorCount, warningCount: res.issues.length - errorCount,
        members: cards.map(c => ({ id: c.id, name: c.name })),
        message: res.issues.length
          ? "分组「" + g.name + "」发现 " + res.issues.length + " 个问题（" + errorCount + " 个会真的不工作）：" + res.issues.map(i => i.message).join("；")
          : "分组「" + g.name + "」体检通过：" + res.stats.members + " 张成员卡 / " + res.stats.edges + " 条关系，没有结构性问题。" };
    }
  });

  // ———————————————— 分组管理（0.8.0 补：LLM 侧的增删改查）————————————————
  // 此前 LLM 只能读写**组内图谱**，却改不了「哪张卡属于哪个组」：卡一旦掉组，模型既救不回来、
  // 也建不了新组，只能干等用户点界面 —— 而真正高频使用这套工具的恰恰是模型（用户自己说的）。
  // 四个动作（查/增/改/删）+ 一个归位，落盘规则与宿主半的 cc_listGroups / cc_createGroup /
  // cc_renameGroup / cc_deleteGroup / cc_setCardGroup 逐条对齐。

  tool({
    name: "cc_list_groups",
    description: "【分组·查】列出全部人物关系分组：每组有多少成员卡 / 节点 / 关系，以及**当前卡在哪一组**。改某张卡的分组用 cc_set_card_group；建组 / 改名 / 删组用 cc_create_group / cc_rename_group / cc_delete_group。",
    parameters: {
      type:"object",
      properties:{ includeCards:{ type:"boolean", description:"是否额外列出未分组的卡（默认 true，最多 20 张）" } },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const origin = readOriginSync(k);
      const cardId = (origin && origin.libraryId) ? String(origin.libraryId) : "";
      const entries = await listLibraryEntries();
      const mine = cardId ? (entries.find(e => e.id === cardId) || null) : null;
      const groups = await groupSummaries();
      const ungrouped = entries.filter(e => !String(e.groupId || ""));
      const myGroupId = (mine && mine.groupId) ? String(mine.groupId) : null;
      const myGroup = myGroupId ? (groups.find(g => g.id === myGroupId) || null) : null;
      const res = {
        ok:true,
        groups: groups.map(g => Object.assign({}, g, { isMine: g.id === myGroupId })),
        groupCount: groups.length, cardCount: entries.length, ungroupedCount: ungrouped.length,
        cardId: cardId || null, cardName: mine ? mine.name : "", groupId: myGroupId,
        message: groups.length
          ? "共 " + groups.length + " 个分组、库里 " + entries.length + " 张卡（" + ungrouped.length + " 张未分组）"
            + (mine
              ? "；当前卡「" + mine.name + "」" + (myGroup
                ? "在分组「" + myGroup.name + "」里"
                : (myGroupId ? "的 groupId 指向一个已不存在的分组（" + myGroupId + "），建议用 cc_set_card_group 重新归位" : "还没有加入分组"))
              : "")
            + "。"
          : "还没有任何分组" + (entries.length ? "（库里有 " + entries.length + " 张卡）" : "") + "：用 cc_create_group 建一个，再用 cc_set_card_group 把卡放进去。",
      };
      if(args.includeCards !== false) res.ungroupedCards = ungrouped.slice(0, 20).map(e => ({ id: e.id, name: e.name }));
      return res;
    }
  });

  tool({
    name: "cc_create_group",
    description: "【分组·增】新建一个人物关系分组（群聊 / 同一世界观的一批卡放一起）。分组是插件侧数据、不会自动进卡 —— 关系要进卡请再调 cc_render_relations。同名分组已存在时**默认拒绝**并回已有 id（避免出现两个同名组）；确实要重名再传 allowDuplicate:true。",
    parameters: {
      type:"object",
      properties:{
        name:{ type:"string", description:"分组名（≤60 字）" },
        note:{ type:"string", description:"可选备注（≤200 字）" },
        allowDuplicate:{ type:"boolean", description:"默认 false：同名分组已存在则拒绝并告知 existingGroupId" },
      },
      required:["name"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args){
      const name = String(args.name || "").trim().slice(0, 60);
      if(!name) return { ok:false, error:"分组名不能为空" };
      const dup = findGroupByName(await listGroups(), name, "");
      if(dup && args.allowDuplicate !== true){
        return { ok:false, duplicate:true, existingGroupId: dup.id, groups: await groupSummaries(),
          message:"已有同名分组「" + dup.name + "」（id " + dup.id + "）—— 直接把卡放进去就行：cc_set_card_group({groupId:\"" + dup.id + "\"})；确实要另建一个同名的再传 allowDuplicate:true。" };
      }
      const g = await writeGroup({ id: newGroupId(), name, note: String(args.note || "").slice(0, 200), nodes: [], edges: [] });
      return { ok:true, group: { id:g.id, name:g.name, note:g.note, rev:g.rev },
        groups: await groupSummaries(),
        message:"已建分组「" + g.name + "」（id " + g.id + "）。用 cc_set_card_group 把卡放进去，再用 cc_patch_relations 在组内建关系。" };
    }
  });

  tool({
    name: "cc_rename_group",
    description: "【分组·改】改分组名或备注（至少传一个）。只改分组本身，不动成员卡与关系；改成与别的分组同名时默认拒绝，除非 allowDuplicate:true。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"分组 id（见 cc_list_groups）" },
        name:{ type:"string", description:"新分组名（≤60 字）" },
        note:{ type:"string", description:"新备注（≤200 字；空串 = 清空备注）" },
        allowDuplicate:{ type:"boolean", description:"默认 false：与别的分组撞名则拒绝" },
      },
      required:["groupId"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args){
      const gid = safeGroupId(args.groupId);
      const found = await readGroupRaw(gid);
      if(!found) return { ok:false, notFound:true, groups: await groupSummaries(), message:"分组不存在：" + String(args.groupId) + " —— 先 cc_list_groups 看现有分组。" };
      const g = normalizeGroup(found.obj);
      const wantName = (typeof args.name === "string" && args.name.trim()) ? args.name.trim().slice(0, 60) : "";
      const wantNote = (typeof args.note === "string") ? args.note.slice(0, 200) : null;
      if(!wantName && wantNote === null) return { ok:false, error:"至少传 name 或 note 之一" };
      if(wantName){
        const dup = findGroupByName(await listGroups(), wantName, gid);
        if(dup && args.allowDuplicate !== true){
          return { ok:false, duplicate:true, existingGroupId: dup.id, groups: await groupSummaries(),
            message:"已有同名分组「" + dup.name + "」（id " + dup.id + "）—— 换个名字，或确实要重名再传 allowDuplicate:true。" };
        }
      }
      const changed = [];
      if(wantName && wantName !== g.name){ changed.push("name"); g.name = wantName; }
      if(wantNote !== null && wantNote !== g.note){ changed.push("note"); g.note = wantNote; }
      // 无实际改动不写盘：同 N4 家规（空改动不该白涨 rev，否则别人手上的 rev 前提会被无变化打掉）
      if(!changed.length) return { ok:true, changed:[], group:{ id:g.id, name:g.name, note:g.note, rev:g.rev }, message:"分组「" + g.name + "」的名字与备注本来就是这两样，没有改动。" };
      const saved = await writeGroup(g);
      return { ok:true, changed, group:{ id:saved.id, name:saved.name, note:saved.note, rev:saved.rev },
        groups: await groupSummaries(),
        message:"已改分组「" + saved.name + "」的 " + changed.join(" / ") + "（rev=" + saved.rev + "）。" };
    }
  });

  tool({
    name: "cc_delete_group",
    description: "【分组·删·破坏性】删除一个人物关系分组：**组里的节点与关系会一起消失且不可恢复**；成员卡本身不会被删，只是离开这个组。默认必须带 confirm:true 才真的执行 —— 第一次调用只回该组有多少节点/关系，供你先与用户确认。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"分组 id（见 cc_list_groups）" },
        confirm:{ type:"boolean", description:"必须显式传 true 才执行删除" },
      },
      required:["groupId"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args){
      const gid = safeGroupId(args.groupId);
      const found = await readGroupRaw(gid);
      if(!found) return { ok:false, notFound:true, groups: await groupSummaries(), message:"分组不存在：" + String(args.groupId) + " —— 先 cc_list_groups 看现有分组。" };
      const g = normalizeGroup(found.obj);
      const members = await groupMemberIds(gid);
      if(args.confirm !== true){
        // 盘点必须把**共享世界书**也算进「会被删掉且不可恢复」的东西里（第二轮报告 4.1）：
        // 那可能是用户花了很多时间整理的设定，而原先的破坏性提示只提了节点/关系。
        const bf = await readBookRaw(gid);
        const bookCount = bf ? normalizeBook(bf.obj, gid).data.entries.length : 0;
        return { ok:false, needConfirm:true,
          group: { id:g.id, name:g.name, nodeCount:g.nodes.length, edgeCount:g.edges.length, memberCount:members.length },
          bookEntries: bookCount, hasBook: !!bf,
          message:"「" + g.name + "」里有 " + g.nodes.length + " 个节点 / " + g.edges.length + " 条关系，删组会一起删掉且不可恢复；" + members.length + " 张成员卡不会被删，只会离开这个组。"
            + (bf ? "本组另有共享世界书 " + bookCount + " 条（" + (String(normalizeBook(bf.obj, gid).data.name||"").trim() || "未命名") + "），也会一并删除且不可恢复。" : "")
            + "与用户确认后重调并带 confirm:true。" };
      }
      const del = await deleteGroupWithMembers(gid);
      const bookDeleted = await deleteBook(gid);   // 0.9.0：组级共享世界书随组一起删（留下就是孤儿文件）
      return { ok:true, deleted: del.deleted, memberCleared: del.memberCleared, bookDeleted,
        groups: await groupSummaries(),
        message:"已删除分组「" + del.deleted.name + "」（连同 " + del.deleted.nodeCount + " 个节点 / " + del.deleted.edgeCount + " 条关系）；" + del.memberCleared + " 张成员卡已移出分组，卡本身没删。"
          + (bookDeleted ? "该组的共享世界书也一并删除了。" : "") };
    }
  });

  tool({
    name: "cc_set_card_group",
    description: "【分组·归位】把一张已存卡放进分组 / 换组 / 移出。**不传 groupId（或传 null / 空串）= 移出分组**。cardId 省略时用**当前草稿的来源卡**（你正在做的那张）。入组时若组里还没有它的节点会自动补一个；移出**不删节点与关系**（以后放回来关系还在）。卡因任何原因掉了组，也用它自救。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"目标分组 id（见 cc_list_groups）。**不传 / null / 空串 = 移出分组**" },
        cardId:{ type:"string", description:"可选：要归位的已存卡 id（见 cc_list_library）；默认用当前草稿的来源卡" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const entries = await listLibraryEntries();
      const k = keyFor(ctx, exec);
      const origin = readOriginSync(k);
      const fromOrigin = (origin && origin.libraryId) ? String(origin.libraryId) : "";
      const cardId = (typeof args.cardId === "string" && args.cardId.trim()) ? args.cardId.trim() : fromOrigin;
      if(!cardId){
        const ungrouped = entries.filter(e => !String(e.groupId || ""));
        return { ok:false, needCardId:true, cardId:null,
          groups: await groupSummaries(),
          cards: entries.slice(0, 20).map(e => ({ id:e.id, name:e.name, groupId: e.groupId ? String(e.groupId) : null })),
          message:"当前草稿还没入库（没有来源卡 id），不知道要归位哪张卡：先用 cc_save_to_library 落库，或从 cc_list_library 拿到 id 后带上 cardId 重调。"
            + (ungrouped.length ? " 库里现在有 " + ungrouped.length + " 张未分组的卡。" : "") };
      }
      let r;
      try{ r = await assignCardToGroup(cardId, (args.groupId === null || args.groupId === undefined) ? null : String(args.groupId)); }
      catch(e){
        const code = e && e.code;
        if(code === "ENOENT") return { ok:false, notFound:true, cardId, cards: entries.slice(0, 20).map(x => ({ id:x.id, name:x.name })),
          message:"库里找不到这张卡：" + cardId + "（可能已被删除）—— 卡 id 见 cc_list_library。" };
        if(code === "not-found") return { ok:false, notFound:true, groupId: String(args.groupId), groups: await groupSummaries(),
          message:"分组不存在：" + String(args.groupId) + " —— 先 cc_create_group 建组，或 cc_list_groups 看现有 id。" };
        throw e;
      }
      const groups = await groupSummaries();
      const g = r.groupId ? (groups.find(x => x.id === r.groupId) || null) : null;
      return { ok:true,
        cardId: r.cardId, cardName: r.cardName,
        groupId: r.groupId, group: g ? { id:g.id, name:g.name, rev:g.rev, memberCount:g.memberCount } : null,
        previousGroupId: r.previousGroupId, nodeId: r.nodeId || null, revived: r.revived === true,
        groups,
        message: r.groupId
          ? "已把「" + r.cardName + "」放进分组「" + (g ? g.name : r.groupId) + "」"
            + (r.previousGroupId && r.previousGroupId !== r.groupId ? "（从分组 " + r.previousGroupId + " 换过来的）" : "")
            + "，这组现在有 " + (g ? g.memberCount : "?") + " 张成员卡。关系用 cc_patch_relations 改，写完用 cc_render_relations 进卡。"
          : "已把「" + r.cardName + "」移出分组"
            + (r.previousGroupId ? "（原来在分组 " + r.previousGroupId + "）" : "")
            + "。组里的节点与关系**保留**了 —— 之后放回去，关系还在。" };
    }
  });

  // ———————————————— 组级共享世界书（0.9.0）————————————————
  // 一组一份：世界设定（年表/势力/地理/力量/日常）提到共享书，成员卡里只留角色私有条目。
  // 导出后有两种形态，各有各的读者（0.9.1 补）：CCv3 官方 lorebook_v3 JSON 给认这个规范的客户端；
  // **SillyTavern 只认它自己的 `{entries:{…}}`**（ST 的 /api/worldinfo/import 首句就查顶层 entries，
  // 拖 lorebook_v3 进去实测 400）—— 工坊导出页两枚按钮分别对应，别混着说。

  tool({
    name: "cc_get_shared_book",
    description: "【共享书·查】读当前（或指定）分组的**组级共享世界书**（一组一份、整组共用），并报出「成员卡之间有多少条重复条目」—— 那些就是该提升到共享书的。共享书是独立文件，工坊导出页给两种形态：**CCv3 独立世界书**（`{spec:\"lorebook_v3\", data}`，给支持该规范的客户端绑成全局世界书）与 **SillyTavern 世界书**（`{entries:{…}}`）。⚠️ SillyTavern 的导入接口只认后者（它连 `lorebook_v3` 都不认，直接拖前者进去会被判 400 Bad Request）—— 所以「交给客户端」时要说清是哪种，别让用户拿到 CCv3 那份去导 ST。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        includeContent:{ type:"boolean", description:"true = 连条目全文一起回（默认只回 name/keys/长度/前 80 字，省上下文）" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok) return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
        message:"当前卡还没入库或没加入分组，而共享世界书是按组存放的 —— 先 cc_create_group / cc_set_card_group 把它归到一组。" };
      const g = r.group;
      // 0.10.0：书与成员都从卡组作用域取（一次读盘、形状唯一）—— 本工具不再自己 readBookRaw + normalizeBook。
      const scope = await groupScope({ groupId: g.id, include: "summary" });
      const cards = await bookCardsFor(scope.memberIds);   // scan 要比内容，需要完整条目
      const book = (scope.book && scope.book.doc) ? scope.book.doc : null;
      const found = !!book;
      // 把**书**一起交给 scan —— 否则「卡内条目与共享书逐字重复」这一类（`cc_apply_shared_book` 回填进卡的副本）
      // 谁都看不见：卡片之间没有重复、书里也没有重复，于是两个工具都说「没有重复」，而那几份副本就躺在卡里
      // 等着和共享书双重插入（第二轮报告 P1）。
      const scan = scanSharedEntries(cards, book ? book.data.entries : []);
      const duplicates = scan.candidates.map(c => ({ signature: c.signature, name: c.name, cardNames: c.cardNames,
        chars: c.chars, savedChars: c.savedChars, nameMismatch: c.nameMismatch, keysMismatch: c.keysMismatch, preview: c.preview }));
      const bookDuplicates = scan.bookDupes.map(c => ({ kind: c.kind, signature: c.signature, name: c.name, cardNames: c.cardNames,
        chars: c.chars, savedChars: c.savedChars, preview: c.preview }));
      // 共享书**自己的**逐条质量检查（第五轮报告：这条线上此前只有重复检测，那四类检查在书上是空的）。
      // 与 cc_lint_lorebook 共用同一把尺子（auditLoreEntries）—— 一份 issue 带 contentKeys，可直接改。
      const bookLint = auditLoreEntries([{ source: "shared", entries: book ? book.data.entries : [] }]);
      const base = { ok:true, group:{ id:g.id, name:g.name, rev:g.rev }, exists: !!found,
        bookRev: book ? bookRevOf(book) : 0,
        cards: cards.map(c => ({ id:c.id, name:c.name, entries:(c.entries||[]).length })),
        duplicates, bookDuplicates, duplicateStats: scan.stats,
        lint: { issues: bookLint.issues, errorCount: bookLint.errorCount, warningCount: bookLint.issues.length - bookLint.errorCount } };
      if(!found){
        return Object.assign(base, { message: "分组「" + g.name + "」还没有共享世界书。"
          + (scan.candidates.length
            ? "成员卡之间有 " + scan.candidates.length + " 条内容重复的条目（合计可省约 " + scan.stats.savedChars + " 字符）—— 用 cc_promote_shared_entries 提升到共享书，再从各卡里删掉。"
            : "成员卡之间也没有内容重复的条目。") });
      }
      const tokens = estimateTokens(book.data.entries.map(e => e.content).join("\n"));
      return Object.assign(base, {
        book: bookBrief(book, args.includeContent === true), tokens,
        lastPromote: (book.data.extensions && book.data.extensions.cc && book.data.extensions.cc.lastPromote) || null,
        message: "共享世界书「" + book.data.name + "」共 " + book.data.entries.length + " 条（rev " + bookRevOf(book) + "，约 " + tokens + " token"
          + "，预算 " + book.data.token_budget + "）；分组里有 " + cards.length + " 张成员卡"
          + (scan.candidates.length ? "，卡片之间有 " + scan.candidates.length + " 条内容重复（可用 cc_promote_shared_entries 收进共享书）" : "，卡片之间已无重复条目")
          + (scan.bookDupes.length
            ? "；另有 " + scan.bookDupes.length + " 条在卡里与共享书**逐字重复**（共 " + scan.stats.bookDuplicatedEntries + " 份副本、约 " + scan.stats.bookSavedChars + " 字符）—— 共享书里已经有了，用 cc_promote_shared_entries 清掉卡里那几份即可（不会再往书里加）"
            : "")
          + (bookLint.issues.length
            ? "；⚠️ **这本书自身有 " + bookLint.issues.length + " 个条目质量问题**（" + bookLint.issues.map(i => i.message).join("；")
              + "）—— 共享书在**每一张**成员卡上都生效：一条死 key 等于在所有卡上都没写、一条维度名 key 等于在每张卡上白吃 token。按 lint.issues[].contentKeys 用 cc_patch_shared_book 直接改"
            : "")
          + "。" });
    }
  });

  tool({
    name: "cc_patch_shared_book",
    description: "【共享书·改】增删改组级共享世界书的条目与书级参数。ops：{op:\"addEntry\",entry:{keys,content,name?,constant?,insertion_order?,use_regex?,...}} / {op:\"updateEntry\",contentKey,patch:{…}} / {op:\"removeEntry\",contentKey}（contentKey 由 cc_get_shared_book 给出）。书级参数直接传 name / description / scan_depth / token_budget / recursive_scanning。条目字段与卡内 character_book 条目**完全同构**（改完可以原样搬回卡里）。只改共享书本身 —— 成员卡里已有的旧副本要用 cc_promote_shared_entries 清掉。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        name:{ type:"string", description:"书级：书名" },
        description:{ type:"string", description:"书级：备注" },
        scan_depth:{ type:"number", description:"书级：扫描深度" },
        token_budget:{ type:"number", description:"书级：token 预算" },
        recursive_scanning:{ type:"boolean", description:"书级：递归扫描" },
        ops:{ type:"array", items:{ type:"object", additionalProperties:true }, description:"条目动作数组" },
        expectedBookRev:{ type:"number", description:"可选乐观锁：传上次 cc_get_shared_book 的 bookRev（与 expectedRev / expectedGroupRev 都不同：那是草稿 / 图谱的版本）" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok) return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
        message:"当前卡还没入库或没加入分组，共享世界书无处可放 —— 先把它归到一组。" };
      const res = await patchSharedBook(r.group.id, args);
      if(!res.ok){
        return { ok:false, staleBookRev: res.staleBookRev === true,
          expectedBookRev: res.expectedBookRev == null ? null : res.expectedBookRev,
          actualBookRev: res.actualBookRev == null ? null : res.actualBookRev,
          error: String(res.error || "") };
      }
      const entries = res.book.data.entries.length;
      return { ok:true, changed: res.changed, applied: res.applied, rejected: res.rejected,
        bookRev: res.rev, group:{ id:r.group.id, name:r.group.name },
        book: { name: res.book.data.name, entries, tokens: estimateTokens(res.book.data.entries.map(e => e.content).join("\n")) },
        message: res.changed
          ? "已改共享世界书（rev " + res.rev + "，共 " + entries + " 条）" + (res.rejected.length ? "；" + res.rejected.length + " 项被拒：" + res.rejected.map(x => x.error).join("；") : "")
            + "。注意：成员卡里如果还留着这些条目的旧副本，用 cc_promote_shared_entries 清掉才不会重复。"
          : "没有任何改动（" + (res.rejected.length ? res.rejected.map(x => x.error).join("；") : "ops 为空且没有书级参数") + "）。" };
    }
  });

  tool({
    name: "cc_promote_shared_entries",
    description: "【共享书·去重】把成员卡里**内容重复的条目**提升进共享世界书，并从每一张出现过它的卡里删掉 —— 这就是「群聊卡世界书重复」的正解。**默认只回预览（dryRun）**，要真动手必须传 apply:true。不带 keys 时处理扫描出的全部候选；也可只传其中几个 signature。执行前会逐字比对内容（签名只用来筛，绝不按哈希删数据）。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        keys:{ type:"array", items:{ type:"string" }, description:"可选：只处理这些 signature（来自 cc_get_shared_book 的 duplicates）" },
        apply:{ type:"boolean", description:"必须显式 true 才真的写盘（要从多张卡里删条目）" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok) return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
        message:"当前卡还没入库或没加入分组，共享世界书按组存放 —— 先把它归到一组。" };
      const res = await promoteSharedBook(r.group.id, args);
      if(!res.ok) return { ok:false, error: String(res.error || "") };
      if(res.dryRun){
        const nothing = !res.wouldPromote && !res.wouldClean;
        return { ok:true, dryRun:true, wouldPromote: res.wouldPromote, wouldClean: res.wouldClean, unknownKeys: res.unknownKeys,
          removedTotal: res.removedTotal, savedChars: res.savedChars, perCard: res.perCard, duplicates: res.candidates,
          bookDuplicates: res.bookDuplicates, stats: res.stats,
          group:{ id:r.group.id, name:r.group.name }, bookRev: res.rev,
          message: nothing
            ? "没有可提升的重复条目" + (res.unknownKeys.length ? "（" + res.unknownKeys.length + " 个 signature 不认识，已忽略）" : "") + "。"
            : "预览："
              + (res.wouldPromote ? "把 " + res.wouldPromote + " 条提升进共享世界书，" : "")
              + (res.wouldClean ? "清掉卡里 " + res.wouldClean + " 条与共享书逐字重复的副本（书里已经有了，不会再往书里加），" : "")
              + "将从成员卡里共删掉 " + res.removedTotal + " 条（可省约 " + res.savedChars + " 字符）。确认后带 apply:true 重调。" };
      }
      // 库里已经删干净了，但**草稿是另一个副本** —— 顺手同步（见 syncDraftAfterPromote 的注释），
      // 同步不了就退回警告，绝不静默地让重复在下次保存时复活。
      const draftSync = await syncDraftAfterPromote(ctx, exec, r.group.id,
        (res.perCard || []).filter(c => c && !c.error && c.removed > 0).map(c => c.id));
      return {
        ok:true, dryRun:false, promoted: res.promoted, cleaned: res.cleaned, removedTotal: res.removedTotal, unknownKeys: res.unknownKeys,
        bookRev: res.bookRev, bookEntries: res.bookEntries, perCard: res.perCard, stats: res.stats,
        bookDuplicates: res.bookDuplicates,
        group:{ id:r.group.id, name:r.group.name }, draftSync,
        message: "已把 " + res.promoted + " 条设定提升进共享世界书（rev " + res.bookRev + "，共 " + res.bookEntries + " 条），并从成员卡里删掉 " + res.removedTotal + " 条重复："
          + res.perCard.map(c => c.name + " -" + (c.removed || 0)).join("、")
          + (res.cleaned ? "（其中 " + res.cleaned + " 条是共享书里早就有的副本，只做了清理）" : "")
          + (draftSync.synced ? "。你正在编辑的草稿就是其中一张，已同步删掉 " + draftSync.removed + " 条 —— 接着保存不会把重复写回去。" : "")
          + (draftSync.remaining ? "。⚠️ 当前草稿里还有 " + draftSync.remaining + " 条与共享书重复（" + draftSync.names.slice(0,5).join("、") + "）：这次只改了库里的卡，草稿里那份还在 —— 保存前先 cc_load_from_library 重新载入，否则重复会被原样写回卡里。" : "")
          + "导出时记得一并给客户端配这本共享世界书（工坊导出页可导出独立 JSON）。",
        warnings: draftSync.remaining ? ["这次提升只改了**库里的卡**，你正在编辑的那份草稿没被改动，里面仍有 " + draftSync.remaining + " 条与共享书逐字重复（" + draftSync.names.slice(0,5).join("、") + "）。接着 cc_save_to_library 会把它们原样写回卡里、重复照旧 —— 保存前先 cc_load_from_library 重新载入这张卡（或手动删掉这几条）。"] : undefined,
      };
    }
  });

  tool({
    name: "cc_apply_shared_book",
    description: "【共享书·回填】把共享世界书的条目**合并进当前卡**（或指定 cardId）的 character_book —— 给那些不支持全局世界书的客户端兜底。同内容已存在会跳过，所以重复调用安全。dryRun:true 只回预览。默认不合并：先导出独立文件、在客户端里绑全局世界书，才是零重复的做法。",
    parameters: {
      type:"object",
      properties:{
        groupId:{ type:"string", description:"可选：默认用当前卡所属分组" },
        cardId:{ type:"string", description:"可选：默认用当前草稿的来源卡" },
        dryRun:{ type:"boolean", description:"true = 只回会加几条，不改卡" },
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const r = await resolveGroupFor(ctx, exec, args.groupId);
      if(!r.ok) return { ok:false, needGroup:true, cardId:r.cardId || null, groups:r.groups,
        message:"当前卡还没入库或没加入分组，没有可回填的共享世界书。" };
      const k = keyFor(ctx, exec);
      const origin = readOriginSync(k);
      const cardId = args.cardId ? String(args.cardId) : ((origin && origin.libraryId) ? String(origin.libraryId) : "");
      const res = await applySharedBook(r.group.id, cardId, args.dryRun === true);
      if(!res.ok) return { ok:false, needCard: res.needCard === true, notFound: res.notFound === true, error: String(res.error || "") };
      if(res.dryRun){
        return { ok:true, dryRun:true, cardId: res.cardId, wouldAdd: res.wouldAdd, bookEntries: res.bookEntries, cardEntries: res.cardEntries,
          message: "预览：这张卡会新增 " + res.wouldAdd + " 条来自共享世界书的条目（现有 " + res.cardEntries + " 条）。" };
      }
      return { ok:true, cardId: res.cardId, added: res.added, changed: res.changed === true, loreCount: res.loreCount,
        message: res.added
          ? "已把这本共享世界书的 " + res.added + " 条合并进这张卡（现在 " + res.loreCount + " 条）。这只改了**库里的卡**；若你正在编辑草稿，记得重新载入或让用户在工坊里载入这张卡。"
          : "这张卡已经包含共享世界书里的全部条目，没有需要补充的。" };
    }
  });

  // 【导出干跑】补上「五维到底导不导出」这个此前没人能回答的问题
  tool({
    name: "cc_preview_export",
    description: "【导出·干跑】不落盘地预估导出结果：JSON 体积、各字段估算 token、最终会导出的字段清单（并回答「五维会不会一起导出」）、五维与世界书条目的重复内容量。导出前调一次，心里有数。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = getDraft(ctx, exec);
      const d = cur.data;
      const book = d.character_book || {};
      const entries = Array.isArray(book.entries) ? book.entries : [];
      const json = JSON.stringify(cur, null, 2);
      const w = (d.extensions && d.extensions.cc_world) || {};
      // 五维（extensions.cc_world）会被一起导出，且与 autoLorebook 生成的条目内容逐字重复 —— 量化给出
      let dupChars = 0;
      entries.forEach(e => { const c = String(e.content||""); WORLD_DIMS.forEach(k => { const t = String(w[k]||""); if(t && c.indexOf(t) >= 0) dupChars += t.length; }); });
      const exportedFields = ["name","nickname","tags","creator","character_version","description","personality","scenario","system_prompt","post_history_instructions","first_mes","alternate_greetings","group_only_greetings","mes_example","creator_notes","character_book","assets","creation_date","modification_date"];
      const bytes = Buffer.byteLength(json, "utf8");
      // 0.9.0 报告：导出预览只说「卡内世界书」，用户会以为这就是全部 —— 而客户端实际加载时
      // 是「卡内 character_book + 该组共享书」叠加，所以这里必须把共享书单列一行。
      const scope = await sharedBookScopeFor(ctx, exec);
      const shared = scope.entries;
      const metrics = lorebookMetrics(entries, shared);   // 0.10.0：token 口径走卡组层（数字与文案都不变）
      const cardTokens = metrics.card.tokens;
      const sharedTokens = metrics.shared.tokens;
      return { ok:true,
        bytes, tokens: estimateTokens(json),
        lorebookTokens: cardTokens + sharedTokens,
        lorebookSplit: { card: cardTokens, shared: sharedTokens, total: cardTokens + sharedTokens },
        sharedBook: shared.length ? { groupId: scope.groupId, name: scope.bookName, entries: shared.length, tokens: sharedTokens,
          hint: "独立一本，工坊导出页可单独导出（CCv3 客户端拿「CCv3 独立世界书」，**SillyTavern 拿「SillyTavern 世界书」**）；若客户端不支持全局世界书，可在导出时并入本卡。导卡时（JSON / PNG / CHARX）会**自动在导出副本上**写 `data.extensions.world = <书名>`（ST 的角色↔世界书绑定），PNG 里同时写 `ccv3`（纯 CCv3）与 `chara`（V2 回填）两个块 —— 草稿与库里的卡一个字节都不动" } : null,
        exportedFields, extensionsExported: Object.keys(d.extensions || {}),
        worldDuplicatedChars: dupChars,
        loreCount: entries.length, manualLoreCount: entries.filter(e => !isAutoEntry(e)).length,
        message: "预计导出 " + bytes + " 字节（约 " + estimateTokens(json) + " token），其中本卡世界书 " + cardTokens + " token"
          + (shared.length
            ? "；**本卡所属组另有共享世界书「" + (String(scope.bookName||"").trim() || "未命名") + "」" + shared.length + " 条 / 约 " + sharedTokens
              + " token** —— 客户端实际加载时两者叠加（合计 " + (cardTokens + sharedTokens) + " token），可单独导出该文件（**SillyTavern 要用「SillyTavern 世界书」那份**）或导出时并入本卡"
            : "")
          + "；五维（extensions.cc_world）会一起导出，与条目内容重复约 " + dupChars + " 字符。" };
    }
  });

  tool({
    name: "cc_validate",
    description: "【工作流第6步·收口必调】校验 CC 角色卡（SPEC_V3 + 角色四件套/五维≥3/世界书≥5/问候语齐）。valid=false 按 errors 与用户讨论继续补；**valid=true 即创作完成，必须立刻调用 cc_release_draft 交还草稿编辑权**（不交还的话工坊一直只读，用户无法微调），然后邀请用户在工坊微调后“导出 JSON”或“★ 保存到侧边栏”。全程强调共创：多问用户、多给草案供挑选。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const d = getDraft(ctx, exec);
      const k = keyFor(ctx, exec);
      const st = draftStatusFor(k, d);
      const wf = await workflowFor(ctx, exec, d);
      const book = d.data.character_book || {};
      const entries = Array.isArray(book.entries) ? book.entries : [];
      const errors=[], warnings=[];
      // —— 结构（不齐 = 失败）——
      if(!String(d.data.name||"").trim()) errors.push("缺 data.name（角色名）");
      if(!String(d.data.description||"").trim()) errors.push("缺 data.description");
      if(!String(d.data.personality||"").trim()) errors.push("缺 data.personality");
      if(!Array.isArray(d.data.group_only_greetings) || d.data.group_only_greetings.length<1) errors.push("缺 group_only_greetings（至少 1 条必填）");
      if(wf.state.world !== "ok") errors.push("五维世界观未齐：需 timeline/factions/geo/power/daily 至少 3 项（当前 "+wf.worldFilled+"/5），请调 cc_patch_world");
      if(wf.state.lore !== "ok"){
        errors.push(wf.manualLoreTotal === 0
          ? "世界书只有自动条目（合计 "+wf.loreTotal+" 条"+(wf.sharedLoreCount ? "，其中共享书 "+wf.sharedLoreCount+" 条" : "")+"，全部由 autoLorebook 生成），未完成共创：请调 cc_add_lorebook_entries 至少补 1 条（合计≥5 条）"
          : "世界书未齐：卡内 "+wf.loreCount+" 条 + 共享书 "+wf.sharedLoreCount+" 条 = 合计 "+wf.loreTotal+" 条，需至少 5 条，请调 cc_add_lorebook_entries 补到 5 条");
      } else if(wf.loreCount < 5){
        // 达标靠的是组里那本共享书（第二轮报告 P0 的正解）：**不阻塞**，但必须把「导出时要带上它」说清楚 ——
        // 否则用户把这张「卡内只有 3 条」的卡发出去，对方客户端没有共享书就等于世界书缺失。
        warnings.push("本卡内只有 "+wf.loreCount+" 条世界书，达标靠的是本组共享世界书「"+(wf.sharedBook && String(wf.sharedBook.name||"").trim() ? wf.sharedBook.name : "未命名")+"」的 "+wf.sharedLoreCount+" 条（合计 "+wf.loreTotal+" 条）。**共享书不会跟着卡走**：导出时请把它一并交给客户端（工坊导出页有两枚按钮 —— 支持 `lorebook_v3` 的客户端拿「CCv3 独立世界书」，**SillyTavern 必须拿「SillyTavern 世界书」**，ST 的导入接口只认 `{entries:{…}}` 形态）；对方客户端不支持全局世界书时，在导出页勾选「并入本卡」。导卡时若该组有共享书，会**自动在导出副本上**写上 ST 的世界书绑定（`data.extensions.world = 书名`），PNG 里同时带 `ccv3` 与 `chara` 两个块。");
      }
      // —— 质量（P1-5：此前 valid=true 只代表「四件套非空」，给用户「卡没问题了」的错觉）——
      if(!String(d.data.scenario||"").trim()) warnings.push("scenario 为空，建议补充（缺失时模型只能靠 description 猜场景）");
      if(!Array.isArray(d.data.alternate_greetings) || d.data.alternate_greetings.length<2) warnings.push("alternate_greetings 建议至少 2 条（当前 "+((d.data.alternate_greetings||[]).length)+" 条）");
      if(!String(d.data.first_mes||"").trim()) warnings.push("first_mes 为空");
      if(!String(d.data.mes_example||"").trim()) warnings.push("mes_example 为空，建议写几段示例对话");
      if(!String(d.data.creator||"").trim()) warnings.push("data.creator 为空（导出后别人看不到作者）—— 用 cc_patch_character 的 creator 参数写入，或让用户在工坊「角色基础」里手动填。");
      if(!String(book.name||"").trim()) warnings.push("世界书没有名字（character_book.name 为空），导出后是一本无名的书；可用 cc_patch_book_meta 命名");
      if(!String(book.description||"").trim()) warnings.push("character_book.description 为空，建议一句话说明这本世界书的作用");
      // 存在性检查按**合计**口径（卡内 + 共享书）—— 见 workflowStatus 里 constantEntries 的注释
      if(wf.loreTotal > 0 && wf.constantEntries.total === 0) warnings.push("世界书（卡内 + 共享书）没有任何 constant 常驻条目（否则全靠触发词命中）");
      if(wf.loreTotal > 0 && !entries.some(e => String((e && e.content) || "").includes("@@")) && wf.sharedHasDecorator !== true) warnings.push("世界书条目建议带 @@decorator（@@position/@@depth/@@activate）");
      const deadKeys = entries.filter(e => !e.constant && (!Array.isArray(e.keys) || e.keys.length===0));
      if(deadKeys.length) warnings.push(deadKeys.length + " 条非 constant 条目没有 keys（永远触发不了）：" + deadKeys.map(e=>String(e.name||"未命名")).join("、"));
      const dimOnly = entries.filter(e => !e.constant && Array.isArray(e.keys) && e.keys.length>0 && e.keys.every(k => AUTO_NAMES.has(String(k)) || ["timeline","faction","geography","power","daily"].includes(String(k))));
      if(dimOnly.length) warnings.push(dimOnly.length + " 条条目的 keys 只有维度名（" + dimOnly.map(e=>String(e.name||"未命名")).join("、") + "），真实对话不会命中；可用 cc_simulate_trigger 拿一句用户会说的话验证，建议改成实体名");
      const keyless = entries.filter(e => { const keys=Array.isArray(e.keys)?e.keys:[]; return keys.length>0 && !e.constant && !keys.some(k => String(e.content||"").indexOf(String(k))>=0); });
      if(keyless.length) warnings.push(keyless.length + " 条条目的 keys 在自身 content 里找不到（可能是误填）：" + keyless.map(e=>String(e.name||"未命名")).join("、"));
      const used = wf.metrics.card.tokens;   // 0.10.0：数字来自卡组层（workflowStatus 里那一次统计）
      const budget = Number(book.token_budget||0) || 0;
      if(budget>0 && used > budget) warnings.push("世界书内容估算约 "+used+" token，已超出 token_budget="+budget+"，建议调大预算或精简条目（cc_patch_book_meta）");
      // —— 终态：校验通过后 next 不再指向 cc_validate（P0-3：那正是弱模型死循环的诱因）——
      const valid = errors.length===0;
      // 0.11.0：终态要主动提醒交还草稿锁 —— 不交还时工坊一直是只读的，用户只能预览、无法微调，
      // 而「校验通过」正是「创作告一段落」的唯一信号。保留「校验导出」「保存当前」两个既有指引入口
      //（工坊左下角入口名与 0.4.1 的 UI 一致；tools-contract ②i 依赖这两处字样）。
      const next = valid
        ? "校验通过 ✓ 工作流已完成（step 7/7）。**下一步必须调用 cc_release_draft 交还草稿编辑权**（否则工坊保持只读，用户只能在预览里看、无法微调）；交还后引导用户在工坊左下角「校验导出」入口打开导出页选 JSON / PNG / CHARX，或点「★ 保存当前」落盘到 ~/.dsh/cc-library。还想打磨就直接说改哪里（你继续写会自动重新上锁）。"
        : "校验未通过，按 errors 逐项补齐（严禁跳步），第一项：" + errors[0];
      // R1（0.6.0）：终态的 `hint` 必须与 `next` 同源 —— 否则会出现「next 说工作流已完成、hint 说下一步必须去校验」
      // 这种自相矛盾（弱模型会读信息最全的 hint，于是反复调 cc_validate）。半修的状态机比没修更危险。
      const wfDone = Object.assign({}, wf, {
        step: valid ? 7 : wf.step,
        done: valid,
        // 模型可见的显式收口信号：valid=true 时 releaseRequired=true，提示它这一步还没做完。
        releaseRequired: valid,
        readyToValidate: !valid && wf.readyToValidate,
        next,
        hint: progressHint(valid ? 7 : wf.step, wf.state, wf.worldFilled, wf.loreCount, wf.manualLoreCount, valid, wf.sharedLoreCount),
      });
      const warningsAll = [recoveredNotice(k, d)].filter(Boolean).concat(warnings);   // 新草稿提示同上，交给包装
      // 同上：共享书那一段（wf.metrics 是 lorebookMetrics 的旧命名形状：card / shared / total / all）
      const sharedUsed = wf.metrics.shared.tokens;
      return { ok:true, valid, done: valid, errors, warnings: warningsAll,
        loreCount: wf.loreCount, manualLoreCount: wf.manualLoreCount, name: d.data.name,
        // 世界书的两个口径都报出来（第二轮报告 P0）：卡内 / 共享 / 合计 —— `cc_lint_lorebook` 早就是这个口径了，
        // 「收尾判定」再只数卡内，等于让按最佳实践去重过的卡永远不合格。
        sharedLoreCount: wf.sharedLoreCount, loreTotal: wf.loreTotal,
        constantEntries: wf.constantEntries,
        lorebookTokens: used + sharedUsed,
        lorebookSplit: { card: used, shared: sharedUsed, total: used + sharedUsed },
        sharedBook: wf.sharedBook,
        tokenBudget: budget,
        draftStatus: st, workflow: wfDone,
        // R3（0.6.0）：message 不再拼接 next —— 那会让「校验通过 ✓」连说两遍（两个来源拼接未去重）。
        // 下一步只保留 workflow.next 一处。
        message: valid
          ? "校验通过 ✓ 工作流完成（世界书 " + wf.loreTotal + " 条"
            + (wf.sharedLoreCount ? " = 卡内 " + wf.loreCount + " + 共享书 " + wf.sharedLoreCount : "")
            + " / 估算 " + (used + sharedUsed) + " token）。下一步：调用 cc_release_draft 交还草稿锁，用户才能在工坊微调/导出。"
          : "校验未通过：" + errors.length + " 项待补。" };
    }
  });

  // 【交还草稿锁】0.11.0：权限完全由 LLM 掌握 —— 它说创作完了、或用户明确要求强制释放时才放开。
  // 为什么不做成自动释放：工具半无法判断「这一轮对话是否真的结束」，误放一次，
  // 用户接着载入别的卡就会把 LLM 还没保存的内容覆盖掉 —— 正是 0.11.0 要修的那个事故。
  tool({
    name: "cc_release_draft",
    description: "【收口·交还草稿】**cc_validate 通过（valid=true）= 创作完成，必须立刻调用本工具**，否则工坊一直只读、用户无法微调（这是工作流的最后一步）。释放当前会话的草稿创作锁，把工坊还给用户编辑。调用前先向用户说明当前卡名与进度（释放后用户就能在工坊里直接改这张卡）。用户明确要求强制释放时也调用；释放后若你再次写草稿，会自动重新锁定；当前没有锁时调用也安全（幂等成功，released:false）。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const k = keyFor(ctx, exec);
      const lock = readDraftLockSync(k);
      const st = draftStatusFor(k, getDraft(ctx, exec));
      const released = !!lock;
      clearDraftLockSync(k);
      // 卡名优先用锁里记下的那个：锁可能是草稿还叫旧名时建的，交还时要说清「交还的是哪张卡」。
      const cardName = (lock && String(lock.cardName || "").trim()) || String(st.cardName || "").trim();
      const rev = (typeof st.rev === "number" && st.rev > 0) ? st.rev : ((lock && lock.rev) || null);
      return {
        ok: true,
        released,
        sessionKey: k,
        cardName: cardName || null,
        rev,
        message: released
          ? "已释放草稿锁「" + (cardName || "未命名") + "」：工坊恢复可编辑，用户现在可以载入/导入别的卡，不会覆盖你的草稿。若你继续写草稿，会自动重新锁定。"
          : "当前没有草稿锁（可能已释放过，或已超时自动失效），无需重复释放。如果你继续写草稿，会自动重新锁定。",
      };
    }
  });
}

// ——————————————————————————————————————————————————————————————
// 组级共享世界书（0.9.0）—— 与 lib/index.js **同构实现**（同样的常量、纯函数、落盘规则）。
// 理由见宿主半那段注释：群聊卡的世界设定在每张成员卡里逐字重复（实测 4 卡 20 条里 5 条相同），
// CCv3 规范允许 Lorebook 单独导出（`{ spec:"lorebook_v3", data }`）且 character_book 本就该
// 与全局 lorebook 叠加 —— 所以把共享设定提到组级独立文件，成员卡里只留角色私有条目。
// ——————————————————————————————————————————————————————————————
const BOOK_SPEC = "lorebook_v3";
const BOOK_MAX_ENTRIES = 200;

function bookDirs(){ return dataRoots("cc-books"); }
function bookDir(){ return bookDirs()[0]; }
function bookPath(groupId){ return join(bookDir(), safeGroupId(groupId) + ".json"); }
async function ensureBookDir(){ try{ await mkdir(bookDir(), { recursive: true }); }catch{} }

/** 条目归一化：**只补缺、不裁剪**（CCv3 要求把不认识的字段也原样保存）。 */
function makeBookEntry(e){
  const src = (e && typeof e === "object") ? e : {};
  const out = Object.assign({}, src);
  out.keys = Array.isArray(src.keys) ? src.keys.map(String) : [];
  out.content = String(src.content == null ? "" : src.content);
  out.enabled = src.enabled !== false;
  out.insertion_order = Number.isFinite(Number(src.insertion_order)) ? Number(src.insertion_order) : 0;
  out.constant = src.constant === true;
  out.use_regex = src.use_regex === true;
  if(typeof out.name !== "string") out.name = out.name == null ? "" : String(out.name);
  if(!out.extensions || typeof out.extensions !== "object" || Array.isArray(out.extensions)) out.extensions = {};
  return out;
}
function bookCcOf(obj){
  const data = (obj && obj.data && typeof obj.data === "object") ? obj.data : {};
  const ext = (data.extensions && typeof data.extensions === "object") ? data.extensions : {};
  return (ext.cc && typeof ext.cc === "object") ? ext.cc : {};
}
function bookRevOf(obj){ const n = Number(bookCcOf(obj).rev); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
function normalizeBook(obj, groupId){
  const src = (obj && typeof obj === "object") ? obj : {};
  const raw = (src.data && typeof src.data === "object") ? src.data : (Array.isArray(src.entries) ? src : {});
  const cc = bookCcOf(src);
  const data = Object.assign({}, raw, {
    name: String(raw.name || "").slice(0, 80),
    description: String(raw.description || "").slice(0, 300),
    scan_depth: Math.max(1, Math.round(Number(raw.scan_depth) || 4)),
    token_budget: Math.max(100, Math.round(Number(raw.token_budget) || 2000)),
    recursive_scanning: raw.recursive_scanning === true,
    entries: (Array.isArray(raw.entries) ? raw.entries : []).slice(0, BOOK_MAX_ENTRIES).map(makeBookEntry),
  });
  const ext = Object.assign({}, (raw.extensions && typeof raw.extensions === "object") ? raw.extensions : {});
  ext.cc = Object.assign({}, (ext.cc && typeof ext.cc === "object") ? ext.cc : {}, {
    groupId: safeGroupId(groupId || cc.groupId),
    rev: Math.max(0, Math.round(Number(cc.rev) || 0)),
    updatedAt: Number(cc.updatedAt) || nowSec(),
  });
  data.extensions = ext;
  return Object.assign({}, src, { spec: BOOK_SPEC, data });
}
async function readBookRaw(groupId){
  const file = safeGroupId(groupId) + ".json";
  for(const dir of bookDirs()){
    try{
      const raw = await readFile(join(dir, file), "utf8");
      const obj = JSON.parse(raw);
      if(obj && typeof obj === "object") return { raw, obj };
    }catch{}
  }
  return null;
}
async function writeBook(groupId, book){
  await ensureBookDir();
  const gid = safeGroupId(groupId);
  const prev = await readBookRaw(gid);
  const cur = normalizeBook(book, gid);
  cur.data.extensions.cc.rev = (prev ? bookRevOf(prev.obj) : 0) + 1;
  cur.data.extensions.cc.updatedAt = nowSec();
  await writeFile(bookPath(gid), JSON.stringify(cur, null, 2), "utf8");
  return cur;
}
async function deleteBook(groupId){
  const gid = safeGroupId(groupId);
  if(!gid) return false;
  let removed = 0;
  for(const dir of bookDirs()){
    try{ await unlink(join(dir, gid + ".json")); removed += 1; }
    catch(e){ if(e && e.code !== "ENOENT") throw e; }
  }
  return removed > 0;
}
/** 内容签名：见 lib/group-layer.js 的 `contentKeyOf()`（只用来筛，动手前一律再逐字比对内容）。 */
async function bookCardsFor(ids){
  const rows = await readLibrarySnapshot();
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const out = [];
  for(const id of (Array.isArray(ids) ? ids : [])){
    const row = byId.get(String(id));
    if(!row) continue;   // 卡不在库里：原实现是 readLibraryRaw 抛错→跳过，语义一致
    const d = (row.draft && row.draft.data) ? row.draft.data : {};
    const entries = Array.isArray(d.character_book && d.character_book.entries) ? d.character_book.entries : [];
    out.push({ id: String(id), name: String(d.name || (row.meta && row.meta.name) || ""), entries: entries.map(makeBookEntry) });
  }
  return out;
}
/**
 * 新建共享书的默认名：`<组名>·共享设定`（拿不到组名才退回「共享设定」）。
 * 第二轮报告 4.2：同一个人的多个组各建一本、全叫「共享设定」，导出成文件后根本分不清是哪一组。
 * 两半同构（`tests/shared-book.test.mjs` 直接比对），改这里记得同步 `lib/index.js`。
 */
function defaultBookName(groupName){
  const n = String(groupName == null ? "" : groupName).trim();
  return n ? n + "·共享设定" : "共享设定";
}
/** 新建一本空共享书（名字优先用调用方给的，否则 `<组名>·共享设定`）。两半同构。 */
async function newBookFor(gid, explicitName){
  const want = String(explicitName == null ? "" : explicitName).trim();
  if(want) return normalizeBook({ data: { name: want } }, gid);
  let gname = "";
  try{ const gf = await readGroupRaw(gid); if(gf) gname = normalizeGroup(gf.obj).name; }catch{}
  return normalizeBook({ data: { name: defaultBookName(gname) } }, gid);
}
/** 跨卡重复 / 卡内-书重复扫描：见 lib/group-layer.js 的 `scanSharedEntries()`（0.10.0 起两半共用一份）。 */
function mergeBookEntries(bookEntries, cardEntries){
  const have = new Set((Array.isArray(cardEntries) ? cardEntries : []).map(contentKeyOf));
  const added = [];
  (Array.isArray(bookEntries) ? bookEntries : []).forEach(e => {
    const sig = contentKeyOf(e);
    if(have.has(sig)) return;
    have.add(sig);
    added.push(makeBookEntry(e));
  });
  return { entries: (Array.isArray(cardEntries) ? cardEntries : []).map(makeBookEntry).concat(added), added };
}
function applyBookPromotion(cards, bookEntries, signatures){
  const want = new Set((Array.isArray(signatures) ? signatures : []).map(String));
  const book = (Array.isArray(bookEntries) ? bookEntries : []).map(makeBookEntry);
  const have = new Set(book.map(contentKeyOf));
  const promoted = [];
  const nextCards = (Array.isArray(cards) ? cards : []).map(c => {
    const kept = [];
    let removed = 0, removedChars = 0;
    (Array.isArray(c.entries) ? c.entries : []).forEach(e => {
      const sig = contentKeyOf(e);
      if(want.has(sig)){
        if(!have.has(sig)){ have.add(sig); book.push(makeBookEntry(e)); promoted.push(sig); }
        removed += 1;
        removedChars += String(e.content == null ? "" : e.content).length;
        return;
      }
      kept.push(makeBookEntry(e));
    });
    return { id: c.id, name: c.name, entries: kept, removed, removedChars };
  });
  return { bookEntries: book, cards: nextCards, promoted,
    removedTotal: nextCards.reduce((n, c) => n + c.removed, 0),
    savedChars: nextCards.reduce((n, c) => n + c.removedChars, 0) };
}

// —— 0.9.0：三个编排动作（与宿主半 cc_patchBook / cc_promoteBook / cc_applyBook 端点行为等价）——

/** 条目摘要（返回体卫生：默认只回 name/keys/长度/前 80 字，`includeContent` 才给全文）。 */
function bookEntryBrief(e, includeContent){
  const brief = { contentKey: contentKeyOf(e), name: String(e.name || ""), keys: (e.keys || []).map(String),
    constant: e.constant === true, enabled: e.enabled !== false, chars: String(e.content || "").length };
  if(includeContent) brief.content = String(e.content || "");
  else brief.preview = String(e.content || "").slice(0, 80).replace(/\s+/g, " ");
  return brief;
}
function bookBrief(book, includeContent){
  const d = book.data;
  return { spec: BOOK_SPEC, rev: bookRevOf(book), name: d.name, description: d.description,
    scan_depth: d.scan_depth, token_budget: d.token_budget, recursive_scanning: d.recursive_scanning,
    entries: d.entries.map(e => bookEntryBrief(e, includeContent)) };
}
/** 改共享世界书（书级 meta + 条目 ops）。返回 { ok, ... }。 */
async function patchSharedBook(groupId, args){
  const gid = safeGroupId(groupId);
  if(!gid) return { ok: false, error: "需要 groupId" };
  const found = await readBookRaw(gid);
  const cur = found ? normalizeBook(found.obj, gid) : await newBookFor(gid, args.name);
  if(typeof args.expectedBookRev === "number" && args.expectedBookRev !== bookRevOf(cur)){
    return { ok: false, staleBookRev: true, expectedBookRev: args.expectedBookRev, actualBookRev: bookRevOf(cur),
      error: "共享世界书已被外部修改（期望 rev=" + args.expectedBookRev + "，实际 rev=" + bookRevOf(cur) + "）—— 先 cc_get_shared_book 重新读一遍再改。" };
  }
  const applied = [], rejected = [];
  if(args.name !== undefined) cur.data.name = textArg(args.name).slice(0, 80);
  if(args.description !== undefined) cur.data.description = textArg(args.description).slice(0, 300);
  if(args.scan_depth !== undefined) cur.data.scan_depth = Math.max(1, Math.round(Number(args.scan_depth) || 4));
  if(args.token_budget !== undefined) cur.data.token_budget = Math.max(100, Math.round(Number(args.token_budget) || 2000));
  if(args.recursive_scanning !== undefined) cur.data.recursive_scanning = args.recursive_scanning === true;
  ["name", "description", "scan_depth", "token_budget", "recursive_scanning"].forEach(k => { if(args[k] !== undefined) applied.push({ op: "setMeta", field: k }); });
  (Array.isArray(args.ops) ? args.ops : []).forEach(op => {
    const kind = String((op && op.op) || "");
    if(kind === "addEntry"){
      // 0.10.3：模型可能把换行写成字面 \n —— 共享书条目也是卡内文本，先解码再归一化。
      const rawEntry = Object.assign({}, op.entry);
      if(rawEntry.content !== undefined) rawEntry.content = textArg(rawEntry.content);
      if(rawEntry.name !== undefined) rawEntry.name = textArg(rawEntry.name);
      if(Array.isArray(rawEntry.keys)) rawEntry.keys = rawEntry.keys.map(textArg);
      const e = makeBookEntry(rawEntry);
      if(!e.content.trim()){ rejected.push({ op, error: "content 不能为空" }); return; }
      if(cur.data.entries.some(x => contentKeyOf(x) === contentKeyOf(e))){ rejected.push({ op, error: "同内容的条目已存在" }); return; }
      if(cur.data.entries.length >= BOOK_MAX_ENTRIES){ rejected.push({ op, error: "条目数已达上限 " + BOOK_MAX_ENTRIES }); return; }
      cur.data.entries.push(e);
      applied.push({ op: kind, key: contentKeyOf(e), name: e.name });
    } else if(kind === "updateEntry"){
      const idx = cur.data.entries.findIndex(x => contentKeyOf(x) === String(op.contentKey || ""));
      if(idx < 0){ rejected.push({ op, error: "找不到条目（contentKey 不匹配）" }); return; }
      const rawPatch = Object.assign({}, (op.patch && typeof op.patch === "object") ? op.patch : {});
      if(rawPatch.content !== undefined) rawPatch.content = textArg(rawPatch.content);
      if(rawPatch.name !== undefined) rawPatch.name = textArg(rawPatch.name);
      if(Array.isArray(rawPatch.keys)) rawPatch.keys = rawPatch.keys.map(textArg);
      cur.data.entries[idx] = makeBookEntry(Object.assign({}, cur.data.entries[idx], rawPatch));
      applied.push({ op: kind, key: contentKeyOf(cur.data.entries[idx]) });
    } else if(kind === "removeEntry"){
      // 支持两种定位：`index`（工坊列表直接用它）或 `contentKey`（模型读到的签名）
      const byIndex = Number.isInteger(op.index) ? op.index : -1;
      if(byIndex >= 0 && byIndex < cur.data.entries.length){
        const gone = cur.data.entries.splice(byIndex, 1)[0];
        applied.push({ op: kind, index: byIndex, key: contentKeyOf(gone) });
        return;
      }
      const before = cur.data.entries.length;
      cur.data.entries = cur.data.entries.filter(x => contentKeyOf(x) !== String(op.contentKey || ""));
      if(cur.data.entries.length === before){ rejected.push({ op, error: "找不到条目（index / contentKey 都不匹配）" }); return; }
      applied.push({ op: kind, key: String(op.contentKey) });
    } else rejected.push({ op, error: "未知 op：" + kind });
  });
  if(!applied.length) return { ok: true, book: cur, rev: bookRevOf(cur), applied, rejected, changed: false };
  const saved = await writeBook(gid, cur);
  return { ok: true, book: saved, rev: bookRevOf(saved), applied, rejected, changed: true };
}
/** 提升去重：把成员卡里重复的条目搬进共享书，并从各卡删掉（默认 dryRun，`apply:true` 才动手）。 */
async function promoteSharedBook(groupId, args){
  const gid = safeGroupId(groupId);
  if(!gid) return { ok: false, error: "需要 groupId" };
  const found = await readBookRaw(gid);
  let cur;
  if(found){ cur = normalizeBook(found.obj, gid); }
  else cur = await newBookFor(gid);   // 默认名 `<组名>·共享设定`（第二轮报告 4.2）
  const cards = await bookCardsFor(await groupMemberIds(gid));
  // 候选有两类：① 卡与卡之间重复（提升进书）；② 卡内条目与**共享书**逐字重复（书里已经有，只需清理卡内副本）。
  // ② 是 `cc_apply_shared_book` 回填卡之后的必然产物：卡里那份与共享书会**双重插入**，而此前两个工具都看不见它
  // （卡片之间没重复、书里也没重复）—— 第二轮报告 P1。
  const scan = scanSharedEntries(cards, cur.data.entries);
  const known = new Map(scan.candidates.concat(scan.bookDupes).map(c => [c.signature, c]));
  const requested = (Array.isArray(args.keys) && args.keys.length) ? args.keys.map(String)
    : scan.candidates.map(c => c.signature).concat(scan.bookDupes.map(c => c.signature));
  const unknownKeys = requested.filter(s => !known.has(s));
  const use = requested.filter(s => known.has(s));
  const bookSigs = new Set(cur.data.entries.map(contentKeyOf));
  const promoteSigs = use.filter(s => !bookSigs.has(s));   // 真·提升（书里还没有）
  const cleanSigs = use.filter(s => bookSigs.has(s));      // 书里已有 → 只删卡里那份，不再往书里加
  const plan = applyBookPromotion(cards, cur.data.entries, use);
  const summary = (g) => ({ kind: g.kind || "card-vs-card", signature: g.signature, name: g.name, cards: g.cards.length, cardNames: g.cardNames,
    chars: g.chars, savedChars: g.savedChars, nameMismatch: g.nameMismatch === true, keysMismatch: g.keysMismatch === true, preview: g.preview });
  if(args.apply !== true){
    return { ok: true, dryRun: true, changed: false, wouldPromote: promoteSigs.length, wouldClean: cleanSigs.length, unknownKeys, removedTotal: plan.removedTotal, savedChars: plan.savedChars,
      perCard: plan.cards.map(c => ({ id: c.id, name: c.name, removed: c.removed, left: c.entries.length })),
      candidates: scan.candidates.map(summary), bookDuplicates: scan.bookDupes.map(summary), stats: scan.stats, rev: bookRevOf(cur) };
  }
  // 这次删掉的条目里，有多少是「提升」（卡内副本搬进书）之外的**纯清理**（书里早就有）—— 报告 P1 要的可对账字段。
  const promotedCopies = cards.reduce((n, c) => n + (Array.isArray(c.entries) ? c.entries.filter(e => promoteSigs.indexOf(contentKeyOf(e)) >= 0).length : 0), 0);
  const cleaned = Math.max(0, plan.removedTotal - promotedCopies);
  // 记下「这次提升省了多少」——报告 4.3：去重完再查时 savedChars 已经是 0，收益就查不到了；
  // 存进 extensions.cc.lastPromote，让 cc_get_shared_book 能一直回显。
  const ccExt = Object.assign({}, (cur.data.extensions && cur.data.extensions.cc) || {}, {
    lastPromote: { savedChars: plan.savedChars, removed: plan.removedTotal, promoted: plan.promoted.length, cleaned, at: nowSec() },
  });
  const saved = await writeBook(gid, Object.assign({}, cur, {
    data: Object.assign({}, cur.data, {
      entries: plan.bookEntries,
      extensions: Object.assign({}, cur.data.extensions, { cc: ccExt }),
    }),
  }));
  const touched = [];
  for(const c of plan.cards){
    if(!c.removed) continue;
    try{
      const rawOne = await readLibraryRaw(c.id);
      const obj = JSON.parse(rawOne.raw);
      obj.draft.data.character_book = Object.assign({}, obj.draft.data.character_book, { entries: c.entries });
      if(obj.meta){ obj.meta.loreCount = c.entries.length; obj.meta.updatedAt = nowSec(); }   // 只动这两个字段，其余 meta 原样保留（B4 的教训）
      await writeFile(rawOne.path, JSON.stringify(obj, null, 2), "utf8");
      touched.push({ id: c.id, name: c.name, removed: c.removed, left: c.entries.length });
    }catch(e){ touched.push({ id: c.id, name: c.name, error: String(e && e.message || e) }); }
  }
  return { ok: true, dryRun: false, changed: true, promoted: plan.promoted.length, cleaned, removedTotal: plan.removedTotal, savedChars: plan.savedChars, unknownKeys,
    bookRev: bookRevOf(saved), bookEntries: saved.data.entries.length, perCard: touched,
    candidates: scan.candidates.map(summary), bookDuplicates: scan.bookDupes.map(summary), stats: scan.stats };
}
// —— 提升之后的「草稿同步」（用户报告的第 1 条）——
// 为什么必须有这一步：`cc_promote_shared_entries` 改的是**库里的卡**，而模型正在编辑的是**草稿**
// ——两个副本。库里那张卡的重复条目被删掉了，草稿里却还原样留着，模型接着调 cc_save_to_library
// 就会把重复**原样写回卡里**：刚做完的去重等于白做，而且全程零提示（测试里能直接看到
// 「simulate 同时命中 年表@card 与 年表@shared」就是这个状态）。
//
// 判据与库里那一次**完全相同**：内容已经进了共享书、且**逐字相符**。内容签名只用来筛候选，
// 绝不按哈希删数据（哈希碰撞不能变成删用户内容）——内容被改过的那几条一律不动，只报告。
/** 草稿里「与共享书逐字重复」的条目（`dupes`）与其余条目（`kept`）。纯函数，便于直接测。 */
function draftBookDupes(draftEntries, bookEntries){
  const book = new Map();
  (Array.isArray(bookEntries) ? bookEntries : []).forEach(e => {
    const content = String((e && e.content) == null ? "" : e.content);
    if(!content.trim()) return;
    const sig = contentKeyOf(e);
    if(!book.has(sig)) book.set(sig, content);
  });
  const dupes = [], kept = [];
  (Array.isArray(draftEntries) ? draftEntries : []).forEach(e => {
    const content = String((e && e.content) == null ? "" : e.content);
    if(content.trim() && book.get(contentKeyOf(e)) === content) dupes.push(e);
    else kept.push(e);
  });
  return { dupes, kept };
}
/**
 * 提升执行后同步草稿：若**当前草稿的来源卡正是这次被删过条目的卡之一**，就把草稿里那几条一起删掉。
 *
 * 两条出口：
 *  - `synced:true`  → 已同步（`removed` 条），模型可以放心 `cc_save_to_library`；
 *  - `remaining>0`  → 草稿里仍有 N 条与共享书重复（来源卡不适用，或内容被改过逐字比对不中）
 *    —— **不动手**，只把条数报回去，由调用方给出「保存前先 cc_load_from_library 重新载入」的警告。
 *
 * 并发安全：`getDraft()` 会以盘上 rev 为准自动重载，而「读草稿 → 过滤 → `setDraft`」之间
 * **没有任何 await**，所以别人的写入不会被半路覆盖（要么它在我读之前完成、要么在我写之后）。
 */
async function syncDraftAfterPromote(ctx, exec, groupId, promotedCardIds){
  const ids = (Array.isArray(promotedCardIds) ? promotedCardIds : []).map(String).filter(Boolean);
  const gid = safeGroupId(groupId) || String(groupId || "");
  const k = keyFor(ctx, exec);
  const origin = readOriginSync(k);
  const myCardId = (origin && origin.libraryId) ? String(origin.libraryId) : "";
  const applicable = !!myCardId && ids.indexOf(myCardId) >= 0;
  const found = gid ? await readBookRaw(gid) : null;
  if(!found) return { applicable, synced:false, removed:0, remaining:0, names:[], cardId: myCardId || null };
  const book = normalizeBook(found.obj, gid);
  let draft;
  try{ draft = getDraft(ctx, exec); }
  catch(e){ return { applicable, synced:false, removed:0, remaining:0, names:[], cardId: myCardId || null, error: String((e && e.message) || e) }; }
  const cb = (draft && draft.data && draft.data.character_book) || {};
  const entries = Array.isArray(cb.entries) ? cb.entries : [];
  const overlap = draftBookDupes(entries, book.data.entries);
  const names = overlap.dupes.map(e => String((e && e.name) || "").trim() || "（未命名）");
  if(!overlap.dupes.length) return { applicable, synced:false, removed:0, remaining:0, names:[], cardId: myCardId || null };
  if(!applicable) return { applicable:false, synced:false, removed:0, remaining: overlap.dupes.length, names, cardId: myCardId || null };
  try{
    const data = draft.data;
    const next = Object.assign({}, draft, { data: Object.assign({}, data, {
      character_book: Object.assign({}, cb, { entries: overlap.kept }),
    }) });
    setDraft(ctx, next, exec);   // 走同一套落盘 + rev 递增（N4：内容没变则一次都不写）
    return { applicable:true, synced:true, removed: overlap.dupes.length, remaining:0, names:[], cardId: myCardId };
  }catch(e){
    return { applicable:true, synced:false, removed:0, remaining: overlap.dupes.length, names, cardId: myCardId, error: String((e && e.message) || e) };
  }
}

/** 回填：把共享书条目合并进某张卡（同内容已存在则跳过）—— 给不支持全局世界书的客户端兜底。 */
async function applySharedBook(groupId, cardId, dryRun){
  const gid = safeGroupId(groupId);
  if(!gid) return { ok: false, error: "需要 groupId" };
  const found = await readBookRaw(gid);
  if(!found) return { ok: false, notFound: true, error: "这个分组还没有共享世界书" };
  const cur = normalizeBook(found.obj, gid);
  if(!cardId) return { ok: false, needCard: true, error: "没有指定 cardId，当前草稿也没有来源卡（先保存到侧边栏）" };
  const rawOne = await readLibraryRaw(cardId);
  const obj = JSON.parse(rawOne.raw);
  const cardEntries = (obj.draft && obj.draft.data && obj.draft.data.character_book && Array.isArray(obj.draft.data.character_book.entries))
    ? obj.draft.data.character_book.entries : [];
  const merged = mergeBookEntries(cur.data.entries, cardEntries);
  if(dryRun) return { ok: true, dryRun: true, cardId, wouldAdd: merged.added.length, bookEntries: cur.data.entries.length, cardEntries: cardEntries.length };
  if(!merged.added.length) return { ok: true, cardId, added: 0, changed: false, loreCount: cardEntries.length };
  obj.draft.data.character_book = Object.assign({}, obj.draft.data.character_book, { entries: merged.entries });
  if(obj.meta){ obj.meta.loreCount = merged.entries.length; obj.meta.updatedAt = nowSec(); }
  await writeFile(rawOne.path, JSON.stringify(obj, null, 2), "utf8");
  return { ok: true, cardId, added: merged.added.length, changed: true, loreCount: merged.entries.length };
}

/**
 * 度量类工具的统一口径（0.10.0 起是 `groupScope()` 的薄包装，返回形状与 0.9.x 逐字一致）。
 *
 * 为什么当初单列一个函数：LLM 侧实测报告指出 —— 共享书改变了**数据的位置**，却没有改变工具的
 * **度量口径**；四个「读」类工具（simulate / lint / group_check / preview_export）全都默认
 * 「卡内 character_book 就是全部」，于是 simulate 把「会命中」判成「不会命中」（实测低估约 3 倍），
 * lint 的 worstCase 漏掉共享书里的 constant 条目，group_check 的群聊固定开销也只算了一半。
 * 现在「取作用域」只有 groupScope 一处、数字只有 groupMetrics 一处，这里只负责把书的字段摊平
 * 成调用方熟悉的 `{ bookName, entries, tokens, constantTokens }`。
 *
 * 没有来源卡 / 没有分组 / 该组还没有书 → 一律返回空（调用方无需自己判空）。
 */
async function sharedBookScopeFor(ctx, exec){
  const scope = await groupScope({ sessionKey: keyFor(ctx, exec) });
  const cardId = scope.cardId || "";
  const groupId = scope.groupId || "";
  if(!scope.book) return { cardId: cardId, groupId: groupId, bookName: "", rev: 0, entries: [], tokens: 0, constantTokens: 0 };
  const entries = scope.book.entries;
  return {
    cardId: cardId, groupId: groupId, bookName: scope.book.name, rev: scope.book.rev, entries: entries,
    tokens: lorebookTokens(entries),
    constantTokens: entries.filter(e => e.constant).reduce((n, e) => n + estimateTokens(e && e.content), 0),
    lastPromote: scope.book.lastPromote || null,
  };
}
/**
 * 本卡所属分组的共享世界书**是否已经覆盖了这五个维度** —— 决定「没显式传 autoLorebook 时」还要不要在
 * 卡内生成一份骨架副本。
 *
 * 为什么需要它（0.10.0 LLM 侧回归报告第三节，实测踩到）：`autoLorebook` 的默认值是**单卡时代**的 ——
 * 那时「生成骨架条目」是净收益。共享书上线后它变成净损失：用户只想改五维里的一个字，结果整套骨架被
 * 抄回卡里，正好抵消共享书的去重价值，还会立刻踩两条检查（卡内与书逐字重复 + 跨卡触发词冲突），
 * 而且新副本的 keys 只有维度名 —— 等于把当初修好的「实体词 keys」又退回成死条目。
 *
 * 判据**取窄**（宁可漏判、不可误判）：只看书里明确是维度条目的那些 —— 名字就是维度名，或 keys 命中
 * 维度名/英文维度名。真要卡内副本，显式传 `autoLorebook:true` 即可。
 */
async function sharedBookCoversDims(ctx, exec){
  const out = { covered: false, count: 0, bookName: "", names: [] };
  let scope = null;
  try{ scope = await sharedBookScopeFor(ctx, exec); }catch(e){ return out; }
  const entries = (scope && Array.isArray(scope.entries)) ? scope.entries : [];
  if(!entries.length) return out;
  const enKeys = WORLD_DIMS.map(d => DIM_EN[d]);
  const hits = entries.filter(e => {
    if(!e || e.enabled === false) return false;
    if(AUTO_NAMES.has(String(e.name || "").trim())) return true;
    const keys = (Array.isArray(e.keys) ? e.keys : []).map(k => String(k).trim().toLowerCase());
    return keys.some(k => WORLD_DIMS.indexOf(k) >= 0 || enKeys.indexOf(k) >= 0);
  });
  if(!hits.length) return out;
  return { covered: true, count: hits.length, bookName: String(scope.bookName || ""),
    names: hits.map(e => String(e.name || "")).filter(Boolean).slice(0, 6) };
}

export { apply, inject, name, safeDraftFile, draftDirs, libDirs, dataRoots, originPath, readOriginSync, writeOriginSync,
  // 草稿锁（0.11.0）：与宿主半同构的落盘与摘要 —— 测试直接比对两半路径与行为
  draftLockPath, readDraftLockSync, writeDraftLockSync, clearDraftLockSync, draftLockSummaryFor,
  // 卡组层（0.10.0）：卡库快照 + 卡组作用域 —— 卡组数据的唯一入口，两半共用 lib/group-layer.js 的纯组装
  readLibrarySnapshot, groupScope,
  // 人物关系图谱（0.8.0）：导出纯函数与落盘根，供 tests/relations.test.mjs 与宿主半逐字比对同构实现
  groupDirs, groupDir, groupPath, safeGroupId, normalizeGroup, validateGroupOp, applyGroupOps,
  renderRelationsSection, spliceRelations, checkGroup, listGroups, readGroupRaw, writeGroup, groupMemberIds, libraryCardsFor,
  // 0.8.0 分组管理：出边口径（渲染与计数共用）、建组查重、meta 就地写 —— 都与宿主半同构，测试直接比对
  outgoingEdgesOf, findGroupByName, patchLibraryMeta, listLibraryEntries, saveLibraryEntry,
  groupSummaries, assignCardToGroup, deleteGroupWithMembers,
  // 0.9.0 组级共享世界书：落盘 + 纯函数 + 三个编排动作（与宿主半同构，测试交叉比对行为）
  BOOK_SPEC, bookDirs, bookDir, bookPath, makeBookEntry, normalizeBook, bookRevOf, readBookRaw, writeBook, deleteBook,
  contentKeyOf, bookCardsFor, scanSharedEntries, mergeBookEntries, applyBookPromotion,
  bookEntryBrief, bookBrief, patchSharedBook, promoteSharedBook, applySharedBook,
  // 提升后的草稿同步（用户报告的第 1、2 条）：纯函数 + 同步动作，测试直接比对行为
  draftBookDupes, syncDraftAfterPromote,
  REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END };
