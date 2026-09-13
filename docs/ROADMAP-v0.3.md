<!-- meta.contentType: Planning -->
<!-- content plan: plans/documentation-plan.md -->

# Plan QueueTube v0.3.0

**Status:** Draft for product-owner additions  
**Target:** To be decided after scope review  
**Baseline:** QueueTube v0.2.0  
**Last updated:** September 13, 2026

## Product outcome

QueueTube v0.3.0 should make a saved queue feel like a controlled watching session rather than a list of links. A user should understand what is ready, what is current, what comes next, and which action advances the session without learning hidden behavior.

The release should also add a complete dark theme, expose keyboard controls inside the product, and remove the small points of friction discovered while testing v0.2.0.

## Protect the core promise

Every v0.3.0 decision must preserve these rules:

1. Saving a pick in Queue Room mode opens no YouTube tab.
2. Shorts and long videos remain separate and ordered.
3. QueueTube uses no more than one controlled player tab.
4. Loading the next item never means autoplaying it.
5. The user chooses when playback starts.
6. Queue data, settings, sessions, and history remain local.
7. QueueTube adds no recommendation feed or engagement loop.
8. Host access remains limited to YouTube.
9. New permissions require a feature-specific reason and explicit scope review.
10. The Queue Room remains usable with a keyboard, a screen reader, reduced motion, and narrow side-panel widths.

## Start from observed feedback

| ID | Observation | Type | Priority | v0.3.0 response |
| --- | --- | --- | --- | --- |
| `V3-FB-001` | A filled popup does not clearly explain how to start and continue a sequence. | Usability fix | P0 | Add an explicit session launcher and persistent playback controls. |
| `V3-FB-002` | Chrome can leave every suggested extension shortcut unassigned. | Minor fix | P0 | Show actual shortcut status and setup guidance inside QueueTube. |
| `V3-FB-003` | Long videos require returning to the Queue Room or using a global shortcut after completion. | Workflow gap | P0 | Load the next item in the same lane after completion, still paused. |
| `V3-FB-004` | The interface has only a light appearance. | Major feature | P0 | Add System, Light, and Dark themes through shared design tokens. |
| `V3-FB-005` | `N`, `P`, and `X` are documented but not discoverable at the moment they matter. | Usability fix | P0 | Add visible shortcut help and action labels near the current item. |
| `V3-FB-006` | “Next” can leave the current item without a clear outcome. | Behavior fix | P0 | Define Done, Skip, and Later as separate transitions. |

## Scope the release

### P0: required for v0.3.0

- A durable playback-session state machine
- Same-lane sequence playback for Shorts and long videos
- A Now Playing section with clear progress and next-item context
- Done, Skip, Later, Previous, and Next controls
- Shortcut discovery and assigned-status reporting
- System, Light, and Dark themes
- Safe migration of v0.2.0 data and backups
- Narrow-panel, keyboard, screen-reader, contrast, and reduced-motion support
- Current-YouTube reliability fixes and regression coverage
- Updated store listing, screenshots, privacy review, package, and release notes

### P1: should ship when the P0 gate is stable

- Multi-select and bulk queue actions
- Restore from a QueueTube JSON backup
- Custom session budgets in addition to the preset buttons
- History filtering and one-click restoration
- Clear offline, unavailable-video, and missing-thumbnail states
- A compact-density option for large queues
- Better queue totals, including known time and unknown-duration counts

### P2: stretch work that may move to v0.4.0

- Queue search
- Channel-based grouping and filtering
- Per-lane playback preferences
- Named local sessions such as “Lunch break” or “Weekend watch”
- Additional export formats
- Optional context-menu capture with immediate confirmation

P2 work must not delay the P0 release or expand QueueTube into a recommendation product.

## Define the playback session

The player workflow is the center of v0.3.0. It should use explicit states stored in `chrome.storage.session` so service-worker restarts do not erase the current transition.

### Proposed states

