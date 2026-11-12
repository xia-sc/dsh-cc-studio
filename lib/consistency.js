/**
 * 设定铁律（Canon）—— 「让运行期也不吃书」的**唯一实现**（0.19.0）。
 *
 * 为什么要有这个文件（一句话）：插件在制卡期，卡导进 SillyTavern / Risu 之后插件就退场了，
 * 所以「对话期的硬伤」不可能靠插件的校验去拦；能拦的是**卡里带什么**。卡带上一份短的、
 * 每轮都会被注入的「事实清单」，运行期的模型才有机会守住设定。2026-11 的提案评审里，
 * 这一条是唯一改变架构的意见（其余三条是对规则集的修正）。
 *
 * 三条设计约束（来自实测与评审）：
 *   ① **必须短**：长设定既会被上下文的工具结果裁剪（本预设的 tool-result-pruner 阈值 8192 字符）
 *      也会被模型忽略。所以上限硬编码：≤12 条、每条 fact ≤40 字、整段 ≤600 字。
 *   ② **必须注入到位**：ST 的三个位置各有各的生效条件 ——
 *      · `extensions.depth_prompt`（Character's Note）：ST 每轮 IN_CHAT depth 4 注入，**主力**，
 *        不受 `prefer_character_prompt` / `prefer_character_jailbreak` 影响；
 *      · `post_history_instructions`：替换 jailbreak 段（`prefer_character_jailbreak` 默认开），位置更靠后；
 *      · `character_book` 的 constant 条目：ST **不会**自动把卡内书变成世界书，要 Import Card Lore
 *        或放进共享书/导出独立世界书才生效 —— 所以它是「可导入时的兜底」，不是主力。
 *      三处共用同一份格式化结果（canonText），不许各写一份。
 *   ③ **判定只有这一份**：宿主半（lib/index.js 的 validate 端点）与预设半（lib/agent.js 的 cc_validate）
 *      都 import 本文件。纯函数、零 IO、不读环境变量 —— 与 group-layer.js 同一个家规。
 *
 * ⚠️ 能力边界（文档与返回文案都不许越过）：本文件**只做可计算的检查**（存在性 / 长度上限 /
 * 同实体两种说法 / 条目是否被铁律覆盖 / 极性词可疑）。它**不判断语义矛盾** ——
 * 「债已清了」与「年底前总要核一次账」这种可以并存的表述不是冲突；真正的语义冲突只能靠
 * 模型或审稿子代理逐条对照，插件不得宣称能自动检出。
 */
import { WORLD_DIMS, WORLD_DIM_LABELS, isAutoEntry } from "./group-layer.js";

/** 插件私有状态键（放 `data.extensions` 下，CCv3 规范允许 application-specific 扩展）。 */
export const CANON_KEY = "cc_canon";
/** 世界书里的常驻条目名（固定名字 —— 幂等更新靠它定位，别改名）。 */
export const CANON_ENTRY_NAME = "设定铁律";
/** 注入段的起始标记（三处都用它做幂等替换）。 */
export const CANON_MARK = "【设定铁律】";
/** `system_prompt` 里只放一句指引，用独立标记避免与正文段互相覆盖。 */
export const CANON_SYSTEM_MARK = "【设定铁律·指引】";
/**
 * 运行期每轮成本的去重（0.19.0 实测）：
 * 铁律**全文只进 Character's Note**（每轮注入、不受 `prefer_character_*` 开关影响）。
 * Post-History 与 `system_prompt` 只放短句 —— 同一份事实清单在每轮里被读两遍是纯浪费：
 * 12 条铁律全文约 187 token，两处就是 374 token/轮；去掉一份后整卡固定开销从 ~1177 降到 ~990。
 */
export const CANON_PH_NOTE = CANON_MARK + "（见 Character's Note：与上文设定冲突时以铁律为准；宁可暂停推进，也不要改写设定）";
export const CANON_SYSTEM_NOTE = CANON_SYSTEM_MARK + "本卡设有【设定铁律】（见 Character's Note 与同名世界书条目）：不得违背；冲突时宁可暂停推进，也不要改写设定。";
/** 硬上限：条数 / 单条事实字数 / 整段字数。超出即 error（并要求模型精简）。 */
export const CANON_MAX_RULES = 12;
export const CANON_MAX_FACT = 40;
export const CANON_MAX_TOTAL = 600;

/**
 * 极性词表（只用于 warning 级的「可疑」判断，不足以定罪 —— 见文件头的能力边界）。
 *
 * ⚠️ 只收**状态词**，不收纯时间副词（0.19.0 反馈 bug 2）：
 * 初版把「早已 / 曾经 / 一直 / 从未 / 始终」也当负向，于是「三年抵债契早就满了」被判成
 * 「早已没了」—— 「满了」在这里是"到期"，不是"消失"。时间副词单独出现时根本没有极性信息，
 * 宁可漏检也不要误报：这条 warning 一旦不稳定，作者就会习惯性忽略，整项检测等于废掉。
 */
