const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../dist/config.js");

test("defaults and profiles are sane", () => {
  assert.equal(config.DEFAULTS.sampleMs, 5000);
  assert.equal(config.DEFAULTS.postRollSec, 6);
  const desktop = config.settingsFor("desktop");
  assert.equal(desktop.postRollSec, 15);
  assert.equal(desktop.historyLimit, 180);
  assert.equal(desktop.autoCooldownMs, 300000, "desktop auto clips are at least 5 minutes apart");
  const web = config.settingsFor("web");
  assert.equal(web.postRollSec, 6);
  assert.equal(web.historyLimit, 60);
  assert.equal(web.autoCooldownMs, 90000, "web keeps the 90 s default");
  assert.equal(config.DEFAULTS.autoCooldownMs, 90000);
});

test("mergeSettings ignores unknown keys and clamps numbers", () => {
  const merged = config.mergeSettings({ sensitivity: 99, minParticipants: 0, nope: 1, clipOnRaid: false });
  assert.equal(merged.sensitivity, 3);
  assert.equal(merged.minParticipants, 2);
  assert.equal(merged.clipOnRaid, false);
  assert.equal("nope" in merged, false);
});

test("mergeSettings ignores values of the wrong type", () => {
  const merged = config.mergeSettings({ sensitivity: "high", clipOnCommand: "yes" });
  assert.equal(merged.sensitivity, config.DEFAULTS.sensitivity);
  assert.equal(merged.clipOnCommand, config.DEFAULTS.clipOnCommand);
});

test("loadSettings and saveSettings round-trip through a storage shim", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value)
  };

  assert.equal(config.saveSettings({ ...config.DEFAULTS, sensitivity: 1.5 }, storage), true);
  const loaded = config.loadSettings(storage);
  assert.equal(loaded.sensitivity, 1.5);

  storage.setItem("chatclip.settings", "{bad json");
  assert.deepEqual(config.loadSettings(storage), {});
});

test("loadSettings tolerates missing or hostile storage", () => {
  assert.deepEqual(config.loadSettings(null), {});
  assert.deepEqual(config.loadSettings({ getItem() { throw new Error("blocked"); } }), {});
  assert.equal(config.saveSettings({}, { setItem() { throw new Error("full"); } }), false);
});
