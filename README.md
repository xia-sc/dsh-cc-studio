<div align="right">

[English](./README_EN.md) | 中文

</div>

# dsh-cc-studio · CCv3 角色卡工坊

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

## 特性

- **融合工坊**：输入框上方胶囊（CC 模式自动出现，`conversation.input.dock`）→ 点击展开 `shell.overlay` 全屏工坊（220px 导航 / 自适应主区 / 280px 已存角色侧栏 / 360px 实时 `card.json` 预览），深浅色自适应（DSW Token + 品牌紫 `#7c5cff` 固定）。
- **风格标签自定义**：预设候选 `雨城 / 感官系 / 赛博 ...` + 任意输入（回车添加，点击已选移除），实时写回 `data.tags`。
- **CC 模式（推荐·共创）**：新增 Agent Preset `CC 模式`，通过 6 个 Tool 让 LLM **先问再填**、与用户讨论共创，胶囊实时同步（`per-session` 草稿 + 2.5s 轻量轮询）：
  - `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
  - 强制 6 步工作流 + 共创约束：每步前 LLM 必须用 1-2 个开放问题征求用户偏好（气质/关系/世界侧重/触发词/开场场景等），严禁未与用户讨论就一次性推断填满；角色四件套 → 五维≥3 → 世界书≥5 → 问候语 → `cc_validate` 才可收口。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `cc_patch_world(autoLorebook=true)` 自动生成带 `@@position / @@depth / @@activate` 的 Lorebook 条目（至少 1 条 `constant` 常驻；再次调用时自动覆盖旧自动条目、保留 `cc_add_lorebook_entries` 手动条目，配合 `cc_delete/update_lorebook_entry` 可精细管理）；工坊中每维为**预览卡片 + 展开大框编辑**（小卡显示 140 字预览/字数，点击卡片或“⛶ 编辑”弹出 720px 大框，适合长文）。
- **全量长文本大框编辑**：`description / personality / scenario / system_prompt / first_mes / alternate_greetings / mes_example / creator_notes` 等所有长文本均支持小框 + 右上 `⛶ 大框` 按钮，弹出 720px 大框实时同步，解决多行长文在小框内难预览/编辑问题；`点子投喂（一句话点子/风格标签）`卡片已移除，`1. 点子` 现为纯 **本地草稿搜索**（过滤已存侧栏）。
- **CCv3 全覆盖**：`name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`，含 CBS `{{char}} / {{random}} / {{roll}}`。
- **已存角色侧栏（ID 化 CRUD）+ 模型侧 Tools**：工坊侧栏 280px 可折叠，高亮当前载入卡（紫框，顶部 `已载入 ID:xxxx`），`↻ 更新` 按唯一 ID 原地覆盖、`＋ 另存为新` 强制新建、`✎ 重命名`/`＋ 新建`，搜索/载入/导出/删除落盘 `~/.dsh/cc-library/<id>.json`；模型侧同步暴露 `cc_list_library / cc_save_to_library / cc_load_from_library / cc_delete_from_library / cc_rename_in_library / cc_get_library_entry` 6 个 Tools（与侧栏共享 ID），用户说“帮我更新/载入 ID xxxx”时模型可直接操作，无需手动点 UI。
- **校验与导出**：Host 实时校验（`spec / group_only_greetings` 必填、主图标唯一性、正则合法性，`spec: chara_card_v3 / spec_version: 3.0`），支持 `JSON / PNG(tEXt ccv3) / CHARX(ZIP card.json)` 三容器互通：`⬇ PNG` 生成 1×1 占位图、`⬆ 写入 PNG` 将当前卡写入用户上传的任意 PNG（自动剥离旧 `ccv3/chara` 块，`CRC32` 重算）、`⬇ CHARX` 打包 `card.json`，导入侧 `⬆ 导入 JSON/PNG/CHARX` 自动识别。
- **中英双语**：完整 `zh / en` 词表（`locale: dshCcStudio`），跟随全局 `设置 → 通用 → 语言` 自动切换（胶囊/工坊/设置即时刷新，无插件内手动开关）。
- **深浅色自适应**：全量切 `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`，浅色白底黑字、深色暗底浅字，主按钮/选中态固定紫色，刷新即生效。

## 结构

```
dsh-cc-studio/
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./agent
├── cordis.patch.yml      # 宿主行插入：id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc（validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode, cc_validateDraft, library: cc_listLibrary/cc_saveToLibrary/cc_loadFromLibrary/cc_deleteFromLibrary/cc_renameInLibrary/cc_getLibraryEntry, 容器: cc_importFromPng/cc_exportPng(+imageB64 写入)/cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE）
│   ├── agent.js          # CC 模式 Tools（已合并）：6 步共创 + 2 Lorebook 管理 + 6 已存库 CRUD（与侧栏共享 ID），共 14 Tools，含 workflowStatus 提示“先与用户讨论”
│   └── client.js         # client: dock 胶囊 + overlay 工坊（DSW Token 深浅色，品牌紫 #7c5cff + 五维回显修复 + 世界观/全量长文本大框编辑 + JSON/PNG/CHARX 导入导出/写入） + settings.section
├── presets/cc/           # CC 模式预设模板（共创 persona + cc-studio-agent）
│   ├── preset.yml
│   └── agent.cordis.yml
├── prototypes/           # A/B 融合前的对比原型（H5，可直接用浏览器打开）
│   ├── index.html
│   ├── prototype-a.html  # 轻量浮层
│   └── prototype-b.html  # 侧边常驻
└── README.md
```

> `dsh-cc-agent` 已于 `5f95110` 合并为 `lib/agent.js`（`@dsh-plugins/dsh-cc-studio/agent`），无需单独安装；`CC 模式` 预设仅挂该单一来源，不污染 `standard`。

## 安装

```bash
# 克隆
git clone https://github.com/xia-sc/dsh-cc-studio.git
# 安装到 web profile（需 danger-full-access）
dsh plugin --profile web add ./dsh-cc-studio

