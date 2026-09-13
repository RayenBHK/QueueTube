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

function render() {
  const useClassic = state.settings.captureMode === "classic-tabs";
  const queues = useClassic ? state.classicQueues : state.queues;
  const total = queues.short.count + queues.video.count;
  totalCount.textContent = String(total);
  shortCount.textContent = String(queues.short.count);
  videoCount.textContent = String(queues.video.count);
  openButtons.forEach((button) => {
    button.disabled = queues[button.dataset.open].count === 0;
  });
  if (!total) setStatus(useClassic ? "Classic tab lanes are clear." : "Queue clear. Ctrl-click a YouTube pick.");
  else setStatus(useClassic ? "Classic grouped-tab mode is active." : `${queues.short.count} Shorts ready · ${queues.video.count} videos sleeping as links.`);
}

async function refresh() {
  try {
    state = await chrome.runtime.sendMessage({ type: "GET_APP_STATE", windowId });
    if (!state?.ok) throw new Error("state unavailable");
    render();
  } catch {
    setStatus("Couldn’t read the queue. Reload the extension once.");
  }
}

document.getElementById("open-room").addEventListener("click", async () => {
  try {
    const opening = chrome.sidePanel.open({ windowId });
    await opening;
    window.close();
  } catch {
    setStatus("Couldn’t open the Queue Room in this window.");
  }
});

openButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_NEXT", kind: button.dataset.open, windowId });
      if (result?.ok) window.close();
      else setStatus(result?.reason === "budget-finished" ? "Your time budget is complete." : "That lane is empty.");
    } catch {
      setStatus("QueueTube lost its browser connection. Reload once.");
    }
  });
});

void (async () => {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    windowId = currentWindow.id;
    await refresh();
  } catch {
    setStatus("QueueTube couldn’t initialize. Reload the extension once.");
  }
})();
