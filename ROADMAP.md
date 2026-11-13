# ROADMAP — 待办与决策记录

> 0.21.0 发布后的一次评估记录。**这里不是承诺清单**：每条都写清"现状（代码位置）→ 为什么值得做 → 落地方案 → 待拍板 / 待实测 → 成本"，做完就把它删掉或标成已完成。
> 结论先放这里：插件已经不缺"能写什么"，缺的是"写完到底对不对"——所以第 1 条优先级最高。

## 优先级总览

| # | 事项 | 类型 | 价值 | 成本 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 运行期闭环：导入 ST 后回读核对 | 功能 | 高 | 中 | 待拍板 |
| 2 | 更新已存在的卡（而不是每次新增一张） | 功能 | 中高 | 中 | 待拍板 |
| 4 | 工程债：测试护栏 / persona 预算 / 客户端体积（观察） | 工程 | 中 | 高 | 4.2 第一步已做，4.1 待做 |

---

## 1. 运行期闭环：导入 ST 后回读核对

### 现状

`cc_stImport`（`lib/index.js`）把卡推进 SillyTavern 后只拿到「导入成功」，**没有任何办法确认 ST 里那张卡到底带了什么**。而 0.16–0.19 的全部工作都押在三处字段上：

- `data.extensions.depth_prompt.prompt`（时间自检 + 设定铁律，ST 每轮注入）
- `data.system_prompt` / `data.post_history_instructions`（时间规则 / 生成前自检）
- `data.character_book`（时间锚定 / 设定铁律常驻条目）与 `data.extensions.world`（角色↔世界书绑定）

### 为什么值得做

用户所有的实际抱怨（时间漂移、吃书、复读）都发生在**运行期**，而插件对运行期的唯一证据是「我们写进去了」。回读把这句话变成「ST 里确实有」——这是本仓库唯一能把软约束变成可验证事实的缺口。

### 落地方案

1. `lib/compat/adapters/sillytavern.js` 的 `remote` 描述里补一个 `card.get`（路径/字段名写在 adapter，宿主不写平台分支）。
2. `lib/index.js` 的 `cc_stImport` 在导入成功后按 avatar 读回卡。
3. 新增纯函数（建议放 `lib/consistency.js` 或新建 `lib/compat/verify.js`）：把「期望的三处注入」与「读回的卡」逐项比对，产出回执：
   ```
   { ok: true/false, checks: [{ field, expected, actual, pass }], missing: [] }
   ```
4. 客户端在导入结果区显示回执（哪些字段在、哪些丢了、书有没有绑上）。

### 待拍板

- **不一致时怎么处理**：只报告（推荐，导入已成功，重导可能覆盖用户改过的卡）还是自动重导？
- **核对范围**：只查三处注入字段，还是连世界书实际书名绑定（`extensions.world` 与 ST 返回的书名逐字比对）一起查？

### 待实测

- ST 1.19 的读回接口形态（`POST /api/characters/get` 还是别的；按 `avatar` 还是 `chid`）。**这条必须在 ST 上实测确认，不能凭记忆写死路径。**

### 成本

adapter +15 行、宿主 +40 行、比对纯函数 +80 行、客户端 +40 行、测试 +15 项。

---

## 2. 更新已存在的卡

### 现状

`cc_stImport` 的策略是「已有卡永不覆盖」，于是**改完卡再导入 = ST 里多一张**。用户只能去 ST 里手动删旧的。

### 为什么值得做

这是日常使用里最烦的一条摩擦，而且随着 canon / 钩子这些「改一下再导一次」的场景变多，会更明显。

### 落地方案

- adapter 的 `remote` 增加「更新」能力描述（ST 侧通常是按 avatar 编辑），与「新建」做成同一个按钮的两种模式。
- 默认仍是**不覆盖**（安全）；用户显式勾选「更新同名卡」才走覆盖路径。
- 覆盖前把旧卡的字段快照进返回（让用户知道丢了什么）。

### 待拍板

