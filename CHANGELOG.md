# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。README 只保留最近几条，完整历史在本文件。

## 0.3.0

从 0.2 到 0.3：**移除「点子」页**（工坊改为 4 页）、**补齐全量中英双语**（此前切到 English 仍显示中文）、**CC 预设改为自动安装**（不再需要手工拷贝），并修掉若干会**静默改写卡数据**的问题（多段问候语被拆条、空数组被写成 `[""]`、大框「取消」实际仍在落盘）。

本次共 4 个测试文件、151 项断言。

### 升级注意（行为变更）

- **工坊导航由 5 页变为 4 页**：「点子」（本地草稿搜索）页被移除，原搜索能力由右侧「已存角色」侧栏承担；`⛶ 大框` 改为落到所有长文本字段，问候语数组则改为逐条编辑。
- **CC 预设改为自动安装**：插件挂载时写入 `<DSH_HOME>/.agent-presets/cc`。**你既有的目录不会被覆盖**——若内容与插件模板不一致且无插件安装记录，会保留原样并打印一条 `[dsh-cc-studio]` 告警（详见下方「变更」里的更新策略与开关）。想交回插件管理，删掉该目录后重启 `dsh web` 即可。
- **问候语字段的编辑方式变了**（`alternate_greetings` / `group_only_greetings`）：由「每行一条」的多行文本框改为**一条一个编辑框**，并新增增删按钮。**导出的数据结构不变**（仍是 CCv3 的 `string[]`），无迁移成本。
- **删除两个从未可用的 RPC**：`expandIdea` / `expandWorld`（宿主侧实现早在 `67172fd` 就随示例数据删除，调用必然返回 `unknown-endpoint`）。相关能力由 CC 预设的 `cc_patch_world` / `cc_patch_character` 承担。
- **移除胶囊上的 `×`（隐藏）按钮**：它早已失效（CC 模式下胶囊无条件渲染，点击无任何变化）。
- **中文界面有一处可见变化**：胶囊尾部计数由 `0 entries` 变为 `0 lore`（三处 lore 计数统一走词表）。其余中文文案逐字未变。
- 生效方式：客户端改动**刷新页面**即可；预设自动安装与宿主改动需**重启 `dsh web`**。

### 变更

- **CC 预设改为自动安装（不再需要手工拷贝）**：此前 README 要求把 `presets/cc` 手工拷到 `<DSH_HOME>/.agent-presets/cc`。现在插件挂载时自动完成，装完插件启动 `dsh web` 即可选到 `CC 模式`。
  - 缘起：有用户反馈「装完插件预设就已经在了」，但当时**并非自动**——dsh 的预设发现只扫三个根（**shipped 根**（`dsh-agent-presets` 包内）+ 部署 **`config.roots`** + **用户根 `<DSH_HOME>/.agent-presets`**，见 `dsh-agent-presets/lib/index.js:1300-1310`），插件包内的 `presets/` 不在其中（`dsh plugin` CLI 也完全不碰预设）；那种「已经在」多是此前手工拷过，或看到插件包内确实带着 `presets/` 而误判。现在改成真自动，反馈里的预期成立。
  - **绝不静默覆盖用户改动**：目标缺失→写模板；与模板一致→不动；与插件上次写入的内容一致（用户没改过）→升级时安全更新；用户改过或无安装记录的历史手工拷贝→**保留并告警**。判定依据是预设目录里的 `.dsh-cc-studio-preset.json`（记版本与各受管文件写入时的 sha256），因此不依赖版本号比较。记录只声明「插件拥有的」内容，被跳过的用户文件不记哈希（否则下一轮会误判成「插件写的、用户没改」而覆盖用户内容）；且**当全部受管文件都属于用户时完全不写记录**，不在用户自己管理的目录里留任何痕迹。以上两条不变量都有测试钉住。
  - 开关：环境变量 `DSH_CC_STUDIO_PRESET_INSTALL` = `auto`（默认）/ `force`（连用户改动一起覆盖）/ `off`（完全关闭）；也可在插件行声明 `config.presetInstall`，优先级高于环境变量。另：自动安装**不注册任何删除动作**，卸载插件不会删除已安装的预设。
  - 卸载/删除插件仍然不会删除 `<DSH_HOME>/.agent-presets/cc/`。
