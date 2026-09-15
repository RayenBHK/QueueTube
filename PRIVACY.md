<!-- meta.contentType: Conceptual -->
<!-- content plan: docs/plans/documentation-plan.md -->

# Understand QueueTube's privacy policy

QueueTube stores your queue and preferences on your device. It has no QueueTube server, account system, analytics, advertising, or data sale.

Last updated: September 15, 2026

## Data QueueTube handles

QueueTube reads the YouTube link and visible card metadata for videos you deliberately queue. That metadata can include the video's identifier, title, channel name, thumbnail URL, duration, and collection time.

QueueTube also stores your settings, theme choice, viewing-session budget, current QueueTube player state, and watched or skipped history.

Turn off **Save watch history** in the popup's **Features & controls** to stop recording new watched/skipped entries. Existing history remains until you clear it. History is limited to the latest 200 entries.

## How QueueTube stores data

Queue items, history, and settings stay in Chrome's local extension storage on your device. Session budgets and the current player reference remain until Chrome closes.

QueueTube does not use synchronized storage. It does not send stored data to the QueueTube developer or any third party. When you copy or paste a backup, the JSON is handled locally through the clipboard and QueueTube interface; QueueTube does not upload it.

## Requests to YouTube

YouTube receives the normal network requests needed to show YouTube pages and video thumbnails. When you select a queued item, the browser opens its YouTube playback URL.

QueueTube does not add analytics identifiers or send a copy of your queue with those requests. YouTube's own data practices apply to YouTube pages and media.

## Data sharing and sale

QueueTube does not sell, rent, share, or use your data for advertising, credit decisions, or purposes unrelated to organizing your YouTube picks.

## Retention and deletion

QueueTube keeps local queue and history records until you remove them, clear them in the Queue Room, clear the extension's site data, or uninstall the extension.

Use **Clear queue** or bulk Remove to delete waiting picks. Open **History**, then use **Clear history** to delete watched and skipped records. A Replace restore deliberately replaces the stored queue and resets its active playback session after you choose that mode.

## Policy changes

Future releases will update this policy before changing QueueTube's data practices. The repository's version history records policy changes.

## Contact

Open a privacy question through [QueueTube's GitHub Issues](https://github.com/RayenBHK/QueueTube/issues).
