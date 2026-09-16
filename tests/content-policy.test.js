import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { DEFAULT_SETTINGS } from "../src/queue-core.js";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

async function player(patch = {}, queued = true) {
  const events = new Map();
  const classes = new Set();
  const messages = [];
  let settingsListener;
  class Element { matches(selector) { return selector.includes("video"); } }
  class Media extends Element {
    paused = true;
    addEventListener() {}
    removeEventListener() {}
    pause() { this.paused = true; }
  }
  class Input extends Element {}
  class TextArea extends Element {}
  const media = new Media();
  const editableTargets = [new Input(), new TextArea(), Object.assign(new Element(), { isContentEditable: true })];
  const on = (name, fn) => events.set(name, [...(events.get(name) || []), fn]);
  const document = {
    hidden: false,
    documentElement: { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } },
    addEventListener: on,
    querySelector: (selector) => selector === "video" ? media : null,
    querySelectorAll: (selector) => selector === "video, audio" ? [media] : [],
    getElementById: () => null
  };
  const window = { addEventListener: on, setTimeout() {}, clearTimeout() {}, setInterval() {} };
  const chrome = {
    storage: { local: { async get() { return { qtSettings: { ...DEFAULT_SETTINGS, ...patch } }; } }, onChanged: { addListener(fn) { settingsListener = fn; } } },
    runtime: { async sendMessage(message) { messages.push(message); return { ok: true, shouldPause: false }; } }
  };
  runInNewContext(source, {
    URL, document, window, chrome, Element, HTMLAnchorElement: class extends Element {},
    HTMLInputElement: Input, HTMLTextAreaElement: TextArea, HTMLMediaElement: Media,
    location: { href: queued ? "https://www.youtube.com/watch?v=abc&qt_queue=1&qt_item=video:abc&qt_transition=one" : "https://www.youtube.com/watch?v=abc", pathname: "/watch" },
    MutationObserver: class { observe() {} }, requestAnimationFrame: (fn) => fn()
  });
  await new Promise(setImmediate);
  const fire = (name, event = {}) => { for (const fn of events.get(name) || []) fn(event); };
  return {
    media, document, classes, messages, fire, editableTargets,
    play() { media.paused = false; fire("play", { target: media }); },
    unlock() { fire("pointerdown", { composedPath: () => [media] }); },
    settings(patch) { settingsListener({ qtSettings: { newValue: { ...DEFAULT_SETTINGS, ...patch } } }, "local"); }
  };
}

test("background listening does not unlock autoplay on a queued page", async () => {
  const page = await player({ pauseBackground: false, manualPlay: true });
  page.play();
  assert.equal(page.media.paused, true);
  page.unlock();
  page.play();
  assert.equal(page.media.paused, false);
  page.document.hidden = true;
  page.fire("visibilitychange");
  assert.equal(page.media.paused, false);
  page.settings({ pauseBackground: true, manualPlay: true });
  assert.equal(page.media.paused, true);
});

test("typing Space or K in editable fields does not unlock queued playback", async () => {
  for (const key of [" ", "k", "K"]) {
    const page = await player({ manualPlay: true, pauseBackground: false });
    for (const target of page.editableTargets) {
      let prevented = false;
      let stopped = false;
      page.fire("keydown", {
        key, target,
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
      });
      page.play();
      assert.equal(page.media.paused, true, `${JSON.stringify(key)} in ${target.constructor.name}`);
      assert.equal(prevented, false);
      assert.equal(stopped, false);
      assert.equal(page.messages.length, 0);
    }
  }
});

test("Space and K still unlock queued playback outside editable fields", async () => {
  for (const key of [" ", "k", "K"]) {
    const page = await player({ manualPlay: true, playerShortcuts: false });
    page.play();
    assert.equal(page.media.paused, true);
    page.fire("keydown", { key, target: page.media });
    page.play();
    assert.equal(page.media.paused, false);
  }
});

test("all four combinations of manual-start and background-pause are independent", async () => {
  for (const manualPlay of [false, true]) {
    for (const pauseBackground of [false, true]) {
      const page = await player({ manualPlay, pauseBackground });
      page.play();
      assert.equal(page.media.paused, manualPlay);
      page.unlock();
      page.play();
      page.document.hidden = true;
      page.fire("visibilitychange");
      assert.equal(page.media.paused, pauseBackground);
    }
  }
});

test("normal YouTube tabs obey only the background switch", async () => {
  const page = await player({ manualPlay: true, pauseBackground: false }, false);
  page.document.hidden = true;
  page.play();
  assert.equal(page.media.paused, false);
  page.settings({ pauseBackground: true });
  assert.equal(page.media.paused, true);
});

test("Focus Shield components and player shortcuts respond to live preference changes", async () => {
  const page = await player({ hideComments: false, playerShortcuts: false });
  assert.ok(page.classes.has("queuetube-focus-shield"));
  assert.ok(page.classes.has("queuetube-hideRelated"));
  assert.equal(page.classes.has("queuetube-hideComments"), false);
  let prevented = false;
  const key = { key: "n", preventDefault() { prevented = true; }, stopPropagation() {} };
  page.fire("keydown", key);
  assert.equal(prevented, false);
  assert.equal(page.messages.length, 0);
  page.settings({ focusShield: false, playerShortcuts: true });
  assert.equal(page.classes.has("queuetube-focus-shield"), false);
  page.fire("keydown", key);
  assert.equal(prevented, true);
  assert.equal(page.messages.at(-1).type, "DEFER_CURRENT");
});
