# AGENTS.md — 给在本仓库工作的 Agent 的说明书

`@xia-sc/dsh-cc-studio`：DSH（DeepSeek Harness）插件，CCv3 角色卡工坊。输入框上方的胶囊 → 全屏工坊；配合 `CC 模式` 预设让 LLM 用 33 个 Tool 先问再填，导出 `JSON / PNG / CHARX`，也可直接推进本机 SillyTavern。用户文档看 `README.md` / `README_EN.md`，历史看 `CHANGELOG.md`（0.12.0 起）。

## 1. 结构

```
lib/index.js       宿主半：RPC 端点 / 草稿落盘 + LLM 创作锁 / 角色库 / 分组 + 共享书 / PNG·CHARX / 远程导入
lib/agent.js       预设半：CC 模式的 33 个 Tool（只随 CC 预设挂载）
lib/client.js      浏览器半：手写 bundle（胶囊 + 工坊 + 设置页）；factory 只能 require("react")
lib/group-layer.js 卡组层：作用域 / 统计 / 体检（纯函数，两半 import）
lib/draft-lock.js  草稿锁判定（纯函数，两半 import）
lib/compat/        兼容层：core.js + adapters/* + registry.js + remote.js（纯函数、零 IO）
presets/cc.patch.yml  预设的声明行（唯一载体；插件不写用户目录）
cordis.patch.yml      宿主组合里的插件行
tests/*.test.mjs      回归测试，不随包发布
```

