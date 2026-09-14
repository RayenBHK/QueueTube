import {
  CAPTURE_MODES,
  DEFAULT_SESSION,
  DEFAULT_SETTINGS,
  HISTORY_OUTCOMES,
  PLAYBACK_STATES,
  QUEUE_GROUPS,
  QUEUE_KINDS,
  SCHEMA_VERSION,
  THEMES,
  addQueueItem,
  createSession,
  createQueueItem,
  deferQueueItem,
  getLane,
  getNextItem,
  historyEntry,
  isBudgetExpired,
  migratePersistentState,
  normalizeQueueUrl,
  queueKey,
  removeQueueItem,
  reorderQueueItem,
  restoreBackupPayload,
  sanitizeSettings,
  transitionSession
} from "./queue-core.js";

const STORAGE_KEYS = Object.freeze({
  SETTINGS: "qtSettings",
  ITEMS: "qtQueueItems",
  HISTORY: "qtHistory",
  SCHEMA: "qtSchemaVersion"
});

const SESSION_KEY = "qtSession";
const HISTORY_LIMIT = 200;

async function withQueueLock(operation) {
  return navigator.locks.request("queuetube:queue-write", { mode: "exclusive" }, operation);
}

async function withPlayerLock(operation) {
  return navigator.locks.request("queuetube:player-transition", { mode: "exclusive" }, operation);
}

function isYouTubeUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isTrustedSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const senderUrl = sender.url || "";
  if (senderUrl.startsWith(chrome.runtime.getURL(""))) return true;
  return !sender.tab || isYouTubeUrl(senderUrl || sender.tab.url || "");
}

async function getSettings() {
  const stored = await chrome.storage.local.get({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  return sanitizeSettings(stored[STORAGE_KEYS.SETTINGS]);
}

async function setSettings(patch) {
  const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  const safePatch = Object.fromEntries(
    Object.entries(patch || {}).filter(([key, value]) => {
      if (!allowedKeys.has(key)) return false;
      if (key === "captureMode") return Object.values(CAPTURE_MODES).includes(value);
      if (key === "theme") return Object.values(THEMES).includes(value);
      if (key === "defaultBudgetMinutes") return Number.isInteger(value) && value >= 0 && value <= 180;
      return typeof value === typeof DEFAULT_SETTINGS[key];
    })
  );
  const next = sanitizeSettings({ ...(await getSettings()), ...safePatch });
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

async function getItems() {
  const stored = await chrome.storage.local.get({ [STORAGE_KEYS.ITEMS]: [] });
  return Array.isArray(stored[STORAGE_KEYS.ITEMS]) ? stored[STORAGE_KEYS.ITEMS] : [];
}

async function setItems(items) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: items });
}

async function getHistory() {
  const stored = await chrome.storage.local.get({ [STORAGE_KEYS.HISTORY]: [] });
  return Array.isArray(stored[STORAGE_KEYS.HISTORY]) ? stored[STORAGE_KEYS.HISTORY] : [];
}

async function getSession() {
  const stored = await chrome.storage.session.get({ [SESSION_KEY]: DEFAULT_SESSION });
  return createSession(stored[SESSION_KEY]);
}

async function setSession(patch) {
  const next = createSession({ ...(await getSession()), ...patch });
  await chrome.storage.session.set({ [SESSION_KEY]: next });
  return next;
}

async function setSessionState(status, patch = {}) {
  const current = await getSession();
  const transitioned = transitionSession(current, status, patch);
  if (!transitioned.ok) throw new Error(`${transitioned.reason}:${current.status}->${status}`);
  await chrome.storage.session.set({ [SESSION_KEY]: transitioned.session });
  return transitioned.session;
}

async function getTargetWindowId(preferredWindowId) {
  if (Number.isInteger(preferredWindowId) && preferredWindowId >= 0) return preferredWindowId;
  const currentWindow = await chrome.windows.getLastFocused();
  return currentWindow.id;
}

async function findQueueGroup(windowId, kind) {
  const definition = QUEUE_GROUPS[kind];
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === definition.title) || null;
}

async function getClassicQueueTabs(windowId, kind) {
  const group = await findQueueGroup(windowId, kind);
  if (!group) return [];
  return chrome.tabs.query({ windowId, groupId: group.id });
}

