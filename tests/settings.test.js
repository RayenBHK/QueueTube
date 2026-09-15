import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createQueueItem, migratePersistentState, restoreBackupPayload, sanitizeSettings } from "../src/queue-core.js";
import { FEATURE_GROUPS } from "../src/settings-ui.js";

test("every preference appears exactly once in the shared feature catalog", () => {
  const keys = FEATURE_GROUPS.flatMap((group) => group.entries.map((entry) => entry.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test("legacy manual-start behavior migrates without coupling the new switches", () => {
  for (const value of [true, false]) {
    const migrated = migratePersistentState({ qtSettings: { pauseBackground: value } });
    assert.equal(migrated.settings.manualPlay, value);
    assert.equal(migrated.settings.pauseBackground, value);
  }
  assert.deepEqual(sanitizeSettings({ pauseBackground: false, manualPlay: true }), { ...DEFAULT_SETTINGS, pauseBackground: false });
  const disabled = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, typeof value === "boolean" ? false : value]));
  assert.deepEqual(sanitizeSettings(disabled), disabled);
  const restored = restoreBackupPayload({ version: 3, settings: disabled, items: [] }, [], DEFAULT_SETTINGS, "replace");
  assert.deepEqual(restored.settings, disabled);
});

test("settings writes, playback preferences, history opt-out, and budgets work through background messages", async (t) => {
  const originalChrome = globalThis.chrome;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const stores = { local: { qtSettings: { ...DEFAULT_SETTINGS }, qtQueueItems: [], qtHistory: [] }, session: {} };
  const area = (name) => ({
    async get(keys) {
      await Promise.resolve();
      const data = stores[name];
      if (keys === null) return structuredClone(data);
      if (typeof keys === "string") return { [keys]: structuredClone(data[keys]) };
      return structuredClone({ ...keys, ...data });
    },
    async set(values) { Object.assign(stores[name], structuredClone(values)); }
  });
  const tails = new Map();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    async request(name, options, operation) {
      const callback = operation || options;
      const previous = tails.get(name) || Promise.resolve();
      let release;
      tails.set(name, new Promise((resolve) => { release = resolve; }));
      await previous;
      try { return await callback(); } finally { release(); }
    }
  } } });
  let listener;
  let lastUrl;
  let badge;
  const event = { addListener() {} };
  globalThis.chrome = {
    runtime: { id: "test", getURL: (path) => `chrome-extension://test/${path}`, onInstalled: event, onStartup: event, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: area("local"), session: area("session") },
    windows: { async getLastFocused() { return { id: 1 }; }, async update() {} },
    tabGroups: { async query() { return []; }, onRemoved: event, TAB_GROUP_ID_NONE: -1 },
    commands: { onCommand: event },
    action: { async setBadgeText({ text }) { badge = text; }, async setBadgeBackgroundColor() {}, async setTitle() {} },
    tabs: {
      onUpdated: event, onActivated: event, onRemoved: event, onAttached: event, onDetached: event,
      async create({ url }) { lastUrl = url; return { id: 42, url, windowId: 1 }; },
      async get() { return { id: 42, url: lastUrl, windowId: 1 }; },
      async update(id, { url }) { lastUrl = url; return { id, url, windowId: 1 }; }
    }
  };
  t.after(() => {
    globalThis.chrome = originalChrome;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  await import(`../src/background.js?settings-test=${Date.now()}`);
  const send = (message) => new Promise((resolve) => listener(message, { id: "test", url: "chrome-extension://test/src/popup/popup.html" }, resolve));

  const results = await Promise.all([
    send({ type: "UPDATE_SETTINGS", patch: { pauseBackground: false } }),
    send({ type: "UPDATE_SETTINGS", patch: { focusShield: false } })
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(stores.local.qtSettings.pauseBackground, false);
  assert.equal(stores.local.qtSettings.focusShield, false);
  assert.equal(stores.local.qtSettings.manualPlay, true);

  const item = createQueueItem("https://www.youtube.com/shorts/abc", { title: "A pick" });
  stores.local.qtQueueItems = [item];
  await send({ type: "UPDATE_SETTINGS", patch: { shortsInPlayer: false, manualPlay: false, recordHistory: false, showCountBadge: false } });
  assert.equal(badge, "");
  assert.equal((await send({ type: "OPEN_ITEM", itemId: item.id })).ok, true);
  assert.equal(new URL(lastUrl).pathname, "/shorts/abc");
  assert.equal(new URL(lastUrl).searchParams.get("autoplay"), "1");
  stores.local.qtHistory = [{ id: "existing-history" }];
  assert.equal((await send({ type: "FINISH_CURRENT" })).ok, true);
  assert.deepEqual(stores.local.qtHistory, [{ id: "existing-history" }]);
  assert.equal(stores.local.qtQueueItems.length, 0);
  assert.equal((await send({ type: "UPDATE_SETTINGS", patch: { defaultBudgetMinutes: 15 } })).ok, true);
  assert.equal(stores.session.qtSession.budgetMinutes, 15);
  assert.ok(stores.session.qtSession.startedAt > 0);
  assert.equal((await send({ type: "SET_BUDGET", minutes: 0 })).ok, true);
  assert.equal(stores.local.qtSettings.defaultBudgetMinutes, 0);
  assert.equal(stores.session.qtSession.budgetMinutes, 0);
});
