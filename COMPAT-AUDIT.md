# 兼容性审计记录

每次 dsh 升级审计的**过程性记录**：结论和兼容矩阵放 `AGENTS.md` §4 与 `package.json`，这里只放「怎么把审计跑起来」、踩过的坑和可复现的命令骨架。

写法约定：坑 → 现象 → 根因 → 做法。只记会重复踩的，不记一次性路径。

---

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
5. 隔离实测：dump-config → 起 web（cmd 重定向日志）→ token 换 cookie → 三挂载点 + RPC + roster。
6. `npm test` 全绿。
7. 更新 `package.json` 的 `dshReleases`、`README.md` / `README_EN.md` 矩阵、`AGENTS.md` §4、`CHANGELOG.md` 顶部小节。