async function ensureQueueGroup(windowId, kind, tabId) {
  const definition = QUEUE_GROUPS[kind];
  const existingGroup = await findQueueGroup(windowId, kind);
  const groupId = existingGroup
    ? await chrome.tabs.group({ groupId: existingGroup.id, tabIds: [tabId] })
    : await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });

  await chrome.tabGroups.update(groupId, {
    title: definition.title,
    color: definition.color,
    collapsed: definition.collapsed
  });
  return groupId;
}

async function orderQueueGroups(windowId) {
  try {
    const [shortGroup, videoGroup] = await Promise.all([
      findQueueGroup(windowId, QUEUE_KINDS.SHORT),
      findQueueGroup(windowId, QUEUE_KINDS.VIDEO)
    ]);
    if (!shortGroup || !videoGroup) return;

    const [shortTabs, videoTabs] = await Promise.all([
      chrome.tabs.query({ windowId, groupId: shortGroup.id }),
      chrome.tabs.query({ windowId, groupId: videoGroup.id })
    ]);
    if (!shortTabs.length || !videoTabs.length) return;

    const firstShortIndex = Math.min(...shortTabs.map((tab) => tab.index));
    const firstVideoIndex = Math.min(...videoTabs.map((tab) => tab.index));
    if (firstShortIndex > firstVideoIndex) {
      await chrome.tabGroups.move(shortGroup.id, { index: firstVideoIndex });
    }
  } catch (error) {
    console.warn("QueueTube could not reorder its classic tab groups", error);
  }
}

async function discardTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active || tab.discarded) return Boolean(tab.discarded);
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    const discarded = await chrome.tabs.discard(tabId);
    return Boolean(discarded?.discarded);
  } catch (error) {
    console.warn("QueueTube could not put a classic video tab to sleep", error);
    return false;
  }
}

async function queueClassicTab(rawUrl, windowId, settings) {
  const normalized = normalizeQueueUrl(rawUrl, settings);
  if (!normalized) return { ok: false, reason: "not-a-video" };

  if (settings.preventDuplicates) {
    const tabs = await getClassicQueueTabs(windowId, normalized.kind);
    const duplicate = tabs.find((tab) => queueKey(tab.pendingUrl || tab.url) === normalized.key);
    if (duplicate) {
      return {
        ok: true,
        duplicate: true,
        kind: normalized.kind,
        mode: CAPTURE_MODES.CLASSIC_TABS,
        tabId: duplicate.id,
        sleeping: Boolean(duplicate.discarded)
      };
    }
  }

  const tab = await chrome.tabs.create({ windowId, url: normalized.url, active: false });
  await ensureQueueGroup(windowId, normalized.kind, tab.id);
  await orderQueueGroups(windowId);

  const sleeping = normalized.kind === QUEUE_KINDS.VIDEO && settings.sleepVideos
    ? await discardTab(tab.id)
    : false;
  await updateBadge();
  return {
    ok: true,
    duplicate: false,
    kind: normalized.kind,
    mode: CAPTURE_MODES.CLASSIC_TABS,
    tabId: tab.id,
    sleeping
  };
}

async function queueUrl(rawUrl, metadata, preferredWindowId) {
  const settings = await getSettings();
  const windowId = await getTargetWindowId(preferredWindowId);
  if (settings.captureMode === CAPTURE_MODES.CLASSIC_TABS) {
    return queueClassicTab(rawUrl, windowId, settings);
  }

  const item = createQueueItem(rawUrl, metadata, Date.now(), settings);
  if (!item) return { ok: false, reason: "not-a-video" };

  const result = await withQueueLock(async () => {
    const added = addQueueItem(await getItems(), item, settings);
    if (added.added) await setItems(added.items);
    return added;
  });
  await updateBadge();
  return {
    ok: true,
    duplicate: !result.added && result.reason === "duplicate",
    kind: result.item.kind,
    itemId: result.item.id,
    mode: CAPTURE_MODES.QUEUE_ROOM,
    sleeping: result.item.kind === QUEUE_KINDS.VIDEO
  };
}

async function getClassicState(windowId) {
  const [shorts, videos] = await Promise.all([
    getClassicQueueTabs(windowId, QUEUE_KINDS.SHORT),
    getClassicQueueTabs(windowId, QUEUE_KINDS.VIDEO)
  ]);
  return {
    short: { count: shorts.length, sleeping: shorts.filter((tab) => tab.discarded).length },
    video: { count: videos.length, sleeping: videos.filter((tab) => tab.discarded).length }
  };
}

