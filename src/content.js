(() => {
  const DEFAULT_SETTINGS = {
    captureMode: "queue-room",
    captureCtrlClick: true,
    captureMiddleClick: true,
    pauseBackground: true,
    focusShield: true,
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
  let manualPlaybackUnlocked = false;
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
        showToast(result.kind === "short" ? "Short opened · ready, paused" : "Video opened · sleeping", result.kind);
      } else {
        showToast(result.kind === "short" ? "Short saved · no new tab" : "Video saved · zero memory", result.kind);
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

  function currentQueueKey() {
    const url = new URL(location.href);
    if (url.searchParams.get("qt_queue") !== "1") return null;
    return url.searchParams.get("qt_item") || `${url.searchParams.get("qt_kind") || "video"}:${url.searchParams.get("v") || url.pathname}`;
  }

  function shouldBlockPlayback() {
    if (!settings.pauseBackground) return false;
    return document.hidden || Boolean(queuedPageKey && !manualPlaybackUnlocked);
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
    if ([" ", "k", "K"].includes(event.key)) manualPlaybackUnlocked = true;
  }

  async function handleQueueShortcut(event) {
    if (!queuedPageKey || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    const action = { n: "NEXT_ITEM", p: "PREVIOUS_ITEM", x: "SKIP_CURRENT" }[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await chrome.runtime.sendMessage({ type: action });
      if (!result?.ok) {
        const messages = {
          "no-history": "No previous pick yet",
          "budget-finished": "Time budget complete",
          "no-current-item": "No active QueueTube pick"
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
      const result = await chrome.runtime.sendMessage({ type: "PLAYER_ENDED" });
      if (result?.queueEnded) showToast("Shorts lane complete", "short");
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
  }

  function syncQueuePage() {
    const nextKey = currentQueueKey();
    if (nextKey !== queuedPageKey) {
      queuedPageKey = nextKey;
      manualPlaybackUnlocked = false;
    }
    applyFocusShield();
    enforcePlaybackPolicy();
    window.setTimeout(bindCurrentVideo, 250);
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
      settings = { ...DEFAULT_SETTINGS, ...stored.qtSettings };
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
    syncQueuePage();
    scheduleBadgeRefresh(0);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.qtSettings) settings = { ...DEFAULT_SETTINGS, ...changes.qtSettings.newValue };
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
    if (shouldBlockPlayback() && event.target instanceof HTMLMediaElement) pauseMedia(event.target);
  }, true);
  document.addEventListener("visibilitychange", enforcePlaybackPolicy, true);
  document.addEventListener("pointerdown", unlockFromPointer, true);
  document.addEventListener("keydown", unlockFromKeyboard, true);
  document.addEventListener("keydown", (event) => void handleQueueShortcut(event), true);
  document.addEventListener("yt-navigate-finish", syncQueuePage, true);
  window.addEventListener("popstate", syncQueuePage, true);
  document.addEventListener("DOMContentLoaded", syncQueuePage, { once: true });
  void initialize();
})();
