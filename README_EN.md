<div align="right">

[中文](./README.md) | English

</div>

# dsh-cc-studio · CCv3 Character Card Studio

[![npm version](https://img.shields.io/npm/v/@xia-sc/dsh-cc-studio?color=%237c5cff)](https://www.npmjs.com/package/@xia-sc/dsh-cc-studio)

> From a one-line idea to an importable `chara_card_v3` for SillyTavern / Risu. Built for "only an idea, weak worldbuilding".

A DSH (DeepSeek Harness) plugin: a capsule above the composer opens a fullscreen fusion workshop, and the `CC Mode` preset turns 32 LLM Tools into a **ask-first, co-create** workflow that ends in a one-click `JSON / PNG / CHARX` export.

| Item | Value |
| --- | --- |
| Package | `@xia-sc/dsh-cc-studio` |
| Version | `0.8.3` |
| Compatibility & permissions | dsh `>=0.1.5-rc.1`, Node `>=22`, **zero runtime dependencies**; permission bounds in [Compatibility & permissions](#compatibility--permissions) |
| Host RPC | `/dsh-cc-studio-rpc` (self-owned route, works on dsh ≥ `0.1.5-rc.1`; verified on `0.1.6-alpha.2` / `0.1.7-alpha.1` / `0.1.7-rc.1`) |
| CC preset | `presets/cc.patch.yml` (dsh ≥ `0.1.7-alpha.1`, a composition declaration row) / `<DSH_HOME>/.agent-presets/cc` (≤ `0.1.6-alpha.2`, the legacy directory) |
| Client mounts | `conversation.input.dock` (capsule) + `shell.overlay` (workshop) + `settings.section` |
| Persistence | `<DSH_HOME>/cc-library/` (cards), `<DSH_HOME>/cc-drafts/` (per-session drafts), `<DSH_HOME>/cc-groups/` (relationship graphs); `DSH_HOME` defaults to `~/.dsh`. Since 0.3.6 `DSH_HOME` is honoured, and the old `~/.dsh` location is **still read** (read-time fallback) |

## Install

This plugin supports **both `dsh web` (the CLI-launched Web GUI) and DSH Desktop (DeepSeek Harness Desktop)**: they are the same dsh host, and the plugin is loaded from the profile's `dsh.profile.bundles` either way — same loading path, same feature set. The steps below use the `web` profile; the only differences on Desktop are the profile name and "restart the app instead of `dsh web`" — see **[7. Desktop](#7-desktop-deepseek-harness-desktop)** below.

### 1. From npm (recommended)

```bash
dsh plugin --profile web add @xia-sc/dsh-cc-studio

# pin a version
dsh plugin --profile web add @xia-sc/dsh-cc-studio@0.4.0
```

**Or from GitHub**:

```bash
dsh plugin --profile web add github:xia-sc/dsh-cc-studio
```

`dsh plugin` only forwards the remaining arguments to pnpm inside the profile directory (`~/.dsh/profiles/web`); afterwards dsh appends `@xia-sc/dsh-cc-studio` to that profile's `dsh.profile.bundles` automatically — no manual `package.json` edit.

> **Since 0.3.2 the package was renamed from `@dsh-plugins/dsh-cc-studio` to `@xia-sc/dsh-cc-studio`** (the former is not an npm scope this project owns, so it could not be published). If you installed the old name, remove it first as shown in "5. Update and uninstall"; `~/.dsh/cc-library/`, `~/.dsh/cc-drafts/`, `~/.dsh/.agent-presets/cc/` and your plugin settings are unaffected.

- **Pin a version / branch**: `github:xia-sc/dsh-cc-studio#v0.3.0`, `...#master` (see the repo tags).
- **`allowBuilds` notice**: this plugin has no `prepare` build script, so pnpm's build gate is normally not triggered; if pnpm still prints the notice, add the exact key it prints under `allowBuilds` in `~/.dsh/profiles/web/pnpm-workspace.yaml` and re-run.
- **When an agent runs it inside a DSH session**: the write target is outside the session workspace, so switch file permissions to `danger-full-access` first. Running it yourself in a terminal has no such limit.

### 2. From a local clone (development / debugging)

```bash
git clone https://github.com/xia-sc/dsh-cc-studio.git
cd dsh-cc-studio
dsh plugin --profile web add .
```

Relative paths resolve against **the directory you run the command from** (dsh rewrites `.` / `./xxx` to an absolute path before handing it to pnpm, so it cannot silently link inside the profile). The result is a `link:` to the source tree: editing `lib/*.js` takes effect after a dsh web restart; editing only `lib/client.js` needs just a page refresh (with `pnpm run dev:web` running from the dsh checkout the client bundle is rebuilt, so not even that).

### 3. CC preset (available with the plugin — no manual copy)

After installing the plugin and restarting `dsh web`, `CC Mode` is selectable as a session mode (the preset id is always `cc` — the host's `isCcPreset()` and the browser's `CC_PRESET_ID` both compare against it exactly). **The delivery mechanism depends on the dsh generation, and neither one asks you to copy files:**

| dsh version | Where the preset comes from | What you do |
| --- | --- | --- |
| ≥ `0.1.7-alpha.1` | The patch layer shipped in the package, `presets/cc.patch.yml`: it inserts a `@deepseek-ai/dsh-agent-preset` **declaration** into the composition (exactly how the built-in `standard` / `ptc` / `minimal` / `cordis` presets ship) | nothing |
| ≤ `0.1.6-alpha.2` | On mount the plugin installs `presets/cc` into `<DSH_HOME>/.agent-presets/cc` (the legacy directory, unchanged from 0.3.5) | nothing |

**Why 0.1.7 had to change mechanism**: from that version on, dsh takes presets **only from declaration rows in a composition**; `<DSH_HOME>/.agent-presets/` is no longer read by any code — which is exactly why `CC Mode` disappeared from the roster after upgrading: the directory is still there, nobody looks at it. The plugin therefore ships the declaration as the second entry of `dsh.bundle.patch` in `package.json` (the first is the host plugin row), so `CC Mode` appears in the roster of whichever profile the plugin is installed into; on the new version it **writes nothing to disk at all**.

**Turning `CC Mode` off (≥ `0.1.7-alpha.1`)**: no need to remove the plugin — disable that row by id in your own patch layer (`<profile>/cordis.patch.yml`, or `$DSH_HOME/cordis.patch.yml` for every profile):

```yaml
- id: preset-cc
  name: '@deepseek-ai/dsh-agent-preset'
  disabled: true
```

<details>
<summary>≤ 0.1.6-alpha.2: update policy, switches and manual fallback for the directory install</summary>

**On older dsh the plugin still installs `presets/cc` into `<DSH_HOME>/.agent-presets/cc`** (`DSH_HOME` defaults to `~/.dsh`); the directory name is always `cc`. Why that step existed: on that generation dsh discovers presets from exactly three roots — the **shipped root** (bundled inside `dsh-agent-presets`), the deployment's **`config.roots`**, and the **user root `<DSH_HOME>/.agent-presets`**. A plugin package's own `presets/` is not among them: **shipping a preset is not registering it**, so the plugin installed it into the user root at startup.

Updates are idempotent and **never silently overwrite your edits**:

| State of the target file | What happens |
| --- | --- |
| missing | template is written |
| identical to the template | left alone (install record refreshed) |
| identical to what the plugin last wrote (you did not edit it) | safely updated on plugin upgrade |
| you edited it / legacy manual copy (no install record) | **kept, with a warning** — never overwritten |

The install record is `.dsh-cc-studio-preset.json` inside the preset directory (version plus each file's sha256 at write time). If you see the "kept, not overwritten" warning and want the plugin's template instead, pick one:

```powershell
# A. Delete the old directory and restart dsh web — it reinstalls automatically
Remove-Item "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force
```

```bash
# B. Force the overwrite via env var, then restart dsh web (macOS / Linux)
DSH_CC_STUDIO_PRESET_INSTALL=force dsh web   # auto (default) | force | off
```

```powershell
# B. Same (Windows PowerShell)
$env:DSH_CC_STUDIO_PRESET_INSTALL = 'force'; dsh web
```

> You can also declare `config.presetInstall` on the plugin row (requires your own overlay patch); it takes precedence over the env var. With `off`, manage the preset manually as below.

<details>
<summary>Manual install (only needed when auto-install is off or failed)</summary>

```powershell
# Windows PowerShell (GitHub install)
$src = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-plugins\dsh-cc-studio\presets\cc"
Copy-Item $src "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force

# For a local dev checkout use: $src = ".\presets\cc"
```

```bash
# macOS / Linux (GitHub install)
mkdir -p ~/.dsh/.agent-presets/cc
cp -R ~/.dsh/profiles/web/node_modules/@xia-sc/dsh-cc-studio/presets/cc/. ~/.dsh/.agent-presets/cc/
```

> If you customized `DSH_HOME`, replace `~/.dsh` / `%USERPROFILE%\.dsh` above with it; the plugin itself lives at `<DSH_HOME>/profiles/web/node_modules/@xia-sc/dsh-cc-studio/`.

`agent.cordis.yml` extends a copy of `standard` with `id: cc-studio-agent, name: '@xia-sc/dsh-cc-studio/agent'` and replaces `persona` with a co-creation partner — ask first, 1–2 questions per step. The capsule appears once you switch the session mode.

> A hand-copied directory has **no** install record, so auto-install treats it as yours and skips it; delete it and restart to hand management back to the plugin.

> After upgrading to `0.1.7-alpha.1` that directory is neither read nor written again: the plugin **never deletes anything for you** — remove it yourself (`Remove-Item "$env:USERPROFILE\.dsh\.agent-presets\cc" -Recurse -Force`) if you want it gone.

</details>

> Removing the plugin does **not** delete `<DSH_HOME>/.agent-presets/cc/` (auto-install registers no delete action).

### 4. Restart and verify

```bash
# host rows are composed at startup, so a dsh web restart is required
dsh web

# the composed config must contain the plugin row
dsh --profile web --dump-config | grep dsh-cc-studio      # Windows: findstr

# —— both checks below need a session cookie: trade the token dsh web printed ——
TOKEN='<the token dsh web printed>'
COOKIE=$(curl -s -D - -o /dev/null "http://127.0.0.1:3080/?token=$TOKEN" \
  | sed -n 's/^[Ss]et-[Cc]ookie:[[:space:]]*\(dsh-auth-[^;]*\).*/\1/p' | head -1)

# the client asset must return 200. Its URL looks like /plugins/??<pkg>/client.js&rev=<content hash>:
# without ?? or without rev it is a 404, and rev changes whenever lib/client.js changes, so read it from the index.
ASSET=$(curl -s http://127.0.0.1:3080/ -H "cookie: $COOKIE" \
  | grep -o '/plugins/??@xia-sc/dsh-cc-studio/client\.js&rev=[0-9a-f]*' | head -1)
curl -s -o /dev/null -w "%{http_code}  $ASSET\n" "http://127.0.0.1:3080$ASSET" -H "cookie: $COOKIE"
# -> 200  /plugins/??@xia-sc/dsh-cc-studio/client.js&rev=…

# RPC smoke test (same fence as any /api route: Host/Origin + session cookie)
curl -s http://127.0.0.1:3080/dsh-cc-studio-rpc/ping \
  -H 'content-type: application/json' \
  -H "cookie: $COOKIE" \
  --data '{"type":"client-request","rpcId":"smoke","method":"ping","payload":{}}'
# -> {"type":"server-response","rpcId":"smoke","result":{"ok":true,"value":{"ok":true,"time":...}}}
```

Windows PowerShell equivalent (`rev` is likewise read from the index):

```powershell
$TOKEN='<the token dsh web printed>'
$s=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null=Invoke-WebRequest "http://127.0.0.1:3080/?token=$TOKEN" -WebSession $s -UseBasicParsing
$idx=(Invoke-WebRequest 'http://127.0.0.1:3080/' -WebSession $s -UseBasicParsing).Content
$asset=[regex]::Match($idx,'/plugins/\?\?@xia-sc/dsh-cc-studio/client\.js&rev=[0-9a-f]+').Value
Invoke-WebRequest "http://127.0.0.1:3080$asset" -WebSession $s -UseBasicParsing | Select-Object StatusCode
```

The index (`/`) and the RPC route are both fenced by the session cookie, so a bare call returns `401 dsh web authentication required` — that is expected and does not mean the plugin is missing. The session cookie's **name is not** `dsh-auth-127.0.0.1:3080`; it is `dsh-auth-` + base64url(sha256(authority)), which on this host is `dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw` — copy it from devtools, or mint it from the token as above. Note the asset route `/plugins/??…&rev=…` itself is *not* fenced, so a missing `??` / `rev` shows up as a 404 rather than an auth failure. Refresh the page, switch to a `CC Mode` session, and the capsule above the composer means the install worked.

### 5. Update and uninstall

```bash
# update to the latest npm release
dsh plugin --profile web add @xia-sc/dsh-cc-studio@latest

# update to the latest commit on the default branch (master): re-run add, pnpm re-resolves
dsh plugin --profile web add github:xia-sc/dsh-cc-studio

# if the resolution does not move, remove and add again
dsh plugin --profile web remove @xia-sc/dsh-cc-studio
dsh plugin --profile web add @xia-sc/dsh-cc-studio@latest

# uninstall (dsh also drops it from dsh.profile.bundles)
dsh plugin --profile web remove @xia-sc/dsh-cc-studio
```

**Migrating from the old name `@dsh-plugins/dsh-cc-studio`**: a rename makes it a different package, so swap it explicitly — otherwise `dsh.profile.bundles` keeps a row for a name that can no longer resolve.

```bash
dsh plugin --profile web remove @dsh-plugins/dsh-cc-studio
dsh plugin --profile web add @xia-sc/dsh-cc-studio
```

Cards in `~/.dsh/cc-library/` and drafts in `~/.dsh/cc-drafts/` survive uninstall.

### 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No capsule above the composer | Make sure the session mode is `CC Mode`; **dsh ≥ `0.1.7-alpha.1`**: `dsh --profile web --dump-config` should list `- id: preset-cc` (under the `# == @xia-sc/dsh-cc-studio` layer), then check whether `CC Mode` carries a "failed to load" diagnostic under Settings → Agent presets; **≤ `0.1.6-alpha.2`**: make sure `~/.dsh/.agent-presets/cc/` contains both `preset.yml` and `agent.cordis.yml` and that the directory is named `cc` (normally the plugin auto-installs it); in both cases restart dsh web and refresh |
| Reading the preset ledger directly (diagnostics) | dsh exposes every Remote as `POST /api/<namespace>/<method>` with the same envelope as the connection RPC (exchange `/?token=…` for the cookie). `/api/agentPresets/list` strips `name` and `broken`; use `/api/pluginInventory/list` for the **full ledger** (check that `cc` under `agentPresets` has an empty `broken` and that `cc-agent`'s `fiberPhase` is `active`). Note also that the plugin's `info` logs only go to the Cordis logger and **never** reach `dsh web`'s stdout/stderr — do not grep for `[dsh-cc-studio]` to decide whether it is installed |
| Orange "draft recreated" banner | That session has no stored draft (first creation, or the draft directory was cleared); a successful restore shows a blue banner with `creation_date` instead, and either banner clears after the next write |
| Switching to CC Mode fails with `invalid config: S.prefix missing required value` | `presets/cc/agent.cordis.yml` predates 0.2.22 (persona used `text:`); copy the new template again |
| dsh boot fails with `cannot get property "webServer" without inject` | The plugin is older than 0.2.22; update it |
| Validation errors | Required `spec: chara_card_v3` / `spec_version: 3.0` / `group_only_greetings`; the main icon must be unique; regexes must be valid |
| After a restart the browser shows `Failed to load plugins` / `web boot: 1 entry did not activate` / `import failed` | The rename was not followed by a reinstall under the new name: the profile's install identity (`dsh.profile.bundles` and the `link:` in `dependencies`) still says `@dsh-plugins/dsh-cc-studio`, while `package.json` and `lib/client.js` now say `@xia-sc/dsh-cc-studio`, so the client asset cannot be resolved (the host still boots — only the browser half dies). Confirm it by comparing the directory name under `~/.dsh/profiles/web/node_modules/` with the `name` in `package.json`; fix it by reinstalling under the new name (see the migration commands in "5. Update and uninstall"), restarting `dsh web`, and doing a **hard refresh** (`Ctrl+Shift+R`) — the old page's boot graph is cached, so a plain reload repeats the same error |

### 7. Desktop (DeepSeek Harness Desktop)

**DSH Desktop is the same dsh host** (Electron-embedded), and the plugin is still loaded from the profile's `dsh.profile.bundles` — so this plugin needs **no Desktop-specific adaptation**: the three client mounts (capsule / workshop / settings), the `CC Mode` preset, the RPC channel, draft and card-library persistence are all identical to `dsh web` (0.4.0 was verified end-to-end on a Desktop profile: capsule → workshop → import/export → draft persistence).

Only two steps differ:

| | `dsh web` (CLI) | Desktop |
| --- | --- | --- |
| Install | `dsh plugin --profile web add @xia-sc/dsh-cc-studio` | Install `@xia-sc/dsh-cc-studio` from the in-app **Plugins** panel on the left; with the CLI available you can also run `dsh plugin --profile desktop add @xia-sc/dsh-cc-studio` |
| profile | usually `web` | usually `desktop` (`~/.dsh/profiles/desktop`); check what the app shows |
| Host / plugin changes | restart `dsh web` | quit and reopen the desktop app |
| Client-only changes (`lib/client.js`) | reload the page | reload inside the app window (restart the app if you cannot find a reload entry) |
| Data location | `<DSH_HOME>/cc-drafts/`, `<DSH_HOME>/cc-library/`, `<DSH_HOME>/cc-groups/` (defaults to `~/.dsh`) | identical — Desktop shares the same `DSH_HOME` and data roots |

> The Desktop app window *is* its Web GUI (the port is assigned by the app), so "restart the app" ≈ restart the host and "reload the window" ≈ reload the page — interchangeable when troubleshooting.

## Quick start

1. Create a session and pick **CC Mode** (the capsule appears above the composer).
2. Just describe the idea: "I want a Rain City memory-pawnshop owner, but my worldbuilding is thin."
3. The LLM walks the 6 steps and asks 1–2 questions before each one; the capsule and workshop refresh on every Tool call:
   `cc_get_card` (summarize progress + ask) → `cc_patch_character` (discuss vibe/relationship, then fill the 4-piece) → `cc_patch_world` (discuss world focus, then ≥3 dimensions, `autoLorebook`) → `cc_add_lorebook_entries` (discuss triggers, then ≥5 with ≥1 `constant`) → `cc_patch_greetings` (discuss scene, then greetings) → `cc_validate`.
4. Tweak anything in the workshop anytime. After validation: sidebar `★ Save Current` (overwrites in place when an ID is loaded, otherwise creates one) or `＋ Save as New`, or export `JSON / PNG / CHARX`. Later load/rename/export/delete by ID (the top `Loaded ID:xxxx` highlights the active card), or just tell the model "load ID xxxx".

## Features

### Fusion workshop (client)

- **Layout**: capsule above the composer (auto in CC Mode) → `shell.overlay` fullscreen workshop with **3 nav pages** (**5D World / Character / Lorebook**) plus a **Validate & Export** entry at the bottom of the left rail / fluid main / 268px collapsible saved sidebar / two collapsed-by-default reading aids at the bottom of the main pane (live `card.json` preview, CBS cheatsheet). Adaptive light/dark via DSW Tokens + brand purple `#7c5cff`.
- **Only two export entry points** (unified in 0.4.1): the bottom-left **Validate & Export** entry and the **Export** button on a saved-card row both open the same **export page** (`JSON / PNG / Embed into PNG / CHARX / Validate`) — that page always exports the card currently in the workshop (its title carries the card name, or "Unnamed"), so load a saved card first if that is the one you want to export. The top toolbar no longer carries an "Export JSON" button. Clicking a card-row **Export** flips that button to "Opened ✓" immediately, and if the card is not loaded yet the export page tells you to hit Load on its row first.
- **Style tags**: edit `tags` as a comma-separated field on the Character page; written back to `data.tags` live.
- **5D worldbuilding**: Timeline / Factions / Geography / Power / Daily → `cc_patch_world(autoLorebook=true)` auto-generates Lorebook entries with `@@position / @@depth / @@activate` (≥1 `constant`; re-calling overwrites previous auto entries and keeps manual ones). The five dimensions render as **document-style text** (borderless auto-growing textareas, editable in place); `⛶` opens a 720px modal carrying an open-time snapshot, so Cancel really rolls back.
- **Large editors for all long texts**: `description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes` each have a `⛶` 720px modal that syncs live.
- **Saved sidebar (ID-based CRUD)**: 268px, collapsible (down to a 40px bar), highlights the active card (purple border + `Loaded ID:xxxx`, first 8 chars); `★ Save Current` overwrites when an ID is loaded, `＋ Save as New` always creates a new one, `✎ Rename` / `＋ New`; search / load / export / delete persist to `~/.dsh/cc-library/<id>.json`.
- **Import / export**: sidebar `⬆ Import JSON/PNG/CHARX` auto-detects the container; on the export page `⬇ JSON` / `⬇ PNG` (1×1 placeholder) / `⬆ Embed into PNG` (writes into any PNG you upload, stripping old `ccv3/chara` chunks and recalculating `CRC32`) / `⬇ CHARX` (packs `card.json`).
- **Bilingual (zh/en)**: complete `zh / en` dictionaries (`locale: dshCcStudio`) that follow the global `Settings → General → Language` (capsule/workshop/settings refresh instantly, no in-plugin toggle).
- **Adaptive theming**: full `var(--dsw-alias-bg-* / border-l1/l2 / label-primary/secondary)`, primary actions stay brand purple, live on refresh.

### CC Mode (32 model-side Tools)

- **6-step workflow + co-creation constraint**: before each step the LLM must ask 1–2 open questions (vibe / relationship / world focus / triggers / opening scene) and may never fill everything by assumption; 4-piece character → ≥3 world dimensions → ≥5 lorebook entries (**at least one of them co-created with the user** — auto-generated entries alone don't count) → greetings → `cc_validate` to finish. Each reply carries exactly one `workflow.next` (what's next) and `workflow.state` (tri-state progress for the four parts).
  `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate`
- **Lorebook quality**: `cc_patch_world` takes `loreKeys` (per-dimension trigger words — without them auto entries can only use dimension names as keys, which real chat never says); `cc_simulate_trigger` checks a real sentence for hits; `cc_lint_lorebook` statically audits; `cc_patch_book_meta` edits book-level fields (name / `scan_depth` / `token_budget` / recursive scanning).
- **Fine-grained lorebook control**: `cc_delete_lorebook_entries` / `cc_update_lorebook_entry`.
- **Dry-run before export**: `cc_preview_export` (size, estimated tokens, field list, and how much of the 5D text is duplicated inside entries).
- **Clean slate**: `cc_new_card` (destructive: the user must agree first, then pass `confirm:true`).
- **Saved-library CRUD (shared IDs with the sidebar)**: `cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry` — "update/load ID xxxx" works in natural language, no UI clicks needed. **Saving right after loading updates the same card** (the draft remembers its source id), so you no longer silently accumulate duplicate cards; renaming updates both the list name and the in-card `data.name`.
- **Relationship graph (0.8.0)**: `cc_get_relations` / `cc_patch_relations` / `cc_render_relations` / `cc_group_check` — three dimensions (direction × type × strength) living plugin-side under `<DSH_HOME>/cc-groups/`, rendered into `description`'s marker block so shared cards stay self-contained.
- **Shared lorebook (0.9.0)**: `cc_get_shared_book` / `cc_patch_shared_book` / `cc_promote_shared_entries` / `cc_apply_shared_book` — one book per group (`<DSH_HOME>/cc-books/<groupId>.json`), holding the world setting the member cards would otherwise each repeat verbatim. The model can read it, edit it, **promote duplicated entries into it** (dry-run by default; only exactly-matching content is ever deleted) and merge it back into a card for clients without a global lorebook. The file itself is CCv3's standalone lorebook format, so it can be re-used anywhere.
- **Group management (0.8.0)**: `cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group` — the model can now build and re-file groups end to end (`cardId` defaults to the current draft's source card). **Leaving a group deletes neither nodes nor edges** (moving back keeps the relations), **deleting a group never deletes cards** (it only clears their `meta.groupId`), and `cc_delete_group` is destructive: it reports the counts first and only acts with `confirm:true`.

### Validation and spec

- Live host-side validation: `spec / group_only_greetings` required, single main icon, regex validity, `spec: chara_card_v3 / spec_version: 3.0`.
- Full CCv3 coverage: `name / nickname / tags / description / personality / scenario / system_prompt / post_history_instructions / first_mes / alternate_greetings / group_only_greetings / mes_example / creator_notes / assets / character_book`, with CBS `{{char}} / {{random}} / {{roll}}`.

## Structure

```
dsh-cc-studio/
├── package.json          # @xia-sc/dsh-cc-studio, dsh.bundle.patch + dsh.client, exports ./client ./agent
├── cordis.patch.yml      # host insert: id dsh-cc-studio
├── lib/
│   ├── index.js          # host: /dsh-cc-studio-rpc (validate, cc_getDraft/cc_setDraft/cc_patchDraft, cc_isCcMode,
│   │                     #   cc_validateDraft, library cc_*Library, containers cc_importFromPng/cc_exportPng(+imageB64)/
│   │                     #   cc_importFromCharx/cc_exportCharx, CRC32/ZIP/STORE&DEFLATE)
│   ├── agent.js          # CC Mode Tools: 6-step co-creation + 5 lorebook-quality + 2 lorebook CRUD + 6 saved-library CRUD
│   │                     #   + 4 relations (0.8.0) + 5 group management (0.8.0) = 28
│   └── client.js         # client: dock capsule + overlay workshop + settings.section (DSW Tokens, brand purple,
│                         #   5D echo, large editors, JSON/PNG/CHARX import/export/embed)
├── presets/
│   ├── cc.patch.yml      # patch layer 2: the CC preset declaration row (dsh ≥ 0.1.7-alpha.1)
│   └── cc/               # legacy preset directory template (dsh ≤ 0.1.6-alpha.2, installed on mount)
│       ├── preset.yml
│       └── agent.cordis.yml
├── tests/                # 14 files, 604 assertions (not published with the package)
│   ├── rpc-channel.test.mjs       # host-half RPC channel regression (fake ctx + real http), 52 assertions incl. the group endpoints + the cc_getGroup reply shape
│   ├── preset-install.test.mjs    # install decisions + native hand-off + anti-drift + row contract + DSH STORE listing contract, 79 assertions
│   ├── cc-detection.test.mjs      # source-level guards for CC Mode detection, 51 assertions
│   ├── client-greetings.test.mjs  # client greetings and i18n guards, 62 assertions
│   ├── draft-slot-sync.test.mjs   # behavioural draft-slot regression (fake React/slot/RPC harness), 18 assertions
│   ├── nav-highlight.test.mjs     # workshop step-nav tri-state regression (selection / keyboard focus / hover stay exclusive), 23 assertions
│   ├── clear-card.test.mjs        # "clear the current card" confirmation regression, 20 assertions
│   ├── export-entry.test.mjs      # export entry points unified (three doors down to two), 31 assertions
│   ├── close-button.test.mjs      # workshop close button ✕ (red on hover), 14 assertions
│   ├── tools-contract.test.mjs    # CC Mode tool-chain contract, state machine and draft identity (32 tools), 97 assertions
│   ├── relations.test.mjs         # relationship graph + group CRUD: two-half parity, idempotent rendering, data-loss invariants, 69 assertions
│   ├── relations-view.test.mjs    # workshop relations view renders what the host actually returns (the "0 relations" bug), 8 assertions
│   └── data-root.test.mjs         # data roots: DSH_HOME first + read-time fallback to ~/.dsh, 37 assertions
├── CHANGELOG.md          # full version history (Chinese)
├── README.md             # Chinese (default)
└── README_EN.md          # English
```

> `dsh-cc-agent` was merged into `lib/agent.js` (`@xia-sc/dsh-cc-studio/agent`) at `5f95110`; no separate install needed; the `CC Mode` preset mounts only that single source and does not pollute `standard`.

## Development and tests

```bash
npm test                                   # 14 files, 604 assertions (fourteen node scripts chained)
node tests/rpc-channel.test.mjs            # only the host-half RPC channel regression (52 assertions)
```

- **Client changes**: `lib/client.js` only needs a page refresh; with `pnpm run dev:web` running from the dsh checkout it hot-updates.
- **Host changes**: `lib/index.js` needs a dsh web restart (host rows are composed at startup).

## Appearance

Light/dark via `var(--dsw-alias-*)` (`body[data-ds-dark-theme]`), primary stays `#7c5cff`. Switch at Settings → Appearance → Light/Dark/Follow system, the workshop updates on refresh.

## Compatibility & permissions

The listing metadata (`dsh.compatibility`, `engines`, runtime dependencies) and the permission bounds live here; DSH STORE's fixed-source review reads the same places.

| Item | Value |
| --- | --- |
| DSH range | `>=0.1.5-rc.1` (`dsh.compatibility.dsh` in `package.json`) |
| Per-release evidence | `dsh.compatibility.dshReleases` marks `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.6-alpha.1` / `0.1.6-alpha.2` / `0.1.7-alpha.1` / `0.1.7-rc.1` / **`0.2.0-rc.2`** as `compatible`. Versions that were **never tested are not written** (`0.1.7-alpha.2`, `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.1-alpha.1` stay undeclared and show as unknown) instead of being claimed first and tested later |
| Node.js | `engines.node: ">=22"` (verified on Node v26.9.0) |
| Host form | `dsh web` (CLI) and **DSH Desktop (DeepSeek Harness Desktop)** are the same host + profile-bundles mechanism, **both supported** (differences and install steps: [7. Desktop](#7-desktop-deepseek-harness-desktop)) |
| Client platform | `dsh.client.platform: "web"` — that is the **browser-half** platform tag, not the dsh profile name (`web` / `desktop` / …); Desktop and the CLI load the very same client bundle |
| Runtime dependencies | **none**: `lib/*.js` only imports `node:` builtins and relative paths; the bundled patch/preset files are static YAML with no install-time script |
| Lifecycle scripts | **none** (`preinstall` / `install` / `postinstall` / `prepare`); only `test` and `prepublishOnly`, which run in this repository and never on an installer |
| Files | reads its own five directories under `<DSH_HOME>` (plus the legacy `~/.dsh` root): `cc-drafts/`, `cc-library/`, `cc-groups/`, `cc-books/`, `.agent-presets/cc/` (written only on dsh ≤ `0.1.6-alpha.2`), and its own `package.json`. It never writes host config or touches another plugin's data |
| Network | none: the host half only registers `POST /dsh-cc-studio-rpc/<endpoint>` on the host's `webServer`; the client half only calls same-origin RPC |
| Commands | none: no subprocess, no shell |
| Credentials | reads and stores no token, key or cookie. It reads exactly two environment variables (`DSH_HOME`, `DSH_CC_STUDIO_PRESET_INSTALL`), and its HTTP route reuses the **host's** cookie fence (`connection.requestRejection`) without parsing credentials itself |

> **Why DSH STORE will never auto-approve it:** STORE's automatic low-risk channel (`source-verified`) requires runtime source to contain **no** files, network, commands or credentials signals. This plugin's core feature is persisting character cards and drafts (the files signal), and it must read `DSH_HOME` (the scanner counts any `process.env` read as a credentials signal). Neither will be removed to please a scanner — for a legitimate plugin like this, the correct store tier is `user-reviewed` (it shows the change and asks the user to confirm each install).

Disposable-Profile install / start / uninstall evidence lives in the `0.3.7` section of [CHANGELOG.md](./CHANGELOG.md): an isolated profile with isolated `DSH_HOME` / `HOME` / `USERPROFILE`, all three client mounts `active`, `cc` present in the preset roster, RPC round-trips identical, PNG / CHARX export→import identical, and the real `~/.dsh` unchanged throughout.

## Spec

- [CCv3 SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) (authoritative)
- [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/main/concepts.md) outdated, reference only

## Changelog

Full history lives in [CHANGELOG.md](./CHANGELOG.md) (Chinese). Latest:

- `0.5.0` **A full round of fixes from an LLM-side UX test** (another LLM played "tool user" end-to-end, built a card, ran a save/load round-trip, and filed 15 findings). **P0 four**: `autoLorebook` keys were dimension names only (real chat never says "geography" — 4 of 5 entries were dead; now `loreKeys` lets the model supply real entity names); auto-generating 5 entries instantly satisfied "lorebook done" and skipped step 4's co-creation, contradicting the tool's own "must call" contract (completion now requires **≥5 entries and ≥1 co-created one**); after a passing `cc_validate` the returned `next` still said "must call cc_validate" (now there is a terminal state: `done` + step 7 + export guidance); saving right after a load created **a duplicate card with the same name** (the draft now remembers its source id, surviving page reloads). **P1**: slimmer replies (no more duplicated top-level `next/hint/notice/warning`; patch tools return only `changed` unless `verbose:true`; `fields` / `includeDraft` for on-demand reads), `Ok`/`Partial` collapsed into a tri-state, 12 new `cc_validate` warnings, rename now syncs `data.name`, `meta.tagsTotal`. **5 new tools**: `cc_simulate_trigger` (the gap the report cared most about), `cc_new_card`, `cc_patch_book_meta`, `cc_lint_lorebook`, `cc_preview_export` — tool count 14 → 19. Also a source-review find: the name-based fallback could silently delete a user's hand-made "日常" entry. Tests 380 → 430 (new `tests/tools-contract.test.mjs`, 50 assertions then). **Restart dsh (or the desktop app) to take effect.**
- `0.6.0` **Second-round regression fixes**: the same LLM tester re-ran the whole flow plus a controlled reproduction and found **P0-6 — when the draft is swapped from another path (workshop UI / host restore), the model has no way to notice**; during the test it silently wiped another card's `personality` (data was restored). Three layers: every tool reply now carries **`cardName` / `cardId`**, `draftStatus.key` is renamed **`sessionKey`** (it is just the session slot, not a card identity); the draft file gains a **`rev`** (identical on both halves) and the tool side **reloads from disk** with an explicit notice when it detects an external change; write tools accept **`expectedRev`** as an optimistic lock and refuse stale writes (`staleRev`). Also fixes `isNew` (now `true` after `cc_new_card`) and the first-round leftovers: **R1** `hint` and `next` now come from one source (no more "next says done, hint says go validate"), **R2** hint / next / message no longer copy each other, **R3** de-duplicated `cc_validate` message, **R4** `autoLoreEdited` + warning when regenerating autoLorebook overwrites hand-edited keys. Tests 430 → 443. **Restart dsh (or the desktop app) to take effect.**
- `0.7.0` **Fourth-round regression fixes**: the tester set out to verify the three suggestions left over from the previous version and found **none of them had landed** — plus a real performance trap surfaced during stress testing. **N1**: `data.creator` had **no write path at all** (`cc_validate` warned about it on every run, yet neither the tool schema nor the workshop UI could set it — a value passed in was silently ignored) → `creator` on `cc_patch_character`, the same on the host half's `cc_patchDraft`, and a new input in the workshop's character page. **N2 (the big one)**: a long five-dimension world plus autoLorebook copying it verbatim means **a single sentence** can eat the whole world-book budget (measured: "where exactly is 剑冢" → **1139 tokens** against a budget of 1200), and raising `token_budget` can paper over the signal → `cc_lint_lorebook` now reports a **worst-case single-trigger load** (entries sharing a trigger word are merged into one group, plus the always-on constant entries, taking the largest group), while `cc_patch_world` reports `sharedLoreKeys` (one entity assigned to several dimensions) and `heavyAutoEntries` (a single auto entry above 400 tokens) **at write time**. **S1**: calls that omit `expectedRev` now get a `revDrift` + notice (a fallback for weaker models). **S2**: an intentional `cc_new_card` reset is no longer reported as "content may have been lost" (causes are separated; a genuinely new session still warns). **N4**: a no-op write no longer burns a `rev`. Tests 443 → 455. **Restart dsh (or the desktop app) to take effect.**
- `0.8.2` **The whole group-chat iteration, released at last**: a plugin-side relationship graph (`<DSH_HOME>/cc-groups/`, three dimensions = direction × type × strength, with nodes for either a character that has its own card or an in-card NPC) plus `cc_render_relations` writing it into a fixed marker block in `description` so a shared card stays self-contained (idempotent, `dryRun` preview, empty graph = clear the block); then **model-side group CRUD** (`cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group`) and a **group-level shared lorebook** (`<DSH_HOME>/cc-books/`, one book per group, the file itself a plain CCv3 `lorebook_v3` JSON — `cc_promote_shared_entries` lifts the entries every member card repeats verbatim into it and deletes them from the cards), and the workshop's left rail re-cut as a **card-structure navigation** (Overview / Character / World / Lorebook / Openings & examples / Relations & groups / Shared lorebook, each with a tri-state progress badge). Tools 19 → 32. Fixed along the way: **B4** one tool-side save silently dropped a card out of its group (the two halves' `makeLibraryEntryMeta` had drifted), **B5** `mutual` edges were never rendered, the **relations view stuck at "0 relations"** and its navigation twin (the client read the wrong reply shape — the edges live inside `group`), and **the relations view not following a card switch**. Tests 509 → 604 (14 files). **Restart dsh (or the desktop app), then refresh the page.**
- `0.7.1` **Fifth-round regression fixes**: three of the previous version's four fixes passed on the spot; the fourth (S1) needed explaining, and a real bug surfaced. **B1**: the first `cc_get_card` after a dsh restart failed with `value is not lossless JSON` — dsh validates every tool reply as lossless JSON, so **any nested `undefined` fails the whole call**. The cause is an **externally imported card missing fields** (a PNG/CHARX import may carry no `spec_version` / `creation_date` at all) while the code reads and forwards it verbatim. Three layers, identical on both halves: **normalize on load** (new `normalizeCardShape` fills missing keys from the blank-card template without overwriting values or changing types), an explicit `null` fallback for `draftStatus.creation_date`, and **output hygiene** (the `tool()` wrapper runs every reply through one JSON round-trip, so no `undefined` can ever leak again). **S1** was in fact already implemented — drift only ever comes from a write **outside** the tool sequence — and this version adds `draftStatus.watchedRev` (the on-disk revision remembered before the call) so callers can check at will instead of waiting for the one-shot notice. **B2**: `changed` now shares `rev`'s criterion (`assignIfChanged`), so a same-value write no longer claims a change. Also adds a **`build` identifier** (on every reply, kept in sync with `package.json`) following the tester's workflow suggestion — an LLM can now confirm which code it is testing instead of wasting a whole round on a forgotten restart. Tests 455 → 464. **Restart dsh (or the desktop app) to take effect.**
- `0.4.1` **Export entry points unified**: the same "export" used to live in three places (the top toolbar's "⬇ Export JSON", the left rail's 4th step "Validate & Export", and the "Export" button on a saved-card row), each behaving slightly differently. The toolbar button is gone; the left rail and the top capsules keep only the three writing steps, and "Validate & Export" merged with the old bottom "Validate" button into a single entry that opens the export page; the card-row "Export" keeps its position but now jumps to that same page — one implementation left (the card-row button no longer downloads JSON directly, and the `store.exportLibraryEntry` side path is deleted). The export page gained a line stating it exports the card currently in the workshop (load a saved card first if that is the one you want). **The other half is docs**: README / README_EN now spell out **DSH Desktop (DeepSeek Harness Desktop) support** — a new "7. Desktop" section (where to install, profile name, restart-app vs reload-window, data roots), a "Host form" row in the compatibility table, and the easily-misread `Profile | web` row renamed to "Client platform". Real-machine feedback then added three affordances: the export page title carries the current card name (or "Unnamed"), a card-row **Export** flips to "Opened ✓" for six seconds, and the export page shows a highlighted notice when the card you clicked is not loaded yet. The bottom **Validate & Export** entry deliberately has **no selected state** — when it lit up together with the card-row feedback it read as "two things selected at once". The workshop header's "Collapse" is now a **✕** icon button (red on hover, closes the workshop). Tests 335 → 380 (new `tests/export-entry.test.mjs`, 31 assertions, and `tests/close-button.test.mjs`, 14).
- `0.4.0` Fixes the workshop's left step-list highlight: after clicking a step, that row grew a stray outline ring, and switching steps with the top capsules left the ring behind on the old row — two rows looked selected at once. Root cause: `navItem` only painted the `s.cur` selection and never touched browser focus (a clicked `<button>` keeps focus, so the host/UA focus outline stayed painted on its edge). Now: nav rows call `preventDefault()` on `mousedown` (mouse clicks no longer steal focus, Tab still works), the `outline` is owned by the plugin (a 2px brand ring appears only for `:focus-visible`), the selection uses a brand-tinted background plus a left bar and `aria-current`, and hover feedback plus "clear the ring on any mouse press" were added. Adds a **"Clear current card" button** (under *Validate* in the left rail; a `window.confirm` gate swaps the draft back to an empty card and drops the library link, so a later "Save current" creates a new card instead of overwriting the saved one). And **rebuilds the workshop UI** (the main event): the 360px right rail is gone — the live CCv3 preview and the CBS cheatsheet moved to collapsible rows at the bottom of the reading pane (collapsed by default, the preview row still shows the spec and pass/fail badges), and the pure-intro "fusion notes" block was dropped entirely; fields render as document-style rows (borderless auto-growing textareas via `field-sizing: content`) with editing demoted to ⛶ big-box on demand, widening the reading pane from ~700px to ~876px at 1400px. Every feature is kept. `tests/nav-highlight.test.mjs` (23 assertions) and `tests/clear-card.test.mjs` (20) pin the new behaviour. Tests 292 → 335.
- `0.3.8` DSH STORE listing contract ([Store #1173](https://github.com/AI-Scarlett/DSH-Store/issues/1173)): `engines.node: ">=22"`, `dsh.compatibility` (a range plus an exact per-release matrix that **only lists tested versions**), removal of the `@deepseek-ai/cordis` runtime dependency that no code has imported since 0.3.0, a new "Compatibility & permissions" section in both READMEs, and 11 contract guards in `tests/preset-install.test.mjs` (281 → 292 assertions). **Changing this repository alone cannot close the issue**: the store entry still carries the 0.3.0 package name `@dsh-plugins/dsh-cc-studio`, so STORE's recheck fails at step one with `update-blocked` ("package name no longer matches the Catalog identity") and never reads a 0.3.x manifest — STORE has to migrate the entry identity (re-submitting does not bypass it: the shared `entryIds` collide with the old entry). And the files / credentials permission signals are the plugin's core features (card and draft persistence, reading `DSH_HOME`), so the automatic low-risk channel can never pass; the correct tier is `user-reviewed` (per-install user confirmation). A **dsh `0.2.0-rc.2` compatibility audit** is also done (isolated host: host/preset row composition, RPC wire protocol and fence, draft-slot key, preset roster containing `cc` with an empty `broken`, all three client mounts `active`, PNG/CHARX round-trips byte-identical, real `~/.dsh` untouched), so the matrix now declares `0.2.0-rc.2: compatible`; `0.2.0-rc.1` / `0.2.1-alpha.1` were not tested and stay undeclared.
- `0.3.7` dsh `0.1.7-rc.1` compatibility audit: **nothing needed adapting** (an isolated host verified the RPC route/wire protocol, the preset roster, all three client mounts, the draft-slot key, the data roots, and a PNG/CHARX round-trip). The one real fix is a preset row that had been missing **since the preset was first written**: `command-goal` has been in the shipped `standard` since `0.1.6-alpha.2`, but the initial copy dropped it — no error, no `broken`, just no `/goal` slash command in a CC Mode session (same class as the `present` row restored in 0.3.4). It is now restored in both carriers, guarded by a row-set snapshot test. Also corrects three doc claims that would mislead the next upgrade (async iteration of `IncomingMessage` does *not* throw here — the official `/api` bridge uses `for await` itself; `/api/agentPresets/list` does carry optional `name`/`description`/`broken`; the channel/endpoint name regexes live in `dsh-client-connection`, not `webServer.register`), and adds a cross-file guard for the implicit "client `preset.ccLabel` must equal the host preset's display name" coupling. It also trims the CC Mode description shown in the session-mode dropdown: it used to list the model-side tool names (`cc_get_card` / `cc_patch_character` / …), which filled the dropdown without telling the user anything (tool names only mean something to the model reading the persona); it now just says "the model asks before it fills / live capsule sync / full-screen workshop / export JSON, PNG, CHARX". Tests 278 → 281.
- `0.3.6` Two fixes. ① The `CC Mode` preset disappearing on dsh `0.1.7-alpha.1`: from that version on dsh takes presets only from **declaration rows** in a composition, and `<DSH_HOME>/.agent-presets/` is no longer read by any code (the directory is still there, nobody looks at it). The plugin now ships a patch layer `presets/cc.patch.yml` (a `@deepseek-ai/dsh-agent-preset` declaration, structurally identical to the built-in `standard`) and writes nothing on the new version; the directory install is kept for ≤ `0.1.6-alpha.2` only and stands down automatically on newer dsh. ② Data roots unified: drafts and the card library used to be hard-wired to `~/.dsh` and ignored `DSH_HOME` (custom-`DSH_HOME` users ended up with two sets of roots, and an isolated run wrote into the real `~/.dsh`), now **`DSH_HOME` first with a read-time fallback to `~/.dsh`** — unchanged paths when `DSH_HOME` is unset. Tests 216 → 278.
- `0.3.5` Fixes #5, "frontend and Tools read different draft slots": `useCcPreset` read `useSessions().current`, a field that does not exist in dsh `0.1.6-alpha.2`'s `SessionListState` (it was always `null`), and the keyless pull at startup consumed the global throttle, so the UI stayed on the `default` slot while the model's Tools wrote to `session-<sessionId>` — hence "the model says it wrote it / the workshop says there is no data". Now the session id is taken from slot props only and published to the store, a draft pull without a session id is never sent, throttling is per key, and a host response whose `key` differs is not rendered but surfaced as a warning. Also fixes the capsule flicker (the root-scope instance was clearing the CC verdict the session-scope instance had just made) and adds `cc_migrateDraft` with a one-click "migrate into this session" recovery. Tests 158 → 216 (+ a behavioural `tests/draft-slot-sync.test.mjs`).
- `0.3.4` dsh `0.1.6-alpha.2` compatibility plus two preset omissions restored: the CC preset was missing the `present` row (so CC Mode's model had no "register a deliverable" tool, silently) and the `tool-subagent` row was missing `modelSelectionSettings: true` (silently disabling per-subagent model selection); also adds the `tool-plugin-manager` row dsh added in alpha.2 (`disabled`, so the preset now differs from the shipped `standard` only where intended). Adds 7 preset row-contract guards.
- `0.3.3` Release automation: pushing a `v*` tag makes GitHub Actions publish to npm (OIDC trusted publishing, no secrets) and create the GitHub Release; a manual run only does a safe self-check. No runtime behaviour change.
- `0.3.2` Renamed to `@xia-sc/dsh-cc-studio` (the former `@dsh-plugins` is not an npm scope this project owns, so it could not be published) and published to npm for the first time; adds `publishConfig.access` / `prepublishOnly` and other publishing metadata.
- `0.3.1` dsh `0.1.6-alpha.1` compatibility: the CC preset's `workflow-worker-thread` row becomes `workflow-ptc`; otherwise the whole preset is marked broken and CC Mode becomes unselectable.
- `0.3.0` Removed the "Idea" page: the workshop now has 4 nav pages (5D World / Character / Lorebook / Validate & Export), the `⛶` large-editor capability moved to a shared `fieldHead()` covering every long-text string field, sidebar search kept. Also fixes the array round-trip regression that change introduced (`[]` was rewritten as `[""]`, i.e. a phantom blank greeting), and turns the greeting fields into **per-entry editors** (one box = one entry), removing the silent corruption where editing a multi-paragraph greeting split it into several; adds greeting add/remove and aligns the 10-entry cap. Makes the large editor's "Cancel" actually roll back, removes the `expandIdea` / `expandWorld` dead code unreachable since 67172fd, and **completes the i18n wiring** (the locale table existed but many call sites hard-coded Chinese, so English still showed Chinese; all 122 Chinese literals are now wired, with the Chinese UI byte-for-byte unchanged), **installs the CC preset automatically** (previously a manual copy), and fixes **the capsule not appearing on the first switch to CC Mode** (detection read the wrong field, `projectionValues.agentPreset`, so it only appeared after a refresh or session switch).
- `0.2.22` Fix the dsh `0.1.5-rc.1` boot crash: `connection.rpc.handle()` is unusable by an outside plugin, so the host half now registers the `/dsh-cc-studio-rpc` prefix route on `webServer` and implements the same RPC wire protocol; request bodies are read with events; fixes the `presets/cc` persona `prefix`; adds 23 regression assertions.
- `0.2.21` Fix #2 silent draft loss: every draft write persists to `~/.dsh/cc-drafts/<session>.json` and restores per session after a restart; fresh blanks warn, successful restores notify.

## License

MIT © 2026 xia-sc — see [LICENSE](./LICENSE).

## Listed

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/xia-sc/dsh-cc-studio)