async function getAppState(preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const [settings, items, history, session, classicQueues] = await Promise.all([
    getSettings(),
    getItems(),
    getHistory(),
    getSession(),
    getClassicState(windowId)
  ]);
  const shorts = getLane(items, QUEUE_KINDS.SHORT);
  const videos = getLane(items, QUEUE_KINDS.VIDEO);
  return {
    ok: true,
    windowId,
    settings,
    items,
    history,
    session,
    queues: {
      short: { count: shorts.length, sleeping: 0 },
      video: { count: videos.length, sleeping: videos.length }
    },
    classicQueues
  };
}

async function validPlayerTab(session) {
  if (!Number.isInteger(session?.playerTabId)) return null;
  try {
    const tab = await chrome.tabs.get(session.playerTabId);
    return isYouTubeUrl(tab.pendingUrl || tab.url || "") ? tab : null;
  } catch {
    return null;
  }
}

function nextTransitionToken() {
  return crypto.randomUUID();
}

function playbackUrlFor(item, transitionToken) {
  const url = new URL(item.playbackUrl);
  url.searchParams.set("qt_item", item.id);
  url.searchParams.set("qt_transition", transitionToken);
  return url.href;
}

async function openPlaybackItemUnlocked(item, preferredWindowId) {
  if (!item) return { ok: false, reason: "missing-item" };
  const session = await getSession();
  if (isBudgetExpired(session)) {
    const nextSession = await setSession({ status: PLAYBACK_STATES.BUDGET_COMPLETE, lastError: null });
    return { ok: false, reason: "budget-finished", session: nextSession };
  }

  const transitionToken = nextTransitionToken();
  const sessionId = session.sessionId || crypto.randomUUID();
  await setSessionState(PLAYBACK_STATES.LOADING, {
    currentItemId: item.id,
    currentKind: item.kind,
    completedLane: null,
    sessionId,
    transitionToken,
    lastError: null
  });

  try {
    const windowId = await getTargetWindowId(preferredWindowId);
    const playerTab = await validPlayerTab(session);
    const url = playbackUrlFor(item, transitionToken);
    let tab;
    if (playerTab) {
      tab = await chrome.tabs.update(playerTab.id, { url, active: true });
      if (playerTab.windowId !== windowId) {
        await chrome.windows.update(playerTab.windowId, { focused: true });
      }
    } else {
      tab = await chrome.tabs.create({ windowId, url, active: true });
    }

    const readySession = await setSessionState(PLAYBACK_STATES.READY, { playerTabId: tab.id });
    return {
      ok: true,
      tabId: tab.id,
      itemId: item.id,
      kind: item.kind,
      transitionToken,
      session: readySession
    };
  } catch (error) {
    const message = String(error?.message || "player-navigation-failed").slice(0, 300);
    const failedSession = await setSessionState(PLAYBACK_STATES.ERROR, { lastError: message });
    return { ok: false, reason: "player-navigation-failed", session: failedSession };
  }
}

async function openItem(itemId, preferredWindowId) {
  return withPlayerLock(async () => {
    const item = (await getItems()).find((entry) => entry.id === itemId);
    return openPlaybackItemUnlocked(item, preferredWindowId);
  });
}

async function openNextClassic(kind, preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const tabs = await getClassicQueueTabs(windowId, kind);
  if (!tabs.length) return { ok: false, reason: "empty" };
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const group = await findQueueGroup(windowId, kind);
  if (group?.collapsed) await chrome.tabGroups.update(group.id, { collapsed: false });
  await chrome.tabs.update(ordered[0].id, { active: true });
  return { ok: true, tabId: ordered[0].id, kind, mode: CAPTURE_MODES.CLASSIC_TABS };
}

async function openNextQueueRoomUnlocked(kind, preferredWindowId) {
  if (!Object.values(QUEUE_KINDS).includes(kind)) return { ok: false, reason: "empty" };
  const [items, session] = await Promise.all([getItems(), getSession()]);
  const currentId = session.currentKind === kind ? session.currentItemId : null;
  const item = getNextItem(items, kind, currentId);
  return openPlaybackItemUnlocked(item, preferredWindowId);
}

async function openNext(kind, preferredWindowId) {
  const settings = await getSettings();
  if (settings.captureMode === CAPTURE_MODES.CLASSIC_TABS) {
    return openNextClassic(kind, preferredWindowId);
  }
  return withPlayerLock(() => openNextQueueRoomUnlocked(kind, preferredWindowId));
}

