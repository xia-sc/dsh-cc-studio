# dsh-cc-studio · CCv3 角色卡工坊

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

## 特性

- **融合工坊**：输入框上方胶囊（默认隐藏，仅 CC 模式自动出现）→ 点击展开 `shell.overlay` 全屏工坊（左侧步骤导航，右侧实时 `card.json` 预览）。
- **风格标签自定义**：预设候选 `雨城 / 感官系 / 赛博 ...` + 任意输入（回车添加，点击已选移除），实时写回 `data.tags`。
- **CC 模式（推荐）**：新增 Agent Preset `CC 模式`，通过 6 个 Tool 让 LLM 引导填表，胶囊实时同步：
  - `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → 自动生成带 `@@position / @@depth / @@activate / @@additional_keys` 的 Lorebook 条目。
- **CCv3 全覆盖**：`name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`，含 CBS `{{char}} / {{random}} / {{roll}}`。
- **校验与导出**：Host 实时校验（`spec / group_only_greetings` 必填、主图标唯一性、正则合法性），首版仅 `card.json`（`spec: chara_card_v3 / spec_version: 3.0`），`CHARX / PNG` 二期。

## 结构

```
dsh-cc-studio/
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 宿主行插入
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc (validate, cc_getDraft, cc_setDraft, cc_patchDraft)
│   └── client.js         # client: dock 胶囊 + overlay 工坊 + settings.section
├── prototypes/           # A/B 融合前的对比原型（H5，可直接用浏览器打开）
│   ├── index.html
│   ├── prototype-a.html  # 轻量浮层
│   └── prototype-b.html  # 侧边常驻
└── README.md
```

`dsh-cc-agent`（`@dsh-plugins/dsh-cc-agent`）为 CC 模式的 Tool 宿主，仅在 `CC 模式` 预设中挂载，不污染标准/PTC 模式。

## 安装

```bash
# 克隆
git clone https://github.com/xia-sc/dsh-cc-studio.git
# 安装到 web profile（需 danger-full-access）
dsh plugin --profile web add ./dsh-cc-studio
# 若使用 CC 模式，需同时安装 Agent Tools
dsh plugin --profile web add ./dsh-cc-agent  # 或已在 CC preset 中通过 @dsh-plugins/dsh-cc-agent 引用

# 重启 dsh web（宿主行在启动时组合）
# 验证
curl http://127.0.0.1:3080/plugins/@dsh-plugins/dsh-cc-studio/client.js
# 应 200
```

CC 预设位于 `~/.dsh/.agent-presets/cc/`（`preset.yml` + `agent.cordis.yml`），切换后胶囊自动出现。

## 使用

1. 切换到 **CC 模式**（模式下拉）。
2. 直接对话：“我想做雨城记忆典当行老板娘，世界观很薄”。
3. LLM 会 `cc_get_card → 引导问 1-2 个薄弱点 → cc_patch_character / cc_patch_world → cc_add_lorebook_entries → cc_patch_greetings → cc_validate`，每调一次胶囊实时刷新。
4. 随时在工坊手改，导出前点 **导出 JSON**。

原型预览（本地直接打开）：
- `prototypes/index.html` 总览
- `prototypes/prototype-a.html` / `prototypes/prototype-b.html` 对比

## 规范依据

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)（权威）
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) 已过时，仅参考

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).
