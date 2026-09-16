(() => {
  const DEFAULT_SETTINGS = {
    captureMode: "queue-room",
    captureCtrlClick: true,
    captureMiddleClick: true,
    pauseBackground: true,
    manualPlay: true,
    focusShield: true,
    hideRelated: true,
    hideComments: true,
    hideEndCards: true,
    hideMerch: true,
    playerShortcuts: true,
    showToasts: true,
    showQueuedBadges: true
  };
  const CARD_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-playlist-video-renderer"
  ].join(",");

  let settings = { ...DEFAULT_SETTINGS };
  let queuedPageKey = null;
  let transitionToken = null;
  let manualPlaybackUnlocked = false;
  let budgetToastShown = false;
  let unavailableReported = false;
  let toastTimer = null;
  let badgeRefreshTimer = null;
  let observedVideo = null;

  function queueableUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const host = url.hostname.toLowerCase();
      const onYouTube = host === "youtube.com" || host.endsWith(".youtube.com");
      if (!onYouTube) return null;
      if (/^\/shorts\/[^/?#]+/.test(url.pathname)) return url.href;
      if (url.pathname === "/watch" && url.searchParams.has("v")) return url.href;
      if (/^\/live\/[^/?#]+/.test(url.pathname)) return url.href;
      return null;
    } catch {
      return null;
    }
  }

  function linkFromEvent(event) {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLAnchorElement && node.href) return node;
      if (node instanceof Element) {
        const anchor = node.closest("a[href]");
        if (anchor) return anchor;
      }
    }
    return null;
  }

  function metadataFromLink(anchor) {
    const card = anchor.closest(CARD_SELECTOR);
    const titleNode = card?.querySelector("#video-title, a#video-title-link, h3 a[href], [title]");
    const channelNode = card?.querySelector("ytd-channel-name a, #channel-name a, .ytd-channel-name a");
    const durationNode = card?.querySelector(
      "ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer span, .badge-shape-wiz__text"
    );
    const imageNode = card?.querySelector("ytd-thumbnail img, yt-image img, img");
    return {
      title: titleNode?.getAttribute("title") || titleNode?.textContent || anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "",
      channel: channelNode?.textContent || "",
      durationText: durationNode?.textContent || "",
      thumbnailUrl: imageNode?.currentSrc || imageNode?.src || ""
    };
  }

  function stopNativeOpen(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function sendToQueue(anchor, url) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: "QUEUE_URL",
        url,
        metadata: metadataFromLink(anchor)
      });
      if (!result?.ok) {
        showToast("Couldn’t queue that link", "error");
        return;
      }

      if (result.duplicate) {
        showToast(result.kind === "short" ? "Short already queued" : "Video already queued");
      } else if (result.mode === "classic-tabs") {
        showToast(result.kind === "short" ? "Short added to tab group" : "Video added to tab group", result.kind);
      } else {
        showToast(result.kind === "short" ? "Short saved · no new tab" : "Video saved · no new tab", result.kind);
      }
      scheduleBadgeRefresh(0);
    } catch {
      showToast("QueueTube needs this page refreshed", "error");
    }
  }

  function handleModifiedClick(event) {
    const modifierHeld = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (!settings.captureCtrlClick || event.button !== 0 || !modifierHeld) return;
    const anchor = linkFromEvent(event);
    const url = anchor && queueableUrl(anchor.href);
    if (!url) return;
    stopNativeOpen(event);
    void sendToQueue(anchor, url);
  }

  function handleMiddleClick(event) {
    if (!settings.captureMiddleClick || event.button !== 1) return;
    const anchor = linkFromEvent(event);
    const url = anchor && queueableUrl(anchor.href);
    if (!url) return;
    stopNativeOpen(event);
    void sendToQueue(anchor, url);
  }

  function currentQueueContext() {
    const url = new URL(location.href);
    if (url.searchParams.get("qt_queue") !== "1") return { itemId: null, transitionToken: null };
    return {
      itemId: url.searchParams.get("qt_item") || `${url.searchParams.get("qt_kind") || "video"}:${url.searchParams.get("v") || url.pathname}`,
      transitionToken: url.searchParams.get("qt_transition")
    };
  }

  function shouldBlockPlayback() {
    return (settings.pauseBackground && document.hidden) ||
      Boolean(settings.manualPlay && queuedPageKey && !manualPlaybackUnlocked);
  }

  function pauseMedia(media) {
    if (!media || media.paused) return;
    media.autoplay = false;
    media.pause();
  }

  function enforcePlaybackPolicy() {
    if (!shouldBlockPlayback()) return;
    document.querySelectorAll("video, audio").forEach(pauseMedia);
  }

  function unlockFromPointer(event) {
    if (!queuedPageKey || document.hidden) return;
    if (event.composedPath().some((node) => node instanceof Element && node.matches?.(".html5-video-player, video, .ytp-play-button"))) {
      manualPlaybackUnlocked = true;
    }
  }

  function unlockFromKeyboard(event) {
    if (!queuedPageKey || document.hidden) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    if ([" ", "k", "K"].includes(event.key)) manualPlaybackUnlocked = true;
  }

  async function handleQueueShortcut(event) {
    if (!settings.playerShortcuts || !queuedPageKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    if (event.key === "?") {
      event.preventDefault();
      event.stopPropagation();
      toggleKeyboardHelp();
      return;
    }
    const action = { n: "DEFER_CURRENT", p: "PREVIOUS_ITEM", x: "SKIP_CURRENT", w: "FINISH_CURRENT" }[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await chrome.runtime.sendMessage({ type: action, outcome: action === "FINISH_CURRENT" ? "watched" : undefined });
      if (!result?.ok) {
        const messages = {
          "no-history": "No previous pick yet",
          "budget-finished": "Time budget complete",
          "no-current-item": "No active QueueTube pick",
          "only-item": "That is the only pick in this lane"
        };
        showToast(messages[result?.reason] || "Queue action unavailable", "error");
      }
    } catch {
      showToast("QueueTube needs this page refreshed", "error");
    }
  }

  async function onPlayerEnded() {
    if (!queuedPageKey) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "PLAYER_ENDED", itemId: queuedPageKey, transitionToken });
      if (result?.queueEnded) showToast(result.completedLane === "video" ? "Videos lane complete" : "Shorts lane complete", result.completedLane || "short");
      if (result?.reason === "budget-finished") showToast("Time budget complete", "error");
    } catch {
      // Navigation may destroy this content-script context before the response arrives.
    }
  }

  function bindCurrentVideo() {
    const video = document.querySelector("video");
    if (!video || video === observedVideo) return;
    if (observedVideo) observedVideo.removeEventListener("ended", onPlayerEnded);
    observedVideo = video;
    observedVideo.addEventListener("ended", onPlayerEnded);
  }

  function applyFocusShield() {
    const isPlayer = location.pathname === "/watch" || location.pathname.startsWith("/shorts/");
    document.documentElement.classList.toggle("queuetube-focus-shield", Boolean(settings.focusShield && isPlayer));
    for (const key of ["hideRelated", "hideComments", "hideEndCards", "hideMerch"]) {
      document.documentElement.classList.toggle(`queuetube-${key}`, Boolean(settings[key]));
    }
    if (!settings.playerShortcuts) document.getElementById("queuetube-help-root")?.remove();
    if (!settings.showToasts) document.getElementById("queuetube-toast-root")?.remove();
  }

  function playerErrorPresent() {
    return Boolean(document.querySelector(".ytp-error") || document.querySelector("#error-screen"));
  }

  async function reportUnavailablePlayer() {
    if (!queuedPageKey || !transitionToken || unavailableReported) return;
    if (!playerErrorPresent()) return;
    unavailableReported = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "PLAYER_UNAVAILABLE", itemId: queuedPageKey, transitionToken });
      if (result?.ok) showToast("This video looks unavailable. Press X to skip it.", "error");
      else unavailableReported = false;
    } catch {
      unavailableReported = false;
    }
  }

  function syncQueuePage() {
    const context = currentQueueContext();
    if (context.itemId !== queuedPageKey || context.transitionToken !== transitionToken) {
      queuedPageKey = context.itemId;
      transitionToken = context.transitionToken;
      manualPlaybackUnlocked = false;
      budgetToastShown = false;
      unavailableReported = false;
    }
    applyFocusShield();
    enforcePlaybackPolicy();
    void reportUnavailablePlayer();
    window.setTimeout(bindCurrentVideo, 250);
  }

  async function reportPlayerState(state, media) {
    if (!queuedPageKey || !transitionToken) return;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "PLAYER_STATE",
        state,
        itemId: queuedPageKey,
        transitionToken
      });
      if (result?.shouldPause && media instanceof HTMLMediaElement) {
        pauseMedia(media);
        if (result.session?.status === "budget-complete" && !budgetToastShown) {
          budgetToastShown = true;
          showToast("Time budget complete", "error");
        }
      }
    } catch {
      // A navigation can retire this content script during the status report.
    }
  }

  async function enforceBudgetPolicy() {
    if (!queuedPageKey || !transitionToken) return;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "GET_PLAYER_POLICY",
        itemId: queuedPageKey,
        transitionToken
      });
      if (!result?.shouldPause) return;
      document.querySelectorAll("video, audio").forEach(pauseMedia);
      if (result.budgetExpired && !budgetToastShown) {
        budgetToastShown = true;
        showToast("Time budget complete", "error");
      }
    } catch {
      // The next navigation or extension reload reconnects the policy check.
    }
  }

  function toggleKeyboardHelp() {
    let host = document.getElementById("queuetube-help-root");
    if (host) {
      host.remove();
      return;
    }
    host = document.createElement("div");
    host.id = "queuetube-help-root";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card { position: fixed; z-index: 2147483647; right: 22px; bottom: 22px; width: min(330px, calc(100vw - 44px));
          padding: 18px; border: 1px solid #526663; border-top: 4px solid #6f8cff; border-radius: 10px;
          color: #f4f8f7; background: #14201f; box-shadow: 0 16px 48px rgba(0,0,0,.42); font: 13px/1.4 "Segoe UI", sans-serif; }
        p { margin: 0 0 11px; color: #9fb5b2; font: 700 10px/1 Consolas, monospace; letter-spacing: .09em; }
        dl { margin: 0; } div { display: grid; grid-template-columns: 34px 1fr; gap: 9px; align-items: center; min-height: 38px; border-bottom: 1px solid #31413f; }
        dt, dd { margin: 0; } kbd { display: inline-grid; place-items: center; width: 27px; height: 25px; border: 1px solid #728582; border-bottom-width: 2px; border-radius: 4px; background: #202e2c; font: 700 12px/1 Consolas, monospace; }
        dd { color: #dce7e4; } small { display: block; margin-top: 11px; color: #9fb5b2; }
        @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
      </style>
      <section class="card" role="dialog" aria-label="QueueTube keyboard help"><p>QUEUETUBE PLAYER KEYS</p><dl>
        <div><dt><kbd>W</kbd></dt><dd>Done · load next pick</dd></div><div><dt><kbd>N</kbd></dt><dd>Later · rotate to lane end</dd></div>
        <div><dt><kbd>P</kbd></dt><dd>Restore previous pick</dd></div><div><dt><kbd>X</kbd></dt><dd>Skip · load next pick</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Close this guide</dd></div></dl><small>Space or K still controls YouTube play/pause.</small></section>`;
    (document.documentElement || document).appendChild(host);
  }

  async function refreshQueuedBadges() {
    if (!settings.showQueuedBadges) {
      document.querySelectorAll("[data-queuetube-queued]").forEach((node) => node.removeAttribute("data-queuetube-queued"));
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_QUEUE_KEYS" });
      const keys = new Set(response?.keys || []);
      const anchors = [...document.querySelectorAll("a[href]")].filter((anchor) => queueableUrl(anchor.href));
      const batchSize = 24;
      for (let index = 0; index < anchors.length; index += batchSize) {
        const batch = anchors.slice(index, index + batchSize);
        await new Promise((resolve) => {
          requestAnimationFrame(() => {
            if (!settings.showQueuedBadges) { resolve(); return; }
            for (const anchor of batch) {
              const url = new URL(anchor.href, location.href);
              const videoId = url.pathname.startsWith("/shorts/")
                ? url.pathname.split("/")[2]
                : url.searchParams.get("v") || url.pathname.split("/")[2];
              const kind = url.pathname.startsWith("/shorts/") ? "short" : "video";
              const queued = keys.has(`${kind}:${videoId}`);
              const thumbnail = anchor.closest(CARD_SELECTOR)?.querySelector("ytd-thumbnail, #thumbnail") || anchor;
              if (queued) thumbnail.setAttribute("data-queuetube-queued", kind);
              else thumbnail.removeAttribute("data-queuetube-queued");
            }
            resolve();
          });
        });
        if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
      }
    } catch {
      // The extension may have reloaded; the next page navigation will reconnect.
    }
  }

  function scheduleBadgeRefresh(delay = 220) {
    window.clearTimeout(badgeRefreshTimer);
    badgeRefreshTimer = window.setTimeout(() => void refreshQueuedBadges(), delay);
  }

  function showToast(message, tone = "neutral") {
    // Errors remain visible even when routine notifications are disabled.
    if (!settings.showToasts && tone !== "error") return;
    let host = document.getElementById("queuetube-toast-root");
    if (!host) {
      host = document.createElement("div");
      host.id = "queuetube-toast-root";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .toast {
            position: fixed; z-index: 2147483647; left: 22px; bottom: 22px;
            max-width: 320px; padding: 12px 15px 12px 38px;
            border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
            color: #f8fbfa; background: #122423; box-shadow: 0 12px 36px rgba(0,0,0,.28);
            font: 600 13px/1.35 "Segoe UI", sans-serif; letter-spacing: .01em;
            opacity: 0; transform: translateY(8px); transition: opacity 150ms ease, transform 150ms ease;
            pointer-events: none;
          }
          .toast::before { content: ""; position: absolute; left: 15px; top: 50%; width: 10px; height: 10px;
            border: 2px solid #9fb5b2; border-radius: 50%; transform: translateY(-50%); }
          .toast[data-tone="short"]::before { border-color: #f26b3a; background: #f26b3a; }
          .toast[data-tone="video"]::before { border-color: #6f8cff; background: #6f8cff; }
          .toast[data-tone="error"]::before { border-color: #ffb44a; }
          .toast.show { opacity: 1; transform: translateY(0); }
          @media (prefers-reduced-motion: reduce) { .toast { transition-duration: .001ms; } }
        </style>
        <div class="toast" role="status" aria-live="polite"></div>`;
      (document.documentElement || document).appendChild(host);
    }

    const toast = host.shadowRoot.querySelector(".toast");
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  async function initialize() {
    try {
      const stored = await chrome.storage.local.get({ qtSettings: DEFAULT_SETTINGS });
      settings = readSettings(stored.qtSettings);
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
    syncQueuePage();
    scheduleBadgeRefresh(0);
  }

  function readSettings(raw = {}) {
    return {
      ...DEFAULT_SETTINGS, ...raw,
      manualPlay: typeof raw.manualPlay === "boolean" ? raw.manualPlay : raw.pauseBackground !== false
    };
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.qtSettings) settings = readSettings(changes.qtSettings.newValue);
    if (changes.qtSettings || changes.qtQueueItems) {
      syncQueuePage();
      scheduleBadgeRefresh(0);
    }
  });

  const observer = new MutationObserver(() => {
    bindCurrentVideo();
    scheduleBadgeRefresh();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("click", handleModifiedClick, true);
  window.addEventListener("auxclick", handleMiddleClick, true);
  document.addEventListener("play", (event) => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    if (shouldBlockPlayback()) pauseMedia(event.target);
    else void reportPlayerState("playing", event.target);
  }, true);
  document.addEventListener("pause", (event) => {
    if (event.target instanceof HTMLMediaElement && queuedPageKey) void reportPlayerState("ready", event.target);
  }, true);
  document.addEventListener("visibilitychange", enforcePlaybackPolicy, true);
  document.addEventListener("pointerdown", unlockFromPointer, true);
  document.addEventListener("keydown", unlockFromKeyboard, true);
  document.addEventListener("keydown", (event) => void handleQueueShortcut(event), true);
  document.addEventListener("yt-navigate-finish", syncQueuePage, true);
  window.addEventListener("popstate", syncQueuePage, true);
  document.addEventListener("DOMContentLoaded", syncQueuePage, { once: true });
  window.setInterval(() => { void enforceBudgetPolicy(); void reportUnavailablePlayer(); }, 1000);
  void initialize();
})();
