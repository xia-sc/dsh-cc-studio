# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。README 只保留最近几条，完整历史在本文件。

## 0.8.0

**新增：人物关系图谱与群聊分组。** 前面几轮把工具链正确性做扎实之后，这是第一个**面向新场景**的版本 —— 做一批「互相有关系的卡」来组群聊。

### 一、为什么这么设计（不改 CCv3 字段）

CCv3 **没有关系字段**，硬造一个会污染导出、别的客户端也不认。所以做成两层：

1. **插件层关系图谱**（`<DSH_HOME>/cc-groups/<id>.json`）是真源，三维 = **方向（from→to，天然不对称）× 类型（师徒/恋慕/敌对…10 类，可自定义显示名）× 强度（1-5）**；
2. **渲染进 `description`**：`cc_render_relations` 把关系写进固定标记区 `<!-- cc-relations:begin --> … <!-- cc-relations:end -->`，分享出去的卡**自包含**。渲染是**显式动作**、可 `dryRun` 预览、重复渲染是**替换**（幂等）、空图谱 = 清空该段。

节点分两类：**有独立卡的节点**（绑 `cardId`）与**卡内 NPC 节点**（如「柳长老」，没有自己的卡）—— 同一张图谱既能服务多卡群聊，也能让单卡「立体」。

### 二、数据落在哪

- 分组文件 `<主根>/cc-groups/<id>.json`：nodes / edges / rev / `nextNodeSeq`（组内短 id **不复用**，避免删除后重开撞旧引用）。
- **「卡属于哪个组」记在库条目 `meta.groupId`**（单一真源）；分组文件里**刻意不存成员列表** —— 成员由库条目派生，删卡/移组天然一致，不会双写漂移。
- 两半同构（`lib/index.js` / `lib/agent.js` 各一份纯函数 + 落盘），`tests/relations.test.mjs` 逐字比对两半的渲染输出与落盘根。
- 图谱写入带自己的 `rev` 乐观锁，参数名 **`expectedGroupRev`**（见第五节第 3 条）。

### 三、模型侧：4 个新工具（19 → 23）

| 工具 | 作用 |
| --- | --- |
| `cc_get_relations` | 读图谱（默认只回与当前卡相关的边；卡未入库/未入组时**明确告知**并列出现有分组，不猜） |
| `cc_patch_relations` | 批量增删改节点与边（addNode / updateNode / removeNode / addEdge / updateEdge / removeEdge） |
| `cc_render_relations` | 渲染进当前卡 description（`dryRun` 只回预览） |
| `cc_group_check` | 跨卡体检：孤儿节点、悬空关系、重名节点、未渲染/已过期、**群聊每轮固定开销**（成员卡 constant 之和 vs 预算） |

### 四、工坊侧（列表式，不做力导向图）

- 已存角色侧栏新增**分组选择器**（全部 / 未分组 / 各分组）+「＋ 组」+「关系」；每张卡片行上多了一个**归组下拉**。
- **关系视图**（`s.cur === 4`，与导出页同构、**不进左侧导航**）：成员卡、NPC 节点、关系列表（类型/强度/方向就地改）、添加关系表单、体检、渲染到当前卡、删组。

### 五、实现过程中被抓出来的三个问题

1. **`cc_save_to_library` 的 `action` 谎报**：传一个库里不存在的 id（群聊场景「从母卡派生出多张角色卡」的唯一路径）时它报 `updated` 而实际是新建 —— 模型会以为自己覆盖了别人。修法：改用 `saveLibraryEntry` 的实测判定（按「该 id 的文件是否已存在」算），宿主半与工具半一起改。
2. **`cc_render_relations` 漏了赋值**：`changed` 算出来了、`setDraft` 也调了，却没有 `cur.data.description = after` —— 表现是「返回 `changed:true` 而卡里什么都没变」。测试靠「盘上草稿 rev 涨了、内容里却没有标记」夹住。
3. **命名冲突**：分组乐观锁最初也叫 `expectedRev`，被 `tool()` 包装层的**草稿**乐观锁抢先拦截，错误文案还写着「草稿已被外部修改」，极具误导性 → 改名 `expectedGroupRev`（工具描述里写明两者区别）。

### 六、验证与生效

- 新增 `tests/relations.test.mjs`（**41 项**）：纯函数与 op 校验、渲染（追加/替换/**幂等**/只出边/清空）、**两半同构**（渲染逐字一致 + 落盘根一致 + 路径穿越防护）、落盘与 rev、端到端（建卡 → 入组 → 建关系 → 渲染 → 体检）、CAS 拒绝且零副作用、删卡降级 orphan（**保留边**）、改名同步节点名、4 个工具的返回契约。
- `npm test` 464 → **509 项**，12 个文件全绿。
- **生效方式：宿主半 + 预设半都改了 → 重启 dsh（桌面版重启应用）**。

## 0.7.1

**第五轮 LLM 侧回归的修复（重启后回归）。** 上一版的四项修复里有三项当场通过（N1 `creator` 写入 / N2 单次触发预警 / S2 重置不再误报 / N4 空改动不涨 rev，报告评「N2 超出建议」），另一项 S1 需要说明；同时新抓到一个**真 bug（B1）**——重启后第一次 `cc_get_card` 直接报非法 JSON。

### 一、B1（★★★）：外部导入的卡缺字段 → 工具返回非法 JSON

**现象**：dsh 重启后**第一次** `cc_get_card({fields:["name","creator","creator_notes"]})` 报 `Error: tool "cc_get_card" returned invalid output: value is not lossless JSON`，第二次起正常。而重启后的第一次调用往往正是 LLM 的第一步，用户看到的是「工具坏了」。

**根因**（用穷举探针定位，不是猜的）：DSH 对返回值做 lossless-JSON 校验 —— **任何嵌套 `undefined` 都会让整次工具调用失败**。而**外部来源的卡**（PNG / CHARX 导入、或早期版本写下的草稿）可能整个缺字段，代码却直接读它、原样输出：

- 缺 `spec_version` → `cc_get_card` 的 `fields` 路径输出 `draft.spec_version = undefined`（与报告里那条报错的参数逐一对应）；
- 缺 `creation_date` → `draftStatus.creation_date = undefined`（两条路径都会）。

「第二次起正常」是因为那之间草稿被别处重写过（工坊 / 后续写盘）顺手补齐了字段 —— 所以它只在冷启动第一次炸。

**修法（三层，两半同构）**：

1. **加载即补齐**：新增 `normalizeCardShape(draft)`（`lib/agent.js` 与 `lib/index.js` 各一份），草稿从磁盘恢复 / 重载时按空卡模板补齐缺失键 —— 只补 `undefined`，不覆盖已有值、不改类型（类型问题留给 `cc_validate` 报），模板之外的扩展字段原样保留。
2. **`draftStatus.creation_date` 显式兜底为 `null`**（两半），不再漏 `undefined`。
3. **输出卫生**：`apply()` 的 `tool()` 包装在返回前统一做一次 JSON 往返（`sanitizeJson`）—— **任何**工具、**任何**未来新增字段都不可能再把 `undefined` 漏给 DSH 的校验。

顺带的可见变化：工具返回的 `draft` 现在是**拷贝**（JSON 往返的产物），调用方改它不会再改到插件内部状态。

### 二、S1：机制在，但缺一个能对账的字段

报告判「S1 未实现」，其验证方式是在**工具序列内部**制造 rev 变化（先显式 CAS 写一次、再裸写）。这在设计上**不会**触发漂移：`meta.rev` 记的是「上次调用结束时盘上的版本」，自己写的那一次当然算自己的 —— 所以不提示是**正确的**。真正的漂移只来自**工具序列之外**的写盘（工坊界面保存 / host 恢复 / 另一个会话），这也是 `tests/tools-contract` ⑩f 的验法（直接改草稿文件 + 递增 rev，裸写立刻报 `revDrift`）。

为了让调用方**随时能自己对账**（而不是只能等那条一次性提示），本版给 `draftStatus` 增加 **`watchedRev`**：本次调用开始前工具半记着的盘上版本 —— `watchedRev ≠ rev` 就等价于「这两次调用之间别人写过」。

### 三、B2：`changed` 与 `rev` 判据不一致

**现象**：传与原值相同的 `creator` → `changed: ["creator"]`（说改了）而 `rev` 纹丝不动（没改）。

**修法**：新增 `assignIfChanged()`，两者从此同一套判据 —— 只有值真的变了才记改动（`cc_patch_character` / `cc_update_lorebook_entry` / `cc_patch_book_meta` 全部改用它，数组按 JSON 深比较）。

### 四、`build` 版本标识（来自测试者的流程建议）

第五轮第一次跑出「四项全无变化」，其实是**没重启 dsh** —— 而 LLM 完全无法分辨「代码没改」和「改了但没加载」，白跑一整轮。现在**每个工具的返回都带 `build`**（与 `package.json` 的 `version` 同步，测试 ⑪i 钉住），任何一次调用都能先确认自己测的是哪一版。

### 五、验证与生效

- `tests/tools-contract.test.mjs` 75 → **84 项**：新增 ⑪ 区块 —— 缺 `spec_version` / `creation_date` 的草稿不再产生非法 JSON、全量路径同样补齐、**宿主半同构**、`build` 存在且与 `package.json` 同步、`watchedRev` 存在、B2 的同值不记改动 / 真改动记改动 / `cc_patch_book_meta` 同判据。
- 验收还用了**穷举探针**：把真实草稿的每个键（`data` 一级 20 个 + 顶层 2 个 + `character_book` 7 个）逐个删掉，三条调用路径各跑一遍 —— 修复前 3 个问题案例，修复后 **0 个**。
- `npm test` 455 项 → **464 项**，11 个文件全绿。
- **生效方式：宿主半 + 预设半都改了 → 重启 dsh（桌面版重启应用）**。重启后随便调一个 `cc_*`，返回里带 `build: "0.7.1"` 就说明新代码已加载 —— 这也是本次新加的判据。

## 0.7.0

**第四轮 LLM 侧回归的修复（S1/S2/S3 验证 + 新题材/群聊卡/超长世界观三合一压测）。** 测试者专程验上一版留的三条建议，结果**三项都还没落实**（S3 更是发现那个字段**根本没有写入路径**）；压测全流程零错误，但挖出一个**真实性能陷阱**。本版把这四条 + 一条极轻微的一并修掉。

### 一、N1（原 S3）：`data.creator` 是个没有写入路径的字段

**现象**：`cc_validate` **每次**都警告「`data.creator` 为空（导出后别人看不到作者）」，但 `cc_patch_character` 的参数表里没有 `creator`（只有 `creator_notes`）—— 实测传进去 → `changed: []`、`message: "无改动"`，**参数被静默忽略**。工具在反复催一个它没给解决办法的问题，长会话里只会变成噪音，甚至诱导模型反复做无效写入。

**修法**（三个入口一起补，此前一个都没有）：工具侧 `cc_patch_character` 加 `creator` 参数；宿主半 `cc_patchDraft` 同构支持；工坊「角色基础」页加「作者（creator）」输入框（`zh` / `en` 词表同步）。`cc_validate` 那条警告也补上解法指引（点名 `cc_patch_character` 的 `creator`）。

### 二、S2：主动重置被报「内容可能已丢失」（误报会训练人忽略 warning）

**现象**：模型明确 `cc_new_card({confirm:true})` 重置之后，下一次写入仍收到「⚠️ 当前会话此前无草稿…若此前有未 ★ 保存到侧边栏的内容可能已丢失」—— 根因是「有意重置」与「会话里真的没草稿」共用同一个 `isNew` 标记，没法分流。

**修法**：新草稿提示改成**待告知标记** `pendingFresh` —— 只有「内存与磁盘都没有草稿、这次调用才现建了一张空卡」才是 `"welcome"`（真·host 重启后的新会话，提示有意义），`cc_new_card` 主动重置则清掉它。同时提示本身从「各工具自己拼」改成由 `apply()` 的 `tool()` 包装**统一发一次**（此前 warnings 一条、message 里再抄一条，同一个状态两份）。

### 三、S1：不传 `expectedRev` 时也会发现前提过期

**现象**：乐观锁是**可选参数**，弱模型不会主动传，于是完全没有保护；返回里也没有任何「你手上的版本已经过期」的迹象（测试者据此判定「未实现」）。

**修法**：把「草稿被外部改过」的判据统一成一条 —— **盘上 rev 与本次调用开始前记着的 rev 不一致**（`meta.rev`；自己写的那一次不算）。命中时返回 `revDrift: {from, to}` + 一句「⚠️ 草稿已被外部修改（工坊界面操作或 host 恢复），已自动同步到最新版本（rev A → B）…」。原来的 `externalChange` 标记随之删除 —— 同一件事不再有两套状态。

### 四、N2：长五维 + autoLorebook 原文照搬 = 单次触发 token 爆炸（本轮最重要）

**现象**（压测实测）：`token_budget` 默认 1200、总量 2272 看着只是超一点；但一句「剑冢到底是什么地方」**单独就吃掉 1139 token**（势力 + 地理 + 力量体系(constant) + 剑冢(constant)）。

**为什么危险**：lint 只报总量，而「总量超预算」是个**可以被 `cc_patch_book_meta` 调大预算「修好」的假象** —— 测试者把预算调到 2600 后 lint 就只剩一条 warning，可单次爆炸一点没变。不跑 `cc_simulate_trigger` 的话写卡时根本发现不了，只有真聊到那句话才会被吃上下文，而用户只会觉得「模型怎么变笨了」。

**修法**（三条，都不改数据结构）：

1. **`cc_lint_lorebook` 新增「最坏情况单次触发量」**：把**共享同一个触发词的条目**并成一组（传递闭包 —— A/B 共享 x、B/C 共享 y，那 一句话能把三条全带出来），再叠加每轮必插的 constant，取最大的那组。返回 `worstCase: {tokens, constantTokens, budget, entries, overBudget}`；超预算时给一条 warn，并写明「调大 token_budget 盖不住这条」。单字符 key 不参与共现（`"a"` 会把整本书并成一组，全是噪音）。
2. **`cc_patch_world` 在写入时就报 `sharedLoreKeys`**：同一个实体被分给多个维度（实测里「剑冢」同时落在 `factions` / `geo` / `power`）时**当场**说破，不必等写完再跑 lint。
3. **auto 条目过重也提示**（`heavyAutoEntries`）：单条 content 估算超过 400 token 时说明「auto 条目的 content 是五维原文照搬，写多细就多重」，并给出精炼路径。

### 五、N4：空改动也消耗一个版本号

**现象**：一次 `changed: []` 的写入（传了被忽略的参数）让 `rev` 从 7 递增到 8。后果轻微但真实：持有旧 rev 的调用方会白失败一次（「草稿已被外部修改」），而草稿内容其实没变。

**修法**：两半同构 —— `setDraft` / `setDraftFor` 在**内容指纹未变时（忽略 `modification_date`）不落盘、不递增 rev**。工坊侧每次编辑都会调 `cc_setDraft`，同值覆盖（失焦、重复输入）同样不再涨 rev。

### 六、验证与生效

