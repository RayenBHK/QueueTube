# QueueTube agent instructions

## Start here after a model switch or interruption

Read `docs/HANDOFF.md` first. It is the current checkpoint, not an instruction to execute the whole roadmap. Follow the user's latest request, verify live state, and preserve unrelated changes.

## Commands (Node.js 22+)

- Full release check (manifest, PNGs, syntax, no dynamic code / no `.then(` chains, then `node --test`): `node tools/check-extension.mjs`
- Unit suite only: `node --test` (or a single file, e.g. `node --test tests/queue-core.test.js`)
- Package the store ZIP: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-extension.ps1`
- Settings smoke (needs Chrome for Testing under `.tools/chrome-win64/`; launches its own isolated profile): `node tools/settings-smoke.mjs`
- Repeatable browser smoke (needs an isolated CFT profile with remote debugging): `node tools/browser-smoke.mjs --port=9228`

`package.json` only exposes `test`, `check`, `package`; there is no lint/typecheck. CI runs `node tools/check-extension.mjs` only. Prefer `check-extension.mjs` over running the unit suite separately.

## How the extension is wired

- Manifest V3. `src/background.js` is the service worker (module). No framework, no runtime dependencies, no build step. `src/queue-core.js` holds shared pure logic and `DEFAULT_SETTINGS`.
- `src/settings-ui.js` holds `FEATURE_GROUPS`, the single catalog of all user controls shared by popup and side panel. Every `DEFAULT_SETTINGS` key must appear exactly once there; a test enforces this. `src/content.js` keeps its own copy of default settings for the content-script context.
- Persistent state: `chrome.storage.local` (queue, history, settings, schema 3). Session state: `chrome.storage.session` (playback state, player tab, budget).
- Service-worker global scope must not hold mutable queue state; read current storage on every event.
- Tests import `src/*.js` directly via `node:test`; there is no bundler or transpiler.

## Constraints that are easy to violate

- No comments in code unless asked. Write docs/prose in normal prose.
- Do not add runtime dependencies, analytics, remote JavaScript, or `<all_urls>`. Host access stays limited to the three YouTube patterns.
- Extension pages must use external JS only (no inline `<script>` or `on*=` handlers); `check-extension.mjs` fails otherwise.
- `eval`, `new Function`, and `.then(` are banned by the release check — use `async`/`await`.
- Preserve manual-play defaults (`manualPlay`, `pauseBackground`), separate Shorts/video lanes, and the user's existing stored data.
- v0.3.1 shortcut fix: never `await` a lookup before `sidePanel.open()` from a command, or the user gesture is lost.
- Native popup sizing relies on explicit `html` dimensions (420x588), not `body`/`100vw`. Do not reintroduce viewport-based sizing.
- Keep `manifest.json` and `package.json` versions identical; the checker enforces it.

## Working preferences

- Caveman full for concise conversation, Ponytail full for coding. Read applicable skills before using them.
- Prefer RTK for supported shell commands; fall back to native focused commands when it fails.
- Use UI UX Pro Max for interface work and the Chrome extensions skill for extension work when available.
- Use OpenDesign (installed; MCP connection currently blocked — see `docs/HANDOFF.md`) for requested visuals, and do not claim a connection that does not exist. No generation, paid services, uploads, or publishing without the user choosing that work.
- Delegate only bounded, independent setup/integration/investigation work; the main agent owns integration and verification.

## Keep the checkpoint current

- Update `docs/HANDOFF.md` after milestones and before switching models or approaching a limit. Record completed/active work, next steps, blockers, decisions, verification evidence, and Git status; label proposals and unverified claims.
- One current checkpoint, not a transcript. Link feature/architecture/testing/roadmap docs instead of duplicating them.
- Never store credentials, tokens, private queue contents, or config dumps in docs.
- Never reset a dirty worktree, and never assume a local commit is pushed, a PR is merged, or a ZIP is published.