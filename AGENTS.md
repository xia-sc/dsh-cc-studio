# AGENTS.md — 给在本仓库工作的 Agent 的说明书

`@xia-sc/dsh-cc-studio`：DSH（DeepSeek Harness）插件，CCv3 角色卡工坊。
一句话：**输入框上方的胶囊 → 全屏融合工坊**，配合 `CC 模式` 预设让 LLM 用 32 个 Tool 先问再填，最后导出 `JSON / PNG / CHARX`。

用户文档看 `README.md`（中文）/ `README_EN.md`（英文），历史看 `CHANGELOG.md`。本文件只写**改代码前必须知道的事**。

---

## 1. 仓库结构

```
lib/index.js       2354 行 ── 宿主半：RPC 端点 + 草稿落盘 + 角色库 + 人物关系分组 + PNG/CHARX + 预设安装（旧版目录形态）
lib/agent.js       2910 行 ── 预设半：CC 模式的 32 个 Tool（只随 CC 预设挂载）
lib/client.js      2918 行 ── 浏览器半：手写 bundle，胶囊(Capsule) + 工坊(Workshop) + 设置页(SettingsView)
lib/group-layer.js  608 行 ── **卡组层**（0.10.0）：卡组作用域 / 世界书分段统计 / 检查注册表 —— 纯函数、零 IO，
                              两半都 import 它。这是全仓**唯一一处「不写两份」的实现**（理由与家规见 §2.7）
presets/cc.patch.yml     ── 补丁层 2：CC 预设的**声明行**（dsh ≥ 0.1.7-alpha.1 唯一认的形态）
presets/cc/              ── CC 预设的目录模板（dsh ≤ 0.1.6-alpha.2，挂载时安装到 <DSH_HOME>/.agent-presets/cc）
cordis.patch.yml         ── 补丁层 1：宿主组合补丁（insert 一个插件行）
tests/*.test.mjs         ── 22 个测试文件、844 项断言；**不随包发布**
dist/*.zip               ── 历史发布包（按版本命名），不是构建产物，不要改
.github/workflows/       ── CI：打 v* tag 自动发 npm（OIDC）+ 建 Release（正文抽自 CHANGELOG.md）
.github/scripts/         ── release-notes.mjs：上面那个 Release 正文/标题的抽取脚本，可本地直接跑
```

三个入口由 `package.json.exports` 固定，改名会同时打断 `dsh` 的挂载与预设行：

| 入口 | 文件 | 谁加载 |
| --- | --- | --- |
| `.` | `lib/index.js` | 宿主组合（`cordis.patch.yml` 的插件行） |
| `./client` | `lib/client.js` | 浏览器（`dsh.client` 声明 → `/plugins/??<包名>/client.js&rev=…`） |
| `./agent` | `lib/agent.js` | 预设行 `@xia-sc/dsh-cc-studio/agent` |

