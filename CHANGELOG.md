<!-- meta.contentType: Reference -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Review QueueTube release changes

This changelog records user-facing features, fixes, and compatibility changes for each QueueTube release.

## 0.3.2: 2026-09-15

### Added

- Redesigned popup with queue and searchable Features & controls views, 24 explained preferences, live saving, and a prominent pause-on-tab-switch control
- Independent switches for starting each pick paused and pausing when its tab becomes hidden
- Individual Focus Shield controls for related videos, comments, end cards, and merchandise
- Switches for player keyboard controls, new history recording, routine notifications, and the toolbar count
- One shared feature catalog for the popup and Queue Room, including previously hidden Shorts-player and Classic sleeping settings
- Automated playback-policy regressions and an isolated Chrome settings smoke test

### Fixed

- Toolbar popup no longer collapses to its initial viewport width; explicit root sizing keeps cards and labels readable, with scrolling inside the content area
- Browser verification now opens the native toolbar popup instead of relying only on a tab with emulated dimensions
- Concurrent preference changes no longer overwrite each other
- Previously queued picks honor current Shorts-player and manual-start preferences when reopened
- Session time limits update the running timer and persist as the next session's default
- Legacy manual-play choices survive the split into independent controls; backup schema remains 3

### Compatibility

- No new permissions, network services, or analytics
- Refresh existing YouTube tabs after reloading the extension to load the updated content script

## 0.3.1: 2026-09-14

### Fixed

- Queue Room now opens reliably from its Chrome keyboard shortcut without losing the required user gesture during an asynchronous window lookup
- Queue Room selection mode now reflows without horizontal scrolling at a 320 CSS-pixel panel width
- Browser smoke testing now selects QueueTube's exact service worker when Chrome has built-in extension workers and reads the expected version from the manifest

### Preserved

- No new permissions, host access, data collection, or storage migrations

## 0.3.0: 2026-09-14

### Added

- Guarded playback state machine with per-navigation tokens and stale-event rejection
- Same-lane paused advancement for both Shorts and long videos
- Now Playing deck with state, lane position, next context, Focus, Previous, Done, Later, and Skip
- Deliberate Shorts-to-Videos lane handoff
- `W` Done, `N` Later, `P` Previous, `X` Skip, and `?` help on controlled player pages
- Live Chrome shortcut-assignment status and shortcut-settings launcher
- System, Light, and Dark themes plus optional compact density
- Custom 1–180 minute session budgets and an enforced budget-complete state
- Multi-select Move top, Move bottom, and Remove actions
- Validated v2/v3 JSON backup restore with Merge and Replace modes
- Watched, skipped, Short, and video history filters with per-item restoration
- Schema 3 migration for v0.2 queue, history, settings, and session data

### Changed

- Natural completion and Done now record the current pick before loading the next one paused
- `N` now means Later instead of silently moving forward
- The toolbar popup prioritizes Continue when a controlled player exists
- Queue and player writes use separate browser locks to prevent double outcomes and duplicate player tabs
- Browser smoke coverage now includes v0.3 sequencing, restore, bulk actions, themes, accessibility state, and custom budgets

### Preserved

- No new permissions or host access
- No server, analytics, account, remote code, or synchronized storage
- Classic grouped-tab mode remains available without expanding its scope

## 0.2.0: 2026-09-13

### Added

- Persistent Queue Room side panel with separate Shorts and video lanes
- Lightweight queue records that avoid opening one tab per pick
- One reusable, manually controlled YouTube player tab
- Short auto-advance that loads the next item without autoplay
- Thumbnails, titles, channels, durations, removal, drag reorder, and keyboard reorder
- 10, 20, and 30 minute session budgets
- Local watched and skipped history
- Focus Shield for related videos, comments, merchandise, and end cards
- Queue badges on YouTube cards
- Existing-tab import with an optional close-after-import action
- JSON clipboard backup
- Chrome Web Store metadata, privacy policy, release packaging, and continuous integration checks

### Changed

- Queue Room mode is now the default collecting workflow
- The toolbar popup now opens the persistent Queue Room and starts either lane
- Shorts and long videos share one QueueTube player tab
- Automated coverage increased from 6 to 16 tests

### Preserved

- Classic grouped-tab mode remains available in settings
- Shorts can still use the regular YouTube player
- Inactive long-video tabs still become discardable in Classic Mode

## 0.1.0: 2026-09-13

### Added

- Ctrl-click and middle-click capture on YouTube
- Separate orange Shorts and blue video tab groups
- Manual playback protection
- Automatic discard attempts for inactive long videos
- URL normalization, playlist isolation, duplicate prevention, and toolbar shortcuts
