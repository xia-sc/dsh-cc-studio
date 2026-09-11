<div align="right">

[中文](./README.md) | English

</div>

# dsh-cc-studio · CCv3 Character Card Studio

> From a one-line idea to an importable `chara_card_v3` for SillyTavern / Risu. Built for "only an idea, weak worldbuilding".

A DSH (DeepSeek Harness) plugin: a capsule above the composer opens a fullscreen fusion workshop, and the `CC Mode` preset turns 14 LLM Tools into a **ask-first, co-create** workflow that ends in a one-click `JSON / PNG / CHARX` export.

| Item | Value |
| --- | --- |
| Package | `@dsh-plugins/dsh-cc-studio` |
| Version | `0.2.22` |
| Host RPC | `/dsh-cc-studio-rpc` (self-owned route, works on dsh ≥ `0.1.5-rc.1`) |
| Client mounts | `conversation.input.dock` (capsule) + `shell.overlay` (workshop) + `settings.section` |
| Persistence | `~/.dsh/cc-library/` (cards), `~/.dsh/cc-drafts/` (per-session drafts) |

## Install

### 1. From GitHub (recommended)

```bash
dsh plugin --profile web add github:xia-sc/dsh-cc-studio
```

`dsh plugin` only forwards the remaining arguments to pnpm inside the profile directory (`~/.dsh/profiles/web`); afterwards dsh appends `@dsh-plugins/dsh-cc-studio` to that profile's `dsh.profile.bundles` automatically — no manual `package.json` edit.

- **Pin a version / branch**: `github:xia-sc/dsh-cc-studio#v0.2.22`, `...#master` (see the repo tags).
- **`allowBuilds` notice**: this plugin has no `prepare` build script, so pnpm's build gate is normally not triggered; if pnpm still prints the notice, add the exact key it prints under `allowBuilds` in `~/.dsh/profiles/web/pnpm-workspace.yaml` and re-run.
- **When an agent runs it inside a DSH session**: the write target is outside the session workspace, so switch file permissions to `danger-full-access` first. Running it yourself in a terminal has no such limit.

### 2. From a local clone (development / debugging)

```bash
git clone https://github.com/xia-sc/dsh-cc-studio.git
cd dsh-cc-studio
dsh plugin --profile web add .
```

Relative paths resolve against **the directory you run the command from** (dsh rewrites `.` / `./xxx` to an absolute path before handing it to pnpm, so it cannot silently link inside the profile). The result is a `link:` to the source tree: editing `lib/*.js` takes effect after a dsh web restart; editing only `lib/client.js` needs just a page refresh (with `pnpm run dev:web` running from the dsh checkout the client bundle is rebuilt, so not even that).

### 3. Install the CC preset

The preset is not auto-registered — copy the template into the user preset directory `<DSH_HOME>/.agent-presets/` (`DSH_HOME` defaults to `~/.dsh`). **The directory must be named `cc`**, because both the host and the client detect CC Mode by preset id `cc`.

```powershell
# Windows PowerShell (GitHub install)
$src = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-plugins\dsh-cc-studio\presets\cc"
Copy-Item $src "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force

# For a local dev checkout use: $src = ".\presets\cc"
```

```bash
# macOS / Linux (GitHub install)
mkdir -p ~/.dsh/.agent-presets/cc
cp -R ~/.dsh/profiles/web/node_modules/@dsh-plugins/dsh-cc-studio/presets/cc/. ~/.dsh/.agent-presets/cc/
```

> If you customized `DSH_HOME`, replace `~/.dsh` / `%USERPROFILE%\.dsh` above with it; the plugin itself lives at `<DSH_HOME>/profiles/web/node_modules/@dsh-plugins/dsh-cc-studio/`.

`agent.cordis.yml` extends a copy of `standard` with `id: cc-studio-agent, name: '@dsh-plugins/dsh-cc-studio/agent'` and replaces `persona` with a co-creation partner — ask first, 1–2 questions per step. The capsule appears once you switch the session mode.

> Removing the plugin does not delete `~/.dsh/.agent-presets/cc/`.

### 4. Restart and verify

```bash
# host rows are composed at startup, so a dsh web restart is required
dsh web

# the composed config must contain the plugin row
dsh --profile web --dump-config | grep dsh-cc-studio      # Windows: findstr

# the client asset must return 200
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3080/plugins/@dsh-plugins/dsh-cc-studio/client.js

# RPC smoke test (same fence as any /api route: Host/Origin + browser session cookie)
curl -s http://127.0.0.1:3080/dsh-cc-studio-rpc/ping \
  -H 'content-type: application/json' \
  -H 'cookie: dsh-auth-127.0.0.1:3080=<the dsh-auth-* cookie from your browser>' \
  --data '{"type":"client-request","rpcId":"smoke","method":"ping","payload":{}}'
# -> {"type":"server-response","rpcId":"smoke","result":{"ok":true,"value":{"ok":true,"time":...}}}
```

