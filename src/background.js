import {
  QUEUE_GROUPS,
  QUEUE_KINDS,
  classifyYouTubeUrl,
  normalizeQueueUrl,
  queueKey
} from "./queue-core.js";

const DEFAULT_SETTINGS = Object.freeze({
  captureCtrlClick: true,
  captureMiddleClick: true,
  shortsInPlayer: true,
  pauseBackground: true,
  sleepVideos: true,
  preventDuplicates: true
});

async function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

async function getTargetWindowId(preferredWindowId) {
  if (Number.isInteger(preferredWindowId)) return preferredWindowId;
  const currentWindow = await chrome.windows.getLastFocused();
  return currentWindow.id;
}

async function findQueueGroup(windowId, kind) {
  const definition = QUEUE_GROUPS[kind];
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === definition.title) || null;
}

async function getQueueTabs(windowId, kind) {
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
  } catch {
    // Ordering is cosmetic; a momentary Chrome move race must not lose the pick.
  }
}

async function findDuplicate(windowId, kind, key) {
  const tabs = await getQueueTabs(windowId, kind);
  return tabs.find((tab) => queueKey(tab.pendingUrl || tab.url) === key) || null;
}

async function discardTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active || tab.discarded) return Boolean(tab.discarded);
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    const discarded = await chrome.tabs.discard(tabId);
    return Boolean(discarded?.discarded);
  } catch {
    return false;
  }
}

async function queueUrl(rawUrl, preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const settings = await getSettings();
  const normalized = normalizeQueueUrl(rawUrl, settings);
  if (!normalized) return { ok: false, reason: "not-a-video" };

  if (settings.preventDuplicates) {
    const duplicate = await findDuplicate(windowId, normalized.kind, normalized.key);
    if (duplicate) {
      return {
        ok: true,
        duplicate: true,
        kind: normalized.kind,
        tabId: duplicate.id,
        sleeping: Boolean(duplicate.discarded)
      };
    }
  }

  const tab = await chrome.tabs.create({
    windowId,
    url: normalized.url,
    active: false
  });

  await ensureQueueGroup(windowId, normalized.kind, tab.id);
  await orderQueueGroups(windowId);

  let sleeping = false;
  if (normalized.kind === QUEUE_KINDS.VIDEO && settings.sleepVideos) {
    sleeping = await discardTab(tab.id);
  }

  await updateBadge();
  return {
    ok: true,
    duplicate: false,
    kind: normalized.kind,
    tabId: tab.id,
    sleeping
  };
}

async function getQueueState(preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const [settings, shorts, videos] = await Promise.all([
    getSettings(),
    getQueueTabs(windowId, QUEUE_KINDS.SHORT),
    getQueueTabs(windowId, QUEUE_KINDS.VIDEO)
  ]);

  return {
    windowId,
    settings,
    queues: {
      short: {
        count: shorts.length,
        sleeping: shorts.filter((tab) => tab.discarded).length
      },
      video: {
        count: videos.length,
        sleeping: videos.filter((tab) => tab.discarded).length
      }
    }
  };
}

async function openNext(kind, preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const tabs = await getQueueTabs(windowId, kind);
  if (!tabs.length) return { ok: false, reason: "empty" };

  const orderedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const activeIndex = orderedTabs.findIndex((tab) => tab.active);
  const nextTab = activeIndex >= 0 ? orderedTabs[activeIndex + 1] : orderedTabs[0];
  if (!nextTab) return { ok: false, reason: "end-of-queue" };
  const group = await findQueueGroup(windowId, kind);
  if (group?.collapsed) {
    await chrome.tabGroups.update(group.id, { collapsed: false });
  }
  await chrome.tabs.update(nextTab.id, { active: true });
  return { ok: true, tabId: nextTab.id };
}

