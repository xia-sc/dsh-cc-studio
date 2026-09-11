<div align="right">

[English](./README_EN.md) | 中文

</div>

# dsh-cc-studio · CCv3 角色卡工坊

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

DSH（DeepSeek Harness）插件：输入框上方的胶囊 → 全屏融合工坊，配合 `CC 模式` 预设让 LLM 通过 14 个 Tool **先问再填**、与你共创角色卡，最后一键导出 `JSON / PNG / CHARX`。

| 项目 | 值 |
| --- | --- |
| 插件包名 | `@dsh-plugins/dsh-cc-studio` |
| 当前版本 | `0.2.22` |
| 宿主 RPC | `/dsh-cc-studio-rpc`（自带路由，适配 dsh ≥ `0.1.5-rc.1`） |
| 客户端挂载点 | `conversation.input.dock`（胶囊）+ `shell.overlay`（工坊）+ `settings.section` |
| 落盘位置 | `~/.dsh/cc-library/`（角色卡）、`~/.dsh/cc-drafts/`（会话草稿） |

## 安装

### 1. 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add github:xia-sc/dsh-cc-studio
```

`dsh plugin` 只是把参数转发给 profile 目录（`~/.dsh/profiles/web`）里的 pnpm；装完 dsh 会把 `@dsh-plugins/dsh-cc-studio` 自动追加到该 profile 的 `dsh.profile.bundles`，不需要手改 `package.json`。

- **锁定版本 / 指定分支**：`github:xia-sc/dsh-cc-studio#v0.2.22`、`...#master`（tag 见仓库 Tags）。
- **`allowBuilds` 提示**：本插件没有 `prepare` 构建脚本，正常安装不会触发 pnpm 的构建拦截；若 pnpm 仍打印该提示，把提示里给出的键加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑。
- **在 DSH 会话里由 Agent 执行时**：写入位置在会话工作区之外，需先把文件权限切到 `danger-full-access`；自己在终端执行则无此限制。

### 2. 从本地仓库安装（开发 / 调试）

```bash
git clone https://github.com/xia-sc/dsh-cc-studio.git
cd dsh-cc-studio
dsh plugin --profile web add .
```

相对路径按**你执行命令时所在的目录**解析（dsh 会先把 `.`、`./xxx` 重写成绝对路径再交给 pnpm，避免误链到 profile 目录）。装出来的是 `link:` 到源码目录：改 `lib/*.js` 后重启 dsh web 生效；只改 `lib/client.js` 时刷新页面即可（若同时跑着 dsh 仓库的 `pnpm run dev:web`，客户端 bundle 会重建，连刷新都省了）。

### 3. 安装 CC 预设

预设不随插件自动注册，需要把模板拷到用户预设目录 `<DSH_HOME>/.agent-presets/`（`DSH_HOME` 默认 `~/.dsh`）。**目录名必须是 `cc`**——宿主与客户端都按 preset id `cc` 判定 CC 模式。

```powershell
# Windows PowerShell（GitHub 安装）
$src = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-plugins\dsh-cc-studio\presets\cc"
Copy-Item $src "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force

# 本地仓库开发时改用：$src = ".\presets\cc"
```

```bash
# macOS / Linux（GitHub 安装）
mkdir -p ~/.dsh/.agent-presets/cc
cp -R ~/.dsh/profiles/web/node_modules/@dsh-plugins/dsh-cc-studio/presets/cc/. ~/.dsh/.agent-presets/cc/
```

> 若你自定义了 `DSH_HOME`，把上面命令里的 `~/.dsh` / `%USERPROFILE%\.dsh` 换成该路径；插件本体位于 `<DSH_HOME>/profiles/web/node_modules/@dsh-plugins/dsh-cc-studio/`。

`agent.cordis.yml` 在一份 `standard` 拷贝上追加 `id: cc-studio-agent, name: '@dsh-plugins/dsh-cc-studio/agent'`，并把 `persona` 改为「共创搭档」——先问再填、每步 1-2 问。切换会话模式后胶囊自动出现。

> 卸载/删除插件不会删除 `~/.dsh/.agent-presets/cc/`。

### 4. 重启与验证

