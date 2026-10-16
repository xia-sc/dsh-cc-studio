/**
 * @xia-sc/dsh-cc-studio — host half.
 * CCv3 工坊：校验 + 共享草稿（供 CC 模式的 LLM Tools 与浏览器胶囊同步）+ 已存角色侧边栏落盘。
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { inflateSync as zlibInflateSync } from "node:zlib";
// 卡组层（0.10.0）：卡组作用域组装 / 世界书分段统计 / 条目体检的**唯一实现**，与预设半共用同一个文件。
// 以前这些逻辑两半各抄一份、靠测试逐字比对维持同步 —— 「改了四个、漏了第五个」就是这么来的。
import { REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END,
  estimateTokens, contentKeyOf, assembleScope, groupMetrics, runGroupChecks } from "./group-layer.js";

const name = "dsh-cc-studio";
// dsh >= 0.1.5-rc.1: this package owns its HTTP route outright.
//
// `connection.rpc.handle()` is NOT usable by an outside plugin in this version:
// `HostConnectionService.rpc` closes over `this.ctx` — the connection plugin's
// OWN Context, whose `inject` is only `["credentials"]` — and registers through
// it (`owner.effect(() => owner.webServer.register(route))`,
// dsh-client-connection lib/index.js:618). The connection plugin reaches
// `webServer` through an inner `ctx.inject(["webServer"], …)` scope, so that
// owner fiber never resolves it and the call throws
// "cannot get property \"webServer\" without inject" no matter what the caller
// injects. We therefore register the channel on `webServer` ourselves and speak
// the same connection RPC wire protocol on the browser's behalf.
const inject = ["webServer", "connection", "agents", "agentPresets"];

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
/**
 * 草稿形状规范化（0.7.1，B1，与 lib/agent.js 同构）。
 *
 * DSH 对工具/远端返回值做 lossless-JSON 校验：**任何嵌套 `undefined` 都会让整次调用报错**。
 * 外部导入的卡（PNG / CHARX）或早期版本写下的草稿可能缺 `spec_version` / `creation_date` 这类字段，
 * 前端直接读它就会渲染出 `undefined`、导出的卡也缺字段。所以读盘恢复时按空卡模板补齐缺失键：
 * 只补 `undefined`，不覆盖已有值、不改类型（类型问题交给校验报）。
 */
function normalizeCardShape(draft){
  const tpl = makeDefaultDraft();
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
if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map();
// —— 落盘根（0.3.6 起统一）：DSH_HOME 优先，homedir()/.dsh 兜底 ——
// 预设目录一直走这里；草稿与角色库在 0.3.5 及以前写死 homedir()/.dsh，现在统一到同一套根，
// 但**读盘必须回退旧根** —— 否则自定义了 DSH_HOME 的用户升级后会看到「草稿和角色卡全没了」。
function legacyDshHomeDir(){
  try{ return join(homedir(), ".dsh"); }catch{ return join(process.cwd(), ".dsh"); }
}
function dshHomeDir(){
  const env = process.env.DSH_HOME;
  if(typeof env === "string" && env.trim().length > 0) return env.trim();
  return legacyDshHomeDir();
}
/**
 * 某个子目录的候选根：`[主根, 旧根]`。写盘只写 candidates[0]，读盘依次回退。
 * `DSH_HOME` 未设置时两个根是同一个目录 → 去重成一条，**默认安装的行为与 0.3.5 完全一致**。
 */
function dataRoots(sub){
  const primary = join(dshHomeDir(), sub);
  const legacy = join(legacyDshHomeDir(), sub);
  return primary === legacy ? [primary] : [primary, legacy];
}
// —— 草稿持久化（fix #2）：<主根>/cc-drafts/<session>.json，变更即落盘，重启后按会话 id 恢复 ——
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
// —— 草稿的「来源 id」sidecar（0.5.0，与 lib/agent.js 同构）——
// 记「这份草稿是从哪张已存卡载入的」，让「载入 → 改 → 保存」更新原卡而不是新建一张同名重复卡。
// 浏览器侧刷新页面会丢掉内存里的 currentLibraryId，所以这份关联必须落盘；存 sidecar 而不是塞进
// draft.extensions，是因为后者会跟着导出进用户的卡里。
function originFilePath(key){ return join(draftDir(), safeDraftFile(key).replace(/\.json$/, ".origin.json")); }
function readDraftOrigin(key){
  try{
    const p = originFilePath(key);
    if(!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, "utf8"));
    if(obj && typeof obj.libraryId === "string" && obj.libraryId) return obj;
  }catch{}
  return null;
}
function writeDraftOrigin(key, libraryId, name){
  try{
    if(!libraryId){ try{ unlinkSync(originFilePath(key)); }catch{} return; }
    mkdirSync(draftDir(), { recursive: true });
    writeFileSync(originFilePath(key), JSON.stringify({ key: String(key), libraryId: String(libraryId), name: String(name||""), savedAt: nowSec() }, null, 2), "utf8");
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft origin failed:", (e && e.message) || e); }catch{} }
}
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
    // revision（0.6.0，P0-6）：与 lib/agent.js 同构 —— 工具半与宿主半各写各的文件、各持各的内存，
    // **只有草稿文件里的 rev 是共同真相**。工坊这边每写一次盘就 +1，工具侧下次调用读到新 rev 就知道
    // 「草稿被外部换过了」，从而重载而不是拿过期前提去写（否则会静默覆盖用户在工坊里的修改）。
    let rev = 1;
    try{
      const prev = JSON.parse(readFileSync(draftPath(key), "utf8"));
      if(prev && typeof prev.rev === "number" && prev.rev > 0) rev = prev.rev + 1;
    }catch{}
    writeFileSync(draftPath(key), JSON.stringify({ key: String(key), updatedAt: nowSec(), rev, draft }, null, 2), "utf8");
    return rev;
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft failed:", (e && e.message) || e); }catch{} return null; }
}
function draftMeta(key){
  const k = key || "default";
  if(!globalThis.__CC_DRAFT_META__.has(k)) globalThis.__CC_DRAFT_META__.set(k, { isNew: false, recovered: false, newReason: null });
  return globalThis.__CC_DRAFT_META__.get(k);
}
/** 卡片内容指纹（忽略 modification_date）：判断「这次写入到底有没有真的改变内容」（N4，与工具半同构）。 */
function cardFingerprint(draft){
  try{
    const d = JSON.parse(JSON.stringify((draft && draft.data) ? draft.data : {}));
    delete d.modification_date;
    return JSON.stringify(d);
  }catch{ return ""; }
}
function draftStatusFor(key, draft){
  const m = draftMeta(key);
  // B1（0.7.1）：缺 `creation_date` 的外部导入卡不能再漏出 `undefined`（工具侧会因此整次调用失败，
  // 前端也会把 undefined 渲染成字面量）。
  return { isNew: !!m.isNew, recovered: !!m.recovered, creation_date: (draft && draft.data && draft.data.creation_date !== undefined) ? draft.data.creation_date : null, key: String(key) };
}
/**
 * 解析「这次调用读写哪把草稿槽」，并把来源一并带出来（诊断用）。
 *
 * 槽 key 的不变量：**同一会话里，Tools 与浏览器必须算出同一个 key**。
 * Tools 侧（lib/agent.js 的 keyFor）拿的是 `exec.agent.session.id`；浏览器侧要么把会话 id
 * 明确传过来，要么这里回退到 `agents.currentInitiator()` —— 但 RPC 是 HTTP 处理函数，
 * 没有 agent 上下文，currentInitiator() 恒为空，于是旧逻辑回退到 "default"。
 * 结果就是 issue #5：模型写 `session-<id>`、前端读 `default`，两槽并存、互相"看不见"。
 * 所以这里做两件事：① 把前端可能误传的会话快照对象认出来；② 回传 source 让上层能把
 * 「这次是回退到 default 了」这件事报给前端，而不是静默建一个空槽。
 */
function draftKeyPartsFrom(ctx, args){
  const raw = args ? args.sessionId : null;
  if(typeof raw === "string" && raw) return { key: raw, source: "arg" };
  // 前端历史上可能把整个会话快照对象传进来（SessionSnapshot 的 id 在 .sessionId 上）。
  // 旧逻辑 `typeof args.sessionId==="string"` 直接把它当「没传」丢弃 → 回退 default 槽；
  // 若改成 String(object) 又会得到 "[object Object]" 这把假 key。两种都不对，认它的 .sessionId。
  if(raw && typeof raw === "object" && typeof raw.sessionId === "string" && raw.sessionId)
    return { key: raw.sessionId, source: "arg-snapshot" };
  try{
    const agents = ctx.get("agents");
    const ag = agents && agents.currentInitiator && agents.currentInitiator();
    if(ag){
      if(ag.session && ag.session.id) return { key: String(ag.session.id), source: "initiator" };
      if(ag.id) return { key: String(ag.id), source: "initiator" };
      if(ag.sessionId) return { key: String(ag.sessionId), source: "initiator" };
    }
  }catch{}
  return { key: "default", source: "fallback" };
}
function draftKeyFrom(ctx, args){ return draftKeyPartsFrom(ctx, args).key; }
/**
 * 草稿「有没有内容」的判定（不追求 validateCard 那么严：迁移是自家两个槽之间搬东西，
 * name 为空但 lore 写满了的草稿也算有内容，不能因此拒绝迁移）。
 */
function draftContentSummary(draft){
  const d = (draft && draft.data && typeof draft.data === "object") ? draft.data : {};
  const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries.length : 0;
  let filled = 0;
  ["name","description","personality","scenario","system_prompt","post_history_instructions","first_mes","mes_example","creator_notes"].forEach(function(k){
    if(String(d[k]==null ? "" : d[k]).trim()) filled += 1;
  });
  if(Array.isArray(d.alternate_greetings) && d.alternate_greetings.length) filled += 1;
  if(entries) filled += 1;
  return { name: String(d.name==null ? "" : d.name), entries: entries, filled: filled };
}
/**
 * 盘上还有哪些草稿槽（按写入时间倒序）。只用于「当前槽是空壳」时的救回提示 ——
 * 这是 issue #5 里用户唯一能自救的入口：内容没丢，只是被写进了另一把 key。
 * 两个根都扫：主根优先，同一把槽只报一次（主根那份解析失败时才让旧根补位）。
 */
function listDraftSlotsOnDisk(){
  const out = [];
  const seen = new Set();
  for(const dir of draftDirs()){
    let names = [];
    try{ names = readdirSync(dir); }catch{ continue; }
    for(const f of names){
      if(!/\.json$/i.test(String(f))) continue;
      if(seen.has(String(f))) continue;
      let obj = null;
      try{ obj = JSON.parse(readFileSync(join(dir, String(f)), "utf8")); }catch{ continue; }
      const d = obj && obj.draft;
      if(!d || typeof d !== "object" || d.spec !== "chara_card_v3" || !d.data || typeof d.data !== "object") continue;
      const key = obj.key == null ? null : String(obj.key);
      if(!key) continue;
      seen.add(String(f));
      const sum = draftContentSummary(d);
      out.push({ key: key, updatedAt: Number(obj.updatedAt) || 0, name: sum.name, entries: sum.entries, hasContent: sum.filled > 0 });
    }
  }
  out.sort(function(a,b){ return b.updatedAt - a.updatedAt; });
  return out;
}
/**
 * 草稿槽迁移的纯决策函数（便于单测，与 planPresetInstall 同一套路子）。
 * @returns {ok:true, draft, summary} 或 {ok:false, code, message, details}
 */
