# 更新日志

`dsh-cc-studio` 的版本变更记录，倒序排列（最新在上）。README 只保留最近几条，完整历史在本文件。

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
