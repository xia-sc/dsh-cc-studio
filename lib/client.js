/**
 * @dsh-plugins/dsh-cc-studio — browser half
 * 融合形态：dock 胶囊常驻（默认收起）+ 点击展开为 overlay 工坊（侧边按需展开/全屏沉浸）
 * 直接手写 bundle，无构建步骤，仅 require seed 词 react / cordis 等
 */
window.__ModuleLoader__.load({
  id: "@dsh-plugins/dsh-cc-studio",
  factory: (require) => {
    var module={exports:{}}; var exports=module.exports;
    Object.defineProperty(exports, Symbol.toStringTag,{value:"Module"});
    var React=require("react");
    var name="dsh-cc-studio";
    var inject=["slots","connection","locale"];
    var NS="dshCcStudio";
    var zh={
      "capsule.open":"🎭 角色卡工坊",
      "capsule.exported":"已导出",
      "capsule.draft":"草稿",
      "capsule.expanded":"已展开",
      "capsule.collapseHint":"点击展开",
      "preset.ccLabel":"CC 模式",
      "panel.title":"角色卡工坊",
      "panel.subtitle":"CCv3 · 从点子到可导入卡",
      "panel.badge":"dsh-cc-studio · 融合",
      "step.world":"5维世界观",
      "step.char":"角色细化",
      "step.lore":"世界书",
      "step.export":"校验导出",
      "step.world.desc":"年表/势力/地理/力量/日常",
      "step.char.desc":"六件套 + 开场",
      "step.lore.desc":"Lorebook + Decorator",
      "step.export.desc":"校验导出",
      "action.expand":"✦ AI 扩写",
      "action.validate":"校验",
      "action.export":"⬇ 导出 JSON",
      "action.exportJson":"⬇ JSON",
      "action.exportPng":"⬇ PNG",
      "action.embedPng":"⬆ 写入 PNG",
      "action.exportCharx":"⬇ CHARX",
      "action.generating":"生成中…",
      "action.writing":"写入中…",
      "action.validating":"校验中…",
      "action.close":"收起",
      "action.backToSide":"返回胶囊",
      "action.refresh":"刷新",
      "action.clear":"清空",
      "action.nextChar":"下一步 → 角色细化",
      "action.addEntry":"+ 新增条目",
      "action.done":"完成",
      "action.cancel":"取消",
      "action.closeX":"× 关闭",
      "hint.capsule":"CC 模式下自动出现；风格标签已支持自定义输入，回车添加",
      "hint.pollOff":"已关闭：CC 模式下不再自动拉取，胶囊需手动进工坊才同步。",
      "hint.pollOn":"每 {n} 秒拉取一次草稿，LLM 写入后胶囊自动同步。可设 0 关闭。",
      "settings.title":"角色卡工坊",
      "settings.desc":"CCv3 角色卡 + Lorebook Decorator + CBS 辅助，融合形态：胶囊常驻，侧边按需展开，全屏沉浸编辑。支持 JSON/PNG(tEXt ccv3)/CHARX(ZIP) 导入导出。",
      "settings.status.title":"当前状态",
      "settings.status.count":"已存角色：",
      "settings.status.suffix":"个",
      "settings.status.path":"（落盘 ~/.dsh/cc-library）",
      "settings.status.hint":"CC 模式：切换到 CC 预设后，输入框上方出现胶囊，点开即是融合工坊（五维/角色/世界书/导出 + 已存侧栏 + 实时预览）。",
      "settings.status.prototype":"原型对比：",
      "settings.status.spec":"规范：",
      "settings.status.impExp":"导入/导出：JSON / PNG(tEXt ccv3) / CHARX(ZIP card.json)，侧边栏 ★ 保存/载入/导出/删除。",
      "settings.status.refresh":"刷新已存列表",
      "settings.behavior.title":"工坊默认行为（本地保存）",
      "settings.behavior.pollTitle":"CC 模式心跳同步",
      "settings.behavior.interval":"间隔",
      "settings.behavior.seconds":"秒",
      "settings.behavior.reset":"重置 4s",
      "settings.behavior.autoValidate":"导入后自动校验",
      "settings.behavior.autoValidateDesc":"导入 JSON 后自动调 validate 刷新右上角 通过/未通过 徽标。",
      "settings.behavior.autoSave":"导入后自动 ★ 保存",
      "settings.behavior.autoSaveDesc":"导入后自动落盘到 ~/.dsh/cc-library（新建 ID），省去再点保存。",
      "settings.behavior.storageHint":"存储键 localStorage:dsh-cc-studio-settings，切预设/会话间共享。",
      "settings.tips.title":"使用提示",
      "settings.tips.body":"1. 切换 CC 模式 → 2. 让 LLM 按 6 步走（角色→五维→世界书≥5→问候语→validate）→ 3. 在工坊校验/导出或侧边栏保存。",
      "settings.language.title":"语言 / Language",
      "settings.language.desc":"跟随系统语言，或在此手动切换（立即生效，持久化到设置）。",
      "settings.language.zh":"中文",
      "settings.language.en":"English",
      "settings.language.followSystem":"跟随系统",
      "workshop.char.sixTitle":"角色细化 — 六件套",
      "workshop.char.openingTitle":"开场与示例",
      "workshop.world.title":"世界观 5维（Q2-B 深度问卷）",
      "workshop.world.hint":"每维填 1-2 句即可，CC 模式下 LLM 会通过工具引导你补全，并自动生成带 @@decorator 的 Lorebook。点击卡片预览可展开大框，适合长文编辑。",
      "workshop.world.empty":"（空）点击右上“展开编辑”填写，支持多行长文",
      "workshop.world.previewHint":"预览（点击卡片或按钮展开大框编辑）",
      "workshop.world.edit":"⛶ 编辑",
      "workshop.world.fill":"＋ 填写",
      "workshop.world.timeline":"① 年表 Timeline",
      "workshop.world.factions":"② 势力 Factions",
      "workshop.world.geo":"③ 地理 Geography",
      "workshop.world.power":"④ 力量 Power",
      "workshop.world.daily":"⑤ 日常 Daily",
      "workshop.world.detailTitle":"大框编辑",
      "workshop.world.chars":"{n}字",
      "workshop.world.charsHint":"{n} 字｜失焦自动保存，关闭即生效",
      "workshop.world.placeholder":"在此粘贴或撰写长文，实时同步到草稿…",
      "workshop.lore.title":"世界书 Lorebook",
      "workshop.lore.empty":"还没有条目",
      "workshop.lore.addHint":"CC 模式下由 LLM 通过工具自动添加",
      "workshop.lore.enabled":"enabled",
      "workshop.lore.delete":"删除",
      "workshop.lore.constant":"constant",
      "workshop.export.title":"校验与导出 — JSON / PNG / CHARX",
      "workshop.export.passed":"✓ 校验通过",
      "workshop.export.failed":"✗ 校验未通过",
      "workshop.export.hint":"PNG=tEXt ccv3 · CHARX=ZIP card.json",
      "workshop.export.hint2":"⬇ PNG=1x1底图 · ⬆ 写入=选本地PNG写入ccv3 · CHARX=ZIP",
      "workshop.export.creatorNotes":"creator_notes / 多语言",
      "workshop.export.creationDate":"creation_date",
      "workshop.export.modificationDate":"modification_date（导出自动刷新）",
      "workshop.draft.fresh":"⚠️ 当前会话是全新空白草稿（无历史存档，可能是 host 重启后的新会话）。在工坊或对话中继续编辑前，请确认这是预期中的新建；如需继续旧卡请去右侧“已存角色”载入。",
      "workshop.draft.recovered":"已从磁盘自动恢复草稿（host 重启后恢复），creation_date={date}。可继续编辑，下次写入后此提示消失。",
      "workshop.preview.title":"实时 CCv3 预览",
      "workshop.preview.cbsTitle":"CBS 速查",
      "workshop.preview.cbsHint":"大小写不敏感，逗号用 \\, 转义。",
      "workshop.preview.fusionTitle":"融合说明",
      "workshop.preview.fusionDesc":"默认只占一行胶囊；点开为全屏工坊，左侧导航可收起为图标，右侧实时预览常驻。后续可加“侧边抽屉”半屏态。",
      "workshop.library.title":"已存角色",
      "workshop.library.collapsed":"已存 {n}",
      "workshop.library.loaded":"已载入 ID:{id} · 再次保存将更新此卡",
      "workshop.library.notLoaded":"未载入（保存将新建 ID）",
      "workshop.library.import":"⬆ 导入 JSON/PNG/CHARX",
      "workshop.library.importHint":"支持 .json/.png/.charx · 导入后 ★ 保存",
      "workshop.library.update":"↻ 更新",
      "workshop.library.save":"★ 保存当前",
      "workshop.library.saveAs":"＋ 另存为新",
      "workshop.library.rename":"✎ 重命名",
      "workshop.library.new":"＋ 新建",
      "workshop.library.searchPlaceholder":"搜索 名称/标签…",
      "workshop.library.empty":"还没有已存角色\n去“世界观/角色细化”填好后点“保存当前”",
      "workshop.library.noMatch":"无匹配",
      "workshop.library.load":"载入",
      "workshop.library.export":"导出",
      "workshop.library.delete":"删除",
      "workshop.library.unnamed":"未命名",
      "workshop.edit.large":"大框编辑",
      "workshop.edit.charsSync":"{n} 字｜输入即同步",
      "workshop.edit.placeholder":"在此编辑长文…",
      "common.spec":"spec: chara_card_v3",
      "common.passed":"✓ 通过",
      "common.failed":"✗ 未通过",
      "common.loreCount":"{n} lore",
      "common.entries":"{n} 条",
      "common.assets":"assets: {n}",
      "common.groupGreetings":"group_only_greetings: {n} 条",
      "common.delete":"删除",
      "common.unknownError":"未知错误",
      "store.validatePassed":"校验通过",
      "store.validateFailed":"校验未通过",
      "store.importedOk":"已导入 {k}：{name} · {n} lore（可在侧边栏 ★ 保存）",
      "store.importedSaved":"已导入并自动保存：{name}",
      "store.errNotCcJson":"不是合法的 CCv3 JSON（缺少 spec）",
      "store.errSpecMismatch":"spec 需为 chara_card_v3，当前为 {v}",
      "store.errNoData":"缺少 data",
      "store.errImportFailed":"导入失败：{msg}",
      "store.errReadFileFailed":"读取文件失败",
      "store.parsingPng":"正在解析 PNG…",
      "store.errPngImportFailed":"PNG 导入失败：{msg}",
      "store.errReadPngFailed":"读取 PNG 失败",
      "store.parsingCharx":"正在解析 CHARX…",
      "store.errCharxImportFailed":"CHARX 导入失败：{msg}",
      "store.errReadCharxFailed":"读取 CHARX 失败",
      "store.exportedJson":"已导出 JSON",
      "store.generatingPng":"正在生成 PNG…",
      "store.exportedPng":"已导出 PNG：{name}",
      "store.errPngExportFailed":"PNG 导出失败：{msg}",
      "store.errImageTooLarge":"图片过大（>12MB）",
      "store.writingPng":"正在写入 PNG：{name}…",
      "store.wrotePng":"已写入 PNG：{name}（已替换旧 ccv3 块）",
      "store.errWritePngFailed":"写入 PNG 失败：{msg}",
      "store.errReadImageFailedWith":"读取图片失败：{msg}",
      "store.errReadImageFailed":"读取图片失败",
      "store.generatingCharx":"正在生成 CHARX…",
      "store.exportedCharx":"已导出 CHARX：{name}",
      "store.errCharxExportFailed":"CHARX 导出失败：{msg}",
      "store.errRollbackFailed":"回滚失败：{msg}",
      "store.newEntryName":"新条目",
      "store.newEntryKey":"关键词",
      "store.newEntryContent":"@@position personality\n新 lore 内容…",
      "store.needName":"请先填写角色名（name）再保存",
      "store.updated":"已更新：{name}",
      "store.savedToSidebar":"已保存到侧边栏：{name}",
      "store.errSaveFailed":"保存失败",
      "store.savedAsNew":"已另存为新卡：{name}",
      "store.errSaveAsFailed":"另存失败",
      "store.switchedNew":"已切换为新卡（保存将新建）",
      "store.loadedCard":"已载入：{name} · {n} lore（ID:{id}，再次保存将更新此卡）",
      "store.errLoadFailed":"载入失败",
      "store.confirmDelete":"确定删除该角色？此操作不可撤销。",
      "store.deleted":"已删除",
      "store.errDeleteFailed":"删除失败",
      "store.needLoadFirst":"请先载入一张卡后再重命名",
      "store.promptRename":"输入新名称",
      "store.renamed":"已重命名为：{name}",
      "store.errRenameFailed":"重命名失败",
      "store.exported":"已导出：{name}",
      "store.errExportFailed":"导出失败",
      "store.saving":"更新中…",
      "store.savingNew":"另存中…",
      "workshop.greeting.entryLabel":"{title} · 第 {n} 条",
      "workshop.greeting.add":"＋ 新增一条",
      "workshop.greeting.atMax":"已达 {max} 条上限",
      "workshop.greeting.empty":"（暂无，点「＋ 新增一条」）",
      "workshop.greeting.altTitle":"alternate_greetings",
      "workshop.greeting.altHint":"建议 ≥2 条",
      "workshop.greeting.groupTitle":"group_only_greetings *必填",
      "workshop.greeting.groupHint":"建议 ≥1 条",
      "workshop.field.nickname":"nickname（{{char}} 用）",
      "workshop.field.tags":"tags（逗号分隔）",
      "workshop.field.mesExample":"mes_example（{{user}}/{{char}}）",
      "workshop.edit.title":"{title} · 大框编辑",
      "workshop.edit.fallbackTitle":"编辑",
      "workshop.library.expand":"展开已存角色",
      "workshop.library.saveTip":"保存当前草稿（{name}）",
      "workshop.library.noCcHint":"切换到 CC 模式让 LLM 引导填充",
      "workshop.preview.cbsComment":"{{// 注释}}"
    };
    var en={
      "capsule.open":"Character Card Studio",
      "capsule.exported":"exported",
      "capsule.draft":"draft",
      "capsule.expanded":"expanded",
      "capsule.collapseHint":"Click to expand",
      "preset.ccLabel":"CC 模式",
      "panel.title":"Character Card Studio",
      "panel.subtitle":"CCv3 · Idea to Importable Card",
      "panel.badge":"dsh-cc-studio · fusion",
      "step.world":"World 5D",
      "step.char":"Character",
      "step.lore":"Lorebook",
      "step.export":"Validate & Export",
      "step.world.desc":"Timeline/Factions/Geo/Power/Daily",
      "step.char.desc":"6-piece + Openings",
      "step.lore.desc":"Lorebook + Decorator",
      "step.export.desc":"Validate & Export",
      "action.expand":"AI Expand",
      "action.validate":"Validate",
      "action.export":"Export JSON",
      "action.exportJson":"⬇ JSON",
      "action.exportPng":"⬇ PNG",
      "action.embedPng":"⬆ Embed into PNG",
      "action.exportCharx":"⬇ CHARX",
      "action.generating":"Generating…",
      "action.writing":"Writing…",
      "action.validating":"Validating…",
      "action.close":"Collapse",
      "action.backToSide":"Back",
      "action.refresh":"Refresh",
      "action.clear":"Clear",
      "action.nextChar":"Next → Character",
      "action.addEntry":"+ Add Entry",
      "action.done":"Done",
      "action.cancel":"Cancel",
      "action.closeX":"× Close",
      "hint.capsule":"Capsule lives above composer; click to open full workshop.",
      "hint.pollOff":"Off: no auto-pull in CC mode, open workshop to sync.",
      "hint.pollOn":"Pull every {n}s in CC mode, auto-sync after LLM writes. 0 to disable.",
      "settings.title":"Character Card Studio",
      "settings.desc":"CCv3 workshop: 5D worldbuilding → Lorebook Decorators → CBS. Capsule + drawer + fullscreen fusion. JSON/PNG(tEXt ccv3)/CHARX(ZIP) import & export.",
      "settings.status.title":"Status",
      "settings.status.count":"Saved characters: ",
      "settings.status.suffix":"",
      "settings.status.path":" (stored in ~/.dsh/cc-library)",
      "settings.status.hint":"CC Mode: switch to CC preset, capsule appears above composer; open to get fusion workshop (5D/Character/Lorebook/Export + sidebar + preview).",
      "settings.status.prototype":"Prototypes: ",
      "settings.status.spec":"Spec: ",
      "settings.status.impExp":"Import/Export: JSON / PNG(tEXt ccv3) / CHARX(ZIP card.json), sidebar ★ Save/Load/Export/Delete.",
      "settings.status.refresh":"Refresh saved list",
      "settings.behavior.title":"Workshop defaults (local)",
      "settings.behavior.pollTitle":"CC heartbeat sync",
      "settings.behavior.interval":"Interval",
      "settings.behavior.seconds":"s",
      "settings.behavior.reset":"Reset 4s",
      "settings.behavior.autoValidate":"Auto-validate on import",
      "settings.behavior.autoValidateDesc":"Auto run validate after JSON import to refresh pass/fail badge.",
      "settings.behavior.autoSave":"Auto ★ save on import",
      "settings.behavior.autoSaveDesc":"Auto save imported card to ~/.dsh/cc-library (new ID), skip manual save.",
      "settings.behavior.storageHint":"Key: localStorage:dsh-cc-studio-settings, shared across presets/sessions.",
      "settings.tips.title":"Tips",
      "settings.tips.body":"1. Switch to CC Mode → 2. Let LLM guide 6 steps (Character→5D→Lorebook≥5→Greetings→validate) → 3. Validate/export or ★ save in sidebar.",
      "settings.language.title":"Language / 语言",
      "settings.language.desc":"Follow system or switch manually (applies instantly, persisted).",
      "settings.language.zh":"中文",
      "settings.language.en":"English",
      "settings.language.followSystem":"Follow system",
      "workshop.char.sixTitle":"Character — 6-piece",
      "workshop.char.openingTitle":"Openings & Examples",
      "workshop.world.title":"Worldbuilding 5D (Q2-B Deep Dive)",
      "workshop.world.hint":"1–2 sentences per dimension is enough; LLM guides completion and auto-generates Lorebook with @@decorator. Click preview to edit in large modal.",
      "workshop.world.empty":"(empty) Click Edit to fill, multi-line supported",
      "workshop.world.previewHint":"Preview (click card or button for large editor)",
      "workshop.world.edit":"⛶ Edit",
      "workshop.world.fill":"＋ Fill",
      "workshop.world.timeline":"① Timeline",
      "workshop.world.factions":"② Factions",
      "workshop.world.geo":"③ Geography",
      "workshop.world.power":"④ Power",
      "workshop.world.daily":"⑤ Daily",
      "workshop.world.detailTitle":"Large Editor",
      "workshop.world.chars":"{n} chars",
      "workshop.world.charsHint":"{n} chars — auto-save on blur, close to apply",
      "workshop.world.placeholder":"Paste or write long text here, syncs to draft…",
      "workshop.lore.title":"Lorebook",
      "workshop.lore.empty":"No entries yet",
      "workshop.lore.addHint":"In CC Mode LLM adds entries via tools",
      "workshop.lore.enabled":"enabled",
      "workshop.lore.delete":"Delete",
      "workshop.lore.constant":"constant",
      "workshop.export.title":"Validate & Export — JSON / PNG / CHARX",
      "workshop.export.passed":"✓ Passed",
      "workshop.export.failed":"✗ Failed",
      "workshop.export.hint":"PNG=tEXt ccv3 · CHARX=ZIP card.json",
      "workshop.export.hint2":"⬇ PNG=1×1 placeholder · ⬆ Embed=write into your PNG · CHARX=ZIP",
      "workshop.export.creatorNotes":"creator_notes / i18n",
      "workshop.export.creationDate":"creation_date",
      "workshop.export.modificationDate":"modification_date (auto on export)",
      "workshop.draft.fresh":"⚠️ This session has a fresh blank draft (no saved history, possibly a new session after host restart). Please confirm this is an intended new card before editing; to continue an old card, load it from Saved Characters on the right.",
      "workshop.draft.recovered":"Draft auto-restored from disk (after host restart), creation_date={date}. Keep editing; this notice clears after the next write.",
      "workshop.preview.title":"Live CCv3 Preview",
      "workshop.preview.cbsTitle":"CBS Cheatsheet",
      "workshop.preview.cbsHint":"Case-insensitive, escape comma with \\,.",
      "workshop.preview.fusionTitle":"Fusion",
      "workshop.preview.fusionDesc":"One-line capsule by default; click for fullscreen workshop, left nav collapsible, right preview sticky. Drawer half-screen later.",
      "workshop.library.title":"Saved Characters",
      "workshop.library.collapsed":"Saved {n}",
      "workshop.library.loaded":"Loaded ID:{id} · save will update",
      "workshop.library.notLoaded":"Not loaded (save will create new ID)",
      "workshop.library.import":"⬆ Import JSON/PNG/CHARX",
      "workshop.library.importHint":"Supports .json/.png/.charx · ★ Save after import",
      "workshop.library.update":"↻ Update",
      "workshop.library.save":"★ Save Current",
      "workshop.library.saveAs":"＋ Save as New",
      "workshop.library.rename":"✎ Rename",
      "workshop.library.new":"＋ New",
      "workshop.library.searchPlaceholder":"Search name/tags…",
      "workshop.library.empty":"No saved characters\nFill World/Character then ★ Save Current",
      "workshop.library.noMatch":"No matches",
      "workshop.library.load":"Load",
      "workshop.library.export":"Export",
      "workshop.library.delete":"Delete",
      "workshop.library.unnamed":"Unnamed",
      "workshop.edit.large":"Large Editor",
      "workshop.edit.charsSync":"{n} chars — syncs as you type",
      "workshop.edit.placeholder":"Edit long text here…",
      "common.spec":"spec: chara_card_v3",
      "common.passed":"✓ Pass",
      "common.failed":"✗ Fail",
      "common.loreCount":"{n} lore",
      "common.entries":"{n} entries",
      "common.assets":"assets: {n}",
      "common.groupGreetings":"group_only_greetings: {n}",
      "common.delete":"Delete",
      "common.unknownError":"unknown error",
      "store.validatePassed":"Validation passed",
      "store.validateFailed":"Validation failed",
      "store.importedOk":"Imported {k}: {name} · {n} lore (★ Save in the sidebar)",
      "store.importedSaved":"Imported and auto-saved: {name}",
      "store.errNotCcJson":"Not a valid CCv3 JSON (missing spec)",
      "store.errSpecMismatch":"spec must be chara_card_v3, got {v}",
      "store.errNoData":"missing data",
      "store.errImportFailed":"Import failed: {msg}",
      "store.errReadFileFailed":"Failed to read the file",
      "store.parsingPng":"Parsing PNG…",
      "store.errPngImportFailed":"PNG import failed: {msg}",
      "store.errReadPngFailed":"Failed to read the PNG",
      "store.parsingCharx":"Parsing CHARX…",
      "store.errCharxImportFailed":"CHARX import failed: {msg}",
      "store.errReadCharxFailed":"Failed to read the CHARX",
      "store.exportedJson":"Exported JSON",
      "store.generatingPng":"Generating PNG…",
      "store.exportedPng":"Exported PNG: {name}",
      "store.errPngExportFailed":"PNG export failed: {msg}",
      "store.errImageTooLarge":"Image too large (>12MB)",
      "store.writingPng":"Writing PNG: {name}…",
      "store.wrotePng":"Wrote PNG: {name} (replaced the old ccv3 chunk)",
      "store.errWritePngFailed":"Failed to write PNG: {msg}",
      "store.errReadImageFailedWith":"Failed to read the image: {msg}",
      "store.errReadImageFailed":"Failed to read the image",
      "store.generatingCharx":"Generating CHARX…",
      "store.exportedCharx":"Exported CHARX: {name}",
      "store.errCharxExportFailed":"CHARX export failed: {msg}",
      "store.errRollbackFailed":"Rollback failed: {msg}",
      "store.newEntryName":"New entry",
      "store.newEntryKey":"keyword",
      "store.newEntryContent":"@@position personality\nNew lore content…",
      "store.needName":"Fill in the character name first",
      "store.updated":"Updated: {name}",
      "store.savedToSidebar":"Saved to sidebar: {name}",
      "store.errSaveFailed":"Save failed",
      "store.savedAsNew":"Saved as a new card: {name}",
      "store.errSaveAsFailed":"Save-as failed",
      "store.switchedNew":"Switched to a new card (saving will create one)",
      "store.loadedCard":"Loaded: {name} · {n} lore (ID:{id}, saving again will update this card)",
      "store.errLoadFailed":"Load failed",
      "store.confirmDelete":"Delete this character? This cannot be undone.",
      "store.deleted":"Deleted",
      "store.errDeleteFailed":"Delete failed",
      "store.needLoadFirst":"Load a card before renaming",
      "store.promptRename":"Enter a new name",
      "store.renamed":"Renamed to: {name}",
      "store.errRenameFailed":"Rename failed",
      "store.exported":"Exported: {name}",
      "store.errExportFailed":"Export failed",
      "store.saving":"Updating…",
      "store.savingNew":"Saving as new…",
      "workshop.greeting.entryLabel":"{title} · #{n}",
      "workshop.greeting.add":"＋ Add one",
      "workshop.greeting.atMax":"Limit of {max} reached",
      "workshop.greeting.empty":"(none yet — click “＋ Add one”)",
      "workshop.greeting.altTitle":"alternate_greetings",
      "workshop.greeting.altHint":"≥2 recommended",
      "workshop.greeting.groupTitle":"group_only_greetings *required",
      "workshop.greeting.groupHint":"≥1 recommended",
      "workshop.field.nickname":"nickname (used by {{char}})",
      "workshop.field.tags":"tags (comma separated)",
      "workshop.field.mesExample":"mes_example ({{user}}/{{char}})",
      "workshop.edit.title":"{title} · Large editor",
      "workshop.edit.fallbackTitle":"Edit",
      "workshop.library.expand":"Expand saved characters",
      "workshop.library.saveTip":"Save current draft ({name})",
      "workshop.library.noCcHint":"Switch to CC Mode and let the LLM guide you",
      "workshop.preview.cbsComment":"{{// comment}}"
    };
    function h(type,props){ var c=Array.prototype.slice.call(arguments,2); return React.createElement.apply(React,[type,props].concat(c)); }

    function nowSec(){ return Math.floor(Date.now()/1000); }
    function makeDraft(){
      return {
        spec:"chara_card_v3", spec_version:"3.0",
        data:{
          name:"", nickname:"", tags:[], creator:"", character_version:"0.1",
          description:"", personality:"", scenario:"",
          system_prompt:"", post_history_instructions:"",
          first_mes:"", alternate_greetings:[], group_only_greetings:[],
          mes_example:"", creator_notes:"", creator_notes_multilingual:{}, source:[], assets:[{type:"icon", uri:"ccdefault:", name:"main", ext:"png"}],
          creation_date: nowSec(), modification_date: nowSec(),
          character_book:{ name:"", description:"", scan_depth:4, token_budget:1200, recursive_scanning:false, extensions:{}, entries:[] }
        }
      };
    }

    // 问候语数组按「一条 = 一个 textarea」编辑，**不做任何「每行一条」序列化**：
    // 序列化会把元素内部的换行拆成多条（导入的多段问候语一编辑就损坏，且能通过校验静默导出），
    // 所以这里只提供纯数组访问器，读写都保持元素原文，不做 join/split。
    const GREETING_MAX=10;
    function setGreetingAt(arr, i, v){ var out=Array.isArray(arr)?arr.slice():[]; if(i>=0 && i<out.length) out[i]=String(v==null? "": v); return out; }
    function removeGreetingAt(arr, i){ var out=Array.isArray(arr)?arr.slice():[]; if(i>=0 && i<out.length) out.splice(i,1); return out; }
    function appendGreeting(arr){ var out=Array.isArray(arr)?arr.slice():[]; if(out.length>=GREETING_MAX) return out; out.push(""); return out; }

    function createStore(ctx){
      var draft=makeDraft();
      // store 层也需要取词（lastMsg 状态文案）。ctx.locale.bind(NS) 返回的函数在**调用时**才读当前语言，
      // 因此这里捕获一次即可随语言切换生效；locale 缺失时回退到内置词表，保证 store 不会因取词失败而崩。
      var t=(function(){
        try{ var f=ctx.locale.bind(NS); return function(k,p){ return f(k,p); }; }
        catch(e){ return function(k){ return zh[k]!==undefined? zh[k] : (en[k]!==undefined? en[k] : k); }; }
      })();
      function loadSettings(){
        try{
          var s=JSON.parse(localStorage.getItem("dsh-cc-studio-settings")||"null");
          if(s && typeof s==="object") return {
            poll: s.poll!==false,
            pollInterval: typeof s.pollInterval==="number" ? Math.max(0, Math.min(30, Math.round(s.pollInterval))) : 4,
            autoValidate: s.autoValidate!==false,
            autoSaveOnImport: !!s.autoSaveOnImport
          };
        }catch(e){}
        return { poll:true, pollInterval:4, autoValidate:true, autoSaveOnImport:false };
      }
      var _saved = loadSettings();
      // 兼容旧开关：poll=false 视为 0 秒
      if(_saved.poll===false) _saved.pollInterval = 0;
      var state={ draft: draft, draftStatus: null, cur:0, panelOpen:false, sideExpanded:false, isCcMode:false, currentSessionId:null, world:{ timeline:"", factions:"", geo:"", power:"", daily:"" }, busy:null, valid:{valid:true,errors:[],warnings:[]}, lastMsg:null, library:[], libraryQuery:"", libraryCollapsed:false, libraryBusy:null, currentLibraryId:null, editingWorld:null, editingWorldRevert:null, editingText:null, pollEnabled:_saved.poll, pollInterval:_saved.pollInterval, autoValidate:_saved.autoValidate, autoSaveOnImport:_saved.autoSaveOnImport };
      var listeners=new Set();
      function emit(){ listeners.forEach(function(fn){ try{fn();}catch(e){console.error(e);} }); }
      function getSnapshot(){ return state; }
      function subscribe(fn){ listeners.add(fn); return function(){ listeners.delete(fn); }; }
      function set(up){ state=Object.assign({}, state, up); emit(); }
      function setCur(i){ set({cur:i}); }
      function setPanel(o){ set({panelOpen: !!o}); }
      function setSideExpanded(v){ set({sideExpanded: !!v}); }
      // 原 trigger()/triggered 已删除：trigger() 无任何调用点；而 triggered 的唯一写入者是 setIsCcMode，
      // 写值恒等于 isCcMode，因此渲染条件里的 !s.triggered 是冗余项（删除前后行为完全一致）。
      function setIsCcMode(v){ var on=!!v; if(on!==state.isCcMode) set({isCcMode: on}); }
      function setDraftFromHost(draft, status){ try{ var j=JSON.stringify(draft); var curJ=JSON.stringify(state.draft); var stJ=JSON.stringify(status||null); var curStJ=JSON.stringify(state.draftStatus||null); if(stJ!==curStJ) set({draftStatus: status||null}); if(j!==curJ){ var w=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(w && typeof w==="object"){ var nw={ timeline:String(w.timeline||""), factions:String(w.factions||""), geo:String(w.geo||""), power:String(w.power||""), daily:String(w.daily||"") }; var curW=state.world; if(JSON.stringify(nw)!==JSON.stringify(curW)) set({draft: draft, world: nw}); else set({draft: draft}); } else set({draft: draft}); } }catch(e){ try{ var ww=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(ww){ var nn={ timeline:String(ww.timeline||""), factions:String(ww.factions||""), geo:String(ww.geo||""), power:String(ww.power||""), daily:String(ww.daily||"") }; set({draft: draft, world: nn}); } else set({draft: draft}); }catch(e2){ set({draft: draft}); } } }
      function setSessionId(id){ if(id) set({currentSessionId: String(id)}); }
      function saveSettings(){
        try{ localStorage.setItem("dsh-cc-studio-settings", JSON.stringify({ poll: !!state.pollEnabled, pollInterval: Number(state.pollInterval)||0, autoValidate: !!state.autoValidate, autoSaveOnImport: !!state.autoSaveOnImport })); }catch(e){}
      }
      function setPollEnabled(v){ var on=!!v; var interval = on ? (state.pollInterval||4) : 0; if(!on) interval=0; if(on && interval===0) interval=4; set({pollEnabled: on, pollInterval: interval}); saveSettings(); }
      function setPollInterval(sec){ var n=Math.max(0, Math.min(30, Math.round(Number(sec)||0))); var on = n>0; set({pollInterval: n, pollEnabled: on}); saveSettings(); }
      function setAutoValidate(v){ set({autoValidate: !!v}); saveSettings(); }
      function setAutoSaveOnImport(v){ set({autoSaveOnImport: !!v}); saveSettings(); }
      function pushDraftToHost(){
        try{
          var sid = state.currentSessionId || null;
          var args = sid ? {draft: state.draft, sessionId: sid} : {draft: state.draft};
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_setDraft",{args:args}).catch(function(){});
        }catch(e){}
      }
      var _ccCheckAt = {};
      var _ccCheckInflight = {};
      async function checkIsCcMode(sessionId, force){
        try{
          var key = String(sessionId||"");
          if(!key) return;
          var now = Date.now();
          // 节流：同一会话 5s 内最多查一次（重试走 force=false，同样受限）
          if(!force && _ccCheckAt[key] && now - _ccCheckAt[key] < 5000) return;
          if(_ccCheckInflight[key]) return;
          _ccCheckInflight[key]=true;
          try{
            const res = await rpc("cc_isCcMode", {sessionId: sessionId});
            _ccCheckAt[key]=Date.now();
            if(res && res.ok) setIsCcMode(!!res.value.isCc);
          }finally{
            _ccCheckInflight[key]=false;
          }
        }catch(e){ try{ _ccCheckInflight[String(sessionId||"")]=false; }catch(e2){} }
      }
      function updateDraft(mut){
        var d=JSON.parse(JSON.stringify(state.draft));
        mut(d.data);
        // 无实际改动则不落盘、不推宿主、不动 modification_date：
        // 否则「打开大框 → 取消」这类空操作也会刷新修改时间并触发一次宿主写入
        if(JSON.stringify(d.data)===JSON.stringify(state.draft.data)) return;
        d.data.modification_date=nowSec();
        set({draft:d});
        setTimeout(pushDraftToHost, 120);
      }
      function rpc(endpoint, args){ return ctx.connection.rpc.call("/dsh-cc-studio-rpc", endpoint, { args: args||{} }); }
      // 注：expandIdea / expandWorld 两个 RPC 的前身由宿主侧 mock 提供，已在 67172fd 随示例数据一并删除；
      // 宿主 dispatch 无此 endpoint（会返回 unknown-endpoint），且五维/角色扩写已由 CC 预设的
      // cc_patch_world / cc_patch_character 工具承担，故此处客户端死代码一并移除。
      async function validate(){
        set({busy:"validate"});
        try{
          var res=await rpc("validate", { card: state.draft });
          if(res && res.ok){ set({busy:null, valid: res.value, lastMsg: res.value.valid? t("store.validatePassed"):t("store.validateFailed")}); }
          else set({busy:null, lastMsg: String(res.error.message)});
        }catch(e){ set({busy:null, lastMsg:String(e.message)}); }
      }
      function arrayBufferToB64(buf){
        var bytes=new Uint8Array(buf);
        var chunk=0x8000, out="";
        for(var i=0;i<bytes.length;i+=chunk){
          out+=String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
        }
        return btoa(out);
      }
      function b64ToBytes(b64){
        var bin=atob(b64);
        var bytes=new Uint8Array(bin.length);
        for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        return bytes;
      }
      function handleImportedDraft(obj, label){
        obj.spec_version=obj.spec_version||"3.0";
        obj.data.character_book=obj.data.character_book||{name:"",description:"",scan_depth:4,token_budget:1200,recursive_scanning:false,extensions:{},entries:[]};
        if(!Array.isArray(obj.data.character_book.entries)) obj.data.character_book.entries=[];
        if(!Array.isArray(obj.data.group_only_greetings)) obj.data.group_only_greetings=[];
        if(!Array.isArray(obj.data.alternate_greetings)) obj.data.alternate_greetings=[];
        if(!Array.isArray(obj.data.tags)) obj.data.tags=[];
        if(!Array.isArray(obj.data.assets)) obj.data.assets=[{type:"icon",uri:"ccdefault:",name:"main",ext:"png"}];
        setDraftFromHost(obj);
        set({currentLibraryId:null, lastMsg:t("store.importedOk",{k:label.trim(), name:(obj.data.name||t("workshop.library.unnamed")), n:(obj.data.character_book.entries.length||0)})});
        setTimeout(pushDraftToHost,80);
        if(state.autoValidate) rpc("validate",{card:obj}).then(function(r){ if(r&&r.ok) set({valid:r.value}); }).catch(function(){});
        if(state.autoSaveOnImport){
          setTimeout(function(){
            var sid=state.currentSessionId||null;
            var args={draft: obj}; if(sid) args.sessionId=sid;
            rpc("cc_saveToLibrary", args).then(function(res){ if(res&&res.ok){ set({currentLibraryId: res.value.id, lastMsg:t("store.importedSaved",{name:(res.value.meta.name||res.value.id)})}); refreshLibrary(); }}).catch(function(){});
          }, 200);
        }
      }
      function importAny(){
        try{
          var inp=document.createElement("input");
          inp.type="file"; inp.accept=".json,.png,.charx,.zip,application/json,image/png,application/zip";
          inp.onchange=function(){
            var f=inp.files && inp.files[0]; if(!f) return;
            var nameLower=String(f.name||"").toLowerCase();
            var isPng=nameLower.endsWith(".png");
            var isCharx=nameLower.endsWith(".charx") || nameLower.endsWith(".zip");
            var isJson=nameLower.endsWith(".json");
            // 兜底：按文件 type
            if(!isPng && !isCharx && !isJson){
              if(f.type==="image/png") isPng=true;
              else if(f.type==="application/zip" || f.type==="application/x-zip-compressed") isCharx=true;
              else isJson=true;
            }
            if(isJson){
              var reader=new FileReader();
              reader.onload=function(){
                try{
                  var text=String(reader.result||"");
                  var obj=JSON.parse(text);
                  if(obj && obj.draft && obj.draft.spec) obj=obj.draft;
                  if(!obj || typeof obj!=="object" || !obj.spec) throw new Error(t("store.errNotCcJson"));
                  if(obj.spec!=="chara_card_v3") throw new Error(t("store.errSpecMismatch",{v:String(obj.spec)}));
                  if(!obj.data || typeof obj.data!=="object") throw new Error(t("store.errNoData"));
                  handleImportedDraft(obj, " JSON");
                }catch(e){ set({lastMsg:t("store.errImportFailed",{msg:String(e&&e.message||e)})}); }
              };
              reader.onerror=function(){ set({lastMsg:t("store.errReadFileFailed")}); };
              reader.readAsText(f,"utf-8");
            } else if(isPng){
              var r2=new FileReader();
              r2.onload=function(){
                try{
                  var b64=arrayBufferToB64(r2.result);
                  var sid=state.currentSessionId||null;
                  var args=sid?{b64:b64, sessionId:sid}:{b64:b64};
                  set({lastMsg:t("store.parsingPng"), busy:"importPng"});
                  rpc("cc_importFromPng", args).then(function(res){
                    set({busy:null});
                    if(res && res.ok && res.value && res.value.draft){
                      handleImportedDraft(res.value.draft, " PNG");
                    } else set({lastMsg:t("store.errPngImportFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
                  }).catch(function(e){ set({busy:null, lastMsg:t("store.errPngImportFailed",{msg:String(e&&e.message||e)})}); });
                }catch(e){ set({lastMsg:t("store.errPngImportFailed",{msg:String(e&&e.message||e)})}); }
              };
              r2.onerror=function(){ set({lastMsg:t("store.errReadPngFailed")}); };
              r2.readAsArrayBuffer(f);
            } else if(isCharx){
              var r3=new FileReader();
              r3.onload=function(){
                try{
                  var b64c=arrayBufferToB64(r3.result);
                  var sid2=state.currentSessionId||null;
                  var args2=sid2?{b64:b64c, sessionId:sid2}:{b64:b64c};
                  set({lastMsg:t("store.parsingCharx"), busy:"importCharx"});
                  rpc("cc_importFromCharx", args2).then(function(res){
                    set({busy:null});
                    if(res && res.ok && res.value && res.value.draft){
                      handleImportedDraft(res.value.draft, " CHARX");
                    } else set({lastMsg:t("store.errCharxImportFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
                  }).catch(function(e){ set({busy:null, lastMsg:t("store.errCharxImportFailed",{msg:String(e&&e.message||e)})}); });
                }catch(e){ set({lastMsg:t("store.errCharxImportFailed",{msg:String(e&&e.message||e)})}); }
              };
              r3.onerror=function(){ set({lastMsg:t("store.errReadCharxFailed")}); };
              r3.readAsArrayBuffer(f);
            }
          };
          inp.click();
        }catch(e){ set({lastMsg:String(e&&e.message||e)}); }
      }
      function importJSON(){ return importAny(); }
      function exportJSON(){
        var blob=new Blob([JSON.stringify(state.draft,null,2)],{type:"application/json"});
        var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(state.draft.data.name||"card")+".json"; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
        set({lastMsg:t("store.exportedJson")});
      }
      function exportPNG(){
        var sid=state.currentSessionId||null;
        var args=sid?{sessionId:sid}:{};
        set({busy:"exportPng", lastMsg:t("store.generatingPng")});
        rpc("cc_exportPng", args).then(function(res){
          set({busy:null});
          if(res && res.ok && res.value && res.value.b64){
            try{
              var bytes=b64ToBytes(res.value.b64);
              var blob=new Blob([bytes],{type:"image/png"});
              var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=res.value.filename||((state.draft.data.name||"card")+".png"); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
              set({lastMsg:t("store.exportedPng",{name:(res.value.filename||"card.png")})});
            }catch(e){ set({lastMsg:t("store.errPngExportFailed",{msg:String(e&&e.message||e)})}); }
          } else set({lastMsg:t("store.errPngExportFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
        }).catch(function(e){ set({busy:null, lastMsg:t("store.errPngExportFailed",{msg:String(e&&e.message||e)})}); });
      }
      function embedIntoPng(){
        try{
          var inp=document.createElement("input");
          inp.type="file"; inp.accept=".png,image/png";
          inp.onchange=function(){
            var f=inp.files && inp.files[0]; if(!f) return;
            if(f.size > 12*1024*1024){ set({lastMsg:t("store.errImageTooLarge")}); return; }
            var reader=new FileReader();
            reader.onload=function(){
              try{
                var b64=arrayBufferToB64(reader.result);
                var sid=state.currentSessionId||null;
                var args=sid?{sessionId:sid, imageB64:b64}:{imageB64:b64};
                set({busy:"exportPng", lastMsg:t("store.writingPng",{name:f.name})});
                rpc("cc_exportPng", args).then(function(res){
                  set({busy:null});
                  if(res && res.ok && res.value && res.value.b64){
                    try{
                      var bytes=b64ToBytes(res.value.b64);
                      var blob=new Blob([bytes],{type:"image/png"});
                      var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=res.value.filename||((state.draft.data.name||"card")+".png"); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
                      set({lastMsg:t("store.wrotePng",{name:(res.value.filename||f.name)})});
                    }catch(e){ set({lastMsg:t("store.errWritePngFailed",{msg:String(e&&e.message||e)})}); }
                  } else set({lastMsg:t("store.errWritePngFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
                }).catch(function(e){ set({busy:null, lastMsg:t("store.errWritePngFailed",{msg:String(e&&e.message||e)})}); });
              }catch(e){ set({lastMsg:t("store.errReadImageFailedWith",{msg:String(e&&e.message||e)})}); }
            };
            reader.onerror=function(){ set({lastMsg:t("store.errReadImageFailed")}); };
            reader.readAsArrayBuffer(f);
          };
          inp.click();
        }catch(e){ set({lastMsg:String(e&&e.message||e)}); }
      }
      function exportCharx(){
        var sid=state.currentSessionId||null;
        var args=sid?{sessionId:sid}:{};
        set({busy:"exportCharx", lastMsg:t("store.generatingCharx")});
        rpc("cc_exportCharx", args).then(function(res){
          set({busy:null});
          if(res && res.ok && res.value && res.value.b64){
            try{
              var bytes2=b64ToBytes(res.value.b64);
              var blob2=new Blob([bytes2],{type:"application/zip"});
              var a2=document.createElement("a"); a2.href=URL.createObjectURL(blob2); a2.download=res.value.filename||((state.draft.data.name||"card")+".charx"); a2.click(); setTimeout(function(){ URL.revokeObjectURL(a2.href); },800);
              set({lastMsg:t("store.exportedCharx",{name:(res.value.filename||"card.charx")})});
            }catch(e){ set({lastMsg:t("store.errCharxExportFailed",{msg:String(e&&e.message||e)})}); }
          } else set({lastMsg:t("store.errCharxExportFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
        }).catch(function(e){ set({busy:null, lastMsg:t("store.errCharxExportFailed",{msg:String(e&&e.message||e)})}); });
      }
      function setWorldPatch(k,v){ var w=Object.assign({}, state.world); w[k]=String(v); set({world:w}); updateDraft(function(d){ d.extensions=d.extensions||{}; var cw=d.extensions.cc_world||{}; cw[k]=String(v); d.extensions.cc_world=cw; }); }
      // 世界观大框：打开时记下快照，「取消」据此回滚（大框是输入即同步，没有未提交缓冲区）
      function setEditingWorld(k){
        if(!k){ set({editingWorld:null, editingWorldRevert:null}); return; }
        var snap=String(state.world[k]||"");
        set({ editingWorld:k, editingWorldRevert:function(){
          var w=Object.assign({}, state.world); w[k]=snap; set({world:w});
          updateDraft(function(d){ d.extensions=d.extensions||{}; var cw=d.extensions.cc_world||{}; cw[k]=snap; d.extensions.cc_world=cw; });
        }});
      }
      function cancelEditingWorld(){
        var revert=state.editingWorldRevert;
        set({editingWorld:null, editingWorldRevert:null});
        if(typeof revert==="function"){ try{ revert(); }catch(e){ set({lastMsg:t("store.errRollbackFailed",{msg:String(e&&e.message||e)})}); } }
      }
      function setEditingText(title, value, setter, revert){ set({editingText: {title, value, setter, revert}}); }
      function clearEditingText(){ set({editingText: null}); }
      // 「取消」= 回滚到打开时的值，而不是像「完成」那样落盘
      function cancelEditingText(){
        var et=state.editingText;
        set({editingText: null});
        if(et && typeof et.revert==="function"){ try{ et.revert(); }catch(e){ set({lastMsg:t("store.errRollbackFailed",{msg:String(e&&e.message||e)})}); } }
      }
      function updateEditingText(v){
        var et=state.editingText;
        if(!et) return;
        set({editingText: {title: et.title, value: v, setter: et.setter, revert: et.revert}});
        try{ et.setter(v); }catch(e){}
      }
      function addEntry(){
        updateDraft(function(d){
          d.character_book.entries.push({ enabled:true, insertion_order:d.character_book.entries.length, use_regex:false, constant:false, name:t("store.newEntryName"), keys:[t("store.newEntryKey")], content:t("store.newEntryContent"), priority:5, id: Date.now() });
        });
      }
      function setLibraryQuery(v){ set({libraryQuery: String(v).slice(0,40)}); }
      function toggleLibraryCollapsed(){ set({libraryCollapsed: !state.libraryCollapsed}); }
      async function refreshLibrary(){
        set({libraryBusy:"refresh"});
        try{
          var res=await rpc("cc_listLibrary", {});
          if(res && res.ok && res.value && Array.isArray(res.value.entries)) set({library: res.value.entries});
          else set({library: []});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function saveCurrentToLibrary(){
        if(!state.draft || !state.draft.data || !state.draft.data.name || !String(state.draft.data.name).trim()){
          set({lastMsg:t("store.needName")});
          return;
        }
        set({libraryBusy:"save"});
        try{
          var sid=state.currentSessionId || null;
          var isUpdate = !!state.currentLibraryId;
          var args = {draft: state.draft};
          if(sid) args.sessionId=sid;
          if(isUpdate) args.id=state.currentLibraryId;
          var res=await rpc("cc_saveToLibrary", args);
          if(res && res.ok){
            set({lastMsg:t(isUpdate?"store.updated":"store.savedToSidebar",{name:(res.value.meta.name||res.value.id)}), currentLibraryId: res.value.id});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errSaveFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function saveAsNewToLibrary(){
        if(!state.draft || !state.draft.data || !state.draft.data.name || !String(state.draft.data.name).trim()){
          set({lastMsg:t("store.needName")});
          return;
        }
        set({libraryBusy:"saveNew"});
        try{
          var sid2=state.currentSessionId || null;
          var args2 = {draft: state.draft};
          if(sid2) args2.sessionId=sid2;
          // 不带 id，强制新建
          var res=await rpc("cc_saveToLibrary", args2);
          if(res && res.ok){
            set({lastMsg:t("store.savedAsNew",{name:(res.value.meta.name||res.value.id)}), currentLibraryId: res.value.id});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errSaveAsFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      function clearCurrentLibraryId(){ set({currentLibraryId:null, lastMsg:t("store.switchedNew")}); }
      async function loadFromLibrary(id){
        if(!id) return;
        try{
          var curName=String(state.draft.data.name||"").trim();
          if(curName && state.draft.data.character_book.entries.length>0){
          }
        }catch(e){}
        set({libraryBusy:"load:"+id});
        try{
          var sid=state.currentSessionId||null;
          var args = sid ? {id:id, sessionId:sid} : {id:id};
          var res=await rpc("cc_loadFromLibrary", args);
          if(res && res.ok && res.value && res.value.draft){
            setDraftFromHost(res.value.draft);
            set({currentLibraryId: id});
            set({lastMsg:t("store.loadedCard",{name:(res.value.meta.name||id), n:(res.value.draft.data.character_book.entries.length||0), id:id.slice(0,8)})});
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errLoadFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function deleteFromLibrary(id){
        if(!id) return;
        try{
          if(typeof window!=="undefined" && window.confirm){
            var ok = window.confirm(t("store.confirmDelete"));
            if(!ok) return;
          }
        }catch(e){}
        set({libraryBusy:"delete:"+id});
        try{
          var res=await rpc("cc_deleteFromLibrary", {id:id});
          if(res && res.ok){
            if(state.currentLibraryId===id) set({currentLibraryId:null});
            set({lastMsg:t("store.deleted")});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errDeleteFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function renameCurrentInLibrary(newName){
        if(!state.currentLibraryId){ set({lastMsg:t("store.needLoadFirst")}); return; }
        var n=String(newName||"").trim();
        if(!n){ var inp=typeof window!=="undefined" ? window.prompt(t("store.promptRename"), "") : ""; if(!inp) return; n=String(inp).trim(); }
        if(!n) return;
        set({libraryBusy:"rename:"+state.currentLibraryId});
        try{
          var res=await rpc("cc_renameInLibrary", {id: state.currentLibraryId, name: n});
          if(res && res.ok){
            set({lastMsg:t("store.renamed",{name:n})});
            await refreshLibrary();
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errRenameFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      async function exportLibraryEntry(id){
        if(!id) return;
        set({libraryBusy:"export:"+id});
        try{
          var res=await rpc("cc_getLibraryEntry", {id:id});
          if(res && res.ok && res.value && res.value.draft){
            var draft=res.value.draft;
            var blob=new Blob([JSON.stringify(draft,null,2)],{type:"application/json"});
            var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(res.value.meta.name||draft.data.name||"card")+".json"; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
            set({lastMsg:t("store.exported",{name:(res.value.meta.name||id)})});
          } else set({lastMsg: res && res.error? String(res.error.message):t("store.errExportFailed")});
        }catch(e){ set({lastMsg: String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      return { getSnapshot:getSnapshot, subscribe:subscribe, setCur:setCur, setPanel:setPanel, setSideExpanded:setSideExpanded, setIsCcMode:setIsCcMode, setDraftFromHost:setDraftFromHost, setSessionId:setSessionId, checkIsCcMode:checkIsCcMode, setPollEnabled:setPollEnabled, setPollInterval:setPollInterval, setAutoValidate:setAutoValidate, setAutoSaveOnImport:setAutoSaveOnImport, updateDraft:updateDraft, validate:validate, exportJSON:exportJSON, exportPNG:exportPNG, embedIntoPng:embedIntoPng, exportCharx:exportCharx, importJSON:importJSON, importAny:importAny, setWorldPatch:setWorldPatch, setEditingWorld:setEditingWorld, cancelEditingWorld:cancelEditingWorld, setEditingText:setEditingText, clearEditingText:clearEditingText, cancelEditingText:cancelEditingText, updateEditingText:updateEditingText, addEntry:addEntry, setLibraryQuery:setLibraryQuery, toggleLibraryCollapsed:toggleLibraryCollapsed, refreshLibrary:refreshLibrary, saveCurrentToLibrary:saveCurrentToLibrary, saveAsNewToLibrary:saveAsNewToLibrary, clearCurrentLibraryId:clearCurrentLibraryId, loadFromLibrary:loadFromLibrary, deleteFromLibrary:deleteFromLibrary, exportLibraryEntry:exportLibraryEntry, renameCurrentInLibrary:renameCurrentInLibrary };
    }

    var S={
      overlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"18px", zIndex:30 },
      workshop:{ width:"min(1360px, 96vw)", height:"min(860px, 92vh)", background:"var(--dsw-alias-bg-layer-1, #fff)", border:"1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius:18, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3, 0 20px 80px rgba(0,0,0,.2))" },
      head:{ height:56, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2, #f9fafb)" },
      step:{ padding:"6px 10px", borderRadius:999, fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", background:"var(--dsw-alias-bg-layer-2)", cursor:"pointer" },
      stepActive:{ background:"#7c5cff", borderColor:"#7c5cff", color:"#fff" },
      body:{ flex:1, display:"grid", gridTemplateColumns:"220px 1fr 280px 360px", minHeight:0, background:"var(--dsw-alias-bg-base)" },
      nav:{ borderRight:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", padding:"12px", display:"flex", flexDirection:"column", gap:10 },
      navBtn:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"1px solid transparent", background:"transparent", color:"var(--dsw-alias-label-secondary)", cursor:"pointer" },
      navBtnActive:{ background:"var(--dsw-alias-bg-layer-2)", borderColor:"var(--dsw-alias-border-l2)", color:"var(--dsw-alias-label-primary)" },
      main:{ padding:"16px", overflow:"auto", minWidth:0, background:"var(--dsw-alias-bg-base)" },
      side:{ borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", padding:"12px", overflow:"auto", minWidth:0 },
      library:{ borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" },
      libraryHead:{ height:46, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", flexShrink:0 },
      libraryList:{ flex:1, overflow:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:8 },
      libraryItem:{ background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10 },
      libraryCollapsedBar:{ width:40, borderLeft:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 6px", gap:10, boxShadow:"inset 1px 0 0 var(--dsw-alias-border-l1)" },
      card:{ background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12, marginBottom:12 },
      field:{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 },
      badge:{ fontSize:11, padding:"2px 6px", borderRadius:999, border:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", color:"var(--dsw-alias-label-secondary)" },
      chip:{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", cursor:"pointer" },
      btn:{ appearance:"none", border:"1px solid transparent", background:"#7c5cff", color:"#fff", borderRadius:10, padding:"8px 14px", fontWeight:600, cursor:"pointer" },
      btnGhost:{ background:"transparent", borderColor:"var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)" },
      mono:{ fontFamily:"ui-monospace,Menlo,Consolas,monospace", fontSize:12, color:"var(--dsw-alias-label-secondary)" },
      dockWrap:{ boxSizing:"border-box", display:"flex", justifyContent:"flex-start", width:"100%", boxSizing:"border-box", maxWidth:"100%", paddingLeft:"calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)", margin:"2px 0" },
      capsule:{ display:"inline-flex", alignItems:"center", gap:8, maxWidth:360, padding:"1px 10px", borderRadius:999, border:"1px solid rgba(127,127,127,0.25)", background:"rgba(127,127,127,0.12)", color:"var(--dsw-alias-label-secondary, #c8ccd2)", fontSize:12, lineHeight:"20px", cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
      input:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 10px", fontSize:12 },
      textarea:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px" },
      label:{ fontSize:12, color:"var(--dsw-alias-label-secondary)" },
      labelStrong:{ fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" },
      subtleText:{ fontSize:11, color:"var(--dsw-alias-label-secondary)" },
      sectionTitle:{ margin:"0 0 8px", fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" }
    };

    // —— CC 模式探测（Capsule 与 Workshop 共用；此前两份各写一遍，且都读错了字段）——
    // 判定优先级：
    //   ① 会话投影 session.projectionValues.agentPreset —— 运行中会话的权威本地来源。
    //      注意字段位置！早先读 sess.preset / presetId / agentPreset / mode 全都取不到值，
    //      于是 presetOfCurrent 恒为 null、effect 依赖数组永不变化，表现为：
    //      切到 CC 模式后胶囊不出现，要等刷新页面（重新挂载）或切换会话（currentId 变）才出现。
    //   ② 预设芯片的 DOM —— 芯片是「为下一次会话选择」，此时还没有 session，store 里查不到；
    //      它是新会话页上唯一带 aria-haspopup="menu" 的可见按钮。
    //      运行中会话的预设标签渲染成 <span>，所以这种情况只能靠 ① 的会话投影。
    //   ③ 主机 RPC 确认 —— 仅在前两者无法判定时调用（带节流），并对主机未就绪做有限重试。
    var CC_PRESET_ID="cc";
    function ccPresetIdOf(sess){
      try{
        var p=sess && sess.projectionValues && sess.projectionValues.agentPreset;
        if(typeof p==="string" && p) return p;
        // 兼容其它可能的承载位置（旧/异形结构），保证不因单一字段缺失而整体失效
        if(sess){ var q=sess.preset||sess.presetId||sess.agentPreset||sess.mode; if(q) return String(q); }
      }catch(e){}
      return null;
    }
    function ccModeFromDom(ccLabel){
      try{
        if(typeof document==="undefined" || !ccLabel) return false;
        // 只认「预设芯片」：它是唯一带 aria-haspopup="menu" 的下拉触发器（dsh 源码 AgentPresetSeat
        // 渲染的 button 带该属性）。不用全量 button 扫描 —— 那会在下拉菜单展开时把菜单项里
        // 的预设名误判成「当前已选中 CC」。
        var btns=document.querySelectorAll('button[aria-haspopup="menu"]');
        for(var i=0;i<btns.length;i++){
          var b=btns[i];
          if(!b || b.offsetParent===null) continue;                      // 只看可见元素
          if(b.closest && b.closest("[data-dsh-cc-studio]")) continue;    // 排除本插件自身 UI
          if(String(b.textContent||"").indexOf(ccLabel)>=0) return true;
        }
      }catch(e){}
      return false;
    }
    /**
     * 纯决策函数（便于单测，不依赖 React/DOM）。
     * @returns true/false 为可判定结论；null 表示「未知」——保持现状，交给主机 RPC 确认。
     */
    function decideCcMode(presetId, domVerdict, hasSession, prevIsCc){
      var p = presetId ? String(presetId).toLowerCase() : "";
      if(p) return p===CC_PRESET_ID;                 // 会话投影是权威本地来源
      if(domVerdict) return true;                    // 预设芯片显示 CC
      if(!hasSession) return false;                  // 新会话页：芯片就是权威，没显示 CC 即非 CC
      // 已有会话但投影尚未到达：不确定。此时关闭会造成「选 CC → 首次对话」瞬间的胶囊闪烁，
      // 所以只有在当前并非 CC 时才返回 null，让 RPC 去确认。
      return prevIsCc ? true : null;
    }
    /**
     * 探测 CC 模式并写入 store，返回当前会话 id。
     */
    function useCcPreset(store, props, t){
      var useSessions=props.useSessions;
      var currentId = useSessions ? useSessions(function(s){ return (s && s.current) || null; }) : (props.sessionId || props.session || null);
      if(!currentId) currentId = props.sessionId || props.session || null;
      var presetId = useSessions ? useSessions(function(s){
        try{ var id=s&&s.current; return ccPresetIdOf(id && s.byId && s.byId[id]); }catch(e){ return null; }
      }) : null;
      var ccLabel=(typeof t==="function" ? t("preset.ccLabel") : "") || "";
      var evaluate=React.useCallback(function(){
        var verdict=decideCcMode(presetId, ccModeFromDom(ccLabel), !!currentId, !!store.getSnapshot().isCcMode);
        if(verdict!==null) store.setIsCcMode(verdict);
        return verdict===null ? !!store.getSnapshot().isCcMode : verdict;
      }, [store, presetId, currentId, ccLabel]);
      React.useEffect(function(){
        var isCc=evaluate();
        if(!currentId) return;
        if(isCc){ if(store._pullDraft) store._pullDraft(currentId); }
        else store.checkIsCcMode(currentId);
        // 主机侧 composedPreset 可能尚未就绪；必须 force 绕过 5s 节流，
        // 否则这次「补救重试」会被节流直接吞掉，白等一场（这正是旧的 900ms 重试失效的原因）。
        var timers=[1200,3000].map(function(ms){
          return setTimeout(function(){
            try{ if(!store.getSnapshot().isCcMode) store.checkIsCcMode(currentId, true); }catch(e){}
          }, ms);
        });
        return function(){ timers.forEach(function(x){ clearTimeout(x); }); };
      }, [currentId, presetId, evaluate]);
      // 新会话页切换芯片不会改变 current/preset（此时还没有会话），只能靠轮询 DOM 捕获。
      // 纯本地文本扫描，不打 RPC；判定结果不变时 setIsCcMode 内部不会触发重渲染。
      React.useEffect(function(){
        if(typeof setInterval!=="function") return;
        var timer=setInterval(function(){ try{ evaluate(); }catch(e){} }, 1000);
        return function(){ clearInterval(timer); };
      }, [evaluate]);
      return currentId;
    }

    function Capsule(props){
      var store=props.store; var t=props.t;
      var currentId = useCcPreset(store, props, t);
      var sRef=React.useState(function(){ return store.getSnapshot(); }); var s=sRef[0], setS=sRef[1];
      React.useEffect(function(){ return store.subscribe(function(){ setS(store.getSnapshot()); }); }, [store]);
      
      if(!s.isCcMode && !s.panelOpen) return null;
      var draft=s.draft; var loreCount=draft.data.character_book.entries.length;
      var valid=s.valid && s.valid.valid;
      // 计数文案走词表（沿用既有 replace("{n}") 插值模式，locale 的 t() 不做插值）
      var loreText=t("common.loreCount").replace("{n}", String(loreCount));
      var text=(t("capsule.open")+" · "+loreText+" · "+ (valid? t("capsule.exported"): t("capsule.draft")));
      return h("div",{style:S.dockWrap, "data-dsh-cc-studio":"dock-row"},
        h("button",{type:"button", style:S.capsule, title: t("hint.capsule"), onClick:function(){ store.setPanel(true); }},
          h("span",{style:{width:7,height:7,borderRadius:50, background: valid? "#2ee6a6":"#7c5cff", boxShadow:"0 0 8px "+(valid?"#2ee6a6":"#7c5cff"), display:"inline-block", flex:"none"}}),
          h("span",{style:{overflow:"hidden", textOverflow:"ellipsis"}}, text),
          h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:11}}, "— "+(s.panelOpen? t("capsule.expanded"): t("capsule.collapseHint")))
        ),
        h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginLeft:8}}, loreText+" · "+draft.data.name)
      );
    }

    function Workshop(props){
      var store=props.store; var t=props.t;
      var currentId = useCcPreset(store, props, t);
      var sRef=React.useState(function(){ return store.getSnapshot(); }); var s=sRef[0], setS=sRef[1];
      React.useEffect(function(){ return store.subscribe(function(){ setS(store.getSnapshot()); }); }, [store]);
      React.useEffect(function(){
        if(s.panelOpen) store.refreshLibrary();
      }, [s.panelOpen]);
      if(!s.panelOpen) return null;
      var steps=[t("step.world"), t("step.char"), t("step.lore"), t("step.export")];
      function navItem(i, title, desc){
        var active=s.cur===i;
        return h("button",{key:i, style: Object.assign({}, S.navBtn, active? S.navBtnActive:{}), onClick:function(){ store.setCur(i); }}, title, h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2}}, desc));
      }
      // 长文本字段头：标签 + ⛶ 大框编辑（原“点子”页携带的 ⛶ 能力，随该页移除后落到各长文本字段上）
      // 只服务 string 字段；数组字段（问候语）走 greetingList，不做序列化。
      function fieldHead(title, key){
        return h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}},
          h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}}, title),
          h("button",{style:Object.assign({}, S.btnGhost, {padding:"2px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}),
            onClick:function(){
              var snapshot = s.draft.data[key];   // 「取消」回滚用
              store.setEditingText(title, String(snapshot==null? "": snapshot),
                function(v){ store.updateDraft(function(d){ d[key]=v; }); },
                function(){ store.updateDraft(function(d){ d[key]=snapshot; }); });
            }}, "⛶"));
      }
      // 每条问候语一个独立 textarea：元素内部换行原样保留，不再有「每行一条」的往返。
      function greetingList(key, title, hint){
        var arr = Array.isArray(s.draft.data[key]) ? s.draft.data[key] : [];
        var atMax = arr.length >= GREETING_MAX;
        function head(i){
          var raw = arr[i];
          return h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}},
            h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}}, t("workshop.greeting.entryLabel",{title:title, n:(i+1)})),
            h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
              h("button",{style:Object.assign({}, S.btnGhost, {padding:"2px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}),
                onClick:function(){
                  store.setEditingText(t("workshop.greeting.entryLabel",{title:title, n:(i+1)}), String(raw==null? "": raw),
                    function(v){ store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, v); }); },
                    function(){ store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, raw); }); });
                }}, "⛶"),
              h("button",{style:Object.assign({}, S.btnGhost, {padding:"2px 8px", fontSize:11, border:"1px solid #3a2a2a", background:"transparent", color:"#e8a6a6"}),
                onClick:function(){ store.updateDraft(function(d){ d[key]=removeGreetingAt(d[key], i); }); }}, t("common.delete"))
            ));
        }
        return h("div",{style:S.field},
          h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}},
            h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}}, title),
            h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, hint+" · "+arr.length+"/"+GREETING_MAX),
              h("button",{style:Object.assign({}, S.btn, {padding:"2px 10px", fontSize:11, opacity: atMax?0.5:1, cursor: atMax?"not-allowed":"pointer"}), disabled: atMax,
                onClick:function(){ store.updateDraft(function(d){ d[key]=appendGreeting(d[key]); }); }}, atMax? t("workshop.greeting.atMax",{max:GREETING_MAX}):t("workshop.greeting.add"))
            )),
          arr.length===0
            ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", border:"1px dashed var(--dsw-alias-border-l1)", borderRadius:8, padding:"10px", textAlign:"center"}}, t("workshop.greeting.empty"))
            : arr.map(function(text, i){
                return h("div",{key:i, style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:8, marginBottom:8, background:"var(--dsw-alias-bg-base)"}},
                  head(i),
                  h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"},
                    value:String(text==null? "": text),
                    onChange:function(e){ var v=e.target.value; store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, v); }); }}));
              })
        );
      }
      var main=null;
      if(s.cur===0){
        function worldField(key, title){
          var val = s.world[key]||"";
          var has = String(val).trim().length>0;
          var preview = has ? String(val).slice(0,140) + (String(val).length>140 ? "…" : "") : t("workshop.world.empty");
          return h("div",{style:{border:"1px dashed var(--dsw-alias-border-l1)", borderRadius:12, padding:10, background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", minHeight:110}},
            h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}},
              h("div",{style:{fontSize:12, fontWeight:600}}, title),
              h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
                h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.world.chars",{n:String(val.length)})),
                h("button",{style:Object.assign({}, S.btnGhost, {padding:"3px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}), onClick:function(){ store.setEditingWorld(key); }}, has ? t("workshop.world.edit") : t("workshop.world.fill"))
              )
            ),
            h("div",{style:{flex:1, maxHeight:84, overflow:"auto", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:"8px", fontSize:12, lineHeight:1.5, whiteSpace:"pre-wrap", color: has? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)", cursor:"pointer"}, onClick:function(){ store.setEditingWorld(key); }}, has ? preview : preview),
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:6, textAlign:"right"}}, has ? t("workshop.world.previewHint") : " ")
          );
        }
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 4px", fontSize:13}},t("workshop.world.title")),
            h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, marginBottom:10}},t("workshop.world.hint")),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              worldField("timeline", t("workshop.world.timeline")),
              worldField("factions", t("workshop.world.factions")),
              worldField("geo", t("workshop.world.geo")),
              worldField("power", t("workshop.world.power")),
              h("div",{style:{gridColumn:"span 2"}}, worldField("daily", t("workshop.world.daily")))
            ),
            h("div",{style:{display:"flex", gap:8, marginTop:12}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.setCur(1); }}, t("action.nextChar"))
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      } else if(s.cur===1){
        main=h("div",null,
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.char.sixTitle")),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"name"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.name, onChange:function(e){ store.updateDraft(function(d){ d.name=e.target.value; }); }})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},t("workshop.field.nickname")), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.nickname||"", onChange:function(e){ store.updateDraft(function(d){ d.nickname=e.target.value; }); }}))
            ),
            h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},t("workshop.field.tags")), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.tags.join(", "), onChange:function(e){ store.updateDraft(function(d){ d.tags=e.target.value.split(",").map(function(x){return x.trim();}).filter(Boolean); }); }})),
            h("div",{style:S.field}, fieldHead("description","description"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:84, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.description, onChange:function(e){ store.updateDraft(function(d){ d.description=e.target.value; }); }})),
            h("div",{style:S.field}, fieldHead("personality","personality"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.personality, onChange:function(e){ store.updateDraft(function(d){ d.personality=e.target.value; }); }})),
            h("div",{style:S.field}, fieldHead("scenario","scenario"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.scenario, onChange:function(e){ store.updateDraft(function(d){ d.scenario=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, fieldHead("system_prompt","system_prompt"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.system_prompt||"", onChange:function(e){ store.updateDraft(function(d){ d.system_prompt=e.target.value; }); }})),
              h("div",{style:S.field}, fieldHead("post_history_instructions","post_history_instructions"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.post_history_instructions||"", onChange:function(e){ store.updateDraft(function(d){ d.post_history_instructions=e.target.value; }); }}))
            )
          ),
          h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.char.openingTitle")),
            h("div",{style:S.field}, fieldHead("first_mes","first_mes"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:72, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.first_mes, onChange:function(e){ store.updateDraft(function(d){ d.first_mes=e.target.value; }); }})),
            greetingList("alternate_greetings", t("workshop.greeting.altTitle"), t("workshop.greeting.altHint")),
            greetingList("group_only_greetings", t("workshop.greeting.groupTitle"), t("workshop.greeting.groupHint")),
            h("div",{style:S.field}, fieldHead(t("workshop.field.mesExample"),"mes_example"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:96, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.mes_example, onChange:function(e){ store.updateDraft(function(d){ d.mes_example=e.target.value; }); }}))
          )
        );
      } else if(s.cur===2){
        var entries=s.draft.data.character_book.entries;
        main=h("div",null,
          h("div",{style:S.card},
            h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}},
              h("h3",{style:{margin:0, fontSize:13}},t("workshop.lore.title")),
              h("span",{style:S.badge}, "scan_depth "+s.draft.data.character_book.scan_depth+" · token_budget "+s.draft.data.character_book.token_budget+" · "+t("common.entries",{n:entries.length}))
            ),
            h("div",null, entries.map(function(e){
              return h("div",{key:e.id, style:{display:"grid", gridTemplateColumns:"1fr auto", gap:8, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10, marginBottom:8}},
                h("div",null,
                  h("div",{style:{fontWeight:600, fontSize:12}}, e.name, h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, e.constant? "constant": (e.keys.join(", ")||"—")), h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, "order "+e.insertion_order)),
                  h("div",{style:Object.assign({}, S.mono, {color:"var(--dsw-alias-label-secondary)", marginTop:4, whiteSpace:"pre-wrap"})}, e.content),
                  h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginTop:6}}, h("span",{style:S.badge},"@@depth/@@position"), h("span",{style:S.badge},"CBS: {{char}}"))
                ),
                h("div",{style:{display:"flex", flexDirection:"column", gap:6}}, h("label",{style:{fontSize:12}}, h("input",{type:"checkbox", checked:e.enabled, onChange:function(ev){ store.updateDraft(function(d){ var f=d.character_book.entries.find(function(x){return x.id===e.id;}); if(f) f.enabled=ev.target.checked; }); }}), " enabled"), h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"4px 8px", fontSize:12}), onClick:function(){ store.updateDraft(function(d){ d.character_book.entries=d.character_book.entries.filter(function(x){return x.id!==e.id;}); }); }}, t("common.delete")))
              );
            })),
            h("div",{style:{display:"flex", gap:8, marginTop:10}},
              h("button",{style:S.btn, onClick:function(){ store.addEntry(); }}, t("action.addEntry")),
              h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", alignSelf:"center"}}, t("workshop.lore.addHint"))
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      } else {
        var v=s.valid;
        main=h("div",null,
          h("div",{style:S.card},
            h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.export.title")),
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, marginBottom:8}},
              h("span",{style: Object.assign({}, S.badge, v.valid? {borderColor:"var(--dsw-alias-state-success-primary)", color:"#a6e8c8", background:"color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, var(--dsw-alias-bg-base))"}:{borderColor:"var(--dsw-alias-state-error-primary)", color:"#e8a6a6", background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))"})}, v.valid? t("workshop.export.passed"):t("workshop.export.failed")),
              h("span",{style:S.badge},t("common.groupGreetings",{n:s.draft.data.group_only_greetings.length})),
              h("span",{style:S.badge}, "assets: "+(s.draft.data.assets? s.draft.data.assets.length:0))
            ),
            v.errors.length? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-state-error-primary)", borderRadius:8, padding:8, marginBottom:8, color:"#e8a6a6", fontSize:12}}, v.errors.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            v.warnings.length? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-border-l1) 40%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:8, marginBottom:8, color:"var(--dsw-alias-label-secondary)", fontSize:12}}, v.warnings.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, margin:"12px 0"}},
              h("button",{style:S.btn, onClick:function(){ store.exportJSON(); }}, "⬇ JSON"),
              h("button",{style: Object.assign({}, S.btn, {background:"#e05555"}), onClick:function(){ store.exportPNG(); }}, s.busy==="exportPng"? t("action.generating"):t("action.exportPng")),
              h("button",{style: Object.assign({}, S.btn, {background:"#e05555", opacity:0.92}), onClick:function(){ store.embedIntoPng(); }}, s.busy==="exportPng"? t("action.writing"):t("action.embedPng")),
              h("button",{style: Object.assign({}, S.btn, {background:"#2e86de"}), onClick:function(){ store.exportCharx(); }}, s.busy==="exportCharx"? t("action.generating"):t("action.exportCharx")),
              h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.validate(); }}, s.busy==="validate"? t("action.validating"): t("action.validate")),
              h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:11, alignSelf:"center"}}, t("workshop.export.hint2"))
            ),
            h("div",{style:S.field}, fieldHead(t("workshop.export.creatorNotes"),"creator_notes"), h("textarea",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", minHeight:60, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:s.draft.data.creator_notes, onChange:function(e){ store.updateDraft(function(d){ d.creator_notes=e.target.value; }); }})),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},"creation_date"), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:String(s.draft.data.creation_date), readOnly:true})),
              h("div",{style:S.field}, h("label",{style:{fontSize:12,color:"var(--dsw-alias-label-secondary)"}},t("workshop.export.modificationDate")), h("input",{style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px"}, value:String(s.draft.data.modification_date), readOnly:true}))
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      }
      var stepsEls=steps.map(function(label, i){
        var active=s.cur===i;
        return h("span",{key:i, style: Object.assign({}, S.step, active? S.stepActive:{}), onClick:function(){ store.setCur(i); }}, (i+1)+". "+label);
      });
      var filteredLibrary = (function(){
        var q = String(s.libraryQuery||"").trim().toLowerCase();
        if(!q) return s.library;
        return s.library.filter(function(e){
          var nameMatch = String(e.name||"").toLowerCase().indexOf(q)>=0;
          var tagMatch = Array.isArray(e.tags) && e.tags.some(function(t){ return String(t).toLowerCase().indexOf(q)>=0; });
          var loreMatch = String(e.loreCount||"").indexOf(q)>=0;
          return nameMatch || tagMatch || loreMatch;
        });
      })();
      var bodyStyle = Object.assign({}, S.body, {gridTemplateColumns: s.libraryCollapsed ? "220px 1fr 40px 360px" : "220px 1fr 280px 360px"});
      function renderLibrary(){
        if(s.libraryCollapsed){
          return h("div",{style:S.libraryCollapsedBar},
            h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)", borderRadius:8, padding:"6px 8px", fontSize:12, cursor:"pointer", width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.toggleLibraryCollapsed(); }, title:t("workshop.library.expand")}, "◀"),
            h("div",{style:{writingMode:"vertical-rl", fontSize:12, color:"var(--dsw-alias-label-secondary)", letterSpacing:2, lineHeight:"16px"}}, t("workshop.library.collapsed").replace("{n}", String(s.library.length))),
            h("button",{style:Object.assign({}, S.btn, {padding:"6px 0", fontSize:14, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save", title:t("workshop.library.saveTip",{name:(s.draft.data.name||t("workshop.library.unnamed"))})}, s.libraryBusy==="save"?"…":"★"),
            h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, filteredLibrary.length+"/"+s.library.length)
          );
        }
        return h("div",{style:S.library},
          h("div",{style:S.libraryHead},
            h("div",{style:{display:"flex", alignItems:"center", gap:6}},
              h("strong",{style:{fontSize:13}}, t("workshop.library.title")),
              h("span",{style:S.badge}, String(s.library.length))
            ),
            h("div",{style:{display:"flex", gap:6, alignItems:"center"}},
              h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 6px", fontSize:11, cursor:"pointer"}), onClick:function(){ store.refreshLibrary(); }, title:t("action.refresh"), disabled: s.libraryBusy==="refresh"}, s.libraryBusy==="refresh"?"…":"↻"),
              h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 6px", fontSize:11, cursor:"pointer"}), onClick:function(){ store.toggleLibraryCollapsed(); }, title:t("action.close")}, "▶")
            )
          ),
          h("div",{style:{padding:"8px", borderBottom:"1px solid var(--dsw-alias-border-l1)", display:"flex", flexDirection:"column", gap:8, background:"var(--dsw-alias-bg-layer-1)"}},
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"3px 6px", background:"var(--dsw-alias-bg-layer-2)", borderRadius:6, border:"1px solid var(--dsw-alias-border-l1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}},
              s.currentLibraryId ? t("workshop.library.loaded",{id:s.currentLibraryId.slice(0,8)}) : t("workshop.library.notLoaded")
            ),
            h("div",{style:{display:"flex", flexDirection:"column", gap:6}},
              h("button",{style:Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.importAny(); }}, t("workshop.library.import")),
              h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", textAlign:"center"}}, t("workshop.library.importHint"))
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btn, {flex:1, padding:"6px 10px", fontSize:12}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"}, s.libraryBusy==="save"? t("store.saving"):(s.currentLibraryId? t("workshop.library.update"):t("workshop.library.save"))),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"6px 10px", fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}), onClick:function(){ store.saveAsNewToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"}, s.libraryBusy==="saveNew"? t("store.savingNew"):t("workshop.library.saveAs"))
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.renameCurrentInLibrary(); }, disabled: !s.currentLibraryId||!!s.libraryBusy}, t("workshop.library.rename")),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.clearCurrentLibraryId(); }}, t("workshop.library.new")),
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", alignSelf:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, textAlign:"right"}}, s.draft.data.name ? s.draft.data.name.slice(0,8) : t("workshop.library.unnamed"))
            ),
            h("input",{placeholder:t("workshop.library.searchPlaceholder"), style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", fontSize:12}, value:s.libraryQuery, onChange:function(e){ store.setLibraryQuery(e.target.value); }}),
            s.lastMsg ? h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}, s.lastMsg) : null
          ),
          h("div",{style:S.libraryList},
            filteredLibrary.length===0 ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"24px 8px"}}, s.library.length===0 ? t("workshop.library.empty") : t("workshop.library.noMatch")) :
            filteredLibrary.map(function(entry){
              var isBusy = s.libraryBusy && String(s.libraryBusy).indexOf(entry.id)>=0;
              var isCurrent = s.currentLibraryId===entry.id;
              var itemStyle = isCurrent ? Object.assign({}, S.libraryItem, {borderColor:"#7c5cff", background:"color-mix(in srgb, #7c5cff 8%, var(--dsw-alias-bg-layer-2))"}) : S.libraryItem;
              return h("div",{key:entry.id, style:itemStyle},
                h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", gap:6}},
                  h("div",{style:{fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}, entry.name),
                  h("span",{style:Object.assign({}, S.badge, {flexShrink:0})}, t("common.loreCount").replace("{n}", String(entry.loreCount)))
                ),
                h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:2, fontFamily:"ui-monospace,Menlo,monospace"}}, "ID:"+entry.id.slice(0,8)),
                h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}, entry.descriptionSnippet || entry.tags.join(" · ") || "—"),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:4, marginTop:6}},
                  (entry.tags||[]).slice(0,4).map(function(t){ return h("span",{key:t, style:Object.assign({}, S.badge, {fontSize:10, padding:"1px 5px"})}, t); }),
                  entry.tags && entry.tags.length>4 ? h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, "+"+(entry.tags.length-4)) : null
                ),
                h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:4}}, new Date(entry.updatedAt*1000).toLocaleString()),
                h("div",{style:{display:"flex", gap:6, marginTop:8}},
                  h("button",{style:Object.assign({}, S.btn, {padding:"4px 8px", fontSize:11, flex:1}), onClick:function(){ store.loadFromLibrary(entry.id); }, disabled: !!isBusy}, isBusy?"…":t("workshop.library.load")),
                  h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 8px", fontSize:11}), onClick:function(){ store.exportLibraryEntry(entry.id); }, disabled: !!isBusy}, t("workshop.library.export")),
                  h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid #3a2a2a", background:"transparent", color:"#e8a6a6", borderRadius:8, padding:"4px 8px", fontSize:11}), onClick:function(){ store.deleteFromLibrary(entry.id); }, disabled: !!isBusy}, t("common.delete"))
                )
              );
            })
          )
        );
      }
      return h("div",{style:S.overlay, onClick:function(e){ if(e.target===e.currentTarget) store.setPanel(false); }},
        h("div",{style:S.workshop, role:"dialog", "aria-modal":"true"},
          h("div",{style:S.head},
            h("div",{style:{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}},
              h("strong",null, "🎭 "+t("panel.title")),
              h("span",{style:S.badge}, t("panel.badge")),
              h("div",{style:{display:"flex", gap:6, alignItems:"center"}}, stepsEls)
            ),
            h("div",{style:{display:"flex", gap:8}},
              h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.setPanel(false); }}, t("action.close")),
              h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.exportJSON(); }}, t("action.export"))
            )
          ),
          (function(){
            var st = s.draftStatus;
            if(!st) return null;
            if(st.isNew) return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(255,170,60,.10)", border:"1px solid rgba(255,170,60,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}}, t("workshop.draft.fresh"));
            if(st.recovered){
              var msg = String(t("workshop.draft.recovered")||"");
              msg = msg.split("{date}").join(String(st.creation_date==null?"—":st.creation_date));
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(96,165,250,.10)", border:"1px solid rgba(96,165,250,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}}, msg);
            }
            return null;
          })(),
          h("div",{style:bodyStyle},
            h("div",{style:S.nav},
              navItem(0, t("step.world"), t("step.world.desc")),
              navItem(1, t("step.char"), t("step.char.desc")),
              navItem(2, t("step.lore"), t("step.lore.desc")),
              navItem(3, t("step.export"), t("step.export.desc")),
              h("div",{style:{marginTop:"auto", paddingTop:12, borderTop:"1px solid var(--dsw-alias-border-l1)", display:"flex", flexDirection:"column", gap:8}},
                h("button",{style: Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.validate(); }}, s.busy==="validate"? t("action.validating"): t("action.validate")),
                h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", textAlign:"center"}}, s.busy? s.busy: (s.lastMsg||t("workshop.library.noCcHint")))
              )
            ),
            h("div",{style:S.main}, main),
            renderLibrary(),
            h("div",{style:S.side},
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.preview.title")),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:8}}, h("span",{style:S.badge},t("common.spec")), h("span",{style: Object.assign({}, S.badge, s.valid.valid? {color:"#a6e8c8", borderColor:"var(--dsw-alias-state-success-primary)"}:{color:"#e8a6a6", borderColor:"var(--dsw-alias-state-error-primary)"})}, s.valid.valid? t("common.passed"):t("common.failed"))),
                h("pre",{style:{whiteSpace:"pre-wrap", wordBreak:"break-all", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10, maxHeight:420, overflow:"auto", margin:0, fontSize:11}}, JSON.stringify(s.draft, null, 2))
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.preview.cbsTitle")),
                h("div",{style:{display:"flex", flexWrap:"wrap", gap:6}}, ["{{char}}","{{user}}","{{random:A,B}}","{{roll:d6}}",t("workshop.preview.cbsComment")].map(function(c){ return h("span",{key:c, style:S.chip}, c); })),
                h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, marginTop:8}}, t("workshop.preview.cbsHint"))
              ),
              h("div",{style:S.card}, h("h3",{style:{margin:"0 0 8px", fontSize:13}},t("workshop.preview.fusionTitle")),
                h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, lineHeight:1.5}}, t("workshop.preview.fusionDesc"))
              )
            )
          )
        ),
        s.editingWorld ? h("div",{style:Object.assign({}, S.overlay, {background:"rgba(0,0,0,.55)", zIndex:40}), onClick:function(e){ if(e.target===e.currentTarget) store.setEditingWorld(null); }},
          h("div",{style:{width:"min(720px, 92vw)", maxHeight:"82vh", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3)"}},
            h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}},
              h("strong",{style:{fontSize:14, color:"var(--dsw-alias-label-primary)"}}, t("workshop.edit.title",{title:({timeline:t("workshop.world.timeline"), factions:t("workshop.world.factions"), geo:t("workshop.world.geo"), power:t("workshop.world.power"), daily:t("workshop.world.daily")}[s.editingWorld] || s.editingWorld)})),
              h("button",{style:Object.assign({}, S.btnGhost, {padding:"4px 10px"}), onClick:function(){ store.setEditingWorld(null); }}, t("action.closeX"))
            ),
            h("textarea",{style:Object.assign({}, S.textarea, {minHeight:320, flex:1, maxHeight:"60vh"}), value: s.world[s.editingWorld]||"", onChange:function(e){ store.setWorldPatch(s.editingWorld, e.target.value); }, autoFocus:true, placeholder:t("workshop.world.placeholder")}),
            h("div",{style:{display:"flex", gap:8, marginTop:12, justifyContent:"space-between", alignItems:"center"}},
              h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.world.charsHint",{n:String((s.world[s.editingWorld]||"").length)})),
              h("div",{style:{display:"flex", gap:8}},
                h("button",{style:S.btn, onClick:function(){ store.setEditingWorld(null); }}, t("action.done")),
                h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)"}), onClick:function(){ store.cancelEditingWorld(); }}, t("action.cancel"))
              )
            )
          )
        ) : null,
            s.editingText ? h("div",{style:Object.assign({}, S.overlay, {background:"rgba(0,0,0,.55)", zIndex:40}), onClick:function(e){ if(e.target===e.currentTarget) store.clearEditingText(); }},
              h("div",{style:{width:"min(720px, 92vw)", maxHeight:"82vh", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3)"}},
                h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}},
                  h("strong",{style:{fontSize:14, color:"var(--dsw-alias-label-primary)"}}, t("workshop.edit.title",{title:(s.editingText.title||t("workshop.edit.fallbackTitle"))})),
                  h("button",{style:Object.assign({}, S.btnGhost, {padding:"4px 10px"}), onClick:function(){ store.clearEditingText(); }}, t("action.closeX"))
                ),
                h("textarea",{style:Object.assign({}, S.textarea, {minHeight:320, flex:1, maxHeight:"60vh"}), value: s.editingText.value||"", onChange:function(e){ store.updateEditingText(e.target.value); }, autoFocus:true, placeholder:t("workshop.edit.placeholder")}),
                h("div",{style:{display:"flex", gap:8, marginTop:12, justifyContent:"space-between", alignItems:"center"}},
                  h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.edit.charsSync",{n:String((s.editingText.value||"").length)})),
                  h("div",{style:{display:"flex", gap:8}},
                    h("button",{style:S.btn, onClick:function(){ store.clearEditingText(); }}, t("action.done")),
                    h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)"}), onClick:function(){ store.cancelEditingText(); }}, t("action.cancel"))
                  )
                )
              )
            ) : null
      );
    }

    function SettingsView(props){
      var t=props.t || function(k){ return zh[k]||en[k]||k; };
      var store=props.store;
      // subscribe store (language follows global locale via locale:NS + t, no manual switch)
      var snapRef=React.useState(function(){ return store ? store.getSnapshot() : null; });
      var snap=snapRef[0], setSnap=snapRef[1];
      React.useEffect(function(){ if(!store) return; return store.subscribe(function(){ setSnap(store.getSnapshot()); }); }, [store]);
      function tr(key, vars){
        var s=t(key);
        if(vars && typeof vars==="object"){ for(var k in vars){ s=s.split("{"+k+"}").join(String(vars[k])); } }
        return s;
      }
      var libCount = snap && Array.isArray(snap.library) ? snap.library.length : null;
      var pollEnabled = snap ? !!snap.pollEnabled : true;
      var autoValidate = snap ? !!snap.autoValidate : true;
      var autoSaveOnImport = snap ? !!snap.autoSaveOnImport : false;
      function ToggleRow(label, desc, value, setter){
        return h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderTop:"1px solid var(--dsw-alias-border-l1)", gap:12}},
          h("div",{style:{flex:1, minWidth:0}},
            h("div",{style:{fontSize:12, fontWeight:600, color:"var(--dsw-alias-label-primary)"}}, label),
            h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2, lineHeight:1.4}}, desc)
          ),
          h("button",{onClick:function(){ setter(!value); }, style:{flex:"none", width:44, height:24, borderRadius:999, border:"1px solid "+(value?"#7c5cff":"var(--dsw-alias-border-l1)"), background: value?"#7c5cff":"var(--dsw-alias-bg-layer-2)", position:"relative", cursor:"pointer", transition:"all .15s"}},
            h("span",{style:{position:"absolute", top:2, left: value?22:2, width:18, height:18, borderRadius:999, background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,.2)", transition:"left .15s"}})
          )
        );
      }
      return h("div",{style:{padding:"16px 20px", maxWidth:720}},
        h("h2",{style:{margin:"0 0 8px", fontSize:18}}, "🎭 "+t("settings.title")),
        h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:13, lineHeight:1.6}}, t("settings.desc")),
        h("div",{style:{marginTop:12, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}}, t("settings.status.title")),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-primary)"}}, t("settings.status.count"), libCount===null ? "—" : String(libCount)+t("settings.status.suffix"), libCount!==null ? h("span",{style:{color:"var(--dsw-alias-label-secondary)", marginLeft:8}}, t("settings.status.path")) : null),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:8}}, t("settings.status.hint")),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:6}}, t("settings.status.prototype"), h("a",{href:"file:///E:/dsh/plugin/dsh-cc-studio/prototypes/index.html", target:"_blank", style:{color:"#7c5cff"}}, "prototypes/index.html"), " ｜ "+t("settings.status.spec"), h("a",{href:"https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md", target:"_blank", style:{color:"#7c5cff"}}, "CCv3 SPEC")),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:6}}, t("settings.status.impExp")),
          store && store.refreshLibrary ? h("button",{style:Object.assign({}, S.btn, {marginTop:10, padding:"6px 10px", fontSize:12}), onClick:function(){ store.refreshLibrary(); }}, t("settings.status.refresh")) : null
        ),
        h("div",{style:{marginTop:12, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}}, t("settings.behavior.title")),
          (function(){
            var interval = snap ? (Number(snap.pollInterval)||0) : 4;
            return h("div",{style:{display:"flex", flexDirection:"column", padding:"8px 0", borderTop:"1px solid var(--dsw-alias-border-l1)", gap:8}},
              h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12}},
                h("div",{style:{flex:1, minWidth:0}},
                  h("div",{style:{fontSize:12, fontWeight:600, color:"var(--dsw-alias-label-primary)"}}, t("settings.behavior.pollTitle")),
                  h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2, lineHeight:1.4}}, interval===0 ? t("hint.pollOff") : tr("hint.pollOn",{n:interval}))
                ),
                h("button",{onClick:function(){ store.setPollEnabled(!pollEnabled); }, style:{flex:"none", width:44, height:24, borderRadius:999, border:"1px solid "+(pollEnabled?"#7c5cff":"var(--dsw-alias-border-l1)"), background: pollEnabled?"#7c5cff":"var(--dsw-alias-bg-layer-2)", position:"relative", cursor:"pointer", transition:"all .15s"}},
                  h("span",{style:{position:"absolute", top:2, left: pollEnabled?22:2, width:18, height:18, borderRadius:999, background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,.2)", transition:"left .15s"}})
                )
              ),
              pollEnabled ? h("div",{style:{display:"flex", alignItems:"center", gap:8}},
                h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("settings.behavior.interval")),
                h("input",{type:"range", min:1, max:30, step:1, value:String(interval), style:{flex:1}, onChange:function(e){ store.setPollInterval(e.target.value); }}),
                h("input",{type:"number", min:1, max:30, step:1, value:String(interval), style:{width:56, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:6, padding:"4px 6px", fontSize:12, color:"var(--dsw-alias-label-primary)"}, onChange:function(e){ store.setPollInterval(e.target.value); }}),
                h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("settings.behavior.seconds")),
                h("button",{style:Object.assign({}, S.btnGhost, {padding:"4px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)"}), onClick:function(){ store.setPollInterval(4); }}, t("settings.behavior.reset"))
              ) : null
            );
          })(),
          ToggleRow(t("settings.behavior.autoValidate"), t("settings.behavior.autoValidateDesc"), autoValidate, function(v){ store.setAutoValidate(v); }),
          ToggleRow(t("settings.behavior.autoSave"), t("settings.behavior.autoSaveDesc"), autoSaveOnImport, function(v){ store.setAutoSaveOnImport(v); }),
          h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:8}}, t("settings.behavior.storageHint"))
        ),
        h("div",{style:{marginTop:12, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, padding:12}},
          h("h3",{style:{margin:"0 0 8px", fontSize:13}}, t("settings.tips.title")),
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", lineHeight:1.6}}, t("settings.tips.body"))
        )
      );
    }

    function apply(ctx){
      ctx.effect(function(){ return ctx.locale.register(NS, { zh:zh, en:en }); }, "cc-studio:locale");
      var store=createStore(ctx);
      // CC 模式检测 + 草稿同步：会话切换触发 + CC 模式下 2.5s 轻量轮询（修复 Tools 写入后胶囊/工坊不同步的 bug）
      ctx.effect(function(){
        var lastHostJson="";
        var lastHostStatusJson="";
        function pullDraft(sessionId){
          var args = sessionId ? {sessionId: sessionId} : {};
          if(sessionId) store.setSessionId(sessionId);
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_getDraft",{args:args}).then(function(res){
            if(!res || !res.ok || !res.value || !res.value.draft) return;
            var draft=res.value.draft;
            var draftStatus=res.value.draftStatus||null;
            try{
              var j=JSON.stringify(draft);
              var stJ=JSON.stringify(draftStatus);
              if(j!==lastHostJson || stJ!==lastHostStatusJson){
                lastHostJson=j;
                lastHostStatusJson=stJ;
                var curJ=JSON.stringify(store.getSnapshot().draft);
                var curStJ=JSON.stringify(store.getSnapshot().draftStatus||null);
                if(j!==curJ || stJ!==curStJ) store.setDraftFromHost(draft, draftStatus);
              }
            }catch(e){}
          }).catch(function(){});
        }
        var lastPullAt = 0;
        function pullDraftThrottled(sid){
          var now = Date.now();
          if(now - lastPullAt < 500) return;
          lastPullAt = now;
          pullDraft(sid);
        }
        // 初始拉一次（default）
        pullDraftThrottled(null);
        // 暴露给 Capsule/Workshop 按会话触发（带节流）
        store._pullDraft = pullDraftThrottled;
        // CC 模式下轻量轮询，保证 LLM 的 cc_* Tool 写入后胶囊实时同步（切换会话时会自动更新 currentSessionId）
        // 仅 CC 模式下以 4s 心跳拉取，标准模式/未触发时不请求；去重避免启动时双重请求
        var timer = setInterval(function(){
          var s = store.getSnapshot();
          var intervalSec = Number(s.pollInterval)||0;
          if(!s.isCcMode || intervalSec===0) return;
          var elapsed = Date.now() - lastPullAt;
          if(elapsed < intervalSec*1000) return;
          var sid = s.currentSessionId || null;
          pullDraftThrottled(sid);
        }, 1000);
        return function(){ clearInterval(timer); };
      }, "cc-studio:cc-mode-poll");
      ctx.slots.inject("conversation.input.dock", function(){
        return ctx.slots.register({
          name:"conversation.input.dock",
          id:"dsh-cc-studio-pill",
          order:20,
          locale:NS,
          inject: function(sessionId){ return {store:store}; }
        }, Capsule);
      });
      ctx.slots.inject("shell.overlay", function(){
        return ctx.slots.register({
          name:"shell.overlay",
          id:"dsh-cc-studio-overlay",
          order:10,
          locale:NS,
          inject: function(){ return {store:store}; }
        }, Workshop);
      });
      ctx.slots.inject("settings.section", function(){
        return ctx.slots.register({
          name:"settings.section",
          id:"cc-studio",
          order:40,
          label: function(){ try{ return ctx.locale.bind(NS)("settings.title"); }catch(e){ return zh["settings.title"]; } },
          locale: NS,
          inject: function(){ return {store: store, locale: ctx.locale}; }
        }, SettingsView);
      });
    }

    exports.apply=apply; exports.inject=inject; exports.name=name;
    return module.exports;
  }
});









