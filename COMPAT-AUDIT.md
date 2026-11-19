# 兼容性审计记录

每次 dsh 升级审计的**过程性记录**：结论和兼容矩阵放 `AGENTS.md` §4 与 `package.json`，这里只放「怎么把审计跑起来」、踩过的坑和可复现的命令骨架。

写法约定：坑 → 现象 → 根因 → 做法。只记会重复踩的，不记一次性路径。

---

## 0.2.2-rc.3（2026-11-16，插件 0.26.1）

### 结论

桌面版当前版本 `0.2.2-rc.3` 与插件兼容，**运行时代码零改动**，只补 `dshReleases` 与文档。L2 组合快照仍由 rc.1 生成（锚定下限），rc.3 只作为实测版本。

实测三层：

1. **L2 组合**：本机 Desktop 的 `DeepSeek Harness.exe` 直接跑 `node scripts/dump-config.mjs --out .compat-tmp/rc3-composition.json`（`findDsh()` 自动探测，`prepareInstance` 注入 `ELECTRON_RUN_AS_NODE=1`）。dump 成功，preset-cc 顶层 23 行 + 组内 9 行，与 rc.1 快照逐行一致。
2. **L3 全链路**：同一 exe 跑 `node scripts/e2e-smoke.mjs`，0 失败（启动 / token 换 cookie / boot 清单 / 客户端资源与 rev 契约 / RPC / 草稿 / 导出 / 落库 / `originFingerprint`）。
3. **broken 判定**：`mountPreset → auditRows` 的失败判据是包 / 子入口解析不到。桌面版的 `node_modules` 在 `app.asar` 里，普通 node 的 fs 看不透，所以用 `ELECTRON_RUN_AS_NODE=1 "<exe>" check-resolve.mjs <web-app/package.json> <presets/cc.patch.yml>` 在 asar 里逐个 `createRequire().resolve()`：CC 预设用到的 28 个包名（含 `@deepseek-ai/dsh-plugin-manager/tools` / `dsh-plugin-market/tools` 子入口）全部可解析。

### rc.3 的 standard 与 rc.1 的差异（都不补）

| 差异 | 为什么不补 |
|---|---|
| `tool-office` 行 | rc.1 没有这个包；加上会让下限版本整份预设 broken。能力差异（CC 模式不需要 Office 工具）。 |
| `tool-subagent-control.interrupt: false` | rc.2 起才有的配置；rc.1 上不认。 |
| `skill-filesystem.customSkillDirs` | 表达式依赖 loader 注入的 `baseUrl`（rc.3 才提供）；rc.1 上求值失败，整份预设 broken。 |

结论写进 `AGENTS.md` §4 与 CHANGELOG，避免下次升级把它们当成「漏抄」补上。

### 踩坑

#### 1. 桌面版 exe 可以直接喂给现有脚本，不需要另写启动器

`findDsh()` 已经会扫 `%LOCALAPPDATA%\Programs\DeepSeek Harness`；`prepareInstance()` 的 env 带 `ELECTRON_RUN_AS_NODE=1`，`spawnSync(exe, [bin, ...args])` 在 GUI 子系统 exe 上也能同步拿到输出。之前 COMPAT-AUDIT 记的「GUI exe 的 `&` 不等待」只影响 PowerShell 直接调用，不影响这两条路径。

#### 2. 解析检查要跑在 Electron 的 fs 上

普通 node 里 `existsSync('...app.asar\\...')` 恒为 false（`findDsh` 的兜底判据也因此只看 `resources/app.asar`）。验证包可解析必须在 `ELECTRON_RUN_AS_NODE=1` 下跑脚本，否则会把「asar 不可见」误判成「包不存在」。



### 结论

dsh 兼容下限从 `0.2.0-rc.2` 抬到 `0.2.2-rc.1`。**运行时代码零改动**：为 0.2.0 / 0.2.1 写的分支在 0.12.0 抬到 0.2.0-rc.2 时已经清完，这次只清声明层 —— 删 `tool-subagent.modelSelectionSettings` 旧键、补回 `tool-schedule` / `tool-plugin-market` 两行、改矩阵与测试。

