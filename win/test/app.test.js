const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createApp } = require("../main/app.js");

function fakeEngine() {
  const e = new EventEmitter();
  e.running = false; e.sent = [];
  e.start = (input) => { e.running = true; e.started = input; return String(input).replace(/.*\//, "").toLowerCase(); };
  e.stop = async () => { e.running = false; e.emit("exit", { code: 0, unexpected: false }); };
  e.save = () => { e.sent.push("save"); return true; };
  e.markMissed = () => { e.sent.push("missed"); return true; };
  return e;
}
function build({ licenseState = { valid: true, message: "ok", checkoutUrl: "https://shop.example/buy" }, acknowledged = false } = {}) {
  const engine = fakeEngine();
  const calls = { ack: 0, external: [], folder: [] };
  let ack = acknowledged;
  const app = createApp({
    engine,
    license: { state: () => licenseState, activate: async (k) => ({ activated: k }), validate: async () => licenseState, deactivate: async () => ({ valid: false }) },
    settings: { get: () => ({ permissionAcknowledged: ack, launchAtLogin: false }), set: (c) => ({ ...c }), acknowledgePermission: () => { ack = true; calls.ack += 1; } },
    clips: { list: () => [], open: async () => true, reveal: () => true, rate: () => "" },
    openExternal: (u) => calls.external.push(u), openFolder: (p) => calls.folder.push(p), version: "0.1.0", outputFolder: "C:\\Videos\\Highlight Desk"
  });
  return { app, engine, calls };
}

test("starting needs a valid license, and says why when it is not", async () => {
  const { app, engine } = build({ licenseState: { valid: false, message: "The trial has ended. Enter a license key to keep capturing." } });
  await assert.rejects(() => app.start("abc", { acknowledge: true }), /trial has ended/);
  assert.equal(engine.running, false);
});

test("starting needs the permission acknowledgement the first time, and records it", async () => {
  const { app, engine, calls } = build();
  await assert.rejects(() => app.start("abc"), /permission to record/);
  assert.equal(engine.running, false);
  assert.equal(calls.ack, 0);
  const snap = await app.start("https://twitch.tv/Abc", { acknowledge: true });
  assert.equal(engine.running, true);
  assert.equal(calls.ack, 1);
  assert.equal(snap.capture.phase, "starting");
  assert.equal(snap.capture.channel, "abc");
  await app.stop();
  await app.start("abc");
  assert.equal(calls.ack, 1, "no second prompt once acknowledged");
});

test("a second start is refused while capturing", async () => {
  const { app } = build({ acknowledged: true });
  await app.start("abc");
  await assert.rejects(() => app.start("def"), /already running/);
});

test("engine events drive the status the window sees, and clip events say the library changed", async () => {
  const { app, engine } = build({ acknowledged: true });
  const seen = [], changed = [];
  app.on("capture", (c) => seen.push(c.phase));
  app.on("clips", () => changed.push(1));
  await app.start("abc");
  engine.emit("event", { type: "ready", channel: "abc" });
  engine.emit("event", { type: "status", recording: true, joined: true, mediaTime: 9 });
  engine.emit("event", { type: "clip-saved", path: "C:\\x.mp4" });
  // The window is told again when the clip count changes, so compare the phases in order, not the number of messages.
  assert.deepEqual(seen.filter((phase, i) => phase !== seen[i - 1]), ["starting", "buffering", "watching"]);
  assert.ok(seen.length >= 4, "a saved clip is also pushed to the window");
  assert.equal(changed.length, 1);
  assert.equal(app.snapshot().capture.clipsSaved, 1);
});

test("save highlight is refused until the buffer has filled, and while exporting", async () => {
  const { app, engine } = build({ acknowledged: true });
  assert.throws(() => app.saveHighlight(), /Start a capture first/);
  await app.start("abc");
  engine.emit("event", { type: "ready" });
  assert.throws(() => app.saveHighlight(), /buffer is still filling/);
  engine.emit("event", { type: "status", recording: true, joined: true, mediaTime: 10 });
  assert.equal(app.saveHighlight(), true);
  assert.deepEqual(engine.sent, ["save"]);
  engine.emit("event", { type: "status", exporting: true });
  assert.throws(() => app.saveHighlight(), /already being saved/);
});

test("an unexpected recorder exit becomes an error state with its message", async () => {
  const { app, engine } = build({ acknowledged: true });
  await app.start("abc");
  engine.running = false;
  engine.emit("exit", { code: 1, unexpected: true, detail: "Missing streamlink." });
  assert.equal(app.snapshot().capture.phase, "error");
  assert.equal(app.snapshot().capture.message, "Missing streamlink.");
});

test("stopping returns to idle", async () => {
  const { app } = build({ acknowledged: true });
  await app.start("abc");
  const snap = await app.stop();
  assert.equal(snap.capture.phase, "idle");
  assert.equal((await app.stop()).capture.phase, "idle", "stop when idle is harmless");
});

test("only https links open, and the purchase link comes from the build, not the window", () => {
  const { app, calls } = build();
  app.openLink("https://example.com/a?b=1&c=2");
  assert.throws(() => app.openLink("file:///C:/Windows/System32/calc.exe"), /secure web links/);
  assert.throws(() => app.openLink("http://insecure.example"), /secure web links/);
  assert.throws(() => app.openLink(undefined), /secure web links/);
  app.license.buy();
  assert.deepEqual(calls.external, ["https://example.com/a?b=1&c=2", "https://shop.example/buy"]);
  const none = build({ licenseState: { valid: true, message: "", checkoutUrl: "" } });
  assert.throws(() => none.app.license.buy(), /No purchase page/);
});

test("the license cannot be removed while a capture runs", async () => {
  const { app } = build({ acknowledged: true });
  await app.start("abc");
  await assert.rejects(() => app.license.deactivate(), /Stop the capture/);
  await app.stop();
  await app.license.deactivate();
});

test("the clip folder opens from the app's own setting, not a path the window sends", () => {
  const { app, calls } = build();
  app.openClipFolder();
  assert.deepEqual(calls.folder, ["C:\\Videos\\Highlight Desk"]);
});