> 包名是 `@xia-sc/dsh-cc-studio`（0.3.2 起，此前叫 `@dsh-plugins/…`；改名见 [CHANGELOG 0.3.2](./CHANGELOG.md)）。scoped 包的 scope 必须归发布者所有（`npm org create` 不存在），再改名时记住要同步 **5 处**：`package.json` 的 `name`、上表三行的加载方，以及 `lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 `id` —— 最后一处是硬约束（`dsh-client-modules` 拿宿主图里的包名精确匹配 `id`，对不上就整个客户端半加载失败）。认函数名 `stripClientSuffix`，别抄行号。

---

## 2. 硬约束（违反了会静默坏掉）

### 2.1 没有构建步骤，写的是「最终产物」

- `lib/*.js` 就是 ESM 源码，直接 `import`；**没有 TypeScript、没有打包器、没有转译**。
- `lib/client.js` 是**手写 bundle**：整文件包在 `window.__ModuleLoader__.load({ id, factory })` 里，`factory` 收到 `require`，只能 `require("react")`（工作区里唯一可用的种子模块），导出 `{ apply, inject, name }`。
  - 必须用 `React.createElement(...)`，**不能写 JSX**。
  - 改完不需要构建，但浏览器**要刷新页面**；`rev` 是内容哈希，改文件后 URL 会变。
- 语言特性按运行时来（Node 22 宿主 / 现代浏览器），但风格是全仓一致的「老派 plain JS」：`var`、`function`、显式 `try{}catch{}` 兜底。**保持一致，不要顺手现代化**。

### 2.2 宿主半的 `inject` 是硬依赖

`lib/index.js` 顶部：

```js
const inject = ["webServer", "connection", "agents", "agentPresets"];
```

`inject` 里的服务在挂载时解析不到，插件会一直等待而不报错；`ctx.get("x")` 是可选读取，必须自己判空。新增依赖时想清楚是**硬依赖**（进 `inject`）还是**可选**（`ctx.get`）。

### 2.3 `connection.rpc.handle()` 对外部插件不可用（dsh ≥ 0.1.5-rc.1）

这是本插件最反直觉的一处，注释写在 `lib/index.js:14-25`。`HostConnectionService.rpc` 用的是 connection 插件**自己的 ctx**（`inject` 只有 `["credentials"]`），`webServer` 在它内层的 `ctx.inject(["webServer"])` 作用域里，owner fiber 永远解析不到 —— 无论调用方 inject 什么，都会抛 `cannot get property "webServer" without inject`。

所以插件**自己注册 HTTP 路由**，替浏览器说同一套 RPC 线协议：

| 项 | 值 |
| --- | --- |
| 通道 | `POST /dsh-cc-studio-rpc/<endpoint>`，`kind: "prefix"` 注册在 `ctx.webServer` 上 |
| 请求体 | `{ type: "client-request", rpcId, method, payload }`，`method` 必须等于 URL 里的 endpoint |
| 响应体 | `{ type: "server-response", rpcId, result: { ok: true, value } \| { ok: false, error: { code, message, details } } }` |
| 鉴权 | 先过 `connection.requestRejection(req)` 围栏（host/origin + 会话 cookie），插件**不能绕过** |
| 命名约束 | channel `/^\/[A-Za-z0-9._~-]+$/`、endpoint 每段 `/^[A-Za-z0-9_$.-]+$/` —— 这两个正则属于 **`dsh-client-connection`**（客户端 `assertTarget` 与 `HostConnectionService.register`），**不是** `webServer.register` 的校验：后者只做重复检测（`dsh-host-webserver lib/index.js:177-184`），什么 path 都收（0.3.7 更正） |
| 体积上限 | `RPC_MAX_BODY_BYTES = 48MB`（PNG ≤20MB、CHARX ≤30MB 的 base64 都走这里） |
| 请求体读取 | 用 `data/end/error` **事件式**（`readBoundedBody`：48MB 上限 + `aborted` 兜底）。⚠️ 别再写「异步迭代 `IncomingMessage` 在本运行时会抛错」—— 0.3.7 实测**不抛**，官方 `/api` 桥自己就在用 `for await`；保持事件式只是因为改它没收益。 |

客户端侧一律走 `ctx.connection.rpc.call("/dsh-cc-studio-rpc", endpoint, { args })`（`lib/client.js` 里有 `rpc()` 包装）。

改协议前先对一遍 `@deepseek-ai/dsh-client-connection` 的 `parseConnectionResponse` / `assertTarget`，它才是唯一权威。

### 2.4 预设的投递方式（两代）与「一行坏掉」的后果

**投递方式按 dsh 版本分两代，两份清单必须逐字同步**：

| dsh 版本 | 载体 | 谁写 |
| --- | --- | --- |
| ≥ `0.1.7-alpha.1` | `presets/cc.patch.yml`：组合里的 `@deepseek-ai/dsh-agent-preset` **声明行**（`config.plugins` 就是那份清单） | 随包补丁层，`package.json` 的 `dsh.bundle.patch` 第 2 层（第 1 层是 `cordis.patch.yml` 的宿主行）；**一个新版 dsh 上不写盘** |
| ≤ `0.1.6-alpha.2` | `presets/cc/agent.cordis.yml`：目录形态，插件挂载时安装到 `<DSH_HOME>/.agent-presets/cc` | `installCcPreset`（见 2.5） |

`presets/cc/agent.cordis.yml` 是**照抄 dsh 内置 `standard` 预设再改**的，`presets/cc.patch.yml` 的 `plugins` 是它的逐行副本（整体 +10 空格缩进），因此：

- dsh 升级若改动了内置预设（改包名、加行、改配置 schema），**两份都要同步** —— 这是历史上最容易坏的地方，见下面第 4 条。`tests/preset-install.test.mjs` 第 12 节按「除注释外逐字一致」钉死两份清单：只改一边会直接测试失败（这是有意的，别把它改宽）。
- 新增行前确认目标 dsh 版本真的装了那个包。**`disabled` 行在两代里都不参与解析**（0.1.6 是 `unresolvableRows` 里 `continue`；0.1.7 是注册表既不 import 也不参与 `auditRows`），所以 `disabled: true` 不会因为包没了而被判死 —— 但**不要**靠 `disabled` 遮掩一个已经不存在的包。
- **一行坏掉的后果**：0.1.6 上整个预设 `broken`（roster 里不可选）；0.1.7 上落在 `record.broken`（roster 里**仍看得到**「CC 模式」，但带诊断且组不出会话）。结论没变：**写错一个包名 = CC 模式不能用**。
- **别再加第三种投递方式**：≥ 0.1.7 的注册表没有文件系统扫描（连 `fs` 都不 import），目录形态写了也没人读（0.3.6 修的正是这个）。行级 `disabled: !!js` 也不能当版本闸门：它在建树时只求值一次，那时 `ctx.get('agentPresets')` 还没起来；抛异常的表达式会被启动审计当成**失败的 entry**。
- 预设里 `cordis:group` / `isolate` 的用法有解释性注释，别删。

### 2.5 旧版（≤ 0.1.6-alpha.2）的目录安装：绝不静默覆盖用户改动

> dsh ≥ `0.1.7-alpha.1` 上这套安装**自动让位**：`supportsDeclaredPresets(ctx)` 命中就返回 `status: "native"`，一个字都不写（新版关 CC 模式是在 profile 补丁层里关掉 `preset-cc` 那一行）。检测**判窄不判宽**：误判 false 只是白写一次死目录，误判 true 才会真的少一个预设。⚠️ 判据里的两个方法必须是 **AND，不许简化成任何一个**：0.1.6 的 `dsh-agent-presets` **也有** `compositionInventory`（单看它会把老版误判成新版、CC 模式在 0.1.6 上直接消失），`register(definition)` 才是 0.1.7 新注册表独有。

`lib/index.js` 的 `planPresetInstall` 是纯决策函数，规则与测试一一对应：

| 目标文件 | 有安装记录(`.dsh-cc-studio-preset.json`)且 hash 匹配 | 决策 |
| --- | --- | --- |
| 不存在 | — | 写入 |
| 与模板一致 | — | 不动 |
| 与记录 hash 一致（我们写的、用户没改） | 是 | 安全更新 |
| 既非模板也非记录（用户改过 / 历史手工拷贝） | 否 | **跳过 + 告警**，且**不把该文件写进记录** |

开关：环境变量 `DSH_CC_STUDIO_PRESET_INSTALL` = `auto`(默认)/`force`/`off`，插件行 `config.presetInstall` 优先。受管文件只有 `PRESET_MANAGED_FILES = ["preset.yml", "agent.cordis.yml"]`。卸载插件**不删除**已安装的预设。

改这块时：**不变量比功能更重要** —— 「用户没改过的才更新」和「记录里不声明被跳过的用户文件」两条都有测试钉住，破坏它们就会在某台机器上吃掉用户的预设。

### 2.6 落盘根与测试隔离

**落盘根只有一套**（0.3.6 起）：`dataRoots(sub)` 返回 `[主根, 旧根]` —— 主根 = `DSH_HOME`（优先，`trim` 后非空）或 `homedir()/.dsh`，旧根 = `homedir()/.dsh`；两者路径相同时**去重成一条**。草稿（`cc-drafts/`）、角色库（`cc-library/`）、人物关系分组（`cc-groups/`）、组级共享世界书（`cc-books/`）、预设（`.agent-presets/`）全走它：**写盘只写 `candidates[0]`，读盘依次回退**（老用户升级后不会「数据没了」）。宿主半与预设半各有一份同构实现，`tests/data-root.test.mjs` 钉死「两半路径一致」+「源码里不许再出现写死的 `homedir()/.dsh/cc-*`」。

⚠️ 任何会触发 `apply()`、或读写草稿/角色库的测试，**三个变量一起隔离**（`DSH_HOME` + `HOME` + `USERPROFILE`）：只隔离 `DSH_HOME` 时写盘在沙箱里，但**读盘会回退 `homedir()/.dsh`**，隔离环境照样读到真实用户的卡（0.3.6 之前更糟：直接往真实目录写）。`tests/rpc-channel.test.mjs` / `tests/data-root.test.mjs` 都照这个模式，且跑完校验真实目录未被改动。

### 2.7 卡组层：口径与体检只有一份（0.10.0）

**「卡组」= 人物关系分组（`cc-groups/`）+ 组级共享世界书（`cc-books/`）+ 库条目 `meta.groupId`。** 这三样数据的**读取、统计与体检**全部收在 `lib/group-layer.js`：**纯函数、零 IO、零环境变量，`lib/index.js` 与 `lib/agent.js` 都 import 它**。这是全仓唯一一处「不写两份」的实现 —— 也是「两半同构」（§2.6 / §5）唯一的例外。理由：0.9.x 的两轮补丁都打在同一个地方（共享世界上线后，simulate / lint / group_check / preview_export / validate 五个工具各自补一遍「把共享书算进来」，连着两轮「改了四个、漏了第五个」）；根因不是手滑，而是**同一个语义存在多份实现**。真正需要两份的只有落盘根与读盘（各自的 `DSH_HOME` 解析），不是统计与判定。

三条家规（`tests/group-layer-guard.test.mjs` 逐条钉住，失败信息里写着该走哪条路）：

1. **取卡组数据只走 `groupScope()`**（两半各有一份 IO 编排，纯组装共用 `assembleScope()`）：`{ groupId?|cardId?|sessionKey?, include?, maxCards?, snapshot? }` → `{ group, members[], memberIds, book, missing, truncated }`。工具里**不许**再出现 `readBookRaw` / `normalizeBook` / `groupMemberIds` 自己拼一套（`sharedBookScopeFor` 只是它的薄包装，保留旧返回形状）。`readLibrarySnapshot()` 一次遍历 + 一次 parse 拿到 meta 与 draft，`listLibraryEntries()` / `libraryCardsFor()` / `bookCardsFor()` 都是它的视图 —— 组体检的读盘因此从 `1+2N` 降到 `1+N`。
2. **任何「多少条 / 多少 token」只从 `groupMetrics()` 取**：五段（`card` / `members.byId` / `members.total` / `book` / `all`）+ `derived`（群聊固定开销 `groupConstant`、最坏情况 `worstCase`、跨卡重复触发词 `duplicateKeys`、组内五维漂移 `worldDrift`）。`lorebookMetrics(card, shared)` 是它的薄包装（旧签名输出逐字不变），`auditLoreEntries` / `worstCaseTrigger` / `scanSharedEntries` / `estimateTokens` / `contentKeyOf` / `REL_*` / `isAutoEntry` 也都在这里 —— 两半里再抄一份就回到「改了四个、漏了第五个」。
3. **卡组的下一个新功能 = 往 `GROUP_CHECKS` 加一项**：现有五个类别 `structure` / `relations` / `budget` / `lore-quality` / `cross-card`，每个 code 只归属一个类别。issue 形状固定 `{check, level, code, message, refs, contentKeys?}`，数量由 `byCheck` 汇总；`checkGroup(group, members, cards, sharedEntries, opts)` 是 6 行薄包装（以前是 48 行 if 序列），传入 `opts.scope` / `opts.metrics` 才会跑跨卡检查。工具里**不许**自己 `issues.push` 体检结论、也不许把 code 字符串散到别处。

`include:"summary"`（默认）不回条目正文；`maxCards` 默认 50、超限置 `truncated`；组文件缺失时**不提前返回**（成员与共享书照样读出来，`ok:false` 只表示组本身不在）—— 旧 `sharedBookScopeFor` 从不看组文件，早退会让「组没了、书还在」的卡突然看不到自己的书。客户端**只显示**宿主返回的 `issues` / `byCheck`，不参与任何统计。

---

## 3. 四个文件的分工（三个入口 + 一个共用的卡组层）

### 3.1 `lib/index.js`（宿主）

- **RPC 端点**：`validate` / `ping` / `cc_isCcMode` / `cc_getDraft` / `cc_setDraft` / `cc_patchDraft` / `cc_validateDraft` / `cc_migrateDraft` / `cc_listLibrary` / `cc_saveToLibrary` / `cc_loadFromLibrary` / `cc_deleteFromLibrary` / `cc_renameInLibrary` / `cc_getLibraryEntry` / `cc_setOrigin` / `cc_importFromJson` / `cc_importFromPng` / `cc_exportPng` / `cc_importFromCharx` / `cc_exportCharx`。未知端点返回 **200 + 失败帧**（`details.code = "unknown-endpoint"`），不是 404。**三条导入路径（JSON/PNG/CHARX）都走 `normalizeDraft` → `upgradeCardToV3`**，返回里带 `upgradedFrom`（V2/V1 卡自动升级，非静默——界面会显示）；`cc_setDraft` **故意不升级**（它是工坊自己那份草稿的镜像，静默变换会让两边不一致）。
- **草稿槽 key 的不变量**（issue #5 的教训）：同一会话里 **Tools 与浏览器必须算出同一把 key**。Tools 侧是 `exec.agent.session.id`；浏览器侧**必须显式把会话 id 传进来**（RPC 是 HTTP 处理函数，`agents.currentInitiator()` 在那里恒为空 → 回退成 `"default"` → 「模型写 `session-<id>`、工坊读 `default`」两槽并存）。回退时 `source` 如实报 `fallback`（`keySource`），前端据此**不渲染**该槽并告警。新增读写草稿的端点一律走 `draftKeyFrom(ctx, args)`，别自己拼 key。
- **草稿持久化**：`<主根>/cc-drafts/<session>.json`（`draftDir()` = `dataRoots("cc-drafts")[0]`；读盘经 `findDraftPath()` 回退旧根）。变更即落盘，**内存 miss 时不静默建空**（告警 + 提示恢复）。文件名 `safe(key)-<hash>.json`；`listDraftSlotsOnDisk()` 扫两个根、按文件名去重，用于「当前槽是空壳」时的救回提示。
- **草稿槽迁移**：`cc_migrateDraft({ from, to?, overwrite? })` + 纯决策函数 `migrateDraftDecision`。目标槽非空**必须显式 `overwrite: true`**（绝不静默覆盖，同 2.5 家规）；候选槽只报「错位真正会牵涉到的另一把」，别把所有会话的槽当噪音端给用户。
- **角色库**：`<主根>/cc-library/<id>.json`。读经 `readLibraryRaw(id)` 回退旧根；`listLibraryEntries` 并集去重（主根优先）；**`deleteLibraryEntry` 会把两个根里的同名副本都删**（否则回退读会把刚删的卡「复活」）；`renameLibraryEntry` 就地写在解析到的那一份上，不搬家。
- **容器互通**：PNG 的 `tEXt` `ccv3` 块（自带 CRC32/deflate）、CHARX（ZIP + `card.json`）。
- **预设安装**：见 2.5。

### 3.2 `lib/agent.js`（预设半）

- `inject` 是 `["tools", "agents"]`，用 `ctx.tools.register({ name, description, parameters, execute })` 注册 **32 个** Tool。
- **返回契约（0.5.0 起，动工具前先看这条）**：一次返回里同一个状态只出现一份 —— 顶层**不许**再放 `next` / `hint` / `notice` / `warning` 副本，只留 `workflow`（`next` / `hint` / `step` / `readyToValidate` / 三态 `state{character,world,lore,greetings}` / `loreCount` / `manualLoreCount`）+ `message`（给用户看的中文）+ 可选 `warnings[]`。patch 类默认只回 `changed` 字段名（`verbose:true` 才回整份 draft）；`cc_get_card` 支持 `fields`，`cc_load_from_library` / `cc_get_library_entry` 支持 `includeDraft:false`。**`tests/tools-contract.test.mjs` 会把顶层出现这四类副本直接判失败**。
- **世界书完成态 = ≥5 条且 ≥1 条共创条目**（`!isAutoEntry(e)`）：autoLorebook 生成的条目带 `cc_auto` 标记、**不算共创** —— 否则 auto 一次生成 5 条就把第 4 步「必调」的共创顶掉（LLM 侧实测的卡壳点）。`cc_patch_world` 的 `loreKeys` 是模型自报的触发词；缺省时 keys 只有「维度名 + 英文维度名」并会在 `warnings` 里警告。
- **草稿来源 id（sidecar）**：`cc-drafts/<key>.origin.json` 记「这份草稿是从哪张已存卡载入的」，两半同构（`readDraftOrigin` / `writeDraftOrigin` ↔ `readOriginSync` / `writeOriginSync`）。保存不传 id 时沿用它 —— 这是 P0-4「载入后保存产生重复卡」的修法；**清空草稿 / `cc_new_card` / 删除来源卡时必须清掉它**，否则会去更新一张不该动的卡。
- **草稿身份与版本（0.6.0 + 0.7.0）**：写类工具返回**必须**带 `cardName` / `cardId`（未关联已存卡时 `null`），`draftStatus` 用 **`sessionKey`**（**不再是 `key`** —— 那只是会话槽标识，LLM 曾把它当草稿身份、在草稿被换掉后误伤了另一张卡）并带 `cardId` / `cardName` / `rev`。`rev` 落在**草稿文件**里（两半同构、每次写 +1，是跨进程唯一真相）：**盘上 rev 与本次调用前记着的不一致 = 别人改过**，`getDraft()` 以盘为准重载并回 `revDrift:{from,to}`（**不传 `expectedRev` 也生效**，给弱模型的兜底）；传了 `expectedRev` 不匹配则直接拒绝（`staleRev`）。**空改动不落盘、不涨 rev**（指纹忽略 `modification_date`，两半同构）。新草稿提示走 `meta.pendingFresh`（只有「内存与磁盘都没有草稿」才是 `"welcome"`）。**这些全由 `apply()` 里的 `tool()` 包装统一收口**，别再往单个工具里塞身份字段或自己拼提示。细节见 [CHANGELOG 0.6.0 / 0.7.0](./CHANGELOG.md)。
- **人物关系图谱（0.8.0）**：CCv3 没有关系字段，所以关系**只活在插件侧**（`<DSH_HOME>/cc-groups/<id>.json`；两半同构的纯函数 + 落盘，`tests/relations.test.mjs` 逐字比对两半渲染输出与落盘根）。三维 = 方向 × 类型 × 强度；节点分 `kind:"card"`（绑 cardId）与 `kind:"npc"`（卡内 NPC，没有自己的卡）；「卡属于哪个组」记在库条目 `meta.groupId`（**单一真源**，分组文件里刻意不存成员列表 —— 成员由库条目派生，删卡/移组天然一致）。渲染进 description 的 `<!-- cc-relations:begin … -->` 标记区：**显式动作**、幂等替换、空图谱 = 清空该段、`dryRun` 可预览。三条硬规矩：分组乐观锁参数叫 **`expectedGroupRev`**（别用 `expectedRev` —— 那是草稿层的锁，会抢先拦截且文案误导）；删卡只把节点降级为 orphan（**保留边** —— 关系是用户资产）、改名同步节点名；**`outgoingEdgesOf(myNodeId, edges)` 是出边的唯一口径**（渲染与计数共用）。细节见 [CHANGELOG 0.8.0](./CHANGELOG.md)。
- **分组管理（0.8.0，23 → 28 个工具）**：`cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group`（理由：真正高频用这套工具的是**模型**，而它此前改不了「哪张卡属于哪个组」）。必须保持：① 入组自动补节点，且 `assignCardToGroup(cardId, groupId)` 是**两半共用的一份实现**（宿主端点也调它 —— 别再各写一套）；② 移出**不删节点与边**、删组**不删卡**（只清成员 `meta.groupId`）；③ 卡删掉后同名回来要**复活原 orphan 节点**，不新建第二个同名节点；④ 建组/改名**查重**（`findGroupByName`，同名拒绝并回 `existingGroupId`，`allowDuplicate:true` 才放行）；⑤ `cc_delete_group` **必须 `confirm:true`**（不带只回盘点）；⑥ 无实际改动不写盘（同 N4 家规）。
- **组级共享世界书（0.9.0，28 → 32 个工具）**：`<主根>/cc-books/<groupId>.json`，**一组一本**、整组共用；条目与卡内 `character_book.entries` **完全同构**。必须保持：① 文件**本身就是** CCv3 独立 lorebook（`{spec:"lorebook_v3", data}`），插件状态放 `data.extensions.cc`（rev/groupId）。② `makeBookEntry` / `normalizeBook` **只补缺、不裁剪**（未知字段与 `cc_auto` / `id` / `priority` 都必须原样保留）。③ 提升默认 `dryRun`、`apply:true` 才动手，且只删**内容逐字相符**的条目（签名只用来筛，动手前再比对内容）；书级乐观锁叫 **`expectedBookRev`**。④ 删组时书一起删（`deleteBook`）。⑤ 导出以独立文件为主 + 可选并入卡，**并入只做在导出副本上**。⑥ **提升之后必须同步草稿**：工具侧 `syncDraftAfterPromote`（认 `origin.json`）与界面侧（认 `currentLibraryId`）**同一套判据** —— 只删「共享书里已有且内容逐字相符」的条目，不适用就**不猜**，改在返回里给 `draftSync` + `warnings`；⚠️ 读草稿与写草稿之间**不许有 await**。⑦ **口径必须与共享书一致**：完成度看**合计**（`loreCount`/`manualLoreCount` 是卡内，`sharedLoreCount`/`loreTotal` 另报），**判定完成度一律走 `workflowFor(ctx, exec, draft)`**（13 处已统一）。⑧ **重复分两类**：`scanSharedEntries` 既报卡间重复（`candidates`，动作 = 提升）也报「卡内 vs 共享书」（`bookDupes`，动作 = **只清理卡内副本**）；promote 的 `wouldPromote` / `wouldClean` / `cleaned` 就这么分。⑨ 新书默认名走 `newBookFor` → `defaultBookName`（`<组名>·共享设定`，两半同构）。⑩ **`constant` / `@@decorator` 是「整本世界书」的存在性检查**，走合计口径 —— 口径收口在卡组层的 **`groupMetrics()`**（`lorebookMetrics(cardEntries, sharedEntries)` 只是它的薄包装、旧签名输出逐字不变；**改口径只动 `lib/group-layer.js` 一处**，见 §2.7）；**逐条质量**收口在 **`auditLoreEntries([{source, entries}])`**（死 keys / 只有维度名 / keys 与正文无交集 / 触发词冲突）：`cc_lint_lorebook` 对**卡内 + 共享书**各跑一遍、issue 带 `code`/`contentKeys`/`source`，`cc_get_shared_book` 用同一个函数报「这本书」自己的问题；⚠️ **`cc_validate` 有意只查卡内**（它是「这张卡」的收尾判定）。**别把分工写成既成事实**：上一版写过「共享书质量走 `cc_get_shared_book`」，而那条线上当时只有重复检测 —— 共享书于是成了没人体检的一格，可它恰恰多卡共用、又没有「卡」这个载体。细节见 [CHANGELOG 0.9.0](./CHANGELOG.md)。
⑪ **导出有两种形态，各有各的读者（0.9.1 用户实机修的）**：CCv3 官方独立 lorebook（`{spec:"lorebook_v3", data}`，`.lorebook.json`）给认这个规范的客户端；**SillyTavern 只认它自己的 `{entries:{…}}`** —— ST 服务端 `/api/worldinfo/import` 第一句就是 `if (!('entries' in worldContent)) throw`（拖 CCv3 那份进去实测 **400 Bad Request**、不落盘），ST 客户端 `importWorldInfo()` 也只转 Novel / Agnai / Risu，整份 `world-info.js` 里搜不到 `lorebook_v3`。所以共享书页与导出页各有两枚按钮：`store.exportBookFile`（CCv3）/ `store.exportBookStFile`（ST，走纯函数 `bookToStWorldInfo` → `bookEntryToSt`：字段照抄 ST 的 `convertCharacterBook()`，`@@position` / `@@depth` 翻成 ST 的 `position` / `depth` 并**删掉该行** —— ST 的 `parseDecorators()` 只认 `@@activate` / `@@dont_activate`，其余 `@@` 行会连同正文一起被丢掉；`@@activate` 与未知装饰器原样留给 ST；文件名 = 书名，因为 ST 拿**上传文件名**当世界名）。**别把两种形态合并成一个文件**：CCv3 校验器未必容多出来的顶层键、ST 又只认顶层 `entries`，合并出来两头不讨好。
⑫ **卡片侧的 ST 兼容层（0.9.1，规范原文对着做的）**：PNG 里 `ccv3` 是规范 MUST、`chara` 是「MAY 用来回填 V2」，两者都在时读取方 **SHOULD 用 `ccv3`** —— 所以 `pngCardChunks()` **两个块都写**（顺序 `chara` → `ccv3`，与 ST 一致）：`ccv3` 是原卡一个字节不改，`chara` 是 `stV2Projection()` 的**诚实 V2 卡**（只留 V2 字段集；按规范「回填 V2 要移除装饰器」摘掉条目正文开头的 `@@` 行）。`extractCardFromPngBytes()` 必须**按载荷里的 `spec` 判、优先 V3**（块名与顺序都不作数）—— 曾经的「取第一个命中的块」会把 ST 导出的 PNG（`chara` 在前、是 V2）读成 spec 不符。导出 PNG/CHARX/JSON 时用 `withStWorld(card, 书名)` 在**导出副本**上写 `data.extensions.world`（ST 的角色↔世界书绑定就是这个名字；没共享书就不写），草稿与库里的卡一个字节都不动。⚠️ **不要学 ST 往卡片顶层塞 V1 平铺字段**：规范同节写着应用 MUST follow the specification、私有数据只能进 `extensions`（`tests/st-compat.test.mjs` 钉住顶层键恰为 `spec, spec_version, data`）。
⑬ **V2/V1 卡**升级**导入（0.9.1 B2）**：ST 里绝大多数存量卡是 V2（ST 只把 `spec` 改写成 v3 标签），工坊以前只收 `chara_card_v3`，于是拖进来只会得到「spec 不符」。现在 `upgradeCardToV3(obj)` 是**唯一一份**升级实现（PNG / CHARX / JSON 三条导入路径共用，规则照 ST 的 `readFromV2()`：顶层 V1 平铺字段只在 `data` 缺值时补、`creatorcomment`→`creator_notes`、`talkativeness`/`fav`→`data.extensions`、纯 V1 整份包成 `data`），返回 `{card, from}`，`from` 一路报到界面（「V2 卡已升级为 CCv3」，`store.importedUpgraded`）。**JSON 导入也收口到宿主**（`cc_importFromJson`）：客户端以前自己 parse 且只认 v3，现在只负责把文本递过去 —— 客户端的 `errNotCcJson` / `errSpecMismatch` / `errNoData` 三个键已删。⚠️ 升级是**深拷贝**（不改调用方对象）；不是卡片时抛「不是可识别的卡片（没有名称）」而不是静默造空卡。
- **两个静默丢数据的坑（0.8.0 顺手修，别再犯）**：**B4** 库条目 meta 两半曾经漂移（宿主继承 `meta.groupId`、工具半没这个字段），于是「工具侧保存一次，卡就静默退组」且**零提示** —— **给库条目 meta 加字段时两半一起加**。**B5** `mutual`（对等）边曾经**完全不渲染**（出边只认 `from === 我`、入边又排除 mutual）；现在出边只有 `outgoingEdgesOf(myNodeId, edges)` 一处实现，**渲染与 outgoing 计数共用它**，否则会出现「预览说 N 条、实际写 M 条」。见 [CHANGELOG 0.8.0](./CHANGELOG.md)。
- **成本可见性（0.7.0，N2）**：世界书的「总量」与「单次触发」是两个独立风险 —— content 常是五维原文照搬，一条实体词被多个维度共用时**一句话就能吃满整份预算**，而调大 `token_budget` 会把告警一并消掉（假装修好）。所以 `cc_lint_lorebook` 必须报 **`worstCase`**（共享触发词条目并查集成组 + 每轮必插的 constant，取最大组），`cc_patch_world` 写入时就报 **`sharedLoreKeys`** 与 **`heavyAutoEntries`** —— 别把这三项弄丢。
- **返回值的 JSON 卫生（0.7.1，B1）**：DSH 对工具返回值做 lossless-JSON 校验，**任何嵌套 `undefined` / `NaN` / `-0` 都会让整次调用直接报错**（用户看到的是「工具坏了」）。三条必须保持：① 草稿从磁盘恢复 / 重载走 `normalizeCardShape()`（两半同构，按空卡模板补缺，只补 `undefined`、不覆盖已有值、不改类型）；② `draftStatus.creation_date` 显式兜底 `null`；③ `tool()` 包装在返回前统一 `sanitizeJson()`。**新增字段先问一句「老草稿里没有它，会漏出 undefined 吗」**；`changed` 一律用 `assignIfChanged()`（与 `rev` 同一套判据）。另：每个返回都带 `draftStatus.watchedRev`（本次调用前记着的盘上版本）与 `build`（与 `package.json` 同步，测试 ⑪i 钉住）。
- 与宿主半**共享同一份草稿文件**（同一套解析/落盘逻辑），所以两边对「多段问候语」「空数组」的处理必须一致。
- 与宿主半**共享同一套落盘根**：`dataRoots()` / `safeDraftFile()` 在两边各有一份同构实现，必须算出同一个路径 —— 否则又会退化成 issue #5 那种「模型写一处、工坊读另一处」。`tests/data-root.test.mjs` 直接比对两半的输出。
- 强制工作流：`cc_get_card → cc_patch_character → cc_patch_world → cc_add_lorebook_entries → cc_patch_greetings → cc_validate`；`GREETING_MAX = 10` 与宿主截断点必须保持一致（有跨文件测试）。

### 3.3 `lib/client.js`（浏览器）

- 挂载点（`ctx.slots.inject` + `ctx.slots.register`，都带 `locale: NS`）：
  - `conversation.input.dock` → `Capsule`（会话域；CC 模式下常驻）
  - `shell.overlay` → `Workshop`（根域；全屏/侧边工坊）
  - `settings.section` → `SettingsView`（设置页「角色卡工坊」）
- **CC 模式探测**只有一份实现：`useCcPreset()`，优先级 **① 会话投影（`ccSessionIdOfProps(props)` 取到的会话 id 去 `useSessions().byId[id].projectionValues.agentPreset`）→ ② 预设芯片 DOM（`button[aria-haspopup="menu"]`）→ ③ 主机 RPC**，新会话页另有 1s 本地轮询兜底。**别再写第二份探测**（`tests/cc-detection.test.mjs` 有源码级守卫）。
  - **`SessionListState` 没有 `current`**（字段集已经改过两轮：`ids` / `byId` / `phase`，0.1.7 又加了 `projectionsBySession`）—— 本插件只准读这三个。会话 id 只能从 slot props 取：`props.sessionId` → `props.session.sessionId` → 对象兜底（用 `current` 会让投影权威失效，issue #5）。
  - **两个挂载点共用一份 `store`**：`Capsule` 在会话域（有会话 id），`Workshop` 在根域（`shell.overlay`，**拿不到会话 id**）。根域实例只准把结论改成「是」，**不准写 `false`**（否则它每秒的 `evaluate()` 会把会话域刚判定的状态清掉，胶囊一闪一闪）。
  - **草稿槽 key 只能来自这个会话 id**：`pullDraft` 没有 key 就一次都不发（不许拿 `default` 顶替），节流按 key、切会话后回来的响应丢弃、主机回的 `key` 与点名的 key 不一致时不渲染只告警。`default` 槽只是「没有会话上下文」时的回退，**不是**当前会话的草稿。
- 状态在 `store`（`createStore` + `subscribe/getSnapshot`）；设置存 `localStorage:dsh-cc-studio-settings`。
- i18n：文件内 `zh` / `en` 两张表（**各 314 键**，两边键集必须一致），`ctx.locale.register(NS, { zh, en })`，`t = ctx.locale.bind(NS)`。**UI 层不得出现中文字面量**（有守卫测试），新增文案必须同时进 `zh` 和 `en`，并保持 `{n}` 之类的占位符一致。
- 工坊排版（0.4.0 重构）：三列 `200px 1fr 268px`（导航 / 阅读区 / 已存角色，右侧可折叠成 40px 竖条）；原右侧 360px 栏与「融合说明」块已删，实时 CCv3 预览与 CBS 速查改走主区底部 `foldPanel()`（默认全收起）。字段统一走 `field(title, key, opts)`（小号标签 + ⛶ + 无边框控件；`S.readText` 用 `field-sizing:content` 撑高），长文大框走 `setEditingText` 的快照回滚。旧的 `S.card` / `S.field` / `S.mono` / `S.side` 已删。工具条右侧是 **✕ 图标按钮**（30×30，`title`/`aria-label` 取 `action.close`；默认描边、**悬停红底白字 `#e05555`**、hover 走局部 `hoverKey` 不写 store、按下 `stopFocusSteal` 不抢焦点）。
- 导出入口（0.4.1 归一）：**导出动作只有一套实现**（`store.exportJSON / exportPNG / embedIntoPng / exportCharx`，都长在导出页 `s.cur === 3`），入口只剩两处 —— 左下角那枚（文案键 `step.export`）与已存角色卡片上的「导出」。顶部工具条的「导出 JSON」已删；卡片「导出」只 `store.setCur(3)`，**既不载入也不下载**（旁路 `exportLibraryEntry` 已删）。导出页导出的**永远是工坊里那张卡**（页内 `workshop.export.currentHint` 写明，标题挂卡名）；从卡片跳进来时按钮自己先变（`workshop.library.exportJumped`，6s 后复原）+ 页内琥珀提示（`workshop.export.jumpedOther`）。左下角入口**不做选中态**（曾经与卡片反馈同时发亮 → 「两处看起来像选中」的坑，别再犯）。导航与胶囊都只有 **3 个写作步骤**，`s.cur === 3` 是「不在导航里的第 4 个视图」，页内那枚 `action.validate` 就是全部校验入口。
- **关系视图（`s.cur === 4`）读的是宿主半 `cc_getGroup` 的返回**：`{ group, members, rev }` —— 节点与边在 `group` **里面**（`group.nodes` / `group.edges`），顶层只有 `members` 与 `rev`。⚠️ 曾经按工具半 `cc_get_relations` 的形状去读顶层，于是界面**永远**显示「关系 · 0」、NPC 区空白（实机截图报的就是这个）。改它时形状两头夹着：**渲染级** `tests/relations-view.test.mjs`（假 React harness）+ **RPC 级** `tests/rpc-channel.test.mjs`。
- 破坏性动作（目前只有「清空当前角色卡」）：状态复位在 `store.clearDraft()`（换 `makeDraft()` 空卡 + 清 `world` / `valid` / 大框编辑态 + **`currentLibraryId` 置空**），二次确认在按钮侧（`confirmClear(t)` 包 `window.confirm`）—— **拿不到确认框一律不动数据**。清空同样落盘。

---

## 4. 版本兼容（本项目最容易坏的地方）

**只有实测过的版本才写进 `dsh.compatibility.dshReleases`**（精确 SemVer 键）；没测过的一律不写，也不拿「同一个窗口」去凑。

| dsh 版本 | 状态 | 为什么还记着它 |
| --- | --- | --- |
| ≤ `0.1.6-alpha.2`（含 `0.1.5-rc.*` / `0.1.6-alpha.1`） | 正常 | **预设走目录形态**（`<DSH_HOME>/.agent-presets/<id>/`，`installCcPreset` 安装）—— 两份清单里的 `presets/cc/agent.cordis.yml` 就是为它们留的；`0.1.6-alpha.1` 上预设行必须是 `workflow-ptc`（写成 `workflow-worker-thread` 会让整个预设 broken）。细节见 [CHANGELOG 0.2.22 / 0.3.1 / 0.3.4](./CHANGELOG.md) |
| `0.1.7-alpha.1` | 正常（0.3.6 起） | **预设机制换代**：目录形态整体下线（新注册表连 `fs` 都不 import，扫目录没有读者），改由组合里的 `@deepseek-ai/dsh-agent-preset` 声明行投递 —— 这就是 `presets/cc.patch.yml` 存在的理由。见 [CHANGELOG 0.3.6](./CHANGELOG.md) |
| `0.1.7-rc.1` | 正常 | **接口面无变化，无需适配**（RPC 线协议 / 三个 slot / `tools.register` / `inject` 四个服务都没动）。见 [CHANGELOG 0.3.7](./CHANGELOG.md) |
| `0.2.0-rc.2` | 正常 | **接口面无变化，无需适配**；也是商城 latest-three 窗口里那条精确 `compatible`。⚠️ 信封的 `payload` 只认 `payload.args`。见 [CHANGELOG 0.3.8](./CHANGELOG.md) |
| `0.1.7-alpha.2` / `0.1.7-rc.2` / `0.2.0-rc.1` / `0.2.1-alpha.1` | **未实测** | 不许写进矩阵 |

**实测手法（可复用）**：宿主半——未知路径 404/405 vs 插件路由 401（证明路由确实注册、围栏是插件自己调的）；客户端半——Client Inspect 读活页面的 Slot 台账（三个挂载点 `active` 且 registrant = 包名）；预设半——隔离 harness 里按 `tools.register` 契约挂 `lib/agent.js`，roster 用活宿主的官方 Remote（`POST /api/agentPresets/list`、`POST /api/pluginInventory/list`，cookie 由 `/?token=…` 换）。

**升级时最便宜的第一刀**：`dsh --profile <名字> --dump-config` —— 只打印组合、不 mount、不起服务，层注释 `# == <包名>` 下面就能确认声明行有没有被组合进来。启动 `dsh web` 的正确形式是 `dsh --profile <名字> --no-open --port <端口>`，**不写 `web` 位置参数**。插件 `info` 日志默认不落 stdout，别拿它当安装判据。

**新增/升级 dsh 版本时的清单**：① `npm pack` 拉目标版本的相关包；② diff `dsh-host-webserver` / `dsh-client-connection` / `dsh-client-ui-conversation|layout|settings-general` / `dsh-tools` / `dsh-agent` **以及预设那一块**（≤0.1.6 是 `dsh-agent-presets`，≥0.1.7 是 `dsh-agent-preset` + `dsh-agent-preset-registry`）；③ 确认预设怎么投递（搜 `discoverPresets` / 正则 `\.agent-presets`）；④ 与目标版本内置的 `standard`（≥0.1.7 在 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`）逐行对一遍两份清单；⑤ 隔离环境实测（§6），不要只看代码。

---

## 5. 日常改动规则

- **改任何 bug 都要补回归测试**，并在 `CHANGELOG.md` 顶部写一条：**现象 → 根因 → 修法 → 生效方式**（重启 `dsh web` / 刷新页面 / 两者），这是本仓库既有的写法，照抄。
- **改预设行必须同时改两处**：`presets/cc/agent.cordis.yml`（≤0.1.6 目录形态）与 `presets/cc.patch.yml` 的 `plugins`（≥0.1.7 声明行）。`tests/preset-install.test.mjs` 第 12 节按「除注释外逐字一致」校验，只改一边会红（见 2.4）。
- **改落盘路径必须两半同步**：`dataRoots()` / `safeDraftFile()` 在 `lib/index.js` 与 `lib/agent.js` 各有一份同构实现；`tests/data-root.test.mjs` 校验两半输出一致 + 源码里不再有写死的 `homedir()/.dsh/cc-*`（见 2.6）。
- **卡组相关（分组 / 共享书 / 组体检 / 组统计）的改动只动 `lib/group-layer.js`**：取数据走 `groupScope`、取数字走 `groupMetrics`、加检查往 `GROUP_CHECKS` 加一项 —— 别再往工具里塞 `readBookRaw` / 自己的 `for` 求和 / 自己 `issues.push` 体检结论（见 §2.7；`tests/group-layer-guard.test.mjs` 会拦下来）。**唯一仍需两半同步的是 IO**（`readLibrarySnapshot` / `groupScope` 的读盘编排 / 落盘根）。
- `package.json` 的 `version`、`README`/`README_EN` 里的「当前版本」、`CHANGELOG.md` 顶部小节三者同步。
- **改 manifest 的上架契约字段要同步测试**：`tests/preset-install.test.mjs` 钉住 DSH STORE 的「声明类」门禁 —— `repository` 规范化后必须等于 canonical 仓库、`engines.node` 必须存在、`dsh.compatibility.dshReleases` 的键必须是**完整 SemVer**且只写**实测过**的版本、零 `dependencies` / `optionalDependencies`、无 `preinstall`/`install`/`postinstall`/`prepare`、`files` 非空、`lib/index.js` 与 `lib/agent.js` 只 import `node:` 与相对路径。权限信号（files / credentials）是本插件的核心功能，**不要为了商城的自动扫描去改运行时代码**（见 §7 第 10–11 条）。
- `files` 决定发布内容（`lib` / `cordis.patch.yml` / `presets`）；`tests/` **不进包**，所以测试可以随便依赖仓库内路径。`README.md` 与 `LICENSE` 由 npm 强制带上；`README_EN.md` **不在** `files` 里，因此不进包（npm 页面也只渲染 `README.md`）。
- **发布走 CI（默认）**：打 `v*` tag → `.github/workflows/publish.yml` 跑 `npm test` → `npm publish --provenance` → 建 GitHub Release（正文/标题由 `.github/scripts/release-notes.mjs` 从 CHANGELOG 该版本小节抽取 —— **顶部小节没写好，Release 正文就退化成占位**）。发版三步：① 同步版本四处（`package.json` / `README.md` / `README_EN.md` / `CHANGELOG.md`）② commit ③ `git tag -a vX.Y.Z -m "…" && git push origin master --follow-tags`。
  - 版本守卫在 `tag ≠ package.json.version` 时直接 fail（专拦手滑）。
  - 认证是 npm OIDC trusted publishing（**无密钥**）：job 级 `id-token: write`、运行器 npm ≥ 11.5.1、npm 侧登记的 workflow 文件名与 `.github/workflows/publish.yml` **逐字符一致**。报 `ENEEDAUTH`/`401` 基本就是这三条。
  - 手动备用：`npm publish`（`publishConfig.access` 已固化；`prepublishOnly` 先跑 `npm test`）；2FA 是 `auth-and-writes`，会走一次浏览器授权（`PUT 401` → 授权 → `PUT 200`）属正常；scope 要与 `npm whoami` 一致。
  - **发布后有传播延迟，别误判成失败**：CLI 打印 `+ 包名@版本` 时已经成功；`npm view` 约 1 分钟、tarball 约 3 分钟后才可见。**以 Actions 日志的 `+ …@x.y.z` / `Signed provenance statement` / sigstore 行和 `dist.attestations` 为准**，别重发（会撞 `cannot publish over the previously published versions`）。也**别拿 `--dry-run` 验证 OIDC**（它不做认证）。
- 中文注释是本仓库的叙事传统（解释「为什么」，尤其是踩过的坑），保留和沿用，别把它们删掉换成英文。
- 不要动 `dist/*.zip`；发布包是手工归档的历史版本。

---

## 6. 本地验证

```bash
npm test          # 22 个文件：57 + 79 + 51 + 62 + 18 + 23 + 20 + 31 + 14 + 97 + 69 + 20 + 67 + 36 + 52 + 6 + 24 + 25 + 22 + 18 + 16 + 37 = 844 项断言，全绿才算过
```

测试只跑纯函数与源码级守卫（不启动 dsh、不写真实用户目录），所以**还需要手工验证**：

- **改宿主/客户端**：重启 `dsh web`（宿主改动）+ 刷新页面（客户端改动）。
  - 客户端资源走 `/plugins/??…&rev=<内容哈希>`，**缺 `??` 或 `rev` 都会 404**。⚠️ 真实地址通常是**多个包合批**的一条（`??a/client.js,b/client.js,…&rev=<该批次哈希>`；0.1.7-rc.1 活页面实测本插件就在这样一条 5.5MB 的 `<link rel=preload>` 里），`rev` 是**批次**的哈希 —— 从 HTML 里抄地址要抄整条 `href`，只截本包那一段再配别的批次的 rev 会 404（0.3.7 实测踩到）。
- **改预设**：分两代 —— ≥ `0.1.7-alpha.1` 改 `presets/cc.patch.yml`，重启 `dsh web` 即生效（**没有任何安装步骤**）；≤ `0.1.6-alpha.2` 改 `presets/cc/agent.cordis.yml`，预设只在插件挂载时安装，想强制重装就删掉 `<DSH_HOME>/.agent-presets/cc` 后重启，或把插件行配成 `presetInstall: force`。**两处一起改**（见 §5）。
- **验证预设是否被判 broken**：先 `dsh --profile <名字> --dump-config` 确认 `preset-cc` 被组合进来（层注释 `# == <包名>` 下），再查 roster —— GUI 设置 →「Agent 预设」，或 `POST /api/pluginInventory/list`（含 `broken` 与逐行 `fiberPhase`；`/api/agentPresets/list` 没有逐行台账）。≤0.1.6 用 `discoverPresets(roots, harnessBase)` 跑发现逻辑。
- **验证 RPC 通道**：`/`（首页）与 RPC 都受会话 cookie 保护，不带 cookie 只会得到 `401 unauthorized`；用 `dsh web` 启动时打印的 token 访问一次 `/?token=…` 换取 cookie（名字形如 `dsh-auth-<base64url>`），再 POST 带信封的 JSON。
- **想整套隔离实测**（推荐，别拿真实 `~/.dsh` 试）：① 三个变量（`DSH_HOME` / `HOME` / `USERPROFILE`）一起指到临时目录；② 在其中建 `profiles/<名字>/package.json`，声明 `dsh.profile.bundles`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + 本插件）并装目标版本 dsh；③ 把本仓库 symlink 进 `node_modules/@xia-sc/dsh-cc-studio`；④ `DSH_HOME=<临时目录> node <profile>/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port <空闲端口>`；⑤ 用 playwright/curl 验设置页、roster、RPC；⑥ 收工删掉临时目录（别留在仓库里，也别提交）。

---

## 7. 常见的坑（都真发生过；展开的「现象 → 根因 → 修法」都在 CHANGELOG）

1. **预设里一个包名写错 → CC 模式不能用**（§2.4）。升级 dsh 后第一个要看的永远是这里。
2. **读错会话预设字段** → 胶囊要刷新才出；**`SessionListState` 没有 `current`**，工坊会读成 `default` 槽（§3.3，issue #5）。
3. **数组字段用「每行一条」互转** → 空串 split 出来的是一条空项，往返一趟凭空多一条空问候语；逐条编辑，别再引入 join/split。
4. **测试只隔离 `DSH_HOME`** → 读盘会回退到真实 `~/.dsh`，隔离环境会读到用户数据（§2.6）；三个变量一起指到临时目录。
5. **UI 层写死中文** → 切到 English 仍显示中文；必须进 `zh`/`en` 词表。
6. **大框「取消」与「完成」是同一个动作** → 输入即同步，取消必须携带打开时的快照真回滚。
7. **改名/重装后只有浏览器那一半挂**（`Failed to load plugins: … 1 entry did not activate`）：profile 里的安装身份还是旧名（判据：`~/.dsh/profiles/<profile>/node_modules/<scope>/` 目录名是否等于 `package.json` 的 `name`）→ 按新名重装 + 重启 + **硬刷新**。宿主那条 RPC 路由也会一起消失（`/dsh-cc-studio-rpc/ping` 返回 401 而非 404 可反推它还在）。
8. **草稿「看着丢了」先怀疑 key 不一致**（issue #5）：模型说写好了、工坊是空壳，而 `~/.dsh/cc-drafts/` 里有内容。一眼取证：`cc_getDraft` 的 `res.value.key` 与文件名（去掉 `-<hash>.json`）是否一致，`keySource:"fallback"` 就是主机没拿到会话 id。**别加第二条「顺手兜底成 default」的路径**（那正是成因）。
9. **升级 dsh 后预设「干净地消失」→ 先怀疑投递机制**（§2.4 / §4）：不报错、不 broken、就是没了。取证 `dsh --profile <名字> --dump-config | grep preset-cc`；别再往 `.agent-presets/` 里写。
10. **文件 / 凭据权限信号**：STORE 的扫描器把任何 `process.env` 读取判为凭据信号，而落盘 + 读 `DSH_HOME` 正是本插件的功能 —— 自动低风险通道（`source-verified`）永远过不了，正确档位是 `user-reviewed`（用户逐次确认），**不要为了过扫描器改运行时代码**。
11. **DSH STORE 报 `Catalog blocked` 有两层，别只改 manifest**（issue #1173）：
    - **可修（声明类）**：`repository` 规范化后等于 canonical 仓库、`engines.node`、`dsh.compatibility.dshReleases` 只写实测过的精确 SemVer、零运行依赖、无 `preinstall/install/postinstall/prepare`、`files` 非空、只 import `node:` 与相对路径 —— 全部由 `tests/preset-install.test.mjs` 钉住。
    - **不可修（身份）**：Catalog 里那条还叫 0.3.0 的旧名 `@dsh-plugins/dsh-cc-studio`，STORE 复检第一步是 `manifest.name !== entry.packageName → update-blocked`，新 manifest 根本不会被读到；只能由 STORE 侧迁移条目身份（**重新提交也绕不过**：`entryIds: ["dsh-cc-studio"]` 会撞 `SUBMISSION_ENTRY_COLLISION`）。

---

## 8. English summary

`@xia-sc/dsh-cc-studio` is a DSH plugin (a CCv3 character-card studio). Essentials:

- **No build step.** `lib/*.js` ships as-is (plain ESM); `lib/client.js` is a hand-written bundle (`window.__ModuleLoader__.load(...)`, `React.createElement` only). Client edits → refresh the page; host/preset edits → restart dsh. Keep the old-school plain-JS style.
- **The host half owns its HTTP route** (`POST /dsh-cc-studio-rpc/<endpoint>`, connection RPC envelope, `connection.requestRejection` fence); `connection.rpc.handle()` is unusable by external plugins.
- **Presets are a composition row**: keep `presets/cc/agent.cordis.yml` (legacy directory form, dsh ≤ 0.1.6-alpha.2) and `presets/cc.patch.yml` (dsh ≥ 0.1.7-alpha.1) verbatim-identical apart from comments — one bad package name breaks CC Mode. The legacy install must never overwrite a file the user edited.
- **Data roots**: `dataRoots(sub)` → `[primary, legacy]`; writes hit the primary, reads fall back. Isolate `DSH_HOME`, `HOME` **and** `USERPROFILE` in tests.
- **Every fix needs a regression test plus a CHANGELOG entry** (symptom → root cause → fix → how it takes effect). Client-half behaviour is asserted by booting `lib/client.js` in fake React/slot/RPC harnesses; the tool half is booted for real (`tools-contract`: one copy of `next/hint/notice/warning`, tri-state `workflow.state`, no-op writes don't burn a `rev`, lossless JSON, `build` / `watchedRev` on every reply).
- **Destructive actions** reset state in `store.clearDraft()` and confirm on the button side (no confirm available → no action). The draft-slot key comes from the session id carried in slot props; a host-side `default` fallback is never rendered.
- **The card-group layer (0.10.0)** lives in `lib/group-layer.js` — the one file in this repo that is deliberately **not** duplicated across the two halves (pure functions, zero IO, imported by both). Card-group data comes from `groupScope()`, every count/token figure from `groupMetrics()`, and a new group feature is **one entry in the `GROUP_CHECKS` registry** (host + tool + client all read the same list; `checkGroup` is a 6-line wrapper). `tests/group-layer-guard.test.mjs` enforces it, and `tests/group-consistency.test.mjs` is the worked example (cross-card consistency, added without touching any existing tool's counting code).
- **SillyTavern interop (0.9.1)**: cards stay CCv3 underneath; the ST layer lives in the PNG `chara` chunk (an honest V2 projection) and in `data.extensions.world` — never as extra top-level card fields. PNG chunk readers classify by the payload's `spec` and prefer `ccv3`. A standalone lorebook ships as two files (`{spec:"lorebook_v3", data}` for CCv3 clients, `{entries:{…}}` for ST). V2/V1 cards are **upgraded on import** (`upgradeCardToV3`, reported as `upgradedFrom`), never silently rejected.
- **dsh compatibility & the DSH STORE** are in §4 and §7 (items 10–11) — only tested releases are declared.