对照依据：本机源码 checkout（`<deepseek-harness checkout>`）的 HEAD 恰好是 `0.2.2-rc.1`（顶层 `package.json` 的 `version`），直接读 `packages/bundle/web-app/presets/standard.patch.yml` 与 `packages/subagent/tool-subagent/src/index.ts` 核对，不必猜包名。

### 记录：`connection.fetch.register` 的两次判断（0.26.x 不改 → 0.27.0 已迁）

`HostConnectionFetch` 自 `0.2.0-rc.1` 起就存在（`git log -S 'HostConnectionFetch'` 只命中 `e5e4b02742`，首个包含它的 tag 是 `dsh-v0.2.0-rc.1`）。0.26.x 第一次评估的结论是「不改」，保留在这里作对照：

- `get fetch()` 的 owner 是 `HostConnectionService.this.ctx`，但注册只写 `this.fetchRoutes`、不碰 `webServer` —— 外部插件**能**注册；只是 disposer 挂在 connection 的 fiber 上，插件必须自己用 `ctx.effect` 包一层。
- exact 路由按 pathname 精确匹配；「未知端点回 200 + 失败帧」仍能在 body 内保留（URL 不再编码 endpoint）。

0.27.0 推翻「不改」并完成迁移。决定性证据是官方源码：`connection.rpc.handle()` 在 `packages/` 与 `apps/` 里**零消费方**（13 处真实使用全是 `fetch.register`），`/api` 的 interceptor 被 `typertGateway` 独占；官方架构笔记还把「各 owner 在 `/api` 上注册 exact Fetch route」写成插件端点的正规入口。迁移后删掉约 150 行自维护协议（围栏 / body 读取 / 48MB 上限 / 信封发送），交接给 Connection 的 trust、认证、body 与上限。

迁移时踩到的坑：

1. **客户端测试的桩点必须换**：旧测试 mock `ctx.connection.rpc.call`，迁移后客户端走全局 `fetch`，桩会静默不生效（表现为「请求没发出」）。统一用 `tests/harness.mjs` 新增的 `installClientRpc()`。
2. **客户端 `rpc()` 必须定义在 factory 级**：`createStore`（写/读草稿）与 `apply`（轮询）不在同一闭包；定义在 createStore 里会让 apply 侧报 `rpc is not defined`。
3. **批量改测试要先归一化 CRLF**：`^const calls = \[\];\n` 在 CRLF 文件里匹配不到，会留下重复声明。
4. **UI 层不许出现中文字面量**：传输错误的 message 写成英文诊断串（`RPC failed (HTTP 413)`），否则 i18n 源码守卫会红。
5. **非 POST 回 404、超限回 413**：这是 Connection 的语义；前缀路由时代的 405 / 自管 48MB 断言必须删掉，否则测试在测官方契约而不是插件。

### 用目标版本重建 L2 快照

本机桌面版是 `0.2.2-rc.3`，**不能**用它生成 rc.1 的 fixture（`dshVersion` 会写错，行集也可能漂）。临时装一份 rc.1，并用脚本支持的 `DSH_EXE` / `DSH_BIN` 指过去：

```powershell
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
npm install --prefix .compat-tmp/dsh-rc1 --no-save --no-audit --no-fund `
  @deepseek-ai/dsh@0.2.2-rc.1 --cache .compat-tmp/npm-cache