async function recordOutcome(itemId, outcome, sessionId = null) {
  const result = await withQueueLock(async () => {
    const [items, history, settings] = await Promise.all([getItems(), getHistory(), getSettings()]);
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, reason: "missing-item" };

    const baseEntry = historyEntry(item, outcome);
    const entry = baseEntry ? { ...baseEntry, sessionId } : null;
    const nextHistory = entry ? [entry, ...history].slice(0, HISTORY_LIMIT) : history;
    const nextItems = settings.removeFinished ? removeQueueItem(items, itemId) : items;
    await Promise.all([
      setItems(nextItems),
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: nextHistory })
    ]);
    return { ok: true, item, items: nextItems, settings };
  });
  await updateBadge();
  return result;
}

async function finishCurrentUnlocked(outcome, preferredWindowId, { advance = true, expectedItemId = null, transitionToken = null } = {}) {
  const session = await getSession();
  if (!session.currentItemId) return { ok: false, reason: "no-current-item" };
  if (expectedItemId && expectedItemId !== session.currentItemId) return { ok: false, reason: "stale-player" };
  if (transitionToken && transitionToken !== session.transitionToken) return { ok: false, reason: "stale-player" };

  await setSessionState(PLAYBACK_STATES.ADVANCING);
  const result = await recordOutcome(session.currentItemId, outcome, session.sessionId);
  if (!result.ok) {
    await setSession({ status: PLAYBACK_STATES.ERROR, lastError: result.reason });
    return result;
  }
  if (!advance) {
    const nextSession = await setSession({
      status: PLAYBACK_STATES.IDLE,
      currentItemId: null,
      currentKind: null,
      completedLane: null,
      transitionToken: null,
      lastError: null
    });
    return { ...result, session: nextSession };
  }

  const next = getNextItem(
    result.items,
    result.item.kind,
    result.settings.removeFinished ? null : result.item.id
  );
  if (!next) {
    const nextSession = await setSessionState(PLAYBACK_STATES.LANE_COMPLETE, {
      currentItemId: null,
      currentKind: null,
      completedLane: result.item.kind,
      transitionToken: null,
      lastError: null
    });
    return { ok: true, finished: true, queueEnded: true, completedLane: result.item.kind, session: nextSession };
  }
  const opened = await openPlaybackItemUnlocked(next, preferredWindowId);
  return { ...opened, finished: true };
}

async function finishCurrent(outcome, preferredWindowId, options = {}) {
  return withPlayerLock(() => finishCurrentUnlocked(outcome, preferredWindowId, options));
}

async function handlePlayerEnded(message, sender) {
  return withPlayerLock(async () => {
    const [session, settings] = await Promise.all([getSession(), getSettings()]);
    if (sender.tab?.id !== session.playerTabId || !session.currentItemId) {
      return { ok: false, reason: "not-current-player" };
    }
    const shouldAdvance = session.currentKind === QUEUE_KINDS.SHORT
      ? settings.autoAdvanceShorts
      : settings.autoAdvanceVideos;
    return finishCurrentUnlocked(HISTORY_OUTCOMES.WATCHED, sender.tab.windowId, {
      advance: shouldAdvance,
      expectedItemId: message.itemId,
      transitionToken: message.transitionToken
    });
  });
}

async function deferCurrent(preferredWindowId) {
  return withPlayerLock(async () => {
    const session = await getSession();
    if (!session.currentItemId) return { ok: false, reason: "no-current-item" };
    const deferred = await withQueueLock(async () => {
      const result = deferQueueItem(await getItems(), session.currentItemId);
      if (result.moved) await setItems(result.items);
      return result;
    });
    if (!deferred.moved) return { ok: false, reason: deferred.reason };
    await setSessionState(PLAYBACK_STATES.ADVANCING);
    await updateBadge();
    const opened = await openPlaybackItemUnlocked(deferred.nextItem, preferredWindowId);
    return { ...opened, deferred: true };
  });
}

async function openPrevious(preferredWindowId) {
  return withPlayerLock(async () => {
    const result = await withQueueLock(async () => {
      const [history, settings, items] = await Promise.all([getHistory(), getSettings(), getItems()]);
      const previous = history[0];
      if (!previous) return { ok: false, reason: "no-history" };

      const restored = createQueueItem(previous.sourceUrl, previous, Date.now(), settings);
      const added = addQueueItem(items, restored, { preventDuplicates: true });
      await Promise.all([
        added.added ? setItems(added.items) : Promise.resolve(),
        chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history.slice(1) })
      ]);
      return { ok: true, item: added.item };
    });
    if (!result.ok) return result;
    await updateBadge();
    return openPlaybackItemUnlocked(result.item, preferredWindowId);
  });
}

