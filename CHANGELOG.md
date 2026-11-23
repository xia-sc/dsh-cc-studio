# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。**只保留 0.12.0 起的版本**；0.11.x 及更早见 git 历史。

格式：最新版本按「新增 / 修复」写；更早的小节按现象 → 根因 → 修法 → 生效方式。

## 0.28.2

**设置面板搬到插件详情页；详情页改用一张简洁特性图。**

### 变更

- **设置入口搬家**：原来注册在 `settings.section` 的「角色卡工坊」页（诊断日志等级 / 草稿轮询 / 自动校验 / 导入自动保存 / LLM 创作保护）改挂 `plugins.bundle.config`，key 为包名 —— 插件详情页在描述与行之间渲染它，「设置」导航里不再单列一页。设置值仍存 `localStorage`，升级不丢。
- **详情页更简洁**：`locale/zh.json` / `locale/en.json` 增加 `meta.detail`，指向 `docs/DETAIL.zh.md` / `docs/DETAIL.md`（各一行特性图 + 替代文本）；`package.json` 的 `files` 补 `docs`。插件详情页不再回退整份 README。

### 生效方式

**客户端与 locale 改了：重启 dsh + 刷新页面**（只改客户端时可只刷新页面；locale 与 detail 文档由插件管理器读取，重启后最稳）。

## 0.28.1

**兼容矩阵补 dsh 0.2.3-alpha.2（桌面版当前版本）：实测通过，运行时代码零改动。**

### 说明

- 升级影响分析：`0.2.2-rc.3 → 0.2.3-alpha.2` 之间共 42 条破坏性条目，逐条对插件表面求交集后只命中两条 —— alpha.1 抬高的 Node 下限（24.22.3 / 26.13.1）与 rc.3 起生效的 Loader/YAML 校验；前者由桌面版内置 Node 恰好满足，后者在 rc.3 审计中已通过。
- 隔离实测：运行时三个客户端挂载点（`conversation.input.dock` / `shell.overlay` / `settings.section`）均为 `active`；L2 组合 dump 顶层 23 行 + 组内 9 行，与 rc.1 快照逐字节一致；L3 全链路（启动 / token / boot / 客户端资源与 rev 契约 / RPC / 草稿 / 导出 / 日志 / 落库 / `originFingerprint`）0 失败。
- 声明只加 `0.2.3-alpha.2`；`engines.dsh` 保持 `>=0.2.2-rc.1`，L2 fixture 仍由 rc.1 生成（锚定下限，不随实测版本漂）。未测版本（`0.2.2-rc.4` / `rc.5`）不进矩阵。

### 生效方式

纯声明与文档改动，无需重启 dsh、无需刷新页面。

## 0.28.0

**新增诊断日志：出问题能留证据，日志可导出、可直接反馈。**

### 新增

- **等级可调**：设置页 → 诊断日志 → `关闭 / 仅错误 / 警告 + 错误 / 信息（默认）/ 调试`。等级同时写客户端 `localStorage` 与宿主 `<DSH_HOME>/cc-logs/settings.json`，两半同一套值。
- **记什么**：每次 RPC 的端点 / 成败 / 错误码 / 耗时（成功记 debug、失败记 warn 或 error —— 所以默认等级下只有「出错」和关键动作会落盘）；草稿同步（会话槽前 8 位、rev、是否有变化）、切会话、载入 / 保存 / 删除库卡（id 前 8 位、条数、`originCleared`）、清空草稿、日志等级变更。
- **不记什么**：**卡名、卡内正文、问候语、世界书内容一律不进日志** —— 脱敏只接受一层标量，长字符串截断到 160 字符并标出原始长度，id 只记前 8 位。所以日志可以直接贴给作者。
- **落盘与滚动**：`<DSH_HOME>/cc-logs/cc-studio.log`；超过 512KB 滚成 `.1`（只留一份旧档），内存里另留最近 800 条。任何 IO 失败都被吞掉 —— 日志不能成为新的故障源。
- **一键反馈**：设置页「⬇ 导出日志」先把客户端队列 flush 给宿主，再让宿主拼一份带版本 / 平台 / 时间头的 `.log` 直接下载；页面隐藏时也会自动 flush（关窗口前那几条往往正是线索）。

### 说明

- 新增 `lib/log.js`（纯函数：等级判定 / 脱敏 / 行格式化 / 滚动判定 / 设置解析）与 `tests/log.test.mjs`（两半等级表逐字一致、脱敏、行格式、接线、隐私守卫）。
- 宿主新增 4 个端点：`cc_log`（客户端上报）、`cc_setLogLevel`、`cc_getLogLevel`、`cc_logDump`；RPC 埋点包在路由层，`cc_log` 自身不记（避免「上报日志」制造日志）。
- 「导出日志」复用已有 `downloadTextExport`，与导出 JSON / 世界书同一条下载路径。

### 生效方式

**宿主与客户端都改了：重启 dsh + 刷新页面。**

## 0.27.3

**通信失败不再静默：失联时界面直接说明，并给孤儿草稿一个出口。**

### 修复

- **「删不净 / 存不上」的真正形态**（用户第三次反馈）：本机实测 `~/.dsh/cc-drafts` 与 `cc-library` 自 11-17 16:32 起**零写入**，而用户界面里那张卡在整台机器上根本不存在（`.dsh` 全目录 UTF-8/UTF-16 都搜不到）—— 界面显示的全是浏览器内存态。也就是说客户端的 RPC 一直在失败，而插件把失败**静默**掉了：库拉不到就显示「还没有已存角色」、写草稿失败界面照常、删除失败只有底部一行小字。
- 修法 ①：`rpc()` 区分「端点回 ok:false」（连得上，这次不行）与「传输失败」（HTTP 非 2xx / 非信封 / 网络异常），后者写进 `store.rpcError`；工坊顶部红色横幅显示端点、错误码与「重试连接」，连上后自动消失。
- 修法 ②：`refreshLibrary` 区分 `libraryLoaded`。读不到角色库时左栏说「读不到角色库，请刷新页面 / 重启 dsh」，**不再冒充空库**（那句话会让用户以为自己把卡删光了）。
- 修法 ③：孤儿草稿（角色库已加载且为空 + 草稿没有来源卡 + 草稿有内容）给一条提示，带「清空草稿」按钮 —— 删除库卡不会删草稿本身，以前这个状态只能靠用户自己猜到点「清空」。
- 修法 ④：`pullDraft` 把「来源 id 不在库里」当成孤儿来源（`currentLibraryId=null`），避免动作栏「删除」拿着一个不存在的 id、点下去必然失败。

