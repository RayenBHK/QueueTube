# QueueTube agent handoff

Updated: 2026-09-16. Read this first after a model switch, usage-limit interruption, or a new task in this repository. This is a checkpoint, not a backlog execution order. Verify anything that can change before acting.

## Current stopping point

The user authorized completing the full v0.3.3 roadmap and releasing it. Done: unavailable-video recovery, Queue Room focus preservation, automated 24-control audit, disabled-state/focus alignment, settings smoke, live-YouTube browser smoke, version 0.3.3, packaged ZIP, and release docs. Pending in this task: final `check-extension` re-run after the handoff edit, commit, push, tag, and GitHub release. There are no active subtasks or delegated agents.

What shipped in 0.3.3: `PLAYER_UNAVAILABLE` detection in `src/content.js` plus a worker handler that moves a matching session to `error` with `lastError: video-unavailable` (queue/history untouched, retry via a new pick); `focusTargetAfterQueueChange` in `src/queue-core.js` with capture/restore glue in `src/sidepanel/sidepanel.js`; new `tests/player-recovery.test.js` (worker-level, 4 tests) and `tests/settings-audit.test.js` (all 24 keys round-trip plus invalid rejection); content-policy tests for error-overlay reporting and editable-field unlock; sidepanel disabled/focus-offset alignment. Store screenshot `screenshot-queued-badge-1280x800.png` was refreshed by the browser smoke and visually reviewed (signed-out search, QUEUED badge, no account details).

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
Branch: `main`, tracking `origin/main`. Fix `7b68915` is pushed. This task stages the 0.3.3 code, tests, screenshot, version bump, and docs in one release commit on `main`, pushes it, tags `v0.3.3`, and creates the GitHub release. Verify with `git status --short --branch`, `git log -1 --oneline`, `git tag --list v0.3.3`, and `gh release view v0.3.3`. No store-dashboard upload was performed.

- [PR #4](https://github.com/RayenBHK/QueueTube/pull/4) was merged into `main` as `ac3073d` on 2026-09-16 with a merge commit; the remote branch `codex/v0.3.2-feature-controls` was deleted after merge.
- `gh` is authenticated as `RayenBHK` with `repo` scope; CI passed on `54d8a44` before merge.
- `main` was checked out locally and fast-forwarded to the merge commit.
- The local store package `dist/queuetube-v0.3.2.zip` (52,894 bytes) still reflects v0.3.2 and is not evidence of publication. No Git tag exists for v0.3.2.

Keep local commits, pushed commits, merged PRs, and published releases distinct. Do not reset user changes or publish/tag as an implied step.

## Verification and how to resume testing

For v0.3.3 on 2026-09-16, `node tools/check-extension.mjs` passed all 40 automated tests and 62 release checks. `node tools/settings-smoke.mjs` passed all 24 controls with native 420×588 popup measurements in 1280×800 and 800×600 windows, no overflow, footer visible. `node tools/browser-smoke.mjs --port=9228` passed the full live-YouTube sequence (capture, Later, same-tab playback, natural completion, budgets, Focus Shield, 320px reflow, clean consoles) and refreshed the store screenshot. Previously, the merge-ready head `54d8a44` passed 29 automated tests and 62 release checks; CI passed on the branch before PR #4 merged.

Environment notes: CFT remote debugging only binds when the browser is spawned from Node with `windowsHide: true, stdio: ignore`; PowerShell `Start-Process` launches never opened the DevTools port. The worker target sleeps when idle, so wake it with a YouTube page (or `--extension-id=`) before browser-smoke. Probe orphans were cleaned; no user browser was touched (none was running). The mass `Stop-Process -Name node/chrome` cleanup is a blunt tool; prefer command-line-matched kills next time.

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

## Roadmap: 0.3.3 released, 0.4.0 proposed

[ROADMAP-NEXT.md](ROADMAP-NEXT.md) records v0.3.3 as complete. Remaining user-side manual checks: Brave, display scaling, Unhook compatibility, personal install.

- 0.4.0: queue search, channel organization, named local queues, per-lane preferences, right-click capture, and file exports.
- Undo removal, resume positions, and duration totals are additional proposals requiring approval. Bounded Shorts preloading, presets, backup reminders, and store submission are later options.

Do not treat “continue” as permission to implement 0.4.0 or produce creative assets. Resume the last authorized unfinished task, or ask which scope the user wants when none exists.

## Agent operating notes

The root [AGENTS.md](../AGENTS.md) carries the durable read-first/update rules and user preferences. Caveman full applies to concise chat, not this documentation. Ponytail full favors the smallest correct implementation. Use UI UX Pro Max for UI work, Chrome extensions for extension work, and read each applicable skill before using it. Keep setup/integration subagents bounded, using GPT-5.6 Luna/high where independent checks help; do not delegate trivial work just to consume slots.

Prefer RTK at `C:/Users/MateBook X Pro/.local/bin/rtk.exe`. In this sandbox it can fail with `Cannot determine Claude config directory`; native focused commands are the fallback. Do not change home variables to work around it. Git metadata and global configuration writes can require approval. Use `apply_patch` for file edits and preserve existing configuration.

Before the next handoff, replace stale state above with verified progress, label any tests not rerun, and record outstanding agent assignments or uncommitted work. Checkpoint after milestones rather than waiting until the limit is already exhausted. No handoff can preserve changes that were never saved.