async function focusPlayer() {
  const session = await getSession();
  const tab = await validPlayerTab(session);
  if (!tab) return { ok: false, reason: "no-player" };
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { ok: true, tabId: tab.id };
}

async function updatePlayerState(message, sender) {
  return withPlayerLock(async () => {
    const session = await getSession();
    if (
      sender.tab?.id !== session.playerTabId ||
      message.itemId !== session.currentItemId ||
      message.transitionToken !== session.transitionToken
    ) {
      return { ok: false, reason: "stale-player", shouldPause: true };
    }
    if (isBudgetExpired(session)) {
      const nextSession = await setSession({ status: PLAYBACK_STATES.BUDGET_COMPLETE });
      return { ok: true, shouldPause: true, session: nextSession };
    }

    const nextStatus = message.state === "playing" ? PLAYBACK_STATES.PLAYING : PLAYBACK_STATES.READY;
    const transitioned = transitionSession(session, nextStatus);
    if (!transitioned.ok) return { ok: false, reason: transitioned.reason, shouldPause: session.status !== PLAYBACK_STATES.PLAYING };
    await chrome.storage.session.set({ [SESSION_KEY]: transitioned.session });
    return { ok: true, shouldPause: false, session: transitioned.session };
  });
}

async function getPlayerPolicy(message, sender) {
  const session = await getSession();
  const current = sender.tab?.id === session.playerTabId &&
    message.itemId === session.currentItemId &&
    message.transitionToken === session.transitionToken;
  const budgetExpired = current && isBudgetExpired(session);
  if (budgetExpired && session.status !== PLAYBACK_STATES.BUDGET_COMPLETE) {
    await setSession({ status: PLAYBACK_STATES.BUDGET_COMPLETE });
  }
  return { ok: true, current, shouldPause: !current || budgetExpired, budgetExpired, session: await getSession() };
}

async function openShortcutSettings() {
  try {
    const tab = await chrome.tabs.create({ url: "chrome://extensions/shortcuts", active: true });
    return { ok: true, tabId: tab.id };
  } catch {
    return { ok: false, reason: "shortcut-settings-unavailable" };
  }
}

async function getCommandState() {
  const recommended = {
    "open-queue-room": "Alt+Shift+Q",
    "open-next-short": "Alt+Shift+S",
    "open-next-video": "Alt+Shift+V",
    "skip-current": "Alt+Shift+X"
  };
  const commands = await chrome.commands.getAll();
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    commands: commands.map((command) => ({
      name: command.name,
      description: command.description || (command.name === "_execute_action" ? "Activate the extension" : command.name),
      shortcut: command.shortcut || "",
      recommended: recommended[command.name] || ""
    }))
  };
}

async function moveItem(itemId, targetIndex) {
  const items = await withQueueLock(async () => {
    const reordered = reorderQueueItem(await getItems(), itemId, targetIndex);
    await setItems(reordered);
    return reordered;
  });
  return { ok: true, items };
}

async function removeItem(itemId) {
  const result = await withQueueLock(async () => {
    const items = await getItems();
    const next = removeQueueItem(items, itemId);
    if (next.length === items.length) return { ok: false, reason: "missing-item" };
    await setItems(next);
    return { ok: true };
  });
  if (!result.ok) return result;
  const session = await getSession();
  if (session.currentItemId === itemId) {
    await setSession({
      status: PLAYBACK_STATES.IDLE,
      currentItemId: null,
      currentKind: null,
      completedLane: null,
      transitionToken: null,
      lastError: null
    });
  }
  await updateBadge();
  return { ok: true };
}

async function clearQueue(kind = null) {
  const removed = await withQueueLock(async () => {
    const items = await getItems();
    const next = kind ? items.filter((item) => item.kind !== kind) : [];
    await setItems(next);
    return items.length - next.length;
  });
  const session = await getSession();
  if (!kind || session.currentKind === kind) {
    await setSession({
      status: PLAYBACK_STATES.IDLE,
      currentItemId: null,
      currentKind: null,
      completedLane: null,
      transitionToken: null,
      lastError: null
    });
  }
  await updateBadge();
  return { ok: true, removed };
}

async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  return { ok: true };
}

async function setBudget(minutes) {
  const numericMinutes = Number(minutes);
  if (!Number.isInteger(numericMinutes) || numericMinutes < 0 || numericMinutes > 180) {
    return { ok: false, reason: "invalid-budget" };
  }
  const budgetMinutes = numericMinutes;
  const current = await getSession();
  const status = current.status === PLAYBACK_STATES.BUDGET_COMPLETE
    ? (current.currentItemId ? PLAYBACK_STATES.READY : PLAYBACK_STATES.IDLE)
    : current.status;
  const session = await setSession({
    status,
    budgetMinutes,
    startedAt: budgetMinutes ? Date.now() : null,
    lastError: null
  });
  return { ok: true, session };
}

