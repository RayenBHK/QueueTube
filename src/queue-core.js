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

export const SCHEMA_VERSION = 3;

export const THEMES = Object.freeze({
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark"
});

export const PLAYBACK_STATES = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  PLAYING: "playing",
  ADVANCING: "advancing",
  LANE_COMPLETE: "lane-complete",
  BUDGET_COMPLETE: "budget-complete",
  ERROR: "error"
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
  autoAdvanceVideos: true,
  removeFinished: true,
  defaultBudgetMinutes: 0,
  theme: THEMES.SYSTEM,
  compactDensity: false
});

export const DEFAULT_SESSION = Object.freeze({
  status: PLAYBACK_STATES.IDLE,
  playerTabId: null,
  currentItemId: null,
  currentKind: null,
  completedLane: null,
  budgetMinutes: 0,
  startedAt: null,
  sessionId: null,
  transitionToken: null,
  lastError: null
});

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);

const MAX_TEXT_LENGTH = 300;
const MAX_BACKUP_ITEMS = 2000;

const SESSION_TRANSITIONS = Object.freeze({
  [PLAYBACK_STATES.IDLE]: new Set([PLAYBACK_STATES.LOADING, PLAYBACK_STATES.BUDGET_COMPLETE]),
  [PLAYBACK_STATES.LOADING]: new Set([
    PLAYBACK_STATES.READY,
    PLAYBACK_STATES.ADVANCING,
    PLAYBACK_STATES.ERROR,
    PLAYBACK_STATES.IDLE
  ]),
  [PLAYBACK_STATES.READY]: new Set([
    PLAYBACK_STATES.PLAYING,
    PLAYBACK_STATES.LOADING,
    PLAYBACK_STATES.ADVANCING,
    PLAYBACK_STATES.BUDGET_COMPLETE,
    PLAYBACK_STATES.ERROR,
    PLAYBACK_STATES.IDLE
  ]),
  [PLAYBACK_STATES.PLAYING]: new Set([
    PLAYBACK_STATES.READY,
    PLAYBACK_STATES.LOADING,
    PLAYBACK_STATES.ADVANCING,
    PLAYBACK_STATES.BUDGET_COMPLETE,
    PLAYBACK_STATES.ERROR,
    PLAYBACK_STATES.IDLE
  ]),
  [PLAYBACK_STATES.ADVANCING]: new Set([
    PLAYBACK_STATES.LOADING,
    PLAYBACK_STATES.LANE_COMPLETE,
    PLAYBACK_STATES.ERROR,
    PLAYBACK_STATES.IDLE
  ]),
  [PLAYBACK_STATES.LANE_COMPLETE]: new Set([PLAYBACK_STATES.LOADING, PLAYBACK_STATES.IDLE]),
  [PLAYBACK_STATES.BUDGET_COMPLETE]: new Set([
    PLAYBACK_STATES.READY,
    PLAYBACK_STATES.LOADING,
    PLAYBACK_STATES.ADVANCING,
    PLAYBACK_STATES.IDLE
  ]),
  [PLAYBACK_STATES.ERROR]: new Set([
    PLAYBACK_STATES.LOADING,
    PLAYBACK_STATES.ADVANCING,
    PLAYBACK_STATES.IDLE
  ])
});

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

export function deferQueueItem(items, itemId) {
  const safeItems = Array.isArray(items) ? [...items] : [];
  const item = safeItems.find((entry) => entry.id === itemId);
  if (!item) return { items: safeItems, item: null, nextItem: null, moved: false, reason: "missing-item" };

  const lane = getLane(safeItems, item.kind);
  if (lane.length < 2) {
    return { items: safeItems, item, nextItem: null, moved: false, reason: "only-item" };
  }

  const currentIndex = lane.findIndex((entry) => entry.id === itemId);
  const nextItem = lane[(currentIndex + 1) % lane.length];
  return {
    items: reorderQueueItem(safeItems, itemId, lane.length - 1),
    item,
    nextItem,
    moved: true,
    reason: null
  };
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

export function sanitizeSettings(rawSettings = {}) {
  const raw = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const next = { ...DEFAULT_SETTINGS };

  for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
    const value = raw[key];
    if (typeof defaultValue === "boolean" && typeof value === "boolean") next[key] = value;
  }
  if (Object.values(CAPTURE_MODES).includes(raw.captureMode)) next.captureMode = raw.captureMode;
  if (Object.values(THEMES).includes(raw.theme)) next.theme = raw.theme;
  if (Number.isInteger(raw.defaultBudgetMinutes) && raw.defaultBudgetMinutes >= 0 && raw.defaultBudgetMinutes <= 180) {
    next.defaultBudgetMinutes = raw.defaultBudgetMinutes;
  }
  return next;
}

