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
let queueWorker = initialTargets.find((target) => target.type === "service_worker" && target.url.endsWith("/background.js"));
let panelTarget = null;
if (!queueWorker && extensionId) {
  panelTarget = await createTarget(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
  queueWorker = await poll(
    async () => (await getTargets()).find((target) => target.type === "service_worker" && target.url.endsWith("/background.js")),
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
const manifestVersion = await evaluate(workerClient, "chrome.runtime.getManifest().version");
assert(manifestVersion === "0.3.0", "Loaded manifest is QueueTube v0.3.0", manifestVersion);
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
await panelClient.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 800, deviceScaleFactor: 1, mobile: false });
await poll(() => evaluate(panelClient, "document.querySelector('#total-count')?.textContent"), (value) => value === "1");
assert(await evaluate(panelClient, "document.querySelector('#total-count').textContent") === "1", "Queue Room rendered persisted state");

const shortResult = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'QUEUE_URL',
  url: 'https://www.youtube.com/shorts/jNQXAC9IVRw',
  metadata: { title: 'QueueTube browser smoke Short', channel: 'QueueTube QA', durationText: '0:19' }
})`, true);
assert(shortResult.ok && shortResult.kind === "short", "Queue Room accepted a Short without a new tab");

const secondShortResult = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'QUEUE_URL',
  url: 'https://www.youtube.com/shorts/aqz-KE-bpKQ',
  metadata: { title: 'QueueTube Later contract Short', channel: 'QueueTube QA', durationText: '0:24' }
})`, true);
assert(secondShortResult.ok && secondShortResult.kind === "short", "Second Short prepared the Later sequence");

const firstExplicitVideo = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'QUEUE_URL',
  url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
  metadata: { title: 'QueueTube explicit video one', channel: 'QueueTube QA', durationText: '1:12' }
})`, true);
const secondExplicitVideo = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'QUEUE_URL',
  url: 'https://www.youtube.com/watch?v=ysz5S6PUM-U',
  metadata: { title: 'QueueTube explicit video two', channel: 'QueueTube QA', durationText: '2:40' }
})`, true);
assert(firstExplicitVideo.ok && secondExplicitVideo.ok, "Multiple long videos stayed as lightweight records");

const openShort = await evaluate(panelClient, `chrome.runtime.sendMessage({ type: 'OPEN_ITEM', itemId: ${JSON.stringify(shortResult.itemId)} })`, true);
assert(openShort.ok && Number.isInteger(openShort.tabId), "Short opened in the controlled player");
const firstPlayerTabId = openShort.tabId;

const laterResult = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'DEFER_CURRENT' })", true);
assert(laterResult.ok && laterResult.deferred && laterResult.tabId === firstPlayerTabId, "Later reused the player and selected the following Short");
const laterState = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'GET_APP_STATE' })", true);
const shortLaneAfterLater = laterState.items.filter((item) => item.kind === "short");
assert(shortLaneAfterLater.at(-1).id === shortResult.itemId, "Later moved the current Short to its lane end");
assert(laterState.session.currentItemId !== shortResult.itemId && laterState.session.status === "ready", "Later left the next pick ready and paused");

const openVideo = await evaluate(panelClient, `chrome.runtime.sendMessage({ type: 'OPEN_ITEM', itemId: ${JSON.stringify(firstExplicitVideo.itemId)} })`, true);
assert(openVideo.ok && openVideo.tabId === firstPlayerTabId, "Long video reused the same player tab");

const batchResult = await evaluate(panelClient, `chrome.runtime.sendMessage({
  type: 'BATCH_ITEMS',
  itemIds: [${JSON.stringify(firstExplicitVideo.itemId)}, ${JSON.stringify(secondExplicitVideo.itemId)}],
  action: 'top'
})`, true);
assert(batchResult.ok && batchResult.affected === 2, "Bulk queue action updated both selected videos");
const batchState = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'GET_APP_STATE' })", true);
assert(batchState.items.filter((item) => item.kind === "video")[0].id === firstExplicitVideo.itemId, "Bulk move preserved selected video order");

