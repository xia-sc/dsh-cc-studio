# 品牌资产（CC 角色卡工坊）

插件 logo 的源文件、位图导出与可复现的生成脚本。**本目录不随 npm 包发布**（`package.json` 的 `files` 只含 `lib` / `cordis.patch.yml` / `presets`）。

## 符号与含义

主方案是「**角色卡 × 戏剧面具 × 创作火花**」：

- **白色圆角卡片**：产品本体 —— CCv3 角色卡；卡头的紫色条与头像位对应卡片头部字段。
- **面具**：CC 模式的角色扮演符号，与胶囊 / 设置页现有的 🎭 记忆点一致。
- **后一张卡**：暗示卡组 / 多卡共存（人物关系分组与共享世界书）。
- **琥珀火花**：创作与「工坊」，也是唯一暖色点，保证缩到 16px 时仍有第二识别点。

色彩直接取自插件现有 UI 的主色，没有引入新色板：

| Token | 值 | 用途 |
| --- | --- | --- |
| 主紫 | `#7c5cff` | 品牌主色（客户端里出现 24 次） |
| 深紫 | `#3b2a86` | 面具线条与眼洞 |
| 渐变紫 | `#6b4cff → #b9a6ff` | 图标底色 |
| 火花 | `#ffe0a3 → #ffb347` | 创作火花 |
| 警示红 | `#e05555` | 不用于品牌图形（仅 UI 破坏性动作） |

## 文件

| 文件 | 用途 |
| --- | --- |
| `logo-a-card-mask.svg` | **主方案**（带底，App 图标形态）；PNG 由它导出 |
| `logo-a-mark.svg` | 主方案的**透明底 mark**（白卡 + 紫细描边，深浅背景都能用） |
| `logo-b-capsule.svg` | 备选 B：胶囊里展开卡牌（强调「点开胶囊就是工坊」） |
| `logo-c-badge.svg` | 备选 C：六边形工坊徽章（深色底，适合货架） |
| `favicon.ico` | 16 / 32 / 48 三档 |
| `png/logo-{512,256,128,64,32,16}.png` | 带底图标多尺寸 |
| `png/mark-{512,256,128,64,32,16}.png` | 透明底 mark 多尺寸 |
| `png/compare.png` | 三方案对比图 |
| `png/preview.png` | 深浅背景与缩略尺寸预览 |

## 重新生成

```bash
# 1) 起本地静态服务器（playwright 禁止 file://，所以走 http）
node assets/branding/_tools/render-server.mjs assets/branding 58330

# 2) 用 playwright 打开并截图 render-a.html（512×512，omitBackground 视需要）
#    透明底 mark 用 render-mark.html + page.screenshot({ omitBackground: true })

# 3) 从 512 源图生成其余尺寸与 favicon
python assets/branding/_tools/make-png.py
```

## 接入建议（尚未改动，按需取用）

- **GitHub 社交预览图**：用 `png/logo-512.png` 上传到仓库 Settings → Social preview。
- **README 顶部**：可直接引用 `mark-256.png`；注意 README 会随 npm 页面渲染，若希望 npm 上也能显示，需要把 `assets` 加进 `files`（会改变发布清单与体积，需另行决定）。
- **插件界面**：设置页标题与胶囊文案目前用 🎭 emoji；换成图形需要内联 SVG 或客户端资源加载机制，属独立改动。
