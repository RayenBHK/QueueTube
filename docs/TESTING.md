<!-- meta.contentType: How-to -->
<!-- content plan: plans/documentation-plan.md -->

# Test QueueTube before a release

This guide verifies QueueTube's pure logic, manifest package, browser behavior, memory model, and accessibility before you tag a release.

## Run automated release checks

Install Node.js 22 or newer, then run:

```powershell
node tools/check-extension.mjs
```

The command checks these release requirements:

- URL classification and queue record normalization
- Duplicate handling, reordering, durations, budgets, and history outcomes
- Manifest V3 structure and scoped YouTube access
- Declared files and exact PNG icon dimensions
- External scripts and event handlers on extension pages
- Dynamic code execution and promise-chain regressions
- JavaScript syntax across the shipped source

## Load a clean unpacked build

Test the repository root, not the generated ZIP:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Remove an older unpacked QueueTube copy if its source path differs
4. Click **Load unpacked**
5. Select the QueueTube repository folder
6. Click **Reload** after each code change
7. Refresh any YouTube tab that existed before the reload

Open **Service worker** from the extension card and keep its console visible during the test.

## Verify Queue Room mode

Use a YouTube page that shows at least two Shorts and two long videos:

1. Ctrl-click one Short and one long video
2. Confirm Chrome opens no new tabs
3. Confirm each card shows a **QUEUED** badge
4. Open the QueueTube popup and confirm both counts
5. Click **Queue Room** and confirm each item appears in the correct lane
6. Ctrl-click the same cards and confirm the counts do not change
7. Reorder both lanes with the arrow controls and drag actions
8. Remove one item and confirm its badge disappears on YouTube

## Verify controlled playback

Test playback with at least two Shorts:

1. Click the first Short in the Queue Room
2. Confirm QueueTube opens one regular YouTube player tab
3. Confirm the Short does not start until you press play
4. Let the Short finish
5. Confirm the next Short loads in the same tab and remains paused
6. Press `X` and confirm QueueTube records a skipped outcome
7. Press `P` and confirm the latest history item returns to the queue and player
8. Open a long video and confirm QueueTube reuses the same player tab

Switch to another tab while media plays. Confirm QueueTube pauses the hidden YouTube media when **Manual play only** is enabled.

## Verify time budgets

Open the Queue Room and select **10m**, **20m**, or **30m**. Confirm the countdown updates each second.

For a short test, change `startedAt` in the `qtSession` value through the extension's service-worker console. Set it earlier than the selected budget, then confirm a new playback request returns **Session complete**.

## Verify Focus Shield

Open a QueueTube player page with **Focus Shield** enabled. Confirm related videos, comments, merchandise shelves, and end cards stay hidden.

Turn **Focus Shield** off. Confirm the hidden YouTube sections return without a page reload.

## Verify Classic tabs mode

Change **Collecting mode** to **Classic tabs**, then test:

1. Ctrl-click a Short and a long video
2. Confirm both open in separate QueueTube tab groups
3. Confirm the Shorts group is orange and expanded
4. Confirm the videos group is blue and collapsed
5. Confirm the inactive long-video tab becomes discarded
6. Use the popup buttons to open the first item in each group

Switch back to **Queue Room** after this test.

## Verify keyboard and screen-reader access

Complete the Queue Room test with a keyboard:

1. Press `Tab` through all controls
2. Confirm every focused control has a visible orange outline
3. Activate tabs, playback, movement, removal, settings, and dialogs with `Enter` or `Space`
4. Confirm disabled movement buttons cannot receive actions
5. Confirm the queue and history views announce their tab state
6. Confirm status changes arrive through the polite live region

Enable reduced motion in Windows and confirm hover or state changes do not depend on animation.

## Build and inspect the store package

Create the release ZIP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-extension.ps1
```

Open `dist/queuetube-v0.2.0.zip`. It must contain only `manifest.json`, `assets/`, and `src/`. It must not contain repository metadata, tests, documentation, store assets, or environment files.

Complete the remaining checks in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) before uploading the ZIP.

## Run the repeatable browser smoke test

Use [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) when validating command-line extension loading. Current branded Chrome builds do not accept the extension-loading flags used by automated tests.

Start an isolated Chrome for Testing profile with QueueTube as the only unpacked extension. Enable a remote-debugging port, then run:

```powershell
node tools/browser-smoke.mjs --port=9228
```

The smoke test clears QueueTube data in that isolated profile. It opens a signed-out YouTube search, exercises Ctrl-click capture, verifies the queued badge and Queue Room, switches a Short to a long video in one player tab, checks paused playback and Focus Shield, and fails on extension console errors. It saves its narrow Queue Room capture under `.artifacts/` and refreshes the real-YouTube store screenshot.

Do not point the smoke test at a normal Chrome profile. The clean profile prevents account details and existing QueueTube data from entering test artifacts.
