import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  HISTORY_OUTCOMES,
  PLAYBACK_STATES,
  QUEUE_KINDS,
  SCHEMA_VERSION,
  addQueueItem,
  classifyYouTubeUrl,
  createSession,
  createQueueItem,
  deferQueueItem,
  formatDuration,
  getNextItem,
  historyEntry,
  isBudgetExpired,
  migratePersistentState,
  normalizeQueueUrl,
  parseDurationText,
  queueKey,
  remainingBudgetMs,
  removeQueueItem,
  reorderQueueItem,
  restoreBackupPayload,
  sanitizeSettings,
  totalDurationSeconds,
  transitionSession
} from "../src/queue-core.js";

test("classifies Shorts, ordinary videos, live links, and shortened URLs", () => {
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/shorts/abc123")?.kind, QUEUE_KINDS.SHORT);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/watch?v=xyz789")?.kind, QUEUE_KINDS.VIDEO);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/live/live123")?.videoId, "live123");
  assert.equal(classifyYouTubeUrl("https://youtu.be/tiny123")?.videoId, "tiny123");
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/feed/subscriptions"), null);
});

test("opens Shorts in the regular player while preserving their queue kind", () => {
  const result = normalizeQueueUrl("https://www.youtube.com/shorts/abc123?feature=share", { shortsInPlayer: true });
  const url = new URL(result.url);
  assert.equal(result.kind, QUEUE_KINDS.SHORT);
  assert.equal(url.pathname, "/watch");
  assert.equal(url.searchParams.get("v"), "abc123");
  assert.equal(url.searchParams.get("autoplay"), "0");
  assert.equal(url.searchParams.get("qt_queue"), "1");
  assert.equal(url.searchParams.get("qt_kind"), QUEUE_KINDS.SHORT);
  assert.equal(queueKey(result.url), "short:abc123");
});

test("can keep the native Shorts page", () => {
  const result = normalizeQueueUrl("https://www.youtube.com/shorts/abc123", { shortsInPlayer: false });
  assert.equal(new URL(result.url).pathname, "/shorts/abc123");
});

test("detaches a selected video from playlist autoplay", () => {
  const result = normalizeQueueUrl("https://www.youtube.com/watch?v=xyz789&list=PL123&index=4&t=90");
  const url = new URL(result.url);
  assert.equal(url.searchParams.get("v"), "xyz789");
  assert.equal(url.searchParams.get("t"), "90");
  assert.equal(url.searchParams.has("list"), false);
  assert.equal(url.searchParams.has("index"), false);
  assert.equal(url.searchParams.get("autoplay"), "0");
});

test("creates a sanitized metadata record without allocating a tab", () => {
  const item = createQueueItem(
    "https://www.youtube.com/watch?v=xyz789",
    { title: "  Useful   video  ", channel: " Maker ", durationText: "12:34" },
    42
  );
  assert.deepEqual(
    { id: item.id, title: item.title, channel: item.channel, duration: item.durationSeconds, addedAt: item.addedAt },
    { id: "video:xyz789", title: "Useful video", channel: "Maker", duration: 754, addedAt: 42 }
  );
  assert.equal(new URL(item.playbackUrl).searchParams.get("qt_item"), item.id);
});

test("parses and formats queue durations", () => {
  assert.equal(parseDurationText("1:02"), 62);
  assert.equal(parseDurationText("1:02:03"), 3723);
  assert.equal(parseDurationText("LIVE"), null);
  assert.equal(parseDurationText("1:88"), null);
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(62), "1:02");
});

test("blocks duplicates and preserves independent lane order", () => {
  const shortA = createQueueItem("https://www.youtube.com/shorts/a", { title: "A" }, 1);
  const shortB = createQueueItem("https://www.youtube.com/shorts/b", { title: "B" }, 2);
  const video = createQueueItem("https://www.youtube.com/watch?v=c", { title: "C" }, 3);
  let items = addQueueItem([], shortA).items;
  items = addQueueItem(items, video).items;
  items = addQueueItem(items, shortB).items;
  const duplicate = addQueueItem(items, shortA);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.item.id, shortA.id);
  const reordered = reorderQueueItem(items, shortB.id, 0);
  assert.deepEqual(reordered.map((item) => item.id), [shortB.id, shortA.id, video.id]);
  assert.equal(getNextItem(reordered, QUEUE_KINDS.SHORT, shortB.id)?.id, shortA.id);
  assert.equal(removeQueueItem(reordered, shortB.id).length, 2);
});

test("gives allowed duplicate picks independent controls", () => {
  const original = createQueueItem("https://www.youtube.com/watch?v=repeat", { title: "First" }, 1);
  const duplicate = createQueueItem("https://www.youtube.com/watch?v=repeat", { title: "Second" }, 2);
  const first = addQueueItem([], original, { preventDuplicates: false });
  const second = addQueueItem(first.items, duplicate, { preventDuplicates: false });

  assert.equal(second.added, true);
  assert.notEqual(second.item.id, original.id);
  assert.equal(second.item.key, original.key);
  assert.equal(new URL(second.item.playbackUrl).searchParams.get("qt_item"), second.item.id);
  assert.equal(removeQueueItem(second.items, second.item.id).length, 1);
});

