"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Exercise the actual capture sampler with a controlled clock/recorder. No
// Twitch connection, subprocess, config, Keychain or user output is touched.
function captureHarness(t, inputSource = "example") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-capture-monitor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.resolve(__dirname, "../background.cjs");
  const localRequire = createRequire(file);
  const records = [];
  const signals = {};
  const context = vm.createContext({ console, Buffer, URL, setInterval, clearInterval, setTimeout, clearTimeout,
    __records: records, __dirname: path.dirname(file),
    process: { argv: ["node", "background.cjs", inputSource], env: { CHATCLIP_OUTPUT: dir },
      on: (signal, fn) => { signals[signal] = fn; }, stdout: { on() {}, write() {} }, stderr: { write() {} } },
    require(name) {
      if (name === "./lib/kick-chat.js") return { ...localRequire(name), relaySettings: () => ({ url: "http://127.0.0.1:8765", token: "test" }) };
      if (name === "./lib/appconfig.js") return { readConfig: () => ({ config: {}, path: "test" }), reframeSettings: () => ({}), storageSettings: () => ({ mode: "local" }) };
      if (name === "./lib/storage/index.js") return { createStorageProvider: () => ({}), storageLabel: () => "Local" };
      if (name === "./lib/jobstore.js") return { createJobStore: () => ({ stateDir: dir }) };
      return localRequire(name);
    }
  });
  const raw = fs.readFileSync(file, "utf8");
  assert.match(raw, /\nstart\(\);\s*$/, "Harness must remove startup before executing the engine");
  const source = raw.replace(/\nstart\(\);\s*$/, "\nglobalThis.captureTick = tick;");
  vm.runInContext(source, context, { filename: file });
  vm.runInContext(`joined = true; encoder = {}; mediaTime = 100; lastFrameAt = Date.now();
    paceHistory = Array(12).fill(10); viewers = new Set(Array.from({length:40}, (_,i)=>i));
    reactors = new Set(Array.from({length:30}, (_,i)=>i)); messageCount = 50;
    monitor = { record: record => __records.push(JSON.parse(JSON.stringify(record))) };`, context);
  return { context, records, dir, signals, run: code => vm.runInContext(code, context) };
}

test("live sampler records high-reaction windows during an export without capturing", async t => {
  const h = captureHarness(t);
  h.run("exporting = {};");
  await h.context.captureTick();
  const window = h.records.find(r => r.kind === "window");
  assert.equal(window.suppression, "exporting");
  assert.equal(window.result.trigger, true);
  assert.equal(window.eligible, false);
  assert.equal(window.accepted, false);
  assert.equal(window.participants, 40);
  assert.equal(h.run("viewers.size"), 0);
});

test("Kick chat drives the actual capture sampler and keeps its own channel identity", async t => {
  const h = captureHarness(t, "https://kick.com/example");
  h.run(`viewers.clear(); reactors.clear(); messageCount = 0;`);
  const { normalizeKickMessage } = require("../lib/kick-chat.js");
  for (let i = 0; i < 40; i++) {
    const event = normalizeKickMessage({ message_id: `m-${i}`, created_at: new Date().toISOString(), content: "KEKW lol",
      sender: { user_id: i + 100 }, broadcaster: { user_id: 1, channel_slug: "example" } }, "example");
    h.run(`handleChatEvent(${JSON.stringify(event)});`);
  }
  await h.context.captureTick();
  assert.equal(h.run("pending.trigger"), "auto");
  assert.equal(h.run("channel"), "kick--example");
  assert.equal(h.run("streamSource.platform"), "kick");
  assert.match(h.run("output"), /kick[\\/]example$/);
});

test("Kick command clipping accepts moderators and ignores ordinary viewers", t => {
  const h = captureHarness(t, "kick:example");
  const { normalizeKickMessage } = require("../lib/kick-chat.js");
  const payload = { message_id: "viewer", created_at: new Date().toISOString(), content: "!clip",
    sender: { user_id: 100 }, broadcaster: { user_id: 1, channel_slug: "example" } };
  h.run(`handleChatEvent(${JSON.stringify(normalizeKickMessage(payload, "example"))});`);
  assert.equal(h.run("pending"), null);
  payload.message_id = "mod";
  payload.sender.identity = { badges: [{ type: "moderator" }] };
  h.run(`handleChatEvent(${JSON.stringify(normalizeKickMessage(payload, "example"))});`);
  assert.equal(h.run("pending.trigger"), "command");
});

test("a slow export cannot hold the chat sampler open", async t => {
  const h = captureHarness(t);
  h.run("pending = {}; maybeExport = async () => new Promise(() => {});");
  let timer;
  await Promise.race([h.context.captureTick(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Sampler blocked on export")), 100); })]).finally(() => clearTimeout(timer));
  assert.equal(h.records.find(r => r.kind === "window").suppression, "clip-pending");
});

test("accepted live clips carry the same window ID used for later ratings", async t => {
  const h = captureHarness(t);
  await h.context.captureTick();
  const window = h.records.find(r => r.kind === "window");
  assert.equal(window.accepted, true);
  assert.equal(h.run("pending.windowId"), window.id);
  assert.equal(h.run("pending.trigger"), "auto");
  assert.equal(h.records.filter(r => r.event === "clip-requested").length, 1);
});

test("cooldown and disconnected chat are logged without losing their reason", async t => {
  const h = captureHarness(t);
  h.run("lastAuto = Date.now();");
  await h.context.captureTick();
  assert.equal(h.records.find(r => r.kind === "window").suppression, "cooldown");
  assert.equal(h.records.find(r => r.kind === "window").accepted, false);
  h.run("joined = false;");
  await h.context.captureTick();
  assert.equal(h.records.filter(r => r.kind === "window").at(-1).suppression, "chat-disconnected");
});
