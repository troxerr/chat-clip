"use strict";

// The app's own non-secret settings, kept in the "app" section of the shared
// config file, plus the one-time "I have permission to record" acknowledgement.

const PERMISSION_VERSION = 1; // bump if the wording changes materially, to ask again

function createSettings({ readConfig, writeConfig, now = () => new Date(), outputFolder }) {
  const section = () => {
    const config = readConfig() || {};
    return config.app && typeof config.app === "object" ? config.app : {};
  };
  const save = (changes) => {
    const config = readConfig() || {};
    writeConfig({ ...config, app: { ...(config.app && typeof config.app === "object" ? config.app : {}), ...changes } });
  };

  function get() {
    const s = section();
    return {
      launchAtLogin: s.launchAtLogin === true,
      permissionAcknowledged: s.permissionVersion === PERMISSION_VERSION && typeof s.permissionAt === "string",
      permissionAt: typeof s.permissionAt === "string" ? s.permissionAt : "",
      outputFolder
    };
  }

  function set(changes = {}) {
    const next = {};
    if (typeof changes.launchAtLogin === "boolean") next.launchAtLogin = changes.launchAtLogin;
    if (Object.keys(next).length) save(next);
    return get();
  }

  // Recording is refused until this has been done once.
  function acknowledgePermission() {
    save({ permissionAt: now().toISOString(), permissionVersion: PERMISSION_VERSION });
    return get();
  }

  return { get, set, acknowledgePermission };
}

module.exports = { createSettings, PERMISSION_VERSION };
