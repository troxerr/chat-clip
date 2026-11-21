"use strict";

// Names ChatClip used before the rename from "Highlight Desk". Kept so existing
// installs keep working: old env vars are still honored and old data is found.

const LEGACY_ENV_PREFIX = "HIGHLIGHT_DESK_";
const ENV_PREFIX = "CHATCLIP_";
const LEGACY_APP_NAME = "Highlight Desk";
const LEGACY_CONFIG_NAME = ".highlight-desk.json";
const LEGACY_DRIVE_FOLDER = "Highlight Desk";
const LEGACY_SERVICE = "com.highlightdesk.app.credentials";
const LEGACY_DPAPI_ENTROPY = "HighlightDesk.credentials.v1";
const DPAPI_ENTROPY = "ChatClip.credentials.v1";

// Returns `env` unchanged unless it holds HIGHLIGHT_DESK_* names that have no
// CHATCLIP_* counterpart; then returns a copy with those mapped. CHATCLIP_* wins.
function withLegacyEnv(env = process.env) {
  let out = null;
  for (const key of Object.keys(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX)) continue;
    const next = ENV_PREFIX + key.slice(LEGACY_ENV_PREFIX.length);
    if (env[next] === undefined) (out ||= { ...env })[next] = env[key];
  }
  return out || env;
}

// Same mapping applied in place; call once at process start.
function mirrorLegacyEnv(env = process.env) {
  const mapped = withLegacyEnv(env);
  if (mapped !== env) for (const key of Object.keys(mapped)) if (env[key] === undefined) env[key] = mapped[key];
  return env;
}

module.exports = {
  LEGACY_APP_NAME, LEGACY_CONFIG_NAME, LEGACY_DRIVE_FOLDER, LEGACY_SERVICE,
  LEGACY_DPAPI_ENTROPY, DPAPI_ENTROPY, withLegacyEnv, mirrorLegacyEnv
};