function migrateDraftDecision(source, target, overwrite){
  if(!source || typeof source!=="object" || source.spec!=="chara_card_v3" || !source.data || typeof source.data!=="object")
    return { ok:false, code:"empty-source", message:"源槽没有草稿" };
  const srcSum = draftContentSummary(source);
  if(srcSum.filled === 0) return { ok:false, code:"empty-source", message:"源槽草稿是空壳，无需迁移" };
  const tgtSum = target ? draftContentSummary(target) : null;
  // 绝不静默覆盖：目标槽已有内容时必须显式 overwrite
  if(!overwrite && tgtSum && tgtSum.filled > 0)
    return { ok:false, code:"target-not-empty", message:"目标槽已有内容，需 overwrite: true", details:{ target: tgtSum } };
  return { ok:true, draft: JSON.parse(JSON.stringify(source)), summary: srcSum };
}
function getDraftFor(key){
  const k = key || "default";
  if(!globalThis.__CC_DRAFTS__.has(k)){
    // fix #2：内存 miss 时先尝试从磁盘恢复，而非静默建空
    const restored = loadPersistedDraftSync(k);
    if(restored){
      globalThis.__CC_DRAFTS__.set(k, normalizeCardShape(restored));   // B1：补齐外部导入卡缺失的字段
      const m = draftMeta(k); m.isNew = false; m.recovered = true; m.newReason = null;
    } else {
      globalThis.__CC_DRAFTS__.set(k, makeDefaultDraft());
      const m = draftMeta(k); m.isNew = true; m.recovered = false; m.newReason = "welcome";
    }
  }
  return globalThis.__CC_DRAFTS__.get(k);
}
function setDraftFor(key, draft){
  const k = key || "default";
  const prev = globalThis.__CC_DRAFTS__.get(k);
  // N4（0.7.0，与 lib/agent.js 同构）：内容一字未变时不写盘、不递增 rev。工坊侧每次编辑都调
  // cc_setDraft，同值覆盖（失焦、重复输入、只动了别的槽）不该白耗一个版本号 —— 否则模型手上的
  // rev 前提会被「其实没发生的变化」打掉一次，而它只能看到一句「草稿已被外部修改」。
  if(prev && cardFingerprint(prev) === cardFingerprint(draft)) return draft;
  draft.data.modification_date = nowSec();
  globalThis.__CC_DRAFTS__.set(k, draft);
  const m = draftMeta(k); m.isNew = false; m.recovered = false; m.newReason = null;
  persistDraftSync(k, draft);
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

// —— 已存角色侧边栏：落盘到 <主根>/cc-library/<id>.json（读盘回退 0.3.6 之前的 homedir()/.dsh）——
// ——————————————————————————————————————————————————————————————
// 人物关系图谱（0.8.0）：分组文件 + 三维关系（方向 × 类型 × 强度）
//
// 落盘 <主根>/cc-groups/<id>.json；「卡属于哪个组」记在库条目 meta.groupId（**单一真源**），
// 分组文件**不存 members** —— 成员由 listLibraryEntries() 过滤得出，删卡/移组天然一致，不会双写漂移。
//
// 纯函数（normalizeGroup / validateGroupOp / applyGroupOps / renderRelationsSection / spliceRelations /
// checkGroup / estimateTokensLite）在 lib/index.js 与 lib/agent.js 各有一份**同构实现**
// （与 dataRoots / safeDraftFile 同模式）；tests/relations.test.mjs 会逐字比对两半的渲染输出。
//
// 渲染：关系只活在插件侧，要让分享出去的卡自包含，就把它渲染进 description 的固定标记区
// （<!-- cc-relations:begin … --> … <!-- cc-relations:end -->）—— 那是**显式动作**，永不自动同步。
// ——————————————————————————————————————————————————————————————
// 关系图谱常量（0.10.0 起由 lib/group-layer.js 提供，两半共用一份）—— 这里不再重复定义。

function groupDirs(){ return dataRoots("cc-groups"); }
function groupDir(){ return groupDirs()[0]; }
/** 分组 id 只允许 [A-Za-z0-9_-]：它直接进文件名，必须挡住路径穿越。 */
function safeGroupId(id){
  return String(id == null ? "" : id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}
function groupPath(id){ return join(groupDir(), safeGroupId(id) + ".json"); }
function newGroupId(){ return Date.now() + "-" + Math.random().toString(36).slice(2, 6); }
async function ensureGroupDir(){ try{ await mkdir(groupDir(), { recursive: true }); }catch{} }

/** 粗略 token 估算：委托 lib/group-layer.js 的 estimateTokens（两半共用一份，不再各写一遍）。 */
function estimateTokensLite(text){ return estimateTokens(text); }
function relTypeOf(t){ const s = String(t == null ? "" : t); return REL_TYPES.indexOf(s) >= 0 ? s : "other"; }
function relLabel(edge){ return (edge && edge.label && String(edge.label).trim()) ? String(edge.label).trim() : (REL_TYPE_LABELS[(edge && edge.type) || "other"] || "其他"); }

/**
 * 结构兜底（沿用 0.7.1 B1 的教训：外部改坏的文件不能让 undefined 漏进返回值）。
 * ⚠️ **不丢弃端点不存在的边** —— 那是用户数据，破坏它比报错更糟；体检会报 dangling-edge、
 * 渲染时会自动跳过。
 */
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
/** 组内名字/别名是否与别的节点撞车（撞了渲染就会指向同一个人）。 */
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
/** 单条 op 的合法性（纯函数）。返回错误文案，null = 通过。 */
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
/** 应用 ops（纯函数）：返回 {group, applied, rejected:[{op,error}]}；不修改入参。 */
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
 * 生成【关系】段（纯函数）。默认只写出边（我 → 他）—— 卡片是以"我"为视角的；
 * includeIncoming 时追加一节「他们眼中的我」（扮演时知道对方怎么看我，是剧情张力来源，默认关）。
 */
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
/**
 * 把段文本并入 description：有标记区就**整段替换**，没有就末尾追加；section 为空 = 移除标记区。
 * 幂等：同一段内容渲染两次结果逐字相同（tests/relations.test.mjs 钉住）。
 */
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
 * 跨卡体检（纯函数）。members / cards 由调用方给：
 *   members = 组内卡的 id 列表；cards = [{id, name, description, constantTokens, tokenBudget}]
 *
 * 0.10.0：实现搬进 lib/group-layer.js 的 `runGroupChecks()`（检查注册表，与预设半共用同一个文件）。
 * 这里保留旧签名与返回形状（issues[].level/code/message/refs + stats），所以既有调用点与测试都不用改；
 * 新检查项只往那里的 GROUP_CHECKS 加一项。opts.checks 可只跑指定类别。
 */
function checkGroup(group, members, cards, sharedEntries, opts){
  return runGroupChecks({ group: normalizeGroup(group), members: members, cards: cards,
    sharedEntries: sharedEntries, opts: opts });
}

/** 读分组：主根优先，回退旧根（与角色库同规）。 */
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
      try{
        const obj = JSON.parse(await readFile(join(dir, f), "utf8"));
        seen.set(id, normalizeGroup(obj));
      }catch{}
    }
  }
  return [...seen.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
/** 写分组：读盘上 rev 再 +1（与 persistDraftSync 同思路），只写主根。 */
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
/** 删除：两个根里的同名副本都删（否则回退读会把刚删的组「复活」，与 deleteLibraryEntry 同规）。 */
async function deleteGroupFile(id){
  const file = safeGroupId(id) + ".json";
  let removed = 0;
  for(const dir of groupDirs()){
    try{ await unlink(join(dir, file)); removed++; }catch{}
  }
  return removed;
}

function libDirs(){ return dataRoots("cc-library"); }
function libDir(){ return libDirs()[0]; }
async function ensureLibDir(){
  const dir = libDir();
  await mkdir(dir, { recursive: true });
  return dir;
}
/** 读盘用：主根没有就回退旧根。返回 `{path, raw}`；两边都没有时抛最后一个错误（与原 readFile 语义一致）。 */
async function readLibraryRaw(id){
  let lastErr = null;
  for(const dir of libDirs()){
    const p = join(dir, String(id)+".json");
    try{ return { path: p, raw: await readFile(p, "utf8") }; }
    catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("找不到角色卡: " + String(id));
}
// ========== PNG / CHARX 共享 ==========
/** tags 在 V1/ST 那边可能是逗号分隔的字符串；V2/V3 要数组。 */
function normTags(v){
  if(Array.isArray(v)) return v.map(function(x){ return String(x); });
  if(typeof v==="string") return v.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
  return [];
}
/**
 * V2（乃至 V1）卡 → CCv3 升级（0.9.1 的 B2）。返回 `{card, from}`，`from` 为 null = 本来就是 V3。
 *
 * 为什么做：SillyTavern 里**绝大多数存量卡是 V2**（ST 界面新建的就是 V2 形状，ST 只是把 `spec` 改写成
 * 了 v3 标签），而工坊此前只收 `chara_card_v3` —— 用户把 ST 里那张卡的 PNG/JSON 拖进来，只会得到
 * 一句「spec 需为 chara_card_v3」。升级规则照 ST 自己的 `readFromV2()`（`characters.js:504-556`）：
 * 顶层那些 V1 平铺字段并进 `data`（**只在 `data` 里没有该值时**，不覆盖 V2 自己的值），其余不认识
 * 的字段原样留着。`from` 交给调用方，用来**明确告诉用户「这份是升上来的」**（不静默变换）。
 */
function upgradeCardToV3(obj){
  if(!obj || typeof obj!=="object") throw new Error("卡必须是对象");
  if(obj.spec==="chara_card_v3" && obj.data && typeof obj.data==="object") return { card: obj, from: null, copied: [] };
  const out=JSON.parse(JSON.stringify(obj));
  const copied=[];
  const hasData=!!(out.data && typeof out.data==="object");
  if(!hasData){
    // 纯 V1：整份包成 data
    const flat={};
    ["name","description","personality","scenario","first_mes","mes_example"].forEach(function(k){ if(out[k]!==undefined) flat[k]=out[k]; });
    flat.creator_notes = out.creator_notes!==undefined? out.creator_notes : (out.creatorcomment!==undefined? out.creatorcomment : "");
    flat.system_prompt="";
    flat.post_history_instructions="";
    flat.alternate_greetings=Array.isArray(out.alternate_greetings)? out.alternate_greetings : [];
    flat.tags=normTags(out.tags);
    flat.creator=out.creator!==undefined? out.creator : "";
    flat.character_version=out.character_version!==undefined? out.character_version : "";
    flat.extensions={};
    if(out.talkativeness!==undefined) flat.extensions.talkativeness=out.talkativeness;
    if(out.fav!==undefined) flat.extensions.fav=out.fav===true;
    out.data=flat;
  } else {
    out.data.extensions=(out.data.extensions && typeof out.data.extensions==="object")? out.data.extensions : {};
    ["name","description","personality","scenario","first_mes","mes_example"].forEach(function(k){
      if(out.data[k]===undefined && out[k]!==undefined){ out.data[k]=out[k]; copied.push("data."+k); }
    });
    if(out.data.tags===undefined && out.tags!==undefined){ out.data.tags=normTags(out.tags); copied.push("data.tags"); }
    if(out.data.creator_notes===undefined){
      if(out.creator_notes!==undefined){ out.data.creator_notes=out.creator_notes; copied.push("data.creator_notes"); }
      else if(out.creatorcomment!==undefined){ out.data.creator_notes=out.creatorcomment; copied.push("data.creator_notes"); }
    }
    if(out.talkativeness!==undefined && out.data.extensions.talkativeness===undefined){ out.data.extensions.talkativeness=out.talkativeness; copied.push("data.extensions.talkativeness"); }
    if(out.fav!==undefined && out.data.extensions.fav===undefined){ out.data.extensions.fav=out.fav===true; copied.push("data.extensions.fav"); }
  }
  const from=String(out.spec || (hasData? "chara_card_v2" : "chara_card_v1"));
  if(typeof out.data.name!=="string" || !out.data.name.trim()) throw new Error("不是可识别的卡片（没有名称，spec="+from+"）");
  out.spec="chara_card_v3";
  out.spec_version="3.0";
  return { card: out, from: from, copied: copied };
}
function normalizeDraft(d){
  if(!d || typeof d!=="object") throw new Error("draft 必须是对象");
  // V2/V1 一律**升级**而不是拒绝（B2）；本来就是 V3 时 up.card 就是原对象
  d=upgradeCardToV3(d).card;
  d.spec_version=d.spec_version||"3.0";
  d.data.character_book=d.data.character_book||{name:"",description:"",scan_depth:4,token_budget:1200,recursive_scanning:false,extensions:{},entries:[]};
  if(!Array.isArray(d.data.character_book.entries)) d.data.character_book.entries=[];
  if(!Array.isArray(d.data.group_only_greetings)) d.data.group_only_greetings=[];
  if(!Array.isArray(d.data.alternate_greetings)) d.data.alternate_greetings=[];
  if(!Array.isArray(d.data.tags)) d.data.tags=[];
  if(!Array.isArray(d.data.assets)) d.data.assets=[{type:"icon",uri:"ccdefault:",name:"main",ext:"png"}];
  if(!d.data.creation_date) d.data.creation_date=nowSec();
  d.data.modification_date=nowSec();
  return d;
}
let _crcTable=null;
function crc32(buf){
  if(!_crcTable){
    _crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320 ^ (c>>>1)):(c>>>1); _crcTable[n]=c>>>0; }
  }
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c=_crcTable[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF)>>>0;
}
function u32be(n){ const b=new Uint8Array(4); b[0]=(n>>>24)&0xFF; b[1]=(n>>>16)&0xFF; b[2]=(n>>>8)&0xFF; b[3]=n&0xFF; return b; }
function concatBytes(arrs){ let len=0; for(const a of arrs) len+=a.length; const o=new Uint8Array(len); let off=0; for(const a of arrs){ o.set(a,off); off+=a.length; } return o; }
function strToBytes(s){ return new TextEncoder().encode(String(s)); }
function bytesToStr(b){ return new TextDecoder().decode(b); }
function b64DecodeBytes(b64){ return new Uint8Array(Buffer.from(String(b64),"base64")); }
function extractCardFromPngBytes(bytes){
  if(bytes.length<8 || bytes[0]!==0x89 || bytes[1]!==0x50) throw new Error("不是合法 PNG（缺少 PNG 签名）");
  let off=8;
  let v3=null, v2=null, sawCardChunk=false, lastError=null;
  while(off+8 <= bytes.length){
    const len=(bytes[off]<<24)|(bytes[off+1]<<16)|(bytes[off+2]<<8)|bytes[off+3];
    if(len<0 || len> 20*1024*1024) break;
    const type=bytesToStr(bytes.slice(off+4,off+8));
    if(off+8+len+4 > bytes.length) break;
    const data=bytes.slice(off+8, off+8+len);
    if(type==="tEXt"){
      try{
        const zero=data.indexOf(0);
        if(zero>=0){
          const kw=String(bytesToStr(data.slice(0,zero))).trim().toLowerCase();
          if(kw==="ccv3" || kw==="ccv3_card" || kw==="chara" || kw==="chara_card_v3"){
            sawCardChunk=true;
            let jsonStr=bytesToStr(data.slice(zero+1)).trim();
            try{ const decoded=bytesToStr(b64DecodeBytes(jsonStr)); if(decoded.trim().startsWith("{")) jsonStr=decoded; }catch{}
            const obj=JSON.parse(jsonStr);
            const cand=(obj && obj.spec)? obj : ((obj && obj.data)? {spec:"chara_card_v3",spec_version:"3.0",data:obj} : null);
            // 判据用**载荷里的 spec**，不用块名：规范允许 `chara` 块里放回填用的 V2 对象，但现实里
            // 也有工具把 V3 卡塞进 `chara`（我们自己历史上就写过 `chara_card_v3` 这个块名）。
            if(cand && cand.data){
              if(String(cand.spec)==="chara_card_v3"){ if(!v3) v3=cand; if(v3) break; }
              else if(!v2) v2=cand;
            }
          }
        }
      }catch(e){ lastError=e; }
    } else if(type==="zTXt" || type==="iTXt"){
      lastError=new Error("检测到 "+type+" 压缩块，请用 tEXt 格式导出（当前仅支持 tEXt ccv3）");
    }
    if(type==="IEND") break;
    off+=12+len;
  }
  // 两个块都在时**必须**取 ccv3 —— 规范原文：「if the application detects both `chara` and `ccv3` chunk,
  // the application *SHOULD* use the `ccv3` chunk」。SillyTavern 自己导出的 PNG 就是 chara 在前、ccv3 在后，
  // 旧实现「取第一个命中的块」于是读到 V2 那份，再把 spec=chara_card_v2 的卡交给 normalizeDraft 直接报错。
  if(v3) return v3;
  // 只有 V2 块（ST 里那张卡的 `chara` 块、或只写过 chara 的老工具）：照样交出去，
  // 由 normalizeDraft → upgradeCardToV3 升级成 CCv3（B2：升级而不是拒绝）。
  if(v2) return v2;
  if(!sawCardChunk) throw new Error(lastError? String(lastError.message):"PNG 未找到 ccv3/chara 块（tEXt ccv3），请确认是否为 CCv3 PNG");
  throw new Error("PNG 内卡格式错误");
}
// ========== SillyTavern / V2 兼容层（0.9.1）==========
// 原则：**底层永远是纯 CCv3**，兼容层只在「导出的那一份副本」上生成（草稿与库里的卡一个字节都不动）。
// 两个落点，都是规范允许的位置：
//   ① PNG 的 `chara` 块 = 诚实的 CharacterCardV2 投影（见 pngCardChunks 注释）；
//   ② `data.extensions.world` = ST 的「角色↔世界书」绑定（ST 只认这个字符串，`characters.js:391,617`）。
// 规范明文禁止的是「往 CharacterCard 对象里加应用私有字段」（那张卡顶层加 V1 平铺字段就是这一类），所以
// 我们**不**学 ST 那么干 —— ST 需要的东西全部落在 `extensions` / `chara` 块 / CHARX 资源里。
/** V2 的 data 字段集（V3 独有的 nickname / creator_notes_multilingual / source / group_only_greetings /
 *  assets / creation_date / modification_date 一个都不进 —— 那些字段在 V2 里不存在）。 */
