const settingInputs = [...document.querySelectorAll("[data-setting]")];
const openButtons = [...document.querySelectorAll("[data-open]")];
const totalCount = document.getElementById("total-count");
const shortCount = document.getElementById("short-count");
const videoCount = document.getElementById("video-count");
const videoSleepCopy = document.getElementById("video-sleep-copy");
const status = document.getElementById("status");
const sleepButton = document.getElementById("sleep-videos");
const clearButton = document.getElementById("clear-queues");

let windowId;

function setStatus(message) {
  status.textContent = message;
}

async function send(message) {
  return chrome.runtime.sendMessage({ ...message, windowId });
}

function render(state) {
  const shorts = state.queues.short;
  const videos = state.queues.video;
  totalCount.textContent = shorts.count + videos.count;
  shortCount.textContent = shorts.count;
  videoCount.textContent = videos.count;
  videoSleepCopy.textContent = videos.count
    ? `${videos.sleeping} of ${videos.count} sleeping.`
    : "Sleeping until selected.";

  openButtons.forEach((button) => {
    button.disabled = state.queues[button.dataset.open].count === 0;
  });
  sleepButton.disabled = videos.count === 0;
  clearButton.disabled = shorts.count + videos.count === 0;

  settingInputs.forEach((input) => {
    input.checked = Boolean(state.settings[input.dataset.setting]);
  });

  if (shorts.count + videos.count === 0) {
    setStatus("Lanes clear. Ctrl-click a YouTube pick to begin.");
  } else {
    setStatus(`${shorts.count} ready now · ${videos.sleeping} long video${videos.sleeping === 1 ? "" : "s"} asleep.`);
  }
}

async function refresh() {
  try {
    const state = await send({ type: "GET_POPUP_STATE" });
    if (!state?.queues) throw new Error("state unavailable");
    render(state);
  } catch {
    setStatus("Couldn’t read the queue. Reload the extension once.");
  }
}

openButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const result = await send({ type: "OPEN_NEXT", kind: button.dataset.open });
    if (result?.ok) window.close();
    else setStatus(result?.reason === "end-of-queue" ? "You’re already on the last item in that lane." : "That lane is empty.");
  });
});

sleepButton.addEventListener("click", async () => {
  const result = await send({ type: "SLEEP_VIDEOS" });
  setStatus(result?.slept ? `${result.slept} video tab${result.slept === 1 ? "" : "s"} put to sleep.` : "All inactive videos are already sleeping.");
  await refresh();
});

clearButton.addEventListener("click", async () => {
  if (!window.confirm("Close every tab in both QueueTube lanes?")) return;
  const result = await send({ type: "CLEAR_QUEUES" });
  await refresh();
  setStatus(`${result?.removed || 0} queued tab${result?.removed === 1 ? "" : "s"} closed.`);
});

settingInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    await chrome.storage.local.set({ [input.dataset.setting]: input.checked });
    await send({ type: "SETTINGS_UPDATED" });
    await refresh();
    setStatus("Setting saved.");
  });
});

chrome.windows.getCurrent().then((currentWindow) => {
  windowId = currentWindow.id;
  refresh();
});
