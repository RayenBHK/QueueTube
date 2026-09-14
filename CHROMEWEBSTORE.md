<!-- meta.contentType: Reference -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Prepare QueueTube for the Chrome Web Store

This document contains copy-ready listing text, permission reasons, privacy disclosures, assets, and submission status for QueueTube 0.3.0.

> Last updated: 2026-09-14

## Store listing

**Extension name**

QueueTube

**Short description**

Save YouTube picks into focused Shorts and video queues without opening memory-heavy tabs.

**Detailed description**

QueueTube saves the YouTube videos you choose into separate Shorts and long-video queues without opening a new tab for every pick.

FEATURES
• Keep Shorts and long videos in separate, ordered lanes
• Save picks with Ctrl-click, Command-click, or middle-click
• Watch the queue through one reusable YouTube player tab
• Keep every queued video paused until you press play
• Load the next Short or long video in the same player without autoplay
• Use Done, Later, Previous, and Skip controls from the Queue Room or keyboard
• See the current pick, lane position, next item, and playback state
• Hide related videos, comments, merchandise, and end cards with Focus Shield
• Set a preset or custom viewing budget up to 180 minutes
• Use System, Light, or Dark theme and optional compact density
• Bulk reorder or remove picks and restore validated local backups
• Filter local watched and skipped history and restore individual picks
• Import open YouTube tabs, with an option to close imported tabs
• Return to grouped sleeping tabs with optional Classic Mode

HOW TO USE
1. Browse YouTube Home or Subscriptions
2. Ctrl-click, Command-click, or middle-click a video or Short
3. Click the QueueTube toolbar button
4. Open the Queue Room
5. Choose a pick and press play when you are ready

PRIVACY
QueueTube has no account, analytics, advertising, or QueueTube server. Your queue, preferences, and QueueTube history stay on your device. YouTube receives the normal requests needed to show thumbnails and play videos.

PERMISSIONS
QueueTube accesses YouTube pages to recognize the links you deliberately select, keep controlled playback paused, mark queued cards, and apply Focus Shield. Browser tab access supports one reusable player, optional tab import, and Classic Mode.

SUPPORT
Report defects or request features at https://github.com/RayenBHK/QueueTube/issues

QueueTube is an independent project. It is not affiliated with or endorsed by YouTube or Google.

Version 0.3.0 adds reliable paused sequencing for both lanes, Now Playing controls, player keys, shortcut setup, themes, bulk tools, validated backup restore, custom budgets, and filtered history.

**Category**

Productivity

**Single purpose**

Organizes deliberately selected YouTube videos into focused Shorts and long-video queues for controlled playback.

**Primary language**

English

## Graphics and assets

| Asset | Dimensions | Status | Filename |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Ready | `assets/icon128.png` |
| Screenshot 1 | 1280×800 PNG | Ready | `store-assets/screenshot-queue-room-1280x800.png` |
| Screenshot 2 | 1280×800 PNG | Ready | `store-assets/screenshot-queued-badge-1280x800.png` |
| Small promo tile | 440×280 PNG | Ready | `store-assets/small-promo-440x280.png` |
| Marquee promo tile | 1400×560 PNG | Not required | |

### Screenshot notes

Screenshot 1 shows the v0.3 Dark Queue Room beside a neutral YouTube-style browsing surface. It demonstrates Now Playing, explicit sequence controls, separate lanes, a custom time budget, one-tab playback, and zero-memory long videos.

Screenshot 2 shows QueueTube's queued badge on a current, signed-out YouTube results page. The isolated test profile contains no account details.

## Permission justifications

| Permission | Type | Justification |
| --- | --- | --- |
| `storage` | permissions | Saves the user's queue, QueueTube history, preferences, current player reference, and time budget on their device so the queue survives panel and browser events. |
| `tabs` | permissions | Finds or updates the single QueueTube player tab, reads eligible YouTube tab titles during a user-requested import, and supports the optional grouped-tab workflow. |
| `tabGroups` | permissions | Places Shorts and long videos into separate named groups only when the user enables Classic Mode. |
| `sidePanel` | permissions | Displays the persistent Queue Room beside YouTube while the user browses and watches selected items. |
| `https://www.youtube.com/*` | host_permissions | Recognizes selected YouTube video links, keeps QueueTube playback manual, marks queued cards, and hides related content when Focus Shield is enabled. |
| `https://youtube.com/*` | host_permissions | Applies the same QueueTube behavior when YouTube uses its bare domain. |
| `https://m.youtube.com/*` | host_permissions | Applies the same QueueTube behavior when a selected or redirected link uses YouTube's mobile hostname. |

