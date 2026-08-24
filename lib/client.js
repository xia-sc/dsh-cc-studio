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
      var state={ draft: draft, cur:0, panelOpen:false, sideExpanded:false, triggered:false, isCcMode:false, currentSessionId:null, customTag:"", idea:"", tags:[], world:{ timeline:"", factions:"", geo:"", power:"", daily:"" }, busy:null, valid:{valid:true,errors:[],warnings:[]}, lastMsg:null, library:[], libraryQuery:"", libraryCollapsed:false, libraryBusy:null, currentLibraryId:null, editingWorld:null };
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
      function setIsCcMode(v){ var on=!!v; if(on!==state.isCcMode) set({isCcMode: on, triggered: on}); }
      function setDraftFromHost(draft){ try{ var j=JSON.stringify(draft); var curJ=JSON.stringify(state.draft); if(j!==curJ){ var w=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(w && typeof w==="object"){ var nw={ timeline:String(w.timeline||""), factions:String(w.factions||""), geo:String(w.geo||""), power:String(w.power||""), daily:String(w.daily||"") }; var curW=state.world; if(JSON.stringify(nw)!==JSON.stringify(curW)) set({draft: draft, world: nw}); else set({draft: draft}); } else set({draft: draft}); } }catch(e){ try{ var ww=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(ww){ var nn={ timeline:String(ww.timeline||""), factions:String(ww.factions||""), geo:String(ww.geo||""), power:String(ww.power||""), daily:String(ww.daily||"") }; set({draft: draft, world: nn}); } else set({draft: draft}); }catch(e2){ set({draft: draft}); } } }
      function setSessionId(id){ if(id) set({currentSessionId: String(id)}); }
      function pushDraftToHost(){
        try{
          var sid = state.currentSessionId || null;
          var args = sid ? {draft: state.draft, sessionId: sid} : {draft: state.draft};
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_setDraft",{args:args}).catch(function(){});
        }catch(e){}
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
      function setWorldPatch(k,v){ var w=Object.assign({}, state.world); w[k]=String(v); set({world:w}); updateDraft(function(d){ d.extensions=d.extensions||{}; var cw=d.extensions.cc_world||{}; cw[k]=String(v); d.extensions.cc_world=cw; }); }
      function setEditingWorld(k){ set({editingWorld: k||null}); }
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
      function setLibraryQuery(v){ set({libraryQuery: String(v).slice(0,40)}); }
      function toggleLibraryCollapsed(){ set({libraryCollapsed: !state.libraryCollapsed}); }
      async function refreshLibrary(){
        set({libraryBusy:"refresh"});
        try{
          var res=await rpc("cc_listLibrary", {});
          if(res && res.ok && res.value && Array.isArray(res.value.entries)) set({library: res.value.entries});
          else set({library: []});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function saveCurrentToLibrary(){
        if(!state.draft || !state.draft.data || !state.draft.data.name || !String(state.draft.data.name).trim()){
          set({lastMsg:"请先填写角色名（name）再保存"});
          return;
        }
        set({libraryBusy:"save"});
        try{
          var sid=state.currentSessionId || null;
          var isUpdate = !!state.currentLibraryId;
          var args = {draft: state.draft};
          if(sid) args.sessionId=sid;
          if(isUpdate) args.id=state.currentLibraryId;
          var res=await rpc("cc_saveToLibrary", args);
          if(res && res.ok){
            set({lastMsg:(isUpdate?"已更新：":"已保存到侧边栏：")+(res.value.meta.name||res.value.id), currentLibraryId: res.value.id});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):"保存失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function saveAsNewToLibrary(){
        if(!state.draft || !state.draft.data || !state.draft.data.name || !String(state.draft.data.name).trim()){
          set({lastMsg:"请先填写角色名（name）再保存"});
          return;
        }
        set({libraryBusy:"saveNew"});
        try{
          var sid2=state.currentSessionId || null;
          var args2 = {draft: state.draft};
          if(sid2) args2.sessionId=sid2;
          // 不带 id，强制新建
          var res=await rpc("cc_saveToLibrary", args2);
          if(res && res.ok){
            set({lastMsg:"已另存为新卡："+(res.value.meta.name||res.value.id), currentLibraryId: res.value.id});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):"另存失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      function clearCurrentLibraryId(){ set({currentLibraryId:null, lastMsg:"已切换为新卡（保存将新建）"}); }
      async function loadFromLibrary(id){
        if(!id) return;
        try{
          var curName=String(state.draft.data.name||"").trim();
          if(curName && state.draft.data.character_book.entries.length>0){
          }
        }catch(e){}
        set({libraryBusy:"load:"+id});
        try{
          var sid=state.currentSessionId||null;
          var args = sid ? {id:id, sessionId:sid} : {id:id};
          var res=await rpc("cc_loadFromLibrary", args);
          if(res && res.ok && res.value && res.value.draft){
            setDraftFromHost(res.value.draft);
            set({currentLibraryId: id});
            set({lastMsg:"已载入："+(res.value.meta.name||id)+" · "+(res.value.draft.data.character_book.entries.length||0)+" lore（ID:"+id.slice(0,8)+"，再次保存将更新此卡）"});
          } else set({lastMsg: res && res.error? String(res.error.message):"载入失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function deleteFromLibrary(id){
        if(!id) return;
        try{
          if(typeof window!=="undefined" && window.confirm){
            var ok = window.confirm("确定删除该角色？此操作不可撤销。");
            if(!ok) return;
          }
        }catch(e){}
        set({libraryBusy:"delete:"+id});
        try{
          var res=await rpc("cc_deleteFromLibrary", {id:id});
          if(res && res.ok){
            if(state.currentLibraryId===id) set({currentLibraryId:null});
            set({lastMsg:"已删除"});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):"删除失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function renameCurrentInLibrary(newName){
        if(!state.currentLibraryId){ set({lastMsg:"请先载入一张卡后再重命名"}); return; }
        var n=String(newName||"").trim();
        if(!n){ var inp=typeof window!=="undefined" ? window.prompt("输入新名称", "") : ""; if(!inp) return; n=String(inp).trim(); }
        if(!n) return;
        set({libraryBusy:"rename:"+state.currentLibraryId});
        try{
          var res=await rpc("cc_renameInLibrary", {id: state.currentLibraryId, name: n});
          if(res && res.ok){
            set({lastMsg:"已重命名为："+n});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):"重命名失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function exportLibraryEntry(id){
        if(!id) return;
        set({libraryBusy:"export:"+id});
        try{
          var res=await rpc("cc_getLibraryEntry", {id:id});
          if(res && res.ok && res.value && res.value.draft){
            var draft=res.value.draft;
            var blob=new Blob([JSON.stringify(draft,null,2)],{type:"application/json"});
            var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(res.value.meta.name||draft.data.name||"card")+".json"; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
            set({lastMsg:"已导出："+(res.value.meta.name||id)});
          } else set({lastMsg: res && res.error? String(res.error.message):"导出失败"});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      return { getSnapshot:getSnapshot, subscribe:subscribe, setCur:setCur, setPanel:setPanel, setSideExpanded:setSideExpanded, trigger:trigger, dismiss:dismiss, setIsCcMode:setIsCcMode, setDraftFromHost:setDraftFromHost, setSessionId:setSessionId, checkIsCcMode:checkIsCcMode, setCustomTag:setCustomTag, addCustomTag:addCustomTag, removeTag:removeTag, updateDraft:updateDraft, expandIdea:expandIdea, expandWorld:expandWorld, validate:validate, exportJSON:exportJSON, setIdea:setIdea, setWorldPatch:setWorldPatch, setEditingWorld:setEditingWorld, addEntry:addEntry, toggleTag:toggleTag, setLibraryQuery:setLibraryQuery, toggleLibraryCollapsed:toggleLibraryCollapsed, refreshLibrary:refreshLibrary, saveCurrentToLibrary:saveCurrentToLibrary, saveAsNewToLibrary:saveAsNewToLibrary, clearCurrentLibraryId:clearCurrentLibraryId, loadFromLibrary:loadFromLibrary, deleteFromLibrary:deleteFromLibrary, exportLibraryEntry:exportLibraryEntry, renameCurrentInLibrary:renameCurrentInLibrary };
    }

    var S={
      overlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"18px", zIndex:30 },
      workshop:{ width:"min(1360px, 96vw)", height:"min(860px, 92vh)", background:"var(--dsw-alias-bg-layer-1, #fff)", border:"1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius:18, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3, 0 20px 80px rgba(0,0,0,.2))" },
      head:{ height:56, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2, #f9fafb)" },
      step:{ padding:"6px 10px", borderRadius:999, fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", background:"var(--dsw-alias-bg-layer-2)", cursor:"pointer" },
      stepActive:{ background:"#7c5cff", borderColor:"#7c5cff", color:"#fff" },
      body:{ flex:1, display:"grid", gridTemplateColumns:"220px 1fr 280px 360px", minHeight:0, background:"var(--dsw-alias-bg-base)" },
      nav:{ borderRight:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", padding:"12px", display:"flex", flexDirection:"column", gap:10 },
      navBtn:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"1px solid transparent", background:"transparent", color:"var(--dsw-alias-label-secondary)", cursor:"pointer" },
      navBtnActive:{ background:"var(--dsw-alias-bg-layer-2)", borderColor:"var(--dsw-alias-border-l2)", color:"var(--dsw-alias-label-primary)" },
      main:{ padding:"16px", overflow:"auto", minWidth:0, background:"var(--dsw-alias-bg-base)" },
      side:{ borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", padding:"12px", overflow:"auto", minWidth:0 },
      library:{ borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" },
      libraryHead:{ height:46, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", flexShrink:0 },
      libraryList:{ flex:1, overflow:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:8 },
      libraryItem:{ background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10 },
      libraryCollapsedBar:{ width:40, borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 6px", gap:10, boxShadow:"inset 1px 0 0 var(--dsw-alias-border-l1)" },
      card:{ background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12, marginBottom:12 },
      field:{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 },
      badge:{ fontSize:11, padding:"2px 6px", borderRadius:999, border:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", color:"var(--dsw-alias-label-secondary)" },
      chip:{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", cursor:"pointer" },
      chipOn:{ background:"#7c5cff", borderColor:"#7c5cff", color:"#fff" },
      btn:{ appearance:"none", border:"1px solid transparent", background:"#7c5cff", color:"#fff", borderRadius:10, padding:"8px 14px", fontWeight:600, cursor:"pointer" },
      btnGhost:{ background:"transparent", borderColor:"var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)" },
      mono:{ fontFamily:"ui-monospace,Menlo,Consolas,monospace", fontSize:12, color:"var(--dsw-alias-label-secondary)" },
      dockWrap:{ boxSizing:"border-box", display:"flex", justifyContent:"flex-start", width:"100%", boxSizing:"border-box", maxWidth:"100%", paddingLeft:"calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)", margin:"2px 0" },
      capsule:{ display:"inline-flex", alignItems:"center", gap:8, maxWidth:360, padding:"1px 10px", borderRadius:999, border:"1px solid rgba(127,127,127,0.25)", background:"rgba(127,127,127,0.12)", color:"var(--dsw-alias-label-secondary, #c8ccd2)", fontSize:12, lineHeight:"20px", cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
      input:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 10px", fontSize:12 },
      textarea:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px" },
      label:{ fontSize:12, color:"var(--dsw-alias-label-secondary)" },
      labelStrong:{ fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" },
      subtleText:{ fontSize:11, color:"var(--dsw-alias-label-secondary)" },
      sectionTitle:{ margin:"0 0 8px", fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" }
    };

    function Capsule(props){
      var store=props.store; var t=props.t;
            var useSessions = props.useSessions;
      var sessions = useSessions ? useSessions(function(s){ return s; }) : null;
            var currentId = (sessions && sessions.current) || props.sessionId || props.session || null;
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
        if(store._pullDraft) store._pullDraft(currentId);
        return function(){};
      }, [currentId]);
      // 胶囊在 CC 模式下自动出现；为避免 isCc 检测在 RPC 上下文下失效（currentInitiator 为 null），暂时改为常显
      
      if(!s.isCcMode && !s.triggered && !s.panelOpen) return null;
      var draft=s.draft; var loreCount=draft.data.character_book.entries.length;
      var valid=s.valid && s.valid.valid;
      var text=(t("capsule.open")+" · "+loreCount+" lore · "+ (valid? t("capsule.exported"): t("capsule.draft")));
      return h("div",{style:S.dockWrap, "data-dsh-cc-studio":"dock-row"},
        h("button",{type:"button", style:S.capsule, title: t("hint.capsule"), onClick:function(){ store.setPanel(true); }},
          h("span",{style:{width:7,height:7,borderRadius:50, background: valid? "#2ee6a6":"#7c5cff", boxShadow:"0 0 8px "+(valid?"#2ee6a6":"#7c5cff"), display:"inline-block", flex:"none"}}),
          h("span",{style:{overflow:"hidden", textOverflow:"ellipsis"}}, text),
          h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:11}}, s.panelOpen? "— 已展开":"— 点击展开")
        ),
        h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginLeft:8}}, loreCount+" entries · "+draft.data.name),
        h("button",{type:"button", style:{marginLeft:6, background:"transparent", border:"1px solid rgba(127,127,127,0.2)", borderRadius:999, padding:"0 8px", fontSize:11, lineHeight:"20px", color:"var(--dsw-alias-label-secondary)", cursor:"pointer"}, onClick:function(){ store.dismiss(); }, title:"隐藏胶囊（CC 模式下自动出现）"}, "×")
      );
    }

    function Workshop(props){
      var store=props.store; var t=props.t;
            var useSessions = props.useSessions;
      var sessions = useSessions ? useSessions(function(s){ return s; }) : null;
            var currentId = (sessions && sessions.current) || props.sessionId || props.session || null;
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
        if(store._pullDraft) store._pullDraft(currentId);
        return function(){};
      }, [currentId]);
      React.useEffect(function(){
        if(s.panelOpen) store.refreshLibrary();
      }, [s.panelOpen]);
      if(!s.panelOpen) return null;
      var steps=[t("step.idea"), t("step.world"), t("step.char"), t("step.lore"), t("step.export")];
      function navItem(i, title, desc){
        var active=s.cur===i;
        return h("button",{key:i, style: Object.assign({}, S.navBtn, active? S.navBtnActive:{}), onClick:function(){ store.setCur(i); }}, title, h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2}}, desc));
      }
      var main=null;
      if(s.cur===0){
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}}, "点子投喂（薄世界观友好）"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"一句话点子"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:84, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.idea, onChange:function(e){ store.setIdea(e.target.value); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"风格标签（可多选 + 自定义）"),
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
                h("input",{placeholder:"自定义标签，回车添加", style:{flex:1, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 10px", fontSize:12, boxSizing:"border-box", maxWidth:"100%"}, value:s.customTag, onChange:function(e){ store.setCustomTag(e.target.value); }, onKeyDown:function(e){ if(e.key==="Enter"){ e.preventDefault(); store.addCustomTag(); }}}),
                h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.addCustomTag(); }}, "添加")
              ),
              h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:4}}, "已选标签会直接写入 card.data.tags，已选的点击可移除；下方为快捷候选。")
            ),
            h("div",{style:{display:"flex", gap:8}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.setCur(1); }}, "下一步 → 5维")
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          ),
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}},"角色设定（与 LLM 对话时由 CC 模式自动填充）"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"description"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:84, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.description, onChange:function(e){ store.updateDraft(function(d){ d.description=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"personality"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.personality, onChange:function(e){ store.updateDraft(function(d){ d.personality=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"scenario"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.scenario, onChange:function(e){ store.updateDraft(function(d){ d.scenario=e.target.value; }); }}))
          )
        );
      } else if(s.cur===1){
        function worldField(key, title){
          var val = s.world[key]||"";
          var has = String(val).trim().length>0;
          var preview = has ? String(val).slice(0,140) + (String(val).length>140 ? "…" : "") : "（空）点击右上“展开编辑”填写，支持多行长文";
          return h("div",{style:{border:"1px dashed var(--dsw-alias-border-l1)", borderRadius:12, padding:10, background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", minHeight:110}},
            h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}},
              h("div",{style:{fontSize:12, fontWeight:600}}, title),
              h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
                h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, String(val.length)+"字"),
                h("button",{style:Object.assign({}, S.btnGhost, {padding:"3px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}), onClick:function(){ store.setEditingWorld(key); }}, has ? "⛶ 编辑" : "＋ 填写")
              )
            ),
            h("div",{style:{flex:1, maxHeight:84, overflow:"auto", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:"8px", fontSize:12, lineHeight:1.5, whiteSpace:"pre-wrap", color: has? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)", cursor:"pointer"}, onClick:function(){ store.setEditingWorld(key); }}, has ? preview : preview),
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:6, textAlign:"right"}}, has ? "预览（点击卡片或按钮展开大框编辑）" : " ")
          );
        }
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 4px", fontSize:13}},"世界观 5维（Q2-B 深度问卷）"),
            h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, marginBottom:10}},"每维填 1-2 句即可，CC 模式下 LLM 会通过工具引导你补全，并自动生成带 @@decorator 的 Lorebook。点击卡片预览可展开大框，适合长文编辑。"),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              worldField("timeline", "① 年表 Timeline"),
              worldField("factions", "② 势力 Factions"),
              worldField("geo", "③ 地理 Geography"),
              worldField("power", "④ 力量 Power"),
              h("div",{style:{gridColumn:"span 2"}}, worldField("daily", "⑤ 日常 Daily"))
            ),
            h("div",{style:{display:"flex", gap:8, marginTop:12}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.setCur(2); }}, "下一步 → 角色细化")
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      } else if(s.cur===2){
        main=h("div",null,
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"角色细化 — 六件套"),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"name"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.name, onChange:function(e){ store.updateDraft(function(d){ d.name=e.target.value; }); }})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"nickname（{{char}} 用）"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.nickname||"", onChange:function(e){ store.updateDraft(function(d){ d.nickname=e.target.value; }); }}))
            ),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"tags（逗号分隔）"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.tags.join(", "), onChange:function(e){ store.updateDraft(function(d){ d.tags=e.target.value.split(",").map(function(x){return x.trim();}).filter(Boolean); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"description"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:84, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.description, onChange:function(e){ store.updateDraft(function(d){ d.description=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"personality"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.personality, onChange:function(e){ store.updateDraft(function(d){ d.personality=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"scenario"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.scenario, onChange:function(e){ store.updateDraft(function(d){ d.scenario=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"system_prompt"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.system_prompt||"", onChange:function(e){ store.updateDraft(function(d){ d.system_prompt=e.target.value; }); }})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"post_history_instructions"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.post_history_instructions||"", onChange:function(e){ store.updateDraft(function(d){ d.post_history_instructions=e.target.value; }); }}))
            )
          ),
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"开场与示例"),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"first_mes"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.first_mes, onChange:function(e){ store.updateDraft(function(d){ d.first_mes=e.target.value; }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"alternate_greetings（每行一条）"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.alternate_greetings.join("\n"), onChange:function(e){ store.updateDraft(function(d){ d.alternate_greetings=e.target.value.split("\n"); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"group_only_greetings *必填"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:60, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.group_only_greetings.join("\n"), onChange:function(e){ store.updateDraft(function(d){ d.group_only_greetings=e.target.value.split("\n"); }); }})),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"mes_example（{{user}}/{{char}}）"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:96, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.mes_example, onChange:function(e){ store.updateDraft(function(d){ d.mes_example=e.target.value; }); }}))
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
              return h("div",{key:e.id, style:{display:"grid", gridTemplateColumns:"1fr auto", gap:8, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10, marginBottom:8}},
                h("div",null,
                  h("div",{style:{fontWeight:600, fontSize:12}}, e.name, h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, e.constant? "constant": (e.keys.join(", ")||"—")), h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, "order "+e.insertion_order)),
                  h("div",{style:Object.assign({}, S.mono, {color:"var(--dsw-alias-label-secondary)", marginTop:4, whiteSpace:"pre-wrap"})}, e.content),
                  h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginTop:6}}, h("span",{style:S.badge},"@@depth/@@position"), h("span",{style:S.badge},"CBS: {{char}}"))
                ),
                h("div",{style:{display:"flex", flexDirection:"column", gap:6}}, h("label",{style:{fontSize:12}}, h("input",{type:"checkbox", checked:e.enabled, onChange:function(ev){ store.updateDraft(function(d){ var f=d.character_book.entries.find(function(x){return x.id===e.id;}); if(f) f.enabled=ev.target.checked; }); }}), " enabled"), h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"4px 8px", fontSize:12}), onClick:function(){ store.updateDraft(function(d){ d.character_book.entries=d.character_book.entries.filter(function(x){return x.id!==e.id;}); }); }}, "删除"))
              );
            })),
            h("div",{style:{display:"flex", gap:8, marginTop:10}},
              h("button",{style:S.btn, onClick:function(){ store.addEntry(); }}, "+ 新增条目"),
              h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", alignSelf:"center"}}, "CC 模式下由 LLM 通过工具自动添加")
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      } else {
        var v=s.valid;
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}},"校验与导出 — 首版仅 JSON（最稳）"),
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, marginBottom:8}},
              h("span",{style: Object.assign({}, S.badge, v.valid? {borderColor:"var(--dsw-alias-state-success-primary)", color:"#a6e8c8", background:"color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, var(--dsw-alias-bg-base))"}:{borderColor:"var(--dsw-alias-state-error-primary)", color:"#e8a6a6", background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))"})}, v.valid? "✓ 校验通过":"✗ 校验未通过"),
              h("span",{style:S.badge},"group_only_greetings: "+s.draft.data.group_only_greetings.length+" 条"),
              h("span",{style:S.badge}, "assets: "+(s.draft.data.assets? s.draft.data.assets.length:0))
            ),
            v.errors.length? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-state-error-primary)", borderRadius:8, padding:8, marginBottom:8, color:"#e8a6a6", fontSize:12}}, v.errors.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            v.warnings.length? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-border-l1) 40%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:8, marginBottom:8, color:"var(--dsw-alias-label-secondary)", fontSize:12}}, v.warnings.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            h("div",{style:{display:"flex", gap:8, margin:"12px 0"}},
              h("button",{style:S.btn, onClick:function(){ store.exportJSON(); }}, t("action.export")),
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.validate(); }}, s.busy==="validate"? "校验中…": t("action.validate")),
              h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, alignSelf:"center"}}, "CHARX / PNG 二期")
            ),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"creator_notes / 多语言"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:60, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.creator_notes, onChange:function(e){ store.updateDraft(function(d){ d.creator_notes=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"creation_date"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:String(s.draft.data.creation_date), readOnly:true})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"modification_date（导出自动刷新）"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:String(s.draft.data.modification_date), readOnly:true}))
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      }
      var stepsEls=steps.map(function(label, i){
        var active=s.cur===i;
        return h("span",{key:i, style: Object.assign({}, S.step, active? S.stepActive:{}), onClick:function(){ store.setCur(i); }}, (i+1)+". "+label);
      });
      var filteredLibrary = (function(){
        var q = String(s.libraryQuery||"").trim().toLowerCase();
        if(!q) return s.library;
        return s.library.filter(function(e){
          var nameMatch = String(e.name||"").toLowerCase().indexOf(q)>=0;
          var tagMatch = Array.isArray(e.tags) && e.tags.some(function(t){ return String(t).toLowerCase().indexOf(q)>=0; });
          var loreMatch = String(e.loreCount||"").indexOf(q)>=0;
          return nameMatch || tagMatch || loreMatch;
        });
      })();
      var bodyStyle = Object.assign({}, S.body, {gridTemplateColumns: s.libraryCollapsed ? "220px 1fr 40px 360px" : "220px 1fr 280px 360px"});
      function renderLibrary(){
        if(s.libraryCollapsed){
          return h("div",{style:S.libraryCollapsedBar},
            h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)", borderRadius:8, padding:"6px 8px", fontSize:12, cursor:"pointer", width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.toggleLibraryCollapsed(); }, title:"展开已存角色"}, "◀"),
            h("div",{style:{writingMode:"vertical-rl", fontSize:12, color:"var(--dsw-alias-label-secondary)", letterSpacing:2, lineHeight:"16px"}}, "已存 "+s.library.length),
            h("button",{style:Object.assign({}, S.btn, {padding:"6px 0", fontSize:14, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save", title:"保存当前草稿（"+(s.draft.data.name||"未命名")+"）"}, s.libraryBusy==="save"?"…":"★"),
            h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, filteredLibrary.length+"/"+s.library.length)
          );
        }
        return h("div",{style:S.library},
          h("div",{style:S.libraryHead},
            h("div",{style:{display:"flex", alignItems:"center", gap:6}},
              h("strong",{style:{fontSize:13}}, "已存角色"),
              h("span",{style:S.badge}, String(s.library.length))
            ),
            h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
              h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 6px", fontSize:11, cursor:"pointer"}), onClick:function(){ store.refreshLibrary(); }, title:"刷新", disabled: s.libraryBusy==="refresh"}, s.libraryBusy==="refresh"?"…":"↻"),
              h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 6px", fontSize:11, cursor:"pointer"}), onClick:function(){ store.toggleLibraryCollapsed(); }, title:"收起"}, "▶")
            )
          ),
          h("div",{style:{padding:"8px", borderBottom:"1px solid var(--dsw-alias-border-l1)", display:"flex", flexDirection:"column", gap:8, background:"var(--dsw-alias-bg-layer-1)"}},
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"3px 6px", background:"var(--dsw-alias-bg-layer-2)", borderRadius:6, border:"1px solid var(--dsw-alias-border-l1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}},
              s.currentLibraryId ? "已载入 ID:"+s.currentLibraryId.slice(0,8)+" · 再次保存将更新此卡" : "未载入（保存将新建 ID）"
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btn, {flex:1, padding:"6px 10px", fontSize:12}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"}, s.libraryBusy==="save"?"更新中…":(s.currentLibraryId?"↻ 更新":"★ 保存当前")),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"6px 10px", fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}), onClick:function(){ store.saveAsNewToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"}, s.libraryBusy==="saveNew"?"另存中…":"＋ 另存为新")
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.renameCurrentInLibrary(); }, disabled: !s.currentLibraryId||!!s.libraryBusy}, "✎ 重命名"),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.clearCurrentLibraryId(); }}, "＋ 新建"),
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", alignSelf:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, textAlign:"right"}}, s.draft.data.name ? s.draft.data.name.slice(0,8) : "未命名")
            ),
            h("input",{placeholder:"搜索 名称/标签…", style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", fontSize:12}, value:s.libraryQuery, onChange:function(e){ store.setLibraryQuery(e.target.value); }}),
            s.lastMsg ? h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}, s.lastMsg) : null
          ),
          h("div",{style:S.libraryList},
            filteredLibrary.length===0 ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"24px 8px"}}, s.library.length===0 ? "还没有已存角色\n去“点子/世界观”填好后点“保存当前”" : "无匹配") :
            filteredLibrary.map(function(entry){
              var isBusy = s.libraryBusy && String(s.libraryBusy).indexOf(entry.id)>=0;
              var isCurrent = s.currentLibraryId===entry.id;
              var itemStyle = isCurrent ? Object.assign({}, S.libraryItem, {borderColor:"#7c5cff", background:"color-mix(in srgb, #7c5cff 8%, var(--dsw-alias-bg-layer-2))"}) : S.libraryItem;
              return h("div",{key:entry.id, style:itemStyle},
                h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", gap:6}},
                  h("div",{style:{fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}, entry.name),
                  h("span",{style:Object.assign({}, S.badge, {flexShrink:0})}, entry.loreCount+" lore")
                ),
                h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:2, fontFamily:"ui-monospace,Menlo,monospace"}}, "ID:"+entry.id.slice(0,8)),
                h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}, entry.descriptionSnippet || entry.tags.join(" · ") || "—"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:4, marginTop:6}},
                  (entry.tags||[]).slice(0,4).map(function(t){ return h("span",{key:t, style:Object.assign({}, S.badge, {fontSize:10, padding:"1px 5px"})}, t); }),
                  entry.tags && entry.tags.length>4 ? h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, "+"+(entry.tags.length-4)) : null
                ),
                h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:4}}, new Date(entry.updatedAt*1000).toLocaleString()),
                h("div",{style:{display:"flex", gap:6, marginTop:8}},
                  h("button",{style:Object.assign({}, S.btn, {padding:"4px 8px", fontSize:11, flex:1}), onClick:function(){ store.loadFromLibrary(entry.id); }, disabled: !!isBusy}, isBusy?"…":"载入"),
                  h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 8px", fontSize:11}), onClick:function(){ store.exportLibraryEntry(entry.id); }, disabled: !!isBusy}, "导出"),
                  h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid #3a2a2a", background:"transparent", color:"#e8a6a6", borderRadius:8, padding:"4px 8px", fontSize:11}), onClick:function(){ store.deleteFromLibrary(entry.id); }, disabled: !!isBusy}, "删除")
                )
              );
            })
          )
        );
      }
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
          h("div",{style:bodyStyle},
            h("div",{style:S.nav},
              navItem(0, t("step.idea"), "一句话 + 风格"),
              navItem(1, t("step.world"), "年表/势力/地理/力量/日常"),
              navItem(2, t("step.char"), "六件套 + 开场"),
              navItem(3, t("step.lore"), "Lorebook + Decorator"),
              navItem(4, t("step.export"), "校验导出"),
              h("div",{style:{marginTop:"auto", paddingTop:12, borderTop:"1px solid var(--dsw-alias-border-l1)", display:"flex", flexDirection:"column", gap:8}},
                h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.validate(); }}, s.busy==="validate"? "校验中…": t("action.validate")),
                h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", textAlign:"center"}}, s.busy? s.busy: (s.lastMsg||"切换到 CC 模式让 LLM 引导填充"))
              )
            ),
            h("div",{style:S.main}, main),
            renderLibrary(),
            h("div",{style:S.side},
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"实时 CCv3 预览"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:8}}, h("span",{style:S.badge},"spec: chara_card_v3"), h("span",{style: Object.assign({}, S.badge, s.valid.valid? {color:"#a6e8c8", borderColor:"var(--dsw-alias-state-success-primary)"}:{color:"#e8a6a6", borderColor:"var(--dsw-alias-state-error-primary)"})}, s.valid.valid? "✓ 通过":"✗ 未通过")),
                h("pre",{style:{whiteSpace:"pre-wrap", wordBreak:"break-all", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10, maxHeight:420, overflow:"auto", margin:0, fontSize:11}}, JSON.stringify(s.draft, null, 2))
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"CBS 速查"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6}}, ["{{char}}","{{user}}","{{random:A,B}}","{{roll:d6}}","{{// 注释}}"].map(function(c){ return h("span",{key:c, style:S.chip}, c); })),
                h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, marginTop:8}}, "大小写不敏感，逗号用 \\, 转义。")
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},"融合说明"),
                h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, lineHeight:1.5}}, "默认只占一行胶囊；点开为全屏工坊，左侧导航可收起为图标，右侧实时预览常驻。后续可加“侧边抽屉”半屏态。")
              )
            )
          )
        ),
        s.editingWorld ? h("div",{style:Object.assign({}, S.overlay, {background:"rgba(0,0,0,.55)", zIndex:40}), onClick:function(e){ if(e.target===e.currentTarget) store.setEditingWorld(null); }},
          h("div",{style:{width:"min(720px, 92vw)", maxHeight:"82vh", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3)"}},
            h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}},
              h("strong",{style:{fontSize:14, color:"var(--dsw-alias-label-primary)"}}, ({timeline:"① 年表 Timeline", factions:"② 势力 Factions", geo:"③ 地理 Geography", power:"④ 力量 Power", daily:"⑤ 日常 Daily"}[s.editingWorld] || s.editingWorld) + " · 大框编辑"),
              h("button",{style:Object.assign({}, S.btnGhost, {padding:"4px 10px"}), onClick:function(){ store.setEditingWorld(null); }}, "× 关闭")
            ),
            h("textarea",{style:Object.assign({}, S.textarea, {minHeight:320, flex:1, maxHeight:"60vh"}), value: s.world[s.editingWorld]||"", onChange:function(e){ store.setWorldPatch(s.editingWorld, e.target.value); }, autoFocus:true, placeholder:"在此粘贴或撰写长文，实时同步到草稿…"}),
            h("div",{style:{display:"flex", gap:8, marginTop:12, justifyContent:"space-between", alignItems:"center"}},
              h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, String((s.world[s.editingWorld]||"").length)+" 字｜失焦自动保存，关闭即生效"),
              h("div",{style:{display:"flex", gap:8}},
                h("button",{style:S.btn, onClick:function(){ store.setEditingWorld(null); }}, "完成"),
                h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)"}), onClick:function(){ store.setEditingWorld(null); }}, "取消")
              )
            )
          )
        ) : null
      );
    }

    function SettingsView(props){
      var t=props.t || function(k){ return zh[k]||en[k]||k; };
      var store=props.store;
      var snap=null; try{ snap = store ? store.getSnapshot() : null; }catch(e){}
      var libCount = snap && Array.isArray(snap.library) ? snap.library.length : null;
      return h("div",{style:{padding:"16px 20px", maxWidth:720}},
        h("h2",{style:{margin:"0 0 8px", fontSize:18}}, "🎭 "+t("settings.title")),
        h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:13, lineHeight:1.6}}, t("settings.desc")),
        h("div",{style:{marginTop:16, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}},"当前状态"),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-primary)"}}, "已存角色：", libCount===null ? "—" : String(libCount)+" 个", libCount!==null ? h("span",{style:{color:"var(--dsw-alias-label-secondary)", marginLeft:8}}, "（落盘 ~/.dsh/cc-library）") : null),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:8}}, "CC 模式：切换到 CC 预设后，输入框上方出现胶囊，点开即是融合工坊（点子/五维/角色/世界书/导出 + 已存侧栏 + 预览）。"),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:6}}, "原型对比：", h("a",{href:"file:///E:/dsh/plugin/dsh-cc-studio/prototypes/index.html", target:"_blank", style:{color:"#7c5cff"}}, "prototypes/index.html"), " ｜ 规范：", h("a",{href:"https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md", target:"_blank", style:{color:"#7c5cff"}}, "CCv3 SPEC")),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:6}}, "导出：首版 JSON（CHARX/PNG 二期），侧边栏 ★ 保存/载入/导出/删除。"),
          store && store.refreshLibrary ? h("button",{style:Object.assign({}, S.btn, {marginTop:10, padding:"6px 10px", fontSize:12}), onClick:function(){ store.refreshLibrary(); }}, "刷新已存列表") : null
        ),
        h("div",{style:{marginTop:12, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}},"使用提示"),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", lineHeight:1.6}}, "1. 切换 CC 模式 → 2. 一句话点子 → 3. 让 LLM 按 6 步走（角色→五维→世界书≥5→问候语→validate）→ 4. 在工坊校验/导出或侧边栏保存。")
        )
      );
    }

    function apply(ctx){
      ctx.effect(function(){ return ctx.locale.register(NS, { zh:zh, en:en }); }, "cc-studio:locale");
      var store=createStore(ctx);
      // CC 模式检测 + 草稿同步：会话切换触发 + CC 模式下 2.5s 轻量轮询（修复 Tools 写入后胶囊/工坊不同步的 bug）
      ctx.effect(function(){
        var lastHostJson="";
        function pullDraft(sessionId){
          var args = sessionId ? {sessionId: sessionId} : {};
          if(sessionId) store.setSessionId(sessionId);
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_getDraft",{args:args}).then(function(res){
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
        // 初始拉一次（default）
        pullDraft();
        // 暴露给 Capsule/Workshop 按会话触发
        store._pullDraft = pullDraft;
        // CC 模式下轻量轮询，保证 LLM 的 cc_* Tool 写入后胶囊实时同步（切换会话时会自动更新 currentSessionId）
        var timer = setInterval(function(){
          var s = store.getSnapshot();
          if(!s.isCcMode && !s.triggered) return;
          var sid = s.currentSessionId || null;
          pullDraft(sid);
        }, 2500);
        return function(){ clearInterval(timer); };
      }, "cc-studio:cc-mode-poll");
      ctx.slots.inject("conversation.input.dock", function(){
        return ctx.slots.register({
          name:"conversation.input.dock",
          id:"dsh-cc-studio-pill",
          order:20,
          locale:NS,
          inject: function(sessionId){ return {store:store}; }
        }, Capsule);
      });
      ctx.slots.inject("shell.overlay", function(){
        return ctx.slots.register({
          name:"shell.overlay",
          id:"dsh-cc-studio-overlay",
          order:10,
          locale:NS,
          inject: function(){ return {store:store}; }
        }, Workshop);
      });
      ctx.slots.inject("settings.section", function(){
        return ctx.slots.register({
          name:"settings.section",
          id:"cc-studio",
          order:40,
          label: zh["settings.title"],
          locale: NS,
          inject: function(){ return {store: store}; }
        }, SettingsView);
      });
    }

    exports.apply=apply; exports.inject=inject; exports.name=name;
    return module.exports;
  }
});









