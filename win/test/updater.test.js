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