- 左侧导航与顶部步骤条去掉 `1. 点子`（本地草稿搜索页），余下依次为 **1. 5维世界观 / 2. 角色细化 / 3. 世界书 / 4. 校验导出**；打开工坊默认落在 5 维世界观，世界观页的「下一步 → 角色细化」同步指向新索引。
- 该页的搜索能力没有丢：右侧「已存角色」侧栏自带搜索框，仍按名称/标签/lore 数过滤。
- 原挂在该页的 `⛶ 大框` 编辑能力改由统一的 `fieldHead()` 提供，落到**所有长文本 string 字段**上（新增 `post_history_instructions` 此前没有大框）；问候语数组字段另由 `greetingList()` 逐条编辑（见「修复」）。
- 清理只被该页使用的词表项：`step.idea` / `step.idea.desc` / `workshop.search.*` / `workshop.char.title`；`settings.status.hint`、`workshop.library.empty` 不再提「点子」。
- **移除胶囊上的 `×`（隐藏）按钮**：它已完全失效——胶囊的渲染条件是 `if(!s.isCcMode && !s.triggered && !s.panelOpen) return null`，而 CC 模式下 `isCcMode` 恒为真，点 `×` 只把 `triggered` 置回 false，胶囊照旧显示，**画面毫无变化**。随按钮一并删除其唯一的调用点 `store.dismiss()`，以及为它准备却**从未被引用**的词条 `capsule.hide` / `capsule.hideTitle`（原按钮当时写的是 `"×"` 与中文 title 字面量，没走词表）。
- **清掉 `triggered` 状态与 `trigger()`**：`trigger()` 只有定义和导出、**全仓无任何调用点**（已 grep 三个 lib 文件与 `presets/`）。而 `triggered` 在删掉 `dismiss()` 之后，唯一写入者就是 `setIsCcMode`，且写值恒等于 `isCcMode`——即 `triggered === isCcMode` 是不变量。因此渲染条件里的 `!s.triggered` 是冗余项，简化为 `if(!s.isCcMode && !s.panelOpen) return null;`。删除前已用状态机穷举对照：**16 个可达状态的渲染判定完全一致**；唯一不同的是 `triggered=true / isCcMode=false / panelOpen=false` 这个**只能由已死的 `trigger()` 造出**的状态，故对真实行为零影响。`triggered` 只是内存中的 UI 状态，不入 localStorage、不入草稿落盘，无兼容性问题。
- **修胶囊文案的中英不一致**：折叠提示此前硬编码 `"— 已展开"` / `"— 点击展开"`，切到 English 仍是中文；而 `capsule.expanded` / `capsule.collapseHint` 的中英词条其实早已存在，只是从未被调用。现改为 `t("capsule.expanded")` / `t("capsule.collapseHint")`，中文显示与原先逐字一致（"— 已展开" / "— 点击展开"），英文变为 "— expanded" / "— Click to expand"。
- **首次切到 CC 模式时胶囊不出现（要刷新页面或切换会话才出现）**：根因是**探测读错了字段**。会话的预设实际位于 `session.projectionValues.agentPreset`（dsh 官方 UI 亦如此读取，见 `dsh-client-ui-agent-preset/lib/client.js:191,1374`），而旧代码读的是 `sess.preset || sess.presetId || sess.agentPreset || sess.mode` —— 这四个**全都不存在**。于是 `presetOfCurrent` 恒为 `null`，而探测 effect 的依赖是 `[currentId, presetOfCurrent]`：切换模式既不改变 `currentId`，也不改变一个恒为 `null` 的值，**effect 永不重跑**；只有刷新页面（重新挂载）或切换会话（`currentId` 变）才会重新探测——与报告的现象完全吻合。
  - 修法：抽出共用 hook `useCcPreset()`（此前 Capsule 与 Workshop **各写了一份重复实现**，现已合并，杜绝再次漂移），判定优先级为 ① 会话投影 → ② 预设芯片 DOM → ③ 主机 RPC。
  - 旧 DOM 兜底只扫 `button`，而**运行中会话的预设标签渲染成 `<span>`**，对运行中会话完全失效；现改用精确选择器 `button[aria-haspopup="menu"]`（预设芯片是唯一满足该条件的下拉触发器，见 dsh 源码 `AgentPresetSeat`），既修好运行中会话，又避免「下拉菜单展开时把菜单项里的预设名误判成已选中 CC」的假阳性。
  - 补上**新会话页**的探测：芯片是「为下一次会话选择」，此时还没有 session、store 里查不到，故新增 1s 本地轮询捕获芯片切换（纯 DOM 文本扫描，不打 RPC；判定不变时 `setIsCcMode` 内部不触发重渲染）。选择 CC 模式后胶囊**立即出现**，并在首次对话创建会话后无缝衔接。
  - 修掉旧「补偿重试」失效问题：它调用 `checkIsCcMode(currentId)` 走 5s 节流，主机侧 `composedPreset` 未就绪时的补救重试会被节流直接吞掉；现显式传 `force` 绕过，并在 1.2s / 3s 各重试一次。
  - 新增 `decideCcMode()` 纯决策函数：**投影未知时不发假结论**（返回「未知」而非 `false`），避免「选 CC → 首次对话」瞬间的胶囊闪烁。
