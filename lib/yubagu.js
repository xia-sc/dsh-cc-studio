/**
 * [DEEPSEEK-TUNING] DeepSeek 专项优化 —— 唯一真源，**可整块删除**。
 *
 * ⚠️ 这个文件是「鱼八股」（DeepSeek 特有的短句腔：`我记下了` / `行，我认` / `声音比刚才稳`）
 *    专项优化的全部逻辑。它解决的问题是**当前模型版本的行为**，不是角色卡规范的一部分。
 *    未来 DeepSeek 若在模型层面修掉了这个问题，请按文件末尾「安全删除」一节的清单整块移除，
 *    不要把这些规则留在卡里、预设里或文档里当「通用文风规范」—— 那会让一个临时补丁变成永久税。
 *
 * 内容分两半，共用同一份短语表：
 *   1. 运行时兜底：导出 ST 正则脚本（`buildYubaguScripts` / `yubaguJson`），由用户在 ST 侧导入；
 *   2. 制卡期体检：`auditYubaguCard(card)` 扫开场与示例，命中只报 warning（不阻塞导出）。
 *
 * 为什么运行时那三条一律 `^…$` 整行匹配，而体检用「包含」匹配：
 *   - 运行时删字必须**宁漏不误**（`稳` / `我跟` / `很平` 这类短词按包含匹配会误伤正常描写）；
 *   - 体检只产出 warning 并给样本，人对样本负责，所以召回优先 —— 但只拿 ≥3 字的短语，
 *     2 字的（`我认` / `不催`）一律不进体检，避免把「我认错人」「不催促」报成问题。
 *
 * 字段名与 `ST_AI_OUTPUT` 枚举值已对 SillyTavern 1.19.0 的
 * `public/scripts/extensions/regex/engine.js` 核对：scriptName / findRegex / replaceString /
 * trimStrings / placement[] / disabled / markdownOnly / promptOnly / runOnEdit /
 * substituteRegex / minDepth / maxDepth。
 */

/** ST 正则脚本的 placement 枚举：2 = AI 输出（其余取值见 engine.js 的 regex_placement）。 */
export const ST_AI_OUTPUT = 2;

/**
 * 自指/官腔短语表（整句版用）。也是体检用的语料源 —— 只此一份，别再抄到客户端或文档里。
 * 短的（`我认` / `不催`）留着给整句正则用（`行，我认` 就靠它），但体检会按长度过滤掉。
 */
export const YUBAGU_PHRASES = [
  "我认了", "我认下来", "我认这个", "我认你", "认得实", "我认",
  "我记下了", "我记住了", "我记得了",
  "这话我记下了", "这话我收下了", "这话我留着",
  "你掂量", "你自己掂量", "不催", "不催你",
  "收不回去", "问别人还是问自己", "说的比谁都响",
  "这句话稳", "这句话接得漂亮", "这句话我不接",
  "没接你那句话", "没接你的话",
];

/** 体检只用长度 ≥3 的短语（2 字的按包含匹配误伤率太高）。 */
export const YUBAGU_AUDIT_PHRASES = YUBAGU_PHRASES.filter((p) => p.length >= 3);

/** 比较级句式（运行时与体检共用同一条正则，只是体检按包含匹配用）。 */
export const YUBAGU_COMPARE_RE = /(?:声音|语气|话|这句|这一句|嗓音)[^。！？\n]{0,8}比[^。！？\n]{0,10}?(?:沉|重|稳|轻|平|强)(?:了)?/g;

/**
 * 三条脚本。`findRegex` 必须是 ST 认识的 `/pattern/flags` 字面量字符串。
 *
 * 为什么导出时就带 `markdownOnly: true` + `promptOnly: true`（= ST UI 里两个勾都勾上）：
 *   engine.js:347-355 的判定是「markdownOnly && isMarkdown」或「promptOnly && isPrompt」，
 *   而两者都为 false 时只在「既非显示也非提示」那条路径生效 —— 那条路径**直接改写聊天记录**，
 *   原文永久丢失（不可逆）。让用户导入后自己去勾，等于把「漏勾一次就毁掉聊天记录」交给他；
 *   预设成安全档位，导入即安全，漏点也只是清理不生效。
 *   （ST 自己迁移旧版 MD_DISPLAY placement 时也是这么设的，见 index.js:1389-1398。）
 *
 * 为什么 `maxDepth: null`：深度限制会让同一条历史消息的清理状态随轮次翻转（depth 每轮 +1），
 * 每次翻转都会让该消息之后的前缀全部变化 → 反复打掉 DeepSeek 的前缀缓存（命中/未命中价差 50 倍）。
 * 见 docs/deepseek-yubagu-tuning.md §2.4。
 */
