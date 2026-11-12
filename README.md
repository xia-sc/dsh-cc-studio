# dsh-cc-studio · CCv3 角色卡工坊

[![npm version](https://img.shields.io/npm/v/@xia-sc/dsh-cc-studio?color=%237c5cff)](https://www.npmjs.com/package/@xia-sc/dsh-cc-studio)

> 从一句话点子到可导入 SillyTavern / Risu 的 `chara_card_v3`。专治「只有点子，世界观薄弱」。

DSH（DeepSeek Harness）插件：输入框上方的胶囊 → 全屏融合工坊，配合 `CC 模式` 预设让 LLM 用 33 个 Tool **先问再填**、与你共创角色卡，最后导出 `JSON / PNG / CHARX`，或**直接推进本机 SillyTavern**。

| 项目 | 值 |
| --- | --- |
| 包名 / 版本 | `@xia-sc/dsh-cc-studio` `0.21.0` |
| 兼容 | DSH `>=0.2.0-rc.2`（含桌面版）、Node `>=22`、**零运行依赖**；逐版本实测见 [兼容与权限](#兼容与权限) |
| 落盘 | `<DSH_HOME>/cc-library/`（角色卡）、`cc-drafts/`（会话草稿 + 创作锁 + 备份）、`cc-groups/`（关系分组）、`cc-books/`（组共享世界书）；`DSH_HOME` 默认 `~/.dsh` |
| 文档 | 用户文档＝本文件；改代码前读 [AGENTS.md](./AGENTS.md)；历史 [CHANGELOG.md](./CHANGELOG.md) |

## 安装

把下面整段交给你的 Agent（DSH 里的 Agent、Claude Code、Codex 都行）：

```text
任务：给 DSH 安装 @xia-sc/dsh-cc-studio 插件。
1. 确认 profile 名（~/.dsh/profiles/ 下的目录名；桌面版通常 desktop，CLI 的 Web GUI 通常 web）。
2. 安装：dsh plugin --profile <profile> add @xia-sc/dsh-cc-studio
   若 dsh 不在 PATH：桌面版自带 CLI 在 <安装目录>/resources/runtime/cli/bin/dsh。
3. 验证组合（只读）：dsh --profile <profile> --dump-config
   期望在 `# == @xia-sc/dsh-cc-studio` 下看到 `id: dsh-cc-studio`（宿主行）与 `id: preset-cc`（CC 预设行）。
4. 重启：CLI 重启 `dsh web`；桌面版退出并重新打开应用。
5. 不要手工拷预设到 ~/.dsh/.agent-presets/（不读）、不要手改 profile 的 package.json、不要反复重装。
权限：插件会写 <DSH_HOME>/cc-drafts/ 与 cc-library/；在 DSH 里由 Agent 执行时需 danger-full-access 文件权限。
```

手动安装与更新：

```bash
dsh plugin --profile web add @xia-sc/dsh-cc-studio          # 安装 / 更新
dsh plugin --profile web add @xia-sc/dsh-cc-studio@0.17.0   # 锁定版本
dsh plugin --profile web add github:xia-sc/dsh-cc-studio#v0.17.0  # 从 GitHub tag
dsh plugin --profile web remove @xia-sc/dsh-cc-studio        # 卸载
```

`CC 模式` 由随包补丁层 `presets/cc.patch.yml` 的声明行投递，装进哪个 profile 就出现在哪个 profile 的 roster 里；插件不往用户目录写任何预设文件。卸载**不会**删除 `cc-library/` 与 `cc-drafts/`。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 重启后浏览器报 `Failed to load plugins` / `4 entry did not activate` | 包名迁移后没按新名重装。检查 profile 的 `node_modules/` 下目录名是否等于 `package.json` 的 `name`；按新名重装 → 重启 → 硬刷新 |
| 改完代码没变化 | 改 `lib/client.js` → 刷新页面；改 `lib/index.js` / 预设 → 重启 dsh。工具返回里的 `build` 是判断「改了但没重启」的唯一可靠依据 |
| LLM 创作时点「载入」没反应、工坊只读 | **草稿锁**：LLM 写草稿后自动上锁，载入/导入只进只读预览。让 LLM 调 `cc_release_draft` 交还、或等锁 30 分钟无写入失效；也可在设置里关掉「LLM 创作保护」 |
| 模型偶发「tool input is invalid JSON」 | 模型生成的工具参数有语法错误（常见是尾逗号）。重发同一句话即可；persona 与写类工具已要求「严格 JSON + 分小步写」 |

## 快速上手

1. 新建会话，模式选 **CC 模式** —— 胶囊出现在输入框上方。
2. 直接说需求，例如「我想做雨城记忆典当行老板娘，世界观很薄」。
3. 模型按 6 步推进，每步先问你偏好再落笔：`cc_get_card` → `cc_patch_character` → `cc_patch_world` → `cc_add_lorebook_entries` → `cc_patch_greetings` → `cc_validate` → `cc_release_draft`（交还编辑权）。
4. 随时点胶囊进工坊看进度（LLM 写作期间只读）。校验通过后可在工坊微调、`★ 保存当前` / `＋ 另存为新`，或导出。
5. 想进 SillyTavern：打开导出弹层 → 底部「导入到 SillyTavern」→ 开始导入。

## 功能

### 融合工坊（客户端）

- **布局**：胶囊 → 全屏工坊；左侧 3 页导航（5 维世界观 / 角色细化 / 世界书）+ 左下角「校验导出」；右侧 268px 可折叠「已存角色」；主区底部默认收起实时 `card.json` 预览与 CBS 速查。
- **文档式阅读排版**：无边框 textarea 按内容撑高，点进去即可改；长文「⛶」开大框（带快照，「取消」真回滚）。
- **5 维世界观**：年表 / 势力 / 地理 / 力量体系 / 日常 → `autoLorebook` 生成带 `@@position / @@depth / @@activate` 的条目。
- **ID 化 CRUD**：保存当前（已载入时原地覆盖）/ 另存为新 / 重命名 / 新建 / 载入 / 删除，搜索与高亮，落盘 `cc-library/<id>.json`。
- **LLM 创作保护**：上锁期间只读，载入/导入只进预览；覆盖型动作前自动备份到 `cc-drafts/backups/`（同槽最多 20 份）。
- **导入导出**：`⬆ 导入 JSON/PNG/CHARX`（V2/V1 自动升级为 CCv3）、`⬇ JSON`、`⬇ PNG`、`⬆ 写入 PNG`（写入任意 PNG，自动剥离旧 `ccv3/chara` 块）、`⬇ CHARX`。
- **中英双语 + 深浅色**：跟随 `设置 → 通用 → 语言` 实时切换。

### CC 模式（模型侧 33 个 Tool）

6 步工作流 + 共创约束（每步先问偏好；世界书完成态 = ≥5 条且至少 1 条共创）。每次返回只有一份 `workflow.next` + `workflow.state` + `message`，另有 `build` 标明版本。

| 分类 | 工具 |
| --- | --- |
| 工作流（必调） | `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate` |
| 创作收口 | `cc_release_draft` —— 校验通过 = 创作完成，必须调用以交还草稿编辑权 |
| 世界书质量 | `cc_simulate_trigger` / `cc_lint_lorebook` / `cc_patch_book_meta` |
| 条目管理 | `cc_update_lorebook_entry` / `cc_delete_lorebook_entries` |
| 导出与起点 | `cc_preview_export` / `cc_new_card`（破坏性，需 `confirm:true`） |
| 人物关系 | `cc_get_relations` / `cc_patch_relations` / `cc_render_relations` / `cc_group_check` |
| 分组 | `cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group` |
| 共享世界书 | `cc_get_shared_book` / `cc_patch_shared_book` / `cc_promote_shared_entries` / `cc_apply_shared_book` |
| 已存库 | `cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry` |

### 时间锚定（防时间漂移，0.16.0）

LLM 续写时最容易「上一段早晨、下一段直接夜晚」。CC 模式会在每张卡里强制写入两段 ST 字段（`cc_validate` 缺任一项不通过）：

- `system_prompt`：每段回复必须以 `[时间：YYYY-MM-DD HH:MM]` 开头；时间只能向前、推进幅度与剧情匹配；不得无过渡跳时段；用户说「第二天」以用户为准。模板保留了 ST 默认的基础句。
- `post_history_instructions`：生成前自检 —— 上一段时间戳是什么、本段经过多久、是否跨时段；不输出自检过程，只输出新时间戳。

**0.17.0 起还有三处可选增强（把「时间自检」放得离生成点更近）：**

- **Character's Note（`depth_prompt`，默认自动写入）**：ST 每轮注入在最近 4 条消息之内，比 Post-History 更靠近生成点，且不受 ST 的 prefer 开关影响；群聊里每张成员卡各自注入。
- **世界书「时间锚定」常驻条目**（`cc_patch_world({timeLore:true})`）：每轮必插。⚠️ ST 不会自动把卡内 `character_book` 变成世界书 —— 要自动生效得放进组共享书（一键导入 ST 会先导书），否则需在 ST 里手动 Import Card Lore 或导出独立世界书。
- **变量占位**（`cc_patch_character({timeVariable:true})`，进阶）：在模板里加 `{{getvar::cc_story_time}}`。ST 的 `{{getvar}}` 会展开，但**卡本身无法自动写变量**（AI 输出里的 `{{setvar}}` 不会被执行，卡也带不了 Quick Reply）—— 需要在 ST 侧用 Quick Reply / `/setvar` 维护，没设置时模板回退到正文时间戳。
**自定义纪年 / 架空历法（0.18.0-alpha.2）**：锚点不再强制 ISO。推荐双轨 `[时间：1287-09-12 07:40]（天启三年九月十二·辰时）`；纯架空历法可直接写 `[时间：天启三年九月十二 辰时]`（能通过校验，但会提示补 ISO 前缀便于对照）；`cc_patch_greetings` 可用 `startAnchor` 自动补任意纪年前缀。注意：制卡期只校验格式，运行时的连贯仍靠模型。

`first_mes` 也带一个起始时间锚点（`cc_patch_greetings` 的 `startTime` 可自动补）。ST 默认 `prefer_character_prompt` / `prefer_character_jailbreak` 开启，导入即生效；**若你在 ST 里自定义过 Main Prompt，它会被卡里的 system_prompt 覆盖**（模板已保留基础句）。这是软约束：显著减少漂移，但不保证 100%。
### 设定铁律（Canon，0.19.0）

对话里的「吃书」不能靠插件拦 —— 卡导入 ST / Risu 之后插件就退场了；真正起作用的是**卡里带什么**。CC 模式在交付前把一张卡的设定压成一份短的「设定铁律」（≤12 条、每条 ≤40 字：一个实体 + 一句不可违背的事实），并编译进三处：

- **Character's Note（`extensions.depth_prompt`，主力）**：ST 每轮注入在最近消息内，不受 `prefer_character_*` 开关影响 —— 用户不需要做任何事。
- **Post-History（`post_history_instructions`）**：只追加一句仲裁语（「与上文冲突时以铁律为准，宁可暂停推进也不要改写设定」）—— 铁律全文不在这里重复，同一份事实清单每轮读两遍纯属浪费。
- **世界书常驻条目「设定铁律」**：`@@position after_desc` + `constant`。⚠️ 与「时间锚定」条目一样，ST 不会自动把卡内 `character_book` 变成世界书 —— 需在 ST 里 Import Card Lore、放进组共享书，或导出独立世界书才生效。

**每轮固定开销**（实测口径：CJK 一字≈1 token，其余 4 字符≈1 token）：12 条铁律时约 **1000 token/轮** —— system_prompt 440（时间规则 + 铁律指引，替换 ST 默认的 30 token 一句话）+ post_history 231（时间自检 + 仲裁语，替换空的 jailbreak）+ Character's Note 337（时间自检 + 铁律全文）。铁律全文只出现一次；若卡内世界书也加载，再加约 320（两条常驻条目）。

`cc_validate({canon:[{subject,fact}]})` 提交铁律；不传时工具按现有内容自动派生草案（`source=derived`，会给 warning 让用户确认）。门禁：超长、同一实体两条不同说法、同名条目两种内容 → `valid=false`；手工条目的主题没进铁律 → warning（触发型条目可带 `skipCoverage: true` 豁免，不必为了消 warning 硬凑铁律）。工坊点「校验」能看到完整清单（含冲突两处的原文）；注入后顶爆 `token_budget` 时返回 `budgetHint`（含下一步该发的 `cc_patch_book_meta` 调用与具体数值）。

**能力边界**：插件只做可计算检查（长度 / 重复 / 覆盖 / 极性词可疑），**不判断语义矛盾** —— 「债已清了」与「年底前总要核一次账」可以并存。语义冲突只能靠人（或审稿子代理）逐条对照。

### 未结案钩子检测（反细节循环，0.21.0）

小模型常揪住「一碗粥」不放 —— 只要它在首条消息里是**未完成状态**（「桌上那碗粥还热着」「手机没关」），模型就会把它当成本轮待办，之后每轮回收一次、每轮自我强化。

复读的种子不在运行期，而在**开场**。所以这一层做在制卡期，零运行期 token：

- 扫 `first_mes` / `alternate_greetings` / `group_only_greetings`，找「物品 + 未完成状态」（还热着 / 没关 / 没吃完 / 写到一半 / 在炉上煨着；食物词 + 还、在、正、没、热、凉、剩）。
- 命中且**该段 + 后 2 段内没有结案标记**（已经倒 / 关掉 / 吃完 / 结束…）→ 一条汇总 warning，附最多 5 个样本与消法。
- **不扫** `mes_example`（few-shot 示例不是当前场景状态）与 `scenario`（设定文档，静态物品多、误报高）。
- 纯启发式、**不阻塞导出**（`valid` 不受影响）；工坊「校验」能看到。

消法只有两条：在开场里顺手结案（「粥已经倒了」），或删掉那个钩子。

**若导入 ST 后仍然复读，那属于运行期问题**：卡内规则只是辅助，运行期要靠模型自身与 ST 侧的采样设置（重复惩罚等）—— 这不是一张卡能保证的，本插件也不提供运行期注入。

### 关系与共享世界书

- **人物关系**：三维（方向 × 类型 × 强度）；节点分「已存卡」与「卡内 NPC」；卡属于哪个组记在库条目 `meta.groupId`。渲染进 description 的 `<!-- cc-relations:begin … -->` 标记区，幂等替换、可预览。
- **组级共享世界书**：一组一本 `<DSH_HOME>/cc-books/<groupId>.json`，成员卡只留私有条目。迁移用 `cc_promote_shared_entries`（默认 dry-run，只删内容逐字相符的副本）与 `cc_apply_shared_book`（回填到卡）。
- **两种导出形态**：CCv3 独立 lorebook（`lorebook_v3`）给认规范的客户端；SillyTavern 只认 `{entries:{…}}` —— 两个按钮各有读者。

### 导出与 SillyTavern 导入

- 导出是**独立弹层**：左下角、总览页、已存卡卡片三处入口打开同一个弹层（JSON / PNG / 写入 PNG / CHARX / 校验）；卡片「导出」直接导出那张卡（`cardId`），不要求先载入。
- 共享书作用域跟随导出目标：库卡按它自己的分组，草稿按当前分组；没有分组就不写绑定。
- **一键导入本机 ST**：弹层自动探测 `http://127.0.0.1:8000`（可改地址、可选 Basic 认证；密码只存本次会话内存）。在线后点「开始导入」：宿主取 CSRF 会话 → 先导世界书 → 用 ST 返回的实际书名重写卡副本绑定 → 再导 PNG 卡。同名书默认跳过（勾选才覆盖），已有卡永不覆盖；可选一张封面。ST 默认 CORS 拒绝浏览器跨域，所以请求由宿主代发，本地草稿与库不动。

## 兼容与权限

- **支持范围**：dsh `>=0.2.0-rc.2`（0.1.x 整条线自 0.12.0 起不再支持）、Node `>=22`、零运行依赖、无 install 生命周期脚本。
- **逐版本实测**（`package.json` 的 `dsh.compatibility.dshReleases`）：`0.2.0-rc.2`（下限，声明行世代）、`0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.5`、`0.2.2-rc.1`、`0.2.2-rc.2` 全部 compatible。**未实测**、不进矩阵：`0.2.0-rc.1`、`0.2.1-alpha.1`、`0.2.1-rc.4`。
- **落盘权限**：`<DSH_HOME>` 下 4 个目录（`cc-drafts/` / `cc-library/` / `cc-groups/` / `cc-books/`），只用 `DSH_HOME` 一个环境变量。
- **网络**：仅一处出站 —— 导出弹层「导入到 SillyTavern」访问你填的本机 ST 地址（默认 `127.0.0.1:8000`），由宿主发起，浏览器不直连。插件更新检查自 0.20.0 起交给 dsh 内置功能。
- **STORE 收录**：本插件的核心功能就是落盘与读 `DSH_HOME`，触发文件/凭据信号，因此走 `user-reviewed`（本机逐次确认）档位，不会为了扫器通过而改运行时代码。

## 开发与测试

```bash
npm test    # 全部测试文件串行；全绿才算过
```

- 改 `lib/client.js`：刷新页面；改 `lib/index.js` / 预设：重启 dsh。
- 架构与硬约束（三半分工、RPC 线协议、预设单层声明、落盘根、测试隔离、版本矩阵、常见坑）都在 [AGENTS.md](./AGENTS.md) —— 动代码前先读。

## 更新日志

完整见 [CHANGELOG.md](./CHANGELOG.md)（保留 0.12.0 起）。

- `0.21.0` **未结案钩子检测**：制卡期扫开场三处的「物品 + 未完成状态」（粥还热着 / 手机没关），提示在首条消息里结案；零运行期 token、不阻塞导出。反细节循环里可计算的那一半。
- `0.20.1` **插件元数据**：新增 `locale/zh.json` / `locale/en.json`，插件管理器与设置页在未激活时也能显示「角色卡工坊」/「Character card studio」及对应描述；同时把 dsh `0.2.2-rc.2` 实测通过写入兼容矩阵。
- `0.20.0` **移除设置页「插件更新」区块**：dsh `0.2.2-rc.1` 起已内置插件更新检查，重复入口（含 `cc_checkUpdate` 端点与 npm 查询）一并删除，插件只剩 ST 导入一处出站请求。
- `0.19.2` **修复 stale 死循环**：显式重传逐字相同的 canon 现在会刷新指纹并清掉 `canon-stale`；`cc_add_lorebook_entries` / `cc_update_lorebook_entry` 支持 `skipCoverage`（触发型设定不必进铁律）；`cc_validate` 超预算时返回结构化 `budgetHint`；两条 warning 都写清「怎么消」。
- `0.19.1` **修复 0.19.0 的 3 个 bug**：派生 canon 必然超限（存量卡全部 `valid=false`）、极性词表把时间副词当极性词、纯规则条目被算进覆盖缺口；另加 `canon-stale` 指标、预算建议值、`digest` 派生预览等体验改进。
- `0.19.0` **设定铁律（Canon）**：把设定压成 ≤12 条短句，编译进 Character's Note / Post-History / 世界书常驻条目，让 ST 运行期每轮都读到；`cc_validate` 增加 canon 门禁与一致性清单（工坊「校验」可见），`cc_get_card({digest:true})` 提供不会被上下文裁剪的事实摘要。
- `0.18.0` **正式版**：包含 0.17.0 的时间锚定增强与 0.18.0-alpha.2 的自定义纪年（宽松锚点 + 双轨 + `startAnchor`）。
- `0.18.0-alpha.2` **时间锚点支持自定义纪年**（Issue #6）：宽松锚点 + 双轨写法 + `startAnchor`；纯架空历法通过校验（只给 ISO 对照 warning）。
- `0.18.0-alpha.1` 首个 Alpha 版本：发布流程支持预发布（`npm publish --tag alpha`，不覆盖 `latest`；Release 标 `--prerelease`）；功能与 0.17.0 相同。
- `0.17.0` **时间锚定增强**：`Character's Note`（`depth_prompt`）自动写入（ST 每轮注入在最近位置）；可选世界书「时间锚定」常驻条目与 `timeVariable` 变量占位（后者需 ST 侧 Quick Reply 维护）。
- `0.16.0` **时间锚定（防时间漂移）**：每张卡强制写 `system_prompt`（每段以 `[时间：…]` 开头、时间只能向前）与 `post_history_instructions`（生成前自检），`first_mes` 带起始时间戳；缺任一项 validate 不通过。
- `0.15.1` **新增**：导出面板一键导入本机 SillyTavern（宿主代发请求：CSRF 会话 → 先导书 → 用 ST 实际书名绑定 → 再导 PNG 卡；同名书默认跳过、已有卡不覆盖；可选封面与 Basic 认证）。**修复**：JPG/WebP 封面自动转 PNG；非 PNG 封面与未知错误不再误报「未检测到 SillyTavern」。
- `0.14.2` 库卡模式的共享书按那张卡自己的 `meta.groupId` 取（必要时用 `cc_getBook` 拉取并显示组名）。
- `0.14.1` 导出与载入解绑：卡片「导出」导出的是那张已存卡（`cardId`），不再要求先载入。
- `0.14.0` 导出改成独立弹层，不再占中栏整页；三个入口统一打开它。
- `0.13.0` CCv3 规范核心与 SillyTavern 兼容层拆成「核心 + 目标适配层」（`lib/compat/`），新增平台只需加一个 adapter。
- `0.12.1` / `0.12.0` 适配 dsh `0.2.2-rc.1`（预设子入口变更）；兼容下限抬到 `0.2.0-rc.2`，预设收敛成单层声明。

## License

MIT。收录与参考资料见 [CHANGELOG.md](./CHANGELOG.md) 与仓库 `AGENTS.md`。
