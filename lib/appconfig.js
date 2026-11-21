"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { normalizedEncoder } = require("./encoder.js");
const { defaultEncoder } = require("./platform.js");
const { FACECAM_CORNERS, normalizeSplitOptions } = require("./reframe.js");
const { getSecret } = require("./credentials.js");
const { resolvePriority } = require("./priority.js");
const { withLegacyEnv, LEGACY_CONFIG_NAMES } = require("./legacy.js");
const { migrateConfigFile } = require("./migrate.js");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".clipspike.json");
const VALID_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"]);
const VALID_LAYOUTS = new Set(["blur", "split"]);

const STORAGE_MODES = new Set(["local", "dropbox", "googleDrive"]);

const DEFAULT_CONFIG = {
  reframe: {
    enabled: true,
    width: 1080,
    height: 1920,
    crf: 20,
    preset: "veryfast",
    blur: 20,
    encoder: defaultEncoder(),
    bitrate: "8M",
    layout: "blur",
    camHeightRatio: 0.35,
    facecamCorner: "bottom-left",
    facecam: null,
    gameplay: null
  },
  storage: {
    mode: "local",
    folder: "/ClipSpike",
    deleteAfterUpload: true,
    keepLocalCopy: false,
    keepRaw: false
  },
  dropbox: {
    enabled: true,
    appKey: "",
    appSecret: "",
    refreshToken: "",
    folder: "/ClipSpike",
    deleteAfterUpload: true
  },
  googleDrive: {
    enabled: true,
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    folder: "/ClipSpike"
  }
};

function defaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function resolveConfigPath(env = process.env) {
  env = withLegacyEnv(env);
  if (env.CLIPSPIKE_CONFIG) return path.resolve(env.CLIPSPIKE_CONFIG);
  // Tools such as the OAuth helpers can run before the app; copy a pre-rename config on first use.
  for (const name of LEGACY_CONFIG_NAMES) {
    try { if (migrateConfigFile(path.join(os.homedir(), name), DEFAULT_CONFIG_PATH) === "copied") break; } catch {}
  }
  return DEFAULT_CONFIG_PATH;
}

function readConfig({ env = process.env, filePath = resolveConfigPath(env) } = {}) {
  let config = {};
  let error = null;
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Config root must be a JSON object.");
      }
      config = parsed;
    }
  } catch (readError) {
    error = readError.message;
    config = {};
  }
  return { config, path: filePath, error };
}