export function createSession(rawSession = {}) {
  const raw = rawSession && typeof rawSession === "object" ? rawSession : {};
  const status = Object.values(PLAYBACK_STATES).includes(raw.status) ? raw.status : PLAYBACK_STATES.IDLE;
  const kind = Object.values(QUEUE_KINDS).includes(raw.currentKind) ? raw.currentKind : null;
  const completedLane = Object.values(QUEUE_KINDS).includes(raw.completedLane) ? raw.completedLane : null;
  const budgetMinutes = Number.isFinite(raw.budgetMinutes)
    ? Math.max(0, Math.min(180, Math.floor(raw.budgetMinutes)))
    : 0;

  return {
    ...DEFAULT_SESSION,
    status,
    playerTabId: Number.isInteger(raw.playerTabId) ? raw.playerTabId : null,
    currentItemId: typeof raw.currentItemId === "string" ? raw.currentItemId : null,
    currentKind: kind,
    completedLane,
    budgetMinutes,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    transitionToken: typeof raw.transitionToken === "string" ? raw.transitionToken : null,
    lastError: typeof raw.lastError === "string" ? cleanText(raw.lastError) : null
  };
}

export function transitionSession(session, nextStatus, patch = {}) {
  const current = createSession(session);
  if (!Object.values(PLAYBACK_STATES).includes(nextStatus)) {
    return { ok: false, reason: "invalid-state", session: current };
  }
  if (current.status !== nextStatus && !SESSION_TRANSITIONS[current.status]?.has(nextStatus)) {
    return { ok: false, reason: "invalid-transition", session: current };
  }
  return { ok: true, session: createSession({ ...current, ...patch, status: nextStatus }) };
}

function rebuildItems(rawItems, settings) {
  const source = Array.isArray(rawItems) ? rawItems.slice(0, MAX_BACKUP_ITEMS) : [];
  let items = [];
  let invalid = 0;
  for (const rawItem of source) {
    const item = createQueueItem(
      rawItem?.sourceUrl || rawItem?.playbackUrl,
      rawItem,
      Number.isFinite(rawItem?.addedAt) ? rawItem.addedAt : Date.now(),
      settings
    );
    if (!item) {
      invalid += 1;
      continue;
    }
    items = addQueueItem(items, item, { preventDuplicates: false }).items;
  }
  return { items, invalid };
}

function rebuildHistory(rawHistory, settings) {
  const source = Array.isArray(rawHistory) ? rawHistory.slice(0, 200) : [];
  const history = [];
  for (const rawEntry of source) {
    const item = createQueueItem(
      rawEntry?.sourceUrl || rawEntry?.playbackUrl,
      rawEntry,
      Number.isFinite(rawEntry?.addedAt) ? rawEntry.addedAt : Date.now(),
      settings
    );
    if (!item || !Object.values(HISTORY_OUTCOMES).includes(rawEntry?.outcome)) continue;
    history.push({
      ...item,
      outcome: rawEntry.outcome,
      completedAt: Number.isFinite(rawEntry.completedAt) ? rawEntry.completedAt : Date.now(),
      sessionId: typeof rawEntry.sessionId === "string" ? rawEntry.sessionId : null
    });
  }
  return history;
}

export function migratePersistentState(existing = {}) {
  const legacySettings = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS)
      .filter((key) => existing[key] !== undefined)
      .map((key) => [key, existing[key]])
  );
  const settings = sanitizeSettings({ ...legacySettings, ...(existing.qtSettings || {}) });
  const rebuilt = rebuildItems(existing.qtQueueItems, settings);
  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    items: rebuilt.items,
    history: rebuildHistory(existing.qtHistory, settings),
    invalidItems: rebuilt.invalid
  };
}

export function restoreBackupPayload(payload, currentItems, currentSettings, mode = "merge") {
  if (!payload || typeof payload !== "object" || ![2, 3].includes(Number(payload.version))) {
    return { ok: false, reason: "unsupported-backup" };
  }
  if (!Array.isArray(payload.items) || payload.items.length > MAX_BACKUP_ITEMS) {
    return { ok: false, reason: "invalid-items" };
  }

  const replace = mode === "replace";
  const settings = replace
    ? sanitizeSettings({ ...currentSettings, ...(payload.settings || {}) })
    : sanitizeSettings(currentSettings);
  let items = replace ? [] : Array.isArray(currentItems) ? [...currentItems] : [];
  let imported = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const rawItem of payload.items) {
    const item = createQueueItem(
      rawItem?.sourceUrl || rawItem?.playbackUrl,
      rawItem,
      Number.isFinite(rawItem?.addedAt) ? rawItem.addedAt : Date.now(),
      settings
    );
    if (!item) {
      invalid += 1;
      continue;
    }
    const result = addQueueItem(items, item, { preventDuplicates: settings.preventDuplicates });
    items = result.items;
    if (result.added) imported += 1;
    else if (result.reason === "duplicate") duplicates += 1;
  }

  return {
    ok: true,
    version: Number(payload.version),
    mode: replace ? "replace" : "merge",
    items,
    settings,
    history: rebuildHistory(payload.history, settings),
    imported,
    duplicates,
    invalid
  };
}