```bash
# 宿主行在启动时组合，装完必须重启 dsh web
dsh web

# 配置里应出现插件行
dsh --profile web --dump-config | findstr dsh-cc-studio   # Windows
dsh --profile web --dump-config | grep dsh-cc-studio      # macOS / Linux

# 客户端资源应返回 200
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3080/plugins/@dsh-plugins/dsh-cc-studio/client.js

# RPC 自检（与其它 /api 同源：需要宿主/Origin 围栏 + 浏览器会话 cookie）
curl -s http://127.0.0.1:3080/dsh-cc-studio-rpc/ping \
  -H 'content-type: application/json' \
  -H 'cookie: dsh-auth-127.0.0.1:3080=<浏览器里的 dsh-auth-* cookie>' \
  --data '{"type":"client-request","rpcId":"smoke","method":"ping","payload":{}}'
# -> {"type":"server-response","rpcId":"smoke","result":{"ok":true,"value":{"ok":true,"time":...}}}
```

不带 cookie 直接 `curl` 会得到 `401 dsh web authentication required`，这是正常行为，不代表插件没装上。浏览器刷新页面后切到 `CC 模式` 会话，输入框上方出现胶囊即安装成功。

### 5. 更新与卸载

```bash
# 更新到默认分支（master）最新提交：重新执行 add，pnpm 会重新解析
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# 若解析未前移，先移除再装
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# 卸载（dsh 会同步把它从 dsh.profile.bundles 移除）
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
```

记录在 `~/.dsh/cc-library/` 的角色卡与 `~/.dsh/cc-drafts/` 的会话草稿不会被卸载流程删除。

### 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 输入框上方没有胶囊 | 确认当前会话模式是 `CC 模式`；确认 `~/.dsh/.agent-presets/cc/` 下 `preset.yml` 与 `agent.cordis.yml` 都在且目录名是 `cc`；重启 dsh web 后刷新页面 |
| 工坊出现橙色条「草稿已新建」 | 该会话没有历史草稿（首次创建或草稿目录被清）；已存档会话恢复时会改为蓝色条并显示 `creation_date`，下次写入后提示消失 |
| 切 CC 模式报 `invalid config: S.prefix missing required value` | `presets/cc/agent.cordis.yml` 是 0.2.22 之前的旧版（persona 用了 `text:`），重新拷贝新模板 |
| dsh 启动报 `cannot get property "webServer" without inject` | 插件版本低于 0.2.22，更新插件 |
| 校验报错 | 必填 `spec: chara_card_v3` / `spec_version: 3.0` / `group_only_greetings`；主图标需唯一；正则需合法 |

## 快速上手

1. 新建会话，会话模式选 **CC 模式**（胶囊随即出现在输入框上方）。
2. 直接说需求：「我想做雨城记忆典当行老板娘，世界观很薄」。
3. LLM 按 6 步推进，每一步都会先问你 1-2 个问题再落笔；每次调用 Tool，胶囊与工坊实时刷新：
   `cc_get_card`（总结进度并提问）→ `cc_patch_character`（讨论气质/关系后填四件套）→ `cc_patch_world`（讨论世界侧重后补 ≥3 维，`autoLorebook`）→ `cc_add_lorebook_entries`（讨论触发词后补 ≥5，至少 1 条 `constant`）→ `cc_patch_greetings`（讨论场景后补问候语）→ `cc_validate`。
4. 随时点胶囊进工坊手改。校验通过后：侧栏 `★ 保存当前`（已载入 ID 时原地覆盖，未载入则新建 ID）或 `＋ 另存为新`，或导出 `JSON / PNG / CHARX`。后续可按 ID 载入/重命名/导出/删除（顶部 `已载入 ID:xxxx` 高亮当前卡），也可以直接对模型说「帮我载入 ID xxxx」。

## 特性

### 融合工坊（客户端）

