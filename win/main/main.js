"use strict";

// Electron entry point: wires the window, menu and Windows services to the
// app logic in app.js. Kept thin on purpose; the rules are unit-tested there.
// Setting CHATCLIP_SMOKE=<folder> runs a scripted self-test (see smoke.js).

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require("electron");

const platform = require("../../lib/platform.js");
const { resolveConfigPath, readConfig, writeConfig } = require("../../lib/appconfig.js");
const { createCredentialStore } = require("../../lib/credentials.js");
const { createJobStore } = require("../../lib/jobstore.js");
const feedback = require("../../lib/feedback.js");
const { licenseRequest } = require("../../tools/license.js");
const { Engine } = require("./engine.js");
const { createLicenseManager } = require("./license.js");
const { createSettings } = require("./settings.js");
const { createClips } = require("./clips.js");
const { createApp } = require("./app.js");

require("../../lib/legacy.js").mirrorLegacyEnv();
const SMOKE = process.env.CHATCLIP_SMOKE || "";
// Moves a pre-rename "Highlight Desk" profile (state and Electron userData share one folder) before it is used.
if (!SMOKE) require("../../lib/migrate.js").runMigration();
const ROOT = path.join(__dirname, "..", "..");
const INDEX = path.join(__dirname, "..", "renderer", "index.html");

const userData = SMOKE ? path.join(SMOKE, "electron") : path.join(app.getPath("appData"), "ChatClip");
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);

if (SMOKE) {
  // Self-test runs keep everything inside the given folder and need no GPU.
  fs.mkdirSync(SMOKE, { recursive: true });
  process.env.CHATCLIP_STATE = process.env.CHATCLIP_STATE || path.join(SMOKE, "state");
  process.env.CHATCLIP_OUTPUT = process.env.CHATCLIP_OUTPUT || path.join(SMOKE, "clips");
  process.env.CHATCLIP_CONFIG = process.env.CHATCLIP_CONFIG || path.join(SMOKE, "config.json");
  process.env.CHATCLIP_NOTIFICATIONS = "0";
  process.env.CHATCLIP_KEYCHAIN = "0";
  app.disableHardwareAcceleration();
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function buildConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build-config.json"), "utf8")); } catch { return {}; }
}

function createServices() {
  const configPath = resolveConfigPath(process.env);
  const store = createCredentialStore({ env: process.env });
  const readCfg = () => readConfig({ filePath: configPath }).config;
  // A config file that cannot be parsed is never overwritten from a blank copy.
  const writeCfg = (config) => {
    const current = readConfig({ filePath: configPath });
    if (current.error) throw new Error(`The settings file could not be read (${current.error}). Fix or delete ${configPath}.`);
    writeConfig(config, { filePath: configPath });
  };
  const outputFolder = platform.outputRoot();
  const jobStore = createJobStore({ stateDir: platform.stateDir() });
  const feedbackDir = feedback.feedbackDir();

  const engine = new Engine({ script: path.join(ROOT, "background.cjs"), runAsNode: true });
  const license = createLicenseManager({
    readConfig: readCfg, writeConfig: writeCfg, store, request: licenseRequest, build: buildConfig(), deviceName: require("node:os").hostname()
  });
  const baseSettings = createSettings({ readConfig: readCfg, writeConfig: writeCfg, outputFolder });
  const settings = {
    ...baseSettings,
    set(changes) {
      const result = baseSettings.set(changes);
      if (typeof changes.launchAtLogin === "boolean" && !SMOKE) {
        try { app.setLoginItemSettings({ openAtLogin: changes.launchAtLogin }); } catch {}
      }
      return result;
    }
  };
  const clips = createClips({
    jobStore, feedback, feedbackDir,
    openPath: (file) => shell.openPath(file),
    showItem: (file) => shell.showItemInFolder(file)
  });
  const core = createApp({
    engine, license, settings, clips,
    openExternal: (url) => shell.openExternal(url),
    openFolder: (folder) => { fs.mkdirSync(folder, { recursive: true }); return shell.openPath(folder); },
    version: app.getVersion(),
    outputFolder,
    versions: { electron: process.versions.electron, node: process.versions.node }
  });
  return { core, license, engine };
}

function main() {
  let services;
  let win = null;

  const send = (name, value) => { if (win && !win.isDestroyed()) win.webContents.send("hd:event", name, value); };

  function createWindow() {
    win = new BrowserWindow({
      width: 1100, height: 720, minWidth: 760, minHeight: 560,
      title: "ChatClip",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#15131a" : "#f6f5fb",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
      }
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault(); });
    win.loadFile(INDEX);
    return win;
  }

  const calls = () => {
    const c = services.core;
    return {
      getState: () => c.snapshot(),
      start: (input, options) => c.start(input, options),
      stop: () => c.stop(),
      saveHighlight: () => c.saveHighlight(),
      markMissed: () => c.markMissed(),
      "clips.list": () => c.clips.list(),
      "clips.open": (id) => c.clips.open(id),
      "clips.reveal": (id) => c.clips.reveal(id),
      "clips.rate": (id, rating) => c.clips.rate(id, rating),
      "license.activate": (key) => c.license.activate(key),
      "license.validate": () => c.license.validate(),
      "license.deactivate": () => c.license.deactivate(),
      "license.buy": () => c.license.buy(),
      "settings.set": (changes) => c.settings.set(changes),
      openClipFolder: () => c.openClipFolder(),
      openLink: (url) => c.openLink(url)
    };
  };

  function buildMenu() {
    const notice = (text) => send("notice", text);
    const go = (page) => () => send("navigate", page);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "&File", submenu: [
        { label: "Save highlight now", accelerator: "CmdOrCtrl+S", click: () => { try { services.core.saveHighlight(); } catch (error) { notice(error.message); } } },
        { type: "separator" },
        { role: "quit" }
      ] },
      { label: "&View", submenu: [
        { label: "Capture", accelerator: "CmdOrCtrl+1", click: go("capture") },
        { label: "Clips", accelerator: "CmdOrCtrl+2", click: go("clips") },
        { label: "Settings", accelerator: "CmdOrCtrl+3", click: go("settings") },
        { label: "Settings (shortcut)", accelerator: "CmdOrCtrl+,", visible: false, click: go("settings") }
      ] }
    ]));
  }

  app.whenReady().then(() => {
    services = createServices();
    const handlers = calls();
    ipcMain.handle("hd:call", async (event, name, ...args) => {
      // Only our own window may call in.
      if (!win || event.sender !== win.webContents) throw new Error("Not allowed.");
      const handler = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
      if (!handler) throw new Error("Unknown request.");
      return handler(...args);
    });
    services.core.on("capture", (state) => send("capture", state));
    services.core.on("clips", () => send("clips"));
    buildMenu();
    createWindow();
    app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
    if (!SMOKE) {
      try {
        require("./updater.js").startAutoUpdate({
          app, autoUpdater: require("electron-updater").autoUpdater, resourcesPath: process.resourcesPath, log: (m) => console.log(`[updater] ${m}`)
        });
      } catch (error) { console.log(`[updater] disabled: ${error.message}`); }
    }
    if (SMOKE) require("./smoke.js").run({ win, services, dir: SMOKE, send });
  });

  app.on("window-all-closed", () => app.quit());
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing || !services) return;
    closing = true;
    event.preventDefault();
    Promise.resolve(services.core.shutdown()).catch(() => {}).finally(() => app.exit(0));
  });
}
