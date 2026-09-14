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
- Duplicate handling, Later rotation, reordering, durations, budgets, and history outcomes
- Schema 3 migration, guarded playback transitions, and v2/v3 backup validation
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
8. Use **Select picks** to move several items to the top and bottom
9. Remove one item and confirm its badge disappears on YouTube
10. Copy a backup, remove a pick, then restore with **Merge** and confirm the pick returns

## Verify controlled playback

Test playback with at least two Shorts and two long videos:

1. Click the first Short in the Queue Room
2. Confirm QueueTube opens one regular YouTube player tab
3. Confirm the Short does not start until you press play
4. Let the Short finish
5. Confirm the next Short loads in the same tab and remains paused
6. Press `N`; confirm the current Short moves to its lane end and the following Short loads paused
7. Press `W`; confirm QueueTube records a watched outcome and loads the next pick paused
8. Press `X`; confirm QueueTube records a skipped outcome and loads the next pick paused
9. Press `P`; confirm the latest history item returns to the queue and player
10. Finish the Shorts lane and confirm QueueTube stops at a **Start videos** handoff
11. Start videos, finish one, and confirm the next long video uses the same tab and remains paused
12. Press `?` and confirm the player-key guide appears and closes

Switch to another tab while media plays. Confirm QueueTube pauses the hidden YouTube media when **Manual play only** is enabled.

## Verify time budgets

Open the Queue Room and select **10m**, **20m**, **30m**, and a custom whole number from 1 to 180. Confirm the countdown updates each second.

For a short test, change `startedAt` in the `qtSession` value through the extension's service-worker console. Set it earlier than the selected budget, then confirm active media pauses, the Now Playing state becomes **Time is up**, and a new playback request is blocked. Choose ∞ and confirm the current pick becomes ready again.

## Verify themes and density

1. Choose **System**, **Light**, and **Dark** under Controls & protection.
2. Close and reopen the popup and Queue Room after each choice; confirm the selected theme appears before content renders.
3. In System mode, switch the operating-system color preference and confirm QueueTube follows it.
4. Enable **Compact density** and confirm more queue items fit while every action remains named and keyboard reachable.
5. Check both themes at a narrow 320 CSS-pixel panel width and confirm there is no horizontal scrolling.

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
6. Confirm Now Playing states, lane identity, and completion are understandable without color
7. Confirm status changes arrive through the polite live region
8. At 200% and 400% zoom, confirm content reflows without hiding core controls

Enable reduced motion in Windows and confirm hover or state changes do not depend on animation.

## Build and inspect the store package

Create the release ZIP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package-extension.ps1
```

Open `dist/queuetube-v0.3.0.zip`. It must contain only `manifest.json`, `assets/`, and `src/`. It must not contain repository metadata, tests, documentation, store assets, or environment files.

Complete the remaining checks in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) before uploading the ZIP.

## Run the repeatable browser smoke test

Use [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) when validating command-line extension loading. Current branded Chrome builds do not accept the extension-loading flags used by automated tests.

Start an isolated Chrome for Testing profile with QueueTube as the only unpacked extension. Enable a remote-debugging port, then run:

```powershell
node tools/browser-smoke.mjs --port=9228
```

The smoke test clears QueueTube data in that isolated profile. It opens a signed-out YouTube search and covers Ctrl-click capture, queued badges, Later rotation, same-tab playback, paused-next state, bulk order, backup rejection and restore, Dark/Compact presentation, shortcut discovery, Focus Shield, custom budgets, accessible names, panel overflow, and extension console errors. It saves its narrow Queue Room capture under `.artifacts/` and refreshes the real-YouTube store screenshot.

Do not point the smoke test at a normal Chrome profile. The clean profile prevents account details and existing QueueTube data from entering test artifacts.