const badRestore = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'RESTORE_BACKUP', payload: '{bad', mode: 'merge' })", true);
assert(!badRestore.ok && badRestore.reason === "invalid-json", "Invalid backup was rejected without mutation");
const restorePayload = JSON.stringify({ version: 3, items: [{ sourceUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE", title: "Restored QueueTube QA pick", kind: "video" }], history: [] });
const restoreResult = await evaluate(panelClient, `chrome.runtime.sendMessage({ type: 'RESTORE_BACKUP', payload: ${JSON.stringify(restorePayload)}, mode: 'merge' })`, true);
assert(restoreResult.ok && restoreResult.imported === 1, "v3 backup merged a validated queue record");

const themeResult = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch: { theme: 'dark', compactDensity: true } })", true);
assert(themeResult.ok && themeResult.settings.theme === "dark" && themeResult.settings.compactDensity, "Dark theme and compact density persisted");
await poll(() => evaluate(panelClient, "document.documentElement.dataset.theme"), (value) => value === "dark");
assert(await evaluate(panelClient, "document.body.classList.contains('compact')"), "Queue Room applied dark compact presentation live");
const accessibilityAudit = await evaluate(panelClient, `(() => {
  const visible = (element) => !element.hidden && element.getClientRects().length > 0;
  const controls = [...document.querySelectorAll('button, input, select, textarea')].filter(visible);
  const unnamed = controls.filter((control) => {
    if (control.matches('input, select, textarea')) {
      return !(control.getAttribute('aria-label') || control.labels?.length);
    }
    return !(control.getAttribute('aria-label') || control.textContent.trim() || control.getAttribute('title'));
  });
  return {
    unnamed: unnamed.map((element) => element.outerHTML.slice(0, 120)),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    selectedTabs: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
    liveRegions: document.querySelectorAll('[aria-live]').length
  };
})()`);
assert(accessibilityAudit.unnamed.length === 0, "Visible Queue Room controls have accessible names", accessibilityAudit.unnamed.join(" | "));
assert(!accessibilityAudit.overflow, "Queue Room has no horizontal overflow at panel width");
assert(accessibilityAudit.selectedTabs === 1 && accessibilityAudit.liveRegions >= 1, "Tabs and live status expose accessible state");
await panelClient.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: false });
await evaluate(panelClient, "document.getElementById('toggle-select').click(); true", true);
await poll(() => evaluate(panelClient, "document.body.classList.contains('is-selecting')"), Boolean);
assert(!await evaluate(panelClient, "document.documentElement.scrollWidth > document.documentElement.clientWidth"), "Selection mode reflows at 320 CSS pixels");
await evaluate(panelClient, "document.getElementById('cancel-select').click(); true", true);
await panelClient.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 800, deviceScaleFactor: 1, mobile: false });

const commandsResult = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'GET_COMMAND_STATE' })", true);
assert(commandsResult.ok && commandsResult.commands.length >= 5, "Shortcut assignment status is available to the UI");

const playerTarget = await poll(
  async () => (await getTargets()).find((target) => {
    if (target.type !== "page" || !target.url.includes("qt_queue=1")) return false;
    return new URL(target.url).searchParams.get("qt_item") === firstExplicitVideo.itemId;
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

await evaluate(playerClient, "document.querySelector('video').dispatchEvent(new Event('ended')); true");
const advancedState = await poll(
  () => evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'GET_APP_STATE' })", true),
  (value) => value?.session?.currentItemId === secondExplicitVideo.itemId && value.session.status === "ready",
  30_000
);
assert(advancedState.session.playerTabId === firstPlayerTabId, "Natural video completion advanced in the same player tab");
assert(advancedState.history.some((entry) => entry.id === firstExplicitVideo.itemId && entry.outcome === "watched"), "Natural completion recorded a watched outcome");
await poll(
  () => evaluate(playerClient, "document.querySelector('video')?.paused ?? null"),
  (value) => value === true,
  30_000
);
assert(true, "The next long video loaded paused after natural completion");

const budgetResult = await evaluate(panelClient, "chrome.runtime.sendMessage({ type: 'SET_BUDGET', minutes: 45 })", true);
assert(budgetResult.ok && budgetResult.session.budgetMinutes === 45, "Custom 45-minute session budget persisted");

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