A bare `curl` without the cookie returns `401 dsh web authentication required` — that is expected and does not mean the plugin is missing. Refresh the page, switch to a `CC Mode` session, and the capsule above the composer means the install worked.

### 5. Update and uninstall

```bash
# update to the latest commit on the default branch (master): re-run add, pnpm re-resolves
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# if the resolution does not move, remove and add again
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# uninstall (dsh also drops it from dsh.profile.bundles)
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
```

Cards in `~/.dsh/cc-library/` and drafts in `~/.dsh/cc-drafts/` survive uninstall.

### 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No capsule above the composer | Make sure the session mode is `CC Mode`; make sure `~/.dsh/.agent-presets/cc/` contains both `preset.yml` and `agent.cordis.yml` and that the directory is named `cc`; restart dsh web and refresh |
| Orange "draft recreated" banner | That session has no stored draft (first creation, or the draft directory was cleared); a successful restore shows a blue banner with `creation_date` instead, and either banner clears after the next write |
| Switching to CC Mode fails with `invalid config: S.prefix missing required value` | `presets/cc/agent.cordis.yml` predates 0.2.22 (persona used `text:`); copy the new template again |
| dsh boot fails with `cannot get property "webServer" without inject` | The plugin is older than 0.2.22; update it |
| Validation errors | Required `spec: chara_card_v3` / `spec_version: 3.0` / `group_only_greetings`; the main icon must be unique; regexes must be valid |

## Quick start

1. Create a session and pick **CC Mode** (the capsule appears above the composer).
2. Just describe the idea: "I want a Rain City memory-pawnshop owner, but my worldbuilding is thin."
3. The LLM walks the 6 steps and asks 1–2 questions before each one; the capsule and workshop refresh on every Tool call:
   `cc_get_card` (summarize progress + ask) → `cc_patch_character` (discuss vibe/relationship, then fill the 4-piece) → `cc_patch_world` (discuss world focus, then ≥3 dimensions, `autoLorebook`) → `cc_add_lorebook_entries` (discuss triggers, then ≥5 with ≥1 `constant`) → `cc_patch_greetings` (discuss scene, then greetings) → `cc_validate`.
4. Tweak anything in the workshop anytime. After validation: sidebar `★ Save Current` (overwrites in place when an ID is loaded, otherwise creates one) or `＋ Save as New`, or export `JSON / PNG / CHARX`. Later load/rename/export/delete by ID (the top `Loaded ID:xxxx` highlights the active card), or just tell the model "load ID xxxx".

## Features

### Fusion workshop (client)

- **Layout**: capsule above the composer (auto in CC Mode) → `shell.overlay` fullscreen workshop: 220px nav / fluid main / 280px saved sidebar / 360px live `card.json` preview. Adaptive light/dark via DSW Tokens + brand purple `#7c5cff`.
- **Custom style tags**: candidates `Rain City / Sensory / Cyber ...` + free input (Enter to add, click to remove), written back to `data.tags` live.
- **5D worldbuilding**: Timeline / Factions / Geography / Power / Daily → `cc_patch_world(autoLorebook=true)` auto-generates Lorebook entries with `@@position / @@depth / @@activate` (≥1 `constant`; re-calling overwrites previous auto entries and keeps manual ones). Each dimension is a **preview card + large modal editor** (140-char preview + count; click the card or `⛶ Edit` for a 720px modal).
- **Large editors for all long texts**: `description / personality / scenario / system_prompt / first_mes / alternate_greetings / mes_example / creator_notes` all have a small field plus a top-right `⛶ Large` 720px modal that syncs live. `1. Idea` is now pure **local draft search** (filters the saved sidebar; the old "idea dump" card is gone).
- **Saved sidebar (ID-based CRUD)**: 280px, collapsible, highlights the active card (purple border + `Loaded ID:xxxx`, first 8 chars); `★ Save Current` overwrites when an ID is loaded, `＋ Save as New` always creates a new one, `✎ Rename` / `＋ New`; search/load/export/delete persist to `~/.dsh/cc-library/<id>.json`.
- **Import / export**: `⬆ Import JSON/PNG/CHARX` auto-detects the container; `⬇ JSON` / `⬇ PNG` (1×1 placeholder) / `⬆ Embed into PNG` (writes into any PNG you upload, stripping old `ccv3/chara` chunks and recalculating `CRC32`) / `⬇ CHARX` (packs `card.json`).
- **Bilingual (zh/en)**: complete `zh / en` dictionaries (`locale: dshCcStudio`) that follow the global `Settings → General → Language` (capsule/workshop/settings refresh instantly, no in-plugin toggle).
- **Adaptive theming**: full `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`, primary actions stay brand purple, live on refresh.