async function batchItems(itemIds, action) {
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds.filter((id) => typeof id === "string") : [])];
  if (!ids.length || ids.length > 500 || !["remove", "top", "bottom"].includes(action)) {
    return { ok: false, reason: "invalid-batch" };
  }

  const selected = new Set(ids);
  const result = await withQueueLock(async () => {
    const items = await getItems();
    const found = items.filter((item) => selected.has(item.id));
    if (!found.length) return { ok: false, reason: "missing-items" };

    let next;
    if (action === "remove") {
      next = items.filter((item) => !selected.has(item.id));
    } else {
      const reorderLane = (kind) => {
        const lane = getLane(items, kind);
        const chosen = lane.filter((item) => selected.has(item.id));
        const rest = lane.filter((item) => !selected.has(item.id));
        return action === "top" ? [...chosen, ...rest] : [...rest, ...chosen];
      };
      next = [
        ...reorderLane(QUEUE_KINDS.SHORT),
        ...reorderLane(QUEUE_KINDS.VIDEO)
      ];
    }
    await setItems(next);
    return { ok: true, affected: found.length, items: next };
  });

  if (!result.ok) return result;
  if (action === "remove") {
    const session = await getSession();
    if (selected.has(session.currentItemId)) {
      await setSession({
        status: PLAYBACK_STATES.IDLE,
        currentItemId: null,
        currentKind: null,
        completedLane: null,
        transitionToken: null,
        lastError: null
      });
    }
  }
  await updateBadge();
  return result;
}

async function restoreBackup(rawPayload, mode = "merge") {
  if (typeof rawPayload !== "string" || rawPayload.length > 1_000_000) {
    return { ok: false, reason: "invalid-backup" };
  }
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  const [currentItems, currentSettings, currentHistory] = await Promise.all([
    getItems(),
    getSettings(),
    getHistory()
  ]);
  const restored = restoreBackupPayload(payload, currentItems, currentSettings, mode);
  if (!restored.ok) return restored;

  const history = restored.mode === "replace"
    ? restored.history
    : [...restored.history, ...currentHistory]
      .filter((entry, index, entries) => entries.findIndex((candidate) => (
        candidate.id === entry.id && candidate.completedAt === entry.completedAt
      )) === index)
      .slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SCHEMA]: SCHEMA_VERSION,
    [STORAGE_KEYS.SETTINGS]: restored.settings,
    [STORAGE_KEYS.ITEMS]: restored.items,
    [STORAGE_KEYS.HISTORY]: history
  });
  if (restored.mode === "replace") {
    await setSession({
      status: PLAYBACK_STATES.IDLE,
      currentItemId: null,
      currentKind: null,
      completedLane: null,
      transitionToken: null,
      lastError: null
    });
  }
  await updateBadge();
  return { ...restored, history };
}

async function restoreHistoryItem(historyId) {
  if (typeof historyId !== "string") return { ok: false, reason: "invalid-history-item" };
  const result = await withQueueLock(async () => {
    const [history, items, settings] = await Promise.all([getHistory(), getItems(), getSettings()]);
    const index = history.findIndex((entry) => `${entry.id}:${entry.completedAt}` === historyId);
    if (index < 0) return { ok: false, reason: "missing-history-item" };
    const entry = history[index];
    const item = createQueueItem(entry.sourceUrl, entry, Date.now(), settings);
    const added = addQueueItem(items, item, settings);
    const nextHistory = history.filter((_, candidateIndex) => candidateIndex !== index);
    await Promise.all([
      added.added ? setItems(added.items) : Promise.resolve(),
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: nextHistory })
    ]);
    return { ok: true, duplicate: !added.added, item: added.item };
  });
  await updateBadge();
  return result;
}

