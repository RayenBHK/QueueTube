const IS_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);
const byId = (id) => document.getElementById(id);
const elements = {
  totalCount: byId("total-count"), shortCount: byId("short-count"), videoCount: byId("video-count"), historyCount: byId("history-count"),
  shortList: byId("short-list"), videoList: byId("video-list"), historyList: byId("history-list"),
  shortEmpty: byId("short-empty"), videoEmpty: byId("video-empty"), historyEmpty: byId("history-empty"),
  budgetCopy: byId("budget-copy"), status: byId("status"), captureMode: byId("capture-mode"), theme: byId("theme-select"),
  queueTab: byId("queue-tab"), historyTab: byId("history-tab"), queueView: byId("queue-view"), historyView: byId("history-view"),
  importDialog: byId("import-dialog"), clearDialog: byId("clear-dialog"), restoreDialog: byId("restore-dialog"), helpDialog: byId("help-dialog"),
  itemTemplate: byId("queue-item-template"), batchToolbar: byId("batch-toolbar"), selectedCount: byId("selected-count"), commandList: byId("command-list")
};
const settingInputs = [...document.querySelectorAll("[data-setting]")];
const budgetButtons = [...document.querySelectorAll("[data-budget]")];
const laneButtons = [...document.querySelectorAll("[data-open-lane]")];
const selectedItems = new Set();

let appState = null;
let commandState = [];
let currentWindowId = null;
let draggedItemId = null;
let selecting = false;
let refreshTimer = null;

