import {
  CAPTURE_MODES,
  DEFAULT_SETTINGS,
  HISTORY_OUTCOMES,
  QUEUE_GROUPS,
  QUEUE_KINDS,
  addQueueItem,
  createQueueItem,
  getLane,
  getNextItem,
  historyEntry,
  isBudgetExpired,
  normalizeQueueUrl,
  queueKey,
  removeQueueItem,
  reorderQueueItem
} from "./queue-core.js";

const STORAGE_KEYS = Object.freeze({
  SETTINGS: "qtSettings",
  ITEMS: "qtQueueItems",
  HISTORY: "qtHistory"
});

const SESSION_KEY = "qtSession";
const HISTORY_LIMIT = 200;

async function withQueueLock(operation) {
  return navigator.locks.request("queuetube:queue-write", { mode: "exclusive" }, operation);
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
  return { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] };
}

async function setSettings(patch) {
  const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  const safePatch = Object.fromEntries(
    Object.entries(patch || {}).filter(([key, value]) => {
      if (!allowedKeys.has(key)) return false;
      if (key === "captureMode") return Object.values(CAPTURE_MODES).includes(value);
      if (key === "defaultBudgetMinutes") return [0, 10, 20, 30].includes(value);
      return typeof value === typeof DEFAULT_SETTINGS[key];
    })
  );
  const next = { ...(await getSettings()), ...safePatch };
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
  const stored = await chrome.storage.session.get({
    [SESSION_KEY]: {
      playerTabId: null,
      currentItemId: null,
      currentKind: null,
      budgetMinutes: 0,
      startedAt: null
    }
  });
  return stored[SESSION_KEY];
}

async function setSession(patch) {
  const next = { ...(await getSession()), ...patch };
  await chrome.storage.session.set({ [SESSION_KEY]: next });
  return next;
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

async function openPlaybackItem(item, preferredWindowId) {
  if (!item) return { ok: false, reason: "missing-item" };
  const session = await getSession();
  if (isBudgetExpired(session)) return { ok: false, reason: "budget-finished" };

  const windowId = await getTargetWindowId(preferredWindowId);
  const playerTab = await validPlayerTab(session);
  let tab;
  if (playerTab) {
    tab = await chrome.tabs.update(playerTab.id, { url: item.playbackUrl, active: true });
    if (playerTab.windowId !== windowId) {
      await chrome.windows.update(playerTab.windowId, { focused: true });
    }
  } else {
    tab = await chrome.tabs.create({ windowId, url: item.playbackUrl, active: true });
  }

  await setSession({ playerTabId: tab.id, currentItemId: item.id, currentKind: item.kind });
  return { ok: true, tabId: tab.id, itemId: item.id, kind: item.kind };
}

async function openItem(itemId, preferredWindowId) {
  const item = (await getItems()).find((entry) => entry.id === itemId);
  return openPlaybackItem(item, preferredWindowId);
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

async function openNext(kind, preferredWindowId) {
  const settings = await getSettings();
  if (settings.captureMode === CAPTURE_MODES.CLASSIC_TABS) {
    return openNextClassic(kind, preferredWindowId);
  }
  const [items, session] = await Promise.all([getItems(), getSession()]);
  const currentId = session.currentKind === kind ? session.currentItemId : null;
  const item = getNextItem(items, kind, currentId);
  return openPlaybackItem(item, preferredWindowId);
}

async function recordOutcome(itemId, outcome) {
  const result = await withQueueLock(async () => {
    const [items, history, settings] = await Promise.all([getItems(), getHistory(), getSettings()]);
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, reason: "missing-item" };

    const entry = historyEntry(item, outcome);
    const nextHistory = entry ? [entry, ...history].slice(0, HISTORY_LIMIT) : history;
    const nextItems = settings.removeFinished ? removeQueueItem(items, itemId) : items;
    await Promise.all([
      setItems(nextItems),
      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: nextHistory }),
      setSession({ currentItemId: null, currentKind: null })
    ]);
    return { ok: true, item, items: nextItems, settings };
  });
  await updateBadge();
  return result;
}