# 重启 dsh web（宿主行在启动时组合）
# 验证
dsh --profile web --dump-config | findstr dsh-cc-studio
curl http://127.0.0.1:3080/plugins/@dsh-plugins/dsh-cc-studio/client.js  # 应 200
# RPC 自检
# POST /dsh-cc-studio-rpc/ping  -> {ok:true}
```

CC 预设位于 `~/.dsh/.agent-presets/cc/`（`preset.yml` + `agent.cordis.yml`，后者在一份 `standard` 拷贝上追加 `id: cc-studio-agent, name: '@dsh-plugins/dsh-cc-studio/agent'` 并将 `persona` 改为“共创搭档”——先问再填、每步 1-2 问）。模板见 `presets/cc/`，可直接拷贝到该路径，切换后胶囊自动出现。

## 使用

1. 切换到 **CC 模式**（会话模式下拉）。
2. 直接对话：“我想做雨城记忆典当行老板娘，世界观很薄”。
3. LLM 严格按 `cc_get_card（先总结进度并提问） → cc_patch_character（与用户讨论气质/关系后再填四件套） → cc_patch_world（与用户讨论世界侧重后再补 ≥3 维，autoLorebook） → cc_add_lorebook_entries（与用户讨论触发词后再补 ≥5，至少 1 constant） → cc_patch_greetings（与用户讨论场景后再补问候语） → cc_validate` 推进，每调一次胶囊/工坊实时刷新；好的角色是讨论出来的，LLM 会多问你、少自行推断。
4. 随时在工坊手改；校验通过后侧栏 `↻ 更新`（按 ID 覆盖当前载入卡）或 `＋ 另存为新`（新建 ID），或 **导出 JSON**，后续可在侧栏按 ID 载入/重命名/导出/删除（`ID:xxxx` 高亮当前）；原型预览（本地直接打开）：
- `prototypes/index.html` 总览
- `prototypes/prototype-a.html` / `prototypes/prototype-b.html` 对比

## 外观

深浅色通过 `var(--dsw-alias-*)` 自动适配（`body[data-ds-dark-theme]`），主操作固定 `#7c5cff` 保证对比度。切换路径：设置 → 外观 → 浅色/深色/跟随系统，刷新后工坊立即生效。

## 规范依据

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) 已过时，仅参考

## 版本

