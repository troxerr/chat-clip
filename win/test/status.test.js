const test = require("node:test");
const assert = require("node:assert/strict");
const { INITIAL, reduce, started, stopped } = require("../main/status.js");

const run = (events, from = started(INITIAL, "somechannel")) => events.reduce(reduce, from);

test("a new capture starts in 'starting' and keeps the session's clip count from resetting the UI", () => {
  const s = started({ ...INITIAL, clipsSaved: 4 }, "abc");
  assert.equal(s.phase, "starting");
  assert.equal(s.channel, "abc");
  assert.equal(s.clipsSaved, 4);
});

test("ready then early video is buffering; after a few seconds it is watching", () => {
  let s = run([{ type: "ready", channel: "abc" }]);
  assert.equal(s.phase, "buffering");
  s = reduce(s, { type: "status", recording: true, joined: true, mediaTime: 1 });
  assert.equal(s.phase, "buffering");
  s = reduce(s, { type: "status", recording: true, joined: true, mediaTime: 7.5 });
  assert.equal(s.phase, "watching");
  assert.match(s.message, /Watching chat/);
  assert.equal(s.mediaTime, 7.5);
});

test("recording without chat says automatic highlights are paused", () => {
  const s = run([{ type: "ready" }, { type: "status", recording: true, joined: false, mediaTime: 10 }]);
  assert.equal(s.phase, "watching");
  assert.equal(s.chatConnected, false);
  assert.match(s.message, /Waiting for chat/);
});

test("exporting shows while a clip is being made and returns to watching when it is saved", () => {
  let s = run([{ type: "ready" }, { type: "status", recording: true, joined: true, mediaTime: 20 }, { type: "status", exporting: true, target: "x.mp4" }]);
  assert.equal(s.phase, "exporting");
  s = reduce(s, { type: "clip-saved", path: "C:\\clips\\a-9x16.mp4" });
  assert.equal(s.phase, "watching");
  assert.equal(s.clipsSaved, 1);
  assert.equal(s.lastClipPath, "C:\\clips\\a-9x16.mp4");
});

test("a failed clip reports the reason and keeps recording", () => {
  const s = run([{ type: "ready" }, { type: "status", recording: true, joined: true, mediaTime: 20 }, { type: "status", exporting: true },
    { type: "clip-failed", error: "Not enough contiguous video for this highlight." }]);
  assert.equal(s.phase, "watching");
  assert.match(s.lastError, /Not enough contiguous video/);
});

test("a successful retry clears the previous manual save warning", () => {
  const s = run([
    { type: "ready" },
    { type: "status", recording: true, joined: true, mediaTime: 20 },
    { type: "error", message: "Highlight not ready yet." },
    { type: "status", exporting: true }
  ]);
  assert.equal(s.lastError, "Highlight not ready yet.");
  const saved = reduce(s, { type: "clip-saved", path: "manual-9x16.mp4" });
  assert.equal(saved.lastError, "");
  assert.equal(saved.phase, "watching");
  assert.equal(saved.lastClipPath, "manual-9x16.mp4");
});

test("a fatal event is an error state with the engine's message", () => {
  const s = run([{ type: "ready" }, { type: "fatal", message: "Missing streamlink." }]);
  assert.equal(s.phase, "error");
  assert.equal(s.message, "Missing streamlink.");
});

test("a recorder that drops out reads as buffering again, not as watching", () => {
  const s = run([{ type: "ready" }, { type: "status", recording: true, joined: true, mediaTime: 30 }, { type: "status", recording: false, joined: true }]);
  assert.equal(s.phase, "buffering");
});

test("stopping, then stopped, and an unexpected stop surfaces as an error", () => {
  let s = run([{ type: "ready" }, { type: "status", stopping: true, recording: false, joined: false }]);
  assert.equal(s.phase, "stopping");
  assert.equal(stopped(s).phase, "idle");
  const crashed = stopped(run([{ type: "ready" }]), { unexpected: true, detail: "Exited with code 3." });
  assert.equal(crashed.phase, "error");
  assert.equal(crashed.message, "Exited with code 3.");
});

test("unknown events and junk change nothing", () => {
  const s = started(INITIAL, "x");
  assert.equal(reduce(s, { type: "history-updated", items: [] }), s);
  assert.equal(reduce(s, null), s);
  assert.equal(reduce(s, { nope: 1 }), s);
});
