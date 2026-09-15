import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Always owns a fresh signed-out profile; never connects to the user's browser.
const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(resolve(artifacts, "queuetube-v032-"));
const port = 9232;
const base = `http://127.0.0.1:${port}`;
const browser = spawn(resolve(root, ".tools/chrome-win64/chrome.exe"), [
  "--headless=new", "--enable-automation", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--disable-background-networking",
  `--disable-extensions-except=${root}`, `--load-extension=${root}`, "about:blank"
], { windowsHide: true, stdio: "ignore" });
const clients = [];
let browserClient;
let verifiedProfile = false;
let startupError;
browser.on("error", (error) => { startupError = error; });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(operation, test = Boolean) {
  let value;
  let error;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (startupError) throw startupError;
    try { value = await operation(); if (test(value)) return value; } catch (failure) { error = failure; }
    await delay(250);
  }
  throw new Error(`Browser check timed out: ${error?.message || JSON.stringify(value)}`);
}
async function connect(target, enableRuntime = true) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.fail(new Error(message.error.message)); else request.done(message.result);
  });
  const client = { socket, errors, send(method, params = {}) {
    const callId = ++id;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { pending.delete(callId); fail(new Error(`Timed out: ${method}`)); }, 15_000);
      pending.set(callId, { done, fail, timer });
      socket.send(JSON.stringify({ id: callId, method, params }));
    });
  } };
  clients.push(client);
  if (enableRuntime) await client.send("Runtime.enable");
  return client;
}
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function page(url) {
  const response = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return connect(await response.json());
}
const state = (client) => evaluate(client, "chrome.runtime.sendMessage({type:'GET_APP_STATE'})");

try {
  const targets = await poll(async () => (await fetch(`${base}/json/list`)).json(), (list) => list.some((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js")));
  const worker = await connect(targets.find((target) => target.type === "service_worker" && target.url.endsWith("/src/background.js")));
  browserClient = await connect(await (await fetch(`${base}/json/version`)).json(), false);
  const commandLine = await browserClient.send("Browser.getBrowserCommandLine");
  assert.ok(commandLine.arguments.includes(`--user-data-dir=${profile}`), "Refuse any browser other than this test's fresh profile");
  verifiedProfile = true;
  const extension = await evaluate(worker, "chrome.runtime.getURL('')");
  const popup = await page(`${extension}src/popup/popup.html`);
  await poll(() => evaluate(popup, "document.querySelector('#quick-pause')?.disabled === false"));
  await popup.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 588, deviceScaleFactor: 1, mobile: false });
  await evaluate(popup, `(async () => {
    const {DEFAULT_SETTINGS,createQueueItem}=await import(chrome.runtime.getURL('src/queue-core.js'));
    await chrome.storage.local.set({qtSettings:{...DEFAULT_SETTINGS,theme:'dark'},qtQueueItems:[
      createQueueItem('https://www.youtube.com/shorts/first',{title:'A short worth saving'}),
      createQueueItem('https://www.youtube.com/shorts/second',{title:'One useful idea'}),
      createQueueItem('https://www.youtube.com/watch?v=third',{title:'A longer watch'})
    ]});
  })()`);
  await poll(() => evaluate(popup, "document.querySelector('#total-count').textContent==='3' && document.documentElement.dataset.theme==='dark'"));
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  assert.equal(await evaluate(popup, "document.querySelector('#version').textContent"), manifest.version);
  const capture = async (client, name) => {
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(artifacts, name), Buffer.from(data, "base64"));
  };
  await capture(popup, "v0.3.2-popup-dark.png");
  await evaluate(popup, "document.querySelector('#quick-pause').click()");
  await poll(() => state(popup), (value) => value.settings.pauseBackground === false);
  assert.equal((await state(popup)).settings.manualPlay, true);
  await evaluate(popup, "document.querySelector('#features-tab').click()");
  assert.equal(await evaluate(popup, "document.querySelector('#features-view').hidden"), false);
  const controls = await evaluate(popup, "[...document.querySelectorAll('#feature-settings [data-setting]')].map(input=>({key:input.dataset.setting,label:input.labels[0].querySelector('strong').textContent,help:document.getElementById(input.getAttribute('aria-describedby'))?.textContent}))");
  assert.equal(controls.length, Object.keys((await state(popup)).settings).length);
  assert.ok(controls.every((control) => control.label && control.help));
  await capture(popup, "v0.3.2-features-dark.png");
  await evaluate(popup, "const search=document.querySelector('#feature-search');search.value='leaving';search.dispatchEvent(new Event('input'))");
  assert.equal(await evaluate(popup, "[...document.querySelectorAll('.feature-row')].filter(row=>!row.hidden).length"), 1);
  await evaluate(popup, "search.value='';search.dispatchEvent(new Event('input'));document.querySelector('#setting-focusShield').click()");
  await poll(() => evaluate(popup, "document.querySelector('#setting-hideComments').disabled"));
  const panel = await page(`${extension}src/sidepanel/sidepanel.html`);
  await poll(() => evaluate(panel, "document.querySelector('#total-count')?.textContent==='3' && document.querySelector('#setting-pauseBackground')?.checked===false"));
  await evaluate(panel, "document.querySelector('#setting-pauseBackground').click()");
  await poll(() => evaluate(popup, "document.querySelector('#quick-pause').checked"));
  await evaluate(popup, "chrome.runtime.sendMessage({type:'UPDATE_SETTINGS',patch:{theme:'light'}})");
  await poll(() => evaluate(popup, "document.documentElement.dataset.theme==='light'"));
  await capture(popup, "v0.3.2-features-light.png");
  for (const width of [320, 420]) {
    await popup.send("Emulation.setDeviceMetricsOverride", { width, height: 588, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(popup, "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.content').scrollWidth <= document.querySelector('.content').clientWidth"), true, `Popup reflows at ${width}px`);
  }
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate(panel, "document.querySelector('.settings-panel').open=true;document.querySelectorAll('.feature-group').forEach(group=>group.open=true)");
  assert.equal(await evaluate(panel, "document.documentElement.scrollWidth<=innerWidth"), true, "Queue Room settings reflow at 320px");
  await evaluate(panel, "document.querySelector('#feature-settings').scrollIntoView()");
  await capture(panel, "v0.3.2-room-settings.png");
  await evaluate(popup, "document.querySelector('#queue-tab').focus()");
  await popup.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
  assert.equal(await evaluate(popup, "document.activeElement.id"), "features-tab");
  const reopened = await page(`${extension}src/popup/popup.html`);
  await poll(() => evaluate(reopened, "document.querySelector('#quick-pause')?.disabled===false"));
  assert.equal((await state(reopened)).settings.focusShield, false);
  assert.equal((await state(reopened)).settings.theme, "light");
  assert.ok(clients.every((client) => !client.errors.length), "No uncaught extension errors");
  console.log(`QueueTube ${manifest.version}: browser checks passed (${controls.length} controls, persistence, live sync, search, keyboard, themes, 320px reflow).`);
  await writeFile(resolve(artifacts, "v0.3.2-settings-smoke.json"), JSON.stringify({ version: manifest.version, passed: true, controls: controls.length, screenshots: ["v0.3.2-popup-dark.png", "v0.3.2-features-dark.png", "v0.3.2-features-light.png"] }, null, 2));
} finally {
  if (verifiedProfile) { try { await browserClient.send("Browser.close"); } catch { /* Process cleanup follows. */ } }
  for (const client of clients) client.socket.close();
  browser.kill();
}
