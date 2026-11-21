const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const config = require("../lib/appconfig.js");

test("default config has reframe and dropbox sections", () => {
  const template = config.defaultConfig();
  assert.equal(template.reframe.width, 1080);
  assert.equal(template.reframe.height, 1920);
  assert.equal(template.reframe.layout, "blur");
  assert.equal(template.reframe.camHeightRatio, 0.35);
  assert.equal(template.reframe.facecamCorner, "bottom-left");
  assert.equal(template.dropbox.deleteAfterUpload, true);
  assert.equal(template.dropbox.folder, "/ClipSpike");
  assert.equal(template.storage.mode, "local");
  assert.equal(template.googleDrive.clientId, "");
  assert.deepEqual(template.reframe, config.defaultConfig().reframe);
  assert.notEqual(template, config.defaultConfig());
});

test("readConfig handles missing, valid, and invalid files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-config-"));
  try {
    const missing = path.join(dir, "missing.json");
    assert.deepEqual(config.readConfig({ filePath: missing }).config, {});
    assert.equal(config.readConfig({ filePath: missing }).error, null);

    const valid = path.join(dir, "valid.json");
    fs.writeFileSync(valid, JSON.stringify({ reframe: { enabled: false } }));
    const loaded = config.readConfig({ filePath: valid });
    assert.equal(loaded.config.reframe.enabled, false);
    assert.equal(loaded.error, null);

    const invalid = path.join(dir, "invalid.json");
    fs.writeFileSync(invalid, "{bad");
    const broken = config.readConfig({ filePath: invalid });
    assert.deepEqual(broken.config, {});
    assert.match(broken.error, /JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readConfig honors CLIPSPIKE_CONFIG", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipspike-config-"));
  try {
    const file = path.join(dir, "custom.json");
    fs.writeFileSync(file, JSON.stringify({ reframe: { blur: 33 } }));
    const result = config.readConfig({ env: { CLIPSPIKE_CONFIG: file } });
    assert.equal(result.path, file);
    assert.equal(result.config.reframe.blur, 33);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reframeSettings clamps and defaults", () => {
  const defaults = config.reframeSettings({});
  assert.deepEqual(defaults, {
    enabled: true,
    width: 1080,
    height: 1920,
    crf: 20,
    preset: "veryfast",
    blur: 20,
    encoder: process.platform === "darwin" ? "h264_videotoolbox" : "auto",
    priority: process.platform === "win32" ? "belowNormal" : "normal",
    bitrate: "8M",
    layout: "blur",
    camHeightRatio: 0.35,
    facecamCorner: "bottom-left",
    facecam: null,
    gameplay: null
  });

  const custom = config.reframeSettings({
    reframe: {
      enabled: false,
      width: 999,
      height: 1001,
      crf: 99,
      preset: "nope",
      blur: 999,
      layout: "split",
      camHeightRatio: 0.9,
      facecamCorner: "top-right",
      facecam: { x: 0.85, y: 0.85, w: 0.5, h: 0.5 },
      gameplay: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 }
    }
  });
  assert.equal(custom.enabled, false);
  assert.equal(custom.width % 2, 0);
  assert.equal(custom.height % 2, 0);
  assert.equal(custom.crf, 30);
  assert.equal(custom.preset, "veryfast");
  assert.equal(custom.blur, 60);
  assert.equal(custom.layout, "split");
  assert.equal(custom.camHeightRatio, 0.5);
  assert.equal(custom.facecamCorner, "top-right");
  assert.deepEqual(custom.facecam, { x: 0.85, y: 0.85, w: 0.15, h: 0.15 });
  assert.deepEqual(custom.gameplay, { x: 0.1, y: 0.05, w: 0.8, h: 0.9 });

  assert.equal(config.reframeSettings({ reframe: { priority: "belowNormal" } }, {}).priority, "belowNormal");
  assert.equal(config.reframeSettings({ reframe: { priority: "normal" } }, {}).priority, "normal");
  assert.equal(config.reframeSettings({ reframe: { priority: "nope" } }, { CLIPSPIKE_PRIORITY: "belowNormal" }).priority, "belowNormal");

  const invalidSplit = config.reframeSettings({
    reframe: { layout: "unknown", camHeightRatio: 0.05, facecamCorner: "center" }
  });
  assert.equal(invalidSplit.layout, "blur");
  assert.equal(invalidSplit.camHeightRatio, 0.2);
  assert.equal(invalidSplit.facecamCorner, "bottom-left");

  const env = config.reframeSettings(
    { reframe: { enabled: true, layout: "blur" } },
    { CLIPSPIKE_REFRAME: "0", CLIPSPIKE_REFRAME_LAYOUT: "split" }
  );
  assert.equal(env.enabled, false);
  assert.equal(env.layout, "split");
});

