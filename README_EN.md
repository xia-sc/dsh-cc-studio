<div align="right">

[中文](./README.md) | English

</div>

# dsh-cc-studio · CCv3 Character Card Studio

> From a one-line idea to an importable `chara_card_v3` for SillyTavern / Risu. Built for "only an idea, weak worldbuilding".

## Features

- **Fusion Workshop**: capsule above composer (auto in CC Mode, `conversation.input.dock`) → `shell.overlay` fullscreen workshop (220px nav / fluid main / 280px saved sidebar / 360px live `card.json` preview), adaptive light/dark via DSW Tokens + brand purple `#7c5cff`.
- **Custom Style Tags**: candidates `Rain City / Sensory / Cyber ...` + free input (Enter to add, click to remove), written back to `data.tags` live.
- **CC Mode (Recommended · Co-creation)**: new Agent Preset `CC Mode`, 6 Tools that make the LLM **ask first, then fill**, co-create with you; capsule syncs in real time (per-session draft + 2.5s light polling):
  - `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
  - Enforced 6-step workflow + co-creation constraint: each step the LLM must ask 1–2 open questions about your preference (vibe/relationship/world focus/triggers/opening scene) before filling; 4-piece character → ≥3 world dimensions → ≥5 lorebook → greetings → `cc_validate` to finish.
- **5D Worldbuilding**: Timeline / Factions / Geography / Power / Daily → `cc_patch_world(autoLorebook=true)` auto-generates Lorebook entries with `@@position / @@depth / @@activate` (≥1 `constant` resident; re-calling overwrites previous auto entries and keeps `cc_add_lorebook_entries` manual entries, with `cc_delete/update_lorebook_entry` for fine control); each dimension shows a **preview card + large modal editor** (140-char preview + count, click card or `⛶ Edit` for 720px modal, ideal for long text).
- **Large Editors for All Long Texts**: `description / personality / scenario / system_prompt / first_mes / alternate_greetings / mes_example / creator_notes` all have a small field + top-right `⛶ Large` 720px modal that syncs live; the old `Idea dump` card is gone, `1. Idea` is now pure **local draft search** (filters saved sidebar).
- **Full CCv3 Coverage**: `name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book` with CBS `{{char}} / {{random}} / {{roll}}`.
- **Saved Sidebar (ID-based CRUD) + Model Tools**: 280px collapsible sidebar, highlights the active card (purple border, `Loaded ID:xxxx` on top), `↻ Update` overwrites by ID, `＋ Save as New` creates new, `✎ Rename`/`＋ New`, search/load/export/delete persisted to `~/.dsh/cc-library/<id>.json`; model side exposes 6 Tools `cc_list_library / cc_save_to_library / cc_load_from_library / cc_delete_from_library / cc_rename_in_library / cc_get_library_entry` sharing the same IDs, so "update/load ID xxxx" works via natural language.
- **Validate & Export**: live validation (`spec / group_only_greetings` required, single main icon, regex validity, `spec: chara_card_v3 / spec_version: 3.0`), supports `JSON / PNG(tEXt ccv3) / CHARX(ZIP card.json)` interchange: `⬇ PNG` creates a 1×1 placeholder, `⬆ Embed into PNG` writes the current card into any PNG you upload (strips old `ccv3/chara` chunks, recalculates `CRC32`), `⬇ CHARX` packs `card.json`, importer `⬆ Import JSON/PNG/CHARX` auto-detects.
- **Bilingual (zh/en)**: complete `zh / en` dictionaries (`locale: dshCcStudio`), follows the global `Settings → General → Language` automatically (capsule/workshop/settings refresh instantly, no in-plugin toggle).
- **Adaptive Theming**: full `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`, light = white/black, dark = dark/light, primary actions stay purple, live on refresh.

## Structure

```
dsh-cc-studio/
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./agent
├── cordis.patch.yml      # host insert: id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc (validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode, cc_validateDraft, library: cc_listLibrary/cc_saveToLibrary/cc_loadFromLibrary/cc_deleteFromLibrary/cc_renameInLibrary/cc_getLibraryEntry, containers: cc_importFromPng/cc_exportPng(+imageB64 embed)/cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE)
│   ├── agent.js          # CC Mode Tools (merged): 6-step co-creation + 2 Lorebook ops + 6 saved CRUD (shared IDs) = 14 Tools, with workflowStatus "ask first"
│   └── client.js         # client: dock capsule + overlay workshop (DSW Tokens, brand purple #7c5cff, 5D echo fix, large editors for world/long texts, JSON/PNG/CHARX import/export/embed) + settings.section (bilingual)
├── presets/cc/           # CC Mode preset template (co-creation persona + cc-studio-agent)
│   ├── preset.yml
│   └── agent.cordis.yml
├── prototypes/           # pre-fusion A/B prototypes (open directly in browser)
│   ├── index.html
│   ├── prototype-a.html  # light overlay
│   └── prototype-b.html  # persistent sidebar
├── README.md             # Chinese (default)
└── README_EN.md          # English
```

> `dsh-cc-agent` was merged into `lib/agent.js` (`@dsh-plugins/dsh-cc-studio/agent`) at `5f95110`; no separate install needed; `CC Mode` preset mounts only that single source and does not pollute `standard`.

## Install

```bash
# clone
git clone https://github.com/xia-sc/dsh-cc-studio.git
# install to web profile (requires danger-full-access)
dsh plugin --profile web add ./dsh-cc-studio