const DEMO_STATE = {
  ok: true,
  schemaVersion: 3,
  settings: {
    captureMode: "queue-room", captureCtrlClick: true, captureMiddleClick: true, pauseBackground: true,
    focusShield: true, showQueuedBadges: true, autoAdvanceShorts: true, autoAdvanceVideos: true,
    removeFinished: true, preventDuplicates: true, theme: "system", compactDensity: false
  },
  session: {
    status: "ready", currentItemId: "short:demo-one", currentKind: "short", completedLane: null,
    playerTabId: 12, budgetMinutes: 20, startedAt: Date.now() - 372000
  },
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
  elements.status.textContent = message;
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

function currentItem() {
  return (appState?.items || []).find((item) => item.id === appState?.session?.currentItemId) || null;
}

function applyTheme(theme) {
  const safeTheme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = safeTheme;
  try { localStorage.setItem("qt-theme-cache", safeTheme); } catch { /* Keep the live theme. */ }
}

function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} remaining`;
}

function renderBudget() {
  const budgetMinutes = Number(appState?.session?.budgetMinutes) || 0;
  const startedAt = Number(appState?.session?.startedAt) || Date.now();
  const remaining = budgetMinutes ? Math.max(0, budgetMinutes * 60_000 - (Date.now() - startedAt)) : null;
  elements.budgetCopy.textContent = remaining === null ? "No time limit" : remaining ? formatRemaining(remaining) : "Session complete";
  budgetButtons.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.budget) === budgetMinutes)));
}

function readableState(value) {
  const labels = {
    idle: "Idle", loading: "Loading", ready: "Ready · paused", playing: "Playing", advancing: "Advancing",
    "lane-complete": "Lane complete", "budget-complete": "Time is up", error: "Needs attention"
  };
  return labels[value] || "Idle";
}

function renderNowPlaying() {
  const item = currentItem();
  const session = appState?.session || {};
  const lane = item ? laneItems(item.kind) : [];
  const position = item ? lane.findIndex((entry) => entry.id === item.id) : -1;
  const next = position >= 0 ? lane[position + 1] : null;
  const hasPlayer = Number.isInteger(session.playerTabId);
  const hasHistory = (appState?.history || []).length > 0;

  byId("player-state").textContent = readableState(session.status);
  byId("now-playing").dataset.kind = item?.kind || "";
  byId("now-empty").hidden = Boolean(item);
  byId("now-content").hidden = !item;
  if (item) {
    byId("now-thumbnail").src = item.thumbnailUrl;
    byId("now-title").textContent = item.title;
    byId("now-kind").textContent = item.kind === "short" ? "Short" : "Video";
    byId("now-meta").textContent = `${item.channel}${item.durationText ? ` · ${item.durationText}` : ""}`;
    byId("now-context").textContent = `${position + 1} of ${lane.length} in ${item.kind === "short" ? "Shorts" : "Videos"}${next ? ` · Next: ${next.title}` : " · Last in lane"}`;
  } else if (session.status === "budget-complete") {
    byId("now-context").textContent = "Your session budget is complete. Set a new limit or choose ∞ to continue.";
  } else {
    byId("now-context").textContent = "Choose a lane to begin.";
  }

  byId("focus-player").disabled = !hasPlayer;
  byId("previous-item").disabled = !hasHistory;
  ["finish-current", "defer-current", "skip-current"].forEach((id) => { byId(id).disabled = !item; });

  const handoff = byId("lane-handoff");
  const completed = session.status === "lane-complete" ? session.completedLane : null;
  const targetKind = completed === "short" ? "video" : completed === "video" ? "short" : null;
  const targetCount = targetKind ? laneItems(targetKind).length : 0;
  handoff.hidden = !completed;
  if (completed) {
    byId("handoff-title").textContent = `${completed === "short" ? "Shorts" : "Videos"} complete.`;
    byId("handoff-copy").textContent = targetCount ? `${targetCount} ${targetKind === "short" ? "Shorts" : "videos"} are waiting.` : "The other lane is clear.";
    byId("handoff-action").textContent = targetKind === "video" ? "Start videos →" : "Start Shorts →";
    byId("handoff-action").dataset.kind = targetKind || "";
    byId("handoff-action").disabled = !targetCount;
  }
}

function createQueueRow(item, lane, laneIndex) {
  const row = elements.itemTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.itemId = item.id;
  row.dataset.kind = item.kind;
  row.dataset.laneIndex = String(laneIndex);
  row.draggable = !selecting;
  row.classList.toggle("is-current", item.id === appState.session?.currentItemId);
  if (item.id === appState.session?.currentItemId) row.setAttribute("aria-current", "true");
  const image = row.querySelector("img");
  image.src = item.thumbnailUrl;
  image.alt = "";
  row.querySelector(".duration").textContent = item.durationText || "";
  row.querySelector(".item-title").textContent = item.title;
  row.querySelector(".item-channel").textContent = item.channel;
  row.querySelector("[data-action='up']").disabled = laneIndex === 0;
  row.querySelector("[data-action='down']").disabled = laneIndex === lane.length - 1;
  row.querySelectorAll("[data-action='play']").forEach((button) => button.setAttribute("aria-label", `Load ${item.title}`));
  const checkbox = row.querySelector("[data-select-item]");
  checkbox.checked = selectedItems.has(item.id);
  checkbox.setAttribute("aria-label", `Select ${item.title}`);
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

function historyMatches(entry, filter) {
  return filter === "all" || entry.outcome === filter || entry.kind === filter;
}

function renderHistory() {
  const filter = byId("history-filter").value;
  const entries = (appState.history || []).filter((entry) => historyMatches(entry, filter));
  const fragment = document.createDocumentFragment();
  let previousDay = "";
  for (const entry of entries) {
    const completedDate = Number(entry.completedAt) ? new Date(entry.completedAt) : null;
    const day = completedDate ? completedDate.toLocaleDateString([], { dateStyle: "medium" }) : "Earlier";
    if (day !== previousDay) {
      const group = document.createElement("li");
      group.className = "history-group";
      group.textContent = day;
      fragment.append(group);
      previousDay = day;
    }
    const row = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `history-dot ${entry.outcome === "skipped" ? "skipped" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "history-copy";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const detail = document.createElement("small");
    const completed = completedDate ? completedDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Earlier";
    detail.textContent = `${entry.outcome === "skipped" ? "Skipped" : "Watched"} · ${entry.channel} · ${completed}`;
    copy.append(title, detail);
    const kind = document.createElement("span");
    kind.className = "history-kind";
    kind.textContent = entry.kind;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "history-restore";
    restore.textContent = "Restore";
    restore.dataset.historyId = `${entry.id}:${entry.completedAt}`;
    restore.setAttribute("aria-label", `Restore ${entry.title} to the queue`);
    row.append(dot, copy, kind, restore);
    fragment.append(row);
  }
  elements.historyList.replaceChildren(fragment);
  elements.historyEmpty.hidden = entries.length > 0;
  elements.historyCount.textContent = String((appState.history || []).length);
  byId("clear-history").disabled = (appState.history || []).length === 0;
}

