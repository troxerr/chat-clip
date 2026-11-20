const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Engine, channelFromInput } = require("../main/engine.js");

const fake = path.join(__dirname, "fake-engine.js");
const make = (mode = "normal", extra = {}) => new Engine({ script: fake, env: { ...process.env, FAKE_ENGINE: mode }, stopGraceMs: 1500, ...extra });
const once = (engine, name, match = () => true) => new Promise((resolve) => {
  const handler = (value) => { if (match(value)) { engine.off(name, handler); resolve(value); } };
  engine.on(name, handler);
});

test("channel input accepts a name or a Twitch URL and rejects the rest in plain words", () => {
  assert.equal(channelFromInput("  SomeStreamer "), "somestreamer");
  assert.equal(channelFromInput("https://www.twitch.tv/Some_Streamer"), "some_streamer");
  assert.throws(() => channelFromInput(""), /Twitch username/);
  assert.throws(() => channelFromInput("https://twitch.tv/videos/123"), /live channel URL/);
  assert.throws(() => channelFromInput("https://kick.com/abc"), /Twitch channels only/);
  assert.throws(() => channelFromInput("bad name!"), /Twitch username/);
});

test("it needs the script path", () => {
  assert.throws(() => new Engine({}), /background\.cjs/);
});

test("it starts the recorder, passes the protocol flags, and streams events", async () => {
  const engine = make("env");
  const ready = once(engine, "event", (e) => e.type === "ready");
  assert.equal(engine.start("https://twitch.tv/Abc", { EXTRA: "1" }), "abc");
  const event = await ready;
  assert.equal(event.channel, "abc");
  assert.deepEqual(event.env, { EVENTS: "1", COMMANDS: "1", RUN_AS_NODE: null, EXTRA: "1" });
  await engine.stop();
  assert.equal(engine.running, false);
});

test("run-as-node mode sets ELECTRON_RUN_AS_NODE for the child only", async () => {
  const engine = make("env", { runAsNode: true });
  const ready = once(engine, "event", (e) => e.type === "ready");
  engine.start("abc");
  assert.equal((await ready).env.RUN_AS_NODE, "1");
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
  await engine.stop();
});

test("a second start while running is refused", async () => {
  const engine = make();
  const ready = once(engine, "event", (e) => e.type === "ready");
  engine.start("abc");
  await ready;
  assert.throws(() => engine.start("def"), /already running/);
  await engine.stop();
});

test("save and missed commands reach the recorder and its reply comes back", async () => {
  const engine = make();
  await new Promise((resolve) => { engine.once("event", resolve); engine.start("abc"); });
  const saved = once(engine, "event", (e) => e.type === "clip-saved");
  assert.equal(engine.save(), true);
  assert.equal((await saved).path, "C:\\clips\\x.mp4");
  const missed = once(engine, "event", (e) => e.type === "missed-moment");
  assert.equal(engine.markMissed(), true);
  await missed;
  await engine.stop();
});

test("commands are refused, not thrown, when nothing is running", () => {
  const engine = make();
  assert.equal(engine.save(), false);
  assert.equal(engine.markMissed(), false);
});

test("a clean stop is expected and reports no detail", async () => {
  const engine = make();
  await new Promise((resolve) => { engine.once("event", resolve); engine.start("abc"); });
  const exit = once(engine, "exit");
  await engine.stop();
  const info = await exit;
  assert.equal(info.unexpected, false);
  assert.equal(info.code, 0);
});

test("a recorder that dies at startup is reported with its last error line", async () => {
  const engine = make("crash");
  const exit = once(engine, "exit");
  engine.start("abc");
  const info = await exit;
  assert.equal(info.unexpected, true);
  assert.match(info.detail, /Missing streamlink/);
  assert.equal(engine.running, false);
  assert.doesNotThrow(() => engine.start("abc") && engine.stop());
});

test("a recorder that ignores 'stop' is killed after the grace period", async () => {
  const engine = make("deaf", { stopGraceMs: 300 });
  await new Promise((resolve) => { engine.once("event", resolve); engine.start("abc"); });
  const t0 = Date.now();
  await engine.stop();
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(engine.running, false);
});

test("a script that cannot be started is reported and does not crash the app", async () => {
  const engine = new Engine({ script: fake, execPath: path.join(__dirname, "no-such-node.exe"), env: process.env });
  const exit = once(engine, "exit");
  engine.start("abc");
  const info = await exit;
  assert.equal(info.unexpected, true);
  assert.match(info.detail, /Could not start the recorder/);
});

test("non-JSON output lines are ignored", async () => {
  const engine = make();
  const events = [];
  engine.on("event", (e) => events.push(e.type));
  await new Promise((resolve) => { engine.once("event", resolve); engine.start("abc"); });
  await engine.stop();
  assert.ok(events.includes("ready"));
});