async function finishCurrent(outcome, preferredWindowId, { advance = true } = {}) {
  const session = await getSession();
  if (!session.currentItemId) return { ok: false, reason: "no-current-item" };
  const result = await recordOutcome(session.currentItemId, outcome);
  if (!result.ok || !advance) return result;

  const next = getNextItem(
    result.items,
    result.item.kind,
    result.settings.removeFinished ? null : result.item.id
  );
  if (!next) return { ok: true, finished: true, queueEnded: true };
  const opened = await openPlaybackItem(next, preferredWindowId);
  return { ...opened, finished: true };
}

async function handlePlayerEnded(sender) {
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  if (sender.tab?.id !== session.playerTabId || !session.currentItemId) {
    return { ok: false, reason: "not-current-player" };
  }
  const shouldAdvance = session.currentKind === QUEUE_KINDS.SHORT && settings.autoAdvanceShorts;
  return finishCurrent(HISTORY_OUTCOMES.WATCHED, sender.tab.windowId, { advance: shouldAdvance });
}

async function openPrevious(preferredWindowId) {
  const history = await getHistory();
  const previous = history[0];
  if (!previous) return { ok: false, reason: "no-history" };

  const settings = await getSettings();
  const restored = createQueueItem(previous.sourceUrl, previous, Date.now(), settings);
  const result = addQueueItem(await getItems(), restored, { preventDuplicates: true });
  if (result.added) await setItems(result.items);
  return openPlaybackItem(result.item, preferredWindowId);
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
    await setSession({ currentItemId: null, currentKind: null });
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
  await setSession({ currentItemId: null, currentKind: null });
  await updateBadge();
  return { ok: true, removed };
}

async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  return { ok: true };
}

async function setBudget(minutes) {
  const budgetMinutes = [0, 10, 20, 30].includes(Number(minutes)) ? Number(minutes) : 0;
  const session = await setSession({
    budgetMinutes,
    startedAt: budgetMinutes ? Date.now() : null
  });
  return { ok: true, session };
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
  const legacy = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS)
      .filter((key) => existing[key] !== undefined)
      .map((key) => [key, existing[key]])
  );
  const settings = { ...DEFAULT_SETTINGS, ...(existing[STORAGE_KEYS.SETTINGS] || {}), ...legacy };
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings,
    [STORAGE_KEYS.ITEMS]: Array.isArray(existing[STORAGE_KEYS.ITEMS]) ? existing[STORAGE_KEYS.ITEMS] : [],
    [STORAGE_KEYS.HISTORY]: Array.isArray(existing[STORAGE_KEYS.HISTORY]) ? existing[STORAGE_KEYS.HISTORY] : []
  });
  if (!existing[SESSION_KEY]) {
    await setSession({ budgetMinutes: settings.defaultBudgetMinutes, startedAt: null });
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
      return respondAsync(sendResponse, async () => {
        const session = await getSession();
        return openNext(session.currentKind, message.windowId || sender.tab?.windowId);
      });
    case "PREVIOUS_ITEM":
      return respondAsync(sendResponse, () => openPrevious(message.windowId || sender.tab?.windowId));
    case "SKIP_CURRENT":
      return respondAsync(sendResponse, () => finishCurrent(HISTORY_OUTCOMES.SKIPPED, message.windowId || sender.tab?.windowId));
    case "PLAYER_ENDED":
      return respondAsync(sendResponse, () => handlePlayerEnded(sender));
    case "MOVE_ITEM":
      return respondAsync(sendResponse, () => moveItem(message.itemId, message.targetIndex));
    case "REMOVE_ITEM":
      return respondAsync(sendResponse, () => removeItem(message.itemId));
    case "CLEAR_QUEUE":
      return respondAsync(sendResponse, () => clearQueue(message.kind));
    case "CLEAR_HISTORY":
      return respondAsync(sendResponse, clearHistory);
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
      await setSession({ playerTabId: null, currentItemId: null, currentKind: null });
    }
    await updateBadge();
  });
});

chrome.tabs.onAttached.addListener(() => void runSafely("tab attach", updateBadge));
chrome.tabs.onDetached.addListener(() => void runSafely("tab detach", updateBadge));
chrome.tabGroups.onRemoved.addListener(() => void runSafely("group removal", updateBadge));