## Privacy and data use

### Data collection

**Does the extension collect user data?** No. QueueTube processes and stores queue records locally. It does not transmit those records to the developer or a third party.

| Data type | Handled locally? | Transmitted off-device by QueueTube? | Purpose | Shared with third parties? |
| --- | --- | --- | --- | --- |
| Personally identifiable information | No | No | Not used | No |
| Health information | No | No | Not used | No |
| Financial information | No | No | Not used | No |
| Authentication information | No | No | Not used | No |
| Personal communications | No | No | Not used | No |
| Location | No | No | Not used | No |
| Web history | Selected YouTube links only | No | Build the user's local queue and QueueTube history | No |
| User activity | QueueTube actions only | No | Preserve queue order, outcomes, and session controls | No |
| Website content | Selected card title, channel, thumbnail, and duration | No | Render the local Queue Room without opening each video | No |

### Data use certification

- [x] Data is not sold to third parties
- [x] Data is not used for purposes unrelated to QueueTube's single purpose
- [x] Data is not used for creditworthiness or lending purposes

QueueTube does not use synchronized browser storage. YouTube receives normal image, page, and media requests when Chrome displays YouTube content.

## Privacy policy

**Privacy policy URL**

https://rayenbhk.github.io/QueueTube/privacy.html

The public page source is `docs/privacy.html`. Verify the deployed URL before submission.

## Distribution

**Visibility**: Public

**Regions**: All regions

## Developer information

**Publisher name**

Rayen BHK

**Contact email**

Required before submission: add a monitored public support email in the Chrome Developer Dashboard and this document.

**Support URL**

https://github.com/RayenBHK/QueueTube/issues

**Homepage URL**

https://github.com/RayenBHK/QueueTube

## Version history

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 0.3.0 | 2026-09-14 | Paused sequencing, Now Playing, player keys, shortcut onboarding, themes, bulk/restore tools, custom budgets, and history filters | Release candidate verified |
| 0.2.0 | 2026-09-13 | Queue Room, one-tab playback, time budgets, local history, Focus Shield, tab import, and release tooling | Ready for dashboard upload |
| 0.1.0 | 2026-09-13 | Initial grouped-tab prototype | Not submitted |

## Pre-publish review

### Package and behavior

- [x] Manifest V3 with version 0.3.0
- [x] Manifest name and short description match this listing
- [x] Host access stays scoped to YouTube
- [x] Every permission has a feature-specific reason
- [x] Local files and icon dimensions pass automated checks
- [x] Package script excludes repository, tests, docs, and store assets
- [x] No remote JavaScript, analytics, obfuscation, or synchronized storage
- [x] Complete the final unpacked-extension test on current YouTube with Chrome for Testing 151
- [x] Confirm popup, side panel, service worker, and content-script consoles have no errors

### Listing and account

- [x] Store icon is current
- [x] Two current 1280×800 screenshots are ready
- [x] Small promo tile is ready
- [x] Capture the real-YouTube screenshot after final browser testing
- [ ] Verify the public privacy-policy URL
- [ ] Add and verify a monitored public contact email
- [ ] Upload `dist/queuetube-v0.3.0.zip` through the Chrome Developer Dashboard

## Review notes

### Known limitations

- Some YouTube cards do not expose a duration before playback. QueueTube leaves that duration blank.
- Live and premiere cards have no fixed duration for budget totals.
- YouTube can change card markup. QueueTube falls back to the video identifier and a standard thumbnail when metadata is unavailable.
- Chrome decides when a Classic Mode tab can be discarded. QueueTube marks eligible tabs and requests discard while they are inactive.

### Rejection history

No submissions or rejections.
