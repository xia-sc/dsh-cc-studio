/**
 * @dsh-plugins/dsh-cc-studio/agent — CC 模式的 Agent Tools（仅在 CC preset 挂载，合并自 dsh-cc-agent）。
 * 通过 globalThis.__CC_DRAFTS__ 与 host 共享草稿，让 LLM 的工具调用能实时反映到浏览器胶囊。
 */
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

function out(schema){ return { schema, render: (args, result) => [{ type:"text", text: JSON.stringify(result, null, 2) }] }; }

function apply(ctx){
  ctx.tools.register({
    name: "cc_get_card",
    description: "查看当前 CC 角色卡的完整 JSON 草稿（含校验提示）。在 CC 模式下，LLM 应先调用此工具了解已填了什么、还缺什么，再引导用户。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true, properties:{ draft:{type:"object"}, hint:{type:"string"}, loreCount:{type:"number"} } }),
    async execute(args, exec){
      const draft = getDraft(ctx, exec);
      const errors=[];
      if(!draft.data.name) errors.push("缺 name");
      if(!Array.isArray(draft.data.group_only_greetings) || draft.data.group_only_greetings.length===0) errors.push("缺 group_only_greetings（至少1条）");
      if(!draft.data.description) errors.push("缺 description");
      if(draft.data.character_book.entries.length===0) errors.push("世界书为空，建议至少 3 条");
      return { draft, hint: errors.length? ("待补："+errors.join("、")) : "必填已齐，可校验导出", loreCount: draft.data.character_book.entries.length };
    }
  });

  ctx.tools.register({
    name: "cc_patch_character",
    description: "写入/更新角色基础信息。LLM 在 CC 模式下通过对话引导用户后，调用此工具把用户确认的内容写进胶囊。可增量调用，多次合并。",
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
      return { ok:true, draft: cur, message:"已写入胶囊，用户可在工坊实时看到" };
    }
  });

  ctx.tools.register({
    name: "cc_patch_world",
    description: "写入 5 维世界观。LLM 引导用户补全年表/势力/地理/力量/日常后，调用此工具保存到 extensions.cc_world，并可选择直接生成对应的 lorebook 条目。",
    parameters: {
      type:"object",
      properties:{
        timeline:{type:"string", description:"年表"},
        factions:{type:"string", description:"势力"},
        geo:{type:"string", description:"地理"},
        power:{type:"string", description:"力量体系"},
        daily:{type:"string", description:"日常"},
        autoLorebook:{type:"boolean", description:"是否基于 5 维自动生成 3-6 条带 @@decorator 的 lorebook 条目"}
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
      if(args.autoLorebook){
        const push=(name, keys, content, priority, constant=false)=>{
          cur.data.character_book.entries.push({ keys, content, enabled:true, insertion_order: cur.data.character_book.entries.length, case_sensitive:false, use_regex:false, constant, name, priority, id: Date.now()+Math.floor(Math.random()*10000) });
        };
        if(w.timeline) push("年表", ["年表","timeline"], "@@position after_desc\n"+w.timeline, 10);
        if(w.factions) push("势力", ["势力","faction"], "@@depth 4\n"+w.factions, 9);
        if(w.geo) push("地理", ["地理","geography"], "@@position scenario\n"+w.geo, 8);
        if(w.power) push("力量体系", ["力量","power"], "@@activate\n"+w.power, 9, true);
        if(w.daily) push("日常", ["日常","daily"], "@@depth 5\n"+w.daily, 7);
      }
      setDraft(ctx, cur, exec);
      return { ok:true, loreCount: cur.data.character_book.entries.length, draft: cur };
    }
  });

  ctx.tools.register({
    name: "cc_add_lorebook_entries",
    description: "添加 1-5 条 Lorebook 条目。每条 content 头部可写 @@decorator（如 @@position after_desc / @@depth 4 / @@activate）与 CBS（如 {{char}}/{{random:A,B}}）。LLM 应在用户确认世界观后调用。",
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
      return { ok:true, added: args.entries.length, loreCount: cur.data.character_book.entries.length };
    }
  });

  ctx.tools.register({
    name: "cc_patch_greetings",
    description: "写入开场与示例对话。LLM 引导用户确定开场白后调用。",
    parameters: {
      type:"object",
      properties:{
        first_mes:{type:"string", description:"首条开场白"},
        alternate_greetings:{type:"array", items:{type:"string"}, description:"备选开场白数组"},
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
      return { ok:true, draft: cur };
    }
  });

  ctx.tools.register({
    name: "cc_validate",
    description: "校验当前 CC 角色卡是否符合 SPEC_V3，返回 errors/warnings。通过后可提醒用户在工坊点“导出 JSON”。",
    parameters: { type:"object", properties:{}, additionalProperties:false },
    output: out({ type:"object", additionalProperties:true }),
    async execute(args, exec){
      const d = getDraft(ctx, exec);
      const errors=[], warnings=[];
      if(!d.data.name) errors.push("缺 data.name");
      if(!Array.isArray(d.data.group_only_greetings)) errors.push("缺 group_only_greetings");
      if(!d.data.description) warnings.push("description 为空");
      if(d.data.character_book.entries.length===0) warnings.push("世界书为空");
      const valid = errors.length===0;
      return { valid, errors, warnings, loreCount: d.data.character_book.entries.length, name: d.data.name };
    }
  });
}

export { apply, inject, name };
