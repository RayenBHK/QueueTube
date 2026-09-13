<!-- meta.contentType: Reference -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Review QueueTube release changes

This changelog records user-facing features, fixes, and compatibility changes for each QueueTube release.

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
