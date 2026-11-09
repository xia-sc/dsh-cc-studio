# dsh-cc-studio · CCv3 Character Card Studio

[![npm version](https://img.shields.io/npm/v/@xia-sc/dsh-cc-studio?color=%237c5cff)](https://www.npmjs.com/package/@xia-sc/dsh-cc-studio)

> From a one-line idea to a `chara_card_v3` you can import into SillyTavern / Risu. Built for "I have the idea, the world is thin".

A DSH (DeepSeek Harness) plugin: a capsule above the composer opens a fullscreen studio where the `CC Mode` preset drives 33 LLM Tools to **ask first, then write**, and finish with `JSON / PNG / CHARX` export — or a **one-click push into a local SillyTavern**.

| Item | Value |
| --- | --- |
| Package / version | `@xia-sc/dsh-cc-studio` `0.16.0` |
| Compatibility | DSH `>=0.2.0-rc.2` (incl. Desktop), Node `>=22`, **zero runtime dependencies**; see [Compatibility & permissions](#compatibility--permissions) |
| Storage | `<DSH_HOME>/cc-library/` (cards), `cc-drafts/` (session drafts + creation lock + backups), `cc-groups/` (relationship groups), `cc-books/` (group shared lorebook); `DSH_HOME` defaults to `~/.dsh` |
| Docs | This file; read [AGENTS.md](./AGENTS.md) before changing code; history in [CHANGELOG.md](./CHANGELOG.md) |

## Install

Paste the following to your agent (inside DSH, Claude Code, or Codex):

```text
Task: install the @xia-sc/dsh-cc-studio plugin for DSH.
1. Find the profile name (directory under ~/.dsh/profiles/; Desktop usually "desktop", CLI web usually "web").
2. Install: dsh plugin --profile <profile> add @xia-sc/dsh-cc-studio
   If dsh is not on PATH: Desktop ships a CLI at <install dir>/resources/runtime/cli/bin/dsh.
3. Verify the composition (read-only): dsh --profile <profile> --dump-config
   Expect `id: dsh-cc-studio` (host row) and `id: preset-cc` (CC preset row) under `# == @xia-sc/dsh-cc-studio`.
4. Restart: CLI restarts `dsh web`; Desktop quit and reopen the app.
5. Do not copy presets into ~/.dsh/.agent-presets/ (not read), do not hand-edit the profile package.json, do not reinstall repeatedly.
Permissions: the plugin writes <DSH_HOME>/cc-drafts/ and cc-library/; when an agent runs this inside DSH it needs danger-full-access.
```

Manual install / update:

```bash
dsh plugin --profile web add @xia-sc/dsh-cc-studio          # install / update
dsh plugin --profile web add @xia-sc/dsh-cc-studio@0.16.0   # pin a version
dsh plugin --profile web add github:xia-sc/dsh-cc-studio#v0.16.0  # from a GitHub tag
dsh plugin --profile web remove @xia-sc/dsh-cc-studio        # uninstall
```

`CC Mode` is delivered by the bundled declaration layer `presets/cc.patch.yml`; the plugin never writes preset files into the user directory. Uninstalling does **not** delete `cc-library/` or `cc-drafts/`.

## FAQ

| Symptom | Fix |
| --- | --- |
| After restart the browser shows `Failed to load plugins` / `4 entry did not activate` | You reinstalled under a new package name but the profile still has the old identity. Check that the directory name under `node_modules/` equals `package.json`'s `name`; reinstall by the new name → restart → hard refresh |
| Code changes have no effect | `lib/client.js` → reload the page; `lib/index.js` / presets → restart dsh. The `build` field in any tool reply is the only reliable signal |
| Clicking "Load" while the LLM writes does nothing and the studio is read-only | Draft lock: the LLM holds it. Ask it to call `cc_release_draft`, wait for the 30-minute idle expiry, or switch off the guard in Settings |
| Occasional `tool input is invalid JSON` | The model produced malformed tool arguments (often a trailing comma). Resend the same message; prompts already require strict JSON in small steps |

## Quick start

1. Start a new session and pick **CC Mode** — the capsule appears above the composer.
2. Describe what you want, e.g. "a pawnshop owner in Rain City with a thin world".
3. The model follows six steps, asking your preference before writing: `cc_get_card` → `cc_patch_character` → `cc_patch_world` → `cc_add_lorebook_entries` → `cc_patch_greetings` → `cc_validate` → `cc_release_draft` (hand control back).
4. Open the capsule any time to watch progress (read-only while the LLM writes). After validation, refine, `★ Save Current` / `＋ Save as New`, or export.
5. Into SillyTavern: open the export dialog → **Import into SillyTavern** → Import.

## Features

### Studio (client)

- **Layout**: capsule → fullscreen studio; 3-page nav (5D World / Character / Lorebook) plus a bottom-left **Validate & Export**; collapsible 268px saved-cards sidebar; collapsed live `card.json` preview and CBS cheatsheet at the bottom.
- **Document-style editing**: borderless auto-growing textareas, editable in place; long fields open a `⛶` modal with a snapshot so Cancel really rolls back.
- **5D worldbuilding**: Timeline / Factions / Geography / Power / Daily → `autoLorebook` generates entries with `@@position / @@depth / @@activate`.
- **ID-based CRUD**: save (overwrite when an ID is loaded) / save as new / rename / new / load / delete, with search and highlight; persisted to `cc-library/<id>.json`.
- **LLM draft lock**: while active the studio is read-only and load/import only open a preview; overwriting actions back up the draft to `cc-drafts/backups/` (up to 20 per slot).
- **Import / export**: `⬆ Import JSON/PNG/CHARX` (V2/V1 cards are upgraded to CCv3), `⬇ JSON`, `⬇ PNG`, `⬆ Embed into PNG` (strips old `ccv3/chara` chunks), `⬇ CHARX`.
- **Bilingual + light/dark**: follows `Settings → General → Language` live.

### CC Mode (33 model tools)

Six-step workflow with co-creation rules (every step asks first; a complete lorebook is ≥5 entries with at least one co-created). Each reply carries one `workflow.next` + `workflow.state` + `message`, plus `build`.

| Group | Tools |
| --- | --- |
| Workflow (mandatory) | `cc_get_card` / `cc_patch_character` / `cc_patch_world` / `cc_add_lorebook_entries` / `cc_patch_greetings` / `cc_validate` |
| Hand-off | `cc_release_draft` — validation passing means the card is done; call it to release the draft |
| Lorebook quality | `cc_simulate_trigger` / `cc_lint_lorebook` / `cc_patch_book_meta` |
| Entries | `cc_update_lorebook_entry` / `cc_delete_lorebook_entries` |
| Export & reset | `cc_preview_export` / `cc_new_card` (destructive, needs `confirm:true`) |
| Relationships | `cc_get_relations` / `cc_patch_relations` / `cc_render_relations` / `cc_group_check` |
| Groups | `cc_list_groups` / `cc_create_group` / `cc_rename_group` / `cc_delete_group` / `cc_set_card_group` |
| Shared lorebook | `cc_get_shared_book` / `cc_patch_shared_book` / `cc_promote_shared_entries` / `cc_apply_shared_book` |
| Saved library | `cc_list_library` / `cc_save_to_library` / `cc_load_from_library` / `cc_delete_from_library` / `cc_rename_in_library` / `cc_get_library_entry` |

### Time anchoring (anti time-drift, 0.16.0)

The usual failure is "previous scene in the morning, next scene at night". CC Mode now writes two ST fields into every card (`cc_validate` refuses without them):

- `system_prompt`: every reply must start with `[时间：YYYY-MM-DD HH:MM]`; time only moves forward, matches what happened, and never jumps between times of day without a transition; an explicit user instruction ("the next day") wins. The template keeps ST's default base sentence.
- `post_history_instructions`: a pre-generation check — what was the previous timestamp, how long did this scene take, does it cross a time period; the check itself is not printed, only the new timestamp.

`first_mes` also carries a starting timestamp (`cc_patch_greetings` can fill it from `startTime`). ST has `prefer_character_prompt` / `prefer_character_jailbreak` on by default, so it works right after import; **if you customised the Main Prompt in ST, the card's system_prompt replaces it** (the template keeps the base sentence). This is a soft constraint: it greatly reduces drift, but cannot guarantee 100%.
### Relationships & shared lorebook

- **Relationships**: direction × type × strength; nodes are saved cards or in-card NPCs; group membership lives in the library entry's `meta.groupId`. Rendered into the `<!-- cc-relations:begin … -->` marker section, idempotent and previewable.
- **Group shared lorebook**: one book per group at `<DSH_HOME>/cc-books/<groupId>.json`; member cards keep only private entries. Migrate with `cc_promote_shared_entries` (dry-run by default, only removes byte-identical copies) and `cc_apply_shared_book`.
- **Two export shapes**: the CCv3 standalone `lorebook_v3` for clients that know the spec; SillyTavern only accepts `{entries:{…}}` — both buttons have their audience.

### Export & SillyTavern import

- Export is a **standalone dialog** opened from the bottom-left entry, the overview button, or a saved-card row (JSON / PNG / Embed / CHARX / Validate). A card-row Export sends that card by `cardId` — no need to load it first.
- Shared-book scope follows the export target: a saved card uses its own group, the draft uses the current group; no group means no binding.
- **One-click import into a local ST**: the dialog probes `http://127.0.0.1:8000` (address editable, optional Basic auth; the password stays in this session only). On success: the host opens a CSRF session, imports the lorebook first, rebinds the card copy to the world name ST reports, then imports the PNG card. Same-name books are skipped unless overwrite is ticked; existing cards are never overwritten; optional cover image. Requests run on the host because ST's default CORS refuses browser cross-origin calls; the local draft and library are untouched.

## Compatibility & permissions

- **Supported**: dsh `>=0.2.0-rc.2` (the whole 0.1.x line is unsupported since 0.12.0), Node `>=22`, zero runtime dependencies, no install lifecycle scripts.
- **Verified builds** (`dsh.compatibility.dshReleases`): `0.2.0-rc.2` (floor, declaration-row generation), `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.5`, `0.2.2-rc.1` — all compatible. **Unverified** (not in the matrix): `0.2.0-rc.1`, `0.2.1-alpha.1`, `0.2.1-rc.4`.
- **Storage permission**: four directories under `<DSH_HOME>` (`cc-drafts/` / `cc-library/` / `cc-groups/` / `cc-books/`); only one environment variable (`DSH_HOME`).
- **Network**: two outbound paths only — the Settings "Check for updates" call to the npm registry, and the export dialog's import into the local ST address you enter (default `127.0.0.1:8000`). Both run in the host; the browser never connects directly.
- **DSH STORE**: writing drafts/cards and reading `DSH_HOME` are core features and trip the file/credential signals, so the plugin is listed as `user-reviewed` (per-run confirmation). The runtime code is not changed to appease scanners.

## Development

```bash
npm test    # all test files, serial; must be green
```

- `lib/client.js` → reload the page; `lib/index.js` / presets → restart dsh.
- Architecture and hard rules (three halves, RPC wire protocol, single-layer preset delivery, storage roots, test isolation, compatibility matrix, past traps) live in [AGENTS.md](./AGENTS.md).

## Changelog

Full history: [CHANGELOG.md](./CHANGELOG.md) (0.12.0 onwards).

- `0.16.0` **Time anchoring (anti drift)**: every card gets a `system_prompt` (replies start with `[时间：…]`, time only moves forward) and `post_history_instructions` (pre-generation check), plus a starting timestamp in `first_mes`; validation fails without them.
- `0.15.1` **Added**: one-click import into a local SillyTavern from the export dialog (host does the CSRF session → lorebook first → bind by the returned name → PNG card; same-name books are skipped, existing cards are never overwritten; optional cover and Basic auth). **Fixed**: JPG/WebP covers are converted to PNG, and a non-PNG cover / unknown error no longer masquerades as "SillyTavern not detected".
- `0.14.2` A saved card's shared book follows that card's own `meta.groupId` (fetched with `cc_getBook`, shown with a group badge).
- `0.14.1` Export is decoupled from loading: a card-row Export exports that saved card (`cardId`).
- `0.14.0` Export became a standalone dialog instead of a middle-pane page; three entry points open it.
- `0.13.0` The CCv3 spec core and the SillyTavern layer split into `lib/compat/` (core + target adapters), so adding a platform is one adapter.
- `0.12.1` / `0.12.0` Adapt to dsh `0.2.2-rc.1` (preset subpath change); raise the floor to `0.2.0-rc.2` and collapse preset delivery to one declaration layer.

## License

MIT. See [CHANGELOG.md](./CHANGELOG.md) and the repository `AGENTS.md` for references.
