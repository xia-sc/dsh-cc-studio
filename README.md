# dsh-cc-studio · CCv3 角色卡工坊

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

## 特性

- **融合工坊**：输入框上方胶囊（CC 模式自动出现，`conversation.input.dock`）→ 点击展开 `shell.overlay` 全屏工坊（220px 导航 / 自适应主区 / 280px 已存角色侧栏 / 360px 实时 `card.json` 预览），深浅色自适应（DSW Token + 品牌紫 `#7c5cff` 固定）。
- **风格标签自定义**：预设候选 `雨城 / 感官系 / 赛博 ...` + 任意输入（回车添加，点击已选移除），实时写回 `data.tags`。
- **CC 模式（推荐·共创）**：新增 Agent Preset `CC 模式`，通过 6 个 Tool 让 LLM **先问再填**、与用户讨论共创，胶囊实时同步（`per-session` 草稿 + 2.5s 轻量轮询）：
  - `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
  - 强制 6 步工作流 + 共创约束：每步前 LLM 必须用 1-2 个开放问题征求用户偏好（气质/关系/世界侧重/触发词/开场场景等），严禁未与用户讨论就一次性推断填满；角色四件套 → 五维≥3 → 世界书≥5 → 问候语 → `cc_validate` 才可收口。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `cc_patch_world(autoLorebook=true)` 自动生成带 `@@position / @@depth / @@activate` 的 Lorebook 条目（至少 1 条 `constant` 常驻）。
- **CCv3 全覆盖**：`name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`，含 CBS `{{char}} / {{random}} / {{roll}}`。
- **已存角色侧栏**：280px 可折叠（收起为 40px 竖条 + ★ 快捷保存），搜索（名称/标签）、保存当前草稿 / 载入 / 导出 JSON / 删除，落盘 `~/.dsh/cc-library/<id>.json`，按 `updatedAt` 排序。
- **校验与导出**：Host 实时校验（`spec / group_only_greetings` 必填、主图标唯一性、正则合法性，`spec: chara_card_v3 / spec_version: 3.0`），首版仅 `card.json`，`CHARX / PNG` 二期。
- **深浅色自适应**：全量切 `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`，浅色白底黑字、深色暗底浅字，主按钮/选中态固定紫色，刷新即生效。

## 结构

```
dsh-cc-studio/
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./agent
├── cordis.patch.yml      # 宿主行插入：id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc（validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode, cc_validateDraft, library: cc_listLibrary/cc_saveToLibrary/cc_loadFromLibrary/cc_deleteFromLibrary/cc_renameInLibrary/cc_getLibraryEntry）
│   ├── agent.js          # CC 模式 Tools（已合并原 dsh-cc-agent）：6 Tools + workflowStatus（角色/五维≥3/世界书≥5/问候语 gate，提示“先与用户讨论”）
│   └── client.js         # client: dock 胶囊 + overlay 工坊（DSW Token 深浅色，品牌紫 #7c5cff + 五维回显修复） + settings.section
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
4. 随时在工坊手改；校验通过后点 **导出 JSON** 或侧栏 **★ 保存当前**（落盘 `~/.dsh/cc-library`），后续可在侧栏载入/导出/删除；原型预览（本地直接打开）：
- `prototypes/index.html` 总览
- `prototypes/prototype-a.html` / `prototypes/prototype-b.html` 对比

## 外观

深浅色通过 `var(--dsw-alias-*)` 自动适配（`body[data-ds-dark-theme]`），主操作固定 `#7c5cff` 保证对比度。切换路径：设置 → 外观 → 浅色/深色/跟随系统，刷新后工坊立即生效。

## 规范依据

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) 已过时，仅参考

## 版本

- `0.2.6` 共创约束：每步先与用户讨论（Tool 描述 + persona 强制“先问再填”），修复“LLM 自行推断填满”问题
- `0.2.5` 修复工坊五维回显丢失（`draft.extensions.cc_world ↔ state.world` 双向同步）
- `0.2.4` 深浅色自适应，深色下修复品牌按钮白底刺眼
- `0.2.3` workflow + UI 细节（maxWidth/boxSizing、40px 折叠栏、6 步强制校验）
- `0.2.2` 已存角色侧栏（280px 可折叠/落盘 `~/.dsh/cc-library`）

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).
