/**
 * @dsh-plugins/dsh-cc-studio — host half.
 * CCv3 工坊：校验 + 共享草稿（供 CC 模式的 LLM Tools 与浏览器胶囊同步）。
 * 胶囊默认 /cc 唤出逻辑已移除，CC 模式通过 Agent preset 暴露 Tools 供 LLM 引导填表。
 */
const name = "dsh-cc-studio";
const inject = ["connection", "agents", "agentPresets"];

function ok(value){ return { ok:true, value }; }
function fail(code, message, details={}){ return { ok:false, error:{ code:"internal", message, details:{...details, code} } }; }

// ---- CCv3 validation (minimal, matches SPEC_V3.md) ----
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
            // decorators: quick syntax check
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

// ---- AI helpers (mock + optional llm passthrough) ----
function mockExpandIdea(idea, tags){
  const t=(tags||[]).join("、") || "雨城、感官";
  return {
    description: `雨城常年细雨，霓虹在水膜上化开。基于点子“${idea.slice(0,24)}”，此处记忆被视为可交易的软资产，标签：${t}。`,
    personality: "外柔内韧，嗅觉共情，话少但记性极好；对“自愿”有执念，拒绝强行抽取。",
    scenario: "你推开吱呀木门，铃铛轻响，雨气混着蜡与旧纸味扑面而来。她在柜台后抬头，手中烛芯正袅袅成线。",
    worldDraft: {
      timeline: "2127 雨城独立后，记忆被列为可交易软资产，雨梯管理局成立",
      factions: "烛坊（记忆典当）/ 雨梯管理局（配给干燥）/ 盗忆人（被吊销执照的前调香师）",
      geo: "环形雨城：内环干燥、外环常雨，霓虹倒影是导航",
      power: "抽忆术需自愿+嗅觉天赋，银线密度=情绪强度",
      daily: "雨声电台、蜡烛夜市、记忆税、干燥配额抽签"
    }
  };
}
function mockWorldToLorebook(world){
  const w=world||{};
  const entries=[];
  let order=0;
  const push=(name, keys, content, priority, constant=false, use_regex=false)=>{
    entries.push({ keys: keys||[], content, enabled:true, insertion_order:order++, case_sensitive:false, use_regex, constant, name, priority, id: Date.now()+order });
  };
  if(w.timeline) push("年表", ["雨城","2127"], `@@position after_desc\n${w.timeline}`, 10);
  if(w.factions) push("势力", ["烛坊","雨梯","盗忆人"], `@@depth 4\n${w.factions}`, 9);
  if(w.geo) push("地理", ["雨城","雨梯","霓虹"], `@@position scenario\n${w.geo}`, 8);
  if(w.power) push("力量体系", ["抽忆","银线","蜡烛"], `@@activate\n${w.power}。闻香即重温，不可食用。`, 9, true);
  if(w.daily) push("日常", ["夜市","电台","记忆税"], `@@depth 5\n${w.daily}`, 7);
  // extra CBS example
  entries.push({ keys:["蜡烛"], content:"@@additional_keys 蜡烛,香薰\n烛体乳白，银线游动，{{random:微光,暖光,冷光}}随情绪变化。", enabled:true, insertion_order:order++, use_regex:false, constant:false, name:"蜡烛细节", priority:6 });
  return entries;
}