const POLARITY_POS = ["完好", "仍在", "还在", "存活", "尚存", "依旧", "仍然", "唯一", "健在"];
const POLARITY_NEG = ["已毁", "被毁", "烧毁", "已死", "死去", "已灭", "已断", "已清", "不存在", "消失", "毁灭", "拆除", "坍塌"];

function asText(v){ return String(v == null ? "" : v); }
/** 折叠空白（换行、制表符都压成单个空格）—— 铁律是「一行一条」，不能带换行。 */
function squeeze(v){ return asText(v).replace(/\s+/g, " ").trim(); }
function charsOf(s){ return Array.from(asText(s)); }
/** 按字符（不是 UTF-16 码元）截断，CJK 才不会被切半。
 *  ⚠️ 结果**必须 ≤ max**：省略号也占一个字符。0.19.0 的初版返回 `max + "…"`（= max+1），
 *  于是「派生时截到 40 字」的结果是 41 字，而 audit 判 `> 40` 即 error ——
 *  所有旧卡一 validate 就被自己的派生结果顶死（反馈 bug 1）。这里一并做了标点优先：
 *  尽量切在逗号/句号后，不要把一个词切成两半。 */
function cutChars(v, max){
  const a = charsOf(squeeze(v));
  if(a.length <= max) return a.join("");
  const hard = Math.max(0, max - 1);   // 留一位给省略号
  let cut = hard;
  for(let i = hard; i >= Math.floor(max * 0.6); i--){
    if("，。；、：,.;:!?！？ ".indexOf(a[i]) >= 0){ cut = i; break; }
  }
  return a.slice(0, cut).join("") + "…";
}
function normSubject(v){ return squeeze(v).toLowerCase(); }
/** 去掉 content 开头连续的 `@@` 装饰器行（与兼容层 stripDecorators 同语义，这里只取正文首句）。 */
function stripDecorators(content){
  const lines = asText(content).split("\n");
  let i = 0;
  while(i < lines.length && String(lines[i]).slice(0, 2) === "@@") i++;
  while(i < lines.length && !String(lines[i]).trim()) i++;
  return lines.slice(i).join("\n");
}
/** 取正文里第一个有信息量的句子（截到 fact 上限），用作派生铁律的 fact。 */
function firstFact(content){
  const body = squeeze(stripDecorators(content));
  if(!body) return "";
  const m = /^(.{1,80}?[。！？!?；;])/.exec(body);
  return cutChars(m ? m[1] : body, CANON_MAX_FACT);
}

/**
 * 纯规则 / 指令条目（常量化的「演出规范」之类）不是「设定实体」：它没有 subject，
 * 既不该被要求进铁律，也不该被派生进 canon。
 * 0.19.0 反馈 bug 3：这类条目每次 validate 都会拖着一条消不掉的 `canon-coverage-gap`。
 *
 * 判据（任一成立即算规则条目）：
 *  - 条目显式 `skipCoverage: true`（作者/模型可手动豁免）；
 *  - `constant: true` 且正文以「【」或「[」开头（规则段落的典型写法）；
 *  - 没有 keys 且正文含强指令词（必须/不要/禁止/禁写/务必/每轮/第三人称/篇幅）。
 */
function isRuleEntry(e){
  if(!e || typeof e !== "object") return false;
  if(e.skipCoverage === true) return true;
  const body = squeeze(stripDecorators(e.content));
  if(!body) return true;
  const first = charsOf(body)[0] || "";
  if(e.constant === true && (first === "【" || first === "[")) return true;
  const hasKeys = Array.isArray(e.keys) && e.keys.length > 0;
  if(!hasKeys && /(必须|不要|禁止|禁写|务必|每轮|第三人称|篇幅)/.test(body)) return true;
  return false;
}

/**
 * canon 与「卡里现在的设定」是否还同源的指纹（0.19.0 反馈 5）。
 *
 * 为什么需要：canon 一旦落盘，后续 validate 就直接沿用它、**不再派生**；作者改了世界书
 * 却忘了重传 canon 时，铁律与条目会静默脱钩。指纹只覆盖「会改变设定」的内容
 * （五维 + 世界书条目的 name/content；排除插件自己注入的「设定铁律」条目），
 * 内容没变就保持不变 —— 这样 `auditCanon` 才能用它判出 stale。
 */
