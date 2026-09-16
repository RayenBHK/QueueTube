# QueueTube agent handoff

Updated: 2026-09-16. Read this first after a model switch, usage-limit interruption, or a new task in this repository. This is a checkpoint, not a backlog execution order. Verify anything that can change before acting.

## Current stopping point

The latest request authorized the single v0.3.3 keyboard-unlock fix proposed after the roadmap breakdown. Implemented locally: Space/K typed in inputs, textareas, or contenteditable elements no longer unlocks queued manual playback. Normal Space/K player use and pointer unlocking remain unchanged. No other roadmap fixes, release, tag, or creative asset were started. There are no active subtasks or delegated agents.

Regression evidence: the new editable-field test failed on Space in an input before the fix, then passed after the guard. Tests cover Space, lowercase/uppercase K, all three editable target types, untouched event propagation/defaults, and player unlocking even with QueueTube shortcuts disabled. Next verification: reload the extension, refresh YouTube, and manually check search/comment typing versus player Space/K. Browser smoke and companion-extension compatibility were not rerun.

QueueTube v0.3.2 and its collapsed-popup fix are implemented and merged. The next-release proposal is saved. OpenDesign is installed but its MCP connection is blocked by an application startup failure. The user has not yet confirmed whether its dashboard opens normally.

## Product intent and decisions

The user collects YouTube picks with Ctrl-click or middle-click and wants deliberate watching without the recommendation trap or many memory-heavy tabs. They use Unhook and a Shorts-to-main-player extension, so compatibility matters.

- Queue Room mode stores lightweight local records in separate Shorts and video lanes and reuses one player tab. It does not preload every Short.
- Classic mode preserves grouped tabs and inactive long-video sleeping. Bounded Shorts preloading is only a later proposal.
- Picks start paused by default. Starting paused (`manualPlay`) and pausing when leaving a tab (`pauseBackground`) are independent controls, both defaulting to on. Returning to a paused tab does not resume it automatically.
- Data stays local; there is no backend, account, analytics, recommendation feed, or remote JavaScript.
- The user's shorthand “v3.2”, “v3.3”, and “v4” refers here to 0.3.2, 0.3.3, and 0.4.0.

## Completed baseline

- v0.3.0: guarded sequential playback; Done, Later, Previous, Skip; themes; keyboard controls; session budgets; bulk actions; history; validated backup restore; schema 3 migration.
- v0.3.1: preserved the user gesture required for the Queue Room shortcut's `sidePanel.open()` call and fixed narrow-panel reflow. Do not reintroduce an awaited lookup before opening the panel from a command.
- v0.3.2: 24 searchable, explained controls shared by the popup and Queue Room; independent playback switches; granular Focus Shield; optional player keys, history, notifications, and badge count; synchronized settings; legacy preference migration; live budgets.
- Native toolbar popup sizing fix: the old `body` width constrained by `100vw` caused circular autosizing and a roughly 151px-wide popup. Explicit `html` dimensions of 420×588 and a filling body fix the root cause. Keep internal scrolling and footer visibility.

Details: [features](FEATURES.md), [architecture](../ARCHITECTURE.md), [changes](../CHANGELOG.md), and [completed v0.3 roadmap](ROADMAP-v0.3.md).

## Git and release state

