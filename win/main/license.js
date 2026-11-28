"use strict";

// Trial and license state for the Windows app. Port of the Mac app's rules:
//   - a development build (licenseRequired false) is always unlocked;
//   - otherwise a trial starts on first run (7 days by default);
//   - a license is a key plus an activation instance, validated by the provider; it counts as fresh for 14 days after the last good validation
//     (offline grace) and is re-checked in the background when stale.
// The key is a secret and lives in the credential store; dates and the instance
// id are not secret and live in the config's "license" section.
// Everything with side effects (clock, config, store, network) is injected.

const DAY_MS = 86400000;
const GRACE_DAYS = 14;

function looksOffline(error) {
  if (error && error.transient === true) return true;
  const text = `${error && error.name} ${error && error.message}`;
  return /TypeError|TimeoutError|AbortError|fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|timed out|License service (failed|unavailable) \((5\d\d|429)\)/i.test(text);
}

function createLicenseManager({
  readConfig,       // () => config object
  writeConfig,      // (config) => void
  store,            // { get(name), set(name, value), prepareSet(name, value), delete(name) }
  request,          // (action, options) => result, as tools/license.js licenseRequest
  now = () => new Date(),
  build = {},       // { licenseRequired, trialDays, productId, checkoutUrl, priceLabel }
  env = process.env,
  deviceName = "Windows PC"
}) {
  const KEY = "license.key";
  const required = build.licenseRequired === true;
  // Selects the licensing provider and API host (e.g. Polar sandbox) from the build config.
  const providerOptions = {};
  if (build.provider) providerOptions.provider = String(build.provider);
  if (build.apiBase) providerOptions.apiBase = String(build.apiBase);
  const trialDays = (() => {
    const fromEnv = Number(env.CLIPSPIKE_TRIAL_DAYS);
    if (Number.isFinite(fromEnv) && env.CLIPSPIKE_TRIAL_DAYS !== undefined && env.CLIPSPIKE_TRIAL_DAYS !== "") return Math.max(0, Math.floor(fromEnv));
    return Number(build.trialDays) > 0 ? Math.floor(Number(build.trialDays)) : 7;
  })();

  const section = () => {
    const config = readConfig() || {};
    return config.license && typeof config.license === "object" ? config.license : {};
  };
  const save = (changes) => {
    const config = readConfig() || {};
    const next = { ...(config.license && typeof config.license === "object" ? config.license : {}), ...changes };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    writeConfig({ ...config, license: next });
  };
  const parse = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : null; };

  function ensureTrialStarted() {
    if (!required) return;
    if (parse(section().trialStartedAt) === null) save({ trialStartedAt: now().toISOString() });
  }

  function daysLeft() {
    const started = parse(section().trialStartedAt);
    if (started === null) return 0;
    const used = Math.floor(Math.max(0, now().getTime() - started) / DAY_MS);
    return Math.max(0, trialDays - used);
  }

  function state() {
    if (!required) {
      return { required: false, valid: true, mode: "development", trialDays, daysLeft: trialDays, hasKey: false, stale: false,
        message: "Development build. Every feature is unlocked.", email: "", productName: "", checkoutUrl: build.checkoutUrl || "",
        priceLabel: String(build.priceLabel || "").trim() };
    }
    ensureTrialStarted();
    const s = section();
    const key = store.get(KEY);
    const instance = typeof s.instance === "string" ? s.instance : "";
    const left = daysLeft();
    // A saved key that cannot be decrypted right now (a slow first PowerShell start, antivirus) is not
    // "no key": showing the trial and the Activate box would invite a second activation.
    const keyUnreadable = !key && Boolean(instance) && typeof store.has === "function" && store.has(KEY);
    const hasKey = Boolean((key || keyUnreadable) && instance);
    const lastOk = parse(s.lastValidatedAt);
    const age = lastOk === null ? Infinity : now().getTime() - lastOk;
    const fresh = age >= -300000 && age <= GRACE_DAYS * DAY_MS;
    let valid, mode, message;
    if (hasKey) {
      valid = fresh || left > 0;
      mode = fresh ? "licensed" : (left > 0 ? "licensed-unverified" : "expired");
      message = keyUnreadable ? `Licensed${s.email ? ` to ${s.email}` : ""}. The saved license key could not be read just now; ClipSpike will try again.`
        : fresh ? `Licensed${s.email ? ` to ${s.email}` : ""}.`
        : left > 0 ? "Licensed. The license could not be checked recently; it will be checked again when you are online."
        : "The license could not be checked for over 14 days. Connect to the internet to keep using the app.";
    } else {
      valid = left > 0;
      mode = left > 0 ? "trial" : "expired";
      message = left > 0 ? `Trial: ${left} day${left === 1 ? "" : "s"} left.` : "The trial has ended. Enter a license key to keep capturing.";
    }
    return { required: true, valid, mode, trialDays, daysLeft: left, hasKey, keyUnreadable, stale: hasKey && !fresh,
      message: hasKey && validationMessage && !keyUnreadable ? validationMessage : message, email: s.email || "", productName: s.productName || "", checkoutUrl: build.checkoutUrl || "",
      priceLabel: String(build.priceLabel || "").trim() };
  }

  let licensePending = false;
  let validationMessage = "";
  function beginLicenseAction() {
    if (licensePending) throw new Error("A license action is already in progress. Try again shortly.");
    licensePending = true;
  }
  async function activate(rawKey) {
    const licenseKey = String(rawKey || "").trim();
    if (!licenseKey) throw new Error("Enter your license key.");
    beginLicenseAction();
    try {
      const previousKey = store.get(KEY);
      const previousInstance = section().instance;
      const commitKey = store.prepareSet(KEY, licenseKey);
      const options = { licenseKey, productId: build.productId || "", ...providerOptions };
      const result = await request("activate", { ...options, instanceName: `ClipSpike (${deviceName})` });
      if (!result || !result.valid || !result.instanceId) throw new Error("That license key could not be activated.");
      let keySaved = false;
      try {
        commitKey();
        keySaved = true;
        save({ instance: result.instanceId, email: result.customerEmail || "", productName: result.productName || "", lastValidatedAt: now().toISOString() });
      } catch (error) {
        if (keySaved && previousKey !== licenseKey) {
          try {
            if (previousKey) store.set(KEY, previousKey);
            else store.delete(KEY);
          } catch {}
        }
        if (result.instanceId !== previousInstance) {
          try { await request("deactivate", { ...options, instanceId: result.instanceId }); } catch {}
        }
        throw error;
      }
      validationMessage = "";
      return state();
    } finally {
      licensePending = false;
    }
  }

  // Re-checks the license. Returns the new state. Never throws for network
  // trouble (the grace period covers it); a license the service says is bad
  // stops counting as validated.
  async function validate() {
    beginLicenseAction();
    try {
      const key = store.get(KEY);
      const instance = section().instance;
      if (!key || !instance) return state();
      let result;
      try {
        result = await request("validate", { licenseKey: key, instanceId: instance, productId: build.productId || "", ...providerOptions });
      } catch (error) {
        if (looksOffline(error)) {
          validationMessage = "Could not reach the license service. Try checking again when connected.";
          return state();
        }
        validationMessage = error.message || "The license service rejected this activation.";
      }
      if (result?.valid) {
        save({ lastValidatedAt: now().toISOString() });
        validationMessage = "";
      } else {
        save({ lastValidatedAt: undefined });
        if (result) validationMessage = result.status === "expired" ? "This license has expired." : "This license is not active.";
      }
      return state();
    } finally {
      licensePending = false;
    }
  }

  async function deactivate() {
    beginLicenseAction();
    try {
      const key = store.get(KEY);
      const instance = section().instance;
      if (!key && instance && typeof store.has === "function" && store.has(KEY)) {
        throw new Error("The saved license key could not be read, so this activation cannot be released yet. Try again in a moment.");
      }
      if (key && instance) await request("deactivate", { licenseKey: key, instanceId: instance, productId: build.productId || "", ...providerOptions });
      store.delete(KEY);
      save({ instance: undefined, email: undefined, productName: undefined, lastValidatedAt: undefined });
      validationMessage = "";
      return state();
    } finally {
      licensePending = false;
    }
  }

  return { state, activate, validate, deactivate, ensureTrialStarted, GRACE_DAYS };
}

module.exports = { createLicenseManager, looksOffline, GRACE_DAYS };