function renderSettings() {
  elements.captureMode.value = appState.settings.captureMode;
  elements.theme.value = appState.settings.theme || "system";
  settingInputs.forEach((input) => { input.checked = Boolean(appState.settings[input.dataset.setting]); });
  document.body.classList.toggle("compact", Boolean(appState.settings.compactDensity));
  applyTheme(appState.settings.theme);
}

function renderSelection() {
  document.body.classList.toggle("is-selecting", selecting);
  byId("toggle-select").hidden = selecting;
  elements.batchToolbar.hidden = !selecting;
  elements.selectedCount.textContent = String(selectedItems.size);
  document.querySelectorAll("[data-batch]").forEach((button) => { button.disabled = selectedItems.size === 0; });
}

function renderCommands() {
  const fragment = document.createDocumentFragment();
  for (const command of commandState) {
    const row = document.createElement("li");
    row.classList.toggle("is-missing", !command.shortcut);
    const label = document.createElement("span");
    label.textContent = command.description;
    const key = document.createElement("span");
    key.textContent = command.shortcut || `Not set · try ${command.recommended || "Chrome settings"}`;
    row.append(label, key);
    fragment.append(row);
  }
  elements.commandList.replaceChildren(fragment);
}

function render() {
  renderLane("short", elements.shortList, elements.shortEmpty, elements.shortCount);
  renderLane("video", elements.videoList, elements.videoEmpty, elements.videoCount);
  renderHistory();
  renderSettings();
  renderBudget();
  renderNowPlaying();
  renderSelection();
  renderCommands();
  elements.totalCount.textContent = String((appState.items || []).length);
  byId("clear-queue").disabled = (appState.items || []).length === 0;
}

async function refresh({ commands = false } = {}) {
  try {
    const [nextState, nextCommands] = await Promise.all([
      IS_EXTENSION ? send({ type: "GET_APP_STATE" }) : Promise.resolve(DEMO_STATE),
      commands && IS_EXTENSION ? send({ type: "GET_COMMAND_STATE" }) : Promise.resolve(null)
    ]);
    if (!nextState?.ok) throw new Error("state unavailable");
    appState = nextState;
    if (nextCommands?.ok) commandState = nextCommands.commands;
    for (const id of [...selectedItems]) {
      if (!appState.items.some((item) => item.id === id)) selectedItems.delete(id);
    }
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
  elements.queueTab.setAttribute("aria-selected", String(showQueue));
  elements.historyTab.setAttribute("aria-selected", String(!showQueue));
  elements.queueTab.tabIndex = showQueue ? 0 : -1;
  elements.historyTab.tabIndex = showQueue ? -1 : 0;
  elements.queueView.hidden = !showQueue;
  elements.historyView.hidden = showQueue;
  (showQueue ? elements.queueTab : elements.historyTab).focus();
}

async function runPlayerAction(type, successMessage, extra = {}) {
  const result = await send({ type, ...extra });
  if (result?.ok) setStatus(successMessage);
  else if (result?.reason === "budget-finished") setStatus("Your time budget is complete.");
  else if (result?.reason === "only-item") setStatus("That is the only pick in this lane.");
  else setStatus("That action isn’t available right now.");
  await refresh();
  return result;
}

async function handleQueueAction(event) {
  const checkbox = event.target.closest("[data-select-item]");
  const row = event.target.closest(".queue-item");
  if (checkbox && row) {
    if (checkbox.checked) selectedItems.add(row.dataset.itemId); else selectedItems.delete(row.dataset.itemId);
    renderSelection();
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton || !row || selecting) return;
  const { itemId } = row.dataset;
  const laneIndex = Number(row.dataset.laneIndex);
  const action = actionButton.dataset.action;
  if (action === "play") await runPlayerAction("OPEN_ITEM", "Loaded in the player. Press play when ready.", { itemId });
  if (action === "remove") {
    await send({ type: "REMOVE_ITEM", itemId });
    await refresh();
    setStatus("Removed from the queue.");
  }
  if (action === "up" || action === "down") {
    await send({ type: "MOVE_ITEM", itemId, targetIndex: laneIndex + (action === "up" ? -1 : 1) });
    await refresh();
    setStatus(`Moved ${action}.`);
  }
}

function clearDropStyles() {
  document.querySelectorAll(".is-dragging, .is-drop-target").forEach((row) => row.classList.remove("is-dragging", "is-drop-target"));
}

document.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".queue-item");
  if (!row || selecting) { event.preventDefault(); return; }
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
  const itemId = draggedItemId;
  const targetIndex = Number(row.dataset.laneIndex);
  draggedItemId = null;
  clearDropStyles();
  void (async () => { await send({ type: "MOVE_ITEM", itemId, targetIndex }); await refresh(); setStatus("Queue order updated."); })();
});
document.addEventListener("dragend", () => { draggedItemId = null; clearDropStyles(); });