Workspace: `C:/Users/MateBook X Pro/Documents/Extension_Project` (PowerShell).
Remote: [RayenBHK/QueueTube](https://github.com/RayenBHK/QueueTube), private when last checked.
Branch: `main`, tracking `origin/main`. Worktree was clean before the keyboard-unlock fix. The user authorized committing and pushing `src/content.js`, `tests/content-policy.test.js`, and this checkpoint. Verify completion with `git status --short --branch` and `git log -1 --oneline`; this checkpoint does not assume its own commit or push succeeded.

- [PR #4](https://github.com/RayenBHK/QueueTube/pull/4) was merged into `main` as `ac3073d` on 2026-09-16 with a merge commit; the remote branch `codex/v0.3.2-feature-controls` was deleted after merge.
- `gh` is authenticated as `RayenBHK` with `repo` scope; CI passed on `54d8a44` before merge.
- `main` was checked out locally and fast-forwarded to the merge commit.
- The local store package `dist/queuetube-v0.3.2.zip` (52,894 bytes) still reflects v0.3.2 and is not evidence of publication. No Git tag exists for v0.3.2.

Keep local commits, pushed commits, merged PRs, and published releases distinct. Do not reset user changes or publish/tag as an implied step.

## Verification and how to resume testing

For the local keyboard-unlock fix on 2026-09-16, `node tools/check-extension.mjs` passed all 31 automated tests and 62 release checks; `git diff --check` passed. Version remains 0.3.2 until release preparation. Previously, the merge-ready head `54d8a44` passed 29 automated tests and 62 release checks. The saved settings smoke report passes all 24 controls; browser smoke was not rerun for the documentation-only changes. Native popup measurements were 420×588 in both 1280×800 and 800×600 browser windows, with no horizontal overflow and the footer visible. CI passed on the branch before PR #4 merged.

Evidence on this machine (ignored by Git and not guaranteed on another machine):

- `.artifacts/v0.3.2-settings-smoke.json`
- `.artifacts/v0.3.2-toolbar-1280x800.png` and `.artifacts/v0.3.2-toolbar-800x600.png`
- `.artifacts/v0.3.2-features-dark.png` and `.artifacts/v0.3.2-features-light.png`

From the repository root, with Node.js 22 or newer:

```powershell
node tools/check-extension.mjs
node tools/settings-smoke.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-extension.ps1
```

The first command includes `node --test`; do not rerun the unit suite separately without a reason. The settings smoke requires Chrome for Testing under `.tools/chrome-win64/`. It launches and verifies ownership of a fresh isolated browser before changing test storage. Do not redirect it at the user's browser/profile.

Native popup checks use `chrome.action.openPopup()`, not an ordinary tab with a forced viewport. A tab-only screenshot missed the actual sizing bug. Browser automation does not replace manual Chrome/Brave, scaling, YouTube playback, and Unhook compatibility checks. See [testing](TESTING.md). Its older controlled-playback paragraph still calls the background-pause setting “Manual play only”; use the independent “Pause when leaving a tab” control described in its v0.3.2 section and [features](FEATURES.md).

For the user's existing unpacked install, click Reload in `chrome://extensions` and refresh already-open YouTube tabs. Keep the same source folder; a fresh install is not normally needed.

## OpenDesign: installed, not connected

User preference: use OpenDesign when supported for future product assets, interactive 3D landing pages, photographs/images, videos/animations, and presentations. They explicitly said **not to create these now**. This preference is also saved in `C:/Users/MateBook X Pro/.codex/AGENTS.md` for the shared local Codex setup.

Last integration checks on 2026-09-16:

- Open Design 0.22.2 is installed at `C:/Users/MateBook X Pro/AppData/Local/Programs/Open Design/Open Design.exe`.
- No OpenDesign MCP tool was available in this task. `codex mcp get open-design --json` reported no server entry.
- Codex app and CLI share `C:/Users/MateBook X Pro/.codex/config.toml`; no separate project config exists. The installer attempt left this file byte-for-byte unchanged.
- Backup before the attempt: `C:/Users/MateBook X Pro/.codex/config.before-opendesign-20260916.toml`. Do not dump configuration contents or secrets into chat or this repository.
- The supported installer was attempted once using a hidden process. It failed before registration: `sidecar bootstrap did not leave a ready generation for pid 10388`. The earlier named-pipe `ENOENT` was a nonfatal discovery miss, not the decisive failure.
- No healthy web generation was reached. This is an OpenDesign startup blocker, not evidence of a Codex usage-limit problem. Do not invent a daemon URL, edit guessed MCP paths, reinstall speculatively, or blindly retry.
- Read-only checks were delegated to `opendesign_setup_check` and `codex_connection_check`, both GPT-5.6 Luna/high. Their work is finished; no agent needs resuming.

**Next integration step, only when the user resumes it:** ask them to open OpenDesign normally and confirm its dashboard loads, or report its error. If healthy, retry the supported installer once, then verify registration and list MCP tools before claiming success. Start background helpers with `Start-Process -WindowStyle Hidden`.

Supported executable arguments:

```powershell
& 'C:/Users/MateBook X Pro/AppData/Local/Programs/Open Design/Open Design.exe' --headless --mcp-install codex
```

The installed runtime resolves its own Node/CLI paths and calls `codex mcp add open-design`; do not hand-build a guessed entry. [OpenDesign's Codex installation guide](https://github.com/nexu-io/open-design-agent-plugins/blob/main/docs/INSTALL_CODEX.md) and [OpenAI's MCP documentation](https://developers.openai.com/codex/mcp/) were used for the original investigation. Recheck them if installation behavior changes.

Local ignored evidence: `.artifacts/opendesign-mcp-install.stdout.log`, `.artifacts/opendesign-mcp-install.stderr.log`. The optional `.artifacts/check-opendesign-mcp.mjs` helper has passed a syntax check but has **not** verified a working connection. It initializes the configured bridge and lists tools without calling creative tools. A new task/client restart may be needed to expose newly registered tools.

## Roadmap: one scoped fix implemented locally

[ROADMAP-NEXT.md](ROADMAP-NEXT.md) remains the release proposal. Only the editable-field keyboard-unlock fix described above was implemented; the rest awaits scope selection:

- 0.3.3: reliability, Chrome/Brave/scaling checks, playback compatibility, all-control audit, recovery, keyboard/focus polish, documentation, and release checks.
- 0.4.0: queue search, channel organization, named local queues, per-lane preferences, right-click capture, and file exports.
- Undo removal, resume positions, and duration totals are additional proposals requiring approval. Bounded Shorts preloading, presets, backup reminders, and store submission are later options.

Do not treat “continue” as permission to implement every proposed feature or produce creative assets. Resume the last authorized unfinished task, or ask which scope the user wants when none exists.

## Agent operating notes

The root [AGENTS.md](../AGENTS.md) carries the durable read-first/update rules and user preferences. Caveman full applies to concise chat, not this documentation. Ponytail full favors the smallest correct implementation. Use UI UX Pro Max for UI work, Chrome extensions for extension work, and read each applicable skill before using it. Keep setup/integration subagents bounded, using GPT-5.6 Luna/high where independent checks help; do not delegate trivial work just to consume slots.

Prefer RTK at `C:/Users/MateBook X Pro/.local/bin/rtk.exe`. In this sandbox it can fail with `Cannot determine Claude config directory`; native focused commands are the fallback. Do not change home variables to work around it. Git metadata and global configuration writes can require approval. Use `apply_patch` for file edits and preserve existing configuration.

Before the next handoff, replace stale state above with verified progress, label any tests not rerun, and record outstanding agent assignments or uncommitted work. Checkpoint after milestones rather than waiting until the limit is already exhausted. No handoff can preserve changes that were never saved.