- `tests/tools-contract.test.mjs` 63 → **75 项**：`creator` 写入与 validate 警告闭环 / 主动重置不再误报 + **真·新会话仍然报**（成因分流的对照）/ 不传 `expectedRev` 也拿得到 `revDrift` / 空改动不涨 rev（工具半 + **宿主半同构**）/ `sharedLoreKeys` 当场警告 / lint 的 `worstCase` 与 `cc_simulate_trigger` 实测**数值吻合**（54 = 54）/ 超长维度触发 `heavyAutoEntries`。
- `npm test` 443 项 → **455 项**，11 个文件全绿。
- **生效方式：宿主半 + 预设半都改了 → 重启 dsh（桌面版重启应用）**。工坊那个「作者」输入框属于客户端改动，刷新页面即可，但重启后一起生效更省事。

## 0.6.0

**第二轮 LLM 侧回归的修复。** 上一版把第一轮 15 条发现修完后，测试者又走了一遍全流程 + 一次受控复现：10 条完全修复、2 条部分修复，同时抓出一条**新的 P0**（静默数据损坏）。本版修掉那条 P0 与 4 条残留。

### 一、P0-6：草稿被外部替换时，LLM 完全无感知（已造成一次数据误伤）

**事故**（第二轮实测，数据已完整恢复）：LLM 建了一张「回归测试卡」并在它上面连续操作；下一次 `cc_patch_character({personality: ""})` 的返回突然变成**另一张卡**（`loreCount` 5→9、`creation_date` 变了），于是那次「清空 personality」落在了用户刚在工坊里打开的那张卡上。根因不是「用户误点」，而是**工具链里没有任何字段能告诉模型「草稿已经不是我以为的那张卡了」**：

- `draftStatus.key` 是**会话槽**标识（同一会话里恒定不变），字段名却像「草稿标识」；
- `draftStatus.isNew` 两轮测试里**从未出现过 `true`**（`cc_new_card` 重置后仍是 `false`）；
- 写类工具的返回里**根本没有卡名**。

**三层修法**：

1. **身份字段**：每个工具的返回现在都带 `cardName` + `cardId`（未关联已存卡时为 `null`）；`draftStatus` 里把 `key` 改名为 **`sessionKey`**（明说它是会话槽、不是卡片身份），并补上 `cardName` / `cardId` / `rev`。
2. **`rev` + 自动重载**：草稿文件新增 `rev`（每次落盘 +1，**两半同构** —— 工具半与宿主半各持各的内存，只有文件里的 rev 是共同真相）。工具侧每次取草稿都比对盘上 rev：一旦发现被外部（工坊界面 / host 恢复）改过，就**以盘为准重载**，并给出一条明确提示：「⚠️ 草稿已被外部修改（工坊界面操作或 host 恢复），已自动同步到最新版本 —— 当前卡片「X」…动手改字段前先确认卡片名对不对。」（读后即清，不会每次调用都刷。）
3. **`expectedRev`（乐观锁）**：写类工具可传上次返回里的 `draftStatus.rev`；不匹配就直接拒绝（`ok:false` + `staleRev:true`），不让模型拿过期前提去写。

顺带修掉 `isNew`：`cc_new_card` 重置后现在正确返回 `true`。

### 二、第一轮的残留（R1–R4）

- **R1**：`cc_validate` 通过后 `next` 说「已完成」、`hint` 却说「下一步必须 cc_validate」（还写着 `6/6`）—— **半修的状态机比没修更危险**（弱模型会读信息最全的 hint）。现在 `hint` 与 `next` 同源：由 `progressHint()` 统一生成，终态是 `工作流 7/7 … · 已完成，可导出/保存`。
- **R2**：`hint` 曾内嵌 `next` 全文、`message` 又等于 `hint`（同一句话在一份返回里出现 3 次）。现在 `hint` 只报进度、`next` 只报下一步、`message` 是给用户的一句复述（带「当前进度：」前缀），三者不再互相复制。
- **R3**：`cc_validate` 的 `message` 里「校验通过 ✓」连说两遍（拼了 `next` 又来一遍）→ 去掉拼接。
- **R4**：重新生成 `autoLorebook` 会**静默覆盖手工改过的 keys** → 新增 `autoLoreEdited` 计数 + warning：「被替换的 N 条旧自动条目（…）的 keys 曾被手工改过，这次已重建回默认维度名，手工触发词会丢。」判定依据是 `extensions.cc_world_ref` + keys 是否偏离默认的「维度名 + 英文维度名」。

### 三、验证与生效

- `tests/tools-contract.test.mjs` 50 → **63 项**：新增身份字段 / `sessionKey` / rev 递增 / **外部改写后自动重载 + 提示**（直接改草稿文件模拟工坊侧写入）/ 乐观锁的拒绝与放行 / `isNew` / R1 终态 hint / R2 三处不再互相复制 / R3 去重 / R4 覆盖提醒。
- `npm test` 430 项 → **443 项**，11 个文件全绿。
- **生效方式：宿主半 + 预设半都改了 → 重启 dsh（桌面版重启应用）**。

## 0.5.0

**一整轮「LLM 侧体验测试」的修复。** 让另一个 LLM 以**工具使用者**的身份把 `cc_*` 工具链完整走了一遍（做出一张可用卡 `江晚` + 存库回环），交回 15 条发现 + 8 项工具建议。本版把 P0/P1 全部修掉、补了 5 个它点名「缺」的工具，宿主半 / 工具半 / 客户端 / 预设四层都有改动。

### 一、P0：四条真会咬人的

1. **`autoLorebook` 的 keys 只有维度名**（`年表/timeline`、`地理/geography`…）→ 真实对话永远不会说「地理」，5 条里 4 条是**死条目**，却让用户以为「世界书已经齐了」。现在 `cc_patch_world` 新增 **`loreKeys`**：模型写五维时一并自报实体名（如 `{geo:["旧校舍","广播室","天台"]}`）；不给就用「维度名 + 英文维度名」兜底，并在返回里明确警告「这样永远命中不了」。
2. **状态机跳步**：auto 一次生成 5 条 → 世界书判定立刻为「齐」→ `step` 从 3 跳到 5、`next` 直接指向问候语，可工具契约里 `cc_add_lorebook_entries` 写着**必调** —— 模型同时收到两条相反指令。现在世界书的完成态是「**≥5 条且至少 1 条共创条目**」（自动条目不算完成），validate 也会因此报 error。
3. **校验通过后 `next` 仍写着「下一步必须 cc_validate」**（同一次返回里 `hint` 却说「已通过」）—— 弱模型的死循环诱因。现在通过后有终态：`done: true`、`workflow.step: 7`，`next` 指向导出/保存。
4. **载入后不传 id 保存会产生重复卡**（`cc_load_from_library` 的文档承诺「再次保存将按此 ID 更新」并未实现）→ 用户载入自己的卡、改两笔、保存，库里就多出一张同名卡，反复几次一地垃圾且毫无提示。现在草稿旁落一份 **sidecar**（`cc-drafts/<key>.origin.json`）记住来源 id，保存时沿用；工坊侧刷新页面也不丢（宿主把 `originId` 一并回给前端，前端据此恢复「已载入 ID」）。

**外加一条源码复核发现的（报告没抓到）**：`cc_patch_world` 清理旧自动条目时**只按名字兜底**（为兼容 0.3.x 无 `cc_auto` 标记的旧数据），于是**用户手工建的、恰好叫「日常」的条目会被静默删掉**。现在兜底同时要求内容确实是自动格式（`@@` 开头或带英文维度 key）。

### 二、P1：返回体、校验与缺失的能力

- **返回体瘦身**：顶层不再有 `next` / `hint` / `notice` / `warning` 副本（同一句「下一步」曾在一份返回里出现 4–6 次），只留 `workflow.next` + `workflow.hint` + `message` + `warnings[]`；patch 类默认只回 `changed` 字段名，要全量再传 `verbose: true`；`cc_get_card` 支持 `fields`，`cc_load_from_library` / `cc_get_library_entry` 支持 `includeDraft: false`。
- **三态替代「Ok 与 Partial 同时为 true」**：`workflow.state = { character, world, lore, greetings }`，取值 `missing | partial | ok`，另给 `readyToValidate`。
- **`cc_validate` 真的会挑毛病了**：新增 12 类 warnings（世界书没有名字、没有 constant 常驻条目、keys 只有维度名、keys 在 content 里找不到、非 constant 条目没有 keys、估算 token 超出 `token_budget`、`creator` / `mes_example` 为空……），并给出估算 token。
- **改名 = 单一事实来源**（`cc_rename_in_library`、工坊的「重命名」、`cc_save_to_library` 的 `name`）：此前只改 `meta.name`，于是侧边栏显示新名、导出的卡里还是旧名，用户反复改名却不明白为什么不生效。现在两处一起写。
- `cc_delete_from_library` 返回 `remaining`（并说明是否顺带解除了来源关联）；`meta.tagsTotal` 记下真实标签数（列表只展示 6 个，但侧栏的「+N」不再算错）。
- 文档写明 `cc_patch_character` **传空字符串 = 清空该字段**（此前只有「不传 = 保持原值」这一半）。

### 三、新增 5 个工具（它点名要的）

| 工具 | 解决什么 |
| --- | --- |
| `cc_simulate_trigger` | **报告里最看重的缺口**：给一句话返回会被触发的条目 + 估算 token，写入时就能自查死条目，不用等用户聊两句才发现 |
| `cc_new_card` | 干净起点（破坏性：必须先经用户同意再带 `confirm:true`，否则只返回提示、不改任何数据） |
| `cc_patch_book_meta` | 改世界书顶层参数：`name` / `description` / `scan_depth` / `token_budget` / `recursive_scanning` —— 此前一个都改不了 |
| `cc_lint_lorebook` | 世界书静态体检：空 keys、只有维度名、keys 与内容无交集、重复触发词、constant 数量、预算占用 |
| `cc_preview_export` | 导出前干跑：体积、估算 token、字段清单（顺带回答「五维会不会一起导出」），并量化五维与世界书条目的重复字符数 |

工具数 **14 → 19**；预设 persona（两份载体）同步收录新工具与新的第 4 步要求，并修掉其中过时的「导出 JSON」指引（0.4.1 已改成导出页）。

### 四、验证与生效

- 新增 `tests/tools-contract.test.mjs`（**50 项**）：真挂 `lib/agent.js`（隔离 `DSH_HOME`/`HOME`/`USERPROFILE`）逐个调用工具，钉住返回契约（顶层不许再有 `next/hint/notice/warning`）、三态状态机、跳步修正、校验终态、`loreKeys` 优先与维度名兜底、**手工同名条目不被误删**、`changed`/`verbose`/`fields`、5 个新工具、存库回环（`created → load → save` 必须是 `updated` 而非新建、`meta.tagsTotal`、改名同步 `data.name`、删除回 `remaining`），以及**两半 sidecar 互通**（工具半写的来源 id 宿主半读得到、路径算成同一个文件）。
- `npm test` 10 个文件 380 项 → **11 个文件 430 项**，全绿。
- **生效方式：宿主半 + 预设半都改了 → 需重启 dsh（桌面版重启应用）**；客户端半的改动在重启后自然重载。

## 0.4.1

**三件事：① 导出入口归一（三处「导出」收成两处）；② 工作坊关闭按钮改成 ✕（悬停红底）；③ README 写明桌面版（DeepSeek Harness Desktop）支持。** 宿主半一行未动，运行时代码只改了 `lib/client.js`。

### 一、导出入口归一（本版主线）

**现象**：同一个「导出」在工坊里出现了三处，彼此重复又不一致 —— ① 顶部工具条右侧的「⬇ 导出 JSON」；② 左侧导航第 4 步「校验导出」（点开中栏是一整页 JSON / PNG / 写入PNG / CHARX 按钮）；③ 已存角色卡片里的「导出」（直接下载那张已存卡的 JSON，跟工坊当前内容无关）。

**改法**：

1. **删掉顶部「导出 JSON」** —— 工具条右侧只剩一枚关闭按钮（本版顺手把它改成了 ✕ 图标按钮 + 悬停红底，见下）；
2. **左侧导航与顶部胶囊都只留写作三步**（5维世界观 / 角色细化 / 世界书）：导出不再是「第 4 步」；
3. **「校验导出」与左下角那枚「校验」按钮合并成一枚**：点它切到导出页，校验与导出动作都只留在那一页里（身处导出页时按钮带 `aria-current="step"` 与淡紫选中态，和左侧导航同一套视觉语言）；
4. **已存角色卡片上的「导出」保留原位置**，但改成切到同一页，不再自己下载 JSON；`store.exportLibraryEntry` 这条旁路实现一并删除 —— 同一次导出不许有两套行为。

导出页本身的功能一个没少（JSON / PNG / 写入 PNG / CHARX / 校验 五枚按钮原样保留），只多一行说明：「导出的是当前工坊里的角色卡；要导出某张已存角色，请先在右侧载入它」（新键 `workshop.export.currentHint`）。**想导某张已存卡：先「载入」→ 再导出。**

顺带把导出页那枚写死的 `"⬇ JSON"` 接回词表（`action.exportJson`），UI 层不再有裸文案。

**反馈补强**（第一版实机试过之后用户提的两点，同版追加）：

1. **导出页标题带上卡名**：`校验与导出 — JSON / PNG / CHARX · <卡名>`（卡还没名字时显示「未命名」）—— 从已存角色卡片跳进来时，用户第一眼要确认的就是「这一页在导哪张卡」；
2. **卡片上的「导出」点下去自己先变**：按钮文案短暂变成「已切到 ✓」、配色转绿，6 秒后自动复原 —— 切页发生在中栏，而用户的视线停在右侧卡片上，**只切页等于「没反应」**；
3. **导出页顶部换成醒目提示**：从卡片跳进来、且那张卡不是工坊里这张时，显示琥珀色提示条「已切到导出页 · 导出的是当前工坊里的「当前卡名」；「来源卡名」还没载入，要导它请先点它那行的「载入」」，随上面那个定时器一起收起；其余情况仍是常驻的 `workshop.export.currentHint`；
4. **左下角那枚入口按钮不做选中态**（第二轮实机反馈）：上一版给它加过淡紫选中态 + `aria-current`，结果从卡片点「导出」时它与卡片那枚「已切到 ✓」同时发亮 —— 又成了「两处看起来像选中」，正是 0.4.0 修过、用户最敏感的那一类问题。现在它永远是那副主按钮样子，**「现在在导出页」由中栏标题（写着卡名）表达，不由按钮表达**。

### 二、工作坊关闭按钮改成 ✕（悬停红底）

**需求**（用户）：工具条右侧那枚按钮写着「收起」，既占宽度，又跟旁边那排步骤胶囊抢注意力 —— 改成「✕」图标按钮，点击关闭，**鼠标移入给红色背景**。

**改法**：`S.head` 右侧那枚按钮换成固定 **30×30 的图标按钮**，文案 `✕`，`title` 与 `aria-label` 都取 `action.close`（图标本身没有可读文字，读屏与悬停都要能解释它是「收起」）；默认是低调的描边态（透明底 + 主题描边 + 主文本色），**悬停换成危险色 `#e05555` 红底白字** —— 红色是「离开 / 收起」的通用暗示 —— 并带 `.12s` 过渡，不是硬切。hover 仍走组件内的局部 state（内联样式没有伪类，也不该为一次悬停重渲染整棵工坊），鼠标按下照旧 `preventDefault` 不抢焦点。

