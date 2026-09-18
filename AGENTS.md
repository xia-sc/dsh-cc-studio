# AGENTS.md — 给在本仓库工作的 Agent 的说明书

`@xia-sc/dsh-cc-studio`：DSH（DeepSeek Harness）插件，CCv3 角色卡工坊。
一句话：**输入框上方的胶囊 → 全屏融合工坊**，配合 `CC 模式` 预设让 LLM 用 14 个 Tool 先问再填，最后导出 `JSON / PNG / CHARX`。

用户文档看 `README.md`（中文）/ `README_EN.md`（英文），历史看 `CHANGELOG.md`。本文件只写**改代码前必须知道的事**。

---

## 1. 仓库结构

```
lib/index.js     944 行  ── 宿主半：RPC 端点 + 草稿落盘 + 角色库 + PNG/CHARX + 预设自动安装
lib/agent.js     614 行  ── 预设半：CC 模式的 14 个 Tool（只随 CC 预设挂载）
lib/client.js   1536 行  ── 浏览器半：手写 bundle，胶囊(Capsule) + 工坊(Workshop) + 设置页(SettingsView)
presets/cc/              ── CC 预设模板（挂载时自动安装到 <DSH_HOME>/.agent-presets/cc）
cordis.patch.yml         ── 宿主组合补丁（insert 一个插件行）
tests/*.test.mjs         ── 4 个测试文件、158 项断言；**不随包发布**
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

> 包名是 `@xia-sc/dsh-cc-studio`（0.3.2 起；此前叫 `@dsh-plugins/dsh-cc-studio`）。npm 的 scoped 包**只有该 scope 的成员能发布**，而 `@dsh-plugins` 不是本项目持有的（npm CLI 也没有 `npm org create`），所以旧名发不出去 —— 再改名时 scope 必须落在发布者自己的账号下。改名要同步 5 处：`package.json` 的 `name`、上表三行的加载方，以及 `lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 `id`。最后这处是硬约束：`dsh-client-modules` 会拿宿主图里的包名精确匹配 `id`（该包 `lib/client.js:267,285`，`stripClientSuffix` 后相等），对不上直接抛 `bundle … loaded without registering "…"`，整个客户端半加载失败。

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
| 命名约束 | channel `/^\/[A-Za-z0-9._~-]+$/`，endpoint 每段 `/^[A-Za-z0-9_$.-]+$/`，与 `dsh-client-connection` 保持一致 |
| 体积上限 | `RPC_MAX_BODY_BYTES = 48MB`（PNG ≤20MB、CHARX ≤30MB 的 base64 都走这里） |
| 请求体读取 | 必须用 `data/end/error` **事件式**；**异步迭代 `IncomingMessage` 在这个运行时会抛错**（连官方的 `/api` 帧也受影响） |

客户端侧一律走 `ctx.connection.rpc.call("/dsh-cc-studio-rpc", endpoint, { args })`（`lib/client.js` 里有 `rpc()` 包装）。

改协议前先对一遍 `@deepseek-ai/dsh-client-connection` 的 `parseConnectionResponse` / `assertTarget`，它才是唯一权威。

### 2.4 预设里的每一行 name 都必须能解析

dsh 的预设发现（`dsh-agent-presets` → `unresolvableRows`）会对**每个会真正启动的行**做包存在性检查；**任何一行取不到，整个预设就被标记 `broken`**，roster 里显示「加载失败」并且**不可选中、不可复制**。

也就是说：预设里写错一个包名，后果不是「那个功能不可用」，而是**整个 CC 模式消失**。

`presets/cc/agent.cordis.yml` 是**照抄 dsh 内置 `standard` 预设再改**的，因此：

- dsh 升级若改动了内置预设（改包名、加行、改配置 schema），这里**必须同步** —— 这是历史上最容易坏的地方，见下面第 4 条。
- 新增行前确认目标 dsh 版本真的装了那个包。**任何 truthy 的 `disabled` 都会被健康检查跳过**（`unresolvableRows` 里 `if (Boolean(row.disabled)) continue`），所以 `disabled: true` 与 `disabled: !!js …` 一样不参与行解析 —— 0.3.4 敢把 alpha.2 新增的 `tool-plugin-manager`（`disabled: true`）抄进来就是靠这条；但**不要**靠 `disabled` 遮掩一个已经不存在的包。
- 预设里 `cordis:group` / `isolate` 的用法有解释性注释，别删。

