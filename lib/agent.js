/**
 * @dsh-plugins/dsh-cc-studio/agent — CC 模式的 Agent Tools（仅在 CC preset 挂载，合并自 dsh-cc-agent）。
 * 通过 globalThis.__CC_DRAFTS__ 与 host 共享草稿，让 LLM 的工具调用能实时反映到浏览器胶囊。
 * 强制工作流：cc_get_card → cc_patch_character → cc_patch_world(≥3维,autoLorebook) → cc_add_lorebook_entries(≥5条) → cc_patch_greetings → cc_validate
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const name = "dsh-cc-studio-agent";
const inject = ["tools", "agents"];

function nowSec(){ return Math.floor(Date.now()/1000); }
function draftsMap(){ if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map(); return globalThis.__CC_DRAFTS__; }
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
function getDraft(ctx, exec){
  const m = draftsMap();
  const k = keyFor(ctx, exec);
  if(!m.has(k)){
    m.set(k, {
      spec:"chara_card_v3", spec_version:"3.0",
      data:{
        name:"", nickname:"", tags:[], creator:"", character_version:"0.1",
        description:"", personality:"", scenario:"", system_prompt:"", post_history_instructions:"",
        first_mes:"", alternate_greetings:[], group_only_greetings:[], mes_example:"",
        creator_notes:"", creator_notes_multilingual:{}, source:[], assets:[{type:"icon",uri:"ccdefault:",name:"main",ext:"png"}],
        creation_date: nowSec(), modification_date: nowSec(),
        character_book:{ name:"", description:"", scan_depth:4, token_budget:1200, recursive_scanning:false, extensions:{}, entries:[] }
      }
    });
  }
  return m.get(k);
}
function setDraft(ctx, draft, exec){
  const m = draftsMap();
  const k = keyFor(ctx, exec);
  draft.data.modification_date = nowSec();
  m.set(k, draft);
  return draft;
}

function libDir(){
  try{ return join(homedir(), ".dsh", "cc-library"); }catch{ return join(process.cwd(), ".cc-library"); }
}
async function ensureLibDir(){
  const dir=libDir();
  await mkdir(dir,{recursive:true});
  return dir;
}
function makeLibraryEntryMeta(draft, existingMeta, id){
  const data=draft&&draft.data?draft.data:{};
  const now=nowSec();
  const loreCount=Array.isArray(data.character_book?.entries)?data.character_book.entries.length:0;
  const tags=Array.isArray(data.tags)?data.tags.slice(0,6).map(String):[];
  return {
    id:String(id),
    name:(data.name && String(data.name).trim()) || (existingMeta && existingMeta.name) || "未命名角色",
    loreCount, tags,
    descriptionSnippet:String(data.description||"").slice(0,80),
    createdAt: existingMeta && existingMeta.createdAt ? existingMeta.createdAt : now,
    updatedAt: now,
  };
}
async function listLibraryEntries(){
  const dir=await ensureLibDir();
  let files=[];
  try{ files=await readdir(dir); }catch{ return []; }
  const entries=[];
  for(const f of files){
    if(!f.endsWith(".json")) continue;
    const pth=join(dir,f);
    try{
      const raw=await readFile(pth,"utf8");
      const obj=JSON.parse(raw);
      if(obj && obj.meta && obj.id) entries.push(obj.meta);
      else if(obj && obj.draft){
        const id=f.replace(/\.json$/,"");
        entries.push(makeLibraryEntryMeta(obj.draft,null,id));
      }
    }catch{}
  }
  entries.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  return entries;
}
async function saveLibraryEntry(draft, opts){
  const dir=await ensureLibDir();
  let id=opts && opts.id ? String(opts.id) : "";
  let existing=null;
  if(id){
    try{ const raw=await readFile(join(dir,id+".json"),"utf8"); existing=JSON.parse(raw);}catch{}
  }
  if(!id) id=String(Date.now())+"-"+Math.random().toString(36).slice(2,6);
  const meta=makeLibraryEntryMeta(draft, existing?existing.meta:null, id);
  if(opts && typeof opts.name==="string" && opts.name.trim()) meta.name=String(opts.name).trim().slice(0,60);
  const payload={id,meta,draft};
  await writeFile(join(dir,id+".json"), JSON.stringify(payload,null,2), "utf8");
  return {id,meta,draft};
}
async function loadLibraryEntry(id){
  const dir=await ensureLibDir();
  const raw=await readFile(join(dir,String(id)+".json"),"utf8");
  const obj=JSON.parse(raw);
  if(!obj || !obj.draft) throw new Error("文件格式错误");
  return obj;
}
async function deleteLibraryEntry(id){
  const dir=await ensureLibDir();
  await unlink(join(dir,String(id)+".json"));
}
async function renameLibraryEntry(id,newName){
  const dir=await ensureLibDir();
  const pth=join(dir,String(id)+".json");
  const raw=await readFile(pth,"utf8");
  const obj=JSON.parse(raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  const name=String(newName||"").trim().slice(0,60);
  if(!name) throw new Error("name 不能为空");
  obj.meta.name=name;
  obj.meta.updatedAt=nowSec();
  await writeFile(pth, JSON.stringify(obj,null,2), "utf8");
  return obj.meta;
}

function out(schema){ return { schema, render: (args, result) => [{ type:"text", text: JSON.stringify(result, null, 2) }] }; }

// —— 强制工作流状态计算 ——
function workflowStatus(draft){
  const d = draft && draft.data ? draft.data : {};
  const w = d.extensions && d.extensions.cc_world ? d.extensions.cc_world : {};
  const loreCount = Array.isArray(d.character_book?.entries) ? d.character_book.entries.length : 0;
  const worldFilled = ["timeline","factions","geo","power","daily"].filter(k => typeof w[k]==="string" && String(w[k]).trim().length>=6).length;
  const characterOk = !!(String(d.name||"").trim() && String(d.description||"").trim() && String(d.personality||"").trim() && String(d.scenario||"").trim());
  const characterPartial = !!(String(d.name||"").trim() && String(d.description||"").trim());
  const worldOk = worldFilled >= 3;
  const loreOk = loreCount >= 5;
  const greetingsOk = !!(String(d.first_mes||"").trim() && Array.isArray(d.group_only_greetings) && d.group_only_greetings.length>=1 && Array.isArray(d.alternate_greetings) && d.alternate_greetings.length>=2);
  const greetingsPartial = !!(String(d.first_mes||"").trim() || (Array.isArray(d.group_only_greetings) && d.group_only_greetings.length>=1));
  let next = "";
  let step = 1;
  if(!characterOk){
    step = 2; next = "下一步必须 cc_patch_character：先与用户讨论角色定位（气质/关系张力等，1-2问）再补齐 name/description/personality/scenario，严禁直接推断填满";
  } else if(!worldOk){
    step = 3; next = "角色基础已齐，下一步必须 cc_patch_world：先与用户讨论世界观侧重（哪几维最想展开/有无私设）再补 5 维（≥3项）";
  } else if(!loreOk){
    step = 4; next = "五维已齐，下一步必须 cc_add_lorebook_entries：与用户讨论触发词/常驻偏好后补到≥5 条（各 1，至少 1 constant，@@decorator），当前 "+loreCount+" 条";
  } else if(!greetingsOk){
    step = 5; next = "世界书已齐（"+loreCount+" 条），下一步必须 cc_patch_greetings：先问用户偏好场景/关系阶段再补问候语（first_mes + alternate≥2 + group≥1）";
  } else {
    step = 6; next = "全部已齐，下一步必须 cc_validate 校验，valid=true 才可收尾，提醒用户在工坊“导出 JSON”或“★ 保存到侧边栏”";
  }
  const hint = "工作流 "+step+"/6" + (characterOk?" ✓角色":" ✗角色") + (worldOk?" ✓五维("+worldFilled+"/5)":" ✗五维("+worldFilled+"/5)") + (loreOk?" ✓世界书("+loreCount+")":" ✗世界书("+loreCount+"/5)") + (greetingsOk?" ✓问候语":" ✗问候语") + " → "+next;
  return { characterOk, characterPartial, worldOk, worldFilled, loreCount, loreOk, greetingsOk, greetingsPartial, step, next, hint };
}

function apply(ctx){
  ctx.tools.register({
    name: "cc_get_card",
    description: "【工作流第1步·必调·先问再填】查看当前 CC 角色卡草稿与工作流进度。CC 模式下必须先调此工具，然后用自然语言向用户总结当前进度（角色/五维/世界书/问候语各缺什么），并用 1-2 个开放问题邀请用户表达偏好，再按步推进。严禁未与用户讨论就直接推断填满。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true, properties:{ draft:{type:"object"}, hint:{type:"string"}, loreCount:{type:"number"}, workflow:{type:"object"}, next:{type:"string"} } }),
    async execute(args, exec){
      const draft = getDraft(ctx, exec);
      const wf = workflowStatus(draft);
      return { draft, workflow: wf, hint: wf.hint, next: wf.next, loreCount: wf.loreCount };
    }
  });

  ctx.tools.register({
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
        creator_notes:{type:"string", description:"creator_notes"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      if(args.name!==undefined) cur.data.name = String(args.name).slice(0,120);
      if(args.nickname!==undefined) cur.data.nickname = String(args.nickname).slice(0,120);
      if(args.description!==undefined) cur.data.description = String(args.description).slice(0,5000);
      if(args.personality!==undefined) cur.data.personality = String(args.personality).slice(0,5000);
      if(args.scenario!==undefined) cur.data.scenario = String(args.scenario).slice(0,5000);
      if(args.system_prompt!==undefined) cur.data.system_prompt = String(args.system_prompt).slice(0,3000);
      if(args.post_history_instructions!==undefined) cur.data.post_history_instructions = String(args.post_history_instructions).slice(0,3000);
      if(Array.isArray(args.tags)) cur.data.tags = args.tags.map(String).slice(0,12);
      if(args.creator_notes!==undefined) cur.data.creator_notes = String(args.creator_notes).slice(0,3000);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
      return { ok:true, draft: cur, workflow: wf, next: wf.next, message:"已写入胶囊（角色基础），"+wf.next };
    }
  });

  ctx.tools.register({
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
        autoLorebook:{type:"boolean", description:"是否基于 5 维自动生成 3-6 条带 @@decorator 的 lorebook 条目，强烈建议 true"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      cur.data.extensions = cur.data.extensions || {};
      const w = cur.data.extensions.cc_world || {};
      if(args.timeline!==undefined) w.timeline = String(args.timeline).slice(0,1000);
      if(args.factions!==undefined) w.factions = String(args.factions).slice(0,1000);
      if(args.geo!==undefined) w.geo = String(args.geo).slice(0,1000);
      if(args.power!==undefined) w.power = String(args.power).slice(0,1000);
      if(args.daily!==undefined) w.daily = String(args.daily).slice(0,1000);
      cur.data.extensions.cc_world = w;
      const shouldAuto = args.autoLorebook !== false; // 默认 true，防偷懒
      if(shouldAuto){
        // 修复 #1：移除先前由 autoLorebook 生成的旧条目，避免重复与过时（保留手动条目）
        // 兼容旧数据（无标记时按固定名匹配），新数据按 cc_auto 标记精确匹配
        const autoNames = new Set(["年表","势力","地理","力量体系","日常"]);
        cur.data.character_book.entries = cur.data.character_book.entries.filter(e => {
          if(e.cc_auto === true) return false;
          if(e.extensions && e.extensions.cc_auto) return false;
          if(autoNames.has(e.name)) return false;
          return true;
        });
        // 重新计算 insertion_order 保持连续（手动条目保留相对顺序）
        cur.data.character_book.entries.forEach((e, i) => e.insertion_order = i);
        const push=(name, keys, content, priority, constant=false)=>{
          cur.data.character_book.entries.push({ keys, content, enabled:true, insertion_order: cur.data.character_book.entries.length, case_sensitive:false, use_regex:false, constant, name, priority, id: Date.now()+Math.floor(Math.random()*10000), cc_auto:true, extensions:{cc_auto:true} });
        };
        if(w.timeline) push("年表", ["年表","timeline"], "@@position after_desc\n"+w.timeline, 10);
        if(w.factions) push("势力", ["势力","faction"], "@@depth 4\n"+w.factions, 9);
        if(w.geo) push("地理", ["地理","geography"], "@@position scenario\n"+w.geo, 8);
        if(w.power) push("力量体系", ["力量","power"], "@@activate\n"+w.power, 9, true);
        if(w.daily) push("日常", ["日常","daily"], "@@depth 5\n"+w.daily, 7);
      }
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
      return { ok:true, loreCount: cur.data.character_book.entries.length, draft: cur, workflow:wf, next: wf.next, message: "已写入五维（"+wf.worldFilled+"/5），"+wf.next };
    }
  });

  ctx.tools.register({
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
        }
      },
      required:["entries"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
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
      return { ok:true, added: args.entries.length, loreCount: cur.data.character_book.entries.length, workflow:wf, next: wf.next };
    }
  });

  ctx.tools.register({
    name: "cc_delete_lorebook_entries",
    description: "【Lorebook 管理】按 id 或 name 删除条目（用于清理过时条目，autoLorebook 已自动覆盖旧自动条目，手动条目需显式删除）。至少提供 ids 或 names 之一。",
    parameters: {
      type:"object",
      properties:{
        ids:{type:"array", items:{type:"number"}, description:"要删除的条目 id 列表"},
        names:{type:"array", items:{type:"string"}, description:"要删除的条目 name 列表（精确匹配）"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const before = cur.data.character_book.entries.length;
      const idSet = new Set(Array.isArray(args.ids)? args.ids.map(Number): []);
      const nameSet = new Set(Array.isArray(args.names)? args.names.map(String): []);
      if(idSet.size===0 && nameSet.size===0) return { ok:false, error:"请提供 ids 或 names" };
      cur.data.character_book.entries = cur.data.character_book.entries.filter(e => !idSet.has(e.id) && !nameSet.has(e.name));
      // 重排 insertion_order
      cur.data.character_book.entries.forEach((e,i)=> e.insertion_order=i);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
      return { ok:true, deleted: before - cur.data.character_book.entries.length, loreCount: cur.data.character_book.entries.length, workflow:wf, next:wf.next };
    }
  });

  ctx.tools.register({
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
        priority:{type:"number"}
      },
      required:["id"],
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      const e = cur.data.character_book.entries.find(x=> x.id===args.id);
      if(!e) return { ok:false, error:"未找到 id="+args.id };
      if(args.name!==undefined) e.name=String(args.name).slice(0,60);
      if(Array.isArray(args.keys)) e.keys=args.keys.map(String);
      if(args.content!==undefined) e.content=String(args.content).slice(0,5000);
      if(args.enabled!==undefined) e.enabled=!!args.enabled;
      if(args.constant!==undefined) e.constant=!!args.constant;
      if(args.use_regex!==undefined) e.use_regex=!!args.use_regex;
      if(typeof args.priority==="number") e.priority=args.priority;
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
      return { ok:true, entry:e, loreCount: cur.data.character_book.entries.length, workflow:wf, next:wf.next };
    }
  });

  ctx.tools.register({
    name: "cc_patch_greetings",
    description: "【工作流第5步·共创】写入开场与示例（first_mes / alternate_greetings≥2 / group_only_greetings≥1 / mes_example）。调用前必须问用户偏好的开场场景/关系阶段/群聊与私聊区分，拿到偏好后再写；禁止未与用户讨论就自行编造全部问候语。必须在角色+五维+世界书(≥5)后调用。",
    parameters: {
      type:"object",
      properties:{
        first_mes:{type:"string", description:"首条开场白"},
        alternate_greetings:{type:"array", items:{type:"string"}, description:"备选开场白数组，至少 2 条"},
        group_only_greetings:{type:"array", items:{type:"string"}, description:"群聊限定开场白（必填至少1条）"},
        mes_example:{type:"string", description:"对话示例（可用 {{user}}/{{char}}）"}
      },
      additionalProperties:false
    },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const cur = JSON.parse(JSON.stringify(getDraft(ctx, exec)));
      if(args.first_mes!==undefined) cur.data.first_mes = String(args.first_mes).slice(0,5000);
      if(Array.isArray(args.alternate_greetings)) cur.data.alternate_greetings = args.alternate_greetings.map(String).slice(0,10);
      if(Array.isArray(args.group_only_greetings)) cur.data.group_only_greetings = args.group_only_greetings.map(String).slice(0,10);
      if(args.mes_example!==undefined) cur.data.mes_example = String(args.mes_example).slice(0,5000);
      setDraft(ctx, cur, exec);
      const wf = workflowStatus(cur);
      // 若世界书/五维未齐，警告但仍写入，让 validate 卡住
      let warn = "";
      if(!wf.loreOk) warn = " 警告：世界书仅 "+wf.loreCount+"/5 条，validate 会失败，请先补世界书。";
      if(!wf.worldOk) warn += " 警告：五维仅 "+wf.worldFilled+"/5 项，validate 会失败。";
      return { ok:true, draft: cur, workflow:wf, next: wf.next, warning: warn, message: "已写入问候语"+warn+"。"+wf.next };
    }
  });

  // —— 已存角色库 CRUD（ID 化，模型可直接管理，与工坊侧栏共享 ~/.dsh/cc-library） ——
  ctx.tools.register({
    name: "cc_list_library",
    description: "【库·查】列出已存角色库所有条目（id/name/loreCount/tags/updatedAt），用于让用户挑选载入或让模型决定更新哪一张。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const entries=await listLibraryEntries();
      return { ok:true, entries, count:entries.length };
    }
  });
  ctx.tools.register({
    name: "cc_save_to_library",
    description: "【库·增/改】将当前会话草稿按唯一 ID 存入已存库（ID 化 CRUD）。不传 id 则新建 ID；传 id 则按 ID 原地覆盖（更新），无需先删旧卡。模型可在用户说“保存/更新”时直接调用。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"要覆盖的已存 ID（不传则新建）"}, name:{type:"string", description:"覆盖 meta.name（可选，不影响 draft.data.name）"} }, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const draft=JSON.parse(JSON.stringify(getDraft(ctx,exec)));
      // 至少需要 name
      if(!draft.data.name || !String(draft.data.name).trim()) return { ok:false, error:"当前草稿缺少 data.name，请先 cc_patch_character 补齐" };
      const res=await saveLibraryEntry(draft,{id:args.id, name:args.name});
      return { ok:true, id:res.id, meta:res.meta, loreCount:res.meta.loreCount };
    }
  });
  ctx.tools.register({
    name: "cc_load_from_library",
    description: "【库·载入】按 ID 将已存卡载入当前会话草稿（会覆盖当前 draft），载入后再次保存将按此 ID 更新。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"已存条目 ID"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const obj=await loadLibraryEntry(args.id);
      const cur=JSON.parse(JSON.stringify(obj.draft));
      setDraft(ctx,cur,exec);
      return { ok:true, id:obj.id, meta:obj.meta, draft:cur, loreCount:obj.meta.loreCount };
    }
  });
  ctx.tools.register({
    name: "cc_delete_from_library",
    description: "【库·删】按 ID 删除已存条目，模型可在用户确认后调用。",
    parameters: { type:"object", properties:{ id:{type:"string", description:"要删除的 ID"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      await deleteLibraryEntry(args.id);
      return { ok:true, id:args.id };
    }
  });
  ctx.tools.register({
    name: "cc_rename_in_library",
    description: "【库·改名】按 ID 重命名已存条目（仅改 meta.name，不改 draft 内容）。",
    parameters: { type:"object", properties:{ id:{type:"string"}, name:{type:"string", description:"新名称"} }, required:["id","name"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const meta=await renameLibraryEntry(args.id,args.name);
      return { ok:true, meta };
    }
  });
  ctx.tools.register({
    name: "cc_get_library_entry",
    description: "【库·查单条】按 ID 获取单条完整草稿与 meta，用于模型在重命名/更新前确认内容。",
    parameters: { type:"object", properties:{ id:{type:"string"} }, required:["id"], additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const obj=await loadLibraryEntry(args.id);
      return { ok:true, id:obj.id, meta:obj.meta, draft:obj.draft };
    }
  });

  ctx.tools.register({
    name: "cc_validate",
    description: "【工作流第6步·收口必调】校验 CC 角色卡（SPEC_V3 + 角色四件套/五维≥3/世界书≥5/问候语齐）。valid=false 按 errors 与用户讨论继续补；valid=true 时总结成果并邀请用户在工坊微调后“导出 JSON”或“★ 保存到侧边栏”。全程强调共创：多问用户、多给草案供挑选。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const d = getDraft(ctx, exec);
      const wf = workflowStatus(d);
      const errors=[], warnings=[];
      if(!String(d.data.name||"").trim()) errors.push("缺 data.name（角色名）");
      if(!String(d.data.description||"").trim()) errors.push("缺 data.description");
      if(!String(d.data.personality||"").trim()) errors.push("缺 data.personality");
      if(!String(d.data.scenario||"").trim()) warnings.push("scenario 为空，建议补充");
      if(!Array.isArray(d.data.group_only_greetings) || d.data.group_only_greetings.length<1) errors.push("缺 group_only_greetings（至少 1 条必填）");
      if(!Array.isArray(d.data.alternate_greetings) || d.data.alternate_greetings.length<2) warnings.push("alternate_greetings 建议至少 2 条");
      if(!String(d.data.first_mes||"").trim()) warnings.push("first_mes 为空");
      if(!wf.worldOk) errors.push("五维世界观未齐：需 timeline/factions/geo/power/daily 至少 3 项（当前 "+wf.worldFilled+"/5），请调 cc_patch_world");
      if(!wf.loreOk) errors.push("世界书未齐：需至少 5 条（当前 "+wf.loreCount+" 条），请调 cc_add_lorebook_entries 补到 5 条");
      if(wf.loreCount>0 && !d.data.character_book.entries.some(e=>e.constant)) warnings.push("世界书建议至少 1 条 constant 常驻条目");
      if(d.data.character_book.entries.length>0 && d.data.character_book.entries.every(e=> !String(e.content||"").includes("@@"))) warnings.push("世界书条目建议带 @@decorator（@@position/@@depth/@@activate）");
      const valid = errors.length===0;
      const hint = valid ? "校验通过 ✓ 可导出/保存到侧边栏" : "校验未通过，按 errors 逐项补齐（严禁跳步）";
      return { valid, errors, warnings, workflow:wf, next: wf.next, hint, loreCount: wf.loreCount, name: d.data.name };
    }
  });
}

export { apply, inject, name };
