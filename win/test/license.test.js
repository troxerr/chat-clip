const test = require("node:test");
const assert = require("node:assert/strict");
const { createLicenseManager, looksOffline } = require("../main/license.js");

const DAY = 86400000;
function harness({ build = { licenseRequired: true }, start = "2026-11-01T00:00:00.000Z", request, env = {}, prepareSet, writeConfig } = {}) {
  let now = new Date(start);
  const db = { config: {}, secrets: new Map(), unreadable: new Set() };
  const calls = [];
  const manager = createLicenseManager({
    readConfig: () => JSON.parse(JSON.stringify(db.config)),
    writeConfig: (config) => {
      if (writeConfig) writeConfig(config);
      db.config = JSON.parse(JSON.stringify(config));
    },
    store: {
      get: (n) => (db.unreadable.has(n) ? "" : db.secrets.get(n) || ""),
      has: (n) => db.secrets.has(n),
      set: (n, v) => db.secrets.set(n, v),
      prepareSet: prepareSet || ((n, v) => () => db.secrets.set(n, v)),
      delete: (n) => db.secrets.delete(n)
    },
    request: async (action, options) => { calls.push({ action, options }); return request ? request(action, options) : { ok: true, valid: true, instanceId: "inst-1", customerEmail: "a@b.c", productName: "ClipSpike" }; },
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

test("the purchase price and checkout come from the build config", () => {
  const s = harness({ build: { licenseRequired: true, priceLabel: " $39 ", checkoutUrl: "https://buy.polar.sh/x" } }).manager.state();
  assert.equal(s.priceLabel, "$39");
  assert.equal(s.checkoutUrl, "https://buy.polar.sh/x");
});

test("the trial length can come from the build or the environment", () => {
  assert.equal(harness({ build: { licenseRequired: true, trialDays: 14 } }).manager.state().daysLeft, 14);
  assert.equal(harness({ env: { CLIPSPIKE_TRIAL_DAYS: "2" } }).manager.state().daysLeft, 2);
  assert.equal(harness({ env: { CLIPSPIKE_TRIAL_DAYS: "0" } }).manager.state().valid, false);
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
  assert.equal(h.calls[0].options.instanceName, "ClipSpike (TEST-PC)");
});

test("activation failures reach the user and change nothing", async () => {
  const h = harness({ request: async () => { throw new Error("This license key has reached its activation limit."); } });
  await assert.rejects(() => h.manager.activate("KEY"), /activation limit/);
  assert.equal(h.db.secrets.size, 0);
  await assert.rejects(() => h.manager.activate("   "), /Enter your license key/);
  const odd = harness({ request: async () => ({ ok: true, valid: false }) });
  await assert.rejects(() => odd.manager.activate("KEY"), /could not be activated/);
});

test("a credential encryption timeout leaves the remote activation slot untouched", async () => {
  const h = harness({ prepareSet: () => { throw new Error("PowerShell ETIMEDOUT"); } });
  await assert.rejects(() => h.manager.activate("KEY"), /PowerShell ETIMEDOUT/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.db.secrets.size, 0);
});

test("a failed credential commit releases the newly allocated activation", async () => {
  const h = harness({
    build: { licenseRequired: true, provider: "polar", apiBase: "https://sandbox-api.polar.sh", productId: "org" },
    prepareSet: () => () => { throw new Error("The credential store could not be written."); }
  });
  await assert.rejects(() => h.manager.activate("KEY"), /credential store could not be written/);
  assert.deepEqual(h.calls.map(({ action }) => action), ["activate", "deactivate"]);
  assert.deepEqual(h.calls[1].options, {
    licenseKey: "KEY", productId: "org", provider: "polar", apiBase: "https://sandbox-api.polar.sh", instanceId: "inst-1"
  });
  assert.equal(h.manager.state().mode, "trial");
});

test("a settings write failure preserves the previous license and releases the new slot", async () => {
  const h = harness({ writeConfig: () => { throw new Error("Settings write failed."); } });
  h.db.config.license = { instance: "previous", trialStartedAt: "2026-11-01T00:00:00.000Z" };
  h.db.secrets.set("license.key", "PREVIOUS-KEY");
  await assert.rejects(() => h.manager.activate("NEXT-KEY"), /Settings write failed/);
  assert.equal(h.db.secrets.get("license.key"), "PREVIOUS-KEY");
  assert.equal(h.db.config.license.instance, "previous");
  assert.equal(h.calls[1].options.instanceId, "inst-1");
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

test("the build config's provider and API base reach every license request", async () => {
  const h = harness({ build: { licenseRequired: true, provider: "polar", apiBase: "https://sandbox-api.polar.sh", productId: "org:benefit" } });
  await h.manager.activate("KEY");
  assert.equal(h.calls[0].options.provider, "polar");
  assert.equal(h.calls[0].options.apiBase, "https://sandbox-api.polar.sh");
  assert.equal(h.calls[0].options.productId, "org:benefit");
});

async function licensed(h) {
  h.manager.state();
  await h.manager.activate("KEY-123");
  h.db.config.license.email = "owner@example.com";
  return h;
}

test("a saved key that cannot be read right now is not shown as a trial, and does not invite re-activation", async () => {
  const h = await licensed(harness());
  h.advance(2 * DAY);
  h.db.unreadable.add("license.key");
  const s = h.manager.state();
  assert.equal(s.hasKey, true, "still a licensed install, so no Activate box");
  assert.equal(s.keyUnreadable, true);
  assert.equal(s.valid, true);
  assert.notEqual(s.mode, "trial");
  assert.match(s.message, /^Licensed to owner@example\.com\. The saved license key could not be read just now/);
  h.db.unreadable.clear();
  const ok = h.manager.state();
  assert.equal(ok.keyUnreadable, false);
  assert.equal(ok.mode, "licensed");
  assert.equal(ok.message, "Licensed to owner@example.com.");
});

test("an unreadable key does not extend a lapsed license: it follows the same expiry rules", async () => {
  const h = await licensed(harness({ build: { licenseRequired: true, trialDays: 7 } }));
  h.advance(30 * DAY);
  h.db.unreadable.add("license.key");
  const s = h.manager.state();
  assert.equal(s.hasKey, true);
  assert.equal(s.valid, false, "past both the trial and the 14-day grace");
});

test("no key and no instance is still an ordinary trial", () => {
  const h = harness();
  const s = h.manager.state();
  assert.equal(s.mode, "trial");
  assert.equal(s.hasKey, false);
  assert.equal(s.keyUnreadable, false);
});

test("an activation whose key cannot be read is never forgotten without being released", async () => {
  const h = await licensed(harness());
  h.db.unreadable.add("license.key");
  const before = h.calls.length;
  await assert.rejects(() => h.manager.deactivate(), /could not be read, so this activation cannot be released yet/);
  assert.equal(h.calls.length, before, "no remote call was made");
  assert.equal(h.db.secrets.has("license.key"), true, "the stored key is still there");
  assert.ok(h.db.config.license.instance, "the instance record is still there");
  h.db.unreadable.clear();
  await h.manager.deactivate();
  assert.equal(h.calls[h.calls.length - 1].action, "deactivate");
  assert.equal(h.db.secrets.has("license.key"), false);
});

test("validating while the key is unreadable changes nothing and does not call the service", async () => {
  const h = await licensed(harness());
  const validatedAt = h.db.config.license.lastValidatedAt;
  h.db.unreadable.add("license.key");
  const before = h.calls.length;
  const s = await h.manager.validate();
  assert.equal(h.calls.length, before);
  assert.equal(h.db.config.license.lastValidatedAt, validatedAt);
  assert.equal(s.keyUnreadable, true);
});