| State | Meaning | Allowed transitions |
| --- | --- | --- |
| `idle` | No QueueTube item is active. | Start a lane or open a specific item. |
| `loading` | The controlled player is navigating. | Become ready, fail safely, or cancel. |
| `ready` | The item is loaded and paused. | User plays, marks Done, chooses Later, skips, or moves elsewhere. |
| `playing` | Playback began through a user action. | Pause, finish, mark Done, choose Later, skip, or hit the budget limit. |
| `advancing` | QueueTube is recording an outcome and selecting the next item. | Load the next item or finish the lane. |
| `lane-complete` | No item remains in the active lane. | Start the other lane, restore history, or end the session. |
| `budget-complete` | The selected time budget reached zero. | Extend the budget or end the session. |
| `error` | Navigation or player coordination failed. | Retry, return the item to the queue, or end the session. |

Transitional states must be locked so double-clicks and fast shortcuts cannot record two outcomes or open two player tabs.

### Sequence behavior

| User or player event | Queue result | Player result | Autoplay |
| --- | --- | --- | --- |
| Start Shorts or Videos | Select the first item in that lane. | Open or reuse one player tab. | Never |
| Media ends | Record Watched and remove it when that setting is enabled. | Load the next item in the same lane, paused. | Never |
| Done | Record Watched. | Load the next item, paused. | Never |
| Skip | Record Skipped. | Load the next item, paused. | Never |
| Later | Keep the item and move it to the end of its lane. | Load the next item, paused. | Never |
| Previous | Restore the most recent applicable history item once. | Load it paused. | Never |
| Lane becomes empty | Preserve the completed session summary. | Stop and show a handoff choice. | Never |
| Budget reaches zero | Preserve the current queue item. | Pause media and show a budget-complete state. | Never |
| Player tab closes | Preserve queue and history data. | Return the session to idle and create a new player only on the next user action. | Never |

### Recommended lane handoff

When the Shorts lane finishes, QueueTube should show **Shorts complete** with a **Start videos** button. It should not silently navigate to the first long video. This keeps the transition deliberate while reducing the work needed to continue.

### Keyboard behavior to confirm

The proposed in-player keys are:

| Key | Proposed action | Outcome |
| --- | --- | --- |
| `N` | Later and next | Move the current item to the end, then load the next item paused. |
| `W` | Done | Record Watched and load the next item paused. |
| `X` | Skip | Record Skipped and load the next item paused. |
| `P` | Previous | Restore the latest completed item and load it paused. |
| `?` | Help | Show or hide the playback shortcut reference. |

QueueTube must ignore these keys inside text fields, editable elements, and modified key combinations. YouTube's own Space and `K` playback controls remain unchanged.

## Redesign the Queue Room around the current item

### Now Playing block

Add a sticky Now Playing block near the top of the side panel with:

- Thumbnail, title, channel, duration, and lane
- A clear `Ready`, `Playing`, `Paused`, or `Complete` state
- Position such as `Short 2 of 8`
- Known time remaining in the lane
- Done, Later, Skip, Previous, and Next actions
- A short reminder that the loaded item will not autoplay
- An error-recovery action when YouTube navigation fails

The block should stay useful at side-panel widths from 320 to 600 CSS pixels and at 200 percent zoom.

### Queue lanes

Keep the existing Shorts and Videos identity, then add:

- Current-item emphasis that does not depend on color
- Remaining-item and known-duration totals
- Multi-select mode for Move, Remove, and Move to other lane where valid
- A compact-density option for queues with many items
- Stable keyboard focus after reorder, deletion, and refresh
- Empty states that offer the correct next action

QueueTube must not allow a YouTube Short to be relabeled as a long video or the reverse. “Move to other lane” is only valid when URL classification supports the destination.

### Popup

Keep the popup small and action-oriented:

- Primary **Continue session** button when an item is current
- **Start Shorts** and **Start Videos** when idle
- Current lane progress and time-budget state
- Warning when important Chrome-wide shortcuts are unassigned
- One clear **Open Queue Room** action

The popup should not become a second queue manager because it closes whenever the user clicks away.

## Add a complete theme system

### Theme choices