const V2_DATA_FIELDS=["name","description","personality","scenario","first_mes","mes_example","creator_notes",
  "system_prompt","post_history_instructions","alternate_greetings","character_book","tags","creator","character_version","extensions"];
/** 摘掉正文**开头连续**的 `@@` 装饰器行（含其后遗留的空行）—— 规范要求回填 V2 时移除全部装饰器。 */
function stripDecorators(content){
  const lines=String(content==null? "" : content).split("\n");
  let i=0;
  while(i<lines.length && String(lines[i]).slice(0,2)==="@@") i++;
  while(i<lines.length && !String(lines[i]).trim()) i++;
  return lines.slice(i).join("\n");
}
/** 整张卡 → CharacterCardV2 对象（PNG 的 `chara` 块用；只做投影，不改调用方传进来的对象）。 */
function stV2Projection(card){
  const src=(card && typeof card==="object")? card : {};
  const d=(src.data && typeof src.data==="object")? src.data : {};
  const data={};
  V2_DATA_FIELDS.forEach(function(k){
    if(d[k]===undefined) return;
    if(k==="character_book"){
      const book=JSON.parse(JSON.stringify(d[k]));
      if(book && Array.isArray(book.entries)) book.entries.forEach(function(e){ if(e && typeof e==="object") e.content=stripDecorators(e.content); });
      data[k]=book;
      return;
    }
    data[k]=d[k];
  });
  return { spec:"chara_card_v2", spec_version:"2.0", data };
}
/**
 * 导出副本上写 ST 的世界书绑定。ST 的绑定就是 `data.extensions.world = <世界书文件名>`；
 * 我们的共享书导出成 `<书名>.json`，所以这里直接写书名 —— 用户在 ST 里导完那本世界书，
 * 再导这张卡，绑定就自动接上了（没导书时它只是个悬空字符串，ST 不会报错）。
 * ⚠️ 只在导出副本上做（同「并入本卡」的家规）：草稿与库里的卡不许被这个 ST 专有字段污染。
 */
function withStWorld(card, world){
  const name=String(world==null? "" : world).trim();
  if(!name) return card;
  const out=JSON.parse(JSON.stringify(card));
  out.data=out.data||{};
  out.data.extensions=Object.assign({}, out.data.extensions);
  out.data.extensions.world=name;
  return out;
}
function buildTEXtChunk(cardJson, keyword){
  const jsonStr=JSON.stringify(cardJson);
  const b64=Buffer.from(jsonStr,"utf8").toString("base64");
  const kwBytes=strToBytes(keyword||"ccv3");
  const textBytes=strToBytes(b64);
  const chunkData=concatBytes([kwBytes, new Uint8Array([0]), textBytes]);
  const typeBytes=strToBytes("tEXt");
  const crc=crc32(concatBytes([typeBytes, chunkData]));
  return concatBytes([u32be(chunkData.length), typeBytes, chunkData, u32be(crc)]);
}
/**
 * 一张卡要写进 PNG 的两个 tEXt 块：`chara`（V2 投影，给只认 V2 的读取器回填）+ `ccv3`（纯 CCv3，规范里的 MUST）。
 *
 * 规范（SPEC_V3「PNG/APNG」节，0.9.1 实测对齐）：
 * ① `ccv3` 块 MUST 存在，值是 CharacterCardV3 对象的 utf-8→base64；
 * ② 应用 MAY 用 `chara` 块回填 V2 对象；两个块都在时读取方 **SHOULD** 用 `ccv3`；
 * ③ 「On backfilling V2, the application SHOULD remove all decorators」—— 所以投影里要摘掉 `@@` 装饰器行。
 * SillyTavern 自己也是两个块都写（`src/character-card-parser.js:15-46`），且 `chara` 在前 —— 这里保持同样顺序。
 * ⚠️ 卡片 JSON 的**顶层**绝不许加 ST 的私有字段（V1 平铺那套）：规范同节写着应用 MUST follow the
 * specification、私有数据只能放 `extensions` —— 兼容层只活在 `chara` 这一块与 `extensions.world` 里。
 */
function pngCardChunks(cardJson){
  return [buildTEXtChunk(stV2Projection(cardJson), "chara"), buildTEXtChunk(cardJson, "ccv3")];
}
function buildPngWithCard(cardJson){
  const baseB64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  const base=new Uint8Array(Buffer.from(baseB64,"base64"));
  const iendOff=base.length-12;
  const head=base.slice(0,iendOff);
  const tail=base.slice(iendOff);
  return concatBytes([head].concat(pngCardChunks(cardJson), [tail]));
}
function embedCardIntoPngBytes(pngBytes, cardJson){
  if(pngBytes.length<8 || pngBytes[0]!==0x89 || pngBytes[1]!==0x50) throw new Error("不是合法 PNG（缺少 PNG 签名）");
  if(pngBytes.length > 15*1024*1024) throw new Error("PNG 过大（>15MB）");
  const newChunks=pngCardChunks(cardJson);
  let off=8;
  const parts=[pngBytes.slice(0,8)];
  let inserted=false;
  while(off+8 <= pngBytes.length){
    const len=(pngBytes[off]<<24)|(pngBytes[off+1]<<16)|(pngBytes[off+2]<<8)|pngBytes[off+3];
    if(len<0 || len> 20*1024*1024) throw new Error("PNG 块长度异常");
    const type=bytesToStr(pngBytes.slice(off+4,off+8));
    if(off+8+len+4 > pngBytes.length) throw new Error("PNG 截断");
    const data=pngBytes.slice(off+8, off+8+len);
    const chunkBytes=pngBytes.slice(off, off+12+len);
    if(type==="IEND"){
      newChunks.forEach(function(c){ parts.push(c); });
      parts.push(chunkBytes);
      inserted=true;
      break;
    }
    // 跳过旧的 ccv3/chara 块
    let skip=false;
    if(type==="tEXt"){
      const zero=data.indexOf(0);
      if(zero>=0){
        const kw=String(bytesToStr(data.slice(0,zero))).trim().toLowerCase();
        if(kw==="ccv3" || kw==="ccv3_card" || kw==="chara" || kw==="chara_card_v3") skip=true;
      }
    } else if(type==="zTXt" || type==="iTXt"){
      const zero=data.indexOf(0);
      if(zero>=0){
        const kw=String(bytesToStr(data.slice(0,zero))).trim().toLowerCase();
        if(kw==="ccv3" || kw==="ccv3_card" || kw==="chara" || kw==="chara_card_v3") skip=true;
      }
    }
    if(!skip) parts.push(chunkBytes);
    off+=12+len;
  }
  if(!inserted) throw new Error("PNG 缺少 IEND 块");
  return concatBytes(parts);
}
function parseZipEntries(bytes){
  const entries=[];
  let off=0;
  while(off+30 <= bytes.length){
    if(bytes[off]!==0x50 || bytes[off+1]!==0x4B || bytes[off+2]!==0x03 || bytes[off+3]!==0x04) break;
    const method=bytes[off+8]|(bytes[off+9]<<8);
    const compSize=(bytes[off+18]|(bytes[off+19]<<8)|(bytes[off+20]<<16)|(bytes[off+21]<<24))>>>0;
    const nameLen=bytes[off+26]|(bytes[off+27]<<8);
    const extraLen=bytes[off+28]|(bytes[off+29]<<8);
    const nameStart=off+30;
    const nameEnd=nameStart+nameLen;
    if(nameEnd+extraLen > bytes.length) break;
    const name=bytesToStr(bytes.slice(nameStart,nameEnd));
    const dataStart=nameEnd+extraLen;
    const dataEnd=dataStart+compSize;
    if(dataEnd > bytes.length) break;
    let data=bytes.slice(dataStart,dataEnd);
    if(method===8){
      try{ data=new Uint8Array(zlibInflateSync(Buffer.from(data))); }catch(e){ throw new Error("ZIP DEFLATE 解压失败: "+String(e.message)); }
    } else if(method!==0){
      throw new Error("不支持的 ZIP 方法 "+method+"（仅支持 STORE/DEFLATE）");
    }
    entries.push({name, data});
    off=dataEnd;
    if(entries.length>64) break;
  }
  return entries;
}
function buildZipCharx(cardJson){
  const jsonBytes=strToBytes(JSON.stringify(cardJson,null,2));
  const nameBytes=strToBytes("card.json");
  const crc=crc32(jsonBytes);
  const header=new Uint8Array(30);
  header[0]=0x50;header[1]=0x4B;header[2]=0x03;header[3]=0x04;
  header[4]=0x14;header[5]=0x00;
  header[6]=0x00;header[7]=0x00;
  header[8]=0x00;header[9]=0x00;
  header[14]=crc&0xFF; header[15]=(crc>>>8)&0xFF; header[16]=(crc>>>16)&0xFF; header[17]=(crc>>>24)&0xFF;
  header[18]=jsonBytes.length&0xFF; header[19]=(jsonBytes.length>>>8)&0xFF; header[20]=(jsonBytes.length>>>16)&0xFF; header[21]=(jsonBytes.length>>>24)&0xFF;
  header[22]=jsonBytes.length&0xFF; header[23]=(jsonBytes.length>>>8)&0xFF; header[24]=(jsonBytes.length>>>16)&0xFF; header[25]=(jsonBytes.length>>>24)&0xFF;
  header[26]=nameBytes.length&0xFF; header[27]=(nameBytes.length>>>8)&0xFF;
  header[28]=0;header[29]=0;
  const local=concatBytes([header, nameBytes, jsonBytes]);
  const cdHeader=new Uint8Array(46);
  cdHeader[0]=0x50;cdHeader[1]=0x4B;cdHeader[2]=0x01;cdHeader[3]=0x02;
  cdHeader[4]=0x14;cdHeader[5]=0x00; cdHeader[6]=0x14;cdHeader[7]=0x00;
  cdHeader[8]=0x00;cdHeader[9]=0x00; cdHeader[10]=0x00;cdHeader[11]=0x00;
  cdHeader[14]=crc&0xFF;cdHeader[15]=(crc>>>8)&0xFF;cdHeader[16]=(crc>>>16)&0xFF;cdHeader[17]=(crc>>>24)&0xFF;
  cdHeader[18]=jsonBytes.length&0xFF;cdHeader[19]=(jsonBytes.length>>>8)&0xFF;cdHeader[20]=(jsonBytes.length>>>16)&0xFF;cdHeader[21]=(jsonBytes.length>>>24)&0xFF;
  cdHeader[22]=jsonBytes.length&0xFF;cdHeader[23]=(jsonBytes.length>>>8)&0xFF;cdHeader[24]=(jsonBytes.length>>>16)&0xFF;cdHeader[25]=(jsonBytes.length>>>24)&0xFF;
  cdHeader[26]=nameBytes.length&0xFF;cdHeader[27]=(nameBytes.length>>>8)&0xFF;
  cdHeader[28]=0;cdHeader[29]=0; cdHeader[30]=0;cdHeader[31]=0;
  cdHeader[32]=0;cdHeader[33]=0; cdHeader[34]=0;cdHeader[35]=0;
  cdHeader[36]=0;cdHeader[37]=0;cdHeader[38]=0;cdHeader[39]=0;
  cdHeader[40]=0;cdHeader[41]=0;cdHeader[42]=0;cdHeader[43]=0;
  cdHeader[44]=0;cdHeader[45]=0;
  const central=concatBytes([cdHeader, nameBytes]);
  const eocd=new Uint8Array(22);
  eocd[0]=0x50;eocd[1]=0x4B;eocd[2]=0x05;eocd[3]=0x06;
  eocd[8]=1;eocd[9]=0; eocd[10]=1;eocd[11]=0;
  const centralSize=central.length;
  eocd[12]=centralSize&0xFF;eocd[13]=(centralSize>>>8)&0xFF;eocd[14]=(centralSize>>>16)&0xFF;eocd[15]=(centralSize>>>24)&0xFF;
  const localSize=local.length;
  eocd[16]=localSize&0xFF;eocd[17]=(localSize>>>8)&0xFF;eocd[18]=(localSize>>>16)&0xFF;eocd[19]=(localSize>>>24)&0xFF;
  return concatBytes([local, central, eocd]);
}