$env:DSH_EXE = (Get-Command node).Source
$env:DSH_BIN = (Resolve-Path '.compat-tmp/dsh-rc1/node_modules/@deepseek-ai/dsh/lib/bin.js').Path
node scripts/dump-config.mjs
```

`.compat-tmp/` 已 gitignore；`--cache` 指到工作区内，避免 npm 去写系统 cache 被沙箱拒。

配套的 L3 用同一组环境变量：`node scripts/e2e-smoke.mjs`。它验的是宿主 / RPC / 客户端资源，不依赖 fixture 版本，但**必须**也用 rc.1 跑一遍，否则「预设补回两行后没有 broken」这件事只有 dump 的间接证据。

### 踩坑

#### 1. fixture 的版本号是「生成时用的那个 dsh」，不是「声明的最低版本」

`tests/preset-composition.test.mjs` 断言 fixture 的 `dshVersion` 在 `dshReleases` 里且 compatible。抬下限后如果把 fixture 留成旧版本，这条会红；如果拿本机 rc.3 生成，虽然也能过（rc.3 不在矩阵里就会红），但记录的就不是目标版本。**先定目标版本，再用同版本 dsh 生成 fixture**，顺序不能反。

#### 2. README 的版本守卫会拦住「不再支持 0.2.0 / 0.2.1」这句话

`tests/preset-install.test.mjs` 第 7 节把 README 里所有 `0.x.y` token 钉在 `dshReleases` / 范围 / 未实测白名单 / 插件版本并集内。删掉 `0.2.0-rc.2` 等条目后，README 里如实写「不再支持」的版本号就会变成 stray。做法：白名单数组改名成「未实测 / 已弃用」，把裸 `0.2.0` / `0.2.1` 与所有旧 rc 一起收进去（裸版本号也要收，因为守卫按三段 token 匹配）。

## 0.2.2-rc.2（2026-11-12）

### 结论

插件 0.20.0 与 dsh `0.2.2-rc.2` 兼容，无需改运行时代码；只补了兼容声明与文档。审计环境：Desktop 安装的 `0.2.2-rc.2`（Node 24.21 / hostProtocol 4），隔离 `DSH_HOME` + `HOME` + `USERPROFILE`，profile 只组合 `dsh-base` + `dsh-web-app` + 本插件。

### 踩坑

#### 1. asar 里的文件，普通 Node 和 PowerShell 都读不到

- **现象**：`Get-Content '<安装目录>\resources\app.asar\dsh\...'` 报路径不存在；`require('.../app.asar/...')` 报 `MODULE_NOT_FOUND`。
- **根因**：`app.asar` 是归档，只有 Electron 打过补丁的 `fs` 能穿透。
- **做法**：单个文件用 agent 的 read 工具；列目录/搜内容写个小脚本，用 `ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" script.mjs <dir>` 跑（`fs.readdirSync` / `readFileSync` 都可用）。普通 `node` 不认这个环境变量。

#### 2. 桌面版的 dsh CLI 不是普通 exe

- **现象**：`& "<DeepSeek Harness.exe>" <asar>\...\dsh\lib\bin.js --version` 立即返回，进程根本没起来。
- **根因**：Windows GUI 子系统可执行文件，PowerShell 的 `&` 不会等待。
- **做法**：用 `System.Diagnostics.ProcessStartInfo`（`UseShellExecute=$false`）同步等，或直接 `cmd /c` 包装。别用 `Start-Process` 猜。

#### 3. web 实例的日志永远是空的

- **现象**：用 `ReadToEnd` 收 stdout 的包装脚本，启动 web 后日志文件一直是 0 字节。
- **根因**：`ReadToEnd` 要等进程退出才返回，而 web 不退出；换成 `BeginOutputReadLine` 事件在后台 pwsh job 里会抛 `PSInvalidOperationException: 此线程中没有可用于运行脚本的运行空间`。
- **做法**：让 **cmd 负责重定向**——`cmd /c "start-web.cmd"`，脚本里 `"...exe" "...bin.js" <args> > web.log 2>&1`。日志实时落盘，job 只负责保活。

#### 4. 不能在真实 profile 上起实例

- **现象**：`DSH_HOME` 保持真实值时启动立刻 `EPERM: open '...\profiles\web\package.json'`。
- **根因**：`dropRetiredBundles` 启动时要重写 profile manifest；沙箱 `workspace-write` 只允许写工作区。即使不放行，它也会真的改用户 profile。
- **做法**：`DSH_HOME` / `HOME` / `USERPROFILE` 三个一起指向工作区临时目录（只改 `DSH_HOME` 会从 `homedir()` 读到真实数据）。

