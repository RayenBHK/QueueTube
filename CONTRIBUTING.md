<!-- meta.contentType: How-to -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Contribute a QueueTube change

This guide explains how to prepare, verify, and document a QueueTube contribution without adding runtime dependencies or broad browser access.

## Prepare your environment

Use Chrome 116 or newer, Git, and Node.js 22 or newer. QueueTube ships browser-native JavaScript, HTML, and CSS.

Create a focused branch from `main`:

```powershell
git switch main
git pull --ff-only
git switch -c feature/describe-the-change
```

## Keep the extension within its boundaries

Follow these project constraints:

- Use Manifest V3 APIs
- Keep host access scoped to YouTube
- Store persistent state in `chrome.storage.local`
- Store browser-session state in `chrome.storage.session`
- Keep mutable state out of the service worker's global scope
- Use external JavaScript files for popup and side-panel pages
- Batch repeated content-script updates with `requestAnimationFrame`
- Preserve manual playback as the default
- Add no analytics, telemetry, or remote JavaScript

Explain any new permission in `CHROMEWEBSTORE.md` and `ARCHITECTURE.md`.

## Verify your change

Run the release checker:

```powershell
node tools/check-extension.mjs
```

Follow the relevant browser scenarios in [the testing guide](docs/TESTING.md). Add a regression test when you change pure queue logic or manifest behavior.

## Update the release documentation

Update these files when behavior changes:

- `README.md`: user-facing features and workflows
- `ARCHITECTURE.md`: data flow, storage, permissions, or failure behavior
- `CHANGELOG.md`: release summary under an unreleased heading
- `CHROMEWEBSTORE.md`: listing copy, permissions, privacy, assets, and version history
- `PRIVACY.md`: stored or transmitted data practices

## Open a pull request

Keep each pull request focused on one problem. Include the user-visible outcome, tests you ran, screenshots for interface changes, and any permission or privacy impact.
