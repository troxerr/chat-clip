const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startAutoUpdate } = require("../main/updater.js");

function setup(over = {}) {
  const au = Object.assign(new EventEmitter(), { checks: 0, checkForUpdates() { this.checks++; return Promise.resolve(); } });
  const logs = [];
  const result = startAutoUpdate({ app: { isPackaged: true }, autoUpdater: au, resourcesPath: "r", env: {}, log: (m) => logs.push(m), exists: () => true, ...over });
  return { au, logs, result };
}

test("checks for updates when packaged with a feed", async () => {
  const { au, result } = setup();
  await Promise.resolve();
  assert.equal(result.enabled, true);
  assert.equal(au.checks, 1);
  assert.equal(au.autoInstallOnAppQuit, true);
});

test("stays off without a feed, unpackaged, portable, or in smoke runs", () => {
  for (const over of [{ exists: () => false }, { app: { isPackaged: false } }, { env: { CLIPSPIKE_SMOKE: "x" } }, { env: { PORTABLE_EXECUTABLE_FILE: "C:\\t\\ClipSpike.exe" } }]) {
    const { au, result } = setup(over);
    assert.equal(result.enabled, false);
    assert.equal(au.checks, 0);
  }
});

test("a failing check is logged, not thrown", async () => {
  const { au, logs } = setup();
  au.checkForUpdates = () => Promise.reject(new Error("offline"));
  await Promise.resolve();
  au.emit("error", new Error("boom"));
  assert.match(logs.join("\n"), /boom/);
});

test("tracks the update through checking, downloading and ready, and tells listeners", async () => {
  const { au, result } = setup();
  const seen = [];
  result.onChange((s) => seen.push(s.status));
  assert.equal(result.getState().status, "idle");
  au.emit("checking-for-update");
  au.emit("update-available", { version: "0.1.1" });
  au.emit("download-progress", { percent: 41.6 });
  assert.deepEqual({ ...result.getState() }, { status: "downloading", version: "0.1.1", percent: 42, error: null });
  au.emit("update-downloaded", { version: "0.1.1" });
  assert.deepEqual({ ...result.getState() }, { status: "ready", version: "0.1.1", percent: 100, error: null });
  assert.deepEqual(seen, ["checking", "downloading", "downloading", "ready"]);
});

test("reports up to date, and an error that a later check clears", async () => {
  const { au, result } = setup();
  au.emit("update-not-available");
  assert.equal(result.getState().status, "up-to-date");
  au.emit("error", new Error("offline"));
  assert.equal(result.getState().status, "error");
  assert.equal(result.getState().error, "offline");
  au.emit("checking-for-update");
  assert.equal(result.getState().error, null);
});

test("a rejected check shows as an error state, once", async () => {
  const { au, result, logs } = setup();
  au.checkForUpdates = () => Promise.reject(new Error("dns"));
  const state = await result.check();
  assert.equal(state.status, "error");
  assert.equal(state.error, "dns");
  assert.equal(logs.filter((l) => /dns/.test(l)).length, 1);
});

test("check does nothing while a check or download is running, or once an update is ready", async () => {
  const { au, result } = setup();
  await Promise.resolve();
  const before = au.checks;
  for (const status of ["checking", "update-available", "update-downloaded"]) {
    au.emit(status === "checking" ? "checking-for-update" : status, { version: "0.1.1" });
    await result.check();
  }
  assert.equal(au.checks, before);
  au.emit("update-not-available");
  await result.check();
  assert.equal(au.checks, before + 1);
});

test("install restarts into the downloaded version only when one is ready", () => {
  const { au, result } = setup();
  au.quits = [];
  au.quitAndInstall = (...args) => au.quits.push(args);
  assert.equal(result.install(), false);
  assert.equal(au.quits.length, 0);
  au.emit("update-downloaded", { version: "0.1.1" });
  assert.equal(result.install(), true);
  assert.deepEqual(au.quits, [[true, true]], "silent install, then reopen the app");
});

test("when updating is off the actions are safe no-ops with a disabled state", async () => {
  const { result } = setup({ exists: () => false });
  assert.equal(result.getState().status, "disabled");
  assert.equal(result.install(), false);
  assert.equal((await result.check()).status, "disabled");
  assert.equal(typeof result.onChange(() => {}), "function");
});

test("each update step is recorded by name, and failures carry the error for categorising", async () => {
  const events = [];
  const { au, result } = setup({ record: (event, error) => events.push(error === undefined ? event : [event, String(error.message || error)]) });
  au.emit("checking-for-update");
  au.emit("update-not-available");
  au.emit("update-available", { version: "0.1.3" });
  au.emit("update-downloaded", { version: "0.1.3" });
  au.quitAndInstall = () => {};
  result.install();
  au.emit("error", new Error("sha512 checksum mismatch"));
  assert.deepEqual(events, ["update.check", "update.not_available", "update.available", "update.downloaded", "update.install", ["update.error", "sha512 checksum mismatch"]]);
});

test("a rejected check is recorded once, not once per path", async () => {
  const events = [];
  const { au, result } = setup({ record: (event) => events.push(event) });
  au.checkForUpdates = () => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"));
  await result.check();
  assert.equal(events.filter((e) => e === "update.error").length, 1);
});
