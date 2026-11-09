# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。**只保留 0.12.0 起的版本**；0.11.x 及更早见 git 历史。

格式：最新版本按「新增 / 修复」写；更早的小节按现象 → 根因 → 修法 → 生效方式。

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
