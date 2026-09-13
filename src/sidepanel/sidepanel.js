const IS_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);
const totalCount = document.getElementById("total-count");
const shortCount = document.getElementById("short-count");
const videoCount = document.getElementById("video-count");
const historyCount = document.getElementById("history-count");
const shortList = document.getElementById("short-list");
const videoList = document.getElementById("video-list");
const historyList = document.getElementById("history-list");
const shortEmpty = document.getElementById("short-empty");
const videoEmpty = document.getElementById("video-empty");
const historyEmpty = document.getElementById("history-empty");
const budgetCopy = document.getElementById("budget-copy");
const status = document.getElementById("status");
const captureMode = document.getElementById("capture-mode");
const settingInputs = [...document.querySelectorAll("[data-setting]")];
const budgetButtons = [...document.querySelectorAll("[data-budget]")];
const laneButtons = [...document.querySelectorAll("[data-open-lane]")];
const queueTab = document.getElementById("queue-tab");
const historyTab = document.getElementById("history-tab");
const queueView = document.getElementById("queue-view");
const historyView = document.getElementById("history-view");
const importDialog = document.getElementById("import-dialog");
const clearDialog = document.getElementById("clear-dialog");
const closeImportedTabs = document.getElementById("close-imported-tabs");
const itemTemplate = document.getElementById("queue-item-template");

let appState = null;
let currentWindowId = null;
let draggedItemId = null;
let refreshTimer = null;

const DEMO_STATE = {
  ok: true,
  settings: {
    captureMode: "queue-room",
    captureCtrlClick: true,
    captureMiddleClick: true,
    pauseBackground: true,
    focusShield: true,
    showQueuedBadges: true,
    autoAdvanceShorts: true,
    removeFinished: true,
    preventDuplicates: true
  },
  session: { currentItemId: "short:demo-one", budgetMinutes: 20, startedAt: Date.now() - 372000 },
  items: [
    { id: "short:demo-one", key: "short:demo-one", kind: "short", title: "The tiny design habit that changes everything", channel: "Build Better", durationText: "0:42", thumbnailUrl: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg" },
    { id: "short:demo-two", key: "short:demo-two", kind: "short", title: "Three keyboard moves worth learning", channel: "Calm Computing", durationText: "0:31", thumbnailUrl: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg" },
    { id: "video:demo-three", key: "video:demo-three", kind: "video", title: "A practical guide to building focused systems", channel: "Deep Workbench", durationText: "18:24", thumbnailUrl: "https://i.ytimg.com/vi/ysz5S6PUM-U/hqdefault.jpg" },
    { id: "video:demo-four", key: "video:demo-four", kind: "video", title: "How browsers manage memory", channel: "Under the Hood", durationText: "12:08", thumbnailUrl: "https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg" }
  ],
  history: [
    { id: "short:history", kind: "short", title: "A clean desk in sixty seconds", channel: "Small Systems", outcome: "watched", completedAt: Date.now() - 3600000 }
  ]
};

function setStatus(message) {
  status.textContent = message;
}

async function send(message) {
  if (!IS_EXTENSION) return { ok: true };
  try {
    return await chrome.runtime.sendMessage({ ...message, windowId: currentWindowId });
  } catch {
    setStatus("QueueTube lost its browser connection. Reload the extension once.");
    return { ok: false, reason: "extension-unavailable" };
  }
}

function laneItems(kind) {
  return (appState?.items || []).filter((item) => item.kind === kind);
}

function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} remaining`;
}

function renderBudget() {
  const budgetMinutes = Number(appState?.session?.budgetMinutes) || 0;
  const startedAt = Number(appState?.session?.startedAt) || Date.now();
  const remaining = budgetMinutes ? Math.max(0, budgetMinutes * 60_000 - (Date.now() - startedAt)) : null;
  budgetCopy.textContent = remaining === null ? "No time limit" : remaining ? formatRemaining(remaining) : "Session complete";
  budgetButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.budget) === budgetMinutes));
  });
}

function createQueueRow(item, lane, laneIndex) {
  const row = itemTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.itemId = item.id;
  row.dataset.kind = item.kind;
  row.dataset.laneIndex = String(laneIndex);
  row.classList.toggle("is-current", item.id === appState.session?.currentItemId);
  if (item.id === appState.session?.currentItemId) row.setAttribute("aria-current", "true");
  row.querySelector("img").src = item.thumbnailUrl;
  row.querySelector(".duration").textContent = item.durationText || "";
  row.querySelector(".item-title").textContent = item.title;
  row.querySelector(".item-channel").textContent = item.channel;
  row.querySelector("[data-action='up']").disabled = laneIndex === 0;
  row.querySelector("[data-action='down']").disabled = laneIndex === lane.length - 1;
  row.querySelectorAll("[data-action='play']").forEach((button) => {
    button.setAttribute("aria-label", `Play ${item.title}`);
  });
  return row;
}

function renderLane(kind, list, empty, countElement) {
  const lane = laneItems(kind);
  const fragment = document.createDocumentFragment();
  lane.forEach((item, index) => fragment.append(createQueueRow(item, lane, index)));
  list.replaceChildren(fragment);
  empty.hidden = lane.length > 0;
  countElement.textContent = String(lane.length);
  const button = laneButtons.find((entry) => entry.dataset.openLane === kind);
  if (button) button.disabled = lane.length === 0;
}

function renderHistory() {
  const entries = appState.history || [];
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `history-dot ${entry.outcome === "skipped" ? "skipped" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "history-copy";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const detail = document.createElement("small");
    const completed = Number(entry.completedAt) ? new Date(entry.completedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Earlier";
    detail.textContent = `${entry.outcome === "skipped" ? "Skipped" : "Watched"} · ${entry.channel} · ${completed}`;
    copy.append(title, detail);
    const kind = document.createElement("span");
    kind.className = "history-kind";
    kind.textContent = entry.kind;
    row.append(dot, copy, kind);
    fragment.append(row);
  }
  historyList.replaceChildren(fragment);
  historyEmpty.hidden = entries.length > 0;
  historyCount.textContent = String(entries.length);
  document.getElementById("clear-history").disabled = entries.length === 0;
}

function renderSettings() {
  captureMode.value = appState.settings.captureMode;
  settingInputs.forEach((input) => {
    input.checked = Boolean(appState.settings[input.dataset.setting]);
  });
}

function render() {
  renderLane("short", shortList, shortEmpty, shortCount);
  renderLane("video", videoList, videoEmpty, videoCount);
  renderHistory();
  renderSettings();
  renderBudget();
  totalCount.textContent = String((appState.items || []).length);
  document.getElementById("clear-queue").disabled = (appState.items || []).length === 0;
}

async function refresh() {
  try {
    appState = IS_EXTENSION ? await send({ type: "GET_APP_STATE" }) : DEMO_STATE;
    if (!appState?.ok) throw new Error("state unavailable");
    render();
  } catch {
    setStatus("Couldn’t read the queue. Reload the extension once.");
  }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 80);
}