- 新增 `tests/cc-detection.test.mjs`（32 项）：直接执行源码中的真实实现，覆盖「必须从 `projectionValues.agentPreset` 读到预设」（即上述 bug）、DOM 探测器对不可见元素/自身 UI/模型选择器（含 `(CC)`）的不误判、`decideCcMode` 判定表（含未知态），以及源码级守卫（两份重复实现与错误字段不得回流、DOM 必须用精确选择器、重试必须带 `force`、必须有轮询兜底、预设名必须走词表）。
- **lore 计数统一走词表**：胶囊正文的 `loreCount+" lore"`、胶囊尾部的 `loreCount+" entries"`、以及已存角色侧栏徽标的 `entry.loreCount+" lore"` 三处硬编码拼接，均改为 `t("common.loreCount").replace("{n}", …)`（沿用仓库既有的 `replace("{n}")` 插值模式，locale 的 `t()` 本身不做插值）。取值为 `"{n} lore"` 且中英同值，因此**中文界面的观感变化仅是胶囊尾部由「0 entries」变成「0 lore」**，其余两处输出逐字不变；这样做的收益是三处计数不再各写各的字面量，将来改词表即全局生效。
- 顺带修正 README 里两处与现状不符的描述：「风格标签自定义」（该芯片 UI 自 0.2.14 起已不在界面中）与「`1. 点子` 现为本地草稿搜索」。
- **完成全量 i18n 接线（工作坊此前切到 English 仍显示中文）**：词表其实早就建好了（`capsule.*` / `panel.*` / `step.*` / `action.*` / `settings.*` / `workshop.*` / `common.*`），但**大量调用点直接硬编码中文**，那些词条从未被引用（改造前 132 个键里只有 65 个真正被调用）。本次把 UI 层与 store 层的**全部 122 条中文字面量**接入词表：store 状态与错误文案（导入/导出/PNG/CHARX/保存/载入/删除/重命名/回滚）、问候语逐条编辑器、世界观与角色细化字段标签、世界书、导出页、已存角色侧栏、两个大框标题与字数提示、`window.confirm` / `window.prompt`，以及 `addEntry()` 建新条目的默认名/关键词/内容。词表增至 **203 键**（zh/en 严格一致、无重复、占位符一致）。
  - **中文界面逐字未变**：新增测试会拿真实词表跑 `{n}` 等插值，把结果与改造前的硬编码拼接逐条比对，确保不是「翻译对了但中文变样了」。
  - **CCv3 字段名保持英文**（`name` / `description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions` / `first_mes` / `creation_date` 等）：它们是规范里的字段标识，两种语言下都该是英文；带中文提示的（如 `nickname（{{char}} 用）`、`tags（逗号分隔）`）才进词表。
  - `t()` 原生支持 `{name}` 插值（`locale.translate` 用 `params` 替换），且语言切换会换发新的 `t` 引用以触发重渲染；store 层原本没有 `t`，现通过 `ctx.locale.bind(NS)` 取得（该绑定在**调用时**读当前语言，故随语言切换生效），并在 locale 缺失时回退到内置词表。
  - 新增守卫式测试：**UI 层不得再出现任何中文字面量**（词表区域与注释除外），使「新写的中文必须进词表」成为硬约束。

### 修复