### 说明

- 新增 `tests/host-link.test.mjs`：传输失败可见 / 恢复后自动清 / 读不到≠空库 / 孤儿来源 / 重试真的重拉 / 横幅真的渲染。
- 这一版**只改客户端半**：刷新页面即可（横幅本身就是给你确认「有没有连上」用的）。

### 生效方式

**只改客户端半：刷新页面。**

## 0.27.2

**修「最后一张卡删不净」：删除库卡时草稿必须真的清掉（必要时穿过创作锁）。**

### 修复

- 现象（用户截图）：把角色库里的卡删到只剩最后一张并删掉它 → 左侧「已存角色 0」，但工坊中间还挂着刚删的那张（名字都还在），动作栏「删除」因为 `currentLibraryId` 已清而 disabled —— 看起来就是「怎么都删不干净」，只能自己去点「清空」。
- 根因（两条叠加）：① 0.25.1 的清空是「`isReadOnly()` 时只给提示、不硬清」；而 CC 模式里模型每写一次草稿就自动上锁（30 分钟 TTL），删除时几乎总是只读 → `clearDraft()` 直接 return：内存没清、也没有落盘（盘上草稿的 rev 一个都没涨）。② 即使内存清了，那条「清空 → 80ms 后 `pushDraftToHost`」的写盘同样会被 `isReadOnly()` 拦下，于是 4 秒轮询把盘上那张旧卡又画回界面，而来源 id 已经没了 —— 界面与宿主彻底脱节。
- 修法：删除的是「当前载入的卡」**或**宿主回报 `originCleared`（被删的正是草稿的来源卡）时，无条件 `clearDraft(true)`：
  - 强制清内存 + 强制落盘空卡（新增 `pushDraftToHost(force)` → `cc_setDraft` 带 `force:true` 穿过创作锁，否则宿主拒绝、盘上仍是旧卡）；
  - 一并撤掉只读预览与锁状态（卡都删了不该还挂着预览横幅）；
  - 判定不再只信内存的 `currentLibraryId`：刷新页面或只读预览时它是 null，宿主的 `originCleared` 才是可靠信号。
- `store.deletedLocked`（「已删除；当前草稿仍受创作锁保护，释放锁后可清空」）这条「只提示、不解决」的文案随之删除。

### 说明

- 删除是最难挽回的动作，所以按钮侧本来就有二次确认：用户点「确定」= 明确放弃这张卡。宿主覆盖前还会 `backupDraftSync` 留一份备份。
- `tests/delete-current-card.test.mjs` 重写：普通删除 / 创作锁 active / 内存 `currentLibraryId` 没对齐（刷新后）三条路径都断言「内存清空 + 空卡真的落盘 + 带 force:true + 只读状态解除」。把修法退回旧行为时其中 4 条会红。

### 生效方式

**只改客户端半：刷新页面。**

## 0.27.1

**修「重复导入到 SillyTavern 出现两张同名卡」。**

### 修复

- 现象：导入一张卡 → 在 ST 里删除角色 → 删除世界书时 ST 报 `Failed to read image: data/default-user/characters/<角色名>.png ... ENOENT`（它用 fallback 图把同名 PNG 又写了回来）→ 再从插件导入，ST 里出现两张同名卡。
- 根因：ST 的 `POST /api/characters/import` 在不传 `preserved_name` 时用 `getPngName()` 按「文件是否存在」加后缀（`<角色名>1.png`）；插件一直走「另存」路径（有意不覆盖）。当 ST 侧删除角色没清干净、又被 fallback 重建了同名 PNG 时，第二次导入就变成两张同名卡。
- 修法：导入前先 `POST /api/characters/all` 查同名卡。导出区块新增「覆盖 ST 里的同名角色卡（只保留一张）」开关，**默认关**（保持不覆盖用户已有卡）；勾选时把 ST 实际 `avatar` 作为 `preserved_name` 传过去，ST 直接覆盖那一张（底图是本次上传的 PNG，不会再 fallback、不会多一张）。未勾选时返回 `card.existing` 与 `st-card-exists` 警告，界面明确说「已另存为 <角色名>1.png」。
- 生效方式：重启 dsh + 刷新页面。

### 说明

- 插件无法替 ST 清理「删角色后 fallback 重建同名 PNG」的残留，但可以不再静默制造第二张同名卡：查重 → 告知实际文件名 → 需要时显式覆盖。
- 覆盖是破坏性动作，所以默认关；词表文案与 footnote 都写明「只保留一张」。

## 0.27.0

**RPC 传输迁到官方 `/api` 共享通道的 exact Fetch route（架构变更，对外行为不变）。**

### 变更

- 宿主不再用 `ctx.webServer.register({kind:"prefix"})` 自建 `/dsh-cc-studio-rpc`：改为 `ctx.connection.fetch.register({ path:"/api/cc-studio", methods:["POST"], requestBody:"buffered", fetch })`。Host/Origin 围栏、会话 cookie 认证、请求体读取与 `maxRequestBodyBytes` 上限由 Connection 托管；删掉自维护的 `readBoundedBody` / `sendEnvelope` / `requestRejection` / 48MB 上限（约 150 行）。
- 客户端 `rpc()` 从 `ctx.connection.rpc.call(...)` 换成同源 `fetch("/api/cc-studio")`；返回值仍是 result 对象，40+ 调用点零改动。客户端不再依赖 `connection` 服务（`inject` 只剩 `slots` / `locale`）。
- 线协议保持 client-connection 的信封（`client-request` / `server-response` + `rpcId`）；URL 不再编码 endpoint（它进信封）。官方语义带来的三处差异：非 POST 由 Connection 回 404（原 405）、超限回 413（原插件自管 48MB 上限）、401/403 由 Connection 统一回（原 `requestRejection`）。
- 测试：`rpc-channel` 改为直接调用 `route.fetch`（围栏 / 405 / 413 / 路径穿越交给官方契约，不再由插件测试）；其余 17 个客户端/宿主测试改用 `tests/harness.mjs` 新增的 `installClientRpc()`（全局 fetch 打桩）；L3 e2e 的 RPC URL 同步。

### 为什么现在做