function switchView(view) {
  const showQueue = view === "queue";
  queueTab.setAttribute("aria-selected", String(showQueue));
  historyTab.setAttribute("aria-selected", String(!showQueue));
  queueTab.tabIndex = showQueue ? 0 : -1;
  historyTab.tabIndex = showQueue ? -1 : 0;
  queueView.hidden = !showQueue;
  historyView.hidden = showQueue;
  (showQueue ? queueTab : historyTab).focus();
}

async function handleQueueAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const row = actionButton.closest(".queue-item");
  if (!row) return;
  const itemId = row.dataset.itemId;
  const laneIndex = Number(row.dataset.laneIndex);
  const action = actionButton.dataset.action;

  if (action === "play") {
    const result = await send({ type: "OPEN_ITEM", itemId });
    setStatus(result?.ok ? "Loaded in the QueueTube player. Press play when ready." : result?.reason === "budget-finished" ? "Your time budget is complete." : "Couldn’t open that pick.");
  }
  if (action === "remove") {
    await send({ type: "REMOVE_ITEM", itemId });
    setStatus("Removed from the queue.");
  }
  if (action === "up" || action === "down") {
    const targetIndex = laneIndex + (action === "up" ? -1 : 1);
    await send({ type: "MOVE_ITEM", itemId, targetIndex });
    setStatus(`Moved ${action}.`);
  }
  await refresh();
}

function clearDropStyles() {
  document.querySelectorAll(".is-dragging, .is-drop-target").forEach((row) => row.classList.remove("is-dragging", "is-drop-target"));
}

document.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".queue-item");
  if (!row) return;
  draggedItemId = row.dataset.itemId;
  row.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedItemId);
});

document.addEventListener("dragover", (event) => {
  const row = event.target.closest(".queue-item");
  if (!row || !draggedItemId) return;
  const dragged = document.querySelector(`[data-item-id="${CSS.escape(draggedItemId)}"]`);
  if (dragged?.dataset.kind !== row.dataset.kind) return;
  event.preventDefault();
  document.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
  row.classList.add("is-drop-target");
});