- **数组字段往返会改写数据**（本次改动引入的回退）：`fieldHead()` 用 `(raw||[]).join('\n')` 配 `String(v).split('\n')` 做「每行一条」互转，而 `''.split('\n')` 得到 `['']`，于是**空数组往返一趟变成 1 个空问候语**——「打开 `alternate_greetings` / `group_only_greetings` 的大框 → 直接点完成」这种零输入操作就会静默改写卡数据（导出多出空白问候语）；`['a\n']` 也会 1 条变 2 条。该「每行一条」编码随后被**整体移除**（见下一条），空数组不再经过任何字符往返。
- **多段问候语被静默拆条**（根因修复）：上一条只堵住了空数组，而根因是**「一条问候语」与「一行文本」被当成同一个东西**。`alternate_greetings` / `group_only_greetings` 的元素本来就是可含换行的多段文本，序列化后元素内部的换行会被拆开——导入带多段问候语的卡后，在行内 textarea 里**敲一个字**就会把 1 条拆成 N 条，而且**能通过宿主校验静默导出**（`validateCard` 只检查 `Array.isArray`，实测 `group_only_greetings:[""]` 也返回 `valid=true`）。现在这两个字段改为 `greetingList()` **逐条独立编辑**：一条 = 一个 textarea，元素内部换行原样保留，**不再有任何 join/split 序列化**（`arrayToLines` / `linesToArray` 连同「每行一条」的语义一并删除），因此保真不依赖编码技巧。顺带补上了此前完全缺失的能力——**增删问候语**（原先只能靠加减行，UI 里没有任何增删按钮）。
- **问候语 10 条上限对齐**：宿主两处会截断到 10（`agent.js` 的 `cc_patch_greetings`、`index.js` 的 `cc_patchDraft`），而客户端此前无上限，于是 UI 可以造出随后被 LLM patch 静默砍掉的数据。现在 `GREETING_MAX=10`，达到上限即禁用「＋ 新增一条」并显示计数，测试会跨文件核对宿主截断点与 UI 上限一致。
- **大框「取消」与「完成」是同一个动作**：大框输入即同步（每次击键都 `updateDraft`），原先「取消」也走 `clearEditingText()`，等于照样落盘。现在 `editingText` 携带打开时的快照与 `revert` 闭包，「取消」真正回滚；长文本与世界观两个大框都提供 `cancelEditingText()` / `cancelEditingWorld()`。
- **无改动的写入不再刷新修改时间**：`updateDraft()` 在变更后内容与当前一致时直接返回，不再改 `modification_date`、不再推宿主（此前「打开大框 → 取消」这类空操作也会触发一次宿主写入）。
- **清掉自 67172fd 起就调不通的死代码**：客户端 `expandIdea` / `expandWorld` 两个 RPC 的宿主侧实现（mock）在那次提交随示例数据一并删除，宿主 `dispatch` 无此 endpoint（会返回 `unknown-endpoint`），客户端调用自那时起必然失败；这两个能力现由 CC 预设的 `cc_patch_world` / `cc_patch_character` 工具承担，故移除客户端死代码，连同只服务原「点子」页的 `state.idea` / `state.tags`、`setIdea` / `setCustomTag` / `addCustomTag` / `removeTag` / `toggleTag` 与 `S.chipOn`。这些 RPC 名称从未成功过，无兼容性影响。
- 新增 `tests/preset-install.test.mjs`（34 项）：锁住自动安装的安全规则（缺失→写、一致→不动、我方内容→安全更新、用户改动/无记录的手工拷贝→跳过保留且不留痕迹）、幂等性、`off` 不碰磁盘、`force` 覆盖、环境变量与 config 的优先级、标记文件不得声明被跳过的用户文件、`apply()` 会真正触发安装且不改变既有返回值契约。同时修掉一个副作用隐患：`tests/rpc-channel.test.mjs` 原先只隔离了 `HOME`，而 `DSH_HOME` 优先于 `homedir()`——不隔离会让 `apply()` 写进**真实的**用户预设目录（现已一并隔离，并在每次跑测试后校验真实目录确实未被改动）。
- 新增 `tests/client-greetings.test.mjs`（62 项）：锁住问候语保真不变量（多段问候语编辑后长度不变、内部换行保留，并与旧 `join/split` 编码做对照证明回归有效）、数组访问器纯函数且越界 no-op、增删与 10 条上限、宿主截断点与 `GREETING_MAX` 跨文件一致、`arrayToLines`/`linesToArray` 与「每行一条」已彻底消失、已删死代码（含 `dismiss` / `trigger` / `triggered`）不得回流、`store.*` 调用点与导出/声明一致、两个「取消」按钮及逐条大框都必须绑定回滚 handler、胶囊文案与 lore 计数必须走词表且中文取值不变；以及全量 i18n 守卫（UI 层无硬编码中文、zh/en 键集与占位符一致、`t()` 引用的键都存在、中文插值输出与改造前逐字一致）。`pnpm test` 现在四个测试文件都跑（23 + 34 + 32 + 62 = 151 项）。