- 调查结论：官方源码里 `connection.rpc.handle()` **零消费方**（`packages/` 与 `apps/` 中 13 处实际使用全是 `fetch.register`），`/api` 的 interceptor 又被 `typertGateway` 独占 —— 等它修等于等一条没人走的通道。
- 官方架构笔记明确把「各 owner 在 `/api` 上注册 exact Fetch route」当作插件端点的正规入口；`plugin-manager` / `plugin-market` / `file-upload` / `session-log-export` / `deliverables` / `liveshare` 等都在用。
- 迁移面固定（宿主 1 处注册 + 客户端 1 个函数 + 测试），端点越多自维护协议的税越重，所以趁现在改。若将来 `rpc.handle` 真修好，只需换注册调用与 channel 名 —— 信封与客户端零改动。

### 生效方式

- 重启 dsh + 刷新页面（宿主与客户端同时换）。旧版客户端 + 新版宿主（或反过来）在这个版本上不互通：URL 变了。

## 0.26.1

**兼容矩阵补 dsh `0.2.2-rc.3`（桌面版当前版本）：实测通过，无需改运行时代码。**

### 说明

- 用本机 Desktop `0.2.2-rc.3` 做隔离实测：L2 `--dump-config` 组合成功（顶层 23 行 + 组内 9 行，与 rc.1 快照逐行一致）；L3 全链路通过（启动 / token 换 cookie / boot 清单 / 客户端资源与 rev 契约 / RPC / 草稿写入 / 导出 / 落库 / `originFingerprint`）。
- 另在 rc.3 的安装树里逐个解析 CC 预设用到的包名（28 个，含 `@deepseek-ai/dsh-plugin-manager/tools` / `dsh-plugin-market/tools` 子入口）—— 全部可解析，即 `mountPreset → auditRows` 不会把「CC 模式」判成 broken。
- rc.3 的 `standard` 相对 rc.1 多出 `tool-office`、`tool-subagent-control.interrupt:false` 与 `skill-filesystem.customSkillDirs`。三个都**不加**：`customSkillDirs` 依赖 rc.3 才注入的 `baseUrl`，加上会让下限 rc.1 的组合失败；它们属能力差异，不是漏抄。
- 组合快照仍由 rc.1 生成（锚定下限），rc.3 只作为实测版本进 `dshReleases`。

### 生效方式

- 只改声明与文档，重启 dsh 即可（运行时代码零改动）。

## 0.26.0

**兼容下限抬到 dsh `0.2.2-rc.1`（重要更新，破坏性）：清掉为兼容 0.2.0 / 0.2.1 留的声明层技术债。**

> ⚠️ **重要更新**：0.26.0 起不再支持 dsh `0.2.0` / `0.2.1` 整条线。仍停在这两个版本的安装请先把 dsh 升到 `0.2.2-rc.1` 或更高，再升级本插件；否则预设里的子代理「指定模型」入口会静默消失。

### 变更

- `dsh.compatibility.dsh` → `>=0.2.2-rc.1`；`dshReleases` 只留 `0.2.2-rc.1`（下限）与 `0.2.2-rc.2`。0.2.0 / 0.2.1 整条线不再声明、不再进矩阵（README 的「未实测 / 已弃用」白名单保留它们，便于回溯）。
- 预设删掉 `tool-subagent` 的 `modelSelectionSettings: true` 旧键：0.2.2-rc.1 起该配置只有 `modelSelection` + `modelDiscovery`，旧键在 0.2.2+ 上只是被忽略的未知键 —— 留着会让「这里还有兼容分支」的误读一直存在。只写新键在 0.2.1 及更早会静默失去子代理「指定模型」入口，这正是必须同时抬下限的原因。
- 预设补回 `tool-schedule` 与 `tool-plugin-market`（后者 `disabled: true`）：它们在 rc.1 的内置 `standard` 里都有，此前因下限是 0.2.0-rc.2（依赖树没有这两个包）刻意缺席。现在与 rc.1 的 `standard` 逐行对齐，行差只剩 persona 文本、`tool-plugin-manager` 固定 disabled、末尾 `cc-agent` 三处；CC 模式因此多一个定时任务工具（宿主没挂 schedule 服务时该插件自行 inert）。
- L2 组合快照改由 dsh `0.2.2-rc.1` 重新生成（`tests/fixtures/preset-composition.json` 的 `dshVersion` 与行集都变了）。
- 测试同步：旧键断言改成「禁止回流」；行集快照加两行并断言 `tool-plugin-market` 是 disabled；README 版本守卫的「未实测」白名单扩成「未实测 / 已弃用」并收录 0.2.0 / 0.2.1 各版本；下限守卫改成 `>=0.2.2-rc.1` 且不得残留 0.2.0 / 0.2.1 条目。

### 说明

- 这是破坏性变更（旧版本不再被声明），所以版本号走 `0.26.0`，不是 `0.25.5`。
- 运行时代码零逻辑改动：为 0.2.0 / 0.2.1 写的分支在 0.12.0 抬到 0.2.0-rc.2 时已经清完，这次清理的全是声明、测试与文档。
- 明确不动的历史兼容（与 dsh 版本无关）：`dataRoots()` 的旧根回退、`bookTargets()` 内置目标兜底、`dsh-cc-studio-legacy-notice`，以及自建 `/dsh-cc-studio-rpc` 前缀路由（`connection.rpc.handle` 的 `this.ctx` 所有权问题在 0.2.2-rc.1 依旧存在）。

### 生效方式

- 重启 dsh（预设与宿主组合都在启动时读取）。仍停在 0.2.1 及更早的安装请先升级 dsh 再升级本插件。

## 0.25.4

**再修误报：新建会话 / 刷新页面后第一次切角色，必弹「当前角色卡还没保存到角色库」。**

### 修复

- **新建会话 → 切 CC 模式 → 打开角色卡工坊 → 切换角色：100% 弹确认框**（用户反馈）。根因是「已保存」基线 `savedFingerprint` 只活在页面内存里：它只在**本次页面里载入过或保存过**时才有值。刷新页面、或者换到另一个会话之后它永远是空的，而从宿主拉回来的草稿是有内容的、还带着来源卡 id —— 于是 `draftIsUnsaved()` 判「有内容 + 有来源 + 基线为空 = 未保存」，任何一次切卡都命中。
- 修法：让宿主提供**权威基线**。`cc_getDraft` 新增 `originFingerprint`（该草稿来源库卡的**内容指纹**，4 秒 TTL 缓存；保存 / 删除 / 改名时立即失效），客户端的未保存判定改成「本地基线优先，没有就用宿主这份」。
- 顺带修掉一个同源的隐患：两半算指纹的算法本来不一致（客户端 `JSON.stringify` 整份卡，宿主 `cardFingerprint` 只看 `data`）。库卡文件与草稿槽是**两次独立写入**，字段顺序不保证一样，同一份卡会算出两个指纹。现在两半统一用 `stableJson`（递归按键名排序）并忽略 `data.modification_date`，`tests/fingerprint-parity.test.mjs` 逐字钉住。
- 换会话（两边都有 id 且不同）时，把**旧会话绑定的来源 id 与两个基线**一起清掉：它们属于上一把草稿槽，留着会让新会话沿用错的基线。