### 2.5 预设自动安装：绝不静默覆盖用户改动

`lib/index.js` 的 `planPresetInstall` 是纯决策函数，规则与测试一一对应：

| 目标文件 | 有安装记录(`.dsh-cc-studio-preset.json`)且 hash 匹配 | 决策 |
| --- | --- | --- |
| 不存在 | — | 写入 |
| 与模板一致 | — | 不动 |
| 与记录 hash 一致（我们写的、用户没改） | 是 | 安全更新 |
| 既非模板也非记录（用户改过 / 历史手工拷贝） | 否 | **跳过 + 告警**，且**不把该文件写进记录** |

开关：环境变量 `DSH_CC_STUDIO_PRESET_INSTALL` = `auto`(默认)/`force`/`off`，插件行 `config.presetInstall` 优先。受管文件只有 `PRESET_MANAGED_FILES = ["preset.yml", "agent.cordis.yml"]`。卸载插件**不删除**已安装的预设。

改这块时：**不变量比功能更重要** —— 「用户没改过的才更新」和「记录里不声明被跳过的用户文件」两条都有测试钉住，破坏它们就会在某台机器上吃掉用户的预设。

### 2.6 测试必须隔离 `DSH_HOME`

插件用 `DSH_HOME`（优先）或 `homedir()` 解析落盘位置。任何会触发 `apply()` 的测试都必须同时隔离 `DSH_HOME`、`HOME`、`USERPROFILE` —— 只隔离 `HOME` 不够，`DSH_HOME` 优先，会写进**真实的** `~/.dsh/.agent-presets/cc`。`tests/rpc-channel.test.mjs` 已经踩过这个坑，并在跑完后校验真实目录未被改动，新测试照抄这个模式。

---

## 3. 三半的分工

### 3.1 `lib/index.js`（宿主）

- **RPC 端点**：`validate` / `ping` / `cc_isCcMode` / `cc_getDraft` / `cc_setDraft` / `cc_patchDraft` / `cc_validateDraft` / `cc_listLibrary` / `cc_saveToLibrary` / `cc_loadFromLibrary` / `cc_deleteFromLibrary` / `cc_renameInLibrary` / `cc_getLibraryEntry` / `cc_importFromPng` / `cc_exportPng` / `cc_importFromCharx` / `cc_exportCharx`。未知端点返回 **200 + 失败帧**（`details.code = "unknown-endpoint"`），不是 404。
- **草稿持久化**：`<DSH_HOME>/cc-drafts/<session>.json`，变更即落盘（内存 miss 时**不静默建空**，会告警并提示恢复）。
- **角色库**：`<DSH_HOME>/cc-library/<id>.json`。
- **容器互通**：PNG 的 `tEXt` `ccv3` 块（自带 CRC32/deflate）、CHARX（ZIP + `card.json`）。
- **预设安装**：见 2.5。

### 3.2 `lib/agent.js`（预设半）

- `inject` 是 `["tools", "agents"]`，用 `ctx.tools.register({ name, description, parameters, execute })` 注册 14 个 Tool。
- 与宿主半**共享同一份草稿文件**（同一套解析/落盘逻辑），所以两边对「多段问候语」「空数组」的处理必须一致。
- 强制工作流：`cc_get_card → cc_patch_character → cc_patch_world → cc_add_lorebook_entries → cc_patch_greetings → cc_validate`；`GREETING_MAX = 10` 与宿主截断点必须保持一致（有跨文件测试）。

### 3.3 `lib/client.js`（浏览器）

- 挂载点（`ctx.slots.inject` + `ctx.slots.register`，都带 `locale: NS`）：
  - `conversation.input.dock` → `Capsule`（会话域；CC 模式下常驻）
  - `shell.overlay` → `Workshop`（根域；全屏/侧边工坊）
  - `settings.section` → `SettingsView`（设置页「角色卡工坊」）