async function importYouTubeTabs(preferredWindowId, closeOriginals = false) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const [tabs, settings, session] = await Promise.all([
    chrome.tabs.query({ windowId }),
    getSettings(),
    getSession()
  ]);
  let imported = 0;
  const importedTabIds = [];

  await withQueueLock(async () => {
    let items = await getItems();
    for (const tab of tabs) {
      const rawUrl = tab.pendingUrl || tab.url;
      if (!rawUrl || tab.id === session.playerTabId) continue;
      const item = createQueueItem(rawUrl, { title: tab.title?.replace(/\s*-\s*YouTube\s*$/, "") }, Date.now(), settings);
      if (!item) continue;
      const result = addQueueItem(items, item, settings);
      items = result.items;
      if (result.added) {
        imported += 1;
        importedTabIds.push(tab.id);
      }
    }
    if (imported) await setItems(items);
  });
  if (closeOriginals && importedTabIds.length) await chrome.tabs.remove(importedTabIds);
  await updateBadge();
  return { ok: true, imported, closed: closeOriginals ? importedTabIds.length : 0 };
}

async function sleepInactiveVideos(preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const settings = await getSettings();
  if (!settings.sleepVideos) return { ok: true, slept: 0 };
  const tabs = await getClassicQueueTabs(windowId, QUEUE_KINDS.VIDEO);
  const eligible = tabs.filter((tab) => !tab.active && !tab.discarded);
  const results = await Promise.all(eligible.map((tab) => discardTab(tab.id)));
  return { ok: true, slept: results.filter(Boolean).length };
}

async function updateBadge() {
  try {
    const settings = await getSettings();
    let count = 0;
    let shortCount = 0;
    if (settings.captureMode === CAPTURE_MODES.QUEUE_ROOM) {
      const items = await getItems();
      count = items.length;
      shortCount = items.filter((item) => item.kind === QUEUE_KINDS.SHORT).length;
    } else {
      const windowId = await getTargetWindowId();
      const state = await getClassicState(windowId);
      count = state.short.count + state.video.count;
      shortCount = state.short.count;
    }
    await chrome.action.setBadgeText({ text: count ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: shortCount ? "#F26B3A" : "#3B5CCC" });
    await chrome.action.setTitle({ title: count ? `QueueTube · ${count} queued` : "QueueTube · queue clear" });
  } catch (error) {
    console.warn("QueueTube could not refresh its badge", error);
  }
}

async function migrateAndInitialize() {
  const existing = await chrome.storage.local.get(null);
  const migrated = migratePersistentState(existing);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SCHEMA]: migrated.schemaVersion,
    [STORAGE_KEYS.SETTINGS]: migrated.settings,
    [STORAGE_KEYS.ITEMS]: migrated.items,
    [STORAGE_KEYS.HISTORY]: migrated.history
  });
  const sessionStore = await chrome.storage.session.get(SESSION_KEY);
  if (!sessionStore[SESSION_KEY]) {
    await setSession({ budgetMinutes: migrated.settings.defaultBudgetMinutes, startedAt: null });
  } else {
    await chrome.storage.session.set({ [SESSION_KEY]: createSession(sessionStore[SESSION_KEY]) });
  }
  await updateBadge();
}

async function maybeSleepClassicVideo(tabId, tab) {
  if (tab.active || tab.discarded || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    if (group.title === QUEUE_GROUPS[QUEUE_KINDS.VIDEO].title) {
      const settings = await getSettings();
      if (settings.sleepVideos) await discardTab(tabId);
    }
  } catch (error) {
    console.warn("QueueTube could not inspect a classic queue tab", error);
  }
}

function respondAsync(sendResponse, operation) {
  (async () => {
    try {
      sendResponse(await operation());
    } catch (error) {
      console.error("QueueTube operation failed", error);
      sendResponse({ ok: false, reason: error?.message || "unexpected-error" });
    }
  })();
  return true;
}

