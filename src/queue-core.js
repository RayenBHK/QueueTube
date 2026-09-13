export const QUEUE_KINDS = Object.freeze({
  SHORT: "short",
  VIDEO: "video"
});

export const CAPTURE_MODES = Object.freeze({
  QUEUE_ROOM: "queue-room",
  CLASSIC_TABS: "classic-tabs"
});

export const HISTORY_OUTCOMES = Object.freeze({
  WATCHED: "watched",
  SKIPPED: "skipped"
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

export const DEFAULT_SETTINGS = Object.freeze({
  captureMode: CAPTURE_MODES.QUEUE_ROOM,
  captureCtrlClick: true,
  captureMiddleClick: true,
  shortsInPlayer: true,
  pauseBackground: true,
  sleepVideos: true,
  preventDuplicates: true,
  focusShield: true,
  showQueuedBadges: true,
  autoAdvanceShorts: true,
  removeFinished: true,
  defaultBudgetMinutes: 0
});

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);

const MAX_TEXT_LENGTH = 300;

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

function cleanText(value, fallback = "") {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return cleaned || fallback;
}

function cleanThumbnailUrl(value, videoId) {
  const url = parseUrl(value);
  if (url && ["i.ytimg.com", "img.youtube.com"].includes(url.hostname.toLowerCase())) {
    return url.href;
  }
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
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

export function parseDurationText(rawValue) {
  const value = cleanText(rawValue);
  if (!value || /live|premiere/i.test(value)) return null;

  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if (parts.slice(1).some((part) => part < 0 || part > 59)) return null;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function createQueueItem(rawUrl, metadata = {}, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const normalized = normalizeQueueUrl(rawUrl, settings);
  if (!normalized) return null;

  const durationText = cleanText(metadata.durationText);
  const durationSeconds = Number.isFinite(metadata.durationSeconds)
    ? Math.max(0, Math.floor(metadata.durationSeconds))
    : parseDurationText(durationText);

  const playback = new URL(normalized.url);
  playback.searchParams.set("qt_item", normalized.key);

  return {
    id: normalized.key,
    key: normalized.key,
    kind: normalized.kind,
    videoId: normalized.videoId,
    sourceUrl: cleanText(rawUrl, normalized.url),
    playbackUrl: playback.href,
    title: cleanText(metadata.title, normalized.kind === QUEUE_KINDS.SHORT ? "Untitled Short" : "Untitled video"),
    channel: cleanText(metadata.channel, "YouTube"),
    thumbnailUrl: cleanThumbnailUrl(metadata.thumbnailUrl, normalized.videoId),
    durationText: durationText || (durationSeconds !== null ? formatDuration(durationSeconds) : ""),
    durationSeconds,
    addedAt: Number.isFinite(now) ? now : Date.now()
  };
}

export function addQueueItem(items, item, { preventDuplicates = true } = {}) {
  const safeItems = Array.isArray(items) ? [...items] : [];
  if (!item) return { items: safeItems, item: null, added: false, reason: "invalid" };
  const existing = safeItems.find((entry) => entry.key === item.key);
  if (preventDuplicates && existing) {
    return { items: safeItems, item: existing, added: false, reason: "duplicate" };
  }

  let queuedItem = item;
  if (safeItems.some((entry) => entry.id === item.id)) {
    let suffix = 2;
    while (safeItems.some((entry) => entry.id === `${item.id}:${suffix}`)) suffix += 1;
    const playbackUrl = new URL(item.playbackUrl);
    const id = `${item.id}:${suffix}`;
    playbackUrl.searchParams.set("qt_item", id);
    queuedItem = { ...item, id, playbackUrl: playbackUrl.href };
  }

  safeItems.push(queuedItem);
  return { items: safeItems, item: queuedItem, added: true, reason: null };
}

export function removeQueueItem(items, itemId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.id !== itemId);
}

export function reorderQueueItem(items, itemId, targetIndex) {
  const safeItems = Array.isArray(items) ? [...items] : [];
  const currentIndex = safeItems.findIndex((item) => item.id === itemId);
  if (currentIndex < 0 || !Number.isInteger(targetIndex)) return safeItems;

  const [item] = safeItems.splice(currentIndex, 1);
  const sameKind = safeItems.filter((entry) => entry.kind === item.kind);
  const boundedIndex = Math.max(0, Math.min(targetIndex, sameKind.length));
  const insertBefore = sameKind[boundedIndex];

  if (!insertBefore) {
    const lastSameKind = safeItems.findLastIndex((entry) => entry.kind === item.kind);
    safeItems.splice(lastSameKind + 1, 0, item);
  } else {
    safeItems.splice(safeItems.indexOf(insertBefore), 0, item);
  }
  return safeItems;
}

export function getLane(items, kind) {
  return (Array.isArray(items) ? items : []).filter((item) => item.kind === kind);
}

export function getNextItem(items, kind, currentItemId = null) {
  const lane = getLane(items, kind);
  if (!lane.length) return null;
  const index = currentItemId ? lane.findIndex((item) => item.id === currentItemId) : -1;
  return lane[index + 1] || lane[0] || null;
}

export function totalDurationSeconds(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (total, item) => total + (Number.isFinite(item.durationSeconds) ? item.durationSeconds : 0),
    0
  );
}

export function remainingBudgetMs(session, now = Date.now()) {
  const budgetMinutes = Number(session?.budgetMinutes) || 0;
  if (budgetMinutes <= 0) return null;
  const startedAt = Number(session?.startedAt) || now;
  return Math.max(0, budgetMinutes * 60_000 - Math.max(0, now - startedAt));
}

export function isBudgetExpired(session, now = Date.now()) {
  return remainingBudgetMs(session, now) === 0;
}

export function historyEntry(item, outcome, now = Date.now()) {
  if (!item || !Object.values(HISTORY_OUTCOMES).includes(outcome)) return null;
  return { ...item, outcome, completedAt: now };
}
