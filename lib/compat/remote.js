/**
 * 远程平台导入（0.15.0）：把「导出物直接推给本地已运行的前端」的**纯计算**收在一处。
 *
 * 为什么必须有宿主代理（不是「顺手这么做」）：
 * - SillyTavern 默认 CORS 是 `origin: ["null"]`、`methods: ["OPTIONS"]`、`credentials: false`
 *   （`default/config.yaml`）——浏览器从 DSH GUI（http://127.0.0.1:<port>）跨域 POST 必被浏览器
 *   拦下，连预检都过不了。宿主是 Node 进程，`fetch` 不受 CORS 约束。
 * - ST 的 CSRF token 与 session cookie 绑定（`src/server-main.js` 的 csrfSync + cookieSession）。
 *   把这次会话留在宿主，浏览器只拿到结构化结果，ST 的 cookie / 密码不进入页面。
 *
 * 本文件只做纯计算（零 IO、零 fetch）：地址规范化、multipart 字节编码、「导哪本书」的决策、
 * 错误分类。真正发请求在 `lib/index.js`（宿主半），浏览器半一律走宿主 RPC。
 */
import { sanitizeWorldName } from "./core.js";

/** 地址长度上限（防御性：别拿一兆的字符串去 new URL）。 */
const ST_URL_MAX = 2048;
/** 错误体截断长度（ST 的 403 是整页 HTML，不能原样回给界面）。 */
const ST_BODY_MAX = 200;

/** 带 code 的错误（宿主 dispatch 的 catch 会把它转成 fail 帧）。 */
export function stError(code, message){
  const e = new Error(String(message || code || "st-error"));
  e.code = String(code || "st-error");
  return e;
}
function cleanBody(text){
  const s = String(text == null ? "" : text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, ST_BODY_MAX);
}

/**
 * 规范化 ST 地址：缺 scheme 补 `http://`（用户常直接填 `127.0.0.1:8000`），只允许 http/https，
 * 拒绝 URL 里带用户名密码（凭据走认证栏，不进日志/历史），去掉 query/hash 与尾斜杠。
 * 非法时抛 `st-bad-url`。
 */
export function normalizeStBaseUrl(raw, fallback){
  let text = String(raw == null ? "" : raw).trim();
  if(!text) text = String(fallback == null ? "" : fallback).trim();
  if(!text) throw stError("st-bad-url", "没有配置 SillyTavern 地址");
  if(text.length > ST_URL_MAX) throw stError("st-bad-url", "SillyTavern 地址过长");
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "http://" + text;
  let u;
  try{ u = new URL(text); }
  catch{ throw stError("st-bad-url", "SillyTavern 地址不合法：" + cleanBody(text)); }
  if(u.protocol !== "http:" && u.protocol !== "https:") throw stError("st-bad-url", "只支持 http/https 地址");
  if(u.username || u.password) throw stError("st-bad-url", "地址里不要带用户名密码（请填在认证栏）");
  u.search = "";
  u.hash = "";
  let out = u.toString();
  while(out.length > 1 && out.charAt(out.length - 1) === "/") out = out.slice(0, -1);
  return out;
}
/** base + path 拼接（base 已去尾斜杠；path 补前导斜杠）。 */
export function stUrl(base, path){
  const b = String(base == null ? "" : base).replace(/\/+$/, "");
  let p = String(path == null ? "" : path);
  if(!p) return b;
  if(p.charAt(0) !== "/") p = "/" + p;
  return b + p;
}
/**
 * 从 `set-cookie` 响应头提取 cookie 串（`name=value; name2=value2`）。
 * 只保留第一个 `;` 之前的 name=value，属性（Path/HttpOnly/SameSite/Expires）全部丢掉。
 * 值里允许出现 `=`（ST 的 session cookie 是 base64），所以按**第一个** `=` 切。
 */