- **System:** follow `prefers-color-scheme`; this is the default for new installs
- **Light:** preserve the current paper-and-ink visual direction
- **Dark:** use a deep neutral surface rather than pure black and retain the orange and blue lane identities

### Theme requirements

- Store the preference locally as `theme: "system" | "light" | "dark"`.
- Apply the theme before the first painted frame to avoid a bright flash.
- Use semantic tokens for backgrounds, text, borders, focus, success, warning, Short, and video colors.
- Cover the popup, Queue Room, dialogs, empty states, toasts, badges, preview pages, and store screenshots.
- Meet WCAG 2.1 AA text contrast and non-text contrast in every theme.
- Preserve visible focus, disabled, hover, selected, current, dragged, and error states.
- Respect reduced motion independently of theme.
- Avoid a new manifest permission.

## Make shortcuts understandable

Chrome controls extension-wide shortcut assignment, so QueueTube cannot silently assign keys for the user.

v0.3.0 should:

1. Read actual assignments with `chrome.commands.getAll()`.
2. Show `Assigned` or `Not set` for every QueueTube command.
3. Explain that **Activate the extension** is Chrome's optional built-in action.
4. Show the recommended combinations beside unassigned commands.
5. Offer an **Open shortcut settings** action when Chrome allows navigation to `chrome://extensions/shortcuts`.
6. Fall back to copyable instructions when Chrome blocks that navigation.
7. Re-read shortcut status whenever the popup or Queue Room opens.

The existing suggested commands remain:

- `Alt+Shift+Q`: open Queue Room
- `Alt+Shift+S`: open next Short
- `Alt+Shift+V`: open next video
- `Alt+Shift+X`: skip the current pick

Only four manifest commands should carry suggested keys. Additional player keys stay page-local.

## Improve queue and history tools

### Bulk actions

- Enter multi-select explicitly so normal row clicks still play an item.
- Support Select all in lane, Remove, Move to top, Move to bottom, and Clear selection.
- Require confirmation only for destructive actions affecting multiple items.
- Announce selection count and completion through the live region.

### Backup restoration

v0.2.0 can copy JSON but cannot restore it. v0.3.0 should add a paste-or-file restore flow that:

- Validates the schema before writing storage
- Shows counts for new, duplicate, invalid, and sanitized records
- Offers Merge and Replace as separate choices
- Never evaluates or renders backup content as HTML
- Preserves the existing queue if validation fails
- Migrates supported v0.2.0 backups to the v0.3.0 schema

### History

- Filter by Watched, Skipped, Short, or video
- Restore one entry without creating duplicate identities
- Show session boundaries when available
- Preserve the 200-entry limit unless testing supports a larger value
- Keep Clear history separate from Clear queue

## Evolve storage safely

Introduce an explicit schema version instead of inferring data shape from individual fields.

### Proposed persistent state

| Key | Additions for v0.3.0 |
| --- | --- |
| `qtSchemaVersion` | Integer schema marker with value `3`. |
| `qtSettings` | Theme, compact density, video advance, lane handoff, and custom budget defaults. |
| `qtQueueItems` | Preserve v0.2.0 records; add fields only when a feature needs them. |
| `qtHistory` | Optional session identifier and restoration marker. |

### Proposed session state

| Field | Purpose |
| --- | --- |
| `status` | Persist the playback state machine across service-worker restarts. |
| `playerTabId` | Preserve the single controlled player. |
| `currentItemId` and `currentKind` | Identify the active queue item and lane. |
| `startedAt` and `budgetMinutes` | Preserve the current time budget. |
| `sessionId` | Group outcomes from one deliberate watching session. |
| `transitionToken` | Reject stale completion or double-click responses. |
| `lastError` | Give the interface a recoverable failure message. |

### Migration acceptance criteria

- Migration is idempotent and safe to run after every update.
- Existing v0.2.0 queues, settings, history, and active budgets survive.
- Unknown or malformed values fall back per field without clearing valid data.
- A failed migration leaves the original values recoverable.
- Migration logic has fixtures for clean, partial, large, and malformed v0.2.0 state.
- Backup format version 3 documents compatibility with version 2.

## Harden current YouTube behavior

