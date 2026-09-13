(() => {
  const DEFAULT_SETTINGS = {
    captureCtrlClick: true,
    captureMiddleClick: true,
    pauseBackground: true
  };

  let settings = { ...DEFAULT_SETTINGS };
  let queuedPageKey = null;
  let manualPlaybackUnlocked = false;
  let toastTimer = null;

  chrome.storage.local.get(DEFAULT_SETTINGS).then((stored) => {
    settings = { ...settings, ...stored };
    enforcePlaybackPolicy();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    Object.entries(changes).forEach(([key, change]) => {
      settings[key] = change.newValue;
    });
    enforcePlaybackPolicy();
  });

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

  function stopNativeOpen(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function sendToQueue(url) {
    try {
      const result = await chrome.runtime.sendMessage({ type: "QUEUE_URL", url });
      if (!result?.ok) {
        showToast("Couldn’t queue that link", "error");
        return;
      }

      if (result.duplicate) {
        showToast(result.kind === "short" ? "Short already in the ready lane" : "Video already in the sleep lane");
        return;
      }

      showToast(
        result.kind === "short"
          ? "Short queued · ready, paused"
          : "Video queued · sleeping",
        result.kind
      );
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
    sendToQueue(url);
  }

  function handleMiddleClick(event) {
    if (!settings.captureMiddleClick || event.button !== 1) return;
    const anchor = linkFromEvent(event);
    const url = anchor && queueableUrl(anchor.href);
    if (!url) return;
    stopNativeOpen(event);
    sendToQueue(url);
  }

  function currentQueueKey() {
    const url = new URL(location.href);
    if (url.searchParams.get("qt_queue") !== "1") return null;
    return `${url.searchParams.get("qt_kind") || "video"}:${url.searchParams.get("v") || url.pathname}`;
  }

  function syncQueuePage() {
    const nextKey = currentQueueKey();
    if (nextKey !== queuedPageKey) {
      queuedPageKey = nextKey;
      manualPlaybackUnlocked = false;
    }
    enforcePlaybackPolicy();
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

  function unlockFromIntent(event) {
    if (!queuedPageKey || document.hidden) return;
    if (event.type === "keydown" && ![" ", "k", "K", "Enter"].includes(event.key)) return;
    manualPlaybackUnlocked = true;
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
            position: fixed;
            z-index: 2147483647;
            left: 22px;
            bottom: 22px;
            max-width: 320px;
            padding: 12px 15px 12px 38px;
            border: 1px solid rgba(255,255,255,.16);
            border-radius: 10px;
            color: #f8fbfa;
            background: #122423;
            box-shadow: 0 12px 36px rgba(0,0,0,.28);
            font: 600 13px/1.35 "Segoe UI", sans-serif;
            letter-spacing: .01em;
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 150ms ease, transform 150ms ease;
            pointer-events: none;
          }
          .toast::before {
            content: "";
            position: absolute;
            left: 15px;
            top: 50%;
            width: 10px;
            height: 10px;
            border: 2px solid #9fb5b2;
            border-radius: 50%;
            transform: translateY(-50%);
          }
          .toast[data-tone="short"]::before { border-color: #f26b3a; background: #f26b3a; }
          .toast[data-tone="video"]::before { border-color: #6f8cff; background: #6f8cff; }
          .toast[data-tone="error"]::before { border-color: #ffb44a; }
          .toast.show { opacity: 1; transform: translateY(0); }
        </style>
        <div class="toast" role="status" aria-live="polite"></div>`;
      (document.documentElement || document).appendChild(host);
    }

    const toast = host.shadowRoot.querySelector(".toast");
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  window.addEventListener("click", handleModifiedClick, true);
  window.addEventListener("auxclick", handleMiddleClick, true);
  document.addEventListener("play", (event) => {
    if (shouldBlockPlayback() && event.target instanceof HTMLMediaElement) pauseMedia(event.target);
  }, true);
  document.addEventListener("visibilitychange", enforcePlaybackPolicy, true);
  document.addEventListener("pointerdown", unlockFromIntent, true);
  document.addEventListener("keydown", unlockFromIntent, true);
  document.addEventListener("yt-navigate-finish", syncQueuePage, true);
  window.addEventListener("popstate", syncQueuePage, true);
  document.addEventListener("DOMContentLoaded", syncQueuePage, { once: true });
  syncQueuePage();
})();
