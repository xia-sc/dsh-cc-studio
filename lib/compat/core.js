/**
 * CCv3 规范核心（0.13.0）—— **纯函数、零 IO**，宿主半（lib/index.js）与预设半（lib/agent.js）
 * 共用；浏览器半**不 import**（client.js 是手写 bundle，factory 只能 require("react")，一律走宿主 RPC）。
 *
 * 边界（家规）：这里只放「CCv3 规范定义的数据变换」—— 卡片升级、装饰器解析/校验、PNG/CHARX 容器、
 * V2 回填投影、独立 lorebook。**平台特有的东西（ST 的 entries 世界书/V2 投影细节/能力差异/绑定）放
 * lib/compat/adapters/*.js**；草稿、落盘、工坊状态属于插件业务，留在 lib/index.js / lib/agent.js。
 *
 * 历史：这些实现此前散在 lib/index.js（PNG/CHARX/升级）与 lib/client.js（ST 世界书转换），
 * 0.13.0 抽到这一层；lib/index.js 继续 re-export 旧名字，避免破坏既有测试与调用方。
 */
import { inflateSync as zlibInflateSync } from "node:zlib";

// ========== 基础字节工具 ==========
let _crcTable=null;
export function crc32(buf){
  if(!_crcTable){
    _crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320 ^ (c>>>1)):(c>>>1); _crcTable[n]=c>>>0; }
  }
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c=_crcTable[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF)>>>0;
}
export function u32be(n){ const b=new Uint8Array(4); b[0]=(n>>>24)&0xFF; b[1]=(n>>>16)&0xFF; b[2]=(n>>>8)&0xFF; b[3]=n&0xFF; return b; }
export function concatBytes(arrs){ let len=0; for(const a of arrs) len+=a.length; const o=new Uint8Array(len); let off=0; for(const a of arrs){ o.set(a,off); off+=a.length; } return o; }
export function strToBytes(s){ return new TextEncoder().encode(String(s)); }
export function bytesToStr(b){ return new TextDecoder().decode(b); }
export function b64DecodeBytes(b64){ return new Uint8Array(Buffer.from(String(b64),"base64")); }