v0.3.0 should include a dedicated minor-fix lane rather than mixing fixes invisibly into larger features.

### Capture and metadata

- Retest Home, Subscriptions, Search, channel pages, playlists, live cards, and Shorts shelves.
- Keep click interception limited to deliberate Ctrl-click, Command-click, and configured middle-click gestures.
- Continue batching queued-badge work across animation frames.
- Avoid rescanning unchanged cards during infinite scroll.
- Show a neutral fallback when title, duration, channel, or thumbnail metadata is missing.

### Player coordination

- Reset the manual-play lock on every QueueTube navigation, including warm single-page transitions.
- Reject stale ended events from an older item or player tab.
- Prevent concurrent Next, Done, Skip, and Later actions.
- Recover when YouTube redirects, reports an unavailable video, or replaces the media element.
- Treat a user-closed player as recoverable rather than recreating it immediately.

### Multiple windows

- Keep one Queue Room instance per Chrome window.
- Document whether a session's player follows its original window or the most recently focused one.
- Never update or close an unrelated YouTube tab.
- Include at least one two-window browser test before release.

## Accessibility and responsive acceptance

The v0.3.0 interface is not complete until it passes all of these checks:

- All actions work without drag and without a pointer.
- Focus remains visible and moves predictably after DOM updates.
- Tabs support Arrow Left, Arrow Right, Home, and End.
- Dialogs receive focus, close with Escape, and restore focus to their trigger.
- Dynamic status, selection count, sequence progress, and errors are announced politely.
- Current, selected, watched, and skipped states use text or shape in addition to color.
- Interactive targets are at least 44 by 44 CSS pixels when directly tapped.
- Text and controls meet WCAG 2.1 AA contrast in Light, Dark, and System modes.
- The popup works at 400 percent zoom without clipping essential actions.
- The side panel works from 320 to 600 CSS pixels and at 200 percent zoom.
- Reduced-motion mode removes nonessential movement and countdown animation.
- Windows high-contrast mode keeps controls and focus indicators visible.

## Performance budgets

| Area | Release target |
| --- | --- |
| Queue capture | No new tab in Queue Room mode and no long task caused by QueueTube. |
| Player tabs | Zero while collecting and no more than one while watching. |
| Side-panel first render | Render stored state without fetching every YouTube page. |
| Large queue | Reorder, select, and remove remain responsive with 500 records. |
| YouTube DOM work | Process only candidate cards in bounded batches and yield between batches. |
| Service worker | Store durable state outside global variables and survive worker termination between actions. |
| Storage | Remain below local-storage quotas under the documented history limit. |

QueueTube will not add analytics to measure these targets. Release evidence comes from automated timings, controlled fixtures, browser traces, and manual acceptance checks.

## Architecture work

| Work item | Purpose | Size | Dependency |
| --- | --- | --- | --- |
| `V3-ARCH-01` | Add pure playback-state transitions and transition-token validation. | L | Approved sequence rules |
| `V3-ARCH-02` | Add idempotent schema migration and v2 backup compatibility. | M | State model |
| `V3-ARCH-03` | Separate Queue Room rendering, actions, shortcuts, and theme modules. | L | UI wireframe |
| `V3-ARCH-04` | Add semantic design tokens shared by popup, panel, dialogs, and previews. | M | Theme direction |
| `V3-ARCH-05` | Narrow YouTube DOM observation and preserve batched badge updates. | M | Current markup fixtures |
| `V3-ARCH-06` | Extend the browser smoke harness for sequencing, migration, themes, and multiple windows. | L | State and UI implementation |

The implementation should remain browser-native JavaScript unless a concrete problem justifies a build system. New runtime dependencies are out of scope by default.

## Test the release in layers

### Logic tests

- Every playback-state transition and invalid transition
- Done, Skip, Later, Previous, lane completion, and budget completion
- Duplicate identities and history restoration
- Schema migration and backup validation
- Custom budget parsing and expiry
- Queue filtering, selection, and bulk operations

### Static release checks

