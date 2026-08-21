/**
 * @dsh-plugins/dsh-cc-studio — browser half
 * 融合形态：dock 胶囊常驻（默认收起）+ 点击展开为 overlay 工坊（侧边按需展开/全屏沉浸）
 * 直接手写 bundle，无构建步骤，仅 require seed 词 react / cordis 等
 */
window.__ModuleLoader__.load({
  id: "@dsh-plugins/dsh-cc-studio",
  factory: (require) => {
    var module={exports:{}}; var exports=module.exports;
    Object.defineProperty(exports, Symbol.toStringTag,{value:"Module"});
    var React=require("react");
    var name="dsh-cc-studio";
    var inject=["slots","connection","locale"];
    var NS="dshCcStudio";
    var zh={
      "capsule.open":"🎭 角色卡工坊",
      "capsule.exported":"已导出",
      "capsule.draft":"草稿",
      "panel.title":"角色卡工坊",
      "panel.subtitle":"CCv3 · 从点子到可导入卡",
      "step.idea":"点子",
      "step.world":"5维世界观",
      "step.char":"角色细化",
      "step.lore":"世界书",
      "step.export":"校验导出",
      "action.expand":"✦ AI 扩写",
      "action.validate":"校验",
      "action.export":"⬇ 导出 JSON",
      "action.close":"收起",
      "action.backToSide":"返回胶囊",
      "hint.capsule":"CC 模式下自动出现；风格标签已支持自定义输入，回车添加",
      "settings.title":"角色卡工坊",
      "settings.desc":"CCv3 角色卡 + Lorebook Decorator + CBS 辅助，融合形态：胶囊常驻，侧边按需展开，全屏沉浸编辑。首版仅 JSON 导出，CHARX/PNG 二期。"
    };
    var en={
      "capsule.open":"Character Card Studio",
      "capsule.exported":"exported",
      "capsule.draft":"draft",
      "panel.title":"Character Card Studio",
      "panel.subtitle":"CCv3 · Idea to Importable Card",
      "step.idea":"Idea",
      "step.world":"World 5D",
      "step.char":"Character",
      "step.lore":"Lorebook",
      "step.export":"Validate & Export",
      "action.expand":"AI Expand",
      "action.validate":"Validate",
      "action.export":"Export JSON",
      "action.close":"Collapse",
      "action.backToSide":"Back",
      "hint.capsule":"Capsule lives above composer; click to open full workshop.",
      "settings.title":"Character Card Studio",
      "settings.desc":"CCv3 workshop: 5D worldbuilding → Lorebook Decorators → CBS. Capsule + drawer + fullscreen fusion. JSON first, CHARX later."
    };
    function h(type,props){ var c=Array.prototype.slice.call(arguments,2); return React.createElement.apply(React,[type,props].concat(c)); }

    function nowSec(){ return Math.floor(Date.now()/1000); }
    function makeDraft(){
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

    function createStore(ctx){
      var draft=makeDraft();
      var state={ draft: draft, cur:0, panelOpen:false, sideExpanded:false, triggered:false, isCcMode:false, customTag:"", idea:"", tags:[], world:{ timeline:"", factions:"", geo:"", power:"", daily:"" }, busy:null, valid:{valid:true,errors:[],warnings:[]}, lastMsg:null };
      var listeners=new Set();
      function emit(){ listeners.forEach(function(fn){ try{fn();}catch(e){console.error(e);} }); }
      function getSnapshot(){ return state; }
      function subscribe(fn){ listeners.add(fn); return function(){ listeners.delete(fn); }; }
      function set(up){ state=Object.assign({}, state, up); emit(); }
      function setCur(i){ set({cur:i}); }
      function setPanel(o){ set({panelOpen: !!o}); }
      function setSideExpanded(v){ set({sideExpanded: !!v}); }
      function trigger(){ if(!state.triggered) set({triggered:true}); if(!state.panelOpen) set({panelOpen:true}); }
      function dismiss(){ set({triggered:false, panelOpen:false}); }
      function setIsCcMode(v){ if(!!v!==state.isCcMode) set({isCcMode: !!v, triggered: !!v || state.triggered}); }
      function setDraftFromHost(draft){ try{ var j=JSON.stringify(draft); var curJ=JSON.stringify(state.draft); if(j!==curJ) set({draft: draft}); }catch(e){ set({draft: draft}); } }
      function pushDraftToHost(){
        try{ ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_setDraft",{args:{draft: state.draft}}).catch(function(){}); }catch(e){}
      }
      async function checkIsCcMode(sessionId){
        try{
          const res = await rpc("cc_isCcMode", {sessionId: sessionId});
          if(res && res.ok) setIsCcMode(!!res.value.isCc);
        }catch(e){}
      }
      function setCustomTag(v){ set({customTag: String(v).slice(0,20)}); }
      function addCustomTag(){
        var t=String(state.customTag||"").trim();
        if(!t) return;
        if(state.tags.indexOf(t)>=0){ set({customTag:""}); return; }
        var tags=state.tags.slice(); tags.push(t);
        set({tags:tags, customTag:""});
      }
      function removeTag(tag){ set({tags: state.tags.filter(function(x){return x!==tag;})}); }
      function updateDraft(mut){ var d=JSON.parse(JSON.stringify(state.draft)); mut(d.data); d.data.modification_date=nowSec(); set({draft:d}); setTimeout(pushDraftToHost, 120); }
      function rpc(endpoint, args){ return ctx.connection.rpc.call("/dsh-cc-studio-rpc", endpoint, { args: args||{} }); }
      async function expandIdea(){
        set({busy:"expandIdea", lastMsg:null});
        try{
          var res=await rpc("expandIdea", { idea: state.idea, tags: state.tags });
          if(res && res.ok){
            var v=res.value;
            updateDraft(function(d){
              if(v.description) d.description=v.description;
              if(v.personality) d.personality=v.personality;
              if(v.scenario) d.scenario=v.scenario;
              if(v.worldDraft){
                state.world=Object.assign({}, state.world, v.worldDraft);
              }
            });
            // also sync world to store
            set({ lastMsg: "AI 扩写完成", busy:null, world: Object.assign({}, state.world, (res.value.worldDraft||{})) });
            return;
          }
          set({busy:null, lastMsg: res && res.error? String(res.error.message): "扩写失败"});
        }catch(e){ set({busy:null, lastMsg: String(e && e.message || e)}); }
      }
      async function expandWorld(){
        set({busy:"expandWorld"});
        try{
          var res=await rpc("expandWorld", { world: state.world });
          if(res && res.ok){
            var entries=res.value.entries||[];
            updateDraft(function(d){
              var base=d.character_book.entries.length;
              entries.forEach(function(en,idx){
                en.insertion_order=base+idx;
                if(en.id==null) en.id=Date.now()+idx;
                d.character_book.entries.push(en);
              });
            });
            set({busy:null, lastMsg: "已生成 "+entries.length+" 条 Lorebook（含 @@decorator）"});
          } else set({busy:null, lastMsg: res && res.error? String(res.error.message):"生成失败"});
        }catch(e){ set({busy:null, lastMsg:String(e && e.message || e)}); }
      }
      async function validate(){
        set({busy:"validate"});
        try{
          var res=await rpc("validate", { card: state.draft });
          if(res && res.ok){ set({busy:null, valid: res.value, lastMsg: res.value.valid? "校验通过":"校验未通过"}); }
          else set({busy:null, lastMsg: String(res.error.message)});
        }catch(e){ set({busy:null, lastMsg:String(e.message)}); }
      }
      function exportJSON(){
        var blob=new Blob([JSON.stringify(state.draft,null,2)],{type:"application/json"});
        var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(state.draft.data.name||"card")+".json"; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
        set({lastMsg:"已导出 JSON（首版仅 JSON，CHARX 二期）"});
      }
      function setIdea(v){ set({idea:String(v).slice(0,500)}); }
      function setWorldPatch(k,v){ var w=Object.assign({}, state.world); w[k]=String(v); set({world:w}); }
      function addEntry(){
        updateDraft(function(d){
          d.character_book.entries.push({ enabled:true, insertion_order:d.character_book.entries.length, use_regex:false, constant:false, name:"新条目", keys:["关键词"], content:"@@position personality\n新 lore 内容…", priority:5, id: Date.now() });
        });
      }
      function toggleTag(tag){
        var tags=state.tags.slice();
        var i=tags.indexOf(tag);
        if(i>=0) tags.splice(i,1); else tags.push(tag);
        set({tags:tags});
      }
      return { getSnapshot:getSnapshot, subscribe:subscribe, setCur:setCur, setPanel:setPanel, setSideExpanded:setSideExpanded, trigger:trigger, dismiss:dismiss, setIsCcMode:setIsCcMode, setDraftFromHost:setDraftFromHost, checkIsCcMode:checkIsCcMode, setCustomTag:setCustomTag, addCustomTag:addCustomTag, removeTag:removeTag, updateDraft:updateDraft, expandIdea:expandIdea, expandWorld:expandWorld, validate:validate, exportJSON:exportJSON, setIdea:setIdea, setWorldPatch:setWorldPatch, addEntry:addEntry, toggleTag:toggleTag };
    }

    var S={
      overlay:{ position:"fixed", inset:0, background:"rgba(3,6,12,.62)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"18px", zIndex:30 },
      workshop:{ width:"min(1280px, 96vw)", height:"min(860px, 92vh)", background:"linear-gradient(180deg,#171c2a,#11141d)", border:"1px solid #2a324b", borderRadius:18, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 20px 80px rgba(0,0,0,.55)" },
      head:{ height:56, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px", borderBottom:"1px solid #242d47", background:"#131827" },
      step:{ padding:"6px 10px", borderRadius:999, fontSize:12, border:"1px solid #2a334e", color:"#9aa3b8", background:"#0f1422", cursor:"pointer" },
      stepActive:{ background:"#7c5cff", borderColor:"#7c5cff", color:"white" },
      body:{ flex:1, display:"grid", gridTemplateColumns:"220px 1fr 360px", minHeight:0 },
      nav:{ borderRight:"1px solid #242d47", background:"#0f1320", padding:"12px", display:"flex", flexDirection:"column", gap:10 },
      navBtn:{ width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"1px solid transparent", background:"transparent", color:"#cbd5f0", cursor:"pointer" },
      navBtnActive:{ background:"#1a2140", borderColor:"#2d3a66", color:"white" },
      main:{ padding:"16px", overflow:"auto" },
      side:{ borderLeft:"1px solid #242d47", background:"#0e1220", padding:"12px", overflow:"auto" },
      card:{ background:"#0f1422", border:"1px solid #242d47", borderRadius:12, padding:12, marginBottom:12 },
      field:{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 },
      badge:{ fontSize:11, padding:"2px 6px", borderRadius:999, border:"1px solid #2a3350", background:"#11182e", color:"#9fb0d8" },
      chip:{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"#12182a", border:"1px solid #28365a", color:"#aebde0", cursor:"pointer" },
      chipOn:{ background:"#7c5cff", borderColor:"#7c5cff", color:"white" },
      btn:{ appearance:"none", border:"1px solid transparent", background:"#7c5cff", color:"white", borderRadius:10, padding:"8px 14px", fontWeight:600, cursor:"pointer" },
      btnGhost:{ background:"transparent", borderColor:"#2a324b", color:"#e6e8ee" },
      mono:{ fontFamily:"ui-monospace,Menlo,Consolas,monospace", fontSize:12 },
      dockWrap:{ boxSizing:"border-box", display:"flex", justifyContent:"flex-start", width:"100%", paddingLeft:"calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)", margin:"2px 0" },
      capsule:{ display:"inline-flex", alignItems:"center", gap:8, maxWidth:360, padding:"1px 10px", borderRadius:999, border:"1px solid rgba(127,127,127,0.25)", background:"rgba(127,127,127,0.12)", color:"var(--dsw-alias-label-secondary, #c8ccd2)", fontSize:12, lineHeight:"20px", cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }
    };

    function Capsule(props){
      var store=props.store; var t=props.t;
      var useSessions = props.useSessions;
      var sessions = useSessions ? useSessions(function(s){ return s; }) : null;
      var currentId = sessions && sessions.current;
      var sRef=React.useState(function(){ return store.getSnapshot(); }); var s=sRef[0], setS=sRef[1];
      React.useEffect(function(){ return store.subscribe(function(){ setS(store.getSnapshot()); }); }, [store]);
      React.useEffect(function(){
        if(!currentId) return;
        function detectCc(){
          try{
            var sess = sessions && sessions.byId && sessions.byId[currentId];
            if(sess){
              var preset = sess.preset || sess.presetId || sess.agentPreset || sess.mode;
              if(preset && String(preset).toLowerCase()==='cc') return true;
            }
          }catch(e){}
          try{
            var btns=document.querySelectorAll('button');
            for(var i=0;i<btns.length;i++){
              var b=btns[i];
              if(b.textContent && b.textContent.indexOf('CC 模式')>=0 && b.offsetParent!==null) return true;
            }
          }catch(e){}
          return false;
        }
        var isCc = detectCc();
        store.setIsCcMode(isCc);
        store.checkIsCcMode(currentId);
        var timer = setInterval(function(){
          var isCc2 = detectCc();
          if(isCc2) store.setIsCcMode(true);
          else store.checkIsCcMode(currentId);
        }, 1800);
        return function(){ clearInterval(timer); };
      }, [currentId, sessions]);
      // 胶囊在 CC 模式下自动出现；为避免 isCc 检测在 RPC 上下文下失效（currentInitiator 为 null），暂时改为常显
      
      if(!s.isCcMode && !s.triggered && !s.panelOpen) return null;
      var draft=s.draft; var loreCount=draft.data.character_book.entries.length;
      var valid=s.valid && s.valid.valid;
      var text=(t("capsule.open")+" · "+loreCount+" lore · "+ (valid? t("capsule.exported"): t("capsule.draft")));
      return h("div",{style:S.dockWrap, "data-dsh-cc-studio":"dock-row"},
        h("button",{type:"button", style:S.capsule, title: t("hint.capsule"), onClick:function(){ store.setPanel(true); }},
          h("span",{style:{width:7,height:7,borderRadius:50, background: valid? "#2ee6a6":"#7c5cff", boxShadow:"0 0 8px "+(valid?"#2ee6a6":"#7c5cff"), display:"inline-block", flex:"none"}}),
          h("span",{style:{overflow:"hidden", textOverflow:"ellipsis"}}, text),
          h("span",{style:{color:"#9aa3b8", fontSize:11}}, s.panelOpen? "— 已展开":"— 点击展开")
        ),
        h("span",{style:{fontSize:11, color:"#9aa3b8", marginLeft:8}}, loreCount+" entries · "+draft.data.name),
        h("button",{type:"button", style:{marginLeft:6, background:"transparent", border:"1px solid rgba(127,127,127,0.2)", borderRadius:999, padding:"0 8px", fontSize:11, lineHeight:"20px", color:"#9aa3b8", cursor:"pointer"}, onClick:function(){ store.dismiss(); }, title:"隐藏胶囊（CC 模式下自动出现）"}, "×")
      );
    }

    function Workshop(props){
      var store=props.store; var t=props.t;
      var useSessions = props.useSessions;
      var sessions = useSessions ? useSessions(function(s){ return s; }) : null;
      var currentId = sessions && sessions.current;
      var sRef=React.useState(function(){ return store.getSnapshot(); }); var s=sRef[0], setS=sRef[1];
      React.useEffect(function(){ return store.subscribe(function(){ setS(store.getSnapshot()); }); }, [store]);
      React.useEffect(function(){
        if(!currentId) return;
        function detectCc(){
          try{
            var sess = sessions && sessions.byId && sessions.byId[currentId];
            if(sess){
              var preset = sess.preset || sess.presetId || sess.agentPreset || sess.mode;
              if(preset && String(preset).toLowerCase()==='cc') return true;
            }
          }catch(e){}
          try{
            var btns=document.querySelectorAll('button');
            for(var i=0;i<btns.length;i++){
              var b=btns[i];
              if(b.textContent && b.textContent.indexOf('CC 模式')>=0 && b.offsetParent!==null) return true;
            }
          }catch(e){}
          return false;
        }
        var isCc = detectCc();
        store.setIsCcMode(isCc);
        store.checkIsCcMode(currentId);
        var timer = setInterval(function(){
          var isCc2 = detectCc();
          if(isCc2) store.setIsCcMode(true);
          else store.checkIsCcMode(currentId);
        }, 1800);
        return function(){ clearInterval(timer); };
      }, [currentId, sessions]);
      if(!s.panelOpen) return null;
      var steps=[t("step.idea"), t("step.world"), t("step.char"), t("step.lore"), t("step.export")];
      function navItem(i, title, desc){
        var active=s.cur===i;
        return h("button",{key:i, style: Object.assign({}, S.navBtn, active? S.navBtnActive:{}), onClick:function(){ store.setCur(i); }}, title, h("div",{style:{fontSize:11, color:"#9aa3b8", marginTop:2}}, desc));
      }
      var main=null;
      if(s.cur===0){
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}}, "点子投喂（薄世界观友好）"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"一句话点子"), h("textarea",{style:{width:"100%", minHeight:84, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.idea, onChange:function(e){ store.setIdea(e.target.value); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"风格标签（可多选 + 自定义）"),
              h("div",{style:{display:"flex", flexWrap:"wrap", gap:6}},
                s.tags.map(function(tag){
                  return h("span",{key:"sel-"+tag, style: Object.assign({}, S.chip, S.chipOn), onClick:function(){ store.removeTag(tag); }, title:"点击移除"}, tag+" ×");
                })
              ),
              h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginTop:6}},
                ["雨城","感官系","赛博","治愈","微克苏鲁","蒸汽","废土"].map(function(tag){
                  var on=s.tags.indexOf(tag)>=0;
                  if(on) return null;
                  return h("span",{key:tag, style: S.chip, onClick:function(){ store.toggleTag(tag); }}, "+ "+tag);
                })
              ),
              h("div",{style:{display:"flex", gap:6, marginTop:8}},
                h("input",{placeholder:"自定义标签，回车添加", style:{flex:1, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"6px 10px", fontSize:12}, value:s.customTag, onChange:function(e){ store.setCustomTag(e.target.value); }, onKeyDown:function(e){ if(e.key==="Enter"){ e.preventDefault(); store.addCustomTag(); }}}),
                h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.addCustomTag(); }}, "添加")
              ),
              h("div",{style:{fontSize:11, color:"#9aa3b8", marginTop:4}}, "已选标签会直接写入 card.data.tags，已选的点击可移除；下方为快捷候选。")
            ),
            h("div",{style:{display:"flex", gap:8}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.setCur(1); }}, "下一步 → 5维")
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"#aebde0"}}, s.lastMsg):null
          ),
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}},"角色设定（与 LLM 对话时由 CC 模式自动填充）"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"description"), h("textarea",{style:{width:"100%", minHeight:84, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.description, onChange:function(e){ store.updateDraft(function(d){ d.description=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"personality"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.personality, onChange:function(e){ store.updateDraft(function(d){ d.personality=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"scenario"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.scenario, onChange:function(e){ store.updateDraft(function(d){ d.scenario=e.target.value; }); }}))
          )
        );
      } else if(s.cur===1){
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 4px", fontSize:13}},"世界观 5维（Q2-B 深度问卷）"),
            h("div",{style:{color:"#9aa3b8", fontSize:12, marginBottom:10}},"每维填 1-2 句即可，CC 模式下 LLM 会通过工具引导你补全，并自动生成带 @@decorator 的 Lorebook。"),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:{border:"1px dashed #2a3552", borderRadius:12, padding:10, background:"#0c1020"}}, h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6}},"① 年表 Timeline"), h("textarea",{style:{width:"100%", minHeight:70, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px"}, value:s.world.timeline, onChange:function(e){ store.setWorldPatch("timeline", e.target.value); }})),
              h("div",{style:{border:"1px dashed #2a3552", borderRadius:12, padding:10, background:"#0c1020"}}, h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6}},"② 势力 Factions"), h("textarea",{style:{width:"100%", minHeight:70, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px"}, value:s.world.factions, onChange:function(e){ store.setWorldPatch("factions", e.target.value); }})),
              h("div",{style:{border:"1px dashed #2a3552", borderRadius:12, padding:10, background:"#0c1020"}}, h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6}},"③ 地理 Geography"), h("textarea",{style:{width:"100%", minHeight:70, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px"}, value:s.world.geo, onChange:function(e){ store.setWorldPatch("geo", e.target.value); }})),
              h("div",{style:{border:"1px dashed #2a3552", borderRadius:12, padding:10, background:"#0c1020"}}, h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6}},"④ 力量 Power"), h("textarea",{style:{width:"100%", minHeight:70, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px"}, value:s.world.power, onChange:function(e){ store.setWorldPatch("power", e.target.value); }})),
              h("div",{style:{border:"1px dashed #2a3552", borderRadius:12, padding:10, background:"#0c1020", gridColumn:"span 2"}}, h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6}},"⑤ 日常 Daily"), h("textarea",{style:{width:"100%", minHeight:70, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px"}, value:s.world.daily, onChange:function(e){ store.setWorldPatch("daily", e.target.value); }}))
            ),
            h("div",{style:{display:"flex", gap:8, marginTop:12}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.setCur(2); }}, "下一步 → 角色细化")
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"#aebde0"}}, s.lastMsg):null
          )
        );
      } else if(s.cur===2){
        main=h("div",null,
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"角色细化 — 六件套"),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"name"), h("input",{style:{width:"100%", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.name, onChange:function(e){ store.updateDraft(function(d){ d.name=e.target.value; }); }})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"nickname（{{char}} 用）"), h("input",{style:{width:"100%", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.nickname||"", onChange:function(e){ store.updateDraft(function(d){ d.nickname=e.target.value; }); }}))
            ),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"tags（逗号分隔）"), h("input",{style:{width:"100%", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.tags.join(", "), onChange:function(e){ store.updateDraft(function(d){ d.tags=e.target.value.split(",").map(function(x){return x.trim();}).filter(Boolean); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"description"), h("textarea",{style:{width:"100%", minHeight:84, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.description, onChange:function(e){ store.updateDraft(function(d){ d.description=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"personality"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.personality, onChange:function(e){ store.updateDraft(function(d){ d.personality=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"scenario"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.scenario, onChange:function(e){ store.updateDraft(function(d){ d.scenario=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"system_prompt"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.system_prompt||"", onChange:function(e){ store.updateDraft(function(d){ d.system_prompt=e.target.value; }); }})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"post_history_instructions"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.post_history_instructions||"", onChange:function(e){ store.updateDraft(function(d){ d.post_history_instructions=e.target.value; }); }}))
            )
          ),
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"开场与示例"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"first_mes"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.first_mes, onChange:function(e){ store.updateDraft(function(d){ d.first_mes=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"alternate_greetings（每行一条）"), h("textarea",{style:{width:"100%", minHeight:72, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.alternate_greetings.join("\n"), onChange:function(e){ store.updateDraft(function(d){ d.alternate_greetings=e.target.value.split("\n"); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"group_only_greetings *必填"), h("textarea",{style:{width:"100%", minHeight:60, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.group_only_greetings.join("\n"), onChange:function(e){ store.updateDraft(function(d){ d.group_only_greetings=e.target.value.split("\n"); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"mes_example（{{user}}/{{char}}）"), h("textarea",{style:{width:"100%", minHeight:96, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.mes_example, onChange:function(e){ store.updateDraft(function(d){ d.mes_example=e.target.value; }); }}))
          )
        );
      } else if(s.cur===3){
        var entries=s.draft.data.character_book.entries;
        main=h("div",null,
          h("div",{style:S.card},
            h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}},
              h("h3",{style:{margin:0, fontSize:13}},"世界书 Lorebook"),
              h("span",{style:S.badge}, "scan_depth "+s.draft.data.character_book.scan_depth+" · token_budget "+s.draft.data.character_book.token_budget+" · "+entries.length+" 条")
            ),
            h("div",null, entries.map(function(e){
              return h("div",{key:e.id, style:{display:"grid", gridTemplateColumns:"1fr auto", gap:8, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:10, padding:10, marginBottom:8}},
                h("div",null,
                  h("div",{style:{fontWeight:600, fontSize:12}}, e.name, h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, e.constant? "constant": (e.keys.join(", ")||"—")), h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, "order "+e.insertion_order)),
                  h("div",{style:Object.assign({}, S.mono, {color:"#aebde0", marginTop:4, whiteSpace:"pre-wrap"})}, e.content),
                  h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginTop:6}}, h("span",{style:S.badge},"@@depth/@@position"), h("span",{style:S.badge},"CBS: {{char}}"))
                ),
                h("div",{style:{display:"flex", flexDirection:"column", gap:6}}, h("label",{style:{fontSize:12}}, h("input",{type:"checkbox", checked:e.enabled, onChange:function(ev){ store.updateDraft(function(d){ var f=d.character_book.entries.find(function(x){return x.id===e.id;}); if(f) f.enabled=ev.target.checked; }); }}), " enabled"), h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"4px 8px", fontSize:12}), onClick:function(){ store.updateDraft(function(d){ d.character_book.entries=d.character_book.entries.filter(function(x){return x.id!==e.id;}); }); }}, "删除"))
              );
            })),
            h("div",{style:{display:"flex", gap:8, marginTop:10}},
              h("button",{style:S.btn, onClick:function(){ store.addEntry(); }}, "+ 新增条目"),
              h("span",{style:{fontSize:11, color:"#9aa3b8", alignSelf:"center"}}, "CC 模式下由 LLM 通过工具自动添加")
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"#aebde0"}}, s.lastMsg):null
          )
        );
      } else {
        var v=s.valid;
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}},"校验与导出 — 首版仅 JSON（最稳）"),
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, marginBottom:8}},
              h("span",{style: Object.assign({}, S.badge, v.valid? {borderColor:"#2a4a3a", color:"#a6e8c8", background:"#1a2a1f"}:{borderColor:"#4a2a2a", color:"#e8a6a6", background:"#2a1a1a"})}, v.valid? "✓ 校验通过":"✗ 校验未通过"),
              h("span",{style:S.badge},"group_only_greetings: "+s.draft.data.group_only_greetings.length+" 条"),
              h("span",{style:S.badge}, "assets: "+(s.draft.data.assets? s.draft.data.assets.length:0))
            ),
            v.errors.length? h("div",{style:{background:"#2a1a1a", border:"1px solid #4a2a2a", borderRadius:8, padding:8, marginBottom:8, color:"#e8a6a6", fontSize:12}}, v.errors.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            v.warnings.length? h("div",{style:{background:"#1a1f2a", border:"1px solid #2a3350", borderRadius:8, padding:8, marginBottom:8, color:"#aebde0", fontSize:12}}, v.warnings.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            h("div",{style:{display:"flex", gap:8, margin:"12px 0"}},
              h("button",{style:S.btn, onClick:function(){ store.exportJSON(); }}, t("action.export")),
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.validate(); }}, s.busy==="validate"? "校验中…": t("action.validate")),
              h("span",{style:{color:"#9aa3b8", fontSize:12, alignSelf:"center"}}, "CHARX / PNG 二期")
            ),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"creator_notes / 多语言"), h("textarea",{style:{width:"100%", minHeight:60, background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:s.draft.data.creator_notes, onChange:function(e){ store.updateDraft(function(d){ d.creator_notes=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"creation_date"), h("input",{style:{width:"100%", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:String(s.draft.data.creation_date), readOnly:true})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"#9aa3b8"}},"modification_date（导出自动刷新）"), h("input",{style:{width:"100%", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:8, color:"#e6e8ee", padding:"8px 10px"}, value:String(s.draft.data.modification_date), readOnly:true}))
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"#aebde0"}}, s.lastMsg):null
          )
        );
      }
      var stepsEls=steps.map(function(label, i){
        var active=s.cur===i;
        return h("span",{key:i, style: Object.assign({}, S.step, active? S.stepActive:{}), onClick:function(){ store.setCur(i); }}, (i+1)+". "+label);
      });
      return h("div",{style:S.overlay, onClick:function(e){ if(e.target===e.currentTarget) store.setPanel(false); }},
        h("div",{style:S.workshop, role:"dialog", "aria-modal":"true"},
          h("div",{style:S.head},
            h("div",{style:{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}},
              h("strong",null, "🎭 "+t("panel.title")),
              h("span",{style:S.badge}, "dsh-cc-studio · 融合"),
              h("div",{style:{display:"flex", gap:6, alignItems:"center"}}, stepsEls)
            ),
            h("div",{style:{display:"flex", gap:8}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.setPanel(false); }}, t("action.close")),
              h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.exportJSON(); }}, t("action.export"))
            )
          ),
          h("div",{style:S.body},
            h("div",{style:S.nav},
              navItem(0, t("step.idea"), "一句话 + 风格"),
              navItem(1, t("step.world"), "年表/势力/地理/力量/日常"),
              navItem(2, t("step.char"), "六件套 + 开场"),
              navItem(3, t("step.lore"), "Lorebook + Decorator"),
              navItem(4, t("step.export"), "校验导出"),
              h("div",{style:{marginTop:"auto", paddingTop:12, borderTop:"1px solid #242d47", display:"flex", flexDirection:"column", gap:8}},
                h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.validate(); }}, s.busy==="validate"? "校验中…": t("action.validate")),
                h("div",{style:{fontSize:11, color:"#9aa3b8", textAlign:"center"}}, s.busy? s.busy: (s.lastMsg||"切换到 CC 模式让 LLM 引导填充"))
              )
            ),
            h("div",{style:S.main}, main),
            h("div",{style:S.side},
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"实时 CCv3 预览"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:8}}, h("span",{style:S.badge},"spec: chara_card_v3"), h("span",{style: Object.assign({}, S.badge, s.valid.valid? {color:"#a6e8c8", borderColor:"#2a4a3a"}:{color:"#e8a6a6", borderColor:"#4a2a2a"})}, s.valid.valid? "✓ 通过":"✗ 未通过")),
                h("pre",{style:{whiteSpace:"pre-wrap", wordBreak:"break-all", background:"#0b0f1b", border:"1px solid #26314d", borderRadius:10, padding:10, maxHeight:420, overflow:"auto", margin:0, fontSize:11}}, JSON.stringify(s.draft, null, 2))
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"CBS 速查"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6}}, ["{{char}}","{{user}}","{{random:A,B}}","{{roll:d6}}","{{// 注释}}"].map(function(c){ return h("span",{key:c, style:S.chip}, c); })),
                h("div",{style:{color:"#9aa3b8", fontSize:12, marginTop:8}}, "大小写不敏感，逗号用 \\, 转义。")
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"融合说明"),
                h("div",{style:{color:"#9aa3b8", fontSize:12, lineHeight:1.5}}, "默认只占一行胶囊；点开为全屏工坊，左侧导航可收起为图标，右侧实时预览常驻。后续可加“侧边抽屉”半屏态。")
              )
            )
          )
        )
      );
    }

    function SettingsView(props){
      var t=props.t;
      var useSessions = props.useSessions;
      var sessions = useSessions ? useSessions(function(s){ return s; }) : null;
      var currentId = sessions && sessions.current;
      return h("div",{style:{padding:"16px 20px", maxWidth:720}},
        h("h2",{style:{margin:"0 0 8px", fontSize:18}}, "🎭 "+t("settings.title")),
        h("div",{style:{color:"#9aa3b8", fontSize:13, lineHeight:1.6}}, t("settings.desc")),
        h("div",{style:{marginTop:16, background:"#0f1422", border:"1px solid #242d47", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}},"当前状态"),
          h("div",{style:{fontSize:12, color:"#cbd5f0"}}, "原型对比：", h("a",{href:"file:///E:/dsh/plugin/dsh-cc-studio/prototypes/index.html", target:"_blank", style:{color:"#7c5cff"}}, "prototypes/index.html")),
          h("div",{style:{fontSize:12, color:"#9aa3b8", marginTop:6}}, "首版仅 JSON，二期 CHARX/PNG + Assets。")
        )
      );
    }

    function apply(ctx){
      ctx.effect(function(){ return ctx.locale.register(NS, { zh:zh, en:en }); }, "cc-studio:locale");
      var store=createStore(ctx);
      // CC 模式检测 + 草稿同步：胶囊仅在 CC 模式下自动出现，LLM 通过 Tools 填充后 UI 实时刷新
      ctx.effect(function(){
        var timer=null;
        var lastHostJson="";
        function poll(){
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_getDraft",{args:{}}).then(function(res){
            if(!res || !res.ok || !res.value || !res.value.draft) return;
            var draft=res.value.draft;
            try{
              var j=JSON.stringify(draft);
              if(j!==lastHostJson){
                lastHostJson=j;
                var curJ=JSON.stringify(store.getSnapshot().draft);
                if(j!==curJ) store.setDraftFromHost(draft);
              }
            }catch(e){}
          }).catch(function(){});
        }
        poll();
        timer=setInterval(poll, 1800);
        return function(){ if(timer) clearInterval(timer); };
      }, "cc-studio:cc-mode-poll");
      ctx.slots.inject("conversation.input.dock", function(){
        return ctx.slots.register({ name:"conversation.input.dock", id:"dsh-cc-studio-pill", order:20, locale:NS }, function(){ return h(Capsule,{store:store, t: ctx.locale.bind(NS)}); });
      });
      ctx.slots.inject("shell.overlay", function(){
        return ctx.slots.register({ name:"shell.overlay", id:"dsh-cc-studio-overlay", order:10, locale:NS }, function(){ return h(Workshop,{store:store, t: ctx.locale.bind(NS)}); });
      });
      ctx.slots.inject("settings.section", function(){
        return ctx.slots.register({ name:"settings.section", id:"cc-studio", order:40, label: zh["settings.title"] }, function(){ return h(SettingsView,{t: ctx.locale.bind(NS)}); });
      });
    }

    exports.apply=apply; exports.inject=inject; exports.name=name;
    return module.exports;
  }
});