export function canonFingerprint(card){
  const d = (card && card.data) || {};
  const parts = [];
  const w = (d.extensions && d.extensions.cc_world && typeof d.extensions.cc_world === "object") ? d.extensions.cc_world : {};
  WORLD_DIMS.forEach(k => parts.push(k + ":" + squeeze(w[k])));
  const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
  entries.forEach(e => {
    if(!e || e.enabled === false) return;
    if(squeeze(e.name) === CANON_ENTRY_NAME) return;
    parts.push(squeeze(e.name) + "|" + squeeze(e.content));
  });
  const s = parts.join("\n");
  let h = 5381;
  for(let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return "f" + h.toString(36) + "-" + s.length;
}
/** 把已有的铁律段摘掉（保留标记之前的全部内容）—— 幂等的关键：重复调用只替换这一段。 */
function stripCanonBlock(value){
  const s = asText(value);
  const i = s.indexOf(CANON_MARK);
  return i < 0 ? s : s.slice(0, i).replace(/\s+$/, "");
}
function joinBlock(base, block){
  const head = stripCanonBlock(base);
  return head ? head + "\n\n" + block : block;
}

/** 原始 rules（audit 判长度上限时要看未截断的输入）。 */
function rawRulesOf(card){
  const d = (card && card.data) || {};
  const ext = (d.extensions && d.extensions.cc_canon) || null;
  return (ext && Array.isArray(ext.rules)) ? ext.rules : [];
}
/** 读 canon 并归一化（截断到硬上限；非法项丢弃）。没有就是 `{rules:[],source:"none"}`。 */
export function normalizeCanon(card){
  const d = (card && card.data) || {};
  const ext = (d.extensions && d.extensions.cc_canon) || null;
  if(!ext || !Array.isArray(ext.rules)) return { rules: [], source: "none", at: 0, raw: [] };
  const raw = ext.rules;
  const rules = raw
    .map(r => ({ subject: cutChars(r && r.subject, 24), fact: cutChars(r && r.fact, CANON_MAX_FACT) }))
    .filter(r => r.subject && r.fact)
    .slice(0, CANON_MAX_RULES);
  return {
    rules: rules,
    source: ext.source === "derived" ? "derived" : "model",
    at: Number(ext.at) || 0,
    fp: typeof ext.fp === "string" ? ext.fp : "",
    raw: raw,
  };
}

/**
 * 从现有内容派生一份 canon 草案（**旧卡迁移 + 模型没给时的兜底**）。
 * 顺序：五维 → 手工世界书条目 → 角色核心。同 subject 只留第一条。
 * 这是纯函数（不带时间戳 —— `at` 由 applyCanon 落盘时补），方便测试。
 */
export function deriveCanonDraft(card){
  const d = (card && card.data) || {};
  const rules = [];
  const push = (subject, fact) => {
    const s = squeeze(subject);
    const f = squeeze(fact);
    if(!s || !f) return;
    if(rules.length >= CANON_MAX_RULES) return;
    const key = normSubject(s);
    if(rules.some(r => normSubject(r.subject) === key)) return;
    rules.push({ subject: cutChars(s, 24), fact: cutChars(f, CANON_MAX_FACT) });
  };
  const w = (d.extensions && d.extensions.cc_world && typeof d.extensions.cc_world === "object") ? d.extensions.cc_world : {};
  WORLD_DIMS.forEach(k => { if(squeeze(w[k])) push(WORLD_DIM_LABELS[k], firstFact(w[k])); });
  const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
  entries.forEach(e => {
    if(!e || e.enabled === false || isAutoEntry(e) || isRuleEntry(e)) return;
    // 「设定铁律」是本插件自己注入的常驻条目 —— 它不能被当成「手工设定」再抽取一次，
    // 否则第二次派生会把上一轮注入的铁律摘要当成新事实（自我复制、越滚越长）。
    if(squeeze(e.name) === CANON_ENTRY_NAME) return;
    const body = firstFact(e.content);
    if(!body) return;
    const name = squeeze(e.name) || squeeze(Array.isArray(e.keys) ? e.keys[0] : "");
    push(name, body);
  });
  if(squeeze(d.name) && squeeze(d.description)) push(d.name, firstFact(d.description));
  return { rules: rules, source: "derived" };
}

/** 一行一条的可读文本（三处注入的唯一格式化来源）。超出上限的条目在这里丢弃。 */
export function canonText(rules){
  const list = (Array.isArray(rules) ? rules : [])
    .filter(r => r && squeeze(r.subject) && squeeze(r.fact))
    .slice(0, CANON_MAX_RULES)
    .map(r => "- " + cutChars(r.subject, 24) + "：" + cutChars(r.fact, CANON_MAX_FACT));
  let text = list.join("\n");
  if(text.length > CANON_MAX_TOTAL){
    // 超长只保留能完整放进预算的前几条 —— 宁可少一条，也不要把最后一条切成半句。
    const keep = [];
    let used = 0;
    for(const line of list){
      if(used + line.length + 1 > CANON_MAX_TOTAL) break;
      keep.push(line);
      used += line.length + 1;
    }
    text = keep.join("\n");
  }
  return text;
}

/** 给工具返回 / UI 用的小摘要（不含整张卡）。
 *
 * 0.19.0 反馈 6：初版只读已落盘的 canon，于是新会话第一次 `cc_get_card({digest:true})`
 * 看到 `count:0` 却不知道下一步；而紧接着 `cc_validate` 又能派生出 12 条 —— 两处不一致。
 * 现在没有落盘 canon 时返回**只读派生预览**（标 `derived-preview`）并给出说明，
 * 保证「digest 看到的」与「validate 会写入的」是同一份。
 */
export function canonDigest(card, opts){
  const o = opts || {};
  const c = normalizeCanon(card);
  if(c.rules.length) return { count: c.rules.length, source: c.source, text: canonText(c.rules), note: "", fingerprint: c.fp };
  if(o.derive === false) return { count: 0, source: "none", text: "", note: "尚未建立设定铁律：调用 cc_validate 后会按现有内容生成。", fingerprint: "" };
  const d = deriveCanonDraft(card);
  if(!d.rules.length) return { count: 0, source: "none", text: "", note: "卡里还没有可提炼的设定（世界书 / 五维 / 角色均为空）。", fingerprint: "" };
  return {
    count: d.rules.length,
    source: "derived-preview",
    text: canonText(d.rules),
    note: "尚未建立设定铁律；以下是按现有内容派生的预览，cc_validate 会正式写入（可先确认或改写）。",
    fingerprint: "",
  };
}

/**
 * 一致性审计（可计算的部分）。
 * error：确定性冲突（同实体两条不同说法、超长、同名条目两种内容）。
 * warning：流程缺失（没 canon / 派生草案）、覆盖缺口、极性词可疑、同名条目以外的情况。
 */
export function auditCanon(card){
  const d = (card && card.data) || {};
  const norm = normalizeCanon(card);
  const issues = [];
  const push = (level, code, message, refs) => issues.push({ level, code, message, refs: refs || [] });
  const raw = norm.raw;

  if(!norm.rules.length){
    // 不设 error：宿主 validate 是只读校验，旧卡与「还没走到收尾」的草稿都会命中；
    // 预设半的 cc_validate 会自动派生并写入（见 applyCanon），所以正常情况下这条只会出现在
    // 「这张卡还没有任何可提炼的设定」时 —— 那时结构校验本身就会先失败。
    push("warning", "canon-missing", "没有设定铁律（canon）：SillyTavern 运行期每轮注入的事实清单为空，长对话里设定容易漂移。请在 cc_validate 里传 canon（≤12 条、每条 ≤40 字），或让工具按现有内容派生。");
  } else {
    if(raw.length > CANON_MAX_RULES || raw.some(r => charsOf(squeeze(r && r.fact)).length > CANON_MAX_FACT)){
      push("error", "canon-too-long", "设定铁律超出上限：" + raw.length + " 条（上限 " + CANON_MAX_RULES + "）/ 单条事实超过 " + CANON_MAX_FACT + " 字。长设定在运行期会被模型忽略，请精简到「一个实体 + 一句事实」。", [raw.length > CANON_MAX_RULES ? "条数 " + raw.length : "有超长条目"]);
    }
    const bySubject = new Map();
    norm.rules.forEach(r => {
      const k = normSubject(r.subject);
      if(!bySubject.has(k)) bySubject.set(k, []);
      bySubject.get(k).push(r);
    });
    bySubject.forEach(list => {
      if(list.length < 2) return;
      const facts = new Set(list.map(r => squeeze(r.fact)));
      if(facts.size > 1){
        push("error", "canon-duplicate-subject", "设定铁律里「" + list[0].subject + "」有 " + list.length + " 条不同说法（" + list.map(r => "「" + r.fact + "」").join(" / ") + "）：同一实体只能有一条事实，请合并或删掉过时的那条。",
          list.map(r => "「" + r.subject + "：" + r.fact + "」"));
      }
    });

    const hay = norm.rules.map(r => r.subject + " " + r.fact).join(" ").toLowerCase();
    const entries = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
    // 「设定铁律」条目是插件自己注入的载体，不是「待覆盖的手工设定」—— 不排除它，
    // 每次 validate 都会冒出「设定铁律 未被任何铁律覆盖」这种自我指涉的假问题。
    // 纯规则 / 指令条目（常驻的「演出规范」之类）同样排除：它们没有实体主题，
    // 硬要求进铁律只会留下一条永远消不掉的 warning（0.19.0 反馈 bug 3）。
    const manual = entries.filter(e => e && e.enabled !== false && !isAutoEntry(e)
      && squeeze(e.name) !== CANON_ENTRY_NAME && squeeze(e.content) && !isRuleEntry(e));
    const uncovered = manual.filter(e => {
      const names = [e.name].concat(Array.isArray(e.keys) ? e.keys : []).map(squeeze).filter(Boolean);
      if(!names.length) return false;
      return !names.some(n => hay.indexOf(n.toLowerCase()) >= 0);
    });
    if(uncovered.length){
      // 文案直接给「怎么消」：这条 warning 的两条消除路径都必须写明，否则作者只会反复看它挂着
      // （0.19.1 反馈建议 B）。触发型设定本来就该走 ②，不该被反复催补铁律。
      push("warning", "canon-coverage-gap", uncovered.length + " 条手工世界书条目的主题没有被任何铁律覆盖（" + uncovered.map(e => "「" + (squeeze(e.name) || "未命名") + "」").join("、") + "）：它们的设定在运行期只靠触发词命中，不在每轮注入的铁律里。消法：① 把关键事实补进 canon；② 若它本来就是「聊到才插入」的触发型设定，给它加 `skipCoverage: true`（cc_update_lorebook_entry({id, skipCoverage:true})）即可，不必补铁律。",
        uncovered.map(e => "「" + (squeeze(e.name) || "未命名") + "」"));
    }

    // 极性词「可疑」：同一 subject 在铁律与条目正文里出现对立断言。只是提醒，不是定罪。
    const polarityOf = (s) => {
      const t = asText(s);
      return { pos: POLARITY_POS.some(w => t.indexOf(w) >= 0), neg: POLARITY_NEG.some(w => t.indexOf(w) >= 0) };
    };
    norm.rules.forEach(r => {
      const rp = polarityOf(r.fact);
      if(rp.pos === rp.neg) return;   // 无极性或两边都有 → 判不了，跳过
      manual.forEach(e => {
        const body = squeeze(stripDecorators(e.content));
        if(!body) return;
        // 句级匹配（0.19.0 反馈 bug 2）：实体名与状态词必须在**同一句**里。
        // 全文匹配会让「前半段写这个实体、后半段讲别的事情时用了个否定词」也报可疑。
        const hit = body.split(/[。！？!?；;\n]+/).filter(Boolean)
          .find(x => x.toLowerCase().indexOf(normSubject(r.subject)) >= 0);
        if(!hit) return;
        const ep = polarityOf(hit);
        if(ep.pos === ep.neg) return;
        if((rp.pos && ep.neg) || (rp.neg && ep.pos)){
          push("warning", "canon-polarity-suspect", "「" + r.subject + "」在铁律里是「" + r.fact + "」，但条目「" + (squeeze(e.name) || "未命名") + "」的表述可能相反 —— 请人工确认（词表只能提示，判不了语义）。",
            ["铁律：" + r.fact, "条目：" + cutChars(body, 60)]);
        }
      });
    });
  }

  // 同名条目：两条 enabled 条目名字一样、正文不同 —— 同一实体两套设定，确定性问题。
  const entriesAll = (d.character_book && Array.isArray(d.character_book.entries)) ? d.character_book.entries : [];
  const byName = new Map();
  entriesAll.forEach(e => {
    if(!e || e.enabled === false) return;
    const n = squeeze(e.name);
    if(!n) return;
    if(!byName.has(n)) byName.set(n, []);
    byName.get(n).push(e);
  });
  byName.forEach((list, name) => {
    if(list.length < 2) return;
    const bodies = new Set(list.map(e => squeeze(e.content)));
    if(bodies.size > 1){
      push("error", "lore-duplicate-name", "世界书里有两条文名相同（「" + name + "」）但内容不同的条目：同一实体两套设定，运行时会同时插入、互相打架。请删掉或改名其中一条。",
        list.map(e => "「" + name + "：" + cutChars(stripDecorators(e.content), 40) + "」"));
    }
  });

  if(norm.source === "derived"){
    push("warning", "canon-derived", "当前设定铁律是按现有内容自动派生的草案（source=derived）：它保证运行期有铁律可读，但措辞可能不够精炼。请在回复里让用户确认/改写，再调 cc_validate({canon:[…]}) 覆盖。");
  }
  // 设计 5（0.19.0 反馈）：canon 落盘后就不再派生 —— 用写入时的指纹判断「之后卡有没有被改过」。
  // 没有这条提示时，作者改了世界书却忘了重传 canon，铁律会静默地和条目脱钩。
  if(norm.rules.length && norm.fp && norm.fp !== canonFingerprint(card)){
    push("warning", "canon-stale", "设定铁律是上次写入的版本，之后世界书 / 五维被改动过（指纹不符）：铁律可能已经和现状不一致。消法：① 把新设定补进 canon 后重传 cc_validate({canon:[…]})；② 若现有铁律仍然适用，原样重传同一份 canon 也算确认（会刷新指纹、清掉本提示）。");
  }
  return {
    issues: issues,
    errorCount: issues.filter(i => i.level === "error").length,
    canonCount: norm.rules.length,
    source: norm.source,
  };
}

// ── 未结案钩子（0.21.0）─────────────────────────────────────────────
// 现象：SillyTavern 里小模型揪住「一碗粥」不放 —— 只要这个细节在首条消息里是**未完成状态**
// （粥还热着 / 汤在炉上煨着 / 手机没关），模型就会把它当成本轮待办，之后每轮回收一次、
// 每轮自我强化。
// 为什么在制卡期查：复读的种子不在运行期，而在开场；把开场里的钩子改掉（补一句「粥已经倒了」）
// 比在卡里写十条「不得回收细节」都直接，而且**可计算、零运行期 token**。
// 能力边界：纯启发表层匹配，不判断「这碗粥到底该不该结案」；warning 级、不阻塞 valid。
const HOOK_OPEN = [
  /还(?:热|烫|亮|响|开|剩|挂|摆)着/,
  /没收(?:好|完|走|起|拾)/,
  /没关(?!系)/,
  /没(?:吃完|喝完|洗|倒)(?!霉)/,
  /(?:写|看|做|吃|喝|收拾|打扫)到一半/,
  /(?:正在|在)(?:煮|炖|煨|沏|泡|烧|烤|蒸)着/,
];
// 食物/饮品 + 持续状态：这是「一碗粥」这类最高频的复读种子。
// 刻意不含「水 / 酒」（「河水一直在流」会误报），宁可漏。
const HOOK_FOOD = /(?:粥|汤|饭|面|菜|茶|咖啡|牛奶|药)/;
const HOOK_FOOD_STATE = /(?:还|在|正|没|热|凉|剩)/;
// 结案标记（窗口 = 该句 + 后一句）
const HOOK_CLOSE = /(?:已经|早已|已(?:倒|关|熄|吃完|喝完|收|结束|清|作罢|处理)|倒掉|关掉|熄了|结束了|收好了|作罢了|吃完了|喝完了)/;
const HOOK_MAX_SAMPLES = 5;

/**
 * 按句 / 分句切分。逗号也算边界：一句里可以同时挂着两个钩子（「灯还亮着，手机没关」），
 * 不切开就会漏掉第二个；而结案窗口是「该段 + 后 2 段」，逗号切开后仍然足够宽
 * （「粥还热着，她端起来喝完了」→ 后一段就结案）。
 */
function splitSentences(text){
  return asText(text).split(/[。！？!?；;，,\n]+/).map(s => s.trim()).filter(Boolean);
}
function isOpenHook(sentence){
  if(HOOK_OPEN.some(re => re.test(sentence))) return true;
  return HOOK_FOOD.test(sentence) && HOOK_FOOD_STATE.test(sentence);
}

/**
 * 开场三处的「未结案钩子」检测。
 *
 * 范围：`first_mes` / `alternate_greetings[]` / `group_only_greetings[]`。
 * **不扫** `mes_example`（few-shot 示例，不是当前场景状态）与 `scenario`（设定文档，
 * 静态物品多、误报高）。两处排除都是刻意的，别顺手加回来。
 *
 * 返回 `{ hits, count, message }`：`hits` 最多 5 个样本，`count` 是真实命中数，
 * `message` 是可直接塞进 warnings 的汇总文案（宿主与预设两半共用同一句话）。
 */
export function auditOpeningHooks(card){
  const d = (card && card.data) || {};
  const sources = [];
  if(squeeze(d.first_mes)) sources.push({ where: "first_mes", text: asText(d.first_mes) });
  const collect = (field, list) => {
    if(!Array.isArray(list)) return;
    list.forEach((s, i) => { if(squeeze(s)) sources.push({ where: field + "[" + i + "]", text: asText(s) }); });
  };
  collect("alternate_greetings", d.alternate_greetings);
  collect("group_only_greetings", d.group_only_greetings);

  const all = [];
  sources.forEach(src => {
    const sent = splitSentences(src.text);
    sent.forEach((s, i) => {
      if(!isOpenHook(s)) return;
      // 结案窗口 = 该段 + 后 2 段：足够宽到「粥还热着。她看了一眼，端起来喝完了」，
      // 又不会宽到把 20 句之后一个无关的「已经」当成结案。
      const window = sent.slice(i, i + 3).join("");
      if(HOOK_CLOSE.test(window)) return;
      all.push({ where: src.where, text: cutChars(s, 40) });
    });
  });
  const samples = all.slice(0, HOOK_MAX_SAMPLES).map(h => h.where + "：「" + h.text + "」");
  const message = all.length
    ? "检测到 " + all.length + " 处「未结案钩子」（" + samples.join("、") + (all.length > samples.length ? " 等" : "") + "）。"
      + "这些细节在运行期容易被反复回收——模型会把未完成状态当成待办。消法：在开场里顺手结案（如「粥已经倒了」），或删掉该钩子。这是启发式提示，不阻塞导出。"
    : "";
  return { hits: all.slice(0, HOOK_MAX_SAMPLES), count: all.length, message };
}

/**
 * 把 canon 写进卡的三处注入点（+ system_prompt 一句指引）。
 * 纯函数：返回 `{ card, changed }`，不落盘；`changed` 为空表示卡已经是最新状态（幂等）。
 *
 * `opts.timeDepth` / `opts.timePost` 由预设半传入（时间锚定模板的唯一来源在 lib/agent.js），
 * 本文件不 import 它 —— 否则 consistency → agent 的循环依赖。
 */
export function applyCanon(card, canon, opts){
  const o = opts || {};
  const out = JSON.parse(JSON.stringify(card || {}));
  out.data = (out.data && typeof out.data === "object") ? out.data : {};
  const d = out.data;
  d.extensions = (d.extensions && typeof d.extensions === "object") ? d.extensions : {};
  const rules = (canon && Array.isArray(canon.rules)) ? canon.rules : [];
  const changed = [];

  // 落盘**保留原始输入**（不截断）：超长由 auditCanon 报 error 要求模型精简；
  // 截断只发生在读取（normalizeCanon）与注入（canonText）时。否则「模型传了 20 条」会被静默吞成 12 条。
  const prevExt = (d.extensions[CANON_KEY] && typeof d.extensions[CANON_KEY] === "object") ? d.extensions[CANON_KEY] : null;
  const prevRules = (prevExt && Array.isArray(prevExt.rules)) ? prevExt.rules : null;
  const currentFp = canonFingerprint(out);
  const next = {
    rules: rules.map(r => ({ subject: squeeze(r.subject), fact: squeeze(r.fact) })).filter(r => r.subject && r.fact),
    source: canon && canon.source === "derived" ? "derived" : "model",
    at: Math.floor(Date.now() / 1000),
    fp: currentFp,
  };
  // 没变的东西不再重写（0.19.0 反馈 5）：`at` 只在规则真的变化时更新 —— 否则每次 validate
  // 都会刷新时间戳，「这条铁律是什么时候写的」永远答不上来。
  const sameRules = !!(prevRules && JSON.stringify(prevRules) === JSON.stringify(next.rules));
  if(sameRules){
    if(prevExt.at) next.at = prevExt.at;
    // ⚠️ 指纹要不要保留旧值，取决于「这次是不是用户在确认」：
    //   · 显式传了 canon（canon.explicit）= 用户/模型在说「这版内容就用这份铁律」→
    //     指纹必须刷新到当前，否则改完条目再原样重传也清不掉 canon-stale（0.19.1 反馈 Bug 4）；
    //   · 没显式传（validate 沿用了已存的 canon）→ 保留旧指纹，
    //     这样「改了条目但没重传」才能继续报 stale。
    const explicit = !!(canon && canon.explicit);
    if(!explicit && typeof prevExt.fp === "string" && prevExt.fp) next.fp = prevExt.fp;
  }
  if(JSON.stringify(d.extensions[CANON_KEY]) !== JSON.stringify(next)){
    d.extensions[CANON_KEY] = next;
    changed.push("extensions." + CANON_KEY);
  }
  if(!next.rules.length) return { card: out, changed: changed };

  const body = canonText(next.rules);
  const block = CANON_MARK + "\n" + body;

  // ① Character's Note：ST 每轮注入（主力）。基础段是时间自检模板，铁律接在它后面。
  const prevDp = (d.extensions.depth_prompt && typeof d.extensions.depth_prompt === "object") ? d.extensions.depth_prompt : {};
  const nextDp = Object.assign({}, prevDp, {
    prompt: joinBlock(prevDp.prompt || o.timeDepth || "", block),
    depth: (typeof prevDp.depth === "number") ? prevDp.depth : 4,
    role: prevDp.role || "system",
  });
  if(JSON.stringify(prevDp) !== JSON.stringify(nextDp)){
    d.extensions.depth_prompt = nextDp;
    changed.push("extensions.depth_prompt");
  }

  // ② Post-History：ST 替换 jailbreak 段。这里**只放仲裁语，不放全文** ——
  // 全文已经进 Character's Note（每轮注入、不受开关影响），两处都放同一份 187 token 的事实清单
  // 等于每轮读两遍。判据见文件头的「去重」那段。
  const phBase = d.post_history_instructions || o.timePost || "";
  const nextPh = joinBlock(phBase, CANON_PH_NOTE);
  if(asText(d.post_history_instructions) !== nextPh){
    d.post_history_instructions = nextPh;
    changed.push("post_history_instructions");
  }

  // ③ 卡内世界书常驻条目：Import Card Lore / 共享书场景下生效的兜底。
  //    `opts.loreEntry === false` 时跳过 —— 「自动派生草案」只写 cc_canon + 两个注入段，
  //    不往 character_book 里塞条目：否则每张旧卡 validate 一次就多一条，条目数与既有统计全变。
  if(o.loreEntry !== false){
    const book = (d.character_book && typeof d.character_book === "object") ? d.character_book : (d.character_book = {});
    const entries = Array.isArray(book.entries) ? book.entries : (book.entries = []);
    const loreContent = "@@position after_desc\n" + block;
    const hit = entries.filter(e => e && squeeze(e.name) === CANON_ENTRY_NAME)[0] || null;
    if(hit){
      if(asText(hit.content) !== loreContent || hit.constant !== true){
        hit.content = loreContent;
        hit.constant = true;
        changed.push("character_book.entries[" + CANON_ENTRY_NAME + "]");
      }
    } else {
      entries.push({
        keys: [], content: loreContent, enabled: true, insertion_order: entries.length,
        case_sensitive: false, use_regex: false, constant: true,
        name: CANON_ENTRY_NAME, priority: 10,
        id: Date.now() + Math.floor(Math.random() * 10000),
      });
      changed.push("character_book.entries[" + CANON_ENTRY_NAME + "]");
    }
  }

  // ④ system_prompt 只放一句指引（不塞全文 —— 它在 ST 里会替换 Main Prompt，塞长文会挤掉基础指令）。
  if(asText(d.system_prompt).indexOf(CANON_SYSTEM_MARK) < 0){
    const head = asText(d.system_prompt).replace(/\s+$/, "");
    d.system_prompt = (head ? head + "\n\n" : "") + CANON_SYSTEM_NOTE;
    changed.push("system_prompt");
  }

  return { card: out, changed: changed };
}

// ── 时间锚定检查（0.22.0，宿主侧补全）───────────────────────────────
/**
 * 时间锚定的三项检查 —— 让**宿主**（工坊「校验」）也能算，而不只是 CC 模式的 `cc_validate`。
 *
 * 为什么需要：0.16–0.19 的四条注入里，用户最关心「时间锚定到底写进去没有」，
 * 但以前只有模型调 `cc_validate` 才知道；工坊里点「校验」只看得到结构。
 *
 * ⚠️ 不 import `lib/agent.js` 的 `TIME_ANCHOR_RE`：那会形成 agent → consistency → agent 的
 * 循环依赖，且预设半的模板本来就该只有一个来源。这里用固定字符串判断，口径与工具侧一致
 * （工具侧多出来的「ISO 双轨建议」是提示性的，宿主不需要）。
 *
 * 等级：error —— 与 `cc_validate` 一致。旧卡（0.15 之前）会因此显示未通过，这是**预期**的：
 * 它们确实没有防时间漂移的字段。工坊报告里会把「结构错误」与「内容建议」分开显示。
 */
export function auditAnchors(card){
  const d = (card && card.data) || {};
  const sys = asText(d.system_prompt);
  const ph = asText(d.post_history_instructions);
  const fm = asText(d.first_mes);
  const issues = [];
  const push = (code, message, refs) => issues.push({ level: "error", code, message, refs: refs || [] });

  if(!sys.trim()) push("anchor-system-missing", "缺 data.system_prompt（时间锚定）：卡里没有时间规则，运行期模型拿不到时间约束。", ["system_prompt"]);
  else if(sys.indexOf("[时间：") < 0) push("anchor-system-format", "data.system_prompt 缺少 [时间：…] 锚定格式：请用 cc_patch_character 的模板重写。", ["system_prompt"]);

  if(!ph.trim()) push("anchor-post-missing", "缺 data.post_history_instructions（生成前时间自检）。", ["post_history_instructions"]);
  else if(ph.indexOf("时间") < 0) push("anchor-post-format", "data.post_history_instructions 没有时间自检内容。", ["post_history_instructions"]);

  if(!fm.trim()) push("anchor-first-missing", "缺 data.first_mes（开场白）。", ["first_mes"]);
  else if(fm.indexOf("[时间：") < 0) push("anchor-first-format", "data.first_mes 没有以 [时间：…] 标注起始时间。", ["first_mes"]);

  return { issues, errorCount: issues.length };
}

export { stripDecorators, isRuleEntry };
