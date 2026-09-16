import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SESSION, DEFAULT_SETTINGS, createQueueItem } from "../src/queue-core.js";

function eventSlot() {
  let listener;
  return {
    event: { addListener(candidate) { listener = candidate; } },
    getListener() { return listener; }
  };
}

function memoryStore(initial = {}) {
  let data = { ...initial };
  return {
    async get(query) {
      if (query === null || query === undefined) return { ...data };
      if (typeof query === "string") return { [query]: data[query] };
      const result = {};
      for (const key of Object.keys(query)) {
        result[key] = key in data ? data[key] : query[key];
      }
      return result;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
    snapshot() {
      return JSON.parse(JSON.stringify(data));
    }
  };
}

async function worker(seeds = {}) {
  const first = createQueueItem("https://www.youtube.com/watch?v=AAA11111111", { title: "First", channel: "C1" });
  const second = createQueueItem("https://www.youtube.com/watch?v=BBB22222222", { title: "Second", channel: "C2" });
  const local = memoryStore({
    qtSchemaVersion: 3,
    qtSettings: { ...DEFAULT_SETTINGS },
    qtQueueItems: [first, second],
    qtHistory: [],
    ...seeds.local
  });
  const session = memoryStore({
    qtSession: {
      ...DEFAULT_SESSION,
      status: "ready",
      playerTabId: 42,
      currentItemId: first.id,
      currentKind: "video",
      transitionToken: "token-1",
      sessionId: "session-1",
      ...seeds.session
    },
    ...seeds.sessionStore
  });
  const tabs = new Map(Object.entries(seeds.tabs || {
    42: { id: 42, url: "https://www.youtube.com/watch?v=AAA11111111" }
  }).map(([id, tab]) => [Number(id), tab]));
  let nextTabId = 100;
  const messageSlot = eventSlot();
  const chromeStub = {
    runtime: {
      id: "queuetube-test",
      getURL: (path = "") => `chrome-extension://queuetube-test/${path}`,
      onInstalled: eventSlot().event,
      onStartup: eventSlot().event,
      onMessage: messageSlot.event
    },
    storage: {
      local: { get: (query) => local.get(query), set: (patch) => local.set(patch), onChanged: eventSlot().event },
      session: { get: (query) => session.get(query), set: (patch) => session.set(patch), onChanged: eventSlot().event }
    },
    tabs: {
      onUpdated: eventSlot().event,
      onActivated: eventSlot().event,
      onRemoved: eventSlot().event,
      onAttached: eventSlot().event,
      onDetached: eventSlot().event,
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("No tab with id");
        return tab;
      },
      async create(properties) {
        const tab = { id: nextTabId++, url: properties?.url || "", windowId: properties?.windowId ?? 1 };
        tabs.set(tab.id, tab);
        return tab;
      },
      async update(tabId, properties) {
        const tab = { ...(tabs.get(tabId) || { id: tabId }), ...properties };
        tabs.set(tabId, tab);
        return tab;
      },
      async query() { return []; },
      async remove(tabIds) {
        for (const id of [].concat(tabIds)) tabs.delete(id);
      }
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      onRemoved: eventSlot().event,
      async query() { return []; }
    },
    windows: {
      async getLastFocused() { return { id: 1 }; },
      async getCurrent() { return { id: 1 }; },
      async update() { return {}; }
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
      async setTitle() {}
    },
    commands: { onCommand: eventSlot().event, async getAll() { return []; } },
    sidePanel: { async open() {} }
  };
  const originalChrome = globalThis.chrome;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.chrome = chromeStub;
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

  await import(`../src/background.js?player-recovery-test=${Date.now()}`);
  const onMessage = messageSlot.getListener();
  assert.equal(typeof onMessage, "function");
  return {
    first,
    second,
    local,
    session,
    tabs,
    call(message, tabId = 42) {
      return new Promise((resolve) => {
        const sender = {
          id: "queuetube-test",
          tab: { id: tabId, url: "https://www.youtube.com/watch?v=AAA11111111" }
        };
        const handled = onMessage(message, sender, resolve);
        if (handled !== true) resolve(undefined);
      });
    },
    restore() {
      globalThis.chrome = originalChrome;
      if (originalNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    }
  };
}

test("an unavailable video moves the session to an error state without touching the queue", async (context) => {
  const player = await worker();
  context.after(() => player.restore());
  const result = await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-1" });
  assert.equal(result.ok, true);
  assert.equal(result.session.status, "error");
  assert.equal(result.session.lastError, "video-unavailable");
  assert.equal(result.session.currentItemId, player.first.id);
  assert.deepEqual(player.local.snapshot().qtQueueItems.map((item) => item.id), [player.first.id, player.second.id]);
  assert.deepEqual(player.local.snapshot().qtHistory, []);
});

test("stale player reports are rejected and leave the session alone", async (context) => {
  const player = await worker();
  context.after(() => player.restore());
  const staleToken = await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-stale" });
  assert.deepEqual(staleToken, { ok: false, reason: "stale-player" });
  const wrongTab = await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-1" }, 77);
  assert.deepEqual(wrongTab, { ok: false, reason: "stale-player" });
  const stored = (await player.session.get("qtSession")).qtSession;
  assert.equal(stored.status, "ready");
  assert.equal(stored.lastError, null);
});

test("a repeated unavailable report is idempotent and a new pick recovers from the error", async (context) => {
  const player = await worker();
  context.after(() => player.restore());
  await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-1" });
  const repeat = await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-1" });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.session.status, "error");
  player.tabs.delete(42);
  const retry = await player.call({ type: "OPEN_ITEM", itemId: player.second.id });
  assert.equal(retry.ok, true);
  assert.equal(retry.session.status, "ready");
  assert.equal(retry.session.currentItemId, player.second.id);
  assert.equal(retry.session.lastError, null);
  assert.notEqual(retry.session.playerTabId, 42);
});

test("unavailable reports outside active playback are ignored", async (context) => {
  const player = await worker({ session: { status: "idle" } });
  context.after(() => player.restore());
  const result = await player.call({ type: "PLAYER_UNAVAILABLE", itemId: player.first.id, transitionToken: "token-1" });
  assert.deepEqual(result, { ok: false, reason: "not-playing" });
});