export function cookieFromSetCookie(headers){
  const list = Array.isArray(headers) ? headers : (headers == null ? [] : [headers]);
  const map = new Map();
  for(const line of list){
    const s = String(line == null ? "" : line);
    const cut = s.indexOf(";");
    const pair = (cut >= 0 ? s.slice(0, cut) : s).trim();
    if(!pair) continue;
    const eq = pair.indexOf("=");
    if(eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if(!name) continue;
    map.set(name, pair.slice(eq + 1).trim());
  }
  return Array.from(map.entries()).map(function(kv){ return kv[0] + "=" + kv[1]; }).join("; ");
}
/** 探测/导入共用的请求头。凭据只在这一次请求里使用，不落盘、不写日志。 */
export function buildStHeaders(opts){
  const o = opts || {};
  const h = { accept: "application/json" };
  if(o.token) h["x-csrf-token"] = String(o.token);
  if(o.cookie) h.cookie = String(o.cookie);
  if(o.username){
    const raw = String(o.username) + ":" + String(o.password == null ? "" : o.password);
    h.authorization = "Basic " + Buffer.from(raw, "utf8").toString("base64");
  }
  return h;
}
function escapeDispositionName(name){
  return String(name == null ? "" : name).replace(/["\\\r\n]/g, "_");
}
let boundarySeq = 0;
/**
 * multipart/form-data 字节编码（纯函数，便于单测与精确控制上传文件名）。
 * - 字段：字符串值，UTF-8；
 * - 文件：`{field, filename, contentType, data}`，data 可为 Buffer/Uint8Array/string；
 * - 文件名按 UTF-8 原样写入（ST 1.19 的 multer 2.x 默认 `defParamCharset: "utf8"`，
 *   中文书名不会乱码）。
 */
export function encodeMultipart(fields, files, opts){
  const o = opts || {};
  const boundary = String(o.boundary || ("----dshCcStudio" + (++boundarySeq) + "x" + Date.now().toString(16)));
  const parts = [];
  const enc = function(s){ return Buffer.from(String(s), "utf8"); };
  const f = fields || {};
  for(const key of Object.keys(f)){
    if(f[key] === undefined || f[key] === null) continue;
    parts.push(enc("--" + boundary + "\r\n"
      + "Content-Disposition: form-data; name=\"" + escapeDispositionName(key) + "\"\r\n\r\n"
      + String(f[key]) + "\r\n"));
  }
  const list = Array.isArray(files) ? files : [];
  for(const file of list){
    if(!file || file.data === undefined || file.data === null) continue;
    const data = Buffer.isBuffer(file.data) ? file.data
      : (typeof file.data === "string" ? enc(file.data) : Buffer.from(file.data));
    parts.push(enc("--" + boundary + "\r\n"
      + "Content-Disposition: form-data; name=\"" + escapeDispositionName(file.field || "file")
      + "\"; filename=\"" + escapeDispositionName(file.filename || "file.bin") + "\"\r\n"
      + "Content-Type: " + (file.contentType || "application/octet-stream") + "\r\n\r\n"));
    parts.push(data);
    parts.push(enc("\r\n"));
  }
  parts.push(enc("--" + boundary + "--\r\n"));
  return { body: Buffer.concat(parts), contentType: "multipart/form-data; boundary=" + boundary };
}
/** 书文档（`{spec,data}` 或 data 本身）→ 条目数组。 */
function entriesOf(book){
  if(!book) return [];
  const b = (book.data && typeof book.data === "object") ? book.data : book;
  return Array.isArray(b.entries) ? b.entries : [];
}
/**
 * 「这次导入哪本书」的唯一决策点（纯函数，测试逐分支钉住）：
 * - `stWorld` 非空（客户端 exportWorldName() 给出的共享书名）→ 用共享书；
 *   书读不到 / 空书 → `action:"skip"` + `warning:"shared-book-missing"`（卡照导，绑定留给 ST 里已有的同名书）；
 * - 否则用卡内 `character_book`（书名缺省 = `<卡名>'s Lorebook`，与 ST 前端 `importEmbeddedWorldInfo` 一致）；
 * - 两边都没有 → `action:"none"`（不导书，卡副本上也不写绑定）。
 * 同名书默认 **skip**（ST 的 worldinfo import 会静默覆盖同名文件，用户改过的书不能被我们悄悄冲掉），
 * `worldMode:"overwrite"` 才覆盖。
 */
export function decideStImportPlan(input){
  const x = input || {};
  const stWorld = String(x.stWorld == null ? "" : x.stWorld).trim();
  const existing = Array.isArray(x.existingWorlds) ? x.existingWorlds.map(String) : [];
  const overwrite = x.worldMode === "overwrite";
  const cardName = String(x.cardName == null ? "" : x.cardName).trim();
  const groupEntries = entriesOf(x.groupBook);
  const cardEntries = entriesOf(x.cardBook);
  let source = "none", worldName = "", action = "none", warning = null;
  if(stWorld){
    source = "shared";
    worldName = sanitizeWorldName(stWorld);
    if(!groupEntries.length){
      action = "skip";
      warning = "shared-book-missing";
    }
  } else if(cardEntries.length){
    source = "card";
    const rawName = String((x.cardBook && x.cardBook.name) || "").trim()
      || (cardName ? cardName + "'s Lorebook" : "lorebook");
    worldName = sanitizeWorldName(rawName);
  } else {
    return { source: "none", worldName: "", action: "none", existed: false, warning: null };
  }
  let existed = false;
  if(worldName){
    for(const n of existing){
      if(n === worldName || n.toLowerCase() === worldName.toLowerCase()){ existed = true; break; }
    }
  }
  if(action !== "skip") action = (!existed || overwrite) ? "import" : "skip";
  return { source: source, worldName: worldName, action: action, existed: existed, warning: warning };
}
/** ST `/api/worldinfo/list` 的返回（数组）→ 世界书 file_id 列表；结构不符时返回空数组。 */
export function worldListNames(obj){
  const arr = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.entries) ? obj.entries : []);
  const out = [];
  for(const x of arr){
    const n = String((x && (x.file_id || x.name)) || "").trim();
    if(n && out.indexOf(n) === -1) out.push(n);
  }
  return out;
}
/** 导书响应 `{name}` → 实际世界名；缺失时退回我们预期的名字。 */
export function pickWorldName(resp, expected){
  const n = String((resp && resp.name) || "").trim();
  return n || String(expected == null ? "" : expected).trim();
}
/**
 * 卡内 `character_book` → 可交给 renderBook(target) 的 lorebook 文档。
 * ST 的 `toBookExport` 只读 `data.name` / `data.entries`，所以这里只做形状包装（深拷贝，不动草稿）。
 */
export function lorebookOfCardBook(cardBook){
  if(!cardBook || typeof cardBook !== "object") return null;
  const entries = entriesOf(cardBook);
  if(!entries.length) return null;
  let copy;
  try{ copy = JSON.parse(JSON.stringify(cardBook)); }
  catch{ copy = { name: String(cardBook.name || ""), entries: entries.slice() }; }
  return { spec: "lorebook_v3", spec_version: "1.0", data: copy };
}
/** ST 错误响应 → 统一错误码（界面按 code 出文案，message 只作兜底细节）。 */
export function classifyStFailure(status, bodyText){
  const n = Number(status) || 0;
  const body = String(bodyText == null ? "" : bodyText);
  if(n === 401) return { code: "st-auth", message: "SillyTavern 需要 Basic 认证（401）" };
  if(n === 403){
    if(/csrf/i.test(body)) return { code: "st-csrf", message: "SillyTavern 拒绝了 CSRF token（403）" };
    return { code: "st-forbidden", message: "SillyTavern 拒绝访问（403）：检查 whitelist 或登录模式" };
  }
  if(n === 404) return { code: "st-bad-response", message: "SillyTavern 上没有这个接口（404）：确认地址与版本" };
  return { code: "st-import-failed", message: "SillyTavern 返回 " + n + "：" + cleanBody(body) };
}
/** fetch 抛出的连接错误 → 统一错误码（Node 的 TypeError 把真实原因放在 cause.code 里）。 */
export function classifyFetchError(err){
  if(err && (err.name === "AbortError" || err.code === "ABORT_ERR")){
    return { code: "st-timeout", message: "连接 SillyTavern 超时" };
  }
  const c = err && err.cause && err.cause.code;
  if(c === "ENOTFOUND" || c === "EAI_AGAIN") return { code: "st-offline", message: "连不上 SillyTavern（域名解析失败）" };
  if(c === "ECONNREFUSED") return { code: "st-offline", message: "连不上 SillyTavern（端口未监听）" };
  return { code: "st-offline", message: "连不上 SillyTavern：" + cleanBody(err && err.message) };
}