- Manifest V3 and version 0.3.0
- Exact permission and YouTube host allowlists
- Local entry points, icon dimensions, and store-asset dimensions
- No inline script, inline event handler, remote executable code, `eval`, or promise-chain regression
- Canonical ZIP paths and package allowlist

### Browser smoke tests

- Capture a Short and a long video from current YouTube
- Verify no capture tab opens
- Start a lane, finish an item, and confirm the next item loads paused in the same tab
- Exercise Done, Skip, Later, Previous, and lane completion
- Confirm a budget expiry pauses playback and preserves the item
- Confirm Light, Dark, and System rendering
- Confirm shortcut assignment status is read correctly
- Confirm no popup, panel, content-script, or service-worker errors
- Repeat player recovery after closing the controlled tab
- Repeat the core sequence across two Chrome windows

### Manual acceptance matrix

Test current Chrome Stable on Windows first, then cover macOS or Linux before publishing when a test host is available. Include signed-out YouTube, signed-in YouTube without exposing account data in artifacts, narrow and wide panels, 200 and 400 percent zoom, keyboard-only use, reduced motion, and high contrast.

## Deliver in gated phases

| Gate | Work | Exit condition |
| --- | --- | --- |
| `G0: Scope` | Add owner feedback, classify fixes and features, settle open decisions. | P0 list and sequence semantics approved. |
| `G1: Foundation` | State machine, schema migration, pure tests, design tokens. | Migration fixtures and state transitions pass. |
| `G2: Sequence` | Same-tab advancement, outcomes, lane completion, recovery. | Live browser sequence passes with autoplay count equal to zero. |
| `G3: Experience` | Now Playing, popup changes, shortcut onboarding, themes, responsive states. | Accessibility and viewport matrix passes. |
| `G4: Tools` | Bulk actions, restore backup, history filters, custom budgets. | P1 acceptance tests pass or remaining work is moved explicitly. |
| `G5: Release` | Regression pass, docs, listing, screenshots, package, PR, tag. | CI and Chrome smoke pass; store checklist is complete. |

Do not begin G4 while a P0 sequence or migration defect remains open.

## Track work by priority

| ID | Deliverable | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| `V3-001` | Confirm sequence and key semantics | P0 | S | Proposed |
| `V3-002` | Playback state machine | P0 | L | Proposed |
| `V3-003` | v0.2.0 to v0.3.0 migration | P0 | M | Proposed |
| `V3-004` | Same-lane paused advancement for videos and Shorts | P0 | L | Proposed |
| `V3-005` | Done, Skip, Later, Previous, and recovery actions | P0 | L | Proposed |
| `V3-006` | Now Playing side-panel block | P0 | L | Proposed |
| `V3-007` | Popup Continue and Start actions | P0 | M | Proposed |
| `V3-008` | Shortcut status and onboarding | P0 | M | Proposed |
| `V3-009` | System, Light, and Dark theme tokens | P0 | L | Proposed |
| `V3-010` | Responsive and accessibility hardening | P0 | M | Proposed |
| `V3-011` | YouTube capture and player reliability fixes | P0 | L | Proposed |
| `V3-012` | v0.3.0 test and release automation | P0 | L | Proposed |
| `V3-013` | Multi-select and bulk actions | P1 | L | Proposed |
| `V3-014` | Restore and validate JSON backup | P1 | L | Proposed |
| `V3-015` | Custom budgets and budget-complete state | P1 | M | Proposed |
| `V3-016` | History filters and safe restoration | P1 | M | Proposed |
| `V3-017` | Compact density and large-queue polish | P1 | M | Proposed |
| `V3-018` | Missing and unavailable metadata states | P1 | M | Proposed |
| `V3-019` | Queue search | P2 | M | Backlog |
| `V3-020` | Channel grouping and filters | P2 | L | Backlog |
| `V3-021` | Named local sessions | P2 | L | Backlog |
| `V3-022` | Context-menu capture | P2 | M | Backlog |

Sizes are relative: S is isolated, M spans several components, and L changes shared behavior or state.

