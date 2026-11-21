"use strict";

// Names this app used before it was called ClipSpike: "ChatClip" (most recent)
// and "Highlight Desk". Kept so existing installs keep working: old env vars are
// still honored and old data is found. Every list is ordered newest first.

const ENV_PREFIX = "CLIPSPIKE_";
const LEGACY_ENV_PREFIXES = ["CHATCLIP_", "HIGHLIGHT_DESK_"];
const LEGACY_APP_NAMES = ["ChatClip", "Highlight Desk"];
const LEGACY_CONFIG_NAMES = [".chatclip.json", ".highlight-desk.json"];
const LEGACY_DRIVE_FOLDERS = ["ChatClip", "Highlight Desk"];
const LEGACY_SERVICES = ["com.chatclip.app.credentials", "com.highlightdesk.app.credentials"];
const LEGACY_DPAPI_ENTROPIES = ["ChatClip.credentials.v1", "HighlightDesk.credentials.v1"];
const DPAPI_ENTROPY = "ClipSpike.credentials.v1";

// Returns `env` unchanged unless it holds CHATCLIP_* / HIGHLIGHT_DESK_* names that
// have no CLIPSPIKE_* counterpart; then returns a copy with those mapped.
// CLIPSPIKE_* wins, then CHATCLIP_*, then HIGHLIGHT_DESK_*.
function withLegacyEnv(env = process.env) {
  let out = null;
  for (const prefix of LEGACY_ENV_PREFIXES) {
    for (const key of Object.keys(env)) {
      if (!key.startsWith(prefix)) continue;
      const next = ENV_PREFIX + key.slice(prefix.length);
      if ((out || env)[next] === undefined) (out ||= { ...env })[next] = env[key];
    }
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
  LEGACY_ENV_PREFIXES, LEGACY_APP_NAMES, LEGACY_CONFIG_NAMES, LEGACY_DRIVE_FOLDERS, LEGACY_SERVICES,
  LEGACY_DPAPI_ENTROPIES, DPAPI_ENTROPY, withLegacyEnv, mirrorLegacyEnv
};
