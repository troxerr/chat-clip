"use strict";

// Auto-update for the installed Windows app (electron-updater, generic feed).
// The feed URL is baked into resources/app-update.yml by electron-builder only
// for release builds (WIN_UPDATE_URL). Without that file (dev, unit tests, the
// unsigned CI installer) updating stays off, as it does for the portable exe. Everything is injected for tests.
//
// The window never touches electron-updater. It gets a small state object
// ({ status, version, percent, error }) plus two actions: check and install.
// status: disabled | idle | checking | downloading | ready | up-to-date | error

const fs = require("node:fs");
const path = require("node:path");

function feedConfigured({ resourcesPath, exists = fs.existsSync } = {}) {
  return Boolean(resourcesPath) && exists(path.join(resourcesPath, "app-update.yml"));
}

function disabled(reason) {
  const state = { status: "disabled", version: null, percent: null, error: null, reason };
  return { enabled: false, reason, stop: () => {}, getState: () => state, onChange: () => () => {}, check: async () => state, install: () => false };
}

const RECHECK_MS = 6 * 60 * 60 * 1000;

function startAutoUpdate({
  app, autoUpdater, resourcesPath, env = process.env, log = () => {}, record = () => {}, exists,
  // Re-check while the app stays open (it can run for days), but never while a capture is running.
  isBusy = () => false, intervalMs = RECHECK_MS, timers = { setInterval, clearInterval }
}) {
  if (!app.isPackaged || env.CLIPSPIKE_SMOKE || env.CLIPSPIKE_NO_UPDATE === "1") return disabled("not a normal packaged run");
  if (env.PORTABLE_EXECUTABLE_FILE) return disabled("portable build does not self-update");
  if (!feedConfigured({ resourcesPath, exists })) return disabled("no update feed configured");

  let state = { status: "idle", version: null, percent: null, error: null };
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn(state); } catch { /* a bad listener must not stop updating */ } }
  };
  const fail = (error) => {
    const message = (error && error.message) || String(error);
    log(`update check failed: ${message}`);
    record("update.error", error || message);
    set({ status: "error", percent: null, error: message });
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The diagnostics log keeps only event names and an error category, never versions, URLs or messages.
  autoUpdater.on("checking-for-update", () => { record("update.check"); set({ status: "checking", error: null }); });
  autoUpdater.on("update-available", (info) => { record("update.available"); set({ status: "downloading", version: (info && info.version) || null, percent: 0 }); });
  autoUpdater.on("update-not-available", () => { record("update.not_available"); set({ status: "up-to-date", version: null, percent: null }); });
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))) }));
  autoUpdater.on("error", fail);
  autoUpdater.on("update-downloaded", (info) => {
    log(`update ${info && info.version} downloaded; installs on quit`);
    record("update.downloaded");
    set({ status: "ready", version: (info && info.version) || state.version, percent: 100, error: null });
  });

  // One check at a time. Once an update is downloaded there is nothing more to look for.
  const check = () => {
    if (["checking", "downloading", "ready"].includes(state.status)) return Promise.resolve(state);
    return Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((error) => { if (state.status !== "error") fail(error); })
      .then(() => state);
  };

  // Restart now: quit, run the downloaded installer silently, and reopen the app.
  const install = () => {
    if (state.status !== "ready") return false;
    log(`restarting to install ${state.version}`);
    record("update.install");
    autoUpdater.quitAndInstall(true, true);
    return true;
  };

  check();
  const timer = intervalMs > 0 ? timers.setInterval(() => { if (!isBusy()) check(); }, intervalMs) : null;
  if (timer && typeof timer.unref === "function") timer.unref();
  const stop = () => { if (timer) timers.clearInterval(timer); };
  return { enabled: true, check, install, stop, getState: () => state, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
}

module.exports = { startAutoUpdate, feedConfigured };