// ========== 卡片升级（V2 / V1 → CCv3） ==========
/** tags 在 V1/ST 那边可能是逗号分隔的字符串；V2/V3 要数组。 */
export function normTags(v){
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
export function upgradeCardToV3(obj){
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

// ========== 装饰器（CCv3 SPEC_V3「Decorators」） ==========
/** CCv3 规范定义的合法位置值（`@@position`）。应用可扩展，但这里只认规范值。 */
export const POSITION_VALUES=["after_desc","before_desc","personality","scenario"];
/** `@@role` 的合法值。 */
export const ROLE_VALUES=["assistant","system","user"];
/** 必须带非负整数参数的装饰器。 */
const NUMERIC_DECORATORS=["depth","scan_depth","activate_only_after","activate_only_every","is_greeting"];
/** 不允许带参数的装饰器。 */
const VALUELESS_DECORATORS=["activate","dont_activate","keep_activate_after_match","dont_activate_after_match","ignore_on_max_context"];
/**
 * 解析 content **开头连续**的 `@@` 装饰器块（CCv3 规范语义）。
 *
 * 返回：
 * - `decorators`：[{name, value, raw, fallback, invalid}]，按出现顺序；
 *   `fallback` = `@@@` 前缀（规范里的 fallback 装饰器写法）；
 * - `body`：去掉开头装饰器块后的正文（规范要求应用「trim the decorators from the content」）；
 * - `hasDecorators` / `endsWithDecoratorOnly`（整段都是装饰器、没有正文）。
 *
 * ⚠️ 与 ST 的运行时 `parseDecorators()` 不是一回事：ST 只认 `@@activate`/`@@dont_activate` 且
 * 消费端严格相等；这里是按 CCv3 规范解析全部装饰器名与值。平台能实现哪些由 adapter 决定。
 */
export function parseDecorators(content){
  const text=String(content==null? "" : content);
  const lines=text.split("\n");
  const decorators=[];
  let i=0;
  while(i<lines.length){
    const raw=lines[i];
    if(raw.slice(0,2)!=="@@") break;
    const fallback=raw.slice(0,3)==="@@@";
    const bodyLine=fallback? raw.slice(1) : raw;
    const m=/^@@([a-z_]+)(?:\s+(.*))?$/.exec(bodyLine.trim());
    if(!m){
      decorators.push({ name:null, value:null, raw, fallback, invalid:true });
      i++;
      continue;
    }
    decorators.push({ name:m[1], value:String(m[2]==null? "" : m[2]).trim(), raw, fallback, invalid:false });
    i++;
  }
  const body=lines.slice(i).join("\n").replace(/^\n+/,"");
  return { decorators, body, hasDecorators: decorators.length>0, decoratorOnly: i===lines.length && lines.length>0 };
}
/** 按 CCv3 规范校验 content 开头装饰器的值域；返回 {ok, issues, decorators, body}。 */
export function validateDecorators(content){
  const parsed=parseDecorators(content);
  const issues=[];
  const push=(level, code, message, extra)=>issues.push(Object.assign({ level, code, message }, extra||{}));
  parsed.decorators.forEach(function(d){
    if(d.invalid){
      push("warn","bad-decorator-syntax", "装饰器行语法可疑："+d.raw.slice(0,60)+"（平台可能忽略它，或把它当正文）", { raw:d.raw });
      return;
    }
    const v=String(d.value||"").toLowerCase();
    if(d.name==="position"){
      if(POSITION_VALUES.indexOf(v)<0) push("error","decorator-position-value", "@@position 的值「"+d.value+"」不是 CCv3 合法位置（"+POSITION_VALUES.join(" / ")+"）；SillyTavern 也不解析它", { raw:d.raw });
    } else if(NUMERIC_DECORATORS.indexOf(d.name)>=0){
      if(!/^\d+$/.test(d.value)) push("error","decorator-number-value", "@@"+d.name+" 需要非负整数，当前是「"+d.value+"」", { raw:d.raw });
    } else if(d.name==="role"){
      if(ROLE_VALUES.indexOf(v)<0) push("error","decorator-role-value", "@@role 的值「"+d.value+"」非法（assistant / system / user）", { raw:d.raw });
    } else if(VALUELESS_DECORATORS.indexOf(d.name)>=0){
      if(d.value!=="") push("error","decorator-value-not-allowed", "@@"+d.name+" 不接受值（写「"+d.value+"」在 CCv3 与 SillyTavern 里都不会生效）", { raw:d.raw });
    } else if(d.name==="additional_keys" || d.name==="exclude_keys"){
      if(!d.value) push("error","decorator-keys-empty", "@@"+d.name+" 需要一个或多个逗号分隔的触发词", { raw:d.raw });
    }
  });
  return { ok: issues.every(function(i){ return i.level!=="error"; }), issues, decorators: parsed.decorators, body: parsed.body };
}

// ========== V2 回填 / ST 绑定 ==========
/** V2 的 data 字段集（V3 独有的 nickname / creator_notes_multilingual / source / group_only_greetings /
 *  assets / creation_date / modification_date 一个都不进 —— 那些字段在 V2 里不存在）。 */
export const V2_DATA_FIELDS=["name","description","personality","scenario","first_mes","mes_example","creator_notes",
  "system_prompt","post_history_instructions","alternate_greetings","character_book","tags","creator","character_version","extensions"];
/** 摘掉正文**开头连续**的 `@@` 装饰器行（含其后遗留的空行）—— 规范要求回填 V2 时移除全部装饰器。 */
export function stripDecorators(content){
  const lines=String(content==null? "" : content).split("\n");
  let i=0;
  while(i<lines.length && String(lines[i]).slice(0,2)==="@@") i++;
  while(i<lines.length && !String(lines[i]).trim()) i++;
  return lines.slice(i).join("\n");
}
/** 整张卡 → CharacterCardV2 对象（PNG 的 `chara` 块用；只做投影，不改调用方传进来的对象）。 */
export function stV2Projection(card){
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
export function withStWorld(card, world){
  const name=String(world==null? "" : world).trim();
  if(!name) return card;
  const out=JSON.parse(JSON.stringify(card));
  out.data=out.data||{};
  out.data.extensions=Object.assign({}, out.data.extensions);
  out.data.extensions.world=name;
  return out;
}
/** 世界书名 → 文件名/绑定名（ST 用上传文件名当世界名；非法字符两边必须用同一套替换）。 */
export function sanitizeWorldName(name){
  return String(name==null? "" : name).trim().replace(/[\\/:*?"<>|]/g,"_") || "shared-lorebook";
}
/** 统一换行（ST 的 parseDecorators 不 trim `\r`，CRLF 会让 `@@activate` 静默失效）。 */
export function normalizeNewlines(text){
  return String(text==null? "" : text).replace(/\r\n?/g,"\n");
}

// ========== PNG / CHARX 容器 ==========
export function buildTEXtChunk(cardJson, keyword){
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
export function pngCardChunks(cardJson){
  return [buildTEXtChunk(stV2Projection(cardJson), "chara"), buildTEXtChunk(cardJson, "ccv3")];
}
/** 一张卡 → PNG：`builtChunks` 由目标适配器决定（ST = chara+ccv3；原生 CCv3 = 只 ccv3）；缺省沿用双块。 */
export function buildPngWithCard(cardJson, builtChunks){
  const baseB64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  const base=new Uint8Array(Buffer.from(baseB64,"base64"));
  const iendOff=base.length-12;
  const head=base.slice(0,iendOff);
  const tail=base.slice(iendOff);
  const chunks=Array.isArray(builtChunks)? builtChunks : pngCardChunks(cardJson);
  return concatBytes([head].concat(chunks, [tail]));
}
export function embedCardIntoPngBytes(pngBytes, cardJson, builtChunks){
  if(pngBytes.length<8 || pngBytes[0]!==0x89 || pngBytes[1]!==0x50) throw new Error("不是合法 PNG（缺少 PNG 签名）");
  if(pngBytes.length > 15*1024*1024) throw new Error("PNG 过大（>15MB）");
  const newChunks=Array.isArray(builtChunks)? builtChunks : pngCardChunks(cardJson);
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
export function extractCardFromPngBytes(bytes){
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
export function parseZipEntries(bytes){
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
export function buildZipCharx(cardJson){
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