## Manage release risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| YouTube starts media during a warm page transition. | Breaks the manual-play promise. | Reset the lock per item, pause on media events, and assert zero autoplay starts in the live test. |
| Two fast actions race. | Duplicate history or two navigations. | Persist transitional state and reject stale transition tokens. |
| Chrome terminates the service worker. | Session controls appear to reset. | Keep all durable and ephemeral state in the correct Chrome storage area. |
| YouTube changes card markup. | Missing capture metadata or badges. | Use bounded selectors, safe fallbacks, and current-page smoke fixtures. |
| Shortcut is unassigned or conflicts. | User cannot discover or use the command. | Display actual assignment state and clear setup instructions. |
| Dark theme introduces low contrast. | Controls become hard to read or locate. | Use tokens, automated contrast checks where practical, and manual WCAG review. |
| Migration encounters malformed local data. | Existing queue could be lost. | Validate per field, preserve a recoverable copy, and make migration idempotent. |
| New UI expands resource use. | QueueTube weakens its memory benefit. | Keep metadata local, avoid page preloading, and enforce the one-player invariant. |
| Feature requests broaden the single purpose. | Store-review risk and product drift. | Test every addition against the core promise and explicit non-goals. |

## Keep these items out of v0.3.0

- Automatic playback without a direct user action
- A recommendation or discovery feed
- YouTube account scraping or subscription synchronization
- Video or audio downloading
- Ad blocking
- Cloud accounts, cloud queue sync, or developer analytics
- Mobile-browser support claims
- Broad access to websites other than YouTube
- AI-generated recommendations or summaries

These ideas require a separate product and privacy review rather than entering the roadmap as minor additions.

## Decisions for the product owner

| Decision | Recommended default | Status |
| --- | --- | --- |
| What should `N` do? | Move the current item to Later, then load the next item paused. | Needs confirmation |
| Should completed long videos load the next video? | Yes, load it paused as Shorts do. | Needs confirmation |
| What happens after the Shorts lane ends? | Stop and show a Start videos handoff button. | Needs confirmation |
| Which theme should a new install use? | System. | Needs confirmation |
| Should budget time count while the player is paused? | Count active session wall time until the budget is paused explicitly. | Needs confirmation |
| Should Classic Mode gain new features? | Preserve and fix it, but invest new playback work in Queue Room. | Needs confirmation |
| Are P1 bulk tools part of v0.3.0 or the next release? | Include restore backup and custom budgets; move the rest if P0 slips. | Needs confirmation |

## Add new requests here

Add each idea before implementation so it can be sized, ordered, and tested against the product promise.

### Request template

| Field | Entry |
| --- | --- |
| Short name | |
| Type | Minor fix, major fix, enhancement, or experiment |
| Repetitive frustration | |
| Desired outcome | |
| Current behavior | |
| Suggested behavior | |
| Priority | P0, P1, P2, or undecided |
| Evidence | Screenshot, reproduction steps, or example |
| Dependencies | |
| Acceptance test | |

### Intake queue

| Intake ID | Short name | Type | Priority | Decision | Roadmap item |
| --- | --- | --- | --- | --- | --- |
| `V3-IN-001` | | | | Unreviewed | |
| `V3-IN-002` | | | | Unreviewed | |
| `V3-IN-003` | | | | Unreviewed | |
| `V3-IN-004` | | | | Unreviewed | |
| `V3-IN-005` | | | | Unreviewed | |

## Definition of done

QueueTube v0.3.0 is complete only when:

- Every P0 item has an acceptance test and is closed.
- No known issue can open a second controlled player tab or start playback automatically.
- Existing v0.2.0 local data migrates without loss.
- Light, Dark, and System modes pass the accessibility matrix.
- Chrome-wide shortcut status matches `chrome://extensions/shortcuts`.
- The package requests no unreviewed permission or host.
- Automated logic, manifest, package, migration, and live-browser checks pass.
- Popup, side panel, content script, and service worker report no runtime errors.
- Documentation, privacy disclosures, store copy, screenshots, and changelog match the shipped behavior.
- The release ZIP contains only the manifest, icons, and runtime source.
- A reviewed pull request is merged before the `v0.3.0` tag and release are created.
