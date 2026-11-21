"use strict";

// Development only (not packaged): a fake window.hd so the window can be opened
// in a normal browser and screenshotted. Scenes are chosen with ?scene=<name>.

(function () {
  const params = new URLSearchParams(location.search);
  const scene = params.get("scene") || "idle";
  const listeners = {};
  const base = { phase: "idle", message: "Not recording.", channel: "", mediaTime: 0, chatConnected: false, clipsSaved: 0, lastClipPath: "", lastError: "" };
  const capture = {
    idle: base,
    watching: { ...base, phase: "watching", channel: "somestreamer", mediaTime: 754, chatConnected: true, clipsSaved: 3, message: "Watching chat and recording. Highlights are saved automatically." },
    exporting: { ...base, phase: "exporting", channel: "somestreamer", mediaTime: 760, chatConnected: true, clipsSaved: 3, message: "Saving a highlight…" },
    buffering: { ...base, phase: "buffering", channel: "somestreamer", mediaTime: 2, message: "Filling the video buffer. A highlight can be saved in a few seconds." },
    error: { ...base, phase: "error", channel: "somestreamer", lastError: "Missing streamlink. Install it with: winget install Streamlink.Streamlink", message: "Missing streamlink. Install it with: winget install Streamlink.Streamlink" }
  }[["watching", "exporting", "buffering", "error"].includes(scene) ? scene : "idle"];
  const license = {
    development: { required: false, valid: true, mode: "development", message: "Development build. Every feature is unlocked.", hasKey: false, checkoutUrl: "" },
    trial: { required: true, valid: true, mode: "trial", daysLeft: 5, message: "Trial: 5 days left.", hasKey: false, checkoutUrl: "https://shop.example/buy" },
    licensed: { required: true, valid: true, mode: "licensed", message: "Licensed to streamer@example.com.", hasKey: true, checkoutUrl: "https://shop.example/buy" },
    expired: { required: true, valid: false, mode: "expired", message: "The trial has ended. Enter a license key to keep capturing.", hasKey: false, checkoutUrl: "https://shop.example/buy" }
  }[params.get("license") || "development"];
  const clips = params.has("empty") ? [] : [
    { id: "1", channel: "somestreamer", createdAt: "2026-11-18T21:14:00Z", reason: "Chat spike: 82 chatters", available: true, rating: "up" },
    { id: "2", channel: "somestreamer", createdAt: "2026-11-18T20:41:00Z", reason: "Manual highlight", available: true, rating: "" },
    { id: "3", channel: "otherchannel", createdAt: "2026-11-17T19:02:00Z", reason: "Raid", available: false, rating: "down" },
    { id: "4", channel: "somestreamer", createdAt: "2026-11-17T18:30:00Z", reason: "Chat spike: 47 chatters", available: true, rating: "" }
  ];
  const state = { capture, license, settings: { launchAtLogin: false, permissionAcknowledged: params.has("ack"), outputFolder: "C:\\Users\\streamer\\Videos\\ChatClip" }, version: "0.1.0", versions: { electron: "45.3.4", node: "24.1.0" } };
  const fire = (name, value) => (listeners[name] || []).forEach((fn) => fn(value));
  window.__hdStub = { state, fire };
  window.hd = {
    getState: async () => structuredClone(state),
    start: async (input, opts) => {
      if (!state.settings.permissionAcknowledged && !(opts && opts.acknowledge)) throw new Error("Confirm that you have permission to record this channel.");
      state.settings.permissionAcknowledged = true;
      state.capture = { ...base, phase: "starting", channel: input, message: "Starting the recorder…" };
      return structuredClone(state);
    },
    stop: async () => { state.capture = base; return structuredClone(state); },
    saveHighlight: async () => true,
    markMissed: async () => true,
    clips: { list: async () => structuredClone(clips), open: async () => true, reveal: async () => true, rate: async (id, r) => { const c = clips.find((x) => x.id === id); c.rating = c.rating === r ? "" : r; return c.rating; } },
    license: { activate: async () => { throw new Error("That license key could not be activated."); }, validate: async () => structuredClone(state.license), deactivate: async () => structuredClone(state.license), buy: async () => true },
    settings: { set: async (c) => { Object.assign(state.settings, c); return structuredClone(state.settings); } },
    openClipFolder: async () => true,
    openLink: async () => true,
    on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => {}; }
  };
})();
