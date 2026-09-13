import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(projectRoot, ".artifacts");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const extensionArgument = process.argv.find((argument) => argument.startsWith("--extension-id="));
const port = Number(portArgument?.split("=")[1] || 9228);
let extensionId = extensionArgument?.split("=")[1] || null;
const baseUrl = `http://127.0.0.1:${port}`;
const results = [];

function assert(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push(label);
}

async function sleep(milliseconds) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function poll(operation, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await operation();
    if (predicate(value)) return value;
    await sleep(400);
  }
  throw new Error(`Timed out with value: ${JSON.stringify(value)}`);
}

async function getTargets() {
  const response = await fetch(`${baseUrl}/json/list`);
  if (!response.ok) throw new Error(`Could not list Chrome targets: ${response.status}`);
  return response.json();
}

async function createTarget(url) {
  const response = await fetch(`${baseUrl}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Chrome target: ${response.status}`);
  return response.json();
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      errors.push(message.params.entry.text || "Console error");
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    async send(method, params = {}) {
      messageId += 1;
      const id = messageId;
      const response = new Promise((resolveMessage, rejectMessage) => {
        pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    errors,
    close() {
      socket.close();
    }
  };
}

async function evaluate(client, expression, userGesture = false) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

let initialTargets = await getTargets();
let queueWorker = initialTargets.find((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js"));
let panelTarget = null;
if (!queueWorker && extensionId) {
  panelTarget = await createTarget(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
  queueWorker = await poll(
    async () => (await getTargets()).find((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js")),
    Boolean
  );
  initialTargets = await getTargets();
}
assert(queueWorker, "QueueTube service worker loaded");
extensionId = new URL(queueWorker.url).hostname;
const workerClient = await connect(queueWorker.webSocketDebuggerUrl);
await workerClient.send("Runtime.enable");
await workerClient.send("Log.enable");
const manifestName = await evaluate(workerClient, "chrome.runtime.getManifest().name");
assert(manifestName === "QueueTube", "Loaded manifest identifies QueueTube", manifestName);
await evaluate(workerClient, "(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); return true; })()");
assert(true, "Smoke-test storage started clean");

const searchTarget = initialTargets.find((target) => target.type === "page" && target.url === "about:blank") || await createTarget("about:blank");
const searchClient = await connect(searchTarget.webSocketDebuggerUrl);
await searchClient.send("Page.enable");
await searchClient.send("Runtime.enable");
await searchClient.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await searchClient.send("Page.navigate", { url: "https://www.youtube.com/results?search_query=focus+productivity" });

const candidate = await poll(
  () => evaluate(searchClient, `(() => {
    const links = [...document.querySelectorAll('a[href]')];
    const link = links.find((entry) => entry.href.includes('/watch?v=')) || links.find((entry) => entry.href.includes('/shorts/'));
    return link ? { href: link.href, title: link.getAttribute('title') || link.textContent.trim() } : null;
  })()`),
  Boolean,
  45_000
);
assert(candidate.href.includes("youtube.com"), "Current YouTube results expose a queueable card");

const dispatched = await evaluate(searchClient, `(() => {
  const link = [...document.querySelectorAll('a[href]')].find((entry) => entry.href === ${JSON.stringify(candidate.href)});
  if (!link) return false;
  return !link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
})()`, true);
assert(dispatched, "Ctrl-click was intercepted instead of opening a tab");

const capturedItems = await poll(
  () => evaluate(workerClient, "(async () => { const { qtQueueItems = [] } = await chrome.storage.local.get('qtQueueItems'); return qtQueueItems; })()"),
  (items) => Array.isArray(items) && items.length >= 1
);
assert(capturedItems.length === 1, "Ctrl-click created one lightweight queue record");

const queuedBadges = await poll(
  () => evaluate(searchClient, "document.querySelectorAll('[data-queuetube-queued]').length"),
  (count) => count >= 1
);
assert(queuedBadges >= 1, "Queued thumbnail badge appeared on YouTube");
await sleep(400);
const searchScreenshot = await searchClient.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(resolve(projectRoot, "store-assets", "screenshot-queued-badge-1280x800.png"), Buffer.from(searchScreenshot.data, "base64"));
assert(Boolean(searchScreenshot.data), "Queued-badge store screenshot captured");

panelTarget ||= await createTarget(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
const panelClient = await connect(panelTarget.webSocketDebuggerUrl);
await panelClient.send("Page.enable");
await panelClient.send("Runtime.enable");
await panelClient.send("Log.enable");
await poll(() => evaluate(panelClient, "document.querySelector('#total-count')?.textContent"), (value) => value === "1");
assert(await evaluate(panelClient, "document.querySelector('#total-count').textContent") === "1", "Queue Room rendered persisted state");

const shortResult = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'QUEUE_URL',
  url: 'https://www.youtube.com/shorts/jNQXAC9IVRw',
  metadata: { title: 'QueueTube browser smoke Short', channel: 'QueueTube QA', durationText: '0:19' }
})`, true);
assert(shortResult.ok && shortResult.kind === "short", "Queue Room accepted a Short without a new tab");

const openShort = await evaluate(panelClient, `chrome.runtime.sendMessage({ type: 'OPEN_ITEM', itemId: ${JSON.stringify(shortResult.itemId)} })`, true);
assert(openShort.ok && Number.isInteger(openShort.tabId), "Short opened in the controlled player");
const firstPlayerTabId = openShort.tabId;

const firstItem = capturedItems[0];
const openVideo = await evaluate(panelClient, `chrome.runtime.sendMessage({ type: 'OPEN_ITEM', itemId: ${JSON.stringify(firstItem.id)} })`, true);
assert(openVideo.ok && openVideo.tabId === firstPlayerTabId, "Long video reused the same player tab");

const playerTarget = await poll(
  async () => (await getTargets()).find((target) => {
    if (target.type !== "page" || !target.url.includes("qt_queue=1")) return false;
    return new URL(target.url).searchParams.get("qt_item") === firstItem.id;
  }),
  Boolean,
  30_000
);
const playerClient = await connect(playerTarget.webSocketDebuggerUrl);
await playerClient.send("Runtime.enable");
const playbackState = await poll(
  () => evaluate(playerClient, `({
    ready: document.readyState,
    hasFocusShield: document.documentElement.classList.contains('queuetube-focus-shield'),
    paused: document.querySelector('video')?.paused ?? null
  })`),
  (value) => value?.ready === "complete" && value.paused !== null,
  45_000
);
assert(playbackState.hasFocusShield, "Focus Shield applied on controlled playback");
assert(playbackState.paused, "Controlled playback remained paused");

const budgetResult = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'SET_BUDGET', minutes: 10 })", true);
assert(budgetResult.ok && budgetResult.session.budgetMinutes === 10, "Session budget persisted");

await panelClient.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const panelScreenshot = await panelClient.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await mkdir(artifactDirectory, { recursive: true });
await writeFile(resolve(artifactDirectory, "browser-tested-queue-room-430x800.png"), Buffer.from(panelScreenshot.data, "base64"));
assert(Boolean(panelScreenshot.data), "Browser-tested Queue Room screenshot captured");

assert(panelClient.errors.length === 0, "Queue Room reported no runtime errors", panelClient.errors.join(" | "));
assert(workerClient.errors.length === 0, "Service worker reported no runtime errors", workerClient.errors.join(" | "));

for (const client of [playerClient, panelClient, searchClient, workerClient]) client.close();

console.log(JSON.stringify({
  ok: true,
  chrome: (await (await fetch(`${baseUrl}/json/version`)).json()).Browser,
  extensionId,
  checks: results
}, null, 2));