### 说明

- 新增 `tests/fingerprint-parity.test.mjs`（算法同构 + 接线守卫）；`tests/unsaved-guard.test.mjs` 追加真实链路回归：刷新后拉回带来源 id 的草稿 → 什么都没改就切卡不弹；模型真改过内容 → 照弹（拦截没被削弱）。

### 生效方式

**宿主与客户端都改了：重启 dsh + 刷新页面。**

## 0.25.3

**修误报：来回切卡什么都没改，也会弹「当前角色卡还没保存到角色库」。**

### 修复

- **切换角色卡时机率性弹「未保存」确认**（用户反馈）：`draftFingerprint()` 把整份卡做 JSON 指纹，连 `data.modification_date` 也算进去了。宿主每次写草稿（`setDraftFor`）都会把这个字段刷成当前时间，而 `cc_loadFromLibrary` 回给前端的是**刷新前**的库卡副本 —— 载入一张卡后，4 秒轮询把宿主那份带新时间戳的草稿拉回来，内容明明一字未改，指纹却不同了，下一次点别的卡就撞上 0.24.3 的确认框。快过轮询（<4 秒）时来不及拉、所以不弹，看起来像「有概率」。实测本机同会话草稿与库卡**除 `modification_date` 外逐字节一致**，就是这一条。
- 修法：指纹**忽略 `data.modification_date`**（与宿主 `lib/index.js` 的 `cardFingerprint` 早就这么做对齐），其余字段一个都不忽略 —— 模型真改了内容（哪怕只改 `description`）仍然判「未保存」，0.24.3 的拦截没有被削弱。

### 说明

- `tests/unsaved-guard.test.mjs` 增加三条纯函数断言 + 一条真实链路回归：载入 A → 轮询拉回（只差时间戳）→ 切 B 不弹；模型写了内容 → 照弹。把指纹改回旧实现时这几条会红（实测 3 红），能钉住回归。

### 生效方式

**只改客户端半：刷新页面。**

## 0.25.2

**空草稿不再铺一屏报错：总览改成空状态引导。**

### 变更

- **空状态卡片**（用户截图）：没有载入角色、模型也还没写的时候，总览原来直接铺「校验未通过 / 4 个必须修 / 结构 · 时间锚定 · 设定铁律」一整屏红字 —— 用户什么都没做，只会以为插件坏了。现在判定「草稿无内容且不在预览」时，改渲染空状态：🎭 + 一句引导，加三个入口 —— **让模型开始写**（非 CC 模式 / 无会话时禁用并给出原因）／**导入 JSON / PNG / CHARX** / **看已存角色**（左侧折叠时展开）。
- 一旦草稿有内容（哪怕只有 name）就切回原来的总览 + 体检报告，空状态不影响正常创作与排错。

### 说明

- 新增 `tests/empty-state.test.mjs`：空草稿渲染空状态（三个按钮都在、不出现体检标题）、有内容切回体检、中英文案齐全、非 CC 模式禁用「让模型开始写」。

### 生效方式

**只改客户端半：刷新页面。**

## 0.25.1

**修删除：删掉当前载入的卡后草稿跟着清空 —— 不再被「未保存」误拦，最后一张卡也不会删不掉。**

### 修复

- **删除当前卡后切卡被「未保存」误拦**（用户反馈）：`deleteFromLibrary` 只清了 `currentLibraryId`，草稿里还挂着那张卡的内容、`savedFingerprint` 也没清 —— 于是下一次点别的卡就撞上 0.24.3 的「未保存草稿」确认。
- **删除最后一张卡删不掉**（用户反馈）：上一条的连带死锁 —— 删除后 `currentLibraryId` 已清 → 动作栏「删除」disabled；而草稿还挂着那张卡 → 点它载入又被「未保存」拦，只能退出 dsh。修法：删除的是**当前载入**的卡时，草稿一起清空（`clearDraft` 落盘），`savedFingerprint` 置空；只读 / 创作锁保护期间不硬清，只给提示（`store.deletedLocked`）。
- 新增 `tests/delete-current-card.test.mjs`：删除当前卡后草稿 / 来源 / 指纹都清空，再切卡不弹确认且能成功载入。

### 生效方式

**只改客户端半：刷新页面。**

## 0.25.0

**工坊动作栏加「⟳ 刷新」：LLM 写完但界面还是旧版本时，一键重新拉取草稿。**

### 新增

- **动作栏「⟳ 刷新」**（「校验」左边）：按当前会话强制再拉一次草稿（跳过 500ms 节流），结束后给回执。默认每 4 秒自动同步；心跳被关掉、这一轮轮询被节流、或响应恰好赶上切会话被丢弃时，点它就能立刻看到 LLM 刚写的内容。
- 预览态下点击**不会替换预览卡**（只把最新草稿存进快照，退出预览后显示），与既有 `pullDraft` 的语义一致。

### 说明

- 没有会话 id 时不发请求、只给提示（issue #5 的教训：绝不拿 default 槽顶替）。
- 新增 `tests/refresh-draft.test.mjs`：按钮接线（在校验左边）/ 真发 `cc_getDraft` 且带对 sessionId / 连续两次点击不被节流吞。

### 生效方式

**只改客户端半：刷新页面。**

## 0.24.3

**写完自动落库 + 切卡前拦截：模型忘记保存，也不会再把没落盘的卡冲掉。**

### 修复

- **模型写完卡没保存，切角色就被覆盖**（用户反馈）：`cc_validate` 通过只提醒「去保存」，模型经常忘；随后在工坊左栏点另一张卡载入，当前草稿槽被直接替换。宿主其实有备份（`cc-drafts/backups`，保留 20 份），但**没有任何恢复入口**，用户等于丢数据。修法两层：
  - **自动落库**：`cc_validate` 通过（`valid=true`）时自动把卡存入角色库 —— 有来源 id 就更新原卡、没有就新建；返回里带 `savedToLibrary`（id / action），失败只追加 warning 不阻塞校验；`autoSave:false` 可明确关闭。
  - **切换前拦截**：载入 / 导入前若当前草稿「有内容且与上次保存不一致」，弹确认：**先保存再切换** / 直接覆盖（有备份）/ 取消；拿不到确认框就中止，绝不静默覆盖。