- **CC 模式探测**只有一份实现：`useCcPreset()`（`lib/client.js:913` 起）。判定优先级：**① 会话投影 `session.projectionValues.agentPreset` → ② 预设芯片 DOM（`button[aria-haspopup="menu"]`）→ ③ 主机 RPC**，新会话页另有 1s 本地轮询兜底。
  - 历史事故：读错过字段（`sess.preset / presetId / agentPreset / mode` 全都不存在），且 effect 依赖不变导致永不重跑 —— **切到 CC 模式要刷新才出胶囊**。别再写第二份探测，`tests/cc-detection.test.mjs` 里有源码级守卫。
- 状态在 `store`（`createStore` + `subscribe/getSnapshot`）；设置存 `localStorage:dsh-cc-studio-settings`。
- i18n：文件内 `zh` / `en` 两张表（**203 键**），`ctx.locale.register(NS, { zh, en })`，`t = ctx.locale.bind(NS)`。**UI 层不得出现中文字面量**（有守卫测试），新增文案必须同时进 `zh` 和 `en`，并保持 `{n}` 之类的占位符一致。

---

## 4. 版本兼容（本项目最容易坏的地方）

| dsh 版本 | 状态 | 备注 |
| --- | --- | --- |
| `0.1.5-rc.1` / `0.1.5-rc.2` | 正常 | 见 CHANGELOG 0.2.22 |
| `0.1.6-alpha.1` | 正常（0.3.1 起） | 预设行 `workflow-worker-thread` → `workflow-ptc`，否则预设整体被判 broken |
| `0.1.6-alpha.2` | 正常（0.3.4 起） | 内置 `standard` 相比 alpha.1 只多一行 `tool-plugin-manager`（`disabled`）。0.3.4 补回 `present` 行与 spawn 行的 `modelSelectionSettings: true` |

已实测对齐的接口（0.1.6-alpha.2）：`webServer.register`、connection RPC 线协议 + `connection.requestRejection`、`conversation.input.dock` / `shell.overlay` / `settings.section` 三个 slot、`ctx.locale.bind/translate`、`agents.currentInitiator/get`、`tools.register`（要求 `output: { schema, render }`，且只对 `output.schema` 做 JSON-Schema 子集断言 —— `parameters` 不查子集，`minItems`/`maxItems` 不会抛）。

**实测手法（可复用）**：宿主半靠「未知路径 404/405 vs 插件路由 401」校准（证明路由确实注册、且围栏是插件自己调的）；客户端半用 Client Inspect 读活页面的 Slot 台账，看三个挂载点是否 `active: true` 且 registrant 等于包名；预设半按 `tools.register` 契约在隔离 harness 里挂 `lib/agent.js`；预设健康度直接调 alpha.2 自带的 `discoverPresets`（`compositionProblem` + `unresolvableRows`）。

**新增/升级 dsh 版本时的清单**：

1. 拉目标版本的 `@deepseek-ai/dsh` 与相关包（`npm pack` 即可，不必装）。
2. 对比 `dsh-host-webserver`、`dsh-client-connection`、`dsh-client-ui-conversation/layout/settings-general`、`dsh-agent-presets`、`dsh-tools`、`dsh-agent` 这几个包的 API 面（本仓库就靠这几个活着）。
3. **把 `presets/cc/agent.cordis.yml` 与目标版本内置的 `standard` 预设逐行对一遍**（`@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml`）。
4. 用隔离环境实测（见第 6 条），不要只看代码。

---

## 5. 日常改动规则