function nowSec(){ return Math.floor(Date.now()/1000); }
function makeDefaultDraft(){
  return {
    spec:"chara_card_v3", spec_version:"3.0",
    data:{
      name:"雨城烛坊 · 岚烟", nickname:"岚烟", tags:["记忆","雨城","香薰","典当"], creator:"you", character_version:"0.1",
      description:"雨城常年细雨，霓虹在水膜上化开。岚烟经营一家无招牌的记忆典当行，将客人的记忆抽丝封进蜡烛。",
      personality:"外柔内韧，嗅觉共情，话少但记性极好；对“自愿”有执念，拒绝强行抽取。",
      scenario:"你推开吱呀的木门，铃铛轻响，雨气混着蜡与旧纸味扑面而来。岚烟在柜台后抬头，手中烛芯正袅袅成线。",
      system_prompt:"You are 岚烟, keeper of memory candles. Reply in Chinese, sensory, restrained.",
      post_history_instructions:"保持蜡烛=记忆隐喻一致性，不主动破坏客人自愿原则。",
      first_mes:"“雨又大了。先烤烤手吧——想典当哪一段？” 她把一盏未点的乳白蜡烛推到你面前，烛体里有细细的银线游动。",
      alternate_greetings:["“今晚的雨适合想起旧人。你带记忆来了吗？”","“这盏是上周一位航行员留下的，里面有海风。”"],
      group_only_greetings:["（群聊限定）“诸位若同时点烛，记忆会串味——我得一盏一盏来。”"],
      mes_example:"{{user}}: 能把我5岁那年的夏夜还给我吗？\n{{char}}: 可以，但那段有蝉鸣和西瓜味，烧起来会很吵。你确定要现在闻吗？",
      creator_notes:"CC 模式示例草稿（由 LLM Tools 填充）", creator_notes_multilingual:{ en:"CC mode draft" }, source:[], assets:[{type:"icon", uri:"ccdefault:", name:"main", ext:"png"}],
      creation_date: nowSec(), modification_date: nowSec(),
      character_book:{ name:"雨城烛坊 lorebook", description:"随卡私有世界书", scan_depth:4, token_budget:1200, recursive_scanning:false, extensions:{}, entries:[
        {enabled:true, insertion_order:0, use_regex:false, constant:false, name:"雨城常雨", keys:["雨城","霓虹","潮气"], content:"@@position after_desc\n雨城年均降水 1800mm，排水系统以“雨梯”著称，霓虹倒影是导航。", priority:10, id:1},
        {enabled:true, insertion_order:1, use_regex:false, constant:true, name:"蜡烛=记忆", keys:[], content:"@@activate\n蜡烛即记忆容器，银线密度=情绪强度。闻香即重温，不可食用。", priority:9, id:2}
      ]}
    }
  };
}
if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map();
function draftKeyFrom(ctx, args){
  if(args && typeof args.sessionId==="string" && args.sessionId) return String(args.sessionId);
  try{
    const agents = ctx.get("agents");
    const ag = agents && agents.currentInitiator && agents.currentInitiator();
    if(ag && ag.id) return String(ag.id);
    if(ag && ag.sessionId) return String(ag.sessionId);
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
function isCcPreset(ctx){
  try{
    const agents = ctx.get("agents");
    const presets = ctx.get("agentPresets");
    if(!agents || !presets) return false;
    const ag = agents.currentInitiator && agents.currentInitiator();
    if(!ag) return false;
    const pid = presets.composedPreset(ag.ctx);
    return pid === "cc";
  }catch{ return false; }
}

function apply(ctx){
  // keep a ref for key helper that needs agents
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
          return ok({ isCc: isCcPreset(ctx) });
        }
        case "cc_getDraft":{
          const k = draftKeyFrom(ctx, args);
          const d = getDraftFor(k);
          return ok({ draft: d, key: k, isCc: isCcPreset(ctx) });
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
          // shallow merge for data fields that are patch keys
          // 支持: name/nickname/description/personality/scenario/system_prompt/post_history_instructions/first_mes/alternate_greetings/group_only_greetings/mes_example/tags/creator_notes/world (5维) / lorebookEntry
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
            // world 5维仅作提示，实际写入 lorebook 需用 lorebookEntry；这里仅保存到 extensions 供预览
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
        case "expandIdea":
        case "expandWorld":{
          // 保留兼容，但工坊已去掉 AI 按钮，CC 模式走 Tools
          return ok({ deprecated:true, message:"AI 直连已移除，请切换到 CC 模式让 LLM 通过 Tools 引导填表" });
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