- **按什么匹配**：ST 用卡名/文件名当 avatar，同名卡可能有多张 —— 「同名就覆盖（破坏性，二次确认）」还是「导入成新卡 + 提示手动删旧」？
- **旧卡聊天记录**：ST 的 edit 通常保留聊天、卡字段全量替换 —— 要不要在 UI 上明确告知？

### 待实测

- ST 1.19 的卡编辑接口与它的匹配键（avatar 精确匹配的边界：扩展名、中文名、重名）。

### 成本

adapter +10 行、宿主 +50 行、客户端 +40 行（二次确认）、测试 +10 项。

---

## 4. 工程债

> 只做「能被测试钉住」或「有明确触发条件」的事。三件事分开排期：护栏（4.1）→ 预算（4.2）→ 观察（4.3）。

### 4.1 测试护栏：L1/L2 已进 `npm test`，L3 单独跑

现状（2026-11 实测）：

- **已有**：`rpc-channel.test.mjs` 用真实 `node:http` + 假 cordis ctx 锁住围栏 / 信封 / 48MB 上限；十几个客户端测试把 `lib/client.js` 整段当函数体执行，语法与 `__ModuleLoader__.load` 已被覆盖。所以「线协议」和「能不能加载」都不是缺口。
- **L1（已进 `npm test`）**：`tests/harness.mjs` 提供 `check()` / `finish()` / `readRepo()` / `createFakeReact()` / `loadClient()`，37 个测试文件的汇总块与十几份假 React 收敛成一份（净 -425 行）。`release-notes.mjs` 抽出 `buildRelease()` 纯函数，测试改为 import、不再 `execFileSync`。新增 `tests/entry-guards.test.mjs`：三入口可加载、bundle id = 包名、`exports` 三入口、`dsh.bundle.patch` 两层文件存在（用 import / 装载代替 `node --check`，同样不依赖子进程）。验收达成：**受限沙箱里 `npm test` 全绿**。
- **L2（已进 `npm test`）**：`scripts/dump-config.mjs`（`npm run fixture:dump`）在隔离 DSH_HOME 上真跑一次 `dsh --profile <p> --dump-config`，把 preset-cc 的行集 / 包名 / 版本落到 `tests/fixtures/preset-composition.json`；`tests/preset-composition.test.mjs` 离线比对（行集、包名逐字、版本在 `dshReleases` 里、preset id/显示名）。fixture 当前对应 dsh 0.2.2-rc.2（顶层 21 行 + 组内 9 行）。没装 dsh 时 `--if-installed` 跳过。
- **L3（单独跑，不进 `npm test`）**：`scripts/e2e-smoke.mjs`（`npm run e2e`）起真实 `dsh web` → 日志里拿 token URL → 换会话 cookie → 首页 200 + `__DSH_BOOT__` 可解析 + boot 清单含本插件 → **客户端资源（boot 的 entry URL）200 / 是 `__ModuleLoader__` 外壳 / 批次 rev 改坏必须 404 / 主资源 200** → RPC `ping` / `cc_isCcMode` / `cc_listTargets` → `cc_setDraft` 写最小卡 → `cc_exportJson` 核对 spec / 名字 / 时间锚定。本机实测全过（断言数由脚本输出，别写死）；实例建在 `.compat-tmp/`，结束 kill + 清理。
- **CI（2026-11）**：`.github/workflows/e2e.yml`（手动触发）在 ubuntu-latest 上用 `npm i -g @deepseek-ai/dsh` 装 CLI，再用 `DSH_EXE` / `DSH_BIN` 指给 L2 / L3 脚本；`publish.yml` 仍只跑 `npm test`（L1 + L2 的离线比对，不启服务）。本地用 npm CLI 0.2.2-rc.1 实测：L2 的行集 / 包名与仓库 fixture 逐字一致（只有 `dshVersion` 不同），L3 全部通过。
- **DOM 验证（2026-11 实测，未脚本化）**：用 Playwright MCP（会话内工具，不是仓库依赖）打开实例 token URL → 选工作区 → 选「CC 模式」→ 胶囊 `🎭 角色卡工坊 · 0 lore · 草稿` 出现 → 点开工坊 overlay（7 个锚点 + 动作栏）→ 设置 → 「角色卡工坊」分区完整渲染。三个挂载点（`conversation.input.dock` / `shell.overlay` / `settings.section`）都在；预设菜单里「CC 模式」带正确描述（roster 没 broken）。
- **待拍板：DOM 断言要不要进脚本**：`npm run e2e` 目前只到 boot 清单 + RPC。加 playwright 会成为仓库第一个开发依赖（CI 还要下浏览器），不加就保持「MCP / 人工验证 + 上面这条步骤记录」。倾向不加 —— 真要自动化就单独一个 workflow，别塞进 `npm test`。