# restart dsh web (host rows are composed at startup)
# verify
dsh --profile web --dump-config | findstr dsh-cc-studio
curl http://127.0.0.1:3080/plugins/@dsh-plugins/dsh-cc-studio/client.js  # expect 200
# RPC smoke
# POST /dsh-cc-studio-rpc/ping  -> {ok:true}
```

CC preset lives at `~/.dsh/.agent-presets/cc/` (`preset.yml` + `agent.cordis.yml`, the latter extends a copy of `standard` with `id: cc-studio-agent, name: '@dsh-plugins/dsh-cc-studio/agent'` and a co-creation persona — ask first, 1–2 questions per step). Templates are in `presets/cc/`; copy them there and the capsule appears after switching.

## Usage

1. Switch to **CC Mode** (session mode dropdown).
2. Chat directly: "I want a Rain City memory-pawnshop owner, but my worldbuilding is thin."
3. LLM follows `cc_get_card (summarize progress + ask) → cc_patch_character (discuss vibe/relationship then fill 4-piece) → cc_patch_world (discuss world focus then fill ≥3 dims, autoLorebook) → cc_add_lorebook_entries (discuss triggers then fill ≥5, ≥1 constant) → cc_patch_greetings (discuss scene then fill greetings) → cc_validate` — capsule/workshop refresh on every call; good characters are co-created, the LLM asks more and assumes less.
4. Tweak anytime in the workshop; after validation use sidebar `↻ Update` (overwrite loaded ID) or `＋ Save as New` (new ID), or **Export JSON**; later load/rename/export/delete by ID in the sidebar (`ID:xxxx` highlights the active one); prototype preview (open locally):
- `prototypes/index.html` overview
- `prototypes/prototype-a.html` / `prototypes/prototype-b.html` comparison

## Appearance

Light/dark via `var(--dsw-alias-*)` (`body[data-ds-dark-theme]`), primary stays `#7c5cff`. Switch at Settings → Appearance → Light/Dark/Follow system, workshop updates on refresh.

## Spec

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) (authoritative)
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) outdated, reference only

## Versions

- `0.2.20` Fix `cc_isCcMode` spam: capsule/workshop subscribe narrowly to `current + preset` (streaming no longer re-fires the effect), `checkIsCcMode` throttled to 5s per session + in-flight dedup, no RPC when locally detected as CC, workshop only as fallback
- `0.2.19` Follow global language: removes the in-plugin `Language / 语言` toggle card; the plugin only follows `Settings → General → Language` (`locale: dshCcStudio` + `t` auto re-render); CC preset stays Chinese-only (user presets bypass system translation, bilingual looked cluttered)
- `0.2.18` Bilingual: full `zh / en` dictionaries + `Language / 语言` manual toggle in Settings (`locale.setLocale`, linked to global language; capsule/steps/settings switch instantly), `settings.section` title also follows language; fixes workshop untranslated strings and loader `t is not defined` crash
- `0.2.17` Container interchange: `JSON / PNG(tEXt ccv3) / CHARX(ZIP)` import/export, `⬆ Embed into PNG` writes the current card into any PNG you upload (strips old `ccv3/chara` chunks, `CRC32`, `STORE&DEFLATE` ZIP), four buttons `⬇ JSON / ⬇ PNG / ⬆ Embed into PNG / ⬇ CHARX` on Validate page
- `0.2.16` Import & tunable heartbeat: sidebar `⬆ Import JSON(CCv3)`, auto-validate/auto-save toggles, CC heartbeat 1–30s (0 = off, `localStorage:dsh-cc-studio-settings`), fix `{{char}}` `unknown prompt variable`, synced `presets/cc`
- `0.2.15` Fix first CC switch not showing: `conversation.input.dock` (session) + `shell.overlay` (root) subscribe on `[currentId,sessions]` + 900ms retry, `cc_getDraft` polling converges to 4s/1s base + 500ms dedup, stops when off
- `0.2.14` Remove "Idea dump" card: `1. Idea` now pure **local draft search** (`Idea/style tag` input removed, tags edited comma-separated in Character)
- `0.2.13` Merge: large editors for all textareas (⛶ 720px) + Idea local search (purple filter over saved sidebar) + Settings fix (`settings.section` adds `locale`)
- `0.2.12` Idea → local search: purple box no longer Idea input/tag candidates, directly filters saved sidebar (input/chip filter, top-3 preview, "Load" jumps), synced with sidebar search
- `0.2.11` Large editors + Settings fix: `Idea / description / personality / scenario / system_prompt / first_mes` etc. all gain top-right `⛶ Large`; `settings.section` missing `locale: NS` fixed, saved count / `~/.dsh/cc-library` display
- `0.2.10` World large editor: 140-char preview + count, click card/`⛶ Edit` for 720px modal (320px tall, live draft sync)
- `0.2.9` Model-side saved CRUD: 6 Tools `cc_list/save/load/delete/rename/get_library` (shared IDs), natural language "update/load ID xxxx"
- `0.2.8` Saved ID CRUD: `↻ Update` overwrites by ID (no delete-then-save), `＋ Save as New`/`✎ Rename`/`＋ New`, highlight + `ID:xxxx`
- `0.2.7` Fix `cc_patch_world(autoLorebook=true)` duplicating stale entries (#1): overwrites auto entries, keeps manual, adds `cc_delete/update_lorebook_entries`
- `0.2.6` Co-creation constraint: each step asks first (Tool desc + persona "ask first"), fixes "LLM fills without discussion"
- `0.2.5` Fix 5D echo lost (`draft.extensions.cc_world ↔ state.world` sync)
- `0.2.4` Adaptive theming, fix brand button white glare in dark
- `0.2.3` Workflow + UI details (maxWidth/boxSizing, 40px collapsed bar, 6-step enforcement)
- `0.2.2` Saved sidebar (280px collapsible, `~/.dsh/cc-library`)

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## Listed

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
