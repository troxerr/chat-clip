"use strict";

// Turns the engine's event stream into one small, plain description of what the
// recorder is doing, for the window. Pure: no I/O, no timers.

const INITIAL = Object.freeze({
  phase: "idle",          // idle | starting | buffering | watching | exporting | stopping | error
  message: "Not recording.",
  channel: "",
  mediaTime: 0,
  chatConnected: false,
  clipsSaved: 0,
  lastClipPath: "",
  lastError: ""
});

const BUFFER_SECONDS = 3;

function describe(next) {
  if (next.phase === "starting") return next.lastError && /Restarting/.test(next.lastError) ? next.lastError : "Starting the recorder…";
  if (next.phase === "stopping") return "Stopping…";
  if (next.phase === "exporting") return "Saving a highlight…";
  if (next.phase === "buffering") return "Filling the video buffer. A highlight can be saved in a few seconds.";
  if (next.phase === "watching") {
    return next.chatConnected
      ? "Watching chat and recording. Highlights are saved automatically."
      : "Recording. Waiting for chat to connect, so automatic highlights are paused. You can still save one by hand.";
  }
  if (next.phase === "error") return next.lastError || "The recorder stopped because of an error.";
  return "Not recording.";
}

function reduce(state, event) {
  if (!event || typeof event.type !== "string") return state;
  const next = { ...state };
  switch (event.type) {
    case "ready":
      next.phase = "buffering";
      next.channel = event.channel || next.channel;
      next.lastError = "";
      break;
    case "status": {
      if (event.stopping) { next.phase = "stopping"; break; }
      if (event.exporting === true) { next.phase = "exporting"; break; }
      if (typeof event.mediaTime === "number") next.mediaTime = event.mediaTime;
      if (typeof event.joined === "boolean") next.chatConnected = event.joined;
      if (event.recording === true) {
        if (next.phase === "exporting" || next.phase === "starting" || next.phase === "buffering" || next.phase === "watching") {
          next.phase = next.mediaTime >= BUFFER_SECONDS ? "watching" : "buffering";
        }
      } else if (event.recording === false && next.phase !== "stopping") {
        // The recorder reconnects on its own; say so instead of claiming it is watching.
        if (next.phase === "watching" || next.phase === "buffering") next.phase = "buffering";
      }
      break;
    }
    case "clip-saved":
      next.clipsSaved += 1;
      next.lastClipPath = event.path || next.lastClipPath;
      if (next.phase === "exporting") next.phase = "watching";
      break;
    case "clip-failed":
      next.lastError = event.error || "A highlight could not be saved.";
      if (next.phase === "exporting") next.phase = "watching";
      break;
    case "recorder-restarting":
      next.phase = "starting";
      next.lastError = event.message || next.lastError;
      break;
    case "error":
      next.lastError = event.message || next.lastError;
      break;
    case "fatal":
      next.phase = "error";
      next.lastError = event.message || "The recorder stopped because of an error.";
      break;
    default:
      return state;
  }
  next.message = describe(next);
  return next;
}

function started(state, channel) {
  return { ...INITIAL, phase: "starting", channel, message: describe({ ...INITIAL, phase: "starting" }), clipsSaved: state.clipsSaved };
}

function stopped(state, { unexpected = false, detail = "" } = {}) {
  if (unexpected || state.phase === "error") {
    const lastError = detail || state.lastError || "The recorder stopped unexpectedly.";
    return { ...state, phase: "error", lastError, message: lastError };
  }
  return { ...state, phase: "idle", mediaTime: 0, chatConnected: false, message: describe({ ...state, phase: "idle" }) };
}

module.exports = { INITIAL, BUFFER_SECONDS, reduce, started, stopped };