### 说明

- 自动落库只在「校验通过 = 创作完成」时发生；半成品、未通过校验的草稿不会进库。
- 锁 active 时载入只进只读预览、不写草稿，因此不会弹确认（预览本来就不覆盖）。
- 新增 `tests/validate-autosave.test.mjs`（自动落库 / 二次校验更新同一张 / `autoSave:false` / 未通过不落库）与 `tests/unsaved-guard.test.mjs`（未保存判定、确认流程、取消时不发载入 RPC）。

### 生效方式

**只改宿主与客户端半：重启 dsh + 刷新页面。**

## 0.24.2

**测试护栏 + persona 精简：补上「全绿但线上坏」的缺口，并给每轮提示词减负。**

### 变更

- **persona 精简 19.7%**（`presets/cc.patch.yml`）：2634 → 2115 字符。删掉重复表述（「时间锚定」语义 3 处 → 1 处、`cc_validate` 5 处 → 3 处、整段工具名清单），语义一条没删 —— JSON 卫生、六步顺序、canon + canonDigest、release 收口、时间锚定三件套都在。它是**每轮**都进 system prompt 的 `prefix`，不是首轮一次。新增 `tests/persona-budget.test.mjs` 钉住字符上限与必留锚点。

### 修复

- **受限环境里 `npm test` 跑不完**：`release-notes.test.mjs` 用 `execFileSync` 跑真实脚本，禁子进程的沙箱 / 受限 CI 里直接 `EPERM`，整条 `&&` 链从这里断掉。修法 —— `release-notes.mjs` 抽出 `buildRelease(version, changelogText)` 纯函数、CLI 只做 IO，测试改为 import。

### 测试基建

- `tests/harness.mjs`：`check` / `finish` / `readRepo` / `createFakeReact` / `loadClient` 收敛 37 个测试文件的汇总块与十几份假 React（净 -425 行）。
- `tests/entry-guards.test.mjs`：三入口可加载、客户端 bundle id = 包名、`exports` 三入口、`dsh.bundle.patch` 两层文件存在（用 import / 装载代替 `node --check`，不依赖子进程）。
- L2 组合快照：`scripts/dump-config.mjs`（`npm run fixture:dump`）在隔离 DSH_HOME 上真跑 `dsh --profile <p> --dump-config`，把 preset-cc 的行集 / 包名 / 版本落到 `tests/fixtures/preset-composition.json`；`tests/preset-composition.test.mjs` 离线比对。
- L3 真机 smoke：`scripts/e2e-smoke.mjs`（`npm run e2e`）起真实 `dsh web`，换 token / cookie 后走 RPC、写草稿、导出，并验客户端资源（`__ModuleLoader__` 外壳、批次 rev 改坏 404、主资源 200）。
- CI：`.github/workflows/e2e.yml`（手动触发）在 ubuntu-latest 上装 npm 版 `@deepseek-ai/dsh` 跑 L2 / L3；`publish.yml` 仍只跑 `npm test`。

### 生效方式

**用户侧无行为变化。** 重启 dsh 让精简后的 persona 生效；其余只涉及测试与开发脚本。

## 0.24.1

**动作栏删掉「让模型改」+ 体检随切卡刷新：继续给工坊收口。**

### 变更

- **删掉动作栏的「✨ 让模型改」**（用户截图）：它与「选中正文 → 浮条」的功能完全重复，而动作栏已经排了 10 个按钮。现在「让模型改」只有两个入口 —— 体检每条「让模型修」、正文里选中一段文字后的浮条；弹框仍在，只是只由浮条打开。只给它用的词表键一并删除（有守卫钉住这个入口不许回来）。

### 修复

- **切角色后体检不刷新**（用户截图）：总览的体检结果只在点「校验」时更新，左栏点另一张卡载入之后，页面还挂着上一张卡的「3 个必须修 / 未结案钩子」。根因 —— `validationReport` 没和「哪张卡、哪个 rev」绑定，载入只是换了草稿。修法 —— 结果带上 `key = 卡 id#rev`；`setDraftFromHost`（载入 / 导入 / 模型写入草稿）发现 key 变了就立刻作废，总览回到「立即体检」；再补一个 effect：面板打开且结果过期时自动重跑一次（一个 key 只自动试一次，失败不反复打 RPC）。导出弹层里的体检摘要同样只认当前这份。

### 生效方式

**只改客户端半：刷新页面。**

## 0.24.0

**让模型修 + 选中即引用：体检报告与工坊正文都能把「这里不对」直接交给模型改，不用再自己找字段、自己编标准。**

### 新增

- **体检每条「让模型修」**（替代原来的「去修 →」跳转）：把「问题 + 参考 + 建议方向 + 规则」拼成一条消息发进当前会话。规则里写明：先 `cc_get_card({digest:true})` 看现状、只改相关字段、**不要重写整张卡**、用对应写入工具、改完 `cc_validate` 复检。
- **选中即引用**：在工坊正文（卡内世界书条目、角色字段、五维、开场 / 备选 / 群聊、Character's Note）里拖选一段文字，选区上方浮出「✨ 让模型改」；点开弹框写「哪里不好」，消息里会带上**引用原文 + 位置**（如 `character_book.entries[0]`、`data.description`），模型据此只改这一处。只认 `#cc-scroller` 内、至少 4 个字的选区 —— 单击、拖滚动条、选中标题都不会误弹。
- **动作栏「✨ 让模型改」**：用户觉得哪里不合理，写一句话（弹框）连同卡名 / 当前章节一起发给模型，不用自己先找到那个字段。两个入口共用同一份提示模板（`MODEL_FIX_RULES` + `modelFixTail()`，测试钉住只有一份）。
- **宿主端点 `cc_promptSession`**：走宿主 `sessionController.prompt`（与用户在输入框打字等价：写 durable `user/message`，agent 随即开始跑），不新增权限，受既有 RPC 围栏保护。空内容、缺会话、部署里没有 `sessionController`、超过 4000 字，都会在发出去之前被挡住并给出确切错误码。

### 修复

