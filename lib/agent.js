/**
 * @xia-sc/dsh-cc-studio/agent — CC 模式的 Agent Tools（仅在 CC preset 挂载，合并自 dsh-cc-agent）。
 * 通过 globalThis.__CC_DRAFTS__ 与 host 共享草稿，让 LLM 的工具调用能实时反映到浏览器胶囊。
 * 强制工作流：cc_get_card → cc_patch_character → cc_patch_world(≥3维,autoLorebook) → cc_add_lorebook_entries(≥5条) → cc_patch_greetings → cc_validate
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const name = "dsh-cc-studio-agent";
// 版本标识（0.7.1）：每次工具返回都带 `build`。
// 由来：第五轮实测里测试者第一遍跑出「四项全无变化」，其实只是**没重启 dsh** —— LLM 侧完全无法
// 分辨「代码没改」和「改了但没加载」。有了这个字段，任何一次调用都能先确认自己测的是哪一版。
// 发版时与 package.json 的 version 同步。
const BUILD = "0.7.1";
const inject = ["tools", "agents"];

function nowSec(){ return Math.floor(Date.now()/1000); }
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
      character_book:{ name:"", description:"", scan_depth:4, token_budget:1200, recursive_scanning:false, extensions:{}, entries:[] }
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
  const prev = m.get(k);
  // N4（0.7.0）：**内容一字未变时不落盘、不递增 rev**。空改动（传了不生效的参数、同值覆盖、
  // 删 0 条条目…）原来也会把 rev 推进一格，于是持有旧 rev 的调用方会无辜失败一次
  // （第四轮实测：`changed: []` 让 rev 7 → 8）。modification_date 也要跟着不动，否则指纹永远不等。
  if(prev && cardFingerprint(prev) === cardFingerprint(draft)) return draft;
  draft.data.modification_date = nowSec();
  m.set(k, draft);
  // pendingFresh 刻意不在这里清：新草稿提示由 tool() 包装在**调用之后**统一发，这里清掉就发不出来了。
  const meta = draftMeta(k); meta.isNew = false; meta.recovered = false;
  const rev = persistDraftSync(k, draft);
  if(typeof rev === "number") meta.rev = rev;   // 自己写的这一次不算「外部修改」
  return draft;
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
    createdAt: existingMeta && existingMeta.createdAt ? existingMeta.createdAt : now,
    updatedAt: now,
  };
}
async function listLibraryEntries(){
  await ensureLibDir();
  const seen=new Map();   // id → meta：先到先得，主根排在前 → 同名卡片主根优先
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
        if(obj && obj.meta && obj.id) seen.set(id,obj.meta);
        else if(obj && obj.draft) seen.set(id,makeLibraryEntryMeta(obj.draft,null,id));
      }catch{}
    }
  }
  const entries=[...seen.values()];
  entries.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  return entries;
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

function out(schema){ return { schema, render: (args, result) => [{ type:"text", text: JSON.stringify(result, null, 2) }] }; }

// —— 强制工作流状态计算（0.5.0 重写）——
// 两处结构性修正，都来自 LLM 侧实测反馈：
//   ① **每一项都是三态**（missing / partial / ok），不再有 `characterOk` 与 `characterPartial` 同时为 true
//      的自相矛盾组合（模型无法据此决策，只能忽略）；
//   ② **lore 的「完成」要求至少 1 条非自动条目**：否则 autoLorebook 一次生成 5 条就顶替了第 4 步的共创，
//      而 `cc_add_lorebook_entries` 的契约写着「必调」—— 两条相反指令同时下发正是实测到的卡壳点。
const WORLD_DIMS = ["timeline","factions","geo","power","daily"];
const DIM_NAMES = { timeline:"年表", factions:"势力", geo:"地理", power:"力量体系", daily:"日常" };
// 英文 key 与 0.4.x 生成过的完全一致（老卡里就是这个写法），避免升级后触发词看起来「悄悄变了」
const DIM_EN = { timeline:"timeline", factions:"faction", geo:"geography", power:"power", daily:"daily" };
// 旧数据没有 cc_auto 标记，靠「名字是维度名」兜底；但**必须同时看内容**，
// 否则用户手工建的、恰好叫「日常」的条目会被下一次 cc_patch_world 静默删掉（0.5.0 修）。
const AUTO_NAMES = new Set(["年表","势力","地理","力量体系","日常"]);
function isAutoEntry(e){
  return !!(e && (e.cc_auto === true || (e.extensions && e.extensions.cc_auto)));
}
function looksLikeLegacyAuto(e){
  if(!e || !AUTO_NAMES.has(String(e.name||""))) return false;
  return /^\s*@@/.test(String(e.content||"")) || Array.isArray(e.keys) && e.keys.some(k => ["timeline","faction","geography","power","daily"].includes(String(k)));
}
function workflowStatus(draft){
  const d = draft && draft.data ? draft.data : {};
  const w = (d.extensions && d.extensions.cc_world) ? d.extensions.cc_world : {};
  const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
  const loreCount = entries.length;
  const manualLoreCount = entries.filter(e => !isAutoEntry(e)).length;
  const worldFilled = WORLD_DIMS.filter(k => typeof w[k]==="string" && String(w[k]).trim().length>=6).length;

  const nameOk = !!String(d.name||"").trim();
  const descOk = !!String(d.description||"").trim();
  const characterState = (nameOk && descOk && String(d.personality||"").trim() && String(d.scenario||"").trim())
    ? "ok" : ((nameOk && descOk) ? "partial" : "missing");
  const worldState = worldFilled >= 3 ? "ok" : (worldFilled > 0 ? "partial" : "missing");
  const loreState = (loreCount >= 5 && manualLoreCount >= 1) ? "ok" : (loreCount > 0 ? "partial" : "missing");
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
    next = manualLoreCount === 0
      ? "五维已齐，autoLorebook 已自动生成 "+loreCount+" 条基础条目，但它们以维度名当触发词、且不满足共创要求：下一步必须 cc_add_lorebook_entries，先与用户讨论触发词/常驻偏好，至少再补 1 条（总≥5 条、至少 1 constant、content 头部写 @@decorator）"
      : "五维已齐，下一步必须 cc_add_lorebook_entries：与用户讨论触发词/常驻偏好后补到≥5 条（年表/势力/地理/力量/日常各 1，至少 1 constant，@@decorator），当前 "+loreCount+" 条（其中共创 "+manualLoreCount+" 条）";
  } else if(greetingsState !== "ok"){
    step = 5; next = "世界书已齐（"+loreCount+" 条，其中共创 "+manualLoreCount+" 条），下一步必须 cc_patch_greetings：先问用户偏好的开场场景/关系阶段/群聊与私聊区分，再补问候语（first_mes + alternate≥2 + group≥1）";
  } else {
    step = 6; next = "结构已齐，下一步必须 cc_validate 校验，valid=true 才可收尾；通过后提醒用户在工坊左下角「校验导出」入口打开导出页（JSON / PNG / CHARX），或点「★ 保存当前」落盘";
  }
  const state = { character: characterState, world: worldState, lore: loreState, greetings: greetingsState };
  return {
    step,
    readyToValidate: step === 6,
    state,
    worldFilled, loreCount, manualLoreCount,
    next,
    // 0.6.0（R1/R2）：`hint` 只报**进度**，不再内嵌 `next` 全文 ——
    // 旧版 `hint = 进度 + " → " + next` 让同一句话在一份返回里出现三遍（hint 内嵌 next、message 又等于 hint）。
    // 终态（校验通过）也走同一个函数，所以 `hint` 不会再说「下一步必须 cc_validate」（那是第一轮 P0-3 的半修残留）。
    hint: progressHint(step, state, worldFilled, loreCount, manualLoreCount, false),
  };
}
/** 一行进度摘要（**不含 next** —— 下一步是 workflow.next 的职责，别再复制一份）。 */
function progressHint(step, state, worldFilled, loreCount, manualLoreCount, done){
  const mark = s => s==="ok" ? "✓" : (s==="partial" ? "◐" : "✗");
  return "工作流 " + step + "/" + (done ? 7 : 6)
    + " " + mark(state.character) + "角色"
    + " " + mark(state.world) + "五维(" + worldFilled + "/5)"
    + " " + mark(state.lore) + "世界书(" + loreCount + (manualLoreCount > 0 ? ",共创" + manualLoreCount : "") + ")"
    + " " + mark(state.greetings) + "问候语"
    + (done ? " · 已完成，可导出/保存" : "");
}
// 粗略 token 估算：CJK 一字≈1 token，其余按 4 字符≈1 token（用于 validate 的预算告警与 lint/preview 报告）
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
/**
 * 最坏情况单次触发量（0.7.0，N2）。
 *
 * 为什么不能只看总量：`token_budget` 管的是**一轮对话**里世界书能塞多少，而真正的坑是
 * 「用户随便一句话被好几个条目同时命中」—— 第四轮实测：总量 2272 / 预算 1200 看着只是超一点，
 * 但一句「剑冢到底是什么地方」单独就吃掉 **1139 token**（势力 + 地理 + 力量体系(constant) + 剑冢(constant)）。
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
      const wf = workflowStatus(draft);
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
    description: "【工作流第2步·共创】写入角色基础（name/nickname/description/personality/scenario/system_prompt/tags）。调用前必须已与用户讨论：至少问 1 个开放问题（如想要的气质/性别/年龄/与你的关系张力/禁忌），拿到用户偏好后再填；禁止仅凭世界观自行推断一次性填满。必须在 cc_get_card 之后、五维之前调用，之后下一步是 cc_patch_world。",
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
      if(args.name!==undefined) assignIfChanged(cur.data, "name", String(args.name).slice(0,120), changed);
      if(args.nickname!==undefined) assignIfChanged(cur.data, "nickname", String(args.nickname).slice(0,120), changed);
      if(args.description!==undefined) assignIfChanged(cur.data, "description", String(args.description).slice(0,5000), changed);
      if(args.personality!==undefined) assignIfChanged(cur.data, "personality", String(args.personality).slice(0,5000), changed);
      if(args.scenario!==undefined) assignIfChanged(cur.data, "scenario", String(args.scenario).slice(0,5000), changed);
      if(args.system_prompt!==undefined) assignIfChanged(cur.data, "system_prompt", String(args.system_prompt).slice(0,3000), changed);
      if(args.post_history_instructions!==undefined) assignIfChanged(cur.data, "post_history_instructions", String(args.post_history_instructions).slice(0,3000), changed);
      if(Array.isArray(args.tags)) assignIfChanged(cur.data, "tags", args.tags.map(String).slice(0,12), changed);
      if(args.creator_notes!==undefined) assignIfChanged(cur.data, "creator_notes", String(args.creator_notes).slice(0,3000), changed);
      if(args.creator!==undefined) assignIfChanged(cur.data, "creator", String(args.creator).slice(0,120), changed);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
    description: "【工作流第3步·共创·必调】写入 5 维世界观（timeline/factions/geo/power/daily 至少 3 项）。若用户已提供世界观文档，先用 2-3 句归纳你理解的 5 维，再问用户“哪几维最想展开？有无私设要加？”；若世界观薄弱，则与用户讨论 1-2 个薄弱点后再填。严禁未与用户讨论就直接照搬文档填满 5 维。调后下一步是 cc_add_lorebook_entries。",
    parameters: {
      type:"object",
      properties:{
        timeline:{type:"string", description:"年表"},
        factions:{type:"string", description:"势力"},
        geo:{type:"string", description:"地理"},
        power:{type:"string", description:"力量体系"},
        daily:{type:"string", description:"日常"},
        autoLorebook:{type:"boolean", description:"是否基于 5 维自动生成 3-6 条带 @@decorator 的 lorebook 条目，强烈建议 true"},
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
      if(args.timeline!==undefined) w.timeline = String(args.timeline).slice(0,1000);
      if(args.factions!==undefined) w.factions = String(args.factions).slice(0,1000);
      if(args.geo!==undefined) w.geo = String(args.geo).slice(0,1000);
      if(args.power!==undefined) w.power = String(args.power).slice(0,1000);
      if(args.daily!==undefined) w.daily = String(args.daily).slice(0,1000);
      cur.data.extensions.cc_world = w;
      const shouldAuto = args.autoLorebook !== false; // 默认 true，防偷懒
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
        if(w.power) push("power", "@@activate\n"+w.power, 9, true);
        if(w.daily) push("daily", "@@depth 5\n"+w.daily, 7);
      }
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
        sharedLoreKeys, heavyAutoEntries: heavyAuto.length,
        draftStatus: draftStatusFor(k, cur), workflow: wf,
        message: "已写入五维（" + wf.worldFilled + "/5），自动生成 " + autoEntries.length + " 条基础条目。" + wf.next };
      if(autoEdited.length) warnings.push("被替换的 " + autoEdited.length + " 条旧自动条目（" + autoEdited.join("、") + "）的 keys 曾被手工改过，这次已重建回默认维度名，手工触发词会丢。想保住它们：先用 cc_update_lorebook_entry 写回，或以后调本工具时带上 loreKeys。");
      if(args.verbose === true) res.draft = cur;
      if(warnings.length) res.warnings = warnings;
      return res;
    }
  });

  tool({
    name: "cc_add_lorebook_entries",
    description: "【工作流第4步·共创·必调】添加 1-5 条 Lorebook，补到至少 5 条（年表/势力/地理/力量/日常各 1，至少 1 条 constant，@@decorator）。调用前应与用户讨论：问用户想要哪些触发词/常驻条目/要藏什么彩蛋，拿到偏好后再生成。必须在五维之后、问候语之前调用，禁止一次性无讨论批量生成。",
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
          keys: Array.isArray(e.keys)? e.keys.map(String): [],
          content: String(e.content).slice(0,5000),
          enabled:true,
          insertion_order: cur.data.character_book.entries.length,
          case_sensitive:false,
          use_regex: !!e.use_regex,
          constant: !!e.constant,
          name: String(e.name||"未命名").slice(0,60),
          priority: typeof e.priority==="number"? e.priority: 5,
          id: Date.now()+Math.floor(Math.random()*10000)
        });
      });
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
      const wf = workflowStatus(cur);
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
      if(args.name!==undefined) assignIfChanged(e, "name", String(args.name).slice(0,60), changed);
      if(Array.isArray(args.keys)) assignIfChanged(e, "keys", args.keys.map(String), changed);
      if(args.content!==undefined) assignIfChanged(e, "content", String(args.content).slice(0,5000), changed);
      if(args.enabled!==undefined) assignIfChanged(e, "enabled", !!args.enabled, changed);
      if(args.constant!==undefined) assignIfChanged(e, "constant", !!args.constant, changed);
      if(args.use_regex!==undefined) assignIfChanged(e, "use_regex", !!args.use_regex, changed);
      if(typeof args.priority==="number") assignIfChanged(e, "priority", args.priority, changed);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
    description: "【工作流第5步·共创】写入开场与示例（first_mes / alternate_greetings≥2 / group_only_greetings≥1 / mes_example）。调用前必须问用户偏好的开场场景/关系阶段/群聊与私聊区分，拿到偏好后再写；禁止未与用户讨论就自行编造全部问候语。必须在角色+五维+世界书(≥5)后调用。",
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
      if(args.first_mes!==undefined) cur.data.first_mes = String(args.first_mes).slice(0,5000);
      if(Array.isArray(args.alternate_greetings)) cur.data.alternate_greetings = args.alternate_greetings.map(String).slice(0,10);
      if(Array.isArray(args.group_only_greetings)) cur.data.group_only_greetings = args.group_only_greetings.map(String).slice(0,10);
      if(args.mes_example!==undefined) cur.data.mes_example = String(args.mes_example).slice(0,5000);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
      return { ok:true, action: targetId ? "updated" : "created", id:res.id, meta:res.meta, loreCount:res.meta.loreCount,
        message: (targetId ? "已更新已存卡「" : "已新建已存卡「") + res.meta.name + "」（id " + res.id + "）。" + (targetId ? "" : "下次保存（不传 id）会更新这一张。") };
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
      const wf = workflowStatus(cur);
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
        const wf = workflowStatus(cur);
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
      const wf = workflowStatus(fresh);
      return { ok:true, reset:true, workflow: wf,
        message:"已重置为空白草稿（并解除与已存卡的来源关联，之后保存会新建一张）。" + wf.next };
    }
  });

  // 【世界书元信息】此前 name/description/scan_depth/token_budget/recursive_scanning 一个都改不了
  tool({
    name: "cc_patch_book_meta",
    description: "【世界书·元信息】改 character_book 的顶层参数：name / description / scan_depth / token_budget / recursive_scanning。这些字段此前没有任何工具能改，导致导出的世界书永远是无名书、预算也调不了。合并式更新，只改传入的字段。",
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
      if(args.name!==undefined) assignIfChanged(book, "name", String(args.name).slice(0,120), changed);
      if(args.description!==undefined) assignIfChanged(book, "description", String(args.description).slice(0,500), changed);
      if(typeof args.scan_depth==="number") assignIfChanged(book, "scan_depth", Math.max(1, Math.min(50, Math.round(args.scan_depth))), changed);
      if(typeof args.token_budget==="number") assignIfChanged(book, "token_budget", Math.max(0, Math.round(args.token_budget)), changed);
      if(args.recursive_scanning!==undefined) assignIfChanged(book, "recursive_scanning", !!args.recursive_scanning, changed);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
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
      if(typeof args.text === "string" && args.text.trim()) texts.push(args.text);
      if(Array.isArray(args.texts)) args.texts.forEach(x => { if(typeof x === "string" && x.trim()) texts.push(x); });
      if(!texts.length) return { ok:false, error:"请用 text 或 texts 提供至少一句测试文本" };
      const hitsOf = (line) => {
        const lower = line.toLowerCase();
        return entries.filter(e => {
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
        return {
          text: line, hitCount: hits.length, tokens: lorebookTokens(hits),
          hits: hits.map(e => ({ name: String(e.name||""), constant: !!e.constant, keys: Array.isArray(e.keys)?e.keys:[], priority: e.priority })),
          missed: entries.filter(e => e.enabled !== false && hits.indexOf(e) < 0).map(e => String(e.name||"")),
        };
      });
      const warnings = [];
      if(entries.length && results.every(r => r.hitCount === 0)) warnings.push("这些测试句一条都没触发。若用户很可能这么说，说明世界书的 keys 需要改成实体名（cc_update_lorebook_entry 或下次 cc_patch_world 带 loreKeys）");
      const never = entries.filter(e => e.enabled !== false && !e.constant && (!Array.isArray(e.keys) || e.keys.length === 0));
      if(never.length) warnings.push(never.length + " 条非 constant 条目没有 keys，永远触发不了：" + never.map(e=>String(e.name||"")).join("、"));
      const res = { ok:true, simulated: results.length, results,
        lorebookTokens: lorebookTokens(entries), scanDepth: book.scan_depth,
        message: "模拟完成：" + results.map(r => "「" + r.text.slice(0,16) + "」→ 命中 " + r.hitCount + " 条（约 " + r.tokens + " token）").join("；") };
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
      const add = (level, message, names) => issues.push({ level, message, entries: names || [] });
      const isDimKey = k => AUTO_NAMES.has(String(k)) || ["timeline","faction","geography","power","daily"].includes(String(k));
      const noKeys = entries.filter(e => !e.constant && (!Array.isArray(e.keys) || e.keys.length === 0));
      if(noKeys.length) add("error", noKeys.length + " 条非 constant 条目没有 keys（永远触发不了）", noKeys.map(e=>String(e.name||"")));
      const dimOnly = entries.filter(e => !e.constant && Array.isArray(e.keys) && e.keys.length>0 && e.keys.every(isDimKey));
      if(dimOnly.length) add("error", dimOnly.length + " 条条目的 keys 只有维度名，真实对话不会命中（可用 cc_simulate_trigger 验证）", dimOnly.map(e=>String(e.name||"")));
      const notInContent = entries.filter(e => !e.constant && Array.isArray(e.keys) && e.keys.length>0 && !e.keys.some(k => String(e.content||"").indexOf(String(k))>=0));
      if(notInContent.length) add("warn", notInContent.length + " 条条目的 keys 在自身 content 里找不到（可能误填或内容已改）", notInContent.map(e=>String(e.name||"")));
      const seen = new Map();
      entries.forEach(e => (Array.isArray(e.keys)? e.keys : []).forEach(k => { const kk=String(k).toLowerCase(); seen.set(kk, (seen.get(kk)||[]).concat(String(e.name||""))); }));
      const dup = [...seen.entries()].filter(pair => pair[1].length > 1);
      if(dup.length) add("warn", dup.length + " 个触发词被多条条目共用（会同时触发，可能互相打架）", dup.map(pair => pair[0]));
      if(entries.length && !entries.some(e=>e.constant)) add("warn", "没有 constant 常驻条目：世界观基调只在命中触发词时才出现");
      if(entries.length && entries.every(e=> !String(e.content||"").includes("@@"))) add("warn", "所有条目都没有 @@decorator（@@position/@@depth/@@activate），插入位置全用默认值");
      const used = lorebookTokens(entries);
      const budget = Number(book.token_budget||0) || 0;
      if(budget>0 && used>budget) add("warn", "估算 " + used + " token，已超出 token_budget=" + budget);
      // N2（0.7.0）：总量与「单次触发」是两个独立风险，只报总量会让「调大预算」看起来像修好了。
      const worst = worstCaseTrigger(entries);
      const worstCase = { tokens: worst.tokens, constantTokens: worst.constantTokens, budget, entries: worst.entries, overBudget: budget > 0 && worst.tokens > budget };
      if(worstCase.overBudget){
        add("warn", "最坏情况单次触发约 " + worst.tokens + " token（含常驻 " + worst.constantTokens + "，预算 " + budget + "）：「" + worst.entries.join(" + ") + "」一句话就吃光整份预算（调大 token_budget 盖不住这条）。", worst.entries);
      }
      if(!String(book.name||"").trim()) add("warn", "世界书没有名字（character_book.name 为空，导出后是一本无名的书）");
      const errorCount = issues.filter(i => i.level === "error").length;
      return { ok:true,
        entries: entries.length, manualEntries: entries.filter(e => !isAutoEntry(e)).length,
        constantEntries: entries.filter(e => e.constant).length,
        lorebookTokens: used, tokenBudget: budget, worstCase,
        issues, errorCount, warningCount: issues.length - errorCount,
        message: issues.length
          ? "体检发现 " + issues.length + " 个问题（" + errorCount + " 个会真的不工作）：" + issues.map(i=>i.message).join("；")
          : "世界书体检通过：没有发现结构性问题。" };
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
      return { ok:true,
        bytes, tokens: estimateTokens(json), lorebookTokens: lorebookTokens(entries),
        exportedFields, extensionsExported: Object.keys(d.extensions || {}),
        worldDuplicatedChars: dupChars,
        loreCount: entries.length, manualLoreCount: entries.filter(e => !isAutoEntry(e)).length,
        message: "预计导出 " + bytes + " 字节（约 " + estimateTokens(json) + " token），其中世界书 " + lorebookTokens(entries) + " token；五维（extensions.cc_world）会一起导出，与条目内容重复约 " + dupChars + " 字符。" };
    }
  });

  tool({
    name: "cc_validate",
    description: "【工作流第6步·收口必调】校验 CC 角色卡（SPEC_V3 + 角色四件套/五维≥3/世界书≥5/问候语齐）。valid=false 按 errors 与用户讨论继续补；valid=true 时总结成果并邀请用户在工坊微调后“导出 JSON”或“★ 保存到侧边栏”。全程强调共创：多问用户、多给草案供挑选。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const d = getDraft(ctx, exec);
      const k = keyFor(ctx, exec);
      const st = draftStatusFor(k, d);
      const wf = workflowStatus(d);
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
        errors.push(wf.manualLoreCount === 0
          ? "世界书只有自动条目（"+wf.loreCount+" 条，全部由 autoLorebook 生成），未完成共创：请调 cc_add_lorebook_entries 至少补 1 条（总≥5 条）"
          : "世界书未齐：需至少 5 条（当前 "+wf.loreCount+" 条），请调 cc_add_lorebook_entries 补到 5 条");
      }
      // —— 质量（P1-5：此前 valid=true 只代表「四件套非空」，给用户「卡没问题了」的错觉）——
      if(!String(d.data.scenario||"").trim()) warnings.push("scenario 为空，建议补充（缺失时模型只能靠 description 猜场景）");
      if(!Array.isArray(d.data.alternate_greetings) || d.data.alternate_greetings.length<2) warnings.push("alternate_greetings 建议至少 2 条（当前 "+((d.data.alternate_greetings||[]).length)+" 条）");
      if(!String(d.data.first_mes||"").trim()) warnings.push("first_mes 为空");
      if(!String(d.data.mes_example||"").trim()) warnings.push("mes_example 为空，建议写几段示例对话");
      if(!String(d.data.creator||"").trim()) warnings.push("data.creator 为空（导出后别人看不到作者）—— 用 cc_patch_character 的 creator 参数写入，或让用户在工坊「角色基础」里手动填。");
      if(!String(book.name||"").trim()) warnings.push("世界书没有名字（character_book.name 为空），导出后是一本无名的书；可用 cc_patch_book_meta 命名");
      if(!String(book.description||"").trim()) warnings.push("character_book.description 为空，建议一句话说明这本世界书的作用");
      if(entries.length>0 && !entries.some(e=>e.constant)) warnings.push("世界书建议至少 1 条 constant 常驻条目（否则全靠触发词命中）");
      if(entries.length>0 && entries.every(e=> !String(e.content||"").includes("@@"))) warnings.push("世界书条目建议带 @@decorator（@@position/@@depth/@@activate）");
      const deadKeys = entries.filter(e => !e.constant && (!Array.isArray(e.keys) || e.keys.length===0));
      if(deadKeys.length) warnings.push(deadKeys.length + " 条非 constant 条目没有 keys（永远触发不了）：" + deadKeys.map(e=>String(e.name||"未命名")).join("、"));
      const dimOnly = entries.filter(e => !e.constant && Array.isArray(e.keys) && e.keys.length>0 && e.keys.every(k => AUTO_NAMES.has(String(k)) || ["timeline","faction","geography","power","daily"].includes(String(k))));
      if(dimOnly.length) warnings.push(dimOnly.length + " 条条目的 keys 只有维度名（" + dimOnly.map(e=>String(e.name||"未命名")).join("、") + "），真实对话不会命中；可用 cc_simulate_trigger 拿一句用户会说的话验证，建议改成实体名");
      const keyless = entries.filter(e => { const keys=Array.isArray(e.keys)?e.keys:[]; return keys.length>0 && !e.constant && !keys.some(k => String(e.content||"").indexOf(String(k))>=0); });
      if(keyless.length) warnings.push(keyless.length + " 条条目的 keys 在自身 content 里找不到（可能是误填）：" + keyless.map(e=>String(e.name||"未命名")).join("、"));
      const used = lorebookTokens(entries);
      const budget = Number(book.token_budget||0) || 0;
      if(budget>0 && used > budget) warnings.push("世界书内容估算约 "+used+" token，已超出 token_budget="+budget+"，建议调大预算或精简条目（cc_patch_book_meta）");
      // —— 终态：校验通过后 next 不再指向 cc_validate（P0-3：那正是弱模型死循环的诱因）——
      const valid = errors.length===0;
      const next = valid
        ? "校验通过 ✓ 工作流已完成（step 7/7）。请在工坊左下角「校验导出」入口打开导出页选 JSON / PNG / CHARX，或点「★ 保存当前」落盘到 ~/.dsh/cc-library；还想打磨就直接说改哪里。"
        : "校验未通过，按 errors 逐项补齐（严禁跳步），第一项：" + errors[0];
      // R1（0.6.0）：终态的 `hint` 必须与 `next` 同源 —— 否则会出现「next 说工作流已完成、hint 说下一步必须去校验」
      // 这种自相矛盾（弱模型会读信息最全的 hint，于是反复调 cc_validate）。半修的状态机比没修更危险。
      const wfDone = Object.assign({}, wf, {
        step: valid ? 7 : wf.step,
        done: valid,
        readyToValidate: !valid && wf.readyToValidate,
        next,
        hint: progressHint(valid ? 7 : wf.step, wf.state, wf.worldFilled, wf.loreCount, wf.manualLoreCount, valid),
      });
      const warningsAll = [recoveredNotice(k, d)].filter(Boolean).concat(warnings);   // 新草稿提示同上，交给包装
      return { ok:true, valid, done: valid, errors, warnings: warningsAll,
        loreCount: wf.loreCount, manualLoreCount: wf.manualLoreCount, name: d.data.name,
        lorebookTokens: used, tokenBudget: budget,
        draftStatus: st, workflow: wfDone,
        // R3（0.6.0）：message 不再拼接 next —— 那会让「校验通过 ✓」连说两遍（两个来源拼接未去重）。
        // 下一步只保留 workflow.next 一处。
        message: valid
          ? "校验通过 ✓ 工作流完成（世界书 " + wf.loreCount + " 条 / 估算 " + used + " token）。"
          : "校验未通过：" + errors.length + " 项待补。" };
    }
  });
}

export { apply, inject, name, safeDraftFile, draftDirs, libDirs, dataRoots, originPath, readOriginSync, writeOriginSync };
