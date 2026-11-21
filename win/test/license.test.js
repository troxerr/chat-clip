const test = require("node:test");
const assert = require("node:assert/strict");
const { createLicenseManager, looksOffline } = require("../main/license.js");

const DAY = 86400000;
function harness({ build = { licenseRequired: true }, start = "2026-11-01T00:00:00.000Z", request, env = {} } = {}) {
  let now = new Date(start);
  const db = { config: {}, secrets: new Map() };
  const calls = [];
  const manager = createLicenseManager({
    readConfig: () => JSON.parse(JSON.stringify(db.config)),
    writeConfig: (config) => { db.config = JSON.parse(JSON.stringify(config)); },
    store: { get: (n) => db.secrets.get(n) || "", set: (n, v) => db.secrets.set(n, v), delete: (n) => db.secrets.delete(n), writable: () => true },
    request: async (action, options) => { calls.push({ action, options }); return request ? request(action, options) : { ok: true, valid: true, instanceId: "inst-1", customerEmail: "a@b.c", productName: "Highlight Desk" }; },
    now: () => now,
    build,
    env,
    deviceName: "TEST-PC"
  });
  return { manager, db, calls, advance: (ms) => { now = new Date(now.getTime() + ms); }, set: (iso) => { now = new Date(iso); } };
}

test("a development build is always unlocked and never writes a trial date", () => {
  const h = harness({ build: {} });
  const s = h.manager.state();
  assert.equal(s.valid, true);
  assert.equal(s.mode, "development");
  assert.equal(s.required, false);
  assert.deepEqual(h.db.config, {});
});

test("the trial starts on first run and counts down by whole days", () => {
  const h = harness();
  let s = h.manager.state();
  assert.equal(s.mode, "trial");
  assert.equal(s.daysLeft, 7);
  assert.equal(s.valid, true);
  assert.equal(h.db.config.license.trialStartedAt, "2026-11-01T00:00:00.000Z");
  h.advance(3 * DAY + 5 * 3600000);
  assert.equal(h.manager.state().daysLeft, 4);
  h.advance(3 * DAY);
  s = h.manager.state();
  assert.equal(s.daysLeft, 1);
  assert.match(s.message, /1 day left/);
  h.advance(DAY);
  s = h.manager.state();
  assert.equal(s.valid, false);
  assert.equal(s.mode, "expired");
  assert.match(s.message, /trial has ended/);
});

test("the trial length can come from the build or the environment", () => {
  assert.equal(harness({ build: { licenseRequired: true, trialDays: 14 } }).manager.state().daysLeft, 14);
  assert.equal(harness({ env: { HIGHLIGHT_DESK_TRIAL_DAYS: "2" } }).manager.state().daysLeft, 2);
  assert.equal(harness({ env: { HIGHLIGHT_DESK_TRIAL_DAYS: "0" } }).manager.state().valid, false);
});

test("a clock set back does not extend the trial past its length", () => {
  const h = harness();
  h.manager.state();
  h.advance(-30 * DAY);
  assert.equal(h.manager.state().daysLeft, 7);
});

test("activating stores the key in the secret store and the rest in the config", async () => {
  const h = harness();
  h.manager.state();
  h.advance(10 * DAY);
  const s = await h.manager.activate("  KEY-123 ");
  assert.equal(s.valid, true);
  assert.equal(s.mode, "licensed");
  assert.match(s.message, /Licensed to a@b\.c/);
  assert.equal(h.db.secrets.get("license.key"), "KEY-123");
  assert.equal(JSON.stringify(h.db.config).includes("KEY-123"), false, "the key is never written to the config file");
  assert.equal(h.db.config.license.instance, "inst-1");
  assert.equal(h.calls[0].action, "activate");
  assert.equal(h.calls[0].options.instanceName, "ChatClip (TEST-PC)");
});

test("activation failures reach the user and change nothing", async () => {
  const h = harness({ request: async () => { throw new Error("This license key has reached its activation limit."); } });
  await assert.rejects(() => h.manager.activate("KEY"), /activation limit/);
  assert.equal(h.db.secrets.size, 0);
  await assert.rejects(() => h.manager.activate("   "), /Enter your license key/);
  const odd = harness({ request: async () => ({ ok: true, valid: false }) });
  await assert.rejects(() => odd.manager.activate("KEY"), /could not be activated/);
});

test("a licensed copy stays valid offline for 14 days, then needs a check", async () => {
  const h = harness();
  h.manager.state();
  h.advance(10 * DAY);
  await h.manager.activate("KEY");
  h.advance(13 * DAY);
  assert.equal(h.manager.state().mode, "licensed");
  h.advance(2 * DAY);
  const s = h.manager.state();
  assert.equal(s.valid, false, "past the trial and past the grace period");
  assert.equal(s.mode, "expired");
  assert.equal(s.stale, true);
});

test("validating while offline keeps the grace period; a good check refreshes it", async () => {
  let offline = true;
  const h = harness({ request: async (action) => {
    if (action === "activate") return { ok: true, valid: true, instanceId: "i", customerEmail: "", productName: "" };
    if (offline) { const e = new TypeError("fetch failed"); throw e; }
    return { ok: true, valid: true };
  } });
  h.manager.state();
  h.advance(10 * DAY);
  await h.manager.activate("KEY");
  const stamp = h.db.config.license.lastValidatedAt;
  h.advance(5 * DAY);
  await h.manager.validate();
  assert.equal(h.db.config.license.lastValidatedAt, stamp, "offline: nothing changes");
  assert.equal(h.manager.state().valid, true);
  offline = false;
  const s = await h.manager.validate();
  assert.notEqual(h.db.config.license.lastValidatedAt, stamp);
  assert.equal(s.mode, "licensed");
});

test("a license the service rejects stops counting as validated", async () => {
  let reject = false;
  const h = harness({ request: async (action) => {
    if (reject && action === "validate") throw new Error("The license is not valid.");
    return { ok: true, valid: true, instanceId: "i", customerEmail: "", productName: "" };
  } });
  h.manager.state();
  h.advance(10 * DAY);
  await h.manager.activate("KEY");
  reject = true;
  const s = await h.manager.validate();
  assert.equal(s.valid, false);
  assert.equal(h.db.config.license.lastValidatedAt, undefined);
});

test("validate with no license does nothing and does not call the service", async () => {
  const h = harness();
  await h.manager.validate();
  assert.equal(h.calls.length, 0);
});

test("deactivating releases the activation and removes every trace of the key", async () => {
  const h = harness();
  h.manager.state();
  h.advance(10 * DAY);
  await h.manager.activate("KEY");
  const s = await h.manager.deactivate();
  assert.equal(s.mode, "expired");
  assert.equal(h.db.secrets.size, 0);
  assert.equal(h.db.config.license.instance, undefined);
  assert.ok(h.calls.some((c) => c.action === "deactivate" && c.options.instanceId === "inst-1"));
});

test("offline detection tells network trouble from a rejection", () => {
  assert.equal(looksOffline(new TypeError("fetch failed")), true);
  assert.equal(looksOffline(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })), true);
  assert.equal(looksOffline(new Error("License service failed (503).")), true);
  assert.equal(looksOffline(new Error("License service unavailable (502).")), true);
  assert.equal(looksOffline(new Error("Upstream says go away", { cause: 1 })), false);
  assert.equal(looksOffline(Object.assign(new Error("Server error from Polar"), { transient: true })), true);
  assert.equal(looksOffline(new Error("The license is not valid.")), false);
  assert.equal(looksOffline(new Error("This license key has expired.")), false);
});