elements.shortList.addEventListener("click", (event) => void handleQueueAction(event));
elements.videoList.addEventListener("click", (event) => void handleQueueAction(event));
laneButtons.forEach((button) => button.addEventListener("click", () => void runPlayerAction("OPEN_NEXT", "Player ready. Playback stays manual.", { kind: button.dataset.openLane })));

budgetButtons.forEach((button) => button.addEventListener("click", async () => {
  await send({ type: "SET_BUDGET", minutes: Number(button.dataset.budget) });
  await refresh();
  setStatus(Number(button.dataset.budget) ? `${button.dataset.budget}-minute session started.` : "Time limit removed.");
}));
byId("custom-budget-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("custom-budget");
  const minutes = Number(input.value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) { setStatus("Choose a whole number from 1 to 180 minutes."); input.focus(); return; }
  await send({ type: "SET_BUDGET", minutes });
  await refresh();
  setStatus(`${minutes}-minute session started.`);
});

settingInputs.forEach((input) => input.addEventListener("change", async () => {
  await send({ type: "UPDATE_SETTINGS", patch: { [input.dataset.setting]: input.checked } });
  await refresh();
  setStatus("Setting saved.");
}));
elements.captureMode.addEventListener("change", async () => {
  await send({ type: "UPDATE_SETTINGS", patch: { captureMode: elements.captureMode.value } });
  await refresh();
  setStatus(elements.captureMode.value === "queue-room" ? "Queue Room will save picks without tabs." : "Classic mode will open grouped tabs.");
});
elements.theme.addEventListener("change", async () => {
  applyTheme(elements.theme.value);
  await send({ type: "UPDATE_SETTINGS", patch: { theme: elements.theme.value } });
  await refresh();
  setStatus(`${elements.theme.selectedOptions[0].textContent} theme saved.`);
});

elements.queueTab.addEventListener("click", () => switchView("queue"));
elements.historyTab.addEventListener("click", () => switchView("history"));
[elements.queueTab, elements.historyTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") switchView("queue"); else if (event.key === "End") switchView("history"); else switchView(tab === elements.queueTab ? "history" : "queue");
}));

byId("focus-player").addEventListener("click", () => void runPlayerAction("FOCUS_PLAYER", "Player focused."));
byId("previous-item").addEventListener("click", () => void runPlayerAction("PREVIOUS_ITEM", "Previous pick restored and loaded paused."));
byId("finish-current").addEventListener("click", () => void runPlayerAction("FINISH_CURRENT", "Marked done. Next pick loaded paused.", { outcome: "watched" }));
byId("defer-current").addEventListener("click", () => void runPlayerAction("DEFER_CURRENT", "Moved to Later. Next pick loaded paused."));
byId("skip-current").addEventListener("click", () => void runPlayerAction("SKIP_CURRENT", "Skipped. Next pick loaded paused."));
byId("handoff-action").addEventListener("click", (event) => void runPlayerAction("OPEN_NEXT", "Next lane loaded paused.", { kind: event.currentTarget.dataset.kind }));

byId("toggle-select").addEventListener("click", () => { selecting = true; render(); document.querySelector("[data-select-item]")?.focus(); });
byId("cancel-select").addEventListener("click", () => { selecting = false; selectedItems.clear(); render(); byId("toggle-select").focus(); });
document.querySelectorAll("[data-batch]").forEach((button) => button.addEventListener("click", async () => {
  if (!selectedItems.size) return;
  const action = button.dataset.batch;
  if (action === "remove" && !window.confirm(`Remove ${selectedItems.size} selected pick${selectedItems.size === 1 ? "" : "s"}?`)) return;
  const result = await send({ type: "BATCH_ITEMS", itemIds: [...selectedItems], action });
  if (result?.ok) {
    selectedItems.clear();
    selecting = false;
    await refresh();
    setStatus(`${result.affected} pick${result.affected === 1 ? "" : "s"} updated.`);
  } else setStatus("The selected picks could not be updated.");
}));

