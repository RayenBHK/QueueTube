import { FEATURE_GROUPS, createSettingsUI, renderSettingsUI, settingPatch } from "../settings-ui.js";

const byId = (id) => document.getElementById(id);
const featureSettings = byId("feature-settings");
createSettingsUI(featureSettings);
const controls = [...document.querySelectorAll("[data-setting]")];
controls.forEach((input) => { input.disabled = true; });
const openButtons = [...document.querySelectorAll("[data-open]")];
let windowId = null;
let state = null;
let refreshing = false;
let refreshAgain = false;
let refreshTimer;

function setStatus(message) { byId("status").textContent = message; }

function applyTheme(theme) {
  const safeTheme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = safeTheme;
  try { localStorage.setItem("qt-theme-cache", safeTheme); } catch { /* Live theme still applies. */ }
}

function render() {
  applyTheme(state.settings.theme);
  document.body.classList.toggle("compact", state.settings.compactDensity);
  const classic = state.settings.captureMode === "classic-tabs";
  const queues = classic ? state.classicQueues : state.queues;
  byId("total-count").textContent = queues.short.count + queues.video.count;
  byId("short-count").textContent = queues.short.count;
  byId("video-count").textContent = queues.video.count;
  byId("mode-label").textContent = classic ? "Classic grouped tabs" : "One player. Two lanes.";
  openButtons.forEach((button) => { button.disabled = !queues[button.dataset.open].count; });
  renderSettingsUI(featureSettings, state.settings);
  byId("quick-pause").checked = state.settings.pauseBackground;
  byId("quick-pause").disabled = false;
  byId("pause-explainer").textContent = state.settings.pauseBackground ? "On · switching tabs pauses YouTube." : classic && state.settings.sleepVideos ? "Off · Classic sleeping tabs may still stop audio." : "Off · keep listening in the background.";
  const item = state.items.find((entry) => entry.id === state.session?.currentItemId);
  byId("continue-card").hidden = !item;
  if (item) {
    byId("current-thumbnail").src = item.thumbnailUrl;
    byId("continue-heading").textContent = item.title;
    byId("current-meta").textContent = `${item.kind === "short" ? "Short" : "Video"} · ${item.channel}`;
    const labels = { playing: "Playing", ready: "Ready", loading: "Loading", advancing: "Next pick", "budget-complete": "Time is up", error: "Needs attention" };
    byId("current-state").textContent = labels[state.session.status] || "Ready";
  }
}

async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const result = await chrome.runtime.sendMessage({ type: "GET_APP_STATE", windowId });
      if (!result?.ok) throw new Error("state unavailable");
      state = result;
      render();
    } while (refreshAgain);
  } catch { setStatus("Couldn’t read the queue. Reload the extension once."); }
  finally { refreshing = false; }
}

function switchView(name, focus = false) {
  for (const view of ["queue", "features"]) {
    const selected = name === view;
    const tab = byId(`${view}-tab`);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(`${view}-view`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  document.querySelector(".content").scrollTop = 0;
}

for (const name of ["queue", "features"]) {
  byId(`${name}-tab`).addEventListener("click", () => switchView(name));
  byId(`${name}-tab`).addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    switchView(event.key === "Home" ? "queue" : event.key === "End" ? "features" : name === "queue" ? "features" : "queue", true);
  });
}
byId("browse-features").addEventListener("click", () => switchView("features", true));
byId("feature-count").textContent = `${FEATURE_GROUPS.flatMap((group) => group.entries).length} preferences`;
byId("feature-search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  let found = 0;
  for (const section of featureSettings.children) {
    let matches = 0;
    for (const row of section.querySelectorAll(".feature-row")) {
      row.hidden = Boolean(query && !`${section.querySelector("summary").textContent} ${row.textContent}`.toLowerCase().includes(query));
      if (!row.hidden) matches++;
    }
    section.hidden = !matches;
    if (query && matches) section.open = true;
    found += matches;
  }
  byId("no-features").hidden = found > 0;
});

controls.forEach((input) => input.addEventListener("change", async () => {
  if (!state) return;
  if (!input.checkValidity()) { input.reportValidity(); return; }
  input.disabled = true;
  setStatus("Saving preference…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", patch: settingPatch(input) });
    if (!result?.ok) throw new Error("save failed");
    state.settings = result.settings;
    render();
    setStatus("Preference saved. Open YouTube pages update automatically.");
  } catch {
    render();
    setStatus("Couldn’t save. Your previous preference is still active. Try again.");
  }
}));

byId("open-room").addEventListener("click", async () => {
  try {
    // Keep this call in the click event before any other awaited operation.
    await chrome.sidePanel.open({ windowId });
    window.close();
  } catch { setStatus("Couldn’t open Queue Room in this window."); }
});

async function runAction(message) {
  try {
    const result = await chrome.runtime.sendMessage({ ...message, windowId });
    if (result?.ok) window.close();
    else setStatus(result?.reason === "budget-finished" ? "Time is up. Change Session time limit in Features & controls." : "Action unavailable. Check Queue Room for details.");
  } catch { setStatus("QueueTube lost its connection. Reload the extension once."); }
}
byId("continue-player").addEventListener("click", () => void runAction({ type: "FOCUS_PLAYER" }));
openButtons.forEach((button) => button.addEventListener("click", () => void runAction({ type: "OPEN_NEXT", kind: button.dataset.open })));
for (const id of ["shortcut-warning", "open-shortcuts"]) byId(id).addEventListener("click", () => void runAction({ type: "OPEN_SHORTCUT_SETTINGS" }));

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && (changes.qtSettings || changes.qtQueueItems || changes.qtHistory)) || (area === "session" && changes.qtSession)) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 60);
  }
});

void (async () => {
  try {
    byId("version").textContent = chrome.runtime.getManifest().version;
    windowId = (await chrome.windows.getCurrent()).id;
    byId("open-room").disabled = false;
    await refresh();
    if (state) setStatus("Ready. Ctrl / ⌘-click or middle-click a YouTube pick to collect it.");
    const commands = await chrome.runtime.sendMessage({ type: "GET_COMMAND_STATE" });
    byId("shortcut-warning").hidden = !commands?.commands?.some((command) => command.name !== "_execute_action" && !command.shortcut);
  } catch { setStatus("QueueTube couldn’t initialize. Reload the extension once."); }
})();