test("moves a Later item to the end and selects the following item", () => {
  const first = createQueueItem("https://www.youtube.com/watch?v=first");
  const second = createQueueItem("https://www.youtube.com/watch?v=second");
  const third = createQueueItem("https://www.youtube.com/watch?v=third");
  const deferred = deferQueueItem([first, second, third], second.id);

  assert.equal(deferred.moved, true);
  assert.equal(deferred.nextItem.id, third.id);
  assert.deepEqual(deferred.items.map((item) => item.id), [first.id, third.id, second.id]);
  assert.equal(deferQueueItem([first], first.id).reason, "only-item");
});

test("calculates known queue time and enforces session budgets", () => {
  const first = createQueueItem("https://www.youtube.com/watch?v=a", { durationText: "2:00" });
  const second = createQueueItem("https://www.youtube.com/watch?v=b", { durationText: "3:30" });
  assert.equal(totalDurationSeconds([first, second]), 330);
  assert.equal(remainingBudgetMs({ budgetMinutes: 10, startedAt: 1_000 }, 61_000), 540_000);
  assert.equal(isBudgetExpired({ budgetMinutes: 1, startedAt: 1_000 }, 61_000), true);
  assert.equal(remainingBudgetMs({ budgetMinutes: 0 }, 61_000), null);
});

test("records watched and skipped history outcomes", () => {
  const item = createQueueItem("https://www.youtube.com/shorts/a");
  assert.equal(historyEntry(item, HISTORY_OUTCOMES.WATCHED, 99).completedAt, 99);
  assert.equal(historyEntry(item, HISTORY_OUTCOMES.SKIPPED).outcome, "skipped");
  assert.equal(historyEntry(item, "unknown"), null);
});

test("sanitizes v3 settings and playback sessions", () => {
  const settings = sanitizeSettings({ theme: "dark", compactDensity: true, captureMode: "invalid", defaultBudgetMinutes: 45 });
  assert.equal(settings.theme, "dark");
  assert.equal(settings.compactDensity, true);
  assert.equal(settings.captureMode, DEFAULT_SETTINGS.captureMode);
  assert.equal(settings.defaultBudgetMinutes, 45);

  const session = createSession({ status: "playing", currentKind: "short", budgetMinutes: 999, playerTabId: 12 });
  assert.equal(session.status, PLAYBACK_STATES.PLAYING);
  assert.equal(session.currentKind, QUEUE_KINDS.SHORT);
  assert.equal(session.budgetMinutes, 180);
  assert.equal(session.playerTabId, 12);
});

test("allows valid session transitions and rejects stale ones", () => {
  const loading = transitionSession(createSession(), PLAYBACK_STATES.LOADING, { currentItemId: "video:a" });
  assert.equal(loading.ok, true);
  assert.equal(loading.session.currentItemId, "video:a");
  assert.equal(transitionSession(loading.session, PLAYBACK_STATES.PLAYING).reason, "invalid-transition");
  const ready = transitionSession(loading.session, PLAYBACK_STATES.READY);
  assert.equal(transitionSession(ready.session, PLAYBACK_STATES.PLAYING).ok, true);
});

test("migrates v2 queue data without losing valid picks", () => {
  const item = createQueueItem("https://www.youtube.com/watch?v=migrate", { title: "Keep me" }, 10);
  const migrated = migratePersistentState({
    autoAdvanceShorts: true,
    qtSettings: { theme: "dark", autoAdvanceShorts: false },
    qtQueueItems: [item, { sourceUrl: "https://example.com/not-youtube" }],
    qtHistory: [{ ...item, outcome: "watched", completedAt: 20 }]
  });

  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.settings.autoAdvanceShorts, false);
  assert.equal(migrated.settings.theme, "dark");
  assert.equal(migrated.items.length, 1);
  assert.equal(migrated.items[0].title, "Keep me");
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.invalidItems, 1);
});

test("restores v2 and v3 backups without overwriting data on invalid input", () => {
  const current = createQueueItem("https://www.youtube.com/watch?v=current");
  const incoming = createQueueItem("https://www.youtube.com/shorts/incoming");
  const merged = restoreBackupPayload({ version: 2, items: [current, incoming], history: [] }, [current], DEFAULT_SETTINGS, "merge");
  assert.equal(merged.ok, true);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.imported, 1);
  assert.equal(merged.duplicates, 1);
  const mergeSettings = restoreBackupPayload({ version: 3, settings: { theme: "dark" }, items: [] }, [current], { ...DEFAULT_SETTINGS, theme: "light" }, "merge");
  assert.equal(mergeSettings.settings.theme, "light");
  const replaceSettings = restoreBackupPayload({ version: 3, settings: { theme: "dark" }, items: [] }, [current], { ...DEFAULT_SETTINGS, theme: "light" }, "replace");
  assert.equal(replaceSettings.settings.theme, "dark");
  assert.equal(replaceSettings.items.length, 0);
  assert.equal(restoreBackupPayload({ version: 1, items: [] }, [current], DEFAULT_SETTINGS).ok, false);
  assert.equal(restoreBackupPayload({ version: 3, items: "bad" }, [current], DEFAULT_SETTINGS).reason, "invalid-items");
});

test("rejects lookalike and non-video URLs", () => {
  assert.equal(classifyYouTubeUrl("https://notyoutube.com/watch?v=nope"), null);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/playlist?list=PL123"), null);
  assert.equal(normalizeQueueUrl("not a valid url"), null);
});