- `0.2.19` 跟随全局语言：移除设置页内 `语言 / Language` 手动切换卡，插件只跟随 `设置 → 通用 → 语言`（`locale: dshCcStudio` + `t` 自动重绘）；CC 预设保持纯中文（用户预设不走系统翻译，双语版显累赘已还原）
- `0.2.18` 中英双语：`zh / en` 全量词表 + 设置页 `语言 / Language` 手动切换（`locale.setLocale`，与全局语言联动，胶囊/步骤/设置即时中英切换），`settings.section` 标题亦随语言变化
- `0.2.17` 容器互通：`JSON / PNG(tEXt ccv3) / CHARX(ZIP)` 导入导出打通，`⬆ 写入 PNG` 支持将当前卡写入用户上传的任意 PNG（剥离旧 `ccv3/chara` 块，`CRC32` 重算，`STORE&DEFLATE` ZIP 兼容），校验页 `⬇ JSON / ⬇ PNG / ⬆ 写入 PNG / ⬇ CHARX` 四键
- `0.2.16` 导入与可调心跳：侧边栏 `⬆ 导入本地 JSON(CCv3)`、导入后自动校验/自动保存开关、CC 心跳间隔 1–30s 可调（0 关闭，`localStorage:dsh-cc-studio-settings`），修复 `{{char}}` 变量误用导致的 `unknown prompt variable`，`presets/cc` 同步修复
- `0.2.15` 首切 CC 不显示修复：`conversation.input.dock` 会话域 + `shell.overlay` 根域按 `[currentId,sessions]` 订阅与 900ms 重试，`cc_getDraft` 轮询收敛为 CC 模式下 4s/1s 基座 + 500ms 去重，关闭即停
- `0.2.14` 移除“点子投喂”卡片：`1. 点子` 现仅保留 **本地草稿搜索**（`一句话点子/风格标签` 输入已移除，标签改在“角色细化”中逗号分隔编辑），界面更简洁
- `0.2.13` 合并：全量长文本大框（所有 textarea ⛶ 720px 大框）+ 点子步本地搜索（紫框过滤已存侧栏）+ 设置页修复（`settings.section` 补 `locale`）
- `0.2.12` 点子步改为本地搜索：紫框不再是点子输入/标签候选，直接过滤右侧已存侧栏（输入/芯片一键筛，实时预览前 3 条，“载入”直达），与侧栏搜索双向同步
- `0.2.11` 全量长文本大框编辑 + 设置页修复：`一句话点子 / description / personality / scenario / system_prompt / first_mes 等` 所有长文本新增右上 `⛶ 大框` 按钮；`settings.section` 漏 `locale: NS` 修复，已存数/落盘 `~/.dsh/cc-library` 展示
- `0.2.10` 世界观大框编辑：每维预览 140 字 + 字数，卡片点击/“⛶ 编辑”弹出 720px 大框（320px 高，实时同步草稿），解决长文在 70px 小框内难编辑/预览问题
- `0.2.9` 模型侧暴露已存库 CRUD：`cc_list/save/load/delete/rename/get_library` 6 Tools（与工坊侧栏共享 ID），支持“帮我更新/载入 ID xxxx”自然语言持久化
- `0.2.8` 已存角色 ID 化 CRUD：载入后 `↻ 更新` 按唯一 `ID` 原地覆盖（无需删旧再存），`＋ 另存为新`/`✎ 重命名`/`＋ 新建`，高亮当前卡与 `ID:xxxx` 显示
- `0.2.7` 修复 `cc_patch_world(autoLorebook=true)` 重复追加导致过期条目堆积（#1）：覆盖旧自动条目、保留手动条目，新增 `cc_delete/update_lorebook_entries` 管理能力
- `0.2.6` 共创约束：每步先与用户讨论（Tool 描述 + persona 强制“先问再填”），修复“LLM 自行推断填满”问题
- `0.2.5` 修复工坊五维回显丢失（`draft.extensions.cc_world ↔ state.world` 双向同步）
- `0.2.4` 深浅色自适应，深色下修复品牌按钮白底刺眼
- `0.2.3` workflow + UI 细节（maxWidth/boxSizing、40px 折叠栏、6 步强制校验）
- `0.2.2` 已存角色侧栏（280px 可折叠/落盘 `~/.dsh/cc-library`）

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## 收录

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