function makeScript(id, scriptName, findRegex){
  return {
    id,
    scriptName,
    findRegex,
    replaceString: "",
    trimStrings: [],
    placement: [ST_AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: null,
  };
}

/** 整句正则：行首可带「行，」，行尾允许引号与标点。短语表直接用 `|` 拼接，不手抄第二份。 */
const SELF_MARK_RE = String.raw`/^[\s「“"]*(?:行[，,]?\s*)?(?:${YUBAGU_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\s。！？…~～"」]*$/gm`;

export const YUBAGU_SCRIPTS = [
  makeScript("cc-studio-yubagu-selfmark", "鱼八股·自指标记（整句）", SELF_MARK_RE),
  makeScript(
    "cc-studio-yubagu-compare",
    "鱼八股·比较句式",
    // 只抓「主语（声音/语气/话/这句/嗓音）+ 比 + 形容词」，裸的「比…重/轻」会误伤
    // 「他比昨天轻了两斤」这类客观描述，所以默认不放进这条。
    String.raw`/(?:声音|语气|话|这句|这一句|嗓音)[^。！？\n]{0,8}比[^。！？\n]{0,10}?(?:沉|重|稳|轻|平|强)(?:了)?/g`,
  ),
  makeScript(
    "cc-studio-yubagu-quote",
    "鱼八股·自指点评",
    // 「这句话稳 / 这话接得漂亮 / 没接你那句话」—— 对上一句的点评，是鱼八股里最典型的收尾。
    String.raw`/^(?:这句话|这话)(?:稳|接得漂亮|我不接)[。！？…]*$|^[\s「“"]*没接(?:你)?(?:的)?(?:那)?[句话]{1,2}[\s。！？…"」]*$/gm`,
  ),
];

/** 深拷贝一份（调用方改返回值不影响真源；也让宿主端点每次都给新对象）。 */
export function buildYubaguScripts(){
  return JSON.parse(JSON.stringify(YUBAGU_SCRIPTS));
}

/** ST「Import script」要的就是这个：一个脚本数组。 */
export function yubaguJson(){
  return JSON.stringify(buildYubaguScripts(), null, 2) + "\n";
}

/** 下载文件名（带日期，重复导出不互相覆盖）。 */
export function yubaguFileName(now){
  const d = now instanceof Date ? now : new Date();
  const stamp = d.toISOString().slice(0, 10);
  return "cc-studio-yubagu-" + stamp + ".json";
}

const AUDIT_MAX_SAMPLES = 5;

function asText(v){
  return typeof v === "string" ? v : (v == null ? "" : String(v));
}

/**
 * 制卡期体检：开场与示例里有没有把鱼八股**写死**。
 *
 * 扫 `first_mes` / `alternate_greetings[]` / `group_only_greetings[]` / `mes_example`。
 * **不扫** `description` / `scenario`：那是设定文档，出现「我记下了」可能是在引用别人的话，
 * 误报率高；而且这两处的口癖会在运行期被正则覆盖，真正致命的是 few-shot 示例与开场
 * —— 它们会被模型逐轮模仿，运行期正则删不掉（删了就是毁人设）。
 *
 * 返回 `{ hits, count, message, issues }`：`issues` 形状与 consistency.js 的其他体检项一致，
 * 调用方直接 push 进 `cons.issues`。level 固定 warning —— 文风问题不该阻塞导出。
 */
export function auditYubaguCard(card){
  const d = (card && card.data) || {};
  const sources = [];
  const squeeze = (v) => asText(v).trim();
  if (squeeze(d.first_mes)) sources.push({ where: "first_mes", text: asText(d.first_mes) });
  const collect = (field, list) => {
    if (!Array.isArray(list)) return;
    list.forEach((s, i) => { if (squeeze(s)) sources.push({ where: field + "[" + i + "]", text: asText(s) }); });
  };
  collect("alternate_greetings", d.alternate_greetings);
  collect("group_only_greetings", d.group_only_greetings);
  if (squeeze(d.mes_example)) sources.push({ where: "mes_example", text: asText(d.mes_example) });

  const hits = [];
  for (const src of sources) {
    const found = [];
    for (const phrase of YUBAGU_AUDIT_PHRASES) {
      if (src.text.includes(phrase)) found.push(phrase);
    }
    const compare = src.text.match(new RegExp(YUBAGU_COMPARE_RE.source, "g"));
    if (compare && compare.length) found.push(compare[0]);
    if (found.length) {
      hits.push({ where: src.where, phrases: found.slice(0, 4), text: src.text.replace(/\s+/g, " ").slice(0, 40) });
    }
  }

  const count = hits.reduce((n, h) => n + h.phrases.length, 0);
  const samples = hits.slice(0, AUDIT_MAX_SAMPLES).map((h) => h.where + "：「" + h.phrases.join("、") + "」");
  const message = count
    ? "开场/示例里有 " + count + " 处「鱼八股」式表达（" + samples.join("；") + (hits.length > samples.length ? " 等" : "") + "）。"
      + "这些会被模型当成角色口癖逐轮模仿，运行期正则删不掉（删了就是毁人设）。改法：把自我标记换成角色接下来的动作，把「比…更X」换成身体反应，段末停在动作上。"
      + "这是 DeepSeek 专项优化的启发式提示，不阻塞导出。"
    : "";
  const issues = count
    ? [{ level: "warning", code: "yubagu", message, refs: hits.map((h) => h.where + "：「" + h.phrases.join("、") + "」") }]
    : [];
  return { hits: hits.slice(0, AUDIT_MAX_SAMPLES), count, message, issues };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 【安全删除】未来 DeepSeek 在模型层面修掉「鱼八股」之后，按下面清单整块移除本功能。
 * 全仓库用 `DEEPSEEK-TUNING` 做标记，`grep -rn "DEEPSEEK-TUNING" .` 即可定位所有落点；
 * `tests/yubagu.test.mjs` 的 ④n 会检查这份清单还在、且标记没被删干净。
 *
 *  1. 删除本文件 `lib/yubagu.js`（整文件）。
 *  2. `lib/index.js`：删掉 `import { yubaguJson, ... } from "./yubagu.js"`、
 *     `case "cc_yubaguScripts"` 整段，以及 `case "validate"` 里那段动态 import；
 *     并把 `validateCard(card, extras)` 的第二个参数与其调用一起去掉。
 *  3. `lib/client.js`：删掉 `settings.deepseek.*` / `export.yubagu.*` 词表键、
 *     `deepseekTuning` 的 load/save/state/setter、`exportYubaguScripts`、
 *     SettingsView 里「DeepSeek 专项优化」块、exportPanel 里那块、`validate()` 里传的开关、
 *     `AUDIT_FIX` 的 `yubagu` 一行与 `auditGroups` 的 `style` 分组、
 *     以及 `workshop.audit.style` / `workshop.fix.yubagu` 两个词表键。
 *  4. 删 `tests/yubagu.test.mjs`，并从 `package.json` 的 `scripts.test` 链里去掉它。
 *  5. 删 `scripts/e2e-smoke.mjs` 里「DeepSeek 专项优化 → 导出 ST 正则脚本」那段断言。
 *  6. 删 `docs/deepseek-yubagu-tuning.md`，并移除 README / README_EN 的对应小节与更新日志条目。
 *  7. `rm -rf` 掉用户 ST 里的三条正则（正则扩展 → 列表 → 删除），否则它们会继续删字。
 *
 * 删完跑 `npm test` + `npm run e2e`，应当全绿且再无 `DEEPSEEK-TUNING` 命中。
 * ────────────────────────────────────────────────────────────────────────────
 */