词表键 `action.close` 保留：已存角色侧栏那枚「▶ 折叠」的 tooltip 还在用它。

### 三、README 写明桌面版支持（本次另一半）

**动机**：README 的安装章节通篇以 `dsh plugin --profile web …` 为例，读者看不出「桌面版能不能用」。实际上桌面版就是同一个 dsh 宿主（Electron 内嵌），插件照样从 profile 的 `dsh.profile.bundles` 加载 —— 能力上早就支持，只是文档没写。

| 位置 | 内容 |
| --- | --- |
| 「安装」章引言（README / README_EN） | 点明同时支持 `dsh web` 与桌面版，并说明差异只有 profile 名与「重启应用」两步 |
| 新增「7. 桌面版（DeepSeek Harness Desktop）」 | 安装入口（应用内左侧「插件」面板，或 `dsh plugin --profile desktop add …`）、profile 名通常是 `desktop`、宿主与客户端改动的生效方式、数据位置；并提示「重启应用 ≈ 重启宿主、刷新窗口 ≈ 刷新页面」，排查时可混用 |
| 「兼容与权限」表 | 新增「宿主形态」一行；原来容易误读的 `Profile \| web` 改成「客户端平台」，并说明它是 `dsh.client.platform`（**浏览器半**的平台标识），与 dsh 的 profile 名不是一回事 |
| 安装示例 | 锁定版本的示例从过时的 `@0.3.7` 更新为 `@0.4.0` |

### 四、验证与生效

- 新增 `tests/export-entry.test.mjs`（31 项）：把 `lib/client.js` 装进假 React harness 里渲染，断言「点一下之后发生了什么」—— 顶部再也找不到导出按钮、左下角入口唯一且点它切页**不发任何 RPC**、导出页五枚按钮齐全且「⬇ JSON」仍然真的触发下载、卡片「导出」不碰 `cc_loadFromLibrary` / `cc_getLibraryEntry`（不自动载入、也不直接下载）、词表里旧键删净新键中英齐全；反馈补强那几条也在里面：标题带卡名（含「未命名」兜底）、点完按钮变「已切到 ✓」、导出页换成来源卡提示并在 6s 定时器到点后复原、**左下角入口按钮不论在哪个页面都不许出现「选中」痕迹**（直接钉住用户报的那个「两处选中」）。
- 既有守卫同步更新：`tests/nav-highlight.test.mjs`（导航与顶部胶囊 4 项 → 3 项）、`tests/clear-card.test.mjs`（底部那枚按钮改叫「校验导出」入口）。
- 新增 `tests/close-button.test.mjs`（14 项）：断言 ✕ 按钮的文案 / tooltip / aria-label / 固定尺寸、默认描边态 → 悬停红底白字 → 移开复原（且悬停不写进 store）、鼠标按下不抢焦点、点击后工坊真的收起、重新打开时悬停态不残留。
- `npm test` 从 8 个文件 335 项 → **10 个文件 380 项**，全绿。
- **生效方式：只改客户端 → 刷新页面**（桌面版是刷新窗口；`dsh web` 不用重启）。

## 0.4.0

本版三件事，都是**纯客户端**改动（`lib/client.js`），宿主半一行未动：

1. **修**工坊左侧步骤列表的高亮：点过某一步之后，那一项周围会多出一圈「莫名其妙的描边」，切步后还赖在旧项上；
2. **新增**「清空当前角色卡」按钮（在左侧底部「校验」下面），二次确认后把当前卡清成空卡；
3. **重构**工坊 UI（本版主线）：以阅读为主 —— 字段改成文档式排版、实时预览与 CBS 速查收到主区底部并默认折叠（原「融合说明」纯介绍块直接删掉）、砍掉右侧那 360px 一栏。

### 一、现象

- 点左侧「5维世界观 / 角色细化 / 世界书 / 校验导出」里任意一项，那一项周围会多出一圈细描边，和选中底色叠在一起；
- 再用顶部胶囊切到别的步骤，**这圈描边留在刚才那一项上不动** —— 列表里于是同时有两处「看起来像选中」：新项的选中底 + 旧项的描边（用户原话：「周围出现了一圈莫名奇妙的边框」）。

### 二、根因

`navItem` 只按 `s.cur` 画选中态，**从没管过浏览器焦点**：

- `<button>` 被鼠标点击后会拿到焦点并一直保持，宿主/浏览器的焦点描边（`:focus` / `:focus-visible` 的 `outline`）就画在按钮外沿 —— 那圈「莫名其妙的边框」就是它；
- 顶部步骤胶囊是 `<span>`，点它不抢焦点，所以「点胶囊切步」之后旧按钮仍然持有焦点，描边原地不动；
- 旧选中态只有一层 `bg-layer-2` 灰底（`navBtnActive`），视觉上压不住描边，用户自然会觉得「框才是选中」。

### 三、修法（`lib/client.js`）

| 改动 | 为什么 |
| --- | --- |
| 导航项 `onMouseDown` → `preventDefault()` | 鼠标点击不把焦点抢到按钮上（键盘 Tab 照旧可聚焦），描边从源头不再产生 |
| 导航项 inline `outline: none`，仅 `:focus-visible` 时给 2px 品牌色环 | 压住宿主/UA 的焦点样式；键盘用户的可见焦点不被牺牲（`matches(":focus-visible")` 判定，老浏览器按「有焦点」兜底） |
| 选中态改品牌紫：`rgba(124,92,255,.16)` 淡底 + `inset 3px` 左竖条 + `aria-current="step"` | 与顶部胶囊同一套语言，一眼看清「当前在哪一步」，不会再和焦点环混淆 |
| 补 hover 反馈（`onMouseEnter/Leave`），顶部胶囊同款 | 悬停有回应，不必靠「点一下看看」确认 |
| 鼠标在面板任意处按下即收起键盘焦点环 | 混合输入：键盘 Tab 聚焦 A 后用鼠标点胶囊切步，A 的环不该继续挂着 |

悬停/焦点是组件局部 `useState`，**不进 store** —— 否则鼠标每移动一次都要重渲染整棵工坊树（右侧预览是整份 JSON）。

### 四、新增：清空当前角色卡（在「校验」下面）

需求：左侧底部「校验」按钮下面再加一枚「清空」，**二次确认**后清空当前角色卡的全部内容。

| 改动 | 为什么 |
| --- | --- |
| `store.clearDraft()`：整份草稿换回 `makeDraft()` 空卡，五维世界观状态、`valid`、大框编辑态一并复位 | 「清空」= 回到新建时的空卡，而不是留着一半旧状态 |
| 同时把 `currentLibraryId` 置空 | 否则清空后点「保存当前」会把**已存角色里那张卡覆盖成空卡**；要删卡请用右侧列表的删除 |
| 清空后照常 `pushDraftToHost`（`cc_setDraft`） | 与其它写入同一条落盘路径：刷新页面、模型侧读到的都是空卡 |
| 按钮回调先过 `window.confirm(t("store.confirmClear"))`，取消 / 没有确认框 / 确认框抛错一律不动 | 破坏性操作要二次确认；拿不到确认框时**宁可什么都不做**，也不静默清数据 |
| 「校验」「清空」两枚按钮都加 `onMouseDown` → `preventDefault()` | 与左侧步骤项同款：鼠标点击不留焦点描边（就是本版上面修的那个坑） |

清空**不跳步骤**（只清内容，不挪视野），也不碰已存角色里的任何存档。

### 五、UI 重构（本版主线：以阅读为主）

诉求：工坊太挤、右侧「实时预览」太占地方又用处不大、手动编辑不该抢戏。

| 改动 | 原来 | 现在 |
| --- | --- | --- |
| 右侧那一栏 | 独立 360px 侧栏：实时 CCv3 预览 + CBS 速查 + 融合说明 | 前两块挪到主区底部，**默认全部收起**（只占一行标题；预览那行右侧仍带 `spec` 与「通过/失败」徽章，不展开也知道状态）；第三块「融合说明」是纯介绍文案，**已直接删除** |
| 主区宽度 | 四列 `220 + 1fr + 280 + 360`，阅读区被压到 ~700px | 三列 `200 + 1fr + 268`，阅读区 ~876px（1400 宽窗口实测） |
| 字段排版 | 每个字段一个带边框的输入框，一屏都是「表单」 | 「阅读态字段」：小号标签 + **无边框 textarea**（`field-sizing: content` 按内容自动撑高）—— 默认看起来就是排好版的正文，点进去直接改 |
| 手动编辑 | 主入口是内联输入框 | 退成次要入口：字段仍可直接编辑，长文走右上角 ⛶ 大框（打开时快照 + 取消回滚的机制不变） |
| 空字段 | 空输入框分不清「空」还是「没渲染」 | 统一显示「未填写」占位（新词表键 `workshop.field.empty`） |
| 视觉 | 圆角/内边距/字号散落在各处内联样式里 | 收敛成 `readCard / readTitle / readHint / fieldRow / fieldLabel / readText / readInput / fold / foldHead / foldBody` 一套，颜色一律走 dsh 的 `--dsw-alias-*` token |

功能一个没少：四步导航与顶部胶囊、导入/导出（JSON / PNG / 写入 PNG / CHARX）、校验、保存/另存/重命名/新建/载入/删除/导出库项、五维大框、⛶ 长文大框、多段问候语逐条编辑与删除、Lorebook 条目 enabled/删除/新增、草稿槽告警与迁移提示 —— 全部保留，只是换了位置与视觉。字段构造器也从 `fieldHead(title,key)`（只管「标签 + ⛶」）重写成 `field(title,key,opts)`（标签 + ⛶ + 输入控件一体），旧的 `S.card` / `S.field` / `S.mono` / `S.side` 四个样式随之删除。

### 六、验证与生效

- 新增 `tests/nav-highlight.test.mjs`（23 项）：把 `lib/client.js` 装进假 React harness 渲染后直接断言样式 —— 点击后**不许**留下焦点环、键盘 Tab **仍要**看得见环、选中态恒为唯一、hover 不改变选中、焦点不等于选中、收起面板不再渲染步骤项。
- 新增 `tests/clear-card.test.mjs`（20 项）：确认框返回 false / 缺失 / 抛错时**一个字都不许动**（也**不写盘**）；确认后字符字段、数组字段、Lorebook 条目、五维世界观全空而空卡骨架（`spec` / `character_book` / `assets`）完整；`currentLibraryId` 归零；清空后确实调用了 `cc_setDraft`。全仓 `npm test` 292 → **335** 项全绿。
- 另在真实浏览器里用 Playwright + 迷你 React 渲染同一份 `lib/client.js` 做了对照实验（复刻上面两次点击）：同坐标、同点击，**旧写法**（无 `outline` 管理、无 `mousedown` 拦截）按钮点击后 `outlineStyle: solid / 2px / rgb(124,92,255)`（正是那圈描边）、`document.activeElement` 就是该按钮；**新写法**点击后 `document.activeElement` 仍是 `BODY`、`outlineStyle: none`，列表里只剩一处品牌紫选中。
- UI 重构也在真实浏览器里量过（1400×900 加载真实 `lib/client.js`）：`gridTemplateColumns` 实测 `200px 876px 268px`（右侧 360px 那一栏已消失）、主区底部 3 个折叠区默认 `aria-expanded="false"`、`field-sizing: content` 确实生效（同一字段的 textarea 高度随内容 37 → 61px 自适应）、点开「实时 CCv3 预览」后 `<pre>` 才被渲染。
- 生效方式：**纯客户端**改动 —— 重启 `dsh web` 后刷新页面即可（桌面端重启应用；profile 里若装的是 npm 包，需先换成指向本仓库的 link 或升级到本版本）。宿主半无改动，不必为它单独重启。

## 0.3.8

