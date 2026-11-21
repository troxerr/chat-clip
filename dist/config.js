(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HDConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    sampleMs: 5000,
    warmupWindows: 12,
    historyLimit: 60,
    recentWindows: 24,
    minParticipants: 4,
    minReactionShare: 0.35,
    minReactions: 2,
    sensitivity: 1,
    autoCooldownMs: 90000,
    commandCooldownMs: 10000,
    preRollSec: 15,
    postRollSec: 6,
    bufferSlotMs: 10000,
    bufferSlots: 3,
    minBufferMs: 8000,
    clipOnCommand: true,
    clipOnRaid: true
  });

  const PROFILES = Object.freeze({
    web: Object.freeze({}),
    // Desktop clips are posted as shorts, so near-duplicates within 5 minutes hurt.
    desktop: Object.freeze({ historyLimit: 180, postRollSec: 15, autoCooldownMs: 300000 })
  });

  const BOUNDS = Object.freeze({
    sampleMs: [1000, 30000],
    warmupWindows: [3, 120],
    historyLimit: [12, 600],
    recentWindows: [3, 120],
    minParticipants: [2, 100],
    minReactionShare: [0, 1],
    minReactions: [1, 50],
    sensitivity: [0.25, 3],
    autoCooldownMs: [10000, 900000],
    commandCooldownMs: [1000, 120000],
    preRollSec: [0, 60],
    postRollSec: [1, 60],
    bufferSlotMs: [2000, 30000],
    bufferSlots: [1, 8],
    minBufferMs: [1000, 60000]
  });

  function clampSetting(key, value) {
    const range = BOUNDS[key];
    if (!range) return value;
    return Math.min(range[1], Math.max(range[0], value));
  }

  function pickSettings(input) {
    const picked = {};
    if (!input || typeof input !== "object") return picked;
    for (const [key, value] of Object.entries(input)) {
      if (!(key in DEFAULTS)) continue;
      const fallback = DEFAULTS[key];
      if (typeof fallback === "boolean") {
        if (typeof value === "boolean") picked[key] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        picked[key] = clampSetting(key, value);
      }
    }
    return picked;
  }

  function mergeSettings(...layers) {
    const merged = { ...DEFAULTS };
    for (const layer of layers) Object.assign(merged, pickSettings(layer));
    return merged;
  }

  function settingsFor(mode) {
    return mergeSettings(PROFILES[mode] || {});
  }

  function loadSettings(storage, key = "clipspike.settings") {
    try {
      if (!storage || typeof storage.getItem !== "function") return {};
      // Settings saved before the rename live under the old key until the next save.
      const raw = storage.getItem(key) ||
        (key === "clipspike.settings" ? storage.getItem("chatclip.settings") || storage.getItem("highlight-desk.settings") : null);
      return raw ? pickSettings(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  }

  function saveSettings(settings, storage, key = "clipspike.settings") {
    try {
      if (!storage || typeof storage.setItem !== "function") return false;
      storage.setItem(key, JSON.stringify(pickSettings(settings)));
      return true;
    } catch {
      return false;
    }
  }

  return {
    DEFAULTS,
    PROFILES,
    BOUNDS,
    clampSetting,
    pickSettings,
    mergeSettings,
    settingsFor,
    loadSettings,
    saveSettings
  };
});