- **选中浮条飘到窗口左上角**（用户截图）：首版浮条用 `position:fixed` + 选区视口坐标，但工坊 overlay 带 `backdrop-filter` —— 它会把 fixed 后代的包含块改成 overlay 自身，坐标全错。修法：浮条改 `position:absolute` 渲染进 `#cc-scroller`（主区补 `position:relative`），坐标换算成「滚动容器内容坐标」，选区贴顶时翻到下方；另外 textarea / input 里的选区在 Chrome 中 `getBoundingClientRect()` 全 0，字段一律回退到元素自身 rect 定位。
- **「去修」跳过去没有意义**（用户反馈）：用户并不知道时间锚定 / canon / 台账这些标准，跳到对应章节仍然得自己编。现在跳转降级为文字链「自己改 →」，主按钮换成「让模型修」。

### 说明

- 只在 **CC 模式 + 有当前会话** 时可用；否则按钮禁用，tooltip 说明原因（非 CC 模式下模型手里没有工坊工具，发过去也只会聊两句）。
- 消息发出去后模型写草稿会上锁 → 工坊自动变只读，改完轮询刷新草稿。这是 0.11.0 起的既有机制，没有引入新状态。
- 能力边界：模型是否真的「只改一处」靠提示词约束，插件不做语义守门（做不到）；不满意就再发一次，或点「自己改 →」手动改。

### 测试

- 新增 `tests/prompt-session.test.mjs`：端点契约（透传 / 空内容 / 缺会话 / 无 `sessionController` / RemoteError 透出 / 长度上限）。
- 新增 `tests/model-fix.test.mjs`：两个入口的按钮与禁用态、消息内容、弹框流程、选中即引用（浮条定位用内容坐标、弹框引用、消息带原文与位置）、提示模板只有一份。

### 生效方式

**宿主半与客户端半都有改动：重启 `dsh web` 并刷新页面。**

## 0.23.0

**角色库入口收敛 + 分组可见 + 体检报告：把重命名 / 新建分组 / 选组收回动作栏，让左栏一眼看出分组，让总览直接告诉你怎么改。**

### 变更

- **体检报告**（ROADMAP 第 3 项）：总览页的体检区从「平铺 issues」升级成六组报告 —— 结构 / 时间锚定 / 设定铁律 / 未结案钩子 / 世界书 / 其他，每组带条数与最高级别色点，每条带一句「这样改」和「去修 →」跳章节；没校验时给「立即体检」入口，不再是空白。宿主 `validate` 的 `structural` 补回 `warnings`（结构类提示以前只混在 warnings 字符串里，没法分组）。导出弹层不再平铺 errors/warnings，只留摘要 + 指向总览。
- **角色库入口收敛**（用户截图）：左侧「⋯」菜单里的「另存为新 / 重命名 / ＋ 组」三项下线。
  - 「重命名」「＋ 组」搬到顶部动作栏（校验 / 导出 / 保存当前 / 重命名 / ＋ 组 / 分组 / 删除 / 清空），点击弹出输入框：Enter 提交、Esc 取消、空名字时「完成」禁用；替换掉原来的内联输入与 `window.prompt` 兜底（内嵌 webview 会拦原生对话框）。
  - 「另存为新」整条删除：它与「保存当前」共用 `cc_saveToLibrary`，唯一差别是不传 `id`；入口一删就没有调用者，留着只会让两条保存路径行为分叉。
  - 「⋯」菜单只保留「导入」。

### 修复

- **关系视图没有分组入口**（0.22.0 遗留）：分组折叠视图下线时，标题上的「关系」按钮随之一并消失，关系章节只剩一句「先在左侧选分组」，而左侧已经没有分组选择器 —— 用户进得去、选不了。修法：关系章节标题下加「选择分组」下拉（选中即加载该组，走原来的 `openRelationsFor`）。
- **平铺列表看不出分组（0.22.0 遗留）**：现象 —— 左栏一列卡里，分组只剩卡片副标题末尾一句「· 锁天司」，几组混在一起看不出谁和谁一组（用户："原本卡分组关系没法直观体现了"）；根因 —— 0.22.0 把分组节标题整块删掉，只把组名塞进副标题；修法 —— 按分组分节：组首一行 11px 小字「组名 —— 张数」，组内有共享书时挂 📖，组内卡片照常平铺；组首不可折叠、不带按钮（不重演旧节标题那种占位），库里没有任何分组时仍是纯平铺，搜索时标题上的张数改成命中数，卡片副标题不再重复组名（组名只在组首与 hover 提示里各出现一次）；折叠成 56px 头像条时，组与组之间插一条 20px 短横线（放不下组名，但分界看得出来），头像 hover 提示也带上组名。
- **删除已无调用者的 `renderGroupedList`**：0.22.0 改平铺列表后它不再渲染任何位置，但源码还留着（内含内联的新建分组输入）。整段删除，`groupDraft` 状态一并清掉。

- **Release 标题被「### 变更」污染**（发版脚本，v0.23.0 首次触发）：GitHub Release 名字变成「0.23.0 — ### 变更」—— `.github/scripts/release-notes.mjs` 把小节第一行非空行原样当标题，而 0.23.0 小节缺摘要段。修法：标题只认正文行（跳过 `#` 开头的 Markdown 标题），并给 0.23.0 补回摘要段；新增 `tests/release-notes.test.mjs` 钉住「只有 ### / 有摘要 / 版本缺失」三种形态。只影响发版工具，不影响插件运行。

### 测试

- 新增 `tests/library-dialogs.test.mjs`：菜单只剩导入；动作栏出现两个新按钮；未载入库卡时重命名禁用；弹框预填当前卡名、空名字禁用「完成」、取消不发请求；提交分别调用 `cc_renameInLibrary` / `cc_createGroup`；源码守卫钉住「另存为新的旁路」「内联输入」「`window.prompt` 调用」都不许回来。
- `relations.test` 的「关系入口」守卫改指新的分组下拉；`relations-view.test` 的「没有内联下拉」断言把关系章节的分组选择器排除。
- 新增 `tests/library-grouping.test.mjs`：组首顺序 / 张数 / 📖 标记 / 不可点击，卡片紧跟自己的组首，副标题不重复组名，搜索只剩命中组且张数 = 命中数，库里无分组时纯平铺。

- 新增 `tests/audit-report.test.mjs`：未校验时的入口、六组顺序与条数、结构组来源、每条修法文案、去修跳章节、导出弹层不再铺第二份清单。

### 生效方式

**宿主半与客户端半都有改动：重启 `dsh web` 并刷新页面。**

## 0.22.1

### 修复