**DSH STORE 上架契约补齐**（对应 [DSH-Store issue #1173](https://github.com/AI-Scarlett/DSH-Store/issues/1173)）：把 manifest 里「能被自动判定」的门禁全部补齐，并把权限边界写进 README —— 但**这个 issue 光靠改仓库修不完**，另有两件事只能由 STORE 侧或真机实测解决，见本文末尾「还没解决的」。

### 一、现象

DSH STORE 的八小时复检把本插件标成 `Catalog blocked / external-only`，并且条目一直停在 **0.3.0**（包名还是 `@dsh-plugins/dsh-cc-studio`）。issue 里列出的确定性原因是 6 条：

1. `manifest repository does not match the canonical GitHub repository`
2. `DSH compatibility is not explicitly declared`
3. `Node.js compatibility is not explicitly declared`
4. `runtime or optional dependencies require a separate supply-chain review`
5. `runtime source contains the files permission signal`
6. `runtime source contains the credentials permission signal`

### 二、根因（两层，别只修一层）

**第一层：manifest 缺声明。** 第 1 条是 0.3.0 时 package.json **根本没有 `repository` 字段**（0.3.2 起已有，且 `git+https://…git` 会被 STORE 的 `canonicalGithubRepository` 规范化成 `https://github.com/xia-sc/dsh-cc-studio`，这条其实早已满足）；第 2、3 条是本仓库一直没写 `dsh.compatibility` 与 `engines.node`；第 4 条来自 `dependencies` 里那个**从 0.3.0 起就没被任何代码 import 过**的 `@deepseek-ai/cordis`。

**第二层（真正卡死的地方）：STORE 条目身份过期。** Catalog 条目的 `packageName` 是 0.3.0 时的旧名 `@dsh-plugins/dsh-cc-studio`，而仓库在 0.3.2 已改名为 `@xia-sc/dsh-cc-studio`。STORE 的 `assessUpstreamVersion` 第一步就是 `manifest.name !== entry.packageName → update-blocked`（理由 `the upstream package name no longer matches the Catalog identity`），于是**复检根本读不到 0.3.x 的 manifest**，条目被永久钉在 0.3.0 的 commit 上，status/`updatePolicy` 也一起冻结在 `blocked` / `external-only`。也就是说：不解决身份，后面补多少声明都不会被读到。

**第 5、6 条不是缺陷，是本插件的功能本身。** STORE 的自动低风险通道（`source-verified`）要求运行时代码完全不出现文件、网络、命令、凭据四类信号；而本插件核心功能就是角色卡/草稿落盘（`node:fs` → 文件信号），并且要读 `DSH_HOME`（扫描器把任何 `process.env` 读取都判为凭据信号）。**结论：自动通过永远不可能拿到，也不该为此改运行时代码** —— 对这类合法插件，商城的正确档位是 `user-reviewed`（展示变更、由用户逐次确认安装）。

### 三、修法（本版做了什么）

| 改动 | 位置 |
| --- | --- |
| 声明 Node 兼容 | `package.json` 的 `engines.node: ">=22"` |
| 声明 DSH 兼容范围 + 逐版本精确证据 | `package.json` 的 `dsh.compatibility`：`dsh: ">=0.1.5-rc.1"`；`dshReleases` 只写**实测过**的 `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.6-alpha.1` / `0.1.6-alpha.2` / `0.1.7-alpha.1` / `0.1.7-rc.1` = `compatible`（未测的 `0.1.7-alpha.2` / `0.1.7-rc.2` / `0.2.x` 一律不写，商城如实显示未知） |
| 去掉零使用的运行依赖 | 删除 `dependencies` 的 `@deepseek-ai/cordis`（全仓 `grep` 只命中 package.json 自身） |
| 权限与兼容披露 | `README.md` / `README_EN.md` 新增「兼容与权限」节：文件、网络、命令、凭据四类权限逐条写明，并解释为什么商城不会给它 `source-verified` |
| 把契约钉进测试 | `tests/preset-install.test.mjs` 新增 11 项守卫：repository 规范化后等于 canonical 仓库、`engines.node` 存在、`dshReleases` 键是完整 SemVer、值域三态、至少一条 `compatible`、无运行/可选依赖、无 `preinstall`/`install`/`postinstall`/`prepare`、`files` 非空、两半只 import `node:` 与相对路径、README 保留披露节 |

### 四、dsh `0.2.0-rc.2` 兼容性审计（本版做完，结论：**无需适配**）

背景：商城当前 latest-three 窗口是 `0.2.0-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.1`，而此前只实测到 `0.1.7-rc.1` —— 窗口内没有精确 `compatible`，条目会被判「兼容性暂缓下架」。所以对 **`0.2.0-rc.2`**（npm 上的 `latest`）做了完整实测。

| 面 | 结论 | 证据（全部在 0.2.0-rc.2 上实测，不是推断） |
| --- | --- | --- |
| 宿主行 / 预设行组合 | 兼容 | `dsh --profile <p> --dump-config`：`# == @xia-sc/dsh-cc-studio` 层下 `- id: dsh-cc-studio` 与 `- id: preset-cc` 都在；`preset-cc` 子树 **34 行与仓库 `presets/cc.patch.yml` 逐行零差异** |
| 宿主半 RPC 路由 | 兼容 | 活宿主与隔离宿主各一遍：不带 cookie 打 `POST /dsh-cc-studio-rpc/ping` → **401 unauthorized**、随机路径 → **405**（证明路由注册且围栏是插件自己调的）；用启动 token 换 cookie 后 → `200` + `{"type":"server-response","result":{"ok":true,…}}`；未知端点 → **200 + `details.code="unknown-endpoint"`** |
| 会话槽 key 不变量 | 兼容 | 显式 `sessionId` → `keySource:"arg"`、`key=audit-session`；信封的 `payload` 只认 `payload.args`（`lib/index.js:854`），与旧版行为一致 |
| 容器互通 | 兼容 | `cc_setDraft` → `cc_exportPng`（`89504e47…` PNG 头 + `tEXt` `ccv3` 块，1252 B；改名后 1300 B）→ `cc_importFromPng`：名称/描述**逐字一致**；`cc_exportCharx`（`504b0304…` ZIP）→ `cc_importFromCharx` 同样逐字一致；`cc_saveToLibrary` / `cc_listLibrary` 正常 |
| 预设 roster | 兼容 | `POST /api/agentPresets/list` → `standard, ptc, minimal, cordis, cc`（`cc` 带 `name`/`description`、`order:50`）；`POST /api/pluginInventory/list` → `cc` 的 `broken` 为空，30 行里 24 行 `fiberPhase: "active"`，其余 6 行是两代都不参与解析的 `disabled` 行（`tool-bash` / `skill-filesystem` / `tool-skill` / `tool-plugin-manager` / `tool-subagent-codex` / `tool-subagent-claude-code`）；`cc-agent` 为 `enabled:true, active`，`command-goal` 为 `active` |
| 客户端半 | 兼容 | 运行中的 0.2.0-rc.2 宿主上用 Client Inspect 读活页面：`conversation.input.dock` / `shell.overlay` / `settings.section` 三个 occupant 全部 `active: true` 且 registrant 为 `dsh-cc-studio`；隔离宿主首页的合批资源 `/plugins/??…,@xia-sc/dsh-cc-studio/client.js…&rev=…` → **200**（11.0 MB，含 `__ModuleLoader__` 与本包 id） |
| 隔离有效性 | 通过 | 隔离 `DSH_HOME` + `HOME` + `USERPROFILE`：本次产生的草稿（`audit-session` / `audit-png-read` / `audit-charx-read`）与角色卡全部落在隔离根；真实 `~/.dsh/cc-drafts` 最新文件仍是审计前的 09-11 |

因此 `"0.2.0-rc.2": "compatible"` 已写进 `dsh.compatibility.dshReleases`。`0.2.0-rc.1` / `0.2.1-alpha.1` **没测，仍不声明** —— 同一个窗口不代表同一个结论，不许用推断代替实测。

**静态侧交叉验证（与上面实测相互独立）**：`dsh-host-webserver` 与 `dsh-client-connection` 的 `lib/index.js` / `lib/client.js` 在 `0.1.7-rc.1` 与 `0.2.0-rc.2` 之间**逐字节相同**（整个包只有 `package.json` 与 `README.i18n.yaml` 变）；`dsh-tools` 的 `lib/index.js` 只差 2 处（`:935` 描述文案、`:3459` 新增可选 `ask.displayReason`），`tools.register` 仍在原处、仍只对 `output.schema` 做子集断言（JSON-Schema 子集实现文件两版哈希相同）；`dsh-web-app/presets/standard.patch.yml` **逐字节相同**，所以内置 `standard` 在 0.2.0-rc.2 上仍是那 32 个插件行 —— 活宿主实测也印证：`cc` 的插件行 = standard 的 32 行 + `cc-agent`，零缺失零多余；`dsh-agent-preset-registry` 唯一的对外收缩是删掉 `modeSelectionEnabled`（本插件不读、shipped 组合也没配这个键）；预设注册表仍不 import `fs`，`.agent-presets/` 仍无任何读者。

### 五、还没解决的（需要 STORE 侧）

1. **旧条目身份迁移**：必须把 Catalog 条目 `dsh-cc-studio` 的 `packageName` 从 `@dsh-plugins/dsh-cc-studio` 改成 `@xia-sc/dsh-cc-studio`（并重新固定 Commit）。**不能靠重新提交插件绕过**：新包名会算出一个新条目，但 `entryIds: ["dsh-cc-studio"]` 与旧条目冲突，预检直接以 `SUBMISSION_ENTRY_COLLISION` 失败。
2. **档位**：因为第 5、6 条权限信号，商城只应按 `user-reviewed` 收录（人工审查 + 用户逐次确认），不应期待 `approved/source-verified`。

### 六、生效方式

本版的全部改动都在清单与文档（`package.json` / README / CHANGELOG / AGENTS.md / 测试），**运行时代码一行未动** —— 所以 0.2.0-rc.2 上跑的就是本次审计验证过的同一份代码，**不需要**重启 `dsh web`、也不需要刷新页面；`npm test`（6 个文件、292 项断言）全绿即可。要让商城看到新 Commit 需发布新版本（打 `v0.3.8` tag 走 CI）；但在上一条身份迁移完成前，STORE 的复检仍会因包名不匹配而读不到它。

## 0.3.7

**dsh `0.1.7-rc.1` 兼容性审计**：结论是**接口面无一处需要适配**——真正的修复只有一处**预设漏抄**（`command-goal`，自始就缺、与 rc.1 无关），外加 3 处会误导下次升级的**文档口径失准**与 1 处**未被测试钉住的隐性耦合**。

### 审计范围与结论（怎么验的）

两条独立证据链都指向「兼容」，没有一个「不兼容」项：

| 面 | 结论 | 关键证据 |
| --- | --- | --- |
| 宿主半（RPC 路由 + 线协议 + `inject` 四服务） | 兼容 | 隔离宿主实测：不带 cookie 打 `/dsh-cc-studio-rpc/ping` 得 **401**，而同机随机路径是 **405**（证明路由确实注册、围栏是插件自己调的）；带 cookie 后 `ping` 回 `{"type":"server-response",…}`，未知端点回 **200 + `details.code="unknown-endpoint"`**；`webServer.register` 的 `{kind:"prefix",path,handler}` 契约未变 |
| 预设半（14 个 Tool 的注册契约） | 兼容 | `tools.register` 仍要求 `output`、仍**不对 `parameters` 做 JSON-Schema 子集校验**（`minItems`/`maxItems` 不抛）；`exec.agent.session.id` 链路成立 |
| 草稿槽 key 不变量 | 兼容 | 显式 `sessionId` → `keySource:"arg"`；缺会话 id → `key` 回落 `default` 且 `keySource:"fallback"` |
| 落盘根 | 兼容 | 隔离 `DSH_HOME` 下 `cc-drafts/`、`cc-library/` 正常落盘；**未**创建 `.agent-presets/`（`status:"native"` 确实让位） |
| 容器互通 | 兼容 | PNG（`tEXt` `ccv3` 块）与 CHARX（ZIP + `card.json`）导出→导入往返，名称与 description 逐字一致 |
| 预设投递 | 兼容 | rc.1 仍是 `dsh-agent-preset` + `dsh-agent-preset-registry`（`register` + `compositionInventory` 都在），全树 grep 无任何 `.agent-presets` / `discoverPresets` 读者 |
| 预设 roster | 兼容 | 活宿主 5 条含 `{"id":"cc","name":"CC 模式","order":50}`，`broken` 为空，29 行里 `cc-agent` 为 `fiberPhase: active` |
| 客户端半（三个挂载点 + 9 项契约） | 兼容 | 活页面 Client Inspect：`conversation.input.dock` / `shell.overlay` / `settings.section` 三个 occupant 全部 `active: true` 且 registrant 为 `dsh-cc-studio`；`SessionListState` 仍然没有 `current`；`projectionValues.agentPreset` 仍是官方自己的读法 |

实测环境：隔离 profile + 隔离 `DSH_HOME`/`HOME`/`USERPROFILE`（端口 3099），**真实 `~/.dsh` 全程零变化**（`cc-drafts` / `cc-library` / `.agent-presets` 逐文件哈希比对一致）。

### 一、`command-goal` 一行漏抄（唯一的功能性修复）

**现象**：CC 模式会话里没有 `/goal` 斜杠命令。不报错、预设**不判 broken**、胶囊与工坊全都正常 —— 就是少了一个人用的命令。

**根因**：本预设的 `plugins` 是内置 `standard` 的副本，但初次拷贝时就漏了这一行，而它**在 `0.1.6-alpha.2` 的 standard 里本来就有**（`dsh-agent-presets/presets/standard/agent.cordis.yml:95`，位置在 `tool-skill` 之后、`tool-goal` 之前，与 `0.1.7-rc.1` 完全一致）。`git log -S 'command-goal' -- presets/ lib/` 全历史**零命中**，所以它是**自始漏抄**，与 rc.1 无关 —— 和 0.3.4 补回的 `present` 行、`modelSelectionSettings: true` 是同一类「静默少能力」。

**修法**：两份载体同步补该行（`presets/cc.patch.yml` 的声明层 + `presets/cc/agent.cordis.yml` 的目录形态）。`tests/preset-install.test.mjs` 第 12 节新增两道守卫：**行集快照**（33 行，漏抄/多抄一整行都红）+ `command-goal` 的包名断言。快照是刻意的：它把 AGENTS.md §4 第 4 步「与目标版本内置 `standard` 逐行对一遍」变成机械可检的，而不是等用户发现少了功能。

**注意**：文件里那段照抄自 `standard` 的注释写着「the `/goal` command stay on the host plane」，指的是命令背后的 goal **SERVICE**（以及 Gateway 的 Remote 接收方）；`standard` 自己是在预设里带这一行的，别据此再把它删掉。

**生效方式**：改的是预设层，**重启 `dsh web`** 即可（≥ `0.1.7` 上没有任何安装步骤；≤ `0.1.6` 需删掉 `<DSH_HOME>/.agent-presets/cc` 后重启，或配 `presetInstall: force`）。客户端半未改，无需硬刷新。

### 二、3 处文档口径失准 + 1 处资源地址描述（都不影响运行）

审计中实测推翻了写在 AGENTS.md 与代码注释里的三条断言，已一并更正（`AGENTS.md` §2.3 / §4 / §6 / §7 / §8 + `lib/index.js` 的读体注释）：

1. **「异步迭代 `IncomingMessage` 在这个运行时会抛错」——不成立**。`0.1.7-rc.1` + Node v26.9.0 下 `for await (const chunk of req)` 正常返回；而且官方 `/api` 桥**自己就在用它**（`dsh-client-connection/lib/index.js:58`）。插件继续走 `data/end/error` 事件式（`readBoundedBody`，无收益不动），但这条不再是「必须」的理由。
2. **「`/api/agentPresets/list` 会剥掉 `name`/`broken`」——不成立**。该 Remote 的线 schema 带 `name` / `description` / `broken` 三个**可选**字段（`dsh-agent-preset-registry/lib/typert.remote-client.js:5-14`）；内置四个预设看不到 `name`，是因为它们的声明行本来就没写 `name`（本插件的 `cc` 写了，实测正常返回「CC 模式」）。要看**逐行** `fiberPhase` 才必须用 `pluginInventory/list`。
3. **channel / endpoint 的命名正则不属于 `webServer.register`**。那两个正则属于 `dsh-client-connection`（客户端 `assertTarget` 与 `HostConnectionService.register`）；`webServer.register` 只做重复检测（`dsh-host-webserver/lib/index.js:177-184`），什么 path 都收。
4. 附带更正：客户端资源的真实地址通常是**多个包合批**的一条 `plugins/??a/client.js,b/client.js&rev=<批次哈希>`（rc.1 活页面上本插件就在这样一条 5.5MB 的 `link` 里），`rev` 是**批次**的哈希 —— 只截本包那一段再配别的批次 rev 会 404。

**生效方式**：纯文档与注释，不影响行为（无需重启或刷新）。

### 三、隐性耦合补上跨文件守卫

**风险**：DOM 兜底探测（`ccModeFromDom`）靠「芯片 `textContent` 含 `t("preset.ccLabel")`」认预设芯片，因此这个词**必须逐字等于**宿主预设的显示名（`presets/cc/preset.yml` 的 `name`，也就是 roster 芯片上渲染的那串字）。既有测试只钉了「`preset.ccLabel` 在 zh 与 en 两表里都是 `CC 模式`」——**把 en 本地化成 `CC Mode` 依然全绿**，而英文界面下这条兜底会静默失效。

**修法**：`tests/cc-detection.test.mjs` 新增跨文件守卫：`client.js` 里 zh/en 的 `preset.ccLabel` 必须等于 `presets/cc/preset.yml` 的 `name`。

**生效方式**：仅测试。

### 四、CC 模式预设的介绍文案精简（roster 下拉）

**现象**：会话模式下拉里「CC 模式」那一项，介绍写成「LLM 通过 6 个 Tool 引导填表（`cc_get_card` / `cc_patch_character` / …）」，把模型侧的 6 个工具名全列在用户界面上 —— 下拉项被撑满、对用户没有信息量（工具名只对读 persona 的模型有意义）。

**修法**：`presets/cc/preset.yml` 与 `presets/cc.patch.yml` 的 `description` 同步改为
`CCv3 角色卡工坊 — 用对话把点子补成完整的角色卡（chara_card_v3）：模型先问再填，胶囊实时同步，工坊全屏编辑，导出 JSON / PNG / CHARX。`
模型侧的强制工作流仍原样写在 persona 里（`1) cc_get_card … 6) cc_validate`），一个字没动；声明层加了一行注释说明「这里别再塞 Tool 清单」。`tests/preset-install.test.mjs` 既有的「描述与目录模板 `preset.yml` 逐字一致」守卫继续生效，改一边就会红。

**生效方式**：改的是预设层，**重启 `dsh web`**（≥ `0.1.7` 无安装步骤）后下拉里即为新文案。

### 测试

278 → **281** 项（`45 + 68 + 51 + 62 + 18 + 37`），6 个文件全绿。两个新守卫都做过**变异测试**：把 en 的 `ccLabel` 改成 `CC Mode` → 跨文件守卫红；把两份载体的 `command-goal` 一起删掉 → 防漂移守卫仍绿、**只有行集快照红**（说明它能精确定位到这类漏抄）。

---

## 0.3.6

**适配 dsh `0.1.7-alpha.1`：修「`CC 模式` 预设从 roster 里消失」**。那一版起 dsh 的预设机制换代了 —— 预设不再是「用户目录里的一份 YAML」，而是**组合里的一个声明行**；`<DSH_HOME>/.agent-presets/` 已经没有任何代码读取。顺带修掉**草稿与角色库不认 `DSH_HOME`** 的老问题（同一次兼容性审计里实测踩到，见本版第二节）。

### 现象

- 升级 dsh 到 `0.1.7-alpha.1` 后，会话模式里**只剩** `standard` / `ptc` / `minimal` / `cordis` 四个内置预设，`CC 模式` 不见了 —— 不是「加载失败」，是压根不在 roster 里。
- 迷惑点：`<DSH_HOME>/.agent-presets/cc/` 里 `preset.yml` + `agent.cordis.yml` + 安装记录**三件都在、内容还是最新模板**；插件两半也都正常（RPC 路由在、胶囊挂载点在），偏偏预设没了。

### 根因

dsh `0.1.7-alpha.1` 把预设发现整套换掉，旧机制**整体下线**：

| | ≤ `0.1.6-alpha.2` | `0.1.7-alpha.1` |
| --- | --- | --- |
| 预设载体 | 目录 `<DSH_HOME>/.agent-presets/<id>/`（`preset.yml` + `agent.cordis.yml`） | 组合里的 `@deepseek-ai/dsh-agent-preset` 声明行（`config: {id, name, description, order, plugins}`） |
| 谁提供 | `@deepseek-ai/dsh-agent-presets`（**复数**，npm 上停更于 `0.1.6-alpha.2`） | `@deepseek-ai/dsh-agent-preset`（**单数**，npm 上只有 `0.1.7-alpha.1` 一个版本）+ `@deepseek-ai/dsh-agent-preset-registry` |
| 怎么发现 | 扫三个根：shipped 根 + 部署 `config.roots` + 用户根 | 没有文件系统扫描这回事，只有 `register()`（新注册表连 `fs` 都不 import） |

于是在 0.1.7 上，`installCcPreset` 那套「挂载时把模板写进用户根」写出来的文件**没有任何读者**：目录在、文件新、没人看。这也解释了为什么现象既不是报错也不是 broken，而是干净利落地消失。

### 修法

- **随包带一层预设声明补丁 `presets/cc.patch.yml`**，与内置 `standard` 的投递方式完全同构（见 `@deepseek-ai/dsh-web-app` 的 `presets/*.patch.yml`）：`package.json` 的 `dsh.bundle.patch` 由一层变两层 —— 第 1 层 `cordis.patch.yml`（宿主插件行），第 2 层本文件（`preset-cc` 声明：`id: cc`、`order: 50`、`plugins` 就是原来那 32 行清单，含全部解释性注释）。插件装进哪个 profile，`CC 模式` 就出现在哪个 profile 的 roster 里；**新版上插件不再往磁盘写一个字**。
  - 关掉 CC 模式也不用卸载插件：在自己 profile 的补丁层（`<profile>/cordis.patch.yml` 或 `$DSH_HOME/cordis.patch.yml`）里按 id 关掉 `preset-cc` 即可，`presets/cc.patch.yml` 顶部有现成写法。
- **目录安装只为 ≤ `0.1.6-alpha.2` 保留，并在新版上自动让位**：新增 `supportsDeclaredPresets(ctx)`（要求 `agentPresets` 上同时存在 `register` 与 `compositionInventory` 这两个 0.1.7 才引入的方法），命中就 `status: "native"` 直接返回、不再写那个死目录；旧版留下的目录**保留原样**（卸载本来也不删），只记一条日志说「可以安全删除」。检测**判窄不判宽**的理由是不对称：误判 false（老版上）只是白写一次目录，误判 true（新版上漏判）才会真的少一个预设。
- **两份清单不许漂移**：`presets/cc/agent.cordis.yml`（旧版目录形态）与 `presets/cc.patch.yml`（新版声明行）是同一份清单的两个载体，测试按「除注释外逐字一致」钉死（去掉注释与空行后 141 行完全相同，只允许声明层整体多 10 空格缩进），改一边不改另一边 = 两代 dsh 行为分叉。
- **预设有意保留的行差照旧**（本次一行未动）：`+ cc-agent`、`− command-goal`（0.1.7 里那条 host 行仍是 `disabled: true`）、skills 两行 `disabled`、`tool-ralph` 打开、`tool-web` 的 `fetch: false`，以及我们自己的 CC persona（`prefix`，0.1.7 的 `standard` 刚好也去掉了 `suffix`，两代的行名集合完全相同）。

### 测试

`npm test` 216 → **241** 项（`45 + 66 + 50 + 62 + 18`），全绿。`tests/preset-install.test.mjs` 41 → 66，新增两节：

- 第 11 节：`supportsDeclaredPresets` 五种入参（无 ctx / 无 `get` / `get` 抛错 / 老服务只有 `discoverPresets` / 新注册表）；新版 → `status: "native"` 且**不创建** `.agent-presets`；老版 → 仍走目录安装且文件落盘；`presetInstall: "off"` 依旧最优先。
- 第 12 节：声明层结构守卫（`preset-cc`、`id: cc`、显示名与描述与 `preset.yml` 逐字一致、每个 `- id` 都有 `name`、平台条件行仍是未求值的 `!!js`、三个 `isolate` 组都在、`cc-agent` 仍挂在本预设下），`package.json` 的两层补丁都指向真实存在的文件，以及上面那条**两份清单逐字一致**的防漂移守卫。

### 生效方式

- **改的是宿主组合（补丁层 + `package.json`），必须重启 `dsh web`**（组合树只在 boot 时读一次）；客户端半未改，无需硬刷新。重启后新开的会话即可选到 `CC 模式`。
- **本机实测（dsh `0.1.7-alpha.1`，隔离 profile + 隔离 `DSH_HOME`，端口 3099 —— 真实 `~/.dsh` 与 3080 上的会话全程未碰）**：
  - 静态：`dsh --profile <profile> --dump-config` 的 `# == @xia-sc/dsh-cc-studio` 层里带上 `- id: preset-cc`（`name: '@deepseek-ai/dsh-agent-preset'`、`id: cc`、`plugins` 32 行齐全）。
  - 活宿主：`POST /api/agentPresets/list` 返回 5 条预设，其中 `{"id":"cc","name":"CC 模式","order":50,"isDefault":false}`；`POST /api/pluginInventory/list` 里 `id=cc name=CC 模式 broken=<空> rows=29`，`cc-agent`（`@xia-sc/dsh-cc-studio/agent`）`enabled=true fiberPhase="active"` —— 29 行里非 active 的 6 行全是预设里**有意 `disabled`** 的（`tool-bash` 的 win32 条件、skills 两行、`tool-plugin-manager`、codex / claude-code 两个可选 provider）。
  - 修复前同一环境（旧工作树、同一 profile、同一端点）只返回 4 条（standard/ptc/minimal/cordis），`cc` 连条目都没有 —— 是「缺席」而不是 broken，与上面的根因完全吻合。
  - 修复后的 boot **没有重写** `<DSH_HOME>/.agent-presets/cc`（三个文件的 mtime 与 marker 里的 `version: 0.3.5` 都停在修复前那次），说明 `status: "native"` 那条分支确实生效。
- 旧目录（如本机 `~/.dsh/.agent-presets/cc/`）从此可以删了：0.1.7 起没有任何代码读它，插件也不会代删。
- 诊断口径（0.3.6 实测）：`/api/agentPresets/list` 的远程返回会剥掉 `name` 与 `broken`，要看完整台账用 `/api/pluginInventory/list`；另外插件的 `info` 日志只进 Cordis logger（默认不落 `dsh web` 的 stdout），**别用 grep `[dsh-cc-studio]` 判断装没装上**。

---

### 0.3.6（第二节）草稿与角色库的落盘根：`DSH_HOME` 优先 + 读时回退 `~/.dsh`

### 现象（0.3.6 兼容性审计时实测）

- 插件其实有**两套落盘根**：预设目录走 `DSH_HOME`，而草稿与角色库写死 `homedir()/.dsh`（`draftDir()` / `libDir()`），文档里却一直写成 `<DSH_HOME>/cc-drafts/`。
- 后果一：自定义了 `DSH_HOME` 的用户，预设装在新根、草稿与角色卡却留在旧根 —— 两边都「正常」，就是不在一个地方。
- 后果二：按 AGENTS.md §6 的推荐做法做隔离实测（**只**设 `DSH_HOME`）时，只要在那个隔离宿主上建一个 CC 会话，草稿就落进**真实的** `~/.dsh/cc-drafts/`。审计当天确实写进去了一份，按内容确认是探针产物后手工删除；真实 `~/.dsh/cc-library/` 全程未被触碰。

### 修法

- 新增 `dataRoots(sub)`：返回 `[主根, 旧根]` —— 主根 = `DSH_HOME`（优先，`trim` 后非空）或 `homedir()/.dsh`，旧根 = `homedir()/.dsh`；两者路径相同时**去重成一条**。**写盘只写主根，读盘依次回退**。宿主半（`lib/index.js`）与预设半（`lib/agent.js`）各一份、逐字同构：两边必须算出同一个路径，否则又会退化成 issue #5 那种「模型写一处、工坊读另一处」。
- **草稿**：`persistDraftSync` 写主根；`loadPersistedDraftSync` 改走新的 `findDraftPath()`（主根没有就回退旧根）；`listDraftSlotsOnDisk()` 扫两个根并按文件名去重（主根那份解析失败时才让旧根补位）。
- **角色库**：`saveLibraryEntry` 写主根（读旧根那份只为继承 `createdAt` / 旧 name）；`loadLibraryEntry` 回退读；`listLibraryEntries` 并集去重（主根优先）；**`deleteLibraryEntry` 把两个根的同名副本都删**（否则回退读会把刚删的卡「复活」），一个都没删到时仍按原语义报错；`renameLibraryEntry` 就地写在解析到的那一份上，不搬家、不复制。
- `DSH_HOME` **未设置时两个根是同一个目录**，候选去重成一条 —— 默认安装（绝大多数用户）行为与 0.3.5 **逐字节相同**，只是现在也认 `DSH_HOME` 了。

### 测试

`npm test` 241 → **278** 项（`45 + 66 + 50 + 62 + 18 + 37`），全绿。新增第 6 个测试文件 `tests/data-root.test.mjs`（37 项，隔离 `HOME` / `USERPROFILE` / `DSH_HOME`）：

- 根解析：`DSH_HOME` 优先、候选顺序、`trim`、全空白视为未设置、恰好等于旧根时去重；**未设置时等于 `homedir()/.dsh/cc-*`**（老用户路径零变化）。
- 两半一致：`safeDraftFile` 对同一个 key 输出同一个文件名、两个根逐字相同。
- 草稿：写主根不碰旧根、主根缺时回退读、两处都有时主根优先、`listDraftSlotsOnDisk` 并集去重。
- 角色库：写主根、回退读、并集去重、删除两个根都删、删不存在的 id 仍报错、改名就地写。
- 源码守卫：`lib/index.js` 与 `lib/agent.js` 里不再有写死的 `homedir()/.dsh/cc-*`，两半都从 `dataRoots()` 派生。

### 生效方式

- 宿主半与预设半都改了 → **重启 `dsh web`**；客户端半未改，无需刷新。
- 自定义 `DSH_HOME` 的用户：新写入落在 `<DSH_HOME>`，旧的 `~/.dsh` 数据**照样读得到**（回退）；第一次保存某张卡会把新副本写进新根，旧副本保留，删除该 id 时两个根一起删。
- 默认用户（没设 `DSH_HOME`）：路径与以前完全一致，什么都不用做，也不需要搬文件。

## 0.3.5

**修 #5 草稿槽错位（前端读到 default、Tools 写会话槽）**：已落盘的会话草稿在工坊里显示成空壳、胶囊跟着一闪一闪。数据其实一直在盘上，只是**两边算出了两把 key**。

### 现象（issue #5）

- 同一条对话里，模型经 `cc_get_card` 读到的草稿是满的（`name` 有值、四件套齐全、`draftStatus.key = session-<会话id>`），`~/.dsh/cc-drafts/` 里对应的文件也在；**但工坊画出来的是另一份**：`name: ""`、`entries: []`、`creation_date` 更早，还挂着「当前会话是全新空白草稿」的提示。
- 胶囊点不出来/点了是空的：选中 CC 模式后胶囊**短暂出现又消失**（不是点了 ×，也不是一直不出现），刷新页面可复现。
- 用户的第一反应只能是「草稿丢了」。

### 根因（三个，都在客户端半；宿主半只是被动接受了一把错的 key）

1. **会话 id 读的是不存在的字段**。`useCcPreset` 用 `useSessions(s => s.current)` 当「当前会话」，而 dsh `0.1.6-alpha.2` 的 `SessionListState` 只有 `ids` / `byId` / `phase`（`dsh-api-session-controller` 的 `sessions/service.d.ts`）——**没有 `current`**，所以它恒为 `null`：「会话投影 = 权威」这条路径从来没生效过，`currentId` 一路退化成 `props.session`（整个 `SessionSnapshot` 对象）。
2. **那把错的 key 就是这么来的**。`apply()` 里先 `pullDraftThrottled(null)` 占了 500ms 的全局节流坑，会话就绪后 `_pullDraft(currentId)` 的第一次正式拉取被直接吞掉 → `store.currentSessionId` 永远是 `null` → 4s 轮询每次都拿 `null` 去拉。主机侧 `draftKeyFrom` 在 HTTP 处理函数里 `agents.currentInitiator()` 恒为空（没有 agent 上下文），于是回退成 `default`；就算 `currentId` 是那个 `SessionSnapshot` 对象，`typeof args.sessionId !== "string"` 也会把它当「没传」丢掉。**结果：模型写 `session-<id>`、工坊读 `default`，两槽并存互相看不见。**
3. **胶囊闪退是两个 `useCcPreset` 实例抢同一个 store**。`Capsule`（`conversation.input.dock`，session 域，能拿到会话 id）与 `Workshop`（`shell.overlay`，**根域，拿不到会话 id 也看不到预设芯片** —— 运行中会话的预设标签渲染成 `<span>`）共用一份 `store`。根域实例的 1s DOM 轮询每次 `evaluate()`，旧 `decideCcMode` 在 `!hasSession` 时返回 `false`，把会话域实例刚判定为 `true` 的 `isCcMode` 清掉 → 胶囊卸载，下一次会话域实例再装回来 = 一闪一闪。

### 修法

- **会话 id 只有一个取法**：新增 `ccSessionIdOfProps(props)`，按 `props.sessionId`（session 域标准属性）→ `props.session.sessionId`（`conversation.input.dock` 的 ownerProps `SessionSnapshot`）→ `props.sessionId` 是对象时读它的 `.sessionId` 依次取；**不再读 `useSessions().current`**。取到就 `store.setSessionId()` 发布出去 —— 这是全局唯一一份「当前会话 → 草稿槽」的映射，根域实例与草稿轮询都读它。会话投影也改用这个 id 去 `byId` 里查（旧代码用不存在的 `s.current` 当下标）。
- **拉草稿必须带 key**：没有会话 id 就一次都不发（`pullDraft` 里 `if(!key) return`），并删掉启动时那次 `pullDraftThrottled(null)`；节流从「全局时间戳」改成**按 key**，会话就绪后的第一次正式拉取不会再被吞掉；轮询在 `currentSessionId` 未知时直接 return，不拿 `default` 顶替。**宁可什么都不画，也不画错槽。**
- **错位可见、可救回**：`cc_getDraft` 回传 `keySource`（`arg` / `arg-snapshot` / `initiator` / `fallback`）；前端把主机回的 `key` 与点名的 key 比对，不一致时**不渲染**该草稿，只在胶囊/工坊上打一条告警（另外切会话期间回来的过期响应也一并丢弃）。新增 `cc_migrateDraft` 端点与 `draftContentSummary` / `migrateDraftDecision` 纯决策函数：当前槽是空壳时，主机顺带回传 `alternateSlots`（**只在「错位真正会牵涉到的另一把槽」里找**：当前是会话槽就看 `default`，当前是 `default` 就看各会话槽；其它会话的槽不参与，免得每开一个新会话都弹横幅），工坊上给一个「迁入本会话槽」的按钮，**不静默覆盖**非空目标（要 `overwrite: true`），迁过一次就不再重复提示。
- **胶囊不再被暂态判定卸载**：`decideCcMode` 的 `!hasSession` 分支改为「只保持、不下否的结论」（`prevIsCc ? true : false`），并且根域实例（`!ownId && !currentId`）**只允许把结论改成「是」**，写 `false` 的权限留给真正有会话上下文的实例或 RPC。

### 测试

`npm test` 158 → **216** 项（`45 + 41 + 50 + 62 + 18`，多了第 5 个测试文件），全绿。新增/加强：

- **新增 `tests/draft-slot-sync.test.mjs`（18 项，行为级而非源码级）**：把 `lib/client.js` 真的装进「假 React + 假 slot + 假 RPC」的 harness 里跑起来，直接断言「发了哪些请求、渲染了什么状态」。对着 0.3.4 的 `lib/client.js` 跑，18 项里前 10 项全红，失败详情正是 issue #5 的原样复现：`cc_getDraft` 带 `{"args":{}}`（回退 `default` 槽）、根域实例把 `isCcMode` 写成 `false`（胶囊闪退）、`store.currentSessionId` 恒为 `null`、主机明明回了满草稿而 store 里 `name` 仍是空。断言覆盖：启动后一次 keyless 拉取都不许发、根域实例（无会话上下文）不得把 CC 状态清成 false、会话域实例从 `props.sessionId` 取 key 并发布到 store、主机回的 `key` 不一致时**不渲染只告警**、空壳会话槽的候选只含 `default`、一键迁入的请求体、迁过一次就不再提示（`localStorage` 标记）、切会话后回来的过期响应被丢弃。
- `tests/rpc-channel.test.mjs`（23 → 45）：`draftKeyPartsFrom` 四条路径（字符串 / 会话快照对象 / 无 id 回退 `default` 且 `source` 可见 / initiator）、端到端「同 `sessionId` 写读同槽、不带 `sessionId` 是另一把槽」、空壳槽的候选只含 `default`、别的会话的槽不出现在候选里、`cc_migrateDraft` 四种结果（成功 / `target-not-empty` / `empty-source` / `same-slot`），以及 `migrateDraftDecision` + `draftContentSummary` 的纯函数边界（空壳源、只有 lore 没 name、深拷贝）。
- `tests/cc-detection.test.mjs`（32 → 50）：判定表新增「无会话 + 芯片非 CC + 上次是 CC → 保持 true」（这条旧断言编码的正是闪退行为，已改写并注明原因）、`ccSessionIdOfProps` 六种入参，以及 7 条源码级守卫：不再用 `useSessions(s=>s.current)`、`pullDraft` 没 key 就不发、启动不再初始拉 `default`、轮询在会话 id 未知时不拿 `default` 顶替、节流按 key、主机 key 不一致不渲染、根域实例无权下否的结论。

### 生效方式

- **宿主半与客户端半都改了：重启 `dsh web` + 硬刷新页面**（`lib/client.js` 内容变了，`/plugins/??…&rev=` 的 rev 随之改变）。
- **已经踩过这个 bug 的安装不用手动搬文件**：升级后打开任意一个空壳的 CC 会话，工坊顶部会出现「发现另一份已落盘草稿：…（槽 `default`）」+ 一键迁入按钮 —— 旧版前端在拿不到会话 id 时正是把用户的编辑写进 `default` 的，点一下就能捞回来。
- 诊断口径也变了：DevTools 里看一次 `cc_getDraft` 的 `res.value.key`，正常应等于 `~/.dsh/cc-drafts/` 里那个文件名去掉 `-<hash>.json` 的部分；`keySource: "fallback"` 表示主机没拿到会话 id（这时前端不会渲染该槽）。

## 0.3.4

**适配 dsh `0.1.6-alpha.2`**：实测宿主半 / 客户端半 / 预设半在该版本上均正常；同时修掉 CC 预设里两处「不报错、只是静默少能力」的漏抄，并补齐 alpha.2 新增行。

### 变更

- **修 CC 预设整行漏抄 `present`**：`@deepseek-ai/dsh-tool-present` 是内置 `standard` 一直有的行，本预设此前没抄进来 —— 后果不是报错，而是 CC 模式下模型没有「把成品登记为交付物」的工具，**能力静默缺失**。
- **修 `tool-subagent`（spawn）行漏抄 `modelSelectionSettings: true`**：该键在 `dsh-tool-subagent` 里是 `z.boolean().default(false)`，漏掉既不报错也不改 schema，只是子代理的「指定模型」入口被静默关掉。fork 行**故意不加**（provider/model 必须等于父代理，继承的历史才能继续命中 KV cache）。
- **补齐 alpha.2 新增的 `tool-plugin-manager` 行**（`disabled: true`，内置 `standard` 里本来就是关的）。抄过来只是为了「本预设 vs 内置 `standard`」的行差以后只剩有意为之的那处（`command-goal` 留在 host 面），下次升级 diff 时不必再逐个判断「这行是新加的、还是我们漏了」。`disabled` 行不参与健康检查（`dsh-agent-presets` 的 `unresolvableRows` 里 `if (Boolean(row.disabled)) continue`），所以抄它零风险。
- **新增 7 项「预设行契约」守卫**（`tests/preset-install.test.mjs` 第 10 节，34 → 41 项）：钉住 `workflow-ptc` 行名、不得再出现 `workflow-worker-thread` 行、spawn 行的 `modelSelectionSettings`、fork 行不得有它、`present` 行、`tool-plugin-manager` 行，以及**「每个 `- id` 行都必须有 `name`」**。最后一条对应本仓库最贵的后果：预设里任何一行取不到包名或没有名字，整份预设被判 `broken`、CC 模式直接从 roster 消失，而不是「那一行不可用」。

### 说明（都是本机实测的）

- **alpha.1 → alpha.2，内置 `standard` 只多了一行**：从 npm 缓存里取出 `@deepseek-ai/dsh-agent-presets` 的 alpha.1 / alpha.2 两个 tarball 逐行 diff —— 只新增 `tool-plugin-manager`（disabled），没有任何改名或删除。`dsh` 自身则是把全部 `@deepseek-ai/*` 依赖整体抬到 alpha.2，并把 `cordis-plugin-hmr` 换成 `dsh-hmr`，新增 `dsh-plugin-manager` / `dsh-atomic-write` / 两个 agent-team profile 包。
- **改完的模板用 alpha.2 自带的健康检查实跑过**：`discoverPresets`（`compositionProblem` 的形状检查 + `unresolvableRows` 的逐行解析）判定未 broken；行名集合与内置 `standard` 的差异只剩「+ 我们的 `cc-agent`」「− `command-goal`」。
- **宿主半在 alpha.2 仍正常**：`GET/POST /dsh-cc-studio-rpc/ping` 得到 401，而 `/definitely-not-a-route-xyz` 得到 404（POST 405）。这个校准很关键 —— 说明没有全局鉴权围栏，那个 401 只能来自插件自己注册的 prefix 路由、且是它自己调 `connection.requestRejection` 的结果，即 0.2.22 的绕法在 alpha.2 上依然成立。
- **客户端半在 alpha.2 仍正常**：直接在活页面上读 Slot 台账，`conversation.input.dock`（`dsh-cc-studio-pill`）/ `shell.overlay`（`dsh-cc-studio-overlay`）/ `settings.section`（`cc-studio`）三个挂载点都是 `active: true` 且 registrant 等于包名 —— 说明 `__ModuleLoader__.load({ id })` 的 id 匹配没有退化。
- **预设半在 alpha.2 仍正常**：按 alpha.2 的 `tools.register`（要求 `output: { schema, render }`）与 `agents.currentInitiator()` 契约，在隔离 harness 里挂载 `lib/agent.js`：14 个 Tool 全部注册、形状合法，强制工作流跑到底 `cc_validate` = `valid: true`，15/15。
- **旧装会被自动安全更新**（复刻本机现状实测）：已装目录里是旧模板、且记录哈希与之一致时，`installCcPreset` 判为「我们写的、用户没改」→ `status: updated`、无 `skipped` 告警、二次调用幂等 `current`。用户手改过的文件依旧跳过，「绝不覆盖用户改动」的不变量未动。

### 生效方式

- **改预设只在插件挂载时安装，所以改完必须重启 `dsh web`**。重启后插件会把 `<DSH_HOME>/.agent-presets/cc` 从旧模板安全升到新模板（本机现状正是「0.3.3 模板 + 相符记录」，走的就是这条路径）。
- 预设行是**按会话挂载**的：重启后新开的 CC 会话才带得上 `present` 工具与子代理模型选择；已在跑的 CC 会话沿用挂载时的组合。
- 宿主半与客户端半本次未改，无需硬刷新。`npm test` 由 151 项升到 158 项（`23 + 41 + 32 + 62`），全绿。

## 0.3.3

**发布流程自动化**：打 `v*` tag 即由 GitHub Actions 发布到 npm，并自动建 GitHub Release。**插件运行时行为未变**（只有仓库级的 CI 与文档改动）。

### 变更

- **新增 `.github/workflows/publish.yml`**：打 `v*` tag → 版本守卫（tag 必须等于 `package.json` 的 version）→ `npm test`（151 项）→ `npm publish --provenance` → 发布成功后建 GitHub Release。手动 `Run workflow` 默认只做安全自检（checkout / setup node / 升级 npm / test / `npm pack`），不发布；要补发就把 `dry_run` 取消勾选。
- **认证改用 npm OIDC trusted publishing，不再依赖长期 token**。npm 侧的登记（仓库 `xia-sc/dsh-cc-studio`、workflow 文件名 `publish.yml`、Environment 留空、勾选 Allow npm publish）与 workflow 里的 `permissions: id-token: write`、「运行器 npm ≥ 11.5.1（Node 22 自带 10.x，故有升级步骤）」共同构成硬要求，缺一个就是 `ENEEDAUTH` / `401`。npm 包页因此带上 **Built and signed on GitHub Actions** 的 provenance 标记。
- **新增 `.github/scripts/release-notes.mjs`**：从 `CHANGELOG.md` 抽该版本小节，生成 Release 的正文与标题（标题沿用 `vX.Y.Z — 短描述` 的既有习惯）。特意单列成文件而非内联进 workflow，是为了能本地验证这段解析；抽不到小节时给显式占位，而不是发一个看起来正常的空 Release。
- **README 顶部加 npm 版本徽标**（中英各一处）；`AGENTS.md` §5 的发布规则改为「CI 为主、手动为备用」，并记下下面两条实测结论。

### 说明（都是本机实测的）

- **`npm publish --dry-run` 与 `npm pack` 都不做认证**：把 `_authToken` 换成假值，`--dry-run` 报的错一字不差（它的版本查重不需要凭据）。所以任何手动跑法都无法提前验证 OIDC —— 本次发布才是第一次真实验证。
- **手动发布那条路会一直要求浏览器授权**：账号 2FA 是 `auth-and-writes`，`npm publish` 表现为 `PUT 401` → 浏览器授权 → `PUT 200`，属正常现象，不是出错。
- 本仓库零依赖（`lib` 与 `tests` 只 import `node:*` 内置模块）且没有 `package-lock.json`，所以 CI 里刻意不跑 `npm ci`。

### 生效方式

- 插件运行时未变：`npm test` 151 项断言全绿，打包仍是 12 个文件（`tests/`、`dist/*.zip`、`.github/` 都不进包）。
- 发版方式变了：见 `AGENTS.md` §5 的「发版三步」——① 同步版本四处 ② `git commit` ③ `git tag -a vX.Y.Z -m "…" && git push origin master --follow-tags`。

## 0.3.2

**包名迁移 + 首次发布到 npm**：`@dsh-plugins/dsh-cc-studio` → `@xia-sc/dsh-cc-studio`。

### 变更

- **包名换成 `@xia-sc/dsh-cc-studio`**：`@dsh-plugins` 不是本项目持有的 npm scope，发不出去 —— scoped 包只有该 scope 的成员能 publish，而 npm CLI **没有** `npm org create`（只有 `org set / rm / ls`），建组织只能在网页上做。
  - 代码侧必须同步的 4 处，漏一处不是「那个功能不可用」而是**整体坏掉**：
    1. `package.json` 的 `name`；
    2. `cordis.patch.yml` 的宿主插件行 `name`；
    3. `presets/cc/agent.cordis.yml` 的 `cc-agent` 行 `name` —— 包名解析不到会让整份 CC 预设被 `unresolvableRows` 判 `broken`，CC 模式直接消失（后果同 0.3.1）；
    4. `lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 `id` —— `dsh-client-modules` 拿宿主图里的包名精确匹配（`stripClientSuffix` 后相等，见该包 `lib/client.js:267,285`），对不上直接抛 `bundle … loaded without registering "…"`，客户端半整体加载失败。
  - **不受影响**：宿主 RPC 通道 `/dsh-cc-studio-rpc`、预设目录名 `cc`、安装记录 `.dsh-cc-studio-preset.json`、`localStorage:dsh-cc-studio-settings`、`~/.dsh/cc-library/`、`~/.dsh/cc-drafts/` —— 这些取自短名 `dsh-cc-studio` 或独立常量，与包名无关。
  - **迁移**：装过旧名的先 `dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio`，再 `add @xia-sc/dsh-cc-studio`。包名变了就是另一个包，`dsh.profile.bundles` 里的旧行不会自己消失。
- **不重装会当场坏掉（本机已实测）**：当 profile 里的安装身份（`dsh.profile.bundles` 那行 + `dependencies` 里的 `link:`）还是旧名、而包内已经改名时，**宿主照样能起，浏览器那一半会停在 `Failed to load plugins / web boot: 1 entry did not activate / import failed`** —— 客户端资源按旧名解析不上，只有浏览器半挂。此时插件自己的 `/dsh-cc-studio-rpc` 路由也不会注册（探测它得到 404/405，而不是缺 cookie 时的 401，可用来反推插件有没有被挂载）。修法就是按新名重装；重启后**必须硬刷新**（`Ctrl+Shift+R`），旧页面的引导图是缓存的，普通刷新会复现同一句错。一句话判断法：`~/.dsh/profiles/web/node_modules/<scope>/` 的目录名必须等于该包 `package.json` 的 `name`。
- **补齐 npm 发布元数据**：`publishConfig.access = "public"`（scoped 包默认按私有发布，缺它报 `402 You must sign up for private packages`）、`repository` / `homepage` / `bugs` / `keywords`，以及 `prepublishOnly: npm test` 作为发布闸门。
- 「安装」一节新增 npm 安装方式（此前只有 GitHub 源 / 本地仓库），并在「更新与卸载」里补上改名迁移的两条命令。

### 生效方式

- **插件行为未变**，只有包名与元数据：`npm test` 151 项断言仍全绿，打包内容仍是 12 个文件。
- 生效方式：按新包名重新安装 + 重启 `dsh web` + 刷新页面。
- 为什么是 `0.3.2` 而不是改 `0.3.1`：`v0.3.1` 已打 tag 并发布，改已发布版本的内容会让 tag 与包对不上。

## 0.3.1

适配 dsh `0.1.6-alpha.1`：**CC 预设被该版本判定为「加载失败」**。

### 修复

- **CC 预设引用了一个在 0.1.6 里被删掉的包**：`agent.cordis.yml` 的 `workflow-worker-thread` 行写着 `@deepseek-ai/dsh-workflow-worker-thread`，而该包已从 0.1.6-alpha.1 的依赖表中移除（换成 `@deepseek-ai/dsh-workflow-ptc`，宿主行 `ptc-runtime` → `@deepseek-ai/dsh-ptc-runtime-node`）。
  - 后果不是「工作流不可用」这么轻：0.1.6 的预设发现会对每个**会真正启动**的行做包存在性检查（`dsh-agent-presets/lib/types/discovery.js` 的 `unresolvableRows`），任何一个取不到的行都会让**整个预设**带上 `broken` 标记；roster 里显示「加载失败 + row "workflow-worker-thread" names a plugin that cannot be resolved」，且**不可选中、不可复制**——CC 模式等于消失。
  - 该行已改为 `workflow-ptc`（保留 `provider: spawn`，与 0.1.6 内置 `standard` 预设一致）。
  - 已在本机用隔离环境实测：装上 `0.1.6-alpha.1` 后，改前行 → roster 标记「加载失败」；改后行 → 无 broken 标记，设置页「角色卡工坊」与工坊 RPC（`cc_getDraft` 返回 `server-response` 信封）均正常，浏览器控制台无报错。
  - 生效方式：重启 `dsh web`（预设是挂载时安装的）。**若你的 `<DSH_HOME>/.agent-presets/cc` 已被手改过，插件会保留你的改动并告警**；想用新模板刷新，删掉该目录后重启，或把插件行配成 `presetInstall: force`。

### 说明

- 本次只动预设模板这一个文件，插件的宿主/客户端代码未变：0.1.6-alpha.1 下 `webServer.register`、connection RPC 线上协议（`client-request` / `server-response` 信封、channel/endpoint 命名约束）、`conversation.input.dock` / `shell.overlay` / `settings.section` 三个 slot 的契约、`ctx.locale.bind/translate`、`agents.currentInitiator/get`、`tools.register` 均与本插件现有用法一致。

## 0.3.0

从 0.2 到 0.3：**移除「点子」页**（工坊改为 4 页）、**补齐全量中英双语**（此前切到 English 仍显示中文）、**CC 预设改为自动安装**（不再需要手工拷贝），并修掉若干会**静默改写卡数据**的问题（多段问候语被拆条、空数组被写成 `[""]`、大框「取消」实际仍在落盘）。

本次共 4 个测试文件、151 项断言。

### 升级注意（行为变更）

- **工坊导航由 5 页变为 4 页**：「点子」（本地草稿搜索）页被移除，原搜索能力由右侧「已存角色」侧栏承担；`⛶ 大框` 改为落到所有长文本字段，问候语数组则改为逐条编辑。
- **CC 预设改为自动安装**：插件挂载时写入 `<DSH_HOME>/.agent-presets/cc`。**你既有的目录不会被覆盖**——若内容与插件模板不一致且无插件安装记录，会保留原样并打印一条 `[dsh-cc-studio]` 告警（详见下方「变更」里的更新策略与开关）。想交回插件管理，删掉该目录后重启 `dsh web` 即可。
- **问候语字段的编辑方式变了**（`alternate_greetings` / `group_only_greetings`）：由「每行一条」的多行文本框改为**一条一个编辑框**，并新增增删按钮。**导出的数据结构不变**（仍是 CCv3 的 `string[]`），无迁移成本。
- **删除两个从未可用的 RPC**：`expandIdea` / `expandWorld`（宿主侧实现早在 `67172fd` 就随示例数据删除，调用必然返回 `unknown-endpoint`）。相关能力由 CC 预设的 `cc_patch_world` / `cc_patch_character` 承担。
- **移除胶囊上的 `×`（隐藏）按钮**：它早已失效（CC 模式下胶囊无条件渲染，点击无任何变化）。
- **中文界面有一处可见变化**：胶囊尾部计数由 `0 entries` 变为 `0 lore`（三处 lore 计数统一走词表）。其余中文文案逐字未变。
- 生效方式：客户端改动**刷新页面**即可；预设自动安装与宿主改动需**重启 `dsh web`**。

### 变更

- **CC 预设改为自动安装（不再需要手工拷贝）**：此前 README 要求把 `presets/cc` 手工拷到 `<DSH_HOME>/.agent-presets/cc`。现在插件挂载时自动完成，装完插件启动 `dsh web` 即可选到 `CC 模式`。
  - 缘起：有用户反馈「装完插件预设就已经在了」，但当时**并非自动**——dsh 的预设发现只扫三个根（**shipped 根**（`dsh-agent-presets` 包内）+ 部署 **`config.roots`** + **用户根 `<DSH_HOME>/.agent-presets`**，见 `dsh-agent-presets/lib/index.js:1300-1310`），插件包内的 `presets/` 不在其中（`dsh plugin` CLI 也完全不碰预设）；那种「已经在」多是此前手工拷过，或看到插件包内确实带着 `presets/` 而误判。现在改成真自动，反馈里的预期成立。
  - **绝不静默覆盖用户改动**：目标缺失→写模板；与模板一致→不动；与插件上次写入的内容一致（用户没改过）→升级时安全更新；用户改过或无安装记录的历史手工拷贝→**保留并告警**。判定依据是预设目录里的 `.dsh-cc-studio-preset.json`（记版本与各受管文件写入时的 sha256），因此不依赖版本号比较。记录只声明「插件拥有的」内容，被跳过的用户文件不记哈希（否则下一轮会误判成「插件写的、用户没改」而覆盖用户内容）；且**当全部受管文件都属于用户时完全不写记录**，不在用户自己管理的目录里留任何痕迹。以上两条不变量都有测试钉住。
  - 开关：环境变量 `DSH_CC_STUDIO_PRESET_INSTALL` = `auto`（默认）/ `force`（连用户改动一起覆盖）/ `off`（完全关闭）；也可在插件行声明 `config.presetInstall`，优先级高于环境变量。另：自动安装**不注册任何删除动作**，卸载插件不会删除已安装的预设。
  - 卸载/删除插件仍然不会删除 `<DSH_HOME>/.agent-presets/cc/`。
- 左侧导航与顶部步骤条去掉 `1. 点子`（本地草稿搜索页），余下依次为 **1. 5维世界观 / 2. 角色细化 / 3. 世界书 / 4. 校验导出**；打开工坊默认落在 5 维世界观，世界观页的「下一步 → 角色细化」同步指向新索引。
- 该页的搜索能力没有丢：右侧「已存角色」侧栏自带搜索框，仍按名称/标签/lore 数过滤。
- 原挂在该页的 `⛶ 大框` 编辑能力改由统一的 `fieldHead()` 提供，落到**所有长文本 string 字段**上（新增 `post_history_instructions` 此前没有大框）；问候语数组字段另由 `greetingList()` 逐条编辑（见「修复」）。
- 清理只被该页使用的词表项：`step.idea` / `step.idea.desc` / `workshop.search.*` / `workshop.char.title`；`settings.status.hint`、`workshop.library.empty` 不再提「点子」。
- **移除胶囊上的 `×`（隐藏）按钮**：它已完全失效——胶囊的渲染条件是 `if(!s.isCcMode && !s.triggered && !s.panelOpen) return null`，而 CC 模式下 `isCcMode` 恒为真，点 `×` 只把 `triggered` 置回 false，胶囊照旧显示，**画面毫无变化**。随按钮一并删除其唯一的调用点 `store.dismiss()`，以及为它准备却**从未被引用**的词条 `capsule.hide` / `capsule.hideTitle`（原按钮当时写的是 `"×"` 与中文 title 字面量，没走词表）。
- **清掉 `triggered` 状态与 `trigger()`**：`trigger()` 只有定义和导出、**全仓无任何调用点**（已 grep 三个 lib 文件与 `presets/`）。而 `triggered` 在删掉 `dismiss()` 之后，唯一写入者就是 `setIsCcMode`，且写值恒等于 `isCcMode`——即 `triggered === isCcMode` 是不变量。因此渲染条件里的 `!s.triggered` 是冗余项，简化为 `if(!s.isCcMode && !s.panelOpen) return null;`。删除前已用状态机穷举对照：**16 个可达状态的渲染判定完全一致**；唯一不同的是 `triggered=true / isCcMode=false / panelOpen=false` 这个**只能由已死的 `trigger()` 造出**的状态，故对真实行为零影响。`triggered` 只是内存中的 UI 状态，不入 localStorage、不入草稿落盘，无兼容性问题。
- **修胶囊文案的中英不一致**：折叠提示此前硬编码 `"— 已展开"` / `"— 点击展开"`，切到 English 仍是中文；而 `capsule.expanded` / `capsule.collapseHint` 的中英词条其实早已存在，只是从未被调用。现改为 `t("capsule.expanded")` / `t("capsule.collapseHint")`，中文显示与原先逐字一致（"— 已展开" / "— 点击展开"），英文变为 "— expanded" / "— Click to expand"。
- **首次切到 CC 模式时胶囊不出现（要刷新页面或切换会话才出现）**：根因是**探测读错了字段**。会话的预设实际位于 `session.projectionValues.agentPreset`（dsh 官方 UI 亦如此读取，见 `dsh-client-ui-agent-preset/lib/client.js:191,1374`），而旧代码读的是 `sess.preset || sess.presetId || sess.agentPreset || sess.mode` —— 这四个**全都不存在**。于是 `presetOfCurrent` 恒为 `null`，而探测 effect 的依赖是 `[currentId, presetOfCurrent]`：切换模式既不改变 `currentId`，也不改变一个恒为 `null` 的值，**effect 永不重跑**；只有刷新页面（重新挂载）或切换会话（`currentId` 变）才会重新探测——与报告的现象完全吻合。
  - 修法：抽出共用 hook `useCcPreset()`（此前 Capsule 与 Workshop **各写了一份重复实现**，现已合并，杜绝再次漂移），判定优先级为 ① 会话投影 → ② 预设芯片 DOM → ③ 主机 RPC。
  - 旧 DOM 兜底只扫 `button`，而**运行中会话的预设标签渲染成 `<span>`**，对运行中会话完全失效；现改用精确选择器 `button[aria-haspopup="menu"]`（预设芯片是唯一满足该条件的下拉触发器，见 dsh 源码 `AgentPresetSeat`），既修好运行中会话，又避免「下拉菜单展开时把菜单项里的预设名误判成已选中 CC」的假阳性。
  - 补上**新会话页**的探测：芯片是「为下一次会话选择」，此时还没有 session、store 里查不到，故新增 1s 本地轮询捕获芯片切换（纯 DOM 文本扫描，不打 RPC；判定不变时 `setIsCcMode` 内部不触发重渲染）。选择 CC 模式后胶囊**立即出现**，并在首次对话创建会话后无缝衔接。
  - 修掉旧「补偿重试」失效问题：它调用 `checkIsCcMode(currentId)` 走 5s 节流，主机侧 `composedPreset` 未就绪时的补救重试会被节流直接吞掉；现显式传 `force` 绕过，并在 1.2s / 3s 各重试一次。
  - 新增 `decideCcMode()` 纯决策函数：**投影未知时不发假结论**（返回「未知」而非 `false`），避免「选 CC → 首次对话」瞬间的胶囊闪烁。
- 新增 `tests/cc-detection.test.mjs`（32 项）：直接执行源码中的真实实现，覆盖「必须从 `projectionValues.agentPreset` 读到预设」（即上述 bug）、DOM 探测器对不可见元素/自身 UI/模型选择器（含 `(CC)`）的不误判、`decideCcMode` 判定表（含未知态），以及源码级守卫（两份重复实现与错误字段不得回流、DOM 必须用精确选择器、重试必须带 `force`、必须有轮询兜底、预设名必须走词表）。
- **lore 计数统一走词表**：胶囊正文的 `loreCount+" lore"`、胶囊尾部的 `loreCount+" entries"`、以及已存角色侧栏徽标的 `entry.loreCount+" lore"` 三处硬编码拼接，均改为 `t("common.loreCount").replace("{n}", …)`（沿用仓库既有的 `replace("{n}")` 插值模式，locale 的 `t()` 本身不做插值）。取值为 `"{n} lore"` 且中英同值，因此**中文界面的观感变化仅是胶囊尾部由「0 entries」变成「0 lore」**，其余两处输出逐字不变；这样做的收益是三处计数不再各写各的字面量，将来改词表即全局生效。
- 顺带修正 README 里两处与现状不符的描述：「风格标签自定义」（该芯片 UI 自 0.2.14 起已不在界面中）与「`1. 点子` 现为本地草稿搜索」。
- **完成全量 i18n 接线（工作坊此前切到 English 仍显示中文）**：词表其实早就建好了（`capsule.*` / `panel.*` / `step.*` / `action.*` / `settings.*` / `workshop.*` / `common.*`），但**大量调用点直接硬编码中文**，那些词条从未被引用（改造前 132 个键里只有 65 个真正被调用）。本次把 UI 层与 store 层的**全部 122 条中文字面量**接入词表：store 状态与错误文案（导入/导出/PNG/CHARX/保存/载入/删除/重命名/回滚）、问候语逐条编辑器、世界观与角色细化字段标签、世界书、导出页、已存角色侧栏、两个大框标题与字数提示、`window.confirm` / `window.prompt`，以及 `addEntry()` 建新条目的默认名/关键词/内容。词表增至 **203 键**（zh/en 严格一致、无重复、占位符一致）。
  - **中文界面逐字未变**：新增测试会拿真实词表跑 `{n}` 等插值，把结果与改造前的硬编码拼接逐条比对，确保不是「翻译对了但中文变样了」。
  - **CCv3 字段名保持英文**（`name` / `description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions` / `first_mes` / `creation_date` 等）：它们是规范里的字段标识，两种语言下都该是英文；带中文提示的（如 `nickname（{{char}} 用）`、`tags（逗号分隔）`）才进词表。
  - `t()` 原生支持 `{name}` 插值（`locale.translate` 用 `params` 替换），且语言切换会换发新的 `t` 引用以触发重渲染；store 层原本没有 `t`，现通过 `ctx.locale.bind(NS)` 取得（该绑定在**调用时**读当前语言，故随语言切换生效），并在 locale 缺失时回退到内置词表。
  - 新增守卫式测试：**UI 层不得再出现任何中文字面量**（词表区域与注释除外），使「新写的中文必须进词表」成为硬约束。

### 修复

- **数组字段往返会改写数据**（本次改动引入的回退）：`fieldHead()` 用 `(raw||[]).join('\n')` 配 `String(v).split('\n')` 做「每行一条」互转，而 `''.split('\n')` 得到 `['']`，于是**空数组往返一趟变成 1 个空问候语**——「打开 `alternate_greetings` / `group_only_greetings` 的大框 → 直接点完成」这种零输入操作就会静默改写卡数据（导出多出空白问候语）；`['a\n']` 也会 1 条变 2 条。该「每行一条」编码随后被**整体移除**（见下一条），空数组不再经过任何字符往返。
- **多段问候语被静默拆条**（根因修复）：上一条只堵住了空数组，而根因是**「一条问候语」与「一行文本」被当成同一个东西**。`alternate_greetings` / `group_only_greetings` 的元素本来就是可含换行的多段文本，序列化后元素内部的换行会被拆开——导入带多段问候语的卡后，在行内 textarea 里**敲一个字**就会把 1 条拆成 N 条，而且**能通过宿主校验静默导出**（`validateCard` 只检查 `Array.isArray`，实测 `group_only_greetings:[""]` 也返回 `valid=true`）。现在这两个字段改为 `greetingList()` **逐条独立编辑**：一条 = 一个 textarea，元素内部换行原样保留，**不再有任何 join/split 序列化**（`arrayToLines` / `linesToArray` 连同「每行一条」的语义一并删除），因此保真不依赖编码技巧。顺带补上了此前完全缺失的能力——**增删问候语**（原先只能靠加减行，UI 里没有任何增删按钮）。
- **问候语 10 条上限对齐**：宿主两处会截断到 10（`agent.js` 的 `cc_patch_greetings`、`index.js` 的 `cc_patchDraft`），而客户端此前无上限，于是 UI 可以造出随后被 LLM patch 静默砍掉的数据。现在 `GREETING_MAX=10`，达到上限即禁用「＋ 新增一条」并显示计数，测试会跨文件核对宿主截断点与 UI 上限一致。
- **大框「取消」与「完成」是同一个动作**：大框输入即同步（每次击键都 `updateDraft`），原先「取消」也走 `clearEditingText()`，等于照样落盘。现在 `editingText` 携带打开时的快照与 `revert` 闭包，「取消」真正回滚；长文本与世界观两个大框都提供 `cancelEditingText()` / `cancelEditingWorld()`。
- **无改动的写入不再刷新修改时间**：`updateDraft()` 在变更后内容与当前一致时直接返回，不再改 `modification_date`、不再推宿主（此前「打开大框 → 取消」这类空操作也会触发一次宿主写入）。
- **清掉自 67172fd 起就调不通的死代码**：客户端 `expandIdea` / `expandWorld` 两个 RPC 的宿主侧实现（mock）在那次提交随示例数据一并删除，宿主 `dispatch` 无此 endpoint（会返回 `unknown-endpoint`），客户端调用自那时起必然失败；这两个能力现由 CC 预设的 `cc_patch_world` / `cc_patch_character` 工具承担，故移除客户端死代码，连同只服务原「点子」页的 `state.idea` / `state.tags`、`setIdea` / `setCustomTag` / `addCustomTag` / `removeTag` / `toggleTag` 与 `S.chipOn`。这些 RPC 名称从未成功过，无兼容性影响。
- 新增 `tests/preset-install.test.mjs`（34 项）：锁住自动安装的安全规则（缺失→写、一致→不动、我方内容→安全更新、用户改动/无记录的手工拷贝→跳过保留且不留痕迹）、幂等性、`off` 不碰磁盘、`force` 覆盖、环境变量与 config 的优先级、标记文件不得声明被跳过的用户文件、`apply()` 会真正触发安装且不改变既有返回值契约。同时修掉一个副作用隐患：`tests/rpc-channel.test.mjs` 原先只隔离了 `HOME`，而 `DSH_HOME` 优先于 `homedir()`——不隔离会让 `apply()` 写进**真实的**用户预设目录（现已一并隔离，并在每次跑测试后校验真实目录确实未被改动）。
- 新增 `tests/client-greetings.test.mjs`（62 项）：锁住问候语保真不变量（多段问候语编辑后长度不变、内部换行保留，并与旧 `join/split` 编码做对照证明回归有效）、数组访问器纯函数且越界 no-op、增删与 10 条上限、宿主截断点与 `GREETING_MAX` 跨文件一致、`arrayToLines`/`linesToArray` 与「每行一条」已彻底消失、已删死代码（含 `dismiss` / `trigger` / `triggered`）不得回流、`store.*` 调用点与导出/声明一致、两个「取消」按钮及逐条大框都必须绑定回滚 handler、胶囊文案与 lore 计数必须走词表且中文取值不变；以及全量 i18n 守卫（UI 层无硬编码中文、zh/en 键集与占位符一致、`t()` 引用的键都存在、中文插值输出与改造前逐字一致）。`pnpm test` 现在四个测试文件都跑（23 + 34 + 32 + 62 = 151 项）。

### 说明

- 多段问候语被拆条的问题已随根因修复消除，不再需要 `---` 之类的替代编码或手工改 JSON：保真是结构性的（一条 = 一个编辑框），不依赖任何分隔约定。右侧预览面板仍 `JSON.stringify` 整个草稿，需要核对真值时可直接看。
- 仍未提供的是**问候语排序/拖拽**（重排需删除后重新新增）。`alternate_greetings` 由读取方随机选取，顺序影响很小，故本次未做；导出顺序即数组顺序。

### 文档

- README「重启与验证」里的两条自检命令此前都跑不通，现已改为可逐字复制的形式（中英双语，另附 Windows PowerShell 等价写法），并已实测：
  - **客户端资源那条 URL 形式就是错的**：真实地址是 `/plugins/??<包名>/client.js&rev=<内容哈希>`，缺 `??` 或缺 `rev` 都会 404（实测无 `rev` → 404、`rev` 写错 → 404），且 `rev` 每次改 `lib/client.js` 都会变，因此改为带 cookie 从首页里取真实 URL 再请求。原先那条按文档照抄必然 404。
  - **RPC 自检的 cookie 名也是错的**：文档写 `dsh-auth-127.0.0.1:3080`，而真实名字是 `dsh-auth-` + base64url(sha256(权威段))（本机为 `dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw`）；按文档照抄会 401（实测：错误名 401 / 正确名 200）。现改为用 `dsh web` 启动时打印的 token 直接换取 cookie，不再要求用户手工拼名字。
- 顺带在文档里写清三件事：`/`（首页）与 RPC 受会话 cookie 保护而不带 cookie 返回 `401 dsh web authentication required`；**插件资源 `/plugins/??…&rev=…` 本身不走鉴权**，所以缺 `??`/`rev` 表现为 404 而非鉴权失败（别把 404 误判成没装上）；`rev` 是内容哈希、随 `lib/client.js` 变化。

## 0.2.22

适配 dsh `0.1.5-rc.1` 启动崩溃。

### 修复

- **启动崩溃 `cannot get property "webServer" without inject`**：该 dsh 版本起 `connection.rpc.handle()` 对外部插件不可用——`HostConnectionService.rpc` 用的是 connection 插件自己的 ctx，其 `inject` 仅为 `["credentials"]`，`webServer` 位于它的内层 `ctx.inject(["webServer"])` 作用域，owner fiber 永远解析不到。host 半改为在 `webServer` 上自注册 `/dsh-cc-studio-rpc` 前缀路由，并实现同一套 connection RPC 线上协议（含 `connection.requestRejection` 围栏 + `server-response` envelope）。
- **请求体读取**：由 `for await` 改为 `data / end / error` 事件式（该运行时下异步迭代 `IncomingMessage` 会抛错，连 `client-connection` 自带 `/api` 帧也受影响）。
- **`presets/cc` persona 行**：`text` → 必填 `prefix`，否则切换 CC 模式报 `invalid config: S.prefix missing required value`。

### 新增

- `tests/rpc-channel.test.mjs`：host 半 RPC 通道回归（假 ctx + 真实 http），23 项断言，`pnpm test` 或 `node tests/rpc-channel.test.mjs`。

## 0.2.21

修复 #2 草稿静默丢失。

- 草稿变更即落盘 `~/.dsh/cc-drafts/<会话>.json`，host 重启/换会话后按会话 id 自动恢复（`creation_date` 不变）。
- 内存 miss 不再静默建空：无存档建空会警告（工具 `notice`/`message` + 工坊橙色条），恢复成功会提示（蓝色条，展示 `creation_date`），下次写入后提示消失。

## 0.2.20

修复 `cc_isCcMode` 刷屏。

- 胶囊/工坊改用 `current + preset` 窄订阅（流式更新不再重跑 effect）。
- `checkIsCcMode` 同会话 5s 节流 + in-flight 去重；本地已判 CC 不再打 RPC，工坊只做兜底。

## 0.2.19

跟随全局语言。

- 移除设置页内 `语言 / Language` 手动切换卡，插件只跟随 `设置 → 通用 → 语言`（`locale: dshCcStudio` + `t` 自动重绘）。
- CC 预设保持纯中文（用户预设不走系统翻译，双语版显累赘已还原）。

## 0.2.18

中英双语。

- `zh / en` 全量词表 + 设置页 `语言 / Language` 手动切换（`locale.setLocale`，与全局语言联动，胶囊/步骤/设置即时中英切换），`settings.section` 标题亦随语言变化。
- 修复工坊未翻译文案与 loader 的 `t is not defined` 崩溃。

## 0.2.17

容器互通。

- `JSON / PNG(tEXt ccv3) / CHARX(ZIP)` 导入导出打通。
- `⬆ 写入 PNG` 支持将当前卡写入用户上传的任意 PNG（剥离旧 `ccv3/chara` 块，`CRC32` 重算，`STORE&DEFLATE` ZIP 兼容）。
- 校验页 `⬇ JSON / ⬇ PNG / ⬆ 写入 PNG / ⬇ CHARX` 四键。

## 0.2.16

导入与可调心跳。

- 侧边栏 `⬆ 导入本地 JSON(CCv3)`、导入后自动校验/自动保存开关。
- CC 心跳间隔 1–30s 可调（0 关闭，`localStorage:dsh-cc-studio-settings`）。
- 修复 `{{char}}` 变量误用导致的 `unknown prompt variable`，`presets/cc` 同步修复。

## 0.2.15

修复首切 CC 不显示。

- `conversation.input.dock` 会话域 + `shell.overlay` 根域按 `[currentId,sessions]` 订阅与 900ms 重试。
- `cc_getDraft` 轮询收敛为 CC 模式下 4s/1s 基座 + 500ms 去重，关闭即停。

## 0.2.14

移除「点子投喂」卡片。

- `1. 点子` 现仅保留**本地草稿搜索**（`一句话点子/风格标签` 输入已移除，标签改在「角色细化」中逗号分隔编辑），界面更简洁。

## 0.2.13

合并版本。

- 全量长文本大框（所有 textarea ⛶ 720px 大框）。
- 点子步本地搜索（紫框过滤已存侧栏）。
- 设置页修复（`settings.section` 补 `locale`）。

## 0.2.12

点子步改为本地搜索。

- 紫框不再是点子输入/标签候选，直接过滤右侧已存侧栏（输入/芯片一键筛，实时预览前 3 条，「载入」直达），与侧栏搜索双向同步。

## 0.2.11

全量长文本大框编辑 + 设置页修复。

- `一句话点子 / description / personality / scenario / system_prompt / first_mes 等` 所有长文本新增右上 `⛶ 大框` 按钮。
- `settings.section` 漏 `locale: NS` 修复，已存数/落盘 `~/.dsh/cc-library` 展示。

## 0.2.10

世界观大框编辑。

- 每维预览 140 字 + 字数，卡片点击/「⛶ 编辑」弹出 720px 大框（320px 高，实时同步草稿），解决长文在 70px 小框内难编辑/预览问题。

## 0.2.9

模型侧暴露已存库 CRUD。

- `cc_list/save/load/delete/rename/get_library` 6 Tools（与工坊侧栏共享 ID），支持「帮我更新/载入 ID xxxx」自然语言持久化。

## 0.2.8

已存角色 ID 化 CRUD。

- 载入后再次保存按唯一 `ID` 原地覆盖（无需删旧再存），`＋ 另存为新` / `✎ 重命名` / `＋ 新建`，高亮当前卡与 `ID:xxxx` 显示。

## 0.2.7

修复 #1：`cc_patch_world(autoLorebook=true)` 重复追加导致过期条目堆积。

- 覆盖旧自动条目、保留手动条目，新增 `cc_delete/update_lorebook_entries` 管理能力。

## 0.2.6

共创约束。

- 每步先与用户讨论（Tool 描述 + persona 强制「先问再填」），修复「LLM 自行推断填满」问题。

## 0.2.5

修复工坊五维回显丢失（`draft.extensions.cc_world ↔ state.world` 双向同步）。

## 0.2.4

深浅色自适应，深色下修复品牌按钮白底刺眼。

## 0.2.3

workflow + UI 细节（maxWidth/boxSizing、40px 折叠栏、6 步强制校验）。

## 0.2.2

已存角色侧栏（280px 可折叠 / 落盘 `~/.dsh/cc-library`）。
