/**
 * @dsh-plugins/dsh-cc-studio — host half.
 * CCv3 工坊：校验 + 共享草稿（供 CC 模式的 LLM Tools 与浏览器胶囊同步）+ 已存角色侧边栏落盘。
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const name = "dsh-cc-studio";
const inject = ["connection", "agents", "agentPresets"];

function ok(value){ return { ok:true, value }; }
function fail(code, message, details={}){ return { ok:false, error:{ code:"internal", message, details:{...details, code} } }; }

function validateCard(card){
  const errors=[];
  const warnings=[];
  if(!card || typeof card!=="object") errors.push("card 必须是对象");
  else {
    if(card.spec!=="chara_card_v3") errors.push('spec 必须为 "chara_card_v3"');
    if(card.spec_version!=="3.0") warnings.push('spec_version 建议为 "3.0"');
    const d=card.data;
    if(!d || typeof d!=="object") errors.push("data 缺失");
    else {
      if(typeof d.name!=="string" || d.name.trim()==="") errors.push("data.name 必填");
      if(!Array.isArray(d.group_only_greetings)) errors.push("data.group_only_greetings 必填且为 string[]");
      if(d.tags && !Array.isArray(d.tags)) errors.push("data.tags 必须为 string[]");
      if(d.assets){
        if(!Array.isArray(d.assets)) errors.push("data.assets 必须为数组");
        else {
          const mains=d.assets.filter(a=>a.type==="icon" && a.name==="main");
          if(mains.length!==1) warnings.push("assets 中 icon/main 应恰好 1 个（缺省会自动补）");
          for(const a of d.assets){
            if(typeof a.type!=="string"||typeof a.uri!=="string"||typeof a.name!=="string"||typeof a.ext!=="string") errors.push("assets[] 元素需含 type/uri/name/ext 均为 string");
          }
        }
      }
      if(d.character_book){
        const lb=d.character_book;
        if(!Array.isArray(lb.entries)) errors.push("character_book.entries 必须为数组");
        else {
          for(let i=0;i<lb.entries.length;i++){
            const e=lb.entries[i];
            if(typeof e.content!=="string") errors.push(`entries[${i}].content 必须为 string`);
            if(typeof e.enabled!=="boolean") warnings.push(`entries[${i}].enabled 建议为 boolean`);
            if(typeof e.insertion_order!=="number") warnings.push(`entries[${i}].insertion_order 建议为 number`);
            if(typeof e.use_regex!=="boolean") warnings.push(`entries[${i}].use_regex 建议为 boolean`);
            if(typeof e.content==="string"){
              const heads=e.content.split("\n").filter(l=>l.trim().startsWith("@@"));
              for(const h of heads){
                if(!/^@@[a-z_]+(\s+.+)?$/.test(h.trim())) warnings.push(`entries[${i}] decorator 语法可疑: ${h.trim().slice(0,40)}`);
              }
            }
            if(e.use_regex && Array.isArray(e.keys)){
              for(const k of e.keys){
                try{ new RegExp(k); }catch{ warnings.push(`entries[${i}] keys 正则非法: ${k.slice(0,30)}`); }
              }
            }
          }
        }
      }
      if(d.creation_date!==undefined && typeof d.creation_date!=="number") warnings.push("creation_date 应为 number(秒)");
      if(d.modification_date!==undefined && typeof d.modification_date!=="number") warnings.push("modification_date 应为 number(秒)");
    }
  }
  return { valid: errors.length===0, errors, warnings };
}

function nowSec(){ return Math.floor(Date.now()/1000); }
function makeDefaultDraft(){
  return {
    spec:"chara_card_v3", spec_version:"3.0",
    data:{
      name:"", nickname:"", tags:[], creator:"", character_version:"0.1",
      description:"", personality:"", scenario:"",
      system_prompt:"", post_history_instructions:"",
      first_mes:"", alternate_greetings:[], group_only_greetings:[],
      mes_example:"", creator_notes:"", creator_notes_multilingual:{}, source:[], assets:[{type:"icon", uri:"ccdefault:", name:"main", ext:"png"}],
      creation_date: nowSec(), modification_date: nowSec(),
      character_book:{ name:"", description:"", scan_depth:4, token_budget:1200, recursive_scanning:false, extensions:{}, entries:[] }
    }
  };
}
if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map();
function draftKeyFrom(ctx, args){
  if(args && typeof args.sessionId==="string" && args.sessionId) return String(args.sessionId);
  try{
    const agents = ctx.get("agents");
    const ag = agents && agents.currentInitiator && agents.currentInitiator();
    if(ag){
      if(ag.session && ag.session.id) return String(ag.session.id);
      if(ag.id) return String(ag.id);
      if(ag.sessionId) return String(ag.sessionId);
    }
  }catch{}
  return "default";
}
function getDraftFor(key){
  const k = key || "default";
  if(!globalThis.__CC_DRAFTS__.has(k)) globalThis.__CC_DRAFTS__.set(k, makeDefaultDraft());
  return globalThis.__CC_DRAFTS__.get(k);
}
function setDraftFor(key, draft){
  draft.data.modification_date = nowSec();
  globalThis.__CC_DRAFTS__.set(key, draft);
  return draft;
}
function isCcPreset(ctx, sessionId){
    if(sessionId){
    try{
      const agents = ctx.get("agents");
      const presets = ctx.get("agentPresets");
      if(agents && presets){
        const ag = agents.get(sessionId);
        if(ag){
          const pid = presets.composedPreset(ag.ctx);
          if(pid) return pid === "cc";
        }
      }
    }catch{}
  }
  try{
    const agents2 = ctx.get("agents");
    const presets2 = ctx.get("agentPresets");
    if(agents2 && presets2){
      const ag2 = agents2.currentInitiator && agents2.currentInitiator();
      if(ag2){
        const pid2 = presets2.composedPreset(ag2.ctx);
        if(pid2) return pid2 === "cc";
      }
    }
  }catch{}
  return false;
}

// —— 已存角色侧边栏：落盘到 ~/.dsh/cc-library/<id>.json ——
function libDir(){
  try{ return join(homedir(), ".dsh", "cc-library"); }catch{ return join(process.cwd(), ".cc-library"); }
}
async function ensureLibDir(){
  const dir = libDir();
  await mkdir(dir, { recursive: true });
  return dir;
}
function makeLibraryEntryMeta(draft, existingMeta, id){
  const data = draft && draft.data ? draft.data : {};
  const now = nowSec();
  const loreCount = Array.isArray(data.character_book?.entries) ? data.character_book.entries.length : 0;
  const tags = Array.isArray(data.tags) ? data.tags.slice(0,6).map(String) : [];
  return {
    id: String(id),
    name: (data.name && String(data.name).trim()) || (existingMeta && existingMeta.name) || "未命名角色",
    loreCount,
    tags,
    descriptionSnippet: String(data.description || "").slice(0,80),
    createdAt: existingMeta && existingMeta.createdAt ? existingMeta.createdAt : now,
    updatedAt: now,
  };
}
async function listLibraryEntries(){
  const dir = await ensureLibDir();
  let files=[];
  try{ files = await readdir(dir); }catch{ return []; }
  const entries=[];
  for(const f of files){
    if(!f.endsWith(".json")) continue;
    const p = join(dir, f);
    try{
      const raw = await readFile(p, "utf8");
      const obj = JSON.parse(raw);
      if(obj && obj.meta && obj.id){
        // 兼容：meta.id 与文件名 id 一致
        entries.push(obj.meta);
      } else if(obj && obj.draft){
        // 旧格式兜底：从 draft 重建 meta
        const id = f.replace(/\.json$/,"");
        entries.push(makeLibraryEntryMeta(obj.draft, null, id));
      }
    }catch{}
  }
  entries.sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
  return entries;
}
async function saveLibraryEntry(draft, opts){
  const dir = await ensureLibDir();
  let id = opts && opts.id ? String(opts.id) : "";
  let existing = null;
  if(id){
    try{
      const raw = await readFile(join(dir, id+".json"), "utf8");
      existing = JSON.parse(raw);
    }catch{}
  }
  if(!id){
    id = String(Date.now())+"-"+Math.random().toString(36).slice(2,6);
  }
  const meta = makeLibraryEntryMeta(draft, existing ? existing.meta : null, id);
  // 若调用方显式传 name，覆盖 meta.name（不改 draft.data.name，保持原样）
  if(opts && typeof opts.name==="string" && opts.name.trim()){
    meta.name = String(opts.name).trim().slice(0,60);
  }
  const payload = { id, meta, draft };
  await writeFile(join(dir, id+".json"), JSON.stringify(payload, null, 2), "utf8");
  return { id, meta, draft };
}
async function loadLibraryEntry(id){
  const dir = await ensureLibDir();
  const p = join(dir, String(id)+".json");
  const raw = await readFile(p, "utf8");
  const obj = JSON.parse(raw);
  if(!obj || !obj.draft) throw new Error("文件格式错误");
  return obj;
}
async function deleteLibraryEntry(id){
  const dir = await ensureLibDir();
  const p = join(dir, String(id)+".json");
  await unlink(p);
}
async function renameLibraryEntry(id, newName){
  const dir = await ensureLibDir();
  const p = join(dir, String(id)+".json");
  const raw = await readFile(p, "utf8");
  const obj = JSON.parse(raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  const name = String(newName||"").trim().slice(0,60);
  if(!name) throw new Error("name 不能为空");
  obj.meta.name = name;
  obj.meta.updatedAt = nowSec();
  await writeFile(p, JSON.stringify(obj, null, 2), "utf8");
  return obj.meta;
}

function apply(ctx){
  globalThis.__CC_CTX__ = ctx;
  ctx.connection.rpc.handle("/dsh-cc-studio-rpc", async (endpoint, payload, signal)=>{
    const args= payload && typeof payload==="object" && payload.args && typeof payload.args==="object" ? payload.args : {};
    try{
      switch(endpoint){
        case "validate":{
          const card=args.card || getDraftFor(draftKeyFrom(ctx, args));
          const res=validateCard(card);
          return ok(res);
        }
        case "ping":{
          return ok({ ok:true, time: Date.now() });
        }
        case "cc_isCcMode":{
          return ok({ isCc: isCcPreset(ctx, args.sessionId) });
        }
        case "cc_getDraft":{
          const k = draftKeyFrom(ctx, args);
          const d = getDraftFor(k);
          return ok({ draft: d, key: k, isCc: isCcPreset(ctx, args.sessionId) });
        }
        case "cc_setDraft":{
          const k = draftKeyFrom(ctx, args);
          const draft = args.draft;
          if(!draft || typeof draft!=="object") return fail("invalid-draft","draft 必须为对象");
          const v = validateCard(draft);
          if(!v.valid) return fail("invalid-card","校验未通过: "+v.errors.join("; "), {errors:v.errors});
          setDraftFor(k, draft);
          return ok({ draft, key:k });
        }
        case "cc_patchDraft":{
          const k = draftKeyFrom(ctx, args);
          const patch = args.patch && typeof args.patch==="object" ? args.patch : {};
          const cur = JSON.parse(JSON.stringify(getDraftFor(k)));
          if(patch.name!==undefined) cur.data.name = String(patch.name).slice(0,120);
          if(patch.nickname!==undefined) cur.data.nickname = String(patch.nickname).slice(0,120);
          if(patch.description!==undefined) cur.data.description = String(patch.description).slice(0,4000);
          if(patch.personality!==undefined) cur.data.personality = String(patch.personality).slice(0,4000);
          if(patch.scenario!==undefined) cur.data.scenario = String(patch.scenario).slice(0,4000);
          if(patch.system_prompt!==undefined) cur.data.system_prompt = String(patch.system_prompt).slice(0,2000);
          if(patch.post_history_instructions!==undefined) cur.data.post_history_instructions = String(patch.post_history_instructions).slice(0,2000);
          if(patch.first_mes!==undefined) cur.data.first_mes = String(patch.first_mes).slice(0,4000);
          if(Array.isArray(patch.alternate_greetings)) cur.data.alternate_greetings = patch.alternate_greetings.map(String).slice(0,10);
          if(Array.isArray(patch.group_only_greetings)) cur.data.group_only_greetings = patch.group_only_greetings.map(String).slice(0,10);
          if(patch.mes_example!==undefined) cur.data.mes_example = String(patch.mes_example).slice(0,4000);
          if(Array.isArray(patch.tags)) cur.data.tags = patch.tags.map(String).slice(0,12);
          if(patch.creator_notes!==undefined) cur.data.creator_notes = String(patch.creator_notes).slice(0,2000);
          if(patch.world && typeof patch.world==="object"){
            cur.data.extensions = cur.data.extensions || {};
            cur.data.extensions.cc_world = Object.assign({}, cur.data.extensions.cc_world||{}, patch.world);
          }
          if(patch.lorebookEntry && typeof patch.lorebookEntry==="object"){
            const e = patch.lorebookEntry;
            const entry = {
              keys: Array.isArray(e.keys)? e.keys.map(String): [],
              content: String(e.content||"").slice(0,4000),
              enabled: e.enabled!==undefined? !!e.enabled : true,
              insertion_order: cur.data.character_book.entries.length,
              case_sensitive: !!e.case_sensitive,
              use_regex: !!e.use_regex,
              constant: !!e.constant,
              name: String(e.name||"未命名").slice(0,60),
              priority: typeof e.priority==="number"? e.priority : 5,
              id: Date.now()+Math.floor(Math.random()*1000),
            };
            cur.data.character_book.entries.push(entry);
          }
          if(patch.lorebookEntries && Array.isArray(patch.lorebookEntries)){
            patch.lorebookEntries.slice(0,20).forEach(function(e){
              const entry = {
                keys: Array.isArray(e.keys)? e.keys.map(String): [],
                content: String(e.content||"").slice(0,4000),
                enabled: e.enabled!==undefined? !!e.enabled : true,
                insertion_order: cur.data.character_book.entries.length,
                case_sensitive: !!e.case_sensitive,
                use_regex: !!e.use_regex,
                constant: !!e.constant,
                name: String(e.name||"未命名").slice(0,60),
                priority: typeof e.priority==="number"? e.priority : 5,
                id: Date.now()+Math.floor(Math.random()*10000),
              };
              cur.data.character_book.entries.push(entry);
            });
          }
          setDraftFor(k, cur);
          return ok({ draft: cur, key:k });
        }
        case "cc_validateDraft":{
          const k = draftKeyFrom(ctx, args);
          const d = getDraftFor(k);
          return ok(validateCard(d));
        }
        // —— 已存角色库 ——
        case "cc_listLibrary":{
          const entries = await listLibraryEntries();
          return ok({ entries });
        }
        case "cc_saveToLibrary":{
          // args: {draft?, id?, name?, sessionId?}  draft 缺省则取当前会话草稿
          let draft = args.draft;
          if(!draft || typeof draft!=="object"){
            const k = draftKeyFrom(ctx, args);
            draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          }
          // 允许保存未完全校验的草稿，但至少需要 name？不强制，meta 会兜底“未命名角色”
          const res = await saveLibraryEntry(draft, { id: args.id, name: args.name });
          return ok(res);
        }
        case "cc_loadFromLibrary":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          const obj = await loadLibraryEntry(id);
          // 载入到当前会话草稿
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, JSON.parse(JSON.stringify(obj.draft)));
          return ok({ draft: obj.draft, meta: obj.meta, key: k });
        }
        case "cc_deleteFromLibrary":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          await deleteLibraryEntry(id);
          return ok({ ok:true, id });
        }
        case "cc_renameInLibrary":{
          const id = args.id;
          const newName = args.name;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          if(typeof newName!=="string" || !newName.trim()) return fail("invalid-name","name 必填");
          const meta = await renameLibraryEntry(id, newName);
          return ok({ meta });
        }
        case "cc_getLibraryEntry":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          const obj = await loadLibraryEntry(id);
          return ok(obj);
        }
        default:
          return fail("unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
      }
    }catch(e){
      return fail("internal-error", e && e.message ? String(e.message) : String(e));
    }
  }, { authority:"trusted-host" });
}

export { apply, inject, name };


