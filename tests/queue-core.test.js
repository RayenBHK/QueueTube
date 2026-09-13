import test from "node:test";
import assert from "node:assert/strict";

import {
  QUEUE_KINDS,
  classifyYouTubeUrl,
  normalizeQueueUrl,
  queueKey
} from "../src/queue-core.js";

test("classifies Shorts and ordinary videos", () => {
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/shorts/abc123")?.kind, QUEUE_KINDS.SHORT);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/watch?v=xyz789")?.kind, QUEUE_KINDS.VIDEO);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/feed/subscriptions"), null);
});

test("opens Shorts in the regular player while preserving their queue kind", () => {
  const result = normalizeQueueUrl("https://www.youtube.com/shorts/abc123?feature=share", {
    shortsInPlayer: true
  });
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
  const result = normalizeQueueUrl("https://www.youtube.com/shorts/abc123", {
    shortsInPlayer: false
  });
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

test("rejects lookalike and non-video URLs", () => {
  assert.equal(classifyYouTubeUrl("https://notyoutube.com/watch?v=nope"), null);
  assert.equal(classifyYouTubeUrl("https://www.youtube.com/playlist?list=PL123"), null);
  assert.equal(normalizeQueueUrl("not a valid url"), null);
});