document.addEventListener("drop", (event) => {
  const row = event.target.closest(".queue-item");
  if (!row || !draggedItemId) return;
  event.preventDefault();
  const targetIndex = Number(row.dataset.laneIndex);
  const itemId = draggedItemId;
  draggedItemId = null;
  clearDropStyles();
  void (async () => {
    await send({ type: "MOVE_ITEM", itemId, targetIndex });
    await refresh();
    setStatus("Queue order updated.");
  })();
});

document.addEventListener("dragend", () => {
  draggedItemId = null;
  clearDropStyles();
});

shortList.addEventListener("click", (event) => void handleQueueAction(event));
videoList.addEventListener("click", (event) => void handleQueueAction(event));

laneButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const result = await send({ type: "OPEN_NEXT", kind: button.dataset.openLane });
    setStatus(result?.ok ? "Player ready. Playback stays manual." : result?.reason === "budget-finished" ? "Your time budget is complete." : "That lane is empty.");
    await refresh();
  });
});

budgetButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await send({ type: "SET_BUDGET", minutes: Number(button.dataset.budget) });
    await refresh();
    setStatus(Number(button.dataset.budget) ? `${button.dataset.budget}-minute session started.` : "Time limit removed.");
  });
});

settingInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    await send({ type: "UPDATE_SETTINGS", patch: { [input.dataset.setting]: input.checked } });
    await refresh();
    setStatus("Setting saved.");
  });
});

captureMode.addEventListener("change", async () => {
  await send({ type: "UPDATE_SETTINGS", patch: { captureMode: captureMode.value } });
  await refresh();
  setStatus(captureMode.value === "queue-room" ? "Queue Room will save picks without tabs." : "Classic mode will open grouped tabs.");
});

queueTab.addEventListener("click", () => switchView("queue"));
historyTab.addEventListener("click", () => switchView("history"));
[queueTab, historyTab].forEach((tab) => {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") switchView("queue");
    else if (event.key === "End") switchView("history");
    else switchView(tab === queueTab ? "history" : "queue");
  });
});

document.getElementById("import-tabs").addEventListener("click", () => importDialog.showModal());
importDialog.addEventListener("close", () => {
  if (importDialog.returnValue !== "confirm") return;
  void (async () => {
    const result = await send({ type: "IMPORT_TABS", closeOriginals: closeImportedTabs.checked });
    await refresh();
    setStatus(result?.imported ? `Imported ${result.imported} tab${result.imported === 1 ? "" : "s"}${result.closed ? ` and closed ${result.closed}` : ""}.` : "No new YouTube tabs found.");
    closeImportedTabs.checked = false;
  })();
});

document.getElementById("clear-queue").addEventListener("click", () => clearDialog.showModal());
clearDialog.addEventListener("close", () => {
  if (clearDialog.returnValue !== "confirm") return;
  void (async () => {
    const result = await send({ type: "CLEAR_QUEUE" });
    await refresh();
    setStatus(`Removed ${result?.removed || 0} waiting pick${result?.removed === 1 ? "" : "s"}.`);
  })();
});

document.getElementById("clear-history").addEventListener("click", async () => {
  if (!window.confirm("Clear your local QueueTube history?")) return;
  await send({ type: "CLEAR_HISTORY" });
  await refresh();
  setStatus("History cleared.");
});

document.getElementById("copy-backup").addEventListener("click", async () => {
  const payload = JSON.stringify({ version: 2, items: appState.items, history: appState.history }, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    setStatus("Queue backup copied.");
  } catch {
    setStatus("Clipboard access was unavailable.");
  }
});

if (IS_EXTENSION) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.qtQueueItems || changes.qtHistory || changes.qtSettings)) scheduleRefresh();
    if (areaName === "session" && changes.qtSession) scheduleRefresh();
  });
}

window.setInterval(renderBudget, 1000);

void (async () => {
  try {
    if (IS_EXTENSION) {
      const currentWindow = await chrome.windows.getCurrent();
      currentWindowId = currentWindow.id;
    }
    await refresh();
    setStatus(IS_EXTENSION ? "Ready. Ctrl-click a YouTube pick." : "Preview data · Queue Room ready.");
  } catch {
    setStatus("QueueTube couldn’t initialize. Reload the extension once.");
  }
})();
