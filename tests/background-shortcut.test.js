import test from "node:test";
import assert from "node:assert/strict";

function eventSlot() {
  let listener;
  return {
    event: {
      addListener(candidate) {
        listener = candidate;
      }
    },
    getListener() {
      return listener;
    }
  };
}

test("Queue Room shortcut opens the side panel synchronously in the command window", async (context) => {
  const commandSlot = eventSlot();
  const passiveSlots = Array.from({ length: 9 }, eventSlot);
  const calls = [];
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    runtime: {
      id: "queuetube-test",
      getURL: (path = "") => `chrome-extension://queuetube-test/${path}`,
      onInstalled: passiveSlots[0].event,
      onStartup: passiveSlots[1].event,
      onMessage: passiveSlots[2].event
    },
    commands: {
      onCommand: commandSlot.event
    },
    sidePanel: {
      open(options) {
        calls.push({ type: "open", options });
        return Promise.resolve();
      }
    },
    windows: {
      getLastFocused() {
        calls.push({ type: "window-lookup" });
        return Promise.resolve({ id: 99 });
      }
    },
    tabs: {
      onUpdated: passiveSlots[3].event,
      onActivated: passiveSlots[4].event,
      onRemoved: passiveSlots[5].event,
      onAttached: passiveSlots[6].event,
      onDetached: passiveSlots[7].event
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      onRemoved: passiveSlots[8].event
    }
  };
  context.after(() => {
    globalThis.chrome = originalChrome;
  });

  await import(`../src/background.js?shortcut-test=${Date.now()}`);
  const onCommand = commandSlot.getListener();
  assert.equal(typeof onCommand, "function");

  onCommand("open-queue-room", { windowId: 27 });

  assert.deepEqual(calls, [{ type: "open", options: { windowId: 27 } }]);
  await Promise.resolve();
});
