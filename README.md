<div align="right">

[English](./README_EN.md) | 中文

</div>

# dsh-cc-studio · CCv3 角色卡工坊

[![npm version](https://img.shields.io/npm/v/@xia-sc/dsh-cc-studio?color=%237c5cff)](https://www.npmjs.com/package/@xia-sc/dsh-cc-studio)

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

DSH（DeepSeek Harness）插件：输入框上方的胶囊 → 全屏融合工坊，配合 `CC 模式` 预设让 LLM 通过 32 个 Tool **先问再填**、与你共创角色卡，最后一键导出 `JSON / PNG / CHARX`。

| 项目 | 值 |
| --- | --- |
| 包名 / 版本 | `@xia-sc/dsh-cc-studio` `0.8.2` |
| 兼容 | DSH `>=0.4.5-rc.4`（含**桌面版**）、Node `>=22`、**零运行依赖**；逐版本实测见 [兼容与权限](#兼容与权限) |
| 落盘位置 | `<DSH_HOME>/cc-library/`（角色卡）、`<DSH_HOME>/cc-drafts/`（会话草稿）；`DSH_HOME` 默认 `~/.dsh`，旧位置仍读得到 |
| 文档 | 用户文档＝本文件；改代码前必读 [AGENTS.md](./AGENTS.md)；完整历史 [CHANGELOG.md](./CHANGELOG.md) |

---

## 安装

插件同时支持 **`dsh web`（CLI 起的 Web GUI）** 与 **DSH 桌面版（DeepSeek Harness Desktop）** —— 两者是同一个宿主，插件都装进 profile 的 `dsh.profile.bundles`，功能完全一致，差别只有 profile 名和「怎么重启」。

### 🤖 给 AI Agent 的安装引导

把下面整段交给你的 Agent（DSH 里的 Agent、Claude Code、Codex 都行），它就能自己装好并验证：

```text
任务：给 DSH 安装 @xia-sc/dsh-cc-studio 插件。

4. 确认目标 profile 名：问用户，或看 ~/.dsh/profiles/ 下的目录名。
   （桌面版通常叫 desktop，CLI 起的 Web GUI 通常叫 web。）
2. 安装（把 <profile> 换成实际名字）：
   dsh plugin --profile <profile> add @xia-sc/dsh-cc-studio
   若 dsh 不在 PATH：桌面版自带 CLI 在 <安装目录>/resources/runtime/cli/bin/dsh（Windows 为 dsh.cmd）。
   命令行参数顺序固定为：dsh plugin --profile <profile> add <包名>（--profile 不能省）。
3. 验证已进入组合（只读、不启服务、不用重启）：
   dsh --profile <profile> --dump-config
   期望在 `# == @xia-sc/dsh-cc-studio` 那一层下看到两行：`id: dsh-cc-studio`（宿主行）与 `id: preset-cc`（CC 预设行）。
4. 告诉用户重启：宿主行只在启动时组合 —— CLI 重启 `dsh web`，桌面版退出并重新打开应用。
5. 重启后可选自检：在「CC 模式」会话里调任意一个 cc_* 工具，返回里带 "build": "0.8.2" 即说明新代码已加载
   （这也是判断「改了但没重启」的唯一可靠依据）。
6. 不要做的事：
   - 不要手工把 presets/ 拷进 ~/.dsh/.agent-presets/（dsh >= 0.4.7-alpha.4 已不读该目录，拷了也不生效）；
   - 不要手改 ~/.dsh/profiles/*/package.json（dsh plugin 会自己维护 dsh.profile.bundles）；
   - 不要为了「验证」反复重装 —— 装不上先看第 3 步的 dump-config 输出。

权限提醒：插件要写 <DSH_HOME>/cc-drafts/ 与 <DSH_HOME>/cc-library/（默认 ~/.dsh 下）。
在 DSH 会话里由 Agent 执行安装时，这些路径在工作区之外，需要先把文件权限切到 danger-full-access；用户在终端自己执行则无此限制。
```

### 手动安装

```bash
# 从 npm 安装（推荐）
dsh plugin --profile web add @xia-sc/dsh-cc-studio
dsh plugin --profile web add @xia-sc/dsh-cc-studio@0.8.2    # 锁定版本

# 从 GitHub 源安装（可加 #v0.8.2 / #master 指定 tag / 分支）
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# 从本地仓库安装（开发 / 调试）：装出来是 link:，改 lib/*.js 重启即生效
git clone https://github.com/xia-sc/dsh-cc-studio.git && cd dsh-cc-studio
dsh plugin --profile web add .
```

`dsh plugin` 只是把参数转发给 profile 目录里的 pnpm，装完会把包名自动追加进该 profile 的 `dsh.profile.bundles`，不用手改 `package.json`。

- **桌面版**：应用内左侧「插件」面板搜索 `@xia-sc/dsh-cc-studio` 安装，或用 `dsh plugin --profile desktop add @xia-sc/dsh-cc-studio`；生效方式是**退出并重新打开应用**（窗口里的刷新不足以加载宿主改动）。
- **CC 预设无需手工操作**：插件会自己把 `CC 模式` 带到 roster 里（≥ `0.4.7-alpha.4` 走随包补丁层 `presets/cc.patch.yml` 的声明行；≤ `0.4.6-alpha.2` 由插件挂载时装到 `<DSH_HOME>/.agent-presets/cc`）。升级 dsh 后若 `CC 模式` 从列表里消失，见下方常见问题。
- **包名迁移**：0.3.2 起由 `@dsh-plugins/dsh-cc-studio` 改为 `@xia-sc/dsh-cc-studio`（旧名不在本项目的 npm scope 下）。装过旧名的先 `remove` 再 `add`；`cc-library/`、`cc-drafts/` 与插件设置都不受影响。

### 更新与卸载

```bash
dsh plugin --profile web add @xia-sc/dsh-cc-studio@latest   # 更新到 npm 最新版
dsh plugin --profile web remove @xia-sc/dsh-cc-studio       # 卸载（同时移出 dsh.profile.bundles）
```

卸载**不会**删除 `~/.dsh/cc-library/` 与 `~/.dsh/cc-drafts/` 里的角色卡和草稿。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| 输入框上方没有胶囊 | 先确认当前会话模式是 `CC 模式`；再 `dsh --profile web --dump-config` 看有没有 `preset-cc` 行，并到设置 →「Agent 预设」看 `CC 模式` 是否带「加载失败」诊断；**改动宿主/预设后必须重启 dsh + 刷新页面** |
| 找不到诊断入口 | 完整台账用 `POST /api/pluginInventory/list`（看 `agentPresets` 里 `cc.broken` 是否为空、`cc-agent` 的 `fiberPhase` 是否 `active`）；插件的日志只进 Cordis logger，**不会**出现在 `dsh web` 的 stdout，别靠 grep 判断装没装上 |
| 重启后浏览器报 `Failed to load plugins` / `web boot: 4 entry did not activate` | 包名迁移后没按新名重装（profile 里的安装身份还是旧名）。看一眼 `~/.dsh/profiles/web/node_modules/` 下的目录名是否等于 `package.json` 的 `name`；修法是按新名重装 → 重启 → **硬刷新**（`Ctrl+Shift+R`） |
| 工坊顶部橙条「草稿已新建」 | 该会话没有历史草稿（首次使用或草稿目录被清）。已存档会话恢复时是蓝条并显示 `creation_date`，下次写入后提示消失 |
| 改完代码没变化 | 分三层看：改 `lib/client.js` → 刷新页面；改 `lib/index.js`（宿主）或预设 → **重启 dsh（桌面版重启应用）**；先看一眼工具返回里的 `build` 是不是你以为的版本 |

---

## 快速上手

4. 新建会话，会话模式选 **CC 模式** —— 胶囊随即出现在输入框上方，后台会把 CC 预设挂上。
2. 直接说需求，例如「我想做雨城记忆典当行老板娘，世界观很薄」。
3. 模型按 **6 步**推进，每步先用 4-2 个开放问题问你的偏好，再落笔；每次调用 Tool，胶囊与工坊实时刷新：
   `cc_get_card`（总结进度 + 提问）→ `cc_patch_character`（气质/关系 → 四件套）→ `cc_patch_world`（世界侧重 → ≥3 维 + `autoLorebook`）→ `cc_add_lorebook_entries`（触发词 → ≥5 条，至少 4 条 `constant`）→ `cc_patch_greetings`（开场场景 → 问候语）→ `cc_validate`。
4. 随时点胶囊进工坊手改。校验通过后：侧栏 `★ 保存当前`（已载入 ID 时原地覆盖，否则新建）、`＋ 另存为新`，或导出 `JSON / PNG / CHARX`；也可以直接对模型说「帮我载入 ID xxxx」。

---

## 功能

### 融合工坊（客户端）

- **布局**：胶囊（CC 模式下常驻）→ `shell.overlay` 全屏工坊；左侧 3 页导航（**5 维世界观 / 角色细化 / 世界书**）+ 左下角「**校验导出**」，中部自适应阅读区，右侧 268px 可折叠「已存角色」（收起成 40px 竖条）。主区底部两块默认收起：实时 `card.json` 预览与 CBS 速查。
- **导出入口只有两处**（0.4.4 归一）：左下角「校验导出」与卡片上的「导出」，打开的是同一个导出页（`JSON / PNG / 写入PNG / CHARX / 校验`）。导出页导出的**永远是当前工坊里的卡**（标题后带卡名），要导某张已存卡请先「载入」——卡片按钮点下去会先变成「已切到 ✓」，若那张卡尚未载入，页内会给出醒目提示。
- **文档式阅读排版**：字段是无边框 textarea、按内容自动撑高，点进去即可改；长文点「⛶」开 720px 大框（带打开时快照，「取消」真回滚）。写作是主线，手动编辑是次要入口。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `autoLorebook` 自动生成带 `@@position / @@depth / @@activate` 的条目（至少 4 条 `constant`；再次调用覆盖旧自动条目、保留手工条目）。
- **ID 化 CRUD**：`★ 保存当前`（已载入时原地覆盖）/ `＋ 另存为新` / `✎ 重命名` / `＋ 新建` / 载入 / 删除，搜索、高亮当前卡，落盘 `<DSH_HOME>/cc-library/<id>.json`。
- **导入导出**：`⬆ 导入 JSON/PNG/CHARX` 自动识别容器；`⬇ JSON`、`⬇ PNG`（4×4 占位图）、`⬆ 写入 PNG`（写入你上传的任意 PNG，自动剥离旧 `ccv3/chara` 块并重算 CRC32）、`⬇ CHARX`（打包 `card.json`）。
- **中英双语 + 深浅色**：完整 `zh / en` 词表，跟随 `设置 → 通用 → 语言` 实时切换；配色走 `var(--dsw-alias-*)`，主操作固定品牌紫 `#7c5cff`。

### CC 模式（模型侧 32 个 Tool）

**6 步工作流 + 共创约束**：每步前必须先问偏好，严禁无讨论就一次性填满；世界书的完成态是「**≥5 条且至少 4 条共创**」（纯自动条目不算完成）。每次返回只有一份 `workflow.next`（下一步）+ `workflow.state`（四项三态进度）+ `message`（给用户的一句话），另有 `build` 标明插件版本。

| 分类 | 工具 |
| --- | --- |
| 工作流（必调） | `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate` |
| 世界书质量 | `cc_simulate_trigger`（拿一句用户会说的话验命中）/ `cc_lint_lorebook`（静态体检，含**最坏情况单次触发量**）/ `cc_patch_book_meta`（命名 / `scan_depth` / `token_budget` / 递归扫描） |
| 条目管理 | `cc_update_lorebook_entry` / `cc_delete_lorebook_entries` |
| 导出与起点 | `cc_preview_export`（体积、估算 token、字段清单、重复内容量）/ `cc_new_card`（破坏性，须用户同意后带 `confirm:true`） |
| 人物关系（0.8.0） | `cc_get_relations` / `cc_patch_relations` / `cc_render_relations` / `cc_group_check` |
| 共享世界书（0.9.0） | `cc_get_shared_book` / `cc_patch_shared_book` / `cc_promote_shared_entries` / `cc_apply_shared_book` |
| 分组管理（0.8.0） | `cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group` |
| 已存库 CRUD | `cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry` |

几条值得知道的约定：

- `cc_patch_world` 的 **`loreKeys`**：为每一维自报触发词（真实对话里用户会说的实体名）。不给的话自动条目只能用维度名当 key，**真实对话永远命中不了**。同一实体被分给多个维度时会当场警告。
- **载入后直接保存会更新原卡**（草稿旁记着来源 id），不会再莫名多出一张同名重复卡；改名同时改列表名与卡内 `data.name`。
- 写类工具支持 **`expectedRev` 乐观锁**；不传也会在返回里给 `revDrift` 与 `draftStatus.watchedRev`，多端同时改卡时不会静默覆盖。
- 工具返回的 `build` 与 `package.json` 的 `version` 同步 —— 能一眼确认当前跑的是哪一版代码。
- **分组的增删改查模型侧也能做**（0.8.0 补）：`cc_create_group` 建组、`cc_set_card_group` 把卡放进/换/移出（`cardId` 省略 = 当前草稿的来源卡，**不传 `groupId` = 移出**）、`cc_delete_group` 是破坏性操作须显式 `confirm:true`。**移出分组不删节点与关系**（挪回来关系还在），**删组不删卡**（只清成员卡的 `meta.groupId`）。

### 群聊与人物关系（0.8.0）

做一批「互相有关系的卡」时，CCv3 没有关系字段 —— 硬造会污染导出、别的客户端也不认。所以分成两层：

- **插件层图谱是真源**：在工坊右侧「已存角色」里新建**分组**，把同一世界观的角色拉进去，再用分组旁的「关系」按钮打开**关系视图**维护关系 —— 三维 = **方向（A→B 与 B→A 可以不同）× 类型（师徒 / 恋慕 / 敌对…40 类）× 强度（4-5）**。节点有两类：有独立卡的角色，以及**卡内 NPC**（如「柳长老」，没有自己的卡）—— 所以同一张图谱既能服务多卡群聊，也能让单卡「立体」。数据落在 `<DSH_HOME>/cc-groups/`，**不写进卡的任何 CCv3 字段**。
- **渲染让卡自包含**：「渲染到当前卡」会把「我的关系」写进 `description` 的固定标记区（`<!-- cc-relations:begin --> … <!-- cc-relations:end -->`），分享出去的卡别人拿到就能用；重复渲染是**替换**，不会越写越长。模型侧对应 `cc_render_relations`（支持 `dryRun` 预览）。
- **跨卡体检**（关系视图的「体检」/ `cc_group_check`）会报：孤儿节点（卡已删）、悬空关系、重名节点、未渲染或已过期的关系段，以及**群聊每轮固定开销**（成员卡常驻条目之和 vs 预算）—— 群聊的开销是「乘法」：5 张卡各带一条常驻，每轮就是 5 份。
### 校验与导出

- 宿主实时校验：`spec: chara_card_v3` / `spec_version: 3.0` / `group_only_greetings` 必填、主图标唯一、正则合法；`cc_validate` 另给逐项 errors 与 warnings（缺字段、keys 质量问题、预算等）。
- CCv3 字段全覆盖：`name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`，支持 CBS `{{char}} / {{random}} / {{roll}}`。规范依据：[CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）。

---

## 兼容与权限

上架元数据（`dsh.compatibility` / `engines` / 运行依赖）与权限边界集中在这里，DSH STORE 的固定源审查读的也是这几处。

| 项 | 值 |
| --- | --- |
| DSH 兼容范围 | `>=0.4.5-rc.4`；逐版本矩阵里 `0.4.5-rc.4` / `0.4.5-rc.2` / `0.4.6-alpha.4` / `0.4.6-alpha.2` / `0.4.7-alpha.4` / `0.4.7-rc.4` / `0.2.0-rc.2` 为 `compatible`。**没实测过的版本不写**（`0.4.7-alpha.2` / `0.4.7-rc.2` / `0.2.0-rc.4` / `0.2.4-alpha.4` 保持未声明） |
| 宿主形态 | `dsh web`（CLI）与 **DSH 桌面版**同一套宿主 + profile bundles 机制，**均支持** |
| 客户端平台 | `dsh.client.platform: "web"` 是**浏览器半**的平台标识，与 profile 名（`web` / `desktop`）不是一回事；两者加载同一份客户端 bundle |
| 运行依赖 / 生命周期脚本 | **都没有**。`lib/*.js` 只 `import` `node:` 内建与相对路径，随包补丁与预设是静态 YAML |
| 权限 · 文件 | 只读写 `<DSH_HOME>`（含旧根 `~/.dsh`）下自己的五个目录：`cc-drafts/`、`cc-library/`、`cc-groups/`、`cc-books/`、`.agent-presets/cc/`（最后一个只在 dsh ≤ `0.4.6-alpha.2` 上写），另读自身 `package.json` |
| 权限 · 网络 / 命令 / 凭据 | 无网络请求、不起子进程、不读也不存任何 token 或 cookie。只读两个环境变量：`DSH_HOME`、`DSH_CC_STUDIO_PRESET_INSTALL`。HTTP 路由复用宿主自己的 cookie 围栏（`connection.requestRejection`），插件不解析凭据 |

> **为什么商城不会给它「自动通过」**：STORE 的自动低风险通道要求运行时代码完全不出现文件 / 网络 / 命令 / 凭据四类信号，而本插件的核心功能就是草稿与角色卡落盘（文件信号）并读 `DSH_HOME`（扫描器把任何 `process.env` 读取都算凭据信号）。这两条不会为了迎合扫描器而消除 —— 对这类合法插件，商城的正确档位是 `user-reviewed`。隔离环境下的安装 / 启动 / 卸载证据见 [CHANGELOG.md](./CHANGELOG.md) 的 `0.3.7` 小节。

---

## 开发与测试

```bash
npm test                                    # 14 个文件、604 项断言，全绿才算过
node tests/tools-contract.test.mjs          # 只跑 CC 工具链契约（97 项）
```

- 改 `lib/client.js`：刷新页面即可；改 `lib/index.js` / 预设：**重启 dsh**。
- 架构与约定（三半分工、RPC 线协议、预设两代投递、落盘根、测试隔离要求、常见坑）都在 [AGENTS.md](./AGENTS.md) —— 动代码前先读它。

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。最近三版都是「另一个 LLM 以工具使用者身份跑回归」挖出来的问题：

- `0.8.2` **群聊卡这一整段迭代的正式发版**：关系图谱（`<DSH_HOME>/cc-groups/`，三维 = 方向 × 类型 × 强度；节点分「有独立卡的角色」与「卡内 NPC」）+ `cc_render_relations` 把关系渲染进 `description` 的固定标记区让卡自包含（幂等、可 `dryRun`、空图谱 = 清空）；随后补齐**模型侧的分组增删改查**（`cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group`）、新增**组级共享世界书**（`<DSH_HOME>/cc-books/`，一组一本、文件本身就是 CCv3 官方 `lorebook_v3` JSON，`cc_promote_shared_entries` 一键把成员卡里逐字重复的条目提升进去并从各卡删除），并把工坊左侧改成**卡片结构导航**（总览 / 角色 / 世界观 / 世界书 / 开场与示例 / 关系与分组 / 共享世界书，每项带三态进度徽章）。工具 19 → 32。修的既有问题：**B4** 工具半保存一次就把卡踢出分组（两半 `makeLibraryEntryMeta` 漂移）、**B5** `mutual` 对等边完全不渲染、**关系视图「关系 · 0」与导航 0 条**（客户端读错宿主返回形状 —— 边在 `group` 里）、**换卡后关系视图不换组**。测试 509 → 604 项（14 个文件）。**需重启 dsh（桌面版重启应用）→ 刷新页面**。
- `0.7.1` 修 **B4**：dsh 重启后第一次 `cc_get_card` 报 `value is not lossless JSON` —— DSH 对返回值做 lossless-JSON 校验，**任何嵌套 `undefined` 都会让整次调用失败**，而外部导入的卡（PNG / CHARX）可能整个缺 `spec_version` / `creation_date`。三层修法：加载即补齐（`normalizeCardShape`）、`creation_date` 兜底 `null`、返回前统一 `sanitizeJson()`。另加 `build` 版本标识与 `watchedRev`，`changed` 与 `rev` 改用同一套判据。
- `0.7.0` 修 **N2**：长五维 + autoLorebook 原文照搬会让**一句话**吃满整份世界书预算（实测 1139 token / 预算 1200），而调大 `token_budget` 还能把告警一并消掉 → `cc_lint_lorebook` 新增**最坏情况单次触发量**。另修：`creator` 此前**没有写入路径**（validate 却一直催）、主动重置不再被误报「内容可能已丢失」、不传 `expectedRev` 也会提示 `revDrift`、空改动不再消耗 `rev`。
- `0.6.0` 修 **P0-6**：草稿被外部（工坊 / host 恢复）换掉时模型完全无感知，实测因此误伤过另一张卡 → 每个返回都带 `cardName` / `cardId` / `rev`，`getDraft()` 以盘为准重载，写类工具支持 `expectedRev` 乐观锁。
- `0.5.0` 第一轮 LLM 测试的整轮修复：`loreKeys` 解决「自动条目是死条目」、世界书完成态改为「≥5 条且 ≥1 条共创」、`cc_validate` 有了终态、载入后保存不再产生重复卡，并新增 5 个工具（14 → 19）。

**改完后记得**：宿主/预设改动要重启 dsh（桌面版重启应用），客户端改动刷新页面即可。

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## 收录

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
