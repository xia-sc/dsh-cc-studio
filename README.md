# dsh-cc-studio · CCv3 角色卡工坊（融合形态）

> 从一句话点子到可导入 SillyTavern/Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」的用户。

- **融合形态**：`conversation.input.dock` 胶囊常驻（默认收起不占地）→ 点击展开为 `shell.overlay` 全屏工坊（左侧步骤导航可收起，右侧实时 JSON 预览）。后续可加半屏抽屉。
- **5维深挖（Q2-B）**：年表 / 势力 / 地理 / 力量体系 / 日常细节 → 一键生成带 `@@position/@@depth/@@activate/@@additional_keys` 的 Lorebook 条目
- **CCv3 全覆盖**：`name/nickname/tags/description/personality/scenario/system_prompt/post_history_instructions/first_mes/alternate_greetings/group_only_greetings/mes_example/creator_notes(_multilingual)/assets/source/creation_date/character_book`，含 CBS `{{char}}/{{random}}/{{roll}}` 自动补全
- **校验与导出**：Host `validate` 实时校验（缺 `spec/group_only_greetings` 标红、assets 主图标唯一性、正则合法性），首版仅 `card.json`（`spec: chara_card_v3 / spec_version: 3.0`），CHARX/PNG 二期
- **模型透传**：Host 优先走 `ctx.llm.stream`，无模型时回退 mock，保证离线可用

## 结构

```
E:\dsh\plugin\dsh-cc-studio\
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 宿主行插入
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc (validate/expandIdea/expandWorld)
│   └── client.js         # client: dock胶囊 + overlay工坊 + settings.section
└── prototypes/           # A/B 融合前的对比原型（H5）
    ├── prototype-a.html
    ├── prototype-b.html
    └── index.html
```

## 安装

```pwsh
dsh plugin --profile web add E:/dsh/plugin/dsh-cc-studio
# 重启 dsh web（宿主行在启动时组合）
netstat -ano | Select-String ':3080'
# 验证：GET /plugins/@dsh-plugins/dsh-cc-studio/client.js 应 200
```

## 原型预览（决策已归档）

- 总览：`E:\dsh\plugin\dsh-cc-studio\prototypes\index.html`
- A 轻量浮层：`E:\dsh\plugin\dsh-cc-studio\prototypes\prototype-a.html`
- B 侧边常驻：`E:\dsh\plugin\dsh-cc-studio\prototypes\prototype-b.html`
- 定版：**融合**（胶囊常驻 + 按需展开 + 全屏沉浸）

## 规范依据

- `E:\dsh\plugin\_gh\character-card-spec-v3\SPEC_V3.md`（权威）
- `concepts.md` 已过时，仅参考