### 说明

- 多段问候语被拆条的问题已随根因修复消除，不再需要 `---` 之类的替代编码或手工改 JSON：保真是结构性的（一条 = 一个编辑框），不依赖任何分隔约定。右侧预览面板仍 `JSON.stringify` 整个草稿，需要核对真值时可直接看。
- 仍未提供的是**问候语排序/拖拽**（重排需删除后重新新增）。`alternate_greetings` 由读取方随机选取，顺序影响很小，故本次未做；导出顺序即数组顺序。

### 文档

- README「重启与验证」里的两条自检命令此前都跑不通，现已改为可逐字复制的形式（中英双语，另附 Windows PowerShell 等价写法），并已实测：
  - **客户端资源那条 URL 形式就是错的**：真实地址是 `/plugins/??<包名>/client.js&rev=<内容哈希>`，缺 `??` 或缺 `rev` 都会 404（实测无 `rev` → 404、`rev` 写错 → 404），且 `rev` 每次改 `lib/client.js` 都会变，因此改为带 cookie 从首页里取真实 URL 再请求。原先那条按文档照抄必然 404。
  - **RPC 自检的 cookie 名也是错的**：文档写 `dsh-auth-127.0.0.1:3080`，而真实名字是 `dsh-auth-` + base64url(sha256(权威段))（本机为 `dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw`）；按文档照抄会 401（实测：错误名 401 / 正确名 200）。现改为用 `dsh web` 启动时打印的 token 直接换取 cookie，不再要求用户手工拼名字。
- 顺带在文档里写清三件事：`/`（首页）与 RPC 受会话 cookie 保护而不带 cookie 返回 `401 dsh web authentication required`；**插件资源 `/plugins/??…&rev=…` 本身不走鉴权**，所以缺 `??`/`rev` 表现为 404 而非鉴权失败（别把 404 误判成没装上）；`rev` 是内容哈希、随 `lib/client.js` 变化。

## 0.2.22

适配 dsh `0.1.5-rc.1` 启动崩溃。

### 修复

- **启动崩溃 `cannot get property "webServer" without inject`**：该 dsh 版本起 `connection.rpc.handle()` 对外部插件不可用——`HostConnectionService.rpc` 用的是 connection 插件自己的 ctx，其 `inject` 仅为 `["credentials"]`，`webServer` 位于它的内层 `ctx.inject(["webServer"])` 作用域，owner fiber 永远解析不到。host 半改为在 `webServer` 上自注册 `/dsh-cc-studio-rpc` 前缀路由，并实现同一套 connection RPC 线上协议（含 `connection.requestRejection` 围栏 + `server-response` envelope）。
- **请求体读取**：由 `for await` 改为 `data / end / error` 事件式（该运行时下异步迭代 `IncomingMessage` 会抛错，连 `client-connection` 自带 `/api` 帧也受影响）。
- **`presets/cc` persona 行**：`text` → 必填 `prefix`，否则切换 CC 模式报 `invalid config: S.prefix missing required value`。

### 新增

- `tests/rpc-channel.test.mjs`：host 半 RPC 通道回归（假 ctx + 真实 http），23 项断言，`pnpm test` 或 `node tests/rpc-channel.test.mjs`。

## 0.2.21

修复 #2 草稿静默丢失。

- 草稿变更即落盘 `~/.dsh/cc-drafts/<会话>.json`，host 重启/换会话后按会话 id 自动恢复（`creation_date` 不变）。
- 内存 miss 不再静默建空：无存档建空会警告（工具 `notice`/`message` + 工坊橙色条），恢复成功会提示（蓝色条，展示 `creation_date`），下次写入后提示消失。

## 0.2.20

修复 `cc_isCcMode` 刷屏。

- 胶囊/工坊改用 `current + preset` 窄订阅（流式更新不再重跑 effect）。
- `checkIsCcMode` 同会话 5s 节流 + in-flight 去重；本地已判 CC 不再打 RPC，工坊只做兜底。

## 0.2.19

跟随全局语言。