byId("import-tabs").addEventListener("click", () => elements.importDialog.showModal());
elements.importDialog.addEventListener("close", () => {
  if (elements.importDialog.returnValue !== "confirm") return;
  void (async () => {
    const closeOriginals = byId("close-imported-tabs").checked;
    const result = await send({ type: "IMPORT_TABS", closeOriginals });
    await refresh();
    setStatus(result?.imported ? `Imported ${result.imported} tab${result.imported === 1 ? "" : "s"}${result.closed ? ` and closed ${result.closed}` : ""}.` : "No new YouTube tabs found.");
    byId("close-imported-tabs").checked = false;
  })();
});

byId("clear-queue").addEventListener("click", () => elements.clearDialog.showModal());
elements.clearDialog.addEventListener("close", () => {
  if (elements.clearDialog.returnValue !== "confirm") return;
  void (async () => { const result = await send({ type: "CLEAR_QUEUE" }); await refresh(); setStatus(`Removed ${result?.removed || 0} waiting pick${result?.removed === 1 ? "" : "s"}.`); })();
});

byId("clear-history").addEventListener("click", async () => {
  if (!window.confirm("Clear your local QueueTube history?")) return;
  await send({ type: "CLEAR_HISTORY" });
  await refresh();
  setStatus("History cleared.");
});
byId("history-filter").addEventListener("change", renderHistory);
elements.historyList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-history-id]");
  if (!button) return;
  const result = await send({ type: "RESTORE_HISTORY_ITEM", historyId: button.dataset.historyId });
  await refresh();
  setStatus(result?.duplicate ? "That pick was already queued; history entry removed." : "Pick restored to its lane.");
});

byId("copy-backup").addEventListener("click", async () => {
  const payload = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), settings: appState.settings, items: appState.items, history: appState.history }, null, 2);
  try { await navigator.clipboard.writeText(payload); setStatus("v3 queue backup copied."); } catch { setStatus("Clipboard access was unavailable."); }
});
byId("restore-backup").addEventListener("click", () => elements.restoreDialog.showModal());
elements.restoreDialog.addEventListener("close", () => {
  if (elements.restoreDialog.returnValue !== "confirm") return;
  void (async () => {
    const payload = byId("backup-json").value;
    const mode = document.querySelector("input[name='restore-mode']:checked")?.value || "merge";
    const result = await send({ type: "RESTORE_BACKUP", payload, mode });
    if (result?.ok) {
      byId("backup-json").value = "";
      await refresh();
      setStatus(`Restored ${result.imported} pick${result.imported === 1 ? "" : "s"}${result.duplicates ? ` · ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""}.`);
    } else {
      setStatus(result?.reason === "invalid-json" ? "That backup is not valid JSON." : "That backup could not be restored.");
    }
  })();
});

byId("open-shortcuts").addEventListener("click", async () => {
  const result = await send({ type: "OPEN_SHORTCUT_SETTINGS" });
  setStatus(result?.ok ? "Chrome shortcut settings opened." : "Open chrome://extensions/shortcuts to assign keys.");
});
byId("show-help").addEventListener("click", () => elements.helpDialog.showModal());

document.addEventListener("keydown", (event) => {
  const editable = event.target.matches("input, textarea, select, [contenteditable='true']");
  if (editable || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "?") { event.preventDefault(); if (elements.helpDialog.open) elements.helpDialog.close(); else elements.helpDialog.showModal(); }
  if (document.querySelector("dialog[open]")) return;
  if (key === "w") { event.preventDefault(); byId("finish-current").click(); }
  if (key === "n") { event.preventDefault(); byId("defer-current").click(); }
  if (key === "p") { event.preventDefault(); byId("previous-item").click(); }
  if (key === "x") { event.preventDefault(); byId("skip-current").click(); }
});

if (IS_EXTENSION) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.qtQueueItems || changes.qtHistory || changes.qtSettings || changes.qtSchemaVersion)) scheduleRefresh();
    if (areaName === "session" && changes.qtSession) scheduleRefresh();
  });
}

window.setInterval(renderBudget, 1000);
void (async () => {
  try {
    if (IS_EXTENSION) currentWindowId = (await chrome.windows.getCurrent()).id;
    await refresh({ commands: true });
    setStatus(IS_EXTENSION ? "Ready. Ctrl-click a YouTube pick." : "Preview data · v0.3 Queue Room ready.");
  } catch {
    setStatus("QueueTube couldn’t initialize. Reload the extension once.");
  }
})();