function makeLibraryEntryMeta(draft, existingMeta, id){
  const data = draft && draft.data ? draft.data : {};
  const now = nowSec();
  const loreCount = Array.isArray(data.character_book?.entries) ? data.character_book.entries.length : 0;
  const allTags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const tags = allTags.slice(0, 6);
  return {
    id: String(id),
    name: (data.name && String(data.name).trim()) || (existingMeta && existingMeta.name) || "未命名角色",
    loreCount,
    tags,
    tagsTotal: allTags.length,
    descriptionSnippet: String(data.description || "").slice(0,80),
    // 0.8.0 关系图谱：卡属于哪个分组（**单一真源** —— 分组文件里不存成员列表，避免双写漂移）。
    // 继承既有值，所以「改卡内容再保存」不会把卡踢出分组。
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
 * 现在读一次就够：listLibraryEntries() 只是它的投影，groupScope() 直接吃它。与预设半同构。
 */
async function readLibrarySnapshot(){
  await ensureLibDir();
  const seen = new Map();   // id → {id, meta, draft, dir}：先到先得，主根排在前 → 同名卡片主根优先
  for(const dir of libDirs()){
    let files=[];
    try{ files = await readdir(dir); }catch{ continue; }
    for(const f of files){
      if(!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/,"");
      if(seen.has(id)) continue;
      try{
        const raw = await readFile(join(dir, f), "utf8");
        const obj = JSON.parse(raw);
        if(obj && obj.meta && obj.id){
          // 兼容：meta.id 与文件名 id 一致
          seen.set(id, { id:id, meta:obj.meta, draft:obj.draft || null, dir:dir });
        } else if(obj && obj.draft){
          // 旧格式兜底：从 draft 重建 meta
          seen.set(id, { id:id, meta:makeLibraryEntryMeta(obj.draft, null, id), draft:obj.draft, dir:dir });
        }
      }catch{}
    }
  }
  const rows = [...seen.values()];
  rows.sort((a,b)=> ((b.meta.updatedAt||0)-(a.meta.updatedAt||0)));
  return rows;
}
/** 库条目 meta 列表（签名与排序语义未变，现在只是卡库快照的投影）。 */
async function listLibraryEntries(){
  const rows = await readLibrarySnapshot();
  return rows.map(r => r.meta);
}
async function saveLibraryEntry(draft, opts){
  const dir = await ensureLibDir();
  let id = opts && opts.id ? String(opts.id) : "";
  let existing = null;
  if(id){
    // 已存在的那份可能在旧根（0.3.6 之前保存的），读过来只为继承 createdAt / 旧 name
    try{ existing = JSON.parse((await readLibraryRaw(id)).raw); }catch{}
  }
  if(!id){
    id = String(Date.now())+"-"+Math.random().toString(36).slice(2,6);
  }
  const meta = makeLibraryEntryMeta(draft, existing ? existing.meta : null, id);
  // 改名 = 单一事实来源：meta.name 与 draft.data.name 一起改（否则「列表名 / 导出名」两套，用户改名看不出效果）
  if(opts && typeof opts.name === "string" && opts.name.trim()){
    const n = String(opts.name).trim().slice(0,60);
    meta.name = n;
    draft.data.name = n;
  }
  const payload = { id, meta, draft };
  await writeFile(join(dir, id+".json"), JSON.stringify(payload, null, 2), "utf8");
  return { id, meta, draft, action: existing ? "updated" : "created" };
}
async function loadLibraryEntry(id){
  await ensureLibDir();
  const obj = JSON.parse((await readLibraryRaw(id)).raw);
  if(!obj || !obj.draft) throw new Error("文件格式错误");
  return obj;
}
/** 0.8.0：组内成员卡的 id —— 由库条目 meta.groupId 派生（分组文件里刻意不存成员列表）。 */
async function groupMemberIds(groupId){
  const gid = safeGroupId(groupId);
  const entries = await listLibraryEntries();
  return entries.filter(e => String(e.groupId || "") === gid).map(e => e.id);
}
/**
 * 卡组作用域（0.10.0，与预设半同构）—— 取「哪个组、组里有哪些卡、这个组的书是什么」的**唯一入口**。
 *
 * 宿主半的来源卡来自 args.cardId 或草稿 sidecar（sessionId 对应的 origin.json）；纯组装在
 * lib/group-layer.js（两半共用一份），所以界面看到的组与模型看到的组形状只有一种。
 * 拿不到来源卡 / 没进组 / 组不存在 / 组还没建书 → 返回 ok:false 的空作用域（调用方无需自己判空）。
 */
async function groupScope(input){
  const opt = input || {};
  // 已经读过快照就传进来（opt.snapshot）—— 一次调用里只读一遍盘，也让「只读一次」可被测试钉住
  const snap = opt.snapshot ? opt.snapshot : await readLibrarySnapshot();
  const byId = new Map(snap.map(x => [String(x.id), x]));
  let cardId = opt.cardId ? String(opt.cardId) : "";
  if(!cardId && opt.sessionKey){
    const origin = readDraftOrigin(String(opt.sessionKey));
    cardId = (origin && origin.libraryId) ? String(origin.libraryId) : "";
  }
  const mine = cardId ? (byId.get(cardId) || null) : null;
  const explicit = opt.groupId ? safeGroupId(opt.groupId) : "";
  const groupId = explicit || ((mine && mine.meta.groupId) ? String(mine.meta.groupId) : "");
  const base = { cardId: cardId, include: opt.include, maxCards: opt.maxCards, missing: (cardId && !mine) ? [cardId] : [] };
  if(!groupId) return assembleScope(Object.assign({ groupId: "" }, base));
  // ⚠️ 组文件缺失时**不提前返回**（与预设半同构）：成员与共享书照样读出来，只是 group 为 null / ok:false ——
  // 「组没了但书还在」的历史数据，界面上仍应看得到那本书。
  const found = await readGroupRaw(groupId);
  const cards = snap.filter(x => String(x.meta.groupId || "") === groupId);
  const bf = await readBookRaw(groupId);
  const book = bf ? normalizeBook(bf.obj, groupId) : null;
  return assembleScope(Object.assign({
    groupId: groupId, group: found ? normalizeGroup(found.obj) : null, cards: cards, book: book,
    bookRev: book ? bookRevOf(book) : 0,
  }, base));
}
/**
 * 由卡组作用域算一次分段统计（0.10.0）：体检类检查的数字来源，子类不再各自 for 循环求和。
 * 与预设半同构（那边是 groupScope + groupMetrics 的组合调用）。
 */
function metricsForGroup(scope){
  return groupMetrics({ cardId: scope && scope.cardId, card: [],
    members: (scope && scope.members) || [], book: (scope && scope.book) ? scope.book.entries : [] });
}
/**
 * 按名字找组（建组/改名时查重）：trim 后精确比对；带 exceptId 时排除自己（给自己改名不算撞车）。
 * 两半同构 —— 界面和模型必须落到同一条规则上，否则会出现「模型建不了同名组、界面却建了两个」。
 */
function findGroupByName(groups, name, exceptId){
  const want = String(name || "").trim();
  if(!want) return null;
  const eid = exceptId ? safeGroupId(exceptId) : "";
  return (Array.isArray(groups) ? groups : []).find(g => g.id !== eid && String(g.name || "").trim() === want) || null;
}
/**
 * 把一张已存卡放进分组（groupId 传空 = 移出）。与 lib/agent.js **逐字同构** —— 界面与模型必须落到
 * 同一套行为上（否则会出现「模型放进去能复活旧节点、界面放进去却新建一个同名节点」这种分叉）。
 * 入组时若组里还没有它的节点就自动补一个；卡曾因被删而降级的同名 orphan 节点会被**复活**（保住旧关系）。
 * 移出**不删节点、不删关系**：那是用户建过的资产，挪回来时关系还在。
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
    return { cardId: cid, cardName: mine.name, previousGroupId: (mine.groupId ? String(mine.groupId) : null), groupId: null, nodeId: null, revived: false };
  }
  const found = await readGroupRaw(gid);
  if(!found) throw Object.assign(new Error("分组不存在: " + gid), { code: "not-found" });
  const g = normalizeGroup(found.obj);
  let node = g.nodes.find(n => n.kind === "card" && n.cardId === cid);
  let revived = false;
  if(!node){
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
/** 0.8.0：体检 / 渲染需要的卡片摘要（只读；卡不在库里就跳过）—— 0.10.0 起吃卡库快照，不再逐卡重复读盘。 */
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
      tokenBudget: Number(d.character_book && d.character_book.token_budget) || 1200,
    });
  }
  return out;
}
/** 0.8.0：就地改某个库条目的 meta（写在解析到的那一份上，与 renameLibraryEntry 同规，不搬家）。 */
async function patchLibraryMeta(id, patch){
  const found = await readLibraryRaw(id);
  const obj = JSON.parse(found.raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  Object.assign(obj.meta, patch || {});
  obj.meta.updatedAt = nowSec();
  await writeFile(found.path, JSON.stringify(obj, null, 2), "utf8");
  return obj;
}
/**
 * 0.8.0：卡被删除后，把各分组里指向它的节点降级为 orphan。
 * **不删边** —— 关系是用户手工建立的资产，卡没了不代表关系该消失；节点保留名字，体检会报 orphan-node。
 */
async function orphanCardNodes(cardId, cardName){
  const touched = [];
  for(const g of await listGroups()){
    let hit = false;
    g.nodes.forEach(n => {
      if(n.kind === "card" && n.cardId === cardId){
        n.cardId = null;
        n.orphanOf = String(cardName || n.name || "").slice(0, 60);
        hit = true;
      }
    });
    if(hit){ await writeGroup(g); touched.push(g.id); }
  }
  return touched;
}
/** 0.8.0：卡改名后同步各分组里对应节点的 name（按 cardId 匹配；别名不动 —— 那是用户为它写的称呼）。 */
async function syncCardNodeName(cardId, name){
  const touched = [];
  const clean = String(name || "").trim().slice(0, 60);
  if(!clean) return touched;
  for(const g of await listGroups()){
    let hit = false;
    g.nodes.forEach(n => { if(n.kind === "card" && n.cardId === cardId && n.name !== clean){ n.name = clean; hit = true; } });
    if(hit){ await writeGroup(g); touched.push(g.id); }
  }
  return touched;
}
/**
 * 删除：**两个根里的同名副本都要删**，否则读盘回退会把刚删掉的卡「复活」。
 * 一个都没删到时仍然抛错（保持「删不存在的 id 是失败」的既有语义）。
 */
async function deleteLibraryEntry(id){
  await ensureLibDir();
  let removed = 0;
  for(const dir of libDirs()){
    try{ await unlink(join(dir, String(id)+".json")); removed += 1; }
    catch(e){ if(e && e.code !== "ENOENT") throw e; }
  }
  if(removed === 0) throw Object.assign(new Error("找不到角色卡: " + String(id)), { code: "ENOENT" });
}
/** 改名是**就地改** meta.name：写在解析到的那一份上（主根优先），不搬家、不复制。 */
async function renameLibraryEntry(id, newName){
  await ensureLibDir();
  const found = await readLibraryRaw(id);
  const obj = JSON.parse(found.raw);
  if(!obj || !obj.meta) throw new Error("文件格式错误");
  const name = String(newName||"").trim().slice(0,60);
  if(!name) throw new Error("name 不能为空");
  obj.meta.name = name;
  obj.meta.updatedAt = nowSec();
  // 单一事实来源（0.5.0）：列表名与卡内 data.name 一起改 —— 此前只改 meta，侧边栏改了名、导出的卡里还是旧名
  if(obj.draft && obj.draft.data) obj.draft.data.name = name;
  await writeFile(found.path, JSON.stringify(obj, null, 2), "utf8");
  return obj.meta;
}

// —— Connection RPC 通道（自持路由，见文件头 inject 注释）——
const RPC_CHANNEL = "/dsh-cc-studio-rpc";
// 与 client-connection ENDPOINT_SEGMENT_PATTERN 一致：单段不含 / . ..
const RPC_SEGMENT = /^[A-Za-z0-9_$.-]+$/;
// 导入/导出端点承载 base64 卡与底图（PNG ≤20MB、CHARX ≤30MB base64），留出包裹余量
const RPC_MAX_BODY_BYTES = 48 * 1024 * 1024;

function endpointFromPath(pathname){
  if(typeof pathname!=="string" || !pathname.startsWith(RPC_CHANNEL+"/")) return undefined;
  const q = pathname.indexOf("?");
  const rest = pathname.slice(RPC_CHANNEL.length+1, q===-1 ? undefined : q);
  if(!rest) return undefined;
  for(const seg of rest.split("/")){
    if(seg==="" || seg==="." || seg===".." || !RPC_SEGMENT.test(seg)) return undefined;
  }
  return rest;
}
// 用经典 data/end/error 事件读取请求体：事件形式是各版本都稳定的路径，也方便在这里
// 统一加体积上限与 aborted 兜底（见 readBoundedBody）。
//
// 0.3.7 更正：这段注释以前写的是「IncomingMessage 的异步迭代在本运行时会抛错，连
// client-connection 自带的 /api 帧也因此拿不到 body」—— 在 dsh 0.1.7-rc.1 + Node v26.9.0
// 上实测**不成立**：`for await (const chunk of req)` 正常返回，而且 client-connection 的
// /api 桥自己就在用异步迭代（dsh-client-connection lib/index.js:58）。所以「必抛」不再是
// 选事件式的理由；保留事件式只是因为改它没有任何收益。
function readBoundedBody(req, maxBytes){
  return new Promise((resolve)=>{
    const chunks=[]; let size=0; let settled=false;
    const finish=(value)=>{ if(settled) return; settled=true; cleanup(); resolve(value); };
    function onData(chunk){
      size += chunk.length;
      if(size > maxBytes){ try{ req.resume(); }catch{} finish(undefined); return; }
      chunks.push(chunk);
    }
    function onEnd(){ finish(Buffer.concat(chunks, size).toString("utf8")); }
    function onError(){ finish(undefined); }
    function onAborted(){ finish(undefined); }
    function cleanup(){
      try{
        req.removeListener("data", onData);
        req.removeListener("end", onEnd);
        req.removeListener("error", onError);
        req.removeListener("aborted", onAborted);
      }catch{}
    }
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}
function sendEnvelope(res, status, payload){
  try{
    if(res.writableEnded) return;
    res.statusCode = status;
    res.setHeader("content-type","application/json; charset=utf-8");
    res.setHeader("cache-control","no-store");
    res.end(JSON.stringify(payload));
  }catch(e){ try{ res.end(); }catch{} }
}
// 与 client-connection fullResponse / errorResponse 同一 envelope
function rpcFull(rpcId, result){ return { type:"server-response", rpcId, result }; }
function rpcError(rpcId, code, message, details){ return rpcFull(rpcId, { ok:false, error:{ code, message, details } }); }

// ========== CC 预设安装 ==========
// dsh >= 0.1.7-alpha.1：预设机制换代了。预设不再是「<DSH_HOME>/.agent-presets/<id>/ 目录」，
// 而是**组合里的一个声明行**（内置 standard/ptc/minimal/cordis 就是这么发的），目录形态在 0.1.7
// 已经没有任何代码读取 —— 这就是「升级到 0.1.7-alpha.1 后 CC 模式从 roster 里消失」的原因：
// 文件还在，只是没人再看它。本插件因此把声明写进随包的补丁层 presets/cc.patch.yml
// （package.json 的 dsh.bundle.patch 第二层）：插件装进哪个 profile，CC 模式就出现在哪个
// profile 的 roster 里，不再依赖「挂载时往用户目录写文件」。
//
// 下面这套目录安装**只为更老的 dsh（<= 0.1.6-alpha.2）保留**：那条路径上预设发现只扫三个根
// ——shipped 根（dsh-agent-presets 包内）+ 部署 config.roots + 用户根 <DSH_HOME>/.agent-presets
// （见 dsh-agent-presets lib/index.js:1300-1310）；插件包内的 presets/ 不在其中，
// 「随包分发」≠「已注册」，所以必须挂载时把模板装进用户根，「装完插件即有 CC 模式」才成立。
//
// 安全策略（绝不静默覆盖用户改动）：
//   · 目标文件不存在                    → 写入模板
//   · 目标与模板一致                    → 不动（只补记安装记录）
//   · 目标与我们上次写入的记录一致      → 是我们装的且用户没改 → 安全更新
//   · 其余（用户改过 / 无记录的历史手工拷贝）→ 跳过并告警，交由用户决定
// 安装记录是目标目录里的 JSON 侧车文件，含每个受管文件写入时的 sha256，
// 因此不依赖版本号比较也能正确判定「这是不是我们写的、用户有没有动过」。
// config.presetInstall: "auto"（默认）| "off" | "force"（连用户改动一起覆盖）。
// 新版 dsh 上这份目录安装自动让位（status: "native"），开关也无意义 —— 想关 CC 模式就在
// profile 补丁里按 id 关掉 preset-cc 那一行（presets/cc.patch.yml 顶部有现成的写法）。
const PRESET_ID = "cc";
const PRESET_MANAGED_FILES = ["preset.yml", "agent.cordis.yml"];
const PRESET_MARKER_FILE = ".dsh-cc-studio-preset.json";
/**
 * 当前 dsh 是否已经用「声明行」发预设（>= 0.1.7-alpha.1）。
 * 只用来决定「要不要往那份已经没人读的目录里写字」，判错的代价并不对称：
 *   · 误判 false（在老版上）→ 照旧写一次目录，无害；
 *   · 误判 true（在真需要目录的老版上）→ 才是真的少一个预设。
 * 所以要求两个方法**同时**存在，且**不许简化成其中任何一个**：
 * 0.1.6 的 `dsh-agent-presets` 也有 `compositionInventory`（`async compositionInventory()`），
 * 单看它会把老版误判成新版；`register(definition)` 才是 0.1.7 新注册表独有的（老服务里
 * `register` 只出现在 `settings.register` / `sessionProjections.register` 上）。
 */
function supportsDeclaredPresets(ctx){
  try{
    const presets = ctx && typeof ctx.get === "function" ? ctx.get("agentPresets") : null;
    return !!(presets && typeof presets.register === "function" && typeof presets.compositionInventory === "function");
  }catch{ return false; }
}

// `dshHomeDir()` / `legacyDshHomeDir()` / `dataRoots()` 定义在文件顶部（草稿那一节之前）——
// 这里**不再重复定义**：两个同名 function 声明会「后者悄悄赢」，是漂移的温床。
function presetSourceRoot(){
  try{ return fileURLToPath(new URL("../presets/"+PRESET_ID+"/", import.meta.url)); }catch{ return null; }
}
function presetTargetRoot(){ return join(dshHomeDir(), ".agent-presets", PRESET_ID); }
function sha256(text){ return createHash("sha256").update(String(text), "utf8").digest("hex"); }
function pluginVersion(){
  try{ return JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version || "unknown"; }
  catch{ return "unknown"; }
}
/**
 * 纯决策函数（便于单测）：给定目标现状、模板、上次安装记录，决定每个受管文件该写还是该跳过。
 * @param targets 目标文件内容表（缺失的文件用 null）
 * @param templates 模板内容表
 * @param marker 上次安装记录（可缺省）
 * @param force 为 true 时连用户改动一起覆盖
 */
function planPresetInstall(targets, templates, marker, force){
  const recorded = (marker && marker.files && typeof marker.files === "object") ? marker.files : {};
  const write = [], skip = [], ok = [];
  for(const name of Object.keys(templates)){
    const tpl = templates[name];
    const cur = Object.prototype.hasOwnProperty.call(targets, name) ? targets[name] : null;
    if(cur === null || cur === undefined){ write.push(name); continue; }   // 缺文件 → 补齐
    if(cur === tpl){ ok.push(name); continue; }                            // 已是当前模板
    if(force){ write.push(name); continue; }
    if(recorded[name] && recorded[name] === sha256(cur)){ write.push(name); continue; } // 我们写的、用户没改
    skip.push(name);                                                       // 用户改动 / 历史手工拷贝
  }
  return { write, skip, ok };
}
/**
 * 把 presets/cc 安装到 <DSH_HOME>/.agent-presets/cc（**只对 < 0.1.7-alpha.1 有意义**）。
 * 同步执行（只有两个小文件），幂等。
 * 注意：卸载插件**不会**删除已安装的预设（与 README 的既有说明一致），因此这里不注册删除型 disposer。
 */
function installCcPreset(ctx, config){
  // 开关优先级：插件行 config.presetInstall > 环境变量 DSH_CC_STUDIO_PRESET_INSTALL > auto。
  // 环境变量是给用户的轻量逃生口（不必写 overlay patch）。
  const fromCfg = (config && typeof config.presetInstall === "string") ? config.presetInstall.trim() : "";
  const fromEnv = (typeof process.env.DSH_CC_STUDIO_PRESET_INSTALL === "string") ? process.env.DSH_CC_STUDIO_PRESET_INSTALL.trim() : "";
  const raw = fromCfg || fromEnv || "auto";
  const mode = (raw === "off" || raw === "force") ? raw : "auto";
  const out = { mode, status: "unknown", installed: [], updated: [], skipped: [], reason: null };
  if(mode === "off"){ out.status = "off"; return out; }
  const log = (level, msg)=>{ try{
    const l = ctx && ctx.logger;
    if(l && typeof l[level] === "function") l[level]("[dsh-cc-studio] " + msg);
    else if(level === "warn") console.warn("[dsh-cc-studio] " + msg);
  }catch{} };
  // dsh >= 0.1.7-alpha.1：预设已随包声明（presets/cc.patch.yml），目录形态被彻底忽略。
  // 这里一个字都不写 —— 否则只会留下一个没人读的目录，下次有人「修预设」时还要多查一层。
  if(supportsDeclaredPresets(ctx)){
    out.status = "native";
    out.reason = "dsh >= 0.1.7-alpha.1：CC 预设由随包补丁层 presets/cc.patch.yml 声明，目录形态已不再被读取，跳过安装";
    log("info", out.reason);
    try{
      const dst = presetTargetRoot();
      if(existsSync(dst)) log("info", "检测到旧版安装目录 " + dst + "（0.1.6 及更早的形态）：0.1.7 起不再被读取，可以安全删除。");
    }catch{}
    return out;
  }
  try{
    const src = presetSourceRoot();
    const templates = {};
    for(const name of PRESET_MANAGED_FILES){
      const p = src ? join(src, name) : null;
      if(p && existsSync(p)) templates[name] = readFileSync(p, "utf8");
    }
    if(Object.keys(templates).length === 0){
      out.status = "no-template"; out.reason = "插件包内找不到 presets/" + PRESET_ID + "（打包时漏了 presets？）";
      log("warn", out.reason); return out;
    }
    const dst = presetTargetRoot();
    const targets = {};
    for(const name of Object.keys(templates)){
      const p = join(dst, name);
      targets[name] = existsSync(p) ? readFileSync(p, "utf8") : null;
    }
    const markerPath = join(dst, PRESET_MARKER_FILE);
    let marker = null;
    if(existsSync(markerPath)){
      try{ marker = JSON.parse(readFileSync(markerPath, "utf8")); }catch{ marker = null; }
    }
    const plan = planPresetInstall(targets, templates, marker, mode === "force");
    const isFresh = !existsSync(dst) || Object.keys(targets).every((k) => targets[k] === null);
    if(plan.write.length > 0){
      mkdirSync(dst, { recursive: true });
      for(const name of plan.write){
        writeFileSync(join(dst, name), templates[name], "utf8");
        (isFresh ? out.installed : out.updated).push(name);
      }
    }
    // 刷新记录的前提是「我们至少拥有一个受管文件」（写入的或本已一致的）。
    // 若全部文件都属于用户（例如纯手工拷贝），则不写任何记录——不在用户自己管理的目录里留痕迹。
    const files = {};
    for(const name of Object.keys(templates)){
      if(plan.write.indexOf(name) >= 0 || plan.ok.indexOf(name) >= 0) files[name] = sha256(templates[name]);
    }
    const owned = Object.keys(files).length > 0;
    const nextMarker = { version: pluginVersion(), installedAt: nowSec(), files };
    const markerStale = !marker || marker.version !== nextMarker.version || JSON.stringify(marker.files||{}) !== JSON.stringify(files);
    if(owned && (plan.write.length > 0 || markerStale)){
      mkdirSync(dst, { recursive: true });
      writeFileSync(markerPath, JSON.stringify(nextMarker, null, 2), "utf8");
    }
    out.skipped = plan.skip;
    if(out.installed.length) { out.status = "installed"; log("info", "已自动安装 CC 预设到 " + dst + "（" + out.installed.join(", ") + "）：重启后可在会话模式里选择「CC 模式」"); }
    else if(out.updated.length) { out.status = "updated"; log("info", "已自动更新 CC 预设 " + out.updated.join(", ") + " → " + nextMarker.version); }
    else { out.status = "current"; }
    if(plan.skip.length){
      out.status = out.status === "current" ? "skipped-user-edited" : out.status;
      log("warn", "CC 预设的 " + plan.skip.join(", ") + " 与插件模板不一致，且不是本插件写入的（可能是你手工改过或旧版手工拷贝），已保留未覆盖。" +
        "如需用插件模板刷新，请删除 " + dst + " 后重启，或在插件行配置 presetInstall: force。");
    }
    return out;
  }catch(e){
    out.status = "error"; out.reason = String(e && e.message ? e.message : e);
    log("warn", "自动安装 CC 预设失败（不影响其它功能）：" + out.reason);
    return out;
  }
}

function apply(ctx, config){
  globalThis.__CC_CTX__ = ctx;
  // 装完插件即有 CC 模式：把模板预设写进用户预设根（幂等、不覆盖用户改动）
  try{ globalThis.__CC_PRESET_INSTALL__ = installCcPreset(ctx, config); }catch{}
  const dispatch = async (endpoint, payload, signal)=>{
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
          const parts = draftKeyPartsFrom(ctx, args);
          return ok({ isCc: isCcPreset(ctx, (parts.source==="arg"||parts.source==="arg-snapshot") ? parts.key : null) });
        }
        case "cc_getDraft":{
          const parts = draftKeyPartsFrom(ctx, args);
          const k = parts.key;
          const d = getDraftFor(k);
          const status = draftStatusFor(k, d);
          const origin = readDraftOrigin(k);
          const payload = { draft: d, key: k, keySource: parts.source, isCc: isCcPreset(ctx, (parts.source==="arg"||parts.source==="arg-snapshot") ? k : null), draftStatus: status, originId: origin ? origin.libraryId : null };
          // 只在「当前槽是个新空壳」时才去盘上翻别的槽（issue #5 的救回入口）。
          // 而且只翻**这次错位真正会牵涉到的另一把槽**，不是把所有会话的槽都端出来：
          //   · 当前是会话槽（session-<id>）→ 候选只有 default —— 旧前端在没有会话 id 时
          //     一律读写 default，用户在工坊里的编辑很可能就落在那里；
          //   · 当前是 default → 候选是各个 session-* 槽 —— 模型经 Tools 写的是会话槽。
          // 其余情况（比如别的会话的槽）与本会话无关，端出来只会变成噪音。
          if(status.isNew || k === "default"){
            try{
              const all = listDraftSlotsOnDisk().filter(s=> s.key!==k && s.hasContent);
              const alts = (k === "default") ? all.filter(s=> s.key !== "default") : all.filter(s=> s.key === "default");
              if(alts.length) payload.alternateSlots = alts.slice(0, 3);
            }catch{}
          }
          return ok(payload);
        }
        case "cc_migrateDraft":{
          // 把别的草稿槽搬进本会话槽：args: { from, to?, overwrite? }
          // to 缺省 = 当前会话（走同一套 key 解析，前端不必自己拼 key）。
          const from = (typeof args.from==="string" && args.from) ? args.from : "default";
          const toParts = draftKeyPartsFrom(ctx, { sessionId: (typeof args.to==="string" && args.to) ? args.to : (args.sessionId||null) });
          const to = toParts.key;
          if(from === to) return fail("same-slot", "源槽与目标槽相同（" + from + "），无需迁移");
          const src = loadPersistedDraftSync(from) || (globalThis.__CC_DRAFTS__.has(from) ? globalThis.__CC_DRAFTS__.get(from) : null);
          const tgt = loadPersistedDraftSync(to) || (globalThis.__CC_DRAFTS__.has(to) ? globalThis.__CC_DRAFTS__.get(to) : null);
          const decision = migrateDraftDecision(src, tgt, args.overwrite===true);
          if(!decision.ok) return fail(decision.code, decision.message, decision.details||{});
          setDraftFor(to, decision.draft);
          return ok({ draft: decision.draft, key: to, from: from, moved: decision.summary, draftStatus: draftStatusFor(to, decision.draft) });
        }
        case "cc_setDraft":{
          const k = draftKeyFrom(ctx, args);
          const draft = args.draft;
          if(!draft || typeof draft!=="object") return fail("invalid-draft","draft 必须为对象");
          const v = validateCard(draft);
          if(!v.valid) return fail("invalid-card","校验未通过: "+v.errors.join("; "), {errors:v.errors});
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft) });
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
          if(patch.creator!==undefined) cur.data.creator = String(patch.creator).slice(0,120);   // N1：作者名此前没有写入路径
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
          return ok({ draft: cur, key:k, draftStatus: draftStatusFor(k, cur) });
        }
        case "cc_validateDraft":{
          const k = draftKeyFrom(ctx, args);
          const d = getDraftFor(k);
          const res = validateCard(d);
          res.draftStatus = draftStatusFor(k, d);
          return ok(res);
        }
        // —— 已存角色库 ——
        case "cc_listLibrary":{
          const entries = await listLibraryEntries();
          return ok({ entries });
        }
        case "cc_saveToLibrary":{
          // args: {draft?, id?, name?, sessionId?}  draft 缺省则取当前会话草稿
          const k = draftKeyFrom(ctx, args);
          let draft = args.draft;
          if(!draft || typeof draft!=="object"){
            draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          }
          // 不传 id 时沿用草稿的**来源 id**：工坊里「载入 → 改 → 保存」应当是更新原卡，
          // 而不是新建一张同名重复卡（刷新页面会丢掉内存里的 currentLibraryId，所以来源落在盘上）。
          const explicitId = (typeof args.id==="string" && args.id) ? args.id : "";
          const origin = explicitId ? null : readDraftOrigin(k);
          const targetId = explicitId || (origin ? origin.libraryId : "");
          // 允许保存未完全校验的草稿，但至少需要 name？不强制，meta 会兜底“未命名角色”
          const res = await saveLibraryEntry(draft, { id: targetId || undefined, name: args.name });
          writeDraftOrigin(k, res.id, res.meta.name);
          // 0.8.0 修：action 用 saveLibraryEntry 的实测判定（它按「该 id 的文件是否已存在」算）。
          // 旧写法 `targetId ? "updated" : "created"` 在「传一个库里不存在的新 id」时会谎报 updated ——
          // 而那正是群聊场景「从母卡派生出一批角色卡」的唯一路径，模型会以为自己覆盖了别人。
          return ok({ id: res.id, meta: res.meta, action: res.action });
        }
        case "cc_loadFromLibrary":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          const obj = await loadLibraryEntry(id);
          // 载入到当前会话草稿，并记下来源 id（sidecar）：之后不传 id 保存就是更新这一张
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, JSON.parse(JSON.stringify(obj.draft)));
          writeDraftOrigin(k, obj.id, obj.meta ? obj.meta.name : "");
          return ok({ draft: obj.draft, meta: obj.meta, key: k, originId: obj.id, draftStatus: draftStatusFor(k, obj.draft) });
        }
        case "cc_deleteFromLibrary":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          const k = draftKeyFrom(ctx, args);
          const origin = readDraftOrigin(k);
          const wasOrigin = !!(origin && origin.libraryId === id);
          await deleteLibraryEntry(id);
          // 删掉的正是当前草稿的来源卡 → 清掉关联，否则下次保存会「更新」一张已不存在的卡
          if(wasOrigin) writeDraftOrigin(k, null);
          // 0.8.0：关系图谱里不能留下指向已删卡的节点（降级为 orphan 并保留边，见 orphanCardNodes）
          const groupsTouched = await orphanCardNodes(id, "");
          const entries = await listLibraryEntries();
          return ok({ id, remaining: entries.length, originCleared: wasOrigin, groupsTouched });
        }
        case "cc_setOrigin":{
          // 前端显式设/清「当前草稿的来源 id」：id 传 null/空 = 清（清空草稿、另存为新时用）
          const k = draftKeyFrom(ctx, args);
          const id = (typeof args.id === "string" && args.id) ? args.id : null;
          writeDraftOrigin(k, id, args.name);
          return ok({ key: k, originId: id });
        }
        case "cc_renameInLibrary":{
          const id = args.id;
          const newName = args.name;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          if(typeof newName!=="string" || !newName.trim()) return fail("invalid-name","name 必填");
          const meta = await renameLibraryEntry(id, newName);
          // 0.8.0：图谱节点名跟着改（按 cardId 匹配）——否则卡改名后关系里还挂着旧名
          const groupsTouched = await syncCardNodeName(id, newName);
          return ok({ meta, syncedDraftName: true, groupsTouched });
        }
        case "cc_getLibraryEntry":{
          const id = args.id;
          if(typeof id!=="string" || !id) return fail("invalid-id","id 必填");
          const obj = await loadLibraryEntry(id);
          return ok(obj);
        }
        // ———————————————— 人物关系图谱（0.8.0）————————————————
        case "cc_listGroups":{
          const groups = await listGroups();
          const entries = await listLibraryEntries();
          const countOf = (gid) => entries.filter(e => String(e.groupId || "") === gid).length;
          const out = [];
          for(const g of groups){
            const b = await readBookRaw(g.id);   // 组级共享世界书摘要（UI 要在分组标题上显示「共享 N 条」）
            out.push({
              id: g.id, name: g.name, note: g.note,
              nodeCount: g.nodes.length, edgeCount: g.edges.length,
              memberCount: countOf(g.id), rev: g.rev, updatedAt: g.updatedAt,
              hasBook: !!b, bookEntries: b ? normalizeBook(b.obj, g.id).data.entries.length : 0,
            });
          }
          return ok({ groups: out });
        }
        case "cc_createGroup":{
          const name = String(args.name || "").trim().slice(0, 60);
          if(!name) return fail("invalid-name", "分组名不能为空");
          // 0.8.0：同名分组默认拒绝 —— 否则侧栏里会出现两个「测试」，人和模型都分不清该往哪个放卡
          // （工具半 cc_create_group 是同一套规则，那边另有 allowDuplicate 逃生门）
          const dup = findGroupByName(await listGroups(), name, "");
          if(dup && args.allowDuplicate !== true) return fail("duplicate-name", "已有同名分组「" + dup.name + "」（id " + dup.id + "）", { existingGroupId: dup.id });
          const g = await writeGroup({ id: newGroupId(), name, note: String(args.note || "").slice(0, 200), nodes: [], edges: [] });
          return ok({ group: g });
        }
        case "cc_renameGroup":{
          const found = await readGroupRaw(args.id);
          if(!found) return fail("not-found", "分组不存在: " + String(args.id));
          const g = normalizeGroup(found.obj);
          const changed = [];
          if(typeof args.name === "string" && args.name.trim()){
            const name = args.name.trim().slice(0, 60);
            const dup = findGroupByName(await listGroups(), name, g.id);
            if(dup && args.allowDuplicate !== true) return fail("duplicate-name", "已有同名分组「" + dup.name + "」（id " + dup.id + "）", { existingGroupId: dup.id });
            if(name !== g.name){ g.name = name; changed.push("name"); }
          }
          if(typeof args.note === "string" && args.note.slice(0, 200) !== g.note){ g.note = args.note.slice(0, 200); changed.push("note"); }
          // 无实际改动不写盘（同 N4 家规：空改动不该白涨 rev，否则别人手上的 rev 前提会被无变化打掉）
          if(!changed.length) return ok({ group: g, changed: [] });
          return ok({ group: await writeGroup(g), changed });
        }
        case "cc_deleteGroup":{
          const removed = await deleteGroupFile(args.id);
          if(!removed) return fail("not-found", "分组不存在: " + String(args.id));
          const gid = safeGroupId(args.id);
          const entries = await listLibraryEntries();
          let memberCleared = 0;
          for(const e of entries){
            if(String(e.groupId || "") !== gid) continue;
            try{ await patchLibraryMeta(e.id, { groupId: null }); memberCleared += 1; }catch{}
          }
          // 0.9.0：组级共享世界书随组一起删（它属于这个组，留下就是孤儿文件）
          const bookDeleted = await deleteBook(gid);
          return ok({ deleted: removed, memberCleared, bookDeleted });
        }
        case "cc_setCardGroup":{
          const cardId = String(args.cardId || "");
          if(!cardId) return fail("invalid-card", "需要 cardId");
          const want = (args.groupId === null || args.groupId === undefined || args.groupId === "") ? null : safeGroupId(args.groupId);
          // 走与工具半**同一份** assignCardToGroup：自动补节点、复活同名 orphan 节点、移出时保留节点与边
          try{
            const r = await assignCardToGroup(cardId, want);
            return ok({ cardId: r.cardId, groupId: r.groupId, nodeId: r.nodeId, previousGroupId: r.previousGroupId, revived: r.revived === true });
          }catch(e){
            if(e && e.code === "ENOENT") return fail("not-found", "库里找不到这张卡: " + cardId);
            if(e && e.code === "not-found") return fail("not-found", "分组不存在: " + want);
            throw e;
          }
        }
        case "cc_getGroup":{
          const found = await readGroupRaw(args.id);
          if(!found) return fail("not-found", "分组不存在: " + String(args.id));
          const g = normalizeGroup(found.obj);
          const cards = await libraryCardsFor(await groupMemberIds(g.id));
          return ok({ group: g, members: cards.map(c => ({ id: c.id, name: c.name })), rev: g.rev });
        }
        case "cc_patchGroup":{
          const found = await readGroupRaw(args.id);
          if(!found) return fail("not-found", "分组不存在: " + String(args.id));
          const cur = normalizeGroup(found.obj);
          if(typeof args.expectedRev === "number" && args.expectedRev !== cur.rev){
            return fail("stale-rev", "分组已被外部修改（期望 rev=" + args.expectedRev + "，实际 rev=" + cur.rev + "）—— 先重新读取再改", { staleGroupRev: true, expectedRev: args.expectedRev, actualRev: cur.rev });
          }
          const applied = applyGroupOps(cur, args.ops);
          if(!applied.applied.length) return ok({ group: cur, applied: [], rejected: applied.rejected, changed: false });
          const saved = await writeGroup(applied.group);
          return ok({ group: saved, applied: applied.applied, rejected: applied.rejected, changed: true });
        }
        case "cc_groupCheck":{
          // 0.10.0：组 / 成员 / 共享书都从卡组作用域取（与预设半同一个入口、同一次读盘）。
          const scope = await groupScope({ groupId: args.id });
          if(!scope.ok || !scope.group) return fail("not-found", "分组不存在: " + String(args.id));
          const g = scope.group;
          const cards = await libraryCardsFor(scope.memberIds);
          // 0.9.0：把该组的共享世界书也端给体检 —— 它的 constant 条目在群聊里同样每轮插入
          // 0.10.0：检查项走卡组层的注册表（structure / relations / budget / lore-quality / cross-card），
          // 用 args.checks 可只跑指定类别；返回带 byCheck 便于界面分组显示。
          const res = checkGroup(g, scope.memberIds, cards, scope.book ? scope.book.entries : [],
            { checks: args.checks, metrics: metricsForGroup(scope) });
          return ok(Object.assign({ groupId: g.id, rev: g.rev, name: g.name,
            checks: res.ran, byCheck: res.byCheck }, res));
        }
        case "cc_renderRelations":{
          // 渲染进**当前草稿**（与工具半共用同一份草稿文件）；要落库仍需再存一次
          const k = draftKeyFrom(ctx, args);
          const origin = readDraftOrigin(k);
          const cardId = args.cardId ? String(args.cardId) : ((origin && origin.libraryId) || "");
          if(!cardId) return fail("no-card", "这张草稿还没入库（没有来源卡 id）：先在工坊「保存当前」或显式传 cardId");
          const mine = (await listLibraryEntries()).find(e => e.id === cardId);
          const groupId = args.groupId ? safeGroupId(args.groupId) : ((mine && mine.groupId) ? String(mine.groupId) : "");
          if(!groupId) return fail("no-group", "这张卡还没有加入任何分组");
          const found = await readGroupRaw(groupId);
          if(!found) return fail("not-found", "分组不存在: " + groupId);
          const g = normalizeGroup(found.obj);
          const myNode = g.nodes.find(n => n.kind === "card" && n.cardId === cardId);
          if(!myNode) return fail("no-node", "分组里没有这张卡的节点：先在工坊关系视图里把它加入分组");
          const section = renderRelationsSection(myNode.id, g.nodes, g.edges, { includeIncoming: args.includeIncoming === true });
          const draft = getDraftFor(k);
          const before = String((draft.data && draft.data.description) || "");
          const after = spliceRelations(before, section, "rev=" + g.rev + " group=" + g.id);
          const changed = before !== after;
          if(args.dryRun === true) return ok({ changed, preview: after, section, groupId: g.id, rev: g.rev });
          if(changed){
            const copy = JSON.parse(JSON.stringify(draft));
            copy.data.description = after;
            setDraftFor(k, copy);
          }
          return ok({ changed, groupId: g.id, rev: g.rev, description: after });
        }
        // ———————————————— 组级共享世界书（0.9.0）————————————————
        // 一本书对一个分组，存 <主根>/cc-books/<groupId>.json（本身就是可发布的 lorebook_v3 JSON）。
        case "cc_getBook":{
          const gid = safeGroupId(args.groupId);
          if(!gid) return fail("invalid-group", "需要 groupId");
          const found = await readBookRaw(gid);
          const cards = await bookCardsFor(await groupMemberIds(gid));
          const book = found ? normalizeBook(found.obj, gid) : null;
          // 把书一起交给 scan → 认得出「卡内条目与共享书逐字重复」那一类（报告 P1）
          const scan = scanSharedEntries(cards, book ? book.data.entries : []);
          const cardList = cards.map(c => ({ id: c.id, name: c.name, entries: (c.entries || []).length }));
          if(!found) return ok({ exists: false, groupId: gid, cards: cardList, scan });
          return ok({ exists: true, groupId: gid, book, rev: bookRevOf(book),
            tokens: estimateTokensLite(book.data.entries.map(e => e.content).join("\n")),
            cards: cardList, scan });
        }
        case "cc_patchBook":{
          const gid = safeGroupId(args.groupId);
          if(!gid) return fail("invalid-group", "需要 groupId");
          const found = await readBookRaw(gid);
          const cur = found ? normalizeBook(found.obj, gid) : await newBookFor(gid, args.name);
          if(typeof args.expectedBookRev === "number" && args.expectedBookRev !== bookRevOf(cur)){
            return fail("stale-rev", "共享世界书已被外部修改（期望 rev=" + args.expectedBookRev + "，实际 rev=" + bookRevOf(cur) + "）—— 先重新读取再改",
              { staleBookRev: true, expectedBookRev: args.expectedBookRev, actualBookRev: bookRevOf(cur) });
          }
          const applied = [], rejected = [];
          if(args.name !== undefined) cur.data.name = String(args.name).slice(0, 80);
          if(args.description !== undefined) cur.data.description = String(args.description).slice(0, 300);
          if(args.scan_depth !== undefined) cur.data.scan_depth = Math.max(1, Math.round(Number(args.scan_depth) || 4));
          if(args.token_budget !== undefined) cur.data.token_budget = Math.max(100, Math.round(Number(args.token_budget) || 2000));
          if(args.recursive_scanning !== undefined) cur.data.recursive_scanning = args.recursive_scanning === true;
          ["name", "description", "scan_depth", "token_budget", "recursive_scanning"].forEach(k => { if(args[k] !== undefined) applied.push({ op: "setMeta", field: k }); });
          (Array.isArray(args.ops) ? args.ops : []).forEach(op => {
            const kind = String((op && op.op) || "");
            if(kind === "addEntry"){
              const e = makeBookEntry(op.entry);
              if(!e.content.trim()){ rejected.push({ op, error: "content 不能为空" }); return; }
              if(cur.data.entries.some(x => contentKeyOf(x) === contentKeyOf(e))){ rejected.push({ op, error: "同内容的条目已存在" }); return; }
              if(cur.data.entries.length >= BOOK_MAX_ENTRIES){ rejected.push({ op, error: "条目数已达上限 " + BOOK_MAX_ENTRIES }); return; }
              cur.data.entries.push(e);
              applied.push({ op: kind, key: contentKeyOf(e), name: e.name });
            } else if(kind === "updateEntry"){
              const idx = cur.data.entries.findIndex(x => contentKeyOf(x) === String(op.contentKey || ""));
              if(idx < 0){ rejected.push({ op, error: "找不到条目（contentKey 不匹配）" }); return; }
              const patch = (op.patch && typeof op.patch === "object") ? op.patch : {};
              cur.data.entries[idx] = makeBookEntry(Object.assign({}, cur.data.entries[idx], patch));
              applied.push({ op: kind, key: contentKeyOf(cur.data.entries[idx]) });
            } else if(kind === "removeEntry"){
              // 支持两种定位：`index`（UI 列表直接用它）或 `contentKey`（模型读到的签名）
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
          if(!applied.length) return ok({ book: cur, rev: bookRevOf(cur), applied: [], rejected, changed: false });
          const saved = await writeBook(gid, cur);
          return ok({ book: saved, rev: bookRevOf(saved), applied, rejected, changed: true });
        }
        case "cc_promoteBook":{
          const gid = safeGroupId(args.groupId);
          if(!gid) return fail("invalid-group", "需要 groupId");
          const found = await readBookRaw(gid);
          const cur = found ? normalizeBook(found.obj, gid) : await newBookFor(gid);   // 默认名 `<组名>·共享设定`（报告 4.2）
          const cards = await bookCardsFor(await groupMemberIds(gid));
          // 候选两类：卡间重复（提升进书）+ 卡内条目与共享书逐字重复（书里已有，只清卡内副本）—— 见 agent 半同一处注释
          const scan = scanSharedEntries(cards, cur.data.entries);
          const known = new Map(scan.candidates.concat(scan.bookDupes).map(c => [c.signature, c]));
          // 只认得扫描出来的候选：传了不存在的签名一律拒绝 —— 这是会**从多张卡里删条目**的操作，绝不猜
          const requested = (Array.isArray(args.keys) && args.keys.length) ? args.keys.map(String)
            : scan.candidates.map(c => c.signature).concat(scan.bookDupes.map(c => c.signature));
          const unknownKeys = requested.filter(s => !known.has(s));
          const use = requested.filter(s => known.has(s));
          const bookSigs = new Set(cur.data.entries.map(contentKeyOf));
          const promoteSigs = use.filter(s => !bookSigs.has(s));
          const cleanSigs = use.filter(s => bookSigs.has(s));
          const plan = applyBookPromotion(cards, cur.data.entries, use);
          const summary = (g) => ({ kind: g.kind || "card-vs-card", signature: g.signature, name: g.name, cards: g.cards.length, cardNames: g.cardNames,
            chars: g.chars, savedChars: g.savedChars, nameMismatch: g.nameMismatch === true, keysMismatch: g.keysMismatch === true, preview: g.preview });
          if(args.apply !== true){
            return ok({ dryRun: true, changed: false, wouldPromote: promoteSigs.length, wouldClean: cleanSigs.length, unknownKeys,
              removedTotal: plan.removedTotal, savedChars: plan.savedChars,
              perCard: plan.cards.map(c => ({ id: c.id, name: c.name, removed: c.removed, left: c.entries.length })),
              candidates: scan.candidates.map(summary), bookDuplicates: scan.bookDupes.map(summary), stats: scan.stats, rev: bookRevOf(cur) });
          }
          const bookNext = Object.assign({}, cur, { data: Object.assign({}, cur.data, { entries: plan.bookEntries }) });
          const saved = await writeBook(gid, bookNext);
          const touched = [];
          for(const c of plan.cards){
            if(!c.removed) continue;
            try{
              const rawOne = await readLibraryRaw(c.id);
              const obj = JSON.parse(rawOne.raw);
              obj.draft.data.character_book = Object.assign({}, obj.draft.data.character_book, { entries: c.entries });
              if(obj.meta){ obj.meta.loreCount = c.entries.length; obj.meta.updatedAt = nowSec(); }   // 只更新这两个字段，其余 meta 原样保留（B4 的教训：绝不重建 meta）
              await writeFile(rawOne.path, JSON.stringify(obj, null, 2), "utf8");
              touched.push({ id: c.id, name: c.name, removed: c.removed, left: c.entries.length });
            }catch(e){ touched.push({ id: c.id, name: c.name, error: String(e && e.message || e) }); }
          }
          const promotedCopies = cards.reduce((n, c) => n + (Array.isArray(c.entries) ? c.entries.filter(e => promoteSigs.indexOf(contentKeyOf(e)) >= 0).length : 0), 0);
          const cleaned = Math.max(0, plan.removedTotal - promotedCopies);
          return ok({ dryRun: false, changed: true, promoted: plan.promoted.length, cleaned, removedTotal: plan.removedTotal,
            unknownKeys, bookRev: bookRevOf(saved), bookEntries: saved.data.entries.length, perCard: touched,
            candidates: scan.candidates.map(summary), bookDuplicates: scan.bookDupes.map(summary), stats: scan.stats });
        }
        case "cc_applyBook":{
          const gid = safeGroupId(args.groupId);
          if(!gid) return fail("invalid-group", "需要 groupId");
          const found = await readBookRaw(gid);
          if(!found) return fail("not-found", "这个分组还没有共享世界书");
          const cur = normalizeBook(found.obj, gid);
          const k = draftKeyFrom(ctx, args);
          const origin = readDraftOrigin(k);
          const cardId = args.cardId ? String(args.cardId) : ((origin && origin.libraryId) || "");
          if(!cardId) return fail("no-card", "没有指定 cardId，当前草稿也没有来源卡（先保存到侧边栏）");
          const rawOne = await readLibraryRaw(cardId);
          const obj = JSON.parse(rawOne.raw);
          const cardEntries = (obj.draft && obj.draft.data && obj.draft.data.character_book && Array.isArray(obj.draft.data.character_book.entries))
            ? obj.draft.data.character_book.entries : [];
          const merged = mergeBookEntries(cur.data.entries, cardEntries);
          if(args.dryRun === true){
            return ok({ dryRun: true, cardId, wouldAdd: merged.added.length, bookEntries: cur.data.entries.length, cardEntries: cardEntries.length });
          }
          if(!merged.added.length) return ok({ cardId, added: 0, changed: false, loreCount: cardEntries.length });
          obj.draft.data.character_book = Object.assign({}, obj.draft.data.character_book, { entries: merged.entries });
          if(obj.meta){ obj.meta.loreCount = merged.entries.length; obj.meta.updatedAt = nowSec(); }
          await writeFile(rawOne.path, JSON.stringify(obj, null, 2), "utf8");
          return ok({ cardId, added: merged.added.length, changed: true, loreCount: merged.entries.length });
        }
        case "cc_importFromPng":{
          const b64 = args.b64;
          if(typeof b64!=="string" || !b64) return fail("invalid-b64","b64 必填");
          if(b64.length > 20*1024*1024) return fail("too-large","PNG 过大（>20MB base64）");
          let draft, upgradedFrom = null;
          try{
            const bytes = b64DecodeBytes(b64);
            if(bytes.length > 15*1024*1024) return fail("too-large","PNG 过大（>15MB）");
            draft = extractCardFromPngBytes(bytes);
            // B2：只有 V2 块时也能进（升级而不是拒绝）—— upgradedFrom 让界面把这件事说出来
            upgradedFrom = upgradeCardToV3(draft).from;
            draft = normalizeDraft(draft);
          }catch(e){ return fail("parse-failed", String(e.message)); }
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft), upgradedFrom });
        }
        case "cc_importFromJson":{
          // 工坊拖进来的 .json 走这里（0.9.1，B2）：V2/V1 卡**升级**成 CCv3，而不是让界面报「spec 不符」。
          // 客户端此前自己 parse + 只认 chara_card_v3 —— 于是 ST 里导出的卡一张都进不来。
          const raw = args.json;
          let obj = null;
          try{
            obj = (raw && typeof raw === "object")? raw : JSON.parse(String(raw==null? "" : raw));
          }catch(e){ return fail("parse-failed", "不是合法 JSON："+String(e.message)); }
          // 自家草稿文件 / 导出包是 `{key, updatedAt, rev, draft}`，先脱一层
          if(obj && typeof obj==="object" && obj.draft && typeof obj.draft==="object" && !obj.data) obj = obj.draft;
          let draft, upgradedFrom = null;
          try{
            upgradedFrom = upgradeCardToV3(obj).from;
            draft = normalizeDraft(obj);
          }catch(e){ return fail("invalid-card", String(e.message)); }
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft), upgradedFrom });
        }
        case "cc_exportPng":{
          const k = draftKeyFrom(ctx, args);
          const draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          draft.data.modification_date = nowSec();
          // ST 兼容层（0.9.1）：① 每个 PNG 都写两个块（ccv3 纯 CCv3 + chara 的 V2 投影，见 pngCardChunks）；
          // ② stWorld 非空时，只在**导出副本**上写 `data.extensions.world`（ST 的角色↔世界书绑定）。
          // 返回给客户端的 draft 仍是「草稿本身」（多一个 ST 专有字段都不带），与「并入本卡」同一条家规。
          const exportCard = withStWorld(draft, args.stWorld);
          try{
            let pngBytes;
            if(args.imageB64 && typeof args.imageB64==="string" && args.imageB64.length>0){
              if(args.imageB64.length > 20*1024*1024) return fail("too-large","底图 PNG 过大（>20MB base64）");
              const baseBytes = b64DecodeBytes(args.imageB64);
              pngBytes = embedCardIntoPngBytes(baseBytes, exportCard);
            } else {
              pngBytes = buildPngWithCard(exportCard);
            }
            return ok({ b64: Buffer.from(pngBytes).toString("base64"), filename: (draft.data.name||"card")+".png", draft });
          }catch(e){ return fail("build-failed", String(e.message)); }
        }
        case "cc_importFromCharx":{
          const b64 = args.b64;
          if(typeof b64!=="string" || !b64) return fail("invalid-b64","b64 必填");
          if(b64.length > 30*1024*1024) return fail("too-large","CHARX 过大（>30MB base64）");
          let draft, upgradedFrom = null;
          try{
            const bytes = b64DecodeBytes(b64);
            if(bytes.length > 22*1024*1024) return fail("too-large","CHARX 过大（>22MB）");
            const entries = parseZipEntries(bytes);
            let cardEntry = entries.find(e=> e.name==="card.json" || e.name.endsWith("/card.json"));
            if(!cardEntry) cardEntry = entries.find(e=> e.name.toLowerCase().endsWith(".json"));
            if(!cardEntry) return fail("parse-failed","CHARX 未找到 card.json");
            const jsonStr = bytesToStr(cardEntry.data);
            const obj = JSON.parse(jsonStr);
            upgradedFrom = upgradeCardToV3(obj).from;
            draft = normalizeDraft(obj);
          }catch(e){ return fail("parse-failed", String(e.message)); }
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft), upgradedFrom });
        }
        case "cc_exportCharx":{
          const k = draftKeyFrom(ctx, args);
          const draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          draft.data.modification_date = nowSec();
          // ST 兼容层（0.9.1）：只在**导出副本**上写世界书绑定，草稿/库里的卡不动（同「并入本卡」家规）
          const exportCard = withStWorld(draft, args.stWorld);
          try{
            const zipBytes = buildZipCharx(exportCard);
            return ok({ b64: Buffer.from(zipBytes).toString("base64"), filename: (draft.data.name||"card")+".charx", draft });
          }catch(e){ return fail("build-failed", String(e.message)); }
        }
        default:
          return fail("unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
      }
    }catch(e){
      return fail("internal-error", e && e.message ? String(e.message) : String(e));
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: RPC_CHANNEL,
    handler: async (req, res) => {
      const url = req.url || "/";
      const q = url.indexOf("?");
      const pathname = q===-1 ? url : url.slice(0, q);
      const endpoint = endpointFromPath(pathname);
      if(!endpoint){ sendEnvelope(res, 404, rpcError("not-found", "not-found", "not found", {})); return; }
      // connection 服务的 host/origin 围栏 + 浏览器会话鉴权：插件不能绕过它
      const connection = ctx.get("connection");
      if(connection && typeof connection.requestRejection === "function"){
        const rejection = connection.requestRejection(req);
        if(rejection!==undefined){ res.statusCode = rejection; res.end(rejection===401 ? "unauthorized" : "forbidden"); return; }
      }
      if(req.method!=="POST"){ res.statusCode = 405; res.setHeader("allow","POST"); res.end(); return; }
      const ctype = String(req.headers["content-type"]||"").split(";",1)[0].trim().toLowerCase();
      if(ctype!=="application/json"){ sendEnvelope(res, 415, rpcError("invalid-request","gateway/bad-request","content type must be application/json",{})); return; }
      let text;
      try{ text = await readBoundedBody(req, RPC_MAX_BODY_BYTES); }
      catch(e){ sendEnvelope(res, 400, rpcError("invalid-request","gateway/bad-request","body read failed",{})); return; }
      if(text===undefined){ sendEnvelope(res, 413, rpcError("invalid-request","gateway/bad-request","request body too large",{})); return; }
      let message;
      try{ message = JSON.parse(text); }
      catch{ sendEnvelope(res, 400, rpcError("invalid-request","gateway/bad-request","body is not JSON",{})); return; }
      // 与 client-connection clientRequestSchema 同一外层信封校验
      if(!message || typeof message!=="object" || Array.isArray(message) || message.type!=="client-request"
         || typeof message.rpcId!=="string" || typeof message.method!=="string" || !("payload" in message)){
        sendEnvelope(res, 400, rpcError("invalid-request","gateway/bad-request","invalid client-request message",{})); return;
      }
      const rpcId = message.rpcId;
      if(message.method!==endpoint){
        sendEnvelope(res, 200, rpcError(rpcId, "gateway/bad-request",
          `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, {}));
        return;
      }
      let result;
      try{ result = await dispatch(endpoint, message.payload, undefined); }
      catch(e){ sendEnvelope(res, 500, rpcError(rpcId, "internal", String(e && e.message ? e.message : e), {})); return; }
      sendEnvelope(res, 200, rpcFull(rpcId, result));
    }
  }), "dsh-cc-studio: POST "+RPC_CHANNEL+"/*");
}

// ——————————————————————————————————————————————————————————————
// 组级共享世界书（0.9.0）：一份 JSON 整组共用，成员卡里只留角色私有条目
//
// 为什么：群聊卡的世界设定（年表/势力/地理/力量/日常）在每张成员卡里**逐字重复**。实测一组
// 4 张卡共 20 条，其中 5 条是完全相同的同一份设定（约 4500 字符纯冗余），改一条要改 4 遍。
// CCv3 规范本身给了两个依据：① Lorebook 可以**单独导出** —— `{ spec: "lorebook_v3", data: Lorebook }`；
// ② `character_book` 是「角色专属」的那一本，规范明说它应当能与一个全局 lorebook **叠加**。
// 所以把共享设定提到组级独立文件，客户端里绑成全局/世界书即可，成员卡不必再存。
//
// 存储：<主根>/cc-books/<groupId>.json —— **一本书对一个分组**；文件本身就是可直接发布的
// lorebook_v3 JSON（拷出去别人就能用），插件自己的状态放 `data.extensions.cc`（规范允许）。
// 条目字段与卡内 `character_book.entries` **完全同构** —— 提升/回填都是零转换搬运。
//
// ⚠️ 0.9.1：这个文件是给**认 CCv3 的客户端**的，**SillyTavern 不认** —— ST 服务端
// `/api/worldinfo/import` 拿到文件第一件事就是 `if (!('entries' in worldContent)) throw`
// （用户实机：拖 `.lorebook.json` 进去 = `Error importing world info: … Bad Request`；
// 1.19.0 的客户端 `importWorldInfo()` 也只转 Novel / Agnai / Risu，整份 `world-info.js`
// 搜不到 `lorebook_v3`）。所以工坊导出页另给一枚「SillyTavern 世界书」：ST 原生形态
// `{entries:{…}}`，条目字段按 ST 自己的 `convertCharacterBook()` 映射 —— 两枚按钮各有读者，
// **别把其中一个说成「就是给客户端的通用格式」**（这正是 0.9.0 那轮写错边界的同一个毛病）。
// ——————————————————————————————————————————————————————————————
const BOOK_SPEC = "lorebook_v3";
const BOOK_MAX_ENTRIES = 200;

function bookDirs(){ return dataRoots("cc-books"); }
function bookDir(){ return bookDirs()[0]; }
function bookPath(groupId){ return join(bookDir(), safeGroupId(groupId) + ".json"); }
async function ensureBookDir(){ try{ await mkdir(bookDir(), { recursive: true }); }catch{} }

/** 条目归一化：**只补缺、不裁剪** —— CCv3 要求应用把不认识的字段也原样保存（否则导入的书会被削掉）。 */
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
/** 插件自己的状态挂在 data.extensions.cc（rev 与分组 id）—— 读取都走这里。 */
function bookCcOf(obj){
  const data = (obj && obj.data && typeof obj.data === "object") ? obj.data : {};
  const ext = (data.extensions && typeof data.extensions === "object") ? data.extensions : {};
  return (ext.cc && typeof ext.cc === "object") ? ext.cc : {};
}
function bookRevOf(obj){ const n = Number(bookCcOf(obj).rev); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
/** 结构兜底：缺字段补默认、条目逐条归一；`data` 之外的未知顶层字段也保留。 */
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
/** 读盘：主根没有就回退旧根（与角色库/分组同一套规则）。 */
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
/** 写盘：rev 每次 +1（与 writeGroup 同一套乐观锁语义）。 */
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
/** 删书：两个根里的同名副本都删（否则回退读会把刚删的书「复活」）。返回是否删到了。 */
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
/**
 * 内容签名：见 lib/group-layer.js 的 `contentKeyOf()`（只用来筛，动手前一律再逐字比对内容 ——
 * 哈希碰撞绝不能变成删数据）。
 */
/** 成员卡的**完整**条目（去重要比内容，摘要不够）—— 0.10.0 起吃卡库快照，不再逐卡重复读盘。 */
async function bookCardsFor(ids){
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
      name: String(d.name || (row.meta && row.meta.name) || ""),
      entries: entries.map(makeBookEntry),
    });
  }
  return out;
}
/**
 * 跨成员卡找「同一份设定」（纯函数）：按内容签名分组，出现在 **≥2 张卡**里的才算候选。
 * 只报候选、不下结论 —— 同内容不同名、同名不同内容都如实标注，交给用户/模型拍板。
 */
/**
 * 新建共享书的默认名：`<组名>·共享设定`（拿不到组名才退回「共享设定」）。
 * 第二轮报告 4.2：同一个人的多个组各建一本、全叫「共享设定」，导出成文件后根本分不清是哪一组。
 * 两半同构（`tests/shared-book.test.mjs` 直接比对），改这里记得同步 `lib/agent.js`。
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
function scanSharedEntries(cards, bookEntries){
  const list = Array.isArray(cards) ? cards : [];
  const seen = new Map();
  list.forEach(c => {
    (Array.isArray(c.entries) ? c.entries : []).forEach(e => {
      if(!String((e && e.content) || "").trim()) return;   // 空内容不会进 prompt，不参与
      const sig = contentKeyOf(e);
      if(!seen.has(sig)) seen.set(sig, { signature: sig, content: String(e.content), name: String(e.name || ""), keys: (e.keys || []).map(String), constant: e.constant === true, chars: String(e.content).length, cards: [], cardNames: [], nameMismatch: false, keysMismatch: false });
      const g = seen.get(sig);
      if(g.cards.indexOf(c.id) < 0){ g.cards.push(c.id); g.cardNames.push(c.name); }
      if(String(e.name || "") !== g.name) g.nameMismatch = true;
      if(JSON.stringify((e.keys || []).map(String)) !== JSON.stringify(g.keys)) g.keysMismatch = true;
    });
  });
  const candidates = [...seen.values()].filter(g => g.cards.length >= 2)
    .sort((a, b) => b.cards.length - a.cards.length || b.chars - a.chars)
    .map(g => Object.assign({}, g, { preview: g.content.slice(0, 80).replace(/\s+/g, " "), savedChars: g.chars * (g.cards.length - 1) }));
  // 第二轮报告 P1：还有一类重复是「卡 ↔ 共享书」—— `cc_apply_shared_book` 回填进卡里的副本。
  // 它和「卡间重复」的**动作不同**：书里已经有了，只需把卡里那份删掉，不必再往书里搬。
  // 判据同样是**逐字相符**（签名只用来筛候选）；回填过的、手工抄进卡的都算。
  const bookDupes = [];
  (Array.isArray(bookEntries) ? bookEntries : []).forEach(be => {
    const content = String((be && be.content) == null ? "" : be.content);
    const g = content.trim() ? seen.get(contentKeyOf(be)) : null;
    if(!g || g.content !== content) return;
    bookDupes.push({ kind: "card-vs-book", signature: g.signature, name: String((be && be.name) || g.name || ""),
      content, keys: (be.keys || []).map(String), chars: content.length,
      cards: g.cards.slice(), cardNames: g.cardNames.slice(),
      preview: content.slice(0, 80).replace(/\s+/g, " "), savedChars: content.length * g.cards.length });
  });
  const totalEntries = list.reduce((n, c) => n + (Array.isArray(c.entries) ? c.entries.length : 0), 0);
  return {
    candidates, bookDupes,
    stats: {
      cards: list.length, totalEntries,
      duplicatedEntries: candidates.reduce((n, g) => n + g.cards.length, 0),
      savedChars: candidates.reduce((n, g) => n + g.savedChars, 0),
      bookDuplicatedEntries: bookDupes.reduce((n, g) => n + g.cards.length, 0),
      bookDupeCount: bookDupes.length,
      bookSavedChars: bookDupes.reduce((n, g) => n + g.savedChars, 0),
    },
  };
}
/** 把共享书的条目合并进一张卡的条目表（同内容已存在则跳过）—— 给不支持全局世界书的客户端兜底。 */
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
/**
 * 提升（纯函数）：把指定签名的条目写进共享书，并从**每一张**出现过它的成员卡里删掉。
 * 只删内容逐字相同（折叠空白后相同）的那几条 —— 签名只用来筛，动手前再比对内容。
 */
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

export { apply, inject, name, planPresetInstall, installCcPreset, supportsDeclaredPresets, presetTargetRoot, presetSourceRoot,
  draftKeyPartsFrom, draftContentSummary, listDraftSlotsOnDisk, migrateDraftDecision,
  // 卡组层（0.10.0）：卡库快照 + 卡组作用域 —— 卡组数据的唯一入口，两半共用 lib/group-layer.js 的纯组装
  readLibrarySnapshot, groupScope,
  // 落盘根与 lib 层 CRUD（供回归测试直接断言「DSH_HOME 优先 + 读时回退」）
  dshHomeDir, legacyDshHomeDir, dataRoots, draftDirs, draftDir, draftPath, findDraftPath, safeDraftFile,
  persistDraftSync, loadPersistedDraftSync, libDirs, libDir, getDraftFor, setDraftFor, cardFingerprint, normalizeCardShape,
  // 草稿来源 id 的 sidecar（0.5.0）：两半同构，测试直接交叉读写验证互通
  readDraftOrigin, writeDraftOrigin, originFilePath,
  listLibraryEntries, saveLibraryEntry, loadLibraryEntry, deleteLibraryEntry, renameLibraryEntry,
  // 人物关系图谱（0.8.0）：纯函数 + 落盘，供 tests/relations.test.mjs 直接断言、并与工具半逐字比对同构实现
  groupDirs, groupDir, groupPath, safeGroupId, newGroupId, normalizeGroup, validateGroupOp, applyGroupOps,
  renderRelationsSection, spliceRelations, checkGroup, listGroups, readGroupRaw, writeGroup, deleteGroupFile,
  groupMemberIds, libraryCardsFor, patchLibraryMeta, orphanCardNodes, syncCardNodeName, estimateTokensLite,
  // 0.8.0 分组管理：出边口径（渲染与计数共用）、建组查重、归位/建节点 —— 与工具半逐字同构，测试直接比对
  outgoingEdgesOf, findGroupByName, assignCardToGroup,
  // 0.9.0 组级共享世界书：落盘 + 纯函数（扫描/提升/回填），两半同构、条目与卡内 character_book 同形
  BOOK_SPEC, bookDirs, bookDir, bookPath, makeBookEntry, normalizeBook, bookRevOf, readBookRaw, writeBook, deleteBook,
  contentKeyOf, bookCardsFor, scanSharedEntries, mergeBookEntries, applyBookPromotion,
  // 0.9.1 SillyTavern 兼容层：PNG 双块（chara 的 V2 投影 + 纯 CCv3）、ccv3 优先读取、ST 世界书绑定
  stV2Projection, stripDecorators, withStWorld, pngCardChunks, buildTEXtChunk, buildPngWithCard, embedCardIntoPngBytes, extractCardFromPngBytes,
  // 0.9.1 B2：V2/V1 卡升级成 CCv3（PNG/CHARX/JSON 三条导入路径共用这一份实现）
  upgradeCardToV3, normTags,
  REL_TYPES, REL_TYPE_LABELS, REL_BEGIN, REL_END };