三个入口由 `package.json.exports` 固定：`.` → `lib/index.js`、`./client` → `lib/client.js`、`./agent` → `lib/agent.js`。改包名要同步 5 处：`package.json.name`、三处加载方、`lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 `id`（宿主按包名精确匹配，对不上整个客户端半加载失败）。

## 2. 硬约束

**没有构建步骤。** `lib/*.js` 是最终产物，直接 ESM。`lib/client.js` 整文件包在 `window.__ModuleLoader__.load({id, factory})` 里，只能用 `React.createElement`（不能 JSX），不能 import 本仓模块。风格是老派 plain JS：`var`、`function`、显式 `try{}catch{}`，不要顺手现代化。改客户端要刷新页面，改宿主/预设要重启 dsh。

**宿主 inject 是硬依赖。** `const inject = ["webServer", "connection", "agents", "agentPresets"]`；解析不到会一直等待而不报错。可选服务用 `ctx.get("x")` 并自己判空。

**RPC 通道由插件自己注册。** `connection.rpc.handle()` 对外部插件不可用（它用 connection 自身的 ctx，解析不到 `webServer`），所以插件在 `ctx.webServer` 上注册 `kind:"prefix"` 的 `POST /dsh-cc-studio-rpc/<endpoint>`，自己实现同一套线协议：

- 请求体 `{type:"client-request", rpcId, method, payload}`，`method` 必须等于 URL 里的 endpoint；响应体 `{type:"server-response", rpcId, result:{ok,value}|{ok:false,error:{code,message,details}}}`。
- 先过 `connection.requestRejection(req)` 围栏（host/origin + 会话 cookie），**不能绕过**。
- 体积上限 `RPC_MAX_BODY_BYTES = 48MB`（PNG ≤20MB、CHARX ≤30MB 的 base64 都走这里）；请求体读取用事件式 `readBoundedBody`。
- 命名约束来自 `dsh-client-connection`：channel `/^\/[A-Za-z0-9._~-]+$/`、endpoint 每段 `/^[A-Za-z0-9_$.-]+$/`。未知端点回 200 + 失败帧（`details.code="unknown-endpoint"`），不是 404。
- 改协议前先对 `@deepseek-ai/dsh-client-connection` 的 `parseConnectionResponse` / `assertTarget`。

**预设只有一层声明。** 唯一载体是 `presets/cc.patch.yml`（`dsh.bundle.patch` 第 2 层），插件**不往用户目录写任何预设文件**；`apply()` 零写盘。`tests/preset-install.test.mjs` 钉住行集快照、与目标 dsh 内置 `standard` 的对齐（有意差异只允许 `tool-schedule` / `tool-plugin-market` 两行缺席，且要写进文件注释）、prompt 变量白名单（只有 `provider` / `model`）、写类工具的严格 JSON 规则。写错一个包名 = 整份预设 `broken`（roster 里看得到「CC 模式」但带诊断、组不出会话）。`0.1.x` 时代的目录安装已整体删除，不要带回来（有源码级守卫）。

**落盘根只有一套。** `dataRoots(sub)` → `[主根, 旧根]`（主根 = `DSH_HOME` 或 `~/.dsh`）：写只写主根，读依次回退。草稿 `cc-drafts/`、角色库 `cc-library/`、分组 `cc-groups/`、共享书 `cc-books/` 全走它。宿主半与预设半各有一份同构实现（`dataRoots` / `safeDraftFile` 必须算出同一路径）。

**测试隔离：三个变量一起改**（`DSH_HOME` + `HOME` + `USERPROFILE`）。只改 `DSH_HOME` 会从 `homedir()/.dsh` 读到真实用户的卡。

**卡组层只有一份实现。** 「卡组」= 分组 + 组级共享书 + 库条目 `meta.groupId`。取数据走 `groupScope()`，取「多少条 / 多少 token」走 `groupMetrics()`，新增体检项往 `GROUP_CHECKS` 加一类；工具里不许自己 `readBookRaw` 拼一套、自己求和、自己 `issues.push`。`include:"summary"` 默认不回正文，`maxCards` 默认 50。

**草稿锁的判定只有一份。** `lib/draft-lock.js`（`normalizeLock` / `isLockStale` / `lockBlocksDraftWrite`）两半共用。LLM 每次写草稿自动上锁（sidecar `<draft>.lock.json`，30 分钟无写入失效）；锁 active 时浏览器写草稿端点被拦，载入/导入只回只读预览；`force:true` 才放行。覆盖型动作前 `backupDraftSync` 备份到 `<draftDir>/backups/`。新增写草稿端点必须接这把锁。

**兼容层只有一份。** 新增平台 = 加 `lib/compat/adapters/<id>.js` + 在 `registry.js` 注册（或 `registerTarget()`）；不许在 `index.js` / `client.js` / `agent.js` 写平台分支。adapter 是纯函数零 IO，路径/字段名/能力矩阵都写在它里面。浏览器半不 import compat —— 导出/转换一律走宿主 RPC。卡导出副本才写平台字段（绑定/投影），草稿与库里的卡一个字节不动。

**远程导入（推给本机 SillyTavern）。** 平台差异只在 adapter 的 `remote` 描述里（探测/CSRF/世界书列表/世界书导入/卡导入的路径与字段名、默认地址、认证方式）；纯计算在 `lib/compat/remote.js`；宿主只做 IO（`cc_stProbe` / `cc_stImport`）；客户端只按 `cc_listTargets` 里带 `remote` 的目标渲染区块。**先导世界书、后导卡**，卡副本的 `extensions.world` 必须用平台**返回的实际书名**。ST 默认 CORS 拒绝浏览器跨域、CSRF token 与 session cookie 绑定，所以请求必须由宿主代发。

**时间锚定模板只有一份。** `lib/agent.js` 的 `TIME_SYSTEM_PROMPT` / `TIME_POST_HISTORY` / `TIME_ANCHOR_RE` 是唯一来源：`cc_patch_character` 在模型漏写时自动写入（显式传了以调用方为准），`cc_validate` 强制检查（缺 system_prompt 锚点 / post_history 自检 / first_mes 时间戳 = error）。ST 侧 `system_prompt` 替换 `main` 段、`post_history_instructions` 替换 `jailbreak` 段，两个 `prefer_character_*` 开关默认开；模板里保留 ST 默认基础句。客户端与文档不要复制模板。

## 3. 三个入口要点

### 3.1 宿主 `lib/index.js`

- 端点：`validate` / `ping` / `cc_isCcMode` / 草稿 6 个 / 库 6 个 / 分组 7 个 / 共享书 4 个 / 容器导入导出 8 个 / `cc_exportJson` / `cc_exportBook` / `cc_listTargets` / `cc_stProbe` / `cc_stImport` / `cc_checkUpdate`。新增端点必须同时提供客户端入口。
- 三条导入路径（JSON/PNG/CHARX）都走 `normalizeDraft` → `upgradeCardToV3`（V2/V1 自动升级，返回 `upgradedFrom`）；`cc_setDraft` 故意不升级（它是草稿镜像）。
- 草稿槽 key 必须与 Tools 侧一致：浏览器显式传 `sessionId`，回退 `default` 时 `source` 报 `fallback`（前端据此不渲染该槽并告警）。
- 删除库条目要删两个根里的同名副本；导入/载入/覆盖前备份；目标槽非空必须显式 `overwrite:true`。
- 版本号唯一真源是 `package.json`（`pluginMeta()`），客户端不硬编码。

### 3.2 预设半 `lib/agent.js`

- `inject` = `["tools","agents"]`，注册 33 个 Tool。**返回契约**：顶层只放 `workflow`（`next`/`hint`/`step`/`state`/计数）+ `message` + 可选 `warnings[]`，不许出现 `next`/`hint`/`notice`/`warning` 副本（测试会判失败）。
- 世界书完成态 = ≥5 条且至少 1 条共创（`cc_auto` 条目不算）。
- 写类返回必须带 `cardName` / `cardId` / `draftStatus.sessionKey`；`rev` 在草稿文件里（跨进程唯一真相），盘上 rev 变化要 `revDrift` 重载，`expectedRev` 不符直接拒绝；空改动不落盘、不涨 rev。
- 返回前统一 `sanitizeJson()`（任何嵌套 `undefined` / `NaN` / `-0` 会让整次调用失败）；`changed` 用 `assignIfChanged()`。
- `cc_validate` 通过后必须引导 `cc_release_draft`（persona、终态 `next`、首次上锁 warning 三处都要保留）。
- 与宿主共享同一份草稿文件与同一套落盘根；两半的解析/截断（如 `GREETING_MAX = 10`）必须一致。

### 3.3 浏览器 `lib/client.js`

- 三个挂载点：`conversation.input.dock`（胶囊）、`shell.overlay`（工坊）、`settings.section`（设置页）。
- CC 模式探测只有 `useCcPreset()` 一份；状态带会话归属（`ccSessionId` / `ccSource`），未知时绝不沿用上一个会话的结论；组件读 store 必须走 `useStoreSnapshot()`，且放在 `useCcPreset` 之前（effect 顺序会丢「切会话清状态」那次 emit）。
- 状态在 `store`（`createStore` + `subscribe/getSnapshot`）；设置存 `localStorage:dsh-cc-studio-settings`。
- 修改写入口先过 `isReadOnly()`（锁 active 或只读预览）；预览期间 `pullDraft` 只更新 `llm*`，不动显示中的草稿。
- i18n：`zh` / `en` 两张表键集必须一致，UI 层不许出现中文字面量；新增文案两边都加。
- 导出是独立弹层（`exportOpen` / `openExport(target)` / `closeExport()`，不改 `cur`）；三个入口（左下角、总览页、已存卡卡片）都打开同一弹层；卡片导出走 `cardId`，不要求先载入。共享书作用域走 `exportScope()`（库卡按 `meta.groupId`，草稿按当前分组）。弹层底部是 ST 导入区块（见 §2 远程导入）。**导出别再变回中栏整页，也别再要求「先载入再导出」。**
- 破坏性动作（清空卡）二次确认在按钮侧；拿不到确认框一律不动数据。

## 4. 版本兼容

只把**实测过**的 dsh 版本写进 `dsh.compatibility.dshReleases`（精确 SemVer）：

| dsh | 状态 | 备注 |
| --- | --- | --- |
| `0.2.0-rc.2` | 当前下限 | 声明行世代；依赖树里没有 `dsh-tool-schedule` / `dsh-plugin-market`（预设有意少这两行） |
| `0.2.1-rc.2` | compatible | prompt 变量收窄到 `provider` / `model`（`{{cwd}}` 会让每轮失败） |
| `0.2.1-rc.3` / `0.2.1-rc.5` | compatible | 契约包逐字节不变，实测全绿 |
| `0.2.2-rc.1` | compatible | 必须适配：`tool-subagent-control` 删了 `./list-agents` 子入口（预设已删该行）；`modelSelectionSettings` 拆成 `modelSelection` + `modelDiscovery`（两代双写） |

没测过的版本只进 README 的「未实测」白名单，不进矩阵。升级时：`dsh --profile <名字> --dump-config` 看组合（不 mount）；diff 契约包与预设块；对目标版本的 `standard.patch.yml` 逐行对；最后按 §6 做隔离实测。

## 5. 日常改动规则

- **每个 bug 都要回归测试 + CHANGELOG 顶部一条**：现象 → 根因 → 修法 → 生效方式（重启 dsh / 刷新页面 / 两者）。
- 预设行只改 `presets/cc.patch.yml`，并同步 `tests/preset-install.test.mjs` 第 3 节行集快照。
- 改落盘路径两半同步（`dataRoots` / `safeDraftFile`）；卡组逻辑只动 `lib/group-layer.js`；兼容层只动 `lib/compat/`。
- 版本三处同步：`package.json`、`README.md` / `README_EN.md`、`CHANGELOG.md` 顶部小节。`lib/agent.js` 的 `BUILD` 也要同步（有测试钉住）。
- **文档保持简短**：本文件与 README 不写会随代码漂移的精确计数（行数、断言总数、端点个数、词表键数）；需要时以 `npm test` 输出与源码为准。CHANGELOG 只保留最近几个版本（当前从 0.12.0 起），更早的看 git 历史。
- manifest 契约（STORE 门禁）由 `tests/preset-install.test.mjs` 钉住：canonical `repository`、`engines.node`、完整 SemVer 的 dshReleases、零依赖、无 install 脚本、`files` 非空、宿主/预设半只 import `node:` 与相对路径。不要为商城扫描改运行时代码。
- 发布走 CI：打 `v*` tag → `npm test` → `npm publish --provenance` → Release（正文由 `.github/scripts/release-notes.mjs` 从 CHANGELOG 该版本小节抽取，所以顶部小节要写好）。发版前三处版本号 + commit + tag。发布后有传播延迟（约 1-3 分钟），别重发；`--dry-run` 不验证 OIDC。
- 不过 `dist/*.zip`（历史归档）；保留中文注释（它们解释「为什么」和踩过的坑）。

## 6. 本地验证

```bash
npm test    # 全部测试文件串行；全绿才算过
```

测试只跑纯函数与源码守卫（不启动 dsh、不写真实用户目录），所以还要手工验证：

- **改宿主/客户端**：重启 `dsh web` + 刷新页面。客户端资源 URL 含 `??` 与批次 `rev`，缺一个就 404。
- **改预设**：只改 `presets/cc.patch.yml`，重启即生效；用 `node tests/preset-install.test.mjs` 看行集/变量白名单。
- **验证预设没 broken**：`dsh --profile <名字> --dump-config` 确认 `preset-cc` 被组合进来，再看 GUI「Agent 预设」或 `POST /api/pluginInventory/list`（带 `broken`）。
- **验证 RPC**：`/` 与 RPC 都受会话 cookie 保护；用 `dsh web` 打印的 token 访问 `/?token=…` 换 cookie，再带信封 POST。
- **整套隔离实测**：三个环境变量指向临时目录，建 `profiles/<名字>/package.json` 声明 `dsh.profile.bundles`，把本仓库 symlink 进 `node_modules/@xia-sc/dsh-cc-studio`，用目标 dsh 版本启动 `web --no-open --port <空闲端口>`，再用 playwright/curl 验三个挂载点与关键流程。
