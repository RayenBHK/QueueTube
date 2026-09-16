import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/queue-core.js";

function eventSlot() {
  let listener;
  return {
    event: { addListener(candidate) { listener = candidate; } },
    getListener() { return listener; }
  };
}

function flippedValue(key, current) {
  if (typeof DEFAULT_SETTINGS[key] === "boolean") return !current;
  if (key === "captureMode") return current === "queue-room" ? "classic-tabs" : "queue-room";
  if (key === "theme") return current === "dark" ? "light" : "dark";
  if (key === "defaultBudgetMinutes") return current === 30 ? 45 : 30;
  throw new Error(`no audit value for ${key}`);
}

async function worker() {
  const local = {
    qtSchemaVersion: 3,
    qtSettings: { ...DEFAULT_SETTINGS },
    qtQueueItems: [],
    qtHistory: []
  };
  const session = { qtSession: null };
  const messageSlot = eventSlot();
  const originalChrome = globalThis.chrome;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.chrome = {
    runtime: {
      id: "queuetube-test",
      getURL: (path = "") => `chrome-extension://queuetube-test/${path}`,
      onInstalled: eventSlot().event,
      onStartup: eventSlot().event,
      onMessage: messageSlot.event
    },
    storage: {
      local: {
        async get(query) {
          if (query === null || query === undefined) return { ...local };
          if (typeof query === "string") return { [query]: local[query] };
          const result = {};
          for (const key of Object.keys(query)) result[key] = key in local ? local[key] : query[key];
          return result;
        },
        async set(patch) { Object.assign(local, patch); },
        onChanged: eventSlot().event
      },
      session: {
        async get(query) {
          if (typeof query === "string") return { [query]: session[query] };
          const result = {};
          for (const key of Object.keys(query || {})) result[key] = key in session ? session[key] : query[key];
          return result;
        },
        async set(patch) { Object.assign(session, patch); },
        onChanged: eventSlot().event
      }
    },
    tabs: {
      onUpdated: eventSlot().event,
      onActivated: eventSlot().event,
      onRemoved: eventSlot().event,
      onAttached: eventSlot().event,
      onDetached: eventSlot().event,
      async query() { return []; }
    },
    tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: eventSlot().event, async query() { return []; } },
    windows: { async getLastFocused() { return { id: 1 }; } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    commands: { onCommand: eventSlot().event },
    sidePanel: {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(name, optionsOrOperation, maybeOperation) {
          const operation = typeof optionsOrOperation === "function" ? optionsOrOperation : maybeOperation;
          return operation();
        }
      }
    }
  });

  await import(`../src/background.js?settings-audit-test=${Date.now()}`);
  const onMessage = messageSlot.getListener();
  assert.equal(typeof onMessage, "function");
  return {
    update(patch) {
      const sender = { id: "queuetube-test" };
      sender.url = "chrome-extension://queuetube-test/src/sidepanel/sidepanel.html";
      return new Promise((resolve) => {
        const handled = onMessage({ type: "UPDATE_SETTINGS", patch }, sender, resolve);
        if (handled !== true) resolve(undefined);
      });
    },
    stored() {
      return local.qtSettings;
    },
    restore() {
      globalThis.chrome = originalChrome;
      if (originalNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    }
  };
}

test("every preference persists through the worker settings path", async (context) => {
  const settings = await worker();
  context.after(() => settings.restore());
  assert.equal(Object.keys(DEFAULT_SETTINGS).length, 24);
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const next = flippedValue(key, settings.stored()[key]);
    const result = await settings.update({ [key]: next });
    assert.equal(result?.ok, true, key);
    assert.deepEqual(result.settings[key], next, key);
    assert.deepEqual(settings.stored()[key], next, key);
  }
});

test("invalid preference values are rejected without touching stored settings", async (context) => {
  const settings = await worker();
  context.after(() => settings.restore());
  const before = { ...settings.stored() };
  for (const patch of [
    { captureMode: "floating-tabs" },
    { theme: "neon" },
    { defaultBudgetMinutes: 181 },
    { defaultBudgetMinutes: -1 },
    { pauseBackground: "yes" },
    { showToasts: 1 },
    { unknownFutureKey: true }
  ]) {
    const result = await settings.update(patch);
    assert.equal(result?.ok, true);
  }
  assert.deepEqual(settings.stored(), before);
});