async function sleepInactiveVideos(preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const settings = await getSettings();
  if (!settings.sleepVideos) return { ok: true, slept: 0 };

  const tabs = await getQueueTabs(windowId, QUEUE_KINDS.VIDEO);
  const eligible = tabs.filter((tab) => !tab.active && !tab.discarded);
  const results = await Promise.all(eligible.map((tab) => discardTab(tab.id)));
  const group = await findQueueGroup(windowId, QUEUE_KINDS.VIDEO);
  if (group && !tabs.some((tab) => tab.active)) {
    await chrome.tabGroups.update(group.id, { collapsed: true });
  }
  return { ok: true, slept: results.filter(Boolean).length };
}

async function clearQueues(preferredWindowId) {
  const windowId = await getTargetWindowId(preferredWindowId);
  const [shorts, videos] = await Promise.all([
    getQueueTabs(windowId, QUEUE_KINDS.SHORT),
    getQueueTabs(windowId, QUEUE_KINDS.VIDEO)
  ]);
  const tabIds = [...shorts, ...videos].map((tab) => tab.id);
  if (tabIds.length) await chrome.tabs.remove(tabIds);
  await updateBadge();
  return { ok: true, removed: tabIds.length };
}

async function updateBadge() {
  try {
    const groups = await chrome.tabGroups.query({});
    const queueGroupIds = new Set(
      groups
        .filter((group) => Object.values(QUEUE_GROUPS).some((item) => item.title === group.title))
        .map((group) => group.id)
    );
    const tabs = await chrome.tabs.query({});
    const queuedTabs = tabs.filter((tab) => queueGroupIds.has(tab.groupId));
    const shortCount = queuedTabs.filter(
      (tab) => classifyYouTubeUrl(tab.pendingUrl || tab.url)?.kind === QUEUE_KINDS.SHORT
    ).length;
    const total = queuedTabs.length;

    await chrome.action.setBadgeText({ text: total ? String(total) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: shortCount ? "#F26B3A" : "#3B5CCC" });
    await chrome.action.setTitle({
      title: total ? `QueueTube · ${total} queued` : "QueueTube · lanes clear"
    });
  } catch {
    // Chrome can briefly invalidate group IDs while tabs are moving or closing.
  }
}

async function maybeSleepCompletedVideo(tabId, tab) {
  if (tab.active || tab.discarded || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    if (group.title === QUEUE_GROUPS[QUEUE_KINDS.VIDEO].title) {
      const settings = await getSettings();
      if (settings.sleepVideos) await discardTab(tabId);
    }
  } catch {
    // The tab or group may have disappeared between update events.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...existing });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "QUEUE_URL":
        return queueUrl(message.url, sender.tab?.windowId);
      case "GET_POPUP_STATE":
        return getQueueState(message.windowId);
      case "OPEN_NEXT":
        return openNext(message.kind, message.windowId);
      case "SLEEP_VIDEOS":
        return sleepInactiveVideos(message.windowId);
      case "CLEAR_QUEUES":
        return clearQueues(message.windowId);
      case "SETTINGS_UPDATED":
        await sleepInactiveVideos(message.windowId);
        return { ok: true };
      default:
        return { ok: false, reason: "unknown-message" };
    }
  };

  run().then(sendResponse).catch((error) => {
    sendResponse({ ok: false, reason: error?.message || "unexpected-error" });
  });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-next-short") await openNext(QUEUE_KINDS.SHORT);
  if (command === "open-next-video") await openNext(QUEUE_KINDS.VIDEO);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") maybeSleepCompletedVideo(tabId, tab);
  if (changeInfo.groupId !== undefined || changeInfo.discarded !== undefined) updateBadge();
});

chrome.tabs.onActivated.addListener(({ windowId }) => {
  sleepInactiveVideos(windowId);
});

chrome.tabs.onRemoved.addListener(() => updateBadge());
chrome.tabs.onAttached.addListener(() => updateBadge());
chrome.tabs.onDetached.addListener(() => updateBadge());
chrome.tabGroups.onRemoved.addListener(() => updateBadge());