- **滚动正文时顶部锚点高亮不跟随**（用户截图）。现象 —— 打开工坊后手动滚动下方正文，顶部横向锚点的高亮一动不动，点锚点本身却能跳。根因 —— 滚动监听 effect 依赖 `[s.cur]`，而 `Workshop` 在面板关闭时也一直挂在 `shell.overlay` 上：首帧渲染时 `#cc-scroller` 还没进 DOM，effect 里 `getElementById` 拿到 `null` 就提前 return；打开面板时 `cur` 通常没变（默认 0），effect 因此不重跑，scroll 监听器一次都没装上。修法 —— 依赖改成 `[s.panelOpen]`（面板开了才绑、关了自动解绑），回调里用 `getSnapshot()` 读 `cur`；顺带 ① 点击锚点后的平滑滚动窗口内不反推（否则高亮会被途中经过的章节一路改写），用户滚轮 / 触摸 / 按键时立刻解锁；② 已滚到底时直接认最后一个章节（共享书常常够不到顶部）；③ 卸载时清掉 90ms 节流定时器。生效方式：刷新页面。

### 测试

- `nav-highlight` 新增 7 条断言：依赖必须是 `[s.panelOpen]`；打开面板后监听真的装上；滚动反推命中可见章节；平滑滚动窗口内不被改写；滚轮解锁后恢复；滚到底认最后一节；关面板全部解绑。

## 0.22.0

**工坊布局重构：左侧 200px 导航列 → 顶部横向锚点 + 单页滚动；角色库移到左侧；宿主校验补齐时间锚定与世界书质量。**

### 新增

- **顶部横向锚点栏**：总览 / 角色 / 五维 / 世界书 / 开场 / 关系 / 共享书，每个 tab 带三态进度点。点击平滑滚到对应章节，手动滚动时自动高亮当前章节。
- **单页滚动**：七个章节常驻渲染在同一页 —— 滚轮就能看全卡，不用来回翻页。
- **角色库移到左侧**（250px）：选对象（左）与选章节（顶部）分两个轴，不再挤在同一个左列；可折叠成 56px 图标条（只剩「»」+ 一列头像，点头像即载入）。
- **入口收敛**：校验 / 导出 / 保存 / 清空固定到锚点栏右侧；删掉总览页里重复的三枚按钮与左下角的「校验导出」。
- **宿主校验补齐**：`validate` 端点新增时间锚定（`auditAnchors`）与世界书条目质量（`auditLoreEntries`）检查 —— 工坊「校验」终于能看到「时间锚定到底写进去没有」。

### 修复

- **写草稿门禁与内容体检分离**：`cc_setDraft` 改用 `validateStructure`（只看 SPEC / 字段类型）。第一次把锚点检查加进 `validateCard` 时，写盘门禁连带变严，工坊自动保存整条链路失败（锁定矩阵测试直接崩）。
- **常驻渲染暴露的空值**：`tags` / `keys` 在部分旧卡里可能缺字段，单页渲染后会被执行到 —— 全部补 `|| []`。
- **折叠态不再是竖排字**：现象 —— 第一版折叠后只有 40px，里面写「已存角色 7」，中文被挤成竖排、比展开态更吵；根因 —— 折叠时仍然渲染了标题 / 计数这些文字节点，只是把宽度压窄；修法 —— 照原型改成 56px 图标条：顶部只留「»」展开按钮，下面一列头像方块（当前卡描边），文字节点一个都不渲染，点头像 = 载入该卡（与展开态卡片同一入口）。生效方式：刷新页面。
- **库卡片的白描边**：现象 —— 未选中的卡每张都带一圈浅白细边，点过一张卡之后整列像一排白框；根因 —— 卡片静态写了 `border:1px solid var(--dsw-alias-border-l1)`，暗色主题下这圈边就是浅白，原型是「默认透明、hover 才显边」；修法 —— 默认 `border: transparent`，hover 时才换 `border-l1`（直接改 DOM，不触发全页重渲染），选中仍是品牌紫，另加 `onMouseDown` 阻止抢焦点，不给浏览器留焦点环。生效方式：刷新页面。

### 说明

- `validate` 返回新增 `structural`（`{valid, errors}`）：`valid` = 能不能导出，`structural.valid` = 能不能写草稿。
- 旧卡（0.15 之前）会因缺时间锚定显示「未通过」—— 这是预期的，它们确实没有防漂移字段；报告里「结构」与「内容」分开显示。

### 测试

- 重写 `nav-highlight`（左侧导航 → 顶部锚点 + 单页结构）；`export-entry` / `shared-book-st-export` 按入口收敛调整；全量测试全绿。

### 生效方式

**宿主半 + 客户端半都有改动：重启 `dsh web` 并刷新页面。**

## 0.21.0

**新增「未结案钩子」检测：反细节循环里可计算、零运行期成本的那一半。**

现象：SillyTavern 里小模型常揪住「一碗粥」不放 —— 只要它在首条消息里是未完成状态（「桌上那碗粥还热着」「手机没关」），模型就会把它当成本轮待办，之后每轮回收一次、每轮自我强化。

根因：复读的种子不在运行期，而在**开场**。一个没结案的日常细节就是一个「未完成目标」，每被提及一次就进一步强化。

修法（制卡期 lint，不新增工具、不增加每轮 token）：

- `lib/consistency.js` 新增 `auditOpeningHooks(card)`：扫 `first_mes` / `alternate_greetings` / `group_only_greetings`，命中「物品 + 未完成状态」（还热着 / 没关 / 没吃完 / 写到一半 / 在炉上煨着；食物词 + 还、在、正、没、热、凉、剩）且**该段 + 后 2 段内没有结案标记**时，产出一条汇总 warning（最多 5 个样本 + 消法）。
- **不扫** `mes_example`（few-shot 示例不是当前场景状态）与 `scenario`（设定文档，静态物品多、误报高）。
- 接入 `cc_validate` 与宿主 `validateCard`：warning 级、**不阻塞 `valid`**；工坊「校验」走现有 `consistency.issues` 链路自动显示，UI 零改动。
- 能力边界：纯启发表层匹配，不判断「这碗粥到底该不该结案」，也不宣称能消除复读（运行期仍靠模型自身与 ST 侧的采样设置）。

### 说明：为什么砍掉了「运行期叙事卫生规则」

初版提案（`cc_patch_narrative` + `cc_lint_narrative` + 4 处注入 + 独立开关矩阵）未采纳，原因记录在此以免后人重提：

