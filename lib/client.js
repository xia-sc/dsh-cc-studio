/**
 * @xia-sc/dsh-cc-studio — browser half
 * 融合形态：dock 胶囊常驻（默认收起）+ 点击展开为 overlay 工坊（侧边按需展开/全屏沉浸）
 * 直接手写 bundle，无构建步骤，仅 require seed 词 react / cordis 等
 */
window.__ModuleLoader__.load({
  id: "@xia-sc/dsh-cc-studio", // 必须等于宿主图里的包名（dsh-client-modules 会精确匹配，写错抛 "loaded without registering"）
  factory: (require) => {
    var module={exports:{}}; var exports=module.exports;
    Object.defineProperty(exports, Symbol.toStringTag,{value:"Module"});
    var React=require("react");
    var name="dsh-cc-studio";
    var inject=["slots","connection","locale"];
    // 原生 <select> 展开后的 option 列表不继承页面配色（深色模式下呈白底浅字、读不出来）。
    // option 无法用 inline style 逐个维护，这里补一条跟随主题变量的全局规则。
    (function(){
      try{
        var st=document.createElement("style");
        st.setAttribute("data-dsh-cc-studio","select-theme");
        st.textContent=[
          "select option{background-color:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}",
          "select option:checked{background-color:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:600}",
          "select option:disabled{color:var(--dsw-alias-label-secondary)}"
        ].join("");
        (document.head||document.documentElement).appendChild(st);
      }catch(e){}
    })();
    var NS="dshCcStudio";
    var zh={
      "capsule.open":"🎭 角色卡工坊",
      "capsule.exported":"已导出",
      "capsule.draft":"草稿",
      "capsule.expanded":"已展开",
      "capsule.collapseHint":"点击展开",
      "capsule.slotWarn":"⚠ 草稿槽不一致",
      "preset.ccLabel":"CC 模式",
      "panel.title":"角色卡工坊",
      "panel.subtitle":"CCv3 · 从点子到可导入卡",
      "panel.badge":"dsh-cc-studio · 融合",
      "step.world":"世界观",
      "step.char":"角色",
      "step.lore":"世界书",
      "step.export":"导出",
      "step.overview":"总览",
      "step.greetings":"开场与示例",
      "step.rel":"关系与分组",
      "step.book":"共享世界书",
      "step.world.desc":"年表/势力/地理/力量/日常",
      "step.char.desc":"六件套 · 标签 · 作者",
      "step.lore.desc":"条目 · 预算 · 触发词",
      "step.overview.desc":"进度 · 统计 · 快捷动作",
      "step.greetings.desc":"首条 · 备选 · 群聊 · 示例",
      "step.rel.desc":"图谱 · 成员 · 渲染",
      "step.book.desc":"一组一份 · 去重",
      // —— 0.9.0 共享世界书（组级）——
      "workshop.rel.edit":"编辑",
      "workshop.rel.editTitle":"编辑关系",
      "workshop.rel.addTitle":"添加关系",
      "workshop.rel.typeLabel":"类型",
      "workshop.rel.dirLabel":"方向",
      "workshop.rel.myCard":"当前卡",
      "book.title":"共享世界书",
      "book.hint":"一组一份：世界设定（年表/势力/地理/力量/日常）放这里，成员卡里只留角色私有条目。导出有两种：CCv3 独立世界书（lorebook_v3，给支持该规范的客户端绑成全局世界书）与 SillyTavern 世界书（ST 的导入接口只认 {entries:{…}} 形态，直接把 CCv3 那份拖进去会报 Bad Request）。",
      "book.noGroup":"共享世界书是按分组存放的：先在右侧「已存角色」里建一个分组，并把成员卡拉进去。",
      "book.empty":"这个分组还没有共享世界书。",
      "book.name":"书名",
      "book.desc":"备注",
      "book.depth":"扫描深度",
      "book.budget":"token 预算",
      "book.tokens":"约 {n} token",
      "book.entries":"条目 · {n}",
      "book.groups":"共 {n} 组",
      "book.constant":"常驻",
      "book.dupTitle":"成员卡之间的重复条目",
      "book.dupNone":"成员卡之间没有内容重复的条目。",
      "book.dupItem":"{n} 张卡都有 · 可省 {chars} 字符",
      "book.dupMismatch":"名字/触发词不一致",
      "book.promote":"提升到共享书",
      "book.promoteHint":"把这 N 条搬进共享书，并从每张卡里删掉 —— 导出前先做这一步，卡里就不再有重复。",
      "book.promotePreview":"将提升 {n} 条、从各卡共删 {m} 条重复",
      "book.promoteDone":"已提升 {n} 条（删掉 {m} 条重复）",
      "book.promoteSyncedDraft":"已同步当前草稿，删掉 {n} 条重复（否则保存时会把它们写回去）",
      "book.exportBook":"导出共享世界书 JSON",
      "book.exported":"已导出 {name}",
      "book.exportedSt":"已导出 SillyTavern 世界书「{name}」—— 在 SillyTavern 里「世界信息 → 导入」选它即可",
      "book.applyCard":"合并进当前卡",
      "book.applyDone":"已往当前卡补了 {n} 条",
      "book.applyNone":"当前卡已包含这本共享书的全部条目。",
      "book.entryName":"条目名",
      "book.entryKeys":"触发词（逗号分隔）",
      "book.entryContent":"内容（可带 @@position / @@depth / @@activate 等装饰器）",
      "book.refresh":"刷新",
      "book.saved":"已保存（rev {rev}）",
      // —— 0.9.0 导出页的共享书块 ——
      "export.book.title":"共享世界书",
      "export.book.hint":"当前卡所属分组的共享设定可以单独导出：CCv3 独立世界书给支持 lorebook_v3 的客户端当全局世界书；SillyTavern 世界书是 ST 原生形态（{entries:{…}}）—— ST 的导入接口只认这一种，拖 CCv3 那份进去会报 Bad Request。ST 里的顺序是**先导世界书、再导卡**：卡会自动带上绑定（data.extensions.world）；卡内私有条目还要在 ST 里点一次 Import Card Lore 才生效。",
      "export.stWorldBound":"已写入 SillyTavern 世界书绑定「{name}」",
      "export.close":"关闭导出",
      "export.book.loading":"正在读取这张卡所属分组的共享世界书…",
      "export.book.none":"当前卡不在任何分组里，或这个分组还没有共享世界书。",
      "export.book.button":"⬇ CCv3 独立世界书",
      "export.book.buttonSt":"⬇ SillyTavern 世界书",
      "export.book.merge":"导出 JSON 时把共享条目并入这张卡（给不支持全局世界书的客户端）",
      "export.book.merged":"（已并入 {n} 条共享条目）",
      "action.expand":"✦ AI 扩写",
      "action.validate":"校验",
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
      // —— 0.11.0 LLM 草稿锁（创作保护 / 只读 / 只读预览）——
      "lock.bar.active":"🔒 LLM 正在创作「{name}」· 工坊只读 · 最后写入 {n} 分钟前",
      "lock.bar.activeHint":"创作完成后让 LLM 调用 cc_release_draft 释放草稿锁；或到设置里关闭「LLM 创作保护（草稿锁）」。",
      "lock.bar.stale":"⏳ LLM 已有 {n} 分钟未写入 · 草稿已自动解锁（LLM 再写会重新锁定）",
      "lock.bar.preview":"👁 预览「{name}」· 未载入，LLM 的草稿未受影响",
      "lock.bar.previewHint":"退出预览即可回到 LLM 正在写的草稿；继续载入别的卡只会切换预览，不会覆盖草稿。",
      "lock.preview.exit":"退出预览",
      "lock.msg.writeBlocked":"LLM 正在创作，本次修改未写入。",
      "lock.msg.loadedPreview":"已进入预览：「{name}」· 草稿未被覆盖",
      "lock.msg.importedPreview":"已进入预览：{k} 卡「{name}」· 草稿未被覆盖",
      "lock.msg.exitPreview":"已退出预览，回到 LLM 草稿",
      "lock.msg.draftLockOff":"「LLM 创作保护」已关闭：载入/导入会直接覆盖草稿（旧行为）",
      "settings.behavior.draftLock":"LLM 创作保护（草稿锁）",
      "settings.behavior.draftLockDesc":"LLM 写草稿时工坊只读，载入/导入只进入预览；关闭后完全恢复旧行为。",
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
      "workshop.field.empty":"未填写",
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
      "workshop.export.currentHint":"导出的是当前工坊里的角色卡；要导出某张已存角色，请先在右侧载入它",
      "workshop.export.savedCardHint":"正在导出已存角色「{name}」：只读这份卡，导出不会改动当前工坊草稿，也不要求先载入",
      "workshop.export.creatorNotes":"creator_notes / 多语言",
      "workshop.export.creationDate":"creation_date",
      "workshop.export.modificationDate":"modification_date（导出自动刷新）",
      "workshop.draft.fresh":"⚠️ 当前会话是全新空白草稿（无历史存档，可能是 host 重启后的新会话）。在工坊或对话中继续编辑前，请确认这是预期中的新建；如需继续旧卡请去右侧“已存角色”载入。",
      "workshop.draft.recovered":"已从磁盘自动恢复草稿（host 重启后恢复），creation_date={date}。可继续编辑，下次写入后此提示消失。",
      "workshop.slot.mismatch":"⚠ 草稿槽不一致：本次读到的是 `{got}` 槽，而当前会话是 `{want}`。为防止把别的槽画成你的草稿，本次内容未渲染；下一次轮询会按当前会话重新读取。",
      "workshop.slot.recover":"发现另一份已落盘草稿：{name}（{n} 条 lore，槽 {key}）。如果这就是本会话此前写入的内容，可一键迁入当前会话槽 —— 内容没有丢，只是被写进了另一把 key。",
      "workshop.slot.migrateOne":"迁入 {key}（{n} 条 lore）",
      "workshop.slot.migrated":"已把槽 {key} 的内容迁入当前会话（{n} 条 lore）。",
      "workshop.slot.migrateFailed":"迁移草稿槽失败",
      "workshop.preview.title":"实时 CCv3 预览",
      "workshop.preview.cbsTitle":"CBS 速查",
      "workshop.preview.cbsHint":"大小写不敏感，逗号用 \\, 转义。",
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
      // —— 0.8.0 人物关系图谱 / 群聊分组 ——
      "workshop.group.all":"全部",
      "workshop.group.none":"未分组",
      "workshop.group.new":"＋ 组",
      "workshop.group.summary":"{n} 卡 / {m} 关系",
      "workshop.group.newGroup":"＋ 新建分组",
      "workshop.group.empty":"（空）",
      "workshop.group.needRestart":"宿主半还是旧代码（这些按钮要重启 dsh 才生效）：请退出并重新打开桌面应用 / 重启 dsh web，然后刷新页面",
      "workshop.group.prompt":"新分组名称（同一世界观的角色放一组）",
      "workshop.group.assign":"组",
      "workshop.group.set":"已归组",
      "workshop.rel.title":"人物关系",
      "workshop.rel.open":"关系",
      "workshop.rel.pickGroup":"先在左侧选一个具体分组（「全部 / 未分组」下没有可编辑的关系）。",
      "workshop.rel.noGroup":"未选分组",
      "workshop.rel.members":"成员卡",
      "workshop.rel.noMember":"（还没有卡入组 —— 用卡片行上的「组」按钮把同一世界观的卡拉进来）",
      "workshop.rel.edges":"关系",
      "workshop.rel.noEdge":"（还没有关系：用下面的表单加一条，或让模型用 cc_patch_relations 批量建）",
      "workshop.rel.add":"添加关系",
      "workshop.rel.addNode":"＋ NPC",
      "workshop.rel.nodePrompt":"NPC 名字（没有独立角色卡的人物，例如「柳长老」）",
      "workshop.rel.from":"从",
      "workshop.rel.to":"到",
      "workshop.rel.strength":"强度",
      "workshop.rel.direction":"方向",
      "workshop.rel.dirMutual":"对等",
      "workshop.rel.dirOneWay":"单向",
      "workshop.rel.note":"备注",
      "workshop.rel.check":"体检",
      "workshop.rel.render":"渲染到当前卡",
      "workshop.rel.rendered":"已把 {n} 条关系写进当前卡（记得「保存当前」才会落库）",
      "workshop.rel.checkResult":"体检：{n} 个问题",
      "workshop.rel.checkOk":"体检通过：没有结构性问题",
      "workshop.rel.checkStats":"体检：{e} 个错误 · {w} 个警告",
      "workshop.rel.checkPass":"体检通过：没有发现问题",
      "workshop.consistency.title":"设定铁律 {n} 条",
      "workshop.consistency.derived":"自动派生",
      "workshop.consistency.ok":"一致性检查通过：没有长度/同实体/覆盖问题",
      "workshop.audit.title":"体检",
      "workshop.audit.summary":"{e} 个错误 · {w} 个提示",
      "workshop.audit.anchor":"时间锚定",
      "workshop.audit.hook":"未结案钩子",
      "workshop.audit.canon":"设定铁律",
      "workshop.audit.lore":"世界书",
      "workshop.audit.other":"其他",
      "workshop.audit.goto":"去修",
      "workshop.rel.saved":"关系已更新（rev {rev}）",
      "workshop.rel.needLoad":"先在左侧「载入」一张卡：渲染要知道写进哪张卡",
      "workshop.rel.hint":"关系只存在插件侧，不写进 CCv3 字段；「渲染到当前卡」会把它们写进 description 的【关系】段，让分享出去的卡自包含。",
      "rel.type.family":"亲属",
      "rel.type.romance":"恋慕",
      "rel.type.mentor":"师徒",
      "rel.type.friend":"挚友",
      "rel.type.colleague":"同门",
      "rel.type.rival":"竞争",
      "rel.type.enemy":"敌对",
      "rel.type.debt":"恩义",
      "rel.type.superior":"上下级",
      "rel.type.other":"其他",
      "workshop.library.new":"＋ 新建",
      "workshop.library.actions":"操作（导入 / 更新 / 另存 / 改名）",
      "workshop.library.searchPlaceholder":"搜索 名称/标签…",
      "workshop.library.empty":"还没有已存角色\n去“世界观/角色细化”填好后点“保存当前”",
      "workshop.library.noMatch":"无匹配",
      "workshop.library.load":"载入",
      "workshop.library.export":"导出",
      "workshop.library.exportTip":"打开导出弹层，导出这张已存卡（不需要先载入）",
      "workshop.library.exportJumped":"已打开 ✓",
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
      "store.importedUpgraded":"{v} 卡已升级为 CCv3",
      "store.errImportFailed":"导入失败：{msg}",
      "store.errReadFileFailed":"读取文件失败",
      "store.parsingJson":"正在解析 JSON…",
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
      "store.confirmClear":"确定清空当前角色卡的全部内容？\n\n已存角色里的存档不受影响，此操作不可撤销。",
      "store.cleared":"已清空当前角色卡（已存角色未动）",
      "store.loadedCard":"已载入：{name} · {n} lore（ID:{id}，再次保存将更新此卡）",
      "store.errLoadFailed":"载入失败",
      "store.confirmDelete":"确定删除该角色？此操作不可撤销。",
      "relations.confirmDeleteGroup":"确定删除这个分组？分组里的节点与关系、以及该组的共享世界书（若有）会一起删掉，且不可恢复。成员卡不会被删除，只会离开这个组。",
      "book.dupBook":"另有 {n} 条在成员卡里与共享书逐字重复（回填进卡的副本）—— 提升时会一并清掉卡里那几份，不会再往书里加。",
      "store.deleted":"已删除",
      "store.errDeleteFailed":"删除失败",
      "store.needLoadFirst":"请先载入一张卡后再重命名",
      "store.promptRename":"输入新名称",
      "store.renamed":"已重命名为：{name}",
      "store.errRenameFailed":"重命名失败",
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
      "workshop.field.creator":"作者（creator）",
      "workshop.field.mesExample":"mes_example（{{user}}/{{char}}）",
      "workshop.edit.title":"{title} · 大框编辑",
      "workshop.edit.fallbackTitle":"编辑",
      "workshop.library.expand":"展开已存角色",
      "workshop.library.saveTip":"保存当前草稿（{name}）",
      "workshop.library.noCcHint":"切换到 CC 模式让 LLM 引导填充",
      "workshop.preview.cbsComment":"{{// 注释}}",
      "workshop.field.depthNote":"Character's Note（ST 每轮注入）",
      "workshop.field.depthHint":"只读 · 由 CC 模式写入",
      "st.title":"导入到 {label}",
      "st.online":"在线",
      "st.offline":"未检测到",
      "st.probing":"检测中…",
      "st.needAuth":"需要认证",
      "st.forbidden":"被拒绝",
      "st.probe":"重新检测",
      "st.hint":"检测到本机 SillyTavern 在线后，可把当前导出的卡与共享世界书直接推进去：先导书、后导卡，卡会自动绑定这本书。",
      "st.showAuth":"认证（可选）",
      "st.hideAuth":"收起认证",
      "st.user":"用户名",
      "st.pass":"密码（不保存）",
      "st.import":"开始导入",
      "st.importing":"导入中…",
      "st.imported":"已导入：{card} · 世界书 {world}",
      "st.overwrite":"ST 已有同名世界书时覆盖",
      "st.cover":"选择封面",
      "st.coverClear":"移除封面",
      "st.footnote":"写入 SillyTavern 的 characters/ 与 worlds/ 目录；重复导入会新增一张卡（不会覆盖已有卡）。",
      "st.errOffline":"未检测到 SillyTavern：确认它已启动、地址正确；若不在本机，请检查它的 whitelist。",
      "st.errAuth":"SillyTavern 开启了 Basic 认证：请填用户名与密码后重试。",
      "st.errForbidden":"SillyTavern 拒绝访问（403）：检查 whitelist / 登录模式，或该 ST 不支持本次导入。",
      "st.errCsrf":"SillyTavern 的 CSRF 校验失败：请重试一次。",
      "st.errBadUrl":"SillyTavern 地址不合法（只支持 http/https）。",
      "st.errBadResponse":"对方不是可识别的 SillyTavern（或版本过旧）。",
      "st.errBookFailed":"世界书导入失败，已中止（没有导入角色卡）。",
      "st.errImportFailed":"角色卡导入失败。",
      "st.errTooLarge":"底图过大（上限 20MB）。",
      "st.errCover":"封面不是可用的图片：请换一张 PNG / JPG。",
      "st.errBuild":"生成角色卡 PNG 失败（封面或卡数据有问题）。",
      "st.errNoRemote":"当前导出目标不支持直接导入。"
    };
    var en={
      "capsule.open":"Character Card Studio",
      "capsule.exported":"exported",
      "capsule.draft":"draft",
      "capsule.expanded":"expanded",
      "capsule.collapseHint":"Click to expand",
      "capsule.slotWarn":"⚠ draft slot mismatch",
      "preset.ccLabel":"CC 模式",
      "panel.title":"Character Card Studio",
      "panel.subtitle":"CCv3 · Idea to Importable Card",
      "panel.badge":"dsh-cc-studio · fusion",
      "step.world":"World",
      "step.char":"Character",
      "step.lore":"Lorebook",
      "step.export":"Export",
      "step.overview":"Overview",
      "step.greetings":"Openings & examples",
      "step.rel":"Relations & groups",
      "step.book":"Shared lorebook",
      "step.world.desc":"Timeline/Factions/Geo/Power/Daily",
      "step.char.desc":"Core fields · tags · creator",
      "step.lore.desc":"Entries · budget · keys",
      "step.overview.desc":"Progress · stats · quick actions",
      "step.greetings.desc":"First · alternates · group · examples",
      "step.rel.desc":"Graph · members · render",
      "step.book.desc":"One per group · dedupe",
      "workshop.rel.edit":"Edit",
      "workshop.rel.editTitle":"Edit relation",
      "workshop.rel.addTitle":"Add relation",
      "workshop.rel.typeLabel":"Type",
      "workshop.rel.dirLabel":"Direction",
      "workshop.rel.myCard":"current card",
      "book.title":"Shared lorebook",
      "book.hint":"One book per group: put the world setting (timeline / factions / geography / power / daily) here and keep only character-private entries in each member card. Two export formats: the CCv3 standalone lorebook (lorebook_v3, for clients that support the spec) and the SillyTavern lorebook (ST's importer only accepts the {entries:{…}} shape — feeding it the CCv3 file answers Bad Request).",
      "book.noGroup":"Shared lorebooks live on a group: create one under “Saved characters” on the right and put the member cards in it.",
      "book.empty":"This group has no shared lorebook yet.",
      "book.name":"Book name",
      "book.desc":"Note",
      "book.depth":"Scan depth",
      "book.budget":"Token budget",
      "book.tokens":"~{n} tokens",
      "book.entries":"Entries · {n}",
      "book.groups":"{n} groups",
      "book.constant":"constant",
      "book.dupTitle":"Entries duplicated across member cards",
      "book.dupNone":"No entry is duplicated across member cards.",
      "book.dupItem":"in {n} cards · saves {chars} chars",
      "book.dupMismatch":"name/keys differ",
      "book.promote":"Promote into the shared book",
      "book.promoteHint":"Move these N entries into the shared book and delete them from every card — do this before exporting and the cards hold no duplicates.",
      "book.promotePreview":"Will promote {n} and delete {m} duplicates across the cards",
      "book.promoteDone":"Promoted {n} (removed {m} duplicates)",
      "book.promoteSyncedDraft":"Current draft synced — removed {n} duplicates (saving would have written them back)",
      "book.exportBook":"Export shared lorebook JSON",
      "book.exported":"Exported {name}",
      "book.exportedSt":"Exported the SillyTavern lorebook “{name}” — pick it in SillyTavern via World Info → Import",
      "book.applyCard":"Merge into the current card",
      "book.applyDone":"Added {n} entries to the current card",
      "book.applyNone":"The current card already contains every entry of this book.",
      "book.entryName":"Entry name",
      "book.entryKeys":"Keys (comma separated)",
      "book.entryContent":"Content (may carry @@position / @@depth / @@activate decorators)",
      "book.refresh":"Refresh",
      "book.saved":"Saved (rev {rev})",
      "export.book.title":"Shared lorebook",
      "export.book.hint":"The shared setting of this card's group can be exported on its own: the CCv3 standalone lorebook for clients that support lorebook_v3, and the SillyTavern lorebook in ST's native shape ({entries:{…}}) — ST's importer accepts nothing else, so feeding it the CCv3 file answers Bad Request. In ST, import the lorebook first and the card second: the card carries the binding automatically (data.extensions.world); the entries inside the card still need one “Import Card Lore” click.",
      "export.stWorldBound":"SillyTavern world binding written: “{name}”",
      "export.close":"Close export",
      "export.book.loading":"Reading the shared lorebook of this card's group…",
      "export.book.none":"This card is in no group, or its group has no shared lorebook yet.",
      "export.book.button":"⬇ CCv3 standalone lorebook",
      "export.book.buttonSt":"⬇ SillyTavern lorebook",
      "export.book.merge":"Merge the shared entries into this card when exporting JSON (for clients without a global lorebook)",
      "export.book.merged":"({n} shared entries merged in)",
      "action.expand":"AI Expand",
      "action.validate":"Validate",
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
      // —— 0.11.0 LLM draft lock (writing protection / read-only / preview) ——
      "lock.bar.active":"🔒 LLM is writing “{name}” · workshop is read-only · last write {n} min ago",
      "lock.bar.activeHint":"When the draft is done, ask the LLM to call cc_release_draft (or turn off “LLM draft protection (draft lock)” in Settings).",
      "lock.bar.stale":"⏳ LLM has not written for {n} min · the draft was unlocked automatically (it re-locks on the next LLM write)",
      "lock.bar.preview":"👁 Preview “{name}” · not loaded — the LLM's draft is untouched",
      "lock.bar.previewHint":"Exit the preview to return to the draft the LLM is writing; loading another card only switches the preview and never overwrites the draft.",
      "lock.preview.exit":"Exit preview",
      "lock.msg.writeBlocked":"LLM is writing — this change was not written.",
      "lock.msg.loadedPreview":"Previewing “{name}” · the draft was not overwritten",
      "lock.msg.importedPreview":"Previewing the {k} card “{name}” · the draft was not overwritten",
      "lock.msg.exitPreview":"Left the preview — back to the LLM draft",
      "lock.msg.draftLockOff":"LLM draft protection is off: load/import overwrite the draft directly (legacy behavior)",
      "settings.behavior.draftLock":"LLM draft protection (draft lock)",
      "settings.behavior.draftLockDesc":"While the LLM writes this session's draft the workshop is read-only and load/import open a preview. Turn off to restore the legacy behavior.",
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
      "workshop.field.empty":"Empty",
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
      "workshop.export.currentHint":"Exports the card currently in the workshop; to export a saved one, load it from the right first",
      "workshop.export.savedCardHint":"Exporting the saved character “{name}”: read-only, the workshop draft is untouched and nothing needs to be loaded first",
      "workshop.export.creatorNotes":"creator_notes / i18n",
      "workshop.export.creationDate":"creation_date",
      "workshop.export.modificationDate":"modification_date (auto on export)",
      "workshop.draft.fresh":"⚠️ This session has a fresh blank draft (no saved history, possibly a new session after host restart). Please confirm this is an intended new card before editing; to continue an old card, load it from Saved Characters on the right.",
      "workshop.draft.recovered":"Draft auto-restored from disk (after host restart), creation_date={date}. Keep editing; this notice clears after the next write.",
      "workshop.slot.mismatch":"⚠ Draft slot mismatch: this read came from slot `{got}` while the current session is `{want}`. To avoid painting another slot's content as your draft, nothing was rendered; the next poll re-reads for the current session.",
      "workshop.slot.recover":"Another persisted draft was found: {name} ({n} lore entries, slot {key}). If it belongs to this session, migrate it in one click — nothing was lost, it was just written under a different key.",
      "workshop.slot.migrateOne":"Migrate {key} ({n} lore)",
      "workshop.slot.migrated":"Migrated slot {key} into this session ({n} lore entries).",
      "workshop.slot.migrateFailed":"Failed to migrate the draft slot",
      "workshop.preview.title":"Live CCv3 Preview",
      "workshop.preview.cbsTitle":"CBS Cheatsheet",
      "workshop.preview.cbsHint":"Case-insensitive, escape comma with \\,.",
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
      // —— 0.8.0 relationship graph / group chat ——
      "workshop.group.all":"All",
      "workshop.group.none":"Ungrouped",
      "workshop.group.new":"+ Group",
      "workshop.group.summary":"{n} cards / {m} relations",
      "workshop.group.newGroup":"+ New group",
      "workshop.group.empty":"(empty)",
      "workshop.group.needRestart":"The host half is still running old code (these buttons need a dsh restart): quit and reopen the desktop app (or restart dsh web), then reload the page.",
      "workshop.group.prompt":"New group name (characters of one world go together)",
      "workshop.group.assign":"Group",
      "workshop.group.set":"Grouped",
      "workshop.rel.title":"Relationships",
      "workshop.rel.open":"Relations",
      "workshop.rel.pickGroup":"Pick a specific group on the left (no editable relations under All / Ungrouped).",
      "workshop.rel.noGroup":"No group",
      "workshop.rel.members":"Member cards",
      "workshop.rel.noMember":"(no cards yet — use the “Group” button on a card row to pull in cards of the same world)",
      "workshop.rel.edges":"Relations",
      "workshop.rel.noEdge":"(none yet: add one with the form below, or let the model build them with cc_patch_relations)",
      "workshop.rel.add":"Add relation",
      "workshop.rel.addNode":"+ NPC",
      "workshop.rel.nodePrompt":"NPC name (someone without their own card, e.g. an elder)",
      "workshop.rel.from":"From",
      "workshop.rel.to":"To",
      "workshop.rel.strength":"Strength",
      "workshop.rel.direction":"Direction",
      "workshop.rel.dirMutual":"Mutual",
      "workshop.rel.dirOneWay":"One-way",
      "workshop.rel.note":"Note",
      "workshop.rel.check":"Check",
      "workshop.rel.render":"Render into current card",
      "workshop.rel.rendered":"Wrote {n} relations into the current card (remember to “Save current”)",
      "workshop.rel.checkResult":"Check: {n} issue(s)",
      "workshop.rel.checkOk":"Check passed: no structural issues",
      "workshop.rel.checkStats":"Check: {e} error(s) · {w} warning(s)",
      "workshop.rel.checkPass":"Check passed: no issues",
      "workshop.consistency.title":"Canon: {n} rule(s)",
      "workshop.consistency.derived":"auto-derived",
      "workshop.consistency.ok":"Consistency check passed: no length/duplicate/coverage issues",
      "workshop.audit.title":"Audit",
      "workshop.audit.summary":"{e} error(s) · {w} warning(s)",
      "workshop.audit.anchor":"Time anchoring",
      "workshop.audit.hook":"Unsettled hooks",
      "workshop.audit.canon":"Setting canon",
      "workshop.audit.lore":"Lorebook",
      "workshop.audit.other":"Other",
      "workshop.audit.goto":"Fix",
      "workshop.rel.saved":"Relations updated (rev {rev})",
      "workshop.rel.needLoad":"Load a card on the left first: rendering needs to know which card to write into",
      "workshop.rel.hint":"Relations live on the plugin side only and are never written into CCv3 fields; “Render into current card” writes them into the 【关系】 block of description so a shared card stays self-contained.",
      "rel.type.family":"Family",
      "rel.type.romance":"Romance",
      "rel.type.mentor":"Mentor",
      "rel.type.friend":"Close friend",
      "rel.type.colleague":"Colleague",
      "rel.type.rival":"Rival",
      "rel.type.enemy":"Enemy",
      "rel.type.debt":"Obligation",
      "rel.type.superior":"Superior",
      "rel.type.other":"Other",
      "workshop.library.new":"＋ New",
      "workshop.library.actions":"Actions (import / update / save-as / rename)",
      "workshop.library.searchPlaceholder":"Search name/tags…",
      "workshop.library.empty":"No saved characters\nFill World/Character then ★ Save Current",
      "workshop.library.noMatch":"No matches",
      "workshop.library.load":"Load",
      "workshop.library.export":"Export",
      "workshop.library.exportTip":"Open the export dialog for this saved card (no need to load it first)",
      "workshop.library.exportJumped":"Opened ✓",
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
      "store.importedUpgraded":"{v} card upgraded to CCv3",
      "store.errImportFailed":"Import failed: {msg}",
      "store.errReadFileFailed":"Failed to read the file",
      "store.parsingJson":"Parsing JSON…",
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
      "store.confirmClear":"Clear everything in the current card?\n\nSaved characters in the library are untouched. This cannot be undone.",
      "store.cleared":"Current card cleared (saved characters untouched)",
      "store.loadedCard":"Loaded: {name} · {n} lore (ID:{id}, saving again will update this card)",
      "store.errLoadFailed":"Load failed",
      "store.confirmDelete":"Delete this character? This cannot be undone.",
      "relations.confirmDeleteGroup":"Delete this group? Its nodes, relations and the group's shared lorebook (if any) go with it, and this cannot be undone. Member cards are not deleted — they just leave the group.",
      "book.dupBook":"{n} more entries in the member cards are byte-identical to the shared book (copies merged into the cards) — promoting also cleans those up, without adding anything to the book.",
      "store.deleted":"Deleted",
      "store.errDeleteFailed":"Delete failed",
      "store.needLoadFirst":"Load a card before renaming",
      "store.promptRename":"Enter a new name",
      "store.renamed":"Renamed to: {name}",
      "store.errRenameFailed":"Rename failed",
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
      "workshop.field.creator":"creator / author",
      "workshop.field.mesExample":"mes_example ({{user}}/{{char}})",
      "workshop.edit.title":"{title} · Large editor",
      "workshop.edit.fallbackTitle":"Edit",
      "workshop.library.expand":"Expand saved characters",
      "workshop.library.saveTip":"Save current draft ({name})",
      "workshop.library.noCcHint":"Switch to CC Mode and let the LLM guide you",
      "workshop.preview.cbsComment":"{{// comment}}",
      "workshop.field.depthNote":"Character's Note (injected every turn by ST)",
      "workshop.field.depthHint":"Read-only · written by CC Mode",
      "st.title":"Import into {label}",
      "st.online":"online",
      "st.offline":"not detected",
      "st.probing":"checking…",
      "st.needAuth":"needs auth",
      "st.forbidden":"refused",
      "st.probe":"Check again",
      "st.hint":"When a local SillyTavern is detected you can push the exported card and the shared lorebook straight into it: the lorebook goes first, then the card, and the card is bound to that book automatically.",
      "st.showAuth":"Auth (optional)",
      "st.hideAuth":"Hide auth",
      "st.user":"Username",
      "st.pass":"Password (not saved)",
      "st.import":"Import",
      "st.importing":"Importing…",
      "st.imported":"Imported: {card} · lorebook {world}",
      "st.overwrite":"Overwrite an existing lorebook with the same name",
      "st.cover":"Choose a cover",
      "st.coverClear":"Remove cover",
      "st.footnote":"Writes into SillyTavern's characters/ and worlds/ folders; importing again adds another card (existing cards are never overwritten).",
      "st.errOffline":"SillyTavern not detected: make sure it is running at the right address; if it is on another machine, check its whitelist.",
      "st.errAuth":"SillyTavern requires Basic auth: enter the username and password, then retry.",
      "st.errForbidden":"SillyTavern refused the request (403): check whitelist / login mode, or this ST does not support the import.",
      "st.errCsrf":"SillyTavern rejected the CSRF token: please retry.",
      "st.errBadUrl":"Invalid SillyTavern address (http/https only).",
      "st.errBadResponse":"That endpoint is not a recognizable SillyTavern (or the version is too old).",
      "st.errBookFailed":"Lorebook import failed; the card was not imported.",
      "st.errImportFailed":"Character card import failed.",
      "st.errTooLarge":"Cover image too large (20MB max).",
      "st.errCover":"The cover is not a usable image: choose a PNG / JPG.",
      "st.errBuild":"Failed to build the character card PNG (cover or card data problem).",
      "st.errNoRemote":"The selected export target does not support direct import."
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
            autoSaveOnImport: !!s.autoSaveOnImport,
            // 默认开：升级上来的老设置里没有这个键，`!==false` 才会把默认值定成 true（旧行为只在新用户里成立）。
            draftLock: s.draftLock!==false,
            // 0.15.0 远程导入：地址默认留空，取宿主 cc_listTargets 里 remote.defaultBaseUrl（不在这里写死平台端口）。
            stBaseUrl: typeof s.stBaseUrl==="string" ? s.stBaseUrl : "",
            stAutoProbe: s.stAutoProbe!==false,
            stWorldMode: s.stWorldMode==="overwrite" ? "overwrite" : "skip",
            stUser: typeof s.stUser==="string" ? s.stUser : ""
          };
        }catch(e){}
        return { poll:true, pollInterval:4, autoValidate:true, autoSaveOnImport:false, draftLock:true,
          stBaseUrl:"", stAutoProbe:true, stWorldMode:"skip", stUser:"" };
      }
      var _saved = loadSettings();
      // 兼容旧开关：poll=false 视为 0 秒
      if(_saved.poll===false) _saved.pollInterval = 0;
      // 0.12.3：CC 模式状态必须带「归属」（ccSessionId）。isCcMode 只是一个显示位，
      // 没有归属时它会在切会话的瞬间把上一个会话的结论当成新会话的结论 ——
      // 这就是「从 CC 会话切到非 CC 会话，胶囊不消失、要再切一次才消失」的根因。
      var state={ draft: draft, draftStatus: null, cur:0, panelOpen:false, sideExpanded:false, isCcMode:false, ccSessionId:null, ccSource:"none", currentSessionId:null, slotWarn:null, alternateSlots:null, world:{ timeline:"", factions:"", geo:"", power:"", daily:"" }, busy:null, valid:{valid:true,errors:[],warnings:[]}, validationReport:null, lastMsg:null, library:[], libraryQuery:"", libraryCollapsed:false, libraryBusy:null, groups:[], currentGroupId:"", relations:null, relBusy:null, relIssues:null, relByCheck:null, currentLibraryId:null, book:null, bookBusy:null, bookMerge:false, editingWorld:null, editingWorldRevert:null, editingText:null, pollEnabled:_saved.poll, pollInterval:_saved.pollInterval, autoValidate:_saved.autoValidate, autoSaveOnImport:_saved.autoSaveOnImport, draftLock:_saved.draftLock, lock:null, preview:null, llmDraft:null, llmWorld:null, llmDraftStatus:null, targets:null, exportOpen:false, exportTarget:null, exportBook:null, exportBookBusy:false,
        // 0.15.0 远程导入（SillyTavern）：地址/自动探测/同名书策略/认证都放 store；
        // 密码只在本次会话内存（stPass），绝不写 localStorage。
        stBaseUrl:_saved.stBaseUrl, stAutoProbe:_saved.stAutoProbe, stWorldMode:_saved.stWorldMode,
        stUser:_saved.stUser, stPass:"", stShowAuth:false, stProbe:null, stBusy:null, stResult:null,
        stImageB64:null, stImageName:null };
      var listeners=new Set();
      function emit(){ listeners.forEach(function(fn){ try{fn();}catch(e){console.error(e);} }); }
      function getSnapshot(){ return state; }
      function subscribe(fn){ listeners.add(fn); return function(){ listeners.delete(fn); }; }
      function set(up){ state=Object.assign({}, state, up); emit(); }
      function setCur(i){ set({cur:i}); }
      // 0.14.0：导出是「一次动作」，不是「一个页面」——弹层开关放 store，入口/测试/热更新残留都能统一控制。
      // 0.14.1：`exportTarget` = 「这次导出哪张卡」：null = 当前工坊草稿；`{id,name,card}` = 角色库里那张已存卡
      // （点哪张导哪张，不要求先载入）。导出动作把 `id` 作为 `cardId` 传给宿主，由宿主按 id 读盘。
      /**
       * 打开导出弹层（0.14.2）：`target.groupId` 若指向**另一个分组**，顺带把那个组的共享书取回来
       * （`exportBook`）—— 弹层里的共享书块/导出动作都按这张卡自己的分组走，而不是工坊当前分组。
       */
      function openExport(target){
        var tgt = target || null;
        var cur = String(state.currentGroupId || "");
        var gid = tgt ? String(tgt.groupId || "") : "";
        var needOther = !!gid && gid !== "__none" && gid !== cur;
        set({ exportOpen:true, exportTarget:tgt, exportBook:null, exportBookBusy: needOther });
        // 0.15.0：打开弹层时顺手探测本机 ST（失败静默，60s 内复用结果；按钮旁边有「重新检测」）
        if(state.stAutoProbe) probeSt(false);
        if(!needOther) return;
        var wantId = tgt && tgt.id;
        rpc("cc_getBook", { groupId: gid }).then(function(res){
          // 晚到的响应（用户已经关掉弹层 / 换了目标）直接丢弃，不能让旧书覆盖新目标
          if(!(state.exportTarget && String(state.exportTarget.id) === String(wantId))) return;
          var bk = (res && res.ok && res.value) ? res.value : null;
          set({ exportBookBusy:false, exportBook: bk && bk.exists ? bk : { exists:false } });
        }).catch(function(){
          if(state.exportTarget && String(state.exportTarget.id) === String(wantId)){
            set({ exportBookBusy:false, exportBook:{ exists:false } });
          }
        });
      }
      function closeExport(){ set({exportOpen:false, exportTarget:null, exportBook:null, exportBookBusy:false}); }
      /** 当前导出作用域：目标组 id 与对应的共享书（库卡模式可能来自另一个分组）。 */
      function exportScope(){
        var tgt = state.exportTarget;
        var cur = String(state.currentGroupId || "");
        if(tgt){
          var gid = String(tgt.groupId || "");
          if(!gid || gid === "__none") return { gid:"", book:null, other:false };
          if(gid === cur) return { gid:gid, book:state.book, other:false };
          return { gid:gid, book:state.exportBook, other:true };
        }
        return { gid:cur, book:state.book, other:false };
      }
      /** 导出副本要写进 `data.extensions.world` 的世界书名 —— 跟随导出作用域（库卡可能是别的组的书）。 */
      function exportWorldName(){
        var sc = exportScope();
        var bk = sc.book;
        if(!bk || !bk.exists) return "";
        return String((bk.book && bk.book.data && bk.book.data.name) || "").trim();
      }
      /** 目标组名（弹层里显示「按该卡所属分组读取」）；找不到时退回 id。 */
      function exportGroupName(gid){
        var list = state.groups || [];
        for(var i=0;i<list.length;i++){ if(String(list[i].id) === String(gid)) return String(list[i].name || gid); }
        return String(gid || "");
      }
      /** 0.14.1：点卡片「导出」= 只读地取回这张库卡并打开导出弹层（不碰草稿槽、不要求先载入）。 */
      function exportLibraryCard(entry){
        var id = String((entry && entry.id) || "");
        if(!id) return Promise.resolve(false);
        return rpc("cc_getLibraryEntry", { id: id }).then(function(res){
          if(res && res.ok && res.value && res.value.draft){
            var name = String((res.value.meta && res.value.meta.name) || (entry && entry.name) || "");
            openExport({ id: id, name: name, card: res.value.draft, groupId: String((res.value.meta && res.value.meta.groupId) || "") });
            return true;
          }
          set({lastMsg:String((res && res.error && res.error.message) || t("common.unknownError"))});
          return false;
        }).catch(function(e){ set({lastMsg:String(e && e.message || e)}); return false; });
      }
      function setPanel(o){ set({panelOpen: !!o}); }
      function setSideExpanded(v){ set({sideExpanded: !!v}); }
      // 原 trigger()/triggered 已删除：trigger() 无任何调用点；而 triggered 的唯一写入者是 setIsCcMode，
      // 写值恒等于 isCcMode，因此渲染条件里的 !s.triggered 是冗余项（删除前后行为完全一致）。
      //
      // —— 0.12.3：CC 模式状态的两个写入口（**只有这两个**，组件层不许直接写 isCcMode）——
      // ① applyCcVerdict：会话域实例（Capsule，拿得到会话 id）用。结论必须归属于**当前会话**，
      //    否则丢弃 —— 切会话期间晚到的 cc_isCcMode 响应会把上一个会话的结论写到新会话上。
      // ② applyChromeCc：根域实例（Workshop，shell.overlay 拿不到会话 id）用。只允许在
      //    「没有会话上下文」时表达结论（新会话页的预设芯片），**绝不覆盖会话域的结论** ——
      //    这就是 issue #5「根域每秒 evaluate 把会话域判定清掉 → 胶囊一闪一闪」的结构性修法：
      //    以前靠调用点的 canConclude 变量绕，现在根域根本没有改会话域结论的能力。
      function applyCcVerdict(sessionId, isCc, source){
        var sid = (typeof sessionId==="string" && sessionId) ? sessionId : null;
        if(!sid || sid !== (state.currentSessionId||null)) return false;   // 不属于当前会话：丢弃
        var next = !!isCc;
        var src = source || "none";
        if(next === state.isCcMode && state.ccSessionId === sid && state.ccSource === src) return false;
        set({ isCcMode: next, ccSessionId: sid, ccSource: src });
        return true;
      }
      function applyChromeCc(isCc){
        if((state.currentSessionId||null) !== null) return false;          // 会话域在管：根域无权表态
        if((state.ccSessionId||null) !== null) return false;               // 当前结论属于某个会话：不许覆盖
        var next = !!isCc;
        if(next === state.isCcMode) return false;
        // 「熄灭」只熄根域自己点亮的那一个：投影 / 主机得出的结论（哪怕 currentSessionId 一时
        // 还没发布、看起来像「没有会话」）不能被根域的 DOM 判断冲掉。
        if(!next && state.ccSource !== "dom") return false;
        set({ isCcMode: next, ccSource: "dom" });
        return true;
      }
      // 兼容旧调用（导出面 + 既有测试）：等价于根域的受限写入口。
      function setIsCcMode(v){ return applyChromeCc(v); }
      function setDraftFromHost(draft, status){ try{ var j=JSON.stringify(draft); var curJ=JSON.stringify(state.draft); var stJ=JSON.stringify(status||null); var curStJ=JSON.stringify(state.draftStatus||null); if(stJ!==curStJ) set({draftStatus: status||null}); if(j!==curJ){ var w=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(w && typeof w==="object"){ var nw={ timeline:String(w.timeline||""), factions:String(w.factions||""), geo:String(w.geo||""), power:String(w.power||""), daily:String(w.daily||"") }; var curW=state.world; if(JSON.stringify(nw)!==JSON.stringify(curW)) set({draft: draft, world: nw}); else set({draft: draft}); } else set({draft: draft}); } }catch(e){ try{ var ww=draft&&draft.data&&draft.data.extensions&&draft.data.extensions.cc_world; if(ww){ var nn={ timeline:String(ww.timeline||""), factions:String(ww.factions||""), geo:String(ww.geo||""), power:String(ww.power||""), daily:String(ww.daily||"") }; set({draft: draft, world: nn}); } else set({draft: draft}); }catch(e2){ set({draft: draft}); } } }
      /**
       * 发布「当前会话」。**会话一变，CC 模式的结论立刻作废**（0.12.3 的核心修复）。
       *
       * 旧实现只在有 id 时写、从不写 null，也从不碰 isCcMode：
       *   ① 从 CC 会话切到非 CC 会话时，isCcMode 还是上一个会话的 true，胶囊赖着不走；
       *      能不能翻回 false 完全取决于「那一瞬间会话投影恰好可用」——用户看到的是
       *      「再切一次才消失」（第二次切换时投影才到）。
       *   ② 切到新会话页（此时没有会话）时 currentSessionId 永远停在上一个会话，根域实例
       *      继续拿旧会话 id 判定，新会话页的预设芯片永远接管不了。
       * 现在：id 变化 = 旧结论与旧会话一起进入「待定」（isCcMode=false + ccSessionId=null），
       * 由会话投影或主机 RPC 重新确认（见 useCcPreset）。宁可短暂不显示，也不显示错的。
       */
      function setSessionId(id){
        var next = (typeof id==="string" && id) ? id : null;
        if(next === (state.currentSessionId||null)) return;
        set({
          currentSessionId: next,
          isCcMode: false,
          ccSessionId: null,
          ccSource: next ? "pending" : "none"
        });
      }
      // 草稿槽不一致告警（issue #5）：主机回传的 key 与我们要的不是同一把时，绝不把它当当前草稿画出来。
      function setSlotWarn(w){ set({slotWarn: w||null}); }
      function setAlternateSlots(list){ set({alternateSlots: (list && list.length)? list : null}); }
      // ———————————————— 0.11.0 LLM 草稿锁：只读 / 只读预览 ————————————————
      // 锁的状态来自宿主 cc_getDraft 的 draftStatus.lock（不另开端点）：轮询本来就在跑，
      // 多一条 RPC 只会多出一个「客户端与宿主对锁看法不一致」的窗口。
      // 判定必须只用宿主给的字段（stale / active 由宿主按自己的时钟算好）：客户端再算一遍时间，
      // 一旦两边时钟/时区有偏差，就会出现「宿主说锁着、界面说能写」的裂缝。
      function setLock(lock){
        var next = (lock && typeof lock==="object") ? lock : null;
        try{ if(JSON.stringify(next)===JSON.stringify(state.lock||null)) return; }catch(e){}
        set({lock:next});
      }
      /** LLM 是否正持有这把会话槽的创作锁（且用户没关保护）。stale = 超过 TTL 未写入 → 视为可编辑。 */
      function isLockActive(){
        return !!state.draftLock && !!state.lock && state.lock.owner==="llm" && !state.lock.stale;
      }
      /** 只读 = LLM 锁生效 或 正在只读预览。所有会动草稿的 store 动作都先问这一句。 */
      function isReadOnly(){
        return isLockActive() || !!state.preview;
      }
      /** 从草稿里取五维（与 setDraftFromHost 同一套字段），给预览的快照/恢复用。 */
      function worldOfDraft(draft){
        try{
          var w = draft && draft.data && draft.data.extensions && draft.data.extensions.cc_world;
          if(!w || typeof w!=="object") return null;
          return { timeline:String(w.timeline||""), factions:String(w.factions||""), geo:String(w.geo||""), power:String(w.power||""), daily:String(w.daily||"") };
        }catch(e){ return null; }
      }
      /**
       * 预览期间宿主草稿（LLM 那份）的最新副本：只写 llm*，**绝不碰正在显示的 draft**。
       * 不比较 ageSec 之类的易变字段，比较整份 JSON —— 没变就不 emit，免得每 4s 白重渲染一次工坊。
       */
      function setLlmDraft(draft, status){
        var st = status || null;
        var lw = worldOfDraft(draft);
        var up = {};
        try{ if(JSON.stringify(draft)!==JSON.stringify(state.llmDraft)) up.llmDraft = draft; }catch(e){ up.llmDraft = draft; }
        try{ if(JSON.stringify(st)!==JSON.stringify(state.llmDraftStatus||null)) up.llmDraftStatus = st; }catch(e){ up.llmDraftStatus = st; }
        if(lw && JSON.stringify(lw)!==JSON.stringify(state.llmWorld)) up.llmWorld = lw;
        if(up.llmDraft!==undefined || up.llmDraftStatus!==undefined || up.llmWorld!==undefined) set(up);
      }
      function previewNameOf(prev){
        try{
          var meta = prev && prev.meta;
          var d = prev && prev.draft && prev.draft.data;
          var name = (meta && meta.name) || (d && d.name) || "";
          return String(name).trim() || t("workshop.library.unnamed");
        }catch(e){ return t("workshop.library.unnamed"); }
      }
      /**
       * 进入只读预览：宿主在锁 active 时**不写草稿**，只回「假如载入/导入会变成什么」。
       * 三条自律：
       *   ① 首次进入时把 LLM 那份草稿/五维/状态整份存进 llm*（连续预览第二张只换预览卡，
       *      否则第一张就被第二张的快照顶掉，退出预览会回错版本）；
       *   ② currentLibraryId 与当前分组**不动** —— 预览不是载入，退出后必须原样回到 LLM 的上下文；
       *   ③ 显示用 setDraftFromHost 换上预览卡（五维跟着草稿里的 cc_world 走）。
       */
      function enterPreview(prev){
        if(!prev || !prev.draft) return;
        var first = !state.preview;
        var up = { preview:{ id:(prev.id==null? "": String(prev.id)), name:previewNameOf(prev), meta:prev.meta||null, upgradedFrom:prev.upgradedFrom||null } };
        if(first){ up.llmDraft = state.draft; up.llmWorld = state.world; up.llmDraftStatus = state.draftStatus; }
        set(up);
        setDraftFromHost(prev.draft, state.draftStatus||null);
      }
      /** 退出预览：把 LLM 那份草稿恢复成显示内容（期间轮询到的最新版本在 llmDraft 里）。 */
      function exitPreview(){
        if(!state.preview) return;
        var draft = state.llmDraft;
        var world = state.llmWorld;
        var st = state.llmDraftStatus;
        set({preview:null, llmDraft:null, llmWorld:null, llmDraftStatus:null});
        if(draft) setDraftFromHost(draft, st||null);
        if(world) set({world: world});
        set({lastMsg: t("lock.msg.exitPreview")});
      }
      /**
       * 设置页关掉「LLM 创作保护」= 完全旧行为：所有写类 RPC 显式带 force:true，
       * 宿主据此跳过锁检查（并顺手清掉那把锁）。读类请求（cc_getDraft 等）不带。
       */
      function forceArgs(args){
        var out = Object.assign({}, args||{});
        if(!state.draftLock) out.force = true;
        return out;
      }
      // 把另一把槽的内容迁进当前会话槽（用户点「迁入当前会话槽」时调用）
      async function migrateSlot(from){
        // 迁移会整份覆盖当前槽的草稿 —— 锁定/预览期间绝不能做（宿主也会拦，这里先一步不发请求）
        if(isReadOnly()) return;
        var to = state.currentSessionId || null;
        if(!from || !to) return;
        set({busy:"migrate"});
        try{
          var res=await rpc("cc_migrateDraft", forceArgs({from: from, to: to, sessionId: to}));
          if(res && res.ok && res.value && res.value.draft){
            setDraftFromHost(res.value.draft, res.value.draftStatus||null);
            // 迁过一次就不再重复提示「盘上还有一份 default 草稿」——源槽内容不删（不做破坏性操作），
            // 但每开一个新会话都弹一次同样的横幅只会变成噪音。
            if(from==="default"){ try{ localStorage.setItem("dsh-cc-studio-legacy-notice","1"); }catch(e){} }
            set({busy:null, slotWarn:null, alternateSlots:null, currentLibraryId:null,
              lastMsg: t("workshop.slot.migrated",{key:from, n:String((res.value.moved && res.value.moved.entries)||0)})});
          } else {
            set({busy:null, lastMsg: t("workshop.slot.migrateFailed") + (res && res.error ? (" — "+String(res.error.message)) : "")});
          }
        }catch(e){ set({busy:null, lastMsg: t("workshop.slot.migrateFailed")+" — "+String(e.message)}); }
      }
      function saveSettings(){
        try{ localStorage.setItem("dsh-cc-studio-settings", JSON.stringify({ poll: !!state.pollEnabled, pollInterval: Number(state.pollInterval)||0, autoValidate: !!state.autoValidate, autoSaveOnImport: !!state.autoSaveOnImport, draftLock: !!state.draftLock,
          stBaseUrl: String(state.stBaseUrl||""), stAutoProbe: !!state.stAutoProbe, stWorldMode: state.stWorldMode==="overwrite"?"overwrite":"skip", stUser: String(state.stUser||"") })); }catch(e){}
      }
      function setPollEnabled(v){ var on=!!v; var interval = on ? (state.pollInterval||4) : 0; if(!on) interval=0; if(on && interval===0) interval=4; set({pollEnabled: on, pollInterval: interval}); saveSettings(); }
      function setPollInterval(sec){ var n=Math.max(0, Math.min(30, Math.round(Number(sec)||0))); var on = n>0; set({pollInterval: n, pollEnabled: on}); saveSettings(); }
      function setAutoValidate(v){ set({autoValidate: !!v}); saveSettings(); }
      function setAutoSaveOnImport(v){ set({autoSaveOnImport: !!v}); saveSettings(); }
      // 「LLM 创作保护」总开关：关掉 = 完全恢复旧行为（写 RPC 一律带 force:true，锁不再置只读）。
      function setDraftLock(v){
        var on=!!v;
        set({draftLock: on});
        if(!on) set({lastMsg: t("lock.msg.draftLockOff")});
        saveSettings();
      }
      function pushDraftToHost(){
        // 第二道闸：UI 已经只读（输入框 readOnly / 按钮 disabled），这里防的是「锁在两次轮询之间
        // 突然出现」与程序化调用 —— 锁定时把本地草稿推上去，等于替 LLM 覆盖它正在写的内容。
        if(isReadOnly()) return;
        try{
          var sid = state.currentSessionId || null;
          var args = sid ? {draft: state.draft, sessionId: sid} : {draft: state.draft};
          ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_setDraft",{args:forceArgs(args)}).then(function(res){
            // 「拉草稿」与「写草稿」之间的窗口里 LLM 上了锁：宿主明确拒绝（details.code=draft-locked）。
            // 拉一次 cc_getDraft 把锁与盘上真实草稿拉回来，并把「这次修改没写进去」说清楚 ——
            // 否则用户只会看到刚打的字过几秒自己变回去，完全不知道发生了什么。
            if(res && res.ok===false && res.error && res.error.details && res.error.details.code==="draft-locked"){
              set({lastMsg: t("lock.msg.writeBlocked")});
              refreshFromHostForLock();
            }
          }).catch(function(){});
        }catch(e){}
      }
      /** 写被锁拒绝后的补救：拉一次 cc_getDraft，刷新锁（顺带同步盘上真实草稿）。没有会话 id 就不拉（铁律）。 */
      function refreshFromHostForLock(){
        var sid = state.currentSessionId || null;
        if(!sid) return Promise.resolve();
        return rpc("cc_getDraft", {sessionId: sid}).then(function(res){
          if(!res || !res.ok || !res.value) return;
          var st = res.value.draftStatus || null;
          if(st) setLock(st.lock || null);
          if(!res.value.draft) return;
          if(state.preview) setLlmDraft(res.value.draft, st);
          else setDraftFromHost(res.value.draft, st);
        }).catch(function(){});
      }
      // —— 主机侧的 CC 模式确认（0.12.3 重写）——
      // 旧实现有三个坑叠在一起：
      //   ① 响应没有会话归属校验：切会话期间晚到的 cc_isCcMode 会把上一个会话的结论写到新会话上；
      //   ② _ccCheckInflight 直接丢弃「同会话的第二次请求」，于是切换过程中最重要的一次确认消失；
      //   ③ 唯一的调用点带着 `if(!isCcMode)` 的前置条件 —— 从「是」切到「不是」的路径**永远问不到主机**，
      //      而这条路径正是用户报的 bug（切到非 CC 会话胶囊不消失）。
      // 现在：查询序号 + 当前会话归属双重校验；失败一律不写（宁可不显示，也不写假结论）。
      var _ccCheckAt = {};
      var _ccSeq = 0;
      function checkIsCcMode(sessionId, force){
        var key = (typeof sessionId==="string" && sessionId) ? sessionId : null;
        if(!key) return Promise.resolve(false);
        var now = Date.now();
        // 同一会话 5s 内最多查一次；force 绕过（会话刚切换时必须立刻查）
        if(!force && _ccCheckAt[key] && now - _ccCheckAt[key] < 5000) return Promise.resolve(false);
        _ccCheckAt[key] = now;
        var seq = ++_ccSeq;
        return rpc("cc_isCcMode", {sessionId: key}).then(function(res){
          if(seq !== _ccSeq) return false;                          // 已经有更新的一次查询
          if((state.currentSessionId||null) !== key) return false;   // 已经切走了
          if(!res || !res.ok) return false;                          // 查询失败：保持现状，不写假结论
          return applyCcVerdict(key, !!(res.value && res.value.isCc), "host");
        }).catch(function(){ return false; });
      }
      function updateDraft(mut){
        // 只读（LLM 锁定 / 预览）时连本地草稿都不改：改了不落盘，下一次轮询就会被宿主版本覆盖 ——
        // 用户看到的是「刚打的字凭空消失」，比一开始就拦下来更费解。
        if(isReadOnly()) return;
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
          if(res && res.ok){ set({busy:null, valid: res.value, lastMsg: res.value.valid? t("store.validatePassed"):t("store.validateFailed"),
            // 0.19.0：把一致性清单留在 store 里给工具栏面板用（只存本次结果，不累积）。
            validationReport: { at: Date.now(),
              consistency: res.value.consistency || null,
              canon: res.value.canon || null } }); }
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
      /**
       * 导入结果的统一收尾。`upgradedFrom` 非空 = 这份卡原来是 V2/V1（0.9.1 B2 自动升级成 CCv3），
       * 必须在提示里说出来 —— 静默把一张 V2 卡变成 V3 形状不算「什么都没发生」。
       */
      function handleImportedDraft(obj, label, upgradedFrom){
        // 非锁定导入 = 真的要写草稿（锁已释放/超时，或用户关掉了保护）：先把预览态清掉，
        // 否则横幅还挂在「预览 xxx」，显示内容却已经被换成导入的卡（两个状态互相矛盾）。
        if(state.preview) set({preview:null, llmDraft:null, llmWorld:null, llmDraftStatus:null});
        obj.spec_version=obj.spec_version||"3.0";
        obj.data.character_book=obj.data.character_book||{name:"",description:"",scan_depth:4,token_budget:1200,recursive_scanning:false,extensions:{},entries:[]};
        if(!Array.isArray(obj.data.character_book.entries)) obj.data.character_book.entries=[];
        if(!Array.isArray(obj.data.group_only_greetings)) obj.data.group_only_greetings=[];
        if(!Array.isArray(obj.data.alternate_greetings)) obj.data.alternate_greetings=[];
        if(!Array.isArray(obj.data.tags)) obj.data.tags=[];
        if(!Array.isArray(obj.data.assets)) obj.data.assets=[{type:"icon",uri:"ccdefault:",name:"main",ext:"png"}];
        setDraftFromHost(obj);
        var msg=t("store.importedOk",{k:label.trim(), name:(obj.data.name||t("workshop.library.unnamed")), n:(obj.data.character_book.entries.length||0)});
        if(upgradedFrom) msg += " · " + t("store.importedUpgraded",{v:(String(upgradedFrom)==="chara_card_v1"? "V1":"V2")});
        set({currentLibraryId:null, lastMsg: msg});
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
      /**
       * 宿主在锁 active 时把导入结果原样退回（`locked:true` + `preview`），**不写草稿**。
       * 这里只负责进只读预览 + 保留 upgradedFrom 提示；自动校验/自动保存都不能跑 ——
       * 那会把「只是看了一眼」的预览卡真的写进角色库（用户没点过保存）。
       */
      function enterPreviewFromLocked(res, label){
        if(!res || !res.ok || !res.value || res.value.locked!==true || !res.value.preview) return false;
        setLock(res.value.lock || null);   // 同 loadFromLibrary：响应里的锁立刻生效，别等下一次轮询
        enterPreview(res.value.preview);
        // 方括号读 upgradedFrom：st-compat 的源码守卫按字面量统计「三条导入路径都把它交给提示」，
        // 这里的共用收尾不该被算成第四条路径。
        var upgradedFrom = (res.value && res.value["upgradedFrom"]) || null;
        var msg = t("lock.msg.importedPreview", {k:String(label||"").trim(), name:previewNameOf(res.value.preview)});
        if(upgradedFrom) msg += " · " + t("store.importedUpgraded",{v:(String(upgradedFrom)==="chara_card_v1"? "V1":"V2")});
        set({lastMsg: msg});
        return true;
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
              // 0.9.1（B2）：JSON 也交给宿主升级 —— 客户端以前自己 parse 且只认 chara_card_v3，
              // 于是 ST 里导出的 V2 卡一张都进不来。现在三条导入路径（JSON/PNG/CHARX）共用宿主那份
              // upgradeCardToV3，客户端只负责把文本递过去、把「已升级」说出来。
              var reader=new FileReader();
              reader.onload=function(){
                try{
                  var text=String(reader.result||"");
                  var sid=state.currentSessionId||null;
                  var args=forceArgs(sid?{json:text, sessionId:sid}:{json:text});
                  set({lastMsg:t("store.parsingJson"), busy:"importJson"});
                  rpc("cc_importFromJson", args).then(function(res){
                    set({busy:null});
                    if(enterPreviewFromLocked(res, " JSON")) return;
                    if(res && res.ok && res.value && res.value.draft){
                      handleImportedDraft(res.value.draft, " JSON", res.value.upgradedFrom);
                    } else set({lastMsg:t("store.errImportFailed",{msg:(res&&res.error?String(res.error.message):t("common.unknownError"))})});
                  }).catch(function(e){ set({busy:null, lastMsg:t("store.errImportFailed",{msg:String(e&&e.message||e)})}); });
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
                  var args=forceArgs(sid?{b64:b64, sessionId:sid}:{b64:b64});
                  set({lastMsg:t("store.parsingPng"), busy:"importPng"});
                  rpc("cc_importFromPng", args).then(function(res){
                    set({busy:null});
                    if(enterPreviewFromLocked(res, " PNG")) return;
                    if(res && res.ok && res.value && res.value.draft){
                      handleImportedDraft(res.value.draft, " PNG", res.value.upgradedFrom);
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
                  var args2=forceArgs(sid2?{b64:b64c, sessionId:sid2}:{b64:b64c});
                  set({lastMsg:t("store.parsingCharx"), busy:"importCharx"});
                  rpc("cc_importFromCharx", args2).then(function(res){
                    set({busy:null});
                    if(enterPreviewFromLocked(res, " CHARX")) return;
                    if(res && res.ok && res.value && res.value.draft){
                      handleImportedDraft(res.value.draft, " CHARX", res.value.upgradedFrom);
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

      /**
       * 导出 JSON。0.9.0：若在导出页勾了「并入共享条目」，则**只在导出的副本上**把该组的共享世界书
       * 里卡里还没有的条目补进去（给不支持全局世界书的客户端兜底）——草稿本身一个字节都不动。
       * 0.9.1：同样只在副本上写 ST 的世界书绑定（`data.extensions.world`）。
       */
      function exportJSON(){
        // 0.13.0：JSON 也在宿主导出（目标适配层/共享书合并/绑定都只有一份实现），客户端只下载。
        var sid=state.currentSessionId||null;
        var bound=exportWorldName();
        var gid=exportScope().gid;
        var args={};
        if(sid) args.sessionId=sid;
        if(bound) args.stWorld=bound;
        if(gid) args.groupId=gid;
        if(state.bookMerge) args.bookMerge=true;
        var tgt=state.exportTarget;
        if(tgt && tgt.id) args.cardId=tgt.id;   // 0.14.1：导出指定已存卡（不要求先载入）
        rpc("cc_exportJson", args).then(function(res){
          if(res && res.ok && res.value && typeof res.value.content === "string"){
            var v=res.value;
            var blob=new Blob([v.content],{type:v.mime||"application/json"});
            var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=v.filename||((state.draft.data.name||"card")+".json"); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
            set({lastMsg: (v.merged? t("store.exportedJson") + " " + t("export.book.merged",{n:String(v.merged)}) : t("store.exportedJson"))
              + (bound? " · " + t("export.stWorldBound",{name:bound}) : "")});
          } else set({lastMsg:String((res && res.error && res.error.message) || t("common.unknownError"))});
        }).catch(function(e){ set({lastMsg:String(e && e.message || e)}); });
      }
      function exportPNG(){
        var sid=state.currentSessionId||null;
        var bound=exportWorldName();
        var args=sid?{sessionId:sid}:{};
        if(bound) args.stWorld=bound;
        var tgt=state.exportTarget;
        if(tgt && tgt.id) args.cardId=tgt.id;   // 0.14.1：导出指定已存卡（不要求先载入）
        set({busy:"exportPng", lastMsg:t("store.generatingPng")});
        rpc("cc_exportPng", args).then(function(res){
          set({busy:null});
          if(res && res.ok && res.value && res.value.b64){
            try{
              var bytes=b64ToBytes(res.value.b64);
              var blob=new Blob([bytes],{type:"image/png"});
              var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=res.value.filename||((state.draft.data.name||"card")+".png"); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
              set({lastMsg:t("store.exportedPng",{name:(res.value.filename||"card.png")}) + (bound? " · " + t("export.stWorldBound",{name:bound}) : "")});
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
                var bound=exportWorldName();
                var args=sid?{sessionId:sid, imageB64:b64}:{imageB64:b64};
                if(bound) args.stWorld=bound;
                var tgt=state.exportTarget;
                if(tgt && tgt.id) args.cardId=tgt.id;   // 0.14.1：导出指定已存卡（不要求先载入）
                set({busy:"exportPng", lastMsg:t("store.writingPng",{name:f.name})});
                rpc("cc_exportPng", args).then(function(res){
                  set({busy:null});
                  if(res && res.ok && res.value && res.value.b64){
                    try{
                      var bytes=b64ToBytes(res.value.b64);
                      var blob=new Blob([bytes],{type:"image/png"});
                      var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=res.value.filename||((state.draft.data.name||"card")+".png"); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800);
                      set({lastMsg:t("store.wrotePng",{name:(res.value.filename||f.name)}) + (bound? " · " + t("export.stWorldBound",{name:bound}) : "")});
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
        var bound=exportWorldName();
        var args=sid?{sessionId:sid}:{};
        if(bound) args.stWorld=bound;
        var tgt=state.exportTarget;
        if(tgt && tgt.id) args.cardId=tgt.id;   // 0.14.1：导出指定已存卡（不要求先载入）
        set({busy:"exportCharx", lastMsg:t("store.generatingCharx")});
        rpc("cc_exportCharx", args).then(function(res){
          set({busy:null});
          if(res && res.ok && res.value && res.value.b64){
            try{
              var bytes2=b64ToBytes(res.value.b64);
              var blob2=new Blob([bytes2],{type:"application/zip"});
              var a2=document.createElement("a"); a2.href=URL.createObjectURL(blob2); a2.download=res.value.filename||((state.draft.data.name||"card")+".charx"); a2.click(); setTimeout(function(){ URL.revokeObjectURL(a2.href); },800);
              set({lastMsg:t("store.exportedCharx",{name:(res.value.filename||"card.charx")}) + (bound? " · " + t("export.stWorldBound",{name:bound}) : "")});
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
      // ———————————————— 0.8.0 人物关系图谱 / 群聊分组 ————————————————
      // 关系数据活在宿主侧（<DSH_HOME>/cc-groups/），前端只通过 RPC 读写；「卡属于哪个组」由库条目
      // 的 meta.groupId 决定（分组文件里不存成员），所以这里每次入组/移组后都要 refreshLibrary。
      function setCurrentGroupId(id){
        var gid = String(id || "");
        set({currentGroupId: gid});
        // "" = 全部（不过滤）、"__none" = 只看未分组：这两个都不是真分组，没有图谱可载
        if(gid && gid !== "__none"){ loadGroup(gid); loadBook(gid); } else { set({relations:null, book:null}); }
      }
      async function refreshGroups(){
        try{
          var res = await rpc("cc_listGroups", {});
          if(res && res.ok && res.value){ set({groups: res.value.groups||[]}); return; }
          // 宿主半还是旧代码时这里会拿到 unknown-endpoint —— 那是「只刷新了页面、没重启 dsh」的典型信号，
          // 直接说人话，别让用户对着一堆没反应的按钮猜（0.8.1）。
          var code = res && res.error && res.error.details && res.error.details.code;
          if(code === "unknown-endpoint"){ set({lastMsg: t("workshop.group.needRestart")}); return; }
          set({lastMsg: String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
      }
      /** 从某个分组面板直接进关系视图（折叠面板标题上的「关系」按钮用它）。 */
      function openRelationsFor(gid){
        var id = String(gid || "");
        if(!id || id === "__none"){ set({lastMsg: t("workshop.rel.pickGroup")}); return; }
        set({currentGroupId: id, cur: 4});
        loadGroup(id);
      }
      /** 0.8.1：从侧栏进关系视图。未选具体分组时**给一句提示**，而不是把按钮静默禁用（用户会以为坏了）。 */
      function openRelations(){
        var gid = String(state.currentGroupId || "");
        if(!gid || gid === "__none"){ set({lastMsg: t("workshop.rel.pickGroup")}); return; }
        set({cur: 4});
        loadGroup(gid);
      }
      async function loadGroup(id){
        var gid = String(id || state.currentGroupId || "");
        if(!gid){ set({relations:null, relIssues:null}); return; }
        set({relBusy:"load"});
        try{
          var res = await rpc("cc_getGroup", {id: gid});
          // 换了组就把上一次的体检清单清掉：留着会让用户以为新组也有那些问题（0.10.0）
          if(res && res.ok && res.value) set({relations: res.value, relIssues:null, relByCheck:null});
          else set({relations:null, relIssues:null, relByCheck:null, lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
      // ——— 0.9.0 组级共享世界书：一组一份，成员卡里只留私有条目 ———
      async function loadBook(groupId){
        var gid = String(groupId || state.currentGroupId || "");
        if(!gid){ set({book:null}); return; }
        set({bookBusy:"load"});
        try{
          var res = await rpc("cc_getBook", {groupId: gid});
          if(res && res.ok && res.value) set({book: res.value});
          else set({book:null, lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({bookBusy:null});
      }
      async function patchBook(args){
        var gid = String(state.currentGroupId||"");
        if(!gid) return;
        set({bookBusy:"patch"});
        try{
          var res = await rpc("cc_patchBook", Object.assign({groupId: gid}, args||{}));
          if(res && res.ok && res.value){ await loadBook(gid); set({lastMsg:t("book.saved",{rev:String(res.value.rev)})}); }
          else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({bookBusy:null});
      }
      /**
       * 提升之后同步**界面里的草稿**（与工具半 syncDraftAfterPromote 同一套判据）。
       *
       * 宿主半 `cc_promoteBook` 删的是**库里的卡**，界面里这份草稿是另一个副本 —— 不同步的话，
       * 用户接着点「保存当前」就会把刚删掉的重复条目原样写回去，去重白做且毫无提示。
       * 三条自律：① 只对「这次真的被删过条目、且正是当前编辑的那张卡」动手；
       * ② 只认**内容逐字相符**（用户在界面里改过内容的条目一律不动）；
       * ③ 共享书没读到（state.book 为空）时什么都不做 —— 宁可不同步，也不猜着删。
       */
      function syncDraftAfterPromote(v){
        // 预览/锁定时界面里的草稿不是 LLM 那份：这时去删条目 = 改错对象
        if(isReadOnly()) return 0;
        try{
          var cid = String(state.currentLibraryId||"");
          if(!cid) return 0;
          var touched = ((v && Array.isArray(v.perCard)) ? v.perCard : []).filter(function(c){
            return c && !c.error && c.removed > 0 && String(c.id) === cid;
          });
          if(!touched.length) return 0;
          var bk = state.book;
          var bookEntries = (bk && bk.book && bk.book.data && Array.isArray(bk.book.data.entries)) ? bk.book.data.entries : [];
          var contents = {};
          bookEntries.forEach(function(e){ var c = String((e && e.content)==null? "" : e.content); if(c.trim()) contents[c] = true; });
          var d = state.draft;
          var entries = (d && d.data && d.data.character_book && Array.isArray(d.data.character_book.entries)) ? d.data.character_book.entries : [];
          var removed = 0;
          entries.forEach(function(e){ if(contents[String((e && e.content)==null? "": e.content)]) removed++; });
          if(!removed) return 0;
          updateDraft(function(data){
            var cb = data.character_book;
            if(!cb || !Array.isArray(cb.entries)) return;
            cb.entries = cb.entries.filter(function(e){ return !contents[String((e && e.content)==null? "": e.content)]; });
          });
          return removed;
        }catch(e){ return 0; }
      }
      /** 提升去重：`apply` 为假时只扫描预览（宿主半默认也是 dryRun，两边都不写盘）。 */
      async function promoteBook(keys, apply){
        var gid = String(state.currentGroupId||"");
        if(!gid) return;
        set({bookBusy: apply? "promote" : "scan"});
        try{
          var res = await rpc("cc_promoteBook", {groupId: gid, apply: !!apply, keys: (keys && keys.length)? keys : undefined});
          if(res && res.ok && res.value){
            var v = res.value;
            var msg = v.dryRun
              ? t("book.promotePreview",{n:String(v.wouldPromote||0), m:String(v.removedTotal||0)})
              : t("book.promoteDone",{n:String(v.promoted||0), m:String(v.removedTotal||0)});
            set({lastMsg: msg});
            await loadBook(gid);
            if(!v.dryRun){
              var synced = syncDraftAfterPromote(v);   // 必须在 loadBook 之后：那时 state.book 才是提升后的新书
              if(synced) set({lastMsg: msg + " · " + t("book.promoteSyncedDraft",{n:String(synced)})});
              await refreshLibrary(); await loadGroup(gid);
            }
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({bookBusy:null});
      }
      async function applyBook(cardId){
        var gid = String(state.currentGroupId||"");
        if(!gid) return;
        set({bookBusy:"apply"});
        try{
          var res = await rpc("cc_applyBook", {groupId: gid, cardId: cardId||undefined});
          if(res && res.ok && res.value){
            var v = res.value;
            set({lastMsg: v.added ? t("book.applyDone",{n:String(v.added)}) : t("book.applyNone")});
            await refreshLibrary();
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({bookBusy:null});
      }
      /** 文本类导出物（JSON / 世界书）：宿主返回 {filename,mime,content}，客户端只负责下载。 */
      function downloadTextExport(res, fallbackName, mime){
        if(!(res && res.ok && res.value && typeof res.value.content === "string")) return false;
        var blob = new Blob([res.value.content], {type: res.value.mime || mime || "application/json"});
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = res.value.filename || fallbackName;
        a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 800);
        return true;
      }
      /**
       * 导出共享世界书（0.13.0：转换在宿主 lib/compat/adapters 里，按钮按宿主注册的目标渲染）。
       * `targetId` 来自 `cc_listTargets`（ccv3 / sillytavern / 未来新平台）；文件名以宿主返回为准，
       * 只有宿主没给 filename 时才按目标类型回退（ST 用 `<书名>.json`，CCv3 用 `.lorebook.json`）。
       */
      function exportBook(targetId){
        // 0.14.2：跟随导出作用域 —— 库卡模式导出的是**那张卡所属分组**的共享书。
        var sc = exportScope();
        var gid = sc.gid;
        var b = sc.book && sc.book.book;
        if(!b || !gid) return;
        var name = String((b.data && b.data.name) || "").trim() || "shared-lorebook";
        var isSt = targetId === "sillytavern";
        rpc("cc_exportBook", { groupId: gid, target: targetId }).then(function(res){
          if(downloadTextExport(res, name + (isSt? ".json" : ".lorebook.json"), "application/json")){
            set({lastMsg: isSt? t("book.exportedSt",{name:name}) : t("book.exported",{name:name})});
          } else set({lastMsg: String((res && res.error && res.error.message) || "")});
        }).catch(function(e){ set({lastMsg:String(e && e.message || e)}); });
      }
      // 兼容旧调用点/测试：两个薄包装（真实目标列表来自宿主 cc_listTargets）
      function exportBookFile(){ return exportBook("ccv3"); }
      function exportBookStFile(){ return exportBook("sillytavern"); }
      /** 拉取宿主注册的导出目标（0.13.0）：共享书导出按钮按它渲染；失败时界面回退内置两枚。
       *  0.15.0：返回 Promise（远程导入要先等目标表拿到 remote 描述 / 默认地址）。 */
      function refreshTargets(){
        return rpc("cc_listTargets", {}).then(function(res){
          if(res && res.ok && res.value && Array.isArray(res.value.targets) && res.value.targets.length){
            set({targets: res.value.targets});
            return res.value.targets;
          }
          return null;
        }).catch(function(){ return null; });
      }
      function setBookMerge(v){ set({bookMerge: !!v}); }
      // ———————————————— 0.15.0 远程导入（SillyTavern） ————————————————
      // 为什么在宿主做：ST 默认 CORS 只放行 origin "null"、methods 仅 OPTIONS —— 浏览器跨域
      // POST 必被拦；宿主是 Node 进程，不受 CORS 约束，CSRF token/session cookie 也留在宿主。
      // 客户端只负责：地址/认证/策略、按 `cc_listTargets` 里带 `remote` 的目标渲染区块、
      // 调 `cc_stProbe` / `cc_stImport`，并把结果说人话。平台名/默认端口来自 adapter，不写死在这里。
      /** 声明了远程导入能力的目标（目前只有 ST；新平台有 remote 描述就自动出现）。 */
      function remoteTarget(){
        var list = state.targets || [];
        for(var i=0;i<list.length;i++){ if(list[i] && list[i].remote) return list[i]; }
        return null;
      }
      /** 当前 ST 地址：用户填过就用它，否则用 adapter 的 defaultBaseUrl。 */
      function stBaseUrl(){
        var own = String(state.stBaseUrl||"").trim();
        if(own) return own;
        var tg = remoteTarget();
        return (tg && tg.remote && tg.remote.defaultBaseUrl) ? String(tg.remote.defaultBaseUrl) : "";
      }
      function setStBaseUrl(v){ set({ stBaseUrl:String(v==null?"":v), stProbe:null }); saveSettings(); }
      function setStAutoProbe(v){ set({ stAutoProbe: !!v }); saveSettings(); }
      function setStWorldMode(v){ set({ stWorldMode: v==="overwrite" ? "overwrite" : "skip" }); saveSettings(); }
      function setStUser(v){ set({ stUser:String(v==null?"":v) }); saveSettings(); }
      function setStPass(v){ set({ stPass:String(v==null?"":v) }); } // 密码只在本次会话内存，绝不落 localStorage
      function setStShowAuth(v){ set({ stShowAuth: !!v }); }
      function stErrorText(code){
        var c = String(code||"");
        if(c==="st-auth") return t("st.errAuth");
        if(c==="st-forbidden") return t("st.errForbidden");
        if(c==="st-csrf") return t("st.errCsrf");
        if(c==="st-book-failed") return t("st.errBookFailed");
        if(c==="st-bad-url") return t("st.errBadUrl");
        if(c==="st-bad-response") return t("st.errBadResponse");
        if(c==="st-import-failed") return t("st.errImportFailed");
        if(c==="too-large") return t("st.errTooLarge");
        if(c==="bad-cover") return t("st.errCover");
        if(c==="build-failed") return t("st.errBuild");
        if(c==="no-remote") return t("st.errNoRemote");
        // 未知错误码不要再冒充「未检测到 ST」——0.15.1 的封面失败就是这么被误报的。
        return t("st.errImportFailed");
      }
      /** 探测本机 ST 是否在线；60s 内同地址复用结果（打开弹层不重复打网络），force 才强制重探。 */
      async function probeSt(force){
        if(!state.targets || !state.targets.length){ try{ await refreshTargets(); }catch(e){} }
        var tg = remoteTarget();
        if(!tg) return false;
        var base = stBaseUrl();
        if(!base) return false;
        var prev = state.stProbe;
        if(!force && prev && prev.baseUrl === base && (Date.now() - (prev.at||0)) < 60000) return prev.status === "online";
        if(prev && prev.status === "probing") return false;
        set({ stProbe:{ status:"probing", baseUrl:base, version:null, worlds:null, error:null, at:Date.now() } });
        var res;
        try{
          res = await rpc("cc_stProbe", { baseUrl:base, target:tg.id,
            username: state.stUser || undefined, password: state.stPass || undefined });
        }catch(e){
          if(stBaseUrl() !== base) return false;              // 晚到响应：地址已经改了，丢弃
          set({ stProbe:{ status:"offline", baseUrl:base, version:null, worlds:null,
            error:{code:"st-offline", message:String(e&&e.message||e)}, at:Date.now() } });
          return false;
        }
        if(stBaseUrl() !== base) return false;
        var v = (res && res.ok && res.value) ? res.value : null;
        if(!v){
          set({ stProbe:{ status:"offline", baseUrl:base, version:null, worlds:null,
            error:{code:"st-bad-response", message:String((res&&res.error&&res.error.message)||"")}, at:Date.now() } });
          return false;
        }
        var status = v.online ? (v.auth === "basic-required" ? "auth" : (v.auth === "forbidden" ? "forbidden" : "online")) : "offline";
        set({ stProbe:{ status:status, baseUrl:base, version:v.version||null,
          worlds:(typeof v.worlds === "number" ? v.worlds : null), error:v.error||null, at:Date.now() } });
        return status === "online";
      }
      /**
       * 选一张底图作为 ST 卡的封面（可选）。
       * PNG 直通；JPG / WebP 等先用 canvas 转成 PNG（最长边 1024）—— ST 的卡 PNG 必须是
       * 真 PNG，直接把 JPG 字节塞进去会得到「缺少 PNG 签名」而失败（0.15.1 用户实机）。
       */
      function pickStCover(){
        try{
          var inp = document.createElement("input");
          inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
          inp.onchange = function(){
            var f = inp.files && inp.files[0];
            if(!f) return;
            if(f.size > 12 * 1024 * 1024){ set({ lastMsg: t("store.errImageTooLarge") }); return; }
            var png = /^image\/png$/i.test(String(f.type || "")) || /\.png$/i.test(String(f.name || ""));
            if(png){ readCoverAsPng(f); return; }
            var url = null;
            try{ url = URL.createObjectURL(f); }catch(e){ url = null; }
            if(!url){ set({ lastMsg: t("store.errReadImageFailed") }); return; }
            var img = new Image();
            img.onload = function(){
              try{
                var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                if(!w || !h) throw new Error("bad image");
                var max = 1024;
                var scale = Math.min(1, max / Math.max(w, h));
                var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
                var canvas = document.createElement("canvas");
                canvas.width = cw; canvas.height = ch;
                canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
                var dataUrl = String(canvas.toDataURL("image/png"));
                var b64 = dataUrl.indexOf(",") >= 0 ? dataUrl.slice(dataUrl.indexOf(",") + 1) : "";
                if(!b64) throw new Error("cover-convert-failed");
                set({ stImageB64: b64, stImageName: String(f.name || "") });
              }catch(e){ set({ lastMsg: t("st.errCover") }); }
              finally{ try{ URL.revokeObjectURL(url); }catch(e){} }
            };
            img.onerror = function(){
              try{ URL.revokeObjectURL(url); }catch(e){}
              set({ lastMsg: t("st.errCover") });
            };
            img.src = url;
          };
          inp.click();
        }catch(e){ set({ lastMsg: String(e && e.message || e) }); }
      }
      function readCoverAsPng(f){
        var reader = new FileReader();
        reader.onload = function(){
          try{ set({ stImageB64: arrayBufferToB64(reader.result), stImageName: String(f.name || "") }); }
          catch(e){ set({ lastMsg: String(e && e.message || e) }); }
        };
        reader.onerror = function(){ set({ lastMsg: t("store.errReadImageFailed") }); };
        reader.readAsArrayBuffer(f);
      }
      function clearStCover(){ set({ stImageB64:null, stImageName:null }); }
      /** 一键导入：把当前导出对象（库卡或草稿）连同作用域里的共享书推给本机 ST。 */
      async function importToSt(){
        if(state.stBusy) return false;
        var tg = remoteTarget();
        if(!tg){ set({ lastMsg: t("st.errOffline") }); return false; }
        var base = stBaseUrl();
        var tgt = state.exportTarget;
        var sc = exportScope();
        var args = { baseUrl: base, target: tg.id };
        if(sc.gid) args.groupId = sc.gid;
        var bound = exportWorldName();
        if(bound) args.stWorld = bound;
        if(tgt && tgt.id) args.cardId = tgt.id;
        else if(state.currentSessionId) args.sessionId = state.currentSessionId;
        if(state.stWorldMode === "overwrite") args.worldMode = "overwrite";
        if(state.stUser) args.username = state.stUser;
        if(state.stPass) args.password = state.stPass;
        if(state.stImageB64) args.imageB64 = state.stImageB64;
        set({ stBusy:"import", stResult:null, lastMsg:null });
        try{
          var res = await rpc("cc_stImport", args);
          if(res && res.ok && res.value){
            var v = res.value;
            set({ stBusy:null, stResult:v,
              lastMsg: t("st.imported",{ card:String((v.card && v.card.fileName) || ""), world:String((v.world && v.world.name) || "—") }) });
            return true;
          }
          var err = (res && res.error) || {};
          var code = String((err.details && err.details.code) || err.code || "st-import-failed");
          var detail = String(err.message || "");
          set({ stBusy:null, stResult:{ error:{ code:code, message:detail } },
            lastMsg: stErrorText(code) + (detail ? "（" + detail + "）" : "") });
          // 认证/拒绝类错误直接把认证栏展开：用户少点一次
          if(code === "st-auth" || code === "st-forbidden" || code === "st-csrf") set({ stShowAuth:true });
          return false;
        }catch(e){
          set({ stBusy:null, lastMsg: stErrorText("st-offline") + "（" + String(e && e.message || e) + "）" });
          return false;
        }
      }
      async function createGroup(nameArg){
        // 0.8.1：不再依赖 window.prompt（内嵌 webview 会拦掉原生对话框 → 用户看到的是「点了没反应」）。
        // 名字由侧栏那个内联输入框传进来；没传就当取消。
        var name = String(nameArg == null ? "" : nameArg).trim();
        if(!name) return;
        set({relBusy:"new"});
        try{
          var res = await rpc("cc_createGroup", {name: name});
          if(res && res.ok && res.value){
            await refreshGroups();
            set({currentGroupId: res.value.group.id});
            await loadGroup(res.value.group.id);
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
      async function deleteGroup(id){
        // 删组的确认文案要**专用**（原来复用了「确定删除该角色？」）—— 而且必须提共享世界书：
        // 那是用户可能整理了很久的东西，删掉不可恢复（第二轮报告 4.1 的同一条信息完整性要求）。
        try{ if(typeof window!=="undefined" && window.confirm && !window.confirm(t("relations.confirmDeleteGroup"))) return; }catch(e){}
        set({relBusy:"del"});
        try{
          var res = await rpc("cc_deleteGroup", {id: id});
          if(res && res.ok){ set({currentGroupId:"", relations:null}); await refreshGroups(); await refreshLibrary(); }
          else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
      async function assignGroup(cardId, groupId){
        if(!cardId) return;
        set({libraryBusy:"group:"+cardId});
        try{
          var res = await rpc("cc_setCardGroup", {cardId: cardId, groupId: groupId || null});
          if(res && res.ok){
            await refreshLibrary();
            await refreshGroups();
            if(state.currentGroupId) await loadGroup(state.currentGroupId);
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({libraryBusy:null});
      }
      /** 改图谱：ops 与 cc_patch_relations 同构（addNode/updateNode/removeNode/addEdge/updateEdge/removeEdge）。 */
      async function patchRelations(ops){
        var gid = state.currentGroupId;
        if(!gid){ set({lastMsg:t("workshop.rel.pickGroup")}); return; }
        set({relBusy:"patch"});
        try{
          var args = { id: gid, ops: ops };
          var rev = state.relations && state.relations.group ? state.relations.group.rev : null;
          if(typeof rev === "number") args.expectedRev = rev;
          var res = await rpc("cc_patchGroup", args);
          if(res && res.ok && res.value){
            set({lastMsg: t("workshop.rel.saved", {rev: String(res.value.group.rev)})});
            await loadGroup(gid);
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
      async function checkGroupNow(){
        var gid = state.currentGroupId;
        if(!gid){ set({lastMsg:t("workshop.rel.pickGroup")}); return; }
        set({relBusy:"check"});
        try{
          var res = await rpc("cc_groupCheck", {id: gid});
          if(res && res.ok && res.value){
            var issues = res.value.issues || [];
            // 0.10.0：清单存进 state 由下面分组渲染（不再把十来个问题挤成一行 lastMsg —— 加了跨卡一致性检查以后
            // 一行文本会长到没法读）；lastMsg 只留一句计数，兼容旧观感。
            set({relIssues: issues, relByCheck: res.value.byCheck || null,
              lastMsg: issues.length ? t("workshop.rel.checkResult", {n: String(issues.length)}) : t("workshop.rel.checkOk")});
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
      /** 把图谱里「我对别人的看法」渲染进当前卡的 description（固定标记区，重复渲染是替换）。 */
      async function renderRelationsToCard(){
        // 渲染会改当前草稿的 description —— 锁定/预览期间不动（宿主也会拦，这里先不发请求）
        if(isReadOnly()) return;
        if(!state.currentLibraryId){ set({lastMsg:t("workshop.rel.needLoad")}); return; }
        set({relBusy:"render"});
        try{
          var sid = state.currentSessionId || null;
          var args = { cardId: state.currentLibraryId };
          if(state.currentGroupId) args.groupId = state.currentGroupId;
          if(sid) args.sessionId = sid;
          var res = await rpc("cc_renderRelations", forceArgs(args));
          if(res && res.ok && res.value){
            // 宿主改了草稿文件 → 重新拉一次，否则工坊里看到的还是旧 description
            var dres = await rpc("cc_getDraft", sid ? {sessionId: sid} : {});
            if(dres && dres.ok && dres.value && dres.value.draft) setDraftFromHost(dres.value.draft, dres.value.draftStatus || null);
            set({lastMsg: t("workshop.rel.rendered", {n: String(res.value.outgoing || 0)})});
          } else set({lastMsg:String((res && res.error && res.error.message) || "")});
        }catch(e){ set({lastMsg:String(e && e.message || e)}); }
        set({relBusy:null});
      }
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
      /**
       * 只改「当前草稿的来源 id」（不写宿主）。pullDraft 在 apply() 的作用域里跑，
       * 那里没有 createStore 内部的 `set` —— 旧代码直接调 `set({currentLibraryId: originId})`
       * 会在 originId 非空时抛 ReferenceError，被尾部的 .catch 吞掉，于是**来源 sidecar 永远恢复不了**，
       * 同一次响应里的 setDraftFromHost 也跟着不执行（0.11.0 集成时发现并修）。
       */
      function setCurrentLibraryId(id){
        var v = (typeof id === "string" && id) ? id : null;
        if(v === state.currentLibraryId) return;
        set({ currentLibraryId: v });
      }
      function clearCurrentLibraryId(){
        set({currentLibraryId:null, lastMsg:t("store.switchedNew")});
        // 同步清掉宿主侧的来源 id（sidecar）：否则下次保存又会按旧来源「更新」那一张
        try{ rpc("cc_setOrigin", forceArgs({ sessionId: state.currentSessionId||null, id: null })); }catch(e){}
      }
      // 清空当前角色卡：整份草稿换回空卡（makeDraft），并解除「跟已存角色的关联」——
      // 否则清空后点「保存当前」会把库里那张卡覆盖成空卡（要删卡请用右侧列表的删除）。
      // 落盘与其它写入走同一条路（pushDraftToHost）：刷新页面、模型侧读到的都是空卡。
      // 二次确认由调用方负责（工坊底部那枚按钮），这里只管状态本身。
      function clearDraft(){
        // 清空是破坏性动作：锁定/预览期间清空 = 抹掉 LLM 正在写的内容，直接拒绝（按钮侧也已禁用）
        if(isReadOnly()) return;
        set({
          draft: makeDraft(),
          world: { timeline:"", factions:"", geo:"", power:"", daily:"" },
          valid: {valid:true, errors:[], warnings:[]},
          validationReport: null,
          editingWorld:null, editingWorldRevert:null, editingText:null,
          currentLibraryId:null,
          lastMsg: t("store.cleared")
        });
        // 清空 = 与已存卡脱钩：宿主侧的来源 id（sidecar）也要清，否则下次保存会「更新」原来那张卡（把它覆盖成空卡）
        try{ rpc("cc_setOrigin", forceArgs({ sessionId: state.currentSessionId||null, id: null })); }catch(e){}
        setTimeout(pushDraftToHost, 80);
      }
      async function loadFromLibrary(id){
        if(!id) return;
        set({libraryBusy:"load:"+id});
        try{
          var sid=state.currentSessionId||null;
          var args = forceArgs(sid ? {id:id, sessionId:sid} : {id:id});
          var res=await rpc("cc_loadFromLibrary", args);
          // 锁 active（且用户没关保护）：宿主**不写草稿**，只回「假如载入会变成什么」。
          // 这时进只读预览 —— 绝不能 setDraftFromHost 成当前草稿，那等于替 LLM 覆盖它的创作。
          if(res && res.ok && res.value && res.value.locked===true && res.value.preview){
            // 响应里带的锁要同步进 store：预览期间轮询可能还没跑到，退出预览后必须立刻保持只读，
            // 不能留下「退出预览后到下一次 4s 轮询之间可以编辑」的裂缝（那时宿主仍会拦，但体验是白打一次字）。
            setLock(res.value.lock || null);
            enterPreview(Object.assign({id:id}, res.value.preview));
            set({lastMsg: t("lock.msg.loadedPreview",{name: previewNameOf(res.value.preview)})});
          } else if(res && res.ok && res.value && res.value.draft){
            // 正常载入（无锁 / 锁已超时 / 设置里关掉了保护）：先退出预览，再按旧逻辑整份替换草稿。
            if(state.preview) exitPreview();
            setDraftFromHost(res.value.draft);
            set({currentLibraryId: id});
            // 0.9.0：载入一张卡就**跟着切到它所属的分组**。实机反馈：右边载入了陆昭，中间「人物关系」
            // 却还停在江晚那个「测试」组，必须再点一次那个组的「关系」按钮才会切过去 —— 非常费解。
            // 关系视图与共享世界书都是**按组**看的，所以「换卡」必须带着组一起换（没有组就清空）。
            setCurrentGroupId((res.value.meta && res.value.meta.groupId) ? String(res.value.meta.groupId) : "");
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
      // 0.4.1：这里原本还有一个 exportLibraryEntry —— 直接下载某张已存角色的 JSON。
      // 三个导出入口归一之后，卡片上的「导出」改成切到导出页，导出动作只剩导出页那一套实现，
      // 这条旁路就没有调用者了（留着它等于「同一次导出有两套行为」），故删除。
      return { getSnapshot:getSnapshot, subscribe:subscribe, setCur:setCur, setPanel:setPanel, setSideExpanded:setSideExpanded, setIsCcMode:setIsCcMode, applyCcVerdict:applyCcVerdict, applyChromeCc:applyChromeCc, setDraftFromHost:setDraftFromHost, setSessionId:setSessionId, setSlotWarn:setSlotWarn, setAlternateSlots:setAlternateSlots, setLock:setLock, setLlmDraft:setLlmDraft, enterPreview:enterPreview, exitPreview:exitPreview, isLockActive:isLockActive, isReadOnly:isReadOnly, setDraftLock:setDraftLock, migrateSlot:migrateSlot, checkIsCcMode:checkIsCcMode, setPollEnabled:setPollEnabled, setPollInterval:setPollInterval, setAutoValidate:setAutoValidate, setAutoSaveOnImport:setAutoSaveOnImport, updateDraft:updateDraft, validate:validate, exportJSON:exportJSON, exportPNG:exportPNG, embedIntoPng:embedIntoPng, exportCharx:exportCharx, importJSON:importJSON, importAny:importAny, setWorldPatch:setWorldPatch, setEditingWorld:setEditingWorld, cancelEditingWorld:cancelEditingWorld, setEditingText:setEditingText, clearEditingText:clearEditingText, cancelEditingText:cancelEditingText, updateEditingText:updateEditingText, addEntry:addEntry, setLibraryQuery:setLibraryQuery, toggleLibraryCollapsed:toggleLibraryCollapsed, refreshLibrary:refreshLibrary, saveCurrentToLibrary:saveCurrentToLibrary, saveAsNewToLibrary:saveAsNewToLibrary, clearCurrentLibraryId:clearCurrentLibraryId, setCurrentLibraryId:setCurrentLibraryId, clearDraft:clearDraft, loadFromLibrary:loadFromLibrary, deleteFromLibrary:deleteFromLibrary, renameCurrentInLibrary:renameCurrentInLibrary, setCurrentGroupId:setCurrentGroupId, refreshGroups:refreshGroups, createGroup:createGroup, loadGroup:loadGroup, assignGroup:assignGroup, deleteGroup:deleteGroup, patchRelations:patchRelations, checkGroupNow:checkGroupNow, renderRelationsToCard:renderRelationsToCard, openRelations:openRelations, openRelationsFor:openRelationsFor, loadBook:loadBook, patchBook:patchBook, promoteBook:promoteBook, applyBook:applyBook, refreshTargets:refreshTargets, exportBook:exportBook, openExport:openExport, closeExport:closeExport, exportLibraryCard:exportLibraryCard, exportScope:exportScope, exportGroupName:exportGroupName, exportBookFile:exportBookFile, exportBookStFile:exportBookStFile, setBookMerge:setBookMerge, remoteTarget:remoteTarget, stBaseUrl:stBaseUrl, setStBaseUrl:setStBaseUrl, setStAutoProbe:setStAutoProbe, setStWorldMode:setStWorldMode, setStUser:setStUser, setStPass:setStPass, setStShowAuth:setStShowAuth, probeSt:probeSt, importToSt:importToSt, pickStCover:pickStCover, clearStCover:clearStCover };
    }

    var S={
      overlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"18px", zIndex:30 },
      workshop:{ width:"min(1360px, 96vw)", height:"min(860px, 92vh)", background:"var(--dsw-alias-bg-layer-1, #fff)", border:"1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius:18, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3, 0 20px 80px rgba(0,0,0,.2))" },
      head:{ height:56, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2, #f9fafb)" },
      step:{ padding:"6px 10px", borderRadius:999, fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", background:"var(--dsw-alias-bg-layer-2)", cursor:"pointer", outline:"none", transition:"background .12s ease, border-color .12s ease, color .12s ease" },
      stepActive:{ background:"#7c5cff", borderColor:"#7c5cff", color:"#fff" },
      stepHover:{ background:"var(--dsw-alias-bg-layer-1)", borderColor:"rgba(124,92,255,.55)", color:"var(--dsw-alias-label-primary)" },
      body:{ flex:1, display:"grid", gridTemplateColumns:"250px 1fr", minHeight:0, background:"var(--dsw-alias-bg-base)" },
      // 0.22.0：左侧改成「角色库列表」（选对象），章节导航移到顶部横向锚点（选章节）。
      // 之前 200px 左列放的是低频的章节导航，把黄金横向空间全吃掉了。
      anchorbar:{ display:"flex", alignItems:"center", gap:2, padding:"0 8px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", flex:"none", overflowX:"auto", scrollbarWidth:"none" },
      tab:{ position:"relative", flex:"0 0 auto", padding:"11px 12px 10px", background:"transparent", border:0, color:"var(--dsw-alias-label-secondary)", font:"inherit", fontSize:12.5, cursor:"pointer", whiteSpace:"nowrap", outline:"none", borderRadius:"6px 6px 0 0", transition:"background .12s ease, color .12s ease" },
      tabHover:{ color:"var(--dsw-alias-label-primary)", background:"var(--dsw-alias-bg-layer-2)" },
      tabActive:{ color:"var(--dsw-alias-label-primary)", background:"rgba(124,92,255,.12)", boxShadow:"inset 0 -2px 0 0 #7c5cff" },
      tabFocus:{ outline:"2px solid #7c5cff", outlineOffset:-2 },
      nav:{ borderRight:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", padding:"12px", display:"flex", flexDirection:"column", gap:8 },
      navBtn:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"1px solid transparent", background:"transparent", color:"var(--dsw-alias-label-secondary)", cursor:"pointer", outline:"none", transition:"background .12s ease, border-color .12s ease, color .12s ease" },
      navBtnHover:{ background:"var(--dsw-alias-bg-layer-2)", color:"var(--dsw-alias-label-primary)" },
      navBtnFocus:{ outline:"2px solid #7c5cff", outlineOffset:2 },
      navBtnActive:{ background:"rgba(124,92,255,.16)", borderColor:"rgba(124,92,255,.5)", color:"var(--dsw-alias-label-primary)", boxShadow:"inset 3px 0 0 0 #7c5cff" },
      main:{ padding:"18px 20px 28px", overflow:"auto", minWidth:0, background:"var(--dsw-alias-bg-base)" },
      // —— 阅读态排版（0.4.0 重构）——
      // 字段默认以「文档」形态呈现：无边框 textarea + field-sizing:content（Chrome 123+ 按内容自动撑高），
      // 点进去就能改；长文仍可走右上角 ⛶ 大框（带快照回滚）。手动编辑从「满屏输入框」退成次要入口。
      readCard:{ background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:14, padding:"16px 18px", marginBottom:12 },
      readTitle:{ margin:"0 0 4px", fontSize:14, fontWeight:600, color:"var(--dsw-alias-label-primary)" },
      secSubTitle:{ margin:"0 0 8px", fontSize:12.5, fontWeight:600, color:"var(--dsw-alias-label-secondary)" },
      readHint:{ fontSize:12, color:"var(--dsw-alias-label-secondary)", marginBottom:10, lineHeight:1.7 },
      fieldRow:{ marginBottom:12 },
      fieldLabel:{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:2 },
      fieldName:{ fontSize:12, fontWeight:600, color:"var(--dsw-alias-label-secondary)" },
      fieldTools:{ display:"flex", alignItems:"center", gap:6 },
      iconBtn:{ appearance:"none", border:"1px solid transparent", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:6, padding:"0 6px", fontSize:12, lineHeight:"20px", cursor:"pointer", outline:"none" },
      readText:{ display:"block", width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"transparent", border:"1px solid transparent", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", margin:"0 -8px", font:"inherit", fontSize:13, lineHeight:1.8, resize:"none", outline:"none", fieldSizing:"content", minHeight:30, overflow:"hidden" },
      readInput:{ display:"block", width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"transparent", border:"1px solid transparent", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", margin:"0 -8px", font:"inherit", fontSize:13, lineHeight:1.8, outline:"none" },
      // 主区底部的折叠区（实时预览 / CBS 速查 / 融合说明）：默认只占一行标题，点开才铺开
      fold:{ border:"1px solid var(--dsw-alias-border-l1)", borderRadius:12, background:"var(--dsw-alias-bg-layer-1)", marginBottom:8, overflow:"hidden" },
      foldHead:{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, width:"100%", boxSizing:"border-box", padding:"10px 14px", background:"transparent", border:"none", color:"var(--dsw-alias-label-primary)", fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"left", outline:"none", fontFamily:"inherit" },
      foldBody:{ padding:"12px 14px 14px", borderTop:"1px solid var(--dsw-alias-border-l1)" },
      library:{ borderRight:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" },
      libraryHead:{ height:46, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderBottom:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", flexShrink:0 },
      libraryList:{ flex:1, overflow:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:8 },
      libraryItem:{ background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10 },
      libraryCollapsedBar:{ width:40, borderRight:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-1)", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 6px", gap:10 },
      badge:{ fontSize:11, padding:"2px 6px", borderRadius:999, border:"1px solid var(--dsw-alias-border-l1)", background:"var(--dsw-alias-bg-layer-2)", color:"var(--dsw-alias-label-secondary)" },
      chip:{ fontSize:11, padding:"4px 8px", borderRadius:999, background:"var(--dsw-alias-bg-layer-2)", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", cursor:"pointer" },
      btn:{ appearance:"none", border:"1px solid transparent", background:"#7c5cff", color:"#fff", borderRadius:10, padding:"8px 14px", fontWeight:600, cursor:"pointer" },
      btnGhost:{ background:"transparent", borderColor:"var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)" },
      dockWrap:{ boxSizing:"border-box", display:"flex", justifyContent:"flex-start", width:"100%", boxSizing:"border-box", maxWidth:"100%", paddingLeft:"calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)", margin:"2px 0" },
      capsule:{ display:"inline-flex", alignItems:"center", gap:8, maxWidth:360, padding:"1px 10px", borderRadius:999, border:"1px solid rgba(127,127,127,0.25)", background:"rgba(127,127,127,0.12)", color:"var(--dsw-alias-label-secondary, #c8ccd2)", fontSize:12, lineHeight:"20px", cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
      input:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 10px", fontSize:12 },
      textarea:{ width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base, #fff)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"8px 10px" },
      label:{ fontSize:12, color:"var(--dsw-alias-label-secondary)" },
      labelStrong:{ fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" },
      subtleText:{ fontSize:11, color:"var(--dsw-alias-label-secondary)" },
      sectionTitle:{ margin:"0 0 8px", fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)" }
    };

    // ———————————————— CC 模式探测（0.12.3 重构）————————————————
    // 这块代码被修过很多轮（issue #5 的胶囊闪退、字段读错、effect 依赖不变），但一直没修掉
    // 最根上的那一层：**isCcMode 只是一个全局布尔，没有「它属于哪个会话」**。用户报的 bug
    // 就是它的直接后果：进入 CC 会话（胶囊出现）→ 切到非 CC 会话（胶囊不消失）→ 再切一次（才消失）。
    //
    // 为什么「再切一次」才消失：旧判定在「有会话、但会话投影还没到」时返回 `prevIsCc ? true : null`，
    // 一旦为 true 就**粘住**；而唯一的权威补救（cc_isCcMode）写在 `if(!isCcMode)` 分支里 ——
    // 「从是到不是」这条路径永远问不到主机，只能等下一次切换时投影恰好可用。另外那时响应也没有
    // 会话归属校验，切会话期间晚到的回包能把上一个会话的结论写到新会话上。
    //
    // 现在只有三个真相来源，各管一段、互不越界：
    //   ① 会话自身投影（dsh ≥ 0.2.2 的 useProjection('agentPreset')）—— 最直接，随会话自动跟随；
    //   ② 会话列表投影（useSessions → byId[id].projectionValues.agentPreset）—— 全版本可用的同一份值；
    //   ③ 主机 RPC（cc_isCcMode）—— 前两者都没有时的权威兜底。**没有本地投影就必须问主机**。
    // 新会话页（没有会话上下文）只认预设芯片的 DOM；根域实例没有改会话结论的能力（见 store.applyChromeCc）。
    var CC_PRESET_ID="cc";
    /** 会话摘要 → 预设 id（只认 projectionValues.agentPreset —— 别处没有这个值）。 */
    function ccPresetIdOf(sess){
      try{
        var p = sess && sess.projectionValues && sess.projectionValues.agentPreset;
        if(typeof p === "string" && p) return p;
      }catch(e){}
      return null;
    }
    /**
     * 投影值 → `{known, preset}`。三态必须分开，这是旧代码最缺的一层：
     *   undefined = 这个来源还没到 / 宿主没有这个投影（**未知**）
     *   null      = 会话确实没有预设（**确定不是 CC**）
     *   string    = 会话的预设 id
     * 旧代码把「未知」和「不是」混成一个 null，只能靠「保持旧值」掩盖 —— 而保持就是粘滞。
     */
    function ccPresetOfValue(v){
      if(v === undefined) return { known:false, preset:null };
      if(v === null) return { known:true, preset:null };
      if(typeof v === "string") return { known:true, preset:(v || null) };
      return { known:false, preset:null };
    }
    function isCcPresetId(id){ return typeof id === "string" && id.toLowerCase() === CC_PRESET_ID; }
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
     * 纯判定函数（便于单测，不依赖 React/DOM）。
     *
     * @param {object} input
     * @param {string|null} input.sessionId    本实例所属会话；null = 没有会话上下文（新会话页 / 根域）
     * @param {boolean} input.presetKnown     会话投影是否可用（true 时 presetId 可信）
     * @param {string|null} input.presetId    会话投影里的预设 id（presetKnown && null = 会话没有预设）
     * @param {boolean|null} input.hostVerdict 同一会话已拿到的主机结论（store.ccSessionId === sessionId 时）
     * @param {boolean} input.domVerdict      预设芯片是否显示 CC（只用于没有会话上下文的新会话页）
     * @returns {{verdict: boolean|null, source: string}} verdict=null 表示无法判定：
     *          调用方保持现状，**并且必须**去问主机（旧代码在这里靠保持 true 把状态粘死了）。
     */
    function decideCcVerdict(input){
      var i = input || {};
      var sessionId = (typeof i.sessionId === "string" && i.sessionId) ? i.sessionId : null;
      if(sessionId){
        // ① 会话投影是权威本地来源：只要有值就下结论，不等 RPC（大小写不敏感）
        if(i.presetKnown) return { verdict: isCcPresetId(i.presetId), source:"projection" };
        // ② 同一会话已经拿到主机结论（上一次 cc_isCcMode 的响应 / 草稿轮询里带回的值）
        if(i.hostVerdict === true || i.hostVerdict === false) return { verdict:i.hostVerdict, source:"host" };
        // ③ 两个来源都没有 → 未知。**不再沿用旧会话的结论**：保持现状，同时发起主机确认。
        return { verdict:null, source:"pending" };
      }
      // ④ 新会话页：预设芯片是唯一信号（芯片选的是「下一次会话的预设」）
      if(i.domVerdict) return { verdict:true, source:"dom" };
      // ⑤ 没有会话上下文时，芯片没说 CC 就是「不是 CC」。这里能安全地下否，是因为
      //    会话域一旦有结论，currentSessionId 就一定非 null，根域的写入会被 applyChromeCc 拒掉
      //    （issue #5 的闪烁是「根域在会话域有结论时写 false」，不是「根域在新会话页写 false」）。
      return { verdict:false, source:"dom" };
    }
    /**
     * 从 slot 的 props 里取「本组件所属的会话 id」。权威顺序：
     *   ① session 域 slot 的标准属性 `sessionId`（SessionId）；
     *   ② `session`（会话域 ownerProps 里的 SessionSnapshot，id 在 .sessionId 上）；
     *   ③ 异形兜底：props.sessionId 是对象时读它的 .sessionId。
     * 注意：**不要**再读 useSessions() 的 `current` 字段 —— dsh 的 SessionListState 里从来没有它
     * （0.1.6-alpha.2 是 ids / byId / phase；0.1.7-alpha.1 又加了 projectionsBySession，仍然没有 current；
     * 见 dsh-api-session-controller 的 sessions/service.d.ts）。旧代码读它恒为 null，于是「会话投影 =
     * 权威」这条路径从来没生效过（issue #5）。**只准读 ids / byId / phase**：这个结构的字段集已经改过
     * 两轮（subagentsByParent / jobsBySession → projectionsBySession），多读一个字段就是下一个静默回归。
     */
    function ccSessionIdOfProps(props){
      try{
        if(!props) return null;
        var direct=props.sessionId;
        if(typeof direct==="string" && direct) return direct;
        var snap=props.session;
        if(snap && typeof snap.sessionId==="string" && snap.sessionId) return snap.sessionId;
        if(direct && typeof direct==="object" && typeof direct.sessionId==="string" && direct.sessionId) return direct.sessionId;
      }catch(e){}
      return null;
    }
    /**
     * 订阅 store 快照（0.12.4）。
     *
     * **为什么不能再用「useState + useEffect(store.subscribe)」** —— 这是「切到非 CC 会话胶囊
     * 不消失、再切一次才消失」的**渲染层**根因（判定层修好之后仍然复现）：
     *   React 的 passive effect 按**声明顺序**执行。Capsule 里 `useCcPreset` 的 effect 排在
     *   订阅 effect 之前 —— 切会话时它先把 store 里的 isCcMode 清成 false（+ emit），而此时
     *   订阅**还没建立**，这次 emit 被丢掉；之后不再有 emit，组件就永远停在**首帧拿到的旧快照**
     *   上（实测：store.isCcMode === false，胶囊 DOM 却还在，直到下一次切换重新挂载才更新）。
     *   useSyncExternalStore 会在渲染时读最新快照，并在（layout 阶段的）订阅建立后**主动复查**，
     *   把订阅前错过的更新补上；调用方还必须把它放在 useCcPreset **之前**（见 Capsule 注释）。
     *   老 React / 测试 harness 没有这个 API 时退回旧写法（效果等价于旧代码）。
     */
    function useStoreSnapshot(store){
      if(store && typeof React.useSyncExternalStore === "function"){
        return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      }
      var r = React.useState(function(){ return store ? store.getSnapshot() : null; });
      React.useEffect(function(){
        if(!store) return;
        return store.subscribe(function(){ r[1](store.getSnapshot()); });
      }, [store]);
      return r[0];
    }
    /**
     * 探测 CC 模式并写入 store，返回本实例所属的会话 id。
     *
     * 0.12.3：**会话域实例（有 ownId）是唯一的权威判定者**；根域实例（shell.overlay）只读，
     * 外加「没有会话上下文时按预设芯片开关胶囊」。这条分界线不再靠调用点的 `canConclude`
     * 约定，而是由 store 的写入门（applyCcVerdict / applyChromeCc）在数据层拦住越权写入 ——
     * issue #5 的胶囊闪退从结构上就不可能再发生。
     */
    function useCcPreset(store, props, t){
      // ownId：本组件自己绑定的会话 id（跨渲染稳定）。shell.overlay 是根域，没有会话绑定 → null。
      var ownId = ccSessionIdOfProps(props);
      var ccLabel=(typeof t==="function" ? t("preset.ccLabel") : "") || "";
      // 来源 ①：会话自身投影（dsh ≥ 0.2.2 的标准 props.useProjection）。undefined = 宿主没有这个投影。
      // 它绑定的是「本 slot 当前所属的会话」，切换会话时自动跟随，不需要我们先知道会话 id。
      var useProjection = props.useProjection;
      var ownPreset = useProjection ? useProjection("agentPreset") : undefined;
      // 来源 ②：会话列表投影（全版本可用）。selector 必须返回**原始值**（string / null / undefined）——
      // 返回新对象会破坏 uSES 的引用比较，变成每帧都「变了」的无限重渲染。
      var useSessions = props.useSessions;
      var listedPreset = useSessions ? useSessions(function(s){
        try{
          var sid = ownId || store.getSnapshot().currentSessionId || null;
          if(!sid) return undefined;
          var sess = s && s.byId && s.byId[sid];
          var pv = sess && sess.projectionValues;
          if(!pv || typeof pv!=="object" || !Object.prototype.hasOwnProperty.call(pv,"agentPreset")) return undefined;
          var v = pv.agentPreset;
          return (v === null || typeof v === "string") ? v : undefined;
        }catch(e){ return undefined; }
      }) : undefined;
      // 合并两个投影来源：useProjection 的 undefined 表示「这个途径不可用」，不能盖掉列表来源的结论。
      var preset = ccPresetOfValue(ownPreset);
      if(!preset.known){
        var listed = ccPresetOfValue(listedPreset);
        if(listed.known) preset = listed;
      }
      var evaluate=React.useCallback(function(){
        var snap = store.getSnapshot();
        // 同一会话已经拿到过的主机结论：只有归属一致才算数（切会话后旧结论必须失效）。
        var hostVerdict = (ownId && snap.ccSessionId === ownId) ? !!snap.isCcMode : null;
        var decision = decideCcVerdict({
          sessionId: ownId,
          presetKnown: preset.known,
          presetId: preset.preset,
          hostVerdict: hostVerdict,
          domVerdict: ccModeFromDom(ccLabel)
        });
        if(ownId){
          if(decision.verdict !== null) store.applyCcVerdict(ownId, decision.verdict, decision.source);
        } else if(decision.verdict !== null){
          // 根域：只在「没有会话上下文」时表达结论（新会话页的预设芯片）
          store.applyChromeCc(decision.verdict);
        }
        return !!store.getSnapshot().isCcMode;
      }, [store, ownId, preset.known, preset.preset, ccLabel]);
      // 会话域：会话一换就作废旧结论并重新判定。**这是 bug 的修复点** ——
      // 旧代码把「发布会话 id」和「判定 CC 模式」放在两个互不相干的 effect 里，且 setSessionId
      // 从不清理 isCcMode，于是切到非 CC 会话后旧结论一直留着，直到某次切换投影恰好可用。
      React.useEffect(function(){
        if(!ownId) return;
        store.setSessionId(ownId);              // id 变化时 store 会把旧结论清成「待定」
        var isCc = evaluate();
        if(isCc){ if(store._pullDraft) store._pullDraft(ownId); }
        // 本地投影拿不到 → **必须**问主机。旧代码只在 `!isCcMode` 时才问，从「是」切到「不是」
        // 这条路径永远问不到；这里反过来：只要没有本地结论就查（force 绕过 5s 节流）。
        // 主机侧 composedPreset 在会话刚打开时可能还没就绪（agents.get 尚未建立），所以有限重试；
        // 一旦拿到主机结论（ccSessionId === ownId && ccSource === host）就不再打扰。
        var timers=[];
        if(!preset.known){
          store.checkIsCcMode(ownId, true);
          timers=[700,2000,4500].map(function(ms){
            return setTimeout(function(){
              try{
                var snap=store.getSnapshot();
                if(snap.currentSessionId !== ownId) return;
                if(snap.ccSessionId === ownId && snap.ccSource === "host") return;
                store.checkIsCcMode(ownId, true);
              }catch(e){}
            }, ms);
          });
        }
        return function(){ timers.forEach(function(x){ clearTimeout(x); }); };
      }, [ownId, preset.known, preset.preset, evaluate]);
      // 根域实例：没有会话上下文，只在「无会话」时按预设芯片开关胶囊（applyChromeCc 会拦住越权写入）。
      React.useEffect(function(){
        if(ownId) return;
        evaluate();
      }, [ownId, evaluate]);
      // 新会话页切换芯片不会改变会话（此时还没有会话），只能靠轮询 DOM 捕获。
      // 纯本地文本扫描，不打 RPC；判定结果不变时 store 内部不会触发重渲染。
      React.useEffect(function(){
        if(typeof setInterval!=="function") return;
        var timer=setInterval(function(){ try{ evaluate(); }catch(e){} }, 1000);
        return function(){ clearInterval(timer); };
      }, [evaluate]);
      // 会话域实例卸载 = 没有当前会话了（切到新会话页 / 关闭会话）：把 currentSessionId 清成 null，
      // 否则根域实例会一直拿上一个会话的 id 判定，新会话页的预设芯片永远接管不了（旧代码从不写 null）。
      // 只在会话域注册这个清理：根域实例重挂时不能把会话域刚发布的 id 抹掉。
      React.useEffect(function(){
        return function(){ if(ownId){ try{ store.setSessionId(null); }catch(e){} } };
      }, [store, ownId]);
      return ownId || store.getSnapshot().currentSessionId || null;
    }

    function Capsule(props){
      var store=props.store; var t=props.t;
      // 0.12.4：**先**订阅快照、再跑探测。顺序是硬约束 —— useCcPreset 的 effect 会写 store
      // （切会话时清掉 isCcMode），订阅必须先于那次写入建立，否则这次 emit 直接被丢掉，
      // 组件就停在首帧的旧快照上（胶囊不消失）。详见 useStoreSnapshot 注释。
      var s = useStoreSnapshot(store);
      var currentId = useCcPreset(store, props, t);
      // 结论必须归属于**当前会话**：切会话那一帧 store 里还是上一个会话的 isCcMode=true，
      // 不能拿它点亮胶囊（少一帧错误显示，也不依赖订阅是否跟上）。
      var sameSession = !!currentId && s.currentSessionId === currentId;
      if((!s.isCcMode || !sameSession) && !s.panelOpen) return null;
      var draft=s.draft; var loreCount=draft.data.character_book.entries.length;
      var valid=s.valid && s.valid.valid;
      // 计数文案走词表。注：dsh 的 t(key, params?) **是支持 `{name}` 插值的**（0.1.6 / 0.1.7 都支持），
      // 这里手写 replace 只因为这些键历史上就不带参数；新键请直接用 t(key, {n: ...})，
      // 千万别对同一个键既传 params 又手写 replace（会替换两次）。
      var loreText=t("common.loreCount").replace("{n}", String(loreCount));
      var text=(t("capsule.open")+" · "+loreText+" · "+ (valid? t("capsule.exported"): t("capsule.draft")) + (s.slotWarn? (" · "+t("capsule.slotWarn")): ""));
      return h("div",{style:S.dockWrap, "data-dsh-cc-studio":"dock-row"},
        h("button",{type:"button", style:S.capsule, title: t("hint.capsule"), onClick:function(){ store.setPanel(true); }},
          h("span",{style:{width:7,height:7,borderRadius:50, background: valid? "#2ee6a6":"#7c5cff", boxShadow:"0 0 8px "+(valid?"#2ee6a6":"#7c5cff"), display:"inline-block", flex:"none"}}),
          h("span",{style:{overflow:"hidden", textOverflow:"ellipsis"}}, text),
          h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:11}}, "— "+(s.panelOpen? t("capsule.expanded"): t("capsule.collapseHint")))
        ),
        h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginLeft:8}}, loreText+" · "+draft.data.name)
      );
    }

    // 破坏性操作的二次确认：拿不到确认框（或它抛错）一律当「没确认」——
    // 宁可什么都不做，也不静默清掉用户的数据。
    function confirmClear(t){
      try{
        if(typeof window==="undefined" || typeof window.confirm!=="function") return false;
        return !!window.confirm(t("store.confirmClear"));
      }catch(e){ return false; }
    }

    // 键盘焦点判定：只有 :focus-visible（键盘 Tab 进来）才画焦点环；鼠标点出来的焦点不画。
    // 老浏览器没有 :focus-visible 时按「有焦点」处理 —— 宁可多画一环，不可让键盘用户失去位置感。
    function isFocusVisible(e){
      try{
        var el=e && e.currentTarget;
        if(!el || typeof el.matches!=="function") return true;
        return !!el.matches(":focus-visible");
      }catch(err){ return true; }
    }

    function Workshop(props){
      var store=props.store; var t=props.t;
      // 0.12.4：同样「先订阅、后探测」（理由见 useStoreSnapshot / Capsule 注释）。
      var s = useStoreSnapshot(store);
      var currentId = useCcPreset(store, props, t);
      // 悬停 / 键盘焦点是纯局部视觉状态，不进 store：否则鼠标每移动一次都要重渲染整棵工坊树（右侧预览是整份 JSON）。
      var hoverRef=React.useState(null); var hoverKey=hoverRef[0], setHoverKey=hoverRef[1];
      var focusRef=React.useState(null); var focusKey=focusRef[0], setFocusKey=focusRef[1];
      // 主区底部三块阅读辅助（实时预览 / CBS 速查 / 融合说明）默认全收起：占地方、但不常看
      var foldRef=React.useState({}); var openFold=foldRef[0], setOpenFold=foldRef[1];
      // 从「已存角色」卡片跳进导出页时的来源卡（几秒后自动清掉）：用来给那枚按钮一个即时反馈，
      // 并在导出页把「导出的仍是工坊里这张、你点的那张还没载入」说清楚。清空后回到常态提示。
      var jumpRef=React.useState(null); var jumpFrom=jumpRef[0], setJumpFrom=jumpRef[1];
      // 0.14.0：导出改成**独立弹层**（不再占用中栏一整页）。中栏是「读卡」的地方，
      // 导出是「把卡交出去」的动作 —— 两者混在一页里，用户滑一段正文就会撞见一排下载按钮，
      // 而且离开导出页之后那页的内容（校验错误清单）也跟着消失。弹层让它们各归各位。
      // 开关状态在 store（exportOpen），组件只负责渲染（入口/热更新残留/测试都走同一处）。
      // 0.8.0 关系视图的「添加关系」表单（局部状态，不进 store：它只是草稿输入）
            var relFormRef=React.useState({from:"", to:"", type:"friend", strength:3, direction:"one-way", note:""}); var relForm=relFormRef[0], setRelForm=relFormRef[1];
      // 0.9.0：关系的「添加 / 编辑」改成二级弹窗（列表回到只读的「关系表」形态）
      var relEditRef=React.useState(null); var relEdit=relEditRef[0], setRelEdit=relEditRef[1];
      var relAddRef=React.useState(false); var relAddOpen=relAddRef[0], setRelAddOpen=relAddRef[1];
      // 0.8.1：分组名 / NPC 名改用内联输入（不再用 window.prompt —— 内嵌 webview 会拦掉它）
      var groupDraftRef=React.useState(null); var groupDraft=groupDraftRef[0], setGroupDraft=groupDraftRef[1];
            var npcDraftRef=React.useState(""); var npcDraft=npcDraftRef[0], setNpcDraft=npcDraftRef[1];
      // 折叠面板：哪些分组被收起（键 = 分组 id，"" 表示未分组那一节）
      var collapsedRef=React.useState({}); var collapsedGroups=collapsedRef[0], setCollapsedGroups=collapsedRef[1];
      // 0.9.0 共享世界书的「＋ 新条目」表单（局部状态，不进 store：只是草稿输入）
      var bookFormRef=React.useState({name:"", keys:"", content:""}); var bookForm=bookFormRef[0], setBookForm=bookFormRef[1];
      function toggleGroupCollapsed(gid){ var key=String(gid||""); var next=Object.assign({}, collapsedGroups); next[key]=!next[key]; setCollapsedGroups(next); }
      React.useEffect(function(){
        if(s.panelOpen){
          store.refreshLibrary(); store.refreshGroups(); store.refreshTargets();
          // 0.9.0：面板一开就把当前组的共享世界书拉回来（左侧徽章与共享书视图都靠它）
          if(String(s.currentGroupId||"") && s.currentGroupId !== "__none") store.loadBook();
        }
      }, [s.panelOpen]);
      // 0.14.0：cur=3 是「导出页」时代的热更新残留值 —— 归一到总览并打开弹层，中栏不再有空白页。
      React.useEffect(function(){
        if(s.cur===3){ store.setCur(5); store.openExport(); }
      }, []);   // 空依赖：只绑一次；当前 cur 从 store.getSnapshot() 读，不靠闭包
      // 0.22.0：滚轮滚动时反推「当前章节」（锚点高亮）。点击锚点走 scrollToSection，这里处理手动滚动。
      // 判定用「顶部 24px 内最先贴顶的那一节」——用「视口中线」会漏掉短章节（开场只有 ~300px 高）。
      React.useEffect(function(){
        if(typeof document==="undefined" || typeof document.getElementById!=="function") return;
        var sc = document.getElementById("cc-scroller");
        if(!sc) return;
        var pending = 0;
        function onScroll(){
          if(pending) return;
          pending = setTimeout(function(){
            pending = 0;
            try{
              var list = sc.querySelectorAll("section[data-cur]");
              var scTop = sc.getBoundingClientRect().top;
              var best = null, bestAbs = Infinity;
              for(var i=0;i<list.length;i++){
                var off = list[i].getBoundingClientRect().top - scTop;
                if(off <= 24 && Math.abs(off) < bestAbs){ bestAbs = Math.abs(off); best = list[i]; }
              }
              if(best){
                var c = Number(best.getAttribute("data-cur"));
                if(c !== store.getSnapshot().cur) store.setCur(c);
              }
            }catch(e){}
          }, 90);
        }
        sc.addEventListener("scroll", onScroll, { passive: true });
        return function(){ try{ sc.removeEventListener("scroll", onScroll); }catch(e){} };
      }, [s.cur]);

      // 0.22.0：打开工坊自动跑一次校验（只读），总览里的体检报告一进来就有内容 ——
      // 否则用户要先点一次「校验」才看得到，而总览正是「这张卡怎么样」的入口。
      React.useEffect(function(){
        if(!s.panelOpen) return;
        if(s.validationReport) return;
        try{ store.validate(); }catch(e){}
      }, [s.panelOpen]);
      if(!s.panelOpen) return null;
      // 只读判定：LLM 锁 active（且设置里没关保护）或正在只读预览时，所有写草稿的控件禁用。
      // 用 store.isReadOnly() 而不是在这里重算一遍 —— 渲染与 store 守卫必须是同一个判据，
      // 否则会出现「按钮亮着、点了却没反应」或者反过来（能点却被拦）。
      var readOnly = store.isReadOnly();
      var previewing = !!s.preview;
      // 0.13.0：共享书导出按钮 = 宿主注册的目标（cc_listTargets）；新平台不用改客户端。
      // 宿主没回目标（旧宿主 / RPC 失败）时回退内置两枚，界面与旧版一致。
      function bookTargets(){
        return (s.targets && s.targets.length)? s.targets : [
          {id:"ccv3", label:"CCv3"}, {id:"sillytavern", label:"SillyTavern"}
        ];
      }
      function bookTargetLabel(tg){
        // 内置两枚沿用既有词表（中文/英文界面都不会退化）；新目标优先 `export.book.target.<id>`，
        // 没有词条时退回适配器自己的 label（来自宿主数据，不是 UI 字面量，不触发 i18n 源码守卫）。
        if(tg.id==="ccv3") return t("export.book.button");
        if(tg.id==="sillytavern") return t("export.book.buttonSt");
        var key="export.book.target."+tg.id;
        var v=t(key);
        return (v===key)? String(tg.label||tg.id) : v;
      }
      function bookTargetButtons(){
        return bookTargets().map(function(tg, i){
          return h("button",{key:"bookTarget:"+tg.id, type:"button",
            style: i===0? S.btn : Object.assign({}, S.btn, S.btnGhost),
            onMouseDown:stopFocusSteal,
            onClick:function(){ store.exportBook(tg.id); }}, bookTargetLabel(tg));
        });
      }
      // 顶部胶囊（会话域那几个快捷入口）：0.9.0 起跟左侧新结构走，取最常看的三处 ——
      // 总览（整卡状态）/ 角色 / 世界书。其余入口都在左侧导航里，胶囊不追求全。
      var steps=[{cur:5, key:"step.overview"}, {cur:1, key:"step.char"}, {cur:2, key:"step.lore"}];
      // 步骤项的三个视觉状态严格互斥：选中(active) / 键盘焦点(focus-visible) / 悬停(hover)。
      // 鼠标点击走 onMouseDown preventDefault，不把焦点抢到按钮上 —— 否则旧项的焦点环会留在原地，
      // 与新的选中项同时发亮，看起来像「同时选中了两个」（这是本次修的问题）。
      function navItem(cur, title, desc, prog){
        var active=s.cur===cur;
        var hovered=hoverKey==="nav:"+cur;
        var focused=focusKey==="nav:"+cur;
        var dot = prog ? stateDot(prog.state) : null;
        return h("button",{key:"step:"+cur, type:"button", "aria-current": active? "step": undefined,
          style: Object.assign({}, S.navBtn, hovered&&!active? S.navBtnHover:{}, focused? S.navBtnFocus:{}, active? S.navBtnActive:{}),
          onMouseDown:function(e){ if(e && e.preventDefault) e.preventDefault(); },
          onMouseEnter:function(){ setHoverKey("nav:"+cur); },
          onMouseLeave:function(){ setHoverKey(null); },
          onFocus:function(e){ setFocusKey(isFocusVisible(e)? "nav:"+cur : null); },
          onBlur:function(){ setFocusKey(null); },
          onClick:function(){ store.setCur(cur); }
        }, title,
          dot? h("span",{style:{fontSize:11, color:dot.color, marginLeft:6}}, dot.text) : null,
          (prog && prog.note)? h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginLeft:6}}, prog.note) : null,
          h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:2}}, desc));
      }
      // 顶部横向锚点（0.22.0）：替代原来的左侧 200px 导航列。
      // 三个视觉状态仍然严格互斥（选中 / 键盘焦点 / 悬停）—— 0.4.0/0.10.x 修过的「两处看起来都像选中」不能再回来。
      // 点击 = 设 cur + 平滑滚到对应 section；滚动时由 effect 反推 cur（见 cc-scroller 的 scroll 监听）。
      function tabBtn(cur, title, prog){
        var active=s.cur===cur;
        var hovered=hoverKey==="tab:"+cur;
        var focused=focusKey==="tab:"+cur;
        var dot = prog ? stateDot(prog.state) : null;
        return h("button",{key:"tab:"+cur, type:"button", "aria-current": active? "step": undefined,
          style: Object.assign({}, S.tab, hovered&&!active? S.tabHover:{}, focused? S.tabFocus:{}, active? S.tabActive:{}),
          onMouseDown:function(e){ if(e && e.preventDefault) e.preventDefault(); },
          onMouseEnter:function(){ setHoverKey("tab:"+cur); },
          onMouseLeave:function(){ setHoverKey(null); },
          onFocus:function(e){ setFocusKey(isFocusVisible(e)? "tab:"+cur : null); },
          onBlur:function(){ setFocusKey(null); },
          onClick:function(){ scrollToSection(cur); }
        }, title,
          dot? h("span",{style:{fontSize:10, color:dot.color, marginLeft:5}}, dot.text) : null);
      }
      /** 滚到某个章节：rect 差算位置（不能用 offsetTop —— offsetParent 不是滚动容器，实测差几十像素）。 */
      function scrollToSection(cur){
        store.setCur(cur);
        try{
          if(typeof document==="undefined") return;
          var sc=document.getElementById("cc-scroller");
          var el=document.getElementById("cc-sec-"+cur);
          if(!sc || !el) return;
          var top = sc.scrollTop + (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) - 8;
          sc.scrollTo({ top: Math.max(0, top), behavior:"smooth" });
        }catch(e){}
      }
      // 工具按钮（⛶ / 删除…）鼠标按下就拦掉默认行为：别把焦点抢走，否则又留下一圈焦点描边
      function stopFocusSteal(e){ if(e && e.preventDefault) e.preventDefault(); }
      // 卡片上的「导出」= **直接导出这张已存卡**（0.14.1 与「载入」解绑）：先按 id 取回那份
      // draft（只读、不写草稿槽），再打开弹层把 `exportTarget` 指过去；按钮 6s「已打开 ✓」反馈保留。
      function jumpToExport(entry){
        var id = String((entry&&entry.id)||"");
        if(!id) return;
        store.exportLibraryCard(entry).then(function(ok){
          if(!ok) return;
          setJumpFrom({ id: id, name: String((entry && entry.name) || "") });
          try{ setTimeout(function(){ setJumpFrom(null); }, 6000); }catch(e){}
        });
      }
      /** 普通入口：打开导出弹层，导出当前工坊草稿（顺手清掉上一次卡片跳转留下的按钮反馈）。 */
      function openExportPanel(){
        setJumpFrom(null);
        store.openExport(null);
      }
      function closeExportPanel(){
        store.closeExport();
        setJumpFrom(null);
      }
      // 折叠区：主区底部那几块「阅读辅助」（实时 CCv3 预览 / CBS 速查 / 融合说明）。
      // 默认全部收起 —— 它们不常看，收起来只占一行标题，阅读区因此能拿到整幅宽度。
      function foldPanel(id, title, badge, body){
        var open = !!openFold[id];
        return h("section",{style:S.fold},
          h("button",{type:"button", style:S.foldHead, "aria-expanded": open? "true": "false", onMouseDown:stopFocusSteal,
            onClick:function(){ setOpenFold(function(prev){ var nx=Object.assign({}, prev); nx[id]=!nx[id]; return nx; }); }},
            h("span",null, (open? "▾ " : "▸ ")+title),
            badge||null),
          open? h("div",{style:S.foldBody}, body): null);
      }
      // —— 阅读态字段（0.4.0 重构的核心构件）——
      // 标签（+ 可选工具）+ 无边框输入控件；textarea 用 field-sizing:content 按内容自动撑高，
      // 所以默认视图看起来就是排好版的正文，点进去直接改。长文仍可走 ⛶ 大框（带打开时快照，「取消」真回滚）。
      function field(title, key, opts){
        opts=opts||{};
        var ro = !!opts.readOnly || readOnly;
        var raw = opts.value!==undefined ? opts.value : s.draft.data[key];
        var val = raw==null? "" : String(raw);
        var write = opts.onChange || function(v){ store.updateDraft(function(d){ d[key]=v; }); };
        var tools=[];
        if(opts.tools) tools=tools.concat(opts.tools);
        if(opts.bigBox!==false) tools.push(h("button",{key:"bigbox", type:"button", style: ro? Object.assign({}, S.iconBtn, {opacity:0.4, cursor:"default"}) : S.iconBtn, title:t("action.expand"), disabled: ro, onMouseDown:stopFocusSteal,
          onClick:function(){
            if(ro) return;                    // 只读：大框也不开（大框里同样改不了，开了只会让人以为能写）
            var snapshot=s.draft.data[key];   // 「取消」回滚用
            store.setEditingText(title, val,
              function(v){ store.updateDraft(function(d){ d[key]=v; }); },
              function(){ store.updateDraft(function(d){ d[key]=snapshot; }); });
          }}, "⛶"));
        return h("div",{key:opts.rowKey, style:Object.assign({}, S.fieldRow, opts.style)},
          h("div",{style:S.fieldLabel},
            h("label",{style:S.fieldName}, title),
            tools.length? h("div",{style:S.fieldTools}, tools): null),
          opts.input
            ? h("input",{style:Object.assign({}, S.readInput, ro? {color:"var(--dsw-alias-label-secondary)"}:{}), value:val, readOnly:ro, placeholder:opts.placeholder||t("workshop.field.empty"), onChange:function(e){ write(e.target.value); }})
            : h("textarea",{style:S.readText, value:val, readOnly:ro, placeholder:opts.placeholder||t("workshop.field.empty"), onChange:function(e){ write(e.target.value); }})
        );
      }
      // 每条问候语一段正文（元素内部换行原样保留，不做「每行一条」的序列化）；阅读态 + 逐条 ⛶ / 删除
      function greetingList(key, title, hint){
        var arr = Array.isArray(s.draft.data[key]) ? s.draft.data[key] : [];
        var atMax = arr.length >= GREETING_MAX;
        return h("div",{style:S.fieldRow},
          h("div",{style:S.fieldLabel},
            h("label",{style:S.fieldName}, title),
            h("div",{style:S.fieldTools},
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, hint+" · "+arr.length+"/"+GREETING_MAX),
              h("button",{type:"button", style:Object.assign({}, S.iconBtn, {borderColor:"var(--dsw-alias-border-l1)"}), disabled:atMax||readOnly, onMouseDown:stopFocusSteal,
                onClick:function(){ if(readOnly) return; store.updateDraft(function(d){ d[key]=appendGreeting(d[key]); }); }}, atMax? t("workshop.greeting.atMax",{max:GREETING_MAX}):t("workshop.greeting.add")))
          ),
          arr.length===0
            ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", border:"1px dashed var(--dsw-alias-border-l1)", borderRadius:10, padding:"12px", textAlign:"center"}}, t("workshop.greeting.empty"))
            : arr.map(function(text, i){
                var label=t("workshop.greeting.entryLabel",{title:title, n:(i+1)});
                return h("div",{key:i, style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:"8px 10px", marginBottom:8, background:"var(--dsw-alias-bg-base)"}},
                  h("div",{style:S.fieldLabel},
                    h("span",{style:{fontSize:11, fontWeight:600, color:"var(--dsw-alias-label-secondary)"}}, label),
                    h("div",{style:S.fieldTools},
                      h("button",{type:"button", style: readOnly? Object.assign({}, S.iconBtn, {opacity:0.4, cursor:"default"}) : S.iconBtn, title:t("action.expand"), disabled:readOnly, onMouseDown:stopFocusSteal,
                        onClick:function(){
                          if(readOnly) return;
                          store.setEditingText(label, String(text==null? "": text),
                            function(v){ store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, v); }); },
                            function(){ store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, text); }); });
                        }}, "⛶"),
                      h("button",{type:"button", style:Object.assign({}, S.iconBtn, {color:"#e8a6a6"}), disabled:readOnly, onMouseDown:stopFocusSteal,
                        onClick:function(){ if(readOnly) return; store.updateDraft(function(d){ d[key]=removeGreetingAt(d[key], i); }); }}, t("common.delete")))
                  ),
                  h("textarea",{style:S.readText, value:String(text==null? "": text), readOnly:readOnly, placeholder:t("workshop.field.empty"),
                    onChange:function(e){ var v=e.target.value; store.updateDraft(function(d){ d[key]=setGreetingAt(d[key], i, v); }); }}));
              })
        );
      }
      // 0.9.0 总览用的进度行：与工具半 workflow.state 同口径（三态），但纯客户端算 —— 省一次 RPC，
      // 也保证「左侧导航的徽章」和「总览页」永远一致（同一个函数算出来的）。
      function draftProgress(s2){
        var d = s2.draft.data;
        var entries = Array.isArray(d.character_book && d.character_book.entries) ? d.character_book.entries : [];
        var manual = entries.filter(function(e){ return !(e && (e.cc_auto || (e.extensions && e.extensions.cc_auto))); }).length;
        var filled = function(v){ return String(v==null? "": v).trim().length > 0; };
        var charN = [d.name, d.description, d.personality, d.scenario].filter(filled).length;
        var worldN = ["timeline","factions","geo","power","daily"].filter(function(k){ return filled(s2.world[k]); }).length;
        var alt = (d.alternate_greetings||[]).length, grp = (d.group_only_greetings||[]).length;
        var firstOk = filled(d.first_mes);
        var three = function(n, need){ return n>=need ? "ok" : (n>0 ? "partial" : "missing"); };
        return [
          { cur:1, title:t("step.char"), state: three(charN,4), note: charN+"/4" },
          { cur:0, title:t("step.world"), state: three(worldN,3), note: worldN+"/5" },
          { cur:2, title:t("step.lore"), state: (entries.length>=5 && manual>=1) ? "ok" : (entries.length>0 ? "partial" : "missing"),
            note: t("common.entries",{n:String(entries.length)}) },
          { cur:6, title:t("step.greetings"), state: (firstOk && alt>=2 && grp>=1) ? "ok" : ((firstOk||alt||grp) ? "partial" : "missing"),
            note: (firstOk?1:0)+"+"+alt+"+"+grp },
        ];
      }
      function stateDot(state){
        return { color: state==="ok" ? "#a6e8c8" : (state==="partial" ? "#ffc46b" : "var(--dsw-alias-label-secondary)"),
          text: state==="ok" ? "✓" : (state==="partial" ? "◐" : "○") };
      }
      /**
       * 远程导入区块（0.15.0）：按宿主 `cc_listTargets` 里带 `remote` 的目标渲染 ——
       * 平台名、默认地址、是否支持都来自 adapter（客户端不写死 SillyTavern）。
       * 状态只来自 store.stProbe；点「导入」走 store.importToSt()（由宿主代理 ST 请求）。
       */
      function stImportBlock(){
        var tg = store.remoteTarget ? store.remoteTarget() : null;
        if(!tg) return null;
        var remote = tg.remote || {};
        var label = String(remote.label || tg.label || tg.id);
        var probe = s.stProbe;
        var statusText = t("st.offline");
        var dotColor = "var(--dsw-alias-label-secondary)";
        var online = false;
        if(probe && probe.status === "probing") statusText = t("st.probing");
        else if(probe && probe.status === "online"){
          online = true; dotColor = "#a6e8c8";
          statusText = t("st.online") + (probe.version ? (" · " + label + " " + probe.version) : "");
        } else if(probe && probe.status === "auth"){ dotColor = "#ffc46b"; statusText = t("st.needAuth"); }
        else if(probe && probe.status === "forbidden"){ dotColor = "#e8a6a6"; statusText = t("st.forbidden"); }
        var busy = s.stBusy === "import";
        var canImport = online && !busy && !previewing;
        var base = store.stBaseUrl ? store.stBaseUrl() : "";
        var authOpen = !!s.stShowAuth || (probe && probe.status === "auth");
        return h("div",{style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:"10px 12px", margin:"0 0 12px", background:"var(--dsw-alias-bg-base)"}},
          h("div",{style:{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}},
            h("strong",{style:{fontSize:12}}, t("st.title",{label:label})),
            h("span",{style:Object.assign({}, S.badge, {borderColor: online? "rgba(166,232,200,.55)" : "var(--dsw-alias-border-l1)", color:dotColor})}, "● "+statusText),
            h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost, {padding:"3px 10px", fontSize:11}), disabled:busy, onMouseDown:stopFocusSteal,
              onClick:function(){ if(store.probeSt) store.probeSt(true); }}, t("st.probe"))),
          h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", margin:"6px 0 8px", lineHeight:1.7}}, t("st.hint")),
          h("div",{style:{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}},
            h("input",{type:"text", style:Object.assign({}, S.input, {flex:"1 1 220px", minWidth:160}), value:base,
              placeholder: remote.defaultBaseUrl || "", spellCheck:false,
              onChange:function(ev){ store.setStBaseUrl(ev.target.value); }}),
            h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost, {padding:"3px 10px", fontSize:11}), onMouseDown:stopFocusSteal,
              onClick:function(){ store.setStShowAuth(!authOpen); }}, authOpen? t("st.hideAuth") : t("st.showAuth"))),
          authOpen
            ? h("div",{style:{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginTop:6}},
                h("input",{type:"text", style:Object.assign({}, S.input, {flex:"1 1 140px", minWidth:120}), value:String(s.stUser||""),
                  placeholder:t("st.user"), autoComplete:"off", onChange:function(ev){ store.setStUser(ev.target.value); }}),
                h("input",{type:"password", style:Object.assign({}, S.input, {flex:"1 1 140px", minWidth:120}), value:String(s.stPass||""),
                  placeholder:t("st.pass"), autoComplete:"off", onChange:function(ev){ store.setStPass(ev.target.value); }}))
            : null,
          h("div",{style:{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginTop:8}},
            h("button",{type:"button",
              style: canImport? S.btn : Object.assign({}, S.btn, {opacity:0.45, cursor:"default"}),
              disabled: !canImport, onMouseDown:stopFocusSteal,
              onClick:function(){ if(canImport && store.importToSt) store.importToSt(); }},
              busy? t("st.importing") : t("st.import")),
            h("label",{style:{display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--dsw-alias-label-secondary)", cursor:"pointer"}},
              h("input",{type:"checkbox", checked:s.stWorldMode === "overwrite", onChange:function(ev){ store.setStWorldMode(ev.target.checked? "overwrite" : "skip"); }}),
              t("st.overwrite")),
            h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost, {padding:"3px 10px", fontSize:11}), disabled:busy, onMouseDown:stopFocusSteal,
              onClick:function(){ if(store.pickStCover) store.pickStCover(); }}, t("st.cover")),
            s.stImageName? h("span",{style:S.badge}, s.stImageName) : null,
            s.stImageName? h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost, {padding:"3px 8px", fontSize:11}), disabled:busy, onMouseDown:stopFocusSteal,
              title:t("st.coverClear"), onClick:function(){ if(store.clearStCover) store.clearStCover(); }}, "✕") : null),
          h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", marginTop:6, lineHeight:1.6}}, t("st.footnote",{label:label}))
        );
      }
      /**
       * 导出面板（0.14.0 从「中栏一整页」整体搬进独立弹层）。
       * 现在只有弹层调它：三个入口（左下角「校验导出」/ 总览页按钮 / 已存角色卡片上的「导出」）
       * 一律 store.openExport()，不再改 cur —— 导出不再是「一个页面」，而是一次动作。
       */
      function exportPanel(target){
        var v=s.valid;
        // 0.14.1：导出对象可以是「角色库里那张已存卡」（点哪张导哪张）——显示与动作都围绕它，
        // 不写回工坊草稿；只有草稿模式才显示校验徽章/错误清单（那是当前草稿的状态）。
        var tgt = target || null;
        var card = (tgt && tgt.card) ? tgt.card : s.draft;
        var data = card.data || {};
        var draftMode = !tgt;
        return h("div",null,
          h("div",{style:S.readCard},
            // 标题后面挂上「现在导的是哪张卡」
            h("h3",{style:Object.assign({}, S.readTitle, {paddingRight:38})}, t("workshop.export.title"),
              h("span",{style:{marginLeft:8, fontSize:12, fontWeight:400, color:"var(--dsw-alias-label-secondary)"}},
                "· "+(String(data.name||"").trim() || t("workshop.library.unnamed")))),
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, marginBottom:8}},
              draftMode ? h("span",{style: Object.assign({}, S.badge, v.valid? {borderColor:"var(--dsw-alias-state-success-primary)", color:"#a6e8c8", background:"color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, var(--dsw-alias-bg-base))"}:{borderColor:"var(--dsw-alias-state-error-primary)", color:"#e8a6a6", background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))"})}, v.valid? t("workshop.export.passed"):t("workshop.export.failed")) : null,
              h("span",{style:S.badge},t("common.groupGreetings",{n:(data.group_only_greetings||[]).length})),
              h("span",{style:S.badge}, "assets: "+(data.assets? data.assets.length:0))
            ),
            (draftMode && v.errors.length)? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-state-error-primary)", borderRadius:8, padding:8, marginBottom:8, color:"#e8a6a6", fontSize:12}}, v.errors.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            (draftMode && v.warnings.length)? h("div",{style:{background:"color-mix(in srgb, var(--dsw-alias-border-l1) 40%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:8, marginBottom:8, color:"var(--dsw-alias-label-secondary)", fontSize:12}}, v.warnings.map(function(e){ return h("div",{key:e}, "• "+e); })):null,
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, margin:"12px 0"}},
              // 预览时它们导出的是「别人卡的一份影像」，不是工坊里的卡 —— 全部禁用（锁 active 但未预览时允许导出）
              h("button",{style:S.btn, disabled:previewing, onClick:function(){ store.exportJSON(); }}, t("action.exportJson")),
              h("button",{style: Object.assign({}, S.btn, {background:"#e05555"}), disabled:previewing, onClick:function(){ store.exportPNG(); }}, s.busy==="exportPng"? t("action.generating"):t("action.exportPng")),
              h("button",{style: Object.assign({}, S.btn, {background:"#e05555", opacity:0.92}), disabled:previewing, onClick:function(){ store.embedIntoPng(); }}, s.busy==="exportPng"? t("action.writing"):t("action.embedPng")),
              h("button",{style: Object.assign({}, S.btn, {background:"#2e86de"}), disabled:previewing, onClick:function(){ store.exportCharx(); }}, s.busy==="exportCharx"? t("action.generating"):t("action.exportCharx")),
              draftMode ? h("button",{style: Object.assign({}, S.btn, S.btnGhost), onClick:function(){ store.validate(); }}, s.busy==="validate"? t("action.validating"): t("action.validate")) : null,
              h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:11, alignSelf:"center"}}, t("workshop.export.hint2"))
            ),
            // 0.9.0：组级共享世界书 —— 导出独立文件（零重复的做法），或按需把共享条目并进这张卡
            // 0.14.2：作用域跟随导出目标（库卡 = 那张卡自己的分组；草稿 = 当前分组），不再固定读工坊当前组
            (function(){
              var sc = store.exportScope();
              if(tgt && sc.other && s.exportBookBusy){
                return h("div",{style:{fontSize:11, margin:"-4px 0 10px", lineHeight:1.7, color:"var(--dsw-alias-label-secondary)"}},
                  t("export.book.title") + " · " + t("export.book.loading"));
              }
              var bk=sc.book, gid=sc.gid;
              var ready=!!(bk && bk.exists && bk.book);
              if(!gid || !ready){
                return h("div",{style:{fontSize:11, margin:"-4px 0 10px", lineHeight:1.7, color:"var(--dsw-alias-label-secondary)"}},
                  t("export.book.title") + " · " + t("export.book.none"));
              }
              return h("div",{style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:"10px 12px", margin:"-4px 0 12px", background:"var(--dsw-alias-bg-base)"}},
                h("div",{style:{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}},
                  h("strong",{style:{fontSize:12}}, t("export.book.title")),
                  // ⚠️ 端点给的是**原始文档**（book.data.*）。这里曾经写成 `bk.book.entries` —— 于是
                  // 任何「当前组有共享书」的卡一进导出页就抛 TypeError，整个工坊闪退、连 dsh 一起卡死
                  // （0.8.2 实机事故；同一形状错误在关系视图与导航徽章上各犯过一次，别再读顶层）。
                  h("span",{style:S.badge}, bk.book.data.name||"—"),
                  h("span",{style:S.badge}, t("book.entries",{n:String(bk.book.data.entries.length)})),
                  h("span",{style:S.badge}, t("book.tokens",{n:String(bk.tokens||0)})),
                  sc.other ? h("span",{style:Object.assign({}, S.badge, {borderColor:"rgba(96,165,250,.55)", color:"#9ecbff"})}, "· " + store.exportGroupName(gid)) : null),
                h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", margin:"6px 0 8px", lineHeight:1.7}}, t("export.book.hint")),
                h("div",{style:{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}},
                  bookTargetButtons(),
                  h("label",{style:{display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--dsw-alias-label-secondary)", cursor:"pointer"}},
                    h("input",{type:"checkbox", checked:!!s.bookMerge, onChange:function(ev){ store.setBookMerge(ev.target.checked); }}),
                    t("export.book.merge"))));
            })(),
            // 0.15.0：直接导入本机 SillyTavern（探测 → 先书后卡）。目标/地址/认证来自 adapter 的 remote 描述。
            stImportBlock(),
            // 0.14.1：导出与「载入」解绑 —— 目标卡由 tgt 决定；草稿模式才提示「导出的是工坊这张」。
            tgt
              ? h("div",{style:{fontSize:11, margin:"-4px 0 10px", lineHeight:1.7, color:"var(--dsw-alias-label-primary)", background:"rgba(96,165,250,.10)", border:"1px solid rgba(96,165,250,.45)", borderRadius:8, padding:"6px 10px"}},
                  t("workshop.export.savedCardHint",{name:(tgt.name||t("workshop.library.unnamed"))}))
              : h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", margin:"-4px 0 10px", lineHeight:1.7}}, t("workshop.export.currentHint")),
            draftMode ? field(t("workshop.export.creatorNotes"),"creator_notes",{rowKey:"notes"}) : null,
            draftMode ? h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              field("creation_date","creation_date",{rowKey:"cdate", input:true, readOnly:true, bigBox:false, value:String(data.creation_date)}),
              field(t("workshop.export.modificationDate"),"modification_date",{rowKey:"mdate", input:true, readOnly:true, bigBox:false, value:String(data.modification_date)})
            ) : null,
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      }
      /** 导出弹层外壳（0.14.0）：遮罩 + 面板 + 关闭；内容全部来自 exportPanel()。 */
      function exportDialog(){
        function close(){ closeExportPanel(); }
        var closeStyle={ position:"absolute", top:10, right:10, zIndex:2, appearance:"none", boxSizing:"border-box",
          width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", padding:0, font:"inherit",
          fontSize:15, lineHeight:1, cursor:"pointer", borderRadius:8,
          background: hoverKey==="export-close"? "#e05555":"transparent",
          border:"1px solid "+(hoverKey==="export-close"? "#e05555":"var(--dsw-alias-border-l1)"),
          color: hoverKey==="export-close"? "#fff":"var(--dsw-alias-label-primary)",
          transition:"background .12s ease, border-color .12s ease, color .12s ease" };
        return h("div",{style:Object.assign({}, S.overlay, {background:"rgba(0,0,0,.58)", zIndex:45}),
          onClick:function(e){ if(e.target===e.currentTarget) close(); }},
          h("div",{style:{position:"relative", width:"min(900px, 94vw)", maxHeight:"86vh", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3)"}},
            h("button",{type:"button", title:t("export.close"), "aria-label":t("export.close"), style:closeStyle,
              onMouseDown:stopFocusSteal,
              onMouseEnter:function(){ setHoverKey("export-close"); },
              onMouseLeave:function(){ setHoverKey(null); },
              onClick:close}, "✕"),
            h("div",{style:{overflow:"auto", flex:1, minHeight:0, paddingRight:4}}, exportPanel(s.exportTarget))));
      }
      // 0.22.0：单页滚动 —— 七个章节**常驻渲染**，按固定顺序拼成一列；
      // 锚点栏只负责「滚到哪一节 / 高亮哪一节」，不再决定「渲染哪一节」。
      var secs={};
      var SECTION_ORDER=[5,1,0,2,6,4,7];
      // 0.22.0：每个章节统一带「序号 + 章节名」头（与原型一致），内容仍由原来的分支渲染。
      var SECTION_META = {
        5:{ n:1, key:"step.overview" }, 1:{ n:2, key:"step.char" }, 0:{ n:3, key:"step.world" },
        2:{ n:4, key:"step.lore" }, 6:{ n:5, key:"step.greetings" }, 4:{ n:6, key:"step.rel" }, 7:{ n:7, key:"step.book" },
      };
      function sectionWrap(cur, inner){
        var meta = SECTION_META[cur] || { n:0, key:"" };
        return h("section",{key:"cc-sec-"+cur, id:"cc-sec-"+cur, "data-cur":String(cur), style:{scrollMarginTop:8, marginBottom:14}},
          h("div",{style:{display:"flex", alignItems:"center", gap:8, padding:"0 2px 6px"}},
            h("span",{style:{display:"inline-flex", alignItems:"center", justifyContent:"center", width:18, height:18, borderRadius:5, background:"rgba(124,92,255,.16)", color:"#7c5cff", fontSize:10, fontWeight:700}}, String(meta.n)),
            h("span",{style:{fontSize:13, fontWeight:600, color:"var(--dsw-alias-label-primary)"}}, t(meta.key))),
          inner);
      }
      {   // 章节 0
        // 五维世界观：默认直接读全文（无边框 textarea 自动撑高），⛶ 仍可放大框写长文
        function worldField(key, title){
          var val = s.world[key]||"";
          return h("div",{key:key, style:S.fieldRow},
            h("div",{style:S.fieldLabel},
              h("label",{style:S.fieldName}, title),
              h("div",{style:S.fieldTools},
                h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.world.chars",{n:String(val.length)})),
                h("button",{type:"button", style: readOnly? Object.assign({}, S.iconBtn, {opacity:0.4, cursor:"default"}) : S.iconBtn, title:t("action.expand"), disabled:readOnly, onMouseDown:stopFocusSteal, onClick:function(){ if(!readOnly) store.setEditingWorld(key); }}, "⛶"))),
            h("textarea",{style:S.readText, value:String(val), readOnly:readOnly, placeholder:t("workshop.world.empty"),
              onChange:function(e){ store.setWorldPatch(key, e.target.value); }}));
        }
        secs[0]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle},t("workshop.world.title")),
            h("div",{style:S.readHint},t("workshop.world.hint")),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 18px"}},
              worldField("timeline", t("workshop.world.timeline")),
              worldField("factions", t("workshop.world.factions")),
              worldField("geo", t("workshop.world.geo")),
              worldField("power", t("workshop.world.power")),
              h("div",{style:{gridColumn:"span 2", display:"grid"}}, worldField("daily", t("workshop.world.daily")))
            ),
            h("div",{style:{display:"flex", gap:8, marginTop:6}},
              h("button",{type:"button", style: Object.assign({}, S.btn, S.btnGhost), onMouseDown:stopFocusSteal, onClick:function(){ store.setCur(1); }}, t("action.nextChar"))
            ),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      }
      {   // 章节 1
        secs[1]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle},t("workshop.char.sixTitle")),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 18px"}},
              field("name","name",{rowKey:"name", input:true}),
              field(t("workshop.field.nickname"),"nickname",{rowKey:"nickname", input:true})
            ),
            field(t("workshop.field.tags"),"tags",{rowKey:"tags", input:true, bigBox:false, value:(s.draft.data.tags||[]).join(", "), onChange:function(v){ store.updateDraft(function(d){ d.tags=v.split(",").map(function(x){return x.trim();}).filter(Boolean); }); }}),
            // N1（0.7.0）：data.creator 此前**没有任何写入路径**（工具侧与工坊都改不了），
            // 而 cc_validate 每次都警告它为空。这里补上人工入口，工具侧对应 cc_patch_character 的 creator。
            field(t("workshop.field.creator"),"creator",{rowKey:"creator", input:true, bigBox:false}),
            field("description","description",{rowKey:"desc"}),
            field("personality","personality",{rowKey:"pers"}),
            field("scenario","scenario",{rowKey:"scen"}),
            h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}},
              field("system_prompt","system_prompt",{rowKey:"sys"}),
              field("post_history_instructions","post_history_instructions",{rowKey:"phi"})
            ),
            // 0.17.0：Character's Note（ST 扩展字段 data.extensions.depth_prompt）只读展示 ——
            // ST 会把它每轮注入在最近消息内；工坊这边只让用户看到「卡里带了什么」，改动交给 CC 模式。
            (function(){
              var dp = s.draft.data.extensions && s.draft.data.extensions.depth_prompt;
              var txt = dp && String(dp.prompt||"").trim();
              if(!txt) return null;
              return h("div",{style:S.fieldRow},
                h("div",{style:S.fieldLabel},
                  h("label",{style:S.fieldName}, t("workshop.field.depthNote")),
                  h("div",{style:S.fieldTools}, h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.field.depthHint")))),
                h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-primary)", whiteSpace:"pre-wrap", lineHeight:1.7, padding:"6px 8px", margin:"0 -8px", border:"1px dashed var(--dsw-alias-border-l1)", borderRadius:8}}, txt));
            })()
          )
        );
      }
      {   // 章节 5
        // ── 总览（0.9.0 新增）：一眼看完整张卡 + 快捷动作。写作已交给 LLM，工坊的入口应该是「状态」。
        var prog=draftProgress(s);
        secs[5]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle}, t("step.overview"),
              h("span",{style:{marginLeft:8, fontSize:12, fontWeight:400, color:"var(--dsw-alias-label-secondary)"}},
                "· "+(String(s.draft.data.name||"").trim() || t("workshop.library.unnamed")))),
            h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:10}},
              (s.draft.data.tags||[]).map(function(tg){ return h("span",{key:String(tg), style:S.badge}, String(tg)); }),
              String(s.draft.data.creator||"").trim()? h("span",{style:S.badge}, "✎ "+String(s.draft.data.creator)) : null,
              (s.draftStatus && s.draftStatus.cardId)? h("span",{style:S.badge}, "ID:"+String(s.draftStatus.cardId).slice(0,8)) : null),
              // 0.22.0：进度改成横排胶囊（原型里的样子），点击滚到对应章节。
              h("div",{style:{display:"flex", flexWrap:"wrap", gap:8, marginBottom:10}},
                prog.map(function(row){
                  var dot=stateDot(row.state);
                  return h("button",{key:"prog-"+row.cur, type:"button",
                    style:{display:"inline-flex", alignItems:"center", gap:7, padding:"6px 10px", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, cursor:"pointer", color:"var(--dsw-alias-label-primary)", font:"inherit", fontSize:11.5},
                    onMouseDown:stopFocusSteal, onClick:function(){ scrollToSection(row.cur); }},
                    h("span",{style:{color:dot.color}}, dot.text),
                    h("span",null, row.title),
                    h("span",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:10.5}}, row.note));
                })),
            h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", margin:"10px 0", lineHeight:1.7}}, t("step.overview.desc")),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)", lineHeight:1.7}}, s.lastMsg):null,
            // —— 设定铁律 / 一致性清单（0.19.0）——
            // 点「校验」后把宿主返回的 consistency 摊在这里：用户不必从模型回复里猜哪里冲突。
            // 能力边界：这里显示的是可计算检查（长度/同实体/覆盖/极性可疑），不是语义矛盾检测。
            s.validationReport? h("div",{style:{marginTop:12, background:"color-mix(in srgb, var(--dsw-alias-border-l1) 40%, var(--dsw-alias-bg-base))", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, padding:10}},
              h("div",{style:{fontSize:12, fontWeight:600, marginBottom:6, display:"flex", alignItems:"center", gap:8}},
                h("span",null, t("workshop.audit.title")),
                (function(){
                  var iss = (s.validationReport.consistency && s.validationReport.consistency.issues) || [];
                  var e = iss.filter(function(x){ return x.level === "error"; }).length;
                  return h("span",{style:Object.assign({}, S.badge, e? {color:"#e8a6a6", borderColor:"rgba(232,166,166,.45)"} : {color:"#a6e8c8", borderColor:"rgba(166,232,200,.45)"})},
                    t("workshop.audit.summary", {e:String(e), w:String(iss.length - e)}));
                })(),
                (s.validationReport.canon && s.validationReport.canon.source === "derived")
                  ? h("span",{style:S.badge}, t("workshop.consistency.derived")) : null),
              (function(){
                var issues = (s.validationReport.consistency && s.validationReport.consistency.issues) || [];
                if(!issues.length) return h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.consistency.ok"));
                // 0.22.0：按类别分组 + 每条「去修 →」跳章节（原型里的体检报告）。
                var GROUPS = [
                  { id:"anchor", key:"workshop.audit.anchor", sec:1 },
                  { id:"hook",   key:"workshop.audit.hook",   sec:6 },
                  { id:"canon",  key:"workshop.audit.canon",  sec:2 },
                  { id:"lore",   key:"workshop.audit.lore",   sec:2 },
                  { id:"other",  key:"workshop.audit.other",  sec:0 },
                ];
                function groupOf(code){
                  var c = String(code || "");
                  if(c.indexOf("anchor-") === 0) return "anchor";
                  if(c === "unsettled-hook") return "hook";
                  if(c.indexOf("canon-") === 0 || c === "lore-duplicate-name") return "canon";
                  if(["no-keys","dim-only-keys","key-not-in-content","duplicate-keys"].indexOf(c) >= 0) return "lore";
                  return "other";
                }
                return h("div",null, GROUPS.map(function(g){
                  var list = issues.filter(function(it){ return groupOf(it.code) === g.id; });
                  if(!list.length) return null;
                  return h("details",{key:g.id, open:true, style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, marginBottom:6, background:"var(--dsw-alias-bg-base)"}},
                    h("summary",{style:{cursor:"pointer", padding:"6px 10px", fontSize:12, fontWeight:600, outline:"none"}},
                      t(g.key) + " (" + list.length + ")"),
                    h("div",{style:{padding:"0 10px 8px"}}, list.map(function(it, i){
                      var isErr = it.level === "error";
                      return h("div",{key:"cc-issue-"+g.id+"-"+i, style:{fontSize:12, lineHeight:1.65, color:isErr? "#e8a6a6" : "var(--dsw-alias-label-secondary)", borderTop:i? "1px solid rgba(127,127,127,.12)" : "none", paddingTop:i? 6 : 0, display:"flex", gap:8, alignItems:"flex-start"}},
                        h("div",{style:{flex:1}},
                          h("div",null, (isErr? "✗ " : "• ") + String(it.message)),
                          (it.refs && it.refs.length)
                            ? h("div",{style:{fontSize:11, opacity:0.8, marginTop:2}}, it.refs.map(function(r){ return "↳ " + String(r); }).join("   "))
                            : null),
                        h("button",{type:"button", style:{padding:"1px 8px", fontSize:10.5, borderRadius:6, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", flexShrink:0, cursor:"pointer"}, onMouseDown:stopFocusSteal, onClick:function(){ scrollToSection(g.sec); }}, t("workshop.audit.goto") + " →"));
                    })));
                }));
              })()) : null)
        );
      }
      {   // 章节 7
        // ── 共享世界书（0.9.0）：一组一份，成员卡里只留角色私有条目 ──
        var bk = s.book;
        var gidB = String(s.currentGroupId||"");
        var bookReady = !!(bk && bk.exists && bk.book);
        var dup = (bk && bk.scan && bk.scan.candidates) ? bk.scan.candidates : [];
        // 第二类重复：卡里的条目与共享书**逐字相同**（`cc_apply_shared_book` 回填进卡的副本）。
        // 界面从前也看不见它 —— 卡片间没重复、书里也没重复，于是那几份副本静静躺着准备双重插入。
        var dupeBook = (bk && bk.scan && bk.scan.bookDupes) ? bk.scan.bookDupes : [];
        secs[7]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle}, t("book.title"),
              bookReady? h("span",{style:Object.assign({}, S.badge, {marginLeft:8})}, "rev "+bk.rev) : null,
              (bk && bk.group)? h("span",{style:{marginLeft:8, fontSize:12, fontWeight:400, color:"var(--dsw-alias-label-secondary)"}}, "· "+bk.group.name) : null),
            h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginBottom:10, lineHeight:1.7}}, t("book.hint")),
            !gidB
              ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, t("book.noGroup"))
              : h("div",null,
                  // 书级参数：defaultValue + onBlur 提交 —— 不随每次击键发 RPC
                  h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 18px"}},
                    h("div",{style:S.fieldRow},
                      h("div",{style:S.fieldLabel}, h("label",{style:S.fieldName}, t("book.name"))),
                      h("input",{style:S.readInput, defaultValue: bookReady? bk.book.data.name : "", placeholder:t("workshop.field.empty"),
                        onBlur:function(ev){ if(bookReady && ev.target.value !== bk.book.data.name) store.patchBook({name: ev.target.value}); }})),
                    h("div",{style:S.fieldRow},
                      h("div",{style:S.fieldLabel}, h("label",{style:S.fieldName}, t("book.budget"))),
                      h("input",{style:S.readInput, defaultValue: bookReady? String(bk.book.data.token_budget) : "", placeholder:"2000",
                        onBlur:function(ev){ var n=Number(ev.target.value); if(bookReady && n>0 && n!==bk.book.data.token_budget) store.patchBook({token_budget:n}); }})),
                    h("div",{style:S.fieldRow},
                      h("div",{style:S.fieldLabel}, h("label",{style:S.fieldName}, t("book.depth"))),
                      h("input",{style:S.readInput, defaultValue: bookReady? String(bk.book.data.scan_depth) : "", placeholder:"4",
                        onBlur:function(ev){ var n=Number(ev.target.value); if(bookReady && n>0 && n!==bk.book.data.scan_depth) store.patchBook({scan_depth:n}); }})),
                    h("div",{style:S.fieldRow},
                      h("div",{style:S.fieldLabel}, h("label",{style:S.fieldName}, t("book.desc"))),
                      h("input",{style:S.readInput, defaultValue: bookReady? bk.book.data.description : "", placeholder:t("workshop.field.empty"),
                        onBlur:function(ev){ if(bookReady && ev.target.value !== bk.book.data.description) store.patchBook({description: ev.target.value}); }}))),
                  h("div",{style:{marginTop:12, marginBottom:6, fontSize:12, fontWeight:600}},
                    t("book.entries",{n:String(bookReady? bk.book.data.entries.length : 0)}),
                    bookReady? h("span",{style:Object.assign({}, S.badge, {marginLeft:8})}, t("book.tokens",{n:String(bk.tokens||0)})) : null),
                  // ⚠️ 宿主端点给的是**原始文档**（book.data.entries）—— 预览与长度在客户端算、删除按 index 定位。
                  // 别再读成顶层字段：关系视图就是这么踩过一次（数据在 group 里、界面却显示 0 条）。
                  bookReady? h("div",null, bk.book.data.entries.map(function(e, ei){
                    var txt = String(e.content||"");
                    return h("div",{key:ei, style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:"8px 10px", marginBottom:8, background:"var(--dsw-alias-bg-base)"}},
                      h("div",{style:{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}},
                        h("span",{style:{fontWeight:600, fontSize:12}}, e.name||"—"),
                        h("span",{style:Object.assign({}, S.badge, {fontSize:10})}, e.constant? t("book.constant") : ((e.keys||[]).join(", ")||"—")),
                        h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, String(txt.length)+" chars"),
                        h("button",{type:"button", style:Object.assign({}, S.btnGhost, {marginLeft:"auto", padding:"2px 8px", fontSize:11, border:"1px solid #3a2a2a", color:"#e8a6a6", background:"transparent"}), onMouseDown:stopFocusSteal,
                          onClick:function(){ store.patchBook({ops:[{op:"removeEntry", index:ei}]}); }}, t("common.delete"))),
                      h("div",{style:{fontSize:12, lineHeight:1.7, marginTop:4, whiteSpace:"pre-wrap", wordBreak:"break-word", color:"var(--dsw-alias-label-secondary)"}}, txt.slice(0,80).replace(/\s+/g," ") + (txt.length>80? " …":"")));
                  })) : null,
                  // 新条目：内联表单（不用 window.prompt —— 内嵌 webview 会拦掉原生对话框，表现为「点了没反应」）
                  h("div",{style:{marginTop:6, paddingTop:10, borderTop:"1px dashed var(--dsw-alias-border-l1)"}},
                    h("div",{style:{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center"}},
                      h("input",{placeholder:t("book.entryName"), value:bookForm.name, style:{width:120, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"4px 8px", fontSize:12}, onChange:function(ev){ setBookForm(Object.assign({}, bookForm, {name: ev.target.value})); }}),
                      h("input",{placeholder:t("book.entryKeys"), value:bookForm.keys, style:{width:180, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"4px 8px", fontSize:12}, onChange:function(ev){ setBookForm(Object.assign({}, bookForm, {keys: ev.target.value})); }}),
                      h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"4px 12px", fontSize:12}), onMouseDown:stopFocusSteal,
                        disabled: s.bookBusy==="patch",
                        onClick:function(){
                          var content=String(bookForm.content||"").trim();
                          if(!content) return;
                          store.patchBook({ops:[{op:"addEntry", entry:{ name:String(bookForm.name||"").trim(),
                            keys:String(bookForm.keys||"").split(",").map(function(x){ return x.trim(); }).filter(Boolean), content: content }}]});
                          setBookForm({name:"", keys:"", content:""});
                        }}, s.bookBusy==="patch"? "…" : t("action.addEntry"))),
                    h("textarea",{placeholder:t("book.entryContent"), value:bookForm.content, style:Object.assign({}, S.textarea, {minHeight:70, marginTop:6}),
                      onChange:function(ev){ setBookForm(Object.assign({}, bookForm, {content: ev.target.value})); }})),
                  // 成员卡之间的重复条目 → 一键提升（去重的正解）
                  h("div",{style:{marginTop:14, paddingTop:10, borderTop:"1px dashed var(--dsw-alias-border-l1)"}},
                    h("div",{style:{fontSize:12, fontWeight:600, marginBottom:4}}, t("book.dupTitle")),
                    dup.length===0
                      ? h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("book.dupNone"))
                      : h("div",null,
                          h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginBottom:6, lineHeight:1.7}}, t("book.promoteHint")),
                          dup.map(function(c, i){
                            return h("div",{key:c.signature||i, style:{border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:"8px 10px", marginBottom:6, background:"var(--dsw-alias-bg-base)"}},
                              h("div",{style:{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}},
                                h("span",{style:{fontWeight:600, fontSize:12}}, c.name||"—"),
                                h("span",{style:Object.assign({}, S.badge, {fontSize:10})}, t("book.dupItem",{n:String(c.cards), chars:String(c.savedChars||0)})),
                                (c.nameMismatch||c.keysMismatch)? h("span",{style:Object.assign({}, S.badge, {fontSize:10, color:"#ffc46b", borderColor:"#ffc46b"})}, t("book.dupMismatch")) : null),
                              h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginTop:4, whiteSpace:"pre-wrap", wordBreak:"break-word"}}, c.preview));
                          }),
                          h("div",{style:{display:"flex", gap:8, marginTop:8, flexWrap:"wrap"}},
                            h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"4px 12px", fontSize:12}), onMouseDown:stopFocusSteal,
                              disabled: !!(s.bookBusy==="scan"||s.bookBusy==="promote"),
                              onClick:function(){ store.promoteBook(null, true); }}, (s.bookBusy==="promote")? "…" : t("book.promote")))))),
                  dupeBook.length
                    ? h("div",{style:{fontSize:11, color:"#ffc46b", marginTop:8, lineHeight:1.7}}, t("book.dupBook", {n:String(dupeBook.length)}))
                    : null,
                  s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)", lineHeight:1.7}}, s.lastMsg):null),
          (gidB && bookReady) ? h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle}, t("export.book.title")),
            h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginBottom:10, lineHeight:1.7}}, t("export.book.hint")),
            h("div",{style:{display:"flex", gap:8, flexWrap:"wrap"}},
              bookTargetButtons(),
              h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost), onMouseDown:stopFocusSteal, disabled: s.bookBusy==="apply", onClick:function(){ store.applyBook(); }}, s.bookBusy==="apply"? "…" : t("book.applyCard")),
              h("button",{type:"button", style:Object.assign({}, S.btn, S.btnGhost), onMouseDown:stopFocusSteal, onClick:function(){ store.loadBook(); }}, t("book.refresh"))),
            s.lastMsg? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null) : null
        );
      }
      {   // 章节 6
        // 0.9.0：开场与示例从「角色」页拆出来 —— 左侧导航改按**卡片结构**排（角色 / 世界观 / 世界书 /
        // 开场与示例 / 关系与分组 / 共享世界书），不再按「写作第几步」排：写作已交给 LLM，
        // 工坊现在的职责是「看 + 微调 + 导出」，按结构分页比按步骤分页好找。
        secs[6]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle},t("workshop.char.openingTitle")),
            field("first_mes","first_mes",{rowKey:"first"}),
            greetingList("alternate_greetings", t("workshop.greeting.altTitle"), t("workshop.greeting.altHint")),
            greetingList("group_only_greetings", t("workshop.greeting.groupTitle"), t("workshop.greeting.groupHint")),
            field(t("workshop.field.mesExample"),"mes_example",{rowKey:"mes"})
          )
        );
      }
      {   // 章节 2
        var entries=s.draft.data.character_book.entries;
        secs[2]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}},
              h("div",{style:S.secSubTitle},t("workshop.lore.title")),
              h("span",{style:S.badge}, "scan_depth "+s.draft.data.character_book.scan_depth+" · token_budget "+s.draft.data.character_book.token_budget+" · "+t("common.entries",{n:entries.length}))
            ),
            h("div",null, entries.map(function(e){
              return h("div",{key:e.id, style:{display:"grid", gridTemplateColumns:"1fr auto", gap:8, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:10, marginBottom:8}},
                h("div",null,
                  h("div",{style:{fontWeight:600, fontSize:12}}, e.name, h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, e.constant? "constant": ((e.keys||[]).join(", ")||"—")), h("span",{style:Object.assign({}, S.badge, {marginLeft:6})}, "order "+e.insertion_order)),
                  h("div",{style:{fontSize:13, lineHeight:1.8, color:"var(--dsw-alias-label-primary)", marginTop:4, whiteSpace:"pre-wrap", wordBreak:"break-word"}}, e.content),
                  h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginTop:6}}, h("span",{style:S.badge},"@@depth/@@position"), h("span",{style:S.badge},"CBS: {{char}}"))
                ),
                h("div",{style:{display:"flex", flexDirection:"column", gap:6}}, h("label",{style:{fontSize:12}}, h("input",{type:"checkbox", checked:e.enabled, disabled:readOnly, onChange:function(ev){ store.updateDraft(function(d){ var f=d.character_book.entries.find(function(x){return x.id===e.id;}); if(f) f.enabled=ev.target.checked; }); }}), " enabled"), h("button",{style: Object.assign({}, S.btn, S.btnGhost, {padding:"4px 8px", fontSize:12}), disabled:readOnly, onClick:function(){ store.updateDraft(function(d){ d.character_book.entries=d.character_book.entries.filter(function(x){return x.id!==e.id;}); }); }}, t("common.delete")))
              );
            })),
            h("div",{style:{display:"flex", gap:8, marginTop:10}},
              h("button",{style:S.btn, disabled:readOnly, onClick:function(){ store.addEntry(); }}, t("action.addEntry")),
              h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", alignSelf:"center"}}, t("workshop.lore.addHint"))
            ),
            s.lastMsg? h("div",{style:{marginTop:8, fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, s.lastMsg):null
          )
        );
      }
      {   // 章节 3
        // 0.14.0：导出已改成独立弹层（见 exportPanel 与渲染树末尾的弹层）。
        // cur=3 只是旧状态残留（热更新 / 内存里的历史值），中栏不再渲染这一页；
        // 配套 effect 会把它归一到「总览」并打开弹层。
        secs[3]=h("div",null);
      }
      {   // 章节 4（关系）
        // ── 关系视图（s.cur === 4）──
        // 与导出页同属「不在左侧导航里的视图」：入口是右侧分组选择器旁的「关系」按钮。
        // 这里编辑的是**插件侧图谱**（<DSH_HOME>/cc-groups/）；只有「渲染到当前卡」才会把关系写进 description。
        // ⚠️ 节点与边在 `relations.group` **里面** —— 宿主半 cc_getGroup 的返回是 { group, members, rev }。
        // 曾经按工具半 cc_get_relations 的形状读顶层的 s.relations.nodes / .edges，于是**永远读到空数组**：
        // 界面显示「关系 · 0」、NPC 名字区空白，而 rev 与成员数正常（一个在 group 里、一个在顶层）——
        // 看起来像「卡里的关系没读到」，实际是客户端读错了返回形状。
        var relGroup = (s.relations && s.relations.group) || null;
        var relNodes = (relGroup && relGroup.nodes) || [];
        var relEdges = (relGroup && relGroup.edges) || [];
        var relMembers = (s.relations && s.relations.members) || [];
        var gid = String(s.currentGroupId || "");
        var canEdit = !!gid && gid !== "__none";
        var relTypes = ["family","romance","mentor","friend","colleague","rival","enemy","debt","superior","other"];
        var nodeName = function(id){ var hit = relNodes.filter(function(x){ return x.id === id; })[0]; return hit ? hit.name : id; };
        var setF = function(patch){ setRelForm(Object.assign({}, relForm, patch)); };
        var smallSel = {fontSize:11, background:"transparent", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:6, color:"var(--dsw-alias-label-primary)", padding:"1px 4px"};
        // 「当前卡」在组里的节点（用来在成员区标出「我」、并给「添加关系」挑默认的 from）
        var myNode = relNodes.filter(function(n){ return n.kind === "card" && n.cardId === String(s.currentLibraryId||""); })[0];
        var myNodeId = myNode ? myNode.id : "";
        var relLabelOf = function(e){ return (e && e.label && String(e.label).trim()) ? String(e.label).trim() : t("rel.type."+((e && e.type) || "other")); };
        /**
         * 关系编辑的二级弹窗（添加 / 修改共用）。
         * 为什么挪出来：原来每行关系都摆着「类型 / 强度 / 方向」三个下拉 + ✕，12 条关系就把整页占满，
         * 读起来也不像「关系表」。现在列表是一行只读文本 + 一枚「编辑」，改哪条点哪条。
         * 弹窗用 position:fixed 明确覆盖全屏（不依赖 S.overlay 的定位方式，因为它可能挂在主区里）。
         */
        function relDialog(titleKey, val, setVal, onSave, onDelete, withNodes){
          var setV = function(patch){ setVal(Object.assign({}, val, patch)); };
          var selStyle = {fontSize:12, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"4px 8px"};
          var labStyle = {fontSize:11, color:"var(--dsw-alias-label-secondary)"};
          var close = function(){ setVal(null); };
          return h("div",{style:{position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:45, display:"flex", alignItems:"center", justifyContent:"center"},
            onClick:function(e){ if(e.target===e.currentTarget) close(); }},
            h("div",{style:{width:"min(470px, 92vw)", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", boxShadow:"var(--dsw-shadow-lv3)"}},
              h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}},
                h("strong",{style:{fontSize:14, color:"var(--dsw-alias-label-primary)"}}, t(titleKey)),
                h("button",{type:"button", style:Object.assign({}, S.btnGhost, {padding:"4px 10px"}), onMouseDown:stopFocusSteal, onClick:close}, t("action.closeX"))),
              withNodes ? h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10}},
                h("label",{style:labStyle}, t("workshop.rel.from"),
                  h("select",{style:Object.assign({}, selStyle, {width:"100%", marginTop:4}), value:val.from, onChange:function(ev){ setV({from:ev.target.value}); }},
                    relNodes.map(function(n){ return h("option",{key:n.id, value:n.id}, n.name); }))),
                h("label",{style:labStyle}, t("workshop.rel.to"),
                  h("select",{style:Object.assign({}, selStyle, {width:"100%", marginTop:4}), value:val.to, onChange:function(ev){ setV({to:ev.target.value}); }},
                    relNodes.map(function(n){ return h("option",{key:n.id, value:n.id}, n.name); })))) : null,
              h("div",{style:{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10}},
                h("label",{style:labStyle}, t("workshop.rel.typeLabel"),
                  h("select",{style:Object.assign({}, selStyle, {width:"100%", marginTop:4}), value:val.type, onChange:function(ev){ setV({type:ev.target.value}); }},
                    relTypes.map(function(ty){ return h("option",{key:ty, value:ty}, t("rel.type."+ty)); }))),
                h("label",{style:labStyle}, t("workshop.rel.strength"),
                  h("select",{style:Object.assign({}, selStyle, {width:"100%", marginTop:4}), value:String(val.strength), onChange:function(ev){ setV({strength:Number(ev.target.value)}); }},
                    [1,2,3,4,5].map(function(n){ return h("option",{key:n, value:String(n)}, n+"/5"); }))),
                h("label",{style:labStyle}, t("workshop.rel.dirLabel"),
                  h("select",{style:Object.assign({}, selStyle, {width:"100%", marginTop:4}), value:val.direction, onChange:function(ev){ setV({direction:ev.target.value}); }},
                    h("option",{value:"one-way"}, t("workshop.rel.dirOneWay")),
                    h("option",{value:"mutual"}, t("workshop.rel.dirMutual"))))),
              h("input",{placeholder:t("workshop.rel.note"), value:val.note||"", style:Object.assign({}, selStyle, {width:"100%", boxSizing:"border-box", marginTop:10}), onChange:function(ev){ setV({note:ev.target.value}); }}),
              h("div",{style:{display:"flex", gap:8, marginTop:14, justifyContent:"space-between"}},
                onDelete ? h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid rgba(224,85,85,.55)", color:"#e05555", background:"transparent", padding:"4px 12px"}), onMouseDown:stopFocusSteal, onClick:onDelete}, t("common.delete")) : h("span",null),
                h("div",{style:{display:"flex", gap:8}},
                  h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)", padding:"4px 12px"}), onMouseDown:stopFocusSteal, onClick:close}, t("action.cancel")),
                  h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"4px 14px"}), onMouseDown:stopFocusSteal, onClick:function(){ onSave(val); }}, t("action.done"))))));
        }
        secs[4]=h("div",null,
          h("div",{style:S.readCard},
            h("div",{style:S.secSubTitle}, t("workshop.rel.title"),
              h("span",{style:{marginLeft:8, fontSize:12, fontWeight:400, color:"var(--dsw-alias-label-secondary)"}}, "· " + ((relGroup && relGroup.name) || t("workshop.rel.noGroup"))),
              relGroup ? h("span",{style:Object.assign({}, S.badge, {marginLeft:8})}, "rev " + relGroup.rev) : null,
              // 0.9.0：把「这是哪张卡的视角」写在标题上 —— 关系是按组看的，很容易看错对象
              myNode ? h("span",{style:{marginLeft:8, fontSize:12, fontWeight:400, color:"#7c5cff"}}, t("workshop.rel.myCard") + "：" + nodeName(myNodeId)) : null),
            h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginBottom:10, lineHeight:1.7}}, t("workshop.rel.hint")),
            !canEdit ? h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.rel.pickGroup")) : h("div",null,
              h("div",{style:{fontSize:12, fontWeight:600, marginBottom:4}}, t("workshop.rel.members") + " · " + relMembers.length),
              h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:14, alignItems:"center"}},
                relMembers.map(function(m){
                  var isMe = String(m.id) === String(s.currentLibraryId||"");
                  return h("span",{key:m.id, style:Object.assign({}, S.badge, isMe? {borderColor:"#7c5cff", color:"#7c5cff"}:{})}, m.name + (isMe? " · " + t("workshop.rel.myCard") : ""));
                }),
                relMembers.length===0 ? h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.rel.noMember")) : null),
              h("div",{style:{display:"flex", flexWrap:"wrap", gap:6, marginBottom:14, alignItems:"center"}},
                relNodes.filter(function(n){ return n.kind === "npc"; }).map(function(n){ return h("span",{key:n.id, style:S.badge}, n.name); }),
                h("input",{placeholder:t("workshop.rel.nodePrompt"), value:npcDraft, style:{width:150, background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"2px 6px", fontSize:11},
                  onChange:function(ev){ setNpcDraft(ev.target.value); },
                  onKeyDown:function(ev){ var v=String(npcDraft||"").trim(); if(ev.key==="Enter" && v){ store.patchRelations([{op:"addNode", kind:"npc", name:v}]); setNpcDraft(""); } }}),
                h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"2px 8px", fontSize:11}), onClick:function(){
                  var name = String(npcDraft||"").trim();
                  if(name){ store.patchRelations([{op:"addNode", kind:"npc", name:name}]); setNpcDraft(""); }
                }}, t("workshop.rel.addNode"))),
              h("div",{style:{display:"flex", alignItems:"center", gap:8, marginBottom:6}},
                h("div",{style:{fontSize:12, fontWeight:600, flex:1}}, t("workshop.rel.edges") + " · " + relEdges.length),
                // 「添加关系」挪进二级弹窗：原来那张内联表单要占两行，把列表挤得很长
                h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"3px 10px", fontSize:11}), onMouseDown:stopFocusSteal,
                  onClick:function(){
                    var fromId = myNodeId || ((relNodes[0] && relNodes[0].id) || "");
                    var other = relNodes.filter(function(n){ return n.id !== fromId; })[0];
                    setRelForm({ from: fromId, to: other ? other.id : "", type: "friend", strength: 3, direction: "one-way", note: "" });
                    setRelAddOpen(true);
                  }}, t("workshop.rel.add"))),
              relEdges.length===0 ? h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", marginBottom:10}}, t("workshop.rel.noEdge")) :
              // 一行只读 + 一枚「编辑」：类型/强度/方向/备注都在弹窗里改，列表因此回到「关系表」的样子
              h("div",null, relEdges.map(function(e){
                return h("div",{key:e.id, style:{display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid var(--dsw-alias-border-l1)"}},
                  h("span",{style:{fontSize:12, flexShrink:0}}, nodeName(e.from)),
                  h("span",{style:{color:"#7c5cff", flexShrink:0}}, e.direction === "mutual" ? "⇄" : "→"),
                  h("span",{style:{fontSize:12, flexShrink:0}}, nodeName(e.to)),
                  h("span",{style:Object.assign({}, S.badge, {fontSize:10, flexShrink:0})}, relLabelOf(e)),
                  h("span",{style:Object.assign({}, S.badge, {fontSize:10, flexShrink:0})}, e.strength+"/5"),
                  h("span",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}, e.note||""),
                  h("button",{type:"button", style:Object.assign({}, S.btnGhost, {flexShrink:0, padding:"2px 8px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)", background:"transparent"}), onMouseDown:stopFocusSteal,
                    onClick:function(){ setRelEdit({ edgeId:e.id, from:e.from, to:e.to, type:e.type, strength:e.strength, direction:e.direction, note:e.note||"" }); }}, t("workshop.rel.edit")));
              })),
              h("div",{style:{display:"flex", gap:8, marginTop:14, flexWrap:"wrap"}},
                h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"4px 12px", fontSize:12}), onClick:function(){ store.renderRelationsToCard(); }, disabled: readOnly || s.relBusy==="render"}, s.relBusy==="render" ? "…" : t("workshop.rel.render")),
                h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)", borderRadius:8, padding:"4px 12px", fontSize:12}), onClick:function(){ store.checkGroupNow(); }, disabled: s.relBusy==="check"}, s.relBusy==="check" ? "…" : t("workshop.rel.check")),
                h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"4px 12px", fontSize:12}), onClick:function(){ store.loadGroup(gid); }}, t("action.refresh")),
                h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid #3a2a2a", background:"transparent", color:"#e8a6a6", borderRadius:8, padding:"4px 12px", fontSize:12}), onClick:function(){ store.deleteGroup(gid); }}, t("common.delete")))),
            // —— 体检清单（0.10.0）：按 error / warn 分组显示，每条前面挂检查类别 ——
            // 界面上原本只有一行拼接文本；加上跨卡一致性检查以后问题可能十来条，一行会糊成一片。
            // 这里只负责**显示**宿主返回的 issues / byCheck，不参与任何统计口径（数字都在卡组层算好了）。
            (function(){
              var issues = s.relIssues;
              if(!issues || !issues.length) return null;
              var errs = issues.filter(function(i){ return i.level === "error"; });
              var warns = issues.filter(function(i){ return i.level !== "error"; });
              function row(i, key){
                return h("div",{key:key, style:{display:"flex", gap:6, alignItems:"flex-start", padding:"2px 0", lineHeight:1.6}},
                  h("span",{style:Object.assign({}, S.badge, {flexShrink:0, fontSize:10, opacity:0.85})}, String(i.check || "")),
                  h("span",{style:{fontSize:11.5, color: i.level === "error" ? "#e8a6a6" : "var(--dsw-alias-label-secondary)"}}, String(i.message || "")));
              }
              return h("div",{style:{marginTop:12, borderTop:"1px solid var(--dsw-alias-border-l1)", paddingTop:10}},
                h("div",{style:{fontSize:12, fontWeight:600, marginBottom:4}},
                  t("workshop.rel.checkStats", {e: String(errs.length), w: String(warns.length)})),
                errs.map(function(i, idx){ return row(i, "ce" + idx); }),
                warns.map(function(i, idx){ return row(i, "cw" + idx); }));
            })(),
            s.lastMsg ? h("div",{style:{marginTop:10, fontSize:12, color:"var(--dsw-alias-label-secondary)", lineHeight:1.7}}, s.lastMsg) : null,
            // —— 二级弹窗：改一条关系 / 加一条关系（列表只读，动作都在这里）——
            relEdit ? relDialog("workshop.rel.editTitle", relEdit, setRelEdit,
              function(v){ store.patchRelations([{op:"updateEdge", edgeId:v.edgeId, type:v.type, strength:v.strength, direction:v.direction, note:v.note}]); setRelEdit(null); },
              function(){ store.patchRelations([{op:"removeEdge", edgeId:relEdit.edgeId}]); setRelEdit(null); }, false) : null,
            relAddOpen ? relDialog("workshop.rel.addTitle", relForm,
              function(v){ if(v===null){ setRelAddOpen(false); return; } setRelForm(v); },
              function(v){ if(!v.from || !v.to || v.from===v.to) return; store.patchRelations([{op:"addEdge", from:v.from, to:v.to, type:v.type, strength:v.strength, direction:v.direction, note:v.note}]); setRelAddOpen(false); }, null, true) : null)
        );
      }
      var filteredLibrary = (function(){
        var base = s.library;
        var q = String(s.libraryQuery||"").trim().toLowerCase();
        if(!q) return base;
        return base.filter(function(e){
          var nameMatch = String(e.name||"").toLowerCase().indexOf(q)>=0;
          var tagMatch = Array.isArray(e.tags) && e.tags.some(function(t){ return String(t).toLowerCase().indexOf(q)>=0; });
          var loreMatch = String(e.loreCount||"").indexOf(q)>=0;
          return nameMatch || tagMatch || loreMatch;
        });
      })();
      // 0.22.0：左栏 = 角色库（250px，折叠时 40px），右侧 = 单页滚动的内容区。
      // ⚠️ 这里别再写回三列（200px 1fr 268px）—— 那会把内容区右侧空出一列。
      var bodyStyle = Object.assign({}, S.body, {gridTemplateColumns: s.libraryCollapsed ? "40px 1fr" : "250px 1fr"});
      // 单张已存卡的渲染（抽成函数：分组折叠面板与搜索结果共用）
      // 0.22.0：卡片按原型简化 —— 头像 + 名字 + 一行副标题（lore 数 · 更新日期），
      // **整块可点 = 载入**；导出 / 删除 / 分组都收到顶部动作区，不再挤在每张卡上。
      function renderCardEntry(entry){
        var isBusy = s.libraryBusy && String(s.libraryBusy).indexOf(entry.id)>=0;
        var isCurrent = s.currentLibraryId===entry.id;
        var itemStyle = Object.assign({}, S.libraryItem, {display:"flex", alignItems:"center", gap:9, cursor:"pointer", padding:"8px"},
          isCurrent ? {borderColor:"#7c5cff", background:"color-mix(in srgb, #7c5cff 8%, var(--dsw-alias-bg-layer-2))"} : {});
        return h("div",{key:entry.id, style:itemStyle, title:String(entry.name||""),
          onClick:function(){ if(!isBusy) store.loadFromLibrary(entry.id); }},
          h("div",{style:{width:28, height:28, borderRadius:8, flexShrink:0, background:"linear-gradient(135deg,#4a3f8f,#7c5cff)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff"}},
            String(entry.name||"?").slice(0,1)),
          h("div",{style:{minWidth:0, flex:1}},
            h("div",{style:{fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}, entry.name),
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}},
              t("common.loreCount").replace("{n}", String(entry.loreCount)) + " · " + new Date(entry.updatedAt*1000).toLocaleDateString())),
          isBusy ? h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)"}}, "…") : null);
      }
      /**
       * 已存角色列表（折叠面板版）：**一个分组一节**，节标题就是分组名、点一下折叠/展开；
       * 没归组的卡拉进「未分组」那一节（永远显示，即使为空）。搜索时平铺全部命中项 —— 那时折叠只会碍事。
       */
      function renderGroupedList(){
        var q = String(s.libraryQuery||"").trim().toLowerCase();
        var all = s.library || [];
        if(q){
          var hits = all.filter(function(e){
            var nameMatch = String(e.name||"").toLowerCase().indexOf(q)>=0;
            var tagMatch = Array.isArray(e.tags) && e.tags.some(function(x){ return String(x).toLowerCase().indexOf(q)>=0; });
            var loreMatch = String(e.loreCount||"").indexOf(q)>=0;
            return nameMatch || tagMatch || loreMatch;
          });
          if(!hits.length) return h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"24px 8px"}}, t("workshop.library.noMatch"));
          return h("div",{style:{display:"flex", flexDirection:"column", gap:6}}, hits.map(renderCardEntry));
        }
        if(!all.length) return h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"24px 8px"}}, t("workshop.library.empty"));
        var byGroup = {};
        all.forEach(function(e){ var g = String(e.groupId||""); if(!byGroup[g]) byGroup[g] = []; byGroup[g].push(e); });
        var sections = (s.groups||[]).map(function(g){ return { id:g.id, name:g.name, items: byGroup[g.id]||[], hasBook: !!g.hasBook, bookEntries: g.bookEntries||0 }; });
        sections.push({ id:"", name: t("workshop.group.none"), items: byGroup[""]||[], hasBook:false, bookEntries:0 });
        var out = sections.map(function(sec){
          var collapsed = !!collapsedGroups[sec.id];
          return h("div",{key:"sec:"+sec.id, style:{marginBottom:6}},
            h("div",{style:{display:"flex", alignItems:"center", gap:6, padding:"5px 6px", cursor:"pointer", borderRadius:8, background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)"}, onClick:function(){ toggleGroupCollapsed(sec.id); }},
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", width:10, flexShrink:0}}, collapsed ? "▸" : "▾"),
              h("span",{style:{fontSize:12, fontWeight:600, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}, sec.name),
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", flexShrink:0}}, String(sec.items.length)),
              // 0.9.0：这组有共享世界书时挂一枚入口（点它切到共享书视图并选中这个组）
              (sec.id && sec.hasBook) ? h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid #7c5cff", background:"transparent", color:"#7c5cff", borderRadius:6, padding:"1px 6px", fontSize:10, flexShrink:0}), title:t("step.book"), onClick:function(ev){ ev.stopPropagation(); store.setCurrentGroupId(sec.id); store.setCur(7); }}, "📖 "+String(sec.bookEntries||0)) : null,
              sec.id ? h("button",{type:"button", style:Object.assign({}, S.btnGhost, {border:"1px solid #7c5cff", background:"transparent", color:"#7c5cff", borderRadius:6, padding:"1px 6px", fontSize:10, flexShrink:0}), onClick:function(ev){ ev.stopPropagation(); store.openRelationsFor(sec.id); }}, t("workshop.rel.open")) : null),
            collapsed ? null : h("div",{style:{paddingLeft:2, display:"flex", flexDirection:"column", gap:6, marginTop:6}},
              sec.items.length ? sec.items.map(renderCardEntry)
                : h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", padding:"2px 8px"}}, t("workshop.group.empty")))
          );
        });
        out.push(h("div",{key:"new-group", style:{marginTop:8}},
          groupDraft === null
            ? h("button",{type:"button", style:Object.assign({}, S.btnGhost, {width:"100%", border:"1px dashed var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)", borderRadius:8, padding:"6px 8px", fontSize:11}), onClick:function(){ setGroupDraft(""); }}, t("workshop.group.newGroup"))
            : h("input",{autoFocus:true, value:groupDraft, placeholder:t("workshop.group.prompt"), style:{width:"100%", boxSizing:"border-box", background:"var(--dsw-alias-bg-base)", border:"1px solid #7c5cff", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", fontSize:11},
                onChange:function(ev){ setGroupDraft(ev.target.value); },
                onKeyDown:function(ev){ if(ev.key==="Enter"){ store.createGroup(ev.target.value); setGroupDraft(null); } if(ev.key==="Escape"){ setGroupDraft(null); } },
                onBlur:function(ev){ var v=String(ev.target.value||"").trim(); if(v) store.createGroup(v); setGroupDraft(null); }})));
        return h("div",null, out);
      }      function renderLibrary(){
        if(s.libraryCollapsed){
          return h("div",{style:S.libraryCollapsedBar},
            h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)", borderRadius:8, padding:"6px 8px", fontSize:12, cursor:"pointer", width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.toggleLibraryCollapsed(); }, title:t("workshop.library.expand")}, "◀"),
            h("div",{style:{writingMode:"vertical-rl", fontSize:12, color:"var(--dsw-alias-label-secondary)", letterSpacing:2, lineHeight:"16px"}}, t("workshop.library.collapsed").replace("{n}", String(s.library.length))),
            h("button",{style:Object.assign({}, S.btn, {padding:"6px 0", fontSize:14, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center"}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save"||previewing, title:t("workshop.library.saveTip",{name:(s.draft.data.name||t("workshop.library.unnamed"))})}, s.libraryBusy==="save"?"…":"★"),
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
              // 0.22.0：导入 / 更新 / 另存 / 重命名 / 新建 收进「操作」折叠区 —— 原型里左栏只有搜索 + 卡片列表。
              h("details",{style:{marginBottom:8}},
                h("summary",{style:{cursor:"pointer", fontSize:11, color:"var(--dsw-alias-label-secondary)", padding:"2px 0 6px", outline:"none"}}, t("workshop.library.actions")),
            h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", textAlign:"center", padding:"3px 6px", background:"var(--dsw-alias-bg-layer-2)", borderRadius:6, border:"1px solid var(--dsw-alias-border-l1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}},
              s.currentLibraryId ? t("workshop.library.loaded",{id:s.currentLibraryId.slice(0,8)}) : t("workshop.library.notLoaded")
            ),
            h("div",{style:{display:"flex", flexDirection:"column", gap:6}},
              h("button",{style:Object.assign({}, S.btn, {padding:"6px 10px", fontSize:12}), onClick:function(){ store.importAny(); }}, t("workshop.library.import")),
              h("div",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", textAlign:"center"}}, t("workshop.library.importHint"))
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btn, {flex:1, padding:"6px 10px", fontSize:12}), onClick:function(){ store.saveCurrentToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"||previewing}, s.libraryBusy==="save"? t("store.saving"):(s.currentLibraryId? t("workshop.library.update"):t("workshop.library.save"))),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"6px 10px", fontSize:12, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-primary)"}), onClick:function(){ store.saveAsNewToLibrary(); }, disabled: s.libraryBusy==="save"||s.libraryBusy==="saveNew"||previewing}, s.libraryBusy==="saveNew"? t("store.savingNew"):t("workshop.library.saveAs")),
            ),
            h("div",{style:{display:"flex", gap:6}},
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.renameCurrentInLibrary(); }, disabled: !s.currentLibraryId||!!s.libraryBusy||previewing}, t("workshop.library.rename")),
              h("button",{style:Object.assign({}, S.btnGhost, {flex:1, padding:"4px 6px", fontSize:11, border:"1px solid var(--dsw-alias-border-l1)", background:"transparent", color:"var(--dsw-alias-label-secondary)"}), onClick:function(){ store.clearCurrentLibraryId(); }, disabled: readOnly}, t("workshop.library.new")),
              h("span",{style:{fontSize:10, color:"var(--dsw-alias-label-secondary)", alignSelf:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, textAlign:"right"}}, s.draft.data.name ? s.draft.data.name.slice(0,8) : t("workshop.library.unnamed"))
            ),
            ),
            h("input",{placeholder:t("workshop.library.searchPlaceholder"), style:{width:"100%", boxSizing:"border-box", maxWidth:"100%", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:"var(--dsw-alias-label-primary)", padding:"6px 8px", fontSize:12}, value:s.libraryQuery, onChange:function(e){ store.setLibraryQuery(e.target.value); }}),

            s.lastMsg ? h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}, s.lastMsg) : null
          ),
          h("div",{style:S.libraryList}, renderGroupedList())
        );
      }
      return h("div",{style:S.overlay,
        onClick:function(e){ if(e.target===e.currentTarget) store.setPanel(false); },
        // 鼠标一操作就收起键盘焦点环：否则「键盘 Tab 聚焦 A → 鼠标点顶部胶囊切步」时，
        // A 的光环会一直挂在那儿，看起来又是一个「选中」。这里只清我们自己的环，不抢焦点
        // （输入框/文本域照常能点进去）。
        onMouseDown:function(){ if(focusKey) setFocusKey(null); }},
        h("div",{style:S.workshop, role:"dialog", "aria-modal":"true"},
          h("div",{style:S.head},
            h("div",{style:{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}},
              h("strong",null, "🎭 "+t("panel.title")),
              h("span",{style:S.badge}, t("panel.badge")),
            ),
            // 工具条右侧只留关闭：这里原本还有一枚「⬇ 导出 JSON」（与导出页里的「⬇ JSON」重复，0.4.1 归一）。
            // 关闭做成 ✕ 图标按钮：不再占「收起」两个字的宽度，悬停给红底 —— 红色是「离开 / 收起」的通用暗示，
            // 平时保持低调的描边样式。hover 用局部 state（内联样式没有伪类），鼠标按下仍不抢焦点（同步骤项）。
            h("button",{type:"button", title:t("action.close"), "aria-label":t("action.close"),
              style:{ appearance:"none", boxSizing:"border-box", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center",
                padding:0, font:"inherit", fontSize:15, lineHeight:1, cursor:"pointer", borderRadius:8,
                background: hoverKey==="close"? "#e05555" : "transparent",
                border:"1px solid "+(hoverKey==="close"? "#e05555" : "var(--dsw-alias-border-l1)"),
                color: hoverKey==="close"? "#fff" : "var(--dsw-alias-label-primary)",
                transition:"background .12s ease, border-color .12s ease, color .12s ease" },
              onMouseDown:stopFocusSteal,
              onMouseEnter:function(){ setHoverKey("close"); },
              onMouseLeave:function(){ setHoverKey(null); },
              onClick:function(){ store.setPanel(false); }}, "✕")
          ),
          (function(){
            var st = s.draftStatus;
            // —— 0.11.0 草稿锁横幅（预览优先显示）——
            // 预览：用户在看「假如载入会变成什么」。它必须在最前面说清楚，否则用户会以为工坊里就是这张卡。
            if(s.preview){
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(96,165,250,.10)", border:"1px solid rgba(96,165,250,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}},
                h("div",{style:{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}},
                  h("span",null, t("lock.bar.preview",{name:String(s.preview.name||t("workshop.library.unnamed"))})),
                  h("button",{type:"button", style:Object.assign({}, S.btn, {padding:"2px 10px", fontSize:11}), onMouseDown:stopFocusSteal, onClick:function(){ store.exitPreview(); }}, t("lock.preview.exit"))),
                h("div",{style:{fontSize:11, marginTop:4, lineHeight:1.6, color:"var(--dsw-alias-label-secondary)"}}, t("lock.bar.previewHint")));
            }
            // 锁 active：工坊只读。分钟数用宿主算好的 ageSec 换算 —— 客户端不重算时间，免得与宿主时钟打架。
            var lk = s.lock;
            if(s.draftLock && lk && lk.owner==="llm"){
              var mins = Math.max(1, Math.round((Number(lk.ageSec)||0)/60));
              if(lk.stale){
                // 超时 = 自动解锁（安全阀）：只提示，不置只读 —— LLM 再写会自动重新上锁。
                return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(127,127,127,.10)", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-secondary)", flex:"none"}},
                  t("lock.bar.stale",{n:String(mins)}));
              }
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(255,170,60,.10)", border:"1px solid rgba(255,170,60,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}},
                h("div",null, t("lock.bar.active",{name:(String(lk.cardName||"").trim()||t("workshop.library.unnamed")), n:String(mins)})),
                h("div",{style:{fontSize:11, marginTop:2, lineHeight:1.6, color:"var(--dsw-alias-label-secondary)"}}, t("lock.bar.activeHint")));
            }
            // 草稿槽不一致 / 发现别的槽有内容时的提示（issue #5）：把「不一致」变成看得见的东西，
            // 并给一个真的能把内容捞回来的按钮 —— 用户看到空壳时的第一反应是「草稿丢了」。
            if(s.slotWarn){
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(232,120,120,.12)", border:"1px solid rgba(232,120,120,.5)", color:"var(--dsw-alias-label-primary)", flex:"none"}},
                t("workshop.slot.mismatch",{got:String(s.slotWarn.got||""), want:String(s.slotWarn.requested||"")}));
            }
            if(s.alternateSlots && s.alternateSlots.length){
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(255,170,60,.10)", border:"1px solid rgba(255,170,60,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}},
                h("div",null, t("workshop.slot.recover",{name:String(s.alternateSlots[0].name||"—"), n:String(s.alternateSlots[0].entries||0), key:String(s.alternateSlots[0].key||"")})),
                h("div",{style:{marginTop:8, display:"flex", gap:8, flexWrap:"wrap"}},
                  s.alternateSlots.map(function(slot){
                    return h("button",{key:String(slot.key), style:Object.assign({}, S.btn, {padding:"4px 10px", fontSize:11}),
                      disabled: readOnly || s.busy==="migrate",
                      onClick:function(){ store.migrateSlot(String(slot.key)); }},
                      t("workshop.slot.migrateOne",{key:String(slot.key), n:String(slot.entries||0)}));
                  })
                ));
            }
            if(!st) return null;
            if(st.isNew) return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(255,170,60,.10)", border:"1px solid rgba(255,170,60,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}}, t("workshop.draft.fresh"));
            if(st.recovered){
              var msg = String(t("workshop.draft.recovered")||"");
              msg = msg.split("{date}").join(String(st.creation_date==null?"—":st.creation_date));
              return h("div",{style:{margin:"10px 16px 0", padding:"8px 12px", borderRadius:10, fontSize:12, lineHeight:1.5, background:"rgba(96,165,250,.10)", border:"1px solid rgba(96,165,250,.45)", color:"var(--dsw-alias-label-primary)", flex:"none"}}, msg);
            }
            return null;
          })(),
          h("div",{style:S.anchorbar},
            (function(){
              var prog = draftProgress(s);
              var byCur = {};
              prog.forEach(function(p){ byCur[p.cur] = p; });
              var curGid = String(s.currentGroupId||"");
              var curGroup = null;
              for(var i=0;i<s.groups.length;i++){ if(String(s.groups[i].id)===curGid) curGroup = s.groups[i]; }
              var relProg = (s.relations && s.relations.group)
                ? { state: (((s.relations.group.edges||[]).length)? "ok":"partial"), note: "" }
                : { state: "missing", note: "" };
              var bookProg = (curGroup && curGroup.hasBook)
                ? { state: (curGroup.bookEntries? "ok":"partial"), note: "" }
                : { state: "missing", note: "" };
              return [
                tabBtn(5, t("step.overview"), null),
                tabBtn(1, t("step.char"), byCur[1]),
                tabBtn(0, t("step.world"), byCur[0]),
                tabBtn(2, t("step.lore"), byCur[2]),
                tabBtn(6, t("step.greetings"), byCur[6]),
                tabBtn(4, t("step.rel"), relProg),
                tabBtn(7, t("step.book"), bookProg)
              ];
            })(),
            h("div",{style:{flex:1}}),
            h("div",{style:{display:"flex", gap:6, alignItems:"center", padding:"6px 0", flex:"none"}},
              h("button",{type:"button", style:Object.assign({}, S.btn, {background:"transparent", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)"}), onMouseDown:stopFocusSteal, onClick:function(){ store.validate(); }}, s.busy==="validate"? t("action.validating") : t("action.validate")),
              h("button",{type:"button", style:S.btn, onMouseDown:stopFocusSteal, onClick:function(){ openExportPanel(); }}, t("step.export")),
              h("button",{type:"button", style:Object.assign({}, S.btn, {background:"transparent", border:"1px solid var(--dsw-alias-border-l1)", color:"var(--dsw-alias-label-primary)"}), disabled:previewing, onMouseDown:stopFocusSteal, onClick:function(){ store.saveCurrentToLibrary(); }}, t("workshop.library.save")),
              // 0.22.0：卡片的「删除 / 分组」收到这里（作用于当前载入的库卡），卡片上不再有按钮。
              (function(){
                var ce = null;
                for(var li=0; li<s.library.length; li++){ if(s.library[li].id === s.currentLibraryId){ ce = s.library[li]; break; } }
                var dis = !s.currentLibraryId || !!s.libraryBusy;
                return h("select",{disabled:dis, value: ce ? String(ce.groupId||"") : "", title:t("workshop.group.assign"),
                  style:{background:"transparent", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:8, color:(ce && ce.groupId)? "#7c5cff":"var(--dsw-alias-label-secondary)", fontSize:11, padding:"4px 6px", maxWidth:110},
                  onChange:function(ev){ if(s.currentLibraryId) store.assignGroup(s.currentLibraryId, ev.target.value||null); }},
                  h("option",{value:""}, t("workshop.group.none")),
                  (s.groups||[]).map(function(g){ return h("option",{key:g.id, value:g.id}, g.name); }));
              })(),
              h("button",{type:"button", style:Object.assign({}, S.btn, {background:"transparent", border:"1px solid #3a2a2a", color:"#e8a6a6"}), disabled:!s.currentLibraryId || !!s.libraryBusy, onMouseDown:stopFocusSteal, onClick:function(){ if(s.currentLibraryId) store.deleteFromLibrary(s.currentLibraryId); }}, t("common.delete")),
              h("button",{type:"button", style:Object.assign({}, S.btn, {background:"transparent", border:"1px solid rgba(224,85,85,.55)", color:"#e05555"}), disabled:readOnly, onMouseDown:stopFocusSteal, onClick:function(){ if(!readOnly && confirmClear(t)) store.clearDraft(); }}, t("action.clear")),
            )
          ),
          h("div",{style:bodyStyle},
            renderLibrary(),
            h("div",{id:"cc-scroller", style:S.main},
              SECTION_ORDER.map(function(c){ return sectionWrap(c, secs[c]); }),
              // 三块阅读辅助收到主区底部、默认收起：它们原来占着右侧 360px 一整栏，把阅读区压得很窄
              foldPanel("preview", t("workshop.preview.title"),
                h("span",{style:{display:"flex", gap:6, alignItems:"center", flexShrink:0}},
                  h("span",{style:S.badge}, t("common.spec")),
                  h("span",{style:Object.assign({}, S.badge, s.valid.valid? {color:"#a6e8c8", borderColor:"var(--dsw-alias-state-success-primary)"}:{color:"#e8a6a6", borderColor:"var(--dsw-alias-state-error-primary)"})}, s.valid.valid? t("common.passed"):t("common.failed"))),
                h("pre",{style:{whiteSpace:"pre-wrap", wordBreak:"break-all", background:"var(--dsw-alias-bg-base)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:10, padding:12, maxHeight:420, overflow:"auto", margin:0, fontSize:11, lineHeight:1.6}}, JSON.stringify(s.draft, null, 2))),
              foldPanel("cbs", t("workshop.preview.cbsTitle"), null,
                h("div",null,
                  h("div",{style:{display:"flex", flexWrap:"wrap", gap:6}}, ["{{char}}","{{user}}","{{random:A,B}}","{{roll:d6}}",t("workshop.preview.cbsComment")].map(function(c){ return h("span",{key:c, style:S.chip}, c); })),
                  h("div",{style:{color:"var(--dsw-alias-label-secondary)", fontSize:12, marginTop:8}}, t("workshop.preview.cbsHint")))),
            ),
          )
        ),
        s.editingWorld ? h("div",{style:Object.assign({}, S.overlay, {background:"rgba(0,0,0,.55)", zIndex:40}), onClick:function(e){ if(e.target===e.currentTarget) store.setEditingWorld(null); }},
          h("div",{style:{width:"min(720px, 92vw)", maxHeight:"82vh", background:"var(--dsw-alias-bg-layer-1)", border:"1px solid var(--dsw-alias-border-l1)", borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", boxShadow:"var(--dsw-shadow-lv3)"}},
            h("div",{style:{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}},
              h("strong",{style:{fontSize:14, color:"var(--dsw-alias-label-primary)"}}, t("workshop.edit.title",{title:({timeline:t("workshop.world.timeline"), factions:t("workshop.world.factions"), geo:t("workshop.world.geo"), power:t("workshop.world.power"), daily:t("workshop.world.daily")}[s.editingWorld] || s.editingWorld)})),
              h("button",{style:Object.assign({}, S.btnGhost, {padding:"4px 10px"}), onClick:function(){ store.setEditingWorld(null); }}, t("action.closeX"))
            ),
            h("textarea",{style:Object.assign({}, S.textarea, {minHeight:320, flex:1, maxHeight:"60vh"}), value: s.world[s.editingWorld]||"", readOnly: readOnly, onChange:function(e){ store.setWorldPatch(s.editingWorld, e.target.value); }, autoFocus:true, placeholder:t("workshop.world.placeholder")}),
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
                h("textarea",{style:Object.assign({}, S.textarea, {minHeight:320, flex:1, maxHeight:"60vh"}), value: s.editingText.value||"", readOnly: readOnly, onChange:function(e){ store.updateEditingText(e.target.value); }, autoFocus:true, placeholder:t("workshop.edit.placeholder")}),
                h("div",{style:{display:"flex", gap:8, marginTop:12, justifyContent:"space-between", alignItems:"center"}},
                  h("div",{style:{fontSize:11, color:"var(--dsw-alias-label-secondary)"}}, t("workshop.edit.charsSync",{n:String((s.editingText.value||"").length)})),
                  h("div",{style:{display:"flex", gap:8}},
                    h("button",{style:S.btn, onClick:function(){ store.clearEditingText(); }}, t("action.done")),
                    h("button",{style:Object.assign({}, S.btnGhost, {border:"1px solid var(--dsw-alias-border-l1)"}), onClick:function(){ store.cancelEditingText(); }}, t("action.cancel"))
                  )
                )
              )
            ) : null,
        s.exportOpen ? exportDialog() : null
      );
    }

    function SettingsView(props){
      var t=props.t || function(k){ return zh[k]||en[k]||k; };
      var store=props.store;
      // subscribe store (language follows global locale via locale:NS + t, no manual switch)
      // 0.12.4：统一走 useStoreSnapshot（useSyncExternalStore 优先）—— 手写 useState + 订阅
      // 会在「订阅建立前的 emit」上丢更新（见 useStoreSnapshot 注释）。
      var snap = useStoreSnapshot(store);
      function tr(key, vars){
        var s=t(key);
        if(vars && typeof vars==="object"){ for(var k in vars){ s=s.split("{"+k+"}").join(String(vars[k])); } }
        return s;
      }
      var libCount = snap && Array.isArray(snap.library) ? snap.library.length : null;
      var pollEnabled = snap ? !!snap.pollEnabled : true;
      var autoValidate = snap ? !!snap.autoValidate : true;
      var autoSaveOnImport = snap ? !!snap.autoSaveOnImport : false;
      var draftLock = snap ? snap.draftLock!==false : true;
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
          h("div",{style:{fontSize:12, color:"var(--dsw-alias-label-secondary)", marginTop:6}}, t("settings.status.spec"), h("a",{href:"https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md", target:"_blank", style:{color:"#7c5cff"}}, "CCv3 SPEC")),
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
          // 0.11.0：默认开。关掉 = 客户端所有写 RPC 带 force:true、锁不再置只读 —— 完全旧行为。
          ToggleRow(t("settings.behavior.draftLock"), t("settings.behavior.draftLockDesc"), draftLock, function(v){ store.setDraftLock(v); }),
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
      // CC 模式检测 + 草稿同步：会话切换触发 + CC 模式下按设置间隔轻量轮询。
      // 铁律：拉草稿必须带会话 id（见 pullDraft 注释，issue #5），绝不拿 default 槽顶替。
      ctx.effect(function(){
        var lastHostJson="";
        var lastHostStatusJson="";
        var lastHostKey=null;
        // 拉一份草稿。**必须带 key**：没有会话 id 就什么都不拉。
        // 旧代码在 args={} 时照样发请求，主机在 HTTP 上下文里拿不到 currentInitiator()，
        // draftKeyFrom 回退成 "default" —— 于是「模型写 session-<id>、工坊画 default」两槽并存，
        // 用户看到空壳以为草稿丢了（issue #5）。宁可什么都不画，也不画错槽。
        function pullDraft(sessionId){
          var key = (typeof sessionId==="string" && sessionId) ? sessionId : null;
          if(!key) return Promise.resolve();
          store.setSessionId(key);
          return ctx.connection.rpc.call("/dsh-cc-studio-rpc","cc_getDraft",{args:{sessionId:key}}).then(function(res){
            if(!res || !res.ok || !res.value || !res.value.draft) return;
            var gotKey = (typeof res.value.key==="string" && res.value.key) ? res.value.key : null;
            // 期间用户切了会话：这次响应已经过期，丢掉（否则会把上一个会话的草稿画进新会话）
            var cur = store.getSnapshot().currentSessionId;
            if(cur && cur !== key) return;
            // 主机回的槽和我们点名的槽不是同一把：**不渲染**，只把不一致摆到台面上。
            // 正常情况下不该发生（我们总是显式传 sessionId）；留着是为了让这类错位几秒内可见。
            if(gotKey && gotKey !== key){
              store.setSlotWarn({ requested:key, got:gotKey, source: res.value.keySource||null });
              return;
            }
            store.setSlotWarn(null);
            var alts = res.value.alternateSlots || null;
            // 只对「老版本遗留的 default 槽」做一次性提示：迁过一次就别再每开一个新会话弹一遍
            if(alts && alts.length===1 && alts[0].key==="default"){
              try{ if(localStorage.getItem("dsh-cc-studio-legacy-notice")==="1") alts = null; }catch(e){}
            }
            store.setAlternateSlots(alts);
            // 锁状态每次轮询都刷新（宿主把它放在 draftStatus.lock；无锁 = null）。
            // 预览期间也要刷：LLM 释放后横幅要能变回「可编辑」，但显示的那张预览卡不能因此被换掉。
            store.setLock((res.value.draftStatus && res.value.draftStatus.lock) ? res.value.draftStatus.lock : null);
            var draft=res.value.draft;
            var draftStatus=res.value.draftStatus||null;
            // 预览中：宿主这份草稿是 LLM 的，只更新快照（退出预览时恢复），绝不画到当前草稿上 ——
            // 否则每 4s 轮询就会把用户正在看的预览卡覆盖回 LLM 的卡，预览等于「自己退出」。
            if(store.getSnapshot().preview){
              store.setLlmDraft(draft, draftStatus);
              return;
            }
            // 载入来源 id（0.5.0）：宿主把「这份草稿是从哪张已存卡载入的」落在盘上（sidecar），
            // 刷新页面后据此恢复「已载入 ID」—— 否则内存里的 currentLibraryId 一丢，
            // 再点保存就会新建一张同名重复卡（LLM 侧回环测试抓到的 P0-4）。
            var originId = (typeof res.value.originId==="string" && res.value.originId) ? res.value.originId : null;
            if(originId !== store.getSnapshot().currentLibraryId) store.setCurrentLibraryId(originId);
            try{
              var j=JSON.stringify(draft);
              var stJ=JSON.stringify(draftStatus);
              // 换 key 时缓存必须失效，否则「内容恰好相同」的两把槽之间会互相吞掉更新
              if(j!==lastHostJson || stJ!==lastHostStatusJson || gotKey!==lastHostKey){
                lastHostJson=j;
                lastHostStatusJson=stJ;
                lastHostKey=gotKey;
                var curJ=JSON.stringify(store.getSnapshot().draft);
                var curStJ=JSON.stringify(store.getSnapshot().draftStatus||null);
                if(j!==curJ || stJ!==curStJ) store.setDraftFromHost(draft, draftStatus);
              }
            }catch(e){}
          }).catch(function(){});
        }
        var lastPullAt = 0;
        var lastPullKey = null;
        function pullDraftThrottled(sid){
          var key = (typeof sid==="string" && sid) ? sid : null;
          if(!key) return;                                              // 没有会话 id 就不拉（见 pullDraft 注释）
          // 只节流「同一把 key」的重复请求：旧代码一把全局时间戳会在启动时把
          // 「会话就绪后的第一次正式拉取」直接吞掉（apply 里的初始 pullDraft(null) 先占了坑），
          // 于是 store.currentSessionId 永远没人写 → 轮询永远读 default 槽。
          var now = Date.now();
          if(key === lastPullKey && now - lastPullAt < 500) return;
          lastPullAt = now;
          lastPullKey = key;
          pullDraft(key);
        }
        // 暴露给 Capsule/Workshop 按会话触发（带节流）
        store._pullDraft = pullDraftThrottled;
        // 注意：这里**不再**做「初始拉一次 default」。启动时还没有会话，拉了只会把 default 槽
        // 的空壳画进工坊；store 里本来就有一份本地空白草稿，够新会话页用了。
        // CC 模式下轻量轮询，保证 LLM 的 cc_* Tool 写入后胶囊实时同步（切换会话时会自动更新 currentSessionId）
        // 仅 CC 模式下以 4s 心跳拉取，标准模式/未触发时不请求
        var timer = setInterval(function(){
          var s = store.getSnapshot();
          var intervalSec = Number(s.pollInterval)||0;
          if(!s.isCcMode || intervalSec===0) return;
          var sid = s.currentSessionId || null;
          if(!sid) return;                                             // 会话 id 未知：不拿 default 顶替
          var elapsed = Date.now() - lastPullAt;
          if(elapsed < intervalSec*1000) return;
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
          inject: function(sessionId){ return {store:store, sessionId: sessionId}; }
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









