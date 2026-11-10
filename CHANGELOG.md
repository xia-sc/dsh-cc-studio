# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。**只保留 0.12.0 起的版本**；0.11.x 及更早见 git 历史。

格式：最新版本按「新增 / 修复」写；更早的小节按现象 → 根因 → 修法 → 生效方式。

## 0.19.1

**修复 0.19.0 设定铁律的 3 个 bug + 6 条体验改进（用户反馈）。**

### 修复

- **存量卡一 validate 就 `valid=false`（最严重）**：派生 canon 时 fact 被截成「40 字 + 省略号」= 41 字，而审计判 `> 40` 即 error —— 只要设定写得长一点，派生结果必然超限，所有没显式传过 canon 的卡都过不了校验。修法：截断结果保证 ≤ 上限（省略号占位），并优先切在标点处，不把词切成两半。
- **极性词表把时间副词当极性词**：`早已 / 曾经 / 一直 / 从未 / 始终` 会让「三年抵债契早就满了」被判成「早已没了」。修法：词表只留状态词（完好 / 仍在 / 已毁 / 已烧毁…），并把匹配收窄到**同一句**内同时出现实体名与状态词。
- **纯规则条目被算进 `canon-coverage-gap`**：常驻的「演出规范」这类指令条目没有实体主题，却每次 validate 都拖一条消不掉的 warning。修法：`constant` 且正文以「【」/「[」开头、或无 keys 且含指令词（必须 / 不要 / 禁写 / 每轮…）的条目跳过；另加条目级 `skipCoverage: true` 手动豁免。

### 改进

- **注入「设定铁律」顶爆预算时给可执行数值**：返回里直接给 `cc_patch_book_meta({ token_budget: N })` 的建议值（当前用量 + 10%，向上取整到百位）。
- **canon 与条目脱钩的提示**：`cc_canon` 记录写入时的内容指纹；之后改了世界书 / 五维却没重传 canon → `canon-stale` warning（重传后消失）。
- **`digest:true` 首次不再只给空 canon**：没有落盘 canon 时返回只读派生预览（`source:"derived-preview"`）并说明「cc_validate 会正式写入」。
- **`errors[]` 与 `consistency.issues[]` 去重**：error 级 issue 标 `inErrors:true`，模型不会当两条分别处理。
- **`revDrift` 误报**：`meta.rev` 是 `undefined` 时 `undefined !== null` 为 true，导致每次 `cc_get_card` 都报「草稿已被外部修改（rev undefined → 75）」；改成只有真的持有数字版本号才判定。
- **`fieldBrief` 的 keys 截断标记**：补 `keysTotal` / `keysTruncated`，避免模型以为触发词只有前 6 个。

### 测试

- `tests/canon.test.mjs` 增加 ⑨–⑰ 覆盖上述 9 项；全量测试全绿。

### 生效方式

**改的是预设半（`lib/agent.js`）与共享纯函数（`lib/consistency.js`）：重启 `dsh web` 并刷新页面。**

## 0.19.0

**设定铁律（Canon）：把「运行期不吃书」的约束编译进卡，而不是只在制卡期做校验。**

现象：卡导进 SillyTavern 之后，长对话里模型开始「吃书」—— 和前文设定、世界书条目自相矛盾。制卡期的校验拦不住，因为插件在运行期并不在场。

根因（两条）：

1. 约束只存在于模型上下文里，**卡里没有可注入的事实清单**。ST 不会把卡内 `character_book` 自动转成世界书（要手动 Import Card Lore），所以最常见的卡片形态里，运行期模型手里只有角色字段。
2. `cc_validate` 只查结构与格式，**零一致性检查**；而整份草稿在工具返回里又常超过上下文裁剪阈值（预设的 `tool-result-pruner` 是 8192 字符），模型核对时看不到中段条目 —— 只能凭记忆写。

修法：

- **设定铁律（Canon）**：`cc_validate({canon:[{subject,fact}]})` 提交 ≤12 条 × ≤40 字的事实，工具把它编译进三处 —— Character's Note（ST 每轮注入，**铁律全文只进这一处**）、Post-History（只放一句仲裁语）、卡内世界书常驻条目「设定铁律」；`system_prompt` 只加一句指引（并入时间模板，避免挤掉 ST 的 Main Prompt）。
- **运行期成本实测**：12 条铁律时约 **1000 token/轮**（system 440 + post 231 + Character's Note 337）。初版曾把全文同时注入 Character's Note 与 Post-History，等于每轮把同一份 187 token 的事实清单读两遍（1195/轮）—— 已去重，省掉这一份。
- **不传也能用**：工具按现有内容自动派生草案（`source=derived`，给 warning 让用户确认），旧卡不必手工迁移；派生时不往世界书塞条目（否则每张旧卡校验一次就多一条）。
- **门禁**：canon 超长、同一实体两条不同说法、同名条目两种内容 → `valid=false`；手工条目的主题没进铁律 → warning。宿主 `validate` 端点一并返回 `consistency`，工坊「校验」显示清单（含冲突两处的原文引用）。
- **`cc_get_card({digest:true})`**：小体积摘要（铁律 + 各字段前 120 字 + 条目标题/触发词），保证核对一致性时不被上下文裁剪；四个写入口的返回也附带 `canonDigest`。
- 明确能力边界：**只做可计算检查（长度 / 重复 / 覆盖 / 极性词可疑），不判断语义矛盾**。文档与工具文案都不宣称能自动检出「吃书」。

### 测试

- 新增 `tests/canon.test.mjs`（派生 / 审计 / 三处注入与幂等 / 门禁 / digest）；`rpc-channel` 与 `preset-install` 增加 canon 断言；全量测试全绿。

### 生效方式

**宿主 / 预设半有改动：重启 `dsh web` 并刷新页面。** 旧卡载入后调一次 `cc_validate` 会自动生成铁律草案。

## 0.18.0

**正式版：时间锚定增强 + 自定义纪年（包含 0.18.0-alpha.1 / 0.18.0-alpha.2 的全部内容）。**

### 内容

- **时间锚定**（0.16.0 起）：`system_prompt` 时间规则 + `post_history_instructions` 生成前自检 + `first_mes` 起始时间戳；`cc_patch_character` 在模型漏写时自动兜底写入。
- **Character's Note**（0.17.0）：`data.extensions.depth_prompt` 由 ST 每轮注入在最近消息内；`cc_patch_world({timeLore:true})` 可选世界书常驻条目；`timeVariable` 进阶变量占位。
- **自定义纪年 / 架空历法**（0.18.0-alpha.2，Issue #6）：宽松锚点 + 双轨写法 + `cc_patch_greetings({startAnchor})`；纯自定义纪年通过校验（只给 ISO 对照 warning）。
- **发布流程**（0.18.0-alpha.1）：`vX.Y.Z-alpha.N` 自动走 `npm publish --tag alpha` + GitHub Release `--prerelease`，不覆盖 `latest`。

### 测试

- 全量 29 个文件、1245 项断言全绿。

### 生效方式

**宿主 / 预设半有改动：重启 `dsh web` 并刷新页面。**

## 0.18.0-alpha.2

**时间锚点支持自定义纪年 / 架空历法（A+，双轨制）。** Issue #6：仙侠 / 西幻 / 架空星历的卡写不出 `[时间：YYYY-MM-DD HH:MM]`，被 `cc_validate` 直接挡下。

### 新增

- **宽松锚点**：`TIME_ANCHOR_ANY_RE` 接受 `[时间：…]` 内任意纪年文本（1-80 字符、单行）。`cc_validate` 三档：ISO 前缀通过；任意纪年通过但 warning（建议双轨）；完全没有锚点才 error（文案给双轨示例）。
- **双轨写法**：`TIME_SYSTEM_PROMPT` / `TIME_POST_HISTORY` / `TIME_DEPTH_PROMPT` / `TIME_LORE_PROMPT` 全部写明「推荐双轨：`[时间：1287-09-12 07:40]（天启三年九月十二·辰时）`；架空历法可直接写 `[时间：天启三年九月十二 辰时]`」。
- **`cc_patch_greetings({startAnchor})`**：任意纪年起始锚点，`first_mes` 缺锚点时自动补 `[时间：<startAnchor>]`；`greetings.timeAnchored` 改用宽松正则，另报 `timeAnchoredISO`。
- `cc_patch_greetings` / `cc_validate` 的参数说明与错误文案同步。

### 说明

- 插件在**制卡期**只做格式校验，运行时不参与 —— 放宽不会丢失任何已实现的检测能力（此前也没有运行时倒退检测）。
- 纯自定义纪年能通过，但没有 ISO 前缀时无法做程序化时间对照，所以只给 warning 而非 error。

### 测试

- `tests/time-anchor.test.mjs` 23 → 28 项：宽松正则、模板双轨、`startAnchor`、自定义纪年 first_mes 通过 + warning。
- 全量 29 个文件、1245 项全绿。

### 生效方式

**宿主 / 预设半有改动：重启 `dsh web` 并刷新页面。**

## 0.18.0-alpha.1

**首个 Alpha 版本：发布通道 + 0.17.0 的全部内容。**

### 说明

- **发布流程支持预发布**：`vX.Y.Z-alpha.N` tag 会 `npm publish --tag alpha`（**不覆盖 latest**），GitHub Release 自动标 `--prerelease`；`beta` / `rc` 同理（dist-tag 取 `-` 后的第一段）。
- 本版本功能与 `0.17.0` 相同（时间锚定增强：system_prompt / post_history_instructions / Character's Note / first_mes 时间戳 / timeLore / timeVariable），用于验证 Alpha 通道；`latest` 仍指向 `0.17.0`。
- 安装 Alpha：`dsh plugin --profile <profile> add @xia-sc/dsh-cc-studio@alpha`（或精确到 `@0.18.0-alpha.1`）。
- 版本守卫已放宽到接受预发布后缀（`## x.y.z-alpha.N` 的 CHANGELOG 标题、`build` 字段）。

### 测试

- 沿用 0.17.0 的全量套件；版本相关守卫改为接受 `-alpha.N`。
- `npm test` 全绿。

### 生效方式

**与 0.17.0 相同：重启 `dsh web` 并刷新页面。**

## 0.17.0

**时间锚定增强：Character's Note（depth_prompt）+ 可选的世界书常驻条目 / 变量占位。**

### 新增

- **Character's Note（`data.extensions.depth_prompt`）**：`cc_patch_character` 自动写入 `{prompt: 时间自检, depth: 4, role: "system"}`。ST 把它注入在**最近消息内**（IN_CHAT @Depth 4），比 post-history 更靠近生成点，且不受 `prefer_character_prompt` / `prefer_character_jailbreak` 开关影响；群聊里每张成员卡各自注入。显式传 `depthPrompt` 可覆盖，传空串可清空。
- **`cc_patch_world({timeLore:true})`**：额外生成一条 `constant: true` 的「时间锚定」世界书条目（`@@position after_desc`，每轮必插）。
- **`cc_patch_character({timeVariable:true})`**（进阶，默认关）：在 system_prompt / depth_prompt 末尾追加 `{{getvar::cc_story_time}}` 占位，供 ST 侧自行维护故事内时间。
- **工坊展示**：角色细化页只读显示 Character's Note（`workshop.field.depthNote`）。
- `cc_validate` 新增提示：缺 depth_prompt（warning）、depth_prompt 无时间锚点（warning）、卡内「时间锚定」条目在 ST 里需手动 Import Card Lore（warning）。

### 说明（能做到什么程度）

- **depth_prompt**：纯卡自带、ST 每轮注入在最近位置，单聊/群聊都生效 —— 这是卡方案里能做到的最深位置（仍是静态文本）。
- **世界书条目**：可行，但**卡内 `character_book` 不会被 ST 自动转成世界书**；要自动生效请放进组共享书（一键导入 ST 会先导书），否则需手动 Import Card Lore 或导出独立世界书。
- **变量宏**：`{{getvar}}` 在 system / post-history / depth_prompt / 世界书里都会展开，但**卡无法自动写变量**（AI 输出的 `{{setvar}}` 不会被执行，卡也带不了 Quick Reply）。`timeVariable` 只是占位，需要在 ST 侧用 Quick Reply / `/setvar` 维护；未设置时模板回退到正文时间戳。**纯卡做不到「每轮自动注入当前故事时间」。**

### 测试

- `tests/time-anchor.test.mjs` 扩到 23 项：depth_prompt 自动写入/覆盖/清空、timeVariable 占位、timeLore 条目、validate 提示、V2 投影保留 `extensions.depth_prompt`。
- 全量 29 个文件、1240 项全绿。

### 生效方式

**宿主 + 客户端都有改动：重启 `dsh web` 并刷新页面。**

## 0.16.0

**时间锚定（防时间漂移）：强制写入 System Prompt 与历史后置指令。** 反馈：LLM 写卡/续写时没有时间观念 —— 上一段还是早晨，下一段就把事情推到晚上。

### 新增

- CC 模式制作角色卡时**强制**写入 `data.system_prompt`（时间规则）与 `data.post_history_instructions`（生成前时间自检）：
  - `system_prompt` 要求每段回复以 `[时间：YYYY-MM-DD HH:MM]` 开头、时间只能向前、推进幅度与剧情匹配、不得无过渡跳时段，并保留了 ST 默认的基础句；
  - `post_history_instructions` 要求生成前依次检查「上一段时间戳 → 本段经过多久 → 是否跨时段」，不输出自检过程，最后以新时间戳开头。
- **工具兜底**：`cc_patch_character` 在模型没传两个字段时**自动写入模板**（显式传了就以调用方为准）；`cc_patch_greetings` 新增 `startTime`，`first_mes` 缺时间戳时自动补 `[时间：…]` 前缀。
- `cc_validate` 新增三条 error（缺 system_prompt 时间锚定 / 缺 post_history 时间自检 / first_mes 无时间戳），并提示「system_prompt 会替换 ST 的 Main Prompt」。
- 导出层零改动：两个字段是 V2/V3 标准字段，PNG（chara/ccv3）、JSON、CHARX 原样携带；ST 默认 `prefer_character_prompt` / `prefer_character_jailbreak` 开启，导入即生效。

### 说明（有效性）

提示词约束是**软约束**：能显著降低「早晨→夜晚」式漂移（每段时间戳进入对话历史，下一轮有显式锚点；post-history 注入在生成点附近），但**不能保证 100%** —— 上下文截断、模型忽略指令、剧情需要大幅跳时仍可能漂移。更强的运行时方案（ST 变量宏 `{{getvar}}/{{setvar}}`、Character's Note/depth_prompt、世界书 constant 时间条目）列为后续，不进本期默认。

### 测试

- 新增 `tests/time-anchor.test.mjs`（14 项）：模板与正则、自动写入且不覆盖定制、`startTime` 补前缀且不重复、validate 三条 error 与补齐后通过、V2 投影保留两个字段。
- `tests/tools-contract.test.mjs` / `tests/shared-book.test.mjs` 的 seed 卡补 `first_mes` 时间戳（强制校验的预期变化）。

### 生效方式

**宿主 + 预设都有改动：重启 `dsh web`（预设行）并刷新页面。**

## 0.15.1

**一键导入本机 SillyTavern；修复 JPG/WebP 封面导入失败与错误误报。**

### 新增

- **导出弹层「导入到 SillyTavern」**：打开弹层自动探测（`cc_stProbe`，60s 缓存，可手动重探）；在线后一键导入（`cc_stImport`）。支持改地址、Basic 认证（密码只存本次会话内存）、可选封面。
- **宿主代发请求**（ST 默认 CORS 拒绝浏览器跨域，且 CSRF token 与 session cookie 绑定）：CSRF 会话 → 读已有世界书 → **先导世界书** → 用 ST 返回的**实际书名**重写卡副本 `extensions.world` → **再导 PNG 卡**。
- **书来源**：导出作用域里的组共享书优先，没有则用卡内 `character_book`（书名缺省 `<卡名>'s Lorebook`）；同名书默认跳过（勾选才覆盖），卡永不覆盖已有卡（ST 自动加后缀）；书导入失败即中止、不导卡。
- **分层**：平台差异只在 `lib/compat/adapters/sillytavern.js` 的 `remote` 描述（探测/CSRF/世界书/卡导入的路径与字段名、默认地址、认证）；纯计算在 `lib/compat/remote.js`（地址规范化、multipart、书名决策、错误分类）；宿主只做 IO；客户端按 `cc_listTargets` 里带 `remote` 的目标渲染区块。
- **安全**：仅 http/https、拒绝 URL 内嵌凭据、不跟随重定向、响应体上限 2MB、探测 3s / 导入 30s 超时；本地草稿与角色库一个字节不动。
- **暂不支持**：ST 多用户登录、自签 HTTPS（界面按错误码说明）。

### 修复

- **JPG/WebP 封面导入失败**：此前封面字节被原样塞进 PNG 通道，首字节不是 PNG 签名 → 报「不是合法 PNG」。现在 PNG 直通，JPG/WebP 由 canvas 自动转 PNG（最长边 1024）。
- **错误被误报成「未检测到 SillyTavern」**：宿主把封面错误包成通用 `build-failed`，客户端没有该码的映射、落到兜底文案。现在非 PNG 封面返回 `bad-cover`；`stErrorText()` 补齐 `bad-cover` / `build-failed` / `no-remote`，未知错误兜底为「角色卡导入失败」。

### 测试

- 新增 `tests/st-import.test.mjs`（59 项）：纯函数 + 照 ST 1.19 真实协议写的假 HTTP 服务（CSRF 会话、世界名 = 上传文件名、从导入 PNG 解 `ccv3` 并断言绑定名），覆盖离线 / 401 / 403 / CSRF / 同名跳过 / 覆盖 / 书失败不导卡 / 库卡 `cardId` / 无书 / 封面。
- 全量 28 个文件、1217 项全绿。

### 生效方式

**宿主 + 客户端都有改动：重启 `dsh web`，再刷新页面。**

## 0.14.2

**库卡模式的共享书按那张卡自己的分组取。** 0.14.1 解绑后，从卡片打开的弹层仍读「工坊当前分组」的书，卡属于别的组时显示错书、绑定也写错。

- 新增 `exportScope()`：库卡按 `meta.groupId`、草稿按当前分组；共享书块、共享书导出、`exportJSON` 的 `groupId`、`exportWorldName()` 全部走它。
- 目标组不同则 `openExport()` 顺带 `cc_getBook` 拉取（按目标 id 丢弃晚到响应），显示 loading 与组名徽章；卡无分组则不显示书、不写绑定。
- **只改客户端：刷新页面。**

## 0.14.1

**导出与「载入」解绑：点哪张卡就导哪张。** 此前卡片上的「导出」导出的是工坊当前草稿，并提示「先载入」。

- 宿主三个卡导出端点新增 `cardId`（按 id 读库、深拷贝后 `normalizeDraft`，不传仍导出草稿；不存在回 `card-not-found`，不静默降级），新增 `exportDraftFor()` 收口两条来源。
- 客户端新增 `exportTarget` 与 `store.exportLibraryCard()`（只读 `cc_getLibraryEntry`）；弹层按目标显示（库卡用卡名、隐藏草稿校验项）。
- **重启 dsh + 刷新页面。**

## 0.14.0

**导出改成独立弹层。** 原先中栏是「校验与导出」整页，滑正文就会撞见一排下载按钮，离开后校验清单也消失。

- 左下角「校验导出」、总览页按钮、卡片「导出」三处入口统一打开 `exportDialog()`（`exportOpen` 在 store，`openExport()` / `closeExport()`，不改 `cur`）；遮罩 + 面板 + ✕ + 点遮罩关闭。
- `cur=3` 只留热更新残留兜底（归一到总览并开弹层）。
- **只改客户端：刷新页面。**

## 0.13.0

**把 CCv3 规范核心与 SillyTavern 兼容层拆成「核心 + 目标适配层」。** 此前 ST 兼容逻辑散在 `index.js`（PNG/CHARX/升级）、`client.js`（世界书转换与 JSON 拼装）、`agent.js`（装饰器与体检）三处，每加一个平台都要在三处找分支。

- 新增 `lib/compat/`：`core.js`（V2/V1 升级、装饰器解析/校验、V2 投影、PNG/CHARX、`lorebook_v3`）+ `adapters/sillytavern.js`（双块 PNG、`{entries}` 世界书、装饰器→ST 字段、绑定、能力审计）+ `adapters/ccv3.js` + `registry.js`（`getTarget` / `listTargets` / `renderCard` / `renderBook`）。
- 宿主新增 `cc_exportJson` / `cc_exportBook` / `cc_listTargets`，PNG/CHARX 导出接 `target`（默认 ST）；客户端删掉自带 ST 转换，改走 RPC。
- 顺带修：autoLorebook 不再写 `@@activate 100`、写入时校验装饰器值域、导出副本写 `extensions.position/depth/role`、共享书补齐 `@@role` 等映射、CRLF 归一，并对 ST 不支持的 `use_regex` / `priority` 显式告警。
- **重启 dsh + 刷新页面。**

## 0.12.4

**0.12.3 只修对了判定层，胶囊仍不消失。** 真实 GUI 取证定位到渲染层订阅时序：`store.isCcMode` 已为 false，胶囊组件却停在首帧旧快照。

- `useStoreSnapshot()` 优先 `useSyncExternalStore`（订阅后会复查快照），老 React 退回 `useState + 订阅`；且必须放在 `useCcPreset` 之前（effect 顺序会丢「切会话清状态」那次 emit）。`Capsule` 渲染条件要求结论归属本会话。
- **只改客户端：刷新页面。**

## 0.12.3

**CC 模式判定重写为「带会话归属的三态状态机」。** 切换会话后胶囊不消失、要再切一次才消失。

- `ccPresetOfValue()` 区分「未知 / 确定没有 / 有值」，未知时绝不沿用上一会话结论、必须问主机；`setSessionId` 在 id 变化时清空归属；写入口只有 `applyCcVerdict`（会话域）与 `applyChromeCc`（根域）。
- **只改客户端：刷新页面。**

## 0.12.2

**品牌视觉：新增插件图标 `icon.svg` 与 README logo。** 设置页「已安装插件」里此前显示宿主默认图标。

- `package.json.icon` 指向新图标；README 中英加 logo。**刷新页面生效。**

## 0.12.1

**dsh `0.2.2-rc.1` 必须适配：CC 模式原本会整份 broken。** 上游 `dsh-tool-subagent-control` 删掉 `./list-agents` 子入口（并入主模块），预设里留着该行 → `auditRows` 判 failed → `record.broken`。

- 预设删掉该行；`dsh-tool-subagent` 的 `modelSelectionSettings` 拆成 `modelSelection` + `modelDiscovery`（两代双写）；兼容矩阵补 `0.2.2-rc.1`。
- **重启 dsh。** 隔离实例 E2E 全绿、客户端 DOM 实测通过。

## 0.12.0

**破坏性：兼容下限抬到 dsh `0.2.0-rc.2`，0.1.x 整条线不再支持。** 插件此前的两代预设投递（随包声明行 + 挂载时写 `.agent-presets/`）只为 0.1.5 / 0.1.6 存在，却要维护两份清单与一整套安装子系统。

- 删 `presets/cc/`（旧目录模板）与宿主半安装子系统（`installCcPreset` / `planPresetInstall` / `supportsDeclaredPresets` / 安装记录侧车 / 两个开关）；`presets/cc.patch.yml` 成为唯一载体，`apply()` 零写盘。
- `package.json`：`dsh.compatibility.dsh` → `>=0.2.0-rc.2`，`dshReleases` 删 0.1.x 条目；测试收敛并新增两道防回流源码守卫。
- **行为变化**：0.1.x 上装新版后 CC 模式会从 roster 消失；老机器残留的 `.agent-presets/cc` 不读不写不删，可手动删除。
- **重启 dsh。**
