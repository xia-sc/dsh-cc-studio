# DeepSeek「鱼八股」专项设置：评估、社区方案与可落地配置

> 适用范围：用 DeepSeek 生成角色卡（本插件 CC 模式 / 任意对话）与在 SillyTavern 里用 DeepSeek 跑角色扮演。
> 源等级约定：**[官]** = 官方文档或官方仓库；**[社]** = 社区实测/经验（有链接，但结论依赖版本与环境）；**[推]** = 本文基于前两者做的机制推断，未独立实测。
> 无法确认的项统一标注 **<待补充>**，不编造来源、数据与命中率。

---

## 0. 一句话结论

那份清单**当"诊断词表 + 正则语料"有效，当"提示词禁令"基本无效**（合起来：部分有效）。
它真正的问题不是"模型不听话"，而是**用途错配**：清单是给人"认出来"用的（原词条自己就这么定位），把 50 条短语塞进 system prompt 只会让模型换一批同族句子，而在 DeepSeek V4 上连"用采样参数兜底"这条路都被官方关掉了（见 §2.1）。

落地顺序建议（性价比从高到低）：

1. **关思考 / 降 reasoning_effort**（唯一真正能改文风的旋钮）；
2. **一段正向文风标尺**（Author's Note 或卡内 `depth_prompt`，**只上一处**）；
3. **一组 ST 正则脚本**做生成后硬过滤（50 条压成 12 条规则）；
4. **制卡期自检**：用 12 条硬短语扫 `first_mes` / `mes_example`。

---

## 1. 第一部分：这份清单对 DeepSeek 到底有没有限制作用

### 1.1 判定

| 用途 | 判定 | 理由摘要 |
| --- | --- | --- |
| 放进 system prompt / 角色卡 description 当禁令（ST 运行期） | **基本无效** | V4 内置 RP 指令优先；负向清单会被"同族变体"绕过；思考模式下温度失效，没有采样兜底 |
| 放进制卡提示词（一次性生成开场/示例） | **部分有效** | 单轮任务、上下文短，模型会照做一部分；但带 `xx` 占位与单字词的条目无法执行 |
| 当"识别器"或"正则语料" | **有效** | 50 条里约 34 条能直接转正则，压成 12 条后覆盖面反而更大 |

**结论写全**：**部分有效**。它值得留下，但用法要从"求模型别写"改成"先教模型写什么，再在输出侧按词表兜底"。

### 1.2 判断依据（六条）

