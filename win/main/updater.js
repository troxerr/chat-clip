"use strict";

// Auto-update for the installed Windows app (electron-updater, generic feed).
// The feed URL is baked into resources/app-update.yml by electron-builder only
// for release builds (WIN_UPDATE_URL). Without that file (dev, unit tests, the
// unsigned CI installer) updating stays off. Everything is injected for tests.

const fs = require("node:fs");
const path = require("node:path");

function feedConfigured({ resourcesPath, exists = fs.existsSync } = {}) {
  return Boolean(resourcesPath) && exists(path.join(resourcesPath, "app-update.yml"));
}

function startAutoUpdate({ app, autoUpdater, resourcesPath, env = process.env, log = () => {}, exists }) {
  if (!app.isPackaged || env.HIGHLIGHT_DESK_SMOKE || env.HIGHLIGHT_DESK_NO_UPDATE === "1") return { enabled: false, reason: "not a normal packaged run" };
  if (!feedConfigured({ resourcesPath, exists })) return { enabled: false, reason: "no update feed configured" };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => log(`update check failed: ${error && error.message}`));
  autoUpdater.on("update-downloaded", (info) => log(`update ${info && info.version} downloaded; installs on quit`));
  const check = () => Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch((error) => log(`update check failed: ${error && error.message}`));
  check();
  return { enabled: true, check };
}

module.exports = { startAutoUpdate, feedConfigured };
