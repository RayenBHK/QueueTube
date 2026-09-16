import { DEFAULT_SETTINGS, sanitizeSettings } from "./queue-core.js";

// One catalog for the popup and Queue Room.
export const FEATURE_GROUPS = [
  { title: "Playback", entries: [
    { key: "pauseBackground", label: "Pause when leaving a tab", description: "Pause YouTube media when its tab is hidden. Turn off to keep listening after switching tabs." },
    { key: "manualPlay", label: "Start each pick paused", description: "Wait for your play click or Space / K. Independent of background listening. Off lets YouTube start playback, subject to browser rules." },
    { key: "autoAdvanceShorts", label: "Load the next Short", description: "When a Short ends, open the next Short. Uses your start-paused preference.", roomOnly: true },
    { key: "autoAdvanceVideos", label: "Load the next video", description: "When a video ends, open the next video in the same lane.", roomOnly: true },
    { key: "shortsInPlayer", label: "Shorts in the main player", description: "Open Shorts in the regular YouTube player. Applies the next time a pick opens." },
    { key: "playerShortcuts", label: "Player keyboard controls", description: "W: done · N: later · P: previous · X: skip · ?: help. Space / K remain YouTube controls." },
    { key: "defaultBudgetMinutes", label: "Session time limit", description: "0 turns the limit off; 1–180 minutes sets it. Saving restarts the timer. Counts elapsed time, including pauses.", type: "number", roomOnly: true }
  ] },
  { title: "Collecting & memory", entries: [
    { key: "captureMode", label: "Collecting mode", description: "Queue Room stores links in two lanes and reuses one player. Classic creates grouped tabs. Switching keeps both queues.", type: "select", options: [["queue-room", "Queue Room"], ["classic-tabs", "Classic tabs"]] },
    { key: "captureCtrlClick", label: "Capture Ctrl / ⌘-click", description: "Save YouTube picks with Ctrl / ⌘-click. Off restores the normal browser gesture." },
    { key: "captureMiddleClick", label: "Capture middle-click", description: "Save picks with the mouse wheel button. Off restores normal middle-click." },
    { key: "preventDuplicates", label: "Prevent duplicate picks", description: "Keep each Short or video once. Off allows repeat entries." },
    { key: "sleepVideos", label: "Sleep inactive video tabs", description: "Classic mode only. Unload inactive long-video tabs to free memory. May stop their background audio.", classicOnly: true }
  ] },
  { title: "Focus Shield", entries: [
    { key: "focusShield", label: "Enable Focus Shield", description: "Apply the hiding controls below on YouTube watch and Shorts pages. Other extensions may also hide content." },
    { key: "hideRelated", label: "Hide related videos", description: "Remove the recommendation sidebar beside the player.", requires: "focusShield" },
    { key: "hideComments", label: "Hide comments", description: "Keep the comments section out of your viewing space.", requires: "focusShield" },
    { key: "hideEndCards", label: "Hide end cards", description: "Hide recommendation cards and the end-screen grid. Does not control YouTube’s own autoplay setting.", requires: "focusShield" },
    { key: "hideMerch", label: "Hide merchandise", description: "Remove the merchandise shelf below videos.", requires: "focusShield" }
  ] },
  { title: "Queue & history", entries: [
    { key: "removeFinished", label: "Remove finished picks", description: "Remove watched and skipped picks from the queue. Off keeps them available for repeat viewing.", roomOnly: true },
    { key: "recordHistory", label: "Save watch history", description: "Remember up to 200 watched or skipped picks locally for restore and Previous. Off stops new entries; existing history stays.", roomOnly: true }
  ] },
  { title: "Appearance & feedback", entries: [
    { key: "theme", label: "Color theme", description: "Choose a fixed look or follow your device. Applies to the popup and Queue Room.", type: "select", options: [["system", "System"], ["dark", "Dark"], ["light", "Light"]] },
    { key: "compactDensity", label: "Compact layout", description: "Tighter spacing in the popup and Queue Room, with readable labels and accessible controls." },
    { key: "showQueuedBadges", label: "Queued labels on YouTube", description: "Mark thumbnails already saved in the Queue Room." },
    { key: "showCountBadge", label: "Count on the extension icon", description: "Show the queue total on the toolbar icon." },
    { key: "showToasts", label: "On-page notifications", description: "Show brief confirmations when collecting and completing picks. Errors and time-limit alerts still appear." }
  ] }
];

export function createSettingsUI(container) {
  for (const group of FEATURE_GROUPS) {
    const section = document.createElement("details");
    section.className = "feature-group";
    section.open = group.title === "Playback";
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    const count = document.createElement("span");
    count.textContent = `${group.entries.length} controls`;
    summary.append(count);
    section.append(summary);
    for (const entry of group.entries) {
      const row = document.createElement("label");
      row.className = "feature-row";
      row.dataset.feature = entry.key;
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = entry.label;
      const help = document.createElement("small");
      help.id = `help-${entry.key}`;
      help.textContent = entry.description;
      copy.append(title, help);
      const input = document.createElement(entry.type === "select" ? "select" : "input");
      input.dataset.setting = entry.key;
      input.id = entry.key === "theme" ? "theme-select" : entry.key === "captureMode" ? "capture-mode" : `setting-${entry.key}`;
      input.setAttribute("aria-describedby", help.id);
      if (entry.type === "select") {
        for (const [value, label] of entry.options) input.add(new Option(label, value));
      } else if (entry.type === "number") {
        input.type = "number";
        input.min = "0";
        input.max = "180";
        input.step = "1";
        input.required = true;
      } else {
        input.type = "checkbox";
        input.setAttribute("role", "switch");
      }
      row.append(copy, input);
      section.append(row);
    }
    container.append(section);
  }
}

export function renderSettingsUI(container, rawSettings) {
  const settings = sanitizeSettings(rawSettings);
  for (const group of FEATURE_GROUPS) {
    for (const entry of group.entries) {
      const row = container.querySelector(`[data-feature="${entry.key}"]`);
      const input = row.querySelector("[data-setting]");
      if (typeof DEFAULT_SETTINGS[entry.key] === "boolean") input.checked = settings[entry.key];
      else if (input.type !== "number" || document.activeElement !== input || input.disabled) input.value = settings[entry.key];
      const inactive = Boolean((entry.requires && !settings[entry.requires]) ||
        (entry.classicOnly && settings.captureMode !== "classic-tabs") ||
        (entry.roomOnly && settings.captureMode !== "queue-room"));
      input.disabled = inactive;
      row.classList.toggle("is-inactive", inactive);
    }
  }
}

export function settingPatch(input) {
  return { [input.dataset.setting]: input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value };
}