- **改任何 bug 都要补回归测试**，并在 `CHANGELOG.md` 顶部写一条：**现象 → 根因 → 修法 → 生效方式**（重启 `dsh web` / 刷新页面 / 两者），这是本仓库既有的写法，照抄。
- `package.json` 的 `version`、`README`/`README_EN` 里的「当前版本」、`CHANGELOG.md` 顶部小节三者同步。
- `files` 决定发布内容（`lib` / `cordis.patch.yml` / `presets`）；`tests/` **不进包**，所以测试可以随便依赖仓库内路径。`README.md` 与 `LICENSE` 由 npm 强制带上；`README_EN.md` **不在** `files` 里，因此不进包（npm 页面也只渲染 `README.md`）。
- **发布走 CI（默认）**：`.github/workflows/publish.yml` —— 打 `v*` tag 即 `npm test` → `npm publish --provenance` → 发布成功后自动建 GitHub Release（正文与标题由 `.github/scripts/release-notes.mjs` 从 `CHANGELOG.md` 的该版本小节抽取，**所以 CHANGELOG 顶部小节必须先写好，否则 Release 正文会退化成显式占位**）。发版三步：① 同步版本四处（`package.json` / `README.md` / `README_EN.md` / `CHANGELOG.md`）② `git commit` ③ `git tag -a vX.Y.Z -m "…" && git push origin master --follow-tags`。
  - 版本守卫会在 `tag ≠ package.json 的 version` 时直接 fail（专拦「tag 是 v0.3.3、包里还是 0.3.2」这类手滑）。
  - 认证是 npm 的 OIDC trusted publishing，**没有任何密钥**。三个硬要求：job 级 `id-token: write`、运行器 npm ≥ 11.5.1（Node 22 自带 10.x，故 workflow 里有升级步骤）、npm 侧登记的 workflow 文件名必须与 `.github/workflows/publish.yml` 逐字符一致（Environment 留空、勾选 Allow npm publish）。报 `ENEEDAUTH`/`401` 基本都是这三条对不上。
  - **手动发布（备用）**：`npm publish`（`publishConfig.access = "public"` 已固化，不必再带 `--access public`；`prepublishOnly` 会先跑 `npm test`）。账号 2FA 是 `auth-and-writes`，所以这条路每次都会走「浏览器授权（`PUT 401` → 授权 → `PUT 200`）」，属正常现象。scoped 包要求 `npm whoami` 与包名 scope **完全一致**（猜错就是 403）。
  - **发布成功后 npm 有传播延迟，别误判成失败**（0.3.3 实测）：CLI 会打印 `Your package is being processed and may take a few minutes to become available.` + `+ <包名>@<版本>`。本次 `dist-tags`/`npm view` 约 **1 分钟**后才出现新版本，而 **tarball（`.../-/<短名>-<版本>.tgz`）约 3 分钟后**才从 404 变 200。所以：**以 Actions 日志里的 `+ …@x.y.z`、`Signed provenance statement`、sigstore 那行，以及 `dist.attestations` 为准**；刚发完就去 `npm view` / 拉 tarball 得到旧版本或 404 属正常，等几分钟再查，不要重发（重发会撞 `You cannot publish over the previously published versions`）。
  - **别指望手动跑法能验证 OIDC**：`npm publish --dry-run` 的版本查重与 `npm pack` 都**不做认证**（实测：把 token 换成假值，报错一字不差），所以第一次真实验证必然是下一个真版本打 tag。
- 中文注释是本仓库的叙事传统（解释「为什么」，尤其是踩过的坑），保留和沿用，别把它们删掉换成英文。
- 不要动 `dist/*.zip`；发布包是手工归档的历史版本。

---

## 6. 本地验证

```bash
npm test          # 4 个文件：23 + 41 + 32 + 62 = 158 项断言，全绿才算过
```

测试只跑纯函数与源码级守卫（不启动 dsh、不写真实用户目录），所以**还需要手工验证**：

- **改宿主/客户端**：重启 `dsh web`（宿主改动）+ 刷新页面（客户端改动）。
  - 客户端资源真实地址形如 `/plugins/??@xia-sc/dsh-cc-studio/client.js&rev=<内容哈希>`，**缺 `??` 或 `rev` 都会 404**，`rev` 随 `lib/client.js` 内容变化。
- **改预设**：预设只在插件挂载时安装。想强制重装：删掉 `<DSH_HOME>/.agent-presets/cc` 后重启，或把插件行配成 `presetInstall: force`。
- **验证预设是否被判 broken**：在 GUI 设置 →「Agent 预设」里看 CC 模式是否显示「加载失败」；或用 `dsh-agent-presets` 的 `discoverPresets(roots, harnessBase)` 直接跑一遍发现逻辑。
- **验证 RPC 通道**：`/`（首页）与 RPC 都受会话 cookie 保护，不带 cookie 只会得到 `401 unauthorized`；用 `dsh web` 启动时打印的 token 访问一次 `/?token=…` 换取 cookie（名字形如 `dsh-auth-<base64url>`），再 POST 带信封的 JSON。
- **想整套隔离实测**（推荐，别拿真实 `~/.dsh` 试）：
  1. 建一个临时 `DSH_HOME`，在其中 `profiles/web/package.json` 声明 `dsh.profile.bundles`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + 本插件）并装目标版本 dsh；
  2. 把本仓库 symlink 进 `node_modules/@xia-sc/dsh-cc-studio`；
  3. `DSH_HOME=<临时目录> node <profile>/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port <空闲端口>`；
  4. 用 playwright/curl 验证设置页、预设 roster、RPC；
  5. 收工删掉临时目录（别留在仓库里，也别提交）。

