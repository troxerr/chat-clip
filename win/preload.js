"use strict";

// The only door between the window and the app. The window gets a small set of
// named calls; it never sees Node, the file system or Electron.

const { contextBridge, ipcRenderer } = require("electron");

const call = (name, ...args) => ipcRenderer.invoke("hd:call", name, ...args);
const EVENTS = new Set(["capture", "clips", "navigate", "notice", "update"]);

contextBridge.exposeInMainWorld("hd", {
  getState: () => call("getState"),
  start: (input, options) => call("start", input, { acknowledge: Boolean(options && options.acknowledge) }),
  stop: () => call("stop"),
  saveHighlight: () => call("saveHighlight"),
  markMissed: () => call("markMissed"),
  clips: {
    list: () => call("clips.list"),
    open: (id) => call("clips.open", String(id)),
    reveal: (id) => call("clips.reveal", String(id)),
    rate: (id, rating) => call("clips.rate", String(id), String(rating))
  },
  license: {
    activate: (key) => call("license.activate", String(key)),
    validate: () => call("license.validate"),
    deactivate: () => call("license.deactivate"),
    buy: () => call("license.buy")
  },
  settings: { set: (changes) => call("settings.set", { launchAtLogin: Boolean(changes && changes.launchAtLogin) }) },
  update: {
    state: () => call("update.state"),
    check: () => call("update.check"),
    install: () => call("update.install")
  },
  openClipFolder: () => call("openClipFolder"),
  openLink: (url) => call("openLink", String(url)),
  on: (name, fn) => {
    if (!EVENTS.has(name) || typeof fn !== "function") return () => {};
    const listener = (_event, eventName, value) => { if (eventName === name) fn(value); };
    ipcRenderer.on("hd:event", listener);
    return () => ipcRenderer.removeListener("hd:event", listener);
  }
});