// Atomic write (temp file, then rename) of the config as pretty JSON, readable only
// by the user where the OS supports it. Throws if the folder or file cannot be written.
function writeConfig(config, { env = process.env, filePath = resolveConfigPath(env) } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const draft = `${filePath}.partial`;
  fs.writeFileSync(draft, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(draft, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
  return filePath;
}

function clamp(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function evenClamp(value, fallback, min, max) {
  const rounded = Math.round(clamp(value, fallback, min, max));
  const even = rounded % 2 === 0 ? rounded : rounded + 1;
  return Math.min(max, even);
}

function normalizeFolder(value) {
  let folder = String(value || "/ClipSpike").trim();
  if (!folder.startsWith("/")) folder = "/" + folder;
  folder = folder.replace(/\/+/g, "/").replace(/\/$/, "");
  return folder || "/";
}

// Secret from the OS credential store (macOS Keychain, Windows DPAPI), or "".
function keychainToken(account, env = process.env) {
  return getSecret(account, { env });
}

function envBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !/^(0|false|no|off)$/i.test(String(value));
}

function reframeSettings(config = {}, env = process.env) {
  env = withLegacyEnv(env);
  const source = config.reframe && typeof config.reframe === "object" ? config.reframe : {};
  const rawLayout = String(env.CLIPSPIKE_REFRAME_LAYOUT || source.layout || source.mode || "blur").trim().toLowerCase();
  const layout = VALID_LAYOUTS.has(rawLayout) ? rawLayout : "blur";
  const facecamCorner = Object.prototype.hasOwnProperty.call(FACECAM_CORNERS, source.facecamCorner)
    ? source.facecamCorner
    : "bottom-left";
  const hasFacecam = Boolean(source.facecam && typeof source.facecam === "object" && !Array.isArray(source.facecam));
  const hasGameplay = Boolean(source.gameplay && typeof source.gameplay === "object" && !Array.isArray(source.gameplay));
  const split = normalizeSplitOptions({
    camHeightRatio: source.camHeightRatio,
    facecamCorner,
    facecam: hasFacecam ? source.facecam : null,
    gameplay: hasGameplay ? source.gameplay : null
  });
  return {
    enabled: envBool(env.CLIPSPIKE_REFRAME, source.enabled !== false),
    width: evenClamp(source.width, 1080, 360, 2160),
    height: evenClamp(source.height, 1920, 640, 3840),
    crf: clamp(source.crf, 20, 16, 30),
    preset: VALID_PRESETS.has(source.preset) ? source.preset : "veryfast",
    blur: Math.round(clamp(source.blur, 20, 5, 60)),
    encoder: normalizedEncoder(source.encoder),
    priority: resolvePriority(source.priority, env),
    bitrate: typeof source.bitrate === "string" && /^\d+(?:\.\d+)?[Mk]$/.test(source.bitrate) ? source.bitrate : "8M",
    layout,
    camHeightRatio: split.camHeightRatio,
    facecamCorner,
    facecam: hasFacecam ? split.facecam : null,
    gameplay: hasGameplay ? split.gameplay : null
  };
}

function googleDriveSettings(config = {}, env = process.env) {
  env = withLegacyEnv(env);
  const source = config.googleDrive && typeof config.googleDrive === "object" ? config.googleDrive : {};
  const enabled = envBool(env.GOOGLE_ENABLED, source.enabled !== false);
  const accessToken = env.GOOGLE_ACCESS_TOKEN || source.accessToken || "";
  const clientId = env.GOOGLE_CLIENT_ID || source.clientId || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET || source.clientSecret || keychainToken("google.clientSecret", env);
  const refreshToken = env.GOOGLE_REFRESH_TOKEN || source.refreshToken || keychainToken("google.refresh", env);
  return {
    enabled,
    configured: enabled && Boolean(accessToken || (clientId && clientSecret && refreshToken)),
    accessToken,
    clientId,
    clientSecret,
    refreshToken,
    folder: normalizeFolder(env.GOOGLE_DRIVE_FOLDER || source.folder || "/ClipSpike"),
    apiBase: env.GOOGLE_API_BASE || source.apiBase || "",
    uploadBase: env.GOOGLE_UPLOAD_BASE || source.uploadBase || "",
    tokenUrl: env.GOOGLE_TOKEN_URL || source.tokenUrl || ""
  };
}

function storageSettings(config = {}, env = process.env) {
  env = withLegacyEnv(env);
  const source = config.storage && typeof config.storage === "object" ? config.storage : {};
  const dropbox = dropboxSettings(config, env);
  const googleDrive = googleDriveSettings(config, env);
  let requested = String(env.CLIPSPIKE_STORAGE || source.mode || "").trim();
  if (requested === "google") requested = "googleDrive";
  let mode;
  if (STORAGE_MODES.has(requested)) mode = requested;
  else if (!requested) mode = dropbox.configured ? "dropbox" : googleDrive.configured ? "googleDrive" : "local";
  else mode = "local";

  const folderSource = source.folder
    || (mode === "dropbox" ? dropbox.folder : mode === "googleDrive" ? googleDrive.folder : (dropbox.folder || googleDrive.folder || "/ClipSpike"));

  return {
    mode,
    configured: mode === "local" || (mode === "dropbox" ? dropbox.configured : googleDrive.configured),
    folder: normalizeFolder(folderSource),
    deleteAfterUpload: envBool(env.CLIPSPIKE_DELETE_AFTER_UPLOAD, source.deleteAfterUpload !== false),
    keepLocalCopy: envBool(env.CLIPSPIKE_KEEP_LOCAL, source.keepLocalCopy === true),
    keepRaw: envBool(env.CLIPSPIKE_KEEP_RAW, source.keepRaw === true),
    invalidMode: requested && !STORAGE_MODES.has(requested) ? requested : null,
    dropbox,
    googleDrive
  };
}

function dropboxSettings(config = {}, env = process.env) {
  env = withLegacyEnv(env);
  const source = config.dropbox && typeof config.dropbox === "object" ? config.dropbox : {};
  const enabled = envBool(env.DROPBOX_ENABLED, source.enabled !== false);
  const accessToken = env.DROPBOX_ACCESS_TOKEN || source.accessToken || "";
  const appKey = env.DROPBOX_APP_KEY || source.appKey || "";
  const appSecret = env.DROPBOX_APP_SECRET || source.appSecret || keychainToken("dropbox.appSecret", env);
  const refreshToken = env.DROPBOX_REFRESH_TOKEN || source.refreshToken || keychainToken("dropbox.refresh", env);
  return {
    enabled,
    configured: enabled && Boolean(accessToken || (appKey && refreshToken)),
    accessToken,
    appKey,
    appSecret,
    refreshToken,
    folder: normalizeFolder(env.DROPBOX_FOLDER || source.folder || "/ClipSpike"),
    deleteAfterUpload: envBool(env.DROPBOX_DELETE_AFTER_UPLOAD, source.deleteAfterUpload !== false),
    apiBase: env.DROPBOX_API_BASE || source.apiBase || "",
    contentBase: env.DROPBOX_CONTENT_BASE || source.contentBase || "",
    tokenUrl: env.DROPBOX_TOKEN_URL || source.tokenUrl || ""
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG,
  VALID_PRESETS,
  VALID_LAYOUTS,
  STORAGE_MODES,
  defaultConfig,
  resolveConfigPath,
  readConfig,
  writeConfig,
  reframeSettings,
  dropboxSettings,
  googleDriveSettings,
  keychainToken,
  storageSettings,
  normalizeFolder,
  envBool
};
