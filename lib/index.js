/**
 * @dsh-plugins/dsh-cc-studio — host half.
 * CCv3 工坊：校验 + 共享草稿（供 CC 模式的 LLM Tools 与浏览器胶囊同步）+ 已存角色侧边栏落盘。
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { inflateSync as zlibInflateSync } from "node:zlib";

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
if(!globalThis.__CC_DRAFTS__) globalThis.__CC_DRAFTS__ = new Map();
// —— 草稿持久化（fix #2）：~/.dsh/cc-drafts/<session>.json，变更即落盘，重启后按会话 id 恢复 ——
if(!globalThis.__CC_DRAFT_META__) globalThis.__CC_DRAFT_META__ = new Map();
function draftDir(){
  try{ return join(homedir(), ".dsh", "cc-drafts"); }catch{ return join(process.cwd(), ".cc-drafts"); }
}
function safeDraftFile(key){
  const raw = String(key || "default");
  let h = 0;
  for(let i=0;i<raw.length;i++){ h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0; }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  const safe = (raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48)) || "default";
  return safe + "-" + hex + ".json";
}
function draftPath(key){ return join(draftDir(), safeDraftFile(key)); }
function loadPersistedDraftSync(key){
  try{
    const raw = readFileSync(draftPath(key), "utf8");
    const obj = JSON.parse(raw);
    const d = obj && obj.draft ? obj.draft : null;
    if(d && typeof d === "object" && d.spec === "chara_card_v3" && d.data && typeof d.data === "object") return d;
  }catch{}
  return null;
}
function persistDraftSync(key, draft){
  try{
    mkdirSync(draftDir(), { recursive: true });
    writeFileSync(draftPath(key), JSON.stringify({ key: String(key), updatedAt: nowSec(), draft }, null, 2), "utf8");
  }catch(e){ try{ console.error("[dsh-cc-studio] persist draft failed:", (e && e.message) || e); }catch{} }
}
function draftMeta(key){
  const k = key || "default";
  if(!globalThis.__CC_DRAFT_META__.has(k)) globalThis.__CC_DRAFT_META__.set(k, { isNew: false, recovered: false });
  return globalThis.__CC_DRAFT_META__.get(k);
}
function draftStatusFor(key, draft){
  const m = draftMeta(key);
  return { isNew: !!m.isNew, recovered: !!m.recovered, creation_date: (draft && draft.data) ? draft.data.creation_date : null, key: String(key) };
}
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
  if(!globalThis.__CC_DRAFTS__.has(k)){
    // fix #2：内存 miss 时先尝试从磁盘恢复，而非静默建空
    const restored = loadPersistedDraftSync(k);
    if(restored){
      globalThis.__CC_DRAFTS__.set(k, restored);
      const m = draftMeta(k); m.isNew = false; m.recovered = true;
    } else {
      globalThis.__CC_DRAFTS__.set(k, makeDefaultDraft());
      const m = draftMeta(k); m.isNew = true; m.recovered = false;
    }
  }
  return globalThis.__CC_DRAFTS__.get(k);
}
function setDraftFor(key, draft){
  draft.data.modification_date = nowSec();
  const k = key || "default";
  globalThis.__CC_DRAFTS__.set(k, draft);
  const m = draftMeta(k); m.isNew = false; m.recovered = false;
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

// —— 已存角色侧边栏：落盘到 ~/.dsh/cc-library/<id>.json ——
function libDir(){
  try{ return join(homedir(), ".dsh", "cc-library"); }catch{ return join(process.cwd(), ".cc-library"); }
}
async function ensureLibDir(){
  const dir = libDir();
  await mkdir(dir, { recursive: true });
  return dir;
}
// ========== PNG / CHARX 共享 ==========
function normalizeDraft(d){
  if(!d || typeof d!=="object") throw new Error("draft 必须是对象");
  if(!d.spec) throw new Error("缺少 spec");
  if(d.spec!=="chara_card_v3") throw new Error("spec 需为 chara_card_v3，当前 "+String(d.spec));
  if(!d.data || typeof d.data!=="object") throw new Error("缺少 data");
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
  let found=null;
  let lastError=null;
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
          const keyword=bytesToStr(data.slice(0,zero));
          const text=bytesToStr(data.slice(zero+1));
          const kw=String(keyword).trim().toLowerCase();
          if(kw==="ccv3" || kw==="ccv3_card" || kw==="chara" || kw==="chara_card_v3"){
            let jsonStr=text.trim();
            try{ const decoded=bytesToStr(b64DecodeBytes(jsonStr)); if(decoded.trim().startsWith("{")) jsonStr=decoded; }catch{}
            const obj=JSON.parse(jsonStr);
            if(obj && obj.spec){ found=obj; break; }
            if(obj && obj.data){ found={spec:"chara_card_v3",spec_version:"3.0",data:obj}; break; }
          }
        }
      }catch(e){ lastError=e; }
    } else if(type==="zTXt" || type==="iTXt"){
      lastError=new Error("检测到 "+type+" 压缩块，请用 tEXt 格式导出（当前仅支持 tEXt ccv3）");
    }
    if(type==="IEND") break;
    off+=12+len;
  }
  if(!found) throw new Error(lastError? String(lastError.message):"PNG 未找到 ccv3/chara 块（tEXt ccv3），请确认是否为 CCv3 PNG");
  if(found.data) return found;
  throw new Error("PNG 内卡格式错误");
}
function buildTEXtChunk(cardJson){
  const jsonStr=JSON.stringify(cardJson);
  const b64=Buffer.from(jsonStr,"utf8").toString("base64");
  const keyword=strToBytes("ccv3");
  const textBytes=strToBytes(b64);
  const chunkData=concatBytes([keyword, new Uint8Array([0]), textBytes]);
  const typeBytes=strToBytes("tEXt");
  const crc=crc32(concatBytes([typeBytes, chunkData]));
  return concatBytes([u32be(chunkData.length), typeBytes, chunkData, u32be(crc)]);
}
function buildPngWithCard(cardJson){
  const chunk=buildTEXtChunk(cardJson);
  const baseB64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  const base=new Uint8Array(Buffer.from(baseB64,"base64"));
  const iendOff=base.length-12;
  const head=base.slice(0,iendOff);
  const tail=base.slice(iendOff);
  return concatBytes([head, chunk, tail]);
}
function embedCardIntoPngBytes(pngBytes, cardJson){
  if(pngBytes.length<8 || pngBytes[0]!==0x89 || pngBytes[1]!==0x50) throw new Error("不是合法 PNG（缺少 PNG 签名）");
  if(pngBytes.length > 15*1024*1024) throw new Error("PNG 过大（>15MB）");
  const newChunk=buildTEXtChunk(cardJson);
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
      parts.push(newChunk);
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
// 用经典 data/end/error 事件读取请求体：IncomingMessage 的异步迭代在本运行时
// 会在读取时抛错（连 client-connection 自带的 /api 帧也因此拿不到 body），
// 事件形式则是各版本都稳定的路径。
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

// ========== CC 预设自动安装 ==========
// 背景：预设此前必须手工拷到 <DSH_HOME>/.agent-presets/cc。但 dsh 的预设发现只扫三个根
// ——shipped 根（dsh-agent-presets 包内）+ 部署 config.roots + 用户根 <DSH_HOME>/.agent-presets
// （见 dsh-agent-presets lib/index.js:1300-1310）；插件包内的 presets/ 不在其中，
// 「随包分发」≠「已注册」。所以这里在插件挂载时把模板装进用户根，让「装完插件即有 CC 模式」成立。
//
// 安全策略（绝不静默覆盖用户改动）：
//   · 目标文件不存在                    → 写入模板
//   · 目标与模板一致                    → 不动（只补记安装记录）
//   · 目标与我们上次写入的记录一致      → 是我们装的且用户没改 → 安全更新
//   · 其余（用户改过 / 无记录的历史手工拷贝）→ 跳过并告警，交由用户决定
// 安装记录是目标目录里的 JSON 侧车文件，含每个受管文件写入时的 sha256，
// 因此不依赖版本号比较也能正确判定「这是不是我们写的、用户有没有动过」。
// config.presetInstall: "auto"（默认）| "off" | "force"（连用户改动一起覆盖）
const PRESET_ID = "cc";
const PRESET_MANAGED_FILES = ["preset.yml", "agent.cordis.yml"];
const PRESET_MARKER_FILE = ".dsh-cc-studio-preset.json";
function dshHomeDir(){
  const env = process.env.DSH_HOME;
  if(typeof env === "string" && env.trim().length > 0) return env.trim();
  try{ return join(homedir(), ".dsh"); }catch{ return join(process.cwd(), ".dsh"); }
}
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
 * 把 presets/cc 安装到 <DSH_HOME>/.agent-presets/cc。同步执行（只有两个小文件），幂等。
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
          return ok({ isCc: isCcPreset(ctx, args.sessionId) });
        }
        case "cc_getDraft":{
          const k = draftKeyFrom(ctx, args);
          const d = getDraftFor(k);
          return ok({ draft: d, key: k, isCc: isCcPreset(ctx, args.sessionId), draftStatus: draftStatusFor(k, d) });
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
          return ok({ draft: obj.draft, meta: obj.meta, key: k, draftStatus: draftStatusFor(k, obj.draft) });
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
        case "cc_importFromPng":{
          const b64 = args.b64;
          if(typeof b64!=="string" || !b64) return fail("invalid-b64","b64 必填");
          if(b64.length > 20*1024*1024) return fail("too-large","PNG 过大（>20MB base64）");
          let draft;
          try{
            const bytes = b64DecodeBytes(b64);
            if(bytes.length > 15*1024*1024) return fail("too-large","PNG 过大（>15MB）");
            draft = extractCardFromPngBytes(bytes);
            draft = normalizeDraft(draft);
          }catch(e){ return fail("parse-failed", String(e.message)); }
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft) });
        }
        case "cc_exportPng":{
          const k = draftKeyFrom(ctx, args);
          const draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          draft.data.modification_date = nowSec();
          try{
            let pngBytes;
            if(args.imageB64 && typeof args.imageB64==="string" && args.imageB64.length>0){
              if(args.imageB64.length > 20*1024*1024) return fail("too-large","底图 PNG 过大（>20MB base64）");
              const baseBytes = b64DecodeBytes(args.imageB64);
              pngBytes = embedCardIntoPngBytes(baseBytes, draft);
            } else {
              pngBytes = buildPngWithCard(draft);
            }
            return ok({ b64: Buffer.from(pngBytes).toString("base64"), filename: (draft.data.name||"card")+".png", draft });
          }catch(e){ return fail("build-failed", String(e.message)); }
        }
        case "cc_importFromCharx":{
          const b64 = args.b64;
          if(typeof b64!=="string" || !b64) return fail("invalid-b64","b64 必填");
          if(b64.length > 30*1024*1024) return fail("too-large","CHARX 过大（>30MB base64）");
          let draft;
          try{
            const bytes = b64DecodeBytes(b64);
            if(bytes.length > 22*1024*1024) return fail("too-large","CHARX 过大（>22MB）");
            const entries = parseZipEntries(bytes);
            let cardEntry = entries.find(e=> e.name==="card.json" || e.name.endsWith("/card.json"));
            if(!cardEntry) cardEntry = entries.find(e=> e.name.toLowerCase().endsWith(".json"));
            if(!cardEntry) return fail("parse-failed","CHARX 未找到 card.json");
            const jsonStr = bytesToStr(cardEntry.data);
            const obj = JSON.parse(jsonStr);
            draft = obj && obj.spec ? obj : (obj && obj.data ? obj : null);
            if(!draft) throw new Error("card.json 格式错误");
            draft = normalizeDraft(draft);
          }catch(e){ return fail("parse-failed", String(e.message)); }
          const k = draftKeyFrom(ctx, args);
          setDraftFor(k, draft);
          return ok({ draft, key:k, draftStatus: draftStatusFor(k, draft) });
        }
        case "cc_exportCharx":{
          const k = draftKeyFrom(ctx, args);
          const draft = JSON.parse(JSON.stringify(getDraftFor(k)));
          draft.data.modification_date = nowSec();
          try{
            const zipBytes = buildZipCharx(draft);
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

export { apply, inject, name, planPresetInstall, installCcPreset, presetTargetRoot, presetSourceRoot };