async function runSafely(label, operation) {
  try {
    await operation();
  } catch (error) {
    console.error(`QueueTube ${label} failed`, error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void runSafely("installation", migrateAndInitialize);
});

chrome.runtime.onStartup.addListener(() => {
  void runSafely("startup", updateBadge);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedSender(sender)) return undefined;

  switch (message?.type) {
    case "QUEUE_URL":
      return respondAsync(sendResponse, () => queueUrl(message.url, message.metadata, sender.tab?.windowId));
    case "GET_APP_STATE":
      return respondAsync(sendResponse, () => getAppState(message.windowId));
    case "GET_QUEUE_KEYS":
      return respondAsync(sendResponse, async () => ({ ok: true, keys: (await getItems()).map((item) => item.key) }));
    case "OPEN_ITEM":
      return respondAsync(sendResponse, () => openItem(message.itemId, message.windowId));
    case "OPEN_NEXT":
      return respondAsync(sendResponse, () => openNext(message.kind, message.windowId));
    case "NEXT_ITEM":
    case "DEFER_CURRENT":
      return respondAsync(sendResponse, () => deferCurrent(message.windowId || sender.tab?.windowId));
    case "PREVIOUS_ITEM":
      return respondAsync(sendResponse, () => openPrevious(message.windowId || sender.tab?.windowId));
    case "SKIP_CURRENT":
      return respondAsync(sendResponse, () => finishCurrent(HISTORY_OUTCOMES.SKIPPED, message.windowId || sender.tab?.windowId));
    case "FINISH_CURRENT":
      return respondAsync(sendResponse, () => finishCurrent(
        message.outcome === HISTORY_OUTCOMES.SKIPPED ? HISTORY_OUTCOMES.SKIPPED : HISTORY_OUTCOMES.WATCHED,
        message.windowId || sender.tab?.windowId
      ));
    case "PLAYER_ENDED":
      return respondAsync(sendResponse, () => handlePlayerEnded(message, sender));
    case "PLAYER_STATE":
      return respondAsync(sendResponse, () => updatePlayerState(message, sender));
    case "GET_PLAYER_POLICY":
      return respondAsync(sendResponse, () => getPlayerPolicy(message, sender));
    case "FOCUS_PLAYER":
      return respondAsync(sendResponse, focusPlayer);
    case "GET_COMMAND_STATE":
      return respondAsync(sendResponse, getCommandState);
    case "OPEN_SHORTCUT_SETTINGS":
      return respondAsync(sendResponse, openShortcutSettings);
    case "MOVE_ITEM":
      return respondAsync(sendResponse, () => moveItem(message.itemId, message.targetIndex));
    case "REMOVE_ITEM":
      return respondAsync(sendResponse, () => removeItem(message.itemId));
    case "BATCH_ITEMS":
      return respondAsync(sendResponse, () => batchItems(message.itemIds, message.action));
    case "CLEAR_QUEUE":
      return respondAsync(sendResponse, () => clearQueue(message.kind));
    case "CLEAR_HISTORY":
      return respondAsync(sendResponse, clearHistory);
    case "RESTORE_HISTORY_ITEM":
      return respondAsync(sendResponse, () => restoreHistoryItem(message.historyId));
    case "RESTORE_BACKUP":
      return respondAsync(sendResponse, () => restoreBackup(message.payload, message.mode));
    case "SET_BUDGET":
      return respondAsync(sendResponse, () => setBudget(message.minutes));
    case "UPDATE_SETTINGS":
      return respondAsync(sendResponse, async () => {
        const settings = await setSettings(message.patch);
        await updateBadge();
        return { ok: true, settings };
      });
    case "IMPORT_TABS":
      return respondAsync(sendResponse, () => importYouTubeTabs(message.windowId, Boolean(message.closeOriginals)));
    case "SLEEP_VIDEOS":
      return respondAsync(sendResponse, () => sleepInactiveVideos(message.windowId));
    default:
      return undefined;
  }
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    try {
      if (command === "open-queue-room") {
        const currentWindow = await chrome.windows.getLastFocused();
        await chrome.sidePanel.open({ windowId: currentWindow.id });
      }
      if (command === "open-next-short") await openNext(QUEUE_KINDS.SHORT);
      if (command === "open-next-video") await openNext(QUEUE_KINDS.VIDEO);
      if (command === "skip-current") await finishCurrent(HISTORY_OUTCOMES.SKIPPED);
    } catch (error) {
      console.error("QueueTube shortcut failed", error);
    }
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    void runSafely("classic tab inspection", () => maybeSleepClassicVideo(tabId, tab));
  }
  if (changeInfo.groupId !== undefined || changeInfo.discarded !== undefined) {
    void runSafely("badge refresh", updateBadge);
  }
});

chrome.tabs.onActivated.addListener(({ windowId }) => {
  void runSafely("classic tab sleep", () => sleepInactiveVideos(windowId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void runSafely("tab removal", async () => {
    const session = await getSession();
    if (session.playerTabId === tabId) {
      await setSession({
        status: PLAYBACK_STATES.IDLE,
        playerTabId: null,
        currentItemId: null,
        currentKind: null,
        completedLane: null,
        transitionToken: null,
        lastError: null
      });
    }
    await updateBadge();
  });
});

chrome.tabs.onAttached.addListener(() => void runSafely("tab attach", updateBadge));
chrome.tabs.onDetached.addListener(() => void runSafely("tab detach", updateBadge));
chrome.tabGroups.onRemoved.addListener(() => void runSafely("group removal", updateBadge));
