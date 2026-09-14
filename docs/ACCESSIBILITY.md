<!-- meta.contentType: Reference -->
<!-- content plan: plans/documentation-plan.md -->

# Understand QueueTube accessibility

QueueTube targets WCAG 2.1 AA for its popup and Queue Room. The extension uses native controls, visible focus states, text labels, and status announcements so its main workflow does not depend on a mouse, color, or motion.

## Keyboard behavior

- Every popup, queue, history, settings, and dialog action is reachable with `Tab`.
- Queue and history tabs follow the tab pattern and respond to arrow keys, `Home`, and `End`.
- Queue items provide named move-up, move-down, play, remove, and selection controls as alternatives to drag actions.
- Disabled movement controls remain visible but cannot perform an action.
- Native dialogs support Escape and restore focus to their trigger.
- `W`, `N`, `P`, `X`, and `?` player actions do not run inside text fields, selects, or editable regions.

QueueTube player shortcuts are documented in the [README](../README.md#collect-and-watch-picks). They do not run while focus is inside a text field or editable region.

## Screen-reader behavior

- The Queue Room exposes its two views as tabs and tab panels.
- Queue counts and current state use text as well as color.
- Background results and errors are written to a polite live region.
- Icon-only actions include names that identify the item they affect.
- Import, restore, confirmation, and keyboard-help dialogs have visible titles and native dialog semantics.
- The Now Playing deck exposes playback state, lane, position, and next-item context as text.

## Visual behavior

- Interactive targets are at least 44 by 44 CSS pixels where the layout permits direct pointer use.
- Focus uses a high-contrast outline that remains visible in System, Light, and Dark themes.
- Shorts and videos use labels, borders, and lane names in addition to orange and blue.
- The interface respects `prefers-reduced-motion` and removes nonessential transitions.
- Text and control colors were reviewed against the WCAG 2.1 AA contrast thresholds, with forced-colors fallbacks for lane and state indicators.
- The 320-pixel layout reflows without horizontal scrolling; Compact density reduces row height without removing named controls.

## Release verification

The manual keyboard and assistive-state checks live in [docs/TESTING.md](TESTING.md#verify-keyboard-and-screen-reader-access). QueueTube 0.3.0 was exercised in an isolated Chrome for Testing 151 profile at 1280×800 and 430×800 viewports. The browser smoke test also checks visible control names, tab state, live regions, and horizontal overflow.

Report an accessibility defect through [GitHub Issues](https://github.com/RayenBHK/QueueTube/issues). Include the Chrome version, operating system, input method, and assistive technology when applicable.