---

## 7. 常见的坑（都真发生过）

1. **预设里一个包名写错 → 整个预设「加载失败」**（2.4）。升级 dsh 后第一个要看的永远是这里。
2. **读错会话预设字段** → 切 CC 模式不出现胶囊，要刷新才行（3.3）。
3. **数组字段用「每行一条」互转** → `''.split('\n') === ['']`，空数组往返一趟凭空多一条空问候语；多段问候语被静默拆条。现在 `alternate_greetings` / `group_only_greetings` 是**逐条编辑**，不要重新引入 `join/split`。
4. **异步迭代 `IncomingMessage`** 在该运行时抛错（2.3）。
5. **`connection.rpc.handle()` 对外部插件不可用**（2.3），别想着「修好它」。
6. **测试没隔离 `DSH_HOME`** → 污染真实用户预设目录（2.6）。
7. **UI 层写死中文** → 切到 English 仍显示中文；必须进 `zh`/`en` 词表。
8. **大框「取消」与「完成」是同一个动作** → 输入即同步，取消必须携带打开时的快照真回滚。
9. **改名后没重装 → 客户端报 `Failed to load plugins: web boot: 1 entry did not activate`**（0.3.2 换 scope 时真踩过）：profile 里的安装身份（`dsh.profile.bundles` 那一行 + `dependencies` 里的 `link:`）还是旧名，而包内 `package.json` / `lib/client.js` 已改名，客户端资源就解析不上——宿主照样起，只有浏览器那一半挂。判断只需一眼：`~/.dsh/profiles/web/node_modules/<scope>/` 的目录名是否等于 `package.json` 的 `name`。修法：按新名重装（`dsh plugin --profile web add <路径或包名>`）→ 重启 `dsh web` → **硬刷新**（旧页面的引导图是缓存的，普通刷新会复现同一句错）。宿主侧那条 RPC 路由也会一起消失，探测 `/dsh-cc-studio-rpc/ping` 返回 401（而非 404/405）可反推它确实被挂载了。

---

## 8. English summary

`@xia-sc/dsh-cc-studio` is a DSH plugin (a CCv3 character-card studio). Key rules for agents working here:

- **No build step.** `lib/*.js` is the shipped artifact: plain ESM, and `lib/client.js` is a hand-written browser bundle wrapping `window.__ModuleLoader__.load(...)`. `React.createElement` only — no JSX, no TypeScript, no bundler.
- **The host half owns its HTTP route.** `connection.rpc.handle()` is unusable by external plugins on dsh ≥ 0.1.5-rc.1, so the plugin registers `POST /dsh-cc-studio-rpc/<endpoint>` on `webServer` and speaks the connection RPC wire protocol itself. Read request bodies with `data`/`end`/`error` events — async iteration throws on this runtime.
- **One bad row breaks the whole preset.** dsh's preset health check rejects a preset if any started row names a package that cannot be resolved, making CC mode unselectable. Keep `presets/cc/agent.cordis.yml` in sync with the target dsh's shipped `standard` preset.
- **Never overwrite user files** when auto-installing the preset; the `planPresetInstall` invariants are pinned by tests.
- **Isolate `DSH_HOME`, `HOME`, and `USERPROFILE`** in any test that triggers `apply()`.
- **Tests:** `npm test` — 4 files, 158 assertions, all green. Every bug fix needs a regression test plus a `CHANGELOG.md` entry (symptom → root cause → fix → how it takes effect).
- **dsh compatibility:** verified on `0.1.5-rc.1/rc.2`, `0.1.6-alpha.1`, and `0.1.6-alpha.2`. When bumping, diff the dsh packages this plugin lives on, then re-check the preset against the shipped `standard` preset.