### 4.2 persona 预算（每轮成本，不是首轮）

`presets/cc.patch.yml` 的 `prefix`：改前 2634 字符（CJK 954 / ASCII 1476），**每轮**都在 system prompt 里。重复点：时间锚定语义 3 处、`cc_release_draft` 2 处、`cc_validate` 5 处、整段工具名清单。

- **第一步（已随 0.24.2 发版）**：2634 → 2115 字符（-19.7%），时间锚定 1 处、`cc_validate` 3 处、删掉工具名清单；语义一条没删。`tests/persona-budget.test.mjs` 钉住：字符上限 2200、规则出现次数上限、必留锚点（JSON 卫生 / release 收口 / canon + canonDigest / 时间锚定三件套 / 六步顺序）。
- **第二步（待做）**：把 6 步的细节继续往工具 description 搬，persona 只留顺序 + 门槛；每搬一条跑一次人工对照。
- **行为验证**：不假装有自动评测。固定 3 场景人工看工具调用序列 —— 新卡（六步走全）、改卡（不重写整张）、交付（`cc_release_draft` 被调）。
- 量级参考：工具 schema 侧约 11k 字符（≈ persona 5 倍），真要省 token 该在那边做；persona 优化的收益是**规则不被稀释**。

### 4.3 客户端体积（观察项，不是债）

`lib/client.js` 实测 330KB / gzip 94KB（`lib/agent.js` 246KB / 78KB，2026-11 实测）。手写单文件是架构选择（AGENTS §2），**不改**。

触发条件（满足其一才评估）：gzip 后 > 150KB；或生产实例「boot 完成 → 胶囊可见」> 300ms；或首次打开工坊 > 150ms。

### 4.4 文档里的硬编码数字

本节旧版写的「约 290KB」「约 2.8k 字符 ≈ 2k token/首轮」全部过期（实为 330KB / 2.6k 字符 / ≈1k token），与 AGENTS §5「不写会漂的精确计数」冲突。

做法：数字只留量级，或由 `tests/persona-budget.test.mjs` 这类测试直接输出实测值；写死之前先跑一次。

### 4.5 `npm test` 的组织方式

仍是几十条 `&&` 串行（无 runner），但已经**零子进程依赖**，受限沙箱里能跑完；实测约 8s，所以**不急着迁 `node --test`**。等测试数继续涨或出现 flaky，再加 `tests/run.mjs`（并行 + 失败摘要）。

观察：`rpc-channel.test.mjs` 的 `cc_listGroups` memberCount 断言在机器重负载下偶发失败过一次（单独跑 10/10、连续 `npm test` 5/5 均通过）；那是「写组后立刻读库」的时序敏感点，若再次出现先查读写快照是否同一份，别误判成重构回归。

---

## 明确不做

这些是已经论证过、不要重新提出来的：

- **更多运行期注入模板**（叙事卫生规则那类）：4 处注入 + 独立开关矩阵 = 250~400 token/轮，效果未验证，且有破坏日常向 RP 的副作用。理由见 `CHANGELOG.md` 0.21.0 的「为什么砍掉」。
- **更多工具**：33 个已经很多；canon 是靠在 `cc_validate` 上加参数解决的，不是新工具。
- **更多配置开关 / 更多平台适配**：除非有真实用户需求。
- **插件更新检查**：0.20.0 已下架，交给 dsh 内置的更新检查。
- **独立的「体检」页 / 第 8 个锚点 tab**：0.23.1 已把报告做进总览页（六组 + 每条修法 + 去修跳转），导出弹层只留摘要。再加一页只会让同一份清单出现在三处，用户不知道该看哪。
