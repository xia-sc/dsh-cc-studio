<div align="right">

[English](./README_EN.md) | 中文

</div>

# dsh-cc-studio · CCv3 角色卡工坊

[![npm version](https://img.shields.io/npm/v/@xia-sc/dsh-cc-studio?color=%237c5cff)](https://www.npmjs.com/package/@xia-sc/dsh-cc-studio)

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

DSH（DeepSeek Harness）插件：输入框上方的胶囊 → 全屏融合工坊，配合 `CC 模式` 预设让 LLM 通过 14 个 Tool **先问再填**、与你共创角色卡，最后一键导出 `JSON / PNG / CHARX`。

| 项目 | 值 |
| --- | --- |
| 插件包名 | `@xia-sc/dsh-cc-studio` |
| 当前版本 | `0.4.1` |
| 兼容与权限 | DSH `>=0.1.5-rc.1`、Node `>=22`、**零运行依赖**；权限边界见 [兼容与权限](#兼容与权限) |
| 宿主 RPC | `/dsh-cc-studio-rpc`（自带路由，适配 dsh ≥ `0.1.5-rc.1`；已在 `0.1.6-alpha.2` / `0.1.7-alpha.1` / `0.1.7-rc.1` 实测） |
| CC 预设 | `presets/cc.patch.yml`（dsh ≥ `0.1.7-alpha.1`，组合声明行）／`<DSH_HOME>/.agent-presets/cc`（≤ `0.1.6-alpha.2`，目录形态） |
| 客户端挂载点 | `conversation.input.dock`（胶囊）+ `shell.overlay`（工坊）+ `settings.section` |
| 落盘位置 | `<DSH_HOME>/cc-library/`（角色卡）、`<DSH_HOME>/cc-drafts/`（会话草稿）；`DSH_HOME` 默认 `~/.dsh`。0.3.6 起认 `DSH_HOME`，旧的 `~/.dsh` 位置**仍然读得到**（读时回退） |

## 安装

本插件同时支持 **`dsh web`（CLI 起的 Web GUI）** 与 **DSH 桌面版（DeepSeek Harness Desktop）**：两者是同一个 dsh 宿主，插件都装在 profile 的 `dsh.profile.bundles` 里，加载方式与全部功能完全一致。下面以 `web` profile 为例；桌面版的差异只有 profile 名与「重启应用」这一步，见下文 **[7. 桌面版](#7-桌面版deepseek-harness-desktop)**。

### 1. 从 npm 安装（推荐）

```bash
dsh plugin --profile web add @xia-sc/dsh-cc-studio

# 锁定版本
dsh plugin --profile web add @xia-sc/dsh-cc-studio@0.4.0
```

**或从 GitHub 源安装**：

```bash
dsh plugin --profile web add github:xia-sc/dsh-cc-studio
```

`dsh plugin` 只是把参数转发给 profile 目录（`~/.dsh/profiles/web`）里的 pnpm；装完 dsh 会把 `@xia-sc/dsh-cc-studio` 自动追加到该 profile 的 `dsh.profile.bundles`，不需要手改 `package.json`。

> **0.3.2 起包名由 `@dsh-plugins/dsh-cc-studio` 改为 `@xia-sc/dsh-cc-studio`**（前者不是本项目持有的 npm scope，发布不出去）。装过旧名的先按「5. 更新与卸载」移除旧包再装新包；`~/.dsh/cc-library/`、`~/.dsh/cc-drafts/`、`~/.dsh/.agent-presets/cc/` 以及插件设置都不受影响。

- **锁定版本 / 指定分支**：`github:xia-sc/dsh-cc-studio#v0.3.0`、`...#master`（tag 见仓库 Tags）。
- **`allowBuilds` 提示**：本插件没有 `prepare` 构建脚本，正常安装不会触发 pnpm 的构建拦截；若 pnpm 仍打印该提示，把提示里给出的键加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑。
- **在 DSH 会话里由 Agent 执行时**：写入位置在会话工作区之外，需先把文件权限切到 `danger-full-access`；自己在终端执行则无此限制。

### 2. 从本地仓库安装（开发 / 调试）

```bash
git clone https://github.com/xia-sc/dsh-cc-studio.git
cd dsh-cc-studio
dsh plugin --profile web add .
```

相对路径按**你执行命令时所在的目录**解析（dsh 会先把 `.`、`./xxx` 重写成绝对路径再交给 pnpm，避免误链到 profile 目录）。装出来的是 `link:` 到源码目录：改 `lib/*.js` 后重启 dsh web 生效；只改 `lib/client.js` 时刷新页面即可（若同时跑着 dsh 仓库的 `pnpm run dev:web`，客户端 bundle 会重建，连刷新都省了）。

### 3. CC 预设（随插件自动可用，无需手工拷贝）

装完插件、重启 `dsh web` 后即可在会话模式里选到 `CC 模式`（preset id 恒为 `cc` —— 宿主 `isCcPreset()` 与浏览器 `CC_PRESET_ID` 都按它精确比较）。**投递方式按 dsh 版本分两代，两代都不需要你手工拷文件**：

| dsh 版本 | 预设从哪来 | 你要做什么 |
| --- | --- | --- |
| ≥ `0.1.7-alpha.1` | 插件随包带的补丁层 `presets/cc.patch.yml`：往组合里 insert 一行 `@deepseek-ai/dsh-agent-preset` 的**声明**（与内置 `standard` / `ptc` / `minimal` / `cordis` 完全同构） | 什么都不用做 |
| ≤ `0.1.6-alpha.2` | 插件挂载时把 `presets/cc` 装到 `<DSH_HOME>/.agent-presets/cc`（目录形态，行为与 0.3.5 之前一致） | 什么都不用做 |

**为什么 0.1.7 必须换机制**：那一版起 dsh 的预设**只来自组合里的声明行**，`<DSH_HOME>/.agent-presets/` 已经没有任何代码读取 —— 升级后 `CC 模式` 从 roster 里消失就是这个原因：目录还在，只是**没人再看它**。插件因此把声明写进 `package.json` 的 `dsh.bundle.patch` 第二层（第一层是宿主插件行），插件装进哪个 profile，`CC 模式` 就出现在哪个 profile 的 roster 里；新版上**不会再往磁盘写一个字**。

**关掉 `CC 模式`（≥ `0.1.7-alpha.1`）**：不必卸载插件，在自己的补丁层里按 id 关掉那一行即可（`<profile>/cordis.patch.yml`，或对所有 profile 生效的 `$DSH_HOME/cordis.patch.yml`）：

```yaml
- id: preset-cc
  name: '@deepseek-ai/dsh-agent-preset'
  disabled: true
```

<details>
<summary>≤ 0.1.6-alpha.2：目录安装的更新策略、开关与手工兜底</summary>

**旧版上插件挂载时仍会把 `presets/cc` 装到 `<DSH_HOME>/.agent-presets/cc`**（`DSH_HOME` 默认 `~/.dsh`），目录名固定为 `cc`。之所以需要这一步：那条路径上 dsh 的预设发现只扫三个根——**shipped 根**（`dsh-agent-presets` 包内自带）+ **部署 `config.roots`** + **用户根 `<DSH_HOME>/.agent-presets`**；插件包内的 `presets/` 不在其中，**「随包分发」≠「已注册」**，所以由插件在启动时把它装进用户根。

更新策略是幂等的，且**绝不静默覆盖你的改动**：

| 目标文件状态 | 行为 |
| --- | --- |
| 不存在 | 写入模板 |
| 与模板一致 | 不动（只补记安装记录） |
| 与插件上次写入的内容一致（你没改过） | 插件升级时安全更新 |
| 你改过 / 是旧版手工拷贝（无安装记录） | **保留并告警**，不覆盖 |

安装记录是预设目录里的 `.dsh-cc-studio-preset.json`（记版本与各文件写入时的 sha256）。若出现「已保留未覆盖」的告警而你想改用插件模板，二选一：

```powershell
# A. 删掉旧目录，重启 dsh web 即重新自动安装
Remove-Item "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force
```

```bash
# B. 用环境变量强制覆盖后重启 dsh web（macOS / Linux）
DSH_CC_STUDIO_PRESET_INSTALL=force dsh web   # auto（默认）| force | off
```

```powershell
# B. 同上（Windows PowerShell）
$env:DSH_CC_STUDIO_PRESET_INSTALL = 'force'; dsh web
```

> 也可在插件行声明 `config.presetInstall`（需自己写 overlay patch），它的优先级高于环境变量。`off` 时请按下面的手工方式自行管理预设。

<details>
<summary>手工安装（仅在自动安装被关闭或失败时需要）</summary>

```powershell
# Windows PowerShell（GitHub 安装）
$src = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-plugins\dsh-cc-studio\presets\cc"
Copy-Item $src "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force

# 本地仓库开发时改用：$src = ".\presets\cc"
```

```bash
# macOS / Linux（GitHub 安装）
mkdir -p ~/.dsh/.agent-presets/cc
cp -R ~/.dsh/profiles/web/node_modules/@xia-sc/dsh-cc-studio/presets/cc/. ~/.dsh/.agent-presets/cc/
```

> 若你自定义了 `DSH_HOME`，把上面命令里的 `~/.dsh` / `%USERPROFILE%\.dsh` 换成该路径；插件本体位于 `<DSH_HOME>/profiles/web/node_modules/@xia-sc/dsh-cc-studio/`。

`agent.cordis.yml` 在一份 `standard` 拷贝上追加 `id: cc-studio-agent, name: '@xia-sc/dsh-cc-studio/agent'`，并把 `persona` 改为「共创搭档」——先问再填、每步 1-2 问。切换会话模式后胶囊自动出现。

> 手工拷贝的目录**没有**安装记录，因此会被自动安装流程视为「你的自有文件」而跳过；想交回插件管理，删掉该目录后重启即可。

> 升级到 `0.1.7-alpha.1` 后这个目录既不会被读取也不会再被写入：插件**不会**替你删任何东西，想删就自己删（`Remove-Item "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force`）。

</details>

> 卸载/删除插件**不会**删除 `<DSH_HOME>/.agent-presets/cc/`（自动安装也不注册删除动作）。

### 4. 重启与验证

```bash
# 宿主行在启动时组合，装完必须重启 dsh web
dsh web

# 配置里应出现插件行
dsh --profile web --dump-config | findstr dsh-cc-studio   # Windows
dsh --profile web --dump-config | grep dsh-cc-studio      # macOS / Linux

# —— 以下两项自检需要会话 cookie：用 dsh web 启动时打印的 token 换取 ——
TOKEN='<dsh web 打印的 token>'
COOKIE=$(curl -s -D - -o /dev/null "http://127.0.0.1:3080/?token=$TOKEN" \
  | sed -n 's/^[Ss]et-[Cc]ookie:[[:space:]]*\(dsh-auth-[^;]*\).*/\1/p' | head -1)

# 客户端资源应返回 200。地址形如 /plugins/??<包名>/client.js&rev=<内容哈希>：
# 缺 ?? 或缺 rev 都会 404，而 rev 每次改 lib/client.js 都会变，所以从首页里取。
ASSET=$(curl -s http://127.0.0.1:3080/ -H "cookie: $COOKIE" \
  | grep -o '/plugins/??@xia-sc/dsh-cc-studio/client\.js&rev=[0-9a-f]*' | head -1)
curl -s -o /dev/null -w "%{http_code}  $ASSET\n" "http://127.0.0.1:3080$ASSET" -H "cookie: $COOKIE"
# -> 200  /plugins/??@xia-sc/dsh-cc-studio/client.js&rev=…

# RPC 自检（与其它 /api 同源：需要宿主/Origin 围栏 + 会话 cookie）
curl -s http://127.0.0.1:3080/dsh-cc-studio-rpc/ping \
  -H 'content-type: application/json' \
  -H "cookie: $COOKIE" \
  --data '{"type":"client-request","rpcId":"smoke","method":"ping","payload":{}}'
# -> {"type":"server-response","rpcId":"smoke","result":{"ok":true,"value":{"ok":true,"time":...}}}
```

Windows PowerShell 等价写法（`rev` 同样从首页取）：

```powershell
$TOKEN='<dsh web 打印的 token>'
$s=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null=Invoke-WebRequest "http://127.0.0.1:3080/?token=$TOKEN" -WebSession $s -UseBasicParsing
$idx=(Invoke-WebRequest 'http://127.0.0.1:3080/' -WebSession $s -UseBasicParsing).Content
$asset=[regex]::Match($idx,'/plugins/\?\?@xia-sc/dsh-cc-studio/client\.js&rev=[0-9a-f]+').Value
Invoke-WebRequest "http://127.0.0.1:3080$asset" -WebSession $s -UseBasicParsing | Select-Object StatusCode
```

首页（`/`）与 RPC 端点都受会话 cookie 保护，不带 cookie 会得到 `401 dsh web authentication required`，这是正常行为，不代表插件没装上。会话 cookie 的**名字不是** `dsh-auth-127.0.0.1:3080`，而是 `dsh-auth-` + base64url(sha256(权威段))，本机即 `dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw`——从浏览器 devtools 抄，或用上面的 token 换取。另外，资源地址 `/plugins/??…&rev=…` 本身不走鉴权，缺 `??` / `rev` 只会 404，别把 404 误判成鉴权问题。浏览器刷新页面后切到 `CC 模式` 会话，输入框上方出现胶囊即安装成功。

### 5. 更新与卸载

```bash
# 更新到 npm 上的最新版
dsh plugin --profile web add @xia-sc/dsh-cc-studio@latest

# 更新到默认分支（master）最新提交：重新执行 add，pnpm 会重新解析
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# 若解析未前移，先移除再装
dsh plugin --profile web remove @xia-sc/dsh-cc-studio
dsh plugin --profile web add @xia-sc/dsh-cc-studio@latest

# 卸载（dsh 会同步把它从 dsh.profile.bundles 移除）
dsh plugin --profile web remove @xia-sc/dsh-cc-studio
```

**从旧包名 `@dsh-plugins/dsh-cc-studio` 迁移**：包名变了就是另一个包，必须显式换掉，否则 `dsh.profile.bundles` 里会留下一行永远解析不到的旧名。

```bash
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
dsh plugin --profile web add @xia-sc/dsh-cc-studio
```

记录在 `~/.dsh/cc-library/` 的角色卡与 `~/.dsh/cc-drafts/` 的会话草稿不会被卸载流程删除。

### 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 输入框上方没有胶囊 | 确认当前会话模式是 `CC 模式`；**dsh ≥ `0.1.7-alpha.1`**：`dsh --profile web --dump-config` 里应看到 `- id: preset-cc`（在 `# == @xia-sc/dsh-cc-studio` 那一层下），再看设置 →「Agent 预设」里 `CC 模式` 是否带「加载失败」诊断；**≤ `0.1.6-alpha.2`**：确认 `~/.dsh/.agent-presets/cc/` 下 `preset.yml` 与 `agent.cordis.yml` 都在且目录名是 `cc`（正常应由插件自动安装）；两种情况都要重启 dsh web 后刷新页面 |
| 想直接读预设台账（诊断用） | dsh 把每个 Remote 挂成 `POST /api/<namespace>/<method>`，envelope 与 connection RPC 相同（cookie 用 `/?token=…` 换）。`/api/agentPresets/list` 会剥掉 `name` 与 `broken`，**完整台账**要 `/api/pluginInventory/list`（看 `agentPresets` 里 `cc` 的 `broken` 是否为空、`cc-agent` 的 `fiberPhase` 是否 `active`）。另注：插件的 `info` 日志只进 Cordis logger，**不会**出现在 `dsh web` 的 stdout/stderr —— 别指望 grep `[dsh-cc-studio]` 判断装没装上 |
| 工坊出现橙色条「草稿已新建」 | 该会话没有历史草稿（首次创建或草稿目录被清）；已存档会话恢复时会改为蓝色条并显示 `creation_date`，下次写入后提示消失 |
| 切 CC 模式报 `invalid config: S.prefix missing required value` | `presets/cc/agent.cordis.yml` 是 0.2.22 之前的旧版（persona 用了 `text:`），重新拷贝新模板 |
| dsh 启动报 `cannot get property "webServer" without inject` | 插件版本低于 0.2.22，更新插件 |
| 校验报错 | 必填 `spec: chara_card_v3` / `spec_version: 3.0` / `group_only_greetings`；主图标需唯一；正则需合法 |
| 重启后浏览器报 `Failed to load plugins` / `web boot: 1 entry did not activate` / `import failed` | 包名迁移后**没有按新名重装**：profile 里的安装身份（`dsh.profile.bundles` 那行与 `dependencies` 里的 `link:`）还是旧名 `@dsh-plugins/dsh-cc-studio`，而包内 `package.json` 与 `lib/client.js` 已改叫 `@xia-sc/dsh-cc-studio`，客户端资源就解析不上（宿主照样起，只有浏览器那一半挂）。看一眼 `~/.dsh/profiles/web/node_modules/` 下的目录名是否等于 `package.json` 的 `name` 即可确认；修法是按新名重装（见「5. 更新与卸载」的迁移命令）→ 重启 `dsh web` → **硬刷新**（`Ctrl+Shift+R`；旧页面的引导图是缓存，普通刷新会复现同一句错） |

### 7. 桌面版（DeepSeek Harness Desktop）

**桌面版就是同一个 dsh 宿主**（Electron 内嵌），插件照样装在 profile 的 `dsh.profile.bundles` 里，所以本插件**不需要任何额外适配**：三个客户端挂载点（胶囊 / 工坊 / 设置页）、`CC 模式` 预设、RPC 通道、草稿与角色卡落盘，都与 `dsh web` 一模一样（0.4.0 在桌面版 profile 上实测跑通全流程：胶囊 → 工坊 → 导入导出 → 草稿落盘）。

差异只有「怎么装」和「怎么生效」两步：

| | `dsh web`（CLI） | 桌面版 |
| --- | --- | --- |
| 安装 | `dsh plugin --profile web add @xia-sc/dsh-cc-studio` | 应用内左侧「插件」面板安装 `@xia-sc/dsh-cc-studio`；装了 CLI 的话也可以用 `dsh plugin --profile desktop add @xia-sc/dsh-cc-studio` |
| profile | 一般是 `web` | 一般是 `desktop`（`~/.dsh/profiles/desktop`），以应用内显示为准 |
| 宿主 / 插件改动 | 重启 `dsh web` | 退出并重新打开桌面应用 |
| 只改客户端（`lib/client.js`） | 刷新页面 | 在应用窗口里刷新（找不到刷新入口就重启应用） |
| 数据位置 | `<DSH_HOME>/cc-drafts/`、`<DSH_HOME>/cc-library/`（默认 `~/.dsh`） | 同上，桌面版共用同一套 `DSH_HOME` 与落盘目录 |

> 桌面版的应用窗口本身就是它的 Web GUI（端口由应用分配），所以「重启应用」≈ 重启宿主、「刷新窗口」≈ 刷新页面，排查问题时两者可以混用。

## 快速上手

1. 新建会话，会话模式选 **CC 模式**（胶囊随即出现在输入框上方）。
2. 直接说需求：「我想做雨城记忆典当行老板娘，世界观很薄」。
3. LLM 按 6 步推进，每一步都会先问你 1-2 个问题再落笔；每次调用 Tool，胶囊与工坊实时刷新：
   `cc_get_card`（总结进度并提问）→ `cc_patch_character`（讨论气质/关系后填四件套）→ `cc_patch_world`（讨论世界侧重后补 ≥3 维，`autoLorebook`）→ `cc_add_lorebook_entries`（讨论触发词后补 ≥5，至少 1 条 `constant`）→ `cc_patch_greetings`（讨论场景后补问候语）→ `cc_validate`。
4. 随时点胶囊进工坊手改。校验通过后：侧栏 `★ 保存当前`（已载入 ID 时原地覆盖，未载入则新建 ID）或 `＋ 另存为新`，或导出 `JSON / PNG / CHARX`。后续可按 ID 载入/重命名/导出/删除（顶部 `已载入 ID:xxxx` 高亮当前卡），也可以直接对模型说「帮我载入 ID xxxx」。

## 特性

### 融合工坊（客户端）

- **布局**：输入框上方胶囊（CC 模式自动出现）→ `shell.overlay` 全屏工坊，左侧导航 4 页（**5维世界观 / 角色细化 / 世界书 / 校验导出**）/ 自适应主区 / 280px 已存角色侧栏 / 360px 实时 `card.json` 预览。深浅色自适应（DSW Token + 品牌紫 `#7c5cff` 固定）。
- **风格标签**：在「角色细化」中以逗号分隔编辑 `tags`，实时写回 `data.tags`。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `cc_patch_world(autoLorebook=true)` 自动生成带 `@@position / @@depth / @@activate` 的 Lorebook 条目（至少 1 条 `constant` 常驻；再次调用自动覆盖旧自动条目、保留手动条目）。每维为**预览卡片 + 展开大框编辑**（小卡显示 140 字预览/字数，点击卡片或「⛶ 编辑」弹出 720px 大框）。
- **全量长文本大框编辑**：`description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes` 全部是「标签 + 右上 `⛶`」的小框 + 720px 大框，实时同步，解决多行长文在小框里难预览/编辑。
- **已存角色侧栏（ID 化 CRUD）**：280px 可折叠，高亮当前载入卡（紫框 + 顶部 `已载入 ID:xxxx`，显示 ID 前 8 位），`★ 保存当前` 在已载入 ID 时原地覆盖、`＋ 另存为新` 强制新建、`✎ 重命名` / `＋ 新建`；搜索/载入/导出/删除落盘 `~/.dsh/cc-library/<id>.json`。
- **导入导出**：`⬆ 导入 JSON/PNG/CHARX` 自动识别容器；`⬇ JSON` / `⬇ PNG`（1×1 占位图）/ `⬆ 写入 PNG`（写入你上传的任意 PNG，自动剥离旧 `ccv3/chara` 块并 `CRC32` 重算）/ `⬇ CHARX`（打包 `card.json`）。
- **中英双语**：完整 `zh / en` 词表（`locale: dshCcStudio`），跟随全局 `设置 → 通用 → 语言` 自动切换（胶囊/工坊/设置即时刷新，插件内无手动开关）。
- **深浅色自适应**：全量使用 `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`，主按钮/选中态固定品牌紫，刷新即生效。

### CC 模式（模型侧 14 个 Tool）

- **6 步工作流 + 共创约束**：每步前 LLM 必须用 1-2 个开放问题征求偏好（气质/关系/世界侧重/触发词/开场场景等），严禁未讨论就一次性推断填满；角色四件套 → 五维 ≥3 → 世界书 ≥5 → 问候语 → `cc_validate` 才可收口。
  `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
- **Lorebook 精细管理**：`cc_delete_lorebook_entries` / `cc_update_lorebook_entry`。
- **已存库 CRUD（与侧栏共享 ID）**：`cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry`——用户说「帮我更新/载入 ID xxxx」时模型可直接操作，无需手动点 UI。

### 校验与规范

- 宿主实时校验：`spec / group_only_greetings` 必填、主图标唯一性、正则合法性，`spec: chara_card_v3 / spec_version: 3.0`。
- CCv3 全覆盖：`name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`，支持 CBS `{{char}} / {{random}} / {{roll}}`。

## 结构

```
dsh-cc-studio/
├── package.json          # @xia-sc/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./client ./agent
├── cordis.patch.yml      # 补丁层 1：宿主行插入（id dsh-cc-studio）
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc（validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode,
│   │                     #   cc_validateDraft, 草稿槽 cc_migrateDraft, 已存库 cc_*Library, 容器 cc_importFromPng/cc_exportPng(+imageB64)/
│   │                     #   cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE）
│   ├── agent.js          # CC 模式 Tools：6 步共创 + 2 Lorebook 管理 + 6 已存库 CRUD = 14 个，含「先与用户讨论」提示
│   └── client.js         # client: dock 胶囊 + overlay 工坊 + settings.section（DSW Token 深浅色、品牌紫、
│                         #   五维回显、长文本大框、JSON/PNG/CHARX 导入导出/写入）
├── presets/
│   ├── cc.patch.yml      # 补丁层 2：CC 预设声明行（dsh ≥ 0.1.7-alpha.1）
│   └── cc/               # CC 预设目录模板（dsh ≤ 0.1.6-alpha.2，插件挂载时安装到用户根）
│       ├── preset.yml
│       └── agent.cordis.yml
├── tests/                # 8 个测试文件、335 项断言（不随包发布）
│   ├── rpc-channel.test.mjs       # host 半 RPC 通道回归（假 ctx + 真实 http，45 项断言）
│   ├── preset-install.test.mjs    # 预设安装决策 + native 让位 + 两份清单防漂移 + 行契约，79 项断言
│   ├── cc-detection.test.mjs      # CC 模式探测的源码级守卫，51 项断言
│   ├── client-greetings.test.mjs  # 客户端问候语与 i18n 守卫，62 项断言
│   ├── draft-slot-sync.test.mjs   # 草稿槽行为级回归（假 React/slot/RPC harness），18 项断言
│   ├── nav-highlight.test.mjs     # 工坊步骤导航三态回归（选中/键盘焦点/悬停互斥），23 项断言
│   ├── clear-card.test.mjs        # 「清空当前角色卡」二次确认回归，20 项断言
│   └── data-root.test.mjs         # 落盘根：DSH_HOME 优先 + 读时回退 ~/.dsh，37 项断言
├── CHANGELOG.md          # 完整版本历史
├── README.md             # 中文（默认）
└── README_EN.md          # English
```

> `dsh-cc-agent` 已于 `5f95110` 合并为 `lib/agent.js`（`@xia-sc/dsh-cc-studio/agent`），无需单独安装；`CC 模式` 预设仅挂该单一来源，不污染 `standard`。

## 开发与测试

```bash
npm test                                   # 8 个文件、335 项断言（八个 node 脚本串联）
node tests/rpc-channel.test.mjs            # 只跑 host 半 RPC 通道回归（45 项断言）
```

- **改客户端**：`lib/client.js` 改动刷新页面即可；跑着 dsh 仓库的 `pnpm run dev:web` 时可热更新。
- **改宿主**：`lib/index.js` 改动需重启 dsh web（宿主行在启动时组合）。

## 外观

深浅色通过 `var(--dsw-alias-*)` 自动适配（`body[data-ds-dark-theme]`），主操作固定 `#7c5cff` 保证对比度。切换路径：设置 → 外观 → 浅色/深色/跟随系统，刷新后工坊立即生效。

## 兼容与权限

上架元数据（`dsh.compatibility` / `engines` / 运行依赖）与权限边界都集中在这里；DSH STORE 的固定源审查读的也是这几处。

| 项 | 值 |
| --- | --- |
| DSH 兼容范围 | `>=0.1.5-rc.1`（`package.json` 的 `dsh.compatibility.dsh`） |
| 逐版本证据 | `dsh.compatibility.dshReleases` 里 `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.6-alpha.1` / `0.1.6-alpha.2` / `0.1.7-alpha.1` / `0.1.7-rc.1` / **`0.2.0-rc.2`** 为 `compatible`。**没实测过的版本不写**（`0.1.7-alpha.2`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.1-alpha.1` 保持未声明，商城显示为未知），而不是先写 `compatible` 再补测 |
| Node.js | `engines.node: ">=22"`（实测运行时 Node v26.9.0） |
| 宿主形态 | `dsh web`（CLI）与 **DSH 桌面版（DeepSeek Harness Desktop）** 都是同一套宿主 + profile bundles 机制，**均支持**（差异与安装方式见 [7. 桌面版](#7-桌面版deepseek-harness-desktop)） |
| 客户端平台 | `dsh.client.platform: "web"` —— 这是**浏览器半**的平台标识，与 dsh 的 profile 名（`web` / `desktop` …）不是一回事；桌面版与 CLI 加载的是同一份客户端 bundle |
| 运行依赖 | **无**。`lib/*.js` 只 `import` `node:` 内建与相对路径；随包的补丁 / 预设是静态 YAML，没有安装期脚本 |
| 生命周期脚本 | **无** `preinstall` / `install` / `postinstall` / `prepare`（只有 `test` 与 `prepublishOnly`，只在本仓库跑，不发给安装端） |
| 权限 · 文件 | 读 `<DSH_HOME>`（含旧根 `~/.dsh`）下自己的三个目录：`cc-drafts/`、`cc-library/`、`.agent-presets/cc/`（后者只在 dsh ≤ `0.1.6-alpha.2` 上写）；另读自身 `package.json`。不写宿主配置，不碰别的插件的数据 |
| 权限 · 网络 | 无。宿主半只在宿主 `webServer` 上注册 `POST /dsh-cc-studio-rpc/<endpoint>`；浏览器半只打同源 RPC |
| 权限 · 命令 | 无。不起子进程、不执行 shell |
| 权限 · 凭据 | 不读也不存任何 token / 密钥 / cookie。只读两个环境变量：`DSH_HOME`、`DSH_CC_STUDIO_PRESET_INSTALL`。宿主 HTTP 路由复用宿主自己的 cookie 围栏（`connection.requestRejection`），插件不解析凭据 |

> **为什么商城不会给它「自动通过」**：DSH STORE 的自动低风险通道（`source-verified`）要求运行时代码**完全不出现**文件、网络、命令、凭据四类信号；而本插件的核心功能就是角色卡与草稿落盘（文件信号），并且要读 `DSH_HOME`（扫描器把任何 `process.env` 读取都算凭据信号）。这两条不会为了迎合扫描器而消除 —— 对这类合法插件，商城的正确档位是 `user-reviewed`（展示变更、由用户逐次确认安装）。

一次性 Profile 的安装 / 启动 / 卸载证据见 [CHANGELOG.md](./CHANGELOG.md) 的 `0.3.7` 小节：隔离 profile + 隔离 `DSH_HOME` / `HOME` / `USERPROFILE`，三个前端挂载点全部 `active`、预设 roster 含 `cc`、RPC 往返一致、PNG / CHARX 导出→导入往返一致，真实 `~/.dsh` 全程零变化。

## 规范依据

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) 已过时，仅参考

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。最近几版：

- `0.4.1` 文档补充：README / README_EN 写明**桌面版（DeepSeek Harness Desktop）支持** —— 新增「7. 桌面版」一节（安装入口、profile 名、重启应用 vs 刷新窗口、数据位置），「兼容与权限」表补「宿主形态」行，并把容易误读的 `Profile | web` 改名为「客户端平台」。运行时代码一行未动。
- `0.4.0` 修工坊左侧步骤列表的高亮：鼠标点过某一步后，那一项周围会多出一圈「莫名其妙的描边」，再用顶部胶囊切步时描边还赖在旧项上，看起来像同时选中了两项。根因是 `navItem` 只画 `s.cur` 的选中态、从没管过浏览器焦点（`<button>` 被点击后一直持有焦点，宿主/UA 的焦点描边就留在按钮外沿）。现在：导航项 `onMouseDown` 阻止默认（鼠标点击不抢焦点、键盘 Tab 照旧）、`outline` 由插件自己接管（只在 `:focus-visible` 时给 2px 品牌色环）、选中态换成品牌紫淡底 + 左竖条 + `aria-current`，并补上 hover 反馈与「鼠标一动就收起焦点环」。新增**「清空当前角色卡」按钮**（左侧底部「校验」下面，`window.confirm` 二次确认后换回空卡，并解除与已存角色的关联 —— 否则接着点「保存当前」会把库里那张覆盖成空卡）。**并重构了工坊 UI（本版主线）**：砍掉右侧占地 360px 那一栏，实时 CCv3 预览与 CBS 速查收到主区底部、**默认全部折叠**（预览那行仍显示 spec 与通过/失败徽章；原「融合说明」那块纯介绍文案已删除）；字段改成「文档式」阅读排版（无边框 textarea + `field-sizing: content` 自动撑高），手动编辑退成次要入口（长文走 ⛶ 大框），阅读区从 ~700px 拓到 ~876px。功能一个没少。`tests/nav-highlight.test.mjs`（23 项）与 `tests/clear-card.test.mjs`（20 项）钉住新行为。测试 292 → 335 项。
- `0.3.8` 补 DSH STORE 上架契约（[Store #1173](https://github.com/AI-Scarlett/DSH-Store/issues/1173)）：`engines.node: ">=22"`、`dsh.compatibility`（兼容范围 + **只写实测过版本**的精确矩阵）、删掉那个从 0.3.0 起就没被任何代码 import 过的 `@deepseek-ai/cordis` 运行依赖，README / README_EN 新增「兼容与权限」披露节，`tests/preset-install.test.mjs` 加 11 项契约守卫（281 → 292 项断言）。**但这个 issue 光改仓库修不完**：商城条目的包名还停在 0.3.0 的旧名 `@dsh-plugins/dsh-cc-studio`，STORE 复检第一步就因「包名与条目身份不符」判 `update-blocked`，得先由 STORE 侧迁移条目身份（重新提交也绕不过，`entryIds` 会撞旧条目）；而 files / credentials 两个权限信号是本插件的核心功能（角色卡草稿落盘 + 读 `DSH_HOME`），自动低风险通道**不可能**通过，商城只应按 `user-reviewed`（用户逐次确认）收录。另已做完 **dsh `0.2.0-rc.2` 兼容性审计**（隔离宿主实测宿主行/预设行组合、RPC 线协议与围栏、会话槽 key、预设 roster 含 `cc` 且 `broken` 空、三个客户端挂载点 `active`、PNG/CHARX 往返逐字一致、真实 `~/.dsh` 零变化），矩阵补上 `0.2.0-rc.2: compatible`；`0.2.0-rc.1` / `0.2.1-alpha.1` 未测，仍不声明。
- `0.3.7` dsh `0.1.7-rc.1` 兼容性审计：**接口面无一处需要适配**（隔离宿主实测了 RPC 路由/线协议、预设 roster、三个前端挂载点、草稿槽 key、落盘根、PNG/CHARX 往返）。真正的修复是预设里**一行自始漏抄**：`command-goal` 在内置 `standard` 里从 `0.1.6-alpha.2` 起就有，本预设初次拷贝时就漏了它 —— 不报错、不判 broken，只是 CC 模式会话少了 `/goal` 斜杠命令（与 0.3.4 补回的 `present` 同类），现已两份载体同步补齐并加了**行集快照**守卫。另更正 3 处会误导下次升级的文档口径（「异步迭代 `IncomingMessage` 必抛」实测不成立且官方 `/api` 桥自己就在用；`/api/agentPresets/list` 其实带可选 `name`/`description`/`broken`；channel/endpoint 命名正则在 `dsh-client-connection` 而非 `webServer.register`），并给「客户端 `preset.ccLabel` 必须逐字等于宿主预设显示名」这条隐性耦合补了跨文件守卫。顺带精简了 roster 下拉里「CC 模式」的介绍文案：原来把模型侧的 6 个工具名（`cc_get_card` / `cc_patch_character` / …）全列在用户界面上，既撑满下拉项又对用户没有信息量（工具名只对读 persona 的模型有意义），现在只讲「模型先问再填 / 胶囊实时同步 / 工坊全屏编辑 / 导出 JSON、PNG、CHARX」。测试 278 → 281 项。
- `0.3.6` 修 dsh `0.1.7-alpha.1` 上「`CC 模式` 预设消失」+ 落盘根统一。① 预设：那一版起 dsh 的预设只来自组合里的**声明行**，`<DSH_HOME>/.agent-presets/` 已无人读取（目录还在、只是没人看），插件改为随包带一层补丁 `presets/cc.patch.yml`（与内置 `standard` 同构的 `@deepseek-ai/dsh-agent-preset` 声明），新版上不再写任何文件，目录安装只为 ≤ `0.1.6-alpha.2` 保留并在新版自动让位。② 草稿与角色库：以前写死 `~/.dsh`、不认 `DSH_HOME`（自定义 `DSH_HOME` 的用户两套根并存，隔离实测还会写进真实 `~/.dsh`），现在改为 **`DSH_HOME` 优先 + 读时回退 `~/.dsh`**，未设置时路径与以前完全一致。测试 216 → 278 项。
- `0.3.5` 修 #5「前端与 Tools 读到不同草稿槽」：`useCcPreset` 读的 `useSessions().current` 字段在 dsh `0.1.6-alpha.2` 的 `SessionListState` 里并不存在（恒为 `null`），加上启动时那次无 key 的拉取占掉了全局节流，前端一直用 `default` 槽 —— 而模型经 Tools 写的是 `session-<会话id>` 槽，于是「模型说写好了 / 工坊说没数据」。现在会话 id 只从 slot props 取并发布到 store、拉草稿没有会话 id 就一次都不发、节流按 key、主机回传 key 不一致时不渲染而是告警；另修胶囊闪退（根域实例每秒钟把会话域实例判定的 CC 状态清掉）并新增 `cc_migrateDraft` 与「迁入本会话槽」一键救回。测试 158 → 216 项（新增行为级 `tests/draft-slot-sync.test.mjs`）。
- `0.3.4` 适配 dsh `0.1.6-alpha.2` 并补回两处预设漏抄：CC 预设缺 `present` 行（CC 模式下模型没有「登记交付物」的工具，且不报错）、`tool-subagent` 行缺 `modelSelectionSettings: true`（子代理的指定模型入口被静默关掉）；顺带补上 alpha.2 新增的 `tool-plugin-manager` 行（`disabled`，与内置 `standard` 对齐到只剩有意的行差）。新增 7 项预设行契约守卫。
- `0.3.3` 发布流程自动化：打 `v*` tag 即由 GitHub Actions 发布到 npm（OIDC trusted publishing，零密钥）并自动建 GitHub Release；手动触发默认只做安全自检。插件运行时行为未变。
- `0.3.2` 包名迁移至 `@xia-sc/dsh-cc-studio`（原 `@dsh-plugins` 不是本项目持有的 npm scope），并首次发布到 npm；新增 `publishConfig.access` / `prepublishOnly` 等发布元数据。
- `0.3.1` 适配 dsh `0.1.6-alpha.1`：CC 预设里的 `workflow-worker-thread` 行换成 `workflow-ptc`，否则整份预设被判「加载失败」、CC 模式直接不可选。
- `0.3.0` 移除「点子」页：工坊导航改为 4 页（5维世界观 / 角色细化 / 世界书 / 校验导出），`⛶ 大框` 能力改用统一 `fieldHead()` 落到全部长文本 string 字段，侧栏搜索保留。同步修掉该改动引入的数组往返回退（`[]` 会被写成 `[""]`，即凭空多一条空白问候语）；并把问候语字段改为**逐条独立编辑**（一条 = 一个编辑框），根除「多段问候语一编辑就被拆成多条」的静默损坏，顺带补上问候语增删与 10 条上限对齐。另修大框「取消」真正回滚、清掉自 67172fd 起就调不通的 `expandIdea` / `expandWorld` 死代码、**完成全量 i18n 接线**（此前词表已建好但大量调用点硬编码中文，切到 English 仍显示中文；现全部 122 条中文字面量接入词表，中文界面逐字未变）、**CC 预设改为自动安装**（此前需手工拷贝），并修掉**首次切到 CC 模式时胶囊不出现**（探测读错了 `projectionValues.agentPreset` 字段，导致必须刷新页面或切换会话才出现）。
- `0.2.22` 适配 dsh `0.1.5-rc.1` 启动崩溃：`connection.rpc.handle()` 对外部插件不可用，host 半改为在 `webServer` 上自注册 `/dsh-cc-studio-rpc` 前缀路由并实现同一套 RPC 线上协议；请求体改事件式读取；修 `presets/cc` persona 的 `prefix`；新增 23 项回归测试。
- `0.2.21` 修复 #2 草稿静默丢失：草稿变更即落盘 `~/.dsh/cc-drafts/<会话>.json`，重启/换会话自动恢复；建空会警告、恢复会提示。

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## 收录

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