- 移除设置页内 `语言 / Language` 手动切换卡，插件只跟随 `设置 → 通用 → 语言`（`locale: dshCcStudio` + `t` 自动重绘）。
- CC 预设保持纯中文（用户预设不走系统翻译，双语版显累赘已还原）。

## 0.2.18

中英双语。

- `zh / en` 全量词表 + 设置页 `语言 / Language` 手动切换（`locale.setLocale`，与全局语言联动，胶囊/步骤/设置即时中英切换），`settings.section` 标题亦随语言变化。
- 修复工坊未翻译文案与 loader 的 `t is not defined` 崩溃。

## 0.2.17

容器互通。

- `JSON / PNG(tEXt ccv3) / CHARX(ZIP)` 导入导出打通。
- `⬆ 写入 PNG` 支持将当前卡写入用户上传的任意 PNG（剥离旧 `ccv3/chara` 块，`CRC32` 重算，`STORE&DEFLATE` ZIP 兼容）。
- 校验页 `⬇ JSON / ⬇ PNG / ⬆ 写入 PNG / ⬇ CHARX` 四键。

## 0.2.16

导入与可调心跳。

- 侧边栏 `⬆ 导入本地 JSON(CCv3)`、导入后自动校验/自动保存开关。
- CC 心跳间隔 1–30s 可调（0 关闭，`localStorage:dsh-cc-studio-settings`）。
- 修复 `{{char}}` 变量误用导致的 `unknown prompt variable`，`presets/cc` 同步修复。

## 0.2.15

修复首切 CC 不显示。

- `conversation.input.dock` 会话域 + `shell.overlay` 根域按 `[currentId,sessions]` 订阅与 900ms 重试。
- `cc_getDraft` 轮询收敛为 CC 模式下 4s/1s 基座 + 500ms 去重，关闭即停。

## 0.2.14

移除「点子投喂」卡片。

- `1. 点子` 现仅保留**本地草稿搜索**（`一句话点子/风格标签` 输入已移除，标签改在「角色细化」中逗号分隔编辑），界面更简洁。

## 0.2.13

合并版本。

- 全量长文本大框（所有 textarea ⛶ 720px 大框）。
- 点子步本地搜索（紫框过滤已存侧栏）。
- 设置页修复（`settings.section` 补 `locale`）。

## 0.2.12

点子步改为本地搜索。

- 紫框不再是点子输入/标签候选，直接过滤右侧已存侧栏（输入/芯片一键筛，实时预览前 3 条，「载入」直达），与侧栏搜索双向同步。

## 0.2.11

全量长文本大框编辑 + 设置页修复。

- `一句话点子 / description / personality / scenario / system_prompt / first_mes 等` 所有长文本新增右上 `⛶ 大框` 按钮。
- `settings.section` 漏 `locale: NS` 修复，已存数/落盘 `~/.dsh/cc-library` 展示。

## 0.2.10

世界观大框编辑。

- 每维预览 140 字 + 字数，卡片点击/「⛶ 编辑」弹出 720px 大框（320px 高，实时同步草稿），解决长文在 70px 小框内难编辑/预览问题。

## 0.2.9

模型侧暴露已存库 CRUD。

- `cc_list/save/load/delete/rename/get_library` 6 Tools（与工坊侧栏共享 ID），支持「帮我更新/载入 ID xxxx」自然语言持久化。

## 0.2.8

已存角色 ID 化 CRUD。

- 载入后再次保存按唯一 `ID` 原地覆盖（无需删旧再存），`＋ 另存为新` / `✎ 重命名` / `＋ 新建`，高亮当前卡与 `ID:xxxx` 显示。

## 0.2.7

修复 #1：`cc_patch_world(autoLorebook=true)` 重复追加导致过期条目堆积。

- 覆盖旧自动条目、保留手动条目，新增 `cc_delete/update_lorebook_entries` 管理能力。

## 0.2.6

共创约束。

- 每步先与用户讨论（Tool 描述 + persona 强制「先问再填」），修复「LLM 自行推断填满」问题。

## 0.2.5

修复工坊五维回显丢失（`draft.extensions.cc_world ↔ state.world` 双向同步）。

## 0.2.4

深浅色自适应，深色下修复品牌按钮白底刺眼。

## 0.2.3

workflow + UI 细节（maxWidth/boxSizing、40px 折叠栏、6 步强制校验）。

## 0.2.2

已存角色侧栏（280px 可折叠 / 落盘 `~/.dsh/cc-library`）。
