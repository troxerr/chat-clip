"use strict";

// The app's rules in one place, with no Electron in it: what the window can
// ask for, what is refused, and what the window is told. main.js only wires
// this to Electron; tests drive it with fakes.

const { EventEmitter } = require("node:events");
const { INITIAL, reduce, started, stopped } = require("./status.js");

const HTTPS_ONLY = /^https:\/\//i;

function createApp({ engine, license, settings, clips, openExternal, openFolder, version = "0.0.0", outputFolder = "", versions = {} }) {
  const bus = new EventEmitter();
  let capture = INITIAL;
  const setCapture = (next) => { if (next !== capture) { capture = next; bus.emit("capture", capture); } };

  engine.on("event", (event) => {
    setCapture(reduce(capture, event));
    if (event.type === "clip-saved" || event.type === "history-updated") bus.emit("clips");
  });
  engine.on("exit", (info) => {
    setCapture(stopped(capture, { unexpected: info.unexpected, detail: info.detail }));
    bus.emit("clips");
  });

  const snapshot = () => ({ capture, license: license.state(), settings: settings.get(), version, versions });

  async function start(input, { acknowledge = false } = {}) {
    if (engine.running) throw new Error("A capture is already running.");
    const lic = license.state();
    if (!lic.valid) throw new Error(lic.message);
    if (!settings.get().permissionAcknowledged) {
      if (acknowledge !== true) throw new Error("Confirm that you have permission to record this channel.");
      settings.acknowledgePermission();
    }
    const channel = engine.start(input);
    setCapture(started(capture, channel));
    return snapshot();
  }

  async function stop() {
    if (!engine.running) return snapshot();
    setCapture({ ...capture, phase: "stopping", message: "Stopping…" });
    await engine.stop();
    return snapshot();
  }

  function saveHighlight() {
    if (!engine.running) throw new Error("Start a capture first.");
    if (capture.phase === "starting" || capture.phase === "buffering") throw new Error("The video buffer is still filling. Try again in a few seconds.");
    if (capture.phase === "exporting") throw new Error("A highlight is already being saved.");
    if (!engine.save()) throw new Error("The recorder is not accepting commands right now.");
    return true;
  }

  function openLink(url) {
    if (typeof url !== "string" || !HTTPS_ONLY.test(url)) throw new Error("Only secure web links can be opened.");
    return openExternal(url);
  }

  return {
    on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); },
    snapshot,
    start,
    stop,
    saveHighlight,
    markMissed: () => engine.markMissed(),
    clips: { list: () => clips.list(), open: (id) => clips.open(id), reveal: (id) => clips.reveal(id), rate: (id, rating) => clips.rate(id, rating) },
    license: {
      activate: (key) => license.activate(key),
      validate: () => license.validate(),
      deactivate: async () => { if (engine.running) throw new Error("Stop the capture before removing the license."); return license.deactivate(); },
      buy: () => { const url = license.state().checkoutUrl; if (!url) throw new Error("No purchase page is set up for this build."); return openLink(url); }
    },
    settings: { get: () => settings.get(), set: (changes) => settings.set(changes) },
    openClipFolder: () => openFolder(outputFolder),
    openLink,
    shutdown: () => engine.stop()
  };
}

module.exports = { createApp };
