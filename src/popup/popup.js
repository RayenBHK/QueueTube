const totalCount = document.getElementById("total-count");
const shortCount = document.getElementById("short-count");
const videoCount = document.getElementById("video-count");
const status = document.getElementById("status");
const openButtons = [...document.querySelectorAll("[data-open]")];
let windowId = null;
let state = null;

function setStatus(message) {
  status.textContent = message;
}

function applyTheme(theme) {
  const safeTheme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = safeTheme;
  try { localStorage.setItem("qt-theme-cache", safeTheme); } catch { /* The live theme still applies. */ }
}

function renderCurrent() {
  const item = state.items.find((entry) => entry.id === state.session?.currentItemId);
  const card = document.getElementById("continue-card");
  card.hidden = !item;
  if (!item) return;
  document.getElementById("current-thumbnail").src = item.thumbnailUrl;
  document.getElementById("continue-heading").textContent = item.title;
  document.getElementById("current-meta").textContent = `${item.kind === "short" ? "Short" : "Video"} · ${item.channel}${item.durationText ? ` · ${item.durationText}` : ""}`;
  document.getElementById("current-state").textContent = state.session.status === "playing" ? "PLAYING" : "READY · PAUSED";
}

function render() {
  applyTheme(state.settings.theme);
  const useClassic = state.settings.captureMode === "classic-tabs";
  const queues = useClassic ? state.classicQueues : state.queues;
  const total = queues.short.count + queues.video.count;
  totalCount.textContent = String(total);
  shortCount.textContent = String(queues.short.count);
  videoCount.textContent = String(queues.video.count);
  openButtons.forEach((button) => { button.disabled = queues[button.dataset.open].count === 0; });
  renderCurrent();
  if (!total) setStatus(useClassic ? "Classic tab lanes are clear." : "Queue clear. Ctrl-click a YouTube pick.");
  else setStatus(useClassic ? "Classic grouped-tab mode is active." : `${queues.short.count} Shorts ready · ${queues.video.count} videos sleeping as links.`);
}

async function refresh() {
  try {
    const [nextState, commandState] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_APP_STATE", windowId }),
      chrome.runtime.sendMessage({ type: "GET_COMMAND_STATE" })
    ]);
    if (!nextState?.ok) throw new Error("state unavailable");
    state = nextState;
    document.getElementById("shortcut-warning").hidden = !commandState?.commands?.some((command) => !command.shortcut);
    render();
  } catch {
    setStatus("Couldn’t read the queue. Reload the extension once.");
  }
}

document.getElementById("open-room").addEventListener("click", async () => {
  try {
    await chrome.sidePanel.open({ windowId });
    window.close();
  } catch {
    setStatus("Couldn’t open the Queue Room in this window.");
  }
});

document.getElementById("continue-player").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "FOCUS_PLAYER" });
  if (result?.ok) window.close(); else setStatus("The player tab is no longer open.");
});

openButtons.forEach((button) => button.addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_NEXT", kind: button.dataset.open, windowId });
    if (result?.ok) window.close(); else setStatus(result?.reason === "budget-finished" ? "Your time budget is complete." : "That lane is empty.");
  } catch {
    setStatus("QueueTube lost its browser connection. Reload once.");
  }
}));

document.getElementById("shortcut-warning").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_SHORTCUT_SETTINGS" });
  if (result?.ok) window.close(); else setStatus("Open chrome://extensions/shortcuts to assign keys.");
});

void (async () => {
  try {
    windowId = (await chrome.windows.getCurrent()).id;
    await refresh();
  } catch {
    setStatus("QueueTube couldn’t initialize. Reload the extension once.");
  }
})();