1. **清单的原始定位是"识别"不是"约束"。** [梗Wiki·鱼八股](https://cnmeme.wiki/entry/%E9%B1%BC%E5%85%AB%E8%82%A1) 把这个词拆成六类套路（单字硬切 / 认错官腔 / 议论腔总结癖 / 穿帮自述 / 复读固定短语 / 固定句式），并在词条里明说「当照妖镜用，不当宝典用，一条一条反着做会变成另一种腔调」。用户这份清单基本只覆盖了其中 3 类，且以**短语切片**为主 —— 拿"识别器"去当"生成约束"，本身就是错位。 **[社]**
2. **V4 内置了一套角色扮演指令，会主动对抗自定义预设。** 社区实测报告（[RP\|Fiend](https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/)）指出 V4 自带 RP 行为、会与喜欢的自定义预设"打架"，解决方案是反注入 toggle 或精简预设。一份 50 条的负向清单在 token 预算上远小于内置指令，被覆盖是预期结果。 **[社]**
3. **负向禁令对 LLM 的固有弱点：提到即激活。** 把 50 个"不要说的短语"写进上下文，等于同时给了模型一份该文风的高频词表；模型对"不要"的处理是抑制精确串，**同族变体会照样冒出来**（`我记着` / `这话我收着` / `我收着了`）。名单越长，逃逸空间越大 —— 这不是"模型不听话"，是约束粒度与目标不对齐。 **[推]**
4. **相当一部分条目不可执行。**「`xx比xx沉`」「`行，xxx`」「`xx就是认了`」里的 `xx` 是给人看的占位，模型无从对应；「稳」「很平」「很直」是普通形容词，按字符串禁会误伤正常描写；「说话少用主语后置」没量化（"少用"是几条？）；「加入一些意义不明的前缀或后缀 语气词什么的」这条本身还有歧义 —— 究竟是要加还是不要加？**一条规则写不出判定函数，就不该进 prompt。** **[推]**
5. **位置与预算不对。** 塞进角色卡 description 顶部，会被后面几屏角色设定稀释；塞进 system prompt 则要跟 V4 内置 RP 指令争同一块位置。50 条约 300 字上下，中文粗估每轮 **300–500 token**（估算值，非实测），成本不低而收益不稳定。 **[推]**
6. **采样兜底这条路已断。** DeepSeek 官方文档写明 `frequency_penalty` / `presence_penalty` 已废弃无效果、`top_p` 在多数模式下被忽略、`temperature` 在思考模式下不生效（详见 §2.1）；ST 的 DRY / rep_pen 又只对本地后端生效。也就是说 **V4 思考模式下，"降低复发概率"没有任何参数可用**，只剩提示词与输出侧过滤。 **[官]**

### 1.3 逐条体检：50 条（含 1 条重复）怎么处置

> 清点：第三部分共 50 个条目，`我不拦` 出现两次（去重后 49 条）。分类如下。

**A 类｜整句硬短语，可直接转正则（约 20 条，建议保留）**

`这句话稳` `这句话接的漂亮` `这句话我不接` `你这句话我记着` `这话我留着` `这话我记下了` `这话我收下了` `这话是ta告诉你的，还是你自己想明白的` `我记下了` `我记得了` `我记住了` `这个账我记住了` `行，我认` `认你` `认下来` `认这个` `认得实` `睡吧，我守着` `你去，我跟` `回去睡` `收不回去` `问别人还是问自己` `说的比谁都响` `没接你的xxx` `没接你那句xx`

处置：**不在 prompt 里逐条列**，改写成 3 条正则（见 §3.3）。理由：这类"自指标记"（我记/我认/我收）是最典型的训练残留，正则命中率最高、误伤最低。

**B 类｜比较句式，是同一条规则的 10 个变体（建议压成 1 条正则）**

`比之前的都重` `比之前的都轻` `比之前的都强` `比刚才轻` `比刚才重` `比刚才平` `声音没抖，但比刚才稳` `xx比xx沉` `xx比xx重` `xx比xx稳` `xx比xx轻` `很平`

处置：识别"**主语（声音/语气/这句）+ 比 + 形容词（沉/重/稳/轻/平）**"这个母模式，而不是记 11 个字面串。这一条压缩就能省掉 9 条清单。

**C 类｜离开语境不该禁（约 8 条，建议不进正则）**

`睡吧，我守着` `我不拦` `回去睡` `不催` `我跟` `很直` `他记得这事` `你掂量` / `你自己掂量`

处置：这些在特定人设里是**好台词**（守夜、外冷内热、长辈口吻）。按字面禁掉会把人写成寡言的机械体 —— 恰好就是清单自己批评的"单字硬切"。唯一例外的 `你自己掂量` 是祈使句套话，可留正则。

**D 类｜词太短、多义、会误伤（建议只在"整句 + 句末"位置匹配，默认关）**

`稳` `很平` `不催` `我跟` `行，xxx`

处置：`我跟他一起去`、`这杯水放得很稳`、`他稳住了` 都是正常中文。若一定要过滤，规则必须是「整行只有这几个字」而不是包含匹配。

**E 类｜表述本身有问题的两条结构要求**

- 「加入一些意义不明的前缀或后缀 语气词什么的」——**歧义**（要加还是要减？），且"意义不明"无法判定。
- 「说话少用主语后置」——方向对（命中"…吧，你"这种句尾追认称呼），但"少用"不可量化，且中文里"主语后置"与"谓语前置"不是一回事。

处置：改写成可执行的「称呼与主语放句首，不做事后追认（不要写"…吧，你"）」。

### 1.4 可改进点（直接照做）

1. **拆成三处，不要一处**：生成前只给 3–5 条**正向**标尺（≤150 字）；生成后用正则硬过滤；完整清单只留给人审稿与扩充正则，**不进 prompt**。
2. **压成 4 个母模式**：自指标记（记/认/收）、比较级（比…更…）、收尾金句（短句定性）、追认式称呼。母模式可以写正则，字面串不行。
3. **每条都要能写成判定函数**：写不出（`xx` 占位、单字词、"少用"）就删，别指望模型自己补语义。
4. **别把清单塞进 `mes_example`**：few-shot 示例会被模型**模仿风格**而不是"避开其中错误"，正例里只放好句子。
5. **若要用模型自身审稿**：把清单作为"审稿标准"贴进一次性任务（"按以下 50 条检查上一段，逐条指出命中并改写"），比当常驻禁令有效得多 —— 审稿任务里模型是"查"不是"演"。
6. **先量化再迭代**：拿一个角色跑 20 轮，用正则统计命中次数（见 §3.5），按数据删条目，别靠体感加词。

---

## 2. 第二部分：社区里更可落地的做法

### 2.1 先说清楚：DeepSeek 上"调采样参数"基本没有用

这是所有方案的前提，很多人在这里白花时间。**[官]**

| 参数 | DeepSeek 官方现状 | 对去八股的实际意义 |
| --- | --- | --- |
| `frequency_penalty` / `presence_penalty` | **已废弃，传了无任何效果** | 无效 |
| `top_p` | `deepseek-flash` 非思考模式恒 1.0、思考模式 <0.95 会被抬到 0.95；`deepseek-v4-pro` 启用工具时恒 0.95、否则恒 1.0 | 基本无效 |
| `temperature` | **思考模式下不生效**；范围 0–2 | 只有关思考时才是旋钮 |
| `logit_bias` | 不支持 | 无法做词级封禁（这是最理想的方案，可惜没有） |
| `stop` | 支持（≤16 条，每条 <512 字节） | 会**截断**生成，不是过滤，不建议拿来禁词 |
| `reasoning_effort` | `none` / `low` / `high` / `max` | **真正有效**：关掉或降档能改变"思考腔"外溢 |

来源：[Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)、[Temperature 设置](https://api-docs.deepseek.com/zh-cn/quick_start/parameter_settings/)（官方建议：创意写作 1.5、通用对话 1.3）。

**ST 侧要额外注意**：`DRY`、`repetition penalty`、`min_p`、`top_k`、`XTC` 这些"采样器"只在本地推理后端（llama.cpp / KoboldCpp / Ooba 等）里生效；走 Chat Completion 接 DeepSeek API 时它们**不被发送**，[PokiTavern 中文文档·采样](https://poki.omate.net/docs/zh/sampling/) 的原话是「不是每个后端都支持全部参数，不被支持的参数会被静默忽略」。所以看到"把 DRY 调高就能去八股"的教程，先确认它讲的是本地模型。 **[社]**

### 2.2 方案清单

| # | 方案 | 来源 | 怎么做 | 适用场景 | 局限 |
| --- | --- | --- | --- | --- | --- |
| 1 | **六类套路分类学** | [梗Wiki·鱼八股](https://cnmeme.wiki/entry/%E9%B1%BC%E5%85%AB%E8%82%A1) **[社]** | 用「单字硬切 / 认错官腔 / 总结癖 / 穿帮自述 / 复读短语 / 固定句式」当检查目录 | 通用 | 只教你认，不教你改；作者本人提醒别一条条反着做 |
| 2 | **拦截重说（词表三档）** | [ericenyan/dsh-yubagu](https://github.com/ericenyan/dsh-yubagu) **[社]** | 生成后拿 `hard` / `soft` / `shape` 三档词表撞一遍，命中就让模型整句退回重说 | DSH 内的文本生成（含本插件 CC 模式） | 需要宿主支持"生成后钩子"；整句重说会拉长耗时 |
| 3 | **两层过滤器（生成前 + 生成后）** | [salttove / AstrBot 去鱼八股](https://github.com/salttove/-remove-rigid-express-of-QQ-ai-chatbot) **[社]** | 生成前注入禁忌提示，生成后按词库分档清理（hard / soft / short_cut / opener_replace 等） | IM 机器人；思路可平移到 ST 正则 | 词库是中文聊天语料，RP 场景要挑着用 |
| 4 | **正向"指代"提示词** | [lattes3690/human-speak-prompt](https://github.com/lattes3690/human-speak-prompt) **[社]** | 把整套"语言=指代、虚实混杂、忌自我表功"的写法当 system prompt 整体粘贴，**不拆开用** | 角色扮演、口语对白 | 偏长（会挤占上下文）；与"结构化输出"类指令冲突 |
| 5 | **官方「角色沉浸」marker** | [victorchen96 整理（陈德里开源）](https://github.com/victorchen96/deepseek_v4_rolepaly_instruct) **[社]** | 首轮 user 消息末尾粘贴 `【角色沉浸要求】…` 三行，之后不用重复 | V4 API / APP 专家模式 | 只影响思维链、非 100% 触发；不直接治八股，但减少"解说腔" |
| 6 | **整套 DSH 预设** | [oliblue-evan/dsh-roleplay-preset](https://github.com/oliblue-evan/dsh-roleplay-preset) **[社]** | 内置 marker + 排版约定 + 文件记忆库 + 参数表 | DSH 内长期 RP | 与酒馆是两套体系；记忆库要写工作目录 |
| 7 | **反注入 / 精简预设** | [RP\|Fiend](https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/) **[社]** | 用 DS4 toggle 压掉内置 RP 指令，或换 Megumin DS4 变体 / Marinara 通用预设；建议 temp 0.6–0.7 + 关 reasoning | V4 上的 ST 角色扮演 | 社区预设质量参差；toggle 属"未公开机制"，可能随版本失效 |
| 8 | **降 `reasoning_effort`** | 百度贴吧「分享一些简单的去除鱼八股的方法」 **[社，正文抓不到]** | 把思考强度设为 none 或 low，减少思维链的"码味"外溢到正文 | API 直连 / 支持该开关的客户端 | 原文 403，仅凭搜索摘要；具体档位与效果 **<待补充>** |
| 9 | **ST 正则脚本硬过滤** | [ST 正则文档](https://sillytavern.wiki/extensions/regex/)、[PokiTavern·正则](https://poki.omate.net/docs/zh/regex/) **[社]** | 见 §3.3；`AI_OUTPUT` + 勾 Alter Outgoing Prompt 防回流 | ST 运行期（唯一真正"硬"的手段） | 只删不改，删空会留下破碎句 |
| 10 | **Author's Note 定文风** | PokiTavern·作者注释 **[社]** | 200 字以内、depth 2–4、`role: system`、interval 1 | ST 运行期 | 与卡内 `depth_prompt` 重复注入会互相顶 |

> 未核实的社区资源：~~Sukino 社区预设库~~（HF 仓库内容本次未抓取，**<待补充>**）、Discord / Reddit 的 V4 讨论串（未检索到可稳定引用的原始帖，**<待补充>**）。

---

### 2.3 ST 源码核对：`reasoning_effort` 到底传不传（SillyTavern 1.19.0）

**结论：传，但只在「显示思考 / Show thoughts」开启时；关掉它就是显式关思考。** 依据是本机 ST 源码（`E:\git\SillyTavern`，HEAD `06bde939f`，v1.19.0）：

| 位置 | 代码 | 含义 |
| --- | --- | --- |
| `public/scripts/openai.js:2820` | `include_reasoning: Boolean(settings.show_thoughts)` | UI 的「显示思考」直接决定请求里的 `include_reasoning` |
| `src/endpoints/backends/chat-completions.js:1137` | `thinking: { type: include_reasoning ? 'enabled' : 'disabled' }` | **每一轮都发**；关掉开关 = `thinking: disabled` |
| `src/endpoints/backends/chat-completions.js:1122-1124` | `if (request.body.include_reasoning && request.body.reasoning_effort)` | 只有开思考时才把 `reasoning_effort` 放进 body |
| `public/scripts/openai.js:2570-2582` | DEEPSEEK 分支：`auto→不传`、`min/low→low`、`max→max`、其余`→high` | ST 的下拉里**没有 `none`**，最省也只能到 `low` |

三条推论（直接决定 §3.2 的参数表怎么填）：

1. **想控 temperature，必须先关「显示思考」。** 只把 effort 调到 Minimum 而不关开关，effort 会传出去，但思考模式仍开着 —— 温度照样不生效，等于白改两处。
2. **要「最快 / 最省」就关「显示思考」**（等价于 DeepSeek 的 `none`），而不是在下拉里选 Minimum（那只到 `low`）。
3. **别选 Maximum**：ST 会把 `max` 原样传给 DeepSeek，思考长度与费用都会明显上去，而文风收益没有对应证据。

### 2.4 正则会不会打掉 DeepSeek 的上下文缓存、把费用放大？

**结论：不会大面积失效，代价上限是「最新一条被改动的回复」那一段；但有三件事千万别做。** **[官 + 源码 + 本文推算]**

**机制**（[DeepSeek《上下文硬盘缓存》](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)）：缓存按**缓存前缀单元**匹配，必须**完整匹配**才计入命中；落盘时机是「每次请求的用户输入结束位置」「模型输出结束位置」以及公共前缀。命中与否直接决定单价：`deepseek-flash` 高峰时段输入 **命中 0.04 元/百万 token、未命中 2 元/百万** —— **50 倍**（[价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）。所以「会不会打断缓存」是真问题，不是抠细节。

**为什么我们的正则不会打断**：

1. ST 每轮重建 prompt 时对**整段历史**重跑正则（`getRegexedString(..., { isPrompt })`），而我们的替换是 **纯文本 → 文本、无状态、幂等**：同一条历史消息在第 N 轮和第 N+1 轮被改成**逐字节相同**的结果。
2. 于是第 N+1 轮的 prompt 与第 N 轮相比，前缀部分完全一致 → 「第 N 轮输入结束位置」那个缓存单元**完整匹配**，system / 角色卡 / 世界书 / 全部历史照常命中。
3. 唯一真正 miss 的是**最新一条 assistant 回复**：缓存里落的是模型输出的**原文**，而下一轮发出去的是**清理版**，两者不同 → 那一段不算命中（约 200–500 token）。每轮最多损失这一段。

按 flash 高峰价估：一条 300 token 的回复从命中变未命中，增量 ≈ 300/1e6 × (2 − 0.04) ≈ **0.0006 元/轮**；100 轮约 6 分钱。而「全部 1 万 token 前缀失效」那种情况是 10000/1e6 × 2 ≈ 0.02 元/轮，差两个数量级 —— 我们不在那一档。

**会真的爆掉缓存的三件事**（导出物已刻意规避，`tests/yubagu.test.mjs` ③e-③g 钉住）：

| 做法 | 后果 | 我们怎么规避 |
| --- | --- | --- |
| `replaceString` 里用 `{{random}}` / `{{pick}}` / `{{time}}` 这类宏 | **每轮结果都不同 → 历史从第一条起全变 → 每轮全量未命中** | 替换串一律为空串，且测试禁止出现这些宏 |
| 会话中途启停脚本 / 改正则 | 历史前缀一次性变化 → 当轮大面积未命中，之后重新落盘恢复 | 一次配好别折腾；要改就接受一次重建 |
| 给脚本设 `maxDepth`（只清理最近 N 条） | 同一条消息的 `depth` 每轮 +1，**越过边界时清理状态翻转** → 那条之后的前缀全变，而且每条消息都会各翻转一次，等于**持续**打掉缓存 | `minDepth: 0` + `maxDepth: null`（全范围、与深度无关） |

**自测方法**（想自己确认就三步）：开正则前跑 5 轮，记下每次响应的 `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；开正则后再跑 5 轮；比较 `hit / (hit + miss)` 的比例。合理预期是**基本不变**（miss 只多出一条回复的量），若命中率腰斩，多半是踩了上表三条之一。

## 3. 第三部分：可直接用的专项设置

### 3.1 场景 A：用 DeepSeek 生成角色卡（本插件 CC 模式 / 对话）

**核心思路**：制卡是"单轮短任务"，此时提示词**真的有用** —— 但要说"写成什么样"，不是"别写什么"。

#### A-1 文风前置（粘在生成任务的最前面，约 280 字）

```text
【文风要求】你要写的是能被人念出来的台词与动作，不是评述。
1. 一段只做一件事：角色做了什么、说了什么。不要顺带解释这段关系的意义。
2. 台词落在具体名词上（物件、地点、动作），少用抽象定性词（"很稳""很直""很平"）。
3. 不写"我记下了 / 我认了 / 这话我收下"这类自我标记。要表达"我接受了"，就写他接下来的动作。
4. 不用"比之前更重/更轻/更稳"这类比较式形容情绪，直接写身体反应或改了之后的行为。
5. 每段结尾停在动作或未完成的事上，不要用一句短句做总结。
6. 称呼与主语放句首，不做事后追认（不要写"……吧，你"）。
7. 以上规则只管写法，不改人设：冷淡的角色可以话少，但话少不等于只吐单字。
```

要点：**7 条全部是正向或可判定**；第 7 条专门防"过度回避写成哑巴"。

#### A-2 开场与示例怎么写

- `first_mes`：三段以内，末段停在**动作**上（不是"他记住了"这种收束）。
- `mes_example`：**只写好的样例**，2–3 组 `<START>` 就够。不要写"错误示范→正确示范"的对照 —— 模型会连错误示范的语气一起学。**[推]**
- 世界书条目：写设定，不写禁令。禁令放一处就够。

#### A-3 生成后自检（12 条硬短语）

拿这 12 条在 `first_mes` / `mes_example` 里搜一遍，命中就改写而不是删掉：

```text
我记下了 / 我记住了 / 我认了 / 这话我收下了 / 这话我留着
比之前都 / 比刚才 / 比……沉 / 比……稳
这句话稳 / 这句话接得漂亮 / 你自己掂量 / 收不回去
```

**插件内（0.29.0，需打开「DeepSeek 专项优化」）**：工坊点「校验」后，体检报告会多出一组 **「文风（DeepSeek）」**，逐条列出 `first_mes` / `alternate_greetings[]` / `group_only_greetings[]` / `mes_example` 里命中的短语与样本；每条都能点「✨ 让模型改」，把「改成写动作、别写自我标记」的指令直接发给 CC 模式的模型。

这一组的边界（都已经写进代码注释与测试）：

- **只报 warning**，不阻塞导出 —— 文风问题不该让一张能用的卡导不出去；
- **不扫** `description` / `scenario`（设定文档里出现「我记下了」可能是在引用别人的话，误报高）；
- **必扫** `mes_example`（与「未结案钩子」相反：那里的 few-shot 不是场景状态，但这里示例就是模仿源）；
- 2 字短语（`我认` / `不催`）不进体检，否则「我认错人」「不催促」会被误报。
- **模型侧的 `cc_validate` 不带这一项**：开关存在浏览器设置里，预设半读不到；所以制卡期这道检查是**人的检查点**（工坊「校验」），不是模型自查的一部分。

#### A-4 参数

- dsh 侧模型若有 `reasoning_effort` 选项：设 `none` 或 `low`。**[推]**（本插件不写模型参数，宿主管路由）
- dsh 侧是否暴露该开关：**<待补充>**。
- 若走 API 直连且**关思考**：`temperature` 1.3–1.5，`top_p` 留默认，频率/存在惩罚留 0（反正无效）。

---

### 3.2 场景 B：SillyTavern 里跑 DeepSeek

**只上其中一处文风注入**：卡内 `depth_prompt`（跟卡走、换 ST 也带着）**或** Author's Note（跟 ST 走、随时改）。两处都上 ≈ 每轮多付一次钱，还会互相顶。

> 插件 0.29.0 起，**设置 → 插件详情页 →「DeepSeek 专项优化」（默认关）** 会把本节的参数建议列出来，并一键导出 §B-3 的正则脚本；开关不写卡、不影响模型，关着时行为与以前完全一致。

#### B-0 卡内 `depth_prompt`（一句版，约 60 字）

```text
文风：写台词与动作，不写评述；不用"我记下了/我认了"式自我标记，不用"比刚才更X"式比较，段末不做金句总结。
```

#### B-1 Author's Note（≤200 字，depth 2–4，role: system，interval 1）

```text
（写法）用动作与具体物件推进；不用"我记下了/我认了/这话我收着"这类自我标记；不用"比刚才更重/更轻/更稳"比较情绪；段末停在动作上，不做金句总结；称呼放句首，不做事后追认。
```

设置位置：`Author's Note` 面板 → 插在 `In-chat`（depth 2–4）、`System`、`Force` 不必开。**`replace` 会顶掉聊天注释**，只在明确知道自己在做什么时才勾。 **[社]**

#### B-2 参数表（照抄）

| 设置项 | 值 | 说明 |
| --- | --- | --- |
| API 后端 | `deepseek-flash` / `deepseek-v4-pro` | 走 Chat Completion |
| 思考模式 | **关**（推荐） | 关掉温度才生效；开思考就放弃参数，只靠提示 + 正则 |
| Temperature | **1.3–1.5** | 仅关思考时生效；角色一致性靠提示词不靠降温 |
| Top P | 留默认 | flash 非思考恒 1.0，改了大概率被忽略 |
| Frequency / Presence Penalty | **0** | 官方已废弃 |
| DRY / Rep Pen / Min P / Top K / XTC | **不用** | 只对本地后端生效，别浪费设置时间 |
| Max Tokens | 按需 | 与去八股无关 |

#### B-3 正则脚本（生成后硬过滤）

**放置逻辑**：`placement = AI_OUTPUT`，且 `markdownOnly` / `promptOnly` **都为 true**（= ST 界面里 `Alter Chat Display` 与 `Alter Outgoing Prompt` 两个勾都勾上）。插件导出的 JSON 已带好这组值，导入即安全。 **[官/源码]**

三个开关的实际语义（`engine.js:347-355`）：`markdownOnly && isMarkdown` 管显示、`promptOnly && isPrompt` 管发给模型的内容；**两者都为 false** 时走的是「既非显示也非提示」那条路径 —— 在回复写入聊天历史前就地替换，**原文永久丢失且不可逆**。所以别为了「改得更彻底」去取消这两个勾。

字段与位置枚举已对 `release` 分支 `public/scripts/extensions/regex/engine.js` 核对：`scriptName / findRegex / replaceString / trimStrings / placement[] / disabled / markdownOnly / promptOnly / runOnEdit / substituteRegex / minDepth / maxDepth`；`AI_OUTPUT = 2`。

**怎么拿**：从 **0.29.0** 起不用手抄 —— 插件详情页 →「DeepSeek 专项优化」打开开关 →「⬇ 导出 ST 正则脚本」，拿到 `cc-studio-yubagu-<日期>.json`，在 ST 的正则扩展里 Import。规则真源在 `lib/yubagu.js`（3 条），文档这里只放**第一条的字段样例**，手工建的时候照这个形状填即可：

```json
[
  {
    "id": "cc-studio-yubagu-selfmark",
    "scriptName": "鱼八股·自指标记（整句）",
    "findRegex": "/^[\\s「“\"]*(?:行[，,]?\\s*)?(?:我认了|我认下来|我认这个|我认你|认得实|我认|我记下了|我记住了|我记得了|这话我记下了|这话我收下了|这话我留着|你掂量|你自己掂量|不催你?|收不回去|问别人还是问自己|说的比谁都响)[\\s。！？…~～\"」]*$/gm",
    "replaceString": "",
    "trimStrings": [],
    "placement": [2],
    "disabled": false,
    "markdownOnly": true,
    "promptOnly": true,
    "runOnEdit": true,
    "substituteRegex": 0,
    "minDepth": 0,
    "maxDepth": null
  }
]
```

其余两条（比较句式 / 自指点评）由插件导出时一起给出，不要在文档或客户端里再抄一份 —— 两份拷贝一定会漂。

**默认关闭的两条（按需开）**：

```text
尾随称呼：([，,。！？…])[「“]?(你|您)[」”]?(?=[。！？…"」]|$)   →   $1
裸比较：  /(?:比之前(?:的)?都|比刚才)(?:要|更)?(?:重|轻|稳|平|强)/g   →   ""
```

第一条会把「…吧，你」的追认称呼删掉；第二条会误伤「他比昨天轻了两斤」这类客观描述，所以默认不开。

**必读警告**：正则只做删除，删完可能剩下 `「他，」` 这种破碎句。宁可少开、只开第 1 条，也不要追求"全清" —— 过度清洗的结果就是清单自己批评的「单字硬切」。

#### B-4 世界书

不必为文风单独建常驻条目。若已有一份「文风锚点」常驻条目（`constant`、position `before char`、depth 2–4），就不要再叠 Author's Note —— 同一段规则每轮读两遍是纯成本。 **[推]**

---

### 3.3 落成 12 条正则（清单压缩对照）

| 母模式 | 覆盖的原条目 | 正则要点 |
| --- | --- | --- |
| 自指标记（认/记/收） | 我记下了、我记住了、我记得了、行，我认、认你、认下来、认这个、认得实、xx就是认了、这个账我记住了、这话我留着/记下了/收下了 | 整行匹配，`^…$` |
| 自指点评 | 这句话稳、这句话接得漂亮、这句话我不接、没接你的xxx、没接你那句xx | 整行匹配 |
| 比较级 | 比之前的都重/轻/强、比刚才轻/重/平、声音没抖但比刚才稳、xx比xx沉/重/稳/轻 | `主语 + 比 + 形容词` |
| 祈使套话 | 你自己掂量、你掂量、不催、不催你、问别人还是问自己、说的比谁都响 | 整行或句末 |
| 收束式台词 | 睡吧，我守着、你去，我跟、回去睡、收不回去 | 整行；**建议只保留 `收不回去`**，其余属正常台词 |
| 追认称呼 | 主语后置那一条 | 句末 `，你` → 删 |

---

### 3.4 最小可行集（只做这四件）

1. **关「显示思考」**（ST 侧）或 `reasoning_effort: low`（API 直连）—— 唯一真正改文风的旋钮；关了思考 temperature 才生效（§2.3）。
2. **一段 ≤200 字正向文风标尺**，只放 Author's Note **或** 卡内 `depth_prompt`，二选一。
3. **导入 3 条正则**：插件 0.29.0 起在详情页「DeepSeek 专项优化」里一键导出；导出时就已预设 `Alter Chat Display` + `Alter Outgoing Prompt`，导入后别取消它们。
4. **制卡期用 12 条硬短语自检** `first_mes` / `mes_example`。

四件都不做、只把那张清单贴进角色卡，基本等于没做（见 §1）。

### 3.5 怎么知道有没有效

没有公开的命中率数据，**别信任何百分比**。自测方式：

1. 固定一个角色、固定 20 轮，记录每次回复；
2. 用 §3.3 的正则（不开替换，只数命中）或人工数一遍命中次数；
3. 只改一个变量（先关思考 / 再加 AN / 最后加正则），比较三组的命中数；
4. 命中数下降但"单字硬切"变多 → 说明过滤过头，退掉第 3 条。

---

## 4. 这块功能怎么安全删除

这是**针对某一代模型行为**的补丁，不是角色卡规范的一部分。DeepSeek 哪天在模型层面把鱼八股修掉了，它就该整块消失，而不是留在仓库里当永久税。

**标记方式**：全仓库用 `DEEPSEEK-TUNING` 做标记。

```bash
grep -rn "DEEPSEEK-TUNING" .   # 一次列出所有落点
```

真源在 `lib/yubagu.js`，文件头写着完整的删除清单，末尾也重复一遍；`tests/yubagu.test.mjs` 的 ⑥a-⑥e 会检查「标记还在、清单没漏、e2e 的断言也带了标记」—— 所以删的时候漏掉哪一处，测试会先叫。

**删除清单**（照做即可，各步都是独立可回滚的）：

| # | 位置 | 删什么 |
| --- | --- | --- |
| 1 | `lib/yubagu.js` | 整文件（含 ST 脚本、体检函数、短语表、删除清单注释） |
| 2 | `lib/index.js` | `import { yubaguJson, ... } from "./yubagu.js"`、`case "cc_yubaguScripts"` 整段、`case "validate"` 里那段 `await import`；`validateCard(card, extras)` 的第二个参数与 `extras.auditYubagu` 分支 |
| 3 | `lib/client.js` | `settings.deepseek.*` / `export.yubagu.*` 词表键、`deepseekTuning` 的 load/save/state/setter、`exportYubaguScripts`、设置页「DeepSeek 专项优化」块、导出弹层那块、`validate()` 里传的开关、`AUDIT_FIX.yubagu`、`auditGroups` 的 `style` 分组、`workshop.audit.style` / `workshop.fix.yubagu` 两个键 |
| 4 | `tests/yubagu.test.mjs` | 整文件 + `package.json` 的 `scripts.test` 链里那一行 |
| 5 | `scripts/e2e-smoke.mjs` | `[DEEPSEEK-TUNING]` 那段断言 |
| 6 | 文档 | 本文件整份；README / README_EN 的对应小节与更新日志条目 |
| 7 | **用户侧** | 去 ST 的正则扩展里删掉那三条脚本 —— 它们不会因为插件删代码就消失，会继续删字 |

删完跑 `npm test` 与 `npm run e2e`：应当全绿，且 `grep -rn "DEEPSEEK-TUNING" .` 无输出。

**为什么能整块删**：开关默认关、关着时不加载模块（`await import` 在 `args.deepseekTuning === true` 分支里）；宿主与客户端之间只多了一个端点 `cc_yubaguScripts` 和一条 `validate` 的可选参数，删掉它们不影响任何主干路径 —— 这也是当初把它做成「一个文件 + 两个接线点」的原因。

## 附：<待补充> 清单

| 项 | 状态 |
| --- | --- |
| 贴吧「分享一些简单的去除鱼八股的方法」正文（含 reasoning_effort 档位建议） | 抓取 403，仅凭搜索摘要 |
| V4.1 与 V4 在鱼八股上的差异、各词条实际命中率 | 无实测数据 |
| dsh 侧模型配置是否可设 `reasoning_effort` | 未核实 |
| Sukino 预设库 / Discord / Reddit 原始讨论串 | 未抓取，不引用 |
| 星野、猫箱等平台的同类做法 | 未检索 |

## 来源

- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) **[官]**
- [DeepSeek Temperature 设置](https://api-docs.deepseek.com/zh-cn/quick_start/parameter_settings/) **[官]**
- [梗Wiki·鱼八股](https://cnmeme.wiki/entry/%E9%B1%BC%E5%85%AB%E8%82%A1) **[社]**
- [victorchen96/deepseek_v4_rolepaly_instruct](https://github.com/victorchen96/deepseek_v4_rolepaly_instruct) **[社]**
- [oliblue-evan/dsh-roleplay-preset](https://github.com/oliblue-evan/dsh-roleplay-preset) **[社]**
- [RP|Fiend：DeepSeek V4 Flash Presets for SillyTavern](https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/) **[社]**
- [lattes3690/human-speak-prompt](https://github.com/lattes3690/human-speak-prompt) **[社]**
- [salttove/AstrBot 去鱼八股](https://github.com/salttove/-remove-rigid-express-of-QQ-ai-chatbot) **[社]**
- [ericenyan/dsh-yubagu](https://github.com/ericenyan/dsh-yubagu) **[社]**
- [PokiTavern 中文文档](https://poki.omate.net/docs/zh/sampling/) **[社]**
- [SillyTavern 正则文档](https://sillytavern.wiki/extensions/regex/) **[社]**