### CC Mode (14 model-side Tools)

- **6-step workflow + co-creation constraint**: before each step the LLM must ask 1–2 open questions (vibe / relationship / world focus / triggers / opening scene) and may never fill everything by assumption; 4-piece character → ≥3 world dimensions → ≥5 lorebook entries → greetings → `cc_validate` to finish.
  `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
- **Fine-grained lorebook control**: `cc_delete_lorebook_entries` / `cc_update_lorebook_entry`.
- **Saved-library CRUD (shared IDs with the sidebar)**: `cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry` — "update/load ID xxxx" works in natural language, no UI clicks needed.

### Validation and spec

- Live host-side validation: `spec / group_only_greetings` required, single main icon, regex validity, `spec: chara_card_v3 / spec_version: 3.0`.
- Full CCv3 coverage: `name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`, with CBS `{{char}} / {{random}} / {{roll}}`.

## Structure

```
dsh-cc-studio/
├── package.json          # @dsh-plugins/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./client ./agent
├── cordis.patch.yml      # host insert: id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc (validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode,
│   │                     #   cc_validateDraft, library cc_*Library, containers cc_importFromPng/cc_exportPng(+imageB64)/
│   │                     #   cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE)
│   ├── agent.js          # CC Mode Tools: 6-step co-creation + 2 lorebook ops + 6 saved-library CRUD = 14, "ask first" hints
│   └── client.js         # client: dock capsule + overlay workshop + settings.section (DSW Tokens, brand purple,
│                         #   5D echo, large editors, JSON/PNG/CHARX import/export/embed)
├── presets/cc/           # CC Mode preset template (co-creation persona + cc-studio-agent)
│   ├── preset.yml
│   └── agent.cordis.yml
├── prototypes/           # pre-fusion A/B prototypes (open directly in a browser)
│   ├── index.html
│   ├── prototype-a.html  # light overlay
│   └── prototype-b.html  # persistent sidebar
├── tests/
│   └── rpc-channel.test.mjs  # host-half RPC channel regression (fake ctx + real http, 23 assertions)
├── CHANGELOG.md          # full version history (Chinese)
├── README.md             # Chinese (default)
└── README_EN.md          # English
```

> `dsh-cc-agent` was merged into `lib/agent.js` (`@dsh-plugins/dsh-cc-studio/agent`) at `5f95110`; no separate install needed; the `CC Mode` preset mounts only that single source and does not pollute `standard`.

## Development and tests

```bash
pnpm test                                  # = node tests/rpc-channel.test.mjs
node tests/rpc-channel.test.mjs            # host-half RPC channel regression (23 assertions)
```

- **Prototype preview** (open locally, no install needed): `prototypes/index.html` overview → `prototype-a.html` (light overlay) / `prototype-b.html` (persistent sidebar).
- **Client changes**: `lib/client.js` only needs a page refresh; with `pnpm run dev:web` running from the dsh checkout it hot-updates.
- **Host changes**: `lib/index.js` needs a dsh web restart (host rows are composed at startup).

## Appearance

Light/dark via `var(--dsw-alias-*)` (`body[data-ds-dark-theme]`), primary stays `#7c5cff`. Switch at Settings → Appearance → Light/Dark/Follow system, the workshop updates on refresh.

## Spec

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) (authoritative)
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) outdated, reference only

## Changelog

Full history lives in [CHANGELOG.md](./CHANGELOG.md) (Chinese). Latest three:

- `0.2.22` Fix the dsh `0.1.5-rc.1` boot crash: `connection.rpc.handle()` is unusable by an outside plugin, so the host half now registers the `/dsh-cc-studio-rpc` prefix route on `webServer` and implements the same RPC wire protocol; request bodies are read with events; fixes the `presets/cc` persona `prefix`; adds 23 regression assertions.
- `0.2.21` Fix #2 silent draft loss: every draft write persists to `~/.dsh/cc-drafts/<session>.json` and restores per session after a restart; fresh blanks warn, successful restores notify.
- `0.2.20` Fix `cc_isCcMode` spam: capsule/workshop use a narrow `current + preset` subscription plus 5s throttling and in-flight dedup.

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## Listed

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
