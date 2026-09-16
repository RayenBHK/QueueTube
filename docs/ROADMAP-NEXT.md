# QueueTube: next releases

Status: Saved proposal for the user's additions, not authorization to implement every item.
Baseline: v0.3.2, including the native toolbar popup sizing fix.

## v0.3.3: reliability and polish

1. Verify Chrome/Brave toolbar behavior, small screens, and display scaling.
2. Align popup and Queue Room spacing, typography, switches, and disabled states.
3. Verify tab switching, background listening, Shorts transitions, and Unhook compatibility.
4. Audit all 24 controls on/off, live updates, and backup restoration.
5. Harden restart, computer sleep, closed-player, and unavailable-video recovery.
6. Preserve keyboard focus after queue changes and avoid editable-control shortcut conflicts.
7. Complete manual checks, refresh documentation/screenshots, and prepare the reviewed release.

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