#### 5. 临时 profile 不需要（也搬不动）shipped bundles

- **现象**：想把 desktop 的 `node_modules` 链进临时 profile，`New-Item -ItemType Junction` 报「需要管理员权限」，`cmd /c mklink /J` 报 `Access is denied`。
- **发现**：`@deepseek-ai/*` 这些 shipped bundle 由 **CLI 自己的安装树**解析，profile 的 `node_modules` 里没有也能正常组合；只有第三方插件必须从 profile 解析。
- **做法**：临时 profile 的 `node_modules/@xia-sc/dsh-cc-studio` 直接**复制**插件文件（`lib/`、`presets/`、`cordis.patch.yml`、`package.json`、`icon.svg`），`package.json` 里 `dsh.profile.bundles` 写 `dsh-base` + `dsh-web-app` + 插件即可。

#### 6. `--dump-config` 被管道截断会死锁

- **现象**：`dsh <profile> --dump-config | Select-Object -First 30` 一直不返回。
- **根因**：`Select-Object -First` 读够就关管道，上游 `ReadToEnd` 写不进去。
- **做法**：输出重定向到文件，或整段 `Out-String`；不要对长输出用 `-First`。

#### 7. `--no-open` / `--port` 透传不稳

- **现象**：`dsh <profile> --no-open --port 59911` 实际起了默认 3080，还打印「opening the default browser」。
- **做法**：用 cmd 包装脚本显式传参（本次 59911 与 `--no-open` 都生效）。端口是互斥资源，先确认空闲。

#### 8. 没有会话时胶囊根本不渲染

- **现象**：打开首页/欢迎页，`document.body.innerText` 里搜不到「CC」「角色卡」，以为插件没加载。
- **根因**：`conversation.input.dock` 是 **session scope**，要真实会话的输入区；欢迎页只有「选择工作区」占位。
- **做法**：先确认插件在 boot 清单里（`window.__DSH_BOOT__.entries` 有 `@xia-sc/dsh-cc-studio`），再经「选工作区 → 选 CC 模式」进入会话，胶囊才出现。

#### 9. 沙箱里目录选择器 spawn EPERM

- **现象**：点「选择工作区」弹「无法打开文件夹: directory picker failed: spawn EPERM」。
- **做法**：不走原生目录选择器。直接往 `<DSH_HOME>/storages/workspace.json` 写一条测试 workspace（`unit` + `global.workspaceIds` + `tables.workspaces`），重启 web 后从菜单选它。

#### 10. 页面 401 不是插件问题

- **现象**：直接开 `http://127.0.0.1:<port>/` 返回 401。
- **做法**：用 `dsh web` 启动时打印的 `/?token=…` 先换 cookie，再让 playwright 访问；RPC 的 POST 也带这个 cookie 过 `requestRejection` 围栏。

#### 11. 未知端点返回 200 是设计，不是失败

- **现象**：随手调了一个不存在的端点，得到 `200` + `{ok:false,error:{details:{code:"unknown-endpoint"}}}`。
- **结论**：这是线协议刻意避免 404 泄露路由；判断 RPC 是否健康要看**已知**端点（`ping` / `cc_isCcMode` / `cc_listTargets`）。

#### 12. 升级指南要按「离开的版本」取

- `docs/upgrade-guide/README.md` 的 `## v<T>` 是「从 vT 升到下一个版本」的改动，`v0.2.2-rc.1` 那一节才是 rc.1 → rc.2。
- 索引两百多行，分段读；先按插件 surface（connection / webServer / agents / agentPresets / slots / preset 行）筛，再只读命中的 `guide.zh.md`。
- 本次 17 条只命中 3 条，其中两条无关、一条仅 macOS。

#### 13. macOS 专属项不能写成「已验证」

- `window-drag-regions` 只影响 macOS Desktop 的自定义浮层（`data-window-drag-exclude`）。Windows/Web 行为不变，本次平台测不到，只能记「待 macOS 实测」。
- 同理，任何以 `process.platform === 'darwin'` 为前提的结论，在 Windows 上只能做静态核对。