- **布局**：输入框上方胶囊（CC 模式自动出现）→ `shell.overlay` 全屏工坊：220px 导航 / 自适应主区 / 280px 已存角色侧栏 / 360px 实时 `card.json` 预览。深浅色自适应（DSW Token + 品牌紫 `#7c5cff` 固定）。
- **风格标签自定义**：预设候选 `雨城 / 感官系 / 赛博 ...` + 任意输入（回车添加、点击已选移除），实时写回 `data.tags`。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `cc_patch_world(autoLorebook=true)` 自动生成带 `@@position / @@depth / @@activate` 的 Lorebook 条目（至少 1 条 `constant` 常驻；再次调用自动覆盖旧自动条目、保留手动条目）。每维为**预览卡片 + 展开大框编辑**（小卡显示 140 字预览/字数，点击卡片或「⛶ 编辑」弹出 720px 大框）。
- **全量长文本大框编辑**：`description / personality / scenario / system_prompt / first_mes / alternate_greetings / mes_example / creator_notes` 等所有长文本都是小框 + 右上 `⛶ 大框`，720px 大框实时同步，解决多行长文在小框里难预览/编辑。`1. 点子` 现为纯**本地草稿搜索**（过滤已存侧栏；「点子投喂」卡片已移除）。
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
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./client ./agent
├── cordis.patch.yml      # 宿主行插入：id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc（validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode,
│   │                     #   cc_validateDraft, 已存库 cc_*Library, 容器 cc_importFromPng/cc_exportPng(+imageB64)/
│   │                     #   cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE）
│   ├── agent.js          # CC 模式 Tools：6 步共创 + 2 Lorebook 管理 + 6 已存库 CRUD = 14 个，含「先与用户讨论」提示
│   └── client.js         # client: dock 胶囊 + overlay 工坊 + settings.section（DSW Token 深浅色、品牌紫、
│                         #   五维回显、长文本大框、JSON/PNG/CHARX 导入导出/写入）
├── presets/cc/           # CC 模式预设模板（共创 persona + cc-studio-agent）
│   ├── preset.yml
│   └── agent.cordis.yml
├── prototypes/           # A/B 融合前的对比原型（H5，浏览器直接打开）
│   ├── index.html
│   ├── prototype-a.html  # 轻量浮层
│   └── prototype-b.html  # 侧边常驻
├── tests/
│   └── rpc-channel.test.mjs  # host 半 RPC 通道回归（假 ctx + 真实 http，23 项断言）
├── CHANGELOG.md          # 完整版本历史
├── README.md             # 中文（默认）
└── README_EN.md          # English
```

> `dsh-cc-agent` 已于 `5f95110` 合并为 `lib/agent.js`（`@dsh-plugins/dsh-cc-studio/agent`），无需单独安装；`CC 模式` 预设仅挂该单一来源，不污染 `standard`。

## 开发与测试

```bash
pnpm test                                  # = node tests/rpc-channel.test.mjs
node tests/rpc-channel.test.mjs            # host 半 RPC 通道回归（23 项断言）
```

- **原型预览**（本地直接打开，无需安装）：`prototypes/index.html` 总览 → `prototype-a.html`（轻量浮层）/ `prototype-b.html`（侧边常驻）对比。
- **改客户端**：`lib/client.js` 改动刷新页面即可；跑着 dsh 仓库的 `pnpm run dev:web` 时可热更新。
- **改宿主**：`lib/index.js` 改动需重启 dsh web（宿主行在启动时组合）。

## 外观

深浅色通过 `var(--dsw-alias-*)` 自动适配（`body[data-ds-dark-theme]`），主操作固定 `#7c5cff` 保证对比度。切换路径：设置 → 外观 → 浅色/深色/跟随系统，刷新后工坊立即生效。

## 规范依据

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) 已过时，仅参考

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。最近三版：

- `0.2.22` 适配 dsh `0.1.5-rc.1` 启动崩溃：`connection.rpc.handle()` 对外部插件不可用，host 半改为在 `webServer` 上自注册 `/dsh-cc-studio-rpc` 前缀路由并实现同一套 RPC 线上协议；请求体改事件式读取；修 `presets/cc` persona 的 `prefix`；新增 23 项回归测试。
- `0.2.21` 修复 #2 草稿静默丢失：草稿变更即落盘 `~/.dsh/cc-drafts/<会话>.json`，重启/换会话自动恢复；建空会警告、恢复会提示。
- `0.2.20` 修复 `cc_isCcMode` 刷屏：胶囊/工坊改 `current + preset` 窄订阅 + 5s 节流 + in-flight 去重。

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## 收录

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
