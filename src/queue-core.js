export const QUEUE_KINDS = Object.freeze({
  SHORT: "short",
  VIDEO: "video"
});

export const QUEUE_GROUPS = Object.freeze({
  [QUEUE_KINDS.SHORT]: {
    title: "QueueTube · Shorts",
    color: "orange",
    collapsed: false
  },
  [QUEUE_KINDS.VIDEO]: {
    title: "QueueTube · Videos",
    color: "blue",
    collapsed: true
  }
});

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl, "https://www.youtube.com");
  } catch {
    return null;
  }
}

function isYouTubeHost(hostname) {
  return YOUTUBE_HOSTS.has(hostname.toLowerCase());
}

export function classifyYouTubeUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return null;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return videoId ? { kind: QUEUE_KINDS.VIDEO, videoId, url } : null;
  }

  if (!isYouTubeHost(hostname)) return null;

  const queuedKind = url.searchParams.get("qt_kind");
  const isQueueTubeUrl = url.searchParams.get("qt_queue") === "1";
  if (isQueueTubeUrl && Object.values(QUEUE_KINDS).includes(queuedKind)) {
    const videoId = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean)[1];
    return videoId ? { kind: queuedKind, videoId, url } : null;
  }

  const shortMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
  if (shortMatch) {
    return { kind: QUEUE_KINDS.SHORT, videoId: shortMatch[1], url };
  }

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    return videoId ? { kind: QUEUE_KINDS.VIDEO, videoId, url } : null;
  }

  const liveMatch = url.pathname.match(/^\/live\/([^/?#]+)/);
  if (liveMatch) {
    return { kind: QUEUE_KINDS.VIDEO, videoId: liveMatch[1], url };
  }

  return null;
}

export function queueKey(rawUrl) {
  const classified = classifyYouTubeUrl(rawUrl);
  return classified ? `${classified.kind}:${classified.videoId}` : null;
}

export function normalizeQueueUrl(rawUrl, { shortsInPlayer = true } = {}) {
  const classified = classifyYouTubeUrl(rawUrl);
  if (!classified) return null;

  const { kind, videoId } = classified;
  let url;

  if (kind === QUEUE_KINDS.SHORT && shortsInPlayer) {
    url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", videoId);
  } else if (classified.url.hostname.toLowerCase() === "youtu.be") {
    url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", videoId);
    const startAt = classified.url.searchParams.get("t");
    if (startAt) url.searchParams.set("t", startAt);
  } else {
    url = new URL(classified.url.href);
    url.hostname = "www.youtube.com";
  }

  // A queued pick should remain a single pick, not silently become a playlist.
  ["list", "index", "start_radio"].forEach((param) => url.searchParams.delete(param));
  url.searchParams.set("autoplay", "0");
  url.searchParams.set("qt_queue", "1");
  url.searchParams.set("qt_kind", kind);

  return {
    kind,
    videoId,
    url: url.href,
    key: `${kind}:${videoId}`
  };
}