test("storage defaults to local and preserves legacy Dropbox configuration", () => {
  const defaults = config.storageSettings({}, {});
  assert.equal(defaults.mode, "local");
  assert.equal(defaults.configured, true);
  assert.equal(defaults.deleteAfterUpload, true);
  assert.equal(defaults.keepLocalCopy, false);
  assert.equal(defaults.keepRaw, false);

  const legacy = config.storageSettings({
    dropbox: { appKey: "key", appSecret: "secret", refreshToken: "refresh", folder: "/Legacy" }
  }, {});
  assert.equal(legacy.mode, "dropbox");
  assert.equal(legacy.configured, true);
  const pkce = config.dropboxSettings({ dropbox: { appKey: "key", refreshToken: "refresh" } }, {});
  assert.equal(pkce.configured, true);
  assert.equal(legacy.folder, "/Legacy");

  const explicit = config.storageSettings({
    storage: { mode: "googleDrive", folder: "/Desk", deleteAfterUpload: false, keepLocalCopy: true, keepRaw: true },
    googleDrive: { clientId: "id", clientSecret: "secret", refreshToken: "refresh" }
  }, {});
  assert.equal(explicit.mode, "googleDrive");
  assert.equal(explicit.configured, true);
  assert.equal(explicit.folder, "/Desk");
  assert.equal(explicit.deleteAfterUpload, false);
  assert.equal(explicit.keepLocalCopy, true);
  assert.equal(explicit.keepRaw, true);

  const env = config.storageSettings({}, { CLIPSPIKE_STORAGE: "local" });
  assert.equal(env.mode, "local");

  const invalid = config.storageSettings({ storage: { mode: "nope" } }, {});
  assert.equal(invalid.mode, "local");
  assert.equal(invalid.invalidMode, "nope");
});

test("googleDriveSettings detects credential combinations and env overrides", () => {
  const configured = config.googleDriveSettings({
    googleDrive: { clientId: "id", clientSecret: "secret", refreshToken: "refresh", folder: "Drive Folder" }
  }, {});
  assert.equal(configured.configured, true);
  assert.equal(configured.folder, "/Drive Folder");

  const accessToken = config.googleDriveSettings({
    googleDrive: { accessToken: "token" }
  }, {});
  assert.equal(accessToken.configured, true);

  const missingSecret = config.googleDriveSettings({
    googleDrive: { clientId: "id", refreshToken: "refresh" }
  }, {});
  assert.equal(missingSecret.configured, false);

  const env = config.googleDriveSettings({ googleDrive: {} }, {
    GOOGLE_CLIENT_ID: "env-id",
    GOOGLE_CLIENT_SECRET: "env-secret",
    GOOGLE_REFRESH_TOKEN: "env-refresh",
    GOOGLE_DRIVE_FOLDER: "Env Drive"
  });
  assert.equal(env.configured, true);
  assert.equal(env.folder, "/Env Drive");
});

test("dropboxSettings reads config, applies env precedence, and detects configuration", () => {
  const fromConfig = config.dropboxSettings({
    dropbox: {
      enabled: true,
      appKey: "key",
      appSecret: "secret",
      refreshToken: "refresh",
      folder: "Clips//Lacy/",
      deleteAfterUpload: false
    }
  }, {});
  assert.equal(fromConfig.configured, true);
  assert.equal(fromConfig.folder, "/Clips/Lacy");
  assert.equal(fromConfig.deleteAfterUpload, false);

  const fromEnv = config.dropboxSettings({ dropbox: { enabled: true } }, {
    DROPBOX_ACCESS_TOKEN: "token",
    DROPBOX_FOLDER: "Env Folder"
  });
  assert.equal(fromEnv.configured, true);
  assert.equal(fromEnv.folder, "/Env Folder");

  const disabled = config.dropboxSettings({
    dropbox: { enabled: false, appKey: "k", appSecret: "s", refreshToken: "r" }
  }, {});
  assert.equal(disabled.configured, false);

  const unconfigured = config.dropboxSettings({ dropbox: { enabled: true } }, {});
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.folder, "/ClipSpike");
  assert.equal(unconfigured.deleteAfterUpload, true);
});

test("normalizeFolder produces an absolute path", () => {
  assert.equal(config.normalizeFolder("Clips"), "/Clips");
  assert.equal(config.normalizeFolder("//Clips//Lacy//"), "/Clips/Lacy");
  assert.equal(config.normalizeFolder("/"), "/");
});