#### 14. npm 查询在沙箱里会被 cache 拦

- **现象**：`npm view @deepseek-ai/dsh versions` 报 `EPERM ... npm\_cacache\tmp`。
- **做法**：`--cache <工作区内目录>`；或直接用本机已安装的 dsh 包做审计，不必联网比对（本次目标版本正好就是本机安装版本）。

#### 15. PowerShell 输出中文乱码

- 默认 GBK 会把 utf8 输出打成乱码。所有脚本开头加 `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)`。

### 下次升级的检查单

1. 读 `DSH_INSTALL_DIR/package.json` 确认目标版本；读 `docs/upgrade-guide/README.md`，按「离开的版本」筛指南。
2. `dsh <profile> --dump-config` 确认组合（不 mount）。
3. 对目标版本的 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 与 `presets/cc.patch.yml` 逐行对。
4. 核对契约面：`connection.requestRejection`、`webServer.register({kind:"prefix"})`、`agents.currentInitiator/get`、`agentPresets.composedPreset`、三个 Client slot、`locale.register/bind`、RPC 信封。
5. 隔离实测：`npm run fixture:dump`（组合快照）→ `npm run e2e`（起 web、token 换 cookie、RPC / 写草稿 / 导出）→ DOM 三挂载点按 `AGENTS.md` §6 的 Playwright MCP 步骤看一遍。
6. `npm test` 全绿。
7. 更新 `package.json` 的 `dshReleases`、`README.md` / `README_EN.md` 矩阵、`AGENTS.md` §4、`CHANGELOG.md` 顶部小节。

---

## 2026-11：把「隔离实测」脚本化（L2 / L3）

`scripts/dump-config.mjs`（组合快照）与 `scripts/e2e-smoke.mjs`（真机 smoke）落地时踩到的坑。
结论文档在 `ROADMAP.md` §4.1，这里只记会重复踩的。

#### 1. app 参数必须写 `--profile <name>`

- **现象**：`dsh l2 web --no-open --port 6000` 直接报 `error: too many arguments. Expected 0 arguments but got 1: web.`
- **根因**：第一个位置参数是 profile 名，profile 决定挂哪个 app；`web` 被当成 app 参数传给了一个不接参数的 app。
- **做法**：统一 `dsh --profile <name> [app 参数]` —— `--profile l2 --dump-config`、`--profile e2e --no-open --port N`。

#### 2. 桌面版的 CLI 入口在 asar 里，`existsSync` 看不到

- **现象**：`Test-Path '...\resources\app.asar\dsh\lib\bin.js'` 为 false，探测脚本永远找不到 dsh。
- **根因**：`app.asar` 是归档文件，只有 Electron 打过补丁的 fs 能穿透。
- **做法**：探测只校验 `exe` + `resources/app.asar` 存在；`bin` 路径照写 —— `ELECTRON_RUN_AS_NODE=1 "<exe>" "<bin>" ...` 能正常跑。

#### 3. 子进程输出必须接文件描述符

- 与上文「cmd 负责重定向」同源：`stdout/stderr` 走管道（`stdio: 'pipe'`）在禁子进程沙箱里 EPERM。
- **做法**：`spawnSync` / `spawn` 用 `stdio: ['ignore', fd, fd]`（`fs.openSync` 一个日志文件），再去读文件。

#### 4. `process.exit` 会跳过 `finally`

- **现象**：启动失败（没等到 token URL）时，临时实例与 web 进程都留在盘上 / 内存里。
- **做法**：实例建起来之后的失败一律 `throw`，kill + 清理放 `finally`；Windows 上 `taskkill /PID <pid> /T /F` 之后等 1s 再删目录（句柄没松时 `rm` 会 EBUSY）。

#### 5. 端口与实例目录每次重建

- 用 `net.createServer().listen(0)` 拿空闲端口，别写固定端口；实例目录（`.compat-tmp/<name>-gen/`）每次 `rm -rf` 重建，避免上一次的 profile 状态污染下一次。
