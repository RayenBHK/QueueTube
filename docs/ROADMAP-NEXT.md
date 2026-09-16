# QueueTube: next releases

Status: Saved proposal for the user's additions, not authorization to implement every item.
Baseline: v0.3.2, including the native toolbar popup sizing fix.

Progress: v0.3.3 is complete and released. Automated, settings-smoke, and live-YouTube browser-smoke checks all passed. Remaining manual checks (Brave, display scaling, Unhook, personal install) are user-side.

## v0.3.3: reliability and polish

1. Verified toolbar behavior, small screens, and popup sizing through automation (native 420×588 popup, 320px Queue Room, no overflow); Brave/scaling manual checks pending.
2. Aligned focus outlines, disabled-action treatment, and shared switch tokens; distinct popup/Room type scales intentionally preserved.
3. Verified tab switching, background listening, Shorts transitions, and natural completion through automation and live-YouTube smoke; Unhook manual check pending.
4. Audited all 24 controls through the worker settings path with invalid-value rejection, plus live sync and backup restore in browser smoke.
5. Hardened unavailable-video recovery (Needs-attention state with retry/skip); restart, sleep/budget, and closed-player paths verified by design and covered by recovery tests.
6. Preserved keyboard focus across Queue Room re-renders; editable-field shortcut conflicts fixed.
7. Documentation, screenshots, and reviewed release completed.

Release gate: no known broken controls, accidental playback, lost picks, or collapsed layouts.

## v0.4.0: larger-queue organization

Existing backlog:

- Queue search by title/channel.
- Channel filters and grouping without losing saved order.
- Named local queues, each retaining Shorts/video lanes.
- Per-lane manual-start and background-listening preferences.
- Right-click capture with confirmation and permission review.
- Downloadable JSON and plain-text link exports.

Additional proposals requiring product-owner approval:

- Resume positions for long videos.
- Undo accidental removal.
- Known-duration totals with clearly identified unknown durations.

Recommended priority: reliability, queue search, undo, resume position, then named queues.

## Later, optional

- Bounded Short preloading while long videos remain unloaded.
- Playback preference presets.
- User-selected backup reminders.
- Chrome Web Store submission after privacy/support requirements are complete.

## Boundaries

Keep local-first storage, separate lanes, manual playback by default, no recommendation feed, and no analytics. The original detailed planning record remains in ROADMAP-v0.3.md; this file records the newer proposed release split.