- 改动清单指向的 `lib/ccv3/*` 在仓库里不存在（实际是 `lib/consistency.js` + `lib/agent.js`）。
- 2 个新工具会打破 33 个工具的契约（两处测试钉住），而 canon 的经验是「能用参数解决就不加工具」。
- 4 处注入规则全文会重演 0.19.0 被批评过的重复注入（实测多一份约 187 token/轮）。
- `token_budget` 只约束 `character_book`，`depth_prompt` / `system_prompt` 不在该预算内 —— 提案的「纳入预算」口径不成立。
- 规则文本有副作用：「每段必须推进即时冲突」会破坏日常向 RP，「否则视为 OOC」会被模型误判正常呼应。

若后续有实际数据证明运行期规则值得，再按 `cc_validate({hygiene})` 尾段注入（只进 `depth_prompt`，约 130 token/轮）重做。

### 测试

- 新增 `tests/hygiene.test.mjs`（结案/未结案/误报收窄/扫描范围/汇总/工具链/宿主接入/共存）；全量测试全绿。

### 生效方式

**改的是预设半（`lib/agent.js`）、宿主半（`lib/index.js`）与共享纯函数（`lib/consistency.js`）：重启 `dsh web` 并刷新页面。**

## 0.20.1

**插件元数据（locale 中英标题/描述）+ dsh 0.2.2-rc.2 兼容矩阵收录。**

### 新增

- **`locale/zh.json` / `locale/en.json`**：插件管理器与设置页的插件行只从包**导出的** `locale/*.json` 读 `meta.title` / `meta.description`（宿主 `readPluginMeta`，不需要激活插件）。此前本仓库没有 locale 目录，英文界面回退到 `package.json` 的中文 `description`。现在中文行显示「角色卡工坊」、英文行显示「Character card studio」，各自带一句说明用法的描述。
- `package.json`：`exports` 增加 `./locale/*.json`、`files` 增加 `locale/*.json`。漏一处 = 本地目录安装看着正常、发布后标题描述回退。
- `tests/locale-meta.test.mjs`：钉住两份 JSON 合法、中英不互相复制、locale 顶层只放 `meta`（UI 词表的唯一真源仍是 `lib/client.js` 的 `zh` / `en`，不制造第三份）、以及 `exports` / `files` 两处声明。

### 兼容性

- **dsh `0.2.2-rc.2` 实测通过，加入兼容矩阵。** 审计方式：隔离环境（`DSH_HOME` / `HOME` / `USERPROFILE` 指向临时目录，profile 只组合 `dsh-base` + `dsh-web-app` + 本插件）对 dsh `0.2.2-rc.2`（Node 24.21 / hostProtocol 4）全量验证：宿主 `fiberPhase:active`；RPC 线协议（`ping` / `cc_isCcMode` / `cc_listTargets`，未知端点仍回 200 + `unknown-endpoint`）；三个挂载点（胶囊 / 全屏工坊 / 设置分区）；预设 roster 出现「CC 模式」且无 broken；`npm test` 全绿。
- 与 rc.2 内置 `standard` 的预设差异均不 broken：`tool-office` / `tool-schedule` / `tool-plugin-market` 行缺席（能力取舍，下限 `0.2.0-rc.2` 的解释见预设注释）、`tool-fs.applyPatch` 默认 `false` 等价、`tool-subagent-control.interrupt` 默认 `true`（CC 模式多一个 `interrupt_agent`）。升级指南（`v0.2.2-rc.1/` 17 条）只命中 macOS 浮层拖拽区、`BundleInfo.updatable`（0.20.0 已无更新检查，无关）与内置 preset 的 `interrupt_agent` 差异三项。

### 生效方式

**只改包内资源与文档：重启 dsh 即生效**（目录安装直接读 `locale/*.json`；已发布版本需升级到 0.20.1）。

## 0.20.0

**移除设置页「插件更新」区块：dsh `0.2.2-rc.1` 已内置插件更新检查（用户要求）。**

### 移除

- **设置 → 角色卡工坊 → 插件更新**：整块 UI、宿主 `cc_checkUpdate` 端点、npm registry 查询（`parseSemver` / `compareVersions` / `fetchLatestFromNpm` / `NPM_LATEST_URL`）、客户端 `checkUpdate` / `markUpdateCopied` 与 `settings.update.*` 双语词表、以及回归测试 `tests/check-update.test.mjs` 一并删除。
- 原因：dsh `0.2.2-rc.1` 起插件更新检查已经内置，设置页里再放一个同样的入口只会造成两个检查入口、两份版本判断，并让插件多一条不必要的出站请求。删掉后插件只剩导出弹层「导入到 SillyTavern」一处出站网络。

### 测试

- `npm test` 全量全绿；`tests/check-update.test.mjs` 随功能删除，其余测试不受影响。

### 生效方式

**改的是客户端半与宿主半：重启 `dsh web` 并刷新页面。**

## 0.19.2

**修复 0.19.1 的 1 个 bug + 落实 3 条建议（用户反馈）。**

### 修复

- **重传逐字相同的 canon 清不掉 `canon-stale`**：`applyCanon` 在规则没变时保留旧指纹，于是「改完条目 → 按提示原样重传」永远无效，只有改 canon 的文字才能清掉，形成死循环。修法：区分「确认」与「沿用」—— 显式传 `canon` 时刷新指纹（写一次 `extensions.cc_canon`）；`cc_validate()` 不传 canon 时仍保留旧指纹，stale 检测不被削弱。

### 改进

- **触发型条目可豁免覆盖检查**：`cc_add_lorebook_entries` / `cc_update_lorebook_entry` 新增 `skipCoverage` 参数（此前只有内部字段，模型写不进去）。「聊到才插入」的设定不必再被 `canon-coverage-gap` 反复催。
- **warning 文案写清「怎么消」**：`canon-stale` 给两条消法（补新设定 / 原样重传也算确认）；`canon-coverage-gap` 给出 `skipCoverage: true` 的具体调用。
- **超预算给结构化修复建议**：`cc_validate` 返回 `budgetHint: { over, current, used, suggested, call: { tool, args } }` —— `call` 就是下一步该发的工具调用。**设计上仍不跳过 canon 写入**：跳过等于运行期没有铁律，会退回 0.19.0 之前的状态；预算不够时按建议调预算或精简条目。

### 测试

- `tests/canon.test.mjs` 增加 ⑱–⑳（stale 刷新 / skipCoverage / budgetHint）；全量测试全绿。

### 生效方式

**改的是预设半（`lib/agent.js`）与共享纯函数（`lib/consistency.js`）：重启 `dsh web` 并刷新页面。**

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
